// 我方队伍：阵型、移动平滑、编制上限、受伤/阵亡/补员。
// 单位最多几十到一百来个，用普通对象即可；热路径在虫群那边。
import { UNITS, ALL_KINDS, FORMATION as F, CAPS, HEAVY_KINDS, FIELD_REGEN } from '../data/units.js'
import { SHIELD } from '../data/modules.js'
import { clamp } from '../core/util.js'

const BUCKETS = 16
const BUCKET_X0 = 8
const FACING_FRONT = Math.PI   // facing = atan2(dx, dz)，朝 -z（敌人来的方向）就是 π

export function createSquad() {
  const counts = {}, freeCounts = {}
  for (const k of ALL_KINDS) { counts[k] = 0; freeCounts[k] = 0 }
  return {
    x: 0, targetX: 0, frontZ: F.frontZ, hp: 0, hpMax: 0,
    units: [], counts, caps: { ...CAPS.campaign },
    freeCounts,           // 其中不占编制的（歌利亚、先遣队送的重型）；counts 照常包含它们
    hero: null,           // 指挥官本人（活着时）
    fallen: [],           // 阵亡名单（战报用）
    backZ: F.frontZ,      // 最后排的 z，虫群判断接触范围用
    _nextId: 1, _dirty: false, _dead: false,
    _cols: Array.from({ length: BUCKETS }, () => []),   // 按 x 分桶，给虫子找人撞
  }
}

function classUsed(sq, cls) {
  let n = 0
  for (const k of ALL_KINDS) if (UNITS[k].cls === cls) n += sq.counts[k] - sq.freeCounts[k]
  return n
}

// 还能再加多少个这种单位
export function capRoom(world, kind) {
  const sq = world.squad, def = UNITS[kind]
  let room = sq.caps[def.cls] - classUsed(sq, def.cls)
  if (def.cls === 'heavy') {
    // 同种重型上限 = ceil(总上限 / 可用种类数)
    room = Math.min(room, Math.ceil(sq.caps.heavy / HEAVY_KINDS.length) - (sq.counts[kind] - sq.freeCounts[kind]))
  }
  return room > 0 ? room : 0
}

export function unitHpMax(world, kind, hpMul = 1) {
  const hp = UNITS[kind].hp * hpMul + world.mods[kind].hpAdd + world.mods.global.hpAdd
  return hp > 1 ? hp : 1      // 无尽里「有代价的门」会扣最大生命，别扣成 0
}

const unitShieldMax = (world, kind) => (UNITS[kind].shield || 0) + world.mods[kind].shieldAdd + world.mods.global.shieldAdd

// elite: 雇佣兵的精英参数（data/contracts.js）。force: 不占编制（歌利亚、先遣队）——入列不看上限，之后也不挤占别人的名额。
// 无尽每层开头的保底补员（source 'relief'）入列时守护之壳在冷却：否则伊瑟拉每层白拿二十条「免死一次」，
// 兵力保底上线后她比另两位深 3.5 层（test-endless ⑫ 要求相差 ≤ 2 层）。门、技能、合同来的兵照旧自带一次
const aegisStart = (world, source) => (source === 'relief' && world.passive.aegis ? world.time + world.passive.aegis.cd : 0)

export function addUnits(world, kind, count, source, elite = null, force = false) {
  const sq = world.squad, def = UNITS[kind]
  const n = force ? count : Math.min(count, capRoom(world, kind))
  if (n <= 0) return 0
  const ids = []
  for (let j = 0; j < n; j++) {
    const hpMax = unitHpMax(world, kind, elite ? elite.hpMul : 1), shieldMax = unitShieldMax(world, kind)
    const u = {
      id: sq._nextId++, kind, x: sq.x, z: F.joinZ, hp: hpMax, hpMax, shield: shieldMax, alive: true,
      aimX: sq.x, aimZ: 0, fireT: -9, hitT: -9, name: null, elite: elite ? elite.id : false,
      kills: 0, dmg: 0, facing: FACING_FRONT,
      // 内部字段
      _def: def, _cd: world.rng.combat() * def.weapon.interval, _shots: 0, _sx: 0, _sz: 0, _placed: false,
      _dmgMul: elite ? elite.dmgMul : 1, _rateMul: elite ? elite.rateMul : 1, _hpMul: elite ? elite.hpMul : 1, _zoneT: 0,
      _shieldMax: shieldMax, _shT: -9, _d: 0,
      // _mk: 吃哪个兵种的模块；_baseDmg: 不含临时增益的伤害倍率；_invuln / _aegisT: 守护之壳；_ti: 钻机锁定的目标
      _lo: 0, _hi: 0, _mk: def.mods || kind, _baseDmg: elite ? elite.dmgMul : 1, _elite: elite, _invuln: 0, _aegisT: aegisStart(world, source), _ti: -1, _tseed: 0,
      _free: force,
    }
    if (def.hero) sq.hero = u
    sq.units.push(u)
    ids.push(u.id)
  }
  sq.counts[kind] += n
  if (force) sq.freeCounts[kind] += n
  world.stats.deployed[kind] = (world.stats.deployed[kind] || 0) + n
  sq._dirty = true
  world.events.push({ type: 'unitJoin', ids, kind, count: n, source })
  return n
}

// src: 伤害来源（虫种 id / 'boss_charge' 这类），只进统计 stats.hurtBy / stats.lostTo（调参与战报用）
export function damageUnit(world, u, dmg, src = 'other') {
  if (!u.alive || world.time < u._invuln) return
  u._shT = world.time
  if (u.shield > 0) {
    const s = Math.min(u.shield, dmg)
    u.shield -= s; dmg -= s
    if (u.shield <= 0) world.events.push({ type: 'shieldBreak', id: u.id, x: u.x, z: u.z })
    if (dmg <= 0) return
  }
  const hb = world.stats.hurtBy
  hb[src] = (hb[src] || 0) + (dmg < u.hp ? dmg : u.hp)
  u.hp -= dmg
  u.hitT = world.time
  world.events.push({ type: 'unitHit', id: u.id, x: u.x, z: u.z, dmg })
  if (u.hp <= 0) {
    const sq = world.squad, pv = world.passive
    if (pv.aegis !== null && world.time >= u._aegisT) {
      // 守护之壳：这一下本该致命，改成短暂无敌并回一口血
      const a = pv.aegis
      u.hp = u.hpMax * a.heal
      u._invuln = world.time + a.invuln
      u._aegisT = world.time + a.cd
      world.events.push({ type: 'aegis', id: u.id, x: u.x, z: u.z, dur: a.invuln })
      return
    }
    u.hp = 0
    u.alive = false
    sq.counts[u.kind]--
    if (u._free) sq.freeCounts[u.kind]--
    sq._dead = true
    sq._dirty = true
    world.stats.losses++
    world.stats.lostTo[src] = (world.stats.lostTo[src] || 0) + 1
    sq.fallen.push({ id: u.id, kind: u.kind, name: u.name, kills: u.kills, t: Math.round(world.time * 10) / 10 })
    world.events.push({ type: 'unitDie', id: u.id, kind: u.kind, x: u.x, z: u.z, name: u.name })
    if (sq.hero === u) sq.hero = null
    // 回收程序：机械单位留下残骸，到点重建（powers.js 处理队列）
    if (pv.rebuild !== null && u._def.mech) world._rebuild.push({ kind: u.kind, t: world.time + pv.rebuild.delay, elite: u._elite, free: u._free })
  }
}

// frac: 补回已损失生命的比例（默认回满）
export function healAll(world, frac = 1) {
  let amount = 0
  for (const u of world.squad.units) {
    if (!u.alive) continue
    const h = (u.hpMax - u.hp) * frac
    amount += h
    u.hp = frac >= 1 ? u.hpMax : u.hp + h
  }
  world.events.push({ type: 'heal', amount })
}

// 模块改了生命上限后调用：上限涨多少，当前血也补多少
export function refreshHp(world) {
  for (const u of world.squad.units) {
    if (!u.alive) continue
    const hpMax = unitHpMax(world, u.kind, u._hpMul)
    if (hpMax > u.hpMax) u.hp += hpMax - u.hpMax
    u.hpMax = hpMax
    if (u.hp > hpMax) u.hp = hpMax
    const sm = unitShieldMax(world, u.kind)
    if (sm > u._shieldMax) u.shield += sm - u._shieldMax
    u._shieldMax = sm
    if (u.shield > sm) u.shield = sm
  }
}

// ---- 预警类伤害的统一口径 ----
// 预警结束时队伍中心还在形状的横向范围内才算中招，此时身处形状内的单位受伤；
// 队伍中心已经离开 = 全队躲开，返回 -1。中招返回受伤人数。
export function hurtCircle(world, x, z, r, dmg, src = 'other') {
  const sq = world.squad
  if (Math.abs(sq.x - x) >= r) return -1
  const us = sq.units, r2 = r * r
  let hits = 0
  for (let n = 0; n < us.length; n++) {
    const u = us[n]
    if (!u.alive) continue
    const dx = u.x - x, dz = u.z - z
    if (dx * dx + dz * dz <= r2) { damageUnit(world, u, dmg, src); hits++ }
  }
  return hits
}

export function hurtLane(world, x, half, dmg, src = 'other') {
  const sq = world.squad
  if (Math.abs(sq.x - x) >= half) return -1
  const us = sq.units
  let hits = 0
  for (let n = 0; n < us.length; n++) {
    const u = us[n]
    if (u.alive && Math.abs(u.x - x) <= half) { damageUnit(world, u, dmg, src); hits++ }
  }
  return hits
}

const byRank = (a, b) => a._def.rank - b._def.rank || a.id - b.id

// 重新排槽位：焚化兵最前，突击兵其后；炮兵、重型在方阵后方的专属横排（先炮兵、后重型）。
// 后方横排的起点跟着步兵方阵的实际纵深往后退：人多到第 6 排以后，炮车不会插进步兵最后一排里（测试：自行炮与方阵穿模）。
// 每一排记下自己的左右端（_lo / _hi）：队伍走到桥边时整排一起往里收，而不是一个个夹在桥边叠成一摞。
function layout(sq) {
  const inf = [], art = [], heavy = []
  for (const u of sq.units) {
    const c = u._def.cls
    if (c === 'infantry' || c === 'hero') inf.push(u); else if (c === 'artillery') art.push(u); else heavy.push(u)
  }
  inf.sort(byRank)
  const rows = Math.ceil(inf.length / F.cols)
  for (let k = 0; k < inf.length; k++) {
    const row = (k / F.cols) | 0, col = F.colOrder[k % F.cols]
    inf[k]._sx = (col - (F.cols - 1) / 2) * F.colGap
    inf[k]._sz = row * F.rowGap
  }
  // 排内按兵现在的左右位置重新配槽：colOrder 是「中间往两边」交替填的，死一个人后同排后面的人
  // 全部换到镜像那一侧（左 ↔ 右），整排兵横穿方阵、几步之内挤成 3~4 米宽的一摞（视觉组截图 fx-26，碾压者冲锋时掉人最多最明显）。
  // 现在每排的槽位集合不变，只是按 x 从左到右一一对上，同排的人不会互相穿过去
  for (let r = 0; r < rows; r++) {
    const a = r * F.cols, b = Math.min(inf.length, a + F.cols)
    const slots = [], members = []
    for (let k = a; k < b; k++) { slots.push(inf[k]._sx); members.push(inf[k]) }
    slots.sort((p, q) => p - q)
    members.sort((p, q) => (p._placed ? p.x - sq.x : p._sx) - (q._placed ? q.x - sq.x : q._sx) || p.id - q.id)
    for (let j = 0; j < members.length; j++) members[j]._sx = slots[j]
  }
  // 每排的左右端
  for (let r = 0; r < rows; r++) {
    let lo = Infinity, hi = -Infinity
    for (let k = r * F.cols; k < Math.min(inf.length, (r + 1) * F.cols); k++) { if (inf[k]._sx < lo) lo = inf[k]._sx; if (inf[k]._sx > hi) hi = inf[k]._sx }
    for (let k = r * F.cols; k < Math.min(inf.length, (r + 1) * F.cols); k++) { inf[k]._lo = lo; inf[k]._hi = hi }
  }
  const infDepth = rows > 0 ? (rows - 1) * F.rowGap : 0
  // 一排最多 per 台；台数多（无尽）时一排放 5 台、间距收一点，仍然不出桥面
  const line = (list, dz, gap) => {
    const per = list.length > 8 ? 5 : 4
    const g = Math.min(gap, (2 * F.edge - 1.2) / (per - 1))
    let depth = 0
    for (let j = 0; j < list.length; j++) {
      const row = (j / per) | 0, k = j % per
      const n = Math.min(per, list.length - row * per)
      list[j]._sx = (k - (n - 1) / 2) * g
      list[j]._sz = dz + row * F.backRowGap
      list[j]._lo = -(n - 1) / 2 * g
      list[j]._hi = (n - 1) / 2 * g
      depth = row * F.backRowGap
    }
    return list.length > 0 ? dz + depth + F.backRowGap : dz
  }
  const artZ = Math.max(F.artilleryDz, infDepth + F.backClear)
  const next = line(art, artZ, F.artilleryGap)
  line(heavy, Math.max(F.heavyDz, art.length > 0 ? next + (F.heavyDz - F.artilleryDz - F.backRowGap) : infDepth + F.backClear), F.heavyGap)
}

export function update(world, input, dt) {
  const sq = world.squad
  if (sq._dead) {
    // 原地压缩，移除阵亡单位
    const us = sq.units
    let w = 0
    for (let r = 0; r < us.length; r++) if (us[r].alive) us[w++] = us[r]
    us.length = w
    sq._dead = false
  }
  if (sq._dirty) { layout(sq); sq._dirty = false }

  if (input) {
    if (input.targetX != null) sq.targetX = input.targetX
    else if (input.moveX) sq.targetX += input.moveX * F.moveSpeed * dt
  }
  sq.targetX = clamp(sq.targetX, -F.xLimit, F.xLimit)
  // 实际位置平滑追目标，并限速
  const maxStep = F.moveSpeed * dt
  sq.x += clamp((sq.targetX - sq.x) * F.follow, -maxStep, maxStep)

  const cols = sq._cols
  for (let b = 0; b < BUCKETS; b++) cols[b].length = 0
  const mods = world.mods, rb = world.passive.rebuild, time = world.time
  let hp = 0, hpMax = 0, backZ = sq.frontZ
  const us = sq.units
  for (let n = 0; n < us.length; n++) {
    const u = us[n]
    // 整排一起收：这一排的两端都留在桥面内
    let cx = sq.x
    if (cx + u._lo < -F.edge) cx = -F.edge - u._lo
    else if (cx + u._hi > F.edge) cx = F.edge - u._hi
    const tx = clamp(cx + u._sx, -F.edge, F.edge), tz = sq.frontZ + u._sz
    if (!u._placed) { u.x = tx; u._placed = true }
    u.x += (tx - u.x) * F.unitFollow
    u.z += (tz - u.z) * F.unitFollow
    const rg = mods[u.kind].regen
    if (rg > 0 && u.hp < u.hpMax) u.hp = Math.min(u.hpMax, u.hp + u.hpMax * rg * dt)
    if (rb !== null && u.hp < u.hpMax && time - u.hitT > rb.regenDelay) u.hp = Math.min(u.hpMax, u.hp + (u._def.mech === true ? rb.regen : rb.regenFoot || 0) * dt)
    else if (u.hp < u.hpMax && u._def.mech !== true && time - u.hitT > FIELD_REGEN.delay) u.hp = Math.min(u.hpMax, u.hp + FIELD_REGEN.rate * dt)
    if (u.shield < u._shieldMax && world.time - u._shT > SHIELD.delay) u.shield = Math.min(u._shieldMax, u.shield + SHIELD.rate * dt)
    hp += u.hp; hpMax += u.hpMax
    if (u.z > backZ) backZ = u.z
    cols[clamp((u.x + BUCKET_X0) | 0, 0, BUCKETS - 1)].push(u)
  }
  sq.hp = hp; sq.hpMax = hpMax; sq.backZ = backZ
}

// 虫子找人撞：在 x 附近的桶里找半径 r 内的第一个活人
export function findContact(sq, x, z, r) {
  const cols = sq._cols, r2 = r * r
  const b = (x + BUCKET_X0) | 0
  const b0 = b > 0 ? b - 1 : 0, b1 = b < BUCKETS - 1 ? b + 1 : BUCKETS - 1
  for (let bb = b0; bb <= b1; bb++) {
    const arr = cols[bb]
    for (let k = 0; k < arr.length; k++) {
      const u = arr[k]
      if (!u.alive) continue
      const dx = u.x - x, dz = u.z - z
      if (dx * dx + dz * dz < r2) return u
    }
  }
  return null
}

// 离 (x,z) 最近的活人
export function nearestUnit(sq, x, z) {
  let best = null, bd = Infinity
  const us = sq.units
  for (let n = 0; n < us.length; n++) {
    const u = us[n]
    if (!u.alive) continue
    const dx = u.x - x, dz = u.z - z, d = dx * dx + dz * dz
    if (d < bd) { bd = d; best = u }
  }
  sq._nearD = bd
  return best
}

export function aliveCount(sq) {
  let n = 0
  for (const u of sq.units) if (u.alive) n++
  return n
}
