package com.whitecobalt.anglertackle.mail;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;

import java.util.List;

/**
 * **"本该回到玩家手里的东西"**：先寄信，邮箱也满就退回原行为（掉在脚下）。
 *
 * <h2>为什么单独一个类</h2>
 * 铁砧拆配件、砂轮拆全套、以后可能还有别的（退件、找回）—— 这些路径的**兜底策略必须一致**：
 * "背包满 ⇒ 寄信；邮箱也满 ⇒ 掉在脚下"。
 * 两处各写一遍的话，迟早一处记得兜底、另一处忘了 ⇒ **那件配件当场消失** ✗
 * （比改造之前还糟：原来至少会掉在地上）。
 *
 * <p>⚠ 与 {@link MailService#deliver} 的三条政策配合：这里负责"**绝不静默丢**"这一条 ——
 * 两种投递方式（邮件 / 地面）**至少成功一种**，且失败时会明说（不让玩家以为东西没了）。
 */
public final class MailReturns {

    private MailReturns() {
    }

    /**
     * 把一件物品还给玩家：**优先寄信**（玩家清出格子后在邮箱里领），
     * 邮箱也满就**掉在脚下**（原行为，绝不丢）。
     *
     * <p>⚠ 形参是 {@code Player} 而不是 {@code ServerPlayer}：调用点在铁砧/砂轮事件里，
     * 那两个事件给的是 {@code Player}（服务端跑时实际就是 ServerPlayer）。
     * 这里**不硬转**：不是 ServerPlayer（理论上不会发生）就只走兜底 drop ✓。
     *
     * @param template 邮件模板 id（如 {@code return_item}）
     * @return true = 寄成了邮件；false = 走了兜底（掉在脚下）
     */
    public static boolean toMailboxOrDrop(net.minecraft.world.entity.player.Player player,
                                         ItemStack stack, String template) {
        if (player == null || stack == null || stack.isEmpty()) {
            return false;
        }
        if (player instanceof ServerPlayer sp) {
            try {
                MailService.Result r = MailService.deliver(sp, template, List.of(), 0L,
                        List.of(stack.copy()));
                if (r == MailService.Result.OK) {
                    sp.sendSystemMessage(Component.translatable(
                            "message.anglertackle.return_mailed", stack.getHoverName()));
                    return true;
                }
            } catch (Throwable t) {
                // 邮件那条路坏了也要能走到兜底（下面那句 drop），绝不让物品消失在异常里
                AnglersTackle.LOGGER.warn("[垂纶] 退件寄信失败，改走掉在脚下：{}", t.toString());
            }
        }
        // 邮箱满 / 寄信异常 ⇒ 退回原行为：掉在脚下（**绝不静默销毁**）
        player.drop(stack, false);
        if (player instanceof ServerPlayer sp) {
            sp.sendSystemMessage(Component.translatable(
                    "message.anglertackle.return_dropped", stack.getHoverName()));
        }
        return false;
    }
}
