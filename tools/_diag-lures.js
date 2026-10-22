/*
 * 一次性：① 诊断 3 个拟饵图标为什么几乎是空的 ② 去掉名字里的等级前缀
 *
 * 用户 2026-10-01 澄清："前面的紫啊蓝啊的都是提醒你这是什么等级的拟饵，
 * 不是说名字要带这些。" —— 现有的拟饵（软虫拟饵 / 浅层刺激拟饵 / 钢珠声诱拟饵）
 * 名字里都不带等级，这 3 个也不该带。
 */
const fs = require('fs');
const { decodePng } = require('./image-to-sprite.js');

// ---------------------------------------------------------------- ① 诊断
const DIR = 'src/main/resources/assets/anglertackle/textures/item/';
const REF = 'C:/Users/LENOVO-/.dsh/attachments/v1/objects/';
const ITEMS = [
  ['lure_depthfinder', '1a/1a88aad552747ca43d7bbb9ebbfd9c1baee3833c902b607e6b33c6cba84c3a88'],
  ['lure_paddletail', '5a/5a9c8afa97ee7d9353ee2a6f06197cb20eeb0b463ee0e97e3ffd0d4c2bb17d7a'],
  ['lure_vibration', 'b9/b911c67d6c02167932882e3e8916004a7326fbc251502b17effc5382d1635041'],
];
const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

console.log('=== 产出的拟饵图标 ===');
for (const [id] of ITEMS) {
  const out = decodePng(fs.readFileSync(DIR + id + '.png'));
  let n = 0;
  for (let i = 0; i < out.w * out.h; i++) { if (out.rgba[i * 4 + 3] > 128) n++; }
  // 顺便看看不透明像素的平均色（判断抠出来的到底是主体还是残留）
  let s = [0, 0, 0];
  for (let i = 0; i < out.w * out.h; i++) {
    if (out.rgba[i * 4 + 3] > 128) { s[0] += out.rgba[i * 4]; s[1] += out.rgba[i * 4 + 1]; s[2] += out.rgba[i * 4 + 2]; }
  }
  const mean = n ? hex(s.map((v) => v / n)) : '—';
  console.log(`  ${id.padEnd(20)} ${out.w}x${out.h}  不透明 ${n} 像素 (${(n / (out.w * out.h) * 100).toFixed(1)}%)  均值色 ${mean}`);
}

console.log('=== 参考图 ===');
for (const [id, rel] of ITEMS) {
  const ref = decodePng(fs.readFileSync(REF + rel));
  const at = (x, y) => { const o = (y * ref.w + x) * 4; return [ref.rgba[o], ref.rgba[o + 1], ref.rgba[o + 2]]; };
  // 统计"接近四角背景色"的像素占比 —— 背景要是占了大半，按颜色抠就该把它去掉
  const bg = at(2, 2);
  const near = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 40;
  let bgN = 0, tot = 0;
  for (let y = 0; y < ref.h; y += 2) {
    for (let x = 0; x < ref.w; x += 2) { tot++; if (near(at(x, y))) bgN++; }
  }
  console.log(`  ${id.padEnd(20)} ${ref.w}x${ref.h}  左上角 ${hex(bg)}  接近该色的像素 ${(bgN / tot * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------- ② 改名
const NAMES = {
  zh_cn: {
    'item.anglertackle.lure_depthfinder': '深水探索米诺',
    'item.anglertackle.lure_paddletail': '深水摆尾拟饵',
    'item.anglertackle.lure_vibration': '深潜巨物振动饵',
  },
  en_us: {
    'item.anglertackle.lure_depthfinder': 'Deep-Water Scanner Lure',
    'item.anglertackle.lure_paddletail': 'High-Frequency Paddle-Tail Swimbait',
    'item.anglertackle.lure_vibration': 'Deep-Diving Vibration Lure',
  },
};
console.log('=== 名字（去掉等级前缀；等级是数值，不进名字）===');
for (const [lang, keys] of Object.entries(NAMES)) {
  const p = 'src/main/resources/assets/anglertackle/lang/' + lang + '.json';
  const o = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  for (const [k, v] of Object.entries(keys)) {
    if (o[k] === undefined) { console.log(`  ❌ ${lang} 缺 ${k}`); continue; }
    console.log(`  ${lang}  ${o[k]}  →  ${v}`);
    o[k] = v;
  }
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
}
console.log('done');
