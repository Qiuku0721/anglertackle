package com.whitecobalt.anglertackle.fishing;

import net.minecraft.world.level.Level;

/**
 * 一次"此刻此地"的环境快照：时段 / 天气 / 月相。
 *
 * <p>见 {@code docs/24-时间天气月相策划.md}（v2 · 占比约束版）。三条硬约束是用户 2026-10-02 定案的：
 *
 * <ul>
 *   <li><b>C1 时间</b>：受时段加成的鱼在池子里的<b>归一化总占比最多 +10 个百分点</b>；</li>
 *   <li><b>C2 天气</b>：同上，{@code +10} 个百分点；</li>
 *   <li><b>C3 月相</b>：所有金红鱼分享 {@code +5} 个百分点的爆率预算，所有紫鱼分享 {@code +15} 个。</li>
 * </ul>
 *
 * <p><b>本类只负责"判定"，不负责"加权"。</b>加权（反解倍率）在
 * {@link FishSpecies} 的池子求解器里做 —— 因为倍率必须看整个池子的组成才能算出来
 * （用户给的两个算例：2 种鱼各 50% 一种加成 → 40/60；4 种各 25% 两种加成 → 20/20/30/30，
 * 反解出的 k 都是 1.5）。把加权放在这里会诱使人写出"固定倍率"那种错法。
 *
 * <p><b>为什么时段/天气/月相都是"纯函数 + 一次取样"：</b>
 * 四个判定函数都是纯函数（喂 tick / 布尔 / 相位，不碰世界），所以离线单测与检查器
 * 可以直接断言它们，不需要起一个服务端；而 {@link #now(ServerLevel)} 只在会话开始时
 * 调用一次，整段会话复用 —— 否则跨过时段边界时咬钩相关的判定会前后不一致。
 *
 * @param timeSlot  时段（{@link #DAWN} / {@link #DAY} / {@link #DUSK} / {@link #NIGHT}）
 * @param weather   天气（{@link #CLEAR} / {@link #RAIN} / {@link #THUNDER}）
 * @param moonPhase 月相（原版 0~7；0 = 满月、4 = 新月）
 */
public record Environment(int timeSlot, int weather, int moonPhase) {

    // ------------------------------------------------------------------ 时段
    /** 清晨（日出前后，约 2 分钟）。 */
    public static final int DAWN = 0;
    /** 白天（约 8.3 分钟）。 */
    public static final int DAY = 1;
    /** 黄昏（日落前后，约 2 分钟）。 */
    public static final int DUSK = 2;
    /** 夜晚（约 8.3 分钟）。 */
    public static final int NIGHT = 3;

    // ------------------------------------------------------------------ 天气
    /** 晴朗。 */
    public static final int CLEAR = 0;
    /** 降雨。 */
    public static final int RAIN = 1;
    /** 雷暴（比降雨更强；判定时必须**先**判它 —— 雷暴时 isRaining() 也是 true）。 */
    public static final int THUNDER = 2;

    // ------------------------------------------------------------------ 月相
    /** 原版月相 0 = 满月。 */
    public static final int MOON_FULL = 0;
    /** 原版月相 4 = 新月。 */
    public static final int MOON_NEW = 4;

    /** 一天的长度（原版刻度）。用 {@code getDayTime() % 24000} 取"当天时刻"。 */
    public static final long DAY_LENGTH = 24000L;

    // 边界（用户定案，见 docs/24 §6.1）：取"日出/日落前后"，玩家靠天色就能判断。
    private static final long DAWN_START = 23000L;   // 清晨：23000 → 1000
    private static final long DAY_START = 1000L;     // 白天：1000 → 11000
    private static final long DUSK_START = 11000L;   // 黄昏：11000 → 13000
    private static final long NIGHT_START = 13000L;  // 夜晚：13000 → 23000

    // ------------------------------------------------------------------ 取样

    /**
     * 取一次当前环境。
     *
     * <p><b>判定只在服务端做</b>：服务端用 {@link ServerLevel} 取一次、整段会话复用，
     * 决定抽签权重。客户端**不参与判定**，但可以调本方法读自己世界的天色来显示 ——
     * 两边读的是同一份 {@code getDayTime()} 与同一个天气标志，所以天然一致，不需要同步。
     *
     * <p>⚠ 服务端一段会话只取一次（见 {@code FishingSession.beginWaiting}）：
     * 每 tick 重算的话，跨过时段边界时同一竿的判定会变。
     */
    public static Environment now(Level level) {
        long dayTime = Math.floorMod(level.getDayTime(), DAY_LENGTH);
        // 雷暴必须先判：isThundering() 为真时 isRaining() 也是真。
        int w = level.isThundering() ? THUNDER : (level.isRaining() ? RAIN : CLEAR);
        return new Environment(slotOf(dayTime), w, level.getMoonPhase());
    }

    // ------------------------------------------------------------------ 纯函数（离线可测）

    /**
     * 当天时刻（tick）→ 时段。区间左闭右开，四个时段无缝覆盖 0~23999。
     *
     * <p>用 {@code Math.floorMod} 把负数与超过一天的 tick 都折进 [0, 24000)。
     */
    public static int slotOf(long dayTime) {
        long t = Math.floorMod(dayTime, DAY_LENGTH);
        if (t >= DAWN_START || t < DAY_START) return DAWN;
        if (t < DUSK_START) return DAY;
        if (t < NIGHT_START) return DUSK;
        return NIGHT;
    }

    /** 时段的文字名（日志与 HUD 用）。 */
    public static String slotName(int slot) {
        return switch (slot) {
            case DAWN -> "清晨";
            case DAY -> "白天";
            case DUSK -> "黄昏";
            case NIGHT -> "夜晚";
            default -> "未知";
        };
    }

    /** 天气的文字名。 */
    public static String weatherName(int weather) {
        return switch (weather) {
            case CLEAR -> "晴朗";
            case RAIN -> "降雨";
            case THUNDER -> "雷暴";
            default -> "未知";
        };
    }

    /** 月相的文字名。只有满月与新月有特殊含义，其余相位统一显示"平常"。 */
    public static String moonName(int moonPhase) {
        if (isFullMoon(moonPhase)) return "满月";
        if (isNewMoon(moonPhase)) return "新月";
        return "平常月相";
    }

    public static boolean isFullMoon(int moonPhase) {
        return Math.floorMod(moonPhase, 8) == MOON_FULL;
    }

    public static boolean isNewMoon(int moonPhase) {
        return Math.floorMod(moonPhase, 8) == MOON_NEW;
    }

    // ------------------------------------------------------------------ 与鱼比对

    /**
     * 这条鱼的时段掩码里，是否含当前时段。
     *
     * @param timeMask 鱼的时段掩码（bit0 清晨 / bit1 白天 / bit2 黄昏 / bit3 夜晚；
     *                 {@code 0b1111} = 全天）。见 {@link FishHabits#timeMaskOf(String)}
     */
    public boolean matchesTime(int timeMask) {
        return (timeMask & (1 << timeSlot)) != 0;
    }

    /**
     * 这条鱼的天气掩码里，是否含当前天气。
     *
     * <p>雷暴算作"降雨"命中：掩码里只有 RAIN 那一位，雷暴时也返回 true
     * （用户口径是"雷暴 = 更强烈的降雨"，不给鱼单独写一个雷暴位）。
     */
    public boolean matchesWeather(int weatherMask) {
        int bit = weather == THUNDER ? RAIN : weather;
        return (weatherMask & (1 << bit)) != 0;
    }

    /**
     * 这条鱼声明的月相要求，与当前月相是否相符。
     *
     * @param moonKind 0 = any、1 = full、2 = new（见 {@link FishHabits#moonOf(String)}）
     */
    public boolean matchesMoon(int moonKind) {
        return switch (moonKind) {
            case 1 -> isFullMoon(moonPhase);
            case 2 -> isNewMoon(moonPhase);
            default -> false;   // any：不吃月相加成（"加成组"里没有它）
        };
    }

    // ------------------------------------------------------------------ 展示

    /** HUD 与日志用的一行：如「夜晚 · 降雨 · 满月」。 */
    public String describe() {
        return slotName(timeSlot) + " · " + weatherName(weather) + " · " + moonName(moonPhase);
    }

    /** 调试用的紧凑串：如「night/rain/full」。 */
    public String debugToken() {
        String t = switch (timeSlot) {
            case DAWN -> "dawn";
            case DAY -> "day";
            case DUSK -> "dusk";
            default -> "night";
        };
        String w = switch (weather) {
            case CLEAR -> "clear";
            case RAIN -> "rain";
            default -> "thunder";
        };
        String m = isFullMoon(moonPhase) ? "full" : (isNewMoon(moonPhase) ? "new" : "mid" + moonPhase);
        return t + "/" + w + "/" + m;
    }
}
