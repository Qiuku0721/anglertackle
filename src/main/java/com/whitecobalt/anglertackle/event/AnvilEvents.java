package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.RodModManager;
import com.whitecobalt.anglertackle.item.RodItem;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.AnvilUpdateEvent;
import net.neoforged.neoforge.event.entity.player.AnvilRepairEvent;

/**
 * 铁砧装配：左槽放竿、右槽放配件 → 合成出"装好这个配件"的竿。
 *
 * <p>为什么改成铁砧而不是自绘界面：自绘 GUI 反复出问题（按钮点了没反应、
 * 数据同步不上），而且玩家还要先学会"按 Z 或潜行右键"这种隐藏入口。
 * 铁砧是原版容器，交互、音效、消耗逻辑全都是现成的，玩家一看就懂。
 *
 * <p>规则：
 * <ul>
 *   <li>左槽必须是本模组的竿，右槽必须是能装到这根竿上的配件</li>
 *   <li>装好后的竿会带上该配件；**原来占同一个槽位的配件会退回玩家背包**
 *       （背包满就掉在脚下，不丢失），并且带着它自己用过的耐久</li>
 *   <li>经验等级消耗 1 级，和原版修装备一个量级</li>
 *   <li>右槽的配件会被消耗 1 个（铁砧本身就会消耗右槽物品）</li>
 * </ul>
 *
 * <h2>⚠ 退旧件必须在"取走"那一刻，不能在 {@code AnvilUpdateEvent} 里</h2>
 * {@code AnvilUpdateEvent} 是**预览**：玩家每动一下槽位就触发一次
 * （换件、改名字、取出再放回…）。在那里发货 = 每次预览都刷一个旧配件出来。
 * 这和砂轮是同一课：**给东西只能发生在"取走产出物"这一刻**。
 *
 * <p>{@code AnvilRepairEvent} 正是那一刻 —— NeoForge 从
 * {@code AnvilMenu.onTake} 里发出来（原文）：
 * <pre>
 *   float breakChance = CommonHooks.onAnvilRepair(player, taken,
 *           inputSlots.getItem(0), inputSlots.getItem(1));   // ← 左槽还是**原来那根竿**
 *   this.inputSlots.setItem(0, ItemStack.EMPTY);             // ← 钩子返回之后才清
 * </pre>
 * 所以旧配件在事件里还读得到；读它用 {@link RodModManager#partAt}（带耐久的那一份）。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class AnvilEvents {

    private AnvilEvents() {
    }

    @SubscribeEvent
    public static void onAnvilUpdate(AnvilUpdateEvent event) {
        ItemStack left = event.getLeft();
        ItemStack right = event.getRight();

        // 诊断：把每一次铁砧更新都记下来。
        // 之前"台钓改不了饵料"查不出原因，就是因为不知道事件到底有没有触发、
        // 触发后是被哪一步挡掉的。
        if (!left.isEmpty() || !right.isEmpty()) {
            AnglersTackle.LOGGER.info("[垂纶] 铁砧事件：左={}（{}）右={}（{}）",
                    left.isEmpty() ? "空" : left.getHoverName().getString(),
                    left.isEmpty() ? "-" : left.getItem(),
                    right.isEmpty() ? "空" : right.getHoverName().getString(),
                    right.isEmpty() ? "-" : right.getItem());
        }

        if (!(left.getItem() instanceof RodItem rodItem) || right.isEmpty()) {
            return;
        }

        ItemStack result = left.copy();
        boolean ok = RodModManager.applyPart(result, rodItem.rodType(), right);
        if (!ok) {
            // 这个配件不适合这根竿：不产出任何东西，让原版铁砧自己判断
            AnglersTackle.LOGGER.info("[垂纶] 铁砧：{} 装不到 {} 上（竿型 {}）",
                    right.getItem(), rodItem.rodType(), rodItem.rodType());
            return;
        }

        // 提示玩家装到了哪个槽位（聊天栏 + 物品名后缀）
        event.setOutput(result);
        event.setCost(1);
        event.setMaterialCost(1);

        String slotKey = RodModManager.slotNameOf(right, rodItem.rodType());
        if (slotKey != null && event.getPlayer() != null) {
            event.getPlayer().sendOverlayMessage(
                    net.minecraft.network.chat.Component.translatable(
                            "message.anglertackle.anvil_equipped",
                            net.minecraft.network.chat.Component.translatable("gui.anglertackle.slot." + slotKey),
                            right.getHoverName()));
        }
    }

    /**
     * 取走产出物：把被替换掉的旧配件还给玩家。
     *
     * <p>⚠ 这里读的是 {@code getLeft()}（左槽里**原来那根竿**），不是产出物：
     * 产出物是换好之后的竿，旧件在上面已经没有了。
     */
    @SubscribeEvent
    public static void onAnvilRepair(AnvilRepairEvent event) {
        // ⚠ 这个事件的取玩家方法是 getEntity()（AnvilRepairEvent → PlayerEvent → LivingEvent），
        //   没有 getPlayer()。写成 getPlayer() 编译器直接报"找不到符号"。
        Player player = event.getEntity();
        // 客户端也会跑一遍容器点击（预测），只有服务端能真给东西
        if (player.level().isClientSide()) {
            return;
        }

        ItemStack left = event.getLeft();
        ItemStack right = event.getRight();
        if (!(left.getItem() instanceof RodItem rodItem) || right.isEmpty()) {
            return;
        }

        // 槽位判定和"装上去"走**同一个方法**，否则可能退错槽位的那一件
        int slot = RodModManager.partSlotOf(right, rodItem.rodType());
        if (slot < 0) {
            return;   // 不是"装配件"这条路（原版自己的修复/合并），不掺和
        }

        ItemStack old = RodModManager.partAt(left, slot).copy();
        if (old.isEmpty()) {
            return;   // 这个槽位原本是空的，没有旧件可退
        }
        if (!player.getInventory().add(old)) {
            // 背包满 ⇒ **先寄信**（`docs/36` §4.1 第 10 条，2026-10-12 M4 改造）；
            // 邮箱也满 ⇒ MailReturns 内部退回"掉在脚下" ✓ 与砂轮那条共用同一个兜底策略。
            com.whitecobalt.anglertackle.mail.MailReturns.toMailboxOrDrop(player, old, "return_item");
        }
        AnglersTackle.LOGGER.info("[垂纶] 铁砧换件：旧配件 {} 退回背包（耐久 {}/{}）",
                old.getHoverName().getString(),
                old.getMaxDamage() - old.getDamageValue(), old.getMaxDamage());
    }
}
