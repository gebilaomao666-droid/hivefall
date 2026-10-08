// 我方单位。数值量级见 docs/GDD.md §2.1。
// weapon.type 决定 src/sim/weapons/ 里走哪个实现。

export const UNIT_KINDS = ['rifle', 'flamer', 'mortar', 'titan', 'lancer', 'reaper', 'psion', 'skyhook']

// 指挥官本人（英雄单位）。单独一份枚举：UNIT_KINDS 仍然只有 8 个可招募兵种，
// 需要「所有会上场的单位」时用 ALL_KINDS（squad.counts / mods / 伤害统计按它建表）。
export const HERO_KINDS = ['hero_hawk', 'hero_ysera', 'hero_joe']
export const ALL_KINDS = [...UNIT_KINDS, ...HERO_KINDS]

export const CAPS = {
  campaign: { infantry: 60, artillery: 4, heavy: 3, hero: 1 },
  endlessMax: { infantry: 96, artillery: 9, heavy: 8, hero: 1 },
}

export const FORMATION = {
  // 15 列 × 0.8 / 0.78 → 13 列 × 0.76 / 0.76：测试「兵与兵之间有缝、13×5 的稀疏阵，不像参考 038 那样 11×5 挤成一块」。
  // 方阵总宽 11.2 → 9.1 米，60 人从 4 排变 5 排，读起来是一整块。0.76 仍高于 test-units「步兵之间 ≥ 0.75 米」的不穿模底线；
  // 「缝」主要是单兵模型偏细，渲染层可把步兵肩宽放到 0.74 米（底线之内）来填
  // 测试：单兵在屏幕上只有参考 038 的六七成大。渲染层把步兵放大 1.3 倍，列距 / 行距同步放到 0.88 / 0.9
  // （方阵总宽 9.1 → 10.6 米，仍在桥宽 13 米以内），放大后肩甲的重叠比例和原来持平，不会更挤更穿模
  cols: 13, colGap: 0.88, rowGap: 0.9, frontZ: 8.1,
  colOrder: [6, 5, 7, 4, 8, 3, 9, 2, 10, 1, 11, 0, 12],   // 每排从中间往两边填
  artilleryDz: 5.0, artilleryGap: 2.6,                 // 炮兵在步兵后面（至少这么远）
  heavyDz: 6.9, heavyGap: 3.3,                         // 重型最靠后（至少这么远）
  backClear: 3.2,     // 炮兵排离步兵最后一排至少这么远。1.7 → 2.7：自行炮车身半长约 1.96 米（渲染按车身中心摆）+ 步兵半个身位 0.7 米，1.7 时最后两排步兵和炮车重叠；2.7 → 3.2：炮管还伸出车头约 0.5 米，仍探进最后一排步兵
  backRowGap: 1.6,    // 后方横排之间的行距
  xLimit: 4.3,        // 队伍中心可移动范围
  edge: 6.1,          // 单兵不能站出桥面
  moveSpeed: 14,      // 键盘移动与队伍追目标的限速
  follow: 0.2,        // 队伍中心每步向目标靠拢的比例
  unitFollow: 0.16,   // 单兵每步回槽位的比例
  joinZ: 17.2,        // 新兵从防线处跑进来
}

// 战地包扎：步兵（含指挥官）delay 秒没挨打就每秒回 rate 点血。第 2 轮测试加的：甲壳兽改成边走边打之后，
// 零星的骨刺擦伤会一路攒到 Boss 战（挂机小队 9/10 → 1/10）；有了它，擦伤歇一会儿就好，只有被集火才会掉人
export const FIELD_REGEN = { delay: 5, rate: 1.2 }

const NONE = { vsLight: 0, vsHeavy: 0, ignoreArmor: false }

export const UNITS = {
  rifle: {
    id: 'rifle', nameKey: 'unit.rifle.name', descKey: 'unit.rifle.desc', cls: 'infantry', rank: 2, hp: 12,
    overdrive: 2, implemented: true, antiAir: true, tags: ['versatile', 'anti_air'],
    // 自带 1 贯穿：不给突击兵升级的玩家也撑得到 Boss；伤害 2.8 是把「碎甲弹头」让出来的那部分挪回了基础值
    weapon: { ...NONE, type: 'hitscan', dmg: 2.8, bossDmg: 1.1, interval: 0.13, jitter: 0.025, range: 11, corridor: 3.1, pierce: 1, pierceRange: 2.5, fxDelay: 0.08 },
  },
  flamer: {
    id: 'flamer', nameKey: 'unit.flamer.name', descKey: 'unit.flamer.desc', cls: 'infantry', rank: 1, hp: 36,
    overdrive: 2, implemented: true, tags: ['front', 'anti_light'],
    weapon: { type: 'cone', dmg: 3, bossDmg: 6, interval: 0.3, jitter: 0, range: 6.8, arc: 52, maxTargets: 30, vsLight: 0.75, vsHeavy: -0.5, ignoreArmor: true, fxDelay: 0 },
  },
  mortar: {
    id: 'mortar', nameKey: 'unit.mortar.name', descKey: 'unit.mortar.desc', cls: 'artillery', rank: 3, hp: 54, mech: true,
    overdrive: 2, implemented: true, tags: ['aoe', 'anti_heavy'],
    weapon: { ...NONE, type: 'shell', dmg: 22, bossDmg: 75, interval: 1.5, jitter: 0.1, radius: 3.6, maxTargets: 36, minRange: 4.4, zMin: -11, zMax: 16, vsHeavy: 0.75, samples: 16, fxDelay: 0.13 },
  },
  titan: {
    id: 'titan', nameKey: 'unit.titan.name', descKey: 'unit.titan.desc', cls: 'heavy', rank: 4, hp: 84, mech: true,
    overdrive: 1.4, implemented: true, antiAir: true, tags: ['aoe', 'anti_heavy', 'anti_air'],
    weapon: { ...NONE, type: 'dual_shell', dmg: 9, bossDmg: 24, shells: 2, interval: 1.05, jitter: 0.05, range: 19, radius: 3, maxTargets: 40, vsHeavy: 1.2, spread: 1.3, samples: 12, fxDelay: 0.13 },
  },
  lancer: {
    id: 'lancer', nameKey: 'unit.lancer.name', descKey: 'unit.lancer.desc', cls: 'heavy', rank: 4, hp: 56, mech: true,
    overdrive: 1.4, implemented: true, tags: ['anti_heavy', 'anti_boss'],
    // 单体破甲：打死目标后溢出的伤害跳到旁边的虫身上，最多 jumps 次
    weapon: { ...NONE, type: 'lock', dmg: 12, bossDmg: 44, shells: 2, interval: 0.6, jitter: 0.04, range: 19, vsHeavy: 2, jumps: 3, jumpRange: 4, fxDelay: 0.05 },
  },
  reaper: {
    id: 'reaper', nameKey: 'unit.reaper.name', descKey: 'unit.reaper.desc', cls: 'heavy', rank: 4, hp: 64, mech: true,
    overdrive: 1.4, implemented: true, tags: ['aoe', 'anti_light'],
    // 横扫一条带：宽 sweepWidth、前后各 depth
    weapon: { type: 'beam_sweep', dmg: 18, bossDmg: 20, interval: 0.95, jitter: 0.05, range: 22, sweepWidth: 8, sweepTime: 0.6, depth: 1.4, maxTargets: 48, vsLight: 1, vsHeavy: 0, ignoreArmor: true, samples: 12, fxDelay: 0 },
  },
  psion: {
    id: 'psion', nameKey: 'unit.psion.name', descKey: 'unit.psion.desc', cls: 'heavy', rank: 4, hp: 40,
    overdrive: 1.4, implemented: true, antiAir: true, tags: ['aoe', 'anti_air'],
    weapon: { type: 'storm', dmg: 9, bossDmg: 20, interval: 4.2, jitter: 0.2, range: 22, lead: 2, radius: 3.1, ticks: 8, tickEvery: 0.35, maxTargets: 40, vsLight: 0, vsHeavy: 0, ignoreArmor: true, samples: 16, fxDelay: 0 },
  },
  skyhook: {
    id: 'skyhook', nameKey: 'unit.skyhook.name', descKey: 'unit.skyhook.desc', cls: 'heavy', rank: 4, hp: 50, mech: true,
    overdrive: 1.4, implemented: true, antiAir: true, tags: ['anti_air'],
    // 每架无人机各打一个目标：先打飞的，再骚扰后排（刺脊虫 / 护巢虫 / 虫卵），都没有就打最远的那堆
    weapon: { ...NONE, type: 'drones', dmg: 4, bossDmg: 4, drones: 3, interval: 0.5, jitter: 0.03, range: 20, vsAir: 1.5, fxDelay: 0.05 },
  },
  // ---- 指挥官本人。cls 'hero'：站步兵第一排正中（rank 0），阵亡不算输。数值见 GDD §6 ----
  // 「铁砧」霍克：17 米贯穿射线。mods: 'rifle' = 吃突击兵的升级。
  hero_hawk: {
    id: 'hero_hawk', nameKey: 'unit.hero_hawk.name', descKey: 'unit.hero_hawk.desc', cls: 'hero', rank: 0, hp: 60,
    overdrive: 2, implemented: true, antiAir: true, hero: true, mods: 'rifle', tags: ['hero', 'versatile'],
    weapon: { ...NONE, type: 'hitscan', dmg: 5, bossDmg: 5, interval: 0.22, jitter: 0.02, range: 17, corridor: 3.4, pierce: 4, pierceRange: 9, fxDelay: 0.05 },
  },
  // 「棱镜」伊瑟拉：自带护盾，近身挥砍；每 lungeCd 秒向前突刺一条线（前方有目标才刺）。
  hero_ysera: {
    id: 'hero_ysera', nameKey: 'unit.hero_ysera.name', descKey: 'unit.hero_ysera.desc', cls: 'hero', rank: 0, hp: 50, shield: 40,
    overdrive: 2, implemented: true, hero: true, tags: ['hero', 'front'],
    weapon: { type: 'melee', dmg: 7, bossDmg: 14, interval: 0.4, jitter: 0, range: 3.2, reach: 1.6, maxTargets: 10, vsLight: 0, vsHeavy: 0, ignoreArmor: true, lungeCd: 2, lungeLen: 12, lungeHalf: 1.2, lungeDmg: 30, lungeBoss: 60, fxDelay: 0 },
  },
  // 「扳手」老猫：一台改装步行机。钻机（被动）就是它的武器：常驻烧血最厚的目标，45/秒，Boss 40/秒。
  hero_joe: {
    id: 'hero_joe', nameKey: 'unit.hero_joe.name', descKey: 'unit.hero_joe.desc', cls: 'hero', rank: 0, hp: 90, mech: true,
    overdrive: 1, implemented: true, antiAir: true, hero: true, tags: ['hero', 'anti_heavy'],
    weapon: { type: 'drill', dmg: 4.5, bossDmg: 4, interval: 0.1, jitter: 0, range: 20, vsLight: 0, vsHeavy: 0, ignoreArmor: true, fxDelay: 0 },
  },
}

// 能打到飞行目标（swarm.y > 0）的兵种。其余兵种的任何伤害（含它们留下的火区）都碰不到飞行虫。
export const ANTI_AIR = Object.fromEntries(ALL_KINDS.map(k => [k, !!UNITS[k].antiAir]))
// 指挥官技能的伤害来源记作 POWER：不进兵种伤害统计（进 stats.dmgByPower），空中地面都打得到
export const POWER = 'power'
ANTI_AIR[POWER] = true
// 装置的伤害来源：进 stats.dmgByDevice，不进兵种 / 技能统计。DEVICE 只打地面，DEVICE_AA（哨戒塔）能对空
export const DEVICE = 'device'
export const DEVICE_AA = 'device_aa'
ANTI_AIR[DEVICE] = false
ANTI_AIR[DEVICE_AA] = true

// 机械单位（「回收程序」会重建、「超频」按台数计）
export const MECH_KINDS = ALL_KINDS.filter(k => UNITS[k].mech === true)

export const HEAVY_KINDS = UNIT_KINDS.filter(k => UNITS[k].cls === 'heavy' && UNITS[k].implemented)

// 门剧本里 重型A/B/C 的顺序；C 是数组时每局按种子抽一种
export const HEAVY_PLAN = ['titan', 'lancer', ['reaper', 'psion', 'skyhook']]
