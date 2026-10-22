// Verify doc text after rename: reads with Node (always UTF-8), reports real counts.
const fs = require('fs');
const path = require('path');
const DOCS = path.join(__dirname, '..', 'docs');

const files = fs.readdirSync(DOCS).filter((f) => f.endsWith('.md'));
const RISK = ['三角洲', 'Delta Force', 'Tencent', '腾讯', '天美', '乔里德', '烽火地带', '长弓溪谷', 'deltafishing'];
const EXPECT = ['anglertackle', '老柯', '垂纶', "Angler's Tackle"];

let bad = 0;
for (const f of files) {
  const t = fs.readFileSync(path.join(DOCS, f), 'utf8');
  const risk = RISK.filter((r) => t.includes(r)).map((r) => r + '×' + (t.split(r).length - 1));
  const ok = EXPECT.filter((r) => t.includes(r)).map((r) => r + '×' + (t.split(r).length - 1));
  console.log(
    f.padEnd(26) +
    ' | risk: ' + (risk.length ? '⚠ ' + risk.join(', ') : 'none') +
    ' | new: ' + (ok.length ? ok.join(', ') : '-')
  );
  if (risk.length) bad++;
}
console.log('\nfiles still containing risk tokens: ' + bad + ' / ' + files.length);
