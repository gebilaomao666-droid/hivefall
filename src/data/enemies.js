// 噬渊虫群。数值量级见 docs/GDD.md §2.2。
// ENEMY_KINDS 的下标就是 swarm.kind[i] 的枚举值，渲染层按它查表：顺序不要动，只能往后加。

export const ENEMY_KINDS = ['ling', 'burster', 'spitter', 'crusher', 'hulk', 'wing', 'digger', 'warden', 'egg', 'pod', 'shieldbug', 'leaper']

export const SWARM_CAP = 4096      // 槽位容量（含死亡残留）
export const LIVE_CAP = 3400       // 在场活虫硬上限
export const DEATH_LINGER = 2.1    // 尸体保留秒数
export const MIN_ARMOR_HIT = 0.5   // 护甲是减法，但每次命中至少打这么多

export const ENEMIES = {
  ling: {
    id: 'ling', nameKey: 'enemy.ling.name', bite: 1, hp: 1.8, hpPerSec: 0.03, speed: [8, 9.2], armor: 0, cls: 'light',
    leak: 1, xp: 1, cap: 3400, scale: 1, behavior: 'rusher', implemented: true,
    attack: { type: 'contact', dmg: 1, radius: 0.55 },
  },
  burster: {
    id: 'burster', nameKey: 'enemy.burster.name', bite: 0, deviceMul: 10, hp: 7, hpPerSec: 0.06, speed: [10.4, 10.4], armor: 0, cls: 'none',
    leak: 4, xp: 2, cap: 110, scale: 1.15, behavior: 'rusher', implemented: true,
    attack: { type: 'burst', dmg: 4, radius: 0.9, blast: 1.65, maxTargets: 4 },
  },
  spitter: {
    id: 'spitter', nameKey: 'enemy.spitter.name', bite: 1, hp: 26, hpPerSec: 0.15, speed: [5.5, 5.5], armor: 0, cls: 'light',
    leak: 6, xp: 8, cap: 28, scale: 1.3, behavior: 'standoff', implemented: true,
    attack: { type: 'spit', dmg: 0.5, range: 12, onMove: true, cd: 2.6, jitter: 0.5, stop: 9.5, flight: 0.45, targets: 1, overWall: true },
  },
  crusher: {
    id: 'crusher', nameKey: 'enemy.crusher.name', bite: 6, big: true, hp: 145, hpPerSec: 1.2, speed: [4.4, 4.4], armor: 0.5, cls: 'heavy',
    leak: 8, xp: 15, cap: 110, scale: 1.7, behavior: 'standoff', implemented: true,
    // range 10：被路障挡住时也够得着队伍的前几排，隔着路障照样扔骨刺（第 1 轮测试：甲壳兽在战役里基本打不到人）
    attack: { type: 'ranged', dmg: 2.8, range: 12.5, onMove: true, cd: 1.4, jitter: 0.2, stop: 5.2, flight: 0.25, targets: 1, overWall: true },
    regen: { delay: 1.5, frac: 0.03 },
  },
  hulk: {
    id: 'hulk', nameKey: 'enemy.hulk.name', bite: 15, big: true, hp: 340, hpPerSec: 2.5, speed: [3, 3], armor: 1.5, cls: 'heavy',
    leak: 12, xp: 60, cap: 20, scale: 2.6, behavior: 'standoff', implemented: true,
    attack: { type: 'melee', dmg: 5, range: 2.6, cd: 1.2, jitter: 0, stop: 1.8, flight: 0, targets: 2 },
  },
  // 飞行：全程 y > 0，只有对空兵种打得到。越过前排，挑后排的人俯冲一次，然后飞过防线。
  wing: {
    id: 'wing', nameKey: 'enemy.wing.name', bite: 0, hp: 14, hpPerSec: 0.1, speed: [9, 9], armor: 0, cls: 'light',
    leak: 3, xp: 4, cap: 120, scale: 1.1, behavior: 'flyer', implemented: true,
    // 第 1 轮测试：伤害 2 → 4、挑后面 4.5 米内的人（后几排步兵 + 炮兵 + 重型）——翼螫专咬后排
    attack: { type: 'dive', dmg: 4, dives: 1, range: 3.2, diveSpeed: 1.4, hit: 1.1, pickAhead: 6, backBand: 5.5 },   // 4.5 → 5：阵型 backClear 1.7 → 2.7，炮车整排后退 1 米，后排带跟着放宽 0.5 米，仍然咬得到后两排步兵；backClear 再 +0.5，这里跟着 5 → 5.5
    fly: { y: 3, low: 0.7, climb: 6 },
  },
  // 钻地：地下（state=3）谁也打不到。钻到阵前停下，亮 warn 秒预警圈，破土时圈内受伤，之后当近战虫打。
  digger: {
    id: 'digger', nameKey: 'enemy.digger.name', bite: 2, big: true, hp: 60, hpPerSec: 0.4, speed: [5, 5], armor: 0, cls: 'none',
    leak: 6, xp: 10, cap: 24, scale: 1.5, behavior: 'burrower', implemented: true,
    attack: { type: 'melee', dmg: 0.8, range: 2.4, cd: 1.2, jitter: 0, stop: 1.2, flight: 0, targets: 1 },
    emerge: { dmg: 1.4, radius: 1.6, warn: 1.2, ahead: 1.2, behind: 1.3, track: 3, scatter: 3, depth: -1 },
  },
  // 光环：半径内的其他虫受到的伤害 -40%（不含自己和别的护巢虫）。停在虫群后面不上前。
  // 余效：虫离开光环后还带 lingerReduce 的减伤 linger 秒——从它身边过一趟，就带着一层薄壳冲到阵前。
  // 没有余效的话光环只罩得住路过的那半秒，护巢虫在不在场没有任何区别。
  warden: {
    id: 'warden', nameKey: 'enemy.warden.name', bite: 0, hp: 90, hpPerSec: 0.6, speed: [4, 4], armor: 0.5, cls: 'heavy',
    leak: 8, xp: 20, cap: 12, scale: 1.6, behavior: 'aura', implemented: true,
    attack: { type: 'aura', radius: 4, reduce: 0.4, stop: 10, linger: 2.5, lingerReduce: 0.15 },
  },
  // 「巢母」产的卵：不动，time 秒后孵化，可以提前打掉。
  egg: {
    id: 'egg', nameKey: 'enemy.egg.name', bite: 0, hp: 30, hpPerSec: 0, speed: [0, 0], armor: 0, cls: 'none',
    leak: 0, xp: 3, cap: 60, scale: 1.2, behavior: 'egg', implemented: true,
    attack: { type: 'hatch', time: 3, brood: [['ling', 12], ['burster', 1]], scatter: 1.4 },
  },
  // 雇佣兵空投舱。不是虫：借虫群的槽位，好让所有武器都能自然地「集火」它。
  // 沿桥面往防线滑（由 sim/contracts.js 推进），打破 = 合同到手，滑过防线 = 合同作废。不计击杀、不给经验。
  pod: {
    id: 'pod', nameKey: 'enemy.pod.name', bite: 0, hp: 350, hpPerSec: 3, speed: [1.5, 1.5], armor: 0, cls: 'none',
    leak: 0, xp: 0, cap: 4, scale: 1.8, behavior: 'pod', implemented: true, pod: true,
    attack: { type: 'none' },
  },
  // ---- 布防系统的针对性虫（GDD §13）----
  // 举盾虫：正面来的直射子弹（突击兵 / 霍克 / 破城 / 哨戒塔 / 冷凝塔）只吃 1 - shield.reduce；
  // 「正面」= 子弹来向与它的朝向（+z）夹角 < 60°。范围、火焰、光束、风暴、技能、侧后方的子弹照常。
  shieldbug: {
    id: 'shieldbug', nameKey: 'enemy.shieldbug.name', bite: 3, big: true, hp: 50, hpPerSec: 0.35, speed: [4.5, 4.5], armor: 0, cls: 'none',
    leak: 5, xp: 12, cap: 40, scale: 1.15, behavior: 'standoff', implemented: true,
    attack: { type: 'melee', dmg: 2, range: 2.4, cd: 1.1, jitter: 0, stop: 1.4, flight: 0, targets: 1 },
    shield: { reduce: 0.9, cos: 0.5 },
  },
  // 跳跃虫：遇到第一个装置会跃过去（每只一次，见 data/devices.js 的 LEAP），之后和裂爪虫一样撞人
  leaper: {
    id: 'leaper', nameKey: 'enemy.leaper.name', bite: 1, hp: 10, hpPerSec: 0.08, speed: [9.5, 9.5], armor: 0, cls: 'light',
    leak: 2, xp: 3, cap: 200, scale: 1.2, behavior: 'rusher', implemented: true, leaps: true,
    attack: { type: 'contact', dmg: 2, radius: 0.6 },
  },
}

// 精英（无尽 4 层起；战役里 world.eliteChance = 0）。裂爪虫只有 lingFactor 的概率。
export const ELITE = { hpMul: 2.5, scale: 1.3, armor: 1, xpMul: 2.5, lingFactor: 0.25 }

export const DIFFICULTY = {
  normal: { hpMul: 1, speedMul: 1, dmgMul: 1, lineMax: 1000, bossHpMul: 1 },
  // bossHpMul 1.4 → 1.5（第 2 轮：普通难度的碾压者加了血，老兵的 Boss 战要稳稳长过普通难度的任何一局）
  // bossHpMul 1.5 → 1.6（集成第 1 轮：修掉「死一人整排左右互换、方阵挤成一摞」后，老兵 seed 10 的 Boss 战 21.6 秒，短于普通最长的 22.6 秒）
  // bossHpMul 1.6 → 1.9（第 2 轮修复：碾压者基础血 25000 → 20500，老兵的绝对血量 40000 → 38950，Boss 战仍长过普通难度；1.8 时老兵最短一局 21.8 秒 < 普通最长 21.9 秒）
  veteran: { hpMul: 1.35, speedMul: 1.1, dmgMul: 1.35, lineMax: 700, bossHpMul: 1.9 },
}
