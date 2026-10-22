package com.whitecobalt.anglertackle.fishing;

import net.minecraft.world.food.FoodProperties;

/**
 * 烹饪数值：**只跟鱼的档位走**（用户 2026-10-03 定案）。
 *
 * <h2>用户原话</h2>
 * <blockquote>
 * "根据鱼品质做饱食度区分，即使同一道菜只要制作的鱼档次不同回复的饱食度就不同。
 * 即使一样的鱼品质不同饱食度回复也不同，根据品质每差一级饱和度与饱食度可以差**半格**
 * （需要注意这个"格"的说法可能与数值表不大相似，比如原版是 10 格血的目标在显示中是 20 滴血）。
 * 每个档次再差半格（如优质鱼肉与顶级鱼排），但无论如何加工成的烹饪品
 * **至少比熟鱼块高半格**饱食度与饱和度。"
 * </blockquote>
 *
 * <h2>单位（用户专门提醒的那句）</h2>
 * <b>1 格 = 一个完整的鸡腿图标 = 2 点 {@code nutrition}</b>；
 * <b>半格 = 1 点</b>。玩家看到的是图标（"格"），代码里存的是点数 ——
 * 本类里的数字一律是**点数**，注释里同时写出"几格"。
 *
 * <h2>阶梯（点数）</h2>
 * <pre>
 *   档位     0白   1绿   2蓝   3紫   4金   5红
 *   熟鱼块    3     4     5     6     7     8      ← 3 + 档位
 *   菜        4     5     6     7     8     9      ← 熟块 + 1（半格）
 * </pre>
 * 三条性质都由本类保证，`tools/check-food-values.js` 会逐条复算：
 * <ol>
 *   <li><b>每差一级差半格</b>：{@code cookedHunger(t+1) - cookedHunger(t) == 1}；</li>
 *   <li><b>每个材料档次再差半格</b>：普通(0,1) / 优质(2,3) / 顶级(4,5) 三段的**交界处**
 *       也正好差 1 点（1→2、3→4），不会出现"两个档次数值撞在一起"；</li>
 *   <li><b>菜至少比熟块高半格</b>：{@code dishHunger(t) - cookedHunger(t) == 1}。</li>
 * </ol>
 * 另外设计稿（docs/25 §5）那三个锚点 4 / 6 / 8 正好落在三段各自的**低档**上
 * （0白=4、2蓝=6、4金=8），所以定案与旧稿不冲突，只是把"三段"细化成了"六档"。
 *
 * <h2>饱和度</h2>
 * 与饱食度**同值**：{@code saturationModifier = 0.5}，最终饱和度 = {@code nutrition × 0.5 × 2}。
 * （第一版写的是 1.0，于是实际饱和度是设计值的两倍 —— 见 docs/27 §3 的偏差记录。）
 */
public final class FoodValues {

    private FoodValues() {
    }

    public static final int MIN_TIER = 0;
    public static final int MAX_TIER = 5;

    /** 熟鱼块的饱食度（点）：3 + 档位 → 3…8 点（1.5 ~ 4 格）。 */
    public static int cookedHunger(int tier) {
        return 3 + clampTier(tier);
    }

    /**
     * 菜的饱食度（点）：同档熟块 **+ 半格** → 4…9 点（2 ~ 4.5 格）。
     *
     * <p>用户要求的下限就是这条（"至少比熟鱼块高半格"），这里做成**恰好**半格：
     * 简单、不会因为某项改动意外跌破下限。
     */
    public static int dishHunger(int tier) {
        return cookedHunger(tier) + 1;
    }

    /** 饱和度与饱食度同值（modifier 0.5）。 */
    public static float saturationModifier() {
        return 0.5f;
    }

    public static int clampTier(int tier) {
        // 创造模式拿的鱼档位是 -1（TIER_UNKNOWN）→ 按最低档算
        return Math.max(MIN_TIER, Math.min(MAX_TIER, tier));
    }

    /** 熟鱼块的食物属性（熔炉/烟熏炉/营火产出、以及创造兜底）。 */
    public static FoodProperties cooked(int tier) {
        return build(cookedHunger(tier));
    }

    /** 成品菜的食物属性（工作台做菜、熏鱼、炭烤鱼）。 */
    public static FoodProperties dish(int tier) {
        return build(dishHunger(tier));
    }

    private static FoodProperties build(int hunger) {
        return new FoodProperties.Builder()
                .nutrition(hunger)
                .saturationModifier(saturationModifier())
                .build();
    }
}
