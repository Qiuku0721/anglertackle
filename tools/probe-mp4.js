const fs = require('fs');
const p = process.argv[2];
const b = fs.readFileSync(p);
const out = [];
function walk(buf, start, end, depth) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16; }
    if (size === 0) size = end - off;
    out.push('  '.repeat(depth) + type + ' size=' + size);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta'].includes(type)) walk(buf, off + hdr, off + size, depth + 1);
    if (type === 'mvhd') {
      const ver = buf[off + hdr];
      const ts = buf.readUInt32BE(off + hdr + (ver === 1 ? 20 : 12));
      const dur = ver === 1 ? Number(buf.readBigUInt64BE(off + hdr + 24)) : buf.readUInt32BE(off + hdr + 16);
      out.push('  '.repeat(depth + 1) + 'timescale=' + ts + ' duration=' + dur + ' seconds=' + (dur / ts).toFixed(1));
    }
    if (type === 'stsd') {
      const cnt = buf.readUInt32BE(off + hdr + 4);
      let o = off + hdr + 8;
      for (let i = 0; i < cnt && o + 8 <= end; i++) {
        const esz = buf.readUInt32BE(o);
        const fmt = buf.toString('latin1', o + 4, o + 8);
        let extra = '';
        if (['avc1', 'hvc1', 'mp4v'].includes(fmt) && o + 8 + 78 <= end) {
          extra = ' width=' + buf.readUInt16BE(o + 8 + 24) + ' height=' + buf.readUInt16BE(o + 8 + 26);
        }
        if (fmt === 'mp4a' && o + 8 + 28 <= end) {
          extra = ' channels=' + buf.readUInt16BE(o + 8 + 16) + ' samplerate=' + (buf.readUInt32BE(o + 8 + 24) / 65536);
        }
        out.push('  '.repeat(depth + 1) + 'codec ' + fmt + extra);
        o += esz;
      }
    }
    if (size <= 0) break;
    off += size;
  }
}
walk(b, 0, b.length, 0);
console.log(out.join('\n'));
