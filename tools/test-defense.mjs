// 布防系统（GDD §13）的无头测试。node tools/test-defense.mjs
//   ① 契约字段  ② 放置合法性 / 铲除 / 卡槽  ③ 晶能经济  ④ 八种装置各自的行为  ⑤ 阻挡与啃咬  ⑥ 应急电网
//   ⑦ 车道归属与两种新虫（举盾虫 / 跳跃虫）、掘地虫与翼螫  ⑧ 升级卡 / 装置门 / 老猫的被动  ⑨ 确定性
//   ⑩ 3400 只 + 20 个装置时单步 < 3ms  ⑪ 平衡测试（HANDOFF §3，seed 1..10）  ⑫ 时间轴拉伸、事件登记、文案
// 小场景都用摆拍世界（sandbox）：不跑时间轴，东西自己摆，和正式对局走同一套 step。
import { createWorld, DT } from '../src/sim/world.js'
import { runHeadless, createBot } from '../src/sim/bot.js'
import { addUnits } from '../src/sim/squad.js'
import { spawn, KIND_INDEX } from '../src/sim/swarm.js'
import { hitEnemy, explode, frontalMul } from '../src/sim/combat.js'
import { spawnBoss } from '../src/sim/boss.js'
import { grantModule } from '../src/sim/progression.js'
import { spawnGate } from '../src/sim/gates.js'
import { enterEndless } from '../src/sim/endless.js'
import { placeDevice, removeDevice, unlockDevice, nextLocked, costMul, refillFences } from '../src/sim/devices.js'
import { findBadEvent, EVENT_TYPES } from '../src/core/events.js'
import { LANE, GRID, laneOf, ENERGY, FENCE, BLOCK, LEAP, DEVICES, DEVICE_KINDS, DEVICE_START, DEVICE_UNLOCK_ORDER, GATE_DEVICE_ENERGY, LANE_MOVE, MINE_CHAIN, CRYO_FREEZE } from '../src/data/devices.js'
import { ENEMIES, ENEMY_KINDS, LIVE_CAP, DIFFICULTY } from '../src/data/enemies.js'
import { MODULES, XP_TABLE } from '../src/data/modules.js'
import { GATE, GATE_SCRIPT, GATE_TRAVEL } from '../src/data/gates.js'
import { PASSIVES, COMMANDERS } from '../src/data/commanders.js'
import { CAMPAIGN_STRETCH, CAMPAIGN_LEN, PHASES, WAVES, T, TRICKLE, RUSH, BASE_WAVE_COUNT, BOSS_AT, INTRO_ORDER } from '../src/data/waves.js'
import { CAMPAIGN_BOSS } from '../src/data/bosses.js'
import { FORMATION, UNITS } from '../src/data/units.js'
import zh from '../src/data/strings.zh.js'
import en from '../src/data/strings.en.js'

const clock = () => Number(process.hrtime.bigint()) / 1e6
let failed = 0, badEvent = null
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100
const K = KIND_INDEX
const LX = LANE.centers, RZ = GRID.rowZ

const sandbox = (seed = 1, extra = {}) => createWorld({ seed, sandbox: true, ...extra })
// 前进 seconds 秒。input: null / 对象 / (world) => 对象。on(e, world): 每个事件回调。each(world): 每步回调
function run(world, seconds, { input = null, on = null, each = null } = {}) {
  const steps = Math.round(seconds / DT)
  for (let n = 0; n < steps; n++) {
    world.step(typeof input === 'function' ? input(world) : input)
    for (const e of world.events) {
      if (!badEvent) { const bad = findBadEvent(e); if (bad) badEvent = { field: bad, event: e } }
      if (on) on(e, world)
    }
    if (each) each(world)
  }
}
// 摆一只虫并把血量改成指定值
function put(world, kind, x, z, hp = null) {
  const i = spawn(world, K[kind], x, z)
  if (hp !== null) { world.swarm.hp[i] = hp; world.swarm.hpMax[i] = hp }
  return i
}
// 免费放一个装置（不看解锁 / 冷却 / 晶能）
const dev = (world, kind, lane, row) => placeDevice(world, kind, lane, row, true).device
const INPUT = () => ({ moveX: null, targetX: null, powers: [], aim: null, pick: null, reroll: false, continueEndless: false, retreat: false, place: null, remove: null })
const place = (kind, lane, row) => ({ ...INPUT(), place: { kind, lane, row } })
const lastEvents = (world, type) => world.events.filter(e => e.type === type)

// ============================================================ ① 契约字段
{
  const w = createWorld({ seed: 1 })
  check('① world.lanes：5 条车道，中心 x = -5.12 / -2.56 / 0 / 2.56 / 5.12，道宽 2.56',
    w.lanes.length === 5 && w.lanes.every((l, i) => l.index === i && near(l.x, [-5.12, -2.56, 0, 2.56, 5.12][i], 1e-9) && l.w === 2.56), w.lanes.map(l => l.x).join(' / '))
  check('① world.grid：cells[lane][row] 5 × 4 全空，排中心 z = 4.5 / 1.5 / -1.5 / -4.5，格深 3',
    w.grid.lanes === 5 && w.grid.rows === 4 && w.grid.cells.length === 5 && w.grid.cells.every(c => c.length === 4 && c.every(x => x === null)) && w.grid.rowZ.join() === '4.5,1.5,-1.5,-4.5' && w.grid.depth === 3)
  check('① world.devices 为空数组，world.energy 开局 100，world.fences 五道都是 true',
    Array.isArray(w.devices) && w.devices.length === 0 && w.energy === 100 && ENERGY.start === 100 && w.fences.length === 5 && w.fences.every(f => f === true))
  const c = w.cards
  check('① world.cards：8 张，顺序固定，带 kind / key / cost / cd / cdLeft / unlocked / affordable / ready 与文案 key',
    c.length === 8 && c.map(x => x.kind).join() === DEVICE_KINDS.join() && c.every((x, i) => x.key === i + 1 && x.cost === DEVICES[x.kind].cost && x.cd === DEVICES[x.kind].cd && x.cdLeft === 0 && typeof x.unlocked === 'boolean' && typeof x.affordable === 'boolean' && typeof x.ready === 'boolean' && x.nameKey in zh && x.descKey in zh),
    c.map(x => `${x.key}:${x.kind} ${x.cost}/${x.cd}s`).join('  '))
  check('① 初始解锁 采集器 / 哨戒塔 / 路障 / 地雷，其余四种锁着', c.filter(x => x.unlocked).map(x => x.kind).join() === 'collector,sentry,barricade,mine' && DEVICE_START.join() === 'collector,sentry,barricade,mine' && nextLocked(w) === DEVICE_UNLOCK_ORDER[0])
  check('① laneOf(x)：x 落在哪条道', [-6.4, -5.12, -3.85, -3.83, 0, 1.27, 1.29, 6.39, 9].map(laneOf).join() === '0,0,0,1,2,2,3,4,4')
  // 空间哈希改名：world.grid 让给了布防格子，内部哈希在 world.hash
  check('① 空间哈希改名 world.hash（world.grid 现在是布防格子，没有哈希的字段）', w.hash && w.hash.start instanceof Int32Array && !('start' in w.grid))
}

// ============================================================ ② 放置合法性 / 铲除 / 卡槽
{
  const w = sandbox()
  const t0 = w.time
  w.step(place('sentry', 1, 1))
  const pe = lastEvents(w, 'devicePlace')[0], d = w.devices[0]
  check('② input.place 放置成功：扣 100 晶能、卡进入 6 秒冷却、格子被占、发 devicePlace，放置不暂停游戏',
    w.devices.length === 1 && w.energy === 0 && w.cards[1].cdLeft === 6 && w.grid.cells[1][1] === d && pe && pe.id === d.id && pe.kind === 'sentry' && pe.lane === 1 && pe.row === 1 && pe.x === LX[1] && pe.z === RZ[1] && pe.cost === 100 && w.time > t0 && w.status === 'running',
    `晶能 100 → ${w.energy}  冷却 ${w.cards[1].cdLeft}s`)
  check('② 装置字段：id / kind / lane / row / x / z / hp / hpMax / alive / t0 / armedT / fireT / hitT / aimX / aimZ / cost',
    d.kind === 'sentry' && d.lane === 1 && d.row === 1 && d.x === LX[1] && d.z === RZ[1] && d.hp === DEVICES.sentry.hp && d.hpMax === DEVICES.sentry.hp && d.alive === true && near(d.t0, w.time, 1e-9) && d.armedT === null && d.fireT < 0 && d.hitT < 0 && Number.isFinite(d.aimX) && Number.isFinite(d.aimZ) && d.cost === 100 && Number.isInteger(d.id))
  // 各种放不下去的情况：世界不变，发 placeFail{reason}
  const tryPlace = (kind, lane, row, prep) => {
    if (prep) prep()
    const before = JSON.stringify([w.energy, w.devices.length, w.cards.map(c => c.cdLeft > 0)])
    w.step(place(kind, lane, row))
    const f = lastEvents(w, 'placeFail')[0]
    const after = JSON.stringify([w.energy, w.devices.length, w.cards.map(c => c.cdLeft > 0)])
    return { reason: f ? f.reason : null, same: before === after && lastEvents(w, 'devicePlace').length === 0, last: w._dev.last }
  }
  const occ = tryPlace('barricade', 1, 1, () => { w.energy = 500 })
  const oob = [tryPlace('barricade', 5, 0), tryPlace('barricade', 0, 4), tryPlace('barricade', -1, 0), tryPlace('barricade', 1.5, 0), tryPlace('barricade', 0, null)]
  const bad = tryPlace('tesla', 0, 0)
  const locked = tryPlace('cryo', 0, 0)
  const cooling = tryPlace('sentry', 2, 1)
  const poor = tryPlace('barricade', 2, 2, () => { w.energy = 49 })
  check('② 放置合法性：占用 / 出界 / 未知种类 / 未解锁 / 冷却中 / 晶能不足 都被拒绝，世界不变，发 placeFail{reason}',
    occ.reason === 'occupied' && occ.same && oob.every(o => o.reason === 'bounds' && o.same) && bad.reason === 'kind' && bad.same && locked.reason === 'locked' && locked.same && cooling.reason === 'cooldown' && cooling.same && poor.reason === 'energy' && poor.same && poor.last.ok === false,
    [occ, ...oob, bad, locked, cooling, poor].map(o => o.reason).join(' / '))
  // 卡槽：冷却按秒走完，affordable / ready 跟着晶能变
  w.energy = 49
  run(w, 3)
  const mid = w.cards[1].cdLeft, poorCard = { ...w.cards[2] }
  run(w, 3.1)
  w.energy = 50; w.step(null)
  check('② 卡槽：冷却按秒走完；affordable / ready 跟着晶能变', near(mid, 3, 0.25) && w.cards[1].cdLeft === 0 && poorCard.affordable === false && poorCard.ready === false && w.cards[2].affordable === true && w.cards[2].ready === true && w.cards[1].affordable === false && w.cards[4].ready === false,
    `3 秒后剩 ${r2(mid)}s，6.1 秒后 ${w.cards[1].cdLeft}s`)
  // 铲除：返还 25%
  w.energy = 0
  w.step({ ...INPUT(), remove: { lane: 1, row: 1 } })
  const re = lastEvents(w, 'deviceRemove')[0]
  const e0 = w.energy
  w.step({ ...INPUT(), remove: { lane: 1, row: 1 } })
  check('② input.remove 铲除自己的装置：返还花费的 25%，格子腾空，发 deviceRemove；空格子上铲除什么都不发生',
    re && re.refund === 25 && re.kind === 'sentry' && e0 === 25 && w.devices.length === 0 && w.grid.cells[1][1] === null && ENERGY.removeRefund === 0.25 && w.energy === 25 && lastEvents(w, 'deviceRemove').length === 0 && removeDevice(w, 9, 9) === false,
    `返还 ${re && re.refund}`)
  // 升级选卡时（时间不前进）不处理放置
  const w2 = createWorld({ seed: 1 })
  w2.progress.xp = w2.progress.xpNext
  w2.step(null)
  const lv = w2.status
  w2.step(place('sentry', 2, 1))
  check('② 选卡暂停时不处理放置（时间不前进）', lv === 'levelup' && w2.devices.length === 0 && w2.energy === 100)
  check('② 每格最多一个装置：20 格放满后全部拒绝', (() => {
    const w3 = sandbox()
    let ok = 0
    for (let l = 0; l < 5; l++) for (let r = 0; r < 4; r++) if (placeDevice(w3, 'barricade', l, r, true).ok) ok++
    let again = 0
    for (let l = 0; l < 5; l++) for (let r = 0; r < 4; r++) if (placeDevice(w3, 'mine', l, r, true).ok) again++
    return ok === 20 && again === 0 && w3.devices.length === 20
  })())
}

// ============================================================ ③ 晶能经济
{
  // 击杀掉落：裂爪虫 ENERGY.ling，其余 经验 × perXp
  const w = sandbox()
  w.enemySpeedMul = 0
  const e0 = w.energy
  const ids = []
  for (let k = 0; k < 40; k++) ids.push(put(w, 'ling', -4 + k * 0.2, -5))
  let events = 0, evSum = 0
  for (const i of ids) { hitEnemy(w, i, 99, 'rifle', null, true, null, false) }
  for (const e of w.events) if (e.type === 'energy') { events++; evSum += e.amount }
  const lingGain = w.energy - e0
  const c = put(w, 'crusher', 0, -5)
  hitEnemy(w, c, 1e6, 'rifle', null, true, null, false)
  const crusherGain = w.energy - e0 - lingGain
  check('③ 击杀掉落直接入账：裂爪虫每只 ENERGY.ling，其余按经验 × perXp',
    near(lingGain, 40 * ENERGY.ling, 1e-4) && near(crusherGain, ENEMIES.crusher.xp * ENERGY.perXp, 1e-4) && w.stats.energy.kill > 0 && near(w.stats.energy.earned, lingGain + crusherGain, 1e-4),
    `40 只裂爪虫 +${r2(lingGain)}  1 只甲壳兽 +${r2(crusherGain)}`)
  // 再杀 200 只裂爪虫：零碎的攒够 1 点发一条；一只巨畸体（60 经验）是大块，单独发一条
  w.events.length = 0
  for (let k = 0; k < 200; k++) hitEnemy(w, put(w, 'ling', -4 + k * 0.04, -6), 99, 'rifle', null, true, null, false)
  const small = lastEvents(w, 'energy')
  w.events.length = 0
  hitEnemy(w, put(w, 'hulk', 0, -6), 1e6, 'rifle', null, true, null, false)
  const bigEv = lastEvents(w, 'energy')
  check('③ 零碎掉落攒够 1 点才发一条 energy 事件（不是每只虫一条），大块掉落每次都发',
    events === 0 && small.length >= 1 && small.length <= 3 && small.every(e => e.amount >= ENERGY.eventMin && e.source === 'kill' && Number.isFinite(e.x) && Number.isFinite(e.z)) && bigEv.length === 1 && near(bigEv[0].amount, ENEMIES.hulk.xp * ENERGY.perXp, 1e-4),
    `前 40 只 ${events} 条，再 200 只 ${small.length} 条，巨畸体 1 条 +${bigEv[0] && r2(bigEv[0].amount)}`)
  // 精英 ×2.5；卵 / 空投舱不掉
  const w2 = sandbox()
  const el = spawn(w2, K.crusher, 0, -5, 0, true), egg = put(w2, 'egg', 1, -5), pod = put(w2, 'pod', 2, -5)
  const b0 = w2.energy
  hitEnemy(w2, el, 1e6, 'rifle', null, true, null, false)
  const eliteGain = w2.energy - b0
  hitEnemy(w2, egg, 1e6, 'rifle', null, true, null, false); hitEnemy(w2, pod, 1e6, 'rifle', null, true, null, false)
  check('③ 精英掉落 ×2.5；虫卵和空投舱不掉晶能', near(eliteGain, ENEMIES.crusher.xp * ENERGY.perXp * ENERGY.eliteMul, 1e-4) && near(w2.energy - b0, eliteGain, 1e-9), `精英甲壳兽 +${r2(eliteGain)}`)
  // 采集器
  const w3 = sandbox()
  const col = dev(w3, 'collector', 0, 0)
  const g = []
  run(w3, 10.1, { on: (e, ww) => { if (e.type === 'energy') g.push({ t: ww.time, ...e }) } })
  // 期望变更（第 1 轮测试）：每 5 秒 15 → 20。理由：一局压到约 120 秒，采集器的总产出跟着少了三成，装置占总伤害掉到 7%（⑪ 的下限 8%）
  check('③ 采集器：每 5 秒 +20 晶能，发 energy{x, z, amount, source: collector}',
    DEVICES.collector.every === 5 && DEVICES.collector.amount === 20 && g.length === 2 && near(g[0].t, 5, 0.05) && near(g[1].t, 10, 0.05) && g.every(e => e.amount === 20 && e.source === 'collector' && e.x === col.x && e.z === col.z) && w3.energy === 140 && w3.stats.energy.collector === 40,
    `${g.map(e => r1(e.t) + 's +' + e.amount).join('  ')}  晶能 ${w3.energy}`)
  w3.energy = ENERGY.max - 5
  run(w3, 5)
  check('③ 晶能上限 9999', w3.energy === 9999 && ENERGY.max === 9999)
  // 收支统计
  const w4 = sandbox()
  w4.energy = 1000
  w4.step(place('sentry', 0, 1)); w4.step(place('barricade', 0, 2)); w4.step({ ...INPUT(), remove: { lane: 0, row: 2 } })
  const st = w4.stats, res = w4.result()
  check('③ 统计：energy{earned, spent, refund…}、devices{placed, lost, removed, spent} 进 stats 与 result()',
    st.energy.spent === 150 && st.energy.refund === 13 && st.devices.placed.sentry === 1 && st.devices.placed.barricade === 1 && st.devices.removed.barricade === 1 && st.devices.spent.sentry === 100 && res.energy.spent === 150 && res.energy.now === 863 && res.devices.placedTotal === 2 && res.devices.standing === 1,
    JSON.stringify(res.energy))
}

// ============================================================ ④ 八种装置
// ---- 哨戒机枪塔
{
  const w = sandbox()
  w.enemySpeedMul = 0
  const d = dev(w, 'sentry', 1, 1)
  const a = put(w, 'ling', LX[1], -5, 1000), b = put(w, 'ling', LX[1] + 0.3, -8, 1000), far = put(w, 'ling', LX[1], -23.5, 1000)
  const other = put(w, 'ling', LX[3], -5, 1000), behind = put(w, 'ling', LX[1], 3, 1000)
  let fires = 0, fe = null
  run(w, 2, { on: e => { if (e.type === 'deviceFire') { fires++; fe = e } } })
  const s = w.swarm, S = DEVICES.sentry
  check('④ 哨戒塔：只打本道身前的虫，每 0.2 秒一发，单发 6；子弹再穿 1 只；隔壁道和身后的不打',
    fires >= 8 && fires <= 10 && near(1000 - s.hp[a], fires * S.dmg, 1e-3) && near(1000 - s.hp[b], fires * S.dmg, 1e-3) && s.hp[far] === 1000 && s.hp[other] === 1000 && s.hp[behind] === 1000 && S.dmg === 6 && S.interval === 0.2 && S.pierce === 1,
    `2 秒 ${fires} 发  最近的掉 ${r1(1000 - s.hp[a])}  第二只掉 ${r1(1000 - s.hp[b])}  隔壁道 ${1000 - s.hp[other]}  身后 ${1000 - s.hp[behind]}`)
  check('④ 哨戒塔：deviceFire{id, kind, x, z, tx, tz}，fireT / aimX / aimZ 跟着更新，伤害记进 stats.dmgByDevice.sentry',
    fe && fe.id === d.id && fe.kind === 'sentry' && fe.x === d.x && fe.z === d.z && near(fe.tx, s.x[a], 1e-6) && near(fe.tz, s.z[a], 1e-6) && d.fireT > 1.7 && near(d.aimX, s.x[a], 1e-6) && near(w.stats.dmgByDevice.sentry, fires * S.dmg * 2, 1e-3) && w.stats.dmgByUnit.rifle === 0,
    `dmgByDevice.sentry = ${r1(w.stats.dmgByDevice.sentry)}`)
  // 射程到道尽头
  const w2 = sandbox(); w2.enemySpeedMul = 0
  dev(w2, 'sentry', 2, 0)
  const end = put(w2, 'ling', 0, -23.8, 1000)
  run(w2, 1)
  // 对空
  const w3 = sandbox(); w3.enemySpeedMul = 0
  dev(w3, 'sentry', 2, 1); dev(w3, 'cryo', 2, 0)
  const wing = put(w3, 'wing', 0, -6, 1000)
  run(w3, 1)
  check('④ 哨戒塔：射程到道尽头（23 米外照打）；可对空（翼螫掉血，全是哨戒塔打的，冷凝塔打不到）',
    w2.swarm.hp[end] < 1000 && w3.swarm.hp[wing] < 1000 && w3.swarm.y[wing] > 0 && w3.stats.dmgByDevice.cryo === 0 && w3.stats.dmgByDevice.sentry > 0,
    `道尽头掉 ${r1(1000 - w2.swarm.hp[end])}  翼螫掉 ${r1(1000 - w3.swarm.hp[wing])}`)
}
// ---- 冷凝塔
{
  const w = sandbox(); w.enemySpeedMul = 0
  const C = DEVICES.cryo
  dev(w, 'cryo', 1, 1)
  const a = put(w, 'ling', LX[1], -5, 1000), side = put(w, 'ling', LX[1] + 1.0, -5.3, 1000), other = put(w, 'ling', LX[3], -5, 1000)
  let fires = 0
  run(w, 1, { on: e => { if (e.type === 'deviceFire' && e.kind === 'cryo') fires++ } })
  const s = w.swarm
  check('④ 冷凝塔：本道直射，单发 6、每 0.35 秒一发；命中点一小圈都减速 50%、持续 3 秒；隔壁道不受影响',
    fires >= 2 && s.hp[a] < 1000 && s.hp[side] < 1000 && s.slow[a] === 0.5 && s.slow[side] === 0.5 && s.slowT[a] > w.time + 2 && s.slowT[a] <= w.time + 3.001 && s.hp[other] === 1000 && !(w.time < s.slowT[other]) && C.slow === 0.5 && C.slowDur === 3 && C.dmg === 6 && C.interval === 0.35,
    `1 秒 ${fires} 发  目标掉 ${r1(1000 - s.hp[a])}  旁边那只掉 ${r1(1000 - s.hp[side])}  减速倍率 ${s.slow[a]}`)
  // 真的慢了一半
  const mk = cry => { const ww = sandbox(); ww.enemySpeedMul = 1; if (cry) dev(ww, 'cryo', 2, 0); const i = put(ww, 'crusher', 0, -12, 1e6); run(ww, 0.5); const z0 = ww.swarm.z[i]; run(ww, 1); return ww.swarm.z[i] - z0 }
  const fast = mk(false), slow = mk(true)
  check('④ 冷凝塔：被冻住的虫真的只有一半速度', near(slow / fast, 0.5, 0.03), `每秒 ${r2(fast)} 米 → ${r2(slow)} 米`)
}
// ---- 合金路障
{
  const w = sandbox()
  const B = DEVICES.barricade
  const d = dev(w, 'barricade', 2, 2)
  const i = put(w, 'ling', 0, -6, 1e6), passer = put(w, 'ling', LX[3], -6, 1e6)
  let bites = 0, hitEv = null
  run(w, 8, { on: e => { if (e.type === 'enemyAttack' && e.device === d.id) bites++; if (e.type === 'deviceHit') hitEv = e } })
  const s = w.swarm, face = d.z - BLOCK.gap
  check('④ 路障：血 400、护甲 1；本道的虫走到它前面 0.6 处停下（state = 1），隔壁道的照常走过去',
    B.hp === 400 && B.armor === 1 && s.z[i] <= face + 1e-6 && s.z[i] >= face - BLOCK.queueMin - 1e-6 && s.state[i] === 1 && s.vz[i] === 0 && (s.alive[passer] === 0 || s.z[passer] > d.z + 3),
    `停在 z = ${r2(s.z[i])}（装置 z = ${d.z}）`)
  check('④ 路障：裂爪虫每 0.8 秒咬一口 1 伤，扣掉护甲每口实得 0.5；发 enemyAttack{device} 与 deviceHit{id, dmg, hp}',
    bites >= 8 && bites <= 11 && near(400 - d.hp, bites * 0.5, 1e-6) && hitEv && hitEv.id === d.id && hitEv.kind === 'barricade' && hitEv.hp > 0 && d.hitT > 7 && ENEMIES.ling.bite === 1 && BLOCK.every === 0.8,
    `8 秒 ${bites} 口，掉 ${400 - d.hp} 血`)
  // 咬坏之后继续前进
  d.hp = 0.4
  let die = null
  run(w, 1.5, { on: e => { if (e.type === 'deviceDie') die = e } })
  check('④ 路障被咬坏：发 deviceDie{id, kind, lane, row, x, z, by}，格子腾空，虫恢复前进',
    die && die.id === d.id && die.kind === 'barricade' && die.lane === 2 && die.row === 2 && die.by === 'ling' && d.alive === false && w.devices.length === 0 && w.grid.cells[2][2] === null && (s.alive[i] === 0 || s.z[i] > d.z + 3) && w.stats.devices.lost.barricade === 1,
    die ? `by ${die.by}` : '没有 deviceDie')
}
// ---- 感应地雷
{
  const M = DEVICES.mine
  const w = sandbox(); w.enemySpeedMul = 0
  const d = dev(w, 'mine', 2, 1)
  const big = put(w, 'crusher', 0.3, RZ[1], 5000)
  let armT = null, blastT = null, blast = null
  run(w, 7, { on: (e, ww) => { if (e.type === 'mineArm') armT = ww.time; if (e.type === 'mineBlast') { blastT = ww.time; blast = e } } })
  const dealt = 5000 - w.swarm.hp[big]
  check('④ 地雷：放下 6 秒后武装（mineArm），之前踩上来不炸；武装后大个头一踩就炸（mineBlast），伤 400，一次性',
    near(armT, 6, 0.03) && near(blastT, 6, 0.03) && blast.id === d.id && near(dealt, M.dmg - ENEMIES.crusher.armor, 1e-3) && w.devices.length === 0 && w.grid.cells[2][1] === null && M.arm === 6 && d.armedT === 6,
    `武装 @${r2(armT)}s  爆炸 @${r2(blastT)}s  甲壳兽掉 ${r1(dealt)}`)
  // 小虫要凑够数才炸
  const w2 = sandbox(); w2.enemySpeedMul = 0
  dev(w2, 'mine', 2, 1)
  for (let k = 0; k < M.crowd - 1; k++) put(w2, 'ling', -0.8 + k * 0.15, RZ[1] + (k % 3) * 0.3 - 0.3, 50)
  const farLing = put(w2, 'ling', 0, RZ[1] - M.r - 0.6, 50)
  let early = 0
  run(w2, 8, { on: e => { if (e.type === 'mineBlast') early++ } })
  const waiting = w2.devices.length === 1 && w2.devices[0].armed === true
  put(w2, 'ling', 0.2, RZ[1], 50)
  const k0 = w2.stats.kills
  let blasts = 0
  run(w2, 0.2, { on: e => { if (e.type === 'mineBlast') blasts++ } })
  check(`④ 地雷：零星几只小虫骗不掉它（圈内 ${M.crowd - 1} 只不炸），凑够 ${M.crowd} 只才炸；半径 ${M.r} 内全灭，圈外的没事`,
    early === 0 && waiting && blasts === 1 && w2.stats.kills - k0 === M.crowd && w2.swarm.hp[farLing] === 50 && w2.stats.killsByDevice.mine === M.crowd && w2.stats.dmgByDevice.mine === M.crowd * 50,
    `炸死 ${w2.stats.kills - k0} 只`)
}
// ---- 喷火陷阱
{
  const S = DEVICES.scorcher
  const w = sandbox(); w.enemySpeedMul = 0
  const d = dev(w, 'scorcher', 2, 2)
  const c = put(w, 'crusher', LX[3], RZ[2], 1000), own = put(w, 'ling', 0, RZ[2] - 1, 1000)
  const farLane = put(w, 'ling', LX[0], RZ[2], 1000), otherRow = put(w, 'ling', 0, RZ[1], 1000)
  let fires = 0, flames = 0
  run(w, 3, { on: e => { if (e.type === 'deviceFire' && e.kind === 'scorcher') fires++; if (e.type === 'flame') flames++ } })
  const s = w.swarm
  check('④ 喷火陷阱：所在这一排、左右各一道（3 × 1 格），每 0.3 秒烧 4，无视护甲；隔两道的、别的排的烧不到',
    fires >= 9 && fires <= 11 && flames === fires && near(1000 - s.hp[c], fires * S.dmg, 1e-3) && near(1000 - s.hp[own], fires * S.dmg, 1e-3) && s.hp[farLane] === 1000 && s.hp[otherRow] === 1000 && S.dmg === 4 && S.interval === 0.3 && ENEMIES.crusher.armor > 0,
    `3 秒 ${fires} 次  隔壁道的甲壳兽掉 ${r1(1000 - s.hp[c])}`)
  // 不挡路、啃不到
  const w2 = sandbox()
  const d2 = dev(w2, 'scorcher', 2, 2)
  const walker = put(w2, 'ling', 0, -8, 1e6)
  run(w2, 1.5)
  check('④ 喷火陷阱是陷阱：不挡路（虫从上面踩过去），也啃不到它', (w2.swarm.alive[walker] === 0 || w2.swarm.z[walker] > d2.z + 2) && d2.hp === d2.hpMax && DEVICES.scorcher.blocks === false)
}
// ---- 迫击炮台
{
  const P = DEVICES.mortarpit
  const w = sandbox(); w.enemySpeedMul = 0
  const d = dev(w, 'mortarpit', 2, 0)
  const front = put(w, 'ling', 0, 0.5, 1000)
  const pack = []
  for (let k = 0; k < 20; k++) pack.push(put(w, 'ling', -0.9 + (k % 5) * 0.45, -9.4 + ((k / 5) | 0) * 0.3, 1000))
  const otherLane = put(w, 'ling', LX[4], -9, 1000)
  let boom = null, fire = null
  run(w, 1, { on: e => { if (e.type === 'explosion' && e.kind === 'mortarpit' && !boom) boom = e; if (e.type === 'deviceFire' && e.kind === 'mortarpit' && !fire) fire = e } })
  const s = w.swarm
  const hitPack = pack.filter(i => s.hp[i] < 1000).length
  check('④ 迫击炮台：不打本道最靠前的那只，砸它身后最密的那一堆（伤 55、半径 2.4）',
    boom && near(boom.x, 0, 1e-6) && boom.z < -6 && boom.z > -11 && hitPack === 20 && pack.every(i => near(1000 - s.hp[i], P.dmg, 1e-3)) && s.hp[front] === 1000 && s.hp[otherLane] === 1000 && fire && fire.id === d.id && near(fire.tz, boom.z, 1e-9) && P.r === 2.4 && P.interval === 1.7,
    boom ? `落点 z = ${r1(boom.z)}  炸到 ${hitPack}/20  最前那只掉 ${1000 - s.hp[front]}` : '没开火')
  // 本道只剩最前面那一只时，也不会干看着
  const w2 = sandbox(); w2.enemySpeedMul = 0
  dev(w2, 'mortarpit', 2, 0)
  const lone = put(w2, 'ling', 0.1, -4, 1000)
  run(w2, 1)
  check('④ 迫击炮台：本道只有一堆时就打那一堆', w2.swarm.hp[lone] < 1000)
}
// ---- 聚变炸弹
{
  const N = DEVICES.nova
  const w = sandbox(); w.enemySpeedMul = 0
  const d = dev(w, 'nova', 2, 2)
  const inside = [put(w, 'ling', 0, RZ[2], 100), put(w, 'ling', 3.5, RZ[2] + 4, 100), put(w, 'ling', -3.5, RZ[2] - 4, 100), put(w, 'crusher', 1, RZ[2] + 1, 800)]
  const outside = [put(w, 'ling', LX[4], RZ[2], 100), put(w, 'ling', 0, RZ[2] - 5, 100), put(w, 'ling', 0, RZ[2] + 5, 100)]
  let blastT = null, ev = null
  run(w, 1.1)
  const before = w.stats.kills
  run(w, 0.3, { on: (e, ww) => { if (e.type === 'novaBlast') { blastT = ww.time; ev = e } } })
  const s = w.swarm
  check('④ 聚变炸弹：放下 1.2 秒后爆炸（novaBlast），3 × 3 格内全灭、格外的没事；一次性',
    before === 0 && near(blastT, 1.2, 0.03) && ev.id === d.id && near(ev.w, 2.56 * 3, 1e-6) && near(ev.d, 9, 1e-6) && inside.every(i => s.state[i] === 2) && outside.every(i => s.hp[i] === 100) && w.devices.length === 0 && w.grid.cells[2][2] === null && w.stats.killsByDevice.nova === 4 && N.fuse === 1.2 && d.armedT === 1.2,
    `爆炸 @${r2(blastT)}s  炸死 ${w.stats.kills}  伤害 ${Math.round(w.stats.dmgByDevice.nova)}`)
}
// ---- 采集器本体（产出在 ③）+ 装置报告
{
  const w = sandbox(); w.enemySpeedMul = 0
  dev(w, 'collector', 0, 0); dev(w, 'sentry', 2, 1)
  for (let k = 0; k < 6; k++) put(w, 'ling', 0, -3 - k, 3)
  run(w, 2)
  const r = w.result()
  const row = r.deviceReport.find(x => x.kind === 'sentry'), col = r.deviceReport.find(x => x.kind === 'collector')
  const sumShare = r.unitReport.reduce((a, u) => a + u.share, 0) + r.powerReport.reduce((a, u) => a + u.share, 0) + r.deviceReport.reduce((a, u) => a + u.share, 0)
  const sumKills = r.unitReport.reduce((a, u) => a + u.kills, 0) + r.powerReport.reduce((a, u) => a + u.kills, 0) + r.deviceReport.reduce((a, u) => a + u.kills, 0)
  check('④ 采集器：血 30、不开火；result().deviceReport 每种装置一行（伤害 / 占比 / 放置 / 歼敌 / 文案），三张表的歼敌之和 = 总击杀、占比之和 = 1',
    DEVICES.collector.hp === 30 && col && col.dmg === 0 && row && row.kills === 6 && row.dmg === 18 && row.placed === 1 && row.nameKey in zh && near(sumShare, 1, 0.002) && sumKills === r.kills && r.kills === 6 && r.dmgByDevice.sentry === 18 && w.stats.dmgByDevice.sentry === 18,
    r.deviceReport.map(x => `${zh[x.nameKey]} ${x.dmg}/${x.kills}`).join('  '))
}

// ============================================================ ⑤ 阻挡与啃咬
{
  // 小虫同时只有 BLOCK.slots 只咬得到，其余排队
  const w = sandbox()
  const d = dev(w, 'barricade', 2, 2)
  const ids = []
  for (let k = 0; k < 100; k++) ids.push(put(w, 'ling', -1 + (k % 10) * 0.2, -8 - ((k / 10) | 0) * 0.5, 1e6))
  run(w, 10)
  const s = w.swarm, face = d.z - BLOCK.gap
  let zMin = 99, zMax = -99, attacking = 0
  for (const i of ids) { if (s.z[i] < zMin) zMin = s.z[i]; if (s.z[i] > zMax) zMax = s.z[i]; if (s.state[i] === 1) attacking++ }
  const lost = 400 - d.hp, cap = (BLOCK.slots + 10 * BLOCK.slots / BLOCK.every) * 0.5
  check(`⑤ 啃咬名额：100 只裂爪虫围着一个路障，同时只有 ${BLOCK.slots} 只咬得到——10 秒掉血不超过名额上限（不是 100 只一起咬的 600+）`,
    lost > cap * 0.75 && lost <= cap + 1 && d.alive, `掉 ${r1(lost)}（名额上限 ${r1(cap)}）`)
  check('⑤ 排队：被挡住的虫在装置前排成一段纵深，没有一只越过装置；只有够得着的才是攻击状态',
    zMax <= face + 1e-6 && zMin < face - 1 && zMin >= face - BLOCK.queueMax - 1e-6 && attacking > 0 && attacking < 100, `z 从 ${r2(zMin)} 到 ${r2(zMax)}（装置前沿 ${face}）  攻击状态 ${attacking} 只`)
  // 甲壳兽 6、巨畸体 15（大个头不占名额）；脓爆虫碰到装置即爆 ×10
  const bite = (kind, n, secs) => { const ww = sandbox(); const dd = dev(ww, 'barricade', 2, 2); let c = 0; for (let k = 0; k < n; k++) put(ww, kind, -0.6 + k * 0.4, -6, 1e6); run(ww, secs, { on: e => { if (e.type === 'enemyAttack' && e.device === dd.id) c++ } }); return { lost: 400 - dd.hp, bites: c } }
  const cr = bite('crusher', 4, 8), hu = bite('hulk', 1, 8)
  check('⑤ 甲壳兽每口 6、巨畸体每口 15（扣 1 点护甲后 5 / 14），大个头不占小虫的名额',
    ENEMIES.crusher.bite === 6 && ENEMIES.hulk.bite === 15 && cr.bites >= 20 && near(cr.lost, cr.bites * 5, 1e-6) && hu.bites >= 5 && near(hu.lost, hu.bites * 14, 1e-6),
    `4 只甲壳兽 8 秒 ${cr.bites} 口掉 ${cr.lost}；巨畸体 ${hu.bites} 口掉 ${hu.lost}`)
  const w2 = sandbox()
  const d2 = dev(w2, 'barricade', 2, 2)
  const bu = put(w2, 'burster', 0, -6)
  let burst = 0, selfDie = 0
  run(w2, 1.5, { on: e => { if (e.type === 'burst') burst++; if (e.type === 'enemyDie' && e.by === 'self') selfDie++ } })
  check('⑤ 脓爆虫碰到装置即爆：对装置伤害 ×10（4 × 10 − 1 护甲 = 39），自己死、不计击杀',
    burst === 1 && selfDie === 1 && near(400 - d2.hp, ENEMIES.burster.attack.dmg * ENEMIES.burster.deviceMul - 1, 1e-6) && w2.swarm.state[bu] === 2 && w2.stats.kills === 0 && ENEMIES.burster.deviceMul === 10,
    `路障掉 ${400 - d2.hp}`)
  // 有血的装置都挡路、都会被咬；一次性的不挡
  const w3 = sandbox()
  const sen = dev(w3, 'sentry', 2, 1); dev(w3, 'mine', 2, 2)
  put(w3, 'crusher', 0, -8, 1e6)
  run(w3, 16)      // 12 → 16 秒：哨戒塔生命 40 → 70（第 1 轮测试），甲壳兽要多啃几口
  check('⑤ 有血的装置都挡路、都会被咬（哨戒塔被甲壳兽咬坏）；地雷不挡路', sen.alive === false && w3.stats.devices.lost.sentry === 1 && DEVICES.mine.blocks === false && DEVICES.nova.blocks === false && ['collector', 'sentry', 'barricade', 'cryo', 'mortarpit'].every(k => DEVICES[k].blocks && DEVICES[k].hp > 0))
  // Boss 直接碾碎
  const w4 = sandbox()
  const victims = [dev(w4, 'barricade', 2, 3), dev(w4, 'sentry', 2, 2)], safe = dev(w4, 'barricade', 0, 3)
  spawnBoss(w4, 'ravager')
  w4.boss.z = -9
  const crushed = []
  run(w4, 4, { on: e => { if (e.type === 'deviceDie') crushed.push(e) } })
  check('⑤ Boss 直接碾碎路上的装置（deviceDie{by: boss}），够不着的那条道不受影响',
    victims.every(v => !v.alive) && crushed.length === 2 && crushed.every(e => e.by === 'boss') && safe.alive && safe.hp === safe.hpMax, crushed.map(e => e.kind).join(' / '))
  // 老兵难度：敌人伤害倍率对装置同样生效（期望变更：×2 → ×1.35，第 1 轮测试下调了老兵的伤害倍率，理由见 test-core ⑥）
  const w5 = sandbox(1, { difficulty: 'veteran' })
  const d5 = dev(w5, 'collector', 2, 2)
  put(w5, 'ling', 0, -5, 1e6)
  let b5 = 0
  run(w5, 5, { on: e => { if (e.type === 'enemyAttack' && e.device === d5.id) b5++ } })
  check(`⑤ 老兵难度敌人伤害 ×${DIFFICULTY.veteran.dmgMul} 对装置同样生效`, b5 > 0 && DIFFICULTY.veteran.dmgMul === 1.35 && near(30 - d5.hp, b5 * DIFFICULTY.veteran.dmgMul, 1e-6), `${b5} 口掉 ${r2(30 - d5.hp)}`)
}

// ============================================================ ⑥ 应急电网
{
  const w = sandbox()
  const lane0 = [], lane4 = []
  for (let k = 0; k < 30; k++) lane0.push(put(w, 'ling', LX[0] + (k % 5) * 0.2 - 0.4, -20 + k, 5))
  for (let k = 0; k < 6; k++) lane4.push(put(w, 'ling', LX[4], -20 + k, 5))
  const dig = put(w, 'digger', LX[0], -18), pod = put(w, 'pod', LX[0], 10)
  put(w, 'ling', LX[0], 16.2, 5)       // 这一只先冲到底
  spawnBoss(w, 'matriarch')
  let fe = null, leaks = 0, xp0 = w.progress.xp
  run(w, 0.2, { on: e => { if (e.type === 'fence') fe = e; if (e.type === 'leak') leaks++ } })
  const s = w.swarm
  check('⑥ 电网：第一只冲到 z ≥ 16.5 的虫触发本道电网，清空该道全部非 Boss 敌人（含潜地的），计击杀与经验，不扣防线',
    FENCE.z === 16.5 && fe && fe.lane === 0 && fe.kills === 32 && near(fe.x, LX[0], 1e-9) && fe.z === 16.5 && lane0.every(i => s.state[i] === 2) && s.state[dig] === 2 && w.stats.kills === 32 && w.stats.killsByDevice.fence === 32 && w.progress.xp > xp0 && leaks === 0 && w.line.hp === w.line.hpMax && w.stats.leaked === 0,
    fe ? `第 ${fe.lane} 道清掉 ${fe.kills} 只` : '没触发')
  check('⑥ 电网：world.fences[lane] = false，别的道不受影响；Boss 和空投舱不会被清掉',
    w.fences.join() === 'false,true,true,true,true' && lane4.every(i => s.state[i] !== 2) && w.boss !== null && w.boss.hp === w.boss.hpMax && s.state[pod] !== 2 && w.stats.fencesUsed === 1)
  // 同一条道再漏：才扣防线
  const again = put(w, 'ling', LX[0], 16.2, 5), crusher = put(w, 'crusher', LX[0], 16.9, 50)
  w.swarm.atkT[crusher] = 0        // 它阵前的出手冷却是随机的：清零，让它这一步就往前走
  let fences = 0, leakEv = []
  run(w, 0.4, { on: e => { if (e.type === 'fence') fences++; if (e.type === 'leak') leakEv.push(e.kind) } })
  check('⑥ 电网每道每局一次：用掉之后该道漏网才扣防线（裂爪虫 1、甲壳兽 8）',
    fences === 0 && leakEv.sort().join() === 'crusher,ling' && w.line.hp === w.line.hpMax - 9 && w.stats.leaked === 2 && s.alive[again] === 0 && s.alive[crusher] === 0, `防线 ${w.line.hp}/${w.line.hpMax}`)
  const r = w.result()
  check('⑥ 结算里有电网一行（只有击杀）：deviceReport 的 fence、fences、fencesUsed', r.deviceReport.some(x => x.kind === 'fence' && x.kills === 32 && x.nameKey in zh) && r.fences.join() === w.fences.join() && r.fencesUsed === 1)
  // 翼螫飞过尽头也会触发
  const w2 = sandbox()
  const wg = put(w2, 'wing', LX[3], 16, 5), mate = put(w2, 'ling', LX[3], -10, 5)
  for (let k = 0; k < 9; k++) put(w2, 'ling', LX[3], 4 + k * 0.8, 5)     // 这一道还压着一股：值得放电
  w2.swarm.aux[wg] = 2      // 已经俯冲完、正往防线飞
  run(w2, 0.3)
  check('⑥ 翼螫飞过尽头同样触发它所在那条道的电网', w2.fences[3] === false && w2.swarm.state[mate] === 2 && w2.stats.leaked === 0)
  // 零星小虫不值一道电网：一只裂爪虫溜到边路尽头 → 电网不放电，它漏过去扣 1 点防线；大个头的照样放电
  const w4 = sandbox()
  const lone = put(w4, 'ling', LX[4], 16.2, 5), far = put(w4, 'ling', LX[4], -12, 5)
  let fz = 0
  run(w4, 0.4, { on: e => { if (e.type === 'fence') fz++ } })
  const w5 = sandbox()
  const cr5 = put(w5, 'crusher', LX[1], 16.3, 50)
  w5.swarm.atkT[cr5] = 0
  let fz5 = 0
  run(w5, 0.4, { on: e => { if (e.type === 'fence') fz5++ } })
  check('⑥ 电网不为零星小虫放电：单只裂爪虫漏过去只扣 1 点防线，电网留着；单只甲壳兽照样触发',
    fz === 0 && w4.fences[4] === true && w4.swarm.alive[lone] === 0 && w4.stats.leaked === 1 && w4.line.hp === w4.line.hpMax - 1 && w4.swarm.state[far] !== 2 &&
    fz5 === 1 && w5.fences[1] === false && FENCE.crowd === 10,
    `单只小虫：电网 ${w4.fences[4] ? '保留' : '烧掉'}，防线 ${w4.line.hp}/${w4.line.hpMax}；单只甲壳兽：${fz5} 次放电`)
  // 无尽每 5 层补满
  const w3 = createWorld({ seed: 1 })
  addUnits(w3, 'rifle', 30, 'test')
  w3.status = 'won'
  enterEndless(w3)
  w3.fences.fill(false)
  let refill = null, layer = 1
  for (let n = 0; n < 8 && w3.endless.layer < 5; n++) {
    const before = w3.fences.some(f => f)
    w3.endless.layerT = w3.endless.layerLen - 0.001
    w3.step(null)
    for (const e of w3.events) if (e.type === 'fenceRefill') refill = { layer: w3.endless.layer, lanes: e.lanes, before }
    for (const u of w3.squad.units) u.hp = u.hpMax
    if (w3.status === 'levelup') w3.step({ ...INPUT(), pick: 0 })
    layer = w3.endless.layer
  }
  check('⑥ 无尽每 5 层把电网补满（fenceRefill{lanes}），之前不补', layer === 5 && refill && refill.layer === 5 && refill.before === false && refill.lanes.join() === '0,1,2,3,4' && w3.fences.every(f => f === true) && FENCE.refillEvery === 5 && refillFences(w3) === 0,
    refill ? `第 ${refill.layer} 层补满` : '没补')
}

// ============================================================ ⑦ 车道归属、两种新虫、掘地虫、翼螫
{
  const w = sandbox()
  const xs = [-6.1, -4.0, -3.7, -1.0, 0.4, 2.0, 3.9, 6.0]
  const ids = xs.map(x => put(w, 'ling', x, -20, 1e6))
  const s = w.swarm
  const lanes0 = ids.map(i => s.lane[i])
  // 沿道走：到 chaseZ 之前横向不出本道的带子
  let inBand = true
  run(w, 2.2, { each: ww => { for (const i of ids) if (s.alive[i] && s.z[i] < 1.5 && Math.abs(s.x[i] - LX[s.lane[i]]) > LANE.width / 2 + 1e-6) inBand = false } })
  check('⑦ 车道归属：出生时按 x 归到最近的车道（swarm.lane），之后沿本道走、不出本道的带子',
    lanes0.join() === xs.map(laneOf).join() && lanes0.join() === '0,0,1,2,2,3,4,4' && inBand && ids.every((i, k) => s.lane[i] === lanes0[k]), `x ${xs.join(' / ')} → 道 ${lanes0.join(' ')}`)
  // 侧翼突袭带横向初速：按落点算
  const w2 = sandbox()
  const fl = spawn(w2, K.ling, 5.4, -15, -3.0)
  const predicted = w2.swarm.lane[fl]
  run(w2, 1.5)
  check('⑦ 侧翼突袭（带横向初速）的虫按滑到位之后的落点归道', predicted === laneOf(5.4 - 3.0 * 0.8) && predicted === 3 && laneOf(w2.swarm.x[fl]) === 3, `出生 x = 5.4 → 道 ${predicted}，1.5 秒后 x = ${r2(w2.swarm.x[fl])}`)
  // 贴近队伍的最后一段：本道中心 ± 个体散布 与 追人 按 0.65 / 0.35 混合
  const w3 = sandbox()
  addUnits(w3, 'mortar', 1, 'test')       // 自行炮贴脸打不到：只是给队伍一个位置
  w3.enemySpeedMul = 0
  run(w3, 0.5, { input: { ...INPUT(), targetX: 3 } })
  const m = put(w3, 'ling', LX[4], 3, 1e6)
  w3.swarm.seed[m] = 0.5
  run(w3, 3, { input: { ...INPUT(), targetX: 3 } })
  const want = LANE_MOVE.laneMix * LX[4] + LANE_MOVE.chaseMix * w3.squad.x
  check('⑦ 贴近队伍的最后一段：横向目标 = 0.65 × 本道位置 + 0.35 × 队伍位置（保留追人）',
    LANE_MOVE.laneMix === 0.65 && LANE_MOVE.chaseMix === 0.35 && near(w3.squad.x, 3, 0.05) && near(w3.swarm.x[m], want, 0.02) && w3.swarm.lane[m] === 4, `道中心 ${LX[4]}，队伍 ${r2(w3.squad.x)} → 虫 x = ${r2(w3.swarm.x[m])}（应为 ${r2(want)}）`)
}
{
  // ---- 举盾虫
  const SB = ENEMIES.shieldbug
  check('⑦ 举盾虫 / 跳跃虫进了 ENEMY_KINDS（只往后加）：shieldbug 10、leaper 11；血 50 / 10，速 4.5 / 9.5，经验 12 / 3',
    ENEMY_KINDS.indexOf('shieldbug') === 10 && ENEMY_KINDS.indexOf('leaper') === 11 && ENEMY_KINDS.slice(0, 10).join() === 'ling,burster,spitter,crusher,hulk,wing,digger,warden,egg,pod' && SB.hp === 50 && SB.speed[0] === 4.5 && SB.xp === 12 && ENEMIES.leaper.hp === 10 && ENEMIES.leaper.speed[0] === 9.5 && ENEMIES.leaper.xp === 3 && SB.nameKey in zh && ENEMIES.leaper.nameKey in en)
  const w = sandbox(); w.enemySpeedMul = 0
  const i = put(w, 'shieldbug', 0, 0, 1000), ling = put(w, 'ling', 0, 0, 1000)
  const front = frontalMul(w, i, 0, 8), edge = frontalMul(w, i, 6, 4), side = frontalMul(w, i, 8, 4), back = frontalMul(w, i, 0, -5), notBug = frontalMul(w, ling, 0, 8)
  check('⑦ 举盾虫：子弹来向与朝向（+z）夹角 < 60° 只吃 10%，侧面和背后照常；别的虫不减',
    near(front, 0.1, 1e-9) && near(edge, 0.1, 1e-9) && side === 1 && back === 1 && notBug === 1 && SB.shield.reduce === 0.9 && SB.shield.cos === 0.5, `正面 ×${front}  56° ×${edge}  63° ×${side}  背后 ×${back}`)
  // 突击兵正面打它：每发 2.8 × 10%
  const w2 = sandbox(); w2.enemySpeedMul = 0; w2.progress.overdriveUntil = 0
  addUnits(w2, 'rifle', 1, 'test')
  run(w2, 1)
  const sb = put(w2, 'shieldbug', 0, 2, 1000)
  let rifleHit = 0
  run(w2, 1, { on: e => { if (e.type === 'enemyHit' && e.i === sb && !rifleHit) rifleHit = e.dmg } })
  // 哨戒塔正面打它
  const w3 = sandbox(); w3.enemySpeedMul = 0
  dev(w3, 'sentry', 2, 0)
  const sb3 = put(w3, 'shieldbug', 0, -5, 1000)
  let shots3 = 0
  run(w3, 1, { on: e => { if (e.type === 'deviceFire') shots3++ } })
  // 范围 / 火焰不减
  const w4 = sandbox(); w4.enemySpeedMul = 0
  const sb4 = put(w4, 'shieldbug', 0, -5, 1000)
  w4.step(null)
  explode(w4, 0, -5, 2, 50, 10, 0, 0, 'mortar', null, null, 0, 'm')
  const afterBoom = 1000 - w4.swarm.hp[sb4]
  dev(w4, 'scorcher', 2, 3)
  run(w4, 1)
  const burnt = 1000 - w4.swarm.hp[sb4] - afterBoom
  check('⑦ 举盾虫实战：突击兵 / 哨戒塔正面直射只打出 10%；范围爆炸和火焰照常',
    near(rifleHit, UNITS.rifle.weapon.dmg * 0.1, 1e-3) && shots3 > 0 && near(1000 - w3.swarm.hp[sb3], shots3 * DEVICES.sentry.dmg * 0.1, 1e-3) && near(afterBoom, 50, 1e-3) && burnt >= DEVICES.scorcher.dmg * 3,
    `突击兵单发 ${r2(rifleHit)}  哨戒塔 ${shots3} 发共 ${r2(1000 - w3.swarm.hp[sb3])}  爆炸 ${afterBoom}  火 ${burnt}`)
  // 举盾虫会走到阵前近战，也会被装置挡住啃
  const w5 = sandbox()
  const d5 = dev(w5, 'barricade', 2, 2)
  put(w5, 'shieldbug', 0, -7, 1e6)
  let b5 = 0
  run(w5, 6, { on: e => { if (e.type === 'enemyAttack' && e.device === d5.id) b5++ } })
  check('⑦ 举盾虫被装置挡住会啃（每口 3）', b5 >= 3 && near(400 - d5.hp, b5 * (ENEMIES.shieldbug.bite - 1), 1e-6) && ENEMIES.shieldbug.bite === 3, `${b5} 口掉 ${400 - d5.hp}`)
}
{
  // ---- 跳跃虫
  const w = sandbox()
  const d1 = dev(w, 'barricade', 2, 3), d2 = dev(w, 'barricade', 2, 1)
  const lp = put(w, 'leaper', 0, -9, 1e6), ling = put(w, 'ling', 0.3, -9, 1e6)
  const s = w.swarm
  let maxY = 0, airT = 0, airMiss = null, airHit = null
  run(w, 3.5, { each: ww => {
    if (s.y[lp] > 0) {
      airT += DT
      if (s.y[lp] > maxY) maxY = s.y[lp]
      if (airMiss === null && s.y[lp] > 1) { const h0 = s.hp[lp]; hitEnemy(ww, lp, 5, 'flamer', null, true, null, false); airMiss = s.hp[lp] === h0; hitEnemy(ww, lp, 5, 'rifle', null, true, null, false); airHit = s.hp[lp] < h0 }
    }
  } })
  check('⑦ 跳跃虫：遇到第一个装置做 0.5 秒的抛物线跃过去（空中 y > 0，只有对空武器打得到），每只一次——第二个装置照样把它挡住',
    near(airT, LEAP.dur, 0.04) && near(maxY, LEAP.y, 0.05) && airMiss === true && airHit === true && s.y[lp] === 0 && s.z[lp] > d1.z && s.z[lp] <= d2.z - BLOCK.gap + 1e-6 && s.state[lp] === 1 && (s.flags[lp] & 4) !== 0 && LEAP.dur === 0.5,
    `腾空 ${r2(airT)}s  最高 ${r2(maxY)}  现在 z = ${r2(s.z[lp])}（第一个装置 ${d1.z}，第二个 ${d2.z}）`)
  check('⑦ 裂爪虫不会跳：被第一个装置挡住', s.z[ling] <= d1.z - BLOCK.gap + 1e-6 && s.y[ling] === 0 && d1.hp < d1.hpMax)
  // 没有装置时和裂爪虫一样撞人
  const w2 = sandbox()
  addUnits(w2, 'mortar', 1, 'test')
  run(w2, 0.5)
  const lp2 = put(w2, 'leaper', 0, 4, 1e6)
  w2.swarm.seed[lp2] = 0.5           // 个体散布钉在正中：直奔那台自行炮
  let contact = null
  run(w2, 2, { on: e => { if (e.type === 'enemyAttack' && e.kind === 'leaper') contact = e } })
  check('⑦ 跳跃虫撞人：伤 2，自己也死、不计击杀', contact !== null && w2.squad.units[0].hp === w2.squad.units[0].hpMax - 2 && w2.swarm.state[lp2] === 2 && w2.stats.kills === 0)
}
{
  // ---- 掘地虫：钻过这条道最后一排装置就出土
  const emergeAt = build => {
    const w = sandbox()
    addUnits(w, 'rifle', 6, 'test')
    run(w, 0.3)
    if (build) build(w)
    const di = put(w, 'digger', 0, -12)
    w.swarm.seed[di] = 0.5             // 地下追着队伍走时每只带一点横向偏移：钉在正中，保证它走的是第 2 道
    let ev = null
    run(w, 6, { on: e => { if (e.type === 'emerge' && !ev) ev = e } })
    return { ev, w }
  }
  const bare = emergeAt(null), walled = emergeAt(w => { dev(w, 'barricade', 2, 3); dev(w, 'sentry', 2, 1) }), mined = emergeAt(w => { dev(w, 'mine', 2, 1); dev(w, 'scorcher', 2, 2) })
  const E = ENEMIES.digger.emerge
  check('⑦ 掘地虫：钻得过路障，但钻过本道最后一排装置就得出土（在装置身后），砸不到队伍；没布防的道上照旧钻到阵前',
    bare.ev && near(bare.ev.z, FORMATION.frontZ - E.ahead, 0.01) && bare.ev.hits > 0 && walled.ev && near(walled.ev.z, RZ[1] + E.behind, 0.1) && walled.ev.hits === 0 && walled.w.devices.length === 2 && walled.w.devices.every(d => d.hp === d.hpMax) && mined.ev && near(mined.ev.z, bare.ev.z, 0.01),
    `没布防 z = ${r2(bare.ev.z)}（伤到 ${bare.ev.hits} 人）  有装置 z = ${r2(walled.ev.z)}（伤到 ${walled.ev.hits} 人）`)
  // ---- 翼螫无视地面装置
  const w = sandbox()
  addUnits(w, 'mortar', 1, 'test')
  const bar = dev(w, 'barricade', 2, 2)
  const wing = put(w, 'wing', 0, -8, 1e6)
  run(w, 1.5)
  check('⑦ 翼螫无视地面装置：直接从路障头顶飞过去', w.swarm.z[wing] > bar.z + 2 && w.swarm.y[wing] > 0 && bar.hp === bar.hpMax)
}

// ============================================================ ⑧ 升级卡 / 装置门 / 老猫
{
  const devMods = Object.values(MODULES).filter(m => m.line === 'device')
  check('⑧ 升级卡池里有装置牌：哨戒塔射速 / 穿透、采集器产量、路障反伤、地雷连环引爆、冷凝塔冻结、工程兵，外加四张图纸；中英文案齐全',
    ['dev_sentry_rate', 'dev_sentry_pierce', 'dev_collector_yield', 'dev_barricade_thorns', 'dev_mine_chain', 'dev_cryo_freeze', 'dev_engineer'].every(id => MODULES[id] && MODULES[id].unit === null) && DEVICE_UNLOCK_ORDER.every(k => MODULES['dev_unlock_' + k] && MODULES['dev_unlock_' + k].unlock === k) && devMods.length === 11 && devMods.every(m => m.nameKey in zh && m.descKey in zh && m.nameKey in en && m.descKey in en),
    devMods.map(m => zh[m.nameKey]).join(' / '))
  // 哨戒塔射速 / 穿透
  const shots = mods => { const w = sandbox(); w.enemySpeedMul = 0; for (const id of mods) grantModule(w, id); dev(w, 'sentry', 2, 1); const ids = [0, 1, 2, 3].map(k => put(w, 'ling', 0, -4 - k, 1e5)); let n = 0; run(w, 6, { on: e => { if (e.type === 'deviceFire') n++ } }); return { n, hit: ids.filter(i => w.swarm.hp[i] < 1e5).length } }
  const s0 = shots([]), s1 = shots(['dev_sentry_rate', 'dev_sentry_rate']), s2 = shots(['dev_sentry_pierce', 'dev_sentry_pierce'])
  check('⑧ 「塔载供弹机」每级射速 +25%；「塔用穿甲弹」每级多穿一只', near(s1.n / s0.n, 1.5, 0.05) && s0.hit === 2 && s2.hit === 4, `6 秒 ${s0.n} → ${s1.n} 发；命中 ${s0.hit} → ${s2.hit} 只`)
  // 采集器产量
  const w1 = sandbox(); grantModule(w1, 'dev_collector_yield'); grantModule(w1, 'dev_collector_yield'); dev(w1, 'collector', 0, 0)
  run(w1, 5.1)
  // 路障反伤
  const w2 = sandbox(); grantModule(w2, 'dev_barricade_thorns')
  dev(w2, 'barricade', 2, 2)
  const biter = put(w2, 'crusher', 0, -5, 1000)
  let bites = 0
  run(w2, 5, { on: e => { if (e.type === 'enemyAttack' && e.device != null) bites++ } })
  check('⑧ 「高纯滤芯」采集器每次多产 5；「通电路障」咬它的虫每口掉 3 血（无视护甲，记在 dmgByDevice.barricade）',
    w1.energy === 100 + DEVICES.collector.amount + 2 * 5 && bites > 0 && near(1000 - w2.swarm.hp[biter], bites * 3, 1e-6) && near(w2.stats.dmgByDevice.barricade, bites * 3, 1e-6), `采集器 +${w1.energy - 100}；${bites} 口反伤 ${1000 - w2.swarm.hp[biter]}`)
  // 地雷连环引爆
  const w3 = sandbox(); w3.enemySpeedMul = 0; grantModule(w3, 'dev_mine_chain')
  dev(w3, 'mine', 2, 1)
  const up = put(w3, 'ling', 0, RZ[1] - MINE_CHAIN.step - DEVICES.mine.r + 0.4, 1000)
  put(w3, 'crusher', 0, RZ[1], 5000)
  let booms = []
  run(w3, 7, { on: (e, ww) => { if (e.type === 'explosion' && e.kind === 'mine') booms.push({ t: ww.time, z: e.z }) } })
  check('⑧ 「连环引信」：地雷炸完沿本道往上游再炸一次（威力七成）', booms.length === 2 && near(booms[1].t - booms[0].t, MINE_CHAIN.delay, 0.03) && near(booms[1].z, RZ[1] - MINE_CHAIN.step, 1e-6) && near(1000 - w3.swarm.hp[up], DEVICES.mine.dmg * MINE_CHAIN.dmgMul, 1e-3),
    booms.map(b => `z=${r1(b.z)} @${r2(b.t)}s`).join('  '))
  // 冷凝塔冻结
  const w4 = sandbox(); w4.enemySpeedMul = 1; unlockDevice(w4, 'cryo'); grantModule(w4, 'dev_cryo_freeze')
  dev(w4, 'cryo', 2, 0)
  const victim = put(w4, 'ling', 0, -14, 1e6)
  let stunned = 0
  run(w4, 2.5, { each: ww => { if (ww.swarm.state[victim] === 4) stunned++ } })
  check('⑧ 「深冷回路」：冷凝塔每第 4 发把非重甲目标冻住 1 秒', stunned * DT >= CRYO_FREEZE.dur - 0.1 && CRYO_FREEZE.every === 4, `2.5 秒里冻住 ${r2(stunned * DT)}s`)
  // 工程兵
  const w5 = sandbox()
  const c0 = w5.cards.map(c => c.cost)
  grantModule(w5, 'dev_engineer'); w5.step(null)
  const c1 = w5.cards.map(c => c.cost)
  grantModule(w5, 'dev_engineer'); w5.step(null)
  check('⑧ 通用「工程兵」：全部装置花费 -15% / 级（卡面花费跟着变）', c1.every((c, k) => c === Math.round(c0[k] * 0.85)) && w5.cards.every((c, k) => c.cost === Math.round(c0[k] * 0.7)) && near(costMul(w5), 0.7, 1e-9), `哨戒塔 ${c0[1]} → ${c1[1]} → ${w5.cards[1].cost}`)
}
{
  // 装置牌只在对应装置已解锁时出；图纸一次只出「下一种」；发牌的第 3 张通用牌 / 装置牌轮流
  const offered = { device: 0, unlock: 0, wrongUnlock: 0, lockedDevice: 0, third: [] }
  for (let seed = 1; seed <= 3; seed++) {
    const world = createWorld({ seed }), play = createBot('good', seed)
    let steps = 0, seenLv = 0
    while (world.status !== 'won' && world.status !== 'lost' && steps++ < 60 * 260) {
      if (world.status === 'levelup' && world.levelup.level !== seenLv) {
        seenLv = world.levelup.level
        const cards = world.levelup.cards
        const un = cards.filter(c => c.unlock)
        offered.device += cards.filter(c => c.kind === 'device').length
        offered.unlock += un.length
        if (un.length > 1 || un.some(c => c.unlock !== nextLocked(world))) offered.wrongUnlock++
        if (cards.some(c => c.kind === 'device' && !c.unlock && c.device && !world._dev.unlocked[c.device])) offered.lockedDevice++
        if (world.progress.upgrades % 2 === 1) offered.third.push(cards[2] ? cards[2].kind : null)
      }
      world.step(play(world))
    }
  }
  check('⑧ 发牌：装置牌真的会出（Card.kind = device，带 device / unlock 字段）；图纸一次只出「下一种没解锁的」；没解锁的装置不出它的强化牌',
    offered.device >= 10 && offered.unlock >= 3 && offered.wrongUnlock === 0 && offered.lockedDevice === 0 && offered.third.length >= 12 && offered.third.filter(k => k === 'device').length >= offered.third.length * 0.8,
    `3 局共出装置牌 ${offered.device} 张（图纸 ${offered.unlock}）；奇数次升级的第 3 张里 ${offered.third.filter(k => k === 'device').length}/${offered.third.length} 是装置牌`)
  // 图纸牌：选了就解锁
  const w = createWorld({ seed: 1 })
  let ev = null
  grantModule(w, 'dev_unlock_cryo')
  for (const e of w.events) if (e.type === 'deviceUnlock') ev = e
  check('⑧ 图纸牌：拿到即解锁，发 deviceUnlock{kind, nameKey}，卡槽亮起', ev && ev.kind === 'cryo' && ev.nameKey === DEVICES.cryo.nameKey && w.cards[4].unlocked === true && nextLocked(w) === 'mortarpit' && unlockDevice(w, 'cryo') === false)
}
{
  // 装置门
  const w = createWorld({ seed: 1 })
  spawnGate(w, 2)
  const g = w.gates, opt = g.left
  const e0 = w.energy
  let res = null, un = null, en1 = null
  // 步数上限 200 → 400（第 4 轮测试：门放慢到约 3.75 秒才结算，225 步）
  for (let n = 0; n < 400 && w.gates !== null; n++) { w.step({ ...INPUT(), targetX: -1.3 }); for (const e of w.events) { if (e.type === 'gateResolve') res = e; if (e.type === 'deviceUnlock') un = e; if (e.type === 'energy' && e.source === 'gate') en1 = e } }
  check('⑧ 装置门（GateOption.type = device）：第 3、7 道门的常规项；穿过去解锁下一种装置并送 75 晶能',
    GATE_SCRIPT[2].alt === 'device' && GATE_SCRIPT[6].alt === 'device' && opt.type === 'device' && opt.params.device === 'cryo' && opt.params.energy === GATE_DEVICE_ENERGY && opt.titleKey === 'gate.device' && opt.titleKey in zh && opt.titleKey in en && opt.tags.join() === 'device' && 'tag.device' in zh && g.right.type === 'unit' &&
    res && res.side === 'left' && un && un.kind === 'cryo' && en1 && en1.amount === 75 && w.cards[4].unlocked && w.energy >= e0 + 75 && w.stats.energy.gate === 75,
    `左：${zh[opt.titleKey].replace('{name}', zh[opt.params.nameKey]).replace('{energy}', opt.params.energy)}`)
  // 全解锁之后退回兵源
  const w2 = createWorld({ seed: 1 })
  for (const k of DEVICE_UNLOCK_ORDER) unlockDevice(w2, k)
  spawnGate(w2, 2)
  check('⑧ 装置全解锁之后，装置门退回原来的兵源项（焚化兵）', w2.gates.left.type === 'unit' && w2.gates.left.unit === 'flamer' && nextLocked(w2) === null)
}
{
  // 老猫：装置花费 -20%，损毁返还 50%
  const R = PASSIVES.rebuild
  const wj = sandbox(1, { commander: 'joe' }), wn = sandbox(1)
  wj.step(null); wn.step(null)
  const costs = wj.cards.map(c => c.cost)
  check('⑧ 老猫的被动（回收程序）：装置花费 -20%（卡面就是打折后的价）',
    R.deviceCost === 0.8 && R.deviceRefund === 0.5 && COMMANDERS.joe.passives.includes('rebuild') && costs.every((c, k) => c === Math.round(DEVICES[DEVICE_KINDS[k]].cost * 0.8)) && wn.cards.every((c, k) => c.cost === DEVICES[DEVICE_KINDS[k]].cost) && 'passive.rebuild.desc' in zh && zh['passive.rebuild.desc'].includes('20%') && en['passive.rebuild.desc'].includes('20%'),
    `哨戒塔 ${wn.cards[1].cost} → ${wj.cards[1].cost}  路障 ${wn.cards[2].cost} → ${wj.cards[2].cost}`)
  const lose = w => {
    w.energy = 100
    w.step(place('barricade', 2, 2))
    const paid = 100 - w.energy
    put(w, 'burster', 0, -6, 1e6)      // 血量给足：别让老猫的钻机半路把它打死
    for (const d of w.devices) d.hp = 1
    let refund = null
    run(w, 1.5, { on: e => { if (e.type === 'energy' && e.source === 'refund') refund = e.amount } })
    return { paid, refund, left: w.devices.length, energy: w.energy }
  }
  const j = lose(wj), n = lose(wn)
  check('⑧ 老猫：装置被毁返还花费的 50%（别的指挥官 / 标准小队不返还）', j.paid === 40 && j.refund === 20 && j.left === 0 && near(j.energy, 80, 1e-6) && n.paid === 50 && n.refund === null && n.left === 0 && near(n.energy, 50, 1e-6), `老猫：花 ${j.paid} 返还 ${j.refund}；标准小队：花 ${n.paid} 返还 ${n.refund}`)
  // 折扣有下限
  grantModule(wj, 'dev_engineer'); grantModule(wj, 'dev_engineer'); wj.step(null)
  check('⑧ 折扣叠加有下限：老猫 + 两级工程兵 = ×0.56，再低也不低于 ×0.5', near(costMul(wj), 0.56, 1e-9) && wj.cards[1].cost === 56)
}

// ============================================================ ⑨ 确定性
{
  for (const [bot, seed] of [['good', 2], ['builder', 5]]) {
    const a = JSON.stringify(runHeadless({ seed, bot }).result), b = JSON.stringify(runHeadless({ seed, bot }).result)
    check(`⑨ 确定性 ${bot} seed=${seed}（含装置 / 晶能 / 电网）`, a === b && JSON.parse(a).devices.placedTotal > 0, `result JSON ${a.length} 字节`)
  }
  const a = JSON.stringify(runHeadless({ seed: 1, bot: 'builder' }).result), c = JSON.stringify(runHeadless({ seed: 2, bot: 'builder' }).result)
  check('⑨ 不同 seed 结果不同', a !== c)
  // 同一串放置输入 → 逐步状态完全一致
  const script = () => {
    const w = createWorld({ seed: 7 })
    const plan = [[30, 'collector', 0, 0], [400, 'collector', 4, 0], [1500, 'sentry', 2, 1], [2600, 'barricade', 2, 2], [3000, 'mine', 1, 3], [3600, 'sentry', 1, 1]]
    const sig = []
    for (let n = 0; n < 60 * 70; n++) {
      const p = plan.find(x => x[0] === n)
      if (w.status === 'levelup') { w.step({ ...INPUT(), pick: 0 }); continue }
      w.step(p ? place(p[1], p[2], p[3]) : null)
      if (n % 300 === 0) sig.push([w.energy, w.devices.map(d => d.id + ':' + d.hp + ':' + d.fireT).join(','), w.stats.kills, w.swarm.living, w.fences.join('')].join('|'))
    }
    return sig.join('\n') + JSON.stringify(w.result().deviceReport)
  }
  const s1 = script(), s2 = script()
  check('⑨ 同种子 + 同一串放置输入：每 5 秒抽样的晶能 / 装置血量 / 开火时刻 / 击杀完全一致', s1 === s2 && s1.includes('sentry'), `${s1.length} 字节`)
}

// ============================================================ ⑩ 性能：3400 只 + 20 个装置
{
  const world = createWorld({ seed: 99 })
  addUnits(world, 'rifle', 49, 'test'); addUnits(world, 'flamer', 10, 'test')
  addUnits(world, 'mortar', 4, 'test'); addUnits(world, 'titan', 3, 'test')
  for (const id of ['rifle_pierce', 'rifle_pierce', 'rifle_pierce', 'rifle_rate', 'rifle_double', 'rifle_frag', 'flamer_napalm', 'mortar_cluster', 'titan_salvo', 'dev_sentry_rate', 'dev_sentry_pierce', 'dev_barricade_thorns']) grantModule(world, id)
  // 20 格放满：5 座哨戒塔、5 个路障、冷凝 ×3、迫击炮 ×2、喷火 ×2、采集器 ×2、地雷（会炸掉，每步补）
  const layout = []
  for (let l = 0; l < 5; l++) { layout.push(['sentry', l, 1]); layout.push(['barricade', l, 2]) }
  layout.push(['collector', 0, 0], ['collector', 4, 0], ['cryo', 1, 0], ['mortarpit', 2, 0], ['cryo', 3, 0], ['scorcher', 1, 3], ['scorcher', 3, 3], ['mortarpit', 0, 3], ['cryo', 4, 3], ['mine', 2, 3])
  const refill = () => { for (const [k, l, r] of layout) if (world.grid.cells[l][r] === null) placeDevice(world, k, l, r, true); for (const d of world.devices) if (d.hpMax > 0) d.hp = d.hpMax }
  refill()
  const play = createBot('idle', 99)
  const rng = world.rng.spawn
  const STEPS = 600
  let total = 0, worst = 0, timed = 0, liveSum = 0, devMin = 99, stressBad = null
  for (let n = 0; n < STEPS + 60; n++) {
    while (world.swarm.living < LIVE_CAP) {
      const kind = rng() < 0.03 && world.swarm.kindCount[3] < 100 ? 3 : rng() < 0.02 ? K.leaper : 0
      if (spawn(world, kind, rng.range(-6, 6), rng.range(-24, 4)) < 0) break
    }
    world.line.hp = world.line.hpMax
    world.fences.fill(false)          // 电网一触发就清掉一整条道，场上就不满了：压测时关掉
    for (const u of world.squad.units) u.hp = u.hpMax
    refill()
    const live = world.swarm.living, nd = world.devices.length
    const running = world.status === 'running'
    const t0 = clock()
    world.step(play(world))
    const ms = clock() - t0
    if (n >= 60 && running) { total += ms; timed++; liveSum += live; if (ms > worst) worst = ms; if (nd < devMin) devMin = nd }
    if (!stressBad) for (const e of world.events) { const bad = findBadEvent(e); if (bad) { stressBad = { step: n, field: bad, event: e }; break } }
  }
  if (stressBad && !badEvent) badEvent = stressBad
  const avg = total / timed
  const dmg = world.stats.dmgByDevice
  check('⑩ 3400 只在场 + 20 个装置时单步平均 < 3ms', avg < 3 && liveSum / timed >= 3390 && devMin === 20 && dmg.sentry > 0 && dmg.cryo > 0 && dmg.mortarpit > 0 && dmg.scorcher > 0,
    `平均 ${avg.toFixed(3)} ms  最慢 ${worst.toFixed(2)} ms  平均在场 ${Math.round(liveSum / timed)}  装置 ${devMin} 个  计时 ${timed} 步  装置伤害 ${Math.round(Object.values(dmg).reduce((a, b) => a + b, 0))}`)
}

// ============================================================ ⑪ 平衡测试（HANDOFF §3，seed 1..10）
{
  const N = 10
  const sweep = (bot, extra = {}) => {
    const rows = []
    for (let seed = 1; seed <= N; seed++) {
      const run1 = runHeadless({ seed, bot, checkEvents: true, ...extra })
      if (run1.badEvent && !badEvent) badEvent = run1.badEvent
      rows.push(run1.result)
    }
    const avg = f => rows.reduce((a, r) => a + f(r), 0) / N
    return { rows, wins: rows.filter(r => r.outcome === 'won').length, loss: avg(r => r.losses), kills: avg(r => r.kills), leak: avg(r => r.leaked), placed: avg(r => r.devices.placedTotal), pre: avg(r => r.fallen.filter(f => f.t < CAMPAIGN_BOSS.at).length) }
  }
  const idle = sweep('idle'), builder = sweep('builder'), good = sweep('good')
  for (const [name, o] of [['idle', idle], ['builder', builder], ['good', good]]) {
    console.log(`   ${name.padEnd(7)} ${o.wins}/${N}  平均击杀 ${Math.round(o.kills)}  损失 ${r1(o.loss)}（Boss 出场前 ${r1(o.pre)}）  漏网 ${r1(o.leak)}  放置 ${r1(o.placed)}  各局击杀 ${o.rows.map(r => r.kills).join(' ')}`)
  }
  check('⑪ idle bot（不动不放）胜率 ≥ 70%', idle.wins >= 7 && idle.placed === 0, `${idle.wins}/10  损失 ${r1(idle.loss)}`)
  check('⑪ 「只布防不走位」bot 胜率 ≥ 90%', builder.wins >= 9 && builder.placed >= 12, `${builder.wins}/10  损失 ${r1(builder.loss)}  放置 ${r1(builder.placed)}`)
  check('⑪ good bot（走位 + 布防 + 技能）100% 胜、每局击杀 ≥ 2 万', good.wins === 10 && good.rows.every(r => r.kills >= 20000), `${good.wins}/10  击杀 ${Math.min(...good.rows.map(r => r.kills))}~${Math.max(...good.rows.map(r => r.kills))}`)
  // 期望变更（第 1 轮测试）：「builder 的损失不到 idle 的一半、idle 出场前掉 ≥ 4 人」→「builder 损失少于 idle、胜率不低于 idle、
  // Boss 出场前 builder 基本不掉人而 idle 会掉（≥ 2）」。理由：测试要求「没躲冲锋会掉一截兵」——builder 和 idle 都不走位，
  // Boss 战里两者同样吃冲锋，损失主体都在 Boss 战（各 40 人上下），一半的比例已经不可能；装置的作用改看 Boss 出场前与总损失的先后。
  // idle 出场前的损失从 4 人降到 2~3 人，是因为掘地虫的破土 / 近战伤害下调了（见 test-units）
  // 期望变更（第 3 轮测试）：「Boss 出场前 builder ≤ 1 人、idle ≥ 2 人」→「builder 总损失不到 idle 的 70%、出场前也少于 idle、胜率不低于 idle」。
  // 理由：硬指标要求守线阶段就有真实威胁（甲壳兽骨刺 2.2 → 2.6、守线波 ×1.35），出场前谁都会掉几个人，「基本不掉人」不再是目标；
  // 同时路障能顶停冲锋（sim/boss.js chargeDevices，builder 会在队伍正前方补一道），Boss 战里布防终于和挂机拉开了差距（实测 27 人 vs 50 人）
  check('⑪ 会布防的明显更轻松：builder 损失不到 idle 的 70%、Boss 出场前也掉得少、胜率不低于 idle', builder.loss < idle.loss * 0.7 && builder.pre < idle.pre && builder.wins >= idle.wins,
    `损失 idle ${r1(idle.loss)} → builder ${r1(builder.loss)}；Boss 出场前 idle ${r1(idle.pre)} → builder ${r1(builder.pre)}`)
  // 晶能经济：全局 12~20 个装置；前 30 秒铺不满；不会全程攒着没处花
  const at = (r, t) => r.timeline.find(s => s.t === t)
  const placedOk = good.rows.every(r => r.devices.placedTotal >= 12 && r.devices.placedTotal <= 20)
  const early = good.rows.map(r => at(r, 30).devices), hoard = good.rows.map(r => Math.max(...r.timeline.map(s => s.energy))), left = good.rows.map(r => r.energy.now / r.energy.earned)
  const spentShare = good.rows.map(r => r.energy.spent / (r.energy.earned + ENERGY.start))
  const curve = [20, 40, 60, 72, 80, 90].map(t => `${t}s ${r1(good.rows.reduce((a, r) => a + at(r, t).devices, 0) / N)}个/${Math.round(good.rows.reduce((a, r) => a + at(r, t).energy, 0) / N)}`).join('  ')
  console.log(`   good 的装置数 / 晶能曲线（10 局平均）：${curve}`)
  check('⑪ 晶能经济：good bot 全局放 12~20 个装置', placedOk, good.rows.map(r => r.devices.placedTotal).join(' '))
  check('⑪ 晶能经济：前 30 秒铺不满（30 秒时 2~6 个装置，离 20 格还远）', early.every(n => n >= 2 && n <= 6), `30 秒时 ${early.join(' ')} 个`)
  check('⑪ 晶能经济：不会全程攒着没处花——存量峰值 ≤ 400，收入的 85% 以上花了出去，终局结余 ≤ 收入的 15%',
    hoard.every(h => h <= 400) && spentShare.every(s => s >= 0.85) && left.every(l => l <= 0.15), `存量峰值 ${Math.max(...hoard)}  花掉 ${Math.round(Math.min(...spentShare) * 100)}%~${Math.round(Math.max(...spentShare) * 100)}%`)
  // 期望变更（第 1 轮测试）：12 次升级 → 8~9 次；约 160 秒打完 → 115~130 秒。理由：测试要求减少升级打断（参考游戏 87 秒 8 次）、一局压到 110~130 秒
  const ups = good.rows.map(r => r.level - 1)
  check('⑪ 一局约 8 次升级（7~10 次）', ups.every(u => u >= 7 && u <= 10), `good ${ups.join(' ')}；idle ${idle.rows.map(r => r.level - 1).join(' ')}`)
  // 期望变更（第 3 轮测试）：Boss 101 → 72 秒出场、判负 137 → 120 秒、good bot 115~130 → 90~105 秒。理由：硬指标「战役总时长 90~105 秒」（参考 87 秒）；
  // 判负 = 出场 + 48 秒（原来 + 36）：Boss 战压在三个大波上，老兵难度最长要 42 秒，36 秒的窗口会把打得动的局判超时
  // 期望变更（第 4 轮测试）：Boss 72 → 84 秒出场、判负 120 → 132 秒、good bot 90~105 → 100~120 秒。理由：用户实玩要求虫潮从少到多（前 35 秒只有裂爪虫的小波），
  // 「总时长可以比现在略长，控制在 100~120 秒」；判负仍是出场 + 48 秒
  check('⑪ 战役约 108 秒：Boss 84 秒出场、132 秒判负，good bot 在 100~120 秒打完', CAMPAIGN_BOSS.at === 84 && CAMPAIGN_LEN === 132 && good.rows.every(r => r.seconds >= 100 && r.seconds <= 120), good.rows.map(r => r1(r.seconds)).join(' '))
  // 每晶能伤害：六种会产伤害的装置都放过的前提下比。场景：开局全解锁 + 1200 晶能（钱够把每种都放上），good bot，10 局汇总
  const rich = sweep('good', { unlockAll: true, onStart: w => { w.energy = 1200 } })
  const DMG_KINDS = ['sentry', 'cryo', 'scorcher', 'mortarpit', 'mine', 'nova']
  const per = {}
  for (const k of DMG_KINDS) { const d = rich.rows.reduce((a, r) => a + r.dmgByDevice[k], 0), s = rich.rows.reduce((a, r) => a + r.devices.spent[k], 0); per[k] = s > 0 ? d / s : 0 }
  const vals = DMG_KINDS.map(k => per[k]), ratio = Math.max(...vals) / Math.min(...vals)
  const share = rich.rows.reduce((a, r) => a + r.deviceReport.reduce((x, d) => x + d.share, 0), 0) / N
  check('⑪ 每晶能伤害（stats.dmgByDevice ÷ 花费）：任何一种装置不超过其他装置的 2.5 倍', rich.wins === 10 && vals.every(v => v > 0) && ratio <= 2.5,
    `${DMG_KINDS.map(k => `${zh[DEVICES[k].nameKey]} ${r1(per[k])}`).join('  ')}   最大 / 最小 = ${r2(ratio)}（全解锁 + 1200 晶能，装置占总伤害 ${Math.round(share * 100)}%）`)
  const normShare = good.rows.reduce((a, r) => a + r.deviceReport.reduce((x, d) => x + d.share, 0), 0) / N
  // 期望变更（第 3 轮测试）：下限 8% → 4%。理由：硬指标要求 40 秒就 50 多人、歼敌速度 300/秒以上，部队的火力比上一轮早到了半分钟，
  // 一局又压到 93 秒（装置能站岗的时间少了四成）；装置的放置数、每晶能伤害都没变（12~20 个、⑪ 的比例检查照旧），占比被摊薄到 5% 上下。
  // 试过对虫伤害整体 ×1.4 / ×2：只到 6% / 7%（虫是被部队和装置抢着打死的，加伤害多半溢出），还让 good bot 的损失跌出 15~35 的区间，没采用
  check('⑪ 装置是一路真火力但不喧宾夺主：正常对局里占总伤害 4%~30%', normShare >= 0.04 && normShare <= 0.30, `good ${Math.round(normShare * 100)}%  builder ${Math.round(builder.rows.reduce((a, r) => a + r.deviceReport.reduce((x, d) => x + d.share, 0), 0) / N * 100)}%`)
  // 老兵难度、三位指挥官
  const vet = sweep('good', { difficulty: 'veteran' })
  check('⑪ 老兵难度 good bot 仍然 ≥ 8/10', vet.wins >= 8, `${vet.wins}/10  损失 ${r1(vet.loss)}`)
}

// ============================================================ ⑫ 时间轴拉伸、事件登记、文案
{
  // 期望变更（第 1 轮测试）：×1.9 → ×1.3；判负 180 → 137 秒（= Boss 出场 + 36 秒）；门不再跟着系数走，改成单排的 12 道（前期 6 秒一道）。
  // 理由：测试嫌一局太长（164~172 秒，参考 87 秒）、补给门 11 秒一道太稀（参考约 6 秒）
  // 期望变更（第 3 轮测试）：×1.3 → ×0.92；判负 137 → 120 秒（= Boss 出场 72 + 48 秒）；前期门 6 秒 → 5.1 秒一道（第 8 道 37.7 秒出、40 秒前过门）。
  // 理由：硬指标「战役 90~105 秒、40 秒兵力 ≥ 50 / 歼敌 ≥ 4000」（参考游戏 87 秒、40 秒 55 人 / 4498 杀），任务书「补给门前期 5~7 秒」
  // 期望变更（第 4 轮测试）：×0.92 → 表直接按实际秒排（CAMPAIGN_STRETCH 只剩「虫随时间变厚」和 Boss 出场在用，改成 ×1.08）；判负 120 → 132 秒；
  // 阶段 0 / 32.2 / 59.8 / 72 → 0 / 35 / 55 / 84（35 秒新虫种开始登场、55 秒大规模虫潮）；侧翼突袭 T(36) → 57 秒（守线阶段才开始，前期只有零星小虫）。
  // 理由：用户实玩「开局来很多虫子，经验涨得飞快，没有渐进感」。门的结算时刻不变，见下一条
  check('⑫ 时间轴：Boss 84 秒出场（基准 78 × 1.08）、判负 132 秒，阶段 0 / 35 / 55 / 84，侧翼突袭 57 秒起',
    CAMPAIGN_STRETCH === 1.08 && CAMPAIGN_LEN === 132 && BOSS_AT === 84 && CAMPAIGN_BOSS.at === Math.round(T(78)) && PHASES.map(p => p.at).join() === '0,35,55,84' && CAMPAIGN_BOSS.deadline === 132 && RUSH.from === 57,
    `阶段 ${PHASES.map(p => p.at).join(' / ')}  Boss ${CAMPAIGN_BOSS.at}s  侧翼突袭 ${RUSH.from}s 起`)
  // 期望变更（第 4 轮测试）：门从出现到结算 2 秒 → 约 3.75 秒（不超过 4.5 秒），结算时刻不变（旧表出现时刻 + 2 秒），出现时刻提前；同一时刻最多一组门：
  // 下一道门出现时上一道至少已经结算 1 秒。理由：用户实玩「门来得太快，还没反应过来就被迫选了，慢一点就行，太慢了也不好」
  const resolveOld = [2, 7.1, 12.2, 17.3, 22.4, 27.5, 32.6, 37.7, 44, 50.5, 57.5, 65].map(t => t + 2)
  // 期望变更（公测反馈「门有点慢，开局怪都到脸上了门才过来」）：路上 3.75 → 约 2.8 秒，介于最初的 2 秒和上一版之间
  check('⑫ 门：路上 2.5~3.2 秒、结算时刻和上一版一样、前期 5.1 秒一道、同一时刻最多一组门（间隔 ≥ 1 秒）、Boss 出场前全部过完',
    GATE_TRAVEL >= 2.5 && GATE_TRAVEL <= 3.2 && GATE.times.length === 12 && GATE.resolve.every((t, i) => near(t, resolveOld[i], 1e-9)) && GATE.times.every((t, i) => near(t + GATE_TRAVEL, GATE.resolve[i], 0.01)) &&
    GATE.times.slice(1, 8).every((t, i) => near(t - GATE.times[i], 5.1, 0.011)) && GATE.times.every((t, i) => i === 0 || t >= GATE.resolve[i - 1] + 1) && GATE.times[0] >= 0 && GATE.resolve[GATE.resolve.length - 1] < CAMPAIGN_BOSS.at && GATE.endlessSpeed === 10.7,
    `路上 ${r2(GATE_TRAVEL)} 秒  出现 ${GATE.times.join(' ')}  结算 ${GATE.resolve.join(' ')}`)
  // 期望变更（第 4 轮测试）：「18 个正波 × 0.92 + 回声波、峰值 1728」→ 26 波渐进表、峰值 2000（Boss 前的「全线压上」）。理由同上：
  // 前 15 秒 8~20 只、15~35 秒 30~150 只且只有裂爪虫、35 秒后九种新虫各领一波（带预告）、55 秒后 800~2000 只的大规模虫潮
  const pre15 = WAVES.filter(w => w.at < 15), mid = WAVES.filter(w => w.at >= 15 && w.at < 35), hold = WAVES.filter(w => w.at >= 55 && w.at < BOSS_AT)
  const onlyLing = w => INTRO_ORDER.every(k => w[k] === 0)
  check('⑫ 波次：前 15 秒 20~55 只、15~35 秒 80~260 只且逐波变大（都只有裂爪虫）、守线 800~2000 只、峰值 2000 在 Boss 前、没有回声波',
    WAVES.length === BASE_WAVE_COUNT && WAVES.every(w => !w.echo) && WAVES.every((w, i) => i === 0 || w.at > WAVES[i - 1].at) &&
    pre15.length >= 3 && pre15.every(w => w.ling >= 20 && w.ling <= 55 && onlyLing(w)) && mid.every((w, i) => w.ling >= 80 && w.ling <= 260 && onlyLing(w) && (i === 0 || w.ling > mid[i - 1].ling)) &&
    hold.every(w => w.ling >= 800 && w.ling <= 2000) && Math.max(...WAVES.map(w => w.ling)) === 2000 && WAVES.find(w => w.ling === 2000).at < BOSS_AT && WAVES.filter(w => w.herald).every(w => w.at >= 35),
    `${WAVES.length} 波，前 15 秒 ${pre15.map(w => w.ling).join('/')}，15~35 秒 ${mid.map(w => w.ling).join('/')}，守线 ${hold.map(w => w.ling).join('/')}，共 ${WAVES.reduce((a, w) => a + w.ling, 0)} 只裂爪虫`)
  // 期望变更（第 4 轮测试）：「前 12 秒涓流减半（EARLY）」→ 前 15 秒涓流 1~2 只/秒（直接写在 TRICKLE 表里，不再乘系数）。理由同上
  // 出生数 = 在场 + 击杀 + 漏网 + 撞到人自己死掉的（不计击杀的那种）
  const spawned = until => { const w = createWorld({ seed: 4 }); const play = createBot('idle', 4); let hit = 0; while (w.time < until) { w.step(play(w)); for (const e of w.events) if (e.type === 'enemyAttack' && e.kind === 'ling' && e.device == null) hit++ } return w.swarm.living + w.stats.kills + w.stats.leaked + hit }
  const s15 = spawned(14.9)
  const waves15 = WAVES.filter(w => w.at + w.dur < 14.9).reduce((a, w) => a + w.ling, 0)
  // 期望值：TRICKLE 阶梯在 0~14.9 秒上的积分（这段时间没有预告，不压涓流）
  let expect = 0
  for (let i = 0; i < TRICKLE.length && TRICKLE[i][0] < 14.9; i++) expect += (Math.min(14.9, i + 1 < TRICKLE.length ? TRICKLE[i + 1][0] : 14.9) - TRICKLE[i][0]) * TRICKLE[i][1]
  // 期望变更（用户实玩：「前期怪物太少，再多一点」，升级门槛保持原样「玩着爽一点」）：前期虫量约翻倍，第一次升级随之提前到约 11 秒
  check('⑫ 前 15 秒只有少量小虫：涓流 2~4 只/秒，加上小波一共两百只上下', TRICKLE.filter(([t]) => t < 15).every(([, r]) => r >= 2 && r <= 4) && Math.abs(s15 - waves15 - expect) <= 4 && s15 <= 260,
    `前 15 秒共出 ${s15} 只（其中小波 ${waves15} 只，涓流 ${s15 - waves15} 只，期望 ${r1(expect)}）`)
  // 期望变更（第 1 轮测试）：「放宽一成（250 … 20250，一局 12 次）」→ 前密后疏的 9 级表（60 … 36000，一局 8~9 次）。理由：减少升级面板的全屏打断
  // 期望变更（第 2 轮测试）：首级 60 → 30。理由：测试实测「升级面板仍约 11 秒弹一次」——旧表实际匀速（14/25/36/48/59/73/85/101 秒）；
  // 新表 30/75/200/470/1050/3400/8400/18500/36000 → 约 10/17/24/32/42/54/70/90 秒，真正前密后疏，仍是 9 级、一局 8~9 次
  // 期望变更（第 3 轮测试）：表改成 30/80/220/520/1200/3700/8800/18800/40000、末级 36000 → 40000。理由：前期虫潮加厚后经验来得更快，
  // 旧表一局 10 次升级（目标 8~9 次）；新表实测 8 / 13 / 18 / 24 / 30 / 36 / 49 / 61 / 82 秒，前密后疏
  // 期望变更（第 4 轮测试）：首级 30 → 65，表改成 65/220/560/1130/2050/5900/16000/27000/40000（末级不变）。理由：用户实玩「开局经验涨得飞快」，
  // 虫潮改成从少到多之后第一次升级要在 15~20 秒（实测 16.8 秒），之后约 27 / 37 / 46 / 55 / 64 / 76 / 89 秒，前期间隔 9~10 秒（上一版 5 秒），
  // 一局仍 8 次，第 8 次在 Boss 战里（上一版 83 秒、出场后 11 秒）；末级 40000 不动，无尽沿用的阈值不变
  check('⑫ 升级经验阈值：前密后疏，战役里够得着 8 级', XP_TABLE.length === 9 && XP_TABLE[0] === 65 && XP_TABLE[8] === 40000 && XP_TABLE.every((v, i) => i === 0 || v > XP_TABLE[i - 1]) && XP_TABLE.every((v, i) => i < 2 || v - XP_TABLE[i - 1] > XP_TABLE[i - 1] - XP_TABLE[i - 2]))
  // 事件登记
  const need = ['devicePlace', 'deviceFire', 'deviceHit', 'deviceDie', 'deviceRemove', 'deviceUnlock', 'placeFail', 'mineArm', 'mineBlast', 'novaBlast', 'energy', 'fence', 'fenceRefill']
  check('⑫ 新事件都登记进 core/events.js，整套测试里没有出现未登记类型 / 非有限数值', need.every(t => EVENT_TYPES.has(t)) && badEvent === null, badEvent ? `${badEvent.event.type}.${badEvent.field}` : need.join(' '))
  // 文案
  const keys = []
  for (const d of Object.values(DEVICES)) keys.push(d.nameKey, d.descKey)
  keys.push('device.fence.name', 'device.fence.desc', 'gate.device', 'tag.device', 'enemy.shieldbug.name', 'enemy.leaper.name', 'comms.first_shieldbug', 'comms.first_leaper', 'comms.first_fence', 'comms.first_device_lost', 'report.section.devices', 'hud.energy')
  const miss = keys.filter(k => !(k in zh) || !(k in en))
  check('⑫ 布防相关文案中英齐全', miss.length === 0, miss.join(', ') || `${keys.length} 条`)
  // 首次遭遇的通讯
  const seen = new Set()
  for (let seed = 1; seed <= 4; seed++) runHeadless({ seed, bot: 'idle', onStep: w => { for (const e of w.events) if (e.type === 'comms') seen.add(e.textKey) } })
  check('⑫ 举盾虫 / 跳跃虫第一次随波出现、电网第一次触发各有一句通讯', seen.has('comms.first_shieldbug') && seen.has('comms.first_leaper') && seen.has('comms.first_fence'), [...seen].filter(k => k.startsWith('comms.first')).join(' '))
}

console.log(failed === 0 ? '\n全部通过.' : `\n${failed} 项未通过.`)
process.exitCode = failed === 0 ? 0 : 1
