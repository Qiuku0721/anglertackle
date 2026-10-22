const fs=require('fs');const path=require('path');
const ROOT=path.join(__dirname,'..');
const M=require('./fish-model.js');
const zh=JSON.parse(fs.readFileSync(path.join(ROOT,'src/main/resources/assets/anglertackle/lang/zh_cn.json'),'utf8'));
const L=[];
L.push('# 22 · 鱼类外形自查表');
L.push('');
L.push('> 📌 **开工必读** —— 本文件是《垂纶》策划族的一员。动手前先读 `docs/CONVENTIONS.md`（协作规则 + 每轮自我暗示）与 `docs/接力.md`（接手须知）；项目记忆只认 `docs/` 下的文件。');
L.push('');
L.push('> 用户 2026-10-01 的要求：「弄完的贴图和网上搜对比形状自查」。');
L.push('> 下表把**调研资料里的一句话辨识特征**（`fish_research/<id>.json` 的 `oneLineId`，');
L.push('> 逐条带出处）与**当前模型实际做出来的形状参数**并排放，用来逐条核对差在哪。');
L.push('>');
L.push('> 形状参数的含义见 `docs/21`；改参数请改 `tools/fish-appearance.json`。');
L.push('> 本表由 `tools/gen-selfcheck-doc.js` 生成，不要手改。');
L.push('');
L.push('| 鱼 | 组 | 体长→模型 | 吻 | 尾 | 背鳍 | 臀鳍 | 须 | 鳃裂 | 资料的一句话辨识特征 |');
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const id of Object.keys(M.data.fish)) {
  const j=JSON.parse(fs.readFileSync(path.join(ROOT,'fish_research',id+'.json'),'utf8'));
  const S=M.species[id];
  const s=M.data.fish[id].shape||{};
  const one=String(j.oneLineId||'').replace(/\|/g,'／').slice(0,120);
  L.push('| '+zh['item.anglertackle.'+id]+' `'+id+'` | '+S.group+' | '+S.lengthCm+'cm → '+S.modelLenBlocks+
    ' 格 | '+(s.snoutShape||'普通')+' | '+(s.tailType||'fork')+' | '+(s.dorsalLen||'-')+'@'+(s.dorsalPos||'-')+
    ' | '+(s.analLen||'-')+'@'+(s.analPos||'-')+' | '+(s.barbels||0)+' | '+(s.gillSlits||0)+' | '+one+'… |');
}
fs.writeFileSync(path.join(ROOT,'docs','22-鱼类外形自查表.md'), L.join('\n')+'\n');
console.log('✅ docs/22-鱼类外形自查表.md  ('+Object.keys(M.data.fish).length+' 行)');
