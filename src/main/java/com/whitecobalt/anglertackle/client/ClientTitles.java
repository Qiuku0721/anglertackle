package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.TitlePayload;

/**
 * 客户端侧的**称号全表缓存**（与 {@code ClientMails} / {@code ClientCodex} 同一形状）。
 *
 * <p>存在的理由一样：窗口尺寸一变界面就重建（{@code Screen.resize} → {@code init()}），
 * 重建时不该再等服务端一趟 —— 手里先有一份快照，界面立刻就能画出来 ✓。
 * **服务端仍会主动推**（每次动作后都回一份新的）。
 *
 * <p>⚠ 只读缓存：这里一个"佩戴"方法都没有。佩戴一律发 {@code TitleActionPayload}
 * 让服务端判定（"客户端只能说我想要什么"那条纪律）。
 */
public final class ClientTitles {

    private static TitlePayload latest;
    private static boolean synced;

    private ClientTitles() {
    }

    /** 服务端推来的新快照。 */
    public static void accept(TitlePayload payload) {
        latest = payload;
        synced = true;
    }

    /** 收到过至少一份快照吗（没收到时界面显示"读取中"，而不是画一张空表）。 */
    public static boolean synced() {
        return synced;
    }

    /** 最近一份快照（可能为 null）。 */
    public static TitlePayload latest() {
        return latest;
    }

    /** 退出世界时清掉 —— 否则下一个存档会先闪一眼上个存档的称号（图鉴同一条纪律）。 */
    public static void clear() {
        latest = null;
        synced = false;
    }
}
