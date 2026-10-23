package com.whitecobalt.anglertackle.client.render;

import com.whitecobalt.anglertackle.entity.FishermanEntity;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.npc.VillagerModel;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.client.renderer.entity.layers.CrossedArmsItemLayer;
import net.minecraft.client.renderer.entity.layers.CustomHeadLayer;
import net.minecraft.client.renderer.entity.state.HoldingEntityRenderState;
import net.minecraft.client.renderer.entity.state.VillagerRenderState;
import net.minecraft.resources.Identifier;

/**
 * 老柯的渲染器 —— **复用原版村民模型**。
 *
 * <h2>为什么能复用</h2>
 * 用户要求"行走动作就套村民模板"。关键在于：**走路动画在模型层，不在实体层**。
 * 26.1.2 起 {@code VillagerModel} 直接吃 {@link VillagerRenderState}
 * （模型本身就是状态驱动的），{@code setupAnim} 只用
 * {@code walkAnimationPos/Speed}、{@code yRot/xRot}、{@code isUnhappy} 这些状态字段，
 * 所以任何实体只要抽出同样的状态，挂上它就有村民的走路姿势。
 *
 * <p>这也正是我们没有继承 {@code Villager} 却依然像村民的原因 ——
 * 继承关系决定的是**行为**（村庄/日程/工作站），模型决定的是**外观与动画**，
 * 两者是分开的。
 *
 * <h2>皮肤</h2>
 * 现在是原版村民贴图（{@code minecraft:textures/entity/villager/villager.png}），
 * 看上去就是个普通村民。策划案 §1.3 要的是"草帽 + 白胡 + 背带裤 + 卷袖"的
 * 原创 64×64 皮肤 —— 那是美术活，等结构做完一起处理。
 * 用原版贴图的好处是**先把实体跑起来**：位置、AI、交互都能验，
 * 换皮是纯替换，不影响任何逻辑。
 */
public class FishermanRenderer extends MobRenderer<FishermanEntity, VillagerRenderState, VillagerModel> {

    private static final Identifier TEX =
            Identifier.withDefaultNamespace("textures/entity/villager/villager.png");

    public FishermanRenderer(EntityRendererProvider.Context ctx) {
        // 用 ModelLayers.VILLAGER —— 那是原版已经烘焙好的村民模型层，
        // 不需要自己再 registerLayerDefinition。少一层注册就少一处出错的地方。
        super(ctx, new VillagerModel(ctx.bakeLayer(ModelLayers.VILLAGER)), 0.5f);
        // 手上拿东西的姿势 + 头上的方块（草帽以后可以用这个层，先留着）。
        // 26.1.2 的层改成从状态里取物品（heldItem / headItem），不再接收 ItemInHandRenderer。
        this.addLayer(new CrossedArmsItemLayer<>(this));
        this.addLayer(new CustomHeadLayer<>(this, ctx.getModelSet(), ctx.getPlayerSkinRenderCache()));
    }

    @Override
    public VillagerRenderState createRenderState() {
        return new VillagerRenderState();
    }

    @Override
    public void extractRenderState(FishermanEntity entity, VillagerRenderState state, float partialTick) {
        super.extractRenderState(entity, state, partialTick);
        // 交叉手臂层读的是 state.heldItem；旧版层直接读实体主手，这里补上等价的抽取。
        HoldingEntityRenderState.extractHoldingEntityRenderState(entity, state, this.itemModelResolver);
    }

    @Override
    public Identifier getTextureLocation(VillagerRenderState state) {
        return TEX;
    }
}
