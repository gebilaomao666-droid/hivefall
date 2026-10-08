// 雇佣兵合同：门选项、空投舱、开舱。数值在 data/contracts.js。
// 空投舱借用虫群的一个槽位（kind = pod）：所有武器都按打虫的办法打它，不用另写一套瞄准。
// 这里负责它的滑行、开舱（被打破）与作废（滑过防线），并把状态同步到 world.pods 给表现层。
import { CONTRACTS, POD, GOLIATH_CHANCE } from '../data/contracts.js'
import { ENEMIES } from '../data/enemies.js'
import { UNITS } from '../data/units.js'
import { FIELD } from '../data/waves.js'
import { clamp } from '../core/util.js'
import { spawn, remove, KIND_INDEX, ST_DYING } from './swarm.js'
import { addUnits, capRoom } from './squad.js'

const K_POD = KIND_INDEX.pod
const SPEED = ENEMIES.pod.speed[0]

const usable = (world, c) => c.force ? !world._goliath : capRoom(world, c.unit) >= c.minRoom

// 这道门的合同选项；没有合适的合同返回 null（那就出常规项）
export function contractOption(world) {
  const rng = world.rng.contract
  let c = null
  if (rng() < GOLIATH_CHANCE && usable(world, CONTRACTS.goliath)) c = CONTRACTS.goliath
  else {
    const order = rng() < 0.5 ? ['bloodhound', 'hammer'] : ['hammer', 'bloodhound']
    for (const id of order) if (usable(world, CONTRACTS[id])) { c = CONTRACTS[id]; break }
  }
  if (c === null) return null
  const count = c.force ? c.count : Math.min(c.count, capRoom(world, c.unit))
  return {
    type: 'contract', unit: c.unit, count, extra: null, tags: ['merc', ...UNITS[c.unit].tags],
    titleKey: 'gate.contract',
    params: { contract: c.id, nameKey: c.nameKey, descKey: c.descKey, count, unitKey: UNITS[c.unit].nameKey },
  }
}

// 叫一个空投舱：POD.delay 秒后砸在阵前
export function dropPod(world, contractId, x = world.squad.x) {
  const px = clamp(x, -POD.xMax, POD.xMax), time = world.time
  if (contractId === 'goliath') world._goliath = true
  world._podDrops.push({ contract: contractId, x: px, t: time + POD.delay })
  world.telegraphs.push({ id: world._nextId++, shape: 'circle', x: px, z: POD.landZ, r: POD.r, t0: time, t1: time + POD.delay, team: 'ally', style: 'pod' })
  world.events.push({ type: 'strike', power: 'contract', kind: 'pod', x: px, z: POD.landZ, r: POD.r, delay: POD.delay })
}

function open(world, pod) {
  const c = CONTRACTS[pod.contract]
  world.events.push({ type: 'podOpen', id: pod.id, x: pod.x, z: pod.z, contract: pod.contract })
  const n = addUnits(world, c.unit, c.count, 'contract', c.elite, !!c.force)
  world.contract = { id: pod.contract, state: 'open', count: n }
}

export function update(world, dt) {
  const drops = world._podDrops
  for (let n = 0; n < drops.length;) {
    const d = drops[n]
    if (world.time < d.t) { n++; continue }
    const i = spawn(world, K_POD, d.x, POD.landZ)
    if (i < 0) { n++; continue }          // 场上满了：下一步再落
    drops.splice(n, 1)
    const s = world.swarm
    const pod = { id: world._nextId++, x: d.x, z: POD.landZ, hp: s.hp[i], hpMax: s.hpMax[i], contract: d.contract, i }
    world.pods.push(pod)
    world.contract = { id: d.contract, state: 'pod', count: 0 }
    world.events.push({ type: 'podLand', id: pod.id, x: pod.x, z: pod.z, contract: d.contract, hp: pod.hp })
    world.events.push({ type: 'shake', amp: 0.12 })
    if (!world._seen.contract) { world._seen.contract = true; world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.first_contract' }) }
  }

  const pods = world.pods
  if (pods.length === 0) return
  const s = world.swarm
  let w = 0
  for (let n = 0; n < pods.length; n++) {
    const pod = pods[n], i = pod.i
    if (s.state[i] === ST_DYING) { pod.hp = 0; open(world, pod); continue }
    s.z[i] += SPEED * dt
    s.vz[i] = SPEED
    pod.z = s.z[i]
    pod.hp = s.hp[i]
    if (pod.z >= FIELD.lineZ) {
      remove(s, i)
      world.contract = { id: pod.contract, state: 'lost', count: 0 }
      world.events.push({ type: 'podLost', id: pod.id, x: pod.x, z: pod.z, contract: pod.contract })
      world.events.push({ type: 'comms', speaker: 'ops', textKey: 'comms.pod_lost' })
      continue
    }
    pods[w++] = pod
  }
  pods.length = w
}
