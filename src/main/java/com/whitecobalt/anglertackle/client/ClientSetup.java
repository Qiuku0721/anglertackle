package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.client.render.BobberRenderer;
import com.whitecobalt.anglertackle.client.render.ChumRenderer;
import com.whitecobalt.anglertackle.registry.ModEntities;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;

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
     * 客户端启动钩子（目前没有必须在这里做的事）。
     *
     * <p>这里原来注册的是追踪罗盘的 {@code minecraft:angle} 物品属性 ——
     * 2026-10-02 罗盘整个删掉了（改成一次性的「渔夫小屋定位线索」，
     * 用一次直接报坐标，不需要模型属性），所以这个钩子暂时空着。
     *
     * <p>⚠ 留着方法体是这个原因：{@code FMLClientSetupEvent} 是**早于资源加载**的
     * 官方钩子，以后再有"必须在模型 bake 之前注册"的东西（物品属性、着色器……
     * 晚了就会永远查不到，表现是"模型永远显示默认帧"）就往这里加，别再新建一个监听器。
     */
    @SubscribeEvent
    public static void onClientSetup(FMLClientSetupEvent event) {
        // ★ 台钓竿"抛竿换图"的判据 —— 用户 2026-10-11：
        //   "台钓竿没有跟随状态变化改变的贴图，需要做到**抛竿出去后明显是鱼线的部分消失，收回后还原**"。
        //   做法与原版鱼竿完全一致：主模型里写 `overrides` + 这里注册判据（见 models/item/*_float_rod.json）。
        //
        //   ⚠ 原版的 `minecraft:cast` 只注册在**原版鱼竿**那个物品上 —— 我们的竿用不了它，
        //     必须自己注册一个同名的（本模组命名空间）。
        //   ⚠ 判据必须按"**手上这根竿**"判断：模型 overrides 是对**每个堆栈**求值的，
        //     只判断"玩家正在钓鱼"的话，背包里和另一只手上的台钓竿会一起变成无线的图 ✗。
        //   ⚠ 必须在这里注册（注册早了物品还查不到，表现是"模型永远停在默认帧"）。
        for (var rod : new net.minecraft.world.item.Item[]{
                com.whitecobalt.anglertackle.registry.ModItems.WOOD_FLOAT_ROD.get(),
                com.whitecobalt.anglertackle.registry.ModItems.IRON_FLOAT_ROD.get(),
                com.whitecobalt.anglertackle.registry.ModItems.GOLD_FLOAT_ROD.get(),
                com.whitecobalt.anglertackle.registry.ModItems.DIAMOND_FLOAT_ROD.get(),
                com.whitecobalt.anglertackle.registry.ModItems.NETHERITE_FLOAT_ROD.get()}) {
            net.minecraft.client.renderer.item.ItemProperties.register(rod,
                    net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(
                            com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, "cast"),
                    (stack, level, entity, seed) -> {
                        if (entity == null
                                || !com.whitecobalt.anglertackle.client.ClientFishingState.get().inSession()) {
                            return 0.0F;   // 没抛竿 ⇒ 显示带鱼线的那张
                        }
                        return entity.getMainHandItem().getItem() == stack.getItem() ? 1.0F : 0.0F;
                    });
        }
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
