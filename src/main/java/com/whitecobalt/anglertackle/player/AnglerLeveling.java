package com.whitecobalt.anglertackle.player;

import com.whitecobalt.anglertackle.item.Quality;

import java.util.List;
import java.util.Map;

/**
 * 垂纶等级（1–50）的全部数值与规则 —— **只在这里定义一次**。
 *
 * <p>用户 2026-10-02 定案：
 * <blockquote>
 *   每钓上来一条鱼，获得 10 经验。如果鱼是白/绿/蓝/紫/金/红品质，则额外加
 *   2/8/16/24/32/48 经验。随着等级越来越高，每级升级所需经验不断提高，
 *   从初始的 100 能升一级到 2000 一级。每 10 级解锁一次对应的评定界面，
 *   提交评定所需材料可以突破到下一级，不突破就卡在那一级，不积攒经验。
 *   到 40 级突破完后不会出现评定任务。
 * </blockquote>
 *
 * <h2>等级 / 突破 / 老柯档位 三者的关系</h2>
 * <pre>
 *   等级 1 ──经验──▶ 10 ══【评定①：绿梭鲈】══▶ 11 ──▶ 20 ══【评定②】══▶ 21
 *        ──▶ 30 ══【评定③】══▶ 31 ──▶ 40 ══【评定④】══▶ 41 ──▶ 50（不再有评定）
 * </pre>
 * <ul>
 *   <li><b>卡级</b>：等级停在 10/20/30/40 时**不再积攒经验**（{@link #isGate}）——
 *       用户原话"不突破就卡在那一级，不积攒经验"，所以到顶那一刻多余的经验直接丢掉。</li>
 *   <li><b>档位</b>：老柯的 shop 解锁档位由等级**推导**，不再单独存：
 *       {@link #stageFor} = 1 + (等级-1)/10。于是"10 级突破完"正好等于"档位 2"，
 *       商店解锁和等级永远同步，不会出现"某一处忘了推进档位"。</li>
 *   <li><b>第 5 档（下界合金）</b>需要 41 级 —— 也就是"40 级那次突破做完"，
 *       这与用户"到 40 级突破完后不会出现评定任务"一致。</li>
 * </ul>
 */
public final class AnglerLeveling {

    private AnglerLeveling() {
    }

    /** 满级。 */
    public static final int MAX_LEVEL = 50;

    /** 每条鱼的基础经验。 */
    public static final int XP_PER_CATCH = 10;

    /** 品质额外经验：下标 = 品质档（0 起算，白=0 … 红=5），与 {@link Quality} 同序。 */
    public static final int[] TIER_BONUS = {2, 8, 16, 24, 32, 48};

    /** 1 级升 2 级需要的经验（曲线起点）。 */
    public static final int XP_FIRST = 100;

    /**
     * 49 级升 50 级需要的经验（曲线终点）。
     *
     * <p>用户 2026-10-02 先定 2000，随后改成：<b>"把最后的上限调低到 1200，
     * 也就是从 1 升 2 的 100 到 49 升 50 的 1200"</b>。
     * 改这个数就够 —— 曲线公式、检查器复算、界面上显示的"还差多少"全都跟着它走。
     */
    public static final int XP_LAST = 1200;

    /** 需要评定的等级：10 / 20 / 30 / 40。40 之后不再有评定。 */
    public static final int[] GATE_LEVELS = {10, 20, 30, 40};

    /**
     * 一条鱼的垂纶经验。
     *
     * @param tier 品质档（**0 起算**：0 白 … 5 红）。越界按边界算，不抛异常 ——
     *             老存档里的鱼 tier 可能是 -1（未知），那种按白档给。
     */
    public static int xpForCatch(int tier) {
        int t = Math.max(0, Math.min(TIER_BONUS.length - 1, tier));
        return XP_PER_CATCH + TIER_BONUS[t];
    }

    /**
     * 从 {@code level} 升到 {@code level + 1} 需要的经验。
     *
     * <p><b>线性</b>从 {@link #XP_FIRST}(1 级) 涨到 {@link #XP_LAST}(49 级)：
     * {@code 100 + 1900 × (level-1) / 48}。满级返回 0。
     */
    public static int xpToNext(int level) {
        if (level >= MAX_LEVEL || level < 1) {
            return 0;
        }
        int span = MAX_LEVEL - 2;   // 49 级是最后一次升级，索引 48
        return XP_FIRST + (int) Math.round((XP_LAST - XP_FIRST) * (double) (level - 1) / span);
    }

    /** 这个等级是不是"卡级点"（10/20/30/40）：不突破就不涨经验。 */
    public static boolean isGate(int level) {
        for (int g : GATE_LEVELS) {
            if (level == g) {
                return true;
            }
        }
        return false;
    }

    /**
     * 等级 → 老柯的档位（1–5）。
     *
     * <p>{@code 1 + (level-1)/10}：1~10 → 1、11~20 → 2、21~30 → 3、31~40 → 4、41~50 → 5。
     * 注意 10 级本身仍是第 1 档 —— 要**突破完**（升到 11）才进第 2 档，
     * 这正是"不突破就卡住"在商店解锁上的体现。
     */
    public static int stageFor(int level) {
        return Math.min(FishermanProgress.MAX_STAGE, 1 + Math.max(0, level - 1) / 10);
    }

    /** 由老柯档位反推"至少该有的等级"（老存档迁移用：档位 2 → 至少 11 级）。 */
    public static int levelFloorForStage(int stage) {
        return Math.max(1, (Math.max(1, stage) - 1) * 10 + 1);
    }

    /** 下一个评定在几级；已经全部评完（41 级以上）返回 0。 */
    public static int nextGate(int level) {
        for (int g : GATE_LEVELS) {
            if (level <= g) {
                return g;
            }
        }
        return 0;
    }

    // ================================================================ 评定材料

    /**
     * 一条评定材料要求。
     *
     * @param fishId  鱼种 id（{@link com.whitecobalt.anglertackle.fishing.FishSpecies#byId}）
     * @param minTier 最低品质档，**0 起算**（0 白 … 5 红）——与 {@code Quality} 同序。
     *                ⚠ 商店档位号是 1 起的，品质号是 0 起的，这两个数不是一回事
     *                （混用正好错一档，历史上踩过）。
     * @param count   要几条
     */
    public record Requirement(String fishId, int minTier, int count) {
    }

    private static final int GREEN = Quality.GREEN.ordinal();
    private static final int BLUE = Quality.BLUE.ordinal();
    private static final int PURPLE = Quality.PURPLE.ordinal();
    private static final int GOLD = Quality.GOLD.ordinal();

    /**
     * 四个评定点的材料（用户 2026-10-02 逐条指定）。
     *
     * <pre>
     *   10 级突破：绿梭鲈
     *   20 级突破：蓝鲻鱼、蓝梭鲈
     *   30 级突破：紫梭鲈、蓝草鱼
     *   40 级突破：金幼鲨、紫翘嘴
     * </pre>
     */
    public static final Map<Integer, List<Requirement>> GATES = Map.of(
            10, List.of(new Requirement("zander", GREEN, 1)),
            20, List.of(new Requirement("mullet", BLUE, 1),
                         new Requirement("zander", BLUE, 1)),
            30, List.of(new Requirement("zander", PURPLE, 1),
                         new Requirement("grass_carp", BLUE, 1)),
            40, List.of(new Requirement("juvenile_shark", GOLD, 1),
                         new Requirement("topmouth_culter", PURPLE, 1)));

    /** 这个等级要交什么；不是评定点（或已评完）返回空表。 */
    public static List<Requirement> requirementsAt(int level) {
        return GATES.getOrDefault(level, List.of());
    }

    /**
     * 评定材料的文案，例如 {@code 紫品质以上 梭鲈 ×1}。
     *
     * <p>⚠ 必须写"**以上**"：判定是 {@code effectiveTier() >= minTier}，
     * 用户 2026-10-02 也明确"要求绿色梭鲈的话更高级的梭鲈也可以替代提交"。
     * 把文案写成"绿品质 梭鲈"会让玩家以为非得是绿的 —— 手上只有蓝的就不敢交。
     */
    public static String describe(Requirement r) {
        String[] cn = {"白", "绿", "蓝", "紫", "金", "红"};
        int t = Math.max(0, Math.min(cn.length - 1, r.minTier()));
        return Quality.of(t).color() + cn[t] + "§f品质以上 "
                + com.whitecobalt.anglertackle.shop.ShopMaterials.fishName(r.fishId())
                + " §e×" + r.count();
    }

    /** 一整级的评定要求文案（多条用「、」隔开）。 */
    public static String describe(int level) {
        List<Requirement> list = requirementsAt(level);
        if (list.isEmpty()) {
            return "—";
        }
        StringBuilder sb = new StringBuilder();
        for (Requirement r : list) {
            if (sb.length() > 0) {
                sb.append("§7、");
            }
            sb.append(describe(r));
        }
        return sb.toString();
    }

    /** 1→50 总共需要多少经验（检查器会打印它，方便掂量"这要钓多少条鱼"）。 */
    public static int totalXpToMax() {
        int sum = 0;
        for (int lv = 1; lv < MAX_LEVEL; lv++) {
            sum += xpToNext(lv);
        }
        return sum;
    }
}
