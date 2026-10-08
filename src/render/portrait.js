// portrait.js —— 离屏渲染单位头像（view.renderPortrait）。UI 没有立绘素材：指挥官、各兵种、各装置、各敌人的头像都从这里出。
// 做法：借主场景的灯光和环境贴图（颜色和战场里一致），把别的东西临时藏起来，只留一个实例摆在高空，
//       用一台单独的相机渲染到浮点离屏目标（2 倍超采样），CPU 上做 ACES + sRGB（离屏目标不走后处理链），缩到目标尺寸后导出 PNG。
// 耗时见 docs/RENDER.md §9；同参数有缓存。启动时用 loadMany 批量生成（每张之间让出一帧）。
import * as THREE from 'three'
import { createPool, loadAsset, has, REGISTRY } from './assets.js'

const ORIGIN_Y = 400          // 摆在高空：不在阴影图范围里（不会被战场上的东西投影），点光源也照不到
const PREFIXES = ['unit.', 'device.', 'enemy.', 'boss.', 'companion.', 'summon.', 'prop.']
const ALIAS = {
  'commander.hawk': 'unit.hero_hawk', 'commander.ysera': 'unit.hero_ysera', 'commander.joe': 'unit.hero_joe',
  hawk: 'unit.hero_hawk', ysera: 'unit.hero_ysera', joe: 'unit.hero_joe', seven: 'companion.scout', companion: 'companion.scout', pod: 'prop.pod',
}

// 指挥官带着旗 / 头冠，包围盒比身体高出一截：半身像的「身高」按同一副骨架的普通兵来估（高度 × 两者的 scale 之比）
const BODY_REF = { 'unit.hero_hawk': 'unit.rifle', 'unit.hero_ysera': 'unit.psion' }

/** 把「逻辑名 / 别名 / 不带前缀的 kind」解析成注册表里的名字；找不到返回 null */
export function resolvePortraitName(name) {
  if (!name) return null
  if (has(name)) return name
  if (ALIAS[name] && has(ALIAS[name])) return ALIAS[name]
  const m = /^commander\.(\w+)$/.exec(name)
  if (m && has('unit.hero_' + m[1])) return 'unit.hero_' + m[1]
  if (!name.includes('.')) for (const p of PREFIXES) if (has(p + name)) return p + name
  return null
}

// three 的 ACESFilmicToneMapping（同一组矩阵）+ sRGB OETF
function aces(r, g, b, out) {
  const k = 1 / 0.6
  r *= k; g *= k; b *= k
  let x = 0.59719 * r + 0.35458 * g + 0.04823 * b, y = 0.07600 * r + 0.90834 * g + 0.01566 * b, z = 0.02840 * r + 0.13383 * g + 0.83777 * b
  const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081)
  x = fit(x); y = fit(y); z = fit(z)
  out[0] = 1.60475 * x - 0.53108 * y - 0.07367 * z; out[1] = -0.10208 * x + 1.10813 * y - 0.00605 * z; out[2] = -0.00327 * x - 0.07276 * y + 1.07602 * z
}
const srgb = (v) => { v = v < 0 ? 0 : v > 1 ? 1 : v; return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055 }

const nextSlice = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r() } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 100) })
export function createPortraits(ctx, renderer) {
  const scene = ctx.scene
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 200)
  const pools = new Map()      // 注册名 -> pool（只留实例网格，不要脚下暗斑）
  const cache = new Map()      // 参数 -> dataURL
  let rt = null, buf = null, work = null, out = null
  const tmp = [0, 0, 0], clear = new THREE.Color()

  const poolOf = (name) => {
    let P = pools.get(name)
    if (P) return P
    P = createPool(name, ctx, 1, { noHook: true })     // 出图池自己管编译（见 compiled）
    if (!P) return null
    for (const o of P.objs) { if (o !== P.inst.mesh) scene.remove(o); else o.visible = false }
    P.inst.mesh.frustumCulled = false
    pools.set(name, P)
    return P
  }

  // 出图用的实例池是单独建的一份材质：第一次画它时着色器要同步现编（一张头像 50~100ms）。
  // 异步出图（load）时先把它交给驱动并行编译，编好了再画。编译键跟着当前渲染目标走：用场景的离屏目标（不做色调映射，和出图的浮点目标一致）
  function compiled(name) {
    const P = poolOf(name)
    if (!P) return null
    if (!P.compiled) {
      const prev = renderer.getRenderTarget()
      renderer.setRenderTarget(ctx.compileTarget || null)
      try { P.compiled = renderer.compileAsync(P.inst.mesh, cam, scene).catch(() => {}) } finally { renderer.setRenderTarget(prev) }
      // 贴图一步一张先传好，程序的「第一次使用」也提前做掉
      if (ctx.run && ctx.uploadSteps) P.compiled = P.compiled.then(() => ctx.run((function* () { yield* ctx.firstUseSteps([P.inst.mesh]); yield* ctx.uploadSteps([P.inst.mesh]) })(), { est: 4, name: 'portrait prep ' + name })).catch(() => {})
    }
    return P.compiled
  }
  /** 同步出图（dataURL） */
  function render(logical, size = 160, o = {}) { const it = renderGen(logical, size, o, false); for (;;) { const r = it.next(); if (r.done) return r.value } }
  /**
   * 出图的分步版：async = true 时在「画完 → 读回像素」之间、色调映射的每一小段之间 yield（调用方在 yield 处让出一帧），
   * 最后用 toBlob 在后台编码 PNG（返回 Promise<blob URL>）。一张头像原来整块 30~60ms（读回像素要等显卡画完 + 8 万像素的 ACES + PNG 编码），
   * 拆开以后每段几毫秒
   */
  function* renderGen(logical, size = 160, o = {}, async = false) {
    const name = resolvePortraitName(logical)
    if (!name) { console.info(`[portrait] "${logical}" 没有对应的注册项`); return null }
    size = Math.max(16, Math.min(1024, Math.round(size || 160)))
    const key = name + '|' + size + '|' + JSON.stringify(o)
    if (cache.has(key)) { const v = cache.get(key); if (async || !(v && v.then)) return v }   // 同步要图时碰上正在后台编码的：当场再出一张
    const P = poolOf(name)
    if (!P) return null                                   // glb 还没加载完：createPool 已经触发了加载，稍后再要
    const prefix = name.slice(0, name.indexOf('.'))
    // ---- 取景 ----
    const b = P.asset.bounds, sc = P.scale
    const w = (b.max.x - b.min.x) * sc, l = (b.max.z - b.min.z) * sc
    let h = Math.max(0.2, b.max.y * sc)
    const ref = BODY_REF[name] && !P.def.ai && poolOf(BODY_REF[name])    // AI 模型的指挥官没有旗杆 / 高头冠，包围盒就是身体
    o = { ...(P.def.portrait || {}), ...o }
    const bust = o.bust ?? (!!ref || (prefix === 'unit' && h < 2.5 && w < 1.7 && l < 1.9))     // 步兵体型的出半身像；载具 / 机甲 / 虫 / 装置出全身
    let cy, viewH, pitch, angle
    if (bust) {
      if (ref) h = ref.asset.bounds.max.y * sc
      cy = h * 0.7; viewH = h * 0.88; pitch = o.pitch ?? 0.08; angle = o.angle ?? 0.45          // 腰以上：头顶留一点空，肩甲不出画
    }
    else {
      cy = (Math.max(0, b.min.y) + b.max.y) * sc * 0.5
      viewH = Math.max(h, Math.hypot(w, l) * 0.82) * 1.12
      pitch = o.pitch ?? (prefix === 'device' ? 0.5 : prefix === 'boss' ? 0.16 : 0.3); angle = o.angle ?? 0.62
    }
    viewH /= o.zoom || 1
    const dist = viewH / 2 / Math.tan(cam.fov * Math.PI / 360)
    const cx = bust ? 0 : (b.min.x + b.max.x) * sc * 0.5, cz = bust ? (o.cz || 0) * sc : (b.min.z + b.max.z) * sc * 0.5   // o.cz：半身像的取景中心往前 / 后挪（AI 模型按包围盒居中，端着的枪把身体挤到了后面）
    cam.position.set(cx + Math.sin(angle) * Math.cos(pitch) * dist, ORIGIN_Y + cy + Math.sin(pitch) * dist, cz + Math.cos(angle) * Math.cos(pitch) * dist)
    cam.lookAt(cx, ORIGIN_Y + cy, cz)
    cam.near = Math.max(0.05, dist - Math.hypot(w, h, l) * 1.5); cam.far = dist + Math.hypot(w, h, l) * 2; cam.updateProjectionMatrix(); cam.updateMatrixWorld()
    // ---- 摆实例 ----
    const clip = (o.clip && P.clip(o.clip)) || P.clipOr(prefix === 'enemy' || prefix === 'boss' ? 'walk' : 'idle', 'walk')
    const inst = P.inst
    inst.put(0, 0, ORIGIN_Y, 0, 0, sc, inst.frame(clip, o.u ?? (prefix === 'device' ? 0 : 0.18)), 1, 0, 0.37, 0, 0, 1)
    inst.tint(0, 0, 0, 0, 0); inst.commit(1)
    // ---- 渲染：别的网格先藏起来 ----
    const S = Math.min(2048, size * 2)
    if (!rt || rt.width !== S) { if (rt) rt.dispose(); rt = new THREE.WebGLRenderTarget(S, S, { type: THREE.FloatType, depthBuffer: true }); buf = new Float32Array(S * S * 4); work = document.createElement('canvas'); work.width = work.height = S }
    const hidden = []
    scene.traverse((ob) => { if (ob.visible && ob !== inst.mesh && (ob.isMesh || ob.isPoints || ob.isLine || ob.isSprite)) { ob.visible = false; hidden.push(ob) } })
    const bg = scene.background, fog = scene.fog, prevRT = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha(), autoShadow = renderer.shadowMap.autoUpdate
    renderer.getClearColor(clear)
    inst.mesh.visible = true
    // 雾不摘掉（摘掉 = 换一套不带雾的着色器变体，每个模型第一次出图都要现编译 70~100 ms），只把浓度临时调成 0
    const fogSave = fog ? (fog.isFogExp2 ? fog.density : [fog.near, fog.far]) : null
    if (fog) { if (fog.isFogExp2) fog.density = 0; else { fog.near = 1e5; fog.far = 1e6 } }
    scene.background = null; renderer.shadowMap.autoUpdate = false
    let ok = true
    try {
      renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear()
      renderer.render(scene, cam)
      if (!async) renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf)
    } catch (e) { ok = false; console.warn('[portrait] 渲染失败：', e && e.message) }
    inst.mesh.visible = false; inst.commit(0)
    for (const ob of hidden) ob.visible = true
    if (fog) { if (fog.isFogExp2) fog.density = fogSave; else { fog.near = fogSave[0]; fog.far = fogSave[1] } }
    scene.background = bg; renderer.shadowMap.autoUpdate = autoShadow
    renderer.setRenderTarget(prevRT); renderer.setClearColor(clear, prevAlpha)
    if (!ok) return null
    const g2 = work.getContext('2d'), img = g2.createImageData(S, S), px = img.data, ex = o.exposure ?? 1.05
    if (async) {
      // 异步出图：色调映射 + sRGB + 上下翻转放到显卡上做（一个全屏小着色器，画进 8 位目标），再经显存缓冲（PBO）+ 栅栏异步读回 8 位像素。
      // 原来是读回浮点像素（Windows 的 ANGLE 上第一次要 40~50ms）再在 CPU 上逐像素做 ACES（8 万像素，十几毫秒）
      yield
      const gl = renderer.getContext()
      let pbo = null, sync = null
      try {
        tonemapTo(S, ex)
        pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, px.byteLength, gl.STREAM_READ)
        gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, 0)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
        sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush()
      } catch (e) { sync = null } finally { renderer.setRenderTarget(prevRT) }
      if (!sync) { if (pbo) gl.deleteBuffer(pbo); return null }
      for (let k = 0; k < 120 && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED; k++) yield
      for (let k = 0; k < 600; k++) { const idle = ctx.gpuIdle && ctx.gpuIdle(); if (!idle) break; yield idle }   // 驱动正忙着编着色器：等它编完再读回（见 renderer.js ctx.gpuIdle）
      gl.deleteSync(sync)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      gl.deleteBuffer(pbo)
      yield
    }
    // ---- 色调映射 + sRGB，翻转 Y，缩到目标尺寸（同步出图走 CPU；异步的上面已经在显卡上做完了）----
    if (!async) for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4, dst = y * S * 4
      for (let x = 0; x < S; x++) {
        const i = src + x * 4, j = dst + x * 4, a = buf[i + 3]
        if (!(a > 0)) { px[j + 3] = 0; continue }
        const r = buf[i], g = buf[i + 1], bl = buf[i + 2]
        aces((r > 0 ? r : 0) * ex, (g > 0 ? g : 0) * ex, (bl > 0 ? bl : 0) * ex, tmp)
        px[j] = srgb(tmp[0]) * 255; px[j + 1] = srgb(tmp[1]) * 255; px[j + 2] = srgb(tmp[2]) * 255; px[j + 3] = (a > 1 ? 1 : a) * 255
      }
    }
    g2.putImageData(img, 0, 0)
    if (!out) out = document.createElement('canvas')
    out.width = out.height = size
    const g = out.getContext('2d')
    g.clearRect(0, 0, size, size)
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, size, size) }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
    g.drawImage(work, 0, 0, S, S, 0, 0, size, size)
    if (async && out.toBlob) {
      const p = new Promise((res) => out.toBlob((blob) => res(blob ? URL.createObjectURL(blob) : out.toDataURL('image/png')), 'image/png')).then((url) => { cache.set(key, url); return url })
      cache.set(key, p)          // 编码中：同参数的请求等同一个
      return p
    }
    const url = out.toDataURL('image/png')
    cache.set(key, url)
    return url
  }
  let queue = Promise.resolve()   // 分步出图共用离屏目标和缓冲：一张一张来
  // 显卡上的色调映射：浮点出图目标 → 8 位目标（ACES + sRGB + 曝光 + 上下翻转，和上面 CPU 那段逐像素算的是同一套公式）
  let rt8 = null, tmScene = null, tmCam = null, tmMat = null
  function tonemapTo(S, ex) {
    if (!rt8 || rt8.width !== S) { if (rt8) rt8.dispose(); rt8 = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false }) }
    if (!tmScene) {
      tmMat = new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: null }, uEx: { value: 1 }, uS: { value: S } },
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: /* glsl */`uniform sampler2D tSrc; uniform float uEx; uniform int uS;
          float fit(float v){ return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081); }
          float s2(float v){ v = clamp(v, 0.0, 1.0); return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
          void main(){
            vec4 c = texelFetch(tSrc, ivec2(int(gl_FragCoord.x), uS - 1 - int(gl_FragCoord.y)), 0);
            if (!(c.a > 0.0)) { gl_FragColor = vec4(0.0); return; }
            vec3 v = max(c.rgb, 0.0) * uEx / 0.6;
            float x = fit(0.59719 * v.r + 0.35458 * v.g + 0.04823 * v.b), y = fit(0.07600 * v.r + 0.90834 * v.g + 0.01566 * v.b), z = fit(0.02840 * v.r + 0.13383 * v.g + 0.83777 * v.b);
            vec3 o = vec3(1.60475 * x - 0.53108 * y - 0.07367 * z, -0.10208 * x + 1.10813 * y - 0.00605 * z, -0.00327 * x - 0.07276 * y + 1.07602 * z);
            gl_FragColor = vec4(s2(o.r), s2(o.g), s2(o.b), min(c.a, 1.0));
          }`,
        depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      })
      tmScene = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tmMat); q.frustumCulled = false; tmScene.add(q)
      tmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    }
    tmMat.uniforms.tSrc.value = rt.texture; tmMat.uniforms.uEx.value = ex; tmMat.uniforms.uS.value = S
    const auto = renderer.autoClear
    renderer.setRenderTarget(rt8); renderer.autoClear = false
    try { renderer.render(tmScene, tmCam) } finally { renderer.autoClear = auto }
  }

  return {
    render,
    /** 等模型加载 / 烘焙完再出图 */
    async load(logical, size, o) {
      const name = resolvePortraitName(logical); if (!name) return null
      await loadAsset(name); if (BODY_REF[name] && !(REGISTRY.get(name) || {}).ai) await loadAsset(BODY_REF[name])
      await compiled(name)
      const job = queue.then(async () => {
        const it = renderGen(logical, size, o, true)
        if (ctx.run) return ctx.run(it, { est: 4, name: 'portrait ' + name })     // 交给渲染层的调度泵：和烘焙 / 贴图上传共用每帧的预算
        for (;;) { const r = it.next(); if (r.done) return r.value; await nextSlice() }
      })
      queue = job.catch(() => {})
      return job
    },
    /** 批量出图，每张之间让出一帧（启动时生成一整套头像用，不会把主线程一口气卡住）→ Promise<{ 逻辑名: dataURL | null }> */
    async loadMany(names, size, o, onEach) {
      const res = {}
      for (const n of names) { res[n] = await this.load(n, size, o); if (onEach) onEach(n, res[n]); await new Promise((r) => setTimeout(r, 0)) }
      return res
    },
    clear() { cache.clear() },
    /**
     * 加载页里先把异步出图那条路走一遍：建好两个离屏目标、编好显卡色调映射的着色器、做一次 8 位 PBO 读回
     * （驱动第一次做这些要现建资源，首页第一张头像会卡几十毫秒）。size 跟之后出图用的边长一致（同一套离屏目标）
     */
    warmReadback(size = 160) {
      const S = Math.min(2048, Math.max(16, Math.round(size)) * 2)
      if (!rt || rt.width !== S) { if (rt) rt.dispose(); rt = new THREE.WebGLRenderTarget(S, S, { type: THREE.FloatType, depthBuffer: true }); buf = new Float32Array(S * S * 4); work = document.createElement('canvas'); work.width = work.height = S }
      const gl = renderer.getContext(), prev = renderer.getRenderTarget(), tmp8 = new Uint8Array(S * S * 4)
      try {
        renderer.setRenderTarget(rt); renderer.clear()
        tonemapTo(S, 1)
        const pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, tmp8.byteLength, gl.STREAM_READ)
        gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, 0)
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, tmp8)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(pbo)
      } catch (e) { /* 不支持就算了 */ } finally { renderer.setRenderTarget(prev) }
    },
  }
}
