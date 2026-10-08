// 音频层的客观检查（没人能听，所以只查「查得出来的」）。用法：node tools/test-audio.mjs [--verbose]
//   ① 映射表引用的文件都在；事件要么有声音要么在无声清单；规则字段合法
//   ② 用真实的一局模拟事件流喂给假的 AudioContext：并发不超限、各类触发次数在合理区间、没有哪类每秒几十上百次
//   ③ 行为：未解锁不出声、节流、变体轮播、满员抢占、循环声、隐藏 / 静音 / 音量、音乐状态机与交叉淡化、预加载
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createAudio } from '../src/audio/audio.js'
import { CHANNELS, DEFAULT_VOLUME, LIMITS, SFX, EVENT_MAP, SILENT_EVENTS, UI_MAP, MUSIC, STATE, allRules, usedSfxFiles, usedSfxGroups, usedMusicTracks } from '../src/audio/soundmap.js'
import { EVENT_TYPES } from '../src/core/events.js'
import { runHeadless } from '../src/sim/bot.js'
import { UNITS } from '../src/data/units.js'
import { DEVICES } from '../src/data/devices.js'
import { ENEMIES } from '../src/data/enemies.js'
import { POWERS } from '../src/data/commanders.js'
import { defaultSave as createSave } from '../src/core/save.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AUDIO = path.join(ROOT, 'assets/audio')
const VERBOSE = process.argv.includes('--verbose')
const manifest = JSON.parse(fs.readFileSync(path.join(AUDIO, 'manifest.json'), 'utf8'))
const byFile = new Map(manifest.map(m => [m.file, m]))
const DT = 1 / 60

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// ------------------------------------------------------------------ 假的浏览器环境
function makeEnv({ ogg = true, withContext = true } = {}) {
  const env = { wall: 0, ctx: null, elements: [], timers: [], fetched: [], badParam: null, docListeners: {}, peakSources: 0 }
  const finite = (what, ...vals) => { for (const v of vals) if (typeof v !== 'number' || !Number.isFinite(v)) env.badParam = env.badParam || `${what}=${v}` }
  class Param {
    constructor(v, name) { this._v = v; this.name = name }
    get value() { return this._v }
    set value(v) { finite(this.name + '.value', v); this._v = v }
    setValueAtTime(v, t) { finite(this.name + '.setValueAtTime', v, t); this._v = v }
    linearRampToValueAtTime(v, t) { finite(this.name + '.linearRamp', v, t); this._v = v }
    setTargetAtTime(v, t, c) { finite(this.name + '.setTarget', v, t, c); this._v = v }
    setValueCurveAtTime(curve, t, d) { finite(this.name + '.setValueCurve', t, d, curve[0], curve[curve.length - 1]); this._v = curve[curve.length - 1] }
    cancelScheduledValues(t) { finite(this.name + '.cancel', t) }
  }
  class Node {
    constructor(kind) { this.kind = kind; this.to = [] }
    connect(n) { this.to.push(n); return n }
    disconnect() { this.to.length = 0 }
  }
  class Source extends Node {
    constructor(ctx) { super('source'); this.ctx = ctx; this.playbackRate = new Param(1, 'playbackRate'); this.loop = false; this.buffer = null; this.onended = null; this.endT = Infinity; this.started = false }
    start(when = 0, offset = 0) {
      finite('start', when, offset)
      const now = this.ctx.currentTime
      this.started = true
      this.startT = Math.max(when, now)
      this.endT = this.loop ? Infinity : this.startT + (this.buffer.duration - offset) / this.playbackRate.value
      this.ctx.sources.add(this)
      this.ctx.starts++
      if (this.ctx.sources.size > env.peakSources) env.peakSources = this.ctx.sources.size
    }
    stop(when = 0) { finite('stop', when); this.endT = Math.min(this.endT, Math.max(when, this.ctx.currentTime)) }
  }
  class FakeAudioContext {
    constructor() { env.ctx = this; this.currentTime = 0; this.state = 'suspended'; this.destination = new Node('destination'); this.sources = new Set(); this.starts = 0; this.nodes = [] }
    _node(kind, params) { const n = new Node(kind); for (const [k, v] of Object.entries(params)) n[k] = new Param(v, kind + '.' + k); this.nodes.push(n); return n }
    createGain() { return this._node('gain', { gain: 1 }) }
    createStereoPanner() { return this._node('panner', { pan: 0 }) }
    createBiquadFilter() { return this._node('filter', { frequency: 350, Q: 1 }) }
    createDynamicsCompressor() { return this._node('compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }) }
    createBufferSource() { return new Source(this) }
    createMediaElementSource(el) { const n = new Node('media'); n.el = el; return n }
    decodeAudioData(ab, ok) { const buf = { duration: ab.duration }; if (ok) ok(buf); return Promise.resolve(buf) }
    resume() { this.state = 'running'; return Promise.resolve() }
    suspend() { this.state = 'suspended'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  env.tick = (dt = DT) => {
    env.wall += dt
    const ctx = env.ctx
    if (ctx && ctx.state === 'running') {
      ctx.currentTime += dt
      for (const s of ctx.sources) if (s.endT <= ctx.currentTime) { ctx.sources.delete(s); if (s.onended) s.onended() }
    }
    for (let i = env.timers.length - 1; i >= 0; i--) if (env.timers[i].at <= env.wall) { const t = env.timers.splice(i, 1)[0]; t.fn() }
  }
  env.document = {
    hidden: false, visibilityState: 'visible',
    addEventListener(type, fn) { (env.docListeners[type] = env.docListeners[type] || []).push(fn) },
    removeEventListener(type, fn) { const l = env.docListeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) },
  }
  env.setHidden = b => { env.document.hidden = b; env.document.visibilityState = b ? 'hidden' : 'visible'; for (const fn of env.docListeners.visibilitychange || []) fn() }
  env.deps = {
    AudioContext: withContext ? FakeAudioContext : null,
    document: env.document,
    random: (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } })(),
    setTimeout: (fn, ms) => env.timers.push({ at: env.wall + ms / 1000, fn }),
    fetch: url => {
      env.fetched.push(url)
      const rel = url.replace(/^assets\/audio\//, '')
      const ok = fs.existsSync(path.join(AUDIO, rel))
      const m = byFile.get(rel)
      return Promise.resolve({ ok, status: ok ? 200 : 404, arrayBuffer: () => Promise.resolve({ duration: m ? m.duration : 0.5 }) })
    },
    createElement: () => {
      const el = { loop: false, preload: '', src: '', currentTime: 0, duration: 0, paused: true, plays: 0,
        canPlayType: () => (ogg ? 'probably' : ''), play() { this.paused = false; this.plays++; return Promise.resolve() }, pause() { this.paused = true }, removeAttribute() { this.src = '' }, load() {} }
      env.elements.push(el)
      return el
    },
  }
  if (!withContext) { delete env.deps.AudioContext; env.deps.AudioContext = undefined }
  env.master = () => env.ctx.nodes.find(n => n.kind === 'gain' && n.to.some(t => t.kind === 'compressor'))
  env.bus = name => env.ctx.nodes.filter(n => n.kind === 'gain' && n.to.includes(env.master()))[CHANNELS.filter(c => c !== 'master').indexOf(name)]
  return env
}
async function readyAudio(opts) {
  const env = makeEnv(opts)
  const audio = createAudio({ basePath: 'assets/audio/', deps: env.deps })
  const plays = []
  audio.onPlay = p => plays.push(p)
  await audio.preload()
  await audio.unlock()
  return { env, audio, plays }
}
const flush = () => new Promise(r => setImmediate(r))

// ================================================================== ① 静态检查
console.log('—— ① 映射表与素材 ——')
{
  const missing = usedSfxFiles().filter(f => !fs.existsSync(path.join(AUDIO, 'sfx', f + '.ogg')))
  check('soundmap 引用的音效文件都存在', missing.length === 0, missing.length ? '缺 ' + missing.join(', ') : `${usedSfxFiles().length} 个文件 / ${usedSfxGroups().length} 个分组`)
  const notInManifest = usedSfxFiles().filter(f => !byFile.has(`sfx/${f}.ogg`))
  check('引用的音效都登记在 manifest.json（有出处与授权）', notInManifest.length === 0, notInManifest.join(', '))
  const allGroupFiles = Object.values(SFX).flat()
  const ghost = allGroupFiles.filter(f => !fs.existsSync(path.join(AUDIO, 'sfx', f + '.ogg')))
  check('SFX 分组表里没有写错的文件名', ghost.length === 0, ghost.join(', '))
  const tracks = usedMusicTracks()
  const missMusic = tracks.flatMap(t => ['.ogg', '.mp3'].filter(x => !fs.existsSync(path.join(AUDIO, 'music', t + x))).map(x => t + x))
  check('音乐曲目齐全（每首 ogg + mp3 兜底）', missMusic.length === 0, missMusic.length ? '缺 ' + missMusic.join(', ') : `${tracks.length} 首：${tracks.join(' / ')}`)
  check('保留的曲目数在 6~8 首', tracks.length >= 6 && tracks.length <= 8, `${tracks.length} 首`)
  for (const s of ['menu', 'battle', 'battle_hi', 'boss', 'result']) if (!(MUSIC.states[s] && MUSIC.states[s].length)) check(`音乐状态 ${s} 有曲目`, false)
  const inDir = fs.readdirSync(path.join(AUDIO, 'music')).sort()
  const expect = tracks.flatMap(t => [t + '.mp3', t + '.ogg']).sort()
  check('assets/audio/music 里只剩映射表用到的曲目', JSON.stringify(inDir) === JSON.stringify(expect), `目录里 ${inDir.length} 个文件，多余：${inDir.filter(f => !expect.includes(f)).join(', ') || '无'}`)
  const unusedDir = path.join(AUDIO, '_unused/music')
  const moved = fs.existsSync(unusedDir) ? fs.readdirSync(unusedDir) : []
  const manifestMusic = manifest.filter(m => /music\//.test(m.file))
  const lost = manifestMusic.filter(m => !fs.existsSync(path.join(AUDIO, m.file)))
  check('没用到的曲目移进了 _unused（没有删除任何文件，manifest 路径同步）', moved.length > 0 && lost.length === 0 && manifestMusic.length === 42, `_unused/music ${moved.length} 个文件；manifest 里 ${manifestMusic.length} 条音乐记录全部能找到文件`)
  const size = dir => fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0)
  console.log(`      music 目录 ${(size(path.join(AUDIO, 'music')) / 1048576).toFixed(1)} MB（整理前约 81 MB）   sfx ${(size(path.join(AUDIO, 'sfx')) / 1048576).toFixed(1)} MB`)

  const mapped = Object.keys(EVENT_MAP), silent = Object.keys(SILENT_EVENTS)
  const uncovered = [...EVENT_TYPES].filter(t => !mapped.includes(t) && !silent.includes(t))
  check('每种模拟事件要么有声音映射，要么在显式的无声清单里', uncovered.length === 0, uncovered.length ? '没着落：' + uncovered.join(', ') : `${EVENT_TYPES.size} 种事件 = ${mapped.length} 种有声 + ${silent.length} 种无声（${silent.join(' / ')}）`)
  const stray = [...mapped, ...silent].filter(t => !EVENT_TYPES.has(t))
  check('映射表 / 无声清单里没有不存在的事件类型', stray.length === 0, stray.join(', '))
  const both = mapped.filter(t => silent.includes(t))
  check('没有事件同时出现在两张表里', both.length === 0, both.join(', '))

  const bad = []
  for (const { where, rule: r } of allRules()) {
    if (!SFX[r.sfx]) bad.push(`${where}: 没有分组 ${r.sfx}`)
    if (r.ch !== undefined && (!CHANNELS.includes(r.ch) || r.ch === 'master' || r.ch === 'music')) bad.push(`${where}: 通道 ${r.ch}`)
    if (r.vol !== undefined && !(r.vol > 0 && r.vol <= 1)) bad.push(`${where}: vol ${r.vol}`)
    if (r.gap !== undefined && !(r.gap >= 0 && r.gap <= 5000)) bad.push(`${where}: gap ${r.gap}`)
    if (r.prio !== undefined && !(Number.isInteger(r.prio) && r.prio >= 0 && r.prio <= 9)) bad.push(`${where}: prio ${r.prio}`)
    if (r.max !== undefined && !(Number.isInteger(r.max) && r.max >= 1 && r.max <= 12)) bad.push(`${where}: max ${r.max}`)
    if (r.pitch !== undefined && !(r.pitch >= 0 && r.pitch <= 0.3)) bad.push(`${where}: pitch ${r.pitch}`)
    if (r.rate !== undefined && !(r.rate >= 0.4 && r.rate <= 2)) bad.push(`${where}: rate ${r.rate}`)
    if (r.loop) for (const f of SFX[r.sfx] || []) if (!(byFile.get(`sfx/${f}.ogg`) || {}).loop) bad.push(`${where}: 循环规则用了非循环素材 ${f}`)
    const known = ['sfx', 'ch', 'gap', 'vol', 'pitch', 'rate', 'prio', 'max', 'delay', 'dur', 'pan', 'duck', 'dense', 'loop', 'hold', 'key']
    const extra = Object.keys(r).filter(k => !known.includes(k) && !['low', 'critical', 'slow', 'fast', 'alt', 'altChance', 'every', 'at', 'min', 'minSpeed', 'heavy', 'units', 'over'].includes(k))
    if (extra.length) bad.push(`${where}: 不认识的字段 ${extra.join(',')}`)
  }
  check('每条规则的字段合法（分组存在、通道 / 音量 / 间隔 / 优先级在范围内、循环规则用循环素材）', bad.length === 0, bad.length ? bad.slice(0, 6).join('；') : `${allRules().length} 条规则`)

  const caseBad = []
  const caseOf = t => Object.keys(EVENT_MAP[t].cases).filter(c => c !== '_')
  for (const c of caseOf('shot')) if (!UNITS[c] && c !== 'companion') caseBad.push('shot.' + c)
  for (const c of caseOf('volley')) if (!UNITS[c]) caseBad.push('volley.' + c)
  for (const c of caseOf('deviceFire')) if (!DEVICES[c]) caseBad.push('deviceFire.' + c)
  for (const t of ['enemyDie', 'enemyAttack']) for (const c of caseOf(t)) if (!ENEMIES[c]) caseBad.push(`${t}.${c}`)
  for (const c of caseOf('powerCast')) if (!POWERS[c]) caseBad.push('powerCast.' + c)
  const powerMiss = Object.keys(POWERS).filter(id => !EVENT_MAP.powerCast.cases[id])
  check('分流表的键对得上数据表（兵种 / 装置 / 敌人 / 技能 id）', caseBad.length === 0, caseBad.join(', '))
  check('每个指挥官技能都有自己的施放音', powerMiss.length === 0, powerMiss.join(', '))
  const save = createSave ? createSave() : null
  const saveKeys = save ? Object.keys(save.settings.volume).sort().join() : ''
  check('通道名与存档 settings.volume 的键一致', !save || saveKeys === [...CHANNELS].sort().join(), saveKeys)
  const unusedSfx = manifest.filter(m => m.file.startsWith('sfx/')).map(m => m.file.slice(4, -4)).filter(f => !usedSfxFiles().includes(f))
  console.log(`      提示：manifest 里有 ${unusedSfx.length} 个音效没被映射表用到（留作备选）：${unusedSfx.join(' ') || '无'}`)
}

// ================================================================== ② 真实对局的事件流
console.log('—— ② 用真实对局的事件流喂假的 AudioContext ——')
async function simulate(label, opts) {
  const { env, audio, plays } = await readyAudio()
  const evCount = {}
  let steps = 0, maxDecks = 0, maxVoices = 0
  const run = runHeadless({
    ...opts,
    onStep(world) {
      for (const e of world.events) evCount[e.type] = (evCount[e.type] || 0) + 1
      audio.consume(world.events)
      audio.update(world, DT)
      env.tick(DT)
      steps++
      const s = audio.stats()
      if (s.music.decks.length > maxDecks) maxDecks = s.music.decks.length
      if (s.voices > maxVoices) maxVoices = s.voices
    },
  })
  for (let i = 0; i < 240; i++) { audio.update(run.world, DT); env.tick(DT) }     // 结算画面再走 4 秒
  const st = audio.stats()
  const secs = steps * DT
  const perKeySec = {}, perSec = {}
  for (const p of plays) {
    const s = Math.floor(p.t)
    perSec[s] = (perSec[s] || 0) + 1
    const m = perKeySec[p.key] || (perKeySec[p.key] = {})
    m[s] = (m[s] || 0) + 1
  }
  const peakKey = Object.entries(perKeySec).map(([k, m]) => [k, Math.max(...Object.values(m))]).sort((a, b) => b[1] - a[1])
  const peakAll = Math.max(...Object.values(perSec))
  const n = key => (st.byKey[key] ? st.byKey[key].played : 0)
  const perMin = key => n(key) / (secs / 60)
  console.log(`   [${label}] ${run.result.outcome} ${Math.round(secs)}s  击杀 ${run.result.kills}  事件 ${st.events}  →  发声 ${st.played}（节流掉 ${st.throttled}，同类满员丢弃 ${st.dropped}，顶替 ${st.stolen}，抢占 ${st.preempted}）`)
  console.log(`      并发峰值 ${st.peakVoices}/${LIMITS.maxVoices}（假 ctx 里同时存在的声源峰值 ${env.peakSources}）  每秒发声峰值 ${peakAll}  最密的几类：${peakKey.slice(0, 5).map(([k, v]) => `${k} ${v}/s`).join('  ')}`)
  if (VERBOSE) for (const [k, v] of Object.entries(st.byKey).sort((a, b) => b[1].played - a[1].played)) console.log(`        ${k.padEnd(28)} 发声 ${String(v.played).padStart(6)}  节流 ${String(v.throttled).padStart(7)}  丢弃 ${String(v.dropped).padStart(5)}`)
  return { env, audio, st, run, evCount, secs, peakKey, peakAll, n, perMin, maxDecks, maxVoices, plays, label }
}
function commonChecks(r) {
  const L = `[${r.label}] `
  check(L + `并发不超过上限 ${LIMITS.maxVoices}`, r.st.peakVoices <= LIMITS.maxVoices && r.maxVoices <= LIMITS.maxVoices && r.env.peakSources <= LIMITS.maxVoices + 8, `引擎峰值 ${r.st.peakVoices}，含淡出尾巴的声源峰值 ${r.env.peakSources}`)
  check(L + '没有某一类音效每秒触发几十上百次（单类 ≤ 34/s，合计 ≤ 160/s）', r.peakKey[0][1] <= 34 && r.peakAll <= 160, `最密 ${r.peakKey[0][0]} ${r.peakKey[0][1]}/s，合计峰值 ${r.peakAll}/s`)
  check(L + '没有素材缺失、没有 NaN 参数', r.st.failed.length === 0 && Object.values(r.st.byKey).every(k => k.missing === 0) && !r.env.badParam, r.env.badParam || r.st.failed.join(','))
  const hot = [['shot:rifle', 100, 1400], ['die:splat', 300, 2000], ['enemyHit', 200, 900]]
  const hotTxt = hot.map(([k]) => `${k} ${Math.round(r.perMin(k))}`).join('  ')
  check(L + '高频音效的触发次数在合理区间（每分钟：步枪 100~1400、虫死 300~2000、命中 200~900）', hot.every(([k, a, b]) => r.perMin(k) >= a && r.perMin(k) <= b), hotTxt)
  const dropped = Object.entries(r.st.byKey).filter(([k, v]) => v.dropped > 0 && /^(bossSpawn|bossDie|win|lose|retreat|levelUp|heroic|combo|herald|fence)/.test(k))
  check(L + '关键音效（Boss / 胜负 / 升级 / 警报）从未因为满员被丢弃', dropped.length === 0, dropped.map(([k, v]) => `${k}×${v.dropped}`).join(', '))
  check(L + '音乐同时最多两路在交叉淡化，结束后只剩一路', r.maxDecks <= 3 && r.st.music.decks.filter(d => !d.fading).length === 1 && r.st.music.decks.length === 1, `过程中最多 ${r.maxDecks} 路，最后 ${r.st.music.decks.length} 路：${r.st.music.track}`)
}
const seqOf = r => r.st.music.log.map(l => l.state)
{
  const a = await simulate('战役 seed1 霍克 good', { seed: 1, bot: 'good', commander: 'hawk', unlockAll: true })
  commonChecks(a)
  const seq = seqOf(a).join(' → ')
  check('[战役] 音乐按 battle → … → boss → result 走', seqOf(a)[0] === 'battle' && seqOf(a).includes('boss') && seqOf(a)[seqOf(a).length - 1] === 'result' && seqOf(a).indexOf('boss') < seqOf(a).lastIndexOf('result'), seq)
  const sw = a.st.music.log
  const minGap = Math.min(...sw.slice(1).map((l, i) => l.t - sw[i].t))
  check('[战役] 音乐不来回抖（全程切换 ≤ 8 次，相邻两次切换间隔 ≥ 2 秒）', sw.length <= 8 && minGap >= 2, `${sw.length} 次，最短间隔 ${minGap.toFixed(1)}s`)
  check('[战役] Boss 登场咆哮 / 胜利号角各响一次', a.n('bossSpawn#0') === a.evCount.bossSpawn && a.n('win') === 1 && a.evCount.win === 1, `bossSpawn 事件 ${a.evCount.bossSpawn} → 咆哮 ${a.n('bossSpawn#0')}；win → ${a.n('win')}`)
  check('[战役] 升级音不被节流吞掉（≥ 90% 的升级都响了）', a.n('levelUp') >= a.evCount.levelUp * 0.9, `${a.n('levelUp')}/${a.evCount.levelUp}`)
  check('[战役] 爆炸、装置开火、技能、增援门都有声', ['explosion:s', 'explosion:m', 'explosion:l', 'deviceFire:sentry', 'gateResolve', 'powerReady', 'place:thud', 'cast:flyby'].every(k => a.n(k) > 0), ['explosion:s', 'explosion:l', 'deviceFire:sentry', 'gateResolve', 'powerReady', 'place:thud', 'cast:flyby'].map(k => `${k} ${a.n(k)}`).join('  '))
  check('[战役] 步枪在人多时切到连发长音（dense）', a.plays.some(p => p.key === 'shot:rifle' && p.group === 'rifle_burst') && a.plays.some(p => p.key === 'shot:rifle' && p.group === 'rifle_shot'), `单发 ${a.plays.filter(p => p.group === 'rifle_shot' && p.key === 'shot:rifle').length} 次 / 连发 ${a.plays.filter(p => p.group === 'rifle_burst').length} 次`)
  check('[战役] 虫潮底噪与舰桥环境声在响', a.n('state:swarm_bed') > 40 && a.n('state:ambient') >= 1, `虫潮嘶叫 ${a.n('state:swarm_bed')} 次，环境循环启动 ${a.n('state:ambient')} 次`)
  check('[战役] 结算后循环声全部停掉', a.st.loops.length === 0, a.st.loops.join(','))

  const b = await simulate('无尽 seed2 伊瑟拉 巢母 突变', { seed: 2, bot: 'good', commander: 'ysera', boss: 'matriarch', endless: 5, mutators: ['swift', 'undying'], unlockAll: true, companion: { growth: 3 } })
  commonChecks(b)
  check('[无尽] 出现过 battle_hi，撤离后回到 result', seqOf(b).includes('battle_hi') && seqOf(b)[seqOf(b).length - 1] === 'result', seqOf(b).join(' → '))
  check('[无尽] 每次 Boss 登场都有咆哮，每次 Boss 死亡都有巨爆', b.n('bossSpawn#0') === b.evCount.bossSpawn && b.n('bossdie:boom') === b.evCount.bossDie, `登场 ${b.n('bossSpawn#0')}/${b.evCount.bossSpawn}  死亡 ${b.n('bossdie:boom')}/${b.evCount.bossDie}`)
  check('[无尽] 撤离音响一次', b.n('retreat') === 1, String(b.n('retreat')))

  const c = await simulate('无尽 seed3 老猫 渊噬蠕虫', { seed: 3, bot: 'good', commander: 'joe', boss: 'leviathan', endless: 5, unlockAll: true })
  commonChecks(c)

  const d = await simulate('老兵难度 挂机（会输）', { seed: 5, bot: 'idle', difficulty: 'veteran' })
  commonChecks(d)
  check('[失败局] 失败音响一次、音乐进 result、没有胜利号角', d.run.result.outcome === 'lost' && d.n('lose#0') === 1 && d.n('win') === 0 && seqOf(d)[seqOf(d).length - 1] === 'result', `${d.run.result.outcome}  lose ${d.n('lose#0')}  win ${d.n('win')}`)
}

// ================================================================== ③ 行为
console.log('—— ③ 引擎行为 ——')
const shot = (x = 0) => ({ type: 'shot', kind: 'rifle', x, z: 8, tx: 0, tz: -8, delay: 0.05 })
{
  // 未解锁
  const env = makeEnv()
  const audio = createAudio({ deps: env.deps })
  let progress = [], names = 0
  const res = await audio.preload((p, name) => { progress.push(p); if (name) names++ })
  check('preload：进度单调走到 1，全部文件解码成功', progress.length === usedSfxFiles().length && progress.every((p, i) => i === 0 || p >= progress[i - 1]) && progress[progress.length - 1] === 1 && res.failed === 0 && res.loaded === usedSfxFiles().length, `${res.loaded}/${res.total}，失败 ${res.failed}`)
  check('preload：只取 sfx 下的 ogg，不去整首下载音乐', env.fetched.length === usedSfxFiles().length && env.fetched.every(u => /^assets\/audio\/sfx\/[a-z0-9_]+\.ogg$/.test(u)), env.fetched[0])
  audio.music.setState('menu')
  audio.consume([shot()]); env.tick()
  check('首次手势之前：不出声、不放音乐', env.ctx.starts === 0 && env.elements.length === 0 && audio.stats().state === 'suspended')
  await audio.unlock()
  check('unlock 之后：上下文恢复，之前要求的 menu 音乐开始播放', env.ctx.state === 'running' && env.elements.length === 1 && env.elements[0].plays === 1 && /music\/menu_space_graveyard\.ogg$/.test(env.elements[0].src) && env.elements[0].loop === true, env.elements[0] && env.elements[0].src)

  // 节流
  audio.consume(Array.from({ length: 100 }, () => shot()))
  const s1 = env.ctx.starts
  for (let i = 0; i < 2; i++) { env.tick(); audio.consume([shot()]) }           // +33ms：仍在 45ms 间隔内
  const s2 = env.ctx.starts
  env.tick(); audio.consume([shot()])                                            // +50ms
  check('节流：同一瞬间 100 发步枪只响 1 声，45ms 内不再响，过了间隔才响第 2 声', s1 === 1 && s2 === 1 && env.ctx.starts === 2, `${s1} → ${s2} → ${env.ctx.starts}`)

  // 变体轮播 + 音高抖动 + 声像
  const got = []
  audio.onPlay = p => got.push(p)
  const rates = [], pans = []
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 4; j++) env.tick()
    audio.consume([{ type: 'explosion', x: (i >> 1) % 2 ? -6.4 : 6.4, z: 0, r: 2, size: 'm', kind: 'mortar' }])
  }
  for (const s of env.ctx.sources) rates.push(s.playbackRate.value)
  for (const n of env.ctx.nodes) if (n.kind === 'panner') pans.push(n.pan.value)
  const files = got.filter(p => p.group === 'explosion_medium').map(p => p.file)
  const repeats = files.filter((f, i) => i > 0 && f === files[i - 1]).length
  check('变体轮播：不连着放同一个文件，组里每个变体都轮到', repeats === 0 && new Set(files).size === SFX.explosion_medium.length, `${files.length} 次，用到 ${new Set(files).size}/${SFX.explosion_medium.length} 个变体，连续重复 ${repeats} 次`)
  const expRates = rates.filter(r => r !== 1)
  check('随机音高：在 ±8% 以内抖动且不是死值', expRates.length > 2 && expRates.every(r => r > 0.91 && r < 1.09) && new Set(expRates.map(r => r.toFixed(4))).size > 2, `${Math.min(...expRates).toFixed(3)} ~ ${Math.max(...expRates).toFixed(3)}`)
  check('声像：按事件 x 左右分布，最大不超过 panWidth', pans.some(p => p < -0.5) && pans.some(p => p > 0.5) && pans.every(p => Math.abs(p) <= LIMITS.panWidth + 1e-9), `${Math.min(...pans).toFixed(2)} ~ ${Math.max(...pans).toFixed(2)}`)

  // 循环声
  for (let i = 0; i < 90; i++) env.tick()
  const loopsBefore = [...env.ctx.sources].filter(s => s.loop).length
  for (let i = 0; i < 60; i++) { audio.consume([{ type: 'flame', unit: 1, x: 0, z: 8, dir: 0, arc: 1, range: 6 }]); audio.update(null, DT); env.tick() }
  const loopsDuring = [...env.ctx.sources].filter(s => s.loop).length
  for (let i = 0; i < 60; i++) { audio.update(null, DT); env.tick() }
  const loopsAfter = [...env.ctx.sources].filter(s => s.loop).length
  check('持续声：喷火 1 秒只起 1 路循环，事件停了约 0.35 秒后淡出', loopsBefore === 0 && loopsDuring === 1 && loopsAfter === 0, `${loopsBefore} → ${loopsDuring} → ${loopsAfter}`)

  // 音量 / 静音
  audio.setVolume('weapons', 0.3); audio.setVolume('master', 5); audio.setVolume('nope', 0.5)
  check('setVolume：改对应通道，越界钳到 0~1，未知通道忽略', Math.abs(env.bus('weapons').gain.value - 0.3) < 1e-9 && env.master().gain.value === 1 && audio.getVolume('master') === 1 && audio.getVolume('nope') === undefined)
  audio.setVolume('master', DEFAULT_VOLUME.master)
  audio.setMuted(true)
  const mutedGain = env.master().gain.value
  audio.setMuted(false)
  check('setMuted：总线归零 / 恢复，通道推子不受影响', mutedGain === 0 && Math.abs(env.master().gain.value - DEFAULT_VOLUME.master) < 1e-9 && Math.abs(env.bus('weapons').gain.value - 0.3) < 1e-9)

  // 页面隐藏
  for (let i = 0; i < 30; i++) env.tick()
  const before = env.ctx.starts
  env.setHidden(true)
  audio.consume([shot(), { type: 'bossSpawn', kind: 'ravager', x: 0, z: -21, hp: 1 }])
  audio.ui('click')
  for (let i = 0; i < 20; i++) { audio.update(null, DT); env.tick() }
  const hid = { gain: env.master().gain.value, starts: env.ctx.starts - before, state: env.ctx.state, paused: env.elements.every(e => e.paused) }
  env.setHidden(false)
  await flush()
  for (let i = 0; i < 5; i++) env.tick()
  audio.consume([shot()])
  check('页面隐藏：总线静音、不再起新声音、音乐暂停、上下文挂起；切回来全部恢复', hid.gain === 0 && hid.starts === 0 && hid.state === 'suspended' && hid.paused && env.ctx.state === 'running' && Math.abs(env.master().gain.value - DEFAULT_VOLUME.master) < 1e-9 && env.ctx.starts === before + 1 && env.elements.some(e => !e.paused), JSON.stringify(hid))

  // 界面音
  const u0 = env.ctx.starts
  for (const name of Object.keys(UI_MAP)) { for (let i = 0; i < 20; i++) env.tick(); audio.ui(name) }
  check('界面音：UI_MAP 里每个名字都能响', env.ctx.starts - u0 === Object.keys(UI_MAP).length, `${env.ctx.starts - u0}/${Object.keys(UI_MAP).length}`)
  audio.setPaused(true)
  const p0 = env.ctx.starts
  audio.consume([shot(), shot()]); audio.ui('click')
  audio.setPaused(false)
  check('暂停：战场音效不响，界面音照常', env.ctx.starts - p0 === 1)
  check('全程没有 NaN / 非法参数', !env.badParam, env.badParam || '')
  audio.dispose()
}
{
  // 并发上限与抢占：把每一类声音都同时灌进去，填满之后再来高优先级的
  const { env, audio } = await readyAudio()
  const flood = []
  for (const [type, m] of Object.entries(EVENT_MAP)) {
    if (/^(bossSpawn|win|lose|bossDie|retreat|flame)$/.test(type)) continue
    const base = { type, x: 1, z: 0, dur: 1, points: [{ x: 0, z: 0 }] }
    if (m && m.cases) for (const c of Object.keys(m.cases)) { const e = { ...base }; for (const f of [].concat(m.by)) e[f] = c; flood.push(e) }
    else flood.push(base)
  }
  let peak = 0
  for (let i = 0; i < 45; i++) { audio.consume(flood); env.tick(); peak = Math.max(peak, audio.stats().voices) }
  const full = audio.stats()
  audio.consume([{ type: 'bossSpawn', kind: 'ravager', x: 0, z: -21, hp: 1 }])
  const after = audio.stats()
  check('并发上限：把所有类型同时灌满，发声数顶到上限就不再涨', peak === LIMITS.maxVoices && full.voices === LIMITS.maxVoices, `峰值 ${peak}，已丢弃 ${full.dropped}`)
  check('抢占：满员时 Boss 登场咆哮顶掉一个低优先级的声音照样响', after.preempted > full.preempted && after.byKey['bossSpawn#0'] && after.byKey['bossSpawn#0'].played === 1 && after.voices === LIMITS.maxVoices, `抢占 ${after.preempted - full.preempted} 次，发声数仍 ${after.voices}`)
  const d0 = after.dropped, w0 = after.byKey.enemyHit ? after.byKey.enemyHit.played : 0
  for (let i = 0; i < 6; i++) env.tick()
  // 重新灌满后，低优先级的新声音只能被丢弃，不能抢
  for (let i = 0; i < 10; i++) { audio.consume(flood); env.tick() }
  const s2 = audio.stats()
  check('满员时低优先级的声音被丢弃而不是硬挤（发声数始终 ≤ 上限）', s2.peakVoices <= LIMITS.maxVoices && s2.dropped > d0, `又丢弃 ${s2.dropped - d0} 个；enemyHit 发声 ${w0} → ${s2.byKey.enemyHit ? s2.byKey.enemyHit.played : 0}`)
  audio.dispose()
}
{
  // 心跳 / 音乐状态机
  const { env, audio } = await readyAudio()
  const world = { status: 'running', line: { hp: 700, hpMax: 700 }, swarm: { living: 0 }, squad: { x: 0, frontZ: 8, counts: {} }, stats: { killRate: 0 }, boss: null, endless: null }
  const step = (n = 1) => { for (let i = 0; i < n; i++) { audio.update(world, DT); env.tick() } }
  const loopNames = () => audio.stats().loops.join(',')
  step(5)
  const l0 = loopNames()
  world.line.hp = 200; step(5); const l1 = loopNames()
  world.line.hp = 60; step(5); const l2 = loopNames()
  world.line.hp = 700; step(40); const l3 = loopNames()
  check('心跳：防线 <40% 起慢心跳，<18% 换快心跳，回满后停', l0 === 'ambient' && l1 === 'ambient,hbSlow' && l2 === 'ambient,hbFast' && l3 === 'ambient', `${l0} | ${l1} | ${l2} | ${l3}`)

  const tr = () => audio.music.info().track
  check('音乐：进入战斗自动切到 battle', audio.music.state === 'battle' && MUSIC.states.battle.includes(tr()), tr())
  const decksMid = audio.music.info().decks.length
  world.stats.killRate = 200; step(60)
  const notYet = audio.music.state
  step(80)
  const hi = audio.music.state
  const midFade = audio.music.info().decks.length
  step(120)
  world.stats.killRate = 120; step(60 * 9)
  const stay = audio.music.state                     // 120/s 不低于 100，不该退
  world.stats.killRate = 40; step(60 * 7)
  const still = audio.music.state
  step(60 * 2)
  const back = audio.music.state
  check('音乐：歼敌速度 >150/s 持续 2 秒才切 battle_hi；回落到 100 以下持续 8 秒才切回（防抖）', notYet === 'battle' && hi === 'battle_hi' && stay === 'battle_hi' && still === 'battle_hi' && back === 'battle', `${notYet} → ${hi} → ${stay} → ${still} → ${back}`)
  check('音乐：交叉淡化期间两路同时在，1.2 秒后只剩一路', decksMid === 1 && midFade === 2 && audio.music.info().decks.length <= 2)
  world.boss = { state: 'walk' }; step(2)
  const boss = audio.music.state
  world.status = 'levelup'; step(2)
  const muffled = audio.music.info().muffled
  const filt = env.ctx.nodes.find(n => n.kind === 'filter').frequency.value
  world.status = 'running'; step(2)
  check('音乐：Boss 在场切 boss；升级选卡时低通发闷，选完恢复', boss === 'boss' && muffled === true && filt === MUSIC.muffleHz && env.ctx.nodes.find(n => n.kind === 'filter').frequency.value === 20000, `${boss}  ${filt}Hz`)
  world.boss = null; world.endless = { layer: 4 }; step(2)
  const layerHi = audio.music.state
  world.status = 'retreated'; step(120)
  check('音乐：无尽第 4 层起常驻 battle_hi；结束进 result，环境声与心跳全部停掉', layerHi === 'battle_hi' && audio.music.state === 'result' && loopNames() === '' && tr() === 'result_transmission', `${layerHi} → ${audio.music.state}  循环：${loopNames() || '无'}`)
  audio.music.setState('menu'); audio.update(null, DT)
  for (let i = 0; i < 120; i++) { audio.update(null, DT); env.tick() }
  const inf = audio.music.info()
  check('音乐：回菜单（update 传 null 不再自动切歌），旧曲淡出后被暂停并回收', inf.state === 'menu' && inf.decks.length === 1 && env.elements.filter(e => !e.paused).length === 1, `在播 ${env.elements.filter(e => !e.paused).length} 路 / 共建过 ${env.elements.length} 个 <audio>`)
  const v1 = MUSIC.states.battle.length > 1
  audio.music.setState('battle'); const t1 = tr(); audio.music.setState('menu'); audio.music.setState('battle'); const t2 = tr()
  check('音乐：同一状态有多首时，每次进入换下一首', !v1 || t1 !== t2, `${t1} → ${t2}`)
  check('音乐状态机全程没有 NaN 参数', !env.badParam, env.badParam || '')
  audio.dispose()
}
{
  const { env } = await (async () => { const env = makeEnv({ ogg: false }); const audio = createAudio({ deps: env.deps }); await audio.unlock(); audio.music.setState('boss'); return { env, audio } })()
  check('浏览器不支持 ogg 时音乐改用 mp3', env.elements.length === 1 && /boss_epic_boss_battle_loop\.mp3$/.test(env.elements[0].src), env.elements[0] && env.elements[0].src)
  const audio = createAudio({ deps: { AudioContext: undefined, document: null, fetch: null } })
  let threw = null
  try { await audio.preload(); await audio.unlock(); audio.consume([shot()]); audio.update({ status: 'running' }, DT); audio.music.setState('menu'); audio.setVolume('music', 0.2); audio.setMuted(true); audio.ui('click'); audio.setPaused(true); audio.stats(); audio.dispose() } catch (e) { threw = e }
  check('没有 Web Audio 的环境（Node / 老浏览器）：全部接口静默空转不报错', !threw && (typeof AudioContext !== 'undefined' || audio.enabled === false), threw ? threw.message : '')
}

console.log(failures ? `\n${failures} 项失败.` : '\n全部通过.')
process.exit(failures ? 1 : 0)
