// 无人机群（「天钩」）。每架无人机各打一个目标：
//   ① 射程内的飞行虫（对空加成）→ ② 后排骚扰目标（刺脊虫 / 护巢虫 / 虫卵；有「标定」联动时改成重甲）
//   → ③ Boss → ④ 远处最密的那堆。
import { queryCircle } from '../grid.js'
import { hitEnemy, findDense } from '../combat.js'
import { damageBoss, bossUp } from '../boss.js'
import { ENEMY_CLS, ST_DYING, ST_BURROW, KIND_INDEX } from '../swarm.js'

const K_COUNT = Object.keys(KIND_INDEX).length
// 后排骚扰名单
const HARASS = new Uint8Array(K_COUNT)
for (const k of ['spitter', 'warden', 'egg']) HARASS[KIND_INDEX[k]] = 1
const MAX_PICK = 16
const picks = new Int16Array(MAX_PICK)

// 把最多 want 个目标写进 picks：pass 0 飞行，pass 1 骚扰名单 / 重甲
function collect(world, u, range, want, mark) {
  const s = world.swarm, r2 = range * range
  let n = 0
  for (let pass = 0; pass < 2 && n < want; pass++) {
    for (let i = 0; i < s.count && n < want; i++) {
      if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW) continue
      const air = s.y[i] > 0
      if (pass === 0 ? !air : air || !(mark ? ENEMY_CLS[s.kind[i]] === 2 && s.mark[i] === 0 : HARASS[s.kind[i]] === 1)) continue
      const dx = s.x[i] - u.x, dz = s.z[i] - u.z
      if (dx * dx + dz * dz > r2) continue
      picks[n++] = i
    }
  }
  return n
}

function flak(world, u, m, x, z, dmg, skip) {
  const g = world.hash, s = world.swarm, out = g.out2
  const n = queryCircle(g, s, x, z, m.flakR * m.flakRMul, out)
  let left = m.flakMax
  for (let j = 0; j < n && left > 0; j++) {
    const i = out[j]
    if (i === skip) continue
    hitEnemy(world, i, dmg, u.kind, u, false, 'skyhook_flak', false)
    left--
  }
}

export function fireDrones(world, u, def, w, m) {
  const s = world.swarm
  const range = w.range + m.rangeAdd
  const drones = Math.min(w.drones + m.dronesAdd, MAX_PICK)
  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const b = world.boss
  const bossOk = bossUp(b) && u.z - b.z <= range + b.radius
  const n = s.living > 0 ? collect(world, u, range, drones, m.mark > 0) : 0
  let fired = 0
  for (let k = 0; k < drones; k++) {
    // 无人机悬在机群前方一字排开
    const ox = u.x + (k - (drones - 1) / 2) * 0.9, oz = u.z - 1.5
    let tx, tz
    if (k < n) {
      const i = picks[k]
      tx = s.x[i]; tz = s.z[i]
      const air = s.y[i] > 0
      if (air && m.tether > 0) s.stunT[i] = world.time + m.tetherDur    // 「钩索」：拽到地面
      if (m.mark > 0) s.mark[i] = 1
      const dmg = w.dmg * mul * (air ? 1 + w.vsAir : 1)
      hitEnemy(world, i, dmg, u.kind, u, w.ignoreArmor, null, false)
      if (m.flak > 0) flak(world, u, m, tx, tz, dmg * m.flakDmg * m.flakDmgMul, i)
    } else if (bossOk) {
      tx = b.x; tz = b.z
      damageBoss(world, w.bossDmg * mul, u.kind, u, null)
    } else {
      // 没有优先目标：骚扰远处的虫堆
      if (!findDense(world, 6, u.z - range, u.z - 6, u.x, u.z, 0)) break
      tx = world._aim.x; tz = world._aim.z
      const g = world.hash, out = g.out
      const cnt = queryCircle(g, s, tx, tz, 0.8, out)
      if (cnt === 0) break
      const i = out[0]
      const dmg = w.dmg * mul * (s.y[i] > 0 ? 1 + w.vsAir : 1)
      hitEnemy(world, i, dmg, u.kind, u, w.ignoreArmor, null, false)
      if (m.flak > 0) flak(world, u, m, tx, tz, dmg * m.flakDmg * m.flakDmgMul, i)
    }
    world.events.push({ type: 'shot', unit: u.id, kind: u.kind, x: ox, z: oz, tx, tz, delay: w.fxDelay })
    u.aimX = tx; u.aimZ = tz
    fired++
  }
  if (fired === 0) return false
  u.facing = Math.atan2(u.aimX - u.x, u.aimZ - u.z)
  return true
}
