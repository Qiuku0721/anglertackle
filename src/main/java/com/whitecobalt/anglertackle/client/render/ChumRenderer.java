package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.whitecobalt.anglertackle.entity.ChumEntity;
import com.whitecobalt.anglertackle.fishing.ChumManager;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.resources.Identifier;
import org.joml.Matrix4f;

/**
 * 打窝料的渲染。
 *
 * <p>两个阶段都要画：
 * <ul>
 *   <li><b>飞行中</b>：一颗翻滚的窝料团（线段画的小立方体）。
 *       早先这里直接 {@code return}，于是"丢出去看不见实体"，
 *       玩家扔完屏幕上什么都没有，直到远处突然冒出一个圈。</li>
 *   <li><b>落水后</b>：水面上的窝料团 + 半径 {@link ChumManager#radius()} 的白圈。
 *       白圈就是加成生效范围，给玩家瞄准用。</li>
 * </ul>
 *
 * <p><b>坐标系</b>：实体渲染的 {@code poseStack} 已经在实体位置上了，
 * 所以所有几何一律用**局部坐标**（原点 = 实体中心）。
 * 早先白圈用了世界坐标（{@code entity.getX()} 再 {@code translate(-x)} 抵消），
 * 和局部坐标的立方体混在一起很容易写错，现在统一成都用局部坐标。
 *
 * <p>用线段而不是贴图/模型：省一张贴图、半径改了不用重画图，
 * 而且线段在远处不会因为 mipmap 糊掉，10 格的圈从岸上看依然清楚。
 */
public class ChumRenderer extends EntityRenderer<ChumEntity> {

    /** 圆的分段数。48 段在 10 格半径下已经看不出多边形感。 */
    private static final int SEGMENTS = 48;

    /** 圆离水面的高度，避免和水面 z-fighting。 */
    private static final double RING_Y = 0.02;

    private static final Identifier TEX =
            Identifier.fromNamespaceAndPath("minecraft", "textures/misc/white.png");

    /** 窝料团的颜色（黄褐色）。 */
    private static final int CR = 226, CG = 196, CB = 120;

    public ChumRenderer(EntityRendererProvider.Context context) {
        super(context);
        this.shadowRadius = 0.0f;
    }

    /**
     * 本渲染器全程用 {@link RenderType#lines()}，**不采样任何贴图**，
     * 这里只是满足抽象方法的返回值。
     *
     * <p>刻意返回一个明确的占位而不是随便编一个本模组路径：
     * 自检脚本会扫描代码里的 {@code textures/...} 字符串并检查包内是否存在，
     * 编一个不存在的路径会在每次构建时留一条无意义的 WARN。
     */
    @Override
    public Identifier getTextureLocation(ChumEntity entity) {
        return TEX;
    }

    @Override
    public void render(ChumEntity entity, float entityYaw, float partialTick, PoseStack poseStack,
                       MultiBufferSource buffer, int packedLight) {
        VertexConsumer lines = buffer.getBuffer(RenderType.lines());
        poseStack.pushPose();
        poseStack.translate(0.0, entity.getBob(), 0.0);

        if (!entity.isLanded()) {
            // 飞行中：翻滚的窝料团（大一点，扔出去看得见）
            poseStack.mulPose(com.mojang.math.Axis.YP
                    .rotationDegrees((entity.tickCount + partialTick) * 18.0f));
            poseStack.mulPose(com.mojang.math.Axis.XP
                    .rotationDegrees((entity.tickCount + partialTick) * 12.0f));
            drawCube(lines, poseStack.last().pose(), 0.16f, 235);
            poseStack.popPose();
            super.render(entity, entityYaw, partialTick, poseStack, buffer, packedLight);
            return;
        }

        // 落水后：窝料团（小一点，别挡住圈）
        drawCube(lines, poseStack.last().pose(), 0.11f, 235);

        // ---- 白圈 ----
        // 剩余寿命不足 20% 时闪烁（每 0.4 秒亮灭一次），提示该补窝了
        float life = entity.lifeRatio();
        int ringAlpha;
        if (life < 0.2f) {
            if (((entity.tickCount / 8) & 1) != 0) {
                poseStack.popPose();
                super.render(entity, entityYaw, partialTick, poseStack, buffer, packedLight);
                return;
            }
            ringAlpha = 140;
        } else if (life < 0.35f) {
            ringAlpha = (int) ((0.6f + (life - 0.2f) / 0.15f * 0.4f) * 230.0f);
        } else {
            ringAlpha = 230;
        }
        drawRing(lines, poseStack.last().pose(), ChumManager.radius(), ringAlpha);

        poseStack.popPose();
        super.render(entity, entityYaw, partialTick, poseStack, buffer, packedLight);
    }

    /**
     * 用线段画一个立方体轮廓。
     *
     * @param halfSize 半边长（格）
     * @param alpha    透明度 0~255
     */
    private static void drawCube(VertexConsumer lines, Matrix4f mat, float halfSize, int alpha) {
        final float s = halfSize;
        float[][] v = {
                {-s, -s, -s}, {s, -s, -s}, {s, -s, s}, {-s, -s, s},
                {-s, s, -s}, {s, s, -s}, {s, s, s}, {-s, s, s}
        };
        int[][] edges = {
                {0, 1}, {1, 2}, {2, 3}, {3, 0},
                {4, 5}, {5, 6}, {6, 7}, {7, 4},
                {0, 4}, {1, 5}, {2, 6}, {3, 7}
        };
        for (int[] e : edges) {
            float[] a = v[e[0]], b = v[e[1]];
            lines.addVertex(mat, a[0], a[1], a[2]).setColor(CR, CG, CB, alpha).setNormal(0f, 1f, 0f);
            lines.addVertex(mat, b[0], b[1], b[2]).setColor(CR, CG, CB, alpha).setNormal(0f, 1f, 0f);
        }
    }

    /** 用一个 y 轴上的圆环（线段）画白圈。半径单位是格，原点为圆心。 */
    private static void drawRing(VertexConsumer lines, Matrix4f mat, double radius, int alpha) {
        for (int i = 0; i < SEGMENTS; i++) {
            double t0 = (i / (double) SEGMENTS) * Math.PI * 2.0;
            double t1 = ((i + 1) / (double) SEGMENTS) * Math.PI * 2.0;
            float x0 = (float) (Math.cos(t0) * radius);
            float z0 = (float) (Math.sin(t0) * radius);
            float x1 = (float) (Math.cos(t1) * radius);
            float z1 = (float) (Math.sin(t1) * radius);
            lines.addVertex(mat, x0, (float) RING_Y, z0).setColor(255, 255, 255, alpha).setNormal(0f, 1f, 0f);
            lines.addVertex(mat, x1, (float) RING_Y, z1).setColor(255, 255, 255, alpha).setNormal(0f, 1f, 0f);
        }
    }
}
