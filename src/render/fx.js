// fx.js —— 全部特效：GPU 弹道粒子池 / 曳光弹 / 地面贴花与冲击环 / 喷火锥 / 光束 / 闪光灯 / 飘字锚点。
// 所有池都是「环形缓冲 + 着色器里按 uTime 演化」：CPU 只在生成那一刻写一次属性，满了就覆盖最老的。
// 事件量很大（每秒几百个 shot / enemyDie），这里负责节流（每帧预算）和表现延迟（子弹飞到才播命中）。
//
// 加特效的三种办法（详见 docs/RENDER.md）：
//   1) 给某个兵种换弹道：改 WEAPON_FX 表
//   2) 给某个事件加表现：fx.on('事件名', (e, fx) => { fx.burst(...) })
//   3) 直接用原语：fx.emitAdd / emitAlpha / tracer / ring / stain / explosion / flash / shock / beam
import * as THREE from 'three'
import { ENEMY_KINDS } from '../data/enemies.js'
import { ASSET_ROOT, assetUrl } from './base.js'

const PB = ASSET_ROOT + 'ui/tex/particles_black/'
export const CELL = { DOT: 0, SMOKE_A: 1, SMOKE_B: 2, SMOKE_C: 3, FIRE: 4, BURST: 5, WISP: 6, MUZZLE: 7, DIRT_A: 8, DIRT_B: 9, STAR: 10, STREAK: 11, RING: 12, SHOCK: 13, SCORCH: 14, FLARE: 15 }
const CELL_FILES = ['circle_05', 'smoke_04', 'smoke_07', 'smoke_09', 'fire_01', 'scorch_03', 'flame_03', 'muzzle_02', 'dirt_02', 'dirt_03', 'star_01', 'trace_07', 'circle_02', 'light_03', 'scorch_01', 'magic_05']

/** 各兵种的弹道表现。speed 0 = 按事件的 delay 反推；beam = 瞬时光束而不是曳光弹 */
export const WEAPON_FX = {
  // 步枪曳光：原来按命中延迟反推速度（≈150 m/s、长 1.9 米），一条只亮 5 帧，站桩时几乎看不见。
  // 现在固定 72 m/s、长 3.4 米、更宽更亮 + 弹头落地后尾巴收进目标：同屏常驻 30 条左右，读成「弹幕连线」（参考 038）。命中表现仍按 DEATH_DELAY，差几十毫秒看不出来
  rifle: { col: [4.2, 2.8, 0.85], len: 4.4, width: 0.15, muzzle: 0.4, mcol: [2.4, 1.55, 0.5], speed: 72 },   // 枪口焰 0.55 → 0.4、亮度 ×0.8：六十个兵同时开火时方阵上一片四角星，把兵盖住（测试「白黄枪口火花偏亮」）
  mortar: { col: [4.0, 2.2, 0.7], len: 3.6, width: 0.24, muzzle: 2.0, mcol: [3.2, 2.0, 0.8], speed: 0, smoke: 1, flash: 22, shake: 0.05 },
  titan: { col: [4.0, 1.8, 0.5], len: 3.0, width: 0.2, muzzle: 1.4, mcol: [3.2, 1.8, 0.6], speed: 0, smoke: 1, flash: 16, shake: 0.03, dual: true },
  lancer: { beam: true, col: [0.5, 1.6, 3.2], width: 0.34, life: 0.16, muzzle: 1.3, mcol: [0.8, 2.0, 3.2], flash: 14, flashCol: 0x60b0ff, shake: 0.03 },
  // orbit: 弹道从绕母机转的子机出（squadview.muzzle 按 meta.orbit 算第 k 架子机的位置）；y 是拿不到单位时的兜底高度 = 子机悬停高度
  skyhook: { col: [0.7, 2.4, 3.2], len: 1.4, width: 0.08, muzzle: 0.3, mcol: [0.7, 2.0, 3.0], speed: 70, y: 2.85, orbit: true },
  companion: { col: [0.5, 2.2, 3.4], len: 1.8, width: 0.16, muzzle: 0.5, mcol: [0.6, 2.0, 3.2], speed: 0, y: 2.4, flash: 8, flashCol: 0x60c8ff },
  hero_hawk: { beam: true, col: [0.3, 1.0, 2.2], width: 0.2, life: 0.14, muzzle: 0.8, mcol: [0.6, 1.8, 3.0] },
  sentry: { col: [3.2, 2.4, 0.8], len: 1.6, width: 0.09, muzzle: 0.35, mcol: [2.6, 1.9, 0.7], speed: 70, y: 1.0 },
  cryo: { col: [0.5, 1.35, 2.1], len: 1.2, width: 0.11, muzzle: 0.28, mcol: [0.5, 1.2, 1.9], speed: 46, y: 1.4 },   // 亮度 ×0.6、枪口焰 0.4 → 0.28：冷凝塔对着 Boss 连发时，Boss 跟前一串亮青光球
  default: { col: [3.2, 2.2, 0.8], len: 1.8, width: 0.1, muzzle: 0.4, mcol: [2.6, 1.7, 0.6], speed: 0 },
}
/** 「谁打死的」→ 死亡表现延迟（秒）。步枪 0.08、炮弹 0.13（GDD §9） */
// 装置打死的（enemyDie.by = 装置 kind）：哨戒塔 / 冷凝塔等子弹飞到；迫击炮台等炮弹落地（和 deviceview 的 MORTAR_T 同值）
export const DEATH_DELAY = { rifle: 0.08, mortar: 0.13, titan: 0.13, lancer: 0.05, skyhook: 0.05, sentry: 0.05, cryo: 0.08, mortarpit: 0.32 }
const EXPLOSION_SIZE = { s: 0.55, m: 0.8, l: 1.0, xl: 1.7 }

async function buildAtlas() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S * 4; const g = c.getContext('2d')
  g.fillStyle = '#000'; g.fillRect(0, 0, S * 4, S * 4)
  await Promise.all(CELL_FILES.map((f, i) => new Promise((res) => {
    const im = new Image(); im.onload = () => { g.drawImage(im, (i % 4) * S + 4, Math.floor(i / 4) * S + 4, S - 8, S - 8); res() }; im.onerror = res; im.src = PB + f + '.png'
  })))
  const d = g.getImageData(0, 0, S * 4, S * 4)
  const t = new THREE.DataTexture(new Uint8Array(d.data.buffer.slice(0)), S * 4, S * 4, THREE.RGBAFormat)   // DataTexture：上下文丢失后能重传
  t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true
  return t
}

const QUAD = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); return g }

class Pool {
  constructor(cap, names) {
    this.cap = cap; this.head = 0; this.geo = QUAD(); this.arr = {}; this.attr = {}; this.dirty = false
    for (const n of names) { this.arr[n] = new Float32Array(cap * 4); this.attr[n] = new THREE.InstancedBufferAttribute(this.arr[n], 4).setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(n, this.attr[n]) }
    this.geo.instanceCount = cap
    this.t0 = this.arr[names[0]]
    for (let i = 3; i < this.t0.length; i += 4) this.t0[i] = -1e6   // 出生时刻放在第一个属性的 w：全部初始为「早已过期」
  }
  next() { const i = this.head; this.head = (this.head + 1) % this.cap; this.dirty = true; return i * 4 }
  flush() { if (this.dirty) { for (const k in this.attr) this.attr[k].needsUpdate = true; this.dirty = false } }
  clear() { for (let i = 3; i < this.t0.length; i += 4) this.t0[i] = -1e6; this.dirty = true }
}

// ---------------- 弹道粒子 ----------------
const PARTICLE_VS = /* glsl */`
attribute vec4 aP; attribute vec4 aV; attribute vec4 aS; attribute vec4 aC; attribute vec4 aM;
uniform float uTime; varying vec2 vUv; varying vec4 vCol; varying float vAge;
void main() {
  float t = uTime - aP.w; float age = t / aV.w;
  if (age < 0.0 || age >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float drag = aM.z; float te = drag > 0.0 ? (1.0 - exp(-drag * t)) / drag : t;
  vec3 p = aP.xyz + aV.xyz * te; p.y += 0.5 * aM.y * t * t;
  float floorY = 0.04; if (aM.y < 0.0 && p.y < floorY) p.y = floorY;
  float size = mix(aS.x, aS.y, 1.0 - (1.0 - age) * (1.0 - age));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 c = position.xy;
  if (aM.w > 0.0) {                       // 速度方向拉伸（火花 / 液滴）
    vec3 vel = aV.xyz * exp(-drag * t); vel.y += aM.y * t;
    vec2 d = (viewMatrix * vec4(vel, 0.0)).xy; float l = length(d); d = l > 1e-4 ? d / l : vec2(0.0, 1.0);
    vec2 o = d * c.y * size * (1.0 + aM.w * min(l, 14.0) * 0.12) + vec2(-d.y, d.x) * c.x * size;
    mv.xy += o;
  } else {
    float r = aS.z + aS.w * t; float cs = cos(r), sn = sin(r);
    mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  }
  gl_Position = projectionMatrix * mv;
  float cell = aM.x; vUv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + position.xy + 0.5) * 0.25;
  vCol = aC; vAge = age;
}`
const PARTICLE_FS_ADD = /* glsl */`
uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol; varying float vAge;
void main() { float a = texture2D(uAtlas, vUv).r; float f = smoothstep(0.0, 0.06, vAge) * pow(max(1.0 - vAge, 0.0), 1.6);
  float cool = clamp(vAge * vCol.a, 0.0, 1.0);             // a 通道 = 随寿命变冷的程度
  vec3 c = vCol.rgb * mix(vec3(1.0), vec3(0.55, 0.16, 0.05), cool);
  gl_FragColor = vec4(c * a * f, 1.0); }`
const PARTICLE_FS_ALPHA = /* glsl */`
uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol; varying float vAge;
void main() { float a = texture2D(uAtlas, vUv).r; float f = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
  gl_FragColor = vec4(vCol.rgb * (0.6 + 0.4 * a), a * f * vCol.a); }`

// ---------------- 曳光弹 ----------------
const TRACER_VS = /* glsl */`
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aL;
uniform float uTime; varying vec2 vUv; varying vec3 vCol;
void main() {
  // aB.w = 弹头飞到落点的时间。弹头到了以后尾巴继续往里收（整条曳光「钻进」目标才消失），曳光多留 len / 速度 那么久
  vec3 dir = aB.xyz - aA.xyz; float dist = max(length(dir), 1e-4); dir /= dist;
  float u = (uTime - aA.w) / aB.w;
  if (u < 0.0 || u >= 1.0 + aL.x / dist) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float headD = min(u * dist, dist); float tailD = clamp(u * dist - aL.x, 0.0, dist);
  vec3 p = aA.xyz + dir * mix(tailD, headD, position.y + 0.5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 d = normalize((viewMatrix * vec4(dir, 0.0)).xy + 1e-5);
  mv.xy += vec2(-d.y, d.x) * position.x * aC.w;
  gl_Position = projectionMatrix * mv; vUv = position.xy + 0.5; vCol = aC.rgb;
}`
const TRACER_FS = /* glsl */`
varying vec2 vUv; varying vec3 vCol;
void main() { float x = abs(vUv.x - 0.5) * 2.0; float core = exp(-x * x * 7.0); float l = smoothstep(0.0, 0.85, vUv.y) * (1.0 - smoothstep(0.93, 1.0, vUv.y) * 0.6);
  gl_FragColor = vec4((vCol * core + vec3(1.0) * pow(core, 6.0) * 0.8) * l * l, 1.0); }`

// ---------------- 光束（整段可见，按寿命淡出；用于轨道炮 / 闪电链 / 横扫光束）----------------
const BEAM_VS = /* glsl */`
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aL;   // (from, t0) (to, life) (rgb, width) (jitter, _, _, _)
uniform float uTime; varying vec2 vUv; varying vec3 vCol; varying float vAge; varying float vJit;
void main() {
  float age = (uTime - aA.w) / aB.w;
  if (age < 0.0 || age >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = mix(aA.xyz, aB.xyz, position.y + 0.5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec2 d = normalize((viewMatrix * vec4(aB.xyz - aA.xyz, 0.0)).xy + 1e-5);
  mv.xy += vec2(-d.y, d.x) * position.x * aC.w * (1.0 + aL.x * 2.0);
  gl_Position = projectionMatrix * mv; vUv = position.xy + 0.5; vCol = aC.rgb; vAge = age; vJit = aL.x;
  vUv.y *= length(aB.xyz - aA.xyz);
}`
const BEAM_FS = /* glsl */`
uniform float uTime; varying vec2 vUv; varying vec3 vCol; varying float vAge; varying float vJit;
void main() { float xo = vJit > 0.0 ? (sin(vUv.y * 9.0 + uTime * 60.0) * 0.5 + sin(vUv.y * 23.0 - uTime * 43.0) * 0.3) * 0.3 * vJit : 0.0;   // 闪电抖动
  float x = (vUv.x - 0.5 + xo) * 2.0 * (1.0 + vJit * 2.0); float core = exp(-x * x * 26.0); float halo = exp(-x * x * 3.2) * 0.35;
  float fl = 0.85 + 0.15 * sin(vUv.y * 9.0 - uTime * 50.0);
  gl_FragColor = vec4((vCol * (halo + core * 1.6) + vec3(1.0) * pow(core, 3.0) * min(2.0, dot(vCol, vec3(0.45)))) * fl * pow(max(1.0 - vAge, 0.0), 1.5), 1.0); }`

// ---------------- 地面贴花（污渍 / 焦痕 / 冲击环） ----------------
const GROUND_VS = /* glsl */`
attribute vec4 aP; attribute vec4 aS; attribute vec4 aC; attribute vec4 aM;
uniform float uTime; varying vec2 vUv; varying vec2 vQ; varying vec4 vCol; varying float vAge;
void main() {
  float age = (uTime - aP.w) / aS.w;
  if (age < 0.0 || age >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float size = mix(aS.x, aS.y, 1.0 - pow(max(1.0 - age, 0.0), aM.y));
  float cs = cos(aS.z), sn = sin(aS.z); vec2 c = position.xy;
  vec3 p = vec3(aP.x + (c.x * cs - c.y * sn) * size, aP.y, aP.z + (c.x * sn + c.y * cs) * size);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float cell = aM.x; vUv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + position.xy + 0.5) * 0.25; vQ = position.xy * 2.0; vCol = aC; vAge = age;
}`
const STAIN_FS = /* glsl */`
uniform sampler2D uAtlas; uniform vec3 uAmbient; varying vec2 vUv; varying vec2 vQ; varying vec4 vCol; varying float vAge;
void main() { float a = texture2D(uAtlas, vUv).r; a = smoothstep(0.08, 0.5, a);
  float f = smoothstep(0.0, 0.02, vAge) * (1.0 - smoothstep(0.3, 1.0, vAge));   // 从三成寿命起就慢慢淡出（原来到七成才淡，满地黑斑）
  gl_FragColor = vec4(vCol.rgb * uAmbient, a * f * vCol.a); }`   // 乘环境亮度：暗处的污渍不会「自己发亮」
const RING_FS = /* glsl */`
uniform sampler2D uAtlas; varying vec2 vUv; varying vec2 vQ; varying vec4 vCol; varying float vAge;
void main() { float r = length(vQ); float ring = smoothstep(0.86, 0.95, r) * (1.0 - smoothstep(0.955, 1.0, r));
  float soft = texture2D(uAtlas, vUv).r;
  float v = mix(ring + 0.035 * (1.0 - smoothstep(0.0, 0.9, r)), soft, vCol.a);
  gl_FragColor = vec4(vCol.rgb * v * pow(max(1.0 - vAge, 0.0), 1.5), 1.0); }`

// ---------------- 喷火锥（程序噪声火焰） ----------------
const FLAME_VS = /* glsl */`
attribute vec4 aF; attribute vec4 aG; // (x, z, yaw, seed) (len, width, intensity, y)
uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vInt;
void main() {
  vUv = uv; vSeed = aF.w; vInt = aG.z;
  vec3 p = position; float along = uv.y;
  p.x *= aG.y * (0.12 + 0.88 * pow(along, 0.75)); p.z *= aG.x;
  p.x += sin(uTime * 9.0 + aF.w * 20.0 + along * 5.0) * 0.12 * along * aG.y;
  p.y = p.y * aG.y * along + aG.w * (1.0 - along * 0.55) + along * along * 0.25;
  float c = cos(aF.z), s = sin(aF.z);
  p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + vec3(aF.x, 0.0, aF.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`
const FLAME_FS = /* glsl */`
uniform sampler2D uNoise; uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vInt;
void main() {
  float y = vUv.y; float x = (vUv.x - 0.5) * 2.0;
  vec2 q = vec2(vUv.x * 0.55 + vSeed, y * 0.75 - uTime * 1.9);
  float n = texture2D(uNoise, q).r * 0.6 + texture2D(uNoise, q * 2.3 + vec2(0.3, -uTime * 1.3)).r * 0.4;
  float shape = (1.0 - abs(x) * abs(x)) * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.55, 1.0, y + (n - 0.5) * 0.55));
  float heat = clamp(shape * (0.35 + n * 1.25) * (1.25 - y * 0.75), 0.0, 1.6);
  vec3 col = mix(vec3(1.0, 0.12, 0.02), vec3(1.0, 0.5, 0.08), smoothstep(0.15, 0.6, heat));
  col = mix(col, vec3(1.0, 0.92, 0.62), smoothstep(0.62, 1.15, heat));
  gl_FragColor = vec4(col * heat * heat * 1.8 * vInt, 1.0);   // 2.3 → 1.8：一排喷火兵的火墙别过曝成白黄一片
}`

/**
 * createFX({ scene, rng, squad, post, camera }) —— squad: { muzzle(id, out, k) -> bool, find(kind) }；post: { addShock(x,y,z,strength,radius,dur) }
 */
export async function createFX(ctx) {
  const { scene } = ctx
  const rng = ctx.rng || Math.random
  const [atlas, noise] = await Promise.all([buildAtlas(), new THREE.TextureLoader().loadAsync(ASSET_ROOT + 'ui/tex/generated/noise_fbm_512.png')])
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping
  const uTime = { value: 0 }, uAmbient = { value: new THREE.Color(1, 1, 1) }
  const group = new THREE.Group(); group.name = 'fx'; scene.add(group)
  const mk = (pool, vs, fs, blending, order) => {
    const m = new THREE.ShaderMaterial({ uniforms: { uTime, uAtlas: { value: atlas }, uAmbient }, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending, fog: false, side: THREE.DoubleSide })
    if (blending === THREE.AdditiveBlending) { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blendEquation = THREE.AddEquation }
    const mesh = new THREE.Mesh(pool.geo, m); mesh.frustumCulled = false; mesh.renderOrder = order; group.add(mesh); return mesh
  }
  const N5 = ['aP', 'aV', 'aS', 'aC', 'aM']
  const pAdd = new Pool(5000, N5), pAlpha = new Pool(2800, N5)
  const tracers = new Pool(1400, ['aA', 'aB', 'aC', 'aL']), beams = new Pool(96, ['aA', 'aB', 'aC', 'aL'])
  const stains = new Pool(1600, ['aP', 'aS', 'aC', 'aM']), rings = new Pool(160, ['aP', 'aS', 'aC', 'aM'])
  mk(stains, GROUND_VS, STAIN_FS, THREE.NormalBlending, 1)
  mk(rings, GROUND_VS, RING_FS, THREE.AdditiveBlending, 3)
  mk(pAlpha, PARTICLE_VS, PARTICLE_FS_ALPHA, THREE.NormalBlending, 6)
  mk(pAdd, PARTICLE_VS, PARTICLE_FS_ADD, THREE.AdditiveBlending, 7)
  mk(tracers, TRACER_VS, TRACER_FS, THREE.AdditiveBlending, 8)
  mk(beams, BEAM_VS, BEAM_FS, THREE.AdditiveBlending, 8)
  const pools = [pAdd, pAlpha, tracers, beams, stains, rings]

  const emit = (pool, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, cell, grav = 0, drag = 0, stretch = 0, rot = 0, rotV = 0) => {
    const o = pool.next(), A = pool.arr
    A.aP[o] = x; A.aP[o + 1] = y; A.aP[o + 2] = z; A.aP[o + 3] = uTime.value
    A.aV[o] = vx; A.aV[o + 1] = vy; A.aV[o + 2] = vz; A.aV[o + 3] = life
    A.aS[o] = s0; A.aS[o + 1] = s1; A.aS[o + 2] = rot; A.aS[o + 3] = rotV
    A.aC[o] = r; A.aC[o + 1] = g; A.aC[o + 2] = b; A.aC[o + 3] = a
    A.aM[o] = cell; A.aM[o + 1] = grav; A.aM[o + 2] = drag; A.aM[o + 3] = stretch
  }
  const ground = (pool, x, z, life, s0, s1, rot, r, g, b, a, cell, ease = 2, y = 0.02) => {
    const o = pool.next(), A = pool.arr
    A.aP[o] = x; A.aP[o + 1] = y; A.aP[o + 2] = z; A.aP[o + 3] = uTime.value
    A.aS[o] = s0; A.aS[o + 1] = s1; A.aS[o + 2] = rot; A.aS[o + 3] = life
    A.aC[o] = r; A.aC[o + 1] = g; A.aC[o + 2] = b; A.aC[o + 3] = a
    A.aM[o] = cell; A.aM[o + 1] = ease
  }
  const seg = (pool, ax, ay, az, bx, by, bz, life, width, r, g, b, extra = 0) => {
    const o = pool.next(), A = pool.arr
    A.aA[o] = ax; A.aA[o + 1] = ay; A.aA[o + 2] = az; A.aA[o + 3] = uTime.value
    A.aB[o] = bx; A.aB[o + 1] = by; A.aB[o + 2] = bz; A.aB[o + 3] = life
    A.aC[o] = r; A.aC[o + 1] = g; A.aC[o + 2] = b; A.aC[o + 3] = width; A.aL[o] = extra
  }

  // ---- 喷火锥 ----
  const FL = 64
  const fg = new THREE.InstancedBufferGeometry()
  {
    const pos = [], uv = [], idx = []; const SEG = 10   // 两片交叉的条带：水平一片 + 竖直一片，沿 -Z 伸出，uv.y = 沿程
    for (let k = 0; k < 2; k++) for (let i = 0; i <= SEG; i++) { const t = i / SEG; for (const s of [-0.5, 0.5]) { pos.push(k ? 0 : s, k ? s * 0.7 : 0, -t); uv.push(s + 0.5, t) } }
    for (let k = 0; k < 2; k++) for (let i = 0; i < SEG; i++) { const b = k * (SEG + 1) * 2 + i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2) }
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); fg.setIndex(idx)
    fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
  }
  const fF = new Float32Array(FL * 4), fG = new Float32Array(FL * 4)
  const aF = new THREE.InstancedBufferAttribute(fF, 4).setUsage(THREE.DynamicDrawUsage), aG = new THREE.InstancedBufferAttribute(fG, 4).setUsage(THREE.DynamicDrawUsage)
  fg.setAttribute('aF', aF); fg.setAttribute('aG', aG); fg.instanceCount = 0
  const flameMat = new THREE.ShaderMaterial({ uniforms: { uTime, uNoise: { value: noise } }, vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, fog: false })
  const flameMesh = new THREE.Mesh(fg, flameMat); flameMesh.frustumCulled = false; flameMesh.renderOrder = 7; group.add(flameMesh)
  const flames = new Map()   // key -> { x, z, dir, len, width, until, seed, y, unit }

  // ---- 动态灯：2 盏爆炸闪光轮用 + 1 盏火焰（点光源每多一盏，所有受光材质的片元都要多算一次）----
  const flashes = [0, 1].map(() => { const l = new THREE.PointLight(0xffa050, 0, 16, 1.6); l.position.set(0, -50, 0); scene.add(l); return { l, t0: -10, peak: 0, dur: 0.2 } })
  let flashI = 0
  const flameLight = new THREE.PointLight(0xff6a1a, 0, 11, 1.7); flameLight.position.set(0, 1.4, 5.4); scene.add(flameLight)

  // ---- 延迟队列（表现延迟）与持续效果 ----
  const pending = []            // { t, fn, a, b, c, d, e }
  const later = (dt, fn, a, b, c, d, e) => { if (dt <= 0) fn(a, b, c, d, e); else if (pending.length < 1500) pending.push({ t: uTime.value + dt, fn, a, b, c, d, e }) }
  const sustained = []          // { t0, t1, tick(now, dt) }
  // ---- 每帧预算（节流）----
  const BUDGET = { tracer: 70, muzzle: 40, death: 36, deathCheap: 60, hit: 14, explosion: 8, stain: 16, spark: 10 }
  const used = { tracer: 0, muzzle: 0, death: 0, deathCheap: 0, hit: 0, explosion: 0, stain: 0, spark: 0 }
  const take = (k) => (used[k] < BUDGET[k] ? (used[k]++, true) : false)
  // ---- 飘字锚点：只给大伤害 / Boss 受击 / 经验，同一位置 0.25 秒内合并 ----
  const floaters = []
  const floater = (kind, x, y, z, value, crit) => {
    for (let i = floaters.length - 1; i >= 0 && i >= floaters.length - 8; i--) { const f = floaters[i]; if (f.kind === kind && uTime.value - f.t < 0.25 && Math.abs(f.x - x) < 1.2 && Math.abs(f.z - z) < 1.2) { f.value += value; f.crit = f.crit || crit; f.n++; return } }
    if (floaters.length > 40) floaters.shift()
    floaters.push({ kind, x, y, z, value, crit: !!crit, t: uTime.value, n: 1 })
  }

  const R = () => rng() - 0.5
  const v3 = new THREE.Vector3()
  const handlers = new Map()
  let shakeOut = 0, flashOut = 0
  const stats = { events: 0, dropped: 0, kills: 0 }

  const fx = {
    uTime, atlas, flameLight, group, stats, floaters, WEAPON_FX, DEATH_DELAY, CELL, BUDGET,
    /** 每帧预算：take('spark') 返回 false 就别放了（高频事件的表现都要过这一关） */
    take,
    /** 注册 / 覆盖某个事件的表现：fx.on('shot', (e, fx) => {...}) */
    on(type, fn) { handlers.set(type, fn); return fx },
    /** 取某个事件当前的表现：想在默认表现外面再包一层时用（powersfx / deviceview） */
    handler(type) { return handlers.get(type) },
    /** 全屏闪白（0..1，renderer 每帧取走并指数衰减） */
    screenFlash(a) { flashOut = Math.max(flashOut, a) },
    later,
    // ------------------------------------------------ 原语
    emitAdd: (...a) => emit(pAdd, ...a), emitAlpha: (...a) => emit(pAlpha, ...a), stain: (...a) => ground(stains, ...a),
    /** 曳光弹：起点 → 终点，speed 米/秒；返回飞行时间 */
    tracer(ax, ay, az, bx, by, bz, speed, len, width, r, g, b) {
      const d = Math.hypot(bx - ax, by - ay, bz - az), dur = Math.max(0.02, d / speed)
      seg(tracers, ax, ay, az, bx, by, bz, dur, width, r, g, b, len)
      return dur
    },
    /** 瞬时光束。jitter > 0 画成抖动的闪电 */
    beam(ax, ay, az, bx, by, bz, life, width, r, g, b, jitter = 0) { seg(beams, ax, ay, az, bx, by, bz, life, width, r, g, b, jitter) },
    muzzle(x, y, z, s, r, g, b, dx = 0, dz = -1) {
      emit(pAdd, x, y, z, dx * 2, 0, dz * 2, 0.06, s, s * 1.6, r, g, b, 0, CELL.FLARE, 0, 0, 0, rng() * 6.28)
      emit(pAdd, x + dx * s * 0.4, y, z + dz * s * 0.4, dx * 6, 0, dz * 6, 0.05, s * 0.8, s * 1.1, r * 0.55, g * 0.55, b * 0.55, 0, CELL.DOT)
    },
    flash(x, y, z, peak, dur = 0.2, color = 0xffa050) { const f = flashes[flashI++ % flashes.length]; f.l.position.set(x, y, z); f.l.color.set(color); f.t0 = uTime.value; f.peak = peak; f.dur = dur },
    ring(x, z, life, s0, s1, r, g, b, soft = 0) { ground(rings, x, z, life, s0, s1, 0, r, g, b, soft, CELL.DOT, 2, 0.05) },
    shake(a) { shakeOut = Math.max(shakeOut, a) },
    /** 屏幕空间冲击波扭曲（后处理里做） */
    shock(x, y, z, strength = 1, radius = 5, dur = 0.45) { if (ctx.post) ctx.post.addShock(x, y, z, strength, radius, dur) },
    /** 一团粒子的简写：n 个，朝四周炸开 */
    burst(x, y, z, n, speed, life, size, r, g, b, o = {}) {
      for (let i = 0; i < n; i++) { const a = rng() * 6.28, sp = speed * (0.4 + rng() * 0.8); emit(o.alpha ? pAlpha : pAdd, x, y, z, Math.cos(a) * sp, (o.up ?? 3) * (0.4 + rng()), Math.sin(a) * sp, life * (0.6 + rng() * 0.6), size, size * (o.grow ?? 0.4), r, g, b, o.a ?? 1, o.cell ?? CELL.DOT, o.grav ?? -12, o.drag ?? 0.6, o.stretch ?? 1.2, rng() * 6.28, R() * (o.spin ?? 0)) }
    },
    // ------------------------------------------------ 组合效果
    /** 小虫死亡：碎块 + 酸液 + 地面污渍 */
    // 死虫的血雾 / 血迹：亮红 (0.22, 0.035, 0.03) → 暗红褐 (0.12, 0.05, 0.03)、不透明度 0.85 → 0.72。
    // Boss 一路踩着成片被打死的护卫走进来，原来的血雾在它脚下叠成一张「肉粉色圆盘」（实测关掉特效层这张盘就没了）
    bugDeath(x, z, s, burn, gore = 0) {
      stats.kills++
      if (!take('death')) { if (take('deathCheap')) emit(pAlpha, x, 0.22 * s, z, R() * 1.5, 1.4 + rng(), R() * 1.5 + 0.6, 0.3, 0.35 * s, 1.0 * s, 0.12, 0.05, 0.03, 0.7, CELL.DIRT_A, -6, 2.5, 0, rng() * 6.28, R() * 8); else stats.dropped++; return }
      emit(pAlpha, x, 0.22 * s, z, R() * 1.5, 1.2 + rng() * 1.2, R() * 1.5 + 0.8, 0.34 + rng() * 0.2, 0.35 * s, 1.15 * s, burn ? 0.05 : 0.12, burn ? 0.03 : 0.05, 0.03, 0.72, rng() < 0.5 ? CELL.DIRT_A : CELL.DIRT_B, -6, 2.5, 0, rng() * 6.28, R() * 8)
      const n = (burn ? 1 : 2) + gore
      for (let i = 0; i < n; i++) {
        const a = rng() * 6.28, sp = 2.2 + rng() * 3.5 + gore
        if (burn) emit(pAdd, x, 0.25, z, Math.cos(a) * sp * 0.5, 2.5 + rng() * 3, Math.sin(a) * sp * 0.5, 0.4 + rng() * 0.3, 0.09, 0.03, 3.2, 1.1, 0.2, 1, CELL.DOT, -9, 0.5, 1.2)
        else emit(pAdd, x, 0.25, z, Math.cos(a) * sp, 2.4 + rng() * 3.2, Math.sin(a) * sp, 0.38 + rng() * 0.3, 0.11, 0.05, 0.5, 0.72, 0.09, 0.6, CELL.DOT, -14, 0.6, 1.0)   // 酸液飞沫：压暗了（成百只同时死的时候，亮黄绿的点会把虫海点成一片荧光）
      }
      if (rng() < 0.55 && take('stain')) {
        const acid = !burn && rng() < 0.4
        if (burn) ground(stains, x + R() * 0.3, z + R() * 0.3, 5 + rng() * 3, 0.35, 0.75 * s + rng() * 0.35, rng() * 6.28, 0.045, 0.024, 0.016, 0.5, rng() < 0.5 ? CELL.SCORCH : CELL.BURST, 6)   // 焦褐，不是纯黑
        else ground(stains, x + R() * 0.3, z + R() * 0.3, 5 + rng() * 4, 0.3, 0.7 * s + rng() * 0.5, rng() * 6.28, acid ? 0.075 : 0.09, acid ? 0.06 : 0.034, acid ? 0.014 : 0.016, acid ? 0.36 : 0.5, rng() < 0.5 ? CELL.DIRT_A : CELL.DIRT_B, 8)   // 暗红褐的血迹 / 橄榄褐的酸液，半透明（原来近乎纯黑 0.75，像一个个黑洞）
      }
    },
    /** 子弹命中没打死的虫：火星 + 酸雾 */
    hitSpark(x, y, z, big) {
      if (!take('hit')) return
      for (let i = 0; i < (big ? 3 : 2); i++) { const a = rng() * 6.28, sp = 3 + rng() * 5; emit(pAdd, x, y, z, Math.cos(a) * sp, 1 + rng() * 4, Math.sin(a) * sp + 2.5, 0.22 + rng() * 0.2, 0.1, 0.03, 3.0, 1.9, 0.5, 1, CELL.DOT, -12, 0.5, 1.4) }
      emit(pAdd, x, y, z, 0, 0.5, 1, 0.12, 0.25, 0.8, 1.6, 1.0, 0.25, 0, CELL.BURST, 0, 0, 0, rng() * 6.28)
      if (big && rng() < 0.5) emit(pAlpha, x, y, z, R() * 1.5, 1 + rng(), 1 + rng() * 2, 0.4, 0.3, 1.0, 0.2, 0.26, 0.03, 0.6, CELL.SMOKE_A, -2, 2, 0, rng() * 6.28, R() * 3)
    },
    /** 爆炸。s = 尺寸系数（1 ≈ 自行炮）；tint: 'fire' | 'acid' | 'void' | 'cryo' */
    explosion(x, z, s = 1, tint = 'fire') {
      if (!take('explosion')) { ground(rings, x, z, 0.35, 0.9 * s, 7 * s, 0, 2.0, 0.9, 0.3, 0, CELL.DOT, 2.4, 0.05); return }
      const T = tint === 'acid' ? [0.5, 1.6, 0.2] : tint === 'void' ? [1.1, 0.4, 2.2] : tint === 'cryo' ? [0.5, 1.4, 2.4] : [1.55, 0.6, 0.1]
      const hot = tint === 'fire'
      shakeOut = Math.max(shakeOut, Math.min(0.34, 0.12 * s)); flashOut = Math.max(flashOut, 0.03 * s)
      // 测试「火焰爆炸常过曝成一团白黄光」：闪光核心 / 星芒 / 火团的亮度和尺寸都压了一截（尺寸约 ×0.75、亮度约 ×0.65），点光源 80 → 45
      fx.flash(x, 1.6, z, 45 * s, 0.24, hot ? 0xffa050 : tint === 'acid' ? 0x90ff50 : tint === 'void' ? 0xb060ff : 0x70c0ff)
      fx.shock(x, 0.6, z, 0.55 * Math.min(1.6, s), 5.0 * s, 0.4)
      // 闪光核心（极短）+ 星芒 + 尖刺爆裂
      emit(pAdd, x, 0.7, z, 0, 0, 0, 0.08, 1.0 * s, 2.4 * s, 2.2, 1.8, 1.3, 0, CELL.DOT)
      emit(pAdd, x, 0.7, z, 0, 0, 0, 0.15, 1.3 * s, 3.6 * s, T[0] * 0.85, T[1] * 1.05, T[2] * 1.8, 0, CELL.FLARE, 0, 0, 0, rng() * 6.28)
      emit(pAdd, x, 0.5, z, 0, 0, 0, 0.18, 1.1 * s, 3.3 * s, T[0] * 0.75, T[1] * 0.8, T[2] * 1.2, 0, CELL.SCORCH, 0, 0, 0, rng() * 6.28)
      for (let i = 0; i < 12; i++) {   // 翻滚的火团：内圈亮、外圈暗，先快后慢地鼓出来
        const a = rng() * 6.28, r = rng() * 0.75 * s, up = 1.4 + rng() * 3.2
        emit(pAdd, x + Math.cos(a) * r, 0.45 + rng() * 0.5, z + Math.sin(a) * r, Math.cos(a) * (1.2 + rng() * 2.6) * s, up, Math.sin(a) * (1.2 + rng() * 2.6) * s, 0.4 + rng() * 0.32, 0.55 * s, (1.1 + rng() * 0.8) * s, T[0] * 0.62, T[1] * (0.5 + rng() * 0.3), T[2] * 0.45, 1.8, i % 2 ? CELL.FIRE : CELL.BURST, 0, 2.4, 0, rng() * 6.28, R() * 3)
      }
      for (let i = 0; i < 22; i++) {   // 火花
        const a = rng() * 6.28, sp = (5 + rng() * 12) * s
        emit(pAdd, x, 0.4, z, Math.cos(a) * sp, 3 + rng() * 9, Math.sin(a) * sp, 0.45 + rng() * 0.6, 0.11, 0.035, T[0] * 1.6, T[1] * 1.9 + rng() * 0.6, T[2] * 2.4, 1, CELL.DOT, -17, 0.8, 1.7)
      }
      for (let i = 0; i < 10; i++) {   // 酸液飞溅 + 碎甲
        const a = rng() * 6.28, sp = (3 + rng() * 7) * s
        emit(pAdd, x, 0.4, z, Math.cos(a) * sp, 3 + rng() * 6, Math.sin(a) * sp, 0.6 + rng() * 0.4, 0.15, 0.05, 0.7, 1.3, 0.08, 0.5, CELL.DOT, -15, 0.5, 1.0)
        emit(pAlpha, x, 0.5, z, Math.cos(a + 1) * sp, 3 + rng() * 6, Math.sin(a + 1) * sp, 0.7 + rng() * 0.4, 0.3, 0.5, 0.10, 0.022, 0.025, 0.95, CELL.DIRT_A, -15, 0.4, 0, rng() * 6.28, R() * 14)
      }
      for (let i = 0; i < 9; i++) {    // 黑烟柱：中心的往上走得更高
        const a = rng() * 6.28, r = rng() * 1.0 * s, c = i < 3 ? 1 : 0
        emit(pAlpha, x + Math.cos(a) * r * (1 - c * 0.7), 0.7 + rng() * 0.7, z + Math.sin(a) * r * (1 - c * 0.7), Math.cos(a) * 0.9, 1.2 + rng() * 1.4 + c * 2.2, Math.sin(a) * 0.9 + 0.5, 1.5 + rng() * 1.1 + c * 0.6, 1.1 * s, (2.8 + rng()) * s, 0.03, 0.028, 0.03, 0.6, [CELL.SMOKE_A, CELL.SMOKE_B, CELL.SMOKE_C][i % 3], 0, 0.9, 0, rng() * 6.28, R() * 1.2)
      }
      ground(rings, x, z, 0.4, 0.9 * s, Math.min(7, 6.4 * s), 0, T[0] * 1.2, T[1] * 1.25, T[2] * 2.2, 0, CELL.DOT, 2.4, 0.05)   // 冲击环（封顶 7 米）
      ground(rings, x, z, 0.8, 2.0 * s, 3.4 * s, rng() * 6.28, T[0] * 0.3, T[1] * 0.2, T[2] * 0.22, 1, CELL.DOT, 1, 0.045)     // 余烬辉光
      ground(stains, x, z, 10, 1.8 * s, 3.4 * s, rng() * 6.28, 0.05, 0.028, 0.018, 0.55, CELL.SCORCH, 10, 0.024)   // 焦痕：暗褐、半透明、小一圈
      if (!hot) ground(stains, x, z, 12, 1.6 * s, 3.3 * s, rng() * 6.28, T[0] * 0.08, T[1] * 0.08, T[2] * 0.08, 0.45, CELL.DIRT_B, 10, 0.026)
    },
    bigDeath(x, z, s) {
      fx.explosion(x, z, s * 0.8, 'acid')
      for (let i = 0; i < 22; i++) { const a = rng() * 6.28, sp = 2 + rng() * 7; emit(pAlpha, x, 0.6 * s, z, Math.cos(a) * sp, 3 + rng() * 7, Math.sin(a) * sp, 0.8 + rng() * 0.5, 0.35 * s, 0.7 * s, 0.2, 0.03, 0.04, 0.95, i % 2 ? CELL.DIRT_A : CELL.DIRT_B, -14, 0.4, 0, rng() * 6.28, R() * 12) }
      ground(stains, x, z, 12, 1.4 * s, 2.8 * s, rng() * 6.28, 0.13, 0.024, 0.014, 0.55, CELL.DIRT_B, 8, 0.028)
    },
    flamePuff(x, y, z, vx, vz) {
      emit(pAdd, x, y, z, vx, 0.9 + rng() * 1.3, vz, 0.3 + rng() * 0.22, 0.35, 1.05, 1.0, 0.34, 0.05, 1.5, rng() < 0.5 ? CELL.FIRE : CELL.WISP, 0, 1.6, 0, rng() * 6.28, R() * 4)
      if (rng() < 0.22) emit(pAlpha, x + vx * 0.25, y + 0.5, z + vz * 0.25, vx * 0.25, 1.4 + rng(), vz * 0.25, 1.0 + rng() * 0.7, 0.7, 2.1, 0.04, 0.036, 0.034, 0.34, CELL.SMOKE_B, 0, 0.6, 0, rng() * 6.28, R())
    },
    /** 点亮 / 续上一道喷火锥。key 相同的会合并（同一个喷火兵连续的 flame 事件） */
    flameCone(key, x, z, dir, len, width, hold = 0.45, y = 0.62, unit = null) {
      let f = flames.get(key)
      if (!f) { if (flames.size >= FL) return; f = { seed: rng(), int: 0 }; flames.set(key, f) }
      f.x = x; f.z = z; f.dir = dir; f.len = len; f.width = width; f.until = uTime.value + hold; f.y = y; f.unit = unit
    },
    /** 从地面冒出的土石（掘地虫 / 蠕虫破土） */
    dirtBurst(x, z, r) {
      for (let i = 0; i < 14; i++) { const a = rng() * 6.28, sp = (2 + rng() * 4) * r * 0.5; emit(pAlpha, x + Math.cos(a) * r * 0.4, 0.2, z + Math.sin(a) * r * 0.4, Math.cos(a) * sp, 3 + rng() * 5, Math.sin(a) * sp, 0.7 + rng() * 0.4, 0.3, 0.7, 0.10, 0.08, 0.07, 0.95, i % 2 ? CELL.DIRT_A : CELL.DIRT_B, -14, 0.4, 0, rng() * 6.28, R() * 10) }
      for (let i = 0; i < 5; i++) emit(pAlpha, x + R() * r, 0.4, z + R() * r, R() * 2, 1.5 + rng() * 2, R() * 2, 1.2 + rng() * 0.6, 1.0 * r * 0.5, 2.4 * r * 0.5, 0.09, 0.08, 0.075, 0.5, CELL.SMOKE_A + (i % 3), 0, 1.2, 0, rng() * 6.28, R())
      ground(rings, x, z, 0.5, r * 0.6, r * 2.6, 0, 0.9, 0.55, 0.3, 0, CELL.DOT, 2, 0.05)
      ground(stains, x, z, 10, r * 1.1, r * 1.8, rng() * 6.28, 0.06, 0.04, 0.026, 0.6, CELL.SCORCH, 8, 0.024)
    },
    /** 治疗 / 增援的上升光点 */
    sparkleUp(x, z, n, r, g, b, spread = 0.5) { for (let i = 0; i < n; i++) emit(pAdd, x + R() * spread * 2, 0.2 + rng() * 0.6, z + R() * spread * 2, 0, 1.4 + rng() * 1.6, 0, 0.6 + rng() * 0.4, 0.16, 0.04, r, g, b, 0, CELL.STAR, 0, 0.5, 0, rng() * 6.28, R() * 4) },

    // ------------------------------------------------ 每帧
    /** now = 特效时钟（跟着模拟时间走，暂停 / 子弹时间自然生效）；dt = 这一帧特效时钟前进了多少 */
    update(now, dt, world, dtReal = 0) {
      uTime.value = now
      for (const k in used) used[k] = 0
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].t <= now) { const p = pending[i]; pending[i] = pending[pending.length - 1]; pending.pop(); p.fn(p.a, p.b, p.c, p.d, p.e) }
      for (let i = sustained.length - 1; i >= 0; i--) { const s = sustained[i]; if (now >= s.t1) { sustained[i] = sustained[sustained.length - 1]; sustained.pop(); continue } if (dt > 0) s.tick(now, dt, (now - s.t0) / (s.t1 - s.t0)) }   // 暂停时不 tick：否则每帧往池里叠一道不会过期的光束
      // 喷火锥
      let n = 0, fx0 = 0, fz0 = 0, fint = 0
      // 喷火锥是加法混合：十几个喷火兵对着同一个目标喷，亮度线性叠上去就是一片纯白。同时点着的越多，单个越暗（总亮度按 n^0.35 涨）
      // Boss 战期间所有火舌再压到 55%：测试「方阵和 Boss 之间是一整扇金橙色的火焰」—— 一排焚化兵对着护卫虫喷，火舌连成一片挡在 Boss 前面
      const flameGain = (flames.size > 2 ? Math.pow(2 / flames.size, 0.6) : 1) * (world && world.boss && world.boss.state !== 'burrowed' ? 0.55 : 1)
      // 火舌喷到 Boss 身上的那几道再压一半：一排喷火兵对着 Boss 喷，火舌叠在它身上把整只埋掉（测试 rv-22 / rv-17b）
      const bs = world && world.boss && world.boss.state !== 'burrowed' ? world.boss : null
      for (const [key, f] of flames) {
        const on = now < f.until
        f.int += ((on ? 1 : 0) - f.int) * Math.min(1, dt * (on ? 16 : 9))
        if (!on && f.int < 0.03) { flames.delete(key); continue }
        if (f.unit != null && ctx.squad && ctx.squad.muzzle(f.unit, v3)) { f.x = v3.x; f.z = v3.z; f.y = v3.y }
        let pulse = (0.85 + 0.15 * Math.sin(now * 11 + f.seed * 30)) * f.int * flameGain
        if (bs) { const ex = f.x + Math.sin(f.dir) * f.len * 0.7, ez = f.z + Math.cos(f.dir) * f.len * 0.7; if (Math.hypot(ex - bs.x, ez - bs.z) < 5.2) pulse *= 0.2 }   // 0.45 → 0.2、范围 4.2 → 5.2：Boss 附近的火舌只剩一层暗红的热气
        const o = n * 4
        fF[o] = f.x; fF[o + 1] = f.z; fF[o + 2] = f.dir + Math.PI + Math.sin(now * 1.3 + f.seed * 6.28) * 0.12; fF[o + 3] = f.seed
        fG[o] = f.len * (0.92 + 0.08 * Math.sin(now * 2.1 + f.seed * 9)); fG[o + 1] = f.width; fG[o + 2] = pulse; fG[o + 3] = f.y
        fx0 += f.x * pulse; fz0 += (f.z + Math.cos(f.dir) * f.len * 0.5) * pulse; fint += pulse
        if (on && dt > 0 && rng() < dt * 16 * flameGain * (pulse < 0.25 * f.int * flameGain ? 0.25 : 1) && take('spark')) { const d = (0.25 + rng() * 0.6) * f.len, a = f.dir + R() * 0.4; fx.flamePuff(f.x + Math.sin(a) * d, 0.35 + rng() * 0.3, f.z + Math.cos(a) * d, Math.sin(a) * 3.5, Math.cos(a) * 3.5) }
        if (++n >= FL) break
      }
      fg.instanceCount = n; if (n) { aF.needsUpdate = aG.needsUpdate = true }
      if (fint > 0.01) { flameLight.position.set(fx0 / fint, 1.4, fz0 / fint); flameLight.intensity = Math.min(8, 3 + 1.2 * fint)   /* 封顶 14 → 8：喷火兵就站在方阵里，这盏灯把一整片兵照成白灰 */ * (0.9 + 0.1 * Math.sin(now * 23)) } else flameLight.intensity = 0
      for (const p of pools) p.flush()
      // 闪光点光源按特效时钟衰减 —— 升级 / 门卡 / 暂停的时候特效时钟停住，刚放出来的闪光就以峰值亮度定格在画面上
      // 。时钟停着的时候改按真实时间淡掉
      if (dt <= 0 && dtReal > 0) { const k = Math.exp(-dtReal * 9); for (const f of flashes) f.peak *= k }
      for (const f of flashes) { const u = (now - f.t0) / f.dur; f.l.intensity = u >= 0 && u < 1 ? f.peak * (1 - u) * (1 - u) : 0 }
    },
    /** 取走这一帧累计的震屏 / 闪白（renderer 每帧调用） */
    drain() { const s = shakeOut, f = flashOut; shakeOut = 0; flashOut = 0; return { shake: s, flash: f } },
    get flameHaze() { return fg.instanceCount > 0 ? flameLight.position : null },
    setAmbient(r, g, b) { uAmbient.value.setRGB(r, g, b) },
    /** 新开一局：清掉所有残留 */
    reset() { pending.length = 0; sustained.length = 0; flames.clear(); floaters.length = 0; for (const p of pools) p.clear(); for (const f of flashes) f.t0 = -10 },
    counts() { return { pending: pending.length, sustained: sustained.length, flames: flames.size, dropped: stats.dropped } },

    // ------------------------------------------------ 事件分发
    consume(events, world) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i], h = handlers.get(e.type)
        stats.events++
        if (h) h(e, fx, world)
      }
    },
    sustain(dur, tick) { if (sustained.length < 64) sustained.push({ t0: uTime.value, t1: uTime.value + dur, tick }) },
    floater,
  }

  // ================================================== 默认的事件表现
  const tintOf = (kind) => (/acid|spit|burst/.test(kind) ? 'acid' : /void|lancer/.test(kind) ? 'void' : /cryo|frost/.test(kind) ? 'cryo' : 'fire')
  const deathFx = (x, z, s, burn, gore, big) => { if (big) fx.bigDeath(x, z, s); else fx.bugDeath(x, z, s, burn, gore) }
  let bossSide = 1   // Boss 伤害数字左右轮流飘
  let bossLineT = -1  // 打 Boss 的弹道：上一条画出来的时刻（特效时钟）
  // 集火合并：十几个兵同时打同一只（翼螫 / 巨畸体）时，几十条曳光汇到一点成一把金色扇子。
  // 按落点 1 米一格限流：同一格每 50 毫秒（特效时钟）只画一条，其余只留枪口火光 —— 一个目标身上同时只有四五条干净的弹线
  const aimT = new Map()
  const aimOk = (x, z) => { const k = (Math.round(x) + 64) * 256 + (Math.round(z) + 64), t = uTime.value, p = aimT.get(k); if (p !== undefined && t >= p && t - p < 0.05) return false; aimT.set(k, t); if (aimT.size > 512) aimT.clear(); return true }
  const bossLineOk = (gap) => { const t = uTime.value; if (t < bossLineT) bossLineT = -1; if (t - bossLineT < gap) return false; bossLineT = t; return true }
  const BIG = { crusher: 1.0, hulk: 1.7, warden: 1.0, digger: 0.9, spitter: 0.7, shieldbug: 0.8 }
  let orbitN = 0   // 「天钩」这类子机开火：轮流从每架子机出

  fx.on('shot', (e, _, world) => {
    const W = WEAPON_FX[e.kind] || WEAPON_FX.default
    const n = W.dual ? 2 : 1
    // 打 Boss 的子弹：模拟给的落点都是 Boss 的中心那一个点，几十条曳光汇到一起就是一团白光把 Boss 盖住。
    // 表现上把落点摊到它身上各处（左右 ±1.3 米、高 0.4~2.4 米），读作「弹雨打在一头巨兽身上」
    const bs = world && world.boss, onBoss = !!bs && Math.abs(e.tx - bs.x) < 0.6 && Math.abs(e.tz - bs.z) < 0.6
    // Boss 周围 8 米内（护卫 / Boss 本体）的弹道共用一个限流阀：Boss 战的焦点区域同时只有四五条弹线
    const nearBoss = !!bs && bs.state !== 'burrowed' && Math.abs(e.tx - bs.x) < 8 && Math.abs(e.tz - bs.z) < 8
    for (let k = 0; k < n; k++) {
      let mx = e.x, my = W.y ?? 0.8, mz = e.z
      if (ctx.squad && ctx.squad.muzzle(e.unit, v3, W.orbit ? orbitN++ : k)) { mx = v3.x; my = v3.y; mz = v3.z }
      const tx = e.tx + (n > 1 ? (k - 0.5) * 1.2 : 0) + (onBoss ? R() * 2.6 : 0), tz = e.tz + (onBoss ? 0.6 + R() * 1.2 : 0), ty = onBoss ? 0.4 + rng() * 2.0 : 0.3
      const dx = tx - mx, dz = tz - mz, d = Math.hypot(dx, dz) || 1
      // 打 Boss 的弹道合并限流：参考 053 是暗底上几道干净的亮线。原来每发都画（同屏几十条汇成一扇金橙色），
      // 现在 Boss 身上同一时刻只留 4~6 条：按特效时钟每 ~45 毫秒放一条（光束类 90 毫秒），其余的子弹照样算伤害、只是不画弹道；
      // 放出来的那条是一根细而完整的弹线（长度不减半、亮度 0.55），读作「一道光束」而不是一团火星
      if ((nearBoss && !bossLineOk(W.beam ? 0.09 : 0.035)) || (!nearBoss && !W.beam && W.speed && !aimOk(e.tx, e.tz))) { if (take('muzzle')) fx.muzzle(mx, my, mz, W.muzzle * 0.8, W.mcol[0], W.mcol[1], W.mcol[2], dx / d, dz / d); continue }
      if (W.beam) { fx.beam(mx, my, mz, tx, ty + 0.3, tz, W.life, W.width * (onBoss ? 0.6 : 1), W.col[0] * (onBoss ? 0.6 : 1), W.col[1] * (onBoss ? 0.6 : 1), W.col[2] * (onBoss ? 0.6 : 1)); if (!onBoss) later(0.02, (a, b) => { fx.hitSpark(a, 0.6, b, true) }, tx, tz) }
      // 打 Boss 的曳光暗一半、细两成：几十条汇到 Boss 身上的时候叠成一团白光，把 Boss 盖住（测试 rv-22）
      // 再压：测试 里 Boss 身上仍是一朵几十条曳光汇成的白黄星芒、盖住轮廓。打 Boss 的曳光亮度 0.5 → 0.3、长度减半、
      // 而且落点停在它朝我方的那一面（z + 半径），不再扎进身体中间叠成一团
      else if (take('tracer')) { const bk = onBoss ? 0.55 : 1; fx.tracer(mx, my, mz, tx, ty, onBoss ? tz + 1.2 : tz, W.speed || (e.delay > 0 ? d / e.delay : 90), W.len * (0.8 + rng() * 0.5) * (onBoss ? 1.1 : 1), W.width * (onBoss ? 0.6 : 1), W.col[0] * bk, W.col[1] * bk * 1.05, W.col[2] * bk * 1.3) }
      if (take('muzzle')) fx.muzzle(mx, my, mz, W.muzzle, W.mcol[0], W.mcol[1], W.mcol[2], dx / d, dz / d)
      if (W.smoke) emit(pAlpha, mx, my, mz, dx / d * 2.5, 0.6, dz / d * 2.5, 0.9, 0.6, 2.0, 0.09, 0.085, 0.08, 0.4, CELL.SMOKE_B, 0, 1.5, 0, rng() * 6, 1)
      if (W.flash && k === 0) fx.flash(mx, my + 0.6, mz, W.flash, 0.12, W.flashCol || 0xffa050)
    }
    if (W.shake) fx.shake(W.shake)
  })
  fx.on('deviceFire', (e) => { if (e.tx != null) handlers.get('shot')({ ...e, unit: null, kind: e.kind || 'sentry', delay: e.delay ?? 0.05 }) })   // 喷火陷阱的 deviceFire 没有落点
  fx.on('explosion', (e, _, world) => {
    let s = (EXPLOSION_SIZE[e.size] || 1) * (e.r ? Math.max(0.6, Math.min(1.6, e.r / 3.2)) : 1)
    // 炮弹落在 Boss 身上：爆团缩到六成（火团 / 点光 / 冲击环都按 s 走），别在它背上开一朵朵火球
    const bs = world && world.boss && world.boss.state !== 'burrowed' ? world.boss : null
    if (bs && Math.hypot(e.x - bs.x, e.z - bs.z) < 4) s *= 0.6
    later(/mortar|titan/.test(e.kind) ? 0.13 : 0, (x, z, sc, tint) => fx.explosion(x, z, sc, tint), e.x, e.z, s, tintOf(e.kind || ''))
  })
  fx.on('flame', (e) => {
    const len = e.range * 0.72, width = Math.min(3.2, len * Math.tan((e.arc || 0.9) / 2) * 1.35)
    let x = e.x + Math.sin(e.dir) * 0.6, z = e.z + Math.cos(e.dir) * 0.6
    fx.flameCone('u' + e.unit, x, z, e.dir, len, width, 0.45, 0.62, e.unit)
  })
  // beam：同一个事件名下有几种画法，按 kind 分
  //   横扫（reaper* / joe_ray 之外的默认）：落点从 (x0,z0) 扫到 (x1,z1)，光束从对应兵种的炮口出来
  //   hawk_flagship / hawk_flagship_gun：从旗舰（x0,z0 上空）打到落点   ysera_lance：贴地的一条线   hero_joe：钻机，从单位到目标
  //   joe_ray：整趟横扫由 world.summons 里的 ray 实时驱动（renderer 每帧画），这里只给个起手闪光
  const src = new THREE.Vector3()
  fx.on('beam', (e) => {
    const k = e.kind || ''
    if (k === 'joe_ray') { fx.flash(e.x0, 2, (e.z0 + e.z1) / 2, 40, 0.4, 0xff7030); fx.shake(0.1); return }
    if (k === 'hawk_flagship') { if (take('tracer')) { fx.beam(e.x0, 9.5, e.z0 + 1.5, e.x1, 0.2, e.z1, 0.1, 0.22, 0.5, 1.6, 3.2); if (take('spark')) fx.hitSpark(e.x1, 0.4, e.z1, false) } return }
    if (k === 'hawk_flagship_gun') { fx.beam(e.x0, 9.5, e.z0 + 1.5, e.x1, 0.2, e.z1, e.dur || 0.35, 1.3, 0.7, 1.8, 3.2); fx.flash(e.x1, 2, e.z1, 60, 0.3, 0x80c0ff); return }
    if (k === 'ysera_lance' || k === 'power_lance') {
      const n = 3; for (let i = 0; i < n; i++) fx.beam(e.x0, 0.35 + i * 0.25, e.z0, e.x1, 0.35 + i * 0.25, e.z1, (e.dur || 0.5) * (1 - i * 0.2), (e.w || 1) * 0.5, 3.2, 2.2, 0.8)
      const dx = e.x1 - e.x0, dz = e.z1 - e.z0, len = Math.hypot(dx, dz) || 1
      for (let d = 0; d < len; d += 1.2) { const x = e.x0 + dx / len * d, z = e.z0 + dz / len * d; emit(pAdd, x, 0.3, z, R() * 2, 2 + rng() * 3, R() * 2, 0.5, 0.5, 1.4, 2.4, 1.3, 0.3, 1.5, CELL.FIRE, 0, 1.5, 0, rng() * 6.28, R() * 3); if (take('stain')) ground(stains, x, z, 6, 0.6, 1.5, rng() * 6.28, 0.05, 0.028, 0.018, 0.5, CELL.SCORCH, 6) }
      fx.flash((e.x0 + e.x1) / 2, 1.5, (e.z0 + e.z1) / 2, 40, 0.4, 0xffc060); fx.shake(0.1)
      return
    }
    if (e.unit != null && ctx.squad && ctx.squad.muzzle(e.unit, src)) {   // 带 unit 的持续光束（钻机）
      const id = e.unit
      fx.sustain(e.dur || 0.3, () => { if (ctx.squad.muzzle(id, src)) fx.beam(src.x, src.y, src.z, e.x1, 0.5, e.z1, 0.05, 0.3, 3.2, 1.6, 0.4); if (rng() < 0.4 && take('spark')) fx.hitSpark(e.x1 + R() * 0.4, 0.5, e.z1 + R() * 0.4, true) })
      return
    }
    const from = new THREE.Vector3()
    const has = ctx.squad && ctx.squad.find(k.split('_')[0], (e.x0 + e.x1) / 2, from)
    if (!has) from.set((e.x0 + e.x1) / 2, 9, (e.z0 + e.z1) / 2 + 14)
    let acc = 0
    fx.sustain(e.dur || 0.6, (now, dt, u) => {
      const x = e.x0 + (e.x1 - e.x0) * u, z = e.z0 + (e.z1 - e.z0) * u
      fx.beam(from.x, from.y, from.z, x, 0.15, z, 0.05, 0.2, 0.12, 0.45, 0.9)
      acc += dt
      if (acc > 0.03) {
        acc = 0
        emit(pAdd, x + R() * 0.4, 0.2, z + R() * (e.w || 1) * 0.5, R() * 3, 2 + rng() * 3, R() * 3, 0.3, 0.12, 0.04, 0.6, 2.2, 3.0, 0.5, CELL.DOT, -6, 1, 1.2)
        emit(pAdd, x, 0.25, z, 0, 0, 0, 0.1, 1.0, 1.6, 0.25, 0.8, 1.5, 0, CELL.FLARE, 0, 0, 0, rng() * 6.28)
        if (take('stain')) ground(stains, x, z + R() * (e.w || 1) * 0.4, 5, 0.5, 1.2, rng() * 6.28, 0.05, 0.03, 0.022, 0.5, CELL.SCORCH, 6)
      }
    })
    fx.flash((e.x0 + e.x1) / 2, 1.5, (e.z0 + e.z1) / 2, 18, e.dur || 0.6, 0x60b0ff)
  })
  /** 汇聚射线（world.summons 里 kind === 'ray'）：renderer 每帧调一次 */
  fx.ray = (x, z0, z1) => {
    fx.beam(x, 0.4, z0, x, 0.4, z1, 0.06, 1.5, 3.2, 1.2, 0.3)
    fx.beam(x, 16, (z0 + z1) / 2 + 10, x, 0.3, (z0 + z1) / 2, 0.06, 0.9, 3.0, 1.4, 0.5)
    if (take('spark')) { const z = z0 + rng() * (z1 - z0); emit(pAdd, x, 0.3, z, R() * 4, 3 + rng() * 4, R() * 2, 0.5, 0.5, 1.5, 2.6, 1.2, 0.2, 1.5, CELL.FIRE, 0, 1.5, 0, rng() * 6.28, R() * 3); if (take('stain')) ground(stains, x, z, 6, 0.6, 1.6, rng() * 6.28, 0.05, 0.028, 0.018, 0.5, CELL.SCORCH, 6) }
    flameLight.position.set(x, 1.5, (z0 + z1) / 2); flameLight.intensity = Math.max(flameLight.intensity, 10)
  }
  fx.on('chain', (e) => {
    const p = e.points; if (!p || p.length < 2) return
    const c = /psion/.test(e.kind) ? [1.4, 0.9, 3.2] : [0.6, 1.6, 3.2]
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1]
      const ax = a.x ?? a[0], az = a.z ?? a[1], bx = b.x ?? b[0], bz = b.z ?? b[1]
      fx.beam(ax, 0.6, az, bx, 0.6, bz, 0.18, 0.3, c[0], c[1], c[2], 1)
      if (take('spark')) emit(pAdd, bx, 0.6, bz, 0, 0, 0, 0.14, 0.5, 1.4, c[0], c[1], c[2], 0, CELL.STAR, 0, 0, 0, rng() * 6.28)
    }
  })
  fx.on('storm', (e) => {
    fx.ring(e.x, e.z, 0.5, e.r * 0.4, e.r * 2.2, 1.2, 0.8, 3.0)
    let acc = 0
    fx.sustain(e.dur || 2.8, (now, dt) => {
      acc += dt
      if (acc > 0.11) {
        acc = 0
        const a = rng() * 6.28, r = Math.sqrt(rng()) * e.r, x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r
        fx.beam(x + R() * 1.5, 7 + rng() * 2, z + R() * 1.5 - 1, x, 0.1, z, 0.12, 0.26, 1.3, 0.9, 3.2, 1)
        emit(pAdd, x, 0.3, z, 0, 0, 0, 0.14, 0.8, 2.2, 1.4, 1.0, 3.2, 0, CELL.STAR, 0, 0, 0, rng() * 6.28)
        fx.burst(x, 0.3, z, 3, 5, 0.3, 0.1, 1.4, 1.1, 3.2, { up: 3 })
      }
    })
    fx.flash(e.x, 2.5, e.z, 26, 0.3, 0x9070ff)
  })
  let bossIntroT = -99             // Boss 出场时刻（特效时钟）
  fx.on('enemyHit', (e, _, world) => {
    // 举盾虫正面挨直射只吃一成（dmg 很小的那种）：子弹在盾上弹开 —— 盾面（身前）溅一蓬往回飞的亮火星，不出酸雾
    if (e.dmg < 2 && world && world.swarm && e.i != null && (world.swarm.kindNames || ENEMY_KINDS)[world.swarm.kind[e.i]] === 'shieldbug') {
      if (take('hit')) { const x = e.x + R() * 0.5, z = e.z + 0.55; for (let i = 0; i < 3; i++) emit(pAdd, x, 0.5 + rng() * 0.5, z, R() * 6, 1.5 + rng() * 3, 3 + rng() * 6, 0.2 + rng() * 0.15, 0.09, 0.03, 3.2, 2.6, 1.6, 0.6, CELL.DOT, -10, 0.5, 1.8); emit(pAdd, x, 0.75, z, 0, 0, 0.5, 0.09, 0.3, 0.7, 2.4, 2.0, 1.3, 0, CELL.STAR, 0, 0, 0, rng() * 6.28) }
      return
    }
    // Boss 身边 7 米内的护卫挨打：出场头 3.5 秒只出一成火星（测试「出场时成片火花」），之后也只出三成——Boss 的剪影比火星要紧
    const bs = world && world.boss
    let pk = 0.5
    if (bs && bs.state !== 'burrowed' && Math.abs(e.x - bs.x) < 7 && Math.abs(e.z - bs.z) < 7) pk = uTime.value - bossIntroT < 3.5 && uTime.value >= bossIntroT ? 0.05 : 0.3
    if (rng() < pk) later(0.06, (x, z, big) => fx.hitSpark(x, 0.35 + rng() * 0.3, z, big), e.x + R() * 0.3, e.z + R() * 0.3, e.dmg >= 8 || e.crit)
  })
  fx.on('enemyDie', (e) => {
    const big = BIG[e.kind], burn = /flamer|fire|scorch|storm|reaper|mine|nova|fence/.test(e.by || '')   // 烧死 / 炸死 / 电死的：焦黑，不溅酸液
    if (e.kind === 'burster' || e.kind === 'egg') { if (e.kind === 'egg') later(DEATH_DELAY[e.by] || 0, (x, z) => { fx.burst(x, 0.4, z, 8, 4, 0.5, 0.14, 0.7, 1.4, 0.2, { up: 4 }); fx.stain(x, z, 8, 0.5, 1.4, rng() * 6.28, 0.08, 0.07, 0.014, 0.4, CELL.DIRT_B, 8) }, e.x, e.z); return }
    later(DEATH_DELAY[e.by] || (burn ? 0 : 0.04), deathFx, e.x, e.z, big ? big : 1.3, burn, e.gore | 0, !!big)
  })
  fx.on('burst', (e) => { fx.explosion(e.x, e.z, Math.max(0.5, (e.r || 1.65) / 2.6), 'acid') })
  fx.on('enemyAttack', (e) => {
    if (e.kind === 'crusher' || e.kind === 'spitter') { const dur = fx.tracer(e.x, 0.8, e.z, e.tx, 0.8, e.tz, 26, 1.0, 0.16, 0.5, 2.2, 0.25); later(dur, (x, z) => fx.burst(x, 0.7, z, 4, 3, 0.3, 0.12, 0.5, 1.6, 0.2, { up: 2 }), e.tx, e.tz) }
    else if (e.kind === 'hulk') { later(0.3, (x, z) => { fx.ring(x, z, 0.35, 0.6, 3.4, 1.4, 0.8, 0.3); fx.dirtBurst(x, z, 1.0); fx.shake(0.06) }, e.tx, e.tz) }
    else if (take('spark')) fx.burst(e.tx ?? e.x, 0.6, e.tz ?? e.z, 3, 3, 0.25, 0.1, 2.2, 0.5, 0.2, { up: 2 })
  })
  fx.on('spit', (e) => {   // 酸液弹：抛物线飞过去，t 秒后落地
    const t = Math.max(0.15, e.t || 0.45), n = 5
    for (let i = 0; i < n; i++) { const k = i * 0.025; emit(pAdd, e.x, 1.0, e.z, (e.tx - e.x) / t, 0.5 * 16 * t - 1.0 / t, (e.tz - e.z) / t, t + k, 0.5 - i * 0.07, 0.3, 0.55, 1.8, 0.2, 0, i ? CELL.DOT : CELL.FLARE, -16, 0, i ? 1.5 : 0, rng() * 6.28) }
    later(t, (x, z) => { fx.burst(x, 0.3, z, 6, 4, 0.4, 0.14, 0.6, 1.6, 0.2, { up: 3 }); if (take('stain')) fx.stain(x, z, 6, 0.5, 1.6, rng() * 6.28, 0.08, 0.07, 0.014, 0.4, CELL.DIRT_B, 8) }, e.tx, e.tz)
  })
  fx.on('emerge', (e) => { fx.dirtBurst(e.x, e.z, e.r || 1.8); fx.shake(0.08); fx.shock(e.x, 0.3, e.z, 0.6, (e.r || 1.8) * 2.2, 0.4) })
  fx.on('hatch', (e) => { fx.burst(e.x, 0.4, e.z, 10, 5, 0.5, 0.16, 0.7, 1.5, 0.2, { up: 4 }); fx.ring(e.x, e.z, 0.4, 0.4, 2.6, 0.5, 1.4, 0.2) })
  fx.on('leak', (e) => { fx.ring(e.x, 17.0, 0.5, 0.5, 2.6, 2.6, 0.4, 0.2); if (take('spark')) fx.burst(e.x, 0.3, 17.0, 5, 4, 0.4, 0.12, 3.0, 0.5, 0.2) })
  fx.on('unitHit', (e) => { if (take('spark')) fx.burst(e.x, 0.9, e.z, 3, 3.5, 0.25, 0.09, 3.0, 1.2, 0.5, { up: 2.5 }) })
  fx.on('unitDie', (e) => { fx.burst(e.x, 0.8, e.z, 10, 5, 0.5, 0.12, 3.0, 1.4, 0.4); emit(pAlpha, e.x, 0.8, e.z, 0, 1.5, 0, 1.2, 0.8, 2.2, 0.06, 0.06, 0.06, 0.5, CELL.SMOKE_A, 0, 1, 0, rng() * 6.28, R()); fx.flash(e.x, 1.2, e.z, 12, 0.18) })
  fx.on('shieldBreak', (e) => { fx.ring(e.x, e.z, 0.3, 0.3, 1.8, 0.5, 1.6, 3.0); fx.burst(e.x, 0.9, e.z, 6, 5, 0.3, 0.1, 0.6, 1.8, 3.0, { up: 2 }) })
  fx.on('unitJoin', (e, _, world) => { if (!world || e.source === 'start') return; const sq = world.squad; fx.ring(sq.x, 16.4, 0.6, 0.8, 5.0, 0.4, 1.4, 2.6); fx.sparkleUp(sq.x, 16.2, Math.min(14, 4 + e.count), 0.5, 1.6, 3.0, 1.2) })
  fx.on('heal', (e, _, world) => { if (!world) return; const sq = world.squad; fx.sparkleUp(sq.x, sq.frontZ + 2.5, 16, 0.5, 2.6, 1.0, 2.2); fx.ring(sq.x, sq.frontZ + 2.5, 0.7, 1.0, 7.0, 0.3, 1.6, 0.6) })
  fx.on('gateResolve', (e) => {
    const x = e.x ?? (e.side === 'left' || e.side < 0 ? -3.2 : 3.2), z = e.z ?? 8.4
    fx.ring(x, z, 0.5, 1.0, 7.5, 0.6, 1.8, 3.0); fx.sparkleUp(x, z, 22, 0.6, 1.8, 3.2, 1.6); fx.flash(x, 2, z, 30, 0.3, 0x60c0ff)
    for (let i = 0; i < 16; i++) emit(pAdd, x + R() * 3.0, 0.3 + rng() * 2.6, z, R() * 2, 2 + rng() * 3, R() * 2 + 2, 0.5 + rng() * 0.4, 0.2, 0.05, 0.6, 1.8, 3.2, 0, CELL.STREAK, 0, 1, 1.5)
  })
  fx.on('podLand', (e) => { fx.explosion(e.x, e.z, 0.8); fx.dirtBurst(e.x, e.z, 1.6); fx.shake(0.16) })
  fx.on('podOpen', (e) => { fx.ring(e.x, e.z, 0.6, 1.0, 6.0, 2.6, 1.6, 0.4); fx.sparkleUp(e.x, e.z, 18, 3.0, 1.8, 0.5, 1.0); fx.flash(e.x, 2, e.z, 26, 0.3) })
  fx.on('podLost', () => {})
  fx.on('xp', (e) => { floater('xp', e.x, 0.8, e.z, e.amount, false); if (take('spark')) fx.sparkleUp(e.x, e.z, 2, 0.4, 1.6, 3.0, 0.3) })
  // 下面到 fence 为止是布防事件的兜底表现：deviceview.attach 会把它们整套换掉（飞向计数器的光点、收回动画、抛物线炮弹……）
  fx.on('energy', (e) => { if (take('spark')) fx.sparkleUp(e.x, e.z, 1, 0.3, 2.4, 3.0, 0.2); if (e.amount >= 3) floater('energy', e.x, 0.6, e.z, e.amount, false) })
  fx.on('bigHit', (e, _, world) => {
    // 打在 Boss 身上的大数字也挪到它侧前方（和 bossHit 同一套左右轮流），不压在 Boss 背上
    const bs = world && world.boss
    if (bs && bs.state !== 'burrowed' && Math.abs(e.x - bs.x) < 3 && Math.abs(e.z - bs.z) < 3) { bossSide = -bossSide; floater('dmg', bs.x + bossSide * (3.6 + rng() * 0.8), 1.8, bs.z + 1.8, e.dmg, e.dmg >= 120); return }
    floater('dmg', e.x, 1.2, e.z, e.dmg, e.dmg >= 120)
  })
  // Boss 挨打：集火时每个模拟步有十几次 bossHit，每次都放一朵命中闪光的话，一秒几百朵加法混合叠在同一处 = 一团过曝的火球，Boss 整个看不见。
  // 按特效时钟限流到每秒 ~16 次，而且只溅火星（不放那朵大的闪光贴片），落点摊在它朝我方的那一面
  let bossSparkT = -1
  fx.on('bossHit', (e) => {
    // 伤害数字不再压在 Boss 背上（测试：背上常年一个大号「85 / 153」，轮廓读不出来）：飘在它侧前方，左右轮流
    bossSide = -bossSide
    floater('boss', e.x + bossSide * (3.4 + rng() * 0.8), 1.6, e.z + 1.6, e.dmg, false)
    if (uTime.value < bossSparkT) bossSparkT = -1                 // 换局后时钟回拨
    // 每秒 ~16 朵 → ~4 朵、每朵 3 粒 → 2 粒且暗一半：Boss 身上只偶尔迸一点火星，甲壳本身始终看得清
    if (uTime.value - bossSparkT < 0.25 || !take('hit')) return
    bossSparkT = uTime.value
    const x = e.x + R() * 2.6, y = 0.6 + rng() * 2.0, z = e.z + 0.8 + R() * 1.2
    for (let i = 0; i < 2; i++) { const a = rng() * 6.28, sp = 3 + rng() * 4; emit(pAdd, x, y, z, Math.cos(a) * sp, 1 + rng() * 3, Math.sin(a) * sp + 2.0, 0.18 + rng() * 0.15, 0.08, 0.025, 1.5, 0.95, 0.25, 1, CELL.DOT, -12, 0.5, 1.4) }
    if (rng() < 0.35) emit(pAlpha, x, y, z, R() * 1.5, 1 + rng(), 1 + rng() * 2, 0.4, 0.3, 0.9, 0.2, 0.26, 0.03, 0.5, CELL.SMOKE_A, -2, 2, 0, rng() * 6.28, R() * 3)
  })
  fx.on('levelUp', (e, _, world) => { if (!world) return; const sq = world.squad; fx.ring(sq.x, sq.frontZ + 2, 0.8, 1.0, 9, 1.8, 1.25, 0.35); fx.sparkleUp(sq.x, sq.frontZ + 2, 24, 3.0, 2.0, 0.6, 3.0) })
  fx.on('overdrive', (e, _, world) => { if (!world) return; const sq = world.squad; fx.ring(sq.x, sq.frontZ + 2, 0.5, 1.0, 9, 3.0, 1.2, 0.3) })
  fx.on('heroic', (e, _, world) => { if (!world) return; const sq = world.squad; fx.ring(sq.x, sq.frontZ + 2, 1.0, 1.0, 11, 2.2, 1.5, 0.4); fx.ring(sq.x, sq.frontZ + 2, 0.7, 0.5, 7, 2.2, 1.8, 0.8); fx.sparkleUp(sq.x, sq.frontZ + 2, 40, 3.2, 2.4, 0.8, 4.0); fx.flash(sq.x, 3, sq.frontZ + 2, 40, 0.5, 0xffd080); fx.shake(0.1) })
  fx.on('volley', (e, _, world) => { if (!world) return; const sq = world.squad; fx.ring(sq.x, sq.frontZ + 1, 0.4, 1.0, 9, 3.0, 1.8, 0.5) })
  fx.on('zone', (e) => { if (e.zone === 'fire' && take('spark')) fx.burst(e.x, 0.3, e.z, 4, 3, 0.4, 0.14, 3.0, 1.2, 0.3, { up: 3 }) })
  // 测试：出场时身边叠着白 / 粉 / 橙好几层半透明圈 + 成片火花。登场效果只留一个：一圈低亮度的暗橙褐地面冲击环（1.2 秒扩到 11 米）+ 一下震屏；
  // 另一半是 bossview 里 1~2 秒的轮廓光强调。去掉尘土爆（棕色粒子团正好糊在 Boss 身上）
  fx.on('bossSpawn', (e) => { bossIntroT = uTime.value; fx.ring(e.x, e.z, 1.2, 3, 11, 0.42, 0.14, 0.05); fx.shake(0.2) })   // 出场环 16 米 × 3.0 → 9 米 × 1.4：原来一圈橙光盖住整屏
  fx.on('bossAttack', (e, _, world) => {
    if (e.kind === 'sweep') { fx.ring(e.x, e.z + 2.5, 0.35, 1.5, 6, 1.3, 0.35, 0.1);   /* 横扫 1.4 秒一次：9 米亮橙环 → 6 米、亮度减半，Boss 脚下不再一圈圈地闪 */ for (let i = 0; i < 8; i++) emit(pAlpha, e.x + R() * 5, 0.3, e.z + 2.5 + R() * 2, R() * 4, 2 + rng() * 3, 2 + rng() * 3, 0.6, 0.4, 1.2, 0.09, 0.08, 0.07, 0.6, CELL.DIRT_A, -10, 1, 0, rng() * 6.28, R() * 6) }
    else if (e.kind === 'charge') { fx.shake(0.12) }
    else if (e.kind === 'charge_hit') { fx.explosion(e.x, e.z, 1.2); fx.dirtBurst(e.x, e.z, 2.5) }
    else if (e.kind === 'enrage') { fx.ring(e.x, e.z, 0.7, 1, 9, 0.7, 0.12, 0.04); fx.flash(e.x, 3, e.z, 14, 0.3, 0xff4020); fx.shake(0.14) }   // 环亮度 ×0.35、闪光减半
    else if (e.kind === 'spines') { for (let z = e.z; z < 17; z += 1.6) later((z - e.z) * 0.012, (x, zz) => { fx.dirtBurst(x + R(), zz, 0.7); for (let i = 0; i < 2; i++) emit(pAdd, x + R() * 1.6, 0.1, zz, 0, 6 + rng() * 4, 0, 0.3, 0.3, 0.1, 1.2, 0.9, 0.6, 0, CELL.STREAK, -10, 0, 2) }, e.x, z) }
    // 玩法新增的四种：甲壳硬化 / 硬化结束 / 召唤护卫 / 冲锋撞上防线
    else if (e.kind === 'harden') { fx.ring(e.x, e.z, 0.5, 1.5, 7, 0.22, 0.3, 0.4); fx.shake(0.1) }   // 只留一圈暗钢色冲击环：去掉常驻 2.5 秒的淡蓝圆盘和白闪（「Boss 身边叠着白圈」+ 巢母身上那团白就有它一份）；硬化读法交给 Boss 的冷钢染色和血条   // 硬化光圈亮度约 ×0.3：原来一张淡蓝白的圆盘垫在 Boss 身下，把它衬成灰白
    else if (e.kind === 'harden_end') { for (let i = 0; i < 10; i++) { const a = rng() * 6.28; emit(pAlpha, e.x + Math.cos(a) * 2, 1 + rng() * 2.5, e.z + Math.sin(a) * 2, Math.cos(a) * 4, 2 + rng() * 3, Math.sin(a) * 4, 0.7, 0.35, 0.5, 0.55, 0.6, 0.66, 0.9, CELL.DIRT_A, -12, 1, 0, rng() * 6.28, R() * 8) } }
    else if (e.kind === 'summon') { for (let i = 0; i < 3; i++) fx.dirtBurst(e.x + R() * 7, e.z + 2 + rng() * 4, 1.2) }   // 去掉 10 米的粉橙召唤环（和硬化环、定位括弧叠成好几层圈）：护卫虫从尘土里钻出来就够了
    else if (e.kind === 'crash') { fx.explosion(e.x, e.z + 1, 1.0); fx.dirtBurst(e.x, e.z + 1.5, 3); fx.shake(0.22) }
    // 路障顶停冲锋（line 0 + device）：在路障正面再放一簇金属撞击火花 + 一圈冲击环，和「撞上防线」区分开
    if (e.kind === 'crash' && e.device != null && world && world.devices) {
      const d = world.devices.find(o => o.id === e.device)
      if (d) { fx.burst(d.x, 1.0, d.z - 0.4, 18, 7, 0.35, 0.12, 3.0, 1.9, 0.6, { up: 4 }); fx.ring(d.x, d.z - 0.3, 0.45, 1.2, 4.5, 1.6, 1.2, 0.6) }
    }
    else if (e.kind === 'lay') { fx.burst(e.x, 1.5, e.z, 10, 4, 0.5, 0.16, 0.6, 1.5, 0.2) }
  })
  fx.on('bossStun', (e) => { fx.explosion(e.x, e.z + 1.5, 1.3); fx.dirtBurst(e.x, e.z + 2, 3); for (let i = 0; i < 6; i++) emit(pAdd, e.x + R() * 2, 3.5, e.z + R() * 2, R() * 2, 0.5, R() * 2, 1.2, 0.5, 0.3, 3.0, 2.4, 0.6, 0, CELL.STAR, 0, 1, 0, rng() * 6.28, 6) })
  fx.on('bossDie', (e) => {
    fx.explosion(e.x, e.z, 1.9, 'acid'); fx.shake(0.34); fx.shock(e.x, 1.5, e.z, 1.6, 14, 0.9)
    for (let k = 1; k <= 5; k++) later(k * 0.035, (x, z) => fx.bigDeath(x + R() * 4, z + R() * 4, 1.4 + rng()), e.x, e.z)   // 子弹时间里 0.035 模拟秒 ≈ 0.35 真实秒
  })
  fx.on('shake', (e) => fx.shake(e.amp || 0.1))
  fx.on('mineArm', (e) => { fx.ring(e.x, e.z, 0.4, 0.2, 1.6, 3.0, 0.9, 0.2) })
  fx.on('mineBlast', (e) => { fx.explosion(e.x, e.z, 0.85) })
  fx.on('novaBlast', (e) => { fx.explosion(e.x, e.z, 2.2); fx.shock(e.x, 1, e.z, 1.5, 13, 0.8); fx.ring(e.x, e.z, 0.8, 2, 13, 2.0, 1.0, 0.36); fx.shake(0.3) })
  fx.on('devicePlace', (e) => { fx.ring(e.x, e.z, 0.4, 0.4, 3.2, 0.5, 1.8, 3.0); fx.sparkleUp(e.x, e.z, 8, 0.5, 1.8, 3.0, 0.8) })
  fx.on('deviceHit', (e) => { if (take('spark')) fx.burst(e.x, 0.7, e.z, 3, 3.5, 0.25, 0.09, 3.0, 1.4, 0.5, { up: 2.5 }) })
  fx.on('deviceDie', (e) => { fx.explosion(e.x, e.z, 0.6) })
  fx.on('deviceRemove', (e) => { fx.ring(e.x, e.z, 0.4, 3.0, 0.5, 0.5, 1.8, 3.0) })
  fx.on('fence', (e) => {   // 应急电网：整条车道过一道电
    const x = e.x ?? [-5.12, -2.56, 0, 2.56, 5.12][e.lane | 0]
    for (let i = 0; i < 9; i++) later(i * 0.025, (xx, z) => { fx.beam(xx - 1.28, 0.5, z, xx + 1.28, 0.5, z, 0.2, 0.5, 0.6, 1.8, 3.2, 1); fx.ring(xx, z, 0.3, 0.5, 3.0, 0.5, 1.6, 3.0) }, x, 16.5 - i * 4.5)
    fx.flash(x, 2, 8, 40, 0.4, 0x60c0ff); fx.shake(0.12)
  })
  // strike：有东西从天上往 (x, z) 落，delay 秒后到（落地的爆炸另有 explosion 事件）。kind: bomb / pod / orbital / robot / mine / main_gun
  fx.on('strike', (e) => {
    if (e.x == null) return
    const d = Math.max(0, e.delay || 0), fly = Math.min(d, e.kind === 'orbital' ? 0.25 : 0.45)
    if (e.kind === 'mine') { fx.ring(e.x, e.z, 0.4, 0.2, 1.4, 3.0, 0.9, 0.2); return }
    if (e.kind === 'main_gun') { fx.ring(e.x, e.z, d || 0.5, (e.r || 3) * 2, 0.4, 0.6, 1.8, 3.2); return }
    const col = e.kind === 'orbital' ? [0.8, 2.0, 3.2] : e.kind === 'pod' || e.kind === 'robot' ? [3.2, 1.6, 0.4] : [3.4, 2.4, 0.8]
    later(d - fly, (x, z, t, big) => {
      if (big) { for (let i = 0; i < 4; i++) fx.tracer(x + 3 + i * 0.15, 34, z - 9, x, 0.4, z, 36 / Math.max(0.05, t), 7, 0.9 - i * 0.15, 3.2, 1.4 + i * 0.3, 0.3) }
      else fx.tracer(x + 1.5, 30, z - 5, x, 0.3, z, 31 / Math.max(0.05, t), 6, 0.3, col[0], col[1], col[2])
    }, e.x, e.z, fly, e.kind === 'pod' || e.kind === 'robot')
  })
  fx.on('summon', (e) => { fx.ring(e.x, e.z, 0.7, 0.6, e.kind === 'flagship' ? 10 : 3, 0.5, 1.7, 3.2); if (e.kind === 'robot') later(0.4, (x, z) => { fx.dirtBurst(x, z, 1.2); fx.shake(0.06) }, e.x, e.z) })
  fx.on('summonEnd', (e) => { if (e.kind === 'robot') fx.explosion(e.x, e.z, 0.5); else fx.ring(e.x, e.z, 0.6, 1, 8, 0.5, 1.7, 3.2) })
  fx.on('melee', (e) => {   // 伊瑟拉的挥砍 / 突刺
    if (e.lunge) { const s = Math.sin(Math.PI), len = e.len || 4; fx.beam(e.x, 0.9, e.z, e.x, 0.9, e.z - len, 0.22, (e.w || 1.5) * 0.6, 1.6, 1.0, 3.2); fx.burst(e.x, 0.8, e.z - len * 0.6, 8, 5, 0.3, 0.12, 1.6, 1.0, 3.2, { up: 2 }) }
    else { fx.ring(e.x, e.z - 0.6, 0.22, 0.4, (e.r || 2.4) * 2, 1.4, 0.9, 3.2); if (take('spark')) fx.burst(e.x, 0.9, e.z - (e.r || 2.4) * 0.6, 5, 5, 0.25, 0.1, 1.6, 1.0, 3.2, { up: 2 }) }
  })
  fx.on('aegis', (e) => { fx.ring(e.x, e.z, 0.5, 0.3, 2.6, 2.4, 1.8, 0.5, 1); fx.ring(e.x, e.z, e.dur || 1.5, 1.3, 1.5, 1.6, 1.2, 0.3); fx.sparkleUp(e.x, e.z, 8, 3.0, 2.2, 0.6, 0.5); fx.flash(e.x, 1.2, e.z, 16, 0.3, 0xffd880) })
  fx.on('revive', (e) => { fx.ring(e.x, e.z, 0.4, 0.2, 1.8, 0.4, 1.6, 0.3); if (take('spark')) fx.sparkleUp(e.x, e.z, 4, 0.5, 2.0, 0.4, 0.4) })
  fx.on('acidHit', (e) => { if (!e.dodged || true) fx.burst(e.x, 0.4, e.z, 8, 5, 0.45, 0.16, 0.6, 1.7, 0.2, { up: 4 }) })
  fx.on('powerCast', (e, _, world) => {
    if (e.id === 'hawk_rally' && world) { const sq = world.squad; fx.ring(sq.x, sq.frontZ + 2, 0.9, 1, 12, 2.0, 1.3, 0.35); fx.ring(sq.x, sq.frontZ + 2, 0.6, 0.5, 8, 2.0, 1.5, 0.6); fx.sparkleUp(sq.x, sq.frontZ + 2, 24, 3.2, 2.2, 0.7, 3.5); fx.flash(sq.x, 3, sq.frontZ + 2, 14, 0.4, 0xffd080) }   // 环 14 → 12 米、亮度 ×0.6、点光 30 → 14（powersfx 会覆盖这一项，同步压过）
    else if (e.id === 'ysera_eclipse') { fx.flash(0, 8, 0, 120, 1.2, 0xffb060); fx.shake(0.16) }
    else if (e.x != null) fx.ring(e.x, e.z, 0.5, 0.6, 5, 0.5, 1.7, 3.2)
  })
  fx.on('mutator', () => { fx.flash(0, 6, -8, 90, 0.8, 0xb040ff); fx.shake(0.08) })
  return fx
}
