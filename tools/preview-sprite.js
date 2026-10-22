// ============================================================================
//  preview-sprite.js -- 直接在终端里预览字符画贴图
//
//  为什么不用 preview-texture.js：那个要先解码 PNG，多一层出错的地方。
//  这个脚本直接从 gen-textures.js 里的字符画渲染，所见即所得。
//
//  用法:
//    node tools/preview-sprite.js plain_hook
//    node tools/preview-sprite.js            （列出所有可预览的名字）
//    node tools/preview-sprite.js --all
// ============================================================================
const path = require('path');

// 直接从生成脚本 require 字符画定义（gen-textures.js 已在末尾 module.exports）
const { SPRITES, BOBBER_TEX, P: PALETTE } = require('./gen-textures.js');

const arg = process.argv[2];

if (!arg) {
  console.log('可预览的贴图（' + Object.keys(SPRITES).length + ' 个）：');
  const names = Object.keys(SPRITES);
  for (let i = 0; i < names.length; i += 3) {
    console.log('  ' + names.slice(i, i + 3).map((n) => n.padEnd(24)).join(''));
  }
  console.log('\n另可预览: BOBBER_TEX（浮漂实体贴图，32×32）');
  console.log('用法: node tools/preview-sprite.js <名字>');
  process.exit(0);
}

function render(name, rows) {
  console.log('\n=== ' + name + '  (' + rows[0].length + '×' + rows.length + ') ===');
  for (const row of rows) {
    let line = '';
    for (const ch of row) {
      const hex = PALETTE[ch];
      if (!hex) {
        line += '  ';
        continue;
      }
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      line += '\x1b[48;2;' + r + ';' + g + ';' + b + 'm  \x1b[0m';
    }
    console.log(line);
  }
}

if (arg === '--all') {
  for (const [name, rows] of Object.entries(SPRITES)) {
    render(name, rows);
  }
} else if (arg === 'BOBBER_TEX') {
  render('BOBBER_TEX', BOBBER_TEX);
} else if (SPRITES[arg]) {
  render(arg, SPRITES[arg]);
} else {
  console.error('没有这个贴图: ' + arg);
  process.exit(1);
}
