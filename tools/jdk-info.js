// Query Adoptium API for the latest Temurin 21 JDK (Windows x64 zip) and node the direct link.
const API =
  'https://api.adoptium.net/v3/assets/latest/21/hotspot' +
  '?architecture=x64&image_type=jdk&os=windows&vendor=eclipse&heap_size=normal&page=0&page_size=1';

(async () => {
  try {
    const r = await fetch(API, { signal: AbortSignal.timeout(30000) });
    console.log('api status:', r.status);
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) {
      console.log('unexpected payload:', JSON.stringify(j).slice(0, 500));
      return;
    }
    const a = j[0];
    console.log('release_name :', a.release_name);
    console.log('version      :', JSON.stringify(a.version));
    console.log('binary.os    :', a.binary.os, a.binary.architecture, a.binary.image_type);
    console.log('package.name :', a.binary.package.name);
    console.log('package.size :', (a.binary.package.size / 1024 / 1024).toFixed(1), 'MB');
    console.log('package.sha  :', a.binary.package.checksum);
    console.log('DOWNLOAD_URL :', a.binary.package.link);
    console.log('installer    :', a.binary.installer ? a.binary.installer.link : '(none)');
  } catch (e) {
    console.log('FAIL:', e.cause ? e.cause.message : e.message);
  }
})();
