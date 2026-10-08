// 横扫光束（「裁决」光束步行机）。对准最密的那一排，横着扫过一条带。无视护甲，克轻甲，打不了飞行目标。
import { findDense, sweepRect, sweepLater, addZone } from '../combat.js'
import { bossUp } from '../boss.js'
import { HEROICS } from '../../data/combos.js'
import { FIELD } from '../../data/waves.js'

export function fireBeam(world, u, def, w, m) {
  const range = w.range + m.rangeAdd
  const b = world.boss
  let cx, cz
  if (findDense(world, w.samples, u.z - range, u.z - 2, u.x, u.z, 0, true)) { cx = world._aim.x; cz = world._aim.z }
  else if (bossUp(b) && u.z - b.z <= range + b.radius) { cx = b.x; cz = b.z }
  else return false

  const width = Math.min(w.sweepWidth + m.widthAdd, FIELD.xEdge * 2), half = width / 2
  // 整条带留在桥面以内
  const lim = FIELD.xEdge - half
  if (cx > lim) cx = lim; else if (cx < -lim) cx = -lim
  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const dmg = w.dmg * mul, bossDmg = w.bossDmg * mul
  const x0 = cx - half, x1 = cx + half, z0 = cz - w.depth, z1 = cz + w.depth
  const rev = (u._shots & 1) === 1   // 左右来回扫
  u._shots++
  sweepRect(world, x0, x1, z0, z1, dmg, w.maxTargets, w.vsLight, w.vsHeavy, u.kind, u, null, bossDmg, m.slow, m.slowDur, false, rev, w.sweepTime)
  if (m.back > 0) {
    // 「回扫程序」：反方向再扫一遍
    sweepLater(world, m.backDelay, x0, x1, z0, z1, dmg * m.backDmg, w.maxTargets, w.vsLight, w.vsHeavy, u.kind, u, 'reaper_return', bossDmg * m.backDmg, m.slow, m.slowDur, false, !rev, w.sweepTime)
  }
  if (m.heroic > 0) {
    // 英雄级「十字裁决」：再补一道纵向光束，和横扫的带十字交叉
    const h = HEROICS.heroic_reaper
    sweepRect(world, cx - h.half, cx + h.half, cz - h.len / 2, cz + h.len / 2, dmg * h.dmgMul, w.maxTargets, w.vsLight, w.vsHeavy, u.kind, u, 'heroic_reaper', 0, m.slow, m.slowDur, true, false, w.sweepTime)
  }
  if (m.scorch > 0 && world.time >= u._zoneT) {
    // 「灼痕」：扫过的带继续烧。每台同时只留一条。
    const dur = m.scorchBase + m.scorchPer * m.scorch + m.scorchDurAdd
    // 类型仍是 fire（表现层已认识），style 'scorch' + shape 'rect' 标明是一条带；r 给不认识矩形的消费者兜底
    const zn = addZone(world, 'fire', cx, cz, half, dur, m.scorchDmg * world.modDmgMul * m.scorchDmgMul, m.scorchTick, u.kind, 'reaper_scorch', 'scorch', width, w.depth * 2)
    if (zn !== null) {
      zn._u = u
      u._zoneT = world.time + dur
    }
  }
  u.aimX = cx; u.aimZ = cz
  u.facing = Math.atan2(cx - u.x, cz - u.z)
  return true
}
