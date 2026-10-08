// 首页：左侧简报面板（手机上在下半屏），右侧留给 3D 战场预览。
// 选择（指挥官 / 突变 / 难度 / 草稿 / 伙伴）由 UI 自己记着，点「部署」时整个交给 callbacks.start。
import { h, icon, clear, setCls, button, portrait, fmtInt } from './dom.js'
import { COMMANDER_ICON, POWER_ICON, PASSIVE_ICON, MUTATOR_ICON, UNIT_ICON, DEVICE_ICON } from './icons.js'
import { COMMANDERS, POWERS } from '../data/commanders.js'
import { MUTATOR_IDS } from '../data/mutators.js'
import { ACHIEVEMENT_IDS } from '../data/achievements.js'
import { UNIT_KINDS } from '../data/units.js'
import { DEVICE_KINDS } from '../data/devices.js'

const CMD_IDS = ['none', 'hawk', 'ysera', 'joe']

// 只有图标的按钮：给读屏和悬停提示一个名字
const named = (el, label) => { el.setAttribute('aria-label', label); el.title = label; return el }

export function createMenu(ctx) {
  const { t, callbacks } = ctx
  const el = h('div', 'menu')
  const panel = h('div', 'menu-panel pn')
  const topbar = h('div', 'menu-top')
  el.append(topbar, panel, h('div', 'menu-foot'))
  const sel = { commander: 'none', mutators: [], difficulty: 'normal', draft: 'script', companion: false }
  let data = {}

  const has = id => !!(data.save && data.save.unlocks && data.save.unlocks.indexOf(id) >= 0)

  function start(extra) {
    if (!callbacks.start) return
    callbacks.start(Object.assign({ commander: sel.commander, mutators: sel.mutators.slice(), difficulty: sel.difficulty, draft: sel.draft, companion: sel.companion, daily: false }, extra || {}))
  }

  function build() {
    const save = data.save || {}, best = save.best || { score: 0, layer: 0 }, settings = ctx.settings()
    if (!has('commanders')) sel.commander = 'none'
    if (!has('mutators')) sel.mutators = []
    if (!has('veteran')) sel.difficulty = 'normal'
    if (!has('draft')) sel.draft = 'script'
    if (!has('companion')) sel.companion = false
    if (callbacks.menuSelect) callbacks.menuSelect({ commander: sel.commander, mutators: sel.mutators.slice(), difficulty: sel.difficulty, draft: sel.draft, companion: sel.companion })   // 测试：竖屏重载后首页选中的指挥官没保留 → 每次重绘把当前选择交给 main 存档

    // ---- 顶栏（右上小按钮）
    clear(topbar)
    const lang = ctx.lang()
    topbar.append(
      ...(callbacks.codex ? [button('sq pn', () => callbacks.codex(), icon('barracks'), h('span', 'sq-k', t('ui.menu.codex')))] : []),   // 军械库页还没做：宿主不给回调就不显示入口
      h('div', 'seg pn', ...['zh', 'en'].map(l => button('seg-b' + (lang === l ? ' on' : ''), () => ctx.changeLang(l), l === 'zh' ? '中' : 'EN'))),
      button('sq pn', () => { const q = ['high', 'mid', 'low']; settings.quality = q[(q.indexOf(settings.quality) + 1) % 3]; callbacks.setQuality && callbacks.setQuality(settings.quality); build() }, h('span', 'sq-k', t('ui.hud.quality')), h('b', 'sq-v', t('ui.q.' + settings.quality))),
      named(button('sq pn only-ic' + (settings.muted ? ' off' : ''), () => { settings.muted = !settings.muted; callbacks.setMuted && callbacks.setMuted(settings.muted); build() }, icon(settings.muted ? 'sound_off' : 'sound_on')), t('ui.settings.mute')),
      named(button('sq pn only-ic', () => ctx.open('settings'), icon('settings')), t('ui.settings.title')),
      named(button('sq pn cr-btn', () => ctx.open('credits'), icon('info'), h('span', 'sq-k', t('credits.title'))), t('credits.title')))

    clear(panel)
    // ---- 标题
    panel.append(h('div', 'menu-brand',
      h('div', 'brand-mark', h('i'), h('i'), h('i')),
      h('div', 'brand-txt', h('b', 'brand-name', 'HIVEFALL'), h('span', 'brand-sub', t('ui.brand.full')))))
    panel.append(h('div', 'menu-brief',
      h('div', 'eb', h('i', 'dot'), t('ui.menu.brief'), h('span', 'eb-r', 'OP-07 // SPINE BRIDGE')),
      h('h1', 'menu-title', t('ui.hud.bridge')),
      h('p', 'menu-text', t('ui.menu.brief.text'))))

    // ---- 指挥官
    const cmdUnlocked = has('commanders')
    const cmdRow = h('div', 'cmd-row')
    for (const id of CMD_IDS) {
      const locked = id !== 'none' && !cmdUnlocked
      const b = button('cmd pn' + (sel.commander === id ? ' on' : '') + (locked ? ' locked' : ''), () => { if (locked) return; sel.commander = id; build() },
        portrait(ctx.portraits, 'commander.' + id, COMMANDER_ICON[id], 'cmd-pt'),
        h('span', 'cmd-name', shortName(t(`commander.${id}.name`)), restName(t(`commander.${id}.name`)) ? h('small', 'cmd-real', restName(t(`commander.${id}.name`))) : null),
        locked ? icon('lock', 'cmd-lock') : h('i', 'cmd-led'))
      cmdRow.appendChild(b)
    }
    const c = COMMANDERS[sel.commander]
    const kit = h('div', 'cmd-kit')
    if (c) {
      for (const pid of c.powers) { const k = h('span', 'kit', icon(POWER_ICON[pid] || 'power'), h('kbd', '', POWERS[pid].key.toUpperCase())); ctx.tip(k, () => ({ title: t(`power.${pid}.name`), body: t(`power.${pid}.desc`), meta: POWERS[pid].key.toUpperCase() })); kit.appendChild(k) }
      for (const pid of c.passives) { const k = h('span', 'kit passive', icon(PASSIVE_ICON[pid] || 'shield_energy')); ctx.tip(k, () => ({ title: t(`passive.${pid}.name`), body: t(`passive.${pid}.desc`), meta: t('ui.menu.passive') })); kit.appendChild(k) }
    } else {
      for (const k of UNIT_KINDS) { const s = h('span', 'kit unit', icon(UNIT_ICON[k])); ctx.tip(s, () => ({ title: t(`unit.${k}.name`), body: t(`unit.${k}.desc`) })); kit.appendChild(s) }
    }
    panel.append(h('div', 'menu-sec',
      h('div', 'sec-h', t('ui.menu.commander'), !cmdUnlocked ? h('span', 'sec-note', icon('lock'), t('ui.menu.locked')) : null),
      cmdRow,
      h('div', 'cmd-info pn',
        portrait(ctx.portraits, 'commander.' + sel.commander, COMMANDER_ICON[sel.commander], 'cmd-info-pt'),
        h('div', 'cmd-info-body', h('div', 'cmd-title', h('b', '', t(`commander.${sel.commander}.name`)), h('span', '', t(`commander.${sel.commander}.title`))), h('div', 'cmd-desc', t(`commander.${sel.commander}.desc`)), kit))))

    // ---- 突变因子
    const mutUnlocked = has('mutators')
    const mutRow = h('div', 'mut-row')
    for (const id of MUTATOR_IDS) {
      const on = sel.mutators.indexOf(id) >= 0
      const b = button('mutb pn' + (on ? ' on' : '') + (mutUnlocked ? '' : ' locked'), () => {
        if (!mutUnlocked) return
        const i = sel.mutators.indexOf(id); if (i >= 0) sel.mutators.splice(i, 1); else sel.mutators.push(id); build()
      }, icon(MUTATOR_ICON[id]), h('span', '', t(`mutator.${id}.name`)))
      ctx.tip(b, () => ({ title: t(`mutator.${id}.name`), body: t(`mutator.${id}.desc`), meta: mutUnlocked ? '' : t('ui.menu.locked') }))
      mutRow.appendChild(b)
    }
    panel.append(h('div', 'menu-sec',
      h('div', 'sec-h', t('ui.menu.mutators'), h('span', 'sec-note', mutUnlocked ? (sel.mutators.length ? t('mutator.pending', { n: sel.mutators.length + 1 }) : t('ui.menu.mut_off')) : [icon('lock'), t('ui.menu.locked')])),
      mutRow))

    // ---- 难度 / 草稿 / 伙伴
    const seg = (key, opts, lockedId) => h('div', 'seg pn', ...opts.map(([v, label, lock]) => {
      const locked = lock && !has(lock)
      const b = button('seg-b' + (sel[key] === v ? ' on' : '') + (locked ? ' locked' : ''), () => { if (locked) return; sel[key] = v; build() }, locked ? icon('lock') : null, label)
      return b
    }))
    const opts = h('div', 'menu-opts',
      h('div', 'opt', h('span', 'opt-k', t('ui.menu.difficulty')), seg('difficulty', [['normal', t('difficulty.normal.name')], ['veteran', t('difficulty.veteran.name'), 'veteran']])),
      h('div', 'opt', h('span', 'opt-k', t('ui.menu.draft')), seg('draft', [['script', t('ui.menu.draft.script')], ['random', t('ui.menu.draft.random'), 'draft']])))
    if (has('companion')) {
      opts.appendChild(h('div', 'opt', h('span', 'opt-k', t('companion.name')), button('chk pn' + (sel.companion ? ' on' : ''), () => { sel.companion = !sel.companion; build() }, h('i', 'chk-box', icon('check')), t('companion.bring'))))
    }
    panel.append(h('div', 'menu-sec', opts, h('div', 'opt-note', t(`difficulty.${sel.difficulty}.desc`))))

    // ---- 部署
    panel.append(h('div', 'menu-go',
      button('cta', () => start(), h('span', 'cta-t', t('ui.menu.deploy')), h('kbd', '', 'Space')),
      h('div', 'keys', h('span', '', h('kbd', '', 'A'), h('kbd', '', 'D'), t('ui.menu.key.move')), h('span', '', h('kbd', '', '1'), '-', h('kbd', '', '8'), t('ui.menu.key.build')), h('span', '', h('kbd', '', 'Q'), h('kbd', '', 'W'), h('kbd', '', 'E'), h('kbd', '', 'R'), t('ui.menu.key.power')))))

    // ---- 纪录与入口
    const achGot = save.achievements ? Object.keys(save.achievements).length : 0
    const dailyOk = has('daily')
    panel.append(h('div', 'menu-rec',
      h('div', 'rec pn', h('span', 'rec-k', t('ui.menu.best')), h('b', 'rec-v', fmtInt(best.score || 0)), h('span', 'rec-s', best.layer ? t('endless.layer', { n: best.layer }) : best.score > 0 ? t('ui.menu.best.campaign') : t('ui.menu.best.none'))),
      h('div', 'rec-links',
        button('lnk pn', () => ctx.open('board'), icon('podium'), h('span', '', t('board.title'))),
        button('lnk pn', () => ctx.open('achievements'), icon('medal'), h('span', '', t('ach.title')), h('b', '', achGot + '/' + ACHIEVEMENT_IDS.length)),
        button('lnk pn' + (dailyOk ? ' hot' : ' locked'), () => { if (dailyOk) ctx.open('daily') }, icon(dailyOk ? 'stopwatch' : 'lock'), h('span', '', t('daily.title'))))))

    const foot = el.lastChild
    clear(foot)
    foot.append(h('span', '', t('ui.menu.foot')), h('span', 'ver', data.version || 'v0.1'))
  }

  // 卡片上大字是代号（铁砧），下面小字是本名（霍克上尉）——结算页、通讯里叫的是本名，两边要对得上号
  function restName(s) { const r = s.replace(/「.+?」|".+?"/, '').trim(); return r === s.trim() ? '' : r }
  function shortName(s) { const m = /「(.+?)」|"(.+?)"/.exec(s); return m ? (m[1] || m[2]) : s }

  return {
    el,
    show(d) { data = d || data; if (d && d.selection) Object.assign(sel, d.selection); build() },   // 上次的选择（存档里）只在进首页时套一次，之后以界面上的点选为准
    relabel() { build() },
    selection: () => sel,
    key(e) { if (e.key === ' ' || e.key === 'Enter') { start(); return true } return false },
    start,
  }
}
