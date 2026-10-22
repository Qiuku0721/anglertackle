package com.whitecobalt.anglertackle.item;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/**
 * 调料 / 加工食材（盐、酱油、芥末、鱼油）。
 *
 * <p>见 docs/25 §3.1：这三样调料是**新加的物品**，其余"葱姜蒜油糖"全借原版物，
 * 所以它们每一个都必须自己说清"干什么用的"—— 玩家在物品栏里看到"芥末"，
 * 不该靠猜它跟谁配。
 *
 * <p>tooltip 文案走语言键 {@code tooltip.anglertackle.<id>}，
 * **不在 Java 里写中文**（本模组所有面向玩家的文案都在 lang 文件里，
 * 英文用户才不会看到中文）。
 *
 * <p>颜色按用途分：调料一种色、加工食材另一种色，扫一眼就知道是"佐料"还是"材料"。
 */
public class SeasoningItem extends Item {

    private final String tooltipKey;
    private final ChatFormatting color;

    /**
     * @param id         物品 id（同时也是语言键中段：{@code tooltip.anglertackle.<id>}）
     * @param color      tooltip 那一行的颜色
     * @param properties 物品属性
     */
    public SeasoningItem(String id, ChatFormatting color, Properties properties) {
        super(properties);
        this.tooltipKey = "tooltip.anglertackle." + id;
        this.color = color;
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        lines.add(Component.translatable(tooltipKey).withStyle(color));
    }
}
