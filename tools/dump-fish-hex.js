/*
 * dump-fish-hex.js —— 列出每种鱼资料里出现的 hex 及其紧邻的中文标签，
 * 用于人工挑选配色。跑一次看输出即可，不是构建产物。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'fish_research';
const only = process.argv.slice(2);
const ids = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
  .filter((id) => only.length === 0 || only.includes(id));

/** 抓出 "某色 #RRGGBB 描述" 里的 (hex, 后随 12 字) */
function pick(label, s) {
  const out = [];
  const re = /#([0-9A-Fa-f]{6})\s*([^；;。\n]{0,16})/g;
  let m;
  while ((m = re.exec(String(s || '')))) out.push('#' + m[1].toUpperCase() + ' ' + m[2].trim());
  return out.length ? label + ': ' + out.slice(0, 4).join(' | ') : null;
}

for (const id of ids) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
  console.log('=== ' + id + '  [' + j.bodyShape + ']  ' + String(j.nameZh || '').slice(0, 24));
  for (const [k, v] of [
    ['背', j.dorsalColor], ['侧', j.flankColor], ['腹', j.bellyColor],
    ['纹', j.markings], ['鳍', j.finShape], ['眼', j.eyeDescription], ['须', j.barbels],
  ]) {
    const line = pick(k, v);
    if (line) console.log('   ' + line.slice(0, 200));
  }
}
