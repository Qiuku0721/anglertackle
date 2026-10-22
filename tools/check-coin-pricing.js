const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 守住鱼币定价与"品质档位不再失真"这两件事。
//
// 这一组全都是**编译能过、运行不报错、只是数值悄悄不对**的类型：
//   · 价格表出现倒挂（3 档比 2 档便宜）→ 玩家觉得升级没用，而代码里看不出来
//   · 某档价格写成 0 或负数 → 钓到高级鱼给 0 币
//   · FishData 不存 tier、又退回按 SizeGrade 反推 → 金鱼被当成红鱼（差 3.5 倍）
//   · tierOfGrade(RECORD) 又写回 5 → 老存档那条退路开始冒充满档
//   · 上鱼路径没接结算 → 钓一天币不动，且没有任何报错
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const JAVA = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };
const read = (rel) => fs.readFileSync(path.join(JAVA, rel), 'utf8');
// 剥注释走共用实现（各写一份踩过坑：见 tools/java-source.js 顶部）
const { stripComments: strip } = require('./java-source.js');

// ---------------------------------------------------------------- 1. 价格表
{
  const s = strip(read('economy/CoinPricing.java'));
  const m = /BASE_BY_TIER\s*=\s*\{([^}]*)\}/.exec(s);
  if (!m) no('CoinPricing 里找不到 BASE_BY_TIER —— 定价表结构变了，这条断言要跟着改');
  else {
    const nums = m[1].split(',').map((x) => Number(x.trim().replace(/L$/i, '')))
      .filter((n) => !Number.isNaN(n));
    if (nums.length === 6) ok('价格表是 6 档（白绿蓝紫金红），[' + nums.join(', ') + ']');
    else no('价格表有 ' + nums.length + ' 档，应为 6');

    const nonPositive = nums.filter((n) => n <= 0);
    if (nonPositive.length) no('有档位价格 ≤ 0：' + nonPositive.join(', '));
    else ok('每一档价格都 > 0');

    let dips = [];
    for (let i = 1; i < nums.length; i++) if (nums[i] <= nums[i - 1]) dips.push(i);
    if (dips.length) {
      no('价格出现倒挂或持平（第 ' + dips.map((i) => i + ' 档').join('、') + ' 不比上一档高）——' +
         '玩家会觉得升级没用');
    } else ok('价格逐档严格递增（越高档越值钱）');

    // 红/白 的比值：低于 20 倍的话"红鱼"就不稀罕了（权重只有 2/7）
    if (nums.length === 6) {
      const ratio = nums[5] / nums[0];
      if (ratio >= 20) ok('红/白 价格比 ' + ratio.toFixed(0) + ' 倍，稀有度有分量');
      else no('红/白 只差 ' + ratio.toFixed(1) + ' 倍 —— 红鱼权重只有 2/7，这个差价撑不起"稀有"');
    }
  }
  if (/SIZE_SPREAD\s*=\s*0\.08/.test(s)) ok('尺寸浮动 ±8%（与 docs/03 §6 一致）');
  else no('尺寸浮动不是 0.08 —— 与设计文档不一致');
}

// ---------------------------------------------------------------- 2. FishData 必须存 tier
{
  const s = strip(read('fishing/FishData.java'));
  if (/int tier\b/.test(s)) ok('FishData 有 tier 字段');
  else no('FishData 没有 tier —— 金(4)/红(5) 会挤在同一个 SizeGrade 上，信息丢失');
  if (/effectiveTier\s*\(\)/.test(s)) ok('有 effectiveTier()（优先用存下来的真实档）');
  else no('没有 effectiveTier() —— 取值处会各自反推，迟早写歪');
  if (/return\s+tier\s*>=\s*0\s*\?\s*tier\s*:\s*tierOfGrade/.test(s)) {
    ok('effectiveTier() 优先用存下来的档，没有才反推（老存档兼容）');
  } else no('effectiveTier() 的优先级不对 —— 必须先用存下来的 tier');

  // 有损方向必须取低档：宁可把红显示成金，也别把金显示成红
  const rec = /case\s+RECORD\s*->\s*(\d+)/.exec(s);
  if (rec && Number(rec[1]) === 4) ok('tierOfGrade(RECORD) = 4（有损方向取低档，不冒充满档红）');
  else if (rec) no('tierOfGrade(RECORD) = ' + rec[1] + ' —— 又写回 5 的话金鱼会显示成红鱼');
  else no('找不到 tierOfGrade(RECORD) 的返回值');

  if (/quality\(\)\s*\{[\s\S]{0,120}?Quality\.of\(\s*effectiveTier\(\)\s*\)/.test(s)) {
    ok('quality() 走 effectiveTier()');
  } else no('quality() 没走 effectiveTier() —— 颜色还会错');

  // 两个构造点都必须把 tier 传进去
  const n = (s.match(/new FishData\(/g) || []).length;
  if (n === 0) ok('FishData.java 内部没有自建实例（构造点都在别处）');
}

// ---------------------------------------------------------------- 3. 个体生成处真的传了 tier
{
  const s = strip(read('fishing/FishSpecies.java'));
  const calls = [...s.matchAll(/new FishData\(([\s\S]{0,220}?)\);/g)].map((m) => m[1]);
  if (calls.length < 2) no('FishSpecies 里的 FishData 构造点少于 2 个 —— 结构变了，检查要更新');
  else {
    const missing = calls.filter((c) => !/,\s*tier\s*$/.test(c.trim()));
    if (missing.length) {
      no('有 ' + missing.length + ' 个 FishData 构造点没把 tier 传进去 —— 那条链又会退化成反推');
    } else ok('FishSpecies 的 ' + calls.length + ' 个构造点都把真实 tier 传进去了');
  }
}

// ---------------------------------------------------------------- 4. 上鱼**不该**直接给钱
//
// 用户定案："不要直接跳鱼币，而是将数据显示在鱼面板，到时候方便做 NPC 商店时卖出拿钱。"
// 经济闭环必须是 钓鱼 → 鱼进包（带售价）→ 商店卖出 → 才拿钱。
//
// ⚠ 这条断言的方向和其他几条相反：它守的是"某件事**没有**发生"。
//   因为"上鱼自动结算"写起来只要一行，而且跑起来完全正常 —— 只是把商店
//   和鱼的数据面板一起废掉了：既然钓上来就自动卖，谁还会去看哪条值钱。
{
  const s = strip(read('fishing/FishingManager.java'));
  if (/addCoins/.test(s)) {
    no('FishingManager 里出现 addCoins —— 上鱼又直接给钱了，' +
       '那玩家永远不需要商店，鱼面板上的售价也没意义了');
  } else ok('上鱼路径不给钱（鱼币来自以后在商店卖鱼）');
  // ⚠ 这里**只看鱼币**，不要笼统地禁"碰玩家数据"。
  //   2026-09-30：图鉴记账（记入 CodexEntry）本来就应该发生在上鱼路径上，
  //   而最初这条断言写的是"上鱼路径不该调用 PlayerData.update" —— 太宽，
  //   把图鉴记账也一起拦了。断言的粒度要对着**它真正要防的那件事**，
  //   否则每次加新功能都会撞上它，然后被人放宽成永远成立。
  if (/addCoins|withCoins/.test(s)) {
    no('上鱼路径又在给鱼币了 —— 鱼币必须来自 NPC 商店卖鱼，'
       + '自动结算会让商店和鱼面板上的售价一起失去意义');
  } else ok('上鱼路径不改鱼币（图鉴记账是允许的，那是另一回事）');

  // 但售价必须能算出来（记日志对账、鱼面板显示都要用）
  if (/CoinPricing\.priceFor/.test(s)) ok('上鱼时仍然算出售价（记日志对账用）');
  else no('上鱼时不再算售价 —— 以后卖鱼时对不上账');
}

// ---------------------------------------------------------------- 5. 鱼面板要显示售价
{
  const s = strip(read('item/FishItem.java'));
  if (/sellValue/.test(s)) ok('FishItem 提供 sellValue(stack)');
  else no('FishItem 没有 sellValue —— 商店和提示都没有价格来源');
  if (/fish_value/.test(s)) ok('鱼的数据面板上显示了售价（玩家才知道哪条值得留）');
  else no('鱼面板没显示售价 —— 卖之前玩家完全不知道价格，商店就成了盲盒');
  if (/fish_grade|grade\(\)\.key\(\)/.test(s)) ok('鱼的数据面板上显示了尺寸评级');
  else no('鱼面板没显示尺寸评级 —— 那是"这条鱼好不好"的第二个维度');
  if (/effectiveTier\(\)/.test(s)) ok('售价用 effectiveTier() 取档位（不是反推）');
  else no('售价的档位来源可疑 —— 用反推会把金鱼按红鱼定价');
  if (/FishSpecies\.byId/.test(s)) ok('售价按鱼种现查体重区间（改了 fishStats 会跟着动）');
  else no('售价没查鱼种区间 —— 尺寸系数会退化');
}

// ---------------------------------------------------------------- 6. byId 必须容错
{
  const s = strip(read('fishing/FishSpecies.java'));
  if (/public static FishSpecies byId\(/.test(s)) ok('FishSpecies.byId 存在（图鉴与鱼面板都要用）');
  else no('FishSpecies 没有 byId');
  if (/byId\(String id\)\s*\{[\s\S]{0,400}?return null;/.test(s)) {
    ok('byId 找不到时返回 null（不因为一条数据损坏的鱼把客户端搞崩）');
  } else no('byId 找不到时没有返回 null —— 显示路径上会抛异常');
}

console.log(bad === 0 ? '\n✅ 鱼币定价与品质档位链路正确' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
