// 节奏报告（第 1 轮测试加的）：每个种子一行，看「滚雪球」和「危险感」。
//   node tools/pace.mjs --bot good|idle|builder|… [--from 1 --to 10] [--difficulty veteran] [--commander hawk] [--boss matriarch] [--gates]
// 列：用时 / 40 秒兵力 / 门间隔（前 5 道 · 全部平均）/ 升级次数与时刻 / Boss 出场、战斗时长、机制次数、阶段 / 损失 / 防线最低 % / 结果
//   --gates：再把每道门左右两项与估值打出来（门的公平）  --src：阵亡 / 承伤按来源拆开
//   --curve：渐进曲线（各种子平均）：每 10 秒的累计击杀 / 在场虫数 / 兵力 / 等级、各虫种首次出现时刻、首次升级、门在场时长
import { runHeadless } from '../src/sim/bot.js'
import { optionValue } from '../src/sim/gates.js'
import { ENEMY_KINDS } from '../src/data/enemies.js'
import { GATE } from '../src/data/gates.js'

const a = { bot: 'good', from: 1, to: 10, difficulty: 'normal', commander: 'none', boss: undefined, draft: 'script' }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--gates') a.gates = true
  else if (argv[i] === '--curve') a.curve = true
  else if (argv[i] === '--src') a.src = true
  else a[argv[i].slice(2)] = argv[++i]
}
const f1 = v => Math.round(v * 10) / 10
const MECH = new Set(['charge_windup', 'sweep', 'acid', 'lay', 'emerge', 'spines_windup', 'enrage', 'summon', 'harden', 'slam', 'brood', 'frenzy'])
// --curve：渐进曲线（各种子平均）——每 10 秒的累计击杀 / 在场虫数 / 兵力 / 等级，各虫种首次出现时刻，门在场时长
const CURVE_T = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
const cur = { n: 0, at: Object.fromEntries(CURVE_T.map(t => [t, { n: 0, kills: 0, enemies: 0, troops: 0, level: 0 }])), first: {}, lv1: 0, gateLive: [], overlap: 0 }
const agg = { n: 0, wins: 0, t: 0, t40: 0, k40: 0, r40: 0, gap5: 0, gapAll: 0, lv: 0, fight: 0, mech: 0, loss: 0, lineMin: 0, bossLoss: 0, fightMin: Infinity, fightMax: 0 }
for (let seed = Number(a.from); seed <= Number(a.to); seed++) {
  const gates = [], lvT = [], mech = {}, phases = []
  let bossT = null, dieT = null, lineMin = 1, lossAtBoss = 0, gateLog = []
  const first = {}, gSpawn = {}
  const run = runHeadless({ seed, bot: a.bot, difficulty: a.difficulty, commander: a.commander, boss: a.boss, draft: a.draft, onStep: w => {
    if (a.curve && w.phase === 'campaign') {
      const kc = w.swarm.kindCount
      for (let k = 0; k < ENEMY_KINDS.length; k++) if (kc[k] > 0 && first[ENEMY_KINDS[k]] === undefined) first[ENEMY_KINDS[k]] = w.time
    }
    for (const e of w.events) {
      if (a.curve && w.phase === 'campaign' && e.type === 'gateSpawn') gSpawn[e.index] = w.time
      if (a.curve && w.phase === 'campaign' && e.type === 'gateResolve' && gSpawn[e.index] !== undefined) {
        cur.gateLive.push(w.time - gSpawn[e.index])
        // 下一道门的计划时刻早于这道门结算 = 两组门会抢同一段路（导演只在 world.gates === null 时出门，会被推迟）
        const nx = GATE.times[e.index + 1]
        if (nx !== undefined && nx < w.time - 1e-6) cur.overlap++
      }
      if (e.type === 'gateSpawn' && w.phase === 'campaign') {
        gates.push(w.time)
        if (a.gates) gateLog.push(`    门${e.index} ${f1(w.time)}s  ${desc(e.left)}（${f1(optionValue(w, e.left))}）  |  ${desc(e.right)}（${f1(optionValue(w, e.right))}）`)
      } else if (e.type === 'levelUp' && w.phase === 'campaign') lvT.push(Math.round(w.time))
      else if (e.type === 'bossSpawn' && bossT === null) { bossT = w.time; lossAtBoss = w.stats.losses }
      else if (e.type === 'bossDie' && dieT === null) dieT = w.time
      else if ((e.type === 'bossAttack' || e.type === 'bossStun' || e.type === 'bossPhase') && dieT === null) {
        const k = e.type === 'bossStun' ? 'stun' : e.type === 'bossPhase' ? 'phase' + e.phase : e.kind
        mech[k] = (mech[k] || 0) + 1
        if (e.type === 'bossPhase') phases.push(`${e.phase}@${f1(w.time - bossT)}s`)
      }
    }
    if (w.phase === 'campaign') { const l = w.line.hp / w.line.hpMax; if (l < lineMin) lineMin = l }
  } })
  const r = run.result
  if (a.curve) {
    cur.n++; cur.lv1 += lvT.length ? lvT[0] : 0
    for (const t of CURVE_T) {
      const s = r.timeline.find(x => x.t === t)
      if (s && t <= r.seconds) { const c = cur.at[t]; c.n++; c.kills += s.kills; c.enemies += s.enemies; c.troops += s.troops; c.level += s.level }
    }
    for (const k in first) (cur.first[k] = cur.first[k] || []).push(first[k])
  }
  const at =t => r.timeline.find(s => s.t === t)
  const gaps = gates.slice(1).map((t, i) => t - gates[i])
  const gap5 = gaps.slice(0, 5).reduce((x, y) => x + y, 0) / Math.max(1, Math.min(5, gaps.length))
  const gapAll = gaps.reduce((x, y) => x + y, 0) / Math.max(1, gaps.length)
  const fight = bossT !== null && dieT !== null ? dieT - bossT : null
  const mechN = Object.entries(mech).filter(([k]) => MECH.has(k)).reduce((x, [, n]) => x + n, 0)
  const won = r.outcome === 'won'
  agg.n++; if (won) agg.wins++
  agg.t += r.seconds; agg.t40 += at(40) ? at(40).troops : 0; agg.k40 += at(40) ? at(40).kills : 0; agg.r40 += rate40(r); agg.gap5 += gap5; agg.gapAll += gapAll; agg.lv += lvT.length
  agg.fight += fight || 0; if (fight !== null) { agg.fightMin = Math.min(agg.fightMin, fight); agg.fightMax = Math.max(agg.fightMax, fight) } agg.mech += mechN; agg.loss += r.losses; agg.lineMin += lineMin; agg.bossLoss += r.losses - lossAtBoss
  console.log(`seed ${String(seed).padStart(2)} ${r.outcome.padEnd(4)}${r.reason ? '(' + r.reason + ')' : ''} ${String(r.seconds).padStart(6)}s  40s兵力 ${at(40) ? at(40).troops : '-'} 歼敌 ${at(40) ? at(40).kills : '-'} 速度 ${rate40(r)}/s  门间隔 前5 ${f1(gap5)}s / 全 ${f1(gapAll)}s（${gates.length} 道）  升级 ${lvT.length} 次 [${lvT.join(' ')}]  Boss ${bossT === null ? '-' : f1(bossT) + 's'} 战 ${fight === null ? '-' : f1(fight) + 's'} 机制 ${mechN}（${Object.entries(mech).map(([k, n]) => k + '×' + n).join(' ')}）${phases.length ? ' 阶段 ' + phases.join(' ') : ''}  损失 ${r.losses}（Boss 战 ${r.losses - lossAtBoss}）  防线最低 ${Math.round(lineMin * 100)}%  击杀 ${r.kills}  Lv${r.level}  连杀 ${r.maxCombo}`)
  if (a.src) console.log(`    阵亡来源 ${fmt(r.lostTo)}\n    承伤来源 ${fmt(r.hurtBy)}`)
  if (a.gates) console.log(gateLog.join('\n'))
}
// 40 秒前后 5 秒（35~45 秒）的平均歼敌速度：单秒的 3 秒窗太抖，参考游戏的 356/秒 也是一段时间的平均
function rate40(r) { const a = r.timeline.find(s => s.t === 35), b = r.timeline.find(s => s.t === 45); return a && b ? Math.round((b.kills - a.kills) / 10) : 0 }
function fmt(o) { return Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + Math.round(v)).join('  ') }
function desc(o) {
  if (o.type === 'unit') return `+${o.count} ${o.unit}${o.extra ? ' +' + o.extra.count + ' ' + o.extra.unit : ''}`
  if (o.type === 'heal') return `补员 +${o.count} 回血`
  if (o.type === 'contract') return `合同 ${o.params.contract}`
  if (o.type === 'device') return `装置 ${o.params.device}`
  if (o.type === 'module') return `模块 ${o.params.moduleId}`
  if (o.type === 'stat') return o.params.boon ? `属性 ${o.params.boon}` : `耐久 +${o.params.amount}`
  return o.type
}
const n = agg.n
console.log(`${a.bot}/${a.difficulty}${a.commander !== 'none' ? '/' + a.commander : ''}${a.boss ? '/' + a.boss : ''}: ${agg.wins}/${n} 胜  平均用时 ${f1(agg.t / n)}s  40s 兵力 ${f1(agg.t40 / n)} 歼敌 ${Math.round(agg.k40 / n)} 速度 ${Math.round(agg.r40 / n)}/s  门间隔 前5 ${f1(agg.gap5 / n)}s / 全 ${f1(agg.gapAll / n)}s  升级 ${f1(agg.lv / n)} 次  Boss 战 ${f1(agg.fight / n)}s（${f1(agg.fightMin)}~${f1(agg.fightMax)}）机制 ${f1(agg.mech / n)} 次  损失 ${f1(agg.loss / n)}（Boss 战 ${f1(agg.bossLoss / n)}）  防线最低 ${Math.round(agg.lineMin / n * 100)}%`)
if (a.curve) {
  console.log(`渐进曲线（${cur.n} 局平均；某时刻已结束的局不计入）  t / 累计击杀 / 在场虫数 / 兵力 / 等级 / 计入局数`)
  for (const t of CURVE_T) {
    const c = cur.at[t]
    if (c.n) console.log(`  ${String(t).padStart(3)}s  ${String(Math.round(c.kills / c.n)).padStart(6)}  ${String(Math.round(c.enemies / c.n)).padStart(5)}  ${String(f1(c.troops / c.n)).padStart(5)}  Lv${f1(c.level / c.n)}  (${c.n})`)
  }
  const fs = Object.entries(cur.first).map(([k, v]) => [k, v.reduce((x, y) => x + y, 0) / v.length, v.length]).sort((x, y) => x[1] - y[1])
  console.log('各虫种首次出现  ' + fs.map(([k, t, m]) => `${k} ${f1(t)}s${m < cur.n ? `(${m}/${cur.n})` : ''}`).join('  '))
  const gl = cur.gateLive
  console.log(`首次升级平均 ${f1(cur.lv1 / cur.n)}s   门在场时长 ${f1(Math.min(...gl))}~${f1(Math.max(...gl))}s   门被推迟（下一道的计划时刻早于上一道结算） ${cur.overlap} 次`)
}
