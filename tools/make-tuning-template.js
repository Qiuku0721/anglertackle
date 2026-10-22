// 把"手写版" Tuning.java 里的所有**生成块**删掉，做成干净模板。
//
// ── 为什么要这样 ────────────────────────────────────────────
// Tuning.java 的结构是「手写骨架 + 若干生成块」。生成器（配件/鱼种/玩法）
// 各自往里面插自己的块。历史事故会让生成块积压重复
//（实测涨到 5301 行、同块 7 份、还有标记与注释挤在同一行的脏格式）。
//
// 与其每次去"清理脏块"，不如让**起点就是干净的**：
// 把备份里的生成块全部剥掉，只留手写骨架。生成器从零插入，
// 结果就只取决于手写骨架 —— 与任何历史状态无关。
//
// 用法：node tools/make-tuning-template.js [--write]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const TS = require('./tuning-source.js');

const SRC = path.join(ROOT, '参考资料/_before_partcfg/Tuning.java.bak');
const DST = path.join(ROOT, '参考资料/_before_partcfg/Tuning.template.java');

const src = fs.readFileSync(SRC, 'utf8');
const r = TS.peelAll(src);

console.log('原始：' + src.split('\n').length + ' 行');
console.log('剥除：' + (r.log.join('  ') || '（没有生成块）'));
console.log('结果：' + r.text.split('\n').length + ' 行');
console.log('');
const left = TS.checkSections(r.text);
console.log('残留检查：' + (left.length ? '❌ ' + left.join('; ') : '✅ 一个生成块都不剩'));

// 骨架健全性：还应该有这些手写成员
for (const need of ['private static Config cfg()', 'public static int reload()', 'private static void put(']) {
  console.log('  ' + (r.text.includes(need) ? '✅' : '❌') + ' 保留 ' + need);
}

if (!WRITE) { console.log('\n（预览模式。加 --write 写入模板）'); process.exit(0); }
fs.writeFileSync(DST, r.text, 'utf8');
console.log('\n✅ 模板已写入：' + path.relative(ROOT, DST));
