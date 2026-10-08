// 无头跑一局战役并打印统计。
//   node tools/sim-run.mjs --seed 1 --bot good|builder|idle|random|heavy|heavy2|merc --boss ravager|matriarch|leviathan
//     （good = 走位 + 布防 + 技能；builder = 只布防不走位；idle = 不动不放）
//     --commander none|hawk|ysera|joe --mutators swift,undying --difficulty normal|veteran --draft script|random
//     --daily 2026-09-30（每日挑战：种子 / 指挥官 / 突变由日期派生） --verbose --json
//     --endless N（战役胜利后续打无尽，打完第 N 层撤离或中途阵亡，打印每层摘要） --companion [成长等级]（带上伙伴无人机）
//     --unlockAll（开局解锁全部 8 种装置）
import { runHeadless } from '../src/sim/bot.js'
import { UNITS } from '../src/data/units.js'
import { DEVICES } from '../src/data/devices.js'
import zh from '../src/data/strings.zh.js'

function parseArgs(argv) {
  const a = { seed: 1, bot: 'good', commander: 'none', difficulty: 'normal', draft: 'script', verbose: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--verbose') a.verbose = true
    else if (k === '--unlockAll') a.unlockAll = true
    else if (k === '--json') a.json = true
    else if (k === '--companion') a.companion = { growth: argv[i + 1] && !argv[i + 1].startsWith('--') ? Number(argv[++i]) : 0 }
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i]
  }
  a.seed = Number(a.seed)
  a.endless = Number(a.endless || 0)
  a.mutators = a.mutators ? String(a.mutators).split(',').filter(Boolean) : []
  if (a.daily) { a.dateKey = a.daily; a.daily = true }
  return a
}

const t = key => zh[key] || key
const pct = v => (v * 100).toFixed(1) + '%'
const clock = () => Number(process.hrtime.bigint()) / 1e6

const args = parseArgs(process.argv.slice(2))
const eventCounts = {}
const onStep = args.verbose ? world => { for (const e of world.events) eventCounts[e.type] = (eventCounts[e.type] || 0) + 1 } : null
const run = runHeadless({ ...args, clock, checkEvents: true, onStep })
const r = run.result

if (args.json) {
  console.log(JSON.stringify(r, null, 1))
} else {
  const outcome = r.outcome === 'won' ? '胜利' : r.outcome === 'lost' ? `失败（${r.reason}）` : r.outcome === 'retreated' ? `撤离（第 ${r.layer} 层）` : r.outcome
  console.log(`== HIVEFALL ${r.mode === 'endless' ? '无尽' : '战役'}  seed=${r.seed}  bot=${args.bot}  commander=${r.commander}  difficulty=${r.difficulty}  boss=${t(`boss.${r.boss}.name`)}  重型门=${r.heavyPlan.map(k => t(UNITS[k].nameKey)).join('/')} ==`)
  console.log(`结果 ${outcome}   用时 ${r.seconds}s   击杀 ${r.kills}   损失 ${r.losses}   漏网 ${r.leaked}   防线 ${r.line.hp}/${r.line.hpMax}`)
  console.log(`等级 ${r.level}   经验 ${r.xp}   峰值歼敌速度 ${r.peakKillRate}/s   最高连杀 ${r.maxCombo}   在场峰值 ${run.peakEnemies}`)
  console.log(`终局兵力 ${r.troops}  ` + Object.entries(r.counts).filter(e => e[1] > 0).map(([k, n]) => `${t(UNITS[k].nameKey)}×${n}`).join('  '))
  console.log(`卡牌 ${r.cards.map(id => t(`module.${id}.name`)).join(' / ') || '无'}`)
  if (r.combos.length) console.log(`联动 ${r.combos.map(id => t(`combo.${id}.name`)).join(' / ')}`)
  if (r.heroics.length) console.log(`英雄级 ${r.heroics.map(id => t(`heroic.${id}.name`)).join(' / ')}`)
  if (r.daily) console.log(`每日挑战 ${r.dateKey}`)
  if (r.mutators.length) console.log(`突变因子 ${run.world.mutators.map(m => t(m.nameKey) + (m.active ? '' : '（未生效）')).join(' / ')}`)
  if (r.contract) console.log(`合同 ${t(`contract.${r.contract.id}.name`)}：${{ open: '已到手', lost: '作废', pod: '舱还没打开' }[r.contract.state]}`)
  const casts = Object.entries(r.powerCasts)
  if (casts.length) console.log('技能  ' + casts.map(([id, n]) => `${t(`power.${id}.name`)} ×${n}${r.dmgByPower[id] ? ' 伤害 ' + Math.round(r.dmgByPower[id]) : ''}`).join('   '))
  console.log('兵种伤害占比  ' + Object.entries(r.dmgShare).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${t(UNITS[k].nameKey)} ${pct(v)}`).join('   '))
  const mods = Object.entries(r.dmgByModule).sort((a, b) => b[1] - a[1])
  if (mods.length) console.log('模块伤害  ' + mods.map(([k, v]) => `${k} ${Math.round(v)}`).join('   '))
  const boss = Object.entries(r.bossDmgByUnit).sort((a, b) => b[1] - a[1])
  if (boss.length) console.log('对 Boss 伤害  ' + boss.map(([k, v]) => `${t(UNITS[k].nameKey)} ${Math.round(v)}`).join('   '))
  if (r.layers.length) {
    console.log(`无尽  抵达第 ${r.layer} 层   战役用时 ${r.campaignSeconds}s   Boss 击杀 ${r.bossKills}   精英击杀 ${r.eliteKills}   属性门 ${r.boons.map(id => t(`boon.${id}.name`)).join(' / ') || '无'}`)
    console.log('  层  配比      Boss        用时   击杀   损失  漏网  兵力  防线        等级  累计击杀')
    for (const l of r.layers) {
      console.log(`  ${String(l.layer).padStart(2)}  ${l.mix.padEnd(8)}  ${(l.boss || '-').padEnd(10)}  ${String(l.seconds).padStart(4)}s  ${String(l.kills).padStart(5)}  ${String(l.losses).padStart(4)}  ${String(l.leaked).padStart(4)}  ${String(l.troops).padStart(4)}  ${(l.line + '/' + l.lineMax).padEnd(10)}  Lv${String(l.level).padEnd(3)} ${String(l.killsTotal).padStart(7)}${l.partial ? '  （未打完）' : ''}`)
    }
  }
  if (r.companion) {
    const c = r.companion
    console.log(`伙伴  ${t('companion.name')}：${t(c.formKey)}   伤害 ${c.dmg}   歼敌 ${c.kills}   扫描 ${c.scans} 次   脉冲 ${c.pulses} 次   培养点 +${c.points.total}（出战 ${c.points.deploy} / 进化 ${c.points.evolve} / 加餐 ${c.points.treat} / 胜利 ${c.points.win}）`)
  }
  console.log('兵种火力报告  兵种 / 伤害 / 占比 / 累计部署 / 歼敌 / 对 Boss / 军衔')
  for (const u of r.unitReport) console.log(`  ${t(u.nameKey).padEnd(10)} ${String(u.dmg).padStart(9)}  ${pct(u.share).padStart(6)}  部署 ${String(u.deployed).padStart(3)}  歼敌 ${String(u.kills).padStart(6)}  对 Boss ${String(u.bossDmg).padStart(6)}  ${t(u.rank.nameKey)}`)
  for (const u of r.powerReport) console.log(`  ${t(u.nameKey).padEnd(10)} ${String(u.dmg).padStart(9)}  ${pct(u.share).padStart(6)}  次数 ${String(u.casts).padStart(3)}  歼敌 ${String(u.kills).padStart(6)}  对 Boss ${String(u.bossDmg).padStart(6)}`)
  // 布防：晶能收支、装置贡献（每晶能伤害 = 伤害 ÷ 花在这种装置上的晶能）、电网
  const en = r.energy
  console.log(`布防  放置 ${r.devices.placedTotal} 个（终局在场 ${r.devices.standing}）   晶能 收入 ${en.earned}（击杀 ${en.kill} / 采集器 ${en.collector} / 返还 ${en.refund} / 门 ${en.gate}）  支出 ${en.spent}  结余 ${en.now}   电网 用掉 ${r.fencesUsed} 道（${r.fences.map(f => (f ? '■' : '□')).join('')}）`)
  if (r.deviceReport.length) console.log('装置贡献  装置 / 伤害 / 占比 / 放置 / 损毁 / 铲除 / 花费 / 歼敌 / 对 Boss / 每晶能伤害')
  for (const d of r.deviceReport) console.log(`  ${t(d.nameKey).padEnd(10)} ${String(d.dmg).padStart(9)}  ${pct(d.share).padStart(6)}  放 ${String(d.placed).padStart(2)}  毁 ${String(d.lost).padStart(2)}  铲 ${String(d.removed).padStart(2)}  花费 ${String(d.spent).padStart(5)}  歼敌 ${String(d.kills).padStart(6)}  对 Boss ${String(d.bossDmg).padStart(6)}  ${d.spent > 0 ? d.dmgPerEnergy.toFixed(1) : '-'}`)
  const locked = Object.keys(DEVICES).filter(k => !run.world._dev.unlocked[k])
  console.log(`装置解锁  ${Object.keys(DEVICES).filter(k => run.world._dev.unlocked[k]).map(k => t(DEVICES[k].nameKey)).join(' / ')}${locked.length ? '   未解锁: ' + locked.map(k => t(DEVICES[k].nameKey)).join(' / ') : ''}`)
  for (const sq of r.roster) console.log(`英雄级小队「${t(sq.squadName)}」（${t(UNITS[sq.unit].nameKey)}）：${sq.alive} 人在列 / ${sq.fallen} 人未归`)
  if (r.unlocks.length) console.log(`解锁条件达成  ${r.unlocks.map(id => t(`unlock.${id}.name`)).join(' / ')}`)
  const every = r.layers.length ? 30 : 20
  console.log(`时间线（每 ${every} 秒）  t / 兵力 / 在场敌人 / 歼敌速度 / 累计击杀 / 防线 / 等级 / 装置数 / 晶能`)
  const last = r.timeline[r.timeline.length - 1]
  for (const s of r.timeline) {
    if (s.t % every === 0 || s === last) console.log(`  ${String(s.t).padStart(3)}s  ${String(s.troops).padStart(3)}  ${String(s.enemies).padStart(5)}  ${String(s.killRate).padStart(4)}/s  ${String(s.kills).padStart(6)}  ${String(s.line).padStart(5)}  Lv${String(s.level).padEnd(2)}  装置 ${String(s.devices).padStart(2)}  晶能 ${String(s.energy).padStart(4)}`)
  }
  if (args.verbose) {
    console.log('每秒时间线')
    for (const s of r.timeline) console.log(`  ${String(s.t).padStart(3)}s  兵力 ${String(s.troops).padStart(3)}  敌 ${String(s.enemies).padStart(5)}  ${String(s.killRate).padStart(4)}/s  杀 ${String(s.kills).padStart(6)}  线 ${s.line}  Lv${s.level}  装置 ${s.devices}  晶能 ${s.energy}`)
    console.log('事件计数  ' + Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('  '))
    if (r.fallen.length) console.log(`阵亡 ${r.fallen.length} 人，首个阵亡于 ${r.fallen[0].t}s`)
  }
  console.log(`模拟耗时  ${run.steps} 步   平均 ${run.avgMs.toFixed(3)} ms/步   最慢 ${run.maxMs.toFixed(2)} ms   事件 ${run.events} 条`)
  if (run.badEvent) console.log(`!! 事件字段异常: step ${run.badEvent.step} ${run.badEvent.event.type}.${run.badEvent.field}`)
}
process.exitCode = r.outcome === 'won' || r.outcome === 'retreated' ? 0 : 1
