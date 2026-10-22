'use strict';
/**
 * check-fish-names.js —— 守住**学名 / 中文名修正 7 条**（出处：docs/料理适配策划案.md §4 第 5 项）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────
 * 这 7 条修正全是"**把错的写成对的**"，而错的那些**恰恰是最广为流传的写法**
 * （水族书、市场名、纪录片解说）。它们有三个共同的坏性质：
 *   ① 改错了**不会报错**，只是玩家/下一个人又被教了一遍错的；
 *   ② 最容易被"顺手改回去" —— 下一个人照着网上抄，看起来反而更"眼熟"；
 *   ③ 一旦只改了 JSON、没改源码注释（或反过来），就是**两份互相矛盾的图鉴**。
 * 所以这里两边都守，并且要求"错的写法**必须带着说明出现**"（不能裸着出现）。
 *
 * 断言：
 *   A. 7 条规则里的鱼 id 都**真实存在**（FishSpecies.java 里数得出来）—— 拼错一个字母
 *      这条规则就变成"永远通过"的空断言，这是本仓库最忌讳的东西。
 *   B. `fish_research/<id>.json` 的 `nameZh` / `scientificName` 里必须出现"正确写法"；
 *   C. `FishSpecies.java` 里**该鱼自己的注释块**（紧贴在 `new FishSpecies("<id>"` 上方的那段
 *      `//`）里也必须出现"正确写法" —— 只改一处就是两份矛盾的图鉴；
 *   D. **错的写法不许裸奔**：每个 `forbidden` 词在两边文本里出现时，窗口内必须带 `caveat` 词
 *      （例："Sebastes marinus" 旁边必须有"废弃"）。判据是"距离"而不是"文件里有没有出现过"，
 *      因为错的写法**本来就要留着**（留档才说明为什么改）。
 *   E. 中文显示名（lang/zh_cn.json）必须等于规范名 —— 这是唯一会真的显示给玩家的那一处；
 *   F. 策划文档里那张表必须仍然是 **7 行**（表格被删/被并，第 5 项就成了空头承诺）。
 *
 * 用法：node tools/check-fish-names.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const SPECIES = 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java';
const LANG = 'src/main/resources/assets/anglertackle/lang/zh_cn.json';
const DOC = 'docs/料理适配策划案.md';

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('=== 学名 / 中文名修正 7 条检查（图鉴文本不许被改回错的名字） ===\n');

/**
 * 每条规则：
 *   id        鱼种 id（必须能在 FishSpecies.java 里找到）
 *   good      必须出现在 JSON 与源码注释里的"正确写法"
 *   codex     只要求出现在**源码注释**里的额外标记（依据、出处）
 *   jsonOnly  只要求出现在 JSON 里的额外标记
 *   forbidden [错的写法, 必须同框出现的说明词（可为数组，任一命中即可）, 窗口字符数]
 *   display   若给了：lang 里的中文名必须**恰好**是这个（唯一会显示给玩家的那处）
 */
const RULES = [
  {
    id: 'jewel_cichlid',
    good: ['Rubricatochromis bimaculatus', '旧名'],
    codex: ['Hemichromis bimaculatus', '2022'],
    forbidden: [['Hemichromis bimaculatus', '旧名', 40]],
    display: '红宝石鱼',
    why: '红宝石鱼的属名 2022 年已从 Hemichromis 分出为 Rubricatochromis',
  },
  {
    id: 'electric_eel',
    good: ['Electrophorus electricus', '2019'],
    codex: ['E. voltai', 'E. varii', '860V', 'Guiana Shield'],
    forbidden: [['Electrophorus electricus', '2019', 400]],
    display: '电鳗',
    why: '2019 年电鳗属被拆成三种；860V 属于 E. voltai，本模组按 E. electricus s.s. 记',
  },
  {
    id: 'redfish',
    good: ['Sebastes norvegicus', 'marinus'],
    codex: ['norvegicus', 'marinus'],
    forbidden: [['Sebastes marinus', '废弃', 60]],
    display: '平鲉',
    why: 'Sebastes marinus 是废弃误用名，现用 S. norvegicus',
  },
  {
    id: 'sablefish',
    good: ['Anoplopoma fimbria', '犬牙鱼'],
    codex: ['银鳕', '贸易名', 'Dissostichus'],
    forbidden: [['银鳕鱼', '贸易名', 120]],
    display: '裸盖鱼',
    why: '裸盖鱼不是鳕形目；中文语境的"银鳕鱼"是贸易名（通常指犬牙鱼）',
  },
  {
    id: 'rainbow_trout',
    good: ['Oncorhynchus mykiss', 'Salmo salar'],
    codex: ['三文鱼', 'Salmo salar', '不同属'],
    forbidden: [['三文鱼', ['误导', '不是', '营销'], 260]],
    display: '虹鳟',
    why: '虹鳟不是"三文鱼"：三文鱼指大西洋鲑 Salmo salar，虹鳟是太平洋鲑属',
  },
  {
    id: 'african_butterflyfish',
    good: ['Pantodon buchholzi', '齿蝶鱼'],
    // JSON 里英文/拉丁结构决定它只能这么写；源码注释里要写清科名与"与海水蝴蝶鱼无关"
    jsonOnly: ['齿蝶鱼'],
    codex: ['齿蝶鱼科', 'Chaetodontidae'],
    forbidden: [['非洲蝴蝶鱼', '俗称', 60]],
    display: '齿蝶鱼',
    why: '本种规范中文名是「齿蝶鱼」（淡水单型科）；"非洲蝴蝶鱼"是水族俗称',
  },
  {
    id: 'giant_siamese_carp',
    good: ['Catlocarpio siamensis', '暹罗印度鲤'],
    jsonOnly: ['暹罗印度鲤'],
    codex: ['暹罗印度鲤', '巨鲶鲤'],
    forbidden: [['巨鲶鲤', '不是本种', 40]],
    display: '巨暹罗鲤',
    why: 'FishBase 规范名是「暹罗印度鲤」；"巨鲶鲤"不是本种',
  },
];

// ── A. 鱼种 id 真实存在 + 取出每条鱼自己的注释块 ──────────────────────────────
const speciesSrc = exists(SPECIES) ? read(SPECIES) : '';
if (!speciesSrc) bad('缺 ' + SPECIES);
const realIds = new Set([...speciesSrc.matchAll(/new FishSpecies\("([a-z_]+)"/g)].map((m) => m[1]));

/** 取 `new FishSpecies("<id>"` 上方**紧贴**的那段 `//` 注释（中间不留空行）。 */
function codexBlockOf(id) {
  const lines = speciesSrc.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes('new FishSpecies("' + id + '"'));
  if (at < 0) return null;
  const out = [];
  for (let i = at - 1; i >= 0; i--) {
    if (/^\s*\/\//.test(lines[i])) out.unshift(lines[i]);
    else break;
  }
  return out.join('\n');
}

const lang = JSON.parse(read(LANG));

/** 窗口判据：`wrong` 的每一次出现，前后 window 字符内必须出现 `caveat`（数组则任一命中即可）。 */
function checkCaveat(label, text, wrong, caveat, window) {
  const words = Array.isArray(caveat) ? caveat : [caveat];
  let i = -1, n = 0, naked = 0;
  while ((i = text.indexOf(wrong, i + 1)) >= 0) {
    n++;
    const around = text.slice(Math.max(0, i - window), i + wrong.length + window);
    if (!words.some((w) => around.includes(w))) naked++;
  }
  if (naked > 0) {
    bad(label + '：错的写法「' + wrong + '」有 ' + naked + '/' + n + ' 处**裸奔**'
      + '（前后 ' + window + ' 字内没有「' + words.join('」或「') + '」）—— 错的写法可以留档，'
      + '但必须**带着"这是旧的/错的"说明**出现，否则下一个人会当成正解抄回去');
  }
  return { n, naked };
}

for (const r of RULES) {
  const label = r.id;
  if (!realIds.has(r.id)) {
    bad('规则里的鱼种 id 不存在：' + r.id + '（拼错一个字母 = 这条规则永远通过，什么也没守住）');
    continue;
  }
  const block = codexBlockOf(r.id);
  if (!block) { bad(label + '：FishSpecies.java 里找不到它的注释块'); continue; }

  const rp = 'fish_research/' + r.id + '.json';
  let research = null;
  if (!exists(rp)) bad(label + '：缺调研资料 ' + rp);
  else {
    try {
      const j = JSON.parse(read(rp));
      research = String(j.nameZh || '') + '\n' + String(j.scientificName || '');
      if (!String(j.scientificName || '').trim()) bad(label + '：调研资料没有 scientificName');
    } catch (e) { bad(label + '：' + rp + ' 解析失败：' + e.message); }
  }

  // B/C. 正确写法两边都要有
  const missing = [];
  if (research !== null) {
    for (const g of r.good) if (!research.includes(g)) missing.push('调研资料缺「' + g + '」');
    for (const g of (r.jsonOnly || [])) if (!research.includes(g)) missing.push('调研资料缺「' + g + '」');
  }
  for (const g of r.good) if (!block.includes(g)) missing.push('源码注释缺「' + g + '」');
  for (const g of (r.codex || [])) if (!block.includes(g)) missing.push('源码注释缺「' + g + '」');
  if (missing.length) bad(label + '（' + r.why + '）：\n       ' + missing.join('\n       '));
  else ok(label.padEnd(22) + ' 两边都写对了：' + r.good.join(' / '));

  // D. 错的写法不许裸奔（两边都查）
  const texts = [['源码注释', block]];
  if (research !== null) texts.push(['调研资料', research]);
  for (const [where, text] of texts) {
    for (const [wrong, caveat, win] of (r.forbidden || [])) {
      checkCaveat(label + '（' + where + '）', text, wrong, caveat, win);
    }
  }

  // E. 中文显示名
  const key = 'item.anglertackle.' + r.id;
  const shown = lang[key];
  if (shown === undefined) bad(label + '：语言文件里没有 ' + key);
  else if (r.display && shown !== r.display) {
    bad(label + '：游戏里显示的名字是「' + shown + '」，应当是「' + r.display + '」'
      + '（这是**唯一会显示给玩家**的那一处，图鉴里名字错了就是全错）');
  }
}

// ── F. 策划文档里那张表必须还是 7 行 ────────────────────────────────────────
if (!exists(DOC)) bad('缺 ' + DOC);
else {
  const doc = read(DOC).split(/\r?\n/);
  const head = doc.findIndex((l) => /^\s*\| # \|/.test(l) && l.includes('原来的写法'));
  if (head < 0) {
    bad(DOC + ' 里找不到"学名/中文名修正 7 条"那张表（表头 `| # | 鱼 | 原来的写法`）'
      + ' —— 表没了，第 5 项就成了空头承诺');
  } else {
    let rows = 0;
    for (let i = head + 2; i < doc.length && /^\s*\|/.test(doc[i]); i++) rows++;
    if (rows !== RULES.length) {
      bad('修正表有 ' + rows + ' 行，检查器里有 ' + RULES.length + ' 条规则 —— 两边必须是同一件事'
        + '（加鱼必须两边一起加，删规则必须说清为什么）');
    } else {
      ok('策划文档 §4 第 5 项的修正表 = ' + rows + ' 行，与检查器的 ' + RULES.length + ' 条规则一致');
    }
  }
}

console.log('');
if (fail === 0) {
  console.log('✅ 学名/中文名修正检查通过：' + RULES.length + ' 条两边一致、错的写法都带着说明留档、显示名正确');
  process.exitCode = 0;
} else {
  console.log('❌ 学名/中文名修正检查失败：' + fail + ' 项');
  process.exitCode = 1;
}
