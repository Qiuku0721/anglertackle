package com.whitecobalt.anglertackle.contest;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.UUIDUtil;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 比赛的**存档层**（世界级 {@link SavedData}，`docs/35` §3）。
 *
 * <h2>为什么是世界级 SavedData</h2>
 * 一场比赛是**全服**的一件事（一个开始时刻、一个结束时刻、一张成绩表）⇒ 跟着存档走 ✓：
 * 服务器重启后**比赛继续跑剩余时间**（存的是**绝对的结束时刻**，不是"剩余秒数"——
 * 后者重启一次就不准了，`docs/35` §9 的断言之一）。
 *
 * <h2>离线奖励（与联赛同一套做法）</h2>
 * 结算那一刻不在线的获奖者，钱记进 {@link #pendingCoins}，**登录时兑付** ——
 * 绝不因为"他下线了"把奖励吞掉 ✓（鱼币与称号都长在**玩家**身上，离线时拿不到那个对象）。
 */
public class ContestData extends SavedData {

    /** 数据文件名（26.1.2 起落在 `data/<namespace>/anglertackle_contest.dat`）。**不许改名**。 */
    public static final String FILE_ID = "anglertackle_contest";

    // ---------------------------------------------------------------- 正在进行的这一场
    /** 有没有正在进行的比赛。 */
    public boolean running;
    /** 赛制下标（{@link Contest.Rule}）—— **开赛时钉死**，中途改配置不影响这一场 ✓。 */
    public int ruleMode;
    /** 开赛时刻与**绝对**结束时刻（都是**累计刻**：服务器停机期间不走表，与联赛同一口径）。 */
    public long startGame;
    public long endGame;
    /** 这一场定下的时长（分钟）—— 只用于显示与存档可读性。 */
    public int minutes;
    /** 结算过没有（幂等：重复结算不会重复发钱）。 */
    public boolean settled;
    /** 本场成绩表（UUID → 当前最好的一条）。**只用内存不落盘的话重启就丢** ⇒ 一起存 ✓。 */
    public final Map<UUID, Contest.Entry> scores = new LinkedHashMap<>();

    // ---------------------------------------------------------------- 上一场（/atl contest last）
    public int lastRuleMode;
    public long lastStart;
    public long lastEnd;
    public int lastPlayers;
    /** 名次文本行 `rank|name|value|fishId|kg|catches`（只留最近一场）。 */
    public final List<String> lastBoard = new ArrayList<>();

    // ---------------------------------------------------------------- 离线待领
    /** 结算时不在线的获奖者：鱼币。 */
    public final Map<UUID, Long> pendingCoins = new HashMap<>();
    /** 结算时不在线的冠军：称号 id（可重复 ⇒ 显示 ×N）。 */
    public final Map<UUID, String> pendingTitles = new HashMap<>();
    /** 最后一次自动开赛的时刻（累计刻）—— `autoEveryMinutes` 用它算间隔。 */
    public long lastAutoStartGame;

    // ---------------------------------------------------------------- 存档 codec
    // 下列 record 是 codec 的"传输形状"：**NBT 键与旧 save()/load() 逐字一致**，
    // 只是把"手工 getXOr / putX"换成同名的 optionalFieldOf。默认值全部照抄旧 getXOr 的第二个参数。

    /** 一条成绩（旧 {@code entryTag}/{@code entryFrom} 的键：uuid/name/value/at/catches/fish/kg/len/grade/tier）。 */
    private record Score(UUID player, String name, double value, long at, int catches, String fish,
                         double kg, double len, String grade, int tier) {
        private static final Codec<Score> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("uuid").forGetter(Score::player),
                Codec.STRING.optionalFieldOf("name", "").forGetter(Score::name),
                Codec.DOUBLE.optionalFieldOf("value", 0.0).forGetter(Score::value),
                Codec.LONG.optionalFieldOf("at", 0L).forGetter(Score::at),
                Codec.INT.optionalFieldOf("catches", 0).forGetter(Score::catches),
                Codec.STRING.optionalFieldOf("fish", "").forGetter(Score::fish),
                Codec.DOUBLE.optionalFieldOf("kg", 0.0).forGetter(Score::kg),
                Codec.DOUBLE.optionalFieldOf("len", 0.0).forGetter(Score::len),
                Codec.STRING.optionalFieldOf("grade", "").forGetter(Score::grade),
                Codec.INT.optionalFieldOf("tier", 0).forGetter(Score::tier)
        ).apply(inst, Score::new));
    }

    /** 离线待领鱼币（旧键：uuid/coins）。 */
    private record PendingCoins(UUID player, long coins) {
        private static final Codec<PendingCoins> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("uuid").forGetter(PendingCoins::player),
                Codec.LONG.optionalFieldOf("coins", 0L).forGetter(PendingCoins::coins)
        ).apply(inst, PendingCoins::new));
    }

    /** 离线待授称号（旧键：uuid/title）。 */
    private record PendingTitles(UUID player, String title) {
        private static final Codec<PendingTitles> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                UUIDUtil.CODEC.fieldOf("uuid").forGetter(PendingTitles::player),
                Codec.STRING.optionalFieldOf("title", "").forGetter(PendingTitles::title)
        ).apply(inst, PendingTitles::new));
    }

    /** 整份存档的 codec：15 个顶层键全部沿用旧 save 的名字/类型/默认值。 */
    public static final Codec<ContestData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            Codec.BOOL.optionalFieldOf("running", false).forGetter(d -> d.running),
            Codec.INT.optionalFieldOf("rule", 0).forGetter(d -> d.ruleMode),
            Codec.LONG.optionalFieldOf("start", 0L).forGetter(d -> d.startGame),
            Codec.LONG.optionalFieldOf("end", 0L).forGetter(d -> d.endGame),
            Codec.INT.optionalFieldOf("minutes", 0).forGetter(d -> d.minutes),
            Codec.BOOL.optionalFieldOf("settled", false).forGetter(d -> d.settled),
            Codec.INT.optionalFieldOf("last_rule", 0).forGetter(d -> d.lastRuleMode),
            Codec.LONG.optionalFieldOf("last_start", 0L).forGetter(d -> d.lastStart),
            Codec.LONG.optionalFieldOf("last_end", 0L).forGetter(d -> d.lastEnd),
            Codec.INT.optionalFieldOf("last_players", 0).forGetter(d -> d.lastPlayers),
            Codec.LONG.optionalFieldOf("last_auto", 0L).forGetter(d -> d.lastAutoStartGame),
            Score.CODEC.listOf().optionalFieldOf("scores", List.of())
                    .forGetter(ContestData::scoresForSave),
            Codec.STRING.listOf().optionalFieldOf("last_board", List.of())
                    .forGetter(d -> List.copyOf(d.lastBoard)),
            PendingCoins.CODEC.listOf().optionalFieldOf("pending_coins", List.of())
                    .forGetter(ContestData::pendingCoinsForSave),
            PendingTitles.CODEC.listOf().optionalFieldOf("pending_titles", List.of())
                    .forGetter(ContestData::pendingTitlesForSave)
    ).apply(inst, ContestData::new));

    /** 26.1.2 的 SavedDataType；文件名仍叫 {@code anglertackle_contest.dat}。 */
    public static final SavedDataType<ContestData> TYPE = new SavedDataType<>(
            Identifier.withDefaultNamespace(FILE_ID), ContestData::new, CODEC);

    public ContestData() {
    }

    /** codec 读档入口：与旧 load 同口径（成绩按玩家去重、后写覆盖先写）。 */
    private ContestData(boolean running, int ruleMode, long startGame, long endGame, int minutes,
                        boolean settled, int lastRuleMode, long lastStart, long lastEnd, int lastPlayers,
                        long lastAutoStartGame, List<Score> scores, List<String> lastBoard,
                        List<PendingCoins> pendingCoins, List<PendingTitles> pendingTitles) {
        this.running = running;
        this.ruleMode = ruleMode;
        this.startGame = startGame;
        this.endGame = endGame;
        this.minutes = minutes;
        this.settled = settled;
        this.lastRuleMode = lastRuleMode;
        this.lastStart = lastStart;
        this.lastEnd = lastEnd;
        this.lastPlayers = lastPlayers;
        this.lastAutoStartGame = lastAutoStartGame;
        for (Score s : scores) {
            Contest.Entry e = new Contest.Entry(s.player(), s.name(), s.value(), s.at(), s.catches(),
                    s.fish(), s.kg(), s.len(), s.grade(), s.tier());
            this.scores.put(e.player(), e);
        }
        this.lastBoard.addAll(lastBoard);
        for (PendingCoins p : pendingCoins) {
            this.pendingCoins.put(p.player(), p.coins());
        }
        for (PendingTitles p : pendingTitles) {
            this.pendingTitles.put(p.player(), p.title());
        }
    }

    private List<Score> scoresForSave() {
        List<Score> out = new ArrayList<>(this.scores.size());
        for (Contest.Entry e : this.scores.values()) {
            out.add(new Score(e.player(), e.name() == null ? "" : e.name(), e.value(), e.atTick(),
                    e.catches(), e.fishId() == null ? "" : e.fishId(), e.weightKg(), e.lengthCm(),
                    e.grade() == null ? "" : e.grade(), e.tier()));
        }
        return out;
    }

    private List<PendingCoins> pendingCoinsForSave() {
        List<PendingCoins> out = new ArrayList<>(this.pendingCoins.size());
        for (Map.Entry<UUID, Long> e : this.pendingCoins.entrySet()) {
            out.add(new PendingCoins(e.getKey(), e.getValue()));
        }
        return out;
    }

    private List<PendingTitles> pendingTitlesForSave() {
        List<PendingTitles> out = new ArrayList<>(this.pendingTitles.size());
        for (Map.Entry<UUID, String> e : this.pendingTitles.entrySet()) {
            out.add(new PendingTitles(e.getKey(), e.getValue()));
        }
        return out;
    }

    /** 当前赛制（按下标取，开赛时钉死的那个）。 */
    public Contest.Rule rule() {
        return Contest.Rule.byMode(this.ruleMode);
    }

    /**
     * 名次表（只读）：按三级并列键排序。
     *
     * <p>⚠ 成绩表里每一条都**至少上过一尾**（没上鱼的人根本不会进表）⇒ 这里不需要再过滤 ——
     * 但"0 人上鱼"是合法情况（`docs/35` §6 第 1 条：那时公告"本场无人上鱼"，不是静默 ✗）。
     */
    public List<Contest.Entry> ranked() {
        List<Contest.Entry> out = new ArrayList<>(this.scores.values());
        out.sort(Contest.ORDER);
        return out;
    }

    /** 把一次上鱼并进成绩表（**唯一写入口**，只在上鱼那一帧调一次）。 */
    public void submit(Contest.Entry e) {
        Contest.Entry cur = this.scores.get(e.player());
        if (cur == null) {
            this.scores.put(e.player(), e);
            this.setDirty();
            return;
        }
        Contest.Rule rule = this.rule();
        if (rule.cumulative()) {
            this.scores.put(e.player(), new Contest.Entry(e.player(), e.name(),
                    cur.value() + e.value(), e.atTick(), cur.catches() + 1,
                    better(cur, e).fishId(), better(cur, e).weightKg(),
                    better(cur, e).lengthCm(), better(cur, e).grade(),
                    Math.max(cur.tier(), e.tier())));
        } else if (e.value() > cur.value() || (e.value() == cur.value() && e.atTick() < cur.atTick())) {
            // 单场型：只在**更重**（或同重但更早，理论上不会发生）时替换
            this.scores.put(e.player(), new Contest.Entry(e.player(), e.name(), e.value(), e.atTick(),
                    1, e.fishId(), e.weightKg(), e.lengthCm(), e.grade(), e.tier()));
        } else {
            // 没超过：只把尾数 +1（"这条不如我现在那条"也是真钓上来的）
            this.scores.put(e.player(), new Contest.Entry(e.player(), e.name(), cur.value(), cur.atTick(),
                    cur.catches() + 1, cur.fishId(), cur.weightKg(), cur.lengthCm(),
                    cur.grade(), Math.max(cur.tier(), e.tier())));
        }
        this.setDirty();
    }

    /** 两次上鱼里"更重的那一条"（累计型也要记下最大的一尾，用于显示）。 */
    private static Contest.Entry better(Contest.Entry a, Contest.Entry b) {
        return b.weightKg() > a.weightKg() ? b : a;
    }

    public static ContestData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(TYPE);
    }

    public static ContestData get(MinecraftServer server) {
        return get(server.overworld());
    }

    /** 给界面用的只读名次（前 N 名，`rank|name|value|fish|kg|catches` 之外的结构化版本）。 */
    public List<Contest.Entry> top(int limit) {
        List<Contest.Entry> all = this.ranked();
        return all.subList(0, Math.min(Math.max(0, limit), all.size()));
    }

    /** 供排序稳定性自检用（与 {@link Contest#ORDER} 同一个比较器，别处不许再定义一份）。 */
    public static Comparator<Contest.Entry> order() {
        return Contest.ORDER;
    }
}
