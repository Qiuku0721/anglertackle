package com.whitecobalt.anglertackle.leaderboard;

import java.util.ArrayList;
import java.util.List;

import com.whitecobalt.anglertackle.league.League;
import com.whitecobalt.anglertackle.league.LeagueData;
import com.whitecobalt.anglertackle.network.RankPayload;
import net.minecraft.server.level.ServerPlayer;

/**
 * 把 {@link LeaderboardData} 里的成绩拼成**给客户端渲染的字段**（2026-10-10 M1 ✓）。
 *
 * <h2>分工（用户 2026-10-10 逐条点名："颜色 / 体长 / 中文名 / 品质" ✓）</h2>
 * <ul>
 *   <li><b>服务端</b>只给**事实字段** ✓：名次、玩家、数值文本、体长文本、鱼种 id、评级、品质档 ✓</li>
 *   <li><b>客户端</b>负责好看 ✓：按品质上色 ✓（走 {@code Quality} ✓ 与 tooltip/图鉴同一套色号 ✓）、
 *       把鱼种 id 换成**本地化中文名** ✓（客户端有物品注册表 ✓；服务端**没有语言表** ✗ —— 这也是
 *       之前只能显示 {@code greenland_shark} 的原因 ✓）</li>
 * </ul>
 *
 * <p>行内字段用 {@code \u0003} 分隔 ✓（正文里不可能出现 ✓）；榜单块之间用 {@code \u0001}、
 * 行之间用 {@code \u0002} ✓（见 {@link RankPayload} 的注释 ✓）。
 */
public final class RankSnapshot {

    public static final int LIMIT = 10;

    private RankSnapshot() {
    }

    /** 拼**一个**榜 ✓（行 = 字段化字符串 ✓ + 页脚 ✓）。 */
    public static RankPayload.Board board(Leaderboard.Board board, LeaderboardData data, ServerPlayer me) {
        // 图鉴完成度榜**不走上鱼事件** ✓ —— 直接读玩家图鉴的点亮数 ✓（见下面的独立分支 ✓）
        if (board == Leaderboard.Board.CODEX) {
            return codexBoard(me);
        }
        List<String> lines = new ArrayList<>();
        int rank = 1;
        int myRank = -1;
        for (LeaderboardData.Record r : data.top(board, LIMIT)) {
            // 字段：0 名次 / 1 玩家 / 2 数值 / 3 体长 / 4 鱼种 id / 5 评级 / 6 品质档 ✓
            lines.add("#" + rank
                    + "\u0003" + display(r.playerName)
                    + "\u0003" + valueText(board, r)
                    + "\u0003" + lengthText(board, r)
                    + "\u0003" + (r.fishId == null ? "" : r.fishId)
                    + "\u0003" + gradeCnName(r.grade)
                    + "\u0003" + r.tier);
            if (me != null && r.player.equals(me.getUUID())) {
                myRank = rank;
            }
            rank++;
        }
        String footer;
        if (board == Leaderboard.Board.CODEX) {
            footer = "图鉴完成度榜随后接上（它不走上鱼事件 ✓）";
        } else if (lines.isEmpty()) {
            footer = "还没有人上榜 —— 去钓一条吧 ✓";
        } else if (myRank > 0) {
            // ⚠ 用 count（**排除联赛键**）：联赛成绩有自己那三套板块，不该混进总榜的"共 N 条"
            footer = "共 " + data.count(board) + " 条记录 · 你目前第 " + myRank + " 名 ✓";
        } else {
            footer = "共 " + data.count(board) + " 条记录 · 你还没上榜 ✓";
        }
        return new RankPayload.Board(board.id(), board.cn(), List.copyOf(lines), footer);
    }

    /**
     * 图鉴完成度榜 ✓（2026-10-10 用户要求"别只是占位" ✓）。
     *
     * <p><b>为什么它不走 {@link LeaderboardData}</b> ✓：图鉴进度不是"上鱼那一刻"的产物 ✓
     * （它是**累积状态** ✓，而且存在玩家附件里 ✓）⇒ 直接读**在线玩家**的
     * {@code FishermanData.codexCount()} ✓（就是 {@code /atl codex} 那条指令用的同一个口径 ✓，
     * 绝不另算一份 ✗）。
     *
     * <p>⚠ **只统计在线玩家** ✓（离线玩家的附件不在内存里 ✓）；页脚写明这一点 ✓，
     * 免得玩家以为"榜上人怎么少了" ✗。
     */
    private static RankPayload.Board codexBoard(ServerPlayer me) {
        List<String> lines = new ArrayList<>();
        if (me == null) {
            return new RankPayload.Board(Leaderboard.Board.CODEX.id(), Leaderboard.Board.CODEX.cn(),
                    List.of(), "图鉴完成度榜需要一名在线玩家才能统计 ✓");
        }
        record Row(String name, int count) {
        }
        List<Row> rows = new ArrayList<>();
        int total = 0;
        try {
            total = com.whitecobalt.anglertackle.fishing.FishSpecies.ALL.size();
            for (ServerPlayer p : me.server.getPlayerList().getPlayers()) {
                // 口径与 /atl codex 完全一致 ✓（PlayerData.get(...).codexCount() ✓），不另算一份 ✗
                int n = com.whitecobalt.anglertackle.player.PlayerData.get(p).codexCount();
                rows.add(new Row(display(p.getName().getString()), n));
            }
        } catch (Throwable t) {
            return new RankPayload.Board(Leaderboard.Board.CODEX.id(), Leaderboard.Board.CODEX.cn(),
                    List.of(), "读图鉴进度时出错 ✓（不影响其它榜 ✓）");
        }
        rows.sort((a, b) -> Integer.compare(b.count(), a.count()));
        int rank = 1;
        int mine = -1;
        for (Row r : rows) {
            if (lines.size() >= LIMIT) {
                break;
            }
            // 字段：0 名次 / 1 玩家 / 2 数值 / 3（体长空）/ 4（鱼种空）/ 5（评级空）/ 6 档位（-1 = 不上色 ✓）
            lines.add("#" + rank + "\u0003" + r.name() + "\u0003" + r.count() + " 种"
                    + "\u0003\u0003\u0003\u0003-1");
            if (me != null && r.name().equals(display(me.getName().getString()))) {
                mine = rank;
            }
            rank++;
        }
        String footer;
        if (lines.isEmpty()) {
            footer = "还没有图鉴进度可统计 ✓";
        } else if (mine > 0) {
            footer = "共 " + rows.size() + " 位在线玩家 · 你第 " + mine + " 名 ✓  已点亮 " + lines.size() + " 人上榜";
        } else {
            footer = "共 " + rows.size() + " 位在线玩家 ✓（只统计在线玩家 ✓）";
        }
        return new RankPayload.Board(Leaderboard.Board.CODEX.id(), Leaderboard.Board.CODEX.cn(),
                List.copyOf(lines), footer);
    }

    /** **全部**榜打包成一个包 ✓（界面里切板块就是本地操作 ✓，零往返 ✓）。 */
    public static RankPayload buildAll(LeaderboardData data, ServerPlayer me) {
        List<RankPayload.Board> out = new ArrayList<>();
        // ★ 联赛板块**排在最前**（`docs/39` §6.1）：用户要"默认查看最近联赛的排行"，
        //   而客户端的默认选中项就是第一位（`Index = 0`）⇒ **不需要新增任何"上次看哪个"的状态**。
        //   ⚠ 没有档案时这里返回空 ⇒ 一个都不塞，界面与现在逐字一致 ✓
        out.addAll(leagueBoards(data, me));
        for (Leaderboard.Board b : Leaderboard.Board.values()) {
            out.add(board(b, data, me));
        }
        // ★ 比赛"本场"页（`docs/35` M2-3）：**复用同一套渲染** —— 只是往同一个包里多塞一块，
        //   客户端左侧目录自然会多出一条（它的目录就是从这块数据里读的 ✓，不需要改界面代码）。
        //   ⚠ 只在**真的有比赛在跑**时才塞：没有比赛时目录里凭空多一条空的"本场"
        //   会让人以为是坏了 ✗。
        RankPayload.Board contest = contestBoard(me);
        if (contest != null) {
            out.add(contest);
        }
        return new RankPayload(RankPayload.pack(out), "");
    }

    /** 联赛板块的 id（客户端目录/标题都用它；**排在最前 ⇒ 打开排行榜默认看它**）。 */
    public static final String LEAGUE_ID = "league";

    /**
     * 单独列出多少届。
     *
     * <p>为什么要有上限：左侧目录**放不下会静默截断**（`LeaderboardScreen` 的画法就是
     * "画到页脚就停"），届数一多，最下面那几届就点不到了 —— 与其看不见，不如把老的
     * 并进"按规模"那三个板块（它们本来就是跨届的）。**档案本身一届不删**，
     * 将来做"◀▶ 翻届"时不受这个上限约束。
     */
    private static final int LEAGUE_SEASONS_SHOWN = 8;

    /**
     * 联赛板块（`docs/39` §6.1，用户 2026-10-13 定案）：
     * <ul>
     *   <li>{@code league}「最近联赛」——**排最前 ⇒ 默认视图**；</li>
     *   <li>{@code league_s<n>}「S1大型联赛」…—— 最近 {@value #LEAGUE_SEASONS_SHOWN} 届；</li>
     *   <li>{@code league_t<规模>}「大型联赛 · 历届」—— 该规模历届**按人取最好的一尾**合并。</li>
     * </ul>
     *
     * <p>⚠ 数据源是**历届档案**（{@link LeagueData#archive}）—— 那些名次是**当时结算定下的事实**，
     * 所以这里**逐行照搬、不重排**（重排会让"当时第 2 名"变成"现在第 3 名"，那就不是历史了）。
     *
     * <p>⚠ **没有档案也要出板块**（用户 2026-10-13 定案："即使没开一届联赛也要有对应板块，
     * 即使还没有数据"）—— 与比赛"本场"那条"没有就不塞"的纪律**故意相反**：
     * 那一条防的是"点开是空的、看着像坏了"，而联赛这边用户要的是**能看见入口**。
     * 折中办法：空的时候不画空列表，而是**画一块带说明的空板块**（页脚写清为什么是空的）✓
     */
    private static List<RankPayload.Board> leagueBoards(LeaderboardData data, ServerPlayer me) {
        if (me == null || me.server == null) {
            return List.of();
        }
        List<LeagueData.Season> arch = null;
        try {
            arch = LeagueData.get(me.server).archive;
        } catch (Throwable t) {
            arch = null;        // 档案读不出来绝不影响其它榜（同 LeaderboardHooks 的纪律）
        }
        List<LeagueData.Season> byNew = new ArrayList<>(
                arch == null ? List.<LeagueData.Season>of() : arch);
        byNew.sort((a, b) -> Integer.compare(b.seasonNo, a.seasonNo));    // 新的在前

        List<RankPayload.Board> out = new ArrayList<>();
        out.add(latestLeagueBoard(me, byNew));
        for (int i = 1; i < Math.min(byNew.size(), LEAGUE_SEASONS_SHOWN); i++) {
            LeagueData.Season s = byNew.get(i);
            out.add(seasonBoard(s, "league_s" + s.seasonNo,
                    "S" + s.seasonNo + tierCn(s.tierId) + "联赛", me));
        }
        // 总联赛榜：**每个规模各一套**（用户 2026-10-13："全要，分目录"）
        //   = 上鱼维度 × 大/中/小 = 27 块，客户端按 id 前缀分 3 个目录。
        //   ⚠ 同样**无条件出**（哪怕一条成绩都还没有）—— 与上面那块同一条理由。
        out.addAll(tierBoards(data, me));
        return out;
    }

    /**
     * 「最近联赛」这一块：**正在进行的那一届优先**（带届号 + 实时名次），
     * 其次最近一届的档案，再退到"只留最近一期"的旧记录，最后才是**带说明的空板块**。
     *
     * <p>为什么要"进行中优先"（用户 2026-10-13 反馈："**不会显示是哪一届，比如 S1 这样的显示**"）：
     * 届号在**开期那一刻**就定了（{@code seasonNo}），只有名次要等结算 ——
     * 不显示届号，玩家打完整期也不知道"这是第几届" ✗。
     *
     * <p>⚠ 实时名次用的判据与结算**完全同一个**（{@code d.ranked(minCatches)} + {@code League.ORDER}，
     * 下限也取 {@code Tuning.leagueMinCatchesToRank()}）⇒ 面板上看到的顺序就是结算时会得到的顺序 ✓
     * 不是另算一套（`docs/39` §3 的"口径只有一份"）。
     */
    private static RankPayload.Board latestLeagueBoard(ServerPlayer me, List<LeagueData.Season> byNew) {
        com.whitecobalt.anglertackle.league.LeagueData d = null;
        try {
            d = com.whitecobalt.anglertackle.league.LeagueData.get(me.server);
        } catch (Throwable ignored) {
            d = null;       // 读不到就走最后的空板块，绝不影响别的榜
        }
        // ① 正在进行的那一届
        if (d != null && d.seasonId > 0 && !d.settled) {
            List<League.Entry> rows;
            try {
                rows = d.ranked(Math.max(1,
                        com.whitecobalt.anglertackle.fishing.Tuning.leagueMinCatchesToRank()));
            } catch (Throwable t) {
                rows = List.of();
            }
            List<String> lines = new ArrayList<>();
            int myRank = -1;
            for (int i = 0; i < rows.size() && i < LIMIT; i++) {
                League.Entry e = rows.get(i);
                lines.add("#" + (i + 1)
                        + "\u0003" + display(e.name())
                        + "\u0003" + String.format("%.2f kg", e.value())
                        + "\u0003" + (e.catches() > 0 ? "共 " + e.catches() + " 尾" : "")
                        + "\u0003\u0003\u0003-1");
                if (e.player().equals(me.getUUID())) {
                    myRank = i + 1;
                }
            }
            String title = "S" + d.seasonNo + tierCn(d.tierId) + "联赛（进行中）";
            String footer = lines.isEmpty()
                    ? title + " · 还没人上榜 —— 名次结算后才定（/atl league 看剩余时间）"
                    : title + " · 已签收 " + d.members.size() + " 人 · 上榜 " + lines.size() + " 人"
                      + (myRank > 0 ? " · 你第 " + myRank + " 名" : " · 你还没上榜");
            return new RankPayload.Board(LEAGUE_ID, title, List.copyOf(lines), footer);
        }
        // ② 最近一届已结算（有历届档案）
        if (!byNew.isEmpty()) {
            LeagueData.Season s = byNew.get(0);
            return seasonBoard(s, LEAGUE_ID,
                    "S" + s.seasonNo + tierCn(s.tierId) + "联赛（最近结算）", me);
        }
        // ③ 历届档案是 1.5.103 才有的 —— 那之前结算过的期只剩 lastBoard 这一份（只留最近一期）
        if (d != null && d.lastRanked > 0 && !d.lastBoard.isEmpty()) {
            List<String> lines = new ArrayList<>();
            for (int i = 0; i < d.lastBoard.size() && i < LIMIT; i++) {
                String[] p = d.lastBoard.get(i).split("\\|", -1);
                if (p.length >= 4) {
                    lines.add("#" + p[0] + "\u0003" + display(p[1]) + "\u0003" + p[2] + " kg"
                            + "\u0003共 " + p[3] + " 尾\u0003\u0003\u0003-1");
                }
            }
            String title = "第 " + d.lastSeasonId + " 期（最近结算）";
            return new RankPayload.Board(LEAGUE_ID, title, List.copyOf(lines),
                    title + " · " + d.lastRanked + " 人上榜 · 更早的期没留档"
                    + "（历届档案从 1.5.103 起才有）");
        }
        // ④ 一届都没开过 —— 板块**照样在**，只是把"为什么是空的"写清楚
        return new RankPayload.Board(LEAGUE_ID, "最近联赛", List.of(),
                "还没有开过联赛 —— 开期后在邮箱签收，名次会出现在这里（/atl league 看本期状态）");
    }

    /** 一届的板块：**照档案里的名次逐行搬**（不重排）。 */
    private static RankPayload.Board seasonBoard(LeagueData.Season s, String id, String title,
                                                 ServerPlayer me) {
        int myRank = -1;
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < s.rows.size() && i < LIMIT; i++) {
            LeagueData.Rank r = s.rows.get(i);
            lines.add("#" + (i + 1)
                    + "\u0003" + display(r.name)
                    + "\u0003" + String.format("%.2f kg", r.value)
                    + "\u0003" + (r.catches > 0 ? "共 " + r.catches + " 尾" : "")
                    + "\u0003\u0003\u0003-1");       // 鱼种/评级空、档位 -1 = 不上色
            if (me != null && r.player != null && r.player.equals(me.getUUID())) {
                myRank = i + 1;
            }
        }
        String head = "S" + s.seasonNo + tierCn(s.tierId) + "联赛";
        String footer = lines.isEmpty()
                ? head + " 没有人上榜"
                : head + " · " + lines.size() + " 人上榜 · 成绩以当时结算为准"
                  + (myRank > 0 ? " · 你第 " + myRank + " 名" : " · 你不在榜上");
        return new RankPayload.Board(id, title, List.copyOf(lines), footer);
    }

    /**
     * 总联赛榜：**每个规模各一套**（`docs/39` §6.1；用户 2026-10-13 定案"全要，分目录"）。
     *
     * <p>口径 = **只累计联赛期间**的上鱼（`LeaderboardHooks` 用 `LeagueService.activeTierFor`
     * 判那两道闸），维度与总榜**完全同一套**（数值仍走 `Leaderboard.valueOf` 那一份实现），
     * 所以数字跟总榜可比 ✓ —— 不存在"联赛榜自算一套"的口径漂移。
     *
     * <p>id 前缀就是客户端"分目录"的依据：{@code lts_/ltm_/ltl_} = 小 / 中 / 大型联赛。
     */
    private static List<RankPayload.Board> tierBoards(LeaderboardData data, ServerPlayer me) {
        List<RankPayload.Board> out = new ArrayList<>();
        for (League.Tier t : League.Tier.values()) {
            String prefix = switch (t) {
                case SMALL -> "lts_";
                case MEDIUM -> "ltm_";
                case LARGE -> "ltl_";
            };
            for (Leaderboard.Board b : Leaderboard.Board.values()) {
                if (b == Leaderboard.Board.CODEX) {
                    continue;   // 图鉴不是"上鱼那一刻"的产物 ⇒ 联赛期间没有对应口径（同上鱼那条）
                }
                out.add(tierBoard(data, b, t, prefix + b.id(), me));
            }
        }
        return out;
    }

    /**
     * 一块"某个规模 × 某个维度"的联赛榜。
     *
     * <p>⚠ 行格式与常规榜**逐字段相同**（名次/玩家/数值/体长/鱼种/评级/档位）⇒
     * 客户端那套"按品质上色 + 中文鱼名"**一行都不用改**就复用了（`docs/39` §6.1 的省法）。
     */
    private static RankPayload.Board tierBoard(LeaderboardData data, Leaderboard.Board board,
                                               League.Tier tier, String id, ServerPlayer me) {
        List<String> lines = new ArrayList<>();
        int rank = 1;
        int myRank = -1;
        for (LeaderboardData.Record r : data.top(board, LIMIT, tier.id())) {
            lines.add("#" + rank
                    + "\u0003" + display(r.playerName)
                    + "\u0003" + valueText(board, r)
                    + "\u0003" + lengthText(board, r)
                    + "\u0003" + (r.fishId == null ? "" : r.fishId)
                    + "\u0003" + gradeCnName(r.grade)
                    + "\u0003" + r.tier);
            if (me != null && r.player.equals(me.getUUID())) {
                myRank = rank;
            }
            rank++;
        }
        int total = data.countLeague(board, tier.id());
        String title = tierCn(tier.id()) + "联赛 · " + board.cn();
        String footer = lines.isEmpty()
                ? title + " 还没有数据 —— 只有联赛期间钓到的鱼才会进这里"
                : title + " · 共 " + total + " 条 · 只算联赛期间"
                  + (myRank > 0 ? " · 你第 " + myRank + " 名" : " · 你不在榜上");
        return new RankPayload.Board(id, title, List.copyOf(lines), footer);
    }

    /** 规模 id → 中文（与语言文件 `league.anglertackle.tier.*` 同一个词；服务端没有语言表，
     *  所以和 {@code Leaderboard.Board.cn()} 一样在这里写死 —— 那套也是这么做的）。 */
    private static String tierCn(String id) {
        return switch (id == null ? "" : id) {
            case "small" -> "小型";
            case "medium" -> "中型";
            case "large" -> "大型";
            default -> "";
        };
    }

    /** 比赛页的板块 id（客户端目录/标题都用它）。 */
    public static final String CONTEST_ID = "contest";

    /**
     * "本场"页：**正在进行的这一场**的成绩（`docs/35` §4 的界面形态）。
     *
     * <p>⚠ 没有进行中的比赛就返回 {@code null}（不塞空板块）。上一场的名次不放在这里 ——
     * 那是 `/atl contest last` 的事（界面里"本场"就该只有本场 ✓，免得看的人以为还在比）。
     */
    private static RankPayload.Board contestBoard(ServerPlayer me) {
        if (me == null || me.server == null) {
            return null;
        }
        List<com.whitecobalt.anglertackle.contest.Contest.Entry> entries =
                com.whitecobalt.anglertackle.contest.ContestService.boardEntries(me.server);
        if (entries.isEmpty() && com.whitecobalt.anglertackle.contest.ContestService
                .remainingTicks(me.server) < 0L) {
            return null;
        }
        List<String> lines = new ArrayList<>();
        int rank = 1;
        int mine = -1;
        for (com.whitecobalt.anglertackle.contest.Contest.Entry e : entries) {
            lines.add("#" + rank
                    + "\u0003" + display(e.name())
                    + "\u0003" + String.format("%.2f kg", e.value())
                    + "\u0003" + (e.lengthCm() > 0 ? String.format("%.1f cm", e.lengthCm()) : "")
                    + "\u0003" + (e.fishId() == null ? "" : e.fishId())
                    + "\u0003" + gradeCnName(e.grade())
                    + "\u0003" + e.tier());
            if (e.player().equals(me.getUUID())) {
                mine = rank;
            }
            rank++;
        }
        long left = com.whitecobalt.anglertackle.contest.ContestService.remainingTicks(me.server);
        String minutes = String.valueOf(Math.max(0L, left) / com.whitecobalt.anglertackle.contest
                .Contest.TICKS_PER_MINUTE);
        String footer;
        if (lines.isEmpty()) {
            footer = "本场还没有人上鱼 —— 去钓一条 · 剩余 " + minutes + " 分钟";
        } else if (mine > 0) {
            footer = "本场 " + lines.size() + " 人有成绩 · 你第 " + mine + " 名 · 剩余 " + minutes + " 分钟";
        } else {
            footer = "本场 " + lines.size() + " 人有成绩 · 你还没上鱼 · 剩余 " + minutes + " 分钟";
        }
        return new RankPayload.Board(CONTEST_ID, "本场比赛", List.copyOf(lines), footer);
    }

    /** 服务端直接把这名玩家的全榜发过去 ✓（{@code prefer} = 打开时先看哪个榜 ✓）。 */
    public static void sendAll(ServerPlayer player, String prefer) {
        RankPayload all = buildAll(LeaderboardData.get(player.serverLevel()), player);
        net.neoforged.neoforge.network.PacketDistributor.sendToPlayer(player,
                new RankPayload(all.blob(), prefer == null ? "" : prefer));
    }

    /** 维度 id → 枚举 ✓；认不出来退回主榜 ✓（不抛异常 ✗）。 */
    public static Leaderboard.Board boardOf(String id) {
        String want = id == null ? "" : id.trim();
        for (Leaderboard.Board b : Leaderboard.Board.values()) {
            if (b.id().equalsIgnoreCase(want)) {
                return b;
            }
        }
        return Leaderboard.Board.HEAVIEST;
    }

    /** 体长文本 ✓（只有最重类榜单显示 ✓；老记录没存体长就留空 ✓，界面不会显示空字段 ✓）。 */
    private static String lengthText(Leaderboard.Board board, LeaderboardData.Record r) {
        if (board != Leaderboard.Board.HEAVIEST && board != Leaderboard.Board.HEAVIEST_BY_SPECIES) {
            return "";
        }
        return r.lengthCm > 0 ? String.format("%.1f cm", r.lengthCm) : "";
    }

    /** 数值怎么显示 ✓（每个维度一套口径 ✓，由服务端一家说了算 ✓）。 */
    private static String valueText(Leaderboard.Board board, LeaderboardData.Record r) {
        return switch (board) {
            case HEAVIEST, HEAVIEST_BY_SPECIES, TOTAL_WEIGHT -> String.format("%.2f kg", r.value);
            case BEST_GRADE -> gradeCn((int) r.value);
            case LONGEST_FIGHT -> ((int) r.value) + " 回合";
            case FASTEST_CATCH -> String.format("%.1f 秒", r.value / 20.0);
            case HIGH_TIER_COUNT, TOTAL_COUNT, STREAK -> ((int) r.value) + " 尾";
            case CODEX -> ((int) r.value) + " 种";
        };
    }

    private static String display(String name) {
        return name == null || name.isEmpty() ? "（无名）" : name;
    }

    /** 品质档数值（序）→ 尺寸评级名 ✓（与 {@code FishData.SizeGrade} 的档位对应 ✓）。 */
    private static String gradeCn(int rank) {
        return switch (rank) {
            case 5 -> "纪录级";
            case 4 -> "极品";
            case 3 -> "优质";
            case 2 -> "普通";
            case 1 -> "幼体";
            default -> "—";
        };
    }

    /** 评级枚举名 → 中文 ✓（同时接受中文输入，幂等 ✓）。 */
    private static String gradeCnName(String enumName) {
        return switch (enumName) {
            case "RECORD", "纪录级" -> "纪录级";
            case "EXCELLENT", "极品" -> "极品";
            case "QUALITY", "优质" -> "优质";
            case "NORMAL", "普通" -> "普通";
            case "JUVENILE", "幼体" -> "幼体";
            default -> enumName == null ? "" : enumName;
        };
    }
}
