// proc/troops.js —— 第七远征军：程序化建模（原创造型，零外部素材）
// 主机位下单位只有 30~60 像素高，而且镜头看到的是背面和顶面：所以把预算花在
// 「宽肩甲 + 背包 + 头盔陷在领口里 + 枪伸出去」的剪影、队色分区和自发光条上，不追面数。
import { AZ } from '../materials.js'
import { Rig, V3, box, prism, tube, ball, dome, gem, lathe, quad, ring, group, TAU, sin, cos, bump, ease } from './kit.js'

const PI = Math.PI

// ------------------------------------------------------------------ 动力装甲步兵
/**
 * o: { weapon: 'rifle'|'flamer'|'cannon', pack: 'reactor'|'tanks', accent: zone(肩甲), crest: bool(英雄饰边), banner: bool, bulk: 1 }
 * 静止身高约 1.36（放大由资源表的 scale 决定）
 */
export function buildTrooper(o = {}) {
  const rig = new Rig()
  const accent = o.accent ?? AZ.TEAM, bulk = o.bulk ?? 1
  rig.bone('root', null, 0, 0, 0).bone('hips', 'root', 0, 0.8, 0).bone('torso', 'hips', 0, 0.9, 0).bone('head', 'torso', 0, 1.2, 0)
    .bone('gun', 'torso', 0.2, 0.9, 0.2)
    .bone('legR', 'hips', 0.21, 0.8, 0).bone('shinR', 'legR', 0.22, 0.46, 0.03)
    .bone('legL', 'hips', -0.21, 0.8, 0).bone('shinL', 'legL', -0.22, 0.46, 0.03)

  // 腿：大靴子 + 粗护胫 + 护膝 + 大腿甲（两腿分开站，才有「重」的感觉）
  rig.both('shinR', 'shinL', AZ.GUN,
    box(0.27, 0.17, 0.42, 0.22, 0.085, 0.05, { taper: [0.84, 0.78] }),
    prism(6, 0.13, 0.165, 0.36, 0.22, 0.13, 0.0))
  rig.both('shinR', 'shinL', AZ.PLATE, box(0.2, 0.15, 0.12, 0.22, 0.47, 0.13, { taper: [0.8, 0.7] }), box(0.24, 0.07, 0.14, 0.22, 0.2, 0.14))
  rig.both('legR', 'legL', AZ.GUN, prism(6, 0.15, 0.17, 0.34, 0.21, 0.46, 0.0))
  rig.both('legR', 'legL', AZ.PLATE, box(0.2, 0.24, 0.07, 0.25, 0.64, 0.14, { taper: [0.85, 1] }), box(0.07, 0.26, 0.24, 0.37, 0.64, 0.0, { taper: [1, 0.8] }))
  // 骨盆 + 腰甲
  rig.add('hips', AZ.DARK, box(0.44, 0.18, 0.28, 0, 0.8, 0))
  rig.add('hips', AZ.PLATE, box(0.18, 0.22, 0.09, 0, 0.76, 0.16, { taper: [0.7, 1] }), box(0.52, 0.09, 0.32, 0, 0.9, 0))
  // 躯干：倒梯形胸甲，上宽下窄
  rig.add('torso', AZ.GUN, box(0.42 * bulk, 0.36, 0.32, 0, 1.06, 0, { taper: [1.5, 1.3] }))
  rig.add('torso', AZ.PLATE, box(0.46 * bulk, 0.2, 0.1, 0, 1.12, 0.18, { taper: [1.15, 0.8], shear: [0, -0.03] }))   // 胸板
  rig.add('torso', AZ.CYAN, box(0.12, 0.035, 0.02, 0, 1.13, 0.235))                                                  // 胸口指示灯
  rig.add('torso', AZ.DARK, prism(8, 0.18, 0.2, 0.07, 0, 1.2, 0))                                                    // 领口
  // 背包
  if (o.pack === 'tanks') {
    rig.add('torso', AZ.PAINT, lathe([[0.0, 0], [0.12, 0.02], [0.125, 0.46], [0.07, 0.54], [0.0, 0.55]], 8, { p: [0.14, 0.84, -0.28] }), lathe([[0.0, 0], [0.12, 0.02], [0.125, 0.46], [0.07, 0.54], [0.0, 0.55]], 8, { p: [-0.14, 0.84, -0.28] }))
    rig.add('torso', AZ.GUN, box(0.34, 0.08, 0.1, 0, 1.0, -0.27), box(0.34, 0.06, 0.1, 0, 1.22, -0.27))
    rig.add('torso', AZ.ORANGE, box(0.05, 0.05, 0.03, 0, 1.12, -0.41), gem(0.035, 0.14, 1.42, -0.28), gem(0.035, -0.14, 1.42, -0.28))
    rig.add('torso', AZ.DARK, tube(V3(0.2, 0.9, -0.2), V3(0.34, 0.74, 0.1), 0.03, 0.03, 5))
  } else {
    // 反应堆背包：比躯干窄、比肩低，两侧斜出的排气管，背面两道散热条
    rig.add('torso', AZ.GUN, box(0.4, 0.36, 0.2, 0, 1.06, -0.26, { taper: [0.85, 0.8] }))
    rig.add('torso', AZ.PLATE, box(0.26, 0.24, 0.05, 0, 1.07, -0.375), tube(V3(0.17, 1.14, -0.3), V3(0.27, 1.4, -0.36), 0.055, 0.045, 6), tube(V3(-0.17, 1.14, -0.3), V3(-0.27, 1.4, -0.36), 0.055, 0.045, 6))
    rig.add('torso', AZ.CYAN, box(0.18, 0.045, 0.02, 0, 1.13, -0.405), box(0.18, 0.045, 0.02, 0, 1.02, -0.405), gem(0.032, 0.275, 1.42, -0.365), gem(0.032, -0.275, 1.42, -0.365))
  }
  // 头盔：小而低，陷在肩甲之间
  rig.add('head', AZ.GUN, dome(0.14, 0.155, 0.155, 0, 1.24, 0.01, 8, 3), prism(8, 0.145, 0.14, 0.06, 0, 1.19, 0.01))
  rig.add('head', AZ.PLATE, box(0.06, 0.05, 0.26, 0, 1.385, 0.0, { taper: [0.6, 0.7] }))   // 盔顶的脊
  rig.add('head', AZ.CYAN, box(0.2, 0.05, 0.07, 0, 1.27, 0.12))   // 目镜
  if (o.pack === 'tanks') rig.add('head', AZ.DARK, prism(6, 0.05, 0.04, 0.09, 0, 1.22, 0.13, { r: [PI / 2, 0, 0] }))   // 呼吸器
  if (o.crest) rig.add('head', AZ.GOLD, box(0.04, 0.12, 0.26, 0, 1.43, -0.02, { taper: [1, 0.6] }))
  // 肩甲：整个剪影里最重要的一块。上层大弧甲 + 下层护臂板，向外倾
  rig.both('torso', 'torso', accent,
    dome(0.22 * bulk, 0.2, 0.25, 0.43, 1.1, 0, 8, 3, { r: [0, 0, -0.28] }),
    box(0.22 * bulk, 0.16, 0.34, 0.5, 1.02, 0, { taper: [1.15, 1.1], r: [0, 0, -0.28] }))
  rig.both('torso', 'torso', o.crest ? AZ.GOLD : AZ.PLATE, box(0.05, 0.1, 0.36, 0.63, 1.0, 0, { r: [0, 0, -0.28] }), box(0.2 * bulk, 0.04, 0.06, 0.4, 1.29, 0, { r: [0, 0, -0.28] }))
  // 手臂：右手握把，左手托护木
  rig.add('torso', AZ.DARK, tube(V3(0.42, 1.06, 0), V3(0.42, 0.86, 0.06), 0.095, 0.09, 6), tube(V3(-0.42, 1.06, 0), V3(-0.38, 0.86, 0.1), 0.095, 0.09, 6))
  rig.add('gun', AZ.GUN, tube(V3(0.42, 0.86, 0.06), V3(0.26, 0.84, 0.3), 0.11, 0.12, 6), tube(V3(-0.38, 0.86, 0.1), V3(0.12, 0.8, 0.52), 0.11, 0.115, 6))

  // 武器
  let muzzle
  if (o.weapon === 'flamer') {
    rig.add('gun', AZ.GUN, box(0.14, 0.18, 0.5, 0.2, 0.84, 0.4), prism(8, 0.07, 0.07, 0.34, 0.2, 0.86, 0.62, { r: [PI / 2, 0, 0] }))
    rig.add('gun', AZ.PLATE, prism(8, 0.085, 0.12, 0.16, 0.2, 0.86, 0.92, { r: [PI / 2, 0, 0] }), box(0.08, 0.1, 0.2, 0.2, 0.72, 0.4))
    rig.add('gun', AZ.PAINT, lathe([[0.0, 0], [0.075, 0.02], [0.075, 0.26], [0.0, 0.28]], 7, { axis: 'z', p: [0.2, 0.98, 0.3] }))
    rig.add('gun', AZ.ORANGE, gem(0.04, 0.2, 0.8, 1.06), box(0.03, 0.03, 0.12, 0.2, 0.95, 0.66))
    muzzle = [0.2, 0.86, 1.1]
  } else if (o.weapon === 'cannon') {   // 英雄的重型轨道步枪
    rig.add('gun', AZ.GUN, box(0.15, 0.2, 0.7, 0.2, 0.85, 0.42), box(0.09, 0.14, 0.2, 0.2, 0.72, 0.3))
    rig.add('gun', AZ.PLATE, box(0.05, 0.1, 0.78, 0.26, 0.86, 1.1), box(0.05, 0.1, 0.78, 0.14, 0.86, 1.1), box(0.2, 0.08, 0.2, 0.2, 0.98, 0.4))
    rig.add('gun', AZ.CYAN, box(0.05, 0.04, 0.72, 0.2, 0.86, 1.08), box(0.03, 0.07, 0.3, 0.29, 0.86, 0.45))
    rig.add('gun', AZ.GOLD, box(0.17, 0.05, 0.08, 0.2, 0.86, 1.5), box(0.17, 0.05, 0.08, 0.2, 0.86, 0.78))
    muzzle = [0.2, 0.86, 1.52]
  } else {
    rig.add('gun', AZ.DARK, box(0.14, 0.2, 0.62, 0.2, 0.85, 0.44), box(0.08, 0.2, 0.12, 0.2, 0.69, 0.42, { shear: [0, 0.04] }), box(0.1, 0.13, 0.22, 0.2, 0.86, 0.06))
    rig.add('gun', AZ.PLATE, box(0.16, 0.07, 0.4, 0.2, 0.975, 0.46), prism(6, 0.055, 0.055, 0.3, 0.2, 0.88, 0.74, { r: [PI / 2, 0, 0] }), prism(6, 0.075, 0.075, 0.12, 0.2, 0.88, 1.0, { r: [PI / 2, 0, 0] }), box(0.06, 0.06, 0.3, 0.2, 0.78, 0.8))
    rig.add('gun', AZ.ORANGE, box(0.03, 0.05, 0.16, 0.28, 0.86, 0.5))   // 弹量灯
    muzzle = [0.2, 0.88, 1.13]
  }
  if (o.banner) {   // 英雄背旗：一眼认出指挥官
    rig.add('torso', AZ.GUN, tube(V3(-0.2, 1.2, -0.34), V3(-0.2, 2.15, -0.4), 0.025, 0.02, 5))
    rig.add('torso', AZ.TEAM, quad(V3(-0.2, 2.1, -0.4), V3(-0.2, 1.62, -0.39), V3(-0.2, 1.68, -0.78), V3(-0.2, 2.1, -0.84)))
    rig.add('torso', AZ.GOLD, gem(0.05, -0.2, 2.2, -0.4), box(0.02, 0.05, 0.44, -0.2, 2.11, -0.62))
    rig.add('torso', AZ.TEAM, quad(V3(-0.2, 1.0, -0.38), V3(0.2, 1.0, -0.38), V3(0.24, 0.5, -0.5), V3(-0.24, 0.5, -0.5)))   // 短披风
  }

  rig.clip('idle', 8, 2.2, true, (u, P) => {
    const s = sin(u * TAU)
    P.t('torso', 0, 0.008 * s, 0).r('torso', 0.015 * s, 0, 0).r('gun', -0.02 * s, 0, 0).r('head', 0, 0.12 * sin(u * TAU + 1), 0)
  })
  rig.clip('shoot', 6, 0.13, true, (u, P) => {
    const k = (1 - u) * (1 - u)
    P.t('gun', 0, 0.01 * k, -0.06 * k).r('gun', -0.05 * k, 0, 0).r('torso', -0.035 * k, 0, 0).t('torso', 0, 0, -0.012 * k).r('hips', -0.01 * k, 0, 0)
  })
  rig.clip('walk', 10, 0.62, true, (u, P) => {
    const a = u * TAU, s = sin(a), c = cos(a)
    P.r('legR', -0.5 * s, 0, 0).r('legL', 0.5 * s, 0, 0)
    P.r('shinR', 0.5 * Math.max(0, c) + 0.1, 0, 0).r('shinL', 0.5 * Math.max(0, -c) + 0.1, 0, 0)
    P.t('hips', 0, 0.025 * Math.abs(c) - 0.015, 0).r('torso', 0.05, 0.06 * s, 0).r('gun', 0.04 * c, 0, 0)
  })
  rig.clip('die', 10, 0.9, false, (u, P) => {
    const k = ease(u), hit = bump(u, 0, 0.35)
    P.r('root', -1.45 * k - 0.2 * hit, 0.5 * k, 0).t('root', 0, 0.12 * k + 0.1 * hit, -0.35 * k)
    P.r('legR', 0.7 * k, 0, 0.2 * k).r('legL', 0.3 * k, 0, -0.25 * k).r('shinR', 0.8 * k, 0, 0).r('gun', 0.9 * k, 0.6 * k, 0).t('gun', 0.1 * k, -0.1 * k, 0).r('head', -0.3 * k, 0, 0)
  })
  rig.meta = { muzzle }
  return rig
}

// ------------------------------------------------------------------ 灵能者（悬浮，长袍 + 光环）
export function buildPsion(o = {}) {
  const rig = new Rig()
  const trim = o.crest ? AZ.GOLD : AZ.PLATE
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 1.0, 0).bone('head', 'body', 0, 1.5, 0).bone('halo', 'body', 0, 1.6, -0.18)
    .bone('orbit', 'root', 0, 1.15, 0).bone('armR', 'body', 0.26, 1.34, 0).bone('armL', 'body', -0.26, 1.34, 0)
  rig.add('body', AZ.DARK, prism(8, 0.34, 0.17, 0.85, 0, 0.28, 0, { sz: 0.85 }))                     // 袍
  rig.add('body', AZ.TEAM, box(0.12, 0.8, 0.02, 0, 0.72, 0.27, { taper: [0.5, 1], r: [-0.18, 0, 0] }), box(0.12, 0.8, 0.02, 0, 0.72, -0.27, { taper: [0.5, 1], r: [0.18, 0, 0] }))
  rig.add('body', AZ.GUN, box(0.36, 0.36, 0.24, 0, 1.28, 0, { taper: [1.35, 1.1] }))
  rig.add('body', trim, box(0.3, 0.16, 0.06, 0, 1.34, 0.14, { taper: [1.2, 1] }), prism(8, 0.13, 0.15, 0.06, 0, 1.45, 0))
  rig.add('body', AZ.CYAN, gem(0.055, 0, 1.3, 0.18, 1, 1.4, 0.6))
  rig.both('body', 'body', trim, dome(0.15, 0.1, 0.17, 0.3, 1.42, 0, 7, 3), box(0.06, 0.04, 0.3, 0.4, 1.41, 0))
  rig.add('head', AZ.PLATE, dome(0.12, 0.17, 0.14, 0, 1.52, 0, 8, 3), prism(8, 0.125, 0.12, 0.06, 0, 1.47, 0))
  rig.add('head', AZ.CYAN, box(0.04, 0.1, 0.05, 0, 1.56, 0.11), box(0.16, 0.03, 0.04, 0, 1.55, 0.11))
  rig.add('halo', AZ.CYAN, ring(0.34, 0.022, 14, 4, { axis: 'z', p: [0, 1.62, -0.18] }))
  rig.add('halo', trim, ring(0.26, 0.015, 12, 4, { axis: 'z', p: [0, 1.62, -0.19] }))
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + 0.4; rig.add('halo', AZ.CYAN, gem(0.035, cos(a) * 0.34, 1.62 + sin(a) * 0.34, -0.18, 0.7, 1.6, 0.7)) }
  rig.both('armR', 'armL', AZ.DARK, tube(V3(0.28, 1.36, 0), V3(0.46, 1.12, 0.12), 0.06, 0.05, 5), tube(V3(0.46, 1.12, 0.12), V3(0.5, 1.2, 0.36), 0.055, 0.06, 5))
  rig.both('armR', 'armL', AZ.CYAN, gem(0.06, 0.5, 1.24, 0.44))
  for (let k = 0; k < 3; k++) { const a = k * TAU / 3; rig.add('orbit', AZ.CYAN, gem(0.075, cos(a) * 0.62, 1.15 + (k - 1) * 0.16, sin(a) * 0.62, 0.7, 1.7, 0.7)); rig.add('orbit', trim, gem(0.03, cos(a) * 0.62, 1.0 + (k - 1) * 0.16, sin(a) * 0.62)) }
  rig.add('root', AZ.CYAN, ring(0.3, 0.015, 12, 3, { p: [0, 0.06, 0] }))   // 脚下的悬浮环

  const hover = (u, P, amp = 1) => { P.t('body', 0, 0.05 * sin(u * TAU) * amp, 0).r('orbit', 0, u * TAU, 0).r('halo', 0, 0, u * TAU * 0.5) }
  rig.clip('idle', 16, 3.0, true, (u, P) => hover(u, P))
  rig.clip('walk', 16, 3.0, true, (u, P) => { hover(u, P); P.r('body', 0.12, 0, 0) })
  rig.clip('shoot', 10, 0.9, false, (u, P) => {
    const k = bump(u, 0, 1)
    P.t('body', 0, 0.16 * k, 0).r('armR', -1.5 * k, 0, 0.3 * k).r('armL', -1.5 * k, 0, -0.3 * k).s('halo', 1 + 0.5 * k).r('orbit', 0, u * TAU * 0.6, 0).s('orbit', 1 + 0.35 * k).r('head', -0.25 * k, 0, 0)
  })
  rig.clip('die', 10, 1.0, false, (u, P) => { const k = ease(u); P.t('body', 0, -0.75 * k, 0).r('root', 1.2 * k, 0, 0.4 * k).s('halo', 1 - 0.95 * k).s('orbit', 1 - 0.95 * k) })
  rig.meta = { muzzle: [0, 1.5, 0.4] }
  return rig
}

// ------------------------------------------------------------------ 履带底盘（自行炮 / 轨道炮共用）
function trackedHull(rig, L, W, o = {}) {
  const hw = W / 2, tw = 0.44
  for (const s of [1, -1]) {
    const x = s * (hw - tw / 2)
    rig.add('hull', AZ.DARK, box(tw, 0.5, L, x, 0.29, 0, { taper: [1, 0.86] }), box(tw * 0.96, 0.2, L * 0.92, x, 0.1, 0))
    for (let i = 0; i < 5; i++) rig.add('hull', AZ.GUN, prism(8, 0.17, 0.17, 0.05, x + s * (tw / 2 - 0.01), 0.24, -L * 0.38 + i * L * 0.19, { r: [0, 0, -s * PI / 2] }))
    rig.add('hull', AZ.PLATE, box(tw + 0.1, 0.07, L * 0.98, x, 0.57, 0), box(0.05, 0.24, L * 0.7, s * (hw + 0.04), 0.44, 0.05))   // 挡泥板 + 侧裙
    rig.add('hull', AZ.TEAM, box(0.055, 0.12, L * 0.3, s * (hw + 0.045), 0.46, L * 0.12))
    rig.add('hull', AZ.CYAN, box(0.1, 0.05, 0.03, x, 0.5, L / 2 + 0.01))   // 车头灯
    rig.add('hull', AZ.ORANGE, box(0.08, 0.04, 0.03, x, 0.5, -L / 2 - 0.01))
  }
  rig.add('hull', AZ.GUN, box(W - tw * 2 + 0.1, 0.42, L * 0.94, 0, 0.5, 0), box(W - tw * 2 + 0.1, 0.3, 0.5, 0, 0.52, L * 0.44, { taper: [1, 0.3], shear: [0, -0.12] }))
  if (!o.noDeck) rig.add('hull', AZ.PLATE, box(W - tw * 2 - 0.06, 0.06, L * 0.5, 0, 0.74, L * 0.18))
}
function vehicleClips(rig, o) {
  rig.clip('idle', 4, 0.4, true, (u, P) => { P.t('hull', 0, 0.004 * sin(u * TAU), 0) })
  rig.clip('walk', 4, 0.3, true, (u, P) => { P.t('hull', 0, 0.01 * sin(u * TAU), 0).r('hull', 0.006 * sin(u * TAU * 2), 0, 0) })
  rig.clip('shoot', o.frames || 10, o.dur || 0.6, false, (u, P) => {
    const k = u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 2)
    P.t('gun', 0, -o.recoil * o.dy * k, -o.recoil * o.dz * k).r('hull', -0.03 * k * (o.rock ?? 1), 0, 0).t('hull', 0, 0, -0.05 * k * (o.rock ?? 1))
  })
  rig.clip('die', 8, 0.9, false, (u, P) => { const k = ease(u); P.r('hull', 0.12 * k, 0.2 * k, 0.16 * k).t('hull', 0, -0.12 * k, 0).r('gun', 0.35 * k, 0, 0) })
}

// ------------------------------------------------------------------ 「雷锤」自行炮
export function buildMortar() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, 0.3, 0).bone('gun', 'hull', 0, 1.2, -0.3)
  trackedHull(rig, 3.1, 1.95)
  // 后部战斗室：倾斜装甲
  rig.add('hull', AZ.GUN, box(1.3, 0.62, 1.55, 0, 1.05, -0.55, { taper: [0.78, 0.8] }))
  rig.add('hull', AZ.PLATE, box(1.34, 0.1, 1.2, 0, 0.8, -0.55), box(0.5, 0.06, 0.5, -0.3, 1.38, -0.75), prism(8, 0.2, 0.18, 0.07, 0.34, 1.36, -0.85))
  rig.add('hull', AZ.TEAM, box(1.06, 0.2, 0.04, 0, 1.12, -1.19, { r: [0.13, 0, 0] }), box(0.04, 0.2, 0.7, 0.62, 1.1, -0.6, { r: [0, 0, 0.17] }), box(0.04, 0.2, 0.7, -0.62, 1.1, -0.6, { r: [0, 0, -0.17] }))
  rig.add('hull', AZ.CYAN, box(0.3, 0.04, 0.03, 0, 1.28, 0.08), gem(0.035, 0.5, 1.75, -1.15))
  rig.add('hull', AZ.DARK, tube(V3(0.5, 1.3, -1.15), V3(0.5, 1.75, -1.15), 0.015, 0.01, 4), box(0.3, 0.16, 0.26, -0.72, 0.7, -1.2), box(0.3, 0.16, 0.26, 0.72, 0.7, -1.2))
  rig.add('hull', AZ.ORANGE, box(0.22, 0.05, 0.02, -0.72, 0.7, -1.34), box(0.22, 0.05, 0.02, 0.72, 0.7, -1.34))   // 排气口余热
  // 榴弹炮：粗短的曲射炮管，上扬 32°
  const el = -0.56
  rig.add('gun', AZ.GUN, group([box(0.5, 0.46, 0.7, 0, 0, 0.05), lathe([[0.2, 0], [0.2, 0.5], [0.165, 0.55], [0.165, 1.75], [0.0, 1.75]], 10, { axis: 'z', p: [0, 0.02, 0.35] })], [el, 0, 0], [0, 1.2, -0.3]))
  rig.add('gun', AZ.PLATE, group([lathe([[0.17, 0], [0.24, 0.04], [0.24, 0.3], [0.2, 0.34], [0.12, 0.34], [0.0, 0.3]], 8, { axis: 'z', p: [0, 0.02, 2.05] }), box(0.12, 0.12, 0.9, 0.24, 0.2, 0.6), box(0.12, 0.12, 0.9, -0.24, 0.2, 0.6), box(0.6, 0.5, 0.12, 0, 0, 0.42, { taper: [0.8, 1] })], [el, 0, 0], [0, 1.2, -0.3]))
  rig.add('gun', AZ.TEAM, group([lathe([[0.175, 0], [0.175, 0.14]], 10, { axis: 'z', p: [0, 0.02, 1.35] }), lathe([[0.175, 0], [0.175, 0.07]], 10, { axis: 'z', p: [0, 0.02, 1.58] })], [el, 0, 0], [0, 1.2, -0.3]))
  rig.add('gun', AZ.ORANGE, group([lathe([[0.1, 0], [0.11, 0.02]], 8, { axis: 'z', p: [0, 0.02, 2.39] })], [el, 0, 0], [0, 1.2, -0.3]))
  vehicleClips(rig, { recoil: 0.5, dy: sin(-el), dz: cos(el), dur: 0.7 })
  const mz = 2.45
  rig.meta = { muzzle: [0, 1.2 + sin(-el) * mz + 0.02, -0.3 + cos(el) * mz] }
  return rig
}

// ------------------------------------------------------------------ 「破城」轨道炮
export function buildLancer() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, 0.3, 0).bone('gun', 'hull', 0, 1.15, -0.4)
  trackedHull(rig, 2.9, 1.8, { noDeck: true })
  rig.add('hull', AZ.GUN, prism(8, 0.62, 0.5, 0.3, 0, 0.74, -0.3), box(0.9, 0.34, 0.7, 0, 0.9, -1.0, { taper: [0.8, 0.8] }))
  rig.add('hull', AZ.PLATE, prism(8, 0.5, 0.46, 0.06, 0, 1.04, -0.3))
  // 电容鼓
  for (const s of [1, -1]) {
    rig.add('gun', AZ.GUN, lathe([[0.0, 0], [0.2, 0.03], [0.2, 0.6], [0.0, 0.63]], 8, { axis: 'z', p: [s * 0.42, 1.2, -1.25] }))
    rig.add('gun', AZ.CYAN, lathe([[0.205, 0], [0.205, 0.05]], 8, { axis: 'z', p: [s * 0.42, 1.2, -1.05] }), lathe([[0.205, 0], [0.205, 0.05]], 8, { axis: 'z', p: [s * 0.42, 1.2, -0.85] }))
  }
  // 导轨：两根长梁 + 中间的能量槽 + 线圈箍
  rig.add('gun', AZ.GUN, box(0.6, 0.5, 0.9, 0, 1.24, -0.55, { taper: [0.8, 1] }))
  rig.add('gun', AZ.PLATE, box(0.1, 0.22, 3.5, 0.16, 1.28, 1.1), box(0.1, 0.22, 3.5, -0.16, 1.28, 1.1), box(0.44, 0.1, 0.5, 0, 1.52, -0.45))
  rig.add('gun', AZ.CYAN, box(0.2, 0.05, 3.3, 0, 1.28, 1.1))
  for (let i = 0; i < 5; i++) rig.add('gun', i % 2 ? AZ.TEAM : AZ.GUN, box(0.5, 0.36, 0.14, 0, 1.28, 0.1 + i * 0.62, { taper: [0.8, 1] }))
  rig.add('gun', AZ.GUN, box(0.16, 0.14, 0.3, 0.16, 1.28, 2.95, { taper: [1, 0.5] }), box(0.16, 0.14, 0.3, -0.16, 1.28, 2.95, { taper: [1, 0.5] }))
  rig.add('gun', AZ.ORANGE, box(0.06, 0.06, 0.06, 0.3, 1.5, -0.3), box(0.06, 0.06, 0.06, -0.3, 1.5, -0.3))
  // 驻锄
  for (const s of [1, -1]) rig.add('hull', AZ.DARK, tube(V3(s * 0.7, 0.6, -1.2), V3(s * 1.05, 0.05, -1.75), 0.06, 0.05, 5), box(0.3, 0.06, 0.3, s * 1.05, 0.03, -1.78))
  vehicleClips(rig, { recoil: 0.42, dy: 0, dz: 1, dur: 0.5, rock: 1.4 })
  rig.meta = { muzzle: [0, 1.28, 3.1] }
  return rig
}

// ------------------------------------------------------------------ 双足机甲（「泰坦」/ 老猫的改装步行机 / 「歌利亚」）
/** o: { arms: 'cannon'|'drill', accent: zone, racks: bool } 静止高度约 3.1 */
export function buildTitan(o = {}) {
  const rig = new Rig()
  const accent = o.accent ?? AZ.TEAM
  rig.bone('root', null, 0, 0, 0).bone('hips', 'root', 0, 1.55, 0).bone('hull', 'hips', 0, 1.75, 0)
    .bone('armR', 'hull', 1.0, 2.3, 0).bone('armL', 'hull', -1.0, 2.3, 0)
    .bone('legR', 'hips', 0.62, 1.55, 0).bone('shinR', 'legR', 0.66, 0.95, 0.36).bone('footR', 'shinR', 0.66, 0.2, -0.12)
    .bone('legL', 'hips', -0.62, 1.55, 0).bone('shinL', 'legL', -0.66, 0.95, 0.36).bone('footL', 'shinL', -0.66, 0.2, -0.12)
  // 反关节腿：大腿向前下，小腿向后下，脚掌宽大
  rig.both('legR', 'legL', AZ.GUN, tube(V3(0.64, 1.55, 0), V3(0.66, 0.95, 0.36), 0.2, 0.17, 6), prism(8, 0.22, 0.22, 0.3, 0.49, 1.55, 0, { r: [0, 0, -PI / 2] }))
  rig.both('legR', 'legL', AZ.PLATE, box(0.34, 0.5, 0.12, 0.68, 1.27, 0.34, { r: [0.55, 0, 0], taper: [0.8, 1] }))
  rig.both('legR', 'legL', accent, box(0.36, 0.14, 0.13, 0.68, 1.42, 0.27, { r: [0.55, 0, 0] }))
  rig.both('shinR', 'shinL', AZ.DARK, prism(8, 0.17, 0.17, 0.34, 0.49, 0.95, 0.36, { r: [0, 0, -PI / 2] }))
  rig.both('shinR', 'shinL', AZ.GUN, tube(V3(0.66, 0.95, 0.36), V3(0.66, 0.24, -0.12), 0.17, 0.13, 6), box(0.26, 0.5, 0.2, 0.66, 0.62, 0.22, { r: [-0.6, 0, 0], taper: [0.7, 0.8] }))
  rig.both('shinR', 'shinL', AZ.DARK, tube(V3(0.8, 0.9, 0.2), V3(0.8, 0.35, -0.2), 0.04, 0.04, 5))   // 液压杆
  rig.both('footR', 'footL', AZ.GUN, box(0.46, 0.2, 0.75, 0.66, 0.1, 0.06, { taper: [0.72, 0.7] }), box(0.2, 0.14, 0.3, 0.66, 0.07, -0.42, { taper: [0.7, 0.6] }))
  rig.both('footR', 'footL', AZ.PLATE, box(0.14, 0.13, 0.28, 0.52, 0.065, 0.5, { taper: [0.7, 0.5] }), box(0.14, 0.13, 0.28, 0.8, 0.065, 0.5, { taper: [0.7, 0.5] }))
  // 髋
  rig.add('hips', AZ.DARK, box(0.9, 0.34, 0.6, 0, 1.55, 0, { taper: [1.2, 1.1] }), prism(8, 0.26, 0.3, 0.2, 0, 1.68, 0))
  // 机身：宽扁的装甲舱，前倾的驾驶舱楔面
  rig.add('hull', AZ.GUN, box(1.5, 0.78, 1.3, 0, 2.28, -0.05, { taper: [0.84, 0.8] }), box(1.0, 0.5, 0.5, 0, 2.2, 0.72, { taper: [0.7, 0.3], shear: [0, -0.16] }))
  rig.add('hull', AZ.PLATE, box(1.56, 0.12, 1.1, 0, 2.0, -0.05), box(0.9, 0.08, 0.9, 0, 2.7, -0.15), box(0.6, 0.3, 0.06, 0, 2.22, 0.93, { r: [-0.5, 0, 0] }))
  rig.add('hull', AZ.CYAN, box(0.66, 0.07, 0.05, 0, 2.38, 0.84, { r: [-0.5, 0, 0] }), box(0.05, 0.05, 0.3, 0.72, 2.64, 0.2), box(0.05, 0.05, 0.3, -0.72, 2.64, 0.2))   // 座舱缝 + 位置灯
  rig.add('hull', accent, box(1.3, 0.14, 0.05, 0, 2.5, 0.55, { r: [-0.18, 0, 0] }), box(0.5, 0.05, 0.6, 0, 2.75, -0.2))
  // 背部反应堆 + 排气管
  rig.add('hull', AZ.DARK, box(1.1, 0.7, 0.4, 0, 2.3, -0.82, { taper: [0.85, 0.7] }))
  for (const s of [1, -1]) {
    rig.add('hull', AZ.GUN, prism(8, 0.11, 0.09, 0.62, s * 0.4, 2.55, -0.9, { r: [-0.25, 0, 0] }))
    rig.add('hull', AZ.ORANGE, prism(8, 0.07, 0.07, 0.02, s * 0.4, 3.15, -1.05, { r: [-0.25, 0, 0] }), box(0.26, 0.05, 0.02, s * 0.3, 2.2, -1.03))
  }
  if (o.racks) {   // 肩上的导弹架
    for (const s of [1, -1]) {
      rig.add('hull', AZ.GUN, box(0.46, 0.34, 0.6, s * 0.5, 2.92, -0.3, { r: [-0.2, 0, 0] }))
      for (let i = 0; i < 4; i++) rig.add('hull', AZ.ORANGE, box(0.1, 0.1, 0.02, s * 0.5 + (i % 2 - 0.5) * 0.2, 2.98 + ((i >> 1) - 0.5) * 0.16, 0.02, { r: [-0.2, 0, 0] }))
    }
  }
  // 手臂
  let muzzle = [1.05, 2.18, 1.75]
  if (o.arms === 'drill') {
    rig.both('armR', 'armL', AZ.GUN, box(0.44, 0.5, 0.7, 1.05, 2.24, 0.1, { taper: [0.85, 0.9] }))
    rig.add('armR', AZ.PLATE, lathe([[0.26, 0], [0.24, 0.2], [0.17, 0.5], [0.09, 0.8], [0.0, 1.0]], 8, { axis: 'z', p: [1.05, 2.2, 0.45] }))
    rig.add('armR', AZ.ORANGE, ring(0.27, 0.03, 8, 4, { axis: 'z', p: [1.05, 2.2, 0.5] }))
    rig.add('armL', AZ.GUN, box(0.3, 0.3, 0.9, -1.05, 2.2, 0.8), box(0.5, 0.12, 0.3, -1.05, 2.2, 1.3))
    rig.add('armL', AZ.CYAN, box(0.12, 0.12, 0.05, -1.05, 2.2, 1.46))
    muzzle = [1.05, 2.2, 1.45]
  } else {
    // 双联炮：每侧一个炮舱 + 上下两根炮管
    rig.both('armR', 'armL', AZ.GUN, box(0.5, 0.62, 1.0, 1.05, 2.26, 0.0, { taper: [0.85, 0.9] }), prism(8, 0.2, 0.2, 0.2, 0.74, 2.3, 0, { r: [0, 0, -PI / 2] }))
    rig.both('armR', 'armL', accent, box(0.54, 0.16, 0.5, 1.05, 2.5, -0.1))
    rig.both('armR', 'armL', AZ.PLATE,
      lathe([[0.1, 0], [0.1, 1.0], [0.13, 1.02], [0.13, 1.2], [0.07, 1.22], [0.0, 1.2]], 8, { axis: 'z', p: [1.05, 2.36, 0.5] }),
      lathe([[0.1, 0], [0.1, 1.0], [0.13, 1.02], [0.13, 1.2], [0.07, 1.22], [0.0, 1.2]], 8, { axis: 'z', p: [1.05, 2.08, 0.5] }),
      box(0.3, 0.5, 0.1, 1.05, 2.22, 0.56))
    rig.both('armR', 'armL', AZ.ORANGE, box(0.03, 0.06, 0.3, 1.31, 2.24, -0.2))
  }

  const gait = (u, P, amp) => {
    const a = u * TAU, s = sin(a), c = cos(a)
    P.r('legR', -0.42 * s * amp, 0, 0).r('legL', 0.42 * s * amp, 0, 0)
    P.r('shinR', 0.4 * Math.max(0, c) * amp, 0, 0).r('shinL', 0.4 * Math.max(0, -c) * amp, 0, 0)
    P.r('footR', (0.42 * s - 0.4 * Math.max(0, c)) * amp, 0, 0).r('footL', (-0.42 * s - 0.4 * Math.max(0, -c)) * amp, 0, 0)
    P.t('hips', 0, (0.06 * Math.abs(c) - 0.04) * amp, 0).r('hull', 0.02 * amp, 0.05 * s * amp, 0.025 * c * amp)
  }
  rig.clip('idle', 8, 2.6, true, (u, P) => { const s = sin(u * TAU); P.t('hips', 0, 0.015 * s, 0).r('hull', 0.012 * s, 0.03 * sin(u * TAU + 1), 0).r('armR', 0.02 * s, 0, 0).r('armL', -0.02 * s, 0, 0) })
  rig.clip('walk', 12, 1.0, true, (u, P) => gait(u, P, 1))
  rig.clip('shoot', 10, 0.55, false, (u, P) => {
    const k1 = Math.pow(1 - Math.min(1, u / 0.5), 2), k2 = u < 0.3 ? 0 : Math.pow(1 - Math.min(1, (u - 0.3) / 0.7), 2)
    P.t('armR', 0, 0, -0.22 * k1).r('armR', -0.06 * k1, 0, 0).t('armL', 0, 0, -0.22 * k2).r('armL', -0.06 * k2, 0, 0)
    P.r('hull', -0.035 * (k1 + k2), 0.03 * (k2 - k1), 0).t('hips', 0, -0.03 * (k1 + k2), 0)
  })
  rig.clip('die', 10, 1.1, false, (u, P) => {
    const k = ease(u)
    P.t('hips', 0, -0.95 * k, 0).r('legR', -0.9 * k, 0, 0.2 * k).r('legL', -0.7 * k, 0, -0.2 * k).r('shinR', 1.5 * k, 0, 0).r('shinL', 1.3 * k, 0, 0)
    P.r('hull', 0.5 * k, 0.2 * k, 0.12 * k).r('armR', 0.7 * k, 0, 0).r('armL', 0.5 * k, 0, 0)
  })
  rig.meta = { muzzle, muzzles: [[1.05, 2.22, 1.75], [-1.05, 2.22, 1.75]] }
  return rig
}

// ------------------------------------------------------------------ 「裁决」光束步行机（四足 + 大透镜）
export function buildReaper() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, 1.5, 0).bone('eye', 'body', 0, 1.6, 0.3)
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]]
  legs.forEach(([sx, sz], i) => { rig.bone('hip' + i, 'body', sx * 0.55, 1.45, sz * 0.5).bone('knee' + i, 'hip' + i, sx * 1.3, 1.95, sz * 1.05) })
  legs.forEach(([sx, sz], i) => {
    const hip = V3(sx * 0.55, 1.45, sz * 0.5), knee = V3(sx * 1.3, 1.95, sz * 1.05), foot = V3(sx * 1.55, 0.0, sz * 1.4)
    rig.add('hip' + i, AZ.GUN, tube(hip, knee, 0.14, 0.11, 6), ball(0.2, 0.2, 0.2, hip.x, hip.y, hip.z, 6, 4))
    rig.add('hip' + i, AZ.TEAM, box(0.22, 0.1, 0.5, (hip.x + knee.x) / 2, (hip.y + knee.y) / 2 + 0.14, (hip.z + knee.z) / 2, { r: [0, Math.atan2(sx * 0.75, sz * 0.55), 0] }))
    rig.add('knee' + i, AZ.DARK, ball(0.17, 0.17, 0.17, knee.x, knee.y, knee.z, 6, 4))
    rig.add('knee' + i, AZ.PLATE, tube(knee, V3(foot.x, 0.25, foot.z), 0.13, 0.06, 5), tube(V3(foot.x, 0.25, foot.z), foot, 0.06, 0.0, 5))
    rig.add('knee' + i, AZ.GUN, box(0.18, 0.7, 0.14, (knee.x * 0.6 + foot.x * 0.4), 1.3, (knee.z * 0.6 + foot.z * 0.4), { taper: [0.6, 0.6] }))
  })
  // 机身：上下两个棱台扣在一起
  rig.add('body', AZ.GUN, prism(8, 0.5, 0.85, 0.4, 0, 1.15, 0), prism(8, 0.85, 0.55, 0.45, 0, 1.55, 0))
  rig.add('body', AZ.PLATE, prism(8, 0.87, 0.87, 0.06, 0, 1.52, 0), prism(8, 0.4, 0.3, 0.16, 0, 2.0, 0))
  rig.add('body', AZ.TEAM, box(0.5, 0.06, 0.5, 0, 2.17, -0.1), box(0.05, 0.4, 0.5, 0, 2.3, -0.4, { taper: [1, 0.5] }))
  rig.add('body', AZ.ORANGE, box(0.4, 0.05, 0.03, 0, 1.3, -0.72), box(0.03, 0.05, 0.4, 0.7, 1.3, 0), box(0.03, 0.05, 0.4, -0.7, 1.3, 0))
  // 透镜炮塔
  rig.add('eye', AZ.DARK, lathe([[0.36, 0], [0.4, 0.2], [0.4, 0.62], [0.3, 0.7]], 10, { axis: 'z', p: [0, 1.6, 0.3] }))
  rig.add('eye', AZ.CYAN, lathe([[0.0, 0], [0.3, 0.02], [0.2, 0.1], [0.0, 0.13]], 10, { axis: 'z', p: [0, 1.6, 0.98], smooth: true }))
  rig.add('eye', AZ.PLATE, ring(0.36, 0.05, 10, 4, { axis: 'z', p: [0, 1.6, 1.0] }), box(0.1, 0.1, 0.5, 0.46, 1.6, 0.7), box(0.1, 0.1, 0.5, -0.46, 1.6, 0.7), box(0.1, 0.1, 0.5, 0, 2.06, 0.7))
  const step = (u, P, amp) => legs.forEach((_, i) => {
    const ph = u * TAU + ((i === 0 || i === 3) ? 0 : PI), sx = legs[i][0]
    P.r('hip' + i, 0, 0.3 * sin(ph) * amp * -sx, 0).r('knee' + i, 0, 0, sx * 0.3 * Math.max(0, cos(ph)) * amp)
  })
  rig.clip('idle', 8, 3, true, (u, P) => { P.t('body', 0, 0.03 * sin(u * TAU), 0).r('eye', 0, 0.2 * sin(u * TAU), 0) })
  rig.clip('walk', 12, 0.9, true, (u, P) => { step(u, P, 1); P.t('body', 0, 0.03 * sin(u * TAU * 2), 0) })
  rig.clip('shoot', 10, 0.75, false, (u, P) => { const k = bump(u, 0, 1); P.t('body', 0, -0.14 * k, -0.1 * k).r('body', -0.06 * k, 0, 0).s('eye', 1 + 0.12 * k).r('eye', 0, 0.5 * (u - 0.5) * k, 0) })
  rig.clip('die', 8, 1.0, false, (u, P) => { const k = ease(u); P.t('body', 0, -1.0 * k, 0).r('body', 0.2 * k, 0, 0.25 * k); legs.forEach(([sx], i) => P.r('hip' + i, 0, 0, -sx * 0.7 * k).r('knee' + i, 0, 0, sx * 0.9 * k)) })
  rig.meta = { muzzle: [0, 1.6, 1.1] }
  return rig
}

// ------------------------------------------------------------------ 「天钩」防空无人机群（指挥车 + 3 架悬停无人机）
export function buildSkyhook() {
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, 0.3, 0).bone('gun', 'hull', 0, 1.0, 0).bone('orbit', 'root', 0, 2.4, 0)
  for (let k = 0; k < 3; k++) rig.bone('d' + k, 'orbit', cos(k * TAU / 3) * 1.05, 2.4, sin(k * TAU / 3) * 1.05)
  trackedHull(rig, 2.3, 1.7, { noDeck: true })
  rig.add('hull', AZ.GUN, prism(6, 0.72, 0.6, 0.3, 0, 0.74, -0.1), box(0.8, 0.3, 0.5, 0, 0.88, -0.78, { taper: [0.8, 0.7] }))
  rig.add('hull', AZ.TEAM, prism(6, 0.56, 0.56, 0.04, 0, 1.04, -0.1))
  rig.add('hull', AZ.CYAN, ring(0.4, 0.025, 6, 3, { p: [0, 1.08, -0.1] }))
  rig.add('gun', AZ.PLATE, tube(V3(0, 1.0, -0.8), V3(0, 1.7, -0.9), 0.04, 0.03, 5), dome(0.26, 0.1, 0.26, 0, 1.7, -0.9, 8, 2, { r: [0.9, 0, 0] }))
  rig.add('gun', AZ.ORANGE, gem(0.04, 0, 1.78, -0.84))
  for (let k = 0; k < 3; k++) {
    const x = cos(k * TAU / 3) * 1.05, z = sin(k * TAU / 3) * 1.05, y = 2.4, b = 'd' + k
    rig.add(b, AZ.GUN, box(0.3, 0.12, 0.5, x, y, z, { taper: [0.8, 0.7] }), box(0.7, 0.04, 0.14, x, y + 0.02, z - 0.05))
    rig.add(b, AZ.PLATE, prism(8, 0.13, 0.13, 0.05, x + 0.36, y + 0.03, z - 0.05), prism(8, 0.13, 0.13, 0.05, x - 0.36, y + 0.03, z - 0.05), box(0.08, 0.06, 0.26, x, y - 0.08, z + 0.2))
    rig.add(b, AZ.CYAN, gem(0.045, x, y + 0.02, z + 0.27), ring(0.13, 0.012, 8, 3, { p: [x + 0.36, y + 0.085, z - 0.05] }), ring(0.13, 0.012, 8, 3, { p: [x - 0.36, y + 0.085, z - 0.05] }))
    rig.add(b, AZ.ORANGE, box(0.1, 0.04, 0.03, x, y, z - 0.26))
  }
  const fly = (u, P, tilt) => { P.r('orbit', 0, u * TAU, 0); for (let k = 0; k < 3; k++) P.t('d' + k, 0, 0.18 * sin(u * TAU * 2 + k * 2.1), 0).r('d' + k, tilt, -u * TAU, 0.1 * sin(u * TAU * 3 + k)) }
  rig.clip('idle', 24, 4.0, true, (u, P) => fly(u, P, 0))
  rig.clip('walk', 24, 4.0, true, (u, P) => fly(u, P, 0.1))
  rig.clip('shoot', 24, 2.0, true, (u, P) => { fly(u, P, 0.25); P.s('orbit', 1.15, 1, 1.15).r('gun', 0, u * TAU * 2, 0) })
  rig.clip('die', 8, 1.0, false, (u, P) => { const k = ease(u); P.r('hull', 0.1 * k, 0.2 * k, 0.14 * k).t('orbit', 0, -2.2 * k, 0).s('orbit', 1 + k * 0.6, 1, 1 + k * 0.6); for (let i = 0; i < 3; i++) P.r('d' + i, 1.2 * k, 0, 0.8 * k) })
  rig.meta = { muzzle: [0, 2.4, 1.05] }
  return rig
}
