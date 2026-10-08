// 区域风暴（灵能者）。在最密处放一场持续风暴，每跳结算一次，无视护甲，能打飞行目标。
import { findDense, addZone } from '../combat.js'
import { bossUp } from '../boss.js'
import { HEROICS } from '../../data/combos.js'

function cast(world, u, w, m, x, z, mod) {
  const mul = world.dmgMul * m.dmgMul * u._dmgMul * m.stormDmgMul
  const r = w.radius + m.radiusAdd, dur = w.ticks * w.tickEvery
  const zn = addZone(world, 'storm', x, z, r, dur, w.dmg * mul, w.tickEvery, u.kind, mod)
  zn._max = w.maxTargets
  zn._bossDmg = w.bossDmg * mul
  zn._u = u
  if (m.heroic > 0) { zn._bolt = 1; zn._slow = HEROICS.heroic_psion.slow }
  world.events.push({ type: 'storm', x, z, r, dur, unit: u.id })
}

export function fireStorm(world, u, def, w, m) {
  const range = w.range + m.rangeAdd
  const b = world.boss
  let x, z
  if (bossUp(b) && b._vuln > 1 && u.z - b.z <= range) { x = b.x; z = b.z }
  // 虫在往前跑：落点往上游挪 lead 米，让后面的虫自己走进来
  else if (findDense(world, w.samples, u.z - range, u.z - 2, u.x, u.z, 0)) { x = world._aim.x; z = world._aim.z - w.lead }
  else if (bossUp(b) && u.z - b.z <= range + b.radius) { x = b.x; z = Math.max(b.z, u.z - range) }
  else return false
  cast(world, u, w, m, x, z, null)
  u._shots++
  if (m.twin > 0 && u._shots % m.twinEvery === 0 && findDense(world, w.samples, u.z - range, u.z - 2, u.x, u.z, 0)) {
    // 「双生风暴」：再找一处放；两场叠在一起就往旁边挪开
    let x2 = world._aim.x
    const z2 = world._aim.z, r = w.radius + m.radiusAdd
    const dx = x2 - x, dz = z2 - z
    if (dx * dx + dz * dz < r * r) x2 = x + (x > 0 ? -1 : 1) * r * 1.4
    cast(world, u, w, m, x2, z2, 'psion_twin')
  }
  u.aimX = x; u.aimZ = z
  u.facing = Math.atan2(x - u.x, z - u.z)
  return true
}
