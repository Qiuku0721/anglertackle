package com.whitecobalt.anglertackle.client;

/**
 * 客户端缓存的**联赛积分**余额（只用于显示）。
 *
 * <p>权威值在服务端；这里是服务端下发的最后一份快照。
 * 客户端**不做任何本地加减**，所以 HUD／商店标题上看到的数字要么是最新的、
 * 要么是稍旧的，永远不会是一个"客户端自己算出来的假数"。
 *
 * <p>（与 {@link ClientCoins} 一模一样的约定：初始 -1 = 未知，退出世界时清。）
 */
public final class ClientLeaguePoints {

    private ClientLeaguePoints() {
    }

    /**
     * {@code -1} = 还没收到过同步。
     *
     * <p>用 -1 而不是 0 当初始值：0 是个**合法余额**（新号就是 0），
     * 分不清"真的没分"和"还没同步"的话，刚进游戏会先闪一个假的 0 出来。
     */
    private static volatile long points = -1L;

    public static void accept(long value) {
        points = Math.max(0L, value);
    }

    /** 是否已经收到过服务端同步。没收到时相关界面什么都不画。 */
    public static boolean known() {
        return points >= 0L;
    }

    public static long points() {
        return Math.max(0L, points);
    }

    /** 退出服务器时清掉，免得把上个服务器/上个存档的积分带到下一个。 */
    public static void reset() {
        points = -1L;
    }
}
