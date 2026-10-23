package com.whitecobalt.anglertackle.leaderboard;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.core.UUIDUtil;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;

/**
 * 排行榜的**存档层**（2026-10-10 M1 第 1 步 ✓）。
 *
 * <h2>为什么用 {@link SavedData}（世界级）而不是玩家附件</h2>
 * 用户定案："三种环境都做 ✓，**同一套代码** ✓，榜**跟着存档走** ✓"。
 * 世界级 SavedData 正好同时满足三条 ✓：
 * <ul>
 *   <li>单机存档：跟着那份存档 ✓</li>
 *   <li>局域网：跟着房主那份存档 ✓</li>
 *   <li>专用服务器：跟着服务器世界 ✓</li>
 * </ul>
 * ⇒ 不需要为三种环境写三套代码 ✓，也不会把某个服务器的榜带到另一个服务器 ✗。
 *
 * <h2>纪律（与 {@link Leaderboard} 一致）</h2>
 * <ul>
 *   <li><b>只在"上鱼成功"那一刻写一次</b> ✓；累计榜在内存累加 ✓，不每 tick 统计 ✗。</li>
 *   <li>读不到旧数据时**从零开始** ✓（不报错、不刷屏 ✓）。</li>
 *   <li>纯加法 ✓：这份数据不参与任何玩法判定 ✓ ⇒ 删掉它，玩法与现在**逐字一致** ✓。</li>
 * </ul>
 */
public class LeaderboardData extends SavedData {

    /** 数据文件名（26.1.2 起落在 `data/<namespace>/anglertackle_leaderboard.dat`）。**不许改名** ✗ —— 改名 = 老存档的榜全丢 ✓。 */
    public static final String FILE_ID = "anglertackle_leaderboard";

    /** 一条榜单纪录 ✓。 */
    public static final class Record {
        public final UUID player;
        public String playerName = "";
        /** 纪录数值（含义随维度不同 ✓，见 {@link Leaderboard.Board}）。 */
        public double value;
        /** 附带上下文（最重榜：鱼种/重量/评级 ✓；对抗榜：回合/耗时 ✓）。 */
        public String fishId = "";
        public double weightKg;
        /** 体长（厘米 ✓），与鱼物品同一个口径 ✓。 */
        public double lengthCm;
        public String grade = "";
        public int rounds;
        public int ticks;
        public int tier;
        public long epochMs;

        public Record(UUID player) {
            this.player = player;
        }
    }

    /**
     * 存档里的一条纪录 —— **NBT 键与旧 {@code Record.save()} 逐字一致**：
     * {@code player}(int[4]) / {@code name} / {@code value} / {@code fish} / {@code kg} / {@code len} /
     * {@code grade} / {@code rounds} / {@code ticks} / {@code tier} / {@code at}；
     * 外层旧 save 另外补的 {@code key} 也保持同名（旧 load 靠它做表键）。
     */
    private record Entry(String key, UUID player, String playerName, double value, String fishId,
                         double weightKg, double lengthCm, String grade, int rounds, int ticks, int tier,
                         long epochMs) {
        private static final Codec<Entry> CODEC = RecordCodecBuilder.create(inst -> inst.group(
                Codec.STRING.optionalFieldOf("key", "").forGetter(Entry::key),
                UUIDUtil.CODEC.fieldOf("player").forGetter(Entry::player),
                Codec.STRING.optionalFieldOf("name", "").forGetter(Entry::playerName),
                Codec.DOUBLE.optionalFieldOf("value", 0.0).forGetter(Entry::value),
                Codec.STRING.optionalFieldOf("fish", "").forGetter(Entry::fishId),
                Codec.DOUBLE.optionalFieldOf("kg", 0.0).forGetter(Entry::weightKg),
                Codec.DOUBLE.optionalFieldOf("len", 0.0).forGetter(Entry::lengthCm),
                Codec.STRING.optionalFieldOf("grade", "").forGetter(Entry::grade),
                Codec.INT.optionalFieldOf("rounds", 0).forGetter(Entry::rounds),
                Codec.INT.optionalFieldOf("ticks", 0).forGetter(Entry::ticks),
                Codec.INT.optionalFieldOf("tier", 0).forGetter(Entry::tier),
                Codec.LONG.optionalFieldOf("at", 0L).forGetter(Entry::epochMs)
        ).apply(inst, Entry::new));
    }

    /**
     * {@code boards} = 旧存档里的那个 compound（键 = {@link Leaderboard.Board#id()}，值 = 纪录 list）。
     * 旧 save 会把**每个**维度都写一遍（哪怕是空表），这里 {@link #encodeBoards()} 保持同样口径。
     */
    private static final Codec<Map<String, List<Entry>>> BOARDS_CODEC =
            Codec.unboundedMap(Codec.STRING, Entry.CODEC.listOf());

    /** 整份存档的 codec：顶层键 {@code boards} 与旧版同名同类型。 */
    public static final Codec<LeaderboardData> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            BOARDS_CODEC.optionalFieldOf("boards", Map.of())
                    .forGetter(LeaderboardData::encodeBoards)
    ).apply(inst, LeaderboardData::new));

    /** 26.1.2 的 SavedDataType；文件名仍叫 {@code anglertackle_leaderboard.dat}。 */
    public static final SavedDataType<LeaderboardData> TYPE = new SavedDataType<>(
            Identifier.withDefaultNamespace(FILE_ID), LeaderboardData::new, CODEC);

    /** 每个维度一张表 ✓（键 = 玩家 UUID ✓；按鱼种榜的键是 `玩家|鱼种` ✓，见 {@link #keyOf}）。 */
    private final Map<Leaderboard.Board, Map<String, Record>> boards = new HashMap<>();

    public LeaderboardData() {
        for (Leaderboard.Board b : Leaderboard.Board.values()) {
            this.boards.put(b, new HashMap<>());
        }
    }

    /**
     * codec 读档入口 —— 与旧 {@code load} 同口径：
     * 只认 {@link Leaderboard.Board} 里定义的维度、空键的行跳过（旧版 {@code if (!key.isEmpty())}）。
     */
    private LeaderboardData(Map<String, List<Entry>> encoded) {
        this();
        for (Leaderboard.Board b : Leaderboard.Board.values()) {
            Map<String, Record> table = this.boards.get(b);
            for (Entry e : encoded.getOrDefault(b.id(), List.of())) {
                if (e.key().isEmpty()) {
                    continue;
                }
                Record r = new Record(e.player());
                r.playerName = e.playerName();
                r.value = e.value();
                r.fishId = e.fishId();
                r.weightKg = e.weightKg();
                r.lengthCm = e.lengthCm();
                r.grade = e.grade();
                r.rounds = e.rounds();
                r.ticks = e.ticks();
                r.tier = e.tier();
                r.epochMs = e.epochMs();
                table.put(e.key(), r);
            }
        }
    }

    /** 写出用：每个维度都写（旧 save 同样口径），行内带 {@code key}。 */
    private Map<String, List<Entry>> encodeBoards() {
        Map<String, List<Entry>> out = new LinkedHashMap<>();
        for (Leaderboard.Board b : Leaderboard.Board.values()) {
            List<Entry> list = new ArrayList<>();
            for (Map.Entry<String, Record> en : this.boards.get(b).entrySet()) {
                Record r = en.getValue();
                list.add(new Entry(en.getKey(), r.player, r.playerName, r.value, r.fishId, r.weightKg,
                        r.lengthCm, r.grade, r.rounds, r.ticks, r.tier, r.epochMs));
            }
            out.put(b.id(), list);
        }
        return out;
    }

    /** 按鱼种榜要分鱼种存 ✓，其余维度按玩家存 ✓。 */
    public static String keyOf(Leaderboard.Board board, UUID player, String fishId) {
        return board == Leaderboard.Board.HEAVIEST_BY_SPECIES ? player + "|" + fishId : player.toString();
    }

    /**
     * **联赛**成绩的键前缀（`docs/39` §6.1，2026-10-13）。
     *
     * <p>为什么"前缀 + 同一张表"而不是另开一套表：这样**存读盘一行都不用改**
     * （{@link #CODEC} 本来就是按字符串键遍历的）✓，而且"联赛期间的同一个维度"
     * 天然复用完全相同的更新规则（{@link #write}）⇒ 不会出现两套口径 ✓。
     *
     * <p>⚠ 前缀用大写 {@code L}：玩家 UUID 与鱼种 id 都以十六进制字符/小写字母开头，
     * **永远不会以 L 开头** ⇒ 无歧义 ✓。
     */
    public static final String LEAGUE_PREFIX = "L";

    /** 联赛成绩的键：{@code L<规模>|<常规键>}。 */
    public static String leagueKey(String tierId, Leaderboard.Board board, UUID player, String fishId) {
        return LEAGUE_PREFIX + (tierId == null ? "" : tierId) + "|" + keyOf(board, player, fishId);
    }

    /**
     * 记一次上鱼 ✓（**唯一**的写入口 ✓ —— 只该由服务端在上鱼成功那一刻调一次 ✓）。
     *
     * @return true 表示**破了纪录**（调用方可以据此广播 ✓）
     */
    public boolean submit(Leaderboard.Board board, Leaderboard.Catch c) {
        return write(board, keyOf(board, c.player(), c.fishId()), c);
    }

    /**
     * 记一次**联赛期间**的上鱼（`docs/39` §6.1）：只累进**那个规模**的联赛成绩。
     *
     * <p>调用点在 {@code LeaderboardHooks}：**与常规榜同一份成绩快照**（不重算数值）；
     * 而"算不算数"由 {@code LeagueService.activeTierFor} 那两道闸（已签收 + 窗口内）说了算
     * —— 与联赛积分、联赛计分**同一套资格** ✓。
     */
    public boolean submitLeague(String tierId, Leaderboard.Board board, Leaderboard.Catch c) {
        return write(board, leagueKey(tierId, board, c.player(), c.fishId()), c);
    }

    /** 真正的写入规则（常规榜与联赛榜**共用这一份** ⇒ 口径只有一处 ✓）。 */
    private boolean write(Leaderboard.Board board, String key, Leaderboard.Catch c) {
        Map<String, Record> table = this.boards.get(board);
        if (table == null) {
            return false;
        }
        Record cur = table.get(key);
        double v = Leaderboard.valueOf(board, c);

        if (board.perCatch()) {
            if (cur != null && !Leaderboard.betterThan(board, v, cur.value)) {
                return false;                                   // 没破纪录 ⇒ 什么都不做 ✓（不写盘 ✓）
            }
            Record r = (cur != null) ? cur : new Record(c.player());
            r.playerName = c.playerName();
            r.value = v;
            r.fishId = c.fishId();
            r.weightKg = c.weightKg();
            r.lengthCm = c.lengthCm();
            r.grade = c.grade();
            r.rounds = c.rounds();
            r.ticks = c.ticks();
            r.tier = c.tier();
            r.epochMs = c.epochMs();
            table.put(key, r);
            this.setDirty();
            return true;
        }

        // 累计类 ✓（总尾数 / 总重量 / 金红尾数 / 图鉴 —— 图鉴榜不走上鱼事件，这里只会是前三者 ✓）
        Record r = (cur != null) ? cur : new Record(c.player());
        r.playerName = c.playerName();
        r.value += v;
        r.tier = Math.max(r.tier, c.tier());
        r.epochMs = c.epochMs();
        table.put(key, r);
        this.setDirty();
        return false;
    }

    /** 连击断了（断线/逃脱 ✓）—— 把连击榜清零 ✓；其它榜不受影响 ✓。 */
    public void breakStreak(UUID player) {
        Map<String, Record> table = this.boards.get(Leaderboard.Board.STREAK);
        if (table != null && table.remove(player.toString()) != null) {
            this.setDirty();
        }
    }

    /** 取某张榜（只读用 ✓）；调用方不要直接改它 ✗。 */
    public Map<String, Record> table(Leaderboard.Board board) {
        return this.boards.getOrDefault(board, Map.of());
    }

    /** 取（或建）某个维度的榜 ✓。传 {@code ServerLevel} 是有意的 ✓：榜跟着**那个世界**走 ✓。 */
    public static LeaderboardData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(TYPE);
    }

    /** 备用入口：只有 {@code MinecraftServer} 时取主世界那份 ✓（指令/界面用得到 ✓）。 */
    public static LeaderboardData get(MinecraftServer server) {
        return get(server.overworld());
    }

    /** 给检查器/指令用的只读快照 ✓（按值降序 ✓，同一套方向规则 ✓）。**不含联赛键** ✓。 */
    public List<Record> top(Leaderboard.Board board, int limit) {
        return top(board, limit, null);
    }

    /**
     * 前 N 条。
     *
     * @param tierId {@code null} ⇒ 只取**常规**榜（联赛成绩有自己那套板块，混进总榜会让数字变味 ✗）；
     *               给了规模 id ⇒ 只取**那个规模的联赛**成绩（`docs/39` §6.1）
     */
    public List<Record> top(Leaderboard.Board board, int limit, String tierId) {
        String prefix = tierId == null ? null : LEAGUE_PREFIX + tierId + "|";
        List<Record> out = new ArrayList<>();
        for (Map.Entry<String, Record> e : this.boards.getOrDefault(board, Map.of()).entrySet()) {
            boolean isLeague = e.getKey().startsWith(LEAGUE_PREFIX);
            if (tierId == null ? isLeague : (prefix == null || !e.getKey().startsWith(prefix))) {
                continue;
            }
            out.add(e.getValue());
        }
        out.sort((a, b) -> board.lowerIsBetter()
                ? Double.compare(a.value, b.value)
                : Double.compare(b.value, a.value));
        int max = Math.max(0, limit);
        return out.size() > max ? new ArrayList<>(out.subList(0, max)) : out;
    }

    /** 常规榜的记录条数（**排除联赛键** —— 页脚那句"共 N 条"不该把联赛成绩算进来 ✓）。 */
    public int count(Leaderboard.Board board) {
        int n = 0;
        for (String k : this.boards.getOrDefault(board, Map.of()).keySet()) {
            if (!k.startsWith(LEAGUE_PREFIX)) {
                n++;
            }
        }
        return n;
    }

    /** 某个规模的联赛成绩条数。 */
    public int countLeague(Leaderboard.Board board, String tierId) {
        String prefix = LEAGUE_PREFIX + (tierId == null ? "" : tierId) + "|";
        int n = 0;
        for (String k : this.boards.getOrDefault(board, Map.of()).keySet()) {
            if (k.startsWith(prefix)) {
                n++;
            }
        }
        return n;
    }
}
