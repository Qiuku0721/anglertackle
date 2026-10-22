package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.entity.ChumEntity;
import com.whitecobalt.anglertackle.registry.ModEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.AABB;

import javax.annotation.Nullable;
import java.util.List;

/**
 * 窝子（打窝）加成与表现。
 *
 * <p><b>架构说明（重要）</b>：窝子**由 {@link ChumEntity} 承载**，本类只做查询与粒子。
 * <ul>
 *   <li>打窝料右键 → 抛出一条 {@code ChumEntity}（像鸡蛋一样飞出去）</li>
 *   <li>落水后该实体浮在水面、冒泡，并渲染半径 {@link #radius()} 的白圈</li>
 *   <li>加成判定就是**查落点附近有没有这条实体**</li>
 * </ul>
 *
 * <p>这样做的好处是**可见范围与生效范围永远是同一个数**。
 * 旧实现是"服务端另记一个 BlockPos + 另外画粒子"，半径要各写一份，
 * 改动其中一处就会漂移，玩家看到的圈和实际生效的圈对不上。
 * 现在两边都读同一个 {@link #radius()} 与同一条实体；
 * 实体寿命到点自然消亡，加成同时失效，不需要额外的过期清理。
 */
public final class ChumManager {

    private static final ChumManager INSTANCE = new ChumManager();

    /**
     * 窝子半径（格）——**白圈画的就是这个半径**。
     *
     * <p>用户定案 10 格（可在配置里改）：抛竿距离是 8 / 16 / 24 米，10 格的圈够大，
     * 玩家能舒服地把浮漂扔进圈里；又不会大到"整片水面都算窝子"而失去意义。
     *
     * <p>⚠️ 这里**必须**是方法而不是 static 常量。早先写的是
     * <pre>public static final double RADIUS = Config.INSTANCE.chumRadius.get();</pre>
     * 那是**潜伏的启动崩溃**：`static final` 在类初始化时求值，而如果 ChumManager 在
     * 配置加载之前被碰到（注册期顺着某个静态引用摸过来就够了），
     * 就直接 `IllegalStateException: Cannot get config value before config is loaded.`
     * 2026-09-30 那次启动崩溃是同一个坑的另一个实例（RodItem$RodSpec），
     * 只不过这个是碰巧没被启动路径踩到才一直没炸。
     *
     * <p>当时不写成现读的理由是"渲染器每帧都要用它画圈，渲染线程不该依赖配置读取"。
     * 这个顾虑经不起看：`ConfigValue.get()` 就是一次状态检查加一次字段读，
     * 一帧里别的活儿比它重几个数量级；而且**同一个文件里**的
     * {@link #particleInterval()} / {@link #particlesPerBurst()} 早就是现读的了。
     * 改成现读的额外好处：改半径不再需要重启游戏，`/atl config reload` 就生效。
     */
    public static double radius() {
        return com.whitecobalt.anglertackle.fishing.Tuning.chumRadius();
    }

    /** 粒子生成间隔（tick）。走运行时读取，改完热重载即可生效。 */
    private static int particleInterval() {
        return com.whitecobalt.anglertackle.fishing.Tuning.chumParticleIntervalTicks();
    }

    /** 每次生成的粒子数。同样运行时读取。 */
    private static int particlesPerBurst() {
        return com.whitecobalt.anglertackle.fishing.Tuning.chumParticlesPerBurst();
    }

    private ChumManager() {
    }

    public static ChumManager get() {
        return INSTANCE;
    }

    // =================================================================== 每 tick
    /**
     * 给落水的窝子冒粒子。
     *
     * <p>遍历当前已加载的窝子实体。{@code getEntitiesOfClass} 的 AABB 不能给"整个世界"
     * （那会把所有区块都算进来，是实打实的性能灾难），所以这里**以每个玩家为中心开盒子**，
     * 只处理玩家附近那些玩家真能看见的窝子。
     */
    public void tick(ServerLevel level) {
        long now = level.getGameTime();
        // 全服名额先清到期的：名额表是"uuid → 到期时刻"，到期即失效，
        // 所以不需要给每条窝子挂回调 —— 但必须有人定期扫，否则"没人打窝"时
        // 表会一直停在满员状态，下一个人想打窝就被拒（而那批窝子其实早过期了）。
        // 代价：每次最多 40 条记录的遍历，与下面的粒子节流无关，所以放在节流之前。
        com.whitecobalt.anglertackle.fishing.ChumRegistry.get(level).prune(now);

        if (now % particleInterval() != 0) {
            return;
        }
        for (net.minecraft.server.level.ServerPlayer player : level.players()) {
            for (ChumEntity chum : chumsNear(level, player.blockPosition())) {
                if (chum.isSinking()) {
                    // 沉底窝：粒子在中层与底层扩散
                    level.sendParticles(ParticleTypes.BUBBLE_POP,
                            chum.getX(), chum.getY() - 1.0, chum.getZ(),
                            particlesPerBurst(), radius() * 0.25, 0.6, radius() * 0.25, 0.01);
                } else {
                    // 水面窝：粒子在水面散开
                    level.sendParticles(ParticleTypes.FISHING,
                            chum.getX(), chum.getY() + 0.1, chum.getZ(),
                            particlesPerBurst(), radius() * 0.35, 0.1, radius() * 0.35, 0.01);
                }
            }
        }
    }

    // =================================================================== 查询
    /**
     * 查某个落点是否落在窝子范围内，返回**品质最高**的那个窝子。
     *
     * <p>距离只算水平分量（忽略 y）：浮漂落在水面上，窝子也记在水面，
     * 但两者可能差一格高度（水面起伏 / 浮漂下沉），带上 y 会让判定莫名其妙地漏掉。
     *
     * @return 命中的窝子；没有返回 {@code null}
     */
    @Nullable
    public ChumEntity findChumAt(ServerLevel level, BlockPos pos) {
        ChumEntity best = null;
        double bestDist = Double.MAX_VALUE;
        for (ChumEntity chum : chumsNear(level, pos)) {
            double dx = chum.getX() - (pos.getX() + 0.5);
            double dz = chum.getZ() - (pos.getZ() + 0.5);
            double d2 = dx * dx + dz * dz;
            if (d2 > radius() * radius()) {
                continue;
            }
            // 同档取更近的（原来只比 tier，同档时结果依赖实体遍历顺序，不稳定）
            if (best == null || chum.getTier() > best.getTier()
                    || (chum.getTier() == best.getTier() && d2 < bestDist)) {
                best = chum;
                bestDist = d2;
            }
        }
        // 打日志便于自查：玩家报"圈里没加成"时，看这一行就知道是
        // 距离算错了、还是圈画的位置和判定位置不一致。
        if (best != null) {
            org.slf4j.LoggerFactory.getLogger("anglertackle")
                    .info("[垂纶] 浮漂进入窝子：距离 {} 格（半径 {}），档位 {}，倍率 x{}",
                            String.format("%.2f", Math.sqrt(bestDist)), radius(),
                            best.getTier(), String.format("%.2f", best.timeMultiplier()));
        }
        return best;
    }

    /**
     * 取某个位置附近的活跃窝子实体。
     *
     * <p>盒子的**水平**半边长取 {@link #radius()}（够覆盖全部命中范围），
     * 垂直方向给足整个世界高度 —— 窝子在水面、查询点可能在水底或岸边高台，
     * 限死 y 会漏判，而 y 方向的实体数量本来就极少，代价可以忽略。
     */
    private List<ChumEntity> chumsNear(ServerLevel level, BlockPos center) {
        AABB area = new AABB(
                center.getX() - radius(), level.getMinBuildHeight(), center.getZ() - radius(),
                center.getX() + radius(), level.getMaxBuildHeight(), center.getZ() + radius());
        return level.getEntitiesOfClass(ChumEntity.class, area,
                e -> e.isActive() && e.isAlive());
    }

    /** 当前活跃窝子数（调试/统计用）。 */
    public int activeCount(ServerLevel level) {
        int n = 0;
        for (net.minecraft.server.level.ServerPlayer player : level.players()) {
            n += chumsNear(level, player.blockPosition()).size();
        }
        return n;
    }

    /** 某个实体是不是窝子（给渲染/调试用）。 */
    public static boolean isChum(Entity e) {
        return e.getType() == ModEntities.CHUM.get();
    }
}
