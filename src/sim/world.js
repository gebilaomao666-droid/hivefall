// 模拟层入口。契约见 docs/ARCHITECTURE.md §2。
// 同 seed + 同输入序列 ⇒ 完全相同的结果；这里不碰 DOM / 时钟 / Math.random。
import { createRng } from '../core/rng.js'
import { SWARM_CAP, DIFFICULTY } from '../data/enemies.js'
import { CAMPAIGN_BOSS, BOSSES } from '../data/bosses.js'
import { HEAVY_PLAN } from '../data/units.js'
import { CAMPAIGN_LEN, PHASES } from '../data/waves.js'
import { createSquad, addUnits, aliveCount, update as updateSquad } from './squad.js'
import { createSwarm, update as updateSwarm, markAuras } from './swarm.js'
import { createGrid, rebuild } from './grid.js'
import { update as updateCombat } from './combat.js'
import { update as updateGates } from './gates.js'
import { createDirector, update as updateDirector } from './director.js'
import { update as updateBoss } from './boss.js'
import { createProgress, createMods, recomputeMods, handleLevelup, update as updateProgress } from './progression.js'
import { createStats, update as updateStats } from './stats.js'
import { createPowers, update as updatePowers, cancelAim } from './powers.js'
import { createMutators, update as updateMutators } from './mutators.js'
import { update as updateContracts } from './contracts.js'
import { dailyConfig } from './daily.js'
import { COMMANDERS, COMMANDER_THREAT } from '../data/commanders.js'
import { CONTRACT_GATES } from '../data/contracts.js'
import { enterEndless, update as updateEndless, lateUpdate as lateEndless, bossDown } from './endless.js'
import { createCompanion, update as updateCompanion } from './companion.js'
import { buildResult } from './result.js'
import { createDevices, update as updateDevices } from './devices.js'

export const DT = 1 / 60

export function createWorld(options = {}) {
  // 每日挑战：种子 / 指挥官 / 突变都由 dateKey 派生，盖掉传进来的同名选项
  const daily = options.daily ? dailyConfig(options.dateKey) : null
  if (daily) options = { ...options, seed: daily.seed, commander: daily.commander, mutators: daily.mutators, difficulty: daily.difficulty }
  const opts = {
    seed: (options.seed ?? 1) >>> 0,
    commander: COMMANDERS[options.commander] ? options.commander : 'none',
    mutators: (options.mutators || []).slice(),
    difficulty: DIFFICULTY[options.difficulty] ? options.difficulty : 'normal',
    draft: options.draft || 'script',
    daily: !!daily, dateKey: daily ? daily.dateKey : null,
    // 战役 Boss。正式流程固定「碾压者」；另外两种给无尽和测试用
    boss: BOSSES[options.boss] ? options.boss : CAMPAIGN_BOSS.kind,
    // 摆拍世界：不跑时间轴（不刷怪、不出门、不出 Boss）、不升级、不判负。给测试、菜单预览、军械库用，
    // 里面的东西由调用方自己用 addUnits / spawn / spawnBoss 摆。
    sandbox: !!options.sandbox,
  }
  const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal
  const root = createRng(opts.seed)
  const world = {
    opts, seed: opts.seed,
    time: 0, phase: 'campaign', status: 'running', timeScale: 1,
    events: [],
    squad: createSquad(),
    swarm: createSwarm(),
    boss: null,
    telegraphs: [], zones: [], gates: null, pods: [], levelup: null, powers: [],
    summons: [],             // 技能召唤物：旗舰 / 机器人 / 汇聚射线
    aiming: null,            // status === 'aiming' 时：{ power, key, timeout, timeLeft, auto }
    mutators: [],            // [{ id, active, nameKey, descKey }]
    contract: null,          // 本局合同的去向：{ id, state: 'pod' | 'open' | 'lost', count }
    daily,                   // 每日挑战的配置（不是每日挑战时为 null）
    progress: createProgress(),
    line: { hp: diff.lineMax, hpMax: diff.lineMax },
    wave: { index: 0, name: null, herald: null },
    endless: null,
    stats: createStats(),
    mission: { timeLeft: CAMPAIGN_LEN, label: PHASES[0].name, overtime: false },
    // ---- 以下为模拟层内部状态，表现层不要依赖 ----
    rng: {
      spawn: root.fork('spawn'), waves: root.fork('waves'), combat: root.fork('combat'), draft: root.fork('draft'), gates: root.fork('gates'),
      power: root.fork('power'), mut: root.fork('mut'), contract: root.fork('contract'),
    },
    // hpMul / speedMul / dmgMul 随难度；无尽每层再乘成长系数。lineMul：漏网 / Boss 撞防线扣防线的倍率（指挥官局的威胁加码，见下）
    diff: { ...diff, armorAdd: 0, lineMul: 1 },
    mods: createMods(),
    hash: createGrid(SWARM_CAP),      // 空间哈希（原先叫 world.grid；那个名字按 GDD §13 让给了布防格子）
    // 布防系统（createDevices 填）：lanes / grid / devices / energy / cards / fences 是给表现层的契约
    lanes: null, grid: null, devices: null, energy: 0, cards: null, fences: null, _dev: null, _fenceCrowd: null,
    dmgMul: 1, modDmgMul: 1, enemySpeedMul: 1,
    powerDmgMul: 1,          // 技能伤害倍率（无尽每层 ×1.1）
    rateMul: 1,              // 全军射速倍率（无尽的属性门 / 通用牌）
    buffs: { dmg: 0, rate: 0, hp: 0 },   // 无尽属性门累计的加成（可为负）
    boons: [],               // 拿过的属性门 id，按顺序
    companion: null,         // 伙伴无人机「小七」
    _campaignWon: false, _campaignSeconds: null,
    passive: { aegis: null, rebuild: null, overclock: null }, mut: null, contractGate: -1,
    eliteChance: 0,          // 精英出现概率（无尽 4 层起才 > 0）
    heavyPlan: null,         // 本局门剧本里重型 A/B/C 各是谁
    loseReason: null,
    _dir: createDirector(),
    _hero: { rifleT: 0, titanT: 0, surgeUntil: 0, barrageT: 0, skyT: 0 },
    _seen: { burster: false, spitter: false, crusher: false, hulk: false, wing: false, digger: false, warden: false, contract: false, power: false, shieldbug: false, leaper: false, fence: false, deviceLost: false },   // 首次遭遇的通讯只发一次
    _rally: null, _rallyUntil: 0, _eclipse: null, _pq: [], _mines: [], _rebuild: [], _podDrops: [], _goliath: false,
    _pending: [], _aim: { x: 0, z: 0 }, _nextId: 1, _wildfireStep: 0, _bossHitStep: 0,
    _endTime: null, _bulletReal: 0,
  }
  // 单独分一路随机数：不挪动门 / 刷怪等既有序列
  // 指挥官局的战役威胁加码（data/commanders.js COMMANDER_THREAT）：敌伤与扣防线加重，无尽里 startLayer 会重设回难度基数
  const threat = COMMANDER_THREAT[opts.commander]
  if (threat) { world.diff.dmgMul *= threat.dmgMul; world.diff.lineMul = threat.lineMul }
  const heavyRng = root.fork('heavy')
  world.heavyPlan = HEAVY_PLAN.map(h => (Array.isArray(h) ? h[heavyRng.int(h.length)] : h))
  world.contractGate = CONTRACT_GATES[world.rng.contract.int(CONTRACT_GATES.length)]
  createMutators(world)
  recomputeMods(world)
  createPowers(world)                                       // 指挥官本人上场 + 技能栏；'none' 时什么都不做
  createDevices(world)                                      // 车道、格子、晶能、卡槽、电网（要在被动定下来之后：老猫的装置打折）
  if (!opts.sandbox) addUnits(world, 'rifle', 1, 'start')   // 标准小队：一名突击兵起步
  if (options.companion) createCompanion(world, options.companion === true ? null : options.companion)
  // 开局事件（unitJoin:start / companion:join / 摆拍世界的 mutator）留在 world.events 里，
  // 第一步不清空：表现层第一次 consume 就能收到
  world._fresh = true
  world.step = input => step(world, input)
  // 暂停：模拟层看不到暂停（暂停时主循环根本不调 step），由主循环每次进入暂停时调一次 notePause()，
  // 或者在恢复后的第一步 input 里带 paused: true。勋章「没停过」要求整局 pauses === 0
  world.notePause = () => { world.stats.pauses++ }
  world.result = () => buildResult(world)
  return world
}

function finish(world, status, reason) {
  // 对局在瞄准 / 选卡中结束（撤离、全灭、防线归零）：瞄准要有配对的 aimEnd，卡面不能留在结算画面上
  if (world.aiming !== null) cancelAim(world)
  world.levelup = null
  world.status = status
  world.timeScale = 1
  if (world._endTime === null) world._endTime = world.time
  if (status === 'won') {
    world._campaignWon = true
    world._campaignSeconds = world._endTime
    world.events.push({ type: 'win' })
  } else if (status === 'retreated') world.events.push({ type: 'retreat', layer: world.endless.layer })
  else { world.loseReason = reason; world.events.push({ type: 'lose', reason }) }
}

// Boss 死亡的子弹时间。模拟层没有真实时钟，按「每步 = DT / timeScale 真实秒」折算。
function bulletTime(world) {
  const d = world.boss._def.death
  world._bulletReal += DT / world.timeScale
  const r = world._bulletReal
  if (r < d.hold) world.timeScale = d.scale
  else if (r < d.hold + d.ease) { const k = (r - d.hold) / d.ease; world.timeScale = d.scale + (1 - d.scale) * k * k }
  else if (world.phase === 'endless') bossDown(world)      // 无尽：发奖励，接着打
  else finish(world, 'won', null)
}

function step(world, input) {
  if (world._fresh) world._fresh = false
  else world.events.length = 0
  const status = world.status
  const endless = world.phase === 'endless'
  if (status === 'won') {
    // 战役胜利后原地续打无尽
    if (input && input.continueEndless && !endless && !world.opts.sandbox) enterEndless(world)
    return
  }
  if (status === 'lost' || status === 'retreated') return
  if (input && input.paused) world.stats.pauses++
  if (endless && input && input.retreat) return finish(world, 'retreated', null)   // 撤离结算，保分
  if (!endless && input && input.abandon) return finish(world, 'lost', 'abandon')   // 战役「撤离并结算」= 放弃本局（input.abandon，和无尽的 retreat 分开：战役里 retreat 仍然无效），按失败结算、成绩照记
  if (status === 'levelup') { handleLevelup(world, input); return }

  world.time += DT
  if (!endless) {
    // 加时：时限到了而 Boss 还在场 → timeLeft 改成加时剩余，mission.overtime 给界面标红
    const ot = world.time >= CAMPAIGN_LEN && world.boss !== null
    world.mission.overtime = ot
    world.mission.timeLeft = Math.max(0, (ot ? CAMPAIGN_BOSS.deadline + CAMPAIGN_BOSS.overtime : CAMPAIGN_LEN) - world.time)
  }

  const dying = world.boss !== null && world.boss.state === 'dying'
  if (dying && world.aiming !== null) cancelAim(world)
  updateSquad(world, input, DT)
  if (!dying) {
    // Boss 倒下的冲击波把虫群震住、全队停火：子弹时间里战场定格，击杀数也就此封账
    if (!world.opts.sandbox) {
      if (endless) updateEndless(world, DT)
      else updateDirector(world, DT)
      updateGates(world, DT)
    }
    updateSwarm(world, DT)
    rebuild(world.hash, world.swarm)
    markAuras(world)
    updateDevices(world, input, DT)
    updateCombat(world, DT)
    updatePowers(world, input, DT)
    updateCompanion(world, DT)
    updateContracts(world, DT)
    updateMutators(world, DT)
  }
  updateBoss(world, DT)

  // 过期的预警带
  const tgs = world.telegraphs
  if (tgs.length > 0) {
    let w = 0
    for (let n = 0; n < tgs.length; n++) if (world.time < tgs[n].t1) tgs[w++] = tgs[n]
    tgs.length = w
  }

  updateStats(world)

  const boss = world.boss
  if (boss !== null && boss.state === 'dying') { bulletTime(world); return }   // Boss 已死：只等演出结束，不再判负
  if (world.opts.sandbox) return
  if (aliveCount(world.squad) === 0) return finish(world, 'lost', 'wiped')
  if (world.line.hp <= 0) return finish(world, 'lost', 'line')
  if (!endless && world.time >= CAMPAIGN_BOSS.deadline + (boss !== null ? CAMPAIGN_BOSS.overtime : 0)) return finish(world, 'lost', 'timeout')
  updateProgress(world)
  if (endless) lateEndless(world)
}
