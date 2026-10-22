// 统计"每条鱼的数值"规模，并打印 FishSpecies 的结构，决定怎么注入配置。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(
  path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java'), 'utf8');

// 每条鱼：new FishSpecies("id", ModItems.X, minKg, maxKg, TIERS, 档案, RodKind.X)
//
// ⚠️ 档案有两种写法，都要匹配：
//     helper 形式  steady(0.80, 90, 0.95)
//     常量形式     FightProfile.CRUCIAN_CARP —— 鲫鱼用的就是这个，
//                  第一版正则漏了它，导致"20 条鱼"的错误结论。
const re = /new FishSpecies\("([a-z_]+)",\s*ModItems\.\w+,\s*([\d.]+),\s*([\d.]+),\s*(\w+),\s*\n?\s*([\w.]+?)(?:\(([^)]*)\))?,\s*RodKind\.(\w+)/g;
let m, n = 0;
const rows = [];
while ((m = re.exec(src))) {
  const args = (m[6] || '').split(',').map(s => s.trim()).filter(Boolean);
  // 档案名去掉 FightProfile. 前缀；无参数说明是常量引用
  const prof = m[5].replace(/^FightProfile\./, '');
  rows.push({ id: m[1], minKg: m[2], maxKg: m[3], tiers: m[4], prof, args, rod: m[7] });
  n += 2 + args.length;
}
console.log('鱼种 ' + rows.length + ' 条\n');
console.log('id'.padEnd(22) + '体重(kg)'.padEnd(18) + '档位'.padEnd(12) + '策略'.padEnd(22) + '参数');
for (const r of rows) {
  const profLabel = r.args.length ? r.prof + '()' : r.prof + '（常量引用）';
  console.log(r.id.padEnd(22) + (r.minKg + '~' + r.maxKg).padEnd(18) +
              r.tiers.padEnd(12) + profLabel.padEnd(22) +
              (r.args.length ? '[' + r.args.join(', ') + ']' : '参数写死在常量里'));
}
console.log('\n=== 精确规模 ===');
const perFish = 2 /*体重区间*/ + 3 /*档案参数*/ + 1 /*竿型*/ + 1 /*档位表*/;
console.log('  每条鱼：体重下限 + 体重上限 + 拉力 + 体力 + 张力系数 + 竿型 + 档位表 = ' + perFish + ' 项');
console.log('  ' + rows.length + ' 条 → ' + (rows.length * perFish) + ' 项配置');
const crucianSpecial = rows.filter(r => r.args.length === 0);
if (crucianSpecial.length) {
  console.log('  ⚠ 其中 ' + crucianSpecial.map(r => r.id).join(', ') +
              ' 用的是常量引用（参数写死在 FightProfile 里），也要一并展开');
}
console.log('\n  配件：20 个 × (耐久 + 属性) = 79 项');
console.log('  合计约 ' + (rows.length * perFish + 79) + ' 项（现有 35 项 → 总数约 ' +
            (rows.length * perFish + 79 + 35) + ' 项）');

// 档位表是怎么来的
console.log('\n=== 档位数组定义 ===');
for (const a of src.matchAll(/private static final int\[\] (\w+) = \{([^}]*)\};/g)) {
  console.log('  ' + a[1].padEnd(10) + '{' + a[2].trim() + '}');
}

// 档案参数的含义（从 helper 里读）
console.log('\n=== 手感档案 helper 的参数签名 ===');
for (const h of src.matchAll(/private static FightProfile (\w+)\(([^)]*)\)/g)) {
  console.log('  ' + h[1] + '(' + h[2].trim() + ')');
}

// FishSpecies 是不是 record / 有没有可变性
console.log('\n=== FishSpecies 结构 ===');
const decl = /public (final )?class FishSpecies[^{]*\{/.exec(src);
console.log('  ' + (decl ? decl[0].replace(/\s+/g, ' ').trim() : '找不到'));
for (const f of src.matchAll(/^\s{4}(private|public) (final )?([\w\[\]<>]+) (\w+);/gm)) {
  console.log('    字段 ' + f[3] + ' ' + f[4]);
}
