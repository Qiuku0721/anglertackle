// 生成链的**唯一入口** + 结构自检。
//
// ── 为什么要有这个脚本 ──────────────────────────────────────
// 配置生成分成两条路径，踩过很多次之后才理清：
//
//   ① 首次（ModItems.java 还是数字字面量）
//        还原三个文件 → gen-part-config → rewrite-part-stats → gen-fish-config
//
//   ② 日常（ModItems.java 已是 Tuning 调用形式）
//        直接 gen-part-config（从快照重建）→ gen-fish-config
//
// 两条路径都容易被"跑错顺序"毁掉：gen-fish-config 需要配件块当锚点，
// 而 peelAll 会把配件块也剥掉 —— 顺序错了就是一堆"找不到锚点"。
// 手工敲命令记不住，所以把顺序固化在这里。
//
// 用法：
//   node tools/rebuild-config.js            # 日常重建（路径 ②）
//   node tools/rebuild-config.js --fresh    # 从原始字面量备份全量重建（路径 ①）
//   node tools/rebuild-config.js --check    # 只自检，不改任何文件
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const G = require('./generated-blocks.js');

const ROOT = path.join(__dirname, '..');
const FRESH = process.argv.includes('--fresh');
const CHECK = process.argv.includes('--check');

const CFG = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/Config.java');
const TUN = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/Tuning.java');
const ITEMS = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java');
const BAK = path.join(ROOT, '参考资料/_before_partcfg');

const EXPECT_DEFINE = 447;   // 35 手写 + 79 配件 + 273 鱼种 + 60 玩法数值

function run(label, script, args = []) {
  process.stdout.write('  ' + label + ' … ');
  // ⚠️ stdio 必须是 'inherit'：沙箱禁止程序打开命名管道，
  // 而 child_process 默认的 stdio:'pipe' 正是靠管道收集输出 ——
  // 用 'pipe' 会直接 EPERM（"spawnSync ... EPERM"），看起来像权限问题其实不是。
  try {
    execFileSync(process.execPath, [path.join(__dirname, script), ...args],
      { stdio: 'inherit' });
    console.log('    ↳ OK');
    return;
  } catch (e) {
    console.log('失败（exit ' + (e.status === undefined ? '?' : e.status) + '）');
    console.error('    子脚本 ' + script + ' 自己打印了错误原因，见上面几行');
    process.exit(1);
  }
}

/** 结构自检：深度、项数、生成块份数。 */
function inspect() {
  const cfg = fs.readFileSync(CFG, 'utf8');
  const s = G.checkStructure(cfg);
  const decl = G.countBlock(cfg, '鱼种数值声明');
  const def = G.countBlock(cfg, '鱼种数值定义');
  const pdecl = G.countBlock(cfg, '配件数值声明');
  const pdef = G.countBlock(cfg, '配件数值定义');
  const gdecl = G.countBlock(cfg, '玩法数值声明');
  const gdef = G.countBlock(cfg, '玩法数值定义');
  return { s, decl, def, pdecl, pdef, gdecl, gdef, lines: cfg.split('\n').length };
}

function report(tag) {
  const r = inspect();
  const ok = r.s.ok && r.s.nDefine === EXPECT_DEFINE &&
             r.decl === 1 && r.def === 1 && r.pdecl === 1 && r.pdef === 1 &&
             r.gdecl === 1 && r.gdef === 1;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + tag +
              '  项=' + r.s.nDefine + '/' + EXPECT_DEFINE +
              '  深度=' + (r.s.ok ? '0' : '异常') +
              '  块=' + r.pdecl + '/' + r.pdef + ', ' + r.decl + '/' + r.def + ', ' + r.gdecl + '/' + r.gdef +
              '  行=' + r.lines);
  if (!ok) {
    if (!r.s.ok) console.error('     ' + r.s.problems.join('\n     '));
    if (r.s.nDefine !== EXPECT_DEFINE) console.error('     配置项数量不对');
    process.exitCode = 1;
  }
  return ok;
}

if (CHECK) {
  console.log('=== 结构自检 ===');
  report('当前 Config.java');
  process.exit(process.exitCode || 0);
}

if (FRESH) {
  console.log('=== 全量重建（从原始字面量备份）===');
  // ⚠️ FishSpecies.java 也要还原：它的数值访问器被 rewrite-fish-accessors.js
  // 改成过 kgMin()/kgMax()/effectiveProfile()，那是**不可逆**的改写。
  // 不还原就会和"还没生成鱼种配置的 Config.java"对不上（找不到符号）。
  const FISH_SPECIES = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishSpecies.java');
  const FISH_BAK = path.join(ROOT, '参考资料/_before_fishcfg');
  const files = [
    ['Config.java.bak', CFG],
    ['Tuning.java.bak', TUN],
    ['ModItems.java.bak', ITEMS],
  ];
  for (const [src, dst] of files) {
    if (!fs.existsSync(path.join(BAK, src))) { console.error('❌ 缺少备份 ' + src); process.exit(1); }
    fs.copyFileSync(path.join(BAK, src), dst);
  }
  if (fs.existsSync(path.join(FISH_BAK, 'FishSpecies.java.bak'))) {
    fs.copyFileSync(path.join(FISH_BAK, 'FishSpecies.java.bak'), FISH_SPECIES);
  } else {
    console.error('❌ 缺少 FishSpecies.java 的字面量备份（参考资料/_before_fishcfg/）');
    process.exit(1);
  }
  // 备份里可能残留历史事故留下的孤立 ==== 行，先清掉
  for (const p of [CFG, TUN]) {
    const t = fs.readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*====\s*$/.test(l)).join('\n');
    fs.writeFileSync(p, t, 'utf8');
  }
  console.log('  已还原三个文件');

  // Tuning.java 也从**干净模板**起（模板 = 手写骨架，一个生成块都不留）。
  // 生成器会从零插入配件/鱼种/玩法三组块。用模板而不是 .bak 的原因：
  // .bak 里可能带着历史事故积压的重复生成块，从它起步会把脏东西带进来。
  const tunTpl = path.join(BAK, 'Tuning.template.java');
  if (fs.existsSync(tunTpl)) {
    fs.copyFileSync(tunTpl, TUN);
    console.log('  已从模板恢复 Tuning.java（无生成块）');
  } else {
    console.error('❌ 缺少 Tuning 模板 ' + path.relative(ROOT, tunTpl) +
                  '\n   跑 node tools/make-tuning-template.js --write 生成它');
    process.exit(1);
  }

  // FishTuning.java 是**手写**文件（只有中间一小段是生成的），
  // 所以它不参与"从字面量重建"，而是从模板复制 —— 模板里带着生成区锚点。
  const fishTunTpl = path.join(BAK, 'FishTuning.template.java');
  const fishTun = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/fishing/FishTuning.java');
  if (fs.existsSync(fishTunTpl)) {
    fs.copyFileSync(fishTunTpl, fishTun);
    console.log('  已从模板恢复 FishTuning.java');
  } else if (!fs.existsSync(fishTun)) {
    console.error('❌ 缺少 FishTuning.java 及其模板 ' + path.relative(ROOT, fishTunTpl));
    process.exit(1);
  }
  run('gen-part-config', 'gen-part-config.js', ['--write']);
  // 这一步现在只是打印说明（脚本已废弃）。
  // ⛔ 它曾经做的事是"把 ModItems 的配件数值换成 Tuning 调用"，那会让游戏启动即崩：
  //    RegisterEvent 阶段读配置 → "Cannot get config value before config is loaded."
  //    NeoForge 的配置加载晚于 mod 构造，而 DeferredRegister 的 supplier 就在那之前跑。
  run('rewrite-part-stats（已废弃）', 'rewrite-part-stats.js');
  // ⚠️ 这里**不要**再给 ModItems 补 Tuning import。
  // 配件属性必须保持字面量：它们是注册期烘进 PART_STATS 组件的值，
  // 在物品定义里读配置会让游戏启动即崩（Cannot get config value before config is loaded）。
  // 曾经有一段代码在这里自动补 import —— 那正是把崩溃引进来的地方。
  if (fs.readFileSync(ITEMS, 'utf8').includes('fishing.Tuning;')) {
    console.error('❌ ModItems.java 里出现了 Tuning import —— 它会在注册期读配置，游戏将启动崩溃。');
    console.error('   请从 参考资料/_before_partcfg/ModItems.java.bak 还原。');
    process.exit(1);
  }
  run('gen-fish-config', 'gen-fish-config.js', ['--write']);
  // 玩法数值（鱼竿材质 / 张力模型 / 档位曲面 / 抛投窝料）
  run('gen-gameplay-config', 'gen-gameplay-config.js', ['--write']);
  // FishSpecies 的数值读取改成走配置（不可逆改写，必须在鱼种配置生成之后做）
  run('rewrite-fish-accessors', 'rewrite-fish-accessors.js', ['--write']);
  // 把写死的玩法常量接上配置（幂等；只在还没接的时候才有实际改动）
  run('wire-gameplay', 'wire-gameplay.js', ['--write']);
  // 收尾补丁：全量重建会把文件还原成老备份，有些改动不属于任何生成块，
  // 生成器不会重新做出来（cfgPublic / s.kgMin / reload 里的 FishTuning.build）。
  run('apply-manual-patches', 'apply-manual-patches.js');
  console.log('\n=== 结果 ===');
  if (!report('全量重建后')) process.exit(1);
  run('更新配件快照', 'snapshot-part-config.js');
  console.log('\n✅ 完成');
  process.exit(0);
}

// ---- 日常重建（路径 ②）----
console.log('=== 日常重建 ===');
run('gen-part-config', 'gen-part-config.js', ['--write']);
run('gen-fish-config', 'gen-fish-config.js', ['--write']);
run('gen-gameplay-config', 'gen-gameplay-config.js', ['--write']);
console.log('\n=== 结果 ===');
if (!report('重建后')) process.exit(1);
console.log('\n✅ 完成');
