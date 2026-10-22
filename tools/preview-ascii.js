// ============================================================================
//  preview-ascii.js -- 用纯文本符号预览字符画（不依赖终端 ANSI 支持）
//
//  深色字符 = 深色像素，浅色字符 = 浅色像素，空格 = 透明。
//  每格用两个字符宽，保证不变形。
//
//  用法:
//    node tools/preview-ascii.js plain_hook
//    node tools/preview-ascii.js --all
//    node tools/preview-ascii.js            （列出名字）
// ============================================================================
const { SPRITES, BOBBER_TEX, P } = require('./gen-textures.js');

/** 把 24 位颜色映射成一个"看起来差不多"的 ASCII 符号。 */
function shadeOf(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 45) return '##';
  if (lum < 80) return '%%';
  if (lum < 120) return '==';
  if (lum < 165) return '++';
  if (lum < 205) return '::';
  return '..';
}

function render(name, rows) {
  console.log('');
  console.log('=== ' + name + '  ' + rows[0].length + 'x' + rows.length + ' ===');
  console.log('   ' + '0123456789ABCDEF'.slice(0, rows[0].length).split('').join(' '));
  rows.forEach((row, y) => {
    let line = '';
    for (const ch of row) {
      const hex = P[ch];
      line += (hex ? shadeOf(hex) : '  ') + '';
    }
    console.log(String(y).padStart(2) + ' ' + line);
  });
}

const arg = process.argv[2];
if (!arg) {
  const names = Object.keys(SPRITES);
  console.log('可预览 ' + names.length + ' 个贴图（另可预览 BOBBER_TEX）：');
  names.forEach((n) => console.log('  ' + n));
  process.exit(0);
}
if (arg === '--all') {
  Object.entries(SPRITES).forEach(([n, r]) => render(n, r));
  render('BOBBER_TEX', BOBBER_TEX);
} else if (arg === 'BOBBER_TEX') {
  render('BOBBER_TEX', BOBBER_TEX);
} else if (SPRITES[arg]) {
  render(arg, SPRITES[arg]);
} else {
  console.error('没有这个贴图: ' + arg);
  process.exit(1);
}
