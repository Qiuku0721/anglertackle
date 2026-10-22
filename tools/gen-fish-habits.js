/*
 * gen-fish-habits.js —— 从 tools/fish-habits.json 生成 FishHabits.java。
 *
 * 为什么要有生成器，而不是直接在 Java 里手写一张表：
 *   词条要同时被**三方**用到 —— 鱼池权重（Java）、图鉴显示（Java/客户端）、语言文件（json），
 *   手写就是三份真相，改一处忘一处，而"忘记"的表现是**权重悄悄不对**，没有任何报错。
 *   所以：json 是唯一真相 → 生成 Java；语言文件由 check-fish-habits.js 逐条比对 json。
 *
 * 生成文件里**没有任何需要手改的东西**：check-fish-habits.js 会把磁盘上的
 * FishHabits.java 与 render() 的输出**逐字节**比对，手改必红。
 *
 * 用法：
 *   node tools/gen-fish-habits.js            # 只预览（打印统计，不写盘）
 *   node tools/gen-fish-habits.js --write    # 写入 FishHabits.java
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const SRC = path.join(ROOT, 'tools', 'fish-habits.json');
const OUT = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishHabits.java');

const readData = () => JSON.parse(fs.readFileSync(SRC, 'utf8'));

/** 词条 id → 位序号（就是 habits 数组的下标），**顺序即位的顺序，不许重排**。 */
function bitOf(data, id) {
  const i = data.habits.findIndex((h) => h.id === id);
  if (i < 0) throw new Error('词条 ' + id + ' 不在 habits 表里');
  return i;
}

function maskOf(data, list) {
  let m = 0;
  for (const id of list) m |= 1 << bitOf(data, id);
  return m;
}

// ---------------------------------------------------------------- 环境条件（docs/24）
// fish 里每条鱼现在是 { habits, time, weather, moon }。
// 这三个字段**必须显式写全**：忘了写要在这里就报错，而不是静默变成"全天鱼"
// （那会让"某条鱼本该只在夜里出"悄悄失效，而且没有任何报错）。check-environment.js 也守这条。
const TIME_BITS = { dawn: 0, day: 1, dusk: 2, night: 3 };
const WEATHER_BITS = { clear: 0, rain: 1 };
const MOON_KINDS = { any: 0, full: 1, new: 2 };

/** 鱼的词条数组（兼容旧格式：值直接是数组）。 */
function habitsOfFish(v) {
  return Array.isArray(v) ? v : v.habits;
}

function timeMaskOfFish(id, v) {
  if (Array.isArray(v)) throw new Error(id + '：还在用旧格式（值直接是词条数组），缺少 time/weather/moon');
  if (!Array.isArray(v.time) || v.time.length === 0) throw new Error(id + '：time 缺失或为空');
  // time: ["all"] 表示"四个时段都算命中" —— 给满掩码。
  // ⚠ 命中 ≠ 一定吃到加成：加多少由池子求解器算（组占比已经很高时增量自然很小）。
  let m = 0;
  for (const t of v.time) {
    if (t === 'all') return 0b1111;
    if (!(t in TIME_BITS)) throw new Error(id + '：time 里有不认识的取值 ' + t);
    m |= 1 << TIME_BITS[t];
  }
  return m;
}

function weatherMaskOfFish(id, v) {
  if (!Array.isArray(v.weather) || v.weather.length === 0) throw new Error(id + '：weather 缺失或为空');
  // weather: ["all"] 表示"所有天气都算命中" —— 直接给满掩码（clear + rain）
  let m = 0;
  for (const w of v.weather) {
    if (w === 'all') return (1 << WEATHER_BITS.clear) | (1 << WEATHER_BITS.rain);
    if (!(w in WEATHER_BITS)) throw new Error(id + '：weather 里有不认识的取值 ' + w);
    m |= 1 << WEATHER_BITS[w];
  }
  return m;
}

function moonOfFish(id, v) {
  const k = v.moon;
  if (!(k in MOON_KINDS)) throw new Error(id + '：moon 缺失或不认识（应为 any / full / new）');
  return MOON_KINDS[k];
}

/** time 数组 → 给人看的短名（生成物注释里用）。 */
const timeNames = (v) => v.time.map((t) => ({ all: '全天', dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜晚' })[t]).join('+');
const weatherNames = (v) => v.weather.map((w) => ({ all: '全天气', clear: '晴', rain: '雨' })[w]).join('+');

/** 生成 FishHabits.java 的完整文本（检查器也用这个函数比对，保证只有一份真相）。 */
function render(data) {
  const habits = data.habits;
  const enumNames = habits.map((h) => h.id.toUpperCase());

  const L = [];
  L.push('package com.whitecobalt.anglertackle.fishing;');
  L.push('');
  L.push('/*');
  L.push(' * ⚠ 本文件由 tools/gen-fish-habits.js 从 tools/fish-habits.json **生成**，不要手改。');
  L.push(' *   要改词条 / 改鱼的落点：改那个 json，然后跑');
  L.push(' *     node tools/gen-fish-habits.js --write');
  L.push(' *   tools/check-fish-habits.js 会把本文件与生成器的输出逐字节比对，手改必红。');
  L.push(' *');
  L.push(' * 依据与判定口径见 参考资料/鱼习性词条调研.md。');
  L.push(' */');
  L.push('public final class FishHabits {');
  L.push('');
  L.push('    private FishHabits() {');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 习性词条。');
  L.push('     *');
  L.push('     * <p>{@link #id()} 是 ASCII 的数据键（存档/配置/生成器都用它），');
  L.push('     * 玩家看到的名字在语言文件 {@code habit.anglertackle.<id>} 里 ——');
  L.push('     * 代码里**不许**出现硬编码的中文名，否则换语言就露馅。');
  L.push('     */');
  L.push('    public enum Habit {');
  habits.forEach((h, i) => {
    L.push('        /** ' + h.zh + ' */');
    L.push('        ' + h.id.toUpperCase() + '("' + h.id + '")' + (i === habits.length - 1 ? ';' : ','));
  });
  L.push('');
  L.push('        private final String id;');
  L.push('');
  L.push('        Habit(String id) {');
  L.push('            this.id = id;');
  L.push('        }');
  L.push('');
  L.push('        public String id() {');
  L.push('            return this.id;');
  L.push('        }');
  L.push('');
  L.push('        /** 语言键：{@code habit.anglertackle.deep} 之类。 */');
  L.push('        public String langKey() {');
  L.push('            return "habit.anglertackle." + this.id;');
  L.push('        }');
  L.push('    }');
  L.push('');
  L.push('    /** 命中词条时鱼种权重的百分比：×1.10（用户定案，**不叠加**）。 */');
  L.push('    public static final int BONUS_PERCENT = 110;');
  L.push('');
  L.push('    private static final java.util.Map<String, Integer> FISH = new java.util.HashMap<>();');
  L.push('    private static final java.util.Map<String, Integer> LURES = new java.util.HashMap<>();');
  L.push('');
  L.push('    // ---- 环境条件（docs/24-时间天气月相策划.md §8，用户 2026-10-02 定案）----');
  L.push('    // timeMask    ：bit0 清晨 bit1 白天 bit2 黄昏 bit3 夜晚；0b1111 = 全天');
  L.push('    // weatherMask ：bit0 晴朗 bit1 降雨（雷暴按降雨命中，见 Environment.matchesWeather）');
  L.push('    // moonKind    ：0 = any（不吃月相加成）、1 = full、2 = new');
  L.push('    private static final java.util.Map<String, Integer> FISH_TIME = new java.util.HashMap<>();');
  L.push('    private static final java.util.Map<String, Integer> FISH_WEATHER = new java.util.HashMap<>();');
  L.push('    private static final java.util.Map<String, Integer> FISH_MOON = new java.util.HashMap<>();');
  L.push('');
  L.push('    static {');
  for (const [fish, v] of Object.entries(data.fish)) {
    const list = habitsOfFish(v);
    L.push('        FISH.put("' + fish + '", ' + maskOf(data, list) +
      ');   // ' + list.join(' + '));
  }
  L.push('');
  for (const [lure, list] of Object.entries(data.lures)) {
    L.push('        LURES.put("' + lure + '", ' + maskOf(data, list) +
      ');   // ' + list.join(' + '));
  }
  L.push('');
  for (const [fish, v] of Object.entries(data.fish)) {
    L.push('        FISH_TIME.put("' + fish + '", 0b' + timeMaskOfFish(fish, v).toString(2).padStart(4, '0')
      + ');   // ' + timeNames(v)
      + '   天气 ' + weatherNames(v) + '   月相 ' + v.moon);
  }
  L.push('');
  for (const [fish, v] of Object.entries(data.fish)) {
    L.push('        FISH_WEATHER.put("' + fish + '", ' + weatherMaskOfFish(fish, v) + ');');
  }
  L.push('');
  for (const [fish, v] of Object.entries(data.fish)) {
    L.push('        FISH_MOON.put("' + fish + '", ' + moonOfFish(fish, v) + ');');
  }
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 这条鱼有哪些词条（按枚举顺序）。');
  L.push('     *');
  L.push('     * <p>未知 id 返回空表 —— **不抛异常**：这是运行期代码，宁可少给一次加成，');
  L.push('     * 也不能因为一条数据缺失让玩家在游戏里崩掉。缺项由');
  L.push('     * {@code tools/check-fish-habits.js} 在构建期拦住。');
  L.push('     */');
  L.push('    public static java.util.List<Habit> habitsOf(String fishId) {');
  L.push('        return habitsOfMask(maskOf(fishId));');
  L.push('    }');
  L.push('');
  L.push('    /** 掩码 → 词条列表（按枚举顺序）。界面/提示文字用它拼中文名。 */');
  L.push('    public static java.util.List<Habit> habitsOfMask(int mask) {');
  L.push('        java.util.List<Habit> out = new java.util.ArrayList<>();');
  L.push('        for (Habit h : Habit.values()) {');
  L.push('            if ((mask & (1 << h.ordinal())) != 0) {');
  L.push('                out.add(h);');
  L.push('            }');
  L.push('        }');
  L.push('        return out;');
  L.push('    }');
  L.push('');
  L.push('    /** 这条鱼的词条位掩码（未知 id → 0）。 */');
  L.push('    public static int maskOf(String fishId) {');
  L.push('        Integer m = FISH.get(fishId);');
  L.push('        return m == null ? 0 : m;');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 这条鱼的时段掩码；未知 id → 0（= 一个时段都不匹配，因此**不进时段加成组**）。');
  L.push('     *');
  L.push('     * <p>注意语义：{@code 0b1111}（全天）表示"任何时段都<u>命中</u>"，');
  L.push('     * 但"命中"只是说它在加成组里，**加多少由池子求解器算**（见 docs/24 §4.1）。');
  L.push('     * 全天鱼常常因为组占比已经很高而吃不到多少 —— 那是设计意图，不是 bug。');
  L.push('     */');
  L.push('    public static int timeMaskOf(String fishId) {');
  L.push('        Integer m = FISH_TIME.get(fishId);');
  L.push('        return m == null ? 0 : m;');
  L.push('    }');
  L.push('');
  L.push('    /** 这条鱼的天气掩码（bit0 晴 / bit1 雨）；未知 id → 0。 */');
  L.push('    public static int weatherMaskOf(String fishId) {');
  L.push('        Integer m = FISH_WEATHER.get(fishId);');
  L.push('        return m == null ? 0 : m;');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 这条鱼的月相要求：0 = any、1 = full、2 = new；未知 id → 0。');
  L.push('     *');
  L.push('     * <p>与时段/天气不同：月相加成**只给白名单鱼**（只有声明了 full / new 的鱼才吃），');
  L.push('     * 而且预算按"所有金红鱼 / 所有紫鱼一起分"来算（用户定案 +5 / +15 个百分点）。');
  L.push('     */');
  L.push('    public static int moonOf(String fishId) {');
  L.push('        Integer m = FISH_MOON.get(fishId);');
  L.push('        return m == null ? 0 : m;');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 这个拟饵认哪些词条（未知 id → 0 = 不认任何词条）。');
  L.push('     *');
  L.push('     * <p>调试拟饵 {@code lure_test_red} **故意不在表里**：它是"必出红鱼"的基准，');
  L.push('     * 加词条只会让对照变浑（见 tools/fish-habits.json 的 _lures_no_habit）。');
  L.push('     */');
  L.push('    public static int lureMask(String lureItemId) {');
  L.push('        if (lureItemId == null || lureItemId.isEmpty()) {');
  L.push('            return 0;');
  L.push('        }');
  L.push('        Integer m = LURES.get(stripNamespace(lureItemId));');
  L.push('        return m == null ? 0 : m;');
  L.push('    }');
  L.push('');
  L.push('    /** 物品 id 可能是 {@code anglertackle:lure_spoon} 这种带命名空间的写法。 */');
  L.push('    private static String stripNamespace(String id) {');
  L.push('        int i = id.indexOf(\':\');');
  L.push('        return i < 0 ? id : id.substring(i + 1);');
  L.push('    }');
  L.push('');
  L.push('    /** 这个拟饵认的词条里，有没有这条鱼命中的。 */');
  L.push('    public static boolean matches(int lureMask, String fishId) {');
  L.push('        return lureMask != 0 && (lureMask & maskOf(fishId)) != 0;');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 把掩码写成给人看的 id 列表（日志用），例如 {@code aggressive+timid}。');
  L.push('     *');
  L.push('     * <p>日志里刻意用 ASCII 的 id 而不是中文名：日志是给排查问题的人看的，');
  L.push('     * 中文名会随语言文件变，id 永远稳定。玩家的界面走 {@link Habit#langKey()}。');
  L.push('     */');
  L.push('    public static String describe(int mask) {');
  L.push('        java.util.List<String> ids = new java.util.ArrayList<>();');
  L.push('        for (Habit h : Habit.values()) {');
  L.push('            if ((mask & (1 << h.ordinal())) != 0) {');
  L.push('                ids.add(h.id());');
  L.push('            }');
  L.push('        }');
  L.push('        return ids.isEmpty() ? "（无）" : String.join("+", ids);');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 命中词条时的权重加成：**整数 ×1.10，并保证至少 +1**。');
  L.push('     *');
  L.push('     * <p>为什么必须显式保证 +1：鱼池权重是**整数**，而最小的档位权重就是 3。');
  L.push('     * {@code 3 * 110 / 100 == 3} —— 光写乘法，权重 3 的那批鱼会**一点加成都没有**，');
  L.push('     * 而"看起来"代码是对的。这条下限就是为它写的。');
  L.push('     *');
  L.push('     * @param weight   原始权重（必须 ≥ 1）');
  L.push('     * @param lureMask 拟饵认的词条掩码（0 = 没有拟饵/不认词条 → 原样返回）');
  L.push('     * @param fishId   鱼种 id');
  L.push('     */');
  L.push('    public static int applyBonus(int weight, int lureMask, String fishId) {');
  L.push('        if (!matches(lureMask, fishId)) {');
  L.push('            return weight;');
  L.push('        }');
  L.push('        return Math.max(weight + 1, weight * BONUS_PERCENT / 100);');
  L.push('    }');
  L.push('');
  L.push('    /**');
  L.push('     * 带【精准猎获】额外百分点的版本（用户 2026-10-02 的附魔）。');
  L.push('     *');
  L.push('     * <p>用户原话："每级使得鱼饵的上鱼类型权重（**不影响稀有度的那种**）');
  L.push('     * 额外提升 2%（**加算**）" —— 所以是把百分点**加到 {@link #BONUS_PERCENT} 上**');
  L.push('     * （110 → 110+2·等级），不是乘倍率。稀有度那条走 FishingSession 的 hvPct，与这里无关。');
  L.push('     *');
  L.push('     * <p>加算的好处是可预测：满级 120%，权重 3 的小鱼仍靠 +1 下限吃到加成；');
  L.push('     * 乘法越叠越陡才会把池子推向"某一类鱼通吃"。守着它的是 tools/check-enchantments.js。');
  L.push('     *');
  L.push('     * @param extraPercent 额外百分点（0 = 与加附魔之前完全一致）');
  L.push('     */');
  L.push('    public static int applyBonus(int weight, int lureMask, String fishId, int extraPercent) {');
  L.push('        if (extraPercent <= 0) {');
  L.push('            return applyBonus(weight, lureMask, fishId);   // 0 = 与没附魔时逐字节同行为');
  L.push('        }');
  L.push('        if (!matches(lureMask, fishId)) {');
  L.push('            return weight;');
  L.push('        }');
  L.push('        return Math.max(weight + 1, weight * (BONUS_PERCENT + extraPercent) / 100);');
  L.push('    }');
  L.push('}');
  L.push('');
  return L.join('\n');
}

module.exports = { render, readData, SRC, OUT };

if (require.main === module) {
  const data = readData();
  const text = render(data);
  const fishCount = Object.keys(data.fish).length;
  const lureCount = Object.keys(data.lures).length;

  console.log('词条 ' + data.habits.length + ' 个：' +
    data.habits.map((h) => h.id + '(' + h.zh + ')').join(' '));
  for (const h of data.habits) {
    const list = Object.entries(data.fish).filter(([, v]) => habitsOfFish(v).includes(h.id)).map(([k]) => k);
    console.log('  ' + h.id.padEnd(12) + list.length + ' 条鱼：' + list.join(' '));
  }
  const blank = Object.entries(data.fish).filter(([, v]) => !habitsOfFish(v).length).map(([k]) => k);
  if (blank.length) throw new Error('有鱼没有任何词条：' + blank.join(', '));
  console.log('鱼 ' + fishCount + ' 条（每条至少 1 个词条）、拟饵 ' + lureCount + ' 个');

  // 环境条件统计：三个字段必须齐（render 里已经会抛错，这里只是把结果打出来）
  const perTime = { 清晨: 0, 白天: 0, 黄昏: 0, 夜晚: 0, 全天: 0 };
  let rainCount = 0, moonCount = 0;
  for (const [id, v] of Object.entries(data.fish)) {
    const m = timeMaskOfFish(id, v);
    for (let b = 0; b < 4; b++) if (m & (1 << b)) perTime[['清晨', '白天', '黄昏', '夜晚'][b]]++;
    if (v.time.includes('all')) perTime.全天++;
    if (v.weather.includes('rain')) rainCount++;
    if (v.moon !== 'any') moonCount++;
  }
  console.log('环境条件：' + Object.entries(perTime).map(([k, n]) => k + ' ' + n).join(' · ')
    + '；雨天 ' + rainCount + ' 条、月相白名单 ' + moonCount + ' 条');
  console.log('  （"全天"是单列的：全天鱼任何时段都命中，但组占比高时吃到的增量很小）');

  if (process.argv.includes('--write')) {
    fs.writeFileSync(OUT, text, 'utf8');
    console.log('✅ 已写出 ' + path.relative(ROOT, OUT).replace(/\\/g, '/') +
      '（' + Buffer.byteLength(text, 'utf8') + ' 字节）');
  } else {
    console.log('\n（加 --write 才会写入）');
  }
}
