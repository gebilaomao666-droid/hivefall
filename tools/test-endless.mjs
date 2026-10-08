// 第 4 步测试：无尽模式 / 结算 / 军衔 / 伙伴无人机 / 成就 / 存档。node tools/test-endless.mjs
//   ① 层成长系数  ② good bot seed 1..5 至少活到第 8 层，第 3/6/9 层 Boss 是三种  ③ 确定性
//   ④ 续打 / 撤离的输入契约  ⑤ 门、属性门、悬赏门、先遣队、四选一  ⑥ 军衔  ⑦ 伙伴  ⑧ 结算  ⑨ 成就  ⑩ 存档
//   ⑪ 无尽 12 层的单步耗时 < 4ms  ⑫ 无尽平衡  ⑬ 兵力保底（第 2 轮修复）
import { createWorld } from '../src/sim/world.js'
import { runHeadless, createBot } from '../src/sim/bot.js'
import { addUnits, damageUnit, capRoom } from '../src/sim/squad.js'
import { spawnBoss, damageBoss } from '../src/sim/boss.js'
import { hitEnemy } from '../src/sim/combat.js'
import { spawn, KIND_INDEX } from '../src/sim/swarm.js'
import { enterEndless } from '../src/sim/endless.js'
import { spawnEndlessGate, applyBoon } from '../src/sim/gates.js'
import { findBadEvent } from '../src/core/events.js'
import { ENDLESS, layerScale, layerLenAt, capsAt, mixAt, themeAt, bossAt, bossHpMulAt, waveAt, MIXES, MIX_ORDER, THEMES, BOONS, BOONS_COST, BOONS_FREE, BOONS_BOUNTY, VANGUARD } from '../src/data/endless.js'
import { ENEMIES, LIVE_CAP } from '../src/data/enemies.js'
import { BOSSES } from '../src/data/bosses.js'
import { UNITS, HEAVY_KINDS } from '../src/data/units.js'
import { RANKS, rankIndex, rankFor } from '../src/data/ranks.js'
import { COMPANION, growthCost } from '../src/data/companion.js'
import { ACHIEVEMENTS, achievementsFor, LONG_CHAIN } from '../src/data/achievements.js'
import { UNLOCKS, UNLOCK_IDS } from '../src/data/unlocks.js'
import { CAMPAIGN_LEN } from '../src/data/waves.js'
import { defaultSave, mergeSave, loadSave, storeSave, applyResult, rankBoard, compareEntries, boardEntry, cleanName, buyCompanionGrowth, companionNextCost, companionConfig, SAVE_KEY, BOARD_SIZE } from '../src/core/save.js'
import zh from '../src/data/strings.zh.js'
import en from '../src/data/strings.en.js'

const clock = () => Number(process.hrtime.bigint()) / 1e6
let failed = 0, badEvent = null
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))
const r3 = v => Math.round(v * 1000) / 1000
const scan = world => { if (!badEvent) for (const e of world.events) { const bad = findBadEvent(e); if (bad) { badEvent = { field: bad, event: e }; break } } }
const NOOP = { moveX: null, targetX: null, powers: [], aim: null, pick: null, reroll: false, continueEndless: false, retreat: false }

// 直接造一个已经进了无尽的世界（不打战役）
function endlessWorld(seed = 1, extra = {}) {
  const world = createWorld({ seed, ...extra })
  addUnits(world, 'rifle', 30, 'test')
  enterEndless(world)
  return world
}

// ---------------------------------------------------------------- ① 层成长系数
{
  const s1 = layerScale(1)
  // 期望变更（第 2 轮测试）：第 1 层敌血 1 → 1.8、敌伤 1 → 2（其余仍为 1 / 0）。理由：测试「无尽 1~4 层新增损失 0，满编平推」——
  // 起点抬高、坡度放缓（见下一条），前几层每层都要掉人，同时每层开头补 5 人（ENDLESS.relief）
  check('① 第 1 层：敌血 ×1.8、敌伤 ×2，其余系数为 1 / 0', near(s1.hp, 1.8) && s1.count === 1 && near(s1.dmg, 2) && s1.armor === 0 && s1.power === 1 && s1.elite === 0)
  // 敌血前陡后缓（data/endless.js）：原先一路 ×1.12 是「前 13 层零损失、然后两层团灭」的悬崖
  // 期望变更（第 2 轮）：1..9 层 ×1.25 → 起点 1.8、每层 ×1.1（第 9 层 3.86，原 5.96）。理由同上：前段不再是零损失，后段也就不需要那么陡
  const L = ENDLESS.hpLateFrom
  let ok = ENDLESS.hpStart === 1.8 && ENDLESS.hpMul === 1.1 && L === 9 && ENDLESS.hpMulLate === 1.05
  for (let n = 1; n <= L; n++) ok = ok && near(layerScale(n).hp, 1.8 * Math.pow(1.1, n - 1))
  check('① 敌血前段：第 1 层 ×1.8，1..9 层每层 ×1.1', ok && near(layerScale(9).hp / layerScale(8).hp, 1.1), `第 2 层 ${r3(layerScale(2).hp)}  第 5 层 ${r3(layerScale(5).hp)}  第 8 层 ${r3(layerScale(8).hp)}  第 9 层 ${r3(layerScale(9).hp)}`)
  ok = true
  for (let n = L + 1; n <= 30; n++) ok = ok && near(layerScale(n).hp, 1.8 * Math.pow(1.1, L - 1) * Math.pow(1.05, n - L))
  check('① 敌血后缓：第 9 层之后每层 ×1.05', ok && near(layerScale(10).hp / layerScale(9).hp, 1.05), `第 10 层 ${r3(layerScale(10).hp)}  第 16 层 ${r3(layerScale(16).hp)}  第 20 层 ${r3(layerScale(20).hp)}`)
  ok = true
  // 期望变更（第 2 轮）：敌伤 1 起 ×1.08 → 2 起 ×1.03（第 10 层 2.61，原 2.0）。理由同上
  for (let n = 1; n <= 30; n++) { const s = layerScale(n); ok = ok && near(s.count, Math.pow(1.06, n - 1)) && near(s.dmg, 2 * Math.pow(1.03, n - 1)) && near(s.armor, 0.1 * (n - 1)) && near(s.power, Math.pow(1.1, n - 1)) }
  check('① 数量 ×1.06、伤害 2 起 ×1.03、护甲 +0.1、技能伤害 ×1.1 / 层', ok, `第 10 层：数量 ${r3(layerScale(10).count)} 伤害 ${r3(layerScale(10).dmg)} 护甲 +${r3(layerScale(10).armor)} 技能 ${r3(layerScale(10).power)}`)
  const el = [1, 3, 4, 5, 10, 16, 17, 40].map(n => layerScale(n).elite)
  check('① 精英 4 层起每层 +2%，封顶 25%', el[0] === 0 && el[1] === 0 && near(el[2], 0.02) && near(el[3], 0.04) && near(el[4], 0.14) && near(el[5], 0.25) && el[6] === 0.25 && el[7] === 0.25, el.map(r3).join(' / '))
  check('① 层时长：10 层内 30 秒，之后 ×0.92，最短 18 秒', layerLenAt(1) === 30 && layerLenAt(10) === 30 && near(layerLenAt(11), 27.6) && near(layerLenAt(12), 30 * 0.92 * 0.92) && layerLenAt(17) === 18 && layerLenAt(40) === 18,
    `11 层 ${r3(layerLenAt(11))}s  12 层 ${r3(layerLenAt(12))}s  16 层 ${r3(layerLenAt(16))}s  17 层 ${layerLenAt(17)}s`)
  const c1 = capsAt(1), c3 = capsAt(3), c10 = capsAt(10), c19 = capsAt(19), c40 = capsAt(40)
  // 期望变更（第 2 轮修复）：重型编制每 3 层 +1、封顶 8 → 每 2 层 +1、封顶 9（10 层 6 → 8、40 层 8 → 9）。
  // 理由：测试「无尽越打越弱」，参考游戏第 8 层是 74 步兵 + 9 重装；偶数层的保底补员会空投一台重型，编制要放得下
  check('① 编制上限成长到 96 / 9 / 9', c1.infantry === 64 && c1.artillery === 6 && c1.heavy === 3 && c3.infantry === 64 && c3.heavy === 4 && c10.infantry === 78 && c10.artillery === 9 && c10.heavy === 8 && c19.infantry === 96 && c40.infantry === 96 && c40.artillery === 9 && c40.heavy === 9,
    `1 层 ${c1.infantry}/${c1.artillery}/${c1.heavy}  10 层 ${c10.infantry}/${c10.artillery}/${c10.heavy}  19 层 ${c19.infantry}/${c19.artillery}/${c19.heavy}`)
  check('① 配比 6 种按层轮换', MIX_ORDER.length === 6 && [1, 2, 3, 4, 5, 6, 7].map(mixAt).join() === 'swarm,armored,den,tide,air,burrow,swarm')
  check('① 主题每 5 层切换', [1, 5, 6, 10, 11, 15, 16].map(themeAt).join() === 'ash,ash,night,night,hive,hive,ash' && THEMES.length === 3)
  check('① Boss 每 3 层一只，三种轮换，血量 ×1.3^n', bossAt(1) === null && bossAt(3) === 'matriarch' && bossAt(6) === 'leviathan' && bossAt(9) === 'ravager' && bossAt(12) === 'matriarch' && near(bossHpMulAt(3), 1.3) && near(bossHpMulAt(9), 1.3 ** 3))
  const w1 = waveAt(1, 0), w2 = waveAt(2, 0), w5 = waveAt(5, 2)
  // 甲壳阵的裂爪虫 ×0.5（原先 ×0.3：重甲层的击杀只有别的层三分之一，经验断档）；第 2 轮修复再到 ×0.85
  // 期望变更（第 2 轮）：每波甲壳兽 8 → 14、甲壳阵的甲壳兽倍率 2.6 → 1.4（14 × 1.4 ≈ 原来的 8 × 2.6）。理由：甲壳兽改成边走边打后是主要的掉人来源，
  // 原配比下只有甲壳阵那几层掉人（第 8 层一层掉 18 个），别的层零损失；现在每种配比都带一队
  // 期望变更（第 2 轮修复）：甲壳阵裂爪虫 ×0.5 → ×0.85。理由：测试实机第 2 层甲壳阵场上只剩两百来只、歼敌 28/秒，画面空；
  // 甲壳阵的「重」由甲壳兽 / 巨畸体 / 护巢虫的倍率体现（不变）
  // 期望变更（修复第 1 轮）：裂爪虫数量再 × ENDLESS.density（2.2）、单只血量 ÷ 2.2（总血量不变）。理由：测试测试无尽每层同屏只有 440~640 只、第 2 层偏空，
  // 要求同屏 900~1400 只；⑫ 的平衡区间不变（标准小队仍 11~16 层倒下）
  check('① 波次构成：纯量 1520 × 密度 起；甲壳阵数量 ×0.85、甲壳兽 14 × 1.4；翼螫潮翼螫 ×3', MIXES.armored.ling === 0.85 && ENDLESS.density === 2.2 && w1.ling === Math.round(1520 * 2.2) && w2.ling === Math.round(1520 * 0.85 * 1.06 * 2.2) && w2.crusher === Math.round(14 * 1.4 * 1.06) && w5.wing === Math.round(8 * 3 * 1.06 ** 4),
    `1 层首波 裂爪虫 ${w1.ling}  2 层首波 裂爪虫 ${w2.ling} 甲壳兽 ${w2.crusher} 巨畸体 ${w2.hulk}  5 层预告波 裂爪虫 ${w5.ling} 翼螫 ${w5.wing}`)
}

// ---------------------------------------------------------------- ② good bot 深入无尽
const deep = []       // 留着给后面的断言用
{
  const rows = []
  let ok8 = 0, bossOk = 0, scaleOk = true, gateOk = true, mutOk = true, themeOk = true, mixOk = true, compOk = true, hpOk = true, bountyOk = true
  for (let seed = 1; seed <= 5; seed++) {
    const bosses = {}, gates = {}, layers = []
    let bountyDue = false, bountySeen = 0, bountyMissed = 0
    const run = runHeadless({
      seed, bot: 'good', endless: 9, checkEvents: true,
      onStep: world => {
        const e = world.endless
        for (const ev of world.events) {
          if (ev.type === 'layer') {
            layers.push(ev)
            const sc = layerScale(ev.n), caps = capsAt(ev.n)
            if (!near(world.diff.hpMul, sc.hp) || !near(world.diff.dmgMul, sc.dmg) || !near(world.diff.armorAdd, sc.armor) || !near(world.eliteChance, sc.elite) || !near(world.powerDmgMul, sc.power)) scaleOk = false
            if (world.squad.caps.infantry !== caps.infantry || world.squad.caps.artillery !== caps.artillery || world.squad.caps.heavy !== caps.heavy) scaleOk = false
            if (ev.theme !== themeAt(ev.n) || e.theme !== ev.theme) themeOk = false
            if (ev.mix !== mixAt(ev.n)) mixOk = false
            const want = ev.n >= 8 ? 3 : ev.n >= 5 ? 2 : ev.n >= 2 ? 1 : 0
            if (world.mutators.length !== want || world.mutators.some(m => !m.active)) mutOk = false
            if ((ev.n >= 5) !== (world.companion !== null)) compOk = false
          } else if (ev.type === 'bossSpawn' && e) {
            bosses[e.layer] = ev.kind
            // 期望变更：基数 BOSSES[kind].hp → endlessHp。理由：战役 Boss 的血量随时间轴拉伸重调了（29000 / 12500 / 17500），
            // 无尽沿用原来的基数（10500 / 7500 / 10000），单列成 endlessHp
            if (!near(ev.hp, BOSSES[ev.kind].endlessHp * bossHpMulAt(e.layer))) hpOk = false
          } else if (ev.type === 'gateSpawn' && e) {
            gates[e.layer] = (gates[e.layer] || 0) + 1
            if (bountyDue) { if (ev.kind === 'bounty') bountySeen++; else bountyMissed++; bountyDue = false }
            else if (ev.kind === 'bounty') bountyMissed++
          } else if (ev.type === 'ally' && ev.kind === 'bounty') bountyDue = true
        }
      },
    })
    const r = run.result
    if (run.badEvent && !badEvent) badEvent = run.badEvent
    if (r.layer >= 8) ok8++
    if (bosses[3] && bosses[6] && bosses[9] && new Set([bosses[3], bosses[6], bosses[9]]).size === 3) bossOk++
    for (let n = 1; n <= Math.min(8, r.layer); n++) if (gates[n] !== 1) gateOk = false
    if (bountySeen < 2 || bountyMissed > 0) bountyOk = false
    deep.push({ seed, run, r, bosses })
    rows.push(`   seed ${seed}  ${r.outcome}  第 ${r.layer} 层  ${r.seconds}s  击杀 ${r.kills}  损失 ${r.losses}  漏网 ${r.leaked}  Lv${r.level}  Boss ${r.bossKills}（3/6/9 层: ${bosses[3]} / ${bosses[6]} / ${bosses[9]}）  悬赏门 ${bountySeen}`)
  }
  console.log(rows.join('\n'))
  check('② good bot seed 1..5 至少活到第 8 层', ok8 === 5, `${ok8}/5`)
  check('② 第 3 / 6 / 9 层的 Boss 是三种不同的', bossOk === 5, `${bossOk}/5  ${deep[0].bosses[3]} → ${deep[0].bosses[6]} → ${deep[0].bosses[9]}`)
  check('② 每层开始时 world 上的成长系数 = layerScale(n)，编制上限 = capsAt(n)', scaleOk)
  check('② Boss 血量 = 基础 × 1.3^(层/3)，不吃每层的敌血系数', hpOk)
  check('② 每层恰好一道门', gateOk)
  check('② Boss 倒下后的下一道门是悬赏门（且只有那一道是）', bountyOk)
  check('② 第 2 / 5 / 8 层各追加一个突变并立即生效', mutOk, `seed 1 终局: ${deep[0].r.mutators.join(', ')}`)
  check('② 主题每 5 层切换（layer 事件带 theme），配比按层轮换', themeOk && mixOk)
  check('② 第 5 层捡到伙伴无人机', compOk && deep.every(d => d.r.companion && d.r.companion.found))
  const r = deep[0].r
  check('② 无尽里 score = 击杀，layer / seconds / 每层摘要齐全', r.score === r.kills && r.layer === 9 && r.layers.length === 9 && r.seconds > 300 && r.mode === 'endless' && r.outcome === 'retreated' && r.campaignWon === true,
    `${r.kills} 击杀  ${r.seconds}s  每层击杀 ${r.layers.map(l => l.kills).join(' / ')}`)
}

// ---------------------------------------------------------------- ③ 确定性
{
  const a = JSON.stringify(runHeadless({ seed: 4, bot: 'good', endless: 6 }).result)
  const b = JSON.stringify(runHeadless({ seed: 4, bot: 'good', endless: 6 }).result)
  const c = JSON.stringify(runHeadless({ seed: 5, bot: 'good', endless: 6 }).result)
  check('③ 确定性：同 seed 无尽 6 层两次结果完全相同', a === b, `result JSON ${a.length} 字节`)
  check('③ 不同 seed 结果不同', a !== c)
  const d = JSON.stringify(runHeadless({ seed: 2, bot: 'good', commander: 'ysera', endless: 4, companion: { growth: 4 } }).result)
  const e = JSON.stringify(runHeadless({ seed: 2, bot: 'good', commander: 'ysera', endless: 4, companion: { growth: 4 } }).result)
  check('③ 确定性：带指挥官 + 伙伴', d === e)
}

// ---------------------------------------------------------------- ④ 续打 / 撤离
{
  const world = createWorld({ seed: 7 })
  const play = createBot('good', 7)
  let ignored = true
  while (world.status !== 'won' && world.status !== 'lost') {
    const input = play(world)
    input.continueEndless = true; input.retreat = true       // 战役进行中这两个输入都不该起作用
    world.step(input); scan(world)
    if (world.phase !== 'campaign' || world.status === 'retreated') ignored = false
  }
  check('④ 战役进行中 continueEndless / retreat 无效', ignored && world.status === 'won', `${world.status} @ ${world.time.toFixed(1)}s`)
  const t0 = world.time, troops = world.squad.units.filter(u => u.alive).length, level = world.progress.level, kills = world.stats.kills, cards = world.progress.picks.length
  for (let n = 0; n < 30; n++) world.step(NOOP)
  check('④ 胜利后不按继续：世界定格', world.time === t0 && world.status === 'won' && world.result().layer === 0 && world.result().mode === 'campaign')
  world.step({ ...NOOP, continueEndless: true })
  const ev = world.events.map(e => e.type)
  const e = world.endless
  check('④ continueEndless：原地续打，部队 / 等级 / 卡牌 / 击杀都带着', world.phase === 'endless' && world.status === 'running' && world.time === t0 && world.progress.level === level && world.stats.kills === kills && world.progress.picks.length === cards && world.squad.units.filter(u => u.alive).length === troops + ENDLESS.gift.count && world.boss === null,
    `兵力 ${troops} → ${troops + ENDLESS.gift.count}  Lv${level}  ${cards} 张卡`)
  check('④ 进入无尽发 phase / layer{n:1, theme} / unitJoin / heal', ev.includes('phase') && ev.includes('layer') && ev.includes('unitJoin') && ev.includes('heal') && e.layer === 1 && e.theme === 'ash' && near(e.layerLen, 34),
    `layerLen ${e.layerLen}（首层多 ${ENDLESS.firstDelay} 秒）`)
  scan(world)
  let timeOk = true
  for (let n = 0; n < 600; n++) { const input = play(world); input.retreat = false; input.continueEndless = false; world.step(input); scan(world); if (world.status === 'running' && !near(world.mission.timeLeft, e.layerLen - e.layerT, 1e-6)) timeOk = false }
  // 期望变更：再跑 600 步 → 跑到越过 CAMPAIGN_LEN 为止；文案里的 95 秒改成 CAMPAIGN_LEN。理由：战役约 160 秒打完，判负时刻是 180 秒，
  // 原来「进无尽后 10 秒」已经越过了 95 秒，现在要再多跑一会儿才越过 180 秒
  for (let n = 0; n < 60 * 40 && world.time <= CAMPAIGN_LEN + 1; n++) { const input = play(world); input.retreat = false; input.continueEndless = false; world.step(input); scan(world); if (world.status === 'running' && !near(world.mission.timeLeft, e.layerLen - e.layerT, 1e-6)) timeOk = false }
  check(`④ 无尽里 mission.timeLeft = 本层剩余秒数，超过 ${CAMPAIGN_LEN} 秒不判超时`, timeOk && world.time > CAMPAIGN_LEN && world.status !== 'lost', `t=${world.time.toFixed(1)}s  ${world.status}`)
  while (world.status === 'levelup') { const input = play(world); input.retreat = false; world.step(input) }
  world.step({ ...NOOP, retreat: true })
  const r = world.result()
  check('④ retreat：撤离结算，发 retreat 事件，成绩保留', world.status === 'retreated' && world.events.some(x => x.type === 'retreat') && r.outcome === 'retreated' && r.score === world.stats.kills && r.layer === 1 && r.headline.titleKey === 'result.retreated')
  const t1 = world.time
  world.step({ ...NOOP, continueEndless: true }); world.step(play(world))
  check('④ 撤离后世界定格', world.time === t1 && world.status === 'retreated')

  // 无尽里阵亡：照常判负，但成绩算数
  const w2 = endlessWorld(3)
  for (const u of w2.squad.units) damageUnit(w2, u, 9999)
  w2.step(NOOP)
  const r2 = w2.result()
  check('④ 无尽里全员阵亡：lost(wiped)，标题用「深入到此为止」', w2.status === 'lost' && r2.reason === 'wiped' && r2.layer === 1 && r2.headline.titleKey === 'result.endless_lost' && r2.headline.textKey === 'advice.wiped')
}

// ---------------------------------------------------------------- ⑤ 门 / 属性门 / 先遣队 / 四选一
const run10 = { cards: null, layer: 0, strikes: 0, joined: null, ally: [], rerolls: -1, heavyBefore: 0 }
{
  // 属性门逐个结算
  const base = () => { const w = endlessWorld(1); return w }
  let w = base()
  const hp0 = w.squad.units[0].hpMax, dmg0 = w.dmgMul, line0 = w.line.hpMax
  applyBoon(w, 'overload')
  check('⑤ 超载弹药：全军伤害 +12%，防线上限 -10%', near(w.dmgMul, dmg0 * 1.12) && near(w.modDmgMul, 1.12) && w.line.hpMax === Math.round(line0 * 0.9) && w.line.hp === w.line.hpMax, `dmgMul ${r3(dmg0)} → ${r3(w.dmgMul)}  防线上限 ${line0} → ${w.line.hpMax}`)
  applyBoon(w, 'march')
  check('⑤ 急行军：射速 +8%，全员最大生命 -1', near(w.rateMul, 1.08) && w.squad.units[0].hpMax === hp0 - 1 && w.squad.units[0].hp === hp0 - 1, `rateMul ${r3(w.rateMul)}  突击兵生命 ${hp0} → ${w.squad.units[0].hpMax}`)
  applyBoon(w, 'glass'); applyBoon(w, 'bunker')
  check('⑤ 卸甲 / 加固工事：加成累加，可正可负', near(w.buffs.dmg, 0.30) && near(w.buffs.rate, 0.04) && w.buffs.hp === -3 && w.line.hpMax === Math.round(line0 * 0.9) + 200, `buffs ${JSON.stringify(w.result().buffs)}  boons ${w.boons.join(',')}`)
  for (const u of w.squad.units) u.hp = 1
  w.line.hp = 100
  applyBoon(w, 'transfusion')
  check('⑤ 战地输血：最大生命 +3 并回满，防线 -120 但不会扣穿', w.squad.units.every(u => u.hp === u.hpMax) && w.squad.units[0].hpMax === hp0 && w.line.hp === 1)
  for (let k = 0; k < 8; k++) applyBoon(w, 'glass')
  check('⑤ 最大生命扣不到 0', w.squad.units.every(u => u.hpMax >= 1 && u.hp >= 1), `突击兵生命 ${w.squad.units[0].hpMax}`)
  w = base()
  // 摆 12 只打不死的巨畸体当靶子：一直有目标，开火次数只取决于射速
  const rifleShots = wd => {
    for (let k = 0; k < 12; k++) { const i = spawn(wd, KIND_INDEX.hulk, -5 + k * 0.9, 0); wd.swarm.hp[i] = wd.swarm.hpMax[i] = 1e9 }
    let shots = 0
    for (let n = 0; n < 600; n++) {
      for (const u of wd.squad.units) u._invuln = wd.time + 1      // 靶子会还手，别让人数变
      wd.step(NOOP)
      if (n >= 300) for (const e of wd.events) if (e.type === 'shot') shots++      // 跳过开局 4 秒的过载
    }
    return shots
  }
  const wa = createWorld({ seed: 5, sandbox: true }), wb = createWorld({ seed: 5, sandbox: true })
  addUnits(wa, 'rifle', 20, 'test'); addUnits(wb, 'rifle', 20, 'test')
  applyBoon(wb, 'march'); applyBoon(wb, 'march'); applyBoon(wb, 'march')
  const sa = rifleShots(wa), sb = rifleShots(wb)
  check('⑤ 射速加成真的作用在开火上', sb / sa > 1.21 && sb / sa < 1.27, `5 秒开火 ${sa} → ${sb}（×${r3(sb / sa)}，三次急行军应为 ×1.24）`)

  // 门的草稿：兵源一边 + 属性门 / 合同一边
  w = base()
  const tally = { unit: 0, heal: 0, module: 0, cost: 0, free: 0, contract: 0, device: 0, other: 0 }
  let shape = true, contractOnEven = true
  for (let idx = 10; idx < 410; idx++) {
    w.gates = null
    spawnEndlessGate(w, idx, false)
    const g = w.gates
    const opts = [g.left, g.right]
    // 期望变更：另一边多了一种可能——装置门（还有装置没解锁时，属性门有 ENDLESS.deviceGate 的概率换成它；全解锁后不再出）
    const boon = opts.find(o => o.type === 'stat' && o.params.boon), con = opts.find(o => o.type === 'contract'), dev = opts.find(o => o.type === 'device')
    const src = opts.find(o => o !== boon && o !== con && o !== dev)
    if (dev) tally.device++
    if (!src || (!boon && !con && !dev) || g.kind !== 'supply') shape = false
    if (con) { tally.contract++; if (idx % 2 !== 0) contractOnEven = false }
    if (boon) { if (BOONS[boon.params.boon].bounty) shape = false; BOONS[boon.params.boon].cost ? tally.cost++ : tally.free++ }
    if (src) tally[src.type in tally ? src.type : 'other']++
  }
  check('⑤ 无尽的门：一边兵源，另一边属性门 / 合同 / 装置门', shape && tally.other === 0 && tally.device > 0, JSON.stringify(tally))
  check('⑤ 属性门里有代价的约占六成，和无代价的混出', tally.cost / (tally.cost + tally.free) > 0.5 && tally.cost / (tally.cost + tally.free) < 0.7 && tally.free > 40, `有代价 ${tally.cost} / 无代价 ${tally.free}`)
  check('⑤ 合同每 2 道门出一次', contractOnEven && tally.contract === 200, `${tally.contract}/400`)
  w.gates = null
  spawnEndlessGate(w, 500, true)
  const bg = w.gates, bopts = [bg.left, bg.right]
  check('⑤ 悬赏门：一边合同或大补员，另一边悬赏增益', bg.kind === 'bounty' && bopts.some(o => o.type === 'stat' && BOONS_BOUNTY.includes(o.params.boon)) && bopts.some(o => o.type === 'contract' || o.type === 'heal'))
  // 兵源权重：步兵最多；阵亡过的重型更容易再刷出来
  const draftStats = lostHeavy => {
    const wd = endlessWorld(9)
    Object.assign(wd.squad.caps, capsAt(12))
    if (lostHeavy) wd.squad.fallen.push({ id: 999, kind: 'reaper', name: null, kills: 0, t: 1 })
    const c = { rifle: 0, flamer: 0, mortar: 0, heavy: 0, reaper: 0, heal: 0 }
    for (let idx = 11; idx < 1211; idx += 2) {
      wd.gates = null
      spawnEndlessGate(wd, idx, false)
      const o = [wd.gates.left, wd.gates.right].find(x => x.type === 'unit' || x.type === 'heal')
      if (!o) continue
      if (o.type === 'heal') c.heal++
      else if (UNITS[o.unit].cls === 'heavy') { c.heavy++; if (o.unit === 'reaper') c.reaper++ } else c[o.unit]++
    }
    return c
  }
  const d0 = draftStats(false), d1 = draftStats(true)
  check('⑤ 随机草稿权重：步兵 4 / 补员 2 / 前排 1.2 / 炮兵 1.2 / 重型 0.6', d0.rifle > d0.heal && d0.heal > d0.flamer && d0.flamer > d0.heavy && Math.abs(d0.rifle / 600 - 4 / 9) < 0.07 && Math.abs(d0.heavy / 600 - 0.6 / 9) < 0.04, JSON.stringify(d0))
  check('⑤ 阵亡过的重型更容易再刷出来（权重 0.6 → 1.8，且就是那一种）', d1.heavy > d0.heavy * 1.8 && d1.reaper === d1.heavy, `重型门 ${d0.heavy} → ${d1.heavy}，其中裁决 ${d1.reaper}`)

  // 16 层后四选一
  w = base()
  w.progress.xp = w.progress.xpNext
  w.step(NOOP)
  const n3 = w.levelup ? w.levelup.cards.length : 0
  w.step({ ...NOOP, pick: 0 })
  w.endless.layer = 16
  w.progress.xp = w.progress.xpNext
  w.step(NOOP)
  const n4 = w.levelup ? w.levelup.cards.length : 0
  const ids = w.levelup ? w.levelup.cards.map(c => c.id) : []
  w.step({ ...NOOP, reroll: true })
  const n4b = w.levelup ? w.levelup.cards.length : 0
  w.step({ ...NOOP, pick: 3 })
  check('⑤ 16 层前三选一，16 层后四选一（重掷后仍是四张，能选第 4 张）', n3 === 3 && n4 === 4 && n4b === 4 && new Set(ids).size === 4 && w.status === 'running', ids.join(', '))
  // 无尽专属通用牌
  const wc = createWorld({ seed: 1 })
  addUnits(wc, 'rifle', 5, 'test')
  const seenCampaign = new Set(), seenEndless = new Set()
  for (let k = 0; k < 12; k++) { wc.progress.xp = wc.progress.xpNext; wc.step(NOOP); if (wc.levelup) { for (const c of wc.levelup.cards) seenCampaign.add(c.id); wc.step({ ...NOOP, pick: 0 }) } }
  const we = base()
  for (let k = 0; k < 40; k++) { we.progress.xp = we.progress.xpNext; we.step(NOOP); if (we.levelup) { for (const c of we.levelup.cards) seenEndless.add(c.id); we.step({ ...NOOP, pick: we.levelup.cards.length - 1 }) } }
  check('⑤ 「超载装药」「射击校准」只在无尽发牌，且一直有牌可拿', !seenCampaign.has('gen_overload') && !seenCampaign.has('gen_tuning') && seenEndless.has('gen_overload') && seenEndless.has('gen_tuning') && we.progress.upgrades === 40,
    `无尽 40 次升级全部发出牌；超载 ×${we.progress.modules.gen_overload || 0} 校准 ×${we.progress.modules.gen_tuning || 0}`)

  // 第 10 层：盟军先遣队
  const run = runHeadless({ seed: 3, bot: 'good', endless: 10, checkEvents: true, onStep: world => {
    if (world.levelup && world.levelup.kind === 'vanguard' && !run10.cards) { run10.cards = world.levelup.cards.map(c => ({ ...c })); run10.layer = world.endless.layer; run10.heavyBefore = HEAVY_KINDS.reduce((s, k) => s + world.squad.counts[k], 0); run10.rerolls = world.levelup.rerolls }
    for (const e of world.events) {
      if (e.type === 'strike' && e.power === VANGUARD.id) run10.strikes++
      if (e.type === 'unitJoin' && e.source === 'ally') run10.joined = e.kind
      if (e.type === 'ally') run10.ally.push(e.kind)
    }
  } })
  check('⑤ 第 10 层盟军先遣队：三选一（三种不同的重型，不能重掷）', run10.layer === 10 && run10.cards && run10.cards.length === 3 && new Set(run10.cards.map(c => c.unit)).size === 3 && run10.cards.every(c => c.kind === 'ally' && UNITS[c.unit].cls === 'heavy' && c.nameKey in zh) && run10.rerolls === 0,
    run10.cards ? run10.cards.map(c => c.unit).join(' / ') : '没出现')
  check('⑤ 选完送一台重型（不占编制）+ 12 发轨道轰炸', run10.joined !== null && run10.strikes === ENDLESS.vanguardStrikes && run10.ally.includes('vanguard') && run10.ally.includes('vanguard_strike') && run.result.dmgByPower[VANGUARD.id] > 0 && !run.result.cards.some(id => id.startsWith('ally_')),
    `入列 ${run10.joined}  轰炸 ${run10.strikes} 发  伤害 ${Math.round(run.result.dmgByPower[VANGUARD.id])}`)
  if (run.badEvent && !badEvent) badEvent = run.badEvent
}

// ---------------------------------------------------------------- ⑥ 军衔
{
  let grow = true
  for (let i = 2; i < RANKS.length; i++) { const k = RANKS[i].kills / RANKS[i - 1].kills; if (!(k > 1.8 && k < 2.8)) grow = false }
  check('⑥ 13 个军衔，阈值是一条约 ×2.3 的指数曲线', RANKS.length === 13 && RANKS[0].kills === 0 && grow && new Set(RANKS.map(r => zh[r.nameKey])).size === 13, RANKS.map(r => `${zh[r.nameKey]} ${r.kills}`).join(' / '))
  const a = rankFor(0), b = rankFor(24), c = rankFor(25), top = rankFor(9999999)
  check('⑥ rankFor 的边界', a.index === 0 && b.index === 0 && c.index === 1 && c.prev === 25 && c.next === 60 && near(rankFor(100).progress, (100 - 60) / (140 - 60)) && top.index === 12 && top.next === null && top.progress === 1 && rankIndex(249999) === 11)
  const r = deep[0].r
  const rifle = r.unitReport.find(u => u.kind === 'rifle')
  const ups = []
  const run = runHeadless({ seed: 1, bot: 'good', onStep: w => { for (const e of w.events) if (e.type === 'rankUp') ups.push(e) } })
  const cr = run.result
  let seq = true
  const last = {}
  for (const e of ups) { if (e.rank <= (last[e.unit] || 0) || e.nameKey !== RANKS[e.rank].nameKey) seq = false; last[e.unit] = e.rank }
  check('⑥ 战役里 rankUp 事件逐级上升，终局军衔 = 按该兵种击杀查表', seq && ups.length >= 8 && Object.keys(cr.ranks).every(k => cr.ranks[k].index === rankIndex(cr.killsByUnit[k])),
    Object.keys(cr.ranks).map(k => `${zh[UNITS[k].nameKey]} ${cr.killsByUnit[k]} 杀 → ${zh[cr.ranks[k].nameKey]}`).join('  '))
  check('⑥ 无尽 9 层后突击兵军衔更高', rifle.rank.index > cr.ranks.rifle.index && rifle.rank.index === rankIndex(rifle.kills), `${rifle.kills} 杀 → ${zh[rifle.rank.nameKey]}`)
}

// ---------------------------------------------------------------- ⑦ 伙伴无人机
{
  check('⑦ 四个形态三道阈值，都有文案', COMPANION.forms.length === 4 && COMPANION.xp.length === 3 && COMPANION.xp[0] < COMPANION.xp[1] && COMPANION.xp[1] < COMPANION.xp[2] && COMPANION.forms.every(f => `companion.form.${f}` in zh && `companion.form.${f}.desc` in zh), COMPANION.xp.join(' / '))
  // 从开局就带着
  const log = [], firstDmg = { t: null, stage: null }
  const run = runHeadless({ seed: 2, bot: 'good', endless: 12, companion: { growth: 0 }, checkEvents: true, onStep: w => {
    const c = w.companion
    for (const e of w.events) if (e.type === 'companion' && (e.kind === 'evolve' || e.kind === 'join' || e.kind === 'found')) log.push({ kind: e.kind, stage: e.stage, form: e.form, t: w.time, layer: w.endless ? w.endless.layer : 0 })
    if (firstDmg.t === null && w.stats.dmgByPower.companion > 0) { firstDmg.t = w.time; firstDmg.stage = c.stage }
  } })
  if (run.badEvent && !badEvent) badEvent = run.badEvent
  const c = run.result.companion, w = run.world.companion
  const ev = log.filter(e => e.kind === 'evolve')
  // join 事件在 createWorld 里发出（随后事件数组被清空），所以这里只看进化
  check('⑦ 开局带上：休眠 → 侦察 → 武装 → 歼灭，按顺序进化三次', ev.length === 3 && ev.map(e => e.form).join() === 'scout,armed,annihilator' && c.stage === 3 && c.evolutions === 3 && c.found === false,
    ev.map(e => `${zh['companion.form.' + e.form]} @ ${e.t.toFixed(0)}s（${e.layer ? '第 ' + e.layer + ' 层' : '战役'}）`).join('  '))
  check('⑦ 侦察形态不战斗：武装之前伤害为 0', firstDmg.stage !== null && firstDmg.stage >= 2 && firstDmg.t >= ev[1].t - 1e-6, `首次造成伤害 @ ${firstDmg.t === null ? '-' : firstDmg.t.toFixed(1)}s，形态 ${firstDmg.stage}`)
  check('⑦ 武装形态：能量弹 + 战术扫描；歼灭形态：冰冻脉冲', c.dmg > 5000 && c.kills > 100 && c.scans >= 10 && c.pulses >= 5, `伤害 ${c.dmg}  歼敌 ${c.kills}  扫描 ${c.scans}  脉冲 ${c.pulses}`)
  check('⑦ world.companion 的状态字段', w.form === 'annihilator' && w.formKey === 'companion.form.annihilator' && w.xpNext === null && Number.isFinite(w.x) && Number.isFinite(w.z) && w.y > 0 && w.fireT > 0 && w.scanT > 0 && w.pulseT > 0)
  const P = c.points
  check('⑦ 培养点：出战 1 + 进化 3 + 加餐（最多 3）+ 胜利 2', P.deploy === 1 && P.evolve === 3 && P.win === 2 && P.treat <= 3 && P.total === P.deploy + P.evolve + P.treat + P.win, JSON.stringify(P))

  // 第 5 层捡到的那一局：5~15 层之间能体验到后两个形态
  const found = []
  // 期望变更（第 2 轮）：seed 1 → 4。理由：第 2 轮无尽前几层就开始掉人，seed 1 第 12 层团灭、伙伴还没攒够歼灭形态的经验；
  // 这条验的是「第 5 层捡到、5~15 层能看到后两个形态」，换一局走得到第 14 层的
  // 期望变更（第 3 轮）：seed 4 → 3。理由同上：战役压短、甲壳兽 / 冲锋更疼之后，seed 4 第 12 层倒下（伙伴第 12~13 层才到歼灭形态）；
  // seed 1..8 里 3 / 7 / 8 走得到第 14 层，形态时刻一致（第 5 层捡到、第 7 层武装、第 12~13 层歼灭）
  const run2 = runHeadless({ seed: 3, bot: 'good', endless: 14, onStep: w => { for (const e of w.events) if (e.type === 'companion' && (e.kind === 'found' || e.kind === 'evolve')) found.push({ kind: e.kind, form: e.form, layer: w.endless.layer }) } })
  const armed = found.find(e => e.form === 'armed'), ann = found.find(e => e.form === 'annihilator')
  check('⑦ 第 5 层捡到（侦察形态），武装与歼灭都落在 5~15 层', found.length > 0 && found[0].kind === 'found' && found[0].layer === 5 && found[0].form === 'scout' && !!armed && armed.layer >= 5 && armed.layer <= 10 && !!ann && ann.layer > armed.layer && ann.layer <= 15,
    `捡到 第 ${found[0].layer} 层 → 武装 第 ${armed ? armed.layer : '-'} 层 → 歼灭 第 ${ann ? ann.layer : '-'} 层（本局打到第 ${run2.result.layer} 层）`)
  check('⑦ 捡到的那一局：出战 1 + 进化 2 + 胜利 2', run2.result.companion.points.deploy === 1 && run2.result.companion.points.evolve === 2 && run2.result.companion.points.win === 2, JSON.stringify(run2.result.companion.points))

  // 局外成长速度
  const xpAt = growth => {
    const wd = createWorld({ seed: 6, sandbox: true, companion: { growth } })
    addUnits(wd, 'rifle', 30, 'test')
    for (let n = 0; n < 400; n++) { if (wd.swarm.living < 300) for (let k = 0; k < 30; k++) spawn(wd, 0, wd.rng.spawn.range(-5, 5), -4); wd.step(NOOP) }
    return wd.companion.xp
  }
  const x0 = xpAt(0), x10 = xpAt(10), x99 = xpAt(99)
  check('⑦ 成长等级每级 +10%，最多 10 级', x0 > 300 && near(x10 / x0, 2, 1e-6) && x99 === x10, `同一段战斗：成长 0 级 ${Math.round(x0)} 经验，10 级 ${Math.round(x10)}`)
  // 失败的一局：没有胜利分
  const wl = createWorld({ seed: 1, companion: true })
  for (let n = 0; n < 60 * 25; n++) wl.step(wl.status === 'levelup' ? { ...NOOP, pick: 0 } : NOOP)
  for (const u of wl.squad.units) damageUnit(wl, u, 9999)
  wl.step(NOOP)
  const pl = wl.result().companion.points
  check('⑦ 失败的一局：没有胜利分', wl.status === 'lost' && pl.deploy === 1 && pl.win === 0 && pl.total === pl.deploy + pl.evolve + pl.treat, JSON.stringify(pl))
  check('⑦ 不带伙伴：world.companion 为 null，结算里也是 null', createWorld({ seed: 1 }).companion === null && createWorld({ seed: 1 }).result().companion === null)
}

// ---------------------------------------------------------------- ⑧ 结算
{
  const r = deep[0].r
  const need = ['score', 'layer', 'seconds', 'kills', 'losses', 'leaked', 'peakKillRate', 'maxCombo', 'big', 'unitReport', 'powerReport', 'moduleReport', 'roster', 'unlocks', 'ranks', 'layers', 'companion', 'headline', 'bossKills', 'boons', 'campaignWon', 'mode']
  check('⑧ result() 字段齐全', need.every(k => k in r), need.filter(k => !(k in r)).join(','))
  check('⑧ 五大数字：歼敌 / 损失 / 用时 / 漏网 / 层数（战役是防线）', r.big.length === 5 && r.big.map(b => b.key).join() === 'big.kills,big.losses,big.seconds,big.leaked,big.layer' && r.big[0].value === r.kills && r.big[4].value === r.layer && r.big.every(b => b.key in zh && Number.isFinite(b.value)),
    r.big.map(b => `${zh[b.key]} ${b.value}`).join('  '))
  const camp = runHeadless({ seed: 2, bot: 'good', commander: 'hawk' }).result
  check('⑧ 战役结算第五格是防线，layer = 0', camp.big[4].key === 'big.line' && camp.layer === 0 && camp.mode === 'campaign' && camp.headline.titleKey === 'result.won')
  // 期望变更：两张表 → 三张表（加上 deviceReport：装置与应急电网）。理由：伤害和击杀多了「装置」这一路来源
  const sumK = r.unitReport.reduce((s, u) => s + u.kills, 0) + r.powerReport.reduce((s, u) => s + u.kills, 0) + r.deviceReport.reduce((s, u) => s + u.kills, 0)
  const sumS = r.unitReport.reduce((s, u) => s + u.share, 0) + r.powerReport.reduce((s, u) => s + u.share, 0) + r.deviceReport.reduce((s, u) => s + u.share, 0)
  check('⑧ 火力报告（兵种 + 技能 + 装置）：各行歼敌之和 = 总击杀，占比之和 = 1', sumK === r.kills && Math.abs(sumS - 1) < 0.002, `${sumK} / ${r.kills}  占比合计 ${r3(sumS)}`)
  check('⑧ 兵种行：伤害 / 占比 / 累计部署 / 歼敌 / 对 Boss / 军衔，按伤害排序', r.unitReport.length >= 3 && r.unitReport.every((u, i) => u.nameKey in zh && u.dmg >= 0 && u.deployed > 0 && u.kills >= 0 && u.bossDmg >= 0 && u.rank && (i === 0 || r.unitReport[i - 1].dmg >= u.dmg)) && r.unitReport.some(u => u.bossDmg > 0),
    r.unitReport.slice(0, 3).map(u => `${zh[u.nameKey]} ${u.dmg}（${(u.share * 100).toFixed(1)}%）部署 ${u.deployed} 歼敌 ${u.kills} 对 Boss ${u.bossDmg}`).join('  |  '))
  check('⑧ 技能行：指挥官技能 + 伙伴，带次数与文案', camp.powerReport.length === 4 && camp.powerReport.every(p => p.nameKey in zh && p.casts >= 0) && camp.powerReport.some(p => p.dmg > 0 && p.casts > 0) && r.powerReport.some(p => p.id === 'companion' && p.nameKey === 'companion.name'),
    camp.powerReport.map(p => `${zh[p.nameKey]} ${p.dmg} ×${p.casts}`).join('  '))
  check('⑧ 装备贡献：按伤害排序，名字可查', r.moduleReport.length >= 2 && r.moduleReport.every((m, i) => m.nameKey in zh && (i === 0 || r.moduleReport[i - 1].dmg >= m.dmg)), r.moduleReport.slice(0, 3).map(m => `${zh[m.nameKey]} ${m.dmg}`).join('  '))
  const all = deep.map(d => d.r)
  const rosterRun = all.find(x => x.roster.some(s => s.fallen > 0)) || all.find(x => x.roster.length > 0)
  const sq = rosterRun ? (rosterRun.roster.find(s => s.fallen > 0) || rosterRun.roster[0]) : null
  check('⑧ 英雄级小队名单：绰号、成员名字、在列 / 阵亡', !!sq && sq.squadName in zh && sq.members.length > 0 && sq.members.every(m => m.name in zh && typeof m.alive === 'boolean' && (m.alive || m.fallenAt !== null)) && sq.alive + sq.fallen === sq.members.length,
    sq ? `「${zh[sq.squadName]}」${sq.members.length} 人：${sq.alive} 在列 / ${sq.fallen} 未归；如 ${sq.members.slice(0, 3).map(m => zh[m.name] + (m.alive ? '' : '（阵亡于 ' + m.fallenAt + 's）')).join('、')}` : '没有英雄级')
  check('⑧ 解锁项：通关给 6 项，到第 5 层再给伙伴', camp.unlocks.length === 6 && !camp.unlocks.includes('companion') && r.unlocks.length === 7 && r.unlocks.includes('companion') && UNLOCK_IDS.every(id => UNLOCKS[id].nameKey in zh && UNLOCKS[id].descKey in zh), r.unlocks.join(', '))
  // 期望变更：造「失败的一局」从 random bot seed 3 换成老兵难度挂机。理由：random seed 3 在新时间轴下打赢了；老兵挂机是 0/10（test-core ⑥ 有断言）
  const lost = runHeadless({ seed: 3, bot: 'idle', difficulty: 'veteran' }).result
  check('⑧ 失败的一局：没有解锁，标题 / 建议文案可查', lost.outcome === 'lost' && lost.unlocks.length === 0 && lost.headline.titleKey in zh && lost.headline.textKey in zh, `${zh[lost.headline.titleKey]} ${zh[lost.headline.textKey]}`)
  check('⑧ 峰值歼敌速度、最高连杀', r.peakKillRate > 400 && r.maxCombo > 1000 && camp.peakKillRate > 300, `无尽 ${r.peakKillRate}/s 连杀 ${r.maxCombo}；战役 ${camp.peakKillRate}/s 连杀 ${camp.maxCombo}`)
  check('⑧ result() 可以 JSON 往返', JSON.stringify(JSON.parse(JSON.stringify(r))) === JSON.stringify(r))
}

// ---------------------------------------------------------------- ⑨ 成就
{
  const save0 = defaultSave()
  check('⑨ 约 20 个成就，id 不重复，中英文案齐全', ACHIEVEMENTS.length >= 20 && ACHIEVEMENTS.length <= 28 && new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length && ACHIEVEMENTS.every(a => a.nameKey in zh && a.descKey in zh && a.nameKey in en && a.descKey in en && typeof a.test === 'function'), `${ACHIEVEMENTS.length} 个`)
  const running = createWorld({ seed: 1 }).result()
  check('⑨ 开局一步没走：一个成就都不该给', achievementsFor(running, save0.stats).length === 0, achievementsFor(running, save0.stats).join(','))
  const camp = runHeadless({ seed: 1, bot: 'good' }).result
  const a1 = achievementsFor(camp, save0.stats)
  // 期望变更：good bot 不再零损失通关（第 1 轮测试要求它平均掉 5~20 人），「全员到齐」改用同一局的结果把损失改成 0 来验；
  // 真实这一局有损失，就不该给「全员到齐」
  const a1clean = achievementsFor({ ...camp, losses: 0 }, save0.stats)
  check('⑨ 通关：桥还在；零损失才给全员到齐', a1.includes('first_bridge') && camp.losses > 0 && !a1.includes('clean_sheet') && a1clean.includes('clean_sheet') && !a1.includes('deep_five') && !a1.includes('veteran_pass') && !a1.includes('million'), `损失 ${camp.losses}：${a1.join(', ')}`)
  // 新增：勋章「没停过」要求整局没暂停过（第 1 轮测试：暂停过也照发）
  check('⑨ 没停过：连杀够、且整局没暂停过才给', a1.includes('long_chain') === (camp.maxCombo >= LONG_CHAIN) && !achievementsFor({ ...camp, pauses: 1 }, save0.stats).includes('long_chain') && camp.pauses === 0 && camp.maxCombo < camp.kills, `最高连杀 ${camp.maxCombo} / 歼敌 ${camp.kills}`)
  // 期望变更（第 2 轮）：deep[0]（seed 1）→ 第一局打满 9 层且打倒了第 9 层 Boss 的。理由：第 2 轮让无尽每层都掉人之后，
  // seed 1 第 9 层只剩 24 人、没在撤离前打倒碾压者（Boss 击杀 3）；这条验的是成就判定，要一局「三种 Boss 都打倒过」的样本
  const d2 = deep.find(d => d.r.layer >= 9 && d.r.bossKills >= 4) || deep[0]
  const a2 = achievementsFor(d2.r, save0.stats)
  check('⑨ 无尽 9 层：第五层 / 三种都见过，但没有第十层', a2.includes('deep_five') && a2.includes('three_heads') && !a2.includes('deep_ten') && !a2.includes('clean_sheet'), a2.join(', '))
  const lost = runHeadless({ seed: 3, bot: 'idle', difficulty: 'veteran' }).result     // 同 ⑧：换成必败的老兵挂机
  check('⑨ 失败的一局拿不到通关类成就', !achievementsFor(lost, save0.stats).some(id => ['first_bridge', 'clean_sheet', 'sealed_line', 'quick_work'].includes(id)), achievementsFor(lost, save0.stats).join(', '))
  const big = { ...save0.stats, kills: 1000000, runs: 25, winsBy: { hawk: 1, ysera: 2, joe: 1 }, dailyDays: 7 }
  const a3 = achievementsFor(camp, big)
  check('⑨ 累计类成就看存档统计', ['million', 'regular', 'roll_call', 'week_streak'].every(id => a3.includes(id)) && !achievementsFor(camp, { ...big, winsBy: { hawk: 3 } }).includes('roll_call'))
  // 期望变更（第 2 轮）：seed 1 → 3。理由：这条验的是成就判定，需要一局赢下来的老兵 + 双突变；第 2 轮加了危险感之后
  // 这个组合 good bot 6 局赢 4 局，seed 1 / 2 会团灭（本来就该有输的可能），换成赢下来的 seed 3
  // 期望变更（第 3 轮）：seed 3 → 2。理由同上：这条只验成就判定；第 3 轮时间轴压到 ×0.92、守线阶段加厚之后，老兵 + 疾行 + 共振是最难的组合，
  // good bot seed 1..5 赢 2 局（seed 2 / 5），换成赢下来的 seed 2
  const vet = runHeadless({ seed: 2, bot: 'good', difficulty: 'veteran', mutators: ['swift', 'resonance'] }).result
  const a4 = achievementsFor(vet, save0.stats)
  check('⑨ 老兵 + 两个突变通关', vet.outcome === 'won' && a4.includes('veteran_pass') && a4.includes('mutant_handler') && !a4.includes('all_weather'), `${vet.outcome}: ${a4.join(', ')}`)
}

// ---------------------------------------------------------------- ⑩ 存档
{
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, _m: m } }
  const d = defaultSave()
  check('⑩ 默认存档结构', d.version === 1 && d.board.length === 0 && d.unlocks.length === 0 && d.best.score === 0 && d.companion.unlocked === false && d.settings.lang === 'zh' && Object.keys(d.settings.volume).length === 6 && SAVE_KEY.startsWith('hivefall.'))
  const same = x => JSON.stringify(x) === JSON.stringify(d)
  check('⑩ 空 / 损坏 / 会抛错的 storage 都退回默认值', same(loadSave(mem())) && same(loadSave({ getItem: () => '{oops' })) && same(loadSave({ getItem: () => { throw new Error('denied') } })) && same(loadSave(null)))
  check('⑩ storage 写不进去时 storeSave 返回 false，不抛错', storeSave({ setItem: () => { throw new Error('quota') } }, d) === false && storeSave(mem(), d) === true)
  const m1 = mergeSave({ settings: { lang: 'en', volume: { music: 0.1 }, quality: 42 }, best: { score: 777 }, unlocks: ['endless', 5], future: { x: 1 }, board: [{ score: 5, layer: 0 }, 'junk', { score: 'NaN' }], stats: 'broken' })
  check('⑩ 合并：缺的补默认，类型不对的丢掉，未知字段保留', m1.settings.lang === 'en' && m1.settings.volume.music === 0.1 && m1.settings.volume.master === 0.8 && m1.settings.quality === 'high' && m1.best.score === 777 && m1.best.layer === 0 && m1.unlocks.join() === 'endless' && m1.future.x === 1 && m1.board.length === 1 && m1.stats.runs === 0)

  // 本机榜：分数 → 层数 → 用时
  const E = (score, layer, seconds, at = 0) => ({ name: '', score, layer, seconds, at })
  const sorted = rankBoard([E(100, 0, 90), E(300, 2, 200), E(300, 5, 250), E(300, 5, 240), E(50, 9, 10), E(300, 5, 240, 7)])
  check('⑩ 本机榜排序：分数 → 层数 → 用时 → 先到', sorted.map(e => `${e.score}/${e.layer}/${e.seconds}/${e.at}`).join(' ') === '300/5/240/0 300/5/240/7 300/5/250/0 300/2/200/0 100/0/90/0 50/9/10/0', sorted.map(e => `${e.score}/${e.layer}/${e.seconds}`).join('  '))
  const many = []
  for (let k = 0; k < 25; k++) many.push(E(k * 10, 0, 90))
  const top = rankBoard(many)
  check('⑩ 本机榜只留前 10', top.length === BOARD_SIZE && top[0].score === 240 && top[9].score === 150 && compareEntries(top[0], top[1]) < 0)
  check('⑩ 名字最长 10 个字符，去掉控制字符和尖括号', cleanName('  <b>第七远征军的某个很长的名字</b>  ') === 'b第七远征军的某个很' && cleanName(null) === '' && cleanName('A' + String.fromCharCode(7) + 'B') === 'AB')

  // 结算入账
  const store = mem()
  const save = loadSave(store)
  const camp = runHeadless({ seed: 1, bot: 'good' }).result
  const o1 = applyResult(save, camp, { name: 'Mark', now: 1000 })
  check('⑩ 第一次通关：上榜第 1、新纪录、6 项新解锁、新成就', o1.rank === 1 && o1.newBest && o1.newUnlocks.length === 6 && o1.newAchievements.includes('first_bridge') && save.best.score === camp.score && save.best.campaignSeconds === camp.campaignSeconds && save.stats.runs === 1 && save.stats.wins === 1 && save.stats.kills === camp.kills && save.board[0].name === 'Mark' && save.achievements.first_bridge === 1000,
    `解锁 ${o1.newUnlocks.join(',')}  成就 ${o1.newAchievements.join(',')}`)
  const o2 = applyResult(save, camp, { name: 'Mark', now: 2000 })
  check('⑩ 同样的成绩再来一次：不重复解锁 / 不重复给成就，榜上排第 2（先到先得）', o2.newUnlocks.length === 0 && o2.newAchievements.length === 0 && !o2.newBest && o2.rank === 2 && save.board.length === 2 && save.stats.runs === 2)
  const er = deep[0].r
  const o3 = applyResult(save, er, { now: 3000 })
  check('⑩ 无尽成绩：榜首换人，解锁伙伴，培养点入账', o3.rank === 1 && o3.newBest && o3.newUnlocks.join() === 'companion' && o3.companionUnlocked && save.companion.unlocked && save.companion.points === er.companion.points.total && o3.companionPoints === er.companion.points.total && save.best.layer === 9 && save.stats.bestLayer === 9 && o3.newAchievements.includes('deep_five'),
    `培养点 +${o3.companionPoints}  成就 ${o3.newAchievements.join(',')}`)
  const before = JSON.stringify(save)
  const o4 = applyResult(save, createWorld({ seed: 1 }).result(), { now: 4000 })
  check('⑩ 没打完的对局不入账', JSON.stringify(save) === before && o4.rank === 0)
  {
    // 战役主动放弃（abandon）的局：累计统计照记，但不刷最高分、不上本机榜（测试：开局 5 秒撤离、10 杀进了榜第 3）
    const s2 = defaultSave(), w2 = createWorld({ seed: 1 })
    for (let k = 0; k < 300; k++) w2.step({})
    w2.step({ abandon: true })
    const ab = w2.result()
    const o = applyResult(s2, ab, { now: 1 })
    check('⑩ 战役主动放弃：计入局数，不刷最高分、不上本机榜', ab.reason === 'abandon' && ab.score > 0 && s2.stats.runs === 1 && s2.board.length === 0 && s2.best.score === 0 && o.rank === 0 && !o.newBest,
      `放弃时 ${ab.score} 分  榜 ${s2.board.length} 条`)
  }
  for (let k = 0; k < 14; k++) applyResult(save, { ...camp, score: 20000 + k, kills: 20000 + k }, { now: 5000 + k })
  check('⑩ 榜满之后低分上不了榜（rank = 0）', save.board.length === 10 && applyResult(save, { ...camp, score: 1, kills: 1 }, { now: 9000 }).rank === 0 && save.board.every((e, i) => i === 0 || compareEntries(save.board[i - 1], e) <= 0))
  // 每日
  const daily = runHeadless({ seed: 1, bot: 'good', daily: true, dateKey: '2026-09-30' }).result
  applyResult(save, daily, { now: 1 }); applyResult(save, { ...daily, score: 1 }, { now: 2 })
  check('⑩ 每日挑战：每个日期留最好的一次，同一天不重复计天数', save.daily.lastKey === '2026-09-30' && save.daily.best['2026-09-30'].score === daily.score && save.stats.dailyDays === 1)
  // 伙伴培养
  save.companion.points = 5
  const cost0 = companionNextCost(save)
  const b1 = buyCompanionGrowth(save), b2 = buyCompanionGrowth(save), b3 = buyCompanionGrowth(save)
  check('⑩ 培养点买成长速度：2 点起、每级贵 1 点，点数不够买不了', cost0 === 2 && growthCost(1) === 3 && b1 && b2 && !b3 && save.companion.growth === 2 && save.companion.points === 0 && save.companion.spent === 5 && companionConfig(save).growth === 2 && companionConfig(save, false) === null && companionConfig(defaultSave()) === null)
  save.companion.points = 999
  while (buyCompanionGrowth(save));
  check('⑩ 成长最多买到 10 级', save.companion.growth === COMPANION.growthMax && companionNextCost(save) === null)
  // 落盘往返
  storeSave(store, save)
  const back = loadSave(store)
  check('⑩ 存档落盘再读回来完全一致', JSON.stringify(back) === JSON.stringify(save) && store._m.size === 1 && store._m.has(SAVE_KEY), `${store._m.get(SAVE_KEY).length} 字节`)
  const be = boardEntry(er, { name: '很长很长很长很长很长的名字', now: 5 })
  check('⑩ boardEntry 的字段', be.score === er.score && be.layer === 9 && be.name.length === 10 && be.commander === 'none' && Array.isArray(be.mutators) && be.at === 5)
}

// ---------------------------------------------------------------- ⑪ 无尽 12 层的单步耗时
{
  // 先让 good bot 自己打到第 12 层，记下第 12 层里每一步的耗时
  let total = 0, steps = 0, worst = 0, fieldSum = 0
  // 期望变更（第 2 轮）：seed 2 → 3。理由：这条量的是第 12 层的单步耗时，前提是 bot 自己打得到第 13 层；第 2 轮无尽变难之后 seed 2 倒在第 11 层
  // 期望变更（集成第 1 轮）：seed 3 → 2。理由：同上，这条只量单步耗时、前提是 bot 打得到第 13 层；修掉「死一人整排左右互换、方阵挤成 3~4 米一摞」
  // 的阵型 bug（src/sim/squad.js layout）之后方阵始终满宽，seed 3 倒在第 11 层（seed 1/2/4/5 都到第 13 层，3/6 不到），耗时断言本身不变
  const world = createWorld({ seed: 2, companion: { growth: 5 } })
  const play = createBot('good', 2)
  let guard = 0
  while (world.status !== 'lost' && guard++ < 60 * 900) {
    if (world.status === 'won') { world.step({ ...NOOP, continueEndless: true }); continue }
    const e = world.endless
    if (e && e.layer >= 13) break
    const input = play(world)
    const timed = e && e.layer === 12 && (world.status === 'running' || world.status === 'aiming')
    const t0 = clock()
    world.step(input)
    const ms = clock() - t0
    if (timed) { total += ms; steps++; fieldSum += world.swarm.living; if (ms > worst) worst = ms }
    scan(world)
  }
  const avg = steps ? total / steps : Infinity
  check('⑪ good bot 打到第 12 层，该层单步平均 < 4ms', world.endless !== null && world.endless.layer >= 13 && avg < 4, `平均 ${avg.toFixed(3)} ms  最慢 ${worst.toFixed(2)} ms  ${steps} 步  平均在场 ${Math.round(fieldSum / Math.max(1, steps))} 只  兵力 ${world.squad.units.length}`)

  // 压力：第 12 层的成长系数下，每步把场上补满到 3400 只（含精英与各兵种），部队不让死
  const NAMES = ['ling', 'burster', 'spitter', 'crusher', 'hulk', 'wing', 'digger', 'warden']
  const bag = ['ling', 'ling', 'ling', 'ling', 'ling', 'ling', 'burster', 'crusher', 'spitter', 'wing', 'hulk', 'digger', 'warden']
  const rng = world.rng.spawn
  let t2 = 0, n2 = 0, w2 = 0, live = 0, elites = 0
  for (let n = 0; n < 660; n++) {
    const e = world.endless
    if (e.layer === 13 && e.layerT > 10) e.layerT = 5                 // 停在这一层，不让它翻层
    while (world.swarm.living < LIVE_CAP) {
      let name = bag[rng.int(bag.length)]
      if (world.swarm.kindCount[KIND_INDEX[name]] >= ENEMIES[name].cap) name = 'ling'
      const elite = rng() < world.eliteChance
      if (spawn(world, KIND_INDEX[name], rng.range(-6, 6), rng.range(-24, 4), 0, elite) < 0) break
      if (elite) elites++
    }
    world.line.hp = world.line.hpMax
    for (const u of world.squad.units) { u.hp = u.hpMax; u._invuln = world.time + 1 }
    const running = world.status === 'running' || world.status === 'aiming'
    const fieldNow = world.swarm.living
    const t0 = clock()
    world.step(play(world))
    const ms = clock() - t0
    if (n >= 60 && running) { t2 += ms; n2++; live += fieldNow; if (ms > w2) w2 = ms }
    scan(world)
  }
  const avg2 = t2 / n2
  check('⑪ 第 13 层的成长系数 + 3400 只在场（含精英）单步平均 < 4ms', avg2 < 4 && live / n2 >= 3390 && world.endless.layer === 13, `平均 ${avg2.toFixed(3)} ms  最慢 ${w2.toFixed(2)} ms  平均在场 ${Math.round(live / n2)}  计时 ${n2} 步  精英 ${elites} 只  兵力 ${world.squad.units.length}  击杀 ${world.stats.kills}`)
  check('⑪ 压力测试期间部队满员开火', world.squad.units.length >= 40, `兵力 ${world.squad.units.length}`)
  void NAMES
}

// ---------------------------------------------------------------- 文案 / 事件
{
  const needKeys = ['phase.endless', 'wave.deep', 'comms.endless', 'comms.bounty', 'comms.vanguard', 'ally.vanguard.card', 'ally.vanguard.orbital', 'gate.boon', 'companion.name', 'comms.speaker.seven', 'comms.companion.found',
    'result.retreated', 'result.retreated.text', 'result.endless_lost', 'result.won.text', 'result.running', 'advice.wiped', 'advice.line', 'advice.timeout', 'tag.cost', 'tag.boon', 'tag.bounty',
    'module.gen_overload.name', 'module.gen_tuning.name', 'module.gen_treat.name', 'big.kills', 'big.losses', 'big.seconds', 'big.leaked', 'big.layer', 'big.line']
  for (const b of Object.values(BOONS)) needKeys.push(b.nameKey, b.descKey)
  for (const m of Object.values(MIXES)) needKeys.push(m.nameKey)
  for (const t of THEMES) needKeys.push(`theme.${t}.name`, `comms.theme.${t}`)
  for (const r of RANKS) needKeys.push(r.nameKey)
  for (const f of COMPANION.forms) needKeys.push(`companion.form.${f}`, `comms.companion.${f === 'dormant' ? 'found' : f}`)
  const miss = needKeys.filter(k => !(k in zh) || !(k in en))
  check('文案 第 4 步数据引用的 key 中英都有', miss.length === 0, miss.slice(0, 8).join(', ') || `${needKeys.length} 个 key`)
  check('属性门：有代价 5 种 / 无代价 4 种 / 悬赏 2 种', BOONS_COST.length === 5 && BOONS_FREE.length === 4 && BOONS_BOUNTY.length === 2)
  check('所有场景的事件：没有 NaN / 未登记类型', badEvent === null, badEvent ? `${badEvent.event.type}.${badEvent.field}` : '')
}

// ---------------------------------------------------------------- 测试回归 + 无尽的平衡目标
{
  // #0 战役打满 60 步兵再进无尽：先抬编制再补员，4 名突击兵进得来，事件照发
  const world = createWorld({ seed: 3 })
  addUnits(world, 'rifle', 59, 'test')
  const full = world.squad.counts.rifle === 60 && capRoom(world, 'rifle') === 0
  world.events.length = 0
  enterEndless(world)
  const join = world.events.find(e => e.type === 'unitJoin' && e.source === 'endless')
  check('回归 #0：满编 60 步兵进无尽，照样补 4 名突击兵并发 unitJoin{source: endless}', full && !!join && join.count === ENDLESS.gift.count && join.kind === 'rifle' && world.squad.counts.rifle === 64, `步兵 60 → ${world.squad.counts.rifle}`)

  // #5 Boss 倒下的冲击波不震潜地的掘地虫：不能出现「人在地下、状态却是行走」的虫
  const w = endlessWorld(2)
  const di = spawn(w, KIND_INDEX.digger, 0, -12)
  const s = w.swarm
  const burrowed = s.state[di] === 3 && s.y[di] < 0
  spawnBoss(w, 'ravager')
  w.boss.phase = w.boss._def.phases.length      // 阶段走完：一下打穿（Boss 的阶段阈值会封顶单下伤害）
  damageBoss(w, 1e9, 'rifle', null, null, true)
  const afterWave = s.state[di]
  let walkUnder = false, steps = 0, shot = false
  while (w.boss !== null && steps++ < 2000) w.step(NOOP)
  for (let n = 0; n < 40; n++) {
    w.step({ ...NOOP, pick: 0 })
    if (s.alive[di] === 1 && s.kind[di] === KIND_INDEX.digger && s.y[di] < 0) {
      if (s.state[di] !== 3) walkUnder = true
      if (hitEnemy(w, di, 1, 'rifle', null, true, null, false) || s.hp[di] < s.hpMax[di]) shot = true
    }
  }
  check('回归 #5：Boss 倒下后，潜地的掘地虫仍是 state=3、打不到', burrowed && afterWave === 3 && w.boss === null && !walkUnder && !shot, `冲击波后 state=${afterWave}  Boss 倒下后 ${steps} 步续打`)
}

{
  // ⑫ 无尽的平衡目标：标准小队 8~12 层开始吃力（不是前面零损失、然后两层之内团灭）；三位指挥官强度接近
  const deep = commander => [1, 2, 3, 4].map(seed => runHeadless({ seed, bot: 'good', commander, endless: 30 }).result)
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length
  const depth = rs => avg(rs.map(r => r.layer))
  const lossIn = (rs, a, b) => avg(rs.map(r => r.layers.filter(l => l.layer >= a && l.layer <= b).reduce((x, l) => x + l.losses, 0)))
  const none = deep('none')
  const early = lossIn(none, 1, 7), mid = lossIn(none, 8, 12), dn = depth(none)
  console.log(`   none   倒在第 ${none.map(r => r.layer).join(' / ')} 层（均 ${dn}）  1~7 层共损失 ${early}  8~12 层共损失 ${mid}`)
  // 期望变更（第 2 轮测试）：「前 7 层轻松（共损失 ≤ 15）」→「前 7 层每层都掉几个人、但不崩（共损失 7~40）」。
  // 理由：测试实玩「无尽 1~4 层新增损失 0，满编 64~68 人平推，打到第 5 层也没有一次有输的感觉」——零损失本身就是问题
  check('⑫ 标准小队：前 7 层每层都掉人但不崩，8~12 层吃紧，11~16 层倒下', none.every(r => r.layer >= 8) && early >= 7 && early <= 40 && mid >= 8 && dn >= 11 && dn <= 16, `均 ${dn} 层  1~7 层共损失 ${early}`)
  const ds = {}
  for (const c of ['hawk', 'ysera', 'joe']) {
    const rs = deep(c)
    ds[c] = depth(rs)
    console.log(`   ${c.padEnd(6)} 倒在第 ${rs.map(r => r.layer).join(' / ')} 层（均 ${ds[c]}）  8~12 层共损失 ${lossIn(rs, 8, 12)}`)
  }
  const vals = Object.values(ds)
  // 只有 4 个种子、对战役改动很敏感：前期虫量翻倍后实测 17 / 18.5 / 19.25（差 2.25），放到 2.5 层仍能抓住真正的强弱失衡
  check('⑫ 三位指挥官强度接近：都比标准小队走得深，彼此相差不超过 2.5 层', vals.every(v => v >= dn + 1) && Math.max(...vals) - Math.min(...vals) <= 2.5, Object.entries(ds).map(([k, v]) => `${k} ${v}`).join('  ') + `  标准小队 ${dn}`)
}

{
  // ⑬（第 2 轮修复）无尽兵力保底：测试实机无尽里在列兵力 32 → 33 → 19 越打越少。每层开头步兵补到 base + per × 层号（一次最多 max、至少 relief；现值 36 + 3n / 14 / 6），
  // 偶数层再按编制空投一台重型；伊瑟拉的守护之壳在这批补员身上从冷却开始
  const run = (commander, extra) => {
    const w = createWorld({ seed: 1, commander })
    addUnits(w, 'rifle', extra, 'test')
    w.status = 'won'
    enterEndless(w)
    const foot = () => w.squad.units.filter(u => u.alive && u._def.cls === 'infantry')
    const heavy = () => w.squad.units.filter(u => u.alive && u._def.cls === 'heavy').length
    const ids = new Set(foot().map(u => u.id))
    const before = { inf: foot().length, heavy: heavy() }
    for (const u of w.squad.units) u._invuln = w.time + 99
    w.endless.layerT = w.endless.layerLen
    w.step({})
    const fresh = foot().filter(u => !ids.has(u.id))
    return { w, before, after: { inf: foot().length, heavy: heavy() }, fresh }
  }
  const a = run('none', 19), b = run('none', 59), y = run('ysera', 19)
  const RF = ENDLESS.reliefFloor
  check(`⑬ 无尽兵力保底：步兵不足 ${RF.base} + ${RF.per} × 层号时补到保底线（一次最多 ${RF.max}），满员时仍补 ${ENDLESS.relief}；偶数层空投一台重型`,
    a.w.endless.layer === 2 && a.after.inf - a.before.inf === Math.min(RF.max, Math.max(ENDLESS.relief, RF.base + 2 * RF.per - a.before.inf)) && a.after.heavy === a.before.heavy + 1 && b.after.inf - b.before.inf === Math.min(ENDLESS.relief, capsAt(2).infantry - b.before.inf),
    `${a.before.inf} 人 → ${a.after.inf}  ${b.before.inf} 人 → ${b.after.inf}  重型 ${a.before.heavy} → ${a.after.heavy}`)
  check('⑬ 伊瑟拉：保底补员入列时守护之壳在冷却', y.fresh.length > 0 && y.fresh.every(u => u._aegisT > y.w.time + 50), `补员 ${y.fresh.length} 人`)
}

console.log(failed === 0 ? '\n全部通过.' : `\n${failed} 项未通过.`)
process.exitCode = failed === 0 ? 0 : 1
