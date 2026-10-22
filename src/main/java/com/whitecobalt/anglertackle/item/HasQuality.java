package com.whitecobalt.anglertackle.item;

import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;

/**
 * 带品质的物品：名字按品质着色，tooltip 里补一行"品质：X"。
 *
 * <p>和鱼获用的是同一套 {@link Quality} 与同一套显示方式，
 * 玩家只要学会一次"颜色 = 品质"就能读所有物品。
 */
public interface HasQuality {

    /** 这个物品栈当前的品质。 */
    Quality quality(ItemStack stack);

    /**
     * 按品质给名字上色。
     *
     * <p>默认实现已经够用，实现类只要在 {@code getName} 里调用它：
     * <pre>{@code
     * @Override
     * public Component getName(ItemStack stack) {
     *     return HasQuality.applyQuality(super.getName(stack), this, stack);
     * }
     * }</pre>
     *
     * <p>玩家用铁砧改过名字（有 {@code CUSTOM_NAME} 组件）时**不上色**，
     * 免得把人家的命名覆盖掉。
     */
    static Component applyQuality(Component base, HasQuality item, ItemStack stack) {
        if (stack.has(net.minecraft.core.component.DataComponents.CUSTOM_NAME)) {
            return base;
        }
        return base.copy().withStyle(item.quality(stack).color());
    }

    /** tooltip 用的"品质：X"那一行。 */
    default Component qualityLine(ItemStack stack) {
        return Component.translatable("tooltip.anglertackle.quality_line",
                        Component.translatable("tooltip.anglertackle.quality." + quality(stack).key()))
                .withStyle(quality(stack).color());
    }
}
