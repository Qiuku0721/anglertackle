// 把一个鱼种的贴图放大导出，并在每个面矩形上画白色边框，用来核对"哪块像素属于哪个面"
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const ROOT=path.join(__dirname,'..');
const M=require('./fish-model.js');
const id=process.argv[2]||'pike';
const S=M.species[id];
const b=fs.readFileSync(path.join(ROOT,'src/main/resources/assets/anglertackle/textures/entity/fish',id+'.png'));
const w=b.readUInt32BE(16),h=b.readUInt32BE(20);
const idat=[];let p=8;
while(p<b.length){const len=b.readUInt32BE(p),t=b.toString('ascii',p+4,p+8);if(t==='IDAT')idat.push(b.subarray(p+8,p+8+len));p+=12+len;}
const raw=zlib.inflateSync(Buffer.concat(idat));
const px=new Uint8Array(w*h*4);
for(let y=0;y<h;y++) raw.copy(px,y*w*4,y*(w*4+1)+1,y*(w*4+1)+1+w*4);
const K=10, W=w*K, H=h*K;
const out=Buffer.alloc((W*3+1)*H);
for(let y=0;y<H;y++){out[y*(W*3+1)]=0;for(let x=0;x<W;x++){const sx=Math.floor(x/K),sy=Math.floor(y/K);const o=(sy*w+sx)*4;
const c=px[o+3]===0?[30,30,34]:[px[o],px[o+1],px[o+2]];const q=y*(W*3+1)+1+x*3;out[q]=c[0];out[q+1]=c[1];out[q+2]=c[2];}}
// 面边框
for(const part of S.parts){for(const [face,R] of Object.entries(M.facesOf(part,S.texOffs[part.name]))){
  if(R[2]<=0||R[3]<=0)continue;
  const col = face==='west'?[255,0,0]:face==='east'?[0,255,0]:face==='up'?[255,255,0]:face==='down'?[0,255,255]:face==='north'?[255,0,255]:[255,128,0];
  for(let i=0;i<R[2];i++){for(const yy of [R[1],R[1]+R[3]-1]){const X=(R[0]+i)*K,Y=yy*K;if(X<W&&Y<H){const q=Y*(W*3+1)+1+X*3;out[q]=col[0];out[q+1]=col[1];out[q+2]=col[2];}}}
  for(let j=0;j<R[3];j++){for(const xx of [R[0],R[0]+R[2]-1]){const X=xx*K,Y=(R[1]+j)*K;if(X<W&&Y<H){const q=Y*(W*3+1)+1+X*3;out[q]=col[0];out[q+1]=col[1];out[q+2]=col[2];}}}
}}
function crc32(buf){let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);}return (c^0xFFFFFFFF)>>>0;}
function ch(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const ty=Buffer.from(t,'ascii');const c=Buffer.alloc(4);c.writeUInt32BE(crc32(Buffer.concat([ty,d])),0);return Buffer.concat([l,ty,d,c]);}
const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=2;
fs.writeFileSync(path.join(ROOT,'build','atlas-'+id+'.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(out,{level:9})),ch('IEND',Buffer.alloc(0))]));
console.log('-> build/atlas-'+id+'.png  '+W+'x'+H+'  红=west 绿=east 黄=up 青=down 洋红=north 橙=south');
