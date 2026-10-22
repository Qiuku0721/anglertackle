// Show every line that still mentions the trademark, to confirm they are citation-only.
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const NEEDLES = ['三角洲', 'Delta Force', '腾讯', '天美', 'Tencent'];
let n = 0;
for (const f of fs.readdirSync(D).filter((x) => x.endsWith('.md'))) {
  const lines = fs.readFileSync(path.join(D, f), 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (NEEDLES.some((k) => l.includes(k))) {
      n++;
      console.log(f + ':' + (i + 1) + '  ' + l.trim().slice(0, 130));
    }
  });
}
console.log('\ntotal trademark-mentioning lines: ' + n);
