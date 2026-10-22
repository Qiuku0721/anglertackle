const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 守着"档位刻度"这个约定不被破坏。
//
// ── 仓库里有两套刻度，而且**故意的** ────────────────────────
//   鱼饵 BaitItem.tier      ：0 起 → 0白 1绿 2蓝 3紫 4金 5红
//   配件 PartStats.partTier ：1 起 → 1白 2绿 3蓝 4紫 5金 6红
// 配件为什么 1 起：0 在那里表示"没有档位"（渔轮、鱼钩都是 0，
// TacklePartItem 用 `partTier() > 0` 决定要不要按档位上色）。
//
// ── 汇合点只能有一个：FishingSession.equippedBaitTier() ──────
// 它按竿型取槽（台钓取 bait、路亚取 lure），并**把拟饵的 1 起算值 −1 归一**，
// 于是**所有下游消费点只看一套 0 起算的档位**：紫=3 金=4 红=5。
//
// ── 这条检查是怎么来的（真实事故，两次同源）──────────────────
//   ① baitMinTier() 的 switch 从"0 白"口径挪到 1 起算时漏挪了整列，
//      红拟饵拿不到应有的下限；
//   ② 之后 targetHighValuePct() 改成 1 起算（4/5/6）时，**拟饵对了、台钓又整体错一档** ——
//      鱼饵本来就是 0 起算：活虾（紫，3）落进 default 一点加成都没有、
//      发光饵（金，4）拿到紫饵的 2%、秘制香饵（红，5）拿到金饵的 4.5%，
//      用户定的"红饵 10%"在台钓上**永远不会出现**。
//   两次都是"同一个数字在两套刻度里有两种含义"，不崩不报错，
//   表现只是"某些饵的鱼种分布不对"。所以现在把归一写成**断言**。
//
// ── 判据为什么是"方法整体"而不是"逐条语句"──────────────
// 试过逐条语句找竿型判断，太脆：守卫可以写在方法开头，也可以藏在 isRedTier 里，
// 正则分不清"这条语句有没有被守卫覆盖"，会报出一堆假问题。
//
// 用法：node tools/check-bait-tier-range.js
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

// ---------------------------------------------------------------- ① 饵的档位范围
{
  const src = fs.readFileSync(path.join(JAVA, 'registry/ModItems.java'), 'utf8');
  const seen = new Set();
  let n = 0;
  for (const m of src.matchAll(/ITEMS\.register\("(bait_[a-z_0-9]+)"[\s\S]{0,220}?new BaitItem\(\s*(\d+)/g)) {
    n++;
    seen.add(Number(m[2]));
  }
  if (!n) no('一个鱼饵都没解析到 —— 正则与 ModItems.java 脱节了');
  else {
    const out = [...seen].filter((t) => t < 0 || t > 5);
    if (out.length) no('鱼饵档位越界：' + out.join(', ') + '（0-based 刻度只到 5=红）');
    else ok('鱼饵档位（0 起）' + n + ' 种，取值 ' + [...seen].sort((a, b) => a - b).join('/') + '，全在 0..5');
  }
}

// ---------------------------------------------------------------- ② 归一点
{
  const src = fs.readFileSync(path.join(JAVA, 'fishing/FishingSession.java'), 'utf8');
  const m = /public int equippedBaitTier\(\)\s*\{([\s\S]*?)\n    \}/.exec(src);
  if (!m) no('找不到 equippedBaitTier()');
  else if (!/partTier\(\)\s*-\s*1/.test(m[1])) {
    no('equippedBaitTier() 的拟饵分支没有 −1 归一 —— 拟饵是 1 起算（亮片 2 … 镀金 6），' +
       '不 −1 就会让下游按 0 起算写的判据整体错一档（台钓和路亚会各错一边）');
  } else {
    ok('equippedBaitTier() 把拟饵的 1 起算档 −1 归一（对下游只暴露 0 起算的一套）');
  }
}

// ---------------------------------------------------------------- ③ 三个消费点
{
  const src = fs.readFileSync(path.join(JAVA, 'fishing/FishingSession.java'), 'utf8');

  /** 取一个方法体（从签名往后一段）。 */
  const body = (name) => {
    const re = new RegExp('(public|private)[^\\n]*\\b' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const mm = re.exec(src);
    if (!mm) return null;
    return src.slice(mm.index, mm.index + 1400);
  };

  // baitMinTier：台钓提前返回，switch 只吃归一后的 0 起算值（紫=3 金=4 红=5）
  const bmt = body('baitMinTier');
  if (!bmt) no('找不到 baitMinTier()');
  else {
    const iFloat = bmt.search(/RodType\.FLOAT/);
    const iSwitch = bmt.indexOf('switch');
    if (iFloat < 0 || iSwitch < 0 || iFloat > iSwitch) {
      no('baitMinTier() 没有在 switch 之前对台钓竿提前返回');
    } else if (/case\s+3\s*->\s*1/.test(bmt) && /case\s+4\s*,\s*5\s*->\s*2/.test(bmt)) {
      ok('baitMinTier()：台钓提前返回；路亚按 0 起算档（紫 3 → 下限 1、金/红 4,5 → 下限 2）');
    } else {
      no('baitMinTier() 的 case 不是 0 起算的 3 / 4,5 —— ' +
         '0 起算下紫=3、金=4、红=5；写成 4/5,6 就是又混了拟饵的 1 起算刻度');
    }
  }

  // targetHighValuePct：0 起算的 3/4/5 → 2.0 / 4.5 / 10.0
  const hv = body('targetHighValuePct');
  if (!hv) no('找不到 targetHighValuePct()');
  else {
    const want = [[3, '2.0'], [4, '4.5'], [5, '10.0']];
    const miss = want.filter(([c, v]) => !new RegExp('case\\s+' + c + '\\s*->\\s*' + v.replace('.', '\\.')).test(hv));
    if (miss.length) {
      no('targetHighValuePct() 缺这些 case（0 起算：紫 3 → 2.0、金 4 → 4.5、红 5 → 10.0）：' +
         miss.map(([c, v]) => c + '→' + v + '%').join(', '));
    } else if (/case\s+6/.test(hv)) {
      no('targetHighValuePct() 里还有 case 6 —— 归一之后不存在 6 档，' +
         '它只会让"红档掉进 default"这类事故再长回来');
    } else {
      ok('targetHighValuePct()：紫 3 → 2.0% / 金 4 → 4.5% / 红 5 → 10.0%（0 起算，无 case 6）');
    }
  }

  // isRedTier：归一之后红只有 5 一个值
  const ir = /isRedTier\(int tier\)\s*\{[\s\S]{0,200}?\n    \}/.exec(src);
  if (!ir) no('找不到 isRedTier()');
  else if (!/tier\s*==\s*5/.test(ir[0])) no('isRedTier() 不认 5 —— 红档吃不到加成');
  else if (/tier\s*==\s*6/.test(ir[0])) {
    no('isRedTier() 还认 6 —— 归一之后拟饵的红档是 5，6 是旧的 1 起算刻度残留');
  } else ok('isRedTier() 只认 5（归一后的红档）');

  // 消费点不许直接吃未归一的 partTier()
  const direct = [...src.matchAll(/(highValueBonus|targetHighValuePct|baitMinTier)\(\s*[^)]*partTier\(\)/g)]
    .map((x) => x[1]);
  if (direct.length) {
    no('这些调用点直接把 partTier()（1 起算）喂给了按 0 起算判据的方法：' + direct.join(', ') +
       ' —— 必须走 equippedBaitTier() 的归一值');
  } else ok('没有调用点把未归一的 partTier() 直接喂给档位判据');
}

console.log(bad ? '\n❌ 有 ' + bad + ' 处问题' : '\n✅ 档位刻度只有一个汇合点，消费点全是 0 起算');
process.exit(bad ? 1 : 0);
