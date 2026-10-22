// 预览任意 PNG 贴图为 ASCII（用 image-to-sprite.js 里的解码器，保证准确）
const fs = require('fs');
const { decodePng } = require('./image-to-sprite.js');

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/preview-png.js <png>');
  process.exit(2);
}
const img = decodePng(fs.readFileSync(file));
console.log('\n=== ' + file.split(/[\\/]/).pop() + '  ' + img.w + 'x' + img.h + ' ===');
console.log('    ' + Array.from({ length: img.w }, (_, i) => i % 10).join(''));
for (let y = 0; y < img.h; y++) {
  let line = '';
  for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4;
    const a = img.rgba[i + 3];
    if (a < 24) { line += '  '; continue; }
    const r = img.rgba[i], g = img.rgba[i + 1], b = img.rgba[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    line += lum < 45 ? '##' : lum < 90 ? '%%' : lum < 140 ? '==' : lum < 190 ? '++' : lum < 230 ? '::' : '..';
  }
  console.log(String(y).padStart(3) + ' ' + line);
}
