const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿// 检查**已有的游戏配置文件**里有没有"沿用旧默认值"的项。
//
// 为什么需要：NeoForge 对**已存在**的配置文件不会用新默认值覆盖。
// 所以每次我改了 Config.java 的默认值，玩家的旧配置文件仍保留老值，
// 而代码里的手感是按新值设计的 —— 两边不一致，且没有任何提示。
//
// 这个坑真实发生过：配置文件里躺着 9 项旧默认值，其中
//   hookWindow.base        0.75（应为 2.0）→ 提竿窗口紧 2.7 倍
//   parts.capTensionCeiling 1.6（应为 3.0）→ 金线红线被钳成一样
//   parts.pullStruggleBase 0.035（应为 0.35）→ 挣扎时鱼几乎不拽线
//
// 用法：node tools/check-config-stale.js [配置文件路径]
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;

const DEFAULT_CFG = 'D:/mc/PCL 正式版 2.13.1.1/.minecraft/versions/1.21.1-NeoForge_21.1.250/config/anglertackle-common.toml';
const cfgPath = process.argv[2] || DEFAULT_CFG;

if (!fs.existsSync(cfgPath)) {
  console.log('找不到配置文件：' + cfgPath);
  console.log('（游戏还没启动过，或路径变了 —— 用参数指定：node tools/check-config-stale.js <路径>）');
  process.exit(0);
}

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'tuning-schema.json'), 'utf8'));
const text = fs.readFileSync(cfgPath, 'utf8');

// 解析配置文件
const parsed = {};
let group = null;
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const h = /^\[([^\]]+)\]$/.exec(line);
  if (h) { group = h[1]; parsed[group] = {}; continue; }
  const kv = /^([A-Za-z_][\w.-]*)\s*=\s*(.+?)\s*$/.exec(line);
  if (kv && group) parsed[group][kv[1]] = kv[2];
}

console.log('配置文件：' + cfgPath);
console.log('');
const stale = [], missing = [];
let same = 0;
for (const g of schema.groups) {
  for (const f of g.fields) {
    const raw = parsed[g.id] ? parsed[g.id][f.key] : undefined;
    if (raw === undefined) { missing.push(g.id + '.' + f.key); continue; }
    if (f.type === 'bool') { same++; continue; }
    const v = parseFloat(String(raw).replace(/[dD]$/, ''));
    if (Math.abs(v - f.def) < 1e-9) same++;
    else stale.push({ key: g.id + '.' + f.key, inFile: v, nowDefault: f.def, comment: f.comment });
  }
}

console.log('一致 ' + same + ' 项');
if (missing.length) {
  console.log('');
  console.log('⚠ 配置文件里缺少 ' + missing.length + ' 项（新加的配置项，重启游戏后会自动写入）：');
  missing.forEach(k => console.log('   - ' + k));
}
if (stale.length) {
  console.log('');
  console.log('⚠ 有 ' + stale.length + ' 项与当前代码默认值不同：');
  console.log('   配置项'.padEnd(30) + '文件里'.padEnd(12) + '代码默认'.padEnd(12) + '说明');
  for (const s of stale) {
    console.log('   ' + s.key.padEnd(27) + String(s.inFile).padEnd(12) + String(s.nowDefault).padEnd(12) + (s.comment || ''));
  }
  console.log('');
  console.log('  注意：这不一定是坏事 —— 也可能是**玩家自己调过**（那就不该动）。');
  console.log('  跑 node tools/check-tuning-overrides.js 看变更记录区分。');
  console.log('  如果确认是旧版本的遗留默认值，游戏内敲 /atl config reload 即可同步为文件里的值，');
  console.log('  或者让玩家在游戏里删除该文件后重启（会按新默认重新生成）。');
} else if (!missing.length) {
  console.log('');
  console.log('✅ 配置文件与当前代码默认值完全一致');
}
process.exit(0);
