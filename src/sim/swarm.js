// 虫群：SoA + TypedArray，容量 4096。出生、移动追人、攻击、死亡残留、槽位回收。
// 约定：alive[i]=1 表示槽位被占用（含 state=2 的尸体）；swarm.living 才是在场活虫数。
// 布防系统（GDD §13）叠在原有移动上：每只虫出生时归属一条车道（swarm.lane），大体沿道走；
// 走到本道的装置前停下啃（state = 1），装置没了接着走；冲到车道尽头先触发应急电网，电网用掉之后才扣防线。
import { ENEMIES, ENEMY_KINDS, SWARM_CAP, LIVE_CAP, DEATH_LINGER, ELITE } from '../data/enemies.js'
import { FIELD, BASE_LEN, CAMPAIGN_STRETCH } from '../data/waves.js'
import { LANE, laneOf, LANE_MOVE, BLOCK, LEAP, FENCE } from '../data/devices.js'
import { damageUnit, findContact, nearestUnit, hurtCircle } from './squad.js'
import { queryCircle } from './grid.js'
// 注意：这里不能 import devices.js / combat.js（它们经 weapons/* 反过来依赖本模块的常量，会成环）。
// 需要的三个入口由 devices.js 在 createDevices 时挂在 world._dev 上：damage(装置受伤) / fence(触发电网) / thorn(路障反伤)。

export const ST_WALK = 0, ST_ATTACK = 1, ST_DYING = 2, ST_BURROW = 3, ST_STUN = 4

const DEFS = ENEMY_KINDS.map(k => ENEMIES[k])
const CLS_CODE = { none: 0, light: 1, heavy: 2 }
// 0 无 / 1 轻甲 / 2 重甲，武器克制用
export const ENEMY_CLS = Uint8Array.from(DEFS.map(d => CLS_CODE[d.cls]))
export const KIND_INDEX = Object.fromEntries(ENEMY_KINDS.map((k, i) => [k, i]))

const BEH = { rusher: 0, standoff: 1, flyer: 2, burrower: 3, aura: 4, egg: 5, pod: 6 }
const BEHAVIOR = Uint8Array.from(DEFS.map(d => BEH[d.behavior]))
const K_WARDEN = KIND_INDEX.warden
const K_POD = KIND_INDEX.pod
const WARD = ENEMIES.warden.attack
// 无尽每层的护甲加成只给真的虫（卵和空投舱不算）
const ARMOR_GROWS = Uint8Array.from(DEFS.map(d => (d.behavior === 'egg' || d.behavior === 'pod' ? 0 : 1)))

// 冲锋型（rusher）按种类查表：撞人的半径、是不是自爆、会不会跳
const CONTACT_R = Float32Array.from(DEFS.map(d => (d.behavior === 'rusher' ? d.attack.radius : 0)))
const IS_BURST = Uint8Array.from(DEFS.map(d => (d.attack.type === 'burst' ? 1 : 0)))
const LEAPS = Uint8Array.from(DEFS.map(d => (d.leaps === true ? 1 : 0)))
// 走到装置跟前才停（不排队）：自爆的、会跳的、个头大的
const TO_FACE = Uint8Array.from(DEFS.map(d => (d.deviceMul > 0 || d.leaps === true || d.big === true ? 1 : 0)))
const F_LEAPT = 4                   // flags bit2：跳跃虫已经跳过一次

// 电网值不值得放（见 data/devices.js FENCE）：小虫 = 非 big 且 leak < smallLeak
const FENCE_SMALL = Uint8Array.from(DEFS.map(d => (d.big !== true && d.leak < FENCE.smallLeak ? 1 : 0)))
function fenceWorth(world, ln, i) {
  const s = world.swarm
  if (FENCE_SMALL[s.kind[i]] === 0) return true
  // 每步最多数一次（按 world 缓存）：每条道上的活虫数（不含空投舱）
  let fc = world._fenceCrowd
  if (!fc) fc = world._fenceCrowd = { t: -1, n: new Int32Array(LANE.count) }
  if (fc.t !== world.time) {
    fc.t = world.time; fc.n.fill(0)
    const { alive, state, kind, lane } = s
    for (let j = 0; j < s.count; j++) if (alive[j] === 1 && state[j] !== ST_DYING && kind[j] !== K_POD) fc.n[lane[j]]++
  }
  return fc.n[ln] >= FENCE.crowd
}

const X_EDGE = FIELD.xEdge - 0.2
const LINE_Z = FIELD.lineZ
const FENCE_Z = FENCE.z
const LC = LANE.centers

export function createSwarm() {
  const C = SWARM_CAP
  const f32 = () => new Float32Array(C)
  const s = {
    cap: C, count: 0, living: 0,
    kindCount: new Int32Array(ENEMY_KINDS.length),
    alive: new Uint8Array(C), kind: new Uint8Array(C),
    x: f32(), z: f32(), y: f32(), vx: f32(), vz: f32(),
    hp: f32(), hpMax: f32(), state: new Uint8Array(C), stateT: f32(),
    elite: new Uint8Array(C), shield: f32(), scale: f32(), seed: f32(), hitT: f32(),
    lane: new Uint8Array(C),     // 归属的车道 0..4（出生时定；翼螫 / 横移的虫按当前 x 更新）
    ward: new Uint8Array(C),     // 1 = 正在护巢虫光环里 / 2 = 刚离开光环，还带着余效（表现层可以拿来染色）
    wardT: f32(),                // 减伤到期时刻
    mark: new Uint8Array(C),     // 1 = 被无人机标定
    // 内部
    armor: f32(), speed: f32(), atkT: f32(),
    slowT: f32(), slow: f32(), stunT: f32(),        // 减速 / 眩晕的截止时刻与倍率
    aux: new Uint8Array(C), cnt: new Uint8Array(C), tx: f32(), tz: f32(),   // 各行为自用：阶段、剩余次数、目标点
    flags: new Uint8Array(C),    // bit0 已触发过「甲壳共振」/ bit1 是「不死孢子」复活出来的 / bit2 跳跃虫已经跳过
    shieldT: f32(), _shielded: false,                // 护盾到期时刻；场上有没有带盾的虫
    tag: new Int32Array(C),      // 一次性范围技能的去重标记（汇聚射线：已被这一道光扫过）
    _free: new Int16Array(C), _freeN: C,
    _corpse: new Int16Array(C), _cHead: 0, _cLen: 0, _warded: false,
  }
  // 栈顶是 0 号槽：先用低位，count（高水位）尽量小
  for (let i = 0; i < C; i++) s._free[i] = C - 1 - i
  return s
}

function releaseOldestCorpse(s) {
  const i = s._corpse[s._cHead]
  s._cHead = (s._cHead + 1) % s.cap
  s._cLen--
  s.alive[i] = 0
  s._free[s._freeN++] = i
}

// 返回槽位下标；到上限返回 -1（调用方自己决定丢弃还是稍后再试）
export function spawn(world, k, x, z, vx = 0, elite = false) {
  const s = world.swarm, def = DEFS[k]
  if (s.living >= LIVE_CAP || s.kindCount[k] >= def.cap) return -1
  if (s._freeN === 0) {
    // 槽位被尸体占满：提前回收最老的尸体
    if (s._cLen === 0) return -1
    releaseOldestCorpse(s)
  }
  const i = s._free[--s._freeN]
  if (i >= s.count) s.count = i + 1
  const rng = world.rng.spawn
  // 随时间变厚只算到战役结束：无尽里的成长交给每层的 hpMul，不然两头叠加
  // 按基准秒算（实际秒 ÷ 时间轴拉伸系数）：一局拉长到 180 秒，虫在同一个阶段的厚度不变
  const age0 = world.time / CAMPAIGN_STRETCH
  const age = age0 < BASE_LEN ? age0 : BASE_LEN
  let hp = (def.hp + def.hpPerSec * age) * world.diff.hpMul * (k === 0 && world.diff.lingHpMul ? world.diff.lingHpMul : 1)   // 无尽的虫海密度（只作用于裂爪虫）
  let scale = def.scale * (0.92 + 0.16 * rng()), armor = def.armor + (ARMOR_GROWS[k] === 1 ? world.diff.armorAdd : 0)
  if (elite) { hp *= ELITE.hpMul; scale *= ELITE.scale; armor += ELITE.armor }
  const beh = BEHAVIOR[k]
  s.alive[i] = 1; s.kind[i] = k
  s.x[i] = x; s.z[i] = z; s.vx[i] = vx
  // 车道归属：出生点落在哪条道就是哪条；侧翼突袭带横向初速的，按它滑到位之后的落点算
  s.lane[i] = laneOf(vx === 0 ? x : x + vx * 0.8)
  s.y[i] = beh === 2 ? def.fly.y : beh === 3 ? def.emerge.depth : 0
  s.speed[i] = def.speed[0] + (def.speed[1] - def.speed[0]) * rng()
  s.vz[i] = s.speed[i]
  s.hp[i] = hp; s.hpMax[i] = hp
  s.state[i] = beh === 3 ? ST_BURROW : ST_WALK; s.stateT[i] = world.time
  s.elite[i] = elite ? 1 : 0; s.shield[i] = 0; s.scale[i] = scale
  s.seed[i] = rng(); s.hitT[i] = -10
  s.armor[i] = armor
  s.atkT[i] = beh === 5 ? def.attack.time : def.attack.cd ? def.attack.cd * rng() : 0
  s.ward[i] = 0; s.wardT[i] = 0; s.mark[i] = 0; s.slowT[i] = 0; s.slow[i] = 1; s.stunT[i] = 0
  s.aux[i] = 0; s.cnt[i] = beh === 2 ? def.attack.dives : 0; s.tx[i] = 0; s.tz[i] = 0
  s.flags[i] = 0; s.shieldT[i] = 0; s.tag[i] = 0
  s.living++
  s.kindCount[k]++
  return i
}

// 进入死亡残留。不发事件、不计分，调用方负责。
export function kill(world, i) {
  const s = world.swarm
  if (s.state[i] === ST_DYING) return
  s.state[i] = ST_DYING
  s.stateT[i] = world.time
  s.hp[i] = 0
  s.living--
  s.kindCount[s.kind[i]]--
  s._corpse[(s._cHead + s._cLen) % s.cap] = i
  s._cLen++
}

// 直接清掉槽位，不留尸体（漏过防线的虫、孵化的卵、滑过防线的空投舱）
export function remove(s, i) {
  s.alive[i] = 0
  s.living--
  s.kindCount[s.kind[i]]--
  s._free[s._freeN++] = i
}

function leak(world, i) {
  const s = world.swarm, def = DEFS[s.kind[i]]
  world.line.hp = Math.max(0, world.line.hp - def.leak * world.diff.lineMul)
  world.stats.leaked++
  world.events.push({ type: 'leak', kind: def.id, x: s.x[i] })
  remove(s, i)
}

// 冲到车道尽头（z >= FENCE_Z）：它归属的那条道的电网还在就触发它，整条道清空；用掉了才往下漏、扣防线。
// 按归属（swarm.lane）而不是当前 x：贴近队伍的最后一段虫会被「追人」往里带，两侧车道的虫到了尽头多半已经偏进了隔壁的带子，
// 按 x 算的话两侧的电网几乎用不上。空投舱不是虫，不触发电网。
function reachEnd(world, i) {
  const s = world.swarm
  if (s.kind[i] !== K_POD) {
    const ln = s.lane[i]
    if (world.fences[ln] && fenceWorth(world, ln, i)) { world._dev.fence(world, ln); return }
  }
  if (s.z[i] >= LINE_Z) leak(world, i)
}

// 第 i 只虫这一步想从 zOld 走到 zz：本道有没有装置挡着。有就返回那个装置，并把它该停的位置写在 _stopZ、
// 装置前沿写在 _faceZ；没有返回 null。已经越过去的装置不算。seedQ = 0 表示走到装置跟前才停（不排队）。
let _stopZ = 0, _faceZ = 0
function blocker(dv, ln, zOld, zz, seedQ) {
  const n = dv.blockN[ln], base = ln * 4
  for (let k = 0; k < n; k++) {
    const face = dv.blockZ[base + k]
    if (zOld > face + 0.05) continue
    const d = dv.blockD[base + k]
    // 被挡住的虫多了就往后排：纵深跟着数量涨
    let q = d._q * BLOCK.queuePer
    q = q < BLOCK.queueMin ? BLOCK.queueMin : q > BLOCK.queueMax ? BLOCK.queueMax : q
    const stop = face - seedQ * q
    if (zz < stop) return null
    _stopZ = zOld > stop ? zOld : stop
    _faceZ = face
    return d
  }
  return null
}

// 被装置 d 挡住的虫：脓爆虫当场自爆（对装置 × deviceMul）；够得着的每 BLOCK.every 秒咬一口；够不着的在后面排队。
// 小虫同时只有 BLOCK.slots 只咬得到（装置上的 _bite 是按这个速率回的配额），大个头的不占名额。
function chew(world, i, d, def, dt) {
  const s = world.swarm
  d._qN++
  s.vz[i] = 0
  if (def.deviceMul > 0) {
    burst(world, i, def)
    world._dev.damage(world, d, def.attack.dmg * def.deviceMul * world.diff.dmgMul, def.id)
    return
  }
  if (s.z[i] < _faceZ - BLOCK.reach) {
    if (s.state[i] === ST_ATTACK) { s.state[i] = ST_WALK; s.stateT[i] = world.time }
    return
  }
  if (s.state[i] !== ST_ATTACK) { s.state[i] = ST_ATTACK; s.stateT[i] = world.time }
  if (!(def.bite > 0)) return
  s.atkT[i] -= dt
  if (s.atkT[i] > 0) return
  if (def.big !== true) {
    if (d._bite < 1) { s.atkT[i] = 0.05 + 0.1 * s.seed[i]; return }
    d._bite -= 1
  }
  s.atkT[i] = BLOCK.every * (0.85 + 0.3 * s.seed[i])
  world.events.push({ type: 'enemyAttack', i, kind: def.id, x: s.x[i], z: s.z[i], tx: d.x, tz: d.z, device: d.id })
  // 升级牌「路障反伤」
  const thorns = world.mods.device.thorns
  if (thorns > 0 && d.kind === 'barricade') world._dev.thorn(world, i, thorns * world.powerDmgMul)
  world._dev.damage(world, d, def.bite * world.diff.dmgMul, def.id)
}

function burst(world, i, def) {
  const s = world.swarm, sq = world.squad, a = def.attack
  const x = s.x[i], z = s.z[i], r2 = a.blast * a.blast
  world.events.push({ type: 'burst', x, z, r: a.blast })
  let left = a.maxTargets
  const us = sq.units
  for (let n = 0; n < us.length && left > 0; n++) {
    const u = us[n]
    if (!u.alive) continue
    const dx = u.x - x, dz = u.z - z
    if (dx * dx + dz * dz <= r2) { damageUnit(world, u, a.dmg * world.diff.dmgMul, def.id); left-- }
  }
  world.events.push({ type: 'enemyDie', i, kind: def.id, x, z, by: 'self', gore: 1 })
  kill(world, i)
}

// 被装置挡住的远程虫：最近的人在射程内就朝人开火（冷却照走），返回 true；不在射程内返回 false（去啃装置）
function overWall(world, i, def, dt) {
  const s = world.swarm, sq = world.squad, a = def.attack
  const u = nearestUnit(sq, s.x[i], s.z[i])
  if (!u || sq._nearD > a.range * a.range) return false
  s.vz[i] = 0
  s.atkT[i] -= dt
  if (s.atkT[i] > 0) return true
  s.atkT[i] = a.cd + (a.jitter ? a.jitter * world.rng.spawn() : 0)
  s.state[i] = ST_ATTACK; s.stateT[i] = world.time
  world.events.push({ type: 'enemyAttack', i, kind: def.id, x: s.x[i], z: s.z[i], tx: u.x, tz: u.z })
  damageUnit(world, u, a.dmg * world.diff.dmgMul, def.id)
  return true
}

// 远程 / 重甲 / 巨型：走到阵前停下，冷却好了打最近的人；够不着就慢慢挪过去
function standoff(world, i, def, dt, speedMul) {
  const s = world.swarm, sq = world.squad, a = def.attack
  const v = s.speed[i] * speedMul
  const stopZ = sq.frontZ - a.stop
  if (def.regen && s.hp[i] < s.hpMax[i] && world.time - s.hitT[i] > def.regen.delay) {
    s.hp[i] = Math.min(s.hpMax[i], s.hp[i] + s.hpMax[i] * def.regen.frac * dt)
  }
  if (s.z[i] < stopZ) {
    const zz = s.z[i] + v * dt
    const dv = world._dev, ln = s.lane[i]
    if (dv.blockN[ln] !== 0) {
      const d = blocker(dv, ln, s.z[i], zz, TO_FACE[s.kind[i]] === 1 ? 0 : s.seed[i])
      if (d !== null) {
        s.z[i] = _stopZ
        // 远程的（甲壳兽）被挡住时，够得着队伍就隔着装置打人，够不着才啃装置
        if (a.overWall === true && overWall(world, i, def, dt)) return
        chew(world, i, d, def, dt)
        return
      }
    }
    s.z[i] = zz
    s.vz[i] = v
    if (s.state[i] !== ST_WALK && !(s.state[i] === ST_ATTACK && world.time - s.stateT[i] < 0.3)) { s.state[i] = ST_WALK; s.stateT[i] = world.time }
    // 边走边打（第 2 轮测试：甲壳兽 / 刺脊虫走到停步线之前就被打死，战役里一发都没打出来，「没有危险」）：
    // 远程虫进了射程就开火，脚步不停。近战的照旧走到跟前再打
    if (a.onMove === true && zz >= sq.frontZ - a.range - 0.5) {
      s.atkT[i] -= dt
      if (s.atkT[i] <= 0) {
        const u = nearestUnit(sq, s.x[i], s.z[i])
        if (u !== null && sq._nearD <= a.range * a.range) fire(world, i, def, u)
        else s.atkT[i] = 0
      }
    }
    return
  }
  s.vz[i] = 0
  s.atkT[i] -= dt
  if (s.atkT[i] > 0) return
  const u = nearestUnit(sq, s.x[i], s.z[i])
  if (!u) { s.z[i] += v * dt; if (s.z[i] >= FENCE_Z) reachEnd(world, i); return }
  const d2 = sq._nearD
  if (d2 > a.range * a.range) {
    // 够不着：横向贴过去，同时往前蹭；atkT 保持到点，下一步继续判
    s.atkT[i] = 0
    const dx = u.x - s.x[i], m = v * dt
    s.x[i] += dx > m ? m : dx < -m ? -m : dx
    s.lane[i] = laneOf(s.x[i])
    s.z[i] += v * 0.5 * dt
    if (s.z[i] >= FENCE_Z) reachEnd(world, i)
    return
  }
  fire(world, i, def, u)
}

function fire(world, i, def, u) {
  const s = world.swarm, sq = world.squad, a = def.attack
  s.atkT[i] = a.cd + (a.jitter ? a.jitter * world.rng.spawn() : 0)
  s.state[i] = ST_ATTACK; s.stateT[i] = world.time
  const dmg = a.dmg * world.diff.dmgMul
  if (a.type === 'spit') world.events.push({ type: 'spit', x: s.x[i], z: s.z[i], tx: u.x, tz: u.z, t: a.flight })
  else world.events.push({ type: 'enemyAttack', i, kind: def.id, x: s.x[i], z: s.z[i], tx: u.x, tz: u.z })
  damageUnit(world, u, dmg, def.id)
  if (a.targets > 1) {
    // 近战横扫：再打范围内另外几个人
    let left = a.targets - 1
    const us = sq.units, r2 = a.range * a.range
    for (let n = 0; n < us.length && left > 0; n++) {
      const o = us[n]
      if (o === u || !o.alive) continue
      const dx = o.x - s.x[i], dz = o.z - s.z[i]
      if (dx * dx + dz * dz <= r2) { damageUnit(world, o, dmg, def.id); left-- }
    }
  }
}

// 翼螫挑俯冲目标：最靠后的那一带人里随机一个。目标点固定，队伍挪开就扑空。
function pickBack(world, i, a) {
  const s = world.swarm, sq = world.squad, us = sq.units
  const zMin = sq.backZ - a.backBand
  let n = 0
  for (let k = 0; k < us.length; k++) if (us[k].alive && us[k].z >= zMin) n++
  if (n === 0) { s.tx[i] = sq.x; s.tz[i] = sq.backZ; return }
  let pick = (world.rng.spawn() * n) | 0
  for (let k = 0; k < us.length; k++) {
    const u = us[k]
    if (!u.alive || u.z < zMin) continue
    if (pick-- === 0) { s.tx[i] = u.x; s.tz[i] = u.z; return }
  }
}

// 翼螫：aux 0 进场 → 1 扑向目标（近了压低高度）→ 2 飞过防线
function flyer(world, i, def, dt, speedMul) {
  const s = world.swarm, sq = world.squad, a = def.attack, f = def.fly
  const v = s.speed[i] * speedMul
  const ph = s.aux[i]
  let wantY = f.y
  if (ph === 1) {
    const dx = s.tx[i] - s.x[i], dz = s.tz[i] - s.z[i]
    const d = Math.sqrt(dx * dx + dz * dz)
    const stepLen = v * a.diveSpeed * dt
    if (d <= stepLen + 0.3) {
      const u = findContact(sq, s.tx[i], s.tz[i], a.hit)
      world.events.push({ type: 'enemyAttack', i, kind: def.id, x: s.x[i], z: s.z[i], tx: s.tx[i], tz: s.tz[i] })
      if (u) damageUnit(world, u, a.dmg * world.diff.dmgMul, def.id)
      if (--s.cnt[i] > 0) pickBack(world, i, a)
      else { s.aux[i] = 2; s.state[i] = ST_WALK; s.stateT[i] = world.time }
      s.y[i] = f.low
      return
    }
    s.x[i] += dx / d * stepLen
    s.z[i] += dz / d * stepLen
    s.vz[i] = dz / d * v
    if (d < a.range) {
      wantY = f.low + (f.y - f.low) * (d / a.range)
      if (s.state[i] !== ST_ATTACK) { s.state[i] = ST_ATTACK; s.stateT[i] = world.time }
    }
  } else {
    s.z[i] += v * dt
    s.vz[i] = v
    if (ph === 0) {
      if (s.z[i] >= sq.frontZ - a.pickAhead) {
        pickBack(world, i, a)
        s.aux[i] = 1
        if (!world._seen.wing) { world._seen.wing = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_wing' }) }
      }
    } else if (s.z[i] >= FENCE_Z) {
      reachEnd(world, i)
      if (s.alive[i] === 0 || s.state[i] === ST_DYING) return
    }
  }
  s.lane[i] = laneOf(s.x[i])      // 翼螫不受车道约束：归属跟着当前位置走（哨戒塔按它索敌）
  const y = s.y[i], m = f.climb * dt
  s.y[i] = wantY > y + m ? y + m : wantY < y - m ? y - m : wantY
  // 高度不落到 0：y > 0 就是「只有对空武器打得到」的判据
  if (s.y[i] < f.low) s.y[i] = f.low
}

// 掘地虫：aux 0 潜行（state=3，打不到）→ 1 停在阵前亮预警圈 → 2 破土后当近战虫
function burrower(world, i, def, dt, speedMul) {
  const s = world.swarm, sq = world.squad, e = def.emerge
  const ph = s.aux[i]
  if (ph === 2) { standoff(world, i, def, dt, speedMul); return }
  if (ph === 0) {
    const v = s.speed[i] * speedMul
    s.z[i] += v * dt
    s.vz[i] = v
    // 每只偏一点，别全从同一个点钻出来
    const dx = sq.x + (s.seed[i] - 0.5) * e.scatter - s.x[i], m = e.track * dt
    s.x[i] += dx > m ? m : dx < -m ? -m : dx
    // 没有装置时一路钻到阵前才破土。它钻得过路障，但钻过这条道最后一排装置之后就得出土（GDD §13）：
    // 布了防的道上，它在装置身后 e.behind 处冒头，离队伍还有一段路，破土那一下多半砸不到人
    let stopZ = sq.frontZ - e.ahead
    const dv = world._dev, ln = laneOf(s.x[i]), nb = dv.blockN[ln]
    if (nb !== 0) { const zb = dv.blockD[ln * 4 + nb - 1].z + e.behind; if (zb < stopZ) stopZ = zb }
    if (s.z[i] >= stopZ) {
      if (s.z[i] > sq.frontZ - e.ahead) s.z[i] = sq.frontZ - e.ahead
      stopZ = s.z[i]
      s.vz[i] = 0
      s.aux[i] = 1
      s.atkT[i] = e.warn
      world.telegraphs.push({
        id: world._nextId++, shape: 'circle', x: s.x[i], z: stopZ, r: e.radius,
        t0: world.time, t1: world.time + e.warn, team: 'enemy', style: 'emerge',
      })
      if (!world._seen.digger) { world._seen.digger = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_digger' }) }
    }
    return
  }
  s.atkT[i] -= dt
  if (s.atkT[i] > 0) return
  const x = s.x[i], z = s.z[i]
  s.aux[i] = 2
  s.y[i] = 0
  s.lane[i] = laneOf(x)           // 地下是追着队伍走的：破土点在布防区后方（z = 阵前 ahead 米），车道按破土点重算
  s.state[i] = ST_ATTACK; s.stateT[i] = world.time
  s.atkT[i] = def.attack.cd
  const hits = hurtCircle(world, x, z, e.radius, e.dmg * world.diff.dmgMul, 'digger')
  world.events.push({ type: 'emerge', x, z, r: e.radius, i, hits: hits < 0 ? 0 : hits, dodged: hits < 0 })
}

// 护巢虫：走到虫群后方停住。光环在 markAuras 里结算。
function aura(world, i, def, dt, speedMul) {
  const s = world.swarm
  const stopZ = world.squad.frontZ - def.attack.stop
  if (s.z[i] < stopZ) {
    const v = s.speed[i] * speedMul
    const zz = s.z[i] + v * dt
    const dv = world._dev, ln = s.lane[i]
    if (dv.blockN[ln] !== 0) {
      const d = blocker(dv, ln, s.z[i], zz, s.seed[i])
      if (d !== null) { s.z[i] = _stopZ; chew(world, i, d, def, dt); return }
    }
    s.z[i] = zz
    s.vz[i] = v
    if (s.state[i] !== ST_WALK) { s.state[i] = ST_WALK; s.stateT[i] = world.time }
    if (!world._seen.warden && s.z[i] > -12) { world._seen.warden = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_warden' }) }
  } else s.vz[i] = 0
}

// 卵：到点孵化。孵出来的虫就地散开。
function egg(world, i, def, dt) {
  const s = world.swarm, a = def.attack
  s.atkT[i] -= dt
  if (s.atkT[i] > 0) return
  const x = s.x[i], z = s.z[i], rng = world.rng.spawn
  remove(s, i)
  let count = 0
  for (const [kind, n] of a.brood) {
    const k = KIND_INDEX[kind]
    for (let j = 0; j < n; j++) {
      const ox = rng.tri() * a.scatter, oz = rng.tri() * a.scatter
      if (spawn(world, k, Math.max(-X_EDGE, Math.min(X_EDGE, x + ox)), z + oz) >= 0) count++
    }
  }
  world.events.push({ type: 'hatch', x, z, count })
}

// 护巢虫光环：每步在空间哈希重建之后调用，给光环内的其他虫打上 ward 标记。
export function markAuras(world) {
  const s = world.swarm, time = world.time
  const { alive, kind, state, ward, wardT } = s
  if (s._warded) {
    // 先全部降成余效（还在光环里的下面会重新标成 1），到期的摘掉。场上没有带减伤的虫时整段跳过
    let any = false
    for (let i = 0; i < s.count; i++) {
      if (ward[i] === 0) continue
      if (time >= wardT[i]) ward[i] = 0; else { ward[i] = 2; any = true }
    }
    s._warded = any
  }
  if (s.kindCount[K_WARDEN] === 0) return
  const g = world.hash, out = g.out, until = time + WARD.linger
  for (let i = 0; i < s.count; i++) {
    if (alive[i] === 0 || kind[i] !== K_WARDEN || state[i] === ST_DYING) continue
    const n = queryCircle(g, s, s.x[i], s.z[i], WARD.radius, out)
    for (let j = 0; j < n; j++) { const o = out[j]; if (kind[o] !== K_WARDEN && kind[o] !== K_POD) { ward[o] = 1; wardT[o] = until } }
    s._warded = true
  }
}

export function update(world, dt) {
  const s = world.swarm, sq = world.squad, time = world.time
  while (s._cLen > 0 && time - s.stateT[s._corpse[s._cHead]] >= DEATH_LINGER) releaseOldestCorpse(s)

  const { alive, state, kind, x, z, y, vx, vz, speed, stunT, slowT, slow } = s
  if (s._shielded) {
    // 「甲壳共振」的护盾到点消失。没有带盾的虫时整段跳过
    const { shield, shieldT } = s
    let any = false
    for (let i = 0; i < s.count; i++) {
      if (shield[i] <= 0) continue
      if (alive[i] === 0 || state[i] === ST_DYING || time >= shieldT[i]) shield[i] = 0
      else any = true
    }
    s._shielded = any
  }
  const speedMul = world.enemySpeedMul
  const px = sq.x
  const contactZ = sq.frontZ - 1, backZ = sq.backZ + 1
  const chaseZ = FIELD.chaseZ, chase = FIELD.chaseSpeed * dt
  const LM = LANE_MOVE, laneMix = LM.laneMix, chasePx = LM.chaseMix * px, scatter2 = LM.scatter * 2, band = LM.band
  const dv = world._dev, blockN = dv.blockN, fences = world.fences
  const { lane, seed, aux, flags } = s
  const n = s.count
  for (let i = 0; i < n; i++) {
    if (alive[i] === 0 || state[i] === ST_DYING) continue
    if (time < stunT[i]) {
      // 眩晕：原地不动；被钩索拽住的飞行虫落到地面（y=0，谁都能打）
      if (state[i] !== ST_STUN && y[i] >= 0) { state[i] = ST_STUN; s.stateT[i] = time; vz[i] = 0 }
      if (y[i] > 0) { const ny = y[i] - 12 * dt; y[i] = ny > 0 ? ny : 0 }
      continue
    }
    const k = kind[i], beh = BEHAVIOR[k]
    // 眩晕结束：还在地下的掘地虫回到潜地，其余回到行走
    if (state[i] === ST_STUN) { state[i] = beh === 3 && s.aux[i] < 2 ? ST_BURROW : ST_WALK; s.stateT[i] = time }
    const mul = time < slowT[i] ? speedMul * slow[i] : speedMul
    if (beh !== 0) {
      if (beh === 1) standoff(world, i, DEFS[k], dt, mul)
      else if (beh === 2) flyer(world, i, DEFS[k], dt, mul)
      else if (beh === 3) burrower(world, i, DEFS[k], dt, mul)
      else if (beh === 4) aura(world, i, DEFS[k], dt, mul)
      else if (beh === 5) egg(world, i, DEFS[k], dt)
      // beh 6 = 空投舱：由 contracts.js 推进
      continue
    }
    // 冲锋型（裂爪虫 / 脓爆虫 / 跳跃虫）
    if (aux[i] === 1) {
      // 跳跃虫正在半空：tx = 起跳的 z，tz = 落点，atkT = 还剩多久。落地后照常走
      const left = s.atkT[i] - dt
      if (left <= 0) { z[i] = s.tz[i]; y[i] = 0; aux[i] = 0; s.atkT[i] = 0 }
      else {
        const u = 1 - left / LEAP.dur
        z[i] = s.tx[i] + (s.tz[i] - s.tx[i]) * u
        y[i] = LEAP.y * 4 * u * (1 - u)
        s.atkT[i] = left
      }
      continue
    }
    const v = speed[i] * mul
    const z0 = z[i], zz = z0 + v * dt
    let xx = x[i]
    const sv = vx[i], ln = lane[i]
    if (sv !== 0) {
      // 侧翼突袭的横向初速，逐渐衰减
      xx += sv * dt
      vx[i] = sv > -0.05 && sv < 0.05 ? 0 : sv * (1 - 1.2 * dt)
    }
    if (zz > chaseZ) {
      // 贴近队伍的最后一段：本道中心 ± 个体散布，与「追人」按 laneMix : chaseMix 混合
      const d = laneMix * (LC[ln] + (seed[i] - 0.5) * scatter2) + chasePx - xx
      xx += d > chase ? chase : d < -chase ? -chase : d
    } else if (sv === 0) {
      // 沿道走：出了本道的带子就往回收
      const off = xx - LC[ln]
      if (off > band) xx -= off - band < chase ? off - band : chase
      else if (off < -band) xx += -off - band < chase ? -off - band : chase
    }
    if (xx > X_EDGE) xx = X_EDGE; else if (xx < -X_EDGE) xx = -X_EDGE
    if (blockN[ln] !== 0) {
      const d = blocker(dv, ln, z0, zz, TO_FACE[k] === 1 ? 0 : seed[i])
      if (d !== null) {
        if (LEAPS[k] === 1 && (flags[i] & F_LEAPT) === 0) {
          // 跳跃虫：第一次遇阻，跃过这个装置
          flags[i] |= F_LEAPT
          aux[i] = 1
          s.atkT[i] = LEAP.dur
          s.tx[i] = z0
          s.tz[i] = d.z + LEAP.land
          vz[i] = (s.tz[i] - z0) / LEAP.dur
          if (state[i] !== ST_WALK) { state[i] = ST_WALK; s.stateT[i] = time }
          continue
        }
        z[i] = _stopZ
        chew(world, i, d, DEFS[k], dt)
        continue
      }
    }
    if (state[i] === ST_ATTACK) { state[i] = ST_WALK; s.stateT[i] = time }
    x[i] = xx; z[i] = zz; vz[i] = v
    if (zz >= contactZ && zz <= backZ) {
      const u = findContact(sq, xx, zz, CONTACT_R[k])
      if (u) {
        if (IS_BURST[k] === 1) burst(world, i, DEFS[k])
        else {
          // 撞一下，自己也死。不算击杀。
          world.events.push({ type: 'enemyAttack', i, kind: DEFS[k].id, x: xx, z: zz, tx: u.x, tz: u.z })
          damageUnit(world, u, DEFS[k].attack.dmg * world.diff.dmgMul, DEFS[k].id)
          kill(world, i)
        }
        continue
      }
    }
    if (zz >= FENCE_Z) {
      if (fences[ln] && fenceWorth(world, ln, i)) dv.fence(world, ln)
      else if (zz >= LINE_Z) leak(world, i)
    }
  }
}
