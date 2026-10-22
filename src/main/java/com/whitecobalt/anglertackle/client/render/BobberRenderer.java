package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.entity.BobberEntity;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.ResourceLocation;
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
 */
public class BobberRenderer extends EntityRenderer<BobberEntity> {

    /** 模型层：注册在 {@code EntityRenderersEvent.RegisterLayerDefinitions}。 */
    public static final ModelLayerLocation LAYER =
            new ModelLayerLocation(ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "bobber"), "main");

    private static final ResourceLocation TEXTURE =
            ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "textures/entity/bobber.png");

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

    @Override
    public ResourceLocation getTextureLocation(BobberEntity entity) {
        return TEXTURE;
    }

    @Override
    public void render(BobberEntity entity, float entityYaw, float partialTick, PoseStack poseStack,
                       MultiBufferSource buffer, int packedLight) {
        poseStack.pushPose();

        // 上下浮动：落水后由实体同步，咬钩阶段加大幅度
        float bob = entity.getBob();
        float bite = switch (entity.getBitePhase()) {
            case 1 -> Mth.sin((entity.tickCount + partialTick) * 0.8f) * 0.06f;   // 探饵：轻微抖动
            case 2 -> -0.12f + Mth.sin((entity.tickCount + partialTick) * 1.2f) * 0.05f;  // 试探：下沉 1/3
            case 3 -> -0.35f;                                                      // 吞钩：完全沉入
            default -> 0.0f;
        };
        poseStack.translate(0.0, bob + bite, 0.0);

        // 未落水（飞行中）时让浮漂朝运动方向倾斜一点点，看起来像被抛出去
        if (!entity.isLanded()) {
            poseStack.mulPose(com.mojang.math.Axis.XP.rotationDegrees(entity.tickCount * 12.0f));
        }

        VertexConsumer consumer = buffer.getBuffer(RenderType.entityCutoutNoCull(TEXTURE));
        this.root.render(poseStack, consumer, packedLight, OverlayTexture.NO_OVERLAY);

        poseStack.popPose();
        super.render(entity, entityYaw, partialTick, poseStack, buffer, packedLight);
    }
}
