// ============================================================================
//  check-version-matrix.js —— 核查 `tools/new-version.js` 里那张
//  "MC 版本 → NeoForge 版本"对照表**是不是真的**。
//
//  为什么必须有一个检查器（而不是让那张表就那么躺着）：
//    那张表决定了每个版本包体去拉哪个 NeoForge。**填错不报错** ——
//    Gradle 会去找一个不存在的版本号、或者在 beta/正式版之间悄悄换掉，
//    而症状只是"构建失败"或"装上去怪怪的"，看不出是表的锅。
//    本仓库的铁律是"每个改动都要配一条能证伪的断言"，这张表同理。
//
//  做法：拿本仓库**已经实测过的那条通路**去核对 ——
//    · 用 Java 抓 NeoForge 官方 maven-metadata（本机只有 Java 能出网，见 docs/43 §2）
//    · 用 Mojang 官方 version_manifest 确认"这个 MC 版本真的存在、且是正式版"
//    · 逐个比对 new-version.js 里的 neo 值：存在吗？是不是该线的最高正式版/最后 beta？
//
//  用法：
//    node tools/check-version-matrix.js          # 核查（需要能出网，约 5~15 秒）
//    node tools/check-version-matrix.js --cached # 只用本地缓存的清单，不联网
//
//  ⚠ 它**不需要** Java：抓取走 Node 的 fetch（OpenSSL），本机是通的
//    （PowerShell/curl 的 schannel 才是坏的）。抓下来的清单缓存在 build/ 下。
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'build', 'version-matrix');
const NF_URL = 'https://neoforged.forgecdn.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const MC_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const cachedOnly = process.argv.includes('--cached');

/** 从 new-version.js 里把那张表抠出来（避免复制一份、两处会漂移）。 */
function loadTable() {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'new-version.js'), 'utf8');
  const m = /const NEOFORGE = \{([\s\S]*?)\n\};/.exec(src);
  if (!m) { console.error('✗ 在 tools/new-version.js 里找不到 NEOFORGE 表'); process.exit(1); }
  const table = {};
  for (const line of m[1].split('\n')) {
    const e = /^\s*'([\d.]+)':\s*\{\s*neo:\s*'([^']+)'\s*,\s*stable:\s*(true|false)\s*\}/.exec(line);
    if (e) table[e[1]] = { neo: e[2], stable: e[3] === 'true' };
  }
  if (!Object.keys(table).length) { console.error('✗ NEOFORGE 表解析出来是空的'); process.exit(1); }
  return table;
}

async function fetchCached(url, file) {
  fs.mkdirSync(CACHE, { recursive: true });
  const p = path.join(CACHE, file);
  if (cachedOnly && fs.existsSync(p)) { console.log('  （--cached）用本地 ' + file); return fs.readFileSync(p, 'utf8'); }
  if (cachedOnly && !fs.existsSync(p)) { console.error('✗ --cached 但本地没有 ' + file); process.exit(1); }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const text = await res.text();
  fs.writeFileSync(p, text, 'utf8');
  return text;
}

function cmpVer(a, b) {
  const pa = a.split('-')[0].split('.').map(Number), pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

(async () => {
  const table = loadTable();
  console.log('=== 核查 "MC 版本 → NeoForge 版本" 对照表（' + Object.keys(table).length + ' 条）===');

  let nfXml, mcJson;
  try {
    nfXml = await fetchCached(NF_URL, 'neoforge-metadata.xml');
    mcJson = await fetchCached(MC_URL, 'mc-version-manifest.json');
  } catch (e) {
    console.error('✗ 抓取失败：' + e.message);
    console.error('  （本机只有 Node/Java 能出网；PowerShell/curl 的 TLS 是坏的，见 docs/43 §2）');
    process.exit(1);
  }

  const all = [...nfXml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
  const releases = new Set(JSON.parse(mcJson).versions.filter(v => v.type === 'release').map(v => v.id));

  // ⚠ 1.21.1 是**已验收的基线**，故意钉在固定的 NeoForge 版本上，不跟着官方升。
  //   所以它的判据不是"该线最高"，而是"**必须与主树 gradle.properties 里写的一致**" ——
  //   两者一旦分叉，说明有人偷偷换了主树依赖，那才是要报的错。
  //   （这条是检查器第一次跑就抓出来的：它报"1.21.1 该用 21.1.262"，
  //     而正确答案是"表要与主树一致 = 21.1.252"。判据写错方向就会变成假红。）
  const mainProps = fs.readFileSync(path.join(ROOT, 'gradle.properties'), 'utf8');
  const mainNeo = (/^\s*neo_version\s*=\s*(\S+)\s*$/m.exec(mainProps) || [, null])[1];
  console.log('  （主树 gradle.properties 的 neo_version = ' + mainNeo + '）');

  let bad = 0;
  const rows = Object.keys(table).sort((a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || (pa[2] || 0) - (pb[2] || 0);
  });

  for (const mc of rows) {
    const { neo, stable } = table[mc];
    const problems = [];

    // ① 这个 MC 版本真的是正式版吗
    if (!releases.has(mc)) problems.push('Mojang 清单里没有这个正式版');

    // ② 这个 NeoForge 版本真的存在吗
    if (!all.includes(neo)) {
      problems.push('NeoForge ' + neo + ' 在官方仓库里不存在');
    } else {
      // ③ stable 标记对不对
      const isBeta = neo.includes('-beta');
      if (stable === isBeta) problems.push('stable 标成 ' + stable + '，但版本号' + (isBeta ? '带 -beta' : '不带 -beta'));
      // ④ 是不是这一线的"该用的那一版"
      const branch = neo.split('.').slice(0, 2).join('.');
      if (mc === '1.21.1') {
        // 基线版：唯一判据是"与主树一致"
        if (mainNeo && neo !== mainNeo) {
          problems.push('这是基线版，必须与主树 gradle.properties 的 neo_version（' + mainNeo + '）一致');
        }
      } else {
        const line = all.filter(v => v.startsWith(branch + '.') && /^\d+\.\d+\.\d+(-beta)?$/.test(v));
        const stables = line.filter(v => !v.includes('-beta')).sort(cmpVer);
        const want = stables.length ? stables[stables.length - 1] : line.filter(v => v.includes('-beta')).sort(cmpVer).pop();
        if (want && want !== neo) problems.push('该线最高可用是 ' + want + '（表里写的是 ' + neo + '）');
      }
    }

    if (problems.length) {
      bad++;
      console.log('  ❌ ' + mc.padEnd(9) + ' NeoForge ' + neo.padEnd(14));
      for (const p of problems) console.log('       · ' + p);
    } else {
      console.log('  ✅ ' + mc.padEnd(9) + ' NeoForge ' + neo.padEnd(14) + (stable ? '' : '  （该线无正式版，用 beta ✓）'));
    }
  }

  if (bad) {
    console.log('\n❌ 版本对照表有 ' + bad + ' 条与现实不符 —— 改 tools/new-version.js 里的 NEOFORGE 表。');
    process.exit(1);
  }
  console.log('\n✅ 对照表 ' + rows.length + ' 条全部与现实一致（Mojang 清单 + NeoForge 官方仓库实测）。');
})();
