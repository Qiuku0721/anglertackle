// 校验 java-source.js 的剥注释器：重点是"不能把代码吃掉"。
//
// 这一条比"能剥掉注释"重要得多 —— 剥不干净只会误报（有人会去改断言），
// 而**多剥会让断言空过**，看起来一切正常。真实事故：先剥块注释的实现
// 遇到一行含 `/*` 的 `//` 注释后配对错位，把 FishingManager 里
// CoinPricing.priceFor 所在的一大段真实代码删掉了。
const { stripComments } = require('./java-source.js');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

// 1) 基本功能：注释没了，代码在
{
  const src = [
    'int a = 1; // 这是注释',
    '/* 块注释',
    '   还在块里 */',
    'String s = "// 不是注释";',
    "char c = '\\'';",
    'int b = Tuning.foo();',
  ].join('\n');
  const out = stripComments(src);
  if (!out.includes('这是注释') && !out.includes('还在块里')) ok('行注释与块注释都被剥掉');
  else no('注释没剥干净');
  if (out.includes('int a = 1;') && out.includes('Tuning.foo()')) ok('代码保留');
  else no('代码被吃掉了');
  if (out.includes('// 不是注释')) ok('字符串字面量里的 // 不当注释');
  else no('把字符串里的 // 当成了注释');
}

// 2) ★ 回归：行注释里出现 `/*` 不能开块注释、更不能吞掉后面的代码
{
  const src = [
    'int before = 1;',
    '// 路径通配见 textures/*/*.png 这种写法',
    'int after = 2;',
    'long v = CoinPricing.priceFor(3, 0.5);',
    'int tail = 4;',
  ].join('\n');
  const out = stripComments(src);
  const keep = ['int before', 'int after', 'CoinPricing.priceFor', 'int tail'];
  const lost = keep.filter((k) => !out.includes(k));
  if (lost.length === 0) ok('行注释含 /* 时不再吞代码（真实事故的回归）');
  else no('仍然吞掉了代码：' + lost.join(', '));
}

// 3) 行号必须保持不变
{
  const src = 'a\n/* x\ny\nz */\nb\n// c\nd';
  const out = stripComments(src);
  if (out.split('\n').length === src.split('\n').length) ok('剥注释后行数不变（报错行号才对得上）');
  else no('行数变了：' + out.split('\n').length + ' vs ' + src.split('\n').length);
}

// 4) 块注释里出现 // 不能提前结束块
{
  const src = '/* 说明：这样写 // 是行注释\n   仍在块里 */\nint real = 1;';
  const out = stripComments(src);
  if (!out.includes('仍在块里') && out.includes('int real')) ok('块注释里的 // 不影响块的结束位置');
  else no('块注释处理错了：' + JSON.stringify(out));
}

console.log(bad === 0 ? '\n✅ 剥注释器正确（不吞代码）' : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
