// 存档的纯逻辑：结构、默认值、合并、本机榜、结算入账、伙伴培养。
// 不碰 localStorage / 时钟：读写由调用方注入 storage（只要有 getItem / setItem），时间戳由调用方给。
// 这样 Node 里能直接测，浏览器里传 window.localStorage 即可：
//   const save = loadSave(localStorage); const out = applyResult(save, world.result(), { now: Date.now() }); storeSave(localStorage, save)
import { achievementsFor } from '../data/achievements.js'
import { UNLOCK_IDS } from '../data/unlocks.js'
import { COMPANION, growthCost } from '../data/companion.js'

export const SAVE_KEY = 'hivefall.save'
export const SAVE_VERSION = 1
export const BOARD_SIZE = 10
export const NAME_MAX = 10

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    settings: {
      lang: 'zh', quality: 'high', qualityAuto: false,   // qualityAuto：当前画质是自动降下来的（下次启动回到高画质重新判断）
      volume: { master: 0.8, music: 0.6, weapons: 0.8, swarm: 0.8, voice: 0.9, ui: 0.7 },
      muted: false,
    },
    profile: { name: '' },
    best: { score: 0, layer: 0, campaignSeconds: null },
    board: [],                 // 本机榜前 10：{ name, score, layer, seconds, commander, mutators, difficulty, daily, at }
    unlocks: [],               // data/unlocks.js 的 id
    achievements: {},          // id -> 获得时间戳（调用方给的 now）
    stats: { runs: 0, wins: 0, kills: 0, losses: 0, seconds: 0, bestLayer: 0, bossKills: 0, winsBy: {}, dailyDays: 0 },
    daily: { lastKey: null, best: {} },   // best[dateKey] = { score, layer }，只留最近 14 天
    companion: { unlocked: false, name: '', points: 0, spent: 0, growth: 0, bestStage: 0 },
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// 以默认值为骨架合并读到的存档：缺的字段补默认，类型不对的丢掉，多出来的未知字段保留（新版本回退到旧版本时不丢数据）
function merge(base, loaded) {
  if (!isObj(loaded)) return base
  for (const k of Object.keys(loaded)) {
    const b = base[k], v = loaded[k]
    if (!(k in base)) base[k] = v
    else if (isObj(b)) base[k] = merge(b, v)
    else if (Array.isArray(b)) { if (Array.isArray(v)) base[k] = v }
    else if (b === null || typeof b === typeof v || v === null) base[k] = v
  }
  return base
}

export function mergeSave(loaded) {
  const save = merge(defaultSave(), loaded)
  save.version = SAVE_VERSION
  save.board = rankBoard(save.board.filter(e => isObj(e) && Number.isFinite(e.score)))
  save.unlocks = save.unlocks.filter(id => typeof id === 'string')
  return save
}

// storage 坏了 / 内容不是 JSON / 没有存档：都退回默认值，不抛错
export function loadSave(storage) {
  try {
    const raw = storage ? storage.getItem(SAVE_KEY) : null
    return mergeSave(raw ? JSON.parse(raw) : null)
  } catch (err) {
    return defaultSave()
  }
}

export function storeSave(storage, save) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save))
    return true
  } catch (err) {
    return false     // 隐私模式 / 配额满：游戏照常进行，只是不落盘
  }
}

// 本机榜排序：分数高的在前；同分看层数；再同看用时短的；最后先到先得
export function compareEntries(a, b) {
  return (b.score - a.score) || ((b.layer || 0) - (a.layer || 0)) || ((a.seconds || 0) - (b.seconds || 0)) || ((a.at || 0) - (b.at || 0))
}

export function rankBoard(entries) {
  return entries.slice().sort(compareEntries).slice(0, BOARD_SIZE)
}

export const cleanName = name => Array.from(String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim()).slice(0, NAME_MAX).join('')

export function boardEntry(result, { name = '', now = 0 } = {}) {
  return {
    name: cleanName(name), score: result.score, layer: result.layer, seconds: result.seconds,
    commander: result.commander, mutators: result.mutators.slice(), difficulty: result.difficulty,
    daily: result.daily ? result.dateKey : null, at: now,
  }
}

// 把一局的结算记进存档（原地修改 save）。对局没结束（outcome === 'running'）什么都不做。
// 返回这一局带来的变化，给结算面板用：
//   { rank: 上榜名次（1 起，没上榜为 0）, entry, newBest, newUnlocks: [id], newAchievements: [id], companionPoints, companionUnlocked }
export function applyResult(save, result, { name = save.profile.name, now = 0 } = {}) {
  const out = { rank: 0, entry: null, newBest: false, newUnlocks: [], newAchievements: [], companionPoints: 0, companionUnlocked: false }
  if (!result || result.outcome === 'running') return out

  // 累计统计
  const s = save.stats
  s.runs++
  s.kills += result.kills
  s.losses += result.losses
  s.seconds += result.seconds
  s.bossKills += result.bossKills || 0
  if (result.layer > s.bestLayer) s.bestLayer = result.layer
  if (result.campaignWon) {
    s.wins++
    s.winsBy[result.commander] = (s.winsBy[result.commander] || 0) + 1
  }

  // 每日挑战：每个日期留最好的一次
  if (result.daily && result.dateKey) {
    const d = save.daily, prev = d.best[result.dateKey]
    if (!prev) s.dailyDays++
    if (!prev || result.score > prev.score) d.best[result.dateKey] = { score: result.score, layer: result.layer }
    d.lastKey = result.dateKey
    const keys = Object.keys(d.best).sort()
    while (keys.length > 14) delete d.best[keys.shift()]
  }

  // 最高纪录与本机榜
  // 战役里从暂停菜单主动放弃的局（loseReason 'abandon'）不刷最高分、不上本机榜：测试「开局 5 秒撤离、10 杀照样进了榜第 3」。
  // 累计统计照记（上面已经记过）。主循环 main.js 里也有同样的兜底，这里是规则本身
  const ranked = result.reason !== 'abandon'
  const best = save.best
  if (ranked && result.score > best.score) { best.score = result.score; out.newBest = true }
  if (result.layer > best.layer) best.layer = result.layer
  if (result.campaignWon && result.campaignSeconds !== null && (best.campaignSeconds === null || result.campaignSeconds < best.campaignSeconds)) best.campaignSeconds = result.campaignSeconds
  // 0 分的局（多半是开局就从暂停菜单「撤离并结算」放弃的）不上本机榜：否则榜上挂一排 0 杀 3 秒的记录
  if (ranked && result.score > 0) {
    const entry = boardEntry(result, { name, now })
    save.board = rankBoard(save.board.concat([entry]))
    out.rank = save.board.indexOf(entry) + 1
    out.entry = entry
  }

  // 解锁
  for (const id of result.unlocks || []) {
    if (UNLOCK_IDS.includes(id) && !save.unlocks.includes(id)) { save.unlocks.push(id); out.newUnlocks.push(id) }
  }

  // 伙伴
  const c = save.companion
  if (save.unlocks.includes('companion') && !c.unlocked) { c.unlocked = true; out.companionUnlocked = true }
  if (result.companion) {
    out.companionPoints = result.companion.points.total
    c.points += out.companionPoints
    if (result.companion.stage > c.bestStage) c.bestStage = result.companion.stage
  }

  // 成就（用并入这一局之后的累计统计判定）
  for (const id of achievementsFor(result, s)) {
    if (!(id in save.achievements)) { save.achievements[id] = now; out.newAchievements.push(id) }
  }
  return out
}

export const isUnlocked = (save, id) => save.unlocks.includes(id)

// ---- 伙伴的局外培养：培养点买成长速度 ----
export const companionNextCost = save => (save.companion.growth >= COMPANION.growthMax ? null : growthCost(save.companion.growth))

export function buyCompanionGrowth(save) {
  const c = save.companion, cost = companionNextCost(save)
  if (!c.unlocked || cost === null || c.points < cost) return false
  c.points -= cost
  c.spent += cost
  c.growth++
  return true
}

// 开局时传给 createWorld({ companion }) 的配置；没解锁或玩家没勾选就传 null
export function companionConfig(save, enabled = true) {
  const c = save.companion
  return c.unlocked && enabled ? { growth: c.growth, name: c.name } : null
}
