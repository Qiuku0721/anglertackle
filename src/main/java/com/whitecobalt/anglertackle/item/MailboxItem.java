package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.network.MailActionPayload;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.client.network.ClientPacketDistributor;

/**
 * **邮箱物品**（用户 2026-10-11 点名要的邮件系统；策划 `docs/36` §5.7 的主入口）。
 *
 * <p>右键 = 打开邮箱界面。与菜谱书（{@link CookbookItem}）**同一条形状**，理由也一样：
 * 开界面必须留在客户端专用类里 —— common 侧一旦写 {@code Minecraft.getInstance()}
 * 就会把客户端类拖进专用服务器（2026-10-03 整个模组装不进服务器的老事故）。
 * 所以：客户端发 {@link MailActionPayload#OPEN} → 服务端回一份快照 → 客户端开界面 ✓。
 *
 * <p>⚠ 这里**不做任何判定**（有没有邮件、能不能领）：那是服务端的事。
 * 物品只负责"我要看邮箱"这一句。
 */
public class MailboxItem extends Item {

    public MailboxItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResult use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide()) {
            // 只在客户端发（服务端发就变成 S→C 了，方向反了）
            ClientPacketDistributor.sendToServer(new MailActionPayload(MailActionPayload.OPEN, -1));
        }
        return InteractionResult.CONSUME.heldItemTransformedTo(stack);
    }
}
