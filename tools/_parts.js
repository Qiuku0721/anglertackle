// 导出 20 个配件的稀有度与数值，确认"紫轮""金轮"是哪两个。
const fs = require('fs');
const src = fs.readFileSync('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java', 'utf8');
const lang = JSON.parse(fs.readFileSync(
  'src/main/resources/assets/anglertackle/lang/zh_cn.json', 'utf8'));

// ITEMS.register("id", () -> new XxxItem(partProps(<耐久>, Rarity.XXX, PartStats.yyy(...)), ...))
const re = /ITEMS\.register\("([^"]+)"[\s\S]{0,400}?partProps\(([^;]*?)\)\s*,/g;
const rows = [];
for (const m of src.matchAll(re)) {
  const args = m[2];
  const rar = (/Rarity\.(\w+)/.exec(args) || [])[1] || '?';
  const stats = (/PartStats\.(\w+)\(([^)]*)\)/.exec(args) || []);
  rows.push({ id: m[1], rarity: rar, kind: stats[1] || '?', nums: (stats[2] || '').split(',').map((s) => s.trim()) });
}
console.log('配件 ' + rows.length + ' 个\n');
const RAR_CN = { COMMON: '白', UNCOMMON: '绿', RARE: '蓝', EPIC: '紫', LEGENDARY: '金' };
const pad = (s, n) => { let w = 0; for (const c of s) w += /[\u4e00-\u9fa5（）：]/.test(c) ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
for (const r of rows) {
  const cn = lang['item.anglertackle.' + r.id] || r.id;
  console.log(pad(cn, 26) + pad(r.id, 22) + pad((RAR_CN[r.rarity] || r.rarity) + '(' + r.rarity + ')', 14) +
              r.kind + '(' + r.nums.join(', ') + ')');
}
