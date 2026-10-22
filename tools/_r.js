const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const ids = ['tigerfish','oxeye_tarpon','banded_loach','sapphire_snakehead','juvenile_shark','atlantic_salmon','crucian_carp','platinum_arowana','pike'];
for (const id of ids) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT,'fish_research',id+'.json'),'utf8'));
  console.log('===== ' + id + '  [' + (j.nameZh||'') + ']');
  const clip = (s) => String(s||'').replace(/\s+/g,' ').slice(0, 260);
  for (const k of ['bodyShape','dorsalColor','flankColor','bellyColor','markings','oneLineId']) {
    if (j[k]) console.log('  ' + k + ': ' + clip(j[k]));
  }
}
