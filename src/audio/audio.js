// HIVEFALL 音频层。只读事件与世界状态，不改 world。
//
//   const audio = createAudio({ basePath: 'assets/audio/' })
//   await audio.preload(p => 进度条(p))      // 取回并解码 soundmap 用到的全部音效（约 2.5MB）
//   audio.unlock()                           // 必须在用户第一次点击 / 按键的回调里调用（浏览器自动播放策略）
//   audio.music.setState('menu')
//   每个模拟步：audio.consume(world.events)；每帧：audio.update(world, dtReal)
//
// 声音怎么配全在 soundmap.js；这里只有引擎：通道、节流、变体轮播、并发上限、抢占、循环声、页面隐藏静音。
// 浏览器对象（AudioContext / fetch / document / Audio）都可以从 deps 注入，tools/test-audio.mjs 用假对象在 Node 里跑同一份代码。
import { CHANNELS, DEFAULT_VOLUME, LIMITS, SFX, EVENT_MAP, UI_MAP, STATE, MUSIC, usedSfxFiles } from './soundmap.js'
import { createMusic } from './music.js'

const G = typeof globalThis !== 'undefined' ? globalThis : {}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const SFX_CHANNELS = CHANNELS.filter(c => c !== 'master' && c !== 'music')
const LIVE = { running: 1, aiming: 1, levelup: 1 }
const OVER = { won: 1, lost: 1, retreated: 1 }

export function createAudio({ basePath = 'assets/audio/', deps = {} } = {}) {
  if (basePath && !basePath.endsWith('/')) basePath += '/'
  const Ctx = deps.AudioContext || G.AudioContext || G.webkitAudioContext
  const doFetch = deps.fetch || (G.fetch ? G.fetch.bind(G) : null)
  const doc = deps.document !== undefined ? deps.document : G.document
  const random = deps.random || Math.random
  const setTimer = deps.setTimeout || ((fn, ms) => G.setTimeout(fn, ms))
  const createElement = deps.createElement || (() => new G.Audio())

  let ctx = null
  try { if (Ctx) ctx = new Ctx({ latencyHint: 'interactive' }) } catch (e) { ctx = null }
  const enabled = !!ctx

  // ------------------------------------------------------------ 通道：各路 Gain → master → 压限 → 输出
  const volume = { ...DEFAULT_VOLUME }
  const bus = {}
  let master = null, music = null
  let muted = false, hidden = false, paused = false, unlocked = false
  if (enabled) {
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22
    master = ctx.createGain()
    master.gain.value = volume.master
    master.connect(comp)
    comp.connect(ctx.destination)
    for (const c of CHANNELS) {
      if (c === 'master') continue
      bus[c] = ctx.createGain()
      bus[c].gain.value = volume[c]
      bus[c].connect(master)
    }
    music = createMusic({ basePath, ctx, out: bus.music, config: MUSIC, createElement, setTimer })
  }

  // ------------------------------------------------------------ 把映射表编译成查得快的结构
  const keyStates = new Map()
  const keyState = name => {
    let k = keyStates.get(name)
    if (!k) { k = { name, last: -1e9, active: 0, winT0: 0, winN: 0, rate: 0, played: 0, throttled: 0, dropped: 0, missing: 0 }; keyStates.set(name, k) }
    return k
  }
  function compileRule(r, autoKey) {
    const files = SFX[r.sfx]
    if (!files || !files.length) throw new Error(`soundmap: 没有这个音效组 "${r.sfx}"（${autoKey}）`)
    const ch = r.ch || 'weapons'
    const c = {
      sfx: r.sfx, files, ch, k: keyState(r.key || autoKey),
      gap: (r.gap === undefined ? 60 : r.gap) / 1000,
      vol: r.vol === undefined ? 0.5 : r.vol,
      pitch: r.pitch === undefined ? 0.05 : r.pitch,
      rate: r.rate || 1, prio: r.prio === undefined ? 2 : r.prio, max: r.max || 6,
      delay: r.delay || 0, dur: r.dur || 0, duck: r.duck || 0,
      pan: r.pan === undefined ? (ch !== 'ui' && ch !== 'voice') : !!r.pan,
      loop: !!r.loop, hold: r.hold === undefined ? 0.35 : r.hold,
      cursor: Math.floor(random() * files.length), dense: null, over: 0,
    }
    if (r.dense) {
      c.over = r.dense.over
      c.dense = compileRule({ ...r, ...r.dense, dense: undefined, key: r.key || autoKey }, autoKey)
    }
    return c
  }
  const compileList = (r, autoKey) => (r == null ? null : Array.isArray(r) ? r.map((x, i) => compileRule(x, `${autoKey}#${i}`)) : [compileRule(r, autoKey)])
  const compiled = new Map()
  for (const [type, m] of Object.entries(EVENT_MAP)) {
    if (m && m.cases) {
      const cases = new Map()
      for (const [c, r] of Object.entries(m.cases)) if (c !== '_') cases.set(c, compileList(r, `${type}:${c}`))
      compiled.set(type, { by: Array.isArray(m.by) ? m.by : [m.by], cases, def: compileList(m.cases._, `${type}:_`) })
    } else compiled.set(type, { by: null, cases: null, def: compileList(m, type) })
  }
  const uiRules = {}
  for (const [name, r] of Object.entries(UI_MAP)) uiRules[name] = compileList(r, `ui:${name}`)
  const stateRules = {
    ambient: compileRule({ ...STATE.ambient, loop: true }, 'state:ambient'),
    hbSlow: compileRule({ ...STATE.heartbeat.slow, loop: true }, 'state:heartbeat_slow'),
    hbFast: compileRule({ ...STATE.heartbeat.fast, loop: true }, 'state:heartbeat_fast'),
    bed: compileRule({ ...STATE.swarmBed, gap: 0, pan: true }, 'state:swarm_bed'),
    bedAlt: compileRule({ ...STATE.swarmBed, sfx: STATE.swarmBed.alt, gap: 0, pan: true, key: 'state:swarm_bed' }, 'state:swarm_bed'),
    foot: compileRule({ ...STATE.footsteps, pan: true }, 'state:footstep'),
    footHeavy: compileRule({ ...STATE.footsteps.heavy, pan: true }, 'state:footstep_heavy'),
  }

  // ------------------------------------------------------------ 素材
  const buffers = new Map()        // 文件名 → AudioBuffer
  const loading = new Map()        // 文件名 → Promise
  const failed = new Set()
  function decode(arrayBuffer) {
    return new Promise((resolve, reject) => {
      let p = null
      try { p = ctx.decodeAudioData(arrayBuffer, resolve, reject) } catch (e) { reject(e); return }
      if (p && p.then) p.then(resolve, reject)
    })
  }
  function loadFile(name) {
    if (!enabled || !doFetch) return Promise.resolve(null)
    if (buffers.has(name)) return Promise.resolve(buffers.get(name))
    if (loading.has(name)) return loading.get(name)
    const p = doFetch(`${basePath}sfx/${name}.ogg`)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer() })
      .then(decode)
      .then(buf => { buffers.set(name, buf); loading.delete(name); return buf })
      .catch(() => { failed.add(name); loading.delete(name); return null })
    loading.set(name, p)
    return p
  }
  function preload(onProgress) {
    const files = usedSfxFiles()
    const total = files.length
    if (!enabled || !total) { if (onProgress) onProgress(1); return Promise.resolve({ total, loaded: 0, failed: total }) }
    let done = 0, next = 0
    return new Promise(resolve => {
      const pump = () => {
        if (done >= total) { resolve({ total, loaded: total - failed.size, failed: failed.size }); return }
        while (next < total && next - done < 6) {
          const name = files[next++]
          loadFile(name).then(() => { done++; if (onProgress) onProgress(done / total, name); pump() })
        }
      }
      pump()
    })
  }

  // ------------------------------------------------------------ 发声
  const voices = []
  const st = { peakVoices: 0, played: 0, throttled: 0, dropped: 0, stolen: 0, preempted: 0, events: 0 }
  const api = { onPlay: null }
  const ready = () => enabled && unlocked && !hidden && !paused && ctx.state === 'running'

  function release(v) {
    if (v.dead) return
    v.dead = true
    v.k.active--
    const i = voices.indexOf(v)
    if (i >= 0) voices.splice(i, 1)
    try { v.tail.disconnect() } catch (e) { /* 已断开 */ }
  }
  // 正在淡出的尾巴（被顶掉的声音还要响 stealFade 秒）：同一帧里顶掉太多个，尾巴 + 新声会冲破声源预算。
  // 尾巴不超过 TAIL_MAX 个；超了就丢新来的，不再顶
  const TAIL_MAX = 6
  let tails = [], topT = -1
  const tailsBusy = now => { if (tails.length) tails = tails.filter(t => t > now); return tails.length >= TAIL_MAX }
  function fadeStop(v, fade) {
    const now = ctx.currentTime
    tails.push(now + fade + 0.01)
    try {
      v.g.gain.cancelScheduledValues(now)
      v.g.gain.setValueAtTime(v.vol, now)
      v.g.gain.linearRampToValueAtTime(0, now + fade)
      v.src.stop(now + fade + 0.01)
    } catch (e) { /* 已经停了 */ }
    release(v)
  }

  function startVoice(r, now, x, z, holdLoop) {
    const k = r.k
    r.cursor = (r.cursor + 1 + (r.files.length > 2 && random() < 0.3 ? 1 : 0)) % r.files.length
    const file = r.files[r.cursor]
    const buffer = buffers.get(file)
    if (!buffer) { k.missing++; if (!failed.has(file)) loadFile(file); return null }
    // 同类同时数
    if (k.active >= r.max) {
      let victim = null
      for (const v of voices) if (v.k === k && !v.loop && (!victim || v.t0 < victim.t0)) victim = v
      const age = victim ? now - victim.t0 : 0
      // 最老的那个已经响过主体（过半或超过 0.35 秒）才顶掉它，否则丢掉新来的：短促的声音不被反复腰斩，长尾巴让位给新的
      if (victim && (age > 0.35 || age > victim.len * 0.5) && !tailsBusy(now)) { fadeStop(victim, LIMITS.stealFade); st.stolen++ }
      else { k.dropped++; st.dropped++; return null }
    }
    // 全局并发上限
    if (voices.length >= LIMITS.maxVoices) {
      if (r.prio < LIMITS.preemptPrio) { k.dropped++; st.dropped++; return null }
      let victim = null
      for (const v of voices) if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v
      if (!victim || victim.prio >= r.prio || (r.prio < 8 && tailsBusy(now))) { k.dropped++; st.dropped++; return null }   // 最高优先级（Boss / 结算）照样顶
      // 同一帧里叠着来的几层 prio 9（Boss 倒下 bossDie 三层一起顶人）：第一层照样顶，尾巴已经很多时后面几层省掉。
      // 否则声源总数（在响的 + 淡出中的尾巴）会冲出预算 maxVoices + 8（阵型修正后无尽深层老猫 + 渊噬蠕虫实测 65）
      if (r.prio >= 9 && topT === now && tails.length >= TAIL_MAX + 2) { k.dropped++; st.dropped++; return null }
      if (r.prio >= 9) topT = now
      fadeStop(victim, LIMITS.stealFade)
      st.preempted++
    }
    let vol = r.vol / Math.sqrt(1 + k.active * LIMITS.crowd)
    if (r.pan && z === z && z !== null) vol *= LIMITS.farGain + (1 - LIMITS.farGain) * clamp((z - LIMITS.farZ) / (LIMITS.nearZ - LIMITS.farZ), 0, 1)
    const rate = r.rate * (1 + (random() * 2 - 1) * r.pitch)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = vol
    src.connect(g)
    let tail = g
    if (r.pan && x === x && x !== null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = clamp(x / LIMITS.bridgeHalf, -1, 1) * LIMITS.panWidth
      g.connect(p)
      tail = p
    }
    tail.connect(bus[r.ch] || bus.weapons)
    const at = now + r.delay
    let len = buffer.duration / rate
    const v = { src, g, tail, k, prio: r.prio, t0: now, len: len + r.delay, loop: !!holdLoop, vol, dead: false, holdUntil: 0, rule: r }
    if (holdLoop) {
      src.loop = true
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(vol, now + 0.08)
      src.start(now, random() * buffer.duration)
    } else {
      src.start(at)
      if (r.dur && r.dur < len) {
        len = r.dur
        g.gain.setValueAtTime(vol, at + Math.max(0, len - 0.1))
        g.gain.linearRampToValueAtTime(0, at + len)
        src.stop(at + len + 0.02)
        v.len = len + r.delay
      }
    }
    src.onended = () => release(v)
    voices.push(v)
    k.active++
    k.played++
    k.last = now
    st.played++
    if (voices.length > st.peakVoices) st.peakVoices = voices.length
    if (r.duck && music) music.duck(r.duck)
    if (api.onPlay) api.onPlay({ key: k.name, group: r.sfx, file, ch: r.ch, vol, t: now, prio: r.prio })
    return v
  }

  // 事件驱动的持续声（火焰喷射等）：键 → 发声
  const loops = new Map()
  function trigger(r, e, now) {
    const k = r.k
    // 统计这类事件的到达速度（dense 切换用）
    k.winN++
    if (now - k.winT0 >= LIMITS.rateWindow) { k.rate = k.winN / (now - k.winT0); k.winT0 = now; k.winN = 0 }
    if (r.dense && k.rate > r.over) r = r.dense
    if (r.loop) {
      const hold = r.hold === 'dur' ? clamp(e && e.dur > 0 ? e.dur : 0.5, 0.2, 4) : r.hold
      let v = loops.get(k)
      if (v && v.dead) { loops.delete(k); v = null }
      if (!v) { v = startVoice(r, now, NaN, NaN, true); if (!v) return; loops.set(k, v) }
      if (now + hold > v.holdUntil) v.holdUntil = now + hold
      return
    }
    if (now - k.last < r.gap) { k.throttled++; st.throttled++; return }
    let x = NaN, z = NaN
    if (r.pan && e) {
      if (typeof e.x === 'number') { x = e.x; z = e.z }
      else if (typeof e.x0 === 'number') { x = e.x0; z = e.z0 }
      else if (e.points && e.points[0]) { x = e.points[0].x; z = e.points[0].z }
    }
    startVoice(r, now, x, typeof z === 'number' ? z : NaN, false)
  }

  function consume(events) {
    if (!events || !events.length || !ready()) return
    const now = ctx.currentTime
    st.events += events.length
    for (let n = 0; n < events.length; n++) {
      const e = events[n]
      const m = compiled.get(e.type)
      if (!m) continue
      let rules = m.def
      if (m.by) {
        for (let b = 0; b < m.by.length; b++) {
          const v = e[m.by[b]]
          if (v !== undefined && m.cases.has(String(v))) { rules = m.cases.get(String(v)); break }
        }
      }
      if (!rules) continue
      for (let i = 0; i < rules.length; i++) trigger(rules[i], e, now)
    }
  }

  function ui(name) {
    const rules = uiRules[name]
    if (!rules || !enabled || !unlocked || hidden || ctx.state !== 'running') return
    const now = ctx.currentTime
    for (const r of rules) trigger(r, null, now)
  }

  // ------------------------------------------------------------ 跟着世界状态走的声音
  const stateLoops = {}
  function setStateLoop(name, rule, on) {
    let v = stateLoops[name]
    if (v && v.dead) v = stateLoops[name] = null
    if (on && !v && ready()) stateLoops[name] = startVoice(rule, ctx.currentTime, NaN, NaN, true)
    else if (!on && v) { fadeStop(v, 0.4); stateLoops[name] = null }
  }
  function stopLoops(fade) {
    for (const [k, v] of loops) { if (!v.dead) fadeStop(v, fade); loops.delete(k) }
    for (const name in stateLoops) if (stateLoops[name]) { if (!stateLoops[name].dead) fadeStop(stateLoops[name], fade); stateLoops[name] = null }
  }

  let bedT = 1, lastX = null, lastWorld = null, hb = 0
  let hiOn = false, hiT = 0, lowT = 0
  function autoMusic(world, dt) {
    const H = MUSIC.hi
    if (OVER[world.status]) { hiOn = false; hiT = lowT = 0; return 'result' }
    const layer = world.endless ? world.endless.layer : 0
    const kr = world.stats ? world.stats.killRate : 0
    if (layer >= H.layer) hiOn = true
    else if (!hiOn) { hiT = kr > H.killRate ? hiT + dt : 0; if (hiT >= H.enter) { hiOn = true; lowT = 0 } }
    else { lowT = kr < H.leaveBelow ? lowT + dt : 0; if (lowT >= H.leave) { hiOn = false; hiT = 0 } }
    if (world.boss) return 'boss'          // 含 Boss 死亡演出：不在它倒下的半秒里切回战斗曲
    return hiOn ? 'battle_hi' : 'battle'
  }

  function update(world, dt) {
    if (!enabled) return
    const now = ctx.currentTime
    // 兜底回收：onended 没来的（极少见）按时长清掉
    for (let i = voices.length - 1; i >= 0; i--) { const v = voices[i]; if (!v.loop && now > v.t0 + v.len + 0.6) release(v) }
    for (const [k, v] of loops) { if (v.dead) loops.delete(k); else if (now > v.holdUntil) { fadeStop(v, 0.18); loops.delete(k) } }
    music.tick()
    if (!world) { if (lastWorld) { stopLoops(0.4); lastWorld = null }; return }
    if (world !== lastWorld) { lastWorld = world; lastX = null; bedT = 1; hb = 0; hiOn = false; hiT = lowT = 0 }
    const live = !!LIVE[world.status], running = world.status === 'running' || world.status === 'aiming'
    music.setState(autoMusic(world, dt || 0))
    music.setMuffled(paused || world.status === 'levelup')
    // 舰桥底噪
    setStateLoop('ambient', stateRules.ambient, live)
    // 防线告急的心跳
    const line = world.line
    const ratio = line && line.hpMax > 0 ? line.hp / line.hpMax : 1
    const HB = STATE.heartbeat
    if (!live) hb = 0
    else if (ratio < HB.critical) hb = 2
    else if (ratio < HB.low) { if (hb !== 2 || ratio > HB.critical + 0.04) hb = 1 }
    else if (ratio > HB.low + 0.04) hb = 0
    setStateLoop('hbSlow', stateRules.hbSlow, hb === 1)
    setStateLoop('hbFast', stateRules.hbFast, hb === 2)
    if (!running || !ready()) { lastX = world.squad ? world.squad.x : null; return }
    // 虫潮远处的嘶叫
    const B = STATE.swarmBed
    const living = world.swarm ? world.swarm.living : 0
    bedT -= dt
    if (bedT <= 0) {
      const f = clamp(living / B.at, 0, 1)
      bedT = (B.every[0] + (B.every[1] - B.every[0]) * f) * (0.7 + random() * 0.6)
      if (living >= B.min) trigger(random() < B.altChance ? stateRules.bedAlt : stateRules.bed, { x: (random() * 2 - 1) * 5.5, z: -16 + random() * 12 }, now)
    }
    // 队伍横移的脚步
    const sq = world.squad
    if (sq && dt > 0) {
      if (lastX !== null && Math.abs(sq.x - lastX) / dt > STATE.footsteps.minSpeed) {
        const e = { x: sq.x, z: sq.frontZ || 8 }
        trigger(stateRules.foot, e, now)
        const c = sq.counts
        if (c && STATE.footsteps.heavy.units.some(u => c[u] > 0)) trigger(stateRules.footHeavy, e, now)
      }
      lastX = sq.x
    }
  }

  // ------------------------------------------------------------ 音量 / 静音 / 隐藏 / 暂停
  function applyMaster(fade = 0.05) {
    if (!enabled) return
    const now = ctx.currentTime, target = muted || hidden ? 0 : volume.master
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(master.gain.value, now)
    master.gain.linearRampToValueAtTime(target, now + fade)
  }
  function setVolume(channel, v) {
    if (!(channel in volume)) return
    volume[channel] = clamp(Number(v) || 0, 0, 1)
    if (!enabled) return
    if (channel === 'master') applyMaster(0.03)
    else {
      const now = ctx.currentTime, p = bus[channel].gain
      p.cancelScheduledValues(now)
      p.setValueAtTime(p.value, now)
      p.linearRampToValueAtTime(volume[channel], now + 0.03)
    }
  }
  function setMuted(b) { muted = !!b; applyMaster() }
  function setPaused(b) {
    paused = !!b
    if (!enabled) return
    if (paused) stopLoops(0.2)
    music.setMuffled(paused)
  }
  function setHidden(b) {
    b = !!b
    if (b === hidden || !enabled) { hidden = b; return }
    hidden = b
    applyMaster(0.06)
    if (hidden) {
      stopLoops(0.05)
      music.setHidden(true)
      setTimer(() => { if (hidden && ctx.state === 'running') { try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}) } catch (e) { /* 忽略 */ } } }, 150)
    } else {
      if (unlocked) { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}) } catch (e) { /* 忽略 */ } }
      music.setHidden(false)
    }
  }
  const onVisibility = () => setHidden(doc.visibilityState === 'hidden' || doc.hidden === true)
  if (enabled && doc && doc.addEventListener) { doc.addEventListener('visibilitychange', onVisibility); if (doc.hidden) setHidden(true) }

  function unlock() {
    if (!enabled) return Promise.resolve(false)
    unlocked = true
    let p = null
    if (!hidden && ctx.state !== 'running') { try { p = ctx.resume() } catch (e) { p = null } }
    music.unlock()
    return p && p.then ? p.then(() => true, () => false) : Promise.resolve(true)
  }

  // 试听用：直接放某个文件 / 某个分组（dev/audio.html）
  function playFile(name, { ch = 'ui', vol = 0.7, rate = 1 } = {}) {
    if (!enabled || !unlocked) return Promise.resolve(false)
    return loadFile(name).then(buffer => {
      if (!buffer) return false
      const src = ctx.createBufferSource(), g = ctx.createGain()
      src.buffer = buffer; src.playbackRate.value = rate; g.gain.value = vol
      src.connect(g); g.connect(bus[ch] || bus.ui); src.start()
      src.onended = () => { try { g.disconnect() } catch (e) { /* 已断开 */ } }
      return true
    })
  }

  function stats() {
    const byKey = {}
    for (const [name, k] of keyStates) if (k.played || k.throttled || k.dropped || k.missing) byKey[name] = { played: k.played, throttled: k.throttled, dropped: k.dropped, missing: k.missing, active: k.active, rate: Math.round(k.rate) }
    return {
      enabled, unlocked, hidden, muted, paused, state: enabled ? ctx.state : 'unavailable',
      voices: voices.length, ...st, loaded: buffers.size, failed: [...failed], volume: { ...volume },
      loops: [...loops.keys()].map(k => k.name).concat(Object.keys(stateLoops).filter(n => stateLoops[n])),
      music: music ? music.info() : null, byKey,
    }
  }

  function dispose() {
    if (!enabled) return
    if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility)
    stopLoops(0.02)
    for (const v of voices.slice()) fadeStop(v, 0.02)
    music.stop(0.05)
    try { const p = ctx.close(); if (p && p.catch) p.catch(() => {}) } catch (e) { /* 忽略 */ }
  }

  const noMusic = { setState() {}, playTrack() {}, stop() {}, info: () => null, state: null }
  return Object.assign(api, {
    unlock, consume, update, setVolume, setMuted, preload,
    music: enabled ? { setState: n => music.setState(n), playTrack: id => music.playTrack(id, null), stop: f => music.stop(f), info: () => music.info(), get state() { return music.state } } : noMusic,
    // 规格之外的补充
    ui, setPaused, setHidden, playFile, stats, dispose,
    getVolume: c => volume[c], get muted() { return muted }, get enabled() { return enabled }, get context() { return ctx },
  })
}
