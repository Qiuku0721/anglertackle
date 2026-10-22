package com.whitecobalt.anglertackle.effect;

import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * 效果的**人话文案**（菜品 tooltip 与菜谱界面共用同一份）。
 *
 * <p>为什么要单独一个类：同一句话现在有两个出口 —— 物品悬浮（{@code DishItem}，common 侧）
 * 和菜谱界面（{@code CookbookScreen}，client 侧）。两边各写一遍必然会分叉，
 * 而"玩家看到的时长"和"实际给的时长"分叉是**看不出来**的那类 bug
 * （数字都很合理，只是不一样）。
 *
 * <p><b>等级名为什么不用原版的 {@code enchantment.level.N}</b>：那是原版自带的键没错，
 * 但它属于"代码里拼前缀、语言文件里一个键都没有"的那一类 ——
 * {@code tools/check-lang.js} 的拼接键检查会（正确地）把它判成"游戏里会显示成原始键名"。
 * 与其给检查器开一个白名单口子（口子会烂），不如自己维护一张罗马数字表：
 * 只有 I…X 十个值，中英完全一样，也不需要翻译。
 */
public final class EffectText {

    private EffectText() {
    }

    /** 等级名（罗马数字；超过 X 退回阿拉伯数字 —— 现在的至高最多到 5）。 */
    private static final String[] ROMAN = {
            "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"
    };

    /**
     * 一条效果："海洋亲和 IV · 16:00"。
     *
     * @param grant 来自 {@link DishEffects#grantsFor}，所以**等级与时长就是实际会发的**，
     *              不是另抄一份策划数值
     */
    public static MutableComponent line(DishEffects.Grant grant) {
        return Component.translatable("tooltip.anglertackle.effect_line",
                grant.effect().value().getDisplayName(),
                levelName(grant.level()),
                duration(grant.durationTicks()));
    }

    /** 等级名（罗马数字）。 */
    public static String levelName(int level) {
        int l = Math.max(1, level);
        return l <= ROMAN.length ? ROMAN[l - 1] : String.valueOf(l);
    }

    /**
     * 时长文案：满 1 分钟写 {@code m:ss}（与原版药水一致），不足 1 分钟写 {@code 30s}。
     *
     * <p>不足一分钟的那种（速度 20s / 生命恢复 5s / 饱腹 10s）如果也写成 {@code 0:20}，
     * 会被误读成"20 分钟" —— 短效果在菜里很常见，所以单独一档。
     */
    public static String duration(int ticks) {
        int seconds = Math.max(0, ticks) / 20;
        int minutes = seconds / 60;
        int rest = seconds % 60;
        return minutes > 0 ? minutes + ":" + (rest < 10 ? "0" : "") + rest : rest + "s";
    }
}
