package com.whitecobalt.anglertackle.client;

/**
 * 客户端缓存的鱼币余额（只用于显示）。
 *
 * <p>权威值在服务端；这里是服务端下发的最后一份快照。
 * 客户端**不做任何本地加减**，所以 HUD 上看到的数字要么是最新的、
 * 要么是稍旧的，永远不会是一个"客户端自己算出来的假数"。
 */
public final class ClientCoins {

    private ClientCoins() {
    }

    /**
     * {@code -1} = 还没收到过同步。
     *
     * <p>用 -1 而不是 0 当初始值：0 是个**合法余额**，
     * 分不清"真的没钱"和"还没同步"的话，刚进游戏会先闪一个假的 0 出来。
     */
    private static volatile long coins = -1L;

    public static void accept(long value) {
        coins = Math.max(0L, value);
    }

    /** 是否已经收到过服务端同步。没收到时 HUD 什么都不画。 */
    public static boolean known() {
        return coins >= 0L;
    }

    public static long coins() {
        return Math.max(0L, coins);
    }

    /** 退出服务器时清掉，免得把上个服务器的余额带到下一个服。 */
    public static void reset() {
        coins = -1L;
    }
}
