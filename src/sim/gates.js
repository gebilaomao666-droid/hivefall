// 增援门：出现、滑向队伍、按队伍 x 正负结算。
import { GATE, GATE_SCRIPT, GATE_UNITS, gateCounts, UNIT_VALUE, OPTION_VALUE, FAIR_RATIO, FAIR_CANDIDATES } from '../data/gates.js'
import { UNITS } from '../data/units.js'
import { MODULES } from '../data/modules.js'
import { addUnits, capRoom, healAll } from './squad.js'
import { grantModule } from './progression.js'
import { contractOption, dropPod } from './contracts.js'
import { HEAVY_KINDS } from '../data/units.js'
import { ENDLESS, GATE_DRAFT, BOONS, BOONS_COST, BOONS_FREE, BOONS_BOUNTY, BOON_COST_CHANCE, BOUNTY_INFANTRY } from '../data/endless.js'
import { recomputeMods } from './progression.js'
import { DEVICES, GATE_DEVICE_ENERGY } from '../data/devices.js'
import { nextLocked, unlockDevice, gainEnergy } from './devices.js'

// 装置门：解锁下一种还没有的装置，附送一笔晶能。都解锁了返回 null
export function deviceOption(world) {
  const kind = nextLocked(world)
  if (kind === null) return null
  return {
    type: 'device', unit: null, count: 0, extra: null, tags: ['device'], titleKey: 'gate.device',
    params: { device: kind, nameKey: DEVICES[kind].nameKey, energy: GATE_DEVICE_ENERGY },
  }
}

const unitOption = (kind, count, extra = null) => ({
  type: 'unit', unit: kind, count, extra, tags: UNITS[kind].tags,
  titleKey: extra ? 'gate.unit_escort' : 'gate.unit',
  params: { count, unitKey: UNITS[kind].nameKey, extraCount: extra ? extra.count : 0, extraKey: extra ? UNITS[extra.unit].nameKey : null },
})

function nextHeavy(world, peek = false) {
  // 重型 A/B/C 依次出（world.heavyPlan：泰坦 / 破城 / 按种子抽的第三种）；已满的回落到还能加的那种。
  // peek：只看不拿（门的公平估值试候选项时用，不推进剧本）
  const plan = world.heavyPlan
  const start = peek ? world._dir.heavyIdx : world._dir.heavyIdx++
  for (let k = 0; k < plan.length; k++) {
    const kind = plan[(start + k) % plan.length]
    if (capRoom(world, kind) > 0) return kind
  }
  return plan[0]
}

// 满编时的降级：送一级模块，再不行给全队耐久
function fallback(world, other) {
  const p = world.progress, sq = world.squad
  let best = null
  for (const m of Object.values(MODULES)) {
    if (!m.unit || m.equip || !(sq.counts[m.unit] > 0) || (p.modules[m.id] || 0) >= m.max) continue
    if (m.minLevel && p.level < m.minLevel) continue
    if (other && other.type === 'module' && other.params.moduleId === m.id) continue
    if (!best || sq.counts[m.unit] > sq.counts[best.unit]) best = m
  }
  if (best) return { type: 'module', unit: best.unit, count: 1, extra: null, tags: ['upgrade'], titleKey: 'gate.module', params: { moduleId: best.id, nameKey: best.nameKey } }
  return { type: 'stat', unit: null, count: 2, extra: null, tags: ['upgrade'], titleKey: 'gate.durability', params: { moduleId: 'gen_durability', amount: 2 } }
}

// 护卫只写进得了编制的人数（以前满编时门上照写「护卫 +4」，过门一个都不来）
const escort = (world, count) => {
  const n = Math.min(count, capRoom(world, 'rifle'))
  return n > 0 ? { unit: 'rifle', count: n } : null
}

function buildOption(world, item, idx, other, peek = false) {
  const c = gateCounts(idx)
  let opt
  if (item === 'device') {
    const dev = deviceOption(world)
    if (dev !== null) return dev
    item = GATE_SCRIPT[idx] ? GATE_SCRIPT[idx].altFallback || 'front' : 'front'
  }
  if (item === 'module') return fallback(world, other)
  if (item === 'opener') item = world.rng.gates() < 0.5 ? 'front' : 'artillery'
  if (item === 'infantry' || item === 'front') {
    const kind = GATE_UNITS[item]
    const n = Math.min(c[item], capRoom(world, kind))
    // 快满编时只剩一两个空位：「+1 突击兵」不值一道门，直接降级成模块 / 耐久
    opt = unitOption(kind, n >= Math.ceil(c[item] * 0.5) ? n : 0)
  } else if (item === 'artillery') {
    opt = unitOption('mortar', Math.min(1, capRoom(world, 'mortar')), escort(world, c.escort))
  } else if (item === 'heavy') {
    const kind = nextHeavy(world, peek)
    // 重型也带护卫（和自行炮一样）：一台重型换十个步兵太亏，质量这条路走不通
    opt = unitOption(kind, Math.min(1, capRoom(world, kind)), c.heavyEscort > 0 ? escort(world, c.heavyEscort) : null)
  } else {
    // reinforce：补员 + 全队回血，永远有用，不降级
    // 满编时没人可补：标题换成只说回血的那一句，不写「补员 +0」（第 3 轮测试）
    const n = Math.min(c.infantry, capRoom(world, 'rifle'))
    return { type: 'heal', unit: 'rifle', count: n, extra: null, tags: ['heal'], titleKey: n > 0 ? 'gate.reinforce' : 'gate.heal', params: { count: n, unitKey: UNITS.rifle.nameKey } }
  }
  return opt.count > 0 ? opt : fallback(world, other)
}

export function spawnGate(world, idx) {
  const sc = GATE_SCRIPT[idx]
  // 第 0 门固定计划项在左；之后偶数门计划项在右、奇数门在左
  const planLeft = idx === 0 || idx % 2 === 1
  const plan = buildOption(world, sc.plan, idx, null)
  // 合同门：雇佣兵合同顶替常规项（仍然是「数量 vs 质量」）。没有合适的合同就照常出
  let alt = (idx === world.contractGate ? contractOption(world) : null) || buildOption(world, sc.alt, idx, plan)
  // 门的公平：弱的一边换成估值接近的项（计划项和合同不动，只换对面）
  const fair = balancePair(world, idx, plan, alt)
  alt = fair.alt
  let planOpt = fair.plan
  world.gates = {
    index: idx, total: GATE.times.length, z: GATE.spawnZ,
    left: planLeft ? planOpt : alt, right: planLeft ? alt : planOpt, speed: GATE.speed,
    resolveT: world.time + (GATE.resolveZ - GATE.spawnZ) / GATE.speed, kind: 'supply',
  }
  world.events.push({ type: 'gateSpawn', index: idx, left: world.gates.left, right: world.gates.right, kind: 'supply' })
}

// ---------------------------------------------------------------- 门的公平

function armyValue(world, kind) {
  return (world.squad.counts[kind] || 0) * (UNIT_VALUE[kind] || 1)
}
function squadValue(world) {
  let v = 0
  for (const k in UNIT_VALUE) v += armyValue(world, k)
  return v
}

// 选项估值（单位 = 一名突击兵），见 data/gates.js 的 UNIT_VALUE / OPTION_VALUE
export function optionValue(world, opt) {
  const V = OPTION_VALUE
  switch (opt.type) {
    case 'unit': return (UNIT_VALUE[opt.unit] || 1) * opt.count + (opt.extra ? (UNIT_VALUE[opt.extra.unit] || 1) * opt.extra.count : 0)
    case 'heal': {
      const sq = world.squad, missing = sq.hpMax > 0 ? 1 - sq.hp / sq.hpMax : 0
      return opt.count + V.healBase + missing * squadValue(world) * V.healMissing
    }
    case 'contract': return V.contract[opt.params.contract] || 10
    case 'device': return V.device
    case 'module': {
      const m = MODULES[opt.params.moduleId]
      return m && m.unit ? Math.max(V.moduleMin, armyValue(world, m.unit) * V.moduleShare) : V.moduleMin
    }
    case 'stat': return V.durability
    default: return 1
  }
}

const sameOpt = (a, b) => a.type === b.type && a.unit === b.unit && (a.params.moduleId || null) === (b.params.moduleId || null) && (a.params.device || null) === (b.params.device || null)

// plan / alt 估值差太多（弱 / 强 < FAIR_RATIO）时，把弱的那一边换掉：依次试 FAIR_CANDIDATES，取和强的一边比例最接近 1 的那个
// （可能反过来比强的一边还高——那就再来一轮，把新的弱边也换掉，最多两轮）。
// 合同不换（它有自己的出场规则；歌利亚估值 26，对面没有够得上的项，是有意的彩蛋）；计划项弱时换计划项（满编时「+1 突击兵」这种）。
export function balancePair(world, idx, plan, alt) {
  let swapped = null
  for (let pass = 0; pass < 2; pass++) {
    const vp = optionValue(world, plan), va = optionValue(world, alt)
    const lo = Math.min(vp, va), hi = Math.max(vp, va)
    if (hi <= 0 || lo / hi >= FAIR_RATIO) break
    const weakIsAlt = va < vp
    const weak = weakIsAlt ? alt : plan, strong = weakIsAlt ? plan : alt
    if (weak.type === 'contract') break
    let best = null, bestItem = null, bestRatio = lo / hi
    for (const item of FAIR_CANDIDATES) {
      const o = buildOption(world, item, idx, strong, true)
      if (sameOpt(o, strong) || sameOpt(o, weak)) continue
      const v = optionValue(world, o)
      const ratio = Math.min(v, hi) / Math.max(v, hi)
      if (ratio > bestRatio + 1e-9) { best = o; bestItem = item; bestRatio = ratio }
    }
    if (best === null) break
    if (bestItem === 'heavy') nextHeavy(world)          // 真的拿了重型：推进剧本
    if (weakIsAlt) alt = best; else plan = best
    swapped = swapped === null ? (weakIsAlt ? 'alt' : 'plan') : 'both'
  }
  return { plan, alt, swapped }
}

// 结算一个门选项。ev 是这道门的 gateResolve 事件：granted = 实际入列人数；
// 门在路上的这几秒里编制被别的来源填满（空投 / 合同 / 重建）、一个人都进不来时，
// 当场降级成模块 / 耐久（ev.fallback = 实际生效的那个选项），不让玩家白过一道门。
function apply(world, opt, ev) {
  const p = world.progress
  switch (opt.type) {
    case 'unit': {
      const n = addUnits(world, opt.unit, opt.count, 'gate')
      if (n > 0) p.focus = opt.unit
      const m = opt.extra ? addUnits(world, opt.extra.unit, opt.extra.count, 'gate') : 0
      ev.granted = n + m
      if (n + m === 0) {
        ev.fallback = fallback(world, null)
        apply(world, ev.fallback, ev)
      }
      break
    }
    case 'heal':
      ev.granted = addUnits(world, opt.unit, opt.count, 'gate')
      healAll(world)
      break
    case 'contract':
      dropPod(world, opt.params.contract)
      break
    case 'device':
      // 门在路上的这几秒里被升级牌抢先解锁了：照样给晶能
      unlockDevice(world, opt.params.device)
      gainEnergy(world, opt.params.energy, world.squad.x, GATE.resolveZ, 'gate')
      break
    case 'module':
      grantModule(world, opt.params.moduleId)
      break
    case 'stat':
      if (opt.params.boon) applyBoon(world, opt.params.boon)
      else grantModule(world, opt.params.moduleId)
      break
  }
}

export function update(world, dt) {
  const g = world.gates
  if (g === null) return
  g.z += g.speed * dt
  if (g.z < GATE.resolveZ) return
  const side = world.squad.x < 0 ? 'left' : 'right'
  const option = g[side]
  world.gates = null
  const ev = { type: 'gateResolve', index: g.index, side, option, x: world.squad.x, z: GATE.resolveZ, granted: 0, fallback: null }
  world.events.push(ev)
  apply(world, option, ev)
}

// ---------------------------------------------------------------- 无尽的门

const boonOption = id => {
  const b = BOONS[id]
  return {
    type: 'stat', unit: null, count: 0, extra: null, tags: [b.bounty ? 'bounty' : b.cost ? 'cost' : 'boon'],
    titleKey: 'gate.boon', params: { boon: id, nameKey: b.nameKey, descKey: b.descKey, cost: !!b.cost },
  }
}

// 属性门结算。加成记在 world.buffs（recomputeMods 读它），拿过的 id 记在 world.boons。
export function applyBoon(world, id) {
  const b = BOONS[id], bf = world.buffs, line = world.line
  if (b.dmg) bf.dmg += b.dmg
  if (b.rate) bf.rate += b.rate
  if (b.hp) bf.hp += b.hp
  if (b.lineMaxMul) line.hpMax = Math.max(100, Math.round(line.hpMax * (1 + b.lineMaxMul)))
  if (b.lineMax) line.hpMax += b.lineMax
  if (b.lineHeal) { line.hp += b.lineHeal; world.events.push({ type: 'heal', amount: b.lineHeal, target: 'line' }) }
  if (b.line) line.hp = Math.max(1, line.hp + b.line)       // 代价不会直接把防线扣穿
  if (line.hp > line.hpMax) line.hp = line.hpMax
  world.boons.push(id)
  recomputeMods(world)
  if (b.heal) healAll(world)
  world.events.push({ type: 'boon', id, nameKey: b.nameKey, cost: !!b.cost })
}

// 随机草稿：按权重抽这道门的兵源项（systems-report §4.2）
function draftItem(world, idx) {
  const rng = world.rng.gates, G = GATE_DRAFT, sq = world.squad
  // 阵亡过、现在又有空位的重型更容易再刷出来
  let lost = null
  for (const f of sq.fallen) if (HEAVY_KINDS.includes(f.kind) && capRoom(world, f.kind) > 0) lost = f.kind
  const anyHeavy = HEAVY_KINDS.some(k => capRoom(world, k) > 0)
  const table = [
    ['infantry', G.infantry],
    ['reinforce', idx >= G.reinforceFrom ? G.reinforce : 0],
    ['front', G.front],
    ['artillery', idx < G.earlyUntil ? G.artilleryEarly : G.artillery],
    ['heavy', !anyHeavy ? 0 : lost !== null ? G.heavyFallen : G.heavy],
  ]
  let total = 0
  for (const e of table) total += e[1]
  let r = rng() * total, k = 0
  while (k < table.length - 1 && (r -= table[k][1]) > 0) k++
  const item = table[k][0]
  if (item !== 'heavy') return buildOption(world, item, idx, null)
  let kind = lost
  if (kind === null) { const open = HEAVY_KINDS.filter(h => capRoom(world, h) > 0); kind = open[rng.int(open.length)] }
  return unitOption(kind, 1)
}

// 无尽每层一道门：一边是兵源（随机草稿），另一边是属性门（有代价的和无代价的混出）或雇佣兵合同。
// Boss 倒下后的下一道是悬赏门：两边都是好东西。
export function spawnEndlessGate(world, idx, bounty) {
  const rng = world.rng.gates
  let a, b
  if (bounty) {
    const n = Math.min(BOUNTY_INFANTRY, capRoom(world, 'rifle'))
    a = contractOption(world) || { type: 'heal', unit: 'rifle', count: n, extra: null, tags: ['heal', 'bounty'], titleKey: n > 0 ? 'gate.reinforce' : 'gate.heal', params: { count: n, unitKey: UNITS.rifle.nameKey } }
    b = boonOption(BOONS_BOUNTY[rng.int(BOONS_BOUNTY.length)])
  } else {
    a = draftItem(world, idx)
    const contract = idx % ENDLESS.contractEvery === 0 ? contractOption(world) : null
    // 还有没解锁的装置时，属性门那一边有 ENDLESS.deviceGate 的概率换成装置门（全解锁之后不再抽这一签）
    const dev = contract === null && nextLocked(world) !== null && rng() < ENDLESS.deviceGate ? deviceOption(world) : null
    if (contract !== null) b = contract
    else if (dev !== null) b = dev
    else {
      const pool = rng() < BOON_COST_CHANCE ? BOONS_COST : BOONS_FREE
      b = boonOption(pool[rng.int(pool.length)])
    }
  }
  const flip = rng() < 0.5
  world.gates = {
    index: idx, total: idx + 1, z: GATE.spawnZ, left: flip ? b : a, right: flip ? a : b, speed: GATE.endlessSpeed,
    resolveT: world.time + (GATE.resolveZ - GATE.spawnZ) / GATE.endlessSpeed, kind: bounty ? 'bounty' : 'supply',
  }
  world.events.push({ type: 'gateSpawn', index: idx, left: world.gates.left, right: world.gates.right, kind: world.gates.kind })
}
