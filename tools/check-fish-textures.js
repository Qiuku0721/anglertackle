// 校验鱼贴图：**前景包围盒的宽高比必须与基线一致**。
//
// 教训：曾经为了"填掉镂空"给抠图加了 --seal，结果把鳍与鳍之间的空隙也补上，
// 包围盒上下变高，整条鱼在 GUI 里被**上下拉高 11~19%**。所以比例必须锁死。
//
// 基线 = 参考资料/鱼图/_baseline/<id>.json（记录前景 w/h 与内容 sha），
// 由 tools/freeze-fish-baseline.js 生成。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ATL_ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

const { decodePng } = require('./image-to-sprite.js');

const TEX = path.join(ATL_ROOT, 'src/main/resources/assets/anglertackle/textures/item') + path.sep;
const BASE = path.join(ATL_ROOT, '参考资料/鱼图/_baseline') + path.sep;
// 鱼清单从 tools/fish-list.js 读，避免和 freeze-fish-baseline.js 各抄一份然后漂移
const IDS = require('./fish-list.js');

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

let fail = 0;
const TOL = 0.03;   // 宽高比允许 3% 偏差
console.log('id'.padEnd(20) + '画布'.padEnd(12) + '前景'.padEnd(12) + '宽高比'.padEnd(9) + '基线比'.padEnd(9) + '判定');
for (const id of IDS) {
  const texPath = TEX + id + '.png';
  const basePath = BASE + id + '.json';
  if (!fs.existsSync(texPath)) { console.log(id.padEnd(20) + '❌ 贴图缺失'); fail++; continue; }
  const img = decodePng(fs.readFileSync(texPath));
  const b = bbox(img);
  if (!b) { console.log(id.padEnd(20) + '❌ 全透明'); fail++; continue; }
  const ar = b.w / b.h;

  let verdict = 'OK';
  let baseAr = '-';
  if (fs.existsSync(basePath)) {
    const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    baseAr = base.ar.toFixed(3);
    if (Math.abs(ar / base.ar - 1) > TOL) { verdict = '❌ 比例被改（原 ' + base.ar.toFixed(3) + '）'; fail++; }
    else if (b.w !== base.w || b.h !== base.h) { verdict = '⚠ 尺寸变了（原 ' + base.w + 'x' + base.h + '），比例仍对'; }
  } else {
    verdict = '⚠ 无基线';
  }
  console.log(id.padEnd(20) + (img.w + 'x' + img.h).padEnd(12) + (b.w + 'x' + b.h).padEnd(12)
    + ar.toFixed(3).padEnd(9) + baseAr.padEnd(9) + verdict);
}
console.log('\n检查 ' + IDS.length + ' 条，失败 ' + fail + ' 条（宽高比容差 ±' + (TOL * 100) + '%）');
process.exit(fail ? 1 : 0);
