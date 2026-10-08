// gpuanim.js —— 顶点动画贴图（VAT）烘焙 + 紧凑实例化渲染
// 约定：所有单位烘焙后「脚底在 y=0、朝向 +Z、x/z 居中」。运行时没有 SkinnedMesh、没有骨骼计算。
//
// 两种来源，统一成同一种 VatAsset：
//   bakeGLTF(gltf, opts)  glb：带骨骼动画的逐帧 CPU 蒙皮；没有骨骼的静态网格用程序化姿态函数（clips[].deform）；带贴图的保留 UV
//   bakeRig(rig)          程序化几何 + 逐帧姿态函数（proc/kit.js 的 Rig）
//   buildVatAsset(src)    任意「逐帧顶点数据」
// 统一的实例化接口：
//   createAnimatedInstances({ asset, capacity, material, fragment, key, lerp, castShadow }) -> AnimatedInstances
//     .put(i, x, y, z, yaw, scale, frame, bright, flash, seed, roll, pitch, glow)   紧凑写法（热路径用）
//     .tint(i, r, g, b, amount)                                                     个体染色（精英 / 雇佣兵 / 冰冻）
//     .setInstance(i, matrix, color, clip, time)                                    契约写法（ARCHITECTURE §3）
//     .frame(clip, u) / .frameAt(clip, seconds)                                     clip 内时间 -> 绝对帧号
//     .commit(count)                                                                每帧一次
import * as THREE from 'three'

const TEX_W = 1024   // 每顶点占 2 个 texel（位置 / 法线），宽为偶数保证同一行
const toHalf = THREE.DataUtils.toHalfFloat

/**
 * src: { vertexCount, index:Uint32Array, zone:Float32Array, tint:Float32Array, uv?:Float32Array(2V),
 *        frames: [{pos:Float32Array(3V), nrm:Float32Array(3V)}...],
 *        clips: { name: {start, count, duration, loop} } }
 * 循环 clip 在 count 帧之后还要多存 1 帧（= 首帧）供插值；非循环 clip 末尾多存 1 帧（= 末帧）。
 */
export function buildVatAsset(src) { return runSync(buildVatAssetGen(src)) }
/** buildVatAsset 的分片版：每写完一帧 yield 一次（见 bakeGLTFAsync） */
export function* buildVatAssetGen(src) {
  const V = src.vertexCount, F = src.frames.length
  const rows = Math.ceil((V * 2) / TEX_W)
  const data = new Uint16Array(TEX_W * rows * F * 4)
  const one = toHalf(1)
  const seen = new Map()
  let bad = 0
  if (rows * F > 16384) console.warn(`[vat] 顶点动画贴图高 ${rows * F} 行，超过多数 GPU 的上限 16384：减面（现在 ${V} 顶点）或减帧（现在 ${F} 帧）`)
  for (let f = 0; f < F; f++) {
    const fr = src.frames[f]
    const base = f * rows * TEX_W * 4
    if (seen.has(fr)) { const b0 = seen.get(fr); data.copyWithin(base, b0, b0 + rows * TEX_W * 4); continue }
    seen.set(fr, base)
    const { pos, nrm } = fr
    for (let v = 0; v < V; v++) {
      const o = base + v * 8, p = v * 3
      let px = pos[p], py = pos[p + 1], pz = pos[p + 2]
      if (!(px - px === 0 && py - py === 0 && pz - pz === 0)) { px = 0; py = 0; pz = 0; bad++ }   // NaN / Infinity 进了贴图，整个实例在顶点着色器里就会炸成一片
      data[o] = toHalf(px); data[o + 1] = toHalf(py); data[o + 2] = toHalf(pz); data[o + 3] = one
      let nx = nrm[p], ny = nrm[p + 1], nz = nrm[p + 2]
      if (!(nx * nx + ny * ny + nz * nz > 1e-8)) { nx = 0; ny = 1; nz = 0 }   // 退化三角形的零法线会在着色器里 normalize 出 NaN
      data[o + 4] = toHalf(nx); data[o + 5] = toHalf(ny); data[o + 6] = toHalf(nz)
    }
    yield
  }
  if (bad) console.warn(`[vat] ${bad} 个顶点 · 帧的位置不是有限值，已置零（检查模型的蒙皮权重 / 姿态函数）`)
  const tex = new THREE.DataTexture(data, TEX_W, rows * F, THREE.RGBAFormat, THREE.HalfFloatType)
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(src.frames[0].pos.slice(), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(src.frames[0].nrm.slice(), 3))
  geo.setAttribute('aZone', new THREE.BufferAttribute(src.zone, 1))
  geo.setAttribute('aTint', new THREE.BufferAttribute(src.tint, 1))
  if (src.uv) geo.setAttribute('uv', new THREE.BufferAttribute(src.uv, 2))   // 带贴图的 glb
  geo.setIndex(new THREE.BufferAttribute(src.index, 1))
  geo.computeBoundingBox()
  return {
    geometry: geo, texture: tex, rowsPerFrame: rows, frameCount: F, vertexCount: V,
    triCount: src.index.length / 3, clips: src.clips, bounds: geo.boundingBox.clone(),
  }
}

// ------------------------------------------------------------------ 程序化来源
/**
 * rig（见 proc/kit.js）: {
 *   bones: [{ name, parent(index|-1), pivot:[x,y,z] }],
 *   parts: [{ geo:BufferGeometry, bone:index, zone, tint }],
 *   clips: [{ name, frames, duration, loop, pose:(u01, P) => void }],
 *   height?: 归一化身高（不给就按建模尺寸）
 * }
 */
export function bakeRig(rig) { return runSync(bakeRigGen(rig)) }
/** bakeRig 的分片版（用法同 bakeGLTFAsync） */
export async function bakeRigAsync(rig, slot) { return runSteps(bakeRigGen(rig), slot) }
export function* bakeRigGen(rig) {
  const nb = rig.bones.length
  let V = 0
  const idx = [], zone = [], tint = [], recs = []
  for (const pt of rig.parts) {
    const g = pt.geo, P = g.attributes.position, N = g.attributes.normal
    const base = V
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i))
    else for (let i = 0; i < P.count; i++) idx.push(base + i)
    const T = g.attributes.tint   // 可选的逐顶点明暗（models/aliens/kit.js 的 horn / refineRig 会写），再乘零件自己的 tint
    for (let i = 0; i < P.count; i++) { zone.push(pt.zone); tint.push((T ? T.getX(i) : 1) * (pt.tint ?? 1)) }
    recs.push({ P: P.array, N: N.array, n: P.count, base, bone: pt.bone })
    V += P.count
  }
  // 姿态对象：每帧重置，pose 函数往里写
  const rot = new Float32Array(nb * 3), mov = new Float32Array(nb * 3), scl = new Float32Array(nb * 3)
  const byName = new Map(rig.bones.map((b, i) => [b.name, i]))
  const bi = (name) => { const i = byName.get(name); if (i === undefined) throw new Error('bakeRig: unknown bone ' + name); return i }
  const P = {
    r(name, x = 0, y = 0, z = 0) { const o = bi(name) * 3; rot[o] += x; rot[o + 1] += y; rot[o + 2] += z; return P },
    t(name, x = 0, y = 0, z = 0) { const o = bi(name) * 3; mov[o] += x; mov[o + 1] += y; mov[o + 2] += z; return P },
    s(name, x = 1, y = x, z = x) { const o = bi(name) * 3; scl[o] *= x; scl[o + 1] *= y; scl[o + 2] *= z; return P },
    has: (name) => byName.has(name),
  }
  const world = rig.bones.map(() => new THREE.Matrix4())
  const T = new THREE.Matrix4(), R = new THREE.Matrix4(), S = new THREE.Matrix4(), e = new THREE.Euler()
  const solve = () => {
    for (let b = 0; b < nb; b++) {
      const bone = rig.bones[b], o = b * 3, pv = bone.pivot, m = world[b]
      m.makeTranslation(pv[0] + mov[o], pv[1] + mov[o + 1], pv[2] + mov[o + 2])
      e.set(rot[o], rot[o + 1], rot[o + 2], 'YXZ'); m.multiply(R.makeRotationFromEuler(e))
      m.multiply(S.makeScale(scl[o], scl[o + 1], scl[o + 2]))
      m.multiply(T.makeTranslation(-pv[0], -pv[1], -pv[2]))
      if (bone.parent >= 0) m.premultiply(world[bone.parent])
    }
  }
  const sample = () => {
    solve()
    const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3)
    for (const r of recs) {
      const m = world[r.bone].elements, Pa = r.P, Na = r.N
      // 法线用 3x3（骨骼只有旋转 + 近似均匀缩放，够用）
      for (let i = 0; i < r.n; i++) {
        const s = i * 3, o = (r.base + i) * 3
        const x = Pa[s], y = Pa[s + 1], z = Pa[s + 2]
        pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12]
        pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
        pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
        const nx = Na[s], ny = Na[s + 1], nz = Na[s + 2]
        const ax = m[0] * nx + m[4] * ny + m[8] * nz, ay = m[1] * nx + m[5] * ny + m[9] * nz, az = m[2] * nx + m[6] * ny + m[10] * nz
        const l = Math.hypot(ax, ay, az) || 1
        nrm[o] = ax / l; nrm[o + 1] = ay / l; nrm[o + 2] = az / l
      }
    }
    return { pos, nrm }
  }
  const frames = [], clips = {}
  for (const c of rig.clips) {
    const loop = c.loop !== false, start = frames.length, n = Math.max(1, c.frames | 0)
    for (let f = 0; f < n; f++) {
      rot.fill(0); mov.fill(0); scl.fill(1)
      const u = loop ? f / n : (n === 1 ? 0 : f / (n - 1))
      if (c.pose) c.pose(u, P)
      frames.push(sample())
      yield
    }
    frames.push(loop ? frames[start] : frames[frames.length - 1])
    clips[c.name] = { start, count: n, duration: c.duration || 1, loop }
  }
  if (!frames.length) { rot.fill(0); mov.fill(0); scl.fill(1); frames.push(sample()); frames.push(frames[0]); clips.idle = { start: 0, count: 1, duration: 1, loop: true } }
  if (rig.height) {   // 归一化：按第一帧的包围盒高度
    let lo = Infinity, hi = -Infinity; const p0 = frames[0].pos
    for (let i = 1; i < p0.length; i += 3) { if (p0[i] < lo) lo = p0[i]; if (p0[i] > hi) hi = p0[i] }
    const s = rig.height / (hi - lo || 1)
    const done = new Set()
    for (const fr of frames) { if (done.has(fr)) continue; done.add(fr); for (let i = 0; i < fr.pos.length; i++) fr.pos[i] *= s }
  }
  return yield* buildVatAssetGen({ vertexCount: V, index: new Uint32Array(idx), zone: new Float32Array(zone), tint: new Float32Array(tint), frames, clips })
}

// ------------------------------------------------------------------ glb 来源（带骨骼的，或者静态网格 + 程序化姿态函数）
function nodePath(o) { let s = ''; while (o) { s = o.name + '/' + s; o = o.parent } return s }
function readImagePixels(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
  return g.getImageData(0, 0, c.width, c.height)
}
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const finite = Number.isFinite

/**
 * 蒙皮权重清洗。Quaternius 的 armored_crab / flyer_wasp 里有几十个顶点的权重是 NaN（导出器对「没刷权重的顶点」做了 0 / 0）：
 * 一个 NaN 顶点 → 包围盒是 NaN → 归一化的缩放是 NaN → 整个模型全是 NaN（以前的现象：模型不出现 / 一团乱线）。
 * 处理：非有限值和越界的骨骼下标当 0；权重和归一到 1；权重全 0 的顶点从同一个三角形的邻居那里抄（最多传 4 轮），还没有就整个绑到第 0 根骨头。
 * 返回 { w: Float32Array(4n), j: Uint16Array(4n), fixed: 修了几个顶点 }
 */
function cleanSkin(g, nBones) {
  const SW = g.attributes.skinWeight, SI = g.attributes.skinIndex, n = g.attributes.position.count
  const w = new Float32Array(n * 4), j = new Uint16Array(n * 4), empty = []
  let fixed = 0
  for (let i = 0; i < n; i++) {
    let sum = 0, bad = false
    for (let k = 0; k < 4; k++) {
      let wk = SW.getComponent(i, k), jk = SI.getComponent(i, k)
      if (!finite(wk) || wk < 0 || !(jk >= 0 && jk < nBones)) { if (wk !== 0) bad = true; wk = 0; jk = 0 }
      w[i * 4 + k] = wk; j[i * 4 + k] = jk; sum += wk
    }
    if (sum > 1e-6) { if (bad || Math.abs(sum - 1) > 1e-3) { for (let k = 0; k < 4; k++) w[i * 4 + k] /= sum; if (bad) fixed++ } } else { empty.push(i); fixed++ }
  }
  if (empty.length) {
    const isEmpty = new Uint8Array(n); for (const i of empty) isEmpty[i] = 1
    const I = g.index, tn = I ? I.count : n
    for (let pass = 0; pass < 4 && empty.some((i) => isEmpty[i]); pass++) {
      for (let t = 0; t < tn; t += 3) {
        const a = I ? I.getX(t) : t, b = I ? I.getX(t + 1) : t + 1, c = I ? I.getX(t + 2) : t + 2
        for (const [e, d1, d2] of [[a, b, c], [b, c, a], [c, a, b]]) {
          if (!isEmpty[e]) continue
          const d = !isEmpty[d1] ? d1 : (!isEmpty[d2] ? d2 : -1)
          if (d < 0) continue
          for (let k = 0; k < 4; k++) { w[e * 4 + k] = w[d * 4 + k]; j[e * 4 + k] = j[d * 4 + k] }
          isEmpty[e] = 2   // 这一轮刚补上的，下一轮才能再往外传
        }
      }
      for (const i of empty) if (isEmpty[i] === 2) isEmpty[i] = 0
    }
    for (const i of empty) if (isEmpty[i]) { w[i * 4] = 1; j[i * 4] = 0 }
  }
  return { w, j, fixed }
}

/** 把几张 baseColor 贴图拼成一张图集（多材质的 glb）。返回 { texture, cell(i) -> [u0, v0, su, sv] } */
function buildAtlas(maps) {
  const n = maps.length, grid = Math.ceil(Math.sqrt(n)), S = 1024, pad = 4
  const c = document.createElement('canvas'); c.width = c.height = grid * S
  const g = c.getContext('2d')
  maps.forEach((m, i) => {
    const x = (i % grid) * S, y = Math.floor(i / grid) * S
    if (m && m.image) { g.drawImage(m.image, x, y, S, S); g.drawImage(m.image, x + pad, y + pad, S - pad * 2, S - pad * 2) } else { g.fillStyle = '#808080'; g.fillRect(x, y, S, S) }
  })
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 4
  return { texture: tex, cell: (i) => [((i % grid) * S + pad) / (grid * S), (Math.floor(i / grid) * S + pad) / (grid * S), (S - pad * 2) / (grid * S), (S - pad * 2) / (grid * S)] }
}

/**
 * opts: {
 *   clips: [...]                              每项是下面两种之一：
 *     { name, match:RegExp | clip, frames, loop=true, trim, offset }        骨骼动画：match 去匹配 glb 里的动画名；匹配不到时烘成静态姿势
 *     { name, frames, duration, loop=true, deform:(u, p, out, info) => void, from?:RegExp }
 *                                             程序化姿态（AI 生成的模型没有骨骼，就靠它）：对「归一化之后的静止姿势」逐顶点变形。
 *                                             u = 0..1（clip 内时间），p = [x, y, z] 静止位置（米；脚底 y = 0、朝 +Z、x/z 居中），
 *                                             结果写进 out[0..2]；info = { size:[宽, 高, 长], min:[x,y,z], max:[x,y,z] }。现成的姿态函数见 proc/deform.js。
 *                                             from：可选，拿 glb 里某个动画的第 0 帧当静止姿势（默认用模型的绑定姿势 / 静态网格本身）
 *   include: (path, mesh) => bool            过滤网格（例如只留一把枪）
 *   zoneOf: ({mat, path, color, hsl}) => zoneId   材质分区（调色板下标 0..7；带贴图的模型一般不用管）
 *   textured: true | false                   带贴图烘焙：保留 UV，材质用 glb 自己的贴图（asset.maps）。不写时：有任何一个网格带 baseColor 贴图就自动开
 *   height | length | width                  归一化目标尺寸
 *   yaw                                      烘焙时绕 Y 旋转，让模型朝向 +Z
 *   smooth                                   true = 焊接顶点并逐帧重算平滑法线（生物）；false = 保留硬边（机械）
 *   shape: (path) => ({ s, pivot:'bone'|'parent'|'self' })   刚性部件体型微调
 *   boneScale: { bone, s }, globalScale: [x, y, z]
 * }
 */
export function bakeGLTF(gltf, opts) { return runSync(bakeGLTFGen(gltf, opts)) }
/**
 * 分片烘焙：和 bakeGLTF 结果完全一样，但每采 / 变形 / 重算完一帧就交回一次控制权。
 * slot()：每一步之后调一次；返回 Promise 就等它（让出主线程，例如等下一帧），返回 null / undefined 就接着算。
 * Boss 一只要烘 400~800ms，整块做会把那一帧卡住；切成每步 3~10ms，摊到几十帧里做就感觉不到
 */
export async function bakeGLTFAsync(gltf, opts, slot) { return runSteps(bakeGLTFGen(gltf, opts), slot) }
async function runSteps(it, slot) {
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
    const p = slot && slot()
    if (p) await p
  }
}
function runSync(it) { for (;;) { const r = it.next(); if (r.done) return r.value } }
export function* bakeGLTFGen(gltf, opts) {
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const meshes = []
  root.traverse((o) => { if (o.isMesh && (!opts.include || opts.include(nodePath(o), o))) meshes.push(o) })
  if (!meshes.length) throw new Error('bakeGLTF: no mesh matched')
  const matOf = (m) => (Array.isArray(m.material) ? m.material[0] : m.material) || {}
  const textured = opts.textured ?? meshes.some((m) => matOf(m).map && m.geometry.attributes.uv)

  // ---- 贴图：一张就直接用；多张拼图集（UV 改写到各自的格子里）----
  let maps = null, atlas = null
  const mapList = []
  if (textured) {
    for (const m of meshes) { const t = matOf(m).map || null; if (!mapList.includes(t)) mapList.push(t) }
    if (mapList.length === 1 && mapList[0]) {
      const mt = matOf(meshes[0])
      maps = { map: mt.map, normalMap: mt.normalMap || null, roughnessMap: mt.roughnessMap || null, metalnessMap: mt.metalnessMap || null, emissiveMap: mt.emissiveMap || null }
      // glb 里的倍率只在有对应贴图时才带上（没贴图的 glTF 默认 metallicFactor = 1，照搬会整个变成黑铁）
      if (mt.metalnessMap) maps.metalness = mt.metalness
      if (mt.roughnessMap) maps.roughness = mt.roughness
      if (mt.normalMap && mt.normalScale) maps.normalScale = mt.normalScale.x
    } else {
      atlas = buildAtlas(mapList); maps = { map: atlas.texture }
      console.info(`[bakeGLTF] ${mapList.length} 张 baseColor 贴图拼成了一张图集（法线 / 粗糙度贴图在多材质模型上不保留；UV 超出 0..1 靠平铺的贴图会错位）`)
    }
  }

  const recs = []; let V = 0; const idx = []
  const col = new THREE.Color(), hsl = {}, uvv = new THREE.Vector2()
  const zoneArr = [], tintArr = [], uvArr = []
  for (const m of meshes) {
    const g = m.geometry, n = g.attributes.position.count
    const mat = matOf(m), path = nodePath(m)
    const img = !textured && mat.map && mat.map.image ? readImagePixels(mat.map.image) : null
    const vc = g.attributes.color, uv = g.attributes.uv
    const cell = atlas ? atlas.cell(mapList.indexOf(mat.map || null)) : null
    for (let i = 0; i < n; i++) {
      if (mat.color) col.copy(mat.color); else col.setRGB(1, 1, 1)
      let tint = 1
      if (img && uv) {
        let u = uv.getX(i), v = uv.getY(i); u -= Math.floor(u); v -= Math.floor(v)
        const px = Math.min(img.width - 1, (u * img.width) | 0), py = Math.min(img.height - 1, (v * img.height) | 0)
        const o = (py * img.width + px) * 4
        col.r *= s2l(img.data[o] / 255); col.g *= s2l(img.data[o + 1] / 255); col.b *= s2l(img.data[o + 2] / 255)
      }
      if (vc) tint = Math.min(1.5, 0.2126 * vc.getX(i) + 0.7152 * vc.getY(i) + 0.0722 * vc.getZ(i))
      if (textured) {
        if (uv) uvv.set(uv.getX(i), uv.getY(i)); else uvv.set(0.5, 0.5)
        if (cell) {   // 图集：先套贴图自己的变换（KHR_texture_transform），再收进格子
          if (mat.map) { mat.map.updateMatrix(); uvv.applyMatrix3(mat.map.matrix) }
          uvv.set(cell[0] + (uvv.x - Math.floor(uvv.x)) * cell[2], cell[1] + (uvv.y - Math.floor(uvv.y)) * cell[3])
        }
        uvArr.push(uvv.x, uvv.y)
      }
      col.getHSL(hsl, THREE.LinearSRGBColorSpace)
      zoneArr.push(opts.zoneOf ? opts.zoneOf({ mat: mat.name, path, color: col, hsl, mesh: m, index: i }) : 0)
      tintArr.push(finite(tint) ? tint : 1)
      if ((i & 4095) === 4095) yield
    }
    const base = V
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i))
    else for (let i = 0; i < n - (n % 3); i++) idx.push(base + i)
    const rec = { m, base, n, shape: opts.shape ? opts.shape(path, m) : null, skin: null }
    if (m.isSkinnedMesh && m.skeleton && g.attributes.skinIndex && g.attributes.skinWeight) {
      rec.skin = cleanSkin(g, m.skeleton.bones.length)
      if (rec.skin.fixed) console.info(`[bakeGLTF] ${path} 有 ${rec.skin.fixed} 个顶点的蒙皮权重无效（NaN / 全 0 / 骨骼下标越界），已修复`)
    }
    recs.push(rec)
    V += n
  }

  // ---- 焊接：pg = 只按位置焊（算平滑法线用，UV 接缝两边的顶点法线要一致）；remap = 输出顶点（smooth 时合并，带贴图时 UV 不同的不合并）----
  const pg = new Uint32Array(V); let PG = 0
  let remap = null, VW = V
  {
    const pm = new Map(), om = opts.smooth ? new Map() : null
    if (om) { remap = new Uint32Array(V); VW = 0 }
    for (let mi = 0; mi < recs.length; mi++) {
      const r = recs[mi], p = r.m.geometry.attributes.position
      for (let i = 0; i < r.n; i++) {
        if ((i & 4095) === 4095) yield
        const k = mi + '|' + Math.round(p.getX(i) * 2e4) + '|' + Math.round(p.getY(i) * 2e4) + '|' + Math.round(p.getZ(i) * 2e4)
        let w = pm.get(k); if (w === undefined) { w = PG++; pm.set(k, w) }
        pg[r.base + i] = w
        if (om) {
          const o = (r.base + i) * 2
          const k2 = k + '|' + zoneArr[r.base + i] + (textured ? '|' + Math.round(uvArr[o] * 4096) + '|' + Math.round(uvArr[o + 1] * 4096) : '')
          let w2 = om.get(k2); if (w2 === undefined) { w2 = VW++; om.set(k2, w2) }
          remap[r.base + i] = w2
        }
      }
    }
  }

  yield
  const mixer = new THREE.AnimationMixer(root)
  const tmpP = new THREE.Vector3(), tmpN = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), v4 = new THREE.Vector3()
  let patched = 0
  const sampleFrame = () => {
    root.updateMatrixWorld(true)
    const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3)
    for (const r of recs) {
      const m = r.m, g = m.geometry, P = g.attributes.position, N = g.attributes.normal
      if (r.shape) {
        let src = r.shape.pivot === 'parent' && m.parent ? m.parent : m
        if (r.shape.pivot === 'bone') { src = m.parent; while (src && !src.isBone) src = src.parent; src = src || m }
        r.pv = new THREE.Vector3().setFromMatrixPosition(src.matrixWorld)
      }
      if (r.skin) {
        const sk = m.skeleton, W = r.skin.w, J = r.skin.j
        const mats = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[i]))
        const bind = m.bindMatrix
        const bsIdx = opts.boneScale ? sk.bones.findIndex((b) => b.name === opts.boneScale.bone) : -1
        const bsP = bsIdx >= 0 ? new THREE.Vector3().setFromMatrixPosition(sk.bones[bsIdx].matrixWorld) : null
        for (let i = 0; i < r.n; i++) {
          tmpP.fromBufferAttribute(P, i).applyMatrix4(bind)
          if (N) tmpN.fromBufferAttribute(N, i).transformDirection(bind); else tmpN.set(0, 1, 0)
          acc.set(0, 0, 0); accN.set(0, 0, 0)
          for (let k = 0; k < 4; k++) {
            const w = W[i * 4 + k]; if (w === 0) continue
            const bm = mats[J[i * 4 + k]]
            v4.copy(tmpP).applyMatrix4(bm); acc.addScaledVector(v4, w)
            v4.copy(tmpN).transformDirection(bm); accN.addScaledVector(v4, w)
          }
          if (bsIdx >= 0) { let w = 0; for (let k = 0; k < 4; k++) if (J[i * 4 + k] === bsIdx) w += W[i * 4 + k]; if (w > 0) acc.sub(bsP).multiplyScalar(1 + (opts.boneScale.s - 1) * w).add(bsP) }
          if (!(finite(acc.x) && finite(acc.y) && finite(acc.z))) { acc.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); patched++ }   // 骨骼矩阵本身坏了（缩放为 0 的动画帧）：退回绑定姿势
          const o = (r.base + i) * 3
          pos[o] = acc.x; pos[o + 1] = acc.y; pos[o + 2] = acc.z
          accN.normalize(); if (!finite(accN.x)) accN.set(0, 1, 0)
          nrm[o] = accN.x; nrm[o + 1] = accN.y; nrm[o + 2] = accN.z
        }
      } else {
        for (let i = 0; i < r.n; i++) {
          tmpP.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld)
          if (r.shape) tmpP.sub(r.pv).multiplyScalar(r.shape.s).add(r.pv)
          if (N) tmpN.fromBufferAttribute(N, i).transformDirection(m.matrixWorld); else tmpN.set(0, 1, 0)
          if (!(finite(tmpP.x) && finite(tmpP.y) && finite(tmpP.z))) { tmpP.set(0, 0, 0); patched++ }
          const o = (r.base + i) * 3
          pos[o] = tmpP.x; pos[o + 1] = tmpP.y; pos[o + 2] = tmpP.z
          nrm[o] = finite(tmpN.x) ? tmpN.x : 0; nrm[o + 1] = finite(tmpN.x) ? tmpN.y : 1; nrm[o + 2] = finite(tmpN.x) ? tmpN.z : 0
        }
      }
    }
    return { pos, nrm }
  }

  // ---- 第一遍：骨骼动画逐帧采样；程序化姿态的 clip 先占位 ----
  const frames = [], clips = {}, pending = []
  const find = (rx) => (rx ? gltf.animations.find((a) => rx.test(a.name)) : null)
  for (const c of opts.clips) {
    const loop = c.loop !== false
    if (c.deform) { pending.push(c); continue }
    const clip = c.clip || find(c.match)
    const start = frames.length
    if (!clip) {   // 静态姿势
      mixer.stopAllAction()
      frames.push(sampleFrame()); frames.push(frames[start])
      clips[c.name] = { start, count: 1, duration: 1, loop }
      continue
    }
    mixer.stopAllAction()
    const act = mixer.clipAction(clip); act.reset().play()
    const dur = clip.duration * (c.trim || 1), nf = Math.max(1, c.frames | 0)
    for (let f = 0; f < nf; f++) {
      const t = loop ? (f / nf) * dur : (nf === 1 ? 0 : (f / (nf - 1)) * dur * 0.999)
      mixer.setTime(t + (c.offset || 0))
      frames.push(sampleFrame())
      yield
    }
    frames.push(loop ? frames[start] : frames[frames.length - 1])
    clips[c.name] = { start, count: nf, duration: dur, loop }
  }
  // 程序化姿态要用的静止姿势（每个 from 各采一次）
  const rests = new Map()
  const restOf = (c) => {
    const key = c.from ? String(c.from) : ''
    if (rests.has(key)) return rests.get(key)
    mixer.stopAllAction()
    const a = find(c.from); if (a) { mixer.clipAction(a).reset().play(); mixer.setTime(0) }
    const fr = sampleFrame(); rests.set(key, fr); return fr
  }
  for (const c of pending) restOf(c)
  mixer.stopAllAction(); mixer.uncacheRoot(root)
  yield
  if (patched) console.info(`[bakeGLTF] 有 ${patched} 个顶点 · 帧算出了非有限值（骨骼矩阵退化），已退回绑定姿势`)

  // ---- 归一化：脚底 y=0、xz 居中、目标尺寸、朝向（包围盒取自第一帧；没有骨骼 clip 时取静止姿势）----
  const basis = frames.length ? frames[0] : rests.values().next().value
  const f0 = basis.pos; const bb = new THREE.Box3()
  for (let i = 0; i < V; i++) bb.expandByPoint(tmpP.set(f0[i * 3], f0[i * 3 + 1], f0[i * 3 + 2]))
  const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3())
  const yaw = opts.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw)
  const sizeAfterYaw = Math.abs(cy) > 0.7 ? size : new THREE.Vector3(size.z, size.y, size.x)
  let s = 1
  if (opts.height) s = opts.height / (size.y || 1); else if (opts.length) s = opts.length / (sizeAfterYaw.z || 1); else if (opts.width) s = opts.width / (sizeAfterYaw.x || 1)
  if (!finite(s) || s <= 0) s = 1
  const gs = opts.globalScale || [1, 1, 1]
  const done = new Set()
  const normalize = (fr) => {
    if (done.has(fr)) return; done.add(fr)
    const { pos, nrm } = fr
    for (let i = 0; i < V; i++) {
      const o = i * 3
      const x = (pos[o] - ctr.x) * s * gs[0], y = (pos[o + 1] - bb.min.y) * s * gs[1], z = (pos[o + 2] - ctr.z) * s * gs[2]
      pos[o] = x * cy + z * sy; pos[o + 1] = y; pos[o + 2] = -x * sy + z * cy
      let nx = nrm[o] / gs[0], ny = nrm[o + 1] / gs[1], nz = nrm[o + 2] / gs[2]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl
      nrm[o] = nx * cy + nz * sy; nrm[o + 1] = ny; nrm[o + 2] = -nx * sy + nz * cy
    }
  }
  for (const fr of frames) normalize(fr)
  for (const fr of rests.values()) normalize(fr)
  yield

  // ---- 第二遍：程序化姿态。对归一化后的静止姿势逐顶点变形，法线按「位置焊接组」重算（平滑，不受 UV 接缝影响）----
  const index0 = new Uint32Array(idx)
  const deformed = new Set()
  for (const c of pending) {
    const rest = restOf(c), loop = c.loop !== false, start = frames.length, nf = Math.max(1, c.frames | 0)
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]
    for (let i = 0; i < V * 3; i += 3) for (let k = 0; k < 3; k++) { const v = rest.pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v }
    const info = { size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], min: lo, max: hi }
    const p = [0, 0, 0], out = [0, 0, 0]
    for (let f = 0; f < nf; f++) {
      const u = loop ? f / nf : (nf === 1 ? 0 : f / (nf - 1))
      const pos = new Float32Array(V * 3), nrm = new Float32Array(V * 3)
      for (let i = 0; i < V; i++) {
        const o = i * 3
        p[0] = rest.pos[o]; p[1] = rest.pos[o + 1]; p[2] = rest.pos[o + 2]
        out[0] = p[0]; out[1] = p[1]; out[2] = p[2]
        c.deform(u, p, out, info)
        pos[o] = finite(out[0]) ? out[0] : p[0]; pos[o + 1] = finite(out[1]) ? out[1] : p[1]; pos[o + 2] = finite(out[2]) ? out[2] : p[2]
        if ((i & 4095) === 4095) yield
      }
      yield
      computeSmoothNormals(pos, index0, nrm, pg, PG)
      const fr = { pos, nrm }; frames.push(fr); deformed.add(fr)
      yield
    }
    frames.push(loop ? frames[start] : frames[frames.length - 1])
    clips[c.name] = { start, count: nf, duration: c.duration || 1, loop }
  }

  // ---- 输出 ----
  let index = index0, zone = new Float32Array(zoneArr), tint = new Float32Array(tintArr), uvOut = textured ? new Float32Array(uvArr) : null, outFrames = frames
  if (remap) {
    index = new Uint32Array(idx.length); for (let i = 0; i < idx.length; i++) index[i] = remap[idx[i]]
    zone = new Float32Array(VW); tint = new Float32Array(VW); if (textured) uvOut = new Float32Array(VW * 2)
    const pgW = new Uint32Array(VW)
    for (let i = 0; i < V; i++) { const w = remap[i]; zone[w] = zoneArr[i]; tint[w] = tintArr[i]; pgW[w] = pg[i]; if (textured) { uvOut[w * 2] = uvArr[i * 2]; uvOut[w * 2 + 1] = uvArr[i * 2 + 1] } }
    const cache = new Map()
    outFrames = []
    for (const fr of frames) {
      if (cache.has(fr)) { outFrames.push(cache.get(fr)); continue }
      const pos = new Float32Array(VW * 3), nrm = new Float32Array(VW * 3)
      for (let i = 0; i < V; i++) { const w = remap[i] * 3, o = i * 3; pos[w] = fr.pos[o]; pos[w + 1] = fr.pos[o + 1]; pos[w + 2] = fr.pos[o + 2] }
      yield
      computeSmoothNormals(pos, index, nrm, pgW, PG)
      const out = { pos, nrm }; cache.set(fr, out); outFrames.push(out)
      yield
    }
  }
  const asset = yield* buildVatAssetGen({ vertexCount: remap ? VW : V, index, zone, tint, uv: uvOut, frames: outFrames, clips })
  asset.maps = maps
  return asset
}

/**
 * 面积加权的平滑法线。group / groupCount 可选：group[v] = 这个顶点属于哪个「位置焊接组」——
 * 同一组的顶点（位置相同、UV 或分区不同而没被合并）共用一条法线，UV 接缝处不会出现一道硬边。
 */
export function computeSmoothNormals(pos, index, nrm, group, groupCount) {
  const acc = group ? new Float32Array(groupCount * 3) : nrm
  if (!group) nrm.fill(0)
  for (let i = 0; i < index.length; i += 3) {
    const ia = index[i], ib = index[i + 1], ic = index[i + 2]
    const a = ia * 3, b = ib * 3, c = ic * 3
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2]
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2]
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x
    if (!(nx === nx && ny === ny && nz === nz)) continue
    const A = group ? group[ia] * 3 : a, B = group ? group[ib] * 3 : b, C = group ? group[ic] * 3 : c
    acc[A] += nx; acc[A + 1] += ny; acc[A + 2] += nz
    acc[B] += nx; acc[B + 1] += ny; acc[B + 2] += nz
    acc[C] += nx; acc[C + 1] += ny; acc[C + 2] += nz
  }
  const n = nrm.length / 3
  for (let v = 0; v < n; v++) {
    const s = group ? group[v] * 3 : v * 3, o = v * 3
    const x = acc[s], y = acc[s + 1], z = acc[s + 2], l = Math.hypot(x, y, z)
    if (l > 1e-12) { nrm[o] = x / l; nrm[o + 1] = y / l; nrm[o + 2] = z / l } else { nrm[o] = 0; nrm[o + 1] = 1; nrm[o + 2] = 0 }
  }
}

// ------------------------------------------------------------------ 着色器注入
// 每实例 16 个 float：
//   aI0 = (x, y, z, yaw)
//   aI1 = (scale, frame(绝对帧号，小数部分用于插值), bright, flash)
//   aI2 = (seed, roll, pitch, glow)
//   aI3 = (tint.rgb, tintAmount)
const VAT_VERT_HEAD = /* glsl */`
uniform highp sampler2D uVat;
uniform vec2 uVatInfo; // (texWidth, rowsPerFrame)
attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3;
attribute float aZone; attribute float aTint;
varying float vZone; varying float vTint; varying vec4 vFx; varying vec3 vObj; varying vec3 vObjN; varying float vGlow; varying vec4 vTintC;
vec3 gVatP; vec3 gVatN;
void vatFetch(int frame, out vec3 p, out vec3 n) {
  int W = int(uVatInfo.x); int t = gl_VertexID * 2;
  int row = frame * int(uVatInfo.y) + t / W; int x = t - (t / W) * W;
  p = texelFetch(uVat, ivec2(x, row), 0).xyz;
  n = texelFetch(uVat, ivec2(x + 1, row), 0).xyz;
}
void vatCompute() {
  vec3 p; vec3 n; int f0 = int(floor(aI1.y));
  vatFetch(f0, p, n);
  #ifdef VAT_LERP
    vec3 p1; vec3 n1; vatFetch(f0 + 1, p1, n1);
    float k = fract(aI1.y); p = mix(p, p1, k); n = normalize(mix(n, n1, k) + vec3(0.0, 1e-5, 0.0));
  #endif
  vObj = position;   // 静止姿势坐标：片元里的程序纹理不会随动画滑动
  vObjN = normal;    // 静止姿势法线：三平面投影的权重
  p *= aI1.x;
  float cr = cos(aI2.y), sr = sin(aI2.y);           // roll（绕前进轴）
  p = vec3(p.x * cr - p.y * sr, p.x * sr + p.y * cr, p.z); n = vec3(n.x * cr - n.y * sr, n.x * sr + n.y * cr, n.z);
  float cp = cos(aI2.z), sp = sin(aI2.z);           // pitch（后仰 / 后坐）
  p = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp); n = vec3(n.x, n.y * cp - n.z * sp, n.y * sp + n.z * cp);
  float c = cos(aI0.w), s = sin(aI0.w);             // yaw：+Z 前向转到 (sin, cos)，与模拟层 facing = atan2(dx, dz) 一致
  p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); n = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  gVatP = p + aI0.xyz; gVatN = n;
  vZone = aZone; vTint = aTint; vFx = vec4(aI1.z, aI1.w, aI2.x, aI1.x); vGlow = aI2.w; vTintC = aI3;
}
`

export function patchVat(material, asset, opts = {}) {
  const prev = material.onBeforeCompile
  material.defines = material.defines || {}
  if (opts.lerp) material.defines.VAT_LERP = ''
  material.userData.vatUniforms = { uVat: { value: asset.texture }, uVatInfo: { value: new THREE.Vector2(TEX_W, asset.rowsPerFrame) } }
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, material.userData.vatUniforms, material.userData.extraUniforms || {})
    let vs = shader.vertexShader
    vs = vs.replace('#include <common>', '#include <common>\n' + VAT_VERT_HEAD)
    if (vs.includes('#include <beginnormal_vertex>') && !material.isMeshDepthMaterial) {
      vs = vs.replace('#include <beginnormal_vertex>', 'vatCompute();\nvec3 objectNormal = gVatN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      vs = vs.replace('#include <begin_vertex>', 'vec3 transformed = gVatP;')
    } else {
      vs = vs.replace('#include <begin_vertex>', 'vatCompute();\nvec3 transformed = gVatP;')
    }
    shader.vertexShader = vs
    if (prev) prev(shader, renderer)
    if (opts.fragment) opts.fragment(shader)
  }
  material.customProgramCacheKey = () => (opts.key || 'vat') + (opts.lerp ? 'L' : '')
  return material
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler()

export class AnimatedInstances {
  constructor(asset, opts) {
    this.asset = asset; this.capacity = opts.capacity; this.count = 0
    const g = new THREE.InstancedBufferGeometry()
    g.index = asset.geometry.index
    for (const k of ['position', 'normal', 'aZone', 'aTint', 'uv']) if (asset.geometry.attributes[k]) g.setAttribute(k, asset.geometry.attributes[k])   // uv：带贴图的 glb 才有
    const mk = () => new Float32Array(this.capacity * 4)
    this.i0 = mk(); this.i1 = mk(); this.i2 = mk(); this.i3 = mk()
    const at = (arr) => new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage)
    this.a0 = at(this.i0); this.a1 = at(this.i1); this.a2 = at(this.i2); this.a3 = at(this.i3)
    g.setAttribute('aI0', this.a0); g.setAttribute('aI1', this.a1); g.setAttribute('aI2', this.a2); g.setAttribute('aI3', this.a3)
    g.instanceCount = 0
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    this.geometry = g
    this.material = patchVat(opts.material, asset, opts)
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = !!opts.castShadow; this.mesh.receiveShadow = opts.receiveShadow !== false
    if (opts.castShadow) {
      this.mesh.customDepthMaterial = patchVat(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), asset, { key: 'vatDepth', lerp: opts.lerp })
    }
    this.linked = []
    this.tintDirty = false
  }
  hasClip(name) { return !!this.asset.clips[name] }
  /** clip 内归一化时间 u（循环 clip 任意实数；非循环夹到 [0,1]）→ 绝对帧号 */
  frame(clipName, u) {
    const c = this.asset.clips[clipName]
    if (c.loop) { u -= Math.floor(u); return c.start + u * c.count }
    return c.start + Math.min(0.9999, Math.max(0, u)) * (c.count - 1)
  }
  /** 秒 → 绝对帧号（按 clip 自己的时长） */
  frameAt(clipName, seconds) { return this.frame(clipName, seconds / this.asset.clips[clipName].duration) }
  put(i, x, y, z, yaw, scale, frame, bright = 1, flash = 0, seed = 0, roll = 0, pitch = 0, glow = 1) {
    const o = i * 4
    this.i0[o] = x; this.i0[o + 1] = y; this.i0[o + 2] = z; this.i0[o + 3] = yaw
    this.i1[o] = scale; this.i1[o + 1] = frame; this.i1[o + 2] = bright; this.i1[o + 3] = flash
    this.i2[o] = seed; this.i2[o + 1] = roll; this.i2[o + 2] = pitch; this.i2[o + 3] = glow
  }
  tint(i, r, g, b, a) { const o = i * 4; this.i3[o] = r; this.i3[o + 1] = g; this.i3[o + 2] = b; this.i3[o + 3] = a; this.tintDirty = true }
  /** 契约接口：matrix(Matrix4，取位置 / 绕 Y 的朝向 / 均匀缩放)、color(THREE.Color|null)、clip 名、clip 内秒数 */
  setInstance(i, matrix, color, clip, time) {
    matrix.decompose(_p, _q, _s); _e.setFromQuaternion(_q, 'YXZ')
    const name = this.asset.clips[clip] ? clip : Object.keys(this.asset.clips)[0]
    this.put(i, _p.x, _p.y, _p.z, _e.y, _s.y, this.frameAt(name, time || 0), 1, 0, (i * 0.618) % 1, _e.z, _e.x, 1)
    if (color) this.tint(i, color.r, color.g, color.b, 1); else this.tint(i, 0, 0, 0, 0)
    if (i >= this.count) this.commit(i + 1); else this.a0.needsUpdate = this.a1.needsUpdate = this.a2.needsUpdate = this.a3.needsUpdate = true
  }
  commit(count) {
    this.count = count; this.geometry.instanceCount = count
    for (const g of this.linked) g.instanceCount = count
    const n4 = Math.max(4, count * 4)   // 只上传用到的那一段
    const upd = (a) => { a.clearUpdateRanges(); a.addUpdateRange(0, n4); a.needsUpdate = true }
    upd(this.a0); upd(this.a1); upd(this.a2)
    if (this.tintDirty) { upd(this.a3); this.tintDirty = false }
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); if (this.mesh.customDepthMaterial) this.mesh.customDepthMaterial.dispose(); for (const g of this.linked) g.dispose() }
}

/**
 * 统一入口。asset 可以是：VatAsset / { rig } / { gltf, bake: opts }。
 * material: THREE.Material（未注入）；fragment: (shader) => void；key: 程序缓存键
 */
export function createAnimatedInstances(o) {
  let asset = o.asset
  if (!asset && o.rig) asset = bakeRig(o.rig)
  if (!asset && o.gltf) asset = bakeGLTF(o.gltf, o.bake || { clips: o.clips || [{ name: 'idle', frames: 1 }] })
  if (!asset && o.geometry) {   // 静态几何：当成单帧 VAT
    const g = o.geometry.index ? o.geometry : o.geometry, P = g.attributes.position, n = P.count
    if (!g.attributes.normal) g.computeVertexNormals()
    const idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i)
    const fr = { pos: Float32Array.from(P.array), nrm: Float32Array.from(g.attributes.normal.array) }
    asset = buildVatAsset({ vertexCount: n, index: idx, zone: new Float32Array(n).fill(o.zone || 0), tint: new Float32Array(n).fill(1), frames: [fr, fr], clips: { idle: { start: 0, count: 1, duration: 1, loop: true } } })
  }
  return new AnimatedInstances(asset, { capacity: o.capacity || 16, material: o.material, fragment: o.fragment, key: o.key, lerp: !!o.lerp, castShadow: !!o.castShadow, receiveShadow: o.receiveShadow })
}

/** 脚下暗斑（假阴影 / 接触阴影）：与单位共用同一份实例缓冲，零额外 CPU */
export function addBlobShadow(inst, sx, sz, opacity, power = 2, ox = 0.1, oz = -0.04) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3)); g.setIndex([0, 2, 1, 0, 3, 2])
  g.setAttribute('aI0', inst.a0); g.setAttribute('aI1', inst.a1); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); g.instanceCount = 0
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: { uS: { value: new THREE.Vector4(sx, sz, opacity, power) }, uO: { value: new THREE.Vector2(ox, oz) } },
    vertexShader: `attribute vec4 aI0; attribute vec4 aI1; uniform vec4 uS; uniform vec2 uO; varying vec2 vQ; varying float vA;
      void main(){ vQ = position.xz * 2.0; float c = cos(aI0.w), s = sin(aI0.w); vec3 p = vec3(position.x * uS.x, 0.0, position.z * uS.y) * aI1.x;
        vA = clamp(1.0 - aI0.y * 0.22, 0.0, 1.0) * step(-0.5, aI0.y) * clamp(aI1.z * 1.5, 0.0, 1.0);
        p = vec3(p.x * c + p.z * s + uO.x * uS.x, 0.018, -p.x * s + p.z * c + uO.y * uS.y) + vec3(aI0.x, 0.0, aI0.z); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform vec4 uS; varying vec2 vQ; varying float vA; void main(){ vec2 a = abs(vQ); float d = pow(pow(a.x, uS.w) + pow(a.y, uS.w), 1.0 / uS.w); gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - smoothstep(0.3, 1.0, d)) * uS.z * vA); }`,
  })
  const sh = new THREE.Mesh(g, m); sh.frustumCulled = false; sh.renderOrder = 2
  inst.linked.push(g)
  return sh
}
