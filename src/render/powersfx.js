// powersfx.js —— 指挥官技能（GDD §6）和 Boss 死亡演出的特效。事件字段见 ARCHITECTURE「第 3 步」。
// 全部建立在 fx.js 的原语上（粒子 / 曳光 / 光束 / 环 / 贴花 / 冲击波 / 闪白），另加几个自带的网格：
//   鼓舞光环（贴地，跟着队伍）  空袭机编队（实例化的三角翼战机）  瞄准指示线（world.aiming）  日蚀的压暗罩  汇聚射线的光墙
// 各技能的表现：
//   hawk_rally     金色光环铺在队伍脚下持续到 activeUntil，起手一圈冲击环 + 上升光点
//   hawk_strike    三机编队沿纵线从队伍头顶掠过（尾焰拖线），炸弹一枚枚落下
//   hawk_drop      空投舱（gateview 画下落和开舱）
//   hawk_flagship  「不屈号」滑入悬停：引擎尾焰、舰腹探照光斑、激光扫射、主炮蓄力 + 一道粗光柱
//   ysera_orbital  落点锁定圈收拢 + 细的指示光 → 粗光柱砸下
//   ysera_lance    沿线的金色长矛 + 灼烧；瞄准时地面指示带
//   ysera_eclipse  全场压暗（不压特效），金色日冕边，每发落弹前有一道天降光丝
//   joe_drop       铁罐从天上砸下（gateview 画机器人）   joe_mines  雷从队伍抛出去（deviceview 画雷）
//   joe_ray        一堵从天而降的橙色光墙横扫全桥，沿途灼痕和火星
//   bossDie        闪白 + 三重冲击波 + 放射光丝 + 余烬（都按 0.1 倍速的子弹时间设计寿命）
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { POWERS } from '../data/commanders.js'

const ADD = { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }
const TAU = Math.PI * 2
const R = () => Math.random() - 0.5
const NOOP = () => {}

function jetGeometry() {
  const parts = []
  const add = (g, c) => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); const n = ng.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2] } ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); ng.computeVertexNormals(); parts.push(ng) }
  const hull = [0.035, 0.04, 0.05], plate = [0.085, 0.095, 0.115], team = [0.012, 0.05, 0.26], hot = [3.2, 1.6, 0.5], cyan = [0.6, 2.2, 2.8]
  // 机头朝 -Z（飞行方向）
  const nose = new THREE.ConeGeometry(0.55, 3.2, 6); nose.rotateX(-Math.PI / 2); nose.scale(1, 0.62, 1); nose.translate(0, 0, -3.0); add(nose, plate)
  const body = new THREE.BoxGeometry(1.1, 0.62, 4.2); body.translate(0, 0, 0.5); add(body, hull)
  const canopy = new THREE.BoxGeometry(0.5, 0.3, 1.2); canopy.translate(0, 0.42, -1.1); add(canopy, cyan.map((v) => v * 0.25))
  const wing = new THREE.BufferGeometry()   // 三角翼（上下两面）
  const W = [[0.5, 0, -0.9], [3.6, -0.05, 2.0], [0.5, 0, 2.3]]
  const tri = []; for (const s of [1, -1]) { const p = W.map((v) => [v[0] * s, v[1], v[2]]); tri.push(...(s > 0 ? [p[0], p[1], p[2]] : [p[0], p[2], p[1]]).flat(), ...(s > 0 ? [p[0], p[2], p[1]] : [p[0], p[1], p[2]]).map((v) => [v[0], v[1] - 0.09, v[2]]).flat()) }
  wing.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3)); add(wing, plate)
  for (const s of [1, -1]) {
    const tip = new THREE.BoxGeometry(0.16, 0.12, 1.5); tip.translate(s * 3.5, -0.05, 1.7); add(tip, team)
    const stripe = new THREE.BoxGeometry(1.4, 0.04, 0.5); stripe.rotateY(-s * 0.72); stripe.translate(s * 1.8, 0.0, 1.0); add(stripe, team)
    const fin = new THREE.BoxGeometry(0.1, 1.0, 1.3); fin.rotateZ(-s * 0.35); fin.translate(s * 0.62, 0.6, 2.0); add(fin, hull)
    const eng = new THREE.CylinderGeometry(0.3, 0.36, 1.4, 8); eng.rotateX(Math.PI / 2); eng.translate(s * 0.42, -0.05, 2.5); add(eng, hull)
    const glow = new THREE.CircleGeometry(0.27, 8); glow.translate(s * 0.42, -0.05, 3.22); add(glow, hot)
    const bomb = new THREE.CylinderGeometry(0.13, 0.13, 1.3, 6); bomb.rotateX(Math.PI / 2); bomb.translate(s * 1.5, -0.24, 1.0); add(bomb, [0.1, 0.1, 0.11])
  }
  return mergeGeometries(parts)
}

export function createPowersFx(ctx) {
  const scene = ctx.scene
  const uTime = { value: 0 }
  let fx = null, world = null, simNow = 0, C = null
  let aimOverride = null, boomN = 0
  // ------------------------------------------------ 鼓舞光环
  const auraU = { uTime, uAmt: { value: 0 }, uNoise: { value: ctx.noise } }
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    ...ADD, uniforms: auraU,
    vertexShader: `varying vec2 vQ; void main(){ vQ = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform float uAmt; uniform sampler2D uNoise; varying vec2 vQ;
      void main(){ float r = length(vQ); if (r > 1.0) discard; float ang = atan(vQ.y, vQ.x);
        float ring = exp(-pow((r - 0.93) / 0.03, 2.0)) + exp(-pow((r - 0.8) / 0.012, 2.0)) * 0.5;
        float ticks = step(0.72, fract(ang * 5.0929 + uTime * 0.35)) * smoothstep(0.82, 0.86, r) * (1.0 - smoothstep(0.9, 0.92, r)) * 0.8;
        float wave = exp(-pow((r - fract(uTime * 0.55)) / 0.05, 2.0)) * (1.0 - fract(uTime * 0.55)) * 0.7;
        float rays = pow(max(0.5 + 0.5 * sin(ang * 12.0 - uTime * 1.3), 0.0), 6.0) * smoothstep(0.15, 0.8, r) * (1.0 - smoothstep(0.8, 0.93, r)) * 0.22;
        float n = texture2D(uNoise, vQ * 0.8 + vec2(0.0, uTime * 0.06)).r;
        float fill = (0.05 + 0.08 * n) * (1.0 - r * 0.5);
        vec3 c = vec3(3.0, 1.85, 0.5) * (ring * 0.8 + ticks + wave * 0.6 + rays * 0.45 + fill * 0.25) * uAmt * 0.55;   // 0.7 → 0.55、底色和光芒减半：持续 6 秒的光环不该把方阵罩成一片金
        gl_FragColor = vec4(c, 1.0); }`,
  }))
  aura.rotation.x = -Math.PI / 2; aura.position.y = 0.05; aura.renderOrder = 4; aura.frustumCulled = false; aura.visible = false; aura.name = 'rally-aura'; scene.add(aura)
  let rally = null   // { t1 }

  // ------------------------------------------------ 空袭机
  const JETS = 9
  const jetMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.4 }); jetMat.userData.envBase = 0.9
  if (ctx.materials) ctx.materials.push(jetMat)
  const jets = new THREE.InstancedMesh(jetGeometry(), jetMat, JETS); jets.count = 0; jets.frustumCulled = false; jets.castShadow = true; jets.name = 'strike-jets'; scene.add(jets)
  const sorties = []   // { x, t0, n }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(0.6, 0.6, 0.6)

  // ------------------------------------------------ 瞄准指示带
  const aimU = { uTime, uCol: { value: new THREE.Color(3.0, 1.9, 0.5) }, uLen: { value: 10 }, uW: { value: 2 }, uProg: { value: 0 }, uDots: { value: 0 } }
  const aimMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    ...ADD, uniforms: aimU,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uCol; uniform float uLen; uniform float uW; uniform float uProg; uniform float uDots; varying vec2 vUv;
      void main(){ float x = (vUv.x - 0.5) * uW, y = vUv.y * uLen; float ex = uW * 0.5 - abs(x), ey = min(y, uLen - y);
        float edge = 1.0 - smoothstep(0.0, 0.07, min(ex, ey));
        float chev = smoothstep(0.32, 0.5, fract((y - abs(x) * 0.9) * 0.55 - uTime * 2.2)) * 0.3;
        float core = exp(-x * x * 40.0) * 0.8;
        float fillA = step(vUv.y, uProg) * 0.12;                                  // 超时倒计时：沿线填满就自动释放
        float dots = 0.0;
        if (uDots > 0.5) { float sp = uLen / uDots; float d = length(vec2(x, mod(y, sp) - sp * 0.5)); dots = (1.0 - smoothstep(0.16, 0.22, d)) * 1.2 + (1.0 - smoothstep(0.0, 0.05, abs(d - 0.45))) * 0.5; chev *= 0.3; core *= 0.3; }
        float capA = 1.0 - smoothstep(0.0, 0.06, abs(length(vec2(x, y - uLen + 0.02)) - uW * 0.5)) ;
        float a = edge * 0.8 + chev * 0.5 + core * 0.6 + fillA * 0.7 + dots + 0.02;
        gl_FragColor = vec4(uCol * a * (0.8 + 0.2 * sin(uTime * 9.0)), 1.0); }`,
  }))
  aimMesh.renderOrder = 5; aimMesh.frustumCulled = false; aimMesh.visible = false; aimMesh.name = 'aim-line'; scene.add(aimMesh)

  // ------------------------------------------------ 日蚀压暗罩：全屏一层，画在不透明物体和地面标记之后、粒子之前 → 只压场景不压特效
  const eclU = { uAmt: { value: 0 }, uTime, uAspect: { value: 16 / 9 } }
  const eclipse = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: eclU, transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uAmt; uniform float uTime; uniform float uAspect; varying vec2 vUv;
      void main(){ vec2 q = (vUv - vec2(0.5, 0.56)) * vec2(uAspect, 1.0); float r = length(q);
        float ang = atan(q.y, q.x);
        // 测试：日蚀期间屏幕四周一圈浓重的橙色光晕把整个画面染橙。日冕收成一道窄而淡的金边（宽 0.2 → 0.07、亮度 ×0.3），
        // 四角不再额外加深成橙褐色 —— 压暗罩是中性的，画面只是「暗下来」，不是「变橙」
        float corona = exp(-pow((r - 0.8) / 0.07, 2.0)) * (0.75 + 0.15 * sin(ang * 37.0 + uTime * 0.9) + 0.1 * sin(ang * 13.0 - uTime * 0.5));
        float dark = (0.46 + 0.1 * smoothstep(0.2, 0.9, r)) * uAmt;
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * corona * 0.03 * uAmt, dark); }`,
  }))
  eclipse.renderOrder = 5; eclipse.frustumCulled = false; eclipse.visible = false; eclipse.name = 'eclipse-veil'; scene.add(eclipse)
  let ecl = null   // { t0, t1 }

  // ------------------------------------------------ 汇聚射线：光墙
  const wallU = { uTime, uAmt: { value: 0 }, uNoise: { value: ctx.noise } }
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    ...ADD, uniforms: wallU,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform float uAmt; uniform sampler2D uNoise; varying vec2 vUv;
      void main(){ float n = texture2D(uNoise, vec2(vUv.x * 3.0, vUv.y * 0.5 - uTime * 1.6)).r; float n2 = texture2D(uNoise, vec2(vUv.x * 9.0 + 0.3, vUv.y * 1.4 - uTime * 3.1)).r;
        float h = pow(max(1.0 - vUv.y, 0.0), 1.7); float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
        float v = h * (0.35 + n * 0.9 + pow(max(n2, 0.0), 3.0) * 1.4) * ends + exp(-vUv.y * 26.0) * 2.4 * ends;
        gl_FragColor = vec4(vec3(3.2, 1.25, 0.3) * v * uAmt, 1.0); }`,
  }))
  wall.rotation.y = Math.PI / 2; wall.renderOrder = 9; wall.frustumCulled = false; wall.visible = false; wall.name = 'ray-wall'; scene.add(wall)
  let rayT = -9, rayX = 0, rayZ0 = -21, rayZ1 = 17

  // 旗舰：最近一次的位置（激光 / 主炮从这儿出）
  const ship = { x: 0, y: 9, z: 8, t: -9, acc: 0, charge: null }

  const column = (x, z, w, life, r, g, b) => {   // 天降光柱：三层光束 + 落点的星芒
    fx.beam(x + 0.6, 64, z - 5, x, 0.0, z, life, w, r, g, b)
    fx.beam(x + 0.6, 64, z - 5, x, 0.0, z, life * 0.7, w * 0.35, 3.2, 3.0, 2.6)
    fx.emitAdd(x, 0.6, z, 0, 0, 0, life * 1.4, w * 2.2, w * 5.5, r, g, b, 0, C.FLARE, 0, 0, 0, Math.random() * 6)
  }

  const attach = (c) => {
    fx = c.fx; if (!fx) return
    C = fx.CELL
    fx.ray = ray
    // 屏幕冲击波限流：同一时刻叠三四道扭曲会把画面搅出彩虹色的「玻璃泡」（空袭 / 轨道轰击 / 日蚀这种连串爆炸最明显），
    // 这里规定 0.22 秒内最多放 2 道，多出来的直接丢掉（爆炸本身的火光、冲击环都还在）
    { const raw = fx.shock, recent = []; fx.shock = (x, y, z, s, r, d) => { const now = fx.uTime.value; while (recent.length && now - recent[0] > 0.22) recent.shift(); if (recent.length >= 2) return; recent.push(now); raw(x, y, z, Math.min(s ?? 1, 1.1), r, d) } }
    const basePower = fx.handler('powerCast'), baseBeam = fx.handler('beam'), baseExpl = fx.handler('explosion'), baseBossDie = fx.handler('bossDie'), baseSummon = fx.handler('summon'), baseSummonEnd = fx.handler('summonEnd'), baseAimEnd = fx.handler('aimEnd')

    fx.on('powerCast', (e, f, w) => {
      const sq = w && w.squad
      if (e.id === 'hawk_rally') {
        rally = { t1: simNow + (e.dur || 6) }
        if (sq) {
          const x = sq.x, z = sq.frontZ + 3
          // 起手压一截：外环 17 → 12 米、三道环亮度约 ×0.6、点光 40 → 16、全屏闪白 0.06 → 0.02、光点 40 → 26
          fx.ring(x, z, 0.9, 1, 12, 2.0, 1.25, 0.32); fx.ring(x, z, 0.6, 0.5, 8, 2.0, 1.5, 0.6); fx.ring(x, z, 1.2, 7, 9, 0.8, 0.46, 0.12, 1)
          fx.sparkleUp(x, z, 26, 3.2, 2.2, 0.7, 4.2); fx.flash(x, 3, z, 16, 0.4, 0xffd080); fx.shock(x, 1, z, 0.6, 8, 0.45); fx.screenFlash(0.02)
          for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; fx.emitAdd(x + Math.cos(a) * 1.5, 0.15, z + Math.sin(a) * 1.5, Math.cos(a) * 9, 0.4, Math.sin(a) * 9, 0.45, 0.4, 0.1, 2.4, 1.5, 0.4, 0, C.STREAK, 0, 1.6, 2.2) }
        }
        return
      }
      if (e.id === 'hawk_strike') { if (sorties.length < 3) sorties.push({ x: e.x ?? (sq ? sq.x : 0), t0: simNow }); if (sq) fx.ring(e.x ?? sq.x, sq.frontZ, 0.5, 1, 6, 3.0, 1.8, 0.5); return }
      if (e.id === 'ysera_eclipse') { ecl = { t0: simNow, t1: simNow + (e.dur || 10) }; fx.screenFlash(0.3); fx.shake(0.16); fx.flash(0, 9, 0, 60, 0.6, 0xffc880); if (sq) { fx.ring(sq.x, sq.frontZ, 1.2, 2, 40, 1.6, 0.95, 0.25); fx.ring(sq.x, sq.frontZ, 0.8, 1, 26, 1.6, 1.2, 0.5) }   /* 点光 140 → 60、持续 1.0 → 0.6 秒，两道大环亮度减半：开场那一下不再把整座桥照成橙色 */ return }
      if (e.id === 'joe_ray') { fx.screenFlash(0.1); fx.shake(0.12); return }
      if (e.id === 'ysera_lance' || e.id === 'joe_mines' || e.id === 'ysera_orbital' || e.id === 'joe_drop' || e.id === 'hawk_drop') { if (sq) { fx.ring(sq.x, sq.frontZ + 1, 0.45, 0.8, 6, 0.8, 1.6, 3.0); fx.sparkleUp(sq.x, sq.frontZ + 1, 8, 1.2, 1.8, 3.0, 1.0) } return }
      if (e.id === 'hawk_flagship') { if (e.x != null) { fx.ring(e.x, e.z, 1.0, 22, 3, 0.4, 1.4, 2.8); fx.ring(e.x, e.z, 1.4, 2, 12, 0.3, 1.0, 2.2, 1) } return }
      if (basePower) basePower(e, f, w)
    })

    fx.on('beam', (e, f, w) => {
      const k = e.kind || ''
      if (k === 'hawk_flagship') {
        if (!fx.take('tracer')) return
        const sx = ship.x + R() * 1.6, sy = ship.y + 0.3, sz = ship.z + 1.0
        fx.beam(sx, sy, sz, e.x1, 0.15, e.z1, 0.11, 0.26, 0.45, 1.7, 3.2)
        fx.emitAdd(e.x1, 0.3, e.z1, 0, 0, 0, 0.12, 0.9, 2.0, 0.5, 1.6, 3.2, 0, C.FLARE, 0, 0, 0, Math.random() * 6)
        if (fx.take('spark')) { fx.hitSpark(e.x1, 0.4, e.z1, true); fx.ring(e.x1, e.z1, 0.25, 0.4, 2.6, 0.4, 1.3, 2.6) }
        if (fx.take('stain')) fx.stain(e.x1, e.z1, 7, 0.5, 1.3, Math.random() * 6, 0.05, 0.03, 0.022, 0.5, C.SCORCH, 6)
        return
      }
      if (k === 'hawk_flagship_gun') {
        const sx = ship.x, sy = ship.y + 0.2, sz = ship.z + 1.4, d = e.dur || 0.4
        fx.beam(sx, sy, sz, e.x1, 0.1, e.z1, d, 3.2, 0.5, 1.5, 3.2); fx.beam(sx, sy, sz, e.x1, 0.1, e.z1, d * 0.8, 1.3, 2.6, 3.0, 3.2); fx.beam(sx, sy, sz, e.x1, 0.1, e.z1, d * 1.6, 0.4, 0.4, 1.2, 3.0, 1)
        fx.emitAdd(sx, sy, sz, 0, 0, 0, d, 4, 9, 1.2, 2.4, 3.2, 0, C.FLARE, 0, 0, 0, Math.random() * 6)
        fx.emitAdd(e.x1, 1.0, e.z1, 0, 0, 0, d * 1.2, 6, 16, 1.0, 2.2, 3.2, 0, C.FLARE, 0, 0, 0, Math.random() * 6)
        fx.screenFlash(0.4); fx.shake(0.3); fx.shock(e.x1, 0.5, e.z1, 1.0, 10, 0.7); fx.flash(e.x1, 3, e.z1, 240, 0.5, 0x80c0ff)
        fx.ring(e.x1, e.z1, 0.6, 2, 20, 0.8, 2.0, 3.2); fx.ring(e.x1, e.z1, 1.0, 1, 12, 0.4, 1.2, 3.0); fx.ring(e.x1, e.z1, 1.8, 5, 8, 0.25, 0.7, 1.6, 1)
        for (let i = 0; i < 26; i++) { const a = Math.random() * TAU, sp = 6 + Math.random() * 14; fx.emitAdd(e.x1, 0.4, e.z1, Math.cos(a) * sp, 4 + Math.random() * 12, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, 0.16, 0.04, 0.8, 2.2, 3.2, 0.5, C.DOT, -14, 0.7, 1.8) }
        return
      }
      if (k === 'ysera_lance' || k === 'power_lance') {
        if (baseBeam) baseBeam(e, f, w)
        const dx = e.x1 - e.x0, dz = e.z1 - e.z0, len = Math.hypot(dx, dz) || 1, d = e.dur || 0.5
        fx.beam(e.x0, 0.7, e.z0, e.x1, 0.7, e.z1, d * 1.2, (e.w || 2.8) * 1.1, 3.2, 1.7, 0.35); fx.beam(e.x0, 0.7, e.z0, e.x1, 0.7, e.z1, d * 0.7, (e.w || 2.8) * 0.3, 3.2, 3.0, 2.4)
        fx.screenFlash(0.16); fx.shock((e.x0 + e.x1) / 2, 0.5, (e.z0 + e.z1) / 2, 1.0, len * 0.5, 0.5)
        fx.emitAdd(e.x0, 0.8, e.z0, 0, 0, 0, 0.3, 2.5, 6, 3.2, 2.2, 0.8, 0, C.FLARE, 0, 0, 0, Math.random() * 6); fx.emitAdd(e.x1, 0.8, e.z1, 0, 0, 0, 0.35, 3, 8, 3.2, 1.8, 0.5, 0, C.FLARE, 0, 0, 0, Math.random() * 6)
        for (let s = 0; s < len; s += 0.8) { const x = e.x0 + dx / len * s, z = e.z0 + dz / len * s; fx.later(s * 0.004, (xx, zz) => { fx.emitAdd(xx + R(), 0.2, zz + R(), R() * 2, 5 + Math.random() * 6, R() * 2, 0.4 + Math.random() * 0.3, 0.35, 0.1, 3.2, 2.0, 0.5, 0.6, C.STREAK, -4, 1, 2.0); fx.emitAdd(xx, 0.3, zz, R() * 4, 2 + Math.random() * 3, R() * 4, 0.5, 0.12, 0.03, 3.2, 2.2, 0.6, 1, C.DOT, -10, 0.6, 1.5) }, x, z) }
        return
      }
      if (baseBeam) baseBeam(e, f, w)
    })

    fx.on('explosion', (e, f, w) => {
      const k = e.kind || ''
      if (k === 'ysera_eclipse') {
        fx.beam(e.x + 2.5, 50, e.z - 12, e.x, 0.2, e.z, 0.1, 0.5, 3.2, 1.9, 0.5)
        if (fx.take('spark')) fx.ring(e.x, e.z, 0.3, 0.5, 4.2, 3.0, 1.6, 0.4)
      } else if (k === 'ysera_orbital' || k === 'ally_orbital' || k === 'power_orbital') {
        // 轨道轰击常砸在 Boss 身上：光柱 / 星芒约 ×0.6、冲击环 ×0.45 且半径 ×5 → ×3.6，别把 Boss 罩进一团白光
        const onB = w && w.boss && Math.hypot(e.x - w.boss.x, e.z - w.boss.z) < 5, kB = onB ? 0.6 : 1
        column(e.x, e.z, 2.6 * (onB ? 0.75 : 1), 0.32, 0.6 * kB, 1.7 * kB, 3.2 * kB)
        fx.ring(e.x, e.z, 0.55, 1, (e.r || 2.5) * (onB ? 3.6 : 5), 0.8 * (onB ? 0.45 : 1), 1.9 * (onB ? 0.45 : 1), 3.2 * (onB ? 0.45 : 1)); fx.screenFlash(onB ? 0.05 : 0.1)
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; fx.emitAdd(e.x, 0.25, e.z, Math.cos(a) * 12, 0.5, Math.sin(a) * 12, 0.4, 0.5, 0.12, 0.8, 2.0, 3.2, 0, C.STREAK, 0, 2.0, 2.4) }
      }
      // 连串落弹（空袭 11 枚 / 日蚀 250 发）：每发都叠一道屏幕扭曲会把画面搅成一锅，只让其中几发带冲击波
      const quiet = (k === 'hawk_strike' && (boomN++ % 3) !== 0) || (k === 'ysera_eclipse' && (boomN++ % 6) !== 0)
      const sh = fx.shock; if (quiet) fx.shock = NOOP
      if (baseExpl) baseExpl(e, f, w)
      fx.shock = sh
    })

    fx.on('summon', (e, f, w) => { if (e.kind === 'flagship') { ship.t = simNow; ship.charge = null; fx.shake(0.1) } if (baseSummon) baseSummon(e, f, w) })
    fx.on('summonEnd', (e, f, w) => { if (e.kind === 'robot') { fx.explosion(e.x, e.z, 0.55); for (let i = 0; i < 6; i++) fx.emitAlpha(e.x, 0.6, e.z, R() * 6, 3 + Math.random() * 4, R() * 6, 0.8, 0.22, 0.18, 0.4, 0.22, 0.03, 1, C.DIRT_A, -15, 0.3, 0, Math.random() * 6, R() * 16); return } if (baseSummonEnd) baseSummonEnd(e, f, w) })
    fx.on('aimEnd', (e, f, w) => { aimOverride = null; if (baseAimEnd) baseAimEnd(e, f, w) })

    fx.on('bossDie', (e, f, w) => {
      if (baseBossDie) baseBossDie(e, f, w)
      // 子弹时间里模拟时钟只走 0.1 倍：这里的寿命 / 延迟都是模拟秒（0.04 模拟秒 ≈ 0.4 真实秒）
      // 测试「巢母出场/击毙时巨大橙色光环盖住整屏」：地面环 34~58 米 × 3.2 → 12~20 米 × 1.3；闪白 0.95 → 0.45；中心闪光贴片 30 / 36 米 → 12 / 15 米
      fx.screenFlash(0.45); fx.flash(e.x, 4, e.z, 140, 0.12, 0xffe0b0)
      fx.emitAdd(e.x, 2.0, e.z, 0, 0, 0, 0.05, 4, 12, 2.2, 2.0, 1.7, 0, C.DOT); fx.emitAdd(e.x, 2.0, e.z, 0, 0, 0, 0.1, 6, 15, 1.8, 1.0, 0.35, 0, C.FLARE, 0, 0, 0, 0.4)
      for (let k = 0; k < 3; k++) fx.later(k * 0.028, (x, z, kk) => { fx.shock(x, 1.5, z, 1.0 - kk * 0.25, 11 + kk * 4, 0.14); fx.ring(x, z, 0.12 + kk * 0.03, 2, 12 + kk * 4, 1.3, 0.85 - kk * 0.2, 0.3 - kk * 0.08); fx.screenFlash(0.16 - kk * 0.05) }, e.x, e.z, k)
      for (let i = 0; i < 44; i++) { const a = Math.random() * TAU, el = Math.random() * 1.2, sp = 60 + Math.random() * 120; fx.emitAdd(e.x, 1.8, e.z, Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp, 0.05 + Math.random() * 0.07, 0.5, 0.1, 3.2, 2.2 + Math.random(), 0.8, 0.4, C.STREAK, 0, 8, 3.0) }
      for (let i = 0; i < 30; i++) { const a = Math.random() * TAU, r = 1 + Math.random() * 5; fx.emitAdd(e.x + Math.cos(a) * r, 0.3 + Math.random() * 3, e.z + Math.sin(a) * r, Math.cos(a) * 3, 8 + Math.random() * 16, Math.sin(a) * 3, 0.12 + Math.random() * 0.12, 0.3, 0.06, 3.2, 1.5, 0.3, 0.8, C.DOT, 0, 2, 1.5) }
      fx.ring(e.x, e.z, 0.35, 6, 12, 2.2, 0.9, 0.2, 1)
      fx.stain(e.x, e.z, 18, 4, 8, Math.random() * 6, 0.05, 0.028, 0.018, 0.6, C.SCORCH, 10)
    })
  }

  /** gateview 的 strike 包装先问这里：处理了返回 true */
  const strike = (e, w) => {
    if (!fx || e.x == null) return false
    const d = Math.max(0.05, e.delay || 0.3)
    if (e.kind === 'bomb') {
      fx.ring(e.x, e.z, d, (e.r || 2.1) * 2.2, 0.5, 3.0, 1.6, 0.35)
      fx.tracer(e.x, 8.2, e.z + 6 + d * 30, e.x, 0.3, e.z, Math.hypot(8, 6 + d * 30) / d, 2.2, 0.34, 3.2, 2.2, 0.8)
      return true
    }
    if (e.kind === 'orbital') {
      const r = e.r || 2.5
      fx.ring(e.x, e.z, d, r * 3.4, 0.6, 0.7, 1.8, 3.2); fx.ring(e.x, e.z, d, r * 2.0, r * 2.0, 0.25, 0.7, 1.4)
      fx.beam(e.x + 0.6, 64, e.z - 5, e.x, 0.05, e.z, d, 0.1, 0.6, 1.7, 3.2)
      fx.emitAdd(e.x, 0.2, e.z, 0, 0, 0, d, 0.6, 1.6, 0.6, 1.7, 3.2, 0, C.STAR, 0, 0, 0, 0, 5)
      return true
    }
    if (e.kind === 'mine') {
      const sq = w && w.squad, T = 0.42, g = -16
      if (sq) { const x0 = sq.x, y0 = 1.2, z0 = sq.frontZ; for (let i = 0; i < 3; i++) fx.emitAdd(x0, y0, z0, (e.x - x0) / T, (0.15 - y0 - 0.5 * g * T * T) / T, (e.z - z0) / T, T + i * 0.02, 0.3 - i * 0.07, 0.2, 3.2, 1.0, 0.25, 0, i ? C.DOT : C.FLARE, g, 0, i ? 1.2 : 0) }
      fx.later(sq ? T : 0, (x, z) => { fx.ring(x, z, 0.35, 0.2, 1.8, 3.0, 0.9, 0.2); fx.burst(x, 0.15, z, 3, 2.5, 0.25, 0.08, 3.0, 1.4, 0.4, { up: 2 }) }, e.x, e.z)
      return true
    }
    if (e.kind === 'main_gun') {
      fx.ring(e.x, e.z, d, (e.r || 3.2) * 3.2, 0.6, 0.6, 1.8, 3.2); fx.ring(e.x, e.z, d, (e.r || 3.2) * 2, (e.r || 3.2) * 2, 0.3, 0.9, 1.6)
      fx.beam(ship.x, ship.y, ship.z + 1.4, e.x, 0.1, e.z, d, 0.07, 0.5, 1.6, 3.2)
      ship.charge = { t0: simNow, t1: simNow + d }
      return true
    }
    return false
  }

  return {
    attach, strike,
    get world() { return world },
    /** UI 拖出来的瞄准线预览（world.aiming 里只有超时用的 auto 线）：setAimLine({x0,z0,x1,z1}) / setAimLine(null) */
    setAimLine(l) { aimOverride = l },
    reset() { rally = null; ecl = null; sorties.length = 0; jets.count = 0; aura.visible = false; eclipse.visible = false; wall.visible = false; aimMesh.visible = false; rayT = -9; ship.t = -9; ship.charge = null; aimOverride = null },
    /** gateview 每帧把旗舰的实际位置（含滑入 / 飞走）报过来：画引擎尾焰、舰腹光斑、主炮蓄力 */
    flagshipAt(sm, x, y, z, time, dt) {
      ship.x = x; ship.y = y; ship.z = z
      if (!fx || dt <= 0) return
      ship.acc += dt
      if (ship.acc > 0.03) {
        ship.acc = 0
        for (const s of [-2.3, 2.3]) fx.emitAdd(x + s, y + 1.45, z + 3.9, R() * 0.5, R() * 0.5, 9 + Math.random() * 4, 0.16, 1.5, 0.5, 3.2, 1.5, 0.4, 0.8, C.FLARE, 0, 0, 0, Math.random() * 6)
        for (const s of [-2.3, 2.3]) fx.emitAdd(x + s, y + 0.9, z + 1.6, R(), -5 - Math.random() * 3, R(), 0.22, 0.9, 0.3, 0.6, 1.6, 3.0, 0.6, C.FLARE)   // 悬停喷口（朝下）
        if (Math.random() < 0.5) fx.ring(x, z - 1, 0.5, 9, 10, 0.06, 0.18, 0.4, 1)                                                                              // 舰腹探照在甲板上的光斑
      }
      const ch = ship.charge
      if (ch) {
        if (time >= ch.t1) ship.charge = null
        else { const u = (time - ch.t0) / (ch.t1 - ch.t0); fx.emitAdd(x, y + 0.2, z + 1.4, 0, 0, 0, 0.08, 1.0 + u * 3.5, 1.4 + u * 4.5, 0.6, 1.8, 3.2, 0, C.FLARE, 0, 0, 0, time * 9); for (let i = 0; i < 2; i++) { const a = Math.random() * TAU, r = 2.5 + Math.random() * 2; fx.emitAdd(x + Math.cos(a) * r, y + 0.2 + R() * 2, z + 1.4 + Math.sin(a) * r, -Math.cos(a) * r * 5, 0, -Math.sin(a) * r * 5, 0.2, 0.22, 0.05, 0.6, 1.8, 3.2, 0, C.DOT, 0, 0, 1.4) } }
      }
    },
    update(w, time, realTime, dt) {
      world = w; simNow = time; uTime.value = realTime
      if (!fx) return
      const sq = w.squad
      // ---- 鼓舞光环 ----
      let on = 0
      const pw = w.powers && w.powers.find((p) => p.id === 'hawk_rally')
      if (pw && pw.activeUntil != null) on = pw.activeUntil > time ? 1 : 0
      else if (rally) on = rally.t1 > time ? 1 : 0
      if (rally && rally.t1 <= time) rally = null
      auraU.uAmt.value += (on - auraU.uAmt.value) * Math.min(1, (on ? 6 : 3) * Math.max(dt, 0.004))
      aura.visible = auraU.uAmt.value > 0.01 && !!sq
      if (aura.visible) {
        const zc = ((sq.frontZ ?? 8.1) + (sq.backZ ?? 13)) / 2 + 0.5
        aura.position.set(sq.x, 0.05, zc); aura.scale.set(12.7, 11.5, 1)
        if (on && dt > 0 && fx.take('spark')) { const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 6; fx.emitAdd(sq.x + Math.cos(a) * r, 0.1, zc + Math.sin(a) * r * 0.8, 0, 2.5 + Math.random() * 2.5, 0, 0.6 + Math.random() * 0.4, 0.2, 0.05, 3.2, 2.0, 0.5, 0, Math.random() < 0.3 ? C.STAR : C.STREAK, 0, 0.4, 1.8, Math.random() * 6, 3) }
      }
      // ---- 空袭机编队：沿 x 纵线从镜头后方飞向远端 ----
      let nj = 0
      for (let i = sorties.length - 1; i >= 0; i--) {
        const s = sorties[i], t = time - s.t0
        if (t > 1.6 || t < 0) { sorties.splice(i, 1); continue }
        for (let k = 0; k < 3 && nj < JETS; k++) {
          const lag = k === 0 ? 0 : 0.085, side = k === 0 ? 0 : (k === 1 ? -1 : 1)
          const tt = t - lag, z = 44 - tt * 92, x = s.x + side * 2.6, y = 7.2 + (k ? 0.6 : 0) + Math.sin(tt * 5 + k) * 0.2
          if (z < -80) continue
          _e.set(0.03, 0, side * -0.12 + Math.sin(tt * 3 + k * 2) * 0.06); _q.setFromEuler(_e)
          jets.setMatrixAt(nj++, _m.compose(_p.set(x, y, z), _q, _s))
          if (dt > 0) for (const e of [-0.3, 0.3]) { fx.emitAdd(x + e, y - 0.04, z + 2.5, 0, 0, 30, 0.1, 0.8, 0.2, 3.2, 1.6, 0.5, 0.8, C.FLARE); fx.emitAlpha(x + e, y, z + 3, R() * 0.3, R() * 0.3, 6, 0.7, 0.4, 1.3, 0.5, 0.5, 0.52, 0.12, C.SMOKE_A, 0, 1, 0, Math.random() * 6, R()) }
        }
      }
      jets.count = nj; if (nj) jets.instanceMatrix.needsUpdate = true
      // ---- 瞄准指示带 ----
      const A = w.aiming
      if (A && (aimOverride || A.auto)) {
        const l = aimOverride || A.auto, def = POWERS[A.power] || {}
        const dx = l.x1 - l.x0, dz = l.z1 - l.z0, len = Math.max(0.5, Math.hypot(dx, dz))
        const mines = A.power === 'joe_mines', wd = mines ? 1.5 : (def.half ? def.half * 2 : 2.4)
        aimMesh.visible = true
        aimMesh.position.set((l.x0 + l.x1) / 2, 0.06, (l.z0 + l.z1) / 2)
        aimMesh.quaternion.setFromEuler(_e.set(-Math.PI / 2, Math.atan2(dx, dz) + Math.PI, 0, 'YXZ'))
        aimMesh.scale.set(wd, len, 1)
        aimU.uLen.value = len; aimU.uW.value = wd; aimU.uDots.value = mines ? (def.mines || 10) : 0
        aimU.uProg.value = A.timeout ? 1 - Math.max(0, A.timeLeft) / A.timeout : 0
        if (mines) aimU.uCol.value.setRGB(3.0, 1.0, 0.25); else aimU.uCol.value.setRGB(3.0, 1.9, 0.5)
      } else aimMesh.visible = false
      // ---- 日蚀 ----
      let ea = 0
      const pe = w.powers && w.powers.find((p) => p.id === 'ysera_eclipse')
      if (pe && pe.activeUntil != null && pe.activeUntil > time) ea = Math.min(1, (pe.activeUntil - time) * 1.5)
      else if (ecl && time < ecl.t1) ea = Math.min(1, (time - ecl.t0) * 3, (ecl.t1 - time) * 1.5)
      if (ecl && time >= ecl.t1) ecl = null
      eclU.uAmt.value += (ea - eclU.uAmt.value) * 0.12
      eclipse.visible = eclU.uAmt.value > 0.01
      if (ctx.camera) eclU.uAspect.value = ctx.camera.aspect
      // ---- 汇聚射线 ----
      let ray = null
      if (w.summons) for (const sm of w.summons) if (sm.kind === 'ray') ray = sm
      if (ray) { rayT = time; rayX = ray.x; rayZ0 = ray.z0 ?? -21; rayZ1 = ray.z1 ?? 17 }
      const ra = Math.max(0, 1 - (time - rayT) / 0.12)
      wall.visible = ra > 0.01
      if (wall.visible) { wallU.uAmt.value = ra; wall.position.set(rayX, 8, (rayZ0 + rayZ1) / 2); wall.scale.set(rayZ1 - rayZ0, 16, 1) }
    },
  }
  /** renderer 每帧为汇聚射线调一次（覆盖 fx.ray 的默认画法） */
  function ray(x, z0, z1) {
      if (!fx) return
      fx.beam(x, 0.35, z0, x, 0.35, z1, 0.07, 1.7, 3.2, 1.3, 0.3); fx.beam(x, 0.35, z0, x, 0.35, z1, 0.06, 0.5, 3.2, 2.8, 2.0)
      for (const zz of [z0 + 6, z1 - 8]) fx.beam(x, 46, zz - 3, x, 0.3, zz, 0.06, 0.3, 3.0, 1.3, 0.4)
      for (let i = 0; i < 3; i++) if (fx.take('spark')) { const z = z0 + Math.random() * (z1 - z0); fx.emitAdd(x, 0.3, z, R() * 5, 3 + Math.random() * 5, R() * 2, 0.5, 0.5, 1.5, 2.8, 1.2, 0.2, 1.5, C.FIRE, 0, 1.5, 0, Math.random() * 6, R() * 3); fx.emitAdd(x, 0.3, z, R() * 9, 3 + Math.random() * 7, R() * 4, 0.5, 0.12, 0.03, 3.2, 1.8, 0.5, 1, C.DOT, -14, 0.6, 1.6); if (fx.take('stain')) fx.stain(x, z, 7, 0.7, 1.8, Math.random() * 6, 0.05, 0.028, 0.018, 0.5, C.SCORCH, 6) }
      fx.flameLight.position.set(x, 1.5, (z0 + z1) / 2); fx.flameLight.intensity = Math.max(fx.flameLight.intensity, 12)
  }
}
