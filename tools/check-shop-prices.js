/*
 * check-shop-prices.js —— 价目表不能和代码脱节。
 *
 * 核心判据只有一条：**`docs/18-商店价目表.md` 必须等于重新生成一遍的结果**。
 *
 * 为什么这条比"表里有 40 行"之类的断言强得多：
 * 价目表是**生成物**（档位从 ModItems.java 解析、价格从 MODEL 算）。
 * 生成物的所有问题最终都表现为"它和生成器对不上"——
 * 加了配件没重跑、改了档位没重跑、手改了文档里某个数字。
 * 逐行比对能一次性盖住全部这几种，而"数行数"一个都盖不住。
 *
 * 这个仓库在"生成物漂移"上踩过很多次：
 * 配置生成块重复注入、调参器 schema 和 Config 脱节、guide.json 和内置章节不一致。
 * 每次的教训都一样 —— **生成物必须有一步"重新生成一遍再比对"的校验**。
 *
 * 用法：node tools/check-shop-prices.js
 */
const fs = require('fs');
const path = require('path');

const { build, OUT } = require('./gen-shop-prices.js');

let fail = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

console.log('\n=== 商店价目表检查 ===\n');

// 生成器自带的合理性自检（价格随档位非递减、竿不能比窝料便宜…）
const r = build();

if (!fs.existsSync(OUT)) {
  bad('docs/18-商店价目表.md 不存在 —— 跑 node tools/gen-shop-prices.js --write');
} else {
  // ⚠ 比较前先归一换行：仓库里存的是 LF，而 core.autocrlf=true 的 Windows 检出
  //   会把工作区文件换成 CRLF（git ls-files --eol 显示 i/lf w/crlf）。
  //   那是**检出方式**，不是内容漂移 —— 归一后再逐行比对，语义强度不变。
  const norm = (s) => String(s).replace(/\r\n/g, '\n');
  const cur = norm(fs.readFileSync(OUT, 'utf8'));
  const want = norm(r.md);
  if (cur === want) {
    ok('文档与代码**逐行一致**（' + r.total + ' 件配件）');
  } else {
    bad('文档与代码不一致（生成物漂移）—— 修法：node tools/gen-shop-prices.js --write');
    const A = cur.split('\n'), B = want.split('\n');
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if (A[i] !== B[i]) {
        console.log('     第一处差异在第 ' + (i + 1) + ' 行：');
        console.log('       文档里： ' + (A[i] === undefined ? '(没有这一行)' : A[i]));
        console.log('       应当是： ' + (B[i] === undefined ? '(不该有这一行)' : B[i]));
        break;
      }
    }
  }
}

// 解析/定价过程本身有没有问题（缺档位、价格表里没这个档位…）
if (r.problems && r.problems.length) {
  for (const p of r.problems) bad('定价问题：' + p);
} else {
  ok('全部配件都解析出了档位，且价格表覆盖了这些档位');
}

// 覆盖度：解析到的配件数不能凭空变少（漏解析的表现是"表里少几件"，很容易被忽略）
{
  const itemSrc = fs.readFileSync(path.join(__dirname, '..',
    'src/main/java/com/whitecobalt/anglertackle/registry/ModItems.java'), 'utf8');
  const RE = [
    /\b(?:wood|iron|gold|diamond|netherite)_(?:float|lure)_rod\b/g,
    /\b(?:hemp|cotton|nylon|fluoro|pe|titanium)_line\b/g,
    /\b(?:hand|spinning|drum|baitcast|heavy)_reel\b/g,
    /\b(?:plain|barbed)_hook\b/g,
    /\blure_[a-z_]+\b/g,
    /\bbait_[a-z_]+\b/g,
    /\bchum_[a-z_]+\b/g,
  ];
  const inCode = new Set();
  for (const re of RE) for (const m of itemSrc.match(re) || []) inCode.add(m);
  const inTable = new Set(r.entries.map((e) => e.id));
  const missing = [...inCode].filter((id) => !inTable.has(id));
  if (missing.length === 0) ok('代码里 ' + inCode.size + ' 个配件 id 全部进了价目表');
  else bad('这些配件在代码里存在但没进价目表：' + missing.join(', '));
  if (r.total === inTable.size) ok('价目表没有重复行（' + r.total + ' 件 = ' + inTable.size + ' 个 id）');
  else bad('价目表里有重复：' + r.total + ' 行但只有 ' + inTable.size + ' 个不同 id');
}

console.log('\n' + (fail === 0 ? '全部通过。' : fail + ' 项未通过（见上面 ❌）'));
console.log('\n  判据是"文档 == 重新生成一遍的结果"，不是"文档有 40 行"：');
console.log('    加配件没重跑、改档位没重跑、手改了某个数字 —— 这几种都会让逐行比对变红，');
console.log('    而"数行数"一种都抓不到。');
process.exitCode = fail === 0 ? 0 : 1;
