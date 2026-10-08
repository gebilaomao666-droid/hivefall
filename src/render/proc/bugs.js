// proc/bugs.js —— 噬渊虫群：程序化节肢虫（原创造型，零外部素材）
// 每个虫种一张零件表 + 几段姿态函数。小虫控制在 350 面以内（要画 3400 只），中大型 800~1600 面。
// 统一 clip：walk / attack / die（飞行虫的 walk 就是飞，卵的 walk 就是搏动）。
import { CZ } from '../materials.js'
import { Rig, V3, box, prism, tube, ball, dome, gem, lathe, quad, ring, chain, TAU, sin, cos, bump, ease } from './kit.js'

const PI = Math.PI
const SM = { smooth: true }

/**
 * 成对的步足。list: [{ z, dz, reach, phase, knee?, hipX?, hipY?, r? }]；o 是公共参数。
 * 每条腿一根骨头（绕髋关节摆动 + 抬脚）。返回 gait(u, P, amp) 姿态函数：交替三角步态。
 */
function legSet(rig, parent, list, o) {
  const legs = []
  list.forEach((l, i) => {
    const q = { ...o, ...l }
    for (const side of [1, -1]) {
      const name = `leg${i}${side > 0 ? 'R' : 'L'}`
      const hip = V3(side * q.hipX, q.hipY, q.z)
      const knee = V3(side * (q.hipX + q.reach * 0.5), q.hipY + q.knee, q.z + q.dz * 0.45)
      const foot = V3(side * (q.hipX + q.reach), 0.0, q.z + q.dz)
      rig.bone(name, parent, hip.x, hip.y, hip.z)
      rig.add(name, q.zone ?? CZ.LIMB, tube(hip, knee, q.r, q.r * 0.72, q.sides, SM))
      rig.add(name, q.tip ?? CZ.LIMB, tube(knee, foot, q.r * 0.72, 0.0, q.sides, SM))
      legs.push({ name, side, phase: q.phase + (side > 0 ? 0 : PI), swing: q.swing, lift: q.lift })
    }
  })
  const gait = (u, P, amp = 1) => { for (const l of legs) { const t = u * TAU + l.phase; P.r(l.name, 0, -l.side * l.swing * cos(t) * amp, l.side * l.lift * Math.max(0, -sin(t)) * amp) } }
  gait.curl = (P, k) => { for (const l of legs) P.r(l.name, 0, 0, l.side * 1.15 * k) }     // 死亡时蜷腿
  gait.splay = (P, k) => { for (const l of legs) P.r(l.name, 0, 0, -l.side * 0.35 * k) }   // 趴下
  return gait
}
/** 通用死亡：侧翻 + 蜷腿 + 略微弹起（小虫 0.45 秒翻完，之后的下沉/变暗由实例参数做） */
function flipDeath(rig, gait, dur = 0.5, body = 'body', dir = 1) {
  rig.clip('die', 8, dur, false, (u, P) => {
    const k = ease(u)
    P.r('root', 0, 0, dir * PI * 0.92 * k).t('root', 0, bump(u, 0, 1) * 0.35 + 0.12 * k, 0)
    gait.curl(P, k)
  })
}

// ------------------------------------------------------------------ 裂爪虫（海量近战）
export function buildLing() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.12, 0).bone('body', 'root', 0, 0.19, 0.05).bone('tail', 'body', 0, 0.21, -0.08).bone('sR', 'body', 0.1, 0.2, 0.16).bone('sL', 'body', -0.1, 0.2, 0.16)
  rig.add('tail', CZ.SHELL, ball(0.17, 0.115, 0.27, 0, 0.215, -0.23, 8, 5, [-0.18, 0, 0]))
  rig.add('body', CZ.SHELL2, ball(0.13, 0.10, 0.17, 0, 0.185, 0.07, 7, 4))
  rig.add('body', CZ.LIMB, ball(0.105, 0.075, 0.125, 0, 0.165, 0.29, 6, 4))
  rig.add('body', CZ.GLOW, gem(0.03, 0.065, 0.205, 0.36), gem(0.03, -0.065, 0.205, 0.36))
  rig.add('tail', CZ.GLOW, ball(0.04, 0.022, 0.085, 0, 0.335, -0.27, 5, 3, [-0.18, 0, 0]))
  rig.add('tail', CZ.BONE, tube(V3(0, 0.3, -0.12), V3(0, 0.43, -0.2), 0.035, 0, 3), tube(V3(0, 0.3, -0.38), V3(0, 0.4, -0.52), 0.03, 0, 3))
  rig.add('body', CZ.BONE, tube(V3(0.05, 0.13, 0.38), V3(0.02, 0.09, 0.56), 0.028, 0, 3), tube(V3(-0.05, 0.13, 0.38), V3(-0.02, 0.09, 0.56), 0.028, 0, 3))
  for (const s of [1, -1]) {   // 镰肢
    const a = V3(s * 0.1, 0.2, 0.16), b = V3(s * 0.22, 0.4, 0.33), c = V3(s * 0.14, 0.04, 0.66), n = s > 0 ? 'sR' : 'sL'
    rig.add(n, CZ.LIMB, tube(a, b, 0.04, 0.03, 3, SM)); rig.add(n, CZ.BONE, tube(b, c, 0.036, 0, 3, SM))
  }
  const L = { hipX: 0.09, hipY: 0.17, reach: 0.4, knee: 0.2, r: 0.032, sides: 3, swing: 0.5, lift: 0.4 }
  const gait = legSet(rig, 'body', [{ z: 0.13, dz: 0.16, phase: 0 }, { z: 0.02, dz: -0.04, phase: PI, reach: 0.45 }, { z: -0.08, dz: -0.27, phase: 0 }], L)
  rig.clip('walk', 10, 0.42, true, (u, P) => {
    gait(u, P); const a = u * TAU
    P.t('body', 0, 0.012 * sin(a * 2), 0).r('body', 0, 0.05 * sin(a), 0).r('tail', 0, 0.12 * sin(a + 0.6), 0).r('sR', 0.22 * sin(a * 2), 0, 0).r('sL', 0.22 * sin(a * 2 + 1.6), 0, 0)
  })
  rig.clip('attack', 6, 0.3, true, (u, P) => {
    const k = bump(u, 0, 0.7)
    P.t('body', 0, 0.06 * k, 0.12 * k).r('body', -0.35 * k, 0, 0).r('sR', -1.0 * k + 0.9 * bump(u, 0.4, 1), 0, 0).r('sL', -1.0 * k + 0.9 * bump(u, 0.45, 1), 0, 0); gait(u * 0.5, P, 0.4)
  })
  flipDeath(rig, gait, 0.45)
  return rig
}

// ------------------------------------------------------------------ 脓爆虫（自爆）：顶着一个发光脓囊
export function buildBurster() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.1, 0).bone('body', 'root', 0, 0.2, 0).bone('sac', 'body', 0, 0.3, -0.08)
  rig.add('body', CZ.SHELL2, ball(0.16, 0.11, 0.24, 0, 0.19, 0.06, 7, 4))
  rig.add('body', CZ.LIMB, ball(0.1, 0.08, 0.12, 0, 0.17, 0.3, 6, 4))
  rig.add('body', CZ.GLOW, gem(0.03, 0.06, 0.2, 0.37), gem(0.03, -0.06, 0.2, 0.37))
  rig.add('sac', CZ.GLOW2, ball(0.27, 0.25, 0.3, 0, 0.42, -0.1, 9, 6))
  for (let k = 0; k < 3; k++) rig.add('sac', CZ.SHELL, ring(0.27 * cos((k - 1) * 0.6), 0.03, 9, 3, { axis: 'z', p: [0, 0.42, -0.1 + (k - 1) * 0.17], smooth: true }))
  rig.add('sac', CZ.BONE, tube(V3(0, 0.64, -0.1), V3(0, 0.78, -0.16), 0.035, 0, 4))
  const gait = legSet(rig, 'body', [{ z: 0.16, dz: 0.14, phase: 0 }, { z: 0.02, dz: 0, phase: PI }, { z: -0.12, dz: -0.18, phase: 0 }], { hipX: 0.1, hipY: 0.17, reach: 0.36, knee: 0.16, r: 0.035, sides: 3, swing: 0.55, lift: 0.4 })
  rig.clip('walk', 10, 0.36, true, (u, P) => { gait(u, P); const a = u * TAU; P.t('body', 0, 0.015 * sin(a * 2), 0).s('sac', 1 + 0.05 * sin(a * 2)).r('sac', 0.06 * sin(a), 0, 0.05 * sin(a + 1)) })
  rig.clip('attack', 6, 0.25, true, (u, P) => { P.s('sac', 1 + 0.35 * u) })
  rig.clip('die', 6, 0.25, false, (u, P) => { const k = ease(u); P.s('sac', 1 + 0.5 * bump(u, 0, 0.4) - 0.95 * k).r('root', 0, 0, 1.6 * k); gait.curl(P, k) })
  return rig
}

// ------------------------------------------------------------------ 刺脊虫（远程）：昂起的长颈 + 脊刺冠 + 咽囊
export function buildSpitter() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.12, 0).bone('body', 'root', 0, 0.3, 0).bone('neck', 'body', 0, 0.42, 0.18).bone('head', 'neck', 0, 0.78, 0.4).bone('tail', 'body', 0, 0.3, -0.25)
  rig.add('body', CZ.SHELL, ball(0.2, 0.17, 0.34, 0, 0.32, -0.02, 8, 5, [-0.15, 0, 0]))
  rig.add('tail', CZ.SHELL2, chain([V3(0, 0.3, -0.28), V3(0, 0.36, -0.55), V3(0, 0.26, -0.8)], [0.11, 0.07, 0.0], 5, SM))
  rig.add('neck', CZ.SHELL2, chain([V3(0, 0.4, 0.16), V3(0, 0.62, 0.3), V3(0, 0.8, 0.4)], [0.12, 0.09, 0.075], 6, SM))
  rig.add('neck', CZ.GLOW2, ball(0.1, 0.11, 0.1, 0, 0.55, 0.36, 6, 4))   // 咽囊
  rig.add('head', CZ.LIMB, ball(0.1, 0.085, 0.16, 0, 0.82, 0.48, 6, 4, [0.25, 0, 0]))
  rig.add('head', CZ.GLOW, gem(0.03, 0.07, 0.86, 0.55), gem(0.03, -0.07, 0.86, 0.55))
  rig.add('head', CZ.BONE, tube(V3(0.05, 0.76, 0.6), V3(0.02, 0.7, 0.74), 0.025, 0, 3), tube(V3(-0.05, 0.76, 0.6), V3(-0.02, 0.7, 0.74), 0.025, 0, 3))
  for (let i = 0; i < 5; i++) { const t = i / 4; rig.add(i < 2 ? 'head' : 'neck', CZ.BONE, tube(V3(0, 0.9 - t * 0.38, 0.42 - t * 0.3), V3(0, 1.16 - t * 0.42, 0.22 - t * 0.42), 0.028, 0, 3)) }
  for (let i = 0; i < 3; i++) rig.add('body', CZ.BONE, tube(V3(0, 0.46, -0.05 - i * 0.12), V3(0, 0.68 - i * 0.05, -0.16 - i * 0.14), 0.03, 0, 3))
  const gait = legSet(rig, 'body', [{ z: 0.12, dz: 0.2, phase: 0 }, { z: -0.12, dz: -0.2, phase: PI }], { hipX: 0.14, hipY: 0.28, reach: 0.42, knee: 0.22, r: 0.045, sides: 4, swing: 0.45, lift: 0.35, tip: CZ.BONE })
  rig.clip('walk', 12, 0.6, true, (u, P) => { gait(u, P); const a = u * TAU; P.t('body', 0, 0.015 * sin(a * 2), 0).r('neck', 0.06 * sin(a * 2), 0.08 * sin(a), 0).r('tail', 0, 0.2 * sin(a + 1), 0) })
  rig.clip('attack', 10, 0.6, false, (u, P) => { const w = bump(u, 0, 0.5), f = bump(u, 0.4, 1); P.r('neck', -0.5 * w + 0.7 * f, 0, 0).r('head', -0.3 * w + 0.4 * f, 0, 0).r('body', -0.1 * w + 0.1 * f, 0, 0).s('neck', 1 + 0.1 * w) })
  flipDeath(rig, gait, 0.6)
  return rig
}

// ------------------------------------------------------------------ 甲壳兽（重甲中坚）
export function buildCrusher() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.2, 0).bone('body', 'root', 0, 0.4, 0).bone('head', 'body', 0, 0.36, 0.34)
  rig.add('body', CZ.SHELL, ball(0.40, 0.26, 0.50, 0, 0.40, -0.16, 12, 7, [-0.06, 0, 0]))
  rig.add('body', CZ.SHELL2, ball(0.09, 0.07, 0.50, 0, 0.635, -0.16, 6, 5, [-0.06, 0, 0]))
  rig.add('head', CZ.SHELL2, ball(0.33, 0.215, 0.23, 0, 0.37, 0.34, 10, 6, [0.12, 0, 0]))
  rig.add('head', CZ.LIMB, ball(0.17, 0.12, 0.15, 0, 0.27, 0.6, 7, 5))
  const glows = [gem(0.045, 0.11, 0.33, 0.69), gem(0.045, -0.11, 0.33, 0.69)]
  rig.add('head', CZ.GLOW, glows)
  for (const s of [1, -1]) for (let i = 0; i < 4; i++) rig.add('body', CZ.GLOW, ball(0.03, 0.024, 0.06, s * (0.345 - i * 0.012), 0.52 - Math.abs(i - 1.2) * 0.02, -0.46 + i * 0.2, 5, 3, [0, 0, -s * 0.9]))
  rig.add('head', CZ.BONE, tube(V3(0, 0.36, 0.62), V3(0, 0.56, 0.9), 0.075, 0.05, 5, SM), tube(V3(0, 0.56, 0.9), V3(0, 0.86, 0.98), 0.05, 0, 5, SM))
  for (const s of [1, -1]) {
    rig.add('head', CZ.BONE, tube(V3(s * 0.1, 0.2, 0.68), V3(s * 0.2, 0.16, 0.9), 0.05, 0.035, 4, SM), tube(V3(s * 0.2, 0.16, 0.9), V3(s * 0.06, 0.12, 1.05), 0.035, 0, 4, SM))
    for (let i = 0; i < 3; i++) rig.add('body', CZ.BONE, tube(V3(s * 0.3, 0.55, -0.42 + i * 0.26), V3(s * 0.46, 0.74, -0.5 + i * 0.26), 0.05, 0, 4))
  }
  const gait = legSet(rig, 'body', [{ z: 0.34, dz: 0.2, phase: 0 }, { z: 0.06, dz: -0.02, phase: PI, reach: 0.6 }, { z: -0.2, dz: -0.3, phase: 0, reach: 0.55 }], { hipX: 0.22, hipY: 0.26, reach: 0.52, knee: 0.27, r: 0.075, sides: 5, swing: 0.34, lift: 0.26 })
  rig.clip('walk', 14, 0.8, true, (u, P) => { gait(u, P); const a = u * TAU; P.t('body', 0, 0.012 * sin(a * 2), 0).r('body', 0, 0.025 * sin(a), 0).r('head', 0.04 * sin(a * 2), 0, 0) })
  rig.clip('attack', 10, 0.7, false, (u, P) => { const w = bump(u, 0, 0.55), f = bump(u, 0.45, 1); P.r('body', -0.3 * w + 0.12 * f, 0, 0).t('body', 0, 0.1 * w, 0.18 * f).r('head', -0.35 * w + 0.5 * f, 0, 0) })
  rig.clip('die', 10, 0.8, false, (u, P) => { const k = ease(u); P.r('root', 0.12 * k, 0, 0.5 * k).t('root', 0, -0.12 * k, 0).r('head', 0.5 * k, 0, 0); gait.splay(P, k) })
  return rig
}

// ------------------------------------------------------------------ 巨畸体（巨型肉盾）：拄着两条巨臂走
export function buildHulk() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.3, 0).bone('body', 'root', 0, 0.7, -0.1).bone('head', 'body', 0, 0.62, 0.42)
    .bone('armR', 'body', 0.42, 0.85, 0.22).bone('foreR', 'armR', 0.78, 0.55, 0.42).bone('armL', 'body', -0.42, 0.85, 0.22).bone('foreL', 'armL', -0.78, 0.55, 0.42)
    .bone('hindR', 'body', 0.3, 0.45, -0.4).bone('hindL', 'body', -0.3, 0.45, -0.4)
  rig.add('body', CZ.SHELL, ball(0.55, 0.5, 0.62, 0, 0.78, -0.1, 12, 8, [-0.3, 0, 0]))
  rig.add('body', CZ.FLESH, ball(0.42, 0.34, 0.45, 0, 0.5, -0.05, 9, 6))
  rig.add('body', CZ.SHELL2, ball(0.3, 0.2, 0.5, 0, 1.12, -0.2, 8, 5, [-0.35, 0, 0]))
  for (let i = 0; i < 5; i++) rig.add('body', CZ.BONE, tube(V3((i - 2) * 0.17, 1.12 - Math.abs(i - 2) * 0.06, -0.22), V3((i - 2) * 0.26, 1.55 - Math.abs(i - 2) * 0.1, -0.5), 0.07, 0, 4))
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) rig.add('body', CZ.GLOW, ball(0.05, 0.07, 0.05, s * (0.45 - i * 0.05), 0.75 - i * 0.06, 0.15 - i * 0.22, 5, 3))
  rig.add('head', CZ.LIMB, ball(0.2, 0.17, 0.22, 0, 0.6, 0.5, 8, 5))
  rig.add('head', CZ.GLOW, gem(0.035, 0.1, 0.67, 0.68), gem(0.035, -0.1, 0.67, 0.68), gem(0.028, 0.15, 0.6, 0.62), gem(0.028, -0.15, 0.6, 0.62))
  rig.add('head', CZ.BONE, tube(V3(0.1, 0.5, 0.66), V3(0.06, 0.36, 0.78), 0.045, 0, 4), tube(V3(-0.1, 0.5, 0.66), V3(-0.06, 0.36, 0.78), 0.045, 0, 4))
  for (const s of [1, -1]) {
    const A = s > 0 ? 'armR' : 'armL', F = s > 0 ? 'foreR' : 'foreL', H = s > 0 ? 'hindR' : 'hindL'
    rig.add(A, CZ.SHELL2, tube(V3(s * 0.42, 0.85, 0.22), V3(s * 0.78, 0.55, 0.42), 0.2, 0.16, 6, SM), ball(0.24, 0.2, 0.24, s * 0.45, 0.9, 0.2, 7, 5))
    rig.add(F, CZ.LIMB, tube(V3(s * 0.78, 0.55, 0.42), V3(s * 0.72, 0.12, 0.7), 0.17, 0.2, 6, SM))
    rig.add(F, CZ.BONE, ball(0.21, 0.14, 0.24, s * 0.72, 0.12, 0.74, 7, 4), tube(V3(s * 0.8, 0.12, 0.9), V3(s * 0.86, 0.02, 1.08), 0.06, 0, 4), tube(V3(s * 0.64, 0.12, 0.92), V3(s * 0.62, 0.02, 1.1), 0.06, 0, 4), tube(V3(s * 0.84, 0.6, 0.38), V3(s * 1.02, 0.86, 0.3), 0.07, 0, 4))
    rig.add(H, CZ.LIMB, tube(V3(s * 0.3, 0.45, -0.4), V3(s * 0.46, 0.3, -0.62), 0.15, 0.11, 5, SM), tube(V3(s * 0.46, 0.3, -0.62), V3(s * 0.44, 0.0, -0.5), 0.11, 0.06, 5, SM))
  }
  rig.clip('walk', 14, 1.2, true, (u, P) => {
    const a = u * TAU, s = sin(a), c = cos(a)
    P.r('armR', -0.35 * s, 0, 0).r('armL', 0.35 * s, 0, 0).r('foreR', 0.25 * Math.max(0, c), 0, 0).r('foreL', 0.25 * Math.max(0, -c), 0, 0)
    P.r('hindR', 0.4 * s, 0, 0).r('hindL', -0.4 * s, 0, 0).t('body', 0, 0.03 * Math.abs(c), 0).r('body', 0.03 * c, 0.06 * s, 0.05 * s).r('head', 0, -0.1 * s, 0)
  })
  rig.clip('attack', 12, 1.0, false, (u, P) => {
    const w = bump(u, 0, 0.6), f = bump(u, 0.5, 1)
    P.r('body', -0.45 * w + 0.35 * f, 0, 0).t('body', 0, 0.2 * w - 0.1 * f, 0.15 * f).r('armR', -1.9 * w + 0.5 * f, 0, 0).r('armL', -1.9 * w + 0.5 * f, 0, 0).r('head', -0.2 * w, 0, 0)
  })
  rig.clip('die', 12, 1.1, false, (u, P) => { const k = ease(u); P.r('root', 0.35 * k, 0, 0.35 * k).t('root', 0, -0.22 * k, 0.2 * k).r('armR', 0.4 * k, 0, 0.9 * k).r('armL', 0.4 * k, 0, -0.9 * k).r('head', 0.6 * k, 0, 0) })
  return rig
}

// ------------------------------------------------------------------ 翼螫（飞行）
export function buildWing() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.3, 0).bone('body', 'root', 0, 0.3, 0).bone('tail', 'body', 0, 0.28, -0.15)
  for (const [n, s, z] of [['w0R', 1, 0.1], ['w0L', -1, 0.1], ['w1R', 1, -0.08], ['w1L', -1, -0.08]]) rig.bone(n, 'body', s * 0.08, 0.38, z)
  rig.add('body', CZ.SHELL2, ball(0.12, 0.11, 0.2, 0, 0.3, 0.05, 7, 5))
  rig.add('body', CZ.LIMB, ball(0.09, 0.08, 0.11, 0, 0.28, 0.27, 6, 4))
  rig.add('body', CZ.GLOW, gem(0.035, 0.06, 0.31, 0.33, 1, 0.8, 1.3), gem(0.035, -0.06, 0.31, 0.33, 1, 0.8, 1.3))
  rig.add('tail', CZ.SHELL, chain([V3(0, 0.28, -0.12), V3(0, 0.2, -0.42), V3(0, 0.06, -0.6)], [0.1, 0.07, 0.03], 5, SM))
  rig.add('tail', CZ.GLOW2, ball(0.055, 0.055, 0.08, 0, 0.13, -0.52, 5, 4))
  rig.add('tail', CZ.BONE, tube(V3(0, 0.06, -0.6), V3(0, -0.06, -0.46), 0.03, 0, 3))
  rig.add('body', CZ.BONE, tube(V3(0.05, 0.22, 0.3), V3(0.08, 0.05, 0.42), 0.025, 0, 3), tube(V3(-0.05, 0.22, 0.3), V3(-0.08, 0.05, 0.42), 0.025, 0, 3), tube(V3(0.06, 0.2, 0.05), V3(0.12, 0.0, 0.1), 0.02, 0, 3), tube(V3(-0.06, 0.2, 0.05), V3(-0.12, 0.0, 0.1), 0.02, 0, 3))
  for (const [n, s, z, len, sw] of [['w0R', 1, 0.1, 0.78, 0.18], ['w0L', -1, 0.1, 0.78, 0.18], ['w1R', 1, -0.08, 0.58, -0.22], ['w1L', -1, -0.08, 0.58, -0.22]]) {
    rig.add(n, CZ.MEMBRANE, quad(V3(s * 0.08, 0.38, z + 0.06), V3(s * 0.08, 0.38, z - 0.08), V3(s * len, 0.42, z - 0.2 + sw), V3(s * len * 0.92, 0.44, z + 0.12 + sw)))
    rig.add(n, CZ.LIMB, tube(V3(s * 0.08, 0.385, z + 0.06), V3(s * len * 0.92, 0.445, z + 0.12 + sw), 0.018, 0.006, 3))
  }
  const flap = (u, P, amp, tilt) => { const a = u * TAU; P.r('w0R', 0, 0, (0.75 * sin(a) + tilt) * amp).r('w0L', 0, 0, -(0.75 * sin(a) + tilt) * amp).r('w1R', 0, 0, (0.75 * sin(a + 0.9) + tilt) * amp).r('w1L', 0, 0, -(0.75 * sin(a + 0.9) + tilt) * amp) }
  rig.clip('walk', 6, 0.16, true, (u, P) => { flap(u, P, 1, 0.15); P.t('body', 0, 0.03 * sin(u * TAU), 0).r('tail', 0.1 * sin(u * TAU), 0, 0) })
  rig.clip('attack', 6, 0.2, true, (u, P) => { flap(u, P, 0.35, 0.9); P.r('body', 0.5, 0, 0).r('tail', 0.7, 0, 0) })
  rig.clip('die', 8, 0.6, false, (u, P) => { const k = ease(u); flap(u * 2, P, 1 - k, 1.2 * k); P.r('root', 1.2 * k, 0, 2.6 * k).r('tail', 0.8 * k, 0, 0) })
  return rig
}

// ------------------------------------------------------------------ 掘地虫（钻地）：粗短节肢 + 四瓣钻颚
export function buildDigger() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.2, 0).bone('body', 'root', 0, 0.3, 0).bone('head', 'body', 0, 0.3, 0.3)
  for (let k = 0; k < 4; k++) rig.bone('jaw' + k, 'head', cos(k * PI / 2 + PI / 4) * 0.1, 0.3 + sin(k * PI / 2 + PI / 4) * 0.1, 0.45)
  for (let i = 0; i < 4; i++) {
    const z = 0.2 - i * 0.24, r = 0.25 - i * 0.025
    rig.add('body', i % 2 ? CZ.SHELL2 : CZ.SHELL, ball(r, r * 0.85, 0.17, 0, 0.3, z, 9, 5))
    rig.add('body', CZ.GLOW, ring(r * 0.93, 0.018, 9, 3, { axis: 'z', p: [0, 0.3, z - 0.12] }))
    if (i > 0) rig.add('body', CZ.BONE, tube(V3(0, 0.3 + r * 0.8, z), V3(0, 0.3 + r + 0.16, z - 0.1), 0.04, 0, 3))
  }
  rig.add('head', CZ.LIMB, ball(0.2, 0.19, 0.18, 0, 0.3, 0.4, 8, 5))
  rig.add('head', CZ.GLOW, ball(0.09, 0.09, 0.05, 0, 0.3, 0.55, 6, 4))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4, cx = cos(a), sy = sin(a); rig.add('jaw' + k, CZ.BONE, tube(V3(cx * 0.14, 0.3 + sy * 0.14, 0.45), V3(cx * 0.2, 0.3 + sy * 0.2, 0.68), 0.07, 0.055, 4, SM), tube(V3(cx * 0.2, 0.3 + sy * 0.2, 0.68), V3(cx * 0.03, 0.3 + sy * 0.03, 0.98), 0.055, 0, 4, SM)) }
  const gait = legSet(rig, 'body', [{ z: 0.2, dz: 0.1, phase: 0 }, { z: -0.05, dz: 0, phase: PI }, { z: -0.3, dz: -0.1, phase: 0 }], { hipX: 0.18, hipY: 0.22, reach: 0.34, knee: 0.14, r: 0.05, sides: 4, swing: 0.5, lift: 0.35, tip: CZ.BONE })
  const jaws = (P, open) => { for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; P.r('jaw' + k, -sin(a) * open, cos(a) * open, 0) } }
  rig.clip('walk', 12, 0.6, true, (u, P) => { gait(u, P); const a = u * TAU; P.r('body', 0, 0.06 * sin(a), 0).r('head', 0, 0, a); jaws(P, 0.05) })
  rig.clip('attack', 8, 0.5, false, (u, P) => { const k = bump(u, 0, 1); jaws(P, 0.6 * bump(u, 0, 0.6)); P.t('head', 0, 0, 0.18 * bump(u, 0.4, 1)).r('body', -0.25 * k, 0, 0) })
  rig.clip('emerge', 8, 0.5, false, (u, P) => { const k = 1 - ease(u); P.t('root', 0, -0.9 * k, 0).r('root', -1.2 * k, 0, 0).r('head', 0, 0, u * 9); jaws(P, 0.5 * k) })
  flipDeath(rig, gait, 0.6)
  return rig
}

// ------------------------------------------------------------------ 护巢虫（光环）：高脚 + 顶着发光的冠
export function buildWarden() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.3, 0).bone('body', 'root', 0, 0.75, 0).bone('crown', 'body', 0, 1.1, 0)
  rig.add('body', CZ.SHELL2, lathe([[0.0, 0.5], [0.16, 0.56], [0.22, 0.75], [0.16, 0.98], [0.1, 1.08], [0.0, 1.1]], 8, SM))
  rig.add('body', CZ.FLESH, ball(0.17, 0.2, 0.17, 0, 0.62, 0, 7, 5))
  rig.add('body', CZ.GLOW, gem(0.035, 0.1, 0.92, 0.17), gem(0.035, -0.1, 0.92, 0.17), gem(0.03, 0, 0.84, 0.21))
  rig.add('crown', CZ.GLOW2, ball(0.17, 0.17, 0.17, 0, 1.3, 0, 8, 6))
  for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + 0.3, cx = cos(a), sz = sin(a); rig.add('crown', CZ.BONE, tube(V3(cx * 0.1, 1.06, sz * 0.1), V3(cx * 0.36, 1.26, sz * 0.36), 0.05, 0.035, 4, SM), tube(V3(cx * 0.36, 1.26, sz * 0.36), V3(cx * 0.2, 1.62, sz * 0.2), 0.035, 0, 4, SM)) }
  for (let k = 0; k < 3; k++) { const a = k * TAU / 3, cx = cos(a), sz = sin(a); rig.add('body', CZ.FLESH, tube(V3(cx * 0.12, 0.55, sz * 0.12), V3(cx * 0.2, 0.2, sz * 0.2), 0.03, 0.01, 3, SM)) }
  const legs = []
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2 + PI / 4, cx = cos(a), sz = sin(a), n = 'leg' + k
    rig.bone(n, 'body', cx * 0.14, 0.66, sz * 0.14)
    rig.add(n, CZ.LIMB, tube(V3(cx * 0.14, 0.66, sz * 0.14), V3(cx * 0.5, 0.96, sz * 0.5), 0.05, 0.04, 4, SM))
    rig.add(n, CZ.BONE, tube(V3(cx * 0.5, 0.96, sz * 0.5), V3(cx * 0.66, 0.0, sz * 0.66), 0.04, 0.0, 4, SM))
    legs.push({ n, cx, sz, ph: k % 2 ? 0 : PI })
  }
  const step = (u, P, amp) => { for (const l of legs) { const t = u * TAU + l.ph; P.r(l.n, 0.22 * cos(t) * amp, 0, 0.0).t(l.n, 0, 0.08 * Math.max(0, -sin(t)) * amp, 0) } }
  rig.clip('walk', 14, 1.0, true, (u, P) => { step(u, P, 1); const a = u * TAU; P.t('body', 0, 0.025 * sin(a * 2), 0).s('crown', 1 + 0.08 * sin(a)).r('crown', 0, a * 0.2, 0) })
  rig.clip('attack', 10, 1.0, true, (u, P) => { const a = u * TAU; P.s('crown', 1.15 + 0.2 * sin(a)).t('body', 0, 0.04 * sin(a), 0) })
  rig.clip('die', 10, 0.9, false, (u, P) => { const k = ease(u); P.t('body', 0, -0.62 * k, 0).r('body', 0.5 * k, 0, 0.4 * k).s('crown', 1 - 0.7 * k); for (const l of legs) P.r(l.n, 0, 0, 0).t(l.n, 0, 0.0, 0).r(l.n, l.sz * 0.7 * k, 0, -l.cx * 0.7 * k) })
  return rig
}

// ------------------------------------------------------------------ 虫卵
export function buildEgg() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('egg', 'root', 0, 0, 0)
  rig.add('egg', CZ.FLESH, lathe([[0.0, 0.0], [0.2, 0.03], [0.3, 0.22], [0.26, 0.5], [0.14, 0.7], [0.0, 0.76]], 9, SM))
  rig.add('egg', CZ.GLOW2, ball(0.16, 0.2, 0.16, 0, 0.34, 0, 7, 5))
  for (let k = 0; k < 5; k++) { const a = k * TAU / 5; rig.add('root', CZ.LIMB, tube(V3(cos(a) * 0.2, 0.1, sin(a) * 0.2), V3(cos(a) * 0.48, 0.0, sin(a) * 0.48), 0.06, 0.015, 4, SM)); rig.add('egg', CZ.SHELL2, tube(V3(cos(a) * 0.27, 0.12, sin(a) * 0.27), V3(cos(a) * 0.16, 0.66, sin(a) * 0.16), 0.035, 0.012, 3, SM)) }
  rig.clip('walk', 8, 0.9, true, (u, P) => { const s = sin(u * TAU); P.s('egg', 1 + 0.06 * s, 1 - 0.05 * s, 1 + 0.06 * s) })
  rig.clip('attack', 8, 0.4, true, (u, P) => { const s = sin(u * TAU); P.s('egg', 1 + 0.14 * s, 1 - 0.1 * s, 1 + 0.14 * s) })
  rig.clip('die', 6, 0.35, false, (u, P) => { const k = ease(u); P.s('egg', 1 + 0.3 * k, 1 - 0.85 * k, 1 + 0.3 * k) })
  return rig
}

// ------------------------------------------------------------------ 举盾虫（§13）：正面一块大骨盾
export function buildShieldbug() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.15, 0).bone('body', 'root', 0, 0.32, 0).bone('shield', 'body', 0, 0.3, 0.3)
  rig.add('body', CZ.SHELL, ball(0.27, 0.2, 0.4, 0, 0.32, -0.12, 9, 5))
  rig.add('body', CZ.LIMB, ball(0.13, 0.11, 0.14, 0, 0.27, 0.27, 6, 4))
  rig.add('body', CZ.GLOW, gem(0.03, 0.07, 0.34, 0.33), gem(0.03, -0.07, 0.34, 0.33))
  // 盾：一片向前鼓的大骨板 + 发光的边
  rig.add('shield', CZ.SHELL2, dome(0.46, 0.2, 0.5, 0, 0.36, 0.46, 9, 3, { r: [PI / 2 - 0.2, 0, 0], smooth: true, arc: 0.42 }))
  rig.add('shield', CZ.BONE, box(0.1, 0.5, 0.06, 0, 0.4, 0.64, { r: [-0.2, 0, 0] }), box(0.6, 0.08, 0.06, 0, 0.42, 0.62, { r: [-0.2, 0, 0] }))
  rig.add('shield', CZ.GLOW2, ring(0.43, 0.02, 10, 3, { axis: 'z', r: [-0.2, 0, 0], p: [0, 0.36, 0.5] }))
  rig.add('shield', CZ.BONE, tube(V3(0.36, 0.66, 0.46), V3(0.46, 0.86, 0.4), 0.04, 0, 3), tube(V3(-0.36, 0.66, 0.46), V3(-0.46, 0.86, 0.4), 0.04, 0, 3))
  const gait = legSet(rig, 'body', [{ z: 0.12, dz: 0.12, phase: 0 }, { z: -0.08, dz: -0.04, phase: PI }, { z: -0.28, dz: -0.2, phase: 0 }], { hipX: 0.16, hipY: 0.24, reach: 0.4, knee: 0.2, r: 0.05, sides: 4, swing: 0.4, lift: 0.3 })
  rig.clip('walk', 12, 0.7, true, (u, P) => { gait(u, P); P.r('shield', 0.04 * sin(u * TAU * 2), 0.05 * sin(u * TAU), 0).t('body', 0, 0.012 * sin(u * TAU * 2), 0) })
  rig.clip('attack', 8, 0.5, false, (u, P) => { const k = bump(u, 0, 1); P.t('shield', 0, 0, 0.2 * k).r('body', 0.15 * k, 0, 0) })
  rig.clip('die', 8, 0.6, false, (u, P) => { const k = ease(u); P.r('shield', 1.3 * k, 0, 0).t('shield', 0, -0.2 * k, 0.1 * k).r('root', 0, 0, 0.7 * k); gait.curl(P, k) })
  return rig
}

// ------------------------------------------------------------------ 跳跃虫（§13）：蚱蜢式大后腿
export function buildLeaper() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.12, 0).bone('body', 'root', 0, 0.26, 0).bone('hR', 'body', 0.1, 0.26, -0.12).bone('hL', 'body', -0.1, 0.26, -0.12)
  rig.add('body', CZ.SHELL2, ball(0.1, 0.09, 0.3, 0, 0.26, -0.02, 7, 4, [-0.2, 0, 0]))
  rig.add('body', CZ.LIMB, ball(0.085, 0.08, 0.1, 0, 0.3, 0.27, 6, 4))
  rig.add('body', CZ.GLOW2, gem(0.04, 0.06, 0.34, 0.32), gem(0.04, -0.06, 0.34, 0.32), ball(0.04, 0.03, 0.12, 0, 0.35, -0.1, 5, 3))
  rig.add('body', CZ.BONE, tube(V3(0.03, 0.34, 0.33), V3(0.08, 0.56, 0.5), 0.015, 0, 3), tube(V3(-0.03, 0.34, 0.33), V3(-0.08, 0.56, 0.5), 0.015, 0, 3))
  for (const s of [1, -1]) {
    const n = s > 0 ? 'hR' : 'hL'
    rig.add(n, CZ.SHELL, tube(V3(s * 0.1, 0.26, -0.12), V3(s * 0.24, 0.6, -0.38), 0.075, 0.04, 4, SM))
    rig.add(n, CZ.BONE, tube(V3(s * 0.24, 0.6, -0.38), V3(s * 0.22, 0.0, -0.2), 0.035, 0.0, 4, SM))
  }
  const gait = legSet(rig, 'body', [{ z: 0.16, dz: 0.12, phase: 0 }, { z: 0.02, dz: 0, phase: PI }], { hipX: 0.07, hipY: 0.22, reach: 0.3, knee: 0.14, r: 0.025, sides: 3, swing: 0.5, lift: 0.4 })
  rig.clip('walk', 10, 0.4, true, (u, P) => { const h = Math.max(0, sin(u * TAU)); gait(u, P); P.t('root', 0, 0.3 * h, 0).r('body', -0.25 * cos(u * TAU), 0, 0).r('hR', 0.9 * h - 0.2, 0, 0).r('hL', 0.9 * h - 0.2, 0, 0) })
  rig.clip('attack', 8, 0.5, false, (u, P) => { const h = bump(u, 0, 1); P.t('root', 0, 1.3 * h, 0).r('body', -0.5 + u, 0, 0).r('hR', 1.4 * h, 0, 0).r('hL', 1.4 * h, 0, 0) })
  flipDeath(rig, gait, 0.45)
  return rig
}
