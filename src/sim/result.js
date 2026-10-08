// 结算数据：world.result()。结算面板、本机榜、成就判定、伙伴培养都读这一份。
// 只读 world，不改它；随时可以调（对局进行中 outcome 为 'running'）。
import { round, roundObj } from '../core/util.js'
import { UNITS, ALL_KINDS } from '../data/units.js'
import { MODULES } from '../data/modules.js'
import { COMBOS, HEROICS } from '../data/combos.js'
import { POWERS } from '../data/commanders.js'
import { BOONS, VANGUARD } from '../data/endless.js'
import { rankFor } from '../data/ranks.js'
import { unlocksFor } from '../data/unlocks.js'
import { aliveCount } from './squad.js'
import { layerLog } from './endless.js'
import { companionResult } from './companion.js'
import { DEVICES, DEVICE_KINDS } from '../data/devices.js'

const SPECIAL_POWER_KEYS = { companion: 'companion.name', [VANGUARD.id]: 'ally.vanguard.orbital' }
const powerNameKey = id => (POWERS[id] ? POWERS[id].nameKey : SPECIAL_POWER_KEYS[id] || id)
const moduleNameKey = id => (MODULES[id] || COMBOS[id] || HEROICS[id] || { nameKey: id }).nameKey
const moduleUnit = id => (MODULES[id] ? MODULES[id].unit : HEROICS[id] ? HEROICS[id].unit : COMBOS[id] ? COMBOS[id].units[0] : null)

export function buildResult(world) {
  const st = world.stats, p = world.progress, sq = world.squad, e = world.endless
  let unitTotal = 0, powerTotal = 0, deviceTotal = 0
  for (const k in st.dmgByUnit) unitTotal += st.dmgByUnit[k]
  for (const k in st.dmgByPower) powerTotal += st.dmgByPower[k]
  for (const k in st.dmgByDevice) deviceTotal += st.dmgByDevice[k]
  const total = unitTotal + powerTotal + deviceTotal
  const dmgShare = {}
  for (const k in st.dmgByUnit) if (st.dmgByUnit[k] > 0) dmgShare[k] = round(st.dmgByUnit[k] / unitTotal, 4)
  const seconds = round(world._endTime ?? world.time, 2)
  const outcome = world.status === 'won' || world.status === 'lost' || world.status === 'retreated' ? world.status : 'running'
  const troops = aliveCount(sq)
  const layer = e ? e.layer : 0
  const mode = e ? 'endless' : 'campaign'

  // 兵种火力报告：每个上过场的兵种一行，按伤害排
  const unitReport = []
  for (const k of ALL_KINDS) {
    const dmg = st.dmgByUnit[k], deployed = st.deployed[k] || 0
    if (!(dmg > 0) && deployed === 0) continue
    const kills = st.killsByUnit[k] || 0
    unitReport.push({
      kind: k, nameKey: UNITS[k].nameKey, dmg: round(dmg, 0), share: total > 0 ? round(dmg / total, 4) : 0,
      deployed, alive: sq.counts[k], kills, bossDmg: round(st.bossDmgByUnit[k] || 0, 0), rank: rankFor(kills),
    })
  }
  unitReport.sort((a, b) => b.dmg - a.dmg)

  // 技能贡献（指挥官技能、伙伴、盟军轰炸），占比和兵种用同一个分母
  const powerReport = []
  for (const id in st.dmgByPower) {
    const dmg = st.dmgByPower[id]
    powerReport.push({
      id, nameKey: powerNameKey(id), dmg: round(dmg, 0), share: total > 0 ? round(dmg / total, 4) : 0,
      casts: st.powerCasts[id] || 0, kills: st.killsByPower[id] || 0, bossDmg: round(st.bossDmgByPower[id] || 0, 0),
    })
  }
  powerReport.sort((a, b) => b.dmg - a.dmg)

  // 装置贡献：放过的每种装置一行，外加应急电网（只有击杀）。三张表（兵种 / 技能 / 装置）的 kills 之和 = 总击杀，share 之和 = 1
  const deviceReport = []
  const dvs = st.devices
  for (const k of DEVICE_KINDS) {
    const placed = dvs.placed[k], dmg = st.dmgByDevice[k], kills = st.killsByDevice[k]
    if (placed === 0 && !(dmg > 0) && kills === 0) continue
    deviceReport.push({
      kind: k, nameKey: DEVICES[k].nameKey, dmg: round(dmg, 0), share: total > 0 ? round(dmg / total, 4) : 0,
      placed, lost: dvs.lost[k], removed: dvs.removed[k], spent: dvs.spent[k], kills, bossDmg: round(st.bossDmgByDevice[k] || 0, 0),
      dmgPerEnergy: dvs.spent[k] > 0 ? round(dmg / dvs.spent[k], 2) : 0,
      absorbed: round(dvs.absorbed[k] || 0, 0), yield: k === 'collector' ? round(st.energy.collector, 0) : 0,
    })
  }
  deviceReport.sort((a, b) => b.dmg - a.dmg)
  if (st.fencesUsed > 0) deviceReport.push({ kind: 'fence', nameKey: 'device.fence.name', dmg: 0, share: 0, placed: st.fencesUsed, lost: 0, removed: 0, spent: 0, kills: st.killsByDevice.fence, bossDmg: 0, dmgPerEnergy: 0 })
  let placedTotal = 0
  for (const k of DEVICE_KINDS) placedTotal += dvs.placed[k]

  // 装备 / 联动 / 英雄级的贡献
  const moduleReport = Object.keys(st.dmgByModule)
    .map(id => ({ id, nameKey: moduleNameKey(id), unit: moduleUnit(id), dmg: round(st.dmgByModule[id], 0), share: total > 0 ? round(st.dmgByModule[id] / total, 4) : 0 }))
    .sort((a, b) => b.dmg - a.dmg)

  // 英雄级小队名单：谁还在，谁没回来
  const byId = new Map()
  for (const u of sq.units) byId.set(u.id, u)
  const fallenById = new Map()
  for (const f of sq.fallen) fallenById.set(f.id, f)
  const roster = p.squads.map(s => {
    const members = p.named.filter(n => n.kind === s.unit).map(n => {
      const u = byId.get(n.id), f = fallenById.get(n.id)
      const alive = !!(u && u.alive)
      return { id: n.id, name: n.name, alive, kills: alive ? u.kills : f ? f.kills : 0, fallenAt: alive || !f ? null : f.t }
    })
    return {
      heroic: s.heroic, unit: s.unit, squadName: s.squadName, formedAt: s.t,
      members, alive: members.filter(m => m.alive).length, fallen: members.filter(m => !m.alive).length,
    }
  })

  const ranks = {}
  for (const k of ALL_KINDS) if ((st.deployed[k] || 0) > 0) ranks[k] = rankFor(st.killsByUnit[k] || 0)

  const result = {
    seed: world.seed, commander: world.opts.commander, difficulty: world.opts.difficulty, mutators: world.mutators.map(m => m.id),
    boss: world.opts.boss, heavyPlan: world.heavyPlan.slice(),
    daily: world.opts.daily, dateKey: world.opts.dateKey, contract: world.contract, powerCasts: { ...st.powerCasts },
    mode, outcome, reason: world.loseReason, campaignWon: world._campaignWon, campaignSeconds: world._campaignSeconds === null ? null : round(world._campaignSeconds, 2),
    score: st.kills, kills: st.kills, layer, seconds,
    losses: st.losses, leaked: st.leaked, lostTo: { ...st.lostTo }, hurtBy: roundObj(st.hurtBy, 0), troops, counts: { ...sq.counts }, deployed: { ...st.deployed },
    line: { hp: round(world.line.hp, 0), hpMax: world.line.hpMax },
    level: p.level, xp: round(p.xp, 0),
    peakKillRate: round(st.peakKillRate, 1), maxCombo: st.maxCombo, pauses: st.pauses,
    bossKills: st.bossKills, eliteKills: st.eliteKills,
    // 这一局 Boss 出没出过场：没出场（开局就放弃、Boss 前全灭）时结算别写「对「碾压者」0」
    bossSeen: world._dir.bossSpawned || world.phase === 'endless',
    cards: p.picks.slice(), modules: { ...p.modules }, combos: p.combos.slice(), heroics: p.heroics.slice(),
    boons: world.boons.slice(), buffs: roundObj(world.buffs, 3),
    dmgByUnit: roundObj(st.dmgByUnit), dmgShare, dmgByModule: roundObj(st.dmgByModule), dmgByPower: roundObj(st.dmgByPower),
    bossDmgByUnit: roundObj(st.bossDmgByUnit), killsByUnit: { ...st.killsByUnit }, killsByPower: { ...st.killsByPower },
    dmgTotal: round(total, 0),
    unitReport, powerReport, moduleReport, ranks,
    // 布防系统
    deviceReport, dmgByDevice: roundObj(st.dmgByDevice), killsByDevice: { ...st.killsByDevice },
    devices: { placed: { ...dvs.placed }, lost: { ...dvs.lost }, removed: { ...dvs.removed }, spent: { ...dvs.spent }, placedTotal, standing: world.devices.length },
    energy: { now: round(world.energy, 0), ...roundObj(st.energy, 0) },
    fences: world.fences.slice(), fencesUsed: st.fencesUsed,
    named: p.named.slice(), fallen: sq.fallen.slice(), roster,
    layers: layerLog(world),
    companion: companionResult(world),
    timeline: st.timeline.slice(),
    // 五大数字：UI 直接按 key 渲染。战役第五格是防线，无尽是层数
    big: [
      { key: 'big.kills', value: st.kills },
      { key: 'big.losses', value: st.losses },
      { key: 'big.seconds', value: Math.round(seconds) },
      { key: 'big.leaked', value: st.leaked },
      mode === 'endless' ? { key: 'big.layer', value: layer } : { key: 'big.line', value: round(world.line.hp, 0) },
    ],
    // 标题 / 副文案。失败只给建议，不嘲讽
    headline: headline(world, outcome, mode),
    // 战报行（第 1 步就有的简表，保留）
    report: [
      { key: 'report.kills', value: st.kills },
      { key: 'report.time', value: seconds },
      { key: 'report.losses', value: st.losses },
      { key: 'report.line', value: round(world.line.hp, 0) },
      { key: 'report.level', value: p.level },
      { key: 'report.peak', value: round(st.peakKillRate, 0) },
    ],
  }
  result.boonNames = result.boons.map(id => BOONS[id].nameKey)
  // 这一局达成的解锁条件（不管存档里是不是已经有了；去重由 core/save.js 的 applyResult 做）
  result.unlocks = unlocksFor(result)
  return result
}

function headline(world, outcome, mode) {
  if (outcome === 'running') return { titleKey: 'result.running', textKey: null }
  if (outcome === 'retreated') return { titleKey: 'result.retreated', textKey: 'result.retreated.text' }
  if (outcome === 'won') return { titleKey: 'result.won', textKey: 'result.won.text' }
  if (mode === 'endless') return { titleKey: 'result.endless_lost', textKey: `advice.${world.loseReason}` }
  return { titleKey: `lose.${world.loseReason}`, textKey: `advice.${world.loseReason}` }
}
