// 战斗结算：我方开火循环、伤害入口、爆炸、光束、持续区域、延迟效果、英雄级与定时装备。
// 伤害立刻结算；表现层按事件里的 delay 自己延后播命中。
import { ENEMIES, ENEMY_KINDS, MIN_ARMOR_HIT, ELITE } from '../data/enemies.js'
import { HEROICS } from '../data/combos.js'
import { ANTI_AIR, POWER, DEVICE, DEVICE_AA, MECH_KINDS } from '../data/units.js'
import { MARK } from '../data/modules.js'
import { queryCircle, queryRect, density } from './grid.js'
import { kill, ENEMY_CLS, ST_DYING, ST_BURROW } from './swarm.js'
import { addXp } from './progression.js'
import { damageBoss, bossUp } from './boss.js'
import { hurtCircle } from './squad.js'
import { WEAPONS } from './weapons/index.js'
import { queueRevive } from './mutators.js'
import { dropEnergy } from './devices.js'

const DEFS = ENEMY_KINDS.map(k => ENEMIES[k])
const BIG_HIT = 40
const ZONE_CAP = 48
const WARD = ENEMIES.warden.attack
const K_SHIELDBUG = ENEMY_KINDS.indexOf('shieldbug'), SHIELD_BUG = ENEMIES.shieldbug.shield

// 举盾虫的正面减伤（只给直射武器用：突击兵 / 霍克 / 破城 / 哨戒塔 / 冷凝塔）。
// 虫朝 +z 走；子弹从 (sx, sz) 打来，来向与朝向夹角 < 60° 算正面。返回伤害倍率。
export function frontalMul(world, i, sx, sz) {
  const s = world.swarm
  if (s.kind[i] !== K_SHIELDBUG) return 1
  const dx = sx - s.x[i], dz = sz - s.z[i]
  return dz > 0 && dz * dz > SHIELD_BUG.cos * SHIELD_BUG.cos * (dx * dx + dz * dz) ? 1 - SHIELD_BUG.reduce : 1
}

// 对第 i 只虫造成伤害。返回是否击杀。
// kind: 伤害来源兵种 id（统计用，也决定能不能打到飞行目标）；u: 开火单位或 null；
// mod: 归属的模块/联动 id 或 null；fire: 是否火焰类（英雄级「燎原」用）
export function hitEnemy(world, i, dmg, kind, u, ignoreArmor, mod, fire) {
  const s = world.swarm
  const state = s.state[i]
  if (state === ST_DYING || state === ST_BURROW || s.alive[i] === 0) return false
  if (s.y[i] > 0 && ANTI_AIR[kind] !== true) return false
  if (s.mark[i] === 1) dmg *= MARK.dmgMul            // 被标定：护甲失效
  else if (!ignoreArmor) {
    const a = s.armor[i]
    if (a > 0) { const red = dmg - a, floor = dmg < MIN_ARMOR_HIT ? dmg : MIN_ARMOR_HIT; dmg = red > floor ? red : floor }
  }
  const wd = s.ward[i]
  if (wd !== 0) dmg *= 1 - (wd === 1 ? WARD.reduce : WARD.lingerReduce)   // 护巢虫光环 / 离开光环后的余效
  s.hitT[i] = world.time
  const sh = s.shield[i]
  if (sh > 0) {
    // 突变「甲壳共振」的护盾：先吃掉伤害，不计入伤害统计
    if (dmg <= sh) { s.shield[i] = sh - dmg; return false }
    dmg -= sh
    s.shield[i] = 0
  }
  const hp = s.hp[i]
  const dealt = dmg < hp ? dmg : hp
  const st = world.stats
  const dev = kind === DEVICE || kind === DEVICE_AA
  if (kind === POWER) st.dmgByPower[mod] += dealt      // 指挥官技能：mod 是技能 id
  else if (dev) st.dmgByDevice[mod] += dealt           // 装置：mod 是装置 kind
  else {
    st.dmgByUnit[kind] += dealt
    if (mod !== null) st.dmgByModule[mod] = (st.dmgByModule[mod] || 0) + dealt
    if (u !== null) u.dmg += dealt
  }
  const x = s.x[i], z = s.z[i]
  if (dmg >= BIG_HIT) world.events.push({ type: 'bigHit', x, z, dmg })
  const k = s.kind[i], def = DEFS[k], mut = world.mut
  if (dmg < hp) {
    s.hp[i] = hp - dmg
    world.events.push({ type: 'enemyHit', i, x, z, dmg, crit: false })
    if (mut.resonance > 0 && (s.flags[i] & 1) === 0 && def.pod !== true) {
      s.flags[i] |= 1
      s.shield[i] = s.hpMax[i] * mut.resonance
      s.shieldT[i] = world.time + mut.resonanceDur
      s._shielded = true
    }
    return false
  }
  kill(world, i)
  world.events.push({ type: 'enemyDie', i, kind: def.id, x, z, by: mod !== null ? mod : kind, gore: dmg >= hp * 4 ? 2 : dmg >= hp * 2 ? 1 : 0 })
  if (def.pod === true) return true                  // 空投舱不是虫：不计击杀、不给经验
  // 「不死孢子」复活出来的那只：同一只虫不能算两次，否则这个突变等于白送分数和经验
  if ((s.flags[i] & 2) !== 0) {
    if (fire && world.mods.flamer.heroic > 0) wildfire(world, x, z)
    return true
  }
  st.kills++
  st._stepKills++
  if (kind === POWER) st.killsByPower[mod] = (st.killsByPower[mod] || 0) + 1
  else if (dev) st.killsByDevice[mod]++
  else st.killsByUnit[kind] = (st.killsByUnit[kind] || 0) + 1
  if (s.elite[i] === 1) st.eliteKills++
  dropEnergy(world, k, s.elite[i] === 1, x, z)
  if (u !== null) u.kills++
  addXp(world, s.elite[i] === 1 ? def.xp * ELITE.xpMul : def.xp, x, z)
  if (mut.undying > 0 && def.behavior !== 'egg') queueRevive(world, i, k, x, z)
  if (fire && world.mods.flamer.heroic > 0) wildfire(world, x, z)
  return true
}

// 减速：取更强的那个倍率，时长取更晚的
export function slowEnemy(world, i, factor, dur) {
  const s = world.swarm, t = world.time, mul = 1 - factor
  if (t >= s.slowT[i] || mul < s.slow[i]) s.slow[i] = mul
  if (t + dur > s.slowT[i]) s.slowT[i] = t + dur
}

// 英雄级「燎原」：被烧死的虫原地再起一片火。火区自己烧死的不再外传（fire 标记只在首层传入）。
function wildfire(world, x, z) {
  const h = HEROICS.heroic_flamer
  if (world._wildfireStep >= h.perStep) return
  let n = 0
  for (const zn of world.zones) if (zn.style === 'spread') n++
  if (n >= h.zoneCap) return
  world._wildfireStep++
  addZone(world, 'fire', x, z, h.r, h.dur, h.dmg * world.dmgMul, 0.3, 'flamer', 'heroic_flamer', 'spread')
}

// 持续区域。返回的对象上可以再设：_max 每跳目标上限 / _slow 减速比例 / _bossDmg 每跳对 Boss / _u 归属单位 /
// _bolt 英雄级闪电 / _udmg 对我方的每跳伤害（敌方酸池）/ _grp 同组区域对 Boss 每跳只结算一次。
// w > 0 时是矩形（x 向宽 w、z 向深 d），r 只作兜底。
// 火区数量有上限（焚化兵多了会刷很多），满了返回 null；其它类型不占这个上限，也不挤占火区的名额。
export function addZone(world, type, x, z, r, dur, dmg, tick, kind, mod, style = type, w = 0, d = 0) {
  if (type === 'fire') {
    let fires = 0
    for (const o of world.zones) if (o.type === 'fire') fires++
    if (fires >= ZONE_CAP) return null
  }
  const zn = {
    id: world._nextId++, type, x, z, r, t0: world.time, t1: world.time + dur, style, shape: w > 0 ? 'rect' : 'circle', w, d, team: 'ally',
    _dmg: dmg, _tick: tick, _next: world.time + tick, _kind: kind, _mod: mod,
    _max: 9999, _slow: 0, _bossDmg: 0, _u: null, _bolt: 0, _udmg: 0, _disT: 0, _grp: null,
  }
  world.zones.push(zn)
  world.events.push({ type: 'zone', id: zn.id, zone: type, x, z, r, dur, style, shape: zn.shape, w, d })
  return zn
}

const clsMul = (c, vsL, vsH) => (c === 1 ? 1 + vsL : c === 2 ? 1 + vsH : 1)

// 范围爆炸。bossDmg 为 0 表示不打 Boss。返回命中虫数。
export function explode(world, x, z, r, dmg, maxT, vsL, vsH, kind, u, mod, bossDmg, size) {
  const g = world.hash, s = world.swarm, out = g.out
  const n = queryCircle(g, s, x, z, r, out)
  // 打不到的（头顶的飞行虫）不占目标名额
  const air = ANTI_AIR[kind] === true
  let left = maxT
  for (let j = 0; j < n && left > 0; j++) {
    const i = out[j]
    if (!air && s.y[i] > 0) continue
    hitEnemy(world, i, dmg * clsMul(ENEMY_CLS[s.kind[i]], vsL, vsH), kind, u, false, mod, false)
    left--
  }
  const b = world.boss
  if (bossDmg > 0 && bossUp(b)) {
    const dx = b.x - x, dz = b.z - z, rr = r + b.radius
    if (dx * dx + dz * dz <= rr * rr) damageBoss(world, bossDmg, kind, u, mod)
  }
  world.events.push({ type: 'explosion', x, z, r, size, kind: mod !== null ? mod : kind })
  return maxT - left
}

// 光束扫过一个矩形：无视护甲。vert=false 是横扫（沿 x），true 是纵扫（沿 z）；rev 只影响事件里的起止方向。
// slow > 0 时给命中的轻甲减速。返回命中虫数。
export function sweepRect(world, x0, x1, z0, z1, dmg, maxT, vsL, vsH, kind, u, mod, bossDmg, slow, slowDur, vert, rev, dur) {
  const g = world.hash, s = world.swarm, out = g.out
  const n = queryRect(g, s, x0, x1, z0, z1, out)
  const air = ANTI_AIR[kind] === true
  let left = maxT
  for (let j = 0; j < n && left > 0; j++) {
    const i = out[j]
    if (!air && s.y[i] > 0) continue
    const c = ENEMY_CLS[s.kind[i]]
    if (slow > 0 && c === 1) slowEnemy(world, i, slow, slowDur)
    hitEnemy(world, i, dmg * clsMul(c, vsL, vsH), kind, u, true, mod, false)
    left--
  }
  const b = world.boss
  if (bossDmg > 0 && bossUp(b) && b.x + b.radius >= x0 && b.x - b.radius <= x1 && b.z + b.radius >= z0 && b.z - b.radius <= z1) {
    damageBoss(world, bossDmg, kind, u, mod, true)
  }
  const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2
  const e = vert
    ? { type: 'beam', kind: mod !== null ? mod : kind, x0: xc, z0: rev ? z1 : z0, x1: xc, z1: rev ? z0 : z1, dur, w: x1 - x0 }
    : { type: 'beam', kind: mod !== null ? mod : kind, x0: rev ? x1 : x0, z0: zc, x1: rev ? x0 : x1, z1: zc, dur, w: z1 - z0 }
  world.events.push(e)
  return maxT - left
}

// 稍后再炸（子母弹、余震、弹幕）。参数同 explode。
export function explodeLater(world, delay, x, z, r, dmg, maxT, vsL, vsH, kind, u, mod, bossDmg, size) {
  world._pending.push({ t: world.time + delay, beam: false, x, z, r, dmg, maxT, vsL, vsH, kind, u, mod, bossDmg, size, x1: 0, z1: 0, slow: 0, slowDur: 0, vert: false, rev: false, dur: 0 })
}

// 稍后再扫（回扫）。参数同 sweepRect。
export function sweepLater(world, delay, x0, x1, z0, z1, dmg, maxT, vsL, vsH, kind, u, mod, bossDmg, slow, slowDur, vert, rev, dur) {
  world._pending.push({ t: world.time + delay, beam: true, x: x0, z: z0, r: 0, dmg, maxT, vsL, vsH, kind, u, mod, bossDmg, size: 's', x1, z1, slow, slowDur, vert, rev, dur })
}

// 找虫最密的地方：随机抽样若干只活虫，按所在格密度打分，越靠近防线分越高。
// 结果写在 world._aim = {x, z}，找不到返回 false。groundOnly: 不把飞行虫当落点。
export function findDense(world, samples, zMin, zMax, ux, uz, minRange, groundOnly = false) {
  const s = world.swarm
  if (s.living === 0) return false
  const rng = world.rng.combat, g = world.hash
  const min2 = minRange * minRange
  let best = -1, bestScore = -1
  for (let k = 0; k < samples; k++) {
    const i = (rng() * s.count) | 0
    if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW) continue
    if (groundOnly && s.y[i] > 0) continue
    const x = s.x[i], z = s.z[i]
    if (z < zMin || z > zMax) continue
    const dx = x - ux, dz = z - uz
    if (dx * dx + dz * dz < min2) continue
    const score = density(g, x, z) * (1 + (z + 21) * 0.03) + 0.01
    if (score > bestScore) { bestScore = score; best = i }
  }
  if (best < 0) {
    // 虫少时抽样容易落空：退回线性扫描找第一只合格的
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW) continue
      if (groundOnly && s.y[i] > 0) continue
      const x = s.x[i], z = s.z[i]
      if (z < zMin || z > zMax) continue
      const dx = x - ux, dz = z - uz
      if (dx * dx + dz * dz < min2) continue
      best = i
      break
    }
    if (best < 0) return false
  }
  world._aim.x = s.x[best]
  world._aim.z = s.z[best]
  return true
}

// 英雄级「雷暴眼」：风暴向圈外劈一道闪电，连若干只
function lightning(world, zn) {
  const h = HEROICS.heroic_psion, g = world.hash, s = world.swarm, out = g.out2
  const n = queryCircle(g, s, zn.x, zn.z, zn.r + h.reach, out)
  const r2 = zn.r * zn.r, dmg = h.dmg * world.modDmgMul
  let points = null
  for (let j = 0; j < n; j++) {
    const i = out[j], dx = s.x[i] - zn.x, dz = s.z[i] - zn.z
    if (dx * dx + dz * dz <= r2) continue
    if (points === null) points = [{ x: zn.x, z: zn.z }]
    points.push({ x: s.x[i], z: s.z[i] })
    hitEnemy(world, i, dmg, zn._kind, zn._u, true, 'heroic_psion', false)
    if (points.length > h.chain) break
  }
  if (points !== null) world.events.push({ type: 'chain', points, kind: 'heroic_psion' })
}

// 区域结算一跳。mul: 伤害倍率（联动「静电网」的额外放电用）
function zoneTick(world, zn, mul) {
  const g = world.hash, s = world.swarm, out = g.out
  const cnt = zn.shape === 'rect'
    ? queryRect(g, s, zn.x - zn.w / 2, zn.x + zn.w / 2, zn.z - zn.d / 2, zn.z + zn.d / 2, out)
    : queryCircle(g, s, zn.x, zn.z, zn.r, out)
  const air = ANTI_AIR[zn._kind] === true
  const dmg = zn._dmg * mul
  let left = zn._max
  for (let j = 0; j < cnt && left > 0; j++) {
    const i = out[j]
    if (!air && s.y[i] > 0) continue
    if (zn._slow > 0) slowEnemy(world, i, zn._slow, zn._tick + 0.1)
    hitEnemy(world, i, dmg, zn._kind, zn._u, true, zn._mod, false)
    left--
  }
  const b = world.boss, grp = zn._grp
  if (zn._bossDmg > 0 && bossUp(b) && (grp === null || grp.t !== world.time)) {
    const dx = b.x - zn.x, dz = b.z - zn.z, rr = zn.r + b.radius
    if (dx * dx + dz * dz <= rr * rr) {
      if (grp !== null) grp.t = world.time
      damageBoss(world, zn._bossDmg * mul, zn._kind, zn._u, zn._mod, true)
    }
  }
  if (zn._bolt > 0) lightning(world, zn)
}

// 联动「静电网」：炮弹落进风暴，风暴立刻多放一次电
export function dischargeAt(world, x, z) {
  const m = world.mods.psion, time = world.time
  for (const zn of world.zones) {
    if (zn.type !== 'storm' || time < zn._disT) continue
    const dx = x - zn.x, dz = z - zn.z
    if (dx * dx + dz * dz > zn.r * zn.r) continue
    zn._disT = time + m.dischargeCd
    const mod = zn._mod
    zn._mod = 'combo_storm_grid'
    zoneTick(world, zn, m.dischargeMul)
    zn._mod = mod
    world.events.push({ type: 'explosion', x: zn.x, z: zn.z, r: zn.r, size: 'm', kind: 'combo_storm_grid' })
  }
}

function tickZones(world) {
  const zs = world.zones, time = world.time
  let w = 0
  for (let n = 0; n < zs.length; n++) {
    const zn = zs[n]
    if (time >= zn._next) {
      zn._next += zn._tick
      if (zn._udmg > 0) hurtCircle(world, zn.x, zn.z, zn.r, zn._udmg, 'acid_pool')
      else if (zn._dmg > 0) zoneTick(world, zn, 1)
    }
    if (time < zn.t1) zs[w++] = zn
  }
  zs.length = w
}

function tickPending(world) {
  const ps = world._pending, time = world.time
  for (let n = ps.length - 1; n >= 0; n--) {
    const p = ps[n]
    if (time < p.t) continue
    ps[n] = ps[ps.length - 1]
    ps.pop()
    if (p.beam) sweepRect(world, p.x, p.x1, p.z, p.z1, p.dmg, p.maxT, p.vsL, p.vsH, p.kind, p.u, p.mod, p.bossDmg, p.slow, p.slowDur, p.vert, p.rev, p.dur)
    else explode(world, p.x, p.z, p.r, p.dmg, p.maxT, p.vsL, p.vsH, p.kind, p.u, p.mod, p.bossDmg, p.size)
  }
}

function firstAlive(sq, kind) {
  for (const u of sq.units) if (u.alive && u.kind === kind) return u
  return null
}

// 「点名弹幕」：一轮炮弹按名单砸重甲目标；没有重甲就砸 Boss，再没有就砸最密处
function barrage(world, m) {
  const sq = world.squad, s = world.swarm, g = world.hash
  const u = firstAlive(sq, 'lancer')
  if (u === null) return
  const w = u._def.weapon, range = w.range + m.rangeAdd
  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const list = g.out2
  let nh = 0
  for (let i = 0; i < s.count && nh < m.barrageShots; i++) {
    if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW || ENEMY_CLS[s.kind[i]] !== 2) continue
    if (u.z - s.z[i] > range) continue
    list[nh++] = i
  }
  const b = world.boss, bossOk = bossUp(b)
  const h = HEROICS.heroic_lancer
  let fired = 0
  for (let k = 0; k < m.barrageShots; k++) {
    let x, z
    // Boss 在场时一半炮弹给 Boss
    if (bossOk && (nh === 0 || (k & 1) === 1)) { x = b.x; z = b.z }
    else if (nh > 0) { const i = list[k % nh]; x = s.x[i]; z = s.z[i] }
    else if (findDense(world, 8, u.z - range, u.z - 2, u.x, u.z, 0, true)) { x = world._aim.x; z = world._aim.z }
    else break
    explodeLater(world, 0.05 * k, x, z, m.barrageR, w.dmg * mul, m.barrageMax, 0, w.vsHeavy + m.vsHeavyAdd, 'lancer', u, 'lancer_barrage', w.bossDmg * mul * m.bossMul, 's')
    if (m.heroic > 0 && fired < h.zones) {
      // 英雄级「黑潮」：落点留一片减速的伤害区
      const zn = addZone(world, 'void', x, z, h.r, h.dur, h.dmg * world.modDmgMul, h.tick, 'lancer', 'heroic_lancer')
      zn._slow = h.slow
      zn._u = u
    }
    fired++
  }
  if (fired > 0) world.events.push({ type: 'volley', kind: 'lancer', count: fired })
}

// 英雄级的定时效果，以及按时间触发的装备
function tickHeroics(world, dt) {
  const mods = world.mods, hero = world._hero, sq = world.squad
  if (mods.rifle.heroic > 0 && sq.counts.rifle > 0) {
    const h = HEROICS.heroic_rifle
    hero.rifleT += dt
    if (hero.rifleT >= h.every) {
      hero.rifleT = 0
      // 「钢雨」：随机 N 名突击兵各补一发重弹，然后全体短暂提速
      const rng = world.rng.combat, us = sq.units
      let fired = 0
      for (let k = 0; k < h.shots * 3 && fired < h.shots; k++) {
        const u = us[(rng() * us.length) | 0]
        if (!u.alive || u.kind !== 'rifle') continue
        if (WEAPONS.hitscan(world, u, u._def, u._def.weapon, mods.rifle, h)) fired++
      }
      hero.surgeUntil = world.time + h.surge
      if (fired > 0) world.events.push({ type: 'volley', kind: 'rifle', count: fired })
    }
  }
  if (mods.titan.heroic > 0 && sq.counts.titan > 0) {
    const h = HEROICS.heroic_titan
    hero.titanT += dt
    if (hero.titanT >= h.every) {
      hero.titanT = 0
      // 「天崩」：一轮重炮砸向最密处，把小虫往回推
      const s = world.swarm, g = world.hash
      for (let k = 0; k < h.shells; k++) {
        if (!findDense(world, 12, -18, 12, 0, 40, 0)) break
        const { x, z } = world._aim
        const cnt = queryCircle(g, s, x, z, h.radius, g.out2)
        for (let j = 0; j < cnt; j++) { const i = g.out2[j]; if (s.kind[i] <= 1) s.z[i] -= h.knockback }
        explode(world, x, z, h.radius, h.dmg * world.dmgMul, 40, 0, 1.2, 'titan', null, 'heroic_titan', h.dmg * 3, 'xl')
      }
      world.events.push({ type: 'volley', kind: 'titan', count: h.shells })
    }
  }
  if (mods.lancer.barrage > 0 && sq.counts.lancer > 0) {
    hero.barrageT += dt
    if (hero.barrageT >= mods.lancer.barrageEvery) {
      hero.barrageT = 0
      barrage(world, mods.lancer)
    }
  }
  if (mods.skyhook.heroic > 0 && sq.counts.skyhook > 0) {
    const h = HEROICS.heroic_skyhook
    hero.skyT += dt
    if (hero.skyT >= h.every) {
      hero.skyT = 0
      // 「天网」：每个无人机群沿最密的纵线扫射一趟
      let runs = 0
      const b = world.boss
      for (const u of sq.units) {
        if (!u.alive || u.kind !== 'skyhook') continue
        let x
        if (findDense(world, 12, h.zFar, u.z - 2, u.x, u.z, 0)) x = world._aim.x
        else if (bossUp(b)) x = b.x
        else continue
        const dmg = h.dmg * world.dmgMul * u._dmgMul
        sweepRect(world, x - h.half, x + h.half, h.zFar, u.z - 2, dmg, h.maxTargets, 0, 0, 'skyhook', u, 'heroic_skyhook', dmg * 2, 0, 0, true, true, 0.5)
        runs++
      }
      if (runs > 0) world.events.push({ type: 'volley', kind: 'skyhook', count: runs })
    }
  }
}

export function update(world, dt) {
  const sq = world.squad, time = world.time, mods = world.mods, rng = world.rng.combat
  const overdrive = time < world.progress.overdriveUntil
  const surge = time < world._hero.surgeUntil
  const rally = time < world._rallyUntil ? world._rally : null
  world._wildfireStep = 0
  const us = sq.units
  let rateMul = world.rateMul
  const oc = world.passive.overclock
  if (oc !== null) {
    // 被动「超频」：场上每台机械单位给全军加一点射速
    let mech = 0
    for (let k = 0; k < MECH_KINDS.length; k++) mech += sq.counts[MECH_KINDS[k]]
    const bonus = oc.per * mech
    rateMul *= 1 + (bonus < oc.max ? bonus : oc.max)
  }
  for (let n = 0; n < us.length; n++) {
    const u = us[n]
    if (!u.alive) continue
    const def = u._def, w = def.weapon, m = mods[u._mk]
    let rate = m.rateMul * u._rateMul * rateMul
    if (rally !== null) {
      // 战地鼓舞：步兵与英雄吃大的那一档。武器代码读 u._dmgMul，所以每步在这里写回
      const foot = def.cls === 'infantry' || def.cls === 'hero'
      rate *= foot ? rally.infRate : rally.rate
      u._dmgMul = u._baseDmg * (foot ? rally.infDmg : rally.dmg)
    } else u._dmgMul = u._baseDmg
    if (overdrive) rate *= def.overdrive
    if (m.stim > 0 && (time - world.progress.stimT0) % m.stimPeriod < m.stimDur) rate *= m.stimMul
    if (surge && u.kind === 'rifle') rate *= HEROICS.heroic_rifle.surgeMul
    u._cd -= dt * rate
    if (u._cd > 0) continue
    const fn = WEAPONS[w.type]
    if (fn !== undefined && fn(world, u, def, w, m, null)) {
      u.fireT = time
      u._cd += w.interval + (w.jitter > 0 ? w.jitter * rng() : 0)
      if (u._cd < 0) u._cd = 0
    } else {
      // 没目标：错开一点再找，别让全队同一步一起扫
      u._cd = 0.04 + 0.06 * rng()
    }
  }
  tickHeroics(world, dt)
  tickZones(world)
  tickPending(world)
}
