/*
 * check-reel-sound.js —— 收线声音的三条断言（用户 2026-10-05："路亚收线时没有声音"）。
 *
 * 为什么值得守：
 *   ① **不许往仓库里塞音频**。我们用的是原版音效（\`SoundEvents.LEVER_CLICK\` +
 *      \`SoundEvents.FISHING_BOBBER_RETRIEVE\`），一旦有人改成自带的 ogg，
 *      体积、授权、资源包冲突三件事一起上门 —— 那条路要走就得有人明确决定。
 *   ② **不许常驻响**。只允许"有会话 + 正在收线 + 不在蓄力"时出声；
 *      写成"只要拿着竿就响"会让玩家在岸上站着都哗啦哗啦。
 *   ③ **音量必须小**。咔哒是节奏不是噪音，单声音量上限 0.25。
 *
 * 用法：node tools/check-reel-sound.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ⚠ 判据必须去掉注释：ReelSounds 的说明里就写着 "sounds.json"（讲原版音效从哪查的），
//   不 strip 的话这条断言会把自己的注释当成"引用了自带音频"，误报一次（踩过）。
const { stripComments } = require('./java-source.js');
const readCode = (p) => stripComments(read(p));
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 收线声音检查 ===\n');
const SND = 'src/main/java/com/whitecobalt/anglertackle/client/ReelSounds.java';
const EV = 'src/main/java/com/whitecobalt/anglertackle/client/ClientEvents.java';

if (!exists(SND)) {
  bad('缺少 ' + SND + '（收线声音的实现）');
} else {
  const s = readCode(SND);
  // ① 只用原版音效
  const custom = [...s.matchAll(/SoundEvents\.([A-Z_0-9]+)/g)].map((m) => m[1]);
  if (!custom.length) bad('ReelSounds 里一个 SoundEvents 都没用 —— 是不是改成自带音频了？');
  else if (/sounds\.json|ResourceLocation\.(withDefaultNamespace|parse)\("anglertackle:/.test(s)) {
    bad('ReelSounds 引用了自己的音频资源 —— 本项目**不加**音频文件（体积/授权/资源包冲突），要用原版音效');
  } else ok('只用原版音效：' + [...new Set(custom)].join(', '));

  // ①b 仓库里确实没有音频
  const sndDir = 'src/main/resources/assets/anglertackle/sounds';
  if (exists(sndDir) && fs.readdirSync(path.join(ROOT, sndDir)).length) {
    bad('仓库里出现了 assets/anglertackle/sounds/ 内容 —— 收线声音不该走这条路');
  } else ok('仓库里没有任何自带的音频文件（零授权风险）');

  // ② 只在收线时响
  if (!/!state\.inSession\(\)\s*\|\|\s*!state\.reeling\(\)/.test(s.replace(/\s+/g, ' '))) {
    bad('没有"非会话/未收线就跳过"的判断 —— 会在岸上站着也响');
  } else ok('有门禁：不在会话中、或没在收线时不发声');

  // ③ 音量上限
  const vols = [...s.matchAll(/([A-Z_]*VOLUME)\s*=\s*([\d.]+)F/g)].map((m) => ({ k: m[1], v: Number(m[2]) }));
  const tooLoud = vols.filter((x) => x.v > 0.25);
  if (tooLoud.length) bad('音量过大：' + tooLoud.map((x) => x.k + '=' + x.v).join(', ') + '（上限 0.25，咔哒是节奏不是噪音）');
  else ok('音量都在 0.25 以下：' + vols.map((x) => x.k + '=' + x.v).join(', '));
}

// ④ 确实被客户端 tick 调用了（否则写了也不响 —— 正是用户这次报的症状）
if (!exists(EV)) bad('缺少 ' + EV);
else if (!/ReelSounds\.tick\(/.test(read(EV))) bad('ClientEvents 没有调用 ReelSounds.tick(...) —— 声音永远不会响');
else ok('ClientEvents 的客户端 tick 里确实调了 ReelSounds.tick(state)');

console.log('');
if (fail === 0) {
  console.log('✅ 收线声音检查通过：原版音效、只在收线时响、音量克制、确实接进了客户端 tick');
} else {
  console.log('❌ 收线声音检查失败：' + fail + ' 项');
}
process.exitCode = fail === 0 ? 0 : 1;
