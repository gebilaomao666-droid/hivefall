// 每日挑战：由日期字符串派生种子、指挥官、突变组合。同一个 dateKey 在任何机器上都得到同一局。
// 模拟层不碰时钟：dateKey（如 '2026-09-30'）由调用方给。
import { createRng } from '../core/rng.js'
import { hashStr } from '../core/util.js'
import { COMMANDER_IDS } from '../data/commanders.js'
import { MUTATOR_IDS } from '../data/mutators.js'

export function dailyConfig(dateKey) {
  const key = String(dateKey || 'unset')
  const seed = hashStr('hivefall.daily.' + key)
  const rng = createRng(seed).fork('daily')
  const commander = COMMANDER_IDS[rng.int(COMMANDER_IDS.length)]
  // 一到两个突变，不重复
  const pool = MUTATOR_IDS.slice()
  const mutators = []
  const n = rng() < 0.4 ? 2 : 1
  for (let k = 0; k < n; k++) mutators.push(pool.splice(rng.int(pool.length), 1)[0])
  return { dateKey: key, seed, commander, mutators, difficulty: 'normal' }
}
