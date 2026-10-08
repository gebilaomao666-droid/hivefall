// deviceview.js —— 布防系统（GDD §13）的全部表现：world.devices / world.fences / 布防预览 / 晶能掉落。
//   装置本体   走资源表 device.<kind>（models/world/devices.js），未注册的 kind 自动用占位体
//              会转向开火（哨戒塔 / 冷凝塔 / 迫击炮台按 deviceFire 的落点转）、放下时从甲板里升起、受击闪、半血以下冒烟、被毁爆炸留残骸
//              地雷：武装前琥珀灯慢闪（idle），武装后红灯 + 探针弹出（armed）；聚变炸弹：倒计时脉动越来越快
//   应急电网   每条车道尽头（z = 16.5）一道能量栅栏：6 根发射桩 + 5 片电幕；ready 青色常亮，用掉后熄灭、桩头转红；触发时整片闪白
//              受损：血条（掉过血才显示）+ 半血以下压暗冒烟；被毁：爆炸 + 残骸下沉；玩家铲除（deviceRemove）：染青缩小收回甲板
//   应急电网   每条车道尽头（z = 16.5）……用掉后熄灭、桩头转红；fenceRefill 重新上电
//   布防预览   setPlacement({ kind, lane, row, valid })：亮出 5×4 格（空格青、占用红、指向的格子加亮）+ 该装置的全息虚影（可放青 / 不可放红）
//              + 它的作用范围（琥珀色：哨戒 / 冷凝 / 迫击炮 = 本道往前，喷火 = 一排 3 格，聚变 = 3×3，地雷 = 感应圈和爆炸圈）；放置失败（placeFail）那一格闪红
//   5×4 格地标 只在布防模式（setPlacement）时淡入；平时桥面上不画格子（setLandmarks('force') 才常驻很淡的角标，调试用）
//   晶能掉落   energy 事件 → 青色光点从掉落处飞向 HUD 的晶能计数器（setEnergyTarget 给屏幕位置；hooks.onEnergyFly / onEnergyArrive 通知 UI）
//
// 字段与事件对的是真模拟（src/sim/devices.js，契约见 docs/ARCHITECTURE.md「第 6 步」）：
//   world.devices[] = { id, kind, lane, row, x, z, hp, hpMax, alive, t0, armedT, armed, fireT, hitT, aimX, aimZ }
//     地雷 armed(bool) / armedT = 武装时刻；聚变炸弹 armedT = 爆炸时刻（t0 + fuse）；一次性装置 hpMax = 0；采集器 fireT = 最近一次产出
//   world.fences[l] = true / false（也认 mock 的 { ready }）   world.grid.cells[lane][row]
//   事件 devicePlace / deviceFire / deviceHit / deviceDie / deviceRemove / placeFail / mineArm / mineBlast{r} / novaBlast{w,d} /
//        energy{source: kill|collector|refund|gate} / fence{lane,x,z,kills} / fenceRefill{lanes}；喷火陷阱另发 flame{unit:'d<id>'}
import * as THREE from 'three'
import { createPool } from './assets.js'
import { LANES } from './env.js'
import { DEVICES } from '../data/devices.js'
import { DEVICE_BUILDERS, rigGeometry } from './models/world/devices.js'

const FENCE_Z = 16.5, TAU = Math.PI * 2
const MORTAR_T = 0.32            // 迫击炮弹的表现飞行时间：模拟是开火即结算，爆炸和死亡表现都推迟这么久（fx.DEATH_DELAY.mortarpit 同值）
const NOVA_FUSE = DEVICES.nova.fuse
const RANGE_COL = [1.0, 0.62, 0.14]
const OK_COL = [0.25, 1.0, 0.85], BAD_COL = [1.0, 0.22, 0.12]
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d }
const QUAD = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); return g }
const ADD = { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }

export function createDeviceView(ctx) {
  const scene = ctx.scene
  const uTime = { value: 0 }, uSim = { value: 0 }
  const pools = new Map()
  const poolOf = (name) => { let p = pools.get(name); if (p === undefined || p === null) { p = createPool(name, ctx); pools.set(name, p); if (p) p.n = 0 } return p }
  const states = new Map()   // device id -> { yaw, fireT, hitT, pulseT, bornT, smoke }
  const dead = []            // 残骸 { pool, x, z, yaw, t0 }
  let fx = null, firstFrame = true, lastTime = 0, lastReal = 0

  // ------------------------------------------------ 应急电网
  const fence = new THREE.Group(); fence.name = 'fences'; fence.visible = false; scene.add(fence)
  const xs = [-6.4, -3.84, -1.28, 1.28, 3.84, 6.4]
  {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.8, roughness: 0.42 }); postMat.userData.envBase = 0.8
    if (ctx.materials) ctx.materials.push(postMat)
    const geos = [new THREE.BoxGeometry(0.34, 0.16, 0.5), new THREE.BoxGeometry(0.2, 0.9, 0.26), new THREE.BoxGeometry(0.3, 0.1, 0.36)]
    geos[0].translate(0, 0.08, 0); geos[1].translate(0, 0.55, 0); geos[2].translate(0, 1.04, 0)
    for (const g of geos) { const im = new THREE.InstancedMesh(g, postMat, 6); xs.forEach((x, i) => { im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, FENCE_Z)) }); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; fence.add(im) }
  }
  const capGeo = new THREE.BoxGeometry(0.1, 0.62, 0.3); capGeo.translate(0, 0.6, 0)
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 12); caps.frustumCulled = false; fence.add(caps)
  { const m = new THREE.Matrix4(); xs.forEach((x, i) => { caps.setMatrixAt(i * 2, m.makeTranslation(x - 0.105, 0, FENCE_Z)); caps.setMatrixAt(i * 2 + 1, m.makeTranslation(x + 0.105, 0, FENCE_Z)) }) }
  const capCol = new THREE.Color()
  const curtainGeo = QUAD(), cA = new Float32Array(5 * 4), cAttr = new THREE.InstancedBufferAttribute(cA, 4).setUsage(THREE.DynamicDrawUsage)
  curtainGeo.setAttribute('aF', cAttr); curtainGeo.instanceCount = 5
  const curtainMat = new THREE.ShaderMaterial({
    ...ADD, uniforms: { uTime, uNoise: { value: ctx.noise } },
    vertexShader: /* glsl */`attribute vec4 aF; varying vec2 vUv; varying vec4 vF; varying float vX;   // aF = (x, 亮度, 触发闪光, 半宽)
      void main(){ vUv = position.xy + 0.5; vF = aF; vec3 p = vec3(aF.x + position.x * aF.w * 2.0, 0.06 + vUv.y * 0.98, ${FENCE_Z.toFixed(2)}); vX = p.x; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform sampler2D uNoise; varying vec2 vUv; varying vec4 vF; varying float vX;
      void main(){
        float on = vF.y, fl = vF.z;
        float n = texture2D(uNoise, vec2(vX * 0.23 + uTime * 0.31, vUv.y * 0.6 - uTime * 0.17)).r;
        float arcs = 0.0;
        for (int i = 0; i < 3; i++) { float fi = float(i); float y = 0.22 + fi * 0.28 + (n - 0.5) * 0.16 + 0.03 * sin(vX * 9.0 + uTime * (7.0 + fi * 3.0) + fi * 2.1); float d = (vUv.y - y) / 0.035; arcs += exp(-d * d) * (0.75 + 0.25 * sin(uTime * 40.0 + vX * 23.0 + fi)); }
        float edge = pow(max(abs(vUv.x - 0.5) * 2.0, 0.0), 8.0) + pow(max(1.0 - vUv.y, 0.0), 6.0) * 0.5;
        float veil = 0.05 + 0.07 * smoothstep(0.45, 0.8, n);
        float a = (arcs * 0.85 + edge * 0.5 + veil) * on * (1.0 - smoothstep(0.85, 1.0, vUv.y));
        vec3 c = mix(vec3(0.25, 1.1, 2.4), vec3(2.0, 2.6, 3.0), clamp(arcs * 0.5, 0.0, 1.0)) * a;
        c += vec3(1.6, 2.4, 3.0) * fl * (0.35 + arcs + veil * 3.0);
        gl_FragColor = vec4(c, 1.0); }`,
  })
  const curtain = new THREE.Mesh(curtainGeo, curtainMat); curtain.frustumCulled = false; curtain.renderOrder = 8; fence.add(curtain)
  const fenceOn = new Float32Array(5), fenceFlash = new Float32Array(5).fill(-9)

  // ------------------------------------------------ 布防预览：格子 + 全息虚影
  let place = null
  // 格子实例：aC = (x, z, 状态, 亮度)  aS = (半宽, 半深, 形状 0 矩形 1 圆, _)
  //   状态 0 空格（可放）1 已占用 2 选中·可放 3 选中·不可放 4 作用范围（选中的装置打得到 / 炸得到的地方）5 地标（平时常亮的 5×4 格角标）6 放置失败闪红
  const CELL_CAP = 32
  const cellGeo = QUAD(), cP = new Float32Array(CELL_CAP * 4), cS = new Float32Array(CELL_CAP * 4)
  const cPA = new THREE.InstancedBufferAttribute(cP, 4).setUsage(THREE.DynamicDrawUsage), cSA = new THREE.InstancedBufferAttribute(cS, 4).setUsage(THREE.DynamicDrawUsage)
  cellGeo.setAttribute('aC', cPA); cellGeo.setAttribute('aS', cSA); cellGeo.instanceCount = 0
  const cellMat = new THREE.ShaderMaterial({
    ...ADD, uniforms: { uTime },
    vertexShader: /* glsl */`attribute vec4 aC; attribute vec4 aS; varying vec2 vQ; varying float vS; varying float vA; varying vec2 vSz; varying float vShape;
      void main(){ vQ = position.xy * 2.0; vS = aC.z; vA = aC.w; vSz = aS.xy; vShape = aS.z;
        vec3 p = vec3(aC.x + position.x * aS.x * 2.0, 0.045, aC.y + position.y * aS.y * 2.0); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vQ; varying float vS; varying float vA; varying vec2 vSz; varying float vShape;
      void main(){
        vec2 sz = vSz; vec2 d = (1.0 - abs(vQ)) * sz; float e = min(d.x, d.y);
        if (vShape > 0.5) { e = (1.0 - length(vQ)) * sz.x; if (e < 0.0) discard; }
        float line = 1.0 - smoothstep(0.0, 0.05, e);
        float corner = (1.0 - smoothstep(0.03, 0.11, e)) * step(max(d.x, d.y), 0.55);        // 四角的括号
        int st = int(vS + 0.5);
        vec3 col; float a;
        if (st == 5) {             // 地标：很淡的角标，告诉玩家「这 20 格能放东西」
          col = vec3(0.30, 0.72, 0.95); a = corner * 0.4 + line * 0.04;
        } else if (st == 4) {      // 作用范围：琥珀色的淡底 + 流动的虚线边
          col = vec3(${RANGE_COL.join(',')});
          float dash = step(0.45, fract((vQ.x * sz.x - vQ.y * sz.y) * 0.8 + uTime * 0.7));
          float flow = vShape > 0.5 ? 0.0 : smoothstep(0.7, 1.0, fract(vQ.y * sz.y * 0.22 + uTime * 0.8)) * 0.07;
          a = line * 1.1 * dash + (1.0 - smoothstep(0.0, 0.3, e)) * 0.16 + 0.075 + flow;
        } else if (st == 6) {      // 放置失败：整格闪红
          col = vec3(${BAD_COL.join(',')}); a = line * 1.4 + 0.3 + smoothstep(0.4, 0.5, fract((vQ.x * sz.x + vQ.y * sz.y) * 1.4)) * 0.2;
        } else {
          bool bad = st == 1 || st == 3; bool sel = st >= 2;
          col = bad ? vec3(${BAD_COL.join(',')}) : vec3(${OK_COL.join(',')});
          float hatch = bad && sel ? smoothstep(0.4, 0.5, fract((vQ.x * sz.x + vQ.y * sz.y) * 1.4)) * 0.1 : 0.0;
          float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
          a = line * (sel ? 1.3 : (bad ? 0.12 : 0.3)) + corner * (sel ? 1.6 : (bad ? 0.5 : 0.75)) + hatch + (sel ? 0.08 + 0.08 * pulse : (bad ? 0.0 : 0.022));
          if (sel) a += (1.0 - smoothstep(0.0, 0.5, abs(fract(length(vQ * sz) * 0.8 - uTime * 0.9) - 0.5))) * 0.06;
        }
        gl_FragColor = vec4(col * a * vA, 1.0); }`,
  })
  const cells = new THREE.Mesh(cellGeo, cellMat); cells.frustumCulled = false; cells.renderOrder = 4; cells.name = 'deploy-cells'; scene.add(cells)
  let nc = 0
  const putCell = (x, z, hw, hd, state, alpha = 1, shape = 0) => { if (nc >= CELL_CAP) return; const o = nc++ * 4; cP[o] = x; cP[o + 1] = z; cP[o + 2] = state; cP[o + 3] = alpha; cS[o] = hw; cS[o + 1] = hd; cS[o + 2] = shape; cS[o + 3] = 0 }
  const fails = []           // 放置失败的闪红 { lane, row, t0(真实秒) }
  let landmarks = false, landAmt = 0, placeAmt = 0   // 平时不画地标（测试：桥面像开发网格）；放置模式的格子 0.2 秒淡入
  // ------------------------------------------------ 装置血条：受过伤的才显示（一条细的，朝向镜头）
  const BAR_CAP = 24
  const barGeo = QUAD(), bA = new Float32Array(BAR_CAP * 4), bAA = new THREE.InstancedBufferAttribute(bA, 4).setUsage(THREE.DynamicDrawUsage)
  barGeo.setAttribute('aA', bAA); barGeo.instanceCount = 0
  const barMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, fog: false,
    vertexShader: /* glsl */`attribute vec4 aA; varying vec2 vUv; varying float vR;   // aA = (位置, 血量比例)
      void main(){ vUv = position.xy + 0.5; vR = aA.w; vec4 mv = viewMatrix * vec4(aA.xyz, 1.0); mv.xy += position.xy * vec2(1.25, 0.13); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`varying vec2 vUv; varying float vR;
      void main(){ float bx = min(vUv.x, 1.0 - vUv.x) * 9.6, by = min(vUv.y, 1.0 - vUv.y); float e = min(bx, by);
        float inside = smoothstep(0.16, 0.24, e); float fill = step(vUv.x, 0.03 + vR * 0.94) * inside;
        vec3 hot = mix(vec3(1.0, 0.2, 0.08), mix(vec3(1.0, 0.7, 0.12), vec3(0.3, 1.0, 0.7), smoothstep(0.5, 0.85, vR)), smoothstep(0.2, 0.5, vR));
        gl_FragColor = vec4(mix(vec3(0.02, 0.03, 0.04), hot * 1.25, fill), 0.9); }`,
  })
  const bars = new THREE.Mesh(barGeo, barMat); bars.frustumCulled = false; bars.renderOrder = 20; bars.name = 'device-bars'; scene.add(bars)
  let nb = 0
  const ghostMat = new THREE.ShaderMaterial({
    ...ADD, uniforms: { uTime, uCol: { value: new THREE.Color(...OK_COL) } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float fres = pow(max(f, 0.0), 1.6);
        float scan = 0.55 + 0.45 * sin(vW.y * 46.0 - uTime * 7.0); float sweep = smoothstep(0.12, 0.0, abs(fract(uTime * 0.5) * 2.4 - vW.y));
        float flick = 0.86 + 0.14 * sin(uTime * 37.0);
        gl_FragColor = vec4(uCol * (0.2 + fres * 1.25 + sweep * 0.8) * scan * flick, 1.0); }`,
  })
  const ghosts = new Map()   // kind -> Mesh
  const ghostOf = (kind) => {
    let m = ghosts.get(kind)
    if (m === undefined) {
      const b = DEVICE_BUILDERS[kind]
      m = b ? new THREE.Mesh(rigGeometry(b(), THREE), ghostMat) : null
      if (m) { m.rotation.y = Math.PI; m.visible = false; m.renderOrder = 9; m.frustumCulled = false; scene.add(m) }
      ghosts.set(kind, m)
    }
    return m
  }

  // ------------------------------------------------ 晶能光点：GPU 上沿贝塞尔曲线飞向计数器
  const ORB = 96
  const orbGeo = QUAD(), oA = new Float32Array(ORB * 4), oB = new Float32Array(ORB * 4)
  const oAA = new THREE.InstancedBufferAttribute(oA, 4).setUsage(THREE.DynamicDrawUsage), oBA = new THREE.InstancedBufferAttribute(oB, 4).setUsage(THREE.DynamicDrawUsage)
  for (let i = 3; i < oA.length; i += 4) oA[i] = -1e6
  orbGeo.setAttribute('aA', oAA); orbGeo.setAttribute('aB', oBA); orbGeo.instanceCount = ORB
  const uTarget = { value: new THREE.Vector3(-8, 12, 30) }
  const orbMat = new THREE.ShaderMaterial({
    ...ADD, uniforms: { uSim, uTarget },
    vertexShader: /* glsl */`attribute vec4 aA; attribute vec4 aB; uniform float uSim; uniform vec3 uTarget; varying vec2 vUv; varying float vK;   // aA = (起点, 出生时刻) aB = (时长, 种子, 大小, _)
      void main(){
        float u = (uSim - aA.w) / aB.x;
        if (u < 0.0 || u >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float k = u * u * (3.0 - 2.0 * u); k = mix(u * u, k, 0.5);
        vec3 c = aA.xyz + vec3((aB.y - 0.5) * 3.0, 2.6 + aB.y * 1.6, (fract(aB.y * 7.3) - 0.5) * 2.0);
        vec3 p = mix(mix(aA.xyz, c, k), mix(c, uTarget, k), k);
        p.y += sin(u * 3.14159) * 0.4;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float s = aB.z * (0.55 + 0.45 * sin(u * 3.14159)) * (1.0 + 0.25 * sin(uSim * 30.0 + aB.y * 40.0));
        mv.xy += position.xy * s * (1.0 - k * 0.35) * max(1.0, -mv.z * 0.06);
        gl_Position = projectionMatrix * mv; vUv = position.xy * 2.0; vK = u; }`,
    fragmentShader: /* glsl */`varying vec2 vUv; varying float vK;
      void main(){ float r = length(vUv); float core = exp(-r * r * 9.0); float halo = exp(-r * r * 2.2) * 0.35;
        float star = (exp(-abs(vUv.x) * 9.0) * exp(-abs(vUv.y) * 1.6) + exp(-abs(vUv.y) * 9.0) * exp(-abs(vUv.x) * 1.6)) * 0.35;
        gl_FragColor = vec4(vec3(0.3, 1.5, 1.25) * (core * 1.5 + halo * 0.6 + star * 0.7) + vec3(0.7) * core * core, 1.0); }`,   // 亮度约 ×0.65：Boss 出场时一波虫被扫掉，十几颗亮青光点浮在它头上
  })
  const orbs = new THREE.Mesh(orbGeo, orbMat); orbs.frustumCulled = false; orbs.renderOrder = 15; orbs.name = 'energy-orbs'; scene.add(orbs)
  let orbHead = 0, orbBudget = 0, orbDirty = false
  let target = null   // { x, y } CSS 像素；null = 默认（画面左下）
  const spawnOrb = (x, z, size, y = 0.5) => {
    const o = orbHead * 4; orbHead = (orbHead + 1) % ORB
    const dur = 0.75 + Math.random() * 0.3
    oA[o] = x; oA[o + 1] = y; oA[o + 2] = z; oA[o + 3] = uSim.value
    oB[o] = dur; oB[o + 1] = Math.random(); oB[o + 2] = size
    orbDirty = true
    return dur
  }
  const _ndc = new THREE.Vector3(), _dir = new THREE.Vector3(), _pv = new THREE.Vector3()
  const targetNdc = () => {
    let nx = -0.62, ny = -0.78
    if (target && ctx.canvas) { const w = ctx.canvas.clientWidth || 1, h = ctx.canvas.clientHeight || 1; nx = (target.x / w) * 2 - 1; ny = -(target.y / h) * 2 + 1 }
    return [nx, ny]
  }
  const updateTarget = () => {
    const cam = ctx.camera; if (!cam) return
    const [nx, ny] = targetNdc()
    _ndc.set(nx, ny, 0.5).unproject(cam); _dir.copy(_ndc).sub(cam.position).normalize()
    uTarget.value.copy(cam.position).addScaledVector(_dir, 17)
  }
  const toCss = (x, y, z) => { const cam = ctx.camera, cv = ctx.canvas; if (!cam || !cv) return { x: 0, y: 0 }; _pv.set(x, y, z).project(cam); return { x: (_pv.x * 0.5 + 0.5) * (cv.clientWidth || 1), y: (-_pv.y * 0.5 + 0.5) * (cv.clientHeight || 1) } }
  const targetCss = () => { const cv = ctx.canvas, [nx, ny] = targetNdc(); return { x: (nx * 0.5 + 0.5) * ((cv && cv.clientWidth) || 1), y: (-ny * 0.5 + 0.5) * ((cv && cv.clientHeight) || 1) } }
  // 给 UI 的两个回调（由 renderer 转接成 view.onEnergyFly / view.onEnergyArrive）：
  //   onEnergyFly({ amount, source, from: {x, y}, to: {x, y}, duration, orbs })   光点起飞（CSS 像素；duration 是模拟秒）
  //   onEnergyArrive({ amount, source })                                         光点飞到计数器：这时候让数字跳一下
  const hooks = { onEnergyFly: null, onEnergyArrive: null }
  const arrivals = []        // { t, amount, source }
  /** 一笔晶能入账：放 n 颗光点（n = 0 表示这一帧的光点预算用完了，不画但照样通知 UI） */
  const fly = (e, source, n, size, y, spread) => {
    let dur = 0
    for (let i = 0; i < n; i++) dur = Math.max(dur, spawnOrb(e.x + (Math.random() - 0.5) * spread, e.z + (Math.random() - 0.5) * spread, size, y))
    if (hooks.onEnergyFly) hooks.onEnergyFly({ amount: e.amount, source, from: toCss(e.x, y, e.z), to: targetCss(), duration: dur, orbs: n })
    if (arrivals.length < 256) arrivals.push({ t: uSim.value + dur, amount: e.amount, source })
  }

  // ------------------------------------------------ 事件
  const stateOf = (id, time) => { let s = states.get(id); if (!s) { s = { yaw: Math.PI, want: Math.PI, fireT: -9, hitT: -9, pulseT: -9, bornT: firstFrame ? -9 : time, smoke: 0 }; states.set(id, s) } return s }
  const attach = (c) => {
    fx = c.fx
    if (!fx) return
    const R = () => Math.random() - 0.5, C = fx.CELL
    // 晶能：source = kill（小额掉落，攒够 1 点才来一条，每帧限流）/ collector（采集器产出）/ refund（铲除、老猫的损毁返还）/ gate（装置门附送）
    fx.on('energy', (e, _, world) => {
      const src = e.source || (e.amount >= 5 ? 'collector' : 'kill')
      if (src === 'collector') { fx.floater('energy', e.x, 1.6, e.z, e.amount, false); fly(e, src, 3, 0.5, 1.5, 0.4); fx.ring(e.x, e.z, 0.5, 0.4, 2.4, 0.3, 1.6, 1.3) }
      else if (src === 'refund') { fx.floater('energy', e.x, 1.0, e.z, e.amount, false); fly(e, src, Math.max(2, Math.min(5, Math.round(e.amount / 12))), 0.42, 0.7, 0.9) }
      else if (src === 'gate') { fx.floater('energy', e.x, 1.8, e.z, e.amount, false); fly(e, src, 8, 0.5, 1.6, 4.5); fx.ring(e.x, e.z, 0.6, 0.6, 5.0, 0.3, 1.6, 1.3) }
      else {
        if (e.amount >= 3) fx.floater('energy', e.x, 0.9, e.z, e.amount, false)      // 巨畸体 / 精英这种一笔够大的才飘字
        // Boss 在场时击杀掉落不画光点（晶能照样入账、计数器照样跳）：虫都是在 Boss 身边被打死的，
        // 光点从那里升起 3~4 米再飞走，限流到每秒两三颗也总有五六颗亮青光球挂在 Boss 头上（实机 h1，隐藏光点前后对比）
        if (orbBudget >= 1 && !(world && world.boss)) { orbBudget--; fly(e, src, 1, e.amount >= 3 ? 0.42 : 0.3, 0.5, 0) } else fly(e, src, 0, 0, 0.5, 0)
      }
    })
    fx.on('devicePlace', (e) => {
      fx.ring(e.x, e.z, 0.45, 0.5, 3.6, 0.3, 1.6, 1.4); fx.ring(e.x, e.z, 0.3, 2.6, 0.6, 0.3, 1.6, 1.4)
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; fx.emitAdd(e.x + Math.cos(a) * 1.0, 0.1, e.z + Math.sin(a) * 1.0, 0, 2.2 + Math.random() * 1.5, 0, 0.45, 0.16, 0.04, 0.4, 1.8, 1.5, 0, C.STAR, 0, 0.6, 0, a, 4) }
      for (let i = 0; i < 5; i++) fx.emitAlpha(e.x + R() * 1.4, 0.15, e.z + R() * 1.4, R() * 1.5, 0.6, R() * 1.5, 0.7, 0.5, 1.3, 0.12, 0.12, 0.13, 0.35, C.SMOKE_A, 0, 1.4, 0, Math.random() * 6, R())
    })
    // 挨咬：每个装置约 8 条 / 秒，位置就是装置位置 —— 火星溅在朝着虫来的那一面（-z）
    fx.on('deviceHit', (e) => {
      if (e.id != null) { const s = states.get(e.id); if (s) s.hitT = uSim.value }
      if (fx.take('spark')) fx.burst(e.x + R() * 1.2, 0.5 + Math.random() * 0.5, e.z - 0.55, e.kind === 'barricade' ? 5 : 3, 3.5, 0.28, 0.09, 3.0, 1.6, 0.5, { up: 2.5 })
    })
    fx.on('deviceDie', (e) => {
      fx.explosion(e.x, e.z, e.kind === 'barricade' ? 0.8 : 0.62)
      for (let i = 0; i < 9; i++) { const a = Math.random() * TAU, sp = 2.5 + Math.random() * 5; fx.emitAlpha(e.x, 0.5, e.z, Math.cos(a) * sp, 4 + Math.random() * 5, Math.sin(a) * sp, 0.9 + Math.random() * 0.4, 0.26, 0.2, 0.05, 0.055, 0.065, 1, i % 2 ? C.DIRT_A : C.DIRT_B, -15, 0.3, 0, a, R() * 16) }
      for (let i = 0; i < 4; i++) fx.emitAlpha(e.x + R() * 0.6, 0.6, e.z + R() * 0.6, R() * 0.5, 1.4 + Math.random(), 0.3, 2.0 + Math.random(), 0.9, 2.6, 0.035, 0.035, 0.04, 0.55, C.SMOKE_B, 0, 0.7, 0, Math.random() * 6, R())
      const P = e.kind ? poolOf('device.' + e.kind) : null, s = e.id != null ? states.get(e.id) : null
      if (P && dead.length < 24) dead.push({ pool: P, x: e.x, z: e.z, yaw: s ? s.yaw : Math.PI, t0: uSim.value, recall: false })
      if (e.id != null) states.delete(e.id)
    })
    // 玩家铲除：不炸，收回甲板里（一圈往里收的青环 + 上升的光点；返还的晶能另有 energy{source:'refund'}）
    fx.on('deviceRemove', (e) => {
      fx.ring(e.x, e.z, 0.4, 3.2, 0.5, 0.3, 1.6, 1.4); fx.ring(e.x, e.z, 0.55, 2.2, 0.3, 0.2, 1.0, 0.9, 1)
      fx.sparkleUp(e.x, e.z, 10, 0.4, 1.8, 1.5, 0.7)
      for (let i = 0; i < 3; i++) fx.emitAlpha(e.x + R() * 1.0, 0.15, e.z + R() * 1.0, R(), 0.5, R(), 0.6, 0.4, 1.1, 0.12, 0.12, 0.13, 0.3, C.SMOKE_A, 0, 1.4, 0, Math.random() * 6, R())
      const P = e.kind ? poolOf('device.' + e.kind) : null, s = e.id != null ? states.get(e.id) : null
      if (P && dead.length < 24) dead.push({ pool: P, x: e.x, z: e.z, yaw: s ? s.yaw : Math.PI, t0: uSim.value, recall: true })
      if (e.id != null) states.delete(e.id)
    })
    fx.on('placeFail', (e) => { if (Number.isInteger(e.lane) && Number.isInteger(e.row) && e.lane >= 0 && e.lane < 5 && e.row >= 0 && e.row < 4 && fails.length < 6) fails.push({ lane: e.lane, row: e.row, t0: uTime.value }) })
    fx.on('deviceFire', (e) => {
      const s = e.id != null ? states.get(e.id) : null
      if (s) { s.fireT = uSim.value; if (e.tx != null) s.want = Math.atan2(e.tx - e.x, e.tz - e.z) }
      const kind = e.kind || 'sentry'
      if (kind === 'mortarpit') {
        // 炮口焰 + 硝烟；炮弹走一条抛物线，MORTAR_T 秒后落地（爆炸事件在下面推迟同样的时间）
        fx.emitAdd(e.x, 1.4, e.z - 0.3, 0, 2, -1, 0.1, 1.2, 2.2, 3.2, 2.0, 0.8, 0, C.FLARE, 0, 0, 0, Math.random() * 6); fx.emitAlpha(e.x, 1.5, e.z - 0.3, R(), 1.8, -0.8, 1.0, 0.7, 2.0, 0.1, 0.095, 0.09, 0.4, C.SMOKE_B, 0, 1.2, 0, Math.random() * 6, 1)
        fx.flash(e.x, 2, e.z - 0.3, 14, 0.12)
        if (e.tx != null) {
          const G = -170, vy = (0.25 - 1.5) / MORTAR_T - 0.5 * G * MORTAR_T, vx = (e.tx - e.x) / MORTAR_T, vz = (e.tz - (e.z - 0.3)) / MORTAR_T
          for (let i = 0; i < 4; i++) fx.emitAdd(e.x, 1.5, e.z - 0.3, vx, vy, vz, MORTAR_T + i * 0.02, 0.42 - i * 0.07, 0.3 - i * 0.05, 3.6, 2.2 - i * 0.3, 0.7, 0, i ? C.DOT : C.FLARE, G, 0, i ? 1.6 : 0, Math.random() * 6)
          fx.ring(e.tx, e.tz, MORTAR_T, 3.4, 0.5, 2.4, 1.0, 0.2)      // 落点的收缩圈
        }
        return
      }
      if (e.tx == null) return      // 喷火陷阱：没有落点，火焰走 flame 事件（下面）
      const W = fx.WEAPON_FX[kind] || fx.WEAPON_FX.sentry
      const dx = e.tx - e.x, dz = e.tz - e.z, d = Math.hypot(dx, dz) || 1, mx = e.x + dx / d * 0.75, mz = e.z + dz / d * 0.75, my = W.y ?? 1.0
      if (fx.take('tracer')) fx.tracer(mx, my, mz, e.tx, 0.35, e.tz, W.speed || 70, W.len, W.width, W.col[0], W.col[1], W.col[2])
      if (fx.take('muzzle')) fx.muzzle(mx, my, mz, W.muzzle, W.mcol[0], W.mcol[1], W.mcol[2], dx / d, dz / d)
      if (kind === 'cryo') fx.later(d / (W.speed || 46), (x, z) => { fx.emitAdd(x, 0.4, z, 0, 0.4, 0, 0.3, 0.35, 0.8, 0.3, 0.85, 1.35, 0, C.STAR, 0, 0, 0, Math.random() * 6);   /* 命中星芒 1.5 米亮青 → 0.8 米、亮度 ×0.6：冷凝塔集火 Boss 时它身上挂着五六颗青色光球（实机 y5） */ fx.emitAlpha(x, 0.3, z, R(), 0.5, R(), 0.7, 0.5, 1.4, 0.55, 0.7, 0.8, 0.22, C.SMOKE_A, 0, 1.5, 0, Math.random() * 6, R()); if (fx.take('stain')) fx.ring(x, z, 0.35, 0.4, DEVICES.cryo.splash * 2, 0.3, 0.9, 1.6) }, e.tx, e.tz)
    })
    // 迫击炮台的爆炸：模拟里开火即结算，表现上等炮弹飞到（默认的 explosion 表现自带 0.13 秒延迟，这里补足到 MORTAR_T）
    const baseExplosion = fx.handler('explosion')
    fx.on('explosion', (e, f, w) => { if (!baseExplosion) return; if (e.kind === 'mortarpit') fx.later(MORTAR_T - 0.13, () => baseExplosion(e, f, w)); else baseExplosion(e, f, w) })
    // 喷火陷阱：flame{unit: 'd' + id, dir: π, arc: 2.6, range: 1.9} —— 烧的是它所在这一排的 3 × 1 格，
    // 所以画成从装置往左右各喷一道贴地火舌 + 一排里零星的火苗（地上的火带由 groundview 按 fireT 画）
    const baseFlame = fx.handler('flame')
    fx.on('flame', (e, f, w) => {
      if (typeof e.unit !== 'string' || e.unit[0] !== 'd') { if (baseFlame) baseFlame(e, f, w); return }
      const s = states.get(+e.unit.slice(1)); if (s) s.fireT = uSim.value
      const reach = LANES.width * 1.42
      let x0 = e.x, x1 = e.x
      for (const sg of [-1, 1]) {
        if (Math.abs(e.x + sg * LANES.width) > 6.0) continue          // 贴边的那一侧没有车道：不往桥外喷
        fx.flameCone(e.unit + (sg > 0 ? 'R' : 'L'), e.x + sg * 0.5, e.z, sg * Math.PI / 2, reach, 1.7, 0.45, 0.32)
        if (sg > 0) x1 = e.x + LANES.width * 1.5; else x0 = e.x - LANES.width * 1.5
      }
      fx.flameCone(e.unit + 'F', e.x, e.z + 0.35, Math.PI, 1.7, 1.5, 0.45, 0.3)
      if (fx.take('spark')) for (let i = 0; i < 2; i++) fx.flamePuff(x0 + Math.random() * (x1 - x0), 0.25 + Math.random() * 0.2, e.z + R() * LANES.depth * 0.9, R() * 1.5, -1 - Math.random())
      if (fx.take('stain') && Math.random() < 0.3) fx.stain(x0 + Math.random() * (x1 - x0), e.z + R() * LANES.depth * 0.8, 7, 0.6, 1.5, Math.random() * 6, 0.05, 0.028, 0.018, 0.5, C.SCORCH, 6)
    })
    fx.on('mineArm', (e) => { fx.ring(e.x, e.z, 0.45, 0.3, DEVICES.mine.trigger * 2, 3.0, 0.4, 0.15); fx.emitAdd(e.x, 0.35, e.z, 0, 0, 0, 0.2, 0.5, 1.2, 3.0, 0.4, 0.2, 0, C.FLARE) })
    // 地雷引爆：伤害另有 explosion{kind:'mine'}（默认表现会画一团爆炸），这里补和它半径对得上的冲击环、破片和闪光
    fx.on('mineBlast', (e) => {
      const r = e.r || DEVICES.mine.r
      fx.ring(e.x, e.z, 0.32, 0.6, r * 2, 3.2, 1.2, 0.3); fx.ring(e.x, e.z, 0.7, r * 1.2, r * 1.7, 1.2, 0.35, 0.08, 1)
      fx.flash(e.x, 1.5, e.z, 70, 0.3); fx.shake(0.12); fx.dirtBurst(e.x, e.z, 1.2)
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + R(), sp = 7 + Math.random() * 7; fx.emitAdd(e.x, 0.3, e.z, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp, 0.35 + Math.random() * 0.3, 0.13, 0.04, 3.4, 1.8, 0.5, 1, C.DOT, -16, 0.7, 1.8) }
    })
    // 聚变炸弹：e.w × e.d 是炸到的矩形（3 × 3 格）。紧跟的 hitstop / shake 由宿主和默认表现处理
    fx.on('novaBlast', (e) => {
      const hw = (e.w || LANES.width * 3) / 2, hd = (e.d || LANES.depth * 3) / 2
      fx.screenFlash(0.45); fx.shake(0.34); fx.shock(e.x, 1, e.z, 1.0, 11, 0.8)
      fx.emitAdd(e.x, 1.5, e.z, 0, 0, 0, 0.16, 5, 17, 3.4, 3.0, 2.2, 0, C.DOT); fx.emitAdd(e.x, 1.5, e.z, 0, 0, 0, 0.5, 6, 20, 3.2, 1.6, 0.4, 0, C.FLARE)
      fx.explosion(e.x, e.z, 2.4)
      let k = 0
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) { if (!ix && !iz) continue; const x = e.x + ix * hw * 0.66, z = e.z + iz * hd * 0.66; if (Math.abs(x) > 6.6) continue; fx.later(0.05 + (k++ % 3) * 0.05, (xx, zz) => fx.explosion(xx, zz, 1.1), x, z) }
      fx.ring(e.x, e.z, 0.7, 2, 14, 2.0, 1.1, 0.35); fx.ring(e.x, e.z, 1.1, 1, 10, 1.8, 0.6, 0.18); fx.ring(e.x, e.z, 2.2, 7, 9, 1.6, 0.5, 0.1, 1)
      for (let i = 0; i < 10; i++) fx.emitAlpha(e.x + R() * hw, 1.5 + Math.random() * 2, e.z + R() * hd, R() * 1.5, 3.5 + Math.random() * 3, R() * 1.5, 2.6 + Math.random(), 2.2, 6.5, 0.04, 0.036, 0.04, 0.6, C.SMOKE_A + (i % 3), 0, 0.8, 0, Math.random() * 6, R())
      fx.flash(e.x, 3, e.z, 220, 0.6, 0xffb060)
    })
    const baseFence = fx.handler('fence')
    fx.on('fence', (e, f, w) => {
      const lane = e.lane | 0, x = e.x ?? LANES.centers[lane]
      fenceFlash[lane] = uSim.value
      if (baseFence) baseFence(e, f, w)
      fx.screenFlash(0.12); fx.shock(x, 0.6, FENCE_Z, 0.9, 5, 0.4)
      for (const px of [x - LANES.width / 2, x + LANES.width / 2]) for (let i = 0; i < 8; i++) fx.emitAdd(px, 0.6 + Math.random() * 0.5, FENCE_Z, R() * 5, 2 + Math.random() * 5, R() * 5, 0.4 + Math.random() * 0.3, 0.12, 0.03, 0.8, 2.2, 3.2, 0.4, C.DOT, -12, 0.6, 1.5)
      for (let z = FENCE_Z; z > -21; z -= 1.6) fx.later((FENCE_Z - z) * 0.006, (xx, zz) => { fx.emitAdd(xx + R() * 2.2, 0.3, zz, 0, 3 + Math.random() * 2, 0, 0.3, 0.5, 1.2, 0.5, 1.6, 3.0, 0, C.STAR, 0, 0, 0, Math.random() * 6) }, x, z)
    })
    // 无尽每 5 层把用掉的电网补满：那几道重新通电（电幕由暗转亮是 update 里的渐变，这里补一下「上电」的闪光）
    fx.on('fenceRefill', (e) => {
      for (const lane of e.lanes || []) {
        const x = LANES.centers[lane]; if (x == null) continue
        fenceFlash[lane] = uSim.value - 0.2
        fx.ring(x, FENCE_Z, 0.6, 0.4, 4.2, 0.4, 1.5, 2.8); fx.sparkleUp(x, FENCE_Z, 8, 0.5, 1.7, 3.0, 1.1)
        fx.beam(x - LANES.width / 2, 0.6, FENCE_Z, x + LANES.width / 2, 0.6, FENCE_Z, 0.35, 0.4, 0.6, 1.8, 3.2, 1)
      }
    })
  }

  const put = (P, n, x, y, z, yaw, scale, frame, bright, flash, seed, glow) => { P.inst.put(n, x, y, z, yaw, scale, frame, bright, flash, seed, 0, 0, glow) }
  const smoke = (s, d, dt, ratio) => {
    if (!fx || dt <= 0) return
    s.smoke += dt * (ratio < 0.25 ? 9 : 4.5)
    while (s.smoke >= 1) {
      s.smoke -= 1
      const C = fx.CELL, R = () => Math.random() - 0.5
      fx.emitAlpha(d.x + R() * 0.6, 0.9 + Math.random() * 0.4, d.z + R() * 0.6, 0.5 + R() * 0.5, 1.5 + Math.random(), 0.3, 1.4 + Math.random() * 0.8, 0.5, 2.0, 0.17, 0.165, 0.17, 0.5, C.SMOKE_A + ((Math.random() * 3) | 0), 0, 0.7, 0, Math.random() * 6, R() * 1.5)
      if (Math.random() < (ratio < 0.25 ? 0.5 : 0.18)) { fx.emitAdd(d.x + R() * 0.5, 0.8, d.z + R() * 0.5, R() * 2, 2 + Math.random() * 2, R() * 2, 0.35, 0.1, 0.03, 3.2, 1.6, 0.4, 1, C.DOT, -9, 0.5, 1.3); fx.emitAdd(d.x + R() * 0.4, 0.75, d.z + R() * 0.4, 0, 0.8, 0, 0.3, 0.4, 0.9, 2.4, 0.9, 0.15, 1.5, C.FIRE, 0, 1, 0, Math.random() * 6) }
    }
  }
  // 布防预览里「这个装置打得到 / 炸得到哪儿」的范围提示（数字取 data/devices.js，和模拟同一份）
  const rangeOf = (kind, l, r) => {
    const x = LANES.centers[l], z = LANES.rows[r], D = DEVICES[kind], hw = LANES.width / 2 - 0.08
    if (!D) return
    const clampX = (cx, half) => { const a = Math.max(-6.4, cx - half), b = Math.min(6.4, cx + half); return [(a + b) / 2, (b - a) / 2 - 0.08] }
    if (kind === 'sentry' || kind === 'cryo') { const z1 = z - 0.9, z0 = -21; putCell(x, (z0 + z1) / 2, hw, (z1 - z0) / 2, 4) }
    else if (kind === 'mortarpit') { const z1 = z - D.minRange, z0 = -21; putCell(x, (z0 + z1) / 2, hw, (z1 - z0) / 2, 4) }
    else if (kind === 'scorcher') { const [cx, half] = clampX(x, LANES.width * (0.5 + D.side)); putCell(cx, z, half, LANES.depth / 2 - 0.08, 4) }
    else if (kind === 'nova') { const [cx, half] = clampX(x, LANES.width * (0.5 + D.side)); putCell(cx, z, half, LANES.depth * (0.5 + D.rows) - 0.08, 4) }
    else if (kind === 'mine') { putCell(x, z, D.r, D.r, 4, 1, 1); putCell(x, z, D.trigger, D.trigger, 4, 0.7, 1) }
  }

  return {
    pools, attach, hooks,
    /** 预建实例池（着色器随启动一起编译，第一次放装置时不卡）。ok(逻辑名) 返回 false 的跳过 */
    prewarm(ok, names) { for (const n of names) if (n.startsWith('device.') && ok(n)) poolOf(n) },
    /**
     * 布防预览。两种写法都认：
     *   setPlacement({ kind, lane, row, valid }) —— valid === false = UI 说放不了（买不起 / 冷却中 / 没解锁）；格子被占这里自己会判，不用 UI 管
     *   setPlacement(kind, lane, row, valid)
     * kind 为空 / 传 null 退出；lane / row 为 null 时只亮格子不画虚影
     */
    setPlacement(a, lane = null, row = null, valid) {
      if (a && typeof a === 'object') place = a.kind ? { kind: a.kind, lane: a.lane ?? null, row: a.row ?? null, valid: a.valid } : null
      else place = a ? { kind: a, lane, row, valid } : null
    },
    get placement() { return place },
    /** 平时常亮的 5×4 格角标（默认开）。菜单摆拍世界 / 截图不想要可以关 */
    setLandmarks(on) { landmarks = on === 'force' },   // 平时一律不画格子地标（main.js 开局传 true 也不画）；真想要常驻角标传 'force'
    setEnergyTarget(x, y) { target = x == null ? null : { x, y } },
    /** 晶能计数器的位置（CSS 像素）：没设过就是默认的画面左下 */
    energyAnchor() { return targetCss() },
    reset() { states.clear(); dead.length = 0; fails.length = 0; arrivals.length = 0; firstFrame = true; fenceFlash.fill(-9); for (let i = 3; i < oA.length; i += 4) oA[i] = -1e6; orbDirty = true; for (const p of pools.values()) if (p) p.inst.commit(0); barGeo.instanceCount = 0 },
    consume() {},
    update(world, time, realTime) {
      const dt = Math.max(0, Math.min(0.1, time - lastTime)); lastTime = time
      uTime.value = realTime; uSim.value = time
      orbBudget = Math.min(6, orbBudget + 0.5)
      for (let i = arrivals.length - 1; i >= 0; i--) if (arrivals[i].t <= time || arrivals[i].t > time + 5) { const a = arrivals[i]; arrivals.splice(i, 1); if (hooks.onEnergyArrive) hooks.onEnergyArrive({ amount: a.amount, source: a.source }) }
      for (const p of pools.values()) if (p) p.n = 0
      const devices = world.devices || []
      const occ = new Set()
      nb = 0
      for (const d of devices) {
        if (d.alive === false) continue
        if (d.lane != null) occ.add(d.lane * 8 + d.row)
        const P = poolOf('device.' + d.kind); if (!P || P.n >= P.inst.capacity) continue
        const s = stateOf(d.id, time), inst = P.inst, n = P.n++
        if (d.fireT != null && d.fireT > s.fireT) { s.fireT = d.fireT; if (d.aimX != null) s.want = Math.atan2(d.aimX - d.x, d.aimZ - d.z) }
        // 受击节奏只跟 deviceHit 事件走（约 8 条 / 秒）：world 里的 d.hitT 在被围着啃的时候每一步都在刷新，拿它当闪光的起点就是常亮
        const sf = time - s.fireT, sh = time - s.hitT
        const aims = P.meta && P.meta.aim
        if (aims) { if (sf > 1.6) s.want = Math.PI; s.yaw += angDiff(s.want, s.yaw) * Math.min(1, dt * (sf > 1.6 ? 3 : 16)) }
        const sd = (P.meta && P.meta.shootDur) || 0.25, shoot = P.clip('shoot')
        const t0 = d.t0 ?? s.bornT
        let frame, glow = 1
        if (d.kind === 'mine') {
          // 武装前：琥珀灯慢闪、探针收着，越接近武装闪得越快；武装后：红灯 + 探针弹出
          const armed = d.armed != null ? !!d.armed : (d.armedT == null || time >= d.armedT)
          const k = armed || d.armedT == null ? 1 : Math.max(0, Math.min(1, 1 - (d.armedT - time) / DEVICES.mine.arm))
          frame = armed ? inst.frameAt(P.clipOr('armed', 'idle'), time + d.id * 0.37) : inst.frameAt(P.clipOr('idle', 'idle'), time * (1 + 2.2 * k * k) + d.id * 0.37)
          glow = armed ? 1.3 : 0.55 + 0.45 * k
        } else if (d.kind === 'nova') {
          // 倒计时：armedT = 爆炸时刻。clip 本身就是「越转越快、核心越胀越大」，亮度脉动跟着加速
          let u = d.armedT != null ? 1 - (d.armedT - time) / NOVA_FUSE : (time - t0) / NOVA_FUSE
          if (u > 1) u = 0.72 + ((u - 1) * 0.45) % 0.28
          u = Math.max(0, u)
          frame = inst.frame(P.clipOr('idle', 'idle'), u); glow = 0.8 + (0.9 + 0.8 * u) * Math.abs(Math.sin(realTime * (5 + 22 * Math.min(1, u))))
        } else if (d.kind === 'barricade' && shoot && sh >= 0 && sh < sd) { frame = inst.frame(shoot, sh / sd) }           // 路障没有开火：shoot clip 是「被啃得往后一震」
        else if (shoot && sf >= 0 && sf < sd) frame = P.asset.clips[shoot].loop ? inst.frameAt(shoot, sf) : inst.frame(shoot, sf / sd)
        else if (aims && sf < 1.6 && P.clip('aim')) frame = inst.frameAt(P.clip('aim'), 0)
        else frame = inst.frameAt(P.clipOr('idle', 'idle'), time + d.id * 0.37)
        if (d.kind === 'collector') { const sp = Math.min(sf, time - s.pulseT); if (sp >= 0 && sp < 0.5) { if (shoot) frame = inst.frame(shoot, sp / 0.5); glow = 1.8 } }   // 产出：晶体鼓一下、亮一下
        if (d.kind === 'scorcher') glow = sf < 0.4 ? 1.6 : 0.7 + 0.25 * Math.sin(realTime * 9 + d.id)
        const built = Math.min(1, Math.max(0, (time - t0) * 4.5)), eb = built * built * (3 - 2 * built)
        const ratio = d.hpMax > 0 ? Math.max(0, d.hp / d.hpMax) : 1
        const flash = sh >= 0 && sh < 0.1 ? -(1 - sh / 0.1) * 0.2 : (sf >= 0 && sf < 0.05 && shoot ? 0.5 : (built < 1 ? 0.6 * (1 - built) : 0))
        // 受击闪红压得很低、很短：给满的话被围着啃的路障就是一块红砖（受损程度看血条和冒烟）
        put(P, n, d.x, (eb - 1) * 0.9, d.z, s.yaw, P.scale * (0.85 + 0.15 * eb), frame, ratio < 0.5 ? 0.78 : 1, flash, (d.id * 0.61) % 1, glow)
        if (ratio < 0.5 && d.hpMax > 0) { inst.tint(n, 0.05, 0.04, 0.035, ratio < 0.25 ? 0.5 : 0.28); smoke(s, d, dt, ratio) } else inst.tint(n, 0, 0, 0, 0)
        if (d.hpMax > 0 && ratio < 0.995 && nb < BAR_CAP) { const o = nb++ * 4; bA[o] = d.x; bA[o + 1] = d.kind === 'barricade' ? 1.55 : 2.2; bA[o + 2] = d.z; bA[o + 3] = ratio }
      }
      barGeo.instanceCount = nb; if (nb) bAA.needsUpdate = true
      // 老猫的雷区（world.zones 里 type === 'mine'）：每颗雷画成一颗地雷模型，布下约 1 秒后武装
      const zones = world.zones
      if (zones) for (const zn of zones) {
        if (zn.type !== 'mine') continue
        const P = poolOf('device.mine'); if (!P || P.n >= P.inst.capacity) break
        const n = P.n++, age = time - zn.t0, armed = zn.armT != null ? time >= zn.armT : age > 1.0
        put(P, n, zn.x, Math.max(0, 0.6 - age * 3) * 3, zn.z, zn.id * 1.7, P.scale * 0.9, P.inst.frameAt(P.clipOr(armed ? 'armed' : 'idle', 'idle'), time + zn.id * 0.31), 1, age < 0.3 ? 0.5 : 0, (zn.id * 0.37) % 1, armed ? 1.3 : 0.9)
        P.inst.tint(n, 0, 0, 0, 0)
      }
      // 残骸（被毁：垮下去变黑下沉）/ 收回（铲除：缩小沉进甲板，带一层青色）
      for (let i = dead.length - 1; i >= 0; i--) {
        const c = dead[i], P = c.pool, td = time - c.t0, life = c.recall ? 0.45 : 0.9
        if (td > life || td < 0 || P.n >= P.inst.capacity) { dead.splice(i, 1); continue }
        const n = P.n++
        if (c.recall) {
          const k = td / life, e = k * k
          put(P, n, c.x, -e * 1.3, c.z, c.yaw + k * 1.2, P.scale * (1 - 0.35 * e), P.inst.frameAt(P.clipOr('idle', 'idle'), 0), 1, 0.4 * (1 - k), 0, 0.4)
          P.inst.tint(n, 0.2, 1.0, 0.85, 0.35 + 0.4 * k)
        } else {
          const die = P.clip('die')
          put(P, n, c.x, -td * 0.35, c.z, c.yaw, P.scale, die ? P.inst.frame(die, Math.min(1, td / 0.4)) : 0, 0.5, td < 0.12 ? 1 : 0, 0, 0)
          P.inst.tint(n, 0.02, 0.02, 0.02, 0.7)
        }
      }
      for (const p of pools.values()) if (p) p.inst.commit(p.n)
      if (states.size > devices.length + 32) { const live = new Set(devices.map((d) => d.id)); for (const k of states.keys()) if (!live.has(k)) states.delete(k) }

      // 应急电网：world.fences[l] = true（可用）/ false（已用掉）；mock 的 { ready } 也认
      const F = world.fences
      fence.visible = !!F
      if (F) {
        for (let l = 0; l < 5; l++) {
          const f = F[l], ready = f === true || !!(f && f.ready)
          fenceOn[l] += ((ready ? 1 : 0) - fenceOn[l]) * Math.min(1, (realTime - lastReal) * (ready ? 3 : 10) + 0.02)
          const fl = Math.max(0, 1 - (time - fenceFlash[l]) / 0.45)
          const o = l * 4; cA[o] = LANES.centers[l]; cA[o + 1] = fenceOn[l]; cA[o + 2] = fl * fl; cA[o + 3] = LANES.width / 2 - 0.2
        }
        cAttr.needsUpdate = true
        for (let i = 0; i < 6; i++) for (let side = 0; side < 2; side++) {
          const l = side === 0 ? i - 1 : i
          if (l < 0 || l > 4) capCol.setRGB(0.02, 0.025, 0.03)
          else { const k = fenceOn[l], fl = Math.max(0, 1 - (time - fenceFlash[l]) / 0.45); capCol.setRGB(0.5 * k + 1.1 * (1 - k) * (0.5 + 0.5 * Math.sin(realTime * 2.2)) + fl * 3, 2.0 * k + 0.1 * (1 - k) + fl * 3, 3.0 * k + 0.06 * (1 - k) + fl * 3) }
          caps.setColorAt(i * 2 + side, capCol)
        }
        caps.instanceColor.needsUpdate = true
      }
      const dtReal = Math.max(0, Math.min(0.1, realTime - lastReal))
      lastReal = realTime

      // 格子：平时是很淡的 5×4 角标（地标）；进了布防模式换成「空格青 / 占用红 / 选中加亮」+ 作用范围 + 全息虚影
      nc = 0
      for (const g of ghosts.values()) if (g) g.visible = false
      const hasGrid = !!(world.grid && world.grid.cells)
      const taken = (l, r) => occ.has(l * 8 + r) || !!(hasGrid && world.grid.cells[l] && world.grid.cells[l][r])
      landAmt += ((landmarks && hasGrid && !place ? 1 : 0) - landAmt) * Math.min(1, dtReal * 6 + 0.02)
      placeAmt = place ? Math.min(1, placeAmt + dtReal * 5 + 0.01) : 0
      const chw = LANES.width / 2 - 0.06, chd = LANES.depth / 2 - 0.06
      if (place) {
        for (let l = 0; l < 5; l++) for (let r = 0; r < 4; r++) {
          const tk = taken(l, r), sel = place.lane === l && place.row === r
          const ok = !tk && (!sel || place.valid !== false)      // 被占的格子一定放不下；valid === false 是 UI 说的「买不起 / 冷却中 / 没解锁」
          putCell(LANES.centers[l], LANES.rows[r], chw, chd, sel ? (ok ? 2 : 3) : (tk ? 1 : 0), placeAmt)
          if (sel) {
            const g = ghostOf(place.kind)
            if (g) { g.visible = true; g.position.set(LANES.centers[l], 0.04 + 0.03 * Math.sin(realTime * 3), LANES.rows[r]); ghostMat.uniforms.uCol.value.setRGB(...(ok ? OK_COL : BAD_COL)) }
            if (ok) rangeOf(place.kind, l, r)
          }
        }
      } else if (landAmt > 0.02) {
        for (let l = 0; l < 5; l++) for (let r = 0; r < 4; r++) if (!taken(l, r)) putCell(LANES.centers[l], LANES.rows[r], chw, chd, 5, landAmt)
      }
      for (let i = fails.length - 1; i >= 0; i--) {
        const f = fails[i], k = (realTime - f.t0) / 0.4
        if (k >= 1 || k < 0) { fails.splice(i, 1); continue }
        putCell(LANES.centers[f.lane], LANES.rows[f.row], chw, chd, 6, (1 - k) * (0.6 + 0.4 * Math.abs(Math.sin(k * 9))))
      }
      if (nc) { cPA.needsUpdate = true; cSA.needsUpdate = true }
      cellGeo.instanceCount = nc
      updateTarget()
      if (orbDirty) { oAA.needsUpdate = oBA.needsUpdate = true; orbDirty = false }
      firstFrame = false
    },
    /** 采集器产出时让晶体闪一下（gateview 把 energy 事件转过来；真模拟里采集器的 fireT 也会触发同样的表现） */
    notePulse(world, e, time) { const ds = world && world.devices; if (!ds || !(e.source ? e.source === 'collector' : e.amount >= 5)) return; for (const d of ds) if (d.kind === 'collector' && Math.abs(d.x - e.x) < 0.6 && Math.abs(d.z - e.z) < 0.6) { const s = states.get(d.id); if (s) s.pulseT = time } },
  }
}
