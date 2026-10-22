package com.whitecobalt.anglertackle.compat.kaleidoscope;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;

/**
 * "先借他们的公开 API 把东西退出来、再等量收回那一个"的公共小工具。
 *
 * <h2>为什么需要它</h2>
 * 砧板与炒锅上/锅里的那一个物品都在他们的**私有字段**里，公开出口只有
 * "退还"（{@code onTakeOut} / {@code takeOutProduct}）而没有"悄悄消耗一个"。
 * 我们要的是"消耗 1 个、产出我们算的那一份"，所以只能退还后再收回来。
 *
 * <h2>顺序不能反（这是防复制的那条线）</h2>
 * 调用方必须**先收回、确认收回成功，再给产物** —— 收不回来就不给产物。
 * 反过来写（先给产物再收回）在"背包满 + 掉落物被别的东西吸走"时就是一个复制漏洞。
 */
final class Reclaim {

    private Reclaim() {
    }

    /** 出锅**前**：把背包整包**深拷贝**下来（数量 + 物品都要，见 swapProduct 的注释）。 */
    static ItemStack[] snapshot(Player player) {
        var inv = player.getInventory();
        ItemStack[] before = new ItemStack[inv.getContainerSize()];
        for (int i = 0; i < before.length; i++) {
            before[i] = inv.getItem(i).copy();      // ★ 必须 copy：getItem 返回的是活引用
        }
        return before;
    }

    /**
     * 出锅**后**：把"刚出现的那一份产物"就地换成带数据的那份，成功返回 true。
     *
     * <h2>为什么不能只看数量增量（1.4.7 踩的坑）</h2>
     * 日志证据：按"哪一格变多了"找，永远找不到 —— 因为带 {@code carrier}（碗）的出锅
     * **不是把菜放进背包**，而是把手里那个碗**就地变成菜**：那一格的**数量没变、物品变了**。
     * 所以判据必须是"整格对比"：这一格现在是我们那道菜，且与出锅前**不同**（物品变了或数量变多）。
     *
     * <h2>三种收尾</h2>
     * ① 某格现在是我们那道菜且与出锅前不同 → 就地替换（保持数量）；
     * ② 那一份被弹到了地上（背包满）→ 扣掉地上的，给带数据的；
     * ③ 都找不到 → false（调用方**什么都不额外给**，宁可无数据也不复制）。
     */
    static boolean swapProduct(Level level, Player player, BlockPos pos, ItemStack[] before,
                               net.minecraft.world.item.Item want, ItemStack withData) {
        var inv = player.getInventory();
        for (int i = 0; i < before.length && i < inv.getContainerSize(); i++) {
            ItemStack now = inv.getItem(i);
            if (now.isEmpty() || !now.is(want)) {
                continue;
            }
            ItemStack old = before[i];
            boolean changed = !ItemStack.isSameItemSameComponents(now, old) || now.getCount() > old.getCount();
            if (!changed) {
                continue;                            // 出锅前就是这道菜，不是刚发下来的
            }
            ItemStack repl = withData.copy();
            repl.setCount(now.getCount());
            inv.setItem(i, repl);
            inv.setChanged();
            return true;
        }
        AABB box = new AABB(pos).inflate(3.0);
        for (ItemEntity entity : level.getEntitiesOfClass(ItemEntity.class, box)) {
            ItemStack s = entity.getItem();
            if (!s.is(want)) {
                continue;
            }
            entity.discard();
            net.neoforged.neoforge.items.ItemHandlerHelper.giveItemToPlayer(player, withData);
            return true;
        }
        return false;
    }

    /**
     * 取出后按"哪一格**变了**"认领产物并就地替换 —— 用于**取出前不知道会得到什么**的场合（蒸笼）。
     *
     * <p>与 {@link #swapProduct} 的区别：那个需要一个"期望的物品"来比对，这个不用 ——
     * 只要那一格现在装的是{@link com.whitecobalt.anglertackle.item.DishItem 我们的菜}、
     * 且与取出前不同，就认它。掉落物那条同样兜底。
     */
    static boolean swapLatest(Level level, Player player, BlockPos pos, ItemStack[] before, FishChunkData use) {
        var inv = player.getInventory();
        for (int i = 0; i < before.length && i < inv.getContainerSize(); i++) {
            ItemStack now = inv.getItem(i);
            if (now.isEmpty() || !(now.getItem() instanceof com.whitecobalt.anglertackle.item.DishItem)) {
                continue;
            }
            ItemStack old = before[i];
            boolean changed = !ItemStack.isSameItemSameComponents(now, old) || now.getCount() > old.getCount();
            if (!changed) {
                continue;
            }
            inv.setItem(i, withData(now, use));
            inv.setChanged();
            return true;
        }
        AABB box = new AABB(pos).inflate(3.0);
        for (ItemEntity entity : level.getEntitiesOfClass(ItemEntity.class, box)) {
            if (entity.getItem().getItem() instanceof com.whitecobalt.anglertackle.item.DishItem) {
                entity.discard();
                net.neoforged.neoforge.items.ItemHandlerHelper.giveItemToPlayer(player, withData(entity.getItem(), use));
                return true;
            }
        }
        return false;
    }

    /** 把一份菜换成"同款 + 鱼数据"的版本（数量保持不变）。 */
    private static ItemStack withData(ItemStack dish, FishChunkData use) {
        ItemStack out = dish.copy();
        out.set(com.whitecobalt.anglertackle.registry.ModDataComponents.FISH_CHUNK.get(), use);
        out.set(net.minecraft.core.component.DataComponents.FOOD,
                com.whitecobalt.anglertackle.fishing.FoodValues.dish(use.tier()));
        return out;
    }

    /**
     * 从玩家背包（优先）或方块附近的掉落物里扣掉一个与 {@code want} 同款的物品。
     *
     * @return 真的扣掉了返回 true；两处都没找到返回 false（调用方据此**放弃发放产物**）
     */
    static boolean one(Level level, Player player, BlockPos pos, ItemStack want) {
        var inv = player.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (ItemStack.isSameItemSameComponents(s, want)) {
                s.shrink(1);
                inv.setChanged();
                return true;
            }
        }
        AABB box = new AABB(pos).inflate(3.0);
        for (ItemEntity entity : level.getEntitiesOfClass(ItemEntity.class, box)) {
            ItemStack s = entity.getItem();
            if (ItemStack.isSameItemSameComponents(s, want)) {
                s.shrink(1);
                if (s.isEmpty()) {
                    entity.discard();
                }
                return true;
            }
        }
        return false;
    }
}
