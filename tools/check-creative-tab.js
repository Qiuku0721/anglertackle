/*
 * check-creative-tab.js —— 核对"注册了的物品"是否都进了创造模式标签页。
 *
 * 触发理由：用户截图里**看不见钛合金记忆金属线**。
 * 根因是 TITANIUM_LINE 注册了、贴图模型语言都有，但**忘了加进创造标签页的
 * output.accept(...) 列表** —— 于是游戏里根本拿不到。
 * 这类"注册了但没上架"的遗漏肉眼很难发现，因为所有文件看起来都在。
 *
 * 顺带核对语言键：物品没有中文名会在 tooltip 上显示成 item.anglertackle.xxx。
 *
 * 用法：node tools/check-creative-tab.js
 */
const fs = require('fs');
const path = require('path');

const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const ROOT = ATL_ROOT;
const itemSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'java', 'com',
  'whitecobalt', 'anglertackle', 'registry', 'ModItems.java'), 'utf8');
const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'resources',
  'assets', 'anglertackle', 'lang', 'zh_cn.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'resources',
  'assets', 'anglertackle', 'lang', 'en_us.json'), 'utf8'));

// ---- 1. 所有注册的物品 id ----
// 三种注册写法都要认，否则会漏掉一大批并误报成"有贴图但无物品"（踩过）：
//   ① ITEMS.register("id", ...)
//   ② rod("id", ...)      —— 竿走工厂方法
//   ③ fish("id")          —— 鱼走工厂方法
const registered = [];
{
  const push = (id) => { if (!registered.includes(id)) registered.push(id); };
  let m;
  const re1 = /ITEMS\.register\("([a-z_]+)"/g;
  while ((m = re1.exec(itemSrc)) !== null) push(m[1]);
  const re2 = /=\s*rod\("([a-z_]+)"/g;
  while ((m = re2.exec(itemSrc)) !== null) push(m[1]);
  const re3 = /=\s*fish\("([a-z_]+)"\)/g;
  while ((m = re3.exec(itemSrc)) !== null) push(m[1]);
}

// ---- 2. 创造标签页里 accept 的常量名 → 反查 id ----
// 常量名到 id 的映射也要覆盖三种写法
const nameToId = {};
{
  let m;
  const re1 = /DeferredItem<[^>]+>\s+(\w+)\s*=\s*ITEMS\.register\("([a-z_]+)"/g;
  while ((m = re1.exec(itemSrc)) !== null) nameToId[m[1]] = m[2];
  const re2 = /DeferredItem<[^>]+>\s+(\w+)\s*=\s*rod\("([a-z_]+)"/g;
  while ((m = re2.exec(itemSrc)) !== null) nameToId[m[1]] = m[2];
  const re3 = /DeferredItem<[^>]+>\s+(\w+)\s*=\s*fish\("([a-z_]+)"\)/g;
  while ((m = re3.exec(itemSrc)) !== null) nameToId[m[1]] = m[2];
}
// 标签页区块：从第一个 buildCreativeTab / output.accept 到文件里最后一个 accept
const accepted = new Set();
{
  const re = /output\.accept\((\w+)\.get\(\)\)/g;
  let m;
  while ((m = re.exec(itemSrc)) !== null) {
    const id = nameToId[m[1]];
    if (id) accepted.add(id);
  }
}

// ---- 3. 对比 ----
console.log('=== 创造标签页覆盖检查 ===\n');
console.log('  注册物品 ' + registered.length + ' 个，标签页收录 ' + accepted.size + ' 个\n');

const missing = registered.filter((id) => !accepted.has(id));
console.log('  ' + (missing.length ? '❌' : '✅') + ' 未进标签页的物品：'
  + (missing.length ? missing.join(', ') : '（无，全部可获取）'));

// ---- 4. 语言键 ----
// 方块物品的名字键是 block.*（BlockItem 会自动回退到它）—— 两种都认
const named = (lang, id) => (`item.anglertackle.${id}` in lang) || (`block.anglertackle.${id}` in lang);
const noZh = registered.filter((id) => !named(zh, id));
const noEn = registered.filter((id) => !named(en, id));
console.log('  ' + (noZh.length ? '❌' : '✅') + ' 缺中文名的物品：'
  + (noZh.length ? noZh.join(', ') : '（无）'));
console.log('  ' + (noEn.length ? '❌' : '✅') + ' 缺英文名的物品：'
  + (noEn.length ? noEn.join(', ') : '（无）'));

// ---- 5. 贴图 / 模型 ----
// ⚠ 不能简单地"物品名 == 贴图文件名"：有的物品**故意复用**别人的贴图
//   （比如测试拟饵 lure_test_red 直接用 lure_gilded 的图，不单独出图）。
//   正确做法是**读模型 json 里声明的 layer0**，再看那张图在不在。
const texDir = path.join(ROOT, 'src', 'main', 'resources', 'assets', 'anglertackle', 'textures', 'item');
const modDir = path.join(ROOT, 'src', 'main', 'resources', 'assets', 'anglertackle', 'models', 'item');
const tex = new Set(fs.readdirSync(texDir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const mod = new Set(fs.readdirSync(modDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));

const noTex = [], noMod = [], reuse = [], vanillaTex = [];
for (const id of registered) {
  if (!mod.has(id)) { noMod.push(id); continue; }
  const json = JSON.parse(fs.readFileSync(path.join(modDir, id + '.json'), 'utf8'));

  // ★ 刷怪蛋是例外：它的模型只有一行 parent: minecraft:item/template_spawn_egg，
  //   **没有也不要 layer0** —— 蛋壳贴图由原版模板 + ItemColors 按构造器里的
  //   两个颜色参数染色提供，本模组没有也不该有自己的 png。
  //   不排除的话这里会误报 "fisherman_spawn_egg(模型没声明 layer0)"。
  //   必须读 parent 而不是按"id 以 _spawn_egg 结尾"判断：后者会把
  //   一个忘了写 parent 的坏模型也放过去。
  if (json.parent === 'minecraft:item/template_spawn_egg') {
    continue;
  }

  // ★ 方块物品：模型只有一行 parent 指向 models/block/xxx.json，layer0 写在那边。
  //   按普通物品判会误报"模型没声明 layer0"。
  if (json.parent === 'anglertackle:block/' + id) {
    continue;
  }

  // ★ 3D 物品模型（有 elements）：贴图由各面的 "#名字" 引用，本来就没有 layer0。
  //   不能跳过不查 —— 那样贴图丢了也发现不了。改成解析引用再核对 PNG。
  if (Array.isArray(json.elements)) {
    const refs = new Set();
    for (const el of json.elements) {
      for (const f of Object.values(el.faces || {})) {
        if (f && typeof f.texture === 'string' && f.texture.startsWith('#')) {
          const path = (json.textures || {})[f.texture.slice(1)];
          if (path) refs.add(path);
        }
      }
    }
    // ⚠ 不能用 textures/item 目录那份名单来判：3D 模型的贴图可能在 textures/block/。
    //   按模型里写的完整路径去文件系统上核对。
    const assetsRoot = path.join(ROOT, 'src', 'main', 'resources', 'assets', 'anglertackle', 'textures');
    const missing = [...refs]
      .filter((p) => String(p).startsWith('anglertackle:'))
      .filter((p) => !fs.existsSync(path.join(assetsRoot, String(p).slice('anglertackle:'.length) + '.png')));
    if (missing.length) {
      noTex.push(id + ' → 3D 模型引用的贴图不存在：' + missing.join(', '));
    }
    continue;
  }

  const layer = json.textures && json.textures.layer0;
  if (!layer) { noTex.push(id + '(模型没声明 layer0)'); continue; }

  // ★ 引用**原版**贴图是合法的，不算"缺贴图"：
  //   模型里写 minecraft:item/compass 只是引用资源路径，没有再分发任何 Mojang 素材
  //   （docs/12 的合规红线是"不能打包进 jar"，不是"不能引用"）。
  //   但要**单独列出来**，因为它在路线图 M7「全部贴图非占位」里算未完成 ——
  //   悄悄放过的话，以后翻检查输出会以为贴图都做完了。
  if (String(layer).startsWith('minecraft:')) {
    vanillaTex.push(id + ' → ' + layer);
    continue;
  }

  // "anglertackle:item/xxx" -> "xxx"
  const texName = String(layer).split('/').pop();
  if (!tex.has(texName)) { noTex.push(id + ' → ' + texName); continue; }
  if (texName !== id) reuse.push(id + ' → ' + texName);
}
const orphanTex = [...tex].filter((id) => !registered.includes(id));
const orphanMod = [...mod].filter((id) => !registered.includes(id));

console.log('  ' + (noTex.length ? '❌' : '✅') + ' 贴图缺失（按模型声明核对）：'
  + (noTex.length ? noTex.join(', ') : '（无）'));
console.log('  ' + (noMod.length ? '❌' : '✅') + ' 缺模型的物品：'
  + (noMod.length ? noMod.join(', ') : '（无）'));
console.log('  ' + (reuse.length ? 'ℹ' : '✅') + ' 复用他人贴图（正常，但列出来便于核对）：'
  + (reuse.length ? reuse.join(', ') : '（无）'));
console.log('  ' + (vanillaTex.length ? '⚠' : '✅') + ' 用的是**原版**贴图（合规，但算占位未完成）：'
  + (vanillaTex.length ? vanillaTex.join(', ') : '（无）'));
console.log('  ' + (orphanTex.length ? '⚠' : '✅') + ' 有贴图但无物品（残留）：'
  + (orphanTex.length ? orphanTex.join(', ') : '（无）'));
console.log('  ' + (orphanMod.length ? '⚠' : '✅') + ' 有模型但无物品（残留）：'
  + (orphanMod.length ? orphanMod.join(', ') : '（无）'));

const fail = missing.length + noZh.length + noEn.length + noTex.length + noMod.length;
console.log('\n' + (fail === 0
  ? '全部通过：每个注册物品都能在创造模式拿到，名字/贴图/模型齐全。'
  : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  提醒：新增物品要同时做四件事——');
console.log('    ① ITEMS.register  ② 创造标签页 output.accept  ③ 语言键  ④ 贴图+模型');
console.log('    少任何一项，表现都不一样（拿不到 / 名显示成键名 / 紫黑方块），');
console.log('    但代码里看起来"都写了"，肉眼很难查。');
process.exitCode = fail === 0 ? 0 : 1;
