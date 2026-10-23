package com.whitecobalt.anglertackle.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.whitecobalt.anglertackle.client.ClientFishingState;
import com.whitecobalt.anglertackle.item.RodItem;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.SubmitCustomGeometryEvent;
import org.joml.Matrix4f;

/**
 * 鱼线渲染（含"幽灵鱼线"）。
 *
 * <p>这是 docs/09-原版冲突与渲染优化.md §4.3 的落地：
 * <b>鱼线渲染与实体是否存在解耦</b>。原因有三层距离限制，其中客户端视距
 * （L3）模组无法控制——玩家视距 4 区块时，70 格外的浮漂根本不会被同步。
 * 所以线必须靠会话同步包里的落点坐标来画。
 *
 * <p>三个渲染档位（同文档 §4.3 表格）：
 * <ul>
 *   <li>实体可见 → 不画（原版浮漂自带线，避免画两条）</li>
 *   <li>实体不可见 → 画幽灵线 + 落点标记</li>
 *   <li>距离 &gt; 64 格 → 简化为直线（省去曲率计算，远处抖动看起来像 bug）</li>
 * </ul>
 */
@EventBusSubscriber(modid = com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class FishingLineRenderer {

    /**
     * 超过该距离改用简化线型。来自 config {@code render.ghostLineBeyondBlocks}。
     *
     * <p>做一层兜底：配置在极早期可能还没加载完，{@code get()} 会抛异常，
     * 抛出去会让整个渲染层崩掉。所以兜 64（也是默认值）。
     */
    private static double simplifyBeyond() {
        try {
            return com.whitecobalt.anglertackle.Config.INSTANCE.ghostLineBeyondBlocks.get();
        } catch (Throwable t) {
            return 64.0;
        }
    }
    /** 完全绷直时的抖动幅度（格）。 */
    private static final double JITTER = 0.01;

    /**
     * 线宽：旧版 {@code RenderType.lines()} 的实际宽度是 GL 默认 1.0。
     * 26.1.2 的线宽是顶点属性（LINE_WIDTH），不写就是 0（线不可见），所以显式写 1.0。
     */
    private static final float LINE_WIDTH = 1.0F;

    private FishingLineRenderer() {
    }

    @SubscribeEvent
    public static void onSubmitCustomGeometry(SubmitCustomGeometryEvent event) {
        // ★ 别人的线（2026-10-10 多人实测：对方的鱼线完全不渲染 ✗）
        //   ⚠ 必须在下面 state.inSession() 早退**之前**调用 ✗ ——
        //   那个判断问的是"**我**在不在钓"✓，和别人在不在钓毫无关系 ✓
        renderOtherPlayersLines(event);

        ClientFishingState state = ClientFishingState.get();
        if (!state.inSession()) {
            return;
        }
        // ★ 蓄力阶段还没有浮漂：此时画线会在玩家脚下出现"白框 + 竖线"
        if (!state.bobberActive()) {
            return;
        }

        Minecraft mc = Minecraft.getInstance();
        LocalPlayer player = mc.player;
        if (player == null || mc.level == null) {
            return;
        }

        Vec3 bobber = state.bobberPos();
        if (bobber.equals(Vec3.ZERO)) {
            return;
        }

        // 相机位置：26.1.2 从 LevelRenderState 的相机状态取（提交阶段没有 Camera 对象）。
        CameraRenderState camera = event.getLevelRenderState().cameraRenderState;
        Vec3 cam = camera.pos;
        float partialTick = mc.getDeltaTracker().getGameTimeDeltaPartialTick(false);
        Vec3 rodTip = rodTipPosition(player, partialTick, camera);

        // 实体不可见时才画幽灵线，避免和原版浮漂自带的线重叠
        boolean entityVisible = isBobberSynced(bobber);

        Vec3 lineEnd = bobber;
        double dist = cam.distanceTo(bobber);
        boolean simplified = dist > simplifyBeyond();

        int color = state.lineColor(partialTick);
        float straightness = simplified ? 1.0f : state.lineStraightness(partialTick);

        // 疲劳期：鱼线轻微变暗（"现在好拉"的极简视觉提示，不做额外特效）
        if (state.fatigued()) {
            color = darken(color, 0.72f);
        }

        PoseStack poseStack = event.getPoseStack();
        poseStack.pushPose();
        poseStack.translate(-cam.x, -cam.y, -cam.z);

        SubmitNodeCollector collector = event.getSubmitNodeCollector();
        float r = ((color >> 16) & 0xFF) / 255.0f;
        float g = ((color >> 8) & 0xFF) / 255.0f;
        float b = (color & 0xFF) / 255.0f;
        final Vec3 tip = rodTip;
        final Vec3 end = lineEnd;

        if (entityVisible || !simplified) {
            // 带下垂曲率：白区明显下垂，红区绷直（这是"看线就知道张力"的关键）
            collector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                    (pose, lines) -> drawSaggingLine(lines, pose.pose(), tip, end, straightness, r, g, b));
        } else {
            // 简化线型：两点直连
            collector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                    (pose, lines) -> drawSegment(lines, pose.pose(), tip, end, r, g, b, 1.0f));
        }

        // 落点标记：远距离时让玩家知道"线到哪了"
        if (!entityVisible) {
            collector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                    (pose, lines) -> drawLandingMarker(lines, pose.pose(), end, r, g, b));
        }

        poseStack.popPose();
    }

    /**
     * 画**别的玩家**的鱼线（2026-10-10 多人实测：对方的鱼线完全不渲染 ✗）。
     *
     * <p>为什么以前没有：本地那条线走 {@link RodTipAnchor} —— 它订阅原版手持渲染、
     * 照抄 firstperson 显示变换，拿到的是"屏幕上那根竿真实的竿尖"✓。
     * 但**别人的客户端上根本没有这套数据** ✗（那是本地手持渲染的产物 ✓）
     * ⇒ 只能退一步，用**实体手部位置**估算 ✓ —— 原版 {@code FishingHookRenderer}
     * 给"别人的钓鱼线"用的也是这种估算口径 ✓。线能接在手上、能看出张力就够了 ✓。
     *
     * <p>配对方式：遍历所有浮漂实体 ⇒ **就近**找一个握着竿的玩家（40 格内 ✓）⇒ 连手与浮漂 ✓。
     * 不查"这个浮漂属于谁"✗：`BobberEntity` 的主人访问器是服务端口径的（返回 `ServerPlayer` ✗），
     * 客户端拿不到；而本模组一人同时只有一根线 ✓ ⇒ 就近配对在玩法上等价 ✓，
     * 而且**不需要新增任何同步字段** ✓（多人适配里这是最省事、最不影响本体的一条路 ✓）。
     */
    private static void renderOtherPlayersLines(SubmitCustomGeometryEvent event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            return;
        }

        // 先筛出"别人里握着竿的"（自己在下面单独跳过 ✓）
        java.util.List<net.minecraft.world.entity.player.Player> holders = new java.util.ArrayList<>();
        for (net.minecraft.world.entity.player.Player p : mc.level.players()) {
            if (p == mc.player || !p.isAlive()) {
                continue;
            }
            if (holdsRod(p)) {
                holders.add(p);
            }
        }
        if (holders.isEmpty()) {
            return;
        }

        float partial = mc.getDeltaTracker().getGameTimeDeltaPartialTick(false);
        CameraRenderState camera = event.getLevelRenderState().cameraRenderState;
        Vec3 cam = camera.pos;
        PoseStack poseStack = event.getPoseStack();

        poseStack.pushPose();
        poseStack.translate(-cam.x, -cam.y, -cam.z);

        SubmitNodeCollector collector = event.getSubmitNodeCollector();
        for (net.minecraft.world.entity.Entity e : mc.level.entitiesForRendering()) {
            if (!(e instanceof com.whitecobalt.anglertackle.entity.BobberEntity bobber)) {
                continue;
            }
            // ★ 按**同步过来的主人 UUID** 精确配对（2026-10-10 用户指出的反例 ✓）：
            //   原来我用"就近的握竿玩家"✗ —— A 抛得远、B 站得更近时，会把线画成
            //   「B 的手 → A 的浮漂」✗✗，而 A 自己那根反而消失 ✗。"一人一根线"只保证数量 ✓，
            //   不保证配对 ✓；DATA_OWNER 是同步字段（主人 UUID ✓）⇒ 客户端能精确对上 ✓。
            java.util.UUID ownerId = bobber.ownerId();
            if (ownerId == null) {
                continue;                                   // 还没同步到主人 ⇒ 这一帧先不画 ✓
            }
            net.minecraft.world.entity.player.Player owner = null;
            for (net.minecraft.world.entity.player.Player p : holders) {
                if (p.getUUID().equals(ownerId)) {
                    owner = p;
                    break;
                }
            }
            if (owner == null) {
                continue;                                   // 主人不在场 / 手里没握竿 ⇒ 不画 ✓
            }
            Vec3 end = new Vec3(Mth.lerp(partial, bobber.xo, bobber.getX()),
                    Mth.lerp(partial, bobber.yo, bobber.getY()),
                    Mth.lerp(partial, bobber.zo, bobber.getZ()));
            // 自己那根线上面已经画过（用的是真实竿尖 ✓）⇒ 这里**不用再判距离** ✗：
            //   holdsRod 列表里本来就不含自己 ✓ ⇒ 主人是自己时上面 owner == null 已经 continue 了 ✓。
            //   （用距离判反而会误伤：两个人的浮漂挨在一起时，会把别人的线错杀 ✗）
            final net.minecraft.world.entity.player.Player lineOwner = owner;
            collector.submitCustomGeometry(poseStack, RenderTypes.lines(),
                    (pose, lines) -> drawSaggingLine(lines, pose.pose(), handTip(lineOwner, partial), end,
                            1.0f, 0.92f, 0.92f, 0.86f));
        }
        poseStack.popPose();
    }

    /** 主手或副手握着本模组鱼竿 ✓ */
    private static boolean holdsRod(net.minecraft.world.entity.player.Player p) {
        return p.getMainHandItem().getItem() instanceof RodItem
                || p.getOffhandItem().getItem() instanceof RodItem;
    }

    /**
     * 别人的"竿尖"估算 ✓（本地玩家不走这条路 ✗ —— 那条走 {@link RodTipAnchor} 的真实竿尖 ✓）。
     *
     * <p>身体朝向 + 持竿手侧算一个手部位置 ✓；竿握在副手就换边 ✓。
     * 精度足够（鱼线看的是"连没连在手上"和下垂曲率 ✓），而且**不需要任何同步字段** ✓。
     */
    private static Vec3 handTip(net.minecraft.world.entity.player.Player p, float partial) {
        double x = Mth.lerp(partial, p.xo, p.getX());
        double y = Mth.lerp(partial, p.yo, p.getY());
        double z = Mth.lerp(partial, p.zo, p.getZ());
        float yaw = (float) Math.toRadians(Mth.rotLerp(partial, p.yBodyRotO, p.yBodyRot));
        int side = p.getMainArm() == HumanoidArm.RIGHT ? 1 : -1;
        if (p.getMainHandItem().isEmpty()) {
            side = -side;                                   // 竿在副手 ⇒ 换边 ✓
        }
        double fwd = 0.55;
        double out = 0.34 * side;
        double up = p.getEyeHeight() * 0.82;
        return new Vec3(x - Math.sin(yaw) * fwd + Math.cos(yaw) * out,
                y + up,
                z + Math.cos(yaw) * fwd + Math.sin(yaw) * out);
    }

    /**
     * 竿尖位置（鱼线的上端）。
     *
     * <p><b>首选 {@link RodTipAnchor}：那是"屏幕上那根竿真的画在哪"。</b>
     * 它订阅原版 {@code RenderHandEvent}，照抄手持渲染那两步变换
     * （手持 / BOW 使用动画 + 物品自己的 firstperson 显示变换），
     * 再把竿尖在图标上的像素乘进去，得到相机空间里的真实竿尖。
     *
     * <p>这条路径是"唯一正确"的那条：我们的模型是 {@code item:generated}、
     * 竿尖在贴图**左上**角，而原版 {@code FishingHookRenderer.getPlayerHandPos}
     * 那两个数（{@code getPointOnPlane(±0.525, −0.1)}）是对着原版自己的竿
     * （{@code item/handheld_rod} 变换 + 竿尖在贴图右上角）调的，
     * 直接照抄仍然会让线头离竿尖差大半个屏幕 —— 用户 2026-10-02 截图反馈的
     * "鱼线实际上没有连接到杆子上"就是这么来的（更早那版是"眼睛前方 1.1 格"的纯估算）。
     *
     * <p>下面保留近平面锚点作为**兜底**：第一人称下极小概率还没有过手持渲染
     * （例如刚进世界的第一帧），此时 {@code worldTip} 返回 {@code null}，
     * 用原版口径先顶一帧，手感与原版一致。
     */
    private static Vec3 rodTipPosition(LocalPlayer player, float partialTick, CameraRenderState camera) {
        Minecraft mc = Minecraft.getInstance();
        int side = rodHandSide(player);
        float swing = Mth.sin(Mth.sqrt(player.getAttackAnim(partialTick)) * (float) Math.PI);

        if (mc.options.getCameraType().isFirstPerson() && player == mc.player) {
            Vec3 exact = RodTipAnchor.worldTip(camera);
            if (exact != null) {
                return exact;
            }
            double fovScale = 960.0 / (double) mc.options.fov().get();
            // 26.1.2 的 Camera.getNearPlane 需要显式 FOV（原版 FishingHookRenderer 同样传 options.fov）。
            Vec3 tip = mc.gameRenderer.getMainCamera().getNearPlane((float) mc.options.fov().get())
                    .getPointOnPlane((float) side * 0.525F, -0.1F)
                    .scale(fovScale)
                    .yRot(swing * 0.5F)
                    .xRot(-swing * 0.7F);
            return player.getEyePosition(partialTick).add(tip);
        }

        float bodyYaw = Mth.lerp(partialTick, player.yBodyRotO, player.yBodyRot) * (float) (Math.PI / 180.0);
        double sin = Mth.sin(bodyYaw);
        double cos = Mth.cos(bodyYaw);
        float scale = player.getScale();
        double lateral = side * 0.35 * scale;
        double forward = 0.8 * scale;
        float crouch = player.isCrouching() ? -0.1875F : 0.0F;
        return player.getEyePosition(partialTick).add(
                -cos * lateral - sin * forward,
                crouch - 0.45 * scale,
                -sin * lateral + cos * forward);
    }

    /**
     * 拿竿的是哪只手：{@code +1} = 右手（第一人称画面右侧），{@code −1} = 左手。
     *
     * <p>⚠ 原版那里还有一句"手里拿的如果不能抛竿就左右互换"
     * （{@code canPerformAction(FISHING_ROD_CAST)}，为的是"抛竿后换成别的物品"那种情况）。
     * 我们**不能照抄那一句**：我们的竿没有声明那个能力，
     * 照抄会把线头放到**空着的那只手**一侧。这里按"自己竿在哪只手"判断。
     */
    private static int rodHandSide(LocalPlayer player) {
        boolean mainIsRod = player.getMainHandItem().getItem() instanceof RodItem;
        boolean offIsRod = player.getOffhandItem().getItem() instanceof RodItem;
        boolean right;
        if (mainIsRod) {
            right = player.getMainArm() == HumanoidArm.RIGHT;
        } else if (offIsRod) {
            right = player.getMainArm() != HumanoidArm.RIGHT;
        } else {
            right = true;   // 两只手都没拿（理论上进不来）：按主手算
        }
        return right ? 1 : -1;
    }

    /**
     * 画一条带下垂的线。用 8 段折线近似曲线。
     *
     * @param straightness 0 = 松弛下垂，1 = 完全绷直
     */
    private static void drawSaggingLine(VertexConsumer lines, Matrix4f matrix,
                                        Vec3 from, Vec3 to, float straightness,
                                        float r, float g, float b) {
        final int segments = 8;
        double sag = 0.35 * (1.0 - straightness);   // 白区中点下垂 0.35 格

        Vec3 prev = from;
        for (int i = 1; i <= segments; i++) {
            double t = i / (double) segments;
            Vec3 point = from.lerp(to, t);
            // 抛物线下垂：中点最低
            double dip = Math.sin(Math.PI * t) * sag;
            // 红区开始抖动
            double jitter = straightness > 0.8 ? (Math.random() - 0.5) * JITTER : 0.0;
            point = point.add(0, -dip + jitter, 0);

            drawSegment(lines, matrix, prev, point, r, g, b, 1.0f);
            prev = point;
        }
    }

    private static void drawSegment(VertexConsumer lines, Matrix4f matrix,
                                    Vec3 from, Vec3 to, float red, float green, float blue, float alpha) {
        float nx = (float) (to.x - from.x);
        float ny = (float) (to.y - from.y);
        float nz = (float) (to.z - from.z);
        double len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1.0e-6) {
            return;
        }
        nx /= (float) len;
        ny /= (float) len;
        nz /= (float) len;

        lines.addVertex(matrix, (float) from.x, (float) from.y, (float) from.z)
                .setColor(red, green, blue, alpha).setNormal(nx, ny, nz).setLineWidth(LINE_WIDTH);
        lines.addVertex(matrix, (float) to.x, (float) to.y, (float) to.z)
                .setColor(red, green, blue, alpha).setNormal(nx, ny, nz).setLineWidth(LINE_WIDTH);
    }

    /** 落点标记：水面上的一个小方框，颜色跟随张力。 */
    private static void drawLandingMarker(VertexConsumer lines, Matrix4f matrix,
                                          Vec3 center, float r, float g, float b) {
        double s = 0.35;
        double y = center.y + 0.02;
        Vec3[] corners = {
                new Vec3(center.x - s, y, center.z - s),
                new Vec3(center.x + s, y, center.z - s),
                new Vec3(center.x + s, y, center.z + s),
                new Vec3(center.x - s, y, center.z + s)
        };
        for (int i = 0; i < 4; i++) {
            drawSegment(lines, matrix, corners[i], corners[(i + 1) % 4], r, g, b, 0.8f);
        }
    }

    private static int lerpColor(int from, int to, float k) {
        k = Math.max(0.0f, Math.min(1.0f, k));
        int r = (int) ((from >> 16 & 0xFF) + (((to >> 16 & 0xFF) - (from >> 16 & 0xFF)) * k));
        int g = (int) ((from >> 8 & 0xFF) + (((to >> 8 & 0xFF) - (from >> 8 & 0xFF)) * k));
        int b = (int) ((from & 0xFF) + ((to & 0xFF) - (from & 0xFF)) * k);
        return (r << 16) | (g << 8) | b;
    }

    private static int darken(int color, float factor) {
        int r = (int) (((color >> 16) & 0xFF) * factor);
        int g = (int) (((color >> 8) & 0xFF) * factor);
        int b = (int) ((color & 0xFF) * factor);
        return (r << 16) | (g << 8) | b;
    }

    /**
     * 判断浮漂实体是否已经被客户端同步到。
     *
     * <p>没同步到就说明超出了追踪范围或客户端视距（三层距离限制中的 L1/L3），
     * 此时必须靠幽灵线兜底。只遍历当前已加载的实体，开销可忽略。
     */
    private static boolean isBobberSynced(Vec3 pos) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            return false;
        }
        for (var entity : mc.level.entitiesForRendering()) {
            if (entity instanceof com.whitecobalt.anglertackle.entity.BobberEntity
                    && entity.position().distanceToSqr(pos) < 4.0) {
                return true;
            }
        }
        return false;
    }
}
