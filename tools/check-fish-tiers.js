// 验证品质阶梯：模拟每种鱼的体重分布，看各档位占比是否合理。
// 用法: node tools/check-fish-tiers.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'main', 'java', 'com', 'whitecobalt',
  'anglertackle', 'fishing', 'FishSpecies.java');
const src = fs.readFileSync(file, 'utf8');

const NAMES = {
  crucian_carp: '鲫鱼', tilapia: '罗非鱼', mullet: '鲻鱼', grass_carp: '草鱼',
  black_carp: '青鱼', topmouth_culter: '翘嘴', zander: '梭鲈',
  atlantic_salmon: '大西洋鲑', bluefin_tuna: '蓝鳍金枪鱼', juvenile_shark: '幼鲨',
};
const TIER_NAME = ['白', '绿', '蓝', '紫', '金', '红'];
const RODS = { FLOAT: '台钓', LURE: '路亚', BOTH: '通用' };
const TIER_CONST = {
  W_G: [0, 1], G_B: [1, 2], B_P: [2, 3], G_B_P: [1, 2, 3], G_R: [4, 5],
};

// 抓取每条鱼的 id / 体重区间 / 阶梯常量名 / 适用竿
const re = /new FishSpecies\(\s*"([a-z_]+)",\s*ModItems\.\w+,\s*([\d.]+),\s*([\d.]+),\s*(\w+),[\s\S]*?RodKind\.(\w+)/g;
const rows = [];
let m;
while ((m = re.exec(src)) !== null) {
  rows.push({
    id: m[1], name: NAMES[m[1]] || m[1],
    min: Number(m[2]), max: Number(m[3]),
    tiers: TIER_CONST[m[4]] || [0],
    rods: m[5],
  });
}

console.log('  鱼种        体重区间              品质阶梯（按体重等分）              适用竿');
console.log('  ' + '-'.repeat(84));
rows.forEach(r => {
  const n = r.tiers.length;
  const span = (r.max - r.min) / n;
  const parts = r.tiers.map((t, i) => {
    const lo = (r.min + span * i).toFixed(2);
    const hi = (r.min + span * (i + 1)).toFixed(2);
    return TIER_NAME[t] + '(' + lo + '~' + hi + ')';
  });
  console.log('  ' + r.name.padEnd(10)
    + (r.min + ' ~ ' + r.max + ' kg').padEnd(20)
    + parts.join('  ').padEnd(36)
    + RODS[r.rods]);
});

// 抽 20000 次，看实际落档分布（体型系数偏态，大鱼少）
console.log('\n  实际落档分布（模拟 20000 次抽取，体型系数偏态）');
console.log('  ' + '-'.repeat(60));
rows.forEach(r => {
  const n = r.tiers.length;
  const count = new Array(6).fill(0);
  for (let i = 0; i < 20000; i++) {
    const raw = Math.max(Math.random(), Math.random() * 0.85);
    const sizeFactor = 0.35 + raw * 0.65;
    const w = r.min + (r.max - r.min) * Math.pow(sizeFactor, 3.0);
    const ratio = (w - r.min) / Math.max(1e-6, r.max - r.min);
    let idx = Math.floor(ratio * n);
    idx = Math.max(0, Math.min(n - 1, idx));
    count[r.tiers[idx]]++;
  }
  const desc = count.map((c, t) => c > 0 ? TIER_NAME[t] + ' ' + (c / 200).toFixed(1) + '%' : null)
    .filter(Boolean).join('   ');
  console.log('  ' + r.name.padEnd(10) + desc);
});
