// 突变因子。数值在 data/mutators.js。
//   swift      world.mut.speedMul，director 算敌速时乘进去
//   resonance  combat.hitEnemy 里：第一次受伤没死 → 挂护盾（swarm.shield / shieldT）
//   undying    combat.hitEnemy 里：被打死时抽签 → queueRevive，到点在原地再出生一只
//   acidrain   这里定时落酸，判定口径和 Boss 的酸液一致（squad.hurtCircle）
// 战役里要等拿到第 (突变数 + 1) 个升级才一起生效；摆拍世界没有升级，开局即生效。
import { MUTATORS, MUTATOR_IDS } from '../data/mutators.js'
import { ENEMY_KINDS } from '../data/enemies.js'
import { clamp } from '../core/util.js'
import { spawn } from './swarm.js'
import { hurtCircle } from './squad.js'
import { addZone } from './combat.js'

const RING = 1024

export function createMutators(world) {
  const ids = []
  for (const id of world.opts.mutators) if (MUTATORS[id] && !ids.includes(id)) ids.push(id)
  world.opts.mutators = ids
  world.mutators = ids.map(id => ({ id, active: false, nameKey: MUTATORS[id].nameKey, descKey: MUTATORS[id].descKey }))
  world.mut = {
    armed: false, speedMul: 1, resonance: 0, resonanceDur: 0, undying: 0,
    acidT: 0, due: [],
    // 待复活队列：环形缓冲，不为每只虫分配对象
    rT: new Float32Array(RING), rX: new Float32Array(RING), rZ: new Float32Array(RING), rK: new Uint8Array(RING), rE: new Uint8Array(RING), rHead: 0, rLen: 0,
  }
  if (world.opts.sandbox && ids.length > 0) arm(world)
}

function activate(world, m) {
  const mut = world.mut, def = MUTATORS[m.id]
  m.active = true
  if (m.id === 'swift') mut.speedMul = def.speedMul
  else if (m.id === 'resonance') { mut.resonance = def.frac; mut.resonanceDur = def.dur }
  else if (m.id === 'undying') mut.undying = def.chance
  else if (m.id === 'acidrain') mut.acidT = world.time + def.first
  world.events.push({ type: 'mutator', id: m.id })
}

function arm(world) {
  world.mut.armed = true
  for (const m of world.mutators) if (!m.active) activate(world, m)
  world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.mutators' })
}

// 无尽第 2 / 5 / 8 层：再随机加一个还没有的突变，立刻生效。全都有了返回 null。
export function addRandomMutator(world) {
  const pool = MUTATOR_IDS.filter(id => !world.mutators.some(m => m.id === id))
  // 开局自选但还没等到生效条件的，进了无尽也一并生效
  if (!world.mut.armed) { world.mut.armed = true; for (const m of world.mutators) if (!m.active) activate(world, m) }
  if (pool.length === 0) return null
  const id = pool[world.rng.mut.int(pool.length)]
  const m = { id, active: false, nameKey: MUTATORS[id].nameKey, descKey: MUTATORS[id].descKey }
  world.mutators.push(m)
  activate(world, m)
  world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.mutators' })
  return id
}

// 由 hitEnemy 在击杀时调用。抽签用独立的随机流，不带偏战斗的序列。
export function queueRevive(world, i, k, x, z) {
  const mut = world.mut
  if (world.rng.mut() >= mut.undying || mut.rLen >= RING) return
  const n = (mut.rHead + mut.rLen) % RING
  mut.rT[n] = world.time + MUTATORS.undying.delay
  mut.rX[n] = x; mut.rZ[n] = z; mut.rK[n] = k; mut.rE[n] = world.swarm.elite[i]
  mut.rLen++
}

function acidRain(world, def) {
  const sq = world.squad, rng = world.rng.mut, time = world.time
  const z = sq.frontZ + def.dz
  const x0 = clamp(sq.x, -def.xMax, def.xMax)
  for (let k = 0; k < def.drops; k++) {
    let x = x0
    if (k > 0) {
      // 其余几团随机落，但和对准队伍的那团隔开一个身位：总有缝可钻
      for (let tries = 0; tries < 6; tries++) {
        x = rng.range(-def.xMax, def.xMax)
        if (Math.abs(x - x0) >= def.minGap) break
      }
      if (Math.abs(x - x0) < def.minGap) x = clamp(x0 + (x0 > 0 ? -1 : 1) * def.minGap * k, -def.xMax, def.xMax)
    }
    world.telegraphs.push({ id: world._nextId++, shape: 'circle', x, z, r: def.r, t0: time, t1: time + def.warn, team: 'enemy', style: 'acid' })
    world.mut.due.push({ x, z, t: time + def.warn })
  }
  world.events.push({ type: 'acidRain', count: def.drops, t: def.warn })
}

export function update(world, dt) {
  const mut = world.mut
  if (!mut.armed) {
    if (world.mutators.length === 0 || world.progress.upgrades < world.mutators.length + 1) return
    arm(world)
  }
  const time = world.time

  // 不死孢子：到点复活。场上满了就丢掉这一只
  while (mut.rLen > 0 && time >= mut.rT[mut.rHead]) {
    const n = mut.rHead
    mut.rHead = (n + 1) % RING
    mut.rLen--
    const i = spawn(world, mut.rK[n], mut.rX[n], mut.rZ[n], 0, mut.rE[n] === 1)
    if (i < 0) continue
    world.swarm.flags[i] |= 2
    world.events.push({ type: 'revive', i, kind: ENEMY_KINDS[mut.rK[n]], x: mut.rX[n], z: mut.rZ[n] })
  }

  if (mut.acidT > 0) {
    const def = MUTATORS.acidrain
    if (time >= mut.acidT) { mut.acidT += def.every; acidRain(world, def) }
    const due = mut.due
    for (let n = 0; n < due.length;) {
      const d = due[n]
      if (time < d.t) { n++; continue }
      due.splice(n, 1)
      const hits = hurtCircle(world, d.x, d.z, def.r, def.dmg, 'acidrain')
      world.events.push({ type: 'explosion', x: d.x, z: d.z, r: def.r, size: 'm', kind: 'acid' })
      world.events.push({ type: 'acidHit', x: d.x, z: d.z, hits: hits < 0 ? 0 : hits, dodged: hits < 0 })
      const zn = addZone(world, 'acid', d.x, d.z, def.r, def.pool, 0, def.tick, 'boss', null)
      zn.team = 'enemy'
      zn._udmg = def.tickDmg
    }
  }
}
