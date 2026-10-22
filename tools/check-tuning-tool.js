// 校验 调参器.html：
//   A. 静态：内嵌 JSON 合法、schema 完整、只读标记真的禁用了输入、两份页面同源
//   B. **真跑一遍**：把内联脚本放进 tools/browser-shim.js 造的 DOM 里执行，
//      然后断言搜索 / 同属性选择 / 批量乘 / 撤销 / 只读保护 的实际行为。
//
// 为什么非要执行：沙箱起不了 headless（Chromium 的命名管道被拒），所以这页
// 一直只能靠正则做静态检查。静态检查挡不住"id 拼错""变量在 TDZ 里被调用"
// "批量乘漏了只读过滤"这类问题 —— 而它们的表现是白屏或"点了没反应"，
// 正是玩家最容易被劝退的形态。真跑一遍成本很低（纯 JS，几百毫秒），
// 收益是把这一整类问题挡在发布之前。
const fs = require('fs'), path = require('path'), vm = require('vm');
// ⚠ 必须支持 ATL_ROOT：负向测试把副本目录指过来（negtest.ps1 设这个环境变量）。
//   2026-10-08 之前这里写死 `path.join(__dirname, '..')` ⇒ 在副本里跑的仍是**真实仓库**的
//   调参器.html ✗ —— 于是"负例"永远是绿的：
//   我给「还原已选为默认值」写的负例（把 after = f.def 改成 after = before）
//   在副本里压根没被读到，闸门报"期望退出码 1，实际 0" ✗。
//   这正是交接文档里那条"55 个检查器不支持 ATL_ROOT ⇒ 负例写不出来"的债。
//   ⚠ 注意 __dirname 是**检查器自己所在的目录**（副本里的 tools/），
//     所以副本内读 tools/tuning-schema.json 依然对得上 ✓。
const ROOT = process.env.ATL_ROOT ? path.resolve(process.env.ATL_ROOT) : path.join(__dirname, '..');

// 调参器应当建出多少行 —— **从生成的 schema 推导，不要写死数字**。
// 写死「446」的代价：每加一个配置项就要回来改 6 处，而且改漏了会以
// "建出 447 行，应为 446" 这种**看起来像功能坏了**的方式报出来。
// schema 是 gen-tuning-schema.js 从 Config.java 生成的，它就是权威项数。
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/tuning-schema.json'), 'utf8'));
const EXPECT_ITEMS = SCHEMA.groups.reduce((n, g) => n + ((g.fields || []).length), 0);
if (!EXPECT_ITEMS) throw new Error('tuning-schema.json 里数不出项数');

// 下面这一整组断言里的"项数"全部**从 schema 现算**，同样不写死：
//   一条鱼 = fishStats 组里的 13 项；鱼种条数 = 该组项数 / 13。
// 写死 21 的代价：加第 26 种鱼时要回来改 14 处，改漏了会以
// "选「拉力（不挣扎）」→ 选中 26 项（应 21）"这种**看起来像功能坏了**的方式报出来。
const FISH_STATS_FIELDS = ((SCHEMA.groups.find((g) => g.id === 'fishStats') || {}).fields || []).length;
if (!FISH_STATS_FIELDS || FISH_STATS_FIELDS % 13 !== 0) {
  throw new Error('fishStats 组项数 ' + FISH_STATS_FIELDS + ' 不是 13 的整数倍 —— 每组鱼应当是 13 项');
}
const FISH_N = FISH_STATS_FIELDS / 13;         // 鱼种条数（26）
// 重量上限 / 拉力 / 体力这些"每条鱼一项"的属性，命中的行数就是鱼种条数
const PER_FISH = FISH_N;
// "体重上限（kg）"与"体力上限"同选（追加）= 2 倍
const PER_FISH_X2 = FISH_N * 2;
// 英文键 pullSpeed 是**子串**匹配：xxxPullSpeed + xxxFatiguedPullSpeed
const PULLSPEED_HITS = FISH_N * 2;

// 配件侧的项数**也现算**，而且要和页面用**同一条口径** ——
// 调参器的 ATTR_KINDS 是按**中文标签**归类的（gen-part-config.js 给每个配件固定写
// 「… · 耐久上限」和「… · 品质档位」各一项）。所以这里也从 schema 的 label 后缀数。
//
// 2026-10-01 加了 3 个拟饵（蓝/紫/金各一个）：耐久上限 20→23、品质档位 13→16。
// 写死的话每加一个配件都要回来改这两处，漏改就报成"功能坏了"。
// ⚠️ 不能"把期望值调大"了事 —— 那等于把断言削短。这里改成按 schema 现算：
//    加配件自动跟上，**断言强度不变**（仍然是"索引里每一项都数对了"）。
const PART_LABELS = ((SCHEMA.groups.find((g) => g.id === 'partsStats') || {}).fields || [])
  .map((f) => f.label || '');
const countBySuffix = (suf) => PART_LABELS.filter((l) => l.endsWith(' · ' + suf)).length;
const PART_DURABILITY_N = countBySuffix('耐久上限');
const PART_TIER_N = countBySuffix('品质档位');
// 只读分组（partsStats）在调参器里是**整组的每一项**，所以项数 = 该组字段数。
const RO_PART_N = PART_LABELS.length;
if (!PART_DURABILITY_N || !PART_TIER_N) {
  throw new Error('从 partsStats 的标签里数不出配件项数（耐久 ' + PART_DURABILITY_N
    + ' / 档位 ' + PART_TIER_N + '）—— gen-part-config 的标签后缀改了？');
}
const html = fs.readFileSync(path.join(ROOT, '调参器.html'), 'utf8');
let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

// 0) 两份页面必须**逐字节相同**。
// 它们是同一个源生成的：中文名那份给工作区的 调参器.bat 菜单用，
// ASCII 名那份给发布包的 调参入口.bat 用。手工编辑过其中一份，
// 就会出现"开发时改的生效、发给玩家的没改"这种最恶心的偏差。
{
  const ascii = path.join(ROOT, 'tuner.html');
  if (!fs.existsSync(ascii)) no('缺少 tuner.html（发布包要用 ASCII 名）');
  else if (fs.readFileSync(ascii, 'utf8') !== html) {
    no('tuner.html 与 调参器.html 内容不一致 —— 跑 node tools/build-tuning-tool.js 重新生成');
  } else ok('调参器.html 与 tuner.html 内容一致（同源生成）');
}

// 1) JSON 段
let schema = null, meta = null;
const ms = /const SCHEMA = (\{[\s\S]*?\});\s*\nconst GROUP_META/.exec(html);
const mg = /const GROUP_META = (\{[\s\S]*?\});\s*\nconst \$/.exec(html);
if (!ms) no('找不到内嵌 SCHEMA');
else {
  try { schema = JSON.parse(ms[1]); ok('SCHEMA 是合法 JSON'); }
  catch (e) { no('SCHEMA 解析失败: ' + e.message); }
}
if (!mg) no('找不到内嵌 GROUP_META');
else {
  try { meta = JSON.parse(mg[1]); ok('GROUP_META 是合法 JSON'); }
  catch (e) { no('GROUP_META 解析失败: ' + e.message); }
}

// 2) 每个字段的完整性
if (schema) {
  let n = 0, incomplete = [];
  for (const g of schema.groups) {
    if (!meta || !meta[g.id]) incomplete.push('分组缺文案: ' + g.id);
    for (const f of g.fields) {
      n++;
      if (f.type === 'bool') continue;
      if (typeof f.def !== 'number' || typeof f.min !== 'number' || typeof f.max !== 'number')
        incomplete.push(g.id + '.' + f.key + ' 缺数值边界');
      else if (f.min > f.max) incomplete.push(g.id + '.' + f.key + ' min>max');
      else if (f.def < f.min || f.def > f.max) incomplete.push(g.id + '.' + f.key + ' 默认值越界');
    }
  }
  if (incomplete.length) incomplete.forEach(x => no(x));
  else ok('全部 ' + n + ' 个字段边界完整、默认值在范围内');

  // 2b) 配件数值那 79 项必须有中文标签。
  // 没标签的字段在界面上只剩 "hempTensionCeiling" 这种词，玩家对不上是哪个配件的
  // 哪个属性 —— 这正是加标签要解决的问题，所以必须守住。
  // 标签来自 Config.java 注释里的 "中文名（id） · 属性" 前缀（见 gen-part-config.js）。
  const ps = schema.groups.find((g) => g.id === 'partsStats');
  if (!ps) no('schema 里没有 partsStats 组');
  else {
    const noLabel = ps.fields.filter((f) => !f.label);
    if (noLabel.length) {
      no('partsStats 有 ' + noLabel.length + ' 项没有中文标签：' +
         noLabel.slice(0, 4).map((f) => f.key).join(', ') +
         '（检查 gen-part-config.js 生成的注释格式，' +
         '以及 gen-tuning-schema.js 的 labelFrom() 分隔符 " · "/" —— "）');
    } else ok('partsStats 全部 ' + ps.fields.length + ' 项都带中文标签');

    // 标签必须真的说明了是哪个配件 —— 只写"张力上限"而不带配件名的话，
    // 20 个配件会有一堆看起来一模一样的行，等于没标。
    const vague = ps.fields.filter((f) => f.label && !f.label.includes('（'));
    if (vague.length) no('有 ' + vague.length + ' 项的标签没带配件名（形如"麻线（hemp_line）"）');
    else ok('每个标签都带了配件名，20 个配件不会混淆');
  }

  // 2c) [partsStats] 必须标成**只读**。
  //
  // 这一组在运行期没人读（配件属性是注册期烘进 PART_STATS 组件的），
  // 做成可调会让玩家白花时间调一个永远不生效的东西。所以：
  //   · GROUP_META 里必须有 readonly: true
  //   · 模板里必须真的据此禁用输入（否则标记形同虚设）
  if (meta && meta.partsStats) {
    if (meta.partsStats.readonly === true) ok('[partsStats] 标记为只读（运行期不读这一组）');
    else no('[partsStats] 没有标 readonly —— 玩家会以为能调，白花时间');
  } else no('GROUP_META 里缺少 partsStats 条目');

  if (/meta\.readonly/.test(html) && /inp\.disabled = true/.test(html)) {
    ok('模板依据 readonly 真正禁用了输入控件');
  } else {
    no('模板没有按 readonly 禁用输入 —— 只读标记不会生效');
  }

  // [fishStats] 反过来**必须可调**（它是运行期读取的）
  if (meta && meta.fishStats && meta.fishStats.readonly) {
    no('[fishStats] 被标成只读，但它是运行期读取的、应该可调');
  } else ok('[fishStats] 可调（运行期读取，改完 /atl config reload 生效）');
}

// 3) script 语法
const body = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
try {
  // 用 Function 构造做纯语法检查，不执行
  new Function(body);
  ok('内联 JS 语法正确（' + Math.round(body.length / 1024) + 'KB）');
} catch (e) {
  no('内联 JS 语法错误: ' + e.message);
}

// 4) 关键功能痕迹
for (const [what, re] of [
  ['文件读写 API', /showOpenFilePicker/],
  ['TOML 解析', /function parseToml/],
  ['配置写回', /createWritable/],
  ['变更日志生成', /buildChangelog/],
  ['机器可读段', /## 机器可读/],
  ['搜索过滤', /function applySearch/],
  ['批量乘', /applymul/],
  ['同属性/同对象索引', /ATTR_KINDS|OBJ_KINDS/],
  ['撤销批量', /undobatch/],
]) {
  if (re.test(html)) ok('有' + what);
  else no('缺少' + what);
}

// 4b) 高亮必须走文本节点，不能拼 innerHTML。
// 配置说明里有 "范围 0.1~5"、"涨速（越小越安全）" 这类含 < > & 的文本，
// 一旦走 innerHTML 就会把内容吃掉半截（而且配置键里带下划线、被 < 截断后
// 完全看不出错，只是显示少了几个字）。
{
  const inner = [...html.matchAll(/\.innerHTML\s*=/g)].length;
  const onlySelinfo = /\.innerHTML\s*=/.test(html) &&
    [...html.matchAll(/(\S+)\s*\.innerHTML\s*=/g)].every((m) => m[1].includes('selinfo'));
  if (onlySelinfo) ok('只有选中计数用了 innerHTML，搜索高亮走文本节点（' + inner + ' 处）');
  else no('有 innerHTML 赋值用在选中计数之外 —— 高亮请用 createTextNode + <mark>');
}

// 5) 所有 $('#id') 引用的元素都必须真的在页面里
{
  const ids = new Set([...html.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  const head = html.slice(0, html.indexOf('<script>'));
  const declared = new Set([...head.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const missing = [...ids].filter((i) => !declared.has(i));
  if (missing.length) no('脚本引用了页面上不存在的 id: ' + missing.join(', ') + '（会直接白屏）');
  else ok('脚本引用的 ' + ids.size + ' 个 id 在页面上都存在');
}

// ------------------------------------------------------------------ 6) 真跑一遍
console.log('\n=== 在替身 DOM 里真执行一遍 ===');
// 脚本末尾追加一段"导出内部状态"的代码 —— 顶层 const/let 在 vm 里是词法作用域，
// 从外面读不到，只能让脚本自己暴露出来。用 getter 是因为 query / batchNotes /
// lastBatch 都是会被重新赋值的 let，直接传引用会拿到过期的那个。
const EXPORT = `
globalThis.__T = {
  get values(){return values}, get defaults(){return defaults}, get original(){return original},
  get inputEls(){return inputEls}, get order(){return order}, get selected(){return selected},
  get query(){return query}, get batchNotes(){return batchNotes}, get lastBatch(){return lastBatch},
  GROUP_OF: GROUP_OF, HAY: HAY, READONLY: READONLY,
  ATTR_KINDS: ATTR_KINDS, OBJ_KINDS: OBJ_KINDS,
  buildChangelog: buildChangelog, parseToml: parseToml, buildToml: buildToml,
  loadFrom: loadFrom, kindOf: kindOf, selectable: selectable, collectChanges: collectChanges,
};`;

const { makeDom } = require('./browser-shim.js');
const { document, window, globals } = makeDom(html);
const ctx = vm.createContext(globals);
try {
  vm.runInContext(body + '\n' + EXPORT, ctx, { filename: '调参器内联脚本' });
  ok('脚本在替身 DOM 里执行完毕，没有抛异常（build() 成功建出整页）');
} catch (e) {
  no('脚本执行失败: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
}

const T = ctx.__T;
if (!T) {
  no('脚本没有暴露出 __T（无法继续做行为断言）');
} else {
  const $ = (id) => document.querySelector('#' + id);
  const fieldOf = (k) => T.inputEls[k].field;
  /** 当前没被 hidden 的行数 */
  const visible = () => T.order.filter((k) => !T.inputEls[k].row.classList.contains('hidden'));
  /** 某一行的某个文本位置里是否有 <mark> */
  const marksIn = (k, which) => {
    const el = T.inputEls[k][which];
    return el ? el.children.filter((c) => c.tagName === 'MARK').map((c) => c.textContent) : [];
  };
  // 批量乘的预期值必须和页面用**同一条规则**：整数项乘完要取整。
  // 不这么写就会把"1 ×1.5 取整成 2"误判成 bug（mulletPullSpeed 就是这么冒出来的）。
  const expectMul = (k, def, min, max) => {
    let v = def * k;
    if (Number.isInteger(def)) v = Math.round(v);
    return Math.min(max, Math.max(min, v));
  };

  // 6a) 建出来的项数与只读分组
  if (T.order.length === EXPECT_ITEMS) ok('建出 ' + EXPECT_ITEMS + ' 行（与 tuning-schema.json 项数一致）');
  else no('建出 ' + T.order.length + ' 行，应为 ' + EXPECT_ITEMS);

  if (T.READONLY.size === 1 && T.READONLY.has('partsStats')) ok('只读分组识别正确（只有 partsStats）');
  else no('只读分组识别有误: ' + [...T.READONLY].join(','));

  const roRows = T.order.filter((k) => T.READONLY.has(T.GROUP_OF[k]));
  const roWithBox = roRows.filter((k) => T.inputEls[k].chk);
  // 只读分组的项数**现算** = 该组在 schema 里的字段数（也就是这一组有多少项配置）。
  // 写死 79 的代价和上面一样：加 3 个拟饵就变成 82，报成"只读分组有 N 项带勾选框"，
  // 而那句话完全指错了方向（真正变的只是项数）。这里保留原本要守的东西：
  //   ① 只读组里的项数 == schema 里这一组的项数（没有漏项也没多算）
  //   ② 只读组里一个勾选框都没有（这才是这条断言的核心）。
  if (roRows.length === RO_PART_N && roWithBox.length === 0) {
    ok('只读的 ' + RO_PART_N + ' 项都没有勾选框（不会被批量改到）');
  } else no('只读分组 ' + roRows.length + ' 项（应 ' + RO_PART_N + '）里有 '
    + roWithBox.length + ' 项带勾选框（应为 0）');

  if (T.values['crucianCarpPullSpeed'] === fieldOf('crucianCarpPullSpeed').def) {
    ok('打开文件前 values 已按默认值初始化（避免批量算出 NaN）');
  } else no('values 未初始化: ' + T.values['crucianCarpPullSpeed']);

  // 6b) 同属性 / 同对象索引
  const attr = T.ATTR_KINDS, obj = T.OBJ_KINDS;
  const expectAttr = { '拉力（不挣扎）': PER_FISH, '体力上限': PER_FISH, '体重上限（kg）': PER_FISH,
    '耐久上限': PART_DURABILITY_N, '品质档位': PART_TIER_N };
  const attrBad = [];
  for (const [k, n] of Object.entries(expectAttr)) {
    const got = attr.has(k) ? attr.get(k).length : -1;
    if (got !== n) attrBad.push(k + ' 应为 ' + n + ' 实为 ' + got);
  }
  if (attrBad.length) attrBad.forEach((x) => no('同属性索引: ' + x));
  else ok('同属性索引正确（共 ' + attr.size + ' 种；拉力/体力/体重上限各 ' + PER_FISH
    + '、耐久上限 ' + PART_DURABILITY_N + '、品质档位 ' + PART_TIER_N + '）');

  const gotObj = obj.has('鲫鱼（crucian_carp）') ? obj.get('鲫鱼（crucian_carp）') : [];
  // 同对象索引 = 配件（每个一个"对象"）+ 鱼（每条一个"对象"）。
  // 只断言"鱼这一半必须是 13 项"和"总数至少装得下所有鱼"，不去写死配件的个数 ——
  // 配件增删是另一条链上的事，不该让这个用例跟着一起红。
  const OBJ_N = obj.size;
  if (gotObj.length === 13 && OBJ_N >= FISH_N) ok('同对象索引正确（共 ' + OBJ_N + ' 种；一条鱼 = 13 项）');
  else no('同对象索引有误: 鲫鱼 ' + gotObj.length + ' 项（应 13）、共 ' + OBJ_N + ' 种（至少应有 ' + FISH_N + ' 条鱼）');

  // 6c) 搜索
  $('q').value = '拉力 不挣扎';
  $('q').fire('input');
  if (visible().length === PER_FISH && $('qcount').textContent === '匹配 ' + PER_FISH + ' / ' + EXPECT_ITEMS + ' 项') {
    ok('搜索「拉力 不挣扎」→ 只剩 ' + PER_FISH + ' 行，计数正确');
  } else no('搜索「拉力 不挣扎」→ 显示 ' + visible().length + ' 行（应 ' + PER_FISH + '）、计数「' + $('qcount').textContent + '」');

  // 高亮：命中的这些行里，"不挣扎" 这几个字必须被 <mark> 包起来。
  // 注意**不能**断言"带 mark 的行数 == N"：高亮是按词逐个标的，
  // 像「拉力（疲劳期）」「不挣扎时回气」这些行虽然整行不匹配（被藏起来），
  // 但它们的标签里确实含有"拉力"或"不挣扎"，标出来才是对的。
  const marked21 = visible().every((k) => marksIn(k, 'lblEl').includes('不挣扎'));
  if (visible().length === PER_FISH && marked21) ok(PER_FISH + ' 行命中项的标签里「不挣扎」被 <mark> 高亮');
  else no('高亮异常：' + PER_FISH + ' 行里有 ' + visible().filter((k) => !marksIn(k, 'lblEl').includes('不挣扎')).length +
    ' 行没被标出来');

  // 完全不沾边的行不能被留下高亮（上一次搜索的 mark 必须被清掉）
  const stray = ['ghostLineBeyondBlocks', 'chargeTimeSeconds']
    .filter((k) => marksIn(k, 'lblEl').length || marksIn(k, 'keyEl').length);
  if (stray.length === 0) ok('不相关行的高亮被清干净（不会留下上一次搜索的痕迹）');
  else no('这些行残留了高亮: ' + stray.join(', '));

  const emptied = schema.groups.filter((g) => T.inputEls[g.fields[0].key].sec.classList.contains('emptied'))
    .map((g) => g.id);
  if (emptied.length === schema.groups.length - 1 && !emptied.includes('fishStats')) {
    ok('搜不到东西的分组整体隐藏（' + emptied.length + ' 组），命中的 fishStats 保留');
  } else no('分组显隐不对，被隐藏的组: ' + emptied.join(', '));

  // 搜配置键也要能搜到（中文标签之外的第二条路）。
  // 这里特意用 'fatigued' 而不是 'pullSpeed'：后者是**子串**匹配，
  // xxxPullSpeed 和 xxxFatiguedPullSpeed 都会命中，那是正确行为、不是 bug，写进断言里当文档。
  $('q').value = 'pullSpeed';
  $('q').fire('input');
  if (visible().length === PULLSPEED_HITS) ok('搜 pullSpeed 命中 ' + PULLSPEED_HITS + ' 项（不挣扎 ' + FISH_N + ' + 疲劳期 ' + FISH_N + '，子串匹配的预期结果）');
  else no('搜 pullSpeed 命中 ' + visible().length + ' 项（应 ' + PULLSPEED_HITS + '）');
  // 用 'FatigueDurationSec' 而不是 'fatigued'：后者同样是子串匹配，
  // 会连 xxxFatiguedPullSpeed 一起命中（fatigued + uration 共享前缀），也是两倍。
  $('q').value = 'FatigueDurationSec';
  $('q').fire('input');
  if (visible().length === FISH_N) ok('搜英文配置键 FatigueDurationSec 精确落到「疲劳持续」那 ' + FISH_N + ' 项');
  else no('按配置键搜索失效：' + visible().length + ' 行（应 ' + FISH_N + '）');
  $('q').value = 'crucianCarpPullSpeed';
  $('q').fire('input');
  if (visible().length === 1 && visible()[0] === 'crucianCarpPullSpeed') {
    ok('搜完整配置键精确定位到唯一那一项');
  } else no('完整配置键没定位到唯一项：' + visible().length + ' 行');

  // 搜说明文字：有些词只出现在注释里（中文标签和配置键里都没有），
  // 玩家往往是照着游戏里的说明去搜的，注释不进索引就等于搜不到。
  $('q').value = '省性能';
  $('q').fire('input');
  if (visible().length >= 1) ok('搜只出现在说明里的词「省性能」也能命中（' + visible().length + ' 项）');
  else no('注释没进搜索索引：「省性能」一项都没搜到');

  $('qclear').click();
  if (visible().length === EXPECT_ITEMS && $('qcount').textContent === '共 ' + EXPECT_ITEMS + ' 项') ok('清空搜索后 ' + EXPECT_ITEMS + ' 行全部恢复');
  else no('清空搜索后显示 ' + visible().length + ' 行（应 ' + EXPECT_ITEMS + '）');

  // 6d) 「同属性」下拉 → 一键选择
  const sel = $('kindAttr');
  const optNames = () => sel.children.filter((c) => c.tagName === 'OPTION').map((o) => o.value);
  if (optNames().length === attr.size + 1 && optNames().includes('拉力（不挣扎）')) {
    ok('「同属性」下拉列出 ' + attr.size + ' 种（含占位项）');
  } else no('「同属性」下拉选项数 ' + optNames().length + '（应 ' + (attr.size + 1) + '）');
  if (sel.children[1] && /×\d+$/.test(sel.children[1].textContent)) {
    ok('下拉选项按命中项数从多到少排，并标出项数（' + sel.children[1].textContent + '）');
  } else no('下拉选项没有标项数: ' + (sel.children[1] || {}).textContent);

  sel.value = '拉力（不挣扎）';
  sel.fire('change');
  if (T.selected.size === PER_FISH) ok('选「拉力（不挣扎）」→ 一键选中 ' + PER_FISH + ' 项');
  else no('选「拉力（不挣扎）」→ 选中 ' + T.selected.size + ' 项（应 ' + PER_FISH + '）');
  if ($('applymul').textContent === '应用 ×1.5 到已选 ' + PER_FISH + ' 项' && $('applymul').disabled === false) {
    ok('按钮文案与可用状态跟着选择更新（' + $('applymul').textContent + '）');
  } else no('按钮没跟着更新：' + $('applymul').textContent + ' disabled=' + $('applymul').disabled);

  // ---- 界面必须"随时刷新"：这是上一版真正缺的东西 ----
  // 下拉选完必须回到占位项。否则再点同一个选项时值没变、change 不触发，
  // 表现就是"选了没反应，得先选别的再选回来"。
  if (sel.value === '' && $('kindObj').value === '') ok('选完两个下拉都自动回到占位项（同一个选项可以反复选）');
  else no('下拉选完没重置：kindAttr="' + sel.value + '" kindObj="' + $('kindObj').value + '"');
  sel.value = '拉力（不挣扎）';
  sel.fire('change');
  if (T.selected.size === PER_FISH) ok('同一个「同属性」选项连选两次都生效（第二次仍是 ' + PER_FISH + ' 项）');
  else no('第二次选同一项失效：' + T.selected.size + ' 项');

  // 已选清单：勾一下就重画一次，且能看出选的是哪几项
  //
  // ⚠ 清单**有显示上限**：模板里 `CAP = 40`，超出的折叠成一个"+N 更多"的 chip
  //   （`tools/tuning-tool.template.html` 第 489 行，那里是有意的 UI 行为）。
  //   所以这里不能写死"条数 == 选中数" —— 鱼种从 33 涨到 42 之后，
  //   "同属性：拉力"一次就选 42 项，老断言于是开始报"清单 40 条" ✗（2026-10-08 撞到）。
  //   正确判据 = `min(选中数, CAP)`，并且**折叠生效时必须有那个 more chip** ✓
  const CAP = 40;
  const shown = (n) => Math.min(n, CAP);
  const chips = () => $('sellist').children.filter((c) => c.className === 'chip');
  const moreChips = () => $('sellist').children.filter((c) => c.className === 'chip more');
  if (chips().length === shown(PER_FISH) && (PER_FISH <= CAP || moreChips().length === 1)
      && new RegExp('已选 ' + PER_FISH + ' 项').test($('selpaneltext').textContent)) {
    ok('「已选清单」实时列出 ' + shown(PER_FISH) + ' 条'
      + (PER_FISH > CAP ? '（其余折叠成「+N 更多」 ✓）' : '')
      + '（' + chips()[0].children[0].textContent + '…）');
  } else no('已选清单不对：' + chips().length + ' 条（应为 ' + shown(PER_FISH) + ' 条'
    + (PER_FISH > CAP ? ' + 1 个 more chip' : '') + '），文案「' + $('selpaneltext').textContent + '」');
  if (/同属性：拉力（不挣扎）/.test($('selhint').textContent)) {
    ok('粘性条上标出了选择来源（' + $('selhint').textContent + '）');
  } else no('没显示选择来源：' + $('selhint').textContent);

  // 手动勾一行 → 计数、按钮、清单、分组按钮都要立刻跟着变
  const oneKey = T.order.find((k) => !T.selected.has(k) && T.inputEls[k].chk);
  T.inputEls[oneKey].chk.checked = true;
  T.inputEls[oneKey].chk.fire('change');
  if (T.selected.size === PER_FISH + 1 && new RegExp('已选 <b>' + (PER_FISH + 1) + '</b> 项').test($('selinfo').innerHTML) &&
      chips().length === shown(PER_FISH + 1) && $('applymul').textContent === '应用 ×1.5 到已选 ' + (PER_FISH + 1) + ' 项') {
    ok('手动勾一行 → 计数/按钮/清单同一次刷新全部跟上（' + (PER_FISH + 1) + '）');
  } else no('手动勾选后界面不同步：计数 ' + T.selected.size + '、文案「' +
    $('applymul').textContent + '」、清单 ' + chips().length + ' 条');
  if (!T.inputEls[oneKey].row.classList.contains('sel')) no('勾选的行没有高亮');
  else ok('勾选的行立刻标上高亮（.sel）');
  T.inputEls[oneKey].chk.checked = false;
  T.inputEls[oneKey].chk.fire('change');
  if (T.selected.size === PER_FISH) ok('取消勾选同样立刻刷新');
  else no('取消勾选没刷新：' + T.selected.size);

  // 清单里每条能单独 × 掉
  chips()[0].children.find((c) => c.tagName === 'BUTTON').click();
  if (T.selected.size === PER_FISH - 1 && chips().length === shown(PER_FISH - 1)) {
    ok('清单里每条都能单独移除（点 × → ' + (PER_FISH - 1) + ' 项'
      + (PER_FISH - 1 > CAP ? '，清单仍按上限折叠' : '') + '）');
  } else no('清单移除失效：' + T.selected.size + ' 项 / ' + chips().length + ' 条（应为 '
    + shown(PER_FISH - 1) + ' 条）');

  // 倍数改了，按钮和清单文案要立刻跟着改
  $('factor').value = '2.5';
  $('factor').fire('input');
  if ($('applymul').textContent === '应用 ×2.5 到已选 ' + (PER_FISH - 1) + ' 项' && /应用 ×2.5/.test($('selpaneltext').textContent)) {
    ok('改倍数 → 按钮与清单文案立刻跟着变（×2.5）');
  } else no('改倍数没刷新文案：' + $('applymul').textContent + ' / ' + $('selpaneltext').textContent);
  $('factor').value = '1.5';
  $('factor').fire('input');

  // 已全选的那一类要在下拉里打 ✓
  $('append').checked = false;
  $('kindObj').value = '鲫鱼（crucian_carp）';
  $('kindObj').fire('change');
  if (T.selected.size === 13) ok('选「同对象：鲫鱼」→ 一次选中这条鱼的 13 项');
  else no('同对象选择有误：' + T.selected.size + ' 项（应 13）');
  const objSel = $('kindObj');
  const marked = objSel.children.filter((c) => c.tagName === 'OPTION' && /^✓/.test(c.textContent));
  if (marked.length === 1 && /鲫鱼/.test(marked[0].textContent)) {
    ok('已整类选中的选项在下拉里标了 ✓（' + marked[0].textContent + '）');
  } else no('下拉没标出已选中的类：' + marked.length + ' 个 ✓');

  // 分组标题的按钮必须是开关：全选 → 再点取消
  const g0 = schema.groups.find((g) => g.id === 'tension');
  const sec0 = T.inputEls[g0.fields[0].key].sec;
  const btn = (sec0.children[0].children || []).find((c) => c.tagName === 'BUTTON');
  if (!btn) no('分组标题里找不到「全选本组」按钮');
  else {
    btn.click();
    const wrong = [...T.selected].filter((k) => T.GROUP_OF[k] !== 'tension');
    if (T.selected.size === g0.fields.length && wrong.length === 0 && btn.textContent === '取消本组') {
      ok('点「全选本组」→ 只选中该组 ' + g0.fields.length + ' 项，按钮变成「取消本组」');
    } else no('「全选本组」不对：' + T.selected.size + ' 项 / 按钮「' + btn.textContent + '」');
    btn.click();
    if (T.selected.size === 0 && btn.textContent === '全选本组') {
      ok('再点一次整组取消，按钮变回「全选本组」');
    } else no('整组取消失效：' + T.selected.size + ' 项 / 按钮「' + btn.textContent + '」');
  }

  // 6e) 批量乘 + 撤销
  const KEY = 'crucianCarpPullSpeed';
  const before0 = T.values[KEY];
  sel.value = '拉力（不挣扎）';
  sel.fire('change');
  $('factor').value = '1.5';
  $('applymul').click();
  if (Math.abs(T.values[KEY] - before0 * 1.5) < 1e-9) {
    ok('×1.5 生效：' + KEY + ' ' + before0 + ' → ' + T.values[KEY]);
  } else no('×1.5 没生效：' + before0 + ' → ' + T.values[KEY]);

  const notScaled = attr.get('拉力（不挣扎）').filter((k) => {
    const f = fieldOf(k);
    return Math.abs(T.values[k] - expectMul(1.5, f.def, f.min, f.max)) > 1e-9;
  });
  if (notScaled.length === 0) ok(PER_FISH + ' 项全部乘上了（不是只改了第一项）');
  else no('有 ' + notScaled.length + ' 项没乘上：' + notScaled.slice(0, 5).join(', '));

  if (T.inputEls[KEY].row.classList.contains('changed')) ok('批量改过的行也标了「已改动」高亮');
  else no('批量改过的行没有高亮');

  const log = T.buildChangelog() || '';
  if (log.includes('批量操作') && log.includes('×1.5')) ok('变更日志里记下了这次批量（含倍数与项数）');
  else no('变更日志没记批量操作');
  if (log.includes('"__batchOps"')) ok('机器可读段带 __batchOps');
  else no('机器可读段缺 __batchOps');
  if (/^\| .+ \| .+ \| [\d.]+ \| \*\*[\d.]+\*\* \|/m.test(log)) {
    ok('变更日志的表格行格式正确（沿用原有格式）');
  } else no('变更日志表格行格式不对');

  $('undobatch').click();
  if (Math.abs(T.values[KEY] - before0) < 1e-9 && $('undobatch').disabled === true) {
    ok('「撤销上次批量」把 ' + KEY + ' 还原回 ' + before0 + '，按钮自动禁用');
  } else no('撤销失败：' + T.values[KEY] + '（应 ' + before0 + '）');
  const log2 = T.buildChangelog();
  if ((log2 || '').includes('批量操作')) no('撤销后日志仍记着已撤销的批量');
  else ok('撤销后变更日志里不再留这次批量（batchNotes 已一并撤回）');

  // 6e-2) 「还原已选为默认值」（用户 2026-10-08："可以在调参参加一个改回默认的功能"）
  //
  //   为什么不是"再乘 1/1.5"：那只能回到"乘之前"，回不到**默认值** ——
  //   而上一次会话可能已经把它调歪了。所以这条断言必须从"值 ≠ 默认"出发，
  //   再要求它逐项等于 fieldOf(k).def（不是"差不多"、也不是只改第一项）。
  if (!$('revertdef')) {
    no('页面上没有「还原已选为默认值」按钮');
  } else {
    // ① 没选任何东西时必须禁用（和「应用」按钮同一套状态）
    $('selnone').click();
    if ($('revertdef').disabled === true) ok('没选中时「还原已选为默认值」是禁用的');
    else no('没选中时「还原」按钮却是可点的');

    // ② 选一组 → 乘 ×1.5 推离默认 → 再还原
    sel.value = '拉力（不挣扎）';
    sel.fire('change');
    if ($('revertdef').disabled === false) ok('选中 ' + T.selected.size + ' 项后「还原」按钮变可点');
    else no('选中之后「还原」按钮仍然禁用');

    $('factor').value = '1.5';
    $('applymul').click();
    const keyR = 'crucianCarpPullSpeed';
    const pushed = T.values[keyR];
    if (Math.abs(pushed - fieldOf(keyR).def) > 1e-9) {
      ok('先把 ' + keyR + ' 乘到 ' + pushed + '（默认 ' + fieldOf(keyR).def + '）');
    } else no('乘完居然还是默认值，这条没法验证还原：' + pushed);

    $('revertdef').click();
    const notReverted = attr.get('拉力（不挣扎）').filter((k) => {
      const f = fieldOf(k);
      return Math.abs(T.values[k] - f.def) > 1e-9;
    });
    if (notReverted.length === 0) {
      ok(PER_FISH + ' 项全部还原到各自默认值（不是只改第一项，也不是按倍数反算）');
    } else no('有 ' + notReverted.length + ' 项没还原：' + notReverted.slice(0, 5).join(', '));

    // ⚠ 这里**不能**断言"变更日志里有『还原默认』"：全部还原之后，值就等于打开时的值，
    //   而 buildChangelog() 在"没有任何改动"时是**故意返回 null** 的（没改动就没什么要记录的）——
    //   所以那一刻日志本来就该是空的 ✗。真正要证明的是"这次还原被记进了 lastBatch
    //   与 batchNotes" —— 这两件事的可观测结果就是「撤销上次批量」被点亮。
    if ($('undobatch').disabled === false) {
      ok('还原被记进了「上一次批量」（所以能撤销；batchNotes 也同步记了一条）');
    } else no('还原之后「撤销上次批量」没被点亮 —— 说明它没记进 lastBatch');

    // ③ 还原也能撤销（与批量乘共用 lastBatch）
    $('undobatch').click();
    if (Math.abs(T.values[keyR] - pushed) < 1e-9 && $('undobatch').disabled === true) {
      ok('「撤销上次批量」把还原撤了回来：' + keyR + ' 回到 ' + T.values[keyR]);
    } else no('撤销还原失败：' + T.values[keyR] + '（应 ' + pushed + '）');

    // ④ 值本来就是默认时，点了要**说清没东西要还**，而不是静默无反应
    $('revertdef').click();                       // 此时已经是乘过 ×1.5 的状态
    $('revertdef').click();                       // 第一次还原 → 回到默认；第二次应当报"本来就是默认"
    const statusTxt = $('status').textContent || '';
    if (/本来就是默认值/.test(statusTxt)) ok('全部已是默认时点还原会明说「本来就是默认值」：' + statusTxt.slice(0, 40));
    else no('重复点还原没有给出「本来就是默认值」的提示：' + statusTxt.slice(0, 60));
  }

  // 6f) 上限夹取：既不能越界，也不能悄悄夹住不说。
  // 注意不能断言"全部顶到上限" —— 体重上限的默认值从 0.03 到 180 都有，
  // 最小的那几条 ×1000 之后（0.03→30）仍然在 500 以内，那是正常的。
  sel.value = '体重上限（kg）';
  sel.fire('change');
  const wKeys = attr.get('体重上限（kg）');
  // ⚠ "顶到上限"在工具里的定义是"**乘完严格超过**上限、于是被夹住"
  //   （template 第 648 行 `if (v > f.max) atMax++`）。
  //   所以必须先快照**动手前的值**再算 —— 用"改完之后 == max"当判据会多算一种情况：
  //   **本来就已经贴着上限**的项（它们没被夹、只是没动）→ 文案 31 / 实际 32 这种差 1
  //   （2026-10-08 鱼种涨到 42 时撞到）。
  const preVals = {};
  for (const k of wKeys) preVals[k] = T.values[k];
  $('factor').value = '1000';
  $('applymul').click();
  const over = wKeys.filter((k) => T.values[k] > fieldOf(k).max);
  const clamped = wKeys.filter((k) => preVals[k] * 1000 > fieldOf(k).max);
  const atMax = wKeys.filter((k) => T.values[k] === fieldOf(k).max);
  const st = $('status').textContent;
  if (over.length === 0 && clamped.length > 0) {
    ok('批量乘不会越界：' + clamped.length + '/' + wKeys.length + ' 项被夹到上限，其余留在范围内');
  } else no('越界 ' + over.length + ' 项 / 被夹 ' + clamped.length + ' 项');
  const nClaimed = (st.match(/(\d+) 项顶到上限/) || [])[1];
  if (nClaimed !== undefined && Number(nClaimed) === clamped.length) {
    ok('状态栏报出的夹取项数与实际一致（' + nClaimed + ' 项，' + st.slice(0, 34) + '…）');
  } else no('状态栏夹取计数与实际不符：文案「' + st + '」，实际被夹 ' + clamped.length
    + ' 项（贴合上限但没动的另有 ' + atMax.length + ' 项）');
  $('undobatch').click();
  if (wKeys.every((k) => T.values[k] === fieldOf(k).def)) ok('撤销把 ' + PER_FISH + ' 项体重上限全部还原');
  else no('撤销没还原干净');

  // 6g) 取整：整数项乘完必须是整数
  $('q').value = 'particlesPerBurst';
  $('q').fire('input');
  $('selmatch').click();
  $('factor').value = '1.35';
  $('applymul').click();
  const ppb = T.values['particlesPerBurst'];
  if (Number.isInteger(ppb) && ppb === Math.round(6 * 1.35)) ok('整数项乘完仍是整数（6 ×1.35 → ' + ppb + '）');
  else no('整数项被改成了小数：' + ppb);
  $('undobatch').click();
  $('qclear').click();

  // 6h) 只读分组绝不能被批量改到
  $('q').value = '耐久上限';
  $('q').fire('input');
  const roHit = visible().filter((k) => T.READONLY.has(T.GROUP_OF[k]));
  const okHit = visible().filter((k) => !T.READONLY.has(T.GROUP_OF[k]));
  $('selmatch').click();
  const roPicked = [...T.selected].filter((k) => T.READONLY.has(T.GROUP_OF[k]));
  if (roHit.length >= 20 && roPicked.length === 0 && T.selected.size === okHit.length) {
    ok('搜到 ' + roHit.length + ' 个只读项时「全选匹配项」一个都不选（是只读的 ' +
       roHit.length + ' / 可调的 ' + okHit.length + '）');
  } else no('只读项被选进了批量集合 ' + roPicked.length + ' 个（应 0）');

  $('factor').value = '2';
  const roBefore = T.values['hempDurability'];
  $('applymul').click();
  if (T.values['hempDurability'] === roBefore) ok('只读项数值纹丝不动（hempDurability 仍为 ' + roBefore + '）');
  else no('只读项被改动了：hempDurability ' + roBefore + ' → ' + T.values['hempDurability']);
  const secPS = T.inputEls['hempDurability'].sec;
  if (secPS.classList.contains('ro-group') && !(secPS.children[0].children || []).some((c) => c.tagName === 'BUTTON')) {
    ok('只读分组没有「全选本组」按钮');
  } else no('只读分组不该有「全选本组」按钮');
  $('qclear').click();

  // 6j) 「追加」勾上后是并入而不是替换
  sel.value = '体重上限（kg）';
  sel.fire('change');
  const base = T.selected.size;
  $('append').checked = true;
  $('append').fire('change');
  sel.value = '体力上限';
  sel.fire('change');
  if (base === PER_FISH && T.selected.size === base + PER_FISH) {
    ok('勾「追加」后是并入而不是替换（' + PER_FISH + ' + ' + PER_FISH + ' = ' + T.selected.size + '）');
  } else no('追加没生效：' + T.selected.size + ' 项（应 ' + (base + PER_FISH) + '）');
  $('append').checked = false;
  $('append').fire('change');
  $('selnone').click();
  if (T.selected.size === 0 && $('applymul').disabled === true) ok('「清空选择」生效并禁用应用按钮');
  else no('清空选择失效：' + T.selected.size + ' 项');

  // 6k) 还原默认必须能覆盖批量改过的值
  sel.value = '拉力（不挣扎）';
  sel.fire('change');
  $('factor').value = '3';
  $('applymul').click();
  $('reset').click();
  const notDefault = T.order.filter((k) => Math.abs(T.values[k] - fieldOf(k).def) > 1e-9);
  if (notDefault.length === 0) ok('「全部还原默认」把 ' + EXPECT_ITEMS + ' 项都恢复成默认值（覆盖批量改过的）');
  else no('还原默认后有 ' + notDefault.length + ' 项没回到默认：' + notDefault.slice(0, 5).join(', '));

  // 6l) 写回 TOML 的往返：批量改完 → 生成 TOML → 再解析回来，值必须一致。
  // 这一步是"改了到底会不会写进文件"的唯一证据；不测的话，序号/类型格式化
  // 出问题只会在玩家那边表现为"改了没生效"。
  sel.value = '体力上限';
  sel.fire('change');
  $('factor').value = '1.1';
  $('applymul').click();
  const text = T.buildToml();
  const parsed = T.parseToml(text);
  const roundTrip = attr.get('体力上限').filter((k) => {
    const raw = parsed.fishStats ? parsed.fishStats[k] : undefined;
    return raw === undefined || Math.abs(parseFloat(raw) - T.values[k]) > 1e-9;
  });
  if (roundTrip.length === 0) ok('批量改完写出的 TOML 能被解析回同样的值（' + PER_FISH + ' 项逐项核对）');
  else no('TOML 往返丢值/串值: ' + roundTrip.slice(0, 5).join(', '));
  if (/^\[gameplay\]$/m.test(text) && /^\[fishStats\]$/m.test(text)) ok('写回的 TOML 带全部分组头');
  else no('写回的 TOML 缺分组头');
}

console.log(bad === 0 ? '\n✅ 调参器校验通过（静态 + 无头执行）' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
