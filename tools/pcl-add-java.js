// 把指定的 JDK 加进 PCL2 的 JavaList（PCL2 只在启动时写这个文件，这里直接改是安全的）。
// 用法: node tools/pcl-add-java.js <jdk根目录>
const fs = require('fs')
const path = require('path')

const jdkRoot = process.argv[2]
const cfgPath = path.join(process.env.APPDATA, 'PCL', 'config.json')
const binDir = path.join(jdkRoot, 'bin') + path.sep

if (!fs.existsSync(path.join(jdkRoot, 'bin', 'javaw.exe'))) {
  console.error('不是有效的 JDK 目录: ' + jdkRoot); process.exit(1)
}

// 读 JDK 自带的 release 文件解析版本，比执行 java -version 更省事
// （沙箱下 Node 捕获子进程输出会 EPERM）。
const releasePath = path.join(jdkRoot, 'release')
if (!fs.existsSync(releasePath)) { console.error('缺少 release 文件: ' + releasePath); process.exit(1) }
const release = fs.readFileSync(releasePath, 'utf8')
const vm = release.match(/JAVA_RUNTIME_VERSION="([^"]+)"/) || release.match(/JAVA_VERSION="([^"]+)"/)
if (!vm) { console.error('release 里没找到版本号'); process.exit(1) }
const m = vm[1].match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/)
if (!m) { console.error('无法解析版本: ' + vm[1]); process.exit(1) }
const ver = {
  Major: +m[1], Minor: +m[2], Build: +m[3],
  Revision: m[4] ? +m[4] : 0, MajorRevision: 0, MinorRevision: 0,
}
console.log('检测到 Java ' + ver.Major + '.' + ver.Minor + '.' + ver.Build + (m[4] ? '.' + m[4] : ''))
console.log('目录: ' + binDir)

const raw = fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')
const cfg = JSON.parse(raw)
if (!Array.isArray(cfg.JavaList)) cfg.JavaList = []
const norm = (s) => s.replace(/[\\/]+$/, '').toLowerCase()
if (cfg.JavaList.some(e => norm(e.Folder) === norm(binDir))) {
  console.log('JavaList 里已有这个目录，无需重复添加')
} else {
  cfg.JavaList.push({ Folder: binDir, Version: ver })
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
  console.log('已加入 PCL2 JavaList')
}
console.log('\n现在 PCL2 的 Java 列表：')
cfg.JavaList.forEach((e, i) => console.log('  [' + (i + 1) + '] Java ' + e.Version.Major + '.' + e.Version.Minor
  + '.' + e.Version.Build + (e.Version.Revision ? '.' + e.Version.Revision : '') + '  ' + e.Folder))
