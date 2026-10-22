package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.MailPayload;

/**
 * 客户端侧的**邮箱缓存**（`docs/36` §5）。
 *
 * <p>存在的理由与 {@code ClientCodex} 一样：界面可能因为窗口尺寸变化而重建
 * （`Screen.resize` → `init()`），重建时不该再等服务端一趟 —— 手里先有一份快照，
 * 界面立刻就能画出来 ✓。**服务端仍会主动推**（每次动作后都回一份新的）。
 *
 * <p>⚠ 它只是**只读缓存**：这里一个动作方法都没有。读/领/全部已读一律发
 * {@code MailActionPayload} 给服务端判定（"客户端只能说我想要什么"那条纪律）。
 */
public final class ClientMails {

    private static MailPayload latest;
    private static boolean synced;

    private ClientMails() {
    }

    /** 服务端推来的新快照。 */
    public static void accept(MailPayload payload) {
        latest = payload;
        synced = true;
    }

    /** 收到过至少一份快照吗（没收到时界面显示"读取中"，而不是画一个空列表）。 */
    public static boolean synced() {
        return synced;
    }

    /** 最近一份快照（可能为 null）。 */
    public static MailPayload latest() {
        return latest;
    }

    /** 退出世界时清掉 —— 否则下一个存档/服务器会先闪一眼上一个存档的邮件（图鉴同一条纪律）。 */
    public static void clear() {
        latest = null;
        synced = false;
    }
}
