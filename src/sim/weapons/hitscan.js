// 即时命中的直射武器（突击兵）。可贯穿、可追加弹、可破片，全部由 mods 决定。
// 对空：能打，但地面有目标时先顾地面；破片和贯穿贴着地走，碰不到飞行虫。所以大波压上来时翼螫基本会漏过去。
import { nearestInCorridor, queryCircle } from '../grid.js'
import { hitEnemy, frontalMul } from '../combat.js'
import { damageBoss, bossUp } from '../boss.js'
import { ENEMY_CLS, ST_DYING, KIND_INDEX } from '../swarm.js'

const K_WING = KIND_INDEX.wing

function frag(world, u, x, z, m, skip) {
  const g = world.hash, s = world.swarm, out = g.out2
  const n = queryCircle(g, s, x, z, m.fragR * m.fragRMul, out)
  const dmg = m.fragDmg * world.modDmgMul
  let left = m.fragMax
  for (let j = 0; j < n && left > 0; j++) {
    const i = out[j]
    if (i === skip || s.y[i] > 0) continue
    hitEnemy(world, i, dmg, u.kind, u, false, 'rifle_frag', false)
    left--
  }
}

// 打出一发。ti = 目标虫下标，-1 表示打 Boss。
function shoot(world, u, w, m, ti, dmg, pierce, mod) {
  const s = world.swarm
  let tx, tz
  if (ti < 0) {
    const b = world.boss
    tx = b.x; tz = b.z
    damageBoss(world, dmg * (w.bossDmg / w.dmg), u.kind, u, mod)
  } else {
    tx = s.x[ti]; tz = s.z[ti]
    const c = ENEMY_CLS[s.kind[ti]]
    // 举盾虫：正面来的直射子弹只吃一成（破片是范围伤害，不减）
    hitEnemy(world, ti, dmg * (c === 1 ? 1 + w.vsLight : c === 2 ? 1 + w.vsHeavy : 1) * frontalMul(world, ti, u.x, u.z), u.kind, u, w.ignoreArmor, mod, false)
    if (m.frag > 0) frag(world, u, tx, tz, m, ti)
    if (pierce > 0) {
      // 沿弹道继续往后穿：目标身后 pr 米、半宽 0.5 的窄带
      const dx = tx - u.x, dz = tz - u.z, L = Math.sqrt(dx * dx + dz * dz) || 1
      const nx = dx / L, nz = dz / L
      const pr = w.pierceRange + m.pierceRange
      const g = world.hash, out = g.out
      const n = queryCircle(g, s, tx + nx * pr * 0.5, tz + nz * pr * 0.5, pr * 0.5 + 0.5, out)
      let left = pierce
      for (let j = 0; j < n && left > 0; j++) {
        const i = out[j]
        if (i === ti || s.y[i] > 0) continue
        const ex = s.x[i] - tx, ez = s.z[i] - tz
        const along = ex * nx + ez * nz
        if (along < 0 || along > pr) continue
        const perp = ex * nz - ez * nx
        if (perp > 0.5 || perp < -0.5) continue
        const px = s.x[i], pz = s.z[i]
        hitEnemy(world, i, dmg * frontalMul(world, i, u.x, u.z), u.kind, u, w.ignoreArmor, mod !== null ? mod : 'rifle_pierce', false)
        if (m.fragOnPierce > 0) frag(world, u, px, pz, m, i)
        left--
      }
    }
  }
  u.aimX = tx; u.aimZ = tz
  u.facing = Math.atan2(tx - u.x, tz - u.z)
  world.events.push({ type: 'shot', unit: u.id, kind: u.kind, x: u.x, z: u.z, tx, tz, delay: w.fxDelay })
}

// 选目标：走廊内最近的虫，或者 Boss。返回虫下标 / -1(Boss) / -2(无)
//   没有虫可打 → Boss
//   虫还远（最近的在 CLOSE 米外）→ Boss 比虫近、或 Boss 正处于易伤窗口时打 Boss
//   虫已经贴近 → 一半火力留给眼前的虫：Boss 就立在阵前时全队只盯着它，虫群会直接撞进来
const CLOSE2 = 7 * 7
function acquire(world, u, w, range) {
  const g = world.hash
  let ti = nearestInCorridor(g, world.swarm, u.x, u.z, w.corridor, range, true)
  if (ti < 0 && world.swarm.kindCount[K_WING] > 0) ti = nearestInCorridor(g, world.swarm, u.x, u.z, w.corridor, range, false)
  const b = world.boss
  if (bossUp(b)) {
    const dx = b.x - u.x, dz = b.z - u.z
    const d = Math.sqrt(dx * dx + dz * dz) - b.radius
    if (d < range) {
      if (ti < 0) return -1
      const nearer = d * d < g.lastD
      if (g.lastD > CLOSE2 ? nearer || b._vuln > 1 : nearer && (u._shots & 1) === 0) return -1
    }
  }
  return ti < 0 ? -2 : ti
}

// volley: 英雄级「钢雨」的加射参数（{dmgMul, pierce}），平时为 null
export function fireHitscan(world, u, def, w, m, volley) {
  const range = w.range + m.rangeAdd
  const ti = acquire(world, u, w, range)
  if (ti === -2) return false
  const dmg = w.dmg * world.dmgMul * m.dmgMul * u._dmgMul
  if (volley !== null) {
    shoot(world, u, w, m, ti, dmg * volley.dmgMul, volley.pierce, 'heroic_rifle')
    return true
  }
  u._shots++
  shoot(world, u, w, m, ti, dmg, m.pierce + w.pierce, null)
  if (m.doubleEvery > 0 && u._shots % m.doubleEvery === 0) {
    // 追加弹：原目标死了就重新找一个
    let t2 = ti
    if (ti >= 0 && world.swarm.state[ti] === ST_DYING) t2 = acquire(world, u, w, range)
    if (t2 !== -2) shoot(world, u, w, m, t2, dmg * m.doubleDmgMul, m.pierce + w.pierce + m.doublePierce, 'rifle_double')
  }
  return true
}
