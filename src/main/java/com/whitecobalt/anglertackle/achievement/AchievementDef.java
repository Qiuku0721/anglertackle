package com.whitecobalt.anglertackle.achievement;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 成就定义表（策划 `docs/41` §4 的 50 条；A1 落骨架，**A2 已补上鱼类 11 条**
 * ——图鉴 6 + 品质 5，其余按 §7 逐阶段加）。
 *
 * <h2>为什么是一张静态表，而不是每条一个类</h2>
 * 与 `TitleDefs` 同一条理由：成就的差别只在**条件**与**难度**，判定逻辑在
 * {@link AchievementService} 里只有一份。表里写死 50 个类，就会出现 50 份"几乎一样"
 * 的判定代码，改一处忘一处 —— 而成就最贵的错误（重复发奖）恰恰出在这种复制里。
 *
 * <h2>难度只决定奖励（`docs/41` §2.1）</h2>
 * 普通 ×1 / 进阶 ×1.5 / 困难 ×2 / 传奇 ×3 ⇒ 鱼币 25/38/50/75、经验 20/30/40/60。
 * **倍率只在这里算一次**，奖励怎么发在服务里（走邮件，与委托同一条通道）。
 *
 * <h2>与既有内容的关系</h2>
 * 与既有称号**同条件**的成就（`codex_all` / `red_first` / `angler_50` / `league_champ_*`）
 * 在 A5 里只调 `Titles.grant` 授予**既有**称号，**不新增称号**（`docs/41` §9）。
 * 本类不持有称号字段 —— 那是 A5 的事，提前放进来只会让表里多一堆没人读的列。
 */
public final class AchievementDef {

    private AchievementDef() {
    }

    /**
     * 一条成就：{@code id} 必须与语言键 `achievement.anglertackle.<id>` 对得上
     * （`check-achievement.js` 会两侧一起核）。
     *
     * @param tier 难度档：1 = 普通、2 = 进阶、3 = 困难、4 = 传奇（只影响奖励）
     */
    public record Def(String id, int tier) {

        /** 难度倍率（`docs/41` §2.1；只在这里出现一次）。 */
        public double multiplier() {
            return switch (tier) {
                case 2 -> 1.5;
                case 3 -> 2.0;
                case 4 -> 3.0;
                default -> 1.0;
            };
        }

        /** 奖励鱼币（基础 25 × 倍率，四舍五入）。 */
        public long coins() {
            return Math.round(25L * multiplier());
        }

        /** 奖励经验（基础 20 × 倍率，四舍五入）。 */
        public int xp() {
            return (int) Math.round(20 * multiplier());
        }
    }

    /**
     * 全部成就。用 {@link LinkedHashMap} 是为了让"表里的顺序"稳定可读
     * （界面按 §4 的分组展示，顺序抖动会让同一份数据两次渲染不一样）。
     */
    private static final Map<String, Def> ALL = new LinkedHashMap<>();

    private static void put(String id, int tier) {
        ALL.put(id, new Def(id, tier));
    }

    static {
        // ── A2 上鱼类 11 条（docs/41 §4.1 图鉴 6 + §4.2 品质 5；id 与策划案逐字一致）──
        // 图鉴 / 收集（6）：阈值 = 图鉴点亮的鱼种数。⚠ 判定在 AchievementService.onCatch，
        //   "这一杆"要自己 +1（recordCatch 比 onLanded 晚，见那里的说明）。
        put("a_first_catch", 1);   // 开竿：钓到第一条鱼
        put("a_codex_5", 1);       // 鱼种记录者：图鉴 5 种
        put("a_codex_10", 2);      // 鱼种编目者：图鉴 10 种
        put("a_codex_24", 3);      // 鱼类鉴定家：图鉴 24 种（与既有称号 codex_24 同门槛）
        put("a_codex_40", 3);      // 鱼类学者：图鉴 40 种（与既有称号 codex_40 同门槛）
        put("a_codex_all", 4);     // 鱼类通鉴：全部 47 种（传奇；A5 会同时授予既有称号 codex_all）
        // 品质（5）：档位口径 白0 绿1 蓝2 紫3 金4 红5（与 FishSpecies 第 91 行同款，
        //   常量定义在 AchievementService，只写一遍）
        put("b_green", 1);         // 初见绿
        put("b_blue", 1);          // 初见蓝
        put("b_purple", 2);        // 初见紫
        put("b_gold", 3);          // 初见金
        put("b_red", 4);
        // ── A3 等级类（2026-10-15 晚）：门槛对齐既有称号 angler_10 / angler_21 / angler_31
        //    （`Titles.syncLevel` 用的就是这几级），所以同条件 ⇒ A5 直接授予那几个既有称号 ✓。
        // ⚠ 2026-10-15 晚**按策划案改正**：等级类的 id 是 `d_lv*`（不是我第一版写的 `c_level_*`），
        //   门槛也与既有称号对齐（10 / **21** / **31** / 40 / 50）—— `c_*` 在策划里是**尺寸类**。
        //   策划是合同：id、门槛、奖励都照 §4 那张表，别自己发明 ✓。
        put("d_lv10", 2);          // 垂纶学徒：等级 10（评定点①，与 angler_10 对齐）
        put("d_lv20", 2);          // 垂纶熟手：等级 21（过评定②，与 angler_21 对齐）
        put("d_lv30", 3);          // 垂纶名手：等级 31（过评定③，与 angler_31 对齐）
        put("d_lv40", 3);          // 垂纶名宿：等级 40（评定点④，与 angler_40 对齐）
        put("d_lv50", 4);          // 垂纶宗师：满级 50（与 angler_50 对齐）
        // ── 尺寸类（c_*，策划 §4 第 14~18 条）：条件当场从这一杆的 kg/cm 判，不用另存进度 ──
        put("c_1kg", 1);           // 千克级：单条 ≥ 1 kg
        put("c_5kg", 2);           // 大物钓手：单条 ≥ 5 kg（与 giant_5 对齐）
        put("c_10kg", 3);          // 十千克：单条 ≥ 10 kg
        put("c_50cm", 1);          // 半米：单条 ≥ 50 cm
        put("c_100cm", 3);         // 米级：单条 ≥ 100 cm
        // ── 技法 / 联赛 / 环境 / 任务（策划 §4 第 26、34、44、49、50 条）：条件全部读**既有计数** ──
        //   ⚠ 这些计数真源在称号系统里（`Titles.progress` + `K_*` 常量），**不新造计数器**；
        //     谁的计数谁负责 bump，这边只读 ⇒ 不会出现"两个地方各记一份、迟早不一致" ✓。
        put("e_chum_100", 1);      // 打窝老手：打窝 100 次（与 chum_master 对齐）
        put("f_league_join", 1);   // 初登赛场：首次参加联赛
        put("i_full_moon", 2);     // 月满垂纶：满月夜累计 10 尾（与 moon_chaser 对齐）
        put("k_first_daily", 1);   // 第一单：完成第一个每日委托
        put("k_activity_full", 3); // 满档：周活跃满档一次（100）
        put("i_polar", 3);         // 极地渔者：在极地 / 冷水域钓到鱼（读 K_ICE，已有计数）
        put("i_rain", 1);          // 雨中垂钓：雨天钓到鱼（上鱼那一刻当场判天气，不存计数）
        put("e_land_50", 1);       // 五十连上：累计成功上鱼 50 次（读 K_LAND）
        put("e_first_cast", 1);    // 首抛：完成第一次抛投（在抛投唯一入口判）
        put("g_dish_master", 2);   // 鱼宴大厨：10 种菜型各做过一次（读 K_DISH_MADE 掩码，与 chef_10 对齐）
        put("f_league_top10", 3);  // 前十：任一级联赛进前十（结算时当场判名次）
        put("f_league_champ", 4);  // 联赛冠军：任一级联赛夺冠
        put("f_contest_join", 1);  // 初赛：首次参加比赛（进名次表即算，比赛是自动参赛）
        put("f_contest_champ", 4); // 夺魁：比赛夺冠
        put("g_first_grill", 1);   // 开火：第一次把鱼做熟（除刺身外的任意菜型）
        put("g_first_sashimi", 1); // 一刀鲜：第一次做刺身（掩码第 8 位）
        put("i_hut", 1);           // 老地方：在老柯（渔夫小屋）附近钓到鱼
        // ── 2026-10-15 晚**补满 50 条**：用户"不合理的就改，数量是 50，里面是什么我不在乎" ──
        //   原则：**只用已经存在的真源**（称号计数 / 委托统计 / 这一杆的 kg·cm），
        //   宁可换条件，也不做"永远点不亮"或"系统还不存在"的条目（原策划里的
        //   `e_six_purple` 六槽皆紫、`h_first_specimen` 标本、`h_tank_5` 水族箱都因此**被替换**，
        //   理由见 `docs/成就设计审查-2026-10-15.md`）。
        put("b_red_10", 2);        // 红档十尾：累计钓到 10 尾红档（读 K_RED）
        put("i_night_10", 1);      // 夜钓十尾：夜里累计 10 尾（读 K_NIGHT）
        put("i_storm", 2);         // 雷暴金档：雷暴天钓到金档（读 K_STORM_GOLD）
        put("i_ice_5", 2);         // 冰钓五尾：冰洞/冷水域累计 5 尾（读 K_ICE）
        put("i_full_moon_50", 3);  // 月满五十：满月夜累计 50 尾（读 K_FULL_MOON）
        put("e_line_break_10", 1); // 断线十次：累计断线 10 次（读 K_LINE_BREAK）
        put("e_land_200", 2);      // 二百尾：累计成功上鱼 200 次（读 K_LAND）
        put("e_chum_500", 2);      // 打窝五百：累计打窝 500 次（读 K_CHUM）
        put("k_daily_30", 2);      // 三十单：累计完成 30 个委托（读 QuestData.totalCompleted）
        put("k_activity_50", 1);   // 半档：周活跃度到 50（读 QuestData.activity）
        put("c_20kg", 4);          // 二十公斤：单条 ≥ 20 kg（传奇尺寸）
        put("c_150cm", 4);         // 一米五：单条 ≥ 150 cm（传奇尺寸）           // 开门红：第一尾红档（传奇；A5 会同时授予既有称号 red_first）
        // ⚠ A3 在这里补纪录 / 技法 / 环境 / 等级 / 联赛 / 料理 / 水族 / 商店 / 任务各类
        //   （docs/41 §4.3~§4.11）—— 每加一条都要同步：① 中英语言键
        //   `achievement.anglertackle.<id>`；② `check-achievement.js` 的条数/[D]/[F] 断言；
        //   ③ 触发点（`onCatch` 或对应系统各加一行）。
    }

    /**
     * 成就 → **既有**称号 id（`docs/41` §9："与既有称号同条件的，只调 `Titles.grant`
     * 授予那个既有称号，**不新增称号**"）。
     *
     * <p>为什么用一张独立的映射表、而不是往 {@link Def} 里加字段：这张表是**给已有系统搭桥**，
     * 不是成就自身的属性；分开写以后，"哪些成就顺带给称号"一眼可见，也不会让 11 条记录都多带一个
     * 基本为 null 的列 ✓。门槛与既有称号**逐字一致**（24 种 / 40 种 / 全部 / 首尾红档），
     * 不许各自写一套 —— 那是 §9 点名要防的"两套判定"。
     */
    // ⚠ 必须用 `Map.ofEntries`：`Map.of` **最多 10 组**键值对，同条件成就一多就会编译失败
    //   （2026-10-15 晚：加到 12 组直接把闸的构建打红了一次）。
    private static final Map<String, String> TITLES = Map.ofEntries(
            Map.entry("a_codex_24", "codex_24"),
            Map.entry("a_codex_40", "codex_40"),
            Map.entry("a_codex_all", "codex_all"),
            Map.entry("b_red", "red_first"),
            Map.entry("d_lv10", "angler_10"),
            Map.entry("d_lv20", "angler_21"),
            Map.entry("d_lv30", "angler_31"),
            Map.entry("d_lv40", "angler_40"),
            Map.entry("d_lv50", "angler_50"),
            Map.entry("c_5kg", "giant_5"),
            Map.entry("e_chum_100", "chum_master"),
            Map.entry("i_full_moon", "moon_chaser"));
    // （旧版 `Map.of(...)` 写法已删：见上 —— 同条件成就超过 10 组时它会直接让构建失败。）

    /** 这条成就要授予哪个**既有**称号（没有 ⇒ null）。 */
    public static String titleFor(String id) {
        return id == null ? null : TITLES.get(id);
    }

    /** 按 id 取定义；没有 ⇒ null（调用方自己决定怎么处理，**不要**在这里悄悄兜底）。 */
    public static Def byId(String id) {
        return id == null ? null : ALL.get(id);
    }

    /** 已登记的条数（界面 `N / 50` 与检查器都用它，**不许在别处再数一遍**）。 */
    public static int count() {
        return ALL.size();
    }

    /** 全部（只读视图）。 */
    public static Map<String, Def> all() {
        return java.util.Collections.unmodifiableMap(ALL);
    }
}
