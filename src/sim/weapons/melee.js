// 近身挥砍（「棱镜」伊瑟拉本人）。身前一个圆里的地面目标各挨一刀，无视护甲。
// 突刺：每 lungeCd 秒一次，沿正前方一条窄带冲出去再回来，伤害更高。虫群通常到不了她跟前，主要输出靠它。
import { queryCircle, queryRect } from '../grid.js'
import { hitEnemy } from '../combat.js'
import { damageBoss, bossUp } from '../boss.js'

export function fireMelee(world, u, def, w, m) {
  const g = world.hash, s = world.swarm, out = g.out
  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const b = world.boss, bossOk = bossUp(b)
  let hits = 0, bossHit = false, lunge = false

  if (world.time >= u._zoneT) {
    const x0 = u.x - w.lungeHalf, x1 = u.x + w.lungeHalf, z0 = u.z - w.lungeLen, z1 = u.z
    const n = queryRect(g, s, x0, x1, z0, z1, out)
    for (let j = 0; j < n; j++) {
      const i = out[j]
      if (s.y[i] > 0) continue
      hitEnemy(world, i, w.lungeDmg * mul, u.kind, u, true, null, false)
      hits++
    }
    if (bossOk && b.x + b.radius >= x0 && b.x - b.radius <= x1 && b.z + b.radius >= z0 && b.z - b.radius <= z1) {
      bossHit = true
      damageBoss(world, w.lungeBoss * mul, u.kind, u, null, true)
    }
    if (hits > 0 || bossHit) { lunge = true; u._zoneT = world.time + w.lungeCd }
  }
  if (!lunge) {
    const cz = u.z - w.reach
    const n = queryCircle(g, s, u.x, cz, w.range, out)
    let left = w.maxTargets
    for (let j = 0; j < n && left > 0; j++) {
      const i = out[j]
      if (s.y[i] > 0) continue
      hitEnemy(world, i, w.dmg * mul, u.kind, u, true, null, false)
      left--; hits++
    }
    if (bossOk) {
      const dx = b.x - u.x, dz = b.z - cz, rr = w.range + b.radius
      if (dx * dx + dz * dz <= rr * rr) { bossHit = true; damageBoss(world, w.bossDmg * mul, u.kind, u, null, true) }
    }
    if (hits === 0 && !bossHit) return false
  }
  u._shots++
  u.aimX = u.x; u.aimZ = u.z - (lunge ? w.lungeLen : w.reach)
  u.facing = Math.PI
  world.events.push({ type: 'melee', unit: u.id, kind: u.kind, x: u.x, z: u.z, r: w.range, lunge, len: lunge ? w.lungeLen : 0, w: lunge ? w.lungeHalf * 2 : 0, hits })
  return true
}
