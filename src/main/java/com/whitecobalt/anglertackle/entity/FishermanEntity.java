package com.whitecobalt.anglertackle.entity;

import com.whitecobalt.anglertackle.registry.ModEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.stats.Stats;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.AgeableMob;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.npc.AbstractVillager;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.SpawnEggItem;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.item.trading.MerchantOffers;
import net.minecraft.world.level.Level;

import java.util.UUID;

/**
 * 渔人 · 老柯 —— 渔人小屋的 NPC 商人（策划案 {@code docs/13-新手链路与NPC系统.md} §1.3）。
 *
 * <h2>为什么继承 {@link AbstractVillager} 而不是 {@link net.minecraft.world.entity.npc.Villager}</h2>
 * 两者都能给"能交易的 NPC"，但 {@code Villager} 额外背着一整套**村庄系统**：
 * Brain 日程表、床、工作站、职业、gossips、铁傀儡生成、袭击……
 * 那些东西对"固定站在码头上的一个渔夫"全是负担，而且会互相打架 ——
 * 比如村民到点会自动去找床睡觉，你没法让它"永远站在码头"。
 *
 * <p>{@code AbstractVillager} 只保留 {@code Merchant} 接口（{@code getOffers} /
 * {@code setTradingPlayer} / 交易界面），日程完全由我们自己写。行走动画与外观
 * 靠模型复用 {@code VillagerModel} 拿到 —— **动画在模型层，不在实体层**，
 * 所以不继承 Villager 一样有村民的走路姿势（用户要求"行走动作就套村民模板"）。
 *
 * <h2>两条硬约束（都验证过，不是猜的）</h2>
 * <ol>
 *   <li>{@code AbstractVillager} 有两个 abstract 方法必须实现：
 *       {@link #updateTrades()} 和 {@link #rewardTradeXp(MerchantOffer)}。
 *       {@code javap -protected} 从 {@code recompile_*output.jar} 读出来的，不是照抄教程。</li>
 *   <li>{@code VillagerModel<T extends Entity>} 的泛型上界是 {@code Entity} 而不是
 *       {@code Villager}，所以不继承村民也能用它的模型和动画。</li>
 * </ol>
 *
 * <h2>还没做的</h2>
 * <ul>
 *   <li>真正的交易表（现在是空的，右键打开的是空商品页）—— M5 商店阶段</li>
 *   <li>对话系统 —— M5</li>
 *   <li>死亡后 30 秒原地复活 —— 见 {@link #isInvulnerableTo} 的说明，
 *       他实际上打不死，所以"复活"目前没有触发路径；等结构落地后再决定要不要做</li>
 *   <li>原创 64×64 皮肤（草帽 + 白胡 + 背带裤 + 卷袖）—— 现在是原版村民贴图</li>
 * </ul>
 */
public class FishermanEntity extends AbstractVillager {

    /**
     * "家"的位置 —— 小屋/码头。夜里回这里，被玩家打时也传送回这里。
     *
     * <p>用 {@link BlockPos} 而不是记一个结构实例：结构生成时把原点写进来即可，
     * 实体不需要知道"我是哪个结构生成的"。没设置时（比如创造模式刷出来的）
     * 就待在原地不乱跑 —— 这一点很重要，否则调试时他会一路走回 (0,0)。
     */
    private BlockPos home = null;

    /** 传送回屋的冷却（tick）。防止玩家连点把他刷成瞬移怪。 */
    private static final int TELEPORT_COOLDOWN = 40;

    private int teleportCooldown = 0;

    public FishermanEntity(EntityType<? extends FishermanEntity> type, Level level) {
        super(type, level);
        // 不参与村民式繁殖 / 不捡东西：它不是村民，是剧情 NPC。
        this.setCanPickUpLoot(false);
        // 绝不自然消失。不加这一行，玩家走远 128 格再回来，老柯就没了 ——
        // 而他是"随结构生成"的，消失了不会自己长回来。
        this.setPersistenceRequired();
    }

    /** 属性：血量略高、移速比村民慢一点（老人），不主动攻击。 */
    public static AttributeSupplier.Builder createAttributes() {
        return Mob.createMobAttributes()
                .add(Attributes.MAX_HEALTH, 40.0)
                .add(Attributes.MOVEMENT_SPEED, 0.42)   // 村民是 0.5
                .add(Attributes.FOLLOW_RANGE, 24.0);
    }

    // ---------------------------------------------------------------- AI
    //
    // 用户 2026-10-02："老柯不再移动，避免其乱动玩家找不到。"
    //
    // 于是**一个移动目标都不注册**（原来有 GoHomeGoal + StrollNearHomeGoal）。
    // 只留"看着玩家"和"随机转头"这两个纯表现型目标 —— 它们不推导航、不改坐标，
    // 所以老柯永远站在原地：卖掉鱼再回来，他还在那儿。
    //
    // ⚠ 不要为了"他看起来活着"再把走动加回来：小屋现在比原来稀
    //   （spacing 34，和村庄同档），玩家跑几百格过来找他，结果他晃进树林里 ——
    //   这个代价比"站着不动"大得多。
    @Override
    protected void registerGoals() {
        // 不调 super：AbstractVillager 的默认目标是"在村里游荡"，
        // 那套依赖村庄 POI，我们这里没有。全部自己写。
        this.goalSelector.addGoal(0, new FloatGoal(this));
        this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, Player.class, 8.0f));
        this.goalSelector.addGoal(9, new RandomLookAroundGoal(this));
    }

    /**
     * 站桩说明（原 StrollNearHomeGoal / GoHomeGoal 已删）。
     *
     * <p>老柯原来有"白天在家附近踱步、夜里回屋"两个目标。用户 2026-10-02 要求
     * "不再移动"，两个都删了 —— 留着任何一条都会让他慢慢挪位置。
     *
     * <p>被打时仍然会 {@code teleportHome()}（见 {@link #hurt}）：那是"被推走了就回位"，
     * 不是自主移动，正好补上删掉走位之后唯一的例外情况。
     */

    // ---------------------------------------------------------------- 保护
    /**
     * 受伤规则。
     *
     * <p>策划案 §1.3 要的是"打不动，但会闪一下并传送回小屋"。这两件事
     * 拆在两个地方做，因为它们的**时机**不同：
     * <ul>
     *   <li>{@code isInvulnerableTo} 是"能不能受伤"的闸门，在 {@code hurt()} <b>之前</b>。
     *       这里放行玩家来源（让 {@link #hurt} 能收到回调），拦住其它一切
     *       （摔落、火、溺水、仙人掌……否则他乱走时会被环境悄悄弄死）。</li>
     *   <li>{@code hurt} 才是"挨了一下"的反应：闪红 + 传送回屋 + 返回 false 表示不掉血。</li>
     * </ul>
     *
     * <p><b>为什么放行 {@code BYPASSES_INVULNERABILITY}</b>：{@code /kill} 走的是
     * {@code generic_kill} 伤害类型，它带这个标签（从 {@code minecraft_1.21.1_client.jar}
     * 里的 {@code data/minecraft/tags/damage_type/bypasses_invulnerability.json} 读出来的，
     * 内容就两项：{@code out_of_world} 和 {@code generic_kill}）。
     * 如果连它一起拦掉，测试时就没法删掉老柯了 —— 那比"能被打死"更麻烦。
     * 同理虚空伤害（{@code out_of_world}）也放行，掉进虚空还挂着会很诡异。
     */
    @Override
    public boolean isInvulnerableTo(DamageSource source) {
        if (source.getEntity() instanceof Player) {
            return false;   // 玩家打得中他（但 hurt() 会拦下伤害，只做反应）
        }
        if (source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) {
            return false;   // /kill、虚空 —— 留一条"能删掉他"的路
        }
        return true;        // 环境伤害一律免疫
    }

    /**
     * 挨玩家一下：闪红 + 传送回小屋，**不掉血**。
     *
     * <p>闪红为什么要手写：伤害被我们拦掉了，{@code LivingEntity} 不会走
     * "受击 → 染红"的流程，不打这一下他一点反应都没有，玩家会以为卡了。
     * {@code hurtTime} / {@code hurtDuration} 是 {@code public} 字段
     * （已从 jar 里 javap 确认），模型层直接读它们做红色叠加。
     */
    @Override
    public boolean hurt(DamageSource source, float amount) {
        if (source.getEntity() instanceof Player && !level().isClientSide) {
            this.hurtTime = 10;
            this.hurtDuration = 10;
            teleportHome();
            return false;
        }
        return super.hurt(source, amount);
    }

    /**
     * 传送回小屋。
     *
     * <p>用 {@link #randomTeleport} 而不是 {@code teleportTo}：前者会在目标点周围
     * 找一个**站得住**的位置。小屋坐标是结构原点，直接传送有可能卡在墙里。
     *
     * <p>没有家（调试刷出来的）时只播个音效，不做任何事 —— 不传送到 (0,0)。
     */
    private void teleportHome() {
        if (home == null || teleportCooldown > 0) {
            return;
        }
        teleportCooldown = TELEPORT_COOLDOWN;
        double x = home.getX() + 0.5;
        double y = home.getY();
        double z = home.getZ() + 0.5;
        if (randomTeleport(x, y, z, true)) {
            if (level() instanceof ServerLevel sl) {
                sl.sendParticles(ParticleTypes.POOF, x, y + 1.0, z, 12, 0.3, 0.5, 0.3, 0.02);
            }
            level().playSound(null, x, y, z, SoundEvents.ENDERMAN_TELEPORT,
                    SoundSource.NEUTRAL, 0.8f, 1.2f);
        }
    }

    /** 被玩家推/挤时不后退 —— 老人不跟人打架，也不该被推进河里。 */
    @Override
    public boolean isPushable() {
        return false;
    }

    @Override
    public void tick() {
        super.tick();
        if (teleportCooldown > 0) {
            teleportCooldown--;
        }
        adoptSpawnAsHome();
    }

    /**
     * 没有家的时候，把"我落地的这个地方"当成家。
     *
     * <p><b>为什么不是写在 {@code finalizeSpawn} 里</b>：结构模板放置实体时会不会调
     * {@code finalizeSpawn}，取决于 {@code StructurePlaceSettings.shouldFinalizeEntities()}，
     * 而那个标志位默认是 <b>false</b>（{@code StructureTemplate.addEntitiesToWorld} 里
     * {@code if (placementIn.shouldFinalizeEntities() && entity instanceof Mob)}）。
     * 也就是说这条路径**不保证**会被走到，而它失效的样子是"老柯一切正常，就是不回家"。
     *
     * <p>改成第一 tick 自己认领，就完全不依赖那个标志位了：
     * <ul>
     *   <li>结构生成的老柯 → 家 = 他站的那块码头</li>
     *   <li>{@code /summon} 或刷怪蛋放出来的老柯 → 家 = 他脚下的地（调试时正是想要的）</li>
     *   <li>存档里已经写了 {@code AtlHome} 的 → {@link #readAdditionalSaveData} 先跑，
     *       这里就不会覆盖</li>
     * </ul>
     *
     * <p>为什么等"落地"而不是第一 tick 就认领：结构生成时实体是从 {@code pos}
     * 那个精确坐标放下来的，可能会先自由落体半格（比如落在半砖上）。第一 tick 认领
     * 会把这个悬空坐标记成家，夜里"回家"就会走到半空中去。
     * 60 tick 是兜底：万一他一直在水里/悬空（onGround 永远不为真），
     * 至少别让 home 一直是 null。
     */
    private void adoptSpawnAsHome() {
        if (home != null || level().isClientSide) {
            return;
        }
        if (this.onGround() || this.tickCount > 60) {
            home = blockPosition();
        }
    }

    /** 不自然消失。{@code setPersistenceRequired()} 已经够，这里是双保险。 */
    @Override
    public boolean removeWhenFarAway(double distance) {
        return false;
    }

    // ---------------------------------------------------------------- 交易
    /**
     * 右键交互 —— **必须自己实现**。
     *
     * <p>踩到的坑：{@code AbstractVillager} **没有**覆写 {@code mobInteract}
     * （WanderingTrader 和 Villager 各自实现了一份）。只继承它的话，
     * 右键老柯**什么都不会发生** —— 没有交易界面、没有报错、日志里也没有一行。
     * 反过来说，如果照抄"AbstractVillager 自带交易交互"的想当然写法，
     * 就会得到一个"看起来装好了、实际点不动"的 NPC。已从
     * {@code sourcesAndCompiledWithNeoForge_*.jar} 里读源码确认过。
     *
     * <p>下面这段的结构照抄 {@code WanderingTrader.mobInteract}，但有两处**故意不同**：
     * <ol>
     *   <li>原版判的是 {@code itemstack.is(Items.VILLAGER_SPAWN_EGG)}（只认村民蛋）。
     *       我们的蛋是 {@code DeferredSpawnEggItem}，那样判永远为 false。
     *       改成 {@code instanceof SpawnEggItem} 才是本意：**手持任何刷怪蛋时
     *       右键 = 放一只新的，而不是开交易界面**。</li>
     *   <li>商品为空时原版直接 {@code return CONSUME}（什么都不发生）。
     *       我们现在商品表本来就是空的（M5 才做），照抄的话根本没法验证
     *       "交互接上了没有"。所以先给一句可见的回应 —— 这是唯一能区分
     *       "NPC 通了但没货"和"根本没接上"的手段。</li>
     * </ol>
     *
     * <p><b>⚠ 那句台词必须做冷却</b>：客户端按住右键时
     * {@code Minecraft.startUseItem()} 每 4 tick 就会再触发一次交互
     * （它把 {@code rightClickDelay} 重置成 4，并不是"按下才算一次"）。
     * 所以不设冷却的话，按住两秒就能刷出 7 行一模一样的台词 —— 实际截图就是这样。
     * 原版村民不会刷屏，是因为它们第二次进来时 {@code isTrading()} 已经为真、
     * 直接 PASS 掉了；我们没有交易界面可以"占住"这个状态，只能自己记冷却。
     *
     * <p>冷却记在**实体**上而不是物品上：物品冷却（{@code player.getCooldowns()}）
     * 是按物品算的，玩家换个手/换个格子就能绕过。
     *
     * <p><b>台词是一批、轮流说</b>，见 {@link #LINES} 与 {@link #pickLine()} ——
     * 第一版只有一句，用户当场指出"这 NPC 只有这一句话"，那等于一块告示牌。
     *
     * <p><b>{@code getOffers()} 绝不能在客户端调。</b>{@code AbstractVillager} 的实现是
     * {@code if (level().isClientSide) throw new IllegalStateException("Cannot load Villager
     * offers on the client")} —— 它不是返回空表，是**直接抛异常**。所以下面所有
     * 取商品的代码都在 {@code !level().isClientSide} 分支里。
     */
    /**
     * 老柯会说的话（轮流说，见 {@link #pickLine()}）。
     *
     * <p><b>为什么是一批而不是一句</b>：第一版只在商品为空时回一句
     * "竿子先支好，货我还没备齐……"。用户的反馈很直接 ——
     * 反复右键同一个人，他永远回同一句话，NPC 立刻就"死"了。
     * 台词量是"这是个活人还是个告示牌"的分界线，不是锦上添花。
     *
     * <p>内容分两类混在一起：
     * <ul>
     *   <li><b>风味</b>：老渔夫的口气（守了四十年河、鱼认得他）。</li>
     *   <li><b>指路</b>：把玩家往玩法上推 —— 尤其第 4 句直接教追踪罗盘的配方，
     *       因为"屋子难找"正是用户提的下一个问题，两件事在这里合流。</li>
     * </ul>
     * 顺序是**故意排的**：先抱怨没货（承接"商品表还没做"这个现状），
     * 再自报家门，然后给一条最有用的提示，最后才是闲话。
     */
    private static final String[] LINES = {
            "竿子先支好，货我还没备齐……",
            "这条河我守了四十年，鱼比我孙子还认得我。",
            "想找我家？拿条鱼配个指南针，它就认路了。",
            "天亮我在码头，天黑我就回屋了。",
            "打窝要挑地方，别对着水面乱撒。",
            "大鱼不吃死饵，你得让它动起来。",
            "别急着收线，先让它挣扎累了。",
            "钓不上来不一定是运气差，也可能是线太粗。",
            "你手上那根竿，是哪家的木头？",
            "年轻人，急什么。水底下的事，快不来。",
    };

    /** 上一次开口的 tick；-1 表示还没说过。 */
    private int lastHintTick = -1;
    /** 上次是对谁说的 —— 换个人来搭话应该立刻有回应，不该被别人的冷却挡住。 */
    private UUID lastHintPlayer = null;
    /** 下一句要说的台词下标；-1 表示还没定起点。 */
    private int nextLine = -1;
    /**
     * 两次开口之间的最短间隔（tick）。1 秒。
     *
     * <p>为什么必须有：客户端按住右键时 {@code Minecraft.startUseItem()}
     * 每 4 tick 就会再触发一次交互（它把 {@code rightClickDelay} 重置成 4，
     * 不是"按下才算一次"）。没有这个闸门，按住两秒就会刷出 7 行。
     * 原版村民不刷屏，是因为第二次进来时 {@code isTrading()} 已经为真、
     * 直接 PASS 掉了；我们没有交易界面可以"占住"这个状态，只能自己记。
     *
     * <p>定 20 tick 而不是更长：**要有节奏地点击就能一句一句听下去** ——
     * 台词量才是重点，冷却太长反而挡着人听。
     *
     * <p>冷却记在**实体**上而不是用物品冷却：物品冷却按物品算，
     * 换个手/换个格子就能绕过。
     */
    private static final int HINT_COOLDOWN = 20;

    /**
     * 取下一句台词的下标 —— **轮流**而不是随机。
     *
     * <p>随机的问题：连着三次抽到同一句，玩家的感受和"只有一句话"完全一样
     * （生日悖论，10 句里连抽 3 次撞上同一句的概率并不低）。
     * 轮流能保证每一句都会被听到。
     *
     * <p>起点随机，是为了两只老柯（多个小屋）不会一字不差地同步开口。
     */
    private int pickLine() {
        if (nextLine < 0) {
            nextLine = this.random.nextInt(LINES.length);
        }
        int idx = nextLine;
        nextLine = (nextLine + 1) % LINES.length;
        return idx;
    }

    @Override
    protected InteractionResult mobInteract(Player player, InteractionHand hand) {
        ItemStack held = player.getItemInHand(hand);
        if (held.getItem() instanceof SpawnEggItem || !this.isAlive()
                || this.isTrading() || this.isBaby()) {
            return super.mobInteract(player, hand);
        }
        if (hand == InteractionHand.MAIN_HAND) {
            player.awardStat(Stats.TALKED_TO_VILLAGER);
        }
        if (!this.level().isClientSide) {
            // ---- 潜行右键 = 打开**委托面板**（2026-10-14，策划 `docs/40` §9）----
            // ⚠ 故意**不动普通右键**：那一路是用户定案过的"说过话之后右键开商店"，
            //   改它等于改玩法；潜行这一路是纯新增的命令，摘掉也不影响任何既有行为 ✓
            //   （另外两个入口：邮件里的【接下委托】、指令 `/atl quest`）
            if (player instanceof net.minecraft.server.level.ServerPlayer spy && player.isShiftKeyDown()) {
                com.whitecobalt.anglertackle.network.ModNetwork.syncQuests(spy, "");
                return InteractionResult.CONSUME;
            }

            // ---- 第一次说话：送两根木竿 + 开店 ----
            // 用户定案："白找老柯第一次对话完免费给一根台钓一根路亚"，
            // 并且"第一次对话结束后开启右键点开钓鱼商店功能"。
            // onFirstTalk 自己是幂等的，所以这里不用再判一次。
            if (player instanceof net.minecraft.server.level.ServerPlayer sp
                    && !com.whitecobalt.anglertackle.player.FishermanData.shopOpen(sp)) {
                com.whitecobalt.anglertackle.shop.ShopManager.onFirstTalk(sp);
            }

            // ---- 说过话之后：右键直接开商店 ----
            // 在商品表还是空的（M5 还没做交易表）之前，这是商店唯一的人口。
            if (player instanceof net.minecraft.server.level.ServerPlayer sp2
                    && com.whitecobalt.anglertackle.player.FishermanData.shopOpen(sp2)) {
                if (this.tickCount - lastHintTick >= HINT_COOLDOWN
                        || !player.getUUID().equals(lastHintPlayer)) {
                    lastHintTick = this.tickCount;
                    lastHintPlayer = player.getUUID();
                    com.whitecobalt.anglertackle.shop.ShopManager.open(sp2);
                }
                return InteractionResult.CONSUME;
            }

            if (this.getOffers().isEmpty()) {
                // 冷却：按住右键时客户端每 4 tick 就会再触发一次交互，
                // 不挡的话会刷满整个聊天框（见 HINT_COOLDOWN 的注释）。
                if (this.tickCount - lastHintTick >= HINT_COOLDOWN
                        || !player.getUUID().equals(lastHintPlayer)) {
                    lastHintTick = this.tickCount;
                    lastHintPlayer = player.getUUID();
                    // 说话时带上**自己的显示名**，而不是把"老柯："写死在语言键里 ——
                    // 这样用命名牌改过名字之后，聊天栏里出现的也是新名字。
                    player.displayClientMessage(
                            Component.literal("")
                                    .append(this.getDisplayName())
                                    .append(Component.literal("："))
                                    .append(Component.translatable(
                                            "msg.anglertackle.fisherman.line." + pickLine())),
                            false);
                }
                return InteractionResult.CONSUME;
            }
            this.setTradingPlayer(player);
            this.openTradingScreen(player, this.getDisplayName(), 1);
        }
        return InteractionResult.sidedSuccess(this.level().isClientSide);
    }

    /**
     * 交易表 —— **暂空**。
     *
     * <p>{@code AbstractVillager} 把它声明成 abstract，不实现编译不过。
     * 真正的商品表（随钓鱼等级解锁）在 M5 商店阶段接。
     *
     * <p>调用时机：{@code AbstractVillager.getOffers()} 在**第一次**被调用时
     * 先建空表再回调这里（{@code offers = new MerchantOffers(); updateTrades();}）——
     * 注意赋值在回调**之前**，所以下面这行 {@code this.getOffers()} 不会递归。
     * 这个顺序是读源码确认的，不是猜的；将来如果改成"先 updateTrades 再赋值"，
     * 这里会栈溢出。
     */
    @Override
    protected void updateTrades() {
        MerchantOffers offers = this.getOffers();
        offers.clear();
    }

    /**
     * 交易经验 —— **故意留空**。
     *
     * <p>原版村民靠它升级解锁新商品。老柯的商品按**玩家的钓鱼等级**解锁
     * （策划案 §2.1），和他自己做了多少笔生意无关，所以这里什么都不做。
     * 但也**不能删**：它是 {@code AbstractVillager} 的 abstract 方法之一。
     */
    @Override
    protected void rewardTradeXp(MerchantOffer offer) {
        // 故意留空，见方法注释
    }

    // ---------------------------------------------------------------- 家
    public void setHome(BlockPos pos) {
        this.home = pos;
    }

    public BlockPos getHome() {
        return home;
    }

    // ---------------------------------------------------------------- 存档
    @Override
    public void addAdditionalSaveData(CompoundTag tag) {
        super.addAdditionalSaveData(tag);
        if (home != null) {
            tag.putLong("AtlHome", home.asLong());
        }
    }

    @Override
    public void readAdditionalSaveData(CompoundTag tag) {
        super.readAdditionalSaveData(tag);
        if (tag.contains("AtlHome")) {
            home = BlockPos.of(tag.getLong("AtlHome"));
        }
    }

    // ---------------------------------------------------------------- 杂项
    /** 不繁殖 —— 这是剧情 NPC，不是村民。 */
    @Override
    public AgeableMob getBreedOffspring(ServerLevel level, AgeableMob partner) {
        return null;
    }

    @Override
    protected SoundEvent getAmbientSound() {
        return SoundEvents.VILLAGER_AMBIENT;
    }

    @Override
    protected SoundEvent getHurtSound(DamageSource source) {
        return SoundEvents.VILLAGER_HURT;
    }

    @Override
    protected SoundEvent getDeathSound() {
        return SoundEvents.VILLAGER_DEATH;
    }
}
