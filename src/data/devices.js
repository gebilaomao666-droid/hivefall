// 布防系统（GDD §13）：车道、格子、晶能、装置、应急电网。行为在 src/sim/devices.js 与 src/sim/swarm.js。
// 数字与渲染层 render/env.js 的 LANES 是同一套（5 道 × 4 排，道宽 2.56，格深 3）。

export const LANE = { count: 5, width: 2.56, centers: [-5.12, -2.56, 0, 2.56, 5.12] }
// row 0 最靠近队伍（z = 4.5），row 3 最靠前（z = -4.5）
export const GRID = { lanes: 5, rows: 4, rowZ: [4.5, 1.5, -1.5, -4.5], depth: 3 }

const X0 = -LANE.width * LANE.count / 2, INV_W = 1 / LANE.width
/** x 坐标落在哪条车道（0..4） */
export const laneOf = x => { const l = ((x - X0) * INV_W) | 0; return x <= X0 ? 0 : l >= LANE.count ? LANE.count - 1 : l }

// 虫在车道里的走法（叠加在原有「追人」逻辑上）：
//   到 chaseZ 之前沿本道走（出了本道的带子就往回收）；过了 chaseZ，横向目标 = 本道中心 ± 个体散布 与 队伍位置 按 laneMix : chaseMix 混合
export const LANE_MOVE = { laneMix: 0.65, chaseMix: 0.35, scatter: 1.0, band: 1.18 }

// 晶能。击杀掉落直接入账：裂爪虫 ling 点，其余按经验值 × perXp，精英 × eliteMul。
// 原设想是 0.15 / ×0.5：一局两万多杀会进账四千多，后半程钱花不完（20 格早铺满了）；压到现值后全局总收入约 2500~3000，
// 能放 12~20 个装置，钱始终是紧的。
export const ENERGY = {
  start: 100, max: 9999,
  ling: 0.008, perXp: 0.035, eliteMul: 2.5,
  removeRefund: 0.25,      // 铲除自己的装置：返还花费的 25%
  eventMin: 1,             // 零碎掉落攒够这么多才发一条 energy 事件（大块的每次都发）
}

// 应急电网：每条车道尽头一道。虫冲到 z 处触发，清空该道所有非 Boss 敌人。无尽每 refillEvery 层补满。
// 零星小虫不值一道电网（第 3 轮试玩：开局 6~10 秒就有一只裂爪虫溜过边路、把那道电网白白烧掉）：
//   冲到尽头的是小虫（非 big、leak < smallLeak），且这一道上（整条道，电网放电清的就是整条道）的活虫不到 crowd 只——
//   电网不放电，让它漏过去扣防线（裂爪虫只扣 1）。个头大的、或者这一道真压着一股虫，照旧放电清道。
export const FENCE = { z: 16.5, refillEvery: 5, crowd: 10, smallLeak: 4 }

// 阻挡与啃咬：虫走到装置前 gap 处停下。小虫（裂爪虫这类）同时只有 slots 只咬得到——其余的在后面排队，
// 队伍纵深 = 被挡住的虫数 × queuePer（上限 queueMax）；个头大的（ENEMIES[kind].big）不占名额。
// 每只每 every 秒咬一口，伤害见 ENEMIES[kind].bite；脓爆虫碰到装置即爆，对装置伤害 × ENEMIES.burster.deviceMul。
export const BLOCK = { gap: 0.6, every: 0.8, slots: 16, reach: 1.1, queuePer: 0.016, queueMin: 0.5, queueMax: 5.5 }
// 跳跃虫：遇到第一个装置时跃过去（每只一次）。dur 秒的抛物线，落在装置身后 land 处；空中 y > 0，只有对空武器打得到
export const LEAP = { dur: 0.5, y: 2.2, land: 0.7 }
// Boss 碾碎装置的半径余量
export const CRUSH_PAD = 0.9

export const DEVICE_KINDS = ['collector', 'sentry', 'barricade', 'mine', 'cryo', 'scorcher', 'mortarpit', 'nova']
export const DEVICE_START = ['collector', 'sentry', 'barricade', 'mine']
// 其余的靠增援门 / 升级卡解锁，每次解锁「下一个还没有的」
export const DEVICE_UNLOCK_ORDER = ['cryo', 'mortarpit', 'scorcher', 'nova']
export const GATE_DEVICE_ENERGY = 75     // 装置门附送的晶能

// cost 花费 / cd 卡牌冷却 / hp 生命（0 = 一次性装置，不挡路也不会被咬）/ armor 护甲（减法，每口至少 0.5）
export const DEVICES = {
  // 采集器：每 every 秒产 amount 晶能
  // 第 1 轮测试把一局压到约 120 秒：采集器 5 秒 15 → 5 秒 20，晶能总收入跟着局长缩水的那一截补回来（装置占总伤害掉到 7%）
  collector: { id: 'collector', cost: 50, cd: 6, hp: 30, armor: 0, blocks: true, every: 5, amount: 20 },
  // 哨戒机枪塔：本道直射，射程到道尽头，可对空。pierce = 子弹沿本道再穿几只
  // 生命 40 → 70（第 1 轮测试：甲壳兽隔着路障也会打过来、局又短了，塔没打几轮就被啃掉，装置占总伤害掉到 7.9%）
  sentry: { id: 'sentry', cost: 100, cd: 6, hp: 70, armor: 0, blocks: true, dmg: 6, bossDmg: 6, interval: 0.2, pierce: 1, antiAir: true },
  // 合金路障：挡路
  barricade: { id: 'barricade', cost: 50, cd: 20, hp: 400, armor: 1, blocks: true },
  // 感应地雷：放下 arm 秒后武装；trigger 半径内凑够 crowd 只地面虫、或者踩上来一只大个头的（ENEMIES[kind].big / Boss）就炸；一次性。
  // 不是「首只踩上的虫」：这游戏里一只裂爪虫不值一颗雷，零星的涓流会把雷白白骗掉
  mine: { id: 'mine', cost: 20, cd: 18, hp: 0, armor: 0, blocks: false, arm: 6, trigger: 1.6, crowd: 12, r: 3.4, dmg: 400, bossDmg: 400, maxTargets: 60 },
  // 冷凝塔：本道直射，命中点 splash 半径内减速 slow 持续 slowDur 秒
  cryo: { id: 'cryo', cost: 175, cd: 8, hp: 40, armor: 0, blocks: true, dmg: 6, bossDmg: 6, interval: 0.35, slow: 0.5, slowDur: 3, splash: 1.7, maxTargets: 8 },
  // 喷火陷阱：所在这一排、左右各 side 道（3 × 1 格），每 interval 秒烧一次，无视护甲。是埋在桥面上的陷阱：不挡路，虫从上面踩过去，也啃不到它
  scorcher: { id: 'scorcher', cost: 125, cd: 10, hp: 60, armor: 0, blocks: false, dmg: 4, bossDmg: 4, interval: 0.3, side: 1, maxTargets: 7 },
  // 迫击炮台：打本道最靠前之外的密集处
  // 第 1 轮测试：局短了，它的每晶能伤害垫底（比聚变炸弹低 2.5 倍以上）：花费 225 → 200、间隔 2.2 → 1.7 秒
  mortarpit: { id: 'mortarpit', cost: 200, cd: 12, hp: 50, armor: 0, blocks: true, dmg: 55, bossDmg: 110, interval: 1.7, r: 2.4, maxTargets: 30, minRange: 3 },
  // 聚变炸弹：放下 fuse 秒后爆炸，3 × 3 格；一次性
  // 花费 50 → 75（第 1 轮测试：局短了、虫海更密，一颗炸弹的每晶能伤害冲到迫击炮台的 3 倍）
  nova: { id: 'nova', cost: 75, cd: 45, hp: 0, armor: 0, blocks: false, fuse: 1.2, dmg: 2500, bossDmg: 1000, side: 1, rows: 1 },
}
for (const d of Object.values(DEVICES)) { d.nameKey = `device.${d.id}.name`; d.descKey = `device.${d.id}.desc` }

// 升级卡（data/modules.js 里 device 开头的那几张）聚合进 world.mods.device
export const DEVICE_MOD_DEFAULTS = {
  costMul: 1,            // 「工程兵」：全部装置花费
  sentryRate: 1, sentryPierce: 0,
  collectorAdd: 0,       // 采集器每次多产
  thorns: 0,             // 路障反伤：咬它的虫每口受这么多伤害
  mineChain: 0,          // 地雷连环引爆：再炸几次
  cryoFreeze: 0,         // 冷凝塔每第 N 发把非重甲目标冻住
}
export const MINE_CHAIN = { delay: 0.35, step: 2.6, dmgMul: 0.7 }     // 连环引爆：沿本道往上游每隔 step 再炸一次
export const CRYO_FREEZE = { every: 4, dur: 1.0 }
export const COST_MUL_MIN = 0.5     // 折扣叠得再多，花费也不低于原价的这个比例
