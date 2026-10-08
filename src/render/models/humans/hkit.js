// models/humans/hkit.js —— 我方单位专用的建模补充：倒角盒、挤出轮廓、矩形截面梁。
// 基础工具（box / prism / tube / lathe / Rig ...）仍然来自 proc/kit.js，这里只加「让机械件不像玩具」需要的几样：
//   cbox     全倒角盒（12 条棱都切角，平直着色下每条棱都会接到一道高光）
//   slab     只切顶面四条棱的甲片（俯视机位下最划算）
//   extrudeX 侧视轮廓沿 X 挤出（车体、机身、脚掌）   extrudeY 俯视轮廓沿 Y 挤出（甲板、机翼）
//   beam     两点之间的矩形截面梁（机甲肢体、支架）
import * as THREE from 'three'
import { flat, V3 } from '../../proc/kit.js'
export * from '../../proc/kit.js'

const _m = new THREE.Matrix4(), _e = new THREE.Euler()

function finish(pos, o, x, y, z, h) {
  if (o.taper || o.shear) {
    const tp = o.taper || [1, 1], sh = o.shear || [0, 0]
    for (let i = 0; i < pos.length; i += 3) {
      const k = pos[i + 1] / h + 0.5
      pos[i] = pos[i] * (1 + (tp[0] - 1) * k) + sh[0] * k; pos[i + 2] = pos[i + 2] * (1 + (tp[1] - 1) * k) + sh[1] * k
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  if (o.r) { _e.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0, 'YXZ'); g.applyMatrix4(_m.makeRotationFromEuler(_e)) }
  g.translate(x, y, z)
  g.computeVertexNormals()
  return g
}
function polyWriter() {
  const pos = []
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const cx = a[0] + b[0] + c[0], cy = a[1] + b[1] + c[1], cz = a[2] + b[2] + c[2]
    if (nx * cx + ny * cy + nz * cz < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c)
  }
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d) }
  return { pos, tri, quad }
}

/** 全倒角盒。o: { c: 倒角宽度（默认最短边的 18%）, taper, shear, r } 其余同 box() */
export function cbox(w, h, d, x = 0, y = 0, z = 0, o = {}) {
  const mn = Math.min(w, h, d), c = Math.min(o.c ?? mn * 0.18, mn * 0.49)
  const hx = w / 2, hy = h / 2, hz = d / 2
  const { pos, tri, quad } = polyWriter()
  const X = (sx, sy, sz) => [sx * hx, sy * (hy - c), sz * (hz - c)]
  const Y = (sx, sy, sz) => [sx * (hx - c), sy * hy, sz * (hz - c)]
  const Z = (sx, sy, sz) => [sx * (hx - c), sy * (hy - c), sz * hz]
  for (const s of [1, -1]) {
    quad(X(s, 1, 1), X(s, 1, -1), X(s, -1, -1), X(s, -1, 1))
    quad(Y(1, s, 1), Y(1, s, -1), Y(-1, s, -1), Y(-1, s, 1))
    quad(Z(1, 1, s), Z(1, -1, s), Z(-1, -1, s), Z(-1, 1, s))
    for (const t of [1, -1]) {
      quad(X(s, t, 1), X(s, t, -1), Y(s, t, -1), Y(s, t, 1))
      quad(X(s, 1, t), X(s, -1, t), Z(s, -1, t), Z(s, 1, t))
      quad(Y(1, s, t), Y(-1, s, t), Z(-1, s, t), Z(1, s, t))
      for (const q of [1, -1]) tri(X(s, t, q), Y(s, t, q), Z(s, t, q))
    }
  }
  return finish(pos, o, x, y, z, h)
}

/** 甲片：只切顶面四条棱（底面省掉）。c 默认高度的 60% */
export function slab(w, h, d, x = 0, y = 0, z = 0, o = {}) {
  const c = Math.min(o.c ?? h * 0.6, Math.min(w, d) * 0.45), hx = w / 2, hy = h / 2, hz = d / 2
  const { pos, quad } = polyWriter()
  const B = (sx, sz) => [sx * hx, -hy, sz * hz], M = (sx, sz) => [sx * hx, hy - Math.min(c, h * 0.95), sz * hz], T = (sx, sz) => [sx * (hx - c), hy, sz * (hz - c)]
  quad(T(1, 1), T(1, -1), T(-1, -1), T(-1, 1))
  const ring = [[1, 1], [1, -1], [-1, -1], [-1, 1]]
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[(i + 1) % 4]
    quad(B(...a), B(...b), M(...b), M(...a)); quad(M(...a), M(...b), T(...b), T(...a))
  }
  if (o.bottom) quad(B(1, 1), B(1, -1), B(-1, -1), B(-1, 1))
  // polyWriter 按「远离原点」定绕序；薄片的侧面也满足（原点在盒心）
  return finish(pos, o, x, y, z, h)
}

function extrude(pts, depth, bevel) {
  const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])))
  const b = Math.min(bevel || 0, depth * 0.45)
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, steps: 1, curveSegments: 1 })
  g.translate(0, 0, -(depth - 2 * b) / 2)
  return g
}
/** 侧视轮廓 pts = [[z, y], ...] 沿 X 挤出 width，中心在 x。o: { bevel } */
export function extrudeX(pts, width, x = 0, o = {}) {
  const g = extrude(pts, width, o.bevel)
  g.rotateY(-Math.PI / 2)      // 轮廓 x -> 模型 z，挤出方向 -> 模型 -x
  g.translate(x, 0, 0)
  return flat(g)
}
/** 俯视轮廓 pts = [[x, z], ...] 沿 Y 挤出 height，底面在 y。o: { bevel } */
export function extrudeY(pts, height, y = 0, o = {}) {
  const g = extrude(pts.map((p) => [p[0], -p[1]]), height, o.bevel)
  g.rotateX(-Math.PI / 2)      // 轮廓 y -> 模型 -z，挤出方向 -> 模型 +y
  g.translate(0, y + height / 2, 0)
  return flat(g)
}
/** 正视轮廓 pts = [[x, y], ...] 沿 Z 挤出 depth，中心在 z */
export function extrudeZ(pts, depth, z = 0, o = {}) {
  const g = extrude(pts, depth, o.bevel)
  g.translate(0, 0, z)
  return flat(g)
}

const _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3()
/**
 * 两点之间的矩形截面梁。w = 横向宽（垂直于 ref 与梁方向），t = 另一方向的厚度。
 * o: { c: 倒角（0 = 普通盒）, taper: [tw, tt] 末端相对起点的缩放, ref: 参考「前」方向 V3，默认 +Z }
 */
export function beam(a, b, w, t, o = {}) {
  const d = _vy.copy(b).sub(a), len = d.length(); d.normalize()
  const ref = o.ref || (Math.abs(d.z) > 0.92 ? V3(0, 1, 0) : V3(0, 0, 1))
  _vx.crossVectors(d, ref).normalize(); _vz.crossVectors(_vx, d).normalize()
  const g = o.c === 0 ? cbox(w, len, t, 0, len / 2, 0, { c: 0.0001, taper: o.taper }) : cbox(w, len, t, 0, len / 2, 0, { c: o.c, taper: o.taper })
  _m.makeBasis(_vx, d, _vz); _m.setPosition(a.x, a.y, a.z)
  g.applyMatrix4(_m); g.computeVertexNormals()
  return g
}
/** 把几何体整体旋转再平移（单件版的 group） */
export function place(g, r, p) {
  if (r) { _e.set(r[0] || 0, r[1] || 0, r[2] || 0, 'YXZ'); g.applyMatrix4(_m.makeRotationFromEuler(_e)) }
  if (p) g.translate(p[0], p[1], p[2])
  g.computeVertexNormals()
  return g
}
/** 平放的圆柱（关节轴、负重轮）：轴沿 X，中心在 (x, y, z) */
export function axle(r, len, x, y, z, n = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, n)
  g.rotateZ(Math.PI / 2); g.translate(x, y, z)
  return flat(g)
}
