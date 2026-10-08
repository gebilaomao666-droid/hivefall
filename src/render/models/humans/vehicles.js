// models/humans/vehicles.js —— 载具：「雷锤」自行炮、「破城」轨道炮步行平台、「天钩」无人机母机
import { AZ } from '../../materials.js'
import { Rig, V3, box, cbox, slab, prism, tube, lathe, gem, ring, group, beam, extrudeX, extrudeY, axle, TAU, sin, cos, bump, ease } from './hkit.js'

const PI = Math.PI

// ------------------------------------------------------------------ 履带行走部（侧视轮廓挤出 + 负重轮 + 挡泥板）
function tracks(rig, bone, L, W, o = {}) {
  const hl = L / 2, tw = o.tw ?? 0.46, h = o.h ?? 0.56
  for (const s of [1, -1]) {
    const x = s * (W / 2 - tw / 2)
    // 履带环：前高后低的跑道形
    rig.add(bone, AZ.DARK, extrudeX([[-hl + 0.14, 0], [hl - 0.3, 0], [hl - 0.04, 0.2], [hl, 0.36], [hl - 0.14, h], [-hl + 0.12, h], [-hl, h - 0.2], [-hl + 0.02, 0.14]], tw, x, { bevel: 0.03 }))
    // 履带板的齿（顶面一排，俯视能看到节奏）
    const n = Math.round(L / 0.26)
    for (let i = 0; i < n; i++) rig.add(bone, AZ.GUN, box(tw + 0.02, 0.03, 0.09, x, h + 0.005, -hl + 0.22 + i * (L - 0.44) / (n - 1)))
    // 负重轮 + 主动轮
    const nw = o.wheels ?? 5
    for (let i = 0; i < nw; i++) rig.add(bone, AZ.GUN, axle(0.16, 0.06, x + s * (tw / 2 + 0.005), 0.2, -hl + 0.42 + i * (L - 0.95) / (nw - 1), 8))
    rig.add(bone, AZ.PLATE, axle(0.13, 0.08, x + s * (tw / 2 + 0.01), 0.36, hl - 0.2, 8), axle(0.06, 0.1, x + s * (tw / 2 + 0.012), 0.2, -hl + 0.42 + 2 * (L - 0.95) / (nw - 1), 6))
    // 挡泥板（前端下折）+ 侧裙甲
    rig.add(bone, AZ.GUN, slab(tw + 0.12, 0.06, L * 0.9, x + s * 0.02, h + 0.06, -0.06, { c: 0.03 }))
    rig.add(bone, AZ.GUN, box(tw + 0.12, 0.04, 0.26, x + s * 0.02, h - 0.0, hl - 0.04, { r: [0.55, 0, 0] }))
    rig.add(bone, AZ.PLATE, box(0.04, 0.22, L * 0.56, s * (W / 2 + 0.05), h - 0.1, -0.12))
    rig.add(bone, AZ.TEAM, box(0.045, 0.1, L * 0.24, s * (W / 2 + 0.055), h - 0.06, 0.18))
    rig.add(bone, AZ.CYAN, box(0.12, 0.05, 0.03, x, h - 0.12, hl + 0.012))      // 车头灯
    rig.add(bone, AZ.ORANGE, box(0.09, 0.04, 0.03, x, h - 0.1, -hl - 0.012))    // 尾灯
  }
}

// ------------------------------------------------------------------ 「雷锤」自行炮：履带底盘 + 后置战斗室 + 长身管榴弹炮
export function buildThunderhammer(o = {}) {
  const merc = !!o.merc, accent = merc ? AZ.GOLD : AZ.TEAM
  const rig = new Rig()
  const L = 3.3, W = 2.0, GP = [0, 1.22, -0.35], el = -0.42   // 炮耳轴位置 / 仰角
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, 0.3, -0.6).bone('gun', 'hull', GP[0], GP[1], GP[2]).bone('barrel', 'gun', GP[0], GP[1], GP[2])
  tracks(rig, 'hull', L, W)
  // 车体：首上大斜面
  rig.add('hull', AZ.GUN, extrudeX([[-1.6, 0.3], [1.3, 0.3], [1.62, 0.5], [1.5, 0.62], [0.75, 0.86], [-1.6, 0.86]], W - 0.92 + 0.12, 0, { bevel: 0.04 }))
  rig.add('hull', AZ.PLATE, box(0.7, 0.03, 0.5, 0, 0.78, 1.08, { r: [0.31, 0, 0] }), box(0.3, 0.04, 0.3, -0.3, 0.885, 0.45), prism(8, 0.13, 0.13, 0.04, 0.32, 0.87, 0.45))   // 首上附加甲 / 驾驶舱盖
  rig.add('hull', AZ.CYAN, box(0.2, 0.035, 0.03, -0.3, 0.9, 0.62))                                                     // 驾驶员潜望镜
  rig.add('hull', AZ.DARK, box(0.5, 0.06, 0.05, 0, 0.56, 1.6), tube(V3(0.45, 0.7, 1.5), V3(0.45, 0.62, 1.66), 0.035, 0.035, 5), tube(V3(-0.45, 0.7, 1.5), V3(-0.45, 0.62, 1.66), 0.035, 0.035, 5))   // 拖钩
  // 战斗室：四面内倾的装甲盒
  rig.add('hull', AZ.GUN, extrudeX([[-1.58, 0.86], [0.42, 0.86], [0.16, 1.5], [-1.4, 1.5]], 1.44, 0, { bevel: 0.07 }))
  rig.add('hull', AZ.PLATE, slab(1.16, 0.05, 1.24, 0, 1.525, -0.62, { c: 0.04 }), prism(8, 0.2, 0.18, 0.08, 0.34, 1.55, -0.95), box(0.36, 0.05, 0.4, -0.32, 1.56, -0.95))   // 顶甲 / 车长塔 / 舱盖
  rig.add('hull', AZ.DARK, box(0.34, 0.025, 0.26, 0.3, 1.555, -0.3), box(0.34, 0.025, 0.26, -0.3, 1.555, -0.3))       // 顶部散热格栅
  rig.add('hull', accent, box(0.03, 0.2, 0.9, 0.725, 1.2, -0.6, { r: [0, 0, 0.1] }), box(0.03, 0.2, 0.9, -0.725, 1.2, -0.6, { r: [0, 0, -0.1] }), box(0.9, 0.18, 0.03, 0, 1.2, -1.52, { r: [0.12, 0, 0] }))   // 队色腰线
  rig.add('hull', AZ.CYAN, gem(0.03, 0.62, 2.12, -1.3), box(0.12, 0.03, 0.03, 0.34, 1.6, -0.78))
  rig.add('hull', AZ.DARK, tube(V3(0.62, 1.5, -1.3), V3(0.62, 2.1, -1.3), 0.012, 0.008, 4))                           // 天线
  rig.add('hull', AZ.GUN, cbox(0.34, 0.26, 0.5, 0.86, 0.98, -1.05, { c: 0.04 }), cbox(0.34, 0.26, 0.5, -0.86, 0.98, -1.05, { c: 0.04 }), cbox(0.34, 0.2, 0.4, 0.86, 0.95, -0.4, { c: 0.04 }), cbox(0.34, 0.2, 0.4, -0.86, 0.95, -0.4, { c: 0.04 }))   // 两侧储物箱
  rig.add('hull', AZ.ORANGE, box(0.24, 0.05, 0.02, 0.4, 0.62, -1.665), box(0.24, 0.05, 0.02, -0.4, 0.62, -1.665))     // 排气余热
  rig.add('hull', AZ.DARK, box(1.5, 0.3, 0.06, 0, 0.34, -1.72, { r: [-0.5, 0, 0] }), box(0.9, 0.36, 0.08, 0, 1.15, -1.56, { r: [0.12, 0, 0] }))   // 驻锄 / 尾门
  // 火炮：炮盾 + 摇架（gun 骨）；身管（barrel 骨，开火时沿轴线后坐）
  const G = (geos) => group(geos, [el, 0, 0], GP)
  rig.add('gun', AZ.GUN, G([cbox(0.62, 0.52, 0.5, 0, 0.0, 0.42, { c: 0.08, taper: [0.8, 0.8] }), cbox(0.34, 0.34, 0.9, 0, 0.0, 0.95, { c: 0.06 })]))
  rig.add('gun', AZ.PLATE, G([box(0.09, 0.09, 0.8, 0.2, 0.22, 0.9), box(0.09, 0.09, 0.8, -0.2, 0.22, 0.9), box(0.7, 0.06, 0.06, 0, 0.27, 0.28)]))   // 复进机
  rig.add('barrel', AZ.GUN, G([lathe([[0.15, 0.6], [0.15, 1.5], [0.13, 1.56], [0.12, 3.3], [0.0, 3.3]], 10, { axis: 'z' })]))
  rig.add('barrel', accent, G([lathe([[0.155, 0], [0.155, 0.12]], 10, { axis: 'z', p: [0, 0, 1.62] })]))
  rig.add('barrel', AZ.PLATE, G([lathe([[0.17, 0], [0.19, 0.04], [0.19, 0.36], [0.17, 0.4]], 10, { axis: 'z', p: [0, 0, 2.15] }),        // 抽烟装置
    cbox(0.44, 0.24, 0.38, 0, 0, 3.38, { c: 0.06 })]))                                                                                   // 双室炮口制退器
  rig.add('barrel', AZ.DARK, G([box(0.46, 0.12, 0.09, 0, 0, 3.29), box(0.46, 0.12, 0.09, 0, 0, 3.46)]))
  rig.add('barrel', AZ.ORANGE, G([lathe([[0.09, 0], [0.1, 0.015]], 8, { axis: 'z', p: [0, 0, 3.57] })]))
  const ax = [0, sin(-el), cos(el)]   // 身管轴线方向
  rig.clip('idle', 4, 0.5, true, (u, P) => { P.t('hull', 0, 0.005 * sin(u * TAU), 0) })
  rig.clip('walk', 4, 0.3, true, (u, P) => { P.t('hull', 0, 0.012 * sin(u * TAU), 0).r('hull', 0.008 * sin(u * TAU * 2), 0, 0) })
  rig.clip('shoot', 12, 0.75, false, (u, P) => {
    const k = u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 2.2)
    P.t('barrel', 0, -0.62 * ax[1] * k, -0.62 * ax[2] * k).r('gun', -0.035 * k, 0, 0)
    P.r('hull', -0.045 * k, 0, 0).t('hull', 0, -0.02 * k, -0.09 * k)
  })
  rig.clip('die', 10, 1.0, false, (u, P) => { const k = ease(u), j = bump(u, 0, 0.3); P.t('hull', 0, 0.12 * j - 0.1 * k, 0).r('hull', 0.1 * k, 0.22 * k, 0.15 * k).r('gun', 0.62 * k, 0.3 * k, 0).t('barrel', 0, -0.2 * k, -0.3 * k) })
  const mz = 3.6
  rig.meta = { muzzle: [0, GP[1] + ax[1] * mz, GP[2] + ax[2] * mz] }
  return rig
}

// ------------------------------------------------------------------ 「破城」轨道炮：四足低趴的步行平台，一根贯穿全身的长磁轨
export function buildBreacher() {
  const rig = new Rig()
  const BY = 1.0   // 机身中心高
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, BY, 0).bone('gun', 'hull', 0, 1.42, -0.5)
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]]
  legs.forEach(([sx, sz], i) => {
    const hip = [sx * 0.52, BY + 0.05, sz * 0.72], knee = [sx * 1.12, BY + 0.42, sz * 1.12]
    rig.bone('hip' + i, 'hull', ...hip).bone('knee' + i, 'hip' + i, ...knee)
    const H = V3(...hip), K = V3(...knee), F = V3(sx * 1.34, 0.1, sz * 1.36)
    rig.add('hip' + i, AZ.DARK, prism(8, 0.17, 0.17, 0.2, hip[0], hip[1] - 0.1, hip[2]))                                // 髋关节转盘
    rig.add('hip' + i, AZ.GUN, beam(H, K, 0.32, 0.28, { c: 0.06, ref: V3(0, 1, 0) }))
    rig.add('hip' + i, AZ.TEAM, beam(H.clone().lerp(K, 0.2).add(V3(0, 0.13, 0)), H.clone().lerp(K, 0.85).add(V3(0, 0.13, 0)), 0.2, 0.04, { c: 0.012, ref: V3(0, 1, 0) }))
    rig.add('knee' + i, AZ.DARK, prism(8, 0.16, 0.16, 0.3, knee[0], knee[1] - 0.15, knee[2]))
    rig.add('knee' + i, AZ.GUN, beam(K, F, 0.3, 0.3, { c: 0.06, taper: [0.7, 0.7], ref: V3(sx, 0, sz) }))
    rig.add('knee' + i, AZ.PLATE, beam(K.clone().add(V3(sx * 0.1, 0.12, sz * 0.1)), K.clone().lerp(F, 0.62).add(V3(sx * 0.12, 0, sz * 0.12)), 0.22, 0.05, { c: 0.015, taper: [0.7, 1], ref: V3(sx, 0, sz) }))   // 小腿外甲
    rig.add('knee' + i, AZ.PLATE, prism(6, 0.26, 0.2, 0.1, F.x, 0, F.z))                                                // 驻锄脚掌
    rig.add('knee' + i, AZ.DARK, prism(6, 0.13, 0.13, 0.12, F.x, 0.08, F.z))
  })
  // 机身：窄长的脊梁
  rig.add('hull', AZ.GUN, extrudeX([[-1.2, 0.78], [0.95, 0.78], [1.3, 0.98], [1.15, 1.2], [-1.05, 1.24], [-1.3, 1.0]], 0.84, 0, { bevel: 0.06 }))
  rig.add('hull', AZ.PLATE, slab(0.6, 0.05, 0.7, 0, 1.25, 0.55, { c: 0.04 }), box(0.5, 0.03, 0.4, 0, 1.1, 1.16, { r: [0.5, 0, 0] }))
  rig.add('hull', AZ.CYAN, box(0.34, 0.04, 0.03, 0, 1.0, 1.3), box(0.03, 0.04, 0.2, 0.43, 1.12, 0.3), box(0.03, 0.04, 0.2, -0.43, 1.12, 0.3))
  rig.add('hull', AZ.DARK, box(0.7, 0.2, 0.08, 0, 0.98, -1.28), prism(8, 0.3, 0.26, 0.2, 0, 1.22, -0.5))               // 尾部散热 / 炮座
  rig.add('hull', AZ.ORANGE, box(0.5, 0.04, 0.02, 0, 0.98, -1.33))
  // 磁轨炮（gun 骨，整体后坐）：炮尾 + 电容鼓 + 双轨 + 线圈箍 + 叉形炮口
  const GY = 1.62
  rig.add('gun', AZ.GUN, cbox(0.62, 0.5, 1.1, 0, GY, -0.75, { c: 0.08, taper: [0.85, 1] }), cbox(0.4, 0.3, 0.5, 0, GY, -1.5, { c: 0.06 }))
  rig.add('gun', AZ.PLATE, slab(0.46, 0.06, 0.8, 0, GY + 0.28, -0.75, { c: 0.04 }))
  for (const s of [1, -1]) {
    rig.add('gun', AZ.GUN, lathe([[0.0, 0], [0.19, 0.03], [0.19, 0.7], [0.0, 0.73]], 8, { axis: 'z', p: [s * 0.47, GY - 0.04, -1.2] }))
    rig.add('gun', AZ.CYAN, lathe([[0.195, 0], [0.195, 0.04]], 8, { axis: 'z', p: [s * 0.47, GY - 0.04, -1.02] }), lathe([[0.195, 0], [0.195, 0.04]], 8, { axis: 'z', p: [s * 0.47, GY - 0.04, -0.78] }))
    rig.add('gun', AZ.PLATE, beam(V3(s * 0.15, GY, -0.2), V3(s * 0.15, GY, 3.5), 0.09, 0.24, { c: 0.025, ref: V3(0, 1, 0), taper: [1, 0.8] }))   // 导轨
    rig.add('gun', AZ.GUN, box(0.11, 0.1, 0.34, s * 0.15, GY, 3.62, { taper: [1, 0.4] }))
    rig.add('gun', AZ.ORANGE, box(0.05, 0.05, 0.05, s * 0.28, GY + 0.24, -0.4))
  }
  rig.add('gun', AZ.DARK, box(0.2, 0.06, 3.4, 0, GY - 0.04, 1.7))
  rig.add('gun', AZ.CYAN, box(0.06, 0.03, 3.4, 0, GY + 0.0, 1.7))                                                           // 能量槽
  for (let i = 0; i < 6; i++) rig.add('gun', i % 2 ? AZ.TEAM : AZ.GUN, cbox(0.46, 0.36, 0.13, 0, GY, 0.1 + i * 0.6, { c: 0.04, taper: [0.8, 1] }))   // 线圈箍
  rig.add('gun', AZ.DARK, cbox(0.18, 0.16, 0.3, 0, GY + 0.36, -0.35, { c: 0.03 }))                                     // 观瞄
  rig.add('gun', AZ.CYAN, box(0.1, 0.07, 0.02, 0, GY + 0.36, -0.195))
  const step = (u, P, amp) => legs.forEach(([sx, sz], i) => {
    const ph = u * TAU + ((i === 0 || i === 3) ? 0 : PI)
    P.r('hip' + i, 0, 0.26 * sin(ph) * amp * -sx, 0).r('knee' + i, -sz * 0.0, 0, sx * 0.28 * Math.max(0, cos(ph)) * amp)
  })
  rig.clip('idle', 8, 3.0, true, (u, P) => { P.t('hull', 0, 0.02 * sin(u * TAU), 0).r('gun', 0.01 * sin(u * TAU), 0, 0) })
  rig.clip('walk', 12, 0.8, true, (u, P) => { step(u, P, 1); P.t('hull', 0, 0.025 * sin(u * TAU * 2), 0).r('hull', 0, 0, 0.015 * sin(u * TAU)) })
  rig.clip('shoot', 12, 0.5, false, (u, P) => {
    const k = u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 2)
    P.t('gun', 0, 0, -0.55 * k).t('hull', 0, -0.07 * k, -0.12 * k).r('hull', -0.04 * k, 0, 0)
    legs.forEach(([sx, sz], i) => P.r('knee' + i, 0, 0, -sx * 0.05 * k))
  })
  rig.clip('die', 10, 1.0, false, (u, P) => {
    const k = ease(u)
    P.t('hull', 0, -0.62 * k, 0).r('hull', 0.06 * k, 0.1 * k, 0.12 * k).r('gun', 0.22 * k, 0.12 * k, 0)
    legs.forEach(([sx], i) => P.r('hip' + i, 0, 0, sx * 0.35 * k).r('knee' + i, 0, 0, sx * 0.5 * k))
  })
  rig.meta = { muzzle: [0, GY, 3.8] }
  return rig
}

// ------------------------------------------------------------------ 小无人机（天钩的子机 / 共用）：在原点建好再摆位
export function droneParts(x, y, z, s = 1) {
  const out = []
  const P = (zone, g) => { g.scale(s, s, s); g.translate(x, y, z); g.computeVertexNormals(); out.push([zone, g]) }
  P(AZ.GUN, cbox(0.26, 0.12, 0.5, 0, 0, 0, { c: 0.035, taper: [0.8, 0.8] }))
  P(AZ.TEAM, slab(0.16, 0.03, 0.26, 0, 0.07, -0.04, { c: 0.02 }))
  P(AZ.GUN, box(0.74, 0.035, 0.1, 0, 0.0, -0.04))                                     // 横梁
  for (const sx of [1, -1]) {
    P(AZ.PLATE, ring(0.15, 0.028, 8, 3, { p: [sx * 0.4, 0.02, -0.04] }))              // 涵道
    P(AZ.DARK, prism(8, 0.125, 0.125, 0.012, sx * 0.4, 0.0, -0.04))                   // 桨盘
    P(AZ.CYAN, prism(6, 0.04, 0.04, 0.02, sx * 0.4, 0.005, -0.04))
  }
  P(AZ.DARK, box(0.06, 0.06, 0.3, 0, -0.08, 0.16))                                    // 机炮
  P(AZ.CYAN, gem(0.04, 0, 0.0, 0.27))
  P(AZ.ORANGE, box(0.1, 0.035, 0.03, 0, 0.0, -0.26))
  return out
}

// ------------------------------------------------------------------ 「天钩」防空无人机母机：悬停的四涵道母机 + 三架环飞的子机
export function buildSkyhookCarrier() {
  const rig = new Rig()
  const HY = 1.55, OY = 3.0, OR = 1.25
  rig.bone('root', null, 0, 0, 0).bone('hull', 'root', 0, HY, 0).bone('gun', 'hull', 0, HY + 0.4, -0.3).bone('orbit', 'root', 0, OY, 0)
  for (let k = 0; k < 3; k++) rig.bone('d' + k, 'orbit', cos(k * TAU / 3) * OR, OY, sin(k * TAU / 3) * OR)
  // 机身：俯视是一枚拉长的六边形
  rig.add('hull', AZ.GUN, extrudeY([[0, 1.25], [0.5, 0.7], [0.5, -0.8], [0.3, -1.15], [-0.3, -1.15], [-0.5, -0.8], [-0.5, 0.7]], 0.4, HY - 0.2, { bevel: 0.08 }))
  rig.add('hull', AZ.PLATE, extrudeY([[0, 1.0], [0.34, 0.6], [0.34, 0.1], [-0.34, 0.1], [-0.34, 0.6]], 0.06, HY + 0.2, { bevel: 0.025 }))
  rig.add('hull', AZ.TEAM, slab(0.62, 0.05, 0.7, 0, HY + 0.225, -0.5, { c: 0.035 }))                                   // 子机起降甲板
  rig.add('hull', AZ.CYAN, box(0.4, 0.015, 0.03, 0, HY + 0.255, -0.2), box(0.4, 0.015, 0.03, 0, HY + 0.255, -0.8), box(0.03, 0.015, 0.6, 0, HY + 0.255, -0.5),   // 甲板引导灯
    box(0.24, 0.05, 0.03, 0, HY + 0.02, 1.13, { r: [0, 0, 0] }))                                                                                                // 机首传感器
  rig.add('hull', AZ.DARK, cbox(0.5, 0.2, 0.9, 0, HY - 0.28, 0, { c: 0.05, taper: [1.4, 1.2] }), tube(V3(0.2, HY - 0.3, 0.5), V3(0.2, HY - 0.42, 1.0), 0.035, 0.03, 5), tube(V3(-0.2, HY - 0.3, 0.5), V3(-0.2, HY - 0.42, 1.0), 0.035, 0.03, 5))   // 腹舱 + 双联防空炮
  rig.add('hull', AZ.ORANGE, box(0.3, 0.06, 0.02, 0, HY, -1.16))
  // 四个涵道风扇
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const fx = sx * 1.0, fz = sz * 0.78
    rig.add('hull', AZ.GUN, beam(V3(sx * 0.4, HY, sz * 0.5), V3(fx, HY + 0.02, fz), 0.16, 0.1, { c: 0.025, ref: V3(0, 1, 0) }))
    rig.add('hull', AZ.PLATE, lathe([[0.36, -0.1], [0.43, -0.06], [0.43, 0.08], [0.38, 0.12], [0.36, 0.08], [0.36, -0.1]], 10, { p: [fx, HY + 0.02, fz] }))
    rig.add('hull', AZ.DARK, prism(10, 0.36, 0.36, 0.012, fx, HY - 0.06, fz))                                          // 桨盘
    rig.add('hull', AZ.CYAN, ring(0.3, 0.014, 10, 3, { p: [fx, HY - 0.045, fz] }))                                     // 桨尖辉光
    rig.add('hull', AZ.DARK, prism(6, 0.1, 0.07, 0.14, fx, HY - 0.04, fz), box(0.74, 0.03, 0.06, fx, HY + 0.06, fz), box(0.06, 0.03, 0.74, fx, HY + 0.06, fz))
    rig.add('hull', AZ.TEAM, box(0.2, 0.04, 0.05, fx + sx * 0.36, HY + 0.1, fz))
    rig.add('hull', AZ.DARK, tube(V3(sx * 0.4, HY - 0.25, sz * 0.6), V3(sx * 0.62, HY - 0.75, sz * 0.7), 0.03, 0.025, 4), box(0.08, 0.04, 0.3, sx * 0.62, HY - 0.76, sz * 0.7))   // 起落橇
  }
  // 雷达（gun 骨，一直转）
  rig.add('gun', AZ.GUN, tube(V3(0, HY + 0.2, -0.3), V3(0, HY + 0.5, -0.3), 0.05, 0.04, 6))
  rig.add('gun', AZ.PLATE, box(0.7, 0.2, 0.04, 0, HY + 0.62, -0.3, { taper: [1, 1], r: [-0.25, 0, 0] }))
  rig.add('gun', AZ.ORANGE, gem(0.035, 0, HY + 0.78, -0.3))
  // 子机
  for (let k = 0; k < 3; k++) for (const [zone, g] of droneParts(cos(k * TAU / 3) * OR, OY, sin(k * TAU / 3) * OR, 1.15)) rig.add('d' + k, zone, g)
  const fly = (u, P, tilt, spin) => {
    P.t('hull', 0, 0.07 * sin(u * TAU * 2), 0).r('hull', 0.02 * sin(u * TAU * 2 + 1), 0, 0.025 * sin(u * TAU)).r('gun', 0, u * TAU * spin, 0)
    P.r('orbit', 0, u * TAU, 0)
    for (let k = 0; k < 3; k++) P.t('d' + k, 0, 0.2 * sin(u * TAU * 2 + k * 2.1), 0).r('d' + k, tilt, -u * TAU, 0.12 * sin(u * TAU * 3 + k))   // 子机绕圈但机头始终朝前
  }
  rig.clip('idle', 24, 4.0, true, (u, P) => fly(u, P, 0, 2))
  rig.clip('walk', 24, 4.0, true, (u, P) => { fly(u, P, 0.1, 2); P.r('hull', 0.07, 0, 0) })
  rig.clip('shoot', 24, 2.0, true, (u, P) => { fly(u, P, 0.28, 4); P.s('orbit', 1.2, 1, 1.2) })
  rig.clip('die', 12, 1.1, false, (u, P) => {
    const k = ease(u), f = u * u
    P.t('hull', 0, -1.18 * f, 0).r('hull', 0.25 * k, 0.9 * k, 0.4 * k).t('orbit', 0, -2.75 * f, 0).s('orbit', 1 + k * 0.7, 1, 1 + k * 0.7)
    for (let i = 0; i < 3; i++) P.r('d' + i, 1.3 * k, i, 0.9 * k)
  })
  // orbit：三架子机绕 orbit 骨转（开火时半径 × 1.2），弹道从子机出（squadview.muzzle 按这组参数算当前位置）
  rig.meta = { muzzle: [0, OY, OR], orbit: { n: 3, y: OY, r: OR, shootR: 1.2, bob: 0.2 } }
  return rig
}
