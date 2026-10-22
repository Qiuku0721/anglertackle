package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.block.IceHoleBlock;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;

/**
 * 冰钓的四条数值链（用户 2026-10-08 拍板，docs/33 §8）。
 *
 * <h2>为什么单独一个类</h2>
 * 这四条链各自要问的问题只有两个：「落点是不是**洞内**」「群系是不是**非高山且常年覆冰**」。
 * 把它们放在一起有两条好处：
 * <ol>
 *   <li>判据**只有一份**（{@link WaterBody#iceFishingBiome}），不会出现"咬钩时间认了、
 *       爆率没认"这种只错一半的状态；</li>
 *   <li>七个配置项在这里被**读**到（{@code check-config-wired.js} 会断言"每个配置项都被读过"，
 *       所以配置项和读它的代码必须同批落地 —— 只加配置不写读取代码，门禁直接红）。</li>
 * </ol>
 *
 * <h2>用户定的口径（照抄，别改）</h2>
 * <table>
 *   <tr><th>场景</th><th>咬钩等待</th><th>金红总爆率</th><th>鱼线磨损</th></tr>
 *   <tr><td>洞内抛竿</td><td><b>不变</b></td><td><b>+1%（加算）</b></td>
 *       <td><b>×2（只乘鱼线）</b></td></tr>
 *   <tr><td>覆冰群系 · 非洞</td><td><b>×1.5</b></td><td><b>−1%（加算）</b></td><td>不变</td></tr>
 *   <tr><td>其他群系</td><td>不变</td><td>不变</td><td>不变</td></tr>
 * </table>
 *
 * <p>⚠ **"加算"是量纲上的加算**：{@code targetHighValuePct} 是一个"百分比数值"
 * （红饵 10 就是这个 10），所以 +1% 就是 +0.01 的**绝对值**，不是乘 1.01。
 */
public final class IceFishing {

    private IceFishing() {
    }

    /**
     * 落点是不是**冰洞里的水**。
     *
     * <p>浮漂停在洞那一格的水面上（冰洞方块是 {@code noCollission}），所以正常就是
     * <b>冰洞方块那一格</b>；但不同实现/不同版本的落点报告可能指向**下面那一格水**，
     * 所以两格都认 —— 差一格就"不算洞里"这种 bug 极难查（表现只是"奖励没生效"）。
     */
    public static boolean inIceHole(ServerLevel level, BlockPos pos) {
        if (level == null || pos == null) {
            return false;
        }
        return level.getBlockState(pos).getBlock() instanceof IceHoleBlock
                || level.getBlockState(pos.below()).getBlock() instanceof IceHoleBlock
                || level.getBlockState(pos.above()).getBlock() instanceof IceHoleBlock;
    }

    /** 咬钩等待倍率：洞内不变（用户定案）；覆冰非高山群系的**非洞**抛竿 ×{@code openIceBiteTimeMultiplier}。 */
    public static double biteTimeMultiplier(ServerLevel level, BlockPos pos) {
        if (level == null || pos == null) {
            return 1.0;
        }
        if (inIceHole(level, pos)) {
            return 1.0;
        }
        return WaterBody.iceFishingBiome(level, pos) ? Tuning.openIceBiteTimeMultiplier() : 1.0;
    }

    /**
     * 金红总爆率的**加算**量（百分点数值）：洞内 +，覆冰非高山群系的非洞 −，其余 0。
     *
     * <p>⚠ <b>不在覆冰群系里就没有任何加成</b>（用户 2026-10-08 的原话：
     * "它的 buff 只在那种群系生效，不在就**只生效线损耗**"）——
     * 所以这里第一件事就是查群系：温带池塘里凿的洞**只有代价没有好处** ✓，
     * "把冰运到平原刷 +1% 爆率"这条路同时被堵死 ✓
     *
     * <p>调用方拿到的是"要加到 {@code targetHighValuePct} 上的绝对量"，
     * 由调用方自己夹在 0~100 之间（那一处本来就有夹取）。
     */
    public static double highValueDelta(ServerLevel level, BlockPos pos) {
        if (level == null || pos == null) {
            return 0.0;
        }
        if (!WaterBody.iceFishingBiome(level, pos)) {
            return 0.0;   // 不在覆冰名单里：洞内也只生效线损（用户定案）
        }
        return inIceHole(level, pos) ? Tuning.iceHoleHighValueBonus() : -Tuning.openIceHighValuePenalty();
    }

    /** 鱼线磨损倍率：只有洞内 ×{@code iceHoleLineWearMultiplier}（**只乘鱼线**，用户定案）。 */
    public static double lineWearMultiplier(ServerLevel level, BlockPos pos) {
        return inIceHole(level, pos) ? Tuning.iceHoleLineWearMultiplier() : 1.0;
    }

    /**
     * 冰洞下钩时**记作多远的抛投**（米）。
     *
     * <p>用户 2026-10-08："冰钓固定 6 米左右容易拉，**建议 12 米**" ——
     * 冰洞就在脚边，按真实距离算（≈0 米）会吃"抛得近 → 出鱼差"那条惩罚 ✗，
     * 玩家会觉得洞里只能拉小鱼。12 米是**中距离**（对照抛投设计：低头 8 / 平视 16 / 抬头 24），
     * 于是洞里既不吃近距离惩罚、也拿不到远投的额外好处 ✓
     */
    public static double iceHoleCastDistance() {
        return 12.0;
    }

    /** 凿冰面 / 砸冰洞各扣多少耐久（凿冰镐落地时读它）。 */
    public static int icePickCost() {
        return Tuning.icePickDurabilityCost();
    }

    /** 碎冰 → 浮冰的延时（tick）。{@code level.scheduleTick} 用它。 */
    public static int brokenIceToPackIceTicks() {
        return Math.max(0, Tuning.brokenIceToPackIceMinutes()) * 1200;
    }

    /** 浮冰 → 原版冰的延时（tick）。用户定案：浮冰**会**变回冰，于是还能再凿。 */
    public static int packIceToIceTicks() {
        return Math.max(0, Tuning.packIceToIceMinutes()) * 1200;
    }
}
