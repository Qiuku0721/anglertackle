/*
 * gen-config-changes.js —— 把"有意改了的默认值"翻译成 patch 脚本的登记条目。
 *
 * ── 为什么需要它 ────────────────────────────────────────────
 * NeoForge **不会**用新默认值覆盖已有的 toml（玩家调过的值必须留着），
 * 所以游戏读的**永远是 toml 里的显式值**：只改源码 + 部署 jar，手感一点都不会变。
 * 更糟的是 `check-live-config-matches-defaults.js` 只会把这种差异报成
 * "⚠ 看着是调参器/玩家自己调过的值 —— 不算问题"，也就是**静默失效**。
 * 2026-10-08 实测：改完 10 条鱼之后 toml 里仍压着 36 条旧值。
 *
 * 只有登记进 `tools/patch-config-changed-defaults.js` 的 `CHANGES`（键, 旧默认, 新默认），
 * 那条差异才会被当成"压着旧默认值"，并由 patch 脚本安全地推过去
 * （**只在 toml 现值 == 旧默认时才替换** —— 玩家真调过的值一律不碰）。
 *
 * 本脚本做第一步：读游戏目录的 toml + `Config.java` 的默认值，把每一条差异
 * 打印成可直接粘贴的 `['键', '旧值', '新值', '理由'],`。**只读、只打印，不写任何文件。**
 *
 * 用法：
 *   node tools/gen-config-changes.js                    # 打印条目
 *   node tools/gen-config-changes.js <某个.toml>         # 指定别的 toml
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { cfg } = require('./tuning.js');

const DEFAULT_TOML = 'D:\\mc\\PCL 正式版 2.13.1.1\\.minecraft\\versions\\' +
  '1.21.1-NeoForge_21.1.250\\config\\anglertackle-common.toml';
const tomlPath = process.argv.slice(2).find((a) => a.endsWith('.toml')) || DEFAULT_TOML;

if (!fs.existsSync(tomlPath)) {
  console.error('❌ 找不到配置：' + tomlPath);
  process.exit(1);
}

// 按改动类型给理由（粘进 CHANGES 之后可以逐条改得更具体）
const WHY = {
  pull: '把这一轮的平衡改动推到游戏目录的 toml（拉力/体力）',
  tension: '把这一轮的平衡改动推到游戏目录的 toml（张力涨速）',
  other: '把这一轮的平衡改动推到游戏目录的 toml',
};

const live = new Map();
let group = null;
for (const raw of fs.readFileSync(tomlPath, 'utf8').split('\n')) {
  const line = raw.trim();
  if (line.startsWith('[') && line.endsWith(']')) { group = line.slice(1, -1).trim(); continue; }
  if (!group || !line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq <= 0) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  const h = v.indexOf('#');
  if (h >= 0) v = v.slice(0, h).trim();
  live.set(group + '.' + k, v);
}

const out = [];
for (const [full, raw] of live) {
  const bare = full.slice(full.lastIndexOf('.') + 1);
  const want = cfg[bare];
  if (typeof want !== 'number') continue;              // 布尔/字符串项不在这里管
  const got = Number(raw);
  if (!Number.isFinite(got) || Math.abs(got - want) < 1e-9) continue;
  const why = /TensionGain$/.test(bare) ? WHY.tension
    : /PullSpeed$|Stamina$/.test(bare) ? WHY.pull : WHY.other;
  out.push("  ['" + bare + "', '" + raw + "', '" + want + "',\n    '" + why + "'],");
}

console.log('// 配置文件：' + tomlPath);
console.log('// 与代码默认值不一致（= toml 里压着旧值）的项：' + out.length + ' 条');
console.log('// 粘进 tools/patch-config-changed-defaults.js 的 CHANGES，再跑 --write');
console.log(out.join('\n'));
if (!out.length) console.log('（没有差异 —— toml 已经是最新默认值）');
