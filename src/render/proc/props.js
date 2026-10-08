// proc/props.js —— 空投舱、布防装置（GDD §13）和占位体。
// 这些都是「先能看、形状能区分」的占位级模型，正式美术在 assets.js 里换掉对应条目即可。
import { AZ } from '../materials.js'
import { Rig, V3, box, prism, tube, ball, dome, gem, lathe, ring, TAU, sin, cos, bump, ease } from './kit.js'

const PI = Math.PI

/** 未注册 kind 的占位体：一个带箭头的胶囊（材质是黄黑警示格） */
export function buildPlaceholder() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0)
  rig.add('root', 0, lathe([[0.0, 0], [0.3, 0.05], [0.34, 0.3], [0.34, 0.8], [0.22, 1.05], [0.0, 1.12]], 8), box(0.16, 0.16, 0.5, 0, 0.7, 0.4, { taper: [1, 0.3] }))
  rig.clip('idle', 8, 1, true, (u, P) => { P.t('root', 0, 0.06 * Math.abs(sin(u * TAU)), 0) })
  return rig
}

/** 雇佣兵空投舱 */
export function buildPod() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('pod', 'root', 0, 0, 0)
  rig.add('pod', AZ.GUN, lathe([[0.0, 0.1], [0.7, 0.25], [0.85, 0.9], [0.8, 1.7], [0.45, 2.3], [0.0, 2.4]], 8))
  rig.add('pod', AZ.PLATE, prism(8, 0.9, 0.9, 0.12, 0, 0.9, 0), prism(8, 0.84, 0.84, 0.1, 0, 1.65, 0))
  rig.add('pod', AZ.PAINT, prism(8, 0.87, 0.84, 0.3, 0, 1.15, 0))
  rig.add('pod', AZ.ORANGE, prism(8, 0.875, 0.87, 0.05, 0, 1.5, 0), gem(0.1, 0, 2.5, 0))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; rig.add('pod', AZ.DARK, tube(V3(cos(a) * 0.7, 0.8, sin(a) * 0.7), V3(cos(a) * 1.25, 0.0, sin(a) * 1.25), 0.09, 0.07, 5), box(0.4, 0.06, 0.4, cos(a) * 1.25, 0.03, sin(a) * 1.25)) }
  rig.clip('idle', 8, 1.2, true, (u, P) => { P.s('pod', 1 + 0.01 * sin(u * TAU)) })
  rig.clip('die', 8, 0.5, false, (u, P) => { const k = ease(u); P.s('pod', 1 + 0.3 * bump(u, 0, 0.5), 1 - 0.9 * k, 1 + 0.3 * bump(u, 0, 0.5)) })
  return rig
}

/** 布防装置。kind: collector / sentry / barricade / mine / cryo / scorcher / mortarpit / nova */
export function buildDevice(kind) {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 0.6, 0)
  const base = () => { rig.add('root', AZ.DARK, prism(8, 0.85, 0.75, 0.16, 0, 0, 0)); rig.add('root', AZ.PLATE, prism(8, 0.62, 0.55, 0.12, 0, 0.16, 0)) }
  let shootDur = 0.2
  switch (kind) {
    case 'collector':
      base()
      rig.add('root', AZ.GUN, prism(6, 0.3, 0.2, 0.6, 0, 0.28, 0))
      rig.add('top', AZ.CYAN, gem(0.34, 0, 1.35, 0, 0.8, 1.7, 0.8))
      for (let k = 0; k < 3; k++) { const a = k * TAU / 3; rig.add('root', AZ.PLATE, tube(V3(cos(a) * 0.5, 0.2, sin(a) * 0.5), V3(cos(a) * 0.42, 1.2, sin(a) * 0.42), 0.05, 0.03, 4)); rig.add('top', AZ.CYAN, gem(0.07, cos(a) * 0.42, 1.28, sin(a) * 0.42)) }
      rig.clip('idle', 16, 3, true, (u, P) => { P.r('top', 0, u * TAU, 0).t('top', 0, 0.06 * sin(u * TAU * 2), 0) })
      break
    case 'sentry':
      base()
      rig.add('root', AZ.GUN, prism(8, 0.26, 0.22, 0.5, 0, 0.28, 0))
      rig.add('top', AZ.GUN, box(0.62, 0.4, 0.7, 0, 0.98, 0.0, { taper: [0.8, 0.85] }))
      rig.add('top', AZ.TEAM, box(0.66, 0.1, 0.4, 0, 1.2, -0.05))
      rig.add('top', AZ.PLATE, prism(6, 0.055, 0.055, 0.85, 0.15, 0.98, 0.3, { r: [PI / 2, 0, 0] }), prism(6, 0.055, 0.055, 0.85, -0.15, 0.98, 0.3, { r: [PI / 2, 0, 0] }), box(0.2, 0.3, 0.3, 0.42, 0.95, -0.1), box(0.2, 0.3, 0.3, -0.42, 0.95, -0.1))
      rig.add('top', AZ.CYAN, box(0.2, 0.06, 0.04, 0, 1.08, 0.36))
      rig.clip('idle', 12, 3, true, (u, P) => { P.r('top', 0, 0.3 * sin(u * TAU), 0) })
      rig.clip('shoot', 4, 0.2, true, (u, P) => { P.t('top', 0, 0, -0.06 * (1 - u)) })
      break
    case 'barricade':
      rig.add('root', AZ.DARK, box(2.2, 0.2, 0.8, 0, 0.1, 0))
      rig.add('root', AZ.GUN, box(2.1, 1.0, 0.3, 0, 0.62, 0.05, { taper: [0.96, 0.5], r: [0.12, 0, 0] }))
      rig.add('root', AZ.PLATE, box(0.22, 1.12, 0.5, 0.75, 0.62, 0, { taper: [0.9, 0.5] }), box(0.22, 1.12, 0.5, -0.75, 0.62, 0, { taper: [0.9, 0.5] }), box(0.22, 1.12, 0.5, 0, 0.62, 0, { taper: [0.9, 0.5] }))
      rig.add('root', AZ.PAINT, box(2.0, 0.16, 0.04, 0, 0.9, -0.17, { r: [0.12, 0, 0] }))
      for (const x of [-0.9, -0.3, 0.3, 0.9]) rig.add('root', AZ.PLATE, tube(V3(x, 0.7, -0.2), V3(x, 0.95, -0.75), 0.06, 0, 4))
      rig.clip('idle', 1, 1, true, null)
      break
    case 'mine':
      rig.add('root', AZ.GUN, prism(8, 0.42, 0.34, 0.14, 0, 0, 0))
      rig.add('root', AZ.PLATE, prism(8, 0.22, 0.2, 0.06, 0, 0.14, 0))
      rig.add('top', AZ.ORANGE, gem(0.09, 0, 0.26, 0))
      for (let k = 0; k < 4; k++) { const a = k * PI / 2; rig.add('root', AZ.DARK, box(0.12, 0.06, 0.2, cos(a) * 0.44, 0.03, sin(a) * 0.44, { r: [0, -a + PI / 2, 0] })) }
      rig.clip('idle', 8, 1.0, true, (u, P) => { P.s('top', 1 + 0.5 * bump(u, 0, 0.3)) })
      break
    case 'cryo':
      base()
      rig.add('root', AZ.GUN, prism(6, 0.24, 0.16, 0.9, 0, 0.28, 0))
      rig.add('top', AZ.CYAN, ball(0.3, 0.3, 0.3, 0, 1.4, 0, 8, 6))
      rig.add('top', AZ.PLATE, ring(0.4, 0.04, 10, 4, { p: [0, 1.4, 0] }), ring(0.4, 0.04, 10, 4, { axis: 'z', p: [0, 1.4, 0] }), prism(6, 0.06, 0.04, 0.5, 0, 1.4, 0.26, { r: [PI / 2, 0, 0] }))
      rig.clip('idle', 16, 2.4, true, (u, P) => { P.r('top', 0, u * TAU, 0) })
      rig.clip('shoot', 4, 0.35, true, (u, P) => { P.s('top', 1 + 0.12 * (1 - u)) })
      break
    case 'scorcher':
      rig.add('root', AZ.DARK, box(1.5, 0.2, 1.2, 0, 0.1, 0))
      rig.add('root', AZ.GUN, box(1.2, 0.4, 0.8, 0, 0.4, -0.1, { taper: [0.85, 0.8] }))
      rig.add('root', AZ.PAINT, lathe([[0.0, 0], [0.2, 0.03], [0.2, 0.7], [0.0, 0.73]], 8, { axis: 'x', p: [-0.37, 0.72, -0.2] }))
      for (const x of [-0.4, 0, 0.4]) { rig.add('top', AZ.PLATE, prism(6, 0.09, 0.12, 0.34, x, 0.45, 0.3, { r: [PI / 2 - 0.2, 0, 0] })); rig.add('top', AZ.ORANGE, gem(0.05, x, 0.52, 0.66)) }
      rig.clip('idle', 1, 1, true, null)
      rig.clip('shoot', 4, 0.3, true, (u, P) => { P.t('top', 0, 0.02 * sin(u * TAU), 0) })
      break
    case 'mortarpit':
      rig.add('root', AZ.DARK, prism(8, 0.95, 0.85, 0.3, 0, 0, 0))
      rig.add('root', AZ.PLATE, ring(0.78, 0.09, 8, 4, { p: [0, 0.32, 0] }))
      rig.add('top', AZ.GUN, lathe([[0.22, 0], [0.22, 0.2], [0.17, 0.26], [0.17, 1.0], [0.2, 1.02], [0.2, 1.15], [0.12, 1.15]], 8, { r: [0.5, 0, 0], p: [0, 0.3, -0.1] }), box(0.7, 0.12, 0.5, 0, 0.3, -0.05))
      rig.add('top', AZ.TEAM, lathe([[0.175, 0], [0.175, 0.12]], 8, { r: [0.5, 0, 0], p: [0, 0.75, 0.15] }))
      rig.clip('idle', 1, 1, true, null)
      rig.clip('shoot', 8, 0.6, false, (u, P) => { P.t('top', 0, -0.16 * Math.pow(1 - u, 2), -0.08 * Math.pow(1 - u, 2)) })
      shootDur = 0.6
      break
    case 'nova':
      rig.add('root', AZ.DARK, prism(8, 0.6, 0.5, 0.14, 0, 0, 0))
      rig.add('top', AZ.GUN, ball(0.52, 0.52, 0.52, 0, 0.66, 0, 10, 7))
      rig.add('top', AZ.ORANGE, ring(0.53, 0.04, 12, 4, { p: [0, 0.66, 0] }), ring(0.53, 0.04, 12, 4, { axis: 'z', p: [0, 0.66, 0] }), gem(0.12, 0, 1.24, 0))
      rig.add('top', AZ.PAINT, ring(0.53, 0.05, 12, 4, { axis: 'x', p: [0, 0.66, 0] }))
      rig.clip('idle', 8, 0.4, true, (u, P) => { P.s('top', 1 + 0.06 * sin(u * TAU)) })
      break
    default:
      return buildPlaceholder()
  }
  rig.clip('die', 6, 0.4, false, (u, P) => { const k = ease(u); P.s('root', 1 + 0.15 * bump(u, 0, 0.5), 1 - 0.9 * k, 1 + 0.15 * bump(u, 0, 0.5)) })
  rig.meta = { shootDur }
  return rig
}

/** 霍克的旗舰「不屈号」：悬停在战场上空的炮舰（建模时 y=0 是舰底，view 按 summons.y 抬高） */
export function buildFlagship() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, 0.8, 0).bone('gun', 'hull', 0, 0.3, 1.5)
  rig.add('hull', AZ.GUN, box(2.6, 1.0, 8.5, 0, 0.9, -0.3, { taper: [0.7, 0.86] }), box(1.6, 0.7, 3.2, 0, 0.7, 4.6, { taper: [0.5, 0.2], shear: [0, 0.6] }))
  rig.add('hull', AZ.PLATE, box(3.2, 0.2, 5.0, 0, 0.5, -0.8), box(1.2, 0.7, 2.2, 0, 1.75, -1.6, { taper: [0.7, 0.7] }), box(0.5, 0.5, 0.9, 0, 2.2, -1.4, { taper: [0.6, 0.6] }))
  rig.add('hull', AZ.TEAM, box(2.7, 0.22, 0.6, 0, 1.0, 2.2), box(2.7, 0.22, 0.6, 0, 1.0, -3.0), box(0.2, 0.06, 3.0, 0, 1.43, 1.2))
  rig.add('hull', AZ.CYAN, box(0.8, 0.14, 0.05, 0, 1.85, -0.48), box(0.06, 0.1, 4.6, 1.34, 0.85, -0.6), box(0.06, 0.1, 4.6, -1.34, 0.85, -0.6))
  for (const s of [1, -1]) {
    rig.add('hull', AZ.GUN, box(1.5, 0.5, 3.2, s * 2.3, 0.7, -2.2, { taper: [0.8, 0.7] }), box(1.0, 0.16, 1.4, s * 1.6, 0.75, -1.8))   // 引擎舱
    rig.add('hull', AZ.ORANGE, prism(8, 0.34, 0.34, 0.06, s * 2.3, 0.7, -3.85, { r: [PI / 2, 0, 0] }), prism(8, 0.3, 0.3, 0.06, s * 2.3, 0.35, -1.6))
    rig.add('hull', AZ.PLATE, lathe([[0.08, 0], [0.08, 1.6], [0.0, 1.6]], 6, { axis: 'z', p: [s * 0.8, 0.7, 3.2] }))
  }
  rig.add('gun', AZ.DARK, prism(8, 0.6, 0.45, 0.4, 0, -0.05, 1.5, { r: [PI, 0, 0] }))
  rig.add('gun', AZ.PLATE, lathe([[0.2, 0], [0.2, 1.4], [0.26, 1.42], [0.26, 1.7], [0.0, 1.7]], 8, { r: [PI - 0.5, 0, 0], p: [0, 0.2, 1.5] }))
  rig.add('gun', AZ.CYAN, ring(0.24, 0.04, 8, 4, { p: [0, -0.35, 1.5] }))
  rig.clip('idle', 12, 4, true, (u, P) => { P.t('hull', 0, 0.12 * sin(u * TAU), 0).r('hull', 0.012 * sin(u * TAU + 1), 0, 0.02 * sin(u * TAU)) })
  rig.clip('shoot', 6, 0.2, true, (u, P) => { P.t('hull', 0, 0.04 * sin(u * TAU), 0).s('gun', 1 + 0.1 * (1 - u)) })
  rig.clip('die', 8, 0.8, false, (u, P) => { const k = ease(u); P.t('root', 0, 6 * k, -14 * k * k).r('hull', -0.25 * k, 0, 0) })   // 任务结束：抬头飞走
  return rig
}

/** 老猫的铁罐战斗机器人：矮墩墩的罐子 + 两条机械臂 */
export function buildRobot() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 0.5, 0).bone('armR', 'body', 0.42, 0.9, 0).bone('armL', 'body', -0.42, 0.9, 0).bone('legR', 'root', 0.2, 0.4, 0).bone('legL', 'root', -0.2, 0.4, 0)
  rig.add('body', AZ.PAINT, lathe([[0.0, 0.35], [0.36, 0.4], [0.4, 0.7], [0.4, 1.05], [0.3, 1.2], [0.0, 1.22]], 8))
  rig.add('body', AZ.PLATE, prism(8, 0.42, 0.42, 0.08, 0, 0.72, 0), prism(8, 0.2, 0.16, 0.12, 0, 1.2, 0))
  rig.add('body', AZ.CYAN, box(0.36, 0.09, 0.05, 0, 0.98, 0.37))
  rig.add('body', AZ.ORANGE, gem(0.05, 0, 1.4, 0))
  rig.both('armR', 'armL', AZ.GUN, ball(0.13, 0.13, 0.13, 0.46, 0.9, 0, 6, 4), tube(V3(0.46, 0.9, 0), V3(0.56, 0.6, 0.3), 0.08, 0.07, 5), box(0.2, 0.2, 0.34, 0.56, 0.55, 0.46, { taper: [0.8, 0.7] }))
  rig.both('legR', 'legL', AZ.DARK, tube(V3(0.2, 0.42, 0), V3(0.24, 0.1, 0.02), 0.09, 0.08, 5), box(0.22, 0.1, 0.36, 0.24, 0.05, 0.05))
  rig.clip('idle', 8, 1.2, true, (u, P) => { P.t('body', 0, 0.015 * sin(u * TAU), 0) })
  rig.clip('walk', 8, 0.5, true, (u, P) => { const s = sin(u * TAU); P.r('legR', -0.6 * s, 0, 0).r('legL', 0.6 * s, 0, 0).r('body', 0, 0, 0.06 * s).t('body', 0, 0.03 * Math.abs(s), 0) })
  rig.clip('shoot', 6, 0.35, false, (u, P) => { const k = bump(u, 0, 1); P.r('armR', -1.4 * k, 0, 0).r('armL', -1.4 * bump(u, 0.2, 1), 0, 0).r('body', 0.15 * k, 0, 0) })
  rig.clip('die', 6, 0.4, false, (u, P) => { const k = ease(u); P.s('body', 1 + 0.2 * bump(u, 0, 0.5), 1 - 0.85 * k, 1 + 0.2 * bump(u, 0, 0.5)) })
  return rig
}
