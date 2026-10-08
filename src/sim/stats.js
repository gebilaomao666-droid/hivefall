// 战斗统计：歼敌速度（3 秒窗）、峰值、连杀倍率、各来源伤害、每秒一条的时间线。
import { ALL_KINDS } from '../data/units.js'
import { aliveCount } from './squad.js'
import { rankIndex, RANKS } from '../data/ranks.js'
import { DEVICE_KINDS } from '../data/devices.js'

const WINDOW = 180          // 3 秒 × 60 步
// 连杀：看最近 COMBO_WIN 秒的击杀数。连杀越长，续上它要的歼敌速度越高——
// 最近 1.2 秒里的击杀少于 COMBO_KEEP + 连杀数 × COMBO_SCALE 就断（连杀开头的 1.2 秒不判）。
// 以前是「1.7 秒没有任何击杀才断」，涓流一直有虫可杀，最高连杀永远等于总歼敌。
export const COMBO_WIN = 72         // 1.2 秒 × 60 步
export const COMBO_KEEP = 6
export const COMBO_SCALE = 0.012
const COMBO_FULL = 1500     // 连杀到这个数，经验加成封顶
const COMBO_BONUS = 0.2

export function createStats() {
  const dmgByUnit = {}, killsByUnit = {}, ranks = {}
  for (const k of ALL_KINDS) { dmgByUnit[k] = 0; killsByUnit[k] = 0; ranks[k] = 0 }
  // 布防系统：按装置 kind 记伤害 / 击杀 / 放置 / 损毁 / 花费；电网只有击杀（killsByDevice.fence）
  const zero = () => Object.fromEntries(DEVICE_KINDS.map(k => [k, 0]))
  return {
    dmgByDevice: zero(), killsByDevice: { ...zero(), fence: 0 }, bossDmgByDevice: {}, fencesUsed: 0,
    devices: { placed: zero(), lost: zero(), removed: zero(), spent: zero(), absorbed: zero() },   // absorbed：装置替队伍挨了多少伤害（结算里路障那一行用）
    energy: { earned: 0, spent: 0, kill: 0, collector: 0, refund: 0, gate: 0 },
    kills: 0, killRate: 0, peakKillRate: 0, combo: 0, comboMult: 1, maxCombo: 0,
    leaked: 0, losses: 0, hurtBy: {}, lostTo: {}, deployed: {}, dmgByUnit, dmgByModule: {}, dmgByPower: {}, bossDmgByUnit: {}, powerCasts: {},
    // 第 4 步：按来源记击杀（兵种火力报告 / 军衔用）
    killsByUnit, killsByPower: {}, bossDmgByPower: {}, bossKills: 0, eliteKills: 0, ranks,
    timeline: [],
    _ring: new Uint16Array(WINDOW), _ringI: 0, _ringSum: 0, _stepKills: 0, _lastKillT: -9, _nextSample: 1,
    _cRing: new Uint16Array(COMBO_WIN), _cI: 0, _cSum: 0, _comboT0: 0,
    pauses: 0,       // 这一局暂停过几次（表现层每次暂停时调 world.notePause() / 或 input.paused）
  }
}

export function update(world) {
  const st = world.stats, k = st._stepKills
  st._ringSum += k - st._ring[st._ringI]
  st._ring[st._ringI] = k
  st._ringI = (st._ringI + 1) % WINDOW
  st.killRate = st._ringSum / 3
  if (st.killRate > st.peakKillRate) st.peakKillRate = st.killRate

  st._cSum += k - st._cRing[st._cI]
  st._cRing[st._cI] = k
  st._cI = (st._cI + 1) % COMBO_WIN
  if (st.combo > 0 && world.time - st._comboT0 >= COMBO_WIN / 60 && st._cSum < COMBO_KEEP + st.combo * COMBO_SCALE) st.combo = 0
  if (k > 0) {
    if (st.combo === 0) st._comboT0 = world.time
    st.combo += k
    st._lastKillT = world.time
    if (st.combo > st.maxCombo) st.maxCombo = st.combo
  }
  st.comboMult = 1 + COMBO_BONUS * Math.min(1, st.combo / COMBO_FULL)
  st._stepKills = 0

  if (world.time >= st._nextSample) {
    // 军衔一秒查一次就够了
    for (const k in st.killsByUnit) {
      const r = rankIndex(st.killsByUnit[k])
      if (r > st.ranks[k]) {
        st.ranks[k] = r
        world.events.push({ type: 'rankUp', unit: k, rank: r, nameKey: RANKS[r].nameKey })
      }
    }
    st.timeline.push({
      t: st._nextSample, troops: aliveCount(world.squad), enemies: world.swarm.living,
      killRate: Math.round(st.killRate), kills: st.kills, line: Math.round(world.line.hp), level: world.progress.level,
      devices: world.devices.length, energy: Math.round(world.energy),
    })
    st._nextSample++
  }
}
