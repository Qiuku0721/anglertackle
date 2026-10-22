/*
 * check-fish-model.js —— 守住"模型和贴图是同一套 UV"。
 *
 * 这一类 bug 的特征是**全部静默**：
 *   · texOffs 写错一个数字 → 鱼身上出现别的零件的颜色，不报错；
 *   · 贴图尺寸和 LayerDefinition 的 (u,v) 不一致 → UV 整体错位，不报错；
 *   · 某个零件忘了上色 → 采样到透明像素，零件直接看不见，不报错；
 *   · 生成的 Java 和 JSON 数据源漂移 → 改数据没生效，也不报错。
 * 所以每一条都必须离线断言，而不是靠"进游戏看一眼"。
 *
 * ── 2026-10-01：从"4 组共用"改成"一种鱼一层" ──────────────────
 * 每层有**自己的图集尺寸**（随该鱼的零件多少而定），所以断言也按鱼种做，
 * 不再有一个全局的 ATLAS.w/h。
 *
 * 用法：node tools/check-fish-model.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = 'src/main/java/com/whitecobalt/anglertackle/';
const TEXDIR = 'src/main/resources/assets/anglertackle/textures/entity/fish';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 鱼模型与贴图检查 ===\n');

process.env.ATL_ROOT = ROOT;
const M = require('./fish-model.js');
const ids = Object.keys(M.data.fish);

// ---------------------------------------------------------------- ① 生成物同步
// ⚠ 不要再改成 execFileSync 跑 gen-fish-model.js --check：
//   node 的 child_process 默认用管道收输出，而沙箱禁止打开命名管道，
//   结果是 spawnSync EPERM —— 一个和检查内容毫无关系的假失败。
{
  const gen = require('./gen-fish-model.js');
  const drift = [];
  for (const [file, text] of gen.buildOutputs()) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (old !== text) drift.push(path.relative(ROOT, file));
  }
  if (drift.length) bad('生成的 Java/语言/模型与数据源不一致，重跑 node tools/gen-fish-model.js：' + drift.join(', '));
  else ok('ModFishModel / FishVariants / ModModelLayers / ModItems 生成段 / 语言键 / 21 个蛋模型 都与数据源逐字节一致');
}

// ---------------------------------------------------------------- ①b 不能有残留的旧文件
{
  const stale = 'src/main/java/com/whitecobalt/anglertackle/client/FishVariants.java';
  if (fs.existsSync(path.join(ROOT, stale))) {
    bad('残留了旧路径的 ' + stale + ' —— 它和 fish/FishVariants.java 同时存在会让两边慢慢走散');
  } else ok('旧的 client/FishVariants.java 已删除（现在在 fish 包，服务端也要读碰撞箱）');
}

// ---------------------------------------------------------------- ② UV 装箱（按鱼种）
{
  let overlap = 0, outside = 0;
  for (const id of ids) {
    const S = M.species[id];
    const names = new Set(S.parts.map((p) => p.name));
    if (names.size !== S.parts.length) { bad(id + ' 有重名零件'); overlap++; }
    const rects = S.parts.map((p) => {
      const { w, h } = M.unwrapSize(p.size);
      const [u, v] = S.texOffs[p.name];
      return { name: p.name, r: [u, v, Math.ceil(w - 1e-6), Math.ceil(h - 1e-6)] };
    });
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i].r;
      if (a[0] < 0 || a[1] < 0 || a[0] + a[2] > S.atlasW || a[1] + a[3] > S.atlasH) {
        bad(id + ' 的 ' + rects[i].name + ' 超出图集：' + a + ' 图集 ' + S.atlasW + '×' + S.atlasH); outside++;
      }
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j].r;
        if (a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) {
          bad(id + ' 的 ' + rects[i].name + ' 与 ' + rects[j].name + ' UV 重叠'); overlap++;
        }
      }
    }
  }
  if (overlap === 0 && outside === 0) {
    ok('21 种鱼 × 各自 ' + Math.min(...ids.map((i) => M.species[i].parts.length)) + '~' +
      Math.max(...ids.map((i) => M.species[i].parts.length)) + ' 个零件的 UV 两两不重叠且在各自图集内');
  }
}

// ---------------------------------------------------------------- ③ 贴图尺寸
function readRgba(file) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const idat = [];
  let p = 8;
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    raw.copy(out, y * w * 4, y * (w * 4 + 1) + 1, y * (w * 4 + 1) + 1 + w * 4);
  }
  return { w, h, data: out };
}

const tex = {};
let sizeBad = 0;
for (const id of ids) {
  const p = path.join(ROOT, TEXDIR, id + '.png');
  if (!fs.existsSync(p)) { bad('缺贴图 ' + id + '.png'); sizeBad++; continue; }
  const t = readRgba(p);
  const S = M.species[id];
  if (t.w !== S.atlasW || t.h !== S.atlasH) {
    bad(id + '.png 是 ' + t.w + '×' + t.h + '，但该鱼的 UV 图集是 ' + S.atlasW + '×' + S.atlasH
      + '（LayerDefinition.create 会按后者建，采样必然错位）');
    sizeBad++;
  }
  tex[id] = t;
}
if (sizeBad === 0) ok('每张贴图的尺寸都等于该鱼自己的 UV 图集（LayerDefinition 用同一组数字）');

// ---------------------------------------------------------------- ④ 逐面覆盖
{
  // 尾叶裁形的**独立**判据：按 cutRows/cutFrom 自己算"这一列该有几行不透明、贴哪一侧"，
  // 再与贴图像素对比。
  // ⚠ 这里**故意不调用 M.cutKeeps**：最初就是复用它，结果变异测试证明那是同义反复 ——
  //   把 cutKeeps 改坏，上色与校验一起改坏，照样全绿 ✗。断言必须自己算一遍。
  const expectCol = (p, face, col) => {
    if (!p.cutRows || (face !== 'west' && face !== 'east')) return null;
    const dz = p.size[2];
    const z = face === 'west' ? dz - 1 - col : col;   // 西面的列序与 z 相反
    const [s0, n] = p.cutRows[z];
    const rows = [];
    for (let row = 0; row < p.size[1]; row++) rows.push(row >= s0 && row < s0 + n);
    return rows;
  };

  const uncovered = [];
  const cutBad = [];
  const wedgeBad = [];
  for (const id of ids) {
    const t = tex[id];
    if (!t) continue;
    const S = M.species[id];
    for (const p of S.parts) {
      for (const [face, R] of Object.entries(M.facesOf(p, S.texOffs[p.name]))) {
        if (R[2] <= 0 || R[3] <= 0) continue;
        const counts = [];
        for (let col = 0; col < R[2]; col++) {
          const want = expectCol(p, face, col);
          let opaqueN = 0;
          for (let row = 0; row < R[3]; row++) {
            const o = ((R[1] + row) * t.w + (R[0] + col)) * 4;
            const opaque = t.data[o + 3] === 255;
            if (opaque) opaqueN++;
            if (want && opaque !== want[row]) cutBad.push(id + ':' + p.name + '.' + face + ' 第' + col + '列第' + row + '行');
            else if (!want && !opaque) uncovered.push(id + ':' + p.name + '.' + face);
          }
          counts.push(opaqueN);
        }
        // 裁形必须真的是"根粗梢尖"：顺着 z 每列的起止行单调、梢部只剩 1 行
        if (p.cutRows && (face === 'west' || face === 'east')) {
          const byZ = face === 'west' ? counts.slice().reverse() : counts;
          const starts = p.cutRows.map(([s0]) => s0);
          const ends = p.cutRows.map(([s0, n]) => s0 + n - 1);
          const mono = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]) || a.every((v, i) => i === 0 || v <= a[i - 1]);
          if (!mono(starts) || !mono(ends)) wedgeBad.push(id + ':' + p.name + '.' + face + ' 起止行不单调');
          if (byZ[byZ.length - 1] !== 1) wedgeBad.push(id + ':' + p.name + '.' + face + ' 梢部 ' + byZ[byZ.length - 1] + ' 行');
        }
      }
    }
  }
  const uniq = [...new Set(uncovered)];
  if (uniq.length) {
    bad('有 ' + uniq.length + ' 个面没上色（零件会直接看不见）：' +
      uniq.slice(0, 10).join(', ') + (uniq.length > 10 ? ' …' : ''));
  } else ok('每种鱼的每个零件的每个非退化面都有像素（不会出现"零件透明"）');

  const cutUniq = [...new Set(cutBad)];
  if (cutUniq.length) {
    bad('尾叶贴图裁形与 cutRows 对不上（会露出方块的四角）：' + cutUniq.slice(0, 6).join(', '));
  } else ok('尾叶的贴图裁形逐像素等于 cutRows（一整块方块被切成根粗梢尖的梯形）');

  const wedgeUniq = [...new Set(wedgeBad)];
  if (wedgeUniq.length) bad('尾叶裁形不是楔子（越往梢越宽 / 梢部没收到 1 行）：' + wedgeUniq.slice(0, 6).join(', '));
  else ok('尾叶裁形顺着 z 只会变细、梢部恰 1 行（读出来是一个梯形，不是一个方块或一根棍）');
}

// ---------------------------------------------------------------- ⑤ 接线
const { stripComments } = require('./java-source.js');
{
  const renderer = stripComments(read(J + 'client/render/ModFishRenderer.java'));
  const setup = stripComments(read(J + 'client/ClientSetup.java'));
  const layers = stripComments(read(J + 'registry/ModModelLayers.java'));

  if (/ModModelLayers\.FISH\.get\(species\)/.test(renderer)) ok('渲染器按鱼种取模型层');
  else bad('ModFishRenderer 没有用 ModModelLayers.FISH.get(species) 取层');

  if (/new ModFishModel\(ctx\.bakeLayer\(ModModelLayers\.FISH\.get\(species\)\), species\)/.test(renderer)) {
    ok('模型实例知道自己是哪个鱼种（尾型不同，要挑出实际存在的尾鳍零件）');
  } else bad('ModFishRenderer 建 ModFishModel 时没传鱼种 —— 尾鳍零件名取不到会抛异常');

  if (/pose\.scale\(v\.sx\(\), v\.sy\(\), v\.sz\(\)\)/.test(renderer)) ok('渲染器施加了 FishVariants 的三轴缩放');
  else bad('ModFishRenderer.scale 没有用 FishVariants 的 sx/sy/sz');

  if (/FishVariants\.of\(/.test(renderer) && !/groupOf/.test(renderer)) ok('渲染器只用 FishVariants 的尺寸，不再有"体型组"概念');
  else bad('ModFishRenderer 还在用 groupOf —— 现在已经是一种鱼一层了');

  if (/ModEntities\.FISHES\.entrySet\(\)/.test(setup)) ok('ClientSetup 遍历鱼种表注册渲染器，加鱼种不用改它');
  else bad('ClientSetup 没有遍历 ModEntities.FISHES 注册渲染器');

  if (/String species = e\.getKey\(\);/.test(setup)) {
    ok('ClientSetup 的鱼种取自表键（写死的话所有鱼会去烘同一层网格，形状全错）');
  } else bad('ClientSetup 没有从 e.getKey() 取鱼种 —— 写死的鱼种会让 21 种鱼共用一层网格');

  if (/ModModelLayers\.FISH\.entrySet\(\)/.test(setup)) ok('ClientSetup 遍历层表注册 LayerDefinition，不会漏注册某个鱼种');
  else bad('ClientSetup 没有遍历 ModModelLayers.FISH 注册 LayerDefinition');

  // 只在 String[] species = {...} 里数，否则会把 "main" 之类的字符串也算进去
  const block = layers.match(/String\[\] species = \{([\s\S]*?)\};/);
  const declared = block ? [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
  const want = ids;
  if (JSON.stringify(declared) === JSON.stringify(want)) ok('ModModelLayers 的鱼种列表与数据源一致（' + want.length + ' 种）');
  else bad('ModModelLayers 的鱼种数与数据源不一致：' + declared.length + ' vs ' + want.length);

  const modelSrc = stripComments(read(J + 'client/model/ModFishModel.java'));
  const cases = [...modelSrc.matchAll(/case "([a-z_]+)" -> build_/g)].map((m) => m[1]);
  if (JSON.stringify(cases) === JSON.stringify(want)) ok('ModFishModel 的 switch 覆盖全部 ' + want.length + ' 个鱼种，且顺序一致');
  else bad('ModFishModel 的 case 与数据源不一致：' + cases.length + ' vs ' + want.length);

  const buildFns = [...modelSrc.matchAll(/private static void build_([a-z_]+)\(PartDefinition/g)].map((m) => m[1]);
  if (JSON.stringify(buildFns) === JSON.stringify(want)) ok('每种鱼都有自己的 build_xxx(root)，没有两个鱼种共用一套零件');
  else bad('有鱼种没有自己的 build_xxx：' + want.filter((w) => !buildFns.includes(w)).join(', '));

  // 模板现在是**刻意共用**的（用户 2026-10-01：大鱼改鲑鱼模板、小鱼改鳕鱼模板），
  // 所以不再要求"零件表两两不同"。改判新不变式：**每条鱼都必须声明合法的模板**。
  // 漏声明会静默退回 v3 几何 —— 那正是用户说"不如第一版"的那一版。
  const tally = { cod: [], salmon: [] };
  const badStyle = [];
  for (const id of ids) {
    const st = M.data.fish[id].shape && M.data.fish[id].shape.style;
    if (tally[st]) tally[st].push(id);
    else badStyle.push(id + '=' + st);
  }
  if (badStyle.length) {
    bad('这些鱼没声明原版模板（会静默退回 v3 几何）：' + badStyle.join(', '));
  } else {
    ok('全部 ' + ids.length + ' 条鱼都声明了原版模板：鳕鱼 ' + tally.cod.length +
      ' 条（' + tally.cod.join('/') + '）、鲑鱼 ' + tally.salmon.length + ' 条');
  }
}

// ---------------------------------------------------------------- ⑥ 碰撞箱接线
{
  const entSrc = stripComments(read(J + 'registry/ModEntities.java'));
  if (/FishVariants\.of\(id\)/.test(entSrc) && /\.sized\(v\.hitW\(\), v\.hitH\(\)\)/.test(entSrc)) {
    ok('实体碰撞箱取自 FishVariants（模型放大时判定框跟着放大）');
  } else {
    bad('ModEntities 没有用 FishVariants 的 hitW/hitH 定碰撞箱 —— '
      + '手写尺寸表和渲染缩放会走散，表现是"鱼比判定框大一圈、用桶捞会捞空"');
  }
  if (/SIZE_OF/.test(entSrc)) bad('ModEntities 里还残留手写的 SIZE_OF 表 —— 它已被 FishVariants 取代');
  else ok('手写的 SIZE_OF 表已彻底移除（碰撞箱只有 FishVariants 一个真源）');
}

// ---------------------------------------------------------------- ⑦ 刷怪蛋接线
{
  const itemSrc = stripComments(read(J + 'registry/ModItems.java'));
  const missing = ids.filter((id) => !itemSrc.includes('"' + id + '_spawn_egg"'));
  if (missing.length) bad('这些鱼种没有刷怪蛋物品：' + missing.join(', '));
  else ok('21 个鱼种都有刷怪蛋物品');

  const notInTab = ids.filter((id) => !itemSrc.includes('output.accept(' + id.toUpperCase() + '_SPAWN_EGG.get())'));
  if (notInTab.length) bad('这些刷怪蛋没进创造页签，游戏里拿不到：' + notInTab.join(', '));
  else ok('21 个刷怪蛋都进了创造页签');

  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const noZh = ids.filter((id) => !zh['item.anglertackle.' + id + '_spawn_egg']);
  if (noZh.length) bad('这些刷怪蛋没有中文名（tooltip 会显示成键名）：' + noZh.join(', '));
  else ok('21 个刷怪蛋都有中文名，例如 ' + zh['item.anglertackle.tigerfish_spawn_egg']
    + ' / ' + zh['item.anglertackle.arapaima_spawn_egg']);
}

console.log('');
console.log(fail === 0 ? '✅ 鱼模型与贴图检查通过' : '❌ 鱼模型与贴图检查未通过（' + fail + ' 项）');
process.exitCode = fail === 0 ? 0 : 1;
