// Batch downloader with SHA256 verification, using Node's fetch (OpenSSL) because
// Windows PowerShell 5.1 / curl Schannel TLS is blocked in this sandbox.
//
// Usage:
//   node tools/download.js <outFile> <url> [expectedSha256]
//
// Writes to <outFile>.part then renames on success. Prints progress every 10 MB.
// Exit code 0 = success (hash matched or no hash given), 1 = failure.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
  const [outFile, url, expected] = process.argv.slice(2);
  if (!outFile || !url) {
    console.error('usage: node tools/download.js <outFile> <url> [expectedSha256]');
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  const part = outFile + '.part';
  if (fs.existsSync(part)) fs.rmSync(part);

  // Skip if already downloaded and hash matches.
  if (fs.existsSync(outFile) && expected) {
    const have = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
    if (have.toLowerCase() === expected.toLowerCase()) {
      console.log('ALREADY OK  ' + outFile + '  sha256=' + have);
      return;
    }
  }

  console.log('GET ' + url);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) });
  } catch (e) {
    console.error('FETCH FAILED: ' + (e.cause ? e.cause.message : e.message));
    process.exit(1);
  }
  if (!res.ok) {
    console.error('HTTP ' + res.status + ' ' + res.statusText);
    process.exit(1);
  }
  const total = Number(res.headers.get('content-length') || 0);
  console.log('HTTP ' + res.status + '  total=' + (total ? (total / 1048576).toFixed(1) + ' MB' : 'unknown'));

  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let got = 0;
  let lastMark = 0;

  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) {
        await new Promise((r) => out.once('drain', r));
      }
      if (got - lastMark >= 10 * 1048576) {
        lastMark = got;
        const secs = (Date.now() - started) / 1000;
        const pct = total ? ((got / total) * 100).toFixed(1) + '%' : '?';
        console.log(
          '  ' + (got / 1048576).toFixed(1) + ' MB (' + pct + ')  ' +
          (got / 1048576 / secs).toFixed(2) + ' MB/s'
        );
      }
    }
    await new Promise((r) => out.end(r));
  } catch (e) {
    try { out.destroy(); } catch (_) {}
    console.error('STREAM FAILED after ' + got + ' bytes: ' + (e.cause ? e.cause.message : e.message));
    process.exit(1);
  }

  const digest = hash.digest('hex');
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('downloaded ' + (got / 1048576).toFixed(1) + ' MB in ' + secs + 's');
  console.log('sha256 = ' + digest);

  if (expected && digest.toLowerCase() !== expected.toLowerCase()) {
    console.error('HASH MISMATCH\n  expected ' + expected.toLowerCase());
    try { fs.rmSync(part); } catch (_) {}
    process.exit(1);
  }

  fs.renameSync(part, outFile);
  console.log('OK -> ' + outFile);
}

main();
