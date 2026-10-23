package com.whitecobalt.anglertackle.item;

import java.util.function.Consumer;
import java.util.function.Supplier;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.SpawnEggItem;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.component.TooltipDisplay;

/**
 * 鱼的刷怪蛋（21 个，调试用）。
 *
 * <p>比原版 {@link SpawnEggItem} 只多做一件事：<b>在 tooltip 里补一行鱼种 id</b>。
 * 看起来是小事，但"21 条鱼里第 7 条颜色不对"这种反馈，
 * 没有 id 就只能靠中文名猜（而中文名本身可能也是错的），一来一回很费时间。
 *
 * <p><b>26.1.2 起刷怪蛋的实体类型与颜色都不再走构造器</b>：
 * <ul>
 *   <li>实体类型由数据组件决定：{@code Item.Properties.spawnEgg(type)}
 *       写入 {@code DataComponents.ENTITY_DATA}，原版 {@code SpawnEggItem.getType(ItemStack)}
 *       （static，不可重写）读取；</li>
 *   <li>颜色改成每个蛋一张贴图（P2 资源阶段逐蛋出图），原版不再有
 *       {@code template_spawn_egg} 染色模板，也没有颜色构造器参数。</li>
 * </ul>
 *
 * <p>⚠ 构造器仍然收 {@code Supplier}，并且<b>两个颜色参数保留成"暂存参数"</b>：
 * {@code ModItems} 里那 21 行是 {@code tools/gen-fish-model.js} 生成的块，
 * 参数形状不变才能让生成段**逐字节不动**（生成器与检查器在 P4/P2 统一改）。
 * 两个颜色参数原样保留但在本类里**不使用**、也不写进任何组件 ——
 * 26.1.2 的配色改由 P2 的逐蛋贴图决定。
 *
 * <p>参数类型是 {@code Supplier<? extends EntityType<?>>} 而不是
 * {@code Supplier<? extends EntityType<? extends Mob>>}：26.1.2 的
 * {@code Item.Properties.spawnEgg} 收的是任意 {@code EntityType<?>}，不再需要 Mob 约束；
 * 生成段传入的正是 {@code DeferredHolder<EntityType<?>, EntityType<ModFish>>}。
 * 真正的取值推迟到物品注册那一刻（{@code .get()}），而 NeoForge 保证
 * {@code ENTITY_TYPE} 先于 {@code ITEM} 注册（见 ModItems 里老柯刷怪蛋的注释）。
 */
public class FishSpawnEggItem extends SpawnEggItem {

    private final String speciesId;

    /**
     * @param type            实体类型（延迟取值，物品注册时 {@code ENTITY_TYPE} 已就绪）
     * @param speciesId       鱼种 id，只用于 tooltip
     * @param backgroundColor 26.1.2 起**不再生效**；由 P2 的逐蛋贴图决定（保留以维持生成段不变）
     * @param highlightColor  26.1.2 起**不再生效**；由 P2 的逐蛋贴图决定（保留以维持生成段不变）
     * @param properties      物品属性；实体类型由 {@code properties.spawnEgg(type)} 写进组件
     */
    public FishSpawnEggItem(Supplier<? extends EntityType<?>> type, String speciesId,
                            int backgroundColor, int highlightColor, Item.Properties properties) {
        super(properties.spawnEgg(type.get()));
        this.speciesId = speciesId;
    }

    /** 鱼种 id，供检查脚本与调试用。 */
    public String speciesId() {
        return this.speciesId;
    }

    @Override
    public void appendHoverText(ItemStack stack, Item.TooltipContext context, TooltipDisplay display,
                                Consumer<Component> builder, TooltipFlag flag) {
        super.appendHoverText(stack, context, display, builder, flag);
        // 一直显示，不只在 F3+H 高级提示里 —— 这本来就是给调试用的物品
        builder.accept(Component.literal("anglertackle:" + this.speciesId).withStyle(ChatFormatting.DARK_GRAY));
    }
}
