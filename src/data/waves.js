// 战役时间轴（实际秒）。
// 第 4 轮测试（用户实玩：「开局来很多虫子，经验涨得飞快，没有渐进的感觉」）整张表重写成直接按实际秒排的渐进曲线：
//   0~15 秒   成军：涓流 2~4 只/秒，小波 20~55 只（用户实玩：前期太少，再多一点），只有裂爪虫——先熟悉移动、选门、放第一个装置
//   15~35 秒  小波逐步变大（80~260 只），仍只有裂爪虫
//   35~55 秒  成型：每 4 秒左右引入一种新虫，那一波以它为特色、带大波预告（herald.new.<种类>）：脓爆虫 → 刺脊虫 → 甲壳兽 → 翼螫
//   55 秒起   守线：大规模虫潮，掘地虫 / 巨畸体 / 护巢虫 / 举盾虫 / 跳跃虫依次登场，Boss（84 秒）前的「全线压上」是峰值（1728 只）
//   Boss 出场后三个大波，和上一版 Boss 出场后的三波同样的配比、同样的相对时刻
// 以前的「教学段 12/7 倍拉长 + 回声波 + 守线 / Boss 后倍率」那套换算全部去掉了，表里写的就是最终只数与时刻。
// 增援门不跟这张表走，单独排（data/gates.js 的 GATE.resolve）。
import { ENEMIES } from './enemies.js'

export const FIELD = { xEdge: 6.4, spawnZ: -21, lineZ: 17.2, spawnDepth: 3, chaseZ: 1.5, chaseSpeed: 1.8 }

// 「基准秒」只剩两处在用：虫随时间变厚（sim/swarm.js：age = 实际秒 ÷ CAMPAIGN_STRETCH，封顶 BASE_LEN）与 Boss 出场（基准 78 秒）。
// 第 3 轮 ×0.92（Boss 72 秒）；第 4 轮前期放缓、一局拉长到 105~115 秒，×1.08：Boss 84 秒出场，
// 同一个阶段（比如 Boss 出场那一刻）的虫和上一版一样厚，不因为局长了就多长一截血
export const CAMPAIGN_STRETCH = 1.08
export const BASE_LEN = 95
/** 基准秒 → 实际秒（保留一位小数） */
export const T = t => Math.round(t * CAMPAIGN_STRETCH * 10) / 10

// Boss 出场（基准 78 秒 → ×1.08 约 84 秒）。「守线」阶段到这里结束
export const BOSS_BASE = 78
export const BOSS_AT = Math.round(T(BOSS_BASE))                          // 84
// 战役时限 = Boss 出场 + BOSS_WINDOW（Boss 战设计时长 18~30 秒，老兵难度最长 42 秒，留足余量）；再打不完进加时（bosses.js 的 overtime）
export const BOSS_WINDOW = 48
export const CAMPAIGN_LEN = BOSS_AT + BOSS_WINDOW                         // 132

// 阶段（实际秒）：成型 = 新虫种开始登场，守线 = 大规模虫潮
export const PHASES = [
  { at: 0, name: 'phase.muster' },
  { at: 35, name: 'phase.form' },
  { at: 55, name: 'phase.hold' },
  { at: BOSS_AT, name: 'phase.boss' },
]

// 涓流：[实际秒, 每秒只数]，阶梯（stepLookup）。涓流是均匀铺在五条车道上的，是哨戒塔这类装置平时的口粮。
// 前 15 秒 1~2 只/秒；55 秒以后回到上一版的量级（31.5 / 45.5 只/秒），Boss 战里降回 31.5
export const TRICKLE = [[0, 2], [6, 3], [11, 4], [15, 5.5], [22, 7], [29, 9], [35, 12], [45, 16], [55, 38], [68, 50], [BOSS_AT, 31.5]]
export const TRICKLE_HERALD = 1      // 预告倒计时期间压到 1 只/秒：静一下再来
export const TRICKLE_SPREAD = 5.6

// 敌人移速倍率（实际秒）。上一版的五个拐点按旧时间轴折算是 0 / 26.7 / 46.9 / 61.6 / 73.6 秒，
// 前期放缓后整体往后挪：35 秒新虫种登场时才到 0.92，Boss 出场时到顶 1.24
export const SPEED_CURVE = [[0, 0.74], [35, 0.92], [55, 1.0], [70, 1.12], [BOSS_AT, 1.24]]

export const LANES = [-2.2, 0, 2.2]
export const TUTORIAL_LANES = [0, -2.4, 2.4, 0, 2.4, -2.4, 0, -2.4]
export const WAVE_SPREAD = 5.4
export const HERALD_SPREAD = 6.4
export const HERALD_LEAD = 3

const ZERO = { burster: 0, spitter: 0, crusher: 0, hulk: 0, wing: 0, digger: 0, warden: 0, shieldbug: 0, leaper: 0 }
// at 实际秒；herald 预告标题；feature = 这一波是哪种新虫的首秀（预告横幅把它排在第一个，并发一句介绍它的通讯）
const W = (at, ling, dur, extra = {}, herald = null, feature = null) => ({ at, ling, dur, ...ZERO, ...extra, herald, feature, echo: false })
const NEW = kind => 'herald.new.' + kind

export const WAVES = [
  // ---- 成军（0~15 秒）：零星小波，只有裂爪虫
  W(3, 20, 1),
  W(6.5, 28, 1),
  W(10, 40, 1),
  W(13.5, 55, 1),
  // ---- 15~35 秒：小波逐步变大，仍只有裂爪虫
  W(17, 80, 1),
  W(20.5, 110, 1),
  W(24, 150, 1.2),
  W(27.5, 190, 1.2),
  W(31, 230, 1.3),
  W(34, 260, 1.4),
  // ---- 成型（35~55 秒）：每一波引入一种新虫
  W(37.5, 280, 1.2, { burster: 24 }, NEW('burster'), 'burster'),
  W(41.5, 320, 1.5, { burster: 8, spitter: 5 }, NEW('spitter'), 'spitter'),
  W(45.5, 370, 1.6, { burster: 8, spitter: 3, crusher: 6 }, NEW('crusher'), 'crusher'),
  W(49.5, 420, 1.6, { burster: 10, crusher: 4, wing: 12 }, NEW('wing'), 'wing'),
  W(53, 520, 1.8, { burster: 12, spitter: 4, crusher: 8, wing: 10 }),
  // ---- 守线（55~84 秒）：大规模虫潮，剩下的虫种依次登场
  W(56.5, 800, 1.6, { burster: 12, crusher: 9, wing: 18, digger: 3 }, NEW('digger'), 'digger'),
  W(60, 1100, 2, { burster: 12, spitter: 4, crusher: 12, hulk: 3, wing: 26, digger: 2 }, NEW('hulk'), 'hulk'),
  W(63.5, 1250, 1.6, { burster: 16, spitter: 4, crusher: 14, hulk: 3, wing: 30, digger: 2, warden: 2 }, NEW('warden'), 'warden'),
  W(67, 1350, 1.8, { burster: 16, spitter: 6, crusher: 14, hulk: 4, wing: 34, digger: 3, warden: 1, shieldbug: 10 }, NEW('shieldbug'), 'shieldbug'),
  W(70.5, 1600, 2.4, { burster: 16, spitter: 6, crusher: 15, hulk: 5, wing: 40, digger: 3, warden: 2, shieldbug: 10 }),
  W(74, 1600, 2, { burster: 20, spitter: 6, crusher: 14, hulk: 4, wing: 36, digger: 3, warden: 2, shieldbug: 10, leaper: 30 }, NEW('leaper'), 'leaper'),
  W(77.5, 1700, 2.4, { burster: 18, spitter: 6, crusher: 15, hulk: 5, wing: 40, digger: 3, warden: 2, shieldbug: 10, leaper: 24 }),
  W(81, 2000, 3, { burster: 44, spitter: 6, crusher: 18, hulk: 6, wing: 45, digger: 6, warden: 2, shieldbug: 12, leaper: 24 }, 'herald.allin'),
  // ---- Boss 出场后（相对出场 +4.5 / +8.5 / +12.5 秒，和上一版一样）
  // 掘地虫 28 / 24 / 18（全线压上那波 6）：挂机不躲破土预警，靠它把 idle 胜率压在 70%~90%（seed 1..10 与 11..20 都是 8/10）；
  // good bot 会躲，损失只多 1~2 人。12 / 11 / 8 时 idle 仍 10/10
  W(88.5, 1040, 1.4, { burster: 40, spitter: 6, crusher: 16, hulk: 2, wing: 13, digger: 20, warden: 3, shieldbug: 8, leaper: 17 }, 'herald.breach'),
  W(92.5, 1080, 1.5, { burster: 36, crusher: 16, hulk: 2, wing: 14, digger: 17, warden: 3, shieldbug: 8, leaper: 22 }, 'herald.last'),
  W(96.5, 1224, 3, { burster: 14, spitter: 6, crusher: 12, hulk: 2, wing: 14, digger: 13, warden: 2, shieldbug: 6, leaper: 22 }),
]
export const BASE_WAVE_COUNT = WAVES.length

export const WAVE_KINDS = ['ling', 'burster', 'spitter', 'crusher', 'hulk', 'wing', 'digger', 'warden', 'shieldbug', 'leaper']

// 新虫种的登场顺序（GDD §3）：第一次出现在哪一波，那一波就以它为特色
export const INTRO_ORDER = ['burster', 'spitter', 'crusher', 'wing', 'digger', 'hulk', 'warden', 'shieldbug', 'leaper']

export function waveComp(w) {
  const comp = []
  for (const k of WAVE_KINDS) if (w[k] > 0) comp.push({ kind: k, count: w[k], nameKey: ENEMIES[k].nameKey })
  return comp
}

// 侧翼突袭：队伍偏离中线时专从对侧来，惩罚贴边站。守线阶段（大规模虫潮）才开始；间隔 8 秒
export const RUSH = { from: 57, every: 8, count: 480, warn: 1.6, dur: 1.2, x: 5.4, xJitter: 0.9, z: [-17, -7], vx: [1, 3.5], offCenter: 1 }
