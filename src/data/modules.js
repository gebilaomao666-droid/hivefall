// 战地升级模块。结构见 docs/GDD.md §5：每兵种 2~3 条数值线 + 1~2 张装备。
// effects 里的 add 是「每级」增量，聚合进 world.mods[unit][key]；武器代码只读 mods，不认模块名。
// line: main 主线 / side 副线 / equip 装备 / late 后期 —— 固定剧本发牌按它对号入座。
// value(l): 卡面「当前值 -> 新值」用的展示值。

// 每个兵种一份的聚合结果默认值（所有可被模块改动的参数都在这里登记）
export const MOD_DEFAULTS = {
  dmgMul: 1, rateMul: 1, rangeAdd: 0, hpAdd: 0, regen: 0,
  // 突击兵
  pierce: 0, pierceRange: 0, doubleEvery: 0, doubleDmgMul: 1, doublePierce: 0,
  frag: 0, fragDmg: 0.55, fragR: 1.2, fragRMul: 1, fragMax: 4, fragOnPierce: 0,
  stim: 0, stimPeriod: 6, stimDur: 3, stimMul: 1.7,
  // 焚化兵
  arcAdd: 0, napalm: 0, napalmDur: 1.8, napalmDurMul: 1, napalmTick: 0.3, napalmDmg: 1.5, napalmR: 2.1,
  // 炮
  radiusAdd: 0, vsHeavyAdd: 0, targetsAdd: 0,
  cluster: 0, clusterN: 3, clusterDmg: 5, clusterR: 2, clusterDmgMul: 1, ignite: 0,
  salvo: 0, salvoEvery: 3, salvoShells: 4, salvoAdd: 0,
  // 「破城」轨道炮
  bossMul: 1, jumpsAdd: 0, echo: 0, echoEvery: 3, echoShots: 2, echoAdd: 0,
  barrage: 0, barrageEvery: 10, barrageShots: 12, barrageR: 1.4, barrageMax: 6,
  // 「裁决」光束步行机
  widthAdd: 0, slow: 0, slowDur: 1.2, scorch: 0, scorchBase: 0.8, scorchPer: 1.2, scorchDmg: 3, scorchTick: 0.4, scorchDmgMul: 1, scorchDurAdd: 0,
  back: 0, backDelay: 0.35, backDmg: 0.6,
  // 灵能者
  shieldAdd: 0, twin: 0, twinEvery: 2, stormDmgMul: 1, discharge: 0, dischargeMul: 1.5, dischargeCd: 0.5,
  // 「天钩」无人机群
  dronesAdd: 0, flak: 0, flakR: 1.5, flakRMul: 1, flakDmg: 0.5, flakDmgMul: 1, flakMax: 5, tether: 0, tetherDur: 2, mark: 0,
  heroic: 0,
}

// dmgBonus / rateBonus: 无尽通用牌的全军加成；compXp: 伙伴无人机的成长倍率
export const GLOBAL_DEFAULTS = { calibrate: 0, xpMul: 1, cdMul: 1, hpAdd: 0, shieldAdd: 0, dmgBonus: 0, rateBonus: 0, compXp: 1 }

// 护盾：受击 delay 秒后每秒回 rate 点
export const SHIELD = { delay: 2.5, rate: 6 }
// 被「标定」的虫：护甲失效，受伤 ×dmgMul
export const MARK = { dmgMul: 1.25 }

export const CALIBRATE_DMG = 0.25     // 每级武器校准
export const LEVEL_DMG = 0.06         // 每次升级
export const LEVEL_DMG_CAP = 9

const pct = per => l => { const v = Math.round(per * l); return (v < 0 ? '-' : per < 0 ? '' : '+') + Math.abs(v) + '%' }   // 负向（冷却 / 花费 -12%）显示「0% → -12%」，别拼成「+-12%」
const num = (per, base = 0, unit = '') => l => `${Math.round((base + per * l) * 100) / 100}${unit}`
const onoff = l => (l > 0 ? 'on' : 'off')

const M = (id, unit, line, max, effects, value, extra = {}) => ({
  id, unit, line, max, equip: line === 'equip', effects, value,
  nameKey: `module.${id}.name`, descKey: `module.${id}.desc`, ...extra,
})

export const MODULES = {
  // ---- 突击兵 ----
  // 第 1 轮测试把升级从一局 12 次压到 8~9 次：每张牌得更值，「总拿第 2 / 第 3 张」才不会变成必败（射速 +20% → +25%、兴奋剂 ×1.6·2 秒 → ×1.7·3 秒、追加弹每 4 发 → 每 3 发）
  rifle_rate: M('rifle_rate', 'rifle', 'side', 3, [{ unit: 'rifle', key: 'rateMul', add: 0.25 }], pct(25)),
  rifle_pierce: M('rifle_pierce', 'rifle', 'main', 3, [{ unit: 'rifle', key: 'pierce', add: 1 }, { unit: 'rifle', key: 'pierceRange', add: 1 }], num(1, 1)),
  rifle_double: M('rifle_double', 'rifle', 'equip', 1, [{ unit: 'rifle', key: 'doubleEvery', add: 3 }], onoff),
  rifle_frag: M('rifle_frag', 'rifle', 'equip', 1, [{ unit: 'rifle', key: 'frag', add: 1 }], onoff),
  rifle_stim: M('rifle_stim', 'rifle', 'equip', 1, [{ unit: 'rifle', key: 'stim', add: 1 }, { unit: 'flamer', key: 'stim', add: 1 }], onoff),
  // ---- 焚化兵 ----
  flamer_nozzle: M('flamer_nozzle', 'flamer', 'main', 3, [{ unit: 'flamer', key: 'rangeAdd', add: 0.5 }, { unit: 'flamer', key: 'arcAdd', add: 12 }], num(0.5, 6.8, 'm')),
  flamer_heat: M('flamer_heat', 'flamer', 'side', 2, [{ unit: 'flamer', key: 'dmgMul', add: 0.3 }], pct(30)),
  flamer_armor: M('flamer_armor', 'flamer', 'side', 2, [{ unit: 'flamer', key: 'hpAdd', add: 18 }, { unit: 'flamer', key: 'regen', add: 0.02 }], num(18, 36)),
  flamer_napalm: M('flamer_napalm', 'flamer', 'equip', 1, [{ unit: 'flamer', key: 'napalm', add: 1 }], onoff),
  // ---- 「雷锤」自行炮 ----
  mortar_loader: M('mortar_loader', 'mortar', 'side', 3, [{ unit: 'mortar', key: 'rateMul', add: 0.25 }], pct(25)),
  mortar_blast: M('mortar_blast', 'mortar', 'main', 3, [{ unit: 'mortar', key: 'radiusAdd', add: 0.65 }], num(0.65, 3.6, 'm')),
  mortar_ap: M('mortar_ap', 'mortar', 'side', 2, [{ unit: 'mortar', key: 'vsHeavyAdd', add: 0.5 }], pct(50)),
  mortar_saturate: M('mortar_saturate', 'mortar', 'late', 3, [{ unit: 'mortar', key: 'targetsAdd', add: 12 }], num(12, 36), { minLevel: 5 }),
  mortar_cluster: M('mortar_cluster', 'mortar', 'equip', 1, [{ unit: 'mortar', key: 'cluster', add: 1 }], onoff),
  // ---- 「泰坦」机甲 ----
  titan_servo: M('titan_servo', 'titan', 'side', 3, [{ unit: 'titan', key: 'rateMul', add: 0.25 }], pct(25)),
  titan_warhead: M('titan_warhead', 'titan', 'main', 3, [{ unit: 'titan', key: 'radiusAdd', add: 0.5 }], num(0.5, 3, 'm')),
  titan_salvo: M('titan_salvo', 'titan', 'equip', 1, [{ unit: 'titan', key: 'salvo', add: 1 }], onoff),
  // ---- 「破城」轨道炮 ----
  lancer_amp: M('lancer_amp', 'lancer', 'main', 3, [{ unit: 'lancer', key: 'vsHeavyAdd', add: 0.3 }, { unit: 'lancer', key: 'bossMul', add: 0.3 }], pct(30)),
  lancer_reach: M('lancer_reach', 'lancer', 'side', 2, [{ unit: 'lancer', key: 'rangeAdd', add: 2 }, { unit: 'lancer', key: 'jumpsAdd', add: 1 }], num(2, 19, 'm')),
  lancer_echo: M('lancer_echo', 'lancer', 'equip', 1, [{ unit: 'lancer', key: 'echo', add: 1 }], onoff),
  lancer_barrage: M('lancer_barrage', 'lancer', 'equip', 1, [{ unit: 'lancer', key: 'barrage', add: 1 }], onoff),
  // ---- 「裁决」光束步行机 ----
  reaper_lens: M('reaper_lens', 'reaper', 'main', 3, [{ unit: 'reaper', key: 'widthAdd', add: 1.4 }], num(1.4, 8, 'm')),
  reaper_overheat: M('reaper_overheat', 'reaper', 'side', 3, [{ unit: 'reaper', key: 'rateMul', add: 0.25 }, { unit: 'reaper', key: 'slow', add: 0.1 }], pct(25)),
  reaper_scorch: M('reaper_scorch', 'reaper', 'side', 2, [{ unit: 'reaper', key: 'scorch', add: 1 }], num(1.2, 0.8, 's')),
  reaper_return: M('reaper_return', 'reaper', 'equip', 1, [{ unit: 'reaper', key: 'back', add: 1 }], onoff),
  // ---- 灵能者 ----
  psion_focus: M('psion_focus', 'psion', 'main', 3, [{ unit: 'psion', key: 'rateMul', add: 0.2 }, { unit: 'psion', key: 'radiusAdd', add: 0.35 }], num(0.35, 3.1, 'm')),
  psion_veil: M('psion_veil', 'psion', 'side', 2, [{ unit: 'psion', key: 'shieldAdd', add: 50 }, { unit: '*', key: 'shieldAdd', add: 5 }], num(5, 0)),
  psion_twin: M('psion_twin', 'psion', 'equip', 1, [{ unit: 'psion', key: 'twin', add: 1 }], onoff),
  // ---- 「天钩」无人机群 ----
  skyhook_wing: M('skyhook_wing', 'skyhook', 'main', 3, [{ unit: 'skyhook', key: 'dronesAdd', add: 1 }], num(1, 3)),
  skyhook_servo: M('skyhook_servo', 'skyhook', 'side', 3, [{ unit: 'skyhook', key: 'rateMul', add: 0.2 }], pct(20)),
  skyhook_flak: M('skyhook_flak', 'skyhook', 'equip', 1, [{ unit: 'skyhook', key: 'flak', add: 1 }], onoff),
  skyhook_tether: M('skyhook_tether', 'skyhook', 'equip', 1, [{ unit: 'skyhook', key: 'tether', add: 1 }], onoff),

  // ---- 通用牌（unit: null）----
  gen_calibrate: M('gen_calibrate', null, 'general', 3, [{ unit: '*', key: 'calibrate', add: 1 }], pct(25)),
  // 兜底牌：永远发得出来
  gen_durability: M('gen_durability', null, 'general', 99, [{ unit: '*', key: 'hpAdd', add: 2 }], num(2, 0), { instant: 'healAll' }),
  gen_repair: M('gen_repair', null, 'general', 99, [], num(200, 0), { instant: 'repair', amount: 200, lineBelow: 0.85 }),
  // 战役里 +5% 经验换不来一次额外升级，只会挤掉一张有用的牌：只在无尽里出
  gen_doctrine: M('gen_doctrine', null, 'general', 1, [{ unit: '*', key: 'xpMul', add: 0.05 }], pct(5), { minLevel: 4, endlessOnly: true }),
  gen_logistics: M('gen_logistics', null, 'general', 3, [{ unit: '*', key: 'cdMul', add: -0.12 }], pct(-12), { needsCommander: true }),
  // 仅无尽：不封顶的小加成，保证后期每次升级都有牌可拿
  gen_overload: M('gen_overload', null, 'general', 999, [{ unit: '*', key: 'dmgBonus', add: 0.03 }], pct(3), { endlessOnly: true }),
  gen_tuning: M('gen_tuning', null, 'general', 999, [{ unit: '*', key: 'rateBonus', add: 0.02 }], pct(2), { endlessOnly: true }),
  // 给伙伴无人机「小七」加餐：成长 +25%。每张在结算时折 1 个培养点（最多 3）
  gen_treat: M('gen_treat', null, 'general', 3, [{ unit: '*', key: 'compXp', add: 0.25 }], pct(25), { needsCompanion: true }),

  // ---- 装置牌（GDD §13；unit: null, line: 'device'）。device: 这种装置已解锁才出；effects 聚合进 world.mods.device ----
  dev_sentry_rate: M('dev_sentry_rate', null, 'device', 3, [{ unit: 'device', key: 'sentryRate', add: 0.25 }], pct(25), { device: 'sentry' }),
  dev_sentry_pierce: M('dev_sentry_pierce', null, 'device', 2, [{ unit: 'device', key: 'sentryPierce', add: 1 }], num(1, 1), { device: 'sentry' }),
  dev_collector_yield: M('dev_collector_yield', null, 'device', 3, [{ unit: 'device', key: 'collectorAdd', add: 5 }], num(5, 25), { device: 'collector' }),
  dev_barricade_thorns: M('dev_barricade_thorns', null, 'device', 2, [{ unit: 'device', key: 'thorns', add: 3 }], num(3, 0), { device: 'barricade' }),
  dev_mine_chain: M('dev_mine_chain', null, 'device', 2, [{ unit: 'device', key: 'mineChain', add: 1 }], num(1, 0), { device: 'mine' }),
  dev_cryo_freeze: M('dev_cryo_freeze', null, 'device', 1, [{ unit: 'device', key: 'cryoFreeze', add: 1 }], onoff, { device: 'cryo' }),
  // 通用「工程兵」：全部装置花费 -15% / 级
  dev_engineer: M('dev_engineer', null, 'device', 2, [{ unit: 'device', key: 'costMul', add: -0.15 }], pct(-15)),
  // 解锁牌：每次只出「下一种还没解锁的」那一张（顺序见 data/devices.js 的 DEVICE_UNLOCK_ORDER）
  dev_unlock_cryo: M('dev_unlock_cryo', null, 'device', 1, [], onoff, { unlock: 'cryo', instant: 'unlock' }),
  dev_unlock_mortarpit: M('dev_unlock_mortarpit', null, 'device', 1, [], onoff, { unlock: 'mortarpit', instant: 'unlock' }),
  dev_unlock_scorcher: M('dev_unlock_scorcher', null, 'device', 1, [], onoff, { unlock: 'scorcher', instant: 'unlock' }),
  dev_unlock_nova: M('dev_unlock_nova', null, 'device', 1, [], onoff, { unlock: 'nova', instant: 'unlock' }),
}

// 固定剧本发牌：第 n 次升级围绕主力兵种出哪条线
export const DRAFT_SCRIPT = ['side', 'main', 'equip', 'equip', 'calibrate', 'main', 'side', 'equip', 'late', 'calibrate']

// 固定剧本的兜底（只在战役里生效）。首关里主力兵种占全队伤害七成以上，连着几次不给它升级就守不住 60 秒那一波。
// 「偏离」= 没拿主力兵种的牌、也没拿武器校准的那些升级。偏离次数达到 slack + floor(已升级次数 / every) 时，
// 这一次三张牌全部出主力兵种的。也就是前 5 次升级里可以偏 1 次，之后每 5 次再多 1 次：
// 选择仍有后果（实测「总选第 3 张」要多赔十几个人），但「总选第 2 / 第 3 张」不再必败。
export const DRAFT_GUARD = { slack: 1, every: 8 }

// 随机草稿权重
export const DRAFT_WEIGHTS = { base: 1, completes: 3, equip: 1.3, calibrate: 1.5, durability: 0.4, device: 0.45 }

// 累计经验阈值；表之后每级增量从 XP_AFTER 起、每级 ×XP_GROWTH（无尽用）。
// 第 1 轮测试后重排：一局（约 120 秒）8 次升级、前密后疏（约 14 / 24 / 36 / 48 / 60 / 72 / 86 / 102 秒），
// 参考游戏 87 秒 8 次；原表一局 12 次、约 12 秒一次全屏暂停，打断太多。第 9 级（36000）战役里基本够不着
// 第 2 轮测试：「升级面板仍约 11 秒弹一次」——旧表实际是匀速的 14 / 25 / 36 / 48 / 59 / 73 / 85 / 101 秒。
// 改成真正的前密后疏：约 9 / 16 / 23 / 31 / 41 / 53 / 69 / 88 秒，开局半分钟拿到 4 张牌成形，守线阶段十几二十秒才打断一次
// 第 4 轮测试（用户实玩：「开局经验涨得飞快」）：虫潮改成从少到多之后重排——第一次升级约 17 秒（先熟悉移动、选门、放装置），
// 之后约 27 / 37 / 46 / 55 / 64 / 76 / 89 秒，前期间隔 9~10 秒（上一版 5 秒），一局仍是 8 次（第 8 次在 Boss 战里，和上一版一样）；
// 末级 40000 不动：无尽沿用同一张阈值表（表之后按 XP_AFTER / XP_GROWTH 递增），无尽的升级节奏不受影响
export const XP_TABLE = [65, 220, 560, 1130, 2050, 5900, 16000, 27000, 40000]
export const XP_AFTER = 6500
export const XP_GROWTH = 1.12

export const OVERDRIVE = { start: 4, every: 3, dur: 2 }
export const REROLLS = 1
