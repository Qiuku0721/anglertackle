package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.TooltipDisplay;
import net.minecraft.world.item.TooltipFlag;

import java.util.function.Consumer;

/**
 * 鱼块（三档材料：普通鱼块 / 优质鱼肉 / 顶级鱼排，各带一个"熟"版本）。
 *
 * <p>见 docs/25 §2 与 §14.5：
 * <ul>
 *   <li><b>档位进物品 id</b>（`fish_chunk` / `fine_fish_meat` / `supreme_fish_steak`）——
 *       因为第 3 级的配方要**按档位匹配材料**（鱼汤要普通块、香煎要优质肉、刺身要顶级排），
 *       而原版配方只能按物品 id 匹配，匹配不了数据组件；</li>
 *   <li><b>鱼种与重量进数据组件</b>（{@link FishChunkData}）—— 一条鱼一个 id 的话
 *       28 条鱼 × 三档 × 生熟 = 168 个物品，不可能维护。</li>
 * </ul>
 *
 * <p>tooltip 由**数据**拼出来（不写语言键里）：`鲫鱼 · 普通鱼块 · 0.8 kg`。
 *
 * <p>⚠ 档次那一小段的颜色**按真实档位**取（{@link Quality#of}），不是按 group 手写一张表：
 * 2026-10-03 用户要求自查"该显示颜色的文本却是白色"时，这里原来写着
 * {@code WHITE / BLUE / LIGHT_PURPLE} —— 于是绿档鱼块显示成白色、**金红档的"顶级鱼排"
 * 显示成紫色**。group 只是"白绿 / 蓝紫 / 金红"三段，具体是哪一档只有 {@code data.tier()}
 * 知道，所以颜色必须从它来。
 */
public class FishChunkItem extends Item {

    private final int group;      // 0 普通 / 1 优质 / 2 顶级
    private final boolean cooked;

    public FishChunkItem(int group, boolean cooked, Properties properties) {
        super(properties);
        this.group = group;
        this.cooked = cooked;
    }

    /** 材料档位（0/1/2），配方与检查器用它，不再从 id 字符串里猜。 */
    public int group() {
        return group;
    }

    public boolean cooked() {
        return cooked;
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                TooltipDisplay display, Consumer<Component> builder, TooltipFlag flag) {
        FishChunkData data = stack.get(ModDataComponents.FISH_CHUNK.get());
        if (data == null) {
            // 创造模式直接拿出来的那一块没有数据 —— 说清楚，别让玩家以为坏了
            builder.accept(Component.translatable("tooltip.anglertackle.chunk_no_data")
                    .withStyle(ChatFormatting.DARK_GRAY));
            return;
        }
        builder.accept(Component.translatable("item.anglertackle." + data.speciesId())
                .withStyle(ChatFormatting.WHITE)
                .append(Component.literal(" · ").withStyle(ChatFormatting.DARK_GRAY))
                .append(Component.translatable("tooltip.anglertackle.chunk_group." + group)
                        .withStyle(Quality.of(data.tier()).color()))
                .append(Component.literal(" · ").withStyle(ChatFormatting.DARK_GRAY))
                .append(Component.literal(String.format("%.2f kg", data.weightKg()))
                        .withStyle(ChatFormatting.GRAY)));
        if (cooked) {
            builder.accept(Component.translatable("tooltip.anglertackle.chunk_cooked")
                    .withStyle(ChatFormatting.GOLD));
        }
    }

    /**
     * 生块咬一口 → 食用适宜度判一次（L0~L5，依据见 {@code docs/料理适配策划案.md}）。
     *
     * <p>为什么要单独有这一条：L2 的规则是"**生食**有寄生虫、煮熟就正常"
     * （虹鳟 / 北极红点鲑 / 高白鲑 / 鲯鳅）。只挂在菜的路径上的话，它**只在刺身上生效** ——
     * 而生鱼块是更常见的那条路（钓上来直接咬一口），漏了它这条规则就是半残的。
     *
     * <p>{@code cooked} 就是"生不生"的**真源**（这个类本来就带着它，不是新加的判断依据）：
     * 熟块 / 熏块 / 炭烤块都是 {@code true}，生块是 {@code false}。
     * L0/L1 的鱼在这里什么都不发 —— 改动前它们也是什么都不发，行为逐字不变。
     */
    @Override
    public ItemStack finishUsingItem(ItemStack stack, net.minecraft.world.level.Level level,
                                     net.minecraft.world.entity.LivingEntity entity) {
        ItemStack result = super.finishUsingItem(stack, level, entity);
        if (!level.isClientSide() && entity instanceof net.minecraft.world.entity.player.Player player) {
            com.whitecobalt.anglertackle.recipe.FishPalatability.apply(player, stack, !cooked);
        }
        return result;
    }
}
