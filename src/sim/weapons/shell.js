// 曲射范围炮（「雷锤」自行炮）与双联范围炮（「泰坦」）。
import { explode, explodeLater, findDense, addZone, dischargeAt } from '../combat.js'
import { bossUp } from '../boss.js'
import { HEROICS } from '../../data/combos.js'
import { ST_DYING, ST_BURROW, ENEMY_CLS, KIND_INDEX } from '../swarm.js'

const HEAVY_KINDS = Object.keys(KIND_INDEX).map(k => KIND_INDEX[k]).filter(k => ENEMY_CLS[k] === 2)

function bossInReach(world, u, range) {
  const b = world.boss
  if (!bossUp(b)) return false
  if (range <= 0) return true
  const dx = b.x - u.x, dz = b.z - u.z
  return dx * dx + dz * dz <= range * range
}

function shotEvent(world, u, w, tx, tz) {
  u.aimX = tx; u.aimZ = tz
  u.facing = Math.atan2(tx - u.x, tz - u.z)
  world.events.push({ type: 'shot', unit: u.id, kind: u.kind, x: u.x, z: u.z, tx, tz, delay: w.fxDelay })
}

// 自行炮：全场曲射，近身打不到。Boss 在场时一半炮弹砸 Boss，另一半照常清最密处。
export function fireShell(world, u, def, w, m) {
  const b = world.boss
  let tx, tz
  u._shots++
  if (bossInReach(world, u, 0) && b.z >= w.zMin && (u._shots & 1) === 0) { tx = b.x; tz = b.z }
  else if (findDense(world, w.samples, w.zMin, w.zMax, u.x, u.z, w.minRange, true)) { tx = world._aim.x; tz = world._aim.z }
  else if (bossInReach(world, u, 0) && b.z >= w.zMin) { tx = b.x; tz = b.z }
  else { u._shots--; return false }

  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const r = w.radius + m.radiusAdd, dmg = w.dmg * mul, maxT = w.maxTargets + m.targetsAdd
  const vsH = w.vsHeavy + m.vsHeavyAdd, bossDmg = w.bossDmg * mul
  explode(world, tx, tz, r, dmg, maxT, w.vsLight, vsH, u.kind, u, null, bossDmg, 'l')
  if (m.cluster > 0) {
    // 「子母弹」：外圈再炸几次
    const rng = world.rng.combat, a0 = rng() * 6.283
    for (let k = 0; k < m.clusterN; k++) {
      const a = a0 + k * 6.283 / m.clusterN
      explodeLater(world, 0.12 + 0.06 * k, tx + Math.sin(a) * r * 0.8, tz + Math.cos(a) * r * 0.8, m.clusterR,
        m.clusterDmg * mul * m.clusterDmgMul, 16, 0, vsH, u.kind, u, 'mortar_cluster', m.clusterDmg * mul, 's')
    }
  }
  if (m.heroic > 0) {
    // 英雄级「回响」：落点稍后再炸一次
    const h = HEROICS.heroic_mortar
    explodeLater(world, h.delay, tx, tz, r, dmg * h.dmgMul, maxT, w.vsLight, vsH, u.kind, u, 'heroic_mortar', bossDmg * h.dmgMul, 'm')
  }
  if (m.ignite > 0) addZone(world, 'fire', tx, tz, 2.1, 1.8, 1.5 * world.dmgMul, 0.3, u.kind, 'combo_fire_shell')
  if (world.mods.psion.discharge > 0) dischargeAt(world, tx, tz)
  shotEvent(world, u, w, tx, tz)
  return true
}

// 射程内最近的重甲目标，写进 world._aim
function findHeavy(world, u, range) {
  const s = world.swarm
  let any = 0
  for (const k of HEAVY_KINDS) any += s.kindCount[k]
  if (any === 0) return false
  const r2 = range * range
  let best = -1, bd = r2
  for (let i = 0; i < s.count; i++) {
    if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW || ENEMY_CLS[s.kind[i]] !== 2) continue
    const dx = s.x[i] - u.x, dz = s.z[i] - u.z, d = dx * dx + dz * dz
    if (d < bd) { bd = d; best = i }
  }
  if (best < 0) return false
  world._aim.x = s.x[best]; world._aim.z = s.z[best]
  return true
}

// 泰坦：双联范围炮。优先 Boss，其次重甲，再其次最密处。
export function fireDualShell(world, u, def, w, m) {
  const b = world.boss
  let tx, tz
  if (bossInReach(world, u, w.range + 1.6)) { tx = b.x; tz = b.z }
  else if (findHeavy(world, u, w.range) || findDense(world, w.samples, u.z - w.range, u.z, u.x, u.z, 0)) { tx = world._aim.x; tz = world._aim.z }
  else return false

  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const r = w.radius + m.radiusAdd, dmg = w.dmg * mul, bossDmg = w.bossDmg * mul
  for (let k = 0; k < w.shells; k++) {
    const ox = (k - (w.shells - 1) / 2) * w.spread
    explode(world, tx + ox, tz, r, dmg, w.maxTargets, w.vsLight, w.vsHeavy, u.kind, u, null, k === 0 ? bossDmg * w.shells : 0, 'm')
  }
  if (world.mods.psion.discharge > 0) dischargeAt(world, tx, tz)
  u._shots++
  if (m.salvo > 0 && u._shots % m.salvoEvery === 0) {
    // 「齐射协议」：每隔几轮追加一排炮弹，各自找最密处
    const extra = m.salvoShells + m.salvoAdd
    for (let k = 0; k < extra; k++) {
      if (!findDense(world, w.samples, u.z - w.range, u.z, u.x, u.z, 0)) break
      explodeLater(world, 0.1 + 0.07 * k, world._aim.x, world._aim.z, r, dmg, w.maxTargets, w.vsLight, w.vsHeavy, u.kind, u, 'titan_salvo', bossDmg, 'm')
    }
  }
  shotEvent(world, u, w, tx, tz)
  return true
}
