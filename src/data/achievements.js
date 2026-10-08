// 成就 / 勋章。纯展示，不加任何数值（保证榜单公平）。
// test(result, stats)：result = world.result()；stats = 存档里的累计统计（core/save.js 的 save.stats，已经并入这一局）。
// 只在对局结束（outcome 不是 'running'）时判定。
const ended = r => r.outcome !== 'running'
export const LONG_CHAIN = 12000       // 连杀按歼敌速度掉档之后，good bot 一局的最高连杀约 8500~14700（第 3 轮虫潮加厚，7000 → 12000，仍要打得好才够得着）
export const QUICK_WORK = 88          // 第 3 轮：Boss 72 秒出场，88 秒内打倒 = Boss 战 16 秒以内（good bot 19~22 秒）
const count = (obj, pred) => Object.keys(obj).filter(pred).length

export const ACHIEVEMENTS = [
  // ---- 战役 ----
  { id: 'first_bridge', test: r => r.campaignWon },
  { id: 'clean_sheet', test: r => r.campaignWon && r.mode === 'campaign' && r.losses === 0 },
  { id: 'sealed_line', test: r => r.campaignWon && r.mode === 'campaign' && r.leaked === 0 },
  { id: 'veteran_pass', test: r => r.campaignWon && r.difficulty === 'veteran' },
  { id: 'quick_work', test: r => r.campaignWon && r.campaignSeconds !== null && r.campaignSeconds <= QUICK_WORK },
  { id: 'mutant_handler', test: r => r.campaignWon && r.mode === 'campaign' && r.mutators.length >= 2 },
  { id: 'all_weather', test: r => r.campaignWon && r.mode === 'campaign' && r.mutators.length >= 4 },
  // ---- 编成与成长 ----
  { id: 'combo_trio', test: r => r.combos.length >= 3 },
  { id: 'named_squad', test: r => r.heroics.length >= 1 },
  { id: 'double_heroic', test: r => r.heroics.length >= 2 },
  { id: 'everyone_home', test: r => ended(r) && r.roster.length > 0 && r.roster.every(s => s.members.length > 0 && s.fallen === 0) },
  { id: 'paid_in_full', test: r => !!r.contract && r.contract.state === 'open' },
  { id: 'goliath_online', test: r => !!r.contract && r.contract.state === 'open' && r.contract.id === 'goliath' },
  { id: 'full_hangar', test: r => count(r.deployed, k => ['titan', 'lancer', 'reaper', 'psion', 'skyhook'].includes(k) && r.deployed[k] > 0) >= 4 },
  // ---- 手感 ----
  { id: 'meat_grinder', test: r => r.peakKillRate >= 700 },
  // 连杀按歼敌速度掉档（sim/stats.js），整局一次都没暂停过才算
  { id: 'long_chain', test: r => r.maxCombo >= LONG_CHAIN && r.pauses === 0 },
  // ---- 无尽 ----
  { id: 'deep_five', test: r => r.layer >= 5 },
  { id: 'deep_ten', test: r => r.layer >= 10 },
  { id: 'deep_sixteen', test: r => r.layer >= 16 },
  { id: 'three_heads', test: r => r.bossKills >= 4 },
  { id: 'fine_print', test: r => r.boons.filter(id => ['overload', 'march', 'glass', 'bunker', 'transfusion'].includes(id)).length >= 3 },
  { id: 'seven_awake', test: r => !!r.companion && r.companion.stage >= 3 },
  // ---- 累计 ----
  { id: 'million', test: (r, s) => s.kills >= 1000000 },
  { id: 'regular', test: (r, s) => s.runs >= 25 },
  { id: 'roll_call', test: (r, s) => ['hawk', 'ysera', 'joe'].every(c => (s.winsBy[c] || 0) > 0) },
  { id: 'week_streak', test: (r, s) => s.dailyDays >= 7 },
]
for (const a of ACHIEVEMENTS) { a.nameKey = `ach.${a.id}.name`; a.descKey = `ach.${a.id}.desc` }

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map(a => a.id)

// 这一局（加上累计统计）满足了哪些成就。返回 id 数组；是否「新获得」由存档去重。
export function achievementsFor(result, stats) {
  const out = []
  for (const a of ACHIEVEMENTS) if (a.test(result, stats) === true) out.push(a.id)
  return out
}
