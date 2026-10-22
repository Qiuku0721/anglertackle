package com.whitecobalt.anglertackle.title;

import com.whitecobalt.anglertackle.network.TitlePayload;
import com.whitecobalt.anglertackle.player.PlayerTitles;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayList;
import java.util.List;

/**
 * 把**称号全表 + 这个玩家的状态**拍成一行行平面文本（`TitlePayload` 的行格式只在这里定义）。
 *
 * <p>与 {@code MailSnapshot} 同一条纪律：服务端动作与"给客户端看的投影"分开 ——
 * 这个类**只读**（连 {@link Titles#equip} 都不调），看一眼就知道它改不了任何东西 ✓。
 *
 * <p>行格式（竖线分隔，顺序固定，与 {@code TitlePayload} 的注释逐字对应）：
 * <pre>
 *   id|owned|count|equipped|holders|holderNames
 * </pre>
 * {@code holderNames} 用 {@code \u0001} 分隔（竖线留给字段分隔）—— **只放前 3 个**，
 * 人数看 {@code holders} 那个字段（它是精确值，不是"前三个的个数"）。
 */
public final class TitleSnapshot {

    /** 详情里最多列几个名字（再多也画不下）。 */
    private static final int MAX_NAMES = 3;
    private static final String SEP_NAME = "\u0001";

    private TitleSnapshot() {
    }

    /** 拍一份（{@code lastError} 是上一次动作的结果码，空串 = 成功）。 */
    public static TitlePayload of(ServerPlayer player, String lastError) {
        PlayerTitles t = Titles.get(player);
        List<String> rows = new ArrayList<>(TitleDefs.ALL.size());
        int owned = 0;
        for (TitleDefs.Def def : TitleDefs.ALL) {
            boolean has = t.has(def.id());
            if (has) {
                owned++;
            }
            List<String> who = Titles.holders(player, def.id());
            rows.add(row(def.id(), has, t.countOf(def.id()), def.id().equals(t.equipped()),
                    who.size(), who));
        }
        // ⚠⚠ **生成式实例必须在这里补行**（`docs/39` §5.3⑥）：
        //   它们**不在 ALL 里**，而这张投影是**按 ALL 逐条拍**的 ⇒ 不补的话
        //   "称号发出去了、聊天里也报了，但界面/`/atl title` 里根本看不见" ✗
        //   —— 这是本设计最容易漏的一步，落地时的第一条断言就是守它。
        //   ⚠ 补的行**不计入 owned 计数**：那个计数是"40 条静态里拿到几条"的进度条，
        //     实例数量随赛季无限增长，混进去会让进度条永远走不完 ✗
        for (String id : t.owned()) {
            if (TitleDefs.byId(id) != null || !TitleDefs.validInstance(id)) {
                continue;                       // 静态的上面已拍过；认不出的实例不画
            }
            List<String> who = Titles.holders(player, id);
            rows.add(row(id, true, t.countOf(id), id.equals(t.equipped()), who.size(), who));
        }
        return new TitlePayload(rows, owned, TitleDefs.ALL.size(), lastError == null ? "" : lastError);
    }

    /**
     * **一行的 6 个字段**（与 {@code TitlePayload} 注释逐字对应）。
     *
     * <p>⚠ 格式**只在这里定义一份**：静态 40 条与生成式实例都走它 ——
     * 两处各拼一遍的话，`check-titles.js` 的"两侧字段数一致"会数错（它按整份文件里
     * {@code + '|' +} 的个数算），而字段数不一致的症状是**界面一片空白、不报错** ✗
     * （2026-10-13 加实例行时就撞了：数出来 11 个字段）。
     */
    private static String row(String id, boolean owned, int count, boolean equipped, int holders,
                              List<String> who) {
        List<String> shown = who.size() > MAX_NAMES ? who.subList(0, MAX_NAMES) : who;
        return id + '|' + (owned ? 1 : 0) + '|' + count + '|' + (equipped ? 1 : 0) + '|' + holders + '|'
                + String.join(SEP_NAME, shown);
    }
}
