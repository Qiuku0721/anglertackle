// 给 ps1 补回 UTF-8 BOM。
// 为什么必须补：这台机器上是 Windows PowerShell 5.1，它读**没有 BOM** 的 .ps1 会按
// 系统 ANSI（中文机器上是 GBK）解码 —— 脚本里的中文立刻变乱码，
// 更糟的是某些汉字的 GBK 字节里带引号/反引号，会直接把语法搞坏。
// 编辑工具保存时会把 BOM 吃掉，所以每次改完 ps1 都要跑一下这个。
const fs = require('fs'), path = require('path');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/ensure-bom.js <file.ps1> [...]');
  process.exit(1);
}
let fixed = 0, already = 0, bad = 0;
for (const f of files) {
  const p = path.resolve(f);
  if (!fs.existsSync(p)) { console.log('❌ 找不到 ' + f); bad++; continue; }
  const buf = fs.readFileSync(p);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { console.log('⏭ ' + path.basename(f) + ' 已有 BOM'); already++; continue; }
  // 校验一下确实是 UTF-8（不然加 BOM 只会让乱码更确定）
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD')) { console.log('❌ ' + f + ' 不是合法 UTF-8，先修编码'); bad++; continue; }
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), buf]));
  console.log('✅ ' + path.basename(f) + ' 已补 BOM（' + (buf.length + 3) + ' 字节）');
  fixed++;
}
console.log('\n补了 ' + fixed + ' 个，本来就有 ' + already + ' 个' + (bad ? '，失败 ' + bad + ' 个' : ''));
process.exit(bad ? 1 : 0);
