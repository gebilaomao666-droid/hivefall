// HIVEFALL 界面层入口。DOM + CSS，不进 canvas；只读 world，玩家意图全部走 callbacks。接口与整合说明见 docs/UI.md。
//
//   const ui = createUI({ root, t, callbacks, portraits })
//   ui.setScreen('menu', { save })           // 切界面
//   ui.consume(world.events)                  // 每个模拟步
//   ui.update(world)                          // 每帧
//   ui.setLocale('en')                        // 语言切了之后重刷全部文案
//   ui.destroy()
import { h, setAssetBase, refreshPortraits } from './dom.js'
import { createBanners } from './banners.js'
import { createHud } from './hud.js'
import { createLevelup } from './levelup.js'
import { createMenu } from './menu.js'
import { createResult } from './result.js'
import { createSquadPanel } from './squadpanel.js'
import { createPause, createSettings, createBoard, createAchievements, createDaily, createLoading, createRotate, createCredits } from './overlays.js'

const CSS_FILES = ['base.css', 'hud.css', 'screens.css', 'mobile.css']
const OVERLAYS = ['paused', 'squad', 'settings', 'board', 'achievements', 'daily', 'credits', 'result']
const DEFAULT_SETTINGS = () => ({ lang: 'zh', quality: 'high', volume: { master: 0.8, music: 0.6, weapons: 0.8, swarm: 0.8, voice: 0.9, ui: 0.7 }, muted: false })

/** 把界面的样式表挂进 <head>（index.html 里已经静态写了 <link data-hf-ui> 的话就不重复挂） */
export function ensureStyles(doc = document) {
  if (doc.querySelector('link[data-hf-ui]')) return
  const add = href => { const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-hf-ui', ''); doc.head.appendChild(l) }
  add(new URL('../../assets/ui/fonts/fonts.css', import.meta.url).href)
  for (const f of CSS_FILES) add(new URL('./css/' + f, import.meta.url).href)
}

export function createUI({ root, t, callbacks = {}, portraits = {}, project = null, energyOrbs = false, keyboard = true, mobile = 'auto', lang = null, assetBase = null } = {}) {
  if (!root) throw new Error('createUI: root is required')
  if (typeof t !== 'function') throw new Error('createUI: t(key, params) is required')
  ensureStyles(root.ownerDocument)
  if (assetBase) setAssetBase(assetBase)

  const state = {
    base: 'none', stack: [], scale: 1, mobile: false, save: null, settings: DEFAULT_SETTINGS(), lang: lang || 'zh',
    world: null, daily: null, levelupOn: false, cover: false,
  }
  const stage = h('div', 'hf')
  stage.setAttribute('lang', state.lang)
  root.appendChild(stage)

  // ---------------------------------------------------------------- 提示浮层
  const tipEl = h('div', 'tip pn'), tipT = h('b', 'tip-t'), tipM = h('span', 'tip-m'), tipB = h('p', 'tip-b')
  tipEl.append(h('div', 'tip-h', tipT, tipM), tipB)
  tipEl.hidden = true
  let tipFor = null, tipTimer = 0
  const TIP_MS = 3500                            // 鼠标停着不动也只挂 3.5 秒，别让提示一直盖住旁边的按钮
  function showTip(el, fn, side) {
    const d = fn()
    if (!d) return
    tipFor = el
    tipT.textContent = d.title || ''; tipM.textContent = d.meta || ''; tipB.textContent = d.body || ''
    tipB.hidden = !d.body
    tipEl.hidden = false
    const s = state.scale, r = el.getBoundingClientRect(), base = stage.getBoundingClientRect()
    const W = base.width / s, H = base.height / s
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight
    let x, y
    if (side === 'right') {
      // 竖排列表（左上技能栏）：提示放到右侧，不压住同一列里的其它按钮
      x = (r.right - base.left) / s + 10
      y = (r.top + r.height / 2 - base.top) / s - th / 2
    } else {
      x = (r.left + r.width / 2 - base.left) / s - tw / 2
      y = (r.top - base.top) / s - th - 10
      if (y < 8) y = (r.bottom - base.top) / s + 10
    }
    x = Math.max(8, Math.min(W - tw - 8, x)); y = Math.max(8, Math.min(H - th - 8, y))
    tipEl.style.left = x.toFixed(0) + 'px'; tipEl.style.top = y.toFixed(0) + 'px'
    clearTimeout(tipTimer); tipTimer = setTimeout(() => hideTip(el), TIP_MS)
  }
  function hideTip(el) { if (!el || tipFor === el) { tipFor = null; tipEl.hidden = true; clearTimeout(tipTimer) } }
  /** 节点被重建 / 隐藏 / 换界面时 pointerleave 不会来，每帧兜底收掉 */
  function checkTip() {
    if (!tipFor) return
    if (!tipFor.isConnected || !tipFor.getClientRects().length) return hideTip()
    if ((state.levelupOn || state.stack.length) && hud.el.contains(tipFor)) hideTip()     // HUD 上的提示别压在三选一 / 浮层上面
  }
  // 换界面之后，鼠标原地不动时新界面上正好在指针下面的按钮会收到 pointerenter（开局时首页指挥官卡的位置就是战斗技能栏）：
  // 那不是玩家想看提示。换界面时记下指针位置，指针真的挪动过 6px 以上才重新允许弹提示
  let tipArmed = true, ptrX = -1, ptrY = -1, armX = 0, armY = 0
  root.ownerDocument.addEventListener('pointermove', e => {
    ptrX = e.clientX; ptrY = e.clientY
    if (!tipArmed && Math.abs(ptrX - armX) + Math.abs(ptrY - armY) > 6) {
      tipArmed = true
      const under = root.ownerDocument.elementFromPoint(ptrX, ptrY)
      const owner = under && under.closest && under.closest('[data-tip]')
      if (owner && owner._tip) showTip(owner, owner._tip.fn, owner._tip.side)
    }
  }, { passive: true, capture: true })
  function disarmTips() { tipArmed = false; armX = ptrX; armY = ptrY }
  function tip(el, fn, opt) {
    const side = opt && opt.side
    el._tip = { fn, side }; el.dataset.tip = ''
    el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch' && tipArmed) showTip(el, fn, side) })
    el.addEventListener('pointerleave', () => hideTip(el))
    el.addEventListener('pointerdown', () => hideTip(el))
  }

  // ---------------------------------------------------------------- 上下文（各子模块共用）
  const ctx = {
    t, callbacks, portraits, project, energyOrbs,
    scale: () => state.scale,
    mobile: () => state.mobile,
    settings: () => state.settings,
    save: () => state.save,
    lang: () => state.lang,
    changeLang(l) {
      if (l === state.lang) return
      state.settings.lang = l
      if (callbacks.setLocale) callbacks.setLocale(l)       // 约定：回调里同步切好 t 的语言
      api.setLocale(l)
    },
    open: name => open(name, true),
    close: () => close(true),
    tip,
  }

  const banners = createBanners(ctx)
  const hud = createHud(ctx, banners)
  const levelup = createLevelup(ctx)
  const menu = createMenu(ctx)
  const result = createResult(ctx)
  const squad = createSquadPanel(ctx)
  const pause = createPause(ctx)
  const settings = createSettings(ctx)
  const board = createBoard(ctx)
  const ach = createAchievements(ctx)
  const daily = createDaily(ctx)
  const credits = createCredits(ctx)
  const loading = createLoading(ctx)
  const rotate = createRotate(ctx)
  const dim = h('div', 'dim')
  dim.hidden = true
  hud.el.hidden = true; menu.el.hidden = true
  stage.append(hud.el, menu.el, dim, levelup.el, pause.el, squad.el, result.el, board.el, ach.el, daily.el, settings.el, credits.el, loading.el, tipEl, rotate.el)
  const panels = { paused: pause, squad, settings, board, achievements: ach, daily, credits, result }

  // ---------------------------------------------------------------- 尺寸：整个界面按 1600x900（手机 390 宽）等比缩放
  // 桌面按高度 900 缩放，但窄窗口（宽高比 < 16:9）时设计宽度最窄收到 1280、不再一路按 1600 缩：1024×900 的窗口字号从 0.64 倍提到 0.8 倍
  function layout() {
    const r = root.getBoundingClientRect()
    const W = r.width || window.innerWidth, H = r.height || window.innerHeight
    const isMobile = mobile === true || (mobile === 'auto' && W < 760 && H >= W)
    const s = isMobile ? Math.max(0.75, Math.min(1.7, Math.min(W / 390, H / 720))) : Math.max(0.55, Math.min(1.6, Math.min(W / 1280, H / 900)))
    state.scale = s
    if (state.mobile !== isMobile) { state.mobile = isMobile; stage.classList.toggle('hf-m', isMobile); hud.relabel() }
    stage.classList.toggle('hf-n', !isMobile && W / s < 1500)     // 窄桌面（设计宽度不到 1500）：底部控制台三栏收窄、两侧卡片抬到装置卡条上面
    stage.style.width = (W / s).toFixed(2) + 'px'; stage.style.height = (H / s).toFixed(2) + 'px'
    stage.style.transform = s === 1 ? '' : `scale(${s.toFixed(4)})`
    // 手机横过来：提示转回竖屏
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    rotate.el.hidden = !(coarse && W > H && H < 540)
  }
  const onResize = () => layout()
  window.addEventListener('resize', onResize)
  layout()

  // ---------------------------------------------------------------- 界面切换
  let lastRenderSig = ''
  function render() {
    const top = state.stack[state.stack.length - 1] || null
    hud.el.hidden = state.base !== 'hud'
    menu.el.hidden = state.base !== 'menu'
    loading.el.hidden = state.base !== 'loading' && !state.cover
    for (const name of OVERLAYS) if (name !== top && !panels[name].el.hidden) panels[name].hide()
    dim.hidden = !top && !state.levelupOn
    stage.classList.toggle('has-ov', !!top || state.levelupOn)
    stage.dataset.screen = top || (state.levelupOn ? 'levelup' : state.base)
    levelup.el.style.visibility = top ? 'hidden' : ''      // 三选一上面叠了暂停 / 部队面板：先把三选一藏起来，别两层叠在一起
    const sig = state.base + '|' + (top || '') + '|' + state.levelupOn
    if (sig !== lastRenderSig) { lastRenderSig = sig; disarmTips() }
    hideTip()
  }
  function showTop(data) {
    const top = state.stack[state.stack.length - 1]
    if (!top) return
    if (top === 'paused') pause.show(state.world)
    else if (top === 'squad') squad.show(state.world)
    else if (top === 'daily') daily.show(data || state.daily)
    else if (top === 'result') result.show(data)
    else panels[top].show(data)
  }
  /** 玩家自己打开的浮层：战斗中第一层会通知 main 停表 */
  function open(name, user, data) {
    if (state.stack[state.stack.length - 1] === name) return
    if (name === 'squad' && !state.world) return
    const wasEmpty = state.stack.length === 0
    state.stack.push(name)
    render(); showTop(data)
    if (user && wasEmpty && state.base === 'hud' && callbacks.pause) callbacks.pause(name)
  }
  function close(user) {
    const top = state.stack.pop()
    if (!top) return
    // 设置面板里改了画质 / 静音：HUD 和首页右上角那排按钮上的字要跟着变（原先还停在改之前的值）
    if (top === 'settings') { hud.relabel(); if (state.base === 'menu') menu.relabel() }
    render(); showTop()
    if (user && state.stack.length === 0 && state.base === 'hud' && top !== 'result' && callbacks.resume) callbacks.resume(top)
  }

  // ---------------------------------------------------------------- 键盘
  function onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    const tag = e.target && e.target.tagName
    if (tag === 'INPUT' && e.target.type !== 'range') return
    const k = e.key, top = state.stack[state.stack.length - 1] || null
    let used = false
    if (top === 'result') used = result.key(e)
    else if (top === 'paused') {
      if (k === ' ' || k === 'Escape' || k === 'p' || k === 'P' || k === 'Enter') { close(true); used = true }
      else if (k === 'Tab') { open('squad', true); used = true }
    } else if (top) {
      if (k === 'Escape' || (k === 'Tab' && top === 'squad') || (k === 'Enter' && top !== 'daily')) { close(true); used = true }
      else if (k === 'Tab') used = true
    } else if (state.levelupOn) {
      used = levelup.key(e)
      if (!used && k === 'Tab') { open('squad', true); used = true }
      // 三选一开着也能暂停：Esc / P 叠一层暂停菜单，关掉回到三选一
      else if (!used && (k === 'Escape' || k === 'p' || k === 'P')) { open('paused', true); used = true }
    } else if (state.base === 'menu') used = menu.key(e)
    else if (state.base === 'hud') {
      if (k === 'Escape') { if (hud.selected()) hud.select(null); else open('paused', true); used = true }
      else if (k === 'p' || k === 'P') { open('paused', true); used = true }
      else if (k === 'Tab') { open('squad', true); used = true }
      else if ((k >= '1' && k <= '8') || k === 'x' || k === 'X') used = hud.keySelect(k.toUpperCase())
      else if (k === 'q' || k === 'w' || k === 'e' || k === 'r' || k === 'Q' || k === 'W' || k === 'E' || k === 'R') {
        const key = k.toLowerCase()
        if (state.world && state.world.powers.some(p => p.key === key)) { callbacks.power && callbacks.power(key); used = true }
      }
    }
    if (used) { e.preventDefault(); e.stopPropagation() }
  }
  if (keyboard) window.addEventListener('keydown', onKey, true)

  // ---------------------------------------------------------------- 对外接口
  const api = {
    /** 每帧：按 world 刷新 HUD（文本 10Hz，条形每帧）；world.status === 'levelup' 时自动弹出三选一 */
    update(world) {
      state.world = world || null
      if (!world || state.base !== 'hud') return
      const now = performance.now()
      hud.update(world, now)
      banners.update(world, now)
      checkTip()
      const want = world.status === 'levelup' && world.levelup && state.stack.indexOf('result') < 0
      const on = levelup.sync(want ? world.levelup : null)
      if (on !== state.levelupOn) { state.levelupOn = on; render() }
    },
    /** 每个模拟步：world.events */
    consume(events) {
      if (state.base !== 'hud' || !events || events.length === 0) return
      banners.consume(events, state.world, hud)
    },
    /**
     * 切界面。name：
     *   'loading' { progress 0..1, textKey?, text?, tip? }
     *   'menu'    { save, selection?, daily?, version? }
     *   'hud'     （回到战斗，收掉所有浮层；data.reset 为 true 时清空上一局残留的横幅 / 卡片）
     *   'levelup' （= 'hud'；三选一由 update(world) 自己根据 world.levelup 弹）
     *   'paused' | 'squad' | 'settings' | 'board' | 'achievements' | 'daily' { dateKey, commander, mutators }
     *   'result'  { result: world.result(), outcome: applyResult(...) 的返回值, save, canContinue? }
     * 由 main 调用的 setScreen 不会反过来触发 callbacks.pause / resume。
     */
    setScreen(name, data) {
      data = data || {}
      if (data.save) { state.save = data.save; if (data.save.settings) state.settings = data.save.settings; if (state.settings.lang && state.settings.lang !== state.lang && !lang) state.lang = state.settings.lang }
      if (data.daily) state.daily = data.daily
      if (data.world) state.world = data.world
      if (name === 'loading') { state.base = 'loading'; state.stack.length = 0; loading.show(data); render(); return }
      if (name === 'menu') {
        state.base = 'menu'; state.stack.length = 0; state.levelupOn = false; levelup.sync(null)
        hud.reset(); banners.reset(); menu.show(data); render(); return
      }
      if (name === 'hud' || name === 'levelup' || name === 'playing') {
        if (state.base !== 'hud' || data.reset) { hud.reset(); banners.reset(); hud.relabel() }
        state.base = 'hud'; state.stack.length = 0; render(); return
      }
      if (OVERLAYS.indexOf(name) >= 0) {
        if (name === 'result') { state.base = 'hud'; state.stack.length = 0; state.levelupOn = false; levelup.sync(null); hud.select(null, true) }
        else if (name !== 'settings' && name !== 'squad' && name !== 'credits') state.stack.length = 0
        if (name === 'paused' || name === 'squad') { if (state.base === 'none') state.base = 'hud' }
        if (state.stack[state.stack.length - 1] !== name) state.stack.push(name)
        render(); showTop(name === 'daily' ? (data.dateKey ? data : state.daily) : data)
        return
      }
      throw new Error('setScreen: unknown screen ' + name)
    },
    /** 语言切了之后调（main 先把 t 的语言切好）。lang 可省略。 */
    setLocale(l) {
      if (l) { state.lang = l; state.settings.lang = l; stage.setAttribute('lang', l) }
      hud.relabel(); levelup.relabel(); rotate.relabel(); loading.relabel()
      if (state.base === 'menu') menu.relabel()
      for (const name of OVERLAYS) panels[name].relabel()
    },
    /** 头像晚到时补进来：{ 'unit.rifle': dataURL, 'commander.hawk': dataURL, 'speaker.ops': dataURL, ... } */
    setPortraits(map) { Object.assign(portraits, map || {}); refreshPortraits(stage, portraits) },
    /** 当前选中的装置卡（'sentry' | ... | 'remove' | null）；main 在右键 / 放置后可以用 selectDevice(null) 收掉 */
    selectedDevice: () => hud.selected(),
    selectDevice(kind) { hud.select(kind || null, true) },
    /** 晶能计数器图标的中心（相对 root 的 CSS 像素）：渲染层自己画光点时 view.setEnergyTarget(p.x, p.y) 用。HUD 没显示时返回 null */
    energyTarget() {
      const ic = hud.el.querySelector('.energy-ic')
      if (!ic || hud.el.hidden) return null
      const r = ic.getBoundingClientRect(), b = root.getBoundingClientRect()
      return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top }
    },
    /**
     * 加载页还盖着的时候，把战斗 HUD / 门卡 / 左下事件卡 / 通讯条 / 三选一面板各排一次版再收起来。
     * 这些界面第一次显示时浏览器要现算样式、按需加载中文字体分片、排版，开局那一帧要 30~50ms；第二次起只要几毫秒。
     * o: { world（首页摆拍的那一局即可）, events（攒下的界面事件）, gates（某一刻的 world.gates）, levelup（某一刻的 world.levelup）, menu（setScreen('menu') 的参数） }
     */
    warm(o) {
      const w = o && o.world
      if (!w) return
      const base = state.base, n0 = performance.now()
      try {
        state.base = 'hud'; state.world = w
        hud.reset(); banners.reset(); hud.relabel()
        hud.el.hidden = false                                     // 加载页（z-index 80，不透明）还盖在上面，玩家看不见
        const gw = o.gates ? Object.create(w, { gates: { value: o.gates } }) : w
        hud.update(gw, n0); banners.update(gw, n0)
        if (o.events && o.events.length) banners.consume(o.events, w, hud)
        banners.update(gw, n0 + 50)
        void stage.offsetWidth; api.energyTarget()
        if (o.levelup) { levelup.sync(o.levelup); void levelup.el.offsetWidth }
      } catch (e) { /* 预热失败不影响正常流程 */ }
      levelup.sync(null)
      // 首页也先排一次（首页同样是第一次显示：字体分片、图片、样式都要现算）
      if (o.menu) try { hud.el.hidden = true; menu.show(o.menu); menu.el.hidden = false; void stage.offsetWidth; menu.el.hidden = true } catch (e) { /* 同上 */ }
      hud.reset(); banners.reset()
      state.base = base; state.world = null
      render()
    },
    /** 切到首页之后让加载页再盖几帧：首页第一次上色 / 栅格化、3D 首页的头几帧都在加载页底下做完（cover(false) 撤掉） */
    cover(on) { state.cover = !!on; render() },
    /** 首页上玩家当前的选择 { commander, mutators, difficulty, draft, companion } */
    menuSelection: () => Object.assign({}, menu.selection()),
    screen: () => stage.dataset.screen,
    isMobile: () => state.mobile,
    scale: () => state.scale,
    resize: layout,
    el: stage,
    destroy() {
      window.removeEventListener('resize', onResize)
      if (keyboard) window.removeEventListener('keydown', onKey, true)
      if (stage.parentNode) stage.parentNode.removeChild(stage)
    },
  }
  render()
  return api
}
