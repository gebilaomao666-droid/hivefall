// 指挥官技能：冷却与充能、划线瞄准、各技能的效果、召唤物（旗舰 / 机器人 / 汇聚射线）、「回收程序」的重建队列。
// 数值在 data/commanders.js。技能伤害以 POWER 为来源走 combat.js 的统一入口，记进 stats.dmgByPower[技能 id]。
import { COMMANDERS, POWERS, PASSIVES, AIM, CD_MUL_MIN } from '../data/commanders.js'
import { POWER } from '../data/units.js'
import { CONTRACTS } from '../data/contracts.js'
import { FIELD } from '../data/waves.js'
import { clamp } from '../core/util.js'
import { queryCircle, queryRect } from './grid.js'
import { hitEnemy, explode, explodeLater, findDense, addZone } from './combat.js'
import { damageBoss, bossUp } from './boss.js'
import { addUnits, capRoom, healAll } from './squad.js'
import { ST_DYING, ST_BURROW, KIND_INDEX } from './swarm.js'

const X_EDGE = FIELD.xEdge
const Z_FAR = -24, Z_NEAR = 16
const K_POD = KIND_INDEX.pod

// 建好 world.powers / world.passive，英雄上场。commander 为 'none' 时什么都不建。
export function createPowers(world) {
  const c = COMMANDERS[world.opts.commander]
  world.powers = []
  world.passive = { aegis: null, rebuild: null, overclock: null }
  if (!c) return
  for (const id of c.passives) if (id in world.passive) world.passive[id] = PASSIVES[id]
  for (const id of c.powers) {
    const d = POWERS[id]
    world.powers.push({
      id, key: d.key, cd: d.first, cdMax: d.first, charges: 0, maxCharges: d.charges, ready: false, aimable: d.aimable,
      nameKey: d.nameKey, descKey: d.descKey, aiming: false, activeUntil: 0, casts: 0,
      _def: d, _left: d.first, _first: true, _gap: 0,
    })
    world.stats.dmgByPower[id] = 0
    world.stats.powerCasts[id] = 0
  }
  addUnits(world, c.hero, 1, 'start')
}

const powerMul = world => world.powerDmgMul

// ---------------------------------------------------------------- 小工具

function telegraph(world, x, z, r, dur, style) {
  world.telegraphs.push({ id: world._nextId++, shape: 'circle', x, z, r, t0: world.time, t1: world.time + dur, team: 'ally', style })
}

function strike(world, id, kind, x, z, r, delay) {
  world.events.push({ type: 'strike', power: id, kind, x, z, r, delay })
}

// 挑 n 个落点：最密处，彼此错开一点；Boss 在场时前 bossN 个直接给 Boss。写进 out（{x, z}），返回个数。
const spots = []
function pickSpots(world, n, bossN, scatter) {
  const sq = world.squad, rng = world.rng.power, b = world.boss, bossOk = bossUp(b)
  spots.length = 0
  for (let k = 0; k < n; k++) {
    let x, z
    if (bossOk && k < bossN) { x = b.x; z = b.z }
    else if (findDense(world, 12, Z_FAR, sq.frontZ - 1.5, 0, 40, 0)) { x = world._aim.x; z = world._aim.z }
    else if (bossOk) { x = b.x; z = b.z }
    else break
    if (k > 0) { x += rng.tri() * scatter; z += rng.tri() * scatter }
    spots.push({ x: clamp(x, -X_EDGE, X_EDGE), z })
  }
  return spots.length
}

// 沿线段（半宽 half）打一遍，无视护甲。返回命中虫数。
function hitSegment(world, seg, half, dmg, bossDmg, id) {
  const g = world.hash, s = world.swarm, out = g.out
  const { x0, z0, x1, z1 } = seg
  const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz) || 1
  const nx = dx / len, nz = dz / len
  const n = queryRect(g, s, Math.min(x0, x1) - half, Math.max(x0, x1) + half, Math.min(z0, z1) - half, Math.max(z0, z1) + half, out)
  let hits = 0
  for (let j = 0; j < n; j++) {
    const i = out[j]
    const ex = s.x[i] - x0, ez = s.z[i] - z0
    const along = ex * nx + ez * nz
    if (along < -half || along > len + half) continue
    const perp = ex * nz - ez * nx
    if (perp > half || perp < -half) continue
    hitEnemy(world, i, dmg, POWER, null, true, id, false)
    hits++
  }
  const b = world.boss
  if (bossDmg > 0 && bossUp(b)) {
    const ex = b.x - x0, ez = b.z - z0
    const along = clamp(ex * nx + ez * nz, 0, len), px = x0 + nx * along - b.x, pz = z0 + nz * along - b.z
    const rr = half + b.radius
    if (px * px + pz * pz <= rr * rr) damageBoss(world, bossDmg, POWER, null, id, true)
  }
  return hits
}

// ---------------------------------------------------------------- 各技能

const CAST = {
  hawk_rally(world, p, d) {
    world._rally = d
    world._rallyUntil = world.time + d.dur
    p.activeUntil = world._rallyUntil
    return { dur: d.dur }
  },

  hawk_strike(world, p, d) {
    const sq = world.squad, x = sq.x, pm = powerMul(world)
    for (let k = 0; k < d.bombs; k++) {
      const z = sq.frontZ - d.z0 - k * d.step, delay = d.delay + k * d.stagger
      strike(world, d.id, 'bomb', x, z, d.r, delay)
      telegraph(world, x, z, d.r, delay, 'strike')
      explodeLater(world, delay, x, z, d.r, d.dmg * pm, d.maxTargets, 0, 0, POWER, null, d.id, d.bossDmg * pm, 'l')
    }
    return { x, z0: sq.frontZ - d.z0, z1: sq.frontZ - d.z0 - (d.bombs - 1) * d.step }
  },

  hawk_drop(world, p, d) {
    const sq = world.squad, rng = world.rng.power
    const x = sq.x, z = sq.frontZ - d.ahead
    // 按权重抽；抽到的满编就顺延到下一种，全满则改成全员治疗
    let unit = null, count = 0, elite = null
    if (!world._goliath && rng() < d.goliath) { world._goliath = true; unit = 'titan'; count = 1; elite = CONTRACTS.goliath.elite }
    else {
      let total = 0
      for (const e of d.table) total += e.weight
      let r = rng() * total, start = 0
      while (start < d.table.length - 1 && (r -= d.table[start].weight) > 0) start++
      for (let k = 0; k < d.table.length && unit === null; k++) {
        const e = d.table[(start + k) % d.table.length]
        if (e.unit === 'heavy') {
          for (const h of world.heavyPlan) if (capRoom(world, h) > 0) { unit = h; count = 1; break }
        } else {
          const room = capRoom(world, e.unit)
          if (room > 0) { unit = e.unit; count = Math.min(e.count, room) }
        }
      }
    }
    if (unit === null) {
      healAll(world, d.healFrac)
      return { x, z, mode: 'heal' }
    }
    strike(world, d.id, 'pod', x, z, d.r, d.delay)
    telegraph(world, x, z, d.r, d.delay, 'pod')
    world._pq.push({ t: world.time + d.delay, type: 'drop', x, z, unit, count, elite })
    return { x, z, mode: 'troops', unit, count }
  },

  hawk_flagship(world, p, d) {
    const sq = world.squad, time = world.time
    const sm = summon(world, 'flagship', d.id, sq.x, sq.frontZ - d.ahead, d.y, d.dur)
    sm._acc = 0
    sm._gunT = time + d.gunAt
    sm._gun = 0               // 0 待机 / 1 蓄力中 / 2 已开火
    sm._gx = 0; sm._gz = 0
    p.activeUntil = sm.t1
    return { x: sm.x, z: sm.z, dur: d.dur }
  },

  ysera_orbital(world, p, d) {
    const pm = powerMul(world)
    const n = pickSpots(world, d.shots, d.bossShots, d.scatter)
    if (n === 0) return null
    for (let k = 0; k < n; k++) {
      const { x, z } = spots[k], delay = d.delay + k * d.stagger
      strike(world, d.id, 'orbital', x, z, d.r, delay)
      telegraph(world, x, z, d.r, delay, 'strike')
      explodeLater(world, delay, x, z, d.r, d.dmg * pm, d.maxTargets, 0, d.vsHeavy, POWER, null, d.id, d.bossDmg * pm, 'l')
    }
    return { x: spots[0].x, z: spots[0].z, count: n }
  },

  ysera_lance(world, p, d, seg) {
    const pm = powerMul(world)
    const hits = hitSegment(world, seg, d.half, d.dmg * pm, d.bossDmg * pm, d.id)
    world.events.push({ type: 'beam', kind: d.id, x0: seg.x0, z0: seg.z0, x1: seg.x1, z1: seg.z1, dur: 0.5, w: d.half * 2 })
    // 余烬：沿线留一串灼烧区
    const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0, len = Math.sqrt(dx * dx + dz * dz)
    const n = Math.max(1, Math.round(len / d.burnStep))
    // Boss 站在线上哪一段都吃得到灼烧，但每跳只吃一份（不按圈数叠）：整串圆共用一个 _grp 去重
    const grp = { t: -1 }
    for (let k = 0; k <= n; k++) {
      const zn = addZone(world, 'lance', seg.x0 + dx * k / n, seg.z0 + dz * k / n, d.half, d.burnDur, d.burnDmg * pm, d.burnTick, POWER, d.id)
      zn._bossDmg = d.burnDmg * pm
      zn._grp = grp
    }
    world.events.push({ type: 'shake', amp: 0.1 })
    return { aim: seg, hits }
  },

  ysera_eclipse(world, p, d) {
    world._eclipse = { until: world.time + d.dur, acc: 0, d }
    p.activeUntil = world._eclipse.until
    world.events.push({ type: 'shake', amp: 0.12 })
    return { dur: d.dur }
  },

  joe_drop(world, p, d) {
    const n = pickSpots(world, d.robots, 1, d.scatter)
    if (n === 0) return null
    for (let k = 0; k < n; k++) {
      const { x, z } = spots[k], delay = d.delay + k * d.stagger
      strike(world, d.id, 'robot', x, z, d.r, delay)
      telegraph(world, x, z, d.r, delay, 'strike')
      world._pq.push({ t: world.time + delay, type: 'robot', x, z })
    }
    return { x: spots[0].x, z: spots[0].z, count: n }
  },

  joe_mines(world, p, d, seg) {
    const time = world.time
    for (let k = 0; k < d.mines; k++) {
      const f = d.mines > 1 ? k / (d.mines - 1) : 0.5
      const x = seg.x0 + (seg.x1 - seg.x0) * f, z = seg.z0 + (seg.z1 - seg.z0) * f
      strike(world, d.id, 'mine', x, z, d.trigger, d.arm)
      // 雷是一个不自己结算的区域：表现层照常从 world.zones 画，触发在 tickMines
      const zn = addZone(world, 'mine', x, z, d.trigger, d.life, 0, 1e9, POWER, d.id)
      zn._armT = time + d.arm
      world._mines.push(zn)
    }
    return { aim: seg, count: d.mines }
  },

  joe_ray(world, p, d) {
    // 从队伍所在的一侧扫向另一侧：先清掉离自己近的
    const dir = world.squad.x > 0 ? -1 : 1
    const sm = summon(world, 'ray', d.id, -dir * (X_EDGE + 0.5), (d.z0 + d.z1) / 2, 0, d.dur)
    sm.dir = dir; sm.z0 = d.z0; sm.z1 = d.z1
    sm._bossHit = false
    p.activeUntil = sm.t1
    world.events.push({ type: 'beam', kind: d.id, x0: sm.x, z0: sm.z, x1: -sm.x, z1: sm.z, dur: d.dur, w: d.z1 - d.z0 })
    world.events.push({ type: 'shake', amp: 0.18 })
    return { dir, dur: d.dur }
  },
}

// ---------------------------------------------------------------- 召唤物

function summon(world, kind, power, x, z, y, dur) {
  const sm = {
    id: world._nextId++, kind, power, x, z, y, t0: world.time, t1: world.time + dur,
    facing: Math.PI, fireT: -9, aimX: x, aimZ: z,
  }
  world.summons.push(sm)
  world.events.push({ type: 'summon', id: sm.id, kind, power, x, z, dur })
  return sm
}

function tickFlagship(world, sm, dt) {
  const d = POWERS.hawk_flagship, pm = powerMul(world), time = world.time, sq = world.squad
  const b = world.boss, bossOk = bossUp(b)
  sm._acc += dt
  while (sm._acc >= d.laserEvery) {
    sm._acc -= d.laserEvery
    for (let k = 0; k < d.lasers; k++) {
      let x, z
      if (findDense(world, 8, Z_FAR, sq.frontZ - 1, 0, 40, 0)) { x = world._aim.x; z = world._aim.z }
      else if (bossOk) { x = b.x; z = b.z }
      else break
      explode(world, x, z, d.laserR, d.laserDmg * pm, d.laserMax, 0, 0, POWER, null, d.id, d.laserBoss * pm, 's')
      world.events.push({ type: 'beam', kind: d.id, x0: sm.x, z0: sm.z, x1: x, z1: z, dur: 0.12, w: 0.4 })
      sm.fireT = time; sm.aimX = x; sm.aimZ = z
    }
  }
  if (sm._gun === 0 && time >= sm._gunT) {
    // 主炮：锁场上最大的目标（Boss 优先），蓄力期间亮预警圈
    let x = 0, z = 0, ok = false
    if (bossOk) { x = b.x; z = b.z; ok = true }
    else {
      const s = world.swarm
      let bh = 0
      for (let i = 0; i < s.count; i++) {
        if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW || s.hpMax[i] <= bh) continue
        bh = s.hpMax[i]; x = s.x[i]; z = s.z[i]; ok = true
      }
    }
    if (ok) {
      sm._gun = 1; sm._gx = x; sm._gz = z; sm._gunT = time + d.gunCharge
      strike(world, d.id, 'main_gun', x, z, d.gunR, d.gunCharge)
      telegraph(world, x, z, d.gunR, d.gunCharge, 'main_gun')
    } else sm._gunT = time + 0.5
  } else if (sm._gun === 1 && time >= sm._gunT) {
    sm._gun = 2
    // Boss 会走动：开火那一刻它还在就跟过去
    if (bossOk) { sm._gx = b.x; sm._gz = b.z }
    world.events.push({ type: 'beam', kind: 'hawk_flagship_gun', x0: sm.x, z0: sm.z, x1: sm._gx, z1: sm._gz, dur: 0.35, w: 1.6 })
    explode(world, sm._gx, sm._gz, d.gunR, d.gunDmg * pm, d.gunMax, 0, 0, POWER, null, d.id, d.gunBoss * pm, 'xl')
    world.events.push({ type: 'hitstop', ms: 60 })
    world.events.push({ type: 'shake', amp: 0.3 })
  }
}

function tickRobot(world, sm, dt) {
  const d = POWERS.joe_drop, g = world.hash, s = world.swarm, time = world.time
  if (time >= sm._hitT) {
    sm._hitT += d.hitEvery
    const out = g.out
    const n = queryCircle(g, s, sm.x, sm.z, d.hitR, out)
    const dmg = d.hitDmg * powerMul(world)
    let left = d.hitMax, tx = sm.x, tz = sm.z
    for (let j = 0; j < n && left > 0; j++) {
      const i = out[j]
      if (s.y[i] > 0) continue
      tx = s.x[i]; tz = s.z[i]
      hitEnemy(world, i, dmg, POWER, null, false, d.id, false)
      left--
    }
    const b = world.boss
    if (bossUp(b)) {
      const dx = b.x - sm.x, dz = b.z - sm.z, rr = d.hitR + b.radius
      if (dx * dx + dz * dz <= rr * rr) { damageBoss(world, dmg, POWER, null, d.id); tx = b.x; tz = b.z; left-- }
    }
    if (left < d.hitMax) { sm.fireT = time; sm.aimX = tx; sm.aimZ = tz; sm.facing = Math.atan2(tx - sm.x, tz - sm.z); sm._tx = sm.x; sm._tz = sm.z }
    else {
      // 手边没虫：朝附近最近的一只走
      const m = queryCircle(g, s, sm.x, sm.z, d.seek, out)
      let bd = Infinity
      sm._tx = sm.x; sm._tz = sm.z
      for (let j = 0; j < m; j++) {
        const i = out[j]
        if (s.y[i] > 0) continue
        const dx = s.x[i] - sm.x, dz = s.z[i] - sm.z, dd = dx * dx + dz * dz
        if (dd < bd) { bd = dd; sm._tx = s.x[i]; sm._tz = s.z[i] }
      }
    }
  }
  const dx = sm._tx - sm.x, dz = sm._tz - sm.z, dist = Math.sqrt(dx * dx + dz * dz)
  if (dist > 0.3) {
    const m = Math.min(d.speed * dt, dist)
    sm.x += dx / dist * m; sm.z += dz / dist * m
    sm.facing = Math.atan2(dx, dz)
  }
}

function tickRay(world, sm, dt) {
  const d = POWERS.joe_ray, g = world.hash, s = world.swarm, out = g.out
  const span = (X_EDGE + 0.5) * 2
  const prev = sm.x
  sm.x = clamp(prev + sm.dir * span / d.dur * dt, -X_EDGE - 0.5, X_EDGE + 0.5)
  const lo = Math.min(prev, sm.x) - d.half, hi = Math.max(prev, sm.x) + d.half
  const n = queryRect(g, s, lo, hi, d.z0, d.z1, out)
  const pm = powerMul(world)
  // 同一只虫可能连着两步都在光带里：用 tag 去重
  for (let j = 0; j < n; j++) {
    const i = out[j]
    if (s.tag[i] === sm.id) continue
    s.tag[i] = sm.id
    hitEnemy(world, i, d.dmg * pm, POWER, null, true, d.id, false)
  }
  const b = world.boss
  if (!sm._bossHit && bossUp(b) && b.x + b.radius >= lo && b.x - b.radius <= hi) {
    sm._bossHit = true
    damageBoss(world, d.bossDmg * pm, POWER, null, d.id, true)
    world.events.push({ type: 'hitstop', ms: 50 })
  }
}

function tickSummons(world, dt) {
  const list = world.summons, time = world.time
  let w = 0
  for (let n = 0; n < list.length; n++) {
    const sm = list[n]
    if (time >= sm.t1) { world.events.push({ type: 'summonEnd', id: sm.id, kind: sm.kind, x: sm.x, z: sm.z }); continue }
    if (sm.kind === 'flagship') tickFlagship(world, sm, dt)
    else if (sm.kind === 'robot') tickRobot(world, sm, dt)
    else tickRay(world, sm, dt)
    list[w++] = sm
  }
  list.length = w
}

// ---------------------------------------------------------------- 定时结算

function tickQueue(world) {
  const pq = world._pq, time = world.time
  for (let n = pq.length - 1; n >= 0; n--) {
    const e = pq[n]
    if (time < e.t) continue
    pq[n] = pq[pq.length - 1]
    pq.pop()
    const pm = powerMul(world)
    if (e.type === 'drop') {
      const d = POWERS.hawk_drop
      explode(world, e.x, e.z, d.r, d.dmg * pm, 20, 0, 0, POWER, null, d.id, 0, 'm')
      addUnits(world, e.unit, e.count, 'drop', e.elite, e.elite !== null)
    } else {
      const d = POWERS.joe_drop, g = world.hash, s = world.swarm
      // 落地：先眩晕再结算伤害（被砸死的就不用晕了）
      const cnt = queryCircle(g, s, e.x, e.z, d.r, g.out2)
      for (let j = 0; j < cnt; j++) { const i = g.out2[j]; if (s.kind[i] !== K_POD) s.stunT[i] = time + d.stun }
      explode(world, e.x, e.z, d.r, d.dmg * pm, d.maxTargets, 0, 0, POWER, null, d.id, d.bossDmg * pm, 'm')
      const sm = summon(world, 'robot', d.id, e.x, e.z, 0, d.life)
      sm._hitT = time + d.hitEvery
      sm._tx = e.x; sm._tz = e.z
    }
  }
}

function tickEclipse(world, dt) {
  const ec = world._eclipse
  if (ec === null) return
  if (world.time >= ec.until) { world._eclipse = null; return }
  const d = ec.d, rng = world.rng.power, sq = world.squad, pm = powerMul(world)
  const b = world.boss, bossOk = bossUp(b)
  ec.acc += d.shots / d.dur * dt
  while (ec.acc >= 1) {
    ec.acc--
    let x, z
    const r = rng()
    if (bossOk && r < d.bossShare) { x = b.x + rng.tri() * 1.2; z = b.z + rng.tri() * 1.2 }
    else if (r < d.autoAim && findDense(world, 8, Z_FAR, sq.frontZ - 1, 0, 40, 0)) { x = world._aim.x + rng.tri() * 0.8; z = world._aim.z + rng.tri() * 0.8 }
    else { x = rng.range(-X_EDGE + 0.4, X_EDGE - 0.4); z = rng.range(-18, sq.frontZ - 2) }
    explode(world, x, z, d.r, d.dmg * pm, d.maxTargets, 0, 0, POWER, null, d.id, d.bossDmg * pm, 's')
  }
}

function tickMines(world) {
  const mines = world._mines
  if (mines.length === 0) return
  const d = POWERS.joe_mines, g = world.hash, s = world.swarm, time = world.time, out = g.out2
  const b = world.boss, bossOk = bossUp(b)
  let w = 0
  for (let n = 0; n < mines.length; n++) {
    const zn = mines[n]
    if (time >= zn.t1) continue
    if (time >= zn._armT) {
      let trip = false
      const cnt = queryCircle(g, s, zn.x, zn.z, d.trigger, out)
      for (let j = 0; j < cnt; j++) if (s.y[out[j]] <= 0) { trip = true; break }
      if (!trip && bossOk) { const dx = b.x - zn.x, dz = b.z - zn.z, rr = d.trigger + b.radius; trip = dx * dx + dz * dz <= rr * rr }
      if (trip) {
        const pm = powerMul(world)
        zn.t1 = time          // 区域下一步被 combat 清掉
        explode(world, zn.x, zn.z, d.r, d.dmg * pm, d.maxTargets, 0, 0, POWER, null, d.id, d.bossDmg * pm, 'm')
        continue
      }
    }
    mines[w++] = zn
  }
  mines.length = w
}

// 「回收程序」：残骸到点重建。满编就再等等（别的兵先补进来了）。
function tickRebuild(world) {
  const q = world._rebuild, time = world.time
  for (let n = 0; n < q.length;) {
    const e = q[n]
    if (time < e.t) { n++; continue }
    if (addUnits(world, e.kind, 1, 'rebuild', e.elite, e.free) > 0) q.splice(n, 1)
    else { e.t = time + 2; n++ }
  }
}

// ---------------------------------------------------------------- 瞄准与释放

function autoSegment(world, d) {
  const sq = world.squad
  if (d.auto === 'across') {
    const z = sq.frontZ - d.ahead, half = d.len / 2
    const c = clamp(sq.x, -X_EDGE + half, X_EDGE - half)
    return { x0: c - half, z0: z, x1: c + half, z1: z }
  }
  const z0 = sq.frontZ - 1
  return { x0: sq.x, z0, x1: sq.x, z1: z0 - d.len }
}

// 玩家划的线：夹进桥面，太短就沿原方向补到最短长度，太长就截断。退化成一个点时用自动线。
function cleanSegment(world, d, aim) {
  let x0 = clamp(aim.x0, -X_EDGE, X_EDGE), z0 = clamp(aim.z0, Z_FAR, Z_NEAR)
  let x1 = clamp(aim.x1, -X_EDGE, X_EDGE), z1 = clamp(aim.z1, Z_FAR, Z_NEAR)
  if (!(Number.isFinite(x0) && Number.isFinite(z0) && Number.isFinite(x1) && Number.isFinite(z1))) return autoSegment(world, d)
  const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz)
  if (len < 0.5) return autoSegment(world, d)
  const want = clamp(len, AIM.minLen, d.len)
  if (want !== len) { x1 = clamp(x0 + dx / len * want, -X_EDGE, X_EDGE); z1 = clamp(z0 + dz / len * want, Z_FAR, Z_NEAR) }
  return { x0, z0, x1, z1 }
}

function cast(world, p, seg) {
  const d = p._def
  const info = CAST[d.id](world, p, d, seg)
  if (info === null) return false           // 没有可打的目标：不消耗充能
  if (p.charges === p.maxCharges) { p._left = d.cd; p._first = false }   // 满充能时计时是停着的，现在重新开始充
  p.charges--
  p._gap = d.gap
  p.casts++
  world.stats.powerCasts[d.id]++
  world.events.push({ type: 'powerCast', id: d.id, key: d.key, x: world.squad.x, z: world.squad.frontZ, ...info })
  return true
}

function beginAim(world, p) {
  const d = p._def
  p.aiming = true
  world.status = 'aiming'
  world.timeScale = AIM.timeScale
  world.aiming = { power: d.id, key: d.key, timeout: AIM.timeout, timeLeft: AIM.timeout, auto: autoSegment(world, d), _p: p, _real: 0 }
  world.events.push({ type: 'aimStart', id: d.id, key: d.key, timeout: AIM.timeout, auto: world.aiming.auto })
}

function endAim(world, how, seg) {
  const a = world.aiming, p = a._p
  p.aiming = false
  world.aiming = null
  if (world.status === 'aiming') { world.status = 'running'; world.timeScale = 1 }
  world.events.push({ type: 'aimEnd', id: p.id, how })
  if (seg !== null) cast(world, p, seg)
}

// Boss 倒下时还在瞄准：取消，不消耗充能（timeScale 交给 Boss 的子弹时间）
export function cancelAim(world) {
  if (world.aiming === null) return
  const p = world.aiming._p
  p.aiming = false
  world.aiming = null
  if (world.status === 'aiming') world.status = 'running'
  world.events.push({ type: 'aimEnd', id: p.id, how: 'cancel' })
}

export function update(world, input, dt) {
  tickRebuild(world)
  const ps = world.powers
  if (ps.length > 0) {
    const cdMul = Math.max(CD_MUL_MIN, world.mods.global.cdMul)
    for (let n = 0; n < ps.length; n++) {
      const p = ps[n], d = p._def
      if (p._gap > 0) p._gap -= dt
      if (p.charges < p.maxCharges) {
        p._left -= dt / cdMul
        if (p._left <= 0) {
          p.charges++
          p._first = false
          p._left = p.charges < p.maxCharges ? d.cd : 0
          world.events.push({ type: 'powerReady', id: p.id, key: p.key, charges: p.charges })
          if (!world._seen.power) {
            world._seen.power = true
            world.events.push({ type: 'comms', speaker: world.opts.commander, textKey: COMMANDERS[world.opts.commander].readyKey })
          }
        }
      }
      p.ready = p.charges > 0 && p._gap <= 0 && !p.aiming
    }

    const a = world.aiming
    const keys = input ? input.powers : null
    if (a !== null) {
      // 瞄准中：模拟没有真实时钟，按「每步 = DT / timeScale 真实秒」折算超时
      a._real += dt / world.timeScale
      a.timeLeft = Math.max(0, a.timeout - a._real)
      a.auto = autoSegment(world, a._p._def)
      if (input && input.aim) endAim(world, 'aim', cleanSegment(world, a._p._def, input.aim))
      else if (keys && keys.includes(a.key)) endAim(world, 'key', a.auto)       // 再按一次同一个键：立刻按自动线放
      else if (a._real >= a.timeout - 1e-6) endAim(world, 'timeout', a.auto)
    } else if (keys && keys.length > 0) {
      for (let n = 0; n < ps.length; n++) {
        const p = ps[n]
        if (!p.ready || !keys.includes(p.key)) continue
        if (p.aimable) { beginAim(world, p); break }
        cast(world, p, null)
      }
    }
    // 给表现层看的读数放在最后算：这一步刚放掉的技能立刻显示进冷却
    for (let n = 0; n < ps.length; n++) {
      const p = ps[n], d = p._def
      p.cd = p.charges < p.maxCharges ? p._left * cdMul : 0
      p.cdMax = (p._first ? d.first : d.cd) * cdMul
      p.ready = p.charges > 0 && p._gap <= 0 && !p.aiming
    }
  }
  tickQueue(world)
  tickSummons(world, dt)
  tickEclipse(world, dt)
  tickMines(world)
}
