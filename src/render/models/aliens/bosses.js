// models/aliens/bosses.js —— 三只 Boss（原创造型，程序化）。
//   ravager   「碾压者」   四足攻城巨兽：柱状粗腿、层层叠压的驼背甲、肩上一对 4 米长的巨镰
//   matriarch 「巢母」     臃肿的产卵母体：三节肉腹上鼓满发光卵囊，小小的前胸 + 高耸的王冠
//   leviathan 「渊噬蠕虫」 从甲板下竖起来的分节巨虫：背甲带棘，正面是发光的弱点囊，三瓣巨颚
// clip：walk / attack / windup / charge / stun / die / emerge / burrow（没有的由资源表回落到 walk）
import { Rig, CZ, PI, TAU, sin, cos, abs, max, bump, ease, ramp, lerp, loft, plate, blob, horn, seg, fin, eye, xf } from './kit.js'

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

// ================================================================== 碾压者
export function buildRavager() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 1.7, 0).bone('head', 'body', 0, 1.55, 1.55).bone('jawR', 'head', 0.5, 1.05, 2.3).bone('jawL', 'head', -0.5, 1.05, 2.3)
    .bone('abdo', 'body', 0, 1.6, -1.1).bone('tail', 'abdo', 0, 1.5, -2.6).bone('tail2', 'tail', 0, 1.75, -3.5)
  // 躯干：深色肉身 + 四片叠甲（肩峰最高）
  rig.add('body', CZ.LIMB, blob([0, 1.55, 0.2], [1.1, 0.9, 1.7], 10, { rings: 4, noise: 0.05, seed: 1, belly: 0.8 }))
  rig.add('abdo', CZ.LIMB, blob([0, 1.45, -1.8], [0.95, 0.8, 1.2], 9, { rings: 3, noise: 0.05, seed: 2, belly: 0.8 }))
  const PO = { sq: 2.35, noise: 0.035, ribs: 3 }
  const PA = [{ p: [0, 1.6, 1.8], w: 0.72, h: 0.55 }, { p: [0, 1.68, 1.35], w: 1.08, h: 0.98, crest: 0.2 }, { p: [0, 1.76, 0.85], w: 1.32, h: 1.3, crest: 0.28 }]
  const PB = [{ p: [0, 1.68, 1.0], w: 1.22, h: 1.1 }, { p: [0, 1.76, 0.45], w: 1.42, h: 1.48, crest: 0.25 }, { p: [0, 1.82, -0.15], w: 1.46, h: 1.62, crest: 0.32 }]
  const PC = [{ p: [0, 1.68, 0.0], w: 1.32, h: 1.26 }, { p: [0, 1.7, -0.6], w: 1.32, h: 1.3, crest: 0.22 }, { p: [0, 1.72, -1.2], w: 1.22, h: 1.32, crest: 0.3 }]
  const PD = [{ p: [0, 1.6, -1.05], w: 1.14, h: 1.08 }, { p: [0, 1.55, -1.7], w: 1.06, h: 1.06, crest: 0.22 }, { p: [0, 1.46, -2.4], w: 0.72, h: 0.78, crest: 0.25 }]
  rig.add('body', CZ.SHELL2, plate(PA, 12, 1.8, { ...PO, seed: 3 }))
  rig.add('body', CZ.SHELL, plate(PB, 12, 1.8, { ...PO, seed: 4 }))
  rig.add('body', CZ.SHELL2, plate(PC, 12, 1.8, { ...PO, seed: 5 }))
  rig.add('abdo', CZ.SHELL, plate(PD, 12, 1.8, { ...PO, seed: 6, cap1: 'tip', tipP1: [0, 1.6, -2.95] }))
  // 每片甲的后缘：中脊一根大刺 + 两侧各两根
  const lips = [['body', 1.76, 1.3, 1.32, 0.85], ['body', 1.82, 1.62, 1.46, -0.15], ['body', 1.72, 1.32, 1.22, -1.2], ['abdo', 1.5, 0.95, 0.9, -2.1]]
  lips.forEach(([B, cy, h, w, z], i) => {
    rig.add(B, CZ.BONE, horn([0, cy + h * 1.2, z + 0.25], [0, cy + h * 1.2 + 0.75 - i * 0.08, z - 0.55], 0.2, { n: 5, segs: 2, bend: [0, 0.12, 0.05] }))
    for (const s of [1, -1]) {
      rig.add(B, CZ.BONE, horn([s * w * 0.55, cy + h * 0.86, z + 0.2], [s * w * 0.8, cy + h + 0.5, z - 0.45], 0.15, { n: 4, segs: 2, bend: [s * 0.05, 0.1, 0.05] }))
      rig.add(B, CZ.BONE, horn([s * w * 0.95, cy + h * 0.36, z + 0.2], [s * (w + 0.55), cy + h * 0.55, z - 0.4], 0.14, { n: 4, segs: 2, bend: [s * 0.08, 0.08, 0.05] }))
      rig.add(B, CZ.GLOW, blob([s * w * 0.36, cy + h * (i === 3 ? 0.98 : 0.9), z + (i === 3 ? 0.75 : 0.5)], [0.17, 0.1, 0.26], 5, { rings: 2 }))
    }
  })
  // 肋侧的发光弱点囊（甲片盖不住的地方）
  for (const s of [1, -1]) for (const [y, z, r] of [[1.25, 0.95, 0.2], [1.12, 0.35, 0.24], [1.2, -0.3, 0.2], [1.22, -1.0, 0.17], [1.15, -1.6, 0.2]]) rig.add(z < -1.1 ? 'abdo' : 'body', CZ.GLOW, blob([s * (1.02 - abs(z + 0.2) * 0.1), y, z], [r * 0.55, r, r * 1.25], 5, { rings: 2 }))
  // 尾：两节 + 带刃的骨锤
  rig.add('tail', CZ.SHELL2, seg([0, 1.5, -2.5], [0, 1.78, -3.55], 0.48, 0.32, 7, { mid: 1.05, flat: true }))
  rig.add('tail', CZ.BONE, horn([0, 1.98, -2.9], [0, 2.5, -3.35], 0.13, { n: 4 }))
  rig.add('tail2', CZ.SHELL, seg([0, 1.75, -3.45], [0, 2.25, -4.2], 0.32, 0.22, 6, { flat: true }))
  rig.add('tail2', CZ.BONE, blob([0, 2.35, -4.35], [0.4, 0.36, 0.46], 6, { rings: 2, noise: 0.1, seed: 3, flat: true }), horn([0, 2.6, -4.35], [0, 3.3, -4.75], 0.16, { n: 4 }), horn([0.3, 2.35, -4.45], [0.95, 2.5, -4.9], 0.14, { n: 4 }), horn([-0.3, 2.35, -4.45], [-0.95, 2.5, -4.9], 0.14, { n: 4 }), horn([0, 2.2, -4.7], [0, 2.1, -5.3], 0.14, { n: 4 }))
  // 头：厚重的楔形颅 + 三叉冠 + 左右开合的钩颚
  rig.add('head', CZ.SHELL2, loft([{ p: [0, 1.5, 1.45], w: 0.72, h: 0.62, b: 0.5 }, { p: [0, 1.4, 2.1], w: 0.8, h: 0.56, b: 0.4, crest: 0.3 }, { p: [0, 1.24, 2.7], w: 0.56, h: 0.36, b: 0.24, crest: 0.3 }], 10, { cap1: 'tip', tipP1: [0, 1.0, 3.2], sq: 2.3, noise: 0.03, seed: 7, flat: true }))
  rig.add('head', CZ.SHELL, plate([{ p: [0, 1.5, 1.4], w: 0.8, h: 0.72 }, { p: [0, 1.42, 1.95], w: 0.9, h: 0.68, crest: 0.4 }, { p: [0, 1.36, 2.35], w: 0.74, h: 0.5, crest: 0.4 }], 8, 1.35, { sq: 2.3, ribs: 2 }))
  rig.add('head', CZ.BONE, horn([0, 2.0, 1.9], [0, 3.1, 1.2], 0.22, { n: 5, segs: 3, bend: [0, 0.25, 0.3], flatten: 0.6 }))
  rig.add('head', CZ.FLESH, blob([0, 1.02, 2.3], [0.42, 0.26, 0.6], 6, { rings: 2 }))
  rig.add('head', CZ.GLOW, blob([0, 0.98, 2.75], [0.2, 0.14, 0.3], 5, { rings: 2 }))
  for (const s of [1, -1]) {
    rig.add('head', CZ.BONE, horn([s * 0.5, 1.9, 1.8], [s * 1.3, 2.7, 1.0], 0.18, { n: 4, segs: 3, bend: [s * 0.2, 0.2, 0.25] }), horn([s * 0.75, 1.5, 1.7], [s * 1.5, 1.7, 1.2], 0.14, { n: 4 }))
    rig.add('head', CZ.GLOW, eye(s * 0.42, 1.8, 2.44, 0.17, 1.2, 0.6, 1.6), eye(s * 0.64, 1.7, 2.18, 0.13, 1.2, 0.6, 1.6), eye(s * 0.76, 1.6, 1.94, 0.1, 1.2, 0.6, 1.6))
    rig.add(s > 0 ? 'jawR' : 'jawL', CZ.BONE, horn([s * 0.5, 1.05, 2.25], [s * 0.2, 0.62, 3.6], 0.24, { n: 5, segs: 3, bend: [s * 0.5, 0.05, 0.15], flatten: 0.65 }), horn([s * 0.72, 1.0, 2.7], [s * 1.1, 0.8, 3.0], 0.09))
  }
  // 巨镰：肩甲 → 上臂斜向上举 → 从肘部向前下方劈出的长刃
  for (const s of [1, -1]) {
    const A = s > 0 ? 'scyR' : 'scyL', Bl = s > 0 ? 'blR' : 'blL'
    const sh = [s * 1.05, 2.55, 0.75], el = [s * 2.05, 3.7, 1.25], tip = [s * 1.55, 0.55, 4.7]
    rig.bone(A, 'body', ...sh).bone(Bl, A, ...el)
    rig.add(A, CZ.SHELL, blob([s * 1.15, 2.7, 0.75], [0.55, 0.45, 0.6], 7, { rings: 2, noise: 0.06, seed: 11, flat: true }))
    rig.add(A, CZ.LIMB, seg(sh, el, 0.36, 0.27, 7, { mid: 1.12 }))
    rig.add(A, CZ.BONE, horn([s * 1.3, 3.05, 0.7], [s * 1.75, 3.75, 0.2], 0.14, { n: 4 }))
    rig.add(Bl, CZ.SHELL2, blob(el, [0.36, 0.36, 0.4], 6, { rings: 2, flat: true }))
    rig.add(Bl, CZ.BONE, horn(el, tip, 0.56, { n: 4, segs: 5, bend: [s * 0.35, 1.25, 0.75], flatten: 0.55, up: [0, 0.75, 0.65], pow: 0.62 }))
    rig.add(Bl, CZ.BONE, horn([el[0], el[1] + 0.15, el[2] - 0.15], [el[0] + s * 0.25, el[1] + 0.85, el[2] - 0.85], 0.17, { n: 4 }))
    for (let i = 1; i <= 3; i++) { const t = i / 5, q = 4 * t * (1 - t); const p = [lerp(el[0], tip[0], t) + s * 0.35 * q, lerp(el[1], tip[1], t) + 1.25 * q + 0.3, lerp(el[2], tip[2], t) + 0.75 * q + 0.1]; rig.add(Bl, CZ.BONE, horn(p, [p[0], p[1] + 0.32, p[2] - 0.12], 0.1)) }
  }
  // 四条柱状粗腿（髋 → 膝 → 踝 → 蹄）
  const LEGS = []
  for (const [i, z, ph] of [[0, 0.95, 0], [1, -1.35, PI]]) for (const s of [1, -1]) {
    const n = `leg${i}${s > 0 ? 'R' : 'L'}`, hip = [s * 0.95, 1.55, z], knee = [s * 1.62, 1.3, z + 0.3], ank = [s * 1.55, 0.5, z - 0.12], foot = [s * 1.6, 0.0, z + 0.2]
    rig.bone(n, 'body', ...hip).bone(n + 'b', n, ...knee)
    rig.add(n, CZ.SHELL2, seg(hip, knee, 0.55, 0.42, 8, { mid: 1.15, noise: 0.05, seed: i + 20, flat: true }))
    rig.add(n, CZ.SHELL, plate([{ p: mix3(hip, knee, 0.1), w: 0.6, h: 0.62 }, { p: mix3(hip, knee, 1.12), w: 0.5, h: 0.56, crest: 0.4 }], 5, 1.3, { up: [s * 0.8, 0.6, 0] }))
    rig.add(n, CZ.BONE, horn([knee[0] + s * 0.2, knee[1] + 0.2, knee[2]], [knee[0] + s * 0.7, knee[1] + 0.85, knee[2] - 0.3], 0.16, { n: 4 }))
    rig.add(n + 'b', CZ.LIMB, seg(knee, ank, 0.4, 0.26, 7, { cap0: true, flat: true }))
    rig.add(n + 'b', CZ.BONE, blob([foot[0], 0.2, foot[2]], [0.38, 0.22, 0.46], 6, { rings: 2, belly: 0.5, flat: true }), horn([foot[0] + s * 0.2, 0.18, foot[2] + 0.3], [foot[0] + s * 0.36, 0.0, foot[2] + 0.75], 0.13, { n: 4 }), horn([foot[0] - s * 0.16, 0.18, foot[2] + 0.34], [foot[0] - s * 0.22, 0.0, foot[2] + 0.8], 0.13, { n: 4 }), horn([ank[0], ank[1] + 0.1, ank[2] - 0.2], [ank[0] + s * 0.1, ank[1] + 0.5, ank[2] - 0.6], 0.11))
    LEGS.push({ n, s, ph: ph + (s > 0 ? 0 : PI), front: i === 0 })
  }
  const gait = (u, P, amp, A = 0.34) => { for (const l of LEGS) { const t = u * TAU + l.ph, up = max(0, -sin(t)); P.r(l.n, -A * cos(t) * amp - 0.25 * up * amp, 0, 0).r(l.n + 'b', 0.75 * up * amp, 0, 0) } }
  const splay = (P, k) => { for (const l of LEGS) P.r(l.n, (l.front ? -0.5 : 0.5) * k, 0, -l.s * 0.55 * k).r(l.n + 'b', (l.front ? 0.3 : -0.3) * k, 0, l.s * 0.5 * k) }
  const scy = (P, rx, ry, rz = 0, brx = 0) => { P.r('scyR', rx, ry, rz).r('scyL', rx, -ry, -rz).r('blR', brx, 0, 0).r('blL', brx, 0, 0) }
  const jaws = (P, k) => { P.r('jawR', 0, k, 0).r('jawL', 0, -k, 0) }
  rig.clip('walk', 16, 1.3, true, (u, P) => {
    gait(u, P, 1); const a = u * TAU
    P.t('body', 0, 0.07 * sin(a * 2), 0).r('body', 0.02 * sin(a * 2), 0.03 * sin(a), 0.035 * sin(a)).r('head', 0.06 * sin(a * 2 + 1), -0.08 * sin(a), 0).r('abdo', 0, 0.05 * sin(a + 0.5), 0).r('tail', 0, 0.2 * sin(a + 1), 0).r('tail2', 0, 0.25 * sin(a + 0.3), 0)
    P.r('scyR', 0.06 * sin(a * 2), 0.05 * sin(a), 0).r('scyL', 0.06 * sin(a * 2 + 1), 0.05 * sin(a), 0).r('blR', 0.06 * sin(a * 2 + 0.6), 0, 0).r('blL', 0.06 * sin(a * 2 + 1.6), 0, 0); jaws(P, 0.1 + 0.08 * sin(a * 2))
  })
  rig.clip('attack', 14, 0.9, false, (u, P) => {   // 横扫：双镰向外张开蓄力 → 交叉向内横斩 → 收回
    const w = bump(u, 0, 0.42), f = ramp(u, 0.3, 0.55) * (1 - ramp(u, 0.75, 1))
    P.r('scyR', -0.25 * w + 0.5 * f, 0.75 * w - 1.05 * f, 0).r('scyL', -0.25 * w + 0.5 * f, -0.75 * w + 1.05 * f, 0).r('blR', -0.3 * w + 0.35 * f, 0, 0).r('blL', -0.3 * w + 0.35 * f, 0, 0)
    P.r('body', -0.1 * w + 0.12 * f, 0, 0).t('body', 0, 0.15 * w - 0.2 * f, -0.2 * w + 0.6 * f).r('head', -0.3 * w + 0.25 * f, 0, 0).r('tail', 0.3 * f, 0, 0); jaws(P, 0.6 * w + 0.2 * f)
    gait(u * 0.5, P, 0.4)
  })
  rig.clip('windup', 10, 0.6, true, (u, P) => {   // 冲锋蓄力：后坐、压头、双镰后收高举、前蹄刨地
    const a = u * TAU
    P.r('body', 0.16, 0, 0.015 * sin(a * 4)).t('body', 0, -0.3, -0.55 + 0.08 * sin(a * 2)).r('head', 0.38 + 0.05 * sin(a * 2), 0, 0).r('tail', -0.4, 0.3 * sin(a), 0).r('tail2', -0.3, 0, 0)
    scy(P, -0.55 + 0.04 * sin(a * 2), 0.25, 0, -0.35); jaws(P, 0.45)
    P.r('leg0R', -0.55 * max(0, sin(a)), 0, 0).r('leg0Rb', 0.9 * max(0, sin(a)), 0, 0).r('leg1R', 0.25, 0, 0).r('leg1L', 0.25, 0, 0).r('leg1Rb', -0.3, 0, 0).r('leg1Lb', -0.3, 0, 0)
  })
  rig.clip('charge', 8, 0.32, true, (u, P) => {   // 冲锋：低头、双镰平端向前当撞角
    gait(u, P, 1.7, 0.45); const a = u * TAU
    P.r('body', 0.14 + 0.03 * sin(a * 2), 0, 0).t('body', 0, -0.2 + 0.12 * sin(a * 2), 0.35).r('head', 0.42, 0, 0).r('tail', -0.55, 0, 0).r('tail2', -0.3, 0, 0)
    scy(P, 0.5, -0.12, 0, 0.3); jaws(P, 0.5)
  })
  rig.clip('stun', 12, 1.6, true, (u, P) => {   // 眩晕：趴倒、双镰瘫在两侧、头晃
    const a = u * TAU
    P.t('body', 0, -0.62, 0).r('body', 0.1, 0, 0.06 * sin(a)).r('head', 0.5, 0.3 * sin(a), 0.2 * sin(a + 1)).r('tail', 0.25, 0.1 * sin(a), 0).r('tail2', 0.3, 0, 0)
    P.r('scyR', 0.55, 0.8, 0.25).r('scyL', 0.55, -0.8, -0.25).r('blR', 0.3 + 0.04 * sin(a * 2), 0, 0).r('blL', 0.3 + 0.04 * sin(a * 2 + 1), 0, 0); jaws(P, 0.3 + 0.1 * sin(a * 2)); splay(P, 0.7)
  })
  rig.clip('die', 16, 1.6, false, (u, P) => {   // 扬身嘶吼 → 侧倒
    const k = ramp(u, 0.3, 1), sh = bump(u, 0, 0.5)
    P.t('body', 0, 0.35 * sh - 0.95 * k, 0).r('body', -0.32 * sh + 0.1 * k, 0, 0.32 * k).r('head', -0.6 * sh + 0.75 * k, 0.3 * k, 0).r('tail', 0.5 * k, 0.4 * k, 0).r('tail2', 0.4 * k, 0.3 * k, 0).r('abdo', 0, 0, 0.1 * k)
    P.r('scyR', -0.5 * sh + 0.7 * k, 0.6 * k, 0.3 * k).r('scyL', -0.5 * sh + 0.5 * k, -0.9 * k, -0.2 * k).r('blR', -0.3 * sh + 0.45 * k, 0, 0).r('blL', -0.3 * sh + 0.35 * k, 0, 0); jaws(P, 0.8 * sh + 0.2 * k); splay(P, k)
  })
  rig.meta = { weak: [0, 1.2, 0.3] }
  return rig
}

// ================================================================== 巢母
export function buildMatriarch() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 2.3, 1.7).bone('neck', 'body', 0, 2.8, 2.2).bone('head', 'neck', 0, 3.7, 2.7).bone('sac', 'head', 0, 3.3, 3.0)
    .bone('a1', 'root', 0, 1.9, 1.0).bone('a2', 'a1', 0, 1.8, -1.0).bone('a3', 'a2', 0, 1.6, -2.9).bone('ovi', 'a3', 0, 1.2, -4.5)
    .bone('e1', 'a1', 0, 1.9, 0.0).bone('e2', 'a2', 0, 1.8, -1.9).bone('e3', 'a3', 0, 1.6, -3.7)
  // 三节肉腹：越往后越贴地。节间勒着几丁质箍，背上一溜鞍甲
  const AB = [['a1', [0, 1.95, 0.0], [1.85, 1.75, 1.55]], ['a2', [0, 1.8, -1.95], [2.2, 1.8, 1.7]], ['a3', [0, 1.5, -3.85], [1.7, 1.45, 1.5]]]
  AB.forEach(([B, c, r], i) => {
    rig.add(B, CZ.FLESH, blob(c, r, 14, { rings: 5, noise: 0.06, seed: 10 + i, belly: 0.85 }))
    rig.add(B, i % 2 ? CZ.SHELL : CZ.SHELL2, plate([{ p: [0, c[1] + 0.15, c[2] + r[2] * 0.75], w: r[0] * 0.5, h: r[1] * 0.78 }, { p: [0, c[1] + 0.2, c[2]], w: r[0] * 0.62, h: r[1] * 0.98, crest: 0.2 }, { p: [0, c[1] + 0.15, c[2] - r[2] * 0.8], w: r[0] * 0.5, h: r[1] * 0.84, crest: 0.3 }], 8, 1.0, { sq: 2.2, noise: 0.04, seed: 20 + i, ribs: 3 }))
    for (let k = 0; k < 3; k++) { const z = c[2] + r[2] * (0.55 - k * 0.6), y = c[1] + r[1] * (1.12 - abs(k - 1) * 0.12); rig.add(B, CZ.BONE, horn([0, y, z], [0, y + 0.75 - k * 0.1, z - 0.55], 0.17, { n: 4, segs: 2, bend: [0, 0.1, 0.06] })) }
    for (const s of [1, -1]) rig.add(B, CZ.BONE, horn([s * r[0] * 0.5, c[1] + r[1] * 0.92, c[2] - r[2] * 0.4], [s * r[0] * 0.78, c[1] + r[1] + 0.55, c[2] - r[2] * 0.75], 0.13, { n: 4 }))
    // 贴地的伪足
    if (i > 0) for (const s of [1, -1]) for (let k = 0; k < 2; k++) rig.add(B, CZ.SHELL2, horn([s * r[0] * 0.8, c[1] - r[1] * 0.62, c[2] + (k - 0.5) * r[2]], [s * (r[0] + 0.12), 0.0, c[2] + (k - 0.5) * r[2] + 0.25], 0.26, { n: 4, segs: 2, bend: [s * 0.22, 0.1, 0] }))
  })
  for (const [B, z, w, h] of [['a1', -0.98, 1.72, 1.5], ['a2', -2.92, 1.75, 1.42]]) rig.add(B, CZ.SHELL2, loft([{ p: [0, 1.8 - (z < -2 ? 0.2 : 0), z + 0.2], w, h, b: h * 0.85 }, { p: [0, 1.8 - (z < -2 ? 0.2 : 0), z - 0.2], w, h, b: h * 0.85 }], 14, { sq: 2.1 }))
  // 卵囊：鼓在肉腹两侧和背脊两旁的半透明发光囊（每节一组，各自搏动）
  const EGGS = [
    ['e1', [[1.6, 2.5, 0.35, 0.46], [-1.65, 2.3, -0.2, 0.5], [1.75, 1.6, -0.3, 0.42], [-1.6, 1.45, 0.5, 0.4], [1.05, 3.3, -0.35, 0.4], [-1.0, 3.35, 0.3, 0.36], [1.5, 1.2, 0.7, 0.34]]],
    ['e2', [[2.0, 2.5, -1.7, 0.55], [-2.05, 2.3, -2.3, 0.5], [2.1, 1.5, -2.4, 0.46], [-2.0, 1.45, -1.5, 0.48], [1.2, 3.3, -2.3, 0.44], [-1.25, 3.3, -1.6, 0.4], [-1.9, 2.0, -3.0, 0.36], [1.85, 1.9, -1.1, 0.36]]],
    ['e3', [[1.5, 2.2, -3.6, 0.46], [-1.55, 2.0, -4.1, 0.44], [1.5, 1.3, -4.3, 0.4], [-1.45, 1.25, -3.4, 0.4], [0.75, 2.75, -4.3, 0.36], [-0.8, 2.75, -3.5, 0.34], [0.0, 1.9, -5.25, 0.4]]],
  ]
  for (const [B, list] of EGGS) list.forEach(([x, y, z, r], i) => {
    const c = AB[+B[1] - 1][1], d = [x - c[0], y - c[1], z - c[2]], l = Math.hypot(...d), u = d.map((v) => v / l)
    rig.add(B, CZ.GLOW2, blob([x - u[0] * r * 0.3, y - u[1] * r * 0.3, z - u[2] * r * 0.3], [r, r, r * 0.95], 7, { rings: 3, noise: 0.1, seed: i, dir: u }))
    // 囊根的几丁质领圈：卵囊是从甲缝里鼓出来的
    rig.add(B.replace('e', 'a'), CZ.SHELL2, loft([{ p: [x - u[0] * r * 0.9, y - u[1] * r * 0.9, z - u[2] * r * 0.9], w: r * 1.1, h: r * 1.1 }, { p: [x - u[0] * r * 0.4, y - u[1] * r * 0.4, z - u[2] * r * 0.4], w: r * 1.16, h: r * 1.16 }, { p: [x - u[0] * r * 0.02, y - u[1] * r * 0.02, z - u[2] * r * 0.02], w: r * 0.9, h: r * 0.9 }], 7, { flat: true, noise: 0.08, seed: i + 3 }))
  })
  // 产卵管
  rig.add('ovi', CZ.LIMB, loft([{ p: [0, 1.25, -4.7], w: 0.75, h: 0.65 }, { p: [0, 0.95, -5.5], w: 0.5, h: 0.45 }, { p: [0, 0.6, -6.1], w: 0.26, h: 0.24 }], 8, { cap1: 'tip', tipP1: [0, 0.35, -6.5], noise: 0.05 }))
  rig.add('ovi', CZ.GLOW2, loft([{ p: [0, 0.95, -5.45], w: 0.53, h: 0.48 }, { p: [0, 0.88, -5.62], w: 0.47, h: 0.43 }], 8, {}))
  // 前胸：小而硬，带肩刺
  rig.add('body', CZ.SHELL2, blob([0, 2.3, 1.6], [1.0, 0.95, 1.05], 9, { rings: 3, noise: 0.05, seed: 30, flat: true }))
  rig.add('body', CZ.SHELL, plate([{ p: [0, 2.3, 2.5], w: 0.75, h: 0.75 }, { p: [0, 2.4, 1.8], w: 1.12, h: 1.12, crest: 0.25 }, { p: [0, 2.5, 1.0], w: 1.25, h: 1.3, crest: 0.3 }], 9, 1.7, { sq: 2.3, noise: 0.04, seed: 31, ribs: 3 }))
  for (const s of [1, -1]) rig.add('body', CZ.BONE, horn([s * 0.9, 3.0, 1.3], [s * 1.75, 4.0, 0.7], 0.2, { n: 4, segs: 2, bend: [s * 0.15, 0.15, 0] }), horn([s * 0.5, 3.45, 1.15], [s * 0.85, 4.4, 0.5], 0.17, { n: 4, segs: 2, bend: [0, 0.15, 0] }))
  // 颈 + 头：细长的颅骨，后面是一圈高耸的骨冠（冠刺之间有翼膜）
  const UB = [0, 0.4, -1]
  rig.add('neck', CZ.FLESH, seg([0, 2.75, 2.15], [0, 3.75, 2.7], 0.5, 0.36, 8, { mid: 1.05, up: UB }))
  rig.add('neck', CZ.SHELL2, plate([{ p: [0, 2.8, 2.15], w: 0.56, h: 0.54 }, { p: [0, 3.3, 2.42], w: 0.5, h: 0.5, crest: 0.4 }, { p: [0, 3.8, 2.68], w: 0.46, h: 0.46, crest: 0.4 }], 6, 1.7, { up: UB }))
  rig.add('head', CZ.SHELL, loft([{ p: [0, 3.75, 2.5], w: 0.46, h: 0.42 }, { p: [0, 3.75, 3.0], w: 0.5, h: 0.4, b: 0.26, crest: 0.4 }, { p: [0, 3.62, 3.5], w: 0.32, h: 0.24, b: 0.16, crest: 0.3 }], 8, { cap0: 'tip', tip0: 0.2, cap1: 'tip', tipP1: [0, 3.42, 3.95], sq: 2.2, flat: true }))
  const CROWN = [[0, 5.9, 1.6, 0.2], [0.75, 5.5, 1.65, 0.17], [-0.75, 5.5, 1.65, 0.17], [1.35, 4.7, 1.9, 0.15], [-1.35, 4.7, 1.9, 0.15]]
  for (const [x, y, z, r] of CROWN) rig.add('head', CZ.BONE, horn([x * 0.28, 4.0, 2.6], [x, y, z], r, { n: 4, segs: 3, bend: [x * 0.12, 0.1, -0.35], flatten: 0.7 }))
  for (const s of [1, -1]) {
    rig.add('head', CZ.MEMBRANE, fin([[s * 0.1, 4.05, 2.55], [0, 5.55, 1.62], [s * 0.72, 5.2, 1.66], [s * 1.25, 4.5, 1.9], [s * 0.4, 4.0, 2.55]]))
    rig.add('head', CZ.GLOW, eye(s * 0.3, 3.98, 3.2, 0.1, 1.2, 0.7, 1.5), eye(s * 0.42, 3.92, 2.98, 0.08, 1.2, 0.7, 1.5), eye(s * 0.46, 3.84, 2.78, 0.065, 1.2, 0.7, 1.5))
    rig.add('head', CZ.BONE, horn([s * 0.3, 3.5, 3.3], [s * 0.12, 2.95, 3.9], 0.12, { n: 4, segs: 2, bend: [s * 0.2, 0, 0.1] }))
  }
  rig.add('sac', CZ.GLOW2, blob([0, 3.28, 2.95], [0.3, 0.3, 0.36], 7, { rings: 3, noise: 0.05 }))
  // 腿：前一对是抬着的镰肢，后两对撑地
  const LEGS = []
  const spec = [[2.3, 0.9, 1.4, 0, 3.3], [1.5, 0.45, 1.75, PI, 2.7]]
  spec.forEach(([z, dz, reach, ph, ky], i) => {
    for (const s of [1, -1]) {
      const n = `leg${i}${s > 0 ? 'R' : 'L'}`
      const hip = [s * 0.8, 2.2, z], knee = [s * (0.8 + reach * 0.5), ky, z + dz * 0.4], foot = i === 0 ? [s * (0.8 + reach * 0.75), 1.5, z + dz + 1.2] : [s * (0.8 + reach), 0.0, z + dz]
      rig.bone(n, 'body', ...hip).bone(n + 'b', n, ...knee)
      rig.add(n, CZ.LIMB, seg(hip, knee, 0.36, 0.27, 6, { mid: 1.2, flat: true }))
      rig.add(n, CZ.BONE, horn(knee, [knee[0] + s * 0.3, knee[1] + 0.7, knee[2] - 0.3], 0.18, { n: 4 }))
      rig.add(n + 'b', i === 0 ? CZ.BONE : CZ.SHELL, horn(knee, foot, i === 0 ? 0.3 : 0.36, { n: 5, segs: 3, bend: [s * 0.3, i === 0 ? 0.5 : 0, 0], flatten: i === 0 ? 0.45 : 0.85, pow: 0.6 }))
      LEGS.push({ n, s, ph: ph + (s > 0 ? 0 : PI), arm: i === 0 })
    }
  })
  const gait = (u, P, amp) => { for (const l of LEGS) { const t = u * TAU + l.ph; if (l.arm) P.r(l.n, 0.08 * sin(t) * amp, 0, 0).r(l.n + 'b', 0.12 * sin(t + 1) * amp, 0, 0); else { const up = max(0, -sin(t)); P.r(l.n, 0, -l.s * 0.2 * cos(t) * amp, l.s * 0.14 * up * amp).r(l.n + 'b', 0, 0, -l.s * 0.18 * up * amp) } } }
  const peri = (P, a, amp) => { P.s('a1', 1 + amp * sin(a), 1 + amp * sin(a), 1).s('a2', 1 + amp * sin(a - 1.2), 1 + amp * sin(a - 1.2), 1).s('a3', 1 + amp * sin(a - 2.4), 1 + amp * sin(a - 2.4), 1) }
  const eggs = (P, a, amp, base = 1) => { P.s('e1', base + amp * sin(a * 2)).s('e2', base + amp * sin(a * 2 - 1.3)).s('e3', base + amp * sin(a * 2 - 2.6)) }
  rig.clip('walk', 16, 1.8, true, (u, P) => {
    gait(u, P, 1); const a = u * TAU
    P.t('body', 0, 0.06 * sin(a * 2), 0).r('neck', 0.04 * sin(a * 2), 0.08 * sin(a), 0).r('head', 0.05 * sin(a * 2 + 1), 0.1 * sin(a - 0.6), 0).s('sac', 1 + 0.06 * sin(a * 2))
    peri(P, a, 0.02); eggs(P, a, 0.05); P.r('a2', 0, 0.025 * sin(a), 0).r('a3', 0, 0.04 * sin(a - 0.8), 0).r('ovi', 0.06 * sin(a * 2), 0.12 * sin(a - 1.5), 0)
  })
  rig.clip('attack', 12, 0.5, false, (u, P) => {   // 吐酸 / 产卵共用：仰头鼓囊 → 前甩喷吐，同时肉腹一阵收缩、产卵管抬起
    const w = bump(u, 0, 0.6), f = bump(u, 0.45, 1), a = u * TAU
    P.r('neck', -0.4 * w + 0.45 * f, 0, 0).r('head', -0.35 * w + 0.4 * f, 0, 0).s('sac', 1 + 0.6 * w - 0.3 * f).r('body', -0.1 * w + 0.08 * f, 0, 0)
    P.r('leg0R', -0.4 * w, 0, 0).r('leg0L', -0.4 * w, 0, 0).r('leg0Rb', 0.5 * f, 0, 0).r('leg0Lb', 0.5 * f, 0, 0)
    peri(P, a * 2 + 1, 0.05 * (w + f)); eggs(P, a, 0.1, 1 + 0.06 * w); P.r('ovi', -0.35 * f, 0, 0)
  })
  rig.clip('stun', 10, 1.6, true, (u, P) => { const a = u * TAU; P.t('body', 0, -0.5, 0).r('neck', 0.5, 0.15 * sin(a), 0).r('head', 0.4, 0.25 * sin(a), 0.15 * sin(a + 1)); peri(P, a, 0.015); eggs(P, a, 0.03, 0.95); for (const l of LEGS) if (!l.arm) P.r(l.n, 0, 0, -l.s * 0.25); else P.r(l.n, 0.5, 0, 0) })
  rig.clip('die', 16, 1.6, false, (u, P) => {   // 扬头哀鸣 → 肉腹一节节瘪下去、卵囊熄灭 → 瘫倒
    const k = ramp(u, 0.3, 1), sh = bump(u, 0, 0.5)
    P.t('body', 0, -1.1 * k + 0.25 * sh, 0).r('body', 0.2 * k, 0, 0.2 * k).r('neck', -0.5 * sh + 0.7 * k, 0.2 * k, 0).r('head', -0.4 * sh + 0.6 * k, 0, 0).s('sac', 1 + 0.4 * sh - 0.7 * k)
    P.s('a1', 1 + 0.12 * sh, 1 + 0.12 * sh - 0.3 * k, 1).s('a2', 1 + 0.1 * sh + 0.05 * k, 1 + 0.12 * sh - 0.4 * ramp(u, 0.4, 1), 1).s('a3', 1, 1 + 0.1 * sh - 0.45 * ramp(u, 0.5, 1), 1)
    P.s('e1', 1 + 0.3 * sh - 0.75 * k).s('e2', 1 + 0.3 * sh - 0.75 * ramp(u, 0.4, 1)).s('e3', 1 + 0.3 * sh - 0.75 * ramp(u, 0.5, 1)).r('ovi', 0.3 * k, 0.3 * k, 0)
    for (const l of LEGS) if (!l.arm) P.r(l.n, 0, 0, -l.s * 0.45 * k); else P.r(l.n, 0.9 * k - 0.5 * sh, 0, 0)
  })
  rig.meta = { muzzle: [0, 3.4, 3.95] }
  return rig
}

// ================================================================== 渊噬蠕虫
export function buildLeviathan() {
  const rig = new Rig()
  const N = 8, H = 0.95
  // 身体中线：越往上越往前探（朝 +Z = 朝我方）
  const C = []
  for (let i = 0; i <= N; i++) C.push([0, i * H, Math.pow(i / N, 2.0) * 2.0])
  rig.bone('root', null, 0, 0, 0)
  let prev = 'root'
  for (let i = 0; i < N; i++) { rig.bone('s' + i, prev, ...C[i]); prev = 's' + i }
  const TOP = C[N], DIR = [0, 0.78, 0.62]   // 头的朝向
  rig.bone('maw', prev, ...TOP)
  const UB = [0, 0.3, -1]
  for (let i = 0; i < N; i++) {
    const r = 1.5 - i * 0.075, r1 = 1.5 - (i + 1) * 0.075, a = C[i], b = C[i + 1], B = 's' + i
    rig.add(B, CZ.FLESH, loft([{ p: mix3(a, b, -0.08), w: r * 0.84, h: r * 0.84 }, { p: mix3(a, b, 0.45), w: r * 0.93, h: r * 0.93 }, { p: mix3(a, b, 1.08), w: r1 * 0.82, h: r1 * 0.82 }], 12, { up: UB, noise: 0.04, seed: i }))
    // 背甲（朝后的大半圈），上缘外翻压住上一节
    rig.add(B, i % 2 ? CZ.SHELL : CZ.SHELL2, plate([{ p: mix3(a, b, 0.0), w: r * 0.98, h: r * 0.98 }, { p: mix3(a, b, 0.55), w: r * 1.06, h: r * 1.08, crest: 0.16 }, { p: mix3(a, b, 1.12), w: r * 1.16, h: r * 1.22, crest: 0.24 }], 10, 1.95, { up: UB, sq: 2.2, noise: 0.04, seed: 40 + i, ribs: 2 }))
    const m = mix3(a, b, 0.9)
    rig.add(B, CZ.BONE, horn([0, m[1], m[2] - r * 1.1], [0, m[1] + 0.75, m[2] - r - 0.95], 0.2, { n: 4, segs: 2, bend: [0, 0.12, 0] }))
    for (const s of [1, -1]) {
      rig.add(B, CZ.BONE, horn([s * r * 0.98, m[1] - 0.1, m[2] - r * 0.45], [s * (r + 0.85), m[1] + 0.5, m[2] - r * 0.7], 0.17, { n: 4, segs: 2, bend: [s * 0.1, 0.12, 0] }))
      rig.add(B, CZ.BONE, horn([s * r * 0.72, m[1] - 0.05, m[2] - r * 0.85], [s * (r * 0.72 + 0.5), m[1] + 0.5, m[2] - r - 0.5], 0.13, { n: 4 }))
      // 甲缘两侧的划水足（一排小钩）
      rig.add(B, CZ.LIMB, horn([s * r * 0.86, a[1] + 0.35, a[2] + r * 0.35], [s * (r + 0.4), a[1] + 0.05, a[2] + r * 0.95], 0.11, { n: 4, segs: 2, bend: [s * 0.25, 0.1, 0] }))
    }
    // 正面：下面几节是腹鳞，上面四节是发光的弱点囊
    const f = mix3(a, b, 0.5)
    if (i >= N - 4) {
      rig.add(B, CZ.GLOW, blob([0, f[1], f[2] + r * 0.78], [r * 0.34, H * 0.4, r * 0.24], 7, { rings: 3, noise: 0.06, seed: i }))
      for (const s of [1, -1]) rig.add(B, CZ.GLOW, blob([s * r * 0.5, f[1] + 0.12, f[2] + r * 0.62], [r * 0.17, H * 0.26, r * 0.15], 5, { rings: 2 }))
    } else {
      rig.add(B, CZ.SHELL2, loft([{ p: mix3(a, b, 0.1), w: r * 0.6, h: r * 0.96 }, { p: mix3(a, b, 0.95), w: r * 0.5, h: r * 0.9 }], 4, { arc: [PI - 0.6, PI + 0.6], up: UB }))
    }
  }
  // 头：肉质口盘 + 发光的咽 + 一圈内齿 + 三瓣巨颚（外面是甲，里面一排牙）
  const hp = (d, o = [0, 0, 0]) => [TOP[0] + DIR[0] * d + o[0], TOP[1] + DIR[1] * d + o[1], TOP[2] + DIR[2] * d + o[2]]
  rig.add('maw', CZ.FLESH, blob(hp(0.1), [1.0, 1.0, 0.7], 10, { rings: 3, dir: DIR, up: UB, noise: 0.05 }))
  rig.add('maw', CZ.GLOW, blob(hp(0.62), [0.56, 0.56, 0.34], 8, { rings: 2, dir: DIR, up: UB }))
  // 头部的局部坐标：F = DIR，Uh = 垂直于 DIR 朝后上，Rh = X
  const Uh = [0, 0.62, -0.78], Rh = [1, 0, 0]
  const ring = (ang, rad, d) => { const c = cos(ang), s = sin(ang); return hp(d, [(Uh[0] * c + Rh[0] * s) * rad, (Uh[1] * c + Rh[1] * s) * rad, (Uh[2] * c + Rh[2] * s) * rad]) }
  for (let k = 0; k < 9; k++) rig.add('maw', CZ.BONE, horn(ring(k * TAU / 9, 0.6, 0.6), ring(k * TAU / 9, 0.34, 1.2), 0.09))
  for (let k = 0; k < 3; k++) {
    const ang = k * TAU / 3 + PI, J = 'jaw' + k
    const pv = ring(ang, 0.85, 0.2)
    rig.bone(J, 'maw', ...pv)
    const out = [ring(ang, 1.0, 0.0), ring(ang, 1.55, 1.1), ring(ang, 1.3, 2.3)], tipP = ring(ang, 0.35, 3.5)
    const c = cos(ang), s = sin(ang), nrm = [Uh[0] * c + Rh[0] * s, Uh[1] * c + Rh[1] * s, Uh[2] * c + Rh[2] * s]
    rig.add(J, k % 2 ? CZ.SHELL : CZ.SHELL2, loft([{ p: out[0], w: 0.75, h: 0.3 }, { p: out[1], w: 0.8, h: 0.34, crest: 0.4 }, { p: out[2], w: 0.5, h: 0.26, crest: 0.4 }], 6, { arc: [-1.57, 1.57], up: nrm, cap1: 'tip', tipP1: tipP, sq: 2.2 }))
    rig.add(J, CZ.FLESH, loft([{ p: out[0], w: 0.7, h: 0.1 }, { p: out[1], w: 0.75, h: 0.12 }, { p: out[2], w: 0.46, h: 0.1 }], 4, { arc: [1.57, -1.57], up: nrm, cap1: 'tip', tipP1: tipP }))
    rig.add(J, CZ.BONE, horn(ring(ang, 1.25, 2.2), ring(ang, 0.15, 3.95), 0.3, { n: 4, segs: 3, bend: nrm.map((v) => v * 0.35), flatten: 0.6 }))
    for (let t = 0; t < 3; t++) for (const sd of [1, -1]) { const b0 = ring(ang + sd * 0.3, 1.25 + t * 0.06, 0.8 + t * 0.6); rig.add(J, CZ.BONE, horn(b0, ring(ang + sd * 0.2, 0.75, 1.0 + t * 0.6), 0.1)) }
    rig.add(J, CZ.BONE, horn(ring(ang, 1.85, 1.0), ring(ang, 2.5, 1.9), 0.16, { n: 4 }))
  }
  // 甲板破口：一圈掀起的碎板
  for (let k = 0; k < 11; k++) { const a = k * TAU / 11 + 0.2, r = 1.75 + (k % 3) * 0.22, h = 0.55 + (k % 2) * 0.45 + (k % 3) * 0.12; rig.add('root', k % 2 ? CZ.LIMB : CZ.SHELL2, horn([cos(a) * r, -0.05, sin(a) * r], [cos(a) * (r + 0.7), h, sin(a) * (r + 0.7)], 0.55, { n: 4, flat: true, flatten: 0.5, up: [-sin(a), 0, cos(a)] })) }
  const jaws = (P, open) => { for (let k = 0; k < 3; k++) { const ang = k * TAU / 3 + PI, c = cos(ang), s = sin(ang); const ax = [Uh[0] * s - Rh[0] * c, Uh[1] * s - Rh[1] * c, Uh[2] * s - Rh[2] * c]; P.r('jaw' + k, ax[0] * open, ax[1] * open, ax[2] * open) } }
  const sway = (u, P, amp, lean = 0) => { for (let i = 1; i < N; i++) P.r('s' + i, lean / N + 0.03 * amp * sin(u * TAU + i * 0.7), 0.02 * amp * sin(u * TAU + i * 0.5), 0.04 * amp * sin(u * TAU + i * 0.9 + 1)) }
  const sink = (P, k) => P.t('s0', 0, -k * (N * H + 5.5), 0)
  rig.clip('walk', 16, 2.4, true, (u, P) => { sway(u, P, 1); jaws(P, 0.06 + 0.1 * sin(u * TAU * 2)); P.r('maw', 0.06 * sin(u * TAU * 2), 0.1 * sin(u * TAU), 0) })
  rig.clip('attack', 12, 0.8, false, (u, P) => { const w = bump(u, 0, 0.5), f = bump(u, 0.4, 1); sway(u, P, 0.5, -0.55 * w + 1.0 * f); jaws(P, 0.2 + 0.65 * f + 0.15 * w); P.r('maw', -0.2 * w + 0.35 * f, 0, 0) })
  rig.clip('emerge', 10, 0.45, false, (u, P) => { const k = 1 - ease(u); sink(P, k); jaws(P, -0.28 * k + 0.75 * bump(u, 0.45, 1.3)); sway(u, P, 2 * (1 - k), -0.6 * k) })
  rig.clip('burrow', 8, 0.4, false, (u, P) => { const k = ease(u); sink(P, k); jaws(P, 0.2 - 0.48 * ramp(u, 0, 0.5)); sway(u, P, 1, -0.5 * k) })
  rig.clip('stun', 12, 1.6, true, (u, P) => { sway(u, P, 2.2, 0.95); jaws(P, 0.6 + 0.08 * sin(u * TAU * 2)); P.r('maw', 0.3, 0.2 * sin(u * TAU), 0) })
  rig.clip('die', 16, 1.6, false, (u, P) => { const k = ramp(u, 0.35, 1), sh = bump(u, 0, 0.5); sway(u * 3, P, 3 * sh, 1.55 * k - 0.5 * sh); jaws(P, 0.9 * sh + 0.35 * k); P.t('s0', 0, -2.0 * k * k, 0).r('s1', 0, 0, 0.12 * k).r('s3', 0, 0, 0.15 * k) })
  rig.meta = { muzzle: hp(2.0) }
  return rig
}
