/*
 * check-nbt-writer.js —— 证明 lib-nbt.js 的 NBT 写入器是**字节级正确**的。
 *
 * 为什么这个检查是必须的，而不是"锦上添花"：
 *   结构文件写坏的表现是**静默不生成** —— 游戏不报错、日志里没有一行，
 *   你只会觉得"走了半天没找到小屋"。而且坏法很隐蔽：把 IntArray 写成 List<Int>、
 *   把空表的元素类型从 0 写成 10，**游戏里看着完全一样**，只是不生成。
 *
 * 所以判据不能是"读回来数值对"，必须是**最强的那个**：
 *   原文件 → gunzip → 读成带类型的树 → 写回字节 → 与 gunzip 后的原字节**逐字节比对**。
 *   只要有一个标签类型或长度前缀写错，这一步必然红。
 *
 * 覆盖范围：拿真实的渔夫小屋结构当样本（48 种方块调色板、IntArray 尺寸、
 * List<Int> 坐标、空 List<Compound> 的 Items、嵌套 Compound 的 Properties）。
 *
 * 用法：node tools/check-nbt-writer.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('./lib-nbt');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src/main/resources/data/anglertackle/structure/fisherman_hut.nbt');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== NBT 写入器字节级校验 ===\n');

if (!fs.existsSync(FILE)) {
  console.log('  ⚠  没有结构样本（' + path.relative(ROOT, FILE) + '），跳过。');
  console.log('     （导入结构后这个检查就会自动开始工作）');
  process.exit(0);
}

// ---------------------------------------------------------------- ① 逐字节 round-trip
const raw = fs.readFileSync(FILE);
const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
const plain = isGzip ? zlib.gunzipSync(raw) : raw;
console.log('  样本：' + path.basename(FILE) + '  ' + raw.length + ' 字节'
  + (isGzip ? '（gzip）' : '（未压缩）') + '  → 解压后 ' + plain.length + ' 字节\n');

let typed = null;
try {
  typed = nbt.readNbtTyped(FILE);
  ok('能读成带类型的树（根：' + typed.name + '，顶层键 ' + Object.keys(typed.root.v).length + ' 个）');
} catch (e) {
  bad('读不了：' + e.message);
  process.exit(1);
}

let written = null;
try {
  written = nbt.writeNbtTyped(typed.name, typed.root);
  ok('能写回字节（' + written.length + ' 字节）');
} catch (e) {
  bad('写不了：' + e.message);
  process.exit(1);
}

if (written.length !== plain.length) {
  bad('长度不一致：写出 ' + written.length + '，原始 ' + plain.length
    + '（差 ' + (written.length - plain.length) + ' 字节 —— 多半是某个长度前缀或列表元素类型写错了）');
} else {
  ok('长度一致（' + written.length + ' 字节）');
}

if (Buffer.compare(written, plain) === 0) {
  ok('**逐字节完全一致** —— 写入器对本样本是精确的');
} else {
  bad('字节不一致 —— 逐位置找出第一处差异：');
  const n = Math.min(written.length, plain.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 5; i++) {
    if (written[i] !== plain[i]) {
      console.log('      偏移 ' + i + '：原始 0x' + plain[i].toString(16).padStart(2, '0')
        + ' vs 写出 0x' + written[i].toString(16).padStart(2, '0'));
      shown++;
    }
  }
  if (!shown) console.log('      前缀相同，差异在长度上');
}

// ---------------------------------------------------------------- ② 再读一遍，树必须相等
{
  const tmp = path.join(ROOT, 'build', '_nbt-roundtrip.nbt');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  nbt.writeNbtFile(tmp, typed.name, typed.root);
  const again = nbt.readNbtTyped(tmp);
  const a = JSON.stringify(nbt.readNbtTyped(FILE));
  const b = JSON.stringify(again);
  if (a === b) ok('写文件 → 再读 → 带类型的树完全相同');
  else bad('写文件 → 再读 → 树变了（写入器丢信息了）');
  // 位置无关的形态校验：普通读取器也要能读
  const s = nbt.summarize(tmp);
  if (s.blocks > 0 && s.size.every((v) => v > 0)) ok('写出的文件用普通读取器也能解析（' + s.size.join('×') + '，' + s.blocks + ' 方块）');
  else bad('写出的文件普通读取器解析不出内容');
  fs.rmSync(tmp, { force: true });
}

// ---------------------------------------------------------------- ③ 故意写错必须被发现
// 这一条很重要：证明 ① 的"逐字节一致"不是碰巧（比如两边都走了同一条错误路径）。
{
  const t2 = nbt.readNbtTyped(FILE);
  const sz = t2.root.v.size;
  // size 在原文件里是 List<Int>（源码：save() 用 newIntegerList → ListTag）。
  // 把它改成 IntArray —— 这是最容易犯的那类错，而且**游戏里看着一模一样**。
  if (sz.t === 9) {
    t2.root.v.size = nbt.N.intArray(sz.v.items.map((x) => x.v));
    const w2 = nbt.writeNbtTyped(t2.name, t2.root);
    if (Buffer.compare(w2, plain) !== 0) ok('把 size 从 List<Int> 改成 IntArray 会被逐字节比对抓到（证明判据有效）');
    else bad('把 size 类型改错竟然还能逐字节一致 —— 判据无效');
  } else {
    bad('样本里 size 不是 List<Int>（是 TAG ' + sz.t + '）—— 与源码 save() 的写法不符，需要重查');
  }

  const t3 = nbt.readNbtTyped(FILE);
  // 空列表元素类型 0 → 10
  const ents = t3.root.v.entities;
  if (ents && ents.t === 9 && ents.v.et === 0) {
    ents.v.et = 10;
    const w3 = nbt.writeNbtTyped(t3.name, t3.root);
    if (Buffer.compare(w3, plain) !== 0) ok('把空列表的元素类型从 0 改成 10 也会被抓到');
    else bad('空列表元素类型改了却一样 —— 判据无效');
  } else {
    console.log('  ℹ  样本里 entities 不是"元素类型 0 的空表"，跳过这一条');
  }

  // 少写一个 TAG_End / 多写一个 —— 都必须是红的
  const t4 = nbt.readNbtTyped(FILE);
  const w4 = Buffer.concat([nbt.writeNbtTyped(t4.name, t4.root), Buffer.from([0])]);
  if (Buffer.compare(w4, plain) !== 0) ok('多出一个字节（比如根标签后面多写 TAG_End）也会被抓到');
  else bad('多一个字节却一致 —— 判据无效');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  判据是"逐字节一致"，不是"读回来数值对"：');
console.log('    标签类型写错（IntArray ↔ List<Int>）、空列表元素类型写错、');
console.log('    长度前缀写错 —— 这些在游戏里**表现完全一样**（结构静默不生成），');
console.log('    只有字节级比对能挡住。');
process.exitCode = fail === 0 ? 0 : 1;
