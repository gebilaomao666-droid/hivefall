// HIVEFALL 入口：把模拟 / 渲染 / 界面 / 音频 / 输入 / 存档接成一局能玩的游戏。
// 状态机：boot → menu → play（⇄ 暂停 / 升级选卡 / 划线瞄准）→ result（→ 继续深入 = 原地进无尽 / 再来一局 / 回首页）。
// 主循环见 docs/ARCHITECTURE.md §6。这里是唯一允许碰 localStorage / Date / Math.random 的地方。
//
// URL 参数（调试 / 自测用，正常游玩都不需要）：
//   ?seed=123      固定本局种子          ?lang=zh|en    语言（会存档）
//   ?quality=low   画质                  ?fps=1         左上角显示帧率
//   ?unlock=1      解锁全部内容（写进存档） ?nopause=1     窗口失焦时不自动暂停（自动化测试用）
//   ?bg=0          首页不跑摆拍战场        ?mute=1        静音启动
import { createRenderer } from './render/renderer.js'
import { createUI } from './ui/ui.js'
import { createAudio } from './audio/audio.js'
import { createWorld, DT } from './sim/world.js'
import { createBot } from './sim/bot.js'
import { dailyConfig } from './sim/daily.js'
import { t, setLang, getLang } from './core/i18n.js'
import { loadSave, storeSave, applyResult, companionConfig, mergeSave, SAVE_KEY } from './core/save.js'
import { UNIT_KINDS } from './data/units.js'
import { DEVICE_KINDS } from './data/devices.js'
import { UNLOCK_IDS } from './data/unlocks.js'
import { CAMPAIGN_BOSS } from './data/bosses.js'
import { createInput } from './input.js'

const VERSION = 'v0.1'
const Q = new URLSearchParams(location.search)
const app = document.getElementById('app')
const canvas = document.getElementById('c')
const bootEl = document.getElementById('boot')
const bootMsg = document.getElementById('boot-msg')
const fpsEl = Q.get('fps') === '1' ? document.getElementById('fps') : null
if (fpsEl) fpsEl.hidden = false
const OVER = { won: 1, lost: 1, retreated: 1 }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()))
const sleep0 = () => new Promise(r => setTimeout(r, 0))

// ------------------------------------------------------------ 存档（localStorage 可能被禁：全部包一层）
let storage = null
try { storage = window.localStorage; storage.getItem(SAVE_KEY) } catch (e) { storage = null }
const firstRun = !storage || storage.getItem(SAVE_KEY) === null
const save = loadSave(storage)
if (firstRun) save.settings.lang = /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en'
if (Q.get('lang') === 'zh' || Q.get('lang') === 'en') save.settings.lang = Q.get('lang')
if (!save.settings.qv2) { save.settings.quality = 'high'; save.settings.qv2 = true }   // 一次性：旧版本会把偶发卡顿造成的自动降档永久存下来，这里统一恢复到高画质
if (save.settings.qualityAuto) { save.settings.quality = 'high'; save.settings.qualityAuto = false }
if (['high', 'mid', 'low'].includes(Q.get('quality'))) save.settings.quality = Q.get('quality')
const forceMute = Q.get('mute') === '1'      // 只管这一次启动，不写进存档
if (Q.get('unlock') === '1') { for (const id of UNLOCK_IDS) if (!save.unlocks.includes(id)) save.unlocks.push(id); save.companion.unlocked = true }
setLang(save.settings.lang)
document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN'
let saveTimer = 0
const persist = () => { if (storage) storeSave(storage, save) }
const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400) }

const todayKey = () => { const d = new Date(), p = n => (n < 10 ? '0' + n : '' + n); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const newSeed = () => (Q.has('seed') ? Number(Q.get('seed')) >>> 0 : ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0) || 1)

// ------------------------------------------------------------ 运行时状态
let view = null, ui = null, audio = null, input = null
let mode = 'boot'                 // boot | menu | play
let world = null                  // 正在打的这一局
let paused = false, acc = 0, hitstop = 0, endT = 0, resultShown = false
let seenNews = null
let lastCfg = null, snapshot = null   // snapshot：战役胜利入账之前的存档（继续打无尽后，用它重新入一次账，不重复计数）
let bg = null                     // 首页的摆拍战场 { world, bot, acc }
let bgNext = null                 // 后台预演中的下一场 { world, bot }
let theme = 'ash'
const frames = new Float32Array(600); let frameI = 0, frameN = 0
const errors = []
let bootMs = 0                    // 从打开页面到进首页用了多少毫秒
// 首页阶段后台补加载的模型（烘焙一个 100~400ms）和头像（离屏出图）全部到齐、并预热绘制过才算「可以开打」。
// 原来玩家进首页几秒内就点部署的话，这些都落在开局头几秒里做，画面一卡一卡的
let readyP = null, ready = false, startPending = null

// ------------------------------------------------------------ 界面回调（UI 不改 world，意图全从这里过）
const callbacks = {
  start(cfg) { requestStart(cfg) },
  again() { startRun(lastCfg || ui.menuSelection()) },
  home() { goMenu() },
  pause() { setPaused(true) },
  resume() { setPaused(false) },
  pickCard(i) { input.pick(i); audio.ui('confirm') },
  reroll() { input.reroll(); audio.ui('reroll') },
  power(key) { if (mode === 'play' && !paused) input.power(key) },
  selectDeviceCard(kind) { if (kind) audio.ui('select'); input.refreshPlacement() },
  retreat() { doRetreat() },
  codex() { persist(); location.href = 'codex.html' },   // 军械库是单独一页（相对路径：挂在子路径下也对）
  continueEndless() { doContinue() },
  menuSelect(sel) {   // 首页的指挥官 / 突变 / 难度选择写进存档（localStorage），刷新后还在
    const prev = JSON.stringify(save.menuSel || null), next = JSON.stringify(sel)
    if (prev !== next) { save.menuSel = sel; persistSoon() }
  },
  setQuality(q) { save.settings.quality = q; save.settings.qualityAuto = false; if (view) view.setQuality(q); persistSoon() },
  setVolume(ch, v) { save.settings.volume[ch] = v; audio.setVolume(ch, v); persistSoon() },
  setMuted(m) { save.settings.muted = m; audio.setMuted(m); persistSoon() },
  setLocale(l) {
    setLang(l); save.settings.lang = getLang()
    document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN'
    if (view) view.setTranslator(t)
    persistSoon()
  },
  fullscreen() {
    const d = document, el = d.documentElement
    const p = d.fullscreenElement ? d.exitFullscreen() : el.requestFullscreen ? el.requestFullscreen() : null
    if (p && p.catch) p.catch(() => {})
  },
}

// ------------------------------------------------------------ 首页的摆拍战场：真实 world + bot，无声演算
const BG_COMMANDERS = ['hawk', 'ysera', 'joe']
// 首页背景预演到哪一秒、何时换下一场：按战役 Boss 出场时刻折算（原来 101 秒出场时是 48 / 88）
const BG_WARM = Math.round(CAMPAIGN_BOSS.at * 0.47), BG_SWAP = CAMPAIGN_BOSS.at - 10
const LAZY_HOLD_SEC = 25            // 开局后多少秒（模拟时间）之内不做后台补加载（Boss 的分片烘焙）
const BOSS_MENU_HOLD_MS = 15000     // 首页出来后多少毫秒之内不开始补 Boss（首页前十几秒留给开局要用的模型和头像）
let menuAt = 0
const PORTRAIT_SIZE = 144
const UI_WARM_EV = { comms: 1, flankWarn: 1, bigHit: 1, gateResolve: 1, cardPicked: 1, deviceUnlock: 1, rankUp: 1, boon: 1, fence: 1, deviceDie: 1 }
function makeBg(seed) {
  const w = createWorld({ seed, commander: BG_COMMANDERS[seed % 3], difficulty: 'normal' })
  return { world: w, bot: createBot('good', seed), acc: 0 }
}
function stepBgWorld(b) {
  const w = b.world
  if (OVER[w.status]) return false
  w.step(b.bot(w))
  return true
}
/** 预演到 sec 秒（分片做，别卡住加载条） */
async function warmBg(b, sec, slice = 240, grab = null) {
  let n = 0
  while (b.world.time < sec && !OVER[b.world.status]) {
    if (grab) {   // 顺手攒一份界面预热用的素材：每种界面事件各留一条、某一刻的门、某一手三选一（见 ui.warm）
      const w = b.world
      if (w.status === 'levelup' && w.levelup && !grab.levelup) grab.levelup = w.levelup
      if (w.gates && !grab.gates) grab.gates = w.gates
    }
    stepBgWorld(b)
    if (grab) for (const e of b.world.events) if (UI_WARM_EV[e.type] && !grab.seen[e.type]) { grab.seen[e.type] = 1; grab.events.push(e) }
    if (++n % slice === 0) await sleep0()
  }
  return b
}
function tickBg(dtReal) {
  if (!bg) return
  const w = bg.world
  if (w.status === 'levelup') stepBgWorld(bg)
  else {
    bg.acc += Math.min(dtReal, 0.05) * (w.timeScale || 1)
    let n = 0
    while (bg.acc >= DT && n++ < 4) { if (!stepBgWorld(bg)) break; view.consume(w.events); bg.acc -= DT; if (w.status === 'levelup') break }
    if (n >= 4) bg.acc = 0
  }
  // 快打到 Boss 了（或者打完了）：后台预演下一场，好了再换，首页永远是「战况正酣」的那一段
  if (!bgNext && (w.time > BG_SWAP || OVER[w.status])) {     // Boss 出场前 10 秒换下一场；第 3 轮节奏改动后 Boss 72 秒出场，改读 CAMPAIGN_BOSS 不再写死
    const nb = makeBg(((w.seed * 7 + 13) >>> 0) % 9973 + 1)
    bgNext = nb
    warmBg(nb, BG_WARM, 24).then(() => { if (bgNext === nb && mode === 'menu') { bg = nb; bgNext = null; view.setWorld(bg.world) } else if (bgNext === nb) bgNext = null })
  }
}

// ------------------------------------------------------------ 开局 / 回首页 / 结算
/** 首页点部署：后台还没补完就先进加载页「正在部署」，催渲染层一口气补完，好了再开局（只有一进首页就点才会碰到，通常一两秒） */
function requestStart(cfg) {
  if (ready || !readyP) return startRun(cfg)
  const first = !startPending
  startPending = cfg || {}
  if (!first) return
  if (view.hurry) view.hurry(true)
  ui.setScreen('loading', { progress: 0.97, textKey: 'ui.load.deploy' })
  audio.ui('deploy')
  readyP.then(async () => {
    const c = startPending; startPending = null
    if (mode !== 'menu') return
    ui.cover(true)                     // 加载页再盖 4 帧：战斗界面第一次上色、开局最初几帧在盖着的时候过去
    startRun(c, true)
    for (let i = 0; i < 4; i++) await nextFrame()
    ui.cover(false)
  })
}
function startRun(cfg, quiet) {
  cfg = Object.assign({ commander: 'none', mutators: [], difficulty: 'normal', draft: 'script', companion: false, daily: false }, cfg || {})
  if (cfg.daily && !cfg.dateKey) cfg.dateKey = todayKey()
  lastCfg = cfg
  if (view.hurry) view.hurry(false)
  world = createWorld({
    seed: newSeed(), commander: cfg.commander, mutators: cfg.mutators, difficulty: cfg.difficulty, draft: cfg.draft,
    daily: !!cfg.daily, dateKey: cfg.dateKey || null,
    companion: companionConfig(save, !!cfg.companion),
  })
  mode = 'play'; paused = false; acc = 0; hitstop = 0; endT = 0; resultShown = false; snapshot = null; seenNews = null
  input.reset()
  view.setWorld(world)
  view.setGridLandmarks(true)
  view.setCameraMode('battle')
  setTheme('ash', 0.8)
  ui.setScreen('hud', { save, reset: true, world })
  audio.setPaused(false)
  if (!quiet) audio.ui('deploy')
  syncEnergyTarget()
}

function goMenu() {
  menuAt = performance.now()
  mode = 'menu'; world = null; paused = false; resultShown = false; snapshot = null; seenNews = null
  input.reset()
  audio.setPaused(false)
  audio.music.setState('menu')
  if (bg) view.setWorld(bg.world); else view.setWorld(null)
  view.setGridLandmarks(false)
  view.setCameraMode('menu')
  setTheme('ash', 1.2)
  ui.setScreen('menu', { save, selection: save.menuSel || null, daily: dailyConfig(todayKey()), version: VERSION })
}

function setPaused(on) {
  if (mode !== 'play' || paused === on) return
  paused = on
  if (on && world && world.notePause) world.notePause()     // 勋章「没停过」要知道整局暂停过没有（模拟层自己看不到暂停）
  input.release()
  audio.setPaused(on)
  audio.ui(on ? 'pause' : 'resume')
}

function setTheme(id, sec) { if (id && (id !== theme || sec === 0)) { theme = id; view.setTheme(id, sec) } }

/** 把这一局记进存档并弹结算。战役胜利后继续打无尽的，最后用「战役入账之前」的存档重新入一次账 */
function showResult() {
  resultShown = true
  input.reset()
  const result = world.result()
  if (snapshot) {
    const old = mergeSave(JSON.parse(snapshot))
    for (const k of Object.keys(old)) if (k !== 'settings') save[k] = old[k]
    snapshot = null
  }
  const again = seenNews                 // 战役那次结算已经播过的「新解锁 / 新勋章」，无尽结算时不再重复播
  if (result.outcome === 'won' && result.mode !== 'endless') snapshot = JSON.stringify(save)
  const bestBefore = save.best.score
  const outcome = applyResult(save, result, { now: Date.now() })
  // 战役里从暂停菜单主动放弃（loseReason 'abandon'）的局不上本机榜、不刷最高纪录：开局 5 秒撤离、10 杀也能挤进前三。
  // 累计统计照记（applyResult 已做），只撤掉榜单记录和最高分
  if (result.reason === 'abandon') {
    if (outcome.entry) { save.board = save.board.filter(e => e !== outcome.entry); outcome.rank = 0; outcome.entry = null }
    if (outcome.newBest) { save.best.score = bestBefore; outcome.newBest = false }
  }
  if (again) {
    outcome.newUnlocks = outcome.newUnlocks.filter(id => !again.unlocks.includes(id))
    outcome.newAchievements = outcome.newAchievements.filter(id => !again.achievements.includes(id))
  }
  seenNews = snapshot ? { unlocks: outcome.newUnlocks.slice(), achievements: outcome.newAchievements.slice() } : null
  persist()
  ui.setScreen('result', { result, outcome, save, canContinue: true })
}

function doContinue() {
  if (mode !== 'play' || !world || world.status !== 'won') return
  input.reset()
  input.continueEndless()
  stepOnce()
  if (world.phase !== 'endless') return
  resultShown = false; endT = 0; acc = 0; paused = false
  ui.setScreen('hud', { save, world })
  audio.setPaused(false)
  audio.ui('deploy')
}

// 暂停菜单「撤离并结算」：无尽 = 撤离保分；战役 = 放弃本局，按失败（loseReason 'abandon'）结算，成绩照记。
// 两种都由模拟层 step() 读 input.retreat / input.abandon 正式收尾（world.js finish），主循环不再直接改 world 状态
function doRetreat() {
  if (mode !== 'play' || !world || OVER[world.status]) return
  paused = false
  audio.setPaused(false)
  input.reset()
  if (world.phase === 'endless') input.retreat(); else input.abandon()
  stepOnce()
  showResult()
}
// ------------------------------------------------------------ 主循环
function stepOnce() {
  world.step(input.collect(world))
  const ev = world.events
  if (ev.length === 0) return
  view.consume(ev); audio.consume(ev); ui.consume(ev)
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]
    if (e.type === 'hitstop') hitstop = Math.max(hitstop, clamp((e.ms || 50) / 1000, 0.04, 0.07))
    else if (e.type === 'layer') setTheme(e.theme, 1.6)
  }
}

function tickPlay(dtReal) {
  const st = world.status
  if (OVER[st]) {
    // 结束：留一小段时间看完最后的演出再弹结算
    if (!resultShown) { endT += dtReal; if (endT > (st === 'won' ? 1.3 : st === 'lost' ? 1.5 : 0.1)) showResult() }
    return
  }
  if (paused) return
  if (st === 'levelup') { if (input.hasChoice()) stepOnce(); return }
  if (hitstop > 0) { hitstop -= dtReal; return }
  acc += Math.min(dtReal, 0.05) * (world.timeScale || 1)
  let n = 0
  while (acc >= DT && n++ < 5) {
    stepOnce(); acc -= DT
    if (world.status === 'levelup' || OVER[world.status] || hitstop > 0) break
  }
  if (n >= 5) acc = 0
}

let last = performance.now(), slowT = 0
function frame(now) {
  requestAnimationFrame(frame)
  const dtReal = clamp((now - last) / 1000, 0, 0.1); last = now
  tick(dtReal)
}
function tick(dtReal) {
  if (dtReal > 0) { frames[frameI] = dtReal; frameI = (frameI + 1) % frames.length; if (frameN < frames.length) frameN++ }
  if (mode === 'play' && world) {
    tickPlay(dtReal)
    input.update(world)
    view.render(acc / DT, dtReal)
    audio.update(world, dtReal)
    ui.update(world)
  } else if (mode === 'menu' && startPending) {
    audio.update(null, dtReal)          // 「正在部署」加载页盖着：首页摆拍战场先不演算也不画，整帧留给后台补加载
  } else if (mode === 'menu') {
    tickBg(dtReal)
    view.render(bg ? bg.acc / DT : 1, dtReal)
    audio.update(null, dtReal)          // 摆拍战场不出声
  }
  view.pollFloaters()                    // 飘字由 UI 自己按 bigHit 出；渲染层攒的锚点取走丢掉，别让它一直涨
  slowT += dtReal
  if (slowT > 0.5) {
    slowT = 0
    if (mode === 'play') syncEnergyTarget()
    if (fpsEl) { const s = view.stats(); fpsEl.textContent = `${s.fps.toFixed(0)} fps · ${s.calls} dc · ${(s.tris / 1e6).toFixed(2)}M · ${s.quality}` }
  }
}
function syncEnergyTarget() { const p = ui.energyTarget(); if (p) view.setEnergyTarget(p.x, p.y) }

// ------------------------------------------------------------ 失焦自动暂停
function autoPause() {
  if (Q.get('nopause') === '1') return
  if (input) input.release()
  if (mode !== 'play' || !world || paused || OVER[world.status] || world.status === 'levelup') return
  ui.setScreen('paused', { world })     // main 调的 setScreen 不会回调 pause：自己停表
  setPaused(true)
}
window.addEventListener('blur', autoPause)
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause() })
window.addEventListener('beforeunload', persist)

// 浏览器要有一次手势才给出声
function unlockAudio() { if (audio) audio.unlock() }
window.addEventListener('pointerdown', unlockAudio, true)
window.addEventListener('keydown', unlockAudio, true)
// 界面按钮的点击音
app.addEventListener('click', e => { if (audio && e.target && e.target.closest && e.target.closest('button')) audio.ui('click') }, true)
// 别让浏览器自己的手势抢戏（右键菜单、拖拽选中、空格滚动）
app.addEventListener('contextmenu', e => e.preventDefault())
window.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Tab' || e.key.indexOf('Arrow') === 0) && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault() })

window.addEventListener('error', e => { errors.push(String(e.message || e.error)); if (mode === 'boot' && bootMsg) bootMsg.textContent = 'ERROR: ' + (e.message || e.error) })
window.addEventListener('unhandledrejection', e => { errors.push(String(e.reason && e.reason.message || e.reason)); if (mode === 'boot' && bootMsg) bootMsg.textContent = 'ERROR: ' + (e.reason && e.reason.message || e.reason) })

// ------------------------------------------------------------ 头像：渲染层离屏出图，出一张补一张
const portraitMap = {}
const COMMANDER_PORTRAITS = [...['hawk', 'ysera', 'joe'].map(id => ['commander.' + id, 'commander.' + id]), ['commander.none', 'unit.rifle']]
async function loadPortraits(want) {
  const map = portraitMap
  if (!want) want = [
    ...COMMANDER_PORTRAITS,               // 加载页里已经出好的会被下面滤掉；没来得及的这里补
    ...UNIT_KINDS.map(k => ['unit.' + k, 'unit.' + k]),
    ...DEVICE_KINDS.map(k => ['device.' + k, 'device.' + k]),
    ['companion.seven', 'companion.armed'],
  ].filter(([key]) => !map[key])
  let n = 0
  for (const [key, name] of want) {
    try {
      const url = await view.loadPortrait(name, PORTRAIT_SIZE)
      if (url) map[key] = url
    } catch (e) { /* 缺一张就用图标占位 */ }
    if (++n % 6 === 0) { ui.setPortraits(map); await nextFrame() }
  }
  ui.setPortraits(map)
  return map
}

// ------------------------------------------------------------ 启动
async function boot() {
  ui = createUI({ root: app, t, callbacks, portraits: {}, project: (x, y, z) => (view ? view.project(x, y, z) : null), energyOrbs: false, lang: getLang() })
  let pAudio = 0, pView = 0, pBg = 0, tip = (Math.random() * 4) | 0
  const showLoad = () => ui.setScreen('loading', { save, progress: 0.04 + pAudio * 0.16 + pView * 0.62 + pBg * 0.18, tip })
  showLoad()
  if (bootEl) bootEl.remove()

  audio = createAudio({ basePath: 'assets/audio/' })
  for (const ch of Object.keys(save.settings.volume)) audio.setVolume(ch, save.settings.volume[ch])
  audio.setMuted(forceMute || !!save.settings.muted)
  audio.music.setState('menu')
  const audioReady = audio.preload(p => { pAudio = p; showLoad() }).catch(() => {}).then(() => { pAudio = 1 })

  // 渲染器：一个大 await（下载模型 + 烘焙顶点动画贴图 + 编译着色器）。中间拿不到进度，让进度条自己慢慢爬
  const creep = setInterval(() => { pView += (0.92 - pView) * 0.035; showLoad() }, 120)
  const tipTimer = setInterval(() => { tip++; showLoad() }, 3600)
  try {
    view = await createRenderer({ canvas, quality: save.settings.quality, theme: 'ash' })
  } finally { clearInterval(creep) }
  pView = 1; showLoad()
  view.setTranslator(t)
  view.onQualityChange = q => { save.settings.quality = q; save.settings.qualityAuto = true; ui.setLocale(); persistSoon() }   // 自动降的档只在本次有效：下次打开从高画质重新判断，避免偶发卡顿把画质永久压低     // 自动降档：把界面上的画质字样也刷掉
  view.onResize = () => syncEnergyTarget()
  // 显卡上下文被浏览器收回（开了太多 3D 标签页、驱动重置）：画面会变成一片空白。先暂停，给一句人话和一个重新加载的按钮
  view.onContextLost = () => {
    if (mode === 'play' && world && !OVER[world.status] && !paused) { ui.setScreen('paused', { world }); setPaused(true) }
    if (document.getElementById('gl-lost')) return
    const box = document.createElement('div')
    box.id = 'gl-lost'
    box.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99;padding:10px 16px;background:rgba(40,12,10,.94);color:#ffd9d2;font:600 15px/1.4 system-ui,sans-serif;box-shadow:inset 0 0 0 1px #ff4d3d;display:flex;gap:12px;align-items:center'
    box.textContent = t('ui.gl_lost')
    const btn = document.createElement('button')
    btn.textContent = t('ui.gl_reload')
    btn.style.cssText = 'font:inherit;padding:4px 12px;background:#ffb02e;color:#1a1204;border:0;cursor:pointer'
    btn.onclick = () => { persist(); location.reload() }
    box.appendChild(btn)
    document.body.appendChild(box)
  }
  view.onContextRestored = () => { const b = document.getElementById('gl-lost'); if (b) b.remove() }
  input = createInput({
    canvas, view, ui, getWorld: () => world,
    isLive: () => mode === 'play' && !paused && !!world && !OVER[world.status] && world.status !== 'levelup',
    onGamepadPause: () => { if (mode === 'play' && world && !OVER[world.status]) { if (paused) { ui.setScreen('hud'); setPaused(false) } else { ui.setScreen('paused', { world }); setPaused(true) } } },
  })

  // 首页背景：预演到虫群压上来的那一段
  if (Q.get('bg') !== '0') {
    bg = makeBg((Date.now() % 9973) + 1)
    const target = BG_WARM       // 时间轴又 ×0.92/1.3，按 Boss 出场时刻的比例算（≈34 秒）。原注：时间轴压成 1.3 倍后，原来的 72 秒 ≈ 现在的 48 秒：队伍 40 多人、第一波大的压上来。预演少跑三分之一，冷启动也快一截
    const prog = setInterval(() => { pBg = clamp(bg.world.time / target, 0, 1); showLoad() }, 100)
    const grab = { events: [], seen: {}, gates: null, levelup: null }
    await warmBg(bg, target, 240, grab)
    clearInterval(prog)
    if (view.warmPortraits) view.warmPortraits(PORTRAIT_SIZE)
    ui.warm({ world: bg.world, ...grab, menu: { save, selection: save.menuSel || null, daily: dailyConfig(todayKey()), version: VERSION } })     // 战斗界面 / 首页先在加载页底下排一次版
  }
  pBg = 1; showLoad()
  // 三位指挥官的模型和首页卡片上的头像在加载页里做完（首页一出来就要显示；放到首页里做，首页头一秒会卡几下）。
  // 后台补加载的预算在加载页里放大；最多等 1.5 秒，没做完就留给首页接着做
  if (view.hurry) {
    view.hurry(true)
    const heads = view.heroesReady ? view.heroesReady.then(() => loadPortraits(COMMANDER_PORTRAITS)) : loadPortraits(COMMANDER_PORTRAITS)
    await Promise.race([heads.catch(() => {}), new Promise(r => setTimeout(r, 1500))])
    view.hurry(false)
  }
  await Promise.race([audioReady, new Promise(r => setTimeout(r, 4000))])     // 音效没解码完也不等了，边玩边到
  clearInterval(tipTimer)

  ui.cover(true)
  goMenu()
  view.setCameraMode('menu', true)
  // 首页背景先走半秒表现（特效池里有东西），再把画面交出去
  for (let i = 0; i < 30 && bg; i++) { stepBgWorld(bg); view.consume(bg.world.events); view.render(1, DT) }
  last = performance.now()
  requestAnimationFrame(frame)
  // 加载页再盖 6 帧：首页界面第一次上色 / 栅格化、3D 首页最初几帧（显卡那边第一次画这些东西最慢）都在盖着的时候过去
  for (let i = 0; i < 6; i++) await nextFrame()
  ui.cover(false)
  bootMs = Math.round(performance.now())
  // 开局前要齐的：除 Boss 外的后台模型（view.battleReady）+ 头像。Boss 在后台接着补；开局头 25 秒先停着别跟战斗抢主线程
  view.lazyHold = () => mode === 'play' && !!world && !OVER[world.status] && world.time < LAZY_HOLD_SEC
  view.bossHold = () => (mode === 'menu' && performance.now() - menuAt < BOSS_MENU_HOLD_MS) || view.lazyHold()
  readyP = Promise.all([(view.battleReady || view.lazyReady).catch(() => {}), loadPortraits().catch(() => {})]).then(() => { ready = true })
}

// ------------------------------------------------------------ 调试 / 自测接口（控制台：__hf）
window.__hf = {
  get world() { return world }, get view() { return view }, get ui() { return ui }, get audio() { return audio }, get input() { return input },
  get mode() { return mode }, get paused() { return paused }, get bg() { return bg }, get bootMs() { return bootMs }, get ready() { return ready }, save, errors,
  /** 最近 n 帧的帧率统计 */
  perf(n = 300) {
    n = Math.min(n, frameN)
    const a = []
    for (let i = 0; i < n; i++) a.push(frames[(frameI - 1 - i + frames.length * 2) % frames.length])
    a.sort((x, y) => x - y)
    const avg = a.reduce((p, c) => p + c, 0) / Math.max(1, a.length)
    const s = view ? view.stats() : {}
    return { frames: n, avgFps: +(1 / avg).toFixed(1), medianMs: +((a[a.length >> 1] || 0) * 1000).toFixed(2), p99Ms: +((a[Math.floor(a.length * 0.99)] || 0) * 1000).toFixed(2), calls: s.calls, tris: s.tris, quality: s.quality, dpr: s.dpr, swarm: s.swarm, width: s.width, height: s.height }
  },
  /** 手动推进（标签页在后台、rAF 不跑时用）：按 60 fps 连跑 sec 秒 */
  advance(sec = 1) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) tick(DT) },
  start: cfg => startRun(cfg), menu: goMenu, persist,
}

boot().catch(err => {
  console.error(err)
  errors.push(String(err && err.message || err))
  if (bootMsg) bootMsg.textContent = 'ERROR: ' + (err && err.message || err)
  const box = document.createElement('div')
  box.id = 'fatal'
  box.textContent = 'HIVEFALL failed to start: ' + (err && err.message || err)
  document.body.appendChild(box)
})
