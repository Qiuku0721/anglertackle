package com.whitecobalt.anglertackle.title;

import java.util.List;

/**
 * 称号**数据表**（用户 2026-10-11："备选加过渡加。然后推进。"）。
 *
 * <h2>这里只有"结构"，没有"文案"</h2>
 * 中文名 / 英文名 / 获得条件三处文案一律在语言文件里
 * （{@code title.anglertackle.<id>} / {@code .en} / {@code .cond}），
 * 因为它们是**给玩家看的字**，要与其它 UI 文案放一起；这个类只回答
 * "有哪些称号、什么颜色、能不能重复获得"。
 *
 * <h2>颜色只用 {@code Quality} 的档位序（0 白 … 5 红）</h2>
 * 不写颜色码 —— 与 tooltip / 图鉴 / 排行榜共用同一套色号
 * （{@code Quality.of(ordinal)}）。守着这条的是 {@code tools/check-titles.js}。
 *
 * <h2>命名规则（用户两轮口径 + 《无尽的拉格朗日》的称号风格）</h2>
 * 见 {@link #NAME_TAILS} / {@link #EXPLAINED_NAMES} / {@link #BANNED_WORDS}：
 * 中段一律"领域 + 身份词"，顶端才允许用成语或术语；**光秃秃一个名词不行**
 * （用户点名的反例：{@code 大物} / {@code 巨物} 单放着"人家不知道干嘛" ✗）。
 * 三个数组是**检查器的唯一真源**（{@code check-titles.js} 直接读它们），
 * 所以改命名规则只改这里一处 ✓。
 */
public final class TitleDefs {

    private TitleDefs() {
    }

    /**
     * 一条称号。
     *
     * @param id         稳定 id（存进玩家附件，**永不改名**；改的是语言文件里的中文名）
     * @param quality    颜色档位 0 白 / 1 绿 / 2 蓝 / 3 紫 / 4 金 / 5 红（走 {@code Quality}）
     * @param repeatable 能不能重复获得（可重复的显示 {@code ×N}）
     */
    public record Def(String id, int quality, boolean repeatable) {
    }

    /** 全表。**顺序 = 语言文件与文档的对账顺序**（38 行 / 40 个 id）。 */
    public static final List<Def> ALL = List.of(
            // ---- 图鉴线（8）----
            new Def("first_catch", 0, false),
            new Def("codex_5", 0, false),
            new Def("codex_10", 1, false),
            new Def("codex_24", 2, false),
            new Def("codex_40", 3, false),
            new Def("codex_all", 4, false),
            new Def("codex_gold_10", 4, false),
            new Def("codex_gold_all", 5, false),
            // ---- 等级线（5）----
            new Def("angler_10", 0, false),
            new Def("angler_21", 1, false),
            new Def("angler_31", 2, false),
            new Def("angler_40", 3, false),
            new Def("angler_50", 5, false),
            // ---- 巨物线（4）----
            new Def("giant_5", 1, false),
            new Def("giant_20", 3, false),
            new Def("giant_50", 3, false),
            new Def("giant_100", 4, false),
            // ---- 稀有 / 纪录（6）----
            new Def("record_grade", 4, false),
            new Def("big_three", 5, false),
            new Def("red_first", 3, false),
            new Def("red_collector", 5, false),
            new Def("legendary_three", 4, false),
            new Def("gar_hunter", 2, false),
            // ---- 环境（4）----
            new Def("night_owl", 2, false),
            new Def("storm_rider", 3, false),
            new Def("moon_chaser", 3, false),
            new Def("ice_angler", 2, false),
            // ---- 厨艺 / 吃（3）----
            new Def("chef_10", 4, false),
            new Def("gourmet", 2, false),
            new Def("iron_stomach", 3, false),
            // ---- 日常 / 趣味（2）----
            new Def("chum_master", 1, false),
            new Def("line_breaker", 0, false),
            // ---- 元老（1）----
            new Def("old_guard", 0, false),
            // ---- 联赛（4：常客 1 + 三级冠军 3）----
            new Def("league_regular", 1, false),
            new Def("league_champ_small", 3, true),
            new Def("league_champ_medium", 4, true),
            new Def("league_champ_large", 5, true),
            // ---- 比赛（1）----
            new Def("contest_champion", 4, true),
            // ---- 邮件 / 手动（2）----
            new Def("mail_first", 0, false),
            new Def("granted", 3, true)
    );

    /**
     * **身份后缀白名单** —— 拉格朗日那套：称号是"领域 + 身份词"，
     * 陌生人一看就知道这人是干嘛的（用户原话："人家不知道干嘛的"就是缺了它）。
     */
    public static final List<String> NAME_TAILS = List.of(
            "者", "家", "手", "客", "人", "师", "学者", "专家", "大师", "大厨",
            "冠军", "常客", "元老", "收藏家", "猎手",
            // 行当里的两个身份词（"垂纶学徒 / 垂纶名宿"要用）：
            // 学徒 = 拜师学艺的，名宿 = 圈里有名的老手 —— 都是现实里存在的称呼，不是奇幻称谓 ✓
            "学徒", "名宿");

    /**
     * **引用短语白名单** —— 顶端/稀有的那几条：成语、竞技术语、行话。
     * 每条都要能回答"**为什么它自解释**"，答不出来的不许进这张表。
     */
    public static final List<String> EXPLAINED_NAMES = List.of(
            // 行话：钓鱼人开张第一竿
            "开竿",
            // 游戏内已有的评级名（图鉴/排行榜/鱼名上都在用同一个词）
            "纪录级",
            // 体育术语：一项赛事拿三个冠军
            "三冠王",
            // 成语：本义"一开始就红"，这里正好双关（第一条红档鱼）
            "开门红",
            // "传说"指三种稀有鱼，"三连"是连中三元
            "传说三连",
            // 月相（满月）+ 垂纶（钓鱼的文言说法，本模组手册里一直在用）
            "月满垂纶",
            // 成语：什么都不忌讳 —— 趣味称号，自嘲"什么都敢吃"
            "百无禁忌",
            // "通鉴"= 完整图志（对 47 种全部点亮）
            "鱼类通鉴",
            // "全录"= 全部记录在册（对 30 种能出金的鱼都出过金）
            "金鳞全录",
            // "金鳞"= 金档鱼；"十种"直接写在名字里
            "金鳞十种",
            // 名字本身就是条件：收到邮件系统里的第一封信
            "第一封信",
            // 名字本身就是条件：服主用指令给的（不是自己挣的，所以名字也不装成"成就"）
            "服主授予");

    /**
     * **奇幻词黑名单** —— 这才叫"中二"。
     *
     * <p>⚠ 用户 2026-10-11 明确澄清："**猎手什么的也不算很中二，我只是提醒一嘴**" ⇒
     * 所以 {@code 猎手} / {@code 行者} 这类**不在**表里；真正要挡的是"喊得响、没出处"的奇幻称谓。
     */
    public static final List<String> BANNED_WORDS = List.of(
            "王者", "战神", "至尊", "无敌", "君王", "天选", "弑神", "灭世", "之主", "大帝", "传说之力");

    /** 中文名的**字数上限**（聊天里要后缀在名字后面：`玩家[称号]：内容`）。 */
    public static final int NAME_MAX_CHARS = 5;

    /** 中文名的字数下限（一个字太短，在聊天里像误触）。 */
    public static final int NAME_MIN_CHARS = 2;

    /** 按 id 找一条（找不到返回 null）。 */
    public static Def byId(String id) {
        if (id == null) {
            return null;
        }
        for (Def d : ALL) {
            if (d.id().equals(id)) {
                return d;
            }
        }
        return null;
    }

    // ================================================================ 生成式称号（`docs/39` §5）

    /**
     * 一条**可参数化的称号模板**。用户 2026-10-13 原话：
     * "你不可能直接在预设里写几千行往后联赛的称号，显然这需要能够生成称号的功能。"
     *
     * <p>**实例 id 的形状**：{@code 模板id@S<赛季号>-<规模>}，例如 {@code league_champ@S1-large}
     * ⇒ 显示成"**S1大型联赛冠军**"。规模只有 {@link #SIZES} 三种（与 `docs/37` 的联赛三级同名）。
     *
     * <h2>为什么单开一张表，**绝不往 {@link #ALL} 里加**</h2>
     * {@code ALL} 是与 `docs/38` §4 表格**逐条双向对账**、还要逐条查名字与条件文案的那张表
     * （`check-titles.js` 的 A/B/C 三段都读它），界面上的"40 个称号"进度也按它的长度算。
     * 把"往后每一届"塞进去会把这三件事一起撑爆 ✗。所以模板另立一表，**ALL 一个字节不动** ✓
     * （既有检查器、既有 40 条的进度、既有文档对账**全部不受影响**）。
     *
     * @param id 模板 id（**永不改名**：它已经进了玩家存档，改了就认不出来）
     * @param q  三个规模各自的颜色档位（0 白 … 5 红）：下标与 {@link #SIZES} 一一对应
     */
    public record Template(String id, int[] q) {
    }

    /** 模板表（顺序 = 图鉴称号页里实例行的排列顺序）。 */
    public static final List<Template> TEMPLATES = List.of(
            new Template("league_champ", new int[] {3, 4, 5}),      // 冠军：紫 / 金 / 红
            new Template("league_runnerup", new int[] {2, 3, 4}),   // 亚军：蓝 / 紫 / 金
            new Template("league_third", new int[] {0, 2, 3}),      // 季军：白 / 蓝 / 紫
            new Template("league_memorial", new int[] {4, 4, 4}));  // 纪念：金（用户定的"金色品质"）

    /** 规模白名单。⚠ **顺序与 {@link Template#q()} 的下标绑定，不许改顺序**。 */
    public static final List<String> SIZES = List.of("small", "medium", "large");

    /** 实例 id 的分隔符（全仓只此一处用 {@code @}，不会跟别的 id 撞）。 */
    public static final char INSTANCE_SEP = '@';

    public static Template template(String id) {
        if (id == null) {
            return null;
        }
        for (Template t : TEMPLATES) {
            if (t.id().equals(id)) {
                return t;
            }
        }
        return null;
    }

    /** 是不是"生成式实例"（含 {@code @} 且 {@code @} 前面有东西）。 */
    public static boolean isInstance(String id) {
        return id != null && id.indexOf(INSTANCE_SEP) > 0;
    }

    /** 实例 id ⇒ 模板 id（静态 id 原样返回 —— 这样名字只有一处要改）。 */
    public static String templateIdOf(String id) {
        if (id == null) {
            return "";
        }
        int i = id.indexOf(INSTANCE_SEP);
        return i > 0 ? id.substring(0, i) : id;
    }

    /** 拆 {@code @S<赛季>-<规模>}；格式不对（缺 {@code -}、缺 {@code S}）返回 null。 */
    private static String[] parts(String id) {
        if (!isInstance(id)) {
            return null;
        }
        String tail = id.substring(id.indexOf(INSTANCE_SEP) + 1);   // 例：S1-large
        if (tail.length() < 4 || tail.charAt(0) != 'S') {
            return null;
        }
        int dash = tail.indexOf('-');
        if (dash <= 1) {
            return null;
        }
        return new String[] {tail.substring(1, dash), tail.substring(dash + 1)};
    }

    /** 赛季号（不是实例 / 号码不是数字 ⇒ 0）。 */
    public static int seasonOf(String id) {
        String[] p = parts(id);
        if (p == null) {
            return 0;
        }
        try {
            return Math.max(0, Integer.parseInt(p[0].trim()));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** 规模下标（0 small / 1 medium / 2 large）；不是实例或规模不认识 ⇒ -1。 */
    public static int sizeIndex(String id) {
        String[] p = parts(id);
        return p == null ? -1 : SIZES.indexOf(p[1]);
    }

    /**
     * **合法实例 id 的唯一判据**（"能不能认出这个称号"一律走它）：
     * 模板必须在 {@link #TEMPLATES} 里 ＋ 赛季号必须是 ≥1 的数字 ＋ 规模必须在 {@link #SIZES} 里。
     *
     * <p>这是"不许乱生成"的闸门：手写一条未来赛季的实例（{@code league_champ@S99-large}）
     * 会被它挡在授予之前 ✓（`docs/39` §5.3⑦ 的那条断言就是守这里）。
     */
    public static boolean validInstance(String id) {
        return template(templateIdOf(id)) != null && seasonOf(id) > 0 && sizeIndex(id) >= 0;
    }

    /** 拼一个实例 id（**授予 / 购买两处都走它**，别各拼一遍）。 */
    public static String instanceId(String template, int season, String size) {
        return template + INSTANCE_SEP + "S" + season + "-" + size;
    }

    /** 品质：静态走 {@link #ALL}，实例走"模板 × 规模"（颜色只有这一处来源）。 */
    public static int qualityOf(String id) {
        Def d = byId(id);
        if (d != null) {
            return d.quality();
        }
        Template t = template(templateIdOf(id));
        int si = sizeIndex(id);
        return (t == null || si < 0) ? 0 : t.q()[si];
    }

    /**
     * 名字是否合规（长度 + 身份后缀/引用白名单 + 黑名单）。
     *
     * <p>这是**代码侧的同一条判据**：检查器用它逐条验语言文件里的中文名，
     * 实现里也用它挡住"以后手写一个不按规则的名字"。返回 null = 合规，否则是原因。
     */
    public static String nameProblem(String cn) {
        if (cn == null || cn.isEmpty()) {
            return "名字为空";
        }
        int len = cn.codePointCount(0, cn.length());
        if (len < NAME_MIN_CHARS || len > NAME_MAX_CHARS) {
            return "长度 " + len + " 不在 " + NAME_MIN_CHARS + "~" + NAME_MAX_CHARS + " 字之间";
        }
        for (String w : BANNED_WORDS) {
            if (cn.contains(w)) {
                return "命中奇幻词黑名单：" + w;
            }
        }
        boolean tail = false;
        for (String t : NAME_TAILS) {
            if (cn.endsWith(t)) {
                tail = true;
                break;
            }
        }
        if (tail || EXPLAINED_NAMES.contains(cn)) {
            return null;
        }
        return "既不是身份词结尾（" + NAME_TAILS + "），也不在引用短语白名单里 —— "
                + "光秃秃一个名词别人不知道在说什么";
    }
}
