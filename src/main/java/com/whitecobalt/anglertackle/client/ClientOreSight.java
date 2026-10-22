package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.OreSightPayload;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;

import javax.annotation.Nullable;

/**
 * 客户端侧的【明目】状态：服务端说"指哪一块矿"，这里存下来给渲染器用。
 *
 * <h2>为什么要心跳超时</h2>
 * 服务端只在**目标变化**和每 20 tick 的心跳时发包。如果玩家关掉效果的那一刻正好丢包
 * （或者服务器卡了一下），客户端就会留着一条指向空气的线。所以这里记一个"最后一次收到包的
 * 时间戳"，超过 {@link #TIMEOUT_TICKS} 就自己丢掉 —— 兜底放在读的一侧，
 * 比指望每一个"该撤线"的分支都不漏要可靠。
 *
 * <p>换维度/换世界也要清：{@code ClientLevel} 换了之后旧坐标毫无意义，而且新世界的
 * {@code gameTime} 可能比时间戳小（"负年龄"会让超时判断永远不成立）。
 */
public final class ClientOreSight {

    /** 收不到更新的容忍时间（tick）：心跳是 20 tick 一次，给三个心跳的余量。 */
    public static final int TIMEOUT_TICKS = 60;

    @Nullable
    private static BlockPos target;
    private static ClientLevel level;
    private static long stamp;

    private ClientOreSight() {
    }

    /** 收到 S→C 的包（已经在客户端主线程上）。 */
    public static void accept(OreSightPayload payload) {
        Minecraft mc = Minecraft.getInstance();
        level = mc.level;
        stamp = mc.level == null ? 0L : mc.level.getGameTime();
        target = payload.active() ? payload.pos() : null;
    }

    /**
     * 现在该指哪一块矿（没有就返回 {@code null}）。
     *
     * <p>渲染器**每帧**调它，所以这里必须廉价：三次字段比较，没有分配。
     */
    @Nullable
    public static BlockPos target() {
        if (target == null) {
            return null;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.level != level) {
            target = null;      // 换了世界：旧坐标作废
            return null;
        }
        if (mc.level.getGameTime() - stamp > TIMEOUT_TICKS || mc.level.getGameTime() < stamp) {
            target = null;      // 超时（或时间倒流 = 换过档）
            return null;
        }
        return target;
    }

    /** 断开连接时清一下（进服务器/退服务器都不该留着上一条线）。 */
    public static void clear() {
        target = null;
        level = null;
        stamp = 0L;
    }
}
