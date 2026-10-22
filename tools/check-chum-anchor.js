const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
﻿const fs=require('fs'),path=require('path');
const ROOT=ATL_ROOT;
const s=fs.readFileSync(path.join(ROOT,
  'src/main/java/com/whitecobalt/anglertackle/fishing/FishingSession.java'),'utf8')
  .replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
let bad=0;
const m=s.match(/findChumAt\(([^)]*)\)/);
if(!m){console.log('❌ 找不到 findChumAt 调用');process.exit(1);}
const arg=m[1];
console.log('  实际传参: '+arg.trim());
if(/bobber/.test(arg)) console.log('✅ 用浮漂位置判定（鱼漂进圈才吃加成）');
else {console.log('❌ 不是用浮漂位置判定 —— 用户要的是"鱼漂在圈里享受加成"');bad++;}
if(/player\.position|player\.blockPosition/.test(arg)) {console.log('❌ 判定用了玩家位置');bad++;}
console.log(bad===0?'\n✅ 加成判定挂在浮漂上':'\n❌ 有问题');
process.exit(bad?1:0);
