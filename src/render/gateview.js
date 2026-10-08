// gateview.js —— 增援门（GDD §4）、雇佣兵空投舱、技能召唤物；并把布防装置（deviceview.js）和指挥官技能特效（powersfx.js）挂进来。
//   门      两扇并排立在桥上的全息能量门：门柱 + 门楣 + 能量幕 + 门楣上方朝镜头倾斜的全息牌（CanvasTexture：图标 + 「+8 突击兵」+ 标签）
//           滑向队伍；队伍站在哪一侧哪扇更亮；结算时穿过的那扇向外炸开粒子，另一扇碎裂下坠消散；悬赏门（kind === 'bounty'）整套换成金色
//   空投舱  strike{kind:'pod'} 起从天上砸下来（拖尾焰）→ 落地冲击 → world.pods 里带血条滑向防线 → podOpen 四片外壳掀开
//   召唤物  world.summons 里的 flagship / robot 走资源表 summon.<kind>
// 门的文字走 i18n：调用方用 view.setTranslator(t) 把 data/strings 的 t(key, params) 注入进来（渲染层不直接 import 文案表）；
// 没注入时只显示不依赖文案的兜底（「+8 rifle」）。图标在 assets/ui/icons（game-icons，CC BY 3.0，见该目录的 LICENSE）。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createPool } from './assets.js'
import { createDeviceView } from './deviceview.js'
import { createPowersFx } from './powersfx.js'
import { ASSET_ROOT, assetUrl } from './base.js'

const GATE_X = 3.2, GATE_W = 5.9, GATE_H = 3.4
const TYPE_COL = { unit: [0.28, 0.85, 1.0], heal: [0.3, 1.0, 0.45], module: [1.0, 0.66, 0.16], stat: [0.72, 0.5, 1.0], contract: [1.0, 0.5, 0.1], device: [0.25, 1.0, 0.8], bounty: [1.0, 0.74, 0.2] }
const ICONS = ASSET_ROOT + 'ui/icons/'
const UNIT_ICON = { rifle: 'weapon_assault_rifle', flamer: 'weapon_flamethrower', mortar: 'mortar', titan: 'mech_battle', lancer: 'laser_precision', reaper: 'laser_blast', psion: 'lightning_storm', skyhook: 'drone', goliath: 'megabot' }
const TYPE_ICON = { heal: 'medic_cross', module: 'upgrade', stat: 'shield_heavy', contract: 'parachute', device: 'sentry_gun', bounty: 'trophy' }
const DEVICE_ICON = { collector: 'crystal', sentry: 'sentry_gun', barricade: 'barrier', mine: 'land_mine', cryo: 'ice_snowflake', scorcher: 'fire_zone', mortarpit: 'mortar', nova: 'nuclear' }
const ADD = { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }

// ---------------------------------------------------------------- 文案
// 注入的文案函数：(key, params) => string。约定「查不到」时返回 key 本身 / null / 空串，三种都当成没有
let T = null
const tr = (key, params) => {
  if (!T || !key) return null
  let s
  try { s = T(key, params) } catch (e) { return null }
  if (s == null || s === '' || s === key) return null
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (params && params[k] != null ? params[k] : ''))   // 注入的函数没做占位符替换时兜底
}
function optionText(opt) {
  if (!opt) return { title: '', tags: [] }
  const p = { count: opt.count, ...(opt.params || {}) }
  for (const k in p) if (/Key$/.test(k) && typeof p[k] === 'string') { const v = tr(p[k]); if (v != null) p[k.slice(0, -3)] = v }
  if (p.unit == null && opt.unit) p.unit = tr('unit.' + opt.unit + '.name') || opt.unit
  if (p.name == null) p.name = (p.moduleId && tr('module.' + p.moduleId + '.name')) || (p.contract && tr('contract.' + p.contract + '.name')) || (p.device && tr('device.' + p.device + '.name')) || p.moduleId || p.contract || p.device || ''
  let title = opt.titleKey ? tr(opt.titleKey, p) : null
  if (!title || /^\W*$/.test(title)) title = opt.type === 'unit' ? `+${opt.count} ${p.unit || ''}` : String(p.name || opt.type || '')
  if (opt.type === 'unit' && !/\d/.test(title)) title = `+${opt.count} ${p.unit || ''}`
  const tags = (opt.tags || []).map((t) => tr('tag.' + t) || t).slice(0, 3)
  return { title: title.replace(/\s*\/\s*/g, ' / ').trim(), tags }
}
const iconOf = (opt, bounty) => {
  if (!opt) return 'plus'
  if (opt.type === 'unit') return UNIT_ICON[opt.unit] || 'squad'
  if (opt.type === 'contract') return UNIT_ICON[opt.unit] && opt.unit !== 'rifle' ? UNIT_ICON[opt.unit] : 'parachute'
  if (opt.type === 'device') return DEVICE_ICON[opt.params && opt.params.device] || 'sentry_gun'
  if (opt.type === 'stat' && opt.params && opt.params.boon) return bounty ? 'trophy' : (opt.params.cost ? 'hazard' : 'damage_up')
  return TYPE_ICON[opt.type] || 'plus'
}
const icons = new Map()   // name -> { img, ready, waiters: [] }
function iconImage(name, onReady) {
  let r = icons.get(name)
  if (!r) { r = { img: new Image(), ready: false, failed: false, waiters: [] }; icons.set(name, r); r.img.onload = () => { r.ready = true; for (const w of r.waiters) w(); r.waiters.length = 0 }; r.img.onerror = () => { r.failed = true; r.waiters.length = 0 }; r.img.src = ICONS + name + '.svg' }
  if (!r.ready && !r.failed && onReady) r.waiters.push(onReady)
  return r.ready ? r.img : null
}
const css = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * 255 * k) | 0},${Math.min(255, c[1] * 255 * k) | 0},${Math.min(255, c[2] * 255 * k) | 0},${a})`
const FONT = '"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif'

/** 画门楣全息牌：1024 × 448。底板（半透明深色 + 类型色描边）+ 图标 + 大标题（「/」后面的部分折到第二行）+ 标签药丸 + 右上角门序号 */
function drawLabel(cv, opt, col, info, redraw) {
  const W = cv.width, H = cv.height, x = cv.getContext('2d')
  x.clearRect(0, 0, W, H)
  const { title, tags } = optionText(opt)
  const [main, sub] = title.split(' / ')
  // 底板：切角矩形
  const c = 44, m = 8
  x.beginPath(); x.moveTo(m + c, m); x.lineTo(W - m, m); x.lineTo(W - m, H - m - c); x.lineTo(W - m - c, H - m); x.lineTo(m, H - m); x.lineTo(m, m + c); x.closePath()
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(6,12,20,0.9)'); g.addColorStop(1, 'rgba(3,6,10,0.82)')
  x.fillStyle = g; x.fill()
  x.lineWidth = 7; x.strokeStyle = css(col, 0.9, 0.95); x.stroke()
  x.fillStyle = css(col, 0.9, 0.9); x.fillRect(m + c, m, 300, 12); x.fillRect(W - m - 150, H - m - 12, 100, 12)
  x.fillStyle = css(col, 0.5, 0.1); for (let yy = m + 18; yy < H - m; yy += 8) x.fillRect(m + 4, yy, W - m * 2 - 8, 2)   // 扫描线
  // 图标
  const IS = 250, ix = 40, iy = (H - IS) / 2
  x.fillStyle = css(col, 0.35, 0.4); x.beginPath(); x.arc(ix + IS / 2, iy + IS / 2, IS / 2 + 6, 0, 7); x.fill()
  x.lineWidth = 6; x.strokeStyle = css(col, 1, 0.9); x.beginPath(); x.arc(ix + IS / 2, iy + IS / 2, IS / 2 + 6, 0, 7); x.stroke()
  const img = iconImage(iconOf(opt, info.bounty), redraw)
  if (img) {
    const t = drawLabel._tmp || (drawLabel._tmp = document.createElement('canvas')); t.width = t.height = IS
    const tx = t.getContext('2d'); tx.clearRect(0, 0, IS, IS); tx.drawImage(img, 22, 22, IS - 44, IS - 44)
    tx.globalCompositeOperation = 'source-in'; tx.fillStyle = css(col.map((v) => 0.6 + v * 0.4), 1, 1); tx.fillRect(0, 0, IS, IS); tx.globalCompositeOperation = 'source-over'
    x.drawImage(t, ix, iy)
  }
  // 标题：自动缩到放得下
  const tx0 = ix + IS + 40, tw = W - tx0 - 36
  // 从 max 起每次减 6 号，找第一个放得下的字号（最小到 min 附近）。原来一个号一个号地试（每次 measureText 都要按新字号重新排一遍，一块牌子 10~20 次）；
  // 现在先按「宽度和字号成正比」估一个号，再上下各试一两次，结果和逐个试完全一样
  const fit = (text, max, min, weight = 900) => {
    const W0 = (f) => { x.font = weight + ' ' + f + 'px ' + FONT; return x.measureText(text).width }
    let lo = max; while (lo - 6 > min) lo -= 6                  // 原来的循环最小试到的号
    const w = W0(max)
    if (w <= tw) return max
    let f = Math.max(lo, max - 6 * Math.ceil((max - max * tw / w) / 6))
    if (W0(f) <= tw) { while (f + 6 < max && W0(f + 6) <= tw) f += 6 } else { while (f > lo && W0(f - 6) > tw) f -= 6; if (f > lo) f -= 6 }
    x.font = weight + ' ' + f + 'px ' + FONT
    return f
  }
  x.textBaseline = 'alphabetic'; x.textAlign = 'left'
  const rows = (sub ? 1 : 0) + (tags.length ? 1 : 0)
  const fs = fit(main, rows === 2 ? 128 : 156, 60)
  const ty = rows === 2 ? 168 : rows === 1 ? 214 : 270
  x.shadowColor = css(col, 1, 0.9); x.shadowBlur = 26
  x.fillStyle = '#ffffff'; x.fillText(main, tx0, ty)
  x.shadowBlur = 0
  let y2 = ty + 26
  if (sub) { fit(sub, 74, 40, 700); x.fillStyle = css(col.map((v) => 0.72 + v * 0.28), 1, 1); x.fillText(sub, tx0, y2 + 66); y2 += 88 }
  // 标签
  let px = tx0
  x.font = '700 58px ' + FONT
  for (const tag of tags) {
    const w = x.measureText(tag).width + 48
    if (px + w > W - 30) break
    x.fillStyle = css(col, 0.55, 0.55); x.beginPath(); x.roundRect(px, y2 + 4, w, 84, 12); x.fill()
    x.lineWidth = 4; x.strokeStyle = css(col, 1, 0.9); x.stroke()
    x.fillStyle = css(col.map((v) => 0.75 + v * 0.25), 1, 1); x.fillText(tag, px + 24, y2 + 67)
    px += w + 18
  }
  // 右上角：门序号 / 悬赏
  x.font = '700 40px "Orbitron","Oxanium",' + FONT; x.textAlign = 'right'; x.fillStyle = css(col, 1, 0.85)
  x.fillText(info.bounty ? (tr('gate.bounty') || 'BOUNTY') : (info.total && info.index < info.total ? String(info.index + 1).padStart(2, '0') + ' / ' + String(info.total).padStart(2, '0') : '#' + (info.index + 1)), W - 40, 64)
}

// ---------------------------------------------------------------- 门的几何
function frameGeometry() {
  const parts = [], hw = GATE_W / 2
  const bx = (w, h, d, x, y, z, rz = 0, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); parts.push(g) }
  for (const s of [-1, 1]) {
    bx(0.95, 0.3, 1.2, s * hw, 0.15, 0)                            // 底座
    bx(0.62, 0.22, 0.86, s * hw, 0.41, 0)
    bx(0.4, GATE_H - 0.2, 0.46, s * (hw + 0.02), GATE_H / 2 + 0.3, 0)            // 立柱
    bx(0.16, GATE_H * 0.7, 0.7, s * (hw + 0.34), GATE_H * 0.45, 0, -s * 0.13)    // 外侧斜撑翼
    bx(0.66, 0.5, 0.72, s * hw, GATE_H + 0.42, 0)                   // 柱头（发射器）
    bx(0.26, 0.26, 0.5, s * (hw - 0.42), GATE_H + 0.3, 0, s * 0.6)  // 内侧的投射臂
    bx(0.12, 0.7, 0.12, s * (hw + 0.2), GATE_H + 0.95, -0.2)        // 天线
  }
  bx(GATE_W + 0.2, 0.22, 0.34, 0, GATE_H + 0.62, 0)                 // 门楣横梁
  bx(GATE_W * 0.5, 0.14, 0.5, 0, GATE_H + 0.78, 0)
  for (const x of [-1.7, 1.7]) bx(0.12, 0.5, 0.12, x, GATE_H + 1.0, -0.06, 0)   // 全息牌的两根支臂
  return mergeGeometries(parts)
}
function glowGeometry() {
  const parts = [], hw = GATE_W / 2
  const bx = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g) }
  for (const s of [-1, 1]) {
    bx(0.05, GATE_H - 0.5, 0.3, s * (hw - 0.21), GATE_H / 2 + 0.3, 0)            // 立柱内侧的光缝
    bx(0.44, 0.06, 0.5, s * hw, 0.56, 0)
    bx(0.7, 0.06, 0.76, s * hw, GATE_H + 0.1, 0)
    bx(0.06, 0.06, 0.06, s * (hw + 0.2), GATE_H + 1.34, -0.2)
    for (let k = 0; k < 3; k++) bx(0.06, 0.22, 0.48, s * (hw + 0.23), 0.9 + k * 0.8, 0)   // 立柱外侧的刻度灯
  }
  bx(GATE_W - 0.5, 0.05, 0.38, 0, GATE_H + 0.48, 0)
  return mergeGeometries(parts)
}
const SHEET_FS = /* glsl */`
uniform float uTime; uniform vec3 uCol; uniform float uFade; uniform float uU; uniform float uMode; uniform sampler2D uHex; uniform sampler2D uNoise; varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv; float a = 1.0, boost = 1.0;
  if (uMode > 1.5) {                       // 没选中的那扇：按小块错开下坠、闪烁、消失
    vec2 cell = floor(uv * vec2(16.0, 9.0)); float r = h21(cell), d = clamp((uU * 1.5 - r * 0.5), 0.0, 1.0);
    uv.y += d * d * (0.35 + r * 0.5); uv.x += (h21(cell + 3.1) - 0.5) * d * 0.05;
    a = (1.0 - d) * step(uv.y, 1.0) * (0.6 + 0.4 * step(0.5, fract(r * 7.0 + uTime * 9.0)));
    vec2 f = fract(vUv * vec2(16.0, 9.0)); a *= mix(1.0, smoothstep(0.0, 0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y))), min(1.0, uU * 4.0));   // 裂缝
  } else if (uMode > 0.5) {                // 选中的那扇：中心先被「穿透」，亮环向外扩
    float rr = length((uv - vec2(0.5, 0.42)) * vec2(1.7, 1.0)); float edge = uU * 1.25;
    a = smoothstep(edge - 0.02, edge + 0.08, rr); boost = 1.0 + 5.0 * exp(-pow((rr - edge) / 0.07, 2.0)) + 2.5 * (1.0 - uU);
  }
  float n = texture2D(uNoise, uv * vec2(0.7, 1.6) + vec2(0.0, -uTime * 0.11)).r;
  float hex = texture2D(uHex, uv * vec2(3.4, 1.95) + vec2(0.0, uTime * 0.04)).r;
  float scan = 0.62 + 0.38 * sin(uv.y * 95.0 - uTime * 5.0);
  float streak = pow(max(texture2D(uNoise, vec2(uv.x * 2.3, uv.y * 0.22 - uTime * 0.35)).r, 0.0), 3.0) * 1.6;      // 向上流动的竖向光丝
  float rim = pow(max(abs(uv.x - 0.5) * 2.0, 0.0), 5.0) * 0.9 + pow(max(1.0 - uv.y, 0.0), 5.0) * 0.5 + pow(max(uv.y, 0.0), 9.0) * 0.8;
  float sweep = smoothstep(0.07, 0.0, abs(fract(uTime * 0.3) * 1.3 - 0.15 - uv.y)) * 0.35;
  float v = (0.035 + hex * 0.12 * (0.5 + n) + streak * 0.12 + sweep * 0.6) * scan + rim * 0.7;
  gl_FragColor = vec4(uCol * v * a * uFade * boost, 1.0);
}`
const POOL_FS = /* glsl */`
uniform float uTime; uniform vec3 uCol; uniform float uFade; varying vec2 vUv;
void main(){ vec2 q = vUv * 2.0 - 1.0; float g = exp(-q.y * q.y * 5.0) * (1.0 - smoothstep(0.75, 1.0, abs(q.x)));
  float chev = smoothstep(0.3, 0.5, fract(vUv.y * 3.0 - abs(q.x) * 0.9 + uTime * 1.2)) * step(0.5, vUv.y) * (1.0 - vUv.y) * 2.0;
  float line = exp(-pow((vUv.y - 0.5) / 0.035, 2.0)) * 1.6;
  gl_FragColor = vec4(uCol * (g * 0.22 + chev * 0.12 * (1.0 - smoothstep(0.6, 1.0, abs(q.x))) + line * (1.0 - smoothstep(0.85, 1.0, abs(q.x)))) * uFade, 1.0); }`
const BASIC_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

let FRAME_GEO = null, GLOW_GEO = null
function buildGate(ctx, uTime) {
  FRAME_GEO = FRAME_GEO || frameGeometry(); GLOW_GEO = GLOW_GEO || glowGeometry()
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body)
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x353d4b, metalness: 0.85, roughness: 0.38 }); frameMat.userData.envBase = 0.9
  if (ctx.materials) ctx.materials.push(frameMat)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })
  const frame = new THREE.Mesh(FRAME_GEO, frameMat); frame.castShadow = true; frame.receiveShadow = true; body.add(frame)
  body.add(new THREE.Mesh(GLOW_GEO, glowMat))
  const U = { uTime, uCol: { value: new THREE.Color(0.3, 0.9, 1.0) }, uFade: { value: 1 }, uU: { value: 0 }, uMode: { value: 0 }, uHex: { value: ctx.hex }, uNoise: { value: ctx.noise } }
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(GATE_W - 0.42, GATE_H - 0.1), new THREE.ShaderMaterial({ ...ADD, uniforms: U, vertexShader: BASIC_VS, fragmentShader: SHEET_FS }))
  sheet.position.set(0, GATE_H / 2 + 0.35, 0); sheet.renderOrder = 9; body.add(sheet)
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(GATE_W + 0.6, 3.4), new THREE.ShaderMaterial({ ...ADD, uniforms: { uTime, uCol: U.uCol, uFade: U.uFade }, vertexShader: BASIC_VS, fragmentShader: POOL_FS }))
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.045, 0); pool.renderOrder = 4; g.add(pool)
  // 全息牌
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 448
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8
  const LW = 5.95, LH = LW * 448 / 1024
  const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
  const label = new THREE.Mesh(new THREE.PlaneGeometry(LW, LH), labelMat)
  label.position.set(0, GATE_H + 0.95 + LH * 0.36, 0.3); label.rotation.x = -0.78; label.renderOrder = 20; g.add(label)
  let cur = null, info = { index: 0, total: 0, bounty: false }, col = TYPE_COL.unit
  const redraw = () => { drawLabel(cv, cur, col, info, redraw); tex.needsUpdate = true }
  g.visible = false
  ctx.scene.add(g)
  return {
    group: g, body, U, glowMat, label, labelMat, pool, frameMat,
    get color() { return col },
    setOption(opt, inf) {
      cur = opt; info = inf
      col = inf.bounty ? TYPE_COL.bounty : (TYPE_COL[opt && opt.type] || TYPE_COL.unit)
      U.uCol.value.setRGB(col[0], col[1], col[2]); glowMat.color.setRGB(col[0] * 2.4, col[1] * 2.4, col[2] * 2.4)
      frameMat.color.set(inf.bounty ? 0x6a5228 : 0x353d4b)
      // 不当场画：两块牌子（各 1024×448，带文字阴影，再整张上传显卡）同一帧画要 30~50ms。
      // 记下来，由 update 每帧最多画一块（flush）；没画好之前牌子不显示（门刚升起的头几帧牌子本来就几乎透明）
      this.pending = true
      // 字体还没加载完时画的是后备字体：加载完再补画一次（已经加载好就别白画第二遍）
      if (document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready) document.fonts.ready.then(redraw)
    },
    pending: false,
    /** 有待画的牌子就画掉，返回 true（这一帧画过了） */
    flush() { if (!this.pending) return false; this.pending = false; redraw(); return true },
  }
}

// ---------------------------------------------------------------- 血条（空投舱头顶；朝镜头的广告牌）
function createBars(scene, cap = 12) {
  const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
  const a = new Float32Array(cap * 4), b = new Float32Array(cap * 4)
  const A = new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage), B = new THREE.InstancedBufferAttribute(b, 4).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('aA', A); g.setAttribute('aB', B); g.instanceCount = 0
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `attribute vec4 aA; attribute vec4 aB; varying vec2 vUv; varying vec4 vB;   // aA = (位置, 血量比例) aB = (宽, 高, 受击闪, 色相 0 金 1 青)
      void main(){ vUv = position.xy + 0.5; vB = vec4(aA.w, aB.z, aB.w, aB.x / aB.y); vec4 mv = viewMatrix * vec4(aA.xyz, 1.0); mv.xy += position.xy * aB.xy; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; varying vec4 vB;
      void main(){ vec2 q = vUv; float asp = vB.w; float bx = min(q.x, 1.0 - q.x) * asp, by = min(q.y, 1.0 - q.y); float e = min(bx, by);
        float border = 1.0 - smoothstep(0.10, 0.16, e); float inside = smoothstep(0.16, 0.22, e);
        float fill = step(q.x, 0.04 + vB.x * 0.92) * inside; float tick = step(0.93, fract(q.x * 10.0)) * inside * 0.5;
        vec3 hot = mix(vec3(1.0, 0.62, 0.12), vec3(0.3, 0.9, 1.0), vB.z); vec3 c = mix(vec3(0.03, 0.04, 0.05), hot * (1.3 + vB.y * 2.0), fill) * (1.0 - tick);
        c = mix(c, hot * 0.9, border); gl_FragColor = vec4(c, 0.92); }`,
  })
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 21; mesh.name = 'pod-bars'; scene.add(mesh)
  let n = 0
  return {
    begin() { n = 0 },
    put(x, y, z, ratio, w = 2.6, h = 0.26, flash = 0, hue = 0) { if (n >= cap) return; const o = n++ * 4; a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = Math.max(0, Math.min(1, ratio)); b[o] = w; b[o + 1] = h; b[o + 2] = flash; b[o + 3] = hue },
    end() { g.instanceCount = n; if (n) { A.needsUpdate = B.needsUpdate = true } },
  }
}

export function createGateView(ctx) {
  const uTime = { value: 0 }
  const gates = [buildGate(ctx, uTime), buildGate(ctx, uTime)]   // 0 = 左，1 = 右
  let shownIndex = -1, shownGate = null, spawnT = -9, lastZ = 8.4
  let gateSZ = 0, gateST = 0, gateV = 0   // 门的位置插值：上次采样的 z / 时刻、估出来的速度
  let ghost = null              // 结算后的消散演出 { z, t0, picked }
  const pools = new Map()
  const poolOf = (name) => { let p = pools.get(name); if (p === undefined || p === null) { p = createPool(name, ctx); pools.set(name, p); if (p) p.n = 0 } return p }
  const smState = new Map()
  const devices = createDeviceView(ctx), powers = createPowersFx(ctx)
  const bars = createBars(ctx.scene)
  const falling = []            // 正在下落的空投舱 { x, z, t0, delay, open(落地后自己开舱：空投支援) }
  const husks = []              // 打开的舱壳 { x, z, t0, yaw }
  const podSeen = new Map()     // id -> { x, z, yaw, hitT, spark }
  let fx = null, lastTime = 0, simNow = 0, lastWorld = null
  const R = () => Math.random() - 0.5

  const attach = (c) => {
    fx = c.fx
    devices.attach(c); powers.attach(c)
    if (!fx) return
    const C = fx.CELL
    fx.on('gateSpawn', () => { for (const s of [-1, 1]) { fx.ring(s * GATE_X, -13, 0.5, 1, 7, 0.4, 1.4, 2.4); fx.sparkleUp(s * GATE_X, -13, 8, 0.5, 1.6, 3.0, 2.4) } })
    fx.on('gateResolve', (e) => {
      const left = e.side === 'left' || e.side < 0, pk = left ? 0 : 1, x = e.x ?? (left ? -GATE_X : GATE_X), z = e.z ?? 8.4
      const c = gates[pk].color, r = c[0] * 3, g = c[1] * 3, b = c[2] * 3
      fx.ring(x, z, 0.55, 1.0, 9.0, r * 0.7, g * 0.7, b * 0.7); fx.ring(x, z + 1.5, 0.8, 0.6, 6.0, r * 0.4, g * 0.4, b * 0.4, 1)
      fx.flash(x, 2, z + 0.5, 46, 0.35, new THREE.Color(c[0], c[1], c[2]).getHex()); fx.screenFlash(0.05)
      // 穿过的门：整片能量被带出来，朝队伍方向喷一蓬光粒和竖向光丝
      for (let i = 0; i < 46; i++) { const px = x + R() * (GATE_W - 0.6), py = 0.3 + Math.random() * (GATE_H - 0.2); fx.emitAdd(px, py, z, R() * 3.5, 1.5 + Math.random() * 3.5, 2.5 + Math.random() * 7, 0.45 + Math.random() * 0.5, 0.16 + Math.random() * 0.12, 0.03, r, g, b, 0, i % 3 ? C.DOT : C.STAR, -3, 1.4, i % 3 ? 1.6 : 0, Math.random() * 6, R() * 8) }
      for (let i = 0; i < 12; i++) fx.emitAdd(x + R() * (GATE_W - 1), 0.2, z + 0.4 + Math.random() * 2.5, 0, 5 + Math.random() * 5, 0, 0.35 + Math.random() * 0.25, 0.42, 0.12, r * 0.8, g * 0.8, b * 0.8, 0, C.STREAK, 0, 0.5, 2.2)
      fx.emitAdd(x, GATE_H * 0.5, z, 0, 0, 1, 0.22, 3, 9, r * 0.6, g * 0.6, b * 0.6, 0, C.FLARE, 0, 0, 0, Math.random() * 6)
      // 另一扇：碎成暗色的玻璃渣掉下去
      const ox = -x, oc = gates[1 - pk].color
      for (let i = 0; i < 40; i++) { const px = ox + R() * (GATE_W - 0.6), py = 0.4 + Math.random() * (GATE_H - 0.3); fx.emitAdd(px, py, z, R() * 2.2, 0.5 + Math.random() * 2, R() * 2.2 - 0.6, 0.5 + Math.random() * 0.5, 0.14 + Math.random() * 0.1, 0.05, oc[0] * 1.2, oc[1] * 1.2, oc[2] * 1.2, 0.7, C.DOT, -13, 0.4, 0.7, Math.random() * 6, R() * 12) }
      for (let i = 0; i < 5; i++) fx.emitAlpha(ox + R() * GATE_W, 0.3, z, R(), 0.6, R(), 0.9, 0.6, 1.6, 0.08, 0.085, 0.1, 0.3, C.SMOKE_A, 0, 1.4, 0, Math.random() * 6, R())
    })
    fx.on('podLand', (e) => {
      for (let i = falling.length - 1; i >= 0; i--) if (Math.abs(falling[i].x - e.x) < 1.5 && Math.abs(falling[i].z - e.z) < 1.5) falling.splice(i, 1)
      impact(e.x, e.z, 1)
    })
    fx.on('podOpen', (e) => {
      const s = podSeen.get(e.id)
      husks.push({ x: e.x, z: e.z, t0: simNow, yaw: s ? s.yaw : 0 })
      fx.ring(e.x, e.z, 0.6, 1.0, 7.0, 2.8, 1.5, 0.35); fx.ring(e.x, e.z, 0.35, 2.4, 0.5, 2.6, 1.6, 0.4)
      fx.sparkleUp(e.x, e.z, 20, 3.0, 1.8, 0.5, 1.2); fx.flash(e.x, 2, e.z, 34, 0.35)
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; for (let i = 0; i < 4; i++) fx.emitAlpha(e.x + Math.cos(a) * 1.0, 0.6 + i * 0.3, e.z + Math.sin(a) * 1.0, Math.cos(a) * (2 + i), 0.6, Math.sin(a) * (2 + i), 0.8, 0.5, 1.6, 0.5, 0.5, 0.52, 0.28, C.SMOKE_A + (i % 3), 0, 2.2, 0, Math.random() * 6, R()) }   // 泄压的白汽
    })
    fx.on('podLost', (e) => { if (e.x != null) { fx.explosion(e.x, e.z ?? 17, 0.7); fx.ring(e.x, e.z ?? 17, 0.5, 0.5, 4, 2.6, 0.4, 0.2) } })
    const baseStrike = fx.handler('strike')
    fx.on('strike', (e, f, w) => {
      if (e.kind === 'pod' && e.x != null) { falling.push({ x: e.x, z: e.z, t0: simNow, delay: Math.max(0.25, e.delay || 0.8), open: e.power !== 'contract' }); fx.ring(e.x, e.z, Math.max(0.3, e.delay || 0.8), (e.r || 2.2) * 2.4, 0.6, 2.8, 1.4, 0.3); return }
      if (!powers.strike(e, w) && baseStrike) baseStrike(e, f, w)
    })
  }
  const impact = (x, z, s) => {
    if (!fx) return
    const C = fx.CELL
    fx.explosion(x, z, 0.75 * s); fx.dirtBurst(x, z, 1.7 * s); fx.shake(0.18 * s); fx.shock(x, 0.4, z, 0.7 * s, 6 * s, 0.5)
    fx.ring(x, z, 0.5, 1.0, 10 * s, 2.4, 1.3, 0.4)
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; fx.emitAlpha(x + Math.cos(a) * 0.9, 0.25, z + Math.sin(a) * 0.9, Math.cos(a) * (5 + Math.random() * 3), 0.7, Math.sin(a) * (5 + Math.random() * 3), 0.9 + Math.random() * 0.4, 0.7, 2.4, 0.13, 0.12, 0.115, 0.42, C.SMOKE_A + (i % 3), 0, 2.4, 0, Math.random() * 6, R()) }   // 贴地的环形尘浪
    fx.stain(x, z, 14, 2.0, 3.8, Math.random() * 6, 0.05, 0.028, 0.018, 0.6, C.SCORCH, 10)
  }

  return {
    pools, devices, powers, attach,
    /** 预建实例池：空投舱 / 召唤物 / 装置（着色器随启动一起编译） */
    prewarm(ok, names) {
      for (const n of names) if ((n === 'prop.pod' || n.startsWith('summon.')) && ok(n)) poolOf(n)
      if (devices.prewarm) devices.prewarm(ok, names)
      for (const g of gates) { g.group.visible = true; g.U.uFade.value = 0; g.labelMat.opacity = 0 }   // 门平时是隐藏的，compile 不会碰隐藏的物体：编译期间先亮出来（全透明），endWarm 再藏回去
    },
    endWarm() { for (const g of gates) g.group.visible = false },
    setPlacement(kind, lane, row, valid) { devices.setPlacement(kind, lane, row, valid) },
    setEnergyTarget(x, y) { devices.setEnergyTarget(x, y) },
    /** 注入文案函数 t(key, params)（换语言后再调一次）；当前显示的门牌会立刻重画 */
    setTranslator(fn) { T = typeof fn === 'function' ? fn : null; shownGate = null },
    reset() { shownIndex = -1; shownGate = null; ghost = null; falling.length = 0; husks.length = 0; podSeen.clear(); smState.clear(); for (const g of gates) g.group.visible = false; for (const p of pools.values()) if (p) p.inst.commit(0); devices.reset(); powers.reset(); bars.begin(); bars.end() },
    consume(events, time, realTime) {
      for (const e of events) {
        if (e.type === 'gateResolve') ghost = { z: e.z ?? lastZ, t0: realTime, picked: e.side === 'left' || e.side < 0 ? 0 : 1 }
        else if (e.type === 'energy') devices.notePulse(lastWorld, e, time)
      }
    },
    update(world, time, realTime) {
      const dt = Math.max(0, Math.min(0.1, time - lastTime)); lastTime = time; simNow = time; lastWorld = world
      uTime.value = realTime
      // ---------------- 门 ----------------
      const G = world.gates
      if (G) {
        if (G.index !== shownIndex || G !== shownGate) {
          shownIndex = G.index; shownGate = G; ghost = null; spawnT = realTime; gateSZ = G.z; gateST = time; gateV = 0
          const inf = { index: G.index | 0, total: G.total | 0, bounty: G.kind === 'bounty' }
          gates[0].setOption(G.left, inf); gates[1].setOption(G.right, inf)
        }
        if (time > gateST) { const d = G.z - gateSZ; gateV = Math.abs(d) < 3 ? d / (time - gateST) : 0; gateSZ = G.z; gateST = time } else if (time < gateST) { gateSZ = G.z; gateST = time; gateV = 0 }
        const gz = G.z - gateV * (ctx.back || 0)
        lastZ = gz
        const rise = Math.min(1, (realTime - spawnT) / 0.35), er = 1 - Math.pow(1 - rise, 3)
        // 测试：无尽里 Boss 在场时门也照常来，门楣上那块全息牌（不做深度测试、永远压在最上面）
        // 正好落在屏幕顶中、和 Boss 血条 / 阶段横幅叠成一团。Boss 在场时牌子收起来——两侧的门卡（HUD）照样写着选项
        const bossOn = !!(world.boss && world.boss.hp > 0)
        if (!gates[0].flush()) gates[1].flush()     // 门牌一帧最多画一块（见 setOption）
        for (let k = 0; k < 2; k++) {
          const g = gates[k]; g.group.visible = true; g.group.position.set(k ? GATE_X : -GATE_X, 0, gz); g.group.rotation.set(0, 0, 0)
          g.body.scale.set(1, Math.max(0.02, er), 1); g.body.position.y = 0
          const mine = world.squad && ((world.squad.x < 0) === (k === 0))   // 队伍站在哪一侧，哪扇门更亮
          const pulse = mine ? 1.2 + 0.18 * Math.sin(realTime * 7) : 0.62
          g.U.uFade.value = pulse * er; g.U.uU.value = 0; g.U.uMode.value = 0
          const c = g.color, gl = (mine ? 2.6 : 1.5) * er; g.glowMat.color.setRGB(c[0] * gl, c[1] * gl, c[2] * gl)
          g.label.visible = !bossOn && !g.pending; g.label.scale.setScalar((mine ? 1.06 : 0.96) * (0.4 + 0.6 * er)); g.labelMat.opacity = er * (mine ? 1 : 0.9); g.labelMat.color.setScalar(mine ? 1.1 : 0.85)
          g.pool.visible = true
        }
      } else if (ghost) {
        const u = (realTime - ghost.t0) / 0.6
        if (u >= 1) { ghost = null; for (const g of gates) g.group.visible = false }
        else for (let k = 0; k < 2; k++) {
          const g = gates[k], pk = k === ghost.picked; g.group.visible = true
          g.group.position.z = ghost.z + u * (pk ? 1.2 : 0.4)
          g.U.uU.value = u; g.U.uMode.value = pk ? 1 : 2; g.U.uFade.value = pk ? 1.6 : 0.9
          const c = g.color, gl = pk ? 3.2 * (1 - u) : 1.2 * Math.max(0, 1 - u * 2.5) * (Math.sin(realTime * 60) > 0 ? 1 : 0.3); g.glowMat.color.setRGB(c[0] * gl, c[1] * gl, c[2] * gl)
          if (pk) { g.body.scale.set(1, Math.max(0.02, 1 - Math.max(0, u - 0.45) / 0.55), 1); g.label.scale.setScalar(1.06 + 0.35 * Math.sin(Math.min(1, u * 2.2) * Math.PI)); g.labelMat.opacity = Math.max(0, 1 - Math.max(0, u - 0.4) * 1.8); g.labelMat.color.setScalar(1.1 + 0.5 * (1 - u)) }
          else { g.body.scale.set(1, Math.max(0.02, 1 - u * u * 1.4), 1); g.group.rotation.x = -u * u * 0.5; g.label.scale.setScalar(0.94 * (1 - u * 0.5)); g.labelMat.opacity = Math.max(0, 1 - u * 3.5); g.labelMat.color.setScalar(0.7) }
          g.pool.visible = pk && u < 0.5
        }
      } else for (const g of gates) g.group.visible = false

      for (const p of pools.values()) if (p) p.n = 0
      bars.begin()
      // ---------------- 空投舱 ----------------
      const pods = world.pods || []
      const P = pods.length || falling.length || husks.length ? poolOf('prop.pod') : null
      if (P) {
        const inst = P.inst
        for (const p of pods) {
          if (P.n >= inst.capacity) break
          let s = podSeen.get(p.id); if (!s) { s = { yaw: (p.id * 2.399) % 6.28, hitT: -9, hp: p.hp, spark: 0 }; podSeen.set(p.id, s) }
          if (p.hitT != null) s.hitT = Math.max(s.hitT, p.hitT); else if (p.hp < s.hp - 0.01) s.hitT = time
          s.hp = p.hp; s.x = p.x; s.z = p.z
          const n = P.n++, h = time - s.hitT, ratio = p.hpMax ? p.hp / p.hpMax : 1
          inst.put(n, p.x + (h < 0.12 ? R() * 0.05 : 0), 0, p.z, s.yaw, P.scale, inst.frameAt(P.clipOr('idle', 'idle'), time), 1, h >= 0 && h < 0.15 ? -(1 - h / 0.15) * 0.7 : 0, (p.id * 0.37) % 1, 0, 0, 1.1 + 0.5 * Math.sin(realTime * 6))
          inst.tint(n, 0, 0, 0, 0)
          bars.put(p.x, 3.9, p.z, ratio, 3.0, 0.3, h >= 0 && h < 0.15 ? 1 - h / 0.15 : 0, 0)
          if (fx && dt > 0) { s.spark += dt * 7; while (s.spark > 1) { s.spark -= 1; const a = Math.random() * 6.28; fx.emitAdd(p.x + Math.cos(a) * 1.2, 0.08, p.z + Math.sin(a) * 1.2 + 0.4, R() * 2, 1 + Math.random() * 2, -1.5 - Math.random() * 2, 0.3, 0.09, 0.03, 3.0, 1.8, 0.5, 1, fx.CELL.DOT, -9, 0.5, 1.3) } }   // 滑行时腿下蹭出的火星
        }
        if (podSeen.size > pods.length + 8) { const live = new Set(pods.map((p) => p.id)); for (const k of podSeen.keys()) if (!live.has(k)) podSeen.delete(k) }
        for (let i = falling.length - 1; i >= 0; i--) {
          const f = falling[i], u = (time - f.t0) / f.delay
          if (u >= 1 || u < 0) { falling.splice(i, 1); if (u >= 1 && f.open) { husks.push({ x: f.x, z: f.z, t0: time, yaw: 0.6 }); impact(f.x, f.z, 0.8) } continue }
          if (P.n >= inst.capacity) continue
          const k = 1 - u, y = 46 * k * k + 10 * k, px = f.x + 5 * k, pz = f.z - 9 * k, n = P.n++
          inst.put(n, px, y, pz, 0.6, P.scale, inst.frameAt(P.clipOr('idle', 'idle'), time), 1.2, 0.35, 0.3, 0.1 * k, -0.18 * k, 3)
          inst.tint(n, 1, 0.45, 0.1, 0.3 * k)
          if (fx && dt > 0) { const C = fx.CELL; for (let j = 0; j < 3; j++) { fx.emitAdd(px + R() * 0.5, y + 0.4 + j, pz + R() * 0.5, R() * 2, 6 + Math.random() * 5, R() * 2, 0.22 + Math.random() * 0.15, 1.4, 0.4, 3.2, 1.5, 0.35, 1.2, j ? C.FIRE : C.FLARE, 0, 1, 0, Math.random() * 6, R() * 4) } fx.emitAlpha(px, y + 2.5, pz, R(), 3, R(), 1.0, 0.8, 2.6, 0.06, 0.055, 0.055, 0.35, C.SMOKE_B, 0, 0.8, 0, Math.random() * 6, R()) }
        }
        for (let i = husks.length - 1; i >= 0; i--) {
          const c = husks[i], td = time - c.t0
          if (td > 2.2 || td < 0) { husks.splice(i, 1); continue }
          if (P.n >= inst.capacity) continue
          const die = P.clip('die'), n = P.n++, sink = Math.max(0, td - 1.4)
          inst.put(n, c.x, -sink * sink * 4, c.z, c.yaw, P.scale, die ? inst.frame(die, Math.min(1, td / 0.55)) : 0, 1 - sink, td < 0.1 ? 0.8 : 0, 0, 0, 0, Math.max(0, 1.2 - td))
          inst.tint(n, 0, 0, 0, 0)
        }
      }
      bars.end()
      // ---------------- 技能召唤物：旗舰（悬停，y 是高度）/ 机器人（地面，会走）。ray 是纯特效，powersfx 画 ----------------
      const summons = world.summons || []
      for (const sm of summons) {
        if (sm.kind === 'ray') continue
        const SP = poolOf('summon.' + sm.kind); if (!SP || SP.n >= SP.inst.capacity) continue
        const n = SP.n++, inst = SP.inst, sf = time - (sm.fireT ?? -9)
        let st = smState.get(sm.id); if (!st) { st = { x: sm.x, z: sm.z, v: 0 }; smState.set(sm.id, st) }
        const v = Math.hypot(sm.x - st.x, sm.z - st.z); st.v += (v - st.v) * 0.2; st.x = sm.x; st.z = sm.z
        const shoot = SP.clip('shoot'), C = shoot && SP.asset.clips[shoot]
        let frame
        if (shoot && sf >= 0 && sf < C.duration) frame = C.loop ? inst.frameAt(shoot, sf) : inst.frame(shoot, sf / C.duration)
        else frame = inst.frameAt(st.v > 0.01 ? SP.clipOr('walk', 'idle') : SP.clipOr('idle', 'walk'), time + sm.id * 0.37)
        const born = Math.min(1, (time - (sm.t0 ?? time - 1)) / (sm.kind === 'flagship' ? 0.9 : 0.4)), leave = sm.t1 != null ? Math.min(1, Math.max(0, (sm.t1 - time) / 0.8)) : 1
        const eb = 1 - Math.pow(1 - born, 3), el = 1 - leave
        if (sm.kind === 'flagship') {   // 旗舰从队伍后上方滑进来，任务结束抬头向前飞走
          inst.put(n, sm.x, (sm.y || 9) + (1 - eb) * 9 + el * el * 12, sm.z + (1 - eb) * 42 - el * el * 46, Math.PI, SP.scale, frame, 1, sf >= 0 && sf < 0.08 ? 0.4 : 0, (sm.id * 0.61) % 1, 0, -0.18 * (1 - eb) + 0.3 * el, 1.2)
          powers.flagshipAt(sm, sm.x, (sm.y || 9) + (1 - eb) * 9 + el * el * 12, sm.z + (1 - eb) * 42 - el * el * 46, time, dt)
        } else inst.put(n, sm.x, (sm.y || 0) + (1 - born) * (1 - born) * 16, sm.z, sm.facing ?? Math.PI, SP.scale, frame, 1, sf >= 0 && sf < 0.08 ? 0.6 : (born < 1 ? 0.5 : 0), (sm.id * 0.61) % 1, 0, 0, 1)
        inst.tint(n, 0, 0, 0, 0)
      }
      if (smState.size > summons.length + 8) smState.clear()
      for (const p of pools.values()) if (p) p.inst.commit(p.n)

      devices.update(world, time, realTime)
      powers.update(world, time, realTime, dt)
    },
  }
}
