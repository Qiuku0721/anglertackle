/*
 * check-vanilla-tags.js —— 我们引用的 `#minecraft:xxx` 标签**必须真的存在**。
 *
 * ── 为什么必须自动守 ──────────────────────────────────────────
 * 用户 `/locate structure anglertackle:fisherman_hut` 报"无法找到"，翻日志才看到：
 *   [ERROR] TagLoader: Couldn't load tag anglertackle:has_fisherman_hut
 *           as it is missing following references:
 * 我在群系标签里写了 `#minecraft:is_swamp` —— **vanilla 根本没有这个标签**
 * （36 个群系标签里有 is_river / is_beach / is_ocean…，就是没有 is_swamp）。
 *
 * 引用一个不存在的标签的后果是**整个标签加载失败**，于是结构的 biomes 是空的，
 * 于是结构永远不生成 —— 而游戏里只表现为"跑很远也找不到"，
 * 唯一能看出问题的线索是**日志里一行 ERROR**。
 *
 * 这个坑的隐蔽之处：我们的标签文件本身**语法完全正确**、路径也对、
 * 检查脚本也断言了"文件存在""包含 is_river"——全都通过。
 * 缺的那一条是"引用的东西存在吗"，而那恰恰是唯一会致命的一条。
 *
 * 用法：node tools/check-vanilla-tags.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TOOLS = process.env.ATL_ROOT ? path.join(ROOT, 'tools') : __dirname;

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 标签引用检查（引用了不存在的 vanilla 标签会让结构永远不生成）===\n');

const MANIFEST = path.join(TOOLS, 'vanilla-tags.json');
if (!fs.existsSync(MANIFEST)) {
  bad('缺 tools/vanilla-tags.json —— 跑 node tools/gen-vanilla-tags.js 生成');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const TAGS_DIR = path.join(ROOT, 'src/main/resources/data/anglertackle/tags');
if (!fs.existsSync(TAGS_DIR)) {
  bad('找不到 ' + path.relative(ROOT, TAGS_DIR));
  process.exit(1);
}

/** 递归列出所有 .json。 */
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = walk(TAGS_DIR, []);
let checked = 0;

for (const f of files) {
  const rel = path.relative(TAGS_DIR, f).split(path.sep).join('/');
  // 路径形如 <registry>/<name>.json（registry 可以是 worldgen/biome 这种两段）
  const m = /^(.+)\/([^/]+)\.json$/.exec(rel);
  if (!m) continue;
  const registry = m[1];
  const known = new Set(manifest.tags[registry] || []);

  if (known.size === 0) {
    bad(rel + '：vanilla 清单里没有 "' + registry + '" 这个标签注册表 —— '
      + '路径可能写错了（对照 vanilla 的 data/minecraft/tags/<同样的路径>）');
    continue;
  }

  const body = JSON.parse(fs.readFileSync(f, 'utf8'));
  const values = body.values || [];
  if (!values.length) {
    bad(rel + ' 的 values 是空的 —— 空标签 = 任何地方都不生成');
    continue;
  }

  const missing = [];
  const selfRefs = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    if (v.startsWith('#minecraft:')) {
      if (!known.has(v.slice(1))) missing.push(v);
    } else if (v.startsWith('#anglertackle:')) {
      const name = v.slice('#anglertackle:'.length);
      const self = path.join(TAGS_DIR, registry, name + '.json');
      if (!fs.existsSync(self)) missing.push(v + '（我们自己的标签，但 ' + registry + '/' + name + '.json 不存在）');
      else selfRefs.push(v);
    }
  }

  if (missing.length) {
    bad(rel + ' 引用了**不存在**的标签：' + missing.join(', ')
      + '\n     → 这会让整个标签加载失败（日志里一行 ERROR），'
      + '表现为结构永远不生成、"跑了很远也找不到"');
  } else {
    checked++;
    ok(rel + ' 引用的 ' + values.length + ' 项都存在'
      + (selfRefs.length ? '（含自家标签 ' + selfRefs.join(', ') + '）' : ''));
  }
}

// 把这次踩的坑钉死：群系标签里到底有哪些 is_ 开头的
{
  const biome = manifest.tags['worldgen/biome'] || [];
  const isTags = biome.filter((t) => t.startsWith('minecraft:is_'));
  console.log('\n  ℹ vanilla 群系标签里 is_ 开头的只有这些：'
    + isTags.map((t) => t.replace('minecraft:', '')).join(', '));
  console.log('    没有 is_swamp / is_lake / is_pond —— 要沼泽就写具体群系 id'
    + '（minecraft:swamp / minecraft:mangrove_swamp）');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  这个坑的教训：');
console.log('    "文件存在""路径对""包含某个词"这些断言全都会通过，');
console.log('    而唯一致命的是"引用的东西存在吗"—— 缺了它，检查全绿但结构永不生成。');
process.exitCode = fail === 0 ? 0 : 1;
