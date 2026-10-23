package com.whitecobalt.anglertackle.effect;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.Environment;
import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.network.ModNetwork;
import com.whitecobalt.anglertackle.network.OreSightPayload;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.common.NeoForgeMod;
import net.neoforged.neoforge.common.Tags;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;
import net.neoforged.neoforge.event.tick.PlayerTickEvent;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.ToDoubleFunction;

/**
 * 11 个菜型效果的**行为**（策划：docs/28-菜型效果策划.md §3，用户 2026-10-03 定案）。
 *
 * <p>{@link DishEffects} 管"吃菜给哪个效果、几级、多久"；这个类管"效果拿到之后到底做了什么"。
 * 两边共用同一份数值口径：**这里的常量就是唯一真源**，docs/28 §3 的表格必须与它们一致
 * （tools/check-dish-effect-hooks.js 逐条比对）。
 *
 * <h2>为什么用 {@code @SubscribeEvent} + 每 tick 轮询，而不是给 MobEffect 挂属性修饰符</h2>
 * 原版给效果挂属性是 {@code MobEffect#addAttributeModifiers} / {@code applyEffectTick}，
 * 但本 mod 的十一个效果里有六个的生效条件是**动态**的 —— 海洋亲和看"在不在水里"、
 * 风暴行者看"下没下雨"、两栖看"在不在陆地"、明目看"附近有没有矿"。属性修饰符一旦挂上就
 * 只在效果开始/结束时增删，中途条件变化**不会重算**（原版的水下呼吸就是这么写的，
 * 它不依赖条件）。所以这里改成集中在一处、每 tick 重算一次"现在该不该有"，
 * 用**瞬态修饰符**（{@code addTransientModifier}，不存档）表达"现在有"。
 * 好处是条件一变下一 tick 就同步，坏处是要自己保证幂等 —— 见 {@link #setModifier}。
 *
 * <h2>数值口径（全部来自用户定案，见 docs/28 §3）</h2>
 * <ul>
 *   <li><b>渔运</b>：金红总爆率 **+3 个百分点/级**（绝对提升，不是相对）</li>
 *   <li><b>强力</b>：远程武器伤害 **+15%/级</b></li>
 *   <li><b>海洋亲和</b>：水下移动速度 **+25%/级</b></li>
 *   <li><b>风暴行者</b>：下雨时攻击伤害 **+20%/级**、移动速度 **+25%/级**</li>
 *   <li><b>干旱耐受</b>：任何时候都算"下雨"（含风暴行者、含鱼池的天气维）</li>
 *   <li><b>如鱼得水</b>：自然回血速度 **+25%/级</b></li>
 *   <li><b>爆口 / 空军</b>：抽鱼时 &gt;5 kg / ≤5 kg 的鱼总权重 **+5%/级</b>（互斥）</li>
 *   <li><b>巨物猎手</b>：金档以上咬钩后回拉速度 **+20%/级</b></li>
 * </ul>
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class DishEffectHooks {

    private DishEffectHooks() {
    }

    // ------------------------------------------------------------------ 数值口径

    /** 渔运：每级给金红总爆率多少**个百分点**（绝对值，直接加在占比目标上）。 */
    public static final double LUCK_POINTS_PER_LEVEL = 3.0;

    /** 强力：远程武器伤害加成（每级）。 */
    public static final double RANGED_DAMAGE_PER_LEVEL = 0.15;

    /** 海洋亲和：水下移动速度加成（每级）。 */
    public static final double OCEAN_SPEED_PER_LEVEL = 0.25;

    /** 风暴行者：下雨时的攻击伤害加成（每级）。 */
    public static final double STORM_DAMAGE_PER_LEVEL = 0.20;

    /** 风暴行者：下雨时的移动速度加成（每级）。 */
    public static final double STORM_SPEED_PER_LEVEL = 0.25;

    /** 如鱼得水：自然回血速度加成（每级）。 */
    public static final double VITALITY_REGEN_PER_LEVEL = 0.25;

    /** 爆口 / 空军：受影响鱼种的总权重加成（每级）。 */
    public static final double BITE_WEIGHT_PER_LEVEL = 0.05;

    /** 爆口 / 空军的门槛（kg，用户："那就降到5公斤"）。 */
    public static final double BITE_THRESHOLD_KG = 5.0;

    /** 巨物猎手：回拉速度加成（每级）。 */
    public static final double GIANT_PULL_PER_LEVEL = 0.20;

    /** 巨物猎手认的"巨物"下限：金档（4）。金/红都算，紫及以下不算。 */
    public static final int GIANT_MIN_TIER = 4;

    /**
     * 两栖把"深海探索者"搬到陆地上的等效倍率（⚙️ 推导值，唯一可调旋钮）。
     *
     * <p>原版水里（{@code LivingEntity#travel}）：水平分量每 tick 乘
     * {@code f4 = 0.8}（水中惯性）；穿满级深海探索者（WATER_MOVEMENT_EFFICIENCY = 1.0）后
     * {@code f4 = 0.8 + (0.54600006 - 0.8) * 1.0 = 0.546}，即相对速度 ×0.6825。
     * 两栖在陆地上就按**同一比例**给 MOVEMENT_SPEED 加成，于是"水里多快、陆上就多快"。
     */
    public static final double DEPTH_STRIDER_LAND_FACTOR = 0.6825;

    /** 明目：扫描半径（格，⚙️ 我定；用户只要求"用线条指引最近的矿物方块"）。 */
    public static final int ORE_SIGHT_RADIUS = 16;

    /** 明目：多少 tick 画一次指引线 —— 现在只是**心跳**（客户端 60 tick 收不到就撤线）。 */
    public static final int ORE_SIGHT_LINE_PERIOD = 20;

    /** 明目：有目标时多久重扫一次（错开相位）。 */
    public static final int ORE_SIGHT_SWEEP_PERIOD = 20;

    /**
     * 明目：一次都没扫到矿时退到多久再扫（地表就是这种情况，每次都白扫满额）。
     *
     * <p>注意这只影响**扫描**频率，不影响心跳：没目标时本来也没有线要维持。
     */
    public static final int ORE_SIGHT_IDLE_SWEEP_PERIOD = 60;

    /** 明目：换目标的门槛（格）—— 新目标要近这么多以上才改指它（滞回，见 {@link #pickTarget}）。 */
    public static final double ORE_SIGHT_SWITCH_MARGIN = 3.0;

    /** 明目：换目标的另一个门槛（比例）—— 或者距离缩短到这个倍数以下。 */
    public static final double ORE_SIGHT_SWITCH_RATIO = 0.75;

    /** 两栖在陆地上补的潮涌能量时长（tick）；快到期时刷新，所以不会闪断。 */
    private static final int AMPHIBIOUS_CONDUIT_TICKS = 20 * 15;

    /** 自然回血的原版节奏：80 tick 回 1 点（{@code FoodData#tick}）。 */
    private static final int NATURAL_REGEN_TICKS = 80;

    // ------------------------------------------------------------------ 修饰符 id

    private static final Identifier OCEAN_SPEED_ID =
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "dish_ocean_affinity_speed");
    /** 水中的那一条（见 {@link #tickMovementEffects} 里为什么海洋亲和必须走 SWIM_SPEED）。 */
    private static final Identifier OCEAN_SWIM_ID =
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "dish_ocean_affinity_swim");
    private static final Identifier STORM_SPEED_ID =
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "dish_storm_walker_speed");
    private static final Identifier AMPHIBIOUS_SPEED_ID =
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "dish_amphibious_land_speed");

    // ------------------------------------------------------------------ 查询入口（给钓鱼链读）

    /** 玩家身上某个效果的实际等级（1 起算；没有该效果 = 0）。 */
    public static int level(LivingEntity entity, Holder<MobEffect> effect) {
        MobEffectInstance inst = entity.getEffect(effect);
        return inst == null ? 0 : inst.getAmplifier() + 1;
    }

    /**
     * 现在能不能吃到"下雨带来的加成"。
     *
     * <p>两个来源：真的在下雨（{@code Level#isRainingAt} —— 只认**露天**的雨），
     * 或者持有**干旱耐受**（用户定案："任何时候都享受下雨带来的加成（含风暴行者）"）。
     *
     * <p>这是本 mod 里"雨天加成"的**唯一漏斗**：风暴行者的伤害/速度、
     * 以及鱼池的天气维（见 {@link #applyDroughtTolerance}）都走它。
     */
    public static boolean rainBonusActive(LivingEntity entity) {
        if (level(entity, ModEffects.DROUGHT_TOLERANCE) > 0) {
            return true;        // 干旱耐受：无视天气
        }
        return entity.level().isRainingAt(entity.blockPosition());
    }

    /**
     * 干旱耐受对**鱼池**的作用：把天气钉成"降雨"。
     *
     * <p>本 mod 里"下雨带来的加成"在钓鱼侧就是环境天气维（雨天活跃的鱼组 +10 个百分点，
     * 见 docs/24）。持有干旱耐受 = 任何时候都吃这一项，所以这里复制一份快照、只改天气字段。
     *
     * @param env 真实采样到的环境（可能为 null = 未取样）
     * @return 喂给 {@code FishSpecies.roll} 的环境；没变就原样返回（同一实例）
     */
    public static Environment applyDroughtTolerance(Player player, Environment env) {
        if (env == null || env.weather() != Environment.CLEAR) {
            return env;
        }
        if (level(player, ModEffects.DROUGHT_TOLERANCE) <= 0) {
            return env;
        }
        // 雷暴在 Environment 里是独立一档（比降雨更强），这里给的是**降雨**这一档：
        // 效果承诺的是"下雨的加成"，不是"雷暴的加成"。
        return new Environment(env.timeSlot(), Environment.RAIN, env.moonPhase());
    }

    /**
     * 这一竿的钓获类加成（渔运 / 爆口 / 空军），打包给 {@code FishSpecies.roll}。
     *
     * <p>返回 {@link FishSpecies.RollBonus#NONE} 时抽签路径与"没有这些效果"逐字节相同。
     */
    public static FishSpecies.RollBonus rollBonus(Player player) {
        double luck = LUCK_POINTS_PER_LEVEL * level(player, ModEffects.FISHING_LUCK);
        int big = level(player, ModEffects.BIG_BITE);
        int small = level(player, ModEffects.SMALL_FRY);
        if (luck <= 0.0 && big <= 0 && small <= 0) {
            return FishSpecies.RollBonus.NONE;
        }
        // 等级在这里**先读一次**钉死：抽签时每条鱼都要问一次权重倍率，
        // 而效果可能在抽签过程中到期（read → 变了 → 同一次抽签里两种倍率）。
        final int fBig = big;
        final int fSmall = small;
        ToDoubleFunction<FishSpecies> speciesWeight = (big <= 0 && small <= 0)
                ? null
                : (s) -> speciesWeightMultiplier(s, fBig, fSmall);
        return new FishSpecies.RollBonus(luck, speciesWeight);
    }

    /**
     * 钓获类加成的人话描述（只给日志用；一次抛投一行，不是每 tick）。
     *
     * <p>没有效果时返回空串 —— 调用方据此决定要不要打日志。
     */
    public static String describeRollBonus(Player player) {
        int luck = level(player, ModEffects.FISHING_LUCK);
        int big = level(player, ModEffects.BIG_BITE);
        int small = level(player, ModEffects.SMALL_FRY);
        StringBuilder sb = new StringBuilder();
        if (luck > 0) {
            sb.append(String.format("渔运 %d 级（金红总爆率 +%.1f 个百分点）",
                    luck, LUCK_POINTS_PER_LEVEL * luck));
        }
        if (big > 0) {
            if (!sb.isEmpty()) {
                sb.append(" + ");
            }
            sb.append(String.format("爆口 %d 级（>%.0f kg 的鱼种权重 ×%.2f）",
                    big, BITE_THRESHOLD_KG, 1.0 + BITE_WEIGHT_PER_LEVEL * big));
        }
        if (small > 0) {
            if (!sb.isEmpty()) {
                sb.append(" + ");
            }
            sb.append(String.format("空军 %d 级（≤%.0f kg 的鱼种权重 ×%.2f）",
                    small, BITE_THRESHOLD_KG, 1.0 + BITE_WEIGHT_PER_LEVEL * small));
        }
        return sb.toString();
    }

    /**
     * 爆口 / 空军对**某一条鱼**的权重倍率。
     *
     * <p>归类用**区间中值**（用户 2026-10-03 定案 + docs/28 §3.1）：
     * 一条鱼的体重区间中值 &gt; 5 kg → 归爆口；≤ 5 kg → 归空军。
     * 每条鱼恰好落进一边，不会出现"两头都不加成"的死区。
     * （若按"区间不跨 5 kg"判，爆口只剩 3 条鱼 —— 那条路已被排除。）
     */
    public static double speciesWeightMultiplier(FishSpecies species, int bigLevel, int smallLevel) {
        return isBigFish(species)
                ? 1.0 + BITE_WEIGHT_PER_LEVEL * Math.max(0, bigLevel)
                : 1.0 + BITE_WEIGHT_PER_LEVEL * Math.max(0, smallLevel);
    }

    /** 这条鱼算不算"大鱼"（区间中值 &gt; {@link #BITE_THRESHOLD_KG}）。 */
    public static boolean isBigFish(FishSpecies species) {
        return (species.kgMin() + species.kgMax()) / 2.0 > BITE_THRESHOLD_KG;
    }

    /**
     * 巨物猎手：这条鱼上钩后玩家的回拉速度倍率。
     *
     * @param hookedTier 已咬钩那条鱼的**真实档位**（0…5）
     */
    public static double giantPullMultiplier(Player player, int hookedTier) {
        if (hookedTier < GIANT_MIN_TIER) {
            return 1.0;
        }
        return 1.0 + GIANT_PULL_PER_LEVEL * level(player, ModEffects.GIANT_HUNTER);
    }

    // ------------------------------------------------------------------ 战斗：强力 / 风暴行者

    /**
     * 攻击伤害加成：**强力**（远程武器）与**风暴行者**（雨天全伤害）。
     *
     * <p>挂在 {@link LivingIncomingDamageEvent}（挨打方）上，从伤害来源反查攻击者 ——
     * 这是 NeoForge 给"攻击者加成"的标准位置：它在原版把伤害送进减伤/护甲之前触发，
     * 所以加成会正常参与后面的护甲、抗性计算（写在 {@code LivingHurtEvent} 里就会变成
     * "先减甲再乘"，跟原版的锋利/力量不是一套算法）。
     *
     * <p>判定口径：
     * <ul>
     *   <li>强力只认**弹射物**（{@code getDirectEntity() instanceof Projectile}）——
     *       用户写的是"远程武器 +15%"，近战不该吃。{@code getEntity()} 是"责任方"，
     *       箭矢的 owner 就是射手，所以用它取玩家。</li>
     *   <li>风暴行者任何伤害都吃（近战、远程、哪怕是摔死别人 —— 只要是玩家造成的），
     *       前提是{@link #rainBonusActive 雨天加成成立}。</li>
     * </ul>
     */
    @SubscribeEvent
    public static void onIncomingDamage(LivingIncomingDamageEvent event) {
        if (event.getEntity().level().isClientSide()) {
            return;
        }
        DamageSource source = event.getSource();
        if (!(source.getEntity() instanceof Player attacker)) {
            return;
        }
        double mult = 1.0;
        int power = level(attacker, ModEffects.RANGED_POWER);
        if (power > 0 && source.getDirectEntity() instanceof Projectile) {
            mult *= 1.0 + RANGED_DAMAGE_PER_LEVEL * power;
        }
        int storm = level(attacker, ModEffects.STORM_WALKER);
        if (storm > 0 && rainBonusActive(attacker)) {
            mult *= 1.0 + STORM_DAMAGE_PER_LEVEL * storm;
        }
        if (mult != 1.0) {
            event.setAmount((float) (event.getAmount() * mult));
        }
    }

    // ------------------------------------------------------------------ 每 tick：属性 / 回血 / 明目 / 两栖

    /**
     * 玩家每 tick 重算一遍"条件型效果现在该不该生效"。
     *
     * <p>集中在一个事件里而不是散到各处，是为了让**同一 tick 内的判断互相一致**：
     * 海洋亲和（在水里）与两栖（在陆地）用的是同一次 {@code isInWater()}，
     * 属性修饰符不会出现"上一 tick 的残留"。
     */
    @SubscribeEvent
    public static void onPlayerTick(PlayerTickEvent.Post event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) {
            return;
        }
        tickMovementEffects(player);
        tickVitality(player);
        tickOreSight(player);
    }

    /** 海洋亲和（水下速度）/ 风暴行者（雨天速度）/ 两栖（陆上补偿 + 潮涌能量）。 */
    private static void tickMovementEffects(ServerPlayer player) {
        boolean inWater = player.isInWater();
        int amphibious = level(player, ModEffects.AMPHIBIOUS);

        // ---- 海洋亲和：在水里 +25%/级。两栖把"在水里"这个前置去掉（用户定案）----
        //
        // ⚠ 2026-10-03 用户实测报错："能看到因为速度变化导致的视野缩放，但实际移速不会变化"。
        //   原因在 {@code LivingEntity#travel} 的水中分支里：它压根**不读 MOVEMENT_SPEED** ——
        //     ① 加速度 `f5` 的基量是写死的 0.02，只有 WATER_MOVEMENT_EFFICIENCY > 0 时
        //        才会被 `f5 += (getSpeed() - f5) * f6` 拉向 MOVEMENT_SPEED；
        //     ② 惯性 `f4` 由 0.8 起算，海豚的恩惠直接 `f4 = 0.96`（这就是"它真的能加速"的原因）。
        //   于是往 MOVEMENT_SPEED 上加修饰符只会改**客户端 FOV**（视野缩放由它算），
        //   移速一点不动 —— 正是用户看到的现象。
        //   正确做法参考海豚的恩惠：改**水中**的那两个量。NeoForge 把这件事做成了属性
        //   {@code NeoForgeMod.SWIM_SPEED}（默认 1.0，原版那句 `f5 *= SWIM_SPEED`），
        //   它**只在水中分支被读**、上限 1024%，正好够 +25%/级 一直堆到 V。
        int affinity = level(player, ModEffects.OCEAN_AFFINITY);
        setModifier(player, NeoForgeMod.SWIM_SPEED, OCEAN_SWIM_ID,
                (affinity > 0 && inWater) ? OCEAN_SPEED_PER_LEVEL * affinity : 0.0);
        // 陆地上 SWIM_SPEED 没人读，所以"两栖让海洋亲和在水外也生效"这一半只能走
        // MOVEMENT_SPEED —— 陆地的 travel 分支读它（getFrictionInfluencedSpeed）。
        setModifier(player, Attributes.MOVEMENT_SPEED, OCEAN_SPEED_ID,
                (affinity > 0 && !inWater && amphibious > 0) ? OCEAN_SPEED_PER_LEVEL * affinity : 0.0);

        // ---- 风暴行者：雨天（或干旱耐受）+25%/级 ----
        // 走 MOVEMENT_SPEED：它是"陆上跑得快"，而陆地分支读的正是这个属性（水中加成归海洋亲和）。
        int storm = level(player, ModEffects.STORM_WALKER);
        double stormAmount = (storm > 0 && rainBonusActive(player))
                ? STORM_SPEED_PER_LEVEL * storm : 0.0;
        setModifier(player, Attributes.MOVEMENT_SPEED, STORM_SPEED_ID, stormAmount);

        // ---- 两栖：把"深海探索者"搬到陆地 + 补潮涌能量 ----
        if (amphibious > 0) {
            double efficiency = player.getAttributeValue(Attributes.WATER_MOVEMENT_EFFICIENCY);
            // 在水里原版自己会算 WRM，这里只在陆地上补等效的那一份（不然水里会双倍）
            setModifier(player, Attributes.MOVEMENT_SPEED, AMPHIBIOUS_SPEED_ID,
                    inWater ? 0.0 : DEPTH_STRIDER_LAND_FACTOR * efficiency);
            grantConduitPower(player, inWater);
        } else {
            setModifier(player, Attributes.MOVEMENT_SPEED, AMPHIBIOUS_SPEED_ID, 0.0);
        }
    }

    /**
     * 两栖的"潮涌能量"部分。
     *
     * <p>原版只在**在水里或淋雨**时由潮涌核心发放潮涌能量
     * （{@code ConduitBlockEntity} 里硬编码 {@code player.isInWaterOrRain()}，
     * NeoForge 没给这个条件留事件，所以没法从核心那一侧改）。而潮涌能量这个**效果本身**
     * 一点水下限制都没有 —— {@code MobEffectUtil} 只读 {@code hasEffect(CONDUIT_POWER)}
     * 就发急迫与水下呼吸。所以两栖直接把它发给持有者就行，不需要碰原版。
     *
     * <p>⚠ 简化（⚙️）：这里不校验"附近有没有潮涌核心"，只要持有两栖就给。
     * 用户要的语义是"忽略前置条件强制生效水下效果"，核心那一层属于"前置"的一部分。
     */
    private static void grantConduitPower(ServerPlayer player, boolean inWater) {
        if (inWater) {
            return;     // 在水里本来就有渠道拿到（有核心时），别叠一份更长的
        }
        MobEffectInstance cur = player.getEffect(MobEffects.CONDUIT_POWER);
        if (cur != null && cur.getDuration() > 20 * 5) {
            return;     // 还早，不重复发（避免每 tick 一次 addEffect 的包与日志）
        }
        player.addEffect(new MobEffectInstance(MobEffects.CONDUIT_POWER,
                AMPHIBIOUS_CONDUIT_TICKS, 0, true, false));
    }

    /**
     * 如鱼得水：自然回血速度 +25%/级。
     *
     * <p>做法是**在自然回血成立的那些 tick 上补一份额外治疗**，而不是加快原版的
     * {@code FoodData.tickTimer}（那是私有的，改它属于字节级 hack）。
     * 每 {@value #NATURAL_REGEN_TICKS} tick（原版回 1 点的节奏）补 {@code 0.25×等级} 点，
     * 并**照原版规矩收饥饿代价**（1 点血 6 点消耗度），所以它不是白送的血 —— 饱食度照吃。
     */
    private static void tickVitality(ServerPlayer player) {
        int vitality = level(player, ModEffects.VITALITY);
        if (vitality <= 0 || player.tickCount % NATURAL_REGEN_TICKS != 0) {
            return;
        }
        if (!player.isHurt() || player.getFoodData().getFoodLevel() < 18) {
            return;     // 原版自然回血的两个前置：掉了血 + 饱食度 ≥ 18
        }
        float heal = (float) (VITALITY_REGEN_PER_LEVEL * vitality);
        player.heal(heal);
        player.getFoodData().addExhaustion(6.0F * heal);
    }

    // ------------------------------------------------------------------ 明目：线条指引最近的矿物

    /** 明目扫描的状态（每人一份；没有该效果时会被清掉，不会攒垃圾）。 */
    private static final Map<UUID, OreScan> ORE_SCANS = new HashMap<>();

    private static final class OreScan {
        /** 当前指的那块矿物（**跨扫描保留**，见 {@link #pickTarget}）。 */
        private BlockPos target;
        /** 上一次发给客户端的目标（没变就不重发）。 */
        private BlockPos sent;
        /** 下一次全量扫描的 tick（错开相位，且没扫到东西时退避）。 */
        private int nextSweepTick;
    }

    /**
     * 明目：每 {@value #ORE_SIGHT_SWEEP_PERIOD} tick **一次扫完整个立方体**，取**全局最近**的
     * 那一块矿物，把坐标发给这个玩家自己。
     *
     * <h2>⚠ 为什么不能"每 tick 扫一层，攒出一轮"（2026-10-03 用户实测："指引线乱跳，
     * 疑似指向多目标但不是最近的"）</h2>
     * 第一版是分层轮扫：每 tick 扫一层、每 33 tick 扫完一轮，**每轮开头把"最近的矿"清零**重新攒。
     * 那个"最近"其实只是**本轮已扫过的那几层里**最近的 ——
     * <ul>
     *   <li>扫到第 3 层时手里只有"底部 3 层里最近的一块"，可能比你脚边那块远 10 格；</li>
     *   <li>扫到第 20 层时又换成另一块；每轮重新开始时还会先变成"没有目标"再亮起来。</li>
     * </ul>
     * 结果就是线每 1.65 秒跳好几次，而且经常指的不是最近那块。**挤牙膏式的扫描算不出全局最近**，
     * 所以现在改成整块一次扫完（成本见下），并且目标**带滞回**。
     *
     * <h2>成本</h2>
     * 满扫是 33×33×33 = 3.6 万次方块查询，但有三道闸：
     * <ol>
     *   <li><b>按距离剪枝</b>：按 |dy| 从近到远扫层，一旦"层偏移"本身已经超过当前最优距离就直接停；
     *       层内也只扫 {@code lim = √(best² − dy²)} 的窗口。手边有矿时通常几千次就结束。</li>
     *   <li><b>节流 + 错开相位</b>：{@value #ORE_SIGHT_SWEEP_PERIOD} tick 才扫一次，
     *       相位按实体 id 错开，多人同时有这个效果也不会撞在同一 tick。</li>
     *   <li><b>没矿时退避</b>：一次都没扫到（比如在地表）就退到
     *       {@value #ORE_SIGHT_IDLE_SWEEP_PERIOD} tick 再扫 —— 那种情况下每次都白扫满额。</li>
     * </ol>
     * 扫描用 {@code MutableBlockPos} 复用坐标对象，不产生垃圾。
     *
     * <h2>发包</h2>
     * 目标变了就发、另外每 {@value #ORE_SIGHT_LINE_PERIOD} tick 补一个心跳
     * （客户端 60 tick 收不到就丢弃，效果到期时也不会留下一条永久的线）。
     */
    private static void tickOreSight(ServerPlayer player) {
        UUID id = player.getUUID();
        if (level(player, ModEffects.ORE_SIGHT) <= 0) {
            OreScan gone = ORE_SCANS.remove(id);     // 效果没了就清进度，避免长期占内存
            if (gone != null) {
                // 通知客户端把线撤掉（只发这一次，不是每 tick）
                ModNetwork.sendTo(player, OreSightPayload.none());
            }
            return;
        }
        ServerLevel level = player.level();
        OreScan scan = ORE_SCANS.computeIfAbsent(id, (k) -> new OreScan());
        // 以**眼睛所在的方块**为原点：玩家长按 F5 看的是眼前，脚下方块会差一格多
        BlockPos origin = BlockPos.containing(player.getEyePosition());

        // ① 现在的目标还有效吗（被挖掉 / 区块卸载 / 走远了）—— 失效才丢，不每轮重选
        if (scan.target != null && !isValidTarget(level, scan.target, origin)) {
            scan.target = null;
        }

        // ② 到点重扫一次
        if (player.tickCount >= scan.nextSweepTick) {
            BlockPos best = nearestOre(level, origin);
            scan.target = pickTarget(scan.target, best, origin);
            int period = best == null ? ORE_SIGHT_IDLE_SWEEP_PERIOD : ORE_SIGHT_SWEEP_PERIOD;
            scan.nextSweepTick = player.tickCount + period + player.getId() % 7;
        }

        // ③ 目标变了 / 心跳到点 → 发包
        boolean heartbeat = player.tickCount % ORE_SIGHT_LINE_PERIOD == 0;
        if (scan.target == null) {
            if (scan.sent != null) {
                scan.sent = null;
                ModNetwork.sendTo(player, OreSightPayload.none());
            }
        } else if (!scan.target.equals(scan.sent) || heartbeat) {
            scan.sent = scan.target;
            ModNetwork.sendTo(player, new OreSightPayload(scan.target, true));
        }
    }

    /** 目标还值不值得继续指：那块还是矿、区块还在、而且没走太远。 */
    private static boolean isValidTarget(ServerLevel level, BlockPos target, BlockPos origin) {
        if (!level.hasChunkAt(target) || !isOre(level.getBlockState(target))) {
            return false;
        }
        // 允许比扫描半径多走 4 格：走到边缘时左右一晃就换目标，看起来也在"跳"
        int slack = ORE_SIGHT_RADIUS + 4;
        return Math.abs(target.getX() - origin.getX()) <= slack
                && Math.abs(target.getY() - origin.getY()) <= slack
                && Math.abs(target.getZ() - origin.getZ()) <= slack;
    }

    /**
     * 这一次该指哪一块。
     *
     * <p><b>滞回</b>（这次"乱跳"事故的正面修法）：新扫到的矿要**明显更近**才换目标 ——
     * 近 {@value #ORE_SIGHT_SWITCH_MARGIN} 格以上，或者距离缩短到 {@value #ORE_SIGHT_SWITCH_RATIO}
     * 倍以下。否则两块远近差不多的矿会在玩家走动时轮流当"最近"，线就来回抽搐。
     *
     * <p>另外 {@code best == null}（这次没扫到）**不清掉**已有目标：一次扫描落空
     * （比如刚好站到没矿的那一格）不该让线闪一下。
     */
    private static BlockPos pickTarget(BlockPos current, BlockPos best, BlockPos origin) {
        if (best == null) {
            return current;
        }
        if (current == null) {
            return best;
        }
        double cur = current.distSqr(origin);
        double neu = best.distSqr(origin);
        boolean clearlyCloser = neu < cur - ORE_SIGHT_SWITCH_MARGIN * ORE_SIGHT_SWITCH_MARGIN
                || neu < cur * ORE_SIGHT_SWITCH_RATIO * ORE_SIGHT_SWITCH_RATIO;
        return clearlyCloser ? best : current;
    }

    /**
     * 扫一遍以 {@code origin} 为中心、半径 {@value #ORE_SIGHT_RADIUS} 的立方体，
     * 返回**离原点最近**的矿物（没有就 {@code null}）。
     *
     * <p>三道剪枝（都在下面注释里标了）：按 |dy| 由近及远扫层、层内窗口按当前最优距离收紧、
     * 层偏移本身超过最优距离就直接收工。所以"手边就有矿"是最便宜的情况。
     */
    private static BlockPos nearestOre(ServerLevel level, BlockPos origin) {
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        int ox = origin.getX();
        int oy = origin.getY();
        int oz = origin.getZ();
        int bestSq = Integer.MAX_VALUE;
        BlockPos best = null;
        for (int r = 0; r <= ORE_SIGHT_RADIUS; r++) {
            // 剪枝 ③：|dy| 自己就已经超过最优距离 → 更远的层不可能更近
            if (best != null && r * r > bestSq) {
                break;
            }
            for (int sy = (r == 0 ? 0 : -1); sy <= 1; sy += 2) {
                int y = oy + sy * r;
                // 剪枝 ②：层内只可能赢过最优距离的范围
                int lim = best == null ? ORE_SIGHT_RADIUS
                        : (int) Math.floor(Math.sqrt(Math.max(0, bestSq - r * r)));
                for (int dx = -lim; dx <= lim; dx++) {
                    for (int dz = -lim; dz <= lim; dz++) {
                        int sq = dx * dx + r * r + dz * dz;
                        // 剪枝 ①：只找**更近**的。少了这一句就退化成"第一个撞见的矿"，
                        // 那正是"指的不是最近那块"的写法。
                        if (sq >= bestSq) {
                            continue;
                        }
                        p.set(ox + dx, y, oz + dz);
                        if (!level.hasChunkAt(p)) {
                            continue;               // 未加载的区块：跳过。绝不为了扫描去强加载区块
                        }
                        if (!isOre(level.getBlockState(p))) {
                            continue;
                        }
                        bestSq = sq;
                        best = p.immutable();
                    }
                }
                if (r == 0) {
                    break;                          // r=0 只有一层，别扫两遍
                }
            }
        }
        return best;
    }

    /**
     * 这个方块算不算"矿物"。
     *
     * <p>用 NeoForge 的通用标签 {@code #c:ores}（{@code Tags.Blocks.ORES}）而不是原版标签：
     * <b>原版没有"全部矿物"这一个标签</b>（只有按种类的 coal/iron/… 与"哪种石头里的矿"），
     * 而 NeoForge 自己会把原版所有矿石塞进 {@code c:ores}。用它的另一个好处是
     * 别的 mod 的矿石只要进这个通用标签，明目就能一起指。
     */
    private static boolean isOre(BlockState state) {
        return state.is(Tags.Blocks.ORES);
    }

    // ------------------------------------------------------------------ 工具

    /**
     * 把一条瞬态属性修饰符设成 {@code amount}（≤0 = 摘掉）。
     *
     * <p>三条纪律，都是踩过才知道要写的：
     * <ol>
     *   <li><b>幂等</b>：值没变就一个字节都不动 —— 每 tick 无脑 remove/add 会让属性包
     *       每 tick 同步一次（客户端血条/移速会抖），也让 {@code AttributeInstance} 的
     *       dirty 标记永远为真。</li>
     *   <li><b>瞬态</b>：{@code addTransientModifier} 不存档。效果本来就不存档，
     *       修饰符要是被存进玩家 NBT，重进游戏会留下一条永远摘不掉的加速。</li>
     *   <li><b>用 id 找旧的</b>：不靠"猜现在有没有"，而是 {@code getModifier(id)} 查真身，
     *       所以中途被别的 mod 清空过也能自愈。</li>
     *   <li><b>属性必须由调用方指定</b>（2026-10-03 补）：加速不只有 MOVEMENT_SPEED 一条路，
     *       水中的那条是 {@code NeoForgeMod.SWIM_SPEED} —— 把它写死成 MOVEMENT_SPEED
     *       正是"水下移速不生效"那个 bug 的写法。</li>
     * </ol>
     */
    private static void setModifier(LivingEntity entity, Holder<Attribute> attribute,
                                    Identifier id, double amount) {
        AttributeInstance inst = entity.getAttribute(attribute);
        if (inst == null) {
            return;
        }
        AttributeModifier old = inst.getModifier(id);
        if (amount <= 0.0) {
            if (old != null) {
                inst.removeModifier(id);
            }
            return;
        }
        if (old != null) {
            if (Math.abs(old.amount() - amount) < 1.0E-6) {
                return;         // 与当前一致 → 什么都不做
            }
            inst.removeModifier(id);
        }
        inst.addTransientModifier(new AttributeModifier(id, amount,
                AttributeModifier.Operation.ADD_MULTIPLIED_TOTAL));
    }
}
