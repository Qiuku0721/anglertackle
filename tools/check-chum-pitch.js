const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const s=fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/entity/ChumEntity.java'),'utf8')
  .replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
let bad=0;
const m=s.match(/launchDeg\s*=\s*Math\.max\(0\.0,\s*Math\.min\(45\.0,\s*([^)]+)\)\)/);
if(!m){console.log('❌ 找不到 launchDeg 计算');process.exit(1);}
const expr=m[1].trim();
console.log('  launchDeg = clamp45('+expr+')');
if(expr==='-pitch') console.log('✅ 发射角 = 仰角（-pitch）→ 抬头打得远，与抛竿一致');
else if(expr==='pitch'){console.log('❌ 发射角用了 pitch（低头为正）→ 低头打得远，与抛竿相反');bad++;}
else {console.log('⚠ 表达式不是预期的 pitch/-pitch：'+expr);bad++;}
process.exit(bad?1:0);
