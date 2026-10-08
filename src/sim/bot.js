// 脚本玩家，给无头平衡测试用。只读 world，只通过 input 表达意图，和真人走同一条路。
//   idle   不动、不放装置，升级永远选第一张
//   builder 只布防不走位：站在原地，按下面的布防策略放装置；选牌和 idle 一样永远第一张（和 idle 只差「放不放装置」这一件事）
//   good   会看门、躲所有预警（冲锋 / 吐刺 / 破土 / 酸液）、跟着虫群重心走位、挑联动牌，同时布防
//          带指挥官时会放技能：小技能好了就用，清线技能等虫够多，大招留给 Boss 或者场面快崩的时候
//   heavy  走位和选牌同 good，但见重型就拿（用来把重型 A/B/C 都跑到）；heavy2 连牌也优先拿重型的
//   merc   同 good，但见雇佣兵合同就签
//   random 乱走乱选
import { createRng } from '../core/rng.js'
import { UNITS } from '../data/units.js'
import { createWorld } from './world.js'
import { findBadEvent } from '../core/events.js'
import { clamp } from '../core/util.js'
import { POWERS } from '../data/commanders.js'
import { unlockDevice } from './devices.js'
import { DEVICE_KINDS, laneOf } from '../data/devices.js'
import { HARDEN, CAMPAIGN_BOSS } from '../data/bosses.js'

// 数量优先：突击兵是主力，第一台泰坦和第一门自行炮值得拿，之后除非满编否则继续要人
function gateScore(world, opt, heavy, merc) {
  const c = world.squad.counts
  if (opt.type === 'contract') return merc ? 200 : CONTRACT_SCORE[opt.params.contract]
  if (heavy && opt.type === 'unit' && UNITS[opt.unit].cls === 'heavy') return 100
  switch (opt.type) {
    case 'unit': {
      const cls = UNITS[opt.unit].cls
      if (cls === 'heavy') return opt.unit === 'titan' && c.titan < 1 ? 75 : c[opt.unit] < 1 ? 60 : 45
      if (cls === 'artillery') return c.mortar < 1 ? 60 : 35
      if (opt.unit === 'flamer') return 30
      return 50 + opt.count * 2
    }
    case 'heal': return 45 + opt.count * 2 + (world.squad.hp < world.squad.hpMax * 0.7 ? 20 : 0)
    case 'module': return 25
    // 装置门：第一种（冷凝塔）值得用 4 个步兵换，之后的不换
    case 'device': return opt.params.device === 'cryo' ? 62 : 46
    case 'stat': return opt.params.boon ? boonScore(world, opt.params.boon) : 10
    default: return 10
  }
}

// 无尽的属性门：伤害 / 射速是实打实的；扣最大生命的不碰；防线和血量吃紧时先保命
function boonScore(world, id) {
  const line = world.line.hp / world.line.hpMax, hp = world.squad.hpMax > 0 ? world.squad.hp / world.squad.hpMax : 1
  switch (id) {
    case 'overload': return line > 0.5 ? 58 : 20
    case 'march': case 'glass': return 12
    case 'bunker': return line < 0.5 ? 85 : 40
    case 'transfusion': return hp < 0.6 && line > 0.4 ? 80 : 30
    case 'patch': return line < 0.6 ? 75 : 35
    case 'plating': return hp < 0.7 ? 78 : 48
    case 'tune': return 52
    case 'drill': return 50
    case 'bounty_arms': return 95
    case 'bounty_wall': return line < 0.6 || hp < 0.6 ? 110 : 90
    default: return 10
  }
}

// 合同要自己打开舱才到手，有风险：平时只在明显更值的时候签
const CONTRACT_SCORE = { goliath: 90, hammer: 64, bloodhound: 62 }

function cardScore(world, card, heavy) {
  if (card.kind === 'ally') return ALLY_SCORE[card.unit] || 40
  if (world.phase === 'endless') {
    // 无尽里会掉人：血量吃紧时「全队耐久」等于一次全队回满
    const sq = world.squad
    if (card.id === 'gen_durability' && sq.hp < sq.hpMax * 0.6) return 97
    if (card.id === 'gen_overload') return 66
    if (card.id === 'gen_tuning') return 64
    if (card.id === 'gen_treat') return 62
  }
  if (card.kind === 'device') return deviceCardScore(world, card)
  if (heavy === 2 && card.unit && UNITS[card.unit].cls === 'heavy') return (card.heroic ? 140 : card.completes ? 130 : 110) + (card.equip ? 5 : 0)
  if (card.heroic) return 120
  if (card.completes) return 100
  if (card.id === 'gen_repair') return world.line.hp < world.line.hpMax * 0.5 ? 95 : 20
  if (card.id === 'rifle_pierce') return 90
  if (card.unit === 'rifle' && card.equip) return 85
  if (card.id === 'gen_calibrate') return 80
  if (card.id === 'gen_logistics') return 65
  if (card.unit === 'rifle') return 70
  if (card.equip) return 60
  if (card.id === 'gen_durability') return 5
  return 40
}

const ALLY_SCORE = { titan: 60, reaper: 58, psion: 56, skyhook: 50, lancer: 45 }

// 装置牌：图纸和哨戒塔的牌排在普通突击兵牌（70）上下，别的靠后——主力还是部队
function deviceCardScore(world, card) {
  if (card.unlock) return card.unlock === 'cryo' || card.unlock === 'mortarpit' ? 76 : 55
  let sentries = 0
  for (const d of world.devices) if (d.kind === 'sentry') sentries++
  switch (card.id) {
    case 'dev_sentry_rate': return sentries >= 2 ? 72 : 50
    case 'dev_sentry_pierce': return sentries >= 2 ? 68 : 48
    case 'dev_engineer': return world.time < 100 ? 66 : 35
    case 'dev_collector_yield': return world.time < 90 ? 64 : 25
    case 'dev_cryo_freeze': return 45
    case 'dev_barricade_thorns': return 40
    default: return 35
  }
}

// ---------------------------------------------------------------- 布防策略
// 每条道的布局：row 3（最靠前）留给地雷 / 聚变炸弹，row 2 路障，row 1 哨戒塔，
// row 0（贴着队伍）两侧是采集器，中间放迫击炮台 / 冷凝塔，空着就补第二排哨戒塔；喷火陷阱埋在中路最前排，烧路障前面排队的那一片。
// 顺序：先 2 个采集器 → 压力最大的道放哨戒塔 → 路障顶在它前面 → 富余了上迫击炮 / 冷凝 / 喷火 → 地雷和聚变炸弹看场面。
// 优先级高的还买不起时，低的不许动那笔钱（reserve）。
const COLLECTORS = [[0, 0], [4, 0]]
const EXTRAS = [['mortarpit', 2, 0], ['cryo', 1, 0], ['scorcher', 2, 3]]
// S = 给压力最大的、还没有哨戒塔的道放一座；B = 给有塔没路障的道放路障；X = 下一个解锁了的扩展装置
const ORDER = ['S', 'S', 'B', 'S', 'B', 'X', 'S', 'B', 'X', 'S', 'B', 'B', 'X']
const ROW_SENTRY = 1, ROW_WALL = 2, ROW_TRAP = 3
const COLLECT_UNTIL = 140        // 这之后再补采集器已经回不了本
const NOVA_MIN = 300             // 聚变炸弹：3 × 3 格里至少这么多只才扔
const BOSS_SPEND = 180           // Boss 战里存款超过这么多就找空格补塔
const BOSS_NEAR = 4.2, BOSS_PATH = 4.6   // Boss 身边 / 前方路上这么宽的范围内不放装置

// wall（第 3 轮，只给「只布防不走位」的 builder）：碾压者在场或快出场时，在队伍所在那条道贴着队伍的一格（row 0）
// 放一道合金路障——冲锋会被它顶停（sim/boss.js chargeDevices）。不走位的打法靠这个对付冲锋，被撞碎了就补
const WALL_LEAD = 20
const EXTRAS_WALL = [['mortarpit', 3, 0], ['cryo', 1, 0], ['scorcher', 2, 3]]
export function createBuilder(wall = false) {
  const extras = wall ? EXTRAS_WALL : EXTRAS
  const press = new Float32Array(5), rank = [0, 1, 2, 3, 4]
  const place = { kind: 'sentry', lane: 0, row: 0 }
  const card = {}
  let nextT = 0

  // 返回 [kind, lane, row]，没有要放的返回 null
  function decide(world) {
    const cells = world.grid.cells, s = world.swarm
    for (const c of world.cards) card[c.kind] = c
    // 各道的压力：在场的虫，越靠近越重
    press.fill(0)
    for (let i = 0; i < s.count; i++) {
      if (s.alive[i] === 0 || s.state[i] === 2 || s.state[i] === 3 || s.z[i] < -19) continue
      press[s.lane[i]] += 1 + (s.z[i] + 19) * 0.06
    }
    rank.sort((a, b) => press[b] - press[a] || Math.abs(a - 2) - Math.abs(b - 2) || a - b)
    let reserve = 0
    const energy = world.energy
    // 想放 kind：放得起且不动用给前面预留的钱就放；否则（只是钱不够 / 在冷却）把钱留着
    const b = world.boss, bossUp = b !== null && b.state !== 'dying' && b.state !== 'burrowed'
    const want = (kind, lane, row) => {
      const c = card[kind]
      if (!c.unlocked) return null
      // Boss 会把路上的装置直接碾碎：不往它脚下放，也不往它还没走到的那段路上放（它走过去之后身后可以补）
      if (bossUp) {
        const dx = world.lanes[lane].x - b.x, dz = world.grid.rowZ[row] - b.z
        if (dx * dx + dz * dz < BOSS_NEAR * BOSS_NEAR || (dz > 0 && Math.abs(dx) < BOSS_PATH)) return null
      }
      if (c.cdLeft === 0 && energy - c.cost >= reserve) return [kind, lane, row]
      reserve += c.cost
      return null
    }
    let r
    if (wall && (bossUp ? b._def.ai === 'ravager' : world.phase === 'campaign' && world.opts.boss === 'ravager' && world.time >= CAMPAIGN_BOSS.at - WALL_LEAD)) {
      const l = laneOf(world.squad.x), c = card.barricade
      if (cells[l][0] === null) {
        // 贴着队伍那一格离 Boss 只有三米，不走上面「Boss 脚下不放」的检查
        if (c.unlocked && c.cdLeft === 0 && energy >= c.cost) return ['barricade', l, 0]
        reserve += c.cost
      }
    }
    if (world.time < COLLECT_UNTIL) for (const [l, row] of COLLECTORS) if (cells[l][row] === null && (r = want('collector', l, row))) return r
    let needS = 0, needB = 0, needX = 0
    for (const slot of ORDER) {
      if (slot === 'S') {
        needS++
        let have = 0
        for (let l = 0; l < 5; l++) if (cells[l][ROW_SENTRY] !== null) have++
        if (have >= needS) continue
        for (const l of rank) if (cells[l][ROW_SENTRY] === null) { if ((r = want('sentry', l, ROW_SENTRY))) return r; break }
      } else if (slot === 'B') {
        needB++
        let have = 0
        for (let l = 0; l < 5; l++) if (cells[l][ROW_WALL] !== null) have++
        if (have >= needB) continue
        for (const l of rank) if (cells[l][ROW_WALL] === null && cells[l][ROW_SENTRY] !== null) { if ((r = want('barricade', l, ROW_WALL))) return r; break }
      } else {
        needX++
        let seen = 0
        for (const [kind, l, row] of extras) {
          if (!card[kind].unlocked) continue
          if (++seen < needX) continue
          if (cells[l][row] === null && (r = want(kind, l, row))) return r
          break
        }
      }
    }
    // 都齐了：中间三道的 row 0 空着就补第二排哨戒塔
    for (const l of [2, 1, 3]) if (!(wall && l === 2) && cells[l][0] === null && (r = want('sentry', l, 0))) return r
    // 聚变炸弹：虫海压上来时扔在压力最大那条道的最前排（那一格得空着）
    if (card.nova.unlocked && card.nova.cdLeft === 0 && s.living >= 600) {
      for (const l of rank) {
        if (cells[l][ROW_WALL] !== null && cells[l][ROW_TRAP] !== null) continue
        const row = cells[l][ROW_TRAP] === null ? ROW_TRAP : ROW_WALL
        // 3 × 3 格里的虫够多才值一颗
        const x0 = world.lanes[l].x, z0 = world.grid.rowZ[row]
        let inArea = 0
        for (let i = 0; i < s.count; i++) if (s.alive[i] === 1 && s.state[i] !== 2 && s.state[i] !== 3 && s.y[i] <= 0 && Math.abs(s.x[i] - x0) < 3.84 && Math.abs(s.z[i] - z0) < 4.5) inArea++
        if (inArea >= NOVA_MIN && (r = want('nova', l, row))) return r
        break
      }
    }
    // 地雷：最前排，压力大的道先埋
    for (const l of rank) if (cells[l][ROW_TRAP] === null) { if ((r = want('mine', l, ROW_TRAP))) return r; break }
    // Boss 战里钱花不出去（它脚下和前方不让放、塔又被它碾掉）：攒够了就在它够不着的空格补哨戒塔（第 3 轮：局压短后终局常剩两三百晶能）
    if (bossUp && energy >= BOSS_SPEND) for (const row of [1, 2, 0, 3]) for (const l of rank) if (cells[l][row] === null && (r = want('sentry', l, row))) return r
    return null
  }

  return function build(world, input) {
    input.place = null
    if (world.time < nextT || (world.status !== 'running' && world.status !== 'aiming')) return
    nextT = world.time + 0.2
    const r = decide(world)
    if (r === null) return
    place.kind = r[0]; place.lane = r[1]; place.row = r[2]
    input.place = place
  }
}

export function createBot(type, seed = 1) {
  // 0 普通 / 1 见重型就拿 / 2 再加上重型的牌优先
  const heavy = type === 'heavy' ? 1 : type === 'heavy2' ? 2 : 0
  const merc = type === 'merc'
  if (heavy || merc) type = 'good'
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0)
  const input = { moveX: null, targetX: null, powers: [], aim: null, pick: null, reroll: false, continueEndless: false, retreat: false, place: null, remove: null }
  const build = type === 'good' || type === 'builder' ? createBuilder(type === 'builder') : null
  let tick = 0, wander = 0, gateIdx = -1, gateSide = 1, centroid = 0

  return function bot(world) {
    input.pick = null
    input.targetX = null
    input.aim = null
    input.powers.length = 0
    if (world.status === 'levelup') {
      const cards = world.levelup.cards
      if (type === 'random') input.pick = rng.int(cards.length)
      else if (type === 'good') {
        let best = 0, bs = -1
        for (let k = 0; k < cards.length; k++) { const s = cardScore(world, cards[k], heavy); if (s > bs) { bs = s; best = k } }
        input.pick = best
      } else input.pick = 0
      input.place = null
      return input
    }
    tick++
    if (build !== null) build(world, input)
    if (type === 'idle' || type === 'builder') return input
    if (type === 'random') {
      if (tick % 45 === 1) wander = rng.range(-4.3, 4.3)
      input.targetX = wander
      return input
    }

    // ---- good ----
    const sq = world.squad
    let want
    // 1. 门：出现时决定一次走哪边，站稳到结算
    const g = world.gates
    if (g) {
      if (g.index !== gateIdx) {
        gateIdx = g.index
        gateSide = gateScore(world, g.left, heavy, merc) > gateScore(world, g.right, heavy, merc) ? -1 : 1
      }
      want = gateSide * 1.3
    } else {
      // 2. 平时：跟着逼近的虫群重心走，但不贴边（贴边会招来对侧突袭）
      if (tick % 6 === 0) {
        const s = world.swarm
        let sx = 0, sw = 0
        for (let i = 0; i < s.count; i++) {
          if (s.alive[i] === 0 || s.state[i] === 2 || s.state[i] === 3 || s.z[i] < -10) continue
          const w = s.z[i] + 12
          sx += s.x[i] * w; sw += w
        }
        centroid = sw > 0 ? sx / sw : 0
      }
      want = clamp(centroid * 0.6, -0.9, 0.9)
      // Boss 甲壳硬化：正面打不动，绕到它侧面（横向错开 HARDEN.sideX 以上）去打
      const b = world.boss
      if (b !== null && b.hardened) want = clamp(b.x + (sq.x >= b.x ? 1 : -1) * (HARDEN.sideX + 0.4), -4.3, 4.3)
    }
    // 3. 躲预警：所有判定都看队伍中心，所以只要把中心挪出危险区间。躲避优先于门和走位。
    input.targetX = safeX(world, want, sq.x)
    if (world.powers.length > 0) usePowers(world, input, centroid)
    return input
  }
}

// ---- 技能 ----
// 每个技能一条放的条件：min = 场上至少这么多虫；boss = Boss 在场（打得到）时也放；ult = 大招，留着
const POWER_AI = {
  hawk_rally: { min: 150, boss: true },
  hawk_strike: { min: 0, boss: true, lane: 70 },      // 纵线上虫够多，或者 Boss 正好在线上
  hawk_drop: { min: 0 },
  hawk_flagship: { ult: true },
  ysera_orbital: { min: 120, boss: true },
  ysera_lance: { min: 300, boss: true },
  ysera_eclipse: { ult: true },
  joe_drop: { min: 120, boss: true },
  joe_mines: { min: 250 },
  joe_ray: { ult: true },
}
const ULT_PANIC = 1700      // 场上虫多到这个数，大招不留了

function laneCount(world, x, half) {
  const s = world.swarm
  let n = 0
  for (let i = 0; i < s.count; i++) if (s.alive[i] === 1 && s.state[i] !== 2 && s.state[i] !== 3 && s.x[i] > x - half && s.x[i] < x + half) n++
  return n
}

function usePowers(world, input, centroid) {
  const sq = world.squad, b = world.boss
  const bossUp = b !== null && b.state !== 'dying' && b.state !== 'burrowed'
  const a = world.aiming
  if (a !== null) {
    // 划线：长矛从队伍指向 Boss（没有 Boss 就指向虫群重心的远端）；雷横在阵前，以虫群重心为中点
    if (a.power === 'ysera_lance') {
      const tx = bossUp ? b.x : clamp(centroid, -5, 5), tz = bossUp ? b.z : -8
      const dx = tx - sq.x, dz = tz - (sq.frontZ - 1), len = Math.sqrt(dx * dx + dz * dz) || 1
      input.aim = { x0: sq.x, z0: sq.frontZ - 1, x1: sq.x + dx / len * 24, z1: sq.frontZ - 1 + dz / len * 24 }
    } else {
      const c = clamp(centroid, -1, 1)
      const z = sq.frontZ - POWERS.joe_mines.ahead
      input.aim = { x0: c - 5.5, z0: z, x1: c + 5.5, z1: z }
    }
    return
  }
  const living = world.swarm.living
  for (const p of world.powers) {
    if (!p.ready) continue
    const ai = POWER_AI[p.id]
    let go
    if (ai.ult) go = bossUp || living >= ULT_PANIC
    else if (ai.lane) go = (bossUp && Math.abs(b.x - sq.x) < 2.5 && b.z < sq.frontZ - 2) || laneCount(world, sq.x, 2.1) >= ai.lane
    else go = living >= ai.min || (ai.boss === true && bossUp)
    if (go) { input.powers.push(p.key); return }     // 一步只按一个键
  }
}

const DODGE_MARGIN = 0.2, EXIT_PAST = 0.06
const danger = []   // [lo, hi, 轻重, lo, hi, 轻重, ...]

// 轻重：冲锋（整条车道 8 伤）> 吐刺 / Boss 破土 > 小圈（掘地虫破土、酸液、酸池）。
// 两害相权取其轻：不能为了躲一个小圈去横穿冲锋的车道。
const severity = t => (t.style === 'charge' ? 3 : t.style === 'spines' || (t.style === 'emerge' && t.r > 2.5) ? 2 : 1)

// 收集会伤到队伍的横向区间：Boss 冲锋 / 吐刺的车道、破土与酸液的预警圈、还没干的酸池
function collectDanger(world) {
  danger.length = 0
  for (const t of world.telegraphs) {
    if (t.team !== 'enemy' || t.style === 'flank' || t.style === 'sweep') continue
    // 够不着队伍的圈不用躲（布了防的道上，掘地虫在装置身后破土，离阵前还有一段路）
    if (t.shape === 'circle' && t.z + t.r < world.squad.frontZ - 0.7) continue
    const half = (t.shape === 'lane' ? t.w / 2 : t.r) + DODGE_MARGIN
    danger.push(t.x - half, t.x + half, severity(t))
  }
  for (const zn of world.zones) if (zn.team === 'enemy') danger.push(zn.x - zn.r - DODGE_MARGIN, zn.x + zn.r + DODGE_MARGIN, 1)
  // 冲锋的预警带在起跑时就过期了，Boss 冲完之前别回去
  const b = world.boss
  if (b && b.state === 'charge') danger.push(b.x - 2 - DODGE_MARGIN, b.x + 2 + DODGE_MARGIN, 3)
}

// 站在 x 处的代价：罩住它的最重的那个区间（0 = 安全）
const costAt = x => {
  let c = 0
  for (let k = 0; k < danger.length; k += 3) if (x > danger[k] && x < danger[k + 1] && danger[k + 2] > c) c = danger[k + 2]
  return c
}

// 从 cur 走到 x 的代价：终点的代价，以及路上新闯进去的区间（本来就站在里面的不算）里最重的那个
function costTo(cur, x) {
  let c = costAt(x)
  const lo = cur < x ? cur : x, hi = cur < x ? x : cur
  for (let k = 0; k < danger.length; k += 3) {
    if (danger[k + 2] <= c || danger[k + 1] <= lo || danger[k] >= hi) continue
    if (cur > danger[k] && cur < danger[k + 1]) continue
    c = danger[k + 2]
  }
  return c
}

// 代价最小的位置；一样的话取离 want 最近的（当前就站在危险里时，改成离自己最近的：先逃出去再说）。
// 候选：想去的地方、原地不动、每个危险区间的两个端点。
function safeX(world, want, cur) {
  collectDanger(world)
  if (danger.length === 0) return want
  const here = costAt(cur)
  if (here === 0 && costTo(cur, want) === 0) return want
  const ref = here > 0 ? cur : want
  let best = cur, bc = here, bd = Math.abs(cur - ref)
  const consider = x => {
    const c = costTo(cur, x), d = Math.abs(x - ref)
    if (c < bc || (c === bc && d < bd)) { best = x; bc = c; bd = d }
  }
  consider(want)
  // 出口往外多走一点：队伍是渐近地靠过去的，目标定在边界上就永远差一丝没出去
  for (let k = 0; k < danger.length; k += 3) { consider(clamp(danger[k] - EXIT_PAST, -4.3, 4.3)); consider(clamp(danger[k + 1] + EXIT_PAST, -4.3, 4.3)) }
  return best
}

// 无头跑一局战役。clock: 可选的计时函数（毫秒），由 tools/ 传入；模拟层自己不碰时钟。
// endless: N > 0 时战役胜利后续打无尽，打完第 N 层撤离（或者中途阵亡）。companion: 传给 createWorld 的伙伴配置。
const CONTINUE = { moveX: null, targetX: null, powers: [], aim: null, pick: null, reroll: false, continueEndless: true, retreat: false, place: null, remove: null }

// unlockAll: 开局就把 8 种装置全解锁（量「每晶能伤害」用）。onStart(world): 开局回调
export function runHeadless({ seed = 1, bot = 'good', commander = 'none', difficulty = 'normal', draft = 'script', boss = undefined, mutators = [], daily = false, dateKey = null, endless = 0, companion = null, maxSteps = 60 * (300 + 45 * endless), clock = null, checkEvents = false, onStep = null, unlockAll = false, onStart = null } = {}) {
  const world = createWorld({ seed, commander, difficulty, draft, boss, mutators, daily, dateKey, companion })
  if (unlockAll) for (const k of DEVICE_KINDS) unlockDevice(world, k)
  if (onStart) onStart(world)
  seed = world.seed
  const play = createBot(bot, seed)
  let steps = 0, simSteps = 0, totalMs = 0, maxMs = 0, badEvent = null, events = 0, peakEnemies = 0
  while (world.status !== 'lost' && world.status !== 'retreated' && steps < maxSteps) {
    if (world.status === 'won') {
      if (endless > 0 && world.phase === 'campaign') { world.step(CONTINUE); if (onStep) onStep(world); continue }
      break
    }
    const input = play(world)
    const e = world.endless
    input.retreat = e !== null && e.layer >= endless && e.layerT >= e.layerLen - 0.04
    const running = world.status === 'running' || world.status === 'aiming'
    const t0 = clock ? clock() : 0
    world.step(input)
    if (clock && running) {
      const ms = clock() - t0
      totalMs += ms
      if (ms > maxMs) maxMs = ms
      simSteps++
    }
    steps++
    events += world.events.length
    if (world.swarm.living > peakEnemies) peakEnemies = world.swarm.living
    if (checkEvents && !badEvent) {
      for (const e of world.events) {
        const bad = findBadEvent(e)
        if (bad) { badEvent = { step: steps, field: bad, event: e }; break }
      }
    }
    if (onStep) onStep(world)
  }
  return { world, result: world.result(), steps, events, peakEnemies, badEvent, avgMs: simSteps ? totalMs / simSteps : 0, maxMs }
}
