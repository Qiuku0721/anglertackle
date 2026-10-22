// 逐步打印档1（白/绿）鱼的对抗过程，看体力到底怎么掉的。
const TPS = 20;

function struggleSeconds(t) { return 2.0 + Math.min(5, t) * 1.6; }
function restSeconds(t) { return 5.0 - Math.min(5, t) * 0.4; }
function roundsForTier(tier) {
  if (tier >= 5) return 6;
  if (tier === 4) return 4;
  return 2;
}
function roundDrainCap(tier, maxRounds) {
  if (tier >= 4) return 0.9 / Math.max(1, maxRounds);
  return 1.0;
}

const BASE_DRAIN_PER_TICK = 0.20 / 20;

function makeRnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const tier = 1;
const maxRounds = roundsForTier(tier);
const cap = roundDrainCap(tier, maxRounds);
const rnd = makeRnd(7);

console.log('档=' + tier + '  最多轮数=' + maxRounds + '  单轮上限比例=' + cap);
console.log('每 tick 扣力 = ' + BASE_DRAIN_PER_TICK.toFixed(5)
  + '（占满体力的 ' + (BASE_DRAIN_PER_TICK * 100).toFixed(3) + '%）');
console.log('满体力扣完需要 ' + (1 / BASE_DRAIN_PER_TICK).toFixed(1) + ' tick 的收线'
  + '（' + (1 / BASE_DRAIN_PER_TICK / TPS).toFixed(2) + ' 秒）\n');

let st = 1.0;
let struggling = false;
let phaseTicks = 1;
let roundDrain = 0;
let roundsDone = 0;
let exhausted = false;
let ticks = 0;
let reelTicks = 0;

while (st > 0 && ticks < TPS * 60) {
  ticks++;
  if (--phaseTicks <= 0) {
    if (!exhausted) { struggling = !struggling; } else { struggling = false; }
    roundDrain = 0;
    if (struggling) {
      roundsDone++;
      if (roundsDone >= maxRounds) exhausted = true;
      phaseTicks = Math.round(struggleSeconds(tier) * TPS);
      console.log('t=' + ticks + ' 第' + roundsDone + '轮挣扎开始，持续 '
        + struggleSeconds(tier).toFixed(1) + 's，体力=' + st.toFixed(3));
    } else {
      phaseTicks = exhausted ? TPS * 600 : Math.round(restSeconds(tier) * TPS);
      console.log('t=' + ticks + ' 休息 ' + (exhausted ? '永久' : restSeconds(tier).toFixed(1) + 's')
        + '，体力=' + st.toFixed(3));
    }
  }
  const r = rnd();
  if (r < 0.70) {
    reelTicks++;
    if (roundDrain < cap) {
      const allowed = Math.min(BASE_DRAIN_PER_TICK, cap - roundDrain);
      st -= allowed;
      roundDrain += allowed;
    }
  }
}

console.log('\n结束：t=' + ticks + '（' + (ticks / TPS).toFixed(1) + 's）'
  + '  收线 tick=' + reelTicks + '（' + (reelTicks / TPS).toFixed(2) + 's）'
  + '  轮数=' + roundsDone + '  剩余体力=' + Math.max(0, st).toFixed(3));
