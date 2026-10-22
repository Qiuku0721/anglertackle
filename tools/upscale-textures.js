// ============================================================================
//  upscale-textures.js -- 把所有贴图统一放大到 64×64（最近邻，保持硬边像素风）
//
//  做法：扫描 textures/ 下所有 PNG，凡不是 64×64 的就按整数倍最近邻放大。
//  为什么用最近邻：像素画插值会糊（和文字模糊是同类问题），
//  最近邻放大保持方块边缘锐利。
//
//  用法: node tools/upscale-textures.js
// ============================================================================
const fs = require('fs');
const path = require('path');
const { decodePng, encodePng } = require('./image-to-sprite.js');

const ROOT = path.join(__dirname, '..');
const TARGET = 64;

function upscaleFile(filePath) {
  const img = decodePng(fs.readFileSync(filePath));
  if (img.w === TARGET && img.h === TARGET) {
    return 'skip';
  }
  // 只支持整数倍放大；非整数倍时按比例取样（仍用最近邻）
  const factor = TARGET / img.w;
  const rgba = new Uint8Array(TARGET * TARGET * 4);
  for (let y = 0; y < TARGET; y++) {
    const sy = Math.min(img.h - 1, Math.floor(y / factor));
    for (let x = 0; x < TARGET; x++) {
      const sx = Math.min(img.w - 1, Math.floor(x / factor));
      const si = (sy * img.w + sx) * 4;
      const di = (y * TARGET + x) * 4;
      rgba[di] = img.rgba[si];
      rgba[di + 1] = img.rgba[si + 1];
      rgba[di + 2] = img.rgba[si + 2];
      rgba[di + 3] = img.rgba[si + 3];
    }
  }
  fs.writeFileSync(filePath, encodePng(TARGET, TARGET, rgba));
  return img.w + 'x' + img.h + ' → ' + TARGET + 'x' + TARGET;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.png')) out.push(p);
  }
  return out;
}

const root = path.join(ROOT, 'src/main/resources/assets/anglertackle/textures');
const files = walk(root);
let changed = 0;
let skipped = 0;
for (const f of files) {
  const r = upscaleFile(f);
  if (r === 'skip') {
    skipped++;
  } else {
    changed++;
    console.log('  ' + path.basename(f).padEnd(28) + r);
  }
}
console.log('\n共 ' + files.length + ' 张贴图：放大 ' + changed + ' 张，已是 64×64 的 ' + skipped + ' 张');
