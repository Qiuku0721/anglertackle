/*
 * 水族箱第二阶段（放鱼 / 取鱼 / 拆缸放生 / 放生台）的守门检查。
 *
 * 四组断言，都是**可计算的事实**，不是把 Java 的算法在 JS 里重抄一遍
 * （那种检查等于自己证明自己，本仓库吃过这个亏，见 negtest.ps1 顶部）：
 *
 *   A. 模型手持缩放 —— 遍历 models/item/ 的 parent 链：链条里全是自己的模型、
 *      又确实有 elements（3D 方块物品）、却没有任何 display 变换时，报错。
 *      这正是用户截图里"手上一大块"的成因：自定义模型没有 parent，
 *      于是 GUI/手持/掉落全都一点缩放都没有。原版靠 minecraft:block/block 提供。
 *   B. 提示文本 —— 代码里出现的 message.anglertackle.* 必须中英文都有。
 *      漏了的后果是玩家看到一行原始键名，而代码"看起来写了"。
 *   C. 容量规则的结构 —— 2/8/27、512 上限、拆缸不杀鱼。
 *   D. 接线 —— 水族箱三个交互入口都接到 AquariumTank；放生台接到 releaseFromPlatform。
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./java-source.js');

// ATL_ROOT 供 tools/negtest.ps1 指向临时副本；不给就是仓库根目录 ✓
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');
const ASSETS = path.join(ROOT, 'src/main/resources/assets/anglertackle');

let fail = 0;
const bad = (m) => { console.error('❌ ' + m); fail++; };
const ok = (m) => console.log('  ✅ ' + m);

const readJava = (rel) => {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) { return null; }
  return stripComments(fs.readFileSync(p, 'utf8'));
};
const readJson = (p) => {
  // ⚠ 必须去掉 BOM：Windows PowerShell 的 `Set-Content -Encoding UTF8` 会写出 BOM，
  //   而 JSON.parse 见到 BOM 直接抛 SyntaxError。不处理的话，一个用 PS 改过的资源文件
  //   会让检查器**崩掉并只留下一行看不懂的栈**，而不是报出真正的问题。
  const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
};

// ---------------------------------------------------------------- A. 手持缩放
console.log('A. 3D 方块物品必须有 display 变换（否则拿在手上占满屏幕）');
{
  const itemDir = path.join(ASSETS, 'models/item');
  const resolve = (id) => {
    const [ns, rest] = id.includes(':') ? id.split(':') : ['minecraft', id];
    if (ns !== 'anglertackle') { return null; }          // 原版模型：信任它自带变换
    return path.join(ASSETS, 'models', rest + '.json');
  };
  let checked = 0, flagged = 0;
  for (const f of fs.readdirSync(itemDir).filter((n) => n.endsWith('.json'))) {
    // 走 parent 链，收集"有没有 elements""有没有 display""有没有原版祖先"
    let cur = readJson(path.join(itemDir, f));
    let hasElements = false, hasDisplay = false, vanillaAncestor = false;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (cur.elements) { hasElements = true; }
      if (cur.display) { hasDisplay = true; }
      if (!cur.parent) { break; }
      const next = resolve(cur.parent);
      if (next === null) { vanillaAncestor = true; break; }
      if (!fs.existsSync(next)) { bad(`${f}: parent 指向不存在的模型 ${cur.parent}`); break; }
      cur = readJson(next);
    }
    if (!hasElements || hasDisplay || vanillaAncestor) { continue; }
    checked++;
    flagged++;
    bad(`${f}: 模型链条里有 elements（3D 方块物品）却没有任何 display 变换 —— ` +
        `拿在手上会是一块占满屏幕的巨物。修法：给最外层模型加 ` +
        `"parent": "minecraft:block/block"（原版方块物品都这么干）`);
  }
  if (flagged === 0) { ok(`3D 方块物品的 display 变换齐全（扫了 ${fs.readdirSync(itemDir).length} 个物品模型）`); }
}

// ---------------------------------------------------------------- B. 提示文本
console.log('B. 代码里的提示文本必须中英文都有');
{
  const files = ['block/AquariumTank.java', 'block/AquariumBlock.java', 'block/ReleasePlatformBlock.java'];
  const keys = new Set();
  for (const f of files) {
    const src = readJava(f);
    if (src === null) { continue; }
    for (const m of src.matchAll(/Component\.translatable\(\s*"([^"]+)"/g)) { keys.add(m[1]); }
  }
  const langs = {};
  for (const l of ['zh_cn', 'en_us']) {
    langs[l] = readJson(path.join(ASSETS, 'lang', l + '.json'));
  }
  let missing = 0;
  for (const k of keys) {
    for (const l of ['zh_cn', 'en_us']) {
      if (langs[l][k] === undefined) { bad(`${l}.json 缺少 "${k}"（代码里用了，玩家会看到键名）`); missing++; }
    }
  }
  if (keys.size === 0) { bad('没有从水族箱相关源码里解析到任何提示文本 —— 解析口径可能失效了'); }
  else if (missing === 0) { ok(`${keys.size} 条提示文本中英文齐全`); }
}

// ---------------------------------------------------------------- C. 容量规则
console.log('C. 容量规则的结构');
{
  const tank = readJava('block/AquariumTank.java');
  if (tank === null) {
    bad('找不到 block/AquariumTank.java');
  } else {
    for (const [const_, why] of [
      ['MAX_BLOCKS = 512', 'BFS 硬上限（没有它，巨缸会把服务器拖卡）'],
      ['SMALL_BLOCKS = 2', '小型鱼 2 格（1×1×2）'],
      ['MEDIUM_BLOCKS = 8', '中型鱼 8 格（2×2×2）'],
      ['LARGE_BLOCKS = 27', '大型鱼 27 格（3×3×3）'],
    ]) {
      if (!tank.includes(const_)) { bad(`AquariumTank.java 里找不到 "${const_}" —— ${why}`); }
    }
    // 上限必须真的被用来早退，而不是只定义了一个常量
    if (!/seen\.size\(\)\s*>=\s*MAX_BLOCKS/.test(tank)) {
      bad('flood() 里没有针对 MAX_BLOCKS 的早退检查 —— 那个上限只是摆设');
    }
    // 拆缸不许杀鱼（docs/20 §5③）
    const release = /releaseAll\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(tank);
    if (!release) {
      bad('解析不到 releaseAll 的方法体');
    } else if (/\.discard\(\)|\.kill\(\)|remove\(Entity\.RemovalReason/.test(release[1])) {
      bad('releaseAll() 里出现了 discard/kill —— 拆缸必须把鱼放出来，不许杀掉（docs/20 §5③）');
    } else {
      ok('MAX_BLOCKS 上限真的用于早退；releaseAll 只解禁、不杀鱼');
    }
  }
}

// ---------------------------------------------------------------- D. 接线
console.log('D. 交互接线');
{
  const block = readJava('block/AquariumBlock.java');
  if (block === null) {
    bad('找不到 block/AquariumBlock.java');
  } else {
    for (const [m, why] of [
      ['useItemOn', '手持鱼右键放入'],
      ['useWithoutItem', '空手右键取出'],
      // 26.1.2：BlockBehaviour#onRemove 已删除，等价钩子是 affectNeighborsAfterRemoval
      // （只在旧方块确实被换掉时才调，LevelChunk.java:318-321）。
      ['affectNeighborsAfterRemoval', '拆缸时把鱼放出来'],
    ]) {
      if (!block.includes(m)) { bad(`AquariumBlock 没有 ${m}（${why}）`); }
    }
    if (!/affectNeighborsAfterRemoval[\s\S]*?AquariumTank\.releaseAll/.test(block)) {
      bad('AquariumBlock.affectNeighborsAfterRemoval 没有调用 AquariumTank.releaseAll —— 拆缸会把鱼永久困在标记里');
    } else {
      ok('放鱼 / 取鱼 / 拆缸放生 三个入口都接到了 AquariumTank');
    }
  }

  const platform = readJava('block/ReleasePlatformBlock.java');
  if (platform === null) {
    bad('找不到 block/ReleasePlatformBlock.java —— 放生台（docs/20 §8.3 已定案要做）');
  } else if (!platform.includes('AquariumTank.releaseFromPlatform')) {
    bad('ReleasePlatformBlock 没有调用 AquariumTank.releaseFromPlatform');
  } else {
    ok('放生台接到了 AquariumTank.releaseFromPlatform');
  }

  const tank = readJava('block/AquariumTank.java') || '';
  if (!tank.includes('isSource()')) {
    bad('releaseFromPlatform 的水域判定没有要求水源（isSource）—— 流动的水里放生，鱼会被冲走');
  }
  if (!/releaseFromPlatform[\s\S]*?r <= 8/.test(tank)) {
    bad('releaseFromPlatform 的螺旋搜索上限不是 8 格（提示文本说的就是 8 格，两边会不一致）');
  }
}

// ---------------------------------------------------------------- E. 掉落表
console.log('E. 每个方块都要能掉回自己（拆了不能血本无归）');
{
  const before = fail;
  const mb = readJava('registry/ModBlocks.java') || '';
  const ids = [...mb.matchAll(/BLOCKS\.register\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (ids.length === 0) {
    bad('解析不到 ModBlocks 里的方块 id —— 解析口径可能失效了');
  }
  const lootDir = path.join(ROOT, 'src/main/resources/data/anglertackle/loot_table/blocks');
  // ⚠ 例外（2026-10-08，冰钓）：这三块**不是玩家合成的**，而是"世界状态"——
  //   用户定案"被挖掉时**按原版冰处理（掉一块冰）**" ✓，所以它们**不掉回自己**：
  //   掉回自己的话，玩家能拿到"冰洞"方块往陆地上摆（地里凭空一个洞），
  //   也能靠"凿 → 挖 → 再凿"循环刷冰 ✗ —— 那正是用户明确要堵的"刷水/刷冰"。
  //   这三条的判据改成"掉落表里必须有一块原版冰"，比"掉回自己"更贴合设计 ✓
  const STATE_BLOCKS = { ice_hole: 'minecraft:ice', broken_ice: 'minecraft:ice', pack_ice: 'minecraft:ice' };
  for (const id of ids) {
    const p = path.join(lootDir, id + '.json');
    if (!fs.existsSync(p)) {
      // 没有掉落表 = 挖掉什么都不掉。水族箱是 8 玻璃 + 1 条鱼换 8 块，
      // 拆了拿不回来等于直接没收玩家的东西。
      bad(`方块 ${id} 没有掉落表（loot_table/blocks/${id}.json）—— 挖掉什么都不掉`);
      continue;
    }
    const text = JSON.stringify(readJson(p));
    if (/silk_touch|match_tool/.test(text)) {
      bad(`方块 ${id} 的掉落表要求精准采集 —— 这个模组的方块都不该再要一把附魔镐`);
      continue;
    }
    if (STATE_BLOCKS[id]) {
      if (!text.includes(STATE_BLOCKS[id])) {
        bad(`方块 ${id} 的掉落表里没有 ${STATE_BLOCKS[id]} —— 用户定案"挖掉按原版冰处理（掉一块冰）"`);
      }
      continue;
    }
    if (!text.includes('anglertackle:' + id)) {
      bad(`方块 ${id} 的掉落表里没有它自己`);
    }
  }
  const axe = path.join(ROOT, 'src/main/resources/data/minecraft/tags/block/mineable/axe.json');
  if (!fs.existsSync(axe)) {
    bad('没有 data/minecraft/tags/block/mineable/axe.json —— 木质方块用斧头挖不快');
  } else {
    const values = readJson(axe).values || [];
    for (const id of ['fish_rack', 'release_platform']) {
      if (!values.includes('anglertackle:' + id)) {
        bad(`${id} 是木质方块，但不在 minecraft:mineable/axe 里`);
      }
    }
  }
  if (fail === before) {
    ok(`${ids.length} 个方块都有掉落表、都不要求精准采集；木质方块在斧头标签里`);
  }
}

console.log(fail === 0 ? '\n水族箱第二阶段检查：全部通过' : `\n水族箱第二阶段检查：${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
