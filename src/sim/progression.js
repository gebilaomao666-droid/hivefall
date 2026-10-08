// 经验、升级暂停、发牌（固定剧本 / 随机草稿）、重掷、模块聚合 mods、联动与英雄级判定、过载。
import { UNITS, UNIT_KINDS, ALL_KINDS } from '../data/units.js'
import { MODULES, MOD_DEFAULTS, GLOBAL_DEFAULTS, DRAFT_SCRIPT, DRAFT_GUARD, DRAFT_WEIGHTS, XP_TABLE, XP_AFTER, XP_GROWTH, OVERDRIVE, REROLLS, CALIBRATE_DMG, LEVEL_DMG, LEVEL_DMG_CAP } from '../data/modules.js'
import { COMBOS, HEROICS, HEROIC_BY_UNIT } from '../data/combos.js'
import { NAME_POOL_SIZE, SQUAD_NAME_COUNT, nameKey, squadNameKey } from '../data/names.js'
import { refreshHp, healAll } from './squad.js'
import { ENDLESS } from '../data/endless.js'
import { createDeviceMods, unlockDevice, nextLocked } from './devices.js'
import { DEVICE_MOD_DEFAULTS } from '../data/devices.js'

const MODULE_LIST = Object.values(MODULES)
const COMBO_LIST = Object.values(COMBOS)
// 上一轮亮过没选的牌，这一轮扣这么多分（主力剧本位 +120，通用牌 +8 上下）
const DRAFT_REPEAT = 30
const BIG_XP = 8   // 只有大块经验才发 xp 事件，小虫的 1 点不值得一个事件

export function createProgress() {
  return {
    level: 1, xp: 0, xpNext: XP_TABLE[0], xpPrev: 0,
    modules: {}, combos: [], heroics: [], overdriveUntil: OVERDRIVE.start,
    // 内部 / 战报
    picks: [], focus: 'rifle', rerolls: REROLLS, stimT0: 0, upgrades: 0, named: [],
    squads: [],     // 英雄级小队：{ heroic, unit, squadName, t }
    _offered: [],   // 上一轮亮出来的牌 id（发牌时给没选的降权）
  }
}

export function createMods() {
  const mods = { global: { ...GLOBAL_DEFAULTS }, device: createDeviceMods() }
  for (const k of ALL_KINDS) mods[k] = { ...MOD_DEFAULTS }
  return mods
}

function xpThreshold(n) {
  // 第 n 次升级（0 起）需要的累计经验
  if (n < XP_TABLE.length) return XP_TABLE[n]
  let inc = XP_AFTER / XP_GROWTH
  let v = XP_TABLE[XP_TABLE.length - 1]
  for (let k = XP_TABLE.length; k <= n; k++) { inc *= XP_GROWTH; v += inc }
  return Math.round(v)
}

export function addXp(world, amount, x, z) {
  const gain = amount * world.stats.comboMult * world.mods.global.xpMul
  world.progress.xp += gain
  const c = world.companion
  if (c !== null) c.xp += gain * c._xpMul * world.mods.global.compXp
  if (amount >= BIG_XP) world.events.push({ type: 'xp', x, z, amount: gain })
}

function applyEffects(mods, effects, lvl) {
  for (const e of effects) {
    const target = e.unit === '*' ? mods.global : mods[e.unit]
    target[e.key] += e.add * lvl
  }
}

// 模块 / 联动 / 英雄级 → mods。每次拿牌后整体重算，武器代码只读结果。
export function recomputeMods(world) {
  const mods = world.mods, p = world.progress
  Object.assign(mods.global, GLOBAL_DEFAULTS)
  Object.assign(mods.device, DEVICE_MOD_DEFAULTS)
  for (const k of ALL_KINDS) Object.assign(mods[k], MOD_DEFAULTS)
  for (const id in p.modules) applyEffects(mods, MODULES[id].effects, p.modules[id])
  for (const id of p.combos) applyEffects(mods, COMBOS[id].effects, 1)
  for (const id of p.heroics) mods[HEROICS[id].unit].heroic = 1
  // 无尽的强化（属性门 world.buffs + 通用牌「超载弹药」「射击校准」）：战役里全是 0，乘 1 不改变任何结果
  const b = world.buffs
  mods.global.hpAdd += b.hp
  const bonus = 1 + mods.global.dmgBonus + b.dmg
  world.rateMul = Math.max(0.5, 1 + mods.global.rateBonus + b.rate)
  world.dmgMul = (1 + CALIBRATE_DMG * mods.global.calibrate + LEVEL_DMG * Math.min(p.level - 1, LEVEL_DMG_CAP)) * bonus
  // 破片、燃烧这类附带伤害只吃武器校准，不吃等级加成：否则密集虫群里连锁过强
  world.modDmgMul = (1 + CALIBRATE_DMG * mods.global.calibrate) * bonus
  refreshHp(world)
}

const comboDone = (needs, modules, extraId) => {
  for (const id in needs) if ((modules[id] || 0) + (id === extraId ? 1 : 0) < needs[id]) return false
  return true
}

// 再拿一级 id 会不会凑成新的联动
function completesCombo(p, id) {
  for (const c of COMBO_LIST) {
    if (!(id in c.needs) || p.combos.includes(c.id)) continue
    if (comboDone(c.needs, p.modules, id)) return c.id
  }
  return null
}

function heroicReady(modules, unit, extraId) {
  let all = true, maxed = false
  for (const m of MODULE_LIST) {
    if (m.unit !== unit) continue
    const lvl = (modules[m.id] || 0) + (m.id === extraId ? 1 : 0)
    if (lvl < 1) all = false
    if (m.max > 1 && lvl >= m.max) maxed = true
  }
  return all && maxed
}

function completesHeroic(p, m) {
  const h = m.unit && HEROIC_BY_UNIT[m.unit]
  if (!h || p.heroics.includes(h.id)) return null
  return heroicReady(p.modules, m.unit, m.id) ? h.id : null
}

function available(world) {
  const p = world.progress, sq = world.squad, list = []
  for (const m of MODULE_LIST) {
    if ((p.modules[m.id] || 0) >= m.max) continue
    if (m.unit && !(sq.counts[m.unit] > 0)) continue
    if (m.minLevel && p.level < m.minLevel) continue
    if (m.lineBelow && world.line.hp >= world.line.hpMax * m.lineBelow) continue
    if (m.needsCommander && world.opts.commander === 'none') continue
    if (m.endlessOnly && world.phase !== 'endless') continue
    if (m.needsCompanion && (world.companion === null || world.companion.stage >= 3)) continue
    // 装置牌：那种装置解锁了才出；解锁牌一次只出「下一种还没有的」
    if (m.device && !world._dev.unlocked[m.device]) continue
    if (m.unlock && nextLocked(world) !== m.unlock) continue
    list.push(m)
  }
  return list
}

function makeCard(world, m) {
  const p = world.progress, cur = p.modules[m.id] || 0, level = cur + 1
  return {
    id: m.id, kind: m.unit ? 'module' : m.line === 'device' ? 'device' : 'general', unit: m.unit, moduleId: m.id,
    device: m.device || m.unlock || null, unlock: m.unlock || null,     // 装置牌：作用的装置 kind；unlock 不为 null 的是解锁牌
    level, maxLevel: m.max,
    rarity: m.equip || (m.max >= 3 && level === m.max) ? 'elite' : 'common',
    equip: m.equip, from: m.value(cur), to: m.value(level),
    completes: completesCombo(p, m.id), heroic: completesHeroic(p, m),
    nameKey: m.nameKey, descKey: m.descKey,
  }
}

// 主力兵种 = 还有牌可拿的兵种里人数最多的；人数相同时取最近过门拿到的那种（p.focus）。
// 不直接用「最近拿的兵种」：拿一台重型就把第 1 张牌让给它，主力的成长线会断档，中期大波顶不住。
function focusKind(world, list) {
  const p = world.progress, sq = world.squad
  let best = null, n = 0
  for (const k of UNIT_KINDS) {
    const c = sq.counts[k]
    if (c <= 0 || c < n || (c === n && k !== p.focus) || !list.some(m => m.unit === k)) continue
    best = k; n = c
  }
  return best
}

function dealScript(world, count) {
  const p = world.progress, rng = world.rng.draft
  const list = available(world)
  const slot = DRAFT_SCRIPT[p.upgrades % DRAFT_SCRIPT.length]
  const focus = focusKind(world, list)
  // 最近过门拿到的新兵种：第 2 张优先给它，同样按剧本位出
  const fresh = p.focus !== focus && world.squad.counts[p.focus] > 0 ? p.focus : null
  // 上一轮亮过、没被选的牌这一轮降权（第 2 轮测试：碎甲弹头 / 战斗药剂 / 粘稠燃剂一轮接一轮原样出现，三选一像只有一张）。
  // 第 1 张（剧本位）不看这个，照旧按剧本出；降权只影响第 2、3 张
  const last = p.picks.length > 0 ? p.picks[p.picks.length - 1] : null
  const passed = p._offered.filter(id => id !== last)
  const scored = list.map(m => {
    let s = rng()   // 同分时的抖动
    if (m.unit && m.unit === focus) {
      s += 20
      if (m.line === slot) s += 100
      else if (slot === 'late' && m.line === 'main') s += 60
    } else if (m.unit && m.unit === fresh) {
      s += 15
      if (m.line === slot) s += 60
      else if (m.line === 'main') s += 30
    }
    if (slot === 'calibrate' && m.id === 'gen_calibrate') s += 130
    if (completesCombo(p, m.id)) s += 40
    if (completesHeroic(p, m)) s += 50
    if (m.equip) s += 5
    if (m.id === 'gen_durability') s -= 10
    else if (m.id === 'gen_repair') s += 15
    else if (m.unlock) s += 12
    else if (!m.unit) s += 8
    return { m, s, sp: passed.includes(m.id) ? s - DRAFT_REPEAT : s }
  }).sort((a, b) => b.s - a.s)
  const rescored = scored.slice().sort((a, b) => b.sp - a.sp)

  const picked = []
  const take = (pred, from = rescored) => {
    const k = from.findIndex(e => !picked.includes(e.m) && pred(e.m))
    if (k >= 0) picked.push(from[k].m)
    return k >= 0
  }
  // 兜底（data/modules.js 的 DRAFT_GUARD）：主力的成长落后于进度时，这一次三张都出主力牌
  let grown = p.modules.gen_calibrate || 0
  for (const id in p.modules) if (MODULES[id].unit === focus) grown += p.modules[id]
  const isFocus = m => m.unit === focus
  if (focus !== null && world.phase === 'campaign' && p.upgrades - grown >= DRAFT_GUARD.slack + Math.floor(p.upgrades / DRAFT_GUARD.every)) {
    // 兜底这一轮不看「上一轮没选」的降权：它是保命用的，照原来的分数出
    while (picked.length < 3 && take(isFocus, scored));
    // 主力的牌不够三张（有的已经满级）：先补武器校准，再补别的兵种的牌——兜底的这一轮不出装置 / 杂项牌
    if (picked.length < 3) take(m => m.id === 'gen_calibrate', scored)
    while (picked.length < 3 && take(m => !!m.unit, scored));
  } else {
    take(() => true, scored)                                           // 第 1 张：剧本位（不降权）
    take(m => m.unit && m.unit !== picked[0].unit) || take(() => true)  // 第 2 张：换个兵种
    // 第 3 张：通用牌与装置牌轮流（奇数次升级出装置牌）。不轮流的话，装置牌要么把武器校准挤没，要么永远排不上
    const devTurn = p.upgrades % 2 === 1
    take(m => !m.unit && (m.line === 'device') === devTurn) || take(m => !m.unit) || take(() => true)
  }
  while (picked.length < count && take(() => true));
  return picked.slice(0, count).map(m => makeCard(world, m))
}

function dealRandom(world, count) {
  const p = world.progress, rng = world.rng.draft
  const pool = available(world).map(m => {
    let w = DRAFT_WEIGHTS.base
    if (completesCombo(p, m.id)) w *= DRAFT_WEIGHTS.completes
    if (m.equip) w *= DRAFT_WEIGHTS.equip
    if (m.id === 'gen_calibrate') w *= DRAFT_WEIGHTS.calibrate
    if (m.id === 'gen_durability') w *= DRAFT_WEIGHTS.durability
    if (m.line === 'device') w *= DRAFT_WEIGHTS.device
    return { m, w }
  })
  const cards = []
  while (cards.length < count && pool.length > 0) {
    let total = 0
    for (const e of pool) total += e.w
    let r = rng() * total, k = 0
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++
    cards.push(makeCard(world, pool[k].m))
    pool.splice(k, 1)
  }
  return cards
}

function openLevelup(world) {
  const p = world.progress
  // 无尽 16 层后四选一
  const n = world.endless !== null && world.endless.layer >= ENDLESS.fourCardsFrom ? 4 : 3
  const cards = world.opts.draft === 'random' ? dealRandom(world, n) : dealScript(world, n)
  p._offered = cards.map(c => c.id)
  world.levelup = { level: p.level, cards, rerolls: p.rerolls, kind: 'upgrade' }
  world.status = 'levelup'
  world.events.push({ type: 'levelUp', level: p.level })
  if (p.upgrades === 0) world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_levelup' })
}

// 英雄级触发：给现役单位起名字
function nameUnits(world, h) {
  const rng = world.rng.draft, p = world.progress
  const squadName = squadNameKey(h.unit, rng.int(SQUAD_NAME_COUNT[h.unit] || 1))
  const start = rng.int(NAME_POOL_SIZE)
  let n = 0
  for (const u of world.squad.units) {
    if (!u.alive || u.kind !== h.unit || u.name) continue
    u.name = nameKey((start + n * 7) % NAME_POOL_SIZE)
    p.named.push({ id: u.id, kind: u.kind, name: u.name })
    n++
  }
  p.squads.push({ heroic: h.id, unit: h.unit, squadName, t: Math.round(world.time * 10) / 10 })
  return squadName
}

// 拿一级模块（升级选牌、门的降级选项都走这里）
export function grantModule(world, id) {
  const p = world.progress, m = MODULES[id]
  p.modules[id] = (p.modules[id] || 0) + 1
  if (id === 'rifle_stim') p.stimT0 = world.time
  for (const c of COMBO_LIST) {
    if (p.combos.includes(c.id) || !comboDone(c.needs, p.modules, null)) continue
    p.combos.push(c.id)
    world.events.push({ type: 'combo', id: c.id })
    if (p.combos.length === 1) world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_combo' })
  }
  const h = m.unit && HEROIC_BY_UNIT[m.unit]
  if (h && !p.heroics.includes(h.id) && heroicReady(p.modules, m.unit, null)) {
    p.heroics.push(h.id)
    const squadName = nameUnits(world, h)
    world.events.push({ type: 'heroic', id: h.id, unit: h.unit, squadName })
    if (p.heroics.length === 1) world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_heroic' })
    world.events.push({ type: 'hitstop', ms: 60 })
  }
  recomputeMods(world)
  if (m.instant === 'unlock') unlockDevice(world, m.unlock)
  if (m.instant === 'healAll') healAll(world)
  else if (m.instant === 'repair') {
    world.line.hp = Math.min(world.line.hpMax, world.line.hp + m.amount)
    world.events.push({ type: 'heal', amount: m.amount, target: 'line' })
  }
}

function pick(world, index) {
  const lu = world.levelup, p = world.progress
  const card = lu.cards[index]
  if (!card) return
  if (lu._onPick) {
    // 特殊的三选一（无尽第 10 层「盟军先遣队」）：不算升级，不进卡牌记录
    world.events.push({ type: 'cardPicked', card })
    world.levelup = null
    world.status = 'running'
    lu._onPick(world, card)
    return
  }
  p.picks.push(card.id)
  p.upgrades++
  world.events.push({ type: 'cardPicked', card })
  grantModule(world, card.moduleId)
  world.levelup = null
  world.status = 'running'
  if (p.upgrades % OVERDRIVE.every === 0) {
    p.overdriveUntil = world.time + OVERDRIVE.dur
    world.events.push({ type: 'overdrive', dur: OVERDRIVE.dur })
  }
}

// status === 'levelup' 时每步调用：处理选牌与重掷。时间不前进。
export function handleLevelup(world, input) {
  if (!input) return
  const lu = world.levelup, p = world.progress
  if (input.reroll && lu.rerolls > 0 && !lu._onPick) {
    p.rerolls--
    lu.rerolls = p.rerolls
    lu.cards = dealRandom(world, lu.cards.length || 3)
    return
  }
  if (input.pick != null) pick(world, input.pick)
}

export function update(world) {
  const p = world.progress
  if (world.status !== 'running' || p.xp < p.xpNext) return
  p.level++
  p.xpPrev = p.xpNext
  p.xpNext = xpThreshold(p.level - 1)
  recomputeMods(world)   // 等级也加伤害
  openLevelup(world)
}
