// Probe which Minecraft/NeoForge maven hosts are reachable from this machine.
const HOSTS = [
  ['neoForge official maven', 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'],
  ['neoForged forgecdn mirror', 'https://neoforged.forgecdn.net/releases/net/neoforged/neoforge/maven-metadata.xml'],
  ['forgecdn root', 'https://neoforged.forgecdn.net/'],
  ['Mojang libraries', 'https://libraries.minecraft.net/'],
  ['Mojang piston-meta', 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'],
  ['Maven Central', 'https://repo1.maven.org/maven2/'],
  ['Aliyun maven mirror', 'https://maven.aliyun.com/repository/public/'],
  ['Gradle plugin portal', 'https://plugins.gradle.org/m2/'],
  ['GitHub', 'https://github.com/'],
];

(async () => {
  for (const [name, url] of HOSTS) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20000) });
      const body = r.ok ? await r.text() : '';
      let extra = '';
      if (url.endsWith('maven-metadata.xml') && body) {
        const latest = /<latest>([^<]+)<\/latest>/.exec(body);
        const vers = [...body.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
        const v211 = vers.filter((v) => v.startsWith('21.1.')).slice(-3);
        extra = '  latest=' + (latest ? latest[1] : '?') + '  21.1.x tail=' + v211.join(',') +
                '  totalVersions=' + vers.length;
      }
      console.log(
        name.padEnd(26) + ' HTTP ' + r.status + '  ' + (Date.now() - t0) + 'ms' + extra
      );
    } catch (e) {
      console.log(name.padEnd(26) + ' FAIL  ' + (Date.now() - t0) + 'ms  ' + (e.cause ? e.cause.message : e.message));
    }
  }
})();
