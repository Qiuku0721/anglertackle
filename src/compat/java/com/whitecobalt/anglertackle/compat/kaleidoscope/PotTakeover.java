package com.whitecobalt.anglertackle.compat.kaleidoscope;

import com.github.ysbbbbbb.kaleidoscopecookery.api.blockentity.IPot;
import com.github.ysbbbbbb.kaleidoscopecookery.blockentity.kitchen.PotBlockEntity;
import com.github.ysbbbbbb.kaleidoscopecookery.init.ModRecipes;
import com.github.ysbbbbbb.kaleidoscopecookery.init.tag.TagMod;
import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.fishing.FoodValues;
import com.whitecobalt.anglertackle.item.DishItem;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;

import java.util.List;

/**
 * 炒锅（{@code pot} / {@code flex_pot}）数据保真 —— 出锅那一下把**无数据**的菜换成带数据的。
 *
 * <h2>为什么只能卡在"出锅"这一步</h2>
 * 他们的炒锅**没有**任何公开的匹配/成品事件（{@code api/event} 下只有
 * Stockpot / Millstone / RecipeItem / SickleHarvest 四个），所以像汤锅那样"改配方"做不到。
 * 但 {@code PotBlockEntity} 的公开访问器够用：{@code getStatus()} / {@code getInputs()} /
 * {@code getResult()} / {@code takeOutProduct(...)}，于是走"出锅时换货"：
 * <pre>
 *   ① 锅的状态是 FINISHED、成品是我们的菜、锅里有我们的鱼 → 才接管（否则原样交给他们）
 *   ② 取消这次交互，自己调他们的 takeOutProduct（他们给玩家一份**无数据**的同款菜）
 *   ③ 把那一份等量收回（{@link Reclaim}），换成我们算好的带数据版本给玩家
 * </pre>
 * ②③ 之间任何一步不成立就**什么都不额外给** —— 玩家只是拿到了一份无数据的菜（和没装扩展包时一样），
 * 绝不会多拿。
 *
 * <h2>顺带说清油的事</h2>
 * 他们的炒锅在放料**之前**有一个独立的"放油"流程（{@link IPot#onPlaceOil}），
 * 所以我们的炒锅配方里**不再要求鱼油**（1.4.2 起改掉）—— 否则等于收两次油。
 */
final class PotTakeover {

    private PotTakeover() {
    }

    private static final org.slf4j.Logger LOGGER = org.slf4j.LoggerFactory.getLogger("AnglerTackle/Kaleidoscope");

    static void onRightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        try {
            apply(event);
        } catch (Throwable t) {
            // 与汤锅同一条底线：兼容层出错只能是"这道菜没数据"，绝不允许弄崩玩家的游戏
            LOGGER.warn("垂纶：炒锅数据保真跳过（{}）—— 这道菜会按优质档兜底结算", t.toString());
        }
    }

    /** 诊断计数：只打前几条，绝不刷屏。 */
    private static int debugLeft = 12;

    private static void debug(String msg) {
        if (debugLeft-- > 0) {
            LOGGER.info("垂纶／炒锅：{}", msg);
        }
    }

    private static void apply(PlayerInteractEvent.RightClickBlock event) {
        Level level = event.getLevel();
        if (!(level.getBlockEntity(event.getPos()) instanceof PotBlockEntity pot)) {
            return;
        }
        // 诊断：只看"做好了"那一下（status=FINISHED），免得被放料阶段的右键把额度吃光。
        // 玩家报"只出黑暗料理/东西不见了"时，这几样是唯一能定位的东西（他们没有炒锅事件可挂）。
        if (!level.isClientSide() && pot.getStatus() == IPot.FINISHED) {
            StringBuilder sb = new StringBuilder();
            for (ItemStack s : pot.getInputs()) {
                if (s.isEmpty()) continue;
                if (sb.length() > 0) sb.append(" + ");
                sb.append(s.getCount()).append('x').append(s.getItem());
            }
            debug("出锅前：成品=" + pot.getResult().getItem() + " 锅里=" + (sb.length() == 0 ? "（空）" : sb));
        }
        if (pot.getStatus() != IPot.FINISHED) {
            return;                                  // 还没做好 / 已经糊了 → 不插手
        }
        // ⚠ 只管"盛菜/出锅"那一下：手里必须是**碗**（我们配方的 carrier）或他们的**锅铲**。
        //   其余物品（水桶、生料、锅盖之类）的右键一律交给他们自己处理。
        ItemStack hand = event.getItemStack();
        if (!hand.is(net.minecraft.world.item.Items.BOWL) && !hand.is(TagMod.KITCHEN_SHOVEL)) {
            return;
        }
        // ★ 必须**先深拷贝快照**：getResult() 返回的是他们内部那个 stack 本身，
        //   他们的 takeOutProduct 会把它清空 —— 第一版我在出锅**之后**才 copy，
        //   拿到的是空气，于是"收回一份、发放一份"里的发放变成了发空气（玩家看到东西一闪就没）。
        ItemStack product = pot.getResult().copy();
        if (!(product.getItem() instanceof DishItem)) {
            return;                                  // 不是我们的菜
        }
        FishChunkData data = findOurFish(pot.getInputs());
        if (data == null) {
            return;                                  // 锅里没有我们的鱼 → 保持无数据（按优质档兜底）
        }
        ItemStack withData = product.copy();
        withData.set(ModDataComponents.FISH_CHUNK.get(), data);
        withData.set(DataComponents.FOOD, FoodValues.dish(data.tier()));

        event.setCanceled(true);                     // 他们的出锅逻辑由我们代跑
        if (level.isClientSide()) {
            return;
        }
        ItemStack[] before = Reclaim.snapshot(event.getEntity());   // ★ 出锅前整包深拷贝
        if (!pot.takeOutProduct(level, event.getEntity(), event.getItemStack())) {
            event.setCanceled(false);                // 他们自己来（比如手里不是铲子/碗）
            return;
        }
        if (!Reclaim.swapProduct(level, event.getEntity(), event.getPos(), before, product.getItem(), withData)) {
            // 找不到刚出现的那一份 → 什么都不额外给：玩家手里已经有出锅那一份（无数据的），绝不复制
            debug("出锅后找不到刚出现的那一份，放弃替换（玩家拿到的是无数据版）");
            return;
        }
        debug("已就地替换为带数据版：" + data.speciesId() + " 档位 " + data.tier());
    }

    /** 锅里找我们的鱼：鱼块用自己的档位，整鱼用 {@code effectiveTier()}。 */
    private static FishChunkData findOurFish(List<ItemStack> inputs) {
        for (ItemStack stack : inputs) {
            FishChunkData chunk = stack.get(ModDataComponents.FISH_CHUNK.get());
            if (chunk != null) {
                return chunk;
            }
            FishData fish = stack.get(ModDataComponents.FISH_DATA.get());
            if (fish != null) {
                return new FishChunkData(fish.speciesId(), fish.effectiveTier(), fish.weightKg());
            }
        }
        return null;
    }
}
