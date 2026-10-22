// 重建链的收尾补丁（幂等，可重复运行）。
//
// 全量重建会把文件还原成备份里的老版本，而有些改动**不属于任何生成块**，
// 因此不会被生成器重新做出来。这些就是：
//   ① Tuning.cfgPublic()          —— FishTuning 需要的不抛异常的配置句柄
//   ② FishSpecies 里 buildPool 的 s.minKg → s.kgMin()
//      （rewrite-fish-accessors.js 的替换规则漏了这一处，因为它前面是大写变量名）
//   ③ Tuning.reload() 末尾调用 FishTuning.build()，让热重载同时刷新鱼种数值
//
// 与其每次手工补，不如固化成脚本 —— 不幂等的地方就是下次踩坑的地方。
//
// 用法：node tools/apply-manual-patches.js [--check]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const CHECK = process.argv.includes('--check');

const TUN = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java');
const SPECIES = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');

let changed = 0, missing = [];

// ---------------------------------------------------------------- ① cfgPublic()
{
  let t = fs.readFileSync(TUN, 'utf8');
  if (!t.includes('public static Config cfgPublic()')) {
    const anchor = '    private static Config cfg() {';
    if (!t.includes(anchor)) { missing.push('Tuning.java 里找不到 cfg()'); }
    else {
      const add = [
        '    /**',
        '     * 给 {@link FishTuning} 用的句柄：**不抛异常**，未就绪时返回 {@code null}。',
        '     *',
        '     * <p>为什么和 {@link #cfg()} 不一样：{@code cfg()} 是给 getter 用的，',
        '     * 那些 getter 只在钓鱼时被调用，早期调用属于"用错了"，抛异常能立刻定位。',
        '     * 而 {@code FishTuning.build()} 是**主动**在装载阶段被调用的，',
        '     * 那时配置可能真的还没注册完 —— 这是正常时序，不是错误。',
        '     * 让它抛异常会被上层 try/catch 吞掉并打一条 WARN，日志里看着像出了问题。',
        '     */',
        '    public static Config cfgPublic() {',
        '        return Config.INSTANCE;',
        '    }',
        '',
        anchor,
      ].join('\n');
      t = t.replace(anchor, () => add);
      if (!CHECK) fs.writeFileSync(TUN, t, 'utf8');
      changed++;
      console.log('  ✔ 已补 Tuning.cfgPublic()');
    }
  }
}

// ---------------------------------------------------------------- ② s.minKg → s.kgMin()
{
  let t = fs.readFileSync(SPECIES, 'utf8');
  if (t.includes('s.minKg >')) {
    // ⚠️ 用替换函数而不是字符串：替换串里的 $ 序列会被展开（踩过一次）
    t = t.replace(/s\.minKg >/g, () => 's.kgMin() >');
    if (!CHECK) fs.writeFileSync(SPECIES, t, 'utf8');
    changed++;
    console.log('  ✔ 已补 FishSpecies 的 s.minKg → s.kgMin()');
  }
}

// ---------------------------------------------------------------- ③ reload 调用 FishTuning.build()
{
  let t = fs.readFileSync(TUN, 'utf8');
  if (!t.includes('FishTuning.build()')) {
    const anchor = '            AnglersTackle.LOGGER.info("[垂纶] 配置热重载完成：应用 {} 项（{}）", applied[0], file.getFileName());';
    if (!t.includes(anchor)) { missing.push('Tuning.java 里找不到热重载完成日志（reload 的锚点）'); }
    else {
      const add = [
        '            // 鱼种数值也要跟着刷新，否则 /atl config reload 之后',
        '            // [fishStats] 那一组改了没反应（只有重启才生效）。',
        '            FishTuning.build();',
        anchor,
      ].join('\n');
      t = t.replace(anchor, () => add);
      if (!CHECK) fs.writeFileSync(TUN, t, 'utf8');
      changed++;
      console.log('  ✔ 已让 Tuning.reload() 同时刷新鱼种数值');
    }
  }
}

if (missing.length) {
  console.error('❌ 补丁无法应用：');
  missing.forEach((m) => console.error('   ' + m));
  process.exit(1);
}
console.log(changed ? '  共应用 ' + changed + ' 处补丁' : '  （全部已就位，无需改动）');
if (CHECK && changed) {
  console.error('❌ --check 模式下发现缺 ' + changed + ' 处补丁，跑一次 node tools/apply-manual-patches.js 修复');
  process.exit(1);
}
