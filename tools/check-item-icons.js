/*
 * check-item-icons.js —— 钉死**物品贴图**的字节内容，谁都不许悄悄换掉它们。
 *
 * ── 为什么需要这个检查器（2026-10-02，用户第三次报"贴图又被换了"）──────
 * 用户发来一张物品栏截图："为什么把之前的贴图都换了！！！！！！！"
 * 现场取证（比对每份源码快照里的贴图 sha256）：
 *   · 21 张**手绘**鱼图标（巨骨舌鱼、狗鱼、草鱼…）在某次构建里被换成了
 *     `gen-fish-item.js` 从鱼模型离屏渲染出来的图 —— 用户这次是第三次踩同一件事；
 *   · 更坏的是 `freeze-fish-baseline.js` 随后把**被换过之后**的比例当成了新基线，
 *     于是 `check-fish-textures.js` 由红转绿，守门的那道闸门自己失效了。
 *   （比例基线只约束"宽高比"，而且它守的是**基线文件**，一旦基线被重刷就再也守不住。）
 *
 * 这个检查器不看比例，只看**字节**：它拿一张表（`图标指纹.json`）与磁盘上的 PNG
 * 逐个 sha256 比对，任何一张被覆盖/丢失/多出来都会红。表的来源是用户亲自验收过的包：
 *   · 21 张手绘图标 + 全部配件/鱼饵/拟饵/路亚竿图标 ← `anglertackle-1.1.3.jar`（用户提供）
 *   · 5 张参考图鱼图标（蝴蝶鱼/胡子鲇/红宝石/孔雀鱼/象鼻鱼）← 由 gen-ref-icons.js 生成后冻结
 *   · 金泥鳅 / 盲鱼 ← 同上（用户 2026-10-02 追加的洞穴鱼）
 *
 * ── 为什么不是"再写个生成器把它们画回来"──────────────────────────
 * 这 21 张是**逐张抠实物照片**做的，仓库里没有任何脚本能重现它们 —— 丢了就是丢了。
 * 所以唯一可靠的做法是"记住它们的字节"，并在每次构建时核对。
 *
 * ── 更新指纹（必须是有意为之）──────────────────────────────────
 * 确实要换某张图标时：
 *   1. 先想清楚"这是在覆盖用户验收过的图吗"；
 *   2. `node tools/check-item-icons.js --write` 重新采集；
 *   3. 把 `参考资料/图标指纹.json` 的改动一起提交，并在提交信息里写明换了哪几张、为什么。
 * ⚠ 绝对不要在"检查器报红"的时候顺手 --write —— 那等于把这道闸门关掉，
 *   正是当初比例基线失效的老路。
 *
 * 用法：
 *   node tools/check-item-icons.js            # 核对（构建时默认就跑这个）
 *   node tools/check-item-icons.js --write    # 重新采集指纹（慎用，见上）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TEXDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const RECORD = path.join(ROOT, '参考资料/图标指纹.json');
const WRITE = process.argv.includes('--write');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/**
 * 每张图标的来源。这张备注表只用于把报错信息说得像人话 ——
 * 真正的判据永远是指纹表里的哈希，不是这里的文字。
 */
const ORIGIN = {};
for (const id of ['arapaima', 'atlantic_salmon', 'banded_loach', 'black_carp', 'bluefin_tuna',
  'brown_trout', 'crucian_carp', 'grass_carp', 'hemiculter', 'juvenile_shark', 'mirror_carp',
  'mullet', 'oxeye_tarpon', 'pike', 'platinum_arowana', 'sapphire_snakehead', 'striped_bass',
  'tigerfish', 'tilapia', 'topmouth_culter', 'zander']) {
  ORIGIN[id] = '手绘（逐张抠实物照片，仓库里没有脚本能重现）';
}
for (const id of ['african_butterflyfish', 'north_african_catfish', 'jewel_cichlid', 'guppy',
  'elephantnose', 'golden_loach', 'cave_blindfish']) {
  ORIGIN[id] = '按用户给的参考图生成（tools/gen-ref-icons.js）';
}
// 第 1 批冷水 5 条 + 第 3 批极地 9 条（用户 2026-10-08）：**没有实物参考图**，
// 图标走"用鱼自己的模型离屏渲染"那条路（tools/gen-fish-item.js），
// 用户后来给了实物图的话由 build/make-fish-icons.js 覆盖成 128×128（同样在这张表里说明）。
for (const id of ['arctic_char', 'whitefish', 'rainbow_trout', 'burbot', 'taimen',
  'arctic_cod', 'capelin', 'atlantic_herring', 'wolffish', 'redfish',
  'sablefish', 'atlantic_cod', 'greenland_halibut', 'greenland_shark',
  'sailfish', 'mahi_mahi', 'alligator_gar', 'giant_siamese_carp', 'electric_eel']) {
  ORIGIN[id] = '按鱼模型离屏渲染（tools/gen-fish-item.js；用户给图后由 build/make-fish-icons.js 覆盖）';
}
// 拟饵 2026-10-04 起换成用户给的成图（32×64，内容只在上半）。
for (const id of ['lure_glowspoon', 'lure_deep', 'lure_paddletail', 'lure_vibration', 'lure_rattle',
  'lure_minnow', 'lure_depthfinder', 'lure_gilded', 'lure_spoon']) {
  ORIGIN[id] = '用户 2026-10-04 给的成图截上半（tools/gen-lure-icons.js）';
}
// 软虫拟饵：2026-10-06 用户亲自给了新成图（斜放灰白软虫 + 荧光黄头，64×64），
// 从"老图标别动"改成和上面那 9 张同一条管线（参考资料/拟饵新图/10_软虫.png）。
ORIGIN.lure_soft = '用户 2026-10-06 给的成图（64×64 成品，tools/gen-lure-icons.js 原样用）';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

if (!fs.existsSync(TEXDIR)) {
  console.error('❌ 找不到贴图目录：' + TEXDIR);
  process.exit(2);
}
const pngs = fs.readdirSync(TEXDIR).filter((f) => f.endsWith('.png')).sort();

// ---------------------------------------------------------------- 采集模式
if (WRITE) {
  const rec = {};
  for (const f of pngs) rec[f.replace(/\.png$/, '')] = sha(path.join(TEXDIR, f));
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify(rec, null, 1) + '\n');
  console.log('✎ 已重新采集 ' + pngs.length + ' 张物品贴图的指纹 → ' + path.relative(ROOT, RECORD).replace(/\\/g, '/'));
  console.log('  （这只是"记录现状"，不校验任何东西；换图标必须是有意为之）');
  process.exit(0);
}

// ---------------------------------------------------------------- 校验模式
if (!fs.existsSync(RECORD)) {
  console.error('❌ 缺指纹表：' + path.relative(ROOT, RECORD).replace(/\\/g, '/'));
  console.error('   先跑一次 node tools/check-item-icons.js --write 生成它（并提交）。');
  process.exit(2);
}
const rec = JSON.parse(fs.readFileSync(RECORD, 'utf8'));

const missing = [], changed = [], extra = [];
for (const f of pngs) {
  const id = f.replace(/\.png$/, '');
  if (!(id in rec)) { extra.push(id); continue; }
  if (sha(path.join(TEXDIR, f)) !== rec[id]) changed.push(id);
}
for (const id of Object.keys(rec)) if (!pngs.includes(id + '.png')) missing.push(id);

for (const id of missing) {
  bad('物品贴图**丢失**：' + id + '.png' + (ORIGIN[id] ? '（' + ORIGIN[id] + '）' : ''));
}
for (const id of changed) {
  bad('物品贴图**被改**：' + id + '.png' + (ORIGIN[id] ? '\n       来源：' + ORIGIN[id] : '')
    + '\n       如果这不是有意的，从用户验收过的包里把它取回来：'
    + '\n         node build/_restore-icons.js <旧jar> ' + id);
}
for (const id of extra) {
  console.log('  ➕ 新贴图（指纹表里还没有，属于新增鱼种/物品）：' + id
    + '\n       确认它是对的之后跑一次 --write 把它纳入守护');
}

console.log('');
console.log('  指纹表 ' + Object.keys(rec).length + ' 张，磁盘 ' + pngs.length + ' 张：'
  + (fail === 0 ? '全部一致' : fail + ' 张对不上'));

if (fail === 0 && extra.length === 0) {
  ok('物品贴图逐个 sha256 与验收版本一致（手绘的老图标没有被任何生成器覆盖）');
  process.exit(0);
}
if (fail === 0) {
  console.log('  （没有对不上的，但有 ' + extra.length + ' 张新贴图还没纳入守护）');
  process.exit(0);
}
console.log('');
console.log('❌ 物品贴图被改动过。**不要**用 --write 掩盖 —— 那是把这道闸门关掉。');
process.exit(1);
