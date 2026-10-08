// models/aliens/brutes.js —— 中大型虫：刺脊虫 / 甲壳兽 / 巨畸体 / 掘地虫 / 护巢虫 / 举盾虫。
// 每种一个一眼能认的大形（主机位下看到的是正面 + 顶面）：
//   spitter   昂起的蛇形上身 + 张开的刺冠（颈盾）           crusher   宽扁的三片叠甲 + 冲角
//   hulk      直立的驼背巨兽，一条骨锤臂一条爪臂             digger    圆筒环节 + 旋转钻颚 + 一对铲肢
//   warden    高耸的柱状躯干顶着角笼里的发光球              shieldbug 正面一整块面具状骨盾
import { Rig, CZ as CZ0, PI, TAU, sin, cos, abs, max, bump, ease, ramp, lerp, loft, plate, ribbed, blob, horn, seg, fin, eye, xf, legs, flipDeath } from './kit.js'

// zone 重映射：着色器会把 20% 个体的 zone 0 / 5（SHELL / SHELL2）整体偏紫，小虫成群时是好看的色差，
// 但中大型虫一整块紫甲就成了糖果色。所以这里的甲壳改用 7 / 1 号行（调色板里对应行填的是甲壳色），翼膜并到 FLESH。
const CZ = { ...CZ0, SHELL: 7, SHELL2: 1, MEMBRANE: 4 }

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
/** 一节躯干：两头略收、中间鼓、两端超出关节一点（弯曲时不露缝） */
function bodySeg(a, b, w0, w1, n, o = {}) {
  const hk = o.hk ?? 0.85, wm = (w0 + w1) / 2 * (o.bulge ?? 1.1)
  return loft([{ p: mix3(a, b, -0.1), w: w0 * 0.82, h: w0 * hk * 0.82, b: w0 * hk * 0.82 * (o.belly ?? 1) }, { p: mix3(a, b, 0.45), w: wm, h: wm * hk, b: wm * hk * (o.belly ?? 1), crest: o.crest }, { p: mix3(a, b, 1.08), w: w1 * 0.86, h: w1 * hk * 0.86, b: w1 * hk * 0.86 * (o.belly ?? 1) }], n, { cap0: 'tip', tip0: w0 * 0.25, cap1: 'tip', tip1: w1 * 0.25, noise: o.noise, seed: o.seed, up: o.up })
}

// ------------------------------------------------------------------ 刺脊虫（远程）：蛇形上身昂起，颈两侧张着刺冠，喉部挂着酸囊
export function buildSpitter() {
  const rig = new Rig()
  const T = [[0, 0.2, -0.08], [-0.1, 0.16, -0.42], [0.1, 0.12, -0.76], [0, 0.07, -1.1]]
  const K = [[0, 0.2, -0.08], [0, 0.36, 0.16], [0, 0.7, 0.24], [0, 1.02, 0.18], [0, 1.22, 0.28]]
  const UPB = [0, 0.25, -1]
  rig.bone('root', null, 0, 0, 0).bone('base', 'root', ...K[0]).bone('t1', 'base', ...T[0]).bone('t2', 't1', ...T[1]).bone('t3', 't2', ...T[2])
    .bone('n1', 'base', ...K[1]).bone('n2', 'n1', ...K[2]).bone('n3', 'n2', ...K[3]).bone('head', 'n3', ...K[4]).bone('sac', 'n2', 0, 0.86, 0.34)
    .bone('jawR', 'head', 0.07, 1.14, 0.46).bone('jawL', 'head', -0.07, 1.14, 0.46).bone('hoodR', 'n3', 0.1, 1.02, 0.14).bone('hoodL', 'n3', -0.1, 1.02, 0.14)
  // 拖在地上的尾
  const tw = [0.19, 0.15, 0.1, 0.03]
  for (let i = 0; i < 3; i++) {
    rig.add('t' + (i + 1), i % 2 ? CZ.SHELL : CZ.SHELL2, bodySeg(T[i], T[i + 1], tw[i], tw[i + 1] + 0.02, 6, { hk: 0.75, crest: 0.3, belly: 0.6 }))
    const m = mix3(T[i], T[i + 1], 0.5)
    rig.add('t' + (i + 1), CZ.BONE, horn([m[0], m[1] + tw[i] * 0.6, m[2]], [m[0], m[1] + tw[i] * 0.6 + 0.2 - i * 0.04, m[2] - 0.16], 0.035))
  }
  rig.add('t3', CZ.BONE, horn(T[3], [0.02, 0.2, -1.32], 0.04, { segs: 2, bend: [0, -0.03, -0.06] }))
  // 盘起的底座 + 三节颈
  rig.add('base', CZ.SHELL, bodySeg(K[0], K[1], 0.22, 0.18, 7, { hk: 0.8, crest: 0.25 }))
  rig.add('base', CZ.LIMB, blob([0, 0.12, 0.02], [0.24, 0.12, 0.3], 6, { rings: 2 }))
  const nw = [0.18, 0.16, 0.145, 0.13]
  for (let i = 1; i < 4; i++) {
    const B = 'n' + i
    rig.add(B, CZ.FLESH, bodySeg(K[i], K[i + 1], nw[i - 1], nw[i], 7, { hk: 0.8, up: UPB }))
    // 背甲（朝后的半圈）+ 一根向后上方的脊刺
    rig.add(B, i % 2 ? CZ.SHELL : CZ.SHELL2, plate([{ p: mix3(K[i], K[i + 1], -0.05), w: nw[i - 1] * 1.05, h: nw[i - 1] * 0.95 }, { p: mix3(K[i], K[i + 1], 0.55), w: nw[i - 1] * 1.22, h: nw[i - 1] * 1.12, crest: 0.4 }, { p: mix3(K[i], K[i + 1], 1.05), w: nw[i] * 1.3, h: nw[i] * 1.25, crest: 0.5 }], 5, 1.75, { up: UPB }))
    const m = mix3(K[i], K[i + 1], 0.75)
    rig.add(B, CZ.BONE, horn([0, m[1], m[2] - nw[i] * 1.0], [0, m[1] + 0.26, m[2] - nw[i] - 0.34], 0.045, { segs: 2, bend: [0, 0.05, -0.02] }))
    if (i < 3) rig.add(B, CZ.BONE, horn([0, m[1] - 0.16, m[2] - nw[i] * 1.0], [0, m[1] + 0.0, m[2] - nw[i] - 0.26], 0.035))
  }
  rig.add('sac', CZ.GLOW2, blob([0, 0.86, 0.35], [0.115, 0.1, 0.19], 6, { rings: 3, dir: [0, 1, 0.1], noise: 0.06 }))
  // 刺冠：每侧三根长刺撑着翼膜
  for (const s of [1, -1]) {
    const H = s > 0 ? 'hoodR' : 'hoodL', r0 = [s * 0.1, 1.02, 0.14]
    const tips = [[s * 0.46, 1.5, -0.02], [s * 0.66, 1.2, -0.06], [s * 0.56, 0.86, -0.02]]
    for (const t of tips) rig.add(H, CZ.BONE, horn(r0, t, 0.036, { segs: 2, bend: [s * 0.05, 0, 0.05] }))
    rig.add(H, CZ.MEMBRANE, fin([[s * 0.09, 1.0, 0.12], [s * 0.1, 1.2, 0.16], ...tips.map((t) => mix3(r0, t, 0.86)), [s * 0.1, 0.84, 0.16]]))
  }
  // 头：前探的楔形，上颌带冠，一对外张的钩颚
  rig.add('head', CZ.SHELL2, loft([{ p: [0, 1.22, 0.2], w: 0.11, h: 0.1 }, { p: [0, 1.22, 0.38], w: 0.125, h: 0.095, b: 0.06, crest: 0.4 }, { p: [0, 1.18, 0.54], w: 0.085, h: 0.06, b: 0.04 }], 6, { cap0: 'tip', tip0: 0.05, cap1: 'tip', tipP1: [0, 1.12, 0.7] }))
  rig.add('head', CZ.BONE, horn([0, 1.31, 0.34], [0, 1.52, 0.12], 0.05, { segs: 2, bend: [0, 0.06, 0.04], flatten: 0.5 }))
  for (const s of [1, -1]) {
    rig.add('head', CZ.GLOW, eye(s * 0.1, 1.26, 0.43, 0.035, 1, 1, 1.5), eye(s * 0.115, 1.235, 0.34, 0.026, 1, 1, 1.5))
    rig.add(s > 0 ? 'jawR' : 'jawL', CZ.BONE, horn([s * 0.07, 1.14, 0.46], [s * 0.035, 1.0, 0.74], 0.04, { segs: 2, bend: [s * 0.08, -0.02, 0.03] }))
  }
  rig.add('head', CZ.GLOW2, blob([0, 1.13, 0.5], [0.05, 0.035, 0.08], 4, { rings: 1 }))
  const gait = legs(rig, 'base', [{ z: 0.06, dz: 0.16, phase: 0 }, { z: -0.14, dz: -0.1, phase: PI }], { hipX: 0.16, hipY: 0.18, reach: 0.3, knee: 0.12, r: 0.045, n: 4, swing: 0.4, lift: 0.3, tip: CZ.BONE })
  const hood = (P, k) => { P.r('hoodR', 0, -k, 0).r('hoodL', 0, k, 0) }   // k > 0 张开
  rig.clip('walk', 12, 0.7, true, (u, P) => {
    gait(u, P); const a = u * TAU
    for (let i = 1; i <= 3; i++) P.r('t' + i, 0, 0.22 * sin(a - i * 1.1), 0)
    P.r('base', 0, 0.08 * sin(a + 0.8), 0).r('n1', 0.04 * sin(a * 2), -0.1 * sin(a + 0.3), 0.06 * sin(a)).r('n2', 0, -0.06 * sin(a - 0.5), 0.05 * sin(a - 0.6)).r('head', 0.05 * sin(a * 2 + 1), 0.1 * sin(a - 1.2), 0)
    P.s('sac', 1 + 0.06 * sin(a * 2)); hood(P, -0.25 + 0.05 * sin(a * 2))
  })
  rig.clip('attack', 12, 0.6, false, (u, P) => {   // 后仰蓄酸（喉囊鼓起、刺冠全张）→ 甩头喷吐
    const w = bump(u, 0, 0.55), f = bump(u, 0.42, 1)
    P.r('n1', -0.3 * w + 0.4 * f, 0, 0).r('n2', -0.25 * w + 0.35 * f, 0, 0).r('n3', -0.1 * w + 0.2 * f, 0, 0).r('head', -0.35 * w + 0.35 * f, 0, 0)
    P.s('sac', 1 + 0.55 * w - 0.2 * f).r('jawR', 0, 0.5 * f + 0.2 * w, 0).r('jawL', 0, -0.5 * f - 0.2 * w, 0); hood(P, 0.35 * w + 0.2 * f - 0.1)
    for (let i = 1; i <= 3; i++) P.r('t' + i, 0, 0.15 * w * (i % 2 ? 1 : -1), 0)
  })
  rig.clip('die', 10, 0.6, false, (u, P) => {
    const k = ease(u), sh = bump(u, 0, 0.5)
    P.r('n1', 0.5 * k - 0.3 * sh, 0, 0.75 * k).r('n2', 0.35 * k, 0, 0.45 * k).r('n3', 0.4 * k, 0, 0.2 * k).r('head', 0.5 * k, 0.4 * k, 0).s('sac', 1 - 0.6 * k)
    hood(P, -0.7 * k); P.r('base', 0, 0, 0.3 * k).r('t1', 0, 0.5 * k, 0).r('t2', 0, 0.7 * k, 0).r('t3', 0, 0.8 * k, 0); gait.curl(P, k)
  })
  rig.meta = { muzzle: [0, 1.12, 0.7] }
  return rig
}

// ------------------------------------------------------------------ 甲壳兽（重甲中坚）：宽扁、低重心，三片前后叠压的背甲 + 冲角
export function buildCrusher() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.1, 0).bone('body', 'root', 0, 0.36, 0).bone('head', 'body', 0, 0.3, 0.4)
    .bone('p2', 'body', 0, 0.5, 0.02).bone('p3', 'body', 0, 0.5, -0.36).bone('tail', 'body', 0, 0.32, -0.74)
  rig.add('body', CZ.LIMB, blob([0, 0.28, -0.14], [0.42, 0.19, 0.66], 7, { rings: 3, belly: 0.7 }))
  const SQ = 2.7
  // 背甲：每片前缘压在上一片下面，后缘外翻；边缘一圈发光腺孔
  const P1 = [{ p: [0, 0.3, 0.46], w: 0.36, h: 0.2 }, { p: [0, 0.32, 0.24], w: 0.55, h: 0.33, crest: 0.18 }, { p: [0, 0.35, -0.02], w: 0.64, h: 0.4, crest: 0.22 }]
  const P2 = [{ p: [0, 0.3, 0.04], w: 0.56, h: 0.32 }, { p: [0, 0.32, -0.18], w: 0.63, h: 0.38, crest: 0.18 }, { p: [0, 0.35, -0.4], w: 0.66, h: 0.42, crest: 0.22 }]
  const P3 = [{ p: [0, 0.3, -0.34], w: 0.57, h: 0.33 }, { p: [0, 0.31, -0.58], w: 0.52, h: 0.36, crest: 0.2 }, { p: [0, 0.3, -0.8], w: 0.3, h: 0.24 }]
  rig.add('body', CZ.SHELL, plate(P1, 8, 1.62, { sq: SQ, noise: 0.03, seed: 1, ribs: 2 }))
  rig.add('p2', CZ.SHELL2, plate(P2, 8, 1.62, { sq: SQ, noise: 0.03, seed: 2, ribs: 2 }))
  rig.add('p3', CZ.SHELL, plate(P3, 8, 1.62, { sq: SQ, noise: 0.03, seed: 3, ribs: 2, cap1: 'tip', tipP1: [0, 0.34, -0.96] }))
  const rim = [['body', 0.64, 0.4, -0.02], ['p2', 0.66, 0.42, -0.4], ['p3', 0.52, 0.36, -0.6]]
  for (const [B, w, h, z] of rim) {
    for (const s of [1, -1]) {
      rig.add(B, CZ.BONE, horn([s * w * 0.9, 0.36 + h * 0.35, z + 0.06], [s * (w + 0.3), 0.5 + h * 0.3, z - 0.22], 0.075, { n: 4, segs: 2, bend: [s * 0.05, 0.05, 0] }))
      rig.add(B, CZ.GLOW, blob([s * w * 0.97, 0.33, z + 0.16], [0.035, 0.05, 0.09], 4, { rings: 1 }), blob([s * w * 0.99, 0.32, z + 0.02], [0.03, 0.045, 0.07], 4, { rings: 1 }))
    }
    rig.add(B, CZ.BONE, horn([0, 0.36 + h * 1.05, z + 0.12], [0, 0.36 + h + 0.22, z - 0.12], 0.07, { n: 4 }))
  }
  // 头：低平的铲形 + 上翘的冲角 + 内弯獠牙
  rig.add('head', CZ.SHELL2, loft([{ p: [0, 0.29, 0.36], w: 0.3, h: 0.17, b: 0.12 }, { p: [0, 0.26, 0.58], w: 0.33, h: 0.15, b: 0.1, crest: 0.3 }, { p: [0, 0.22, 0.78], w: 0.2, h: 0.09, b: 0.07 }], 7, { cap1: 'tip', tipP1: [0, 0.17, 0.92], sq: 2.4 }))
  rig.add('head', CZ.BONE, horn([0, 0.37, 0.62], [0, 0.72, 1.04], 0.1, { n: 4, segs: 3, bend: [0, -0.08, 0.14], flatten: 0.7 }))
  for (const s of [1, -1]) {
    rig.add('head', CZ.BONE, horn([s * 0.25, 0.2, 0.64], [s * 0.1, 0.1, 1.02], 0.065, { n: 4, segs: 2, bend: [s * 0.14, 0, 0.05] }), horn([s * 0.28, 0.36, 0.48], [s * 0.52, 0.5, 0.36], 0.05))
    rig.add('head', CZ.GLOW, eye(s * 0.17, 0.375, 0.66, 0.04, 1.2, 0.8, 1.2), eye(s * 0.255, 0.36, 0.58, 0.032, 1.2, 0.8, 1.2))
  }
  rig.add('tail', CZ.SHELL2, seg([0, 0.32, -0.72], [0, 0.4, -1.0], 0.15, 0.1, 5))
  rig.add('tail', CZ.BONE, blob([0, 0.42, -1.08], [0.15, 0.13, 0.16], 5, { rings: 2 }), horn([0.1, 0.44, -1.1], [0.36, 0.52, -1.22], 0.05), horn([-0.1, 0.44, -1.1], [-0.36, 0.52, -1.22], 0.05), horn([0, 0.5, -1.1], [0, 0.76, -1.24], 0.05))
  const gait = legs(rig, 'body', [{ z: 0.26, dz: 0.14, phase: 0 }, { z: -0.04, dz: 0, phase: PI, reach: 0.5 }, { z: -0.36, dz: -0.18, phase: 0 }], { hipX: 0.3, hipY: 0.25, reach: 0.44, knee: 0.17, r: 0.085, n: 5, two: true, spur: 0.13, swing: 0.32, lift: 0.26, tip: CZ.BONE, thigh: 1.25 })
  rig.clip('walk', 14, 0.8, true, (u, P) => {
    gait(u, P); const a = u * TAU
    P.t('body', 0, 0.014 * sin(a * 2), 0).r('body', 0, 0.03 * sin(a), 0.025 * sin(a)).r('head', 0.05 * sin(a * 2), -0.04 * sin(a), 0).r('p2', 0.03 * sin(a * 2 + 1), 0, 0).r('p3', 0.04 * sin(a * 2 + 2), 0, 0).r('tail', 0, 0.22 * sin(a + 1), 0)
  })
  rig.clip('attack', 10, 0.7, false, (u, P) => {   // 压低 → 甲片炸开 → 猛地前顶
    const w = bump(u, 0, 0.55), f = bump(u, 0.45, 1)
    P.r('body', 0.1 * w - 0.06 * f, 0, 0).t('body', 0, -0.04 * w + 0.05 * f, -0.08 * w + 0.22 * f).r('head', 0.3 * w - 0.45 * f, 0, 0).r('p2', 0.22 * w, 0, 0).r('p3', 0.32 * w, 0, 0).r('tail', -0.3 * w, 0, 0)
  })
  rig.clip('die', 10, 0.8, false, (u, P) => {
    const k = ease(u), sh = bump(u, 0, 0.5)
    P.r('root', 0.06 * k, 0, 0.3 * k).t('root', 0, -0.12 * k + 0.08 * sh, 0).r('head', 0.45 * k - 0.3 * sh, 0.2 * k, 0).r('p2', 0.2 * sh - 0.05 * k, 0, 0).r('p3', 0.3 * sh - 0.08 * k, 0, 0).r('tail', 0.3 * k, 0.4 * k, 0); gait.splay(P, k)
  })
  rig.meta = { muzzle: [0, 0.6, 0.9] }
  return rig
}

// ------------------------------------------------------------------ 巨畸体（巨型肉盾）：直立的驼背巨兽，右臂骨锤、左臂巨爪，双臂举起砸地
export function buildHulk() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('pelvis', 'root', 0, 0.62, -0.04).bone('torso', 'pelvis', 0, 0.8, -0.02).bone('head', 'torso', 0, 1.24, 0.3)
  for (const s of [1, -1]) {
    const S = s > 0 ? 'R' : 'L'
    rig.bone('arm' + S, 'torso', s * 0.52, 1.28, 0.08).bone('fore' + S, 'arm' + S, s * 0.76, 0.8, 0.2)
    rig.bone('leg' + S, 'pelvis', s * 0.23, 0.6, -0.04).bone('shin' + S, 'leg' + S, s * 0.31, 0.32, 0.12)
  }
  rig.add('pelvis', CZ.LIMB, blob([0, 0.6, -0.04], [0.32, 0.22, 0.27], 7, { rings: 2 }))
  // 躯干：外露的肉腹（带脓疱）+ 从后腰一路叠到头顶的驼背甲
  rig.add('torso', CZ.FLESH, blob([0, 1.0, 0.08], [0.38, 0.46, 0.3], 8, { rings: 4, noise: 0.14, seed: 2, dir: [0, 1, 0.12], up: [0, 0, -1] }))
  for (const [x, y, z, r] of [[0.12, 0.9, 0.35, 0.085], [-0.17, 1.06, 0.33, 0.06], [-0.04, 0.76, 0.32, 0.05]]) rig.add('torso', CZ.GLOW, blob([x, y, z], [r, r, r * 0.8], 5, { rings: 2 }))
  const UB = [0, 0.4, -1]
  rig.add('torso', CZ.SHELL2, plate([{ p: [0, 0.72, -0.2], w: 0.36, h: 0.22 }, { p: [0, 0.98, -0.2], w: 0.52, h: 0.36, crest: 0.25 }, { p: [0, 1.2, -0.13], w: 0.6, h: 0.42, crest: 0.3 }], 8, 1.7, { up: UB, sq: 2.4, noise: 0.04, seed: 4, ribs: 2 }))
  rig.add('torso', CZ.SHELL, plate([{ p: [0, 1.1, -0.1], w: 0.58, h: 0.36 }, { p: [0, 1.36, 0.0], w: 0.66, h: 0.46, crest: 0.3 }, { p: [0, 1.52, 0.2], w: 0.5, h: 0.4, crest: 0.35 }, { p: [0, 1.5, 0.42], w: 0.3, h: 0.24 }], 8, 1.7, { up: UB, sq: 2.4, noise: 0.04, seed: 5, ribs: 2 }))
  for (const [x, y, z, l] of [[0, 1.62, -0.28, 0.5], [0.3, 1.5, -0.3, 0.4], [-0.3, 1.5, -0.3, 0.4], [0, 1.3, -0.5, 0.36], [0.26, 1.18, -0.5, 0.3], [-0.26, 1.18, -0.5, 0.3], [0, 0.98, -0.52, 0.26]]) rig.add('torso', CZ.BONE, horn([x, y, z], [x * 1.5, y + l * 0.85, z - l * 0.6], 0.085, { n: 4, segs: 2, bend: [0, 0.02, -0.08] }))
  // 肋：从两侧向前箍住肉腹
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) rig.add('torso', CZ.BONE, horn([s * 0.44, 1.2 - i * 0.17, 0.04], [s * 0.1, 1.12 - i * 0.18, 0.46], 0.06, { n: 4, segs: 3, bend: [s * 0.16, 0, 0.14] }))
  // 头：缩在甲檐下的小头
  rig.add('head', CZ.LIMB, blob([0, 1.26, 0.4], [0.17, 0.15, 0.2], 6, { rings: 2, front: 0.4 }))
  for (const s of [1, -1]) {
    rig.add('head', CZ.GLOW, eye(s * 0.085, 1.31, 0.55, 0.035, 1, 0.8, 1), eye(s * 0.14, 1.27, 0.49, 0.028, 1, 0.8, 1))
    rig.add('head', CZ.BONE, horn([s * 0.09, 1.17, 0.52], [s * 0.05, 1.02, 0.66], 0.04, { segs: 2, bend: [s * 0.05, 0, 0.04] }))
  }
  // 臂：肩甲 + 上臂 + 越往下越粗的前臂。右 = 骨锤，左 = 三趾巨爪
  for (const s of [1, -1]) {
    const A = s > 0 ? 'armR' : 'armL', F = s > 0 ? 'foreR' : 'foreL'
    const sh = [s * 0.52, 1.28, 0.08], el = [s * 0.76, 0.8, 0.2], wr = [s * 0.72, 0.36, 0.42]
    rig.add(A, CZ.SHELL, blob([s * 0.6, 1.34, 0.06], [0.26, 0.2, 0.26], 6, { rings: 2, noise: 0.06, seed: 7, flat: true }))
    rig.add(A, CZ.BONE, horn([s * 0.68, 1.46, 0.02], [s * 0.98, 1.82, -0.12], 0.08, { n: 4, segs: 2, bend: [s * 0.06, 0, 0] }))
    rig.add(A, CZ.LIMB, seg(sh, el, 0.17, 0.14, 6, { mid: 1.15, flat: true }))
    rig.add(F, CZ.SHELL2, seg(el, wr, 0.15, s > 0 ? 0.2 : 0.17, 6, { cap0: true, flat: true }))
    rig.add(F, CZ.BONE, horn([el[0] + s * 0.06, el[1] + 0.04, el[2] - 0.08], [el[0] + s * 0.2, el[1] + 0.3, el[2] - 0.32], 0.07, { n: 4 }))
    if (s > 0) {
      rig.add(F, CZ.BONE, blob([wr[0], wr[1] - 0.12, wr[2] + 0.06], [0.27, 0.25, 0.3], 6, { rings: 2, noise: 0.1, seed: 9, flat: true }))
      for (const [dx, dy, dz] of [[0.3, 0.05, 0.1], [-0.2, -0.05, 0.34], [0.12, -0.2, 0.34], [0.1, 0.22, 0.26], [0.3, -0.16, -0.1], [-0.05, 0.1, -0.34]]) rig.add(F, CZ.BONE, horn([wr[0] + dx * 0.6, wr[1] - 0.12 + dy * 0.6, wr[2] + 0.06 + dz * 0.6], [wr[0] + dx * 1.4, wr[1] - 0.12 + dy * 1.4, wr[2] + 0.06 + dz * 1.4], 0.07, { n: 4 }))
    } else {
      rig.add(F, CZ.LIMB, blob([wr[0], wr[1] - 0.04, wr[2] + 0.04], [0.18, 0.15, 0.2], 5, { rings: 2 }))
      for (const dx of [-0.13, 0, 0.13]) rig.add(F, CZ.BONE, horn([wr[0] + dx, wr[1] - 0.06, wr[2] + 0.16], [wr[0] + dx * 1.6, 0.02, wr[2] + 0.5], 0.065, { n: 4, segs: 2, bend: [0, 0.08, 0.12], flatten: 0.6 }))
    }
    // 腿：短粗
    const L = s > 0 ? 'legR' : 'legL', Sn = s > 0 ? 'shinR' : 'shinL'
    rig.add(L, CZ.SHELL2, seg([s * 0.23, 0.6, -0.04], [s * 0.31, 0.32, 0.12], 0.2, 0.14, 6, { mid: 1.1, flat: true }))
    rig.add(Sn, CZ.LIMB, seg([s * 0.31, 0.32, 0.12], [s * 0.3, 0.07, -0.02], 0.13, 0.1, 5, { flat: true }))
    rig.add(Sn, CZ.BONE, blob([s * 0.3, 0.06, 0.08], [0.15, 0.07, 0.2], 5, { rings: 2, belly: 0.4, flat: true }), horn([s * 0.36, 0.06, 0.24], [s * 0.42, 0.0, 0.42], 0.05), horn([s * 0.24, 0.06, 0.24], [s * 0.22, 0.0, 0.42], 0.05), horn([s * 0.33, 0.36, 0.2], [s * 0.4, 0.5, 0.34], 0.06))
  }
  // 拉长双腿、抬高上身：站直了才是「直立的巨型肉盾」，不然是个趴着的球
  const LEG = new Set(['legR', 'legL', 'shinR', 'shinL'].map((n) => rig._idx.get(n)))
  for (const p of rig.parts) { if (LEG.has(p.bone)) { p.geo.scale(1, 1.45, 1); p.geo.computeVertexNormals() } else p.geo.translate(0, 0.27, 0) }
  rig.bones.forEach((b, i) => { if (b.name === 'root') return; if (LEG.has(i)) b.pivot[1] *= 1.45; else b.pivot[1] += 0.27 })
  const step = (u, P, amp) => {
    const a = u * TAU, s = sin(a), c = cos(a)
    P.r('legR', -0.5 * s * amp, 0, 0).r('legL', 0.5 * s * amp, 0, 0).r('shinR', 0.5 * max(0, c) * amp, 0, 0).r('shinL', 0.5 * max(0, -c) * amp, 0, 0)
    P.t('pelvis', 0, 0.035 * abs(c) * amp, 0).r('pelvis', 0, 0.1 * s * amp, 0.05 * s * amp)
  }
  rig.clip('walk', 14, 1.2, true, (u, P) => {
    step(u, P, 1); const a = u * TAU, s = sin(a)
    P.r('torso', -0.04 + 0.03 * cos(a * 2), -0.16 * s, 0.04 * s).r('head', 0, 0.12 * s, 0).r('armR', 0.35 * s, 0, 0.05).r('armL', -0.35 * s, 0, -0.05).r('foreR', -0.15 - 0.12 * s, 0, 0).r('foreL', -0.15 + 0.12 * s, 0, 0)
  })
  rig.clip('attack', 14, 1.0, false, (u, P) => {   // 双臂举过头 → 整个上身砸下去
    const w = bump(u, 0, 0.62), f = ramp(u, 0.5, 0.72) * (1 - ramp(u, 0.85, 1) * 0.6)
    P.r('torso', -0.35 * w + 0.75 * f, 0, 0).t('pelvis', 0, 0.06 * w - 0.16 * f, 0.1 * f).r('armR', -2.5 * w - 0.5 * f, 0, 0.2 * w).r('armL', -2.5 * w - 0.5 * f, 0, -0.2 * w)
      .r('foreR', -0.5 * w - 0.3 * f, 0, 0).r('foreL', -0.5 * w - 0.3 * f, 0, 0).r('head', -0.3 * w + 0.2 * f, 0, 0).r('legR', -0.25 * f, 0, 0).r('legL', -0.25 * f, 0, 0).r('shinR', 0.4 * f, 0, 0).r('shinL', 0.4 * f, 0, 0)
  })
  rig.clip('die', 12, 1.1, false, (u, P) => {   // 跪倒 → 前扑
    const k = ease(u), k2 = ramp(u, 0.35, 1), sh = bump(u, 0, 0.4)
    P.t('pelvis', 0, -0.3 * k, 0.1 * k2).r('pelvis', 0.5 * k2, 0, 0.12 * k).r('torso', -0.25 * sh + 0.85 * k2, 0.2 * k, 0).r('head', 0.5 * k, 0, 0)
      .r('legR', -0.9 * k, 0, 0).r('legL', -0.7 * k, 0, 0).r('shinR', 1.5 * k, 0, 0).r('shinL', 1.3 * k, 0, 0).r('armR', -0.6 * sh - 0.5 * k2, 0, 0.5 * k).r('armL', -0.6 * sh - 0.7 * k2, 0, -0.6 * k)
  })
  return rig
}

// ------------------------------------------------------------------ 掘地虫（钻地）：圆筒环节 + 旋转的四瓣钻颚 + 一对铲肢；emerge = 破土，带土堆
export function buildDigger() {
  const rig = new Rig()
  const Y = 0.3
  rig.bone('root', null, 0, Y, 0).bone('mound', null, 0, 0, 0).bone('s0', 'root', 0, Y, 0.0).bone('s1', 's0', 0, Y, -0.24).bone('s2', 's1', 0, Y, -0.48)
    .bone('head', 's0', 0, Y, 0.26).bone('drill', 'head', 0, Y, 0.44)
  const R = [0.27, 0.26, 0.23, 0.17]
  ;['s0', 's1', 's2'].forEach((B, i) => {
    const z0 = 0.26 - i * 0.25, z1 = z0 - 0.3
    rig.add(B, i % 2 ? CZ.SHELL2 : CZ.SHELL, loft([{ p: [0, Y, z0], w: R[i] * 0.9, h: R[i] * 0.86 }, { p: [0, Y, z0 - 0.1], w: R[i] * 1.04, h: R[i], crest: 0.2 }, { p: [0, Y, z1 + 0.04], w: R[i + 1] * 1.1, h: R[i + 1] * 1.08, crest: 0.25 }], 8, { noise: 0.03, seed: i, cap1: i === 2 ? 'tip' : null, tipP1: [0, Y + 0.06, z1 - 0.2] }))
    rig.add(B, CZ.GLOW, loft([{ p: [0, Y, z0 + 0.03], w: R[i] * 0.86, h: R[i] * 0.82 }, { p: [0, Y, z0 - 0.03], w: R[i] * 0.86, h: R[i] * 0.82 }], 8, {}))
    rig.add(B, CZ.BONE, horn([0, Y + R[i] * 0.95, z0 - 0.14], [0, Y + R[i] + 0.22, z0 - 0.32], 0.05, { n: 4 }))
    for (const s of [1, -1]) rig.add(B, CZ.BONE, horn([s * R[i] * 0.9, Y + 0.08, z0 - 0.14], [s * (R[i] + 0.17), Y + 0.16, z0 - 0.3], 0.04))
  })
  rig.add('head', CZ.LIMB, loft([{ p: [0, Y, 0.22], w: 0.25, h: 0.24 }, { p: [0, Y, 0.36], w: 0.22, h: 0.21 }, { p: [0, Y, 0.48], w: 0.13, h: 0.13 }], 8, {}))
  rig.add('head', CZ.GLOW, eye(0.16, Y + 0.15, 0.4, 0.04), eye(-0.16, Y + 0.15, 0.4, 0.04))
  rig.add('drill', CZ.GLOW, blob([0, Y, 0.5], [0.1, 0.1, 0.07], 5, { rings: 1 }))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4, cx = cos(a), sy = sin(a); rig.add('drill', CZ.BONE, horn([cx * 0.13, Y + sy * 0.13, 0.43], [cx * 0.02, Y + sy * 0.02, 1.02], 0.095, { n: 4, segs: 3, bend: [cx * 0.13 - sy * 0.07, sy * 0.13 + cx * 0.07, 0.0], flatten: 0.55, up: [-sy, cx, 0] })) }
  // 铲肢
  for (const s of [1, -1]) {
    const B = s > 0 ? 'shR' : 'shL', a = [s * 0.22, Y - 0.04, 0.16], b = [s * 0.52, Y + 0.14, 0.34]
    rig.bone(B, 's0', ...a)
    rig.add(B, CZ.LIMB, seg(a, b, 0.09, 0.075, 5))
    rig.add(B, CZ.BONE, horn(b, [s * 0.5, 0.0, 0.74], 0.17, { n: 4, segs: 2, bend: [s * 0.1, 0.02, 0.1], flatten: 0.3, up: [s * 0.9, 0.4, 0] }))
  }
  const gait = legs(rig, 's1', [{ z: -0.1, dz: -0.02, phase: 0 }, { z: -0.36, dz: -0.12, phase: PI, reach: 0.26 }], { hipX: 0.2, hipY: 0.2, reach: 0.3, knee: 0.12, r: 0.05, n: 4, swing: 0.5, lift: 0.35, tip: CZ.BONE })
  // 土堆：一圈掀起的甲板碎块
  for (let k = 0; k < 9; k++) { const a = k * TAU / 9 + 0.3, r = 0.5 + (k % 3) * 0.07, h = 0.22 + (k % 2) * 0.14; rig.add('mound', k % 2 ? CZ.LIMB : CZ.SHELL2, horn([cos(a) * r, -0.02, sin(a) * r], [cos(a) * (r + 0.24), h, sin(a) * (r + 0.24)], 0.19, { n: 4, flat: true, flatten: 0.6, up: [-sin(a), 0, cos(a)] })) }
  const noMound = (P) => P.s('mound', 0.0001).t('mound', 0, -0.5, 0)
  const spin = (P, turns) => P.r('drill', 0, 0, turns * PI / 2)
  const wave = (P, a, amp) => { P.r('s1', 0, amp * sin(a), 0).r('s2', 0, amp * sin(a - 1), 0).r('s0', 0, -amp * 0.5 * sin(a), 0) }
  rig.clip('walk', 12, 0.6, true, (u, P) => { noMound(P); gait(u, P); const a = u * TAU; wave(P, a, 0.14); spin(P, u); P.r('shR', 0.35 * sin(a), 0, 0).r('shL', 0.35 * sin(a + PI), 0, 0) })
  rig.clip('attack', 8, 0.5, false, (u, P) => { noMound(P); const w = bump(u, 0, 0.6), f = bump(u, 0.4, 1); spin(P, u * 3); P.r('shR', -1.0 * w + 0.5 * f, 0, 0).r('shL', -1.0 * w + 0.5 * f, 0, 0).t('head', 0, 0, 0.14 * f).r('s0', -0.25 * w + 0.1 * f, 0, 0) })
  rig.clip('emerge', 10, 0.5, false, (u, P) => {
    const k = 1 - ease(u)
    P.t('root', 0, -1.25 * k, -0.2 * k).r('root', -1.35 * k, 0, 0); spin(P, u * 6); wave(P, u * 9, 0.2 * k)
    P.r('shR', -0.8 * bump(u, 0.2, 1), 0, 0.7 * k).r('shL', -0.8 * bump(u, 0.2, 1), 0, -0.7 * k).s('mound', 0.3 + 0.7 * ramp(u, 0, 0.3))
  })
  flipDeath(rig, gait, 0.6, (u, P, k) => { noMound(P); P.r('shR', 0.8 * k, 0, 0).r('shL', 0.8 * k, 0, 0).r('s1', 0, 0.3 * k, 0).r('s2', 0, 0.4 * k, 0) })
  return rig
}

// ------------------------------------------------------------------ 护巢虫（光环）：高耸的柱状躯干，头顶一圈弯角笼着发光的光环器官
export function buildWarden() {
  const rig = new Rig()
  const S = [[0, 0.5, 0], [0, 0.84, 0.03], [0, 1.2, 0.06], [0, 1.58, 0.02]]
  rig.bone('root', null, 0, 0, 0).bone('hip', 'root', ...S[0]).bone('s1', 'hip', ...S[1]).bone('s2', 's1', ...S[2]).bone('crown', 's2', ...S[3]).bone('orb', 'crown', 0, 1.9, 0.02)
  const UB = [0, 0.1, -1]
  rig.add('hip', CZ.SHELL2, blob([0, 0.5, 0], [0.33, 0.2, 0.33], 8, { rings: 2, noise: 0.05 }))
  for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + 0.5; rig.add('hip', CZ.BONE, horn([cos(a) * 0.27, 0.55, sin(a) * 0.27], [cos(a) * 0.5, 0.74, sin(a) * 0.5], 0.05)) }
  for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.3; rig.add('hip', CZ.FLESH, horn([cos(a) * 0.12, 0.4, sin(a) * 0.12], [cos(a) * 0.2, 0.06, sin(a) * 0.2], 0.04, { segs: 2, bend: [cos(a) * 0.08, 0, sin(a) * 0.08] })) }
  const W = [0.2, 0.175, 0.15, 0.12], B = ['hip', 's1', 's2']
  for (let i = 0; i < 3; i++) {
    rig.add(B[i], CZ.FLESH, bodySeg(S[i], S[i + 1], W[i], W[i + 1], 7, { hk: 0.9, up: UB }))
    rig.add(B[i], i % 2 ? CZ.SHELL2 : CZ.SHELL, plate([{ p: mix3(S[i], S[i + 1], 0.0), w: W[i] * 1.1, h: W[i] * 1.05 }, { p: mix3(S[i], S[i + 1], 0.6), w: W[i] * 1.3, h: W[i] * 1.2, crest: 0.4 }, { p: mix3(S[i], S[i + 1], 1.1), w: W[i + 1] * 1.5, h: W[i + 1] * 1.45, crest: 0.5 }], 6, 2.0, { up: UB }))
    // 正面的发光裂隙（光环器官的「导管」）
    const m = mix3(S[i], S[i + 1], 0.5)
    rig.add(B[i], CZ.GLOW2, blob([0, m[1], m[2] + W[i] * 0.78], [0.035, 0.12, 0.035], 4, { rings: 1, dir: [0, 1, 0] }))
    rig.add(B[i], CZ.BONE, horn([0, m[1] + 0.12, m[2] - W[i] * 1.2], [0, m[1] + 0.34, m[2] - W[i] - 0.3], 0.045))
  }
  for (const s of [1, -1]) rig.add('s2', CZ.BONE, horn([s * 0.14, 1.42, 0.12], [s * 0.12, 1.08, 0.46], 0.04, { segs: 3, bend: [s * 0.1, 0.08, 0.16] }))
  rig.add('crown', CZ.SHELL2, blob([0, 1.6, 0.04], [0.15, 0.13, 0.17], 6, { rings: 2 }))
  rig.add('crown', CZ.GLOW, eye(0.08, 1.62, 0.19, 0.03), eye(-0.08, 1.62, 0.19, 0.03), eye(0, 1.56, 0.21, 0.025))
  for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + PI / 2, cx = cos(a), sz = sin(a); rig.add('crown', CZ.BONE, horn([cx * 0.11, 1.66, sz * 0.11 + 0.02], [cx * 0.17, 2.22, sz * 0.17 + 0.02], 0.055, { n: 4, segs: 3, bend: [cx * 0.3, -0.04, sz * 0.3] })) }
  rig.add('orb', CZ.GLOW2, blob([0, 1.9, 0.02], [0.15, 0.15, 0.15], 6, { rings: 3 }))
  const gait = legs(rig, 'hip', [{ z: 0.14, dz: 0.3, phase: 0 }, { z: -0.14, dz: -0.3, phase: PI }], { hipX: 0.22, hipY: 0.46, reach: 0.36, knee: 0.14, r: 0.1, n: 5, two: true, spur: 0.12, swing: 0.3, lift: 0.22, tip: CZ.BONE, thigh: 1.2 })
  rig.clip('walk', 14, 1.0, true, (u, P) => {
    gait(u, P); const a = u * TAU
    P.t('hip', 0, 0.02 * sin(a * 2), 0).r('hip', 0, 0, 0.03 * sin(a)).r('s1', 0.03 * sin(a * 2), 0, -0.05 * sin(a - 0.5)).r('s2', 0.03 * sin(a * 2 - 0.5), 0, -0.05 * sin(a - 1)).r('crown', 0, 0.1 * sin(a), -0.04 * sin(a - 1.5)).s('orb', 1 + 0.1 * sin(a * 2))
  })
  rig.clip('attack', 10, 1.0, true, (u, P) => { const a = u * TAU; P.s('orb', 1.25 + 0.25 * sin(a)).s('crown', 1 + 0.05 * sin(a)).r('s1', -0.06, 0, 0).r('s2', -0.06, 0, 0).t('hip', 0, 0.03 * sin(a), 0) })
  rig.clip('die', 10, 0.9, false, (u, P) => {
    const k = ease(u)
    P.t('hip', 0, -0.3 * k, 0).r('hip', 0.2 * k, 0, 0.35 * k).r('s1', 0.3 * k, 0, 0.5 * k).r('s2', 0.3 * k, 0, 0.5 * k).r('crown', 0.4 * k, 0, 0.3 * k).s('orb', 1 + 0.4 * bump(u, 0, 0.3) - 0.9 * k); gait.splay(P, k)
  })
  return rig
}

// ------------------------------------------------------------------ 举盾虫（§13）：正面一整块面具状骨盾（头冠长成的），身体缩在后面
export function buildShieldbug() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.1, 0).bone('body', 'root', 0, 0.28, 0).bone('shield', 'body', 0, 0.3, 0.34).bone('tail', 'body', 0, 0.3, -0.3)
  rig.add('body', CZ.SHELL2, bodySeg([0, 0.28, 0.3], [0, 0.3, -0.3], 0.17, 0.2, 6, { hk: 0.75 }))
  rig.add('body', CZ.SHELL, plate([{ p: [0, 0.28, 0.3], w: 0.2, h: 0.17 }, { p: [0, 0.31, -0.04], w: 0.29, h: 0.24, crest: 0.3 }], 5, 1.5))
  rig.add('tail', CZ.SHELL, loft([{ p: [0, 0.3, -0.06], w: 0.24, h: 0.19 }, { p: [0, 0.32, -0.3], w: 0.27, h: 0.22, crest: 0.3 }, { p: [0, 0.28, -0.52], w: 0.14, h: 0.12 }], 6, { cap1: 'tip', tipP1: [0, 0.36, -0.72] }))
  rig.add('tail', CZ.GLOW, blob([0.2, 0.34, -0.3], [0.05, 0.05, 0.11], 4, { rings: 1 }), blob([-0.2, 0.34, -0.3], [0.05, 0.05, 0.11], 4, { rings: 1 }))
  rig.add('tail', CZ.BONE, horn([0, 0.5, -0.24], [0, 0.72, -0.42], 0.045), horn([0, 0.46, -0.42], [0, 0.6, -0.6], 0.035))
  // 盾：上宽下尖的骨板，中线起脊，向前鼓；正反两面
  const SH = [{ p: [0, 0.1, 0.5], w: 0.2, h: 0.06 }, { p: [0, 0.34, 0.56], w: 0.44, h: 0.15, crest: 0.35 }, { p: [0, 0.66, 0.54], w: 0.55, h: 0.18, crest: 0.35 }, { p: [0, 0.9, 0.44], w: 0.36, h: 0.13, crest: 0.3 }]
  rig.add('shield', CZ.SHELL, loft(ribbed(SH, 2, 0.03), 8, { flat: true, arc: [-1.57, 1.57], up: [0, 0, 1], sq: 2.3, cap0: 'tip', tipP0: [0, -0.04, 0.5], cap1: 'tip', tipP1: [0, 1.08, 0.4], noise: 0.03, seed: 8 }))
  // 骨质的中脊和两道边框：暗色甲面 + 浅色骨框 = 一张「面具」
  const SHB = SH.map((s) => ({ ...s, h: s.h * 1.12, w: s.w * 1.03, crest: 0.5 }))
  rig.add('shield', CZ.BONE, loft(SHB, 2, { arc: [-0.2, 0.2], up: [0, 0, 1], sq: 2.3, cap0: 'tip', tipP0: [0, -0.1, 0.52], cap1: 'tip', tipP1: [0, 1.2, 0.42] }))
  rig.add('shield', CZ.BONE, loft(SHB, 2, { arc: [1.12, 1.6], up: [0, 0, 1], sq: 2.3, cap0: 'tip', tipP0: [0, -0.04, 0.5], cap1: 'tip', tipP1: [0, 1.1, 0.4] }), loft(SHB, 2, { arc: [-1.6, -1.12], up: [0, 0, 1], sq: 2.3, cap0: 'tip', tipP0: [0, -0.04, 0.5], cap1: 'tip', tipP1: [0, 1.1, 0.4] }))
  rig.add('shield', CZ.SHELL2, loft(SH.map((s) => ({ ...s, p: [0, s.p[1], s.p[2] - 0.035], h: s.h * 0.8, crest: 0 })), 6, { arc: [1.57, -1.57], up: [0, 0, 1], sq: 2.3, cap0: 'tip', tipP0: [0, -0.04, 0.47], cap1: 'tip', tipP1: [0, 1.08, 0.37] }))
  for (const s of [1, -1]) {
    rig.add('shield', CZ.BONE, horn([s * 0.5, 0.7, 0.54], [s * 0.8, 1.06, 0.4], 0.085, { n: 4, segs: 2, bend: [s * 0.08, 0, 0.02] }), horn([s * 0.5, 0.5, 0.56], [s * 0.76, 0.5, 0.5], 0.06, { n: 4 }), horn([s * 0.42, 0.32, 0.56], [s * 0.66, 0.2, 0.6], 0.06, { n: 4 }), horn([s * 0.24, 0.92, 0.46], [s * 0.32, 1.22, 0.38], 0.055))
    // 面具上的眼缝
    rig.add('shield', CZ.GLOW, eye(s * 0.23, 0.69, 0.7, 0.1, 1.3, 0.5, 0.5), eye(s * 0.31, 0.5, 0.67, 0.06, 1.2, 0.5, 0.5), eye(s * 0.17, 0.32, 0.68, 0.045, 1.2, 0.5, 0.5))
    rig.add('shield', CZ.LIMB, seg([s * 0.12, 0.3, 0.28], [s * 0.24, 0.46, 0.5], 0.06, 0.05, 4))
    rig.add('shield', CZ.BONE, horn([s * 0.08, 0.14, 0.56], [s * 0.04, 0.0, 0.74], 0.035))
  }
  const gait = legs(rig, 'body', [{ z: 0.16, dz: 0.1, phase: 0 }, { z: -0.04, dz: -0.04, phase: PI, reach: 0.42 }, { z: -0.24, dz: -0.2, phase: 0 }], { hipX: 0.15, hipY: 0.22, reach: 0.38, knee: 0.18, r: 0.05, n: 4, swing: 0.4, lift: 0.3 })
  rig.clip('walk', 12, 0.7, true, (u, P) => { gait(u, P); const a = u * TAU; P.r('shield', 0.04 * sin(a * 2), 0.06 * sin(a), 0.03 * sin(a)).t('body', 0, 0.012 * sin(a * 2), 0).r('tail', 0, 0.12 * sin(a + 1), 0) })
  rig.clip('attack', 8, 0.5, false, (u, P) => { const w = bump(u, 0, 0.5), f = bump(u, 0.35, 1); P.t('shield', 0, 0.04 * f, -0.1 * w + 0.28 * f).r('shield', -0.2 * w + 0.3 * f, 0, 0).t('body', 0, 0, -0.05 * w + 0.12 * f) })
  rig.clip('die', 8, 0.6, false, (u, P) => { const k = ease(u); P.r('shield', 1.35 * k, 0, 0.15 * k).t('shield', 0, -0.06 * k, 0.12 * k).r('root', 0, 0, 0.75 * k).r('tail', 0, 0.4 * k, 0); gait.curl(P, k) })
  return rig
}
