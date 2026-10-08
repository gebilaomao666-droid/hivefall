// models/humans/mechs.js —— 步行机：「泰坦」/「歌利亚」双足重型机甲、老猫的改装工程步行机、「裁决」高脚光束步行机
import { AZ } from '../../materials.js'
import { Rig, V3, box, cbox, slab, prism, tube, lathe, gem, ring, beam, extrudeX, extrudeY, axle, TAU, sin, cos, bump, ease } from './hkit.js'

const PI = Math.PI

// ------------------------------------------------------------------ 反关节双足（泰坦 / 老猫共用）
// 骨：hips → legR/L（髋）→ shinR/L（膝）→ footR/L（踝）。返回步态函数。
function bipedLegs(rig, o) {
  const { hipY, hx, accent } = o, s = o.s ?? 1
  const kneeY = hipY - 0.6 * s, kneeZ = 0.4 * s, ankY = 0.24 * s, ankZ = -0.14 * s
  rig.bone('legR', 'hips', hx, hipY, 0).bone('shinR', 'legR', hx + 0.04, kneeY, kneeZ).bone('footR', 'shinR', hx + 0.04, ankY, ankZ)
  rig.bone('legL', 'hips', -hx, hipY, 0).bone('shinL', 'legL', -hx - 0.04, kneeY, kneeZ).bone('footL', 'shinL', -hx - 0.04, ankY, ankZ)
  const H = V3(hx + 0.02, hipY, 0), K = V3(hx + 0.04, kneeY, kneeZ), A = V3(hx + 0.04, ankY, ankZ)
  const fwd = V3(0, 0.55, 0.83)   // 大腿甲的朝前方向
  // 大腿：粗梁 + 前装甲 + 队色条；髋关节轴
  rig.both('legR', 'legL', AZ.DARK, axle(0.24 * s, 0.34 * s, hx - 0.12 * s, hipY, 0, 8))
  rig.both('legR', 'legL', AZ.GUN, beam(H, K, 0.36 * s, 0.4 * s, { c: 0.07 * s, taper: [0.85, 0.85] }))
  rig.both('legR', 'legL', AZ.PLATE, beam(H.clone().add(V3(0.02, 0.06, 0.24 * s)), K.clone().add(V3(0.02, 0.1 * s, 0.2 * s)), 0.4 * s, 0.08 * s, { c: 0.025 * s, taper: [0.8, 1] }))
  rig.both('legR', 'legL', accent, beam(H.clone().add(V3(0.02, 0.0, 0.3 * s)), H.clone().lerp(K, 0.35).add(V3(0.02, 0.06 * s, 0.29 * s)), 0.42 * s, 0.05 * s, { c: 0.015 * s }))
  rig.both('legR', 'legL', AZ.PLATE, box(0.06 * s, 0.4 * s, 0.34 * s, hx + 0.23 * s, hipY - 0.26 * s, 0.16 * s, { r: [0.58, 0, 0] }))   // 大腿外侧甲
  // 膝：关节轴 + 护膝
  rig.both('shinR', 'shinL', AZ.DARK, axle(0.19 * s, 0.44 * s, hx + 0.04, kneeY, kneeZ, 8))
  rig.both('shinR', 'shinL', AZ.PLATE, cbox(0.3 * s, 0.26 * s, 0.2 * s, hx + 0.04, kneeY + 0.02 * s, kneeZ + 0.16 * s, { c: 0.05 * s, taper: [0.8, 1] }))
  // 小腿：向后下收的梁 + 后侧液压杆 + 胫甲
  rig.both('shinR', 'shinL', AZ.GUN, beam(K, A, 0.3 * s, 0.32 * s, { c: 0.06 * s, taper: [0.75, 0.75] }))
  rig.both('shinR', 'shinL', AZ.PLATE, beam(K.clone().add(V3(0, -0.12 * s, 0.14 * s)), A.clone().add(V3(0, 0.12 * s, 0.2 * s)), 0.26 * s, 0.07 * s, { c: 0.02 * s, taper: [0.7, 1] }))
  rig.both('shinR', 'shinL', AZ.DARK, tube(K.clone().add(V3(0.17 * s, -0.04, -0.16 * s)), A.clone().add(V3(0.15 * s, 0.1, -0.12 * s)), 0.045 * s, 0.045 * s, 5), tube(K.clone().add(V3(-0.17 * s, -0.04, -0.16 * s)), A.clone().add(V3(-0.15 * s, 0.1, -0.12 * s)), 0.03 * s, 0.03 * s, 5))
  // 脚：踝轴 + 楔形脚掌 + 两趾 + 后跟
  rig.both('footR', 'footL', AZ.DARK, axle(0.15 * s, 0.4 * s, hx + 0.04, ankY, ankZ, 8))
  rig.both('footR', 'footL', AZ.GUN, extrudeX([[-0.5 * s, 0], [0.44 * s, 0], [0.5 * s, 0.1 * s], [0.18 * s, 0.26 * s], [-0.3 * s, 0.26 * s], [-0.52 * s, 0.1 * s]], 0.46 * s, hx + 0.04, { bevel: 0.05 * s }))
  rig.both('footR', 'footL', AZ.PLATE,
    cbox(0.18 * s, 0.14 * s, 0.34 * s, hx + 0.04 - 0.15 * s, 0.07 * s, 0.58 * s, { c: 0.035 * s, taper: [0.7, 0.55] }),
    cbox(0.18 * s, 0.14 * s, 0.34 * s, hx + 0.04 + 0.15 * s, 0.07 * s, 0.58 * s, { c: 0.035 * s, taper: [0.7, 0.55] }),
    box(0.3 * s, 0.05 * s, 0.34 * s, hx + 0.04, 0.27 * s, 0.0))
  return (u, P, amp) => {
    const a = u * TAU, sn = sin(a), c = cos(a)
    P.r('legR', -0.42 * sn * amp, 0, 0).r('legL', 0.42 * sn * amp, 0, 0)
    P.r('shinR', 0.42 * Math.max(0, c) * amp, 0, 0).r('shinL', 0.42 * Math.max(0, -c) * amp, 0, 0)
    P.r('footR', (0.42 * sn - 0.42 * Math.max(0, c)) * amp, 0, 0).r('footL', (-0.42 * sn - 0.42 * Math.max(0, -c)) * amp, 0, 0)
    P.t('hips', 0, (0.07 * Math.abs(c) - 0.045) * amp * s, 0)
  }
}

// ------------------------------------------------------------------ 「泰坦」机甲 / 「歌利亚」
/** o: { heavy: bool（歌利亚：四联炮 + 肩盾 + 更多挂架）, accent: zone } 静止高约 3.4 */
export function buildTitanMech(o = {}) {
  const rig = new Rig()
  const accent = o.accent ?? AZ.TEAM, heavy = !!o.heavy
  const hipY = 1.62
  rig.bone('root', null, 0, 0, 0).bone('hips', 'root', 0, hipY, 0).bone('hull', 'hips', 0, 1.86, 0)
    .bone('armR', 'hull', 1.08, 2.5, 0).bone('armL', 'hull', -1.08, 2.5, 0).bone('gunR', 'armR', 1.12, 2.4, 0.4).bone('gunL', 'armL', -1.12, 2.4, 0.4)
  const gait = bipedLegs(rig, { hipY, hx: 0.7, accent, s: 1.14 })
  // 髋：骨盆 + 腰部转盘 + 前裙甲
  rig.add('hips', AZ.DARK, cbox(1.0, 0.36, 0.64, 0, hipY, 0, { c: 0.08, taper: [1.15, 1.1] }), prism(10, 0.3, 0.34, 0.2, 0, hipY + 0.16, 0))
  rig.add('hips', AZ.PLATE, cbox(0.4, 0.4, 0.12, 0, hipY - 0.12, 0.34, { c: 0.04, taper: [1.5, 1] }))
  rig.add('hips', accent, box(0.16, 0.2, 0.03, 0, hipY - 0.06, 0.41))
  // 机身：侧视是前探的楔形舱，多层装甲
  rig.add('hull', AZ.GUN, extrudeX([[-0.95, 1.98], [0.5, 1.98], [1.02, 2.2], [1.08, 2.42], [0.78, 2.66], [0.2, 2.88], [-0.8, 2.88], [-1.05, 2.6]], 1.5, 0, { bevel: 0.08 }))
  rig.add('hull', AZ.PLATE,
    slab(1.0, 0.07, 0.95, 0, 2.915, -0.28, { c: 0.05 }),                                                  // 顶甲
    box(0.9, 0.05, 0.62, 0, 2.79, 0.5, { r: [0.36, 0, 0] }),                                              // 首上附加甲
    box(0.84, 0.05, 0.3, 0, 2.08, 0.79, { r: [-0.4, 0, 0] }),                                             // 首下
    box(0.05, 0.5, 0.9, 0.77, 2.4, -0.1), box(0.05, 0.5, 0.9, -0.77, 2.4, -0.1))                            // 侧附加甲
  rig.add('hull', accent, box(1.02, 0.03, 0.14, 0, 2.955, -0.1), box(0.052, 0.14, 0.9, 0.775, 2.62, -0.1), box(0.052, 0.14, 0.9, -0.775, 2.62, -0.1))
  rig.add('hull', AZ.CYAN, box(0.62, 0.07, 0.04, 0, 2.5, 0.98, { r: [-0.2, 0, 0] }),                       // 座舱观察缝
    box(0.08, 0.06, 0.03, 0.42, 2.18, 0.96), box(0.08, 0.06, 0.03, -0.42, 2.18, 0.96))                     // 大灯
  rig.add('hull', AZ.DARK, cbox(0.3, 0.16, 0.2, 0, 2.06, 0.96, { c: 0.03 }), tube(V3(0, 2.0, 0.96), V3(0, 1.98, 1.22), 0.03, 0.025, 5))   // 下颌机枪
  // 背部反应堆 + 排气
  rig.add('hull', AZ.DARK, cbox(1.1, 0.76, 0.42, 0, 2.44, -1.08, { c: 0.07, taper: [0.85, 0.7] }))
  rig.add('hull', AZ.GUN, box(0.8, 0.05, 0.03, 0, 2.6, -1.3), box(0.8, 0.05, 0.03, 0, 2.48, -1.32), box(0.8, 0.05, 0.03, 0, 2.36, -1.34))
  rig.add('hull', AZ.ORANGE, box(0.5, 0.05, 0.02, 0, 2.22, -1.33))
  for (const s of [1, -1]) {
    rig.add('hull', AZ.GUN, prism(8, 0.12, 0.1, 0.6, s * 0.4, 2.76, -1.06, { r: [-0.22, 0, 0] }))
    rig.add('hull', AZ.ORANGE, prism(8, 0.075, 0.075, 0.02, s * 0.4, 3.345, -1.19, { r: [-0.22, 0, 0] }))
  }
  rig.add('hull', AZ.DARK, tube(V3(-0.5, 2.9, -0.7), V3(-0.5, 3.75, -0.78), 0.014, 0.008, 4))             // 天线
  rig.add('hull', AZ.CYAN, gem(0.03, -0.5, 3.78, -0.78))
  // 顶部导弹巢
  for (const s of heavy ? [1, -1] : [1]) {
    rig.add('hull', AZ.GUN, cbox(0.44, 0.3, 0.6, s * 0.34, 3.1, -0.42, { c: 0.05, r: [-0.16, 0, 0] }))
    for (let i = 0; i < 4; i++) rig.add('hull', AZ.DARK, box(0.11, 0.08, 0.02, s * 0.34 + (i % 2 - 0.5) * 0.19, 3.16 + ((i >> 1) - 0.5) * 0.13, -0.115, { r: [-0.16, 0, 0] }))
  }
  if (!heavy) rig.add('hull', AZ.GUN, cbox(0.3, 0.2, 0.3, -0.36, 3.05, -0.45, { c: 0.04 }), prism(8, 0.1, 0.1, 0.03, -0.36, 3.15, -0.45))   // 传感器箱
  // 肩炮：肩关节 + 肩甲（armR/L），炮舱 + 双联炮管（gunR/L，后坐）
  rig.both('armR', 'armL', AZ.DARK, axle(0.24, 0.36, 0.84, 2.5, 0, 8))
  rig.both('armR', 'armL', AZ.GUN, cbox(0.6, 0.3, 0.9, 1.12, 2.86, -0.05, { c: 0.07, r: [0, 0, -0.12] }))
  rig.both('armR', 'armL', accent, slab(0.5, 0.06, 0.76, 1.14, 3.03, -0.05, { c: 0.04, r: [0, 0, -0.12] }))
  rig.both('armR', 'armL', AZ.PLATE, box(0.05, 0.12, 0.92, 1.43, 2.78, -0.05, { r: [0, 0, -0.12] }), box(0.56, 0.05, 0.05, 1.12, 2.98, 0.4))
  rig.both('armR', 'armL', AZ.DARK, box(0.34, 0.02, 0.05, 1.15, 3.065, 0.12, { r: [0, 0, -0.12] }), box(0.34, 0.02, 0.05, 1.15, 3.065, -0.04, { r: [0, 0, -0.12] }), box(0.34, 0.02, 0.05, 1.15, 3.065, -0.2, { r: [0, 0, -0.12] }))   // 肩甲顶的散热槽
  rig.add('hull', AZ.DARK, prism(8, 0.17, 0.17, 0.03, 0.0, 2.95, 0.06), box(0.5, 0.02, 0.06, 0, 2.955, -0.5), box(0.5, 0.02, 0.06, 0, 2.955, -0.62))   // 顶舱盖 / 格栅
  if (heavy) rig.both('armR', 'armL', AZ.PLATE, cbox(0.09, 1.0, 1.1, 1.5, 2.3, 0.0, { c: 0.03, taper: [1, 0.8] }))   // 歌利亚的肩盾
  if (heavy) rig.both('armR', 'armL', accent, box(0.03, 0.6, 0.16, 1.555, 2.3, 0.0))
  rig.both('gunR', 'gunL', AZ.GUN, cbox(0.52, 0.56, 1.15, 1.12, 2.4, 0.05, { c: 0.07, taper: [0.9, 0.95] }), cbox(0.3, 0.3, 0.34, 1.12, 2.4, -0.62, { c: 0.05 }))
  rig.both('gunR', 'gunL', AZ.DARK, box(0.54, 0.1, 0.3, 1.12, 2.4, 0.2), box(0.2, 0.2, 0.3, 0.86, 2.26, -0.2))       // 退壳窗 / 供弹
  const barrel = (x, y) => [
    [AZ.PLATE, lathe([[0.085, 0], [0.085, 1.0], [0.0, 1.0]], 8, { axis: 'z', p: [x, y, 0.6] })],
    [AZ.GUN, lathe([[0.115, 0], [0.115, 0.3]], 8, { axis: 'z', p: [x, y, 0.62] })],
    [AZ.DARK, cbox(0.22, 0.2, 0.24, x, y, 1.6, { c: 0.04 })],
  ]
  const spots = heavy ? [[0.99, 2.54], [1.25, 2.54], [0.99, 2.27], [1.25, 2.27]] : [[1.12, 2.55], [1.12, 2.26]]
  for (const [x, y] of spots) for (const [zone, g] of barrel(x, y)) rig.both('gunR', 'gunL', zone, g)
  rig.both('gunR', 'gunL', AZ.ORANGE, box(0.025, 0.07, 0.3, 1.385, 2.42, -0.1))

  rig.clip('idle', 8, 2.8, true, (u, P) => { const s = sin(u * TAU); P.t('hips', 0, 0.018 * s, 0).r('hull', 0.012 * s, 0.035 * sin(u * TAU + 1), 0).r('gunR', 0.02 * s, 0, 0).r('gunL', -0.02 * s, 0, 0) })
  rig.clip('walk', 12, 1.05, true, (u, P) => { gait(u, P, 1); const a = u * TAU; P.r('hull', 0.025, 0.05 * sin(a), 0.03 * cos(a)) })
  rig.clip('shoot', 12, 0.55, false, (u, P) => {
    const k1 = Math.pow(1 - Math.min(1, u / 0.5), 2), k2 = u < 0.3 ? 0 : Math.pow(1 - Math.min(1, (u - 0.3) / 0.7), 2)
    P.t('gunR', 0, 0, -0.3 * k1).r('armR', -0.05 * k1, 0, 0).t('gunL', 0, 0, -0.3 * k2).r('armL', -0.05 * k2, 0, 0)
    P.r('hull', -0.04 * (k1 + k2), 0.035 * (k2 - k1), 0).t('hips', 0, -0.04 * (k1 + k2), 0)
  })
  rig.clip('die', 12, 1.2, false, (u, P) => {
    const k = ease(u), j = bump(u, 0, 0.35)
    P.t('hips', 0, -1.0 * k, 0.1 * k).r('legR', -0.9 * k, 0, 0.2 * k).r('legL', -0.7 * k, 0, -0.2 * k).r('shinR', 1.5 * k, 0, 0).r('shinL', 1.3 * k, 0, 0).r('footR', -0.6 * k, 0, 0).r('footL', -0.6 * k, 0, 0)
    P.r('hull', 0.5 * k - 0.15 * j, 0.22 * k, 0.14 * k).r('armR', 0.75 * k, 0, -0.1 * k).r('armL', 0.5 * k, 0, 0.1 * k)
  })
  rig.meta = { muzzle: [1.12, 2.4, 1.75], muzzles: [[1.12, 2.4, 1.75], [-1.12, 2.4, 1.75]] }
  return rig
}

// ------------------------------------------------------------------ 「扳手」老猫：改装工程步行机（钻机臂 + 焊爪 + 防滚架 + 烟囱）
export function buildWrenchWalker() {
  const rig = new Rig()
  const hipY = 1.36, s = 0.86
  rig.bone('root', null, 0, 0, 0).bone('hips', 'root', 0, hipY, 0).bone('hull', 'hips', 0, 1.55, 0)
    .bone('armR', 'hull', 0.92, 2.0, 0.1).bone('drill', 'armR', 0.98, 1.86, 0.9).bone('armL', 'hull', -0.92, 2.0, 0.1).bone('claw', 'armL', -0.98, 1.8, 1.0)
  const gait = bipedLegs(rig, { hipY, hx: 0.56, accent: AZ.PAINT, s })
  rig.add('hips', AZ.DARK, cbox(0.86, 0.32, 0.56, 0, hipY, 0, { c: 0.07, taper: [1.15, 1.1] }), prism(10, 0.27, 0.3, 0.18, 0, hipY + 0.12, 0))
  // 驾驶舱：方正的工程车舱，前面是大块观察窗 + 防滚架
  rig.add('hull', AZ.GUN, extrudeX([[-0.8, 1.64], [0.6, 1.64], [0.78, 1.9], [0.62, 2.36], [-0.7, 2.36], [-0.86, 2.1]], 1.2, 0, { bevel: 0.07 }))
  rig.add('hull', AZ.PAINT, slab(0.96, 0.06, 0.96, 0, 2.39, -0.12, { c: 0.04 }), box(0.04, 0.34, 1.0, 0.61, 1.84, -0.1), box(0.04, 0.34, 1.0, -0.61, 1.84, -0.1))   // 工程黄顶板 / 腰线
  for (let i = 0; i < 4; i++) rig.add('hull', AZ.DARK, box(0.045, 0.34, 0.11, 0.613, 1.84, -0.46 + i * 0.26, { shear: [0, 0.12] }), box(0.045, 0.34, 0.11, -0.613, 1.84, -0.46 + i * 0.26, { shear: [0, 0.12] }))   // 黄黑警示斜纹
  rig.add('hull', AZ.DARK, box(0.8, 0.26, 0.03, 0, 2.14, 0.7, { r: [-0.33, 0, 0] }))                                  // 风挡
  rig.add('hull', AZ.CYAN, box(0.74, 0.035, 0.03, 0, 2.235, 0.685, { r: [-0.33, 0, 0] }))                             // 风挡上沿的抬头显示
  rig.add('hull', AZ.DARK, box(0.05, 0.3, 0.05, 0, 2.14, 0.72, { r: [-0.33, 0, 0] }), box(0.9, 0.05, 0.05, 0, 2.0, 0.77), box(0.9, 0.05, 0.05, 0, 2.28, 0.67))   // 窗框
  for (const sx of [1, -1]) {   // 防滚架
    rig.add('hull', AZ.PLATE, tube(V3(sx * 0.56, 2.36, 0.62), V3(sx * 0.56, 2.72, 0.3), 0.035, 0.035, 5), tube(V3(sx * 0.56, 2.72, 0.3), V3(sx * 0.56, 2.72, -0.5), 0.035, 0.035, 5), tube(V3(sx * 0.56, 2.72, -0.5), V3(sx * 0.56, 2.36, -0.7), 0.035, 0.035, 5))
    rig.add('hull', AZ.CYAN, box(0.12, 0.07, 0.04, sx * 0.4, 2.74, 0.33))                                              // 架顶工作灯
  }
  rig.add('hull', AZ.PLATE, tube(V3(-0.56, 2.72, 0.3), V3(0.56, 2.72, 0.3), 0.035, 0.035, 5), tube(V3(-0.56, 2.72, -0.5), V3(0.56, 2.72, -0.5), 0.035, 0.035, 5))
  rig.add('hull', AZ.ORANGE, prism(8, 0.07, 0.06, 0.1, 0, 2.74, -0.1))                                                // 警示爆闪灯
  rig.add('hull', AZ.DARK, prism(8, 0.09, 0.09, 0.03, 0, 2.72, -0.1))
  // 背部：发动机 + 一根歪烟囱 + 工具箱 + 吊臂
  rig.add('hull', AZ.DARK, cbox(1.0, 0.6, 0.4, 0, 2.0, -0.98, { c: 0.06, taper: [0.9, 0.8] }))
  rig.add('hull', AZ.GUN, prism(8, 0.11, 0.09, 0.95, 0.34, 2.2, -1.0, { r: [-0.12, 0, -0.08] }), cbox(0.4, 0.26, 0.3, -0.3, 2.42, -0.92, { c: 0.04 }))
  rig.add('hull', AZ.ORANGE, prism(8, 0.07, 0.07, 0.02, 0.415, 3.14, -1.115, { r: [-0.12, 0, -0.08] }), box(0.4, 0.05, 0.02, 0, 1.84, -1.17))
  rig.add('hull', AZ.PAINT, box(0.42, 0.04, 0.32, -0.3, 2.57, -0.92))
  // 右臂：钻机
  rig.both('armR', 'armL', AZ.DARK, axle(0.2, 0.3, 0.72, 2.0, 0.1, 8))
  rig.both('armR', 'armL', AZ.GUN, cbox(0.42, 0.46, 0.7, 0.98, 1.95, 0.3, { c: 0.07 }))
  rig.both('armR', 'armL', AZ.PAINT, slab(0.36, 0.05, 0.56, 0.98, 2.2, 0.3, { c: 0.03 }))
  rig.add('armR', AZ.GUN, lathe([[0.2, 0], [0.24, 0.05], [0.24, 0.25], [0.2, 0.3]], 8, { axis: 'z', p: [0.98, 1.86, 0.62] }))
  rig.add('drill', AZ.PLATE, lathe([[0.22, 0], [0.19, 0.2], [0.12, 0.55], [0.05, 0.85], [0.0, 0.98]], 8, { axis: 'z', p: [0.98, 1.86, 0.9] }))
  for (let i = 0; i < 3; i++) rig.add('drill', AZ.DARK, ring(0.2 - i * 0.055, 0.03, 8, 3, { axis: 'z', r: [0.25, 0, 0], p: [0.98, 1.86, 1.08 + i * 0.24] }))   // 螺旋刃（斜环近似）
  rig.add('drill', AZ.ORANGE, ring(0.245, 0.025, 8, 3, { axis: 'z', p: [0.98, 1.86, 0.93] }))
  // 左臂：三指焊爪 + 等离子割炬
  rig.add('armL', AZ.GUN, beam(V3(-0.98, 1.9, 0.6), V3(-0.98, 1.8, 1.0), 0.26, 0.26, { c: 0.05 }))
  rig.add('claw', AZ.DARK, prism(8, 0.17, 0.17, 0.14, -0.98, 1.8, 0.98, { r: [PI / 2, 0, 0] }))
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3 + PI / 2, cx = -0.98 + cos(a) * 0.15, cy = 1.8 + sin(a) * 0.15
    rig.add('claw', AZ.PLATE, beam(V3(cx, cy, 1.08), V3(-0.98 + cos(a) * 0.24, 1.8 + sin(a) * 0.24, 1.36), 0.09, 0.07, { c: 0.02 }), beam(V3(-0.98 + cos(a) * 0.24, 1.8 + sin(a) * 0.24, 1.36), V3(-0.98 + cos(a) * 0.1, 1.8 + sin(a) * 0.1, 1.6), 0.08, 0.06, { c: 0.018, taper: [0.4, 0.6] }))
  }
  rig.add('claw', AZ.CYAN, gem(0.06, -0.98, 1.8, 1.2, 1, 1, 1.6))
  rig.clip('idle', 8, 2.6, true, (u, P) => { const sn = sin(u * TAU); P.t('hips', 0, 0.016 * sn, 0).r('hull', 0.012 * sn, 0.04 * sin(u * TAU + 1), 0).r('drill', 0, 0, u * TAU).r('claw', 0, 0, 0.3 * sn) })
  rig.clip('walk', 12, 0.9, true, (u, P) => { gait(u, P, 1); const a = u * TAU; P.r('hull', 0.03, 0.06 * sin(a), 0.035 * cos(a)).r('drill', 0, 0, u * TAU) })
  rig.clip('shoot', 12, 0.55, true, (u, P) => {   // 钻机前顶 + 高速旋转，焊爪张合
    const j = sin(u * TAU * 3)
    P.r('hull', 0.06, -0.06, 0).t('armR', 0, 0, 0.16 + 0.04 * j).r('drill', 0, 0, u * TAU * 3).r('armL', -0.12, 0, 0).s('claw', 1 + 0.1 * j)
  })
  rig.clip('die', 12, 1.1, false, (u, P) => {
    const k = ease(u)
    P.t('hips', 0, -0.84 * k, 0).r('legR', -0.9 * k, 0, 0.2 * k).r('legL', -0.7 * k, 0, -0.2 * k).r('shinR', 1.5 * k, 0, 0).r('shinL', 1.3 * k, 0, 0).r('footR', -0.6 * k, 0, 0).r('footL', -0.6 * k, 0, 0)
    P.r('hull', 0.45 * k, -0.2 * k, -0.16 * k).r('armR', 0.8 * k, 0, 0).r('armL', 0.6 * k, 0, 0)
  })
  rig.meta = { muzzle: [0.98, 1.86, 1.9] }
  return rig
}

// ------------------------------------------------------------------ 「裁决」光束步行机：四条高脚 + 悬吊的透镜炮
export function buildArbiter() {
  const rig = new Rig()
  const BY = 2.55
  rig.bone('root', null, 0, 0, 0).bone('body', 'root', 0, BY, 0).bone('eye', 'body', 0, BY - 0.42, 0.25)
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]]
  legs.forEach(([sx, sz], i) => {
    const hip = [sx * 0.55, BY - 0.05, sz * 0.5], knee = [sx * 1.25, BY + 0.62, sz * 1.1], foot = [sx * 1.55, 0, sz * 1.45]
    rig.bone('hip' + i, 'body', ...hip).bone('knee' + i, 'hip' + i, ...knee)
    const H = V3(...hip), K = V3(...knee), F = V3(...foot), M = K.clone().lerp(F, 0.72)
    const out = V3(sx, 0, sz).normalize()
    rig.add('hip' + i, AZ.DARK, prism(8, 0.22, 0.22, 0.26, hip[0], hip[1] - 0.13, hip[2]))
    rig.add('hip' + i, AZ.GUN, beam(H, K, 0.24, 0.28, { c: 0.05, ref: V3(0, 1, 0), taper: [0.85, 0.85] }))
    rig.add('hip' + i, AZ.TEAM, beam(H.clone().lerp(K, 0.15).add(V3(0, 0.16, 0)), H.clone().lerp(K, 0.9).add(V3(0, 0.15, 0)), 0.2, 0.04, { c: 0.012, ref: V3(0, 1, 0) }))
    // 膝：俯视最显眼的四个点，做成大块护膝 + 一盏位置灯
    rig.add('knee' + i, AZ.DARK, prism(8, 0.2, 0.2, 0.3, knee[0], knee[1] - 0.15, knee[2]))
    rig.add('knee' + i, AZ.PLATE, cbox(0.4, 0.14, 0.4, knee[0], knee[1] + 0.17, knee[2], { c: 0.05, r: [0, Math.atan2(sx, sz), 0], taper: [0.7, 0.7] }))
    rig.add('knee' + i, AZ.ORANGE, box(0.08, 0.03, 0.08, knee[0], knee[1] + 0.25, knee[2]))
    // 小腿：长而直，下段收细成尖足
    rig.add('knee' + i, AZ.GUN, beam(K, M, 0.22, 0.24, { c: 0.05, ref: out, taper: [0.6, 0.6] }))
    rig.add('knee' + i, AZ.PLATE, beam(K.clone().addScaledVector(out, 0.12), K.clone().lerp(F, 0.45).addScaledVector(out, 0.1), 0.2, 0.05, { c: 0.015, ref: out, taper: [0.6, 1] }))
    rig.add('knee' + i, AZ.DARK, beam(M, F, 0.13, 0.14, { c: 0.03, ref: out, taper: [0.35, 0.35] }))
    rig.add('knee' + i, AZ.PLATE, prism(6, 0.2, 0.1, 0.1, foot[0], 0, foot[2]))
  })
  // 机身：上下两层棱台 + 顶部传感器脊
  rig.add('body', AZ.GUN, prism(8, 0.5, 0.88, 0.34, 0, BY - 0.32, 0), prism(8, 0.88, 0.62, 0.36, 0, BY + 0.08, 0))
  rig.add('body', AZ.PLATE, prism(8, 0.92, 0.92, 0.07, 0, BY + 0.015, 0), prism(8, 0.46, 0.36, 0.12, 0, BY + 0.44, 0))
  rig.add('body', AZ.TEAM, extrudeY([[0, 0.5], [0.28, 0.2], [0.28, -0.3], [-0.28, -0.3], [-0.28, 0.2]], 0.05, BY + 0.56, { bevel: 0.02 }))
  rig.add('body', AZ.GUN, extrudeX([[-0.75, BY + 0.44], [-0.2, BY + 0.44], [-0.35, BY + 0.9], [-0.7, BY + 0.98]], 0.07, 0, { bevel: 0.02 }))   // 尾鳍
  rig.add('body', AZ.CYAN, box(0.03, 0.03, 0.5, 0, BY + 0.62, -0.05), gem(0.035, 0, BY + 1.0, -0.68))
  rig.add('body', AZ.ORANGE, box(0.4, 0.05, 0.03, 0, BY + 0.0, -0.9), box(0.03, 0.05, 0.4, 0.9, BY + 0.0, 0), box(0.03, 0.05, 0.4, -0.9, BY + 0.0, 0))
  // 透镜炮：吊在机腹下，朝前
  const EY = BY - 0.55
  rig.add('eye', AZ.DARK, prism(8, 0.22, 0.26, 0.24, 0, EY + 0.1, 0.1), lathe([[0.3, 0], [0.36, 0.16], [0.36, 0.7], [0.3, 0.78]], 10, { axis: 'z', p: [0, EY, -0.1] }))
  rig.add('eye', AZ.CYAN, lathe([[0.0, 0], [0.27, 0.02], [0.18, 0.1], [0.0, 0.13]], 10, { axis: 'z', p: [0, EY, 0.66], smooth: true }))
  rig.add('eye', AZ.PLATE, ring(0.33, 0.05, 10, 4, { axis: 'z', p: [0, EY, 0.7] }), box(0.09, 0.09, 0.6, 0.42, EY, 0.4), box(0.09, 0.09, 0.6, -0.42, EY, 0.4), box(0.09, 0.09, 0.6, 0, EY - 0.42, 0.4))   // 聚焦臂
  rig.add('eye', AZ.CYAN, box(0.03, 0.03, 0.5, 0.47, EY, 0.4), box(0.03, 0.03, 0.5, -0.47, EY, 0.4))
  const step = (u, P, amp) => legs.forEach(([sx], i) => {
    const ph = u * TAU + ((i === 0 || i === 3) ? 0 : PI)
    P.r('hip' + i, 0, 0.26 * sin(ph) * amp * -sx, 0).r('knee' + i, 0, 0, sx * 0.22 * Math.max(0, cos(ph)) * amp)
  })
  rig.clip('idle', 8, 3.2, true, (u, P) => { P.t('body', 0, 0.04 * sin(u * TAU), 0).r('eye', 0.06 * sin(u * TAU + 1), 0.25 * sin(u * TAU), 0) })
  rig.clip('walk', 12, 1.0, true, (u, P) => { step(u, P, 1); P.t('body', 0, 0.04 * sin(u * TAU * 2), 0).r('body', 0.02 * sin(u * TAU), 0, 0.02 * cos(u * TAU)) })
  rig.clip('shoot', 12, 0.75, false, (u, P) => {   // 蹲身蓄能 → 透镜左右横扫
    const k = bump(u, 0, 1)
    P.t('body', 0, -0.22 * k, -0.08 * k).r('body', 0.05 * k, 0, 0).s('eye', 1 + 0.15 * k).r('eye', 0.12 * k, 0.7 * (0.5 - u) * k * 2, 0)
    legs.forEach(([sx], i) => P.r('knee' + i, 0, 0, -sx * 0.06 * k))
  })
  rig.clip('die', 12, 1.2, false, (u, P) => {
    const k = ease(u), f = u * u
    P.t('body', 0, -1.85 * f, 0).r('body', 0.25 * k, 0.3 * k, 0.3 * k).r('eye', 0.5 * k, 0, 0)
    legs.forEach(([sx], i) => P.r('hip' + i, 0, 0, sx * (i % 2 ? 0.75 : 0.55) * k).r('knee' + i, 0, 0, sx * 0.6 * k))
  })
  rig.meta = { muzzle: [0, EY, 0.85] }
  return rig
}
