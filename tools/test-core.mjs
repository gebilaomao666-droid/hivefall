// 核心战役的无头测试。node tools/test-core.mjs
//   ① 确定性  ② good bot seed 1..10 全胜 / 击杀 ≥ 2 万 / 用时 ≤180s  ③ idle bot 胜率 ≥ 7/10
//   【布防系统落地后改过的期望，理由逐条写在断言旁边】时间轴整体 ×1.9（data/waves.js 的 CAMPAIGN_STRETCH），一局从 95 秒拉到约 180 秒
//   【第 1 轮测试后改过的期望，理由同样写在断言旁边】时间轴 ×1.9 → ×1.3、增援门单独排（前期 6 秒一道）、升级 12 次 → 8~9 次、
//   Boss 加阶段、后排 / 远程虫打得到人：一局 115~130 秒，good bot 要掉 5~20 人、防线掉到 70~90%，idle 7~9/10
//   【第 3 轮测试后改过的期望】对照参考游戏实测的硬指标：时间轴 ×1.3 → ×0.92（Boss 72 秒出场、一局 90~105 秒）、前期虫潮加厚、
//   40 秒兵力 ≥ 50 / 累计歼敌 ≥ 4000 / 35~45 秒歼敌速度 ≥ 300、good bot 损失 15~35 / 防线最低 60~75%、各指挥官碾压者战 ≥ 18 秒
//   【第 4 轮测试后改过的期望】用户实玩「开局虫子太多、经验涨得飞快、没有渐进感」：虫潮改成从少到多（data/waves.js 整张表重写），
//   Boss 72 → 84 秒出场、一局 100~120 秒、good bot 击杀 2.7~3.4 万 → 2.2~2.7 万、40 秒歼敌 ≥ 4000 → 400~1500、第一次升级 15~20 秒
//   ②b 节奏：40 秒兵力 50~65、渐进（20 秒 ≤ 200 杀、40 秒 400~1500 杀、守线阶段歼敌速度 ≥ 300/秒且是成型阶段的 5 倍以上）、第一次升级 15~20 秒、
//   前 5 道门间隔 5~7 秒、升级 8~9 次、一局 100~120 秒、Boss 战 18~30 秒 / 机制 ≥ 3 次 / 两个阶段都出现
//   ④ 3400 只在场时单步平均 < 3ms  ⑤ 事件里没有 NaN 坐标、没有未登记类型
//   ⑥ 平衡目标（seed 1..10）：挂机有可见损失、老兵明显更难、随机草稿、重型路线、选牌不设必败陷阱、Boss 战够长
//   另外顺手查：中英文案 key 一致、数据引用的 key 都有文案、i18n 占位符、模拟层没碰禁用 API
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runHeadless, createBot } from '../src/sim/bot.js'
import { createWorld } from '../src/sim/world.js'
import { addUnits } from '../src/sim/squad.js'
import { spawn } from '../src/sim/swarm.js'
import { grantModule } from '../src/sim/progression.js'
import { findBadEvent } from '../src/core/events.js'
import { UNITS } from '../src/data/units.js'
import { ENEMIES, LIVE_CAP, DIFFICULTY } from '../src/data/enemies.js'
import { MODULES } from '../src/data/modules.js'
import { COMBOS, HEROICS } from '../src/data/combos.js'
import { WAVES, PHASES, CAMPAIGN_LEN, CAMPAIGN_STRETCH, T } from '../src/data/waves.js'
import { BOSSES, CAMPAIGN_BOSS } from '../src/data/bosses.js'
import { COMMANDERS } from '../src/data/commanders.js'
import { createI18n } from '../src/core/i18n.js'
import zh from '../src/data/strings.zh.js'
import en from '../src/data/strings.en.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clock = () => Number(process.hrtime.bigint()) / 1e6
let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}

// ---- ① 确定性 ----
{
  for (const [bot, seed] of [['good', 1], ['random', 3], ['idle', 8]]) {
    const a = JSON.stringify(runHeadless({ seed, bot }).result)
    const b = JSON.stringify(runHeadless({ seed, bot }).result)
    check(`① 确定性 ${bot} seed=${seed}`, a === b, `result JSON ${a.length} 字节`)
  }
  const a = JSON.stringify(runHeadless({ seed: 1, bot: 'good' }).result)
  const c = JSON.stringify(runHeadless({ seed: 2, bot: 'good' }).result)
  check('① 不同 seed 结果不同', a !== c)
}

// ---- ② good bot / ⑤ 事件 ----
let badEvent = null
{
  let wins = 0, inBand = 0, inTime = 0
  const rows = []
  for (let seed = 1; seed <= 10; seed++) {
    const run = runHeadless({ seed, bot: 'good', checkEvents: true })
    const r = run.result
    if (r.outcome === 'won') wins++
    // 期望变更：击杀 1~1.5 万 → ≥ 2 万（上限 2.6 万）。理由：GDD §13 / HANDOFF §3 要求拉长后敌人总量相应增加、good bot 击杀 ≥ 2 万
    // 期望变更（第 3 轮测试）：2~2.6 万 → 2.7~3.4 万。理由：硬指标要求 40 秒累计歼敌 ≥ 4000、歼敌速度 ≥ 300/秒（参考 4498 / 356），
    // 前 10 波加厚三到五成、守线阶段的波再 ×1.35，实测 2.99~3.03 万；Boss 后三波按 POST 缩了 28%，总量没有无限涨
    // 期望变更（第 4 轮测试）：2.7~3.4 万 → 2.2~2.7 万。理由：用户实玩要求虫潮从少到多，前 55 秒从约 1.1 万只压到约 1500 只（零星小波 → 新虫种逐个登场），
    // 守线阶段和 Boss 战的量级不变，局长 96 → 108 秒；实测 2.40~2.44 万
    if (r.kills >= 22000 && r.kills <= 27000) inBand++
    // 期望变更：≤ 95s → ≤ CAMPAIGN_LEN（180s → 第 1 轮测试后 137s = Boss 出场 101s + 36s）。理由：判负时刻跟着时间轴走
    if (r.seconds <= CAMPAIGN_LEN) inTime++
    if (run.badEvent && !badEvent) badEvent = run.badEvent
    const t40 = r.timeline.find(s => s.t === 40)
    rows.push(`   seed ${String(seed).padStart(2)}  ${r.outcome}  ${r.seconds}s  击杀 ${r.kills}  损失 ${r.losses}  防线 ${r.line.hp}  峰值 ${r.peakKillRate}/s  40s 兵力 ${t40 ? t40.troops : '-'}  Lv${r.level}  最高连杀 ${r.maxCombo}`)
  }
  console.log(rows.join('\n'))
  // 击杀区间 20000~26000 没动：时间轴压短了，但波次总量没变（最后两波各减了约 15%，Boss 阶段召唤补回来一部分），实测 2.3~2.5 万
  check('② good bot seed 1..10 全部获胜', wins === 10, `${wins}/10`)
  check('② good bot 击杀在 22000~27000', inBand === 10, `${inBand}/10`)
  check(`② good bot 用时 ≤ ${CAMPAIGN_LEN}s`, inTime === 10, `${inTime}/10`)
}

// ---- ③ idle bot ----
{
  let wins = 0, idleLoss = 0, idleLeak = 0, idleClean = 0, idleFence = 0
  const rows = []
  for (let seed = 1; seed <= 10; seed++) {
    const run = runHeadless({ seed, bot: 'idle', difficulty: 'normal', checkEvents: true })
    const r = run.result
    if (r.outcome === 'won') wins++
    idleLoss += r.losses; idleLeak += r.leaked; idleFence += r.fencesUsed; if (r.losses === 0) idleClean++
    if (run.badEvent && !badEvent) badEvent = run.badEvent
    rows.push(`   seed ${String(seed).padStart(2)}  ${r.outcome}${r.reason ? '(' + r.reason + ')' : ''}  ${r.seconds}s  击杀 ${r.kills}  损失 ${r.losses}  防线 ${r.line.hp}`)
  }
  console.log(rows.join('\n'))
  // 期望变更：≥ 8/10 → ≥ 7/10。理由：HANDOFF §3 的测试线是「idle（不动不放）胜率 ≥ 70%」——不布防应该比以前吃力
  check('③ idle bot normal 胜率 ≥ 7/10', wins >= 7, `${wins}/10`)
  // 期望变更：「平均漏网 ≥ 3」→「平均（漏网 + 触发的电网道数）≥ 1」。理由：每条道第一只冲到底的虫现在由应急电网接住（不计 leaked、不扣防线），
  // 漏网数天然少了一截；「冲到底」的后果改成看漏网与电网之和。损失的门槛没动
  check('③ idle bot 有可见损失（不是零损失、没有虫冲到底）', idleClean === 0 && idleLoss / 10 >= 5 && (idleLeak + idleFence) / 10 >= 1, `平均损失 ${idleLoss / 10}  平均漏网 ${idleLeak / 10}  平均触发电网 ${idleFence / 10} 道  零损失 ${idleClean} 局`)
  // 新增（第 1 轮测试）：挂机要「明显吃力」——不能 10/10 轻松过，平均至少赔掉三分之一的人
  check('③ idle bot 明显吃力：胜率 ≤ 9/10、平均损失 ≥ 20', wins <= 9 && idleLoss / 10 >= 20, `${wins}/10  平均损失 ${idleLoss / 10}`)
}

// ---- ②b 节奏与危险感（第 1 轮测试新增；参考游戏：87 秒一局、约 6 秒一道门、40 秒 55 人、8 次升级）----
{
  const f1 = v => Math.round(v * 10) / 10
  const rows = []
  const acc = { t40: [], k20: [], k40: [], r40: [], rHold: [], lv1: [], secs: [], gap5: [], ups: [], fight: [], mech: [], phases: [], loss: [], lineMin: [] }
  for (let seed = 1; seed <= 10; seed++) {
    const gates = [], mech = { n: 0 }
    let ups = 0, lv1 = null, bossT = null, fight = null, phases = 0, lineMin = 1
    const run = runHeadless({ seed, bot: 'good', onStep: w => {
      for (const e of w.events) {
        if (e.type === 'gateSpawn') gates.push(w.time)
        else if (e.type === 'levelUp') { ups++; if (lv1 === null) lv1 = w.time }
        else if (e.type === 'bossSpawn') bossT = w.time
        else if (e.type === 'bossDie') fight = w.time - bossT
        else if (e.type === 'bossPhase' && fight === null) { phases++; mech.n++ }
        else if (e.type === 'bossAttack' && fight === null && (e.kind === 'charge_windup' || e.kind === 'sweep')) mech.n++
      }
      const l = w.line.hp / w.line.hpMax
      if (l < lineMin) lineMin = l
    } })
    const r = run.result, t40 = r.timeline.find(s => s.t === 40), t35 = r.timeline.find(s => s.t === 35), t45 = r.timeline.find(s => s.t === 45)
    const at = t => r.timeline.find(s => s.t === t)
    acc.k20.push(at(20).kills); acc.k40.push(t40.kills); acc.r40.push((t45.kills - t35.kills) / 10); acc.rHold.push((at(80).kills - at(65).kills) / 15); acc.lv1.push(lv1); acc.secs.push(r.seconds)
    const gaps = gates.slice(1, 6).map((t, i) => t - gates[i])
    acc.t40.push(t40.troops); acc.gap5.push(gaps.reduce((a, b) => a + b, 0) / gaps.length); acc.ups.push(ups)
    acc.fight.push(fight === null ? 0 : fight); acc.mech.push(mech.n); acc.phases.push(phases); acc.loss.push(r.losses); acc.lineMin.push(lineMin)
    rows.push(`   seed ${String(seed).padStart(2)}  ${r.seconds}s  40s 兵力 ${t40.troops} 歼敌 ${t40.kills} 速度 ${acc.r40[seed - 1]}/s  前 5 道门间隔 ${f1(acc.gap5[seed - 1])}s  升级 ${ups} 次  Boss 战 ${f1(fight || 0)}s 机制 ${mech.n} 次 阶段 ${phases}  损失 ${r.losses}  防线最低 ${Math.round(lineMin * 100)}%`)
  }
  console.log(rows.join('\n'))
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length
  // 期望变更（第 3 轮测试）：40 秒兵力 35~50 → 50~65。理由：硬指标「40 秒时兵力 ≥ 50」（参考游戏 55）。good bot 选门最会算，40 秒就把 60 人的步兵编制填满，
  // 再加自行炮 / 重型，所以上限放到 65；实机试玩手（tools/playtest-pilot.js，选门没那么精）40 秒约 50 人
  check('②b 滚雪球：40 秒兵力平均 50~65（参考 55）', avg(acc.t40) >= 50 && avg(acc.t40) <= 65, `平均 ${f1(avg(acc.t40))}`)
  // 期望变更（第 4 轮测试）：「40 秒累计歼敌 ≥ 4000、35~45 秒歼敌速度 ≥ 300/秒」（第 3 轮对标参考游戏的硬指标）→ 渐进曲线。
  // 理由：用户实玩「开局来很多虫子，经验涨得飞快，没有渐进的感觉」，要求 0~15 秒零星几只、15~35 秒 30~150 只的小波、35 秒后才逐个上新虫种、
  // 55 秒后才是大规模虫潮。所以改成：20 秒累计 ≤ 200、40 秒 400~1500、守线阶段（65~80 秒）歼敌速度 ≥ 300/秒且 ≥ 成型阶段（35~45 秒）的 5 倍
  // 期望变更（用户实玩：「前期怪物太少，再多一点」，升级门槛保持原样「玩着爽一点」）：前期虫量约翻倍，第一次升级随之提前到约 11 秒
  check('②b 渐进：20 秒累计歼敌 ≤ 400、40 秒 900~2200（不再开局就几千只）', acc.k20.every(k => k <= 400) && acc.k40.every(k => k >= 900 && k <= 2200),
    `20 秒 ${Math.min(...acc.k20)}~${Math.max(...acc.k20)}  40 秒 ${Math.min(...acc.k40)}~${Math.max(...acc.k40)}`)
  check('②b 渐进：守线阶段 65~80 秒歼敌速度 ≥ 300/秒，且是 35~45 秒的 5 倍以上', avg(acc.rHold) >= 300 && avg(acc.rHold) >= avg(acc.r40) * 5,
    `35~45 秒 ${Math.round(avg(acc.r40))}/s → 65~80 秒 ${Math.round(avg(acc.rHold))}/s`)
  // 新增（第 4 轮测试）：第一次升级在 15~20 秒（上一版 8 秒）——先熟悉移动、选门、放第一个装置
  check('②b 第一次升级在 9~14 秒', acc.lv1.every(t => t !== null && t >= 9 && t <= 14), acc.lv1.map(f1).join(' '))
  // 期望变更（第 4 轮测试）：一局 90~105 → 100~120 秒。理由：前期放缓、Boss 72 → 84 秒出场（用户：「总时长可以比现在略长，控制在 100~120 秒」）
  check('②b 一局 100~120 秒', acc.secs.every(t => t >= 100 && t <= 120), `${f1(Math.min(...acc.secs))}~${f1(Math.max(...acc.secs))}s`)
  check('②b 前期增援门 5~7 秒一道', acc.gap5.every(g => g >= 5 && g <= 7), acc.gap5.map(f1).join(' / '))
  check('②b 一局升级 8~9 次（参考 8 次），不再 12 次', avg(acc.ups) >= 8 && avg(acc.ups) <= 9 && acc.ups.every(n => n >= 7 && n <= 10), acc.ups.join(' '))
  check('②b Boss 战 18~30 秒、机制 ≥ 3 次、两个阶段都出现', acc.fight.every(t => t >= 18 && t <= 30) && acc.mech.every(n => n >= 3) && acc.phases.every(n => n === 2), `${f1(Math.min(...acc.fight))}~${f1(Math.max(...acc.fight))}s  机制 ${Math.min(...acc.mech)}~${Math.max(...acc.mech)} 次`)
  // 期望变更（第 3 轮测试）：损失 5~20 → 15~35、防线最低 70~90% → 60~75%。理由：硬指标「normal good bot 平均损失 15~35 人、至少有一段防线掉到 60~75%」
  // （上一轮实测 11 人、87%，测试「两局都轻松赢」）。掉线主要来自 Boss 冲锋：躲开了它一头撞在防线上（crashLine 95），不躲就掉一截兵
  check('②b 危险感：good bot 平均损失 15~35、防线最低平均 60~75%', avg(acc.loss) >= 15 && avg(acc.loss) <= 35 && avg(acc.lineMin) >= 0.6 && avg(acc.lineMin) <= 0.75, `损失 ${f1(avg(acc.loss))}  防线最低 ${Math.round(avg(acc.lineMin) * 100)}%`)
}

// random bot 与老兵难度只跑事件检查，不设胜率门槛
for (const [bot, difficulty, seed] of [['random', 'normal', 1], ['random', 'normal', 3], ['good', 'veteran', 1]]) {
  const run = runHeadless({ seed, bot, difficulty, checkEvents: true })
  if (run.badEvent && !badEvent) badEvent = run.badEvent
  console.log(`   ${bot}/${difficulty} seed ${seed}: ${run.result.outcome}  ${run.result.seconds}s  击杀 ${run.result.kills}  损失 ${run.result.losses}`)
}

// ---- ④ 3400 只在场时的单步耗时 ----
{
  const world = createWorld({ seed: 99 })
  addUnits(world, 'rifle', 49, 'test'); addUnits(world, 'flamer', 10, 'test')
  addUnits(world, 'mortar', 4, 'test'); addUnits(world, 'titan', 3, 'test')
  for (const id of ['rifle_pierce', 'rifle_pierce', 'rifle_pierce', 'rifle_rate', 'rifle_double', 'rifle_frag', 'flamer_napalm', 'mortar_cluster', 'titan_salvo']) grantModule(world, id)
  const play = createBot('idle', 99)
  const rng = world.rng.spawn
  const STEPS = 600
  let total = 0, worst = 0, timed = 0, liveSum = 0, stressBad = null
  for (let n = 0; n < STEPS + 60; n++) {
    // 每步把场上补满到硬上限，铺满整座桥；不让这局结束
    while (world.swarm.living < LIVE_CAP) {
      const kind = rng() < 0.03 && world.swarm.kindCount[3] < 100 ? 3 : 0
      if (spawn(world, kind, rng.range(-6, 6), rng.range(-24, 4)) < 0) break
    }
    world.line.hp = world.line.hpMax
    for (const u of world.squad.units) u.hp = u.hpMax
    const live = world.swarm.living
    const running = world.status === 'running'
    const t0 = clock()
    world.step(play(world))
    const ms = clock() - t0
    if (n >= 60 && running) { total += ms; timed++; liveSum += live; if (ms > worst) worst = ms }   // 前 60 步给 JIT 预热
    if (!stressBad) for (const e of world.events) { const bad = findBadEvent(e); if (bad) { stressBad = { step: n, field: bad, event: e }; break } }
  }
  if (stressBad && !badEvent) badEvent = stressBad
  const avg = total / timed
  check('④ 3400 只在场时单步平均 < 3ms', avg < 3 && liveSum / timed >= 3390, `平均 ${avg.toFixed(3)} ms  最慢 ${worst.toFixed(2)} ms  平均在场 ${Math.round(liveSum / timed)}  计时 ${timed} 步  击杀 ${world.stats.kills}`)
}

check('⑤ 事件里没有 NaN / 未登记类型', badEvent === null, badEvent ? `step ${badEvent.step} ${badEvent.event.type}.${badEvent.field}` : '')

// ---- ⑥ 平衡目标 ----
// 自带选牌规则的一局：good bot 走位，pick(world, cards) 决定拿哪张
function runWith({ seed, pick, difficulty = 'normal' }) {
  const world = createWorld({ seed, difficulty }), play = createBot('good', seed)
  let steps = 0
  while (world.status !== 'won' && world.status !== 'lost' && steps++ < 60 * 300) {     // 步数上限跟着局长放宽（原 200 秒）
    const input = play(world)
    if (world.status === 'levelup') input.pick = pick(world, world.levelup.cards)
    world.step(input)
  }
  return world.result()
}
// 一组种子的汇总，顺带量 Boss 战：出场到倒下的秒数、各机制出现的次数
function sweep(opts, seeds = 10) {
  const out = { wins: 0, loss: 0, leak: 0, ttk: [], mech: [], rows: [] }
  for (let seed = 1; seed <= seeds; seed++) {
    let t0 = null, ttk = null
    const mech = {}
    const run = runHeadless({ seed, ...opts, checkEvents: true, onStep: world => {
      for (const e of world.events) {
        if (e.type === 'bossSpawn') t0 = world.time
        else if (e.type === 'bossDie') ttk = world.time - t0
        else if (e.type === 'bossAttack' || e.type === 'bossStun') { const k = e.type === 'bossStun' ? 'stun' : e.kind; mech[k] = (mech[k] || 0) + 1 }
      }
    } })
    const r = run.result
    if (run.badEvent && !badEvent) badEvent = run.badEvent
    if (r.outcome === 'won') out.wins++
    out.loss += r.losses / seeds; out.leak += r.leaked / seeds
    if (ttk !== null) { out.ttk.push(ttk); out.mech.push(mech) }
    out.rows.push(r)
  }
  return out
}
const f1 = v => Math.round(v * 10) / 10
{
  const good = sweep({ bot: 'good' })
  const vet = sweep({ bot: 'good', difficulty: 'veteran' })
  // 期望变更：老兵 dmgMul 2 → 1.35，另加 bossHpMul 1.4（Boss 单独一个系数）。理由：第 1 轮测试让普通难度本身就要掉 5~20 人——
  // 翼螫 / 甲壳兽 / Boss 横扫都真的打得到人了，再 ×2 伤害 good bot 只剩 0~3/10（实测）；1.35 时 10/10、损失约 3 倍于普通、Boss 战更久
  // 期望变更（第 2 轮）：bossHpMul 1.4 → 1.5。理由：普通难度碾压者 23500 → 27500 之后，1.4 时老兵最短的一局（23.6 秒）
  // 短于普通难度最长的一局（24.2 秒），「Boss 战更久」不再成立；1.5 时老兵 25.2~45.6 秒、普通 18.7~24.3 秒
  // 期望变更（集成第 1 轮）：bossHpMul 1.5 → 1.6。理由：src/sim/squad.js 修了阵型 bug（死一人后同排的人左右互换、几步内整排挤成 3~4 米一摞，
  // 碾压者冲锋时最明显），方阵始终满宽之后老兵最短一局 21.6 秒（seed 10）短于普通最长 22.6 秒；1.6 时老兵 23.8~36.8 秒、普通 18.9~22.6 秒，断言本身不变
  // 期望变更（第 2 轮修复）：bossHpMul 1.6 → 1.9。理由：普通难度碾压者 25000 → 20500（实机 Boss 战 33.5 秒，比无头长 50%，见下一条），
  // 老兵的绝对血量 40000 → 38950 基本不变；1.6 / 1.8 时老兵最短一局短于普通最长一局；1.9 时最长一局 56 秒，靠 20 秒加时收尾（仍 10/10）。断言本身不变
  check('⑥ 老兵难度：good bot 仍多数获胜，但明显更难（损失更多、Boss 战更久）', DIFFICULTY.veteran.hpMul === 1.35 && DIFFICULTY.veteran.dmgMul === 1.35 && DIFFICULTY.veteran.bossHpMul === 1.9 && vet.wins >= 8 && vet.loss >= good.loss + 3 && Math.min(...vet.ttk) > Math.max(...good.ttk),
    `normal ${good.wins}/10 损失 ${f1(good.loss)} 漏网 ${f1(good.leak)}  →  veteran ${vet.wins}/10 损失 ${f1(vet.loss)} 漏网 ${f1(vet.leak)}`)
  const vidle = sweep({ bot: 'idle', difficulty: 'veteran' })
  check('⑥ 老兵难度不能挂机过', vidle.wins <= 3, `idle veteran ${vidle.wins}/10`)
  const rnd = sweep({ bot: 'good', draft: 'random' })
  check('⑥ 随机草稿 good bot ≥ 8/10', rnd.wins >= 8, `${rnd.wins}/10  损失 ${f1(rnd.loss)}`)
  // 重型路线：过门见重型就拿（heavy），连牌也优先拿重型的（heavy2）。重型门带 4 名护卫，不然一台换十个步兵守不住
  const heavy = sweep({ bot: 'heavy' }), heavy2 = sweep({ bot: 'heavy2' }), vheavy = sweep({ bot: 'heavy', difficulty: 'veteran' })
  check('⑥ 重型 / 炮兵路线不明显弱于堆步兵', heavy.wins === 10 && heavy2.wins >= 9 && heavy.loss <= good.loss + 3 && heavy2.loss <= good.loss + 5 && vheavy.wins >= vet.wins - 1 && vheavy.loss <= vet.loss + 5,
    `heavy ${heavy.wins}/10 损失 ${f1(heavy.loss)}  heavy2 ${heavy2.wins}/10 损失 ${f1(heavy2.loss)}  veteran: heavy ${vheavy.wins}/10 损失 ${f1(vheavy.loss)}（good ${vet.wins}/10 损失 ${f1(vet.loss)}）`)

  // Boss 战：至少 min 秒，看得到机制（冲锋预警至少一次，冲锋预警 + 横扫合计至少两次），两个阶段都打出来（各召唤一波护卫）
  // 期望变更（第 1 轮测试）：标准小队 ≥ 8 秒 → 18~30 秒；新增「两个阶段都出现」。理由：测试要求 Boss 战 18~30 秒、至少 3 次机制
  const bossOk = (o, min = 8, max = Infinity) => o.ttk.length === 10 && Math.min(...o.ttk) >= min && Math.max(...o.ttk) <= max && o.mech.every(m => (m.charge_windup || 0) >= 1 && (m.charge_windup || 0) + (m.sweep || 0) >= 2 && (m.summon || 0) === 2)
  const avg = (o, k) => f1(o.mech.reduce((a, m) => a + (m[k] || 0), 0) / o.mech.length)
  const line = o => `${f1(Math.min(...o.ttk))}~${f1(Math.max(...o.ttk))}s  冲锋预警 ${avg(o, 'charge_windup')}  横扫 ${avg(o, 'sweep')}  撞墙眩晕 ${avg(o, 'stun')}`
  // 期望变更：出场 78s / 血 10500 → 出场 148s（= 78 × 1.9）/ 血 26000。理由：出场时刻跟着时间轴拉伸；
  // 拉长后多了 2 次升级和装置这一路火力，10500 血 5 秒就倒（实测 4.8~5.6s），按「≥ 8 秒」的原标准重调了血量
  // 期望变更（第 1 轮测试）：出场 148s → 101s（= 78 × 1.3）、血 26000 → 23500。理由：Boss 加了两次各 4 秒的甲壳硬化（按时间拖长战斗，
  // 对打得好和打得差的小队拖一样多的秒数），血量就可以低一点——血量高了挂机小队的 Boss 战比标准小队长一半、idle 掉到 3/10
  // 期望变更（第 2 轮测试）：血 23500 → 27500。理由：测试「碾压者一出场就贴到我方前排、埋在虫堆里」，站位从阵前 3 米后撤到 6.6 米（holdZ 5 → 1.5），
  // 火焰兵够不着它了，23500 时标准小队最快 16.8 秒打完；27500 回到 18.7~24.3 秒。同时冲锋一下撞的人从在场 30% 降到 24%，挂机小队仍 9/10
  // 期望变更（第 3 轮测试）：血 27500 → 25000。理由：时间轴 ×0.92 后 Boss 72 秒出场，同时硬化期间跳不过阶段阈值（每阶段至少撑满 6.5 秒硬化），
  // 战斗长度主要由硬化的时长托底，血量反而可以降一点；标准小队实测 19.3~22.8 秒
  // 期望变更（第 2 轮修复）：血 25000 → 20500。理由：测试实机 Boss 战 33.5 秒（无头 21 秒），超出 18~30 秒、把一局拖到 105.7 秒；
  // 无头的长度主要由两次 6.5 秒硬化托底、实机多出来的是输出不足时的掉血段，削血只缩这一段：无头仍 19~22 秒，实机按输出比例估 28~30 秒
  check('⑥ Boss 战持续 18~30 秒、看得到机制与两个阶段（good bot，标准小队）', CAMPAIGN_BOSS.at === Math.round(78 * CAMPAIGN_STRETCH) && CAMPAIGN_BOSS.deadline === CAMPAIGN_LEN && BOSSES.ravager.hp === 20500 && bossOk(good, 18, 30), line(good))
  for (const c of Object.keys(COMMANDERS)) {
    const o = sweep({ bot: 'good', commander: c })
    // 期望变更：只有霍克这一条从 ≥ 8 秒放到 ≥ 6 秒，机制次数的要求不变；伊瑟拉 / 老猫仍是 ≥ 8 秒。理由（实测，tools 里扫过血量）：
    // 带霍克的小队（鼓舞 + 空投多出来的人）打 Boss 的火力约是挂机小队的 2.7 倍，Boss 血量被两头夹住——
    //   31500：霍克最快 8.1 秒，但 idle 只剩 3/10；29000：霍克 7.2 秒，idle seed 1..20 胜 13 局；27500：idle 16/20；
    //   26000（现值）：idle 20/20、标准小队 9.0~11.5 秒、伊瑟拉 ≥ 8.6、老猫 ≥ 8.4，霍克最快的一局 6.6 秒（仍看得到两次冲锋预警）。
    // 「idle ≥ 70%」是 HANDOFF §3 的硬指标，所以让的是霍克这一条
    // 期望变更（第 1 轮测试）：霍克 ≥ 6 → ≥ 12 秒，伊瑟拉 / 老猫 ≥ 8 → ≥ 15 秒，并且两个阶段都要打出来。理由：阶段阈值封顶了单下伤害，
    // 再猛的火力也要走完两次甲壳硬化；指挥官本来就比标准小队快，所以下限比标准小队的 18 秒低一截
    // 期望变更（第 3 轮测试）：霍克 ≥ 12、伊瑟拉 / 老猫 ≥ 15 → 三位都 ≥ 18 秒。理由：硬指标「碾压者战斗 ≥ 18 秒，各指挥官都要满足（霍克那局只有 14 秒）」。
    // 做法不是堆血（血量 27500 → 25000 反而降了）：甲壳硬化期间跳不过下一个阶段阈值、最后一个阶段里打不死（boss.js），
    // 火力再猛也要撑满两次各 6.5 秒的硬化，Boss 战的下限是「第一阶段 + 13 秒」
    const min = 18
    check(`⑥ Boss 战持续 ≥ ${min} 秒、看得到机制与两个阶段（${c}）`, o.wins === 10 && bossOk(o, min), `${o.wins}/10  ${line(o)}`)
  }
  for (const kind of ['matriarch', 'leviathan']) {
    const o = sweep({ bot: 'good', boss: kind })
    // 两种 Boss 的硬化 2.5 → 3.5 秒、渊噬蠕虫战役血量 22500 → 26000（潜地时硬化照样在走，单靠硬化托不住 14 秒的线），条件不变
    // 期望变更（第 1 轮测试）：≥ 8 → ≥ 14 秒，并且两个阶段都出现（summon ×2）。理由同上；两种 Boss 的战役血量也上调了（12500 → 14500 / 17500 → 22500）；第 2 轮巢母再 14500 → 16000（升级前移 + 战地包扎之后最快 13.6 秒，低于 14 秒的线），条件不变
    const need = kind === 'matriarch' ? m => (m.acid || 0) + (m.lay || 0) >= 2 && m.summon === 2 : m => (m.emerge || 0) >= 2 && m.summon === 2
    check(`⑥ ${kind} 当战役 Boss：≥ 14 秒、机制出现 ≥ 2 次、两个阶段`, o.wins === 10 && o.ttk.length === 10 && Math.min(...o.ttk) >= 14 && o.mech.every(need),
      `${f1(Math.min(...o.ttk))}~${f1(Math.max(...o.ttk))}s  ${Object.entries(o.mech[0]).map(([k, n]) => k + ' ' + n).join(' / ')}`)
  }

  // 选牌不设必败陷阱（测试 #12）：总拿第 2 张 / 第 3 张也过得去；不拿「碎甲弹头」也过得去（测试 #15）
  for (const [name, pick] of [['总选第 2 张', (w, c) => Math.min(1, c.length - 1)], ['总选第 3 张', (w, c) => Math.min(2, c.length - 1)]]) {
    let wins = 0, loss = 0
    for (let seed = 1; seed <= 10; seed++) { const r = runWith({ seed, pick }); if (r.outcome === 'won') wins++; loss += r.losses / 10 }
    check(`⑥ 选牌：${name}，normal 胜率 ≥ 8/10`, wins >= 8, `${wins}/10  损失 ${f1(loss)}`)
  }
  {
    const score = c => (c.id === 'rifle_frag' ? -100 : c.unit === 'rifle' ? 80 : c.id === 'gen_calibrate' ? 70 : 40)
    let wins = 0
    for (let seed = 1; seed <= 10; seed++) if (runWith({ seed, pick: (w, cards) => cards.reduce((b, c, k) => (score(c) > score(cards[b]) ? k : b), 0) }).outcome === 'won') wins++
    const share = good.rows.reduce((a, r) => a + (r.dmgByModule.rifle_frag || 0) / r.dmgTotal, 0) / 10
    check('⑥ 「碎甲弹头」不是必拿牌：不拿它 ≥ 9/10，拿了占全队伤害 < 30%', wins >= 9 && share < 0.3, `不拿 ${wins}/10  默认打法占比 ${f1(share * 100)}%`)
  }
}

// ---- 测试回归（其余的在 test-powers / test-endless / test-units 里）----
{
  // #3 开局事件（起步突击兵、指挥官本人、伙伴）留在 world.events 里，第一步不清空：表现层第一次 consume 收得到
  const w = createWorld({ seed: 1, commander: 'hawk', companion: true })
  const at0 = w.events.map(e => e.type + ':' + (e.source || e.kind || ''))
  w.step(null)
  const kept = w.events.filter(e => e.type === 'unitJoin' && e.source === 'start').length, comp = w.events.some(e => e.type === 'companion' && e.kind === 'join')
  w.step(null)
  check('回归 #3：开局事件留到第一步之后才清（unitJoin:start ×2、companion:join）；mission.label 开局就有', at0.filter(x => x === 'unitJoin:start').length === 2 && at0.includes('companion:join') && kept === 2 && comp && w.events.every(e => e.type !== 'unitJoin' && e.type !== 'companion') && createWorld({ seed: 1 }).mission.label === PHASES[0].name, at0.join(' '))
  // #20 「战地教范」在战役里换不来一次额外升级，只会挤掉有用的牌：只在无尽里出
  let offered = 0
  for (let seed = 1; seed <= 5; seed++) {
    const world = createWorld({ seed }), play = createBot('good', seed)
    let steps = 0
    while (world.status !== 'won' && world.status !== 'lost' && steps++ < 60 * 220) {     // 步数上限跟着局长放宽（原 120 秒）
      if (world.status === 'levelup' && world.levelup.cards.some(c => c.id === 'gen_doctrine')) offered++
      world.step(play(world))
    }
  }
  check('回归 #20：「战地教范」战役里不出（只在无尽里出）', MODULES.gen_doctrine.endlessOnly === true && offered === 0)
}

// ---- 文案 ----
{
  const zk = Object.keys(zh), ek = new Set(Object.keys(en))
  const missEn = zk.filter(k => !ek.has(k)), missZh = [...ek].filter(k => !(k in zh))
  check('文案 中英 key 一致', missEn.length === 0 && missZh.length === 0, `${zk.length} 条` + (missEn.length || missZh.length ? `  缺 en: ${missEn.slice(0, 5)}  缺 zh: ${missZh.slice(0, 5)}` : ''))
  const need = []
  for (const u of Object.values(UNITS)) { need.push(u.nameKey, u.descKey); for (const t of u.tags) need.push(`tag.${t}`) }
  for (const e of Object.values(ENEMIES)) need.push(e.nameKey)
  for (const b of Object.values(BOSSES)) need.push(b.nameKey)
  for (const m of Object.values(MODULES)) need.push(m.nameKey, m.descKey)
  for (const c of Object.values(COMBOS)) need.push(c.nameKey, c.descKey)
  for (const h of Object.values(HEROICS)) need.push(h.nameKey, h.descKey)
  for (const w of WAVES) if (w.herald) need.push(w.herald)
  for (const p of PHASES) need.push(p.name)
  need.push('gate.unit', 'gate.unit_escort', 'gate.reinforce', 'gate.module', 'gate.durability', 'comms.boss', 'comms.first_levelup', 'comms.first_combo', 'lose.wiped', 'lose.line', 'lose.timeout')
  const miss = need.filter(k => !(k in zh))
  check('文案 数据引用的 key 都存在', miss.length === 0, miss.slice(0, 8).join(', '))
  for (const lang of ['zh', 'en']) {
    const i18n = createI18n(lang)
    const a = i18n.t('gate.unit', { count: 8, unitKey: 'unit.rifle.name' }), b = i18n.t('gate.unit_escort', { count: 1, unitKey: 'unit.titan.name', extraCount: 4, extraKey: 'unit.rifle.name' })
    const c = i18n.t('gate.reinforce', { count: 10, unitKey: 'unit.rifle.name' })
    check(`i18n（${lang}）：门标题二次查表，渲染后不残留占位符；查不到的 key 回退成 key 本身`, ![a, b, c].some(x => /[{}]/.test(x) || x.includes('unit.')) && a.includes('8') && b.includes('4') && i18n.t('no.such.key') === 'no.such.key' && i18n.has('gate.unit') && !i18n.has('no.such.key'), `${a}  |  ${b}  |  ${c}`)
  }
  const noDot = zk.filter(k => /\.desc$|^comms\.(?!speaker)|^lose\.|^result\./.test(k) && !zh[k].endsWith('.'))
  check('文案 中文句末用英文句点', noDot.length === 0, noDot.slice(0, 5).join(', '))
}

// ---- 模拟层禁用 API ----
{
  const banned = /\bMath\.random\b|\bDate\b|\bperformance\b|\bwindow\b|\bdocument\b|from ['"]three/
  const hits = []
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (p.endsWith('.js')) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, n) => {
          const code = line.replace(/\/\/.*$/, '')
          if (banned.test(code)) hits.push(`${path.relative(root, p)}:${n + 1}`)
        })
      }
    }
  }
  for (const d of ['src/core', 'src/data', 'src/sim']) walk(path.join(root, d))
  check('模拟层没有引用 DOM / three / 时钟 / Math.random', hits.length === 0, hits.join(', '))
}

// ---- 发布物检查（手机加载优化）：modulepreload 清单、轻量素材、字体子集 ----
{
  const { preloadUpToDate } = await import('./gen-modulepreload.mjs')
  check('index.html 的 modulepreload 清单是最新的（不是就跑 node tools/gen-modulepreload.mjs）', preloadUpToDate())
  const { LITE_FILES } = await import('../src/render/lite-manifest.js')
  const miss = [...LITE_FILES].filter(f => !fs.existsSync(path.join(root, 'assets/lite', f)))
  check('轻量素材清单里的文件都在 assets/lite/（python tools/make-lite-assets.py）', LITE_FILES.size > 0 && miss.length === 0, miss.slice(0, 5).join(', '))
  const ui = new Set(fs.readFileSync(path.join(root, 'assets/ui/fonts/charset-ui.txt'), 'utf8'))
  const lost = new Set()
  for (const tab of [zh, en]) for (const v of Object.values(tab)) for (const ch of String(v)) if (ch.codePointAt(0) > 0x7f && !/\s/.test(ch) && !ui.has(ch)) lost.add(ch)
  check('文案用到的字都在 -ui 字体子集里（不是就跑 python tools/subset-fonts.py）', lost.size === 0, [...lost].slice(0, 20).join(''))
}

console.log(failed === 0 ? '\n全部通过.' : `\n${failed} 项未通过.`)
process.exitCode = failed === 0 ? 0 : 1
