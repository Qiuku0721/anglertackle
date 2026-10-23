package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.client.model.ModFishModel;
import com.whitecobalt.anglertackle.client.render.state.FishRenderState;
import com.whitecobalt.anglertackle.entity.ModFish;
import com.whitecobalt.anglertackle.fish.FishVariants;
import com.whitecobalt.anglertackle.registry.ModModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Mth;

/**
 * 通用鱼渲染器。21 种鱼共用它，差异由三处决定：
 *
 * <ol>
 *   <li><b>贴图</b> —— 路径按鱼种 id 拼，见 {@link #getTextureLocation}；</li>
 *   <li><b>网格</b> —— 构造时按体型组取层（{@code ctx.bakeLayer(ModModelLayers.FISH.get(group))}），
 *       所以注册时要给每种鱼传对组；</li>
 *   <li><b>三轴缩放</b> —— {@link FishVariants} 里的数字，在 {@link #scale} 里施加。</li>
 * </ol>
 *
 * <p><b>缩放为什么落在 {@code scale()} 而不是 {@code scale()} 之外</b>：
 * {@code LivingEntityRenderer.submit} 的调用顺序是
 * {@code scale(-1,-1,1)} → {@code this.scale(...)} → {@code translate(0,-1.501,0)}，
 * 而 {@code translate} 在顶点变换里是**最先**作用的一步 —— 也就是说
 * 轮到 {@code this.scale} 时，坐标系原点已经在鱼的腹线（y=24）上了。
 * 直接 {@code pose.scale(...)} 就是"以腹线为基准缩放"，鱼不会浮空也不会陷进地里。
 * 想做别的基准，就必须在这里自己补 translate。
 *
 * <p><b>26.1.2 迁移</b>：{@code MobRenderer} 的泛型变成三个
 * {@code <T, S extends LivingEntityRenderState, M extends EntityModel<? super S>>}；
 * 旧的 {@code render(T, yaw, partial, ...)} 不复存在，改由 {@link #extractRenderState}
 * 把鱼种塞进 {@link FishRenderState}，{@link #submit} 之前由基类统一提交模型。
 * 摆动/翻倒依赖的 {@code ageInTicks}、{@code isInWater} 现在都从状态读取。
 */
public class ModFishRenderer extends MobRenderer<ModFish, FishRenderState, ModFishModel> {

    private final String species;

    public ModFishRenderer(EntityRendererProvider.Context ctx, String species) {
        super(ctx, new ModFishModel(ctx.bakeLayer(ModModelLayers.FISH.get(species)), species), 0.3F);
        this.species = species;
    }

    /** 只用于断言：渲染器烘的层必须和它要画的鱼种一致。 */
    public String species() {
        return this.species;
    }

    @Override
    public FishRenderState createRenderState() {
        return new FishRenderState();
    }

    @Override
    public void extractRenderState(ModFish entity, FishRenderState state, float partialTick) {
        super.extractRenderState(entity, state, partialTick);
        // 渲染器实例本身就是按鱼种注册的，用 this.species 与模型层保持同一来源；
        // 同时写进状态，贴图/缩放/阴影都能从状态取到。
        state.species = this.species;
    }

    @Override
    public Identifier getTextureLocation(FishRenderState state) {
        return Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID,
                "textures/entity/fish/" + state.species + ".png");
    }

    @Override
    protected void scale(FishRenderState state, PoseStack pose) {
        FishVariants.Variant v = FishVariants.of(state.species);
        pose.scale(v.sx(), v.sy(), v.sz());
    }

    @Override
    protected float getShadowRadius(FishRenderState state) {
        // 阴影跟着体型走，否则大鱼的影子会小得像条小鱼
        return super.getShadowRadius(state) * FishVariants.of(state.species).sx();
    }

    /**
     * 侧摆 + 出水翻倒 —— 照抄原版 {@code CodRenderer}。
     *
     * <p>26.1.2 的 {@code setupRotations} 只剩下 {@code (state, pose, bodyRot, entityScale)}：
     * 年龄、死亡、睡姿等公共部分已经在 {@code LivingEntityRenderer} 里按状态算好，
     * 我们只补鱼自己的那两段。
     */
    @Override
    protected void setupRotations(FishRenderState state, PoseStack pose, float bodyRot, float entityScale) {
        super.setupRotations(state, pose, bodyRot, entityScale);
        pose.mulPose(Axis.YP.rotationDegrees(4.3F * Mth.sin(0.6F * state.ageInTicks)));
        if (!state.isInWater) {
            pose.translate(0.1F, 0.1F, -0.1F);
            pose.mulPose(Axis.ZP.rotationDegrees(90.0F));
        }
    }
}
