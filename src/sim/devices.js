// 布防系统（GDD §13）：晶能、卡槽、放置 / 铲除、8 种装置的行为、应急电网、按车道的前沿索引。数值在 data/devices.js。
// 虫怎么沿车道走、怎么被装置挡住啃咬，在 swarm.js（那边是热路径）；这里提供它要用的 damageDevice / triggerFence。
//
// 契约（表现层只读）：
//   world.lanes[l]   = { index, x, w }
//   world.grid       = { lanes, rows, rowZ[], depth, cells[lane][row] → device | null }   // 内部的空间哈希改名叫 world.hash
//   world.devices[]  = { id, kind, lane, row, x, z, hp, hpMax, alive, t0, armedT, armed, fireT, hitT, aimX, aimZ, cost }
//   world.energy     当前晶能
//   world.cards[]    = { kind, key(1..8), cost, cd, cdLeft, unlocked, affordable, ready, nameKey, descKey }
//   world.fences[l]  = true（可用）/ false（已用掉）
// 输入：input.place = { kind, lane, row } / input.remove = { lane, row }（只在 running / aiming 的步里处理；选卡暂停时不处理）
// 事件：devicePlace / deviceFire / deviceHit / deviceDie / deviceRemove / deviceUnlock / placeFail / mineArm / mineBlast / novaBlast /
//       energy / fence / fenceRefill，字段见 docs/ARCHITECTURE.md「第 6 步」
import { LANE, GRID, ENERGY, FENCE, BLOCK, CRUSH_PAD, DEVICE_KINDS, DEVICE_START, DEVICE_UNLOCK_ORDER, DEVICES, DEVICE_MOD_DEFAULTS, MINE_CHAIN, CRYO_FREEZE, COST_MUL_MIN } from '../data/devices.js'
import { ENEMIES, ENEMY_KINDS, ELITE, MIN_ARMOR_HIT } from '../data/enemies.js'
import { DEVICE, DEVICE_AA } from '../data/units.js'
import { queryCircle, queryRect } from './grid.js'
import { hitEnemy, slowEnemy, explode, explodeLater, frontalMul } from './combat.js'
import { damageBoss, bossUp } from './boss.js'
import { kill, ENEMY_CLS, ST_DYING } from './swarm.js'
import { addXp } from './progression.js'

const DEFS = ENEMY_KINDS.map(k => ENEMIES[k])
const K_POD = ENEMY_KINDS.indexOf('pod')
// 每种虫被打死掉多少晶能
const DROP = Float32Array.from(DEFS.map(d => (d.id === 'ling' ? ENERGY.ling : d.behavior === 'egg' || d.pod ? 0 : d.xp * ENERGY.perXp)))

const NL = GRID.lanes, NR = GRID.rows, NC = NL * NR
const TOP = 6                       // 每个要开火的格子记本道最靠前的这么多只地面虫
const BIN = 3, BIN_Z0 = -24, NB = 14 // 迫击炮台找「密集处」用的车道直方图：每 3 米一段
const AHEAD = 0.3                   // 装置只打身前的虫（z <= 装置 z + AHEAD）
const BOSS_RANGE = 14                // 炮塔类装置打 Boss 的射程（Boss 不受车道约束，也不分身前身后）

export const createDeviceMods = () => ({ ...DEVICE_MOD_DEFAULTS })

export function createDevices(world) {
  world.lanes = LANE.centers.map((x, index) => ({ index, x, w: LANE.width }))
  world.grid = { lanes: NL, rows: NR, rowZ: GRID.rowZ.slice(), depth: GRID.depth, cells: LANE.centers.map(() => GRID.rowZ.map(() => null)) }
  world.devices = []
  world.energy = ENERGY.start
  world.fences = LANE.centers.map(() => true)
  const unlocked = {}
  for (const k of DEVICE_KINDS) unlocked[k] = DEVICE_START.includes(k)
  world.cards = DEVICE_KINDS.map((kind, k) => {
    const d = DEVICES[kind]
    return { kind, key: k + 1, cost: d.cost, cd: d.cd, cdLeft: 0, unlocked: unlocked[kind], affordable: world.energy >= d.cost, ready: unlocked[kind] && world.energy >= d.cost, nameKey: d.nameKey, descKey: d.descKey }
  })
  world._dev = {
    unlocked, dirty: true,
    // 挡路的装置，按车道、按 z 从小到大（虫先遇到的在前）：blockZ 是「装置前 gap 处」那条线
    blockN: new Uint8Array(NL), blockZ: new Float32Array(NC), blockD: new Array(NC).fill(null),
    // 前沿索引：needRows[lane] = 这条道上要索敌的排（哨戒塔 / 冷凝塔）；top = 每格最靠前的 TOP 只地面虫，air = 最靠前的一只飞行虫
    needRows: LANE.centers.map(() => []), needBins: new Uint8Array(NL), active: false,
    front: new Float32Array(NC), topN: new Uint8Array(NC), top: new Int16Array(NC * TOP), air: new Int16Array(NC),
    bins: new Uint16Array(NL * NB),
    dropAcc: 0, dropX: 0, dropZ: 0,
    last: null,               // 最近一次 input.place 的结果 { ok, reason }，给测试 / UI 调试看
    // swarm.js 要用的三个入口（它不能直接 import 本模块，会成环）
    damage: damageDevice, fence: triggerFence, thorn: (w, i, dmg) => hitEnemy(w, i, dmg, DEVICE, null, true, 'barricade', false),
  }
  refreshCards(world, 0)
}

const cardOf = (world, kind) => world.cards[DEVICE_KINDS.indexOf(kind)]

/** 当前花费倍率：「工程兵」牌 × 老猫的被动，有下限 */
export function costMul(world) {
  const rb = world.passive.rebuild
  const m = world.mods.device.costMul * (rb !== null && rb.deviceCost ? rb.deviceCost : 1)
  return m < COST_MUL_MIN ? COST_MUL_MIN : m
}

function refreshCards(world, dt) {
  const mul = costMul(world), e = world.energy
  for (const c of world.cards) {
    c.cost = Math.round(DEVICES[c.kind].cost * mul)
    if (c.cdLeft > 0) { const t = c.cdLeft - dt; c.cdLeft = t > 0 ? t : 0 }
    c.affordable = e >= c.cost
    c.ready = c.unlocked && c.cdLeft === 0 && c.affordable
  }
}

// ---------------------------------------------------------------- 晶能

/** 入账。source: 'kill' | 'collector' | 'refund' | 'gate'。小额掉落攒够 ENERGY.eventMin 才发一条事件 */
export function gainEnergy(world, amount, x, z, source) {
  if (!(amount > 0)) return
  const e = world.energy + amount
  world.energy = e > ENERGY.max ? ENERGY.max : e
  const st = world.stats.energy
  st.earned += amount
  st[source] += amount
  if (amount >= ENERGY.eventMin) { world.events.push({ type: 'energy', x, z, amount, source }); return }
  const dv = world._dev
  dv.dropAcc += amount; dv.dropX = x; dv.dropZ = z
  if (dv.dropAcc >= ENERGY.eventMin) {
    world.events.push({ type: 'energy', x, z, amount: dv.dropAcc, source })
    dv.dropAcc = 0
  }
}

/** 击杀掉落（combat.hitEnemy 在计分的击杀上调用） */
export function dropEnergy(world, k, elite, x, z) {
  const a = DROP[k]
  if (a > 0) gainEnergy(world, elite ? a * ENERGY.eliteMul : a, x, z, 'kill')
}

// ---------------------------------------------------------------- 解锁

export const nextLocked = world => { for (const k of DEVICE_UNLOCK_ORDER) if (!world._dev.unlocked[k]) return k; return null }

export function unlockDevice(world, kind) {
  const dv = world._dev
  if (!DEVICES[kind] || dv.unlocked[kind]) return false
  dv.unlocked[kind] = true
  cardOf(world, kind).unlocked = true
  world.events.push({ type: 'deviceUnlock', kind, nameKey: DEVICES[kind].nameKey })
  return true
}

// ---------------------------------------------------------------- 放置 / 铲除 / 受伤

// 挡路表与索敌表：装置有增减时重建（最多 20 格）
function rebuildTables(world) {
  const dv = world._dev, cells = world.grid.cells
  dv.dirty = false
  dv.active = false
  for (let l = 0; l < NL; l++) {
    let n = 0
    const need = dv.needRows[l]
    need.length = 0
    dv.needBins[l] = 0
    for (let r = NR - 1; r >= 0; r--) {          // row 3 的 z 最小：虫最先遇到
      const d = cells[l][r]
      if (d === null) continue
      const c = l * NR + r
      if (d._def.blocks) { dv.blockZ[l * NR + n] = d.z - BLOCK.gap; dv.blockD[l * NR + n] = d; n++ }
      if (d.kind === 'sentry' || d.kind === 'cryo') { need.push(r); dv.front[c] = d.z + AHEAD; dv.active = true }
      else if (d.kind === 'mortarpit') { dv.needBins[l] = 1; dv.active = true }
    }
    dv.blockN[l] = n
    for (let k = n; k < NR; k++) dv.blockD[l * NR + k] = null
  }
}

// splice: 顺手从 world.devices 里摘掉。正在遍历 world.devices 的调用方（地雷 / 聚变炸弹）传 false，由 update 末尾统一压缩
function detach(world, d, splice = true) {
  d.alive = false
  world.grid.cells[d.lane][d.row] = null
  if (splice) { const k = world.devices.indexOf(d); if (k >= 0) world.devices.splice(k, 1) }
  rebuildTables(world)       // 立刻重建：同一步里后面的虫不能再被一个已经没了的装置挡住
}

const fail = (world, kind, lane, row, reason, silent) => {
  if (!silent) world.events.push({ type: 'placeFail', kind, lane, row, reason })
  return { ok: false, reason, device: null }
}

/**
 * 放一个装置。free: 不看解锁 / 冷却 / 晶能，也不扣钱（测试与摆拍世界用）。
 * 返回 { ok, reason, device }；reason: 'kind' | 'bounds' | 'occupied' | 'locked' | 'cooldown' | 'energy'
 */
export function placeDevice(world, kind, lane, row, free = false) {
  const def = DEVICES[kind]
  if (!def) return fail(world, kind, lane, row, 'kind', free)
  if (!Number.isInteger(lane) || !Number.isInteger(row) || lane < 0 || lane >= NL || row < 0 || row >= NR) return fail(world, kind, lane, row, 'bounds', free)
  if (world.grid.cells[lane][row] !== null) return fail(world, kind, lane, row, 'occupied', free)
  const st = world.stats.devices
  let paid = 0
  if (!free) {
    const card = cardOf(world, kind)
    if (!card.unlocked) return fail(world, kind, lane, row, 'locked', false)
    if (card.cdLeft > 0) return fail(world, kind, lane, row, 'cooldown', false)
    if (world.energy < card.cost) return fail(world, kind, lane, row, 'energy', false)
    paid = card.cost
    world.energy -= paid
    card.cdLeft = card.cd
    world.stats.energy.spent += paid
    st.spent[kind] += paid
    refreshCards(world, 0)
  }
  const time = world.time
  const d = {
    id: world._nextId++, kind, lane, row, x: LANE.centers[lane], z: GRID.rowZ[row],
    hp: def.hp, hpMax: def.hp, alive: true, t0: time,
    armedT: kind === 'mine' ? time + def.arm : kind === 'nova' ? time + def.fuse : null, armed: false,
    fireT: -9, hitT: -9, aimX: LANE.centers[lane], aimZ: GRID.rowZ[row] - 6, cost: paid,
    // 内部
    _def: def, _cd: kind === 'collector' ? def.every : kind === 'mortarpit' ? 0.8 : 0.3, _shots: 0,
    _q: 0, _qN: 0, _bite: BLOCK.slots, _hitAcc: 0, _hitEv: -9,
  }
  world.devices.push(d)
  world.grid.cells[lane][row] = d
  st.placed[kind]++
  rebuildTables(world)
  world.events.push({ type: 'devicePlace', id: d.id, kind, lane, row, x: d.x, z: d.z, cost: paid })
  return { ok: true, reason: null, device: d }
}

/** 铲除自己的装置：返还花费的 ENERGY.removeRefund。格子是空的返回 false */
export function removeDevice(world, lane, row) {
  if (!Number.isInteger(lane) || !Number.isInteger(row) || lane < 0 || lane >= NL || row < 0 || row >= NR) return false
  const d = world.grid.cells[lane][row]
  if (d === null) return false
  detach(world, d)
  const refund = Math.round(d.cost * ENERGY.removeRefund)
  world.stats.devices.removed[d.kind]++
  world.events.push({ type: 'deviceRemove', id: d.id, kind: d.kind, lane, row, x: d.x, z: d.z, refund })
  gainEnergy(world, refund, d.x, d.z, 'refund')
  refreshCards(world, 0)
  return true
}

/** 装置被毁。by: 咬死它的虫种 id / 'boss' */
export function destroyDevice(world, d, by) {
  if (!d.alive) return
  d.hp = 0
  detach(world, d)
  world.stats.devices.lost[d.kind]++
  world.events.push({ type: 'deviceDie', id: d.id, kind: d.kind, lane: d.lane, row: d.row, x: d.x, z: d.z, by })
  if (!world._seen.deviceLost) { world._seen.deviceLost = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_device_lost' }) }
  // 老猫的「回收程序」：损毁返还一部分花费
  const rb = world.passive.rebuild
  if (rb !== null && rb.deviceRefund > 0 && d.cost > 0) gainEnergy(world, Math.round(d.cost * rb.deviceRefund), d.x, d.z, 'refund')
}

/** 装置受伤。护甲是减法，每口至少 MIN_ARMOR_HIT。一次性装置（hpMax = 0）不受伤 */
export function damageDevice(world, d, dmg, by) {
  if (!d.alive || d.hpMax <= 0 || !d._def.blocks) return
  const a = d._def.armor
  if (a > 0) { const red = dmg - a, floor = dmg < MIN_ARMOR_HIT ? dmg : MIN_ARMOR_HIT; dmg = red > floor ? red : floor }
  world.stats.devices.absorbed[d.kind] += dmg < d.hp ? dmg : d.hp > 0 ? d.hp : 0
  d.hp -= dmg
  d.hitT = world.time
  d._hitAcc += dmg
  // 受击事件每个装置约 8 条 / 秒就够表现层用了，伤害合并
  if (world.time - d._hitEv >= 0.12) {
    world.events.push({ type: 'deviceHit', id: d.id, kind: d.kind, x: d.x, z: d.z, dmg: d._hitAcc, hp: d.hp > 0 ? d.hp : 0 })
    d._hitAcc = 0
    d._hitEv = world.time
  }
  if (d.hp <= 0) destroyDevice(world, d, by)
}

// ---------------------------------------------------------------- 应急电网

/** 触发第 lane 道的电网：清空归属这条道（swarm.lane）的所有非 Boss 敌人，计击杀与经验 */
export function triggerFence(world, lane) {
  if (!world.fences[lane]) return 0
  world.fences[lane] = false
  const s = world.swarm, st = world.stats
  let kills = 0
  for (let i = 0; i < s.count; i++) {
    if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.kind[i] === K_POD || s.lane[i] !== lane) continue
    const def = DEFS[s.kind[i]], x = s.x[i], z = s.z[i]
    kill(world, i)
    world.events.push({ type: 'enemyDie', i, kind: def.id, x, z, by: 'fence', gore: 1 })
    if ((s.flags[i] & 2) !== 0) continue          // 「不死孢子」复活出来的：不重复计分
    st.kills++
    st._stepKills++
    st.killsByDevice.fence++
    if (s.elite[i] === 1) st.eliteKills++
    addXp(world, s.elite[i] === 1 ? def.xp * ELITE.xpMul : def.xp, x, z)
    kills++
  }
  st.fencesUsed++
  world.events.push({ type: 'fence', lane, x: LANE.centers[lane], z: FENCE.z, kills })
  if (!world._seen.fence) { world._seen.fence = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_fence' }) }
  world.events.push({ type: 'shake', amp: 0.16 })
  return kills
}

/** 把电网补满（无尽每 FENCE.refillEvery 层） */
export function refillFences(world) {
  const lanes = []
  for (let l = 0; l < NL; l++) if (!world.fences[l]) { world.fences[l] = true; lanes.push(l) }
  if (lanes.length > 0) world.events.push({ type: 'fenceRefill', lanes })
  return lanes.length
}

// ---------------------------------------------------------------- 前沿索引

// 每步 O(n) 扫一遍：给每个要索敌的格子记下本道身前最靠前的几只，给迫击炮台记本道的纵向直方图。
// 装置开火只查这张表，不做全量扫描。
function buildIndex(world) {
  const dv = world._dev, s = world.swarm
  const { alive, state, lane, z, y } = s
  const { topN, top, air, front, bins, needRows, needBins } = dv
  topN.fill(0); air.fill(-1); bins.fill(0)
  for (let i = 0, n = s.count; i < n; i++) {
    if (alive[i] === 0) continue
    const st = state[i]
    if (st === 2 || st === 3) continue
    const ln = lane[i], rows = needRows[ln], zi = z[i]
    if (y[i] > 0) {
      for (let k = 0; k < rows.length; k++) {
        const c = ln * NR + rows[k]
        if (zi <= front[c] && (air[c] < 0 || z[air[c]] < zi)) air[c] = i
      }
      continue
    }
    if (needBins[ln] === 1) { const b = ((zi - BIN_Z0) / BIN) | 0; if (b >= 0 && b < NB) bins[ln * NB + b]++ }
    for (let k = 0; k < rows.length; k++) {
      const c = ln * NR + rows[k]
      if (zi > front[c]) continue
      const base = c * TOP, m = topN[c]
      let j = m < TOP ? m : TOP - 1
      if (m === TOP && z[top[base + j]] >= zi) continue
      while (j > 0 && z[top[base + j - 1]] < zi) { top[base + j] = top[base + j - 1]; j-- }
      top[base + j] = i
      if (m < TOP) topN[c] = m + 1
    }
  }
}

// ---------------------------------------------------------------- 各装置

// Boss 是全场目标，不受车道约束：在 BOSS_RANGE 米内，哨戒塔 / 冷凝塔 / 迫击炮台会转过去打它（哪条道、在身前身后都行）。
// 本道同时有虫时一替一发：一半火力给 Boss，一半留给眼前的虫。
const bossInRange = (b, d) => { if (!bossUp(b)) return false; const dx = b.x - d.x, dz = b.z - d.z, r = BOSS_RANGE + b.radius; return dx * dx + dz * dz < r * r }

function fireEvent(world, d, tx, tz) {
  d.fireT = world.time
  d.aimX = tx; d.aimZ = tz
  world.events.push({ type: 'deviceFire', id: d.id, kind: d.kind, x: d.x, z: d.z, tx, tz })
}

// 哨戒塔 / 冷凝塔选目标：本道身前最靠前的活虫。返回下标，没有返回 -1。slowed: 冷凝塔优先挑还没被减速的
function pickGround(world, c, preferUnslowed) {
  const dv = world._dev, s = world.swarm, base = c * TOP, n = dv.topN[c]
  let first = -1
  for (let k = 0; k < n; k++) {
    const i = dv.top[base + k]
    if (s.state[i] === ST_DYING || s.alive[i] === 0) continue
    if (!preferUnslowed || world.time >= s.slowT[i] - 0.4) return i
    if (first < 0) first = i
  }
  return first
}

function sentry(world, d, def, mul, dt) {
  const m = world.mods.device
  d._cd -= dt * m.sentryRate
  if (d._cd > 0) return
  const dv = world._dev, s = world.swarm, c = d.lane * NR + d.row
  let ti = pickGround(world, c, false)
  const a = dv.air[c]
  if (a >= 0 && s.state[a] !== ST_DYING && (ti < 0 || s.z[a] > s.z[ti])) ti = a
  const b = world.boss
  if (bossInRange(b, d) && (ti < 0 || (d._shots++ & 1) === 0)) {
    d._cd += def.interval
    fireEvent(world, d, b.x, b.z)
    damageBoss(world, def.bossDmg * mul, DEVICE_AA, null, 'sentry')
    return
  }
  if (ti < 0) { d._cd = 0.1; return }
  d._cd += def.interval             // 带着余数走：节奏不被 1/60 的步长吃掉
  const dmg = def.dmg * mul
  fireEvent(world, d, s.x[ti], s.z[ti])
  const air = s.y[ti] > 0
  hitEnemy(world, ti, dmg * frontalMul(world, ti, d.x, d.z), DEVICE_AA, null, false, 'sentry', false)
  if (air) return
  // 贯穿：子弹沿本道继续往上游穿，打到前沿表里排在后面的那几只
  let left = def.pierce + m.sentryPierce
  const base = c * TOP, n = dv.topN[c]
  for (let k = 0; k < n && left > 0; k++) {
    const i = dv.top[base + k]
    if (i === ti || s.state[i] === ST_DYING || s.alive[i] === 0 || s.z[i] > s.z[ti] + 0.01) continue
    hitEnemy(world, i, dmg * frontalMul(world, i, d.x, d.z), DEVICE_AA, null, false, 'sentry', false)
    left--
  }
}

function cryo(world, d, def, mul, dt) {
  d._cd -= dt
  if (d._cd > 0) return
  const s = world.swarm, c = d.lane * NR + d.row
  const ti = pickGround(world, c, true)
  const b = world.boss
  d._shots++
  if (bossInRange(b, d) && (ti < 0 || (d._shots & 1) === 0)) {
    d._cd += def.interval
    fireEvent(world, d, b.x, b.z)
    damageBoss(world, def.bossDmg * mul, DEVICE, null, 'cryo')
    return
  }
  if (ti < 0) { d._cd = 0.1; return }
  d._cd += def.interval             // 带着余数走：节奏不被 1/60 的步长吃掉
  const x = s.x[ti], z = s.z[ti], dmg = def.dmg * mul
  fireEvent(world, d, x, z)
  const m = world.mods.device
  if (m.cryoFreeze > 0 && d._shots % CRYO_FREEZE.every === 0 && ENEMY_CLS[s.kind[ti]] !== 2) {
    const until = world.time + CRYO_FREEZE.dur
    if (until > s.stunT[ti]) s.stunT[ti] = until
  }
  // 命中点一小圈都挨冻。正面免伤只算直接命中的那一只
  const g = world.hash, out = g.out
  const n = queryCircle(g, s, x, z, def.splash, out)
  let left = def.maxTargets - 1
  slowEnemy(world, ti, def.slow, def.slowDur)
  hitEnemy(world, ti, dmg * frontalMul(world, ti, d.x, d.z), DEVICE, null, false, 'cryo', false)
  for (let j = 0; j < n && left > 0; j++) {
    const i = out[j]
    if (i === ti || s.y[i] > 0) continue
    slowEnemy(world, i, def.slow, def.slowDur)
    hitEnemy(world, i, dmg, DEVICE, null, false, 'cryo', false)
    left--
  }
}

function scorcher(world, d, def, mul, dt) {
  d._cd -= dt
  if (d._cd > 0) return
  d._cd += def.interval
  const g = world.hash, s = world.swarm, out = g.out
  const w = LANE.width * (0.5 + def.side), z0 = d.z - GRID.depth / 2, z1 = d.z + GRID.depth / 2
  const n = queryRect(g, s, d.x - w, d.x + w, z0, z1, out)
  const b = world.boss
  const boss = bossUp(b) && b.x + b.radius >= d.x - w && b.x - b.radius <= d.x + w && b.z + b.radius >= z0 && b.z - b.radius <= z1
  let left = def.maxTargets, hits = 0
  // 查询结果从远到近排：倒着取，先烧贴脸的
  for (let j = n - 1; j >= 0 && left > 0; j--) {
    const i = out[j]
    if (s.y[i] > 0) continue
    hitEnemy(world, i, def.dmg * mul, DEVICE, null, true, 'scorcher', false)
    left--; hits++
  }
  if (boss) damageBoss(world, def.bossDmg * mul, DEVICE, null, 'scorcher', true)
  if (hits === 0 && !boss) return
  d.fireT = world.time
  world.events.push({ type: 'deviceFire', id: d.id, kind: d.kind, x: d.x, z: d.z })
  world.events.push({ type: 'flame', unit: 'd' + d.id, x: d.x, z: d.z, dir: Math.PI, arc: 2.6, range: GRID.depth / 2 + 0.4 })
}

function mortarpit(world, d, def, mul, dt) {
  d._cd -= dt
  if (d._cd > 0) return
  const dv = world._dev, base = d.lane * NB
  // 身前 minRange 之外的那些段里：最靠前的有虫的一段留给队伍和哨戒塔，炮弹砸它后面最密的那段
  let hi = ((d.z - def.minRange - BIN_Z0) / BIN) | 0
  if (hi >= NB) hi = NB - 1
  let frontBin = -1, best = -1, bestN = 0
  for (let k = hi; k >= 0; k--) {
    const n = dv.bins[base + k]
    if (n === 0) continue
    if (frontBin < 0) { frontBin = k; continue }
    if (n > bestN) { bestN = n; best = k }
  }
  if (best < 0) best = frontBin
  const b = world.boss
  let tx = d.x, tz
  d._shots++
  if (bossInRange(b, d) && (best < 0 || (d._shots & 1) === 0)) { tx = b.x; tz = b.z }
  else if (best >= 0) tz = BIN_Z0 + (best + 0.5) * BIN
  else { d._cd = 0.3; return }
  d._cd += def.interval
  fireEvent(world, d, tx, tz)
  explode(world, tx, tz, def.r, def.dmg * mul, def.maxTargets, 0, 0, DEVICE, null, 'mortarpit', def.bossDmg * mul, 'm')
}

function mine(world, d, def, mul) {
  const time = world.time
  if (!d.armed) {
    if (time < d.armedT) return
    d.armed = true
    world.events.push({ type: 'mineArm', id: d.id, x: d.x, z: d.z })
  }
  const g = world.hash, s = world.swarm, out = g.out
  const n = queryCircle(g, s, d.x, d.z, def.trigger, out)
  let hit = false, crowd = 0
  for (let j = 0; j < n; j++) {
    const i = out[j]
    if (s.y[i] > 0 || s.kind[i] === K_POD) continue
    if (DEFS[s.kind[i]].big === true || ++crowd >= def.crowd) { hit = true; break }
  }
  const b = world.boss
  if (!hit && bossUp(b)) { const dx = b.x - d.x, dz = b.z - d.z, rr = def.trigger + b.radius; hit = dx * dx + dz * dz <= rr * rr }
  if (!hit) return
  detach(world, d, false)
  world.events.push({ type: 'mineBlast', id: d.id, x: d.x, z: d.z, r: def.r })
  explode(world, d.x, d.z, def.r, def.dmg * mul, def.maxTargets, 0, 0, DEVICE, null, 'mine', def.bossDmg * mul, 'm')
  // 连环引爆：沿本道往上游再炸几次
  const chain = world.mods.device.mineChain
  for (let k = 1; k <= chain; k++) {
    explodeLater(world, MINE_CHAIN.delay * k, d.x, d.z - MINE_CHAIN.step * k, def.r, def.dmg * mul * MINE_CHAIN.dmgMul, def.maxTargets, 0, 0, DEVICE, null, 'mine', def.bossDmg * mul * MINE_CHAIN.dmgMul, 'm')
  }
}

function nova(world, d, def, mul) {
  if (world.time < d.armedT) return
  const g = world.hash, s = world.swarm, out = g.out
  const w = LANE.width * (0.5 + def.side), h = GRID.depth * (0.5 + def.rows)
  detach(world, d, false)
  const n = queryRect(g, s, d.x - w, d.x + w, d.z - h, d.z + h, out)
  let hits = 0
  for (let j = 0; j < n; j++) { const i = out[j]; if (s.y[i] > 0) continue; hitEnemy(world, i, def.dmg * mul, DEVICE, null, false, 'nova', false); hits++ }
  const b = world.boss
  if (bossUp(b) && b.x + b.radius >= d.x - w && b.x - b.radius <= d.x + w && b.z + b.radius >= d.z - h && b.z - b.radius <= d.z + h) damageBoss(world, def.bossDmg * mul, DEVICE, null, 'nova')
  world.events.push({ type: 'novaBlast', id: d.id, x: d.x, z: d.z, w: w * 2, d: h * 2, hits })
  world.events.push({ type: 'hitstop', ms: 50 })
  world.events.push({ type: 'shake', amp: 0.3 })
}

function collector(world, d, def, dt) {
  d._cd -= dt
  if (d._cd > 0) return
  d._cd += def.every
  d.fireT = world.time
  gainEnergy(world, def.amount + world.mods.device.collectorAdd, d.x, d.z, 'collector')
}

// ---------------------------------------------------------------- 每步

export function update(world, input, dt) {
  const dv = world._dev
  refreshCards(world, dt)
  if (input) {
    const rm = input.remove
    if (rm) removeDevice(world, rm.lane, rm.row)
    const pl = input.place
    if (pl) { const r = placeDevice(world, pl.kind, pl.lane, pl.row); dv.last = { ok: r.ok, reason: r.reason } }
  }
  const ds = world.devices
  if (ds.length === 0) return
  if (dv.dirty) rebuildTables(world)

  // Boss 直接碾碎挡路的装置
  const b = world.boss
  if (b !== null && b.state !== 'dying' && b.state !== 'burrowed') {
    const r = b.radius + CRUSH_PAD, r2 = r * r
    for (let n = ds.length - 1; n >= 0; n--) {
      const d = ds[n], dx = d.x - b.x, dz = d.z - b.z
      if (d.alive && dx * dx + dz * dz < r2) destroyDevice(world, d, 'boss')
    }
  }

  if (dv.active) buildIndex(world)
  // 装置伤害吃全队伤害倍率（武器校准 + 等级：不然后半程虫变厚了，开局放的塔就成了摆设）；无尽里再和技能一样每层 ×1.1
  const mul = world.dmgMul * world.powerDmgMul
  const refill = dt * BLOCK.slots / BLOCK.every
  for (let n = 0; n < ds.length; n++) {
    const d = ds[n]
    if (!d.alive) continue
    d._q = d._qN; d._qN = 0
    const bite = d._bite + refill
    d._bite = bite > BLOCK.slots ? BLOCK.slots : bite
    const def = d._def
    switch (d.kind) {
      case 'sentry': sentry(world, d, def, mul, dt); break
      case 'cryo': cryo(world, d, def, mul, dt); break
      case 'scorcher': scorcher(world, d, def, mul, dt); break
      case 'mortarpit': mortarpit(world, d, def, mul, dt); break
      case 'mine': mine(world, d, def, mul); break
      case 'nova': nova(world, d, def, mul); break
      case 'collector': collector(world, d, def, dt); break
    }
  }
  // 这一步里没了的（被咬坏 / 被碾碎 / 炸掉 / 铲除）从列表里摘掉
  let w = 0
  for (let n = 0; n < ds.length; n++) if (ds[n].alive) ds[w++] = ds[n]
  ds.length = w
}
