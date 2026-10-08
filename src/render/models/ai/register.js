// models/ai/register.js —— AI 生成（腾讯混元 3D）的带贴图模型：中大型虫 + 三个 Boss 的全部注册项。
// assets.js 只调用一次 registerAI(...)，放在程序化敌方注册之后：这里后注册的同名项覆盖掉程序化模型。
//
// 总开关（退回程序化模型，对比 / 兜底用）：
//   · URL 带 ?ai=0                      只这一次关掉
//   · 把下面的 AI_MODELS 改成 false      整个关掉
//   · ?ai=enemy.hulk,boss.ravager       只换这几个（其余保持程序化），逐个对比时用
//   · ?ai=allies / ?ai=unit.titan       我方：全部 / 只这一个换成 AI 模型（默认只启用 allies.js 里 ALLY_ON 名单上的，见那边的说明）
//
// 模型文件在 assets/models/ai/（manifest.json 有面数 / 包围盒；都已归一化：脚底 y = 0、x/z 居中、高 1、面朝 +Z、四张贴图、没有骨骼）。
// 动画全部是「程序化顶点姿态」（proc/deform.js + ./poses.js），烘焙时逐帧逐顶点算好写进顶点动画贴图，运行时和别的单位走同一条实例化管线。
// 小型海量虫（ling / burster / leaper）不换：3400 只的量级只能用几百面的专用低模。
import { compose, undulate, emerge, breathe } from '../../proc/deform.js'
import { registerAllies } from './allies.js'
import { turn, move, swell, curl, legs, tremble, squash, topple, ground, above, below, outer, front, all, bump, ramp, ease, wave } from './poses.js'
import { ASSET_ROOT, assetUrl } from '../../base.js'

export const AI_MODELS = true

const DIR = ASSET_ROOT + 'models/ai/'
const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos

/** 读开关：false = 全关；true = 全开；Set = 只开这几个逻辑名 */
export function aiSwitch() {
  if (!AI_MODELS) return false
  let v = null
  try { v = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('ai') } catch (e) { /* 不在浏览器里 */ }
  if (v === null || v === '' || v === '1' || v === 'noallies') return true
  if (v === '0') return false
  return new Set(v.split(','))
}

const C = (name, frames, duration, loop, ...fns) => ({ name, frames, duration, loop, deform: compose(...fns) })
const k0 = (v) => () => v

// ------------------------------------------------------------------ 材质
// 贴图全部取 glb 自己的（baseColor / normal / metalRoughness / emissive）。这里只给着色参数：
//   gain      贴图亮度倍率（混元的贴图偏亮偏艳，主机位下要压到和桥面、程序化小虫一个调子）
//   emissive  自发光贴图的倍率（眼睛 / 腺体；> 1.6 左右 Bloom 就开始糊）
//   colorFx   一段 GLSL：采样完 baseColor 之后改 diffuseColor.rgb（举盾虫的盾、卵壳、蠕虫脚下那摊泥都靠它压色）
//   roughness 粗糙度贴图的倍率：混元导出的粗糙度平均只有 0.13~0.27（镜面一样，整个身子反射天空，发白发塑料），乘 2.6 拉回「湿润的甲壳」
/** 渊噬蠕虫的颈背 / 头罩：贴图里是一整段暗灰的光皮，换成暗红褐的斑驳肉甲（下半身的甲环本来就是暗红，不动） */
const wormFx = /* glsl */`
  {
    // 贴图的颈背是暗灰（线性亮度只有 0.05~0.15，boneFx 的亮度门槛够不着 —— 这就是之前「染色没生效、在火光下发白发粉」的原因）：
    // 低饱和的像素按自己的亮度换成暗红褐（亮度约为原来的 0.65 倍），再用贴图绿通道放大当脏污 / 斑驳
    vec3 c0 = diffuseColor.rgb;
    float l0 = dot(c0, vec3(0.3, 0.59, 0.11));
    float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b));
    float st = (mx - mn) / max(mx, 1e-3);
    float kk = (1.0 - smoothstep(0.3, 0.55, st)) * (1.0 - smoothstep(0.22, 0.4, l0));   // 牙齿 / 口腔边缘更亮：保留骨白
    #ifdef USE_MAP
      float g1 = texture2D(map, vMapUv * 3.7 + 0.13).g, g2 = texture2D(map, vMapUv * 11.3 + 0.57).g;
    #else
      float g1 = 0.5, g2 = 0.5;
    #endif
    float mottle = clamp((g1 * 0.6 + g2 * 0.4) * 9.0 - 0.35, 0.0, 1.0);
    vec3 flesh = vec3(0.50, 0.10, 0.065) * l0 * 1.35 * mix(0.5, 1.15, mottle);   // 暗红褐（和下半身甲环同一个调子，别再是粉橙）
    diffuseColor.rgb = mix(c0, flesh, kk);
    diffuseColor.rgb *= mix(0.3, 1.0, smoothstep(0.4, 1.6, vObj.y));    // 贴地那摊泥 / 破口压暗
  }`
const TEX = (o = {}) => ({ type: 'textured', gain: 0.8, emissive: 1.25, rimGain: 0.2, fill: 0.15, env: 0.45, roughness: 2.6, ...o })

/**
 * 「亮而不饱和」的像素 = 贴图里的白色骨板 / 白壳 / 灰泥：整体染成 tint 并压暗，再叠一层脏污（贴图自己的绿通道放大几倍当噪声 + 往下越脏）。
 *   maxY > 0：只处理这个高度（米）以下的部分；lowDark 0..1：贴地的一截整体再压暗多少（蠕虫脚下那摊泥）
 *   tint [r, g, b] 线性空间；lum [a, b] 亮度从 a 到 b 渐入；sat [a, b] 饱和度从 a 到 b 渐出；grime 0..1 脏污强度；amount 总强度
 */
const boneFx = ({ tint = [0.30, 0.22, 0.12], lum = [0.18, 0.5], sat = [0.18, 0.45], grime = 0.6, amount = 1, height = 1, maxY = 0, lowDark = 0 } = {}) => /* glsl */`
  {
    vec3 c0 = diffuseColor.rgb;
    float l0 = dot(c0, vec3(0.3, 0.59, 0.11));
    float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b));
    float st = (mx - mn) / max(mx, 1e-3);
    float kk = smoothstep(${lum[0].toFixed(3)}, ${lum[1].toFixed(3)}, l0) * (1.0 - smoothstep(${sat[0].toFixed(3)}, ${sat[1].toFixed(3)}, st)) * ${amount.toFixed(3)}${maxY ? ` * (1.0 - smoothstep(${(maxY * 0.6).toFixed(3)}, ${maxY.toFixed(3)}, vObj.y))` : ''};
    #ifdef USE_MAP
      float g1 = texture2D(map, vMapUv * 3.7 + 0.13).g, g2 = texture2D(map, vMapUv * 9.1 + 0.57).g;
    #else
      float g1 = 0.5, g2 = 0.5;
    #endif
    float dirt = clamp((g1 * 0.65 + g2 * 0.35) * 1.6 - 0.25, 0.0, 1.0);                      // 0 = 脏，1 = 干净
    float low = 1.0 - smoothstep(0.0, ${(0.55 * height).toFixed(3)}, vObj.y);                 // 贴地的一截更脏（泥、血）
    float gr = ${grime.toFixed(3)} * clamp(1.0 - dirt + low * 0.55, 0.0, 1.0);
    vec3 bone = vec3(${tint.map((v) => v.toFixed(3)).join(', ')}) * (0.22 + 1.05 * l0 * l0);   // 保留贴图自己的明暗（裂纹、划痕、边缘）
    bone = mix(bone, bone * vec3(0.46, 0.36, 0.28), gr);
    diffuseColor.rgb = mix(c0, bone, kk);
    ${lowDark ? `diffuseColor.rgb *= mix(${(1 - lowDark).toFixed(3)}, 1.0, smoothstep(${(0.45 * height).toFixed(3)}, ${(1.1 * height).toFixed(3)}, vObj.y));` : ''}
  }`

// ------------------------------------------------------------------ 动作
// 选区（归一化坐标，见 poses.js）。每个模型的数字都是对着 docs/art/ai-*.jpg 的三视图量出来、再在 ?focus= 里看着调的。

// ---- 巨畸体：直立、驼背、两条垂到膝盖的巨拳（|n.x| 0.45 以外是胳膊和拳头，以内是腿和躯干）----
const hulkArm = (n) => { const b = 0.43 - 0.07 * ramp(0.4, 0.5, n.y); return ramp(0.8, 0.68, n.y) * ramp(b, b + 0.045, n.ax) }
const hulkLeg = (n) => 1 - hulkArm(n)
const HULK = [
  C('walk', 16, 1.2, true,
    legs({ top: 0.42, inner: 0.03, soft: 0.1, swing: 0.085, lift: 0.035, mask: hulkLeg }),
    legs({ top: 0.7, inner: 0.25, soft: 0.05, swing: 0.06, lift: 0.012, phase: PI, mask: hulkArm }),
    curl({ from: 0.38, fwd: (u) => 0.05 + 0.04 * wave(u, 2), side: (u) => 0.05 * wave(u, 1) }),
    turn('y', [0, 0.5, 0.5], (u) => 0.1 * wave(u, 1), above(0.4, 0.62)),
    move((u, n, d) => { d[1] = 0.016 * wave(u, 2, 0.6) }, above(0.12, 0.35))),
  // 双拳举过头 → 整个上身砸下去
  C('attack', 14, 1.0, false,
    // 手臂只小幅抬起：减面之后拳头和腿之间有粘连的面，抬太高会扯出一根刺；动作主要靠上身后仰再砸下
    turn('x', [0.7, 0.8, 0.5], (u) => -0.55 * ramp(0, 0.42, u) * ramp(0.62, 0.5, u) - 0.3 * ramp(0.46, 0.6, u) * ramp(1, 0.8, u), hulkArm, true),
    curl({ from: 0.3, fwd: (u) => -0.42 * ramp(0, 0.4, u) * ramp(0.6, 0.48, u) + 0.85 * ramp(0.46, 0.6, u) * ramp(1, 0.8, u), pow: 1.2 }),
    squash((u) => 0.08 * ramp(0.5, 0.62, u) * ramp(1, 0.8, u)),
    ground()),
  // 跪倒 → 侧翻
  C('die', 14, 1.1, false,
    curl({ from: 0.3, fwd: (u) => 0.55 * ramp(0, 0.5, u) }),
    squash((u) => 0.12 * ramp(0, 0.4, u), 0.1),
    topple({ roll: 1.4, flat: 0.62, k: (u) => ease((u - 0.3) / 0.62) })),
]

// ---- 甲壳兽：六足重甲甲虫 ----
const CRUSHER = [
  C('walk', 16, 0.8, true,
    legs({ top: 0.46, inner: 0.3, soft: 0.15, swing: 0.11, lift: 0.05, pairs: 3 }),
    move((u, n, d) => { d[1] = 0.014 * wave(u, 2) }, above(0.2, 0.45)),
    turn('z', [0, 0.3, 0.5], (u) => 0.035 * wave(u, 1), above(0.25, 0.5)),
    turn('y', [0, 0.4, 0.55], (u) => 0.05 * wave(u, 1, 0.8), front(0.62, 0.85))),
  // 压低 → 猛地前顶
  C('attack', 12, 0.7, false,
    move((u, n, d) => { d[2] = -0.12 * bump(u, 0, 0.5) + 0.34 * bump(u, 0.36, 1); d[1] = -0.04 * bump(u, 0, 0.5) }, above(0.04, 0.4)),
    turn('x', [0, 0.3, 0.45], (u) => -0.1 * bump(u, 0, 0.5) + 0.16 * bump(u, 0.36, 1), above(0.2, 0.45)),
    swell([0, 0.45, 1.0], 0.5, (u) => 0.12 * bump(u, 0.3, 0.9), [1, 0.4, 0.2])),
  // 翻成六脚朝天，腿蜷起来
  C('die', 12, 0.8, false,
    turn('z', [0.35, 0.42, 0.5], (u) => 0.7 * ramp(0.25, 1, u), all(below(0.46, 0.3), outer(0.4, 0.6)), true),
    topple({ roll: 2.85, flat: 0.85, twitch: 0.04 })),
]

// ---- 护巢虫：高瘦直立、长尾（身后翘起）、背上一丛向两侧炸开的发光晶簇、长脑袋往前探 ----
const wardenArm = all(outer(0.56, 0.66), below(0.62, 0.54))
const CRYSTAL = [0, 0.78, 0.68]
const WARDEN = [
  C('walk', 16, 1.0, true,
    legs({ top: 0.45, inner: 0.02, soft: 0.06, swing: 0.075, lift: 0.03, zRange: [0.52, 1.01], maxX: 0.5 }),
    legs({ top: 0.62, inner: 0.56, soft: 0.1, swing: 0.05, lift: 0, phase: PI }),
    undulate({ amp: 0.14, waves: 1, segments: 10, head: 0.8 }),
    curl({ from: 0.45, fwd: (u) => 0.06 + 0.03 * wave(u, 2), side: (u) => 0.05 * wave(u, 1) }),
    move((u, n, d) => { d[1] = 0.012 * wave(u, 2, 0.6) }, above(0.12, 0.35))),
  // 光环脉冲：晶簇一胀一缩，仰身，双臂外张（循环）
  C('attack', 10, 1.0, true,
    swell(CRYSTAL, 0.4, (u) => 0.2 + 0.14 * wave(u, 1), [1, 1, 0.5]),
    curl({ from: 0.45, fwd: (u) => -0.12 - 0.04 * wave(u, 1) }),
    turn('z', [0.55, 0.75, 0.7], (u) => -0.3 - 0.1 * wave(u, 1), wardenArm, true)),
  C('die', 12, 0.9, false,
    swell(CRYSTAL, 0.4, (u) => -0.4 * ease(u), [1, 1, 0.5]),
    curl({ from: 0.35, fwd: (u) => 0.5 * ramp(0, 0.5, u) }),
    topple({ roll: -1.4, flat: 0.5, k: (u) => ease((u - 0.25) / 0.65) })),
]

// ---- 刺脊虫：眼镜蛇式，下身在地上盘成一圈，上身昂起，颈盾向两侧张开 ----
const coil = below(0.3, 0.2)
const HOOD = [0, 0.82, 0.42]
const SPITTER = [
  C('walk', 16, 0.8, true,
    turn('y', [0, 0, 0.5], (u) => 0.14 * wave(u, 1), coil),                                 // 盘着的下身来回拧（游动）
    undulate({ amp: 0.05, waves: 1.5, segments: 10, head: 0.2 }),
    curl({ from: 0.24, side: (u) => 0.2 * wave(u, 1, 0.8), fwd: (u) => 0.05 + 0.06 * wave(u, 2), lag: 0.3 })),
  // 后仰蓄酸（颈盾张开）→ 甩头喷吐
  C('attack', 12, 0.6, false,
    curl({ from: 0.22, fwd: (u) => -0.5 * bump(u, 0, 0.5) + 0.9 * bump(u, 0.36, 1), pow: 1.3 }),
    swell(HOOD, 0.45, (u) => 0.22 * bump(u, 0.1, 0.8), [1, 0.3, 0.3])),
  // 上身栽下来，瘫成一摊
  C('die', 10, 0.6, false,
    curl({ from: 0.2, fwd: (u) => 1.5 * ease(u), side: (u) => 0.5 * ease(u), pow: 0.8 }),
    squash((u) => 0.5 * ramp(0.3, 1, u), 0.25),
    tremble({ amp: 0.02, freq: 6, gate: (u) => bump(u, 0, 0.5) }),
    ground()),
]

// ---- 举盾虫：正面一块门板大的骨盾（只占身长最前面不到一成），盾后是六足甲虫 ----
const shield = front(0.895, 0.92)
const notShield = front(0.92, 0.895)
const sbBody = (n) => Math.max(shield(n), ramp(0.03, 0.3, n.y))
const SHIELDBUG = [
  C('walk', 12, 0.7, true,
    legs({ top: 0.38, inner: 0.4, soft: 0.12, swing: 0.1, lift: 0.045, pairs: 3, mask: notShield }),
    move((u, n, d) => { d[1] = 0.012 * wave(u, 2) }, sbBody),
    turn('z', [0, 0.25, 0.5], (u) => 0.03 * wave(u, 1), above(0.25, 0.5)),
    turn('y', [0, 0.5, 0.95], (u) => 0.05 * wave(u, 1, 0.7), shield),
    turn('x', [0, 0.02, 0.95], (u) => 0.03 * wave(u, 2), shield)),
  // 盾击：后坐 → 整个身子连盾往前撞
  C('attack', 8, 0.5, false,
    move((u, n, d) => { d[2] = -0.12 * bump(u, 0, 0.5) + 0.34 * bump(u, 0.35, 1) }, sbBody),
    turn('x', [0, 0.0, 0.6], (u) => -0.1 * bump(u, 0, 0.5) + 0.16 * bump(u, 0.35, 1), sbBody),
    ground()),
  // 连盾带身子一起侧翻（盾和身子之间有连着的面，分开动会扯出膜来）
  C('die', 10, 0.6, false,
    turn('x', [0, 0.0, 0.6], (u) => 0.22 * bump(u, 0, 0.6), sbBody),
    topple({ roll: 1.42, flat: 0.7 }),
    ground()),
]

// ---- 掘地虫：身子是一根立着的圆筒，两条胳膊向外下方伸出一对铲状巨爪（爪在身前），尾巴拖在身后 ----
const claw = all(outer(0.24, 0.32), below(0.84, 0.74))
const CLAW_PV = [0.35, 0.74, 0.5]
const DIGGER = [
  C('walk', 12, 0.6, true,
    undulate({ amp: 0.1, waves: 1, segments: 10, head: 0.8 }),
    curl({ from: 0.28, side: (u) => 0.1 * wave(u, 1), fwd: (u) => 0.1 + 0.05 * wave(u, 2) }),
    turn('x', CLAW_PV, (u, n) => 0.36 * sin(u * TAU + (n.side > 0 ? 0 : PI)), claw, true),
    ground()),
  // 双爪高举 → 劈下
  C('attack', 8, 0.5, false,
    turn('x', CLAW_PV, (u) => -1.0 * bump(u, 0, 0.6) + 0.45 * bump(u, 0.4, 1), claw, true),
    curl({ from: 0.28, fwd: (u) => -0.2 * bump(u, 0, 0.6) + 0.55 * bump(u, 0.4, 1) }),
    ground()),
  // 破土：转着钻出来，爪子先举着
  C('emerge', 10, 0.5, false,
    turn('x', CLAW_PV, (u) => -1.1 * (1 - ease(u)), claw, true),
    emerge({ spin: 2.6 })),
  C('die', 10, 0.6, false,
    curl({ from: 0.25, fwd: (u) => 0.7 * ease(u) }),
    topple({ roll: 1.2, flat: 0.5, twitch: 0.08 })),
]

// ---- 虫卵：一鼓一瘪，孵化 / 被打爆时胀一下再瘪成一摊 ----
const EGG = [
  C('walk', 12, 1.4, true, breathe({ amp: 0.035 }), swell([0, 0.5, 0.5], 0.7, (u) => 0.03 * wave(u, 2, 1))),
  C('attack', 8, 0.4, true, breathe({ amp: 0.07 })),
  C('die', 8, 0.35, false, squash((u) => -0.18 * bump(u, 0, 0.45) + 0.84 * ramp(0.35, 1, u), 0.5)),
]

// ---- 翼螫：模型原点在尾刺尖。游戏里它的 y 是「身体的飞行高度」，所以整体往下挪 WING_DROP，让胸腹落在 y ≈ 0.3 ----
const WING_DROP = 0.4
const wingW = all(outer(0.2, 0.32), above(0.42, 0.5))
const WING_PV = [0.14, 0.62, 0.5]
const drop = move((u, n, d) => { d[1] = -WING_DROP })
const WING = [
  // 一个 clip = 扇一次翅（swarmview 对飞行虫按 clip 自己的时长循环播）；后翼比前翼慢小半拍
  C('walk', 8, 0.18, true,
    turn('z', WING_PV, (u, n) => 0.1 + 0.6 * sin(u * TAU - (n.z < 0.45 ? 0.9 : 0)), wingW, true),
    turn('x', [0, 0.5, 0.5], (u) => 0.1 * wave(u, 1, 1.2), below(0.45, 0.3)),
    move((u, n, d) => { d[1] = 0.02 * wave(u, 1, 1.5) }, (n) => 1 - wingW(n)),
    drop),
  // 俯冲：收翼成 V、低头、毒针前伸
  C('attack', 8, 0.2, true,
    turn('z', WING_PV, (u) => -0.7 + 0.18 * wave(u, 1), wingW, true),
    turn('x', [0, 0.5, 0.5], k0(-0.7), below(0.45, 0.3)),
    turn('x', [0, 0.55, 0.5], k0(0.5)),
    drop),
  C('die', 10, 0.6, false,
    turn('z', WING_PV, (u) => 0.5 * sin(u * TAU * 2) * (1 - ease(u)) + 1.0 * ease(u), wingW, true),
    turn('x', [0, 0.55, 0.5], (u) => 1.1 * ease(u)),
    turn('z', [0, 0.55, 0.5], (u) => 2.4 * ease(u)),
    drop),
]

// ---- 「碾压者」：霸王龙式的两足巨兽——肩上一对巨镰（刃尖在头顶上方向内弯）、垂着一对带腺体的前肢、细长的尾巴拖在身后 ----
const sickle = (n) => Math.max(ramp(0.5, 0.58, n.ax) * ramp(0.57, 0.63, n.y), ramp(0.2, 0.27, n.ax) * ramp(0.92, 0.95, n.y))
const SICKLE_PV = [0.55, 0.62, 0.68]
const rvHead = all(front(0.78, 0.88), below(0.9, 0.84))
const rvGait = (swing, cycles = 1) => compose(
  legs({ top: 0.42, inner: 0.08, soft: 0.1, swing, lift: swing * 0.5, cycles, maxX: 0.56 }),
  legs({ top: 0.58, inner: 0.56, soft: 0.06, swing: swing * 0.7, lift: swing * 0.2, cycles, phase: PI }))
const RAVAGER = [
  C('walk', 16, 1.3, true,
    rvGait(0.075),
    undulate({ amp: 0.12, waves: 0.8, segments: 10, head: 0.9 }),
    move((u, n, d) => { d[1] = 0.014 * wave(u, 2) }, above(0.12, 0.35)),
    turn('z', [0, 0, 0.6], (u) => 0.035 * wave(u, 1), above(0.15, 0.45)),
    turn('y', [0, 0.6, 0.75], (u) => 0.1 * wave(u, 1, 0.6), rvHead),
    turn('z', SICKLE_PV, (u) => 0.07 * wave(u, 2), sickle, true)),
  // 横扫：双镰向外张开蓄力 → 交叉向内横斩 → 收回（模拟：0.3 秒前摇 + 0.6 秒）
  C('attack', 14, 0.9, false,
    turn('y', SICKLE_PV, (u) => 0.5 * bump(u, 0, 0.45) - 1.25 * ramp(0.3, 0.5, u) * ramp(1, 0.72, u), sickle, true),
    turn('x', SICKLE_PV, (u) => -0.25 * bump(u, 0, 0.45) + 1.0 * ramp(0.3, 0.5, u) * ramp(1, 0.72, u), sickle, true),
    turn('x', [0, 0.3, 0.6], (u) => -0.12 * bump(u, 0, 0.45) + 0.2 * ramp(0.3, 0.5, u) * ramp(1, 0.72, u), above(0.25, 0.5)),
    move((u, n, d) => { d[2] = -0.04 * bump(u, 0, 0.45) + 0.1 * ramp(0.3, 0.5, u) * ramp(1, 0.72, u) }, above(0.1, 0.4))),
  // 冲锋蓄力：后坐、压头、双镰后收高举、脚刨地、浑身发抖（循环）
  C('windup', 10, 0.6, true,
    rvGait(0.03, 2),
    move((u, n, d) => { d[2] = -0.08; d[1] = -0.05 - 0.01 * wave(u, 2) }, above(0.12, 0.4)),
    turn('x', [0, 0.3, 0.6], k0(-0.14), above(0.25, 0.5)),
    turn('x', [0, 0.6, 0.78], k0(0.4), rvHead),
    turn('x', SICKLE_PV, (u) => -0.5 - 0.06 * wave(u, 2), sickle, true),
    tremble({ amp: 0.008, freq: 5 })),
  // 冲锋：低头前倾、双镰平端向前当撞角、两脚翻飞（循环）
  C('charge', 8, 0.32, true,
    rvGait(0.13),
    turn('x', [0, 0.32, 0.6], k0(0.22), above(0.2, 0.45)),
    turn('x', SICKLE_PV, k0(0.85), sickle, true),
    turn('y', SICKLE_PV, k0(-0.3), sickle, true),
    move((u, n, d) => { d[1] = 0.025 * wave(u, 2) }, above(0.15, 0.4))),
  // 眩晕：趴下、双镰瘫在两侧、头晃（循环）
  C('stun', 12, 1.6, true,
    squash(k0(0.17), 0.2),
    turn('x', [0, 0.25, 0.6], k0(0.2), above(0.2, 0.45)),
    turn('z', SICKLE_PV, k0(0.8), sickle, true),
    turn('z', [0, 0, 0.6], (u) => 0.06 * wave(u, 1), above(0.1, 0.5)),
    turn('y', [0, 0.6, 0.75], (u) => 0.22 * wave(u, 2), rvHead)),
  // 扬身嘶吼 → 侧倒
  C('die', 16, 1.6, false,
    turn('x', [0, 0.3, 0.6], (u) => -0.45 * bump(u, 0, 0.5), above(0.2, 0.45)),
    turn('z', SICKLE_PV, (u) => -0.3 * bump(u, 0, 0.45) + 0.7 * ramp(0.4, 0.9, u), sickle, true),
    tremble({ amp: 0.012, freq: 14, gate: (u) => bump(u, 0, 0.45) }),
    topple({ roll: 1.35, flat: 0.62, k: (u) => ease((u - 0.38) / 0.55) })),
]

// ---- 「巢母」：上身竖直、冠状头、身前一个发光卵囊、两侧各两条落地的长蛛腿、身后一条细尾 ----
const spider = outer(0.5, 0.6)
const SAC = [0, 0.33, 0.88]
const SPIDER_PV = [0.45, 0.45, 0.75]
const mtGait = (k) => compose(
  legs({ top: 0.56, inner: 0.5, soft: 0.1, swing: 0.06 * k, lift: 0.045 * k, pairs: 2 }),
  legs({ top: 0.2, inner: 0.05, soft: 0.06, swing: 0.04 * k, lift: 0.02 * k, maxX: 0.42, zRange: [0.5, 1.01] }))
const MATRIARCH = [
  C('walk', 16, 1.8, true,
    mtGait(1),
    undulate({ amp: 0.1, waves: 1, segments: 10, head: 0.9 }),
    curl({ from: 0.5, side: (u) => 0.07 * wave(u, 1), fwd: (u) => 0.06 * wave(u, 2) }),
    swell(SAC, 0.3, (u) => 0.05 * wave(u, 2)),
    move((u, n, d) => { d[1] = 0.012 * wave(u, 2) }, above(0.1, 0.3))),
  // 原地守着：呼吸、卵囊蠕动、转头张望、蛛腿轻轻起落（循环；模拟里的 idle 状态）
  C('idle', 16, 2.4, true,
    swell(SAC, 0.3, (u) => 0.06 * wave(u, 2)),
    undulate({ amp: 0.06, waves: 1, segments: 10, head: 0.9 }),
    curl({ from: 0.5, side: (u) => 0.06 * wave(u, 1), fwd: (u) => 0.04 * wave(u, 1, 1.3) }),
    turn('y', [0, 0.7, 0.75], (u) => 0.22 * wave(u, 1), above(0.6, 0.74)),
    turn('z', SPIDER_PV, (u, n) => 0.05 * sin(u * TAU * 2 + n.z * 4), spider, true)),
  // 吐酸 / 产卵共用：仰头蓄力 → 前甩喷吐，卵囊鼓起，蛛腿撑地
  C('attack', 12, 0.5, false,
    curl({ from: 0.5, fwd: (u) => -0.45 * bump(u, 0, 0.5) + 0.75 * bump(u, 0.35, 1), pow: 1.3 }),
    swell(SAC, 0.32, (u) => 0.18 * bump(u, 0.1, 0.85)),
    turn('z', SPIDER_PV, (u) => -0.12 * bump(u, 0, 1), spider, true)),
  C('stun', 12, 1.6, true,
    squash(k0(0.12), 0.15),
    curl({ from: 0.45, fwd: k0(0.55), side: (u) => 0.12 * wave(u, 1) }),
    turn('z', SPIDER_PV, k0(0.18), spider, true)),
  // 扬头哀鸣 → 卵囊瘪下去 → 瘫倒
  C('die', 16, 1.6, false,
    curl({ from: 0.5, fwd: (u) => -0.45 * bump(u, 0, 0.45) + 0.6 * ramp(0.4, 0.9, u), pow: 1.3 }),
    swell(SAC, 0.32, (u) => 0.1 * bump(u, 0, 0.3) - 0.5 * ramp(0.3, 0.8, u)),
    tremble({ amp: 0.01, freq: 14, gate: (u) => bump(u, 0, 0.45) }),
    topple({ roll: 1.2, flat: 0.5, k: (u) => ease((u - 0.42) / 0.55) })),
]

// ---- 「渊噬蠕虫」：从地里竖直钻出的一截，顶端向前弯、环形巨口朝前，脚下一摊翻起来的泥 ----
const MAW = [0, 0.83, 0.9]
const strike = (u) => Math.pow(Math.max(0, cos(u * TAU)), 3)
const LEVIATHAN = [
  // 露头后的常态：整根身子画着圈摇（波从根部往上传），口器一张一合
  C('walk', 16, 2.4, true,
    curl({ from: 0.07, side: (u) => 0.24 * wave(u, 1), fwd: (u) => 0.05 + 0.1 * wave(u, 1, PI / 2), lag: 0.3, pow: 0.9 }),
    swell(MAW, 0.22, (u) => 0.07 * wave(u, 2), [1, 1, 0.15])),
  // 吐刺（循环，1.4 秒一次 = 模拟里两次吐刺的间隔）：后仰蓄力 → u = 0 那一下猛地前甩张口
  C('attack', 16, 1.4, true,
    curl({ from: 0.07, fwd: (u) => 0.05 + 0.6 * strike(u) - 0.42 * bump(u, 0.4, 0.95), side: (u) => 0.08 * wave(u, 1), pow: 1.1 }),
    swell(MAW, 0.24, (u) => 0.2 * strike(u) - 0.06 * bump(u, 0.4, 0.95), [1, 1, 0.15]),
    tremble({ amp: 0.006, freq: 12, gate: (u) => bump(u, 0.45, 0.95) })),
  // 破土：转着顶出来，出土那一下后仰张口
  C('emerge', 10, 0.45, false,
    curl({ from: 0.07, fwd: (u) => -0.35 * bump(u, 0.3, 1.3) }),
    swell(MAW, 0.24, (u) => 0.22 * bump(u, 0.45, 1.3), [1, 1, 0.15]),
    emerge({ spin: 1.6, depth: 8 * 1.3 })),
  C('burrow', 8, 0.4, false,
    curl({ from: 0.07, fwd: (u) => 0.3 * ease(u) }),
    emerge({ burrow: true, spin: -1.4, depth: 8 * 1.3 })),
  // 眩晕：耷拉下来，慢慢晃
  C('stun', 12, 1.6, true,
    curl({ from: 0.07, fwd: k0(0.7), side: (u) => 0.22 * wave(u, 1), pow: 1.2 }),
    ground()),
  // 狂甩 → 往前栽倒，瘫在地上
  C('die', 16, 1.6, false,
    curl({ from: 0.07, side: (u) => 0.55 * sin(u * TAU * 3) * (1 - ramp(0.3, 0.75, u)), fwd: (u) => -0.3 * bump(u, 0, 0.4) + 1.2 * ramp(0.35, 0.95, u), pow: 1.1 }),
    swell(MAW, 0.24, (u) => 0.2 * bump(u, 0, 0.5), [1, 1, 0.15]),
    squash((u) => 0.25 * ramp(0.6, 1, u), 0.2),
    ground()),
]

// ------------------------------------------------------------------ 注册
const BUG = { walk: 'walk', attack: 'attack', die: 'die' }
const BOSS = { walk: 'walk', idle: 'idle', attack: 'attack', windup: 'windup', charge: 'charge', stun: 'stun', die: 'die', emerge: 'emerge', burrow: 'burrow' }

/** 甲壳兽：贴图是饱和的亮橙，火光下发「玻璃橙」。往暗红褐拉：去掉一半饱和度、亮部压暗（暗部基本不动，保留甲片接缝） */
const crusherFx = /* glsl */`
  {
    vec3 c0 = diffuseColor.rgb;
    float l0 = dot(c0, vec3(0.3, 0.59, 0.11));
    vec3 brown = vec3(l0) * vec3(1.45, 0.78, 0.55);
    diffuseColor.rgb = mix(c0, brown, 0.55) * mix(1.0, 0.7, smoothstep(0.08, 0.3, l0));
  }`

/** 巢母的卵囊：亮、低饱和的像素（乳白球皮）→ 暗琥珀；eggSacK 留给自发光阶段用（不加花括号：变量要活到 emissivemap 那一段） */
const eggSacFx = /* glsl */`
    float eggSacK = 0.0; vec3 eggSacC = vec3(0.0);
    {
      vec3 c0 = diffuseColor.rgb;
      float l0 = dot(c0, vec3(0.3, 0.59, 0.11));
      float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b));
      float st = (mx - mn) / max(mx, 1e-3);
      eggSacK = smoothstep(0.07, 0.22, l0) * (1.0 - smoothstep(0.55, 0.82, st));   // 乳白 / 浅桃色的球皮在线性空间里饱和度有 0.4 上下；身子是暗蓝 / 暗红（亮度低）、卵粒和爪是饱和的橙红，都进不来
      vec3 amber = vec3(0.30, 0.13, 0.03) * (0.35 + 0.9 * l0);
      eggSacC = amber;
      diffuseColor.rgb = mix(c0, amber, eggSacK);
    }`
// 自发光阶段：① 贴图自发光里那层乳白光（卵囊「发白」的大头）换成同亮度 ×0.35 的琥珀；② 加一层很淡的琥珀底光；
// ③ 球皮当成粗糙、不导电的膜：环境反射 / 高光不再把它刷白（这一段在光照计算之前，改 roughnessFactor / metalnessFactor 还来得及）
const eggSacGlow = /* glsl */`
  {
    vec3 e0 = totalEmissiveRadiance;
    float eL = dot(e0, vec3(0.3, 0.59, 0.11));
    totalEmissiveRadiance = mix(e0, vec3(1.0, 0.42, 0.08) * eL * 0.35, eggSacK);
    totalEmissiveRadiance += vec3(0.30, 0.12, 0.02) * eggSacK * 0.35;
    diffuseColor.rgb = mix(diffuseColor.rgb, eggSacC, eggSacK * 0.85);   // 甲壳硬化的冷钢染色 / 受击闪色是在 colorFx 之后叠的：卵囊这块再盖回琥珀，硬化时不变成一团灰蓝
    roughnessFactor = mix(roughnessFactor, 0.85, eggSacK);
    metalnessFactor = mix(metalnessFactor, 0.0, eggSacK);
  }`

/**
 * 尺寸：bake.height = 模型烘成多高（米），scale 留 1。虫的最终大小 = height × world.swarm.scale[i]（data/enemies.js 的 scale；精英再 ×1.3）。
 * 每一项后面的注释是「按 data 的 scale 算出来的实际高 × 宽」和被它替换掉的程序化模型的实际尺寸。
 */
export function registerAI({ register, REGISTRY }) {
  const sw = aiSwitch()
  if (!sw) return []
  const done = []
  const add = (name, def, force = false) => {
    if (!force && sw !== true && !sw.has(name) && !sw.has(name.replace(/@.*/, ''))) return
    const prev = REGISTRY && (REGISTRY.get(name) || REGISTRY.get(name.replace(/@.*/, '')))
    register(name, { scale: 1, lerp: true, ai: true, ...def, label: prev ? prev.label : def.label || name })
    if (!force) done.push(name)
  }
  const src = (file, height, clips) => ({ gltf: DIR + file + '.glb', bake: { height, smooth: true, clips } })

  // ---- 中大型虫 ----
  add('enemy.hulk', { source: src('enemy_hulk', 1.45, HULK), clips: BUG, material: TEX({ key: 'aiH', gain: 0.5, fill: 0.08 })   /* 0.72 → 0.5：Boss 压暗以后，护卫的巨畸体（贴图大片粉白骨板）反倒比 Boss 还显眼，一起压下去 */, shadow: { cast: true, blob: [2.0, 1.6, 0.5, 2] }, capacity: 40, anim: { stride: 2.4, dieDur: 1.1, attackDur: 1.0 } })
  // 测试「Boss 身后一排橙色玻璃样的虚影虫」查明是甲壳兽（实测：只隐藏 enemy.crusher / @far 两个池，那排虚影就没了）。
  // 原因：默认 TEX 的金属度直接取贴图（≈ 1）+ 环境反射 0.45 + 亮橙贴图 ×0.8 —— 分节的背甲整片反射天空，在火光和 Bloom 下像一排橙色玻璃。
  // 现在当成湿润的暗褐甲壳：金属度 ×0.2、环境反射 0.15、反照率 ×0.55，亮橙往暗红褐拉（crusherFx），补光 / 边缘光减半
  const crusherMat = TEX({ key: 'aiC2', gain: 0.55, metalness: 0.2, env: 0.15, rimGain: 0.1, fill: 0.07, emissive: 0.8, colorFx: crusherFx })
  add('enemy.crusher', { source: src('enemy_crusher', 0.8, CRUSHER), clips: BUG, material: crusherMat, shadow: { cast: true, blob: [1.1, 1.5, 0.55, 3] }, capacity: 20, anim: { stride: 2.6, dieDur: 0.8, attackDur: 0.7 }, lod: { name: 'enemy.crusher@far', z: 3 } })
  add('enemy.crusher@far', { source: src('enemy_crusher_lod', 0.8, CRUSHER), clips: BUG, material: crusherMat, shadow: { cast: true, blob: [1.1, 1.5, 0.55, 3] }, capacity: 160, anim: { stride: 2.6, dieDur: 0.8, attackDur: 0.7 } })
  add('enemy.warden', { source: src('enemy_warden', 2.0, WARDEN), clips: BUG, material: TEX({ key: 'aiA', emissive: 1.0 }), shadow: { cast: true, blob: [1.5, 1.9, 0.45, 2] }, capacity: 32, anim: { stride: 2.4, dieDur: 0.9, aura: 4 } })
  add('enemy.spitter', { source: src('enemy_spitter', 1.5, SPITTER), clips: BUG, material: TEX({ key: 'aiP' }), shadow: { cast: true, blob: [1.7, 1.8, 0.5, 2] }, capacity: 12, anim: { stride: 2.4, dieDur: 0.6, attackDur: 0.6 }, lod: { name: 'enemy.spitter@far', z: 3 } })
  add('enemy.spitter@far', { source: src('enemy_spitter_lod', 1.5, SPITTER), clips: BUG, material: TEX({ key: 'aiP' }), shadow: { cast: true, blob: [1.7, 1.8, 0.5, 2] }, capacity: 64, anim: { stride: 2.4, dieDur: 0.6, attackDur: 0.6 } })
  add('enemy.shieldbug', {
    source: src('enemy_shieldbug_alt', 1.4, SHIELDBUG), clips: BUG,
    material: TEX({ key: 'aiSB', colorFx: boneFx({ tint: [0.36, 0.285, 0.185], lum: [0.04, 0.16], sat: [0.32, 0.58], grime: 0.75, height: 1.4 }), env: 0.3 }),
    shadow: { cast: true, blob: [1.8, 2.0, 0.5, 2] }, capacity: 96, anim: { stride: 2.2, dieDur: 0.6 },
  })
  add('enemy.digger', { source: src('enemy_digger', 1.15, DIGGER), clips: { ...BUG, emerge: 'emerge' }, material: TEX({ key: 'aiD' }), shadow: { cast: true, blob: [1.3, 1.3, 0.5, 2] }, capacity: 48, anim: { stride: 2.2, dieDur: 0.6, attackDur: 0.5 } })
  const eggMat = TEX({ key: 'aiE', gain: 0.6, emissive: 1.1, env: 0.35, colorFx: boneFx({ tint: [0.30, 0.13, 0.085], lum: [0.15, 0.45], sat: [0.5, 0.8], grime: 0.3, amount: 0.9, height: 0.85 }) })
  add('enemy.egg', { source: src('enemy_egg', 0.85, EGG), clips: BUG, material: eggMat, shadow: { blob: [1.1, 1.1, 0.5, 2] }, capacity: 12, anim: { dieDur: 0.35, sink: false }, lod: { name: 'enemy.egg@far', z: 3 } })
  add('enemy.egg@far', { source: src('enemy_egg_lod', 0.85, EGG), clips: BUG, material: eggMat, shadow: { blob: [1.1, 1.1, 0.5, 2] }, capacity: 80, anim: { dieDur: 0.35, sink: false } })
  const wingMat = TEX({ key: 'aiW', side: 'double', gain: 0.85 })
  add('enemy.wing', { source: src('enemy_wing', 1.25, WING), clips: BUG, material: wingMat, shadow: { blob: [1.7, 0.9, 0.3, 2] }, capacity: 12, anim: { fly: true, dieDur: 0.6 }, lod: { name: 'enemy.wing@far', z: 3 } })
  add('enemy.wing@far', { source: src('enemy_wing_lod', 1.25, WING), clips: BUG, material: wingMat, shadow: { blob: [1.7, 0.9, 0.3, 2] }, capacity: 200, anim: { fly: true, dieDur: 0.6 } })

  // ---- Boss ----（碾压者：肩宽连镰刀约 5.2 米 = 桥宽 13 米的四成）
  // Boss 加一圈偏白的暖色轮廓光（rim 0xffd2b0、rimPow 3.2）：被火焰和虫群围住时靠这圈亮边把剪影勾出来（测试「碾压者被埋住看不见」）
  // 测试：碾压者本体灰白、像漂白过发虚。实测拆开看：贴图本身是暗红褐（线性平均 0.087 / 0.050 / 0.039），
  // 发白来自三层叠加 —— ① 反照率 ×0.95 被主光 + 补光（fill 0.3）照成淡粉，② 1.25 倍、pow 2.0 的米白轮廓光在俯视下盖住大半个背甲，③ 金属度 ×1 反射天空。
  // 现在：反照率压到 0.42、补光 0.05、轮廓光换暗橙 0.3 且收窄，金属度 ×0.3、粗糙度 ×1.3 —— 甲壳靠主光在湿面上的高光读出来，是深色实体，不再是一层米白
  const BOSSMAT = (o) => TEX({ gain: 0.42, emissive: 1.1, rim: 0xff6a30, rimPow: 2.6, rimGain: 0.3, fill: 0.05, env: 0.35, metalness: 0.3, roughness: 1.3, ...o })   // 边缘光 0.8 → 1.25、更宽（pow 2.6 → 2.0）、补光略加：深棕的 Boss 埋在同色虫堆里时靠一圈亮边勾出轮廓
  // 测试「碾压者和周围甲壳兽、巨畸体一样大，出场头 4~6 秒认不出」：巨畸体 1.45 × 2.6 ≈ 3.8 米高，原来 Boss 才 4.3 米。
  // 只放大渲染尺寸 ×1.4（≈ 6 米高、肩宽连镰刀 ≈ 7 米），模拟层的碰撞半径 / 横扫 / 冲锋宽度一概不动（横扫够得着 3.7 + 纵深 8 米，放大后的身形反而和打击范围对得更上）。
  // 表现层让位的椭圆（swarmview BOSS_FOOT）同步放大
  add('boss.ravager', { scale: 1.4, source: src('boss_ravager', 4.3, RAVAGER), clips: BOSS, material: BOSSMAT({ key: 'aiBR' }), shadow: { cast: true, blob: [4.6, 6.8, 0.5, 3] }, capacity: 2, anim: { attackDur: 0.9, dieDur: 1.6, stride: 5 } })
  // 测试「巢母身体中间有一团发白的半透明球」= 贴图里的卵囊（乳白半透明的球皮 + 橙色卵粒）：主光 + 环境反射下整团发白。
  // 卵囊的乳白像素（亮、低饱和）换成暗琥珀，再给一层低于 Bloom 阈值的琥珀自发光 —— 读成「里面透着光的卵囊」而不是一团白
  add('boss.matriarch', { source: src('boss_matriarch', 5.6, MATRIARCH), clips: BOSS, material: BOSSMAT({ key: 'aiBM2', colorFx: eggSacFx, emissiveFx: eggSacGlow }), shadow: { cast: true, blob: [6.0, 5.0, 0.5, 2.5] }, capacity: 2, anim: { attackDur: 0.5, dieDur: 1.6, stride: 5 } })
  add('boss.leviathan', {
    source: src('boss_leviathan', 8.0, LEVIATHAN), clips: BOSS,
    // 测试「渊噬蠕虫像一根无质感偏橙粉的肉柱」：主机位是从上往下看，看到的几乎全是贴图里那段灰白的颈背 —— 原来只染成偏粉的红褐、
    // 脏污也轻，再叠上火光和常亮的受击染色就成了一根粉柱。现在：灰白的颈背整段染成和下半身甲环同一个暗红褐（饱和度范围放宽，粉色的也算），
    // 斑驳用贴图自己的明暗（wormFx）；腺体照旧用贴图的橙色自发光
    material: BOSSMAT({ key: 'aiBL', rim: 0xff6a30, rimGain: 0.3, rimPow: 2.8, fill: 0.08,   /* 蠕虫是竖着的长柱，俯视时几乎整段侧面都在掠射角：通用 Boss 的亮边会把它刷成一根米黄柱子，换成暗橙、收窄 */ gain: 0.5, roughness: 2.4, metalness: 0.15, env: 0.3,   /* 金属度 × 0.15、粗糙度 × 2.4：别让颈背那段光皮像塑料一样整片反光 */ colorFx: wormFx }),
    shadow: { cast: true, blob: [6.4, 6.4, 0.45, 2] }, capacity: 2, anim: { dieDur: 1.6, emergeDur: 0.45, burrowDur: 0.4 },
  })

  // ---- 我方（models/ai/allies.js）：过了质量闸门的才顶替程序化模型，其余注册成 unit.<kind>@ai 供对比 ----
  done.push(...registerAllies(add, sw))
  return done
}
