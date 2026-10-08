// 解锁项。test(result) 只看这一局的结算；存档里的去重与「新解锁」由 core/save.js 处理。
// 第一次通关战役一口气开放：无尽、三位指挥官、突变因子、老兵难度、随机草稿、每日挑战。
const won = r => r.campaignWon === true

export const UNLOCKS = {
  endless: { id: 'endless', test: won },
  commanders: { id: 'commanders', test: won },
  mutators: { id: 'mutators', test: won },
  veteran: { id: 'veteran', test: won },
  draft: { id: 'draft', test: won },
  daily: { id: 'daily', test: won },
  companion: { id: 'companion', test: r => r.layer >= 5 },
}
for (const u of Object.values(UNLOCKS)) { u.nameKey = `unlock.${u.id}.name`; u.descKey = `unlock.${u.id}.desc` }

export const UNLOCK_IDS = Object.keys(UNLOCKS)

export function unlocksFor(result) {
  const out = []
  for (const id of UNLOCK_IDS) if (UNLOCKS[id].test(result)) out.push(id)
  return out
}
