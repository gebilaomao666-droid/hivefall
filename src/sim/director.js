// 战役导演：阶段、涓流、18 波、预告、侧翼突袭、门的时刻表、Boss 出场。
// 数据全在 src/data/waves.js；这里只按时间轴往虫群里放虫。
import { PHASES, TRICKLE, TRICKLE_HERALD, TRICKLE_SPREAD, SPEED_CURVE, LANES, TUTORIAL_LANES, WAVE_SPREAD, HERALD_SPREAD, HERALD_LEAD, WAVES, WAVE_KINDS, RUSH, FIELD, CAMPAIGN_LEN, waveComp } from '../data/waves.js'
import { GATE } from '../data/gates.js'
import { CAMPAIGN_BOSS } from '../data/bosses.js'
import { ELITE } from '../data/enemies.js'
import { piecewise, stepLookup, clamp } from '../core/util.js'
import { spawn, KIND_INDEX } from './swarm.js'
import { spawnGate } from './gates.js'
import { spawnBoss } from './boss.js'

const X_MAX = FIELD.xEdge - 0.2
const INTRO_COMMS = { burster: 'comms.first_burster', spitter: 'comms.first_spitter', crusher: 'comms.first_crusher', hulk: 'comms.first_hulk' }

// 精英判定。战役里 eliteChance = 0，不消耗随机数（不影响既有种子的结果）。
export function rollElite(world, k) {
  const c = world.eliteChance
  return c > 0 && world.rng.spawn() < (k === 0 ? c * ELITE.lingFactor : c)
}

export function createDirector() {
  return {
    phaseIdx: 0, waveIdx: 0, heralded: false, lastLane: null, nextLane: null,
    trickleAcc: 0, releases: [],
    rushNext: RUSH.from, rushSide: 0, rushWarned: false,
    gateIdx: 0, heavyIdx: 0, bossSpawned: false,
  }
}

function pickLane(world, d, idx, herald) {
  if (idx < TUTORIAL_LANES.length) return TUTORIAL_LANES[idx]
  if (herald) return 0
  const rng = world.rng.waves
  let lane = LANES[rng.int(LANES.length)]
  if (lane === d.lastLane) lane = LANES[(LANES.indexOf(lane) + 1 + rng.int(LANES.length - 1)) % LANES.length]
  return lane
}

// 把一波虫排进释放队列（无尽的波次也走这里）。w: { ling, burster, ..., dur }
export function releaseWave(world, w, lane, spread) {
  const d = world._dir, seen = world._seen
  // 两种针对布防的虫第一次随波出现时各说一句
  if (w.shieldbug > 0 && !seen.shieldbug) { seen.shieldbug = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_shieldbug' }) }
  if (w.leaper > 0 && !seen.leaper) { seen.leaper = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_leaper' }) }
  for (const kind of WAVE_KINDS) {
    const n = w[kind]
    if (!n) continue
    // 大个头排在波的中段，横向收窄一点
    d.releases.push({ k: KIND_INDEX[kind], left: n, rate: n / w.dur, acc: 0, x: lane, spread: kind === 'ling' ? spread : spread * 0.7, side: 0 })
  }
}

function startWave(world, d, w, idx) {
  const lane = d.nextLane
  const spread = w.herald ? HERALD_SPREAD : WAVE_SPREAD
  d.lastLane = lane
  releaseWave(world, w, lane, spread)
  world.wave.index = idx + 1
  world.wave.name = w.herald || 'wave.generic'
  world.wave.herald = null
  world.events.push({ type: 'waveStart', index: idx + 1, lane, comp: waveComp(w) })
}

export function runReleases(world, d, dt) {
  const rs = d.releases, rng = world.rng.spawn
  let w = 0
  for (let n = 0; n < rs.length; n++) {
    const r = rs[n]
    r.acc += r.rate * dt
    while (r.acc >= 1 && r.left > 0) {
      let x, z, vx = 0
      if (r.side !== 0) {
        x = r.side * (RUSH.x + rng.tri() * RUSH.xJitter)
        z = RUSH.z[0] + (RUSH.z[1] - RUSH.z[0]) * rng()
        vx = -r.side * (RUSH.vx[0] + (RUSH.vx[1] - RUSH.vx[0]) * rng())
      } else {
        x = r.x + rng.tri() * r.spread
        z = FIELD.spawnZ - rng() * FIELD.spawnDepth
      }
      if (spawn(world, r.k, clamp(x, -X_MAX, X_MAX), z, vx, rollElite(world, r.k)) < 0) {
        // 到上限了：这一波先憋着，等场上腾出位置再放
        if (r.acc > 30) r.acc = 30
        break
      }
      r.acc--
      r.left--
    }
    if (r.left > 0) rs[w++] = r
  }
  rs.length = w
}

export function update(world, dt) {
  const d = world._dir, t = world.time
  world.enemySpeedMul = piecewise(SPEED_CURVE, t) * world.diff.speedMul * world.mut.speedMul

  // 阶段
  while (d.phaseIdx < PHASES.length && t >= PHASES[d.phaseIdx].at) {
    const ph = PHASES[d.phaseIdx++]
    world.mission.label = ph.name
    world.events.push({ type: 'phase', name: ph.name })
  }

  // 波次与预告
  const w = WAVES[d.waveIdx]
  if (w) {
    if (d.nextLane == null) d.nextLane = pickLane(world, d, d.waveIdx, w.herald)
    if (w.herald && !d.heralded && t >= w.at - HERALD_LEAD) {
      d.heralded = true
      world.wave.herald = { nameKey: w.herald, comp: waveComp(w), t0: t, t1: w.at, lane: d.nextLane, side: 0, feature: w.feature || null }
      world.events.push({ type: 'herald', nameKey: w.herald, comp: world.wave.herald.comp, t0: t, t1: w.at, lane: d.nextLane, side: 0 })
      // 新虫种首秀：没有「第一次遭遇」通讯的几种（脓爆虫 / 刺脊虫 / 甲壳兽 / 巨畸体）在预告时介绍一句；其余几种的通讯在它真的出手时发（sim/swarm.js、releaseWave）
      if (w.feature && INTRO_COMMS[w.feature] && !world._seen[w.feature]) {
        world._seen[w.feature] = true
        world.events.push({ type: 'comms', speaker: 'ops', textKey: INTRO_COMMS[w.feature] })
      }
    }
    if (t >= w.at) {
      startWave(world, d, w, d.waveIdx)
      d.waveIdx++
      d.heralded = false
      d.nextLane = null
    }
  }

  // 涓流
  let rate = stepLookup(TRICKLE, t)
  if (world.wave.herald && rate > TRICKLE_HERALD) rate = TRICKLE_HERALD
  d.trickleAcc += rate * dt
  while (d.trickleAcc >= 1) {
    d.trickleAcc--
    const rng = world.rng.spawn
    spawn(world, 0, rng.range(-TRICKLE_SPREAD, TRICKLE_SPREAD), FIELD.spawnZ - rng() * FIELD.spawnDepth, 0, rollElite(world, 0))
  }

  // 侧翼突袭
  if (t < CAMPAIGN_LEN) {
    if (!d.rushWarned && t >= d.rushNext - RUSH.warn) {
      d.rushWarned = true
      const px = world.squad.x
      d.rushSide = Math.abs(px) >= RUSH.offCenter ? (px > 0 ? -1 : 1) : (world.rng.waves() < 0.5 ? -1 : 1)
      world.telegraphs.push({
        id: world._nextId++, shape: 'lane', x: d.rushSide * RUSH.x, z: (RUSH.z[0] + RUSH.z[1]) / 2, w: 2.4,
        z0: RUSH.z[0], z1: RUSH.z[1], t0: t, t1: d.rushNext, team: 'enemy', style: 'flank',
      })
      world.events.push({ type: 'flankWarn', side: d.rushSide, count: RUSH.count, t: RUSH.warn })
    }
    if (t >= d.rushNext) {
      d.releases.push({ k: 0, left: RUSH.count, rate: RUSH.count / RUSH.dur, acc: 0, x: 0, spread: 0, side: d.rushSide })
      d.rushNext += RUSH.every
      d.rushWarned = false
    }
  }

  runReleases(world, d, dt)

  // 门
  if (d.gateIdx < GATE.times.length && t >= GATE.times[d.gateIdx] && world.gates === null) spawnGate(world, d.gateIdx++)

  // Boss
  if (!d.bossSpawned && t >= CAMPAIGN_BOSS.at) {
    d.bossSpawned = true
    spawnBoss(world, world.opts.boss)
  }
}
