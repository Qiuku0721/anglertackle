package com.whitecobalt.anglertackle.guide;

import com.whitecobalt.anglertackle.network.GuidePayload;
import com.whitecobalt.anglertackle.network.GuideRequestPayload;
import com.whitecobalt.anglertackle.network.ModNetwork;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.network.PacketDistributor;

import java.util.List;

/**
 * 钓鱼手册（教程书）。
 *
 * <p>使用时由服务端把当前章节内容随包发给客户端（见 {@link GuidePayload}），
 * 所以专用服务器上也能正常翻阅——客户端不需要自己读数据文件。
 */
public class GuideBookItem extends Item {

    /** 上次翻到的章节（客户端本地记忆，打开时回到上次那页）。 */
    private static int lastChapter = 0;

    public GuideBookItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide()) {
            return InteractionResultHolder.consume(stack);
        }
        if (player instanceof ServerPlayer serverPlayer) {
            ModNetwork.sendTo(serverPlayer, GuidePayload.of(lastChapter));
        }
        return InteractionResultHolder.consume(stack);
    }

    /** 打开指定章节（由界面里的目录点击触发）。 */
    public static void requestChapter(int index) {
        lastChapter = Math.max(0, index);
        PacketDistributor.sendToServer(new GuideRequestPayload((byte) lastChapter));
    }

    public static int lastChapter() {
        return lastChapter;
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context, List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable("tooltip.anglertackle.guide_hint")
                .withStyle(ChatFormatting.GRAY));
    }
}
