// models/humans/register.js —— 我方单位的全部注册项（assets.js 只调用一次 registerHumans）。
// 放在单独文件里，是为了多人同时改 assets.js 时不互相踩；这里后注册的同名项会覆盖 assets.js 里的旧项。
//
// 逻辑名：
//   unit.rifle / flamer / psion / mortar / lancer / titan / reaper / skyhook      常规兵种
//   unit.hero_hawk / hero_ysera / hero_joe                                        三位指挥官
//   unit.goliath                                                                  「歌利亚」巨型机甲（雇佣兵合同）
//   unit.merc_bloodhound / unit.merc_hammer / unit.merc_goliath                   雇佣兵红黑涂装变体（见文末说明）
//   summon.robot                                                                  老猫的铁罐战斗机器人
//   companion.dormant / scout / armed / annihilator                               伙伴无人机「小七」（world.companion.form）
import { AZ } from '../../materials.js'
import { buildArmorTrooper } from './infantry.js'
import { buildPsionic } from './psion.js'
import { buildThunderhammer, buildBreacher, buildSkyhookCarrier } from './vehicles.js'
import { buildTitanMech, buildWrenchWalker, buildArbiter } from './mechs.js'
import { buildCanBot, buildSeven } from './drones.js'

export function registerHumans({ register, palette, PALETTES }) {
  // ---- 调色方案 ----（每行 [r, g, b（线性）, metalness, roughness, emissive]）
  // 第七远征军制式：比基础方案的甲片更亮一档（俯视时靠亮钢 / 队色 / 暗缝三层拉开），自发光压低，方阵里不糊成一片光
  PALETTES['armor.7th'] = palette('armor.expedition', {
    [AZ.DARK]: [0.022, 0.025, 0.032, 0.5, 0.66, 0],
    [AZ.GUN]: [0.034, 0.050, 0.095, 0.6, 0.5, 0],            // 主甲：偏海军蓝的枪灰（整个人读成「蓝」，而不是灰底上两块蓝）
    [AZ.PLATE]: [0.17, 0.20, 0.27, 0.7, 0.46, 0],
    // 队色：饱和的钴蓝 + 一点自发光（< Bloom 阈值，不起光晕）。主机位下方阵靠这一行读成「一片蓝」
    [AZ.TEAM]: [0.006, 0.060, 0.62, 0.15, 0.45, 0.6],         // 金属度压低：当成漆面，不然反射天空的暖色会把蓝冲成灰白
    [AZ.CYAN]: [0.25, 0.9, 1.0, 0, 0.4, 1.7],
    [AZ.ORANGE]: [1.0, 0.42, 0.06, 0, 0.4, 2.0],
    [AZ.PAINT]: [0.42, 0.08, 0.012, 0.7, 0.4, 0.04],
  })
  // 载具 / 机甲：大块顶板（PLATE）在主机位下正对补光，原来那档亮钢在俯视里整块发白发淡蓝（测试「炮车一团淡蓝白」）。
  // 顶板压成深枪灰、主甲去掉海军蓝，蓝色只留 TEAM 条纹 —— 和步兵同一个「暗底 + 钴蓝块」的读法
  PALETTES['armor.7th.vehicle'] = palette('armor.7th', { [AZ.GUN]: [0.040, 0.044, 0.054, 0.65, 0.48, 0], [AZ.PLATE]: [0.085, 0.092, 0.11, 0.75, 0.42, 0], [AZ.TEAM]: [0.006, 0.065, 0.70, 0.15, 0.42, 0.7] })
  PALETTES['armor.7th.hero'] = palette('armor.7th', { [AZ.PLATE]: [0.30, 0.33, 0.40, 0.8, 0.38, 0], [AZ.TEAM]: [0.008, 0.075, 0.72, 0.2, 0.4, 0.7], [AZ.CYAN]: [0.25, 0.9, 1.0, 0, 0.4, 2.0] })
  // 雇佣兵：红黑。红漆放在 GOLD 行（squadview 对雇佣兵的染色只改 TEAM / PAINT，不会把它盖掉），目镜 / 灯改成猩红
  // 测试：雇佣兵正红色、红色泰坦（歌利亚）太抢眼，像受击。改成深黑枪灰主甲（PLATE 0.12 → 0.07 偏冷）+ 暗酒红点缀（0.52 → 0.2、不发光）+ 少量暗橙灯
  PALETTES['armor.merc'] = palette('armor.7th', {
    [AZ.DARK]: [0.012, 0.012, 0.014, 0.5, 0.6, 0],
    [AZ.GUN]: [0.030, 0.031, 0.035, 0.8, 0.4, 0],
    [AZ.PLATE]: [0.068, 0.071, 0.078, 0.85, 0.36, 0],
    [AZ.TEAM]: [0.20, 0.016, 0.012, 0.55, 0.38, 0],
    [AZ.CYAN]: [1.0, 0.42, 0.08, 0, 0.4, 1.3],
    [AZ.ORANGE]: [1.0, 0.38, 0.06, 0, 0.4, 1.6],
    [AZ.PAINT]: [0.20, 0.016, 0.012, 0.55, 0.38, 0],
    [AZ.GOLD]: [0.22, 0.018, 0.012, 0.6, 0.36, 0],
  })

  // rimGain / fill：边缘光和可读性补光比基础材质高一档（对照参考截图 docs/ref/shots/038：蓝色军团在主机位下要一眼可辨）
  const ARM = (o = {}) => ({ type: 'armor', palette: 'armor.7th', panel: 5, rimGain: 0.42, fill: 0.36, ...o })
  const CLIPS = { idle: 'idle', shoot: 'shoot', walk: 'walk', die: 'die' }
  const unit = (name, def) => register(name, { clips: CLIPS, lerp: true, ...def })

  // ---- 步兵 ----
  unit('unit.rifle', { label: '突击兵', source: { rig: () => buildArmorTrooper({ role: 'rifle' }) }, scale: 0.92, material: ARM({ key: 'h7' }), shadow: { cast: true, blob: [1.05, 1.1, 0.55, 2] }, capacity: 128, anim: { shootLoop: true, shootHold: 0.3 } })
  unit('unit.flamer', { label: '焚化兵', source: { rig: () => buildArmorTrooper({ role: 'flamer' }) }, scale: 0.98, material: ARM({ key: 'h7' }), shadow: { cast: true, blob: [1.15, 1.2, 0.55, 2] }, capacity: 48, anim: { shootLoop: true, shootHold: 0.5 } })
  unit('unit.hero_hawk', { label: '「铁砧」霍克上尉', source: { rig: () => buildArmorTrooper({ role: 'hawk' }) }, scale: 1.34, material: ARM({ palette: 'armor.7th.hero', key: 'h7H', rim: 0x49d8ff }), shadow: { cast: true, blob: [1.7, 1.7, 0.5, 2] }, capacity: 2, anim: { shootLoop: true, shootHold: 0.4 }, hero: true })
  unit('unit.merc_bloodhound', { label: '「血獒」雇佣兵', source: { rig: () => buildArmorTrooper({ role: 'merc' }) }, scale: 1.06, material: ARM({ palette: 'armor.merc', key: 'h7R', rim: 0x9aa4b4, rimGain: 0.12 }), shadow: { cast: true, blob: [1.2, 1.2, 0.55, 2] }, capacity: 24, anim: { shootLoop: true, shootHold: 0.3 } })

  // ---- 灵能 ----
  PALETTES['armor.7th.psion'] = palette('armor.7th', { [AZ.DARK]: [0.030, 0.028, 0.070, 0.2, 0.72, 0], [AZ.GUN]: [0.06, 0.06, 0.10, 0.7, 0.45, 0], [AZ.PLATE]: [0.36, 0.37, 0.48, 0.85, 0.32, 0], [AZ.TEAM]: [0.13, 0.09, 0.62, 0.5, 0.4, 0.7], [AZ.CYAN]: [0.45, 0.6, 1.0, 0, 0.4, 1.3] })
  PALETTES['armor.7th.ysera'] = palette('armor.7th.psion', { [AZ.PLATE]: [0.40, 0.42, 0.50, 0.85, 0.34, 0], [AZ.CYAN]: [0.5, 0.64, 1.0, 0, 0.4, 1.2] })
  unit('unit.psion', { label: '灵能者', source: { rig: () => buildPsionic() }, scale: 1.0, material: ARM({ palette: 'armor.7th.psion', key: 'h7P', rim: 0x8a7dff, panel: 0 }), shadow: { cast: true, blob: [1.4, 1.4, 0.4, 2] }, capacity: 12, anim: { shootDur: 0.9 } })
  unit('unit.hero_ysera', { label: '「棱镜」伊瑟拉', source: { rig: () => buildPsionic({ hero: true }) }, scale: 1.3, material: ARM({ palette: 'armor.7th.ysera', key: 'h7PH', rim: 0xb49bff, panel: 0 }), shadow: { cast: true, blob: [1.8, 1.8, 0.4, 2] }, capacity: 2, anim: { shootDur: 0.9 }, hero: true })

  // ---- 载具 ----
  unit('unit.mortar', { label: '「雷锤」自行炮', source: { rig: () => buildThunderhammer() }, scale: 0.82,   /* 0.92 → 0.82：车长 4.4 → 3.9 米，别插进步兵方阵 */ material: ARM({ palette: 'armor.7th.vehicle', key: 'h7Vv', panel: 2.2, fill: 0.26, rimGain: 0.34 }), shadow: { cast: true, blob: [2.7, 4.2, 0.6, 5, 0.04, 0] }, capacity: 12, anim: { shootDur: 0.75, turn: 6 } })
  unit('unit.lancer', { label: '「破城」轨道炮', source: { rig: () => buildBreacher() }, scale: 0.9, material: ARM({ palette: 'armor.7th.vehicle', key: 'h7Vv', panel: 2.2, fill: 0.26, rimGain: 0.34 }), shadow: { cast: true, blob: [3.2, 3.4, 0.5, 3] }, capacity: 10, anim: { shootDur: 0.5, turn: 6 } })
  unit('unit.skyhook', { label: '「天钩」防空无人机母机', source: { rig: () => buildSkyhookCarrier() }, scale: 0.95, material: ARM({ palette: 'armor.7th.vehicle', key: 'h7Vv', panel: 2.2, fill: 0.26, rimGain: 0.34 }), shadow: { cast: true, blob: [3.0, 3.0, 0.4, 3] }, capacity: 10, anim: { shootLoop: true, shootHold: 0.8, turn: 0 } })

  // ---- 步行机 ----
  unit('unit.titan', { label: '「泰坦」机甲', source: { rig: () => buildTitanMech() }, scale: 0.92, material: ARM({ palette: 'armor.7th.vehicle', key: 'h7Mv', panel: 2.4, fill: 0.26, rimGain: 0.34 }), shadow: { cast: true, blob: [3.6, 3.0, 0.55, 4] }, capacity: 10, anim: { shootDur: 0.55, turn: 5 } })
  unit('unit.reaper', { label: '「裁决」光束步行机', source: { rig: () => buildArbiter() }, scale: 0.92, material: ARM({ palette: 'armor.7th.vehicle', key: 'h7Mv', panel: 2.4, fill: 0.26, rimGain: 0.34 }), shadow: { cast: true, blob: [3.8, 3.6, 0.4, 3] }, capacity: 10, anim: { shootDur: 0.75, turn: 5 } })
  PALETTES['armor.7th.engineer'] = palette('armor.7th', { [AZ.TEAM]: [0.70, 0.40, 0.03, 0.6, 0.4, 0.35], [AZ.PAINT]: [0.66, 0.36, 0.025, 0.6, 0.42, 0.3], [AZ.CYAN]: [0.35, 0.95, 1.0, 0, 0.4, 1.4] })
  unit('unit.hero_joe', { label: '「扳手」老猫', source: { rig: () => buildWrenchWalker() }, scale: 1.0, material: ARM({ palette: 'armor.7th.engineer', key: 'h7MJ', panel: 2.4 }), shadow: { cast: true, blob: [3.0, 2.8, 0.55, 4] }, capacity: 2, anim: { shootLoop: true, shootHold: 0.5, turn: 5 }, hero: true })

  // ---- 雇佣兵（红黑）----
  // unit.goliath：mock / 直接按 kind 画的「歌利亚」。sim 里雇佣兵是 kind = rifle / mortar / titan + unit.elite（'bloodhound' | 'hammer' | 'goliath'），
  // squadview 按 'merc_' + unit.elite 取这三个红黑变体（没注册的才退回本兵种模型 + 染橙）。
  const goliath = { label: '「歌利亚」巨型机甲', source: { rig: () => buildTitanMech({ heavy: true, accent: AZ.GOLD }) }, scale: 0.86, material: ARM({ palette: 'armor.merc', key: 'h7MG', panel: 1.7, rim: 0x9aa4b4, rimGain: 0.12 }), shadow: { cast: true, blob: [4.6, 3.6, 0.55, 4] }, capacity: 2, anim: { shootDur: 0.55, turn: 4 } }
  unit('unit.goliath', goliath)
  unit('unit.merc_goliath', goliath)     // squadview 会再乘 ELITE_SCALE.goliath = 1.6，所以基础 scale 压到 0.86（最终 ≈ 1.38）
  unit('unit.merc_hammer', { label: '「重锤」雇佣自行炮', source: { rig: () => buildThunderhammer({ merc: true }) }, scale: 0.82, material: ARM({ palette: 'armor.merc', key: 'h7VR', panel: 2.2, rim: 0x9aa4b4, rimGain: 0.12 }), shadow: { cast: true, blob: [2.7, 4.2, 0.6, 5, 0.04, 0] }, capacity: 6, anim: { shootDur: 0.75, turn: 6 } })

  // ---- 老猫的铁罐机器人（world.summons kind = robot）----
  register('summon.robot', { label: '铁罐机器人', source: { rig: buildCanBot }, scale: 1.0, clips: { idle: 'idle', walk: 'walk', shoot: 'shoot', die: 'die' }, material: ARM({ palette: 'armor.7th.engineer', key: 'h7V', panel: 3 }), shadow: { cast: true, blob: [1.4, 1.4, 0.5, 2] }, lerp: true, capacity: 16 })

  // ---- 伙伴无人机「小七」：逻辑名 companion.<world.companion.form> ----
  const SEVEN = { dormant: ['休眠', 0.9], scout: ['侦察形态', 1.0], armed: ['武装形态', 1.1], annihilator: ['歼灭形态', 1.2] }
  for (const form in SEVEN) {
    register('companion.' + form, { label: '「小七」' + SEVEN[form][0], source: { rig: () => buildSeven(form) }, scale: SEVEN[form][1], clips: { idle: 'idle', walk: 'walk', shoot: 'shoot', pulse: 'pulse', die: 'die' },
      material: ARM({ palette: form === 'dormant' ? palette('armor.7th', { [AZ.CYAN]: [0.25, 0.9, 1.0, 0, 0.4, 0.25], [AZ.ORANGE]: [1.0, 0.42, 0.06, 0, 0.4, 0.3] }) : form === 'annihilator' ? 'armor.7th.hero' : 'armor.7th', key: 'h7C', panel: 0 }),
      shadow: { cast: true, blob: [0.9, 0.9, 0.35, 2] }, lerp: true, capacity: 2, anim: { shootDur: form === 'annihilator' ? 0.5 : 0.3 } })
  }
}
