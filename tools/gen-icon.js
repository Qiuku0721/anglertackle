// 生成模组图标 icon.png（mods.toml 里 logoFile 指向它）。
// 之前缺这个文件 —— 对方在 PCL2/模组列表里会看到空图标位。
//
// 做法：64x64 的竿贴图放大 2 倍（最近邻，保持像素风）居中放到 128x128 画布，
// 底下垫一个圆角深色底 + 一道水面色带，让它在小尺寸下也认得出。
const {decodePng,encodePng}=require('./image-to-sprite.js');const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const S=128, Z=2;
const out=Buffer.alloc(S*S*4);

const put=(x,y,r,g,b,a)=>{ if(x<0||y<0||x>=S||y>=S)return;
  const o=(y*S+x)*4; out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=a; };

// 1) 底：竖向渐变（上深蓝 -> 下青）
for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const t=y/(S-1);
  const r=Math.round(18+t*10), g=Math.round(38+t*70), b=Math.round(60+t*80);
  put(x,y,r,g,b,255);
}
// 2) 水面色带（让画面有层次）
for(let y=Math.round(S*0.62);y<Math.round(S*0.70);y++)for(let x=0;x<S;x++){
  const t=(y-S*0.62)/(S*0.08);
  put(x,y,120+Math.round(t*60),200+Math.round(t*40),230+Math.round(t*25),255);
}
// 3) 四个角做圆角（挖掉），PCL2 会按圆角显示
const R=14;
for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const cx=x<R?R:(x>S-1-R?S-1-R:x), cy=y<R?R:(y>S-1-R?S-1-R:y);
  if(Math.hypot(x-cx,y-cy)>R+0.5) put(x,y,0,0,0,0);
}
// 4) 竿贴图放大 2 倍居中
const rod=decodePng(fs.readFileSync(path.join(ROOT,
  'src/main/resources/assets/anglertackle/textures/item/netherite_lure_rod.png')));
const rw=rod.w*Z, rh=rod.h*Z;
const ox=Math.round((S-rw)/2), oy=Math.round((S-rh)/2)-2;
for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){
  const sx=Math.floor(x/Z), sy=Math.floor(y/Z);
  const s=(sy*rod.w+sx)*4;
  if(rod.rgba[s+3]===0)continue;
  put(ox+x,oy+y,rod.rgba[s],rod.rgba[s+1],rod.rgba[s+2],255);
}
fs.writeFileSync(path.join(ROOT,'src/main/resources/icon.png'),encodePng(S,S,out));
console.log('已生成 src/main/resources/icon.png  '+S+'x'+S);
