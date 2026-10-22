package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.QuestPayload;

/**
 * 客户端侧的**委托面板缓存**（与 {@code ClientTitles} / {@code ClientMails} 同一形状）。
 *
 * <p>存在的理由一样：窗口尺寸一变界面就重建（{@code Screen.resize} → {@code init()}），
 * 重建时不该再等服务端一趟 —— 手里先有一份快照，界面立刻就能画出来 ✓。
 * **服务端仍会主动推**（右键老柯 / 点【接下委托】/ 指令，每次都会发一份新的）。
 *
 * <p>⚠ 只读缓存：这里一个"接取 / 领取"方法都没有。接取走邮件动作、领取走 `MailService`
 * （"客户端只能说我想要什么"那条纪律）。
 */
public final class ClientQuests {

    private static QuestPayload latest;
    private static boolean synced;

    private ClientQuests() {
    }

    /** 服务端推来的新快照。 */
    public static void accept(QuestPayload payload) {
        latest = payload;
        synced = true;
    }

    /** 收到过至少一份快照吗（没收到时界面显示"读取中"，而不是画一张空表）。 */
    public static boolean synced() {
        return synced;
    }

    /** 最近一份快照（可能为 null）。 */
    public static QuestPayload latest() {
        return latest;
    }

    /** 退出世界时清掉 —— 否则下一个存档会先闪一眼上个存档的委托（称号/图鉴同一条纪律）。 */
    public static void clear() {
        latest = null;
        synced = false;
    }
}
