// Compare download speed from candidate JDK / Gradle mirrors.
// Reads 4 MB from each and reports MB/s, so we can pick the fastest source.
const CANDIDATES = [
  ['github (current)', 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'],
  ['tsinghua adoptium', 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'],
  ['bfsu adoptium', 'https://mirrors.bfsu.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'],
  ['sjtug adoptium', 'https://mirror.sjtu.edu.cn/Adoptium/21/jdk/x64/windows/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'],
  ['huawei adoptium', 'https://mirrors.huaweicloud.com/openjdk/21.0.2/openjdk-21.0.2_windows-x64_bin.zip'],
  ['tencent gradle', 'https://mirrors.cloud.tencent.com/gradle/gradle-9.8.0-bin.zip'],
  ['aliyun gradle', 'https://mirrors.aliyun.com/macports/distfiles/gradle/gradle-9.8.0-bin.zip'],
  ['gradle official (current)', 'https://services.gradle.org/distributions/gradle-9.8.0-bin.zip'],
];

const PROBE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 25000;

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 206) {
      console.log(name.padEnd(26) + ' HTTP ' + res.status + ' (skip)');
      return;
    }
    let got = 0;
    for await (const chunk of res.body) {
      got += chunk.length;
      if (got >= PROBE_BYTES) break;
    }
    const secs = (Date.now() - t0) / 1000;
    const mbps = got / 1048576 / secs;
    console.log(
      name.padEnd(26) +
      ' status=' + res.status +
      '  read=' + (got / 1048576).toFixed(2) + 'MB' +
      '  ' + secs.toFixed(1) + 's' +
      '  ' + mbps.toFixed(2) + ' MB/s'
    );
  } catch (e) {
    console.log(name.padEnd(26) + ' FAIL ' + (Date.now() - t0) + 'ms  ' + (e.cause ? e.cause.message : e.message));
  }
}

(async () => {
  for (const [n, u] of CANDIDATES) await probe(n, u);
})();
