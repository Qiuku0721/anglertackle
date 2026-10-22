/*
 * dump-fish-research.js —— 把 fish_research/*.json 的 21 份结构化资料压成一张表，
 * 便于人工核对（不是构建产物，跑一次看输出即可）。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'fish_research';
const ids = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

const hexes = (s) => (String(s).match(/#[0-9A-Fa-f]{6}/g) || []).map((h) => h.toUpperCase());

let hashOverall = 0;
for (const id of ids) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
  const d = hexes(j.dorsalColor), f = hexes(j.flankColor), b = hexes(j.bellyColor);
  if (!d.length || !f.length || !b.length) hashOverall++;
  const mk = String(j.markings || '');
  const key = [];
  for (const [kw, tag] of [
    ['横带', 'bars'], ['垂直暗带', 'bars'], ['纵带', 'bars'], ['横纹', 'bars'], ['暗带', 'bars'],
    ['斑点', 'spots'], ['黑斑', 'spots'], ['圆斑', 'spots'], ['斑块', 'spots'],
    ['细点', 'speckle'], ['细密', 'speckle'], ['虫纹', 'speckle'], ['大理石', 'speckle'], ['碎斑', 'speckle'],
    ['纵纹', 'stripes'], ['纵条纹', 'stripes'], ['纵列', 'stripes'],
    ['无斑', 'none'], ['素色', 'none'], ['无纹', 'none'],
  ]) if (mk.includes(kw)) key.push(tag);
  console.log([
    id.padEnd(18),
    String(j.bodyShape || '?').padEnd(6),
    (d[0] || '------') + '/' + (f[0] || '------') + '/' + (b[0] || '------'),
    'n=' + [d.length, f.length, b.length].join(','),
    'mk=' + [...new Set(key)].join('|'),
    'L=' + String(j.typicalLengthCm || '?'),
  ].join('  '));
}
console.log('\n缺色字段的条目数：' + hashOverall);
