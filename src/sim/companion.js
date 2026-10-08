// 伙伴无人机「小七」：跟随、成长进化、能量弹 / 战术扫描 / 冰冻脉冲。数值在 data/companion.js。
// 伤害以 POWER 为来源，记进 stats.dmgByPower.companion（吃无尽每层的技能伤害系数）。它自己不会挨打。
import { COMPANION as C, formKey } from '../data/companion.js'
import { POWER } from '../data/units.js'
import { queryCircle } from './grid.js'
import { hitEnemy, explode, findDense, slowEnemy } from './combat.js'
import { damageBoss, bossUp } from './boss.js'
import { ENEMY_CLS, ST_DYING, ST_BURROW } from './swarm.js'

const ID = 'companion'
const Z_FAR = -22

// cfg: true | { growth: 已买的成长等级, name }。found: 这一局在无尽里刚捡到
export function createCompanion(world, cfg, found = false) {
  const growth = cfg && cfg.growth > 0 ? Math.min(C.growthMax, cfg.growth | 0) : 0
  const stage = found ? C.foundStage : 0
  const sq = world.squad
  const c = {
    id: C.id, name: (cfg && cfg.name) || null, nameKey: 'companion.name',
    stage, form: C.forms[stage], formKey: formKey(stage),
    xp: stage > 0 ? C.xp[stage - 1] : 0, xpPrev: stage > 0 ? C.xp[stage - 1] : 0, xpNext: C.xp[stage],
    x: sq.x + C.hover.dx, z: sq.frontZ + C.hover.dz, y: C.hover.y, facing: Math.PI,
    fireT: -9, aimX: 0, aimZ: 0,
    scanT: -9, pulseT: -9,          // 最近一次扫描 / 脉冲的时刻
    dmg: 0, kills: 0, scans: 0, pulses: 0, evolutions: 0, growth, found, joinedT: world.time,
    _xpMul: 1 + C.growthPer * growth, _bolt: 0, _scan: C.scan.first, _pulse: C.pulse.first,
  }
  world.companion = c
  const st = world.stats
  if (!(ID in st.dmgByPower)) { st.dmgByPower[ID] = 0; st.killsByPower[ID] = 0 }
  world.events.push({ type: 'companion', kind: found ? 'found' : 'join', stage, form: c.form, x: c.x, z: c.z })
  if (found) world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.companion.found' })
  return c
}

function evolve(world, c) {
  c.stage++
  c.form = C.forms[c.stage]
  c.formKey = formKey(c.stage)
  c.xpPrev = C.xp[c.stage - 1]
  c.xpNext = c.stage < C.xp.length ? C.xp[c.stage] : null
  c.evolutions++
  world.events.push({ type: 'companion', kind: 'evolve', stage: c.stage, form: c.form, x: c.x, z: c.z })
  world.events.push({ type: 'comms', speaker: 'seven', textKey: `comms.companion.${c.form}` })
}

function bolt(world, c, pm) {
  const b = C.bolt, sq = world.squad, boss = world.boss
  let x, z
  if (findDense(world, 8, Z_FAR, sq.frontZ - 1, 0, 40, 0)) { x = world._aim.x; z = world._aim.z }
  else if (bossUp(boss)) { x = boss.x; z = boss.z }
  else return false
  c.fireT = world.time; c.aimX = x; c.aimZ = z
  world.events.push({ type: 'shot', unit: ID, kind: ID, x: c.x, z: c.z, tx: x, tz: z, delay: b.delay })
  explode(world, x, z, b.r, b.dmg * pm, b.maxTargets, 0, 0, POWER, null, ID, b.bossDmg * pm, 's')
  return true
}

function scan(world, c) {
  const sc = C.scan, sq = world.squad, s = world.swarm, g = world.hash
  if (!findDense(world, 12, Z_FAR, sq.frontZ - 1, 0, 40, 0)) return false
  const x = world._aim.x, z = world._aim.z
  const n = queryCircle(g, s, x, z, sc.r, g.out)
  for (let j = 0; j < n; j++) s.mark[g.out[j]] = 1
  c.scans++
  c.scanT = world.time
  world.events.push({ type: 'companion', kind: 'scan', stage: c.stage, form: c.form, x, z, r: sc.r, count: n })
  return true
}

function pulse(world, c, pm) {
  const p = C.pulse, sq = world.squad, s = world.swarm, g = world.hash, time = world.time
  const x = sq.x, z = sq.frontZ - p.ahead
  const n = queryCircle(g, s, x, z, p.r, g.out2)
  if (n === 0 && !bossUp(world.boss)) return false
  let hits = 0
  for (let j = 0; j < n; j++) {
    const i = g.out2[j]
    if (s.state[i] === ST_DYING || s.state[i] === ST_BURROW) continue
    slowEnemy(world, i, p.slow, p.slowDur)
    if (ENEMY_CLS[s.kind[i]] !== 2 && time + p.freeze > s.stunT[i]) s.stunT[i] = time + p.freeze
    hitEnemy(world, i, p.dmg * pm, POWER, null, true, ID, false)
    hits++
  }
  const b = world.boss
  if (bossUp(b)) {
    const dx = b.x - x, dz = b.z - z, rr = p.r + b.radius
    if (dx * dx + dz * dz <= rr * rr) damageBoss(world, p.bossDmg * pm, POWER, null, ID, true)
  }
  c.pulses++
  c.pulseT = time
  world.events.push({ type: 'companion', kind: 'pulse', stage: c.stage, form: c.form, x, z, r: p.r, hits })
  world.events.push({ type: 'shake', amp: 0.1 })
  return true
}

export function update(world, dt) {
  const c = world.companion
  if (c === null) return
  const sq = world.squad, h = C.hover
  // 悬在队伍右前方，跟得松一点
  c.x += (sq.x + h.dx - c.x) * h.follow
  c.z += (sq.frontZ + h.dz - c.z) * h.follow

  while (c.stage < C.xp.length && c.xp >= C.xp[c.stage]) evolve(world, c)
  const st = world.stats
  c.dmg = st.dmgByPower[ID]
  c.kills = st.killsByPower[ID] || 0
  if (c.stage < 2) return

  const pm = world.powerDmgMul
  c._bolt -= dt
  if (c._bolt <= 0) c._bolt = bolt(world, c, pm) ? C.bolt.every : 0.2
  c._scan -= dt
  if (c._scan <= 0) c._scan = scan(world, c) ? C.scan.every : 0.5
  if (c.stage >= 3) {
    c._pulse -= dt
    if (c._pulse <= 0) c._pulse = pulse(world, c, pm) ? C.pulse.every : 0.5
  }
}

// 局外培养点（data/companion.js 的 points）：出战满 20 秒 +1、每次进化 +1、每张加餐牌 +1（最多 3）、战役胜利 +2
export function companionResult(world) {
  const c = world.companion
  if (c === null) return null
  const P = C.points
  const treats = Math.min(P.treatMax, world.progress.modules.gen_treat || 0)
  const deploy = world.time - c.joinedT >= P.deployAfter ? P.deploy : 0
  const evolveP = c.evolutions * P.evolve
  const win = world._campaignWon ? P.win : 0
  return {
    id: c.id, name: c.name, stage: c.stage, form: c.form, formKey: c.formKey, found: c.found,
    xp: Math.round(c.xp), dmg: Math.round(world.stats.dmgByPower[ID] || 0), kills: world.stats.killsByPower[ID] || 0,
    scans: c.scans, pulses: c.pulses, evolutions: c.evolutions,
    points: { deploy, evolve: evolveP, treat: treats, win, total: deploy + evolveP + treats + win },
  }
}
