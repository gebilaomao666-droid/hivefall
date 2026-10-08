// models/world/devices.js —— 八种布防装置（GDD §13）和空投舱的程序化模型。
// 约定同 proc/kit.js：模型朝 +Z（放到场上时 yaw = π，正面对着虫来的方向），底面 y = 0，占地不超过一格（2.56 × 3）。
// 主机位下一个装置只有 50 像素左右：先保证剪影互不相同，再用一两条自发光标出「它是干什么的」：
//   采集器 = 青色悬浮晶体   哨戒塔 = 双联长管 + 橙色枪口   路障 = 一堵带警示条的斜墙   地雷 = 贴地圆盘（未武装琥珀 / 武装红）
//   冷凝塔 = 白色冷罐 + 青色透镜   喷火陷阱 = 矮墩 + 三个喷口 + 橙红燃料罐   迫击炮台 = 环形掩体里一根粗炮管   聚变炸弹 = 托架里的球 + 转环
import { AZ } from '../../materials.js'
import { Rig, V3, box, prism, tube, ball, gem, lathe, ring, group, TAU, sin, cos, bump, ease } from '../../proc/kit.js'

const PI = Math.PI
const collapse = (rig, bone = 'root') => rig.clip('die', 6, 0.4, false, (u, P) => { const k = ease(u); P.s(bone, 1 + 0.18 * bump(u, 0, 0.5), 1 - 0.92 * k, 1 + 0.18 * bump(u, 0, 0.5)) })
/** 通用底座：八角底盘 + 四个地脚 + 一圈警示色 */
function pedestal(rig, r = 0.86, zone = AZ.PAINT) {
  rig.add('root', AZ.DARK, prism(8, r, r * 0.9, 0.14, 0, 0, 0))
  rig.add('root', AZ.GUN, prism(8, r * 0.78, r * 0.7, 0.12, 0, 0.14, 0))
  rig.add('root', zone, prism(8, r * 0.905, r * 0.9, 0.035, 0, 0.105, 0))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; rig.add('root', AZ.DARK, box(0.3, 0.1, 0.42, cos(a) * r * 0.98, 0.05, sin(a) * r * 0.98, { r: [0, -a + PI / 2, 0] })) }
}

export function buildCollector() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 1.5, 0).bone('halo', 'root', 0, 1.15, 0)
  pedestal(rig, 0.9, AZ.TEAM)
  rig.add('root', AZ.GUN, prism(6, 0.36, 0.26, 0.46, 0, 0.26, 0))
  rig.add('root', AZ.CYAN, prism(6, 0.2, 0.2, 0.05, 0, 0.72, 0))
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3 + PI / 6, c = cos(a), s = sin(a)
    rig.add('root', AZ.PLATE, tube(V3(c * 0.5, 0.26, s * 0.5), V3(c * 0.84, 0.98, s * 0.84), 0.085, 0.065, 5), tube(V3(c * 0.84, 0.98, s * 0.84), V3(c * 0.5, 1.72, s * 0.5), 0.065, 0.03, 5))
    rig.add('root', AZ.GUN, box(0.2, 0.2, 0.2, c * 0.84, 0.98, s * 0.84, { r: [0, -a, 0] }))
    rig.add('root', AZ.CYAN, gem(0.07, c * 0.47, 1.76, s * 0.47), box(0.05, 0.4, 0.05, c * 0.7, 0.62, s * 0.7, { r: [0, -a, 0.43] }))
    rig.add('top', AZ.CYAN, gem(0.1, c * 0.34, 1.32, s * 0.34, 0.7, 1.6, 0.7))
  }
  rig.add('top', AZ.CYAN, gem(0.36, 0, 1.5, 0, 0.78, 1.85, 0.78))
  rig.add('halo', AZ.GOLD, ring(0.6, 0.03, 16, 4, { p: [0, 1.15, 0] }))
  rig.add('halo', AZ.CYAN, gem(0.06, 0.6, 1.15, 0), gem(0.06, -0.6, 1.15, 0))
  rig.clip('idle', 24, 4, true, (u, P) => { P.r('top', 0, u * TAU, 0).t('top', 0, 0.08 * sin(u * TAU * 2), 0).r('halo', 0.22 * sin(u * TAU), -u * TAU * 2, 0.22 * cos(u * TAU)) })
  rig.clip('shoot', 8, 0.5, false, (u, P) => { const k = bump(u, 0, 1); P.s('top', 1 + 0.4 * k).t('top', 0, 0.25 * k, 0).r('top', 0, u * PI, 0).s('halo', 1 + 0.5 * k) })
  collapse(rig)
  rig.meta = { shootDur: 0.5 }
  return rig
}

export function buildSentry() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 0.7, 0).bone('gunR', 'top', 0.2, 1.0, 0.3).bone('gunL', 'top', -0.2, 1.0, 0.3)
  // 底座做成圆的：整台实例会转着瞄准，圆底转起来看不出来
  rig.add('root', AZ.DARK, lathe([[0.0, 0], [0.84, 0], [0.84, 0.1], [0.64, 0.2], [0.64, 0.28], [0.0, 0.28]], 12))
  rig.add('root', AZ.PAINT, lathe([[0.845, 0.04], [0.845, 0.09]], 12))
  rig.add('root', AZ.GUN, lathe([[0.34, 0.28], [0.3, 0.62], [0.4, 0.7], [0.0, 0.7]], 10))
  rig.add('top', AZ.GUN, box(0.72, 0.4, 0.92, 0, 0.96, -0.02, { taper: [0.82, 0.86] }), box(0.5, 0.3, 0.4, 0, 0.92, -0.62, { taper: [0.8, 0.7] }))
  rig.add('top', AZ.PLATE, box(0.78, 0.12, 0.6, 0, 0.78, 0.05), box(0.3, 0.16, 0.5, 0, 1.22, -0.12, { taper: [0.8, 0.8] }))
  rig.add('top', AZ.TEAM, box(0.74, 0.07, 0.3, 0, 1.17, 0.22))
  rig.add('top', AZ.CYAN, box(0.22, 0.07, 0.05, 0, 1.25, 0.14), box(0.05, 0.1, 0.5, 0.37, 0.98, -0.1), box(0.05, 0.1, 0.5, -0.37, 0.98, -0.1))
  for (const s of [1, -1]) {
    rig.add('top', AZ.PLATE, lathe([[0.0, 0], [0.2, 0.02], [0.2, 0.3], [0.0, 0.32]], 8, { axis: 'x', p: [s * 0.36 - (s > 0 ? 0 : 0.32), 0.96, -0.2] }))   // 弹鼓
    const g = s > 0 ? 'gunR' : 'gunL'
    rig.add(g, AZ.GUN, lathe([[0.085, 0], [0.085, 0.5], [0.06, 0.52], [0.06, 1.12]], 6, { axis: 'z', p: [s * 0.2, 1.0, 0.3] }))
    rig.add(g, AZ.PLATE, lathe([[0.09, 0], [0.09, 0.16]], 6, { axis: 'z', p: [s * 0.2, 1.0, 1.3] }))
    rig.add(g, AZ.ORANGE, lathe([[0.05, 0], [0.05, 0.03]], 6, { axis: 'z', p: [s * 0.2, 1.0, 1.46] }))
  }
  rig.clip('idle', 12, 4, true, (u, P) => { P.r('top', 0, 0.45 * sin(u * TAU), 0) })
  rig.clip('aim', 1, 1, true, null)
  rig.clip('shoot', 4, 0.2, true, (u, P) => { P.t('gunR', 0, 0, -0.14 * bump(u, 0, 0.5)).t('gunL', 0, 0, -0.14 * bump(u, 0.5, 1)).t('top', 0, 0, -0.02) })
  collapse(rig)
  rig.meta = { shootDur: 0.2, muzzles: [[0.2, 1.0, 1.5], [-0.2, 1.0, 1.5]], aim: true }
  return rig
}

export function buildBarricade() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0)
  rig.add('root', AZ.DARK, box(2.34, 0.14, 1.0, 0, 0.07, 0))
  rig.add('root', AZ.GUN, box(2.24, 1.14, 0.36, 0, 0.7, 0.02, { taper: [0.95, 0.55], r: [-0.13, 0, 0] }))
  for (const x of [-0.75, 0, 0.75]) {
    rig.add('root', AZ.PLATE, box(0.66, 0.84, 0.1, x, 0.62, 0.27, { taper: [0.92, 1], r: [-0.13, 0, 0] }))
    rig.add('root', AZ.DARK, box(0.12, 0.7, 0.62, x + 0.37, 0.42, -0.34, { taper: [1, 0.2], shear: [0, 0.2] }))   // 背后的三角撑
    rig.add('root', AZ.PLATE, tube(V3(x - 0.18, 0.34, 0.36), V3(x - 0.18, 0.22, 0.86), 0.075, 0, 4), tube(V3(x + 0.18, 0.34, 0.36), V3(x + 0.18, 0.22, 0.86), 0.075, 0, 4))   // 朝外的拒马刺
  }
  rig.add('root', AZ.DARK, box(0.12, 0.7, 0.62, -1.12, 0.42, -0.34, { taper: [1, 0.2], shear: [0, 0.2] }))
  rig.add('root', AZ.PAINT, box(2.1, 0.13, 0.05, 0, 1.12, 0.06, { r: [-0.13, 0, 0] }), box(2.3, 0.05, 0.05, 0, 0.16, 0.5))
  rig.add('root', AZ.CYAN, box(1.9, 0.035, 0.035, 0, 1.27, -0.06))
  // 背面（玩家这一侧看到的是背面）：警示条 + 两块检修盖板 + 一条队色带
  rig.add('root', AZ.PAINT, box(2.0, 0.16, 0.04, 0, 0.98, -0.19, { r: [-0.13, 0, 0] }))
  rig.add('root', AZ.PLATE, box(0.5, 0.4, 0.05, -0.38, 0.56, -0.24, { r: [-0.13, 0, 0] }), box(0.5, 0.4, 0.05, 0.38, 0.56, -0.24, { r: [-0.13, 0, 0] }))
  rig.add('root', AZ.TEAM, box(2.12, 0.07, 0.04, 0, 0.22, -0.3))
  for (const x of [-1.08, 1.08]) { rig.add('root', AZ.GUN, box(0.2, 1.28, 0.44, x, 0.66, 0, { taper: [0.8, 0.6] })); rig.add('root', AZ.ORANGE, gem(0.06, x, 1.36, 0)) }
  rig.clip('idle', 1, 1, true, null)
  rig.clip('shoot', 4, 0.2, false, (u, P) => { P.t('root', 0, 0, -0.05 * bump(u, 0, 1)) })   // 被啃：往后一震
  collapse(rig)
  rig.meta = { shootDur: 0.2 }
  return rig
}

export function buildMine() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('prong', 'root', 0, 0.08, 0).bone('lampA', 'root', 0, 0.28, 0).bone('lampB', 'root', 0, 0.28, 0)
  rig.add('root', AZ.DARK, prism(10, 0.5, 0.44, 0.1, 0, 0, 0))
  rig.add('root', AZ.GUN, prism(10, 0.4, 0.3, 0.13, 0, 0.1, 0))
  rig.add('root', AZ.PAINT, prism(10, 0.405, 0.4, 0.03, 0, 0.1, 0))
  rig.add('root', AZ.PLATE, prism(10, 0.2, 0.18, 0.05, 0, 0.23, 0))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; rig.add('prong', AZ.PLATE, box(0.1, 0.07, 0.34, cos(a) * 0.5, 0.06, sin(a) * 0.5, { r: [0, -a + PI / 2, 0] }), tube(V3(cos(a) * 0.64, 0.06, sin(a) * 0.64), V3(cos(a) * 0.68, 0.3, sin(a) * 0.68), 0.035, 0.0, 4)) }
  rig.add('lampA', AZ.ORANGE, gem(0.085, 0, 0.32, 0))
  rig.add('lampB', AZ.CYAN, gem(0.12, 0, 0.34, 0, 1, 1.3, 1))
  for (let k = 0; k < 6; k++) { const a = k * TAU / 6; rig.add('lampB', AZ.CYAN, box(0.07, 0.035, 0.07, cos(a) * 0.3, 0.215, sin(a) * 0.3)) }
  rig.clip('idle', 8, 1.2, true, (u, P) => { P.s('lampB', 0.001).s('lampA', 0.35 + 0.65 * bump(u, 0, 0.35)).s('prong', 0.62) })
  rig.clip('armed', 8, 0.7, true, (u, P) => { P.s('lampA', 0.001).s('lampB', 1 + 0.35 * bump(u, 0, 0.5)) })
  rig.clip('die', 4, 0.15, false, (u, P) => { P.s('root', 1 + u, 1 - 0.9 * u, 1 + u) })
  return rig
}

export function buildCryo() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 1.3, 0)
  rig.add('root', AZ.DARK, lathe([[0.0, 0], [0.82, 0], [0.82, 0.1], [0.62, 0.2], [0.0, 0.2]], 12))
  rig.add('root', AZ.TEAM, lathe([[0.825, 0.04], [0.825, 0.09]], 12))
  rig.add('root', AZ.GUN, lathe([[0.3, 0.2], [0.24, 0.5], [0.24, 1.1], [0.32, 1.22], [0.0, 1.22]], 8))
  for (let k = 0; k < 3; k++) {   // 三只冷罐，白得发青：远看就是「冷」
    const a = k * TAU / 3 + PI, c = cos(a), s = sin(a)
    rig.add('root', AZ.PAINT, lathe([[0.0, 0.22], [0.17, 0.26], [0.17, 0.96], [0.1, 1.04], [0.0, 1.04]], 7, { p: [c * 0.46, 0, s * 0.46] }))
    rig.add('root', AZ.PLATE, lathe([[0.18, 0.5], [0.18, 0.58]], 7, { p: [c * 0.46, 0, s * 0.46] }))
    rig.add('root', AZ.CYAN, box(0.05, 0.4, 0.05, c * 0.64, 0.62, s * 0.64))
  }
  rig.add('top', AZ.GUN, box(0.56, 0.4, 0.62, 0, 1.46, -0.05, { taper: [0.8, 0.85] }))
  rig.add('top', AZ.PLATE, lathe([[0.2, 0], [0.24, 0.32], [0.3, 0.4], [0.3, 0.46]], 8, { axis: 'z', p: [0, 1.46, 0.24] }), box(0.62, 0.06, 0.5, 0, 1.69, -0.08))
  rig.add('top', AZ.CYAN, lathe([[0.0, 0], [0.2, 0.0], [0.08, 0.09], [0.0, 0.1]], 8, { axis: 'z', p: [0, 1.46, 0.62] }), ring(0.34, 0.025, 12, 4, { axis: 'z', p: [0, 1.46, 0.56] }))
  for (const s of [1, -1]) rig.add('top', AZ.PAINT, box(0.05, 0.3, 0.44, s * 0.32, 1.52, -0.1, { taper: [1, 0.6] }))
  rig.clip('idle', 12, 2.4, true, (u, P) => { P.t('top', 0, 0.015 * sin(u * TAU), 0) })
  rig.clip('aim', 1, 1, true, null)
  rig.clip('shoot', 4, 0.35, false, (u, P) => { P.t('top', 0, 0, -0.09 * (1 - u)).s('top', 1 + 0.08 * (1 - u)) })
  collapse(rig)
  rig.meta = { shootDur: 0.35, muzzle: [0, 1.46, 0.75], aim: true }
  return rig
}

export function buildScorcher() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 0.4, 0.3)
  rig.add('root', AZ.DARK, box(1.96, 0.16, 1.56, 0, 0.08, 0, { taper: [0.94, 0.94] }))
  rig.add('root', AZ.GUN, box(1.62, 0.46, 1.0, 0, 0.39, -0.12, { taper: [0.84, 0.74] }))
  rig.add('root', AZ.PLATE, box(1.7, 0.3, 0.1, 0, 0.3, 0.5, { r: [0.35, 0, 0] }), box(0.5, 0.06, 0.6, 0, 0.64, -0.14))
  for (const s of [1, -1]) {   // 两只横卧的燃料罐
    rig.add('root', AZ.PAINT, lathe([[0.0, 0], [0.2, 0.04], [0.2, 0.66], [0.0, 0.7]], 8, { axis: 'x', p: [s > 0 ? 0.12 : -0.82, 0.72, -0.34] }))
    rig.add('root', AZ.DARK, lathe([[0.21, 0.28], [0.21, 0.36]], 8, { axis: 'x', p: [s > 0 ? 0.12 : -0.82, 0.72, -0.34] }))
    rig.add('root', AZ.PLATE, tube(V3(s * 0.46, 0.72, -0.2), V3(s * 0.5, 0.5, 0.22), 0.045, 0.045, 5))
  }
  for (const x of [-0.54, 0, 0.54]) {
    rig.add('top', AZ.GUN, lathe([[0.11, 0], [0.11, 0.2], [0.16, 0.26], [0.16, 0.4], [0.13, 0.4]], 7, { axis: 'z', p: [x, 0.44, 0.34] }))
    rig.add('top', AZ.ORANGE, lathe([[0.0, 0], [0.12, 0]], 7, { axis: 'z', p: [x, 0.44, 0.72] }), gem(0.04, x, 0.63, 0.66))
  }
  rig.add('root', AZ.ORANGE, box(0.9, 0.04, 0.04, 0, 0.64, 0.34))
  rig.clip('idle', 1, 1, true, null)
  rig.clip('shoot', 4, 0.3, true, (u, P) => { P.t('top', 0, 0.012 * sin(u * TAU * 2), -0.02) })
  collapse(rig)
  rig.meta = { shootDur: 0.3 }
  return rig
}

export function buildMortarpit() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 0.3, -0.1)
  rig.add('root', AZ.DARK, lathe([[1.0, 0], [0.96, 0.34], [0.8, 0.4], [0.74, 0.16], [0.0, 0.16]], 10))   // 环形掩体：外高内低
  rig.add('root', AZ.PAINT, lathe([[0.965, 0.3], [0.945, 0.35]], 10))
  for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + 0.3; rig.add('root', AZ.PLATE, box(0.5, 0.36, 0.16, cos(a) * 0.95, 0.24, sin(a) * 0.95, { r: [0, -a + PI / 2, 0], taper: [0.9, 0.7] })) }
  const barrel = [
    lathe([[0.27, 0], [0.27, 0.22], [0.2, 0.28], [0.2, 1.0], [0.25, 1.03], [0.25, 1.2], [0.15, 1.2], [0.15, 1.0]], 8),
  ]
  rig.add('top', AZ.GUN, group(barrel, [0.42, 0, 0], [0, 0.26, -0.22]))
  rig.add('top', AZ.TEAM, group([lathe([[0.205, 0.5], [0.205, 0.64]], 8)], [0.42, 0, 0], [0, 0.26, -0.22]))
  rig.add('top', AZ.ORANGE, group([lathe([[0.0, 1.19], [0.15, 1.19]], 8)], [0.42, 0, 0], [0, 0.26, -0.22]))
  rig.add('top', AZ.PLATE, box(0.8, 0.1, 0.56, 0, 0.22, -0.2), tube(V3(0.0, 1.0, 0.18), V3(0.38, 0.2, 0.52), 0.04, 0.04, 4), tube(V3(0.0, 1.0, 0.18), V3(-0.38, 0.2, 0.52), 0.04, 0.04, 4))
  for (const x of [-0.5, -0.32]) { rig.add('root', AZ.PLATE, lathe([[0.07, 0.16], [0.07, 0.4], [0.0, 0.52]], 6, { p: [x, 0, -0.44] })); rig.add('root', AZ.ORANGE, lathe([[0.072, 0.3], [0.072, 0.34]], 6, { p: [x, 0, -0.44] })) }
  rig.add('root', AZ.CYAN, box(0.2, 0.05, 0.05, 0.45, 0.36, -0.6))
  rig.clip('idle', 1, 1, true, null)
  rig.clip('aim', 1, 1, true, null)
  rig.clip('shoot', 8, 0.6, false, (u, P) => { const k = Math.pow(1 - u, 2); P.t('top', 0, -0.2 * k, -0.1 * k).s('top', 1 + 0.06 * k, 1 - 0.1 * k, 1 + 0.06 * k) })
  collapse(rig)
  rig.meta = { shootDur: 0.6, muzzle: [0, 1.35, 0.3] }
  return rig
}

export function buildNova() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('top', 'root', 0, 0.8, 0).bone('ringA', 'top', 0, 0.8, 0).bone('ringB', 'top', 0, 0.8, 0)
  rig.add('root', AZ.DARK, prism(8, 0.74, 0.62, 0.14, 0, 0, 0))
  rig.add('root', AZ.PAINT, prism(8, 0.745, 0.74, 0.04, 0, 0.04, 0))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4, c = cos(a), s = sin(a); rig.add('root', AZ.PLATE, tube(V3(c * 0.6, 0.12, s * 0.6), V3(c * 0.66, 0.6, s * 0.66), 0.07, 0.05, 5), tube(V3(c * 0.66, 0.6, s * 0.66), V3(c * 0.46, 0.92, s * 0.46), 0.05, 0.04, 5)) }
  rig.add('top', AZ.GUN, ball(0.5, 0.5, 0.5, 0, 0.8, 0, 10, 7))
  rig.add('top', AZ.PAINT, lathe([[0.505, 0.72], [0.515, 0.8], [0.505, 0.88]], 10))
  rig.add('top', AZ.ORANGE, gem(0.13, 0, 1.36, 0), prism(6, 0.16, 0.1, 0.08, 0, 1.26, 0))
  for (let k = 0; k < 6; k++) { const a = k * TAU / 6; rig.add('top', AZ.ORANGE, box(0.1, 0.22, 0.04, cos(a) * 0.49, 0.8, sin(a) * 0.49, { r: [0, -a + PI / 2, 0] })) }
  rig.add('ringA', AZ.ORANGE, ring(0.64, 0.035, 14, 4, { axis: 'z', p: [0, 0.8, 0] }))
  rig.add('ringB', AZ.PLATE, ring(0.72, 0.03, 14, 4, { axis: 'x', p: [0, 0.8, 0] }))
  // 倒计时：脉动越来越快，转环越转越快，最后鼓起来
  rig.clip('idle', 30, 1.2, false, (u, P) => { const ph = u * 2 + u * u * 7; P.s('top', 1 + 0.05 * sin(ph * TAU) + 0.16 * Math.pow(u, 4)).r('ringA', 0, u * u * 5 * TAU, 0).r('ringB', 0, 0, -u * u * 4 * TAU) })
  rig.clip('die', 4, 0.12, false, (u, P) => { P.s('root', 1 + 1.5 * u) })
  return rig
}

export const DEVICE_BUILDERS = { collector: buildCollector, sentry: buildSentry, barricade: buildBarricade, mine: buildMine, cryo: buildCryo, scorcher: buildScorcher, mortarpit: buildMortarpit, nova: buildNova }

/**
 * 空投舱（雇佣兵合同 / 霍克的空投支援共用）：四片可以掀开的外壳 + 隔热底 + 四条着陆腿 + 顶上的信标。
 * clip：idle（落地后等着被打开，信标闪）/ die（四片外壳向外掀开，顶盖弹起）
 */
export function buildDropPod() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('pod', 'root', 0, 0, 0).bone('cap', 'pod', 0, 2.2, 0)
  const PET = [[1, 0], [0, 1], [-1, 0], [0, -1]]
  PET.forEach(([c, s], k) => rig.bone('petal' + k, 'pod', c * 0.72, 0.5, s * 0.72))
  rig.add('pod', AZ.DARK, lathe([[0.0, 0.1], [0.5, 0.12], [0.86, 0.34], [0.9, 0.5], [0.0, 0.5]], 8))          // 隔热底
  rig.add('pod', AZ.ORANGE, lathe([[0.3, 0.115], [0.46, 0.125]], 8))                                        // 反推喷口的余热
  rig.add('pod', AZ.GUN, lathe([[0.6, 0.5], [0.62, 1.7], [0.42, 2.2], [0.0, 2.2]], 8))                      // 内舱
  rig.add('pod', AZ.CYAN, lathe([[0.625, 1.0], [0.63, 1.12]], 8))
  rig.add('cap', AZ.PLATE, lathe([[0.46, 2.2], [0.3, 2.46], [0.0, 2.5]], 8))
  rig.add('cap', AZ.GUN, tube(V3(0, 2.46, 0), V3(0, 2.86, 0), 0.035, 0.02, 4))
  rig.add('cap', AZ.ORANGE, gem(0.09, 0, 2.92, 0))
  PET.forEach(([c, s], k) => {
    const a = Math.atan2(s, c), b = 'petal' + k
    rig.add(b, AZ.PLATE, box(0.94, 1.56, 0.11, c * 0.79, 1.3, s * 0.79, { r: [0, -a + PI / 2, 0], taper: [0.62, 1] }))
    rig.add(b, AZ.PAINT, box(0.9, 0.24, 0.125, c * 0.795, 0.84, s * 0.795, { r: [0, -a + PI / 2, 0] }))
    rig.add(b, AZ.ORANGE, box(0.1, 0.5, 0.13, c * 0.8, 1.5, s * 0.8, { r: [0, -a + PI / 2, 0] }))
    rig.add(b, AZ.DARK, box(0.5, 0.08, 0.135, c * 0.8, 1.98, s * 0.8, { r: [0, -a + PI / 2, 0] }))
    const d = a + PI / 4, dc = cos(d), ds = sin(d)   // 着陆腿在两片外壳之间
    rig.add('pod', AZ.DARK, tube(V3(dc * 0.72, 0.62, ds * 0.72), V3(dc * 1.3, 0.05, ds * 1.3), 0.09, 0.07, 5), box(0.42, 0.07, 0.42, dc * 1.3, 0.035, ds * 1.3, { r: [0, -d, 0] }))
    rig.add('pod', AZ.PLATE, tube(V3(dc * 0.66, 1.1, ds * 0.66), V3(dc * 1.02, 0.34, ds * 1.02), 0.04, 0.04, 4))
  })
  rig.clip('idle', 8, 0.9, true, (u, P) => { P.s('cap', 1 + 0.03 * bump(u, 0, 0.3)).t('pod', 0, 0.006 * sin(u * TAU * 2), 0) })
  rig.clip('die', 10, 0.55, false, (u, P) => {
    const k = ease(Math.min(1, u * 1.5)), th = 1.32 * k + 0.12 * bump(u, 0.55, 1)
    P.r('petal0', 0, 0, -th).r('petal1', th, 0, 0).r('petal2', 0, 0, th).r('petal3', -th, 0, 0)
    P.t('cap', 0, 2.2 * u, 0).s('cap', Math.max(0.001, 1 - u * 1.2)).r('cap', 0, u * 4, 0)
  })
  rig.meta = { height: 2.9 }
  return rig
}

/** 把 Rig 的静止姿势焊成一个普通几何体（布防预览的全息虚影用；只要位置和法线） */
export function rigGeometry(rig, THREE) {
  const pos = [], nor = []
  for (const p of rig.parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo
    const P = g.attributes.position.array, N = g.attributes.normal.array
    for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]) }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return geo
}
