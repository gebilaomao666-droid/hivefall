// 事件登记表。world.events 是普通数组，模拟层直接 push({type, ...})。
// 新增事件类型必须在这里登记（test-core 会校验），并同步 docs/ARCHITECTURE.md §2.2。
export const EVENT_TYPES = new Set([
  'shot', 'beam', 'explosion', 'flame', 'storm', 'chain',
  'enemyHit', 'enemyDie', 'enemyAttack', 'spit', 'burst', 'emerge', 'leak',
  'unitHit', 'unitDie', 'unitJoin', 'heal', 'shieldBreak',
  'gateSpawn', 'gateResolve', 'podLand', 'podOpen', 'podLost',
  'xp', 'levelUp', 'cardPicked', 'combo', 'heroic', 'overdrive',
  'powerReady', 'powerCast', 'strike',
  'herald', 'waveStart', 'flankWarn', 'bossSpawn', 'bossAttack', 'bossStun', 'bossHit', 'bossDie', 'bossPhase',
  'phase', 'layer', 'mutator',
  'bigHit', 'hitstop', 'shake', 'comms', 'win', 'lose',
  'zone', 'volley', 'hatch',
  // 第 3 步：指挥官 / 突变 / 合同
  'aimStart', 'aimEnd', 'summon', 'summonEnd', 'melee', 'aegis', 'revive', 'acidRain', 'acidHit',
  // 第 4 步：无尽 / 军衔 / 伙伴
  'retreat', 'rankUp', 'boon', 'ally', 'companion',
  // 布防系统（GDD §13）
  'devicePlace', 'deviceFire', 'deviceHit', 'deviceDie', 'deviceRemove', 'deviceUnlock', 'placeFail',
  'mineArm', 'mineBlast', 'novaBlast', 'energy', 'fence', 'fenceRefill',
])

// 返回第一个有问题的字段名（未登记的类型 / 非有限数值），没问题返回 null。
export function findBadEvent(e) {
  if (!e || !EVENT_TYPES.has(e.type)) return 'type'
  for (const k in e) {
    const v = e[k]
    if (typeof v === 'number' && !Number.isFinite(v)) return k
  }
  return null
}
