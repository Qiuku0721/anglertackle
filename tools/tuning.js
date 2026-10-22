// 离线脚本的**调参唯一来源**。
//
// 背景：这些 check-*/trace-*/dump-* 脚本原本各自用正则从 Java 源码里抓常量。
// 一旦常量搬进 Config.java（"接上配置文件"那次改动），它们全部读不到就崩了。
// 与其让每个脚本各写一份抓取逻辑（迟早漂移），不如集中在这里。
//
// 取值顺序：
//   1) Config.java 里 defineInRange/define 的**默认值**（游戏里的实际生效值）
//   2) 仍在 Java 源码里的 static final 常量（如 PULL_SPRINT、CAP_DAMPING 之类）
const fs = require('fs'), path = require('path');
const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
const ROOT = ATL_ROOT;   // 认 ATL_ROOT ⇒ 负例副本里读副本 ✓
const javaDir = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const cfgSrc = read('src/main/java/com/whitecobalt/anglertackle/Config.java');

/**
 * 从 Config.java 抽 "配置键 -> 默认值"。键是 defineInRange/define 的第一个参数。
 *
 * ⚠️ 必须按 `;` 切块解析，不能按行用正则：
 *   · 多行链式调用（tools/gen-part-config.js 生成的 79 个配件项）用逐行正则
 *     一条都匹配不到，读出来是 undefined —— 脚本不报错，只是拿 undefined 去算，
 *     算出一堆 NaN 或者静默按 0 处理。
 *   · 默认值可能是算式（鱼线 lineLength 写成 35.0 / 30.0），要真的求值。
 *   · Java 数值后缀（1.6D / 2f）会把数值正则带偏，先剥掉。
 * 这里与 tools/gen-tuning-schema.js 是同一套解析口径 —— 两边不一致的话，
 * 会出现"调参器显示 A、脚本按 B 计算"的分裂。
 */
function configDefaults() {
  const out = {};
  for (const raw of cfgSrc.split(';')) {
    const stmt = raw.replace(/(\d)[DdFfLl](?![0-9A-Za-z_])/g, '$1');
    const num = /\.defineInRange\("([^"]+)",\s*([-+*/(). \t0-9]+?)\s*,/.exec(stmt);
    if (num) {
      const v = evalNum(num[2]);
      if (v !== null) out[num[1]] = v;
      continue;
    }
    const bl = /\.define\("([^"]+)",\s*(true|false)\)/.exec(stmt);
    if (bl) out[bl[1]] = bl[2] === 'true';
  }
  return out;
}

/** 只放行算术，避免把任意 Java 代码 eval 进来。 */
function evalNum(s) {
  const t = s.trim();
  if (!/^[-+*/(). 0-9]+$/.test(t)) return null;
  const v = Function('"use strict";return (' + t + ')')();
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 从某个 Java 文件里抽 "常量名 -> 数值"。 */
function javaConst(relPath, name) {
  const src = read(relPath);
  const m = new RegExp(name + '\\s*=\\s*(-?[0-9.]+)').exec(src);
  return m ? parseFloat(m[1]) : null;
}

const cfg = configDefaults();

/**
 * 档位 → **游速倍率**。必须与 {@code FishSpecies.tierSpeed} 等价：
 * 底数^档 × 金/红档手感修正（用户 2026-10-05 定的 0.84 / 1.05）。
 *
 * <p>为什么集中在这里：手感修正落地前，好几个检查器各自写 `Math.pow(1.12, t)`。
 * 那样一旦 Java 侧多乘一层，这些"模型"就悄悄变成旧世界的，算出来的结论
 * （能不能拉回来、张力会不会卡住）全是错的 —— 而它们照样全绿。
 */
function tierSpeed(tier) {
  const t = Math.max(0, Math.min(5, Math.round(tier)));
  let v = Math.pow(cfg.tierSpeedBase, t);
  if (t === 4) return v * cfg.tierGoldSpeedScale;
  if (t === 5) return v * cfg.tierRedSpeedScale;
  return v;
}

/** 档位 → 体力抗性倍率（与 {@code FishSpecies.tierStaminaResist} 等价）。 */
function tierStaminaResist(tier) {
  return Math.pow(cfg.tierStaminaResistBase, Math.max(0, Math.min(5, Math.round(tier))));
}

module.exports = {
  cfg,
  javaConst,
  tierSpeed,
  tierStaminaResist,
  // ---- 张力（全部来自 config）----
  REEL_GAIN: cfg.reelGain,
  RELEASE_LOSS: cfg.releaseLoss,
  IDLE_LOSS: cfg.idleLoss,
  BASE_RECOVER: cfg.baseRecover,
  WHITE_ZONE_RATIO: cfg.whiteMax / 100.0,
  YELLOW_ZONE_RATIO: cfg.yellowMax / 100.0,
  CRITICAL_RATIO: cfg.criticalFlash / 100.0,
  PULL_IDLE: cfg.pullIdleBase,
  BASE_DRAIN_PER_SEC: cfg.staminaDrainBase,
  BASE_DRAIN_PER_TICK: cfg.staminaDrainBase / 20.0,
  // ---- 配件合成 ----
  CAP_TENSION_CEILING: cfg.capTensionCeiling,
  CAP_TENSION_RECOVER: cfg.capTensionRecover,
  CAP_STAMINA_DRAIN: cfg.capStaminaDrain,
  CAP_PULL: cfg.capPull,
  CAP_DAMPING: cfg.capDamping,
  BASE_TENSION_CEILING: javaConst('src/main/java/com/whitecobalt/anglertackle/fishing/PartComposer.java', 'BASE_TENSION_CEILING'),
  BASE_TENSION_RECOVER: cfg.baseRecover,
  BASE_PULL_IDLE: cfg.pullIdleBase,
  BASE_PULL_STRUGGLE: cfg.pullStruggleBase,
  // ---- 疲劳（距离拉锯）----
  FATIGUE_PULL: cfg.fatiguePullMultiplier,
  FATIGUED_REEL_MIN_GAIN: cfg.fatiguedReelMinGain,
  // ---- 窝料 ----
  CHUM_RADIUS: cfg.radius,
  CHUM_PARTICLE_INTERVAL: cfg.particleIntervalTicks,
  CHUM_PARTICLES_PER_BURST: cfg.particlesPerBurst,
  // ---- 其他 ----
  HOOK_WINDOW_BASE: cfg.base,
  BITE_MIN_WAIT: cfg.minWaitSeconds,
  BITE_MAX_WAIT: cfg.maxWaitSeconds,
};

if (require.main === module) {
  console.log('Config.java 默认值（'+Object.keys(cfg).length+' 项）:');
  for (const [k, v] of Object.entries(cfg)) console.log('  '+k.padEnd(28)+v);
  console.log('\n派生常量:');
  const self = module.exports;
  for (const k of ['WHITE_ZONE_RATIO','YELLOW_ZONE_RATIO','CRITICAL_RATIO','BASE_DRAIN_PER_TICK',
                   'BASE_TENSION_CEILING','CAP_TENSION_CEILING','PULL_IDLE','CHUM_RADIUS']) {
    console.log('  '+k.padEnd(28)+self[k]);
  }
}
