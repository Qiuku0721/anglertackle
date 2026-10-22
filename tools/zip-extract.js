// 从 zip/jar 中提取指定条目。兼容 ZIP64 与 data descriptor。
// 用法: node tools/zip-extract.js <zip> <条目名> <输出文件>
const fs = require('fs')
const zlib = require('zlib')

const zipPath = process.argv[2]
const wantName = process.argv[3]
const outPath = process.argv[4]
const buf = fs.readFileSync(zipPath)

// 优先按 local file header 顺序扫描（不依赖中央目录的 ZIP64 扩展字段）
let offset = 0
let found = null
while (offset < buf.length - 30) {
  if (buf.readUInt32LE(offset) !== 0x04034b50) { offset++; continue }
  const flags = buf.readUInt16LE(offset + 6)
  const method = buf.readUInt16LE(offset + 8)
  const compSize = buf.readUInt32LE(offset + 18)
  const uncompSize = buf.readUInt32LE(offset + 22)
  const nameLen = buf.readUInt16LE(offset + 26)
  const extraLen = buf.readUInt16LE(offset + 28)
  const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen)
  const dataStart = offset + 30 + nameLen + extraLen
  if (name === wantName) {
    if (compSize === 0xFFFFFFFF) { console.error('该条目使用 ZIP64，未支持'); process.exit(1) }
    if (flags & 0x08) { console.error('该条目带 data descriptor，未支持'); process.exit(1) }
    const raw = buf.subarray(dataStart, dataStart + compSize)
    found = method === 0 ? raw : zlib.inflateRawSync(raw)
    break
  }
  offset = dataStart + compSize
}
if (!found) { console.error('未找到条目: ' + wantName); process.exit(1) }
fs.writeFileSync(outPath, found)
console.log('已提取 ' + wantName + ' -> ' + outPath + ' (' + found.length + ' 字节)')
