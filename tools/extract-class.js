// 从 jar 中提取单个 class 到磁盘，便于用 javap 反汇编。
// 用法: node tools/extract-class.js <jar> <类名(点或斜杠)> <输出文件>
const fs = require('fs')
const zlib = require('zlib')

const jarPath = process.argv[2]
const className = process.argv[3].replace(/\./g, '/')
const outPath = process.argv[4]

const buf = fs.readFileSync(jarPath)
function findEOCD(b) {
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) if (b.readUInt32LE(i) === 0x06054b50) return i
  return -1
}
const eocd = findEOCD(buf)
if (eocd < 0) { console.error('不是有效 zip'); process.exit(1) }
const count = buf.readUInt16LE(eocd + 10)
let cdOffset = buf.readUInt32LE(eocd + 16)
let found = null
for (let i = 0; i < count; i++) {
  const method = buf.readUInt16LE(cdOffset + 10)
  const compSize = buf.readUInt32LE(cdOffset + 20)
  const nameLen = buf.readUInt16BE(cdOffset + 28)
  const extraLen = buf.readUInt16BE(cdOffset + 30)
  const commentLen = buf.readUInt16BE(cdOffset + 32)
  const localOffset = buf.readUInt32LE(cdOffset + 42)
  const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen)
  if (name === className + '.class') found = { name, method, compSize, localOffset }
  cdOffset += 46 + nameLen + extraLen + commentLen
}
if (!found) { console.error('jar 里没有 ' + className + '.class'); process.exit(1) }
const lo = found.localOffset
const nameLen = buf.readUInt16LE(lo + 26)
const extraLen = buf.readUInt16LE(lo + 28)
const start = lo + 30 + nameLen + extraLen
const raw = buf.subarray(start, start + found.compSize)
const data = found.method === 0 ? raw : zlib.inflateRawSync(raw)
fs.writeFileSync(outPath, data)
console.log('已提取 ' + found.name + ' -> ' + outPath + ' (' + data.length + ' 字节)')
