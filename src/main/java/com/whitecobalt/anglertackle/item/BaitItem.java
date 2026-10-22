package com.whitecobalt.anglertackle.item;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/**
 * 鱼饵（消耗品）。
 *
 * <p>鱼饵在品质系统里承担两个作用（见 docs/02-钓鱼小游戏机制.md §7.3）：
 * <ol>
 *   <li><b>品质下限</b>：低于此档位的鱼不会咬钩</li>
 *   <li><b>体型门槛</b>：小饵钓不到大鱼（面包屑只能钓 ≤1kg）</li>
 * </ol>
 *
 * <p>台钓竿只接受 {@code floatRodAllowed} 为 true 的饵——
 * 也就是"淡水台钓现实中真会用的饵"（面包屑/蚯蚓/玉米粒/活虾/发光饵/秘制香饵）。
 * 拟饵是路亚竿的专用件，不在这里。
 *
 * @param tier                品质下限的档位序号（0 白 / 1 绿 / 2 蓝 / 3 紫 / 4 金 / 5 红）
 * @param maxWeightKg         能钓到的最大体重（0 = 无上限）
 * @param minWeightKg         体型门槛：比这更轻的鱼不会咬钩
 * @param floatRodAllowed     台钓竿是否可用
 * @param coinValue           单价（鱼币）
 * @param attractionBonus     对特定鱼种的额外吸引倍率（1.0 = 无加成）
 */
public class BaitItem extends Item {

    private final int tier;
    private final double maxWeightKg;
    private final double minWeightKg;
    private final boolean floatRodAllowed;
    private final int coinValue;
    private final double attractionBonus;

    public BaitItem(int tier, double maxWeightKg, double minWeightKg, boolean floatRodAllowed,
                    int coinValue, double attractionBonus, Properties properties) {
        super(properties);
        this.tier = tier;
        this.maxWeightKg = maxWeightKg;
        this.minWeightKg = minWeightKg;
        this.floatRodAllowed = floatRodAllowed;
        this.coinValue = coinValue;
        this.attractionBonus = attractionBonus;
    }

    public int tier() {
        return tier;
    }

    public double maxWeightKg() {
        return maxWeightKg;
    }

    public double minWeightKg() {
        return minWeightKg;
    }

    /** 台钓竿能不能用这种饵。 */
    public boolean floatRodAllowed() {
        return floatRodAllowed;
    }

    public int coinValue() {
        return coinValue;
    }

    public double attractionBonus() {
        return attractionBonus;
    }

    /**
     * 这种饵把咬钩等待压低多少（%，0白 … 5红）。
     *
     * <p>规则（档位映射 + 加算）全部在
     * {@link com.whitecobalt.anglertackle.fishing.BiteTiming} ——
     * 这里只是"我这一档是多少"的入口。展示端与实际生效的那条链
     * （{@code FishingSession.beginWaiting}）问的是**同一个方法**，
     * 免得再出现"tooltip 一份、代码一份"的漂移
     * （"档位映射手抄一份"这个错在本仓库已经犯过三次，
     * 见 {@link #tierColor(int)} 的注释）。
     *
     * <p>⚠ 只有**台钓竿**吃这一项；路亚竿的竿型判断在
     * {@code BiteTiming.totalCut(boolean, double)} 里，不在调用点各写一遍。
     */
    public double cutPercent() {
        return com.whitecobalt.anglertackle.fishing.BiteTiming.baitCutPercent(this.tier);
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        // ★ 用法那一句（用户 2026-10-01 定案：用**初版未删减**的说明）。
        //
        //   放在最前面：下面全是**由配置现算**的数字行（占比/门槛/上限/定向吸引），
        //   先给一句"这是什么饵"，再给数字，读起来才像说明书而不是参数表。
        //
        //   ⚠ 说明文字里**故意不写数字**：初版那份草稿是独立的一页，
        //   所以括号里带着"（体型上限 1 kg）""金红鱼占比提到 4.5%"。
        //   而这些数字下面几行已经按**真实配置**现算出来了（改配置会跟着变），
        //   照抄一份进语言文件就会变成"两处同样的数字、其中一处永不更新"——
        //   正是本仓库最忌讳的那种漂移。
        lines.add(Component.translatable("tooltip.anglertackle." + baitId(stack) + ".desc")
                .withStyle(ChatFormatting.DARK_GRAY));

        // ★ 咬钩快慢（用户定案 2026-10-02："台钓的咬钩时间单独下降 30%，
        //   台钓饵料对咬钩时间也进行下降……数值属于加算"）。
        //   这一行必须**和 Config 现算**，不能手抄 —— 手抄的那一份会在下次调数值时
        //   变成"tooltip 上写着 16%、实际按 12% 算"，正是本仓库最忌讳的漂移。
        //   竿的 −30% 在 RodItem 那边，两边各显示各的，加算关系写在手册里。
        double cut = cutPercent();
        if (floatRodAllowed && cut > 0) {
            lines.add(Component.translatable("tooltip.anglertackle.bait_cut_time",
                            com.whitecobalt.anglertackle.fishing.BiteTiming.percentText(cut))
                    .withStyle(ChatFormatting.AQUA));
        }

        // ★ 口径已按用户定案改成"提升高价值鱼概率"，tooltip 必须跟着改。
        //   原来这里显示的是"品质下限：X"，而台钓饵料**已经不再提升下限**了 ——
        //   留着那行就是在骗玩家（用户原话："我知道内容改了，但描述没改"）。
        double hv = highValueTargetPct();
        if (hv > 0) {
            lines.add(Component.translatable("tooltip.anglertackle.bait_hv_target",
                            String.format("%.0f%%", hv))
                    .withStyle(ChatFormatting.GOLD));
        } else {
            lines.add(Component.translatable("tooltip.anglertackle.bait_hv_none")
                    .withStyle(ChatFormatting.DARK_GRAY));
        }
        // 不再设下限，明确写出来（免得玩家按老版本的认知去选饵）
        lines.add(Component.translatable("tooltip.anglertackle.bait_no_floor")
                .withStyle(ChatFormatting.DARK_GRAY));
        if (minWeightKg > 0) {
            lines.add(Component.translatable("tooltip.anglertackle.bait_min_weight",
                    String.format("%.1f", minWeightKg)).withStyle(ChatFormatting.GRAY));
        }
        if (maxWeightKg > 0) {
            lines.add(Component.translatable("tooltip.anglertackle.bait_max_weight",
                    String.format("%.1f", maxWeightKg)).withStyle(ChatFormatting.GRAY));
        } else {
            lines.add(Component.translatable("tooltip.anglertackle.bait_no_limit")
                    .withStyle(ChatFormatting.GRAY));
        }
        if (attractionBonus > 1.0) {
            lines.add(Component.translatable("tooltip.anglertackle.bait_attraction",
                    String.format("x%.1f", attractionBonus)).withStyle(ChatFormatting.AQUA));
        }
        lines.add(Component.translatable(floatRodAllowed
                        ? "tooltip.anglertackle.bait_float_ok"
                        : "tooltip.anglertackle.bait_float_no")
                .withStyle(floatRodAllowed ? ChatFormatting.GREEN : ChatFormatting.RED));
        // ⚠ 这里曾经有一行「参考价：X 鱼币」（tooltip.anglertackle.bait_price）。
        //   删掉的原因（用户 2026-10-01）：它是**上古遗留**——鱼饵的 coinValue 是定死
        //   在物品定义里的旧数值，而商店早就改成走 ShopCatalog 的定价了，于是
        //   tooltip 上同时出现"参考价 300"和"价值 200"两个数字，前者还是错的。
        //   真正该看的是下面那行"价值"（由商店统一给出）。
        lines.add(Component.translatable("tooltip.anglertackle.bait_consumed")
                .withStyle(ChatFormatting.DARK_GRAY));
    }

    /**
     * 物品的注册名（不带命名空间），用来拼语言键 {@code tooltip.anglertackle.<id>.desc}。
     *
     * <p>和 {@code TacklePartItem.itemId} 是同一套写法：说明文字全部挂在物品 id 上，
     * 缺 key 由 {@code tools/check-fish-habits.js} 在构建期拦住
     * （它会把 ModItems 里注册的每个 {@code bait_*} / {@code lure_*} 都点一遍名）。
     */
    private static String baitId(ItemStack stack) {
        return net.minecraft.core.registries.BuiltInRegistries.ITEM
                .getKey(stack.getItem()).getPath();
    }

    /**
     * 这种饵把"金+红鱼种"的总占比拉到多少（%）；&lt;=0 表示不调整。
     *
     * <p>数值定义在 {@code FishingSession.targetHighValuePct}，
     * 这里只做展示。之所以不在这边写死一份：这个错已经犯过三次
     * （档位映射手抄一份），两边各写一份必然漂移。
     */
    private double highValueTargetPct() {
        return switch (tier) {
            case 4 -> 3.0;    // 金饵
            case 5 -> 10.0;   // 红饵
            default -> -1.0;
        };
    }

    /**
     * 档位 → 名字颜色。走 {@link Quality}，不再手写一份。
     *
     * <p><b>⚠ 这里曾经手写 switch，整列偏低一档。</b>
     * 原来是 {@code case 1 -> GREEN ... case 5 -> RED}，等于假定"绿是第 2 档"——
     * 但 {@link Quality} 里绿是**第 1 档**（白是第 0 档）。
     * 于是紫饵显示成蓝、金饵显示成紫、红饵显示成金，白/绿两档看着正常
     * （白落在 default、绿恰好对上），所以只有高档露馅。
     * 玩家报的就是这个："蓝饵变绿，紫变蓝，金变紫，红变金"。
     *
     * <p>（原还有一个 {@code tierName} 做同样的事给 tooltip 用，
     * 但 tooltip 已改成显示"高价值鱼目标占比"，不再显示档位名，故删除。）
     */
    private static ChatFormatting tierColor(int tier) {
        return Quality.of(tier).color();
    }

    /**
     * 饵料名按品质着色——和鱼获 / 配件 / 鱼线走**同一套**颜色约定。
     *
     * <p>之前少了这个覆写，6 种饵的名字全是原版白色，
     * 而 tooltip 里那行"品质下限：X"是有颜色的，
     * 于是"名字白、下面一行彩色"，看起来就像品质乱了。
     */
    @Override
    public Component getName(ItemStack stack) {
        if (stack.has(net.minecraft.core.component.DataComponents.CUSTOM_NAME)) {
            return super.getName(stack);   // 铁砧改过名就不覆盖
        }
        return super.getName(stack).copy().withStyle(tierColor(this.tier));
    }
}
