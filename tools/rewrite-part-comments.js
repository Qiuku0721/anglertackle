// 把 Config.java 里 partsStats 段的注释换成中文可读文案。
//
// ── 为什么要单独一个脚本 ─────────────────────────────────────
// 注释本来是由 tools/gen-part-config.js 生成的，但那个生成器必须在
// ModItems.java 还是**数字字面量**时跑（它要从字面量里抽默认值）。
// 现在 ModItems 已经被 rewrite-part-stats.js 改写成 Tuning.xxx() 了，
// 为了改一句注释去"还原 → 重跑整条链"风险太大：重跑会重新生成
// Config.java / Tuning.java 的整段代码，任何一步出错都可能悄悄改掉默认值。
//
// 所以这里只做一件最小的事：在 partsStats 段里，把每个字段的
// .comment("...") 内容替换成新文案。默认值、字段名、结构一律不碰。
//
// 文案来源与生成器一致（tools/part-source.js 的中文名 + 属性中文说明），
// 所以两边不会分叉。
//
// 用法：node tools/rewrite-part-comments.js [--write]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');

const cfgPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java');
const bakPath = path.join(ROOT, '参考资料/_before_partcfg/ModItems.java.bak');
const { parseParts } = require('./part-source.js');

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const shortId = (id) => id.replace(/_(line|reel|hook|lure)$/, '');

// 与 gen-part-config.js 保持同一份文案表（改了要同步两处 —— 已在
// gen-part-config.js 顶上注明）。这里只用到 label 与 desc。
const STAT_CN = {
  tensionCeiling: ['张力上限', '越高，线越不容易被拉崩'],
  tensionGen: ['张力涨速', '越小，收线时张力涨得越慢（越小越安全）'],
  tensionRecover: ['张力回复', '越大，放线时张力落得越快（越大越安全）'],
  lineLength: ['线长', '相对麻线的倍率，决定抛投射程上限'],
  pullIdle: ['回拉速度（不挣扎）', '鱼不挣扎时收线拉回多快'],
  pullStruggle: ['回拉速度（挣扎）', '鱼挣扎时收线拉回多快'],
  staminaDrain: ['体力削减', '越大，鱼掉体力越快（越大越好钓）'],
  damping: ['压制阻尼', '抑制鱼回气；高于 1 的部分另有转化'],
  windowBonus: ['提竿窗口加成', '单位是秒，加到基础提竿窗口上'],
  tier: ['品质档位', '1白 2绿 3蓝 4紫 5金 6红'],
};

// 期望的 键 -> 新注释
const want = new Map();
for (const p of parseParts(fs.readFileSync(bakPath, 'utf8'), { literals: true })) {
  const prefix = shortId(p.id);
  const tag = (label, desc) => p.name + '（' + p.id + '） · ' + label + ' —— ' + desc;
  want.set(camel(prefix + '_durability'),
    tag('耐久上限', '用一次扣一点，扣光配件就损坏。⚠ 注册期固定，改它必须重启游戏'));
  for (const k of p.keys) want.set(camel(prefix + '_' + k), tag(...STAT_CN[k]));
}

// ---------------------------------------------------------------- 定位 partsStats 段
let src = fs.readFileSync(cfgPath, 'utf8');
const BEGIN = '// ==== BEGIN 配件数值定义 ====';
const END = '// ==== END 配件数值定义 ====';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0) { console.error('❌ Config.java 里找不到配件数值定义块'); process.exit(1); }
let block = src.slice(i0, i1);

// ---------------------------------------------------------------- 逐个替换注释
let done = 0, miss = [];
for (const [key, text] of want) {
  // 只在该字段自己的语句里替换：`字段名 = b ... .comment("...") ... ;`
  const re = new RegExp('(' + key + '\\s*=\\s*b\\b[^;]*?\\.comment\\()"[^"]*"(\\))');
  if (!re.test(block)) { miss.push(key); continue; }
  block = block.replace(re, '$1"' + text.replace(/"/g, '\\"') + '"$2');
  done++;
}

if (miss.length) {
  console.error('❌ 有 ' + miss.length + ' 个字段没匹配到：' + miss.slice(0, 5).join(', ') +
                (miss.length > 5 ? ' …' : ''));
  process.exit(1);
}

src = src.slice(0, i0) + block + src.slice(i1);

// ---------------------------------------------------------------- 复核：只改了注释
// 逐项确认每个字段的 defineInRange 默认值没被动过。
let bad = 0;
for (const [key] of want) {
  const re = new RegExp(key + '\\s*=\\s*b\\b[^;]*?\\.defineInRange\\("[^"]+",\\s*([-+*/(). 0-9]+?)\\s*,');
  const m = re.exec(block);
  if (!m) { console.error('❌ ' + key + ' 的 defineInRange 丢了'); bad++; }
}
if (bad) process.exit(1);

console.log('替换 ' + done + ' 条注释');
console.log('样例：');
for (const k of ['hempDurability', 'hempTensionCeiling', 'spinningStaminaDrain', 'lureGildedTier']) {
  const m = new RegExp(k + '\\s*=\\s*b\\b[^;]*?\\.comment\\("([^"]*)"\\)').exec(block);
  console.log('  ' + k + ' → ' + (m ? m[1] : '(未找到)'));
}

if (!WRITE) { console.log('\n（预览模式。加 --write 写入）'); process.exit(0); }
fs.writeFileSync(cfgPath, src, 'utf8');
console.log('✅ Config.java 已写入');
