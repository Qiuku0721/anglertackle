// lib-nbt.js —— Minecraft 结构文件（.nbt）的解析。**没有外部依赖**。
//
// 为什么单独抽成一个模块：本仓库有不止一处要读结构文件
// （read-structure.js 给人看、import-structure.js 导入时做回读校验、
//  将来的 worldgen 自检也要断言"码头在结构的哪一侧"）。
//
// ⚠ 抽出来还有一个很实际的理由：**这个沙箱禁止 node 用管道捕获子进程输出**
//   （spawnSync/execFileSync 会 EPERM）。所以"调用另一个脚本再读它的 stdout"
//   这条路是走不通的，要做校验只能在**同一个进程里 require**。
//   import-structure.js 第一版就是 execFileSync 调 read-structure.js，直接 EPERM。
//
// 格式（1.21）：
//   size:    [x, y, z]                      结构尺寸
//   palette: [{Name:"minecraft:oak_planks", Properties:{...}}, ...]   方块种类表
//   blocks:  [{pos:[x,y,z], state:<palette 下标>, nbt:{...}?}, ...]   每个方块
//   entities:[{pos:[...], nbt:{...}}, ...]
//   DataVersion: <int>
//
// 数据包里的路径是 data/<命名空间>/structure/<名字>.nbt —— **structure 是单数**。
// 1.20 及以前是 structures。写成复数不会报错，结构就是永远不生成。
// （从 minecraft_1.21.1_client.jar 数出来的：structure/ 下 1180 个 .nbt，
//   没有 structures 目录。）
const fs = require('fs'), zlib = require('zlib');

const TAG = { 0: 'End', 1: 'Byte', 2: 'Short', 3: 'Int', 4: 'Long', 5: 'Float',
              6: 'Double', 7: 'ByteArray', 8: 'String', 9: 'List', 10: 'Compound',
              11: 'IntArray', 12: 'LongArray' };

class R {
  constructor(buf) { this.b = buf; this.i = 0; }
  u1() { return this.b[this.i++]; }
  i1() { const v = this.b.readInt8(this.i); this.i += 1; return v; }
  i2() { const v = this.b.readInt16BE(this.i); this.i += 2; return v; }
  i4() { const v = this.b.readInt32BE(this.i); this.i += 4; return v; }
  i8() { const v = this.b.readBigInt64BE(this.i); this.i += 8; return Number(v); }
  f4() { const v = this.b.readFloatBE(this.i); this.i += 4; return v; }
  f8() { const v = this.b.readDoubleBE(this.i); this.i += 8; return v; }
  str() { const n = this.b.readUInt16BE(this.i); this.i += 2;
          const s = this.b.toString('utf8', this.i, this.i + n); this.i += n; return s; }

  payload(type) {
    switch (type) {
      case 1: return this.i1();
      case 2: return this.i2();
      case 3: return this.i4();
      case 4: { const v = this.b.readBigInt64BE(this.i); this.i += 8; return Number(v); }
      case 5: return this.f4();
      case 6: return this.f8();
      case 7: { const n = this.i4(); const a = this.b.subarray(this.i, this.i + n); this.i += n; return a; }
      case 8: return this.str();
      case 9: {
        const et = this.u1(); const n = this.i4();
        const out = [];
        for (let k = 0; k < n; k++) out.push(this.payload(et));
        return out;
      }
      case 10: {
        const out = {};
        for (;;) {
          const t = this.u1();
          if (t === 0) break;
          const name = this.str();
          out[name] = this.payload(t);
        }
        return out;
      }
      case 11: { const n = this.i4(); const a = []; for (let k = 0; k < n; k++) a.push(this.i4()); return a; }
      case 12: { const n = this.i4(); const a = []; for (let k = 0; k < n; k++) a.push(Number(this.i8())); return a; }
      default: throw new Error('未知 TAG 类型 ' + type + '（偏移 ' + this.i + '）');
    }
  }
}

/** 读 .nbt（自动识别 gzip / 未压缩）。 */
function readNbt(file) {
  const raw = fs.readFileSync(file);
  const buf = (raw[0] === 0x1f && raw[1] === 0x8b) ? zlib.gunzipSync(raw) : raw;
  const r = new R(buf);
  const type = r.u1();
  if (type !== 10) throw new Error('根标签不是 Compound（是 ' + TAG[type] + '）');
  const name = r.str();
  return { name, root: r.payload(10) };
}

/** 把一个结构文件整理成便于处理的形状。 */
function summarize(file) {
  const { root } = readNbt(file);
  const size = root.size || [0, 0, 0];
  const palette = (root.palette || []).map((p) => String(p.Name));
  const counts = new Map();
  for (const b of root.blocks || []) {
    const n = palette[b.state] || '?';
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return {
    file, size,
    blocks: (root.blocks || []).length,
    entities: (root.entities || []).length,
    paletteSize: palette.length,
    counts: [...counts].sort((a, b) => b[1] - a[1]),
    root,
  };
}

/** 把方块铺成 grid[x][y][z] → 方块名（"minecraft:" 前缀去掉，空气记 null）。 */
function buildGrid(root) {
  const [sx, sy, sz] = root.size || [0, 0, 0];
  const palette = (root.palette || []).map((p) => String(p.Name).replace(/^minecraft:/, ''));
  const grid = [];
  for (let x = 0; x < sx; x++) {
    grid.push([]);
    for (let y = 0; y < sy; y++) grid[x].push(new Array(sz).fill(null));
  }
  for (const b of root.blocks || []) {
    const [x, y, z] = b.pos;
    const name = palette[b.state] || '?';
    grid[x][y][z] = /(^|_)air$/.test(name) ? null : name;
  }
  return { grid, size: [sx, sy, sz] };
}

/** 按出现频次给方块分配单字符，返回 {sym, legend}。 */
function makeSymbols(counts) {
  const chars = '#@%&*+=~^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const sym = new Map();
  const legend = [];
  let i = 0;
  for (const [name, c] of counts) {
    if (i >= chars.length) break;
    sym.set(name, chars[i]);
    legend.push([chars[i], name, c]);
    i++;
  }
  return { sym, legend };
}

module.exports = { TAG, readNbt, summarize, buildGrid, makeSymbols };

// ================================================================ 带类型的读写
//
// 为什么需要"带类型"的一套：**光看 JS 的值没法还原 NBT 的类型**。
// 结构文件里 `size` 是 IntArray、`pos` 是 List<Int>、`CookingTimes` 是 IntArray、
// `Items` 是 List<Compound>（空的）—— 在 JS 里它们全是"数字数组"。
// 一厢情愿地做类型推断就会把它们写坏，而**结构文件坏掉的表现是静默不生成**，
// 不是报错。所以读的时候就把类型记下来，写的时候原样还原。
//
// 节点形状：{ t: <TAG 号>, v: <值> }
//   Compound → v 是 { 键: 节点 }
//   List     → v 是 { et: 元素类型, items: [节点] }   ← et 必须存，空表也要存
//   ByteArray→ v 是 Buffer；IntArray/LongArray → v 是数组；其余 → v 是数字/字符串

class RT {
  constructor(buf) { this.b = buf; this.i = 0; }
  u1() { return this.b[this.i++]; }
  i1() { const v = this.b.readInt8(this.i); this.i += 1; return v; }
  i2() { const v = this.b.readInt16BE(this.i); this.i += 2; return v; }
  i4() { const v = this.b.readInt32BE(this.i); this.i += 4; return v; }
  i8() { const v = this.b.readBigInt64BE(this.i); this.i += 8; return Number(v); }
  f4() { const v = this.b.readFloatBE(this.i); this.i += 4; return v; }
  f8() { const v = this.b.readDoubleBE(this.i); this.i += 8; return v; }
  str() { const n = this.b.readUInt16BE(this.i); this.i += 2;
          const s = this.b.toString('utf8', this.i, this.i + n); this.i += n; return s; }

  payload(type) {
    switch (type) {
      case 1: return { t: 1, v: this.i1() };
      case 2: return { t: 2, v: this.i2() };
      case 3: return { t: 3, v: this.i4() };
      case 4: return { t: 4, v: this.i8() };
      case 5: return { t: 5, v: this.f4() };
      case 6: return { t: 6, v: this.f8() };
      case 7: { const n = this.i4(); const a = Buffer.from(this.b.subarray(this.i, this.i + n)); this.i += n; return { t: 7, v: a }; }
      case 8: return { t: 8, v: this.str() };
      case 9: {
        const et = this.u1(); const n = this.i4();
        const items = [];
        for (let k = 0; k < n; k++) items.push(this.payload(et));
        return { t: 9, v: { et, items } };
      }
      case 10: {
        const v = {};
        for (;;) {
          const t = this.u1();
          if (t === 0) break;
          const name = this.str();
          v[name] = this.payload(t);
        }
        return { t: 10, v };
      }
      case 11: { const n = this.i4(); const a = []; for (let k = 0; k < n; k++) a.push(this.i4()); return { t: 11, v: a }; }
      case 12: { const n = this.i4(); const a = []; for (let k = 0; k < n; k++) a.push(this.i8()); return { t: 12, v: a }; }
      default: throw new Error('未知 TAG 类型 ' + type + '（偏移 ' + this.i + '）');
    }
  }
}

/** 读成带类型的树（写回时用这个，不要用 readNbt）。 */
function readNbtTyped(file) {
  const raw = fs.readFileSync(file);
  const buf = (raw[0] === 0x1f && raw[1] === 0x8b) ? zlib.gunzipSync(raw) : raw;
  const r = new RT(buf);
  const type = r.u1();
  if (type !== 10) throw new Error('根标签不是 Compound');
  const name = r.str();
  return { name, root: r.payload(10) };
}

class WR {
  constructor() { this.parts = []; this.len = 0; }
  push(b) { this.parts.push(b); this.len += b.length; }
  u1(v) { const b = Buffer.alloc(1); b.writeUInt8(((v % 256) + 256) % 256, 0); this.push(b); }
  i2(v) { const b = Buffer.alloc(2); b.writeInt16BE(v, 0); this.push(b); }
  i4(v) { const b = Buffer.alloc(4); b.writeInt32BE(v, 0); this.push(b); }
  i8(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v), 0); this.push(b); }
  f4(v) { const b = Buffer.alloc(4); b.writeFloatBE(v, 0); this.push(b); }
  f8(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v, 0); this.push(b); }
  str(s) { const b = Buffer.from(s, 'utf8'); this.i2(b.length); this.push(b); }

  node(n) {
    switch (n.t) {
      case 1: this.u1(n.v); break;
      case 2: this.i2(n.v); break;
      case 3: this.i4(n.v); break;
      case 4: this.i8(n.v); break;
      case 5: this.f4(n.v); break;
      case 6: this.f8(n.v); break;
      case 7: this.i4(n.v.length); this.push(n.v); break;
      case 8: this.str(n.v); break;
      case 9:
        // ⚠ 元素类型必须原样写回：空表的 et 通常是 0（TAG_End），
        //   写成 10 会让"空列表"变成"元素类型为 Compound 的空列表" ——
        //   数值上没差别，但字节不同，round-trip 比对就会失败（这是好事）。
        this.u1(n.v.et); this.i4(n.v.items.length);
        for (const it of n.v.items) this.node(it);
        break;
      case 10:
        for (const k of Object.keys(n.v)) { this.u1(n.v[k].t); this.str(k); this.node(n.v[k]); }
        this.u1(0);   // TAG_End 收尾
        break;
      case 11: this.i4(n.v.length); for (const x of n.v) this.i4(x); break;
      case 12: this.i4(n.v.length); for (const x of n.v) this.i8(x); break;
      default: throw new Error('写不了 TAG 类型 ' + n.t);
    }
  }

  out() { return Buffer.concat(this.parts, this.len); }
}

/** 把带类型的树写成 NBT 字节（未压缩）。 */
function writeNbtTyped(name, root) {
  const w = new WR();
  w.u1(10); w.str(name); w.node(root);
  // ⚠ 这里**不能**再补一个 0x00：Compound 的 payload 自带 TAG_End 收尾，
  //   根标签没有额外字节。多写一个的后果是文件比原来长 1 字节，
  //   而且前 110598 字节完全一致 —— 只有逐字节比对能发现。
  //   （第一版就多写了这一个字节，被 check-nbt-writer.js 当场抓到。）
  return w.out();
}

/** 把带类型的树写成 gzip 压缩的 .nbt 文件。 */
function writeNbtFile(file, name, root) {
  fs.writeFileSync(file, zlib.gzipSync(writeNbtTyped(name, root)));
}

// ---- 构造节点的小工具 ----
const N = {
  byte: (v) => ({ t: 1, v }),
  short: (v) => ({ t: 2, v }),
  int: (v) => ({ t: 3, v }),
  long: (v) => ({ t: 4, v }),
  float: (v) => ({ t: 5, v }),
  double: (v) => ({ t: 6, v }),
  str: (v) => ({ t: 8, v }),
  intArray: (v) => ({ t: 11, v }),
  longArray: (v) => ({ t: 12, v }),
  list: (et, items) => ({ t: 9, v: { et, items } }),
  compound: (v) => ({ t: 10, v }),
  /** 深拷贝一个节点（避免两处共享同一对象被改花）。 */
  clone: cloneNode,
};

/** 深拷贝一个带类型的节点。不要用 JSON 往返 —— Buffer（ByteArray）会被转成 {type,data}。 */
function cloneNode(n) {
  if (n.t === 7) return { t: 7, v: Buffer.from(n.v) };
  if (n.t === 9) return { t: 9, v: { et: n.v.et, items: n.v.items.map(cloneNode) } };
  if (n.t === 10) {
    const v = {};
    for (const k of Object.keys(n.v)) v[k] = cloneNode(n.v[k]);
    return { t: 10, v };
  }
  if (n.t === 11 || n.t === 12) return { t: n.t, v: n.v.slice() };
  return { t: n.t, v: n.v };
}

/** 取 Compound 节点里某个键，没有就返回 null。 */
function get(node, key) {
  return node && node.t === 10 && node.v[key] !== undefined ? node.v[key] : null;
}
/** 取 List<Double> / List<Int> 这类列表的 JS 数组（只取值，丢类型）。 */
function nums(node) {
  return node && node.t === 9 ? node.v.items.map((x) => x.v) : null;
}

module.exports.readNbtTyped = readNbtTyped;
module.exports.writeNbtTyped = writeNbtTyped;
module.exports.writeNbtFile = writeNbtFile;
module.exports.N = N;
module.exports.get = get;
module.exports.nums = nums;

