// 军械库（codex.html）：左边单位 / 指挥官 / 虫族 / Boss / 装置列表，中间 3D 检视（渲染层 view.inspect），右边数值与说明（直接读 src/data），
// 底部素材署名（各目录的 CREDITS.md 原文 + 一段摘要）。只读页面：不碰存档里的进度，只读语言设置。
import { createRenderer } from './render/renderer.js'
import { t, setLang, getLang } from './core/i18n.js'
import { loadSave, storeSave, SAVE_KEY } from './core/save.js'
import { UNITS, UNIT_KINDS } from './data/units.js'
import { ENEMIES, ENEMY_KINDS } from './data/enemies.js'
import { BOSSES } from './data/bosses.js'
import { DEVICES, DEVICE_KINDS } from './data/devices.js'
import { COMMANDERS, COMMANDER_IDS } from './data/commanders.js'
import { UNIT_ICON, ENEMY_ICON, BOSS_ICON, DEVICE_ICON, COMMANDER_ICON, POWER_ICON, PASSIVE_ICON } from './ui/icons.js'

const ICONS = new URL('../assets/ui/icons/', import.meta.url).href
const ASSETS = new URL('../assets/', import.meta.url).href
const $ = id => document.getElementById(id)
const Q = new URLSearchParams(location.search)

// ------------------------------------------------------------ 语言（跟游戏同一份存档设置）
let storage = null
try { storage = window.localStorage; storage.getItem(SAVE_KEY) } catch (e) { storage = null }
const save = loadSave(storage)
if (storage && storage.getItem(SAVE_KEY) === null) save.settings.lang = /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en'
if (Q.get('lang') === 'zh' || Q.get('lang') === 'en') save.settings.lang = Q.get('lang')
setLang(save.settings.lang)

// 军械库自己的文案（游戏里没有的：虫族 / Boss 的说明、数值栏名）
const TXT = {
  zh: {
    title: '军械库', back: '返回首页', 'tab.unit': '兵种', 'tab.cmd': '指挥官', 'tab.enemy': '虫族', 'tab.boss': 'Boss', 'tab.device': '装置',
    hp: '生命', dmg: '单发伤害', boss: '对 Boss', rate: '攻击间隔', range: '射程', dps: '理论输出', targets: '目标上限', vsLight: '克轻甲', vsHeavy: '克重甲',
    speed: '移速', armor: '护甲', leak: '漏过扣防线', xp: '经验', bite: '啃装置', cls: '体型', cost: '花费', cd: '卡牌冷却', powers: '技能', passives: '被动',
    endlessHp: '无尽基数', mech: '机制', stats: '数值', lore: '说明', clip: '动作', antiAir: '可对空', ignoreArmor: '无视护甲', cap: '同屏上限',
    'cls.infantry': '步兵', 'cls.artillery': '炮兵', 'cls.heavy': '重装', 'cls.hero': '指挥官', 'cls.light': '轻甲', 'cls.none': '无甲', 'cls.heavyE': '重甲',
    perSec: '/秒', sec: '秒', m: '米', note: '数值直接读自游戏数据（src/data），和实战一致；升级卡、联动、难度与无尽层数会在此基础上叠加。',
    credits: '素材署名', 'cr.more': '展开全部署名', 'cr.less': '收起',
    'clip.idle': '待机', 'clip.shoot': '开火', 'clip.walk': '行进', 'clip.die': '阵亡', 'clip.attack': '攻击', 'clip.fire': '开火', 'clip.hit': '受击', 'clip.windup': '蓄力', 'clip.charge': '冲锋', 'clip.stun': '眩晕', 'clip.spit': '吐酸', 'clip.lay': '产卵', 'clip.emerge': '破土', 'clip.burrow': '潜地', 'clip.fly': '飞行', 'clip.hatch': '孵化', 'clip.aim': '瞄准',
    loading: '加载模型…',
  },
  en: {
    title: 'Codex', back: 'Back to menu', 'tab.unit': 'Units', 'tab.cmd': 'Commanders', 'tab.enemy': 'Swarm', 'tab.boss': 'Bosses', 'tab.device': 'Devices',
    hp: 'HP', dmg: 'Damage', boss: 'vs Boss', rate: 'Interval', range: 'Range', dps: 'Paper DPS', targets: 'Max targets', vsLight: 'vs light', vsHeavy: 'vs heavy',
    speed: 'Speed', armor: 'Armor', leak: 'Line damage', xp: 'XP', bite: 'Bite (devices)', cls: 'Class', cost: 'Cost', cd: 'Card cooldown', powers: 'Powers', passives: 'Passives',
    endlessHp: 'Endless base HP', mech: 'Mechanics', stats: 'Stats', lore: 'About', clip: 'Clip', antiAir: 'Hits air', ignoreArmor: 'Ignores armor', cap: 'On-screen cap',
    'cls.infantry': 'Infantry', 'cls.artillery': 'Artillery', 'cls.heavy': 'Heavy', 'cls.hero': 'Commander', 'cls.light': 'Light', 'cls.none': 'Unarmored', 'cls.heavyE': 'Heavy',
    perSec: '/s', sec: 's', m: 'm', note: 'Numbers are read straight from the game data (src/data). Upgrade cards, combos, difficulty and endless depth stack on top.',
    credits: 'Credits', 'cr.more': 'Show all credits', 'cr.less': 'Collapse',
    'clip.idle': 'Idle', 'clip.shoot': 'Fire', 'clip.walk': 'Walk', 'clip.die': 'Down', 'clip.attack': 'Attack', 'clip.fire': 'Fire', 'clip.hit': 'Hit', 'clip.windup': 'Wind-up', 'clip.charge': 'Charge', 'clip.stun': 'Stunned', 'clip.spit': 'Spit', 'clip.lay': 'Lay eggs', 'clip.emerge': 'Emerge', 'clip.burrow': 'Burrow', 'clip.fly': 'Fly', 'clip.hatch': 'Hatch', 'clip.aim': 'Aim',
    loading: 'Loading model…',
  },
}
const ENEMY_DESC = {
  zh: {
    ling: '成千上万地涌上来. 一只不值一颗雷, 一千只能把防线啃穿.', burster: '冲进人堆里自爆, 对装置伤害 ×10. 远处打掉.',
    spitter: '站在射程边上吐刺, 会横移躲子弹.', crusher: '分片重甲, 脱离战斗会慢慢回血. 迫击炮和重装的活.',
    hulk: '骨拳肉盾, 一拳两个人. 血厚到要集火.', wing: '飞过前排俯冲后排. 只有能对空的武器打得到它.',
    digger: '钻地潜行, 在队伍身边破土而出 (地面先亮预警圈). 装置挡不住它.', warden: '给身边 4 米的虫减伤 40%. 看见就先打它.',
    egg: '巢母产下的卵, 几秒后孵出一窝裂爪虫. 提前打碎.', pod: '己方的补给空投舱. 被虫围住会丢.',
    shieldbug: '骨质盾板挡住正面直射子弹. 用火焰, 炮击, 或者从侧面打.', leaper: '遇到第一个装置会跳过去. 路障后面要留人.',
  },
  en: {
    ling: 'They come by the thousand. One is not worth a mine; a thousand chew through the line.', burster: 'Runs into the squad and pops. ×10 damage to devices. Kill it early.',
    spitter: 'Stands at the edge of its range and spits. Strafes to dodge fire.', crusher: 'Plated heavy armor; regenerates out of combat. A job for mortars and heavies.',
    hulk: 'Bone-fisted meat shield; each swing hits two troopers. Focus it down.', wing: 'Flies over the front rank and dives the back. Only anti-air weapons reach it.',
    digger: 'Burrows and erupts next to the squad (a warning ring shows first). Devices do not stop it.', warden: 'Bugs within 4 m take 40% less damage. Kill it first.',
    egg: 'Laid by the Matriarch; hatches a brood of Ripclaws in a few seconds. Pop it early.', pod: 'Friendly supply drop pod. Lost if the swarm overruns it.',
    shieldbug: 'A bone shield blocks frontal direct fire. Use flame, shells, or hit it from the side.', leaper: 'Jumps over the first device it meets. Keep guns behind your barricades.',
  },
}
const BOSS_DESC = {
  zh: {
    ravager: '战役 Boss. 走到阵前横扫; 每隔几秒地面亮起红色预警带然后冲锋——躲开它就一头撞上路障, 眩晕 2 秒, 受伤 +50%.',
    matriarch: '停在远端不上前. 吐酸 (落点预警圈, 留下酸池), 定时产卵——卵可以提前打掉.',
    leviathan: '潜在桥下, 在队伍脚下破土 (预警圈). 出土后弱点暴露几秒, 其间还会吐一排刺.',
  },
  en: {
    ravager: 'Campaign boss. Sweeps the front rank; every few seconds a red lane lights up and it charges. Dodge it and it slams into your barricades, stunned for 2 s and taking +50% damage.',
    matriarch: 'Stays at the far end. Spits acid (target rings, lingering pools) and lays eggs on a timer. Pop the eggs before they hatch.',
    leviathan: 'Hides under the bridge and erupts beneath the squad (warning ring). Its weak spot is exposed for a few seconds after it surfaces; it also spits a lane of spines.',
  },
}
const L = () => (getLang() === 'en' ? 'en' : 'zh')
const tx = k => TXT[L()][k] || TXT.zh[k] || k
const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : +v.toFixed(d) + '')

// ------------------------------------------------------------ DOM 小工具
function h(tag, cls, ...kids) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  for (const k of kids.flat()) if (k != null && k !== false) el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)))
  return el
}
function ic(name) { const i = h('i', 'ic'); i.style.setProperty('--i', `url("${ICONS}${name}.svg")`); return i }
for (const el of document.querySelectorAll('[data-ic]')) el.style.setProperty('--i', `url("${ICONS}${el.dataset.ic}.svg")`)

// ------------------------------------------------------------ 条目
const CATS = ['unit', 'cmd', 'enemy', 'boss', 'device']
const ENTRIES = {
  unit: UNIT_KINDS.map(k => ({ id: k, model: 'unit.' + k, icon: UNIT_ICON[k], name: () => t(UNITS[k].nameKey), sub: () => tx('cls.' + UNITS[k].cls) })),
  cmd: COMMANDER_IDS.map(id => { const c = COMMANDERS[id]; return { id, model: 'unit.' + c.hero, icon: COMMANDER_ICON[id], name: () => t(c.nameKey), sub: () => t(c.titleKey) } }),
  enemy: ENEMY_KINDS.filter(k => ENEMIES[k].implemented !== false).map(k => ({ id: k, model: k === 'pod' ? 'prop.pod' : 'enemy.' + k, icon: ENEMY_ICON[k], name: () => t(ENEMIES[k].nameKey), sub: () => tx('cls.' + (ENEMIES[k].cls === 'heavy' ? 'heavyE' : ENEMIES[k].cls)) })),
  boss: Object.keys(BOSSES).map(k => ({ id: k, model: 'boss.' + k, icon: BOSS_ICON[k], name: () => t(BOSSES[k].nameKey), sub: () => 'HP ' + BOSSES[k].hp.toLocaleString() })),
  device: DEVICE_KINDS.map(k => ({ id: k, model: 'device.' + k, icon: DEVICE_ICON[k], name: () => t(DEVICES[k].nameKey), sub: () => tx('cost') + ' ' + DEVICES[k].cost })),
}
let cat = CATS.includes(Q.get('tab')) ? Q.get('tab') : 'unit', cur = null, clip = null

function stat(k, v, unit) { return h('div', 'st', h('div', 'st-k', tx(k)), h('div', 'st-v', v, unit ? h('small', '', unit) : null)) }
function weaponStats(u) {
  const w = u.weapon || {}, out = [stat('hp', num(u.hp, 0))]
  const shots = (w.shells || w.drones || 1) * (w.ticks || 1)
  out.push(stat('dmg', num(w.dmg) + (shots > 1 ? ` ×${shots}` : '')), stat('boss', num(w.bossDmg)), stat('rate', num(w.interval, 2), tx('sec')))
  if (w.range) out.push(stat('range', num(w.range, 1), tx('m')))
  if (w.interval > 0) out.push(stat('dps', num(w.dmg * shots / w.interval, 1), tx('perSec')))
  if (w.maxTargets) out.push(stat('targets', num(w.maxTargets, 0)))
  if (w.vsLight) out.push(stat('vsLight', (w.vsLight > 0 ? '+' : '') + Math.round(w.vsLight * 100) + '%'))
  if (w.vsHeavy) out.push(stat('vsHeavy', (w.vsHeavy > 0 ? '+' : '') + Math.round(w.vsHeavy * 100) + '%'))
  return out
}
function unitTags(u) {
  const out = (u.tags || []).map(tg => { const s = t('tag.' + tg); return s === 'tag.' + tg ? null : h('span', 'tg', s) })
  if (u.antiAir && !(u.tags || []).includes('anti_air')) out.push(h('span', 'tg', tx('antiAir')))
  if (u.weapon && u.weapon.ignoreArmor) out.push(h('span', 'tg', tx('ignoreArmor')))
  return out.filter(Boolean)
}

function renderInfo(e) {
  const box = $('info'); box.textContent = ''
  const eb = h('div', 'eb', ({ unit: 'UNIT', cmd: 'COMMANDER', enemy: 'HIVE / SWARM', boss: 'HIVE / APEX', device: 'DEVICE' })[cat] + ' // ' + e.id.toUpperCase())
  box.append(eb, h('div', 'nm', e.name()))
  if (cat === 'unit') {
    const u = UNITS[e.id]
    box.append(h('div', 'ti', tx('cls.' + u.cls)), h('p', 'ds', t(u.descKey)), h('div', 'tags', unitTags(u)), h('div', 'sec', tx('stats')), h('div', 'stats', weaponStats(u)))
  } else if (cat === 'cmd') {
    const c = COMMANDERS[e.id], u = UNITS[c.hero]
    box.append(h('div', 'ti', t(c.titleKey)), h('p', 'ds', t(c.descKey)), h('div', 'tags', unitTags(u)))
    box.append(h('div', 'sec', t(u.nameKey)), h('div', 'stats', weaponStats(u)))
    box.append(h('div', 'sec', tx('powers')), ...c.powers.map(p => h('div', 'pw', ic(POWER_ICON[p] || 'lightning_storm'), h('div', '', h('div', 'pw-n', t(`power.${p}.name`)), h('div', 'pw-d', t(`power.${p}.desc`))))))
    if (c.passives.length) box.append(h('div', 'sec', tx('passives')), ...c.passives.map(p => h('div', 'pw', ic(PASSIVE_ICON[p] || 'gears'), h('div', '', h('div', 'pw-n', t(`passive.${p}.name`)), h('div', 'pw-d', t(`passive.${p}.desc`))))))
  } else if (cat === 'enemy') {
    const d = ENEMIES[e.id], sp = Array.isArray(d.speed) ? (d.speed[0] === d.speed[1] ? num(d.speed[0]) : `${num(d.speed[0])}~${num(d.speed[1])}`) : num(d.speed)
    const tags = []
    if (d.big) tags.push(h('span', 'tg warn', getLang() === 'en' ? 'Large' : '大个头'))
    if (d.behavior === 'flyer') tags.push(h('span', 'tg warn', getLang() === 'en' ? 'Flying' : '飞行'))
    if (d.leaps) tags.push(h('span', 'tg warn', getLang() === 'en' ? 'Jumps devices' : '跳过装置'))
    box.append(h('div', 'ti', e.sub()), h('p', 'ds', ENEMY_DESC[L()][e.id] || ''), h('div', 'tags', tags), h('div', 'sec', tx('stats')),
      h('div', 'stats', stat('hp', num(d.hp, 1)), stat('speed', sp), stat('armor', num(d.armor || 0, 1)), stat('leak', num(d.leak, 0)), stat('xp', num(d.xp, 0)),
        d.bite ? stat('bite', num(d.bite, 0)) : null, d.attack && d.attack.dmg ? stat('dmg', num(d.attack.dmg, 1)) : null, d.cap ? stat('cap', num(d.cap, 0)) : null))
  } else if (cat === 'boss') {
    const b = BOSSES[e.id]
    box.append(h('div', 'ti', tx('cls.heavyE')), h('p', 'ds', BOSS_DESC[L()][e.id] || ''), h('div', 'sec', tx('stats')),
      h('div', 'stats', stat('hp', b.hp.toLocaleString()), stat('endlessHp', b.endlessHp.toLocaleString()), stat('armor', num(b.armor, 1)), b.speed ? stat('speed', num(b.speed, 1)) : null))
  } else {
    const d = DEVICES[e.id], rows = [stat('cost', d.cost), stat('cd', d.cd, tx('sec'))]
    if (d.hp) rows.push(stat('hp', d.hp)); if (d.armor) rows.push(stat('armor', d.armor))
    if (d.dmg) rows.push(stat('dmg', d.dmg), stat('boss', d.bossDmg))
    if (d.interval) rows.push(stat('rate', d.interval, tx('sec')))
    if (d.maxTargets) rows.push(stat('targets', d.maxTargets))
    if (d.amount) rows.push(stat(getLang() === 'en' ? 'Yield' : '产出', `+${d.amount}`, ` / ${d.every}${tx('sec')}`))
    box.append(h('div', 'ti', e.sub()), h('p', 'ds', t(d.descKey)), h('div', 'sec', tx('stats')), h('div', 'stats', rows))
  }
  box.append(h('p', 'note', tx('note')))
}

// ------------------------------------------------------------ 列表
function renderTabs() {
  const tabs = $('tabs'); tabs.textContent = ''
  for (const c of CATS) { const b = h('button', 'tab' + (c === cat ? ' on' : ''), tx('tab.' + c)); b.onclick = () => { cat = c; renderTabs(); renderList(); pick(ENTRIES[c][0]) }; tabs.appendChild(b) }
}
function renderList() {
  const list = $('list'); list.textContent = ''
  for (const e of ENTRIES[cat]) {
    const b = h('button', 'it ' + cat + (cur === e ? ' on' : ''), ic(e.icon || 'gears'), h('div', '', h('div', 'it-n', e.name()), h('div', 'it-s', e.sub())))
    b.onclick = () => pick(e); list.appendChild(b)
  }
}
function relabel() {
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN'
  document.title = 'HIVEFALL · ' + tx('title')
  $('hd-t').textContent = tx('title'); $('back-t').textContent = tx('back'); $('loading').textContent = tx('loading')
  $('lang-zh').classList.toggle('on', getLang() !== 'en'); $('lang-en').classList.toggle('on', getLang() === 'en')
  renderTabs(); renderList(); if (cur) { renderInfo(cur); renderStageName() }
  renderCredits()
}
for (const [id, l] of [['lang-zh', 'zh'], ['lang-en', 'en']]) $(id).onclick = () => { setLang(l); save.settings.lang = getLang(); if (storage) try { storeSave(storage, save) } catch (e) {} relabel() }

// ------------------------------------------------------------ 3D 检视
let view = null, token = 0
function renderStageName() {
  $('stage-tag').textContent = cur ? cur.model.toUpperCase() : ''
  const sn = $('stage-name'); sn.textContent = ''
  if (cur) sn.append(h('b', '', cur.name()), h('span', '', cur.sub()))
}
async function pick(e) {
  cur = e; clip = null
  renderList(); renderInfo(e); renderStageName()
  history.replaceState(null, '', `?tab=${cat}&id=${e.id}`)
  if (view) await showModel()
}
async function showModel() {
  const my = ++token
  $('loading').hidden = false
  let info = null
  try {
    info = await view.inspect(cur.model, { clips: clip ? [clip] : [defaultClip(cur)], at: [0, 8], pitch: cat === 'device' ? 0.5 : 0.3, spin: 0.3, angle: cat === 'enemy' || cat === 'boss' ? 0.6 : 2.55 })   // 从正前方偏一点看：我方面朝 -z（虫潮来的方向），虫族面朝 +z
  } catch (err) { console.warn('[codex] inspect', err) }
  if (my !== token) return
  $('loading').hidden = true
  // 动作按钮
  const box = $('clips'); box.textContent = ''
  const all = info ? listClips(cur.model) : []
  for (const c of all) { const b = h('button', 'btn' + ((clip || defaultClip(cur)) === c ? ' on' : ''), tx('clip.' + c) === 'clip.' + c ? c : tx('clip.' + c)); b.onclick = () => { clip = c; showModel() }; box.appendChild(b) }
}
const CLIP_ORDER = ['idle', 'shoot', 'fire', 'attack', 'walk', 'hit', 'die']
function listClips(model) {
  const b = view && view.debug.assets.getBaked(model)
  const clips = b && b.asset && b.asset.clips
  const names = clips ? Object.keys(clips) : []
  return names.sort((a, c) => (CLIP_ORDER.indexOf(a) + 99) % 99 - (CLIP_ORDER.indexOf(c) + 99) % 99)
}
function defaultClip(e) { return cat === 'unit' || cat === 'cmd' ? 'shoot' : cat === 'device' ? 'idle' : 'walk' }

// ------------------------------------------------------------ 署名
const CREDIT_FILES = ['ui', 'models/ai', 'models/aliens', 'models/humans', 'models/vehicles', 'models/env', 'env', 'audio']
const creditText = new Map()
let creditsOpen = false
function md(src) {
  // 极简 Markdown：标题 / 列表 / 表格 / 链接 / 粗体 / 行内代码；够 CREDITS.md 用
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)<|]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
  const out = [], lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^#{1,4}\s/.test(l)) out.push(`<h3>${inline(l.replace(/^#+\s*/, ''))}</h3>`)
    else if (/^\s*\|/.test(l)) {
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i]); i++ }
      i--
      out.push('<table>' + rows.map((r, k) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => (k === 0 ? `<th>${inline(c.trim())}</th>` : `<td>${inline(c.trim())}</td>`)).join('') + '</tr>').join('') + '</table>')
    } else if (/^\s*[-*]\s/.test(l)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s/, ''))}</li>`); i++ }
      i--
      out.push('<ul>' + items.join('') + '</ul>')
    } else if (l.trim()) out.push(`<p>${inline(l)}</p>`)
  }
  return out.join('')
}
function renderCredits() {
  const f = $('credits'); f.textContent = ''
  f.classList.toggle('fold', !creditsOpen)
  const tog = h('button', 'btn', creditsOpen ? tx('cr.less') : tx('cr.more')); tog.onclick = () => { creditsOpen = !creditsOpen; renderCredits() }
  f.append(h('div', 'cr-head', h('b', '', 'CREDITS // ' + tx('credits')), h('div', 'sp'), tog))
  const zh = getLang() !== 'en'
  const sum = h('div', 'cr-sum')
  const P = (a, b) => { const p = h('p'); p.innerHTML = a; if (b) p.title = b; return p }
  sum.append(
    P(zh ? '<strong>图标</strong>：Icons by Lorc, Delapouite &amp; contributors — <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a>，<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>（去掉了黑底方块，改为白色字形）。'
      : '<strong>Icons</strong>: by Lorc, Delapouite &amp; contributors — <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a>, <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a> (black background removed, glyphs recolored white).'),
    P(zh ? '<strong>AI 生成模型</strong>：虫族、Boss 与部分我方单位由 <a href="https://3d.hunyuan.tencent.com/" target="_blank" rel="noopener">腾讯混元 3D</a>「文生3D」生成，再经本项目脚本简化与重新上色；提示词只描述原创造型，未引用任何现有作品。'
      : '<strong>AI-generated models</strong>: swarm, bosses and some of our units were generated with <a href="https://3d.hunyuan.tencent.com/" target="_blank" rel="noopener">Tencent Hunyuan3D</a> (text-to-3D), then decimated and recolored by this project\'s scripts. Prompts describe original designs only.'),
    P(zh ? '<strong>其它模型</strong>：Quaternius、Kay Lousberg、Kenney 等（CC0），以及 Poly by Google、Aaron Clifford 等（CC BY 3.0，见下方逐条署名），经 Poly Pizza 获取。'
      : '<strong>Other models</strong>: Quaternius, Kay Lousberg, Kenney and others (CC0), plus Poly by Google, Aaron Clifford and others (CC BY 3.0, itemised below), via Poly Pizza.'),
    P(zh ? '<strong>字体</strong>：Orbitron、Oxanium、Rajdhani、Chakra Petch、Share Tech Mono、站酷庆科黄油体、Noto Sans SC（SIL OFL 1.1）。<strong>音效 / 音乐 / 贴图 / HDRI</strong>：OpenGameArt、Kenney、Poly Haven 等（CC0）。'
      : '<strong>Fonts</strong>: Orbitron, Oxanium, Rajdhani, Chakra Petch, Share Tech Mono, ZCOOL QingKe HuangYou, Noto Sans SC (SIL OFL 1.1). <strong>Audio / textures / HDRI</strong>: OpenGameArt, Kenney, Poly Haven and others (CC0).'),
  )
  f.appendChild(sum)
  for (const k of CREDIT_FILES) {
    const d = h('details'), s = h('summary', '', `assets/${k}/CREDITS.md`), body = h('div', 'md')
    d.append(s, body)
    d.addEventListener('toggle', async () => {
      if (!d.open || body.dataset.done) return
      body.dataset.done = '1'
      try {
        if (!creditText.has(k)) { const r = await fetch(`${ASSETS}${k}/CREDITS.md`); creditText.set(k, r.ok ? await r.text() : '（读取失败）') }
        body.innerHTML = md(creditText.get(k))
      } catch (err) { body.textContent = String(err) }
    })
    f.appendChild(d)
  }
}

// ------------------------------------------------------------ 启动
async function boot() {
  const id = Q.get('id')
  cur = ENTRIES[cat].find(e => e.id === id) || ENTRIES[cat][0]
  relabel(); renderInfo(cur); renderStageName()
  try {
    view = await createRenderer({ canvas: $('c'), quality: save.settings.quality === 'low' ? 'low' : 'mid', theme: 'ash' })
    view.setTranslator(t)
    view.setWorld(null)
    window.__codex = { view, get cur() { return cur } }
    let last = performance.now()
    const frame = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; view.render(1, dt); requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    await showModel()
  } catch (err) {
    console.error(err)
    $('loading').textContent = 'WebGL: ' + (err && err.message || err)
  }
}
boot()
