package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.whitecobalt.anglertackle.client.ClientOreSight;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.core.BlockPos;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.SubmitCustomGeometryEvent;
import org.joml.Matrix4f;

/**
 * 【明目】的指引线：**由准心指向最近的那块矿物**（用户 2026-10-03 定案）。
 *
 * <h2>为什么改成画线，而不是原来的粒子点线</h2>
 * 用户原话："一个是不算很能清晰地指引方向，二个是粒子多会容易卡顿，
 * 建议参考鱼线的渲染方式，做一个由准心指向矿物块的线。"
 * 一个目标一共约 30 条线段，**没有粒子实体**，方向和颜色都能自己定。
 *
 * <h2>三个视觉元素（都在回答"往哪走"）</h2>
 * <ol>
 *   <li><b>主线</b>：从准心前方 0.35 格出发，直到矿物方块中心。起点贴着准心，
 *       所以它就是玩家直觉里的"从准心牵出来的一根线"。</li>
 *   <li><b>流动的点</b>：一个沿主线朝矿物方向移动的小方框（约 1.2 秒一轮），
 *       比静态线段更能说明"往这边走"，而且不依赖玩家去比较两端的远近。</li>
 *   <li><b>目标框</b>：矿物方块上的一个线框方盒（比方块略大 2 cm，避免与原版的
 *       选中框 z-fighting），一眼看清是哪一块。</li>
 * </ol>
 *
 * <h2>遮挡</h2>
 * 用的是原版 {@code RenderTypes.lines()}，与鱼线同一档：**会被方块挡住**。
 * 这是刻意的（看不见矿时线本来也不该穿墙），代价是目标在墙后时只看得见线的前半段
 * —— 那一段的**方向**仍然指向矿物。要改成穿墙可见得新建一个关掉深度测试的 RenderType，
 * 等用户明确要再说（新建 RenderType 有画错的风险，而这里没法靠单元测试看出来）。
 *
 * <h2>26.1.2 迁移</h2>
 * {@code RenderLevelStageEvent} 不再给 {@code MultiBufferSource}，官方替代是
 * {@link SubmitCustomGeometryEvent}：用 {@code event.getPoseStack()} 平移相机，
 * 再 {@code event.getSubmitNodeCollector().submitCustomGeometry(...)} 提交线段。
 * 相机位置/朝向从 {@code LevelRenderState.cameraRenderState} 取，partialTick
 * 从 {@code Minecraft.getDeltaTracker()} 取。坐标、颜色、透明度原样不动。
 */
@EventBusSubscriber(modid = com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class OreSightRenderer {

    /** 主线颜色：金色，与"矿物"的直觉一致。 */
    private static final float[] LINE_COLOR = {1.0f, 0.78f, 0.22f};
    /** 目标框颜色：偏白的青，比主线更"冷"，两者不会糊在一起。 */
    private static final float[] BOX_COLOR = {0.55f, 0.95f, 1.0f};
    /** 起点离准心多远（格）。太贴脸会被近平面裁掉，太远又不像从准心出来的。 */
    private static final double START_OFFSET = 0.35;
    /** 流动点的移动速度（格/秒）：一格一秒左右，看得清又不晃眼。 */
    private static final double DOT_SPEED = 0.9;
    /** 目标框比方块大出来的半径（格）。0.5 = 正好贴方块；多 2 cm 防止与原版选中框打架。 */
    private static final double BOX_INFLATE = 0.52;
    /** 线宽：旧版 {@code RenderType.lines()} 的实际宽度是 GL 默认 1.0；新接口线宽是顶点属性，必须显式写。 */
    private static final float LINE_WIDTH = 1.0F;

    private OreSightRenderer() {
    }

    @SubscribeEvent
    public static void onSubmitCustomGeometry(SubmitCustomGeometryEvent event) {
        BlockPos target = ClientOreSight.target();
        if (target == null) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null) {
            return;
        }
        CameraRenderState camera = event.getLevelRenderState().cameraRenderState;
        Vec3 cam = camera.pos;
        Vec3 end = Vec3.atCenterOf(target);
        // 准心方向用**相机**的朝向（我们自己的钓鱼相机会改它，用玩家的会与画面差一截）
        Vec3 look = Vec3.directionFromRotation(camera.xRot, camera.yRot);
        Vec3 start = cam.add(look.scale(START_OFFSET));
        Vec3 delta = end.subtract(start);
        double dist = delta.length();
        if (dist < 0.1) {
            return;
        }

        PoseStack poseStack = event.getPoseStack();
        poseStack.pushPose();
        poseStack.translate(-cam.x, -cam.y, -cam.z);

        float partialTick = mc.getDeltaTracker().getGameTimeDeltaPartialTick(false);
        SubmitNodeCollector collector = event.getSubmitNodeCollector();
        collector.submitCustomGeometry(poseStack, RenderTypes.lines(), (pose, lines) -> {
            Matrix4f matrix = pose.pose();
            drawSegment(lines, matrix, start, end, LINE_COLOR, 0.9f);
            drawTargetBox(lines, matrix, target);
            drawFlowDot(lines, matrix, start, delta.scale(1.0 / dist), dist, partialTick);
        });

        poseStack.popPose();
    }

    /** 沿主线朝矿物方向移动的小方框（一个小"钻石"，永远正对相机平面）。 */
    private static void drawFlowDot(VertexConsumer lines, Matrix4f matrix,
                                    Vec3 start, Vec3 dir, double dist, float partialTick) {
        double phase = ((System.nanoTime() / 1.0E9) * DOT_SPEED) % Math.max(1.0, dist);
        double t = Math.min(phase, dist);
        Vec3 center = start.add(dir.scale(t));
        double r = 0.09;
        // 用"朝向"的任意两个正交方向撑出一个菱形，不依赖相机朝向，代码更短
        Vec3 up = Math.abs(dir.y) > 0.9 ? new Vec3(1, 0, 0) : new Vec3(0, 1, 0);
        Vec3 side = dir.cross(up).normalize().scale(r);
        Vec3 vert = dir.cross(side).normalize().scale(r);
        Vec3[] pts = {
                center.add(side), center.add(vert), center.subtract(side), center.subtract(vert)
        };
        for (int i = 0; i < 4; i++) {
            drawSegment(lines, matrix, pts[i], pts[(i + 1) % 4], LINE_COLOR, 1.0f);
        }
        // 菱形太小会看不见：再加一条从中心指向矿物的短线，明确"流动方向"
        drawSegment(lines, matrix, center, center.add(dir.scale(0.22)), LINE_COLOR, 1.0f);
    }

    /** 目标方块外面的线框方盒（12 条棱）。 */
    private static void drawTargetBox(VertexConsumer lines, Matrix4f matrix, BlockPos pos) {
        double x0 = pos.getX() + 0.5 - BOX_INFLATE, x1 = pos.getX() + 0.5 + BOX_INFLATE;
        double y0 = pos.getY() + 0.5 - BOX_INFLATE, y1 = pos.getY() + 0.5 + BOX_INFLATE;
        double z0 = pos.getZ() + 0.5 - BOX_INFLATE, z1 = pos.getZ() + 0.5 + BOX_INFLATE;
        Vec3[] c = {
                new Vec3(x0, y0, z0), new Vec3(x1, y0, z0), new Vec3(x1, y0, z1), new Vec3(x0, y0, z1),
                new Vec3(x0, y1, z0), new Vec3(x1, y1, z0), new Vec3(x1, y1, z1), new Vec3(x0, y1, z1)
        };
        int[][] edges = {
                {0, 1}, {1, 2}, {2, 3}, {3, 0},   // 下底
                {4, 5}, {5, 6}, {6, 7}, {7, 4},   // 上底
                {0, 4}, {1, 5}, {2, 6}, {3, 7}    // 立柱
        };
        for (int[] e : edges) {
            drawSegment(lines, matrix, c[e[0]], c[e[1]], BOX_COLOR, 0.85f);
        }
    }

    private static void drawSegment(VertexConsumer lines, Matrix4f matrix,
                                    Vec3 from, Vec3 to, float[] rgb, float alpha) {
        float nx = (float) (to.x - from.x);
        float ny = (float) (to.y - from.y);
        float nz = (float) (to.z - from.z);
        double len = Mth.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1.0e-6) {
            return;
        }
        nx /= (float) len;
        ny /= (float) len;
        nz /= (float) len;

        lines.addVertex(matrix, (float) from.x, (float) from.y, (float) from.z)
                .setColor(rgb[0], rgb[1], rgb[2], alpha).setNormal(nx, ny, nz)
                .setLineWidth(LINE_WIDTH);
        lines.addVertex(matrix, (float) to.x, (float) to.y, (float) to.z)
                .setColor(rgb[0], rgb[1], rgb[2], alpha).setNormal(nx, ny, nz)
                .setLineWidth(LINE_WIDTH);
    }
}
