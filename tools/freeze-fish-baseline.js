// 把当前鱼贴图的前景包围盒冻结成基线（比例从此不许变）
const fs = require('fs');
const { decodePng } = require('./image-to-sprite.js');
const TEX = 'src/main/resources/assets/anglertackle/textures/item/';
const BASE = '参考资料/鱼图/_baseline/';
// 鱼清单从 tools/fish-list.js 读，避免和 check-fish-textures.js 各抄一份然后漂移
const IDS = require('./fish-list.js');
fs.mkdirSync(BASE, { recursive: true });
for (const id of IDS) {
  const p = TEX + id + '.png';
  if (!fs.existsSync(p)) { console.log('跳过（缺失）: ' + id); continue; }
  const img = decodePng(fs.readFileSync(p));
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.rgba[(y * img.w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  fs.writeFileSync(BASE + id + '.json', JSON.stringify({ w, h, ar: w / h, canvas: [img.w, img.h] }, null, 2) + '\n');
  console.log(id.padEnd(20) + '画布 ' + (img.w + 'x' + img.h).padEnd(11) + '前景 ' + (w + 'x' + h).padEnd(11) + '比例 ' + (w / h).toFixed(3));
}
console.log('\n基线已写入 ' + BASE);
