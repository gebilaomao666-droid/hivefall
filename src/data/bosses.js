// Boss。机制见 docs/GDD.md §2.3。ai 决定 src/sim/boss.js 里走哪套状态机。
// hp 是战役里的血量。第 1 轮测试后：Boss 有两个阶段（phases，见文件末尾 HARDEN 的说明），每次硬化 4.5 秒按时间拖长战斗，
// 血量就不用堆太高——碾压者 23500：标准小队 18.7~22 秒；再高挂机小队的 Boss 战比标准小队长一半、冲锋次数跟着翻倍，idle 掉到 3/10。
// 第 2 轮：站位后撤到 holdZ 1.5 之后火焰兵够不着它，标准小队 16.8 秒就打完了 → 27500；冲锋一下撞的人从在场 30% 降到 24%（挂机小队不躲冲锋，6/10 → 9/10）。
// 冲锋 / 横扫一下伤的人数有上限，也不超过在场人数的 share（队伍打残以后是一截一截地掉，不会突然团灭）。
// endlessHp 是无尽里的基数（× 1.3^(层 ÷ 3)）：第 1 轮测试从 10500 / 7500 / 10000 上调（巢母出场即被击毙）；
// 第 2 轮巢母 12000 → 15000、渊噬蠕虫 18000 → 21000：第 3 / 6 层只撑 12 秒上下，拉到 15 秒左右，三个机制都看得到。
// 第 3 轮（硬指标：碾压者战 18~30 秒、各指挥官都 ≥ 18 秒；没躲冲锋会掉一截兵）：
//   甲壳硬化期间跳不过下一个阶段阈值、最后一个阶段的硬化里打不死（HARDEN.floor）——Boss 战长度由硬化时长托底，不靠堆血：
//   碾压者 27500 → 25000、硬化 4.5 → 6.5 秒；无尽里硬化 × HARDEN.endlessMul。冲锋撞上合金路障会被顶停（deviceDmg：路障掉这么多，扛不住就被碾碎）；
//   躲开后撞防线 35 → 95（按防线上限折算，无尽 35）。巢母 16000 → 17500、渊噬蠕虫 22500 → 29000，两者硬化 2.5 → 4 秒
import { BOSS_AT, CAMPAIGN_LEN } from './waves.js'

// 预警判定的统一口径：预警结束的那一刻，队伍中心还在预警形状的横向范围内才算中招；
// 队伍中心已经离开 = 全队躲开。中招时只有身处形状内的单位受伤。
export const BOSSES = {
  ravager: {
    id: 'ravager', ai: 'ravager', nameKey: 'boss.ravager.name', commsKey: 'comms.boss',
    hp: 20500, endlessHp: 18000, radius: 1.6, cls: 'heavy', armor: 1,
    // holdZ 5 → 1.5（第 2 轮测试：一出场就贴到我方前排，埋在虫堆和枪口火光里，轮廓读不出来）：
    // 站在阵前 6.6 米处，和前排之间隔着一片空地；横扫的纵深 5.5 → 8，仍然够得着前两排
    // spawnZ -21 → -13（修复第 2 轮）：横屏镜头里 z ≈ -10 以远压在 Boss 血条 / 波次预告下面，原来出场后头 4 秒根本看不见本体
    // 。现在出场就在画面里、3 秒左右走到阵前；无尽仍从 -21 出（spawnZEndless，无尽数值不动）
    spawnZ: -13, spawnZEndless: -21, speed: 2.8, holdZ: 1.5, retreatSpeed: 7,
    sway: { amp: 2, freq: 0.35 },
    sweep: { dmg: 7, targets: 8, share: 0.14, cd: 1.4, reach: 3.7, depth: 8, windup: 0.3, dur: 0.6 },
    // 冲锋：预警带锁定在预警开始时的队伍中心。躲开则 Boss 撞上路障眩晕。
    // first 2 → 5（修复第 2 轮）：原来出场 2 秒就从桥的最远端一路冲到方阵背后撞线、在那里眩晕，玩家第一眼看到的是它趴在自己身后。
    // 现在先走到阵前、站定 2 秒左右再冲
    // maxTargets：只撞得到车道里最靠前的这么多人（没躲 = 掉一截兵）；crashLine：躲开之后它撞在防线路障上，防线扣这么多
    charge: { first: 5, firstEndless: 2, every: 6, windup: 1.2, width: 4, speed: 40, endZ: 12.5, dmg: 10, maxTargets: 11, share: 0.175, stun: 2, stunDmgMul: 1.5, crashLine: 104, crashLineEndless: 35, crashLineMulCap: 1.15, deviceDmg: 180, deviceReach: 0.4 },
    // 狂暴（第 2 阶段起）：冲锋间隔缩短、横扫变快
    enrage: { every: 3.6, sweepCd: 1.25 },
    // 测试：实机 Boss 出场到倒下只有 15~25 秒、用户很难看清它。战斗长度由两次硬化托底（见 HARDEN），
    // 加血几乎不加时长（实测 20500 → 30000 只多 1~2 秒），所以硬化 6.5 → 8.5 秒；连同上面出场点 / 首次冲锋，无头 good bot 的 Boss 战 21~24 → 22.6~24.9 秒，
    // 防线最低 68% → 72%、损失 19.6，idle 9/10、builder 损失为 idle 的 58%，各项仍在区间内（实机比无头长：标准小队约 29 秒）。
    // 无尽一层只有 30 秒，不跟着拖：hardenEndless 4.55（= 原来的 6.5 × HARDEN.endlessMul）、firstEndless 2、spawnZEndless -21，无尽数值与上一轮完全一致。
    // 试过的组合：出场点不动 + 硬化 9 秒 → builder 损失到 idle 的 73%（test-defense ⑪ 要求 < 70%）；首次冲锋 6 秒 → idle 10/10 太轻松，都没采用
    phases: [
      { at: 0.7, harden: 8.5, hardenEndless: 4.55, summon: { crusher: 2, burster: 10, ling: 40 } },
      { at: 0.35, harden: 8.5, hardenEndless: 4.55, summon: { crusher: 3, hulk: 1, burster: 8, leaper: 10, ling: 50 }, enrage: true },
    ],
    death: { scale: 0.1, hold: 0.42, ease: 1.15 },
  },
  // 「巢母」：停在远端不上前。吐酸（落点预警圈 + 酸池）、产卵（卵是 swarm 里的 egg，可提前打掉）。
  matriarch: {
    id: 'matriarch', ai: 'matriarch', nameKey: 'boss.matriarch.name', commsKey: 'comms.boss_matriarch',
    hp: 17500, endlessHp: 15000, radius: 2.2, cls: 'heavy', armor: 1,
    spawnZ: -21, speed: 4.5, holdZ: -1.5,
    sway: { amp: 1.2, freq: 0.5 },
    cast: 0.5,   // 吐酸 / 产卵的动作时长（state = attack）
    acid: { first: 1.5, every: 5, globs: 3, warn: 1.1, r: 1.5, dmg: 3, pool: 3, tick: 0.5, tickDmg: 1, offset: [3.6, 4.6], dz: 1, xMax: 5.6 },
    eggs: { first: 3.5, every: 8, count: 6, x: 5.2, z: [1.2, 4.5] },
    enrage: { acidEvery: 3.4, eggsEvery: 5.5 },
    phases: [
      { at: 0.7, harden: 4, summon: { wing: 10, spitter: 3, ling: 60 } },
      { at: 0.35, harden: 4, summon: { wing: 14, burster: 10, ling: 80 }, enrage: true },
    ],
    death: { scale: 0.1, hold: 0.42, ease: 1.15 },
  },
  // 「渊噬蠕虫」：潜地时打不到。在队伍当前 x 处破土，出土后暴露弱点（受伤 ×vuln），其间吐一排刺。
  leviathan: {
    id: 'leviathan', ai: 'leviathan', nameKey: 'boss.leviathan.name', commsKey: 'comms.boss_leviathan',
    hp: 29000, endlessHp: 21000, radius: 2, cls: 'heavy', armor: 1,
    spawnZ: 6.6,
    // 5 秒一个循环：rise + exposed = 3.5 秒暴露在地面（受伤 ×vuln），hide + warn = 1.5 秒在地下。
    // flinch: 一次露头掉血超过这个比例的最大生命就提前潜回去（保证至少看得到两次破土）
    burrow: { first: 0.6, hide: 0.1, warn: 1.4, r: 3, dmg: 6, ahead: 1.5, rise: 0.4, exposed: 3.1, vuln: 1.25, flinch: 0.55, xMax: 4.6 },
    // at: 暴露后第几秒吐刺（可多次）
    spines: { at: [0.4, 1.8], warn: 1, width: 2.6, dmg: 4, endZ: 16.5 },
    // 狂暴：露头时多吐一排刺
    enrage: { spinesAt: [0.3, 1.2, 2.2] },
    phases: [
      { at: 0.7, harden: 4, summon: { digger: 3, leaper: 8, ling: 50 } },
      { at: 0.35, harden: 4, summon: { digger: 4, leaper: 12, crusher: 2, ling: 70 }, enrage: true },
    ],
    death: { scale: 0.1, hold: 0.42, ease: 1.15 },
  },
}

export const BOSS_KINDS = Object.keys(BOSSES)

// 阶段（第 1 轮测试：Boss 出场 2.5 秒只剩 1/10、巢母刚出场就被击毙）：
// 血量掉到 phases[k].at 时进入下一阶段——这一下的伤害封顶在阈值上（再猛的火力也跳不过阶段），
// 发 bossPhase 事件（表现层的横幅），召唤一波护卫虫（summon，在 Boss 身前散开），
// 并「甲壳硬化」harden 秒：正面受到的伤害 × HARDEN.mul。破甲武器（UNITS 带 anti_heavy / anti_boss 标签的兵种、迫击炮台）、
// 指挥官技能、以及从侧面打的（射手与 Boss 横向距离 ≥ HARDEN.sideX）不受影响：要么换角度，要么靠破甲。
// enrage: true 的阶段起进入狂暴（各 Boss 的 enrage 字段）。
export const HARDEN = { mul: 0.25, sideX: 2.6, spread: 2.6, dz: 3, floor: 0.04, endlessMul: 0.7 }

// 时间轴 ×1.3（第 1 轮测试）：约 101 秒出场、137 秒判负；第 3 轮 ×0.92：72 秒出场、120 秒判负（CAMPAIGN_LEN = 出场 + 48）；
// 第 4 轮前期放缓（渐进的虫潮）：84 秒出场、132 秒判负
// overtime（加时）：时限到了但 Boss 还站在桥上、队伍也还在打——再给这么多秒，打不完才判负。
// 实机里（第 2 轮试玩）选牌不讲究的一局常常 172~178 秒才打倒 Boss，随机选牌的 bot 8 局里有 1 局 180 秒超时：
// 队伍满员、防线完好却被读秒判负，首关「几乎必过」就不成立了。good / idle bot 都在 170 秒内打完，碰不到加时
export const CAMPAIGN_BOSS = { kind: 'ravager', at: BOSS_AT, deadline: CAMPAIGN_LEN, overtime: 20 }
