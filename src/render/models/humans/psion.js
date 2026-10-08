// models/humans/psion.js —— 灵能者 / 「棱镜」伊瑟拉：悬浮的袍甲人形 + 能量环
//   buildPsionic({ hero })
//   普通灵能者：分片的长袍（前后襟 + 两侧甲裙）、高立领、上翘的尖肩甲、两道反向倾斜的能量环、三枚环绕晶片
//   伊瑟拉：金饰边、背后六枚刃翼、头后日冕、右手日冕长矛（剪影 = 长矛 + 翼）
import { AZ } from '../../materials.js'
import { Rig, V3, box, cbox, slab, prism, tube, gem, ring, quad, beam, extrudeX, extrudeZ, TAU, sin, cos, bump, ease } from './hkit.js'

const PI = Math.PI

export function buildPsionic(o = {}) {
  const hero = !!o.hero
  const trim = hero ? AZ.GOLD : AZ.PLATE
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 1.1, 0).bone('head', 'body', 0, 1.62, 0)
    .bone('armR', 'body', 0.3, 1.46, 0).bone('armL', 'body', -0.3, 1.46, 0)
    .bone('ringA', 'body', 0, 1.12, 0).bone('ringB', 'body', 0, 1.12, 0).bone('orbit', 'root', 0, 1.2, 0)
    .bone('skirt', 'body', 0, 0.95, 0)
  if (hero) rig.bone('wings', 'body', 0, 1.5, -0.2).bone('halo', 'head', 0, 1.78, -0.16)

  // ---- 长袍：内衬收成一束 + 前后襟 + 两侧甲裙（一片一片的，不是一个圆锥）----
  rig.add('skirt', AZ.DARK, prism(8, 0.13, 0.24, 0.72, 0, 0.3, 0, { sz: 0.8 }))
  rig.add('skirt', AZ.DARK,
    quad(V3(-0.17, 1.0, 0.2), V3(0.17, 1.0, 0.2), V3(0.1, 0.22, 0.3), V3(-0.1, 0.22, 0.3)),                  // 前襟
    quad(V3(-0.22, 1.0, -0.2), V3(0.22, 1.0, -0.2), V3(0.2, 0.12, -0.42), V3(-0.2, 0.12, -0.42)))            // 后襟（更长，拖在身后）
  rig.add('skirt', AZ.TEAM,
    quad(V3(-0.07, 0.99, 0.205), V3(0.07, 0.99, 0.205), V3(0.04, 0.26, 0.302), V3(-0.04, 0.26, 0.302)),
    quad(V3(-0.09, 0.98, -0.205), V3(0.09, 0.98, -0.205), V3(0.07, 0.2, -0.41), V3(-0.07, 0.2, -0.41)))
  rig.add('skirt', trim, box(0.22, 0.03, 0.02, 0, 0.23, 0.302), gem(0.035, 0, 0.17, 0.3, 0.8, 1.5, 0.5))
  for (const s of [1, -1]) {   // 两侧分三段的甲裙
    rig.add('skirt', AZ.GUN, beam(V3(s * 0.22, 1.0, 0), V3(s * 0.36, 0.62, -0.04), 0.3, 0.035, { c: 0.012, ref: V3(s, 0, 0), taper: [0.85, 1] }))
    rig.add('skirt', trim, beam(V3(s * 0.34, 0.66, -0.04), V3(s * 0.4, 0.4, -0.1), 0.2, 0.03, { c: 0.01, ref: V3(s, 0, 0), taper: [0.5, 1] }))
  }
  // ---- 躯干 ----
  rig.add('body', AZ.DARK, prism(8, 0.16, 0.2, 0.16, 0, 0.98, 0))
  rig.add('body', trim, cbox(0.42, 0.07, 0.3, 0, 1.0, 0, { c: 0.025 }))                                        // 腰带
  rig.add('body', AZ.GUN, cbox(0.42, 0.4, 0.3, 0, 1.33, 0, { c: 0.06, taper: [1.25, 1.05] }))
  rig.add('body', trim, extrudeZ([[0, 1.14], [0.17, 1.3], [0.2, 1.5], [0, 1.44], [-0.2, 1.5], [-0.17, 1.3]], 0.05, 0.155, { bevel: 0.015 }))   // V 形胸甲
  rig.add('body', AZ.CYAN, gem(0.035, 0, 1.36, 0.19, 0.9, 1.5, 0.5))
  rig.add('body', AZ.GUN, extrudeX([[-0.06, 1.46], [-0.2, 1.5], [-0.24, 1.84], [-0.18, 1.9], [-0.12, 1.62]], 0.36, 0, { bevel: 0.02 }))        // 高立领（背后）
  rig.add('body', trim, box(0.3, 0.03, 0.03, 0, 1.88, -0.2))
  // 肩甲：两层，向外上翘成尖
  rig.both('body', 'body', AZ.GUN, cbox(0.26, 0.12, 0.3, 0.36, 1.5, 0, { c: 0.04, r: [0, 0, 0.35] }))
  rig.both('body', 'body', trim, slab(0.3, 0.05, 0.24, 0.4, 1.6, 0, { c: 0.03, r: [0, 0, 0.35], taper: [0.5, 0.8] }), box(0.06, 0.2, 0.06, 0.54, 1.72, 0, { taper: [0.1, 0.1], r: [0, 0, -0.35] }))
  rig.both('body', 'body', AZ.TEAM, box(0.2, 0.025, 0.12, 0.38, 1.575, 0, { r: [0, 0, 0.35] }))
  // ---- 头：窄盔 + 竖缝目镜 + 兜帽 ----
  rig.add('head', trim, cbox(0.19, 0.24, 0.23, 0, 1.69, 0.02, { c: 0.06, taper: [0.72, 0.8] }))
  rig.add('head', AZ.DARK, extrudeX([[0.06, 1.84], [-0.12, 1.86], [-0.17, 1.62], [-0.1, 1.58], [0.0, 1.8]], 0.25, 0, { bevel: 0.02 }))
  rig.add('head', AZ.CYAN, box(0.03, 0.12, 0.03, 0, 1.7, 0.125), box(0.13, 0.025, 0.03, 0, 1.73, 0.125))
  // ---- 手臂：向两侧张开，掌心托着光 ----
  rig.both('armR', 'armL', AZ.DARK, tube(V3(0.32, 1.46, 0), V3(0.52, 1.2, 0.08), 0.065, 0.055, 5))
  rig.both('armR', 'armL', AZ.GUN, beam(V3(0.52, 1.2, 0.08), V3(0.6, 1.22, 0.36), 0.11, 0.11, { c: 0.025, taper: [0.8, 0.8] }))
  rig.both('armR', 'armL', trim, box(0.13, 0.04, 0.12, 0.56, 1.27, 0.2))
  rig.add('armL', AZ.CYAN, gem(0.055, -0.61, 1.3, 0.44))
  if (!hero) rig.add('armR', AZ.CYAN, gem(0.055, 0.61, 1.3, 0.44))
  // ---- 能量环：两道反向倾斜的环 + 环上的节点 ----
  const R = hero ? 0.74 : 0.66
  rig.add('ringA', AZ.CYAN, ring(R, 0.009, 20, 3, { p: [0, 1.12, 0] }))
  rig.add('ringB', AZ.CYAN, ring(R * 0.84, 0.008, 18, 3, { p: [0, 1.12, 0] }))
  for (let k = 0; k < 3; k++) { const a = k * TAU / 3; rig.add('ringA', trim, cbox(0.07, 0.05, 0.12, cos(a) * R, 1.12, sin(a) * R, { c: 0.015, r: [0, -a, 0] })) }
  for (let k = 0; k < 2; k++) { const a = k * PI + 0.6; rig.add('ringB', trim, cbox(0.06, 0.045, 0.1, cos(a) * R * 0.84, 1.12, sin(a) * R * 0.84, { c: 0.012, r: [0, -a, 0] })) }
  // 环绕晶片
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3 + 0.5, r = 0.9
    rig.add('orbit', AZ.CYAN, gem(0.06, cos(a) * r, 1.45 + (k - 1) * 0.22, sin(a) * r, 0.6, 1.9, 0.6))
    rig.add('orbit', trim, gem(0.03, cos(a) * r, 1.3 + (k - 1) * 0.22, sin(a) * r, 0.7, 1.2, 0.7))
  }
  rig.add('root', AZ.CYAN, ring(0.3, 0.008, 12, 3, { p: [0, 0.05, 0] }))   // 脚下的悬浮环

  let muzzle = [0, 1.5, 0.45]
  if (hero) {
    // 刃翼：背后每侧三枚长刃，扇形展开（挂在 wings 骨上，开火时张开）
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const ang = 0.5 + k * 0.5, len = 0.95 - k * 0.14
      const a = V3(s * 0.16, 1.52 - k * 0.04, -0.26), b = V3(s * (0.16 + Math.sin(ang) * len), 1.52 + Math.cos(ang) * len, -0.34 - k * 0.04)
      rig.add('wings', AZ.PLATE, beam(a, b, 0.1, 0.025, { c: 0.008, taper: [0.15, 1], ref: V3(0, 0, 1) }))
      rig.add('wings', AZ.TEAM, beam(a.clone().lerp(b, 0.12), a.clone().lerp(b, 0.6), 0.04, 0.032, { c: 0, ref: V3(0, 0, 1) }))
      rig.add('wings', AZ.CYAN, gem(0.028, b.x, b.y, b.z, 0.7, 1.6, 0.7))
    }
    rig.add('wings', AZ.GOLD, cbox(0.3, 0.16, 0.1, 0, 1.52, -0.26, { c: 0.03 }))
    // 日冕
    rig.add('halo', AZ.CYAN, ring(0.3, 0.01, 16, 3, { axis: 'z', p: [0, 1.78, -0.16] }))
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; rig.add('halo', AZ.GOLD, place2(box(0.03, 0.12, 0.02, 0, 0.37, 0, { taper: [0.2, 1] }), a, [0, 1.78, -0.16])) }
    // 日冕长矛：右手竖握，矛尖发光
    rig.add('armR', AZ.GOLD, tube(V3(0.62, 0.5, 0.42), V3(0.62, 2.0, 0.42), 0.022, 0.022, 6), cbox(0.1, 0.08, 0.1, 0.62, 2.0, 0.42, { c: 0.02 }), cbox(0.07, 0.1, 0.07, 0.62, 0.5, 0.42, { c: 0.02 }))
    rig.add('armR', AZ.PLATE, extrudeX([[0.42, 2.02], [0.5, 2.2], [0.42, 2.62], [0.34, 2.2]], 0.03, 0.62, { bevel: 0.01 }))
    rig.add('armR', AZ.CYAN, box(0.025, 0.36, 0.035, 0.62, 2.28, 0.42))
    muzzle = [0.62, 2.55, 0.42]
  }

  const hover = (u, P, amp = 1) => {
    const s = sin(u * TAU)
    P.t('body', 0, 0.055 * s * amp, 0).r('skirt', 0.03 * sin(u * TAU + 1.2), 0, 0)
    P.r('ringA', 0.42, u * TAU, 0.18).r('ringB', -0.5, -u * TAU, -0.3).r('orbit', 0, u * TAU, 0)
    if (hero) P.r('halo', 0, 0, u * TAU / 8).r('wings', 0.03 * s, 0, 0)
  }
  rig.clip('idle', 16, 3.2, true, (u, P) => { hover(u, P); P.r('armR', 0.06 * sin(u * TAU), 0, 0).r('armL', 0.06 * sin(u * TAU + 1), 0, 0) })
  rig.clip('walk', 16, 3.2, true, (u, P) => { hover(u, P); P.r('body', 0.14, 0, 0).r('skirt', 0.22, 0, 0).r('head', -0.1, 0, 0) })
  rig.clip('shoot', 12, 0.9, false, (u, P) => {
    const k = bump(u, 0, 1), k2 = Math.pow(k, 0.6)
    P.t('body', 0, 0.2 * k2, 0).r('body', -0.08 * k2, 0, 0).r('head', -0.2 * k2, 0, 0)
    P.r('armL', -1.3 * k2, 0, -0.35 * k2)
    if (hero) P.r('armR', 0.5 * k2, 0, 0).t('armR', 0, 0.12 * k2, 0.1 * k2).s('wings', 1 + 0.3 * k2).s('halo', 1 + 0.4 * k2)
    else P.r('armR', -1.3 * k2, 0, 0.35 * k2)
    P.r('ringA', 0.42 * (1 - k2), u * TAU * 1.5, 0.18).r('ringB', -0.5 * (1 - k2), -u * TAU * 1.5, -0.3).s('ringA', 1 + 0.35 * k2).s('ringB', 1 + 0.5 * k2).t('ringB', 0, 0.35 * k2, 0)
    P.r('orbit', 0, u * TAU, 0).s('orbit', 1 + 0.3 * k2)
  })
  rig.clip('die', 12, 1.1, false, (u, P) => {
    const k = ease(u), f = ease(Math.max(0, (u - 0.25) / 0.75))
    // 能量环先熄灭收缩，人再坠地
    P.s('ringA', 1 - 0.97 * Math.min(1, u * 3)).s('ringB', 1 - 0.97 * Math.min(1, u * 2.4)).s('orbit', 1 - 0.97 * k).t('orbit', 0, -1.0 * k, 0)
    P.t('body', 0, -0.62 * f, 0).r('root', 1.25 * f, 0.3 * f, 0.2 * f).r('armR', 0.8 * f, 0, 0).r('armL', 0.6 * f, 0, 0).r('head', 0.4 * k, 0, 0)
    if (hero) P.s('halo', 1 - 0.97 * k).r('wings', -0.6 * f, 0, 0)
  })
  rig.meta = { muzzle }
  return rig
}

// 把在原点、沿 +Y 建好的零件绕 Z 转 a 再平移（日冕的放射尖）
function place2(g, a, p) { g.rotateZ(a); g.translate(p[0], p[1], p[2]); g.computeVertexNormals(); return g }
