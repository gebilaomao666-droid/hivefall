// Boss 状态机。三种 AI（数据见 data/bosses.js）：
//   ravager   走近 → 横扫；定时冲锋（预警带 → 冲过车道 → 躲开则撞墙眩晕）；残血后冲得更勤
//   matriarch 停在远端；吐酸（预警圈 → 落地伤害 → 酸池）；产卵（swarm 里的 egg）
//   leviathan 潜地（打不到）→ 预警圈 → 破土伤害 → 暴露弱点并吐刺（车道预警）→ 再潜地
// 预警判定统一走 squad.js 的 hurtCircle / hurtLane：队伍中心离开形状 = 躲开。
import { BOSSES, HARDEN } from '../data/bosses.js'
import { damageUnit, hurtCircle, hurtLane } from './squad.js'
import { clamp } from '../core/util.js'
import { MIN_ARMOR_HIT } from '../data/enemies.js'
import { POWER, DEVICE, DEVICE_AA, UNITS } from '../data/units.js'
import { spawn, KIND_INDEX } from './swarm.js'
import { addZone } from './combat.js'
import { damageDevice, destroyDevice } from './devices.js'
import { CRUSH_PAD } from '../data/devices.js'

const BOSS_BIG = { gap: 0.7, ahead: 0.8 }
const FACE_PLAYER = 0   // facing = atan2(dx, dz)，朝 +z（玩家方向）

// Boss 在场且打得到（没死、没潜地）
export const bossUp = b => b !== null && b.state !== 'dying' && b.state !== 'burrowed'

// hpMul: 无尽里 Boss 的血量另有一条曲线（4400 × 1.3^n），不吃每层的敌血系数
export function spawnBoss(world, kind, hpMul = world.diff.bossHpMul ?? world.diff.hpMul, base = BOSSES[kind].hp) {
  const def = BOSSES[kind]
  const hp = base * hpMul
  const b = {
    kind, x: 0, z: world.phase === 'endless' ? (def.spawnZEndless ?? def.spawnZ) : def.spawnZ, hp, hpMax: hp, state: 'walk', stateT: world.time, facing: FACE_PLAYER, telegraphs: [],
    radius: def.radius,
    phase: 0,              // 第几阶段（0 = 出场；每过一个 phases[k].at 阈值 +1）
    hardened: false,       // 甲壳硬化中（正面伤害 × HARDEN.mul）
    enraged: false,        // 狂暴中
    _def: def, _vuln: 1, _hardenUntil: 0, _phaseDue: false, _bigT: -9,
    // ravager
    _chargeT: 0, _sweepT: 0, _laneX: 0, _hitDone: false, _dodged: false, _swung: false,
    // matriarch
    _acidT: 0, _eggT: 0, _cast: null,
    // leviathan
    _phaseT: 0, _warned: false, _spineIdx: 0, _expDmg: 0,
    // 已经亮了预警、到点才结算的攻击：{ shape: 'circle'|'lane', x, z, t }
    _due: [],
  }
  if (def.ai === 'ravager') { b._chargeT = world.phase === 'endless' ? (def.charge.firstEndless ?? def.charge.first) : def.charge.first; b._sweepT = def.sweep.cd }   // 无尽一层只有 30 秒：首次冲锋用 firstEndless（修复第 2 轮）
  else if (def.ai === 'leviathan') { b.state = 'burrowed'; b._phaseT = def.burrow.first }
  else if (def.ai === 'matriarch') { b._acidT = def.acid.first; b._eggT = def.eggs.first }
  world.boss = b
  world.events.push({ type: 'bossSpawn', kind, x: b.x, z: b.z, hp })
  world.events.push({ type: 'comms', speaker: 'ops', textKey: def.commsKey })
}

function setState(world, b, state) {
  b.state = state
  b.stateT = world.time
}

function telegraph(world, b, tg) {
  tg.id = world._nextId++
  tg.t0 = world.time
  tg.team = 'enemy'
  world.telegraphs.push(tg)
  b.telegraphs.push(tg)
  return tg
}

// 甲壳硬化挡不住的伤害：技能、迫击炮台、破甲兵种（anti_heavy / anti_boss），以及从侧面打过来的
const PIERCE = Object.fromEntries(Object.keys(UNITS).map(k => [k, UNITS[k].tags.includes('anti_heavy') || UNITS[k].tags.includes('anti_boss')]))
function pierces(b, kind, u, mod) {
  if (kind === POWER) return true
  if (kind === DEVICE || kind === DEVICE_AA) return mod === 'mortarpit'
  if (PIERCE[kind] === true) return true
  return u !== null && u !== undefined && Math.abs(u.x - b.x) >= HARDEN.sideX
}

// mod: 归属模块 id 或 null。护甲规则和小怪一致：减法，每次命中至少 0.5；持续类武器传 ignoreArmor。
// 易伤窗口（眩晕 / 暴露弱点）按 b._vuln 放大。潜地时打不到。
export function damageBoss(world, dmg, kind, u, mod, ignoreArmor = false) {
  const b = world.boss
  if (!bossUp(b)) return
  if (!ignoreArmor) { const red = dmg - b._def.armor, floor = dmg < MIN_ARMOR_HIT ? dmg : MIN_ARMOR_HIT; dmg = red > floor ? red : floor }
  dmg *= b._vuln
  if (b.hardened && !pierces(b, kind, u, mod)) dmg *= HARDEN.mul
  let dealt = dmg < b.hp ? dmg : b.hp
  // 阶段阈值：这一下最多打到阈值为止，下一步进入新阶段（world.step 里的 updateBoss 处理）
  const ph = b._def.phases
  if (ph && b.hardened) {
    // 甲壳硬化期间跳不过下一个阶段阈值（最后一个阶段里则打不死，留 HARDEN.floor）：
    // 火力再猛，每个阶段也至少撑满一次硬化——Boss 战的长度有了下限（第 3 轮：霍克那局碾压者 14 秒就倒）
    const floor = (b.phase < ph.length ? ph[b.phase].at : HARDEN.floor) * b.hpMax
    if (b.hp - dealt <= floor) dealt = b.hp > floor ? b.hp - floor : 0
  } else if (ph && b.phase < ph.length) {
    const floor = ph[b.phase].at * b.hpMax
    if (b.hp - dealt <= floor) { dealt = b.hp > floor ? b.hp - floor : 0; b._phaseDue = true }
  }
  const st = world.stats
  if (kind === POWER) {                                // 指挥官技能 / 伙伴：mod 是技能 id
    st.dmgByPower[mod] += dealt
    st.bossDmgByPower[mod] = (st.bossDmgByPower[mod] || 0) + dealt
  } else if (kind === DEVICE || kind === DEVICE_AA) {   // 装置：mod 是装置 kind
    st.dmgByDevice[mod] += dealt
    st.bossDmgByDevice[mod] = (st.bossDmgByDevice[mod] || 0) + dealt
  } else {
    st.dmgByUnit[kind] += dealt
    st.bossDmgByUnit[kind] = (st.bossDmgByUnit[kind] || 0) + dealt
    if (mod !== null) st.dmgByModule[mod] = (st.dmgByModule[mod] || 0) + dealt
    if (u !== null) u.dmg += dealt
  }
  b.hp -= dealt
  b._expDmg += dealt
  // Boss 受击每步合并成一条，别让表现层被几百条小伤害淹没
  world._bossHitStep += dealt
  // 大伤害飘字：至多 BOSS_BIG.gap 秒一个，钉在 Boss 身前（朝玩家一侧）而不是背上——第 2 轮测试：背上老压着 85 / 153，盖住轮廓
  if (dmg >= 40 && dealt > 0 && (kind === POWER || world.time - b._bigT >= BOSS_BIG.gap)) {   // 技能的大数字不节流
    b._bigT = world.time
    world.events.push({ type: 'bigHit', x: b.x, z: b.z + b.radius + BOSS_BIG.ahead, dmg: dealt, boss: true })
  }
  if (b.hp <= 0) {
    b.hp = 0
    setState(world, b, 'dying')
    for (const tg of b.telegraphs) tg.t1 = world.time
    b.telegraphs.length = 0
    b._due.length = 0
    st.kills++
    st._stepKills++
    if (kind === POWER) st.killsByPower[mod] = (st.killsByPower[mod] || 0) + 1
    else if (kind === DEVICE || kind === DEVICE_AA) st.killsByDevice[mod]++
    else st.killsByUnit[kind] = (st.killsByUnit[kind] || 0) + 1
    st.bossKills++
    if (world.phase !== 'endless') world._endTime = world.time      // 无尽里 Boss 倒下不是终点
    world._bulletReal = 0
    world.timeScale = b._def.death.scale
    // 冲击波：在场活虫全部进入眩晕（state=4），world.step 在 Boss dying 期间不再推进虫群
    const s = world.swarm
    for (let i = 0; i < s.count; i++) {
      // 潜地的掘地虫（state=3）不震：它在地下，醒来时不能变成「地下的行走虫」
      if (s.alive[i] === 1 && s.state[i] !== 2 && s.state[i] !== 3) { s.state[i] = 4; s.stateT[i] = world.time; s.vz[i] = 0 }
    }
    world.events.push({ type: 'bossDie', kind: b.kind, x: b.x, z: b.z })
    world.events.push({ type: 'hitstop', ms: 70 })
    world.events.push({ type: 'shake', amp: 0.34 })
  }
}

// ---------------------------------------------------------------- 阶段

function enterPhase(world, b, def) {
  const p = def.phases[b.phase], time = world.time, rng = world.rng.spawn
  b.phase++
  b._phaseDue = false
  // 召唤护卫：在 Boss 身后（远离队伍一侧）散开，随后照常压上来
  let count = 0
  const zc = Math.min(b.z - HARDEN.dz, 0)
  for (const kind in p.summon) {
    const k = KIND_INDEX[kind], n = p.summon[kind]
    for (let j = 0; j < n; j++) {
      const x = clamp(b.x + rng.tri() * HARDEN.spread * (kind === 'ling' ? 1.8 : 1), -6, 6), z = zc - rng() * HARDEN.dz
      if (spawn(world, k, x, z) >= 0) count++
    }
  }
  // 无尽里一层只有 30 秒、Boss 和整层的虫一起压上来：硬化按 HARDEN.endlessMul 缩短（第 3 轮：战役的 6.5 秒照搬，第 9 层的碾压者一局都打不倒）
  const hd = world.phase === 'endless' ? (p.hardenEndless ?? p.harden * HARDEN.endlessMul) : p.harden   // hardenEndless：战役硬化调长了、无尽不跟着拖（修复第 2 轮）
  if (hd > 0) {
    b._hardenUntil = time + hd
    b.hardened = true
    world.events.push({ type: 'bossAttack', kind: 'harden', x: b.x, z: b.z, t: hd })
  }
  world.events.push({ type: 'bossAttack', kind: 'summon', x: b.x, z: b.z, count })
  if (p.enrage && !b.enraged) {
    b.enraged = true
    world.events.push({ type: 'bossAttack', kind: 'enrage', x: b.x, z: b.z })
    if (def.ai === 'ravager' && b._chargeT > 1.2) b._chargeT = 1.2
  }
  world.events.push({ type: 'bossPhase', kind: b.kind, phase: b.phase, x: b.x, z: b.z, hp: b.hp, hpMax: b.hpMax, harden: hd, enraged: b.enraged, count, textKey: `boss.phase.${b.phase}` })
  world.events.push({ type: 'comms', speaker: 'ops', textKey: `comms.boss_phase${b.phase}` })
  world.events.push({ type: 'shake', amp: 0.2 })
}

// ---------------------------------------------------------------- 碾压者

function sweep(world, b, def) {
  const sw = def.sweep, us = world.squad.units
  // 取横向够得着的人里最近的几个
  const picks = []
  for (let n = 0; n < us.length; n++) {
    const u = us[n]
    if (!u.alive) continue
    const dx = u.x - b.x, dz = u.z - b.z
    if (dx > sw.reach || dx < -sw.reach || dz > sw.depth || dz < -2) continue
    picks.push(u)
    u._d = dx * dx + dz * dz
  }
  picks.sort((p, q) => p._d - q._d || p.id - q.id)
  const n = Math.min(scaledTargets(world, sw.targets, sw.share), picks.length)
  for (let k = 0; k < n; k++) damageUnit(world, picks[k], sw.dmg * world.diff.dmgMul, 'boss_sweep')
  world.events.push({ type: 'bossAttack', kind: 'sweep', x: b.x, z: b.z, hits: n })
  if (n > 0) world.events.push({ type: 'shake', amp: 0.12 })
}

// 横扫 / 冲锋一下最多伤几个人：上限 max，但不超过在场人数的 share（至少 2 个）——队伍打残了以后不会被一两下扫光，
// 挂机的小队是一截一截地掉，而不是 Boss 战后半段突然团灭（第 1 轮测试调平衡时加的）
function scaledTargets(world, max, share) {
  let alive = 0
  for (const u of world.squad.units) if (u.alive) alive++
  const n = Math.ceil(alive * share)
  return n < 2 ? 2 : n < max ? n : max
}

// 冲锋撞人：和 hurtLane 同一个躲避口径（队伍中心出了车道 = 躲开，返回 -1），
// 但只撞得到车道里最靠前的 max 个人——撞上了是「掉一截兵」，不是整列蒸发
function chargeHit(world, x, half, dmg, max) {
  const sq = world.squad
  if (Math.abs(sq.x - x) >= half) return -1
  const picks = []
  for (const u of sq.units) if (u.alive && Math.abs(u.x - x) <= half) picks.push(u)
  picks.sort((p, q) => p.z - q.z || p.id - q.id)
  const n = Math.min(scaledTargets(world, max, world.boss._def.charge.share), picks.length)
  for (let k = 0; k < n; k++) damageUnit(world, picks[k], dmg, 'boss_charge')
  return n
}

const _crushed = []
// 冲锋这一步（z0 → b.z）扫过的装置。被路障顶停返回 true（Boss 已进入眩晕）
function chargeDevices(world, b, ch, z0) {
  // stop：停在路障跟前、刚好碾不到它的距离（devices.js 每步碾碎 Boss 身边 radius + CRUSH_PAD 以内的装置）
  const half = ch.width / 2 + ch.deviceReach, front = world.squad.frontZ - 1, stop = b.radius + CRUSH_PAD + 0.1
  let wall = null
  const crushed = _crushed
  crushed.length = 0
  for (const d of world.devices) {
    if (!d.alive || !d._def.blocks || Math.abs(d.x - b._laneX) > half) continue
    const face = d.z - stop
    if (face < z0 - 0.01 || face > b.z || d.z > front) continue
    if (d.kind === 'barricade' && d.hp > ch.deviceDmg) { if (wall === null || d.z < wall.z) wall = d }
    else crushed.push(d)
  }
  // 顶停的那一下之前的才碾得到（destroyDevice 会从 world.devices 里摘掉，所以先收集再动手）
  for (const d of crushed) if (wall === null || d.z < wall.z) destroyDevice(world, d, 'boss')
  crushed.length = 0
  if (wall === null) return false
  b.z = wall.z - stop
  b._hitDone = true
  b._chargeT = b.enraged ? b._def.enrage.every : ch.every
  damageDevice(world, wall, ch.deviceDmg, 'boss')
  setState(world, b, 'stunned')
  b._vuln = ch.stunDmgMul
  world.events.push({ type: 'bossAttack', kind: 'crash', x: b.x, z: b.z, line: 0, device: wall.id })
  world.events.push({ type: 'bossStun', x: b.x, z: b.z, dur: ch.stun })
  world.events.push({ type: 'shake', amp: 0.22 })
  return true
}

function ravager(world, b, def, dt) {
  const ch = def.charge, sq = world.squad, time = world.time
  const since = time - b.stateT

  switch (b.state) {
    case 'walk': {
      if (b.z < def.holdZ) b.z = Math.min(def.holdZ, b.z + def.speed * dt)
      else if (b.z > def.holdZ) b.z = Math.max(def.holdZ, b.z - def.retreatSpeed * dt)
      // 左右摇摆着压过来
      const sx = Math.sin(time * def.sway.freq) * def.sway.amp
      b.x += clamp(sx - b.x, -3 * dt, 3 * dt)
      b._chargeT -= dt
      b._sweepT -= dt
      if (b._chargeT <= 0) {
        b._laneX = clamp(sq.x, -4.3, 4.3)
        b._hitDone = false
        telegraph(world, b, { shape: 'lane', x: b._laneX, z: (b.z + ch.endZ) / 2, w: ch.width, z0: b.z, z1: ch.endZ, t1: time + ch.windup, style: 'charge' })
        setState(world, b, 'charge_windup')
        world.events.push({ type: 'bossAttack', kind: 'charge_windup', x: b._laneX, z: b.z, t: ch.windup, w: ch.width })
      } else if (b.z >= def.holdZ - 0.01 && b._sweepT <= 0) {
        b._sweepT = b.enraged ? def.enrage.sweepCd : def.sweep.cd
        b._swung = false
        // 横扫躲不开，预警圈只是给表现层画的
        telegraph(world, b, { shape: 'circle', x: b.x, z: b.z + def.sweep.depth / 2, r: def.sweep.reach, t1: time + def.sweep.windup, style: 'sweep' })
        setState(world, b, 'attack')
      }
      break
    }
    case 'attack': {
      b._chargeT -= dt
      if (!b._swung && since >= def.sweep.windup) { b._swung = true; sweep(world, b, def) }
      if (since >= def.sweep.dur) setState(world, b, 'walk')
      break
    }
    case 'charge_windup': {
      // 蓄力时对准车道
      b.x += (b._laneX - b.x) * 0.15
      if (since >= ch.windup) {
        b.x = b._laneX
        setState(world, b, 'charge')
        world.events.push({ type: 'bossAttack', kind: 'charge', x: b.x, z: b.z })
      }
      break
    }
    case 'charge': {
      const z0 = b.z
      b.z += ch.speed * dt
      // 冲锋路上的装置（第 3 轮）：合金路障扛得住就把它顶停——Boss 撞墙眩晕，人和防线都没事，路障掉 deviceDmg；
      // 别的装置（塔、采集器、扛不住这一下的路障）直接碾碎，冲锋接着往前。「只布防不走位」的打法靠它对付冲锋
      if (!b._hitDone && world.devices.length > 0 && chargeDevices(world, b, ch, z0)) break
      if (!b._hitDone && b.z >= sq.frontZ - 1) {
        b._hitDone = true
        // 队伍中心出了预警带就算躲开：没人受伤，Boss 一头撞上路障
        const hits = chargeHit(world, b._laneX, ch.width / 2, ch.dmg * world.diff.dmgMul, ch.maxTargets)
        b._dodged = hits < 0
        if (!b._dodged) {
          world.events.push({ type: 'bossAttack', kind: 'charge_hit', x: b.x, z: b.z, hits })
          world.events.push({ type: 'hitstop', ms: 50 })
          world.events.push({ type: 'shake', amp: 0.3 })
        }
      }
      if (b.z >= ch.endZ) {
        b.z = ch.endZ
        b._chargeT = b.enraged ? def.enrage.every : ch.every
        if (b._dodged) {
          setState(world, b, 'stunned')
          b._vuln = ch.stunDmgMul
          // 躲开了，Boss 一头撞在防线的路障上：人没事，防线挨一下
          // 无尽里 Boss 战拖得长、碾压者每三层来一次，用一份更轻的（第 3 轮：战役 95 照搬过去，深层防线被它一个人撞穿）
          // 按防线上限折算（数值是对 1000 点防线说的）：老兵难度防线只有 700，照扣 95 点一局要被撞掉八成
          // 测试：伊瑟拉局 Boss 每撞一次扣防线约 150（115 × 指挥官威胁 1.35），防线掉到 47%，偏陡。
          // 单次撞线的指挥官加码封顶 crashLineMulCap（1.15）：标准小队 104、指挥官局 120（漏网扣线照旧吃满 lineMul）
          const line = Math.round((world.phase === 'endless' ? ch.crashLineEndless : ch.crashLine) * world.line.hpMax / 1000 * Math.min(world.diff.lineMul, ch.crashLineMulCap ?? Infinity))
          world.line.hp = Math.max(1, world.line.hp - line)
          world.events.push({ type: 'bossAttack', kind: 'crash', x: b.x, z: b.z, line })
          world.events.push({ type: 'bossStun', x: b.x, z: b.z, dur: ch.stun })
          world.events.push({ type: 'shake', amp: 0.22 })
        } else setState(world, b, 'walk')
      }
      break
    }
    case 'stunned': {
      if (since >= ch.stun) { b._vuln = 1; setState(world, b, 'walk') }
      break
    }
  }
}

// ---------------------------------------------------------------- 巢母

// 三团酸液：一团砸队伍当前位置，左右各一团。两团之间留一条缝，站进缝里或走到外侧都算躲开。
function spitAcid(world, b, def) {
  const a = def.acid, sq = world.squad, rng = world.rng.spawn, time = world.time
  const z = sq.frontZ + a.dz
  for (let k = 0; k < a.globs; k++) {
    let x = sq.x
    if (k > 0) x += (k % 2 === 1 ? 1 : -1) * (a.offset[0] + (a.offset[1] - a.offset[0]) * rng()) * ((k + 1) >> 1)
    x = clamp(x, -a.xMax, a.xMax)
    telegraph(world, b, { shape: 'circle', x, z, r: a.r, t1: time + a.warn, style: 'acid' })
    b._due.push({ shape: 'circle', x, z, t: time + a.warn })
    world.events.push({ type: 'spit', x: b.x, z: b.z, tx: x, tz: z, t: a.warn })
  }
  world.events.push({ type: 'bossAttack', kind: 'acid', x: b.x, z: b.z, count: a.globs, t: a.warn })
}

function acidLand(world, b, def, d) {
  const a = def.acid
  const hits = hurtCircle(world, d.x, d.z, a.r, a.dmg * world.diff.dmgMul, 'boss_acid')
  world.events.push({ type: 'explosion', x: d.x, z: d.z, r: a.r, size: 'm', kind: 'acid' })
  world.events.push({ type: 'bossAttack', kind: 'acid_hit', x: d.x, z: d.z, hits: hits < 0 ? 0 : hits, dodged: hits < 0 })
  // 酸池：继续按同一口径每跳结算
  const zn = addZone(world, 'acid', d.x, d.z, a.r, a.pool, 0, a.tick, 'boss', null)
  zn.team = 'enemy'
  zn._udmg = a.tickDmg * world.diff.dmgMul
}

function layEggs(world, b, def) {
  const e = def.eggs, rng = world.rng.spawn
  let count = 0
  for (let k = 0; k < e.count; k++) {
    const x = rng.range(-e.x, e.x), z = b.z + rng.range(e.z[0], e.z[1])
    if (spawn(world, KIND_INDEX.egg, x, z) >= 0) count++
  }
  world.events.push({ type: 'bossAttack', kind: 'lay', x: b.x, z: b.z, count })
}

function matriarch(world, b, def, dt) {
  const time = world.time, since = time - b.stateT
  switch (b.state) {
    // 她是远程施法者：吐酸 / 产卵的计时从出场就走，边走边放（停下来放，放完接着走）。
    // 不然走到位要五六秒，火力够的队伍在她放出第一团酸之前就把她打死了，什么机制都看不到。
    case 'walk':
    case 'idle': {
      if (b.z < def.holdZ) {
        b.z = Math.min(def.holdZ, b.z + def.speed * dt)
        if (b.z >= def.holdZ) setState(world, b, 'idle')
      } else {
        const sx = Math.sin(time * def.sway.freq) * def.sway.amp
        b.x += clamp(sx - b.x, -2 * dt, 2 * dt)
      }
      b._acidT -= dt
      b._eggT -= dt
      if (b._acidT <= 0) { b._acidT += b.enraged ? def.enrage.acidEvery : def.acid.every; b._cast = 'acid' }
      else if (b._eggT <= 0) { b._eggT += b.enraged ? def.enrage.eggsEvery : def.eggs.every; b._cast = 'lay' }
      else break
      b._swung = false
      setState(world, b, 'attack')
      break
    }
    case 'attack': {
      b._acidT -= dt
      b._eggT -= dt
      if (!b._swung && since >= def.cast * 0.5) {
        b._swung = true
        if (b._cast === 'acid') spitAcid(world, b, def)
        else layEggs(world, b, def)
      }
      if (since >= def.cast) setState(world, b, b.z < def.holdZ ? 'walk' : 'idle')
      break
    }
  }
}

// ---------------------------------------------------------------- 渊噬蠕虫

function leviathan(world, b, def, dt) {
  const bw = def.burrow, sp = def.spines, sq = world.squad, time = world.time
  const since = time - b.stateT
  switch (b.state) {
    case 'burrowed': {
      b._phaseT -= dt
      if (b._phaseT > 0) break
      if (!b._warned) {
        // 锁定队伍当前 x，亮预警圈
        b._warned = true
        b._phaseT = bw.warn
        b.x = clamp(sq.x, -bw.xMax, bw.xMax)
        b.z = sq.frontZ - bw.ahead
        telegraph(world, b, { shape: 'circle', x: b.x, z: b.z, r: bw.r, t1: time + bw.warn, style: 'emerge' })
        world.events.push({ type: 'bossAttack', kind: 'emerge_windup', x: b.x, z: b.z, r: bw.r, t: bw.warn })
        break
      }
      setState(world, b, 'emerging')
      b._vuln = bw.vuln
      b._spineIdx = 0
      b._expDmg = 0
      const hits = hurtCircle(world, b.x, b.z, bw.r, bw.dmg * world.diff.dmgMul, 'boss_emerge')
      world.events.push({ type: 'emerge', x: b.x, z: b.z, r: bw.r, hits: hits < 0 ? 0 : hits, dodged: hits < 0 })
      world.events.push({ type: 'bossAttack', kind: 'emerge', x: b.x, z: b.z, hits: hits < 0 ? 0 : hits, dodged: hits < 0 })
      world.events.push({ type: 'shake', amp: 0.26 })
      if (hits > 0) world.events.push({ type: 'hitstop', ms: 40 })
      break
    }
    case 'emerging': {
      if (since >= bw.rise) setState(world, b, 'attack')
      break
    }
    case 'attack': {
      // 暴露期间吐刺：沿队伍当前 x 的一条车道
      const at = b.enraged ? def.enrage.spinesAt : sp.at
      while (b._spineIdx < at.length && since >= at[b._spineIdx]) {
        b._spineIdx++
        const x = clamp(sq.x, -4.3, 4.3)
        telegraph(world, b, { shape: 'lane', x, z: (b.z + sp.endZ) / 2, w: sp.width, z0: b.z, z1: sp.endZ, t1: time + sp.warn, style: 'spines' })
        b._due.push({ shape: 'lane', x, z: b.z, t: time + sp.warn })
        world.events.push({ type: 'bossAttack', kind: 'spines_windup', x, z: b.z, t: sp.warn, w: sp.width })
      }
      // 一次露头挨得太狠（掉血超过 flinch × 最大生命）就提前缩回去：火力再猛也得等它第二次破土
      if (since >= bw.exposed || b._expDmg >= b.hpMax * bw.flinch) {
        b._vuln = 1
        b._warned = false
        b._phaseT = bw.hide
        setState(world, b, 'burrowed')
        world.events.push({ type: 'bossAttack', kind: 'burrow', x: b.x, z: b.z })
      }
      break
    }
  }
}

function spinesLand(world, b, def, d) {
  const sp = def.spines
  const hits = hurtLane(world, d.x, sp.width / 2, sp.dmg * world.diff.dmgMul, 'boss_spines')
  world.events.push({ type: 'bossAttack', kind: 'spines', x: d.x, z: d.z, w: sp.width, hits: hits < 0 ? 0 : hits, dodged: hits < 0 })
  if (hits > 0) world.events.push({ type: 'shake', amp: 0.14 })
}

const AI = { ravager, matriarch, leviathan }

export function update(world, dt) {
  const b = world.boss
  if (b === null) return
  if (world._bossHitStep > 0) {
    world.events.push({ type: 'bossHit', x: b.x, z: b.z, dmg: world._bossHitStep, hp: b.hp })
    world._bossHitStep = 0
  }
  if (b.state === 'dying') return
  const def = b._def, time = world.time
  if (b.hardened && time >= b._hardenUntil) {
    b.hardened = false
    world.events.push({ type: 'bossAttack', kind: 'harden_end', x: b.x, z: b.z })
  }
  if (b._phaseDue) enterPhase(world, b, def)

  // 过期的预警从 boss.telegraphs 里摘掉（world.telegraphs 由 world.step 统一清）
  const tgs = b.telegraphs
  if (tgs.length > 0) {
    let w = 0
    for (let n = 0; n < tgs.length; n++) if (time < tgs[n].t1) tgs[w++] = tgs[n]
    tgs.length = w
  }
  // 到点结算的预警攻击
  const due = b._due
  for (let n = 0; n < due.length;) {
    const d = due[n]
    if (time < d.t) { n++; continue }
    due.splice(n, 1)
    if (d.shape === 'circle') acidLand(world, b, def, d)
    else spinesLand(world, b, def, d)
  }

  AI[def.ai](world, b, def, dt)
}
