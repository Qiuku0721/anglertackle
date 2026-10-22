// 从 jar 里的 class 文件中提取常量池字符串，用于确认某个类读取了哪些配置键。
// 用法: node tools/scan-neoforge-strings.js <jar> <类名片段> [过滤关键字]
const fs = require('fs')
const zlib = require('zlib')

const jarPath = process.argv[2]
const classFilter = process.argv[3] || ''
const keyword = process.argv[4] || ''

const buf = fs.readFileSync(jarPath)

// --- 最小 ZIP 中央目录解析 ---
function findEOCD(b) {
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}
const eocd = findEOCD(buf)
if (eocd < 0) { console.error('不是有效的 zip/jar'); process.exit(1) }
const count = buf.readUInt16LE(eocd + 10)
let cdOffset = buf.readUInt32LE(eocd + 16)

const entries = []
for (let i = 0; i < count; i++) {
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break
  const method = buf.readUInt16LE(cdOffset + 10)
  const compSize = buf.readUInt32LE(cdOffset + 20)
  const nameLen = buf.readUInt16LE(cdOffset + 28)
  const extraLen = buf.readUInt16LE(cdOffset + 30)
  const commentLen = buf.readUInt16LE(cdOffset + 32)
  const localOffset = buf.readUInt32LE(cdOffset + 42)
  const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen)
  entries.push({ name, method, compSize, localOffset })
  cdOffset += 46 + nameLen + extraLen + commentLen
}

function readEntry(e) {
  const lo = e.localOffset
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('bad local header for ' + e.name)
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + e.compSize)
  return e.method === 0 ? raw : zlib.inflateRawSync(raw)
}

// --- 从 class 常量池提取 UTF8 字符串 ---
function classStrings(data) {
  if (data.readUInt32BE(0) !== 0xCAFEBABE) return []
  const cpCount = data.readUInt16BE(8)
  let p = 10
  const utf8 = []
  for (let i = 1; i < cpCount; i++) {
    const tag = data[p]
    if (tag === 1) {
      const len = data.readUInt16BE(p + 1)
      utf8.push(data.toString('utf8', p + 3, p + 3 + len))
      p += 3 + len
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) p += 3
    else if (tag === 15) p += 4
    else if (tag === 3 || tag === 4 || tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) p += 5
    else if (tag === 5 || tag === 6) { p += 9; i++ }
    else break
  }
  return utf8
}

const targets = entries.filter(e => e.name.endsWith('.class') && e.name.includes(classFilter))
if (!targets.length) { console.error('没找到匹配的 class: ' + classFilter); process.exit(1) }

for (const e of targets) {
  let strs
  try { strs = classStrings(readEntry(e)) } catch (err) { continue }
  const hits = keyword ? strs.filter(s => s.includes(keyword)) : strs
  if (!hits.length) continue
  console.log('=== ' + e.name + ' ===')
  for (const s of hits) console.log('   ' + JSON.stringify(s))
}
