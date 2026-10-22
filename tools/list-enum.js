// 从 jar 里列出某个类的全部 enum 常量名。
// 用法: node tools/list-enum.js <jar> <类名路径片段> [类名]
const fs = require('fs');
const zlib = require('zlib');

const jar = process.argv[2];
const filter = process.argv[3];
const buf = fs.readFileSync(jar);

function entries(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = b.readUInt16LE(off + 10);
    const compSize = b.readUInt32LE(off + 20);
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const localOffset = b.readUInt32LE(off + 42);
    const name = b.toString('utf8', off + 46, off + 46 + nameLen);
    out.push({ name, method, compSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(e) {
  const lo = e.localOffset;
  const nameLen = b0.readUInt16LE(lo + 26);
  const extraLen = b0.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = b0.subarray(start, start + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw);
}
const b0 = buf;

const all = entries(buf);
const hits = all.filter(e => e.name.endsWith('.class') && e.name.includes(filter));

for (const e of hits.slice(0, 40)) {
  let d;
  try { d = readEntry(e); } catch (err) { continue; }
  if (d.readUInt32BE(0) !== 0xCAFEBABE) continue;
  // 简单扫常量池里的 UTF8 字符串，挑出像 enum 常量名的
  const cpCount = d.readUInt16BE(8);
  let p = 10;
  const names = [];
  for (let i = 1; i < cpCount; i++) {
    const tag = d[p];
    if (tag === 1) {
      const len = d.readUInt16BE(p + 1);
      names.push(d.toString('utf8', p + 3, p + 3 + len));
      p += 3 + len;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) p += 3;
    else if (tag === 15) p += 4;
    else if (tag === 3 || tag === 4 || tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) p += 5;
    else if (tag === 5 || tag === 6) { p += 9; i++; }
    else break;
  }
  // enum 常量通常是全大写下划线，且在同一类的 $VALUES 附近
  const likely = names.filter(n => /^[A-Z][A-Z0-9_]{2,}$/.test(n));
  if (likely.length) {
    console.log('=== ' + e.name + ' ===');
    console.log('  ' + [...new Set(likely)].join(', '));
  }
}
