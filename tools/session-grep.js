// 一次性：会话存档是**多帧拼接**的 zstd（每次追加一帧），逐帧解析后拼接再搜索。
const fs = require('fs');
const zlib = require('zlib');

const FILE = process.argv[2];
const KEYS = process.argv.slice(3);

const buf = fs.readFileSync(FILE);
const MAGIC = 0xFD2FB528;
const SKIPPABLE = (v) => (v & 0xFFFFFFF0) === 0x184D2A50;

/** 帧头长度（**不含**帧尾的 Content_Checksum）。 */
function headerLen(b, at) {
  const desc = b[at + 4];
  const fcsFlag = desc >> 6;
  const singleSeg = (desc >> 5) & 1;
  const dictFlag = desc & 3;
  let n = 5;                                    // magic(4) + Frame_Header_Descriptor(1)
  if (!singleSeg) n += 1;                       // Window_Descriptor
  n += dictFlag === 3 ? 4 : dictFlag;           // Dictionary_ID
  n += fcsFlag === 0 ? (singleSeg ? 1 : 0) : (fcsFlag === 1 ? 2 : 4);   // Frame_Content_Size
  return n;
}

/** 返回下一帧的起始偏移（跳过本帧的全部 block 与帧尾校验和）。 */
function nextFrame(b, at) {
  const desc = b[at + 4];
  const checksum = (desc >> 2) & 1;
  let p = at + headerLen(b, at);                // ⚠ 必须加 at：原来是绝对偏移当成了长度
  for (;;) {
    const h = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
    const last = h & 1;
    const type = (h >> 1) & 3;
    const size = h >> 3;
    p += 3;
    if (type === 0) p += size;                  // Raw_Block
    else if (type === 1) p += 1;                // RLE_Block：内容只有 1 字节
    else if (type === 2) p += size;             // Compressed_Block
    else throw new Error('保留的 block 类型');
    if (last) break;
  }
  if (checksum) p += 4;                         // Content_Checksum 在**帧尾**
  return p;
}

const parts = [];
let at = 0, frames = 0, bad = 0;
while (at + 4 <= buf.length) {
  const magic = buf.readUInt32LE(at);
  if (SKIPPABLE(magic)) {
    const sz = buf.readUInt32LE(at + 4);
    at += 8 + sz;
    continue;
  }
  if (magic !== MAGIC) { bad++; break; }
  let end;
  try { end = nextFrame(buf, at); } catch (e) { bad++; break; }
  try {
    parts.push(zlib.zstdDecompressSync(buf.subarray(at, end)));
  } catch (e) {
    bad++;
    if (bad <= 3) console.error('帧 ' + frames + ' 解压失败：' + e.message);
  }
  frames++;
  at = end;
}
const text = Buffer.concat(parts).toString('utf8');
console.log('帧数 ' + frames + '（坏 ' + bad + '），解出 ' + (text.length / 1048576).toFixed(1) + ' MB，行数 ' + text.split('\n').length);

// --and 模式：找**同时**包含全部关键词的行（用于"那条消息里应该同时出现 9 个拟饵名"这类定位）
if (KEYS[0] === '--and') {
  const need = KEYS.slice(1);
  const lines = text.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (need.every((k) => lines[i].includes(k))) {
      n++;
      console.log('\n===== 第 ' + (i + 1) + ' 行（' + lines[i].length + ' 字节）=====');
      // 把 \n 还原成真换行，只打印前 6000 字符，够看清那段草稿
      console.log(lines[i].replace(/\\n/g, '\n').slice(0, 6000));
      if (n >= 3) break;
    }
  }
  console.log('\n命中行数 ' + n);
  process.exit(0);
}

// --ctx 模式：定位含某短语的行，然后打印它**之后**的 n 行（找"用户说了 X 之后我回了什么"）
if (KEYS[0] === '--ctx') {
  const phrase = KEYS[1];
  const n = Number(KEYS[2] || 6);
  const must = KEYS[3];        // 可选：之后的行里必须含这个词才打印
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(phrase)) continue;
    console.log('\n########## 命中行 ' + (i + 1) + ' ##########');
    for (let j = i; j <= Math.min(lines.length - 1, i + n); j++) {
      const s = lines[j].replace(/\\n/g, '\n');
      if (j > i && must && !lines[j].includes(must)) continue;
      console.log('\n===== 第 ' + (j + 1) + ' 行（' + lines[j].length + ' 字节）=====');
      console.log(s.slice(0, 9000));
    }
  }
  process.exit(0);
}

// --win 模式：找同时含全部关键词的行，打印**以某个词为中心**的窗口
if (KEYS[0] === '--win') {
  const center = KEYS[1];
  const need = KEYS.slice(2);
  const lines = text.split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(center)) continue;
    if (!need.every((k) => lines[i].includes(k))) continue;
    n++;
    const s = lines[i].replace(/\\n/g, '\n');
    const at = s.indexOf(center);
    console.log('\n===== 第 ' + (i + 1) + ' 行 · 以「' + center + '」为中心 =====');
    console.log(s.slice(Math.max(0, at - 4000), at + 9000));
    if (n >= 2) break;
  }
  console.log('\n命中行数 ' + n);
  process.exit(0);
}

for (const k of KEYS) {
  const hits = [];
  let i = text.indexOf(k);
  while (i >= 0 && hits.length < 4) { hits.push(i); i = text.indexOf(k, i + 1); }
  console.log('\n### 「' + k + '」命中 ' + hits.length + ' 处');
  for (const h of hits) {
    console.log('--------');
    console.log(text.slice(Math.max(0, h - 400), h + 2000).replace(/\\n/g, '\n'));
  }
}
