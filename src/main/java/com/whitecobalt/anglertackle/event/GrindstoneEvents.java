package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.RodModManager;
import com.whitecobalt.anglertackle.item.RodItem;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.ItemEnchantments;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.GrindstoneEvent;

import java.util.List;

/**
 * 砂轮拆卸：把装好配件的竿放进砂轮，取出空竿时配件全部退回背包。
 *
 * <p>用户 2026-10-02："砂轮卸载鱼竿配件时不会返还物品，现在需要砂轮能在洗掉杆子附魔时
 * 拆除配件，并且配件保留使用过的耐久数据，在下一次装上时不会出现耐久回满的情况。"
 *
 * <h2>两个事件，各自只能干一半</h2>
 * <ol>
 *   <li>{@code OnPlaceItem}：放进去时把"空竿"算成产出物（顺手洗掉附魔）。
 *       这时**不能**把配件给玩家 —— 他随时能把竿拿回去，那就刷出配件了。</li>
 *   <li>{@code OnTakeItem}：玩家取走产出物时，才把配件退回去。</li>
 * </ol>
 *
 * <h2>⚠ 配件必须从"输入槽里那根竿"上拆</h2>
 * 取走事件里能拿到的物品栈只有两个来源，差别是致命的
 * （NeoForge 21.1.252 的 {@code CommonHooks.onGrindstoneTake} 原文）：
 * <pre>
 *   GrindstoneEvent.OnTakeItem e = new OnTakeItem(access, player,
 *           inputSlots.getItem(0), inputSlots.getItem(1), xp);   // ← getTopItem()/getBottomItem()
 *   ...
 *   inputSlots.setItem(0, e.getNewTopItem());                    // ← getNewTopItem() 是"取完之后
 *   inputSlots.setItem(1, e.getNewBottomItem());                 //    留在输入槽里的东西"，默认 EMPTY
 * </pre>
 * 也就是说 {@code getNewTopItem()} **不是**被取走的产出物，而是"事件之后输入槽的残余"，
 * 默认空栈 —— 读它的话整段逻辑会静默走进 {@code return}，表现就是"配件从来没退回过"。
 * 输入槽里那根竿在取走时还在槽里（原版是取走之后才把两个输入槽清空），
 * 所以配件就从它身上拆。
 *
 * <p>拆完不用自己清输入槽：{@code onGrindstoneTake} 随后会把输入槽设成
 * {@code getNewTopItem()}/{@code getNewBottomItem()}（默认空），那根被拆过的竿随之消失。
 *
 * <p>{@code stripAllParts} 返回的是**存下来的那几份 ItemStack 的副本**，
 * 所以配件带着自己用过的耐久回来，装回去不会"翻新"。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class GrindstoneEvents {

    private GrindstoneEvents() {
    }

    @SubscribeEvent
    public static void onPlaceItem(GrindstoneEvent.OnPlaceItem event) {
        ItemStack rod = rodOf(event.getTopItem(), event.getBottomItem());
        if (rod.isEmpty() || !RodModManager.hasAnyPart(rod)) {
            return;
        }

        // 产出物 = 空竿。先复制再拆，输入槽里那根竿要保持原样（玩家可能又拿回去）。
        ItemStack stripped = rod.copy();
        List<ItemStack> parts = RodModManager.stripAllParts(stripped);
        if (parts.isEmpty()) {
            return;
        }

        // ★ 显式清附魔：我们整个替换了产出物，不能指望砂轮那套"剥附魔"还生效
        //   （用户要的是"洗掉竿子附魔**时**拆除配件"，两件事必须同时发生）。
        EnchantmentHelper.setEnchantments(stripped, ItemEnchantments.EMPTY);
        event.setOutput(stripped);
        // 砂轮不给经验也没关系，给 0 避免和原版附魔剥离的经验逻辑打架
        event.setXp(0);

        AnglersTackle.LOGGER.info("[垂纶] 砂轮拆卸：{} 个配件将在取出空竿时退回", parts.size());
    }

    @SubscribeEvent
    public static void onTakeItem(GrindstoneEvent.OnTakeItem event) {
        Player player = event.getPlayer();
        // 客户端也会走一遍 Slot#onTake（预测），只有服务端能真的给东西
        if (player == null || player.level().isClientSide()) {
            return;
        }

        // ⚠ 读 getTopItem()/getBottomItem()（输入槽里的原件），不要读 getNewTopItem() —— 见类注释
        ItemStack rod = rodOf(event.getTopItem(), event.getBottomItem());
        if (rod.isEmpty() || !RodModManager.hasAnyPart(rod)) {
            return;
        }

        List<ItemStack> parts = RodModManager.stripAllParts(rod);
        if (parts.isEmpty()) {
            return;
        }
        for (ItemStack p : parts) {
            if (!player.getInventory().add(p)) {
                // 背包满 ⇒ **先寄信**（`docs/36` §4.1 第 10 条，2026-10-12 M4 改造）；
                // 邮箱也满 ⇒ MailReturns 内部退回"掉在脚下" ✓ 两处共用同一个兜底策略。
                com.whitecobalt.anglertackle.mail.MailReturns.toMailboxOrDrop(player, p, "return_item");
            }
        }
        AnglersTackle.LOGGER.info("[垂纶] 砂轮拆卸完成：退回 {} 个配件（耐久随配件保留）", parts.size());
    }

    /** 两个输入槽里哪一个是竿（都没有就返回空栈）。 */
    private static ItemStack rodOf(ItemStack top, ItemStack bottom) {
        if (top.getItem() instanceof RodItem) {
            return top;
        }
        if (bottom.getItem() instanceof RodItem) {
            return bottom;
        }
        return ItemStack.EMPTY;
    }
}
