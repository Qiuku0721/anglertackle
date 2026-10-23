package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.network.CookbookRequestPayload;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.network.PacketDistributor;

import java.util.List;

/**
 * 菜谱（2026-10-03 用户："制作菜谱，菜谱合成方式（原版任意熟鱼加书）"）。
 *
 * <h2>它和图鉴书、教程书的分工</h2>
 * <ul>
 *   <li><b>教程书</b>：讲"怎么玩"（章节式正文，内容在数据包里，整合包可覆盖）；</li>
 *   <li><b>图鉴</b>：讲"我钓到过什么"（玩家数据）；</li>
 *   <li><b>菜谱</b>：讲"这道菜怎么做、吃了会怎样" —— <b>全部是静态表</b>：
 *       材料来自 {@code DishRecipe.allowedPairs()}，效果来自 {@code DishEffects.grantsFor()}，
 *       饱食度来自 {@code FoodValues}。所以它不需要任何玩家数据。</li>
 * </ul>
 *
 * <h2>为什么还是走"请求 → 下发"两个包，而不是点一下直接开界面</h2>
 * 内容确实不需要同步，但**开界面这件事必须留在客户端专用类里**。这个类在 common 侧，
 * 一旦在这里写 {@code Minecraft.getInstance().setScreen(...)}，专用服务器加载这个物品类时
 * 就会去加载客户端类 —— 本仓库在 2026-10-03 就是因为同类问题（对客户端类型做 instanceof）
 * 整个模组装不进专用服务器。所以照抄图鉴书的形状：客户端发请求、服务端回一个空载包、
 * 由 {@code ClientPayloadHandlers}（{@code Dist.CLIENT}）开界面。
 */
public class CookbookItem extends Item {

    public CookbookItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResult use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide()) {
            // 只在客户端发：服务端 use() 里发的话方向就反了（那会变成 S→C 请求）
            PacketDistributor.sendToServer(CookbookRequestPayload.INSTANCE);
        }
        // 两端都 consume：不 consume 的话会接着走"物品使用"的后续分支（挥手 / 副手判定），
        // 表现成"右键了但什么也没发生"
        return InteractionResult.CONSUME.heldItemTransformedTo(stack);
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable("tooltip.anglertackle.cookbook_hint")
                .withStyle(ChatFormatting.GRAY));
    }
}
