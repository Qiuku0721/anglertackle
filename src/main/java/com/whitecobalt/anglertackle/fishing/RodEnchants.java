package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.item.RodItem;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;

/**
 * 模组的六个附魔（用户 2026-10-02 定案）在代码侧的读取口。
 *
 * <h2>为什么单独一个类</h2>
 * 附魔的**数值口径**分散在张力上限、断线、回拉、上鱼权重、金红概率、超承重烧耐久六处。
 * 每处各写一遍"读附魔等级 + 判断竿型"，改一次数值就要记得改六遍 ——
 * 所以读取与倍率只在**这里**算，那六处只调方法。数据（JSON/标签/出处）由
 * {@code tools/gen-enchantments.js} 生成，守着的是 {@code tools/check-enchantments.js}。
 *
 * <h2>三条铁律</h2>
 * <ol>
 *   <li><b>只在鱼竿上</b>：附魔的 {@code supported_items} 是我们自己的物品标签
 *       {@code #anglertackle:enchantable/rod}（只含模组那 10 把竿，不含原版鱼竿）——
 *       数据层已经限制住了，这里的读取也一样只看竿。</li>
 *   <li><b>竿型限定</b>：用户原话"提到特定杆子的默认仅对该类型竿子生效" →
 *       韧性保护 / 抢救 / 拉扯 / 承重保护**只在路亚竿上生效**（台钓竿带着也无效）。</li>
 *   <li><b>数值只在这里算</b>：倍率方法都返回"已经算好的乘数/加数"，
 *       调用点不要自己再乘一遍系数。</li>
 * </ol>
 */
public final class RodEnchants {

    private static final String NS = "anglertackle";

    /** 韧性保护：每级 路亚竿实际生效的线张力上限 +8%。 */
    public static final ResourceKey<Enchantment> REINFORCED = key("reinforced");
    /** 抢救：路亚即将红条断线时，张力强制退回黄/白交界（每场对抗一次）。 */
    public static final ResourceKey<Enchantment> RESCUE = key("rescue");
    /** 拉扯：每级 路亚双回拉速度 +5%。 */
    public static final ResourceKey<Enchantment> DRAG = key("drag");
    /** 精准猎获：每级 鱼饵的上鱼类型权重（词条加权）额外 +2%（加算）。 */
    public static final ResourceKey<Enchantment> PRECISE_HUNT = key("precise_hunt");
    /** 高质吸引：每级 金/红品质鱼上鱼概率 +1%（百分点）。 */
    public static final ResourceKey<Enchantment> HIGH_QUALITY_LURE = key("high_quality_lure");
    /** 承重保护：每级 路亚钓获超承重鱼时耐久削减 −20%。 */
    public static final ResourceKey<Enchantment> LOAD_BEARING = key("load_bearing");

    /** 每级的系数（用户原话里的百分比，集中在这里，别散到调用点）。 */
    public static final double REINFORCED_PER_LEVEL = 0.08;
    public static final double DRAG_PER_LEVEL = 0.05;
    public static final int PRECISE_HUNT_PERCENT_PER_LEVEL = 2;
    public static final double HIGH_QUALITY_PCT_PER_LEVEL = 1.0;
    public static final double LOAD_BEARING_PER_LEVEL = 0.20;

    private RodEnchants() {
    }

    private static ResourceKey<Enchantment> key(String path) {
        return ResourceKey.create(Registries.ENCHANTMENT, Identifier.fromNamespaceAndPath(NS, path));
    }

    /** 这个物品栈上某个模组附魔的等级（0 = 没有）。非鱼竿一律 0。 */
    public static int level(ItemStack stack, ResourceKey<Enchantment> which) {
        if (stack == null || stack.isEmpty() || !(stack.getItem() instanceof RodItem)) {
            return 0;
        }
        for (var e : stack.getEnchantments().entrySet()) {
            if (e.getKey().unwrapKey().filter((k) -> k.equals(which)).isPresent()) {
                return e.getIntValue();
            }
        }
        return 0;
    }

    /** 这根竿是不是路亚竿（竿型限定的四个附魔只对它生效）。 */
    public static boolean isLure(ItemStack stack) {
        return stack != null && !stack.isEmpty()
                && stack.getItem() instanceof RodItem rod && rod.rodType() == RodItem.RodType.LURE;
    }

    /**
     * 张力上限倍率（韧性保护）。
     *
     * <p>用户原话："每级使得路亚竿的鱼线张力上限**在实际生效时**提升 8%" ——
     * "实际生效"四个字很关键：断线判定、白/黄区划分、客户端张力条读的都是
     * {@code FishingSession.tensionCeiling()}，所以倍率加在**那一个方法**上就全部生效；
     * 只在显示上加、判定还用旧值的话，表现就是"条子变长了但还是在老位置断线"。
     */
    public static double ceilingMultiplier(ItemStack rod, int level) {
        return isLure(rod) ? 1.0 + REINFORCED_PER_LEVEL * Math.max(0, level) : 1.0;
    }

    /** 双回拉速度倍率（拉扯）—— 只对路亚。 */
    public static double pullMultiplier(ItemStack rod, int level) {
        return isLure(rod) ? 1.0 + DRAG_PER_LEVEL * Math.max(0, level) : 1.0;
    }

    /** 超承重耐久削减倍率（承重保护）—— 只对路亚；1.0 = 不变，最低 0（不会变成倒扣）。 */
    public static double overCapacityBurnMultiplier(ItemStack rod, int level) {
        if (!isLure(rod)) {
            return 1.0;
        }
        return Math.max(0.0, 1.0 - LOAD_BEARING_PER_LEVEL * Math.max(0, level));
    }

    /** 词条加权的额外百分点（精准猎获）—— 加在 {@code FishHabits.BONUS_PERCENT} 上，加算。 */
    public static int habitBonusExtraPercent(int level) {
        return PRECISE_HUNT_PERCENT_PER_LEVEL * Math.max(0, level);
    }

    /** 金/红品质概率的额外百分点（高质吸引）。 */
    public static double highQualityExtraPercent(int level) {
        return HIGH_QUALITY_PCT_PER_LEVEL * Math.max(0, level);
    }
}
