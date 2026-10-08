// 单体破甲炮（「破城」轨道炮）。优先级：Boss > 护巢虫 > 血最厚的重甲 > 最近的地面目标。
// 打死目标后，溢出的伤害跳到旁边的虫身上，最多跳 jumps 次。打不了飞行目标。
import { nearestInCorridor, queryCircle } from '../grid.js'
import { hitEnemy, frontalMul } from '../combat.js'
import { damageBoss, bossUp } from '../boss.js'
import { ENEMY_CLS, ST_DYING, ST_BURROW, KIND_INDEX } from '../swarm.js'

const HEAVY_KINDS = Object.keys(KIND_INDEX).map(k => KIND_INDEX[k]).filter(k => ENEMY_CLS[k] === 2)
const K_WARDEN = KIND_INDEX.warden
const MIN_OVERFLOW = 0.3

// 返回虫下标，没有返回 -1
function pickTarget(world, u, range) {
  const s = world.swarm
  let heavies = 0
  for (const k of HEAVY_KINDS) heavies += s.kindCount[k]
  if (heavies > 0) {
    const r2 = range * range
    let best = -1, bs = -1
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] === 0 || s.state[i] === ST_DYING || s.state[i] === ST_BURROW || ENEMY_CLS[s.kind[i]] !== 2) continue
      const dx = s.x[i] - u.x, dz = s.z[i] - u.z
      if (dx * dx + dz * dz > r2) continue
      const score = s.hp[i] + (s.kind[i] === K_WARDEN ? 1e6 : 0)
      if (score > bs) { bs = score; best = i }
    }
    if (best >= 0) return best
  }
  return nearestInCorridor(world.hash, s, u.x, u.z, 7, range, true)
}

// 目标死了就把剩下的伤害带给 jumpRange 内最近的另一只地面虫
function shotAt(world, u, w, ti, dmg, vsHeavy, jumps, mod) {
  const s = world.swarm, g = world.hash, out = g.out2
  const tx = s.x[ti], tz = s.z[ti]
  // 举盾虫正面吃直射只有一成（只算直接命中的这一只；溢出跳过去的不算直射）
  let cur = ti, left = dmg * (ENEMY_CLS[s.kind[ti]] === 2 ? 1 + vsHeavy : 1) * frontalMul(world, ti, u.x, u.z)
  let points = null
  for (;;) {
    const hp = s.hp[cur], cx = s.x[cur], cz = s.z[cur]
    if (!hitEnemy(world, cur, left, u.kind, u, w.ignoreArmor, mod, false)) break
    left -= hp
    if (left < MIN_OVERFLOW || jumps-- <= 0) break
    const n = queryCircle(g, s, cx, cz, w.jumpRange, out)
    let next = -1, bd = Infinity
    for (let j = 0; j < n; j++) {
      const i = out[j]
      if (i === cur || s.y[i] > 0) continue
      const dx = s.x[i] - cx, dz = s.z[i] - cz, d = dx * dx + dz * dz
      if (d < bd) { bd = d; next = i }
    }
    if (next < 0) break
    if (points === null) points = [{ x: cx, z: cz }]
    points.push({ x: s.x[next], z: s.z[next] })
    cur = next
  }
  if (points !== null) world.events.push({ type: 'chain', points, kind: mod !== null ? mod : u.kind })
  u.aimX = tx; u.aimZ = tz
  world.events.push({ type: 'shot', unit: u.id, kind: u.kind, x: u.x, z: u.z, tx, tz, delay: w.fxDelay })
}

export function fireLock(world, u, def, w, m) {
  const range = w.range + m.rangeAdd
  const mul = world.dmgMul * m.dmgMul * u._dmgMul
  const b = world.boss
  let shots = w.shells
  // 「复射线圈」：每隔几轮多打几发
  const echo = m.echo > 0 && (u._shots + 1) % m.echoEvery === 0
  if (echo) shots += m.echoShots + m.echoAdd
  let fired = 0, ti = -1
  for (let k = 0; k < shots; k++) {
    const mod = echo && k >= w.shells ? 'lancer_echo' : null
    if (bossUp(b)) {
      const dx = b.x - u.x, dz = b.z - u.z, rr = range + b.radius
      if (dx * dx + dz * dz <= rr * rr) {
        damageBoss(world, w.bossDmg * mul * m.bossMul, u.kind, u, mod)
        u.aimX = b.x; u.aimZ = b.z
        world.events.push({ type: 'shot', unit: u.id, kind: u.kind, x: u.x, z: u.z, tx: b.x, tz: b.z, delay: w.fxDelay })
        fired++
        continue
      }
    }
    if (ti < 0 || world.swarm.state[ti] === ST_DYING) ti = pickTarget(world, u, range)
    if (ti < 0) break
    shotAt(world, u, w, ti, w.dmg * mul, w.vsHeavy + m.vsHeavyAdd, w.jumps + m.jumpsAdd, mod)
    fired++
  }
  if (fired === 0) return false
  u._shots++
  u.facing = Math.atan2(u.aimX - u.x, u.aimZ - u.z)
  return true
}
