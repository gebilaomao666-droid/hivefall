// models/ai/allies.js —— AI 生成（腾讯混元 3D）的我方单位：步兵 / 灵能 / 载具 / 步行机 / 三位指挥官 + 雇佣兵红黑变体。
// 由 register.js 的 registerAI 调用（同一个 ?ai= 开关）。和虫族一样：静态带贴图网格 + 程序化顶点姿态 → 顶点动画贴图。
//
// 质量闸门：每个单位都在战斗主机位和近景下和原程序化模型并排比过（docs/art/ai3-*.jpg），只有「明显更好」的才默认启用（ALLY_ON）。
// 没通过的照样注册在 unit.<kind>@ai 下（?focus= / ?lineup= 能看），默认仍用程序化模型：
//   ?ai=unit.titan           只换这一个（不管它在不在 ALLY_ON 里）
//   ?ai=allies               我方全部换成 AI 模型（包括没通过闸门的），虫族照旧
//   ?ai=noallies             我方全部程序化、虫族照旧（对照用）
//   ?ai=0                    全部退回程序化
//
// 本地坐标：正面朝 +Z、脚底 y = 0、x/z 按包围盒居中（process.py 的约定）。我方在场上朝 −Z 是 squadview 按 unit.facing = π 转出来的。
// 每个模型的选区数字（归一化坐标，见 poses.js）是对着 tools/ai-models 的三视图字符密度图量的，枪口 / 炮口是在网格上找的最前端顶点。
import { compose } from '../../proc/deform.js'
import { turn, move, legs, tremble, squash, topple, ground, above, below, outer, front, all, bump, ramp, ease, wave } from './poses.js'
import { ASSET_ROOT, assetUrl } from '../../base.js'

const DIR = ASSET_ROOT + 'models/ai/'
const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs

/** 默认启用的我方 AI 模型（通过了质量闸门的）。见 docs/RENDER.md §8.6 的逐个结论 */
export const ALLY_ON = new Set(['unit.rifle', 'unit.flamer', 'unit.hero_hawk', 'unit.psion', 'unit.hero_ysera', 'unit.titan', 'unit.reaper', 'unit.hero_joe', 'unit.lancer'])

const C = (name, frames, duration, loop, ...fns) => ({ name, frames, duration, loop, deform: compose(...fns) })
const k0 = (v) => () => v
/** 后坐包络：0 → a 冲到 1，之后指数回落 */
const kick = (u, a = 0.1, k = 9) => (u < 0 ? 0 : u < a ? u / a : Math.exp(-(u - a) * k))
const inv = (w) => (n, u) => 1 - w(n, u)
const band = (a0, a1, b1, b0) => (n) => ramp(a0, a1, n.y) * ramp(b0, b1, n.y)   // 高度 a0→a1 渐入、b1→b0 渐出

// ------------------------------------------------------------------ 包围盒（manifest.json 的 bbox：高归一化为 1，w = 宽 / 高，d = 长 / 高）
const BOX = {
  unit_rifle: [0.5146, 0.9211], unit_rifle_b: [0.4387, 0.7526], unit_flamer: [0.8257, 0.8939], unit_titan: [0.7813, 0.7309],
  unit_mortar: [0.9341, 1.8049], unit_lancer: [0.8663, 2.2495], unit_reaper: [0.8732, 0.66], unit_psion: [0.7648, 0.3328],
  unit_skyhook: [1.4516, 1.0794], hero_hawk: [0.5295, 0.8801], hero_ysera: [0.7532, 0.3096], hero_joe: [0.8846, 0.5823],
}
/** 归一化坐标 → 烘焙后的米（和 bakeGLTF 传给姿态函数的 info 同一套） */
function infoOf(file, height, gs = [1, 1, 1]) { const [w, d] = BOX[file]; const size = [w * height * gs[0], height, d * height * gs[2]]; return { size, min: [-size[0] / 2, 0, -size[2] / 2], max: [size[0] / 2, height, size[2] / 2] } }
/**
 * 枪口：在静止姿势上取一个点（归一化坐标），再按开火 clip 在 u 时刻的姿态变形过去 —— 姿态把胳膊 / 炮管转到哪，枪口就跟到哪。
 * 返回烘焙后模型本地坐标（米）；squadview 再乘实例 scale、按朝向转到世界。
 */
function muzzleOf(file, height, clip, u, pt, gs) {
  const info = infoOf(file, height, gs)
  const p = [pt[0] * info.size[0] / 2, pt[1] * height, info.min[2] + pt[2] * info.size[2]]
  const out = p.slice()
  if (clip) clip.deform(u, p, out, info)
  return out.map((v) => +v.toFixed(3))
}

// ------------------------------------------------------------------ 共用的动作件
/** 走路时上身一颠一颠 + 左右拧（步兵 / 步行机） */
const bobTwist = ({ from = 0.42, bob = 0.012, twist = 0.05, roll = 0.02, cycles = 1 } = {}) => compose(
  move((u, n, d) => { d[1] = bob * abs(sin(u * TAU * cycles)) - bob * 0.5 }, above(from - 0.08, from + 0.06)),
  turn('y', [0, from, 0.4], (u) => twist * wave(u, cycles), above(from, from + 0.2)),
  turn('z', [0, from, 0.4], (u) => roll * wave(u, cycles), above(from - 0.1, from + 0.15)))
/** 呼吸 + 微晃（idle） */
const breatheIdle = ({ from = 0.4, amp = 0.006, sway = 0.025 } = {}) => compose(
  move((u, n, d) => { d[1] = amp * wave(u, 1) }, above(from, from + 0.2)),
  turn('y', [0, from, 0.4], (u) => sway * wave(u, 1, 0.7), above(from, from + 0.25)),
  turn('x', [0, from, 0.4], (u) => sway * 0.4 * wave(u, 1, 1.9), above(from, from + 0.25)))
/** 倒地：先挨一下往后仰，再侧翻瘫下去 */
const dieFall = ({ back = 0.4, roll = 1.45, flat = 0.5, from = 0.3, at = 0.22 } = {}) => compose(
  turn('x', [0, from, 0.4], (u) => -back * bump(u, 0, 0.45), above(from, from + 0.2)),
  topple({ roll, flat, k: (u) => ease((u - at) / (1 - at - 0.08)) }),
  ground())
/** 载具被打爆：一震、往前栽、压扁下沉 */
const dieWreck = ({ pitch = 0.18, roll = 0.22, flat = 0.55 } = {}) => compose(
  tremble({ amp: 0.02, freq: 9, gate: (u) => bump(u, 0, 0.4) }),
  turn('x', [0, 0, 0.5], (u) => pitch * ease(u / 0.6)),
  turn('z', [0, 0, 0.5], (u) => roll * ease((u - 0.1) / 0.6)),
  squash((u) => (1 - flat) * ease((u - 0.2) / 0.7), 0.15),
  ground())

// ------------------------------------------------------------------ 各单位的 clip

// ---- 突击兵：双手平端步枪（枪口在 n = (0.15, 0.80, 1.0)），胳膊和枪在身前 z > 0.45、y 0.62~0.9 ----
const rifleGun = all(front(0.4, 0.52), band(0.6, 0.68, 0.9, 0.95))
const rifleClips = (o = {}) => {
  const gun = o.gun || rifleGun, ph = o.pivot || [0.1, 0.78, 0.36]
  return [
    C('idle', 16, 2.4, true, breatheIdle({ from: 0.45 }), turn('x', ph, (u) => 0.02 * wave(u, 1, 1.2), gun)),
    C('walk', 16, 0.64, true,
      legs({ top: 0.46, inner: 0.06, soft: 0.14, swing: 0.085, lift: 0.04 }),
      bobTwist({ from: 0.46, bob: 0.014, twist: 0.05 }),
      turn('x', ph, (u) => 0.03 * wave(u, 2), gun)),
    // 一个 clip = 一发（shootLoop：squadview 按 clip 时长循环播）：枪和前臂往后顿、枪口上跳、上身跟着晃
    C('shoot', 6, o.shootDur || 0.13, true,
      move((u, n, d) => { d[2] = -(o.recoil ?? 0.03) * kick(u) }, gun),
      turn('x', ph, (u) => -(o.jump ?? 0.05) * kick(u), gun),
      turn('x', [0, 0.46, 0.35], (u) => -0.018 * kick(u, 0.1, 6), above(0.46, 0.62))),
    C('die', 14, 0.95, false, dieFall({ back: 0.45, roll: 1.45, flat: 0.48, from: 0.32 })),
  ]
}
const RIFLE = rifleClips()
const HAWK = rifleClips({ gun: all(front(0.46, 0.56), band(0.56, 0.62, 0.84, 0.9)), pivot: [0.2, 0.7, 0.4], recoil: 0.04, jump: 0.07, shootDur: 0.22 })

// ---- 焚化兵：两条前臂就是两支喷火器，原模型斜向两侧张开 —— 所有 clip 里都先把两臂往里收 0.36 弧度，让火口朝前 ----
const flamerArm = all(outer(0.28, 0.42), band(0.54, 0.6, 0.86, 0.92), front(0.26, 0.38))
const FLAMER_PV = [0.3, 0.73, 0.33]
const flamerAim = (extra = k0(0)) => turn('y', FLAMER_PV, (u) => -0.36 + extra(u), flamerArm, true)
const FLAMER = [
  C('idle', 16, 2.4, true, flamerAim((u) => 0.03 * wave(u, 1)), breatheIdle({ from: 0.45 })),
  C('walk', 16, 0.64, true,
    flamerAim(),
    legs({ top: 0.44, inner: 0.06, soft: 0.14, swing: 0.085, lift: 0.04 }),
    bobTwist({ from: 0.46, bob: 0.014, twist: 0.04 }),
    turn('x', FLAMER_PV, (u) => 0.04 * wave(u, 2), flamerArm, true)),
  // 喷射：两臂再往里收一点并压低、左右交替抖动，上身前倾顶住
  C('shoot', 8, 0.5, true,
    flamerAim((u) => -0.05 + 0.03 * wave(u, 2)),
    turn('x', FLAMER_PV, (u, n) => 0.05 + 0.025 * sin(u * TAU * 4 + (n.side > 0 ? 0 : PI)), flamerArm, true),
    turn('x', [0, 0.46, 0.35], k0(0.05), above(0.46, 0.62)),
    tremble({ amp: 0.003, freq: 8 })),
  C('die', 14, 0.95, false, flamerAim(), dieFall({ back: 0.4, roll: -1.4, flat: 0.5, from: 0.32 })),
]

// ---- 「泰坦」：两臂双管炮（炮口 n = (±0.92, 0.64, 1.0)）+ 两肩双联炮（炮口 (±0.70, 0.965, 0.66)），腿在 y < 0.5 ----
const titanArm = all(outer(0.56, 0.7), band(0.5, 0.56, 0.76, 0.8))
const titanShoulder = all(outer(0.42, 0.52), above(0.84, 0.88))
const titanLeg = all(below(0.52, 0.42), outer(0.06, 0.16))
const TITAN = [
  C('idle', 16, 2.8, true,
    move((u, n, d) => { d[1] = 0.005 * wave(u, 1) }, above(0.4, 0.55)),
    turn('y', [0, 0.5, 0.45], (u) => 0.035 * wave(u, 1, 0.6), above(0.48, 0.6)),
    move((u, n, d) => { d[1] = 0.006 * wave(u, 1, n.side > 0 ? 0 : 2) }, titanArm)),
  C('walk', 16, 1.05, true,
    legs({ top: 0.5, inner: 0.06, soft: 0.1, swing: 0.075, lift: 0.045, mask: titanLeg }),
    bobTwist({ from: 0.5, bob: 0.018, twist: 0.04, roll: 0.025 }),
    move((u, n, d) => { d[2] = 0.01 * sin(u * TAU + (n.side > 0 ? PI : 0)) }, titanArm)),
  // 双臂炮交替后坐（左臂在 u = 0、右臂在 u = 0.5），肩炮跟着各顿一下；机身往后晃
  C('shoot', 12, 0.55, false,
    move((u, n, d) => { d[2] = -0.075 * (n.side < 0 ? kick(u, 0.06, 8) : kick(u - 0.5, 0.06, 8)) }, titanArm),
    move((u, n, d) => { d[2] = -0.045 * (n.side < 0 ? kick(u - 0.25, 0.06, 9) : kick(u - 0.75, 0.06, 9)) }, titanShoulder),
    turn('x', [0, 0.5, 0.45], (u) => -0.03 * (kick(u, 0.06, 6) + kick(u - 0.5, 0.06, 6)), above(0.48, 0.62))),
  C('die', 16, 1.2, false,
    squash((u) => 0.14 * ease(u / 0.4), 0.1),
    turn('x', [0, 0.5, 0.45], (u) => 0.35 * ease((u - 0.1) / 0.5), above(0.45, 0.6)),
    topple({ roll: 1.35, flat: 0.55, k: (u) => ease((u - 0.35) / 0.55) }),
    ground()),
]

// ---- 「雷锤」自行炮：履带车体 + 炮塔，炮管从 (0, 0.75, 0.5) 仰到炮口 (0, 0.91, 1.0)；再抬高 0.35 弧度（原来只仰 15° 左右）----
const mortarBarrel = all(front(0.56, 0.62), above(0.62, 0.7))
const MORTAR_PV = [0, 0.76, 0.56]
const mortarAim = (extra = k0(0)) => turn('x', MORTAR_PV, (u) => -0.35 + extra(u), mortarBarrel)
const MORTAR = [
  C('idle', 10, 1.5, true, mortarAim(), move((u, n, d) => { d[1] = 0.003 * wave(u, 2) }, above(0.1, 0.3))),
  // 行进：车体高频颠簸 + 前后轻晃，履带不动（减面后的负重轮是多边形块，转起来反而难看）
  C('walk', 8, 0.3, true, mortarAim(), move((u, n, d) => { d[1] = 0.006 * abs(sin(u * TAU * 2)) }, above(0.08, 0.3)), turn('x', [0, 0.1, 0.5], (u) => 0.012 * wave(u, 1), above(0.1, 0.3))),
  // 开炮：炮管沿轴线往后坐、整车往后一顿再回弹
  C('shoot', 14, 0.75, false,
    mortarAim((u) => -0.05 * kick(u, 0.05, 5)),
    move((u, n, d) => { const k = kick(u, 0.04, 6); d[2] = -0.09 * k * cos(0.6); d[1] = -0.09 * k * sin(0.6) }, mortarBarrel),
    turn('x', [0, 0, 0.35], (u) => -0.045 * kick(u, 0.05, 5) + 0.012 * bump(u, 0.25, 0.7), above(0.02, 0.2))),
  C('die', 14, 1.0, false, mortarAim((u) => 0.3 * ease(u)), dieWreck({ pitch: 0.1, roll: 0.2, flat: 0.6 })),
]

// ---- 「破城」轨道炮：四足低趴，背上双导轨（炮口 n = (±0.12, 0.74, 1.0)），腿在 |n.x| > 0.5 ----
const lancerRail = all(front(0.5, 0.58), above(0.6, 0.66), (n) => ramp(0.4, 0.3, n.ax))
const lancerLeg = all(outer(0.42, 0.55), below(0.62, 0.5))
const LANCER = [
  C('idle', 16, 3.0, true, move((u, n, d) => { d[1] = 0.006 * wave(u, 1) }, above(0.35, 0.5)), turn('x', [0, 0.6, 0.3], (u) => 0.012 * wave(u, 1, 0.5), above(0.55, 0.65))),
  C('walk', 16, 0.8, true,
    legs({ top: 0.6, inner: 0.45, soft: 0.1, swing: 0.05, lift: 0.045, pairs: 2, mask: lancerLeg }),
    move((u, n, d) => { d[1] = 0.012 * abs(sin(u * TAU * 2)) }, above(0.35, 0.5)),
    turn('z', [0, 0.4, 0.4], (u) => 0.02 * wave(u, 1), above(0.35, 0.5))),
  // 开火：导轨往后猛坐、整个身子往后一沉（四条腿撑住），再缓缓复位
  C('shoot', 12, 0.5, false,
    move((u, n, d) => { d[2] = -0.06 * kick(u, 0.05, 6) }, lancerRail),
    move((u, n, d) => { d[2] = -0.03 * kick(u, 0.05, 5); d[1] = -0.015 * kick(u, 0.05, 5) }, above(0.35, 0.5)),
    turn('x', [0, 0.45, 0.3], (u) => -0.04 * kick(u, 0.05, 5), above(0.42, 0.55))),
  C('die', 14, 1.0, false,
    squash((u) => 0.3 * ease(u / 0.5), 0.25),
    turn('z', [0, 0.3, 0.5], (u) => 0.4 * ease((u - 0.3) / 0.6), above(0.2, 0.4)),
    tremble({ amp: 0.015, freq: 10, gate: (u) => bump(u, 0, 0.5) }),
    ground()),
]

// ---- 「裁决」光束步行机：四条细长高脚（|n.x| > 0.6、脚在四角），机腹吊一门透镜炮（前端 n ≈ (0, 0.54, 0.84)）----
const reaperLeg = all(outer(0.55, 0.68), below(0.82, 0.72))
const reaperLens = all((n) => ramp(0.32, 0.22, n.ax), band(0.38, 0.42, 0.63, 0.67))
const REAPER = [
  C('idle', 16, 3.2, true,
    move((u, n, d) => { d[1] = 0.008 * wave(u, 1) }, above(0.5, 0.7)),
    turn('y', [0, 0.6, 0.5], (u) => 0.08 * wave(u, 1, 0.4), above(0.36, 0.5))),
  C('walk', 16, 1.0, true,
    legs({ top: 0.8, inner: 0.5, soft: 0.12, swing: 0.06, lift: 0.05, pairs: 2, mask: reaperLeg }),
    move((u, n, d) => { d[1] = 0.012 * abs(sin(u * TAU * 2)) - 0.006 }, above(0.5, 0.72)),
    turn('z', [0, 0.7, 0.5], (u) => 0.02 * wave(u, 1), above(0.5, 0.72))),
  // 开火：透镜炮往后顿一下，机身压低吃住后坐
  C('shoot', 14, 0.75, false,
    move((u, n, d) => { d[2] = -0.05 * kick(u, 0.06, 5) }, reaperLens),
    move((u, n, d) => { d[1] = -0.02 * kick(u, 0.08, 4) }, above(0.4, 0.6)),
    turn('x', [0, 0.6, 0.5], (u) => -0.04 * kick(u, 0.06, 5), above(0.38, 0.5))),
  C('die', 16, 1.2, false,
    move((u, n, d) => { d[1] = -0.5 * ease((u - 0.1) / 0.6) * n.y }, above(0.0, 0.8)),
    turn('z', [0, 0.3, 0.5], (u) => 0.3 * ease((u - 0.3) / 0.6)),
    tremble({ amp: 0.012, freq: 10, gate: (u) => bump(u, 0, 0.4) }),
    ground()),
]

// ---- 「扳手」老猫：驾驶舱 + 两腿；+x 一侧是垂下来的钻头臂（肩在 n ≈ (0.75, 0.9, 0.4)，钻头尖 (0.86, 0.17, 0.37)），−x 一侧是三指爪 ----
const joeDrill = all((n) => ramp(0.48, 0.58, n.x), below(0.97, 0.9))
const joeClaw = all((n) => ramp(-0.5, -0.62, n.x), band(0.62, 0.68, 0.95, 1.01))
const JOE_PV = [0.74, 0.88, 0.4]
const joeLeg = all(below(0.55, 0.45), (n) => ramp(0.52, 0.46, n.x))
const drillUp = (a) => turn('x', JOE_PV, a, joeDrill)
const JOE = [
  C('idle', 16, 2.6, true,
    drillUp((u) => -0.25 + 0.04 * wave(u, 1)),
    move((u, n, d) => { d[1] = 0.005 * wave(u, 1) }, above(0.45, 0.6)),
    turn('z', [-0.8, 0.85, 0.7], (u) => 0.05 * wave(u, 1, 1.3), joeClaw)),
  C('walk', 16, 0.9, true,
    drillUp((u) => -0.25 + 0.06 * wave(u, 1)),
    legs({ top: 0.55, inner: 0.02, soft: 0.1, swing: 0.075, lift: 0.045, mask: joeLeg }),
    bobTwist({ from: 0.55, bob: 0.016, twist: 0.035 })),
  // 钻头臂抬到平端朝前（持续光束从钻头尖出），钻头高频震颤；爪子一张一合
  C('shoot', 10, 0.5, true,
    drillUp((u) => -1.2 + 0.02 * wave(u, 4)),
    tremble({ amp: 0.004, freq: 12 }),
    turn('z', [-0.8, 0.85, 0.7], (u) => 0.12 * wave(u, 2), joeClaw),
    turn('x', [0, 0.55, 0.45], k0(-0.03), above(0.55, 0.7))),
  C('die', 14, 1.1, false, drillUp((u) => -0.25 + 0.4 * ease(u)), squash((u) => 0.12 * ease(u / 0.4), 0.1), topple({ roll: -1.35, flat: 0.55, k: (u) => ease((u - 0.3) / 0.6) }), ground()),
]

// ---- 灵能者：长袍把两腿连成一片（迈不了腿）→ 整个人离地悬浮 HOVER，走路 = 前倾滑行；两臂向两侧张开（手 n ≈ (±0.98, 0.6, 0.92)）----
const HOVER = 0.08
const lift = (amp = 0.012, ph = 0) => move((u, n, d) => { d[1] = HOVER + amp * wave(u, 1, ph) })
const psionArm = all(outer(0.34, 0.5), band(0.52, 0.56, 0.72, 0.78))
const PSION_PV = [0.32, 0.66, 0.5]
const robe = below(0.45, 0.05)
const PSION = [
  C('idle', 16, 3.2, true, lift(0.015), turn('z', PSION_PV, (u) => 0.06 * wave(u, 1), psionArm, true), move((u, n, d) => { d[0] = 0.01 * wave(u, 1, n.y * 3) }, robe)),
  C('walk', 16, 3.2, true, lift(0.012), turn('x', [0, 0.1, 0.5], k0(0.1)), move((u, n, d) => { d[2] = -0.04 * (1 - n.y / 0.45) }, robe), turn('z', PSION_PV, (u) => 0.12 + 0.04 * wave(u, 2), psionArm, true)),
  // 施法：两臂往前合拢、举到胸前，猛地前推
  C('shoot', 14, 0.9, false,
    lift(0.01),
    turn('y', PSION_PV, (u) => -0.9 * ramp(0, 0.3, u) * ramp(1, 0.75, u), psionArm, true),
    turn('z', PSION_PV, (u) => -0.15 * ramp(0, 0.3, u) * ramp(1, 0.75, u), psionArm, true),
    move((u, n, d) => { d[2] = 0.05 * bump(u, 0.3, 0.7) }, psionArm),
    turn('x', [0, 0.1, 0.5], (u) => -0.06 * bump(u, 0.1, 0.9))),
  C('die', 14, 1.1, false, lift(0), dieFall({ back: 0.3, roll: 1.4, flat: 0.45, from: 0.3, at: 0.25 })),
]

// ---- 「棱镜」伊瑟拉：A 字站姿、右手（−x 侧）竖握长矛（矛尖 n ≈ (−0.96, 1.0, 0.83)）、背后六片刃翼 ----
const yseraWing = all(front(0.5, 0.3), above(0.45, 0.55), outer(0.12, 0.3))
const yseraSpear = all((n) => ramp(-0.5, -0.62, n.x), front(0.45, 0.6))
const YSERA_PV = [-0.55, 0.66, 0.6]
const YSERA = [
  C('idle', 16, 3.2, true, breatheIdle({ from: 0.5 }), turn('z', [0, 0.72, 0.2], (u) => 0.08 * wave(u, 1), yseraWing, true)),
  C('walk', 16, 0.9, true,
    legs({ top: 0.46, inner: 0.03, soft: 0.1, swing: 0.07, lift: 0.035, mask: (n) => ramp(-0.5, -0.4, n.x) }),
    bobTwist({ from: 0.48, bob: 0.012, twist: 0.04 }),
    turn('z', [0, 0.72, 0.2], (u) => 0.05 + 0.06 * wave(u, 2), yseraWing, true)),
  // 施法：刃翼猛地张开、长矛往前压（矛尖朝前下方指向目标）
  C('shoot', 14, 0.9, false,
    turn('z', [0, 0.72, 0.2], (u) => -0.25 * bump(u, 0, 0.8), yseraWing, true),
    turn('x', YSERA_PV, (u) => 0.55 * ramp(0, 0.25, u) * ramp(1, 0.7, u), yseraSpear),
    turn('x', [0, 0.45, 0.5], (u) => 0.05 * bump(u, 0.1, 0.8), above(0.45, 0.6))),
  C('die', 14, 1.1, false, turn('z', [0, 0.72, 0.2], (u) => 0.4 * ease(u), yseraWing, true), dieFall({ back: 0.35, roll: 1.4, flat: 0.45, from: 0.34 })),
]

// ---- 「天钩」：四涵道无人机，悬停在 SKY_Y 米；机腹挂舱前端两门小炮（n ≈ (±0.11, 0.41, 1.0)）----
const SKY_Y = 1.25
const hover = (amp, ph = 0) => move((u, n, d) => { d[1] = amp * wave(u, 1, ph) })
const skyFan = all(outer(0.5, 0.62))
function skyLift() { return (u, p, out) => { out[1] += SKY_Y } }
const SKYHOOK = (height) => [
  C('idle', 16, 4.0, true, skyLift(height), hover(0.03), turn('z', [0, 0.4, 0.5], (u) => 0.03 * wave(u, 1, 1.1)), turn('x', [0, 0.4, 0.5], (u) => 0.025 * wave(u, 1, 0.3)), turn('x', [0.8, 0.45, 0.62], (u, n) => 0.05 * wave(u, 2, n.side), skyFan)),
  C('walk', 16, 4.0, true, skyLift(height), hover(0.03), turn('x', [0, 0.4, 0.5], k0(0.08)), turn('z', [0, 0.4, 0.5], (u) => 0.04 * wave(u, 1))),
  // 开火（循环）：机头压低对准、两门炮轮流顿
  C('shoot', 12, 0.8, true, skyLift(height), hover(0.015), turn('x', [0, 0.4, 0.5], (u) => 0.12 + 0.015 * wave(u, 4)), move((u, n, d) => { d[2] = -0.012 * (n.side > 0 ? kick((u * 2) % 1) : kick((u * 2 + 0.5) % 1)) }, all(front(0.8, 0.9), below(0.5, 0.45)))),
  C('die', 14, 1.1, false, (u, p, out) => { out[1] += SKY_Y * (1 - ease(u / 0.75)) }, turn('z', [0, 0.4, 0.5], (u) => 1.2 * ease(u)), turn('x', [0, 0.4, 0.5], (u) => 0.5 * ease(u)), tremble({ amp: 0.02, freq: 12, gate: (u) => bump(u, 0, 0.6) }), ground()),
]

// ------------------------------------------------------------------ 注册
const UNIT = { idle: 'idle', shoot: 'shoot', walk: 'walk', die: 'die' }
/** 我方贴图材质：贴图的钢灰主甲 + 钴蓝点缀（队色区略提饱和）、冷色边缘光和可读性补光比虫高一档；受击 / 开火照亮 / 英雄级染色走 ally 语义（默认值见 materials.js，RENDER.md §10.1） */
const ALLY = (o = {}) => ({ type: 'textured', team: 'armor', gain: 0.88, emissive: 1.1, rimGain: 0.36, fill: 0.28, env: 0.5, roughness: 1.6, ...o, ally: { ...(o.ally || {}) } })   // fill 0.36 → 0.28、rim 0.42 → 0.36：补光太平会把明暗吃掉
/** 步兵：主机位下只有 30 像素高 —— 边缘光压低（细胳膊细腿一圈亮边会糊成一片白）。
 *  不再「朝上 / 朝后的面整片刷队色」（测试：纯蓝塑料小人）：钢灰主甲 + 贴图自带的钴蓝肩甲 / 臂甲 + 青色灯，
 *  只把头盔顶 / 肩甲顶这类很平的顶面轻刷一层钴蓝（topTeam 0.45），主机位下仍一眼是蓝色队色，但有明暗和甲片细节 */
// 再收：测试「正常视距下整片淡蓝白、发虚，对比度低」。主甲不再往浅海军蓝拉（navy 0.4 → 0.1），改成压暗 + 拉开明暗的枪灰（steel / steelCon），
// 顶面刷蓝减到 0.3，钴蓝块本身更饱和、带一点自发光（teamGain / teamEmit 上调）——暗底亮色块，和参考 038 的陆战队一个读法
const INF = { rimGain: 0.18, fill: 0.2, env: 0.3, ally: { topTeam: 0.3, topFrom: 0.6, topTo: 0.92, teamSat: 1.6, cobalt: 0.72, teamGain: 1.5, teamEmit: 0.4, navyDark: 0.72, navy: 0.1, steel: 0.6, steelCon: 1.3, steelDesat: 0.85 } }
/** 载具 / 机甲：贴图大面积是浅蓝灰的板，主机位下一团淡蓝；同样压成枪灰（只剩肩甲 / 条纹的钴蓝）。
 *  那层「淡蓝白」大半其实是金属贴图反射偏蓝的环境图（反照率压到接近黑，顶面仍是淡蓝白）：环境反射 0.5 → 0.2 */
const HEAVY = { env: 0.2, ally: { steel: 0.55, steelCon: 1.15, steelPivot: 0.4, steelDesat: 0.7, steelAll: 1.0, teamPale: 0.85, emitGate: 1.0, navy: 0.08, teamGain: 1.25, teamEmit: 0.26 } }
// 红色轮廓光 0.2 + 队色区自发光 0.15 = 整只泛红光（测试「像受击变红」）。改成冷钢色的细轮廓光、队色区（暗红点缀）不发光
const MERC = (o = {}) => ALLY({ ...o, rim: 0x9aa4b4, rimGain: 0.12, ally: { ...(o.ally || {}), merc: true, teamEmit: 0 } })

/**
 * 每一项：file = glb 名；height = 烘成多高（米，≈ 程序化模型的实际高度）；clips；muzzle = [clip 名, u, [n.x, n.y, n.z]] 或多个（双联）；
 * anim / shadow / capacity 照抄程序化那一项（squadview 读的表现参数不变）
 */
const SPEC = {
  rifle: { file: 'unit_rifle', portrait: { bust: true, zoom: 1.35, cz: -0.28 },  height: 2.34, gs: [1.0, 1, 1.0],   /* 1.8 → 2.34（×1.3，单兵偏小）；横向加粗收回 1.14 → 1.0，配合列距 0.76 → 0.88，肩宽 / 列距之比和原来持平 */   /* 1.5 → 1.68；兵体型偏细、间距偏大：1.68 → 1.8 + 横向加粗 14%（肩宽 ≈ 1.06 米，列距 0.94 米：肩甲 / 背包刚好相接，枪在身前不穿插） */ clips: RIFLE, mz: [['shoot', 0.5, [0.147, 0.798, 0.998]]], mat: { key: 'aU1', ...INF }, shadow: { cast: true, blob: [1.3, 1.4, 0.55, 2] }, capacity: 128, anim: { shootLoop: true, shootHold: 0.3 } },
  // 突击兵备选（同一次生成的另一个候选：钴蓝更多，但步枪收在胸前、手臂贴身）：只注册 unit.rifle_b@ai 供对比
  rifle_b: { alt: true, file: 'unit_rifle_b', height: 1.5, clips: RIFLE, mz: [['shoot', 0.5, [0.111, 0.795, 0.99]]], mat: { key: 'aU1b', ...INF }, shadow: { cast: true, blob: [1.05, 1.1, 0.55, 2] }, capacity: 128, anim: { shootLoop: true, shootHold: 0.3 } },
  flamer: { file: 'unit_flamer', portrait: { bust: true, zoom: 1.35, cz: -0.25 },  height: 2.2, clips: FLAMER, mz: [['shoot', 0.5, [0.965, 0.681, 0.981]], ['shoot', 0.5, [-0.914, 0.678, 0.953]]], mat: { key: 'aU2', ...INF }, shadow: { cast: true, blob: [1.45, 1.5, 0.55, 2] }, capacity: 48, anim: { shootLoop: true, shootHold: 0.5 } },
  hero_hawk: { file: 'hero_hawk', portrait: { bust: true, zoom: 1.38, cz: -0.4 },  height: 2.9, clips: HAWK, mz: [['shoot', 0.5, [0.296, 0.721, 1.0]]], mat: { key: 'aU3', rim: 0x49d8ff, ally: { teamEmit: 0.3, khakiTo: 1.05, khakiSteel: 0.6, topTeam: 0.5, topFrom: 0.5, topTo: 0.9 } }   /* 背后那片褐色披风在主机位下占了一大半：压成偏冷的深钢色（khakiSteel），顶面轻刷队色 */, shadow: { cast: true, blob: [1.7, 1.7, 0.5, 2] }, capacity: 2, anim: { shootLoop: true, shootHold: 0.4 }, hero: true },
  psion: { file: 'unit_psion', portrait: { bust: true, zoom: 1.35 },  height: 2.3, clips: PSION, mz: [['shoot', 0.45, [0.981, 0.605, 0.924]], ['shoot', 0.45, [-0.981, 0.605, 0.924]]], mat: { key: 'aU4', rim: 0x8a7dff }, shadow: { cast: true, blob: [1.4, 1.4, 0.4, 2] }, capacity: 12, anim: { shootDur: 0.9 } },
  hero_ysera: { file: 'hero_ysera', portrait: { bust: true, zoom: 1.3 },  height: 3.0, clips: YSERA, mz: [['shoot', 0.4, [-0.958, 1.0, 0.834]]], mat: { key: 'aU5', rim: 0xb49bff, side: 'double', ally: { navy: 0.25 } }, shadow: { cast: true, blob: [1.8, 1.8, 0.4, 2] }, capacity: 2, anim: { shootDur: 0.9 }, hero: true },
  mortar: { file: 'unit_mortar', height: 2.4, clips: MORTAR, mz: [['shoot', 0.5, [-0.015, 0.913, 0.996]]], mat: { key: 'aU6', ...HEAVY }, shadow: { cast: true, blob: [2.7, 4.2, 0.6, 5, 0.04, 0] }, capacity: 12, anim: { shootDur: 0.75, turn: 6 } },
  lancer: { file: 'unit_lancer', height: 2.5, clips: LANCER, mz: [['shoot', 0.5, [0.0, 0.742, 1.0]]], mat: { key: 'aU7', ...HEAVY }, shadow: { cast: true, blob: [3.2, 3.4, 0.5, 3] }, capacity: 10, anim: { shootDur: 0.5, turn: 6 } },
  titan: { file: 'unit_titan', height: 3.4, clips: TITAN, mz: [['shoot', 0.45, [-0.915, 0.64, 1.0]], ['shoot', 0.95, [0.918, 0.633, 0.998]]], mat: { key: 'aU8', env: 0.2, ally: { ...HEAVY.ally, teamPale: 0.85, teamPaleSat: 1.3, teamPaleL: 0.03 }   /* 泰坦的贴图是大面积亮钴蓝：亮的那些一律归主甲，蓝只留暗部和条纹 */, emissiveFx: 'totalEmissiveRadiance *= mix(1.0, 0.3, smoothstep(0.68, 0.74, vObj.y / 3.4) * (1.0 - smoothstep(0.12, 0.17, abs(vObj.x) / 3.4)));'   /* 驾驶舱玻璃被抠成了整块发光：压到三成 */ }, shadow: { cast: true, blob: [3.6, 3.0, 0.55, 4] }, capacity: 10, anim: { shootDur: 0.55, turn: 5 } },
  reaper: { file: 'unit_reaper', height: 3.3, clips: REAPER, mz: [['shoot', 0.5, [0.0, 0.535, 0.84]]], mat: { key: 'aU9', ...HEAVY }, shadow: { cast: true, blob: [3.8, 3.6, 0.4, 3] }, capacity: 10, anim: { shootDur: 0.75, turn: 5 } },
  hero_joe: { file: 'hero_joe', height: 3.0, clips: JOE, mz: [['shoot', 0.5, [0.864, 0.171, 0.367]]], mat: { key: 'aUJ', ally: { teamSat: 1.0, navy: 0.0, teamEmit: 0.2 } }, shadow: { cast: true, blob: [3.0, 2.8, 0.55, 4] }, capacity: 2, anim: { shootLoop: true, shootHold: 0.5, turn: 5 }, hero: true },
  skyhook: { file: 'unit_skyhook', height: 1.6, clips: SKYHOOK(1.6), mz: [['shoot', 0.25, [0.111, 0.41, 0.999]], ['shoot', 0.75, [-0.119, 0.419, 0.995]]], mat: { key: 'aUS', ...HEAVY }, shadow: { cast: true, blob: [3.0, 3.0, 0.4, 3] }, capacity: 10, anim: { shootLoop: true, shootHold: 0.8, turn: 0 } },
}
// 雇佣兵红黑变体：同一个模型 + 红黑调色（kind = rifle / mortar / titan + unit.elite）。scale 相对本兵种 ≈ 程序化那边两项的比例
const MERCS = { merc_bloodhound: ['rifle', 1.15], merc_hammer: ['mortar', 1.0], merc_goliath: ['titan', 0.935], goliath: ['titan', 0.935] }

/**
 * add(name, def, force)：register.js 里的注册函数（force = 不看 ?ai= 的名单）。sw = aiSwitch() 的结果（true 或 Set）。
 * 返回实际顶替了程序化模型的逻辑名。
 */
export function registerAllies(add, sw) {
  let q = null
  try { q = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('ai') } catch (e) { /* 不在浏览器里 */ }
  const noAllies = q === 'noallies'   // ?ai=noallies：虫族照旧用 AI 模型、我方全部程序化（和 ?ai=allies 对照截图 / 测性能用）
  const want = (name) => (noAllies ? false : sw === true ? ALLY_ON.has(name) : sw.has(name) || sw.has('allies'))
  const done = []
  for (const kind in SPEC) {
    const s = SPEC[kind], name = 'unit.' + kind
    const clipByName = Object.fromEntries(s.clips.map((c) => [c.name, c]))
    const muzzles = s.mz.map(([c, u, pt]) => muzzleOf(s.file, s.height, clipByName[c], u, pt, s.gs))
    const def = {
      source: { gltf: DIR + s.file + '.glb', bake: { height: s.height, smooth: true, clips: s.clips, ...(s.gs ? { globalScale: s.gs } : {}) } },
      clips: UNIT, material: ALLY(s.mat), shadow: s.shadow, capacity: s.capacity, anim: s.anim, hero: !!s.hero,
      meta: muzzles.length > 1 ? { muzzle: muzzles[0], muzzles } : { muzzle: muzzles[0] },
      portrait: s.portrait,
    }
    // 质量闸门：通过的（ALLY_ON）或 URL 点名的才顶替程序化模型；另外总是注册一份 unit.<kind>@ai（preload: false），?lineup= 并排对比用
    const on = !s.alt && want(name)
    add(name + '@ai', { ...def, preload: false, label: name }, true)
    if (on) { add(name, def, true); done.push(name) }
    for (const m in MERCS) {
      if (MERCS[m][0] !== kind) continue
      const mname = 'unit.' + m
      // 歌利亚（泰坦底）：红漆只上最饱和的条纹、亮度减半——整台机甲大面积刷红太抢眼
      const mm = kind === 'titan' ? { ...s.mat, key: s.mat.key + 'R2', ally: { ...(s.mat.ally || {}), mercT: 0.42, mercRed: 0.7 } } : { ...s.mat, key: s.mat.key + 'R' }
      const mdef = { ...def, material: MERC(mm), scale: MERCS[m][1], hero: false, capacity: m === 'merc_bloodhound' ? 24 : m === 'merc_hammer' ? 6 : 2 }
      add(mname + '@ai', { ...mdef, preload: false, label: mname }, true)
      if (on || want(mname)) { add(mname, mdef, true); done.push(mname) }
    }
  }
  return done
}
