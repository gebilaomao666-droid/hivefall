// models/ai/poses.js —— AI 生成模型（没有骨骼）的程序化姿态积木，和 proc/deform.js 的函数同一个签名，可以用 compose 混着串。
//
//   deform(u, p, out, info)      u = clip 内时间 0..1；p = 静止位置（米）；out = 结果（进来时 = p）；info = { size, min, max }
//
// 这里的函数都按「归一化坐标」选顶点，所以和模型烘成多大无关：
//   n.x = −1..1（左右，0 = 中轴）   n.y = 0..1（脚底 → 头顶）   n.z = 0..1（尾 → 头）   n.ax = |n.x|   n.side = ±1
// 位移量一律是「身高的几成」，角度是弧度。
const TAU = Math.PI * 2
const sin = Math.sin, cos = Math.cos, abs = Math.abs
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const ease = (v) => { v = clamp01(v); return v * v * (3 - 2 * v) }
/** a → b 之间从 0 平滑到 1（a > b 时反过来：从 1 到 0） */
export const ramp = (a, b, v) => ease((v - a) / (b - a))
/** 0..1..0 的鼓包，u 在 [a, b] 之外为 0 */
export const bump = (u, a, b) => (u <= a || u >= b ? 0 : sin(((u - a) / (b - a)) * Math.PI))
/** 循环 clip 用：u 每过一圈来 n 次 */
export const wave = (u, n = 1, ph = 0) => sin(u * TAU * n + ph)

const N = { x: 0, y: 0, z: 0, ax: 0, side: 1 }
function norm(p, info) {
  const hw = info.size[0] * 0.5 || 1
  N.x = p[0] / hw; N.y = p[1] / (info.size[1] || 1); N.z = (p[2] - info.min[2]) / (info.size[2] || 1)
  N.ax = abs(N.x); N.side = p[0] < 0 ? -1 : 1
  return N
}

/**
 * 绕一根轴转一块区域。
 *   axis   'x'（点头 / 后仰：正 = 头往前下方压）| 'y'（左右拧）| 'z'（侧倾：正 = 向 +x 那一侧倒）
 *   pivot  [n.x, n.y, n.z] 转轴经过的点（归一化坐标）；mirror = true 时 pivot 的 x 和角度都按顶点在哪一侧取镜像（两条胳膊 / 两片翅膀一起写）
 *   angle  (u, n) => 弧度
 *   weight (n, u) => 0..1，哪些顶点跟着转（不写 = 全部）
 */
export function turn(axis, pivot, angle, weight, mirror = false) {
  return (u, p, out, info) => {
    const n = norm(p, info)
    const k = weight ? weight(n, u) : 1
    if (!(k > 1e-4)) return
    const sg = mirror ? n.side : 1
    const a = angle(u, n) * k * (axis === 'x' ? 1 : sg)   // 镜像：绕 x 轴（前后摆）两侧同向，绕 y / z 轴两侧反向
    if (!a) return
    const px = pivot[0] * sg * info.size[0] * 0.5, py = pivot[1] * info.size[1], pz = info.min[2] + pivot[2] * info.size[2]
    const c = cos(a), s = sin(a)
    const x = out[0] - px, y = out[1] - py, z = out[2] - pz
    if (axis === 'x') { out[1] = py + y * c - z * s; out[2] = pz + y * s + z * c }
    else if (axis === 'y') { out[0] = px + x * c + z * s; out[2] = pz - x * s + z * c }
    else { out[0] = px + x * c + y * s; out[1] = py - x * s + y * c }
  }
}

/** 平移一块区域。delta(u, n, d) 往 d[0..2] 里写位移（单位：身高的几成）；weight 同上 */
export function move(delta, weight) {
  const d = [0, 0, 0]
  return (u, p, out, info) => {
    const n = norm(p, info)
    const k = weight ? weight(n, u) : 1
    if (!(k > 1e-4)) return
    d[0] = d[1] = d[2] = 0
    delta(u, n, d)
    const h = info.size[1] * k
    out[0] += d[0] * h; out[1] += d[1] * h; out[2] += d[2] * h
  }
}

/** 以一个点为中心鼓胀 / 收缩（卵囊、喉囊、晶簇）。center = [n.x, n.y, n.z]，radius = 影响半径（身高的几成），amp(u) = 比例（0.2 = 大两成） */
export function swell(center, radius, amp, axes = [1, 1, 1]) {
  return (u, p, out, info) => {
    const a = amp(u)
    if (!a) return
    const h = info.size[1] || 1
    const cx = center[0] * info.size[0] * 0.5, cy = center[1] * h, cz = info.min[2] + center[2] * info.size[2]
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / (radius * h)
    if (r >= 1) return
    const k = a * (1 - r * r) * (1 - r * r)
    out[0] += dx * k * axes[0]; out[1] += dy * k * axes[1]; out[2] += dz * k * axes[2]
  }
}

/**
 * 卷曲：把身体当成一根立着的柱子，从 from 这个高度往上一截截弯过去（蠕虫 / 蛇身 / 长脖子的前倾、后仰、左右摆）。
 * 每一层绕自己的位置转（弧长不变，不会像「整体绕一个点转」那样把上半身拉长）。
 *   fwd(u)  到头顶累计前倾多少弧度（负 = 后仰）      side(u) 到头顶累计向 +x 侧倾多少弧度
 *   from    从哪个高度开始弯（归一化）                pow     > 1 = 越往上弯得越多（甩头），< 1 = 根部就开始弯
 *   lag     波沿身体往上传的相位差：> 0 时 fwd / side 拿到的是 (u − lag × 高度)，做蛇形摆动
 */
export function curl({ fwd, side, from = 0, pow = 1, lag = 0, steps = 40 } = {}) {
  // 同一帧里所有顶点的 u 相同：每帧沿高度积分一次，存成表（每格 5 个数：中心 x / y / z（单位：整段长度）、前倾角、侧倾角），顶点按高度查表插值
  const T = new Float64Array((steps + 1) * 5)
  let lastU = NaN
  const build = (u) => {
    let cx = 0, cy = 0, cz = 0, pa = 0, pb = 0
    const dt = 1 / steps
    for (let i = 0; i <= steps; i++) {
      const t = i * dt, w = pow === 1 ? t : Math.pow(t, pow), uu = u - lag * t
      const a = fwd ? fwd(uu) * w : 0, b = side ? side(uu) * w : 0
      if (i > 0) {   // 梯形积分
        cy += 0.5 * (cos(pa) * cos(pb) + cos(a) * cos(b)) * dt
        cz += 0.5 * (sin(pa) + sin(a)) * dt
        cx += 0.5 * (sin(pb) * cos(pa) + sin(b) * cos(a)) * dt
      }
      const o = i * 5
      T[o] = cx; T[o + 1] = cy; T[o + 2] = cz; T[o + 3] = a; T[o + 4] = b
      pa = a; pb = b
    }
    lastU = u
  }
  return (u, p, out, info) => {
    const h = info.size[1] || 1, yf = p[1] / h
    if (yf <= from) return
    if (u !== lastU) build(u)
    const span = 1 - from
    let t1 = (yf - from) / span; if (t1 > 1) t1 = 1
    const f = t1 * steps, i0 = Math.min(steps - 1, Math.floor(f)), k = f - i0, o = i0 * 5
    const L = span * h
    const cx = (T[o] + (T[o + 5] - T[o]) * k) * L, cy = (T[o + 1] + (T[o + 6] - T[o + 1]) * k) * L, cz = (T[o + 2] + (T[o + 7] - T[o + 2]) * k) * L
    const a = T[o + 3] + (T[o + 8] - T[o + 3]) * k, b = T[o + 4] + (T[o + 9] - T[o + 4]) * k
    // 这一层里的偏移（相对柱子中轴）跟着这一层的朝向转
    const lx = p[0], lz = p[2]
    const ny = from * h + cy - lz * sin(a) - lx * sin(b)
    const nz = cz + lz * cos(a)
    const nx = cx + lx * cos(b)
    out[0] += nx - p[0]; out[1] += ny - p[1]; out[2] += nz - p[2]
  }
}

/**
 * 迈腿：没有骨骼，就把「低处、离中轴有一段距离」的顶点当成腿——脚掌前后摆得最多，越往上（髋）越少；往前迈的那半程顺带抬一下脚。
 * 左右两侧反相；沿身体长轴再按 pairs 错开相位（六足虫的三对腿是 1-3 同相、2 反相）。
 *   top     腿的上沿（归一化高度），从 top 往下权重渐增
 *   inner   |n.x| 小于它的算身体（肚皮）不算腿；soft = 过渡带宽度
 *   swing   脚掌前后摆幅（身高的几成）   lift 抬脚高度   pairs 沿长轴有几对腿   cycles 一个 clip 迈几步
 *   zRange  [a, b] 只在身长的这一段里找腿；maxX = |n.x| 超过它的不算（留给另一组更靠外的腿）
 *   mask    (n) => 0..1 额外的选区；phase = 整体相位偏移（手臂和同侧的腿反相：phase: Math.PI）
 *   arms    可选 { from, top, swing }：|n.x| 大于 from 的算手臂（高度到 top），和同侧的腿反相
 */
export function legs({ top = 0.42, inner = 0.12, soft = 0.12, swing = 0.1, lift = 0.04, pairs = 1, cycles = 1, zRange = null, maxX = 0, arms = null, mask = null, phase = 0 } = {}) {
  return (u, p, out, info) => {
    const n = norm(p, info)
    const h = info.size[1] || 1
    let ph = phase + (n.side > 0 ? 0 : Math.PI) + (pairs > 1 ? Math.floor(clamp01(n.z) * pairs * 0.9999) * Math.PI : 0)
    let tp = top, sw = swing, lf = lift
    if (arms && n.ax > arms.from) { tp = arms.top ?? top; sw = arms.swing ?? swing; lf = arms.lift ?? 0; ph += Math.PI }
    if (n.y >= tp) return
    let k = ramp(tp, tp * 0.35, n.y) * ramp(inner, inner + soft, n.ax)
    if (maxX) k *= ramp(maxX + 0.08, maxX, n.ax)
    if (mask) k *= mask(n)
    if (zRange) k *= ramp(zRange[0], zRange[0] + 0.08, n.z) * ramp(zRange[1], zRange[1] - 0.08, n.z)
    if (!(k > 1e-4)) return
    const a = u * TAU * cycles + ph
    out[2] += sw * h * sin(a) * k
    out[1] += lf * h * Math.max(0, cos(a)) * k * ramp(tp, 0, n.y)
  }
}

/** 整体抖（蓄力 / 眩晕 / 垂死的震颤）。amp = 身高的几成；freq = 一个 clip 里抖几下；越高抖得越多（脚不滑） */
export function tremble({ amp = 0.01, freq = 9, gate = null } = {}) {
  return (u, p, out, info) => {
    const g = gate ? gate(u) : 1
    if (!g) return
    const h = info.size[1] || 1, k = amp * h * g * clamp01(p[1] / h + 0.15)
    out[0] += k * sin(u * TAU * freq + p[1] * 3.1); out[2] += k * 0.6 * sin(u * TAU * (freq + 2) + 1.7)
  }
}

/** 整体下蹲 / 压扁：高度乘 (1 − amt(u))，脚底不动；宽度按 bulge 略微撑开 */
export function squash(amt, bulge = 0.35) {
  return (u, p, out) => { const a = amt(u); if (!a) return; out[1] *= 1 - a; out[0] *= 1 + a * bulge; out[2] *= 1 + a * bulge * 0.5 }
}

/**
 * 倒地：绕前进轴滚 roll 弧度（正 = 往 +x 一侧倒；π = 仰面朝天），同时压扁到 flat，整个过程身体最低点一直贴着地。
 * k(u) 是进度 0..1（不写 = 先抽搐一下再倒）。比 proc/deform.js 的 collapse 多了「能翻过 90°」。
 */
export function topple({ roll = 1.4, flat = 0.6, twitch = 0.05, k = null, sink = 0, weight = null } = {}) {
  return (u, p, out, info) => {
    let t = k ? k(u) : ease((u - 0.12) / 0.78)
    if (weight) { t *= weight(norm(p, info), u); if (!(t > 1e-4)) return }
    const h = info.size[1] || 1, hw = info.size[0] * 0.5
    const r = roll * t + twitch * bump(u, 0, 0.3) * sin(u * 70)
    const f = 1 - (1 - flat) * t
    const c = cos(r), s = sin(r)
    const x = out[0], y = (out[1] - h * 0.5) * f
    // 转过之后的半高：保证最低点贴地
    const half = abs(hw * s) + abs(h * 0.5 * f * c)
    out[0] = x * c + y * s
    out[1] = Math.max(0, -x * s + y * c + half * (1 - 0.18 * t)) - sink * h * ramp(0.75, 1, u)
  }
}

/** 压到地面以上（倒地的最后一步：钻到地下的顶点贴回地面） */
export function ground(y = 0) { return (u, p, out) => { if (out[1] < y) out[1] = y } }

/** 选区小工具：返回 (n) => 0..1 */
export const above = (a, b) => (n) => ramp(a, b, n.y)          // 高度从 a 到 b 渐入
export const below = (a, b) => (n) => ramp(a, b, n.y)          // 写成 below(0.5, 0.3)：0.5 以上为 0，0.3 以下为 1
export const outer = (a, b) => (n) => ramp(a, b, n.ax)         // 离中轴从 a 到 b 渐入
export const front = (a, b) => (n) => ramp(a, b, n.z)          // 从尾（0）到头（1）：a → b 渐入
export const all = (...ws) => (n, u) => { let k = 1; for (const w of ws) { k *= w(n, u); if (k <= 0) return 0 } return k }
