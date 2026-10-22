package com.whitecobalt.anglertackle.compat.kaleidoscope;

import com.github.ysbbbbbb.kaleidoscopecookery.blockentity.kitchen.ChoppingBoardBlockEntity;
import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.fishing.FoodValues;
import com.whitecobalt.anglertackle.item.DishItem;
import com.whitecobalt.anglertackle.recipe.CuttingRecipe;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import com.whitecobalt.anglertackle.registry.ModItems;
import com.whitecobalt.anglertackle.registry.ModTags;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.items.ItemHandlerHelper;

/**
 * 砧板接管 —— 用**他们的**砧板跑**我们的**切鱼流程（用户 2026-10-03 的要求）。
 *
 * <pre>
 * 玩家拿整鱼右键砧板  → 他们的 onPutItem（我们不插手，模型/动画/音效全是他们的）
 * 玩家拿鱼刀右键砧板  → 本类接管：
 *                        ① 板上是我们的整鱼 → 按**重量**出鱼块（复用 {@link CuttingRecipe} 的公式与常量）
 *                        ② 板上是我们的鱼块 → **1 : 1** 出鱼丸（用户拍板的比例），鱼丸继承该鱼块的档位
 *                        ③ 调他们的 playParticlesSound()（粒子与音效仍是他们的观感）
 *                        ④ 产物带 FISH_CHUNK 数据 → 后续做菜按**真实档位**结算
 * 不是我们的食材/工具 → 立刻 return，什么都没取消，他们的原流程一个字都不变
 * </pre>
 *
 * <h2>为什么"消耗"要绕一下</h2>
 * 砧板上那一个物品在他们的私有字段里，公开 API 只有两个出口：
 * {@code onCutItem}（切满次数才产出并清板）与 {@code onTakeOut}（把板上那一个**退还**给玩家）。
 * 我们的份数/数据他们算不出来，所以走 {@code onTakeOut} 退还、再**等量收回**这一个 ——
 * 净效果才是"消耗 1 个"。
 * ⚠ 顺序是"先收回、确认收回成功、再给产物"：万一收回失败（背包满又没找到掉落物），
 * 就直接不给产物 —— 宁可让玩家这次没切成，也绝不能让鱼被复制。
 */
final class BoardTakeover {

    private BoardTakeover() {
    }

    static void onRightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        Level level = event.getLevel();
        if (!(level.getBlockEntity(event.getPos()) instanceof ChoppingBoardBlockEntity board)) {
            return;
        }
        ItemStack onBoard = board.getCurrentCutStack();
        if (onBoard.isEmpty()) {
            return;
        }
        // 我们的鱼刀，或他们的菜刀（他们的菜刀通过 1.3.0 的标签合并进了 anglertackle:kitchen_knife）
        if (!event.getItemStack().is(ModTags.KITCHEN_KNIFE)) {
            return;
        }
        ItemStack products = productsOf(onBoard);
        if (products.isEmpty()) {
            return;   // 不是我们的食材 → 完全交给他们
        }

        event.setCanceled(true);          // 他们的 onCutItem 不跑（份数与数据只有我们算得出来）
        if (level.isClientSide()) {
            return;                       // 客户端只负责"这次交互被取消了"
        }

        ItemStack input = onBoard.copyWithCount(1);
        board.onTakeOut(level, event.getEntity());          // 他们的公开 API：把板上那一个退还
        if (!Reclaim.one(level, event.getEntity(), event.getPos(), input)) {
            return;                       // 收不回来就不给产物（防复制，见类注释）
        }

        board.playParticlesSound();                          // 他们的粒子与音效
        ItemHandlerHelper.giveItemToPlayer(event.getEntity(), products);
    }

    /**
     * 产出什么：
     * · 我们的鱼块 → 1 颗鱼丸（**1:1**，用户 2026-10-03 拍板），鱼丸带该鱼块的
     *   {@code FISH_CHUNK} 数据与相应档位的 FOOD → 顶级鱼块做的丸子效果更好；
     * · 我们的整鱼 → 按重量出鱼块：份数与块型**完全复用** {@link CuttingRecipe#chunkCount} /
     *   {@link CuttingRecipe#rawChunkOf}（"档位决定块型、重量决定份数"只有这一套口径）。
     */
    private static ItemStack productsOf(ItemStack onBoard) {
        FishChunkData chunk = onBoard.get(ModDataComponents.FISH_CHUNK.get());
        if (chunk != null) {
            ItemStack ball = new ItemStack(ModItems.FISH_BALL.get());
            ball.set(ModDataComponents.FISH_CHUNK.get(), chunk);
            ball.set(DataComponents.FOOD, FoodValues.dish(chunk.tier()));
            return ball;
        }
        FishData fish = onBoard.get(ModDataComponents.FISH_DATA.get());
        if (fish == null) {
            return ItemStack.EMPTY;
        }
        int tier = fish.effectiveTier();
        int group = FishChunkData.groupOfTier(tier);
        ItemStack out = CuttingRecipe.rawChunkOf(group);
        out.setCount(CuttingRecipe.chunkCount(fish.weightKg(), group));
        out.set(ModDataComponents.FISH_CHUNK.get(), new FishChunkData(fish.speciesId(), tier, fish.weightKg()));
        return out;
    }

}
