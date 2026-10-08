// models/aliens/swarm.js —— 海量小型虫：裂爪虫 / 脓爆虫 / 跳跃虫 / 翼螫 / 虫卵。
// 这些要画几百到几千只：每只 150~250 面，不开帧间插值，剪影靠「大形」区分：
//   ling    低伏的四足奔跑者 + 一对前举的镰爪          burster 滚动的脓球（三片甲壳包着发光脓囊）
//   leaper  蚱蜢式巨大后腿、身体前倾、一蹦一蹦           wing    两对长翼 + 下垂的毒针腹
import { Rig, CZ, PI, TAU, sin, cos, abs, max, bump, ease, ramp, loft, plate, blob, horn, seg, fin, eye, xf, legs, flipDeath } from './kit.js'

// ------------------------------------------------------------------ 裂爪虫（海量近战）≤ 250 面
export function buildLing() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.14, 0).bone('body', 'root', 0, 0.22, 0).bone('head', 'body', 0, 0.21, 0.2).bone('tail', 'body', 0, 0.24, -0.1)
    .bone('sR', 'body', 0.1, 0.27, 0.14).bone('sL', 'body', -0.1, 0.27, 0.14)
  // 胸：深色躯干 + 一片后缘翘起的背甲
  rig.add('body', CZ.SHELL2, loft([{ p: [0, 0.2, -0.16], w: 0.15, h: 0.11 }, { p: [0, 0.215, 0.02], w: 0.2, h: 0.14 }, { p: [0, 0.2, 0.22], w: 0.13, h: 0.1 }], 5, { cap0: 'tip', tip0: 0.04, cap1: 'tip', tip1: 0.03 }))
  rig.add('body', CZ.SHELL, plate([{ p: [0, 0.2, 0.27], w: 0.16, h: 0.13 }, { p: [0, 0.22, 0.1], w: 0.25, h: 0.2, crest: 0.3 }, { p: [0, 0.25, -0.1], w: 0.28, h: 0.24, crest: 0.35 }], 4, 1.5))
  // 腹：水滴形，两侧鼓着腺体（软组织色，不发光 —— 海量小虫身上只留眼睛那两点橙光，虫海才读作暗色潮水），背上两根倒刺
  rig.add('tail', CZ.SHELL, loft([{ p: [0, 0.25, -0.06], w: 0.17, h: 0.12 }, { p: [0, 0.28, -0.27], w: 0.24, h: 0.18, crest: 0.25 }, { p: [0, 0.25, -0.46], w: 0.12, h: 0.09 }], 5, { cap0: 'tip', tip0: 0.03, cap1: 'tip', tipP1: [0, 0.3, -0.62] }))
  rig.add('tail', CZ.FLESH, blob([0.175, 0.34, -0.27], [0.065, 0.06, 0.13], 4, { rings: 1 }), blob([-0.175, 0.34, -0.27], [0.065, 0.06, 0.13], 4, { rings: 1 }))
  rig.add('tail', CZ.BONE, horn([0, 0.44, -0.22], [0, 0.58, -0.37], 0.045), horn([0, 0.4, -0.4], [0, 0.48, -0.55], 0.035))
  rig.add('body', CZ.BONE, horn([0, 0.47, -0.06], [0, 0.61, -0.2], 0.045))
  // 头：前探的楔形 + 一对獠牙
  rig.add('head', CZ.LIMB, loft([{ p: [0, 0.2, 0.2], w: 0.11, h: 0.09 }, { p: [0, 0.19, 0.33], w: 0.13, h: 0.08, b: 0.055 }], 4, { cap1: 'tip', tipP1: [0, 0.15, 0.47] }))
  rig.add('head', CZ.GLOW, eye(0.085, 0.245, 0.35, 0.034, 1, 1, 1.4), eye(-0.085, 0.245, 0.35, 0.034, 1, 1, 1.4))
  rig.add('head', CZ.BONE, horn([0.07, 0.15, 0.4], [0.03, 0.07, 0.6], 0.036), horn([-0.07, 0.15, 0.4], [-0.03, 0.07, 0.6], 0.036))
  // 镰爪：上臂举过头顶，刀刃向前下方劈
  for (const s of [1, -1]) {
    const n = s > 0 ? 'sR' : 'sL', a = [s * 0.14, 0.28, 0.14], b = [s * 0.27, 0.44, 0.26], c = [s * 0.18, 0.07, 0.64]
    rig.add(n, CZ.LIMB, seg(a, b, 0.06, 0.05, 3))
    rig.add(n, CZ.BONE, horn(b, c, 0.075, { n: 4, segs: 2, bend: [s * 0.02, 0.12, 0.08], flatten: 0.4, up: [0, 0.6, 0.8] }))
  }
  const gait = legs(rig, 'body', [{ z: 0.1, dz: 0.13, reach: 0.22, phase: 0 }, { z: -0.1, dz: -0.2, reach: 0.26, knee: 0.15, phase: PI }], { hipX: 0.13, hipY: 0.18, knee: 0.1, r: 0.06, n: 3, swing: 0.55, lift: 0.42 })
  rig.clip('walk', 10, 0.42, true, (u, P) => {
    gait(u, P); const a = u * TAU
    P.t('body', 0, 0.018 * sin(a * 2), 0).r('body', 0.05 * sin(a * 2), 0.06 * sin(a), 0).r('tail', 0.08 * sin(a * 2 + 1), 0.16 * sin(a + 0.6), 0).r('head', 0.08 * sin(a * 2 + 2), -0.05 * sin(a), 0)
    P.r('sR', 0.28 * sin(a), 0, 0).r('sL', 0.28 * sin(a + PI), 0, 0)
  })
  rig.clip('attack', 8, 0.34, true, (u, P) => {   // 扑击：后腿蹬起、身体前扑，双镰交替劈下
    const k = bump(u, 0, 0.75), a = u * TAU
    P.t('body', 0, 0.09 * k, 0.16 * k).r('body', -0.45 * k, 0, 0).r('head', 0.3 * k, 0, 0).r('tail', 0.35 * k, 0, 0)
    P.r('sR', -0.9 * bump(u, 0, 0.5) + 0.8 * bump(u, 0.35, 0.95), 0, 0).r('sL', -0.9 * bump(u, 0.1, 0.6) + 0.8 * bump(u, 0.45, 1), 0, 0)
    gait(u * 0.5, P, 0.35)
  })
  flipDeath(rig, gait, 0.45, (u, P, k) => { P.r('sR', 1.3 * k, 0, -0.5 * k).r('sL', 1.3 * k, 0, 0.5 * k).r('tail', -0.7 * k, 0, 0).r('head', 0.6 * k, 0, 0) })
  return rig
}

// ------------------------------------------------------------------ 脓爆虫（自爆）：滚动的脓球。三重对称，一个 clip 周期滚 120°
export function buildBurster() {
  const rig = new Rig()
  const CY = 0.34, R = 0.3
  rig.bone('root', null, 0, 0, 0).bone('ball', 'root', 0, CY, 0).bone('sac', 'ball', 0, CY, 0)
  rig.add('sac', CZ.GLOW2, blob([0, CY, 0], [R * 0.98, R, R], 8, { rings: 4, noise: 0.07, seed: 3 }))
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3, P = 'p' + k, rot = { r: [a, 0, 0], p: [0, CY, 0] }
    rig.bone(P, 'ball', 0, CY + cos(a) * R, sin(a) * R)
    const rr = (z) => Math.sqrt(max(0.0004, (R + 0.035) ** 2 - z * z))
    // 甲片：球冠上的一条带，前后两头收窄
    rig.add(P, k === 0 ? CZ.SHELL : CZ.SHELL2, xf(plate([{ p: [0, 0, -0.2], w: rr(0.2) * 0.75, h: rr(0.2) }, { p: [0, 0, -0.07], w: rr(0.07) * 1.02, h: rr(0.07), crest: 0.12 }, { p: [0, 0, 0.08], w: rr(0.08) * 1.02, h: rr(0.08), crest: 0.12 }, { p: [0, 0, 0.21], w: rr(0.21) * 0.6, h: rr(0.21) }], 4, 0.95), rot))
    rig.add(P, CZ.BONE, xf(horn([0, R, -0.03], [0, R + 0.2, -0.12], 0.05), rot), xf(horn([0.2, R * 0.72, 0.02], [0.36, R * 0.95, -0.04], 0.04), rot), xf(horn([-0.2, R * 0.72, 0.02], [-0.36, R * 0.95, -0.04], 0.04), rot))
    rig.add(P, CZ.GLOW, xf(eye(0.07, R * 0.9, 0.19, 0.035, 1, 1, 1), rot), xf(eye(-0.07, R * 0.9, 0.19, 0.035, 1, 1, 1), rot))
  }
  // 两极各一撮蜷着的短足
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.5; rig.add('ball', CZ.LIMB, horn([s * R * 0.85, CY + cos(a) * 0.1, sin(a) * 0.1], [s * (R + 0.2), CY + cos(a) * 0.24, sin(a) * 0.24], 0.04)) }
  const spread = (P, k) => { for (let i = 0; i < 3; i++) { const a = i * TAU / 3; P.t('p' + i, 0, cos(a) * k, sin(a) * k) } }
  rig.clip('walk', 8, 0.3, true, (u, P) => { P.r('ball', u * TAU / 3, 0, 0).t('ball', 0, 0.035 * abs(sin(u * PI * 2)), 0).s('sac', 1 + 0.04 * sin(u * TAU)); spread(P, 0.012 + 0.012 * sin(u * TAU)) })
  rig.clip('attack', 6, 0.25, true, (u, P) => { const k = 0.5 + 0.5 * sin(u * TAU); P.s('sac', 1.12 + 0.12 * k); spread(P, 0.05 + 0.04 * k) })
  rig.clip('die', 6, 0.25, false, (u, P) => { const k = ease(u); P.s('sac', 1 + 0.7 * bump(u, 0, 0.5) - 0.97 * ramp(u, 0.35, 1)); spread(P, 0.9 * k); P.s('ball', 1 - 0.6 * ramp(u, 0.6, 1)).r('ball', 2 * k, 0, 0) })
  return rig
}

// ------------------------------------------------------------------ 跳跃虫（§13）：蚱蜢式大后腿，一蹦一蹦
export function buildLeaper() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.1, 0).bone('body', 'root', 0, 0.3, -0.05).bone('head', 'body', 0, 0.26, 0.2)
  // 细长的身体，头低尾高
  rig.add('body', CZ.SHELL2, loft([{ p: [0, 0.4, -0.42], w: 0.05, h: 0.045 }, { p: [0, 0.36, -0.2], w: 0.1, h: 0.085 }, { p: [0, 0.29, 0.04], w: 0.105, h: 0.09 }, { p: [0, 0.25, 0.22], w: 0.075, h: 0.07 }], 5, { cap0: 'tip', tipP0: [0, 0.47, -0.6], cap1: 'tip', tip1: 0.03 }))
  rig.add('body', CZ.SHELL, plate([{ p: [0, 0.27, 0.22], w: 0.095, h: 0.09 }, { p: [0, 0.33, -0.04], w: 0.15, h: 0.13, crest: 0.4 }], 4, 1.35), plate([{ p: [0, 0.35, -0.08], w: 0.125, h: 0.1 }, { p: [0, 0.4, -0.3], w: 0.11, h: 0.1, crest: 0.4 }], 4, 1.35))
  rig.add('body', CZ.FLESH, blob([0, 0.3, -0.24], [0.05, 0.04, 0.1], 4, { rings: 1 }))
  rig.add('head', CZ.LIMB, blob([0, 0.24, 0.29], [0.075, 0.07, 0.11], 4, { rings: 2, front: 0.6 }))
  rig.add('head', CZ.GLOW, eye(0.065, 0.28, 0.31, 0.032, 1, 1, 1.2), eye(-0.065, 0.28, 0.31, 0.032, 1, 1, 1.2))
  rig.add('head', CZ.BONE, horn([0.03, 0.29, 0.3], [0.13, 0.62, 0.52], 0.02), horn([-0.03, 0.29, 0.3], [-0.13, 0.62, 0.52], 0.02), horn([0.04, 0.19, 0.36], [0.015, 0.1, 0.48], 0.022), horn([-0.04, 0.19, 0.36], [-0.015, 0.1, 0.48], 0.022))
  // 大后腿：粗壮的股节向后上方翘过背，细长的胫节折回地面
  for (const s of [1, -1]) {
    const F = s > 0 ? 'hR' : 'hL', T = F + 'b', hip = [s * 0.1, 0.3, -0.08], knee = [s * 0.27, 0.74, -0.42], foot = [s * 0.25, 0.0, -0.22]
    rig.bone(F, 'body', ...hip).bone(T, F, ...knee)
    rig.add(F, CZ.SHELL, seg(hip, knee, 0.075, 0.045, 4, { mid: 1.5, flatten: 0.7 }))
    rig.add(T, CZ.BONE, horn(knee, foot, 0.048, { n: 3, segs: 2, bend: [s * 0.03, 0, -0.05] }))
    rig.add(F, CZ.BONE, horn(knee, [knee[0] + s * 0.04, knee[1] + 0.12, knee[2] - 0.08], 0.03))
  }
  const gait = legs(rig, 'body', [{ z: 0.14, dz: 0.14, phase: 0 }, { z: 0.0, dz: -0.02, phase: PI, reach: 0.27 }], { hipX: 0.07, hipY: 0.24, reach: 0.22, knee: 0.1, r: 0.034, n: 3, swing: 0.4, lift: 0.4 })
  const hind = (P, fold, swing) => { for (const s of [1, -1]) { const F = s > 0 ? 'hR' : 'hL'; P.r(F, swing, 0, 0).r(F + 'b', fold, 0, 0) } }
  rig.clip('walk', 10, 0.5, true, (u, P) => {   // 0~0.2 蹲伏蓄力，0.2~0.85 腾空，之后落地
    const air = bump(u, 0.2, 0.88), crouch = bump(u, 0, 0.26) + bump(u, 0.84, 1.0) * 0.6
    P.t('root', 0, 0.62 * air - 0.05 * crouch, 0).r('body', -0.45 * bump(u, 0.15, 0.55) + 0.35 * bump(u, 0.55, 0.95), 0, 0)
    hind(P, -0.3 * crouch + 1.7 * air, 0.25 * crouch - 0.9 * air)
    for (const l of gait.legs) P.r(l.name, 0, 0, l.side * (0.5 * air - 0.2 * crouch))
    P.r('head', 0.2 * air, 0, 0)
  })
  rig.clip('attack', 8, 0.5, false, (u, P) => {   // 高跳扑下
    const air = bump(u, 0.05, 0.95)
    P.t('root', 0, 1.2 * air, 0).r('body', -0.7 * bump(u, 0, 0.5) + 0.8 * bump(u, 0.45, 1), 0, 0)
    hind(P, 1.7 * air, -0.9 * air)
    for (const l of gait.legs) P.r(l.name, 0, -l.side * 0.5 * air, l.side * 0.6 * air)
  })
  flipDeath(rig, gait, 0.45, (u, P, k) => { hind(P, -0.8 * k, 0.5 * k); P.r('head', 0.5 * k, 0, 0) })
  return rig
}

// ------------------------------------------------------------------ 翼螫（飞行）：两对长翼 + 下垂的毒针腹
export function buildWing() {
  const rig = new Rig()
  const Y = 0.34
  rig.bone('root', null, 0, Y, 0).bone('body', 'root', 0, Y, 0).bone('head', 'body', 0, Y, 0.18).bone('ab1', 'body', 0, Y - 0.02, -0.14).bone('ab2', 'ab1', 0, Y - 0.1, -0.4)
  rig.add('body', CZ.SHELL, blob([0, Y, 0.02], [0.12, 0.11, 0.2], 6, { rings: 2, noise: 0.06 }))
  rig.add('body', CZ.SHELL2, plate([{ p: [0, Y, 0.2], w: 0.1, h: 0.1 }, { p: [0, Y + 0.02, -0.12], w: 0.15, h: 0.14, crest: 0.5 }], 4, 1.3))
  rig.add('head', CZ.LIMB, blob([0, Y - 0.02, 0.27], [0.085, 0.07, 0.11], 5, { rings: 2, front: 0.5 }))
  rig.add('head', CZ.GLOW, eye(0.07, Y + 0.01, 0.3, 0.045, 1, 0.8, 1.3), eye(-0.07, Y + 0.01, 0.3, 0.045, 1, 0.8, 1.3))
  rig.add('head', CZ.BONE, horn([0.04, Y - 0.07, 0.33], [0.06, Y - 0.24, 0.43], 0.025, { bend: [0.03, 0, 0.04], segs: 2 }), horn([-0.04, Y - 0.07, 0.33], [-0.06, Y - 0.24, 0.43], 0.025, { bend: [-0.03, 0, 0.04], segs: 2 }))
  // 腹：两节，向下弯，末端是发光毒囊和毒针
  rig.add('ab1', CZ.SHELL2, loft([{ p: [0, Y - 0.02, -0.12], w: 0.1, h: 0.09 }, { p: [0, Y - 0.05, -0.27], w: 0.11, h: 0.1 }, { p: [0, Y - 0.1, -0.42], w: 0.075, h: 0.07 }], 5, { cap0: 'tip', tip0: 0.03 }))
  rig.add('ab2', CZ.GLOW2, blob([0, Y - 0.17, -0.5], [0.075, 0.075, 0.12], 5, { rings: 2, dir: [0, -0.6, -0.8] }))
  rig.add('ab2', CZ.BONE, horn([0, Y - 0.23, -0.58], [0, Y - 0.44, -0.5], 0.035, { segs: 2, bend: [0, -0.04, -0.07] }))
  // 垂着的抓握足
  for (const s of [1, -1]) rig.add('body', CZ.LIMB, horn([s * 0.07, Y - 0.08, 0.1], [s * 0.15, Y - 0.32, 0.2], 0.022, { segs: 2, bend: [s * 0.06, 0, 0.06] }), horn([s * 0.07, Y - 0.08, -0.04], [s * 0.13, Y - 0.3, -0.02], 0.022, { segs: 2, bend: [s * 0.06, 0, -0.04] }))
  // 翼：前翼长而后掠，后翼短。翼膜 + 前缘翼脉
  const WING = [['w0R', 1, 0.08, 0.95, -0.16], ['w0L', -1, 0.08, 0.95, -0.16], ['w1R', 1, -0.08, 0.66, -0.34], ['w1L', -1, -0.08, 0.66, -0.34]]
  for (const [n, s, z, len, sw] of WING) {
    const y = Y + 0.09, root = [s * 0.07, y, z]
    rig.bone(n, 'body', ...root)
    const tip = [s * len, y + 0.05, z + sw]
    rig.add(n, CZ.MEMBRANE, fin([[s * 0.07, y, z + 0.05], [s * len * 0.55, y + 0.04, z + 0.13 + sw * 0.3], tip, [s * len * 0.8, y + 0.03, z + sw - 0.17], [s * len * 0.4, y + 0.01, z - 0.2 + sw * 0.4], [s * 0.07, y, z - 0.07]]))
    rig.add(n, CZ.LIMB, seg([s * 0.07, y + 0.005, z + 0.05], [s * len * 0.55, y + 0.045, z + 0.13 + sw * 0.3], 0.022, 0.014, 3), horn([s * len * 0.55, y + 0.045, z + 0.13 + sw * 0.3], tip, 0.014))
  }
  const flap = (u, P, amp, tilt, sweep = 0) => { const a = u * TAU; for (const [n, s, , , ,] of WING) { const lag = n[1] === '1' ? 0.9 : 0; P.r(n, 0, s * sweep, s * (0.7 * sin(a + lag) * amp + tilt)) } }
  rig.clip('walk', 6, 0.16, true, (u, P) => { flap(u, P, 1, 0.12); const a = u * TAU; P.t('body', 0, 0.035 * sin(a + 1.5), 0).r('ab1', 0.12 * sin(a), 0, 0).r('ab2', 0.15 * sin(a + 0.5), 0, 0) })
  rig.clip('attack', 6, 0.2, true, (u, P) => { flap(u, P, 0.25, 0.75, 0.75); P.r('body', 0.6, 0, 0).r('ab1', -0.5, 0, 0).r('ab2', -0.9, 0, 0).r('head', -0.3, 0, 0) })   // 俯冲：收翼成 V、低头、毒针前伸
  rig.clip('die', 8, 0.6, false, (u, P) => { const k = ease(u); flap(u * 2, P, 1 - k, 1.1 * k, 0.4 * k); P.r('root', 1.1 * k, 0, 2.4 * k).r('ab1', -0.6 * k, 0, 0).r('ab2', -0.8 * k, 0, 0) })
  return rig
}

// ------------------------------------------------------------------ 虫卵（「巢母」产的）：四瓣革质卵荚裹着发光的胚囊
export function buildEgg() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('egg', 'root', 0, 0, 0).bone('core', 'egg', 0, 0.36, 0)
  rig.add('egg', CZ.FLESH, loft([{ p: [0, 0.02, 0], w: 0.26, h: 0.26 }, { p: [0, 0.2, 0], w: 0.31, h: 0.31 }, { p: [0, 0.42, 0], w: 0.24, h: 0.24 }], 8, { noise: 0.08, seed: 5, cap0: 'tip', tip0: 0.02 }))
  rig.add('core', CZ.GLOW2, blob([0, 0.42, 0], [0.19, 0.19, 0.24], 6, { rings: 3, dir: [0, 1, 0] }))
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2 + PI / 4, cx = cos(a), sz = sin(a), n = 'pt' + k
    rig.bone(n, 'egg', cx * 0.2, 0.34, sz * 0.2)
    // 卵瓣：从腰部向上合拢到顶
    rig.add(n, k % 2 ? CZ.SHELL : CZ.SHELL2, xf(plate([{ p: [0, 0.3, 0.0], w: 0.25, h: 0.27 }, { p: [0, 0.52, 0.0], w: 0.19, h: 0.2 }, { p: [0, 0.7, 0], w: 0.08, h: 0.09 }], 3, 0.62, { up: [0, 0, 1], cap1: 'tip', tipP1: [0, 0.82, 0.03] }), { r: [0, PI / 2 - a, 0] }))
    rig.add('root', CZ.LIMB, horn([cx * 0.22, 0.1, sz * 0.22], [cx * 0.56, 0.0, sz * 0.56], 0.065, { segs: 2, bend: [0, 0.07, 0] }))
  }
  const open = (P, k) => { for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; P.r('pt' + i, sin(a) * k, 0, -cos(a) * k) } }
  rig.clip('walk', 8, 0.9, true, (u, P) => { const s = sin(u * TAU); P.s('egg', 1 + 0.04 * s, 1 - 0.03 * s, 1 + 0.04 * s).s('core', 1 + 0.08 * s); open(P, 0.06 + 0.05 * s) })
  rig.clip('attack', 8, 0.4, true, (u, P) => { const s = sin(u * TAU); P.s('egg', 1 + 0.08 * s, 1 - 0.06 * s, 1 + 0.08 * s).s('core', 1.15 + 0.12 * s); open(P, 0.2 + 0.1 * s) })
  rig.clip('die', 6, 0.35, false, (u, P) => { const k = ease(u); open(P, 1.5 * k); P.s('core', 1 + 0.4 * bump(u, 0, 0.5) - 0.9 * k).s('egg', 1 + 0.15 * k, 1 - 0.7 * k, 1 + 0.15 * k) })
  return rig
}
