package com.whitecobalt.anglertackle.item;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/**
 * 鱼刀：切鱼、做刺身用的工具。
 *
 * <p>用户 2026-10-03 定的配方：**铁锭 + 任意木头按钮 + 木棍**
 * （<b>按钮</b>用原版物品标签 {@code minecraft:wooden_buttons}，11 种木头都认）。
 *
 * <h2>耐久 64，且做菜时**不被消耗**</h2>
 * 见 docs/25 §14.6.3：做一次刺身只掉 1 点耐久，刀还在（玩家不该为了吃口生鱼
 * 反复重打一把刀）。⚠ 那条规则**不在这个类里** —— 它必须由刺身配方覆写
 * {@code Recipe#getRemainingItems} 才生效（原版只对"容器"自动返还，
 * 对工具类材料一概吞掉）。这里只负责三件事：耐久上限、铁砧可修、tooltip 交代清楚。
 */
public class FishKnifeItem extends Item {

    /** 耐久上限。和 docs/25 §14.6.3 表里的数字必须一致（check-kitchen-items.js 会核对）。 */
    public static final int DURABILITY = 64;

    public FishKnifeItem(Properties properties) {
        super(properties);
    }

    /**
     * 铁砧上可以用**铁锭**修：配方主体就是铁锭，修理材料跟着它走一条线，
     * 玩家不用另记第二种材料。{@code super} 里保留原版逻辑（同物品互修）。
     */
    @Override
    public boolean isValidRepairItem(ItemStack stack, ItemStack repairCandidate) {
        return repairCandidate.is(Items.IRON_INGOT) || super.isValidRepairItem(stack, repairCandidate);
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable("tooltip.anglertackle.fish_knife")
                .withStyle(ChatFormatting.AQUA));
        lines.add(Component.translatable("tooltip.anglertackle.fish_knife_durability", DURABILITY)
                .withStyle(ChatFormatting.DARK_GRAY));
    }
}
