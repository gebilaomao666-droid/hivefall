// 突变因子。设计见 docs/GDD.md §7。行为在 src/sim/mutators.js。
// 战役里开局自选，拿到第 (突变数 + 1) 个升级后才一起生效，给玩家留缓冲。

export const MUTATORS = {
  // 疾行：敌人移速 ×speedMul
  swift: { id: 'swift', speedMul: 1.2 },
  // 甲壳共振：第一次受伤（且没死）时获得 frac × 最大生命的护盾，持续 dur 秒
  resonance: { id: 'resonance', frac: 0.35, dur: 3 },
  // 不死孢子：chance 的敌人死后 delay 秒原地复活一次（卵和 Boss 除外）。复活的那只再被打死不计击杀、不给经验
  undying: { id: 'undying', chance: 0.25, delay: 0.9 },
  // 酸雨：每 every 秒落 drops 团酸。一团对准队伍当前位置，其余随机；预警圈 warn 秒，落地后留 pool 秒酸池
  acidrain: { id: 'acidrain', first: 4, every: 10, drops: 3, warn: 1.5, r: 1.7, dmg: 3, pool: 2, tick: 0.5, tickDmg: 1, xMax: 5.4, minGap: 3.6, dz: 1.2 },
}
for (const m of Object.values(MUTATORS)) { m.nameKey = `mutator.${m.id}.name`; m.descKey = `mutator.${m.id}.desc` }

export const MUTATOR_IDS = Object.keys(MUTATORS)
