// dev/worlddemo.js —— 场景 / 门 / 装置 / 技能特效的单项演示（dev/render.html?demo=xxx）。只给开发页用。
//   ?demo=env                       空场：只有队伍，看桥和两侧环境（配合 ?theme= / ?cam=）
//   ?demo=gates[&gi=0..5][&gz=2]    增援门循环滑过来结算；gi 固定某一组选项（5 = 悬赏门），gz 把门定在某个 z 上不动
//   ?demo=pod                       雇佣兵空投舱：下落 → 落地冲击 → 带血条滑行挨打 → 开舱；再来一只「空投支援」的舱（落地自己开）
//   ?demo=devices                   八种装置全上场实战（真模拟）：哨戒 / 冷凝开火转向、迫击炮、喷火、采集器产晶能、地雷武装引爆、聚变炸弹倒计时、路障被啃冒烟被毁、铲除收回、应急电网
//   ?demo=place[&kind=sentry]       布防预览：5×4 格高亮 + 全息虚影在格子间巡游（走到有装置的格子变红）
//   ?demo=fence                     应急电网：五道轮流触发再复位
//   ?demo=power.<id>                指挥官技能（真模拟的摆拍世界）：hawk_rally / hawk_strike / hawk_drop / hawk_flagship /
//                                   ysera_orbital / ysera_lance / ysera_eclipse / joe_drop / joe_mines / joe_ray / joe_drill（老猫的钻机）
//   ?demo=bossdie[&boss=ravager]    Boss 死亡的子弹时间演出
// 控制台：__shot('w-xx.jpg', 推进秒数) 把 1600×900 的画面存到 docs/art（要先起 node <scratch>/shot-w.cjs 5195）；__demo.cast() 再放一次技能
import { ENEMY_KINDS } from '../src/data/enemies.js'
import { DEVICE_KINDS } from '../src/data/devices.js'

const DT = 1 / 60
const LANE_X = [-5.12, -2.56, 0, 2.56, 5.12], ROW_Z = [4.5, 1.5, -1.5, -4.5]
let sim = null
try {
  const [w, sq, sw, bs, cm, dv] = await Promise.all([import('../src/sim/world.js'), import('../src/sim/squad.js'), import('../src/sim/swarm.js'), import('../src/sim/boss.js'), import('../src/data/commanders.js'), import('../src/sim/devices.js')])
  sim = { createWorld: w.createWorld, addUnits: sq.addUnits, spawn: sw.spawn, spawnBoss: bs.spawnBoss, POWERS: cm.POWERS, dev: dv }
} catch (e) { console.info('[demo] src/sim 不可用，power.* / bossdie 演示跑不了：' + (e && e.message)) }

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// ------------------------------------------------------------------ 舞台世界（按契约 §2 的字段造的最小世界）
function createStage(opts = {}) {
  const rng = mulberry(opts.seed || 11)
  const CAP = 4096, f32 = () => new Float32Array(CAP), u8 = () => new Uint8Array(CAP)
  const s = { cap: CAP, count: 0, living: 0, kindNames: ENEMY_KINDS, kindCount: new Uint16Array(ENEMY_KINDS.length), alive: u8(), kind: u8(), x: f32(), z: f32(), y: f32(), vx: f32(), vz: f32(), hp: f32(), hpMax: f32(), state: u8(), stateT: f32(), elite: u8(), shield: f32(), scale: f32(), seed: f32(), hitT: f32(), _sp: f32() }
  const world = {
    demo: true, seed: opts.seed || 11, time: 0, phase: 'campaign', status: 'running', timeScale: 1, events: [],
    squad: { x: 0, targetX: 0, frontZ: 8.1, backZ: 13.6, hp: 0, hpMax: 0, units: [], counts: {}, caps: { infantry: 60, artillery: 4, heavy: 3 }, fallen: [] },
    swarm: s, boss: null, telegraphs: [], zones: [], gates: null, pods: [], levelup: null, powers: [], summons: [], aiming: null,
    progress: { level: 1, xp: 0, xpNext: 280, xpPrev: 0, modules: {}, combos: [], heroics: [] },
    line: { hp: 1000, hpMax: 1000 }, wave: { index: 0, name: null, herald: null }, endless: null,
    stats: { kills: 0, killRate: 0, peakKillRate: 0, combo: 0, comboMult: 1, leaked: 0, losses: 0, deployed: {}, dmgByUnit: {}, timeline: [] },
    mission: { timeLeft: 180, label: null },
    lanes: LANE_X.map((x, i) => ({ index: i, x, w: 2.56 })), grid: { cells: LANE_X.map(() => ROW_Z.map(() => null)) }, devices: [], energy: 100, cards: [], fences: LANE_X.map(() => true),
  }
  const ev = world.events, units = world.squad.units
  let nextId = 1
  const add = (kind, sx, sz, o = {}) => { const u = { id: nextId++, kind, x: sx, z: 8.1 + sz, hp: 10, hpMax: 10, shield: 0, alive: true, aimX: sx, aimZ: 0, fireT: -9, hitT: -9, name: null, elite: false, kills: 0, dmg: 0, facing: Math.PI, _sx: sx, _sz: sz, _cd: rng(), ...o }; units.push(u); world.squad.counts[kind] = (world.squad.counts[kind] || 0) + 1; return u }
  const COLS = [5, 6, 4, 7, 3, 8, 2, 9, 1, 10, 0, 11]
  const nR = opts.rifles ?? 36
  for (let i = 0; i < 4; i++) add('flamer', ([2, 4, 7, 9][i] - 5.5) * 0.94, 0)
  for (let i = 0; i < nR; i++) add('rifle', (COLS[i % 12] - 5.5) * 0.94, (1 + Math.floor(i / 12)) * 0.92)
  if (opts.heavies !== false) { add('mortar', -1.5, 5.0); add('titan', -4.6, 6.4); add('lancer', 1.8, 6.2) }
  const later = [], at = (dt, fn) => later.push({ t: world.time + dt, fn })
  const free = () => { for (let i = 0; i < CAP; i++) if (!s.alive[i]) { if (i >= s.count) s.count = i + 1; return i } return -1 }
  const bug = (kind, x, z, sp = 2.6) => { const i = free(); if (i < 0) return -1; s.alive[i] = 1; s.kind[i] = ENEMY_KINDS.indexOf(kind); s.x[i] = x; s.z[i] = z; s.y[i] = 0; s.vx[i] = 0; s.vz[i] = sp; s._sp[i] = sp; s.hp[i] = s.hpMax[i] = 2; s.state[i] = 0; s.stateT[i] = world.time; s.elite[i] = 0; s.shield[i] = 0; s.scale[i] = kind === 'ling' ? 0.95 + rng() * 0.15 : 1.6; s.seed[i] = rng(); s.hitT[i] = -9; return i }
  const kill = (i, by) => { if (!s.alive[i] || s.state[i] === 2) return; s.state[i] = 2; s.stateT[i] = world.time; world.stats.kills++; ev.push({ type: 'enemyDie', i, kind: ENEMY_KINDS[s.kind[i]], x: s.x[i], z: s.z[i], by, gore: 0 }); if (rng() < 0.5) ev.push({ type: 'energy', x: s.x[i], z: s.z[i], amount: 0.15 }) }
  const blast = (x, z, r, by) => { for (let i = 0; i < s.count; i++) if (s.alive[i] && s.state[i] !== 2 && Math.hypot(s.x[i] - x, s.z[i] - z) < r) kill(i, by) }
  const nearestInLane = (x, zMax, halfW = 1.2) => { let b = -1, bz = -1e9; for (let i = 0; i < s.count; i++) if (s.alive[i] && s.state[i] !== 2 && Math.abs(s.x[i] - x) < halfW && s.z[i] < zMax && s.z[i] > bz) { b = i; bz = s.z[i] } return b }
  const place = (kind, lane, row, o = {}) => { const d = { id: nextId++, kind, lane, row, x: LANE_X[lane], z: ROW_Z[row], hp: 40, hpMax: 40, armedT: null, fireT: -9, hitT: -9, t0: world.time, alive: true, _cd: 0.3 + rng() * 0.3, ...o }; world.devices.push(d); world.grid.cells[lane][row] = d; ev.push({ type: 'devicePlace', id: d.id, kind, lane, row, x: d.x, z: d.z }); return d }
  const remove = (d, event) => { const k = world.devices.indexOf(d); if (k >= 0) world.devices.splice(k, 1); world.grid.cells[d.lane][d.row] = null; d.alive = false; if (event) ev.push({ type: event, id: d.id, kind: d.kind, x: d.x, z: d.z }) }
  const script = []   // 每步调用的函数
  world.step = (input) => {
    ev.length = 0
    world.time += DT; const t = world.time
    for (let i = later.length - 1; i >= 0; i--) if (later[i].t <= t) { const p = later[i]; later.splice(i, 1); p.fn() }
    const sq = world.squad
    if (input && input.targetX != null) sq.targetX = input.targetX; else if (input && input.moveX) sq.targetX = Math.max(-4.3, Math.min(4.3, sq.targetX + input.moveX * 14 * DT)); else if (opts.sway) sq.targetX = Math.sin(t * opts.sway) * 2.2
    sq.x += (sq.targetX - sq.x) * 0.2
    for (const u of units) { u.x += (Math.max(-6.1, Math.min(6.1, sq.x + u._sx)) - u.x) * 0.16; u.z += (8.1 + u._sz - u.z) * 0.16 }
    let living = 0
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i]) continue
      if (s.state[i] === 2) { if (t - s.stateT[i] > 2.1) s.alive[i] = 0; continue }
      living++
      if (s.state[i] === 0) { s.vz[i] = s._sp[i]; s.z[i] += s._sp[i] * DT } else s.vz[i] = 0
    }
    s.living = living
    for (const f of script) f(t)
    const tg = world.telegraphs; let w = 0; for (let n = 0; n < tg.length; n++) if (t < tg[n].t1) tg[w++] = tg[n]; tg.length = w
    const zs = world.zones; w = 0; for (let n = 0; n < zs.length; n++) if (t < zs[n].t1) zs[w++] = zs[n]; zs.length = w
  }
  world.result = () => ({ outcome: 'running', kills: world.stats.kills })
  return { world, ev, rng, at, add, bug, kill, blast, nearestInLane, place, remove, script, units, s, nextId: () => nextId++ }
}

// ------------------------------------------------------------------ 门
const U = (kind, count, tags, extra) => ({ type: 'unit', unit: kind, count, extra: extra || null, tags, titleKey: extra ? 'gate.unit_escort' : 'gate.unit', params: { count, unitKey: 'unit.' + kind + '.name', extraCount: extra ? extra.count : 0, extraKey: extra ? 'unit.' + extra.unit + '.name' : null } })
const GATE_SETS = [
  [U('rifle', 8, ['versatile', 'anti_air']), U('mortar', 1, ['aoe', 'anti_heavy'], { unit: 'rifle', count: 4 })],
  [U('flamer', 4, ['front', 'anti_light']), U('titan', 1, ['anti_heavy', 'aoe', 'anti_air'])],
  [{ type: 'heal', unit: 'rifle', count: 10, extra: null, tags: ['heal'], titleKey: 'gate.reinforce', params: { count: 10, unitKey: 'unit.rifle.name' } }, U('lancer', 1, ['anti_boss', 'anti_heavy'])],
  [{ type: 'contract', unit: 'rifle', count: 6, extra: null, tags: ['merc', 'versatile'], titleKey: 'gate.contract', params: { contract: 'bloodhound', nameKey: 'contract.bloodhound.name', count: 6, unitKey: 'unit.rifle.name' } }, U('skyhook', 1, ['anti_air'])],
  [{ type: 'stat', unit: null, count: 0, extra: null, tags: ['cost'], titleKey: 'gate.boon', params: { boon: 'overload', nameKey: 'boon.overload.name', cost: true } }, U('psion', 1, ['aoe'])],
  [{ type: 'stat', unit: null, count: 0, extra: null, tags: ['bounty'], titleKey: 'gate.boon', params: { boon: 'bounty_arms', nameKey: 'boon.bounty_arms.name', cost: false } }, { type: 'contract', unit: 'mortar', count: 1, extra: null, tags: ['merc', 'aoe'], titleKey: 'gate.contract', params: { contract: 'hammer', nameKey: 'contract.hammer.name', count: 1, unitKey: 'unit.mortar.name' } }],
]
function demoGates(Q) {
  const st = createStage({ sway: 0.5 }), { world, ev } = st
  const fixed = Q.has('gi') ? Number(Q.get('gi')) : -1, hold = Q.has('gz') ? Number(Q.get('gz')) : null
  let idx = fixed >= 0 ? fixed : 0, next = 0.4
  st.script.push((t) => {
    if (!world.gates && t >= next) {
      const set = GATE_SETS[idx % GATE_SETS.length]
      world.gates = { index: idx, total: 10, z: -13, left: set[0], right: set[1], resolveT: t + 2, kind: idx % GATE_SETS.length === 5 ? 'bounty' : 'supply' }
      ev.push({ type: 'gateSpawn', index: idx, left: set[0], right: set[1], kind: world.gates.kind })
    }
    const G = world.gates
    if (G) {
      if (hold != null && G.z >= hold) { G.z = hold; return }
      G.z += 10.7 * DT
      if (G.z >= 8.4) { const side = world.squad.x < 0 ? 'left' : 'right'; ev.push({ type: 'gateResolve', index: G.index, side, option: G[side], x: side === 'left' ? -3.2 : 3.2, z: 8.4 }, { type: 'unitJoin', ids: [], kind: 'rifle', count: 8, source: 'gate' }); world.gates = null; if (fixed < 0) idx++; next = t + 1.6 }
    }
  })
  return { world }
}

// ------------------------------------------------------------------ 空投舱
function demoPod() {
  const st = createStage({}), { world, ev } = st
  let next = 0.5, n = 0
  st.script.push((t) => {
    if (t >= next && world.pods.length === 0) {
      next = t + 9
      const contract = n++ % 2 === 0, x = contract ? -2.4 : 2.6, z = contract ? -3 : 3.5
      world.telegraphs.push({ id: st.nextId(), shape: 'circle', x, z, r: 2.2, t0: t, t1: t + 0.8, team: 'ally', style: 'pod' })
      ev.push({ type: 'strike', power: contract ? 'contract' : 'hawk_drop', kind: 'pod', x, z, r: 2.2, delay: 0.8 })
      if (contract) st.at(0.8, () => { const p = { id: st.nextId(), x, z, hp: 350, hpMax: 350, contract: 'bloodhound', hitT: -9 }; world.pods.push(p); ev.push({ type: 'podLand', id: p.id, x, z, contract: p.contract, hp: p.hp }) })
      else st.at(0.8, () => ev.push({ type: 'explosion', x, z, r: 2.2, size: 'm', kind: 'hawk_drop' }, { type: 'unitJoin', ids: [], kind: 'flamer', count: 3, source: 'drop' }))
    }
    for (const p of world.pods) {
      p.z += 1.5 * DT
      if (t % 0.1 < DT) { const u = st.units[(st.rng() * st.units.length) | 0]; u.fireT = t; u.facing = Math.atan2(p.x - u.x, p.z - u.z); ev.push({ type: 'shot', unit: u.id, kind: u.kind === 'rifle' ? 'rifle' : 'rifle', x: u.x, z: u.z, tx: p.x + (st.rng() - 0.5), tz: p.z, delay: 0.08 }); p.hp -= 9; p.hitT = t }
      if (p.hp <= 0) { ev.push({ type: 'podOpen', id: p.id, x: p.x, z: p.z, contract: p.contract }, { type: 'unitJoin', ids: [], kind: 'rifle', count: 6, source: 'contract' }); world.pods.length = 0; next = t + 2.5; break }
    }
  })
  return { world }
}

// ------------------------------------------------------------------ 装置（真模拟的摆拍世界：src/sim/devices.js 的 placeDevice / triggerFence，字段和事件都是真的）
//   devices  八种装置全上场实战：哨戒 / 冷凝转向开火、迫击炮抛射、喷火陷阱烧一排、采集器产晶能、地雷武装 → 引爆、聚变炸弹倒计时、路障被啃冒烟被毁再补、
//            每 18 秒铲除再重放一座哨戒塔（deviceRemove + 返还晶能）、电网轮流触发再补满；混着举盾虫 / 跳跃虫 / 甲壳兽
//   place    同一个世界，虫少一点；布防预览在格子间巡游（install 里的 tick 驱动 view.setPlacement）
//   fence    五道电网轮流触发 → 补满
const DEFENSE_LAYOUT = [['collector', 0, 0], ['sentry', 1, 1], ['barricade', 1, 2], ['cryo', 2, 1], ['mortarpit', 3, 0], ['scorcher', 3, 2], ['sentry', 4, 1], ['barricade', 4, 2], ['mine', 0, 3], ['mine', 2, 2]]
function demoDefense(Q, mode) {
  if (!sim || !sim.dev) return null
  const D = sim.dev
  const world = sim.createWorld({ seed: Number(Q.get('seed') || 5), sandbox: true, commander: Q.get('commander') || 'none' })
  sim.addUnits(world, 'rifle', Number(Q.get('rifles') || (mode === 'devices' ? 10 : 16)), 'test'); sim.addUnits(world, 'flamer', 2, 'test')
  for (const k of DEVICE_KINDS) D.unlockDevice(world, k)
  world.energy = 5000
  const K = (k) => ENEMY_KINDS.indexOf(k), rng = mulberry(7)
  for (const [k, l, r] of DEFENSE_LAYOUT) D.placeDevice(world, k, l, r, true)
  const input = { moveX: null, targetX: 0, powers: [], aim: null, pick: null, reroll: false, place: null, remove: null }
  const rate = Number(Q.get('rate') || (mode === 'devices' ? 26 : mode === 'place' ? 8 : 18))
  let acc = 0, novaNext = 3, fenceNext = mode === 'fence' ? 1 : 14, fenceLane = 0, refillAt = -1, swapNext = 18, bigNext = 2
  const restore = []    // { t, kind, lane, row }：被毁 / 炸掉的过一会儿补回去
  // 直接调模拟函数（免费放置 / 触发电网 / 补满）产生的事件要排在这一步之后：world.step 开头会清空 events，bot 里当场调的话表现层收不到
  const post = [], step0 = world.step
  world.step = (inp) => { step0(inp); for (const f of post) f(); post.length = 0 }
  const bot = (w) => {
    const t = w.time
    input.place = null; input.remove = null
    // 虫沿五条道涌过来：裂爪虫为主，混着跳跃虫 / 脓爆虫，隔一阵来几只大个头
    acc += DT * rate
    while (acc >= 1) { acc -= 1; const l = (rng() * 5) | 0, u = rng(); sim.spawn(w, K(u < 0.1 ? 'leaper' : u < 0.13 ? 'burster' : 'ling'), LANE_X[l] + (rng() - 0.5) * 1.9, -21 - rng() * 3) }
    if (t >= bigNext && mode !== 'fence') { bigNext = t + 5; const l = (rng() * 5) | 0; sim.spawn(w, K(['shieldbug', 'crusher', 'shieldbug', 'hulk'][(rng() * 4) | 0]), LANE_X[l], -21) }
    // 被毁的装置补回去（免费放）
    for (const [k, l, r] of DEFENSE_LAYOUT) if (!w.grid.cells[l][r] && !restore.some((q) => q.lane === l && q.row === r)) restore.push({ t: t + (k === 'mine' ? 3 : 5), kind: k, lane: l, row: r })
    for (let i = restore.length - 1; i >= 0; i--) if (t >= restore[i].t) { const q = restore[i]; restore.splice(i, 1); post.push(() => { if (!w.grid.cells[q.lane][q.row]) D.placeDevice(w, q.kind, q.lane, q.row, true) }) }
    if (mode === 'fence') {
      if (t >= fenceNext) { fenceNext = t + 2.4; const l = fenceLane++ % 5; post.push(() => D.triggerFence(w, l)); refillAt = fenceLane % 5 === 0 ? t + 1.6 : -1 }
      if (refillAt > 0 && t >= refillAt) { refillAt = -1; post.push(() => D.refillFences(w)) }
      return input
    }
    // 聚变炸弹：每 9 秒往中路最前排扔一颗（走正常的 input.place：扣钱、进冷却）
    if (t >= novaNext && !w.grid.cells[2][3]) { novaNext = t + 9; w.cards[7].cdLeft = 0; input.place = { kind: 'nova', lane: 2, row: 3 } }
    // 铲除再重放：右路那座哨戒塔
    else if (t >= swapNext && w.grid.cells[4][1]) { swapNext = t + 18; input.remove = { lane: 4, row: 1 }; restore.push({ t: t + 2.2, kind: 'sentry', lane: 4, row: 1 }) }
    // 放不下去的那种（格子被占）：看放置失败的红闪
    else if (mode === 'place' && Math.floor(t / 4) !== Math.floor((t - DT) / 4)) input.place = { kind: 'sentry', lane: 1, row: 1 }
    if (t >= fenceNext) { fenceNext = t + 16; const l = (rng() * 5) | 0; post.push(() => D.triggerFence(w, l)); refillAt = t + 9 }
    if (refillAt > 0 && t >= refillAt) { refillAt = -1; post.push(() => D.refillFences(w)) }
    if (w.energy < 1000) w.energy = 5000
    return input
  }
  return { world, bot, defense: true }
}

// ------------------------------------------------------------------ 技能（真模拟的摆拍世界）
const POWER_CMD = { hawk: 'hawk', ysera: 'ysera', joe: 'joe' }
function demoPower(id, Q) {
  if (!sim) return null
  const cmd = POWER_CMD[id.split('_')[0]] || 'hawk', drill = id === 'joe_drill'
  const world = sim.createWorld({ seed: Number(Q.get('seed') || 3), sandbox: true, commander: cmd })
  sim.addUnits(world, 'rifle', Number(Q.get('rifles') || 30), 'test'); sim.addUnits(world, 'flamer', 4, 'test'); sim.addUnits(world, 'mortar', 1, 'test'); sim.addUnits(world, 'titan', 1, 'test')
  const K = (k) => ENEMY_KINDS.indexOf(k), rng = mulberry(5)
  const wave = (n = 260) => { for (let i = 0; i < n; i++) sim.spawn(world, K(rng() < 0.03 ? 'crusher' : rng() < 0.06 ? 'burster' : 'ling'), (rng() + rng() - 1) * 5.6, -4 - rng() * 17); for (let i = 0; i < 2; i++) sim.spawn(world, K('hulk'), (rng() - 0.5) * 8, -8 - rng() * 6) }
  const P = () => world.powers.find((p) => p.id === id)
  const idle = { moveX: null, targetX: null, powers: [], aim: null, pick: null, reroll: false }
  // 充能走正常计时：先静默快进到技能就绪
  if (!drill) { let g = 0; while (P() && !P().ready && g++ < 60 * 90) world.step(idle) }
  wave()
  const def = sim.POWERS[id] || {}
  const holdAfter = { hawk_rally: 7.5, hawk_strike: 3.2, hawk_drop: 4, hawk_flagship: 10, ysera_orbital: 3.5, ysera_lance: 5, ysera_eclipse: 12, joe_drop: 8, joe_mines: 7, joe_ray: 4 }[id] || 5
  let phase = 'wait', tCast = world.time + Number(Q.get('lead') || 1.0), aimSteps = 0, want = false
  const bot = (w) => {
    const inp = { moveX: null, targetX: 0, powers: [], aim: null, pick: null, reroll: false }
    if (drill) { if (w.swarm.living < 60) wave(200); return inp }
    if (w.status === 'aiming') {
      if (++aimSteps > Number(Q.get('aimhold') || 24)) { inp.aim = id === 'joe_mines' ? { x0: -5.2, z0: 1.5, x1: 5.2, z1: -2.5 } : { x0: -2.5, z0: 7, x1: 3.5, z1: -15 }; aimSteps = 0 }
      return inp
    }
    if (phase === 'wait' && (w.time >= tCast || want)) { if (P() && P().ready) { inp.powers = [def.key || 'q']; phase = 'hold'; tCast = w.time + holdAfter; want = false } }
    else if (phase === 'hold' && w.time >= tCast) {
      let g = 0; while (P() && !P().ready && g++ < 60 * 90) w.step(idle)   // 静默快进到下一次就绪（这段不渲染）
      if (w.swarm.living < 200) wave(); phase = 'wait'; tCast = w.time + 1.2
    }
    if (w.swarm.living < 120 && phase === 'wait') wave(160)
    return inp
  }
  return { world, bot, cast() { want = true } }
}
function demoBossDie(Q) {
  if (!sim) return null
  const world = sim.createWorld({ seed: 3, sandbox: true, commander: 'hawk' })
  sim.addUnits(world, 'rifle', 40, 'test'); sim.addUnits(world, 'titan', 1, 'test'); sim.addUnits(world, 'lancer', 1, 'test')
  const K = (k) => ENEMY_KINDS.indexOf(k), rng = mulberry(9)
  for (let i = 0; i < 500; i++) sim.spawn(world, K('ling'), (rng() - 0.5) * 12, -2 - rng() * 18)
  sim.spawnBoss(world, Q.get('boss') || 'ravager'); world.boss.z = -2; world.boss.x = 0.5; if (world.boss._chargeT != null) world.boss._chargeT = 99
  const t0 = world.time + Number(Q.get('lead') || 1.6)
  const bot = (w) => { if (w.boss && w.boss.state !== 'dying' && w.time > t0) w.boss.hp = Math.min(w.boss.hp, 30); return { moveX: null, targetX: 0, powers: [], aim: null, pick: null, reroll: false } }
  return { world, bot }
}

let current = null, override = null
/** 由 render.html 的 newWorld() 调用；返回 { world, bot } 或 null（演示名不认识 / 模拟层不可用） */
export function createDemo(name, Q) {
  if (override) { name = override.name; const q = new URLSearchParams(Q); for (const k in override.params) q.set(k, override.params[k]); Q = q }
  let d = null
  if (name === 'env') d = { world: createStage({ rifles: Number(Q.get('rifles') || 48) }).world }
  else if (name === 'gates') d = demoGates(Q)
  else if (name === 'pod') d = demoPod(Q)
  else if (name === 'devices' || name === 'place' || name === 'fence') d = demoDefense(Q, name)
  else if (name.startsWith('power.')) d = demoPower(name.slice(6), Q)
  else if (name === 'bossdie') d = demoBossDie(Q)
  if (!d) console.info('[demo] 没有这个演示或模拟层不可用：' + name)
  current = d ? { name, Q, ...d } : null
  return current
}

/** render.html 建好渲染器后调用一次：装上 __shot / __demo，并驱动布防预览这类「UI 状态」 */
export function install(api) {
  const { view, canvas } = api
  window.__shot = async (file, adv = 0, quality = 0.9) => {
    canvas.style.width = '1600px'; canvas.style.height = '900px'
    if (view.quality !== 'low') view.setQuality('low')      // 像素比固定 1，出 1600×900
    view.resize(1600, 900)
    if (adv > 0 && window.__dev) window.__dev.advance(adv)
    await new Promise((r) => setTimeout(r, 300)); if (document.fonts && document.fonts.ready) await document.fonts.ready   // 门牌的图标 / 字体是异步到的
    view.render(0, 1 / 60)
    const data = canvas.toDataURL('image/jpeg', quality)
    canvas.style.width = ''; canvas.style.height = ''; view.resize()   // 出完图把画布还给页面：resize() 不带参数 = 恢复跟随 CSS 尺寸（否则画布会一直停在 1600×900，窗口再大也只占左上角）
    try { const r = await fetch('http://127.0.0.1:5195/save/' + file, { method: 'POST', body: data }); return await r.text() } catch (e) { return 'shot server 不在：' + e.message }
  }
  /** 不刷新页面换一个演示：__demo.load('power.joe_ray') / __demo.load('gates', { gi: 5 })（页面要带着任意一个 ?demo= 打开） */
  window.__demo = { get current() { return current }, cast() { if (current && current.cast) current.cast() }, load(name, params = {}) { override = { name, params }; view.setPlacement(null); window.__dev.newWorld(); return current ? current.name : null } }
  {
    const kinds = ['sentry', 'collector', 'barricade', 'mine', 'cryo', 'scorcher', 'mortarpit', 'nova']
    const tick = () => {
      const w = api.world; if (!current || !w || !current.defense || (current.name !== 'place' && current.name !== 'devices')) return
      const t = w.time, Q = current.Q
      if (current.name === 'devices' && !(t % 14 > 4 && t % 14 < 9)) { view.setPlacement(null); return }
      const step = Math.floor(t / 0.9), lane = step % 5, row = Math.floor(step / 5) % 4
      // 每 7 步里有 1 步装成「买不起」（valid: false）：看空格子上的红色虚影
      view.setPlacement({ kind: Q.get('kind') || kinds[Math.floor(step / 3) % kinds.length], lane: Q.has('lane') ? Number(Q.get('lane')) : lane, row: Q.has('row') ? Number(Q.get('row')) : row, valid: Q.has('valid') ? Q.get('valid') !== '0' : (step % 7 === 6 ? false : undefined) })
    }
    const r0 = view.render.bind(view); view.render = (a, d) => { tick(); r0(a, d) }
  }
}
