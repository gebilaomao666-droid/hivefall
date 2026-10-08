// 结算面板。数据全部来自 world.result()（加上 core/save.js 的 applyResult 返回值）。
// 桌面两栏：左栏结论 + 五大数字 + 按钮，右栏各张报告（可滚动）；手机单栏。
import { h, icon, clear, button, portrait, fmtInt, pctStr, tOr } from './dom.js'
import { unitIcon, moduleIcon, POWER_ICON, DEVICE_ICON, ACH_ICON } from './icons.js'

const fmtSec = s => (s >= 100 ? Math.round(s) : Math.round(s * 10) / 10) + 's'

export function boardTable(t, board, highlight) {
  const tb = h('div', 'board')
  tb.appendChild(h('div', 'board-r head', h('span', '', '#'), h('span', '', t('ui.board.name')), h('span', '', t('board.col.score')), h('span', '', t('board.col.layer')), h('span', '', t('board.col.time'))))
  if (!board || !board.length) { tb.appendChild(h('div', 'board-empty', t('board.empty'))); return tb }
  board.forEach((e, i) => {
    tb.appendChild(h('div', 'board-r' + (highlight === i + 1 ? ' me' : ''),
      h('span', 'n', String(i + 1)),
      h('span', 'who', icon(e.commander && e.commander !== 'none' ? 'commander' : 'squad'), e.name || t(`commander.${e.commander || 'none'}.name`)),
      h('b', '', fmtInt(e.score)), h('span', '', e.layer ? String(e.layer) : '-'), h('span', '', fmtSec(e.seconds || 0))))
  })
  return tb
}

export function createResult(ctx) {
  const { t, callbacks } = ctx
  const el = h('div', 'ov res')
  const panel = h('div', 'res-panel pn')
  el.appendChild(panel)
  el.hidden = true
  let data = null

  // unit：不是「伤害 / 占比」的行（采集器看产出的晶能、路障看替队伍挨的伤害、电网看歼敌）——右边那一格写单位，条形按 frac（0..1）画
  function row(pt, ic, name, dmg, share, meta, tone, unit, frac) {
    return h('div', 'rep ' + (tone || ''),
      portrait(ctx.portraits, pt, ic, 'rep-pt'),
      h('div', 'rep-body',
        h('div', 'rep-top', h('span', 'rep-name', name), h('b', 'rep-dmg', fmtInt(dmg)), h('span', 'rep-share' + (unit ? ' unit' : ''), unit || pctStr(share, share < 0.1 ? 1 : 0))),
        h('div', 'bar ' + (tone === 'cy' ? 'cy' : 'am') + ' thin', barFill(unit ? (frac || 0) * maxShare : share)),
        h('div', 'rep-meta', meta)))
  }
  const descOf = id => { const k = `power.${id}.desc`, d = t(k); return d === k ? '' : d }
  function deviceRow(d, r) {
    const pt = 'device.' + d.kind, ic = DEVICE_ICON[d.kind] || 'gears', name = t(d.nameKey || `device.${d.kind}.name`)
    if (d.kind === 'fence') return row(pt, ic, name, d.kills, 0, t('ui.res.fence_used', { n: d.placed }), 'cy', t('report.col.kills'), r.kills > 0 ? d.kills / r.kills : 0)
    const base = `${t('report.col.placed')} ${d.placed} · ${t('report.col.lost')} ${d.lost} · ${t('report.col.spent')} ${fmtInt(d.spent)}`
    // 采集器 / 路障不打人：一律按「晶能产出」/「承伤」出行（哪怕是 0，也别写成「伤害 0」）
    if (d.kind === 'collector' || (!(d.dmg > 0) && d.yield > 0)) return row(pt, ic, name, d.yield || 0, 0, base, 'cy', t('ui.res.yield'), r.energy && r.energy.earned > 0 ? (d.yield || 0) / r.energy.earned : 0)
    if (d.kind === 'barricade' || (!(d.dmg > 0) && d.absorbed > 0)) return row(pt, ic, name, d.absorbed || 0, 0, base, 'cy', t('ui.res.absorbed'), r.dmgTotal > 0 ? Math.min(1, (d.absorbed || 0) / r.dmgTotal * 8) : 0)
    return row(pt, ic, name, d.dmg || 0, d.share || 0,
      base + ` · ${t('report.col.kills')} ${fmtInt(d.kills)}` + (d.dmgPerEnergy ? ` · ${t('report.col.per_energy')} ${d.dmgPerEnergy.toFixed ? d.dmgPerEnergy.toFixed(1) : d.dmgPerEnergy}` : '') + (d.absorbed > 0 ? ` · ${t('ui.res.absorbed')} ${fmtInt(d.absorbed)}` : ''), 'cy')
  }
  let maxShare = 1
  function barFill(share) { const f = h('i', 'bar-f'); f.style.setProperty('--p', Math.max(0.004, share / maxShare).toFixed(4)); return f }
  const sec = (title, right, ...kids) => h('section', 'res-sec', h('div', 'sec-h', title, right ? h('span', 'sec-note', right) : null), ...kids)

  function build() {
    clear(panel)
    const r = data.result, out = data.outcome || {}, save = data.save || {}
    const won = r.outcome === 'won', lost = r.outcome === 'lost', endless = r.mode === 'endless'
    const canContinue = won && !endless && data.canContinue !== false
    const vsBoss = endless ? t('ui.res.vs_bosses') : t('ui.res.vs', { boss: t(`boss.${r.boss || 'ravager'}.name`) })   // 无尽里打过的不止一只：别把伤害全写在「碾压者」名下
    // Boss 根本没出场（开局就撤离 / 前期阵亡）时，各行不挂「对「碾压者」0」这种噪音
    // 优先读模拟层的 result.bossSeen（Boss 是否出场过）；老存档 / 回放没有这个字段时退回原来的推断
    const bossMet = r.bossSeen === true || (r.bossKills || 0) > 0 || (r.layers || []).some(l => l.boss) ||
      [...r.unitReport, ...(r.powerReport || [])].some(u => u.bossDmg > 0)
    const vsB = n => (bossMet ? ` · ${vsBoss} ${fmtInt(n)}` : '')

    // ---------------- 左栏
    const left = h('div', 'res-left')
    left.append(
      h('div', 'eb ' + (lost ? 'red' : ''), h('i', 'dot'), won ? 'MISSION COMPLETE' : r.outcome === 'retreated' ? 'EXTRACTION' : r.reason === 'abandon' ? 'WITHDRAWN' : endless ? 'DEPTH REACHED' : 'MISSION FAILED', h('span', 'eb-r', t(`commander.${r.commander}.name`))),
      h('h1', 'res-title', tOr(t, r.headline.titleKey, r.reason === 'abandon' ? 'ui.res.abandon.title' : r.headline.titleKey, { layer: r.layer })),
      r.headline.textKey ? h('p', 'res-text', tOr(t, r.headline.textKey, r.reason === 'abandon' ? 'ui.res.abandon.text' : r.headline.textKey, { layer: r.layer })) : null)
    const badges = h('div', 'res-badges')
    if (out.newBest) badges.appendChild(h('span', 'badge gold', icon('trophy'), t('result.new_best')))
    if (out.rank > 0) badges.appendChild(h('span', 'badge', icon('podium'), t('result.rank', { n: out.rank })))
    if (r.daily) badges.appendChild(h('span', 'badge cyan', icon('stopwatch'), t('daily.title') + ' ' + (r.dateKey || '')))
    if (badges.firstChild) left.appendChild(badges)
    if (canContinue) left.append(h('div', 'res-lead', t('ui.res.lead')), button('cta', () => callbacks.continueEndless && callbacks.continueEndless(), h('span', 'cta-t', t('ui.res.continue')), h('kbd', '', 'Enter')))
    // 五大数字
    const big = h('div', 'big')
    r.big.forEach((b, i) => big.appendChild(h('div', 'big-c' + (i === 0 ? ' main' : ''), h('span', 'big-k', t(b.key)), h('b', 'big-v', b.key === 'big.seconds' ? fmtInt(b.value) : fmtInt(b.value)), b.key === 'big.line' ? h('span', 'big-s', '/ ' + fmtInt(r.line.hpMax)) : null)))
    big.appendChild(h('div', 'big-c', h('span', 'big-k', t('report.level')), h('b', 'big-v', String(r.level)), h('span', 'big-s', t('ui.res.cards', { n: r.cards.length }))))
    left.appendChild(big)
    left.appendChild(h('div', 'peak pn',
      h('div', 'peak-c', h('span', 'big-k', t('report.peak_rate')), h('b', '', fmtInt(r.peakKillRate)), h('span', 'big-s', t('ui.hud.per_sec'))),
      h('div', 'peak-c', h('span', 'big-k', t('report.max_combo')), h('b', '', fmtInt(r.maxCombo))),
      h('div', 'peak-c', h('span', 'big-k', t('ui.res.dmg_total')), h('b', '', fmtInt(r.dmgTotal)))))
    // 阵亡来源（result.lostTo）：谁杀了我们的人，前 4 名
    const lt = Object.entries(r.lostTo || {}).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1])
    if (lt.length) {
      const srcName = k => { const a = t(`ui.res.src.${k}`); if (a !== `ui.res.src.${k}`) return a; const b = t(`enemy.${k}.name`); return b !== `enemy.${k}.name` ? b : t('ui.res.src.other') }
      // 原来只列前 4 名再拖一个「…」（「翼螫 9 · …」看着像被截断）：改成逐条小块、自动换行，最多 8 条，再多的合成「其他」
      const shown = lt.slice(0, lt.length > 8 ? 7 : 8), rest = lt.slice(shown.length).reduce((a, [, n]) => a + n, 0)
      const chips = shown.map(([k, n]) => h('span', 'res-lost-c', srcName(k), h('b', '', fmtInt(n))))
      if (rest > 0) chips.push(h('span', 'res-lost-c', t('ui.res.src.other'), h('b', '', fmtInt(rest))))
      left.appendChild(h('div', 'res-lost', h('span', 'big-k', t('ui.res.lost_to', { n: fmtInt(r.losses) })), h('div', 'res-lost-v', ...chips)))
    }
    // 新解锁 / 勋章 / 伙伴
    const news = h('div', 'res-news')
    for (const id of out.newUnlocks || []) news.appendChild(h('div', 'news cyan', icon('unlock'), h('div', '', h('b', '', t('unlock.title') + ' · ' + t(`unlock.${id}.name`)), h('span', '', t(`unlock.${id}.desc`)))))
    for (const id of out.newAchievements || []) news.appendChild(h('div', 'news gold', icon(ACH_ICON), h('div', '', h('b', '', t('ach.title') + ' · ' + t(`ach.${id}.name`)), h('span', '', t(`ach.${id}.desc`)))))
    if (r.companion) news.appendChild(h('div', 'news', icon('drone'), h('div', '', h('b', '', (r.companion.name || t('companion.name')) + ' · ' + t(r.companion.formKey)), h('span', '', t('companion.points') + ' +' + (out.companionPoints != null ? out.companionPoints : r.companion.points.total)))))
    // 按钮放在「新解锁 / 勋章」前面：第一次通关会一口气出十来条，按钮排在后面就被挤到要滚动才看得见
    left.appendChild(h('div', 'res-btns',
      button(canContinue ? 'b2' : 'cta', () => (callbacks.again || callbacks.start) && (callbacks.again ? callbacks.again() : callbacks.start()), h('span', 'cta-t', t('ui.res.again')), canContinue ? null : h('kbd', '', 'Enter')),
      button('b2', () => callbacks.home && callbacks.home(), icon('home'), t('ui.res.home'))))
    if (news.firstChild) left.appendChild(news)
    // 无尽逐层战报：层数不多（≤ 6）且没有新解锁要播时放在左栏（按钮上面那块原来是空白），多了还放右栏
    const layersSlot = h('div', 'res-layers-l')
    left.insertBefore(layersSlot, left.querySelector('.res-btns'))

    // ---------------- 右栏
    const right = h('div', 'res-right')
    maxShare = Math.max(0.01, ...r.unitReport.map(u => u.share), ...(r.powerReport || []).map(u => u.share), ...(r.deviceReport || []).map(u => u.share || 0))
    right.appendChild(sec(t('report.section.units'), t('report.col.dmg') + ' / ' + t('report.col.share'),
      ...r.unitReport.filter(u => u.deployed > 0 || u.dmg > 0).map(u => row('unit.' + u.kind, unitIcon(u.kind), t(u.nameKey), u.dmg, u.share,
        `${t('report.col.deployed')} ${u.deployed} · ${t('report.col.kills')} ${fmtInt(u.kills)}${vsB(u.bossDmg)} · ${t(u.rank.nameKey)}`))))
    const pw = (r.powerReport || []).filter(p => p.casts > 0 || p.dmg > 0)
    if (pw.length) right.appendChild(sec(t('report.section.powers'), null,
      // 不打伤害的支援技能（鼓舞 / 空投）：写「用了几次」，别挂一个 0 和 0.0%
      ...pw.map(p => (p.dmg > 0 || !p.casts
        ? row('power.' + p.id, POWER_ICON[p.id] || 'power', t(p.nameKey), p.dmg, p.share, `${t('report.col.casts')} ${p.casts || 0} · ${t('report.col.kills')} ${fmtInt(p.kills)}${vsB(p.bossDmg)}`, 'cy')
        : row('power.' + p.id, POWER_ICON[p.id] || 'power', t(p.nameKey), p.casts, 0, descOf(p.id), 'cy', t('report.col.casts'), 0)))))
    const dv = r.deviceReport || []
    if (dv.length) right.appendChild(sec(t('report.section.devices'), r.energy ? t('ui.res.energy', { earned: fmtInt(r.energy.earned), spent: fmtInt(r.energy.spent) }) : null,
      ...dv.map(d => deviceRow(d, r))))
    const mods = r.moduleReport || []
    if (mods.length) right.appendChild(sec(t('report.section.modules'), t('ui.res.level_cards', { level: r.level, n: r.cards.length }),
      h('div', 'modrep', ...mods.map(m => h('div', 'modc pn', icon(moduleIcon(m.id, m.unit)), h('div', '', h('span', 'modc-n', t(m.nameKey)), h('b', '', fmtInt(m.dmg)), h('span', 'modc-s', ' · ' + pctStr(m.share, 1))))))))
    // 英雄级小队名单的「未归」拆成「阵亡」（计入左栏部队损失）和「离队」（不是战死：没在阵亡名单里），口径和左栏对得上
    const rosterSum = s => {
      const kia = s.members.filter(m => !m.alive && m.fallenAt != null).length, left = s.fallen - kia
      return t('ui.res.roster_sum', { alive: s.alive, kia }) + (left > 0 ? t('ui.res.roster_left', { n: left }) : '')
    }
    if (r.roster && r.roster.length) right.appendChild(sec(t('report.section.roster'), t('ui.res.roster_note', { n: fmtInt(r.losses) }),
      ...r.roster.map(s => h('div', 'roster pn',
        h('div', 'roster-h', icon('laurel'), h('b', '', t(s.squadName)), h('span', '', t(`heroic.${s.heroic}.name`) + ' · ' + t(`unit.${s.unit}.name`)), h('span', 'roster-sum', rosterSum(s))),
        h('div', 'roster-m', ...s.members.slice(0, 24).map(m => h('span', m.alive ? 'ok' : 'kia', t(m.name) + (m.kills ? ' ' + fmtInt(m.kills) : ''))), s.members.length > 24 ? h('span', 'more', '+' + (s.members.length - 24)) : null)))))
    if (r.layers && r.layers.length) (r.layers.length <= 6 && !news.firstChild ? layersSlot : right).appendChild(sec(t('report.section.layers'), null,
      h('div', 'layers', h('div', 'layer-r head', h('span', '', t('board.col.layer')), h('span', '', t('ui.res.mix')), h('span', '', t('report.col.kills')), h('span', '', t('report.losses')), h('span', '', t('report.line'))),
        ...r.layers.map(l => h('div', 'layer-r', h('b', '', String(l.layer)), h('span', '', t(`herald.deep.${l.mix}`).replace(/^.*?:\s*/, '') + (l.boss ? ' · ' + t(`boss.${l.boss}.name`) : '')), h('span', '', fmtInt(l.kills)), h('span', l.losses ? 'warn' : '', String(l.losses)), h('span', '', Math.round(l.line / l.lineMax * 100) + '%'))))))
    right.appendChild(sec(t('board.title'), null, boardTable(t, save.board, out.rank)))

    panel.append(h('i', 'res-stripe' + (lost ? ' red' : '')), left, right)
    panel.className = 'res-panel pn ' + (lost ? 'lost' : won ? 'won' : 'out')
  }

  return {
    el,
    show(d) { data = d; build(); el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in') },
    hide() { el.hidden = true },
    relabel() { if (data && !el.hidden) build() },
    key(e) {
      if (!data || el.hidden) return false
      if (e.key === 'Enter') {
        const r = data.result
        if (r.outcome === 'won' && r.mode !== 'endless' && data.canContinue !== false) callbacks.continueEndless && callbacks.continueEndless()
        else if (callbacks.again) callbacks.again(); else if (callbacks.start) callbacks.start()
        return true
      }
      return false
    },
  }
}
