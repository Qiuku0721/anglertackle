// 以十六进制方式检查某几行的真实内容与行尾，排查"行被合并"的真假。
// 用法: node tools/inspect-lines.js <文件> <起始行> <结束行>
const fs = require('fs')
const file = process.argv[2]
const from = Number(process.argv[3])
const to = Number(process.argv[4])
const buf = fs.readFileSync(file)
const text = buf.toString('utf8')
const crlf = (text.match(/\r\n/g) || []).length
const lf = (text.match(/\n/g) || []).length
console.log('文件 ' + file)
console.log('总字节 ' + buf.length + '，CRLF ' + crlf + ' 处，LF 共 ' + lf + ' 处 → '
  + (crlf === lf ? '全部是 CRLF' : crlf === 0 ? '全部是 LF' : '【混合行尾！】' + (lf - crlf) + ' 个裸 LF'))
const lines = text.split(/\r?\n/)
console.log('按 \\r?\\n 切分后共 ' + lines.length + ' 行')
for (let i = from; i <= Math.min(to, lines.length); i++) {
  const raw = lines[i - 1]
  console.log(String(i).padStart(4) + ' | ' + JSON.stringify(raw.length > 110 ? raw.slice(0, 110) + '…' : raw))
}
