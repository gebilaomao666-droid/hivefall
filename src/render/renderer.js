// renderer.js —— 渲染层入口。契约见 docs/ARCHITECTURE.md §3，使用说明见 docs/RENDER.md。
//   const view = await createRenderer({ canvas, quality })
//   view.setWorld(world); 每个模拟步 view.consume(world.events); 每帧 view.render(alpha, dtReal)
// 只读 world，不改 world。模拟时间通过 world.time 的增量驱动特效时钟（暂停 / 升级 / 子弹时间自然生效）。
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { buildEnvironment, LANES, loadTexSafe } from './env.js'
import { createFX } from './fx.js'
import { createCameraRig } from './camera.js'
import { createThemes, THEMES, THEME_IDS } from './themes.js'
import { createSquadView } from './squadview.js'
import { createSwarmView } from './swarmview.js'
import { createBossView } from './bossview.js'
import { createGroundView } from './groundview.js'
import { createGateView } from './gateview.js'
import { createCompanionView } from './companionview.js'
import { createInspector } from './inspect.js'
import { createPortraits } from './portrait.js'
import * as assets from './assets.js'
import { ASSET_ROOT, assetUrl, liteUrl, MOBILE } from './base.js'

// 所有 three 加载器（贴图 / glb / HDRI）都过这里：手机上换成 assets/lite/ 的小尺寸替换件；顺便数一下下载进度给加载页
THREE.DefaultLoadingManager.setURLModifier(liteUrl)

export const QUALITY = { high: 2.5, mid: 1.6, low: 1.0 }   // 三档只改像素比上限
// 每档的绘制缓冲像素预算（宽 × 高 × dpr²）：4K 全屏 + 高 dpr 时把像素比往下压，不让 MSAA 半浮点目标涨到几百 MB
// 用户 2560x1440 全屏反馈卡顿：预算按「1080p 级」收紧，大屏只是放大显示，画面细节几乎不变
const PIXEL_BUDGET = { high: 2304 * 1296, mid: 1920 * 1080, low: 1280 * 720 }
const ORDER = ['high', 'mid', 'low']
const STEP = 1 / 60                                        // 模拟步长（ARCHITECTURE §6）：render(alpha) 的位置插值按它回退
const MAX_SHOCK = 6
const COMPILE_TIMEOUT_MS = 6000                             // 一批着色器并行编译最多等这么久（见 compileAll）
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide }

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// 场景只在这一遍用 MSAA 目标渲染，然后用「冲击波 / 热浪扭曲」着色器解析到合成器的非 MSAA 缓冲。
// （合成器缓冲本身不能带 MSAA：Bloom 的加法回读会得到脏数据；每个全屏 pass 都写 MSAA 也白费 3ms）
class ScenePass extends Pass {
  constructor(scene, camera, samples) {
    super(); this.scene = scene; this.camera = camera; this.needsSwap = true
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples })
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 16 / 9 }, uFlash: { value: 0 },
        uShock: { value: Array.from({ length: MAX_SHOCK }, () => new THREE.Vector4()) }, uHaze: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, uHazeAmp: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`uniform sampler2D tDiffuse; uniform float uTime; uniform float uAspect; uniform vec4 uShock[${MAX_SHOCK}]; uniform vec4 uHaze; uniform float uHazeAmp; uniform float uFlash;
        varying vec2 vUv;
        void main(){
          vec2 uv = vUv; float ca = 0.0;
          for (int i = 0; i < ${MAX_SHOCK}; i++) {
            vec4 s = uShock[i]; if (s.w <= 0.0) continue;
            vec2 d = (vUv - s.xy) * vec2(uAspect, 1.0); float l = length(d) + 1e-5;
            float bq = (l - s.z) / 0.028; float band = exp(-bq * bq);
            uv -= (d / l) / vec2(uAspect, 1.0) * band * s.w * 0.028;
            ca += band * s.w;
          }
          vec2 hd = (vUv - uHaze.xy) / max(uHaze.zw, vec2(1e-4));           // 喷火线上方的热浪
          float hm = smoothstep(1.0, 0.2, length(hd)) * uHazeAmp;
          uv.x += sin(vUv.y * 190.0 - uTime * 11.0) * 0.0009 * hm;
          uv.y += sin(vUv.x * 150.0 + uTime * 9.0) * 0.0007 * hm;
          vec2 off = (uv - vUv) * 0.12 * min(ca, 1.0);                      // 冲击波边缘轻微色散
          vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
          col = clamp(col, vec3(0.0), vec3(48.0));                          // 兜底：负值 / NaN 不许进 Bloom
          col = col * (1.0 + uFlash * 1.6) + vec3(1.0, 0.82, 0.6) * uFlash * 0.06;   // 闪白按画面本身的亮度提（原来整屏加一层常数的暖白，0.45 的闪白把暗枪灰的方阵罩成半透明的白影）
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.material)
  }
  setSize(w, h) { this.rt.setSize(w, h); this.material.uniforms.uAspect.value = w / h }
  render(r, writeBuffer) {
    r.setRenderTarget(this.rt); r.clear(); r.render(this.scene, this.camera)
    this.material.uniforms.tDiffuse.value = this.rt.texture
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(r)
  }
  dispose() { this.rt.dispose(); this.material.dispose(); this.quad.dispose() }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uShadow: { value: new THREE.Vector3(0.9, 0.98, 1.1) }, uHigh: { value: new THREE.Vector3(1.07, 1.0, 0.92) }, uSat: { value: 1.08 }, uVig: { value: 0.5 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`uniform sampler2D tDiffuse; uniform float uTime; uniform vec3 uShadow; uniform vec3 uHigh; uniform float uSat; uniform float uVig; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5; float vig = smoothstep(0.92, 0.22, length(q * vec2(1.0, 1.18)));
      c *= mix(1.0 - uVig, 1.0, max(vig, smoothstep(0.1, 0.5, q.y) * 0.75 * (1.0 - smoothstep(0.25, 0.5, abs(q.x)))));   // 顶部中央（虫群来向）少压一点
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c *= mix(uShadow, uHigh, smoothstep(0.05, 0.9, l));                               // 分离色调
      c = max(c, 0.0); c = pow(c, vec3(1.06));                                          // 轻微压暗部，增加对比
      c += (h(vUv * 900.0 + fract(uTime) * 61.0) - 0.5) * 0.012 * (0.4 + l);           // 胶片颗粒
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
}

/**
 * opts: { canvas, quality = 'high', theme = 'ash', msaa(默认桌面 4、手机 0), preload(name => bool，默认全部), prewarm(默认 true：预建实例池并预编译着色器), seed, width, height(固定逻辑尺寸；不给就跟随画布的 CSS 尺寸),
 *         onProgress({ loaded, total, url }) 下载进度（文件个数）, onStage(名字) 当前在做哪一步（加载页显示用） }
 */
export async function createRenderer(opts = {}) {
  const canvas = opts.canvas
  const T0 = performance.now(), bootT = { start: Math.round(T0) }, mark = (k) => { bootT[k] = Math.round(performance.now() - T0) }   // 启动各阶段耗时（view.bootTimings，毫秒，相对 createRenderer 开始）
  const mobile = MOBILE
  const stage = (k) => { if (opts.onStage) try { opts.onStage(k) } catch (e) { /* 界面的事 */ } }
  {
    const M = THREE.DefaultLoadingManager
    M.onProgress = (url, loaded, total) => { if (opts.onProgress) try { opts.onProgress({ loaded, total, url }) } catch (e) { /* 界面的事 */ } }
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false })
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.info.autoReset = false
  // three 每个着色器程序第一次用时会去查编译 / 链接日志（getProgramInfoLog / getShaderInfoLog）：在 Windows 的 ANGLE 上这一下会同步等驱动，
  // 一个程序 5~60ms。正式游玩关掉；开发时 URL 加 ?glcheck=1 打开（着色器写错时控制台才有报错）
  renderer.debug.checkShaderErrors = /[?&]glcheck=1/.test(location.search)

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020305)
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 600)
  const rig = createCameraRig(camera)
  const rng = mulberry(opts.seed || 20260930)

  let quality = QUALITY[opts.quality] ? opts.quality : (mobile ? 'mid' : 'high'), manualQuality = false
  let W = 1, H = 1
  const maxRB = renderer.capabilities.maxTextureSize || 8192
  const dprOf = (q) => {
    let d = Math.min(window.devicePixelRatio || 1, QUALITY[q])
    // 系统缩放 / 浏览器缩放 < 100% 时 devicePixelRatio 会小于 1（测试机是 0.8）：高 / 中档至少按 1 画（等于轻度超采样），30 像素高的步兵不再发虚
    if (q !== 'low') d = Math.max(d, 1)
    const px = W * H * d * d
    if (px > PIXEL_BUDGET[q]) d *= Math.sqrt(PIXEL_BUDGET[q] / px)
    d = Math.min(d, maxRB / Math.max(W, H))                // 任何一边都不能超过 GPU 的最大纹理尺寸
    return Math.max(0.5, d)
  }
  // 画布必须由 CSS 定尺寸（width / height 属性归渲染器管）。没有 CSS 尺寸的画布，显示大小会跟着属性走：
  // 一改绘制缓冲大小画布就跟着变，窗口放大后画面只占左上角一块。探测到这种情况就让它铺满父元素。
  {
    const w0 = canvas.clientWidth, a0 = canvas.width
    canvas.width = a0 + 16
    const unsized = canvas.clientWidth !== w0
    canvas.width = a0
    if (unsized) { canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; console.info('[render] 画布没有 CSS 尺寸，已设为铺满父元素（width / height: 100%）') }
  }
  renderer.setPixelRatio(dprOf(quality))

  // ---------------- 后处理链：场景(MSAA) + 扭曲 → Bloom → 调色 → 输出 ----------------
  const msaa = opts.msaa ?? (mobile ? 0 : 4)
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }))
  const scenePass = new ScenePass(scene, camera, msaa)
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.3, 0.6, 1.0)
  const grade = new ShaderPass(GradeShader)
  composer.addPass(scenePass); composer.addPass(bloom); composer.addPass(grade); composer.addPass(new OutputPass())
  const shocks = []
  const post = {
    bloom, grade,
    addShock(x, y, z, strength = 1, radius = 5, dur = 0.45) { if (shocks.length >= MAX_SHOCK) shocks.shift(); shocks.push({ pos: new THREE.Vector3(x, y, z), t0: fxT, dur, strength, radius }) },
  }

  // ---------------- 场景内容 ----------------
  // 冷启动：首屏模型的下载 / 烘焙和场景搭建并行（原来是先等场景、再一个个烘模型，串行 ≈ 0.4 秒白等）
  // 粒子图集 / 布防格贴图要等场景搭完才用，但下载先发出去（原来要排在场景素材后面再下，慢网上白等 1~2 秒）；之后的加载走浏览器缓存
  for (const f of ['ui/tex/particles_atlas_1024.jpg', 'ui/tex/generated/hexgrid_512.png']) { const im = new Image(); im.src = liteUrl(ASSET_ROOT + f) }
  const lazy = !opts.preload && opts.lazy !== false
  const preloadNow = opts.preload || (lazy ? (n) => !LAZY.test(n) : null)
  const assetsP = assets.preloadAll(preloadNow)
  stage('env')
  // 手机：阴影图 1024（2048 的深度图在手机上又占显存又慢）、程序甲板贴图半分辨率
  const env = await buildEnvironment(scene, renderer, { shadowSize: mobile ? 1024 : 2048, deckRes: mobile ? 0.5 : 1 })
  mark('env')
  const [noise, hex] = await Promise.all([loadTexSafe(ASSET_ROOT + 'ui/tex/generated/noise_fbm_512.png'), loadTexSafe(ASSET_ROOT + 'ui/tex/generated/hexgrid_512.png', [0, 0, 0])])
  noise.wrapS = noise.wrapT = hex.wrapS = hex.wrapT = THREE.RepeatWrapping
  const ctx = {
    scene, envMap: null, uTime: { value: 0 }, noise, hex, frame: 0, back: 0, materials: [],
    rim: { armor: { value: new THREE.Color(0.22, 0.49, 1.0) }, chitin: { value: new THREE.Color(1.0, 0.29, 0.16) } },
  }
  const squad = createSquadView(ctx), swarm = createSwarmView(ctx), boss = createBossView(ctx), ground = createGroundView(ctx), gate = createGateView(ctx), companion = createCompanionView(ctx)
  squad.companion = companion   // 伙伴无人机的 shot 事件带 unit: 'companion'：枪口位置由 companionview 给
  const fx = await createFX({ scene, rng, squad, post })
  ctx.fx = fx; ctx.post = post; ctx.camera = camera; ctx.env = env; ctx.canvas = canvas; ctx.compileTarget = scenePass.rt
  if (gate.attach) gate.attach(ctx)   // 门 / 装置 / 技能特效（gateview → deviceview / powersfx）要用粒子原语、相机和环境
  // 冷启动（测试：8.5 秒进首页）：Boss（三只合计烘焙 1.3 秒）、雇佣兵红黑变体、开局用不到的重装兵种不在首屏加载，
  // 首屏只等菜单背景要用的步兵 / 小虫 / 装置 / 场景；其余在 createRenderer 返回之后逐个后台加载（每个之间让出主线程），
  // 加载完一个就建好它的实例池，全部到齐再补编一次着色器。离 Boss 登场（≈ 158 秒）还早得很；万一没到，各 view 的 poolOf 每帧会重试，到了就出现。
  // opts.lazy = false：全部同步加载（旧行为）。opts.preload 给了就完全按调用方的来
  stage('models')
  await assetsP
  mark('assets')
  // 预建实例池：第一次用到某个模型才建池的话，它的着色器要在那一帧现编译（Boss 的 detail 材质要一两百毫秒 = 登场时卡一下）。
  // 这里把「已经预加载的」都先建好，文件末尾的 compileAsync 会把它们的着色器一起编掉。opts.prewarm = false 可以关
  if (opts.prewarm !== false) {
    const names = assets.list('')
    const ok = (n) => { const d = assets.REGISTRY.get(n); return !!d && d.preload !== false && (!preloadNow || preloadNow(n)) }
    for (const v of [squad, swarm, boss, companion, gate]) v.prewarm(ok, names)
  }
  mark('pools')
  const themes = createThemes({ scene, env, post, renderer, rim: ctx.rim, materials: ctx.materials })
  themes.set(THEMES[opts.theme] ? opts.theme : 'ash', 0)
  const inspector = createInspector(ctx, rig)
  const portraits = createPortraits(ctx, renderer)

  // ---------------- 状态 ----------------
  let world = null, lastWT = 0, fxT = 0, realT = 0, lost = false, flashAmt = 0, lazyBusy = false, compiling = 0   // compiling：在驱动后台编着的着色器批数（见 compileAll / ctx.gpuIdle）
  const ft = new Float32Array(150); let ftN = 0, ftI = 0, cool = 0, fpsAvg = 60, lastCalls = 0, lastTris = 0
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), pv = new THREE.Vector3(), pv2 = new THREE.Vector3()
  // GPU 计时（有扩展才有）
  const gl = renderer.getContext()
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  let gpuOn = false, gpuQuery = null, gpuMs = 0; const gpuSamples = []

  // ---------------- 尺寸：渲染器自己盯着画布的 CSS 尺寸和设备像素比 ----------------
  // 三条路都会触发：ResizeObserver（布局变了）、window 的 resize / 全屏 / 转屏事件、devicePixelRatio 的媒体查询（换显示器 / 浏览器缩放）；
  // 另外每 20 帧兜底核对一次（事件在加载期间丢了、后台标签页不派发事件都靠它）。宿主页面不需要再自己监听 resize。
  let view = null
  let fixedSize = false, sizeDirty = true, appliedW = 0, appliedH = 0, appliedDpr = 0, appliedRaw = 0
  const applySize = () => {
    const dpr = dprOf(quality)
    appliedW = W; appliedH = H; appliedDpr = dpr; appliedRaw = window.devicePixelRatio || 1
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false)          // 绘制缓冲 + 视口
    composer.setPixelRatio(dpr); composer.setSize(W, H)                 // 合成器的两个缓冲 + 每个 pass（场景 MSAA 目标、Bloom 金字塔）
    if (mobile) bloom.setSize(Math.max(1, Math.round(W * dpr * 0.5)), Math.max(1, Math.round(H * dpr * 0.5)))   // 手机：Bloom 金字塔再降一半分辨率（光晕本来就是糊的，看不出差别，省一半填充率和显存）
    rig.resize(W, H); env.setViewportHeight(H * dpr)                    // 相机宽高比 / 窄屏 FOV；灯晕的点大小
    if (view && view.onResize) view.onResize(W, H, dpr)
  }
  const syncSize = () => {
    sizeDirty = false
    if (!fixedSize) {
      const w = Math.floor(canvas.clientWidth), h = Math.floor(canvas.clientHeight)
      if (w < 1 || h < 1) return false                                  // display:none / 还没进文档：保持上一次的尺寸
      W = w; H = h
    }
    if (W === appliedW && H === appliedH && dprOf(quality) === appliedDpr) return false
    applySize()
    return true
  }
  // 事件里当场重设尺寸并补画一帧（用上一帧的场景状态，不推进任何时钟）：
  // 改绘制缓冲大小会把画布清空，如果等下一个 rAF 才画，拖窗口时会闪黑；后台 / 被遮挡的标签页 rAF 还会被浏览器压到很慢
  let drawn = false
  const markDirty = () => {
    sizeDirty = true
    if (!lost && drawn && syncSize()) { renderer.info.reset(); composer.render() }
  }
  const unwatch = []
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(markDirty); ro.observe(canvas); if (canvas.parentElement) ro.observe(canvas.parentElement); unwatch.push(() => ro.disconnect()) }
  for (const [tg, ev] of [[window, 'resize'], [window, 'orientationchange'], [document, 'fullscreenchange'], [document, 'webkitfullscreenchange'], [document, 'visibilitychange']]) { tg.addEventListener(ev, markDirty); unwatch.push(() => tg.removeEventListener(ev, markDirty)) }
  if (window.visualViewport) { const vv = window.visualViewport; vv.addEventListener('resize', markDirty); unwatch.push(() => vv.removeEventListener('resize', markDirty)) }
  {   // devicePixelRatio 没有事件，用「分辨率 = 当前值」的媒体查询：一变就触发，然后按新值重新挂
    let mq = null
    const onDpr = () => { markDirty(); arm() }
    function arm() { if (!window.matchMedia) return; mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); if (mq.addEventListener) mq.addEventListener('change', onDpr, { once: true }) }
    arm(); unwatch.push(() => { if (mq && mq.removeEventListener) mq.removeEventListener('change', onDpr) })
  }

  view = {
    /** 新开一局，或换成菜单里的「摆拍世界」。null = 空场景 */
    setWorld(w) { world = w; lastWT = w ? w.time : 0; squad.reset(); swarm.reset(); boss.reset(); gate.reset(); companion.reset(); fx.reset() },
    /** 每个模拟步调用（world.events 每步会清空），也可以攒一帧的事件一次传进来 */
    consume(events) {
      if (!events || !events.length || lost) return
      const t = world ? world.time : 0
      fx.consume(events, world); squad.consume(events, t); boss.consume(events); gate.consume(events, t, realT); companion.consume(events, t)
    },
    /** 每帧。alpha = 模拟步之间的插值系数（0..1：这一帧落在「上一步 → 最新一步」的哪里；不传 = 1，直接画最新位置）；dtReal = 真实秒。
     *  noDraw = true：只推进表现（特效 / 动画 / 相机），不往屏幕画（加载页底下快进首页背景用：手机上画一帧几十毫秒） */
    render(alpha, dtReal, noDraw = false) {
      if (lost) return
      dtReal = Math.min(0.1, Math.max(0, dtReal || 0))
      realT += dtReal; ctx.frame++
      if (sizeDirty || ctx.frame % 20 === 0 || (window.devicePixelRatio || 1) !== appliedRaw) syncSize()
      // 位置插值：world 里是「最新一步」的位置，画的时候沿各自的速度往回退 (1 - alpha) 步 —— 高刷新率屏幕上不再一顿一顿
      const al = alpha >= 0 && alpha <= 1 ? alpha : 1
      ctx.back = world ? (1 - al) * STEP * (world.timeScale ?? 1) : 0
      let simDt = 0, t = 0
      if (world) { t = world.time; simDt = t - lastWT; if (!(simDt >= 0 && simDt < 0.25)) simDt = 0; lastWT = t }
      fxT += simDt
      ctx.uTime.value = realT
      themes.update(dtReal); env.update(realT)
      if (world) {
        squad.update(world, t, simDt); swarm.update(world, t); boss.update(world, t, simDt, dtReal); companion.update(world, t, simDt, realT)
        ground.update(world, t, realT, swarm.auras, swarm.shields); gate.update(world, t, realT)
      } else ground.update({}, 0, realT, null)
      inspector.update(realT, dtReal)
      const A = themes.state; fx.setAmbient(0.35 + A.hemi * 0.3, 0.35 + A.hemi * 0.3, 0.38 + A.hemi * 0.3)
      fx.update(fxT, simDt, world, dtReal)
      if (world && world.summons && simDt > 0) for (const sm of world.summons) if (sm.kind === 'ray') fx.ray(sm.x, sm.z0 ?? -21, sm.z1 ?? 17)   // 汇聚射线：位置每帧读召唤物
      const d = fx.drain(); if (d.shake > 0) rig.addShake(d.shake); flashAmt = Math.max(flashAmt * Math.exp(-dtReal * 14), d.flash)
      rig.update(dtReal, simDt)
      // 后处理参数
      const U = scenePass.material.uniforms
      U.uTime.value = realT; U.uFlash.value = flashAmt; grade.uniforms.uTime.value = realT
      for (let i = shocks.length - 1; i >= 0; i--) if (fxT - shocks[i].t0 > shocks[i].dur) shocks.splice(i, 1)
      for (let i = 0; i < MAX_SHOCK; i++) {
        const s = shocks[i], u = U.uShock.value[i]
        if (!s) { u.set(0, 0, 0, 0); continue }
        const k = (fxT - s.t0) / s.dur
        pv.copy(s.pos).project(camera); pv2.copy(s.pos); pv2.x += s.radius; pv2.project(camera)
        const rScreen = Math.abs(pv2.x - pv.x) * 0.5 * camera.aspect
        u.set(pv.x * 0.5 + 0.5, pv.y * 0.5 + 0.5, rScreen * (0.08 + 0.92 * Math.sqrt(k)), s.strength * (1 - k) * (1 - k))
      }
      const hz = fx.flameHaze
      if (hz) { pv.copy(hz).project(camera); pv2.copy(hz); pv2.x += 6.5; pv2.project(camera); const rx = Math.abs(pv2.x - pv.x) * 0.5; U.uHaze.value.set(pv.x * 0.5 + 0.5, pv.y * 0.5 + 0.5 + rx * 0.12, rx * 1.1, rx * 0.3); U.uHazeAmp.value = 1 } else U.uHazeAmp.value = 0

      if (noDraw) return
      renderer.info.reset()
      if (gpuOn && timerExt && !gpuQuery) { gpuQuery = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, gpuQuery); composer.render(); gl.endQuery(timerExt.TIME_ELAPSED_EXT); gpuQuery._age = 0 }
      else {
        composer.render()
        if (gpuQuery && ++gpuQuery._age > 1 && gl.getQueryParameter(gpuQuery, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) { gpuMs = gl.getQueryParameter(gpuQuery, gl.QUERY_RESULT) / 1e6; gpuSamples.push(gpuMs); if (gpuSamples.length > 240) gpuSamples.shift() }
          gl.deleteQuery(gpuQuery); gpuQuery = null
        }
      }
      lastCalls = renderer.info.render.calls; lastTris = renderer.info.render.triangles; drawn = true

      // 帧率统计 + 自动降档：连续一窗帧时间中位数 > 21ms 或 90 分位 > 34ms 就降一档，降后 5 秒冷静期；玩家手动选过就不再自动调
      if (lazyBusy) { ftN = 0; ftI = 0 }     // 后台还在补加载 / 烘焙模型：那几秒的慢帧是加载造成的，不能算成「显卡带不动」把画质降掉
      else if (dtReal > 0 && dtReal < 0.25) {     // 超过 0.25 秒的帧是标签页被隐藏/遮挡时的节流，不算进降档统计
        ft[ftI] = dtReal; ftI = (ftI + 1) % ft.length; if (ftN < ft.length) ftN++
        fpsAvg += (1 / dtReal - fpsAvg) * 0.05
        cool -= dtReal
        // 中位数低于约 48fps，或一成的帧低于约 30fps（卡顿）就降一档
        if (!manualQuality && cool <= 0 && ftN === ft.length && ftI === 0) {
          const s = Array.from(ft).sort((a, b) => a - b)
          if (s[s.length >> 1] > 0.021 || s[Math.floor(s.length * 0.9)] > 0.034) { const i = ORDER.indexOf(quality); if (i < ORDER.length - 1) { quality = ORDER[i + 1]; applySize(); cool = 5; ftN = 0; if (view.onQualityChange) view.onQualityChange(quality, 'auto') } }
        }
      }
    },
    /** 手动设画质（之后不再自动降档）。auto = true 表示这是程序的默认值，不算玩家手选 */
    setQuality(q, auto = false) { if (!QUALITY[q]) return; quality = q; if (!auto) manualQuality = true; if (!syncSize()) applySize() },
    get quality() { return quality },
    /**
     * 一般不用调：渲染器自己跟踪画布的 CSS 尺寸和 devicePixelRatio。
     * resize() 不带参数 = 立刻按画布当前的 CSS 尺寸重算（并恢复自动跟踪）；
     * resize(w, h) = 固定成这个逻辑尺寸（离屏出图用），直到再调一次不带参数的 resize()
     */
    resize(w, h) {
      if (w > 0 && h > 0) { fixedSize = true; W = Math.max(1, Math.floor(w)); H = Math.max(1, Math.floor(h)) }
      else { fixedSize = false; W = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth)); H = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight)) }
      applySize()
    },
    /** 当前的逻辑尺寸（CSS 像素）、实际像素比和绘制缓冲大小 */
    get size() { return { width: W, height: H, dpr: appliedDpr, bufferWidth: canvas.width, bufferHeight: canvas.height, fixed: fixedSize } },
    setCameraMode(mode, instant = false) { rig.setMode(mode, instant) },
    /** 'ash' | 'night' | 'hive'；seconds = 过渡时长，0 = 立即 */
    setTheme(id, seconds = 1.6) { return themes.set(id, seconds) },
    get theme() { return themes.id },
    /** 屏幕坐标（clientX / clientY）→ 桥面上的点 {x, z}；没打到地面返回 null */
    pickGround(clientX, clientY) {
      const r = canvas.getBoundingClientRect()
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null
    },
    /** 世界坐标 → 画布内的 CSS 像素 {x, y, visible}（飘字 / 头顶标记用） */
    project(x, y, z, out = {}) {
      pv.set(x, y, z).project(camera)
      out.x = (pv.x * 0.5 + 0.5) * W; out.y = (-pv.y * 0.5 + 0.5) * H; out.visible = pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 1.1 && Math.abs(pv.y) < 1.1
      return out
    },
    /** 取走攒下的飘字锚点：[{ kind:'dmg'|'boss'|'xp'|'energy', value, crit, n(合并了几次), x, y(CSS 像素), visible }] */
    pollFloaters() {
      const out = fx.floaters.map((f) => { const p = view.project(f.x, f.y, f.z); return { kind: f.kind, value: f.value, crit: f.crit, n: f.n, x: p.x, y: p.y, visible: p.visible } })
      fx.floaters.length = 0
      return out
    },
    /** 称号锚点（英雄 / 雇佣兵 / 英雄级起名的单位）、Boss 头顶锚点、伙伴无人机锚点（{ form, stage, name, sx, sy, visible } | null）、晶能光点飞向的位置 energy { sx, sy }，已投影到 CSS 像素 */
    anchors() {
      const units = squad.anchors().map((a) => { const p = view.project(a.x, a.y, a.z); return { ...a, sx: p.x, sy: p.y, visible: p.visible } })
      const at = (a) => { if (!a) return null; const p = view.project(a.x, a.y, a.z); return { ...a, sx: p.x, sy: p.y, visible: p.visible } }
      const en = gate.devices.energyAnchor()
      return { units, boss: at(boss.anchor()), companion: at(companion.anchor()), energy: { sx: en.x, sy: en.y, visible: true } }
    },
    /** 布防：高亮一个格子（lane 0..4，row 0..3）；setCell(null) 取消 */
    setCell(lane, row, ok) { ground.setCell(lane, row, ok) },
    /**
     * 布防模式：setPlacement({ kind, lane, row, valid }) 亮出全部 5×4 格（空格青、占用红）、在指向的格子上画 kind 的全息虚影和它的作用范围；
     * valid === false（买不起 / 冷却中 / 没解锁 / 被占）虚影和格子变红，不给 valid 就按格子空不空判。lane / row 为 null 只亮格子。setPlacement(null) 退出。
     * 旧写法 setPlacement(kind, lane, row, valid) 也认。
     */
    setPlacement(kind, lane, row, valid) { gate.setPlacement(kind, lane, row, valid) },
    /** 平时常亮的 5×4 格角标（默认开）；菜单摆拍世界不想要可以关 */
    setGridLandmarks(on) { gate.devices.setLandmarks(on) },
    /** 屏幕坐标 → 布防格 { lane, row, x, z }（x / z 是格子中心）；没点在 5×4 格里返回 null */
    pickCell(clientX, clientY) {
      const p = view.pickGround(clientX, clientY); if (!p) return null
      const lane = Math.floor((p.x + LANES.width * 2.5) / LANES.width), row = Math.floor((LANES.rows[0] + LANES.depth / 2 - p.z) / LANES.depth)
      if (lane < 0 || lane > 4 || row < 0 || row > 3) return null
      return { lane, row, x: LANES.centers[lane], z: LANES.rows[row] }
    },
    /** 晶能计数器在画布里的位置（CSS 像素）：晶能掉落的光点往这儿飞。不设 = 画面左下 */
    setEnergyTarget(x, y) { if (gate.setEnergyTarget) gate.setEnergyTarget(x, y) },
    /**
     * 晶能光点的两个回调（UI 用来让计数器「收到光点才跳」）：
     *   view.onEnergyFly = ({ amount, source('kill'|'collector'|'refund'|'gate'), from: {x, y}, to: {x, y}, duration(模拟秒), orbs }) => {}
     *   view.onEnergyArrive = ({ amount, source }) => {}     光点飞到计数器的那一刻（暂停时不会触发；orbs = 0 的那种立即触发）
     */
    get onEnergyFly() { return gate.devices.hooks.onEnergyFly }, set onEnergyFly(fn) { gate.devices.hooks.onEnergyFly = typeof fn === 'function' ? fn : null },
    get onEnergyArrive() { return gate.devices.hooks.onEnergyArrive }, set onEnergyArrive(fn) { gate.devices.hooks.onEnergyArrive = typeof fn === 'function' ? fn : null },
    /**
     * 离屏渲染一张头像：renderPortrait(逻辑名, 边长像素 = 160, { bust, angle, pitch, clip, zoom, bg }) → dataURL（PNG，默认透明底）。
     * 逻辑名：'unit.rifle' / 'enemy.hulk' / 'boss.ravager' / 'device.sentry' / 'companion.scout'，也认别名：
     *   指挥官 'commander.hawk' | 'hawk' | 'ysera' | 'joe' → unit.hero_*；不带前缀的 kind（'rifle' / 'ling' / 'sentry' / 'ravager'）按 unit → device → enemy → boss → companion 依次找。
     * 同步返回；同一组参数有缓存。模型还没加载完（preload: false 的 glb）返回 null，可以先 await view.loadPortrait(...)。
     */
    renderPortrait(name, size, o) { return portraits.render(name, size, o) },
    /** 异步版：等模型加载 / 烘焙完再出图 → Promise<dataURL> */
    loadPortrait(name, size, o) { return portraits.load(name, size, o) },
    /** 批量：loadPortraits(['commander.hawk', 'unit.rifle', ...], size, o, (name, url) => {}) → Promise<{ 名字: dataURL | null }>，每张之间让出一帧 */
    loadPortraits(names, size, o, onEach) { return portraits.loadMany(names, size, o, onEach) },
    /** 加载页里调一次：头像出图要用的离屏目标和读回路径先走一遍（size = 之后 loadPortrait 用的边长） */
    warmPortraits(size) { portraits.warmReadback(size) },
    stats() {
      const s = gpuSamples.slice().sort((a, b) => a - b)
      return {
        fps: fpsAvg, calls: lastCalls, tris: lastTris, quality, dpr: renderer.getPixelRatio(), msaa, width: W, height: H,
        gpuMs: s.length ? s[s.length >> 1] : null, swarm: swarm.count(), units: squad.count(), marks: ground.count(), fx: fx.counts(), events: fx.stats.events, contextLost: lost,
      }
    },
    /** 开 / 关 GPU 帧耗时采样（EXT_disjoint_timer_query_webgl2；没有扩展时 stats().gpuMs 为 null） */
    gpuTimer(on) { gpuOn = !!on; if (!on) gpuSamples.length = 0; return !!timerExt },
    /** 检视：单独摆出某个逻辑名的模型和它的全部 clip（军械库 / 美术迭代用）；传数组 = 多个模型并排对比。inspect(null) 退出 */
    inspect(name, o) { return Array.isArray(name) ? inspector.lineup(name, o) : inspector.show(name, o) },
    onQualityChange: null, onContextLost: null, onContextRestored: null, onResize: null,
    /**
     * 注入文案函数：fn(key, params) -> string（一般就是 data/strings 的 t）。门楣全息牌的文字全部走它；
     * 不注入时门牌只显示不依赖文案的兜底（「+8 rifle」这类）。换语言后再调一次即可（门牌会重画）。
     */
    setTranslator(fn) { gate.setTranslator(fn) },
    dispose() { for (const f of unwatch) f(); unwatch.length = 0; renderer.dispose(); composer.dispose() },
    // 调试 / 开发页用
    debug: { renderer, scene, camera, composer, env, fx, themes, rig, squad, swarm, boss, ground, gate, companion, ctx, assets, post, scenePass, THEME_IDS },
  }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; gpuQuery = null; gpuSamples.length = 0; if (view.onContextLost) view.onContextLost() })
  canvas.addEventListener('webglcontextrestored', () => {
    env.bakeEnvMap(true); themes.reapply(); lost = false; ftN = 0; cool = 5
    if (mobile && !manualQuality) { const i = ORDER.indexOf(quality); if (i < ORDER.length - 1) quality = ORDER[i + 1] }
    applySize()
    compileAll().then(() => { warmDraw(); if (view.onContextRestored) view.onContextRestored() })
  })

  view.resize(opts.width, opts.height)
  rig.setMode('battle', true)
  stage('shaders')
  await compileAll()
  warmDraw()
  if (gate.endWarm) gate.endWarm()
  mark('compiled'); view.bootTimings = bootT
  // 后台补加载（见上面 LAZY 的说明）。view.lazyReady：全部到齐时 resolve（开发页 / 测试想等齐了再截图可以 await 它）
  // 
  //   · 分步烘焙：一个模型 100~800ms 的烘焙切成每步几毫秒（assets.loadAsset 的 runner，见下面的调度泵），每帧只做一小段，首页不再一卡一卡；
  //   · 每补一个模型就把它的着色器并行编译掉（编进真正的场景目标），补完再往离屏目标真画一遍（warmDraw），别等它第一次出现在画面里才现编；
  //   · view.battleReady：开局要用到的（除 Boss 以外的全部）到齐 + 预热过就 resolve。main 等它再开局：
  //     玩家在这之前点了部署，main 调 view.hurry()，每帧预算放大到 24ms（加载页盖着、首页背景停画），尽快补完；
  //   · Boss 最后补（第一只 Boss 两分半以后才出场）：开局时还没补完的，战斗头 view.lazyHoldSec（默认 25）秒先停着，之后每帧只做一小步
  let hurry = false
  lazyBusy = lazy
  // hurry(true)：每帧预算 24ms（加载页盖着时）；hurry(数字)：指定每帧预算毫秒数（强制开局后战斗里还在补模型时用中间档）；hurry(false)：恢复 6ms
  view.hurry = (on = true) => { hurry = typeof on === 'number' ? on : !!on }
  view.lazyHold = null                 // main 注入：() => true 时暂停后台补加载（开局头几秒）
  view.bossHold = null                 // main 注入：() => true 时先别开始补 Boss
  const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r() } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 120) })   // 后台标签页 rAF 停了也别卡死
  // ---- 后台活的统一调度：所有「分步做」的活（烘焙模型、头像出图、贴图上传、预热绘制）排进一个队列，
  // 每帧画完之后由一个泵按预算做：每帧最多约 6ms（「正在部署」加载页盖着、首页不画的时候 24ms，帧间隔仍在 33ms 以内），按每个活上一步的耗时预判，下一步会超就留到下一帧。
  // 活是同步生成器：每 yield 一次算一步；yield 一个 Promise = 等它好了再接着做（期间不占预算）。hold 的活在开局头几秒（view.lazyHold）不做
  const jobs = []
  let pumping = false
  view.sliceLog = []                   // 调试：超过 8ms 的单步 [活的名字, 毫秒, 开始时刻]
  // o.prio：数小的先做（0 = 新池子的编译 / 贴图、头像；1 = 后台烘焙模型）。同优先级先来先做
  function run(it, o = {}) {
    return new Promise((res, rej) => { add({ it, res, rej, est: o.est || 1, hold: !!o.hold, name: o.name || '', prio: o.prio ?? 0 }); kick() })
  }
  function add(j) { let i = jobs.length; while (i > 0 && jobs[i - 1].prio > j.prio) i--; jobs.splice(i, 0, j) }
  function kick() { if (!pumping) { pumping = true; nextFrame().then(pump) } }
  function pump() {
    pumping = false
    const t0 = performance.now(), budget = typeof hurry === 'number' ? hurry : hurry ? 24 : 6, held = !!(view.lazyHold && view.lazyHold())
    let done = 0
    for (let i = 0; i < jobs.length;) {
      const j = jobs[i]
      if (held && j.hold) { i++; continue }
      const used = performance.now() - t0
      if (done > 0 && used + j.est > budget) break
      const a = performance.now()
      let r
      try { r = j.it.next() } catch (e) { jobs.splice(i, 1); j.rej(e); continue }
      const d = performance.now() - a
      j.est = Math.max(d, j.est * 0.7); done++
      if (d > 8 && view.sliceLog.length < 100) view.sliceLog.push([j.name, +d.toFixed(1), Math.round(a)])
      if (r.done) { jobs.splice(i, 1); j.res(r.value); continue }
      if (r.value && typeof r.value.then === 'function') { jobs.splice(i, 1); r.value.then(() => { add(j); kick() }, () => { add(j); kick() }); continue }
    }
    if (jobs.length) kick()
  }
  ctx.run = run
  // 驱动还在后台编着色器的时候，任何要等显卡进程回话的调用（读回像素 getBufferSubData）都会被拖住 20~40ms：头像读回先等编译都完了再做
  ctx.gpuIdle = () => (compiling > 0 ? (async () => { while (compiling > 0) await nextFrame() })() : null)
  const lazyRun = (it) => run(it, { hold: true, name: curName, prio: 1 })
  let curName = ''
  // 新建的实例池（不管是这里预建的，还是首页摆拍 / 战斗里各 view 第一次用到时建的）：先藏起来，着色器（含阴影深度材质）交给驱动后台线程编，
  // 编好以后贴图一步传一张、最后亮出来并只把它自己往离屏目标画一遍（上传顶点动画贴图 / 缓冲、驱动那边的首次绘制）。
  // 挂着不管的话，第一次画它时 three 会同步等编译（getProgramInfoLog），一次 50~100ms；4 张 512~2048 的贴图 + 几 MB 的顶点动画贴图一口气传又是 20~40ms
  const pending = []
  ctx.onPoolCreated = (objs, name) => {
    for (const o of objs) o.visible = false
    pending.push(run((function* () {
      // 一个程序一步（three 拼着色器源码 + 提交编译，一个 3~8ms），全部提交完再一起等驱动编好
      const ps = []
      const tl = (k, a) => { const d = performance.now() - a; if (d > 8 && view.sliceLog.length < 100) view.sliceLog.push([k + ' ' + name, +d.toFixed(1), Math.round(a)]) }
      const targets = compileTargets(objs)
      for (const t of targets) { const a = performance.now(); ps.push(compileAll([t], true)); tl('compile', a); yield }
      yield Promise.all(ps)
      yield* firstUseSteps(targets)
      yield* uploadSteps(objs, tl)
      for (const o of objs) o.visible = true
      const a = performance.now()
      if (!lost) warmDraw(objs)
      tl('warm', a)
    })(), { est: 4, name: 'pool ' + (name || '') }).catch(() => {}))
  }
  function* uploadSteps(objs, tl) {
    for (const tex of texturesOf(objs)) {
      if (lost || renderer.properties.get(tex).__webglTexture) continue      // 已经在显卡上了
      const a = performance.now()
      try { renderer.initTexture(tex) } catch (e) { /* 传不上就等第一次画的时候再传 */ }
      if (tl) tl('tex' + (tex.image ? tex.image.width + 'x' + tex.image.height : ''), a)
      yield
    }
  }
  ctx.uploadSteps = uploadSteps   // 头像出图也用（见 portrait.js）
  /** 程序第一次被用时 three 要做的事（查编译日志、取全部 uniform / attribute 的位置，PBR 着色器一个 3~8ms）提前一个程序一步做掉 */
  function* firstUseSteps(objs) {
    for (const r of objs) {
      const ms = []
      r.traverse((o) => { for (const m of [].concat(o.material || [])) ms.push(m) })
      for (const m of ms) {
        const prog = renderer.properties.get(m).currentProgram
        if (!prog || lost) continue
        try { prog.getUniforms() } catch (e) { /* 没关系 */ }
        yield
      }
    }
  }
  ctx.firstUseSteps = firstUseSteps
  let battleDone = null, heroesDone = null
  view.battleReady = new Promise((r) => { battleDone = r })
  /** 指挥官模型（首页卡片的头像就要用）到齐 + 预热完：main 在加载页里等它（见 main.js boot） */
  view.heroesReady = new Promise((r) => { heroesDone = r })
  view.lazyReady = lazy ? (async () => {
    const rest = assets.list('').filter((n) => { const d = assets.REGISTRY.get(n); return d && d.preload !== false && LAZY.test(n) })
    const pri = (n) => (/^unit\.hero_/.test(n) ? 0 : /^enemy\./.test(n) ? 1 : /^unit\./.test(n) ? 2 : /^boss\./.test(n) ? 4 : 3)   // 指挥官最先（玩家可能一进首页就点部署），Boss 最后
    rest.sort((a, b) => pri(a) - pri(b))
    assets.setDefaultRunner(lazyRun)     // 头像出图时顺手要的模型也分步烘
    let battleSent = false
    const sendBattle = async () => {
      await Promise.all(pending); battleSent = true; battleDone(rest.length)
      // 远景大件（战舰剪影）：开局要用的都到齐以后再下载；建好以后跟新实例池一样先藏起来、并行编译、预热了再亮
      if (env.loadExtras) env.loadExtras().then((objs) => { if (objs.length && ctx.onPoolCreated) ctx.onPoolCreated(objs, 'env-extras') }).catch(() => {})
    }
    for (const n of rest) {
      if (!battleSent && /^boss\./.test(n)) {
        await sendBattle()
        // Boss（三只合计烘 1.6 秒、贴图 2048）：首页刚出来的那十几秒、开局头 25 秒都不做，免得跟首页 / 开局抢；view.bossHold 由 main 注入
        while (view.bossHold && view.bossHold()) await nextFrame()
      }
      while (lost) await nextFrame()
      curName = n
      await assets.loadAsset(n, lazyRun).catch(() => {})
      if (opts.prewarm !== false && !lost) for (const v of [squad, swarm, boss]) v.prewarm((m) => m === n, [n])
      if (/^unit\.hero_/.test(n) && !rest.slice(rest.indexOf(n) + 1).some((m) => /^unit\.hero_/.test(m))) Promise.all(pending).then(() => heroesDone())   // 最后一个指挥官也建好池子了
    }
    heroesDone()
    if (!battleSent) await sendBattle()
    else await Promise.all(pending)
    assets.setDefaultRunner(null)
    lazyBusy = false; ftN = 0; ftI = 0
    return rest.length
  })() : (battleDone(0), heroesDone(), Promise.resolve(0))
  if (!lazy && env.loadExtras) env.loadExtras().then((objs) => { if (objs.length && ctx.onPoolCreated) ctx.onPoolCreated(objs, 'env-extras') }).catch(() => {})
  return view

  /**
   * 并行编译着色器（KHR_parallel_shader_compile，不卡主线程；编好之前别去画它）。objs 不给 = 整个场景。
   * three 的程序缓存键里有「当前渲染目标」决定的色调映射 / 输出色彩空间：战斗画面画在 scenePass 的离屏目标上（不做色调映射），
   * 所以编译时也得把目标切过去，不然编出来的是画到屏幕上那一套、真画时还得现编。
   * 投影子的深度材质（customDepthMaterial）compile 不会碰，阴影图第一次画时才同步现编：给它们各套一个临时网格一起编
   */
  /** 这些对象的材质用到的全部贴图（材质属性上的 + uniforms 里的 + 顶点动画贴图），去重 */
  function texturesOf(objs) {
    const out = new Set()
    const scan = (m) => {
      if (!m) return
      for (const k in m) { const v = m[k]; if (v && v.isTexture) out.add(v) }
      for (const u of [m.uniforms, m.userData && m.userData.vatUniforms, m.userData && m.userData.extraUniforms]) if (u) for (const k in u) { const v = u[k] && u[k].value; if (v && v.isTexture) out.add(v) }
    }
    for (const r of objs) r.traverse((o) => { for (const m of [].concat(o.material || [])) scan(m); scan(o.customDepthMaterial) })
    return [...out].filter((t) => !t.isRenderTargetTexture)
  }
  /** 编译时要过一遍的对象：它们自己 + 投影子深度材质的临时网格（compileAll 用 noProxy 编这些就不会重复套） */
  function compileTargets(objs) {
    const out = objs.slice()
    for (const r of objs) r.traverse((o) => { const p = depthProxy(o); if (p) out.push(p) })
    return out
  }
  function depthProxy(o) {
    const d = o.castShadow && o.customDepthMaterial, m = o.material
    if (!d || !o.geometry || !m || Array.isArray(m)) return null
    // 照 three 阴影图（WebGLShadowMap.getDepthMaterial）画之前对深度材质做的改动先改好，程序缓存键才对得上（背面投影、贴图 / 裁剪参数跟主材质）
    d.side = m.shadowSide != null ? m.shadowSide : SHADOW_SIDE[m.side]
    d.alphaMap = m.alphaMap; d.alphaTest = m.alphaTest; d.map = m.map
    d.clipShadows = m.clipShadows; d.clippingPlanes = m.clippingPlanes; d.clipIntersection = m.clipIntersection
    d.displacementMap = m.displacementMap; d.displacementScale = m.displacementScale; d.displacementBias = m.displacementBias
    const p = new THREE.Mesh(o.geometry, d); p.isDepthProxy = true
    return p
  }
  function compileAll(objs, noProxy) {
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(scenePass.rt)
    const roots = objs || [scene], proxies = []
    if (!noProxy) for (const r of roots) r.traverse((o) => { const p = depthProxy(o); if (p) proxies.push(p) })
    for (const r of roots) if (r.isDepthProxy) proxies.push(r)
    const plain = objs ? roots.filter((r) => !r.isDepthProxy) : null
    let p
    const fog = scene.fog
    try {
      const list = plain ? plain.map((o) => renderer.compileAsync(o, camera, scene)) : [renderer.compileAsync(scene, camera)]
      // 阴影图是拿一个空场景画的（three 的 _emptyScene）：没有雾。雾在程序缓存键里，编深度材质时得先把雾摘掉，不然编出来的是用不上的变体
      scene.fog = null
      for (const m of proxies) list.push(renderer.compileAsync(m, camera, scene))
      p = Promise.all(list)
    } finally { scene.fog = fog; renderer.setRenderTarget(prev) }
    compiling++
    let left = true
    const done = () => { if (left) { left = false; compiling-- } }
    return Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, COMPILE_TIMEOUT_MS))]).then(done)
  }
  /**
   * 预热绘制：把场景里所有网格（包括暂时隐藏的特效 / 门 / 装置虚影、实例数为 0 的池子）临时亮出来，
   * 往场景离屏目标（同样的 MSAA 半浮点格式）+ 阴影图真画一遍，再原样恢复。
   * compile 只做到 link：阴影深度材质要真画才编；显卡驱动（Windows 上的 ANGLE / D3D11）还会按顶点格式 / 目标格式在第一次真画时再编一遍，
   * 这些都放在加载期做掉，不留给开局的头几秒。灯不动（灯的数量在程序缓存键里，动了反而编出用不上的变体）
   */
  function warmDraw(only) {
    if (lost) return
    const vis = new Map(), ic = new Map(), cnt = new Map(), dr = new Map(), cull = new Map()
    // only（对象数组）：只画这几个（和它们的子孙），其余网格临时藏起来——战斗中补进来的 Boss 用，别把整个场景多画一遍
    const keep = only ? new Set() : null
    if (only) for (const r of only) r.traverse((o) => keep.add(o))
    scene.traverse((o) => {
      if (o === scene || o.isLight || o.isCamera) return
      if (keep && !keep.has(o)) { if (o.visible && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { vis.set(o, true); o.visible = false } return }
      if (!o.visible) { vis.set(o, false); o.visible = true }
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        if (o.frustumCulled) { cull.set(o, true); o.frustumCulled = false }
        if (o.isInstancedMesh && o.count === 0) { cnt.set(o, 0); o.count = 1 }
        const g = o.geometry
        if (g && g.isInstancedBufferGeometry && g.instanceCount === 0 && !ic.has(g)) { ic.set(g, 0); g.instanceCount = 1 }
        if (g && g.drawRange && g.drawRange.count === 0 && !dr.has(g)) { dr.set(g, 0); g.drawRange.count = Infinity }
      }
    })
    // 原来就看不见的灯（在隐藏的组里）：亮出组的时候它也跟着亮了，要关回去，保持灯的数量和平时一致
    scene.traverse((o) => { if (o.isLight) { let p = o.parent, hidden = false; while (p) { if (vis.get(p) === false) { hidden = true; break } p = p.parent } if (hidden && o.visible) { vis.set(o, true); o.visible = false } } })
    const prev = renderer.getRenderTarget(), auto = renderer.shadowMap.autoUpdate
    try {
      renderer.shadowMap.autoUpdate = true; renderer.shadowMap.needsUpdate = true
      renderer.setRenderTarget(scenePass.rt); renderer.clear(); renderer.render(scene, camera)
    } catch (e) { console.warn('[render] 预热绘制失败：', e && e.message) } finally {
      renderer.setRenderTarget(prev); renderer.shadowMap.autoUpdate = auto
      for (const [o, v] of vis) o.visible = v
      for (const o of cull.keys()) o.frustumCulled = true
      for (const o of cnt.keys()) o.count = 0
      for (const g of ic.keys()) g.instanceCount = 0
      for (const g of dr.keys()) g.drawRange.count = 0
    }
    // 后处理链也真画一遍（Bloom 金字塔 / 调色 / 输出的程序）；画面上的内容下一帧就被正常画面盖掉
    if (!only) try { renderer.info.reset(); composer.render() } catch (e) { /* 没关系 */ }
  }
}
/** 首屏不加载、进首页以后后台补的资源：Boss、雇佣兵变体、开局没有的重装兵种、指挥官、中大型虫（加载顺序 = 注册顺序） */
// 指挥官 / 中大型虫也放后台：首页背景里它们晚一两秒出现不碍事，开局前早就到齐了（菜单里的指挥官头像本来就是 loadPortraits 异步出的）
const LAZY_DESKTOP = /^boss\.|^unit\.(goliath|merc_|reaper|lancer|skyhook|titan|psion|hero_)|^enemy\.(hulk|warden|digger|shieldbug|spitter|wing|egg)/
// 手机再多挪几样到首页之后补（首页背景里它们晚几秒出现）：甲壳兽、焚化兵、伙伴无人机、召唤物、空投舱。手机 CPU 慢 4~6 倍，这几样在加载页里要烘 2~3 秒
const LAZY = MOBILE ? new RegExp(LAZY_DESKTOP.source + /|^enemy\.crusher|^unit\.flamer|^companion\.|^summon\.|^prop\.pod/.source) : LAZY_DESKTOP
export { THEMES, THEME_IDS }
