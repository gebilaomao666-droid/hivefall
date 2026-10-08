// 第 3 步测试：指挥官技能 / 被动 / 突变因子 / 雇佣兵合同 / 每日挑战。node tools/test-powers.mjs
// 小场景用摆拍世界（createWorld({ sandbox: true, commander })）：冷却照常走，虫自己摆。
import { createWorld, DT } from '../src/sim/world.js'
import { runHeadless, createBot } from '../src/sim/bot.js'
import { addUnits, damageUnit, capRoom } from '../src/sim/squad.js'
import { spawn, KIND_INDEX } from '../src/sim/swarm.js'
import { hitEnemy, explode, addZone } from '../src/sim/combat.js'
import { enterEndless } from '../src/sim/endless.js'
import { spawnGate } from '../src/sim/gates.js'
import { spawnBoss, damageBoss } from '../src/sim/boss.js'
import { grantModule } from '../src/sim/progression.js'
import { dropPod } from '../src/sim/contracts.js'
import { dailyConfig } from '../src/sim/daily.js'
import { findBadEvent, EVENT_TYPES } from '../src/core/events.js'
import { UNITS, UNIT_KINDS, HERO_KINDS } from '../src/data/units.js'
import { ENEMIES, DIFFICULTY } from '../src/data/enemies.js'
import { COMMANDERS, COMMANDER_IDS, POWERS, PASSIVES, AIM } from '../src/data/commanders.js'
import { MUTATORS, MUTATOR_IDS } from '../src/data/mutators.js'
import { CONTRACTS, CONTRACT_GATES } from '../src/data/contracts.js'
import { GATE_TRAVEL } from '../src/data/gates.js'
import zh from '../src/data/strings.zh.js'
import en from '../src/data/strings.en.js'

let failed = 0, badEvent = null
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
const K = KIND_INDEX
const r1 = v => Math.round(v * 10) / 10

const sandbox = (commander = 'none', extra = {}) => createWorld({ seed: 1, sandbox: true, commander, ...extra })
const press = key => ({ moveX: null, targetX: null, powers: [key], aim: null, pick: null })
const aimAt = (x0, z0, x1, z1) => ({ moveX: null, targetX: null, powers: [], aim: { x0, z0, x1, z1 }, pick: null })

// 每个技能实际发出过的子事件（最后和 data 里登记的 events 对账）
const seen = {}
const note = (id, tag) => { (seen[id] = seen[id] || new Set()).add(tag) }
function record(world) {
  for (const e of world.events) {
    if (!badEvent) { const bad = findBadEvent(e); if (bad) badEvent = { field: bad, event: e } }
    if (e.type === 'powerCast') note(e.id, 'powerCast')
    else if (e.type === 'strike' && POWERS[e.power]) note(e.power, 'strike:' + e.kind)
    else if (e.type === 'summon') note(e.power, 'summon:' + e.kind)
    else if (e.type === 'summonEnd') { const p = Object.values(POWERS).find(p => p.events.includes('summon:' + e.kind)); if (p) note(p.id, 'summonEnd') }
    else if (e.type === 'explosion' && POWERS[e.kind]) note(e.kind, 'explosion')
    else if (e.type === 'beam' && (POWERS[e.kind] || e.kind === 'hawk_flagship_gun')) note(e.kind === 'hawk_flagship_gun' ? 'hawk_flagship' : e.kind, 'beam')
    else if (e.type === 'aimStart' || e.type === 'aimEnd') note(e.id, e.type)
  }
}

// 前进 seconds 秒（模拟时间）。input: null / 对象 / (world) => 对象；on(e, world)：每个事件回调
function run(world, seconds, { input = null, on = null, each = null } = {}) {
  const steps = Math.round(seconds / DT)
  for (let n = 0; n < steps; n++) stepOnce(world, typeof input === 'function' ? input(world) : input, on, each)
}
function stepOnce(world, input = null, on = null, each = null) {
  world.step(input)
  record(world)
  if (on) for (const e of world.events) on(e, world)
  if (each) each(world)
}

function put(world, kind, x, z, hp = null) {
  const i = spawn(world, K[kind], x, z)
  if (hp !== null) { world.swarm.hp[i] = hp; world.swarm.hpMax[i] = hp }
  return i
}
const power = (world, id) => world.powers.find(p => p.id === id)
// 让某个技能立刻充好一次能（走正常的计时路径）
function charge(world, id) {
  const p = power(world, id)
  p._left = 1e-6; p._gap = 0
  stepOnce(world)
  return p
}
// 把英雄请下场：量技能本身的伤害时不让他掺和
function benchHero(world) {
  const sq = world.squad
  for (const u of sq.units) sq.counts[u.kind]--
  sq.units.length = 0
  sq.hero = null
}
const sumUnitDmg = world => Object.values(world.stats.dmgByUnit).reduce((a, b) => a + b, 0)

// ============================================================ 数据与结构

{
  const okKeys = COMMANDER_IDS.join() === 'hawk,ysera,joe'
  const keys = id => COMMANDERS[id].powers.map(p => POWERS[p].key).join('')
  check('三位指挥官：hawk Q/W/E/R，ysera Q/W/R，joe Q/W/R', okKeys && keys('hawk') === 'qwer' && keys('ysera') === 'qwr' && keys('joe') === 'qwr', COMMANDER_IDS.map(id => `${id}:${keys(id)}`).join('  '))
  const aimables = Object.values(POWERS).filter(p => p.aimable).map(p => p.id)
  check('划线瞄准的技能：日冕长矛、雷区', aimables.join() === 'ysera_lance,joe_mines' && AIM.timeScale === 0.25 && AIM.timeout === 2)
  const tiers = COMMANDER_IDS.every(id => {
    const ps = COMMANDERS[id].powers.map(p => POWERS[p]), q = ps[0], w = ps[1], r = ps[ps.length - 1]
    return q.first === 6 && q.cd >= 18 && q.cd <= 20 && w.first === 15 && w.cd === 25 && r.first === 45 && r.cd === 75
  })
  check('技能节奏：小技能 ~20s/首次 6s，清线 25s/首次 15s，大招 75s/首次 45s', tiers)
  check('存储次数：近地空袭 3、空投支援 4', POWERS.hawk_strike.charges === 3 && POWERS.hawk_drop.charges === 4)

  for (const id of [...COMMANDER_IDS, 'none']) {
    const w = createWorld({ seed: 1, commander: id })
    const hero = w.squad.hero
    const c = COMMANDERS[id]
    const ok = c
      ? hero && hero.kind === c.hero && w.squad.counts[c.hero] === 1 && w.squad.counts.rifle === 1 && w.powers.length === c.powers.length && w.powers.every(p => !p.ready && p.charges === 0 && p.cd === POWERS[p.id].first)
      : hero === null && w.powers.length === 0 && w.squad.units.length === 1
    check(`开局 ${id}：${c ? '英雄 + 1 名突击兵上场，技能全部在首次冷却中' : '一名突击兵，没有技能'}`, !!ok, c ? w.powers.map(p => `${p.key}:${p.cd}s`).join(' ') : '')
  }
  const w = createWorld({ seed: 1, commander: 'hawk' })
  const hero = w.squad.hero
  w.step(null)
  check('英雄站步兵第一排正中，血 60', hero.hpMax === 60 && near(hero._sz, 0) && Math.abs(hero._sx) < 0.5, `槽位 (${hero._sx}, ${hero._sz})  血 ${hero.hpMax}`)
  check('编制：英雄不占步兵 / 重型名额', w.squad.caps.hero === 1 && w.squad.caps.infantry === 60 && UNITS[hero.kind].cls === 'hero' && HERO_KINDS.length === 3 && UNIT_KINDS.length === 8)
}

// ============================================================ 冷却与充能

{
  // 首次可用时刻：6 / 15 / 20 / 45 秒
  const w = sandbox('hawk')
  const readyAt = {}
  let comms = null
  run(w, 46, { on: (e, w) => { if (e.type === 'powerReady' && !(e.id in readyAt)) readyAt[e.id] = w.time; if (e.type === 'comms' && e.speaker === 'hawk') comms = e } })
  const ok = near(readyAt.hawk_rally, 6, 0.05) && near(readyAt.hawk_strike, 15, 0.05) && near(readyAt.hawk_drop, 20, 0.05) && near(readyAt.hawk_flagship, 45, 0.05)
  check('首次可用：鼓舞 6s / 空袭 15s / 空投 20s / 旗舰 45s', ok, Object.entries(readyAt).map(([k, t]) => `${k} ${r1(t)}s`).join('  '))
  check('第一个技能就绪时指挥官本人发一句通讯', comms && comms.textKey === 'comms.hawk.ready' && comms.textKey in zh)

  // 冷却：放完进 20 秒冷却，期间按键无效
  const w2 = sandbox('hawk')
  run(w2, 6.1)
  const p = power(w2, 'hawk_rally')
  const before = p.ready
  stepOnce(w2, press('q'))
  const cdAfter = p.cd, readyAfter = p.ready, casts1 = p.casts
  run(w2, 10, { input: press('q') })
  const castsMid = p.casts
  let back = -1
  const t0 = w2.time
  run(w2, 11, { on: (e, w) => { if (e.type === 'powerReady' && e.id === 'hawk_rally' && back < 0) back = w.time } })
  // 期望变更（第 3 轮）：20 → 18 秒（读数据）。理由：甲壳兽 / 冲锋更疼之后，伊瑟拉的「守护之壳」（致命伤免死）在无尽深层越发吃香，
  // 霍克比她浅 2.5 层（test-endless ⑫ 要求相差 ≤ 2）；鼓舞冷却缩到 18 秒后 17.25 层 vs 18.75 层
  const RCD = POWERS.hawk_rally.cd
  check(`冷却：战地鼓舞放完进 ${RCD} 秒冷却，冷却中按键无效，${RCD} 秒后再次就绪`, before && !readyAfter && near(cdAfter, RCD, 0.05) && casts1 === 1 && castsMid === 1 && near(back - 6.1, RCD, 0.1), `放完 cd ${r1(cdAfter)}  冷却中连按 10 秒 施放 ${castsMid} 次  再次就绪于 +${r1(back - 6.1)}s`)

  // 舰队后勤：冷却 -12% / 级
  const w3 = sandbox('hawk')
  grantModule(w3, 'gen_logistics'); grantModule(w3, 'gen_logistics')
  run(w3, 6.1)
  stepOnce(w3, press('q'))
  const p3 = power(w3, 'hawk_rally')
  const cd2 = POWERS.hawk_rally.cd * 0.76
  check(`舰队后勤 ×2：冷却 ${POWERS.hawk_rally.cd} → ${r1(cd2)} 秒（-12% × 2）`, near(p3.cdMax, cd2, 0.01) && near(p3.cd, cd2, 0.05), `cdMax ${p3.cdMax}`)
}

{
  // 充能：近地空袭每 25 秒充一次，最多存 3 次；连放之间至少隔 2 秒
  const w = sandbox('hawk')
  const p = power(w, 'hawk_strike')
  const at = []
  run(w, 100, { on: (e, w) => { if (e.type === 'powerReady' && e.id === 'hawk_strike') at.push(r1(w.time)) } })
  const full = p.charges === 3 && p.cd === 0 && at.length === 3 && near(at[0], 15, 0.1) && near(at[1], 40, 0.1) && near(at[2], 65, 0.1)
  stepOnce(w, press('w'))
  const c1 = p.charges, ready1 = p.ready
  stepOnce(w, press('w'))
  const c2 = p.charges
  run(w, 2.05)
  const ready2 = p.ready
  stepOnce(w, press('w'))
  const c3 = p.charges
  check('充能：近地空袭 15 / 40 / 65 秒各充一次，存满 3 次后停表', full, `充能时刻 ${at.join(' / ')}  存 ${p.maxCharges}`)
  check('充能：放一次扣一次，连放间隔 2 秒，用掉后重新计时', c1 === 2 && !ready1 && c2 === 2 && ready2 && c3 === 1 && near(p.cd, 25 - 2.07, 0.1), `3 → ${c1} →（立刻再按）${c2} →（2 秒后）${c3}  下一次充能还要 ${r1(p.cd)}s`)
}

// ============================================================ 「铁砧」霍克

{
  // Q 战地鼓舞：步兵伤害 ×1.25、射速 ×1.3（数值在 data/commanders.js；原先 ×1.5 / ×1.6，霍克比另外两位深 4 层）
  const R = POWERS.hawk_rally
  const dps = rally => {
    const w = sandbox('hawk')
    benchHero(w)
    w.enemySpeedMul = 0
    w.progress.overdriveUntil = 0
    addUnits(w, 'rifle', 8, 'test'); addUnits(w, 'mortar', 1, 'test')
    put(w, 'crusher', 0, 3, 1e6)
    run(w, 1)
    if (rally) { charge(w, 'hawk_rally'); stepOnce(w, press('q')) } else run(w, 2 * DT)
    const r0 = w.stats.dmgByUnit.rifle
    let shots = 0, mshots = 0
    run(w, 5, { on: e => { if (e.type === 'shot') { if (e.kind === 'rifle') shots++; else mshots++ } } })
    return { rifle: w.stats.dmgByUnit.rifle - r0, shots, mshots, until: power(w, 'hawk_rally').activeUntil, t: w.time, byPower: w.stats.dmgByPower.hawk_rally }
  }
  const a = dps(false), b = dps(true)
  const ratio = b.rifle / a.rifle, rate = b.shots / a.shots
  check('Q 战地鼓舞：步兵射速 ×1.3、总伤害 ≈ ×1.7（伤害 ×1.25 × 射速 ×1.3），持续 6 秒', R.infDmg === 1.25 && R.infRate === 1.3 && R.dmg === 1.15 && R.rate === 1.2 && R.dur === 6 && near(rate, R.infRate, 0.06) && near(ratio, R.infRate * (UNITS.rifle.weapon.dmg * R.infDmg - ENEMIES.crusher.armor) / (UNITS.rifle.weapon.dmg - ENEMIES.crusher.armor), 0.1) && b.until > b.t, `射速 ×${rate.toFixed(2)}  伤害 ×${ratio.toFixed(2)}`)
  const w = sandbox('hawk')
  benchHero(w); w.enemySpeedMul = 0; w.progress.overdriveUntil = 0
  addUnits(w, 'rifle', 4, 'test')
  put(w, 'crusher', 0, 3, 1e6)
  charge(w, 'hawk_rally'); stepOnce(w, press('q'))
  // 第 3 轮：甲壳兽骨刺 2.2 → 2.6 之后，8 秒里它能把站最前的那名突击兵打死（4 人变 3 人，「单兵 DPS」少四分之一）。
  // 这里量的是鼓舞结束后的射速，不是谁挨打：每步把血补满
  const heal = w => { for (const u of w.squad.units) u.hp = u.hpMax }
  run(w, 6.2, { each: heal })
  const d0 = w.stats.dmgByUnit.rifle
  run(w, 2, { each: heal })
  const after = (w.stats.dmgByUnit.rifle - d0) / 2
  check('Q 战地鼓舞：6 秒后效果消失', w.squad.units.every(u => u._dmgMul === 1) && near(after / 4, (UNITS.rifle.weapon.dmg - ENEMIES.crusher.armor) / 0.1425, 1), `结束后单兵 DPS ${(after / 4).toFixed(1)}`)
}

{
  // W 近地空袭：沿所在纵线 11 枚，每枚 75
  const w = sandbox('hawk')
  benchHero(w); w.enemySpeedMul = 0
  const onLane = [], off = []
  for (let z = 5; z >= -15; z -= 2) onLane.push(put(w, 'crusher', 0.5, z, 1000))
  for (let z = 5; z >= -15; z -= 4) off.push(put(w, 'crusher', 5, z, 1000))
  charge(w, 'hawk_strike')
  const strikes = []
  let cast = null
  stepOnce(w, press('w'), e => { if (e.type === 'strike') strikes.push(e); if (e.type === 'powerCast') cast = e })
  const tele = w.telegraphs.filter(t => t.team === 'ally').length
  run(w, 1.2)
  const s = w.swarm
  const hitOn = onLane.filter(i => s.hp[i] < 1000).length, hitOff = off.filter(i => s.hp[i] < 1000).length
  const one = 1000 - Math.max(...onLane.map(i => s.hp[i]))
  check('W 近地空袭：11 枚弹沿队伍纵线落下，线上全中、线外不伤', strikes.length === 11 && strikes.every(e => e.kind === 'bomb' && near(e.x, 0) && e.delay > 0) && tele === 11 && hitOn === onLane.length && hitOff === 0 && cast && near(cast.x, 0), `${strikes.length} 枚  线上 ${hitOn}/${onLane.length} 中  线外 ${hitOff}/${off.length} 中  预警圈 ${tele}`)
  check('W 近地空袭：每枚 75（护甲 0.5），伤害记入 dmgByPower.hawk_strike、不进兵种统计', one >= 74.5 && (one / 74.5) % 1 < 1e-3 && w.stats.dmgByPower.hawk_strike > 700 && sumUnitDmg(w) === 0, `单只最少吃 ${one}  dmgByPower ${Math.round(w.stats.dmgByPower.hawk_strike)}  兵种伤害 ${sumUnitDmg(w)}`)
  // 对 Boss
  const w2 = sandbox('hawk')
  benchHero(w2)
  spawnBoss(w2, 'ravager'); w2.boss.hp = w2.boss.hpMax = 1e6; w2.boss.x = 0; w2.boss.z = 0; w2.boss._chargeT = 99
  charge(w2, 'hawk_strike'); stepOnce(w2, press('w'))
  w2.boss.x = 0
  run(w2, 1.2, { each: w => { w.boss.x = 0; w.boss._chargeT = 99 } })
  check('W 近地空袭：对 Boss 每枚 180，计入 dmgByPower', w2.stats.dmgByPower.hawk_strike >= 179 && (w2.stats.dmgByPower.hawk_strike / 179) % 1 < 1e-3, `Boss 共吃 ${Math.round(w2.stats.dmgByPower.hawk_strike)}（${w2.stats.dmgByPower.hawk_strike / 179} 枚 × 179）`)
}

{
  // E 空投支援
  const w = sandbox('hawk')
  const n0 = w.squad.units.length
  charge(w, 'hawk_drop')
  let cast = null, join = null, pod = null
  stepOnce(w, press('e'), e => { if (e.type === 'powerCast') cast = e; if (e.type === 'strike') pod = e })
  const mid = w.squad.units.length
  run(w, 1, { on: e => { if (e.type === 'unitJoin') join = e } })
  check('E 空投支援：空投舱 0.8 秒后落地，带来一批部队', cast && cast.mode === 'troops' && pod && pod.kind === 'pod' && mid === n0 && join && join.source === 'drop' && join.kind === cast.unit && w.squad.units.length === n0 + cast.count, `${cast && cast.unit} ×${cast && cast.count}`)
  // 权重：前排 55 / 主兵 30 / 重型 8 / 炮兵 7
  const tally = {}
  for (let seed = 1; seed <= 300; seed++) {
    const w = createWorld({ seed, sandbox: true, commander: 'hawk' })
    charge(w, 'hawk_drop')
    stepOnce(w, press('e'), e => { if (e.type === 'powerCast') { const k = UNITS[e.unit].cls === 'heavy' ? 'heavy' : e.unit; tally[k] = (tally[k] || 0) + 1 } })
  }
  check('E 空投支援：权重 前排 55 / 突击兵 30 / 重型 8 / 自行炮 7（300 次抽样）', tally.flamer > 140 && tally.flamer < 190 && tally.rifle > 65 && tally.rifle < 115 && tally.heavy >= 8 && tally.mortar >= 8, Object.entries(tally).map(([k, n]) => `${k} ${n}`).join('  '))
  // 满编：改成全员治疗
  const w3 = sandbox('hawk')
  addUnits(w3, 'rifle', 5, 'test')
  w3.squad.caps.infantry = 0; w3.squad.caps.artillery = 0; w3.squad.caps.heavy = 0
  stepOnce(w3)
  // 刚挨过打：不让战地包扎（data/units.js 的 FIELD_REGEN，第 2 轮加的）在这一步里掺进来
  for (const u of w3.squad.units) { u.hp = 1; u.hitT = w3.time }
  charge(w3, 'hawk_drop')
  let mode = null, heal = null
  stepOnce(w3, press('e'), e => { if (e.type === 'powerCast') mode = e.mode; if (e.type === 'heal') heal = e })
  // 满编时补回已损失生命的 healFrac（原先回满：霍克在无尽里等于每 45 秒全队满血一次）
  const H = POWERS.hawk_drop.healFrac
  check('E 空投支援：满编时改为全队回复四成伤势', H === 0.4 && mode === 'heal' && heal && heal.amount > 0 && w3.squad.units.every(u => near(u.hp, 1 + (u.hpMax - 1) * H, 1e-6)) && near(heal.amount, w3.squad.units.reduce((a, u) => a + (u.hpMax - 1) * H, 0), 1e-6), `治疗量 ${heal && r1(heal.amount)}`)
}

{
  // R 旗舰
  const w = sandbox('hawk')
  benchHero(w); w.enemySpeedMul = 0
  const big = put(w, 'hulk', 2, -6, 5000)
  for (let k = 0; k < 60; k++) put(w, 'ling', -4 + (k % 12) * 0.3, -2 - ((k / 12) | 0) * 0.5, 40)
  charge(w, 'hawk_flagship')
  let beams = 0, gun = null, gunHit = 0, sumStart = null, sumEnd = -1, stop = 0
  const t0 = w.time
  stepOnce(w, press('r'), e => { if (e.type === 'summon') sumStart = e })
  const ship = w.summons[0]
  const okShip = ship && ship.kind === 'flagship' && ship.y > 0 && power(w, 'hawk_flagship').activeUntil > w.time
  run(w, 9, { on: (e, w) => {
    if (e.type === 'beam' && e.kind === 'hawk_flagship') beams++
    if (e.type === 'strike' && e.kind === 'main_gun') gun = { t: w.time - t0, x: e.x, z: e.z, delay: e.delay }
    if (e.type === 'enemyHit' && e.i === big && e.dmg > 500) gunHit = e.dmg
    if (e.type === 'hitstop') stop = e.ms
    if (e.type === 'summonEnd') sumEnd = w.time - t0
  } })
  check('R 旗舰：停留 8 秒，world.summons 里有一艘 flagship', okShip && sumStart && near(sumStart.dur, 8) && near(sumEnd, 8, 0.05) && w.summons.length === 0, `停留 ${r1(sumEnd)}s`)
  check('R 旗舰：激光持续扫射（每 0.1 秒 3 道，打最密处）', beams > 60 && w.stats.kills >= 55, `激光 ${beams} 道  击杀 ${w.stats.kills}/60`)
  check('R 旗舰：主炮 1.6 秒后蓄力 1.2 秒，950 打场上最大的目标', gun && near(gun.t, 1.6, 0.05) && near(gun.delay, 1.2) && near(gun.x, 2) && near(gun.z, -6) && near(gunHit, 950 - 1.5, 0.01) && stop === 60, `锁定 (${gun && gun.x}, ${gun && gun.z}) @${gun && r1(gun.t)}s  巨畸体吃 ${gunHit}`)
  check('R 旗舰：伤害记入 dmgByPower.hawk_flagship', w.stats.dmgByPower.hawk_flagship > 2000 && sumUnitDmg(w) === 0, `${Math.round(w.stats.dmgByPower.hawk_flagship)}`)
  const w2 = sandbox('hawk')
  benchHero(w2)
  spawnBoss(w2, 'matriarch'); w2.boss.hp = w2.boss.hpMax = 1e6
  charge(w2, 'hawk_flagship'); stepOnce(w2, press('r'))
  let bossBig = 0
  run(w2, 4, { on: e => { if (e.type === 'bigHit' && e.dmg > bossBig) bossBig = e.dmg } })
  check('R 旗舰：主炮对 Boss 1300（护甲 1）', near(bossBig, 1299, 0.01), `Boss 单发吃 ${bossBig}`)
}

{
  // 霍克本人：17 米贯穿射线，吃突击兵升级
  const w = sandbox('hawk')
  w.enemySpeedMul = 0; w.progress.overdriveUntil = 0
  const far = put(w, 'crusher', 0, 8.1 - 16, 1e5)
  let shots = 0, hit = 0
  run(w, 2, { on: e => { if (e.type === 'shot' && e.kind === 'hero_hawk') shots++; if (e.type === 'enemyHit' && e.i === far && !hit) hit = e.dmg } })
  const base = shots
  const w2 = sandbox('hawk')
  w2.enemySpeedMul = 0; w2.progress.overdriveUntil = 0
  grantModule(w2, 'rifle_rate'); grantModule(w2, 'rifle_rate')
  put(w2, 'crusher', 0, 8.1 - 16, 1e5)
  let shots2 = 0
  run(w2, 2, { on: e => { if (e.type === 'shot' && e.kind === 'hero_hawk') shots2++ } })
  check('霍克本人：射程 17 米（突击兵 11 米够不到的他能打），吃突击兵的射速升级', base > 5 && near(hit, 4.5) && shots2 / base > 1.3 && w.stats.dmgByUnit.hero_hawk > 0, `16 米外 2 秒 ${base} 发，单发 ${hit}；快拆弹匣 ×2 后 ${shots2} 发`)
  const w3 = sandbox('hawk')
  w3.enemySpeedMul = 0
  // 布防系统之后：虫贴近队伍的最后一段（z > 1.5）会按「本道中心 ± 个体散布」横向散开。
  // 这里量的是一发子弹能穿几只，要让这一串虫留在一条直线上：把个体散布钉在正中（seed = 0.5）
  for (let k = 0; k < 8; k++) { const i = put(w3, 'ling', 0, 4 - k * 1, 3); w3.swarm.seed[i] = 0.5 }
  let firstKills = 0
  run(w3, 0.3, { each: w => { if (!firstKills && w.stats.kills) firstKills = w.stats.kills } })
  check('霍克本人：一发贯穿一串（目标 + 身后 4 只）', firstKills === 5, `第一发击杀 ${firstKills}/8`)
  damageUnit(w3, w3.squad.hero, 999)
  stepOnce(w3)
  const w4 = createWorld({ seed: 1, commander: 'hawk' })
  damageUnit(w4, w4.squad.hero, 999)
  w4.step(null)
  check('英雄阵亡不算输（队里还有人就继续打）', w3.squad.hero === null && w4.status === 'running' && w4.squad.hero === null && w4.squad.counts.hero_hawk === 0)
}

// ============================================================ 「棱镜」伊瑟拉

{
  // Q 轨道轰击
  const w = sandbox('ysera')
  benchHero(w); w.enemySpeedMul = 0
  const heavy = put(w, 'crusher', 0, -5, 5000)
  const light = []
  for (let k = 0; k < 40; k++) light.push(put(w, 'ling', -1.5 + (k % 8) * 0.4, -6 + ((k / 8) | 0) * 0.4, 500))
  charge(w, 'ysera_orbital')
  const strikes = []
  stepOnce(w, press('q'), e => { if (e.type === 'strike') strikes.push(e) })
  let hv = 0, lt = 0
  run(w, 1.5, { on: e => { if (e.type === 'bigHit' || e.type === 'enemyHit') { if (e.i === heavy && !hv) hv = e.dmg; else if (light.includes(e.i) && !lt) lt = e.dmg } } })
  check('Q 轨道轰击：5 发落在最密处，每发 80，对重甲 ×2', strikes.length === 5 && strikes.every(e => e.kind === 'orbital' && Math.abs(e.x) < 5 && e.z < -2) && near(lt, 80) && near(hv, 159.5), `落点 ${strikes.map(e => `(${r1(e.x)},${r1(e.z)})`).join(' ')}  轻甲 ${lt}  重甲 ${hv}`)
  check('Q 轨道轰击：伤害记入 dmgByPower.ysera_orbital', w.stats.dmgByPower.ysera_orbital > 1000 && sumUnitDmg(w) === 0, `${Math.round(w.stats.dmgByPower.ysera_orbital)}`)
  // 没有目标：不放、不耗充能
  const w2 = sandbox('ysera')
  charge(w2, 'ysera_orbital')
  stepOnce(w2, press('q'))
  check('Q 轨道轰击：场上没有目标时不释放、不消耗充能', power(w2, 'ysera_orbital').charges === 1 && power(w2, 'ysera_orbital').casts === 0)
}

{
  // W 日冕长矛：划线瞄准
  const w = sandbox('ysera')
  benchHero(w); w.enemySpeedMul = 0
  // 斜线 (-4, 6) → (4, -10)
  const on = [], off = []
  for (let k = 1; k <= 7; k++) { const f = k / 8; on.push(put(w, 'crusher', -4 + 8 * f, 6 - 16 * f, 1000)) }
  for (let k = 1; k <= 3; k++) { const f = k / 4; off.push(put(w, 'crusher', -4 + 8 * f + 3.6, 6 - 16 * f + 1.8, 1000)) }
  charge(w, 'ysera_lance')
  let start = null
  stepOnce(w, press('w'), e => { if (e.type === 'aimStart') start = e })
  const aimState = { status: w.status, ts: w.timeScale, aiming: w.aiming && w.aiming.power, left: w.aiming && w.aiming.timeLeft, charges: power(w, 'ysera_lance').charges }
  check('W 日冕长矛：按下进入 status=aiming，timeScale=0.25，world.aiming 给出技能与自动线', aimState.status === 'aiming' && aimState.ts === 0.25 && aimState.aiming === 'ysera_lance' && aimState.left > 1.9 && aimState.charges === 1 && start && start.timeout === 2 && near(start.auto.x0, start.auto.x1), `timeLeft ${r1(aimState.left)}  充能未扣 ${aimState.charges}`)
  // 瞄准期间模拟照常推进（只是表现层按 0.25 倍速喂步）
  const tBefore = w.time
  stepOnce(w)
  const advanced = w.time > tBefore && w.status === 'aiming'
  let end = null, beam = null, zones = 0
  stepOnce(w, aimAt(-4, 6, 4, -10), e => { if (e.type === 'aimEnd') end = e; if (e.type === 'beam') beam = e; if (e.type === 'zone' && e.zone === 'lance') zones++ })
  const s = w.swarm
  const hitOn = on.filter(i => near(s.hp[i], 890)).length, hitOff = off.filter(i => s.hp[i] < 1000).length
  check('W 日冕长矛：input.aim 给出线段即释放，沿线 110（无视护甲），线外不伤', advanced && end && end.how === 'aim' && w.status === 'running' && w.timeScale === 1 && w.aiming === null && beam && near(beam.x0, -4) && near(beam.z1, -10) && hitOn === on.length && hitOff === 0, `线上 ${hitOn}/${on.length} 各吃 110  线外 ${hitOff}/${off.length}`)
  const mid = on.map(i => s.hp[i])
  run(w, 3)
  const burned = on.filter((i, k) => s.hp[i] < mid[k] - 30).length
  check('W 日冕长矛：余烬沿线再烧 2.5 秒，伤害记入 dmgByPower.ysera_lance', zones >= 8 && burned === on.length && w.zones.length === 0 && w.stats.dmgByPower.ysera_lance > 7 * 150 && sumUnitDmg(w) === 0, `灼烧区 ${zones} 片  dmgByPower ${Math.round(w.stats.dmgByPower.ysera_lance)}`)

  // 超时：2 秒（真实时间）= 0.25 倍速下 30 步，自动直线释放
  const w2 = sandbox('ysera')
  benchHero(w2); w2.enemySpeedMul = 0
  w2.squad.x = w2.squad.targetX = 2
  const ahead = put(w2, 'crusher', 2, -4, 1000), side = put(w2, 'crusher', -3, -4, 1000)
  charge(w2, 'ysera_lance')
  stepOnce(w2, press('w'))
  let steps = 0, how = null, beam2 = null
  while (w2.status === 'aiming' && steps < 100) { steps++; stepOnce(w2, null, e => { if (e.type === 'aimEnd') how = e.how; if (e.type === 'beam') beam2 = e }) }
  check('W 日冕长矛：2 秒不划线 → 超时自动直线释放（0.25 倍速下 30 步）', steps === 30 && how === 'timeout' && beam2 && near(beam2.x0, 2, 0.05) && near(beam2.x1, 2, 0.05) && beam2.z1 < beam2.z0 - 20 && near(w2.swarm.hp[ahead], 890) && w2.swarm.hp[side] === 1000 && w2.status === 'running' && w2.timeScale === 1 && power(w2, 'ysera_lance').charges === 0, `${steps} 步后释放  方式 ${how}  光束 x=${beam2 && r1(beam2.x0)} z ${beam2 && r1(beam2.z0)}→${beam2 && r1(beam2.z1)}`)

  // 再按一次同键 = 立刻按自动线放；划得太短 = 用自动线
  const w3 = sandbox('ysera')
  charge(w3, 'ysera_lance')
  stepOnce(w3, press('w'))
  let how3 = null
  stepOnce(w3, press('w'), e => { if (e.type === 'aimEnd') how3 = e.how })
  const w4 = sandbox('ysera')
  charge(w4, 'ysera_lance')
  stepOnce(w4, press('w'))
  let beam4 = null
  stepOnce(w4, aimAt(1, 1, 1.1, 1.1), e => { if (e.type === 'beam' && e.kind === 'ysera_lance') beam4 = e })
  check('瞄准：再按一次同键立刻按自动线释放；线段退化成一个点时也用自动线', how3 === 'key' && w3.status === 'running' && beam4 && near(beam4.x0, beam4.x1) && beam4.z0 - beam4.z1 > 20)

  // 对 Boss 250
  const w5 = sandbox('ysera')
  benchHero(w5)
  spawnBoss(w5, 'matriarch'); w5.boss.hp = w5.boss.hpMax = 1e6; w5.boss.z = -10
  charge(w5, 'ysera_lance'); stepOnce(w5, press('w'))
  let hit5 = 0
  stepOnce(w5, aimAt(0, 7, w5.boss.x, w5.boss.z), e => { if (e.type === 'bigHit' && !hit5) hit5 = e.dmg })
  check('W 日冕长矛：对 Boss 250', near(hit5, 250), `Boss 吃 ${hit5}`)
  // Boss 倒下时还在瞄准：取消、不扣充能
  const w6 = sandbox('ysera')
  spawnBoss(w6, 'ravager')
  charge(w6, 'ysera_lance'); stepOnce(w6, press('w'))
  w6.boss.phase = w6.boss._def.phases.length     // 阶段走完：Boss 的阶段阈值会封顶单下伤害（第 1 轮测试加的），这里要一下打死
  damageBoss(w6, 1e9, 'rifle', null, null)
  let how6 = null
  for (let n = 0; n < 40 && how6 === null; n++) stepOnce(w6, null, e => { if (e.type === 'aimEnd') how6 = e.how })
  check('瞄准中 Boss 倒下：瞄准取消、不扣充能，交给子弹时间', how6 === 'cancel' && power(w6, 'ysera_lance').charges === 1 && w6.aiming === null, `aimEnd.how = ${how6}`)
}

{
  // R 日蚀
  const w = sandbox('ysera')
  benchHero(w); w.enemySpeedMul = 0
  for (let k = 0; k < 200; k++) put(w, 'crusher', -6 + (k % 20) * 0.63, -16 + ((k / 20) | 0) * 2, 1e5)
  charge(w, 'ysera_eclipse')
  stepOnce(w, press('r'))
  let shots = 0, last = 0
  const t0 = w.time
  run(w, 11, { on: (e, w) => { if (e.type === 'explosion' && e.kind === 'ysera_eclipse') { shots++; last = w.time - t0 } } })
  check('R 日蚀：10 秒 250 发全屏轰炸', shots >= 248 && shots <= 251 && near(last, 10, 0.1), `${shots} 发  最后一发 @${r1(last)}s`)
  check('R 日蚀：伤害记入 dmgByPower.ysera_eclipse', w.stats.dmgByPower.ysera_eclipse > 250 * 23 && sumUnitDmg(w) === 0, `${Math.round(w.stats.dmgByPower.ysera_eclipse)}`)
}

{
  // 被动 守护之壳
  const w = sandbox('ysera')
  addUnits(w, 'rifle', 1, 'test')
  const u = w.squad.units.find(u => u.kind === 'rifle')
  let aegis = null
  stepOnce(w)
  damageUnit(w, u, 999)
  for (const e of w.events) if (e.type === 'aegis') aegis = e
  const saved = u.alive && near(u.hp, u.hpMax * 0.15)
  damageUnit(w, u, 999)
  const invuln = u.alive
  run(w, 1.4)
  damageUnit(w, u, 999)
  const stillInvuln = u.alive
  run(w, 0.2)
  damageUnit(w, u, 999)
  // 期望变更（第 3 轮）：每单位 60 → 90 秒一次（读数据）。理由：敌人伤害上调后免死在无尽深层太值钱，伊瑟拉比霍克 / 老猫深 2.25~3 层（test-endless ⑫ 要求 ≤ 2）
  const ACD = PASSIVES.aegis.cd
  check(`被动 守护之壳：致命伤改为 1.5 秒无敌并回 15% 血；${ACD} 秒内第二次照常阵亡`, saved && aegis && near(aegis.dur, 1.5) && invuln && stillInvuln && !u.alive, `救回时血 ${r1(u.hpMax * 0.15)}/${u.hpMax}`)
  const w2 = sandbox('ysera')
  addUnits(w2, 'rifle', 1, 'test')
  const u2 = w2.squad.units.find(u => u.kind === 'rifle')
  damageUnit(w2, u2, 999)
  run(w2, ACD + 0.1)
  damageUnit(w2, u2, 999)
  const again = u2.alive
  const w3 = sandbox('hawk')
  addUnits(w3, 'rifle', 1, 'test')
  const u3 = w3.squad.units.find(u => u.kind === 'rifle')
  damageUnit(w3, u3, 999)
  check(`被动 守护之壳：每个单位 ${ACD} 秒一次；别的指挥官没有这个被动`, again && !u3.alive)
  // 伊瑟拉本人：护盾 + 近战
  const w4 = sandbox('ysera')
  w4.enemySpeedMul = 0; w4.progress.overdriveUntil = 0
  const hero = w4.squad.hero, shield0 = hero.shield
  const near1 = put(w4, 'crusher', 0.5, 6, 5000), far1 = put(w4, 'crusher', 0, -2, 5000), side1 = put(w4, 'crusher', 3, -2, 5000)
  let slashes = 0, lunges = 0, slashDmg = 0, lungeDmg = 0, lungeLen = 0
  const ts = []
  run(w4, 6.5, { on: (e, w) => {
    if (e.type === 'melee') { if (e.lunge) { lunges++; lungeLen = e.len; ts.push(w.time) } else slashes++ }
    if (e.type === 'enemyHit' && e.i === near1 && near(e.dmg, 7)) slashDmg = e.dmg
    if (e.type === 'enemyHit' && e.i === far1) lungeDmg = e.dmg
  } })
  check('伊瑟拉本人：自带护盾 40，近身挥砍 7（无视护甲），每 2 秒向前突刺 12 米（30）', shield0 === 40 && hero.kind === 'hero_ysera' && slashes >= 8 && near(slashDmg, 7) && lunges >= 3 && lunges <= 4 && ts[1] - ts[0] >= 2 && ts[1] - ts[0] <= 2.45 && near(lungeLen, 12) && near(lungeDmg, 30) && w4.swarm.hp[side1] === 5000 && w4.stats.dmgByUnit.hero_ysera > 200, `挥砍 ${slashes} 刀  突刺 ${lunges} 次（10 米外的目标吃 ${lungeDmg}，旁边 3 米的没事）`)
}

// ============================================================ 「扳手」老猫

{
  // Q 铁罐空投
  const w = sandbox('joe')
  benchHero(w); w.enemySpeedMul = 0
  const ids = []
  for (let k = 0; k < 80; k++) ids.push(put(w, 'crusher', -3 + (k % 10) * 0.6, -8 + ((k / 10) | 0) * 0.6, 2000))
  charge(w, 'joe_drop')
  const strikes = []
  stepOnce(w, press('q'), e => { if (e.type === 'strike') strikes.push(e) })
  const robotsBefore = w.summons.length
  run(w, 1)
  const s = w.swarm
  const stunned = ids.filter(i => s.state[i] === 4).length
  const landed = ids.filter(i => s.hp[i] <= 2000 - 39.5).length
  const robots = w.summons.filter(r => r.kind === 'robot')
  const d0 = w.stats.dmgByPower.joe_drop
  run(w, 3)
  const after = ids.filter(i => s.state[i] === 4).length
  const melee = w.stats.dmgByPower.joe_drop - d0
  check('Q 铁罐空投：4 台机器人砸进最密处，落地 40 并眩晕 1.5 秒', strikes.length === 4 && strikes.every(e => e.kind === 'robot') && robotsBefore === 0 && robots.length === 4 && stunned >= 20 && landed >= 20 && after === 0, `落地命中 ${landed} 只  眩晕 ${stunned} 只（1.5 秒后 ${after} 只）`)
  check('Q 铁罐空投：机器人自己找虫打（9 伤 / 0.5 秒），伤害记入 dmgByPower.joe_drop', melee > 4 * 6 * 8.5 * 2 && sumUnitDmg(w) === 0 && robots.every(r => r.fireT > 0), `3 秒近战伤害 ${Math.round(melee)}`)
  let ended = 0
  run(w, 12, { on: e => { if (e.type === 'summonEnd' && e.kind === 'robot') ended++ } })
  check('Q 铁罐空投：机器人存活 15 秒', ended === 4 && w.summons.length === 0)
}

{
  // W 雷区：划线布雷
  const w = sandbox('joe')
  benchHero(w)
  charge(w, 'joe_mines')
  stepOnce(w, press('w'))
  const aiming = w.status === 'aiming' && w.aiming.power === 'joe_mines'
  const strikes = []
  stepOnce(w, aimAt(-4.5, 2, 4.5, 0), e => { if (e.type === 'strike') strikes.push(e) })
  const mines = w.zones.filter(z => z.type === 'mine')
  const onLine = mines.every(m => near(m.z, 2 - (m.x + 4.5) / 9 * 2, 0.01))
  check('W 雷区：沿划出的线布 10 颗雷（world.zones type=mine）', aiming && mines.length === 10 && strikes.length === 10 && strikes.every(e => e.kind === 'mine') && onLine && near(mines[0].x, -4.5) && near(mines[9].x, 4.5))
  // 一只虫走进来：踩中的那颗炸，别的不动
  w.enemySpeedMul = 0.5
  run(w, 0.5)
  const victim = put(w, 'crusher', -5.5, -1, 1000)
  let boom = null, took = 0
  run(w, 3, { on: e => { if (e.type === 'explosion' && e.kind === 'joe_mines' && !boom) boom = e; if (e.type === 'enemyHit' && e.i === victim) took += e.dmg } })
  const left = w.zones.filter(z => z.type === 'mine').length
  check('W 雷区：虫进入 1.3 米触发，炸 110（半径 2.6），只炸踩中的那颗', POWERS.joe_mines.dmg === 110 && POWERS.joe_mines.r === 2.6 && boom && near(boom.x, -4.5) && near(boom.r, 2.6) && near(took, 109.5, 0.01) && left === 9 && near(w.stats.dmgByPower.joe_mines, 109.5, 0.01), `剩 ${left} 颗  甲壳兽吃 ${took}`)
  run(w, 20)
  check('W 雷区：没踩的雷 20 秒后失效', w.zones.filter(z => z.type === 'mine').length === 0)
  // 飞行虫不触发
  const w1 = sandbox('joe')
  benchHero(w1); w1.enemySpeedMul = 0
  charge(w1, 'joe_mines'); stepOnce(w1, press('w')); stepOnce(w1, aimAt(-4.5, 0, 4.5, 0))
  put(w1, 'wing', 0, 0.2, 100)
  run(w1, 1.5)
  check('W 雷区：飞行虫不触发', w1.zones.filter(z => z.type === 'mine').length === 10)
  // 超时自动：横在阵前
  const w2 = sandbox('joe')
  benchHero(w2)
  charge(w2, 'joe_mines'); stepOnce(w2, press('w'))
  let steps = 0, how = null
  while (w2.status === 'aiming' && steps < 100) { steps++; stepOnce(w2, null, e => { if (e.type === 'aimEnd') how = e.how }) }
  const m2 = w2.zones.filter(z => z.type === 'mine')
  check('W 雷区：2 秒不划线 → 超时自动横在阵前 9 米', POWERS.joe_mines.ahead === 9 && steps === 30 && how === 'timeout' && m2.length === 10 && m2.every(m => near(m.z, 8.1 - 9)) && near(m2[9].x - m2[0].x, 11), `${steps} 步  z=${m2[0] && r1(m2[0].z)}  宽 ${m2[0] && r1(m2[9].x - m2[0].x)}`)
}

{
  // R 汇聚射线
  const w = sandbox('joe')
  benchHero(w); w.enemySpeedMul = 0
  const ids = []
  for (let k = 0; k < 60; k++) ids.push(put(w, 'crusher', -6 + (k % 12) * 1.09, -20 + ((k / 12) | 0) * 6, 1000))
  const wing = put(w, 'wing', 3, -5, 1000)
  charge(w, 'joe_ray')
  let beam = null
  stepOnce(w, press('r'), e => { if (e.type === 'beam') beam = e })
  const ray = w.summons[0]
  const x0 = ray.x
  // 甲壳兽脱战会回血，所以数受击事件而不是看剩余血量
  const hitN = new Map()
  const on = e => { if (e.type === 'bigHit') return; if (e.type === 'enemyHit') hitN.set(e.i, (hitN.get(e.i) || 0) + (near(e.dmg, 200) ? 1 : 100)) }
  run(w, 0.7, { on })
  const xMid = ray.x
  const s = w.swarm
  const half = ids.filter(i => hitN.get(i) === 1).length
  run(w, 1, { on })
  const all = ids.filter(i => hitN.get(i) === 1).length
  check('R 汇聚射线：1.4 秒从桥一侧扫到另一侧（world.summons 里的 ray.x 在走）', ray.kind === 'ray' && beam && near(beam.dur, 1.4) && x0 < -6 && Math.abs(xMid) < 1 && half > 20 && half < 40 && w.summons.length === 0, `x ${r1(x0)} → ${r1(xMid)} → 结束  半程命中 ${half}/60`)
  check('R 汇聚射线：全桥每只虫恰好吃一次 200（无视护甲，对空也算），记入 dmgByPower.joe_ray', POWERS.joe_ray.dmg === 200 && all === 60 && hitN.get(wing) === 1 && near(w.stats.dmgByPower.joe_ray, 61 * 200, 0.5) && sumUnitDmg(w) === 0, `${all}/60 只各 −200  dmgByPower ${Math.round(w.stats.dmgByPower.joe_ray)}`)
  const w2 = sandbox('joe')
  benchHero(w2)
  spawnBoss(w2, 'matriarch'); w2.boss.hp = w2.boss.hpMax = 1e6
  charge(w2, 'joe_ray'); stepOnce(w2, press('r'))
  run(w2, 1.6)
  check('R 汇聚射线：对 Boss 1200，只算一次', near(w2.stats.dmgByPower.joe_ray, 1200, 0.01), `${w2.stats.dmgByPower.joe_ray}`)
}

{
  // 被动 钻机 + 回收程序。老猫自己的步行机也算一台机械，吃「超频」的射速加成
  const OC = 1 + PASSIVES.overclock.per
  const w = sandbox('joe')
  w.enemySpeedMul = 0; w.progress.overdriveUntil = 0
  const small = put(w, 'crusher', 0, 4, 500), big = put(w, 'hulk', 3, -6, 9000)
  run(w, 5)
  const dps = (9000 - w.swarm.hp[big]) / 5
  check('被动 钻机：常驻 45/秒烧场上血最厚的目标（不是最近的）', UNITS.hero_joe.weapon.dmg === 4.5 && near(dps, 45 * OC, 1.5) && w.swarm.hp[small] === 500 && near(w.stats.dmgByUnit.hero_joe, 9000 - w.swarm.hp[big], 0.01), `巨畸体每秒掉 ${dps.toFixed(1)}  近处的甲壳兽没挨打`)
  const wb = sandbox('joe')
  spawnBoss(wb, 'matriarch'); wb.boss.hp = wb.boss.hpMax = 1e6
  wb.progress.overdriveUntil = 0
  run(wb, 3)      // 等巢母走进 20 米射程
  const b0 = wb.boss.hp
  run(wb, 4)
  check('被动 钻机：对 Boss 40/秒', near((b0 - wb.boss.hp) / 4, 40 * OC, 2.5), `${((b0 - wb.boss.hp) / 4).toFixed(1)}/s`)

  const w2 = sandbox('joe')
  addUnits(w2, 'mortar', 1, 'test'); addUnits(w2, 'rifle', 1, 'test')
  stepOnce(w2)
  const mortar = w2.squad.units.find(u => u.kind === 'mortar'), rifle = w2.squad.units.find(u => u.kind === 'rifle'), hero = w2.squad.hero
  damageUnit(w2, mortar, 999); damageUnit(w2, rifle, 999); damageUnit(w2, hero, 999)
  stepOnce(w2)
  const gone = w2.squad.counts.mortar === 0 && w2.squad.counts.hero_joe === 0 && w2.squad.hero === null
  let rebuilt = [], at = 0
  run(w2, 19.5)
  const early = w2.squad.counts.mortar
  run(w2, 1, { on: (e, w) => { if (e.type === 'unitJoin' && e.source === 'rebuild') { rebuilt.push(e.kind); at = w.time } } })
  check('被动 回收程序：机械单位（自行炮、老猫的步行机）被毁 20 秒后重建，步兵不会', gone && early === 0 && rebuilt.sort().join() === 'hero_joe,mortar' && near(at, 20, 0.1) && w2.squad.counts.mortar === 1 && w2.squad.hero !== null && w2.squad.counts.rifle === 0, `重建 ${rebuilt.join(' + ')} @${r1(at)}s`)
  const m2 = w2.squad.units.find(u => u.kind === 'mortar')
  m2.hp = 10; m2.hitT = w2.time
  run(w2, 1.9)
  const hpA = m2.hp
  run(w2, 2)
  check('被动 回收程序：机械单位脱战 2 秒后每秒回 4', hpA === 10 && near(m2.hp, 10 + 4 * 1.9, 0.5), `10 → ${r1(m2.hp)}`)
  // 战地维修对步兵也生效，只是慢（每秒 1.5）。挨打会打断
  addUnits(w2, 'rifle', 2, 'test')
  stepOnce(w2)
  const [ra, rb] = w2.squad.units.filter(u => u.kind === 'rifle')
  ra.hp = 2; ra.hitT = w2.time; rb.hp = 2; rb.hitT = w2.time
  run(w2, 1.9)
  const footA = ra.hp
  rb.hitT = w2.time
  run(w2, 2)
  check('被动 回收程序：步兵脱战 2 秒后每秒回 1.5，挨打会打断', PASSIVES.rebuild.regenFoot === 1.5 && footA === 2 && near(ra.hp, 2 + 1.5 * 1.9, 0.3) && rb.hp < ra.hp - 2, `2 → ${r1(ra.hp)}（刚挨过打的那个 ${r1(rb.hp)}）`)
  const w3 = sandbox('hawk')
  addUnits(w3, 'mortar', 1, 'test')
  damageUnit(w3, w3.squad.units.find(u => u.kind === 'mortar'), 999)
  run(w3, 21)
  const r3 = w3.squad.units.find(u => u.kind === 'hero_hawk')
  // 期望变更（第 2 轮）：hitT -9 → 刚挨打。理由：第 2 轮给所有步兵加了战地包扎（5 秒没挨打每秒回 1.2，FIELD_REGEN），
  // 脱战很久的单位本来就会回血；这里要验的是「回收程序那条 2 秒就开始回 1.5 的线」不存在——3 秒内一点不回
  r3.hp = 5; r3.hitT = w3.time
  run(w3, 3)
  check('别的指挥官没有回收程序', w3.squad.counts.mortar === 0 && r3.hp === 5)
}

{
  // 被动 超频：场上每台机械单位让全军射速 +1.8%，最多 +18%
  const O = PASSIVES.overclock
  const shots = (commander, mech) => {
    const w = sandbox(commander)
    if (commander !== 'none') benchHero(w)
    w.enemySpeedMul = 0; w.progress.overdriveUntil = 0
    // 指挥官局的战役威胁加码（COMMANDER_THREAT）让靶子甲壳兽的骨刺更疼，标准小队那组反而多开几枪（529 对 487 发）。
    // 这条只量射速，把敌伤系数归一，几组的靶子一样疼
    w.diff.dmgMul = 1
    addUnits(w, 'rifle', 8, 'test')
    if (mech > 0) addUnits(w, 'mortar', mech, 'test', null, true)
    put(w, 'crusher', 0, 3, 1e7)
    run(w, 1)
    let n = 0
    run(w, 10, { on: e => { if (e.type === 'shot' && e.kind === 'rifle') n++ } })
    return n
  }
  const base = shots('joe', 0), four = shots('joe', 4), many = shots('joe', 14), hawk = shots('hawk', 4), none = shots('none', 4)
  // 期望变更：每台 +3% / 封顶 +30% → +1.8% / +18%。理由：老猫的「回收程序」加上了装置花费 -20% / 损毁返还 50%（GDD §13），
  // 不把超频压下来的话他在无尽里比另外两位深 2~3 层（8 个种子均 20.1 层对 17.5 / 18.0；压到现值后 18.3），test-endless ⑫ 过不去。
  const oc = n => 1 + Math.min(O.max, O.per * n)
  check('被动 超频：4 台机械 → 全军射速 +7.2%；14 台封顶 +18%', O.per === 0.018 && O.max === 0.18 && near(four / base, oc(4), 0.025) && near(many / base, oc(14), 0.03), `0 台 ${base} 发  4 台 ${four} 发（×${(four / base).toFixed(3)}）  14 台 ${many} 发（×${(many / base).toFixed(3)}）`)
  check('被动 超频：只有老猫有', near(hawk / base, 1, 0.02) && near(none / base, 1, 0.02) && COMMANDERS.joe.passives.includes('overclock') && !COMMANDERS.hawk.passives.includes('overclock') && !COMMANDERS.ysera.passives.includes('overclock'), `霍克 ${hawk}  标准小队 ${none}`)
}

// ============================================================ 技能子事件对账

{
  const rows = [], miss = []
  for (const p of Object.values(POWERS)) {
    const got = seen[p.id] || new Set()
    // 只对账技能专属的子事件；通用的伤害 / 治疗 / 加入事件不在这里查
    const need = p.events.filter(t => t === 'powerCast' || t.startsWith('strike:') || t.startsWith('summon') || t === 'beam' || t === 'explosion' || t.startsWith('aim'))
    for (const t of need) if (!got.has(t)) miss.push(`${p.id}:${t}`)
    for (const t of got) if (!p.events.includes(t)) miss.push(`${p.id} 多发了 ${t}`)
    for (const t of p.events) if (!EVENT_TYPES.has(t.split(':')[0])) miss.push(`${p.id}:${t} 未登记`)
    rows.push(`${p.id}[${[...got].join(' ')}]`)
  }
  check('每个技能实际发出的子事件 = data/commanders.js 里登记的 events，且类型都已登记', miss.length === 0, miss.join(', ') || `${Object.keys(POWERS).length} 个技能`)
}

// ============================================================ 舰队后勤只在带指挥官时出现

{
  const offered = commander => {
    const ids = new Set()
    for (let seed = 1; seed <= 4; seed++) {
      let last = null
      runHeadless({ seed, commander, draft: 'random', onStep: w => { if (w.levelup && w.levelup !== last) { last = w.levelup; for (const c of w.levelup.cards) ids.add(c.id) } } })
    }
    return ids
  }
  const none = offered('none'), hawk = offered('hawk')
  check('「舰队后勤」只在带指挥官时出现', !none.has('gen_logistics') && hawk.has('gen_logistics'), `标准小队见过 ${none.size} 种牌、霍克见过 ${hawk.size} 种牌`)
}

// ============================================================ 突变因子

{
  check('四个突变因子：swift / resonance / undying / acidrain', MUTATOR_IDS.join() === 'swift,resonance,undying,acidrain')
  // 生效时机：拿到第 (突变数 + 1) 个升级后
  for (const muts of [['swift'], ['swift', 'undying', 'acidrain']]) {
    const armedAt = []
    let early = false
    const run1 = runHeadless({ seed: 2, bot: 'good', mutators: muts, checkEvents: true, onStep: w => {
      for (const e of w.events) if (e.type === 'mutator') armedAt.push({ id: e.id, upgrades: w.progress.upgrades, t: w.time })
      if (w.progress.upgrades < muts.length + 1 && (w.mut.armed || w.mutators.some(m => m.active))) early = true
    } })
    if (run1.badEvent && !badEvent) badEvent = run1.badEvent
    check(`突变 ×${muts.length}：拿到第 ${muts.length + 1} 个升级后一起生效`, !early && armedAt.length === muts.length && armedAt.every(a => a.upgrades === muts.length + 1) && run1.world.mutators.every(m => m.active), `生效于 ${armedAt[0] && r1(armedAt[0].t)}s（第 ${armedAt[0] && armedAt[0].upgrades} 个升级）  结果 ${run1.result.outcome}`)
  }
  // 疾行：敌速 ×1.2
  const a = createWorld({ seed: 3 }), b = createWorld({ seed: 3, mutators: ['swift'] })
  // 期望变更：跑 40 秒 → 70 秒再量。理由：疾行要等第 2 次升级才生效，时间轴拉伸后第 2 次升级从 20 秒上下推到了 45 秒上下
  // 期望变更（第 2 轮）：固定步数 → 跑到同一个 world.time。理由：升级面板打开时时间不走，两边升级次数 / 时刻一不同，
  // 固定步数跑完的时刻就不同，虫速曲线（SPEED_CURVE）取到的值也不同——比的不再只是突变本身
  const play = (w, bot) => { for (let n = 0; n < 60 * 200 && w.time < 70; n++) w.step(bot(w)) }
  play(a, createBot('good', 3)); play(b, createBot('good', 3))
  check('疾行：敌人移速 ×1.2', b.mut.armed && near(b.enemySpeedMul / a.enemySpeedMul, 1.2, 1e-6) && a.mut.speedMul === 1, `${a.enemySpeedMul.toFixed(3)} → ${b.enemySpeedMul.toFixed(3)}`)
}

{
  // 甲壳共振
  const w = sandbox('none', { mutators: ['resonance'] })
  w.enemySpeedMul = 0
  const i = put(w, 'crusher', 0, -5, 1000)
  const s = w.swarm
  hitEnemy(w, i, 10, 'rifle', null, true, null, false)
  const hp1 = s.hp[i], sh1 = s.shield[i]
  hitEnemy(w, i, 50, 'rifle', null, true, null, false)
  const hp2 = s.hp[i], sh2 = s.shield[i]
  hitEnemy(w, i, 350, 'rifle', null, true, null, false)
  const hp3 = s.hp[i], sh3 = s.shield[i]
  check('甲壳共振：第一次受伤后获得 35% 最大生命的护盾，护盾先吃伤害', MUTATORS.resonance.frac === 0.35 && hp1 === 990 && sh1 === 350 && hp2 === 990 && sh2 === 300 && hp3 === 940 && sh3 === 0, `血 ${hp1}/${hp2}/${hp3}  盾 ${sh1}/${sh2}/${sh3}`)
  hitEnemy(w, i, 10, 'rifle', null, true, null, false)
  check('甲壳共振：每只虫只触发一次', s.shield[i] === 0 && s.hp[i] === 930)
  const j = put(w, 'crusher', 2, -5, 1000)
  hitEnemy(w, j, 10, 'rifle', null, true, null, false)
  run(w, 2.9)
  const still = s.shield[j]
  run(w, 0.2)
  check('甲壳共振：护盾 3 秒后消失', MUTATORS.resonance.dur === 3 && still === 350 && s.shield[j] === 0)
  const k = put(w, 'ling', 0, -8)
  check('甲壳共振：一枪打死的不触发', hitEnemy(w, k, 50, 'rifle', null, true, null, false) === true && w.stats.kills === 1)
  const w0 = sandbox()
  const i0 = put(w0, 'crusher', 0, -5, 1000)
  hitEnemy(w0, i0, 10, 'rifle', null, true, null, false)
  check('没有突变因子时不挂护盾', w0.swarm.shield[i0] === 0 && !w0.mut.armed && w0.mutators.length === 0)
}

{
  // 不死孢子
  const w = sandbox('none', { mutators: ['undying'] })
  w.enemySpeedMul = 0
  const N = 1200
  for (let k = 0; k < N; k++) put(w, 'ling', -6 + (k % 40) * 0.3, -20 + ((k / 40) | 0) * 0.5)
  const s = w.swarm
  for (let i = 0; i < s.count; i++) hitEnemy(w, i, 99, 'rifle', null, true, null, false)
  const kills1 = w.stats.kills, xp1 = w.progress.xp
  let revived = 0, firstT = -1
  const t0 = w.time
  run(w, 1.2, { on: (e, w) => { if (e.type === 'revive') { revived++; if (firstT < 0) firstT = w.time - t0 } } })
  const frac = revived / N
  check('不死孢子：25% 的敌人死后 0.9 秒原地复活', kills1 === N && frac > 0.2 && frac < 0.3 && near(firstT, 0.9, 0.03) && s.living === revived, `${revived}/${N} = ${(frac * 100).toFixed(1)}%  复活于 +${firstT.toFixed(2)}s`)
  for (let i = 0; i < s.count; i++) hitEnemy(w, i, 99, 'rifle', null, true, null, false)
  let again = 0
  run(w, 1.2, { on: e => { if (e.type === 'revive') again++ } })
  // 复活出来的那只再被打死：不计击杀、不给经验（否则这个突变等于白送 24% 的分数和经验）
  check('不死孢子：复活过的不再复活，再打死也不计击杀、不给经验', again === 0 && s.living === 0 && revived > 0 && w.stats.kills === N && w.stats.killsByUnit.rifle === N && near(w.progress.xp / xp1, 1, 1e-9), `第二轮复活 ${again}  击杀 ${w.stats.kills}/${N}  经验 ${Math.round(xp1)} → ${Math.round(w.progress.xp)}`)
}

{
  // 酸雨
  const hits = (botType) => {
    const w = sandbox('none', { mutators: ['acidrain'] })
    addUnits(w, 'rifle', 24, 'test')
    const bot = createBot(botType, 1)
    let rains = 0, hit = 0, dodged = 0, tele = 0, onSquad = 0, pools = 0
    const at = []
    run(w, 37, { input: w => bot(w), on: (e, w) => {
      if (e.type === 'acidRain') { rains++; at.push(r1(w.time)); const ts = w.telegraphs.filter(t => t.style === 'acid' && t.t0 === w.time); tele += ts.length; if (ts.some(t => near(t.x, w.squad.x, 0.01))) onSquad++ }
      if (e.type === 'acidHit') { if (e.dodged) dodged++; else if (e.hits > 0) hit++ }
      if (e.type === 'zone' && e.zone === 'acid') pools++
    } })
    return { rains, hit, dodged, tele, onSquad, pools, at, losses: w.stats.losses }
  }
  const idle = hits('idle'), good = hits('good')
  check('酸雨：每 10 秒 3 个预警圈，其中一个对准队伍；落地后留酸池', idle.rains === 4 && idle.tele === 12 && idle.onSquad === 4 && idle.pools === 12 && near(idle.at[1] - idle.at[0], 10, 0.1), `落酸时刻 ${idle.at.join(' / ')}`)
  check('酸雨：站着不动会挨，good bot 全部躲开', idle.hit === 4 && good.hit === 0 && good.dodged === 12 && good.losses === 0, `idle 中 ${idle.hit}/4 轮  good 躲开 ${good.dodged}/12 团`)
}

// ============================================================ 雇佣兵合同

{
  check('三种合同：血獒 6 人 ×1.6/×1.25/×2，重锤 ×2.2/×1.4，歌利亚每局一台', CONTRACTS.bloodhound.count === 6 && CONTRACTS.bloodhound.elite.dmgMul === 1.6 && CONTRACTS.bloodhound.elite.rateMul === 1.25 && CONTRACTS.bloodhound.elite.hpMul === 2 && CONTRACTS.hammer.elite.dmgMul === 2.2 && CONTRACTS.hammer.elite.rateMul === 1.4 && CONTRACTS.goliath.force === true)

  // 合同门：第 9 或第 10 道门（下标 8 / 9），每局一道
  const gates = {}, kinds = {}
  let okGate = true
  for (let seed = 1; seed <= 40; seed++) {
    const found = []
    const run1 = runHeadless({ seed, bot: 'idle', onStep: w => { for (const e of w.events) if (e.type === 'gateSpawn') for (const o of [e.left, e.right]) if (o.type === 'contract') found.push({ idx: e.index, o }) } })
    if (found.length !== 1 || found[0].idx !== run1.world.contractGate || !CONTRACT_GATES.includes(found[0].idx)) okGate = false
    if (found.length) {
      const f = found[0]
      gates[f.idx] = (gates[f.idx] || 0) + 1
      kinds[f.o.params.contract] = (kinds[f.o.params.contract] || 0) + 1
      if (!f.o.tags.includes('merc') || f.o.titleKey !== 'gate.contract' || !(f.o.params.nameKey in zh)) okGate = false
    }
  }
  check('合同门：每局恰好一道，出在下标 8 或 9 的门上（按种子），选项 type=contract、带 merc 标签', okGate && gates[8] > 8 && gates[9] > 8, `门 8×${gates[8]}  门 9×${gates[9]}  ` + Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(' '))
}

{
  // 空投舱：集火打破才到手
  const w = sandbox()
  w.enemySpeedMul = 0
  addUnits(w, 'rifle', 20, 'test')
  stepOnce(w)
  dropPod(w, 'bloodhound', 0.5)
  let land = null, open = null, join = null, comms = null, strike = null
  for (const e of w.events) if (e.type === 'strike') strike = e
  const t0 = w.time
  run(w, 12, { on: (e, w) => {
    if (e.type === 'podLand') land = { ...e, t: w.time - t0, pods: w.pods.length, pod: { ...w.pods[0] } }
    if (e.type === 'podOpen') open = { ...e, t: w.time - t0 }
    if (e.type === 'unitJoin' && e.source === 'contract') join = e
    if (e.type === 'comms' && e.textKey === 'comms.first_contract') comms = e
  } })
  const mercs = w.squad.units.filter(u => u.elite === 'bloodhound')
  check('合同：空投舱 0.7 秒后砸在阵前（world.pods），血 ≥ 350，并发一句通讯', strike && strike.kind === 'pod' && land && near(land.t, 0.7, 0.03) && land.pods === 1 && land.pod.hpMax >= 350 && land.pod.contract === 'bloodhound' && near(land.pod.x, 0.5) && comms !== null, `血 ${land && Math.round(land.pod.hpMax)}  落点 (${land && land.pod.x}, ${land && land.pod.z})`)
  check('合同：集火打破空投舱 → 「血獒」6 人入列（伤害 ×1.6、射速 ×1.25、生命 ×2）', open && open.contract === 'bloodhound' && w.pods.length === 0 && join && join.count === 6 && mercs.length === 6 && mercs.every(u => u.kind === 'rifle' && u.hpMax === 24 && u._baseDmg === 1.6 && u._rateMul === 1.25) && w.contract.state === 'open', `${open ? r1(open.t) : '-'} 秒打开  入列 ${mercs.length} 人`)
  check('合同：空投舱不计击杀、不给经验', w.stats.kills === 0 && w.progress.xp === 0)

  // 没人打：滑过防线 → 作废
  const w2 = sandbox()
  addUnits(w2, 'flamer', 1, 'test')       // 焚化兵够不着滑在远处的舱；等它滑过身边时挪开
  w2.squad.x = w2.squad.targetX = -4.3
  stepOnce(w2)
  dropPod(w2, 'hammer', 4)
  let lost = null, z0 = null
  const input = { moveX: null, targetX: -4.3, powers: [], aim: null, pick: null }
  run(w2, 16, { input, on: (e, w) => { if (e.type === 'podLand') z0 = e.z; if (e.type === 'podLost') lost = { ...e, t: w.time } } })
  check('合同：没打破，空投舱沿桥面滑过防线 → podLost，合同作废', lost && z0 < 0 && lost.z >= 17.2 && w2.pods.length === 0 && w2.squad.counts.mortar === 0 && w2.contract.state === 'lost' && w2.swarm.living === 0, `从 z=${z0} 滑到防线用了 ${lost && r1(lost.t - 0.7)} 秒`)

  // 重锤 / 歌利亚
  const w3 = sandbox()
  addUnits(w3, 'rifle', 30, 'test'); addUnits(w3, 'titan', 1, 'test')
  stepOnce(w3)
  dropPod(w3, 'hammer', 0)
  run(w3, 8)
  dropPod(w3, 'goliath', 0)
  run(w3, 8)
  const hammer = w3.squad.units.find(u => u.elite === 'hammer'), gol = w3.squad.units.find(u => u.elite === 'goliath')
  check('合同：「重锤」精英自行炮（×2.2 / ×1.4）、「歌利亚」巨型机甲（不占编制，可与泰坦并存）', hammer && hammer.kind === 'mortar' && hammer._baseDmg === 2.2 && hammer._rateMul === 1.4 && gol && gol.kind === 'titan' && gol._baseDmg === 3.5 && gol.hpMax === 84 * 4 && w3.squad.counts.titan === 2, `歌利亚血 ${gol && gol.hpMax}`)
}

{
  // merc bot：见合同就签。整局跑通
  const rows = []
  let wins = 0, opened = 0, lostN = 0
  for (let seed = 1; seed <= 6; seed++) {
    const run1 = runHeadless({ seed, bot: 'merc', checkEvents: true })
    const r = run1.result
    if (run1.badEvent && !badEvent) badEvent = run1.badEvent
    if (r.outcome === 'won') wins++
    if (r.contract && r.contract.state === 'open') opened++
    if (r.contract && r.contract.state === 'lost') lostN++
    const mercs = run1.world.squad.units.filter(u => u.elite).length
    rows.push(`   seed ${seed} merc: ${r.outcome} ${r.seconds}s 击杀 ${r.kills} 损失 ${r.losses}  合同 ${r.contract ? r.contract.id + '/' + r.contract.state : '无'}  终局雇佣兵 ${mercs}`)
  }
  console.log(rows.join('\n'))
  check('merc bot（见合同就签）seed 1..6：全部签到合同，多数打得开，能通关', wins === 6 && opened + lostN === 6 && opened >= 4, `${wins}/6 胜  打开 ${opened}  作废 ${lostN}`)
}

// ============================================================ 难度 / 每日挑战

{
  const w = createWorld({ seed: 1, difficulty: 'veteran' })
  const i = put(w, 'crusher', 0, -20)
  check('老兵难度：敌人生命 +35%、移速 +10%、防线 700', w.line.hpMax === 700 && near(w.swarm.hpMax[i], 145 * 1.35, 0.01) && DIFFICULTY.veteran.speedMul === 1.1)
}

{
  const a = dailyConfig('2026-09-30'), b = dailyConfig('2026-09-30'), c = dailyConfig('2026-10-01')
  const w = createWorld({ daily: true, dateKey: '2026-09-30', commander: 'none', seed: 5 })
  check('每日挑战：同一个 dateKey 派生同一组 种子 / 指挥官 / 突变，并盖掉传入的同名选项', JSON.stringify(a) === JSON.stringify(b) && a.seed !== c.seed && w.seed === a.seed && w.opts.commander === a.commander && w.opts.mutators.join() === a.mutators.join() && w.daily.dateKey === '2026-09-30' && w.squad.hero !== null, `${a.dateKey}: seed ${a.seed} / ${a.commander} / ${a.mutators.join('+')}`)
  const tally = {}, mt = {}
  let okCfg = true
  for (let d = 0; d < 365; d++) {
    const key = `2027-${String(1 + ((d / 31) | 0)).padStart(2, '0')}-${String(1 + d % 31).padStart(2, '0')}`
    const cfg = dailyConfig(key)
    tally[cfg.commander] = (tally[cfg.commander] || 0) + 1
    for (const m of cfg.mutators) mt[m] = (mt[m] || 0) + 1
    if (!COMMANDERS[cfg.commander] || cfg.mutators.length < 1 || cfg.mutators.length > 2 || new Set(cfg.mutators).size !== cfg.mutators.length || !cfg.mutators.every(m => MUTATORS[m])) okCfg = false
  }
  check('每日挑战：一年 365 天里三位指挥官、四个突变都轮得到，分布大致均匀', okCfg && COMMANDER_IDS.every(id => tally[id] > 90 && tally[id] < 155) && MUTATOR_IDS.every(id => mt[id] > 90), Object.entries(tally).map(([k, n]) => `${k} ${n}`).join('  ') + '  |  ' + Object.entries(mt).map(([k, n]) => `${k} ${n}`).join('  '))
  const r1a = JSON.stringify(runHeadless({ daily: true, dateKey: '2026-09-30' }).result)
  const r1b = JSON.stringify(runHeadless({ daily: true, dateKey: '2026-09-30' }).result)
  check('每日挑战：同一天两次对局结果完全一致', r1a === r1b)
  const rows = []
  let wins = 0
  for (let d = 1; d <= 10; d++) {
    const key = `2026-10-${String(d).padStart(2, '0')}`
    const run1 = runHeadless({ daily: true, dateKey: key, checkEvents: true })
    const r = run1.result
    if (run1.badEvent && !badEvent) badEvent = run1.badEvent
    if (r.outcome === 'won') wins++
    rows.push(`   ${key}  ${r.commander.padEnd(5)} ${r.mutators.join('+').padEnd(18)} ${r.outcome}${r.reason ? '(' + r.reason + ')' : ''}  ${r.seconds}s  击杀 ${r.kills}  损失 ${r.losses}  防线 ${r.line.hp}`)
  }
  console.log(rows.join('\n'))
  check('每日挑战：good bot 连打 10 天，至少赢 7 天', wins >= 7, `${wins}/10`)
}

// ============================================================ 整局：三位指挥官 + good bot

{
  const rows = []
  let wins = 0, total = 0, allCast = true, allDmg = true, inBand = 0
  for (const commander of COMMANDER_IDS) {
    for (let seed = 1; seed <= 5; seed++) {
      const run1 = runHeadless({ seed, commander, bot: 'good', checkEvents: true })
      const r = run1.result
      total++
      if (run1.badEvent && !badEvent) badEvent = run1.badEvent
      if (r.outcome === 'won') wins++
      // 期望变更（第 3 轮测试）：2~2.6 万 → 2.7~3.4 万。理由同 test-core ②：40 秒歼敌 ≥ 4000 / 歼敌速度 ≥ 300 的硬指标让虫潮整体加厚
      // 期望变更（第 4 轮测试）：2.7~3.4 万 → 2.2~2.7 万。理由同 test-core ②：用户要求虫潮从少到多，前 55 秒的虫量压到原来的一成多
      if (r.kills >= 22000 && r.kills <= 27000) inBand++
      for (const id of COMMANDERS[commander].powers) {
        if (!(r.powerCasts[id] >= 1)) allCast = false
        if (id !== 'hawk_rally' && id !== 'hawk_drop' && !(r.dmgByPower[id] > 0)) allDmg = false
      }
      const pw = COMMANDERS[commander].powers.map(id => `${POWERS[id].key.toUpperCase()}×${r.powerCasts[id]}${r.dmgByPower[id] ? '(' + Math.round(r.dmgByPower[id]) + ')' : ''}`).join(' ')
      rows.push(`   ${commander.padEnd(5)} seed ${seed}  ${r.outcome}  ${r.seconds}s  击杀 ${r.kills}  损失 ${r.losses}  防线 ${r.line.hp}  ${pw}  英雄 ${(100 * (r.dmgShare[COMMANDERS[commander].hero] || 0)).toFixed(1)}%`)
    }
  }
  console.log(rows.join('\n'))
  check('三位指挥官 + good bot，seed 1..5 全部获胜', wins === total, `${wins}/${total}`)
  check('good bot 每个技能都放过，伤害类技能都有伤害入账（stats.dmgByPower）', allCast && allDmg)
  // 期望变更：1~1.5 万 → 2~2.6 万。理由同 test-core ②：战役拉长后敌人总量增加，测试线是击杀 ≥ 2 万
  check('带指挥官的对局击杀在 22000~27000', inBand === total, `${inBand}/${total}`)
  const a = JSON.stringify(runHeadless({ seed: 3, commander: 'ysera', mutators: ['undying', 'acidrain'] }).result)
  const b = JSON.stringify(runHeadless({ seed: 3, commander: 'ysera', mutators: ['undying', 'acidrain'] }).result)
  check('确定性：指挥官 + 突变的对局两次结果完全一致', a === b, `result JSON ${a.length} 字节`)
  // 老兵难度 + 指挥官：只报数，不设门槛
  const vr = []
  for (const commander of COMMANDER_IDS) {
    let w = 0
    for (let seed = 1; seed <= 5; seed++) { const run1 = runHeadless({ seed, commander, difficulty: 'veteran', checkEvents: true }); if (run1.badEvent && !badEvent) badEvent = run1.badEvent; if (run1.result.outcome === 'won') w++ }
    vr.push(`${commander} ${w}/5`)
  }
  console.log(`   老兵难度 + good bot（seed 1..5）：${vr.join('  ')}`)
}

// ============================================================ 文案

{
  const need = []
  for (const c of Object.values(COMMANDERS)) need.push(c.nameKey, c.titleKey, c.descKey, c.readyKey, `comms.speaker.${c.id}`, UNITS[c.hero].nameKey, UNITS[c.hero].descKey)
  for (const p of Object.values(POWERS)) need.push(p.nameKey, p.descKey)
  for (const p of Object.values(PASSIVES)) need.push(p.nameKey, p.descKey)
  for (const m of Object.values(MUTATORS)) need.push(m.nameKey, m.descKey)
  for (const c of Object.values(CONTRACTS)) need.push(c.nameKey, c.descKey)
  need.push('gate.contract', 'comms.first_contract', 'comms.pod_lost', 'comms.mutators', 'enemy.pod.name', 'tag.hero', 'tag.merc', 'commander.none.name', 'difficulty.veteran.name', 'daily.title', 'aim.hint')
  const miss = need.filter(k => !(k in zh) || !(k in en))
  check('第 3 步文案 key 中英都有', miss.length === 0, miss.join(', ') || `${need.length} 条`)
}

// ============================================================ 测试回归
// 上一轮对抗式测试（docs/_sim-workflow-result.json 的 findings）里确认属实并修掉的问题，各留一条断言。

{
  const RETREAT = { moveX: null, targetX: null, powers: [], aim: null, pick: null, retreat: true }
  // #1 瞄准中对局结束：aimStart 要有配对的 aimEnd，技能的 aiming 标记要复位
  const w = createWorld({ seed: 1, commander: 'ysera' })
  addUnits(w, 'rifle', 20, 'test')
  enterEndless(w)
  charge(w, 'ysera_lance'); stepOnce(w, press('w'))
  const aiming = w.status === 'aiming' && power(w, 'ysera_lance').aiming === true
  let end = null, retreat = false
  stepOnce(w, RETREAT, e => { if (e.type === 'aimEnd') end = e; if (e.type === 'retreat') retreat = true })
  check('回归 #1：瞄准中撤离 → aimEnd{how: cancel}，技能的 aiming 复位', aiming && end && end.how === 'cancel' && end.id === 'ysera_lance' && retreat && w.status === 'retreated' && w.aiming === null && power(w, 'ysera_lance').aiming === false && w.timeScale === 1)
  const w2 = createWorld({ seed: 1, commander: 'joe' })
  charge(w2, 'joe_mines'); stepOnce(w2, press('w'))
  const aiming2 = w2.status === 'aiming'
  for (const u of w2.squad.units) damageUnit(w2, u, 1e9)
  let end2 = null, lose = null
  stepOnce(w2, null, e => { if (e.type === 'aimEnd') end2 = e; if (e.type === 'lose') lose = e })
  check('回归 #1：瞄准中全灭 → 同样发 aimEnd{how: cancel}', aiming2 && end2 && end2.how === 'cancel' && lose && lose.reason === 'wiped' && w2.status === 'lost' && w2.aiming === null && power(w2, 'joe_mines').aiming === false)

  // #11 选卡界面里撤离：卡面不能留在结算画面上
  const w3 = createWorld({ seed: 1 })
  addUnits(w3, 'rifle', 20, 'test')
  enterEndless(w3)
  w3.progress.xp = w3.progress.xpNext
  stepOnce(w3)
  const picking = w3.status === 'levelup' && w3.levelup !== null
  stepOnce(w3, RETREAT)
  check('回归 #11：选卡界面里撤离 → world.levelup 清空', picking && w3.status === 'retreated' && w3.levelup === null)

  // #6 歌利亚 / 先遣队送的重型不占编制：入列后别人的名额不变
  const w4 = sandbox()
  const room0 = capRoom(w4, 'titan')
  addUnits(w4, 'titan', 1, 'contract', CONTRACTS.goliath.elite, true)
  const roomG = capRoom(w4, 'titan')
  const n1 = addUnits(w4, 'titan', 1, 'test'), n2 = addUnits(w4, 'lancer', 1, 'test'), n3 = addUnits(w4, 'reaper', 1, 'test')
  check('回归 #6：歌利亚不占编制——普通泰坦的名额和重型总额都不被它挤掉', room0 === 1 && roomG === 1 && n1 === 1 && n2 === 1 && n3 === 1 && w4.squad.counts.titan === 2 && w4.squad.freeCounts.titan === 1 && capRoom(w4, 'psion') === 0 && capRoom(w4, 'titan') === 0,
    `拿歌利亚前后 泰坦名额 ${room0} → ${roomG}  之后还进得来 泰坦 ${n1} / 破城 ${n2} / 裁决 ${n3}`)
  damageUnit(w4, w4.squad.units.find(u => u._free), 1e9)
  check('回归 #6：不占编制的单位阵亡，freeCounts 同步减', w4.squad.freeCounts.titan === 0 && w4.squad.counts.titan === 1 && capRoom(w4, 'titan') === 0)

  // #7 日冕长矛的余烬：Boss 站在线上哪一段都吃得到，每跳只吃一份
  const w5 = sandbox('ysera')
  benchHero(w5)
  spawnBoss(w5, 'matriarch'); w5.boss.hp = w5.boss.hpMax = 1e6
  const pin = w => { w.boss.x = 0; w.boss.z = -5; w.boss._acidT = 99; w.boss._eggT = 99 }
  pin(w5)
  charge(w5, 'ysera_lance'); pin(w5); stepOnce(w5, press('w')); pin(w5); stepOnce(w5, aimAt(0, 7, 0, -17))
  run(w5, 3.2, { each: pin })
  const L = POWERS.ysera_lance, lance = w5.stats.dmgByPower.ysera_lance, ticks = (lance - L.bossDmg) / L.burnDmg
  check('回归 #7：日冕长矛余烬——Boss 在线段中段也吃灼烧，每跳一份（不按圈数叠）', near(ticks, L.burnDur / L.burnTick, 1.01) && ticks >= 4, `Boss 共吃 ${Math.round(lance)} = ${L.bossDmg} + ${r1(ticks)} 跳 × ${L.burnDmg}`)

  // #8 范围爆炸的目标上限：打不到的飞行虫不占名额
  const w6 = sandbox()
  w6.enemySpeedMul = 0
  for (let k = 0; k < 20; k++) put(w6, 'wing', (k % 5) * 0.1, -5, 100)
  for (let k = 0; k < 30; k++) put(w6, 'ling', (k % 6) * 0.1, -5 + ((k / 6) | 0) * 0.1)
  stepOnce(w6)
  const k0 = w6.stats.kills
  const hit = explode(w6, 0.2, -5, 2, 50, 20, 0, 0, 'mortar', null, null, 0, 'm')
  check('回归 #8：头顶有翼螫时，对地爆炸照样炸满 20 只地面虫', hit === 20 && w6.stats.kills - k0 === 20 && w6.swarm.kindCount[K.wing] === 20, `命中 ${hit}  击杀 ${w6.stats.kills - k0}`)

  // #9 门在路上的那几秒里编制被填满：过门不落空，当场降级成模块 / 耐久
  // 期望变更：用第 5 道门（下标 4）代替第 3 道（下标 2）。理由：下标 2 的常规项改成了装置门（不是兵源），
  // 而这条回归要的是「两边都是兵源、过门时却已满编」；下标 4 两边是步兵 / 自行炮
  const w7 = createWorld({ seed: 1 })
  addUnits(w7, 'rifle', 49, 'test')
  spawnGate(w7, 4)
  const offered = [w7.gates.left, w7.gates.right].every(o => o.type === 'unit' && o.count > 0)
  addUnits(w7, 'flamer', 10, 'test')
  let gev = null
  // 期望变更（第 4 轮测试）：跑 2.3 秒 → 门在路上的时长 + 0.3 秒。理由：门放慢到约 3.75 秒才结算（data/gates.js GATE.speed 10.7 → 5.7）
  run(w7, GATE_TRAVEL + 0.3, { input: { moveX: null, targetX: 1.3, powers: [], aim: null, pick: null }, on: e => { if (e.type === 'gateResolve' && e.index === 4) gev = e } })
  const fb = gev && gev.fallback
  check('回归 #9：过门时已满编 → granted = 0，降级成模块 / 耐久并记在 gateResolve.fallback', offered && gev && gev.granted === 0 && fb !== null && (fb.type === 'module' || fb.type === 'stat') && w7.progress.modules[fb.params.moduleId] >= 1 && w7.squad.counts.rifle === 50,
    gev ? `原选项 +${gev.option.count} ${gev.option.unit} → 实得 ${gev.granted} 人，降级为 ${fb && fb.params.moduleId}` : '门没结算')

  // #10 火区上限只数火区：雷、余烬、酸池不挤占火区名额
  const w8 = sandbox()
  for (let k = 0; k < 60; k++) addZone(w8, 'mine', -5 + k * 0.15, 0, 1, 20, 0, 1e9, 'power', 'joe_mines')
  let fires = 0
  for (let k = 0; k < 60; k++) if (addZone(w8, 'fire', 0, -3, 1, 5, 1, 0.3, 'flamer', null) !== null) fires++
  check('回归 #10：场上 60 颗雷时火区照样能放，火区自己的上限 48', fires === 48 && w8.zones.length === 108, `火区 ${fires}  区域总数 ${w8.zones.length}`)
}

check('所有场景的事件：没有 NaN / 未登记类型', badEvent === null, badEvent ? `${badEvent.event.type}.${badEvent.field}` : '')

console.log(failed === 0 ? '\n全部通过.' : `\n${failed} 项未通过.`)
process.exitCode = failed === 0 ? 0 : 1
