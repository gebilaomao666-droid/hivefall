// 生成 manifest.json + CREDITS.md（先跑 analyze_glb.js 逻辑）
const fs=require('fs'),path=require('path'),dir=__dirname;
const src=JSON.parse(fs.readFileSync(path.join(dir,'_sources.json')));
const KK='https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/';
for(const [f,n] of [['kaykit_mage.glb','Mage'],['kaykit_rogue_hooded.glb','Rogue_Hooded'],['kaykit_knight.glb','Knight']])
  src[f]={title:'KayKit '+n,page:'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0',url:KK+n+'.glb',author:'Kay Lousberg (KayKit)',license:'CC0 1.0'};
const use=[
 [/^character_soldier/,'1 基础步兵(首选)：Q版持枪士兵，自带枪械mesh；Idle/Run_Gun/Idle_Shoot缺Run_Shoot，用Run_Gun+枪口火光'],
 [/^character_hazmat/,'2 喷火兵/重装步兵(首选)：防化服持枪，有Run_Shoot/Idle_Shoot/Walk_Shoot'],
 [/^character_enemy/,'1/2 步兵变体(红盔)：可染色当精英步兵/爆破兵，动画同hazmat'],
 [/^astronaut_3hC2/,'1 基础步兵候选(写实比例太空服)，有Idle_Gun/Run_Shoot/Gun_Shoot；需另挂枪模型'],
 [/^astronaut_/,'1 步兵候选(动物宇航员，偏卡通)，有Idle_Gun/Run_Gun/Run_Gun_Shoot；风格偏萌，备选'],
 [/^swat/,'3 英雄-队长(首选)：全黑特警装甲，Gun系列动画齐全；也可当重装步兵'],
 [/^sci_fi_character/,'3 英雄-女特工/狙击手(首选,CC-BY需署名)：科幻紧身服女性'],
 [/^soldier_oAAr/,'3 英雄-女特工候选(CC-BY需署名)：女兵，Gun动画齐全'],
 [/^worker_/,'3 英雄-机械师：安全帽工装，Interact/Gun动画'],
 [/^hooded_adventurer/,'3/6 灵能者/英雄候选：兜帽人形，Gun+Sword动画'],
 [/^witch/,'6 灵能/法师候选(CC-BY需署名)：尖帽紫袍女性'],
 [/^animated_wizard/,'6 灵能/法师(CC-BY需署名)：Spell1/Spell2/Staff_Attack施法动画'],
 [/^kaykit_mage/,'6 灵能/法师(首选,CC0)：带袍带帽，Spellcast_* 施法动画齐全；3.5MB略超标'],
 [/^kaykit_rogue/,'3/6 兜帽特工/灵能刺客候选，含1H/2H_Ranged_Shoot射击动画'],
 [/^kaykit_knight/,'2 重装步兵候选(重甲)，含Ranged射击动画；中世纪风需换色'],
 [/^mech_/,'4 中型步行机甲(Quaternius Animated Mech/Space Kit，动物驾驶员)：Idle/Walk/Run/Shoot_Big/Shoot_Small/Death；放大3x可当5巨型机甲'],
 [/^robot_enemy_large_gun/,'5 巨型机甲/重型机器人候选：大型持炮机器人，Shoot/Attack/Walk；也可当4'],
 [/^robot_enemy_large/,'4/5 重型机器人(无炮版)'],
 [/^robot_enemy_flying_gun/,'7 无人机(带枪，首选)：Idle/Run/Shoot'],
 [/^robot_enemy_flying/,'7 无人机(无枪)'],
 [/^robot_enemy_legs_gun/,'7 机器人步兵/双足炮台：Walk/Run/Shoot'],
 [/^robot_enemy/,'7 机器人步兵(基础)：Walk/Run/Shoot/Attack'],
 [/^animated_robot/,'7 机器人步兵候选(RobotExpressive同款)：Running/Punch/Death，无射击动画'],
 [/^characters_(matt|sam|shaun)/,'1/3 Q版持武器人形备选(偏休闲风)，有Idle_Gun/Run_Gun'],
 [/^(adventurer|punk|suit|animated_woman|character_animated)/,'3 英雄/平民备选人形，Gun动画齐全(character_animated除外)'],
 [/^static\//,'5 巨型机甲外观候选(静态无骨骼，CC-BY需署名)：需程序化动画(上下浮动/炮口闪光)或仅作远景/Boss友军'],
];
const out=[],an={};
function scan(sub){for(const f of fs.readdirSync(path.join(dir,sub)).filter(f=>f.endsWith('.glb')).sort()){
  const rel=sub?sub+'/'+f:f; const b=fs.readFileSync(path.join(dir,rel));
  if(b.toString('ascii',0,4)!=='glTF'||b.readUInt32LE(8)!==b.length){console.log('INVALID',rel);continue;}
  const j=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12))),acc=j.accessors||[];
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],tris=0;
  for(const m of j.meshes||[])for(const p of m.primitives){const a=acc[p.attributes.POSITION];if(!a)continue;tris+=(p.indices!=null?acc[p.indices].count:a.count)/3;if(a.min)for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],a.min[i]);mx[i]=Math.max(mx[i],a.max[i]);}}
  const size=mx.map((v,i)=>+(v-mn[i]).toFixed(3));
  const s100=(j.nodes||[]).some(n=>n.scale&&Math.abs(n.scale[0]-100)<1e-3);
  const anims=(j.animations||[]).map(a=>{let d=0;for(const s of a.samplers){const m=acc[s.input].max;if(m&&m[0]>d)d=m[0];}return{name:a.name||'',duration:+d.toFixed(3)};});
  const s=src[f]||{}; const u=(use.find(([r])=>r.test(rel))||[,''])[1];
  out.push({file:rel,name:s.title||f,source_url:s.page||'',download_url:s.url||'',author:s.author||'',license:s.license||'',
    animations:anims,bbox:{local_min:mn.map(v=>+v.toFixed(3)),local_max:mx.map(v=>+v.toFixed(3)),local_size:size,
      est_world_size:size.map(v=>+(v*(s100?100:1)).toFixed(2)),note:s100?'mesh局部坐标×骨架节点scale 100估算；轴向可能未含根节点旋转，运行时请用Box3归一化':'局部坐标，运行时请用Box3归一化'},
    size_kb:Math.round(b.length/1024),meshes:(j.meshes||[]).length,materials:(j.materials||[]).length,textures:(j.images||[]).length,
    skinned:(j.skins||[]).length>0,joints:(j.skins||[]).reduce((a,k)=>Math.max(a,k.joints.length),0),tris:Math.round(tris),suggested_use:u});
}}
scan('');scan('static');
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(out,null,1));
let md='# CREDITS — assets/models/humans\n\n所有模型均为可自由再分发授权（CC0 或 CC-BY 3.0）。CC-BY 条目在发布时必须在游戏内/Credits 页署名。\n\n| 文件 | 名称 | 作者 | 授权 | 来源 |\n|---|---|---|---|---|\n';
for(const o of out)md+=`| ${o.file} | ${o.name} | ${o.author} | ${o.license} | ${o.source_url} |\n`;
md+='\n## 授权链接\n- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/\n- CC-BY 3.0: https://creativecommons.org/licenses/by/3.0/\n\n## 署名文本（CC-BY 条目）\n';
for(const o of out.filter(o=>/BY/.test(o.license)))md+=`- "${o.name}" by ${o.author} (${o.source_url}), licensed under CC-BY 3.0, via Poly Pizza\n`;
md+='\nQuaternius (https://quaternius.com) 与 Kay Lousberg / KayKit (https://kaylousberg.com) 的 CC0 素材无需署名，此处致谢。\n';
fs.writeFileSync(path.join(dir,'CREDITS.md'),md);
console.log('total',out.length,'animated',out.filter(o=>o.animations.length).length,'CC0 animated',out.filter(o=>o.animations.length&&/CC0/.test(o.license)).length,'no-use',out.filter(o=>!o.suggested_use).map(o=>o.file),'nosrc',out.filter(o=>!o.source_url).map(o=>o.file));
for(const o of out)console.log(o.file,o.size_kb+'KB',o.license,'anims',o.animations.length,'est',o.bbox.est_world_size.join('x'));
