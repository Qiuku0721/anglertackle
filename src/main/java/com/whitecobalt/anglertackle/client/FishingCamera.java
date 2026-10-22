package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ViewportEvent;

/**
 * 对抗期的相机：<b>视角跟随鱼钩</b> + <b>收线时再拉近一点</b>。
 *
 * <p><b>用户口径（2026-10-01）</b>：
 * <ul>
 *   <li>"鱼上钩后视角跟着鱼钩跑" —— 中鱼之后镜头对准浮漂；</li>
 *   <li>"玩家点击左键收线时再轻微放大，松开放线回到上鱼时的放大水平"。</li>
 * </ul>
 *
 * <p><b>两条硬约束</b>（都写成了断言，见 tools/check-fishing-camera.js）：
 * <ol>
 *   <li><b>只改渲染视角，不改玩家真实朝向。</b>
 *       这里只动 {@code event.setYaw/setPitch}，绝不碰 {@code player.setYRot/setXRot}：
 *       真实朝向一改，抛投方向、原版瞄准、服务端的位置校验都会跟着变，
 *       而玩家只是"想看清浮漂"。所以战斗结束/没在对抗时，一切自动回到原样。</li>
 *   <li><b>拉近必须是"乘以当前 FOV"，不能写死数值。</b>
 *       用户原话是"回到上鱼时的放大水平"—— 也就是说基线是**当时画面上本来就有的**
 *       视野水平（可能还叠着别的效果）。写死一个数字就会把它顶掉，
 *       松手也回不到"原样"。所以这里 {@code setFOV(getFOV() * 系数)}。</li>
 * </ol>
 *
 * <p>两个事件每帧各触发一次。<b>触发顺序（已用字节码核对，不是猜的）</b>：
 * {@code GameRenderer.renderLevel} 里先是 {@code Camera.setup}（在其中触发
 * {@code ComputeCameraAngles}），随后才调 {@code getFov}（触发 {@code ComputeFov}）。
 * 所以帧间隔在前者里算一次、后者复用 —— 否则第二个拿到的时间差恒为 0，渐入会失效。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class FishingCamera {

    /** 渐入/渐出速度（1/秒）。4 ≈ 0.25 秒走完，够快但不甩镜头。 */
    private static final float RAMP_PER_SECOND = 4.0f;
    /** 一帧都没算出来时的兜底帧间隔（秒）。约等于 60fps。 */
    private static final double FALLBACK_DT = 1.0 / 60.0;
    /** 这里以下就当作"没生效"，直接不碰事件 —— 免得每帧都写一个几乎相同的值。 */
    private static final float EPS = 0.01f;

    /**
     * 瞄准目标的**位置**平滑时间常数（秒）。
     *
     * <p>为什么必须平滑：浮漂位置有两个来源，抖动程度差一个数量级 ——
     * <ul>
     *   <li>客户端实体（带插值）→ 每帧都在动，最顺；</li>
     *   <li>会话同步包里的坐标 → 服务端**每 2 tick** 才发一次，也就是 10Hz 的台阶。</li>
     * </ul>
     * 直接拿后者当目标，镜头就会以 10Hz 一跳一跳地追浮漂 ——
     * 玩家看到的就是"移动镜头卡卡的"（用户 2026-10-01 反馈）。
     */
    private static final double POS_TAU = 0.09;

    /** 瞄准**角度**的平滑时间常数（秒）。比位置再短一点，免得跟着鼠标发飘。 */
    private static final double ANGLE_TAU = 0.08;

    /** 目标一次性跳这么远（格²）就当成"换了个浮漂/重新抛竿"，直接吸附、不滑过去。 */
    private static final double SNAP_DIST_SQ = 64.0;

    private static long lastNanos;
    private static double frameDt = FALLBACK_DT;
    /** 跟随强度渐入值 0~1。 */
    private static float follow;
    /** 收线拉近渐入值 0~1。 */
    private static float zoom;
    private static boolean lastWantDiag;
    private static boolean lastFightDiag;
    /** 平滑后的瞄准点（世界坐标）。 */
    private static Vec3 smoothTarget = Vec3.ZERO;
    private static boolean hasTarget;
    /** 平滑后的画面角度（**自己的**，不是 event 里那个每帧都变的玩家朝向）。 */
    private static float smoothYaw;
    private static float smoothPitch;
    private static boolean hasAngles;

    private FishingCamera() {
    }

    /**
     * 帧率无关的指数逼近系数：dt 秒内走完 {@code 1 − e^(−dt/τ)}。
     *
     * <p>⚠ 不能用"每帧固定走 20%"那种写法：那样 30fps 和 240fps 的收敛速度差 8 倍，
     * 一台机器丝滑、另一台发飘，而代码看上去完全正常。
     */
    private static float ease(double dt, double tau) {
        return (float) (1.0 - Math.exp(-dt / tau));
    }

    // ------------------------------------------------------------------ 配置
    // 配置在极早期可能还没加载完，get() 会抛异常；抛出去会让整个渲染层崩掉，
    // 所以三个取值都做兜底（和 FishingLineRenderer.simplifyBeyond 同一套理由）。
    //
    // ⚠ 必须写**全限定名**：本文件在 …anglertackle.client 包里，而 Config 在
    //   …anglertackle 包 —— Java 不会自动 import 父包，写 `Config.INSTANCE`
    //   会被当成"包 Config 里的类 INSTANCE"，报"程序包Config.INSTANCE不存在"（真踩过）。
    //   同目录的 FishingLineRenderer / ClientFishingState 也都用全限定名。
    private static boolean cfgFollow() {
        try {
            return com.whitecobalt.anglertackle.Config.INSTANCE.hookCameraFollow.get();
        } catch (Throwable t) {
            return true;
        }
    }

    private static double cfgStrength() {
        try {
            return com.whitecobalt.anglertackle.Config.INSTANCE.hookCameraFollowStrength.get();
        } catch (Throwable t) {
            return 0.9;
        }
    }

    private static double cfgReelZoomPercent() {
        try {
            return com.whitecobalt.anglertackle.Config.INSTANCE.reelZoomPercent.get();
        } catch (Throwable t) {
            return 93.0;
        }
    }

    // ------------------------------------------------------------------ 时间
    /** 由 {@link #onCameraAngles} 每帧调一次（它先于 ComputeFov）。 */
    private static double beginFrame() {
        long now = System.nanoTime();
        double dt = lastNanos == 0 ? FALLBACK_DT : (now - lastNanos) / 1.0e9;
        lastNanos = now;
        // 夹一下：切窗口/暂停回来时 dt 可能很大，不夹会让镜头瞬移到位
        frameDt = Mth.clamp(dt, 0.0, 0.25);
        return frameDt;
    }

    /** 朝目标值靠拢一步（指数逼近）。 */
    private static float step(float cur, boolean on, double dt) {
        float target = on ? 1.0f : 0.0f;
        float k = (float) Math.min(1.0, RAMP_PER_SECOND * dt);
        return cur + (target - cur) * k;
    }

    // ------------------------------------------------------------------ 视角跟随
    @SubscribeEvent
    public static void onCameraAngles(ViewportEvent.ComputeCameraAngles event) {
        double dt = beginFrame();

        Minecraft mc = Minecraft.getInstance();
        ClientFishingState st = ClientFishingState.get();
        boolean want = cfgFollow()
                && holdingLureRod()          // 台钓不跟随（用户定案：视野不变）
                && st.inFight()
                && st.bobberActive()
                && mc.options != null
                && mc.options.getCameraType().isFirstPerson();

        follow = step(follow, want, dt);
        Vec3 aim = want ? bobberAimPos(event.getPartialTick()) : null;
        if (follow < EPS || aim == null) {
            // 跟随结束：把自己的平滑角度/目标丢掉，下次中鱼重新吸附
            hasAngles = false;
            hasTarget = false;
            return;
        }

        // ---- 目标位置：先按时间平滑一次 ----
        if (!hasTarget || aim.distanceToSqr(smoothTarget) > SNAP_DIST_SQ) {
            smoothTarget = aim;     // 首次 / 换了个浮漂：直接吸附，别从旧位置慢慢滑过去
            hasTarget = true;
        } else {
            smoothTarget = smoothTarget.lerp(aim, ease(dt, POS_TAU));
        }

        // 从**相机**位置算，而不是玩家的眼睛：第一人称下两者基本重合，
        // 但第三人称/骑乘时相机位置不同，用相机位置才不会算歪。
        Vec3 cam = event.getCamera().getPosition();
        double dx = smoothTarget.x - cam.x;
        double dy = smoothTarget.y - cam.y;
        double dz = smoothTarget.z - cam.z;
        double horiz = Math.sqrt(dx * dx + dz * dz);
        if (horiz < 1.0e-3) {
            return;   // 浮漂几乎在正上方/正下方，方位角没有意义
        }

        // MC 的朝向约定（Entity.getViewVector）：
        //   dx = -sin(yaw)cos(pitch)，dy = -sin(pitch)，dz = cos(yaw)cos(pitch)
        // 反解过来就是下面两行（pitch 为正 = 低头）。
        float wantYaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float wantPitch = (float) -Math.toDegrees(Math.atan2(dy, horiz));

        // ---- 角度：先算"这一帧该看到的画面角度"，再对自己的角度做时间平滑 ----
        //
        // ⚠ 不能直接 event.setYaw(玩家朝向 与 目标 的混合)：event 里的 yaw 每帧都是
        //   玩家的真实朝向，按固定比例混合出来的结果**只跟鼠标有关、不带时间** ——
        //   目标一跳，画面就跟着跳（这正是"卡卡的"的另一半原因）。
        //   所以维护自己的 smoothYaw/smoothPitch，用帧率无关的指数逼近追过去。
        float k = follow * (float) cfgStrength();
        // 偏航必须走**最短弧**：直接线性插值会在 ±180° 边界上把镜头甩一整圈
        float idealYaw = event.getYaw() + Mth.wrapDegrees(wantYaw - event.getYaw()) * k;
        float idealPitch = event.getPitch()
                + (Mth.clamp(wantPitch, -90.0f, 90.0f) - event.getPitch()) * k;

        if (!hasAngles) {
            smoothYaw = idealYaw;
            smoothPitch = idealPitch;
            hasAngles = true;
        } else {
            float a = ease(dt, ANGLE_TAU);
            smoothYaw += Mth.wrapDegrees(idealYaw - smoothYaw) * a;
            smoothPitch += (idealPitch - smoothPitch) * a;
        }
        event.setYaw(smoothYaw);
        event.setPitch(smoothPitch);
    }

    /**
     * 这一帧要瞄的浮漂位置：**优先用客户端实体的插值位置**。
     *
     * <p>实体位置每 tick 由服务端更新、客户端按 partialTick 插值 → 每帧都在动，最顺；
     * 而会话同步包里的坐标是**每 2 tick** 一份的离散值。两者差一个数量级的抖动，
     * 所以能用实体就用实体（找不到时才退回同步坐标，见 {@link #POS_TAU} 的说明）。
     *
     * <p>判定"哪个实体是我的浮漂"沿用鱼线渲染那套：**离同步坐标最近的那个**
     * （同一片水域里基本只会有自己这一个浮漂）。只遍历当前已加载的实体，开销可忽略。
     *
     * @return 瞄准点；没有浮漂时返回 {@code null}
     */
    private static Vec3 bobberAimPos(double partialTick) {
        ClientFishingState st = ClientFishingState.get();
        Vec3 synced = st.bobberPos();
        if (synced.equals(Vec3.ZERO)) {
            return null;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.level != null) {
            com.whitecobalt.anglertackle.entity.BobberEntity best = null;
            double bestD = 36.0;   // 6 格内才认，免得瞄到别人的浮漂
            for (var e : mc.level.entitiesForRendering()) {
                if (e instanceof com.whitecobalt.anglertackle.entity.BobberEntity b) {
                    double d = b.position().distanceToSqr(synced);
                    if (d < bestD) {
                        bestD = d;
                        best = b;
                    }
                }
            }
            if (best != null) {
                // 插值位置：这一帧真正该画在哪
                return best.getPosition((float) partialTick);
            }
        }
        return synced;
    }

    /**
     * 手上是不是一根**路亚竿**。
     *
     * <h2>⚠⚠ 2026-10-16 用户定案："台钓钓上鱼会立刻放大视野，这不是我想要的，我需要不变"</h2>
     * 原来"收线拉近 / 视角跟随"只判 {@code st.inFight()} —— 那是**服务端状态**。
     * 只要状态串了一帧（或者将来谁让台钓也走对抗），台钓的视野就会被放大/被拽向浮漂，
     * 而台钓**根本没有收线拉近这个概念**（它一上鱼就直接收鱼）✗。
     *
     * <p>现在多判一道**竿型**：台钓竿 ⇒ 无论状态怎么变，视野一律不动 ✓。
     * 两道判据都留着是有意的：{@code inFight()} 管"什么时候"，竿型管"哪根竿"，缺一不可。
     */
    private static boolean holdingLureRod() {
        try {
            var mc = Minecraft.getInstance();
            return mc.player != null
                    && mc.player.getMainHandItem().getItem()
                        instanceof com.whitecobalt.anglertackle.item.RodItem r
                    && r.rodType() == com.whitecobalt.anglertackle.item.RodItem.RodType.LURE;
        } catch (Throwable t) {
            return false;   // 判不出来就别动视野（宁可不动，也不要乱放大）
        }
    }

    // ------------------------------------------------------------------ 收线拉近
    @SubscribeEvent
    public static void onComputeFov(ViewportEvent.ComputeFov event) {
        ClientFishingState st = ClientFishingState.get();
        // ⚠ 用户定案（2026-10-16）：台钓视野必须**不变** ⇒ 多判一道竿型。
        boolean want = st.inFight() && st.reeling() && holdingLureRod();
        // ★诊断：**只在状态变化时**记一行（原来每帧一行，一次收线就刷了 1272 行日志）。
        //   带上**竿型**：这样"台钓被放大"到底是"手拿路亚竿"还是"状态串了"一眼可辨。
        if (want != lastWantDiag || st.inFight() != lastFightDiag) {
            lastWantDiag = want;
            lastFightDiag = st.inFight();
            com.whitecobalt.anglertackle.AnglersTackle.LOGGER.info(
                    "[垂纶/诊断·相机] 拉近={} 在对抗={} 收线中={} 手竿={} zoom={}",
                    want, st.inFight(), st.reeling(),
                    holdingLureRod() ? "路亚" : "台钓/空手", String.format("%.3f", zoom));
        }
        zoom = step(zoom, want, frameDt);
        if (zoom < EPS) {
            return;
        }

        double factor = 1.0 + (cfgReelZoomPercent() / 100.0 - 1.0) * zoom;
        // ★ 乘在**当前** FOV 上：基线是画面上本来就有的视野水平，松手即回到原样。
        event.setFOV(event.getFOV() * factor);
    }
}
