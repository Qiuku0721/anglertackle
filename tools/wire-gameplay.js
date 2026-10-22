// 把写死的玩法数值改成读配置（[gameplay] 组）。与 gen-gameplay-config.js 配对。
//
// ── 三条踩出来的规矩（都很贵，别再犯）────────────────────────
// ① 不能把常量定义改成 `static final double X = Tuning.x();`
//    static final 在类初始化时求值一次，那刻配置还没加载 → 启动即崩。
//    取值必须发生在**每次使用**时，所以逐处替换使用点。
//
// ② 替换 usage 时**必须先保护声明行**：全局替换会把
//    `private static final double X = 0.25;` 里的 X 一起换掉，
//    变成 `private static final double Tuning.x() = 0.25;` 这种语法垃圾，
//    而且之后再想删声明就找不到了（实测报"删不掉常量声明"）。
//
// ③ "把常量改成方法"这一条要**单独处理**：它的 from 就是声明行本身，
//    声明行被保护起来之后自然数不到 from —— 曾经因此报"找不到"，
//    而文件其实是好的，白折腾了两轮。所以这类条目走 declOnly 分支，不参与 usage 计数。
//
// 用法：node tools/wire-gameplay.js [--write]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');

/**
 * 每项：file / what / from / to
 *   constant  常量名 —— 声明行会被保护，替换 usage 后删除声明
 *   declOnly  true 表示 from 是**声明行**本身，只替换它
 *   expect    期望的引用数（对不上就报错，不猜）
 */
const EDITS = [
  // ================================================================ 鱼竿五材质
  ...[
    ['WOOD', 'wood', '2000', '8.0', '0.00', '1.00', '1.00', '1.00', '1.00', '1'],
    ['IRON', 'iron', '3500', '20.0', '0.10', '1.20', '1.20', '1.20', '0.85', '2'],
    ['GOLD', 'gold', '2500', '12.0', '0.25', '1.10', '1.15', '1.15', '0.90', '3'],
    ['DIAMOND', 'diamond', '5000', '40.0', '0.20', '1.60', '1.70', '1.60', '0.70', '4'],
    ['NETHERITE', 'netherite', '8000', '999.0', '0.30', '1.70', '1.90', '1.80', '0.50', '5'],
  ].map(([CONST, id, dur, wt, win, ceil, rec, drain, mat, tier]) => {
    const K = id.charAt(0).toUpperCase() + id.slice(1);
    return {
      file: 'item/RodItem.java',
      what: 'RodSpec.' + CONST,
      from: 'new RodSpec(' + [dur, wt, win, ceil, rec, drain, mat, tier].join(', ') + ')',
      // 耐久保持字面量：注册期由 NeoForge 固定，读配置会崩
      to: 'new RodSpec(' + dur +
          ', Tuning.rod' + K + 'MaxWeightKg(), Tuning.rod' + K + 'HookWindowBonus()' +
          ', Tuning.rod' + K + 'TensionCeiling(), Tuning.rod' + K + 'TensionRecover()' +
          ', Tuning.rod' + K + 'StaminaDrain(), Tuning.rod' + K + 'MaterialFactor()' +
          ', (int) Tuning.rod' + K + 'Tier())',
      note: '耐久留字面量（注册期冻结），其余 7 项走配置',
    };
  }),

  // ================================================================ FishingSession
  { file: 'fishing/FishingSession.java', what: 'PULL_SPRINT',
    from: 'this.sprinting ? PULL_SPRINT : Tuning.pullIdle()',
    to: 'this.sprinting ? Tuning.pullSprint() : Tuning.pullIdle()',
    constant: 'PULL_SPRINT', note: '冲刺拉拽基数' },
  { file: 'fishing/FishingSession.java', what: 'BASE_TENSION_CEILING',
    from: 'BASE_TENSION_CEILING', to: 'Tuning.tensionBaseCeiling()',
    constant: 'BASE_TENSION_CEILING', note: '张力上限基准' },
  { file: 'fishing/FishingSession.java', what: 'MIN_REEL_GAIN_RATIO',
    from: 'MIN_REEL_GAIN_RATIO', to: 'Tuning.minReelGainRatio()',
    constant: 'MIN_REEL_GAIN_RATIO', note: '收线涨势保底比例' },
  { file: 'fishing/FishingSession.java', what: 'MAX_FISH_SLOWDOWN',
    from: 'MAX_FISH_SLOWDOWN', to: 'Tuning.maxFishSlowdown()',
    constant: 'MAX_FISH_SLOWDOWN', note: '鱼拖慢收线上限' },
  { file: 'fishing/FishingSession.java', what: 'COUNTER_BONUS',
    from: 'COUNTER_BONUS', to: 'Tuning.counterBonus()', constant: 'COUNTER_BONUS', note: '反向控杆奖励' },
  { file: 'fishing/FishingSession.java', what: 'COUNTER_PENALTY',
    from: 'COUNTER_PENALTY', to: 'Tuning.counterPenalty()', constant: 'COUNTER_PENALTY', note: '同向控杆惩罚' },
  { file: 'fishing/FishingSession.java', what: 'DAMPING_TO_CAP_RATIO',
    from: 'DAMPING_TO_CAP_RATIO', to: 'Tuning.dampingToCapRatio()',
    constant: 'DAMPING_TO_CAP_RATIO', note: '阻尼折算比例' },
  { file: 'fishing/FishingSession.java', what: 'CAP_DAMPING_BONUS',
    from: 'CAP_DAMPING_BONUS', to: 'Tuning.capDampingBonus()',
    constant: 'CAP_DAMPING_BONUS', note: '阻尼对上限加成' },
  { file: 'fishing/FishingSession.java', what: 'TOTAL_DRAIN_TARGET',
    from: 'TOTAL_DRAIN_TARGET', to: 'Tuning.totalDrainTarget()',
    constant: 'TOTAL_DRAIN_TARGET', note: '拉干阈值' },
  { file: 'fishing/FishingSession.java', what: 'NEAR_SHORE_BASE',
    from: 'NEAR_SHORE_BASE', to: 'Tuning.nearShoreBase()', constant: 'NEAR_SHORE_BASE', note: '近岸基础距离' },
  { file: 'fishing/FishingSession.java', what: 'STAMINA_EPSILON_FLOOR',
    from: 'STAMINA_EPSILON_FLOOR', to: 'Tuning.staminaEpsilonFloor()',
    constant: 'STAMINA_EPSILON_FLOOR', note: '体力判定下限' },
  { file: 'fishing/FishingSession.java', what: 'STAMINA_EPSILON_RATIO',
    from: 'STAMINA_EPSILON_RATIO', to: 'Tuning.staminaEpsilonRatio()',
    constant: 'STAMINA_EPSILON_RATIO', note: '体力判定比例' },
  { file: 'fishing/FishingSession.java', what: 'INPUT_STALE_LIMIT',
    from: 'INPUT_STALE_LIMIT', to: 'Tuning.inputStaleLimit()',
    constant: 'INPUT_STALE_LIMIT', note: '输入超时上限' },

  // ================================================================ FishSpecies 档位曲面
  { file: 'fishing/FishSpecies.java', what: 'tierSpeed 底数',
    from: 'Math.pow(1.12, Math.max(0, Math.min(5, tier)))',
    to: 'Math.pow(Tuning.tierSpeedBase(), Math.max(0, Math.min(5, tier)))', note: '档位游速底数' },
  { file: 'fishing/FishSpecies.java', what: 'tierStaminaResist 底数',
    from: 'Math.pow(1.18, Math.max(0, Math.min(5, tier)))',
    to: 'Math.pow(Tuning.tierStaminaResistBase(), Math.max(0, Math.min(5, tier)))',
    note: '档位体力抗性底数' },
  { file: 'fishing/FishSpecies.java', what: 'struggleSeconds',
    from: 'return 2.0 + Math.max(0, Math.min(5, tier)) * 1.6;',
    to: 'return Tuning.struggleSecondsBase() + Math.max(0, Math.min(5, tier)) * Tuning.struggleSecondsPerTier();',
    note: '挣扎秒数 = 基准 + 档位 × 增量' },
  { file: 'fishing/FishSpecies.java', what: 'restSeconds',
    from: 'return 5.0 - Math.max(0, Math.min(5, tier)) * 0.4;',
    to: 'return Tuning.restSecondsBase() - Math.max(0, Math.min(5, tier)) * Tuning.restSecondsPerTier();',
    note: '休息秒数 = 基准 − 档位 × 递减' },

  // ================================================================ FightProfile
  //
  // ⚠️ 顺序不能反：**先把所有引用换完，最后才动声明行**。
  //    如果先把声明改成方法，后面"数引用"就永远对不上（声明已经不叫那个名字了）。
  //    踩过两次，都是这个顺序问题。
  //
  // ⚠️ from 必须写**精确表达式**，不能只写常量名：
  //    只写 'FATIGUE_PULL' 会连声明行一起换掉，变成
  //    `public static final double fatiguePull() = 0.5;` 这种语法垃圾。
  { file: 'fishing/FightProfile.java', what: 'FATIGUE_PULL 的 4 处引用',
    from: 'FATIGUE_PULL,', to: 'fatiguePull(),', expect: 4,
    note: 'steady/sluggish/burst/erratic 四个策略构造函数里的引用' },
  { file: 'fishing/FightProfile.java', what: 'FATIGUE_PULL 的 codec 默认值',
    from: '"pull_speed_fatigue", FATIGUE_PULL)',
    to: '"pull_speed_fatigue", fatiguePull())',
    expect: 1,
    note: 'Codec 默认值也要跟着走，否则读档值与运行时值不是同一个' },
  { file: 'fishing/FightProfile.java', what: 'FATIGUE_PULL 定义 → 方法',
    from: 'public static final double FATIGUE_PULL = 0.5;',
    to: '/** 疲劳期拉拽倍率（走配置）。\n' +
        '     *\n' +
        '     * <p>⚠ 不能写成 {@code static final double X = Tuning.x();}：\n' +
        '     * static final 在类初始化时求值一次，那刻配置还没加载，会启动即崩。\n' +
        '     * 所以改成方法，把取值推迟到每次使用。 */\n' +
        '    public static double fatiguePull() {\n' +
        '        return Tuning.fatiguePullMultiplier();\n' +
        '    }',
    declOnly: true, note: '常量 → 方法（from 是声明行本身，排在最后）' },
  // ================================================================ FishingManager / ChumEntity
  { file: 'fishing/FishingManager.java', what: 'FULL_CHARGE_TICKS',
    from: 'FULL_CHARGE_TICKS', to: 'Tuning.fullChargeTicks()',
    constant: 'FULL_CHARGE_TICKS', note: '蓄力满所需 tick' },
  { file: 'fishing/FishingManager.java', what: 'MIN_CHARGE_TICKS',
    from: 'MIN_CHARGE_TICKS', to: 'Tuning.minChargeTicks()',
    constant: 'MIN_CHARGE_TICKS', note: '最短蓄力 tick' },
  { file: 'entity/ChumEntity.java', what: 'MIN_AIR_TICKS',
    from: 'MIN_AIR_TICKS', to: 'Tuning.chumMinAirTicks()',
    constant: 'MIN_AIR_TICKS', note: '窝料最小滞空 tick' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let ok = 0, bad = 0;
const lines = [];

for (const e of EDITS) {
  const p = path.join(JAVA, e.file);
  let src = fs.readFileSync(p, 'utf8');

  // ---- declOnly：只替换声明行
  if (e.declOnly) {
    if (!src.includes(e.from)) {
      if (/public static double fatiguePull\(\)/.test(src)) {
        lines.push('  ⏭ ' + e.what + '（已是目标写法）'); ok++; continue;
      }
      console.error('  ❌ ' + e.what + '：找不到声明「' + e.from + '」');
      bad++;
      continue;
    }
    src = src.replace(e.from, () => e.to);
    lines.push('  ✔ ' + e.what.padEnd(24) + '         ' + (e.note || ''));
    if (WRITE) fs.writeFileSync(p, src, 'utf8');
    ok++;
    continue;
  }

  // ---- 常规：先保护声明行，再换 usage
  const placeholders = [];
  if (e.constant) {
    const declRe = new RegExp('^[ \\t]*(?:(?:private|public|protected)[ \\t]+)?static[ \\t]+final[ \\t]+' +
                              '(?:double|int|float)[ \\t]+' + e.constant + '[ \\t]*=[^;\\n]*;[^\\n]*$', 'm');
    const found = declRe.exec(src);
    if (found) {
      const ph = '/*__DECL_' + e.constant + '__*/';
      placeholders.push({ ph, text: found[0] });
      src = src.replace(declRe, () => ph);
    }
  }

  const n = src.split(e.from).length - 1;
  if (n === 0) {
    for (const { ph, text } of placeholders) src = src.replace(ph, () => text);
    if (src.includes(e.to)) { lines.push('  ⏭ ' + e.what + '（已是目标写法）'); ok++; continue; }
    console.error('  ❌ ' + e.what + '：找不到「' + e.from.slice(0, 70) + '」');
    bad++;
    continue;
  }
  if (e.expect !== undefined && n !== e.expect) {
    console.error('  ❌ ' + e.what + '：引用数 ' + n + '，预期 ' + e.expect + ' —— 不猜，先人工看');
    bad++;
    continue;
  }

  // ⚠️ 用替换函数：替换串里的 $ 序列会被 String.replace 展开（踩过一次）
  src = src.replace(new RegExp(esc(e.from), 'g'), () => e.to);
  for (const { ph, text } of placeholders) {
    src = src.replace(ph, () => (e.constant ? '' : text));
  }
  if (e.constant) {
    src = src.replace(new RegExp('\\{@link #' + e.constant + '\\}', 'g'), '配置项 ' + e.constant);
    src = src.replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n');
  }
  lines.push('  ✔ ' + e.what.padEnd(24) + ' ×' + n +
             (e.constant ? '   并删除常量声明' : '   ' + (e.note || '')));
  if (WRITE) fs.writeFileSync(p, src, 'utf8');
  ok++;
}

console.log('替换 ' + ok + ' 处，失败 ' + bad + ' 处');
lines.forEach((l) => console.log(l));
if (bad) { console.error('\n❌ 有 ' + bad + ' 处未完成'); process.exit(1); }
if (!WRITE) { console.log('\n（预览模式。加 --write 写入）'); process.exit(0); }
console.log('\n✅ 已写入');
