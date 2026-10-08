// 部队面板（Tab）。打开时从 world 现读一遍；开着的时候游戏是暂停的，不需要逐帧刷新。
import { h, icon, clear, button, portrait, fmtInt, clamp01, mutEffect } from './dom.js'
import { unitIcon, moduleIcon, DEVICE_ICON, MUTATOR_ICON } from './icons.js'
import { roman } from './banners.js'
import { UNITS, ALL_KINDS } from '../data/units.js'
import { MODULES } from '../data/modules.js'
import { COMBOS, HEROIC_BY_UNIT } from '../data/combos.js'
import { rankFor } from '../data/ranks.js'
import { DEVICE_KINDS } from '../data/devices.js'

export function createSquadPanel(ctx) {
  const { t } = ctx
  const el = h('div', 'ov sqp')
  const panel = h('div', 'sqp-panel pn')
  el.appendChild(panel)
  el.hidden = true
  let world = null

  function modRow(ids, levels) {
    const row = h('div', 'sq-mods')
    for (const id of ids) {
      const m = MODULES[id], lv = levels[id] || 0
      const pips = h('span', 'mod-pips')
      const n = Math.min(m.max, 5)
      for (let k = 0; k < n; k++) pips.appendChild(h('i', k < lv ? 'on' : ''))
      const c = h('span', 'modi' + (lv > 0 ? ' on' : '') + (m.equip ? ' equip' : ''), icon(moduleIcon(id, m.unit)), h('span', 'modi-n', t(m.nameKey)), m.max > 5 ? h('b', '', lv > 0 ? 'x' + lv : '') : pips)
      ctx.tip(c, () => ({ title: t(m.nameKey) + (lv > 0 && m.max > 1 && m.max < 90 ? ' ' + roman(lv) : ''), body: t(m.descKey), meta: m.equip ? t('ui.lu.equip') : lv + ' / ' + (m.max > 90 ? '∞' : m.max) }))
      row.appendChild(c)
    }
    return row
  }

  function build() {
    clear(panel)
    const w = world, pr = w.progress, st = w.stats, sq = w.squad
    const alive = sq.units.reduce((n, u) => n + (u.alive ? 1 : 0), 0)
    const cal = pr.modules.gen_calibrate || 0
    const xpP = clamp01((pr.xp - pr.xpPrev) / Math.max(1, pr.xpNext - pr.xpPrev))
    const xpF = h('i', 'xp-f'); xpF.style.setProperty('--p', xpP.toFixed(4))
    panel.append(
      h('div', 'sqp-head',
        h('div', '', h('div', 'eb', h('i', 'dot'), 'SQUAD STATUS'), h('h1', 'ov-title', t('ui.squad.title'))),
        button('sq pn', () => ctx.close(), icon('cancel'), h('kbd', '', 'Tab'))),
      h('div', 'xpbar in-panel', h('b', 'xp-lv', t('ui.hud.level', { n: pr.level })), h('div', 'xp-track', xpF), h('span', 'xp-txt', t('ui.hud.xp', { xp: fmtInt(pr.xp), next: fmtInt(pr.xpNext) }))),
      h('div', 'sqp-sum',
        ...[[t('ui.squad.alive'), alive], [t('ui.squad.kills'), fmtInt(st.kills)], [t('module.gen_calibrate.name'), (cal ? roman(cal) : '0') + ' / III'], [t('ui.hud.firepower'), 'x' + (w.dmgMul || 1).toFixed(2)], [t('ui.hud.losses'), st.losses], [t('hud.energy'), fmtInt(Math.floor(w.energy || 0))]]
          .map(([k, v]) => h('div', 'sum-c pn', h('span', 'big-k', k), h('b', '', String(v))))))

    const body = h('div', 'sqp-body')
    // ---- 兵种
    const grid = h('div', 'sqp-grid')
    for (const kind of ALL_KINDS) {
      const n = sq.counts[kind] || 0, dep = (st.deployed && st.deployed[kind]) || 0
      if (n === 0 && dep === 0) continue
      let hp = 0, hpMax = 0
      for (const u of sq.units) if (u.kind === kind && u.alive) { hp += u.hp; hpMax += u.hpMax }
      const kills = (st.killsByUnit && st.killsByUnit[kind]) || 0
      const rk = rankFor(kills)
      const modsOf = UNITS[kind].mods || kind
      const ids = Object.keys(MODULES).filter(id => MODULES[id].unit === modsOf)
      const combos = pr.combos.filter(id => COMBOS[id] && COMBOS[id].units.indexOf(modsOf) >= 0)
      const heroic = HEROIC_BY_UNIT[modsOf] && pr.heroics.indexOf(HEROIC_BY_UNIT[modsOf].id) >= 0 ? HEROIC_BY_UNIT[modsOf] : null
      const hpF = h('i', 'bar-f'); hpF.style.setProperty('--p', (hpMax ? clamp01(hp / hpMax) : 0).toFixed(4))
      const rkF = h('i', 'bar-f'); rkF.style.setProperty('--p', (rk.next ? rk.progress : 1).toFixed(4))
      const tags = h('div', 'sq-tags')
      if (heroic) { const s = h('span', 'pill gold', icon('laurel'), h('span', '', t(heroic.nameKey))); ctx.tip(s, () => ({ title: t(heroic.nameKey), body: t(heroic.descKey), meta: t('ui.bn.heroic') })); tags.appendChild(s) }
      for (const id of combos) { const s = h('span', 'pill elite', icon('chain_lightning'), h('span', '', t(`combo.${id}.name`))); ctx.tip(s, () => ({ title: t(`combo.${id}.name`), body: t(`combo.${id}.desc`), meta: t('ui.bn.combo') })); tags.appendChild(s) }
      grid.appendChild(h('div', 'squ pn' + (n === 0 ? ' none' : ''),
        portrait(ctx.portraits, 'unit.' + kind, unitIcon(kind), 'squ-pt'),
        h('div', 'squ-body',
          h('div', 'squ-top', h('b', 'squ-name', t(`unit.${kind}.name`)), h('span', 'squ-n', 'x' + n), tags),
          h('div', 'squ-bars',
            h('div', 'squ-bar', h('span', 'big-k', 'HP'), h('div', 'bar gr thin', hpF), h('span', 'squ-v', hpMax ? Math.round(hp / hpMax * 100) + '%' : '-')),
            h('div', 'squ-bar', h('span', 'big-k rank', icon(rk.index >= 9 ? 'rank_3' : rk.index >= 5 ? 'rank_2' : 'rank_1'), t(rk.nameKey)), h('div', 'bar am thin', rkF), h('span', 'squ-v', fmtInt(kills)))),
          ids.length ? modRow(ids, pr.modules) : h('div', 'squ-desc', t(`unit.${kind}.desc`)))))
    }
    body.appendChild(h('section', '', h('div', 'sec-h', t('ui.squad.units'), h('span', 'sec-note', t('rank.title') + ' / ' + t('report.col.kills'))), grid))

    // ---- 通用牌
    const gen = Object.keys(MODULES).filter(id => MODULES[id].line === 'general' && (pr.modules[id] || 0) > 0)
    if (gen.length) body.appendChild(h('section', '', h('div', 'sec-h', t('ui.squad.general')), modRow(gen, pr.modules)))

    // ---- 装置
    const dgrid = h('div', 'sqp-dev')
    for (const kind of DEVICE_KINDS) {
      const card = w.cards && w.cards.find(c => c.kind === kind)
      const standing = w.devices ? w.devices.filter(d => d.kind === kind).length : 0
      const placed = st.devices ? st.devices.placed[kind] || 0 : 0
      const dmg = st.dmgByDevice ? st.dmgByDevice[kind] || 0 : 0
      dgrid.appendChild(h('div', 'sqd pn' + (card && !card.unlocked ? ' locked' : ''),
        icon(card && !card.unlocked ? 'lock' : DEVICE_ICON[kind]),
        h('div', '', h('b', '', t(`device.${kind}.name`)), h('span', '', card && !card.unlocked ? t('ui.dev.locked') : t('ui.squad.dev', { standing, placed, dmg: fmtInt(dmg) })))))
    }
    const devMods = Object.keys(MODULES).filter(id => MODULES[id].line === 'device' && !MODULES[id].unlock && (pr.modules[id] || 0) > 0)
    const fences = w.fences ? w.fences.filter(Boolean).length : 0
    body.appendChild(h('section', '', h('div', 'sec-h', t('ui.squad.devices'), h('span', 'sec-note', t('ui.squad.fences', { n: fences, total: w.fences ? w.fences.length : 5 }))), dgrid, devMods.length ? modRow(devMods, pr.modules) : null))

    // ---- 突变
    // 每个因子一行：名字 + 状态（已生效 / 第 N 次升级后生效）+ 具体效果——原来每个后面都挂同一句「突变因子已生效」，说不出它到底干了什么
    if (w.mutators && w.mutators.length) {
      const nActive = w.mutators.filter(m => m.active).length
      body.appendChild(h('section', '', h('div', 'sec-h', t('ui.menu.mutators'), h('span', 'sec-note', nActive === w.mutators.length ? t('ui.mut.all_on') : t('ui.mut.pending_n', { n: w.mutators.length + 1 }))),
        h('div', 'sqp-muts', ...w.mutators.map(m => h('div', 'news red mutrow' + (m.active ? ' on' : ' off'), icon(MUTATOR_ICON[m.id] || 'mutation'),
          h('div', '', h('b', '', t(m.nameKey), h('em', 'mut-st', t(m.active ? 'ui.mut.on' : 'ui.mut.pending'))), h('span', '', mutEffect(t, m.id))))))))
    }
    panel.appendChild(body)
  }

  return {
    el,
    show(w) { world = w; if (w) build(); el.hidden = !w; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in') },
    hide() { el.hidden = true },
    relabel() { if (world && !el.hidden) build() },
  }
}
