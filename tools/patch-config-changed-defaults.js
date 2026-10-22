/*
 * patch-config-changed-defaults.js —— 把"**故意改过的默认值**"应用到已经存在的 toml。
 *
 * ── 为什么需要它 ────────────────────────────────────────────
 * NeoForge（正确地）**不会**用新的默认值覆盖已有配置文件 —— 玩家调过的值必须留着。
 * 副作用是：我们**主动**改平衡（比如用户说"金属杆承重上限改到 25"），
 * 老存档的 toml 里还是 20，游戏里也就一直是 20。
 * 用户 2026-10-02 就是看到铁竿 tooltip 还写着"承重上限：20 kg"才发现这件事的。
 *
 * 所以这里维护一张**改动表**：每个条目 = 哪个键、旧默认、新默认。
 * 只在这个键**仍然等于旧默认**时才改它 —— 也就是说"玩家没动过它"。
 * 玩家自己调过的值一律不碰（那才是他们的东西）。
 *
 * 用法：
 *   node tools/patch-config-changed-defaults.js                 # 预览
 *   node tools/patch-config-changed-defaults.js --write         # 写入（先备份）
 *   node tools/patch-config-changed-defaults.js <路径.toml>      # 指定文件
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const DEFAULT_CFG = 'D:\\mc\\PCL 正式版 2.13.1.1\\.minecraft\\versions\\' +
  '1.21.1-NeoForge_21.1.250\\config\\anglertackle-common.toml';
const cfgPath = process.argv.slice(2).find((a) => a.endsWith('.toml')) || DEFAULT_CFG;

/**
 * 改动表：`[键, 旧默认, 新默认, 为什么]`。
 *
 * ⚠ 只往里加"用户明确要求过的平衡改动"。不要用它去做批量重写 ——
 *   它存在的意义是"让已经存在的存档跟上一次**有意的**改动"。
 */
const CHANGES = [
  ['rodIronMaxWeightKg', '20', '25',
    '用户 2026-10-02："金属杆承重上限改到25"'],
  ['rodDiamondMaxWeightKg', '40', '50',
    '用户 2026-10-02："钻石杆承重上限改到50"'],
  // 下面三条是"代码里早就改了、而老 toml 还压着旧值"的遗留 ——
  // 2026-10-02 修好 check-live-config-matches-defaults.js 的默认值解析之后才暴露出来
  // （那个检查器的数值比对一直是空转的，见那边的注释）。
  ['compassSearchRadius', '400', '1200',
    'docs/13 明确记着"半径 400 根本不够…… 改成 1200 才覆盖得住"（400 是错的）'],
  ['lureRattleDurability', '18', '20',
    '拟饵耐久重排（check-gameplay-parity 登记的有意变更）：钢珠声诱 18 → 20'],
  ['lureGildedDurability', '14', '20',
    '拟饵耐久重排（check-gameplay-parity 登记的有意变更）：镀金竞技 14 → 20'],
  ['baitcastPullIdle', '1.9', '1.98',
    '用户定案："紫轮如果疲劳回拉少于1.9就加到1.98"'],
  // ── 2026-10-08 鱼竿：把用户 10/06 亲手调过、后来被一次配置重置冲掉的那套值烧进默认值 ──
  // 用户原话："我之前调参的时候把鱼竿一些数据改了但游戏里没改动比如承重比如品质上限"，
  // 并明确选择"全部照搬（含档位上限）"。⚠ 档位上限是 **1 起算**（1白…6红），
  // 上限 6 = 不限；所以木3=紫、铁4=金、金6=红（显示时钳到红）。
  ['rodWoodTier', '1', '3',
    '用户 2026-10-06 调参、10-08 定案：木竿档位上限 → 3（紫档）'],
  ['rodIronMaxWeightKg', '25', '30',
    '用户 2026-10-06 调参、10-08 定案：铁竿承重 → 30 kg'],
  ['rodIronTier', '2', '4',
    '用户 2026-10-06 调参、10-08 定案：铁竿档位上限 → 4（金档）'],
  ['rodGoldMaxWeightKg', '12', '21',
    '用户 2026-10-06 调参、10-08 定案：金竿承重 → 21 kg'],
  ['rodGoldTier', '3', '6',
    '用户 2026-10-06 调参、10-08 定案：金竿档位上限 → 6（不限，钳到红）'],
  // ── 2026-10-08 红鱼数值标定（36 条，由 build/_gen-changes.js 生成）──────────
  // 背景：这一轮把 8 条新红鱼的拉力/体力/张力按"现有红鱼类比"上调、又按用户方法论
  // （"回合数理应由张力与游速博弈共同设计，游不快的就改张力"）把 10 条软鱼的张力抬到
  // ≥4 回合；但**游戏读的是 toml 里的显式值** —— 不推过去，新数值永远不会生效，
  // 而且 `check-live-config-matches-defaults.js` 只会把它当成"玩家自己调过的值"（⚠ 不算失败）。
  // ⚠ 每条都只在"toml 现值 == 这里的旧默认"时才替换 —— 玩家真调过的值一律不碰。
  ['platinumArowanaTensionGain', '1.3', '1.95',
    '用户 2026-10-08 红鱼数值标定：回合数由"张力 × 游速"共同设计，游不快的抬高张力到 ≥4 回合'],
  ['tigerfishTensionGain', '1.5', '3.1',
    '用户 2026-10-08 红鱼数值标定：回合数由"张力 × 游速"共同设计，游不快的抬高张力到 ≥4 回合'],
  ['brownTroutTensionGain', '1.6', '2.65',
    '用户 2026-10-08 红鱼数值标定：回合数由"张力 × 游速"共同设计，游不快的抬高张力到 ≥4 回合'],
  ['mirrorCarpPullSpeed', '1.1', '2.4',
    '用户定案："镜鲤那就2.4游速起步"'],
  ['mirrorCarpFatiguedPullSpeed', '0.55', '1.2',
    '镜鲤拉力 1.10 → 2.40 的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['mirrorCarpTensionGain', '1.4', '2.8',
    '用户 2026-10-08：镜鲤光靠拉力只到 2 回合，按"游不快的改张力"补到 ≥4 回合'],
  ['arapaimaTensionGain', '1.75', '4',
    '用户 2026-10-08 红鱼数值标定：游不快的抬高张力到 ≥4 回合（巨骨舌鱼拉力 1.80）'],
  ['rainbowTroutPullSpeed', '2.1', '2.65',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['rainbowTroutFatiguedPullSpeed', '1.05', '1.325',
    '虹鳟拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['rainbowTroutStamina', '170.0', '220',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['rainbowTroutTensionGain', '1.3', '1.9',
    '用户 2026-10-08 红鱼数值标定：游不快的抬高张力到 ≥4 回合'],
  ['arcticCharPullSpeed', '1.5', '2.65',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['arcticCharFatiguedPullSpeed', '0.75', '1.325',
    '北极红点鲑拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['arcticCharStamina', '420.0', '480',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['arcticCharTensionGain', '1.3', '2.3',
    '用户 2026-10-08 红鱼数值标定：游不快的抬高张力到 ≥4 回合'],
  ['taimenPullSpeed', '2.9', '3.2',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['taimenFatiguedPullSpeed', '1.45', '1.6',
    '哲罗鲑拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['taimenStamina', '520.0', '560',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['taimenTensionGain', '1.35', '1.45',
    '用户 2026-10-08 红鱼数值标定：新红鱼按现有红鱼类比上调'],
  ['redfishPullSpeed', '1.4', '2.65',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['redfishFatiguedPullSpeed', '0.7', '1.325',
    '平鲉拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['redfishStamina', '300.0', '380',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['redfishTensionGain', '1.3', '2.3',
    '用户 2026-10-08 红鱼数值标定：游不快的抬高张力到 ≥4 回合'],
  ['greenlandSharkPullSpeed', '2.2', '2.9',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['greenlandSharkFatiguedPullSpeed', '1.1', '1.45',
    '格陵兰鲨拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['greenlandSharkTensionGain', '1.3', '1.75',
    '用户 2026-10-08 红鱼数值标定：游不快的抬高张力到 ≥4 回合'],
  ['mahiMahiPullSpeed', '2.7', '3',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['mahiMahiFatiguedPullSpeed', '1.35', '1.5',
    '鲯鳅拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['mahiMahiStamina', '200.0', '240',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['mahiMahiTensionGain', '1.1', '1.55',
    '用户 2026-10-08 红鱼数值标定：游不快的抬高张力到 ≥4 回合'],
  ['alligatorGarPullSpeed', '2.3', '2.95',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['alligatorGarFatiguedPullSpeed', '1.15', '1.475',
    '鳄雀鳝拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
  ['alligatorGarStamina', '400.0', '480',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['alligatorGarTensionGain', '1.4', '1.55',
    '用户 2026-10-08 红鱼数值标定：新红鱼按现有红鱼类比上调'],
  ['giantSiameseCarpPullSpeed', '1.95', '2.65',
    '用户 2026-10-08 红鱼数值标定：新红鱼偏软，按现有红鱼类比上调（拉力/体力）'],
  ['giantSiameseCarpFatiguedPullSpeed', '0.975', '1.325',
    '巨暹罗鲤拉力上调的连带项（疲劳期拉力 = 拉力 × 0.5）'],
];

if (!fs.existsSync(cfgPath)) {
  console.error('❌ 找不到配置：' + cfgPath);
  console.error('   （游戏还没跑过？先启动一次让它生成，或把路径当参数传进来）');
  process.exit(1);
}
const original = fs.readFileSync(cfgPath, 'utf8');
let text = original;
const applied = [], skipped = [], missing = [];

/**
 * toml 里的 double 写法不统一：NeoForge 自己写出来可能是 `20.0`，
 * 而 sync-config-file.js 追加的默认值会写 `25`、`1200.0`……
 * 只做字符串比较的话，`20.0` 就被当成"玩家自己调过的值"而**跳过**，
 * 于是"有意改过的默认值"永远推不到那份文件上 —— 而且它是**静默**跳过的
 * （报告里写着"玩家自己调过"，看着完全合理）。
 * 2026-10-02 就是这样：文档里写着铁竿该是 25，而发布包里的默认配置还是 20.0。
 * 所以两边都能解析成数字时按数值比。
 */
const sameValue = (a, b) => {
  const sa = String(a).trim(), sb = String(b).trim();
  if (sa === sb) return true;
  if (sa === '' || sb === '') return false;
  const x = Number(sa), y = Number(sb);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
};

for (const [key, from, to, why] of CHANGES) {
  const re = new RegExp('^(\\s*' + key + '\\s*=\\s*)([^\\r\\n#]*?)(\\s*)$', 'm');
  const m = re.exec(text);
  if (!m) { missing.push(key); continue; }
  const cur = m[2].trim();
  if (sameValue(cur, to)) { skipped.push(key + '（已经是 ' + to + '）'); continue; }
  if (!sameValue(cur, from)) {
    skipped.push(key + '（现值 ' + cur + '，既不是旧默认 ' + from + ' 也不是新默认 ' + to +
      ' —— 玩家自己调过，不动它）');
    continue;
  }
  text = text.replace(re, m[1] + to + m[3]);
  applied.push(key + '：' + from + ' → ' + to + '（' + why + '）');
}

console.log('配置文件：' + cfgPath);
if (applied.length) {
  console.log('\n将改动：');
  for (const a of applied) console.log('  · ' + a);
} else {
  console.log('\n没有需要改的项。');
}
if (skipped.length) {
  console.log('\n跳过：');
  for (const s of skipped) console.log('  · ' + s);
}
if (missing.length) {
  console.log('\n文件里没有这些键（可能是还没生成）：' + missing.join('、'));
}

if (!applied.length) {
  console.log('\n（无需写入）');
  process.exit(0);
}
if (!WRITE) {
  console.log('\n（预览模式。加 --write 写入，写入前会备份）');
  process.exit(0);
}

const backup = cfgPath + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.writeFileSync(backup, original, 'utf8');
fs.writeFileSync(cfgPath, text, 'utf8');
console.log('\n✅ 已写入（备份：' + path.basename(backup) + '）');
