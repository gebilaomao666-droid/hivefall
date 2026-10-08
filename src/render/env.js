// env.js —— 断脊长桥：甲板、护栏、管廊、桁架翼、塔架与探照灯、巨柱、深渊、天空、灯光。
// 两侧不再是「方块城」：用桁架（细杆 + 斜撑）、圆罐、散热鳍、栏杆、缆索这些线性构件堆出结构感，
// 全部是实例化的基础几何体（约 30 个 draw call），主题切换只改 uniform / 灯光 / 发光材质颜色。
import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { loadKit, loadPart, assemble } from './models/world/kitbash.js'
import { ASSET_ROOT, assetUrl } from './base.js'

export const BRIDGE = { halfW: 6.5, z0: -38, z1: 30 }
export const LANES = { centers: [-5.12, -2.56, 0, 2.56, 5.12], width: 2.56, rows: [4.5, 1.5, -1.5, -4.5], depth: 3 }
const ENV = ASSET_ROOT + 'env/'

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

const texLoader = new THREE.TextureLoader()
function loadTex(name, srgb) {
  return texLoader.loadAsync(ENV + name).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t
  })
}
async function loadSet(base) {
  const [diff, nor, arm] = await Promise.all([loadTex(`tex_${base}_diff_1k.jpg`, true), loadTex(`tex_${base}_nor_gl_1k.jpg`), loadTex(`tex_${base}_arm_1k.jpg`)])
  return { diff, nor, arm }
}

// 世界空间 UV：构件随便缩放也不拉伸贴图
function worldUV(mat, scale, flip = false) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', /* glsl */`
      #include <uv_vertex>
      {
        vec4 wp0 = vec4(position, 1.0); vec3 wn0 = normal;
        #ifdef USE_INSTANCING
          wp0 = instanceMatrix * wp0; wn0 = mat3(instanceMatrix) * wn0;
        #endif
        wp0 = modelMatrix * wp0; vec3 an0 = abs(normalize(mat3(modelMatrix) * wn0));
        vec2 wuv = an0.y > 0.5 ? ${flip ? 'wp0.zx' : 'wp0.xz'} : (an0.x > 0.5 ? wp0.zy : wp0.xy);
        wuv *= ${scale.toFixed(4)};
        #ifdef USE_MAP
          vMapUv = wuv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = wuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv;
        #endif
      }`)
  }
  mat.customProgramCacheKey = () => 'wuv' + scale + flip
  return mat
}
function stdMat(set, o) {
  // Poly Haven 金属贴图的 metalness 接近 1，配上压暗的环境光会整片发黑，所以金属度用常数并压低
  const m = new THREE.MeshStandardMaterial({
    map: set.diff, normalMap: set.nor, roughnessMap: set.arm, color: o.color, metalness: o.metal ?? 0.6, roughness: o.rough ?? 1.0,
    envMapIntensity: o.env ?? 0.5, normalScale: new THREE.Vector2(o.ns ?? 1, o.ns ?? 1),
  })
  m.userData.envBase = o.env ?? 0.5
  return worldUV(m, o.scale ?? 0.25, o.flip)
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3()
/** list 元素：{x,y,z,sx,sy,sz,rx,ry,rz} 或 {a:[x,y,z], b:[x,y,z], w, h}（两点之间的杆件，单位几何体沿 Z） */
function inst(list, mat, opts = {}) {
  const geo = opts.geo || BOX
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
  list.forEach((b, i) => {
    if (b.a) {
      _a.fromArray(b.a); _b.fromArray(b.b)
      const len = _a.distanceTo(_b)
      _m.lookAt(_b, _a, Math.abs(_b.y - _a.y) > len * 0.98 ? _p.set(1, 0, 0) : _up)
      _q.setFromRotationMatrix(_m)
      _m.compose(_p.copy(_a).add(_b).multiplyScalar(0.5), _q, _s.set(b.w, b.h ?? b.w, len))
    } else {
      _e.set(b.rx || 0, b.ry || 0, b.rz || 0); _q.setFromEuler(_e)
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.sx, b.sy, b.sz))
    }
    im.setMatrixAt(i, _m)
  })
  im.count = list.length
  im.instanceMatrix.needsUpdate = true
  im.castShadow = !!opts.cast; im.receiveShadow = opts.receive !== false
  im.frustumCulled = false
  return im
}
const BOX = new THREE.BoxGeometry(1, 1, 1)

// ------------------------------------------------------------------
// 甲板：Poly Haven 金属板做微观细节 + 程序绘制的「整桥唯一」面板 / 格栅 / 铆钉 / 涂装
// 面板拼缝对齐 5 条车道（车道宽 2.56），布防区的排线（z = 6, 3, 0, -3, -6）画成刻度
// ------------------------------------------------------------------
function paintDeck() {
  const W = 1024, H = 4096, { halfW, z0, z1 } = BRIDGE
  const PX = W / (halfW * 2), PZ = H / (z1 - z0)
  const X = (x) => (x + halfW) * PX, Z = (z) => (z - z0) * PZ
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c.getContext('2d', { willReadFrequently: true }) }
  const cA = mk(), cR = mk(), cH = mk(), cP = mk()
  const rnd = mulberry(7)
  const g = (v) => `rgb(${v},${v},${v})`
  cA.fillStyle = g(128); cA.fillRect(0, 0, W, H); cR.fillStyle = g(128); cR.fillRect(0, 0, W, H); cH.fillStyle = g(160); cH.fillRect(0, 0, W, H)
  const E1 = 1.28, E2 = 3.84, E3 = 6.1

  const panel = (x0, za, x1, zb, shade, rough) => {
    const x = X(x0), y = Z(za), w = X(x1) - x, h = Z(zb) - y
    cA.fillStyle = g(shade); cA.fillRect(x, y, w, h)
    cR.fillStyle = g(rough); cR.fillRect(x, y, w, h)
    cH.fillStyle = g(160 + (shade - 128) * 0.5); cH.fillRect(x, y, w, h)
    cH.strokeStyle = g(40); cH.lineWidth = 4; cH.strokeRect(x, y, w, h)
    cA.strokeStyle = g(34); cA.lineWidth = 3; cA.strokeRect(x, y, w, h)
    cA.strokeStyle = 'rgba(210,215,225,0.22)'; cA.lineWidth = 1; cA.strokeRect(x + 3, y + 3, w - 6, h - 6)
    const step = 46; cH.fillStyle = g(235); cA.fillStyle = g(70)
    for (let px = x + 12; px < x + w - 6; px += step) for (const py of [y + 11, y + h - 11]) { cH.beginPath(); cH.arc(px, py, 3.2, 0, 7); cH.fill(); cA.beginPath(); cA.arc(px, py, 2.2, 0, 7); cA.fill() }
    for (let py = y + 12 + step; py < y + h - 20; py += step) for (const px of [x + 11, x + w - 11]) { cH.beginPath(); cH.arc(px, py, 3.2, 0, 7); cH.fill(); cA.beginPath(); cA.arc(px, py, 2.2, 0, 7); cA.fill() }
  }
  const grate = (x0, za, x1, zb) => {
    const x = X(x0), y = Z(za), w = X(x1) - x, h = Z(zb) - y
    cA.fillStyle = g(52); cA.fillRect(x, y, w, h); cH.fillStyle = g(60); cH.fillRect(x, y, w, h); cR.fillStyle = g(190); cR.fillRect(x, y, w, h)
    for (let py = y + 6; py < y + h - 4; py += 9) { cA.fillStyle = g(120); cA.fillRect(x + 6, py, w - 12, 4); cH.fillStyle = g(190); cH.fillRect(x + 6, py, w - 12, 4) }
    for (let px = x + w / 3; px < x + w - 4; px += w / 3) { cA.fillStyle = g(100); cA.fillRect(px - 3, y, 6, h); cH.fillStyle = g(210); cH.fillRect(px - 3, y, 6, h) }
    cA.strokeStyle = g(150); cA.lineWidth = 5; cA.strokeRect(x + 2, y + 2, w - 4, h - 4); cH.strokeStyle = g(230); cH.lineWidth = 6; cH.strokeRect(x + 2, y + 2, w - 4, h - 4)
    cA.strokeStyle = g(28); cA.lineWidth = 2; cA.strokeRect(x, y, w, h)
  }
  const hatch = (cx, cz, r) => {
    const x = X(cx), y = Z(cz), rr = r * PX
    cA.fillStyle = g(100); cA.beginPath(); cA.arc(x, y, rr, 0, 7); cA.fill(); cA.strokeStyle = g(30); cA.lineWidth = 3; cA.stroke()
    cH.fillStyle = g(205); cH.beginPath(); cH.arc(x, y, rr, 0, 7); cH.fill(); cH.strokeStyle = g(30); cH.lineWidth = 5; cH.stroke()
    cA.strokeStyle = g(60); cA.lineWidth = 2; for (let a = 0; a < 6; a++) { cA.beginPath(); cA.moveTo(x, y); cA.lineTo(x + Math.cos(a * 1.047) * rr, y + Math.sin(a * 1.047) * rr); cA.stroke() }
  }

  const ROW = 3.0; let row = 0
  for (let z = z0 + 1; z < z1; z += ROW, row++) {   // 行缝落在 z = ..., -6, -3, 0, 3, 6, ...（与布防格对齐）
    const zb = Math.min(z1, z + ROW)
    const sh = () => 108 + rnd() * 44, ro = () => 95 + rnd() * 70
    if (row % 2) { panel(-E2, z, -E1, zb, sh(), ro()); panel(-E1, z, E1, zb, sh(), ro()); panel(E1, z, E2, zb, sh(), ro()) }
    else { panel(-E2, z, 0, zb, sh(), ro()); panel(0, z, E2, zb, sh(), ro()) }
    for (const s of [-1, 1]) {
      const a = s > 0 ? E2 : -E3, b = s > 0 ? E3 : -E2
      if ((row + (s > 0 ? 0 : 1)) % 3 === 0) { panel(a, z, b, zb, sh() - 14, ro()); grate(a + 0.22, z + 0.25, b - 0.22, zb - 0.25) }
      else { panel(a, z, b, zb, sh() - 8, ro()); if (rnd() < 0.4) hatch((a + b) / 2, z + ROW / 2, 0.5) }
      panel(s > 0 ? E3 : -6.5, z, s > 0 ? 6.5 : -E3, zb, 70, 170)
    }
    if (row % 2 === 0 && rnd() < 0.7) hatch((rnd() - 0.5) * 1.6, z + ROW / 2, 0.42 + rnd() * 0.25)
  }
  panel(-6.5, z0, 6.5, z0 + 1, 96, 150)
  // 污渍 / 拖痕 / 油渍
  for (let i = 0; i < 420; i++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 130, d = rnd()
    const gr = cA.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, d < 0.75 ? `rgba(8,8,10,${0.10 + rnd() * 0.22})` : `rgba(235,235,240,${0.04 + rnd() * 0.08})`); gr.addColorStop(1, 'rgba(0,0,0,0)')
    cA.fillStyle = gr; cA.fillRect(x - r, y - r, r * 2, r * 2)
    if (d < 0.3) { const g2 = cR.createRadialGradient(x, y, 0, x, y, r); g2.addColorStop(0, `rgba(20,20,20,${0.35 + rnd() * 0.4})`); g2.addColorStop(1, 'rgba(0,0,0,0)'); cR.fillStyle = g2; cR.fillRect(x - r, y - r, r * 2, r * 2) }
  }
  cA.lineCap = 'round'
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H, l = 40 + rnd() * 260; cA.strokeStyle = `rgba(${rnd() < 0.5 ? '5,5,8' : '200,205,215'},${0.05 + rnd() * 0.12})`; cA.lineWidth = 1 + rnd() * 5
    cA.beginPath(); cA.moveTo(x, y); cA.lineTo(x + (rnd() - 0.5) * 30, y + l); cA.stroke()
  }

  // ---- 涂装层 ----
  const hz = (za, zb, x0, x1, col) => {
    const y = Z(za), h = Z(zb) - y, x = X(x0), w = X(x1) - x
    cP.save(); cP.beginPath(); cP.rect(x, y, w, h); cP.clip()
    cP.fillStyle = col; cP.fillRect(x, y, w, h); cP.fillStyle = '#0c0c0d'
    const sw = h * 0.62; for (let px = x - h * 2; px < x + w + h; px += sw * 2) { cP.beginPath(); cP.moveTo(px, y + h); cP.lineTo(px + sw, y + h); cP.lineTo(px + sw + h, y); cP.lineTo(px + h, y); cP.fill() }
    cP.restore()
  }
  hz(16.7, 17.7, -5.9, 5.9, '#f0b81a')                                  // 防线（z = 17.2）
  hz(-37.5, -37.0, -5.9, 5.9, '#c8201a')
  cP.fillStyle = 'rgba(255,170,40,0.85)'; for (const s of [-1, 1]) cP.fillRect(X(s * 6.22) - 3, 0, 6, H)       // 桥缘琥珀线
  // 车道分隔线：极淡的短虚线（平时桥面上只留这一样「网格」；布防格地标由 deviceview 在放置模式时淡入）
  cP.fillStyle = 'rgba(215,225,235,0.12)'
  for (const xx of [-E2, -E1, E1, E2]) for (let z = z0; z < z1; z += 1.5) cP.fillRect(X(xx) - 2, Z(z + 0.3), 4, Z(z + 1.2) - Z(z + 0.3))
  // 应急电网的地标：z = 16.5 一条青色细线（电网本身的电幕由 deviceview 画）
  cP.fillStyle = 'rgba(120,220,255,0.32)'; cP.fillRect(X(-6.4), Z(16.5) - 2, X(6.4) - X(-6.4), 4)
  // 删掉了常驻的大号段号 01~05、格角十字准星、A1~E4 格号与格角括号、防线前的车道号 1~5 —— 测试：「像开发网格」
  // 涂装磨损
  cP.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 2200; i++) { const x = rnd() * W, y = rnd() * H, r = 2 + rnd() * 11; cP.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.5})`; cP.beginPath(); cP.ellipse(x, y, r, r * (0.08 + rnd() * 0.3), rnd() * 3, 0, 7); cP.fill() }
  cP.globalCompositeOperation = 'source-over'

  // ---- 合成数据贴图 ----
  const a = cA.getImageData(0, 0, W, H).data, r = cR.getImageData(0, 0, W, H).data, h = cH.getImageData(0, 0, W, H).data
  const d1 = new Uint8Array(W * H * 4), d2 = new Uint8Array(W * H * 4)
  const hh = (x, y) => h[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4]
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4
    d1[o] = a[o]; d1[o + 1] = r[o]; d1[o + 2] = h[o]; d1[o + 3] = 255
    const dx = (hh(x + 1, y) - hh(x - 1, y)) / 255, dz = (hh(x, y + 1) - hh(x, y - 1)) / 255
    d2[o] = 128 - dx * 127 * 1.6; d2[o + 1] = 128 - dz * 127 * 1.6; d2[o + 2] = 255; d2[o + 3] = 255
  }
  const mkTex = (data, srgb) => { const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t }
  const pd = cP.getImageData(0, 0, W, H).data   // 用 DataTexture 而不是 CanvasTexture：上下文丢失后能原样重传
  const paint = mkTex(new Uint8Array(pd.buffer.slice(0)), true)
  return { data: mkTex(d1), normal: mkTex(d2), paint }
}

export async function buildEnvironment(scene, renderer) {
  const [plate, grid, corr, rust, shutter, hdr, glowTex, nz] = await Promise.all([
    loadSet('metal_plate_02'), loadSet('rusty_metal_grid'), loadSet('corrugated_iron'), loadSet('rusty_metal_02'), loadSet('painted_metal_shutter'),
    new RGBELoader().loadAsync(ENV + 'hdri_industrial_sunset_02_puresky_1k.hdr'),
    texLoader.loadAsync(ASSET_ROOT + 'ui/tex/generated/glow_soft_256.png'), texLoader.loadAsync(ASSET_ROOT + 'ui/tex/generated/noise_fbm_512.png'),
  ])
  nz.wrapS = nz.wrapT = THREE.RepeatWrapping
  hdr.mapping = THREE.EquirectangularReflectionMapping
  const envRT = { current: null }
  const bakeEnvMap = (afterContextLoss = false) => {
    const pm = new THREE.PMREMGenerator(renderer)
    const rt = pm.fromEquirectangular(hdr); pm.dispose()
    if (envRT.current && !afterContextLoss) envRT.current.dispose()   // 上下文丢过的话旧目标已经不属于当前上下文，别去删
    envRT.current = rt
    scene.environment = rt.texture
    return rt.texture
  }
  const envMap = bakeEnvMap()
  // CC0 模块件（Kenney / KayKit）：读成顶点色零件，稍后按摆放表焊成一个 Mesh。读不到的零件自动跳过
  const kit = await loadKit({
    contA: 'env/kenney-industrial_shipping-container-a', contB: 'env/kenney-industrial_shipping-container-b', contC: 'env/kenney-industrial_shipping-container-c',
    pad: 'env/kaylousberg_landing-pad_qpdg', tankL: 'env/kenney-industrial_detail-tank-large', tankS: 'env/kenney-industrial_detail-tank', chimney: 'env/kenney-industrial_chimney-large',
    hangar: 'env/kenney-space_hangar-largea', dish: 'env/kenney-space_satellitedish-large', gen: 'env/kenney-space_machine-generatorlarge', barrels: 'env/kenney-space_barrels-rail',
    craft: 'vehicles/kenney-space_craft-cargoa', lander: 'vehicles/kaylousberg_lander-a_tvas', truck: 'vehicles/kaylousberg_space-truck_jjka', crate: 'vehicles/quaternius_scifi-crate_bpex',
    trainF: 'vehicles/kenney-space_monorail-trainfront', trainC: 'vehicles/kenney-space_monorail-traincargo', trainE: 'vehicles/kenney-space_monorail-trainend',
  })

  const { halfW, z0, z1 } = BRIDGE, LEN = z1 - z0, ZC = (z0 + z1) / 2
  const root = new THREE.Group(); root.name = 'env'; scene.add(root)
  const U = {
    uTime: { value: 0 },
    uAccentA: { value: new THREE.Color(0.2, 0.62, 1.0) }, uAccentB: { value: new THREE.Color(1.0, 0.45, 0.1) },
    uSkyZen: { value: new THREE.Color(0.004, 0.006, 0.012) }, uSkyNeb: { value: new THREE.Color(0.05, 0.022, 0.06) }, uSkyHor: { value: new THREE.Color(0.2, 0.06, 0.01) },
    uSkyHaze: { value: new THREE.Color(0.012, 0.03, 0.06) }, uStars: { value: 1.0 },
    uMist: { value: new THREE.Color(0.035, 0.07, 0.13) }, uAbyssA: { value: new THREE.Color(0.5, 0.12, 0.02) }, uAbyssB: { value: new THREE.Color(0.02, 0.01, 0.01) },
    uAshCol: { value: new THREE.Color(0.55, 0.5, 0.48) }, uEmberCol: { value: new THREE.Color(3.2, 1.1, 0.25) }, uAshAmt: { value: 1.0 },
    uShaftCol: { value: new THREE.Color(0.8, 0.9, 1.0) }, uWet: { value: 0.5 }, uPool: { value: 0.34 },
    uPlanetA: { value: new THREE.Color(0.22, 0.10, 0.06) }, uPlanetB: { value: new THREE.Color(1.0, 0.35, 0.08) }, uSilBase: { value: new THREE.Color(0.02, 0.02, 0.03) }, uSilRim: { value: new THREE.Color(0.3, 0.1, 0.03) },
  }
  const stdMats = []

  // ---------------- 甲板 ----------------
  const deckTex = paintDeck()
  const clone = (t, rx, ry) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c }
  const deckMat = new THREE.MeshStandardMaterial({
    map: clone(plate.diff, 3, LEN / 4.33), normalMap: clone(plate.nor, 3, LEN / 4.33), roughnessMap: clone(plate.arm, 3, LEN / 4.33),
    metalness: 0.82, roughness: 1.0, envMapIntensity: 0.55, normalScale: new THREE.Vector2(0.9, 0.9),
  })
  deckMat.userData.envBase = 0.42;   // 0.55 → 0.42：金属甲板反射的是偏蓝的天空，整片桥面泛蓝白
  stdMats.push(deckMat)
  deckMat.onBeforeCompile = (sh) => {
    sh.uniforms.uPanel = { value: deckTex.data }; sh.uniforms.uPanelN = { value: deckTex.normal }; sh.uniforms.uPaint = { value: deckTex.paint }
    sh.uniforms.uAccentA = U.uAccentA; sh.uniforms.uAccentB = U.uAccentB; sh.uniforms.uWet = U.uWet; sh.uniforms.uPool = U.uPool; sh.uniforms.uNoiseT = { value: nz }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPanelUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPanelUv = vec2((position.x + ${halfW.toFixed(1)}) / ${(halfW * 2).toFixed(1)}, (position.z - (${z0.toFixed(1)})) / ${LEN.toFixed(1)});`)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPanelUv; uniform sampler2D uPanel; uniform sampler2D uPanelN; uniform sampler2D uPaint; uniform sampler2D uNoiseT; uniform vec3 uAccentA; uniform vec3 uAccentB; uniform float uWet; uniform float uPool; vec4 gPanel; vec4 gPaint; float gWet;')
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        gPanel = texture2D(uPanel, vPanelUv); gPaint = texture2D(uPaint, vPanelUv);
        float lum0 = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
        vec3 base = mix(vec3(lum0), diffuseColor.rgb, 0.22) * vec3(0.84, 0.88, 0.96) * 1.55;   // 去黄、略偏冷。2.0 → 1.55、少一点蓝：甲板和我方枪灰甲一样亮一样蓝，方阵糊进地面（参考 038 是深炭灰甲板）
        base *= gPanel.r * 2.0;
        base = mix(base, gPaint.rgb * (0.55 + lum0 * 1.6), gPaint.a * 0.92);
        // 积水 / 油亮：低频噪声圈出几片，粗糙度压低去反射天空和火光
        float wn = texture2D(uNoiseT, vPanelUv * vec2(1.3, 5.8)).r * 0.65 + texture2D(uNoiseT, vPanelUv * vec2(3.1, 13.0) + 0.37).r * 0.35;
        gWet = smoothstep(0.52, 0.7, wn) * uWet * (1.0 - gPaint.a * 0.6);
        base *= 1.0 - gWet * 0.1;
        diffuseColor.rgb = base;`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * 0.62 + (gPanel.g - 0.5) * 0.7 + gPaint.a * 0.25, 0.16, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.2, gWet * 0.8);`)
      .replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
        metalnessFactor *= (1.0 - gPaint.a * 0.75);`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        { // 护栏灯在甲板上的光池（假的，零开销）
          float wx = vPanelUv.x * ${(halfW * 2).toFixed(1)} - ${halfW.toFixed(1)}; float wz = vPanelUv.y * ${LEN.toFixed(1)} + (${z0.toFixed(1)});
          float edge = exp(-(${halfW.toFixed(1)} - abs(wx)) * 1.15);
          float k = (wz - (${(z0 + 1.0).toFixed(2)})) / 3.0; float per = pow(max(0.5 + 0.5 * cos(k * 6.28318), 0.0), 3.0);
          float tall = step(0.5, mod(floor(k + 0.5) - 1.0, 4.0));   // 每 4 个里有 1 个是警示色高柱
          totalEmissiveRadiance += mix(uAccentB, uAccentA, tall) * edge * per * uPool * (0.4 + diffuseColor.r * 3.0);
        }`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { vec3 pn = texture2D(uPanelN, vPanelUv).xyz * 2.0 - 1.0; normal = normalize(normal + mat3(viewMatrix) * vec3(pn.x, 0.0, pn.y) * 1.5 * (1.0 - gWet * 0.8)); }`)
  }
  const deckGeo = new THREE.PlaneGeometry(halfW * 2, LEN, 1, 1); deckGeo.rotateX(-Math.PI / 2); deckGeo.translate(0, 0, ZC)
  const deck = new THREE.Mesh(deckGeo, deckMat); deck.receiveShadow = true; deck.name = 'deck'; root.add(deck)

  // ---------------- 材质库 ----------------
  const M = (set, o) => { const m = stdMat(set, o); stdMats.push(m); return m }
  const mDark = M(plate, { color: 0x8794a6, metal: 0.7, scale: 0.22, env: 0.8 })
  const mDarker = M(shutter, { color: 0x4a5462, metal: 0.65, scale: 0.35, env: 0.7, flip: true })
  const mGrid = M(grid, { color: 0x6c7a8a, metal: 0.6, scale: 0.3, env: 0.6 })
  const mWing = M(corr, { color: 0x566272, metal: 0.7, scale: 0.42, env: 0.8, flip: true, ns: 1.8 })
  const mPipe = M(plate, { color: 0x9a4a22, metal: 0.5, scale: 0.4, env: 0.6 })   // 大管 / 起重机横梁：氧化铁红，饱和度压低
  const mPipeGrey = M(rust, { color: 0x6b7480, metal: 0.65, scale: 0.5, env: 0.6 })
  const mTruss = M(rust, { color: 0x56606e, metal: 0.6, scale: 0.6, env: 0.6 })
  const mKit = worldUV(new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: plate.nor, roughnessMap: plate.arm, metalness: 0.45, roughness: 0.85, envMapIntensity: 0.7, normalScale: new THREE.Vector2(0.6, 0.6) }), 0.3); mKit.userData.envBase = 0.7; stdMats.push(mKit)
  const mCable = new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.8, roughness: 0.5 }); mCable.userData.envBase = 0.6; stdMats.push(mCable)
  const glowMat = (c) => new THREE.MeshBasicMaterial({ color: c, fog: false })
  const mA = glowMat(new THREE.Color(0.55, 1.6, 2.4)), mB = glowMat(new THREE.Color(2.6, 1.0, 0.18)), mRed = glowMat(new THREE.Color(2.8, 0.25, 0.1)), mWhite = glowMat(new THREE.Color(1.9, 2.1, 2.4))

  const dark = [], darker = [], gridB = [], wing = [], truss = [], rail = [], stripA = [], stripB = [], red = [], white = [], glows = []
  const pipes = [], pipesG = [], ringsO = [], tanks = [], tankCaps = [], cols = [], colBands = [], orange = [], cables = [], kitItems = []
  const rnd = mulberry(99)
  const shaftSpots = []
  // 两侧模块件的涂装色（线性空间、乘 0.12 的总增益之前）：深灰 / 石板灰 / 锈红 / 军绿
  const CONT_PAINT = [[0.30, 0.32, 0.35], [0.20, 0.23, 0.27], [0.40, 0.17, 0.11], [0.22, 0.27, 0.16]]

  // 桥体：桥面板 + 下面的箱梁 + 桥墩
  darker.push({ x: 0, y: -0.85, z: ZC, sx: halfW * 2, sy: 1.66, sz: LEN })
  darker.push({ x: 0, y: -4.2, z: ZC, sx: 8.5, sy: 5.2, sz: LEN })
  for (let z = z0 + 5; z < z1; z += 14) { cols.push({ x: 0, y: -35, z, sx: 7.5, sy: 56, sz: 7.5 }); truss.push({ a: [-8, -7.5, z], b: [8, -7.5, z], w: 0.9, h: 1.2 }) }

  for (const s of [-1, 1]) {
    // ---- 桥缘挡条 + 护栏（立柱 + 两根横管 + 灯）----
    dark.push({ x: s * 6.68, y: 0.07, z: ZC, sx: 0.36, sy: 0.26, sz: LEN })
    rail.push({ a: [s * 7.0, 0.95, z0], b: [s * 7.0, 0.95, z1], w: 0.07 }, { a: [s * 7.0, 0.55, z0], b: [s * 7.0, 0.55, z1], w: 0.05 })
    let k = 0
    for (let z = z0 + 1.0; z < z1; z += 1.5, k++) {
      const major = k % 2 === 0, idx = k / 2
      if (!major) { rail.push({ a: [s * 7.0, 0.1, z], b: [s * 7.0, 0.95, z], w: 0.06 }); continue }
      const tall = idx % 4 === 1
      // 灯墩：带斜面的矮墩；每 4 个里有一根警示高柱
      dark.push({ x: s * 7.04, y: 0.34, z, sx: 0.5, sy: 0.75, sz: 0.62 }, { x: s * 7.28, y: 0.05, z, sx: 0.3, sy: 0.5, sz: 0.9, rz: s * 0.5 })
      if (tall) {
        rail.push({ a: [s * 7.04, 0.7, z], b: [s * 7.04, 2.3, z], w: 0.14 }, { a: [s * 7.04, 2.25, z], b: [s * 6.7, 2.45, z], w: 0.08 })
        stripB.push({ x: s * 6.66, y: 2.43, z, sx: 0.1, sy: 0.07, sz: 0.4 }); glows.push([s * 6.66, 2.4, z, 1, 3.2])
      } else {
        stripA.push({ x: s * 6.78, y: 0.5, z, sx: 0.04, sy: 0.07, sz: 0.5 }); glows.push([s * 6.76, 0.5, z, 0, 2.0])
      }
    }
    // ---- 管廊：大橙管 + 法兰 + 管托，两根灰管，电缆桥架 ----
    gridB.push({ x: s * 8.9, y: -1.05, z: ZC, sx: 3.1, sy: 0.16, sz: LEN })
    pipes.push({ x: s * 8.2, y: -0.4, z: ZC, sx: 1, sy: 1, sz: LEN })
    pipesG.push({ x: s * 9.25, y: -0.7, z: ZC, sx: 0.42, sy: 0.42, sz: LEN }, { x: s * 9.62, y: -0.7, z: ZC, sx: 0.42, sy: 0.42, sz: LEN }, { x: s * 7.55, y: -0.62, z: ZC, sx: 0.3, sy: 0.3, sz: LEN })
    for (let z = z0 + 1.0; z < z1; z += 3.0) {
      ringsO.push({ x: s * 8.2, y: -0.4, z, sx: 1.22, sy: 1.22, sz: 0.16 }, { x: s * 8.2, y: -0.4, z: z + 0.2, sx: 1.22, sy: 1.22, sz: 0.16 })
      dark.push({ x: s * 8.2, y: -0.86, z: z + 0.1, sx: 0.9, sy: 0.3, sz: 0.5 })
      darker.push({ x: s * 9.44, y: -0.92, z: z + 1.5, sx: 0.78, sy: 0.16, sz: 0.12 })
      truss.push({ a: [s * 10.3, -1.0, z + 1.5], b: [s * 10.3, -0.1, z + 1.5], w: 0.08 })
    }
    truss.push({ a: [s * 10.3, -0.12, z0], b: [s * 10.3, -0.12, z1], w: 0.07 }, { a: [s * 10.3, -0.55, z0], b: [s * 10.3, -0.55, z1], w: 0.05 })
    for (let z = z0 + 4; z < z1; z += 8.7) {
      const zz = z + rnd() * 2.5
      dark.push({ x: s * 9.9, y: -0.55, z: zz, sx: 0.6, sy: 0.85, sz: 1.3 })
      white.push({ x: s * 9.58, y: -0.3, z: zz - 0.3, sx: 0.03, sy: 0.06, sz: 0.3 }); red.push({ x: s * 9.58, y: -0.3, z: zz + 0.3, sx: 0.03, sy: 0.06, sz: 0.12 })
    }
    // ---- 服务平台层（x 11..19.8，y = SD）：三根纵梁 + 横肋，按「跨」交替摆货场 / 停机坪 / 罐区 / 机库，空跨只留桁架能看到下面的纵深 ----
    const SD = -2.4, X0 = 11.0, X1 = 19.8, XM = (X0 + X1) / 2, BAY = 8.75
    const SEQ = s < 0 ? ['pad', 'gap', 'yard', 'tank', 'gap', 'hangar', 'yard', 'pad'] : ['gap', 'tank', 'pad', 'gap', 'yard', 'hangar', 'tank', 'gap']
    for (const xx of [X0, XM, X1]) truss.push({ a: [s * xx, SD - 0.36, z0], b: [s * xx, SD - 0.36, z1 + 2], w: 0.34, h: 0.5 })
    for (const xx of [X0 + 1.2, X1 - 1.2]) truss.push({ a: [s * xx, SD - 4.0, z0], b: [s * xx, SD - 4.0, z1 + 2], w: 0.3, h: 0.4 })     // 下层桁架（更深一层）
    for (let z = z0; z <= z1 + 2.01; z += BAY / 2) {
      truss.push({ a: [s * X0, SD - 0.36, z], b: [s * X1, SD - 0.36, z], w: 0.22, h: 0.36 })
      truss.push({ a: [s * 10.3, -1.05, z], b: [s * X0, SD - 0.3, z], w: 0.2, h: 0.3 })                                                  // 管廊外缘搭到平台的斜撑
      truss.push({ a: [s * (X0 + 1.2), SD - 4.0, z], b: [s * (X1 - 1.2), SD - 4.0, z], w: 0.18 })
      truss.push({ a: [s * (X0 + 1.2), SD - 4.0, z], b: [s * X0, SD - 0.4, z], w: 0.14 }, { a: [s * (X1 - 1.2), SD - 4.0, z], b: [s * X1, SD - 0.4, z], w: 0.14 })
      truss.push({ a: [s * (X0 + 1.2), SD - 4.0, z], b: [s * XM, SD - 0.4, z], w: 0.12 }, { a: [s * (X1 - 1.2), SD - 4.0, z], b: [s * XM, SD - 0.4, z], w: 0.12 })
    }
    for (let i = 0; i < SEQ.length; i++) {
      const za = z0 + i * BAY, zc = za + BAY / 2, type = SEQ[i], yT = SD
      if (type === 'gap') {
        for (const [xa, xb] of [[X0, XM], [XM, X1]]) for (const h of [0, 1]) { const zz = za + h * BAY / 2; truss.push({ a: [s * xa, SD - 0.4, zz], b: [s * xb, SD - 0.4, zz + BAY / 2], w: 0.11 }, { a: [s * xb, SD - 0.4, zz], b: [s * xa, SD - 0.4, zz + BAY / 2], w: 0.11 }) }
        // 空跨下面：一根从桥体箱梁穿出去的横向大管 + 法兰，和下层的检修走道
        pipes.push({ a: [s * 4.2, SD - 2.6, zc - 1.2], b: [s * 22.4, SD - 2.6, zc - 1.2], w: 1.5 })
        for (const xx of [12.4, 15.4, 18.4]) ringsO.push({ a: [s * (xx - 0.1), SD - 2.6, zc - 1.2], b: [s * (xx + 0.1), SD - 2.6, zc - 1.2], w: 3.1 })
        gridB.push({ x: s * XM, y: SD - 3.7, z: zc + 1.4, sx: X1 - X0 - 2.4, sy: 0.1, sz: 1.3 })
        stripA.push({ x: s * XM, y: SD - 3.55, z: zc + 0.8, sx: 3.2, sy: 0.05, sz: 0.06 }); glows.push([s * XM, SD - 3.5, zc + 0.8, 0, 2.6])
        continue
      }
      // 平台板 + 边梁 + 外缘栏杆
      ;(type === 'yard' ? darker : gridB).push({ x: s * XM, y: SD - 0.06, z: zc, sx: X1 - X0 + 0.3, sy: 0.14, sz: BAY - 0.7 })
      dark.push({ x: s * XM, y: SD - 0.02, z: za + 0.42, sx: X1 - X0 + 0.4, sy: 0.22, sz: 0.2 }, { x: s * XM, y: SD - 0.02, z: za + BAY - 0.42, sx: X1 - X0 + 0.4, sy: 0.22, sz: 0.2 })
      for (let z = za + 0.5; z < za + BAY - 0.3; z += 1.95) rail.push({ a: [s * (X1 + 0.1), SD, z], b: [s * (X1 + 0.1), SD + 1.0, z], w: 0.07 })
      rail.push({ a: [s * (X1 + 0.1), SD + 1.0, za + 0.5], b: [s * (X1 + 0.1), SD + 1.0, za + BAY - 0.5], w: 0.06 }, { a: [s * (X1 + 0.1), SD + 0.5, za + 0.5], b: [s * (X1 + 0.1), SD + 0.5, za + BAY - 0.5], w: 0.04 })
      if (type === 'yard') {
        // 集装箱货场：3 列 × 2 排，随机空位 / 叠两层；上面跨一台门式起重机
        const C = kit.contA ? kit.contA.size : { x: 0.4, y: 0.3, z: 0.8 }, cs = 4.7, cw = C.x * cs, chh = C.y * cs, cl = C.z * cs
        for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 2; cz++) {
          const n = rnd() < 0.16 ? 0 : (rnd() < 0.42 ? 2 : 1)
          for (let k = 0; k < n; k++) {
            // 集装箱统一重新上漆成暗色工业涂装（原模型是粉 / 绿 / 蓝的卡通色，和整体的暗色金属调子不搭）：深灰为主，少量锈红和军绿，都是低饱和
            const hue = rnd(), pc = rnd()
            const paint = pc < 0.46 ? CONT_PAINT[0] : pc < 0.64 ? CONT_PAINT[1] : pc < 0.82 ? CONT_PAINT[2] : CONT_PAINT[3]
            kitItems.push({ part: hue < 0.4 ? 'contA' : hue < 0.75 ? 'contB' : 'contC', x: s * (X0 + 1.5 + cx * (cw + 0.75)) + (rnd() - 0.5) * 0.12, y: yT + k * chh, z: zc + (cz - 0.5) * (cl + 0.28), ry: rnd() < 0.5 ? 0 : Math.PI, s: cs, paint, paintKeep: 0.6, gain: 0.85 + rnd() * 0.3 })
          }
        }
        const gz = zc + (i % 2 ? 1.1 : -1.1), gh = 5.4, xa = X0 + 0.25, xb = X1 - 0.25
        for (const xx of [xa, xb]) for (const dz of [-0.75, 0.75]) truss.push({ a: [s * xx, yT, gz + dz * 1.6], b: [s * xx, yT + gh, gz + dz * 0.5], w: 0.2 })
        for (const xx of [xa, xb]) { truss.push({ a: [s * xx, yT + gh * 0.5, gz - 0.82], b: [s * xx, yT + gh * 0.5, gz + 0.82], w: 0.14 }); dark.push({ x: s * xx, y: yT + 0.12, z: gz, sx: 0.5, sy: 0.24, sz: 3.0 }) }
        orange.push({ x: s * XM, y: yT + gh + 0.1, z: gz - 0.4, sx: xb - xa + 1.0, sy: 0.5, sz: 0.3 }, { x: s * XM, y: yT + gh + 0.1, z: gz + 0.4, sx: xb - xa + 1.0, sy: 0.5, sz: 0.3 })
        const tx = X0 + 2.0 + rnd() * 4.5
        dark.push({ x: s * tx, y: yT + gh + 0.35, z: gz, sx: 1.2, sy: 0.5, sz: 1.3 })
        rail.push({ a: [s * tx, yT + gh, gz], b: [s * tx, yT + gh - 1.9, gz], w: 0.05 }); dark.push({ x: s * tx, y: yT + gh - 2.05, z: gz, sx: 1.5, sy: 0.18, sz: 0.4 })
        white.push({ x: s * (xa + 0.9), y: yT + gh - 0.22, z: gz, sx: 0.5, sy: 0.08, sz: 0.24 }, { x: s * (xb - 0.9), y: yT + gh - 0.22, z: gz, sx: 0.5, sy: 0.08, sz: 0.24 })
        glows.push([s * (xa + 0.9), yT + gh - 0.3, gz, 3, 4.6], [s * (xb - 0.9), yT + gh - 0.3, gz, 3, 4.6])
        red.push({ x: s * xb, y: yT + gh + 0.55, z: gz, sx: 0.14, sy: 0.3, sz: 0.14 }); glows.push([s * xb, yT + gh + 0.7, gz, 2, 2.6])
      } else if (type === 'pad') {
        const pd = 7.6
        kitItems.push({ part: 'pad', x: s * XM, y: yT, z: zc, fit: [pd, 0.95, pd], ry: i * 0.7, sat: 0.55, gain: 0.8, tint: [0.9, 0.95, 1.05] })
        const ship = i % 2 ? 'lander' : 'craft'
        if (ship === 'craft') kitItems.push({ part: 'craft', x: s * XM, y: yT + 0.95, z: zc, s: 1.75, ry: s > 0 ? -2.0 : 2.2, sat: 0.5, gain: 0.85, tint: [0.85, 0.92, 1.05] })
        else kitItems.push({ part: 'lander', x: s * XM, y: yT + 0.95, z: zc, s: 2.3, ry: 0.5, sat: 0.4, gain: 0.8, tint: [0.9, 0.95, 1.05] })
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.39, r = pd * 0.47; stripA.push({ x: s * XM + Math.cos(a) * r, y: yT + 0.98, z: zc + Math.sin(a) * r, sx: 0.22, sy: 0.08, sz: 0.22 }); glows.push([s * XM + Math.cos(a) * r, yT + 1.05, zc + Math.sin(a) * r, 0, 1.8]) }
        kitItems.push({ part: 'truck', x: s * (X0 + 0.9), y: yT, z: zc - 3.3, s: 2.4, ry: 1.57, sat: 0.4, gain: 0.8 }, { part: 'crate', x: s * (X1 - 0.9), y: yT, z: zc + 3.2, s: 1.5, ry: 0.3, sat: 0.35, gain: 0.7 }, { part: 'crate', x: s * (X1 - 0.9), y: yT, z: zc + 1.9, s: 1.5, ry: -0.2, sat: 0.35, gain: 0.7 })
      } else if (type === 'tank') {
        kitItems.push({ part: 'tankL', x: s * (X0 + 2.7), y: yT, z: zc - 1.9, s: 3.0, ry: 0.4, sat: 0.4, gain: 0.72, tint: [0.92, 0.96, 1.05] }, { part: 'tankL', x: s * (X0 + 2.7), y: yT, z: zc + 2.3, s: 2.6, ry: 2.1, sat: 0.4, gain: 0.72, tint: [0.92, 0.96, 1.05] })
        for (const dz of [-2.6, 0, 2.6]) kitItems.push({ part: 'tankS', x: s * (X1 - 2.3), y: yT, z: zc + dz, s: 5.2, ry: s > 0 ? 0 : Math.PI, sat: 0.45, gain: 0.7 })
        kitItems.push({ part: 'chimney', x: s * (XM + 0.6), y: yT, z: zc + 3.4, s: 2.6, sat: 0.3, gain: 0.7 })
        pipesG.push({ a: [s * (X0 + 2.7), yT + 1.2, zc - 1.9], b: [s * 9.62, -0.7, zc - 1.9], w: 0.9 }, { a: [s * (X0 + 2.7), yT + 1.0, zc + 2.3], b: [s * 9.25, -0.7, zc + 2.3], w: 0.9 })
        pipesG.push({ a: [s * (X1 - 2.3), yT + 0.5, zc - 3.6], b: [s * (X1 - 2.3), yT + 0.5, zc + 3.6], w: 0.8 })
        stripB.push({ x: s * (X0 + 0.5), y: yT + 0.3, z: zc, sx: 0.06, sy: 0.12, sz: 2.4 }); glows.push([s * (X0 + 0.5), yT + 0.35, zc, 1, 3.0])
        red.push({ x: s * (XM + 0.6), y: yT + 5.4, z: zc + 3.4, sx: 0.14, sy: 0.3, sz: 0.14 }); glows.push([s * (XM + 0.6), yT + 5.5, zc + 3.4, 2, 2.6])
      } else if (type === 'hangar') {
        kitItems.push({ part: 'hangar', x: s * (X1 - 3.4), y: yT, z: zc - 0.9, s: 2.35, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2, sat: 0.5, gain: 0.5, tint: [0.88, 0.94, 1.06] })
        // 机库顶：横向加强肋 + 屋脊警示灯带 + 一台顶置机组（从上往下看不再是一块白板）
        for (let k = -2; k <= 2; k++) dark.push({ x: s * (X1 - 3.4 + k * 1.25), y: yT + 2.42, z: zc - 0.9, sx: 0.2, sy: 0.14, sz: 4.9 })
        stripB.push({ x: s * (X1 - 3.4), y: yT + 2.5, z: zc - 0.9, sx: 5.6, sy: 0.05, sz: 0.08 })
        kitItems.push({ part: 'gen', x: s * (X1 - 1.6), y: yT + 2.35, z: zc - 1.6, s: 1.1, ry: 0.4, sat: 0.4, gain: 0.7 })
        red.push({ x: s * (X1 - 0.4), y: yT + 2.6, z: zc + 1.2, sx: 0.12, sy: 0.3, sz: 0.12 }); glows.push([s * (X1 - 0.4), yT + 2.75, zc + 1.2, 2, 2.4])
        kitItems.push({ part: 'dish', x: s * (X0 + 1.7), y: yT, z: zc + 2.9, s: 3.2, ry: s > 0 ? 2.4 : 0.8, sat: 0.4, gain: 0.85 })
        kitItems.push({ part: 'gen', x: s * (X0 + 1.5), y: yT, z: zc - 2.6, s: 2.1, ry: s > 0 ? 1.57 : -1.57, sat: 0.5, gain: 0.8 })
        kitItems.push({ part: 'barrels', x: s * (XM + 0.4), y: yT, z: zc + 3.3, s: 3.0, ry: 0, sat: 0.4, gain: 0.7 })
        stripA.push({ x: s * (X1 - 6.4), y: yT + 1.5, z: zc - 0.9, sx: 0.06, sy: 0.1, sz: 3.0 }); glows.push([s * (X1 - 6.5), yT + 1.5, zc - 0.9, 0, 3.4])
        white.push({ x: s * (X1 - 6.3), y: yT + 2.35, z: zc - 0.9, sx: 0.1, sy: 0.1, sz: 0.5 }); glows.push([s * (X1 - 6.5), yT + 2.3, zc - 0.9, 3, 4.0])
      }
    }
    // ---- 斜拉塔：A 字形桁架塔立在管廊外缘，拉索扇面一边拉住桥缘，一边拉住平台外梁；塔顶探照灯（长影和光柱的来源）----
    let q = 0
    for (let z = z0 + 8.75; z < 2; z += 17.5, q++) {   // 靠近镜头的那一跨不放塔：塔顶会怼到画面里
      const x = s * 10.85, top = 10.4 + (q % 2) * 1.4, y0 = -1.1
      for (const dz of [-1, 1]) for (const dx of [-1, 1]) truss.push({ a: [x + dx * 0.55, y0, z + dz * 1.5], b: [x + dx * 0.22, top, z + dz * 0.28], w: 0.2 })
      for (let h = 0; h < 5; h++) {
        const u0 = h / 5, u1 = (h + 1) / 5, ya = y0 + (top - y0) * u0, yb = y0 + (top - y0) * u1
        const za = 1.5 - 1.22 * u0, zb = 1.5 - 1.22 * u1, xa = 0.55 - 0.33 * u0, xb = 0.55 - 0.33 * u1
        truss.push({ a: [x - xb, yb, z - zb], b: [x + xb, yb, z - zb], w: 0.1 }, { a: [x - xb, yb, z + zb], b: [x + xb, yb, z + zb], w: 0.1 }, { a: [x - xb, yb, z - zb], b: [x - xb, yb, z + zb], w: 0.1 }, { a: [x + xb, yb, z - zb], b: [x + xb, yb, z + zb], w: 0.1 })
        truss.push({ a: [x - s * xa, ya, z - za], b: [x - s * xb, yb, z + zb], w: 0.08 }, { a: [x - s * xa, ya, z + za], b: [x - s * xb, yb, z - zb], w: 0.08 })
      }
      dark.push({ x, y: top + 0.12, z, sx: 0.9, sy: 0.24, sz: 0.9 })
      for (const dz of [-7.2, -5.4, -3.6, -1.8, 1.8, 3.6, 5.4, 7.2]) {
        cables.push({ a: [x - s * 0.1, top - 0.15 - Math.abs(dz) * 0.05, z + dz * 0.04], b: [s * 6.72, 0.24, z + dz], w: 0.055 })
        cables.push({ a: [x + s * 0.1, top - 0.15 - Math.abs(dz) * 0.05, z + dz * 0.04], b: [s * X1, SD - 0.1, z + dz * 1.15], w: 0.05 })
      }
      dark.push({ x: x - s * 0.45, y: top - 0.22, z, sx: 0.7, sy: 0.4, sz: 0.5, rz: s * 0.5 })
      white.push({ x: x - s * 0.7, y: top - 0.4, z, sx: 0.12, sy: 0.3, sz: 0.4, rz: s * 0.5 })
      red.push({ x, y: top + 0.55, z, sx: 0.12, sy: 0.5, sz: 0.12 }); glows.push([x, top + 0.8, z, 2, 3.4])
      glows.push([x - s * 0.75, top - 0.4, z, 3, 5.0])
      shaftSpots.push({ x: x - s * 0.75, y: top - 0.4, z, s, ph: q * 1.7 + (s > 0 ? 0.9 : 0) })
    }
    // ---- 单轨货运线：平台外侧一条轨道梁 + 支架（列车在 update 里跑）----
    truss.push({ a: [s * 21.5, SD + 0.6, z0 - 6], b: [s * 21.5, SD + 0.6, z1 + 8], w: 0.5, h: 0.4 })
    stripB.push({ x: s * 21.5, y: SD + 0.82, z: ZC, sx: 0.06, sy: 0.04, sz: LEN + 14 })
    for (let z = z0; z < z1 + 8; z += BAY) { truss.push({ a: [s * 21.5, SD + 0.5, z], b: [s * 21.5, SD - 6, z], w: 0.3 }, { a: [s * 21.5, SD - 0.4, z], b: [s * X1, SD - 0.4, z], w: 0.2 }, { a: [s * 21.5, SD - 3.4, z], b: [s * X1, SD - 0.5, z], w: 0.12 }) }
    // ---- 外侧墩柱（八棱，细）：每两跨一根，柱头带检修环台和灯；再外面一排更深更远 ----
    let n = 0
    for (let z = z0 + 4; z < z1 + 8; z += 17.5, n++) {
      cols.push({ x: s * 24.6, y: -31.5, z, sx: 2.6, sy: 56, sz: 2.6 })
      colBands.push({ x: s * 24.6, y: -3.9, z, sx: 3.5, sy: 0.35, sz: 3.5 }, { x: s * 24.6, y: -9.5, z, sx: 3.0, sy: 0.5, sz: 3.0 })
      red.push({ x: s * 24.6, y: -3.3, z, sx: 0.14, sy: 0.4, sz: 0.14 }); glows.push([s * 24.6, -3.1, z, 2, 3.0])
      truss.push({ a: [s * 21.5, SD - 0.5, z], b: [s * 24.6, -4.2, z], w: 0.3 }, { a: [s * 21.5, SD - 6, z], b: [s * 24.6, -9.5, z], w: 0.26 })
      cols.push({ x: s * 34, y: -34 + (n % 3) * 3, z: z + 8.7, sx: 4.4, sy: 44, sz: 4.4 })
      colBands.push({ x: s * 34, y: -13.0 + (n % 3) * 3, z: z + 8.7, sx: 5.0, sy: 0.7, sz: 5.0 })
      white.push({ x: s * 31.75, y: -16 - (n % 3) * 3, z: z + 8.7, sx: 0.06, sy: 1.6, sz: 0.2 })
      for (let d = 0; d < 3; d++) stripA.push({ x: s * 23.25, y: -11 - d * 6, z: z + (d % 2 ? 0.5 : -0.5), sx: 0.06, sy: 1.4, sz: 0.12 })
      truss.push({ a: [s * 24.6, -9.5, z], b: [s * 34, -13.0 + (n % 3) * 3, z + 8.7], w: 0.4 })
      if (n > 0) truss.push({ a: [s * 24.6, -9.5, z - 17.5], b: [s * 24.6, -9.5, z], w: 0.5, h: 0.6 }, { a: [s * 24.6, -4.0, z - 17.5], b: [s * 24.6, -9.5, z], w: 0.16 }, { a: [s * 24.6, -9.5, z - 17.5], b: [s * 24.6, -4.0, z], w: 0.16 })
    }
    // ---- 远景：轨道电梯基座的巨构剪影 ----
    for (let i = 0; i < 5; i++) {
      const x = s * (48 + rnd() * 34), z = -78 + i * 22 + rnd() * 8, h = 44 + rnd() * 50, w = 7 + rnd() * 7
      cols.push({ x, y: -40 + h / 2, z, sx: w, sy: h + 80, sz: w })
      colBands.push({ x, y: h - 6 - rnd() * 8, z, sx: w * 1.25, sy: 1.6, sz: w * 1.25 })
      for (let d = 0; d < 3; d++) (d % 2 ? stripB : stripA).push({ x: x - s * w * 0.46, y: 4 + d * 9 + rnd() * 5, z: z + (rnd() - 0.5) * w * 0.5, sx: 0.2, sy: 3 + rnd() * 3, sz: 0.2 })
      red.push({ x, y: h + 1.2, z, sx: 0.4, sy: 0.4, sz: 0.4 })
    }
  }
  // 轨道电梯缆索：远端正中一道直通天顶的发光线
  cols.push({ x: 0, y: 40, z: -150, sx: 16, sy: 240, sz: 16 })
  for (const dx of [-3.4, 3.4]) stripA.push({ x: dx, y: 60, z: -141.5, sx: 0.5, sy: 200, sz: 0.5 })
  for (let i = 0; i < 6; i++) colBands.push({ x: 0, y: -10 + i * 17, z: -150, sx: 19, sy: 2.2, sz: 19 })

  const cylZ = (r, n = 14) => { const g = new THREE.CylinderGeometry(r, r, 1, n, 1, true); g.rotateX(Math.PI / 2); return g }
  const cylY = (n = 8) => new THREE.CylinderGeometry(0.5, 0.5, 1, n, 1, false, Math.PI / n)
  const pg = cylZ(0.27), oct = cylY(8)
  const capG = new THREE.SphereGeometry(1, 12, 6);
  root.add(inst(dark, mDark, { cast: true }), inst(darker, mDarker), inst(gridB, mGrid), inst(wing, mWing), inst(truss, mTruss, { cast: true }), inst(rail, mPipeGrey))
  root.add(inst(pipes, mPipe, { geo: cylZ(0.42) }), inst(pipesG, mPipeGrey, { geo: pg }), inst(ringsO, mDark, { geo: pg }), inst(tanks, mPipeGrey, { geo: cylZ(0.5, 16) }), inst(tankCaps, mPipeGrey, { geo: capG }))
  root.add(inst(cols, mDarker, { geo: oct }), inst(colBands, mDark, { geo: oct }))
  root.add(inst(orange, mPipe, { cast: true }), inst(cables, mCable, { receive: false }))
  // 统一压暗 + 去饱和；没有单独上漆的零件再把亮度软压到 0.42（原模型里大块的纯白面板 —— 机库、储罐、停机坪 —— 会变成中灰的涂装钢板）
  const kitMesh = assemble(kit, kitItems.map((it) => ({ ...it, gain: (it.gain ?? 1) * 0.12, sat: (it.sat ?? 0.5) * 0.55, cap: it.paint ? 0 : 0.42 })), mKit); kitMesh.name = 'env-kit'; root.add(kitMesh)
  root.add(inst(stripA, mA, { receive: false }), inst(stripB, mB, { receive: false }), inst(red, mRed, { receive: false }), inst(white, mWhite, { receive: false }))

  // ---------------- 灯晕（Points）：类型 0 = 点缀色 A，1 = 点缀色 B，2 = 红，3 = 白 ----------------
  {
    const n = glows.length, pos = new Float32Array(n * 3), dat = new Float32Array(n * 2)
    glows.forEach((gl, i) => { pos.set(gl.slice(0, 3), i * 3); dat.set([gl[3], gl[4]], i * 2) })
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aDat', new THREE.BufferAttribute(dat, 2))
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: glowTex }, uH: { value: 900 }, uAccentA: U.uAccentA, uAccentB: U.uAccentB, uShaftCol: U.uShaftCol }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec2 aDat; varying vec3 vC; uniform float uH; uniform vec3 uAccentA; uniform vec3 uAccentB; uniform vec3 uShaftCol;
        void main(){ vC = aDat.x < 0.5 ? uAccentA * 2.2 : (aDat.x < 1.5 ? uAccentB * 2.6 : (aDat.x < 2.5 ? vec3(2.8, 0.3, 0.1) : uShaftCol * 2.4));
          vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aDat.y * uH * 0.5 / -mv.z; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 tx = texture2D(uTex, gl_PointCoord); float a = tx.r * tx.a; gl_FragColor = vec4(vC * a * a * 0.22, 1.0); }`,
    })
    const p = new THREE.Points(g, m); p.frustumCulled = false; root.add(p); U.glowMat = m
  }

  // ---------------- 探照灯光柱：圆锥 + 菲涅尔边缘衰减 + 噪声尘埃，缓慢扫向桥面 ----------------
  const shafts = []
  {
    const coneGeo = new THREE.CylinderGeometry(0.2, 3.4, 30, 20, 1, true); coneGeo.translate(0, -15, 0)
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uNoise: { value: nz }, uColor: U.uShaftCol }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vL; varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; vL = uv.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; uniform sampler2D uNoise; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vL; varying vec3 vW;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float edge = pow(max(f, 0.0), 2.2);
          float dust = 0.6 + 0.8 * texture2D(uNoise, vW.xz * 0.05 + vec2(uTime * 0.02, vW.y * 0.04)).r;
          float fall = pow(clamp(vL, 0.0, 1.0), 1.6);
          gl_FragColor = vec4(uColor * edge * fall * dust * 0.075, 1.0); }`,
    })
    for (const sp of shaftSpots) {
      const b = new THREE.Mesh(coneGeo, shaftMat); b.position.set(sp.x, sp.y, sp.z); b.renderOrder = 9; b.frustumCulled = false
      root.add(b); shafts.push({ mesh: b, ...sp })
    }
  }
  const _t = new THREE.Vector3(), _dn = new THREE.Vector3(0, -1, 0), _d = new THREE.Vector3()
  const updateShafts = (t) => {
    for (const b of shafts) {
      _t.set(Math.sin(t * 0.21 + b.ph) * 4.5 - b.s * 1.0, 0, b.z * 0.55 - 6 + Math.sin(t * 0.16 + b.ph * 2.0) * 6.0)
      _d.copy(_t).sub(b.mesh.position).normalize()
      b.mesh.quaternion.setFromUnitVectors(_dn, _d)
    }
  }
  updateShafts(0)

  // ---------------- 灰烬 / 火星（纯 GPU 循环）----------------
  let ashMesh
  {
    const count = 1500
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3])
    const seed = new Float32Array(count * 4); const r2 = mulberry(5)
    for (let i = 0; i < count * 4; i++) seed[i] = r2()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = count
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uTex: { value: glowTex }, uAshCol: U.uAshCol, uEmberCol: U.uEmberCol, uAshAmt: U.uAshAmt },
      vertexShader: /* glsl */`
        uniform float uTime; uniform vec3 uAshCol; uniform vec3 uEmberCol; uniform float uAshAmt; attribute vec4 aSeed; varying vec2 vUv; varying vec3 vCol;
        void main(){
          float ember = step(0.62, aSeed.w);
          float fall = mix(0.9, -0.7, ember) * (0.5 + aSeed.x);           // 灰往下飘，火星往上窜
          vec3 box = vec3(46.0, 34.0, 60.0);
          vec3 p = vec3(aSeed.x, aSeed.y, aSeed.z) * box;
          p.y -= uTime * fall;
          p.x += uTime * (0.9 + aSeed.z * 0.8) + sin(uTime * 0.7 + aSeed.y * 40.0) * 0.8;   // 侧风
          p.z += sin(uTime * 0.45 + aSeed.x * 31.0) * 0.9;
          p = mod(p, box) - vec3(23.0, 6.0, 38.0);
          float size = mix(0.07, 0.05, ember) * (0.6 + aSeed.y * 1.2) * step(fract(aSeed.x * 7.13 + aSeed.z * 3.7), uAshAmt);
          float tw = 0.55 + 0.45 * sin(uTime * (3.0 + aSeed.x * 9.0) + aSeed.z * 50.0);
          float rr = uTime * (aSeed.z - 0.5) * 4.0; float cs = cos(rr), sn = sin(rr);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.xy += mat2(cs, -sn, sn, cs) * (position.xy * vec2(1.0, mix(0.55, 1.0, ember))) * size;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy + 0.5;
          vCol = mix(uAshCol * 0.55, uEmberCol * tw, ember);
        }`,
      fragmentShader: `uniform sampler2D uTex; varying vec2 vUv; varying vec3 vCol; void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(vCol * t.a * t.r, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })
    ashMesh = new THREE.Mesh(g, mat); ashMesh.frustumCulled = false; ashMesh.renderOrder = 14; root.add(ashMesh)
  }

  // ---------------- 深渊：薄雾片（纵深分层）+ 底下的余烬云海 ----------------
  {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uNoise: { value: nz }, uMist: U.uMist }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D uNoise; uniform float uTime; uniform vec3 uMist; varying vec3 vW;
        void main(){ vec2 p = vW.xz * 0.035; float n = texture2D(uNoise, p + vec2(uTime * 0.004, uTime * 0.011)).r * texture2D(uNoise, p * 2.3 - vec2(uTime * 0.007, 0.0)).r;
          float a = smoothstep(9.5, 22.0, abs(vW.x)) * smoothstep(0.08, 0.5, n);
          gl_FragColor = vec4(uMist * a * 0.8, 1.0); }`,
    })
    for (const s of [-1, 1]) for (const y of [-6.2, -11.5]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(36, 96), m); pl.rotation.x = -Math.PI / 2; pl.position.set(s * 24, y, ZC + 2); pl.renderOrder = 4; pl.frustumCulled = false; root.add(pl) }
    const am = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uNoise: { value: nz }, uA: U.uAbyssA, uB: U.uAbyssB }, fog: false, depthWrite: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D uNoise; uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec3 vW;
        void main(){ vec2 p = vW.xz * 0.008; float n = texture2D(uNoise, p + vec2(uTime * 0.0016, uTime * 0.003)).r; float n2 = texture2D(uNoise, p * 3.1 - vec2(uTime * 0.004, 0.0)).r;
          float v = smoothstep(0.35, 0.85, n * 0.7 + n2 * 0.3); float hot = pow(max(v, 0.0), 3.0);
          float fade = 1.0 - smoothstep(60.0, 190.0, length(vW.xz - vec2(0.0, -10.0)));
          gl_FragColor = vec4(mix(uB, uA, hot) * (0.25 + 0.75 * fade), 1.0); }`,
    })
    const ab = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), am); ab.rotation.x = -Math.PI / 2; ab.position.set(0, -52, -20); ab.renderOrder = -5; ab.frustumCulled = false; root.add(ab)
  }

  // ---------------- 天空 ----------------
  {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uZen: U.uSkyZen, uNeb: U.uSkyNeb, uHor: U.uSkyHor, uHaze: U.uSkyHaze, uStars: U.uStars, uTime: U.uTime, uPlanetA: U.uPlanetA, uPlanetB: U.uPlanetB },
      vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vD; uniform vec3 uZen; uniform vec3 uNeb; uniform vec3 uHor; uniform vec3 uHaze; uniform float uStars; uniform float uTime; uniform vec3 uPlanetA; uniform vec3 uPlanetB;
        float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float n(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y), mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
        void main(){ vec3 d = normalize(vD);
          vec3 g = floor(d * 190.0); float s = h(g); float st = smoothstep(0.9965, 1.0, s) * (0.4 + 0.6 * h(g + 3.0));
          float neb = n(d * 2.2) * n(d * 5.0 + 4.0); neb = smoothstep(0.22, 0.75, neb);
          vec3 c = uZen + uNeb * neb * 0.55 + uHaze * n(d * 1.3 + 9.0) * 0.6;
          float hz = exp(-abs(d.y) * 5.0); float band = n(vec3(d.x * 3.0, d.y * 14.0, d.z * 3.0 + uTime * 0.01));
          c += uHor * hz * (0.55 + 0.9 * band);                             // 地平线的火光 / 辉光带
          c += vec3(0.75, 0.85, 1.0) * st * 1.4 * uStars * (1.0 - hz);
          { // 行星：远端左上方的一颗巨行星，只露出被照亮的一弯 + 大气辉边 + 暗面的熔光裂纹
            vec3 pc = normalize(vec3(-0.6, 0.4, -1.0)); float R = 0.21; float ca = dot(d, pc);
            vec3 q = d - pc * ca; float rr = length(q) / R;
            if (ca > 0.0 && rr < 1.0) {
              vec3 bx = normalize(cross(pc, vec3(0.0, 1.0, 0.0))), by = cross(bx, pc);
              vec2 uvp = vec2(dot(q, bx), dot(q, by)) / R; float zc = sqrt(max(1.0 - rr * rr, 0.0));
              vec3 nn = normalize(uvp.x * bx + uvp.y * by - zc * pc);
              float lit = clamp(dot(nn, normalize(vec3(-0.75, 0.5, 0.35))) * 1.4 + 0.12, 0.0, 1.0);
              float bands = n(vec3(uvp.x * 1.5, uvp.y * 7.0 + n(vec3(uvp * 3.0, 1.0)) * 1.4, 2.0));
              float cracks = (1.0 - smoothstep(0.0, 0.03, abs(n(vec3(uvp * 6.0, 5.0)) - 0.5))) * smoothstep(0.45, 0.7, n(vec3(uvp * 2.2, 9.0)));   // 暗面上细细的熔光裂纹
              vec3 surf = mix(uPlanetA * 0.3, uPlanetA, bands) * lit * lit + uPlanetB * cracks * (1.0 - lit) * 0.22;
              float limb = pow(max(1.0 - zc, 0.0), 4.0);
              c = mix(c * 0.12, surf + uPlanetB * limb * (0.08 + lit * 0.7), smoothstep(1.0, 0.985, rr));
            } else if (ca > 0.0) c += uPlanetB * exp(-(rr - 1.0) * 11.0) * 0.1;
          }
          gl_FragColor = vec4(c, 1.0); }`,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), m); sky.frustumCulled = false; sky.renderOrder = -10; root.add(sky)
  }

  // ---------------- 远景剪影：停在高空的战舰、地平线上的虫巢尖塔（不吃雾，自己按主题的天色上色；主机位看不到，菜单 / 低机位才入画）----------------
  const silMat = new THREE.ShaderMaterial({
    uniforms: { uBase: U.uSilBase, uRim: U.uSilRim, uHor: U.uSkyHor }, fog: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 lp = vec4(position, 1.0); vec3 ln = normal;
        #ifdef USE_INSTANCING
          lp = instanceMatrix * lp; ln = mat3(instanceMatrix) * ln;
        #endif
        vec4 w = modelMatrix * lp; vW = w.xyz; vN = normalize(mat3(modelMatrix) * ln); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uBase; uniform vec3 uRim; uniform vec3 uHor; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec3 n = normalize(vN);
        float top = clamp(n.y * 0.5 + 0.5, 0.0, 1.0); float side = clamp(n.x * -0.5 + 0.5, 0.0, 1.0);   // 纯剪影：顶面略亮，朝主光一侧带一点主题色
        vec3 c = uBase * (0.5 + top) + uRim * side * side * 0.05;
        gl_FragColor = vec4(c, 1.0); }`,
  })
  {
    const spire = new THREE.ConeGeometry(1, 1, 7, 6); spire.translate(0, 0.5, 0)
    { const P = spire.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i), a = y * 2.6, x = P.getX(i), z = P.getZ(i), bulge = 1 + 0.35 * Math.sin(y * 9.0); P.setXYZ(i, (x * Math.cos(a) - z * Math.sin(a)) * bulge + Math.sin(y * 3.1) * 0.12, y, (x * Math.sin(a) + z * Math.cos(a)) * bulge) } spire.computeVertexNormals() }
    const list = [], r3 = mulberry(31)
    for (const [cx, cz, n] of [[150, -300, 7], [-230, -250, 5], [60, -420, 6]]) for (let i = 0; i < n; i++) { const h = 70 + r3() * 130, w = 9 + r3() * 16; list.push({ x: cx + (r3() - 0.5) * 110, y: -50, z: cz + (r3() - 0.5) * 80, sx: w, sy: h + 50, sz: w, ry: r3() * 6, rz: (r3() - 0.5) * 0.16 }) }
    const hive = inst(list, silMat, { geo: spire, receive: false }); hive.name = 'hive-spires'; root.add(hive)
    loadPart('vehicles/jakersh_spaceship-warship_2le6').then((ship) => {
      if (!ship) return
      const im = inst([{ x: -120, y: 92, z: -300, sx: 22, sy: 22, sz: 22, ry: 1.9, rz: 0.05 }, { x: 150, y: 120, z: -400, sx: 15, sy: 15, sz: 15, ry: -1.2 }, { x: 40, y: 150, z: -470, sx: 10, sy: 10, sz: 10, ry: -1.3 }], silMat, { geo: ship.geo, receive: false }); im.name = 'warships'; root.add(im)
    })
  }
  // ---------------- 单轨货运列车：两侧轨道梁上各一列，来回跑 ----------------
  const trains = []
  if (kit.trainF && kit.trainC) {
    const cars = [], L = kit.trainC.size.z * 2.6 + 0.25
    cars.push({ part: 'trainF', x: 0, y: 0, z: 0, s: 2.6, sat: 0.25, gain: 0.12, cap: 0.42 })
    for (let k = 1; k <= 4; k++) cars.push({ part: 'trainC', x: 0, y: 0, z: k * L, s: 2.6, paint: CONT_PAINT[k % 4], paintKeep: 0.6, gain: 0.12 })
    const tg = assemble(kit, cars, mKit).geometry
    for (const s of [-1, 1]) { const m = new THREE.Mesh(tg, mKit); m.position.set(s * 21.5, -1.55, 0); m.rotation.y = s > 0 ? 0 : Math.PI; m.frustumCulled = false; m.receiveShadow = false; root.add(m); trains.push({ m, s, ph: s > 0 ? 0 : 47 }) }
  }
  const updateTrains = (t) => { for (const tr of trains) { const u = ((t * 7.5 + tr.ph) % 150) - 75; tr.m.position.z = tr.s > 0 ? -u : u } }

  // ---------------- 灯光 ----------------
  scene.fog = new THREE.FogExp2(0x04060b, 0.0125)
  const hemi = new THREE.HemisphereLight(0x86a8e6, 0x16100e, 1.0); scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffe6c8, 3.3)
  key.target.position.set(0, 0, 1.5); scene.add(key, key.target)
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04; key.shadow.radius = 2.2
  const fill = new THREE.DirectionalLight(0x5f95ff, 1.15); fill.position.set(14, 12, 22); scene.add(fill)
  const rim = new THREE.DirectionalLight(0xff6a3c, 0.85); rim.position.set(3, 7, -30); scene.add(rim)

  /** 主光方向变了就重算阴影相机：把战场盒子（x ±13、z -26..19、y 0..10）包进去 */
  const _lm = new THREE.Matrix4(), _c = new THREE.Vector3()
  function setKeyDirection(dx, dy, dz) {
    const dist = 60
    _c.set(dx, dy, dz).normalize()
    key.position.copy(key.target.position).addScaledVector(_c, dist)
    key.updateMatrixWorld(); key.target.updateMatrixWorld()
    _lm.lookAt(key.position, key.target.position, _up).invert()
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, zn = 1e9, zf = -1e9
    for (const x of [-13, 13]) for (const y of [0, 10]) for (const z of [-26, 19]) {
      _c.set(x - key.position.x, y - key.position.y, z - key.position.z).applyMatrix4(_lm)
      x0 = Math.min(x0, _c.x); x1 = Math.max(x1, _c.x); y0 = Math.min(y0, _c.y); y1 = Math.max(y1, _c.y); zn = Math.min(zn, -_c.z); zf = Math.max(zf, -_c.z)
    }
    const sc = key.shadow.camera
    sc.left = x0; sc.right = x1; sc.bottom = y0; sc.top = y1; sc.near = Math.max(1, zn - 5); sc.far = zf + 12
    sc.updateProjectionMatrix()
  }
  setKeyDirection(-15, 30, 9)

  return {
    envMap, uniforms: U, lights: { hemi, key, fill, rim }, root, deckMat, stdMats, accentMats: { a: mA, b: mB, red: mRed, white: mWhite },
    setKeyDirection, bakeEnvMap,
    update(t) { U.uTime.value = t; updateShafts(t); updateTrains(t) },
    setShaftsVisible(v) { for (const b of shafts) b.mesh.visible = v },
    setViewportHeight(h) { U.glowMat.uniforms.uH.value = h },
  }
}
