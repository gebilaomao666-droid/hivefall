// 音乐状态机：menu → battle ⇄ battle_hi → boss → result，切换时等功率交叉淡化。
// 曲目用 <audio> 元素流式播放（不整首解码进内存），接进 Web Audio：
//   <audio> → 每首自己的淡入淡出增益 → 压低(duck)增益 → 低通(选卡/暂停时发闷) → music 通道
// 所有浏览器对象都从外面传进来（ctx / createElement / setTimeout），Node 里可以用假对象跑测试。

const CURVE_N = 24
const curveIn = peak => { const a = new Float32Array(CURVE_N); for (let i = 0; i < CURVE_N; i++) a[i] = Math.sin((i / (CURVE_N - 1)) * Math.PI / 2) * peak; return a }
const curveOut = from => { const a = new Float32Array(CURVE_N); for (let i = 0; i < CURVE_N; i++) a[i] = Math.cos((i / (CURVE_N - 1)) * Math.PI / 2) * from; return a }

export function createMusic({ basePath, ctx, out, config, createElement, setTimer }) {
  const duckGain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 20000
  duckGain.connect(filter)
  filter.connect(out)

  let ext = null                    // '.ogg' 或 '.mp3'，第一次建 <audio> 时探测
  let unlocked = false, hidden = false
  let state = null, want = null     // want = { state, track }：解锁前先记着
  let current = null                // 正在响的那一路
  const decks = []                  // 含正在淡出的
  const cursors = {}
  let duckUntil = 0
  const log = []                    // 最近的切换记录（调试面板 / 测试用）

  function pickExt(el) {
    if (ext) return ext
    let ok = ''
    try { ok = el.canPlayType ? el.canPlayType('audio/ogg; codecs="vorbis"') : 'maybe' } catch (e) { ok = '' }
    ext = ok ? '.ogg' : '.mp3'
    return ext
  }

  function makeDeck(id) {
    const el = createElement()
    el.loop = true
    el.preload = 'auto'
    el.src = basePath + 'music/' + id + pickExt(el)
    const gain = ctx.createGain()
    gain.gain.value = 0
    let node = null
    try { node = ctx.createMediaElementSource(el); node.connect(gain) } catch (e) { node = null }
    gain.connect(duckGain)
    const deck = { id, el, node, gain, level: 0, fading: false, endAt: 0, blocked: false, t0: ctx.currentTime }
    decks.push(deck)
    return deck
  }

  function startEl(deck) {
    if (hidden) return
    let p = null
    try { p = deck.el.play() } catch (e) { deck.blocked = true }
    if (p && p.catch) p.then(() => { deck.blocked = false }).catch(() => { deck.blocked = true })
  }

  function fadeIn(deck) {
    const now = ctx.currentTime, g = deck.gain.gain
    g.cancelScheduledValues(now)
    const from = deck.level
    deck.fading = false
    deck.level = config.volume
    if (from > 0.001) { g.setValueAtTime(from, now); g.linearRampToValueAtTime(config.volume, now + config.fade) }
    else g.setValueCurveAtTime(curveIn(config.volume), now, config.fade)
    deck.fullAt = now + config.fade
  }

  // 估算此刻这一路的音量（淡入没走完就被叫去淡出时，要从当时的音量往下走）
  function levelNow(deck) {
    const now = ctx.currentTime
    if (deck.fading) return 0
    if (!deck.fullAt || now >= deck.fullAt) return deck.level
    const p = 1 - (deck.fullAt - now) / config.fade
    return Math.sin(Math.max(0, p) * Math.PI / 2) * deck.level
  }

  function fadeOut(deck, fade = config.fade) {
    if (deck.fading) return
    const now = ctx.currentTime, g = deck.gain.gain
    const from = levelNow(deck)
    g.cancelScheduledValues(now)
    if (from > 0.0005) g.setValueCurveAtTime(curveOut(from), now, fade)
    else g.setValueAtTime(0, now)
    deck.level = from
    deck.fading = true
    deck.endAt = now + fade + 0.08
    setTimer(() => reap(), (fade + 0.15) * 1000)
  }

  function reap() {
    const now = ctx.currentTime
    for (let i = decks.length - 1; i >= 0; i--) {
      const d = decks[i]
      if (!d.fading || now < d.endAt) continue
      try { d.el.pause() } catch (e) { /* 元素可能已被移除 */ }
      try { if (d.node) d.node.disconnect(); d.gain.disconnect() } catch (e) { /* 已断开 */ }
      try { d.el.removeAttribute && d.el.removeAttribute('src'); d.el.load && d.el.load() } catch (e) { /* 释放网络连接，失败无妨 */ }
      decks.splice(i, 1)
    }
  }

  function playTrack(id, asState = null) {
    want = { state: asState, track: id }
    if (!unlocked) { state = asState; return }
    state = asState
    if (current && current.id === id && !current.fading) return
    const prev = current
    // 同一首正在淡出：直接拉回来，不从头放
    let deck = decks.find(d => d.id === id && d.fading)
    if (!deck) deck = makeDeck(id)
    current = deck
    startEl(deck)
    fadeIn(deck)
    if (prev && prev !== deck) fadeOut(prev)
    log.push({ t: ctx.currentTime, state: asState, track: id })
    if (log.length > 40) log.shift()
  }

  function setState(name) {
    const list = config.states[name]
    if (!list || !list.length) return
    if (name === (want && want.state)) return
    const i = cursors[name] === undefined ? 0 : (cursors[name] + 1) % list.length
    cursors[name] = i
    playTrack(list[i], name)
  }

  function stop(fade = config.fade) {
    want = null
    state = null
    if (current) { fadeOut(current, fade); current = null }
  }

  function unlock() {
    const first = !unlocked
    unlocked = true
    if (first && want) { const w = want; want = null; playTrack(w.track, w.state) }
    else for (const d of decks) if (d.blocked && !d.fading) startEl(d)
  }

  // 大音效（Boss 咆哮、胜利号角）响的时候把音乐压下去一会儿
  function duck(sec) {
    const now = ctx.currentTime, g = duckGain.gain
    if (now + sec <= duckUntil) return
    duckUntil = now + sec
    g.cancelScheduledValues(now)
    g.setTargetAtTime(config.duckTo, now, 0.06)
    g.setTargetAtTime(1, now + sec, 0.35)
  }

  let muffled = false
  function setMuffled(b) {
    b = !!b
    if (b === muffled) return
    muffled = b
    const now = ctx.currentTime
    filter.frequency.cancelScheduledValues(now)
    filter.frequency.setTargetAtTime(b ? config.muffleHz : 20000, now, 0.12)
  }

  function setHidden(b) {
    hidden = !!b
    for (const d of decks) {
      if (hidden) { try { d.el.pause() } catch (e) { /* 忽略 */ } }
      else if (!d.fading && unlocked) startEl(d)
    }
  }

  return {
    setState, playTrack, stop, unlock, duck, setMuffled, setHidden,
    tick: reap,
    get state() { return state },
    info() {
      return {
        state, track: current ? current.id : null, ext, muffled, unlocked,
        decks: decks.map(d => ({ id: d.id, fading: d.fading, blocked: d.blocked, time: d.el.currentTime || 0, duration: d.el.duration || 0 })),
        log: log.slice(),
      }
    },
  }
}
