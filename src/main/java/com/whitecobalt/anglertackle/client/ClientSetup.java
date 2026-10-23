package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.client.render.BobberRenderer;
import com.whitecobalt.anglertackle.client.render.ChumRenderer;
import com.whitecobalt.anglertackle.registry.ModEntities;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
import net.neoforged.neoforge.client.event.RegisterRangeSelectItemModelPropertyEvent;

/**
 * 客户端渲染注册。
 *
 * <p>浮漂实体需要两件事：① 模型层（LayerDefinition）② 渲染器绑定。
 * 两者都必须在 mod 事件总线上注册，且在客户端侧。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class ClientSetup {

    private ClientSetup() {
    }

    @SubscribeEvent
    public static void onRegisterRenderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerEntityRenderer(ModEntities.BOBBER.get(), BobberRenderer::new);
        // ⚠ 座位实体**必须**有渲染器：没有的话 EntityRenderDispatcher.shouldRender 会 NPE 崩客户端 ✗
        //   用原版 NoopRenderer（什么都不画）—— 玩家看到的是自己坐在板凳上 ✓
        event.registerEntityRenderer(com.whitecobalt.anglertackle.registry.ModEntities.STOOL_SEAT.get(),
                net.minecraft.client.renderer.entity.NoopRenderer::new);
        // 鱼架：方块实体渲染器，内部 bakeLayer 复用鱼的实体模型（抄 SkullBlockRenderer）
        event.registerBlockEntityRenderer(
                com.whitecobalt.anglertackle.registry.ModBlockEntities.FISH_RACK.get(),
                com.whitecobalt.anglertackle.client.render.FishRackRenderer::new);
        // 打窝料：白圈 + 中心实体
        event.registerEntityRenderer(ModEntities.CHUM.get(), ChumRenderer::new);
        // 老柯：复用原版村民模型。走路动画在**模型层**，所以不继承 Villager
        // 也一样有村民的走路姿势 —— 这正是"套村民模板"能成立的原因。
        event.registerEntityRenderer(ModEntities.FISHERMAN.get(),
                com.whitecobalt.anglertackle.client.render.FishermanRenderer::new);
        // 21 种鱼共用一个渲染器类：贴图按鱼种 id、网格按鱼种取层。
        // 遍历 FISHES 表，加鱼种不用改这里。
        for (var e : ModEntities.FISHES.entrySet()) {
            String species = e.getKey();
            event.registerEntityRenderer(e.getValue().get(),
                    ctx -> new com.whitecobalt.anglertackle.client.render.ModFishRenderer(ctx, species));
        }
    }

    /**
     * 客户端启动钩子（26.1.2 起方法体里没有必须做的事）。
     *
     * <p>这里先后注册过两样东西：① 追踪罗盘的 {@code minecraft:angle} 物品属性
     * —— 2026-10-02 罗盘整个删掉了（改成一次性的「渔夫小屋定位线索」，用一次直接报坐标，
     * 不需要模型属性）；② 台钓竿的 {@code anglertackle:cast} —— 26.1.2 的
     * {@code ItemProperties} 已删除，改到 {@link #onRegisterRangeSelectProperties}（见那里的说明）。
     *
     * <p>⚠ 方法仍然留着：{@code FMLClientSetupEvent} 是**早于资源加载**的官方钩子，
     * 以后再有"必须在模型 bake 之前注册"的东西（着色器、渲染类型……晚了就会永远查不到，
     * 表现是"模型永远显示默认帧"）就往这里加，别再新建一个监听器。
     */
    @SubscribeEvent
    public static void onClientSetup(FMLClientSetupEvent event) {
        // 目前没有必须在这里做的事。
        //
        // ⚠ 原来这里注册的是台钓竿"抛竿换图"的物品属性（{@code ItemProperties.register}）。
        //   26.1.2 把 {@code ItemProperties} 整个删了，改成"按 id 注册一个 range-select 属性类型"，
        //   注册点在 mod 总线事件 {@code RegisterRangeSelectItemModelPropertyEvent}
        //   ⇒ 见下面的 {@link #onRegisterRangeSelectProperties}。
        //
        // ⚠ 方法本身**留着**：{@code FMLClientSetupEvent} 是早于资源加载的官方钩子，
        //   以后再有"必须在模型 bake 之前注册"的东西（着色器、渲染类型……）就往这里加，
        //   别再新建一个监听器。
    }

    /**
     * 台钓竿"抛竿换图"的判据注册 —— 用户 2026-10-11：
     * "台钓竿没有跟随状态变化改变的贴图，需要做到**抛竿出去后明显是鱼线的部分消失，收回后还原**"。
     *
     * <p>26.1.2：{@code ItemProperties.register(item, id, predicate)} 已删除，换成
     * "**属性类型**按 id 注册一次 + 模型 JSON 的 {@code range_dispatch} 引用它"。
     * 这里注册的 id 与旧实现相同（{@code anglertackle:cast}），判据在 {@link CastItemProperty}。
     *
     * <p>⚠ 原版的 {@code minecraft:cast} 只属于**原版鱼竿**那个物品，我们的竿用不了它
     * ⇒ 必须自己注册一个同名的（本模组命名空间）。
     * <p>⚠ 判据里自带"手上这根竿"那一层，所以**一根属性覆盖五根台钓竿**，
     * 不再需要按物品循环注册（也就不会漏注册某一根）。
     */
    @SubscribeEvent
    public static void onRegisterRangeSelectProperties(RegisterRangeSelectItemModelPropertyEvent event) {
        event.register(
                net.minecraft.resources.Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "cast"),
                CastItemProperty.MAP_CODEC);
    }

    @SubscribeEvent
    public static void onRegisterLayers(EntityRenderersEvent.RegisterLayerDefinitions event) {
        event.registerLayerDefinition(BobberRenderer.LAYER, BobberRenderer::createLayer);
        // 21 种鱼各一层（每种鱼的形状不同）。直接遍历 ModModelLayers.FISH，
        // 层的 id 与"烘哪套网格"来自同一个表，不存在漏注册某个鱼种的可能。
        for (var e : com.whitecobalt.anglertackle.registry.ModModelLayers.FISH.entrySet()) {
            String species = e.getKey();
            event.registerLayerDefinition(e.getValue(),
                    () -> com.whitecobalt.anglertackle.client.model.ModFishModel.createBodyLayer(species));
        }
    }
}
