// models/humans/infantry.js —— 第七远征军动力装甲步兵（原创造型，全程序化）
//   buildArmorTrooper({ role })：
//     'rifle'   突击兵     枪灰 + 钴蓝肩甲 + 青色目镜，反应堆背包，重型步枪
//     'flamer'  焚化兵     橙红肩甲、背双燃料罐、双手喷火器、琥珀色防爆目镜
//     'hawk'    「铁砧」霍克上尉  大一圈：金饰边、盔顶鬃冠、左肩加厚、背旗、半披风、轨道重步枪
//     'merc'    「血獒」雇佣兵   红黑涂装（涂装放在 GOLD zone，不会被 squadview 的雇佣兵染色盖掉）、獠牙面罩、肩刺、弹鼓
// 主机位是「从背后俯视」：所以顶面 = 头盔脊 + 两块带亮边的肩甲 + 背包顶，背面 = 背包 + 一道灯。发光件只留很少几处。
import { AZ } from '../../materials.js'
import { Rig, V3, box, cbox, slab, prism, tube, lathe, gem, quad, beam, extrudeX, TAU, sin, cos, bump, ease } from './hkit.js'

const PI = Math.PI

export function buildArmorTrooper(o = {}) {
  const role = o.role || 'rifle'
  const hero = role === 'hawk', merc = role === 'merc', flamer = role === 'flamer'
  const accent = merc ? AZ.GOLD : flamer ? AZ.PAINT : AZ.TEAM            // 肩甲 / 盔脊的涂装
  const trim = hero ? AZ.GOLD : AZ.PLATE                                 // 饰边
  const eye = flamer || merc ? AZ.ORANGE : AZ.CYAN
  const K = flamer ? 1.08 : hero ? 1.06 : 1                              // 躯干宽度系数
  const rig = new Rig()
  rig.bone('root', null, 0, 0, 0).bone('hips', 'root', 0, 0.8, 0).bone('torso', 'hips', 0, 0.94, 0).bone('head', 'torso', 0, 1.36, 0)
    .bone('gun', 'torso', 0.1, 1.08, 0.1)
    .bone('legR', 'hips', 0.19, 0.8, 0).bone('shinR', 'legR', 0.19, 0.5, 0.04)
    .bone('legL', 'hips', -0.19, 0.8, 0).bone('shinL', 'legL', -0.19, 0.5, 0.04)

  // ---- 腿：大靴 + 喇叭口护胫 + 护膝 + 大腿甲 ----
  rig.both('shinR', 'shinL', AZ.GUN,
    cbox(0.25, 0.16, 0.44, 0.19, 0.08, 0.06, { c: 0.04, taper: [0.88, 0.84] }),
    cbox(0.24, 0.36, 0.27, 0.19, 0.31, 0.0, { c: 0.05, taper: [0.8, 0.82] }))
  rig.both('shinR', 'shinL', AZ.PLATE,
    box(0.2, 0.08, 0.13, 0.19, 0.06, 0.27, { taper: [0.8, 0.6] }),                      // 靴头钢包头
    box(0.14, 0.25, 0.05, 0.19, 0.33, 0.135, { taper: [0.7, 1] }),                      // 胫甲中脊
    cbox(0.2, 0.15, 0.15, 0.19, 0.53, 0.1, { c: 0.04 }))                               // 护膝
  rig.both('shinR', 'shinL', AZ.DARK, box(0.16, 0.05, 0.2, 0.19, 0.145, -0.02))         // 踝部软连接
  rig.both('legR', 'legL', AZ.GUN, cbox(0.245, 0.3, 0.28, 0.19, 0.67, 0.0, { c: 0.05, taper: [1.08, 1.04] }))
  rig.both('legR', 'legL', AZ.PLATE, box(0.05, 0.24, 0.22, 0.325, 0.68, 0.0, { taper: [1, 0.8] }))   // 大腿外侧挂甲
  rig.both('legR', 'legL', accent, box(0.17, 0.06, 0.03, 0.19, 0.74, 0.145))            // 大腿前的队色条
  // ---- 骨盆 ----
  rig.add('hips', AZ.DARK, box(0.4, 0.17, 0.26, 0, 0.8, 0))
  rig.add('hips', AZ.PLATE,
    box(0.13, 0.2, 0.08, 0, 0.77, 0.15, { taper: [1.5, 1] }),                           // 裆甲
    cbox(0.5 * K, 0.09, 0.34, 0, 0.905, 0, { c: 0.03 }))                                // 腰带
  rig.add('hips', AZ.GUN, box(0.12, 0.11, 0.08, 0.17, 0.86, -0.2), box(0.12, 0.11, 0.08, -0.17, 0.86, -0.2), box(0.07, 0.12, 0.14, 0.27, 0.84, 0.02), box(0.07, 0.12, 0.14, -0.27, 0.84, 0.02))   // 弹药包
  // ---- 躯干：桶形胸甲，上宽下窄 ----
  rig.add('torso', AZ.DARK, prism(8, 0.19, 0.22, 0.13, 0, 0.94, 0))                    // 腹部软甲
  rig.add('torso', AZ.GUN, cbox(0.54 * K, 0.36, 0.42, 0, 1.2, 0.0, { c: 0.07, taper: [1.14, 1.0] }))
  rig.add('torso', AZ.PLATE,
    cbox(0.4 * K, 0.19, 0.1, 0, 1.23, 0.2, { c: 0.035, taper: [1.12, 0.8] }),           // 胸板
    box(0.28, 0.07, 0.06, 0, 1.07, 0.19, { taper: [1.25, 1] }))                         // 腹板
  rig.add('torso', eye, box(0.05, 0.035, 0.02, 0, 1.24, 0.255))                          // 胸口状态灯
  rig.add('torso', trim, prism(8, 0.2, 0.235, 0.09, 0, 1.36, 0.0))                      // 护颈：头盔陷在里面
  rig.add('torso', AZ.DARK, prism(8, 0.17, 0.17, 0.02, 0, 1.45, 0.0))
  // ---- 背包 ----
  if (flamer) {
    const tank = (x) => lathe([[0.0, 0], [0.11, 0.02], [0.13, 0.06], [0.13, 0.44], [0.09, 0.52], [0.045, 0.54], [0.045, 0.58], [0.0, 0.58]], 8, { p: [x, 0.94, -0.31] })
    rig.add('torso', AZ.GUN, tank(0.145), tank(-0.145))
    for (const x of [0.145, -0.145]) {
      rig.add('torso', AZ.PAINT, lathe([[0.135, 0], [0.135, 0.13]], 8, { p: [x, 1.22, -0.31] }))                      // 罐体上段的警示漆
      rig.add('torso', AZ.PLATE, lathe([[0.137, 0], [0.137, 0.035]], 8, { p: [x, 1.17, -0.31] }), lathe([[0.137, 0], [0.137, 0.035]], 8, { p: [x, 1.0, -0.31] }), lathe([[0.05, 0], [0.05, 0.05]], 6, { p: [x, 1.5, -0.31] }))
    }
    rig.add('torso', AZ.GUN, cbox(0.36, 0.3, 0.1, 0, 1.2, -0.23, { c: 0.02 }), box(0.12, 0.34, 0.1, 0, 1.2, -0.4))
    rig.add('torso', AZ.ORANGE, box(0.06, 0.05, 0.02, 0, 1.3, -0.455))
    rig.add('torso', AZ.DARK, tube(V3(0.2, 1.0, -0.28), V3(0.33, 0.9, 0.0), 0.032, 0.032, 5), tube(V3(0.33, 0.9, 0.0), V3(0.22, 0.94, 0.26), 0.032, 0.032, 5))   // 输油管
  } else {
    rig.add('torso', AZ.GUN, cbox(0.42, 0.4, 0.22, 0, 1.22, -0.31, { c: 0.05, taper: [0.9, 0.85] }))
    rig.add('torso', AZ.PLATE, slab(0.3, 0.04, 0.16, 0, 1.44, -0.31), box(0.24, 0.2, 0.03, 0, 1.2, -0.425))
    rig.add('torso', AZ.DARK, box(0.2, 0.025, 0.1, 0, 1.465, -0.31), box(0.2, 0.03, 0.02, 0, 1.24, -0.445), box(0.2, 0.03, 0.02, 0, 1.18, -0.445))   // 顶部格栅 / 背面散热槽
    rig.add('torso', eye, box(0.16, 0.035, 0.02, 0, 1.31, -0.43))                                                      // 背面只留一道灯
    for (const s of [1, -1]) rig.add('torso', AZ.PLATE, prism(6, 0.06, 0.05, 0.24, s * 0.2, 1.3, -0.36, { r: [-0.2, 0, -s * 0.25] }))   // 两根斜出的排气管
    for (const s of [1, -1]) rig.add('torso', AZ.DARK, prism(6, 0.035, 0.035, 0.02, s * 0.258, 1.525, -0.405, { r: [-0.2, 0, -s * 0.25] }))
    if (merc) rig.add('torso', AZ.GOLD, box(0.26, 0.05, 0.02, 0, 1.12, -0.43))
  }
  // ---- 头盔：矮、宽、陷在护颈里 ----
  rig.add('head', AZ.GUN, cbox(0.245, 0.22, 0.28, 0, 1.47, 0.015, { c: 0.075, taper: [0.84, 0.82] }))
  rig.add('head', accent, box(0.075, 0.03, 0.25, 0, 1.585, 0.0, { taper: [0.8, 0.8] }))                                // 盔顶队色脊
  rig.add('head', AZ.DARK, box(0.11, 0.075, 0.06, 0, 1.405, 0.14, { taper: [0.8, 1] }))                                // 呼吸器
  if (flamer) rig.add('head', eye, box(0.2, 0.075, 0.03, 0, 1.485, 0.145))                                             // 整块防爆目镜
  else if (merc) rig.add('head', eye, box(0.07, 0.035, 0.03, 0.055, 1.49, 0.148, { r: [0, 0, 0.25] }), box(0.07, 0.035, 0.03, -0.055, 1.49, 0.148, { r: [0, 0, -0.25] }))   // 两只斜眼
  else rig.add('head', eye, box(0.18, 0.04, 0.03, 0, 1.49, 0.148), box(0.035, 0.06, 0.03, 0, 1.455, 0.148))            // T 形目镜
  if (merc) {   // 獠牙面罩 + 盔侧翼
    rig.add('head', AZ.PLATE, box(0.03, 0.09, 0.03, 0.05, 1.37, 0.17, { taper: [0.3, 0.3], r: [PI, 0, 0] }), box(0.03, 0.09, 0.03, -0.05, 1.37, 0.17, { taper: [0.3, 0.3], r: [PI, 0, 0] }))
    rig.both('head', 'head', AZ.GOLD, box(0.02, 0.13, 0.2, 0.125, 1.56, -0.05, { taper: [1, 0.35], shear: [0, -0.08] }))
  }
  if (hero) {   // 鬃冠：前后走向的一道高脊，俯视最显眼
    rig.add('head', AZ.GOLD, extrudeX([[0.16, 1.56], [0.13, 1.68], [-0.06, 1.74], [-0.24, 1.66], [-0.2, 1.56]], 0.05, 0, { bevel: 0.012 }))
    rig.add('head', AZ.TEAM, extrudeX([[0.12, 1.69], [-0.06, 1.8], [-0.3, 1.76], [-0.24, 1.66], [-0.06, 1.74]], 0.035, 0))
  }
  // ---- 肩甲：整个剪影里最重要的一块。底座 + 涂装顶板 + 外缘亮边，向外下倾 ----
  const tilt = -0.3
  const pauldron = (sx, big) => {
    const s = big, px = 0.375 * K + (big - 1) * 0.06
    const g = []
    g.push([AZ.GUN, cbox(0.29 * s, 0.2 * s, 0.4 * s, px, 1.33, 0, { c: 0.06, r: [0, 0, tilt] })])
    g.push([accent, slab(0.25 * s, 0.06, 0.34 * s, px + 0.035 * s, 1.33 + 0.122 * s, 0, { c: 0.035, r: [0, 0, tilt] })])
    g.push([trim, box(0.045, 0.07, 0.42 * s, px + 0.142 * s, 1.33 - 0.06 * s, 0, { r: [0, 0, tilt] })])                 // 外缘亮边
    g.push([trim, box(0.2 * s, 0.035, 0.035, px + 0.02, 1.33 + 0.1 * s, 0.19 * s, { r: [0, 0, tilt] })])                // 前缘
    if (merc) g.push([AZ.PLATE, box(0.05, 0.16, 0.05, px + 0.06, 1.52, 0.08, { taper: [0.15, 0.15], r: [0, 0, tilt] })], [AZ.PLATE, box(0.05, 0.16, 0.05, px + 0.06, 1.52, -0.08, { taper: [0.15, 0.15], r: [0, 0, tilt] })])
    for (const [zone, geo] of g) { if (sx < 0) geo.scale(-1, 1, 1), flipWinding(geo); rig.add('torso', zone, geo) }
  }
  pauldron(1, 1); pauldron(-1, hero ? 1.28 : 1)
  if (hero) rig.add('torso', AZ.GOLD, gem(0.05, -0.47, 1.5, 0.0, 1, 1.3, 1))                                           // 左肩军衔钉
  // ---- 手臂 ----
  const gx = flamer ? 0.06 : 0.1, gy = flamer ? 0.98 : 1.05    // 武器轴线
  const eR = V3(0.4 * K, 1.04, 0.06), eL = V3(-0.38 * K, 1.04, 0.2)     // 肘
  rig.add('torso', AZ.DARK, tube(V3(0.37 * K, 1.27, 0), eR, 0.09, 0.08, 6), tube(V3(-0.37 * K, 1.27, 0.02), eL, 0.09, 0.08, 6))
  rig.add('gun', AZ.GUN,
    beam(eR, V3(gx + 0.1, gy - 0.06, 0.3), 0.13, 0.14, { c: 0.03, taper: [0.85, 0.85] }),         // 右前臂护甲：握把
    beam(eL, V3(gx - 0.1, gy - 0.08, 0.56), 0.13, 0.14, { c: 0.03, taper: [0.85, 0.85] }))        // 左前臂：托护木
  rig.add('gun', AZ.DARK, box(0.1, 0.1, 0.11, gx + 0.09, gy - 0.07, 0.33), box(0.1, 0.1, 0.11, gx - 0.09, gy - 0.09, 0.59))   // 手

  // ---- 武器 ----
  let muzzle
  if (flamer) {
    rig.add('gun', AZ.GUN, cbox(0.15, 0.17, 0.5, gx, gy, 0.42, { c: 0.035 }), box(0.07, 0.12, 0.1, gx, gy - 0.13, 0.3, { shear: [0, -0.03] }), box(0.09, 0.1, 0.16, gx, gy + 0.02, 0.1))
    rig.add('gun', AZ.PAINT, lathe([[0.0, 0], [0.075, 0.015], [0.075, 0.27], [0.0, 0.285]], 7, { axis: 'z', p: [gx, gy - 0.145, 0.45] }))      // 下挂燃料瓶
    rig.add('gun', AZ.PLATE, lathe([[0.05, 0], [0.05, 0.3], [0.06, 0.31], [0.11, 0.47], [0.085, 0.48]], 8, { axis: 'z', p: [gx, gy, 0.66] }), box(0.17, 0.035, 0.035, gx, gy + 0.1, 0.5))
    rig.add('gun', AZ.DARK, lathe([[0.072, 0], [0.072, 0.1]], 8, { axis: 'z', p: [gx, gy, 0.72] }), box(0.03, 0.03, 0.34, gx, gy + 0.105, 0.78))   // 隔热套 / 引火管
    rig.add('gun', AZ.ORANGE, gem(0.035, gx, gy + 0.105, 0.98), box(0.025, 0.04, 0.14, gx + 0.08, gy + 0.02, 0.4))
    muzzle = [gx, gy, 1.16]
  } else if (hero) {   // 轨道重步枪：双轨 + 青色能量槽
    rig.add('gun', AZ.GUN, cbox(0.16, 0.22, 0.62, gx, gy, 0.42, { c: 0.04 }), box(0.09, 0.15, 0.13, gx, gy - 0.17, 0.32, { shear: [0, -0.04] }), box(0.11, 0.15, 0.22, gx, gy + 0.01, 0.02))
    rig.add('gun', AZ.PLATE, box(0.045, 0.1, 0.8, gx + 0.055, gy + 0.01, 1.1), box(0.045, 0.1, 0.8, gx - 0.055, gy + 0.01, 1.1), slab(0.13, 0.05, 0.34, gx, gy + 0.135, 0.44))
    rig.add('gun', AZ.CYAN, box(0.05, 0.045, 0.74, gx, gy + 0.01, 1.08), box(0.025, 0.06, 0.26, gx + 0.085, gy, 0.42))
    rig.add('gun', AZ.GOLD, box(0.17, 0.13, 0.05, gx, gy + 0.01, 0.76), box(0.17, 0.13, 0.05, gx, gy + 0.01, 1.47))
    rig.add('gun', AZ.DARK, box(0.08, 0.1, 0.3, gx, gy - 0.12, 0.72))
    muzzle = [gx, gy + 0.01, 1.52]
  } else {
    rig.add('gun', AZ.DARK, cbox(0.13, 0.19, 0.52, gx, gy, 0.42, { c: 0.035 }), box(0.1, 0.13, 0.2, gx, gy + 0.01, 0.07), box(0.06, 0.12, 0.08, gx, gy - 0.14, 0.28, { shear: [0, -0.03] }))
    rig.add('gun', AZ.GUN, merc ? lathe([[0.0, 0], [0.1, 0.01], [0.1, 0.1], [0.0, 0.11]], 8, { axis: 'x', p: [gx - 0.055, gy - 0.17, 0.46] }) : box(0.085, 0.2, 0.13, gx, gy - 0.17, 0.46, { shear: [0, 0.04] }),
       cbox(0.1, 0.1, 0.12, gx, gy + 0.02, 1.13, { c: 0.025 }))
    rig.add('gun', AZ.GUN, cbox(0.1, 0.13, 0.3, gx, gy + 0.015, 0.82, { c: 0.025 }))                                  // 护木 / 枪管套
    rig.add('gun', AZ.DARK, prism(6, 0.035, 0.035, 0.14, gx, gy + 0.02, 0.96, { r: [PI / 2, 0, 0] }))
    rig.add('gun', AZ.PLATE, slab(0.06, 0.045, 0.3, gx, gy + 0.118, 0.44), box(0.03, 0.05, 0.04, gx, gy + 0.11, 0.92))
    rig.add('gun', merc ? AZ.ORANGE : AZ.ORANGE, box(0.02, 0.045, 0.14, gx + 0.068, gy + 0.01, 0.46))       // 弹量灯
    muzzle = [gx, gy + 0.02, 1.2]
  }
  // ---- 英雄：背旗 + 半披风 + 天线 ----
  if (hero) {
    rig.add('torso', AZ.GUN, tube(V3(0.2, 1.4, -0.4), V3(0.2, 2.3, -0.46), 0.022, 0.018, 5))
    rig.add('torso', AZ.TEAM, quad(V3(0.2, 2.26, -0.47), V3(0.2, 1.74, -0.46), V3(0.2, 1.84, -0.84), V3(0.2, 2.26, -0.92)))
    rig.add('torso', AZ.GOLD, gem(0.045, 0.2, 2.34, -0.46), box(0.02, 0.04, 0.46, 0.2, 2.27, -0.69), box(0.014, 0.2, 0.06, 0.2, 2.02, -0.66))
    rig.add('torso', AZ.TEAM, quad(V3(-0.5, 1.3, -0.2), V3(-0.12, 1.34, -0.42), V3(-0.16, 0.5, -0.62), V3(-0.6, 0.56, -0.34)))   // 左肩半披风
    rig.add('torso', AZ.GOLD, quad(V3(-0.6, 0.56, -0.34), V3(-0.16, 0.5, -0.62), V3(-0.16, 0.44, -0.63), V3(-0.61, 0.5, -0.35)))
  }
  if (merc) {   // 腰间的破布
    rig.add('hips', AZ.GOLD, quad(V3(-0.13, 0.86, 0.19), V3(0.13, 0.86, 0.19), V3(0.1, 0.42, 0.24), V3(-0.12, 0.5, 0.24)))
  }

  // ---- 动画 ----
  rig.clip('idle', 8, 2.4, true, (u, P) => {
    const s = sin(u * TAU)
    P.t('torso', 0, 0.008 * s, 0).r('torso', 0.015 * s, 0, 0).r('gun', -0.02 * s, 0, 0).r('head', 0, 0.14 * sin(u * TAU + 1), 0)
  })
  if (flamer) rig.clip('shoot', 8, 0.5, true, (u, P) => {
    const s = sin(u * TAU)
    P.r('torso', 0.07, 0.12 * s, 0).r('gun', 0.04 + 0.015 * sin(u * TAU * 4), 0.1 * s, 0).t('gun', 0, 0.006 * sin(u * TAU * 4), 0.04).r('hips', -0.03, 0, 0).r('legR', -0.1, 0, 0).r('legL', 0.14, 0, 0)
  })
  else rig.clip('shoot', 6, hero ? 0.22 : 0.13, true, (u, P) => {
    const k = (1 - u) * (1 - u)
    P.t('gun', 0, 0.012 * k, -0.07 * k).r('gun', -0.06 * k, 0, 0).r('torso', -0.04 * k, 0, 0).t('torso', 0, 0, -0.014 * k).r('hips', -0.012 * k, 0, 0).r('head', 0.03 * k, 0, 0)
  })
  rig.clip('walk', 10, 0.64, true, (u, P) => {
    const a = u * TAU, s = sin(a), c = cos(a)
    P.r('legR', -0.5 * s, 0, 0).r('legL', 0.5 * s, 0, 0)
    P.r('shinR', 0.55 * Math.max(0, c) + 0.1, 0, 0).r('shinL', 0.55 * Math.max(0, -c) + 0.1, 0, 0)
    P.t('hips', 0, 0.028 * Math.abs(c) - 0.016, 0).r('torso', 0.06, 0.07 * s, 0.02 * c).r('gun', 0.05 * c, 0, 0)
  })
  rig.clip('die', 12, 0.95, false, (u, P) => {
    const hit = bump(u, 0, 0.3), k = ease(Math.max(0, (u - 0.12) / 0.88))
    // 先中弹后仰，膝盖一软，再向后侧倒下
    P.r('torso', -0.35 * hit, 0.25 * hit, 0).r('head', -0.4 * hit - 0.3 * k, 0, 0)
    P.r('root', -1.47 * k, 0.55 * k, 0).t('root', 0, 0.1 * k, -0.3 * k)
    P.r('legR', 0.75 * k, 0, 0.22 * k).r('legL', 0.3 * k, 0, -0.26 * k).r('shinR', 0.9 * k, 0, 0).r('shinL', 0.3 * bump(u, 0.1, 0.7), 0, 0)
    P.r('gun', 1.0 * k, 0.7 * k, 0).t('gun', 0.12 * k, -0.1 * k, 0)
  })
  rig.meta = { muzzle }
  return rig
}

function flipWinding(g) {
  const P = g.attributes.position.array
  for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t }
  g.computeVertexNormals()
}
