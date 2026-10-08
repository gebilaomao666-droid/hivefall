// proc/deform.js —— 给「没有骨骼的静态模型」用的程序化姿态函数（AI 生成的带贴图 glb 就是这种）。
// 用法：assets.js 注册时写在 source.bake.clips[].deform 里，gpuanim.bakeGLTF 会对每一帧、每个顶点调一次，把结果烘进顶点动画贴图。
//
//   deform(u, p, out, info)
//     u     0..1，clip 内的时间（循环 clip 的 u = 1 和 u = 0 是同一帧）
//     p     [x, y, z] 静止位置，已经归一化：米、脚底 y = 0、朝 +Z、x / z 居中
//     out   [x, y, z] 写结果；进来时已经等于 p，所以只写要改的分量就行。多个函数串起来时，后一个拿到的 out 是前一个的结果
//     info  { size: [宽, 高, 长], min: [x, y, z], max: [x, y, z] }（静止姿势的包围盒）
//
// 这里的函数都是「工厂」：调用它得到一个 deform。compose(a, b, c) 把几个依次套起来。
// 法线不用管：烘焙时按变形后的位置重算平滑法线。
const TAU = Math.PI * 2
const sin = Math.sin, cos = Math.cos
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ease = (v) => { v = clamp01(v); return v * v * (3 - 2 * v) }
/** 0..1..0 的鼓包，u 在 [a, b] 之外为 0 */
const bump = (u, a, b) => (u <= a || u >= b ? 0 : sin(((u - a) / (b - a)) * Math.PI))

/** 依次套用几个姿态函数 */
export function compose(...fns) {
  const list = fns.filter(Boolean)
  return (u, p, out, info) => { for (const f of list) f(u, p, out, info) }
}

/** 呼吸：整体一鼓一瘪（高度涨的时候宽度略收）。amp = 幅度（0.04 = ±4%），cycles = 一个 clip 里几次 */
export function breathe({ amp = 0.04, cycles = 1 } = {}) {
  return (u, p, out, info) => {
    const k = amp * sin(u * TAU * cycles), h = info.size[1] || 1
    const w = clamp01(out[1] / h)                       // 贴地的部分不动，越高动得越多
    out[0] *= 1 - k * 0.5 * w; out[2] *= 1 - k * 0.3 * w; out[1] *= 1 + k
  }
}

/** 整体起伏：上下颠 + 前后点头。amp 米，pitch 弧度，cycles = 一个 clip 里几次（走路一般是 2：一步一颠） */
export function bob({ amp = 0.05, pitch = 0.03, cycles = 2, phase = 0 } = {}) {
  return (u, p, out) => {
    const a = u * TAU * cycles + phase, dy = amp * sin(a), r = pitch * sin(a + 1.2)
    const y = out[1], z = out[2], c = cos(r), s = sin(r)
    out[1] = y * c - z * s + dy; out[2] = y * s + z * c
  }
}

/** 左右摇摆：绕前进轴滚一点（走路时身体的晃），越高晃得越多。roll 弧度 */
export function sway({ roll = 0.06, cycles = 1, phase = 0 } = {}) {
  return (u, p, out) => {
    const r = roll * sin(u * TAU * cycles + phase), c = cos(r), s = sin(r)
    const x = out[0], y = out[1]
    out[0] = x * c - y * s; out[1] = x * s + y * c
  }
}

/**
 * 分段弯曲（沿身体长轴的蛇形摆动）：把身体沿 Z 切成 segments 节，每节绕自己前端的关节左右摆，相位从头到尾依次落后 —— 虫子爬行的样子。
 *   amp      每个关节的最大摆角（弧度）
 *   waves    身体上同时有几个波
 *   segments 分几节（0 = 连续弯曲，不分节）
 *   head     头部保持稳定的比例（0..1）：身体前 head 这么长的一段几乎不摆
 *   vertical true = 上下拱（毛虫式）而不是左右摆
 */
export function undulate({ amp = 0.12, waves = 1, segments = 5, head = 0.25, cycles = 1, vertical = false } = {}) {
  return (u, p, out, info) => {
    const L = info.size[2] || 1, z0 = info.max[2]
    const s = clamp01((z0 - p[2]) / L)                                   // 0 = 头，1 = 尾
    const n = segments > 0 ? segments : 24
    // 正向运动学：从头往尾一节节累加关节转角，算出这个顶点所在那一节的位置和朝向
    let ang = 0, ox = 0, oz = 0, prev = 0
    const seg = Math.min(n - 1, Math.floor(s * n))
    for (let k = 0; k <= seg; k++) {
      const sk = k / n, w = ease((sk - head * 0.5) / Math.max(1e-3, head))
      const a = amp * w * sin(u * TAU * cycles - sk * TAU * waves)
      const len = (sk - prev) * L
      ox += sin(ang) * len; oz += cos(ang) * len                          // 走到这一节的关节
      ang += a; prev = sk
    }
    const local = (s - prev) * L                                          // 顶点在这一节里离关节多远
    const side = vertical ? out[1] - info.size[1] * 0.35 : out[0]
    const lat = ox + sin(ang) * local + cos(ang) * side                   // 横向（或竖向）位置
    const lon = oz + cos(ang) * local - sin(ang) * side
    if (vertical) { out[1] = lat + info.size[1] * 0.35; out[2] = z0 - lon } else { out[0] = lat; out[2] = z0 - lon }
  }
}

/**
 * 攻击：先后仰蓄力，再向前猛扑，最后收回（非循环 clip）。
 *   dist 前扑的距离（米）；rear 后仰的角度（弧度）；stretch 扑出去时身体拉长的比例
 */
export function lunge({ dist = 0.5, rear = 0.25, stretch = 0.12 } = {}) {
  return (u, p, out, info) => {
    const w = bump(u, 0, 0.5), f = bump(u, 0.35, 1.0)
    const L = info.size[2] || 1, front = clamp01((p[2] - info.min[2]) / L)   // 0 = 尾，1 = 头
    const r = -rear * w * front + rear * 0.6 * f * front                   // 头先抬起来，扑的时候压下去
    const y = out[1], z = out[2], c = cos(r), s = sin(r)
    out[1] = y * c - z * s; out[2] = y * s + z * c
    out[2] += (-dist * 0.3 * w + dist * f) * (0.4 + 0.6 * front) + stretch * L * f * (front - 0.5)
  }
}

/** 张嘴 / 甲片炸开一类的「前端鼓胀」：头部那一段整体放大。amp = 放大比例，head = 头部占身长的比例 */
export function flare({ amp = 0.15, head = 0.3, from = 0.2, to = 0.9 } = {}) {
  return (u, p, out, info) => {
    const L = info.size[2] || 1, front = clamp01((p[2] - (info.max[2] - L * head)) / (L * head))
    const k = 1 + amp * bump(u, from, to) * front
    out[0] *= k; out[1] = (out[1] - info.size[1] * 0.4) * k + info.size[1] * 0.4
  }
}

/** 死亡：抽搐一下 → 侧翻 → 瘫扁（非循环 clip）。roll = 最后翻到多少弧度，flat = 最后压扁到原高度的几成 */
export function collapse({ roll = 1.25, flat = 0.55, twitch = 0.06 } = {}) {
  return (u, p, out, info) => {
    const k = ease((u - 0.15) / 0.85), t = bump(u, 0, 0.3) * sin(u * 60)
    const h = info.size[1] || 1
    out[1] *= 1 - (1 - flat) * k                                            // 压扁
    out[0] *= 1 + 0.12 * k
    const r = roll * k + twitch * t, c = cos(r), s = sin(r)
    const x = out[0], y = out[1] - h * 0.25 * (1 - k)
    out[0] = x * c - y * s; out[1] = Math.max(0, x * s + y * c + h * 0.25 * (1 - k) + Math.abs(sin(r)) * info.size[0] * 0.35)
  }
}

/** 从地下钻出来（u: 0 → 1 = 地下 → 地面）；burrow = true 反过来。depth 默认 = 身高 × 1.1 */
export function emerge({ depth = 0, burrow = false, spin = 0 } = {}) {
  return (u, p, out, info) => {
    const k = burrow ? ease(u) : 1 - ease(u), d = depth || info.size[1] * 1.1
    if (spin) { const r = spin * k, c = cos(r), s = sin(r), x = out[0], z = out[2]; out[0] = x * c + z * s; out[2] = -x * s + z * c }
    out[1] -= d * k
  }
}

/** 飞行：上下浮动 + 两侧（|x| 大的地方 = 翅膀）上下扇。flap 弧度，beats = 一个 clip 扇几次 */
export function flap({ flap = 0.6, beats = 4, hover = 0.06, body = 0.25 } = {}) {
  return (u, p, out, info) => {
    const half = info.size[0] * 0.5 || 1, ax = Math.abs(p[0]) / half
    const w = ease((ax - body) / (1 - body))                                // 身体不动，越往翼尖扇得越多
    const r = flap * sin(u * TAU * beats) * w * Math.sign(p[0] || 1), c = cos(r), s = sin(r)
    const pivot = Math.sign(p[0] || 1) * half * body, x = out[0] - pivot      // 绕翼根（身体边缘）上下转
    out[0] = pivot + x * c; out[1] += x * s + hover * sin(u * TAU)
  }
}

/** 现成的三件套（走 / 攻击 / 死），参数按体长自动定：给静态模型注册成敌人时最省事的写法。kind: 'crawler' 爬虫 | 'brute' 直立的大个子 */
export function presetClips(kind = 'crawler', o = {}) {
  if (kind === 'brute') {
    return [
      { name: 'walk', frames: 16, duration: o.walkDur ?? 1.2, loop: true, deform: compose(bob({ amp: 0.06, pitch: 0.04, cycles: 2 }), sway({ roll: 0.07 }), breathe({ amp: 0.02, cycles: 2 })) },
      { name: 'attack', frames: 14, duration: o.attackDur ?? 0.9, loop: false, deform: compose(lunge({ dist: 0.6, rear: 0.35, stretch: 0.05 }), flare({ amp: 0.1, head: 0.5 })) },
      { name: 'die', frames: 14, duration: o.dieDur ?? 1.1, loop: false, deform: collapse({ roll: 1.35, flat: 0.5 }) },
    ]
  }
  return [
    { name: 'walk', frames: 16, duration: o.walkDur ?? 0.8, loop: true, deform: compose(undulate({ amp: 0.1, waves: 1, segments: 5 }), bob({ amp: 0.03, pitch: 0.02, cycles: 2 }), sway({ roll: 0.04 })) },
    { name: 'attack', frames: 12, duration: o.attackDur ?? 0.6, loop: false, deform: compose(lunge({ dist: 0.45, rear: 0.3 }), flare({ amp: 0.12 })) },
    { name: 'die', frames: 12, duration: o.dieDur ?? 0.7, loop: false, deform: collapse({}) },
  ]
}
