// Toolchain bootstrap: downloads JDK 21 + Gradle in parallel from Chinese mirrors,
// verifies SHA256, extracts with tar. Safe to re-run (skips already-valid files).
//
// Run: node tools/bootstrap-toolchain.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JDK_DIR = path.join(ROOT, '.jdk');

const JOBS = [
  {
    name: 'JDK 21 (Temurin 21.0.12.1)',
    url: 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip',
    sha: 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e',
    zip: path.join(JDK_DIR, 'jdk21.zip'),
    extractTo: JDK_DIR,
    expect: path.join(JDK_DIR, 'jdk-21.0.12.1+1', 'bin', 'java.exe'),
  },
  {
    name: 'Gradle 9.8.0',
    url: 'https://mirrors.cloud.tencent.com/gradle/gradle-9.8.0-bin.zip',
    sha: 'bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c',
    zip: path.join(JDK_DIR, 'gradle.zip'),
    extractTo: JDK_DIR,
    expect: path.join(JDK_DIR, 'gradle-9.8.0', 'bin', 'gradle.bat'),
  },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function download(job) {
  if (fs.existsSync(job.expect)) {
    console.log('[' + job.name + '] already extracted, skip');
    return true;
  }
  // resume not supported: always restart clean, stale .part files are usually corrupt
  if (fs.existsSync(job.zip + '.part')) fs.rmSync(job.zip + '.part');
  if (fs.existsSync(job.zip)) {
    try {
      if (sha256(job.zip) === job.sha) {
        console.log('[' + job.name + '] zip verified, skip download');
        return true;
      }
    } catch (_) {}
    fs.rmSync(job.zip);
  }

  console.log('[' + job.name + '] GET ' + job.url);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(job.url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
  } catch (e) {
    console.log('[' + job.name + '] FETCH FAILED: ' + (e.cause ? e.cause.message : e.message));
    return false;
  }
  if (!res.ok) {
    console.log('[' + job.name + '] HTTP ' + res.status);
    return false;
  }
  const total = Number(res.headers.get('content-length') || 0);
  console.log('[' + job.name + '] HTTP 200, ' + (total / 1048576).toFixed(1) + ' MB');

  const part = job.zip + '.part';
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let got = 0;
  let mark = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (got - mark >= 20 * 1048576) {
        mark = got;
        const s = (Date.now() - t0) / 1000;
        console.log(
          '[' + job.name + '] ' + (got / 1048576).toFixed(0) + '/' +
          (total / 1048576).toFixed(0) + ' MB  ' + (got / 1048576 / s).toFixed(2) + ' MB/s'
        );
      }
    }
    await new Promise((r) => out.end(r));
  } catch (e) {
    try { out.destroy(); } catch (_) {}
    console.log('[' + job.name + '] STREAM FAILED at ' + got + ' bytes: ' + (e.cause ? e.cause.message : e.message));
    return false;
  }

  const digest = hash.digest('hex');
  if (digest !== job.sha) {
    console.log('[' + job.name + '] SHA256 MISMATCH\n  got      ' + digest + '\n  expected ' + job.sha);
    fs.rmSync(part);
    return false;
  }
  fs.renameSync(part, job.zip);
  console.log(
    '[' + job.name + '] OK  ' + (got / 1048576).toFixed(1) + ' MB in ' +
    ((Date.now() - t0) / 1000).toFixed(0) + 's  sha256 verified'
  );
  return true;
}

function extract(job) {
  if (fs.existsSync(job.expect)) return true;
  console.log('[' + job.name + '] extracting ...');
  const r = spawnSync('tar', ['-xf', job.zip, '-C', job.extractTo], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log('[' + job.name + '] tar failed with code ' + r.status);
    return false;
  }
  const ok = fs.existsSync(job.expect);
  console.log('[' + job.name + '] extract ' + (ok ? 'OK' : 'FAILED (expected file missing)'));
  return ok;
}

(async () => {
  fs.mkdirSync(JDK_DIR, { recursive: true });

  // parallel download
  const results = await Promise.all(JOBS.map((j) => download(j)));
  let allOk = true;

  for (let i = 0; i < JOBS.length; i++) {
    if (!results[i]) { allOk = false; continue; }
    if (!extract(JOBS[i])) allOk = false;
  }

  if (allOk) {
    const java = JOBS[0].expect;
    const v = spawnSync(java, ['-version'], { encoding: 'utf8' });
    console.log('\njava -version:');
    console.log((v.stderr || v.stdout || '').trim());
    console.log('\nTOOLCHAIN READY');
  } else {
    console.log('\nTOOLCHAIN INCOMPLETE');
  }
  process.exit(allOk ? 0 : 1);
})();
