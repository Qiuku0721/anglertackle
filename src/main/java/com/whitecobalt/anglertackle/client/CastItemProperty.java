package com.whitecobalt.anglertackle.client;

import com.mojang.serialization.MapCodec;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.item.properties.numeric.RangeSelectItemModelProperty;
import net.minecraft.world.entity.ItemOwner;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import org.jetbrains.annotations.Nullable;

/**
 * 台钓竿"抛竿换图"的 range-select 属性：{@code anglertackle:cast}。
 *
 * <h2>为什么是这个形状（26.1.2 迁移）</h2>
 * 旧实现是 {@code net.minecraft.client.renderer.item.ItemProperties.register(
 * rod, anglertackle:cast, (stack, level, entity, seed) -> float)}，<b>每个物品注册一次</b>；
 * 26.1.2 把这个类整个删掉了，换成"按 id 注册一个**属性类型**、由模型 JSON 的
 * {@code range_dispatch} 引用"。于是：
 * <ul>
 *   <li>注册点从 {@code FMLClientSetupEvent} 挪到 {@code RegisterRangeSelectItemModelPropertyEvent}
 *       （原版 {@code RangeSelectItemModelProperties.bootstrap()} 里 {@code ModLoader.postEvent}
 *       的那一个，发生在 {@code ClientBootstrap} 里、**早于资源加载**）；</li>
 *   <li>只注册**一次**（id → MapCodec），不再按物品循环 —— 判据里本来就有
 *       "手上这根竿" 那一层，所以一根属性够五根台钓竿共用，不存在"漏注册某根竿"的可能。</li>
 * </ul>
 *
 * <h2>判据（与旧实现逐字一致）</h2>
 * <ol>
 *   <li>没有持有者（{@code owner == null}，比如物品栏/展示框里求值）⇒ {@code 0.0}
 *       —— 显示**带鱼线**的那张；</li>
 *   <li>客户端不在钓鱼会话里（{@code ClientFishingState.inSession()}）⇒ {@code 0.0}；</li>
 *   <li>其它情况：手上（主手）就是这根竿 ⇒ {@code 1.0}（无线图），否则 {@code 0.0}。</li>
 * </ol>
 *
 * <p>⚠ 第 3 条必须按"**手上这根竿**"判断：模型属性是**对每个堆栈**求值的，
 * 只判断"玩家正在钓鱼"的话，背包里和另一只手上的台钓竿会一起变成无线的图 ✗。
 */
@OnlyIn(Dist.CLIENT)
public record CastItemProperty() implements RangeSelectItemModelProperty {

    /** 无参属性：{@code MapCodec.unit}（与原版 {@code Cooldown} 同一个写法）。 */
    public static final MapCodec<CastItemProperty> MAP_CODEC = MapCodec.unit(new CastItemProperty());

    @Override
    public float get(ItemStack itemStack, @Nullable ClientLevel level, @Nullable ItemOwner owner, int seed) {
        LivingEntity entity = owner == null ? null : owner.asLivingEntity();
        if (entity == null || !ClientFishingState.get().inSession()) {
            return 0.0F;   // 没抛竿 ⇒ 显示带鱼线的那张
        }
        return entity.getMainHandItem().getItem() == itemStack.getItem() ? 1.0F : 0.0F;
    }

    @Override
    public MapCodec<CastItemProperty> type() {
        return MAP_CODEC;
    }
}
