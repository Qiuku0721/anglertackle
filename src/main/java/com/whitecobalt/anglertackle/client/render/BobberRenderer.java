package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.client.render.state.BobberRenderState;
import com.whitecobalt.anglertackle.entity.BobberEntity;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Mth;

/**
 * 浮漂渲染器。
 *
 * <p>原本 M1 只画了鱼线（幽灵线），玩家看不到浮漂本体。这里补上：
 * 一个三段式浮漂模型（小杆 / 红色浮体 / 白色浮体 / 水下配重），
 * 贴图 32×32 由 {@code tools/gen-textures.js} 生成。
 *
 * <p>动画：
 * <ul>
 *   <li>落水后轻微上下浮动（{@code BobberEntity.getBob()} 驱动）</li>
 *   <li>三段预告时按 {@code getBitePhase()} 加大下沉幅度——玩家能"看见鱼在试饵"</li>
 *   <li>吞钩（phase 3）时整根沉入水下</li>
 * </ul>
 *
 * <p><b>26.1.2 迁移</b>：旧 {@code render(BobberEntity, yaw, partial, PoseStack, MultiBufferSource, light)}
 * 已不存在。现在拆成 {@link #createRenderState()} / {@link #extractRenderState} 抽状态，
 * {@link #submit} 只读状态；模型用 {@code SubmitNodeCollector.submitModelPart} 提交。
 * 坐标、旋转、偏移量与旧实现逐字一致。
 */
public class BobberRenderer extends EntityRenderer<BobberEntity, BobberRenderState> {

    /** 模型层：注册在 {@code EntityRenderersEvent.RegisterLayerDefinitions}。 */
    public static final ModelLayerLocation LAYER =
            new ModelLayerLocation(Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "bobber"), "main");

    private static final Identifier TEXTURE =
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "textures/entity/bobber.png");

    private final ModelPart root;

    public BobberRenderer(EntityRendererProvider.Context context) {
        super(context);
        this.root = context.bakeLayer(LAYER);
        this.shadowRadius = 0.0f;   // 浮漂不投影，否则水面上会有个莫名其妙的黑影
    }

    /** 模型定义：与 {@code assets/anglertackle/models/entity/bobber.json} 保持一致。 */
    public static LayerDefinition createLayer() {
        MeshDefinition mesh = new MeshDefinition();
        PartDefinition part = mesh.getRoot();

        // 顶部小杆 y 4→7（模型单位 1/16 格）
        part.addOrReplaceChild("stick",
                CubeListBuilder.create().texOffs(6, 14)
                        .addBox(-0.5f, 4.0f, -0.5f, 1.0f, 3.0f, 1.0f),
                PartPose.ZERO);

        // 红色浮体 y 1.5→4
        part.addOrReplaceChild("float_top",
                CubeListBuilder.create().texOffs(6, 0)
                        .addBox(-2.0f, 1.5f, -2.0f, 4.0f, 2.5f, 4.0f),
                PartPose.ZERO);

        // 白色浮体 y -1.5→1.5
        part.addOrReplaceChild("float_bottom",
                CubeListBuilder.create().texOffs(6, 4)
                        .addBox(-2.0f, -1.5f, -2.0f, 4.0f, 3.0f, 4.0f),
                PartPose.ZERO);

        // 水下配重 y -4→-1.5
        part.addOrReplaceChild("sinker",
                CubeListBuilder.create().texOffs(7, 8)
                        .addBox(-1.0f, -4.0f, -1.0f, 2.0f, 2.5f, 2.0f),
                PartPose.ZERO);

        return LayerDefinition.create(mesh, 32, 32);
    }

    /**
     * 不参与视锥剔除 —— 26.1.2 删掉了 {@code Entity.noCulling}，等价开关挪到渲染器层
     * （{@code EntityRenderer.affectedByCulling}，默认 {@code true}）。
     *
     * <p>原语义：<b>实体中心出视锥也不剔除</b>。鱼线是从竿尖连到浮漂的，钩子/浮漂在画面边缘时
     * 实体中心很容易先跑出视锥 —— 那时整根鱼线会突然消失。原版 {@code FishingHookRenderer}
     * 在同一个方法里也返回 {@code false}，本方法与之对齐（这是**回归修复**，不是新功能）。
     */
    @Override
    protected boolean affectedByCulling(BobberEntity entity) {
        return false;
    }

    @Override
    public BobberRenderState createRenderState() {
        return new BobberRenderState();
    }

    @Override
    public void extractRenderState(BobberEntity entity, BobberRenderState state, float partialTick) {
        super.extractRenderState(entity, state, partialTick);
        state.bob = entity.getBob();
        state.bitePhase = entity.getBitePhase();
        state.landed = entity.isLanded();
        state.tickCount = entity.tickCount;
    }

    @Override
    public void submit(BobberRenderState state, PoseStack poseStack,
                       SubmitNodeCollector submitNodeCollector, CameraRenderState camera) {
        poseStack.pushPose();

        // 上下浮动：落水后由实体同步，咬钩阶段加大幅度
        // ageInTicks = tickCount + partialTick，与旧代码的 (entity.tickCount + partialTick) 完全相同。
        float bite = switch (state.bitePhase) {
            case 1 -> Mth.sin(state.ageInTicks * 0.8f) * 0.06f;   // 探饵：轻微抖动
            case 2 -> -0.12f + Mth.sin(state.ageInTicks * 1.2f) * 0.05f;  // 试探：下沉 1/3
            case 3 -> -0.35f;                                     // 吞钩：完全沉入
            default -> 0.0f;
        };
        poseStack.translate(0.0, state.bob + bite, 0.0);

        // 未落水（飞行中）时让浮漂朝运动方向倾斜一点点，看起来像被抛出去。
        // 旧代码用 entity.tickCount（不含 partialTick），这里保持同一个数。
        if (!state.landed) {
            poseStack.mulPose(com.mojang.math.Axis.XP.rotationDegrees(state.tickCount * 12.0f));
        }

        // 旧 RenderType.entityCutoutNoCull(TEXTURE) 在 26.1.2 改名为 entityCutout（非 cull 版本）。
        submitNodeCollector.submitModelPart(this.root, poseStack, RenderTypes.entityCutout(TEXTURE),
                state.lightCoords, OverlayTexture.NO_OVERLAY, null);

        poseStack.popPose();
        super.submit(state, poseStack, submitNodeCollector, camera);
    }
}
