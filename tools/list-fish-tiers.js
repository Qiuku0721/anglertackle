// 从 FishSpecies.java 里读出当前鱼种与等级，输出成表格。
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
const TIERS = ['白', '绿', '蓝', '紫', '金', '红'];
const RODS = { FLOAT: '台钓', LURE: '路亚', BOTH: '通用' };

// 逐条抓取：id, minKg, maxKg, tier, rodKind
const re = /new FishSpecies\(\s*"([a-z_]+)"[\s\S]*?([\d.]+),\s*([\d.]+),\s*(\d),[\s\S]*?RodKind\.(\w+)/g;

const rows = [];
let m;
while ((m = re.exec(src)) !== null) {
  rows.push({
    id: m[1],
    name: NAMES[m[1]] || m[1],
    min: Number(m[2]),
    max: Number(m[3]),
    tier: Number(m[4]),
    rods: m[5],
  });
}

console.log('  序号  鱼种        体重区间            当前等级  适用竿');
console.log('  ' + '-'.repeat(60));
rows.forEach((r, i) => {
  const weight = r.min + ' ~ ' + r.max + ' kg';
  console.log('  ' + String(i + 1).padStart(2) + '    '
    + r.name.padEnd(10)
    + weight.padEnd(20)
    + TIERS[r.tier].padEnd(8)
    + RODS[r.rods]);
});
console.log('\n  共 ' + rows.length + ' 种');
