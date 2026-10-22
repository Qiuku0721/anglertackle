package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.shop.ShopCatalog;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.ItemTooltipEvent;

import java.util.Optional;

/**
 * 在物品信息栏里标出**商店价值**（用户 2026-10-01 要求："把物品价值标注在物品信息栏中，
 * 可以鼠标悬浮查看"）。
 *
 * <h2>为什么用 {@link ItemTooltipEvent} 而不是改四个物品类</h2>
 * 商店里的东西分散在 {@code RodItem} / {@code TacklePartItem} / {@code BaitItem} /
 * {@code ChumItem} 四个类里。逐个改的话要写四遍同样的逻辑，而且**以后加第五类商品
 * 一定会漏**（漏了的表现是"这件东西不显示价格"，没人会主动去查）。
 * 用事件挂在物品层外面，一处覆盖全部 —— 判据只看"它在不在 {@code ShopCatalog} 里"。
 *
 * <h2>显示什么</h2>
 * <ul>
 *   <li>买价：{@code 价值：440 币}</li>
 *   <li>免费：{@code 价值：免费}</li>
 *   <li>兑换：{@code 价值：兑换 任意红品质鱼 ×2（消耗）}</li>
 *   <li>解锁要求：{@code 老柯等级 3 解锁}（等级高于 1 才显示）</li>
 *   <li>限购：{@code 限购：每买 5 个售罄，等 120 分钟补货}</li>
 * </ul>
 *
 * <p>⚠ 这里**不判断玩家当前等级够不够** —— tooltip 是纯客户端渲染，
 * 而玩家等级只有服务端知道。硬要在客户端猜就会显示错的"已解锁"，
 * 那比不显示更坏。等级够不够由商店界面负责（那份数据是服务端发的）。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class ShopTooltipEvents {

    private ShopTooltipEvents() {
    }

    @SubscribeEvent
    public static void onTooltip(ItemTooltipEvent event) {
        ItemStack stack = event.getItemStack();
        if (stack.isEmpty()) {
            return;
        }
        // ---- 耐久：可用次数（所有带耐久的物品都显示）----
        //
        // MC 默认只画一根耐久**条**，不给数字。鱼饵/拟饵这种"能用几次"的东西
        // 玩家需要看到确切的剩余次数，才知道该不该再买一个。
        // 放在"商店特有信息"之前 —— 它是通用物品信息，不属于商店。
        if (stack.isDamageableItem()) {
            int left = stack.getMaxDamage() - stack.getDamageValue();
            event.getToolTip().add(Component.literal("可用次数：").withStyle(ChatFormatting.DARK_GRAY)
                    .append(Component.literal(left + " / " + stack.getMaxDamage())
                            .withStyle(left <= 1 ? ChatFormatting.RED : ChatFormatting.GRAY)));
        }

        ShopCatalog.Entry entry = find(stack);
        if (entry == null) {
            return;
        }

        var lines = event.getToolTip();
        lines.add(Component.empty());

        switch (entry.kind()) {
            case FREE -> lines.add(label("价值：")
                    .append(Component.literal("免费").withStyle(ChatFormatting.AQUA)));
            case BUY -> lines.add(label("价值：")
                    .append(Component.literal(entry.price() + " 币")
                            .withStyle(ChatFormatting.GOLD)));
            case EXCHANGE -> lines.add(label("价值：")
                    .append(Component.literal(describeExchange(entry))
                            .withStyle(ChatFormatting.LIGHT_PURPLE)));
        }

        if (entry.limited()) {
            lines.add(label("限购：")
                    .append(Component.literal("每买 " + entry.stockPer() + " 个售罄，等 "
                            + entry.restockMinutes() + " 分钟补货").withStyle(ChatFormatting.GRAY)));
        }

        if (entry.unlockStage() > 1) {
            lines.add(label("解锁：")
                    .append(Component.literal("老柯等级 " + entry.unlockStage())
                            .withStyle(ChatFormatting.YELLOW)));
        }
    }

    /** 按物品 id 在商店目录里找这一条。找不到返回 null（大多数物品都不在商店里）。 */
    private static ShopCatalog.Entry find(ItemStack stack) {
        ResourceLocation id = net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem());
        if (!AnglersTackle.MOD_ID.equals(id.getNamespace())) {
            return null;   // 原版物品不查（省掉 39 次字符串比较）
        }
        String path = id.getPath();
        Optional<ShopCatalog.Entry> hit = ShopCatalog.ENTRIES.stream()
                .filter(e -> e.id().equals(path)).findFirst();
        return hit.orElse(null);
    }

    /** 把 {@code anyRed@REDx2} 这种机器可读的描述翻成人话。 */
    private static String describeExchange(ShopCatalog.Entry e) {
        String spec = e.exchange();
        if (spec.isEmpty()) {
            return "兑换";
        }
        int at = spec.indexOf('@');
        String fishPart = at < 0 ? spec : spec.substring(0, at);
        String rest = at < 0 ? "" : spec.substring(at);

        // ⚠ 生成器只在有品质或 @each 时才补 '@'；anyRedx2 这种是**没有分隔符**的，
        //   数量直接贴在鱼名后面。不补这一条的话，整串会被当成鱼种 id 去查语言键，
        //   查不到就原样显示 —— 表现就是用户看到的"鱼线兑换显示的是鱼英文"。
        if (at < 0) {
            int xi = fishPart.lastIndexOf('x');
            if (xi > 0 && fishPart.substring(xi + 1).matches("\\d+")) {
                rest = fishPart.substring(xi);
                fishPart = fishPart.substring(0, xi);
            }
        }
        int x = rest.indexOf('x');
        String count = x < 0 ? "1" : rest.substring(x + 1).replace("@each", "");

        String who;
        if (fishPart.equals("anyRed")) {
            who = "任意红品质鱼";
        } else {
            who = java.util.Arrays.stream(fishPart.split("\\+"))
                    .map(ShopTooltipEvents::fishName)
                    .reduce((a, b) -> a + " / " + b).orElse(fishPart);
        }
        boolean each = rest.contains("@each");
        return "兑换 " + (rest.contains("@RED") ? "红品质 " : "") + who
                + (each ? " 各一条" : " ×" + count) + "（消耗）";
    }

    private static String fishName(String id) {
        return Component.translatable("item.anglertackle." + id).getString();
    }

    // ⚠ 返回类型必须是 MutableComponent：Component 是接口，没有 append()
    private static MutableComponent label(String s) {
        return Component.literal(s).withStyle(ChatFormatting.DARK_GRAY);
    }
}
