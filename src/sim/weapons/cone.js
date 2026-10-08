// 扇形喷火（焚化兵）。无视护甲，克轻甲。
import { queryCircle } from '../grid.js'
import { hitEnemy, addZone } from '../combat.js'
import { damageBoss, bossUp } from '../boss.js'
import { ENEMY_CLS } from '../swarm.js'

const DEG = Math.PI / 180
const MAX_TURN = 55 * DEG   // 喷口最多偏离正前方这么多

export function fireCone(world, u, def, w, m) {
  const g = world.hash, s = world.swarm, out = g.out
  const range = w.range + m.rangeAdd
  const n = queryCircle(g, s, u.x, u.z, range, out)
  const b = world.boss
  let bossIn = false
  if (bossUp(b)) {
    const dx = b.x - u.x, dz = b.z - u.z, rr = range + b.radius
    bossIn = dx * dx + dz * dz <= rr * rr
  }
  if (n === 0 && !bossIn) return false

  // 朝最近的地面目标喷（火够不着天上的）
  let ax = 0, az = -1, bd = Infinity
  for (let j = 0; j < n; j++) {
    const i = out[j]
    if (s.y[i] > 0) continue
    const dx = s.x[i] - u.x, dz = s.z[i] - u.z, d = dx * dx + dz * dz
    if (d < bd) { bd = d; ax = dx; az = dz }
  }
  if (bd === Infinity) {
    if (!bossIn) return false
    ax = b.x - u.x; az = b.z - u.z
  }
  // facing = atan2(dx, dz)，正前方（-z）是 π；换算成相对正前方的偏角再夹住
  let off = Math.atan2(-ax, -az)
  if (off > MAX_TURN) off = MAX_TURN; else if (off < -MAX_TURN) off = -MAX_TURN
  const fx = -Math.sin(off), fz = -Math.cos(off)
  const half = (w.arc + m.arcAdd) * 0.5 * DEG
  const cosHalf = Math.cos(half)

  const dmg = w.dmg * world.dmgMul * m.dmgMul * u._dmgMul
  let left = w.maxTargets
  for (let j = 0; j < n && left > 0; j++) {
    const i = out[j]
    if (s.y[i] > 0) continue
    const dx = s.x[i] - u.x, dz = s.z[i] - u.z
    const d = Math.sqrt(dx * dx + dz * dz)
    // 贴脸的直接算命中，省得除零
    if (d > 0.6 && (dx * fx + dz * fz) / d < cosHalf) continue
    const c = ENEMY_CLS[s.kind[i]]
    hitEnemy(world, i, dmg * (c === 1 ? 1 + w.vsLight : c === 2 ? 1 + w.vsHeavy : 1), u.kind, u, true, null, true)
    left--
  }
  if (bossIn) {
    const dx = b.x - u.x, dz = b.z - u.z, d = Math.sqrt(dx * dx + dz * dz) || 1
    if ((dx * fx + dz * fz) / d >= cosHalf - 0.2) damageBoss(world, dmg * (w.bossDmg / w.dmg), u.kind, u, null, true)
  }
  if (m.napalm > 0 && world.time >= u._zoneT) {
    // 「粘稠燃剂」：落点留一片火。每名焚化兵同时只维持一片。
    const dur = m.napalmDur * m.napalmDurMul
    const zn = addZone(world, 'fire', u.x + fx * range * 0.65, u.z + fz * range * 0.65, m.napalmR, dur, m.napalmDmg * world.modDmgMul, m.napalmTick, u.kind, 'flamer_napalm')
    if (zn !== null) u._zoneT = world.time + dur      // 火区满了就下一口再试，别白等一个持续时间
  }
  const dir = Math.atan2(fx, fz)
  u.facing = dir
  u.aimX = u.x + fx * range; u.aimZ = u.z + fz * range
  world.events.push({ type: 'flame', unit: u.id, x: u.x, z: u.z, dir, arc: half * 2, range })
  return true
}
