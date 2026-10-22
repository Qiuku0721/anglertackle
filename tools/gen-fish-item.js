/*
 * gen-fish-item.js —— 生成**鱼获物品的图标**（textures/item/<id>.png + models/item/<id>.json）。
 *
 * ── 为什么需要它（2026-10-01 加第三批 5 种鱼时补的）────────────────
 * 鱼获物品的图标原来是**按用户给的实物照片抠图**做的（image-to-sprite.js 那条链路），
 * 所以新增鱼种时"没有参考图 → 没有图标"。而 check-self-consistency.js 会断言
 * "每种注册了 FishItem 的鱼都必须有 textures/item/<id>.png"，缺一张就红。
 *
 * 这里的做法不是再去抠图，而是**用鱼自己的模型与贴图离屏渲染**：
 *   · 几何与 UV 全部来自 tools/fish-model.js（和游戏里烘出来的网格是同一份结果）
 *   · 贴图来自 gen-fish-textures.js 画的 textures/entity/fish/<id>.png
 * 于是图标与"鱼在碗里/地上长什么样"天然一致，也不会出现"改配色忘了改图标"。
 *
 * ── 投影与朝向（与 tools/preview-fish.js 一致）────────────────────
 * 沿 -X 看（相机在 +X 侧）：屏幕右 = +Z、屏幕下 = +Y。
 * 模型里吻端在 -Z、尾在 +Z，所以画出来是**头在左、尾在右**的经典鱼图方向。
 *
 * ── 尺寸口径 ────────────────────────────────────────────────
 * 想让图标也说出"这条鱼多大"，所以**不按包围盒归一化**，而是：
 *
 *     raw      = 离屏渲染出来的前景宽度（PPU_SRC 像素/模型单位）
 *     k        = min(1, MAX_W / raw)          ← 只缩不放
 *
 * 于是"大鱼占满画布、小鱼就是小小一条"，与鱼的真实体长同序。
 * 实测（PPU_SRC=512）：孔雀鱼 10×6px、蝴蝶鱼 20×10px、红宝石鱼 23×11px、
 * 象鼻鱼 27×12px、胡子鲇 60×21px。
 *
 * ⚠ 两个都踩过的坑：
 *   ① 目标宽度**必须**用渲染出来的实际宽度算，不能用 modelLenBlocks ——
 *      模型单位 ≠ 格（renderSpecies 里顶点已经乘过 FishVariants 的缩放，差着几倍）。
 *      第一版拿 modelLenBlocks×PPU_SRC 当 raw，于是 k 恒 ≥ 1、每条鱼都铺满 64×64。
 *   ② **不要给小鱼做放大兜底**。加一个"最小 16px"的地板之后，26 条鱼全部被夹到
 *      MAX_W=60px —— 图标之间的大小关系彻底消失，这个功能的全部意义就没了。
 *      4cm 的孔雀鱼在 64×64 画布上就是一条 10px 的小鱼，这是**对的**。
 *   ③ 渲染器**别去碰既有的 21 张图标**。那批是当年逐张抠实物照片做的，它们有
 *      自己的 _baseline 比例基线（check-fish-textures.js / verify-jar.js 都在守）。
 *      无条件重跑会把它们全部覆盖成生成图、并让比例基线全部报红。
 *      所以本脚本默认**只处理还没图标的鱼种**，要覆盖必须显式 --force。
 *
 * （PPU_SRC 取 512 是为了让几何边缘不糊；因为实体贴图本身只有 64px 宽，
 *   放大采样并不会"多出细节"，最后仍按 k 缩回目标宽度、保持像素画的硬边。）
 *
 * 用法：
 *   node tools/gen-fish-item.js                  # 只补缺图标的鱼种
 *   node tools/gen-fish-item.js --force          # 连已有的也重画（会动到老图标！）
 *   node tools/gen-fish-item.js --check          # 只比对，不写盘
 *   node tools/gen-fish-item.js --only=guppy,pike
 */
const fs = require('fs');
const path = require('path');
const M = require('./fish-model');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const TEXDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/entity/fish');
const OUTDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures/item');
const MODDIR = path.join(ROOT, 'src/main/resources/assets/anglertackle/models/item');
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? onlyArg.split(',').filter(Boolean) : null;

const CANVAS = 64;      // 物品图标画布（既有图标全是 64×64）
const PPU_SRC = 512;    // 离屏渲染的取样密度（越大几何边缘越不糊，不影响最终尺寸）
const MAX_W = 60;       // 前景最大宽度，左右各留 2px
const SIZE_A = 38;      // 图标比例尺：每**格模型长度**画多少像素（见 scaleOf 的注释）

// ---------------------------------------------------------------- 数学（与 preview-fish.js 同源）
function rotXYZ(v, r) {
  const [rx, ry, rz] = r;
  let [x, y, z] = v;
  if (rx) { const c = Math.cos(rx), s = Math.sin(rx); const y1 = y * c - z * s, z1 = y * s + z * c; y = y1; z = z1; }
  if (ry) { const c = Math.cos(ry), s = Math.sin(ry); const x1 = x * c + z * s, z1 = -x * s + z * c; x = x1; z = z1; }
  if (rz) { const c = Math.cos(rz), s = Math.sin(rz); const x1 = x * c - y * s, y1 = x * s + y * c; x = x1; y = y1; }
  return [x, y, z];
}

/** 一个部件 → 6 个面（每个面 4 个顶点 + 4 组 uv），完全照 ModelPart.Cube 的顶点序。 */
function faces(p, texOffs) {
  const [bx, by, bz, dx, dy, dz] = p.box;
  const [u0, v0] = texOffs;
  const X0 = bx, X1 = bx + dx, Y0 = by, Y1 = by + dy, Z0 = bz, Z1 = bz + dz;
  const defs = {
    down: [[X1, Y0, Z1], [X0, Y0, Z1], [X0, Y0, Z0], [X1, Y0, Z0], u0 + dz, v0, u0 + dz + dx, v0 + dz],
    up: [[X1, Y1, Z0], [X0, Y1, Z0], [X0, Y1, Z1], [X1, Y1, Z1], u0 + dz + dx, v0 + dz, u0 + dz + 2 * dx, v0],
    west: [[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], u0, v0 + dz, u0 + dz, v0 + dz + dy],
    north: [[X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0], u0 + dz, v0 + dz, u0 + dz + dx, v0 + dz + dy],
    east: [[X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], u0 + dz + dx, v0 + dz, u0 + 2 * dz + dx, v0 + dz + dy],
    south: [[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], u0 + 2 * dz + dx, v0 + dz, u0 + 2 * dz + 2 * dx, v0 + dz + dy],
  };
  const out = {};
  for (const [name, d] of Object.entries(defs)) {
    const verts = [d[0], d[1], d[2], d[3]].map((v) => {
      const r = rotXYZ(v, p.rot);
      return [r[0] + p.at[0], r[1] + p.at[1], r[2] + p.at[2]];
    });
    // 索引 0→(u2,v1) 1→(u1,v1) 2→(u1,v2) 3→(u2,v2)
    out[name] = { verts, uv: [[d[6], d[5]], [d[4], d[5]], [d[4], d[7]], [d[6], d[7]]] };
  }
  return out;
}

// ---------------------------------------------------------------- 渲染（RGBA，背景透明）
/** 把一条鱼按真实模型与贴图画成 RGBA 位图；返回 { w, h, rgba }。 */
function renderSpecies(id, tex) {
  const S = M.species[id];
  const s = S.scale;

  const tris = [];
  for (const p of S.parts) {
    for (const f of Object.values(faces(p, S.texOffs[p.name]))) {
      const v = f.verts.map((q) => [q[0] * s[0], q[1] * s[1], q[2] * s[2]]);
      // 退化面（面积为 0）直接跳过，免得除零
      const area = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      const areaYZ = (v[1][1] - v[0][1]) * (v[2][2] - v[0][2]) - (v[2][1] - v[0][1]) * (v[1][2] - v[0][2]);
      const areaXY = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      if (Math.abs(area) < 1e-9 && Math.abs(areaYZ) < 1e-9 && Math.abs(areaXY) < 1e-9) continue;
      tris.push({ v, uv: f.uv });
    }
  }
  if (!tris.length) throw new Error(id + ' 一个三角面都没生成');

  const pad = 4;
  const zs = tris.flatMap((t) => t.v.map((q) => q[2]));
  const ys = tris.flatMap((t) => t.v.map((q) => q[1]));
  const z0 = Math.min(...zs), y0 = Math.min(...ys);
  const W = Math.ceil((Math.max(...zs) - z0) * PPU_SRC) + pad * 2;
  const H = Math.ceil((Math.max(...ys) - y0) * PPU_SRC) + pad * 2;
  const rgba = new Uint8Array(W * H * 4);            // 默认全 0 = 透明
  const zbuf = new Float32Array(W * H).fill(-1e9);

  const px = (q) => (q[2] - z0) * PPU_SRC + pad;
  const py = (q) => (q[1] - y0) * PPU_SRC + pad;

  for (const t of tris) {
    const P = t.v.map((q) => [px(q), py(q), q[0]]);
    const U = t.uv.map((uv) => [uv[0] / S.atlasW, uv[1] / S.atlasH]);
    for (let i = 1; i < 3; i++) {
      const a = P[0], b = P[i], c = P[i + 1];
      const ua = U[0], ub = U[i], uc = U[i + 1];
      const minx = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxx = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const miny = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxy = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-9) continue;
      for (let y = miny; y <= maxy; y++) {
        for (let x = minx; x <= maxx; x++) {
          const l0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
          const l1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
          const l2 = 1 - l0 - l1;
          if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
          const depth = l0 * a[2] + l1 * b[2] + l2 * c[2];
          const o = y * W + x;
          if (depth <= zbuf[o]) continue;
          const u = l0 * ua[0] + l1 * ub[0] + l2 * uc[0];
          const vv = l0 * ua[1] + l1 * ub[1] + l2 * uc[1];
          const tx = Math.min(S.atlasW - 1, Math.max(0, Math.floor(u * S.atlasW)));
          const ty = Math.min(S.atlasH - 1, Math.max(0, Math.floor(vv * S.atlasH)));
          const to = (ty * S.atlasW + tx) * 4;
          if (tex.rgba[to + 3] === 0) continue;      // 贴图那一格没画 = 这里不该有像素
          zbuf[o] = depth;
          rgba[o * 4] = tex.rgba[to];
          rgba[o * 4 + 1] = tex.rgba[to + 1];
          rgba[o * 4 + 2] = tex.rgba[to + 2];
          rgba[o * 4 + 3] = 255;
        }
      }
    }
  }
  return { w: W, h: H, rgba };
}

/** 前景包围盒。 */
function bbox(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.rgba[(y * img.w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 定缩放：目标是"**图标宽度正比于模型长度**（每格 SIZE_A 像素），超过 MAX_W 才缩"。
 *
 * ⚠ 这里**不能**直接把渲染像素宽度夹到 MAX_W（第一版就是这么写的）：
 *   渲染出来 26 条鱼全都远大于 60px，于是 k 恒等于 60/raw，**每条鱼都变成 60px 宽** ——
 *   图标之间的大小关系彻底消失，"小鱼就是小图标"这件事也就没了。
 *   比例尺必须挂在**模型长度**上，渲染像素宽度只用来求 k。
 *
 * @param rawW        渲染出来的前景宽度（像素）
 * @param modelBlocks 该鱼的模型长度（格，来自 fish-model.js 的 modelLenBlocks）
 */
function scaleOf(rawW, modelBlocks) {
  const target = Math.min(MAX_W, Math.max(1, Math.round(modelBlocks * SIZE_A)));
  return { raw: rawW, target, k: Math.min(1, target / rawW) };
}

/** 裁到前景包围盒 → 最近邻缩放到目标宽 → 居中放进 64×64 画布。 */
function toIcon(img, k) {
  const b = bbox(img);
  if (!b) throw new Error('渲染结果是全透明的');
  const bw = Math.max(1, Math.round(b.w * k));
  const bh = Math.max(1, Math.round(b.h * k));
  const out = new Uint8Array(CANVAS * CANVAS * 4);
  const ox = Math.round((CANVAS - bw) / 2);
  const oy = Math.round((CANVAS - bh) / 2);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      // 目标像素 → 前景内的源像素（最近邻，保持像素画的硬边）
      const sx = b.x0 + Math.min(b.w - 1, Math.floor(x / k));
      const sy = b.y0 + Math.min(b.h - 1, Math.floor(y / k));
      const so = (sy * img.w + sx) * 4;
      if (img.rgba[so + 3] === 0) continue;
      const oo = ((y + oy) * CANVAS + (x + ox)) * 4;
      out[oo] = img.rgba[so]; out[oo + 1] = img.rgba[so + 1];
      out[oo + 2] = img.rgba[so + 2]; out[oo + 3] = img.rgba[so + 3];
    }
  }
  return { w: CANVAS, h: CANVAS, rgba: out };
}

const modelJson = (id) => JSON.stringify({
  parent: 'minecraft:item/generated',
  textures: { layer0: 'anglertackle:item/' + id },
}, null, 2) + '\n';

// ---------------------------------------------------------------- 主流程
const all = Object.keys(M.data.fish);
const ids = only ? all.filter((id) => only.includes(id)) : all;
if (only && ids.length !== only.length) {
  const unknown = only.filter((x) => !all.includes(x));
  throw new Error('--only 里有不认识的鱼种：' + unknown.join(', '));
}

const rows = [];
let changed = 0, missing = 0, skipped = 0;
for (const id of ids) {
  const texPath = path.join(TEXDIR, id + '.png');
  if (!fs.existsSync(texPath)) { console.log('  ⚠ 缺实体贴图，跳过：' + id); missing++; continue; }
  // 默认只补"还没有图标"的鱼种：既有的 21 张是当年逐张抠实物照片做的，
  // 有自己的比例基线，不该被渲染图覆盖（要覆盖请显式 --force）。
  const pngPath = path.join(OUTDIR, id + '.png');
  if (!FORCE && fs.existsSync(pngPath)) { skipped++; continue; }

  const raw = renderSpecies(id, decodePng(fs.readFileSync(texPath)));
  const sc = scaleOf(bbox(raw).w, M.species[id].modelLenBlocks);
  const icon = toIcon(raw, sc.k);
  const png = encodePng(icon.w, icon.h, icon.rgba);
  const b = bbox(icon);
  rows.push([id, b.w, b.h, sc.raw, sc.target]);

  const targets = [
    [pngPath, png],
    [path.join(MODDIR, id + '.json'), Buffer.from(modelJson(id), 'utf8')],
  ];
  for (const [file, buf] of targets) {
    const old = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (old && old.equals(buf)) continue;
    changed++;
    if (CHECK) { console.log('  ✗ ' + path.relative(ROOT, file) + ' 与生成结果不一致'); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log('  ✎ ' + path.relative(ROOT, file) + (old === null ? '（新建）' : '（更新）'));
  }
}

console.log('');
console.log('  本次生成（渲染 ' + PPU_SRC + 'px/单位，前景宽上限 ' + MAX_W + 'px）：');
for (const [id, w, h, rawW, target] of rows) {
  const S = M.species[id];
  console.log('    ' + id.padEnd(24) + String(S.lengthCm).padStart(4) + 'cm  模型 '
    + String(S.modelLenBlocks).padStart(4) + ' 格  渲染 ' + String(rawW).padStart(4)
    + 'px → 取 ' + String(target).padStart(2) + 'px → 前景 ' + String(w).padStart(2)
    + '×' + String(h).padStart(2) + 'px');
}
if (skipped) console.log('    （已有图标的 ' + skipped + ' 种未处理；要重画请加 --force）');
console.log('');
if (CHECK) {
  console.log(changed === 0
    ? '✅ 待生成的鱼种图标与模型 json 都和模型/贴图数据源一致'
    : '❌ 有 ' + changed + ' 个文件需要重新生成');
  process.exitCode = changed === 0 ? 0 : 1;
} else {
  console.log('✅ 生成 ' + rows.length + ' 种 → ' + changed + ' 个文件变更'
    + (missing ? '（跳过 ' + missing + ' 种：缺实体贴图）' : ''));
}
