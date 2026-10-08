// dev/mockworld.js —— 按 docs/ARCHITECTURE.md §2 的契约造的「假世界」，只给渲染开发页用。
// 全部兵种 kind、全部虫种（含一个未注册的 kind，看占位体）、
// 三种 Boss 轮流出场并走完所有状态、门、预警圈（circle / lane / line，敌我两色）、持续区域、空投舱、布防装置、应急电网。
// 不追求玩法正确，只保证「每种状态和事件都会反复出现」，方便看表现。
// 布防部分（装置 / 电网 / 晶能）的字段和事件照真模拟 src/sim/devices.js 的样子造（ARCHITECTURE「第 6 步」）：fences 是布尔值、装置血量取数据表、
// 地雷有 armed / armedT、聚变炸弹 armedT = 爆炸时刻、energy 带 source、喷火陷阱发不带落点的 deviceFire + flame。
import { ENEMY_KINDS } from '../src/data/enemies.js'
import { DEVICES } from '../src/data/devices.js'

export const DT = 1 / 60
const CAP = 4096, LINGER = 2.1
const LANE_X = [-5.12, -2.56, 0, 2.56, 5.12], ROW_Z = [4.5, 1.5, -1.5, -4.5]

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function createMockWorld(opts = {}) {
  const rng = mulberry(opts.seed || 7)
  const N = Math.min(3900, opts.bugs ?? 3400)
  const kindNames = [...ENEMY_KINDS, 'mystery']   // ENEMY_KINDS 里已经有 shieldbug / leaper；mystery 是没注册的 kind（看占位体）
  const K = Object.fromEntries(kindNames.map((k, i) => [k, i]))
  const SPEC = {   // [占比, 速度, scale, 飞行高度]
    ling: [0.918, [2.0, 3.2], 1, 0], burster: [0.016, [3.2, 3.6], 1.15, 0], spitter: [0.008, [1.6, 1.8], 1.3, 0], crusher: [0.012, [1.3, 1.5], 1.7, 0],
    hulk: [0.0025, [0.9, 1.0], 2.6, 0], wing: [0.012, [3.0, 3.6], 1.1, 3], digger: [0.003, [1.6, 1.8], 1.5, 0], warden: [0.002, [1.1, 1.2], 1.6, 0],
    shieldbug: [0.008, [1.4, 1.6], 1, 0], leaper: [0.016, [3.0, 3.4], 1, 0], mystery: [0.0015, [1.5, 1.6], 1.3, 0],
  }
  const f32 = () => new Float32Array(CAP), u8 = () => new Uint8Array(CAP)
  const s = {
    cap: CAP, count: 0, living: 0, kindNames, kindCount: new Uint16Array(kindNames.length),
    alive: u8(), kind: u8(), x: f32(), z: f32(), y: f32(), vx: f32(), vz: f32(), hp: f32(), hpMax: f32(), state: u8(), stateT: f32(), elite: u8(), shield: f32(), scale: f32(), seed: f32(), hitT: f32(),
    _sp: f32(), _ph: f32(),
  }
  const world = {
    mock: true, opts, seed: opts.seed || 7, time: 0, phase: 'campaign', status: 'running', timeScale: 1, events: [],
    squad: { x: 0, targetX: 0, frontZ: 8.1, backZ: 12.7, hp: 0, hpMax: 0, units: [], counts: {}, caps: { infantry: 96, artillery: 9, heavy: 8 }, fallen: [] },
    swarm: s, boss: null, telegraphs: [], zones: [], gates: null, pods: [], levelup: null, powers: [],
    progress: { level: 3, xp: 0, xpNext: 100, xpPrev: 0, modules: {}, combos: [], heroics: [] },
    line: { hp: 1000, hpMax: 1000 }, wave: { index: 3, name: null, herald: null }, endless: null,
    stats: { kills: 0, killRate: 0, peakKillRate: 0, combo: 0, comboMult: 1, leaked: 0, losses: 0, deployed: {}, dmgByUnit: {}, timeline: [] },
    mission: { timeLeft: 95, label: null },
    // §13
    lanes: LANE_X.map((x, i) => ({ index: i, x, w: 2.56 })), grid: { cells: LANE_X.map(() => ROW_Z.map(() => null)) }, devices: [], energy: 100, cards: [], fences: LANE_X.map(() => true),
  }
  const ev = world.events
  let nextId = 1
  // 伙伴无人机「小七」（字段同 src/sim/companion.js）：每 9 秒进化一档，走完四个形态再从头来；武装以后会开火 / 扫描 / 脉冲
  const FORMS = ['dormant', 'scout', 'armed', 'annihilator']
  world.companion = opts.companion === false ? null : { id: 'seven', name: null, nameKey: 'companion.name', stage: opts.companionStage ?? 2, form: FORMS[opts.companionStage ?? 2], x: 2.4, z: 9.3, y: 2.4, facing: Math.PI, fireT: -9, aimX: 0, aimZ: 0, scanT: -9, pulseT: -9, _bolt: 1, _scan: 4, _pulse: 7, _evo: 9 }
  if (world.companion) ev.push({ type: 'companion', kind: 'join', stage: world.companion.stage, form: world.companion.form, x: 2.4, z: 9.3 })

  // ------------------------------------------------ 我方
  const units = world.squad.units
  const add = (kind, sx, sz, o = {}) => {
    const u = { id: nextId++, kind, x: sx, z: 8.1 + sz, hp: 10, hpMax: 10, shield: o.shield || 0, alive: true, aimX: sx, aimZ: 0, fireT: -9, hitT: -9, name: o.name || null, elite: o.elite || false, kills: 0, dmg: 0, facing: Math.PI, _sx: sx, _sz: sz, _cd: rng() * 2, _iv: o.iv || 1 }
    units.push(u); world.squad.counts[kind] = (world.squad.counts[kind] || 0) + 1
    return u
  }
  const COLS = [5, 6, 4, 7, 3, 8, 2, 9, 1, 10, 0, 11]
  for (let i = 0; i < 6; i++) add('flamer', ([1, 3, 5, 6, 8, 10][i] - 5.5) * 0.94, 0, { iv: 0.3 })
  add('hero_hawk', 0, -0.9, { iv: 0.5, name: 'name.hero' })
  const nR = opts.rifles ?? 60
  for (let i = 0; i < nR; i++) { const r = 0.9 + Math.floor(i / 12), c = COLS[i % 12]; add('rifle', (c - 5.5) * 0.94, r * 0.92, { iv: 0.13 * 2.4, name: i % 17 === 3 ? 'name.p.' + i : null, elite: i % 23 === 7 ? 'bloodhound' : false, shield: i % 11 === 0 ? 3 : 0 }) }
  const back = 1 + Math.ceil(nR / 12)
  // 炮兵在步兵后面（frontZ + 5.6），重型最靠后（frontZ + 7.4），和 data/units.js 的 FORMATION 量级一致
  add('mortar', -1.5, 5.6, { iv: 1.5 }); add('mortar', 1.5, 5.6, { iv: 1.5, elite: 'hammer' })
  add('psion', -4.2, 5.5, { iv: 4.2 })
  add('titan', -4.95, 7.6, { iv: 1.05 }); add('reaper', -1.65, 7.9, { iv: 1.9 })
  add('lancer', 1.65, 7.4, { iv: 0.6 }); add('skyhook', 4.95, 7.5, { iv: 0.5 })
  if (opts.extraHeroes) { add('hero_ysera', -4.6, -1.0, { iv: 3 }); add('hero_joe', 4.6, -1.0, { iv: 1 }); add('goliath', 0, 9.6, { iv: 1, elite: 'goliath' }) }
  add('medic', 4.4, 5.5, { iv: 99 })   // 故意放一个没注册的 kind：应该显示占位体而不是报错
  world.squad.backZ = 8.1 + back * 0.92
  ev.push({ type: 'unitJoin', ids: units.map((u) => u.id), kind: 'rifle', count: units.length, source: 'start' })

  // ------------------------------------------------ 虫
  let stream = 0
  const spawnX = () => { const c = Math.sin(stream * 0.37) * 3.2 + Math.sin(stream * 0.91 + 1.3) * 1.8; return rng() < 0.45 ? Math.max(-6, Math.min(6, c + (rng() + rng() + rng() - 1.5) * 3.0)) : (rng() - 0.5) * 12.0 }
  const pickKind = () => { let r = rng(); for (const k in SPEC) { r -= SPEC[k][0]; if (r <= 0) return k } return 'ling' }
  const spawn = (i, z, kindName) => {
    const name = kindName || pickKind(), sp = SPEC[name] || SPEC.ling
    s.alive[i] = 1; s.kind[i] = K[name]; s.x[i] = spawnX(); s.z[i] = z; s.y[i] = sp[3] ? sp[3] + rng() * 0.8 : 0
    s._sp[i] = sp[1][0] + rng() * (sp[1][1] - sp[1][0]); s.vx[i] = 0; s.vz[i] = s._sp[i]; s._ph[i] = rng() * 10
    s.hpMax[i] = s.hp[i] = name === 'ling' ? 1 : 12; s.state[i] = 0; s.stateT[i] = world.time
    s.elite[i] = rng() < 0.012 ? 1 : 0; s.shield[i] = rng() < 0.01 ? 2 : 0; s.scale[i] = sp[2] * (s.elite[i] ? 1.3 : 1); s.seed[i] = rng(); s.hitT[i] = -9
  }
  for (let i = 0; i < N; i++) { stream = rng() * 40; spawn(i, -24 + Math.pow(rng(), 0.85) * 28) }
  s.count = N
  const kill = (i, by, gore = 0) => {
    if (s.state[i] === 2 || !s.alive[i]) return
    s.state[i] = 2; s.stateT[i] = world.time; world.stats.kills++
    ev.push({ type: 'enemyDie', i, kind: kindNames[s.kind[i]], x: s.x[i], z: s.z[i], by, gore })
    if (kindNames[s.kind[i]] !== 'ling' && rng() < 0.5) ev.push({ type: 'xp', x: s.x[i], z: s.z[i], amount: 8 })
    if (rng() < 0.012) ev.push({ type: 'energy', x: s.x[i], z: s.z[i], amount: 1 + rng(), source: 'kill' })
  }
  const blast = (x, z, r, by) => { const r2 = r * r; for (let i = 0; i < s.count; i++) { if (!s.alive[i] || s.state[i] === 2 || s.y[i] > 1) continue; const dx = s.x[i] - x, dz = s.z[i] - z; if (dx * dx + dz * dz < r2) { if (kindNames[s.kind[i]] === 'ling' || rng() < 0.25) kill(i, by, 2); else { s.hitT[i] = world.time; ev.push({ type: 'enemyHit', i, x: s.x[i], z: s.z[i], dmg: 20, crit: false }) } } } }
  // 每条走廊里最靠前的几只，给步兵当目标
  const LN = 26, TOP = 8, laneIdx = new Int32Array(LN * TOP), laneCnt = new Uint8Array(LN)
  const rebuildLanes = () => {
    laneCnt.fill(0)
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || s.state[i] !== 0 || s.z[i] < -13) continue
      const l = Math.min(LN - 1, Math.max(0, ((s.x[i] + 6.5) / 0.5) | 0)), base = l * TOP; const n = laneCnt[l], z = s.z[i]
      let j = n < TOP ? n : TOP - 1
      if (n === TOP && s.z[laneIdx[base + j]] >= z) continue
      while (j > 0 && s.z[laneIdx[base + j - 1]] < z) { laneIdx[base + j] = laneIdx[base + j - 1]; j-- }
      laneIdx[base + j] = i; if (n < TOP) laneCnt[l] = n + 1
    }
  }
  const pick = (x, spread) => { for (let k = 0; k < 4; k++) { const l = Math.min(LN - 1, Math.max(0, ((x + (rng() - 0.5) * spread + 6.5) / 0.5) | 0)), n = laneCnt[l]; if (!n) continue; const i = laneIdx[l * TOP + ((rng() * rng() * n) | 0)]; if (s.state[i] === 0) return i } return -1 }
  const findKind = (name, zMin) => { for (let i = 0; i < s.count; i++) if (s.alive[i] && s.state[i] !== 2 && kindNames[s.kind[i]] === name && s.z[i] > zMin) return i; return -1 }

  // ------------------------------------------------ 装置（每种一个 + 几个哨戒塔）
  const place = (kind, lane, row) => {
    const def = DEVICES[kind] || { hp: 40, cost: 0 }
    const d = { id: nextId++, kind, lane, row, x: LANE_X[lane], z: ROW_Z[row], hp: def.hp, hpMax: def.hp, armedT: kind === 'mine' ? world.time + def.arm : kind === 'nova' ? world.time + def.fuse : null, armed: false, fireT: -9, hitT: -9, aimX: LANE_X[lane], aimZ: ROW_Z[row] - 6, t0: world.time, alive: true, cost: def.cost, _cd: rng() }
    world.devices.push(d); world.grid.cells[lane][row] = d
    ev.push({ type: 'devicePlace', id: d.id, kind, lane, row, x: d.x, z: d.z, cost: def.cost })
    return d
  }
  const unplace = (d) => { d.alive = false; const k = world.devices.indexOf(d); if (k >= 0) world.devices.splice(k, 1); world.grid.cells[d.lane][d.row] = null }
  let novaNext = 8
  if (opts.devices !== false) [['collector', 0, 0], ['sentry', 1, 0], ['barricade', 2, 1], ['mine', 3, 1], ['cryo', 4, 0], ['scorcher', 1, 2], ['mortarpit', 3, 0], ['sentry', 4, 2]].forEach(([k, l, r]) => place(k, l, r))

  // ------------------------------------------------ Boss 状态机（三种轮流）
  const BOSS_ORDER = ['ravager', 'matriarch', 'leviathan']
  let bossIdx = Math.max(0, BOSS_ORDER.indexOf(opts.boss || 'ravager')), bossNext = opts.bossAt ?? 6
  const setB = (b, st) => { b.state = st; b.stateT = world.time }
  const tg = (o) => { const t = { id: nextId++, t0: world.time, team: 'enemy', ...o }; world.telegraphs.push(t); return t }
  const zone = (type, x, z, r, dur, o = {}) => { const zn = { id: nextId++, type, x, z, r, t0: world.time, t1: world.time + dur, style: type, shape: 'circle', w: 0, d: 0, team: 'ally', ...o }; world.zones.push(zn); ev.push({ type: 'zone', id: zn.id, zone: type, x, z, r, dur, style: zn.style, shape: zn.shape, w: zn.w, d: zn.d }); return zn }
  function spawnBoss() {
    const kind = BOSS_ORDER[bossIdx % 3]; bossIdx++
    const b = { kind, x: 0, z: kind === 'leviathan' ? 5.5 : -19, hp: 4400, hpMax: 4400, state: kind === 'leviathan' ? 'burrowed' : 'walk', stateT: world.time, facing: 0, telegraphs: [], radius: kind === 'matriarch' ? 2.2 : kind === 'leviathan' ? 2 : 1.6, _t: 0, _n: 0, _born: world.time }
    world.boss = b
    ev.push({ type: 'bossSpawn', kind, x: b.x, z: b.z, hp: b.hp })
  }
  function updBoss(dt) {
    const b = world.boss, t = world.time
    if (!b) { if (t >= bossNext) spawnBoss(); return }
    const since = t - b.stateT
    if (b.state === 'dying') { if (since > 0.6) { world.boss = null; bossNext = t + 5 } return }
    b.hp = Math.max(1, b.hp - dt * 190)
    if (rng() < dt * 8) ev.push({ type: 'bossHit', x: b.x, z: b.z, dmg: 30 + rng() * 60, hp: b.hp })
    if (t - b._born > (opts.bossLife ?? 24)) { b.hp = 0; setB(b, 'dying'); ev.push({ type: 'bossDie', kind: b.kind, x: b.x, z: b.z }, { type: 'shake', amp: 0.34 }); for (let i = 0; i < s.count; i++) if (s.alive[i] && s.state[i] !== 2) s.state[i] = 4; return }
    if (b.kind === 'ravager') {
      const hold = -1.5
      if (b.state === 'walk') { if (b.z < hold) { b.z += 2.8 * dt; b.x = Math.sin(t * 0.35) * 2 } else if (since > 0.5) { setB(b, b._n++ % 3 === 2 ? 'charge_windup' : 'attack'); if (b.state === 'attack') ev.push({ type: 'bossAttack', kind: 'sweep', x: b.x, z: b.z, hits: 2 }); else { b._lane = world.squad.x; tg({ shape: 'lane', x: b._lane, z: 5, w: 4, z0: b.z, z1: 12.5, t1: t + 1.2, style: 'charge' }); ev.push({ type: 'bossAttack', kind: 'charge_windup', x: b._lane, z: b.z, t: 1.2, w: 4 }) } } }
      else if (b.state === 'attack') { if (since > 1.4) setB(b, 'walk') }
      else if (b.state === 'charge_windup') { b.x += (b._lane - b.x) * Math.min(1, dt * 6); if (since > 1.2) { setB(b, 'charge'); ev.push({ type: 'bossAttack', kind: 'charge', x: b.x, z: b.z }) } }
      else if (b.state === 'charge') { b.z += 40 * dt; if (b.z >= 6.5) { b.z = 6.5; setB(b, 'stunned'); ev.push({ type: 'bossStun', x: b.x, z: b.z, dur: 2 }, { type: 'shake', amp: 0.22 }) } }
      else if (b.state === 'stunned') { if (since > 2) { setB(b, 'walk'); b.z = -9 } }
    } else if (b.kind === 'matriarch') {
      if (b.state === 'walk') {
        if (b.z < -7) b.z += 3.4 * dt
        else if (since > 2.2) {
          setB(b, 'attack')
          if (b._n++ % 2 === 0) { for (let k = 0; k < 3; k++) { const x = world.squad.x + (k - 1) * 3.6 + (rng() - 0.5), z = 9 + rng() * 3; tg({ shape: 'circle', x, z, r: 1.5, t1: t + 1.1, style: 'acid' }); ev.push({ type: 'spit', x: b.x, z: b.z + 2, tx: x, tz: z, t: 1.1 }); later(1.1, () => { zone('acid', x, z, 1.5, 3, { team: 'enemy' }); ev.push({ type: 'explosion', x, z, r: 1.5, size: 'm', kind: 'acid' }) }) } ev.push({ type: 'bossAttack', kind: 'acid', x: b.x, z: b.z, count: 3, t: 1.1 }) }
          else { for (let k = 0; k < 6; k++) { const i = freeSlot(); if (i >= 0) { spawn(i, 1.2 + rng() * 3.3, 'egg'); s.x[i] = (rng() - 0.5) * 10.4; s.vz[i] = 0; s._sp[i] = 0; s._hatch = 1 } } ev.push({ type: 'bossAttack', kind: 'lay', x: b.x, z: b.z, count: 6 }) }
        }
      } else if (b.state === 'attack' && since > 0.5) setB(b, 'walk')
    } else {   // leviathan
      if (b.state === 'burrowed') { if (!b._warned && since > 0.1) { b._warned = true; b.x = world.squad.x; b.z = 5.5; tg({ shape: 'circle', x: b.x, z: b.z, r: 3, t1: t + 1.4, style: 'emerge' }); ev.push({ type: 'bossAttack', kind: 'emerge_windup', x: b.x, z: b.z, r: 3, t: 1.4 }) } if (since > 1.5) { setB(b, 'emerging'); b._warned = false; ev.push({ type: 'emerge', x: b.x, z: b.z, r: 3, hits: 0 }, { type: 'shake', amp: 0.26 }) } }
      else if (b.state === 'emerging') { if (since > 0.45) { setB(b, 'walk'); b._sp = 0 } }
      else if (b.state === 'walk') { if (since > 0.4 && b._sp === 0) { b._sp = 1; const x = world.squad.x; tg({ shape: 'lane', x, z: 11, w: 2.6, z0: b.z, z1: 16.5, t1: t + 1, style: 'spines' }); later(1, () => ev.push({ type: 'bossAttack', kind: 'spines', x, z: b.z, w: 2.6, hits: 0 })) } if (since > 1.3 && b._sp === 1) { b._sp = 2; setB(b, 'attack') } if (since > 3.1) { setB(b, 'burrowed'); ev.push({ type: 'bossAttack', kind: 'burrow', x: b.x, z: b.z }) } }
      else if (b.state === 'attack') { if (since > 0.8) { b.state = 'walk'; b.stateT = t - 1.4 } }
    }
  }
  const pendingFns = []
  function later(dt, fn) { pendingFns.push({ t: world.time + dt, fn }) }
  function freeSlot() { for (let i = 0; i < CAP; i++) if (!s.alive[i]) { if (i >= s.count) s.count = i + 1; return i } return -1 }

  // ------------------------------------------------ 每步
  let gateIdx = 0, gateNext = 3, flankNext = 9, strikeNext = 5, podNext = 8, fenceNext = 20, dieNext = 7, miscNext = 4, lvlNext = 15
  world.step = (input) => {
    ev.length = 0
    if (world.status !== 'running') return
    const dt = DT * (world.boss && world.boss.state === 'dying' ? 0.1 : 1)
    world.timeScale = dt / DT
    world.time += dt; const t = world.time; stream = t
    world.mission.timeLeft = Math.max(0, 95 - t)
    for (let i = pendingFns.length - 1; i >= 0; i--) if (pendingFns[i].t <= t) { const p = pendingFns[i]; pendingFns.splice(i, 1); p.fn() }
    const dying = world.boss && world.boss.state === 'dying'

    // ---- 队伍移动 ----
    const sq = world.squad
    if (input && input.targetX != null) sq.targetX = input.targetX
    else if (input && input.moveX) sq.targetX = Math.max(-4.3, Math.min(4.3, sq.targetX + input.moveX * 14 * dt))
    else if (!opts.still) sq.targetX = Math.sin(t * 0.33) * 1.6 + Math.sin(t * 0.11) * 0.8
    sq.x += (sq.targetX - sq.x) * 0.2
    let hp = 0
    for (const u of units) { if (!u.alive) continue; u.x += (Math.max(-6.1, Math.min(6.1, sq.x + u._sx)) - u.x) * 0.16; u.z += (8.1 + u._sz - u.z) * 0.16; hp += u.hp }
    sq.hp = hp; sq.hpMax = units.length * 10
    const cp = world.companion
    if (cp) {
      cp.x += (sq.x + 2.4 - cp.x) * 0.08; cp.z += (sq.frontZ + 1.2 - cp.z) * 0.08
      if (opts.companionStage == null && (cp._evo -= dt) <= 0) { cp._evo = 9; cp.stage = (cp.stage + 1) % 4; cp.form = FORMS[cp.stage]; ev.push({ type: 'companion', kind: cp.stage ? 'evolve' : 'join', stage: cp.stage, form: cp.form, x: cp.x, z: cp.z }) }
      if (cp.stage >= 2 && !dying) {
        if ((cp._bolt -= dt) <= 0) { cp._bolt = 0.45; const i = pick(cp.x, 6); if (i >= 0) { cp.fireT = t; cp.aimX = s.x[i]; cp.aimZ = s.z[i]; ev.push({ type: 'shot', unit: 'companion', kind: 'companion', x: cp.x, z: cp.z, tx: cp.aimX, tz: cp.aimZ, delay: 0.1 }, { type: 'explosion', x: cp.aimX, z: cp.aimZ, r: 1.7, size: 's', kind: 'companion' }); blast(cp.aimX, cp.aimZ, 1.5, 'companion') } }
        if ((cp._scan -= dt) <= 0) { cp._scan = 7; cp.scanT = t; ev.push({ type: 'companion', kind: 'scan', stage: cp.stage, form: cp.form, x: (rng() - 0.5) * 6, z: -2 - rng() * 5, r: 6.5, count: 40 }) }
        if (cp.stage >= 3 && (cp._pulse -= dt) <= 0) { cp._pulse = 6; cp.pulseT = t; ev.push({ type: 'companion', kind: 'pulse', stage: cp.stage, form: cp.form, x: sq.x, z: sq.frontZ - 6, r: 9.5, hits: 80 }, { type: 'shake', amp: 0.1 }) }
      }
    }

    // ---- 虫 ----
    let living = 0; s.kindCount.fill(0)
    const b = world.boss
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i]) continue
      const st = s.state[i]
      if (st === 2) { if (t - s.stateT[i] > LINGER) { if (i < N && !dying) { spawn(i, -22 - rng() * 3) } else s.alive[i] = 0 } continue }
      living++; s.kindCount[s.kind[i]]++
      if (st === 4 || dying) continue
      const name = kindNames[s.kind[i]]
      if (name === 'egg') { if (t - s.stateT[i] > 3) { ev.push({ type: 'hatch', x: s.x[i], z: s.z[i], count: 13 }); s.state[i] = 2; s.stateT[i] = t } continue }
      if (st === 3) { s.z[i] += s._sp[i] * dt; if (s.z[i] > 4) { s.state[i] = 1; s.stateT[i] = t; s.y[i] = 0; ev.push({ type: 'emerge', x: s.x[i], z: s.z[i], r: 1.8, i, hits: 0 }) } continue }
      if (st === 1) { if (t - s.stateT[i] > 0.9) { s.state[i] = 0; s.stateT[i] = t } continue }
      let vx = Math.sin(t * 0.8 + s._ph[i] * 3) * 0.55 + Math.sin(t * 0.23 + s.z[i] * 0.31 + s.seed[i] * 3) * 0.35, vz = s._sp[i]
      const x = s.x[i], z = s.z[i]
      if (b && b.state !== 'burrowed') { const dx = x - b.x, dz = z - b.z, rr = b.radius + 1.2, d2 = dx * dx + dz * dz; if (d2 < rr * rr) { const d = Math.sqrt(d2) + 1e-3, f = (rr - d) / rr * 6; vx += dx / d * f; vz += dz / d * f * 0.6 } }
      if (x > 6.0) vx -= (x - 6.0) * 6; else if (x < -6.0) vx += (-6.0 - x) * 6
      const stop = name === 'spitter' ? -2 : name === 'crusher' ? 1.5 : name === 'hulk' ? 3.5 : name === 'warden' ? -5 : 99
      if (z > stop) { vz = 0; if (rng() < dt * 0.5) { s.state[i] = 1; s.stateT[i] = t; const u = units[(rng() * units.length) | 0]; ev.push(name === 'spitter' ? { type: 'spit', x, z, tx: u.x, tz: u.z, t: 0.45 } : { type: 'enemyAttack', i, kind: name, x, z, tx: name === 'hulk' ? x : u.x, tz: name === 'hulk' ? z + 2 : u.z }) } }
      s.vx[i] += (vx - s.vx[i]) * Math.min(1, dt * 6); s.vz[i] = vz
      s.x[i] = x + s.vx[i] * dt; s.z[i] = z + vz * dt
      if (name === 'digger' && z > -12 && z < -11.5 && rng() < 0.5) { s.state[i] = 3; s.stateT[i] = t; s.y[i] = -1; tg({ shape: 'circle', x: s.x[i], z: 4, r: 1.8, t0: t + (4 - z) / s._sp[i] - 1.2, t1: t + (4 - z) / s._sp[i], style: 'emerge' }) }
      if (s.y[i] === 0 && s.z[i] > 3.4) { const p = (s.z[i] - 3.4) / 3.2; if (rng() < p * p * dt * 9 || s.z[i] > 6.6) { if (name === 'burster') { ev.push({ type: 'burst', x: s.x[i], z: s.z[i], r: 1.65 }); kill(i, 'self', 1) } else kill(i, 'flamer') } }
      if (s.y[i] > 0 && s.z[i] > 13) { if (rng() < dt * 2) kill(i, 'skyhook'); if (s.z[i] > 17) { ev.push({ type: 'leak', kind: name, x: s.x[i] }); s.state[i] = 2; s.stateT[i] = t - LINGER } }
    }
    s.living = living
    rebuildLanes()

    // ---- 开火 ----
    if (!dying) for (const u of units) {
      if (!u.alive) continue
      u._cd -= dt; if (u._cd > 0) continue
      u._cd += u._iv * (0.9 + rng() * 0.2)
      const k = u.kind
      if (k === 'rifle' || k === 'hero_hawk') {
        let tx, tz, target = -1
        if (b && b.state !== 'burrowed' && b.z > -12 && rng() < 0.3) { tx = b.x + (rng() - 0.5) * 2; tz = b.z + 1 } else { target = pick(u.x, 2.6); if (target < 0) continue; tx = s.x[target]; tz = s.z[target] }
        u.fireT = t; u.aimX = tx; u.aimZ = tz; u.facing = Math.atan2(tx - u.x, tz - u.z)
        ev.push({ type: 'shot', unit: u.id, kind: k, x: u.x, z: u.z, tx, tz, delay: k === 'rifle' ? 0.08 : 0.04 })
        if (target >= 0) { if (kindNames[s.kind[target]] === 'ling' || rng() < 0.2) kill(target, 'rifle'); else { s.hitT[target] = t; ev.push({ type: 'enemyHit', i: target, x: tx, z: tz, dmg: 2.2, crit: false }) } }
      } else if (k === 'flamer') {
        u.fireT = t; u.facing = Math.PI + Math.sin(t * 1.3 + u.id) * 0.3
        ev.push({ type: 'flame', unit: u.id, x: u.x, z: u.z, dir: u.facing, arc: 0.9, range: 6.8 })
      } else if (k === 'mortar' || k === 'titan') {
        const tx = Math.max(-5, Math.min(5, u.x * 0.8 + (rng() - 0.5) * 8)), tz = (b && b.state !== 'burrowed' && rng() < 0.4) ? b.z : -1 - rng() * 8
        const x2 = b && tz === b.z ? b.x : tx
        u.fireT = t; u.aimX = x2; u.aimZ = tz; u.facing = Math.atan2(x2 - u.x, tz - u.z)
        ev.push({ type: 'shot', unit: u.id, kind: k, x: u.x, z: u.z, tx: x2, tz, delay: 0.13 })
        const n = k === 'titan' ? 2 : 1
        for (let j = 0; j < n; j++) { const ex = x2 + (n > 1 ? (j - 0.5) * 1.3 : 0); ev.push({ type: 'explosion', x: ex, z: tz, r: k === 'titan' ? 3 : 3.6, size: k === 'titan' ? 'm' : 'l', kind: k }); blast(ex, tz, k === 'titan' ? 2.4 : 3.0, k) }
        if (rng() < 0.3) ev.push({ type: 'bigHit', x: x2, z: tz, dmg: 40 + rng() * 120 })
      } else if (k === 'lancer') {
        let i = findKind('crusher', -12); if (i < 0) i = findKind('hulk', -14); if (i < 0) i = pick(u.x, 6); if (i < 0) continue
        u.fireT = t; u.facing = Math.atan2(s.x[i] - u.x, s.z[i] - u.z)
        ev.push({ type: 'shot', unit: u.id, kind: k, x: u.x, z: u.z, tx: s.x[i], tz: s.z[i], delay: 0.05 })
        if (rng() < 0.5) { const pts = [{ x: s.x[i], z: s.z[i] }]; for (let j = 0; j < 3; j++) pts.push({ x: pts[j].x + (rng() - 0.5) * 4, z: pts[j].z + (rng() - 0.5) * 4 }); ev.push({ type: 'chain', points: pts, kind: 'lancer' }) }
        if (rng() < 0.4) kill(i, 'lancer', 1); else { s.hitT[i] = t; ev.push({ type: 'enemyHit', i, x: s.x[i], z: s.z[i], dmg: 24, crit: true }) }
      } else if (k === 'reaper') {
        const cz = -2 - rng() * 6, rev = rng() < 0.5
        u.fireT = t; u.facing = Math.atan2(-u.x, cz - u.z)
        ev.push({ type: 'beam', kind: 'reaper', x0: rev ? 4 : -4, z0: cz, x1: rev ? -4 : 4, z1: cz, dur: 0.6, w: 2.8 })
        for (let j = 0; j < 12; j++) later(j * 0.05, () => blast((rev ? 4 : -4) + (rev ? -1 : 1) * j * 0.7, cz, 1.2, 'reaper'))
        if (rng() < 0.5) zone('fire', 0, cz, 4, 3, { style: 'scorch', shape: 'rect', w: 8, d: 2.8 })
      } else if (k === 'psion') {
        const x = (rng() - 0.5) * 8, z = -2 - rng() * 7
        u.fireT = t; u.facing = Math.atan2(x - u.x, z - u.z)
        ev.push({ type: 'storm', x, z, r: 3.1, dur: 2.8, unit: u.id }); zone('storm', x, z, 3.1, 2.8)
        for (let j = 0; j < 8; j++) later(j * 0.35, () => blast(x, z, 2.2, 'psion'))
      } else if (k === 'skyhook') {
        u.fireT = t
        for (let j = 0; j < 3; j++) { let i = findKind('wing', -14); if (i < 0) i = pick((rng() - 0.5) * 10, 4); if (i < 0) continue; const a = t * 1.57 + j * 2.09; ev.push({ type: 'shot', unit: null, kind: k, x: u.x + Math.cos(a) * 1.05, z: u.z + Math.sin(a) * 1.05, tx: s.x[i], tz: s.z[i], delay: 0.05 }); if (rng() < 0.6) kill(i, 'skyhook') }
      }
    }
    // ---- 装置 ----
    if (opts.devices !== false && t >= novaNext && !world.grid.cells[2][3]) { novaNext = t + 14; place('nova', 2, 3) }
    for (const d of world.devices) {
      if (d.kind === 'mine' && !d.armed && t >= d.armedT) { d.armed = true; ev.push({ type: 'mineArm', id: d.id, x: d.x, z: d.z }) }
      if (d.kind === 'nova' && t >= d.armedT) { unplace(d); ev.push({ type: 'novaBlast', id: d.id, x: d.x, z: d.z, w: 7.68, d: 9, hits: 0 }, { type: 'hitstop', ms: 50 }, { type: 'shake', amp: 0.3 }); blast(d.x, d.z, 4.5, 'nova'); break }
      d._cd -= dt; if (d._cd > 0 || dying) continue
      if (d.kind === 'sentry' || d.kind === 'cryo') { d._cd = d.kind === 'sentry' ? 0.2 : 0.35; const i = pick(d.x, 1.5); if (i < 0) continue; d.fireT = t; d.aimX = s.x[i]; d.aimZ = s.z[i]; ev.push({ type: 'deviceFire', id: d.id, kind: d.kind, x: d.x, z: d.z, tx: s.x[i], tz: s.z[i] }); if (rng() < 0.5) kill(i, d.kind) }
      else if (d.kind === 'mortarpit') { d._cd = 2.2; d.fireT = t; const tz = d.z - 6 - rng() * 5; d.aimX = d.x; d.aimZ = tz; ev.push({ type: 'deviceFire', id: d.id, kind: d.kind, x: d.x, z: d.z, tx: d.x, tz }, { type: 'explosion', x: d.x, z: tz, r: 2.4, size: 'm', kind: 'mortarpit' }); blast(d.x, tz, 2.2, 'mortarpit') }
      else if (d.kind === 'scorcher') { d._cd = 0.3; d.fireT = t; ev.push({ type: 'deviceFire', id: d.id, kind: d.kind, x: d.x, z: d.z }, { type: 'flame', unit: 'd' + d.id, x: d.x, z: d.z, dir: Math.PI, arc: 2.6, range: 1.9 }) }
      else if (d.kind === 'collector') { d._cd = 5; d.fireT = t; world.energy += 15; ev.push({ type: 'energy', x: d.x, z: d.z, amount: 15, source: 'collector' }) }
      else if (d.kind === 'mine' && d.armed && t > d.armedT + 3) { unplace(d); ev.push({ type: 'mineBlast', id: d.id, x: d.x, z: d.z, r: DEVICES.mine.r }, { type: 'explosion', x: d.x, z: d.z, r: DEVICES.mine.r, size: 'm', kind: 'mine' }); blast(d.x, d.z, 2.2, 'mine'); later(4, () => place('mine', d.lane, d.row)); break }
      else if (d.kind === 'barricade') {
        d._cd = 0.12; d.hitT = t; d.hp -= 5; ev.push({ type: 'deviceHit', id: d.id, kind: d.kind, x: d.x, z: d.z, dmg: 5, hp: Math.max(0, d.hp) })
        if (d.hp <= 0) { unplace(d); ev.push({ type: 'deviceDie', id: d.id, kind: d.kind, lane: d.lane, row: d.row, x: d.x, z: d.z, by: 'ling' }); later(5, () => place('barricade', d.lane, d.row)); break }
      }
      else d._cd = 1
    }

    // ---- 杂项：门 / 突袭预警 / 我方打击 / 空投舱 / 电网 / 阵亡 / 升级 ----
    if (t >= gateNext && !world.gates) {
      const kinds = ['rifle', 'flamer', 'mortar', 'titan', 'lancer', 'reaper', 'psion', 'skyhook'], types = ['unit', 'unit', 'heal', 'module', 'contract', 'stat', 'device']
      const mk = (j) => { const type = types[(gateIdx + j * 3) % types.length], unit = kinds[(gateIdx * 2 + j) % kinds.length]; return { type, unit: type === 'unit' || type === 'heal' ? unit : null, count: 2 + ((gateIdx * 3 + j * 5) % 9), extra: null, tags: [], titleKey: 'gate.unit', params: { moduleId: 'rifle_pierce', contract: 'bloodhound' } } }
      world.gates = { index: gateIdx, total: 10, z: -13, left: mk(0), right: mk(1), resolveT: t + 2, kind: 'supply' }
      ev.push({ type: 'gateSpawn', index: gateIdx, left: world.gates.left, right: world.gates.right })
    }
    if (world.gates) { world.gates.z += 10.7 * dt; if (world.gates.z >= 8.4) { const side = sq.x < 0 ? 'left' : 'right'; ev.push({ type: 'gateResolve', index: world.gates.index, side, option: world.gates[side], x: side === 'left' ? -3.2 : 3.2, z: 8.4 }, { type: 'unitJoin', ids: [], kind: 'rifle', count: 8, source: 'gate' }); world.gates = null; gateIdx++; gateNext = t + (opts.gateEvery ?? 9) } }
    if (t >= flankNext) { flankNext = t + 11; const side = rng() < 0.5 ? -1 : 1; tg({ shape: 'lane', x: side * 5.1, z: -8, w: 2.4, z0: -21, z1: 4, t1: t + 1.6, style: 'flank' }); ev.push({ type: 'flankWarn', side, count: 480, t: 1.6 }) }
    if (t >= strikeNext) {
      strikeNext = t + 7
      const x = (rng() - 0.5) * 8, z = -3 - rng() * 7
      tg({ shape: 'circle', x, z, r: 2.6, t1: t + 1.0, team: 'ally', style: 'strike' }); later(1.0, () => { ev.push({ type: 'explosion', x, z, r: 4, size: 'xl', kind: 'power_orbital' }, { type: 'bigHit', x, z, dmg: 80 + rng() * 200 }); blast(x, z, 3.6, 'power') })
      tg({ shape: 'line', x: -5, z: z + 4, x1: 5, z1: z + 7, w: 0.9, t1: t + 1.4, team: 'ally', style: 'lance' }); later(1.4, () => { ev.push({ type: 'beam', kind: 'power_lance', x0: -5, z0: z + 4, x1: 5, z1: z + 7, dur: 0.35, w: 1 }); zone('void', 0, z + 5.5, 1.6, 2.5) })
    }
    if (t >= podNext && world.pods.length === 0) { podNext = t + 26; const p = { id: nextId++, x: (rng() - 0.5) * 6, z: 2.5, hp: 350, hpMax: 350, contract: 'bloodhound', hitT: -9 }; world.pods.push(p); ev.push({ type: 'podLand', id: p.id, x: p.x, z: p.z }) }
    for (const p of world.pods) { p.hp -= dt * 60; if (rng() < dt * 10) p.hitT = t; if (p.hp <= 0) { ev.push({ type: 'podOpen', id: p.id, x: p.x, z: p.z, contract: p.contract }); world.pods.length = 0; break } }
    if (t >= fenceNext) { fenceNext = t + 22; const lane = (rng() * 5) | 0; world.fences[lane] = false; ev.push({ type: 'fence', lane, x: LANE_X[lane], z: 16.5, kills: 0 }, { type: 'shake', amp: 0.16 }); for (let i = 0; i < s.count; i++) if (s.alive[i] && s.state[i] !== 2 && Math.abs(s.x[i] - LANE_X[lane]) < 1.28 && s.y[i] < 1) kill(i, 'fence', 1); later(10, () => { world.fences[lane] = true; ev.push({ type: 'fenceRefill', lanes: [lane] }) }) }
    if (t >= dieNext) { dieNext = t + 6; const u = units[8 + ((rng() * 50) | 0)]; if (u && u.alive && u.kind === 'rifle') { u.alive = false; ev.push({ type: 'unitHit', id: u.id, x: u.x, z: u.z, dmg: 3 }, { type: 'unitDie', id: u.id, kind: u.kind, x: u.x, z: u.z, name: u.name }); later(3, () => { u.alive = true; u.z = 17.2; ev.push({ type: 'unitJoin', ids: [u.id], kind: u.kind, count: 1, source: 'gate' }) }) } }
    if (t >= miscNext) { miscNext = t + 1.3; const u = units[(rng() * units.length) | 0]; if (u.alive) { u.hitT = t; ev.push({ type: 'unitHit', id: u.id, x: u.x, z: u.z, dmg: 1 }) } if (rng() < 0.25) zone(['fire', 'mine', 'cryo', 'gravity'][(rng() * 4) | 0], (rng() - 0.5) * 9, -6 + rng() * 9, 1.6 + rng(), 4) }
    if (t >= lvlNext) { lvlNext = t + 17; ev.push(rng() < 0.5 ? { type: 'levelUp', level: ++world.progress.level } : { type: 'heroic', id: 'heroic_rifle', unit: 'rifle', squadName: 'squad.x' }, { type: 'heal', amount: 10 }) }

    updBoss(dt)
    const tgs = world.telegraphs; let w = 0
    for (let n = 0; n < tgs.length; n++) if (t < tgs[n].t1) tgs[w++] = tgs[n]
    tgs.length = w
    const zs = world.zones; w = 0
    for (let n = 0; n < zs.length; n++) if (t < zs[n].t1) zs[w++] = zs[n]
    zs.length = w
    world.stats.killRate += (0 - world.stats.killRate) * 0.02
  }
  world.result = () => ({ outcome: 'running', kills: world.stats.kills })
  return world
}
