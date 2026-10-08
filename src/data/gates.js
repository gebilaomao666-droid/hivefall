// 增援门。固定剧本见 docs/GDD.md §4。

export const GATE = {
  // 实际秒。第 1 轮测试后重排：前期每 6 秒一道（参考游戏约 6 秒一道、40 秒 50 多人），后期 8~9 秒一道；
  // 不再跟着时间轴系数整体拉伸——门的节奏决定了「滚雪球」的手感，单独调
  // 第 3 轮测试：前 8 道 5.1 秒一道（第 8 道 37.7 秒出、40 秒前过门），硬指标「40 秒兵力 ≥ 50」；最后一道 65 秒，Boss（72 秒）之前全部过完
  // 第 4 轮测试（用户实玩：「门来得太快，还没反应过来就被迫选了」）：门在路上的时长 2.0 → 约 3.75 秒（速度 10.7 → 5.7），
  // **结算时刻不变**（resolve = 旧表的出现时刻 + 2 秒），出现时刻跟着提前 1.75 秒。
  // 公测反馈（用户实玩：「门有点慢了，开局怪都到脸上了门才过来」）：5.7 → 7.6，在路上约 2.8 秒；比开局小虫的推进速度（约 6.3）快，不会被虫超过。
  // 前期 5.1 秒一道：上一道结算后 1.35 秒下一道才出，同一时刻最多一组门在场
  resolve: [4, 9.1, 14.2, 19.3, 24.4, 29.5, 34.6, 39.7, 46, 52.5, 59.5, 67],
  spawnZ: -13, speed: 7.6, resolveZ: 8.4,
  endlessSpeed: 10.7,          // 无尽的门不跟着放慢：每层 18~30 秒、门在第 25 × k 秒出，慢门会拖过层末（见 data/endless.js gateAt）
  milestone: [3, 6, 9],
}
// 战役的门从出现到结算的秒数（约 3.75）
export const GATE_TRAVEL = (GATE.resolveZ - GATE.spawnZ) / GATE.speed
// 出现时刻（实际秒）= 结算时刻 − 路上的时长；导演按它出门
GATE.times = GATE.resolve.map(t => Math.round((t - GATE_TRAVEL) * 100) / 100)

// plan = 计划项，alt = 常规项。第 0 门固定左步兵、右 opener；其余偶数门计划项在右、奇数门在左。
// 一直站同一边拿不到全套，逼玩家看门。
export const GATE_SCRIPT = [
  { plan: 'infantry', alt: 'opener' },
  { plan: 'artillery', alt: 'infantry' },
  { plan: 'infantry', alt: 'device', altFallback: 'front' },     // 装置门（GDD §13）：解锁下一种装置 + 一笔晶能；都解锁了就退回 altFallback
  { plan: 'front', alt: 'infantry' },
  { plan: 'infantry', alt: 'artillery' },
  { plan: 'heavy', alt: 'infantry' },
  { plan: 'heavy', alt: 'device', altFallback: 'front' },
  { plan: 'heavy', alt: 'infantry' },
  { plan: 'infantry', alt: 'artillery' },
  { plan: 'reinforce', alt: 'infantry' },
  { plan: 'infantry', alt: 'front' },
  { plan: 'reinforce', alt: 'artillery' },
]

// 重型门附带的护卫人数（突击兵）。第 1 轮测试 4 → 6：门提前、步兵门人数加了之后，重型路线终局少十几个步兵，损失比堆步兵多一截
export const HEAVY_ESCORT = 6

// 每道门的人数：前 3 道 / 第 4~7 道 / 之后。第 1 轮测试后前期加量：40 秒要到 35~50 人；第 3 轮再加（6/8 → 8/10，前线 3/4 → 4/5）：40 秒 50 人以上
export function gateCounts(idx) {
  const tier = idx <= 2 ? 0 : idx <= 6 ? 1 : 2
  const bonus = GATE.milestone.includes(idx) ? 2 : 0
  return { infantry: [8, 10, 10][tier] + bonus, front: [4, 5, 5][tier] + bonus, escort: [3, 4, 4][tier], heavyEscort: HEAVY_ESCORT }
}

export const GATE_UNITS = { infantry: 'rifle', front: 'flamer', artillery: 'mortar' }

// ---- 门的公平（第 1 轮测试：「合同: 重锤自行炮」对「+1 突击兵」、「+1 泰坦」对「+8 突击兵」）----
// 选项估值，单位 = 一名突击兵。兵种按「单台战力 ÷ 突击兵」粗估（战报里的人均伤害与承伤），
// 只算真正进得了编制的人数（capRoom 之后）。左右两项估值之比低于 FAIR_RATIO 的，弱的那一边换成别的项重出。
export const UNIT_VALUE = { rifle: 1, flamer: 1.3, mortar: 5, titan: 7, lancer: 6.5, reaper: 7, psion: 6.5, skyhook: 6 }
export const OPTION_VALUE = {
  contract: { bloodhound: 13, hammer: 12, goliath: 26 },
  device: 8.5,            // 解锁一种装置 + 75 晶能（和重型门 +1 台 +6 护卫的 12.5 比，刚好过 0.6 那条线）
  healBase: 2,            // 补员门：人数之外，全队回血本身值这么多
  healMissing: 0.4,       // …再加上「已损失生命比例 × 全队估值 × 这个系数」
  moduleShare: 0.12,      // 配发模块 ≈ 那个兵种全体战力的 12%
  moduleMin: 3,
  durability: 3,
}
export const FAIR_RATIO = 0.6
// 弱的一边依次试这些项，取估值最接近强的一边、且比例达标的那个
export const FAIR_CANDIDATES = ['infantry', 'front', 'artillery', 'heavy', 'device', 'reinforce', 'module']
