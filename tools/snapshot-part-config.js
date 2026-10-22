// 把当前 Config.java 里配件数值那一段抽成快照 JSON。
// 用途：ModItems.java 被改写成 Tuning 调用之后，生成器读不到字面量了，
// 但仍需要能重建配件块（例如 Config.java 被剥净、需要重新拼装时）。
// 快照里存的就是"每个配件的每个属性：默认值 + 中文说明"，与源码字面量等价。
//
// 用法：node tools/snapshot-part-config.js [--check]
//   --check：只校验现有快照与 Config.java 一致，不写文件（供 CI/自检调用）
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');

const cfgPath = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java');
const snapPath = path.join(__dirname, 'part-config-snapshot.json');

const cfg = fs.readFileSync(cfgPath, 'utf8');
const i0 = cfg.indexOf('// ==== BEGIN 配件数值定义 ====');
const i1 = cfg.indexOf('// ==== END 配件数值定义 ====');
if (i0 < 0 || i1 < 0) {
  if (CHECK) { console.log('（Config.java 里没有配件数值段，跳过快照校验）'); process.exit(0); }
  console.error('❌ Config.java 里找不到配件数值定义段');
  process.exit(1);
}
const block = cfg.slice(i0, i1);

// 每个字段：`名字 = b .comment("...") .defineInRange("键", 默认值, 最小, 最大);`
const fields = [];
const re = /(\w+)\s*=\s*b([^;]*);/g;
let m;
while ((m = re.exec(block))) {
  const name = m[1];
  // 剥掉 Java 数值后缀（0.0D / 2f / 3L）—— 不剥的话数值正则会停在 "0."，
  // 于是 79 项里只认得出 33 项（踩过）。
  const chain = m[2].replace(/(\d)[DdFfLl](?![0-9A-Za-z_])/g, '$1');
  const d = /\.defineInRange\("(\w+)",\s*([-+*/(). 0-9]+?)\s*,\s*([-+*/(). 0-9]+?)\s*,\s*([-+*/(). 0-9]+?)\)/.exec(chain);
  if (!d) continue;
  const c = /\.comment\("([^"]*)"\)/.exec(chain);
  // 类型看**接口调用**而不是字段声明：直接用 chain 里有没有 IntValue
  //（早先拿声明行去 indexOf，命中不到时 slice(-1, 199) 这种参数会静默给错结果，
  //  于是 79 项里只认出 33 项。）
  const isInt = /putIntValue|IntValue/.test(chain) || /^int$/.test(d[3]);
  fields.push({
    name,
    key: d[1],
    def: d[2].trim(),
    min: d[3].trim(),
    max: d[4].trim(),
    // 判据：Interval 只出现在 IntValue 的 defineInRange（整型边界无小数点）
    type: (chain.includes('IntValue') || (!d[3].includes('.') && !d[4].includes('.'))) ? 'int' : 'double',
    comment: c ? c[1] : '',
  });
}

if (!fields.length) { console.error('❌ 一个字段都没解析到'); process.exit(1); }

const snap = { generatedFrom: 'Config.java', count: fields.length, fields };

if (CHECK) {
  if (!fs.existsSync(snapPath)) { console.error('❌ 缺少 ' + path.basename(snapPath)); process.exit(1); }
  const old = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  if (JSON.stringify(old.fields) !== JSON.stringify(fields)) {
    console.error('❌ 快照与 Config.java 不一致（字段 ' + old.count + ' → ' + fields.length + '）');
    console.error('   跑 node tools/snapshot-part-config.js 更新快照');
    process.exit(1);
  }
  console.log('✅ 配件配置快照与 Config.java 一致（' + fields.length + ' 项）');
  process.exit(0);
}

fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2) + '\n', 'utf8');
console.log('✅ 配件配置快照已写入：' + fields.length + ' 项 -> tools/part-config-snapshot.json');
