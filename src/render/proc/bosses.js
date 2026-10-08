// proc/bosses.js —— 三只 Boss（原创造型，程序化）
//   ravager   「碾压者」  六足攻城兽：楔形撞角头 + 叠甲驼背，会冲锋
//   matriarch 「巢母」    臃肿的产卵女王：巨大的卵腹 + 高冠，停在远端
//   leviathan 「渊噬蠕虫」从地下竖起来的巨型环节蠕虫：四瓣口器
// 统一 clip：walk / attack / windup / charge / stun / die / emerge / burrow（没有的由资源表回落到 walk）
import { CZ } from '../materials.js'
import { Rig, V3, box, tube, ball, dome, gem, lathe, ring, chain, TAU, sin, cos, bump, ease } from './kit.js'

const PI = Math.PI
const SM = { smooth: true }

export function buildRavager() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.6, 0).bone('body', 'root', 0, 1.5, 0).bone('head', 'body', 0, 1.35, 1.5).bone('jawR', 'head', 0.5, 1.0, 2.3).bone('jawL', 'head', -0.5, 1.0, 2.3)
    .bone('abdo', 'body', 0, 1.5, -1.3).bone('tail', 'abdo', 0, 1.5, -2.6)
  // 胸：驼背 + 三层叠甲
  rig.add('body', CZ.FLESH, ball(1.25, 0.95, 1.7, 0, 1.4, 0, 12, 8))
  for (let i = 0; i < 4; i++) {
    const z = 1.0 - i * 0.78, r = 1.42 - Math.abs(i - 1.2) * 0.16
    rig.add('body', i % 2 ? CZ.SHELL : CZ.SHELL2, dome(r, 1.15 + (i === 1 ? 0.25 : 0) - i * 0.06, 0.72, 0, 1.45, z, 12, 5, { smooth: true, arc: 0.52, r: [-0.22, 0, 0] }))
    rig.add('body', CZ.BONE, tube(V3(0, 2.5 + (i === 1 ? 0.25 : 0) - i * 0.1, z - 0.15), V3(0, 3.25 + (i === 1 ? 0.3 : 0) - i * 0.16, z - 0.7), 0.17, 0, 5))
    for (const s of [1, -1]) {
      rig.add('body', CZ.BONE, tube(V3(s * r * 0.78, 2.1 - i * 0.05, z - 0.1), V3(s * (r + 0.35), 2.7 - i * 0.1, z - 0.55), 0.13, 0, 4))
      rig.add('body', CZ.GLOW, ball(0.1, 0.16, 0.2, s * r * 0.98, 1.5, z - 0.05, 6, 4))
    }
  }
  // 腹 + 锤尾
  rig.add('abdo', CZ.SHELL2, ball(1.0, 0.8, 1.2, 0, 1.35, -2.0, 10, 7, [0.15, 0, 0]))
  rig.add('abdo', CZ.GLOW, ring(0.98, 0.05, 12, 3, { axis: 'z', p: [0, 1.36, -1.7], smooth: true }), ring(0.85, 0.05, 12, 3, { axis: 'z', p: [0, 1.34, -2.4], smooth: true }))
  rig.add('tail', CZ.SHELL, chain([V3(0, 1.4, -2.9), V3(0, 1.7, -3.6), V3(0, 2.2, -4.0)], [0.4, 0.28, 0.2], 6, SM))
  rig.add('tail', CZ.BONE, ball(0.42, 0.36, 0.46, 0, 2.3, -4.1, 7, 5), tube(V3(0, 2.5, -4.1), V3(0, 3.0, -4.35), 0.14, 0, 4), tube(V3(0.3, 2.3, -4.2), V3(0.75, 2.4, -4.5), 0.12, 0, 4), tube(V3(-0.3, 2.3, -4.2), V3(-0.75, 2.4, -4.5), 0.12, 0, 4))
  // 头：楔形撞角（前低后高的厚骨板）+ 獠牙 + 六只眼
  rig.add('head', CZ.SHELL2, ball(0.95, 0.7, 0.9, 0, 1.3, 1.75, 10, 6))
  rig.add('head', CZ.SHELL, box(1.9, 0.5, 1.5, 0, 1.15, 2.5, { taper: [0.55, 0.3], shear: [0, -0.5] })).shade(0.8)
  rig.add('head', CZ.BONE, box(1.3, 0.26, 1.0, 0, 0.74, 2.9, { taper: [0.8, 0.5] }), box(2.0, 0.12, 0.3, 0, 0.92, 3.1, { taper: [0.9, 0.6] }))
  rig.add('head', CZ.BONE, tube(V3(0, 1.4, 2.4), V3(0, 2.05, 3.1), 0.24, 0.14, 5, SM), tube(V3(0, 2.05, 3.1), V3(0, 2.9, 3.3), 0.14, 0, 5, SM))
  for (const s of [1, -1]) {
    const J = s > 0 ? 'jawR' : 'jawL'
    rig.add(J, CZ.BONE, tube(V3(s * 0.55, 0.95, 2.3), V3(s * 1.15, 0.7, 3.2), 0.22, 0.15, 5, SM), tube(V3(s * 1.15, 0.7, 3.2), V3(s * 0.5, 0.55, 3.95), 0.15, 0, 5, SM))
    rig.add('head', CZ.GLOW, gem(0.11, s * 0.5, 1.62, 2.4, 1, 0.7, 1.5), gem(0.085, s * 0.72, 1.48, 2.2, 1, 0.7, 1.5), gem(0.07, s * 0.85, 1.32, 2.0))
    rig.add('head', CZ.BONE, tube(V3(s * 0.8, 1.6, 1.7), V3(s * 1.5, 2.2, 1.3), 0.16, 0, 4))
  }
  // 六条粗腿
  const legs = []
  const spec = [[1.55, 0.9, 1.35, 0], [0.2, 0.0, 1.6, PI], [-1.2, -0.9, 1.4, 0]]
  spec.forEach(([z, dz, reach, ph], i) => {
    for (const s of [1, -1]) {
      const n = `leg${i}${s > 0 ? 'R' : 'L'}`
      const hip = V3(s * 0.95, 1.25, z), knee = V3(s * (0.95 + reach * 0.55), 2.15, z + dz * 0.4), ankle = V3(s * (0.95 + reach), 0.55, z + dz), foot = V3(s * (1.0 + reach), 0.0, z + dz + 0.25)
      rig.bone(n, 'body', hip.x, hip.y, hip.z)
      rig.add(n, CZ.LIMB, tube(hip, knee, 0.34, 0.26, 6, SM), ball(0.3, 0.3, 0.3, knee.x, knee.y, knee.z, 6, 4))
      rig.add(n, CZ.SHELL, tube(knee, ankle, 0.28, 0.17, 6, SM))
      rig.add(n, CZ.BONE, tube(ankle, foot, 0.19, 0.0, 5, SM), tube(V3(knee.x, knee.y + 0.1, knee.z), V3(knee.x + s * 0.3, knee.y + 0.75, knee.z - 0.2), 0.14, 0, 4))
      legs.push({ n, s, ph: ph + (s > 0 ? 0 : PI) })
    }
  })
  const gait = (u, P, amp, sw = 0.3, lf = 0.24) => { for (const l of legs) { const t = u * TAU + l.ph; P.r(l.n, 0, -l.s * sw * cos(t) * amp, l.s * lf * Math.max(0, -sin(t)) * amp) } }
  rig.clip('walk', 16, 1.3, true, (u, P) => {
    gait(u, P, 1); const a = u * TAU
    P.t('body', 0, 0.06 * sin(a * 2), 0).r('body', 0.02 * sin(a * 2), 0.04 * sin(a), 0.03 * sin(a)).r('head', 0.06 * sin(a * 2 + 1), -0.06 * sin(a), 0).r('tail', 0, 0.25 * sin(a + 1), 0).r('abdo', 0, 0.06 * sin(a + 0.5), 0)
  })
  rig.clip('attack', 14, 0.9, false, (u, P) => {   // 横扫：抬头 → 甩向一侧 → 甩回
    const w = bump(u, 0, 0.4), f = u < 0.3 ? 0 : sin(((u - 0.3) / 0.7) * TAU)
    P.r('head', -0.4 * w, 0.75 * f, 0.2 * f).r('body', -0.12 * w, 0.3 * f, 0).t('body', 0, 0.2 * w, 0.4 * bump(u, 0.3, 1)).r('jawR', 0, -0.5 * w, 0).r('jawL', 0, 0.5 * w, 0).r('tail', 0, -0.6 * f, 0)
    gait(u * 0.5, P, 0.5)
  })
  rig.clip('windup', 10, 0.6, true, (u, P) => {   // 冲锋蓄力：压低头、后坐、刨地
    const a = u * TAU
    P.r('body', 0.2, 0, 0).t('body', 0, -0.25, -0.5 + 0.08 * sin(a * 2)).r('head', 0.35 + 0.05 * sin(a * 2), 0, 0).r('jawR', 0, -0.3, 0).r('jawL', 0, 0.3, 0).r('tail', -0.4, 0.3 * sin(a), 0)
    P.r('leg0R', 0, 0, 0.5 * Math.max(0, sin(a))).r('leg0L', 0, 0, -0.5 * Math.max(0, -sin(a)))
  })
  rig.clip('charge', 8, 0.32, true, (u, P) => { gait(u, P, 1.5, 0.5, 0.4); P.r('body', 0.16, 0, 0).t('body', 0, -0.15 + 0.1 * sin(u * TAU * 2), 0.3).r('head', 0.4, 0, 0).r('tail', -0.5, 0, 0) })
  rig.clip('stun', 12, 1.6, true, (u, P) => { const a = u * TAU; P.t('body', 0, -0.4, 0).r('body', 0.1, 0, 0.1 * sin(a)).r('head', 0.55, 0.3 * sin(a), 0.2 * sin(a + 1)).r('tail', 0.3, 0.1 * sin(a), 0); for (const l of legs) P.r(l.n, 0, 0, -l.s * 0.22) })
  rig.clip('die', 16, 1.6, false, (u, P) => {
    const k = ease(u), sh = bump(u, 0, 0.5)
    P.t('body', 0, 0.3 * sh - 0.95 * k, 0).r('body', -0.3 * sh + 0.15 * k, 0, 0.28 * k).r('head', -0.6 * sh + 0.7 * k, 0.3 * k, 0).r('jawR', 0, -0.7 * sh, 0).r('jawL', 0, 0.7 * sh, 0).r('tail', 0.6 * k, 0.4 * k, 0)
    for (const l of legs) P.r(l.n, 0, 0, -l.s * 0.5 * k + l.s * 0.3 * sh)
  })
  return rig
}

export function buildMatriarch() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0.6, 0).bone('body', 'root', 0, 2.0, 0.8).bone('head', 'body', 0, 2.6, 1.6).bone('abdo', 'body', 0, 1.9, -0.2)
  // 巨大的卵腹：半透明感的肉囊 + 里面一颗颗发光的卵
  rig.add('abdo', CZ.FLESH, ball(1.9, 1.6, 2.5, 0, 1.75, -2.0, 14, 9, [0.12, 0, 0]))
  for (let i = 0; i < 4; i++) rig.add('abdo', CZ.SHELL2, ring(1.9 * Math.sqrt(Math.max(0.05, 1 - Math.pow((i - 1.5) / 2.3, 2))), 0.12, 14, 4, { axis: 'z', p: [0, 1.75 - (i - 1.5) * 0.1, -2.0 + (i - 1.5) * 1.15], smooth: true }))
  const eggs = [[1.35, 2.35, -1.2], [-1.4, 2.2, -1.9], [1.5, 1.9, -2.6], [-1.2, 2.6, -2.8], [0.2, 3.2, -1.7], [0.0, 3.05, -2.8], [1.7, 1.4, -1.6], [-1.75, 1.35, -2.4], [0.9, 2.9, -3.4], [-0.8, 2.2, -4.1]]
  for (const e of eggs) rig.add('abdo', CZ.GLOW2, ball(0.36, 0.42, 0.36, e[0], e[1], e[2], 7, 5))
  rig.add('abdo', CZ.LIMB, chain([V3(0, 1.4, -4.2), V3(0, 1.0, -4.9), V3(0, 0.5, -5.2)], [0.5, 0.32, 0.12], 6, SM))
  // 胸 + 高冠头
  rig.add('body', CZ.SHELL, ball(1.0, 0.95, 1.1, 0, 2.1, 0.7, 10, 7, [-0.3, 0, 0]))
  rig.add('body', CZ.SHELL2, dome(1.1, 0.8, 1.0, 0, 2.4, 0.5, 10, 4, { smooth: true, r: [-0.35, 0, 0] }))
  rig.add('head', CZ.LIMB, ball(0.6, 0.55, 0.7, 0, 2.7, 1.75, 9, 6, [0.3, 0, 0]))
  for (const s of [1, -1]) {
    rig.add('head', CZ.GLOW, gem(0.1, s * 0.3, 2.95, 2.25, 1, 0.8, 1.4), gem(0.08, s * 0.45, 2.8, 2.1), gem(0.06, s * 0.5, 2.62, 1.95))
    rig.add('head', CZ.BONE, tube(V3(s * 0.25, 2.35, 2.25), V3(s * 0.4, 1.95, 2.75), 0.1, 0, 4), tube(V3(s * 0.4, 3.05, 1.5), V3(s * 1.0, 3.9, 1.1), 0.17, 0.11, 5, SM), tube(V3(s * 1.0, 3.9, 1.1), V3(s * 0.75, 4.9, 1.4), 0.11, 0, 5, SM))
  }
  rig.add('head', CZ.BONE, tube(V3(0, 3.1, 1.6), V3(0, 4.2, 1.0), 0.2, 0.12, 5, SM), tube(V3(0, 4.2, 1.0), V3(0, 5.3, 1.35), 0.12, 0, 5, SM))
  rig.add('head', CZ.GLOW2, ball(0.22, 0.26, 0.22, 0, 2.35, 2.2, 6, 5))   // 酸囊
  // 八条细长的腿撑着
  const legs = []
  const spec = [[1.4, 1.0, 2.6, 0], [0.5, 0.2, 3.0, PI], [-0.6, -0.5, 3.0, 0], [-1.7, -1.2, 2.7, PI]]
  spec.forEach(([z, dz, reach, ph], i) => {
    for (const s of [1, -1]) {
      const n = `leg${i}${s > 0 ? 'R' : 'L'}`
      const hip = V3(s * 0.8, 1.9, z), knee = V3(s * (0.8 + reach * 0.5), 3.4, z + dz * 0.4), foot = V3(s * (0.8 + reach), 0.0, z + dz)
      rig.bone(n, 'body', hip.x, hip.y, hip.z)
      rig.add(n, CZ.LIMB, tube(hip, knee, 0.2, 0.13, 5, SM))
      rig.add(n, CZ.BONE, tube(knee, foot, 0.13, 0.0, 5, SM))
      legs.push({ n, s, ph: ph + (s > 0 ? 0 : PI) })
    }
  })
  const gait = (u, P, amp) => { for (const l of legs) { const t = u * TAU + l.ph; P.r(l.n, 0, -l.s * 0.2 * cos(t) * amp, l.s * 0.14 * Math.max(0, -sin(t)) * amp) } }
  rig.clip('walk', 16, 1.8, true, (u, P) => { gait(u, P, 1); const a = u * TAU; P.t('body', 0, 0.06 * sin(a * 2), 0).s('abdo', 1 + 0.025 * sin(a * 2)).r('abdo', 0, 0.04 * sin(a), 0).r('head', 0.05 * sin(a * 2), 0.1 * sin(a), 0) })
  rig.clip('attack', 12, 0.5, false, (u, P) => { const w = bump(u, 0, 0.6), f = bump(u, 0.5, 1); P.r('head', -0.55 * w + 0.5 * f, 0, 0).r('body', -0.18 * w + 0.1 * f, 0, 0).s('abdo', 1 + 0.08 * w - 0.05 * f).t('head', 0, 0, 0.3 * f) })
  rig.clip('stun', 10, 1.6, true, (u, P) => { const a = u * TAU; P.t('body', 0, -0.4, 0).r('head', 0.5, 0.2 * sin(a), 0).s('abdo', 1 + 0.02 * sin(a * 2)) })
  rig.clip('die', 16, 1.6, false, (u, P) => { const k = ease(u), sh = bump(u, 0, 0.5); P.t('body', 0, -1.0 * k + 0.2 * sh, 0).r('body', 0.2 * k, 0, 0.18 * k).r('head', -0.5 * sh + 0.8 * k, 0, 0).s('abdo', 1 + 0.2 * sh - 0.32 * k, 1 + 0.2 * sh - 0.5 * k, 1 + 0.1 * sh); for (const l of legs) P.r(l.n, 0, 0, -l.s * 0.45 * k) })
  return rig
}

export function buildLeviathan() {
  const rig = new Rig()
  // 一串竖直的环节，越往上越往前探
  const N = 7, segH = 0.95
  rig.bone('root', null, 0, 0, 0)
  let prev = 'root'
  const pts = []
  for (let i = 0; i < N; i++) { const y = i * segH, z = Math.pow(i / (N - 1), 2.2) * 1.6; pts.push(V3(0, y, z)); rig.bone('s' + i, prev, 0, y, z); prev = 's' + i }
  rig.bone('maw', prev, 0, N * segH - 0.2, 1.75)
  for (let k = 0; k < 4; k++) rig.bone('jaw' + k, 'maw', cos(k * PI / 2 + PI / 4) * 0.7, N * segH + 0.1, 1.9 + sin(k * PI / 2 + PI / 4) * 0.0)
  for (let i = 0; i < N; i++) {
    const p = pts[i], r = 1.55 - i * 0.09
    rig.add('s' + i, i % 2 ? CZ.SHELL : CZ.SHELL2, lathe([[r * 0.86, 0], [r, segH * 0.3], [r * 0.96, segH * 0.75], [r * 0.8, segH * 1.05]], 12, { smooth: true, p: [p.x, p.y, p.z] }))
    rig.add('s' + i, CZ.GLOW, ring(r * 0.84, 0.07, 12, 3, { p: [p.x, p.y + 0.02, p.z], smooth: true }))
    for (let k = 0; k < 4; k++) { const a = k * PI / 2 + (i % 2) * PI / 4, cx = cos(a), sz = sin(a); rig.add('s' + i, CZ.BONE, tube(V3(p.x + cx * r * 0.95, p.y + segH * 0.35, p.z + sz * r * 0.95), V3(p.x + cx * (r + 0.6), p.y + segH * 0.9, p.z + sz * (r + 0.6)), 0.15, 0, 4)) }
  }
  const top = N * segH, mz = 1.75
  rig.add('maw', CZ.FLESH, ball(0.95, 0.6, 0.95, 0, top - 0.1, mz, 10, 6))
  rig.add('maw', CZ.GLOW, ball(0.55, 0.3, 0.55, 0, top + 0.2, mz, 8, 5))
  for (let k = 0; k < 8; k++) { const a = k * PI / 4; rig.add('maw', CZ.BONE, tube(V3(cos(a) * 0.62, top + 0.2, mz + sin(a) * 0.62), V3(cos(a) * 0.4, top + 0.75, mz + sin(a) * 0.4), 0.08, 0, 3)) }
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2 + PI / 4, cx = cos(a), sz = sin(a)
    rig.bones.find((b) => b.name === 'jaw' + k).pivot = [cx * 0.8, top + 0.05, mz + sz * 0.8]
    rig.add('jaw' + k, CZ.SHELL2, tube(V3(cx * 0.8, top, mz + sz * 0.8), V3(cx * 1.45, top + 1.0, mz + sz * 1.45), 0.42, 0.3, 5, SM))
    rig.add('jaw' + k, CZ.BONE, tube(V3(cx * 1.45, top + 1.0, mz + sz * 1.45), V3(cx * 0.7, top + 2.3, mz + sz * 0.7), 0.3, 0, 5, SM), tube(V3(cx * 1.3, top + 0.8, mz + sz * 1.3), V3(cx * 0.75, top + 1.1, mz + sz * 0.75), 0.1, 0, 3))
  }
  // 地面破口的碎块环
  for (let k = 0; k < 9; k++) { const a = k * TAU / 9 + 0.2, r = 1.9 + (k % 3) * 0.2; rig.add('root', CZ.LIMB, box(0.7, 0.35 + (k % 2) * 0.25, 0.5, cos(a) * r, 0.1, sin(a) * r, { r: [0.3 * sin(a), -a, 0.5], taper: [0.6, 0.7] })) }
  const jaws = (P, open) => { for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; P.r('jaw' + k, sin(a) * open, 0, -cos(a) * open) } }
  const sway = (u, P, amp, lean = 0) => { for (let i = 1; i < N; i++) P.r('s' + i, lean / N + 0.035 * amp * sin(u * TAU + i * 0.7), 0, 0.045 * amp * sin(u * TAU + i * 0.9 + 1)) }
  const sink = (P, k) => { for (let i = 0; i < N; i++) P.t('s' + i, 0, i === 0 ? -k * (N * segH + 3.2) : 0, 0) }
  rig.clip('walk', 16, 2.4, true, (u, P) => { sway(u, P, 1); jaws(P, 0.12 + 0.1 * sin(u * TAU * 2)) })
  rig.clip('attack', 12, 0.8, false, (u, P) => { const w = bump(u, 0, 0.5), f = bump(u, 0.4, 1); sway(u, P, 0.5, -0.5 * w + 1.1 * f); jaws(P, 0.75 * w + 0.2) })
  rig.clip('emerge', 10, 0.45, false, (u, P) => { const k = 1 - ease(u); sink(P, k); jaws(P, 0.8 * (1 - k) * bump(u, 0.3, 1) + 0.1); sway(u, P, 2 * (1 - k)) })
  rig.clip('burrow', 8, 0.4, false, (u, P) => { const k = ease(u); sink(P, k); jaws(P, -0.1) })
  rig.clip('stun', 12, 1.6, true, (u, P) => { sway(u, P, 2, 0.9); jaws(P, 0.5) })
  rig.clip('die', 16, 1.6, false, (u, P) => { const k = ease(u), sh = bump(u, 0, 0.45); sway(u * 3, P, 3 * sh, 1.5 * k - 0.4 * sh); jaws(P, 0.9 * sh + 0.4 * k); P.t('s0', 0, -2.2 * k * k, 0) })
  return rig
}
