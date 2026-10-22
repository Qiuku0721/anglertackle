const fs=require('fs'),path=require('path');
const {decodePng,encodePng}=require('./image-to-sprite.js');
const outFile=process.argv[2],SHOW_H=Number(process.argv[3]||240),files=process.argv.slice(4);
const G={'0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11111','00010','00100','00010','00001','10001','01110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','11110','00001','00001','10001','01110'],'6':['00110','01000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00010','01100'],'x':['00000','10001','01010','00100','01010','10001','00000'],'p':['00000','11110','10001','11110','10000','10000','10000'],' ':['00000','00000','00000','00000','00000','00000','00000']};
const cols=files.map(f=>{const img=decodePng(fs.readFileSync(f));let x0=img.w,y0=img.h,x1=-1,y1=-1;
for(let y=0;y<img.h;y++)for(let x=0;x<img.w;x++){if(img.rgba[(y*img.w+x)*4+3]>0){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y;}}
const fw=Math.max(1,x1-x0+1),fh=Math.max(1,y1-y0+1);const crop=Buffer.alloc(fw*fh*4);
for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){const s=((y0+y)*img.w+(x0+x))*4,d=(y*fw+x)*4;crop[d]=img.rgba[s];crop[d+1]=img.rgba[s+1];crop[d+2]=img.rgba[s+2];crop[d+3]=img.rgba[s+3];}
return{f,img,fw,fh,crop,label:path.basename(f,'.png')};});
const GAP=18,PAD=14,LH=26;let W=PAD;for(const c of cols){c.showW=Math.max(1,Math.round(c.fw*(SHOW_H/c.fh)));W+=c.showW+GAP;}W+=PAD-GAP;
const H=LH+SHOW_H+PAD,canvas=Buffer.alloc(W*H*4);
const put=(x,y,r,g,b)=>{if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;canvas[o]=r;canvas[o+1]=g;canvas[o+2]=b;canvas[o+3]=255;};
function text(s,x0,y0,sc,col){let lx=x0;for(const ch of String(s)){const g5=G[ch]||G[' '];for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++){if(g5[gy][gx]!=='1')continue;for(let sy=0;sy<sc;sy++)for(let sx=0;sx<sc;sx++)put(lx+gx*sc+sx,y0+gy*sc+sy,col[0],col[1],col[2]);}lx+=6*sc;}}
let cx=PAD;for(const c of cols){for(let y=0;y<SHOW_H;y++)for(let x=0;x<c.showW;x++){const k=((x>>3)+(y>>3))&1?56:36;put(cx+x,LH+y,k,k,k);}
for(let y=0;y<SHOW_H;y++)for(let x=0;x<c.showW;x++){const sx=Math.min(c.fw-1,Math.floor(x*c.fw/c.showW)),sy=Math.min(c.fh-1,Math.floor(y*c.fh/SHOW_H)),s=(sy*c.fw+sx)*4;if(c.crop[s+3]===0)continue;put(cx+x,LH+y,c.crop[s],c.crop[s+1],c.crop[s+2]);}
const tw=c.label.length*12-2;text(c.label,cx+Math.max(0,Math.floor((c.showW-tw)/2)),5,2,[235,235,235]);cx+=c.showW+GAP;}
fs.writeFileSync(outFile,encodePng(W,H,canvas));console.log('对比图 -> '+outFile+' ('+W+'x'+H+')');
for(const c of cols)console.log('  '+c.label.padEnd(8)+' 前景 '+c.fw+'x'+c.fh+' -> 显示 '+c.showW+'x'+SHOW_H);
