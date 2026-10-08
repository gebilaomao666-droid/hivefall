// models/world/kitbash.js —— 把 assets/models 里的 CC0 模块件（Kenney / KayKit / Quaternius）读成「可拼装的静态零件」。
// 每个零件 = 一份合并好的几何体：position / normal / color（原材质颜色 × 贴图采样，烘成顶点色，线性空间）。
// 归一化：x/z 居中、底面 y = 0，尺寸保持原模型单位（摆的时候自己给缩放）。
//   const kit = await loadKit({ container: 'env/kenney-industrial_shipping-container-a', ... })
//   const mesh = assemble(kit, [{ part: 'container', x, y, z, ry, s | sx/sy/sz, tint: [r,g,b], sat }], material)   // 全部焊成一个 Mesh（一次 draw call）
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ASSET_ROOT, assetUrl } from '../../base.js'

const loader = new GLTFLoader()
const cache = new Map()
const BASE = ASSET_ROOT + 'models/'

const imgCache = new Map()
function pixelsOf(tex) {
  const img = tex && tex.image
  if (!img || !img.width) return null
  let p = imgCache.get(img)
  if (!p) {
    const c = document.createElement('canvas'); c.width = Math.min(256, img.width); c.height = Math.min(256, img.height)
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height)
    p = { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, flipY: tex.flipY }
    imgCache.set(img, p)
  }
  return p
}
const _c = new THREE.Color(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3()

/** 读一个 glb，返回 { geo, size: Vector3, tris }。失败返回 null（调用方跳过这个零件，不报错） */
export function loadPart(file) {
  if (cache.has(file)) return cache.get(file)
  const p = loader.loadAsync(BASE + file + '.glb').then((gltf) => {
    const pos = [], nor = [], col = []
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((m) => {
      if (!m.isMesh) return
      const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, VC = g.attributes.color
      const mat = Array.isArray(m.material) ? m.material[0] : m.material
      const px = mat && mat.map ? pixelsOf(mat.map) : null
      const base = mat && mat.color ? mat.color : _c.set(1, 1, 1)
      const br = base.r, bg = base.g, bb = base.b
      _nm.getNormalMatrix(m.matrixWorld)
      const idx = g.index ? g.index.array : null, n = idx ? idx.length : P.count
      for (let k = 0; k < n; k++) {
        const i = idx ? idx[k] : k
        _v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); pos.push(_v.x, _v.y, _v.z)
        if (N) { _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); nor.push(_n.x, _n.y, _n.z) } else nor.push(0, 1, 0)
        let r = br, gg = bg, b = bb
        if (px && UV) {
          let u = UV.getX(i), v = UV.getY(i); u -= Math.floor(u); v -= Math.floor(v)
          const x = Math.min(px.w - 1, (u * px.w) | 0), y = Math.min(px.h - 1, ((px.flipY ? 1 - v : v) * px.h) | 0), o = (y * px.w + x) * 4
          _c.setRGB(px.d[o] / 255, px.d[o + 1] / 255, px.d[o + 2] / 255, THREE.SRGBColorSpace); r *= _c.r; gg *= _c.g; b *= _c.b
        }
        if (VC) { r *= VC.getX(i); gg *= VC.getY(i); b *= VC.getZ(i) }
        col.push(r, gg, b)
      }
    })
    if (!pos.length) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    geo.computeBoundingBox()
    const b = geo.boundingBox, size = b.getSize(new THREE.Vector3())
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
    return { file, geo, size, tris: pos.length / 9 }
  }).catch((e) => { console.info('[kitbash] 读不到 ' + file + '（跳过）：' + (e && e.message)); return null })
  cache.set(file, p)
  return p
}

/** loadKit({ 名字: 'env/xxx' }) -> { 名字: part | null } */
export async function loadKit(map) {
  const names = Object.keys(map)
  const parts = await Promise.all(names.map((n) => loadPart(map[n])))
  const kit = {}; names.forEach((n, i) => { kit[n] = parts[i] })
  return kit
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3()
/**
 * 把一批摆放焊成一个几何体。item: { part, x, y, z, rx, ry, rz, s | sx, sy, sz, fit: [w, h, d]（把零件拉到这个尺寸，和 s 二选一）,
 *   tint: [r, g, b]（乘到顶点色上）, sat: 0..1（保留多少原饱和度，默认 0.5）, gain（亮度，默认 1）,
 *   paint: [r, g, b]（重新上漆：丢掉原模型的色相，只留它的明暗当磨损 / 面片差异，整体换成这个颜色；paintKeep = 保留多少原明暗，默认 0.55）,
 *   cap: 亮度软上限（原模型里的纯白面压到这个亮度以下，默认不压） }
 */
export function assembleGeometry(kit, items) {
  let total = 0
  for (const it of items) { const p = kit[it.part]; if (p) total += p.geo.attributes.position.count }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3)
  let o = 0
  for (const it of items) {
    const part = kit[it.part]; if (!part) continue
    const P = part.geo.attributes.position.array, N = part.geo.attributes.normal.array, C = part.geo.attributes.color.array
    let sx = it.sx ?? it.s ?? 1, sy = it.sy ?? it.s ?? 1, sz = it.sz ?? it.s ?? 1
    if (it.fit) { sx = it.fit[0] / part.size.x; sy = it.fit[1] / part.size.y; sz = it.fit[2] / part.size.z }
    _e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ'); _q.setFromEuler(_e)
    _m.compose(_p.set(it.x || 0, it.y || 0, it.z || 0), _q, _s.set(sx, sy, sz))
    _nm.getNormalMatrix(_m)
    const sat = it.sat ?? 0.5, gain = it.gain ?? 1, t = it.tint || [1, 1, 1], paint = it.paint, keep = it.paintKeep ?? 0.55, cap = it.cap || 0
    for (let i = 0; i < P.length; i += 3) {
      _v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(_m); pos[o] = _v.x; pos[o + 1] = _v.y; pos[o + 2] = _v.z
      _n.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_nm).normalize(); nor[o] = _n.x; nor[o + 1] = _n.y; nor[o + 2] = _n.z
      let r = C[i], g = C[i + 1], b = C[i + 2], l = r * 0.3 + g * 0.6 + b * 0.1
      if (paint) {
        // 重新上漆：原色只贡献明暗（暗处 = 缝 / 门框 / 锈，亮处 = 面板），色相全换
        const k = (1 - keep) + keep * Math.min(1.6, l * 2.2)
        r = paint[0] * k; g = paint[1] * k; b = paint[2] * k
      } else {
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat
        if (cap > 0 && l > 1e-4) { const k = cap * (1 - Math.exp(-l / cap)) / l; r *= k; g *= k; b *= k }   // 软压：暗部几乎不动，纯白收到 cap 附近
      }
      col[o] = r * gain * t[0]; col[o + 1] = g * gain * t[1]; col[o + 2] = b * gain * t[2]
      o += 3
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.computeBoundingSphere()
  return geo
}
export function assemble(kit, items, material, o = {}) {
  const mesh = new THREE.Mesh(assembleGeometry(kit, items), material)
  mesh.castShadow = !!o.cast; mesh.receiveShadow = o.receive !== false; mesh.frustumCulled = false
  return mesh
}
