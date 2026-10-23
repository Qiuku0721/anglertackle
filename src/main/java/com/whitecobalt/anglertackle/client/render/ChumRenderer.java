package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.whitecobalt.anglertackle.client.render.state.ChumRenderState;
import com.whitecobalt.anglertackle.entity.ChumEntity;
import com.whitecobalt.anglertackle.fishing.ChumManager;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
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
 *
 * <p><b>26.1.2 迁移</b>：线段不再往 {@code MultiBufferSource} 里塞，而是通过
 * {@code SubmitNodeCollector.submitCustomGeometry} 提交一段几何；回调里拿到的是
 * 当帧的 {@code PoseStack.Pose} 与 {@code VertexConsumer}。颜色、半径、闪烁、
 * 顶点坐标全部原样搬运。
 */
public class ChumRenderer extends EntityRenderer<ChumEntity, ChumRenderState> {

    /** 圆的分段数。48 段在 10 格半径下已经看不出多边形感。 */
    private static final int SEGMENTS = 48;

    /** 圆离水面的高度，避免和水面 z-fighting。 */
    private static final double RING_Y = 0.02;

    /** 窝料团的颜色（黄褐色）。 */
    private static final int CR = 226, CG = 196, CB = 120;

    /**
     * 线段宽度。
     *
     * <p>旧版 {@code RenderType.lines()} 不写顶点线宽，实际用的是 GL 默认 1.0；
     * 26.1.2 的线宽是顶点属性（{@code VertexFormatElement.LINE_WIDTH}），不写就是 0
     * ——线会完全看不见。所以显式写 1.0，保持旧版的视觉宽度。
     */
    private static final float LINE_WIDTH = 1.0F;

    public ChumRenderer(EntityRendererProvider.Context context) {
        super(context);
        this.shadowRadius = 0.0f;
    }

    @Override
    public ChumRenderState createRenderState() {
        return new ChumRenderState();
    }

    @Override
    public void extractRenderState(ChumEntity entity, ChumRenderState state, float partialTick) {
        super.extractRenderState(entity, state, partialTick);
        state.bob = entity.getBob();
        state.landed = entity.isLanded();
        state.lifeRatio = entity.lifeRatio();
        state.tickCount = entity.tickCount;
    }

    @Override
    public void submit(ChumRenderState state, PoseStack poseStack,
                       SubmitNodeCollector submitNodeCollector, CameraRenderState camera) {
        poseStack.pushPose();
        poseStack.translate(0.0, state.bob, 0.0);

        if (!state.landed) {
            // 飞行中：翻滚的窝料团（大一点，扔出去看得见）
            poseStack.mulPose(com.mojang.math.Axis.YP
                    .rotationDegrees(state.ageInTicks * 18.0f));
            poseStack.mulPose(com.mojang.math.Axis.XP
                    .rotationDegrees(state.ageInTicks * 12.0f));
            submitNodeCollector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                    (pose, lines) -> drawCube(lines, pose.pose(), 0.16f, 235));
            poseStack.popPose();
            super.submit(state, poseStack, submitNodeCollector, camera);
            return;
        }

        // 落水后：窝料团（小一点，别挡住圈）。
        // ⚠ 这个团必须**先画且不受白圈闪烁影响** —— 旧代码在判断闪烁之前就画了它，
        //   闪烁只让白圈灭掉，窝料团本体始终可见。
        submitNodeCollector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                (pose, lines) -> drawCube(lines, pose.pose(), 0.11f, 235));

        // ---- 白圈 ----
        // 剩余寿命不足 20% 时闪烁（每 0.4 秒亮灭一次），提示该补窝了
        float life = state.lifeRatio;
        int ringAlpha;
        if (life < 0.2f) {
            if (((state.tickCount / 8) & 1) != 0) {
                poseStack.popPose();
                super.submit(state, poseStack, submitNodeCollector, camera);
                return;
            }
            ringAlpha = 140;
        } else if (life < 0.35f) {
            ringAlpha = (int) ((0.6f + (life - 0.2f) / 0.15f * 0.4f) * 230.0f);
        } else {
            ringAlpha = 230;
        }

        final int alpha = ringAlpha;
        submitNodeCollector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                (pose, lines) -> drawRing(lines, pose.pose(), ChumManager.radius(), alpha));

        poseStack.popPose();
        super.submit(state, poseStack, submitNodeCollector, camera);
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
            lines.addVertex(mat, a[0], a[1], a[2]).setColor(CR, CG, CB, alpha)
                    .setNormal(0f, 1f, 0f).setLineWidth(LINE_WIDTH);
            lines.addVertex(mat, b[0], b[1], b[2]).setColor(CR, CG, CB, alpha)
                    .setNormal(0f, 1f, 0f).setLineWidth(LINE_WIDTH);
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
            lines.addVertex(mat, x0, (float) RING_Y, z0).setColor(255, 255, 255, alpha)
                    .setNormal(0f, 1f, 0f).setLineWidth(LINE_WIDTH);
            lines.addVertex(mat, x1, (float) RING_Y, z1).setColor(255, 255, 255, alpha)
                    .setNormal(0f, 1f, 0f).setLineWidth(LINE_WIDTH);
        }
    }
}
