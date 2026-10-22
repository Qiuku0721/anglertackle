// 统计"配件数值"的规模：每个配件有哪些属性、值的范围。
// 用途：决定把配件数值做成配置项时要开多少项、怎么组织。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(
  path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'), 'utf8');

// 每行格式：  partProps(durability, rarity, PartStats.line(a, b, c, d, tier)))
const re = /(\w+)\s*=\s*ITEMS\.register\("([a-z_0-9]+)"[\s\S]*?partProps\(\s*(\d+)\s*,\s*Rarity\.(\w+)\s*,\s*PartStats\.(\w+)\(([^)]*)\)/g;
const rows = [];
let m;
while ((m = re.exec(src))) {
  rows.push({
    field: m[1], id: m[2], durability: Number(m[3]), rarity: m[4],
    kind: m[5], args: m[6].split(',').map(s => s.trim()),
  });
}

const byKind = {};
for (const r of rows) (byKind[r.kind] ||= []).push(r);

for (const [kind, list] of Object.entries(byKind)) {
  console.log('\n=== ' + kind + '（' + list.length + ' 个）===');
  for (const r of list) {
    console.log('  ' + r.id.padEnd(22) + '耐久 ' + String(r.durability).padEnd(6) +
                r.rarity.padEnd(10) + '[' + r.args.join(', ') + ']');
  }
}

let total = 0;
for (const [, list] of Object.entries(byKind)) {
  for (const r of list) total += r.args.length;
}
console.log('\n配件总数 ' + rows.length + '，属性值总数 ' + total);
console.log('（做成配置项就是 ' + total + ' 项；加上耐久 ' + rows.length + ' 项 = ' + (total + rows.length) + ' 项）');
