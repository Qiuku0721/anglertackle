package com.whitecobalt.anglertackle.block;

import com.whitecobalt.anglertackle.entity.ModFish;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import com.whitecobalt.anglertackle.registry.ModEntities;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.Fluids;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 水族箱的**连通体积**与容量规则（docs/20 第二阶段的 A2/A3/A4/A5）。
 *
 * <h2>为什么是静态工具类，而不是方块实体</h2>
 * 最直觉的做法是"给水族箱加方块实体，把鱼和体积缓存进去"。但那样立刻会撞上一个
 * 没法优雅回答的问题：**一个 3×3×3 的缸有 27 个方块实体，哪一个说了算？**
 * 于是又要引入"控制器方块 + 从属方块"，还要处理控制器被拆、区块卸载、控制器
 * 所在的区块没加载而另一块加载了……每一种都是一类难查的 bug。
 *
 * <p>这里改成**不存状态**：需要的时候现算。
 * <ul>
 *   <li>体积 = 从当前方块出发的 BFS 连通分量（只在玩家右键时算，不在 tick 里算）；</li>
 *   <li>缸里有哪些鱼 = 问世界要这个体积包围盒里的 {@link ModFish}，再筛"确实落在体积里"；</li>
 *   <li>鱼的个体数据（体长/重量/评级）**存在鱼实体自己身上**（见 {@link ModFish}）。</li>
 * </ul>
 * 于是没有任何跨方块的一致性问题：唯一的事实来源是"世界 + 实体"，
 * 而这两者的存盘/同步是引擎保证的。代价是每次右键要 BFS 一次 ——
 * 那是玩家手动触发的低频操作，512 格的上限也钉死了最坏情况。
 */
public final class AquariumTank {

    /**
     * BFS 的硬上限。超过就当作"太大"拒绝服务。
     *
     * <p>没有这个上限，玩家用几千个方块拼一口巨缸，然后每次右键都做一次
     * 几千格的洪水填充 —— 那是可以在服务器上打出卡顿的。
     */
    public static final int MAX_BLOCKS = 512;

    /**
     * 体型分档的门槛（体长，厘米）。
     *
     * <p>30 这个数不是新拍的：外形管线里 {@code shape.style} 的分界**也是 30**
     * （小于 30cm 走鳕鱼模板、其余走鲑鱼模板），所以"小鱼"在两个系统里是同一批鱼。
     * 80 用来把中型和大型分开（巨骨舌鱼、蓝鳍金枪鱼那一档）。
     */
    public static final float SMALL_MAX_CM = 30.0F;
    public static final float MEDIUM_MAX_CM = 80.0F;

    /** 小型 2 格（1×1×2）／中型 8 格（2×2×2）／大型 27 格（3×3×3）—— docs/20 §2。 */
    public static final int SMALL_BLOCKS = 2;
    public static final int MEDIUM_BLOCKS = 8;
    public static final int LARGE_BLOCKS = 27;

    /**
     * 没有个体数据的鱼按中型算。
     *
     * <p>什么时候会没有？野生鱼自己游进缸里（缸破了洞又补上）。那是极少数情况，
     * 而"猜一个中位数"比"按最小算"更保守 —— 宁可少放一条，也不要让缸超载。
     */
    private static final int UNKNOWN_BLOCKS = MEDIUM_BLOCKS;

    private AquariumTank() {
    }

    // ------------------------------------------------------------------ 体积门槛

    /** 这条鱼要占多少格。 */
    public static int requiredBlocks(float lengthCm) {
        if (lengthCm < SMALL_MAX_CM) {
            return SMALL_BLOCKS;
        }
        if (lengthCm < MEDIUM_MAX_CM) {
            return MEDIUM_BLOCKS;
        }
        return LARGE_BLOCKS;
    }

    /** 一条鱼实体要占多少格（没有个体数据时按 {@link #UNKNOWN_BLOCKS}）。 */
    public static int requiredBlocks(ModFish fish) {
        FishData d = fish.fishData();
        return d == null ? UNKNOWN_BLOCKS : requiredBlocks(d.lengthCm());
    }

    // ------------------------------------------------------------------ 连通分量

    /**
     * 从 {@code seed} 出发的连通水族箱方块集合。
     *
     * <p>⚠ {@code seed} 自己**无条件算作体积的一部分**，不检查它是不是水族箱。
     * 这是故意的：拆掉一块时要在 {@code onRemove} 里把鱼放出来，而那个时刻
     * 该位置已经不是水族箱了 —— 如果这里检查 seed，就永远找不到"破洞那口缸"。
     *
     * @return 连通分量；超过 {@link #MAX_BLOCKS} 时返回 {@code null}（"缸太大"）
     */
    public static Set<BlockPos> flood(BlockGetter level, BlockPos seed) {
        Set<BlockPos> seen = new HashSet<>();
        Deque<BlockPos> queue = new ArrayDeque<>();
        BlockPos start = seed.immutable();
        seen.add(start);
        queue.add(start);
        while (!queue.isEmpty()) {
            BlockPos p = queue.poll();
            for (Direction d : Direction.values()) {
                BlockPos n = p.relative(d);
                if (seen.contains(n)) {
                    continue;
                }
                if (level.getBlockState(n).getBlock() instanceof AquariumBlock) {
                    if (seen.size() >= MAX_BLOCKS) {
                        return null;   // 太大：拒绝，而不是继续吃内存
                    }
                    seen.add(n);
                    queue.add(n);
                }
            }
        }
        return seen;
    }

    /** 体积的包围盒（往外多给 0.5 格，免得边界上的鱼因为判定框被漏掉）。 */
    private static AABB boxOf(Set<BlockPos> volume) {
        int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE, minZ = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE, maxY = Integer.MIN_VALUE, maxZ = Integer.MIN_VALUE;
        for (BlockPos p : volume) {
            minX = Math.min(minX, p.getX());
            minY = Math.min(minY, p.getY());
            minZ = Math.min(minZ, p.getZ());
            maxX = Math.max(maxX, p.getX());
            maxY = Math.max(maxY, p.getY());
            maxZ = Math.max(maxZ, p.getZ());
        }
        return new AABB(minX - 0.5, minY - 0.5, minZ - 0.5,
                maxX + 1.5, maxY + 1.5, maxZ + 1.5);
    }

    /**
     * 缸里的鱼。
     *
     * <p>先按包围盒粗筛（这是引擎提供的空间查询，很便宜），再逐条确认
     * "它确实站在体积里的某一格上" —— L 形缸的包围盒里有一部分不是缸，
     * 只靠包围盒会把外面的鱼算进来。
     */
    public static List<ModFish> fishIn(Level level, Set<BlockPos> volume) {
        List<ModFish> out = new ArrayList<>();
        if (volume.isEmpty()) {
            return out;
        }
        for (ModFish f : level.getEntitiesOfClass(ModFish.class, boxOf(volume))) {
            if (volume.contains(f.blockPosition())) {
                out.add(f);
            }
        }
        return out;
    }

    /** 这些鱼一共占了体积里的多少格。 */
    public static int usedBlocks(List<ModFish> fish) {
        int used = 0;
        for (ModFish f : fish) {
            used += requiredBlocks(f);
        }
        return used;
    }

    // ------------------------------------------------------------------ 放鱼 / 取鱼

    /**
     * 往缸里放一条鱼。
     *
     * @return 放不下时返回 {@code false}（调用方负责提示玩家，物品不消耗）
     */
    public static boolean addFish(ServerLevel level, Set<BlockPos> volume, FishData data) {
        BlockPos spot = spawnSpot(volume);
        if (spot == null) {
            return false;
        }
        EntityType<ModFish> type = ModEntities.FISHES.get(data.speciesId()) == null
                ? null : ModEntities.FISHES.get(data.speciesId()).get();
        if (type == null) {
            return false;
        }
        ModFish fish = type.create(level);
        if (fish == null) {
            return false;
        }
        fish.moveTo(spot.getX() + 0.5D, spot.getY() + 0.5D, spot.getZ() + 0.5D,
                level.getRandom().nextFloat() * 360.0F, 0.0F);
        fish.setFishData(data);
        fish.setInTank(true);
        return level.addFreshEntity(fish);
    }

    /**
     * 生成点：体积里**离几何中心最近**的那一格。
     *
     * <p>不能直接用包围盒中心 —— 那边可能正好是空腔之外（L 形缸），
     * 或者在某条鱼的判定框里，一生成就互相推挤。
     */
    private static BlockPos spawnSpot(Set<BlockPos> volume) {
        if (volume.isEmpty()) {
            return null;
        }
        double cx = 0, cy = 0, cz = 0;
        for (BlockPos p : volume) {
            cx += p.getX() + 0.5;
            cy += p.getY() + 0.5;
            cz += p.getZ() + 0.5;
        }
        int n = volume.size();
        Vec3 center = new Vec3(cx / n, cy / n, cz / n);
        BlockPos best = null;
        double bestDist = Double.MAX_VALUE;
        for (BlockPos p : volume) {
            double d = Vec3.atCenterOf(p).distanceToSqr(center);
            if (d < bestDist) {
                bestDist = d;
                best = p;
            }
        }
        return best;
    }

    /** 把缸里的一条鱼还原成物品（个体数据原样带回去）。 */
    public static ItemStack toItemStack(ModFish fish, Player player) {
        FishSpecies species = FishSpecies.byId(fish.speciesId());
        if (species == null) {
            return ItemStack.EMPTY;
        }
        FishData data = fish.fishData();
        if (data == null) {
            // 野生鱼：现抽一份个体数据，别让玩家拿到一条"没有数值"的鱼
            data = species.rollIndividual(fish.getRandom(), fish.level().getGameTime(),
                    player == null ? "" : player.getGameProfile().getName());
        }
        ItemStack out = new ItemStack(species.item().get());
        out.set(ModDataComponents.FISH_DATA.get(), data);
        return out;
    }

    /**
     * 解除缸里所有鱼的"圈养"状态。
     *
     * <p>拆掉一块就破了个洞，此刻**不能杀鱼**（docs/20 §5③）：把标记清掉，
     * 它们会自己游出去，水没了就在原地搁浅扑腾 —— 那是正确且好看的表现。
     */
    public static void releaseAll(ServerLevel level, BlockPos seed) {
        Set<BlockPos> volume = flood(level, seed);
        if (volume == null) {
            return;   // 缸太大：连统计都放弃了，这里也只能放弃
        }
        for (ModFish f : fishIn(level, volume)) {
            f.setInTank(false);
        }
    }

    // ------------------------------------------------------------------ 鱼的约束

    /**
     * 离 {@code from} 最近的水族箱方块（在给定半径内）。找不到返回 null。
     *
     * <p>给"被圈养的鱼出界了"用：把位置掰回缸里。
     */
    public static BlockPos nearestTankBlock(BlockGetter level, BlockPos from, int radius) {
        BlockPos best = null;
        double bestD = Double.MAX_VALUE;
        for (BlockPos p : BlockPos.betweenClosed(from.offset(-radius, -radius, -radius),
                from.offset(radius, radius, radius))) {
            if (level.getBlockState(p).getBlock() instanceof AquariumBlock) {
                double d = p.distSqr(from);
                if (d < bestD) {
                    bestD = d;
                    best = p.immutable();
                }
            }
        }
        return best;
    }

    // ------------------------------------------------------------------ 放生台（A5）

    /**
     * 放生台右键：手持鱼物品 → 找最近的一处 2×2×2 水域，把鱼生出来。
     *
     * <p>为什么是 2×2×2 而不是"一格水"：鱼的判定框不是零，一桶水那么大的坑里
     * 生成一条 1 格长的鱼，它一出来就被挤到方块里，表现为"放生了但看不见"。
     * docs/20 §3.5 定的是往外螺旋找第一个满足 2×2×2 全是水的位置。
     */
    public static InteractionResult releaseFromPlatform(ItemStack stack, Level level,
                                                            BlockPos pos, Player player) {
        if (!(stack.getItem() instanceof com.whitecobalt.anglertackle.item.FishItem)) {
            return InteractionResult.TRY_WITH_EMPTY_HAND;
        }
        if (level.isClientSide()) {
            return InteractionResult.SUCCESS;
        }
        FishData data = stack.get(ModDataComponents.FISH_DATA.get());
        if (data == null) {
            return InteractionResult.FAIL;
        }
        BlockPos pocket = findWaterPocket((ServerLevel) level, pos);
        if (pocket == null) {
            player.sendOverlayMessage(Component.translatable("message.anglertackle.release_no_water")
                    .withStyle(ChatFormatting.RED));
            return InteractionResult.FAIL;
        }
        if (!spawnInWater((ServerLevel) level, pocket, data)) {
            return InteractionResult.FAIL;
        }
        stack.shrink(1);
        player.sendOverlayMessage(Component.translatable("message.anglertackle.release_done")
                .withStyle(ChatFormatting.GREEN));
        return InteractionResult.SUCCESS_SERVER;
    }

    /**
     * 螺旋往外找一块 2×2×2 全是水源的位置。
     *
     * <p>用逐渐放大的**立方壳**（而不是真正的螺旋线）：反正只是找最近的一处，
     * 壳的遍历顺序不影响正确性，但代码短得多。半径上限 8 格 —— 再远玩家
     * 也看不出来鱼是从哪儿出来的，不如老实说"附近没有足够的水"。
     */
    private static BlockPos findWaterPocket(ServerLevel level, BlockPos center) {
        for (int r = 1; r <= 8; r++) {
            for (BlockPos p : BlockPos.betweenClosed(center.offset(-r, -r, -r),
                    center.offset(r, r, r))) {
                if (isWaterCube(level, p)) {
                    return p.immutable();
                }
            }
        }
        return null;
    }

    /** 以 {@code p} 为最小角的 2×2×2 是不是全是水源。 */
    private static boolean isWaterCube(ServerLevel level, BlockPos p) {
        for (int dx = 0; dx < 2; dx++) {
            for (int dy = 0; dy < 2; dy++) {
                for (int dz = 0; dz < 2; dz++) {
                    BlockPos q = p.offset(dx, dy, dz);
                    var fluid = level.getFluidState(q);
                    if (!fluid.is(Fluids.WATER) || !fluid.isSource()) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /** 在水域的几何中心生成一条鱼。 */
    private static boolean spawnInWater(ServerLevel level, BlockPos pocket, FishData data) {
        var holder = ModEntities.FISHES.get(data.speciesId());
        if (holder == null) {
            return false;
        }
        ModFish fish = holder.get().create(level);
        if (fish == null) {
            return false;
        }
        // 2×2×2 的中心是 (x+1, y+1, z+1)；再往下压 0.1 保证判定框整体在水里
        fish.moveTo(pocket.getX() + 1.0D, pocket.getY() + 0.9D, pocket.getZ() + 1.0D,
                level.getRandom().nextFloat() * 360.0F, 0.0F);
        fish.setFishData(data);
        fish.setInTank(false);   // 放生的是野鱼，不再受缸约束
        return level.addFreshEntity(fish);
    }

    /** 这条鱼是被圈养的，不能就此放它出去（放生台/缸里取出的路径会清掉它）。 */
    static InteractionResult reject(Player player, String key, Object... args) {
        player.sendOverlayMessage(Component.translatable(key, args)
                .withStyle(ChatFormatting.RED));
        return InteractionResult.FAIL;
    }
}
