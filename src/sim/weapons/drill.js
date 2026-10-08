// 钻机（「扳手」老猫本人的被动武器）。一道持续的光，咬住场上血最厚的目标不放，无视护甲；Boss 在场就烧 Boss。
// 目标锁定后一直烧到它死或出射程，再重新找：每 0.1 秒扫一遍全场太浪费。
import { hitEnemy } from '../combat.js'
import { damageBoss, bossUp } from '../boss.js'
import { ST_DYING, ST_BURROW } from '../swarm.js'

function biggest(world, u, r2) {
  const s = world.swarm
  let best = -1, bh = 0
  for (let i = 0; i < s.count; i++) {
    if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW) continue
    const hp = s.hpMax[i]
    if (hp <= bh) continue
    const dx = s.x[i] - u.x, dz = s.z[i] - u.z
    if (dx * dx + dz * dz > r2) continue
    bh = hp; best = i
  }
  return best
}

export function fireDrill(world, u, def, w, m) {
  const s = world.swarm
  const range = w.range + m.rangeAdd, r2 = range * range
  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const b = world.boss
  let tx, tz
  if (bossUp(b) && (b.x - u.x) * (b.x - u.x) + (b.z - u.z) * (b.z - u.z) <= (range + b.radius) * (range + b.radius)) {
    tx = b.x; tz = b.z
    damageBoss(world, w.bossDmg * mul, u.kind, u, null, true)
  } else {
    let i = u._ti
    if (i >= 0) {
      const dx = s.x[i] - u.x, dz = s.z[i] - u.z
      if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW || s.seed[i] !== u._tseed || dx * dx + dz * dz > r2) i = -1
    }
    // 每 5 次重新比一遍：场上来了更大的就换
    if (i < 0 || u._shots % 5 === 0) {
      i = biggest(world, u, r2)
      u._ti = i
      if (i < 0) return false
      u._tseed = s.seed[i]
    }
    tx = s.x[i]; tz = s.z[i]
    hitEnemy(world, i, w.dmg * mul, u.kind, u, true, null, false)
  }
  u._shots++
  u.aimX = tx; u.aimZ = tz
  u.facing = Math.atan2(tx - u.x, tz - u.z)
  // 每 3 跳报一次光束，表现层拿来续那道光
  if (u._shots % 3 === 1) world.events.push({ type: 'beam', kind: u.kind, x0: u.x, z0: u.z, x1: tx, z1: tz, dur: w.interval * 3, w: 0.3, unit: u.id })
  return true
}
