// One-shot doc rename for the publishing-compliance pass.
// Run: node tools/rename-docs.js [--dry]
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const DRY = process.argv.includes('--dry');

// Order matters: longer / more specific patterns first.
const RULES = [
  // 官方地名与专有名词（上架风险词）
  ['长弓溪谷', '溪谷钓点'],
  ['烽火地带', '（原作战模式）'],
  ['静水湾', '静水湾※改为原创名'],
  // 官方道具名
  ['EDC 工具包', '渔具包'],
  ['EDC工具包', '渔具包'],
  ['EDC 式随身工具包', '随身渔具包'],
  ['「EDC」', '「渔具包」'],
  // 官方 NPC 名
  ['乔里德', '老柯'],
  ['喬里德', '老柯'],
  // 项目名
  ['三角洲钓鱼', '垂纶'],
  ['Delta Fishing', "Angler's Tackle"],
  ['deltafishing', 'anglertackle'],
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(DOCS);
let grand = 0;
const report = [];

for (const f of files) {
  let text = fs.readFileSync(f, 'utf8');
  const original = text;
  const hits = [];
  for (const [from, to] of RULES) {
    const n = text.split(from).length - 1;
    if (n > 0) {
      hits.push(from + ' ×' + n + ' -> ' + to);
      text = text.split(from).join(to);
      grand += n;
    }
  }
  if (text !== original) {
    if (!DRY) fs.writeFileSync(f, text, 'utf8');
    report.push(path.basename(f) + '\n    ' + hits.join('\n    '));
  }
}

console.log(report.join('\n'));
console.log('\n' + (DRY ? '[DRY RUN] ' : '') + 'total replacements: ' + grand + ' in ' + report.length + ' files');

// Post-check: list any remaining risky tokens.
console.log('\n--- remaining risk tokens ---');
const RISK = ['三角洲', 'Delta Force', 'Tencent', '腾讯', '天美', '乔里德', '烽火地带', '长弓溪谷'];
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const found = RISK.filter((r) => t.includes(r)).map((r) => r + '×' + (t.split(r).length - 1));
  if (found.length) console.log(path.basename(f) + ': ' + found.join(', '));
}
