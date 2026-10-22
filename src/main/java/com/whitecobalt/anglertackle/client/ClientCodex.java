package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.CodexPayload;

import java.util.List;

/**
 * 客户端缓存的图鉴快照（只用于显示）。
 *
 * <p>和 {@link com.whitecobalt.anglertackle.client.ClientCoins} 一样：
 * 权威值在服务端，这里只放最后一份快照。客户端**不做任何本地修改**，
 * 所以界面上的数字要么是最新的、要么是稍旧的，不会是自己算出来的假数。
 */
public final class ClientCodex {

    private ClientCodex() {
    }

    /** {@code null} = 还没收到过同步。没收到时界面画"读取中"，不要画空列表。 */
    private static volatile CodexPayload latest = null;

    public static void accept(CodexPayload p) {
        latest = p;
    }

    public static boolean known() {
        return latest != null;
    }

    public static CodexPayload latest() {
        return latest;
    }

    /** 已收集的鱼种数（次数 &gt; 0 的行数）。 */
    public static int collectedCount() {
        CodexPayload p = latest;
        if (p == null) {
            return 0;
        }
        int n = 0;
        for (String r : p.rows()) {
            // 行格式：id|次数|… —— 数第二段
            String[] f = r.split("\\|", -1);
            if (f.length > 1 && !"0".equals(f[1])) {
                n++;
            }
        }
        return n;
    }

    public static List<String> rows() {
        CodexPayload p = latest;
        return p == null ? List.of() : p.rows();
    }

    /** 退出世界时清掉，免得把上个存档的图鉴带到下一个。 */
    public static void reset() {
        latest = null;
    }
}
