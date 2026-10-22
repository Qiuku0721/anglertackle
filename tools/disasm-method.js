// 反汇编 class 里的单个方法，用来定位 NeoForge 崩溃点的真实调用。
// 用法: node tools/disasm-method.js <jar> <类名(斜杠或点)> <方法名>
const fs = require('fs')
const zlib = require('zlib')

const jarPath = process.argv[2]
const classFilter = process.argv[3]
const methodName = process.argv[4]

const buf = fs.readFileSync(jarPath)
function findEOCD(b) {
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) if (b.readUInt32LE(i) === 0x06054b50) return i
  return -1
}
const eocd = findEOCD(buf)
const count = buf.readUInt16LE(eocd + 10)
let cdOffset = buf.readUInt32LE(eocd + 16)
const entries = []
for (let i = 0; i < count; i++) {
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
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + e.compSize)
  return e.method === 0 ? raw : zlib.inflateRawSync(raw)
}

const target = entries.find(e => e.name.endsWith('.class') && e.name.replace(/\//g, '.').includes(classFilter.replace(/\//g, '.')))
if (!target) { console.error('找不到 class: ' + classFilter); process.exit(1) }
const d = readEntry(target)

// --- 解析常量池 ---
const cpCount = d.readUInt16BE(8)
let p = 10
const cp = new Array(cpCount)
for (let i = 1; i < cpCount; i++) {
  const tag = d[p]
  if (tag === 1) { const len = d.readUInt16BE(p + 1); cp[i] = { t: 'utf8', v: d.toString('utf8', p + 3, p + 3 + len) }; p += 3 + len; continue }
  if (tag === 7) { cp[i] = { t: 'class', v: d.readUInt16BE(p + 1) }; p += 3 }
  else if (tag === 8) { cp[i] = { t: 'string', v: d.readUInt16BE(p + 1) }; p += 3 }
  else if (tag === 9 || tag === 10 || tag === 11) { cp[i] = { t: 'ref', c: d.readUInt16BE(p + 1), nt: d.readUInt16BE(p + 3) }; p += 5 }
  else if (tag === 12) { cp[i] = { t: 'nt', n: d.readUInt16BE(p + 1), ty: d.readUInt16BE(p + 3) }; p += 5 }
  else if (tag === 3 || tag === 4) { cp[i] = { t: 'num', v: tag === 3 ? d.readInt32BE(p + 1) : d.readFloatBE(p + 1) }; p += 5 }
  else if (tag === 5 || tag === 6) { p += 9; i++ }
  else if (tag === 15) { p += 4 }
  else if (tag === 16 || tag === 19 || tag === 20) { p += 3 }
  else if (tag === 17 || tag === 18) { p += 5 }
  else { console.error('未知常量池 tag ' + tag + ' @' + p); process.exit(1) }
}
const utf = i => (cp[i] && cp[i].t === 'utf8' ? cp[i].v : '?')
function refName(i) {
  const r = cp[i]
  if (!r || r.t !== 'ref') return '?'
  const cls = utf(cp[r.c].v)
  const nt = cp[r.nt]
  return cls.replace(/\//g, '.') + '.' + utf(nt.n) + ':' + utf(nt.ty)
}

// --- 跳过字段/方法，找到目标方法的 Code ---
p += 6 // access, this, super
const ifaceCount = d.readUInt16BE(p); p += 2 + ifaceCount * 2
const fieldCount = d.readUInt16BE(p); p += 2
for (let i = 0; i < fieldCount; i++) { p += 6; const ac = d.readUInt16BE(p); p += 2 + ac * 2 }
const methodCount = d.readUInt16BE(p); p += 2

for (let m = 0; m < methodCount; m++) {
  const access = d.readUInt16BE(p)
  const nameIdx = d.readUInt16BE(p + 2)
  const descIdx = d.readUInt16BE(p + 4)
  const attrCount = d.readUInt16BE(p + 6)
  p += 8
  const name = utf(nameIdx)
  const desc = utf(descIdx)
  let codeStart = -1, codeLen = 0, lineTable = null
  for (let a = 0; a < attrCount; a++) {
    const an = utf(d.readUInt16BE(p))
    const alen = d.readUInt32BE(p + 2)
    const abody = p + 6
    if (an === 'Code') {
      codeLen = d.readUInt32BE(abody + 4)
      codeStart = abody + 8
      const excCount = d.readUInt16BE(abody + 8 + codeLen)
      const subCount = d.readUInt16BE(abody + 10 + codeLen + excCount * 8)
      let sp = abody + 12 + codeLen + excCount * 8
      for (let s = 0; s < subCount; s++) {
        const san = utf(d.readUInt16BE(sp))
        const salen = d.readUInt32BE(sp + 2)
        if (san === 'LineNumberTable') {
          const n = d.readUInt16BE(sp + 6)
          lineTable = []
          for (let k = 0; k < n; k++) lineTable.push([d.readUInt16BE(sp + 8 + k * 4), d.readUInt16BE(sp + 10 + k * 4)])
        }
        sp += 6 + salen
      }
    }
    p = abody + alen
  }
  if (name !== methodName) continue

  console.log('### ' + target.name.replace(/\//g, '.') + '.' + name + desc + '  (code ' + codeLen + ' bytes)')
  const code = d.subarray(codeStart, codeStart + codeLen)
  const lineAt = off => { if (!lineTable) return '?'; let ln = '?'; for (const [o, l] of lineTable) { if (o <= off) ln = l; else break } return ln }
  let i = 0
  const stack = []
  while (i < code.length) {
    const pc = i
    const op = code[i++]
    let text = null
    if (op === 0x2a) { stack.push('this'); continue }
    if (op >= 0x1a && op <= 0x1d) { stack.push('local' + (op - 0x1a)); continue }
    if (op >= 0x2b && op <= 0x2d) { stack.push('local' + (op - 0x2a)); continue }
    if (op === 0xb2 || op === 0xb3) { const idx = code.readUInt16BE(i); i += 2; const r = cp[idx]; text = (op === 0xb2 ? 'getstatic ' : 'putstatic ') + refName(idx); if (op === 0xb2) stack.push(refName(idx).split('.').pop().split(':')[0]) }
    else if (op === 0xb4 || op === 0xb5) { const idx = code.readUInt16BE(i); i += 2; text = (op === 0xb4 ? 'getfield ' : 'putfield ') + refName(idx) }
    else if (op === 0xb6 || op === 0xb7 || op === 0xb8 || op === 0xb9) { const idx = code.readUInt16BE(i); i += op === 0xb9 ? 4 : 2; text = 'invoke ' + refName(idx) }
    else if (op === 0xbb) { const idx = code.readUInt16BE(i); i += 2; text = 'new ' + utf(cp[idx].v).replace(/\//g, '.'); stack.push(utf(cp[idx].v).replace(/\//g, '.')) }
    else if (op === 0x12) { const idx = code[i++]; text = 'ldc ' + JSON.stringify(utf(idx)) }
    else if (op === 0x13 || op === 0x14) { const idx = code.readUInt16BE(i); i += 2; const c = cp[idx]; text = 'ldc ' + JSON.stringify(c.t === 'string' ? utf(c.v) : c.t === 'num' ? c.v : refName(idx)) }
    else if (op === 0x57 || op === 0x58) { text = 'pop' }
    else if (op === 0x59) { text = 'dup' }
    else if (op === 0xb0 || op === 0xac || op === 0xbf || op === 0xb1 || op === 0xbe) { text = { 0xb0: 'areturn', 0xac: 'ireturn', 0xbf: 'athrow', 0xb1: 'return', 0xbe: 'arraylength' }[op] }
    else if (op === 0x03 || op === 0x04 || op === 0x05 || op === 0x06 || op === 0x07 || op === 0x08) text = 'iconst_' + (op - 3)
    else if (op === 0x02) text = 'iconst_m1'
    else if (op === 0x99 || op === 0x9a) { const off = code.readInt16BE(i); i += 2; text = (op === 0x99 ? 'ifeq ' : 'ifne ') + (pc + off) }
    else if (op === 0xa7) { const off = code.readInt16BE(i); i += 2; text = 'goto ' + (pc + off) }
    else if (op >= 0x3b && op <= 0x83) { /* loads/stores */ }
    else { text = 'opcode 0x' + op.toString(16) }
    if (text) {
      const mark = lineAt(pc) === 238 || lineAt(pc) === 215 ? '  <<<<< 崩溃行 ' + lineAt(pc) : ''
      console.log(String(pc).padStart(5) + '  L' + String(lineAt(pc)).padStart(4) + '  ' + text + mark)
    }
  }
}
