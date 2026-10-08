// models/humans/drones.js —— 老猫的铁罐战斗机器人 + 伙伴无人机「小七」三形态
import { AZ } from '../../materials.js'
import { Rig, V3, box, cbox, slab, prism, tube, lathe, gem, ring, dome, beam, extrudeX, extrudeY, axle, TAU, sin, cos, bump, ease } from './hkit.js'

const PI = Math.PI

// ------------------------------------------------------------------ 铁罐机器人：油桶身子 + 半球顶 + 独眼 + 两条短腿 + 双臂机炮
export function buildCanBot() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 0.62, 0).bone('head', 'body', 0, 1.3, 0)
    .bone('armR', 'body', 0.46, 1.08, 0).bone('armL', 'body', -0.46, 1.08, 0)
    .bone('legR', 'body', 0.22, 0.6, 0).bone('legL', 'body', -0.22, 0.6, 0)
  // 腿：短粗，大脚板
  rig.both('legR', 'legL', AZ.DARK, prism(6, 0.09, 0.1, 0.4, 0.22, 0.18, 0))
  rig.both('legR', 'legL', AZ.GUN, cbox(0.26, 0.16, 0.42, 0.22, 0.08, 0.05, { c: 0.04, taper: [0.85, 0.8] }), cbox(0.2, 0.18, 0.22, 0.22, 0.36, 0.0, { c: 0.04 }))
  rig.both('legR', 'legL', AZ.PLATE, box(0.2, 0.06, 0.12, 0.22, 0.06, 0.25, { taper: [0.8, 0.6] }))
  // 罐身：带箍的油桶，前面一块检修板和警示斜纹
  rig.add('body', AZ.GUN, lathe([[0.0, 0.52], [0.34, 0.54], [0.38, 0.6], [0.38, 1.22], [0.34, 1.28], [0.0, 1.28]], 10))
  rig.add('body', AZ.PLATE, lathe([[0.395, 0], [0.395, 0.05]], 10, { p: [0, 0.74, 0] }), lathe([[0.395, 0], [0.395, 0.05]], 10, { p: [0, 1.1, 0] }))
  rig.add('body', AZ.PAINT, lathe([[0.39, 0], [0.39, 0.2]], 10, { p: [0, 0.85, 0] }))
  for (let i = 0; i < 4; i++) rig.add('body', AZ.DARK, box(0.07, 0.2, 0.03, -0.17 + i * 0.115, 0.95, 0.375, { shear: [0.08, 0] }))
  rig.add('body', AZ.DARK, box(0.3, 0.14, 0.04, 0, 0.64, 0.36), cbox(0.34, 0.4, 0.16, 0, 0.95, -0.4, { c: 0.035 }))   // 下检修口 / 背部电池
  rig.add('body', AZ.ORANGE, box(0.2, 0.04, 0.02, 0, 1.02, -0.485))
  rig.add('body', AZ.DARK, tube(V3(0.2, 1.28, -0.2), V3(0.26, 1.72, -0.26), 0.012, 0.008, 4))
  rig.add('body', AZ.ORANGE, gem(0.03, 0.26, 1.74, -0.26))
  // 头：扁半球 + 独眼
  rig.add('head', AZ.PLATE, dome(0.3, 0.2, 0.3, 0, 1.3, 0, 10, 3))
  rig.add('head', AZ.DARK, prism(10, 0.31, 0.31, 0.04, 0, 1.27, 0), box(0.26, 0.11, 0.06, 0, 1.37, 0.24))
  rig.add('head', AZ.ORANGE, box(0.1, 0.06, 0.03, 0, 1.37, 0.275))
  // 双臂：肩球 + 转管机炮
  rig.both('armR', 'armL', AZ.DARK, axle(0.13, 0.16, 0.42, 1.08, 0, 8))
  rig.both('armR', 'armL', AZ.GUN, cbox(0.2, 0.24, 0.5, 0.54, 1.04, 0.14, { c: 0.04 }))
  rig.both('armR', 'armL', AZ.PAINT, slab(0.16, 0.03, 0.34, 0.54, 1.175, 0.12, { c: 0.02 }))
  rig.both('armR', 'armL', AZ.PLATE, lathe([[0.075, 0], [0.075, 0.36], [0.09, 0.37], [0.09, 0.44], [0.0, 0.44]], 8, { axis: 'z', p: [0.54, 1.04, 0.38] }))
  rig.both('armR', 'armL', AZ.DARK, box(0.1, 0.16, 0.18, 0.54, 0.87, 0.1))
  const waddle = (u, P, amp) => {
    const a = u * TAU, s = sin(a)
    P.r('legR', -0.5 * s * amp, 0, 0).r('legL', 0.5 * s * amp, 0, 0).r('body', 0.04 * amp, 0, 0.09 * cos(a) * amp).t('body', 0, 0.03 * Math.abs(s) * amp, 0)
    P.r('legR', 0, 0, -0.09 * cos(a) * amp).r('legL', 0, 0, -0.09 * cos(a) * amp)
  }
  rig.clip('idle', 8, 1.8, true, (u, P) => { P.r('head', 0, 0.5 * sin(u * TAU), 0).t('body', 0, 0.01 * sin(u * TAU * 2), 0) })
  rig.clip('walk', 10, 0.5, true, (u, P) => waddle(u, P, 1))
  rig.clip('shoot', 8, 0.2, true, (u, P) => {
    const k1 = Math.pow(1 - u, 2), k2 = Math.pow(1 - ((u + 0.5) % 1), 2)
    P.t('armR', 0, 0, -0.08 * k1).t('armL', 0, 0, -0.08 * k2).r('body', -0.03 * (k1 + k2), 0.04 * (k2 - k1), 0)
  })
  rig.clip('die', 10, 0.8, false, (u, P) => {
    const k = ease(u)
    P.r('root', 0, 0, 1.45 * k).t('root', 0.5 * k, 0.1 * bump(u, 0, 0.5), 0).r('head', 0, 1.5 * k, 0).t('head', 0, 0.3 * bump(u, 0, 0.6), 0).r('armR', 0.8 * k, 0, 0).r('armL', -0.5 * k, 0, 0)
  })
  rig.meta = { muzzle: [0.54, 1.04, 0.84], muzzles: [[0.54, 1.04, 0.84], [-0.54, 1.04, 0.84]] }
  return rig
}

// ------------------------------------------------------------------ 伙伴无人机「小七」
// form: 'dormant' 休眠（收拢、灯很暗）/ 'scout' 侦察（球形核心 + 扫描环 + 两片小翼）
//       'armed' 武装（加两侧机炮舱、翼变长）/ 'annihilator' 歼灭（四片刃翼 + 腹部主炮 + 背后能量环）
// 模型原点在悬停高度的正下方地面：核心中心约在 y = 1.0（view 再加 world.companion.y）
export function buildSeven(form = 'scout') {
  const rig = new Rig()
  const CY = 1.0
  const stage = { dormant: 0, scout: 1, armed: 2, annihilator: 3 }[form] ?? 1
  const R = [0.2, 0.22, 0.26, 0.32][stage]
  rig.bone('root', null, 0, 0, 0).bone('core', 'root', 0, CY, 0).bone('eye', 'core', 0, CY, 0).bone('ring', 'core', 0, CY, 0)
    .bone('wingR', 'core', R * 0.8, CY, 0).bone('wingL', 'core', -R * 0.8, CY, 0).bone('gunR', 'core', R, CY - 0.05, 0).bone('gunL', 'core', -R, CY - 0.05, 0)
  // 核心：八面切角的球壳（上下两瓣，中间一道缝）
  rig.add('core', AZ.PLATE, dome(R, R * 0.92, R, 0, CY + 0.015, 0, 8, 3))
  rig.add('core', AZ.GUN, dome(R, R * 0.92, R, 0, CY - 0.015, 0, 8, 3, { r: [PI, 0, 0] }))
  rig.add('core', AZ.DARK, prism(8, R * 0.96, R * 0.96, 0.03, 0, CY - 0.015, 0))
  rig.add('core', AZ.TEAM, slab(R * 0.7, 0.03, R * 1.1, 0, CY + R * 0.86, -R * 0.1, { c: 0.02 }))                       // 顶部队色识别条
  rig.add('core', AZ.ORANGE, box(R * 0.5, 0.03, 0.02, 0, CY - 0.02, -R * 0.97))                                        // 尾灯
  // 眼
  rig.add('eye', AZ.DARK, lathe([[R * 0.5, 0], [R * 0.52, R * 0.22], [R * 0.4, R * 0.26]], 8, { axis: 'z', p: [0, CY, R * 0.74] }))
  rig.add('eye', AZ.CYAN, lathe([[0, 0], [R * 0.38, 0.01], [R * 0.2, R * 0.12], [0, R * 0.14]], 8, { axis: 'z', p: [0, CY, R * 0.92], smooth: true }))
  if (stage === 0) {
    // 休眠：小翼贴身收拢，没有环
    rig.both('wingR', 'wingL', AZ.GUN, box(0.04, R * 1.2, R * 1.0, R * 1.02, CY, -0.02, { taper: [1, 0.6] }))
  } else {
    // 扫描环（横着的一道细环，缓慢转）
    rig.add('ring', AZ.CYAN, ring(R * 1.75, 0.012, 16, 3, { p: [0, CY, 0] }))
    rig.add('ring', AZ.PLATE, cbox(0.07, 0.05, 0.11, R * 1.75, CY, 0, { c: 0.012 }), cbox(0.07, 0.05, 0.11, -R * 1.75, CY, 0, { c: 0.012 }))
    // 翼
    const span = [0, 0.34, 0.5, 0.62][stage]
    rig.both('wingR', 'wingL', AZ.GUN, extrudeY([[R * 0.8, 0.1], [R * 0.8 + span, -0.06], [R * 0.8 + span, -0.2], [R * 0.8, -0.18]], 0.035, CY - 0.0, { bevel: 0.01 }))
    rig.both('wingR', 'wingL', AZ.TEAM, box(span * 0.6, 0.012, 0.05, R * 0.8 + span * 0.5, CY + 0.04, -0.09))
    rig.both('wingR', 'wingL', AZ.CYAN, box(0.03, 0.03, 0.12, R * 0.8 + span, CY + 0.015, -0.13))
  }
  let muzzle = [0, CY, R * 1.1], muzzles
  if (stage >= 2) {   // 两侧机炮舱
    rig.both('gunR', 'gunL', AZ.GUN, cbox(0.14, 0.14, 0.42, R + 0.1, CY - 0.1, 0.06, { c: 0.03 }))
    rig.both('gunR', 'gunL', AZ.PLATE, lathe([[0.035, 0], [0.035, 0.3], [0.05, 0.31], [0.05, 0.38], [0, 0.38]], 6, { axis: 'z', p: [R + 0.1, CY - 0.1, 0.26] }))
    rig.both('gunR', 'gunL', AZ.CYAN, box(0.02, 0.04, 0.2, R + 0.175, CY - 0.1, 0.04))
    muzzles = [[R + 0.1, CY - 0.1, 0.66], [-R - 0.1, CY - 0.1, 0.66]]; muzzle = muzzles[0]
  }
  if (stage >= 3) {
    // 上扬的第二对刃翼 + 腹部主炮 + 背后能量环
    rig.both('wingR', 'wingL', AZ.PLATE, beam(V3(R * 0.7, CY + 0.1, -0.1), V3(R * 0.7 + 0.42, CY + 0.52, -0.3), 0.16, 0.03, { c: 0.01, taper: [0.2, 1], ref: V3(0, 0, 1) }))
    rig.both('wingR', 'wingL', AZ.CYAN, beam(V3(R * 0.7 + 0.1, CY + 0.2, -0.13), V3(R * 0.7 + 0.38, CY + 0.48, -0.27), 0.025, 0.04, { c: 0, ref: V3(0, 0, 1) }))
    rig.add('core', AZ.GUN, cbox(0.2, 0.18, 0.5, 0, CY - R - 0.04, 0.08, { c: 0.04 }))
    rig.add('core', AZ.PLATE, box(0.05, 0.1, 0.5, 0.07, CY - R - 0.04, 0.52), box(0.05, 0.1, 0.5, -0.07, CY - R - 0.04, 0.52))
    rig.add('core', AZ.CYAN, box(0.05, 0.04, 0.46, 0, CY - R - 0.04, 0.5))
    rig.add('ring', AZ.CYAN, ring(R * 1.3, 0.014, 14, 3, { axis: 'z', p: [0, CY + 0.05, -R * 1.25] }))
    rig.add('core', AZ.GOLD, box(R * 0.5, 0.035, R * 0.8, 0, CY + R * 0.9, -R * 0.1))
    muzzle = [0, CY - R - 0.04, 0.8]; muzzles = undefined
  }
  const hover = (u, P, tilt) => {
    P.t('core', 0, 0.06 * sin(u * TAU), 0).r('core', tilt + 0.04 * sin(u * TAU + 1), 0, 0.05 * sin(u * TAU * 2))
    if (stage > 0) P.r('ring', 0, u * TAU, 0).r('eye', 0.1 * sin(u * TAU * 2), 0.3 * sin(u * TAU), 0).r('wingR', 0, 0, 0.08 * sin(u * TAU * 2)).r('wingL', 0, 0, -0.08 * sin(u * TAU * 2))
  }
  rig.clip('idle', 16, stage === 0 ? 5.0 : 2.6, true, (u, P) => hover(u, P, 0))
  rig.clip('walk', 16, 2.6, true, (u, P) => hover(u, P, 0.2))
  rig.clip('shoot', 8, stage >= 3 ? 0.5 : 0.3, false, (u, P) => {
    const k = Math.pow(1 - u, 2)
    P.t('core', 0, 0.02 * k, -0.12 * k).r('core', -0.14 * k, 0, 0).s('eye', 1 + 0.25 * k).r('ring', 0, u * 1.2, 0)
    if (stage >= 2) P.t('gunR', 0, 0, -0.07 * k).t('gunL', 0, 0, -0.07 * Math.pow(1 - Math.min(1, u * 1.6), 2))
    if (stage >= 3) P.s('ring', 1 + 0.3 * k)
  })
  // 进化 / 扫描脉冲时可以播：环放大一圈再收回
  rig.clip('pulse', 10, 0.7, false, (u, P) => { const k = bump(u, 0, 1); P.s('ring', 1 + 1.1 * k).t('core', 0, 0.12 * k, 0).r('core', 0, u * TAU, 0).s('eye', 1 + 0.3 * k) })
  rig.clip('die', 10, 0.9, false, (u, P) => { const f = u * u, k = ease(u); P.t('core', 0, -(CY - R * 0.8) * f, 0).r('core', 0.8 * k, 1.5 * k, 0.5 * k).s('ring', 1 - 0.97 * k).r('wingR', 0, 0, -0.9 * k).r('wingL', 0, 0, 0.9 * k) })
  rig.meta = { muzzle, muzzles }
  return rig
}
