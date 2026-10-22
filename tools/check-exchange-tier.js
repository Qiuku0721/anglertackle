/*
 * 商店的**品质档位**口径必须处处一致。
 *
 * 为什么单独立这个检查（2026-10-01 真实事故）：
 *   用户："红品质线貌似无法兑换，即使背包里有两条红鱼。我不确定所有兑换相关是不是都这个bug"。
 *   根因：**商店档位号是 1 起的（档 2 = 绿），品质号是 0 起的（绿 = 1）**，两者被混用了。
 *     · 兑换门槛写成字面量 6（照"1=白…6=红"），而品质只有 0~5 → `tier >= 6` 永不成立；
 *     · 等级评定的 RATINGS 里写 2/3/4/5（照"2=绿"），实际含义是 蓝/紫/金/红，
 *       于是每个评定都比自己的文案**严一档**：文案说"绿品质以上"，实际卡的是蓝。
 *   两处都是"数字合法、编译通过、读起来也对"，只有把数字和枚举/文案对起来量一次才露馅。
 *
 * 判据（全部对着源码量，不重算业务逻辑）：
 *   A. Quality 枚举 → 各档的真实序号。
 *   B. ShopManager 的档位门槛必须由 Quality.X.ordinal() 推导，不许出现字面量。
 *   C. 所有匹配调用（consumeAny / countOf / takeOne）的档位实参只能是 0 或那些常量。
 *   D. RATINGS 每条必须用常量，且**它后面注释里的品质字必须和常量对得上**。
 *   E. 客户端 ShopScreen.requirementText 的文案品质字，必须和 RATINGS 那条一致
 *      （这两处是"同一份规则的两种写法"，只比对文案本身是不够的 —— 正是这么漏掉的）。
 */
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./java-source.js');

// ATL_ROOT 供 tools/negtest.ps1 指向临时副本；不给就是仓库根目录 ✓
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.resolve(__dirname, '..');
const J = (p) => path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle', p);
const QUALITY = J('item/Quality.java');
const SHOP = J('shop/ShopManager.java');
const SCREEN = J('client/screen/ShopScreen.java');

let bad = 0;
const fail = (m) => { console.error('❌ ' + m); bad++; };
const ZH = { 白: 'WHITE', 绿: 'GREEN', 蓝: 'BLUE', 紫: 'PURPLE', 金: 'GOLD', 红: 'RED' };

// ---------------------------------------------------------------- A. Quality 枚举
const qSrc = stripComments(fs.readFileSync(QUALITY, 'utf8'));
const enumBody = /enum\s+Quality\s*\{([\s\S]*?)\n\}/.exec(qSrc);
if (!enumBody) { console.error('❌ 解析不到 Quality 枚举'); process.exit(1); }
const names = [...enumBody[1].matchAll(/^\s{4}([A-Z_]+)\s*\(/gm)].map((m) => m[1]);
if (names.length < 2) { console.error('❌ Quality 里没解析到常量'); process.exit(1); }
const ordinalOf = (n) => names.indexOf(n);
console.log(`Quality 共 ${names.length} 档：${names.map((n, i) => `${i}=${n}`).join(' ')}`);
if (ordinalOf('RED') !== names.length - 1) {
  fail(`RED 不是最后一档（RED=${ordinalOf('RED')}，共 ${names.length} 档）—— 下面所有推断都会偏`);
}

// ---------------------------------------------------------------- B. 档位常量
const sSrc = stripComments(fs.readFileSync(SHOP, 'utf8'));
// 注释被剥掉了，所以 D 要另读原文
const sRaw = fs.readFileSync(SHOP, 'utf8');
const tierConst = new Map();   // 常量名 → Quality 名
for (const m of sSrc.matchAll(/static\s+final\s+int\s+(TIER_[A-Z]+)\s*=\s*[^;]*?Quality\.([A-Z_]+)\.ordinal\(\)/g)) {
  tierConst.set(m[1], m[2]);
}
if (tierConst.size === 0) {
  fail('ShopManager 里没有任何 "TIER_x = Quality.X.ordinal()" 常量 —— 门槛又是写死的字面量');
} else {
  const need = ['GREEN', 'BLUE', 'PURPLE', 'GOLD', 'RED'].filter((q) => ![...tierConst.values()].includes(q));
  if (need.length) { fail(`缺档位常量：${need.join(' / ')}（少一个就会又有人在那边写字面量）`); }
  else { console.log(`档位常量 ${tierConst.size} 个：${[...tierConst].map(([k, v]) => `${k}=${v}`).join(' ')}`); }
}

// ---------------------------------------------------------------- C. 匹配调用的档位实参
/** name( 之后按顶层逗号切实参。 */
function argsOf(src, openIdx) {
  let depth = 0, end = -1;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const inner = src.slice(openIdx + 1, end);
  const args = []; let d = 0, cur = '';
  for (const ch of inner) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) { args.push(cur.trim()); cur = ''; } else { cur += ch; }
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}
let calls = 0;
for (const m of sSrc.matchAll(/\b(consumeAny|countOf|takeOne)\s*\(/g)) {
  const args = argsOf(sSrc, m.index + m[0].length - 1);
  if (!args || args.length < 3) { fail(`${m[1]}() 实参解析不出来`); continue; }
  const a = args[2];
  if (a === 'int minTier' || a === 'minTier') { continue; }        // 方法声明 / 形参转发
  if (/\.minTier\(\)$/.test(a)) { continue; }                      // 评定那条链：值来自 RATINGS，由 D 守
  calls++;
  if (!/^(0|TIER_[A-Z]+|\(?\s*red\s*\?\s*TIER_[A-Z]+\s*:\s*0\s*\)?)$/.test(a)) {
    fail(`${m[1]}() 的档位实参是 "${a}" —— 只允许 0 或 TIER_x（写字面量就等着和枚举脱钩）`);
  }
}
if (calls === 0) { fail('一处匹配调用都没检查到 —— 解析口径可能失效'); }
else if (bad === 0) { console.log(`匹配调用的档位实参 ${calls} 处：全部是 0 / TIER_x ✅`); }

// ---------------------------------------------------------------- D. 评定表的品质常量
//
// 2026-10-02：等级改成 1–50 + 每 10 级一次突破之后，评定表搬到了
// player/AnglerLeveling.java 的 GATES（按**等级**索引，一级可以要好几条鱼）。
// 这条断言守的仍然是当年那个坑：**品质档位只能用 Quality 导出的常量，不许写字面量**
// （写 2 以为是"绿"，实际是"蓝"，于是"文案说绿品质、交了绿的却不给过"）。
const LEVEL = J('player/AnglerLeveling.java');
const lSrc = stripComments(fs.readFileSync(LEVEL, 'utf8'));
const lConst = new Map();   // GREEN → Quality 名
for (const m of lSrc.matchAll(/static\s+final\s+int\s+([A-Z]+)\s*=\s*[^;]*?Quality\.([A-Z_]+)\.ordinal\(\)/g)) {
  lConst.set(m[1], m[2]);
}
const gateMap = new Map();   // 等级 → [{fish, quality}]
{
  const block = /GATES = Map\.of\(([\s\S]*?)\)\);/.exec(lSrc);
  if (!block) {
    fail('AnglerLeveling 里找不到 GATES 表 —— 解析口径失效了，需要跟着改');
  } else {
    // 按 "10, List.of(" 切段
    const parts = block[1].split(/(\d+)\s*,\s*List\.of\(/).slice(1);
    for (let i = 0; i < parts.length; i += 2) {
      const level = Number(parts[i]);
      const chunk = parts[i + 1] || '';
      const rows = [];
      for (const m of chunk.matchAll(/new Requirement\(\s*"([a-z_]+)"\s*,\s*([A-Za-z_0-9]+)\s*,\s*(\d+)\s*\)/g)) {
        const q = lConst.get(m[2]);
        if (q === undefined) {
          fail(`GATES 第 ${level} 级评定的品质写成了 "${m[2]}" —— 必须是 Quality 导出的常量，` +
               `不许字面量（写 2 以为是绿、实际是蓝，就是这个坑）`);
          continue;
        }
        rows.push({ fish: m[1], quality: q, count: Number(m[3]) });
      }
      if (rows.length === 0) { fail(`GATES 第 ${level} 级一条材料都没解析到`); }
      gateMap.set(level, rows);
    }
    if (gateMap.size === 0) { fail('GATES 里一条都没解析到'); }
    else {
      console.log('评定点与品质常量：' + [...gateMap].map(([lv, rows]) =>
        `Lv.${lv}=${rows.map((r) => r.quality).join('+')}`).join(' '));
    }
    // 评定点必须是 10/20/30/40（用户口径："每 10 级"）
    const want = [10, 20, 30, 40];
    const got = [...gateMap.keys()].sort((a, b) => a - b);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`评定点是 ${got.join('/')}，应为 ${want.join('/')}（用户："每 10 级解锁一次评定"）`);
    }
    // 每个评定点的等级键必须是 10 的倍数
    for (const lv of got) {
      if (lv % 10 !== 0) { fail(`评定点 ${lv} 不是 10 的倍数`); }
    }
  }
}

// ---------------------------------------------------------------- E. 界面必须**委托**给那张表
//
// 早先客户端自己写了一份 switch（"case 2 -> 绿品质以上梭鲈 ×1"），
// 和 ShopManager.RATINGS 是同一份规则的两处写法 —— 只比对文案本身是不够的，
// 因为"两处一起错"照样一致。现在要求**结构上只有一份**：
// requirementText 必须调 AnglerLeveling.describe(...)，且不许再出现手写的品质文案。
const scSrc = stripComments(fs.readFileSync(SCREEN, 'utf8'));
{
  const fn = /static\s+String\s+requirementText\s*\(([\s\S]*?)\n    \}/.exec(scSrc);
  if (!fn) {
    fail('ShopScreen 里找不到 requirementText —— 界面文案的来源不明');
  } else {
    if (/AnglerLeveling\.describe\s*\(/.test(fn[1])) {
      console.log('界面文案委托给共享表 AnglerLeveling.describe(…) ✅');
    } else {
      fail('ShopScreen.requirementText 没有调用 AnglerLeveling.describe(…) —— ' +
           '界面又在自己抄一份要求表，改一处忘一处的老问题会回来');
    }
    if (/(白|绿|蓝|紫|金|红)品质/.test(fn[1])) {
      fail('ShopScreen.requirementText 里又出现了手写的"X品质"文案 —— 只该来自共享表');
    }
  }
}

console.log(bad === 0
  ? '\n✅ 商店品质档位口径一致（枚举 / 常量 / 匹配 / 评定表 / 界面委托）'
  : `\n商店品质档位检查：${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
