// Report which sprite rows have the wrong length (all sprites must be 16 wide).
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'gen-textures.js'), 'utf8');

// crude but effective: pull out the SPRITES object literal and eval the string rows
const block = src.slice(src.indexOf('const SPRITES = {};'), src.indexOf('// ====', src.indexOf('const SPRITES = {};')));
const lines = block.split(/\r?\n/);
let current = null;
let idx = 0;
const problems = [];
for (const line of lines) {
  const m = /^SPRITES\.([a-z_]+)\s*=\s*\[/.exec(line);
  if (m) { current = m[1]; idx = 0; continue; }
  if (!current) continue;
  const r = /^\s*'([^']*)',?\s*$/.exec(line);
  if (r) {
    if (r[1].length !== 16) problems.push(current + ' row ' + idx + ' len=' + r[1].length + "  [" + r[1] + ']');
    idx++;
    continue;
  }
  if (/^\];/.test(line)) {
    if (idx !== 16) problems.push(current + ' has ' + idx + ' rows (expected 16)');
    current = null;
  }
}
if (problems.length === 0) console.log('全部 16x16 正常');
else { console.log('问题：'); problems.forEach((p) => console.log('  ' + p)); }
