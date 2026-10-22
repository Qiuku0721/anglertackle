// 安全地增删语言文件条目：保留原有键顺序，写成无 BOM 的 UTF-8。
// 用法: node tools/lang-set.js <json> <key> <value> [<key> <value> ...]
const fs = require('fs')
const file = process.argv[2]
const pairs = process.argv.slice(3)
if (pairs.length % 2 !== 0) { console.error('键值必须成对'); process.exit(2) }

const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
const obj = JSON.parse(raw)
let added = 0, changed = 0
for (let i = 0; i < pairs.length; i += 2) {
  const k = pairs[i], v = pairs[i + 1]
  if (Object.prototype.hasOwnProperty.call(obj, k)) { if (obj[k] !== v) changed++; else continue }
  else added++
  obj[k] = v
}
// 按 字母序 + 分组前缀 排序，保持文件可读
const sorted = {}
for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
console.log(file.split(/[\\/]/).pop() + ': 新增 ' + added + ' 条，改动 ' + changed + ' 条，共 ' + Object.keys(sorted).length + ' 条')
