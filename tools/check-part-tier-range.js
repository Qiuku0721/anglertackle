const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 校验每个配件的品质档位都落在 1..6（白绿蓝紫金红）。
//
// 为什么值得单独一条：档位不是"随便一个数值"，它同时被三处当**下标/判据**用 ——
//   · Quality.of(stats.partTier() - 1)  → 决定名字颜色，越界就是乱色或崩
//   · FishingSession.baitMinTier()      → "紫饵过滤绿档以下"判的是 tier == 4
//   · Config 里档位项的 defineInRange 下限现在写的是 1
// 而且档位是 1 起不是 0 起（0 是"无档位"，只有渔轮/鱼钩那种不带档位的用），
// 光看 ModItems 里那句 "tier = 品质下限（0 白 1 绿 …）" 会以为是 0 起 ——
// 那句注释本身是错的，已改正。
//
// 用法：node tools/check-part-tier-range.js
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const { parseParts } = require('./part-source.js');

const TIER_CN = { 1: '白', 2: '绿', 3: '蓝', 4: '紫', 5: '金', 6: '红' };

const bakPath = path.join(ROOT, '参考资料/_before_partcfg/ModItems.java.bak');
const curPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
if (!fs.existsSync(curPath)) { console.error('❌ 找不到 ModItems.java：' + curPath); process.exit(1); }

let bad = 0, n = 0;
const seen = new Set();
// ⚠ 读**当前源码**，不读那份冻结备份。
//   备份的用处是"配置化之前长什么样"（check-part-wiring 拿它抓悄悄改数值），
//   而本检查器问的是"现在每个配件的档位合不合法" —— 用它当数据源会在**配件新增一个参数**时
//   悄悄错位：2026-10-05 给渔轮补档位（`PartStats.reel(..., tier)`）后，
//   KEYS.reel 变 5 项、备份里还是 4 项，于是 values[4] 恒为 undefined，
//   报出"档位越界：undefined"这种指向完全错误的失败。
for (const p of parseParts(fs.readFileSync(curPath, 'utf8'), { literals: true })) {
  const i = p.keys.indexOf('tier');
  if (i < 0) continue;
  n++;
  const t = p.values[i];
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > 6) {
    console.error('❌ ' + p.name + '（' + p.id + '）档位越界：' + t + '（要求 1..6 的整数）');
    bad++;
    continue;
  }
  seen.add(t);
}

// 六档必须**每档都有配件**，否则那一档的颜色永远出不来。
// 踩过：按"1绿…5红"填 → 整体差一档，镀金显示成金、红档永远不出现。
for (let t = 1; t <= 6; t++) {
  if (!seen.has(t)) { console.error('❌ 没有任何配件是 ' + t + ' 档（' + TIER_CN[t] + '）—— 该颜色永远出不来'); bad++; }
}

// 机械约束：baitMinTier() 判的是 tier == 4 走"紫饵过滤绿档以下"，
// 所以紫档必须是 4，错开这一档那条分支就永远走不到。
if (!seen.has(4)) { console.error('❌ 没有紫档(4)配件 —— baitMinTier 的过滤分支永远走不到'); bad++; }

console.log('核对 ' + n + ' 个带档位的配件，覆盖 ' + [...seen].sort().join('/') + ' 档');
if (bad) { console.error('\n档位问题 ' + bad + ' 处'); process.exit(1); }
console.log('✅ 档位全部落在 1..6 且六档齐全，与 Quality / baitMinTier 的口径一致');
