// 调参用：多个种子各跑一局，一行一个结果，最后一行是汇总。
//   node tools/sweep.mjs --bot good|builder|idle|… --from 1 --to 10 [--difficulty veteran] [--commander hawk] [--mutators swift,undying] [--draft random] [--boss matriarch] [--endless 30]
//   --endless N：战役胜利后续打无尽，打完第 N 层撤离或中途阵亡（N 给大一点就是「打到倒下为止」，汇总里看平均层数）
// 平衡目标（断言在 test-core ⑥ / test-endless ⑫ / test-defense ⑪）：normal good 10/10 且击杀 ≥ 2 万、builder ≥ 9/10、idle ≥ 7/10 且有可见损失、veteran 明显更难、
// 随机草稿 good ≥8/10、heavy 不弱于 good、三位指挥官的无尽深度相差不超过 2 层。
import { runHeadless } from '../src/sim/bot.js'

const a = { bot: 'good', from: 1, to: 10, difficulty: 'normal', draft: 'script', commander: 'none', mutators: '', endless: 0, boss: undefined }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) a[argv[i].slice(2)] = argv[i + 1]

let wins = 0, loss = 0, leak = 0, layers = 0, kills = 0, placed = 0
const n = Number(a.to) - Number(a.from) + 1
for (let seed = Number(a.from); seed <= Number(a.to); seed++) {
  const { result: r, peakEnemies } = runHeadless({ seed, bot: a.bot, difficulty: a.difficulty, draft: a.draft, commander: a.commander, boss: a.boss, mutators: a.mutators.split(',').filter(Boolean), endless: Number(a.endless) })
  if (r.outcome === 'won' || r.outcome === 'retreated') wins++
  loss += r.losses; leak += r.leaked; layers += r.layer; kills += r.kills; placed += r.devices.placedTotal
  const at = t => r.timeline.find(s => s.t === t)
  const t70 = at(40)       // 第 1 轮测试：40 秒兵力（参考游戏 40 秒 55 人，目标 35~50）
  console.log(`seed ${String(seed).padStart(2)} ${a.bot.padEnd(6)} ${r.outcome.padEnd(4)} ${(r.reason || '').padEnd(7)} t=${String(r.seconds).padStart(6)} kills=${String(r.kills).padStart(5)} loss=${String(r.losses).padStart(2)} leak=${String(r.leaked).padStart(4)} line=${String(r.line.hp).padStart(4)} layer=${String(r.layer).padStart(2)} lv=${String(r.level).padStart(2)} peak=${String(r.peakKillRate).padStart(6)} troops40=${t70 ? t70.troops : '-'} end=${r.troops} field=${peakEnemies} combos=${r.combos.length} heroics=${r.heroics.length} devices=${r.devices.placedTotal} energy=${r.energy.now}/${r.energy.earned} fence=${r.fencesUsed}`)
}
const f1 = v => Math.round(v * 10) / 10
console.log(`${a.bot}: ${wins}/${n} 胜  平均击杀 ${Math.round(kills / n)}  平均损失 ${f1(loss / n)}  平均漏网 ${f1(leak / n)}  平均放置装置 ${f1(placed / n)}${Number(a.endless) > 0 ? `  平均层数 ${f1(layers / n)}` : ''}`)
