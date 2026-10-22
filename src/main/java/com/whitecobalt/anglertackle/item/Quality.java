package com.whitecobalt.anglertackle.item;

import net.minecraft.ChatFormatting;

/**
 * 六档品质阶梯：白 → 绿 → 蓝 → 紫 → 金 → 红。
 *
 * <p><b>为什么要自己定义，而不用原版的 {@code Rarity}：</b>
 * MC 1.21.1 的 {@code Rarity} 只有四档
 * （COMMON / UNCOMMON / RARE / EPIC），**没有金和红**。
 * 而我们需要的完整阶梯是六档，所以自己定义一套，
 * 颜色仍然取原版 {@code ChatFormatting} 的官方值，视觉上和原版一致。
 *
 * <p>用法（和鱼获完全一致）：
 * <ol>
 *   <li>实现 {@link HasQuality} 返回该物品的品质</li>
 *   <li>{@code getName()} 里用 {@link #color()} 给名字上色</li>
 *   <li>tooltip 里补一行"品质：X"，方便在聊天栏也能读到档位</li>
 * </ol>
 */
public enum Quality {
    WHITE("common", ChatFormatting.WHITE),
    GREEN("uncommon", ChatFormatting.GREEN),
    BLUE("rare", ChatFormatting.BLUE),
    PURPLE("epic", ChatFormatting.LIGHT_PURPLE),
    GOLD("legendary", ChatFormatting.GOLD),
    RED("mythic", ChatFormatting.RED);

    private final String key;
    private final ChatFormatting color;

    Quality(String key, ChatFormatting color) {
        this.key = key;
        this.color = color;
    }

    /** 语言文件的键后缀（{@code tooltip.anglertackle.quality.<key>}）。 */
    public String key() {
        return key;
    }

    /** 该品质对应的名字颜色。 */
    public ChatFormatting color() {
        return color;
    }

    /**
     * 该品质的 ARGB 颜色（给自绘界面用）。
     *
     * <p>为什么不让界面各自写十六进制：tooltip 用的是 {@link ChatFormatting}、界面用的是 int，
     * 两套颜色手抄两份就会分叉 —— "图鉴里金字、tooltip 里白字"这种偏差玩家一眼看得出，
     * 却没有任何编译器管得住。这里取 {@code ChatFormatting} 的官方色值，
     * 界面与 tooltip 就是同一个来源。
     */
    public int argb() {
        Integer rgb = color.getColor();
        return 0xFF000000 | (rgb == null ? 0xFFFFFF : rgb);
    }

    /** 档位序号 0~5 → 品质；越界时夹到边界。 */
    public static Quality of(int tier) {
        Quality[] v = values();
        return v[Math.max(0, Math.min(v.length - 1, tier))];
    }

    /**
     * 原版 {@code Rarity} → 品质。
     *
     * <p>只用于配件这类"品质在定义时固定"的物品。
     * 注意 EPIC 会落到紫档——金/红档需要物品自己覆写
     * {@link HasQuality#quality()} 来指定（原版稀有度表达不了）。
     */
    public static Quality fromRarity(net.minecraft.world.item.Rarity rarity) {
        return switch (rarity) {
            case UNCOMMON -> GREEN;
            case RARE -> BLUE;
            case EPIC -> PURPLE;
            default -> WHITE;
        };
    }
}
