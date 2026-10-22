package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.network.CodexRequestPayload;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
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
 * 鱼类图鉴书：右键打开图鉴界面。
 *
 * <h2>为什么由**客户端**发请求（和 {@code GuideBookItem} 相反）</h2>
 * 教程书是"服务端主动推"：玩家一右键，服务端就把那一章发下来。
 * 图鉴这里改成"客户端请求 → 服务端回包"，原因有两条：
 * <ol>
 *   <li>图鉴要的是**这个玩家此刻的完整记录**，而"要不要开界面"纯粹是客户端的事
 *       （专用服务器上玩家可能只是在右键试物品）。让服务端先发一整份数据再让客户端
 *       决定开不开，等于每次右键都白推几百字节；</li>
 *   <li>请求是幂等的、无参数的：服务端只认"谁在问"，客户端报什么都不影响结果
 *       （见 {@link com.whitecobalt.anglertackle.fishing.CodexSnapshot}），
 *       所以多做一次请求刷不出任何东西。</li>
 * </ol>
 *
 * <h2>数据不放在物品里</h2>
 * 图鉴是**玩家数据**（{@code PlayerFishingData} 附件），不是这本书的 NBT。
 * 所以书可以被丢掉、放箱子、给别人，图鉴一点都不受影响 ——
 * 想要面板时随便再做一本就是了（配方很便宜）。
 */
public class CodexBookItem extends Item {

    public CodexBookItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide()) {
            // 只在客户端发：服务端 use() 里发的话方向就反了（那会变成 S→C 请求）。
            PacketDistributor.sendToServer(CodexRequestPayload.INSTANCE);
        }
        // 两端都 consume：不 consume 的话接着会走"物品使用"的后续分支
        //（挥手动画 / 副手判定 / 吃掉之类），表现成"右键了但什么也没发生"。
        return InteractionResultHolder.consume(stack);
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context, List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable("tooltip.anglertackle.codex_hint")
                .withStyle(ChatFormatting.GRAY));
    }
}
