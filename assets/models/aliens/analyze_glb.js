// 解析 GLB 的 JSON chunk，输出模型统计。用法: node analyze_glb.js <dir> [out.json]
const fs=require('fs'),path=require('path');
function parse(file){
  const b=fs.readFileSync(file);
  if(b.toString('ascii',0,4)!=='glTF') throw new Error('bad magic');
  const total=b.readUInt32LE(8); if(total!==b.length) throw new Error('length mismatch '+total+' vs '+b.length);
  const jl=b.readUInt32LE(12); if(b.readUInt32LE(16)!==0x4E4F534A) throw new Error('no JSON chunk');
  const g=JSON.parse(b.toString('utf8',20,20+jl));
  const acc=g.accessors||[];
  let tris=0,verts=0,mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(const m of g.meshes||[])for(const p of m.primitives){
    const pa=acc[p.attributes.POSITION]; if(!pa)continue; verts+=pa.count;
    const mode=p.mode===undefined?4:p.mode;
    if(mode===4) tris+=(p.indices!==undefined?acc[p.indices].count:pa.count)/3;
    if(pa.min&&pa.max)for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],pa.min[i]);mx[i]=Math.max(mx[i],pa.max[i]);}
  }
  const anims=(g.animations||[]).map((a,i)=>{let d=0;for(const s of a.samplers){const ia=acc[s.input];if(ia&&ia.max)d=Math.max(d,ia.max[0]);}
    return {name:a.name||('anim_'+i),duration:+d.toFixed(3)};});
  // 根节点缩放(蒙皮模型常见 100x armature 缩放)
  const scales=(g.nodes||[]).filter(n=>n.scale&&n.scale.some(v=>Math.abs(v-1)>1e-3)).slice(0,3).map(n=>n.name+':'+n.scale.map(v=>+v.toFixed(3)).join(','));
  const r=v=>+v.toFixed(3);
  return {size_kb:Math.round(b.length/1024),meshes:(g.meshes||[]).length,materials:(g.materials||[]).length,
    textures:(g.images||[]).length,skinned:(g.skins||[]).length>0,joints:(g.skins||[]).reduce((s,k)=>s+k.joints.length,0),
    triangles:Math.round(tris),vertices:verts,animations:anims,
    bbox:{min:mn.map(r),max:mx.map(r),size:mx.map((v,i)=>r(v-mn[i]))},node_scales:scales,
    extensions:g.extensionsRequired||[]};
}
const dir=process.argv[2]||'.',out={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.glb')).sort()){
  try{out[f]=parse(path.join(dir,f));}catch(e){out[f]={error:e.message};}
  const o=out[f];
  console.log(f.padEnd(34),o.error||`${o.size_kb}KB tris=${o.triangles} mesh=${o.meshes} mat=${o.materials} tex=${o.textures} skin=${o.skinned}(${o.joints}) size=${o.bbox.size.join('x')} sc=[${o.node_scales.join(' ')}] ext=${o.extensions}\n    `+o.animations.map(a=>a.name+'('+a.duration+')').join(', '));
}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
