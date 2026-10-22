/*
 * check-fish-appearance.js —— 守住"鱼的配色与外形不是凭空编的"。
 *
 * 这个文件要防的是**看着很合理、实际是编的**：手写鱼种配色时，
 * 很容易顺手写一个"看着像鲫鱼"的灰绿色。那种值在游戏里完全正常，
 * 但整个 fish_research/ 的调研就白做了 —— 而且没有任何报错。
 *
 * 所以这里的核心断言是**溯源**：fish-appearance.json 里每一个主色，
 * 都必须原样出现在 fish_research/<id>.json 对应字段的 hex 列表里。
 * 想改配色就必须先改调研资料，不能绕过。
 *
 * 其余断言：
 *  ② 覆盖完整 —— 与 tags/item/fishes.json、ModEntities.FISH_IDS 三方一致
 *  ③ 组与零件开关合法 —— 组必须在 bodies 里，trait 键必须是代码认识的
 *  ④ 缩放算出来是有限正数且不过分 —— 缩放到 0 或负数在游戏里是"鱼消失"
 *
 * 用法：node tools/check-fish-appearance.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 鱼外形数据检查 ===\n');

const data = JSON.parse(read('tools/fish-appearance.json'));
const ids = Object.keys(data.fish);
const HEX = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------- ① 配色溯源
// 调研字段 → appearance 字段的对应关系。back/flank/belly 是最硬的对应，
// fin/eye 允许跨字段取（资料把鳍色写在 finShape 里、眼色写在 eyeDescription 里）。
const SOURCE = {
  // back 也允许取 flankColor：大眼海鲢按用户实机反馈改成「整体白、只在背部一点灰」，
  // 用的正是资料 flankColor 里那个「背部到体侧的过渡带」色。
  back: ['dorsalColor', 'flankColor', 'markings'],
  flank: ['flankColor', 'markings'],
  belly: ['bellyColor', 'markings'],
  fin: ['finShape', 'flankColor', 'bellyColor'],
  finSoft: ['finShape', 'flankColor', 'bellyColor'],
  mark: ['markings', 'flankColor', 'dorsalColor'],
  mark2: ['markings', 'flankColor'],
  line: ['markings', 'flankColor'],
  eye: ['eyeDescription', 'markings'],
};
const hexesIn = (s) => (String(s || '').match(/#[0-9A-Fa-f]{6}/g) || []).map((h) => h.toUpperCase());

let traced = 0, noResearch = 0, userSet = 0;
for (const id of ids) {
  const f = data.fish[id];
  const rp = 'fish_research/' + id + '.json';
  if (!exists(rp)) { bad(id + ' 没有调研资料 ' + rp); continue; }
  const research = JSON.parse(read(rp));
  for (const [key, col] of Object.entries(f.colors || {})) {
    if (!HEX.test(col)) { bad(id + '.' + key + ' 不是 #RRGGBB：' + col); continue; }
    const fields = SOURCE[key];
    if (!fields) { bad(id + ' 出现了未知颜色键 ' + key); continue; }
    const pool = new Set(fields.flatMap((fd) => hexesIn(research[fd])));
    if (pool.has(col.toUpperCase())) { traced++; continue; }
    // 例外：用户实机看过并明确指定的配色。资料与实机冲突时**以用户为准**，
    // 但必须留下 _userNote 说明来源，否则仍然算"凭空编颜色"。
    if (f._userNote) { userSet++; continue; }
    bad(id + '.' + key + ' = ' + col + ' 不在调研资料的 ' + fields.join('/') + ' 里 —— 不许凭空编颜色');
    noResearch++;
  }
}
if (noResearch === 0) ok('全部 ' + traced + ' 个主色都能在 fish_research/ 里找到出处' +
    (userSet ? '（另有 ' + userSet + ' 个是用户实机指定，见 _userNote）' : ''));

// ---------------------------------------------------------------- ② 覆盖完整
const tagIds = JSON.parse(read('src/main/resources/data/anglertackle/tags/item/fishes.json'))
  .values.map((v) => v.replace('anglertackle:', '')).sort();
const appIds = [...ids].sort();
if (JSON.stringify(tagIds) !== JSON.stringify(appIds)) {
  bad('标签 fishes.json 与 fish-appearance.json 的鱼种列表不一致\n      标签独有：' +
    tagIds.filter((x) => !appIds.includes(x)).join(', ') + '\n      外形独有：' +
    appIds.filter((x) => !tagIds.includes(x)).join(', '));
} else ok(appIds.length + ' 个鱼种在 fishes 标签与外形数据里完全一致');

const { stripComments } = require('./java-source.js');
const entSrc = stripComments(read('src/main/java/com/whitecobalt/anglertackle/registry/ModEntities.java'));
const m = entSrc.match(/FISH_IDS\s*=\s*\{([\s\S]*?)\}/);
if (!m) bad('ModEntities 里找不到 FISH_IDS');
else {
  const entIds = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  if (JSON.stringify(entIds) !== JSON.stringify(appIds)) {
    bad('ModEntities.FISH_IDS 与外形数据不一致\n      实体独有：' +
      entIds.filter((x) => !appIds.includes(x)).join(', ') + '\n      外形独有：' +
      appIds.filter((x) => !entIds.includes(x)).join(', '));
  } else ok('ModEntities.FISH_IDS 与外形数据一致（' + entIds.length + ' 种）');
}

// ---------------------------------------------------------------- ③ 形状 / 组 / 开关合法
const groups = Object.keys(data.bodies);
// traits 只剩"不影响几何"的几项 —— 形状全部搬到 shape（见 tools/fish-model.js 的 buildParts）
const VALID_TRAITS = ['cheekSpot', 'squat', 'wide', 'long', 'adiposeColor'];
// ⚠ 这张表必须和 fish-model.js 的 buildParts 认识的键**一一对应**。
//   多一个 = buildParts 静默忽略它（改了数据没反应，最难查）；
//   少一个 = 误报。
const VALID_SHAPE = ['snoutShape', 'snoutLen', 'snoutWidth', 'snoutHeight', 'lowerJaw',
  'tailType', 'tailLen', 'tailHeight', 'peduncleLen', 'peduncleWidth', 'peduncleHeight',
  // bellyStop（0~1）：腹色沿体轴收住的位置 —— 鲨鱼的白肚皮只到腹部，尾巴是整片体色
  // （用户 2026-10-08："前半部分真的很鲨鱼，就是后半也就是鱼尾处理不像。"）
  'bellyStop',
  'bodyTaper', 'headHeight', 'dorsalLen', 'dorsalHeight', 'dorsalPos',
  'secondDorsal', 'secondDorsalPos', 'secondDorsalLen', 'adipose', 'finlets', 'finletsPos',
  'analLen', 'analHeight', 'analPos', 'barbels', 'barbelLen', 'barbelAt', 'barbelDroop',
  'gillSlits', 'pectoralLen', 'pectoralDrop', 'eyeScale', 'bands',
  'segments', 'profile', 'finSegments', 'dorsalTaper', 'analTaper',
  'top', 'bot', 'canines', 'finFilament', 'cheekSpine', 'tailTip', 'tailLowerLong',
  'headWide', 'pectoralBroad', 'pectoralPos',
  // style = 'v1'：整条鱼身一个长方体。
  // 用户 2026-10-01 实机验收后要求「除了我明确承认的鱼，其他改回第一版」。
  'style', 'tailNotch', 'tailShape',
  // 原版模板本身没有、按鱼种追加的零件开关
  'sharkDorsal', 'mouthSeven', 'pectoralPairs',
  'longDorsal', 'longDorsalLen', 'longAnalLen'];
const VALID_TAIL = ['fork', 'round', 'truncate', 'crescent', 'heterocercal', 'shark'];
const VALID_SNOUT = ['normal', 'duckbill', 'upturned', 'blunt', 'subterminal'];
let traitBad = 0;
for (const id of ids) {
  const f = data.fish[id];
  if (!groups.includes(f.group)) { bad(id + ' 的组 ' + f.group + ' 不在 bodies 里'); traitBad++; }
  for (const [k, v] of Object.entries(f.traits || {})) {
    if (!VALID_TRAITS.includes(k)) { bad(id + ' 有未知零件开关 ' + k + '（tools/fish-model.js 不认识，会被静默忽略）'); traitBad++; }
    if (k === 'adiposeColor' || k === 'cheekSpot') {
      if (!HEX.test(v)) { bad(id + '.' + k + ' 必须是 #RRGGBB'); traitBad++; }
      else {
        const rp = JSON.parse(read('fish_research/' + id + '.json'));
        const pool = new Set(['dorsalColor', 'flankColor', 'bellyColor', 'markings', 'finShape']
          .flatMap((fd) => hexesIn(rp[fd])));
        if (!pool.has(v.toUpperCase())) { bad(id + '.' + k + ' = ' + v + ' 不在调研资料里'); traitBad++; }
      }
    }
  }
  // shape：键必须是 buildParts 认识的，取值必须合法
  const sh = f.shape || {};
  for (const [k, v] of Object.entries(sh)) {
    if (!VALID_SHAPE.includes(k)) {
      bad(id + ' 有未知形状参数 ' + k + ' —— tools/fish-model.js 的 buildParts 不认识它，会被静默忽略');
      traitBad++;
    }
    if (k === 'tailType' && !VALID_TAIL.includes(v)) { bad(id + '.tailType = ' + v + ' 不是 ' + VALID_TAIL.join('/')); traitBad++; }
    if (k === 'style' && !['v1', 'cod', 'salmon'].includes(v)) { bad(id + '.style = ' + v + ' 只支持 v1 / cod / salmon'); traitBad++; }
    if (k === 'snoutShape' && !VALID_SNOUT.includes(v)) { bad(id + '.snoutShape = ' + v + ' 不是 ' + VALID_SNOUT.join('/')); traitBad++; }
    if (k === 'barbels' && !(Number.isInteger(v) && v >= 0 && v <= 6)) { bad(id + '.barbels 必须是 0~6'); traitBad++; }
    if (k === 'gillSlits' && !(Number.isInteger(v) && v >= 0 && v <= 5)) { bad(id + '.gillSlits 必须是 0~5'); traitBad++; }
    if (k === 'bands' && (!Array.isArray(v) || v.length !== 3 || !(v[0] < v[1] && v[1] < v[2]))) {
      bad(id + '.bands 必须是递增的三个比例：' + JSON.stringify(v)); traitBad++;
    }
  }
  // 口须长度：用户的原话是「嘴上有很诡异的两个长条」。
  // 真鱼的须比头短得多，1~3 单位是合理区间；超过 3 就会重新变成两根棍子。
  if ((sh.barbels || 0) > 0 && !(sh.barbelLen >= 1 && sh.barbelLen <= 3)) {
    bad(id + ' 有口须但 barbelLen = ' + sh.barbelLen + ' —— 必须 1~3，长了就是"嘴上两根长条"');
    traitBad++;
  }
  if (f.pattern && f.pattern.length && !f.colors.mark) { bad(id + ' 有花纹却没有 mark 颜色'); traitBad++; }
  for (const op of f.pattern || []) {
    if (!['bars', 'stripes', 'spots', 'speckle', 'plates'].includes(op)) { bad(id + ' 有未知花纹 ' + op); traitBad++; }
  }
}
if (traitBad === 0) ok('组名、花纹、零件开关全部合法');

// ---------------------------------------------------------------- ④ 缩放
const M = require('./fish-model.js');
let scaleBad = 0;
for (const [id, s] of Object.entries(M.species)) {
  for (const v of s.scale) {
    if (!Number.isFinite(v) || v <= 0) { bad(id + ' 的缩放里有非正数：' + s.scale); scaleBad++; break; }
  }
  if (Math.max(...s.scale) > 2.5 || Math.min(...s.scale) < 0.2) {
    bad(id + ' 的缩放太极端：' + s.scale + '（最大 2.5 / 最小 0.2）'); scaleBad++;
  }
}
if (scaleBad === 0) ok(Object.keys(M.species).length + ' 种鱼的渲染缩放都是合理的正数（0.2 ~ 2.5）');

// ---------------------------------------------------------------- ⑤ "该大的要看得出来大"
// 用户 2026-10-01 的明确要求：「把应该大模型的鱼做大」。
// 上一版三重压缩（组内归一 + 0.6 次方 + 夹 [0.78,1.5]）把 200cm 的巨物压到只比 20cm 的鲫鱼
// 长一倍出头，看着完全不像巨物 —— 而**所有检查都是绿的**，因为没人断言过尺寸关系。
// 所以这里把"大小排序"直接写成断言。
{
  const need = [
    ['arapaima', 2.0], ['bluefin_tuna', 2.0],        // 200cm 档：必须是大块头
    ['black_carp', 1.4], ['striped_bass', 1.3],       // 76~90cm 档
    ['grass_carp', 1.2], ['atlantic_salmon', 1.2],
  ];
  // 幼鲨不在小鱼之列：用户 2026-10-01 明确要求把它做大（12cm 幼体 -> 45cm 亚成体），
  // 理由是"体型不大"看着不像金红档的稀有鱼。
  const small = [['hemiculter', 0.75], ['banded_loach', 0.7]];
  let big = 0;
  for (const [id, min] of need) {
    const L = M.species[id] ? M.species[id].modelLenBlocks : -1;
    if (L < min) { bad(id + ' 只有 ' + L + ' 格，应该 ≥ ' + min + ' 格（"该大的要大"）'); big++; }
  }
  for (const [id, max] of small) {
    const L = M.species[id] ? M.species[id].modelLenBlocks : 99;
    if (L > max) { bad(id + ' 有 ' + L + ' 格，应该 ≤ ' + max + ' 格'); big++; }
  }
  const big3 = ['arapaima', 'bluefin_tuna'].map((i) => M.species[i].modelLenBlocks);
  const small3 = ['banded_loach'].map((i) => M.species[i].modelLenBlocks);
  if (big3[0] < small3[0] * 4) {
    bad('最大与最小的模型长度只差 ' + (big3[0] / small3[0]).toFixed(1) + ' 倍，'
      + '巨物看不出大（要求 ≥ 4 倍）'); big++;
  }
  if (big === 0) {
    ok('体长 vs 模型尺寸关系正确：巨骨舌鱼/蓝鳍金枪鱼 ' + big3[0] + ' 格，'
      + '花鳅 ' + small3[0] + ' 格，相差 ' + (big3[0] / small3[0]).toFixed(1) + ' 倍');
  }
}

// ---------------------------------------------------------------- ⑥ 碰撞箱跟着体型走
{
  let hb = 0;
  for (const [id, s] of Object.entries(M.species)) {
    if (!Array.isArray(s.hit) || s.hit.length !== 2) { bad(id + ' 没有碰撞箱数据'); hb++; continue; }
    if (!(s.hit[0] > 0 && s.hit[1] > 0)) { bad(id + ' 的碰撞箱不是正数：' + s.hit); hb++; }
    if (s.hit[0] > 2.0 || s.hit[1] > 1.2) { bad(id + ' 的碰撞箱过大：' + s.hit); hb++; }
  }
  if (hb === 0) ok(Object.keys(M.species).length + ' 种鱼的碰撞箱都由体型算出且范围合理（宽 ≤2.0 / 高 ≤1.2）');
}

console.log('');
console.log(fail === 0 ? '✅ 鱼外形数据检查通过' : '❌ 鱼外形数据检查未通过（' + fail + ' 项）');
process.exitCode = fail === 0 ? 0 : 1;
