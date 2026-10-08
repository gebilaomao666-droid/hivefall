// models/aliens/kit.js —— 虫族专用的程序化建模工具（在 proc/kit.js 的 Rig 之上）。
// 目标是「甲壳分节 + 尖刺 + 不规则」而不是一串光滑的球：
//   loft    沿任意折线放样，截面可以上下不对称（平腹）、带背脊、带随机起伏，可以只放样一段弧
//   plate   一片甲壳（弧形放样，硬边，可带一圈圈生长纹）
//   blob    不规则椭球（任意朝向）       horn   弯角 / 尖刺 / 刀刃（扁截面，硬边）
//   seg     一节肢体                     fin    双面薄膜（翼 / 鳍 / 冠）
//   legs    成对的两节步足 + 步态 / 蜷腿 / 趴下
// 约定同 proc/kit.js：模型朝 +Z、脚底 y = 0、单位米。全部返回带 position / normal 的 BufferGeometry。
// 着色约定：甲壳、骨刺用硬边（一块块的几丁质），软组织用平滑法线——软硬对比比面数更能去掉「塑料气球」感。
import * as THREE from 'three'
import { Rig, mirrorX } from '../../proc/kit.js'
import { CZ } from '../../materials.js'

export { Rig, CZ, mirrorX }
export const PI = Math.PI, TAU = Math.PI * 2
export const sin = Math.sin, cos = Math.cos, abs = Math.abs, max = Math.max, min = Math.min
export const bump = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(((u - a) / (b - a)) * Math.PI))
export const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))
export const ramp = (u, a, b) => ease((u - a) / (b - a))
export const lerp = (a, b, t) => a + (b - a) * t
const hash = (a, b, s) => { const x = Math.sin(a * 127.1 + b * 311.7 + s * 74.7 + 1.3) * 43758.5453; return x - Math.floor(x) }
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e)

function finish(pos, idx, flat) {
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
  if (flat) g = g.toNonIndexed()
  g.computeVertexNormals()
  return g
}
const _e = new THREE.Euler(), _m = new THREE.Matrix4()
/** 整体变换一份几何：o = { s:[x,y,z]|n, r:[rx,ry,rz], p:[x,y,z] } */
export function xf(g, o) {
  if (o.s) { const s = typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s; g.scale(s[0], s[1], s[2]) }
  if (o.r) { _e.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0, 'YXZ'); g.applyMatrix4(_m.makeRotationFromEuler(_e)) }
  if (o.p) g.translate(o.p[0], o.p[1], o.p[2])
  if (o.s || o.r) g.computeVertexNormals()
  return g
}

/**
 * 放样。secs: [{ p:[x,y,z], w 半宽, h 上半高, b 下半高(默认 = h), crest 背脊(0..1), k 本圈整体缩放 }]
 * n: 圈上分段数。o: {
 *   arc:[a0,a1]   只放样这段弧（弧度，0 = 正上方，正方向朝 +右侧），不给 = 整圈
 *   cap0 / cap1   'tip' 收成尖（tip0 / tip1 = 尖伸出多长，或 tipP0 / tipP1 = 尖的坐标）
 *   up:[x,y,z]    第一圈的「上」方向（默认世界 +Y；路径竖直时默认 −Z）
 *   sq            截面方度：2 = 椭圆，> 2 偏方，< 2 偏菱形
 *   noise, seed   径向随机起伏（0.1 = ±10%）
 *   flat          硬边
 * }
 */
export function loft(secs, n, o = {}) {
  const N = secs.length, P = secs.map((s) => new THREE.Vector3(...s.p))
  const full = !o.arc, a0 = full ? 0 : o.arc[0], a1 = full ? TAU : o.arc[1]
  const cols = full ? n : n + 1
  const pos = [], idx = []
  const T = new THREE.Vector3(), U = new THREE.Vector3(), R = new THREE.Vector3()
  const tanAt = (i) => { if (N === 1 && o.tipP1) T.set(...o.tipP1).sub(P[0]); else T.copy(P[Math.min(N - 1, i + 1)]).sub(P[Math.max(0, i - 1)]); if (T.lengthSq() < 1e-10) T.set(0, 0, 1); return T.normalize() }
  tanAt(0)
  if (o.up) U.set(...o.up); else if (Math.abs(T.y) > 0.9) U.set(0, 0, -1); else U.set(0, 1, 0)
  const sq = o.sq ? 2 / o.sq : 1, nz = o.noise || 0, seed = o.seed || 0
  let tip0 = null, tip1 = null
  for (let i = 0; i < N; i++) {
    tanAt(i)
    U.addScaledVector(T, -U.dot(T)).normalize()
    R.crossVectors(U, T).normalize()
    const s = secs[i], k = s.k ?? 1, w = s.w * k, h = s.h * k, b = (s.b ?? s.h) * k
    for (let j = 0; j < cols; j++) {
      const a = a0 + (a1 - a0) * (j / n)
      let c = Math.cos(a), sn = Math.sin(a)
      if (sq !== 1) { c = spow(c, sq); sn = spow(sn, sq) }
      let up = c * (c >= 0 ? h : b), sd = sn * w
      if (s.crest && c > 0) up *= 1 + s.crest * Math.pow(c, 10)
      if (nz) { const f = 1 + nz * (hash(i, j % n, seed) - 0.5) * 2; up *= f; sd *= f }
      pos.push(P[i].x + U.x * up + R.x * sd, P[i].y + U.y * up + R.y * sd, P[i].z + U.z * up + R.z * sd)
    }
    if (i === 0 && o.cap0) tip0 = o.tipP0 ? o.tipP0 : [P[0].x - T.x * (o.tip0 || 0), P[0].y - T.y * (o.tip0 || 0), P[0].z - T.z * (o.tip0 || 0)]
    if (i === N - 1 && o.cap1) tip1 = o.tipP1 ? o.tipP1 : [P[i].x + T.x * (o.tip1 || 0), P[i].y + T.y * (o.tip1 || 0), P[i].z + T.z * (o.tip1 || 0)]
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < n; j++) {
    const j1 = full ? (j + 1) % n : j + 1
    const a = i * cols + j, b = i * cols + j1, c = (i + 1) * cols + j1, d = (i + 1) * cols + j
    idx.push(a, d, b, b, d, c)
  }
  if (tip0) { const t = pos.length / 3; pos.push(...tip0); for (let j = 0; j < n; j++) { const j1 = full ? (j + 1) % n : j + 1; idx.push(t, j, j1) } }
  if (tip1) { const t = pos.length / 3, base = (N - 1) * cols; pos.push(...tip1); for (let j = 0; j < n; j++) { const j1 = full ? (j + 1) % n : j + 1; idx.push(base + j, t, base + j1) } }
  return finish(pos, idx, o.flat)
}

// ------------------------------------------------------------------ 细分 + 平滑（中大型虫 / Boss 用；小虫不走这一步）
// 低模放样出来的零件是一块块平面（近看像折纸）。refineRig 对每个零件：焊接顶点 → Loop 细分（面数 ×4^levels，表面收圆）
// → 按原包围盒把尺寸拉回去（细分会让形体缩一圈，缩了零件之间就露缝）→ 低频噪声做不规则起伏 / 尖刺弯折 → 平滑法线。
// 零件仍然各自刚性地挂在一根骨头上，所以动画完全不受影响。
const vhash = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n) }
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  let fx = x - ix, fy = y - iy, fz = z - iz
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz)
  const L = (a, b, t) => a + (b - a) * t
  return L(L(L(vhash(ix, iy, iz), vhash(ix + 1, iy, iz), fx), L(vhash(ix, iy + 1, iz), vhash(ix + 1, iy + 1, iz), fx), fy),
    L(L(vhash(ix, iy, iz + 1), vhash(ix + 1, iy, iz + 1), fx), L(vhash(ix, iy + 1, iz + 1), vhash(ix + 1, iy + 1, iz + 1), fx), fy), fz)
}
const fbm3 = (x, y, z) => vnoise3(x, y, z) * 0.6 + vnoise3(x * 2.3 + 5.1, y * 2.3 + 1.7, z * 2.3 + 9.2) * 0.4

/** 焊接：同一位置的顶点合成一个。返回 { pos:number[], tint:number[], idx:number[] }（退化三角形丢掉） */
function weldGeo(g) {
  const P = g.attributes.position, T = g.attributes.tint, I = g.index
  const map = new Map(), pos = [], tint = [], re = new Uint32Array(P.count)
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i)
    const k = Math.round(x * 2e4) + '|' + Math.round(y * 2e4) + '|' + Math.round(z * 2e4)
    let w = map.get(k)
    if (w === undefined) { w = pos.length / 3; map.set(k, w); pos.push(x, y, z); tint.push(T ? T.getX(i) : 1) }
    re[i] = w
  }
  const idx = [], n = I ? I.count : P.count
  for (let i = 0; i < n; i += 3) {
    const a = re[I ? I.getX(i) : i], b = re[I ? I.getX(i + 1) : i + 1], c = re[I ? I.getX(i + 2) : i + 2]
    if (a !== b && b !== c && c !== a) idx.push(a, b, c)
  }
  return { pos, tint, idx }
}
/** 一次 Loop 细分。网格不是流形（一条边挂了 3 个以上的面：双面薄膜）时返回 null */
function loopOnce(m) {
  const { pos, tint, idx } = m, nV = pos.length / 3
  const edges = new Map()
  const E = (a, b, o) => { const k = a < b ? a * nV + b : b * nV + a; let e = edges.get(k); if (!e) { e = { a, b, o: [], v: -1 }; edges.set(k, e) } e.o.push(o); return e }
  const tris = []
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; tris.push(E(a, b, c), E(b, c, a), E(c, a, b)) }
  const nb = Array.from({ length: nV }, () => []), bd = Array.from({ length: nV }, () => [])
  for (const e of edges.values()) {
    if (e.o.length > 2) return null
    nb[e.a].push(e.b); nb[e.b].push(e.a)
    if (e.o.length === 1) { bd[e.a].push(e.b); bd[e.b].push(e.a) }
  }
  const np = new Array(nV * 3), nt = new Array(nV)
  for (let v = 0; v < nV; v++) {
    const o = v * 3
    if (bd[v].length) {   // 边界顶点：沿边界曲线平滑；边界拓扑不干净（不是正好两条）就原地不动
      if (bd[v].length === 2) { const a = bd[v][0] * 3, b = bd[v][1] * 3; for (let k = 0; k < 3; k++) np[o + k] = pos[o + k] * 0.75 + (pos[a + k] + pos[b + k]) * 0.125; nt[v] = tint[v] * 0.75 + (tint[bd[v][0]] + tint[bd[v][1]]) * 0.125 }
      else { np[o] = pos[o]; np[o + 1] = pos[o + 1]; np[o + 2] = pos[o + 2]; nt[v] = tint[v] }
      continue
    }
    const n = nb[v].length
    if (n < 3) { np[o] = pos[o]; np[o + 1] = pos[o + 1]; np[o + 2] = pos[o + 2]; nt[v] = tint[v]; continue }
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n)
    let sx = 0, sy = 0, sz = 0, st = 0
    for (const j of nb[v]) { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; st += tint[j] }
    np[o] = pos[o] * (1 - n * beta) + sx * beta; np[o + 1] = pos[o + 1] * (1 - n * beta) + sy * beta; np[o + 2] = pos[o + 2] * (1 - n * beta) + sz * beta
    nt[v] = tint[v] * (1 - n * beta) + st * beta
  }
  for (const e of edges.values()) {
    e.v = np.length / 3
    const a = e.a * 3, b = e.b * 3
    if (e.o.length === 2) {
      const c = e.o[0] * 3, d = e.o[1] * 3
      for (let k = 0; k < 3; k++) np.push((pos[a + k] + pos[b + k]) * 0.375 + (pos[c + k] + pos[d + k]) * 0.125)
      nt.push((tint[e.a] + tint[e.b]) * 0.375 + (tint[e.o[0]] + tint[e.o[1]]) * 0.125)
    } else { for (let k = 0; k < 3; k++) np.push((pos[a + k] + pos[b + k]) * 0.5); nt.push((tint[e.a] + tint[e.b]) * 0.5) }
  }
  const ni = []
  for (let i = 0, t = 0; i < idx.length; i += 3, t += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2], ab = tris[t].v, bc = tris[t + 1].v, ca = tris[t + 2].v
    ni.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
  }
  return { pos: np, tint: nt, idx: ni }
}
const bboxOf = (pos) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v } return { lo, hi } }

/**
 * 细分 + 平滑整个 Rig（原地改 rig.parts[].geo）。o: {
 *   levels  细分次数（1 = 面数 ×4，2 = ×16）
 *   hard    这些骨头上的零件保持硬边不细分（碎甲板、土堆这类「不是生物」的东西），骨头名数组
 *   disp    表面起伏幅度（相对零件的最小边长，0.03 = 3%）；bend = 尖刺（BONE 区）的弯折幅度（相对零件长度）
 *   freq    起伏噪声的空间频率（每米几个起伏）
 *   seed
 * }
 */
export function refineRig(rig, o = {}) {
  const levels = o.levels ?? 1, disp = o.disp ?? 0.03, bend = o.bend ?? 0.05, freq = o.freq ?? 1.6, seed = o.seed ?? 0
  const hard = new Set((o.hard || []).map((n) => rig._idx.get(n)))
  rig.parts.forEach((pt, pi) => {
    if (hard.has(pt.bone)) return
    const isHorn = !!pt.geo.attributes.tint                  // horn() 出来的零件带沿长度的 tint：只有它们做「弯折」
    let m = weldGeo(pt.geo)
    if (m.idx.length < 9) return
    const b0 = bboxOf(m.pos)
    let done = 0
    for (let l = 0; l < levels; l++) { const n = loopOnce(m); if (!n) break; m = n; done++ }
    if (!done) return                                        // 双面薄膜（翼膜 / 鳍）：保持原样
    // 细分会把形体缩一圈：按原包围盒逐轴拉回去（零件之间靠重叠遮住接缝，缩了就露缝；尖刺也不至于细成针）
    const b1 = bboxOf(m.pos), sc = [1, 1, 1], c0 = [0, 0, 0], c1 = [0, 0, 0]
    for (let k = 0; k < 3; k++) { const e0 = b0.hi[k] - b0.lo[k], e1 = b1.hi[k] - b1.lo[k]; sc[k] = e1 > 1e-5 ? Math.min(1.6, Math.max(1, e0 / e1)) : 1; c0[k] = (b0.hi[k] + b0.lo[k]) / 2; c1[k] = (b1.hi[k] + b1.lo[k]) / 2 }
    const pos = m.pos
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = (pos[i + k] - c1[k]) * sc[k] + c0[k]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(m.idx); g.computeVertexNormals()
    // 不规则化：甲壳 / 软组织沿法线做低频起伏；骨刺整体往一侧弯（越靠尖端越多），每根弯的方向不一样
    const ext = [b0.hi[0] - b0.lo[0], b0.hi[1] - b0.lo[1], b0.hi[2] - b0.lo[2]].sort((a, b) => a - b)
    const P = g.attributes.position, N = g.attributes.normal, s0 = seed * 13.7 + pi * 0.37
    if (isHorn && bend > 0) {
      const len = ext[2], bx = (vhash(pi, 1.3, seed) - 0.5) * 2, by = (vhash(pi, 2.7, seed) - 0.5) * 2, bz = (vhash(pi, 4.1, seed) - 0.5) * 2
      for (let i = 0; i < P.count; i++) { const t = m.tint[i], k = Math.max(0, t - 0.55) / 0.7, a = bend * len * k * k; P.setXYZ(i, P.getX(i) + bx * a, P.getY(i) + by * a * 0.6, P.getZ(i) + bz * a) }
    } else if (disp > 0 && pt.zone !== CZ.GLOW && pt.zone !== CZ.GLOW2) {
      const amp = disp * Math.max(ext[0], ext[1] * 0.5)
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), d = (fbm3(x * freq + s0, y * freq + s0 * 1.7, z * freq) - 0.5) * 2 * amp; P.setXYZ(i, x + N.getX(i) * d, y + N.getY(i) * d, z + N.getZ(i) * d) }
    }
    g.computeVertexNormals()
    g.setAttribute('tint', new THREE.Float32BufferAttribute(m.tint, 1))
    pt.geo = g
  })
  return rig
}

/** 把每一跨细分成 m 圈并做锯齿起伏：硬边下就是一圈圈生长纹 / 叠鳞 */
export function ribbed(secs, m, amp = 0.045) {
  const out = []
  let g = 0
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[i], b = secs[i + 1]
    for (let j = 0; j < m; j++, g++) {
      const t = j / m, k = 1 + amp * (g % 2 ? -1 : 1)
      out.push({ p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)], w: lerp(a.w, b.w, t) * k, h: lerp(a.h, b.h, t) * k, b: lerp(a.b ?? a.h, b.b ?? b.h, t) * k, crest: lerp(a.crest || 0, b.crest || 0, t) })
    }
  }
  out.push(secs[secs.length - 1])
  return out
}

/** 一片甲壳：放样的弧形版本，默认硬边。half = 弧的半角（弧度，1.57 = 半圈）；o.ribs = 每跨细分成几圈生长纹 */
export const plate = (secs, n, half = 1.4, o = {}) => loft(o.ribs ? ribbed(secs, o.ribs, o.ribAmp ?? 0.045) : secs, n, { flat: true, ...o, arc: [-half, half] })

/**
 * 不规则椭球。c:[x,y,z] 中心，r:[rx 宽, ry 高, rz 长]。o: { dir:[x,y,z] 长轴方向(默认 +Z), rings, belly(下半高比例), noise, seed, front(前端尖度 0..1), sq, flat }
 */
export function blob(c, r, n = 6, o = {}) {
  const rings = o.rings ?? 3, d = new THREE.Vector3(...(o.dir || [0, 0, 1])).normalize()
  const secs = []
  for (let i = 1; i <= rings; i++) {
    const ph = (i / (rings + 1)) * PI, t = -Math.cos(ph), rr = Math.sin(ph) * (1 + (o.front || 0) * -t * 0.35)
    secs.push({ p: [c[0] + d.x * r[2] * t, c[1] + d.y * r[2] * t, c[2] + d.z * r[2] * t], w: r[0] * rr, h: r[1] * rr, b: r[1] * rr * (o.belly ?? 1) })
  }
  const e = r[2] * (1 - Math.cos(PI / (rings + 1)))
  return loft(secs, n, { cap0: 'tip', tip0: e, cap1: 'tip', tip1: e, noise: o.noise, seed: o.seed, sq: o.sq, up: o.up, flat: o.flat })
}

/**
 * 弯角 / 尖刺 / 刀刃：从 a 到 b 收尖，默认硬边。r 根部半径。
 * o: { n 边数(默认 3), segs 段数(默认 1), bend:[dx,dy,dz] 中点偏移（弯曲）, flatten 扁度(< 1 = 刀刃), up, cap0, pow 收尖曲线, flat }
 */
export function horn(a, b, r, o = {}) {
  const segs = o.segs || 1, bd = o.bend || [0, 0, 0], secs = []
  for (let i = 0; i < segs; i++) {
    const t = i / segs, q = 4 * t * (1 - t)   // 二次贝塞尔：控制点 = 中点 + bend
    const rr = r * Math.pow(1 - t, o.pow ?? 0.8)
    secs.push({ p: [lerp(a[0], b[0], t) + bd[0] * q, lerp(a[1], b[1], t) + bd[1] * q, lerp(a[2], b[2], t) + bd[2] * q], w: rr * (o.flatten ?? 1), h: rr })
  }
  const g = loft(secs, o.n || 3, { cap1: 'tip', tipP1: b, cap0: o.cap0 ? 'tip' : null, tip0: 0, up: o.up, flat: o.flat ?? true })
  // 沿长度写一个 tint 属性（根 0.55 → 尖 1.25）：着色器拿它做「根部发暗、尖端发亮」的骨质渐变，refineRig 拿它算弯折
  const P = g.attributes.position, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz || 1
  const tint = new Float32Array(P.count)
  for (let i = 0; i < P.count; i++) { const t = ((P.getX(i) - a[0]) * dx + (P.getY(i) - a[1]) * dy + (P.getZ(i) - a[2]) * dz) / L2; tint[i] = 0.55 + 0.7 * Math.min(1, Math.max(0, t)) }
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 1))
  return g
}

/** 一节肢体：a → b 的锥管，两头开口（o.cap0 / o.cap1 = true 封成钝头），o.flatten 扁度，o.mid = 中段鼓起的倍数 */
export function seg(a, b, r0, r1, n = 4, o = {}) {
  const f = o.flatten ?? 1
  const secs = [{ p: a, w: r0 * f, h: r0 }]
  if (o.mid) secs.push({ p: [lerp(a[0], b[0], 0.4), lerp(a[1], b[1], 0.4), lerp(a[2], b[2], 0.4)], w: lerp(r0, r1, 0.4) * o.mid * f, h: lerp(r0, r1, 0.4) * o.mid })
  secs.push({ p: b, w: r1 * f, h: r1 })
  return loft(secs, n, { cap0: o.cap0 ? 'tip' : null, tip0: r0 * 0.5, cap1: o.cap1 ? 'tip' : null, tip1: r1 * 0.6, up: o.up, flat: o.flat, noise: o.noise, seed: o.seed })
}

/** 双面薄膜：pts 是一圈轮廓点（[x,y,z]），以 pts[0] 为扇心。两面各用一套顶点，法线才不会互相抵消 */
export function fin(pts) {
  const pos = pts.flat(), n = pts.length, pos2 = pos.concat(pos), idx = []
  for (let i = 1; i < n - 1; i++) { idx.push(0, i, i + 1); idx.push(n, n + i + 1, n + i) }
  return finish(pos2, idx, false)
}

/** 四面体小灯（眼睛），4 个面 */
export function eye(x, y, z, r, sx = 1, sy = 1, sz = 1) {
  const p = [x, y + r * sy, z, x - r * sx, y - r * sy * 0.6, z - r * sz * 0.6, x + r * sx, y - r * sy * 0.6, z - r * sz * 0.6, x, y - r * sy * 0.3, z + r * sz * 1.2]
  return finish(p, [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3], true)
}

/**
 * 成对的两节步足。specs: [{ z, dz, reach, phase, ... }]，common 是公共参数：
 *   hipX, hipY 髋关节；reach 脚离髋的横向距离；dz 脚相对髋的前后偏移；knee 膝盖比髋高多少；kneeAt 膝盖的横向位置比例(0.5)
 *   r 大腿半径；n 边数；swing 摆幅；lift 抬脚；two = true 时小腿单独一根骨头（走路会屈膝）；spur = 膝盖上的骨刺长度
 *   zone / tip 大腿 / 小腿的 zone；thigh = 大腿中段鼓起倍数
 * 返回 gait(u, P, amp) 以及 gait.curl(P, k) / gait.splay(P, k) / gait.legs
 */
export function legs(rig, parent, specs, common, pre = 'leg') {
  const L = []
  specs.forEach((sp, i) => {
    const q = { kneeAt: 0.5, knee: 0.2, n: 3, swing: 0.45, lift: 0.35, footY: 0, ...common, ...sp }
    for (const side of [1, -1]) {
      const name = `${pre}${i}${side > 0 ? 'R' : 'L'}`
      const hip = [side * q.hipX, q.hipY, q.z]
      const knee = [side * (q.hipX + q.reach * q.kneeAt), q.hipY + q.knee, q.z + q.dz * 0.4]
      const foot = [side * (q.hipX + q.reach), q.footY, q.z + q.dz]
      rig.bone(name, parent, hip[0], hip[1], hip[2])
      rig.add(name, q.zone ?? CZ.LIMB, seg(hip, knee, q.r, q.r * 0.8, q.n, { mid: q.thigh, flat: q.n > 3 }))
      let shin = name
      if (q.two) { shin = name + 'b'; rig.bone(shin, name, knee[0], knee[1], knee[2]) }
      rig.add(shin, q.tip ?? CZ.LIMB, horn(knee, foot, q.r * 0.85, { n: q.n, segs: q.shinSegs || 1, bend: [side * q.reach * 0.12, 0, 0], pow: 0.7, flat: q.n > 3 }))
      if (q.spur) rig.add(name, CZ.BONE, horn(knee, [knee[0] + side * q.spur * 0.5, knee[1] + q.spur, knee[2] - q.spur * 0.3], q.r * 0.7, { n: 3 }))
      L.push({ name, shin: q.two ? shin : null, side, phase: q.phase + (side > 0 ? 0 : PI), swing: q.swing, lift: q.lift })
    }
  })
  const gait = (u, P, amp = 1, sw = 1) => {
    for (const l of L) {
      const t = u * TAU + l.phase, up = Math.max(0, -Math.sin(t))
      P.r(l.name, 0, -l.side * l.swing * Math.cos(t) * amp * sw, l.side * l.lift * up * amp)
      if (l.shin) P.r(l.shin, 0, 0, -l.side * l.lift * 1.3 * up * amp)
    }
  }
  gait.curl = (P, k) => { for (const l of L) { P.r(l.name, 0, 0, l.side * 1.1 * k); if (l.shin) P.r(l.shin, 0, 0, -l.side * 1.3 * k) } }
  gait.splay = (P, k) => { for (const l of L) { P.r(l.name, 0, 0, -l.side * 0.4 * k); if (l.shin) P.r(l.shin, 0, 0, l.side * 0.5 * k) } }
  gait.legs = L
  return gait
}

/** 侧翻 + 蜷腿的通用死亡 */
export function flipDeath(rig, gait, dur, extra) {
  rig.clip('die', 8, dur, false, (u, P) => {
    const k = ease(u)
    P.r('root', 0, 0, PI * 0.9 * k).t('root', 0, bump(u, 0, 1) * 0.3 + 0.1 * k, 0)
    if (gait) gait.curl(P, k)
    if (extra) extra(u, P, k)
  })
}
