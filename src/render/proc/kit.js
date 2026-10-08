// proc/kit.js —— 程序化建模工具：基础几何体 + 简单骨架（Rig），交给 gpuanim.bakeRig 烘成 VAT。
// 约定：模型朝 +Z，脚底 y=0，单位是米（游戏里的世界单位）。
// 机械件用硬边（flat），生物件用平滑法线（smooth）。
import * as THREE from 'three'

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion()

function xform(g, o) {
  if (!o) return g
  if (o.s) g.scale(o.s[0], o.s[1], o.s[2])
  if (o.r) { _e.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0, 'YXZ'); g.applyMatrix4(_m.makeRotationFromEuler(_e)) }
  if (o.p) g.translate(o.p[0], o.p[1], o.p[2])
  return g
}
/** 硬边：拆成非索引并重算面法线 */
export function flat(g) { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); n.computeVertexNormals(); return n }
/** 平滑：保留索引，重算法线 */
export function smooth(g) { g.deleteAttribute('uv'); g.computeVertexNormals(); return g }

/** 盒子。taper=[tx, tz]：顶面相对底面的缩放（做楔形 / 梯形甲片）；shear=[sx, sz]：顶面相对底面的偏移 */
export function box(w, h, d, x = 0, y = 0, z = 0, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d)
  if (o.taper || o.shear) {
    const P = g.attributes.position, tp = o.taper || [1, 1], sh = o.shear || [0, 0]
    for (let i = 0; i < P.count; i++) {
      const k = P.getY(i) / h + 0.5
      P.setX(i, P.getX(i) * (1 + (tp[0] - 1) * k) + sh[0] * k); P.setZ(i, P.getZ(i) * (1 + (tp[1] - 1) * k) + sh[1] * k)
    }
  }
  xform(g, { r: o.r, p: [x, y, z] })
  return flat(g)
}
/** n 边棱柱 / 棱台：沿 Y，底面在 y，底半径 r0、顶半径 r1。sx/sz 压扁成椭圆截面。硬边。 */
export function prism(n, r0, r1, h, x = 0, y = 0, z = 0, o = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h, n, 1, false, o.turn ?? Math.PI / n)
  g.translate(0, h / 2, 0)
  if (o.sx || o.sz) g.scale(o.sx || 1, 1, o.sz || 1)
  xform(g, { r: o.r, p: [x, y, z] })
  return o.smooth ? smooth(g) : flat(g)
}
/** 两点之间的圆管 / 锥管（炮管、腿、触须）。默认硬边 n 边形，smooth=true 给生物用 */
export function tube(a, b, r0, r1, n = 6, o = {}) {
  const d = b.clone().sub(a), len = d.length()
  const g = new THREE.CylinderGeometry(r1, r0, len, n, 1, !!o.open)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(_q.setFromUnitVectors(V3(0, 1, 0), d.normalize()))
  g.translate(a.x, a.y, a.z)
  return o.smooth ? smooth(g) : flat(g)
}
/** 椭球（平滑）。rot=[rx,ry,rz] */
export function ball(rx, ry, rz, x = 0, y = 0, z = 0, ws = 8, hs = 6, rot = null) {
  const g = new THREE.SphereGeometry(1, ws, hs)
  g.scale(rx, ry, rz)
  xform(g, { r: rot, p: [x, y, z] })
  return smooth(g)
}
/** 半球壳（肩甲 / 头盔 / 甲壳）：保留 y>=cut 的部分。flatShade 决定硬边 */
export function dome(rx, ry, rz, x = 0, y = 0, z = 0, ws = 8, hs = 4, o = {}) {
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, (o.arc ?? 0.5) * Math.PI)
  g.scale(rx, ry, rz)
  xform(g, { r: o.r, p: [x, y, z] })
  return o.smooth ? smooth(g) : flat(g)
}
/** 八面体宝石（眼睛 / 指示灯） */
export function gem(r, x, y, z, sx = 1, sy = 1, sz = 1) { const g = new THREE.OctahedronGeometry(r, 0); g.scale(sx, sy, sz); g.translate(x, y, z); return flat(g) }
/** 旋转体：profile = [[r, y], ...] 从下到上。axis='z' 时把 y 轴转到 +Z（炮管 / 罐体 / 虫节） */
export function lathe(profile, n = 10, o = {}) {
  const g = new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(Math.max(p[0], 1e-4), p[1])), n)
  if (o.axis === 'z') g.rotateX(Math.PI / 2)
  if (o.axis === 'x') g.rotateZ(-Math.PI / 2)
  xform(g, o)
  return o.smooth ? smooth(g) : flat(g)
}
/** 薄片（翼膜 / 旗 / 刀刃）：四个角点，双面 */
export function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry()
  const p = [a, b, c, a, c, d, a, c, b, a, d, c].flatMap((v) => [v.x, v.y, v.z])
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals()
  return g
}
/** 沿折线的锥形肢体（多段 tube 连起来），pts: Vector3[]，radii: number[] */
export function chain(pts, radii, n = 5, o = {}) {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) out.push(tube(pts[i], pts[i + 1], radii[i], radii[i + 1], n, o))
  return out
}
/** 把一组在原点建好的零件整体旋转 r=[rx,ry,rz] 再平移 p=[x,y,z]（炮塔、斜置炮管） */
export function group(geos, r, p) {
  _e.set(r ? r[0] || 0 : 0, r ? r[1] || 0 : 0, r ? r[2] || 0 : 0, 'YXZ')
  const m = new THREE.Matrix4().makeRotationFromEuler(_e)
  if (p) m.setPosition(p[0], p[1], p[2])
  const out = geos.flat(3).filter(Boolean)
  for (const g of out) { g.applyMatrix4(m) }
  return out
}
/** 圆环（光环 / 线圈 / 箍）：绕 Y 轴的环，R 大半径、r 管半径。axis 同 lathe */
export function ring(R, r, n = 12, m = 5, o = {}) {
  const g = new THREE.TorusGeometry(R, r, m, n); g.rotateX(Math.PI / 2)
  if (o.axis === 'z') g.rotateX(Math.PI / 2)
  if (o.axis === 'x') g.rotateZ(-Math.PI / 2)
  xform(g, o)
  return o.smooth ? smooth(g) : flat(g)
}
/** 镜像（x -> -x），保持绕序 */
export function mirrorX(g) {
  const c = g.clone(); c.scale(-1, 1, 1)
  if (c.index) { const a = c.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t } }
  else { const P = c.attributes.position.array; for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t } }
  c.computeVertexNormals()
  return c
}

/**
 * 骨架。bone(name, parent, x, y, z) 的 pivot 是「静止姿势下的模型坐标」，所以零件直接在模型坐标里建，
 * 挂到哪根骨头只决定它跟谁转。
 *   rig.bone('root', null, 0, 0, 0)
 *   rig.add('torso', AZ.PLATE, box(...), box(...))          // 可一次加多个几何体
 *   rig.pair('arm', ...)                                     // 见下
 *   rig.clip('walk', 10, 0.6, true, (u, P) => { P.r('legL', Math.sin(u * 6.283) * 0.5) })
 * P.r(bone, rx, ry, rz) 旋转（弧度，YXZ 顺序，累加）；P.t(bone, x, y, z) 平移；P.s(bone, s) 缩放
 */
export class Rig {
  constructor(opts = {}) { this.bones = []; this.parts = []; this.clips = []; this.height = opts.height || 0; this._idx = new Map() }
  bone(name, parent, x = 0, y = 0, z = 0) {
    const p = parent == null ? -1 : this._idx.get(parent)
    if (p === undefined) throw new Error('Rig: unknown parent bone ' + parent)
    this._idx.set(name, this.bones.length)
    this.bones.push({ name, parent: p, pivot: [x, y, z] })
    return this
  }
  add(bone, zone, ...geos) {
    const b = this._idx.get(bone)
    if (b === undefined) throw new Error('Rig: unknown bone ' + bone)
    for (const g of geos.flat(3)) if (g) this.parts.push({ geo: g, bone: b, zone, tint: 1 })
    return this
  }
  /** 给最近加的 n 个零件设顶点亮度系数（做明暗差） */
  shade(t, n = 1) { for (let i = this.parts.length - n; i < this.parts.length; i++) this.parts[i].tint = t; return this }
  /** 左右对称地加零件：在 +x 侧建模，自动镜像到 -x 侧。boneL/boneR 是两侧的骨头名 */
  both(boneR, boneL, zone, ...geos) {
    for (const g of geos.flat(3)) { if (!g) continue; this.add(boneR, zone, g); this.add(boneL, zone, mirrorX(g)) }
    return this
  }
  clip(name, frames, duration, loop, pose) { this.clips.push({ name, frames, duration, loop, pose }); return this }
  get triCount() { let n = 0; for (const p of this.parts) n += (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3; return n }
}

export const TAU = Math.PI * 2
export const sin = Math.sin, cos = Math.cos
/** 0..1..0 的平滑鼓包，u 在 [a,b] 之外为 0 */
export const bump = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin(((u - a) / (b - a)) * Math.PI))
export const ease = (u) => u * u * (3 - 2 * u)
export const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u)
