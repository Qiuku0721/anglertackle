package com.whitecobalt.anglertackle.entity;

import com.whitecobalt.anglertackle.block.AquariumBlock;
import com.whitecobalt.anglertackle.block.AquariumTank;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.registry.ModEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.AbstractFish;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

/**
 * 全部 21 种鱼的共用实体类。
 *
 * <p>继承 {@link AbstractFish} 就等于拿到了：鱼桶交互（拿桶右键捞鱼、倒鱼）、
 * 默认 AI（PanicGoal + AvoidEntityGoal + FishSwimGoal）、水域寻路
 * （WaterBoundPathNavigation）、水里的移动、搁浅时扑腾、canRandomSwim() 开关。
 * 它唯一的抽象方法只有 {@link #getFlopSound()}。
 *
 * <p><b>所以不需要写 21 个实体类。</b>原版 Cod / Salmon / TropicalFish 各自成类，
 * 是因为它们行为不同（鳕鱼成群、鲑鱼能进河、热带鱼有变体、河豚会鼓）。
 * 我们的鱼行为一致，差异全在贴图（以及以后的模型参数）上。
 *
 * <p>⚠ 继承了 AbstractFish 就自动 implements Bucketable，鱼桶那套不用再写一行。
 *
 * <p>2026-10-01 增加两件事（水族箱第二阶段）：
 * <ol>
 *   <li><b>个体数据</b>：从水族箱里取出来的鱼要能还原成**原来那一条**
 *       （同一条 42.3cm / 1.2kg 的鲫鱼），所以把 {@link FishData} 记在实体身上。</li>
 *   <li><b>圈养标记</b>：被放进缸里的鱼每 10 刻确认一次自己还在缸里，
 *       不在就拉回去。拆缸时标记会被清掉（见 {@link AquariumTank#releaseAll}）。</li>
 * </ol>
 */
public class ModFish extends AbstractFish {

    /** 缓存的鱼种 id。speciesId() 每帧都会被渲染器调到，不能每次遍历 21 个注册项。 */
    private String speciesCache;

    /** 被圈养的鱼：出界就往回拉。野生鱼为 false（默认），完全不受影响。 */
    private boolean inTank;

    /**
     * 这条鱼的个体数据（体长/重量/评级/档位）。
     *
     * <p>为 null 只有一种情况：野生生成/刷怪蛋出来的鱼。从水族箱里放进去的
     * 一定带着数据，取出来时原样还回去 —— 玩家养了两个小时的纪录级鲫鱼
     * 不能因为"在缸里待过"就变成一条普通鱼。
     */
    @Nullable
    private FishData fishData;

    /** 出界检查的间隔。每刻都查是浪费：鱼游不出缸，这是兜底而不是主逻辑。 */
    private static final int TANK_CHECK_INTERVAL = 10;

    /** 往哪个方向找"最近的缸"（格）。太大就是拿性能换一个几乎不会发生的情况。 */
    private static final int TANK_SEARCH_RADIUS = 6;

    public ModFish(EntityType<? extends ModFish> type, Level level) {
        super(type, level);
    }

    /**
     * 属性。
     *
     * <p>⚠ 鱼的 createAttributes() 在 AbstractFish 里是 static —— static 不参与继承，
     * 所以这一份必须自己写、自己注册进 EntityAttributeCreationEvent。
     * 漏了的表现是"鱼能生成但一出现就死"（属性表是空的，不是报错）。
     *
     * <p>血量沿用原版四种鱼的值（3.0）—— 鱼是消耗品，不该耐打。
     */
    public static AttributeSupplier.Builder createAttributes() {
        return Mob.createMobAttributes()
                .add(Attributes.MAX_HEALTH, 3.0)
                .add(Attributes.MOVEMENT_SPEED, 1.0);
    }

    /** 这一条鱼是哪个鱼种（对应 FishSpecies 的 id，也对应贴图文件名）。 */
    public String speciesId() {
        if (speciesCache == null) {
            speciesCache = ModEntities.speciesOf(getType());
        }
        return speciesCache;
    }

    // ------------------------------------------------------------ 水族箱

    /** 这条鱼的个体数据；野生鱼为 null。 */
    @Nullable
    public FishData fishData() {
        return fishData;
    }

    public void setFishData(@Nullable FishData data) {
        this.fishData = data;
    }

    /** 是不是被关在缸里的鱼。 */
    public boolean isInTank() {
        return inTank;
    }

    public void setInTank(boolean value) {
        this.inTank = value;
    }

    /**
     * 圈养鱼的兜底约束：**每 10 刻确认自己站的那一格还是水族箱**。
     *
     * <p>为什么需要它，缸四面都是硬壁？三个漏洞：
     * <ul>
     *   <li>玩家拆掉一块（此刻 {@link AquariumTank#releaseAll} 会解除圈养，正常）；</li>
     *   <li>活塞/爆炸把结构打散，而那一刻不一定会走到解禁那条路；</li>
     *   <li>区块边界上的鱼被推挤，从接缝里漏出去。</li>
     * </ul>
     *
     * <p>做成"直接改位置"而不是"给一个速度"：速度下一 tick 就会被寻路覆盖，
     * 而鱼此刻的目标往往正是"游出去"，两边会一直拔河。
     */
    @Override
    public void tick() {
        super.tick();
        if (inTank && !level().isClientSide && tickCount % TANK_CHECK_INTERVAL == 0) {
            if (!(level().getBlockState(blockPosition()).getBlock() instanceof AquariumBlock)) {
                BlockPos back = AquariumTank.nearestTankBlock(level(), blockPosition(), TANK_SEARCH_RADIUS);
                if (back != null) {
                    moveTo(back.getX() + 0.5D, back.getY() + 0.5D, back.getZ() + 0.5D,
                            getYRot(), getXRot());
                    setDeltaMovement(Vec3.ZERO);
                }
            }
        }
    }

    // ------------------------------------------------------------ 存盘

    @Override
    public void addAdditionalSaveData(CompoundTag tag) {
        super.addAdditionalSaveData(tag);
        if (inTank) {
            tag.putBoolean("AnglerTackleInTank", true);
        }
        if (fishData != null) {
            // 用 FishData 自己的 CODEC 写盘，而不是手抄每一列 ——
            // 以后给 FishData 加字段时，这里不用跟着改（也不会漏）。
            FishData.CODEC.encodeStart(NbtOps.INSTANCE, fishData)
                    .result()
                    .ifPresent(t -> tag.put("AnglerTackleFish", t));
        }
    }

    @Override
    public void readAdditionalSaveData(CompoundTag tag) {
        super.readAdditionalSaveData(tag);
        inTank = tag.getBooleanOr("AnglerTackleInTank", false);
        if (tag.contains("AnglerTackleFish")) {
            fishData = FishData.CODEC.parse(NbtOps.INSTANCE, tag.get("AnglerTackleFish"))
                    .result()
                    .orElse(null);
        }
    }

    /**
     * 捞起来之后变成什么桶。
     *
     * <p>⚠ 调研报告说"AbstractFish 唯一的抽象方法是 getFlopSound()"，**不准确** ——
     * 编译器指出 {@code Bucketable.getBucketItemStack()} 也是抽象的，
     * AbstractFish 没有实现它。所以这里必须给一个。
     *
     * <p>21 种鱼现在都变成鳕鱼桶（原版物品，不新增 21 个桶物品）。
     * 以后要做"每种鱼专属鱼桶"时，按 {@link #speciesId()} 分流即可。
     */
    @Override
    public net.minecraft.world.item.ItemStack getBucketItemStack() {
        return new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.COD_BUCKET);
    }

    /**
     * AbstractFish 的抽象方法：搁浅时扑腾的声音。
     *
     * <p>环境音/受伤音/死亡音基类都有默认实现，多覆写一处就多一个
     * "音效常量名写错导致编译不过"的机会，而它们此刻并不重要。
     */
    @Override
    protected SoundEvent getFlopSound() {
        return SoundEvents.COD_FLOP;
    }
}
