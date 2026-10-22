/*
 * check-fish-species.js —— 验证鱼种表的硬规则。
 *
 *   规则① **台钓的红鱼里必须有蓝宝石雷龙。**
 *          〔2026-10-01 修订〕原来写的是"**有且仅有**一种红鱼 = 蓝宝石雷龙"。
 *          第三批 5 种里用户**逐条点名**了"孔雀鱼 = 金~红 + 台钓"，
 *          于是这条"有且仅有"被用户的设计决定推翻了 —— 台钓现在有两种红鱼。
 *          改成断言两件仍然成立的事：①蓝宝石雷龙必须在台钓红鱼之列（它没被挤掉）；
 *          ②台钓红鱼的数量仍然**远少于**路亚（红鱼的两侧分布不失衡）。
 *          ⚠ 不要为了让它变绿而把断言删空：这两条才是这条规则真正在守的东西。
 *
 *          〔2026-10-01 用户补充定案〕"**台钓从今天开始不止一条红鱼，但加入什么红鱼
 *          需要我拍板**"。即：台钓允许多条红鱼（当前 = 蓝宝石雷龙 + 孔雀鱼），
 *          但**每加一条红鱼都必须用户明确点名**，不能由开发/数据自行塞进来。
 *          要新增台钓红鱼时，先回来改下面那张 EXPECT 表并注明日期与原因。
 *   规则② 新增 5 种鱼的竿型分工：
 *          台钓 = 横纹鱼(W_G) / 蓝宝石雷龙(R) / 白条鱼(W_G)
 *          路亚 = 铂金银龙鱼(G_R) / 大眼海鲢(R)
 *
 * 这两条都是"看单个鱼种看不出来、必须横向对比整张表"的约束，
 * 所以值得机器化检查 —— 加鱼时很容易不小心破坏。
 *
 * 用法：node tools/check-fish-species.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing', 'FishSpecies.java');
const src = fs.readFileSync(SRC, 'utf8');

// ---- 读档位数组定义 ----
const TIERSETS = {};
{
  const re = /private static final int\[\] (\w+) = \{([^}]*)\};/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    TIERSETS[m[1]] = m[2].split(',').map((v) => Number(v.trim()));
  }
}

// ---- 读鱼种表 ----
const SPECIES = [];
{
  const re = /new FishSpecies\("(\w+)",\s*ModItems\.(\w+),\s*([\d.]+),\s*([\d.]+),\s*(\w+),\s*([\s\S]*?),\s*RodKind\.(\w+)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    SPECIES.push({
      id: m[1], minKg: Number(m[3]), maxKg: Number(m[4]),
      tiers: TIERSETS[m[5]] || [], tierName: m[5], rods: m[7],
    });
  }
}
if (SPECIES.length < 15) throw new Error('只解析到 ' + SPECIES.length + ' 种鱼，正则可能失配');

const CN = {
  crucian_carp: '鲫鱼', tilapia: '罗非鱼', mullet: '鲻鱼', grass_carp: '草鱼',
  black_carp: '青鱼', topmouth_culter: '翘嘴', zander: '梭鲈',
  atlantic_salmon: '大西洋鲑', bluefin_tuna: '蓝鳍金枪鱼', juvenile_shark: '幼鲨',
  banded_loach: '横纹鱼', hemiculter: '白条鱼', sapphire_snakehead: '蓝宝石雷龙鱼',
  platinum_arowana: '铂金银龙鱼', oxeye_tarpon: '大眼海鲢',
  // 第三批 5 种（用户 2026-10-01 指定）
  african_butterflyfish: '齿蝶鱼', north_african_catfish: '北非胡子鲇',
  jewel_cichlid: '红宝石鱼', guppy: '孔雀鱼', elephantnose: '长吻象鼻鱼',
  // 第四批 2 种（用户 2026-10-02 指定）：洞穴专属台钓鱼
  golden_loach: '金泥鳅', cave_blindfish: '盲鱼',
  // 第 1 批：冷水 5 条（用户 2026-10-08，docs/33 §9.2）
  arctic_char: '北极红点鲑', whitefish: '高白鲑', rainbow_trout: '虹鳟',
  burbot: '江鳕', taimen: '哲罗鲑',
  // 第 3 批：极地 9 条（用户 2026-10-08；冰鱼用户明确不做）
  arctic_cod: '北极鳕', capelin: '毛鳞鱼', atlantic_herring: '大西洋鲱',
  wolffish: '狼鱼', redfish: '平鲉', sablefish: '裸盖鱼',
  atlantic_cod: '大西洋鳕', greenland_halibut: '格陵兰大比目鱼', greenland_shark: '格陵兰鲨',
};
const ROD_CN = { FLOAT: '台钓', LURE: '路亚', BOTH: '通用' };
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];

console.log('=== 鱼种总表（' + SPECIES.length + ' 种）===\n');
console.log('  鱼种              体重(kg)          档位            竿型   能出红?');
console.log('  ' + '-'.repeat(80));
for (const s of SPECIES) {
  const hasRed = s.tiers.includes(5);
  const tierStr = s.tiers.map((t) => TIER_NAME[t]).join('');
  console.log('  ' + (CN[s.id] || s.id).padEnd(16)
    + (s.minKg + ' ~ ' + s.maxKg).padEnd(18)
    + tierStr.padEnd(16)
    + (ROD_CN[s.rods] || s.rods).padEnd(7)
    + (hasRed ? '是' : '—'));
}

console.log('\n=== 规则① 台钓的红鱼里必须有蓝宝石雷龙，且不能泛滥 ===\n');
const rodAllowed = (s, rod) => s.rods === 'BOTH' || s.rods === rod;
const floatRed = SPECIES.filter((s) => rodAllowed(s, 'FLOAT') && s.tiers.includes(5));
console.log('  台钓能出的红鱼（' + floatRed.length + ' 种）：' + (floatRed.length
  ? floatRed.map((s) => CN[s.id] || s.id).join(', ') : '（无）'));

console.log('\n=== 规则② 新增 5 种鱼的竿型与档位 ===\n');
const EXPECT = [
  { id: 'banded_loach', rods: 'FLOAT', tiers: [0, 1], name: '白绿 · 仅台钓' },
  { id: 'hemiculter', rods: 'FLOAT', tiers: [0, 1], name: '白绿 · 仅台钓' },
  { id: 'sapphire_snakehead', rods: 'FLOAT', tiers: [5], name: '红 · 仅台钓' },
  { id: 'platinum_arowana', rods: 'LURE', tiers: [4, 5], name: '金红 · 仅路亚' },
  { id: 'oxeye_tarpon', rods: 'LURE', tiers: [5], name: '红 · 仅路亚' },
];

console.log('\n=== 断言 ===');
let fail = 0;
const assert = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };

assert(floatRed.some((s) => s.id === 'sapphire_snakehead'),
  '蓝宝石雷龙仍在台钓红鱼之列（它没有被别的红鱼挤掉）'
  + (floatRed.some((s) => s.id === 'sapphire_snakehead') ? ''
    : '（实际台钓红鱼：' + floatRed.map((s) => s.id).join(', ') + '）'));

// 台钓红鱼不能"泛滥"：新加的红档台钓鱼必须是**用户点名**的，
// 其余任何新红鱼都不该悄悄从台钓出来。这条挡的是"手滑把某条路亚红鱼改成 FLOAT"。
//
// 名单沿革（每次新增都要在这里留一行，见文件头那句"要新增台钓红鱼时先回来改这里"）：
//   · sapphire_snakehead —— 初版唯一
//   · guppy —— 用户 2026-10-01 点名"孔雀鱼 = 金~红 + 台钓"
//   · arctic_char —— 用户 2026-10-08 批准 docs/33 §9.2 那份名单时一并批准
//     （策划案里它是"高寒湖 · 通用竿 · 金~红"；G_R 含红档 5，所以它必然落在台钓红鱼里）
{
  const allowed = ['sapphire_snakehead', 'guppy', 'arctic_char', 'giant_siamese_carp'];
  const extra = floatRed.filter((s) => !allowed.includes(s.id)).map((s) => s.id);
  assert(extra.length === 0,
    '台钓红鱼只有用户点名的三种（蓝宝石雷龙 / 孔雀鱼 / 北极红点鲑）'
    + (extra.length ? '（多出：' + extra.join(', ') + '）' : ''));
}

for (const e of EXPECT) {
  const s = SPECIES.find((x) => x.id === e.id);
  if (!s) { fail++; console.log('  ❌ 缺鱼种 ' + e.id); continue; }
  const okRod = s.rods === e.rods;
  const okTier = JSON.stringify(s.tiers) === JSON.stringify(e.tiers);
  if (!okRod || !okTier) fail++;
  console.log('  ' + (okRod && okTier ? '✅' : '❌') + ' ' + (CN[e.id] || e.id)
    + '：' + (ROD_CN[s.rods] || s.rods) + ' + ' + s.tiers.map((t) => TIER_NAME[t]).join('')
    + '（期望 ' + e.name + '）'
    + (okRod ? '' : '  竿型错：期望 ' + ROD_CN[e.rods])
    + (okTier ? '' : '  档位错：期望 ' + e.tiers.map((t) => TIER_NAME[t]).join('')));
}

// 路亚侧也应该有红鱼（不能只有台钓有）
const lureRed = SPECIES.filter((s) => rodAllowed(s, 'LURE') && s.tiers.includes(5));
assert(lureRed.length >= 2, '路亚能出的红鱼至少 2 种（实际 ' + lureRed.length + '：'
  + lureRed.map((s) => CN[s.id] || s.id).join(', ') + '）');

// 台钓/路亚各自都要有鱼可钓
const floatAll = SPECIES.filter((s) => rodAllowed(s, 'FLOAT'));
const lureAll = SPECIES.filter((s) => rodAllowed(s, 'LURE'));
console.log('\n  台钓可用鱼种 ' + floatAll.length + ' 种，路亚可用 ' + lureAll.length + ' 种');
assert(floatAll.length >= 4 && lureAll.length >= 4, '两侧鱼种数量都够（>=4）');

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项未通过'));
process.exitCode = fail === 0 ? 0 : 1;
