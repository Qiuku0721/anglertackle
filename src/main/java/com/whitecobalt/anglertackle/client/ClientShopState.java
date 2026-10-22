package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.ShopSyncPayload;

import java.util.HashMap;
import java.util.Map;

/**
 * 客户端侧的商店状态缓存（服务端发来的那份）。
 *
 * <p>界面只读这里，不自己算 —— 等级、售罄倒计时都是**只有服务端知道**的事实。
 * 客户端自己猜的话会出现"界面显示能买、点了却说买不了"，那种错最难解释。
 */
public final class ClientShopState {

    private static int stage = 1;
    private static int level = 1;
    private static int xp = 0;
    private static boolean talked = false;
    /** 商品 id → 还要等几分钟补货。**不在这个表里 = 没售罄**。 */
    private static Map<String, Integer> soldOut = new HashMap<>();
    /** 有没有收到过服务端的答复。没收过就不该画界面（会先闪一帧全解锁）。 */
    private static boolean received = false;

    /**
     * 当前联赛届号（{@code 0} = 还没开过任何一届）与规模 id。
     *
     * <p>只为一件事：商店「联赛」页里的**纪念称号**是带参数的模板名（{@code S%s%s联赛纪念}），
     * 客户端不知道"第几届、哪个规模"就填不上参数，那一行会**把 %s 原样画出来**
     * （用户 2026-10-13 截图发现的那条 bug ✗）。
     */
    private static int leagueSeason = 0;
    private static String leagueTier = "";

    /**
     * 玩家勾了"本局游戏不再提示"。
     *
     * <p><b>只活在内存里，不写存档</b> —— 用户要的是"本局游戏不再出现"。
     * 存进存档的话，玩家一周后回来已经不记得自己关过什么了，
     * 而"卖材料鱼要确认"这件事的代价是**不可逆**的（鱼没了就是没了）。
     * 每次开游戏重新问一遍是更安全的默认。
     */
    private static boolean suppressSellWarning = false;

    public static boolean suppressSellWarning() {
        return suppressSellWarning;
    }

    public static void suppressSellWarningForever() {
        suppressSellWarning = true;
    }

    private ClientShopState() {
    }

    public static void accept(ShopSyncPayload p) {
        stage = p.stage();
        level = p.level();
        xp = p.xp();
        talked = p.talked();
        Map<String, Integer> m = new HashMap<>();
        if (!p.soldOut().isEmpty()) {
            for (String part : p.soldOut().split(";")) {
                int i = part.lastIndexOf(':');
                if (i <= 0) {
                    continue;
                }
                try {
                    m.put(part.substring(0, i), Integer.parseInt(part.substring(i + 1)));
                } catch (NumberFormatException ignored) {
                    // 一个坏掉的字段不该让整个商店打不开 —— 单独跳过
                }
            }
        }
        soldOut = m;
        // 联赛标记 `<届号>|<规模>`（空串 = 还没开过）；解不出来就当没有，绝不因此崩商店
        leagueSeason = 0;
        leagueTier = "";
        String tag = p.leagueTag() == null ? "" : p.leagueTag();
        int bar = tag.indexOf('|');
        if (bar > 0) {
            try {
                leagueSeason = Integer.parseInt(tag.substring(0, bar));
                leagueTier = tag.substring(bar + 1);
            } catch (NumberFormatException ignored) {
                leagueSeason = 0;
                leagueTier = "";
            }
        }
        received = true;
    }

    /** 当前联赛届号（0 = 还没开过任何一届）。 */
    public static int leagueSeason() {
        return leagueSeason;
    }

    /** 当前联赛规模 id（small / medium / large；空串 = 没有）。 */
    public static String leagueTier() {
        return leagueTier;
    }

    /** 退出世界时清掉，免得下个存档先闪上一个存档的等级。 */
    public static void reset() {
        stage = 1;
        level = 1;
        xp = 0;
        talked = false;
        soldOut = new HashMap<>();
        leagueSeason = 0;
        leagueTier = "";
        received = false;
        // ⚠ 刻意**不**重置 suppressSellWarning —— 它说的是"本局游戏"，
        //   而 reset() 是在退出世界时调的。玩家从 A 世界退到 B 世界
        //   仍然算同一局游戏，不该重新开始弹。
    }

    public static int stage() {
        return stage;
    }

    /** 垂纶等级（1–50）。 */
    public static int level() {
        return level;
    }

    /** 当前等级已有经验（卡在评定时是 0）。 */
    public static int xp() {
        return xp;
    }

    public static boolean talked() {
        return talked;
    }

    public static boolean received() {
        return received;
    }

    /** 这件商品要等几分钟补货；0 = 没售罄。 */
    public static int waitMinutes(String id) {
        return soldOut.getOrDefault(id, 0);
    }

    public static boolean unlocked(int unlockStage) {
        return stage >= unlockStage;
    }
}
