// 第 2 步测试：新兵种 / 新敌人 / 三种 Boss 的针对性断言。node tools/test-units.mjs
// 小场景都用摆拍世界（createWorld({ sandbox: true })）：不跑时间轴，东西自己摆，和正式对局走同一套 step。
import { createWorld, DT } from '../src/sim/world.js'
import { runHeadless, createBot } from '../src/sim/bot.js'
import { addUnits } from '../src/sim/squad.js'
import { spawn, KIND_INDEX, markAuras } from '../src/sim/swarm.js'
import { rebuild } from '../src/sim/grid.js'
import { hitEnemy } from '../src/sim/combat.js'
import { spawnBoss, damageBoss } from '../src/sim/boss.js'
import { grantModule } from '../src/sim/progression.js'
import { findBadEvent } from '../src/core/events.js'
import { UNITS, UNIT_KINDS, ANTI_AIR, HEAVY_PLAN } from '../src/data/units.js'
import { ENEMIES, ENEMY_KINDS, ELITE, LIVE_CAP } from '../src/data/enemies.js'
import { BOSSES, HARDEN as HARDEN_DEF } from '../src/data/bosses.js'
import { placeDevice } from '../src/sim/devices.js'
import { DEVICES as DEVICE_DEFS } from '../src/data/devices.js'
import { spawnGate, optionValue } from '../src/sim/gates.js'
import { FAIR_RATIO } from '../src/data/gates.js'
import { addUnits as addU, capRoom } from '../src/sim/squad.js'
import { HEAVY_ESCORT, GATE_TRAVEL } from '../src/data/gates.js'
import { MODULES } from '../src/data/modules.js'
import { COMBOS, HEROICS, HEROIC_BY_UNIT } from '../src/data/combos.js'
import { WAVES, INTRO_ORDER, PHASES } from '../src/data/waves.js'
import { NAMES, SQUAD_NAMES } from '../src/data/names.js'
import zh from '../src/data/strings.zh.js'
import en from '../src/data/strings.en.js'

const clock = () => Number(process.hrtime.bigint()) / 1e6
let failed = 0, badEvent = null
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failed++
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
const K = KIND_INDEX

const sandbox = (seed = 1) => createWorld({ seed, sandbox: true })

// 前进 seconds 秒。input: null / 对象 / (world) => 对象。on(e, world): 每个事件回调。immortal: 每步把我方血补满。
function run(world, seconds, { input = null, on = null, immortal = false, each = null } = {}) {
  const steps = Math.round(seconds / DT)
  for (let n = 0; n < steps; n++) {
    world.step(typeof input === 'function' ? input(world) : input)
    for (const e of world.events) {
      if (!badEvent) { const bad = findBadEvent(e); if (bad) badEvent = { field: bad, event: e } }
      if (on) on(e, world)
    }
    if (immortal) for (const u of world.squad.units) if (u.alive) u.hp = u.hpMax
    if (each) each(world)
  }
}

// 摆一只虫并把血量改成指定值
function put(world, kind, x, z, hp = null) {
  const i = spawn(world, K[kind], x, z)
  if (hp !== null) { world.swarm.hp[i] = hp; world.swarm.hpMax[i] = hp }
  return i
}
const livingOf = (world, kind) => world.swarm.kindCount[K[kind]]

// ============================================================ 兵种

// ---- lancer：单体破甲，溢出伤害最多跳 3 次 ----
{
  const w = sandbox()
  w.enemySpeedMul = 0
  addUnits(w, 'lancer', 1, 'test')
  for (let k = 0; k < 6; k++) put(w, 'ling', -2.5 + k, 2)
  let maxChain = 0, shots = 0, firstKills = -1
  run(w, 1.5, { on: e => { if (e.type === 'chain') maxChain = Math.max(maxChain, e.points.length); if (e.type === 'shot') shots++ }, each: w => { if (firstKills < 0 && w.stats.kills > 0) firstKills = w.stats.kills } })
  check('lancer 溢出伤害跳 3 次（一发最多 1+3 只）', maxChain === 4 && firstKills >= 5, `最长链 ${maxChain} 个点  首轮 2 发击杀 ${firstKills}/6`)

  const w2 = sandbox()
  w2.enemySpeedMul = 0
  addUnits(w2, 'lancer', 1, 'test')
  for (let k = 0; k < 10; k++) put(w2, 'ling', -2 + k * 0.4, 6)
  const ci = put(w2, 'crusher', 3, -2)
  const wi = put(w2, 'wing', 0, 4)
  let first = null, crusherHit = 0
  run(w2, 0.8, { on: e => { if (e.type === 'shot' && !first) first = e; if (e.type === 'enemyHit' && e.i === ci && !crusherHit) crusherHit = e.dmg } })
  check('lancer 优先打重甲，对重甲 +200%', first && near(first.tx, 3) && near(first.tz, -2) && near(crusherHit, 12 * 3 - 0.5), `首发落点 (${first && first.tx}, ${first && first.tz})  甲壳兽单发受伤 ${crusherHit}（12×3 − 护甲 0.5）`)
  check('lancer 打不到飞行目标', w2.swarm.hp[wi] === w2.swarm.hpMax[wi] && w2.swarm.state[wi] !== 2)
}

// ---- reaper：横扫光束 ----
{
  const w = sandbox()
  w.enemySpeedMul = 0
  addUnits(w, 'reaper', 1, 'test')
  const ids = []
  for (let x = -6; x <= 6.01; x += 0.5) ids.push(put(w, 'ling', x, -4))
  const armored = put(w, 'crusher', 0, -4.5)
  const wi = put(w, 'wing', 0, -4)
  let beam = null, armoredHit = 0
  run(w, 1.2, { on: e => { if (e.type === 'beam' && !beam) beam = e; if (e.type === 'enemyHit' && e.i === armored && !armoredHit) armoredHit = e.dmg }, each: w => { if (beam && !beam.snap) beam.snap = ids.map(i => w.swarm.state[i] === 2) } })
  const s = w.swarm
  const cx = beam ? (beam.x0 + beam.x1) / 2 : 0, width = beam ? Math.abs(beam.x1 - beam.x0) : 0
  let inDead = 0, inN = 0, outAlive = 0, outN = 0
  ids.forEach((i, k) => { const inside = Math.abs(s.x[i] - cx) <= width / 2; if (inside) { inN++; if (beam.snap[k]) inDead++ } else { outN++; if (!beam.snap[k]) outAlive++ } })
  check('reaper 横扫：带内全灭、带外不伤', beam && near(width, 8) && inN >= 12 && inDead === inN && outAlive === outN, `扫宽 ${width}  带内 ${inDead}/${inN} 死  带外 ${outAlive}/${outN} 活`)
  check('reaper 光束无视护甲、对重甲无加成、打不到飞行目标', near(armoredHit, 18) && s.hp[wi] === s.hpMax[wi], `甲壳兽受伤 ${armoredHit}（18，护甲 0.5 不生效）`)
}

// ---- psion：风暴区域，8 跳，能打飞行 ----
{
  const w = sandbox()
  w.enemySpeedMul = 0
  addUnits(w, 'psion', 1, 'test')
  const li = put(w, 'crusher', 0, 0, 5000)
  for (let k = 0; k < 12; k++) put(w, 'ling', -1 + (k % 4) * 0.6, -0.5 + ((k / 4) | 0) * 0.5, 5000)
  const wi = put(w, 'wing', 0.5, -1, 5000)
  // 只数第一场风暴（从施放到它结束）的跳数
  let storms = 0, zone = null, hitsL = 0, hitsW = 0, dmgL = 0, t0 = -1
  run(w, 7.4, { on: (e, w) => {
    if (e.type === 'storm') { storms++; if (t0 < 0) t0 = w.time }
    if (e.type === 'zone' && e.zone === 'storm' && !zone) zone = e
    if (t0 < 0 || w.time > t0 + zone.dur + 0.02) return
    if (e.type === 'enemyHit' && e.i === li) { hitsL++; dmgL = e.dmg }
    if (e.type === 'enemyHit' && e.i === wi) hitsW++
  } })
  check('psion 风暴：半径 3.1、每场 8 跳、每跳 9、无视护甲', storms >= 1 && zone && near(zone.dur, 2.8) && near(zone.r, 3.1) && hitsL === 8 && near(dmgL, 9), `风暴 ${storms} 场  半径 ${zone && zone.r}  甲壳兽被打 ${hitsL} 跳 × ${dmgL}`)
  check('psion 风暴能打到飞行目标', hitsW === 8, `翼螫被打 ${hitsW} 跳`)
}

// ---- skyhook：对空无人机群 ----
{
  const w = sandbox()
  w.enemySpeedMul = 0
  addUnits(w, 'skyhook', 1, 'test')
  const wings = [put(w, 'wing', -2, -3, 500), put(w, 'wing', 0, -3, 500), put(w, 'wing', 2, -3, 500)]
  for (let k = 0; k < 30; k++) put(w, 'ling', -3 + k * 0.2, 4)
  const shots = []
  let wingDmg = 0
  run(w, 0.6, { on: e => { if (e.type === 'shot' && shots.length < 3) shots.push(e); if (e.type === 'enemyHit' && wings.includes(e.i) && !wingDmg) wingDmg = e.dmg } })
  const onWings = shots.filter(e => near(e.tz, -3) && [-2, 0, 2].some(x => near(e.tx, x))).length
  check('skyhook 三架无人机先打飞行虫，对空 +150%', shots.length === 3 && onWings === 3 && near(wingDmg, 10), `首轮 ${shots.length} 发，其中 ${onWings} 发打翼螫  单发 ${wingDmg}（4 × 2.5）`)

  // 没有飞行虫：骚扰后排（刺脊虫）而不是打脸前的裂爪虫
  const w2 = sandbox()
  w2.enemySpeedMul = 0
  addUnits(w2, 'skyhook', 1, 'test')
  const sp = put(w2, 'spitter', 1, -3)
  for (let k = 0; k < 30; k++) put(w2, 'ling', -3 + k * 0.2, 6)
  let onSpitter = 0, total = 0
  run(w2, 0.6, { on: e => { if (e.type === 'shot') { total++; if (near(e.tx, 1) && near(e.tz, -3)) onSpitter++ } } })
  check('skyhook 没有飞行目标时骚扰后排（刺脊虫）', total > 0 && onSpitter >= 1 && w2.swarm.hp[sp] < w2.swarm.hpMax[sp], `${onSpitter}/${total} 发打刺脊虫`)
}

// ---- 只有对空武器能伤到 wing ----
{
  const w = sandbox()
  const wi = put(w, 'wing', 0, 0, 1000)
  const hurt = []
  for (const kind of UNIT_KINDS) {
    const before = w.swarm.hp[wi]
    hitEnemy(w, wi, 5, kind, null, true, null, false)
    if (w.swarm.hp[wi] < before) hurt.push(kind)
  }
  const expect = ['rifle', 'titan', 'psion', 'skyhook']
  check('只有对空兵种（突击兵/泰坦/灵能/天钩）能伤到 wing', hurt.join() === expect.join() && UNIT_KINDS.filter(k => ANTI_AIR[k]).join() === expect.join(), `能伤到: ${hurt.join(' ')}`)

  // 整队实战：焚化 + 自行炮 + 破城 + 裁决 对 8 只翼螫，一只都打不下来
  const w2 = sandbox(3)
  // 布防系统之后：每条道第一只飞过尽头的虫会触发应急电网（整条道清空、计击杀、不扣防线）。
  // 这里量的是翼螫自己的行为（打不下来 / 漏过去扣 3），先把五道电网都关掉；电网本身在 test-defense 里测
  w2.fences.fill(false)
  addUnits(w2, 'flamer', 8, 'test'); addUnits(w2, 'mortar', 2, 'test'); addUnits(w2, 'lancer', 1, 'test'); addUnits(w2, 'reaper', 1, 'test')
  run(w2, 1)
  for (let k = 0; k < 8; k++) put(w2, 'wing', -3.5 + k, -14)
  let minY = 9, attacks = 0, atkBack = 0, leaks = 0, hitDmg = 0, passedFront = 0
  run(w2, 8, {
    on: (e, w) => {
      if (e.type === 'enemyAttack' && e.kind === 'wing') { attacks++; if (e.tz >= w.squad.backZ - ENEMIES.wing.attack.backBand - 0.01) atkBack++; if (e.tz > w.squad.frontZ + 1) passedFront++ }
      if (e.type === 'leak' && e.kind === 'wing') leaks++
      if (e.type === 'unitHit' && !hitDmg) hitDmg = e.dmg
    },
    each: w => { const s = w.swarm; for (let i = 0; i < s.count; i++) if (s.alive[i] && s.kind[i] === K.wing && s.state[i] !== 2 && s.y[i] < minY) minY = s.y[i] },
  })
  check('wing 全程 y>0，非对空编队一只都打不下来', minY > 0 && w2.stats.kills === 0, `最低高度 ${minY.toFixed(2)}  击杀 ${w2.stats.kills}`)
  // 期望变更（第 1 轮测试）：俯冲伤害 2 → 4。理由：测试测试「翼螫在战役里基本打不到人」，要它真能咬掉后排
  check('wing 越过前排俯冲后排：每只俯冲 1 次、伤害 4，然后漏过防线扣 3', attacks === 8 && atkBack === 8 && passedFront === 8 && near(hitDmg, 4) && leaks === 8 && w2.line.hp === w2.line.hpMax - 24, `俯冲 ${attacks} 次（落在后排 ${atkBack}）  单次 ${hitDmg}  漏 ${leaks}  防线 ${w2.line.hp}`)

  // 同样 8 只翼螫，一台天钩全打下来
  const w3 = sandbox(3)
  addUnits(w3, 'flamer', 8, 'test'); addUnits(w3, 'skyhook', 1, 'test')
  run(w3, 1)
  for (let k = 0; k < 8; k++) put(w3, 'wing', -3.5 + k, -14)
  let leaks3 = 0
  run(w3, 8, { on: e => { if (e.type === 'leak') leaks3++ } })
  check('一台 skyhook 把同样 8 只 wing 全打下来', w3.stats.kills === 8 && leaks3 === 0 && w3.stats.dmgByUnit.skyhook > 0, `击杀 ${w3.stats.kills}  漏 ${leaks3}`)
}

// ---- 新兵种的模块 / 联动 / 英雄级 / 起名 ----
const NEW_UNITS = ['lancer', 'reaper', 'psion', 'skyhook']
{
  const expectMods = {
    lancer: ['lancer_echo', 'lancer_barrage', 'heroic_lancer'],
    reaper: ['reaper_return', 'reaper_scorch', 'heroic_reaper'],
    psion: ['psion_twin', 'heroic_psion'],
    skyhook: ['skyhook_flak', 'heroic_skyhook'],
  }
  for (const kind of NEW_UNITS) {
    const mods = Object.values(MODULES).filter(m => m.unit === kind)
    const lines = mods.filter(m => !m.equip).length, equips = mods.filter(m => m.equip).length
    const combo = Object.values(COMBOS).find(c => c.units.length === 1 && c.units[0] === kind)
    const heroic = HEROIC_BY_UNIT[kind]
    check(`${kind} 数据：2~3 条数值线 + 1~2 装备 + 1 联动 + 1 英雄级`, lines >= 2 && lines <= 3 && equips >= 1 && equips <= 2 && !!combo && !!heroic, `数值线 ${lines}  装备 ${equips}  联动 ${combo && zh[combo.nameKey]}  英雄级 ${heroic && zh[heroic.nameKey]}`)

    const w = sandbox(11)
    addUnits(w, 'rifle', 12, 'test'); addUnits(w, kind, 1, 'test')
    const evs = []
    for (const m of mods) for (let l = 0; l < m.max; l++) { grantModule(w, m.id); evs.push(...w.events.filter(e => e.type === 'heroic' || e.type === 'combo')); w.events.length = 0 }
    const u = w.squad.units.find(u => u.kind === kind)
    const he = evs.find(e => e.type === 'heroic')
    check(`${kind} 拿满模块：联动成型 + 英雄级触发 + 起名`, w.progress.combos.includes(combo.id) && w.progress.heroics.includes(heroic.id) && he && he.squadName in zh && he.squadName in en && u.name in zh && u.name in en,
      `联动 ${w.progress.combos.map(c => zh[COMBOS[c].nameKey]).join('/')}  英雄级 ${zh[heroic.nameKey]}  小队「${he && zh[he.squadName]}」  单位名 ${zh[u.name]} / ${en[u.name]}`)

    // 实战 14 秒：持续放虫，确认装备 / 英雄级真的打出了伤害
    const rng = w.rng.spawn
    let t = 0
    run(w, 14, { immortal: true, each: w => {
      t++
      if (t % 12 === 0) for (let k = 0; k < 18; k++) spawn(w, 0, rng.range(-5, 5), -21 - rng() * 2)
      if (t % 90 === 0) { spawn(w, K.crusher, rng.range(-4, 4), -21); spawn(w, K.wing, rng.range(-4, 4), -21) }
    } })
    const got = expectMods[kind].filter(id => w.stats.dmgByModule[id] > 0)
    check(`${kind} 实战：装备与英雄级都有伤害入账`, got.length === expectMods[kind].length && w.stats.dmgByUnit[kind] > 0, expectMods[kind].map(id => `${id} ${Math.round(w.stats.dmgByModule[id] || 0)}`).join('  ') + `  ${kind} 总伤害 ${Math.round(w.stats.dmgByUnit[kind])}`)
  }
}

// ---- 3 个新的跨兵种联动 + 护盾 + 钩索 ----
{
  const cross = Object.values(COMBOS).filter(c => c.units.length > 1)
  check('跨兵种联动共 4 个（新增 3 个）', cross.length === 4 && ['combo_storm_grid', 'combo_mark', 'combo_melt'].every(id => COMBOS[id]), cross.map(c => zh[c.nameKey]).join(' / '))

  // 静电网：炮弹落进风暴 → 风暴立刻多放一次电
  const w = sandbox(5)
  addUnits(w, 'rifle', 6, 'test'); addUnits(w, 'psion', 1, 'test'); addUnits(w, 'mortar', 2, 'test'); addUnits(w, 'titan', 1, 'test')
  grantModule(w, 'psion_focus'); grantModule(w, 'mortar_loader')
  const rng = w.rng.spawn
  let t = 0
  run(w, 14, { immortal: true, each: w => { if (++t % 10 === 0) for (let k = 0; k < 20; k++) spawn(w, 0, rng.range(-3, 3), -21 - rng() * 2) } })
  check('联动「静电网」：炮弹落进风暴时额外放电', w.progress.combos.includes('combo_storm_grid') && w.stats.dmgByModule.combo_storm_grid > 0, `放电伤害 ${Math.round(w.stats.dmgByModule.combo_storm_grid || 0)}`)

  // 标定：无人机打过的重甲护甲失效、受伤 +25%
  const w2 = sandbox(5)
  w2.enemySpeedMul = 0
  addUnits(w2, 'skyhook', 1, 'test'); addUnits(w2, 'lancer', 1, 'test')
  grantModule(w2, 'skyhook_servo'); grantModule(w2, 'lancer_amp')
  const c1 = put(w2, 'crusher', 0, -30, 5000)     // 射程外，不会被标定
  const c2 = put(w2, 'crusher', 2, -2, 5000)
  run(w2, 1)
  const s2 = w2.swarm
  const h1 = s2.hp[c1], h2 = s2.hp[c2]
  hitEnemy(w2, c1, 10, 'rifle', null, false, null, false); hitEnemy(w2, c2, 10, 'rifle', null, false, null, false)
  check('联动「标定」：被无人机打过的虫护甲失效、受伤 +25%', w2.progress.combos.includes('combo_mark') && s2.mark[c2] === 1 && s2.mark[c1] === 0 && near(h1 - s2.hp[c1], 9.5) && near(h2 - s2.hp[c2], 12.5), `未标定受伤 ${(h1 - s2.hp[c1]).toFixed(2)}（10 − 0.5）  已标定 ${(h2 - s2.hp[c2]).toFixed(2)}（10 × 1.25）`)

  // 熔痕：纯数值
  const w3 = sandbox(5)
  addUnits(w3, 'reaper', 1, 'test'); addUnits(w3, 'flamer', 2, 'test')
  grantModule(w3, 'reaper_scorch'); grantModule(w3, 'flamer_heat')
  check('联动「熔痕」：灼痕 +60% 伤害 +1 秒，火区半径 +0.4', w3.progress.combos.includes('combo_melt') && near(w3.mods.reaper.scorchDmgMul, 1.6) && near(w3.mods.reaper.scorchDurAdd, 1) && near(w3.mods.flamer.napalmR, 2.5))

  // 灵能帷幕：护盾先扣、脱战回复
  const w4 = sandbox(5)
  addUnits(w4, 'rifle', 4, 'test'); addUnits(w4, 'psion', 1, 'test')
  grantModule(w4, 'psion_veil'); grantModule(w4, 'psion_veil')
  const rf = w4.squad.units.find(u => u.kind === 'rifle'), ps = w4.squad.units.find(u => u.kind === 'psion')
  const ok0 = rf.shield === 10 && ps.shield === 110
  run(w4, 0.5)
  const li = put(w4, 'ling', rf.x, rf.z - 0.3)
  run(w4, 0.2)
  const afterHit = rf.shield, hpAfter = rf.hp
  run(w4, 4)
  check('psion 灵能帷幕：全队护盾 +5/级、灵能者 +50/级，护盾先扣，脱战 2.5 秒后回复', ok0 && near(afterHit, 9) && hpAfter === rf.hpMax && near(rf.shield, 10), `突击兵护盾 10 → ${afterHit} → ${rf.shield.toFixed(1)}  生命 ${hpAfter}/${rf.hpMax}  灵能者护盾 ${ps.shield}`)

  // 钩索：飞行虫被无人机击中后落地 2 秒，落地期间谁都能打
  const w5 = sandbox(5)
  addUnits(w5, 'skyhook', 1, 'test')
  grantModule(w5, 'skyhook_tether')
  run(w5, 1)
  const wi = put(w5, 'wing', 0, -4, 5000)
  let grounded = false, flameHurt = false
  run(w5, 1.2, { each: w => { if (!grounded && w.swarm.y[wi] === 0 && w.swarm.state[wi] === 4) { grounded = true; const b = w.swarm.hp[wi]; hitEnemy(w, wi, 5, 'flamer', null, true, null, false); flameHurt = w.swarm.hp[wi] < b } } })
  check('skyhook 钩索：被击中的飞行虫落地（y=0，眩晕），落地后非对空武器也能打', grounded && flameHurt)
}

// ---- 门：重型 A/B/C ----
{
  const seen = {}, byC = {}
  let okPlan = true
  for (let seed = 1; seed <= 40; seed++) {
    const p = createWorld({ seed }).heavyPlan
    if (p[0] !== 'titan' || p[1] !== 'lancer' || !HEAVY_PLAN[2].includes(p[2])) okPlan = false
    seen[p[2]] = (seen[p[2]] || 0) + 1
    if (!(p[2] in byC)) byC[p[2]] = seed
  }
  check('门剧本重型 A/B/C = 泰坦 / 破城 / 按种子抽（裁决|灵能|天钩）', okPlan && Object.keys(seen).length === 3, Object.entries(seen).map(([k, n]) => `${k}×${n}`).join('  ') + '（40 个种子）')
  // heavy bot：见重型就拿。每种 C 各跑一局，三台重型都要到手并且打出伤害
  const rows = []
  let okRuns = true
  for (const c of HEAVY_PLAN[2]) {
    const run1 = runHeadless({ seed: byC[c], bot: 'heavy', checkEvents: true })
    const r = run1.result
    if (run1.badEvent && !badEvent) badEvent = run1.badEvent
    // 签到「歌利亚」合同的那局会多一台精英泰坦
    const goliath = r.contract && r.contract.id === 'goliath' && r.contract.state === 'open' ? 1 : 0
    const got = r.deployed.titan === 1 + goliath && r.deployed.lancer === 1 && r.deployed[c] === 1 && r.dmgByUnit.lancer > 0 && r.dmgByUnit[c] > 0
    if (!got || r.outcome !== 'won') okRuns = false
    rows.push(`   seed ${byC[c]} C=${c}: ${r.outcome} ${r.seconds}s 击杀 ${r.kills} 损失 ${r.losses}  伤害占比 titan ${(r.dmgShare.titan * 100).toFixed(1)}% lancer ${(r.dmgShare.lancer * 100).toFixed(1)}% ${c} ${((r.dmgShare[c] || 0) * 100).toFixed(1)}%`)
  }
  console.log(rows.join('\n'))
  check('三道重型门都拿（heavy bot）：三台重型到手、有伤害、能通关', okRuns)
}

// ============================================================ 敌人

// ---- 波次插入时刻（GDD §3）----
{
  const MAIN = WAVES.filter(w => !w.echo)
  const first = k => MAIN.find(w => w[k] > 0)
  const range = k => { const v = WAVES.filter(w => w[k] > 0).map(w => w[k]); return [Math.min(...v), Math.max(...v)] }
  // 期望变更（第 4 轮测试）：插入时刻「翼螫 T(42) / 掘地虫 T(55) / 护巢虫 T(63) 起」→ 渐进的登场顺序。理由：用户实玩要求虫潮从少到多、
  // 35 秒前只有裂爪虫，之后按 脓爆虫 → 刺脊虫 → 甲壳兽 → 翼螫 → 掘地虫 → 巨畸体 → 护巢虫 → 举盾虫 → 跳跃虫 逐个登场（INTRO_ORDER），
  // 每种新虫第一次出现的那一波以它为特色（feature）、带大波预告（herald.new.<种类>）。表里没有回声波了（MAIN = WAVES）
  const fw = first('wing'), fd = first('digger'), fa = first('warden')
  const rw = range('wing'), rd = range('digger'), ra = range('warden')
  const formAt = PHASES.find(p => p.name === 'phase.form').at
  const intro = INTRO_ORDER.map(k => first(k))
  const ordered = intro.every((w, i) => w && w.feature === INTRO_ORDER[i] && w.herald === 'herald.new.' + INTRO_ORDER[i] && (i === 0 || w.at - intro[i - 1].at >= 3))
  const lingOnly = MAIN.filter(w => w.at < formAt).every(w => INTRO_ORDER.every(k => w[k] === 0))
  check(`波次：${formAt} 秒前只有裂爪虫，之后九种新虫按顺序各自领一波、带预告`,
    lingOnly && intro[0].at >= formAt && ordered && MAIN.filter(w => w.feature).length === INTRO_ORDER.length,
    intro.map((w, i) => `${INTRO_ORDER[i]} ${w.at}s`).join(' / '))
  // 期望变更（第 4 轮测试）：掘地虫每波 2~5 → 2~12。理由：Boss 出场后三波的掘地虫 5/4/3 → 12/11/8——挂机（不躲破土预警）的胜率要压回 70%~90%，
  // 掘地虫的破土有预警圈、走位就躲得开，罚的是不操作，不罚选牌差一点的小队（换成加甲壳兽的话「总选第 2 张」掉到 8/10、损失翻倍）
  // 期望变更（第 4 轮续）：2~12 → 2~28。理由：12/11/8 时 idle 实测仍 10/10（test-core ③「胜率 ≤ 9/10」不过、不满足 70%~90% 的目标），
  // Boss 后三波掘地虫再加到 28/24/18（全线压上那波 4 → 6），idle seed 1..10 / 11..20 都是 8/10，good bot 损失只多 1~2 人。上限仍卡住，防止继续往上堆
  check(`波次：翼螫 ${fw.at}s 起每波 6~45 / 掘地虫 ${fd.at}s 起 2~28 / 护巢虫 ${fa.at}s 起 1~3`,
    fw.at >= formAt && rw[0] >= 6 && rw[1] <= 45 && fd.at > fw.at && rd[0] >= 2 && rd[1] <= 28 && fa.at > fd.at && ra[0] >= 1 && ra[1] <= 3,
    `翼螫 ${fw.at}s 起 ${rw.join('~')}  掘地虫 ${fd.at}s 起 ${rd.join('~')}  护巢虫 ${fa.at}s 起 ${ra.join('~')}`)
}

// ---- digger：潜地 state=3、预警、出土范围伤害、可躲 ----
{
  const scene = dodge => {
    const w = sandbox(2)
    addUnits(w, 'rifle', 24, 'test')
    run(w, 1)
    const di = put(w, 'digger', 0.2, -4)
    const r = { shotsWhileBurrowed: 0, immune: true, tg: null, emergeT: -1, ev: null, hitDmg: 0, hits: 0, died: false, stateOk: true, yOk: true }
    let target = null
    run(w, 9, {
      input: w => (dodge && target !== null ? { targetX: target } : null),
      on: (e, w) => {
        if (e.type === 'shot' && w.swarm.state[di] === 3) r.shotsWhileBurrowed++
        if (e.type === 'emerge') { r.ev = e; r.emergeT = w.time }
        if (e.type === 'enemyDie' && e.kind === 'digger') r.died = true
      },
      each: w => {
        const s = w.swarm
        // 破土那一步里的 unitHit 就是出土伤害
        if (r.emergeT === w.time) for (const e of w.events) if (e.type === 'unitHit') { r.hits++; r.hitDmg = e.dmg }
        if (!r.ev && s.alive[di]) {
          if (s.state[di] !== 3) r.stateOk = false
          if (!(s.y[di] < 0)) r.yOk = false
          const b = s.hp[di]
          hitEnemy(w, di, 5, 'rifle', null, true, null, false)
          if (s.hp[di] < b) r.immune = false
        }
        const tg = w.telegraphs.find(t => t.style === 'emerge')
        if (tg && !r.tg) { r.tg = { ...tg }; target = w.squad.x + (tg.x > w.squad.x ? -3.2 : 3.2) }
      },
    })
    return r
  }
  const a = scene(false), b = scene(true)
  check('digger 潜地：state=3、y<0、打不到、没人朝它开火', a.stateOk && a.yOk && a.immune && a.shotsWhileBurrowed === 0)
  // 期望变更（第 1 轮测试）：半径 1.8 → 1.6、伤害 3 → 2（近战 2 → 0.8）。理由：不布防的挂机小队里掘地虫一局啃掉 15~25 人，
  // 是 idle 胜率掉到 3/10 的主因；伤害挪给了躲不开的翼螫 / 甲壳兽 / Boss 横扫，让会走位会布防的人也有损失
  // 期望变更（第 3 轮测试）：破土伤害 2 → 1.4（读数据）。理由：Boss 战里不躲的小队被掘地虫的破土连砸，idle 掉到 4/10（目标 7~9/10）
  check(`digger 预警圈 1.2s（半径 1.6）后破土，圈内每人受 ${ENEMIES.digger.emerge.dmg} 伤`, a.tg && near(a.tg.r, 1.6) && near(a.tg.t1 - a.tg.t0, 1.2) && near(a.emergeT - a.tg.t0, 1.2, 0.04) && a.hits > 0 && a.hits === a.ev.hits && near(a.hitDmg, ENEMIES.digger.emerge.dmg), `预警 ${a.tg && (a.tg.t1 - a.tg.t0).toFixed(2)}s  实际间隔 ${(a.emergeT - a.tg.t0).toFixed(2)}s  ${a.hits} 人各受 ${a.hitDmg}`)
  check('digger 队伍中心挪出预警圈 = 躲开，无人受伤；出土后可被击杀', b.ev && b.ev.dodged === true && b.hits === 0 && a.died && b.died)
}

// ---- warden：减伤光环 ----
{
  const w = sandbox()
  w.enemySpeedMul = 0
  const wd = put(w, 'warden', 0, -5, 1000)
  const inA = put(w, 'ling', 3, -5, 1000)      // 3 米：光环内
  const outA = put(w, 'ling', 5, -5, 1000)     // 5 米：光环外
  const wd2 = put(w, 'warden', -2, -5, 1000)   // 另一只护巢虫：不吃别人的光环
  w.step(null)
  const s = w.swarm
  const drop = i => { const b = s.hp[i]; hitEnemy(w, i, 10, 'rifle', null, true, null, false); return b - s.hp[i] }
  const dIn = drop(inA), dOut = drop(outA), dW = drop(wd), dW2 = drop(wd2)
  check('warden 光环（4 米）内伤害减 40%，光环外与护巢虫自身不减', s.ward[inA] === 1 && s.ward[outA] === 0 && s.ward[wd] === 0 && s.ward[wd2] === 0 && near(dIn, 6) && near(dOut, 10) && near(dW, 10) && near(dW2, 10), `光环内 ${dIn}  光环外 ${dOut}  护巢虫 ${dW}`)
  // 护巢虫死了，光环就没了；沾过光环的虫还带 2.5 秒的薄壳（-15%）。
  // 没有这层余效，光环只罩得住路过的那半秒，护巢虫在不在场没有区别（测试 #18）
  const WA = ENEMIES.warden.attack
  hitEnemy(w, wd, 99999, 'rifle', null, true, null, false); hitEnemy(w, wd2, 99999, 'rifle', null, true, null, false)
  w.step(null)
  const wardAfter = s.ward[inA], dLinger = drop(inA)
  for (let n = 0; n < Math.round((WA.linger + 0.1) * 60); n++) w.step(null)
  check('warden 死后光环消失：余效 2.5 秒内还减 15%，之后不减', WA.linger === 2.5 && WA.lingerReduce === 0.15 && wardAfter === 2 && near(dLinger, 8.5) && s.ward[inA] === 0 && near(drop(inA), 10) && s.ward[outA] === 0, `刚死 ward=${wardAfter} 伤害 ${dLinger}  2.6 秒后 ward=${s.ward[inA]}`)
  // 走位：停在虫群后方，不上前
  const w2 = sandbox()
  addUnits(w2, 'rifle', 1, 'test')
  const i2 = put(w2, 'warden', 0, -20, 99999)
  run(w2, 12, { immortal: true })
  check('warden 停在阵前 10 米处不上前', near(w2.swarm.z[i2], w2.squad.frontZ - ENEMIES.warden.attack.stop, 0.2), `z=${w2.swarm.z[i2].toFixed(2)}`)
}

// ---- 精英规则 ----
{
  const w = sandbox()
  w.enemySpeedMul = 0
  const a = spawn(w, K.crusher, -2, 0, 0, false), b = spawn(w, K.crusher, 2, 0, 0, true)
  const s = w.swarm
  const okStats = near(s.hpMax[b] / s.hpMax[a], ELITE.hpMul) && near(s.armor[b] - s.armor[a], ELITE.armor) && s.elite[b] === 1 && s.elite[a] === 0 && s.scale[b] > s.scale[a] * 1.1
  const xp0 = w.progress.xp
  hitEnemy(w, a, 1e6, 'rifle', null, true, null, false)
  const xpA = w.progress.xp - xp0
  hitEnemy(w, b, 1e6, 'rifle', null, true, null, false)
  const xpB = w.progress.xp - xp0 - xpA
  check('精英：血 ×2.5、护甲 +1、体型 ×1.3、经验 ×2.5', okStats && near(xpB / xpA, ELITE.xpMul), `血 ${s.hpMax[a]} → ${s.hpMax[b]}  护甲 ${s.armor[a]} → ${s.armor[b]}  经验 ${xpA} → ${xpB}`)
  // 战役里不出精英；概率拉满后普通刷怪会出，裂爪虫只有 1/4 概率
  const base = runHeadless({ seed: 1, bot: 'idle', maxSteps: 60 * 30 })
  let elites = 0
  for (let i = 0; i < base.world.swarm.count; i++) if (base.world.swarm.alive[i] && base.world.swarm.elite[i]) elites++
  const w3 = createWorld({ seed: 1 })
  w3.eliteChance = 1
  let lingElite = 0, lingAll = 0
  const seenSlots = new Set()
  for (let n = 0; n < 60 * 25; n++) {
    w3.step(w3.status === 'levelup' ? { pick: 0 } : null)
    const s3 = w3.swarm
    for (let i = 0; i < s3.count; i++) if (s3.alive[i] && s3.state[i] === 0 && s3.z[i] < -20 && !seenSlots.has(i + ':' + s3.stateT[i])) { seenSlots.add(i + ':' + s3.stateT[i]); lingAll++; if (s3.elite[i]) lingElite++ }
  }
  check('精英：战役默认不出；eliteChance=1 时裂爪虫约 1/4 是精英', elites === 0 && lingAll > 100 && lingElite / lingAll > 0.15 && lingElite / lingAll < 0.35, `战役精英 ${elites}  概率拉满时 ${lingElite}/${lingAll}`)
}

// ============================================================ Boss

const BOSS_STATES = new Set(['walk', 'idle', 'attack', 'charge_windup', 'charge', 'stunned', 'burrowed', 'emerging', 'dying'])

// 摆一个 Boss 场景：24 名突击兵 + Boss（血量拉高，方便看完整套机制）
function bossScene(kind, seed = 4) {
  const w = sandbox(seed)
  addUnits(w, 'rifle', 24, 'test')
  run(w, 1)
  spawnBoss(w, kind)
  w.boss.hp = w.boss.hpMax = 1e7
  return w
}

// ---- ravager ----
{
  const scene = dodge => {
    const w = bossScene('ravager')
    const r = { states: new Set(), stun: null, stunState: null, chargeHit: null, hit8: 0, tg: null, vuln: 0, badState: false }
    let target = null
    // 期望变更（修复第 2 轮）：首次冲锋 2 → 5 秒（先让玩家看清它压上来），场景时长跟着 + (first − 2)。条件不变
    run(w, 6 + BOSSES.ravager.charge.first - 2, {
      immortal: true,
      input: w => (dodge && target !== null ? { targetX: target } : null),
      on: (e, w) => {
        if (e.type === 'bossStun' && !r.stun) { r.stun = e; r.stunState = w.boss.state; r.vuln = w.boss._vuln }
        if (e.type === 'bossAttack' && e.kind === 'charge_hit' && !r.chargeHit) r.chargeHit = e
        if (e.type === 'unitHit' && near(e.dmg, BOSSES.ravager.charge.dmg)) r.hit8++
      },
      each: w => {
        r.states.add(w.boss.state)
        if (!BOSS_STATES.has(w.boss.state)) r.badState = true
        const tg = w.telegraphs.find(t => t.style === 'charge')
        if (tg && !r.tg) { r.tg = { ...tg }; target = tg.x + (tg.x > 0 ? -3 : 3) }
      },
    })
    return r
  }
  const a = scene(true), b = scene(false)
  check('ravager 冲锋预警带：宽 4、1.2 秒', a.tg && a.tg.shape === 'lane' && near(a.tg.w, 4) && near(a.tg.t1 - a.tg.t0, 1.2))
  check('ravager 躲开冲锋后进入 stunned（2 秒，受伤 ×1.5），无人受伤', a.stun && a.stunState === 'stunned' && near(a.stun.dur, 2) && near(a.vuln, 1.5) && !a.chargeHit && a.hit8 === 0 && a.states.has('charge_windup') && a.states.has('charge') && !a.badState, `状态 ${[...a.states].join(' → ')}`)
  // 期望变更（第 1 轮测试）：「带内每人受 8」→「带内最靠前的至多 maxTargets（15，且不超过在场人数的 30%）人各受 10」。理由：冲锋改成「没躲 = 掉一截兵」，
  // 以前 8 伤打不死满血步兵、第二下整列蒸发；现在一下撞倒前面十来个，不再按整列算
  const ch = BOSSES.ravager.charge
  // 期望变更（第 3 轮测试）：maxTargets 15 → 11（在场占比 24% → 17.5%）。理由：时间轴压短后 Boss 战和三个大波叠在一起，挂机小队 3/10（目标 7~9/10）；
  // 不躲冲锋仍然一下掉一截兵（实测 60 人时撞倒 11 个）
  check(`ravager 没躲开：带内最靠前的至多 ${ch.maxTargets} 人各受 ${ch.dmg}，Boss 不眩晕`, ch.dmg === 10 && ch.maxTargets === 11 && b.chargeHit && b.chargeHit.hits > 0 && b.chargeHit.hits <= ch.maxTargets && b.hit8 === b.chargeHit.hits && !b.stun && !b.states.has('stunned'), `${b.hit8} 人各受 ${ch.dmg}`)

  // 残血后冲得更勤。相邻两次预警的间隔 = 冷却 + 1.2 秒预警 + 冲刺用时
  const gapsAt = frac => {
    const w = bossScene('ravager')
    w.boss.hp = w.boss.hpMax * frac
    let enrage = 0
    // 狂暴现在是第 2 阶段（血量 < 35%）的效果：阶段要靠伤害跨过阈值才进得去，直接改血量不算。
    // 残血的那一局补两下 1 点伤害，把两个阶段走完
    if (frac < 0.35) for (let k = 0; k < 2; k++) { damageBoss(w, 1, 'rifle', null, null, true); w.step(null); for (const e of w.events) if (e.type === 'bossAttack' && e.kind === 'enrage') enrage++ }
    // 期望变更（修复第 2 轮）：碾压者硬化 6.5 → 8.5 秒后，残血那一局第 1 阶段的硬化要 8.5 秒才结束、之后才进第 2 阶段（狂暴），
    // 17 秒里狂暴前还会有一次满血节奏的冲锋。只量狂暴之后的间隔，时长 17 → 22 秒保证狂暴后至少两个间隔。条件不变
    const windups = []
    let madT = frac < 0.35 ? Infinity : -Infinity
    run(w, 22, { immortal: true, on: (e, w) => { if (e.type === 'bossAttack' && e.kind === 'enrage') { enrage++; madT = w.time } if (e.type === 'bossAttack' && e.kind === 'charge_windup' && w.time >= madT) windups.push(w.time) } })
    return { enrage, gaps: windups.slice(1).map((t, k) => t - windups[k]) }
  }
  const calm = gapsAt(1), mad = gapsAt(0.3)
  // 期望变更（第 1 轮测试）：「< 40% 后冷却 6 → 4 秒」→「第 2 阶段（< 35%）狂暴，冷却 6 → 3.6 秒」，间隔区间按 3.6 + 1.2 秒预警 + 冲刺同步下移 0.4 秒
  check('ravager 第 2 阶段（<35%）狂暴后冲锋冷却 6s → 3.6s', BOSSES.ravager.enrage.every === 3.6 && calm.enrage === 0 && mad.enrage === 1 && calm.gaps.length >= 1 && mad.gaps.length >= 2 && calm.gaps.every(g => g >= 7.2) && mad.gaps.every(g => g >= 4.8 && g < 5.8), `相邻预警间隔  满血 ${calm.gaps.map(g => g.toFixed(2)).join(' / ')}s  残血 ${mad.gaps.map(g => g.toFixed(2)).join(' / ')}s`)
}

// ---- 第 3 轮：路障顶冲锋 / 甲壳硬化的下限 ----
{
  const ch = BOSSES.ravager.charge
  // 队伍站中路不躲，正前方（第 2 道 row 0，贴着队伍）放一道路障：第一次冲锋被它顶停
  const wallScene = hp => {
    const w = bossScene('ravager')
    const d = placeDevice(w, 'barricade', 2, 0, true).device
    if (hp !== null) d.hp = hp
    const r = { crash: null, hit: null, stun: null, die: null, line0: w.line.hp, wall: d }
    run(w, 4 + ch.first - 2, {   // 期望变更（修复第 2 轮）：首次冲锋 2 → 5 秒，时长跟着 + (first − 2)
      immortal: true,
      on: e => {
        if (e.type === 'bossAttack' && e.kind === 'crash' && !r.crash) r.crash = e
        if (e.type === 'bossAttack' && e.kind === 'charge_hit' && !r.hit) r.hit = e
        if (e.type === 'bossStun' && !r.stun) r.stun = e
        if (e.type === 'deviceDie' && e.id === d.id) r.die = e
      },
    })
    r.line1 = w.line.hp
    return r
  }
  const a = wallScene(null), b = wallScene(ch.deviceDmg)
  check(`路障顶停冲锋：Boss 撞墙眩晕、没人受伤、防线不扣，路障掉 ${ch.deviceDmg - 1}（护甲 1）`, a.crash && a.crash.line === 0 && a.crash.device === a.wall.id && a.stun && !a.hit && a.line1 === a.line0 && !a.die && near(a.wall.hp, DEVICE_DEFS.barricade.hp - (ch.deviceDmg - DEVICE_DEFS.barricade.armor)),
    `crash ${a.crash ? 'line ' + a.crash.line : '无'}  路障剩 ${a.wall.hp}  防线 ${a.line0} → ${a.line1}`)
  check('扛不住这一下的路障被碾碎，冲锋照样撞进队伍', b.die && b.die.by === 'boss' && b.hit && b.hit.hits > 0 && !(b.crash && b.crash.device), `碾碎 ${!!b.die}  撞到 ${b.hit ? b.hit.hits : 0} 人`)

  // 硬化期间跳不过下一个阶段阈值；最后一个阶段里硬化期间打不死（留 HARDEN.floor）
  const w = sandbox(2)
  addUnits(w, 'rifle', 4, 'test')
  run(w, 0.2)
  spawnBoss(w, 'ravager')
  const bb = w.boss, ph = bb._def.phases
  const hit = () => { damageBoss(w, 1e9, 'power', null, 'test', true); w.step(null) }
  hit()                                   // 打到 70%，进第 1 阶段（硬化）
  const p1 = bb.phase === 1 && bb.hardened
  hit()                                   // 硬化中：最多打到 35%，不进第 2 阶段
  const held1 = near(bb.hp, ph[1].at * bb.hpMax) && bb.phase === 1
  run(w, ph[0].harden + 0.1, { immortal: true })
  hit()                                   // 硬化结束：进第 2 阶段（又硬化）
  const p2 = bb.phase === 2 && bb.hardened
  hit()                                   // 最后一个阶段的硬化中：打不死
  const held2 = bb.state !== 'dying' && near(bb.hp, HARDEN_DEF.floor * bb.hpMax)
  run(w, ph[1].harden + 0.1, { immortal: true })
  hit()
  check('甲壳硬化期间跳不过下一个阶段、最后一个阶段的硬化里打不死；硬化结束后照常', p1 && held1 && p2 && held2 && bb.state === 'dying', `第 1 阶段 ${p1}  卡在 35% ${held1}  第 2 阶段 ${p2}  卡在 ${HARDEN_DEF.floor * 100}% ${held2}  最后 ${bb.state}`)
}

// ---- matriarch ----
{
  const def = BOSSES.matriarch
  const scene = (bot, secs = 26) => {
    const w = bossScene('matriarch')
    const play = bot ? createBot('good', 4) : null
    const r = { maxZ: -99, states: new Set(), acid: 0, acidTg: 0, acidHit: 0, acidDodged: 0, acidDmg: 0, lay: 0, laid: 0, hatch: 0, hatched: 0, eggKills: 0, pools: [], badState: false, poolTicks: 0 }
    const tgSeen = new Set(), poolSeen = new Set()
    run(w, secs, {
      immortal: true,
      input: play ? w => play(w) : null,
      on: (e, w) => {
        if (e.type === 'bossAttack') {
          if (e.kind === 'acid') r.acid++
          if (e.kind === 'acid_hit') { if (e.dodged) r.acidDodged++; else { r.acidHit++ } }
          if (e.kind === 'lay') { r.lay++; r.laid += e.count }
        }
        if (e.type === 'unitHit' && near(e.dmg, def.acid.dmg)) r.acidDmg++
        if (e.type === 'unitHit' && near(e.dmg, def.acid.tickDmg)) r.poolTicks++
        if (e.type === 'hatch') { r.hatch++; r.hatched += e.count }
        if (e.type === 'enemyDie' && e.kind === 'egg') r.eggKills++
      },
      each: w => {
        const b = w.boss
        r.states.add(b.state)
        if (!BOSS_STATES.has(b.state)) r.badState = true
        if (b.z > r.maxZ) r.maxZ = b.z
        for (const t of w.telegraphs) if (t.style === 'acid' && !tgSeen.has(t.id)) { tgSeen.add(t.id); r.acidTg++ }
        for (const zn of w.zones) if (zn.type === 'acid' && !poolSeen.has(zn.id)) { poolSeen.add(zn.id); r.pools.push(zn.t1 - zn.t0) }
      },
    })
    r.world = w
    return r
  }
  const a = scene(false)
  check('matriarch 停在远端不前进', near(a.maxZ, def.holdZ, 0.01) && a.states.has('walk') && a.states.has('idle') && a.states.has('attack') && !a.badState, `最远走到 z=${a.maxZ.toFixed(2)}  状态 ${[...a.states].join(' / ')}`)
  check('matriarch 每 5 秒吐 3 团酸液：预警圈 → 落地伤害 → 3 秒酸池', a.acid >= 3 && a.acidTg === a.acid * 3 && a.pools.length >= (a.acid - 1) * 3 && a.pools.every(d => near(d, 3)) && a.acidHit > 0 && a.acidDmg > 0 && a.poolTicks > 0, `吐酸 ${a.acid} 轮  预警圈 ${a.acidTg}  酸池 ${a.pools.length} 个 × ${a.pools[0]}s  站着不动：中 ${a.acidHit} 团，落地伤害 ${a.acidDmg} 人次，酸池跳伤 ${a.poolTicks} 人次`)
  check('matriarch 每 8 秒产 6 颗卵，卵可提前打掉', a.lay >= 2 && a.laid === a.lay * 6 && a.eggKills > 0, `产卵 ${a.lay} 轮共 ${a.laid} 颗  被打掉 ${a.eggKills}  孵化 ${a.hatch}`)
  const b = scene(true)
  check('matriarch good bot 能躲开酸液', b.acid >= 3 && b.acidHit === 0 && b.acidDodged >= (b.acid - 1) * 3 && b.acidDmg === 0 && b.poolTicks === 0, `落地 ${b.acidDodged + b.acidHit} 团，躲开 ${b.acidDodged} 团；酸池跳伤 ${b.poolTicks} 人次`)

  // 没人打：卵 3 秒后孵化成 12 只裂爪虫 + 1 只脓爆虫
  const w = sandbox(4)
  spawnBoss(w, 'matriarch')
  let layT = -1, hatchT = -1, hatch = 0, hatched = 0, eggHp = 0
  run(w, 18, { on: (e, w) => {
    if (e.type === 'bossAttack' && e.kind === 'lay' && layT < 0) { layT = w.time; for (let i = 0; i < w.swarm.count; i++) if (w.swarm.alive[i] && w.swarm.kind[i] === K.egg) eggHp = w.swarm.hpMax[i] }
    if (e.type === 'hatch') { if (hatchT < 0) hatchT = w.time; if (w.time - hatchT < 0.1) { hatch++; hatched += e.count } }
  } })
  check('matriarch 卵（血 30）3 秒后孵化：每颗 12 裂爪虫 + 1 脓爆虫', near(eggHp, 30) && near(hatchT - layT, 3, 0.05) && hatch === 6 && hatched === 6 * 13, `卵血 ${eggHp}  产卵到孵化 ${(hatchT - layT).toFixed(2)}s  ${hatch} 颗孵出 ${hatched} 只`)
}

// ---- leviathan ----
{
  const def = BOSSES.leviathan
  const scene = bot => {
    const w = bossScene('leviathan')
    const play = bot ? createBot('good', 4) : null
    const r = { states: new Set(), emerges: [], emergeHits: 0, emergeDodged: 0, hit6: 0, spines: 0, spinesHit: 0, spinesDodged: 0, hit4: 0, tg: null, laneTg: null, immune: true, vulnDrop: 0, badState: false, shotsAtBossWhileBurrowed: 0 }
    run(w, 21, {
      immortal: true,
      input: play ? w => play(w) : null,
      on: (e, w) => {
        if (e.type === 'bossAttack' && e.kind === 'emerge') { r.emerges.push(w.time); if (e.dodged) r.emergeDodged++; else r.emergeHits += e.hits }
        if (e.type === 'bossAttack' && e.kind === 'spines') { r.spines++; if (e.dodged) r.spinesDodged++; else r.spinesHit += e.hits }
        if (e.type === 'unitHit' && near(e.dmg, def.burrow.dmg)) r.hit6++
        if (e.type === 'unitHit' && near(e.dmg, def.spines.dmg)) r.hit4++
        if (e.type === 'bossHit' && w.boss.state === 'burrowed' && e.dmg > 0 && r.lastState === 'burrowed') r.shotsAtBossWhileBurrowed++
      },
      each: w => {
        const b = w.boss
        r.states.add(b.state)
        if (!BOSS_STATES.has(b.state)) r.badState = true
        if (b.state === 'burrowed' && r.lastState === 'burrowed') {
          const hp = b.hp
          damageBoss(w, 100, 'rifle', null, null, true)
          if (b.hp < hp) r.immune = false
        } else if (b.state === 'attack' && !r.vulnDrop) {
          const hp = b.hp
          damageBoss(w, 100, 'rifle', null, null, true)
          r.vulnDrop = hp - b.hp
        }
        r.lastState = b.state
        w._bossHitStep = 0
        const tg = w.telegraphs.find(t => t.style === 'emerge')
        if (tg && !r.tg) r.tg = { ...tg }
        const lane = w.telegraphs.find(t => t.style === 'spines')
        if (lane && !r.laneTg) r.laneTg = { ...lane }
      },
    })
    return r
  }
  const a = scene(false)
  const gaps = a.emerges.slice(1).map((t, k) => t - a.emerges[k])
  check('leviathan 潜地时打不到；出土后暴露弱点受伤 ×1.25', def.burrow.vuln === 1.25 && a.immune && near(a.vulnDrop, 125) && a.states.has('burrowed') && a.states.has('emerging') && a.states.has('attack') && !a.badState, `潜地受伤 0  暴露时 100 → ${a.vulnDrop}  状态 ${[...a.states].join(' / ')}`)
  check('leviathan 每 5 秒破土：预警圈半径 3、1.4 秒，出土伤害 6', a.tg && near(a.tg.r, 3) && near(a.tg.t1 - a.tg.t0, 1.4) && gaps.length >= 3 && gaps.every(g => near(g, 5, 0.05)) && a.emergeHits > 0 && a.hit6 === a.emergeHits, `破土 ${a.emerges.length} 次  间隔 ${gaps.map(g => g.toFixed(2)).join(' / ')}s  站着不动共 ${a.hit6} 人次受 6`)
  check('leviathan 暴露期间吐刺：车道预警 → 带内每人受 4', a.laneTg && a.laneTg.shape === 'lane' && near(a.laneTg.w, def.spines.width) && near(a.laneTg.t1 - a.laneTg.t0, def.spines.warn) && a.spines >= 4 && a.spinesHit > 0 && a.hit4 === a.spinesHit, `吐刺 ${a.spines} 次  站着不动共 ${a.hit4} 人次受 4`)
  // 一次露头挨得太狠就提前潜回去：火力再猛，也得等它第二次破土（保证看得到两次机制）
  {
    const w = bossScene('leviathan')
    const bz = w.boss
    let guard = 0
    while (bz.state !== 'attack' && guard++ < 600) w.step(null)
    const t0 = w.time
    bz.phase = def.phases.length      // 阶段走完：这里只验「露头挨太狠就缩回去」，不让阶段阈值把这一下封顶
    damageBoss(w, bz.hpMax * (def.burrow.flinch + 0.02) / def.burrow.vuln, 'rifle', null, null, true)
    let burrowEv = false
    w.step(null)
    for (const e of w.events) if (e.type === 'bossAttack' && e.kind === 'burrow') burrowEv = true
    const early = bz.state === 'burrowed' && w.time - t0 < 0.1, hpLeft = bz.hp / bz.hpMax
    const hp0 = bz.hp
    damageBoss(w, 500, 'rifle', null, null, true)
    const immune = bz.hp === hp0
    guard = 0
    let reset = -1
    while (bz.state !== 'attack' && guard++ < 600) { w.step(null); if (bz.state === 'emerging' && reset < 0) reset = bz._expDmg }
    check('leviathan 一次露头掉血超过 55% 就提前潜回去，下次破土重新计', def.burrow.flinch === 0.55 && early && burrowEv && immune && near(hpLeft, 1 - def.burrow.flinch - 0.02, 0.01) && bz.state === 'attack' && reset >= 0 && reset < bz.hpMax * 0.05, `挨了 ${Math.round((1 - hpLeft) * 100)}% → ${early ? '立刻潜地' : '没潜'}  ${(w.time - t0).toFixed(2)} 秒后再次破土`)
  }
  const b = scene(true)
  check('leviathan good bot 能躲开破土和吐刺', b.emerges.length >= 4 && b.emergeDodged === b.emerges.length && b.spines >= 4 && b.spinesDodged === b.spines && b.hit6 === 0 && b.hit4 === 0, `破土 ${b.emergeDodged}/${b.emerges.length} 躲开  吐刺 ${b.spinesDodged}/${b.spines} 躲开`)
}

// ---- 三种 Boss 各打一整局战役（good bot）+ 确定性 ----
{
  const rows = []
  let wins = 0, total = 0
  for (const boss of Object.keys(BOSSES)) {
    for (const seed of [1, 2, 3]) {
      const run1 = runHeadless({ seed, bot: 'good', boss, checkEvents: true })
      const r = run1.result
      if (run1.badEvent && !badEvent) badEvent = run1.badEvent
      total++
      if (r.outcome === 'won') wins++
      rows.push(`   ${boss.padEnd(9)} seed ${seed}: ${r.outcome} ${r.seconds}s  击杀 ${r.kills}  损失 ${r.losses}  防线 ${r.line.hp}`)
    }
  }
  console.log(rows.join('\n'))
  check('三种 Boss 整局战役 good bot 全胜', wins === total, `${wins}/${total}`)
  const j1 = JSON.stringify(runHeadless({ seed: 5, bot: 'good', boss: 'matriarch' }).result)
  const j2 = JSON.stringify(runHeadless({ seed: 5, bot: 'good', boss: 'matriarch' }).result)
  const j3 = JSON.stringify(runHeadless({ seed: 5, bot: 'heavy', boss: 'leviathan' }).result)
  const j4 = JSON.stringify(runHeadless({ seed: 5, bot: 'heavy', boss: 'leviathan' }).result)
  check('确定性：新内容下同 seed 同输入结果一致', j1 === j2 && j3 === j4)
}

// ---- good bot 在正式战役里躲新机制 ----
{
  // 期望变更：「躲开」从 e.dodged 改成「这一次破土没伤到人（hits = 0）」。理由：布了防的道上掘地虫在装置身后破土，
  // 圈离队伍还有一段路、圈里没人；而 dodged 只表示「队伍中心横向出了圈」，这种够不着的圈 bot 不会（也不该）特意去躲
  let emerge = 0, dodged = 0, stun = 0, chargeHit = 0, idleHit = 0, idleEmerge = 0
  for (let seed = 1; seed <= 5; seed++) {
    runHeadless({ seed, bot: 'good', onStep: w => { for (const e of w.events) {
      if (e.type === 'emerge') { emerge++; if (e.dodged || e.hits === 0) dodged++ }
      if (e.type === 'bossStun') stun++
      if (e.type === 'bossAttack' && e.kind === 'charge_hit') chargeHit++
    } } })
    runHeadless({ seed, bot: 'idle', onStep: w => { for (const e of w.events) if (e.type === 'emerge') { idleEmerge++; if (!e.dodged && e.hits > 0) idleHit++ } } })
  }
  check('good bot：掘地虫破土 ≥85% 没伤到人，碾压者冲锋全部躲开', emerge >= 50 && dodged / emerge >= 0.85 && stun >= 5 && chargeHit === 0, `破土 ${dodged}/${emerge} 躲开（idle 对照：${idleEmerge - idleHit}/${idleEmerge}）  冲锋躲开 ${stun} 次、被撞 ${chargeHit} 次`)
}

// ============================================================ 名字 / 文案

{
  const uniq = a => new Set(a).size === a.length
  const squadTotal = Object.values(SQUAD_NAMES).reduce((n, v) => n + v.zh.length, 0)
  const pairs = Object.values(SQUAD_NAMES).every(v => v.zh.length === v.en.length && v.zh.length >= 4)
  const keysOk = NAMES.zh.every((_, i) => `name.p.${i}` in zh && `name.p.${i}` in en) && UNIT_KINDS.every(k => SQUAD_NAMES[k] && SQUAD_NAMES[k].zh.every((_, i) => `squadname.${k}.${i}` in zh && `squadname.${k}.${i}` in en))
  check('names.js：80 个士兵名 + 40 个小队绰号（8 个兵种都有），中英齐全不重复', NAMES.zh.length === 80 && NAMES.en.length === 80 && uniq(NAMES.zh) && uniq(NAMES.en) && squadTotal === 40 && pairs && keysOk, `士兵名 ${NAMES.zh.length}  绰号 ${squadTotal}`)
  const need = []
  for (const b of Object.values(BOSSES)) need.push(b.nameKey, b.commsKey)
  for (const e of Object.values(ENEMIES)) need.push(e.nameKey)
  need.push('comms.first_heroic', 'comms.first_wing', 'comms.first_digger', 'comms.first_warden')
  const miss = need.filter(k => !(k in zh) || !(k in en))
  check('新增文案 key 中英都有', miss.length === 0, miss.join(', '))
  check('数据：8 个兵种全部实现，模块 / 联动 / 英雄级数量', UNIT_KINDS.every(k => UNITS[k].implemented) && Object.keys(HEROICS).length === 8 && Object.keys(COMBOS).length === 13 && ENEMY_KINDS.every(k => ENEMIES[k].implemented),
    `兵种模块 ${Object.values(MODULES).filter(m => m.unit).length}  通用牌 ${Object.values(MODULES).filter(m => !m.unit).length}  联动 ${Object.keys(COMBOS).length}  英雄级 ${Object.keys(HEROICS).length}`)
}

// ============================================================ 性能

{
  // 全兵种 + 全敌种，在场顶到 3400
  const world = createWorld({ seed: 77 })
  addUnits(world, 'rifle', 45, 'test'); addUnits(world, 'flamer', 10, 'test'); addUnits(world, 'mortar', 4, 'test')
  world.squad.caps.heavy = 5
  for (const k of ['titan', 'lancer', 'reaper', 'psion', 'skyhook']) addUnits(world, k, 1, 'test')
  for (const m of Object.values(MODULES)) if (m.unit && m.max <= 3) for (let l = 0; l < m.max; l++) grantModule(world, m.id)
  world.events.length = 0
  const rng = world.rng.spawn
  const mix = [[K.crusher, 0.02, 100], [K.wing, 0.03, 110], [K.digger, 0.006, 20], [K.warden, 0.003, 10], [K.spitter, 0.006, 24]]
  let total = 0, worst = 0, timed = 0, liveSum = 0
  for (let n = 0; n < 660; n++) {
    while (world.swarm.living < LIVE_CAP) {
      let kind = 0
      const roll = rng()
      let acc = 0
      for (const [k, p, cap] of mix) { acc += p; if (roll < acc) { if (world.swarm.kindCount[k] < cap) kind = k; break } }
      if (spawn(world, kind, rng.range(-6, 6), rng.range(-24, 4)) < 0) break
    }
    world.line.hp = world.line.hpMax
    for (const u of world.squad.units) u.hp = u.hpMax
    const live = world.swarm.living, running = world.status === 'running'
    const t0 = clock()
    world.step(world.status === 'levelup' ? { pick: 0 } : null)
    const ms = clock() - t0
    if (n >= 60 && running) { total += ms; timed++; liveSum += live; if (ms > worst) worst = ms }
    if (!badEvent) for (const e of world.events) { const bad = findBadEvent(e); if (bad) { badEvent = { field: bad, event: e }; break } }
  }
  const avg = total / timed
  check('性能：全兵种全模块 + 全敌种，3400 只在场单步平均 < 3ms', avg < 3 && liveSum / timed >= 3390, `平均 ${avg.toFixed(3)} ms  最慢 ${worst.toFixed(2)} ms  平均在场 ${Math.round(liveSum / timed)}  击杀 ${world.stats.kills}  英雄级 ${world.progress.heroics.length}  联动 ${world.progress.combos.length}`)
}

// ---- 平衡调整带来的新行为 ----
{
  // 巢母边走边施法：吐酸 / 产卵的计时从出场起算，不等走到位
  const def = BOSSES.matriarch
  const w = bossScene('matriarch')
  const t0 = w.time
  let acidT = -1, acidZ = 0, layT = -1
  run(w, 7, { immortal: true, on: (e, w) => {
    if (e.type !== 'bossAttack') return
    if (e.kind === 'acid' && acidT < 0) { acidT = w.time - t0; acidZ = w.boss.z }
    if (e.kind === 'lay' && layT < 0) layT = w.time - t0
  } })
  check('matriarch 边走边施法：出场 1.5 秒吐第一轮酸（人还在半路），3.5 秒产第一窝卵', near(acidT, def.acid.first + def.cast * 0.5, 0.06) && acidZ < def.holdZ - 5 && near(layT, def.eggs.first + def.cast * 0.5, 0.6) && near(w.boss.z, def.holdZ, 0.01), `吐酸 @${acidT.toFixed(2)}s（z=${acidZ.toFixed(1)}）  产卵 @${layT.toFixed(2)}s  7 秒后 z=${w.boss.z.toFixed(1)}`)

  // 重型门带护卫：一台重型 + 6 名突击兵（和自行炮门一样），不然「质量」这条路一台换十个步兵守不住
  // 期望变更（第 1 轮测试）：护卫 4 → 6。理由：门提前、步兵门加量之后，heavy2 路线损失比堆步兵多 6 个人（门槛是 +5），终局少十几个步兵
  const g = createWorld({ seed: 1 })
  spawnGate(g, 5)
  const opt = [g.gates.left, g.gates.right].find(o => o.type === 'unit' && UNITS[o.unit].cls === 'heavy')
  const before = g.squad.units.length
  let ev = null
  // 期望变更（第 4 轮测试）：跑 2.3 秒 → 门在路上的时长 + 0.3 秒。理由：门放慢到约 3.75 秒才结算（data/gates.js GATE.speed 10.7 → 5.7）
  run(g, GATE_TRAVEL + 0.3, { input: { moveX: null, targetX: g.gates && g.gates.left === opt ? -1.3 : 1.3, powers: [], aim: null, pick: null }, on: e => { if (e.type === 'gateResolve' && e.index === 5) ev = e } })
  check('重型门：1 台重型 + 6 名突击兵护卫', HEAVY_ESCORT === 6 && !!opt && opt.count === 1 && opt.extra && opt.extra.unit === 'rifle' && opt.extra.count === 6 && opt.titleKey === 'gate.unit_escort' && opt.params.extraCount === 6 && !!ev && ev.granted === 7 && g.squad.units.length === before + 7 && g.squad.counts[opt.unit] === 1,
    opt ? `${opt.unit} ×${opt.count} + rifle ×${opt.extra && opt.extra.count}  实得 ${ev && ev.granted} 人` : '没有重型选项')
}

// ============================================================ 阵型不穿模（第 1 轮测试新增）
// 测试：重型炮车插在步兵方阵里穿模。炮兵 / 重型排在方阵后方的专属横排，起点随步兵纵深后退；走到桥边时整排往里收，不在桥边叠成一摞
{
  const worst = []
  for (const [inf, art, hv] of [[60, 4, 3], [12, 1, 1], [96, 9, 8]]) {
    const w = sandbox(7)
    w.squad.caps.infantry = 96; w.squad.caps.artillery = 9; w.squad.caps.heavy = 10
    addU(w, 'rifle', inf, 'test'); addU(w, 'mortar', art, 'test')
    for (let k = 0; k < hv; k++) addU(w, ['titan', 'lancer', 'reaper', 'psion', 'skyhook'][k % 5], 1, 'test', null, true)
    for (const x of [0, 4.3, -4.3]) {
      for (let k = 0; k < 240; k++) w.step({ targetX: x })
      const us = w.squad.units.filter(u => u.alive)
      let m = 9
      for (let a = 0; a < us.length; a++) for (let b = a + 1; b < us.length; b++) {
        const big = us[a]._def.cls !== 'infantry' && us[a]._def.cls !== 'hero' || us[b]._def.cls !== 'infantry' && us[b]._def.cls !== 'hero'
        const d = Math.hypot(us[a].x - us[b].x, us[a].z - us[b].z) / (big ? 1.6 : 0.75)
        if (d < m) m = d
      }
      worst.push({ tag: `${inf}+${art}+${hv}@${x}`, m })
    }
  }
  const bad = worst.filter(o => o.m < 0.999)      // 后方横排行距正好 1.6 米：留一点浮点余量
  // 期望变更（第 3 轮测试）：步兵间距下限 0.85 → 0.75 米。理由：测试「参考兵挤得很密、颗颗分明，我方间距偏大」，
  // 阵型改成每排 15 人、列距 0.8 / 行距 0.78（原 12 人、0.94 / 0.92）：总宽 11.2 米（铺得更满），纵深浅一截。
  // 0.75 是「不穿模」的底线：渲染层的步兵模型肩宽要控制在 0.74 米以内（已写进交接）
  check('阵型：步兵之间 ≥ 0.75 米、车辆与任何单位 ≥ 1.6 米（满编 / 无尽满编 / 贴桥边）', bad.length === 0, worst.map(o => `${o.tag} ${o.m.toFixed(2)}`).join('  '))
}

// ============================================================ 门的公平（第 1 轮测试新增）
// 测试：「合同: 重锤自行炮」对「+1 突击兵」、「+1 泰坦」对「+8 突击兵」。同一道门两项的估值（sim/gates.js 的 optionValue）之比不低于 FAIR_RATIO；
// 唯一的例外是 5% 概率的「歌利亚」合同（估值 26，是有意的彩蛋）
{
  let n = 0, bad = [], worst = 1
  for (const bot of ['good', 'idle', 'heavy']) for (let seed = 1; seed <= 6; seed++) runHeadless({ seed, bot, onStep: w => {
    for (const e of w.events) {
      if (e.type !== 'gateSpawn' || w.phase !== 'campaign') continue
      if ([e.left, e.right].some(o => o.type === 'contract' && o.params.contract === 'goliath')) continue
      const a = optionValue(w, e.left), b = optionValue(w, e.right), r = Math.min(a, b) / Math.max(a, b)
      n++; if (r < worst) worst = r
      if (r < FAIR_RATIO) bad.push(`${bot} s${seed} 门${e.index} ${a.toFixed(1)} / ${b.toFixed(1)}`)
    }
  } })
  check(`门的公平：两项估值比 ≥ ${FAIR_RATIO}（歌利亚除外）`, n >= 200 && bad.length === 0, `${n} 道门  最差 ${worst.toFixed(2)}  ${bad.slice(0, 4).join(' | ')}`)
  // 满编时「+1 突击兵」对「合同 / 重型」这种：弱的一边被换掉，而不是照出
  const w = createWorld({ seed: 2 })
  addU(w, 'rifle', 58, 'test')
  spawnGate(w, 5)
  const g = w.gates, va = optionValue(w, g.left), vb = optionValue(w, g.right)
  check('门的公平：步兵差 1 个满编时，重型门对面不再是「+1 突击兵」', capRoom(w, 'rifle') === 1 && ![g.left, g.right].some(o => o.type === 'unit' && o.unit === 'rifle' && o.count === 1) && Math.min(va, vb) / Math.max(va, vb) >= FAIR_RATIO,
    `${g.left.type}:${g.left.unit || g.left.params.moduleId} ${va.toFixed(1)}  |  ${g.right.type}:${g.right.unit || g.right.params.moduleId} ${vb.toFixed(1)}`)
}

check('所有场景的事件：没有 NaN / 未登记类型', badEvent === null, badEvent ? `${badEvent.event.type}.${badEvent.field}` : '')

console.log(failed === 0 ? '\n全部通过.' : `\n${failed} 项未通过.`)
process.exitCode = failed === 0 ? 0 : 1
