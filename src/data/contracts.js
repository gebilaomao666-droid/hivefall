// 雇佣兵合同。设计见 docs/GDD.md §4。
// 过门选中合同后，空投舱砸在阵前并沿桥面往防线滑：集火打破才到手，滑过防线就作废。
// 舱体本身的血量 / 滑行速度在 data/enemies.js 的 pod（它借用虫群槽位，好让所有武器都能打它）。

export const POD = { landZ: -5, delay: 0.7, xMax: 4.2, r: 1.6 }

// elite: 交给 addUnits 的精英参数。force: 不受编制上限限制（歌利亚）。
export const CONTRACTS = {
  bloodhound: { id: 'bloodhound', unit: 'rifle', count: 6, minRoom: 3, elite: { id: 'bloodhound', dmgMul: 1.6, rateMul: 1.25, hpMul: 2, scale: 1.15 } },
  hammer: { id: 'hammer', unit: 'mortar', count: 1, minRoom: 1, elite: { id: 'hammer', dmgMul: 2.2, rateMul: 1.4, hpMul: 1.5, scale: 1.2 } },
  goliath: { id: 'goliath', unit: 'titan', count: 1, minRoom: 0, force: true, elite: { id: 'goliath', dmgMul: 3.5, rateMul: 1, hpMul: 4, scale: 1.6 } },
}
for (const c of Object.values(CONTRACTS)) { c.nameKey = `contract.${c.id}.name`; c.descKey = `contract.${c.id}.desc` }

// 出现在第 9 或第 10 道门（下标 8 / 9，按种子二选一），顶替那道门的常规项；歌利亚每局最多一台
export const CONTRACT_GATES = [8, 9]
export const GOLIATH_CHANCE = 0.05
