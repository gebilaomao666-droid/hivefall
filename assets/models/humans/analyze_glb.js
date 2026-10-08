// 解析目录下所有 GLB 的 JSON chunk，输出 _analysis.json
const fs=require('fs'),path=require('path');
const dir=__dirname, out={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.glb')).sort()){
  const b=fs.readFileSync(path.join(dir,f));
  if(b.toString('ascii',0,4)!=='glTF'){out[f]={error:'bad magic'};continue;}
  const len=b.readUInt32LE(12); const j=JSON.parse(b.toString('utf8',20,20+len));
  const acc=j.accessors||[];
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],verts=0,tris=0;
  for(const m of j.meshes||[])for(const p of m.primitives){const a=acc[p.attributes.POSITION];if(!a)continue;verts+=a.count;
    if(p.indices!=null)tris+=acc[p.indices].count/3; else tris+=a.count/3;
    if(a.min)for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],a.min[i]);mx[i]=Math.max(mx[i],a.max[i]);}}
  const anims=(j.animations||[]).map(a=>{let d=0;for(const s of a.samplers){const m=acc[s.input].max;if(m&&m[0]>d)d=m[0];}return{name:a.name||'',duration:+d.toFixed(3)};});
  const roots=((j.scenes||[])[j.scene||0]||{}).nodes||[];
  out[f]={size_kb:Math.round(b.length/1024),meshes:(j.meshes||[]).length,materials:(j.materials||[]).length,
    material_names:(j.materials||[]).map(m=>m.name),textures:(j.images||[]).length,skins:(j.skins||[]).length,
    joints:(j.skins||[]).reduce((s,k)=>s+k.joints.length,0),verts,tris:Math.round(tris),
    bbox_local:{min:mn.map(v=>+v.toFixed(2)),max:mx.map(v=>+v.toFixed(2)),size:mx.map((v,i)=>+(v-mn[i]).toFixed(2))},
    root_nodes:roots.map(i=>({name:j.nodes[i].name,scale:j.nodes[i].scale,rotation:j.nodes[i].rotation})),
    node_scales:[...new Set((j.nodes||[]).filter(n=>n.scale).map(n=>n.scale.map(v=>+v.toFixed(3)).join(',')))].slice(0,4),
    animations:anims};
}
fs.writeFileSync(path.join(dir,'_analysis.json'),JSON.stringify(out,null,1));
for(const[f,o]of Object.entries(out))console.log(`${f} | ${o.size_kb}KB m${o.meshes} mat${o.materials} tex${o.textures} skin${o.skins}/${o.joints}j tris${o.tris} size[${o.bbox_local.size}] sc[${o.node_scales.join(' ; ')}]\n   ${o.animations.map(a=>a.name+':'+a.duration).join(', ')}`);
