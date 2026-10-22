package com.whitecobalt.anglertackle.item;

import java.util.List;
import java.util.function.Supplier;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.neoforged.neoforge.common.DeferredSpawnEggItem;

/**
 * 鱼的刷怪蛋（21 个，调试用）。
 *
 * <p>比原版 {@link DeferredSpawnEggItem} 只多做一件事：<b>在 tooltip 里补一行鱼种 id</b>。
 * 看起来是小事，但"21 条鱼里第 7 条颜色不对"这种反馈，
 * 没有 id 就只能靠中文名猜（而中文名本身可能也是错的），一来一回很费时间。
 *
 * <p>刷怪蛋的壳色（底色 + 斑点）由构造器参数决定，再经原版的 {@code ItemColors}
 * 叠到 {@code minecraft:item/template_spawn_egg} 上 —— 所以本模组**没有也不该有**
 * 刷怪蛋的 png。两个颜色由 {@code gen-fish-model.js} 从该鱼的背部色与花纹色取出，
 * 和模型贴图同源。
 *
 * <p>⚠ 构造器第一个参数必须是 {@code Supplier} 而不是 {@code EntityType}：
 * 物品与实体是两个 DeferredRegister、两次独立的 RegisterEvent，
 * 先后顺序不受控制，传已解析的 EntityType 会变成"某些机器上才炸"的偶发问题。
 * 详见 ModItems 里老柯刷怪蛋上方那段注释，以及 tools/check-spawn-egg.js。
 */
public class FishSpawnEggItem extends DeferredSpawnEggItem {

    private final String speciesId;

    public FishSpawnEggItem(Supplier<? extends EntityType<? extends Mob>> type, String speciesId,
                            int backgroundColor, int highlightColor, Item.Properties properties) {
        super(type, backgroundColor, highlightColor, properties);
        this.speciesId = speciesId;
    }

    /** 鱼种 id，供检查脚本与调试用。 */
    public String speciesId() {
        return this.speciesId;
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context,
                                List<Component> lines, TooltipFlag flag) {
        super.appendHoverText(stack, context, lines, flag);
        // 一直显示，不只在 F3+H 高级提示里 —— 这本来就是给调试用的物品
        lines.add(Component.literal("anglertackle:" + this.speciesId).withStyle(ChatFormatting.DARK_GRAY));
    }
}
