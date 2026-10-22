// 逐行核对我关心的键的原始字节，确认没有被手改或编码异常。
const fs = require('fs')
const buf = fs.readFileSync(process.argv[2])
const lines = buf.toString('utf8').split('\n')
lines.forEach((line, i) => {
  if (/earlyWindowSquir|earlyWindowMaximized|earlyWindowFBScale|earlyWindowWidth|earlyWindowHeight/.test(line)) {
    const raw = Buffer.from(line.replace(/\r$/, ''), 'utf8')
    console.log('第 ' + (i + 1) + ' 行: ' + JSON.stringify(line.replace(/\r$/, '')) + '  | 原始字节: ' + [...raw].map(b => b.toString(16).padStart(2, '0')).join(' '))
  }
})
// 统计行尾风格
const crlf = (buf.toString('binary').match(/\r\n/g) || []).length
const lf = (buf.toString('binary').match(/\n/g) || []).length
console.log('CRLF 行数: ' + crlf + '，LF 总数: ' + lf)
