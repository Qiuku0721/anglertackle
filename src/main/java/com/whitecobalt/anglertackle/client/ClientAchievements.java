package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.AchievementPayload;

/**
 * 客户端侧的**成就面板缓存**（与 {@link ClientQuests} / {@code ClientTitles} 同一形状）。
 *
 * <p>存在的理由一样：窗口尺寸一变界面就重建（{@code Screen.resize} → {@code init()}），
 * 重建时不该再等服务端一趟 —— 手里先有一份快照，界面立刻就能画出来 ✓。
 * **服务端仍会主动推**（每次敲 `/atl ach` 都会发一份新的）。
 *
 * <p>⚠ 只读缓存：成就的"点亮"永远由服务端在唯一结算点 `AchievementService.unlock` 决定，
 * 客户端连一个"点亮它"的方法都不该有（"客户端只能说我想要什么"那条纪律）。
 */
public final class ClientAchievements {

    private static AchievementPayload latest;
    private static boolean synced;

    private ClientAchievements() {
    }

    /** 服务端推来的新快照。 */
    public static void accept(AchievementPayload payload) {
        latest = payload;
        synced = true;
    }

    /** 收到过至少一份快照吗（没收到时界面显示"读取中"，而不是画一张空表）。 */
    public static boolean synced() {
        return synced;
    }

    /** 最近一份快照（可能为 null）。 */
    public static AchievementPayload latest() {
        return latest;
    }

    /** 退出世界时清掉 —— 否则下一个存档会先闪一眼上个存档的成就（称号/委托/图鉴同一条纪律）。 */
    public static void clear() {
        latest = null;
        synced = false;
    }
}
