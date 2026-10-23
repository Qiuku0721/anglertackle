package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.economy.CoinPricing;
import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.TooltipDisplay;
import net.minecraft.world.item.TooltipFlag;

import java.util.function.Consumer;

/**
 * 鱼获物品。
 *
 * <p>关键设计（docs/02-钓鱼小游戏机制.md §5.1）：**体长与重量在咬钩时就由服务端生成**，
 * 存在 {@code FISH_DATA} 组件里，物品本身只是它的容器。这样：
 * <ul>
 *   <li>玩家重连/掉线无法刷新数值</li>
 *   <li>同种鱼可以有无数个个体（不同长度/重量/评级）</li>
 *   <li>图鉴、排行榜、售价都读同一份数据</li>
 * </ul>
 *
 * <p>M1 阶段鱼获只是"占位产物"，M3 接入完整的 10 种鱼与图鉴。
 */
public class FishItem extends Item implements HasQuality {

    public FishItem(Properties properties) {
        super(properties);
    }

    /** 品质由体重决定（咬钩时就已算好，存在 FISH_DATA 里）。 */
    @Override
    public Quality quality(ItemStack stack) {
        var data = stack.get(ModDataComponents.FISH_DATA.get());
        return data == null ? Quality.WHITE : data.quality();
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                TooltipDisplay display, Consumer<Component> builder, TooltipFlag flag) {
        var data = stack.get(ModDataComponents.FISH_DATA.get());
        if (data == null) {
            builder.accept(Component.translatable("tooltip.anglertackle.fish_no_data")
                    .withStyle(ChatFormatting.DARK_GRAY));
            return;
        }

        // ★ 品质：和配件用同一套显示方式（颜色 = 品质，玩家学一次就够）
        builder.accept(qualityLine(stack));

        builder.accept(Component.translatable("tooltip.anglertackle.fish_length",
                String.format("%.1f", data.lengthCm())).withStyle(ChatFormatting.GRAY));
        builder.accept(Component.translatable("tooltip.anglertackle.fish_weight",
                String.format("%.2f", data.weightKg())).withStyle(ChatFormatting.GRAY));

        // ★ 尺寸评级：同种鱼也有 5 档追求（幼体→纪录级），
        //   以前这个信息**只在图鉴里能看到**，鱼拿在手上反而不知道自己是哪一档。
        //   它是玩家"这条鱼好不好"的第二个维度（第一是品质），该在面板上。
        //   ⚠ 评级那一小段按**档位颜色**上色（2026-10-03 用户："该显示颜色的文本却是白色"）：
        //   整行 GRAY 会让"纪录级"和"幼体"看起来一样，而它俩差 3.5 倍售价。
        builder.accept(Component.translatable("tooltip.anglertackle.fish_grade",
                        Component.translatable("grade.anglertackle." + data.grade().key())
                                .withStyle(Quality.of(data.effectiveTier()).color()))
                .withStyle(ChatFormatting.GRAY));

        // ★ 售价 —— 这条鱼的"数据面板"里最该有的一行。
        //
        // 鱼币**不靠上鱼白给**：钓上来只是进包，钱要拿鱼去 NPC 商店卖才有。
        // 所以这里必须把价标出来，否则玩家在卖之前完全不知道哪条值得留、
        // 哪条可以随手卖 —— 那商店就成了盲盒。
        //
        // 用 [售价] 这种方括号前缀而不是单开一行小字：它和图鉴里的说明行
        // 视觉上要能分开，玩家扫一眼就知道这行是钱。
        builder.accept(Component.translatable("tooltip.anglertackle.fish_value",
                        String.format("%,d", sellValue(stack)))
                .withStyle(ChatFormatting.GOLD));

        // ★ 味道 / 能不能吃（L0~L5，依据见 docs/料理适配策划案.md；用户 2026-10-11："加 debuff 提示"）——
        //   ⚠ 文案**来自 FishPalatability**（与真正发效果、与菜谱「效果」页、与菜的悬浮文本
        //     共用同一个 biteOf）。这里**不许**自己抄一份"哪条鱼有什么负面"的表（docs/29 的纪律）。
        //
        //   为什么要写在**整鱼**上：L5 那五条鱼（孔雀鱼 / 非洲蝴蝶鱼 / 红宝石鱼 / 长吻象鼻鱼 / 盲鱼）
        //   什么菜都做不了，而它们**永远不出现在菜谱里**（本来就不在菜品菜单里）——
        //   于是玩家只能在这里知道"为什么"（不是难吃，是**没有食用记录 / 受保护**）。
        //   整鱼是生的，所以 L2 显示的就是"生食：有几率反胃（煮熟就没事）"，正是玩家此刻该知道的事。
        //
        //   L0/L1 的鱼两行都不出现 ⇒ 悬浮文本与改动前**逐字一致**。
        if (!com.whitecobalt.anglertackle.recipe.FishPalatability.inDishMenu(data.speciesId())) {
            builder.accept(Component.translatable(
                            com.whitecobalt.anglertackle.recipe.FishPalatability.INEDIBLE_KEY)
                    .withStyle(ChatFormatting.RED));
        } else {
            String rawWarn = com.whitecobalt.anglertackle.recipe.FishPalatability
                    .warningKey(data.speciesId(), true);
            if (rawWarn != null) {
                builder.accept(Component.translatable(rawWarn).withStyle(ChatFormatting.RED));
            }
        }
        // 慢性风险（汞/雪卡/二噁英）：吃够几次从常量现取，不写死在文案里（写死 = 第二个真源）。
        String chronic = com.whitecobalt.anglertackle.recipe.FishPalatability.chronicKey(data.speciesId());
        if (chronic != null) {
            builder.accept(Component.translatable(chronic,
                            com.whitecobalt.anglertackle.recipe.PalatabilityLedger.THRESHOLD)
                    .withStyle(ChatFormatting.DARK_RED));
        }
    }

    /**
     * 这条鱼卖给 NPC 能换多少鱼币。
     *
     * <p>定价 = 档位基础价 × (1 + 0.08 × 尺寸系数)，见 {@link CoinPricing}。
     *
     * <p><b>档位用 {@code data.effectiveTier()}（存下来的真实档），不再反推。</b>
     * 早先只能从 SizeGrade 反推，而金(4) 和红(5) 都落在 RECORD 上 ——
     * 反推会把金鱼按红鱼算，价格差 3.5 倍。那个 bug 已经在 FishData 里修掉了
     * （新增了 tier 字段），这里直接用即可。
     *
     * <p>尺寸系数需要这种鱼的体重区间，从 {@link FishSpecies} 现查（走配置），
     * 所以调了 fishStats 之后售价会跟着动，不需要另存一份价格表。
     */
    public static long sellValue(ItemStack stack) {
        var data = stack.get(ModDataComponents.FISH_DATA.get());
        if (data == null) {
            return 0L;
        }
        FishSpecies species = FishSpecies.byId(data.speciesId());
        double minKg = species == null ? 0.0 : species.kgMin();
        double maxKg = species == null ? 0.0 : species.kgMax();
        return CoinPricing.priceFor(data.effectiveTier(),
                CoinPricing.sizeFactor(data.weightKg(), minKg, maxKg));
    }

    /** 让鱼名按品质着色——和配件走同一条路径（{@link HasQuality#applyQuality}）。 */
    @Override
    public Component getName(ItemStack stack) {
        return HasQuality.applyQuality(super.getName(stack), this, stack);
    }
}
