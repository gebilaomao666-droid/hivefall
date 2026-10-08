// 无尽模式：战役胜利后原地续打。层的推进、每层成长、3 波轮换配比、每层一道门、每 3 层 Boss、
// 第 2/5/8 层追加突变、第 5 层捡到伙伴、第 10 层盟军先遣队、每 5 层换环境主题。数值在 data/endless.js。
import { ENDLESS as E, MIXES, VANGUARD, layerLenAt, layerScale, capsAt, mixAt, themeAt, waveAt, bossAt, bossHpMulAt } from '../data/endless.js'
import { DIFFICULTY } from '../data/enemies.js'
import { BOSSES } from '../data/bosses.js'
import { GATE } from '../data/gates.js'
import { UNITS, HEAVY_KINDS, POWER } from '../data/units.js'
import { SPEED_CURVE, LANES, WAVE_SPREAD, HERALD_SPREAD, TRICKLE_HERALD, TRICKLE_SPREAD, FIELD, WAVE_KINDS } from '../data/waves.js'
import { ENEMIES } from '../data/enemies.js'
import { spawn } from './swarm.js'
import { releaseWave, runReleases, rollElite } from './director.js'
import { spawnEndlessGate } from './gates.js'
import { spawnBoss } from './boss.js'
import { addUnits, healAll, aliveCount } from './squad.js'
import { addRandomMutator } from './mutators.js'
import { createCompanion } from './companion.js'
import { explodeLater, findDense } from './combat.js'
import { refillFences } from './devices.js'
import { FENCE } from '../data/devices.js'

const SPEED_END = SPEED_CURVE[SPEED_CURVE.length - 1][1]

const comp = w => {
  const out = []
  for (const k of WAVE_KINDS) if (w[k] > 0) out.push({ kind: k, count: w[k], nameKey: ENEMIES[k].nameKey })
  return out
}

// status === 'won' 时 input.continueEndless：带着现有部队、等级、卡牌原地续打
export function enterEndless(world) {
  if (world.phase === 'endless') return
  world.phase = 'endless'
  world.status = 'running'
  world.timeScale = 1
  world._endTime = null
  world.boss = null
  world.endless = {
    layer: 0, layerT: 0, layerLen: 0, theme: themeAt(1),
    mix: null,            // 本层的波次配比 id
    boss: null,           // 本层会出的 Boss 种类（没有为 null）
    bounty: false,        // 下一道门是不是悬赏门
    log: [],              // 每层一条摘要，result().layers
    _offset: 0, _k: 1, _wave: 0, _heralded: false, _gate: false, _bossDone: false, _lane: 0,
    _gateIdx: GATE.times.length, _event: null, _mark: null,
  }
  world._dir.trickleAcc = 0
  world.wave.herald = null
  world.mission.label = 'phase.endless'
  world.events.push({ type: 'phase', name: 'phase.endless' })
  world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.endless' })
  // 先把编制抬到第 1 层的上限再补员：战役打满 60 步兵时，这 4 个人才进得来
  Object.assign(world.squad.caps, capsAt(1))
  addUnits(world, E.gift.unit, E.gift.count, 'endless')
  healAll(world)
  startLayer(world, 1)
}

const snapshot = world => ({ t: world.time, kills: world.stats.kills, losses: world.stats.losses, leaked: world.stats.leaked })

function closeLayer(world) {
  const e = world.endless, m = e._mark, st = world.stats
  e.log.push({
    layer: e.layer, mix: e.mix, theme: e.theme, boss: e.boss, seconds: Math.round((world.time - m.t) * 10) / 10,
    kills: st.kills - m.kills, losses: st.losses - m.losses, leaked: st.leaked - m.leaked,
    troops: aliveCount(world.squad), line: Math.round(world.line.hp), lineMax: world.line.hpMax, level: world.progress.level,
    killsTotal: st.kills,
  })
}

function startLayer(world, n) {
  const e = world.endless
  if (e.layer > 0) closeLayer(world)
  const prevTheme = e.theme
  e.layer = n
  e.layerT = 0
  e._offset = n === 1 ? E.firstDelay : 0
  const len = layerLenAt(n)
  e._k = len / E.layerLen                 // 层变短时，层内的时刻表等比压缩
  e.layerLen = len + e._offset
  e.theme = themeAt(n)
  e.mix = mixAt(n)
  e.boss = bossAt(n)
  e._wave = 0; e._heralded = false; e._gate = false; e._bossDone = false
  e._mark = snapshot(world)

  // 每层成长
  const sc = layerScale(n), base = DIFFICULTY[world.opts.difficulty]
  world.diff.hpMul = base.hpMul * sc.hp
  world.diff.lingHpMul = 1 / (E.density || 1)    // 虫海密度：裂爪虫多 density 倍、每只薄 density 倍（data/endless.js）
  world.diff.dmgMul = base.dmgMul * sc.dmg
  world.diff.armorAdd = sc.armor
  world.diff.lineMul = 1                  // 指挥官局的战役威胁加码不带进无尽
  world.eliteChance = sc.elite
  world.powerDmgMul = sc.power
  Object.assign(world.squad.caps, capsAt(n))

  world.events.push({ type: 'layer', n, theme: e.theme, mix: e.mix, len: e.layerLen, boss: e.boss })
  if (n > 1 && e.theme !== prevTheme) world.events.push({ type: 'comms', speaker: 'ops', textKey: `comms.theme.${e.theme}` })
  // 每层开头补几个人（第 2 轮测试：前几层改成每层都要掉人之后，光靠一层一道门补不回来，一路往下掉到团灭）
  if (n > 1) relieve(world, n)
  if (E.mutatorLayers.includes(n)) addRandomMutator(world)
  if (n === E.companionLayer && world.companion === null) createCompanion(world, null, true)
  if (n === E.vanguardLayer) e._event = 'vanguard'
  if (n % FENCE.refillEvery === 0) refillFences(world)      // 应急电网每 5 层补满
}

// 每层开头的补员：至少 relief 名突击兵，步兵不足保底线（reliefFloor）时补到保底线（一次最多 max 人）；
// 偶数层按编制空投一台重型，种类按层号轮换（不消耗随机数）。都受编制上限约束
function relieve(world, n) {
  const F = E.reliefFloor
  let inf = 0
  for (const u of world.squad.units) if (u.alive && u._def.cls === 'infantry') inf++
  const want = Math.min(F.max, Math.max(E.relief, F.base + F.per * n - inf))
  if (want > 0) addUnits(world, E.gift.unit, want, 'relief')
  if (E.reliefHeavyEvery > 0 && n % E.reliefHeavyEvery === 0 && HEAVY_KINDS.length > 0) {
    addUnits(world, HEAVY_KINDS[((n / E.reliefHeavyEvery) | 0) % HEAVY_KINDS.length], 1, 'relief')
  }
}

// ---- 第 10 层：盟军先遣队。三选一送一台重型（不占编制），外加一轮轨道轰炸 ----
function openVanguard(world) {
  const rng = world.rng.gates
  const pool = HEAVY_KINDS.slice(), cards = []
  while (cards.length < VANGUARD.choices && pool.length > 0) {
    const kind = pool.splice(rng.int(pool.length), 1)[0]
    cards.push({
      id: `ally_${kind}`, kind: 'ally', unit: kind, moduleId: null, level: 1, maxLevel: 1, rarity: 'legendary', equip: false,
      from: String(world.squad.counts[kind]), to: String(world.squad.counts[kind] + 1), completes: null, heroic: null,
      nameKey: UNITS[kind].nameKey, descKey: 'ally.vanguard.card',
    })
  }
  world.levelup = { level: world.progress.level, cards, rerolls: 0, kind: 'vanguard', _onPick: pickVanguard }
  world.status = 'levelup'
  world.events.push({ type: 'ally', kind: 'vanguard', layer: world.endless.layer })
  world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.vanguard' })
}

function pickVanguard(world, card) {
  addUnits(world, card.unit, 1, 'ally', null, true)
  const V = VANGUARD, sq = world.squad, rng = world.rng.gates, st = world.stats
  if (!(V.id in st.dmgByPower)) { st.dmgByPower[V.id] = 0; st.killsByPower[V.id] = 0 }
  const pm = world.powerDmgMul
  let n = 0
  for (let k = 0; k < E.vanguardStrikes; k++) {
    let x, z
    if (findDense(world, 12, -22, sq.frontZ - 2, 0, 40, 0)) { x = world._aim.x + rng.tri() * 2; z = world._aim.z + rng.tri() * 2 }
    else { x = rng.range(-5, 5); z = rng.range(-16, 2) }
    const delay = V.delay + k * V.stagger
    world.telegraphs.push({ id: world._nextId++, shape: 'circle', x, z, r: V.r, t0: world.time, t1: world.time + delay, team: 'ally', style: 'strike' })
    world.events.push({ type: 'strike', power: V.id, kind: 'orbital', x, z, r: V.r, delay })
    explodeLater(world, delay, x, z, V.r, V.dmg * pm, V.maxTargets, 0, 0, POWER, null, V.id, V.bossDmg * pm, 'l')
    n++
  }
  world.events.push({ type: 'ally', kind: 'vanguard_strike', layer: world.endless.layer, unit: card.unit, count: n })
}

// 无尽里 Boss 的子弹时间结束：发奖励，战斗继续
export function bossDown(world) {
  const e = world.endless, p = world.progress, line = world.line, R = E.bossReward
  const kind = world.boss.kind
  world.boss = null
  world.timeScale = 1
  line.hp = Math.min(line.hpMax, line.hp + R.line)
  p.rerolls += R.rerolls
  if (p.xp < p.xpNext) p.xp = p.xpNext            // 直接升一级（本步末尾的升级检查会弹卡）
  e.bounty = true
  world.events.push({ type: 'heal', amount: R.line, target: 'line' })
  world.events.push({ type: 'ally', kind: 'bounty', layer: e.layer, boss: kind })
  world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.bounty' })
}

export function update(world, dt) {
  const e = world.endless, d = world._dir
  e.layerT += dt
  if (e.layerT >= e.layerLen) startLayer(world, e.layer + 1)
  world.mission.timeLeft = e.layerLen - e.layerT
  world.enemySpeedMul = SPEED_END * world.diff.speedMul * world.mut.speedMul

  const n = e.layer, k = e._k, t = e.layerT - e._offset
  // 三波；最后一波带预告
  if (e._wave < E.waves.length) {
    const wd = E.waves[e._wave], at = wd.at * k
    if (wd.herald && !e._heralded && t >= at - E.heraldLead) {
      e._heralded = true
      const w = waveAt(n, e._wave)
      const nameKey = MIXES[e.mix].nameKey
      world.wave.herald = { nameKey, comp: comp(w), t0: world.time, t1: world.time + (at - t), lane: 0, side: 0 }
      world.events.push({ type: 'herald', nameKey, comp: world.wave.herald.comp, t0: world.wave.herald.t0, t1: world.wave.herald.t1, lane: 0, side: 0 })
    }
    if (t >= at) {
      const w = waveAt(n, e._wave)
      const lane = wd.herald ? 0 : LANES[world.rng.waves.int(LANES.length)]
      releaseWave(world, w, lane, wd.herald ? HERALD_SPREAD : WAVE_SPREAD)
      world.wave.index++
      world.wave.name = wd.herald ? MIXES[e.mix].nameKey : 'wave.deep'
      world.wave.herald = null
      world.events.push({ type: 'waveStart', index: world.wave.index, lane, comp: comp(w) })
      e._wave++
    }
  }

  // 涓流
  let rate = E.trickle * layerScale(n).count * (E.density || 1)
  if (world.wave.herald && rate > TRICKLE_HERALD) rate = TRICKLE_HERALD
  d.trickleAcc += rate * dt
  while (d.trickleAcc >= 1) {
    d.trickleAcc--
    const rng = world.rng.spawn
    spawn(world, 0, rng.range(-TRICKLE_SPREAD, TRICKLE_SPREAD), FIELD.spawnZ - rng() * FIELD.spawnDepth, 0, rollElite(world, 0))
  }
  runReleases(world, d, dt)

  // 每层一道门
  if (!e._gate && t >= E.gateAt * k && world.gates === null) {
    e._gate = true
    spawnEndlessGate(world, e._gateIdx++, e.bounty)
    e.bounty = false
  }

  // 每 3 层一只 Boss。上一只还没打死就不再叠一只
  if (e.boss !== null && !e._bossDone && t >= E.bossAt * k && world.boss === null) {
    e._bossDone = true
    spawnBoss(world, e.boss, DIFFICULTY[world.opts.difficulty].hpMul * bossHpMulAt(n), BOSSES[e.boss].endlessHp)
  }
}

// 每步最后调用：特殊事件的三选一要等这一步的战斗都结算完再弹（不和瞄准 / 升级抢状态）
export function lateUpdate(world) {
  const e = world.endless
  // 等第一波虫压上来再到场：轨道轰炸才有东西可炸
  if (e._event !== null && e.layerT - e._offset >= VANGUARD.at && world.status === 'running' && world.levelup === null) {
    e._event = null
    openVanguard(world)
  }
}

// 本层摘要（还没结束的这一层），给结算用
export function layerLog(world) {
  const e = world.endless
  if (e === null) return []
  const m = e._mark, st = world.stats
  return e.log.concat([{
    layer: e.layer, mix: e.mix, theme: e.theme, boss: e.boss, seconds: Math.round((world.time - m.t) * 10) / 10,
    kills: st.kills - m.kills, losses: st.losses - m.losses, leaked: st.leaked - m.leaked,
    troops: aliveCount(world.squad), line: Math.round(world.line.hp), lineMax: world.line.hpMax, level: world.progress.level,
    killsTotal: st.kills, partial: e.layerT < e.layerLen - 0.1,
  }])
}
