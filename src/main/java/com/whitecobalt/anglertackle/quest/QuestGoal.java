package com.whitecobalt.anglertackle.quest;

import com.whitecobalt.anglertackle.player.QuestData;

import java.util.List;
import java.util.Locale;

/**
 * **目标判定**（老柯的委托；策划 `docs/40` §4/§5，用户 2026-10-14 定案）。
 *
 * <h2>为什么单独一个类，而且是纯函数</h2>
 * 「这次上鱼，某条委托的进度变成多少」是**整个任务系统最容易写错的一处**
 * —— 九种目标 × 每条委托自己的参数。把它做成
 * {@code (定义, 旧进度行, 上鱼快照) → 新进度行} 的**纯函数**，
 * 就能脱离服务端单独测（{@code tools/check-quest.js} 会真调它）✓，
 * 也不会顺手改到玩家数据 ✗（谁写回由 {@link QuestService} 一处说了算）。
 *
 * <h2>⚠ {@code Row.progress} 的单位**随目标变**（唯一需要记住的事）</h2>
 * <table border="1">
 *   <tr><th>目标</th><th>progress 含义</th><th>达标线</th></tr>
 *   <tr><td>GET_COUNT / GET_TIER_COUNT / GET_SPECIES / GET_ROD_TYPE</td>
 *       <td>条数</td><td>args 里的 n</td></tr>
 *   <tr><td>GET_WEIGHT_SUM / GET_BIGGEST</td>
 *       <td>重量 ×100（即 0.01 kg 一格 —— 用整数存小数，免得浮点误差越攒越偏）</td>
 *       <td>args 的 kg ×100</td></tr>
 *   <tr><td>GET_LONGEST</td><td>厘米（四舍五入到整数）</td><td>args 的 cm</td></tr>
 *   <tr><td>GET_SPECIES_SET / GET_VARIETY</td>
 *       <td>**命中的鱼种数**（另存 {@code Row.collected}，progress 只是它的计数）</td>
 *       <td>args 的 id 个数 / args 的 n</td></tr>
 * </table>
 */
public final class QuestGoal {

    private QuestGoal() {
    }

    /**
     * 一次上鱼的**只读快照**。
     *
     * <p>⚠ 竿型（{@code rodType}）**不在** {@code Leaderboard.Catch} 里 ——
     * 它是"上鱼那一刻玩家手里握着什么竿"，由 {@link QuestService} 用主手现查 ✓
     * （这样就不必改 {@code FishingSession} 的上鱼调用签名，那是最不该动的地方 ✗）。
     *
     * @param fishId  鱼种 id（如 {@code crucian_carp}）
     * @param kg      重量
     * @param cm      长度
     * @param tier    品质档（**0 白 1 绿 2 蓝 3 紫 4 金 5 红**）
     * @param rodType 竿型：{@code float} / {@code lure}（认不出来给空串）
     */
    public record Catch(String fishId, double kg, double cm, int tier, String rodType) {
    }

    /** 重量存进 progress 的缩放倍数（0.01 kg 一格）。 */
    private static final int WEIGHT_SCALE = 100;

    // ---------------------------------------------------------------- 达标线
    /** 这条委托的达标线（单位与 {@code Row.progress} 一致）。 */
    public static int target(QuestDef def) {
        if (def == null) {
            return 1;
        }
        return switch (def.goal()) {
            case GET_COUNT -> Math.max(1, def.argInt(0, 1));
            case GET_TIER_COUNT -> Math.max(1, def.argInt(1, 1));
            case GET_SPECIES -> Math.max(1, def.argInt(1, 1));
            case GET_SPECIES_SET -> Math.max(1, def.args().size());
            case GET_WEIGHT_SUM, GET_BIGGEST ->
                    Math.max(1, (int) Math.round(def.argDouble(0, 1.0) * WEIGHT_SCALE));
            case GET_LONGEST -> Math.max(1, def.argInt(0, 1));
            case GET_ROD_TYPE -> Math.max(1, def.argInt(1, 1));
            case GET_VARIETY -> Math.max(1, def.argInt(0, 1));
        };
    }

    /** 达标了没有（只读）。 */
    public static boolean reached(QuestDef def, QuestData.Row row) {
        return row != null && row.progress() >= target(def);
    }

    // ---------------------------------------------------------------- 推进
    /**
     * 推进一次进度（**纯函数**，不认识玩家、不写存档）✓。
     *
     * <p>不进则退的两种情形返回**原对象**（调用方用 {@code equals} 判"有没有变"）：
     * 鱼种不对 / 品质不够 / 竿型不对 / 已经记过这个鱼种。
     */
    public static QuestData.Row advance(QuestDef def, QuestData.Row row, Catch c) {
        if (def == null || row == null || c == null) {
            return row;
        }
        String fishId = c.fishId() == null ? "" : c.fishId();
        return switch (def.goal()) {
            case GET_COUNT -> row.withProgress(row.progress() + 1);

            case GET_TIER_COUNT -> c.tier() >= def.argInt(0, 0)
                    ? row.withProgress(row.progress() + 1)
                    : row;

            case GET_SPECIES -> fishId.equalsIgnoreCase(def.arg(0))
                    ? row.withProgress(row.progress() + 1)
                    : row;

            case GET_WEIGHT_SUM -> row.withProgress(
                    row.progress() + (int) Math.round(Math.max(0.0, c.kg()) * WEIGHT_SCALE));

            case GET_BIGGEST -> {
                int v = (int) Math.round(Math.max(0.0, c.kg()) * WEIGHT_SCALE);
                yield v > row.progress() ? row.withProgress(v) : row;
            }

            case GET_LONGEST -> {
                int v = (int) Math.round(Math.max(0.0, c.cm()));
                yield v > row.progress() ? row.withProgress(v) : row;
            }

            case GET_ROD_TYPE -> {
                String want = def.arg(0).trim().toLowerCase(Locale.ROOT);
                boolean hit = "both".equals(want) || want.equals(c.rodType().toLowerCase(Locale.ROOT));
                yield hit ? row.withProgress(row.progress() + 1) : row;
            }

            // 集齐某几种：只认 args 里点名的鱼种，命中且**没记过**才算一种 ✓
            case GET_SPECIES_SET -> {
                if (!def.args().contains(fishId) || has(row, fishId)) {
                    yield row;
                }
                String next = append(row, fishId);
                yield row.withCollected(next).withProgress(hits(def.args(), next));
            }

            // 若干种不同的鱼：任何鱼都记，**同一种只算一次** ✓
            case GET_VARIETY -> {
                if (fishId.isEmpty() || has(row, fishId)) {
                    yield row;
                }
                String next = append(row, fishId);
                yield row.withCollected(next).withProgress(distinct(next));
            }
        };
    }

    // ---------------------------------------------------------------- 给界面用的换算
    /** 把 progress 换回**人看的单位**（重量类的 ×100 → kg）。进度条 / 文案用。 */
    public static double display(QuestDef def, QuestData.Row row) {
        int p = row == null ? 0 : row.progress();
        if (def == null) {
            return p;
        }
        return switch (def.goal()) {
            case GET_WEIGHT_SUM, GET_BIGGEST -> p / (double) WEIGHT_SCALE;
            default -> p;
        };
    }

    /** 达标线换回人看的单位。 */
    public static double displayTarget(QuestDef def) {
        int t = target(def);
        if (def == null) {
            return t;
        }
        return switch (def.goal()) {
            case GET_WEIGHT_SUM, GET_BIGGEST -> t / (double) WEIGHT_SCALE;
            default -> t;
        };
    }

    // ---------------------------------------------------------------- 私有：collected 的读写
    private static final String SEP = ",";

    /** 逗号分隔串里有没有这个 id（**不用 String.contains** —— 那会把 a_b 命中成 a_bc）。 */
    public static boolean has(QuestData.Row row, String fishId) {
        if (row == null || fishId == null || fishId.isEmpty() || row.collected().isEmpty()) {
            return false;
        }
        for (String s : row.collected().split(SEP)) {
            if (s.equals(fishId)) {
                return true;
            }
        }
        return false;
    }

    private static String append(QuestData.Row row, String fishId) {
        return row.collected().isEmpty() ? fishId : row.collected() + SEP + fishId;
    }

    /** 串里不同 id 的个数。 */
    public static int distinct(String collected) {
        if (collected == null || collected.isEmpty()) {
            return 0;
        }
        return (int) List.of(collected.split(SEP)).stream().filter(s -> !s.isEmpty()).distinct().count();
    }

    /** 串里命中了给定 id 列表几个。 */
    public static int hits(List<String> want, String collected) {
        if (collected == null || collected.isEmpty() || want == null) {
            return 0;
        }
        List<String> got = List.of(collected.split(SEP));
        int n = 0;
        for (String w : want) {
            if (got.contains(w)) {
                n++;
            }
        }
        return n;
    }
}
