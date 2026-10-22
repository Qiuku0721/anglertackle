// 校验 NeoForge 运行库的完整性：与版本 json / install profile 里的 sha1 对比。
// 用法: node tools/verify-libs.js <版本目录>
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const verDir = process.argv[2]
const mcRoot = process.argv[3]

// 1) 直接校验我们自己关心的两个 jar 能否完整解压、class 是否可读
function checkJar(jarPath, label) {
  console.log('\n===== ' + label + ' =====')
  console.log(jarPath)
  if (!fs.existsSync(jarPath)) { console.log('  【文件不存在】'); return }
  const buf = fs.readFileSync(jarPath)
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex')
  console.log('  大小: ' + buf.length + ' 字节')
  console.log('  sha1: ' + sha1)
  // 统计 local file header 数量与 EOCD 记录的条目数是否一致
  let local = 0
  for (let i = 0; i + 30 < buf.length; i++) {
    if (buf.readUInt32LE(i) === 0x04034b50) local++
  }
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) { console.log('  【没有 EOCD，文件被截断！】'); return }
  const cdCount = buf.readUInt16LE(eocd + 10)
  console.log('  中央目录条目数: ' + cdCount + ' (local header 扫描到 ' + local + ')')
  if (cdCount !== local) console.log('  【条目数不一致，zip 可能损坏】')
  else console.log('  zip 结构一致')
}

checkJar(path.join(mcRoot, 'libraries/net/neoforged/fancymodloader/loader/4.0.44/loader-4.0.44.jar'), 'fml_loader 4.0.44')
checkJar(path.join(mcRoot, 'libraries/net/neoforged/fancymodloader/earlydisplay/4.0.44/earlydisplay-4.0.44.jar'), 'fml_earlydisplay 4.0.44')
checkJar(path.join(mcRoot, 'libraries/net/neoforged/neoforge/21.1.250/neoforge-21.1.250-universal.jar'), 'neoforge 21.1.250 universal')
checkJar(path.join(mcRoot, 'libraries/net/neoforged/neoforge/21.1.250/neoforge-21.1.250-client.jar'), 'neoforge 21.1.250 client')

// 2) 与版本 json 中的库 sha1 对比
console.log('\n===== 对照版本 json 里的 sha1 =====')
const jsonPath = fs.readdirSync(verDir).filter(f => f.endsWith('.json')).map(f => path.join(verDir, f))[0]
if (!jsonPath) { console.log('  没找到版本 json'); process.exit(0) }
const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
let checked = 0, bad = 0
for (const lib of (j.libraries || [])) {
  const art = lib.downloads && lib.downloads.artifact
  if (!art || !art.path || !art.sha1) continue
  if (!/fancymodloader|neoforge/i.test(art.path)) continue
  const p = path.join(mcRoot, 'libraries', art.path)
  if (!fs.existsSync(p)) { console.log('  缺失: ' + art.path); bad++; continue }
  const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')
  const ok = h === art.sha1
  if (!ok) bad++
  console.log('  ' + (ok ? 'OK  ' : '【损坏】') + ' ' + art.path)
  checked++
}
console.log('  共校验 ' + checked + ' 个，损坏/缺失 ' + bad + ' 个')
