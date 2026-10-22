package com.whitecobalt.anglertackle.client.render;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.entity.FishermanEntity;
import net.minecraft.client.model.VillagerModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.client.renderer.entity.layers.CrossedArmsItemLayer;
import net.minecraft.client.renderer.entity.layers.CustomHeadLayer;
import net.minecraft.resources.ResourceLocation;

/**
 * 老柯的渲染器 —— **复用原版村民模型**。
 *
 * <h2>为什么能复用</h2>
 * 用户要求"行走动作就套村民模板"。关键在于：**走路动画在模型层，不在实体层**。
 * {@code VillagerModel} 是泛型 {@code VillagerModel<T extends Entity>} 的，
 * 它在 {@code setupAnim} 里只用到所有实体都有的东西（{@code walkAnimation}、
 * {@code isBaby()}、朝向角度），所以任何实体挂上它都有村民的走路姿势。
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
public class FishermanRenderer extends MobRenderer<FishermanEntity, VillagerModel<FishermanEntity>> {

    private static final ResourceLocation TEX =
            ResourceLocation.withDefaultNamespace("textures/entity/villager/villager.png");

    public FishermanRenderer(EntityRendererProvider.Context ctx) {
        // 用 ModelLayers.VILLAGER —— 那是原版已经烘焙好的村民模型层，
        // 不需要自己再 registerLayerDefinition。少一层注册就少一处出错的地方。
        super(ctx, new VillagerModel<>(ctx.bakeLayer(ModelLayers.VILLAGER)), 0.5f);
        // 手上拿东西的姿势 + 头上的方块（草帽以后可以用这个层，先留着）
        this.addLayer(new CrossedArmsItemLayer<>(this, ctx.getItemInHandRenderer()));
        this.addLayer(new CustomHeadLayer<>(this, ctx.getModelSet(), ctx.getItemInHandRenderer()));
    }

    @Override
    public ResourceLocation getTextureLocation(FishermanEntity entity) {
        return TEX;
    }
}
