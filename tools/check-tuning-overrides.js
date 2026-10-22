const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 读取玩家用「调参器.html」写出的变更记录，并检查**代码侧的默认值有没有把它改回去**。
//
// 为什么需要这个：
//   玩家调过数值之后，如果我在后续改动里把 Config.java 的默认值改掉，
//   或者新增了同名配置项，他的调整就会被静默覆盖 —— 而他不会知道。
//   这个脚本把"玩家明确调过的项"当成一份契约，任何偏离都会报出来。
//
// 用法：node tools/check-tuning-overrides.js
//       node tools/check-tuning-overrides.js <变更记录.md>   （指定文件）
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;

// 变更记录的候选位置（工具默认让玩家存在这些地方之一）
function findLog() {
  if (process.argv[2]) return fs.existsSync(process.argv[2]) ? process.argv[2] : null;
  const names = ['调参变更记录.md', '调参变更记录.MD'];
  const dirs = [ROOT, path.join(ROOT, '发布包'), path.join(ROOT, '参考资料'), __dirname];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const logPath = findLog();
if (!logPath) {
  console.log('没有找到「调参变更记录.md」。');
  console.log('（玩家还没用调参器改过东西，或者记录没放到工程目录里）');
  console.log('查找位置：工程根目录 / 发布包 / 参考资料 / tools');
  process.exit(0);
}

const text = fs.readFileSync(logPath, 'utf8');
console.log('读到变更记录：' + path.relative(ROOT, logPath));

// 记录里有一段 ```json 是机器可读的 {key: {from, to}}
const m = /```json\s*([\s\S]*?)```/.exec(text);
if (!m) {
  // 没有 json 段就退回解析 markdown 表格
  console.log('⚠ 记录里没有机器可读段（可能来自旧版工具），改用表格解析');
} 
let overrides = {};
if (m) {
  try {
    overrides = JSON.parse(m[1]);
  } catch (e) {
    console.log('❌ json 段解析失败：' + e.message);
    process.exit(1);
  }
} else {
  const rowRe = /^\|\s*[^|]+\|\s*`?([\w.]+)`?\s*\|\s*([^|]+?)\s*\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|/gm;
  let r;
  while ((r = rowRe.exec(text))) {
    const from = parseFloat(r[2]), to = parseFloat(r[3]);
    if (!Number.isNaN(to)) overrides[r[1]] = { from: Number.isNaN(from) ? null : from, to };
  }
}

const keys = Object.keys(overrides);
if (!keys.length) {
  console.log('变更记录里没有可用条目。');
  process.exit(0);
}

// 读 Config.java 的当前默认值
const cfgSrc = fs.readFileSync(
  path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java'), 'utf8');
const defaults = {};
let mm;
const reNum = new RegExp(
  '\\w+\\s*=\\s*b\\s*\\.comment\\([\\s\\S]*?\\)\\s*\\.defineInRange\\("([^"]+)",\\s*(-?[0-9.]+)D?\\s*,', 'g');
while ((mm = reNum.exec(cfgSrc))) defaults[mm[1]] = parseFloat(mm[2]);
const reBool = new RegExp(
  '\\w+\\s*=\\s*b\\s*\\.comment\\([\\s\\S]*?\\)\\s*\\.define\\("([^"]+)",\\s*(true|false)\\)', 'g');
while ((mm = reBool.exec(cfgSrc))) defaults[mm[1]] = mm[2] === 'true';

console.log('');
console.log('玩家调过的项（' + keys.length + '）：');
console.log('  配置项'.padEnd(28) + '玩家设为'.padEnd(12) + '代码默认'.padEnd(12) + '判定');
let missing = 0, drifted = 0;
for (const k of keys) {
  const want = overrides[k].to;
  const has = Object.prototype.hasOwnProperty.call(defaults, k);
  let verdict;
  if (!has) {
    verdict = '配置项已不存在（被删或改名）';
    missing++;
  } else if (defaults[k] === want) {
    verdict = '已一致';
  } else {
    verdict = '代码默认 ' + defaults[k] + '（玩家值只在配置文件里）';
    drifted++;
  }
  console.log('  ' + k.padEnd(28) + String(want).padEnd(12) +
              (has ? String(defaults[k]) : '-').padEnd(12) + verdict);
}

console.log('');
if (missing) {
  console.log('⚠ 有 ' + missing + ' 项玩家调过、但配置项已经不存在了。');
  console.log('  要么恢复该项，要么明确告诉玩家"这项没了、原因是什么"。');
}
if (drifted) {
  console.log('ℹ 有 ' + drifted + ' 项玩家的值与代码默认不同。');
  console.log('  这本身是正常的（玩家的值在游戏配置文件里，不在代码里）。');
  console.log('  ⚠ 但**不要**为了让它们一致就去改 Config.java 的默认值 ——');
  console.log('    那会把玩家的调整变成"新玩家的默认值"，属于擅自改平衡。');
}
if (!missing && !drifted) {
  console.log('✅ 玩家调过的项与代码默认一致，无冲突。');
}
console.log('');
console.log('提醒：这些是玩家**主动**调过的数值。后续改动如果必须动到它们，');
console.log('      要先说明原因，不要静默覆盖。');
process.exit(missing ? 1 : 0);
