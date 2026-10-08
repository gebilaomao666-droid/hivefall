// assets.js —— 资源注册表：逻辑名 → 模型来源 / clip 映射 / 归一化尺寸 / 调色方案。
// 换美术只改这张表（和 proc/ 下的建模函数）。各 view 只认逻辑名，不认文件名。
//
// 逻辑名约定：
//   unit.<kind>     我方（world.squad.units[].kind）         clip: idle / shoot / walk / die
//   enemy.<kind>    虫（data/enemies.js 的 ENEMY_KINDS）      clip: walk / attack / die (+ emerge)
//   boss.<kind>     Boss（data/bosses.js）                   clip: walk / attack / windup / charge / stun / emerge / burrow / die
//   device.<kind>   布防装置（GDD §13）                       clip: idle / shoot / die
//   summon.<kind>   技能召唤物（world.summons：flagship / robot；ray 是纯特效）   clip: idle / walk / shoot / die
//   prop.*          空投舱等
// 没注册的逻辑名会回落到 'placeholder'（黄黑警示格胶囊），不会报错。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bakeGLTF, bakeGLTFGen, bakeRig, bakeRigGen, createAnimatedInstances, addBlobShadow } from './gpuanim.js'
import { AZ, CZ, makeArmorMaterial, makeChitinMaterial, makeTexturedMaterial, makePlaceholderMaterial } from './materials.js'
import { buildTrooper, buildPsion, buildMortar, buildLancer, buildTitan, buildReaper, buildSkyhook } from './proc/troops.js'
import { buildLing, buildBurster, buildSpitter, buildCrusher, buildHulk, buildWing, buildDigger, buildWarden, buildEgg, buildShieldbug, buildLeaper, buildRavager, buildMatriarch, buildLeviathan, refineRig } from './models/aliens/index.js'
import { buildPod, buildDevice, buildPlaceholder, buildFlagship, buildRobot } from './proc/props.js'
import { DEVICE_BUILDERS, buildDropPod } from './models/world/devices.js'
import { registerHumans } from './models/humans/register.js'
import { registerAI } from './models/ai/register.js'
import { presetClips, breathe, collapse } from './proc/deform.js'
import { ASSET_ROOT, assetUrl } from './base.js'

// ------------------------------------------------------------------ 调色方案
// 每行 [r, g, b（线性空间）, metalness, roughness, emissive]，行号 = zone id（materials.js 的 AZ / CZ）。
export const PALETTES = {
  // 我方：枪灰装甲 + 钴蓝队色 + 青/橙自发光
  'armor.expedition': [
    [0.030, 0.034, 0.042, 0.55, 0.62, 0],    // 0 DARK   内衬 / 橡胶 / 履带
    [0.085, 0.098, 0.125, 0.75, 0.46, 0],    // 1 GUN    枪灰主甲
    [0.200, 0.220, 0.260, 0.75, 0.42, 0],    // 2 PLATE  亮钢甲片
    [0.020, 0.090, 0.420, 0.70, 0.34, 0.05], // 3 TEAM   钴蓝队色
    [0.250, 0.900, 1.000, 0.0, 0.4, 2.2],    // 4 CYAN   发光（目镜 / 反应堆）
    [1.000, 0.420, 0.060, 0.0, 0.4, 3.4],    // 5 ORANGE 发光（枪口 / 排气 / 警示）
    [0.400, 0.150, 0.030, 0.70, 0.40, 0.02], // 6 PAINT  焦橙涂装（焚化兵）。0.52/0.12/0.022 的正红在方阵里成片出现，测试「容易被看成受击变红」：往焦橙、压暗一档
    [0.950, 0.640, 0.220, 1.00, 0.26, 0.06], // 7 GOLD   英雄饰边
  ],
  // 敌方：暗红褐 / 紫黑几丁质 + 熔橙腺体
  'chitin.ember': [
    [0.200, 0.028, 0.018, 0.30, 0.32, 0],    // 0 SHELL  甲壳（暗红褐）
    [0.040, 0.014, 0.026, 0.35, 0.34, 0],    // 1 LIMB   肢体（紫黑）
    [1.000, 0.450, 0.050, 0.0, 0.5, 2.4],    // 2 GLOW   眼 / 腺体
    [0.070, 0.048, 0.032, 0.10, 0.50, 0],    // 3 BONE   骨刃 / 尖刺
    [0.120, 0.028, 0.030, 0.10, 0.28, 0],    // 4 FLESH  软组织
    [0.075, 0.014, 0.040, 0.40, 0.26, 0],    // 5 SHELL2 深色甲壳
    [0.550, 1.000, 0.100, 0.0, 0.4, 2.6],    // 6 GLOW2  第二发光色（酸液 / 脓囊 / 光环）
    [0.160, 0.045, 0.030, 0.0, 0.45, 0.12],  // 7 MEMBRANE 翼膜
  ],
}
/** 在一套基础方案上改几行：palette('chitin.ember', { 2: [...], 6: [...] }) */
export function palette(base, overrides) {
  const rows = (typeof base === 'string' ? PALETTES[base] : base).map((r) => r.slice())
  if (overrides) for (const k in overrides) rows[k] = overrides[k].slice()
  return rows
}
PALETTES['armor.hero'] = palette('armor.expedition', { [AZ.PLATE]: [0.62, 0.64, 0.68, 0.95, 0.24, 0], [AZ.TEAM]: [0.030, 0.110, 0.500, 0.75, 0.3, 0.08] })
PALETTES['armor.psion'] = palette('armor.expedition', { [AZ.DARK]: [0.035, 0.030, 0.075, 0.2, 0.7, 0], [AZ.CYAN]: [0.55, 0.62, 1.0, 0, 0.4, 1.35], [AZ.TEAM]: [0.10, 0.06, 0.42, 0.5, 0.4, 0.08] })
PALETTES['armor.engineer'] = palette('armor.expedition', { [AZ.TEAM]: [0.62, 0.36, 0.03, 0.6, 0.4, 0.03], [AZ.PAINT]: [0.62, 0.36, 0.03, 0.6, 0.4, 0.03] })
// 海量小虫（裂爪虫 / 脓爆虫 / 跳跃虫）：低饱和的暗红褐甲壳 + 紫黑的副甲和肢体，自发光只有眼睛那两点橙光。
// 甲壳偏哑（粗糙度 0.5）、环境反射压到 0.22：原来又亮又滑的壳会把橙色的天空整片反射回来，近看是一层浅驼色。
// 它们要读作一片「暗色潮水」，写实贴图的大虫和 Boss 从里面凸出来 —— 别再往里加亮色 / 大块发光（原来的腺体、脓囊都改成了不发光的软组织色）
PALETTES['chitin.tide'] = palette('chitin.ember', {
  [CZ.SHELL]: [0.058, 0.019, 0.014, 0.25, 0.5, 0], [CZ.SHELL2]: [0.026, 0.012, 0.020, 0.3, 0.46, 0], [CZ.LIMB]: [0.020, 0.010, 0.016, 0.3, 0.5, 0],
  [CZ.BONE]: [0.058, 0.042, 0.030, 0.1, 0.5, 0], [CZ.FLESH]: [0.048, 0.016, 0.016, 0.1, 0.32, 0], [CZ.GLOW]: [1.0, 0.36, 0.04, 0, 0.5, 1.35],
})
PALETTES['chitin.pus'] = palette('chitin.tide', { [CZ.SHELL]: [0.056, 0.025, 0.015, 0.25, 0.5, 0], [CZ.SHELL2]: [0.034, 0.016, 0.015, 0.3, 0.46, 0], [CZ.GLOW2]: [0.150, 0.070, 0.022, 0, 0.3, 0.22] })   // 脓囊：暗赭色，只有一点余温似的微光
PALETTES['chitin.hopper'] = palette('chitin.tide', { [CZ.SHELL]: [0.052, 0.028, 0.017, 0.25, 0.5, 0], [CZ.SHELL2]: [0.030, 0.018, 0.016, 0.3, 0.46, 0] })   // 跳跃虫：偏褐一点，和裂爪虫拉开
PALETTES['chitin.wing'] = palette('chitin.ember', { [CZ.MEMBRANE]: [0.055, 0.018, 0.016, 0, 0.35, 0.04], [CZ.GLOW2]: [1.0, 0.5, 0.06, 0, 0.4, 2.4] })
PALETTES['chitin.acid'] = palette('chitin.ember', { [CZ.SHELL]: [0.11, 0.05, 0.022, 0.3, 0.34, 0], [CZ.SHELL2]: [0.05, 0.026, 0.02, 0.35, 0.3, 0], [CZ.FLESH]: [0.09, 0.045, 0.025, 0.05, 0.3, 0], [CZ.GLOW2]: [0.4, 0.8, 0.08, 0, 0.3, 1.7], [CZ.LIMB]: [0.045, 0.024, 0.02, 0.35, 0.3, 0], [CZ.MEMBRANE]: [0.11, 0.05, 0.022, 0.3, 0.34, 0] })
PALETTES['chitin.heavy'] = palette('chitin.ember', { [CZ.SHELL]: [0.15, 0.03, 0.018, 0.4, 0.3, 0], [CZ.SHELL2]: [0.062, 0.020, 0.014, 0.45, 0.28, 0], [CZ.LIMB]: [0.046, 0.016, 0.012, 0.45, 0.28, 0], [CZ.MEMBRANE]: [0.15, 0.03, 0.018, 0.4, 0.3, 0], [CZ.GLOW]: [1.0, 0.5, 0.06, 0, 0.5, 3.0] })
PALETTES['chitin.hulk'] = palette('chitin.ember', { [CZ.MEMBRANE]: [0.135, 0.030, 0.016, 0.35, 0.28, 0], [CZ.LIMB]: [0.050, 0.018, 0.013, 0.45, 0.26, 0], [CZ.FLESH]: [0.115, 0.034, 0.022, 0.05, 0.28, 0], [CZ.GLOW]: [1.0, 0.5, 0.06, 0, 0.4, 2.6] })
PALETTES['chitin.aura'] = palette('chitin.ember', { [CZ.MEMBRANE]: [0.10, 0.025, 0.04, 0.4, 0.3, 0], [CZ.LIMB]: [0.04, 0.014, 0.034, 0.4, 0.28, 0], [CZ.FLESH]: [0.075, 0.022, 0.04, 0.05, 0.3, 0], [CZ.GLOW2]: [0.45, 0.5, 1.0, 0, 0.4, 2.4], [CZ.GLOW]: [0.6, 0.62, 1.0, 0, 0.5, 2.4] })
// Boss：暗红褐的甲（氧化血色，不是粉红）、近黑的副甲和肢体、象牙褐的骨刺。数值偏暗是有意的：detail 材质上面还罩着一层清漆高光
PALETTES['chitin.boss'] = palette('chitin.ember', { [CZ.SHELL]: [0.135, 0.022, 0.010, 0.35, 0.34, 0], [CZ.SHELL2]: [0.050, 0.014, 0.010, 0.4, 0.32, 0], [CZ.LIMB]: [0.036, 0.012, 0.010, 0.3, 0.4, 0], [CZ.GLOW]: [1.0, 0.36, 0.04, 0, 0.5, 2.6], [CZ.BONE]: [0.15, 0.10, 0.055, 0.0, 0.42, 0], [CZ.FLESH]: [0.095, 0.022, 0.016, 0.05, 0.36, 0] })
PALETTES['chitin.queen'] = palette('chitin.boss', { [CZ.FLESH]: [0.105, 0.030, 0.024, 0.05, 0.3, 0], [CZ.GLOW2]: [0.55, 0.40, 0.04, 0, 0.14, 0.95], [CZ.MEMBRANE]: [0.07, 0.018, 0.016, 0, 0.4, 0.03] })
PALETTES['chitin.worm'] = palette('chitin.boss', { [CZ.SHELL]: [0.090, 0.040, 0.020, 0.35, 0.34, 0], [CZ.SHELL2]: [0.038, 0.020, 0.014, 0.4, 0.32, 0], [CZ.GLOW]: [1.0, 0.40, 0.05, 0, 0.3, 2.4], [CZ.FLESH]: [0.060, 0.018, 0.016, 0.05, 0.34, 0] })

// ------------------------------------------------------------------ 注册表
export const REGISTRY = new Map()
/**
 * def: {
 *   source: { rig: () => Rig }                       程序化：proc/kit.js 的 Rig（几何 + 逐帧姿态函数）
 *         | { gltf: url, bake: {...bakeGLTF 选项} }  骨骼 glb：逐帧 CPU 蒙皮烘成 VAT
 *   scale:      实例缩放（归一化尺寸 = 建模尺寸 × scale；glb 的尺寸在 bake.height/length/width 里定）
 *   clips:      { 逻辑 clip 名: 烘焙出的 clip 名 }，view 只用逻辑名；缺的会回落到 fallbackClip
 *   material:   { type: 'armor'|'chitin', palette: 方案名或 8 行数组, ...着色参数 }
 *   shadow:     { cast: bool（进阴影图，海量小虫不要开）, blob: [sx, sz, opacity, power] 脚下暗斑 }
 *   lerp:       帧间插值（慢动作 / 大单位开；海量小虫关）
 *   capacity:   实例池容量
 *   anim:       各 view 读的表现参数（步幅、开火 clip 是否循环、死亡时长……见各 view）
 *   preload:    false = 不随 createRenderer 预烘焙，第一次用到才加载
 * }
 */
const baked = new Map()      // name -> { def, asset, meta } | Promise（烘焙结果的缓存）
/** 登记 / 覆盖一个逻辑名。后登记的覆盖先登记的；已经烘焙过的同名资源会作废，下次用到时按新的定义重新烘（已经建好的实例池不受影响） */
export function register(name, def) { REGISTRY.set(name, { name, ...def }); baked.delete(name); return def }
export function has(name) { return REGISTRY.has(name) }
export function list(prefix = '') { return [...REGISTRY.keys()].filter((k) => k.startsWith(prefix)) }

const ARM = (o = {}) => ({ type: 'armor', palette: 'armor.expedition', panel: 5, ...o })
const CHI = (o = {}) => ({ type: 'chitin', palette: 'chitin.ember', ...o })
const UNIT_CLIPS = { idle: 'idle', shoot: 'shoot', walk: 'walk', die: 'die' }
const BUG_CLIPS = { walk: 'walk', attack: 'attack', die: 'die' }

// ---- 我方 ----
register('unit.rifle', { label: '突击兵', source: { rig: () => buildTrooper({ weapon: 'rifle' }) }, scale: 1.24, clips: UNIT_CLIPS, material: ARM(), shadow: { cast: true, blob: [1.1, 1.1, 0.5, 2] }, lerp: true, capacity: 128, anim: { shootLoop: true, shootHold: 0.3 } })
register('unit.flamer', { label: '焚化兵', source: { rig: () => buildTrooper({ weapon: 'flamer', pack: 'tanks', accent: AZ.PAINT, bulk: 1.1 }) }, scale: 1.33, clips: UNIT_CLIPS, material: ARM({ key: 'F' }), shadow: { cast: true, blob: [1.2, 1.2, 0.5, 2] }, lerp: true, capacity: 48, anim: { shootLoop: true, shootHold: 0.5 } })
register('unit.psion', { label: '灵能者', source: { rig: () => buildPsion() }, scale: 1.43, clips: UNIT_CLIPS, material: ARM({ palette: 'armor.psion', key: 'P', rim: 0x8a7dff, panel: 0 }), shadow: { cast: true, blob: [1.3, 1.3, 0.4, 2] }, lerp: true, capacity: 12, anim: { shootDur: 0.9 } })
register('unit.mortar', { label: '「雷锤」自行炮', source: { rig: () => buildMortar() }, scale: 1.0, clips: UNIT_CLIPS, material: ARM({ key: 'V', panel: 2.2 }), shadow: { cast: true, blob: [2.6, 3.8, 0.6, 5, 0.04, 0] }, lerp: true, capacity: 12, anim: { shootDur: 0.7, turn: 6 } })
register('unit.lancer', { label: '「破城」轨道炮', source: { rig: () => buildLancer() }, scale: 1.0, clips: UNIT_CLIPS, material: ARM({ key: 'V', panel: 2.2 }), shadow: { cast: true, blob: [2.4, 4.4, 0.6, 5, 0.04, 0.15] }, lerp: true, capacity: 10, anim: { shootDur: 0.5, turn: 6 } })
register('unit.titan', { label: '「泰坦」机甲', source: { rig: () => buildTitan({ racks: true }) }, scale: 1.0, clips: UNIT_CLIPS, material: ARM({ key: 'M', panel: 2.4 }), shadow: { cast: true, blob: [3.4, 2.8, 0.55, 4] }, lerp: true, capacity: 10, anim: { shootDur: 0.55, turn: 5 } })
register('unit.reaper', { label: '「裁决」光束步行机', source: { rig: () => buildReaper() }, scale: 1.0, clips: UNIT_CLIPS, material: ARM({ key: 'M', panel: 2.4 }), shadow: { cast: true, blob: [3.8, 3.4, 0.45, 3] }, lerp: true, capacity: 10, anim: { shootDur: 0.75, turn: 5 } })
register('unit.skyhook', { label: '「天钩」无人机群', source: { rig: () => buildSkyhook() }, scale: 1.0, clips: UNIT_CLIPS, material: ARM({ key: 'V', panel: 2.2 }), shadow: { cast: true, blob: [2.6, 3.0, 0.5, 4] }, lerp: true, capacity: 10, anim: { shootLoop: true, shootHold: 0.8, turn: 0 } })
register('unit.hero_hawk', { label: '「铁砧」霍克上尉', source: { rig: () => buildTrooper({ weapon: 'cannon', crest: true, banner: true, bulk: 1.12 }) }, scale: 1.38, clips: UNIT_CLIPS, material: ARM({ palette: 'armor.hero', key: 'H', rim: 0x49d8ff }), shadow: { cast: true, blob: [1.7, 1.7, 0.5, 2] }, lerp: true, capacity: 2, anim: { shootLoop: true, shootHold: 0.4 }, hero: true })
register('unit.hero_ysera', { label: '「棱镜」伊瑟拉', source: { rig: () => buildPsion({ crest: true }) }, scale: 1.45, clips: UNIT_CLIPS, material: ARM({ palette: palette('armor.psion', { [AZ.PLATE]: [0.62, 0.64, 0.68, 0.95, 0.24, 0] }), key: 'PH', rim: 0xb49bff, panel: 0 }), shadow: { cast: true, blob: [1.7, 1.7, 0.4, 2] }, lerp: true, capacity: 2, anim: { shootDur: 0.9 }, hero: true })
register('unit.hero_joe', { label: '「扳手」老猫', source: { rig: () => buildTitan({ arms: 'drill', accent: AZ.PAINT }) }, scale: 0.78, clips: UNIT_CLIPS, material: ARM({ palette: 'armor.engineer', key: 'MJ', panel: 2.4 }), shadow: { cast: true, blob: [2.8, 2.4, 0.55, 4] }, lerp: true, capacity: 2, anim: { shootDur: 0.55, turn: 5 }, hero: true })
register('unit.goliath', { label: '「歌利亚」巨型机甲', source: { rig: () => buildTitan({ racks: true, accent: AZ.GOLD }) }, scale: 1.45, clips: UNIT_CLIPS, material: ARM({ palette: 'armor.hero', key: 'MG', panel: 1.7 }), shadow: { cast: true, blob: [5, 4, 0.55, 4] }, lerp: true, capacity: 2, anim: { shootDur: 0.55, turn: 4 } })

// ---- 虫 ----（capacity 按 data/enemies.js 的 cap 留余量；stride = 每个步态周期走多远，决定腿的频率）
register('enemy.ling', { label: '裂爪虫', source: { rig: buildLing }, scale: 1.0, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.tide', key: 'S', rimGain: 0.16, fill: 0.14, env: 0.22, purple: 0.75, purpleTone: [0.34, 0.5, 0.46], noiseScale: 6, bandFreq: 30 }), shadow: { blob: [1.0, 1.4, 0.62, 2] }, lerp: false, capacity: 4096, anim: { stride: 2.6, dieDur: 0.45 } })
register('enemy.burster', { label: '脓爆虫', source: { rig: buildBurster }, scale: 1.15, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.pus', key: 'B', rimGain: 0.16, fill: 0.14, env: 0.22, purple: 0, noiseScale: 7, bandFreq: 9 }), shadow: { blob: [1.0, 1.0, 0.6, 2] }, lerp: false, capacity: 200, anim: { stride: 0.8, dieDur: 0.25, sink: false } })
// 中大型虫（同屏几只到几十只）：建模函数外面套 refineRig（Loop 细分一次，面数 ×4，平滑法线 + 不规则起伏），材质走 detail 档（甲片分节 / 凹凸 / 湿润高光）
const BIG = (build, o) => () => refineRig(build(), { levels: 1, disp: 0.035, bend: 0.07, freq: 3.2, ...o })
register('enemy.spitter', { label: '刺脊虫', source: { rig: BIG(buildSpitter, { seed: 1 }) }, scale: 1.0, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.acid', key: 'P', detail: 7, seamGlow: 0.07, bump: 0.012, bandFreq: 16, rimGain: 0.2 }), shadow: { cast: true, blob: [1.2, 2.4, 0.5, 2, 0, -0.18] }, lerp: true, capacity: 64, anim: { stride: 2.4, dieDur: 0.6, attackDur: 0.6 } })
register('enemy.crusher', { label: '甲壳兽', source: { rig: BIG(buildCrusher, { seed: 2 }) }, scale: 0.72, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.heavy', key: 'C', detail: 5.5, seamGlow: 0.08, bump: 0.016, bandFreq: 12 }), shadow: { cast: true, blob: [2.0, 2.6, 0.55, 3] }, lerp: true, capacity: 160, anim: { stride: 2.6, dieDur: 0.8, attackDur: 0.7 } })
register('enemy.hulk', { label: '巨畸体', source: { rig: BIG(buildHulk, { seed: 3, freq: 2.4 }) }, scale: 0.62, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.hulk', key: 'H', detail: 4.5, seamGlow: 0.07, bump: 0.02, bandFreq: 8, rimGain: 0.2 }), shadow: { cast: true, blob: [2.6, 2.2, 0.5, 2] }, lerp: true, capacity: 40, anim: { stride: 2.4, dieDur: 1.1, attackDur: 1.0 } })
register('enemy.wing', { label: '翼螫', source: { rig: buildWing }, scale: 0.9, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.wing', key: 'W', rimGain: 0.2, noiseScale: 6 }), shadow: { blob: [1.8, 1.2, 0.3, 2] }, lerp: false, capacity: 200, anim: { fly: true, dieDur: 0.6 } })
register('enemy.digger', { label: '掘地虫', source: { rig: BIG(buildDigger, { seed: 4, hard: ['mound'] }) }, scale: 0.8, clips: { ...BUG_CLIPS, emerge: 'emerge' }, material: CHI({ palette: 'chitin.heavy', key: 'D', detail: 6, seamGlow: 0.08, bump: 0.014, bandFreq: 10 }), shadow: { cast: true, blob: [1.4, 2.2, 0.5, 2] }, lerp: true, capacity: 48, anim: { stride: 2.2, dieDur: 0.6, attackDur: 0.5 } })
register('enemy.warden', { label: '护巢虫', source: { rig: BIG(buildWarden, { seed: 5 }) }, scale: 0.9, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.aura', key: 'A', rimGain: 0.2, detail: 6, seamGlow: 0.1, bump: 0.014, bandFreq: 10 }), shadow: { cast: true, blob: [1.9, 1.9, 0.45, 2] }, lerp: true, capacity: 32, anim: { stride: 2.4, dieDur: 0.9, aura: 4 } })
register('enemy.egg', { label: '虫卵', source: { rig: buildEgg }, scale: 1.0, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.queen', key: 'E', noiseScale: 6, bandFreq: 8, rimGain: 0.1 }), shadow: { blob: [1.3, 1.3, 0.5, 2] }, lerp: true, capacity: 80, anim: { dieDur: 0.35, sink: false } })
register('enemy.shieldbug', { label: '举盾虫', source: { rig: BIG(buildShieldbug, { seed: 6 }) }, scale: 1.15, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.heavy', key: 'SB', detail: 7, seamGlow: 0.08, bump: 0.012, bandFreq: 12 }), shadow: { cast: true, blob: [1.3, 1.7, 0.5, 2] }, lerp: true, capacity: 96, anim: { stride: 2.2, dieDur: 0.6 } })
register('enemy.leaper', { label: '跳跃虫', source: { rig: buildLeaper }, scale: 1.2, clips: BUG_CLIPS, material: CHI({ palette: 'chitin.hopper', key: 'L', rimGain: 0.16, fill: 0.14, env: 0.22, purple: 0 }), shadow: { blob: [0.8, 1.3, 0.45, 2] }, lerp: false, capacity: 300, anim: { stride: 3.2, dieDur: 0.45 } })

// ---- Boss ----（归一化：模型建模宽度 ≈ 2 × data/bosses.js 的 radius × 1.7）
const BOSS_CLIPS = { walk: 'walk', attack: 'attack', windup: 'windup', charge: 'charge', stun: 'stun', die: 'die', emerge: 'emerge', burrow: 'burrow' }
// Boss：同样细分一次（面数到 1 万上下）；甲片更大、凹凸更深、接缝里渗腺体的光
register('boss.ravager', { label: '「碾压者」', source: { rig: BIG(buildRavager, { seed: 7, freq: 1.1, disp: 0.04 }) }, scale: 1.15, clips: BOSS_CLIPS, material: CHI({ palette: 'chitin.boss', key: 'BR', detail: 1.7, bump: 0.05, bandFreq: 4.5, seamGlow: 0.45, rimGain: 0.42, fill: 0.34 }), shadow: { cast: true, blob: [5.2, 8.0, 0.5, 3] }, lerp: true, capacity: 2, anim: { attackDur: 0.9, dieDur: 1.6, stride: 5 } })
register('boss.matriarch', { label: '「巢母」', source: { rig: BIG(buildMatriarch, { seed: 8, freq: 0.9, disp: 0.03 }) }, scale: 1.0, clips: BOSS_CLIPS, material: CHI({ palette: 'chitin.queen', key: 'BM', detail: 1.5, bump: 0.05, bandFreq: 3.5, seamGlow: 0.35, rimGain: 0.42, fill: 0.34 }), shadow: { cast: true, blob: [6.4, 10.5, 0.5, 3, 0, -0.16] }, lerp: true, capacity: 2, anim: { attackDur: 0.5, dieDur: 1.6, stride: 5 } })
register('boss.leviathan', { label: '「渊噬蠕虫」', source: { rig: BIG(buildLeviathan, { seed: 9, freq: 1.0, disp: 0.03, hard: ['root'] }) }, scale: 1.0, clips: BOSS_CLIPS, material: CHI({ palette: 'chitin.worm', key: 'BL', detail: 1.6, bump: 0.05, bandFreq: 0.1, seamGlow: 0.36, rimGain: 0.42, fill: 0.34 }), shadow: { cast: true, blob: [5.8, 5.8, 0.5, 2] }, lerp: true, capacity: 2, anim: { attackDur: 0.8, dieDur: 1.6, emergeDur: 0.45, burrowDur: 0.4 } })

// ---- 空投舱 / 装置 ----
// 装置：枪灰 + 工程黄警示条（和部队的钴蓝队色区分开）；个别装置再改一两行（地雷的武装灯、冷凝塔的白罐）
PALETTES['armor.device'] = palette('armor.expedition', { [AZ.PLATE]: [0.26, 0.28, 0.31, 0.75, 0.4, 0], [AZ.TEAM]: [0.70, 0.43, 0.035, 0.6, 0.4, 0.04], [AZ.PAINT]: [0.80, 0.50, 0.03, 0.55, 0.42, 0.05] })
const DEVICE_DEFS = {
  collector: { label: '采集器', palette: palette('armor.device', { [AZ.TEAM]: [0.03, 0.30, 0.34, 0.7, 0.35, 0.06], [AZ.CYAN]: [0.30, 1.0, 0.85, 0, 0.3, 2.6] }), clips: { idle: 'idle', shoot: 'shoot', die: 'die' }, blob: [2.0, 2.0, 0.45, 3] },
  sentry: { label: '哨戒机枪塔', clips: { idle: 'idle', aim: 'aim', shoot: 'shoot', die: 'die' }, blob: [1.9, 2.2, 0.5, 3] },
  barricade: { label: '合金路障', clips: { idle: 'idle', shoot: 'shoot', die: 'die' }, blob: [2.7, 1.5, 0.5, 5] },
  mine: { label: '感应地雷', palette: palette('armor.device', { [AZ.CYAN]: [1.0, 0.07, 0.04, 0, 0.4, 3.6], [AZ.ORANGE]: [1.0, 0.55, 0.06, 0, 0.4, 2.2] }), clips: { idle: 'idle', armed: 'armed', die: 'die' }, blob: [1.2, 1.2, 0.4, 2], cast: false },
  cryo: { label: '冷凝塔', palette: palette('armor.device', { [AZ.PAINT]: [0.62, 0.78, 0.92, 0.35, 0.3, 0.12], [AZ.TEAM]: [0.04, 0.26, 0.62, 0.7, 0.35, 0.08], [AZ.CYAN]: [0.45, 0.95, 1.0, 0, 0.3, 2.8] }), clips: { idle: 'idle', aim: 'aim', shoot: 'shoot', die: 'die' }, blob: [1.9, 1.9, 0.45, 3] },
  scorcher: { label: '喷火陷阱', palette: palette('armor.device', { [AZ.PAINT]: [0.62, 0.13, 0.02, 0.6, 0.4, 0.05] }), clips: { idle: 'idle', shoot: 'shoot', die: 'die' }, blob: [2.3, 1.9, 0.5, 5] },
  mortarpit: { label: '迫击炮台', clips: { idle: 'idle', aim: 'aim', shoot: 'shoot', die: 'die' }, blob: [2.3, 2.3, 0.5, 3] },
  nova: { label: '聚变炸弹', palette: palette('armor.device', { [AZ.ORANGE]: [1.0, 0.30, 0.04, 0, 0.4, 4.2] }), clips: { idle: 'idle', die: 'die' }, blob: [1.7, 1.7, 0.45, 3] },
}
register('prop.pod', { label: '空投舱', source: { rig: buildDropPod }, scale: 1.22, clips: { idle: 'idle', die: 'die' }, material: ARM({ palette: 'armor.engineer', key: 'V', panel: 2.2 }), shadow: { cast: true, blob: [3.0, 3.0, 0.5, 2] }, lerp: true, capacity: 12 })
for (const k in DEVICE_DEFS) {
  const d = DEVICE_DEFS[k]
  register('device.' + k, { label: d.label, source: { rig: DEVICE_BUILDERS[k] }, scale: 1.0, clips: d.clips, material: ARM({ palette: d.palette || 'armor.device', key: 'V', panel: 2.2 }), shadow: { cast: d.cast !== false, blob: d.blob }, lerp: true, capacity: k === 'mine' ? 48 : 24 })
}

// ---- 技能召唤物 ----
register('summon.flagship', { label: '旗舰「不屈号」', source: { rig: buildFlagship }, scale: 1.0, clips: { idle: 'idle', shoot: 'shoot', die: 'die' }, material: ARM({ key: 'V', panel: 1.2 }), shadow: { cast: true, blob: [6, 10, 0.35, 3] }, lerp: true, capacity: 2 })
register('summon.robot', { label: '铁罐机器人', source: { rig: buildRobot }, scale: 1.0, clips: { idle: 'idle', walk: 'walk', shoot: 'shoot', die: 'die' }, material: ARM({ palette: 'armor.engineer', key: 'V', panel: 2.2 }), shadow: { cast: true, blob: [1.4, 1.4, 0.5, 2] }, lerp: true, capacity: 16 })

// ---- 我方单位正式造型（models/humans/）：覆盖上面同名的 unit.* / summon.robot，并追加雇佣兵 / 伙伴无人机 ----
registerHumans({ register, palette, PALETTES })
registerAI({ register, REGISTRY })   // AI 生成的带贴图模型（models/ai/）：覆盖同名的中大型虫和 Boss；?ai=0 退回程序化模型

// ---- 占位 ----
register('placeholder', { label: '未注册（占位）', source: { rig: buildPlaceholder }, scale: 1.0, clips: { idle: 'idle' }, material: { type: 'placeholder' }, shadow: { blob: [1, 1, 0.5, 2] }, lerp: false, capacity: 256 })

// ---- 骨骼 glb 方式的示例（CC0，Quaternius）。不随启动预烘焙；?focus=enemy.spider_glb 可检视。----
register('enemy.spider_glb', {
  label: '示例：骨骼 glb 烘焙', preload: false,
  source: {
    gltf: ASSET_ROOT + 'models/aliens/spider_animated.glb',
    bake: {
      width: 2.4, smooth: true,
      zoneOf: ({ mat }) => (/001/.test(mat) ? CZ.GLOW : CZ.SHELL),
      clips: [{ name: 'Walk', match: /Spider_Walk$/, frames: 24 }, { name: 'Attack', match: /Spider_Attack$/, frames: 16 }, { name: 'Death', match: /Spider_Death$/, frames: 16, loop: false }],
    },
  },
  scale: 1.0, clips: { walk: 'Walk', attack: 'Attack', die: 'Death' },
  material: CHI({ palette: 'chitin.heavy', key: 'G', noiseScale: 3, bandFreq: 6, veins: 0.8, veinScale: 2.5 }),
  shadow: { cast: true, blob: [2.6, 2.4, 0.5, 2] }, lerp: true, capacity: 32, anim: { stride: 2.4, dieDur: 1.2 },
})

// ---- 骨骼 glb：这两个模型的蒙皮权重里有 NaN（以前烘出来整个是 NaN），bakeGLTF 现在会清洗。留着当回归用例 ----
register('enemy.crab_glb', {
  label: '示例：骨骼 glb（权重带 NaN，已清洗）', preload: false,
  source: { gltf: ASSET_ROOT + 'models/aliens/armored_crab.glb', bake: { width: 2.2, smooth: true, zoneOf: ({ mat }) => (/Black/.test(mat) ? CZ.LIMB : /White/.test(mat) ? CZ.BONE : /Dark/.test(mat) ? CZ.SHELL2 : CZ.SHELL), clips: [{ name: 'Walk', match: /Walk$/, frames: 16 }, { name: 'Attack', match: /Bite_Front$/, frames: 12 }, { name: 'Death', match: /Death$/, frames: 12, loop: false }] } },
  scale: 1.0, clips: { walk: 'Walk', attack: 'Attack', die: 'Death' }, material: CHI({ palette: 'chitin.heavy', key: 'G2', noiseScale: 4, bandFreq: 8 }),
  shadow: { cast: true, blob: [2.4, 2.0, 0.5, 2] }, lerp: true, capacity: 16, anim: { stride: 2.0, dieDur: 0.8 },
})
register('enemy.wasp_glb', {
  label: '示例：骨骼 glb（权重带 NaN，已清洗）', preload: false,
  source: { gltf: ASSET_ROOT + 'models/aliens/flyer_wasp.glb', bake: { width: 1.8, smooth: true, zoneOf: ({ mat }) => (/Black/.test(mat) ? CZ.LIMB : /Blue/.test(mat) ? CZ.MEMBRANE : /Orange/.test(mat) ? CZ.GLOW : CZ.SHELL), clips: [{ name: 'Walk', match: /Flying$/, frames: 16 }, { name: 'Attack', match: /Attack$/, frames: 12 }, { name: 'Death', match: /Death$/, frames: 12, loop: false }] } },
  scale: 1.0, clips: { walk: 'Walk', attack: 'Attack', die: 'Death' }, material: CHI({ palette: 'chitin.wing', key: 'G3', noiseScale: 5 }),
  shadow: { blob: [1.6, 1.2, 0.3, 2] }, lerp: true, capacity: 16, anim: { fly: true, dieDur: 0.75 },
})

// ---- 静态带贴图的 glb + 程序化姿态：AI 生成的模型（没有骨骼、自带贴图）走这条路。做法见 docs/RENDER.md §2.3 ----
register('enemy.beetle_glb', {
  label: '示例：静态带贴图 glb + 程序化姿态', preload: false,
  source: {
    gltf: ASSET_ROOT + 'models/aliens/static_beetle.glb',
    bake: {
      length: 1.7, yaw: Math.PI, smooth: true,                    // 归一化到身长 1.7 米；这个模型原本朝 -Z，转 180° 让它朝 +Z
      clips: presetClips('crawler', { walkDur: 0.8 }),            // walk（分段蛇形摆动 + 起伏 + 摇摆）/ attack（后仰再前扑）/ die（侧翻瘫扁）
    },
  },
  scale: 1.0, clips: { walk: 'walk', attack: 'attack', die: 'die' },
  material: { type: 'textured', roughness: 0.42, metalness: 0.2, rimGain: 0.22, fill: 0.16 },   // 颜色 / 法线 / 粗糙度贴图都取 glb 自己的
  shadow: { cast: true, blob: [1.5, 1.9, 0.5, 2] }, lerp: true, capacity: 32, anim: { stride: 1.7, dieDur: 0.7, attackDur: 0.6 },
})
register('enemy.egg_glb', {
  label: '示例：静态带贴图 glb（只有呼吸）', preload: false,
  source: { gltf: ASSET_ROOT + 'models/aliens/prop_egg_textured.glb', bake: { height: 1.1, smooth: true, clips: [
    { name: 'walk', frames: 12, duration: 1.6, loop: true, deform: breathe({ amp: 0.06 }) },
    { name: 'die', frames: 8, duration: 0.35, loop: false, deform: collapse({ roll: 0.3, flat: 0.25, twitch: 0.1 }) },
  ] } },
  scale: 1.0, clips: { walk: 'walk', die: 'die' }, material: { type: 'textured', roughness: 0.3, rimGain: 0.2, gain: 0.3 },
  shadow: { blob: [1.3, 1.3, 0.5, 2] }, lerp: true, capacity: 16, anim: { dieDur: 0.35, sink: false },
})
// 骨骼 + 贴图（调色板图集）的 glb：UV 和贴图也一起保留
register('enemy.giant_glb', {
  label: '示例：骨骼 + 贴图 glb', preload: false,
  source: { gltf: ASSET_ROOT + 'models/aliens/brute_giant.glb', bake: { height: 2.6, smooth: true, clips: [{ name: 'Walk', match: /Walk$/, frames: 20 }, { name: 'Attack', match: /(Punch|Attack)/, frames: 14 }, { name: 'Death', match: /Death$/, frames: 14, loop: false }] } },
  scale: 1.0, clips: { walk: 'Walk', attack: 'Attack', die: 'Death' }, material: { type: 'textured', roughness: 0.5, rimGain: 0.2, gain: 0.55 },
  shadow: { cast: true, blob: [2.2, 2.0, 0.5, 2] }, lerp: true, capacity: 16, anim: { stride: 2.4, dieDur: 1.0 },
})

// ------------------------------------------------------------------ 加载 / 烘焙 / 建池
const gltfLoader = new GLTFLoader()
const warned = new Set()

export function resolveName(name) {
  if (REGISTRY.has(name)) return name
  if (!warned.has(name)) { warned.add(name); console.info(`[assets] "${name}" 未注册，使用占位体`) }
  return 'placeholder'
}
/** 同步取已烘焙的资源；程序化来源会当场烘焙（几毫秒到几十毫秒），glb 来源没加载完返回 null */
export function getBaked(name) {
  name = resolveName(name)
  const hit = baked.get(name)
  if (hit && !(hit instanceof Promise)) return hit
  if (hit) return null                // 正在（分片）烘焙：别在这里再同步烘一遍
  const def = REGISTRY.get(name)
  if (def.source.rig) {
    const t0 = performance.now()
    const rig = def.source.rig()
    const rec = { def, asset: bakeRig(rig), meta: rig.meta || {}, ms: 0 }
    rec.ms = performance.now() - t0
    baked.set(name, rec)
    return rec
  }
  if (!hit) loadAsset(name)
  return null
}
/**
 * 异步加载并烘焙（glb 来源要走这条）。
 * runner（可选）：runner(生成器) → Promise<结果>。给了就分步烘焙（bakeGLTFGen / bakeRigGen 每 yield 一次是一步），
 * 由 runner 决定每帧做几步——渲染层用它把几百毫秒的烘焙摊到很多帧里（见 renderer.js 的调度泵）。不给就当场一口气烘完
 */
export function loadAsset(name, runner) {
  name = resolveName(name)
  const hit = baked.get(name)
  if (hit) return Promise.resolve(hit)
  const def = REGISTRY.get(name)
  if (!runner) runner = defaultRunner
  if (def.source.rig) {
    if (!runner) return Promise.resolve(getBaked(name))
    // 程序化来源也分步烘：搭骨架 / 几何（rig()）是一整步，逐帧采样和写贴图按帧切
    let ms = 0, meta = {}
    const timed = (it) => (function* () { for (;;) { const a = performance.now(); const r = it.next(); ms += performance.now() - a; if (r.done) return r.value; yield r.value } })()
    const p = runner(timed((function* () { const rig = def.source.rig(); meta = rig.meta || {}; yield; return yield* bakeRigGen(rig) })())).then((asset) => {
      const rec = { def, asset, meta, ms }
      baked.set(name, rec)
      return rec
    })
    baked.set(name, p)
    return p
  }
  const p = gltfLoader.loadAsync(assetUrl(def.source.gltf)).then(async (gltf) => {
    const t0 = performance.now()
    let ms = 0
    const timed = (it) => (function* () { for (;;) { const a = performance.now(); const r = it.next(); ms += performance.now() - a; if (r.done) return r.value; yield r.value } })()
    const asset = runner ? await runner(timed(bakeGLTFGen(gltf, def.source.bake))) : bakeGLTF(gltf, def.source.bake)
    const rec = { def, asset, meta: def.meta || {}, ms: runner ? ms : performance.now() - t0 }     // 分步时只算真正干活的时间
    baked.set(name, rec)
    return rec
  }).catch((err) => {
    console.warn(`[assets] "${name}" 加载失败，改用占位体：`, err.message || err)
    const rec = { ...getBaked('placeholder'), def: { ...REGISTRY.get('placeholder'), name } }
    baked.set(name, rec)
    return rec
  })
  baked.set(name, p)
  return p
}
/** 不带 runner 的 loadAsset（例如头像出图时顺手要的模型）也分步烘：渲染层的后台补加载期间把它的 runner 设进来；null = 一口气烘 */
let defaultRunner = null
export function setDefaultRunner(fn) { defaultRunner = typeof fn === 'function' ? fn : null }
export function preloadAll(filter) {
  const names = [...REGISTRY.values()].filter((d) => d.preload !== false && (!filter || filter(d.name))).map((d) => d.name)
  return Promise.all(names.map((n) => loadAsset(n)))
}
export function bakeStats() { const out = {}; for (const [k, v] of baked) if (!(v instanceof Promise)) out[k] = { ms: +v.ms.toFixed(1), tris: v.asset.triCount, verts: v.asset.vertexCount, frames: v.asset.frameCount }; return out }

/**
 * 建一个实例池。ctx: { envMap, uTime, rim: { armor:{value:Color}, chitin:{value:Color} }, scene, materials:[] }
 * 返回 { inst(AnimatedInstances), def, meta, clip(逻辑名) -> 烘焙 clip 名 | null }；glb 还没到时返回 null。
 */
export function createPool(name, ctx, capacity, opts) {
  const rec = getBaked(name)
  if (!rec) return null
  const { def, asset, meta } = rec
  const m = def.material || { type: 'placeholder' }
  let mat
  if (m.type === 'armor') mat = makeArmorMaterial(ctx.envMap, { ...m, palette: palette(m.palette), uTime: ctx.uTime, uRimCol: m.rim == null ? ctx.rim.armor : undefined })
  else if (m.type === 'chitin') mat = makeChitinMaterial(ctx.envMap, { ...m, palette: palette(m.palette), uTime: ctx.uTime, uRimCol: m.rim == null ? ctx.rim.chitin : undefined, noiseTex: ctx.noise })
  else if (m.type === 'textured') mat = makeTexturedMaterial(ctx.envMap, { ...(asset.maps || {}), ...m, uTime: ctx.uTime, uRimCol: m.rim == null ? (m.team === 'armor' ? ctx.rim.armor : ctx.rim.chitin) : undefined })
  else mat = makePlaceholderMaterial()
  const sh = def.shadow || {}
  const inst = createAnimatedInstances({ asset, capacity: capacity || def.capacity || 16, material: mat.material, fragment: mat.fragment, key: mat.key + (m.panel ?? '') + (m.noiseScale ?? '') + (m.veins ?? '') + (m.bandFreq ?? '') + (m.veinScale ?? '') + (m.bump ?? '') + (m.purple ?? '') + (m.purpleTone ? m.purpleTone.join('_') : ''), lerp: !!def.lerp, castShadow: !!sh.cast })
  inst.mesh.name = name
  const objs = [inst.mesh]
  if (sh.blob) objs.push(addBlobShadow(inst, ...sh.blob))
  for (const o of objs) ctx.scene.add(o)
  if (ctx.materials) ctx.materials.push(mat.material)
  // 渲染层挂的钩子：新池子先藏起来，着色器在驱动后台线程编好了再亮（不然第一次画它的那一帧要同步等编译 50~100ms）
  if (ctx.onPoolCreated && !(opts && opts.noHook)) ctx.onPoolCreated(objs, name)
  const clipOf = (logical) => { const c = def.clips && def.clips[logical]; return c && asset.clips[c] ? c : null }
  const first = Object.keys(asset.clips)[0]
  return { name, inst, def, meta, asset, objs, scale: def.scale ?? 1, anim: def.anim || {}, clip: clipOf, clipOr: (logical, fb) => clipOf(logical) || clipOf(fb) || first }
}
