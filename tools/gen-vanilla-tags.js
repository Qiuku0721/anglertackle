/*
 * 从 minecraft 客户端 jar 抽出**全部 vanilla 标签名**，存成静态清单。
 *
 * ── 为什么需要 ────────────────────────────────────────────────
 * 用户 `/locate` 报"无法找到结构"，翻日志才看到：
 *   [ERROR] TagLoader: Couldn't load tag anglertackle:has_fisherman_hut
 *           as it is missing following references:
 * 我写的群系标签引用了 `#minecraft:is_swamp` —— 而 **vanilla 根本没有这个标签**
 * （只有 is_river / is_beach / is_ocean / is_swamp… 里的前三个，没有 swamp）。
 * 引用一个不存在的标签会让**整个标签加载失败**，于是结构没有 biomes，
 * 于是永远不生成，而且游戏里只表现为"找不到"。
 *
 * 这类错误只能靠"引用前先确认它存在"来防。所以把 vanilla 的标签名落成清单，
 * 让检查脚本离线比对 —— 不然每次都要翻日志。
 *
 * 用法：node tools/gen-vanilla-tags.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'vanilla-tags.json');

// 找客户端 jar（ModDevGradle 的缓存位置）
function findJar() {
  const dir = path.join(ROOT, '.gradle-home/caches/neoformruntime/artifacts');
  if (!fs.existsSync(dir)) {
    return null;
  }
  const f = fs.readdirSync(dir).find((n) => n.startsWith('minecraft_') && n.endsWith('_client.jar'));
  return f ? path.join(dir, f) : null;
}

const jar = findJar();
if (!jar) {
  console.error('❌ 找不到 minecraft 客户端 jar（.gradle-home/caches/neoformruntime/artifacts）');
  console.error('   先跑一次 gradlew 让 ModDevGradle 把依赖下下来');
  process.exit(1);
}

// 读 zip 的中央目录（不引第三方库）
const buf = fs.readFileSync(jar);
let eocd = -1;
for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.error('❌ 不是 zip'); process.exit(1); }
const count = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);
const names = [];
/** 每个条目的本地头偏移（要读内容时用；只读名字的话用不到）。 */
const localOffsets = [];
/** 压缩方式与压缩后长度 —— 取**中央目录**里的值：本地头里那两个字段可能是 0
 *  （写 zip 时用了 data descriptor 就是这样），照它切会切出半截流，
 *  解压直接抛 "unexpected end of file"（这一版就踩了）。 */
const methods = [];
const compSizes = [];
for (let k = 0; k < count; k++) {
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
  methods.push(buf.readUInt16LE(p + 10));
  compSizes.push(buf.readUInt32LE(p + 20));
  localOffsets.push(buf.readUInt32LE(p + 42));
  p += 46 + nameLen + extraLen + commentLen;
}

/** 读出第 i 个条目的内容（本地头 + deflate；不引第三方库）。 */
function readEntry(i) {
  const q = localOffsets[i];
  const nameLen = buf.readUInt16LE(q + 26);
  const extraLen = buf.readUInt16LE(q + 28);
  const start = q + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + compSizes[i]);
  return methods[i] === 0 ? raw : zlib.inflateRawSync(raw);
}

// data/minecraft/tags/<registry>/<name>.json 或 <registry>/<sub>/<name>.json
const tags = {};
for (const n of names) {
  const m = /^data\/minecraft\/tags\/(.+)\/([^/]+)\.json$/.exec(n);
  if (!m) continue;
  const registry = m[1];
  const name = m[2];
  (tags[registry] = tags[registry] || []).push('minecraft:' + name);
}
for (const k of Object.keys(tags)) tags[k].sort();

// ── 顺带：原版战利品表里**实际出现过**的 id ─────────────────────────
//
// 为什么也要落成清单：写战利品表的时候，`"function"` / `"condition"` / `"type"`
// 三处的 id 只要拼错一个字母，这张表就整张失效 —— 而表现是"东西不掉"，
// 没有报错、没有日志。把它和原版数据比一遍，至少能挡住"我编了一个 id"这一类。
//
// （NeoForge 自己的 id 如 neoforge:add_table 不在原版数据里，那份清单在
//   check-enchantments.js 里单独核对，并注明出处是 NeoForgeMod 的注册语句。）
const lootIds = new Set();
let lootTables = 0;
for (let i = 0; i < names.length; i++) {
  const n = names[i];
  if (!n.startsWith('data/minecraft/loot_table/') || !n.endsWith('.json')) continue;
  lootTables++;
  const text = readEntry(i).toString('utf8');
  for (const m of text.matchAll(/"(?:function|condition|type)":\s*"([a-z0-9_]+:[a-z0-9_/]+)"/g)) {
    lootIds.add(m[1]);
  }
}
const lootIdList = [...lootIds].sort();

const total = Object.values(tags).reduce((a, b) => a + b.length, 0);
fs.writeFileSync(OUT, JSON.stringify({
  _comment: '由 tools/gen-vanilla-tags.js 从 minecraft 客户端 jar 生成，不要手改。'
    + '用来离线校验我们引用的 #minecraft:xxx 标签是否真的存在 —— '
    + '引用不存在的标签会让**整个标签加载失败**，而游戏里只表现为"找不到结构"。'
    + 'lootIds 是原版战利品表里出现过的 function/condition/type id（拼错就是整张表失效）。',
  tags,
  lootIds: lootIdList,
}, null, 2) + '\n', 'utf8');

console.log('✅ 已写出 ' + path.relative(ROOT, OUT));
console.log('   ' + Object.keys(tags).length + ' 个标签注册表，共 ' + total + ' 个 vanilla 标签');
console.log('   原版战利品表 ' + lootTables + ' 张，出现过的 id ' + lootIdList.length + ' 个');
console.log('   群系标签 ' + (tags['worldgen/biome'] || []).length + ' 个');
// 把这次踩到的坑直接印出来，省得下次又去猜
const biome = tags['worldgen/biome'] || [];
console.log('\n   群系标签里有 is_river 吗：' + (biome.includes('minecraft:is_river') ? '✅ 有' : '❌ 没有'));
console.log('   群系标签里有 is_swamp 吗：' + (biome.includes('minecraft:is_swamp')
  ? '✅ 有' : '❌ **没有** —— 这就是这次"结构永远不生成"的根因'));
