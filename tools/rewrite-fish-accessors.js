// 把 FishSpecies 里的数值读取改为"运行期从配置取"。
//
// ── 为什么要改名而不是只替换 ────────────────────────────────
// record 的字段访问就是裸标识符（`minKg`、`profile`），编译器不会区分
// "这是 record 字段" 和 "这是我想调用的方法"。所以只要漏改一处，
// 那处就会**静默**读到写死的旧值 —— 玩家改了配置，那条鱼的体重上限不动，
// 而且没有任何报错。
//
// 做法：把 record 组件改名成 specMinKg / specMaxKg / specProfile
//（spec = "源码里写着的规格值，仅供对照"），新增 kgMin() / kgMax() /
// effectiveProfile() 从配置取。这样**任何漏改的裸引用都会编译失败**
//（找不到符号），而不是静默出错。
//
// 用法：node tools/rewrite-fish-accessors.js [--write]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write');
const p = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');

let src = fs.readFileSync(p, 'utf8');
const before = src;

// ---------------------------------------------------------------- 1. record 头改名
// 只改 record 组件声明那几行（前 60 行内），别碰别处。
const HEAD_END = src.indexOf(') {\n');
if (HEAD_END < 0 || HEAD_END > 4000) throw new Error('找不到 record 头');
let head = src.slice(0, HEAD_END);
const tail = src.slice(HEAD_END);

head = head.replace(/^(\s*)double minKg,$/m,
  '$1// ⚠ 下面是**源码里写着的规格值**，运行期请用 kgMin() / kgMax() / effectiveProfile()（走配置）\n' +
  '$1double specMinKg,');
head = head.replace(/^(\s*)double maxKg,$/m, '$1double specMaxKg,');
head = head.replace(/^(\s*)FightProfile profile,$/m, '$1FightProfile specProfile,');
// Javadoc 的 @param 跟着改
head = head.replace(/^(\s*\* @param )minKg(\s+)/m, '$1specMinKg$2');
head = head.replace(/^(\s*\* @param )maxKg(\s+)/m, '$1specMaxKg$2');
head = head.replace(/^(\s*\* @param )profile(\s+)/m, '$1specProfile$2');
head = head.replace('体重下限（kg）', '体重下限（kg）——规格值，运行期用 kgMin()');
head = head.replace('体重上限（kg）', '体重上限（kg）——规格值，运行期用 kgMax()');
head = head.replace('对抗手感档案', '对抗手感档案——规格值，运行期用 effectiveProfile()');

for (const need of ['double specMinKg,', 'double specMaxKg,', 'FightProfile specProfile,']) {
  if (!head.includes(need)) throw new Error('record 头改名失败，缺少：' + need);
}

// ---------------------------------------------------------------- 2. 方法体里逐行替换
// 只替换**裸标识符**（前后不是 . 或字母数字下划线）。
// 这样 `s.minKg`、`this.minKg` 之类限定访问不会被误改（本来也不该出现）。
const NEW_METHODS = [
  '',
  '    // ================================================================ 运行期数值',
  '    //',
  '    //  下面三个取值方法走 {@link FishTuning}（即配置文件），而不是 record 字段。',
  '    //  record 的组件是 spec* 开头的那几个 —— "源码里写着的规格值"，',
  '    //  运行期一律不读，只由 tools/check-fish-config-parity.js 逐项比对',
  '    //  它们与配置默认值一致，防止记录和实际悄悄分叉。',
  '',
  '    /** 体重下限（kg），运行期从配置取。 */',
  '    public double kgMin() {',
  '        return FishTuning.minKg(id);',
  '    }',
  '',
  '    /** 体重上限（kg），运行期从配置取。 */',
  '    public double kgMax() {',
  '        return FishTuning.maxKg(id);',
  '    }',
  '',
  '    /**',
  '     * 对抗手感档案，运行期从配置取。',
  '     *',
  '     * <p>每次调用新建一个 {@link FightProfile} —— 一场对抗只在咬钩进 FIGHT 时',
  '     * 取一次快照，所以"改配置只影响下一场、不影响正在遛的这条鱼"是天然成立的。',
  '     */',
  '    public FightProfile effectiveProfile() {',
  '        return FishTuning.profile(id, specProfile.archetype());',
  '    }',
  '',
  '    /** 源码记录的体重下限（仅供对照，运行期不要用）。 */',
  '    public double specMinKgValue() {',
  '        return specMinKg;',
  '    }',
  '',
  '    /** 源码记录的体重上限（仅供对照，运行期不要用）。 */',
  '    public double specMaxKgValue() {',
  '        return specMaxKg;',
  '    }',
  '',
].join('\n');

const lines = tail.split('\n');
let nMin = 0, nMax = 0, nProf = 0;
for (let i = 0; i < lines.length; i++) {
  const orig = lines[i];
  let line = orig;
  // specMinKg 里的 "MinKg" 不会被 [^.\w] 边界命中，安全
  line = line.replace(/(^|[^.\w])minKg(?![\w(])/g, (m, pre) => { nMin++; return pre + 'kgMin()'; });
  line = line.replace(/(^|[^.\w])maxKg(?![\w(])/g, (m, pre) => { nMax++; return pre + 'kgMax()'; });
  line = line.replace(/(^|[^.\w])profile(?![\w(])/g, (m, pre) => { nProf++; return pre + 'effectiveProfile()'; });
  if (line !== orig) lines[i] = line;
}

// ---------------------------------------------------------------- 3. 插入新方法
const anchorIdx = lines.findIndex((l) => l.includes('这种鱼最低能出到几档'));
if (anchorIdx < 0) throw new Error('找不到插入锚点（minTier 的注释）');
lines.splice(anchorIdx, 0, NEW_METHODS);

src = head + lines.join('\n');

console.log('替换：minKg → kgMin() ' + nMin + ' 处；maxKg → kgMax() ' + nMax +
            ' 处；profile → effectiveProfile() ' + nProf + ' 处');

// ---------------------------------------------------------------- 4. 自检：不该再有裸引用
const body = src.slice(src.indexOf(') {\n'));
const leftover = [];
const bodyLines = body.split('\n');
for (let i = 0; i < bodyLines.length; i++) {
  const l = bodyLines[i];
  if (/spec(Min|Max)Kg|specProfile/.test(l)) continue;   // spec* 是合法的
  if (/(^|[^.\w])(minKg|maxKg|profile)(?![\w(])/.test(l)) {
    leftover.push((i + 1) + ': ' + l.trim());
  }
}
if (leftover.length) {
  console.log('\n⚠ 仍有裸字段引用 ' + leftover.length + ' 处（编译会失败，正好用来定位）：');
  leftover.slice(0, 10).forEach((l) => console.log('   ' + l));
}

if (!WRITE) { console.log('\n（预览模式。加 --write 写入）'); process.exit(0); }
if (src === before) { console.error('❌ 没有发生任何改动'); process.exit(1); }
fs.writeFileSync(p, src, 'utf8');
console.log('\n✅ FishSpecies.java 已写入');
