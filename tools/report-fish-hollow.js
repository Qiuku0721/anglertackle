/*
 * report-fish-hollow.js —— **报告，不是检查器**：数一遍鱼图标里的"真镂空"像素。
 *
 * 判据：一个透明像素，如果它的上/下/左/右四个方向**各自**都存在不透明像素，
 * 那它就被前景完整包围 —— 这才叫镂空（鱼肚被掏空）。鳍与鳍之间的开口空隙不属于此列。
 *
 * ── 为什么它不叫 check-*.js（2026-10-03 从 check-hollow.js 改名）────────────
 * 它原来挂在 `tools/check-*.js` 下，也就是**被当成闸门**跑，但它**从不设退出码**：
 * 一个永远不会红的"检查器"比没有检查器更坏 —— 体检把它列进了
 * 「高风险：守用户验收物，却没有负例」那一栏（守的正是用户亲手验收过的鱼图标）。
 *
 * 那能不能让它变红？量过一遍才知道**不能**：用户亲手验收过的鱼图标本来就带少量真镂空 ——
 * 现役 3/9/4/3/2/20/13… 与 `参考资料/鱼图/_backup_64` 逐个一致，
 * 只有蓝鳍金枪鱼从备份的 93 改成了现在的 3（那一版重画过，用户验收的是现役这套）。
 * 所以"n > 0 就红"会把已经验收的美术判死；要当闸门，得先由用户定一个
 * "多大的洞算坏"（例如 n ≥ 30）—— 在那之前它的正确身份是报告。
 *
 * ⚠ `check-rod-icon-quality.js` 用的是同一套"真镂空"判据，那边是**真闸门**
 *   （竿图标本来就没有镂空，所以 n > 0 在那里是有意义的断言）。
 *
 * 用法：node tools/report-fish-hollow.js
 */
const fs = require('fs');
const path = require('path');
const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const { decodePng } = require('./image-to-sprite.js');

const IDS = ['crucian_carp','tilapia','mullet','grass_carp','black_carp','topmouth_culter',
  'zander','atlantic_salmon','bluefin_tuna','juvenile_shark','banded_loach','platinum_arowana',
  'sapphire_snakehead','oxeye_tarpon','hemiculter'];
// ⚠ 相对路径在负例副本里会读真实仓库，所以一律从 ATL_ROOT 拼。
const TEX = path.join(ATL_ROOT, 'src/main/resources/assets/anglertackle/textures/item') + path.sep;
const OLD = path.join(ATL_ROOT, '参考资料/鱼图/_backup_64') + path.sep;

function enclosed(file) {
  const img = decodePng(fs.readFileSync(file));
  const { w, h, rgba } = img;
  const a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] > 0;
  let n = 0, fg = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y)) { fg++; continue; }
    let up = false, dn = false, lf = false, rt = false;
    for (let yy = y - 1; yy >= 0; yy--) if (a(x, yy)) { up = true; break; }
    for (let yy = y + 1; yy < h; yy++) if (a(x, yy)) { dn = true; break; }
    for (let xx = x - 1; xx >= 0; xx--) if (a(xx, y)) { lf = true; break; }
    for (let xx = x + 1; xx < w; xx++) if (a(xx, y)) { rt = true; break; }
    if (up && dn && lf && rt) n++;
  }
  return { n, fg, w, h };
}

console.log('id'.padEnd(20) + '现役'.padEnd(14) + '真镂空'.padEnd(10) + '备份64² 真镂空');
let hit = 0;
let drift = 0;
for (const id of IDS) {
  const cur = enclosed(TEX + id + '.png');
  let old = null;
  if (fs.existsSync(OLD + id + '.png')) old = enclosed(OLD + id + '.png');
  if (cur.n > 0) hit++;
  let flag = '';
  if (old && old.n !== cur.n) {
    flag = '  <<< 与备份不同（' + old.n + ' → ' + cur.n + '）';
    drift++;
  }
  console.log(id.padEnd(20) + (cur.w + 'x' + cur.h).padEnd(14) + String(cur.n).padEnd(10)
    + (old ? old.n : '-') + flag);
}
console.log('\n有真镂空的贴图: ' + hit + ' / ' + IDS.length
  + '（少量镂空是验收过的美术，不算错）');
console.log('与 64² 备份不同的: ' + drift + ' / ' + IDS.length
  + (drift ? '（换过图就会不同，人工看一眼即可）' : ''));
