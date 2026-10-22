// ============================================================================
//  verify-jar.js -- 交付前的 jar 自检
//
//  从"含中文的构建路径"打包出来的 jar，最容易在三个地方出问题：
//    1. neoforge.mods.toml 的元数据（版本范围写错 → NeoForge 直接拒绝加载）
//    2. 语言文件里的中文（编码错 → 游戏里显示问号/乱码）
//    3. 资源路径（贴图/模型丢失 → 紫黑格 + missing model）
//  这个脚本把三者都查一遍，并逐个校验"代码里引用的贴图"是否真的在包里。
//
//  用法: node tools/verify-jar.js [jar路径]
// ============================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

//  ⚠ 不传 jar 路径时的兜底曾写死成 'build/libs/anglertackle-1.0.1.jar'，
//    于是 1.1.0 起 build-deploy.ps1 的这一步每次都在校验 **两个月前那个旧 jar** ——
//    它当然反复报"19 张鱼贴图比例被改"（那是老图标），而真正的新 jar 一次都没被查过。
//    现在默认改成"选 build/libs 里最新的那个 jar"，路径写错也只会报"找不到 jar"
//    而不是静默去查另一个文件。
function defaultJar() {
  const dir = path.join(ROOT, 'build/libs');
  if (!fs.existsSync(dir)) return path.join(dir, 'anglertackle.jar');
  // ⚠ 1.4.0 起 build/libs 里**故意**有两个 jar（主 jar + 森罗扩展包 anglertackle-kaleidoscope-*），
  //   原来"取最新那个"的兜底会随机抓到扩展包，于是报"modId 期望 anglertackle 实际 anglertackle_kaleidoscope /
  //   version 期望 1.4.7 实际 1.0.0 / 缺少 zh_cn.json"这四条**全是假失败**（踩过）。
  //   主 jar 的名字只有一个来源：gradle.properties 的 mod_version。
  const props = fs.readFileSync(path.join(ROOT, 'gradle.properties'), 'utf8');
  const ver = (/^\s*mod_version\s*=\s*(\S+)\s*$/m.exec(props) || [])[1];
  const main = ver ? 'anglertackle-' + ver + '.jar' : null;
  if (main && fs.existsSync(path.join(dir, main))) return path.join(dir, main);
  const jars = fs.readdirSync(dir)
    .filter((f) => /^anglertackle-[\d.]+(-sources)?\.jar$/.test(f) && !f.includes('-sources'));
  if (!jars.length) return path.join(dir, 'anglertackle.jar');
  jars.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, jars[0]);
}
const JAR = process.argv[2] || defaultJar();

let fail = 0;
const ok = (m) => console.log('  [OK]   ' + m);
const bad = (m) => { console.log('  [FAIL] ' + m); fail++; };
const warn = (m) => console.log('  [WARN] ' + m);

if (!fs.existsSync(JAR)) {
  console.error('找不到 jar: ' + JAR);
  process.exit(2);
}

// ---------------------------------------------------------------- 读 zip
function readZip(file) {
  const buf = fs.readFileSync(file);
  const entries = new Map();
  // 找 End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/jar');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // 读 local header 求数据起点
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(dataOff, dataOff + compSize);
    entries.set(name, { method, raw });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(entry) {
  if (!entry) return null;
  return entry.method === 0 ? entry.raw : zlib.inflateRawSync(entry.raw);
}

console.log('检查 ' + path.basename(JAR) + '  (' + (fs.statSync(JAR).size / 1024).toFixed(1) + ' KB)\n');
const zip = readZip(JAR);

// ---------------------------------------------------------------- 1. 元数据
console.log('1) neoforge.mods.toml 元数据');
const tomlBuf = readEntry(zip.get('META-INF/neoforge.mods.toml'));
if (!tomlBuf) {
  bad('缺少 META-INF/neoforge.mods.toml —— NeoForge 会拒绝加载');
} else {
  const toml = tomlBuf.toString('utf8');
  const get = (k) => {
    const m = new RegExp('^\\s*' + k + '\\s*=\\s*"([^"]*)"', 'm').exec(toml);
    return m ? m[1] : null;
  };
  // ⚠ mod 版本号**不能**写死：它每次发版都变，写死的那一刻起这个检查就从
  //   "校验 jar 内嵌版本对不对"退化成 "校验它是不是某个历史版本" ——
  //   1.1.0 之后它就一直红着（同时把整个 jar 自检连带拖红）。
  //   真正的判据是"jar 里的 version 与 gradle.properties 的 mod_version 一致"。
  const propsPath = path.join(ROOT, 'gradle.properties');
  const modVersion = (() => {
    if (!fs.existsSync(propsPath)) return null;
    const m = /^\s*mod_version\s*=\s*(\S+)/m.exec(fs.readFileSync(propsPath, 'utf8'));
    return m ? m[1] : null;
  })();
  const checks = [
    ['modLoader', 'javafml'],
    ['modId', 'anglertackle'],
    ['version', modVersion],
    ['license', 'MIT'],
  ];
  for (const [k, want] of checks) {
    const got = get(k);
    if (want === null) { bad(k + '：读不到 gradle.properties 里的 mod_version，无法校验'); continue; }
    if (got === want) ok(k + ' = ' + got);
    else bad(k + ' 期望 "' + want + '"（gradle.properties 的 mod_version），实际 "' + got + '"');
  }

  // 依赖版本范围必须能容纳 1.21.1 / NeoForge 21.1.x
  const mcRange = /modId\s*=\s*"minecraft"[\s\S]*?versionRange\s*=\s*"([^"]+)"/.exec(toml);
  const nfRange = /modId\s*=\s*"neoforge"[\s\S]*?versionRange\s*=\s*"([^"]+)"/.exec(toml);
  if (mcRange && mcRange[1].includes('1.21.1')) ok('minecraft 版本范围 ' + mcRange[1] + ' 覆盖 1.21.1');
  else bad('minecraft 版本范围不含 1.21.1: ' + (mcRange ? mcRange[1] : '缺失'));
  if (nfRange && /21\.1\./.test(nfRange[1])) ok('neoforge 版本范围 ' + nfRange[1] + ' 覆盖 21.1.x');
  else bad('neoforge 版本范围不含 21.1.x: ' + (nfRange ? nfRange[1] : '缺失'));

  // 未替换的占位符会让 NeoForge 报 "Invalid version range"
  const placeholders = toml.match(/\$\{[a-z_.]+\}/g);
  if (placeholders) bad('存在未替换的占位符: ' + [...new Set(placeholders)].join(', '));
  else ok('无未替换的 ${...} 占位符');

  // logoFile 指向的图标必须真的在包里。
  // 这个坑踩过：mods.toml 声明了 logoFile = "icon.png"，但 src/main/resources 下
  // 根本没有这个文件 —— 游戏能正常加载，但模组列表里是个空图标位，
  // 发版给别人时第一眼就看出问题。静态资源检查查不到它（不是代码引用），
  // 所以必须在这里单独确认。
  const logo = /logoFile\s*=\s*"([^"]+)"/.exec(toml);
  if (!logo) {
    warn('mods.toml 没有声明 logoFile（模组列表里不会有图标）');
  } else if (!zip.has(logo[1])) {
    bad('logoFile 指向的图标不在包里: ' + logo[1]);
  } else {
    ok('logoFile 图标存在: ' + logo[1] + '（' + readEntry(zip.get(logo[1])).length + 'B）');
  }

  // 描述里不该再出现占位项目符号或待办标记
  if (/PLACEHOLDER|TODO|FIXME|XXX/i.test(toml)) {
    warn('mods.toml 里还有 PLACEHOLDER/TODO 之类的字样（发版前应清理）');
  }
}

// ---------------------------------------------------------------- 2. 中文编码
console.log('\n2) 中文编码（构建路径含中文，重点检查）');
const zhBuf = readEntry(zip.get('assets/anglertackle/lang/zh_cn.json'));
if (!zhBuf) {
  bad('缺少 zh_cn.json');
} else {
  const zh = zhBuf.toString('utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(zh);
    ok('zh_cn.json 是合法 JSON（' + Object.keys(parsed).length + ' 条）');
  } catch (e) {
    bad('zh_cn.json 解析失败: ' + e.message);
  }
  if (parsed) {
    const samples = ['item.anglertackle.wood_float_rod', 'message.anglertackle.line_snapped'];
    for (const k of samples) {
      const v = parsed[k];
      if (typeof v === 'string' && /[\u4e00-\u9fff]/.test(v)) ok(k + ' = "' + v + '"');
      else bad(k + ' 中文丢失或乱码: ' + JSON.stringify(v));
    }
    if (/[\uFFFD]/.test(zh)) bad('检测到替换字符 U+FFFD —— 编码已损坏');
    else ok('无 U+FFFD 替换字符');
  }
}
const enBuf = readEntry(zip.get('assets/anglertackle/lang/en_us.json'));
if (enBuf && (() => { try { JSON.parse(enBuf.toString('utf8')); return true; } catch { return false; } })()) {
  ok('en_us.json 是合法 JSON');
} else {
  bad('en_us.json 缺失或非法');
}

// ---------------------------------------------------------------- 3. 资源完整性
console.log('\n3) 资源完整性（贴图 / 模型）');
const pngs = [...zip.keys()].filter((k) => k.endsWith('.png'));
const models = [...zip.keys()].filter((k) => k.startsWith('assets/anglertackle/models/') && k.endsWith('.json'));
ok('贴图 ' + pngs.length + ' 张，模型 ' + models.length + ' 个');

// PNG 必须完整（截断的 PNG 会让游戏报 "Unable to load texture"）
for (const p of pngs) {
  const data = readEntry(zip.get(p));
  const isPng = data.length > 8 && data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG';
  const iend = data.length >= 12 && data.toString('ascii', data.length - 8, data.length - 4) === 'IEND';
  if (!isPng || !iend) bad(p + ' 不是完整 PNG');
}
if (pngs.length > 0) ok('全部 PNG 头尾完整（含 IEND 块）');

// 鱼贴图比例锁。走过的弯路：
//   为了让"白肚被当背景删掉"的镂空消失，给抠图加了 --seal（膨胀封口），
//   结果把鳍与鳍之间的空隙也补上，包围盒上下变高，鱼在 GUI 里被**上下拉高 11~19%**。
// 所以这里不再检查"有没有留白"（老贴图 64×64 带留白是原始形态，不能动），
// 改为检查**前景宽高比**有没有被改。基线在 参考资料/鱼图/_baseline/。
{
  const { decodePng } = require('./image-to-sprite.js');
  const BASE = path.join(ROOT, '参考资料/鱼图/_baseline');
  const fishKeys = [...zip.keys()].filter((p) =>
    p.startsWith('assets/anglertackle/textures/item/') && p.endsWith('.png'));
  const bad = [], missing = [];
  for (const p of fishKeys) {
    const id = path.basename(p, '.png');
    const basePath = path.join(BASE, id + '.json');
    if (!fs.existsSync(basePath)) continue;
    let img;
    try { img = decodePng(readEntry(zip.get(p))); }
    catch (e) { bad.push(id + ' 解码失败'); continue; }
    let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (y < y0) y0 = y;
        if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { bad.push(id + ' 全透明'); continue; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    const drift = Math.abs((w / h) / base.ar - 1);
    if (drift > 0.03) {
      bad.push(id + ' 比例被改 ' + (w / h).toFixed(3) + '（基线 ' + base.ar.toFixed(3)
        + '，偏差 ' + (drift * 100).toFixed(1) + '%）');
    }
    if (w !== base.w || h !== base.h) missing.push(id + ' 尺寸 ' + w + 'x' + h + '（基线 ' + base.w + 'x' + base.h + '）');
  }
  if (bad.length) bad.length && console.log('');
  if (bad.length) { for (const m of bad) console.log('  [FAIL] 鱼贴图 ' + m); fail += bad.length; }
  else ok('鱼贴图比例与基线一致（' + fishKeys.length + ' 张，容差 ±3%）');
  for (const m of missing) warn('鱼贴图尺寸变化: ' + m);
}

// 模型 JSON 合法性
const vanillaTex = [];
for (const m of models) {
  try {
    const j = JSON.parse(readEntry(zip.get(m)).toString('utf8'));
    const tex = j.textures ? Object.values(j.textures) : [];
    for (const t of tex) {
      if (typeof t !== 'string' || !t.startsWith('anglertackle:')) continue;
      const ref = 'assets/anglertackle/textures/' + t.slice('anglertackle:'.length) + '.png';
      if (!zip.has(ref)) bad(m + ' 引用了不存在的贴图 ' + ref);
    }
    // 物品模型必须引用存在的贴图。
    //
    // ⚠ 但 `minecraft:` 命名空间的是**原版贴图引用**，不该在这个 jar 里找 ——
    //   比如追踪罗盘的 layer0 故意用 minecraft:item/compass（等美术出图再换）。
    //   引用资源路径没有再分发任何 Mojang 素材，是完全合规的做法（docs/12）。
    //   第一版没排除这种情况，于是把正确的模型判成"贴图缺失"、直接挡住了部署。
    //   要单独列出来，因为它在路线图 M7「全部贴图非占位」里仍算未完成。
    // ⚠⚠ 2026-10-16：这里必须**先确认 j.textures 存在**。
    //   竿的「握着」父级模板（rod_grip / rod_grip_cast）也是 `parent: minecraft:item/generated`，
    //   但它**故意不写 textures**（贴图由 15 个子模型给）。
    //   少了这个保护，`j.textures.layer0` 会抛 TypeError，而报错长这样：
    //       [FAIL] models/item/rod_grip.json JSON 非法: Cannot read properties of undefined (reading 'layer0')
    //   ——**完全指错方向**：那份 JSON 一个字节都没问题，真正的毛病是检查器读它时假设了 leaf 模型。
    //   反过来也一样坏：父级模板本来就不该被要求带 layer0。
    if (j.parent === 'minecraft:item/generated' && j.textures
      && typeof j.textures.layer0 === 'string') {
      const l0 = j.textures.layer0;
      if (l0.startsWith('minecraft:')) {
        vanillaTex.push(m + ' → ' + l0);
      } else if (!zip.has('assets/anglertackle/textures/' + l0.slice('anglertackle:'.length) + '.png')) {
        bad(m + ' 的 layer0 贴图缺失: ' + l0);
      }
    }
  } catch (e) {
    bad(m + ' JSON 非法: ' + e.message);
  }
}
ok('模型引用的贴图全部存在');
if (vanillaTex.length) {
  warn('以下模型引用的是**原版**贴图（合规，但算占位未完成，M7 要换掉）：');
  for (const v of vanillaTex) warn('  ' + v);
}

// ---------------------------------------------------------------- 4. 代码里的资源引用
console.log('\n4) 代码引用的资源是否都在包里');
const javaFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.java')) javaFiles.push(p);
  }
})(path.join(ROOT, 'src/main/java'));

const refs = new Set();
for (const f of javaFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/ResourceLocation\.fromNamespaceAndPath\(\s*AnglersTackle\.MOD_ID\s*,\s*"([^"]+)"/g)) {
    refs.add(m[1]);
  }
  for (const m of src.matchAll(/"textures\/([a-z0-9_\/]+\.png)"/g)) {
    refs.add('textures/' + m[1]);
  }
}
let refFail = 0;
for (const r of refs) {
  const candidates = r.endsWith('.png')
    ? ['assets/anglertackle/' + r]
    : ['assets/anglertackle/' + r + '.png', 'assets/anglertackle/' + r + '.json'];
  if (!candidates.some((c) => zip.has(c))) {
    warn('代码引用了 ' + r + '，但包里没有（模型层/贴图路径需人工确认）');
    refFail++;
  }
}
if (refFail === 0) ok('代码里的 ' + refs.size + ' 个资源引用全部命中');

// ---------------------------------------------------------------- 5. 客户端/服务端分离
console.log('\n5) 其他加载期风险');
const cls = [...zip.keys()].filter((k) => k.endsWith('.class'));
ok('class 文件 ' + cls.length + ' 个');
if (zip.has('LICENSE-anglertackle') && zip.has('CREDITS-anglertackle.txt')) ok('LICENSE 与 CREDITS 已打进 jar');
else warn('LICENSE/CREDITS 未进 jar（上架时需要）');
const sizes = [...zip.entries()].map(([k, v]) => [k, readEntry(v).length]);
const empty = sizes.filter(([k, n]) => n === 0 && !k.endsWith('/'));
if (empty.length) bad('存在空文件: ' + empty.map(([k]) => k).join(', '));
else ok('无空文件');

console.log('\n' + (fail === 0
  ? '=== 自检通过：这个 jar 可以安全导入 PCL2 ==='
  : '=== 自检发现 ' + fail + ' 个问题，导入前必须修复 ==='));
process.exit(fail === 0 ? 0 : 1);
