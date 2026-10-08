// 指挥官与技能。设计见 docs/GDD.md §6：短 CD 小技能 / 中 CD 清线 / 长 CD 大招，首次可用错开。
// 行为在 src/sim/powers.js，这里只放数值。技能伤害不吃战地升级（无尽里按层另乘）。
//
// 技能字段：
//   key        键位 q/w/e/r
//   cd         充一次能的秒数；first 开局到第一次可用的秒数
//   charges    可存次数；gap 连放两次之间的最短间隔
//   aimable    划线瞄准：按下后进入 status='aiming'（timeScale = AIM.timeScale），
//              input.aim 给出线段即释放；AIM.timeout 真实秒后按 auto 自动直线释放
//   auto       'forward' 从队伍正前方往前一条直线 / 'across' 横在阵前的一条线
//   events     这个技能会产生的子事件（表现层照这张表准备特效；字段见 ARCHITECTURE.md §2.2）

export const AIM = { timeScale: 0.25, timeout: 2, minLen: 3 }

export const POWERS = {
  // ---------------------------------------------------------------- 「铁砧」霍克
  // 战地鼓舞：dur 秒内全队伤害 ×dmg 射速 ×rate；步兵与英雄 ×infDmg / ×infRate
  hawk_rally: {
    id: 'hawk_rally', key: 'q', cd: 18, first: 6, charges: 1, gap: 0, aimable: false,
    dur: 6, dmg: 1.15, rate: 1.2, infDmg: 1.25, infRate: 1.3,
    events: ['powerCast'],
  },
  // 近地空袭：沿队伍所在纵线从近到远投 bombs 枚弹
  hawk_strike: {
    id: 'hawk_strike', key: 'w', cd: 25, first: 15, charges: 3, gap: 2, aimable: false,
    bombs: 11, dmg: 75, bossDmg: 180, r: 2.1, maxTargets: 40, z0: 2, step: 2, delay: 0.35, stagger: 0.06,
    events: ['powerCast', 'strike:bomb', 'explosion'],
  },
  // 空投支援：空投舱砸在阵前，带来一批部队（按权重抽）；全都满编时改成全员治疗
  hawk_drop: {
    id: 'hawk_drop', key: 'e', cd: 60, first: 20, charges: 4, gap: 2, aimable: false,
    ahead: 3.2, delay: 0.8, r: 2.2, dmg: 30, goliath: 0.02, healFrac: 0.4,
    table: [
      { unit: 'rifle', count: 6, weight: 30 },
      { unit: 'flamer', count: 3, weight: 55 },
      { unit: 'heavy', count: 1, weight: 8 },
      { unit: 'mortar', count: 1, weight: 7 },
    ],
    events: ['powerCast', 'strike:pod', 'explosion', 'unitJoin', 'heal'],
  },
  // 旗舰「不屈号」：停在阵前上空 dur 秒。每 laserEvery 秒 lasers 道激光扫最密处；gunAt 秒后主炮蓄力 gunCharge 秒，打场上最大的目标
  hawk_flagship: {
    id: 'hawk_flagship', key: 'r', cd: 75, first: 45, charges: 1, gap: 0, aimable: false,
    dur: 8, ahead: 9, y: 9,
    laserEvery: 0.1, lasers: 3, laserDmg: 20, laserBoss: 12, laserR: 1.4, laserMax: 6,
    gunAt: 1.6, gunCharge: 1.2, gunDmg: 950, gunBoss: 1300, gunR: 3.2, gunMax: 40,
    events: ['powerCast', 'summon:flagship', 'beam', 'explosion', 'strike:main_gun', 'hitstop', 'shake', 'summonEnd'],
  },

  // ---------------------------------------------------------------- 「棱镜」伊瑟拉
  // 轨道轰击：shots 发落在最密处，对重甲 ×(1 + vsHeavy)。Boss 在场时 bossShots 发直接砸 Boss
  ysera_orbital: {
    id: 'ysera_orbital', key: 'q', cd: 18, first: 6, charges: 1, gap: 0, aimable: false,
    shots: 5, bossShots: 2, dmg: 80, bossDmg: 150, r: 2.5, vsHeavy: 1, maxTargets: 40, delay: 0.6, stagger: 0.12, scatter: 1.4,
    events: ['powerCast', 'strike:orbital', 'explosion'],
  },
  // 日冕长矛：沿划出的线灼烧一次，之后这条线上再烧 burnDur 秒
  ysera_lance: {
    id: 'ysera_lance', key: 'w', cd: 25, first: 15, charges: 1, gap: 0, aimable: true, auto: 'forward',
    len: 24, half: 1.4, dmg: 110, bossDmg: 250, burnDur: 2.5, burnDmg: 12, burnTick: 0.5, burnStep: 2.2,
    events: ['aimStart', 'aimEnd', 'powerCast', 'beam', 'zone', 'shake'],
  },
  // 日蚀：dur 秒内 shots 发全屏轰炸，autoAim 的比例自动找虫，其余随机落点
  ysera_eclipse: {
    id: 'ysera_eclipse', key: 'r', cd: 75, first: 45, charges: 1, gap: 0, aimable: false,
    dur: 10, shots: 250, dmg: 24, bossDmg: 40, r: 1.3, maxTargets: 10, autoAim: 0.6, bossShare: 0.2,
    events: ['powerCast', 'explosion', 'shake'],
  },

  // ---------------------------------------------------------------- 「扳手」老猫
  // 铁罐空投：robots 台战斗机器人砸进最密处，落地伤害 + 眩晕，之后自己找虫打，存活 life 秒
  joe_drop: {
    id: 'joe_drop', key: 'q', cd: 20, first: 6, charges: 1, gap: 0, aimable: false,
    robots: 4, delay: 0.5, stagger: 0.1, scatter: 1.8, dmg: 40, bossDmg: 60, r: 2.2, maxTargets: 30, stun: 1.5,
    life: 15, hitEvery: 0.5, hitDmg: 14, hitR: 1.9, hitMax: 5, seek: 6, speed: 3.5,
    events: ['powerCast', 'strike:robot', 'explosion', 'summon:robot', 'summonEnd'],
  },
  // 雷区：沿划出的线布 mines 颗雷。arm 秒后武装，有地面虫进入 trigger 半径就炸
  joe_mines: {
    id: 'joe_mines', key: 'w', cd: 25, first: 15, charges: 1, gap: 0, aimable: true, auto: 'across',
    len: 11, ahead: 9, mines: 10, arm: 0.4, trigger: 1.3, r: 2.6, dmg: 110, bossDmg: 150, maxTargets: 30, life: 20,
    events: ['aimStart', 'aimEnd', 'powerCast', 'strike:mine', 'zone', 'explosion'],
  },
  // 汇聚射线：一道纵贯全桥的光从一侧扫到另一侧
  joe_ray: {
    id: 'joe_ray', key: 'r', cd: 75, first: 45, charges: 1, gap: 0, aimable: false,
    dur: 1.4, dmg: 200, bossDmg: 1200, half: 0.5, z0: -25, z1: 17,
    events: ['powerCast', 'summon:ray', 'beam', 'summonEnd', 'shake', 'hitstop'],
  },
}
for (const p of Object.values(POWERS)) { p.nameKey = `power.${p.id}.name`; p.descKey = `power.${p.id}.desc` }

// 被动。行为分散在 squad.js（受伤 / 回血）与 powers.js（重建队列）。
export const PASSIVES = {
  // 守护之壳：致命伤改为 invuln 秒无敌并回 heal 比例的血；每个单位 cd 秒一次
  aegis: { id: 'aegis', invuln: 1.5, heal: 0.15, cd: 110 },   // cd 60 → 90（第 3 轮：敌人更疼之后免死在无尽深层太值钱，伊瑟拉比另两位深 3 层）；90 → 110（集成第 1 轮：修掉「死一人整排左右互换、方阵挤成一摞」之后方阵始终满宽，伊瑟拉又比老猫深 2.5 层）
  // 钻机：就是 hero_joe 的武器（data/units.js），这里只登记名字
  drill: { id: 'drill' },
  // 回收程序（GDD §13 改版）：装置花费 × deviceCost，装置被毁返还花费的 deviceRefund。
  // 原有的那一半保留：机械单位（UNITS[kind].mech）被毁 delay 秒后重建；regenDelay 秒没挨打后机械每秒回 regen、其余单位每秒回 regenFoot
  rebuild: { id: 'rebuild', delay: 20, regen: 4, regenFoot: 1.5, regenDelay: 2, deviceCost: 0.8, deviceRefund: 0.5 },
  // 超频：场上每台机械单位（含老猫的步行机）让全军射速 +per，最多 +max。
  // 原值 3% / 30%：「回收程序」加上装置打折与返还之后，老猫在无尽里比另外两位深 2~3 层（8 个种子均 20.1 对 17.5 / 18.0），压到现值后 18.3
  overclock: { id: 'overclock', per: 0.018, max: 0.18 },
}
for (const p of Object.values(PASSIVES)) { p.nameKey = `passive.${p.id}.name`; p.descKey = `passive.${p.id}.desc` }

export const COMMANDERS = {
  hawk: { id: 'hawk', hero: 'hero_hawk', powers: ['hawk_rally', 'hawk_strike', 'hawk_drop', 'hawk_flagship'], passives: [] },
  ysera: { id: 'ysera', hero: 'hero_ysera', powers: ['ysera_orbital', 'ysera_lance', 'ysera_eclipse'], passives: ['aegis'] },
  joe: { id: 'joe', hero: 'hero_joe', powers: ['joe_drop', 'joe_mines', 'joe_ray'], passives: ['drill', 'rebuild', 'overclock'] },
}
for (const c of Object.values(COMMANDERS)) {
  c.nameKey = `commander.${c.id}.name`; c.titleKey = `commander.${c.id}.title`; c.descKey = `commander.${c.id}.desc`
  c.readyKey = `comms.${c.id}.ready`     // 第一个技能就绪时指挥官本人的一句通讯
}

export const COMMANDER_IDS = Object.keys(COMMANDERS)

// 指挥官局的战役「威胁加码」：指挥官本人 + 三四个技能的火力明显高过标准小队，
// 同一张时间轴下三位的损失只有标准小队的一半（7~12 对 18）、防线最低 78~79%，测试「指挥官局危险感不达标」。
// 虫巢盯上了指挥官的信号：战役里敌人伤害 ×dmgMul、漏网与 Boss 撞防线扣的防线 ×lineMul。只管战役——
// 无尽每层按 layerScale 重设难度系数（sim/endless.js startLayer），三位指挥官的无尽深度不受影响。
// 伊瑟拉的「守护之壳」每人免死一次，同样的敌伤下她少死四成，所以她那一档的敌伤更高。
export const COMMANDER_THREAT = {
  hawk: { dmgMul: 1.45, lineMul: 1.35 },
  ysera: { dmgMul: 1.8, lineMul: 1.35 },
  joe: { dmgMul: 1.45, lineMul: 1.35 },
}

// 舰队后勤叠满也不会把冷却压到这个比例以下
export const CD_MUL_MIN = 0.4
