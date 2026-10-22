// ============================================================================
//  mp4-grab-frames.js -- 从 mp4 里直接抓出内嵌的 JPEG 帧（不依赖 ffmpeg）
//
//  Windows 的 Xbox Game Bar / 录屏工具常把关键帧以 MJPEG 形式存进 mp4，
//  这时文件里就躺着完整的 JPEG 流：以 FF D8 FF 开头、FF D9 结尾。
//  本工具扫描这些标记并把每张 JPEG 落盘，便于用 read_image 直接看。
//
//  用法: node tools/mp4-grab-frames.js <mp4> <输出目录> [最多抓几张]
// ============================================================================
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const outDir = process.argv[3];
const maxFrames = Number(process.argv[4] || 12);

const buf = fs.readFileSync(src);
fs.mkdirSync(outDir, { recursive: true });
console.log('文件: ' + path.basename(src) + '  ' + (buf.length / 1048576).toFixed(1) + ' MB');

// 找所有 JPEG（FF D8 FF ... FF D9）
let found = [];
let i = 0;
while (i < buf.length - 3) {
  if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
    // 往后找结束标记
    let j = i + 2;
    let end = -1;
    while (j < buf.length - 1) {
      if (buf[j] === 0xff && buf[j + 1] === 0xd9) { end = j + 1; break; }
      j++;
    }
    if (end > 0 && end - i > 2000) {
      found.push([i, end + 1]);
      i = end + 1;
      continue;
    }
  }
  i++;
}
console.log('找到 ' + found.length + ' 个 JPEG 帧');

if (!found.length) {
  // 没有内嵌 JPEG 时，报告文件头以便判断编码方式
  console.log('前 64 字节: ' + [...buf.subarray(0, 64)].map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('（H.264/HEVC 帧不是独立 JPEG，需要 ffmpeg 才能解码）');
  process.exit(0);
}

// 均匀取样
const pick = [];
if (found.length <= maxFrames) {
  for (let k = 0; k < found.length; k++) pick.push(k);
} else {
  for (let k = 0; k < maxFrames; k++) pick.push(Math.round((k * (found.length - 1)) / (maxFrames - 1)));
}
const seen = new Set();
pick.forEach((k, n) => {
  if (seen.has(k)) return;
  seen.add(k);
  const [s, e] = found[k];
  const out = path.join(outDir, 'frame' + String(n).padStart(3, '0') + '_' + k + '.jpg');
  fs.writeFileSync(out, buf.subarray(s, e));
  console.log('  写出 ' + path.basename(out) + '  (' + ((e - s) / 1024).toFixed(0) + ' KB, 源偏移 ' + s + ')');
});
