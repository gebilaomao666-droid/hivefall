// 无尽模式。设计见 docs/GDD.md §8，量级见 docs/ref/systems-report.md §8。行为在 src/sim/endless.js。
// 层号从 1 起算：第 1 层 = 战役结束后原地续打的第一段，各项成长系数都是 1。
import { ENEMIES } from './enemies.js'

export const ENDLESS = {
  layerLen: 30, shrinkFrom: 10, shrink: 0.92, minLen: 18,   // 每层 30 秒；第 10 层之后每层 ×0.92，最短 18 秒
  firstDelay: 4,                                            // 第 1 层多给 4 秒喘息
  // 敌血前陡后缓：每层 ×1.25，第 9 层之后 ×1.05。原先一路 ×1.12：前 13 层零损失，然后两层之内团灭（悬崖）；
  // 现在第 8 层起每层掉几个人，第 12 层起吃紧，标准小队 14~16 层倒下（波次拉长之后，见下面 waves 的注释）
  // 第 2 轮测试：前 7 层还是零损失、满编平推（「打到第 5 层也没有一次有输的感觉」）。改成起点高、坡度缓：
  // 敌血第 1 层就 ×1.8（甲壳兽扛得到射程里，见 data/enemies.js 的 onMove），之后每层 ×1.1，第 9 层 ≈ 3.86（原 5.96），再往后 ×1.05；
  // 敌人伤害第 1 层 ×2、之后每层 ×1.03（原 1 起、×1.08）。配合每层开头补 relief 个人：每层都掉几个、也补得回来，
  // 标准小队前 7 层每层损失 1~6 人、兵力在 62~72 之间来回，14 层上下倒下
  hpStart: 1.8, hpMul: 1.1, hpLateFrom: 9, hpMulLate: 1.05,
  countMul: 1.06, dmgStart: 2, dmgMul: 1.03, armorAdd: 0.1,
  relief: 6,                                                // 每层（第 2 层起）开头补这么多突击兵（按编制上限，满了就不补）
  // 兵力保底：测试实机无尽里在列兵力 32 → 33 → 19，越打越少，和参考游戏第 8 层 74 步兵 + 9 重装的「大军」正好相反。
  // 每层开头步兵补到 floor = base + per × 层号（第 2 层 42、第 4 层 48、第 8 层 60），一次最多补 max 人，至少补 relief 人；
  // 偶数层再按编制空投一台重型（按层号轮换种类，不消耗随机数）。死得多的一局也被拉回「越打越壮」的曲线上，输赢交给敌人成长
  reliefFloor: { base: 36, per: 3, max: 14 },
  reliefHeavyEvery: 2,
  powerMul: 1.1,                                            // 指挥官技能 / 伙伴的伤害每层 ×1.1
  elite: { from: 4, per: 0.02, max: 0.25 },
  // 测试：无尽每层同屏只有 440~640 只、第 2 层画面偏空（参考游戏是上千只的虫海）。
  // 裂爪虫（虫海主体）数量 × density、单只血量 ÷ density：总血量不变 = 火力要求不变，同屏密度翻倍多
  density: 2.2,
  trickle: 9,                                               // 涓流（只 / 秒），再乘数量系数
  // 每层 3 波（层内秒，按 30 秒一层写；层变短时等比压缩）。ling 是纯虫海配比下的裂爪虫数
  // dur（一波放完要几秒）原先是 2.4 / 2.6 / 3：一千多只两三秒涌完、三秒打光，接着六七秒桥上是空的——实机里一半以上的时间歼敌速度不到 40 / 秒。
  // 拉到 6 / 6.5 / 7 之后三波基本首尾相接（空档 55% → 20%），总数不变；代价是峰值密度低一些，标准小队比原先多走约 2 层（12~14 → 14~16，仍在 test-endless ⑫ 的区间里）
  waves: [
    { at: 2, ling: 1520, dur: 6 },
    { at: 11, ling: 1680, dur: 6.5 },
    { at: 21, ling: 2000, dur: 7, herald: true },
  ],
  // 每波附带的其他虫（第 1 层、配比系数 1 时）
  // crusher 8 → 14（各配比都带一队甲壳兽，每层都有人要掉；armored 的倍率相应从 2.6 压到 1.4，免得「重甲层」一层崩盘）
  extras: { burster: 10, spitter: 4, crusher: 14, hulk: 1, wing: 8, digger: 2, warden: 1, shieldbug: 3, leaper: 12 },
  heraldLead: 3,
  gateAt: 25,                                               // 每层一道门
  bossEvery: 3, bossAt: 12, bossHpGrowth: 1.3,
  bossReward: { line: 150, rerolls: 1 },                    // 另外：直接升一级，下一道门变悬赏门
  mutatorLayers: [2, 5, 8],
  themeEvery: 5,
  vanguardLayer: 10, vanguardStrikes: 12,
  fourCardsFrom: 16,
  companionLayer: 5,
  gift: { unit: 'rifle', count: 4 },                        // 进入无尽：补 4 名突击兵并全队回血
  contractEvery: 2,                                         // 每 2 道门有一道带合同
  deviceGate: 0.4,                                          // 还有装置没解锁时，属性门换成装置门的概率
}

// 环境主题 id 与渲染层 render/themes.js 的 THEMES 对应
export const THEMES = ['ash', 'night', 'hive']
export const themeAt = n => THEMES[(((n - 1) / ENDLESS.themeEvery) | 0) % THEMES.length]

export function layerLenAt(n) {
  const E = ENDLESS
  if (n <= E.shrinkFrom) return E.layerLen
  return Math.max(E.minLen, E.layerLen * Math.pow(E.shrink, n - E.shrinkFrom))
}

// 第 n 层的成长系数。测试与 UI（「敌人生命 +57%」）都读这一个函数。
export function layerScale(n) {
  const E = ENDLESS, k = n - 1
  const early = Math.min(k, E.hpLateFrom - 1), late = Math.max(0, k - (E.hpLateFrom - 1))
  return {
    hp: (E.hpStart ?? 1) * Math.pow(E.hpMul, early) * Math.pow(E.hpMulLate, late),
    count: Math.pow(E.countMul, k),
    dmg: (E.dmgStart ?? 1) * Math.pow(E.dmgMul, k),
    armor: E.armorAdd * k,
    power: Math.pow(E.powerMul, k),
    elite: n >= E.elite.from ? Math.min(E.elite.max, E.elite.per * (n - E.elite.from + 1)) : 0,
  }
}

// 编制上限：步兵 64 起，第 3 层后每层 +2，封顶 96；炮兵 6 起每 3 层 +1 封顶 9；重型 3 起每 2 层 +1 封顶 9
export function capsAt(n) {
  const third = (n / 3) | 0
  return {
    infantry: Math.min(96, 64 + 2 * Math.max(0, n - 3)),
    artillery: Math.min(9, 6 + third),
    heavy: Math.min(9, 3 + ((n / 2) | 0)),     // 每 3 层 +1、封顶 8 → 每 2 层 +1、封顶 9（参考第 8 层 9 台重装）
    hero: 1,
  }
}

// 波次配比，按层号轮换。ling 是裂爪虫倍率，其余是 extras 的倍率（没写的按 rest）。
// 非纯虫海配比的裂爪虫倍率抬到 0.85~0.9：测试实机第 2 层甲壳阵（0.5）场上只剩两百来只、歼敌 28/秒，画面空。
// 甲壳阵的「重」靠甲壳兽 / 巨畸体 / 护巢虫体现，不靠把虫海抽空
export const MIXES = {
  swarm: { id: 'swarm', ling: 1, rest: 0.5, crusher: 0.8 },
  armored: { id: 'armored', ling: 0.85, rest: 0.6, crusher: 1.4, hulk: 2.6, warden: 2 },
  den: { id: 'den', ling: 0.9, rest: 0.6, spitter: 2.4, warden: 1.5 },
  tide: { id: 'tide', ling: 0.9, rest: 0.6, burster: 2.2 },
  air: { id: 'air', ling: 0.85, rest: 0.6, wing: 3 },
  burrow: { id: 'burrow', ling: 0.85, rest: 0.6, digger: 3 },
}
export const MIX_ORDER = ['swarm', 'armored', 'den', 'tide', 'air', 'burrow']
export const mixAt = n => MIX_ORDER[(n - 1) % MIX_ORDER.length]
for (const m of Object.values(MIXES)) m.nameKey = `herald.deep.${m.id}`

// 第 n 层第 w 波的构成：{ ling, burster, ..., dur }
export function waveAt(n, w) {
  const def = ENDLESS.waves[w], mix = MIXES[mixAt(n)], c = layerScale(n).count
  const out = { ling: Math.round(def.ling * mix.ling * c * (ENDLESS.density || 1)), dur: def.dur }
  for (const k in ENDLESS.extras) {
    const count = Math.round(ENDLESS.extras[k] * (mix[k] ?? mix.rest) * c)
    // 同种虫的在场上限（data/enemies.js 的 cap）之上再多也出不来，预告里就别写了
    out[k] = Math.min(count, ENEMIES[k].cap)
  }
  return out
}

// Boss 轮换：战役是 ravager，无尽第 3 层接 matriarch，之后 leviathan → ravager → …
export const BOSS_ORDER = ['ravager', 'matriarch', 'leviathan']
export const bossAt = n => (n % ENDLESS.bossEvery === 0 ? BOSS_ORDER[(n / ENDLESS.bossEvery) % BOSS_ORDER.length] : null)
export const bossHpMulAt = n => Math.pow(ENDLESS.bossHpGrowth, n / ENDLESS.bossEvery)

// ---- 无尽的门 ----
// 随机草稿的权重（systems-report §4.2）。fallen: 曾阵亡的重型更容易再刷出来
export const GATE_DRAFT = { infantry: 4, reinforce: 2, reinforceFrom: 5, front: 1.2, artilleryEarly: 1.8, artillery: 1.2, earlyUntil: 5, heavy: 0.6, heavyFallen: 1.8 }

// 属性门。cost: true 的是「有代价的选择」，和无代价的小增益混着出；bounty: 悬赏门专用。
//   dmg / rate   全军伤害 / 射速的加成（小数，可负）
//   hp           全员最大生命 ±n
//   lineMaxMul   防线上限按比例变；lineMax 按点数变；lineHeal 修防线；line 直接扣防线当前值
//   heal         全队回满
export const BOONS = {
  overload: { id: 'overload', cost: true, dmg: 0.12, lineMaxMul: -0.10 },
  march: { id: 'march', cost: true, rate: 0.08, hp: -1 },
  glass: { id: 'glass', cost: true, dmg: 0.18, hp: -2 },
  bunker: { id: 'bunker', cost: true, lineMax: 200, lineHeal: 200, rate: -0.04 },
  transfusion: { id: 'transfusion', cost: true, hp: 3, heal: true, line: -120 },
  tune: { id: 'tune', dmg: 0.04 },
  drill: { id: 'drill', rate: 0.03 },
  patch: { id: 'patch', lineHeal: 120 },
  plating: { id: 'plating', hp: 1, heal: true },
  bounty_arms: { id: 'bounty_arms', bounty: true, dmg: 0.10, rate: 0.05 },
  bounty_wall: { id: 'bounty_wall', bounty: true, lineMax: 150, lineHeal: 9999, hp: 2, heal: true },
}
for (const b of Object.values(BOONS)) { b.nameKey = `boon.${b.id}.name`; b.descKey = `boon.${b.id}.desc` }
export const BOON_COST_CHANCE = 0.6
export const BOONS_COST = Object.values(BOONS).filter(b => b.cost).map(b => b.id)
export const BOONS_FREE = Object.values(BOONS).filter(b => !b.cost && !b.bounty).map(b => b.id)
export const BOONS_BOUNTY = Object.values(BOONS).filter(b => b.bounty).map(b => b.id)
export const BOUNTY_INFANTRY = 14     // 悬赏门的兵源选项：一次补这么多突击兵并全队回血

// 第 10 层「盟军先遣队」的轨道轰炸
export const VANGUARD = { id: 'ally_orbital', at: 4.5, dmg: 160, bossDmg: 300, r: 3, maxTargets: 50, delay: 0.7, stagger: 0.18, choices: 3 }
