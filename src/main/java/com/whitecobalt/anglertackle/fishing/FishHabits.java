package com.whitecobalt.anglertackle.fishing;

/*
 * ⚠ 本文件由 tools/gen-fish-habits.js 从 tools/fish-habits.json **生成**，不要手改。
 *   要改词条 / 改鱼的落点：改那个 json，然后跑
 *     node tools/gen-fish-habits.js --write
 *   tools/check-fish-habits.js 会把本文件与生成器的输出逐字节比对，手改必红。
 *
 * 依据与判定口径见 参考资料/鱼习性词条调研.md。
 */
public final class FishHabits {

    private FishHabits() {
    }

    /**
     * 习性词条。
     *
     * <p>{@link #id()} 是 ASCII 的数据键（存档/配置/生成器都用它），
     * 玩家看到的名字在语言文件 {@code habit.anglertackle.<id>} 里 ——
     * 代码里**不许**出现硬编码的中文名，否则换语言就露馅。
     */
    public enum Habit {
        /** 深水 */
        DEEP("deep"),
        /** 领地意识强 */
        TERRITORIAL("territorial"),
        /** 性情凶猛 */
        AGGRESSIVE("aggressive"),
        /** 表层觅食 */
        SURFACE("surface"),
        /** 贴底觅食 */
        BOTTOM("bottom"),
        /** 胆小多疑 */
        TIMID("timid");

        private final String id;

        Habit(String id) {
            this.id = id;
        }

        public String id() {
            return this.id;
        }

        /** 语言键：{@code habit.anglertackle.deep} 之类。 */
        public String langKey() {
            return "habit.anglertackle." + this.id;
        }
    }

    /** 命中词条时鱼种权重的百分比：×1.10（用户定案，**不叠加**）。 */
    public static final int BONUS_PERCENT = 110;

    private static final java.util.Map<String, Integer> FISH = new java.util.HashMap<>();
    private static final java.util.Map<String, Integer> LURES = new java.util.HashMap<>();

    // ---- 环境条件（docs/24-时间天气月相策划.md §8，用户 2026-10-02 定案）----
    // timeMask    ：bit0 清晨 bit1 白天 bit2 黄昏 bit3 夜晚；0b1111 = 全天
    // weatherMask ：bit0 晴朗 bit1 降雨（雷暴按降雨命中，见 Environment.matchesWeather）
    // moonKind    ：0 = any（不吃月相加成）、1 = full、2 = new
    private static final java.util.Map<String, Integer> FISH_TIME = new java.util.HashMap<>();
    private static final java.util.Map<String, Integer> FISH_WEATHER = new java.util.HashMap<>();
    private static final java.util.Map<String, Integer> FISH_MOON = new java.util.HashMap<>();

    static {
        FISH.put("tilapia", 50);   // territorial + bottom + timid
        FISH.put("african_butterflyfish", 40);   // surface + timid
        FISH.put("crucian_carp", 16);   // bottom
        FISH.put("mirror_carp", 16);   // bottom
        FISH.put("jewel_cichlid", 6);   // territorial + aggressive
        FISH.put("mullet", 48);   // bottom + timid
        FISH.put("zander", 39);   // deep + territorial + aggressive + timid
        FISH.put("atlantic_salmon", 5);   // deep + aggressive
        FISH.put("bluefin_tuna", 4);   // aggressive
        FISH.put("brown_trout", 6);   // territorial + aggressive
        FISH.put("arctic_char", 3);   // territorial + deep
        FISH.put("whitefish", 32);   // timid
        FISH.put("rainbow_trout", 6);   // territorial + aggressive
        FISH.put("burbot", 20);   // bottom + aggressive
        FISH.put("taimen", 6);   // territorial + aggressive
        FISH.put("arctic_cod", 32);   // timid
        FISH.put("capelin", 32);   // timid
        FISH.put("atlantic_herring", 32);   // timid
        FISH.put("wolffish", 20);   // bottom + aggressive
        FISH.put("redfish", 17);   // deep + bottom
        FISH.put("sablefish", 17);   // deep + bottom
        FISH.put("atlantic_cod", 20);   // bottom + aggressive
        FISH.put("greenland_halibut", 5);   // deep + aggressive
        FISH.put("greenland_shark", 21);   // deep + bottom + aggressive
        FISH.put("sailfish", 12);   // aggressive + surface
        FISH.put("mahi_mahi", 12);   // aggressive + surface
        FISH.put("alligator_gar", 20);   // bottom + aggressive
        FISH.put("giant_siamese_carp", 33);   // timid + deep
        FISH.put("electric_eel", 20);   // bottom + aggressive
        FISH.put("tigerfish", 4);   // aggressive
        FISH.put("topmouth_culter", 44);   // aggressive + surface + timid
        FISH.put("hemiculter", 40);   // surface + timid
        FISH.put("striped_bass", 5);   // deep + aggressive
        FISH.put("platinum_arowana", 12);   // aggressive + surface
        FISH.put("oxeye_tarpon", 4);   // aggressive
        FISH.put("banded_loach", 48);   // bottom + timid
        FISH.put("guppy", 40);   // surface + timid
        FISH.put("elephantnose", 50);   // territorial + bottom + timid
        FISH.put("grass_carp", 8);   // surface
        FISH.put("black_carp", 17);   // deep + bottom
        FISH.put("pike", 4);   // aggressive
        FISH.put("arapaima", 14);   // territorial + aggressive + surface
        FISH.put("north_african_catfish", 20);   // aggressive + bottom
        FISH.put("sapphire_snakehead", 6);   // territorial + aggressive
        FISH.put("juvenile_shark", 4);   // aggressive
        FISH.put("golden_loach", 48);   // bottom + timid
        FISH.put("cave_blindfish", 49);   // deep + bottom + timid

        LURES.put("lure_spoon", 4);   // aggressive
        LURES.put("lure_glowspoon", 32);   // timid
        LURES.put("lure_minnow", 12);   // aggressive + surface
        LURES.put("lure_soft", 20);   // aggressive + bottom
        LURES.put("lure_depthfinder", 17);   // deep + bottom
        LURES.put("lure_deep", 12);   // surface + aggressive
        LURES.put("lure_vibration", 17);   // deep + bottom
        LURES.put("lure_paddletail", 7);   // deep + territorial + aggressive
        LURES.put("lure_rattle", 6);   // territorial + aggressive
        LURES.put("lure_gilded", 7);   // deep + territorial + aggressive

        FISH_TIME.put("tilapia", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("african_butterflyfish", 0b0010);   // 白天   天气 晴   月相 any
        FISH_TIME.put("crucian_carp", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("mirror_carp", 0b1111);   // 全天   天气 全天气   月相 full
        FISH_TIME.put("jewel_cichlid", 0b0010);   // 白天   天气 晴   月相 any
        FISH_TIME.put("mullet", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("zander", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("atlantic_salmon", 0b0011);   // 清晨+白天   天气 全天气   月相 any
        FISH_TIME.put("bluefin_tuna", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("brown_trout", 0b0001);   // 清晨   天气 晴   月相 any
        FISH_TIME.put("arctic_char", 0b0101);   // 清晨+黄昏   天气 全天气   月相 any
        FISH_TIME.put("whitefish", 0b0010);   // 白天   天气 晴   月相 any
        FISH_TIME.put("rainbow_trout", 0b0011);   // 清晨+白天   天气 全天气   月相 any
        FISH_TIME.put("burbot", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("taimen", 0b0101);   // 清晨+黄昏   天气 全天气   月相 any
        FISH_TIME.put("arctic_cod", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("capelin", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("atlantic_herring", 0b0100);   // 黄昏   天气 全天气   月相 any
        FISH_TIME.put("wolffish", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("redfish", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("sablefish", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("atlantic_cod", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("greenland_halibut", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("greenland_shark", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("sailfish", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("mahi_mahi", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("alligator_gar", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("giant_siamese_carp", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("electric_eel", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("tigerfish", 0b0010);   // 白天   天气 雨   月相 any
        FISH_TIME.put("topmouth_culter", 0b0101);   // 清晨+黄昏   天气 全天气   月相 any
        FISH_TIME.put("hemiculter", 0b0010);   // 白天   天气 晴   月相 any
        FISH_TIME.put("striped_bass", 0b1100);   // 黄昏+夜晚   天气 全天气   月相 any
        FISH_TIME.put("platinum_arowana", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("oxeye_tarpon", 0b1100);   // 黄昏+夜晚   天气 全天气   月相 any
        FISH_TIME.put("banded_loach", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("guppy", 0b1111);   // 全天   天气 全天气   月相 any
        FISH_TIME.put("elephantnose", 0b1000);   // 夜晚   天气 全天气   月相 any
        FISH_TIME.put("grass_carp", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("black_carp", 0b0010);   // 白天   天气 全天气   月相 any
        FISH_TIME.put("pike", 0b0101);   // 清晨+黄昏   天气 全天气   月相 any
        FISH_TIME.put("arapaima", 0b0001);   // 清晨   天气 全天气   月相 any
        FISH_TIME.put("north_african_catfish", 0b1000);   // 夜晚   天气 雨   月相 any
        FISH_TIME.put("sapphire_snakehead", 0b1100);   // 黄昏+夜晚   天气 雨   月相 any
        FISH_TIME.put("juvenile_shark", 0b0100);   // 黄昏   天气 全天气   月相 any
        FISH_TIME.put("golden_loach", 0b1000);   // 夜晚   天气 全天气   月相 new
        FISH_TIME.put("cave_blindfish", 0b1111);   // 全天   天气 全天气   月相 any

        FISH_WEATHER.put("tilapia", 3);
        FISH_WEATHER.put("african_butterflyfish", 1);
        FISH_WEATHER.put("crucian_carp", 3);
        FISH_WEATHER.put("mirror_carp", 3);
        FISH_WEATHER.put("jewel_cichlid", 1);
        FISH_WEATHER.put("mullet", 3);
        FISH_WEATHER.put("zander", 3);
        FISH_WEATHER.put("atlantic_salmon", 3);
        FISH_WEATHER.put("bluefin_tuna", 3);
        FISH_WEATHER.put("brown_trout", 1);
        FISH_WEATHER.put("arctic_char", 3);
        FISH_WEATHER.put("whitefish", 1);
        FISH_WEATHER.put("rainbow_trout", 3);
        FISH_WEATHER.put("burbot", 3);
        FISH_WEATHER.put("taimen", 3);
        FISH_WEATHER.put("arctic_cod", 3);
        FISH_WEATHER.put("capelin", 3);
        FISH_WEATHER.put("atlantic_herring", 3);
        FISH_WEATHER.put("wolffish", 3);
        FISH_WEATHER.put("redfish", 3);
        FISH_WEATHER.put("sablefish", 3);
        FISH_WEATHER.put("atlantic_cod", 3);
        FISH_WEATHER.put("greenland_halibut", 3);
        FISH_WEATHER.put("greenland_shark", 3);
        FISH_WEATHER.put("sailfish", 3);
        FISH_WEATHER.put("mahi_mahi", 3);
        FISH_WEATHER.put("alligator_gar", 3);
        FISH_WEATHER.put("giant_siamese_carp", 3);
        FISH_WEATHER.put("electric_eel", 3);
        FISH_WEATHER.put("tigerfish", 2);
        FISH_WEATHER.put("topmouth_culter", 3);
        FISH_WEATHER.put("hemiculter", 1);
        FISH_WEATHER.put("striped_bass", 3);
        FISH_WEATHER.put("platinum_arowana", 3);
        FISH_WEATHER.put("oxeye_tarpon", 3);
        FISH_WEATHER.put("banded_loach", 3);
        FISH_WEATHER.put("guppy", 3);
        FISH_WEATHER.put("elephantnose", 3);
        FISH_WEATHER.put("grass_carp", 3);
        FISH_WEATHER.put("black_carp", 3);
        FISH_WEATHER.put("pike", 3);
        FISH_WEATHER.put("arapaima", 3);
        FISH_WEATHER.put("north_african_catfish", 2);
        FISH_WEATHER.put("sapphire_snakehead", 2);
        FISH_WEATHER.put("juvenile_shark", 3);
        FISH_WEATHER.put("golden_loach", 3);
        FISH_WEATHER.put("cave_blindfish", 3);

        FISH_MOON.put("tilapia", 0);
        FISH_MOON.put("african_butterflyfish", 0);
        FISH_MOON.put("crucian_carp", 0);
        FISH_MOON.put("mirror_carp", 1);
        FISH_MOON.put("jewel_cichlid", 0);
        FISH_MOON.put("mullet", 0);
        FISH_MOON.put("zander", 0);
        FISH_MOON.put("atlantic_salmon", 0);
        FISH_MOON.put("bluefin_tuna", 0);
        FISH_MOON.put("brown_trout", 0);
        FISH_MOON.put("arctic_char", 0);
        FISH_MOON.put("whitefish", 0);
        FISH_MOON.put("rainbow_trout", 0);
        FISH_MOON.put("burbot", 0);
        FISH_MOON.put("taimen", 0);
        FISH_MOON.put("arctic_cod", 0);
        FISH_MOON.put("capelin", 0);
        FISH_MOON.put("atlantic_herring", 0);
        FISH_MOON.put("wolffish", 0);
        FISH_MOON.put("redfish", 0);
        FISH_MOON.put("sablefish", 0);
        FISH_MOON.put("atlantic_cod", 0);
        FISH_MOON.put("greenland_halibut", 0);
        FISH_MOON.put("greenland_shark", 0);
        FISH_MOON.put("sailfish", 0);
        FISH_MOON.put("mahi_mahi", 0);
        FISH_MOON.put("alligator_gar", 0);
        FISH_MOON.put("giant_siamese_carp", 0);
        FISH_MOON.put("electric_eel", 0);
        FISH_MOON.put("tigerfish", 0);
        FISH_MOON.put("topmouth_culter", 0);
        FISH_MOON.put("hemiculter", 0);
        FISH_MOON.put("striped_bass", 0);
        FISH_MOON.put("platinum_arowana", 0);
        FISH_MOON.put("oxeye_tarpon", 0);
        FISH_MOON.put("banded_loach", 0);
        FISH_MOON.put("guppy", 0);
        FISH_MOON.put("elephantnose", 0);
        FISH_MOON.put("grass_carp", 0);
        FISH_MOON.put("black_carp", 0);
        FISH_MOON.put("pike", 0);
        FISH_MOON.put("arapaima", 0);
        FISH_MOON.put("north_african_catfish", 0);
        FISH_MOON.put("sapphire_snakehead", 0);
        FISH_MOON.put("juvenile_shark", 0);
        FISH_MOON.put("golden_loach", 2);
        FISH_MOON.put("cave_blindfish", 0);
    }

    /**
     * 这条鱼有哪些词条（按枚举顺序）。
     *
     * <p>未知 id 返回空表 —— **不抛异常**：这是运行期代码，宁可少给一次加成，
     * 也不能因为一条数据缺失让玩家在游戏里崩掉。缺项由
     * {@code tools/check-fish-habits.js} 在构建期拦住。
     */
    public static java.util.List<Habit> habitsOf(String fishId) {
        return habitsOfMask(maskOf(fishId));
    }

    /** 掩码 → 词条列表（按枚举顺序）。界面/提示文字用它拼中文名。 */
    public static java.util.List<Habit> habitsOfMask(int mask) {
        java.util.List<Habit> out = new java.util.ArrayList<>();
        for (Habit h : Habit.values()) {
            if ((mask & (1 << h.ordinal())) != 0) {
                out.add(h);
            }
        }
        return out;
    }

    /** 这条鱼的词条位掩码（未知 id → 0）。 */
    public static int maskOf(String fishId) {
        Integer m = FISH.get(fishId);
        return m == null ? 0 : m;
    }

    /**
     * 这条鱼的时段掩码；未知 id → 0（= 一个时段都不匹配，因此**不进时段加成组**）。
     *
     * <p>注意语义：{@code 0b1111}（全天）表示"任何时段都<u>命中</u>"，
     * 但"命中"只是说它在加成组里，**加多少由池子求解器算**（见 docs/24 §4.1）。
     * 全天鱼常常因为组占比已经很高而吃不到多少 —— 那是设计意图，不是 bug。
     */
    public static int timeMaskOf(String fishId) {
        Integer m = FISH_TIME.get(fishId);
        return m == null ? 0 : m;
    }

    /** 这条鱼的天气掩码（bit0 晴 / bit1 雨）；未知 id → 0。 */
    public static int weatherMaskOf(String fishId) {
        Integer m = FISH_WEATHER.get(fishId);
        return m == null ? 0 : m;
    }

    /**
     * 这条鱼的月相要求：0 = any、1 = full、2 = new；未知 id → 0。
     *
     * <p>与时段/天气不同：月相加成**只给白名单鱼**（只有声明了 full / new 的鱼才吃），
     * 而且预算按"所有金红鱼 / 所有紫鱼一起分"来算（用户定案 +5 / +15 个百分点）。
     */
    public static int moonOf(String fishId) {
        Integer m = FISH_MOON.get(fishId);
        return m == null ? 0 : m;
    }

    /**
     * 这个拟饵认哪些词条（未知 id → 0 = 不认任何词条）。
     *
     * <p>调试拟饵 {@code lure_test_red} **故意不在表里**：它是"必出红鱼"的基准，
     * 加词条只会让对照变浑（见 tools/fish-habits.json 的 _lures_no_habit）。
     */
    public static int lureMask(String lureItemId) {
        if (lureItemId == null || lureItemId.isEmpty()) {
            return 0;
        }
        Integer m = LURES.get(stripNamespace(lureItemId));
        return m == null ? 0 : m;
    }

    /** 物品 id 可能是 {@code anglertackle:lure_spoon} 这种带命名空间的写法。 */
    private static String stripNamespace(String id) {
        int i = id.indexOf(':');
        return i < 0 ? id : id.substring(i + 1);
    }

    /** 这个拟饵认的词条里，有没有这条鱼命中的。 */
    public static boolean matches(int lureMask, String fishId) {
        return lureMask != 0 && (lureMask & maskOf(fishId)) != 0;
    }

    /**
     * 把掩码写成给人看的 id 列表（日志用），例如 {@code aggressive+timid}。
     *
     * <p>日志里刻意用 ASCII 的 id 而不是中文名：日志是给排查问题的人看的，
     * 中文名会随语言文件变，id 永远稳定。玩家的界面走 {@link Habit#langKey()}。
     */
    public static String describe(int mask) {
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (Habit h : Habit.values()) {
            if ((mask & (1 << h.ordinal())) != 0) {
                ids.add(h.id());
            }
        }
        return ids.isEmpty() ? "（无）" : String.join("+", ids);
    }

    /**
     * 命中词条时的权重加成：**整数 ×1.10，并保证至少 +1**。
     *
     * <p>为什么必须显式保证 +1：鱼池权重是**整数**，而最小的档位权重就是 3。
     * {@code 3 * 110 / 100 == 3} —— 光写乘法，权重 3 的那批鱼会**一点加成都没有**，
     * 而"看起来"代码是对的。这条下限就是为它写的。
     *
     * @param weight   原始权重（必须 ≥ 1）
     * @param lureMask 拟饵认的词条掩码（0 = 没有拟饵/不认词条 → 原样返回）
     * @param fishId   鱼种 id
     */
    public static int applyBonus(int weight, int lureMask, String fishId) {
        if (!matches(lureMask, fishId)) {
            return weight;
        }
        return Math.max(weight + 1, weight * BONUS_PERCENT / 100);
    }

    /**
     * 带【精准猎获】额外百分点的版本（用户 2026-10-02 的附魔）。
     *
     * <p>用户原话："每级使得鱼饵的上鱼类型权重（**不影响稀有度的那种**）
     * 额外提升 2%（**加算**）" —— 所以是把百分点**加到 {@link #BONUS_PERCENT} 上**
     * （110 → 110+2·等级），不是乘倍率。稀有度那条走 FishingSession 的 hvPct，与这里无关。
     *
     * <p>加算的好处是可预测：满级 120%，权重 3 的小鱼仍靠 +1 下限吃到加成；
     * 乘法越叠越陡才会把池子推向"某一类鱼通吃"。守着它的是 tools/check-enchantments.js。
     *
     * @param extraPercent 额外百分点（0 = 与加附魔之前完全一致）
     */
    public static int applyBonus(int weight, int lureMask, String fishId, int extraPercent) {
        if (extraPercent <= 0) {
            return applyBonus(weight, lureMask, fishId);   // 0 = 与没附魔时逐字节同行为
        }
        if (!matches(lureMask, fishId)) {
            return weight;
        }
        return Math.max(weight + 1, weight * (BONUS_PERCENT + extraPercent) / 100);
    }
}
