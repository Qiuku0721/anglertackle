package com.whitecobalt.anglertackle.league;

import com.mojang.datafixers.util.Pair;
import com.mojang.serialization.Codec;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.Holder;
import net.minecraft.core.UUIDUtil;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 联赛的**存档层**（世界级 {@link SavedData}，`docs/37` §3.3）。
 *
 * <h2>为什么是 SavedData（跟着世界走），不是玩家附件</h2>
 * 联赛天然是**世界级**的：一期有一个全局硬截止、一张名次表、一份发奖流水。
 * 放进玩家附件就会变成"每人一份自己的期号" ⇒ 名次与结算没有一个统一时刻 ✗。
 * （排行榜 {@code LeaderboardData} 用同一个理由选了同一条路 ✓。不依赖在线这一条也是它给的：
 * 名次表在**世界**里，玩家离线不影响结算 ✓ —— Hypixel 那种"玩家一走名次就没了"的坑 ✗。）
 *
 * <h2>四个"钉死"的口径都在这里存着（`docs/37` §7）</h2>
 * 一期中途改配置**只影响下一期**：期号、级别、计分口径、硬截止、窗口时长都是**开期时写进来的**。
 * 现读配置的话，同一个人在不同时刻签收会用两套规则 ✗。
 *
 * <h2>回档（`docs/37` §3.2 坑 4）</h2>
 * 时钟只有一个方向：{@code lastSeenGame} 只增不减；读档时若发现当前累计刻**倒退**了，
 * 就把锚点与硬截止**向前钳制**到 {@code lastSeenGame}（"取 max(存档, 当前)"），
 * 免得回档之后同一期被反复触发。发奖另有流水键（{@link #ledger}）——
 * <b>先写键、再发钱</b>，重跑第二次插入失败 ⇒ 天然幂等 ✓。
 */
public class LeagueData extends SavedData {

    /** 数据文件名（存档里 `data/anglertackle_league.dat`）。**不许改名** —— 改名等于所有在跑的联赛消失。 */
    public static final String FILE_ID = "anglertackle_league";

    // ---------------------------------------------------------------- 一期
    /** 期号，0 = 从来没开过（第一 tick 就会开第一期）。 */
    public int seasonId;
    /**
     * **赛季号**（`docs/39` D1）：小中大各办一次 = 一个赛季，**季内三期共用同一个号**。
     *
     * <p>⚠ **独立计数，绝不靠 {@code seasonId} 反推**（`(seasonId-1)/3+1` 那种写法）：
     * 服主一打开 `allowConcurrent`（三级并开），期号与级别的对应关系就散了 ⇒ 反推出来的赛季号会漂 ✗。
     * 计数点只有一处：{@code LeagueService.push} 里"轮到小型那一期"时 +1 ✓。
     */
    public int seasonNo;

    // ---------------------------------------------------------------- 联赛商店限购（**每届刷新**）

    /**
     * 联赛商店的"**本届已买几个**"，键 = {@code S<届号>|<uuid>|<报价 id>}。
     *
     * <h2>为什么放在**世界侧**，而不是玩家附件</h2>
     * 玩家侧那套 `FishermanProgress.stock` 是"**按分钟补货**"的（普通商店用），
     * 混进"按届刷新"会让普通商品也跟着变 ✗。而"每届刷新"本来就是**届**的概念 ⇒ 放这里最贴（`docs/39` §4.2 方案 A）。
     *
     * <h2>届号一变就等价于整表刷新（不需要任何"重置"代码）</h2>
     * 键里带届号 ⇒ 新一届查同一个 (uuid, 报价) 时**永远查不到旧届的计数**（默认 0）✓
     * ⇒ **绝不写"结算时清空商店限购"那种代码**（那才容易漏、也容易误伤别的数据 ✗）。
     */
    public final Map<String, Integer> leagueBought = new HashMap<>();

    /** 本届已买数（不是本届的 ⇒ 0）。 */
    public int leagueBoughtOf(int seasonNoNow, UUID player, String offerId) {
        return this.leagueBought.getOrDefault(leagueStockKey(seasonNoNow, player, offerId), 0);
    }

    /** 记一次购买（顺手把往届残留清掉，免得存档无限长）。 */
    public void leagueAddBought(int seasonNoNow, UUID player, String offerId) {
        String k = leagueStockKey(seasonNoNow, player, offerId);
        this.leagueBought.put(k, this.leagueBought.getOrDefault(k, 0) + 1);
        this.leagueBought.keySet().removeIf((x) -> !x.startsWith("S" + seasonNoNow + "|"));
    }

    private static String leagueStockKey(int seasonNoNow, UUID player, String offerId) {
        return "S" + seasonNoNow + "|" + player + "|" + offerId;
    }
    /** 本期级别（{@link League.Tier#id()}）—— **开期时钉死**。 */
    public String tierId = "";
    /** 本期计分口径（{@code League.Rule} 的配置下标）—— **开期时钉死**。 */
    public int ruleMode;
    /** 本期硬截止（游戏日数）—— **开期时钉死**。 */
    public int periodGameDays;
    /** 本期每人窗口时长（游戏刻）—— **开期时钉死**。 */
    public long windowTicks;
    /** 本期推送时刻与硬截止时刻（累计刻）。 */
    public long openedAtGame;
    public long hardDeadlineGame;
    /** 本期结算过没有（幂等第一道；第二道是 {@link #ledger} 的流水键）。 */
    public boolean settled;

    // ---------------------------------------------------------------- 锚点
    /** 推送锚点（**游戏口径**：累计刻）。 */
    public long pushAnchorGame;
    /** 推送锚点（**现实口径**：UTC 毫秒）。 */
    public long pushAnchorWall;
    /** 见过的最大累计刻（只增不减）—— 回档钳制用。 */
    public long lastSeenGame;
    /** 三级轮转的下一个级别下标（默认不并开，见 `docs/37` §2.1）。 */
    public int nextTierIndex;

    // ---------------------------------------------------------------- 本期参赛者
    /** 本期签收过的人（**世界数据** ⇒ 结算不依赖在线 ✓）。 */
    public final Map<UUID, Member> members = new HashMap<>();
    /** 本期已发过邀请的人（避免重复投递；也用来给"没参赛的人"发公示）。 */
    public final Set<UUID> invited = new LinkedHashSet<>();
    /** 发奖流水键（`season|uuid|tier`）—— **先写键、再发钱**（`docs/37` §5.2）。 */
    public final Set<String> ledger = new HashSet<>();
    /** 离线玩家待投递的东西（邀请 / 成绩单 / 奖励 / 经验 / 称号）—— 登录时兑付。 */
    public final List<Pending> pending = new ArrayList<>();

    // ---------------------------------------------------------------- 上一期公示
    public int lastSeasonId;
    public String lastTierId = "";
    public int lastJoined;
    public int lastRanked;
    /** 名次表文本行 `rank|name|value|catches`（只留最近一期，给 `/atl league` 看）。 */
    public final List<String> lastBoard = new ArrayList<>();

    /**
     * **历届档案**（`docs/39` §6.1，2026-10-13）：每一届结算时把名次表存一份，**全部保留**。
     *
     * <h2>为什么必须有</h2>
     * {@link #lastBoard} 只留**最近一期**（那是给 {@code /atl league} 看的），
     * 而排行榜要能翻"某一赛季（S1…）/ 某一规模"⇒ 老的几届必须活着。
     * 量极小（一届几十行），**全留比"留 N 届再删"简单**，也不会出现"想查的那届正好被删了"。
     *
     * <p>写入是**幂等**的（同届号已有就跳过）—— 结算流程万一重跑，档案里不会出现两条。
     */
    public final List<Season> archive = new ArrayList<>();

    /** 一届的档案：届号 + 规模 + 名次表。 */
    public static final class Season {
        public int seasonNo;
        public String tierId = "";
        public final List<Rank> rows = new ArrayList<>();

        public Season(int seasonNo, String tierId) {
            this.seasonNo = seasonNo;
            this.tierId = tierId == null ? "" : tierId;
        }
    }

    /** 名次表里的一行（字段与结算那一刻的口径一致 —— 不另立一套）。 */
    public static final class Rank {
        public UUID player;
        public String name = "";
        /** 主指标数值（当前赛制下 = 最重一尾 kg）。 */
        public double value;
        /** 窗口内上鱼尾数（"参与度"，与名次表同一个来源）。 */
        public int catches;
    }

    /**
     * 把刚结算的这一届存进档案（**幂等**：同届号已存在就跳过）。
     *
     * <p>只存**上榜的人**（与名次表同一个来源）—— 没上鱼的人不进档案，
     * 否则几十年后档案里全是零分行。
     */
    public void archiveSeason(int seasonNo, String tierId, List<League.Entry> ranked) {
        for (Season s : this.archive) {
            if (s.seasonNo == seasonNo) {
                return;
            }
        }
        Season s = new Season(seasonNo, tierId);
        for (League.Entry e : ranked) {
            Rank r = new Rank();
            r.player = e.player();
            r.name = e.name();
            r.value = e.value();
            r.catches = e.catches();
            s.rows.add(r);
        }
        this.archive.add(s);
        this.setDirty();
    }

    /** 一位参赛者。 */
    public static final class Member {
        public String name = "";
        /** 签收刻（累计刻）。 */
        public long signTick;
        /** 他的窗口终点 = min(签收刻 + 窗口, 硬截止)。 */
        public long windowEnd;
        /** 主指标（口径见本期 {@link #ruleId}）。 */
        public double value;
        /** 这个成绩是何时达成的（并列第二级键）。 */
        public long atTick;
        /** 窗口内上鱼尾数（有效成绩下限用它）。 */
        public int catches;

        public Member(String name, long signTick, long windowEnd) {
            this.name = name;
            this.signTick = signTick;
            this.windowEnd = windowEnd;
            this.atTick = signTick;
        }
    }

    /**
     * 一条**待投递**记录 —— 只对"结算时不在线"的玩家产生。
     *
     * <p>为什么必须有它：邮件与经验都长在**玩家**身上（{@code PlayerData} 是玩家附件），
     * 离线时根本拿不到那个对象。所以结算把"要给谁什么"写进世界数据，等他登录再兑付 ✓
     * —— 这一条同时也保证了"结算不依赖在线"（`docs/37` §8 的断言之一）。
     *
     * <p>{@code template} 为空 ⇒ 不是邮件，只兑付经验/称号。
     */
    public static final class Pending {
        public UUID player;
        public String template = "";
        public List<String> args = new ArrayList<>();
        public long coins;
        public List<ItemStack> items = new ArrayList<>();
        public String action = "";
        /** 垂纶经验（邮件带不了经验 ⇒ 登录时直接入账）。 */
        public int xp;
        /**
         * **联赛积分**（`docs/39` P2：名次分）。
         *
         * <p>为什么走这条队列而不是塞进邮件附件：与 {@link #xp} 完全同一个理由 ——
         * 邮件只能带"鱼币 + 物品"，积分是**第四种载体** ⇒ 离线玩家先记在这里、**登录时补**
         * （`docs/37` §5.2 定的口径："绝不因为玩家没上线就把奖励吞掉"）。
         * 老存档没有这个键 ⇒ {@code getInt} 读出 0 ✓（零迁移）。
         */
        public int points;
        /** 要授予的称号 id（空 = 不授予）。 */
        public String title = "";

        public Pending(UUID player) {
            this.player = player;
        }
    }

    public LeagueData() {
    }

    // ---------------------------------------------------------------- 便捷读写
    public League.Tier tier() {
        return League.Tier.byId(this.tierId);
    }

    public League.Rule rule() {
        return League.Rule.byMode(this.ruleMode);
    }

    public Member member(UUID id) {
        return this.members.get(id);
    }

    /** 记一个人签收（**唯一入口**：签收与结算都只该通过它改 {@link #members}）。 */
    public Member join(UUID id, String name, long signTick, long windowEnd) {
        Member m = new Member(name == null ? "" : name, signTick, windowEnd);
        this.members.put(id, m);
        this.setDirty();
        return m;
    }

    /**
     * 本期名次表（只读）：**只收"上过鱼"的人**（有效成绩下限，`docs/37` §4.3），
     * 按三级并列键排序（{@link League#ORDER}）。
     */
    public List<League.Entry> ranked(int minCatches) {
        List<League.Entry> out = new ArrayList<>();
        for (Map.Entry<UUID, Member> e : this.members.entrySet()) {
            Member m = e.getValue();
            if (m.catches >= Math.max(1, minCatches)) {
                out.add(new League.Entry(e.getKey(), m.name, m.value, m.atTick, m.catches));
            }
        }
        out.sort(League.ORDER);
        return out;
    }

    public void pushPending(Pending p) {
        this.pending.add(p);
        this.setDirty();
    }

    // ---------------------------------------------------------------- 存档 codec
    // 下面这些 record 是 codec 的"传输形状"：**NBT 键与旧 save()/load() 逐字一致**，
    // 只是把手工 getXOr/putX 换成同名的 optionalFieldOf（默认值照抄旧 getXOr 的第二个参数）。

    /** 联赛商店限购的一行（旧键：k/v）。 */
    private record Bought(String key, int value) {
        private static final Codec<Bought> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                Codec.STRING.optionalFieldOf("k", "").forGetter(Bought::key),
                Codec.INT.optionalFieldOf("v", 0).forGetter(Bought::value)
        ).apply(inst, Bought::new));
    }

    /** 名次表一行（旧键：player/name/value/catches）。 */
    private record RankRow(UUID player, String name, double value, int catches) {
        private static final Codec<RankRow> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("player").forGetter(RankRow::player),
                Codec.STRING.optionalFieldOf("name", "").forGetter(RankRow::name),
                Codec.DOUBLE.optionalFieldOf("value", 0.0).forGetter(RankRow::value),
                Codec.INT.optionalFieldOf("catches", 0).forGetter(RankRow::catches)
        ).apply(inst, RankRow::new));
    }

    /** 一届档案（旧键：season_no/tier/rows）。 */
    private record SeasonRow(int seasonNo, String tierId, List<RankRow> rows) {
        private static final Codec<SeasonRow> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                Codec.INT.optionalFieldOf("season_no", 0).forGetter(SeasonRow::seasonNo),
                Codec.STRING.optionalFieldOf("tier", "").forGetter(SeasonRow::tierId),
                RankRow.CODEC.listOf().optionalFieldOf("rows", List.of()).forGetter(SeasonRow::rows)
        ).apply(inst, SeasonRow::new));
    }

    /** 一位参赛者（旧键：uuid/name/sign/window_end/value/at/catches）。 */
    private record MemberRow(UUID player, String name, long signTick, long windowEnd, double value,
                             long atTick, int catches) {
        private static final Codec<MemberRow> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("uuid").forGetter(MemberRow::player),
                Codec.STRING.optionalFieldOf("name", "").forGetter(MemberRow::name),
                Codec.LONG.optionalFieldOf("sign", 0L).forGetter(MemberRow::signTick),
                Codec.LONG.optionalFieldOf("window_end", 0L).forGetter(MemberRow::windowEnd),
                Codec.DOUBLE.optionalFieldOf("value", 0.0).forGetter(MemberRow::value),
                Codec.LONG.optionalFieldOf("at", 0L).forGetter(MemberRow::atTick),
                Codec.INT.optionalFieldOf("catches", 0).forGetter(MemberRow::catches)
        ).apply(inst, MemberRow::new));
    }

    /**
     * 奖励物品（旧键：id/n）。
     *
     * <p>⚠ 仍然只存 id + 数量（与旧 {@code itemToTag} 完全一致）：联赛奖励全是**没有 NBT 的普通物品**。
     * 换成 {@code ItemStack.CODEC} 会改存档格式（多出 count/components 键）⇒ 旧档读不出来，
     * 所以这个口径**一个字节都不动**。
     */
    private record ItemRow(String id, int count) {
        private static final Codec<ItemRow> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                Codec.STRING.optionalFieldOf("id", "").forGetter(ItemRow::id),
                Codec.INT.optionalFieldOf("n", 0).forGetter(ItemRow::count)
        ).apply(inst, ItemRow::new));
    }

    /** 一条待投递（旧键：uuid/template/args/coins/items/action/xp/points/title）。 */
    private record PendingRow(UUID player, String template, List<String> args, long coins,
                              List<ItemRow> items, String action, int xp, int points, String title) {
        private static final Codec<PendingRow> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("uuid").forGetter(PendingRow::player),
                Codec.STRING.optionalFieldOf("template", "").forGetter(PendingRow::template),
                Codec.STRING.listOf().optionalFieldOf("args", List.of()).forGetter(PendingRow::args),
                Codec.LONG.optionalFieldOf("coins", 0L).forGetter(PendingRow::coins),
                ItemRow.CODEC.listOf().optionalFieldOf("items", List.of()).forGetter(PendingRow::items),
                Codec.STRING.optionalFieldOf("action", "").forGetter(PendingRow::action),
                Codec.INT.optionalFieldOf("xp", 0).forGetter(PendingRow::xp),
                Codec.INT.optionalFieldOf("points", 0).forGetter(PendingRow::points),
                Codec.STRING.optionalFieldOf("title", "").forGetter(PendingRow::title)
        ).apply(inst, PendingRow::new));
    }

    /** 前 16 个标量（旧 save 的顶层键，一个不改）。 */
    private record Scalars(int seasonId, int seasonNo, String tierId, int ruleMode, int periodGameDays,
                           long windowTicks, long openedAtGame, long hardDeadlineGame, boolean settled,
                           long pushAnchorGame, long pushAnchorWall, long lastSeenGame, int nextTierIndex,
                           int lastSeasonId, String lastTierId, int lastJoined) {
        private static final MapCodec<Scalars> CODEC = RecordCodecBuilder.mapCodec(inst -> inst.group(
                Codec.INT.optionalFieldOf("season", 0).forGetter(Scalars::seasonId),
                Codec.INT.optionalFieldOf("season_no", 0).forGetter(Scalars::seasonNo),
                Codec.STRING.optionalFieldOf("tier", "").forGetter(Scalars::tierId),
                Codec.INT.optionalFieldOf("rule", 0).forGetter(Scalars::ruleMode),
                Codec.INT.optionalFieldOf("period_days", 0).forGetter(Scalars::periodGameDays),
                Codec.LONG.optionalFieldOf("window", 0L).forGetter(Scalars::windowTicks),
                Codec.LONG.optionalFieldOf("opened", 0L).forGetter(Scalars::openedAtGame),
                Codec.LONG.optionalFieldOf("deadline", 0L).forGetter(Scalars::hardDeadlineGame),
                Codec.BOOL.optionalFieldOf("settled", false).forGetter(Scalars::settled),
                Codec.LONG.optionalFieldOf("anchor_game", 0L).forGetter(Scalars::pushAnchorGame),
                Codec.LONG.optionalFieldOf("anchor_wall", 0L).forGetter(Scalars::pushAnchorWall),
                Codec.LONG.optionalFieldOf("last_seen", 0L).forGetter(Scalars::lastSeenGame),
                Codec.INT.optionalFieldOf("next_tier", 0).forGetter(Scalars::nextTierIndex),
                Codec.INT.optionalFieldOf("last_season", 0).forGetter(Scalars::lastSeasonId),
                Codec.STRING.optionalFieldOf("last_tier", "").forGetter(Scalars::lastTierId),
                Codec.INT.optionalFieldOf("last_joined", 0).forGetter(Scalars::lastJoined)
        ).apply(inst, Scalars::new));
    }

    /** 其余 8 个键（最后一个标量 + 7 张表）。RecordCodecBuilder 一组最多 16 个 ⇒ 拆成两半。 */
    private record Tails(int lastRanked, List<Bought> leagueBought, List<SeasonRow> archive,
                         List<MemberRow> members, List<UUID> invited, List<String> ledger,
                         List<PendingRow> pending, List<String> lastBoard) {
        private static final MapCodec<Tails> CODEC = RecordCodecBuilder.mapCodec(inst -> inst.group(
                Codec.INT.optionalFieldOf("last_ranked", 0).forGetter(Tails::lastRanked),
                Bought.CODEC.listOf().optionalFieldOf("league_bought", List.of()).forGetter(Tails::leagueBought),
                SeasonRow.CODEC.listOf().optionalFieldOf("archive", List.of()).forGetter(Tails::archive),
                MemberRow.CODEC.listOf().optionalFieldOf("members", List.of()).forGetter(Tails::members),
                UUIDUtil.CODEC.listOf().optionalFieldOf("invited", List.of()).forGetter(Tails::invited),
                Codec.STRING.listOf().optionalFieldOf("ledger", List.of()).forGetter(Tails::ledger),
                PendingRow.CODEC.listOf().optionalFieldOf("pending", List.of()).forGetter(Tails::pending),
                Codec.STRING.listOf().optionalFieldOf("last_board", List.of()).forGetter(Tails::lastBoard)
        ).apply(inst, Tails::new));
    }

    /**
     * 整份存档的 codec：**所有键都保持旧 save 的顶层布局**。
     *
     * <p>为什么用 {@code Codec.mapPair}：{@link RecordCodecBuilder} 的 group 最多 16 个字段，
     * 本类有 24 个顶层键；{@code mapPair} 把两个 map codec **拍平合并**（不是嵌套 compound），
     * 所以 NBT 仍是一层、键名逐字不变。
     */
    public static final Codec<LeagueData> CODEC = Codec.mapPair(Scalars.CODEC, Tails.CODEC)
            .xmap(parts -> fromParts(parts.getFirst(), parts.getSecond()),
                    data -> Pair.of(data.scalars(), data.tails()))
            .codec();

    /** 26.1.2 的 SavedDataType；文件名仍叫 {@code anglertackle_league.dat}。 */
    public static final SavedDataType<LeagueData> TYPE = new SavedDataType<>(
            Identifier.withDefaultNamespace(FILE_ID), LeagueData::new, CODEC);

    /** codec 读档入口 —— 与旧 {@code load} 同口径（坏行跳过的地方仍按旧顺序构建）。 */
    private static LeagueData fromParts(Scalars s, Tails t) {
        LeagueData d = new LeagueData();
        d.seasonId = s.seasonId();
        d.seasonNo = s.seasonNo();
        d.tierId = s.tierId();
        d.ruleMode = s.ruleMode();
        d.periodGameDays = s.periodGameDays();
        d.windowTicks = s.windowTicks();
        d.openedAtGame = s.openedAtGame();
        d.hardDeadlineGame = s.hardDeadlineGame();
        d.settled = s.settled();
        d.pushAnchorGame = s.pushAnchorGame();
        d.pushAnchorWall = s.pushAnchorWall();
        d.lastSeenGame = s.lastSeenGame();
        d.nextTierIndex = s.nextTierIndex();
        d.lastSeasonId = s.lastSeasonId();
        d.lastTierId = s.lastTierId();
        d.lastJoined = s.lastJoined();
        d.lastRanked = t.lastRanked();
        for (Bought b : t.leagueBought()) {
            d.leagueBought.put(b.key(), b.value());
        }
        // 历届档案（`docs/39` §6.1）—— 老存档没有这一段，读不到就是空的 ✓
        for (SeasonRow sr : t.archive()) {
            Season season = new Season(sr.seasonNo(), sr.tierId());
            for (RankRow rr : sr.rows()) {
                Rank rank = new Rank();
                rank.player = rr.player();
                rank.name = rr.name();
                rank.value = rr.value();
                rank.catches = rr.catches();
                season.rows.add(rank);
            }
            if (season.seasonNo > 0) {
                d.archive.add(season);
            }
        }
        for (MemberRow m : t.members()) {
            Member member = new Member(m.name(), m.signTick(), m.windowEnd());
            member.value = m.value();
            member.atTick = m.atTick();
            member.catches = m.catches();
            d.members.put(m.player(), member);
        }
        d.invited.addAll(t.invited());
        d.ledger.addAll(t.ledger());
        for (PendingRow p : t.pending()) {
            Pending pend = new Pending(p.player());
            pend.template = p.template();
            pend.args.addAll(p.args());
            pend.coins = p.coins();
            for (ItemRow row : p.items()) {
                ItemStack stack = itemFrom(row);
                if (!stack.isEmpty()) {
                    pend.items.add(stack);
                }
            }
            pend.action = p.action();
            pend.xp = p.xp();
            pend.points = p.points();
            pend.title = p.title();
            d.pending.add(pend);
        }
        d.lastBoard.addAll(t.lastBoard());
        return d;
    }

    private Scalars scalars() {
        return new Scalars(this.seasonId, this.seasonNo, this.tierId, this.ruleMode, this.periodGameDays,
                this.windowTicks, this.openedAtGame, this.hardDeadlineGame, this.settled,
                this.pushAnchorGame, this.pushAnchorWall, this.lastSeenGame, this.nextTierIndex,
                this.lastSeasonId, this.lastTierId, this.lastJoined);
    }

    private Tails tails() {
        List<Bought> bought = new ArrayList<>(this.leagueBought.size());
        for (Map.Entry<String, Integer> e : this.leagueBought.entrySet()) {
            bought.add(new Bought(e.getKey(), e.getValue()));
        }
        List<SeasonRow> arch = new ArrayList<>(this.archive.size());
        for (Season season : this.archive) {
            List<RankRow> rows = new ArrayList<>(season.rows.size());
            for (Rank rank : season.rows) {
                rows.add(new RankRow(rank.player, rank.name, rank.value, rank.catches));
            }
            arch.add(new SeasonRow(season.seasonNo, season.tierId, rows));
        }
        List<MemberRow> mem = new ArrayList<>(this.members.size());
        for (Map.Entry<UUID, Member> e : this.members.entrySet()) {
            Member m = e.getValue();
            mem.add(new MemberRow(e.getKey(), m.name, m.signTick, m.windowEnd, m.value, m.atTick, m.catches));
        }
        List<PendingRow> pend = new ArrayList<>(this.pending.size());
        for (Pending p : this.pending) {
            pend.add(new PendingRow(p.player, p.template, List.copyOf(p.args), p.coins,
                    itemsToRows(p.items), p.action, p.xp, p.points, p.title));
        }
        return new Tails(this.lastRanked, bought, arch, mem, new ArrayList<>(this.invited),
                new ArrayList<>(this.ledger), pend, List.copyOf(this.lastBoard));
    }

    private static List<ItemRow> itemsToRows(List<ItemStack> items) {
        List<ItemRow> out = new ArrayList<>();
        for (ItemStack s : items) {
            if (s != null && !s.isEmpty()) {
                out.add(new ItemRow(BuiltInRegistries.ITEM.getKey(s.getItem()).toString(), s.getCount()));
            }
        }
        return out;
    }

    private static ItemStack itemFrom(ItemRow row) {
        Identifier id = Identifier.tryParse(row.id());
        if (id == null) {
            return ItemStack.EMPTY;
        }
        Item item = BuiltInRegistries.ITEM.get(id).map(Holder.Reference::value).orElse(null);
        return item == null ? ItemStack.EMPTY : new ItemStack(item, Math.max(1, row.count()));
    }

    /** 取（或建）这份存档。传 {@code ServerLevel} 是有意的：联赛跟着**那个世界**走 ✓。 */
    public static LeagueData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(TYPE);
    }

    /** 备用入口：只有 {@code MinecraftServer} 时取主世界那份（指令 / 每 tick 检查用）。 */
    public static LeagueData get(MinecraftServer server) {
        return get(server.overworld());
    }
}
