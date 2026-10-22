// 项目一致性自查：把"我以为对"的东西逐条数一遍。
//
// 为什么单独写一个：这一轮里我犯过几类错，全都是"声称做了但没真正核对"：
//   · 说"21 种鱼"却没数过每种鱼是不是都注册了贴图/模型/中文名/创造栏
//   · 说"35 项配置全接线"却没核对声明数与定义数是否相等
//   · 说"配置文件在 X"却没确认路径真的存在
// 这个脚本把这些断言变成可执行的检查。
const fs = require('fs'), path = require('path');
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const list = (p) => fs.readdirSync(path.join(ROOT, p));

let bad = 0;
const ok = (m) => console.log('  ✅ ' + m);
const no = (m) => { console.log('  ❌ ' + m); bad++; };
const head = (m) => console.log('\n' + m);

// ------------------------------------------------------------------ 鱼
head('一、鱼种一致性');
{
  const src = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
  const species = [...src.matchAll(/new FishSpecies\("([a-z_]+)"/g)].map(m => m[1]);
  const items = read('src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
  const registered = [...items.matchAll(/DeferredItem<FishItem> \w+ = fish\("([a-z_]+)"\)/g)].map(m => m[1]);

  console.log('     FishSpecies 定义 ' + species.length + ' 种；ModItems 注册 ' + registered.length + ' 种');

  const notRegistered = species.filter(s => !registered.includes(s));
  const notInSpecies = registered.filter(r => !species.includes(r));
  if (notRegistered.length) no('定义了但没注册物品: ' + notRegistered.join(', '));
  else ok('每种鱼都注册了物品');
  if (notInSpecies.length) no('注册了物品但没有鱼种数据: ' + notInSpecies.join(', '));
  else ok('每个鱼物品都有鱼种数据');

  const tex = list('src/main/resources/assets/anglertackle/textures/item').map(f => f.replace(/\.png$/, ''));
  const mdl = list('src/main/resources/assets/anglertackle/models/item').map(f => f.replace(/\.json$/, ''));
  const zh = JSON.parse(read('src/main/resources/assets/anglertackle/lang/zh_cn.json'));
  const en = JSON.parse(read('src/main/resources/assets/anglertackle/lang/en_us.json'));

  const missTex = registered.filter(r => !tex.includes(r));
  const missMdl = registered.filter(r => !mdl.includes(r));
  const missZh = registered.filter(r => !zh['item.anglertackle.' + r]);
  const missEn = registered.filter(r => !en['item.anglertackle.' + r]);
  missTex.length ? no('缺贴图: ' + missTex.join(', ')) : ok('贴图齐全');
  missMdl.length ? no('缺模型: ' + missMdl.join(', ')) : ok('模型齐全');
  missZh.length ? no('缺中文名: ' + missZh.join(', ')) : ok('中文名齐全');
  missEn.length ? no('缺英文名: ' + missEn.join(', ')) : ok('英文名齐全');

  // 创造栏：每个鱼物品都要有 output.accept
  const tabPart = items.slice(items.indexOf('CreativeModeTab'));
  const notInTab = registered.filter(r =>
    !new RegExp(r.toUpperCase().replace(/-/g, '_') + '\\.get\\(\\)').test(tabPart));
  notInTab.length ? no('没进创造栏: ' + notInTab.join(', ')) : ok('都在创造栏里');
}

// ------------------------------------------------------------------ 配置
head('二、配置项一致性');
{
  const cfg = read('src/main/java/com/whitecobalt/anglertackle/Config.java');
  const decl = [...cfg.matchAll(/public final ModConfigSpec\.\w+ (\w+);/g)].map(m => m[1]);
  const defNum = [...cfg.matchAll(/\.defineInRange\("([^"]+)"/g)].map(m => m[1]);
  const defBool = [...cfg.matchAll(/\.define\("([^"]+)"/g)].map(m => m[1]);
  const defs = [...defNum, ...defBool];

  console.log('     字段声明 ' + decl.length + '；defineInRange ' + defNum.length + '；define ' + defBool.length);
  if (decl.length !== defs.length) no('声明数与定义数不等（差 ' + (decl.length - defs.length) + '）—— 有字段没定义');
  else ok('每个字段都有对应的 define');

  // schema 必须和 Config 同步
  const schema = JSON.parse(read('tools/tuning-schema.json'));
  const schemaKeys = new Set();
  for (const g of schema.groups) for (const f of g.fields) schemaKeys.add(g.id + '.' + f.key);
  const missSchema = defs.filter(d => ![...schemaKeys].some(k => k.endsWith('.' + d)));
  missSchema.length ? no('schema 缺少: ' + missSchema.join(', ')) : ok('tuning-schema.json 与 Config 同步');
}

// ------------------------------------------------------------------ 文件
head('三、关键文件存在性');
{
  const must = [
    '调参器.html', '调参器.bat', '重置配置.bat',
    'tools/dev-menu.ps1', 'tools/reset-config.ps1',
    'tools/tuning-schema.json', 'tools/tuning-tool.template.html',
    'tools/build-deploy.ps1', 'tools/make-release.ps1',
    'src/main/resources/icon.png',
  ];
  for (const f of must) {
    if (fs.existsSync(path.join(ROOT, f))) ok(f);
    else no('缺少 ' + f);
  }
}

// ------------------------------------------------------------------ 参考图
head('四、参考图与贴图基线');
{
  const base = list('参考资料/鱼图/_baseline').filter(f => f.endsWith('.json'));
  const src = read('src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
  const species = [...src.matchAll(/new FishSpecies\("([a-z_]+)"/g)].map(m => m[1]);
  const missBase = species.filter(s => !base.includes(s + '.json'));
  console.log('     基线 ' + base.length + ' 个；鱼种 ' + species.length + ' 种');
  missBase.length ? no('缺基线: ' + missBase.join(', ')) : ok('每种鱼都有比例基线');
}

// ------------------------------------------------------------------ 编码
head('五、编码（中文不乱码）');
{
  const bom = [
    ['tools/dev-menu.ps1', true],
    ['tools/reset-config.ps1', true],
    ['tools/build-deploy.ps1', true],
    ['tools/make-release.ps1', true],
  ];
  for (const [f, needBom] of bom) {
    const b = fs.readFileSync(path.join(ROOT, f));
    const has = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    has === needBom ? ok(f + ' BOM 正确') : no(f + ' BOM 不对（应' + (needBom ? '有' : '无') + '）');
  }
  for (const f of ['调参器.bat', '重置配置.bat']) {
    const b = fs.readFileSync(path.join(ROOT, f));
    const nonAscii = [...b].filter(x => x > 127).length;
    nonAscii === 0 ? ok(f + ' 纯 ASCII') : no(f + ' 含 ' + nonAscii + ' 个非 ASCII 字节（cmd 会乱码）');
  }
}

// ------------------------------------------------------------------ 构建产物
head('六、构建产物');
{
  // ⚠ jar 名不许写死（2026-10-11）：这里原来写死成 1.1.5，于是从 1.5.x 起
  //   **永远找不到构建产物** —— 每次都在报"没有构建产物，先跑 build-deploy.ps1"，而产物一直在。
  //   版本只有一个来源：gradle.properties 的 mod_version。
  const modVersion = (/^\s*mod_version\s*=\s*(\d+\.\d+\.\d+)\s*$/m
    .exec(fs.readFileSync(path.join(ROOT, 'gradle.properties'), 'utf8')) || [])[1] || '';
  if (!modVersion) no('读不到 gradle.properties 的 mod_version —— 构建产物这条断言会失效');
  const jar = path.join(ROOT, 'build/libs/anglertackle-' + modVersion + '.jar');
  if (!fs.existsSync(jar)) no('没有构建产物，先跑 build-deploy.ps1');
  else {
    const st = fs.statSync(jar);
    ok('jar 存在 ' + Math.round(st.size / 1024) + 'KB  ' + st.mtime.toLocaleString('zh-CN'));
  }
  const rel = path.join(ROOT, '发布包');
  if (fs.existsSync(rel)) {
    const files = fs.readdirSync(rel);
    ok('发布包 ' + files.length + ' 个文件: ' + files.join(' / '));
  } else no('没有发布包');
}

console.log('');
console.log(bad === 0 ? '✅ 自查全部通过' : '❌ 自查发现 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
