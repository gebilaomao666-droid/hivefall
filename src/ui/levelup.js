// 战地升级三选一（无尽 16 层后四选一；第 10 层「盟军先遣队」也走这里）。
// 键位：1/2/3/4 直接选，←/→ 切换，Enter 确认，R 重掷。点卡即选。
import { h, icon, clear, setCls, button, portrait } from './dom.js'
import { unitIcon, moduleIcon, DEVICE_ICON } from './icons.js'
import { roman } from './banners.js'
import { MODULES } from '../data/modules.js'

/** 去掉单位名里的代号：「裁决」光束步行机 → 光束步行机；"Reaper" Beam Walker → Beam Walker */
export const shortName = s => String(s || '').replace(/^\s*[「"“][^」"”]*[」"”]\s*/, '') || String(s || '')

export function createLevelup(ctx) {
  const { t, callbacks } = ctx
  const el = h('div', 'ov lu')
  const eyebrow = h('span', 'lu-eb'), lv = h('b', 'lu-lv')
  const cardsEl = h('div', 'lu-cards')
  const hint = h('div', 'lu-hint')
  const rr = { n: h('b'), note: h('span', 'lu-rr-note'), label: h('span') }
  rr.el = button('lu-rr pn', () => reroll(), icon('reroll_dice'), rr.label, h('kbd', '', 'R'), rr.n, rr.note)
  el.append(h('div', 'lu-head', h('i', 'lu-rule'), eyebrow, lv, h('i', 'lu-rule')), cardsEl, h('div', 'lu-foot', hint, rr.el))
  el.hidden = true

  // 防误触只挡「穿透」：面板弹出之前就按下去的那一下（键盘 keydown 发生在弹出之前 / 鼠标 pointerdown 发生在弹出之前）不算选牌；
  // 弹出之后的任何一次新按键、新点击都立刻生效——原来是整整 0.35 秒什么输入都不收
  let sig = '', cur = null, sel = 0, busyUntil = 0, cardEls = [], shownAt = 0, downAt = -1

  function ownerOf(c) {
    if (c.kind === 'ally') return { ic: unitIcon(c.unit), txt: t('ally.vanguard.title'), pt: 'unit.' + c.unit }
    if (c.kind === 'device' || (MODULES[c.moduleId] && MODULES[c.moduleId].line === 'device')) {
      const d = c.unlock || c.device
      return { ic: d ? DEVICE_ICON[d] : 'gears', txt: d ? t(`device.${d}.name`) : t('tag.device'), pt: d ? 'device.' + d : '' }
    }
    if (c.unit) return { ic: unitIcon(c.unit), txt: t(`unit.${c.unit}.name`), pt: 'unit.' + c.unit }
    return { ic: 'team_upgrade', txt: t('ui.lu.all_units'), pt: '' }
  }

  function build(lu) {
    clear(cardsEl); cardEls = []
    const vanguard = lu.kind === 'vanguard'
    eyebrow.textContent = vanguard ? t('ally.vanguard.title') : t('levelup.title')
    lv.textContent = 'LV ' + lu.level
    lu.cards.forEach((c, i) => {
      const own = ownerOf(c)
      const isEquip = c.from === 'off' || c.from === 'on'
      const lvTxt = c.kind === 'ally' ? '' : c.maxLevel > 1 && c.maxLevel < 90 ? roman(c.level) : ''
      const pips = h('div', 'luc-pips')
      if (c.maxLevel > 1 && c.maxLevel <= 5) for (let k = 0; k < c.maxLevel; k++) pips.appendChild(h('i', k < c.level - 1 ? 'on' : k === c.level - 1 ? 'new' : ''))
      const badges = h('div', 'luc-badges')
      if (c.completes) badges.appendChild(h('span', 'luc-badge elite', icon('chain_lightning'), t('levelup.completes', { name: t(`combo.${c.completes}.name`) })))
      if (c.heroic) badges.appendChild(h('span', 'luc-badge gold', icon('laurel'), t('levelup.heroic', { name: t(`heroic.${c.heroic}.name`) })))
      const val = c.kind === 'ally' ? null
        : isEquip ? h('div', 'luc-val', h('span', 'luc-from', t('value.off')), h('i', 'luc-arrow'), h('b', 'luc-to', t('value.on')))
          : h('div', 'luc-val', h('span', 'luc-from', c.from), h('i', 'luc-arrow'), h('b', 'luc-to', c.to))
      // 顶行「所属」那一格很窄：去掉代号（「裁决」光束步行机 → 光束步行机），完整名字放悬停提示里，别截成「光束步行…」
      const ownEl = h('span', 'luc-own', icon(own.ic), shortName(own.txt))
      ownEl.title = own.txt
      const card = h('button', `luc pn r-${c.rarity}` + (c.equip ? ' equip' : ''),
        h('div', 'luc-top', h('span', 'luc-key', String(i + 1)), ownEl, h('span', 'luc-rar', t(c.equip && c.kind !== 'ally' ? 'ui.lu.equip' : 'rarity.' + c.rarity))),
        h('div', 'luc-face', h('i', 'luc-hex'), icon(c.kind === 'ally' ? unitIcon(c.unit) : moduleIcon(c.moduleId, c.unit), 'luc-ic')),
        h('div', 'luc-name', t(c.nameKey), lvTxt ? h('b', '', ' ' + lvTxt) : null),
        val,
        h('div', 'luc-desc', t(c.descKey)),
        badges, pips)
      card.type = 'button'
      card.addEventListener('pointerenter', () => setSel(i))
      card.addEventListener('click', e => { e.stopPropagation(); if (e.detail === 0 || downAt >= shownAt) pick(i) })   // detail 0 = 键盘 / 读屏触发的 click，没有指针按下，不算穿透
      cardEls.push(card); cardsEl.appendChild(card)
    })
    setCls(cardsEl, 'four', lu.cards.length >= 4)
    clear(hint)
    hint.append(t('ui.lu.press'), ...lu.cards.map((_, i) => h('kbd', '', String(i + 1))), t('ui.lu.direct'), h('i', 'sep'), h('kbd', '', '←'), h('kbd', '', '→'), t('ui.lu.switch'), h('kbd', '', 'Enter'), t('ui.lu.confirm'))
    rr.label.textContent = t('ui.lu.reroll')
    rr.n.textContent = t('ui.lu.left', { n: lu.rerolls })
    rr.note.textContent = t('ui.lu.reroll_note')
    rr.el.disabled = lu.rerolls <= 0
    rr.el.hidden = vanguard
    sel = Math.min(1, lu.cards.length - 1)
    setSel(sel)
  }
  function setSel(i) { sel = i; cardEls.forEach((c, k) => setCls(c, 'sel', k === i)) }
  // 面板上任何地方按下都记时间：click 只认「弹出之后才按下去」的那次
  el.addEventListener('pointerdown', e => { downAt = e.timeStamp || performance.now() }, true)
  function pick(i) {
    if (!cur || performance.now() < busyUntil || i < 0 || i >= cardEls.length) return
    busyUntil = performance.now() + 250                      // 选中后等模拟层收下这张牌：别连点成两次
    cardEls.forEach((c, k) => { c.classList.toggle('picked', k === i); c.classList.toggle('dropped', k !== i) })
    callbacks.pickCard && callbacks.pickCard(i)
  }
  function reroll() {
    if (!cur || cur.rerolls <= 0 || cur.kind === 'vanguard' || performance.now() < busyUntil) return
    callbacks.reroll && callbacks.reroll()
  }

  return {
    el,
    /** world.levelup 变了（或刚出现）就重建；同一手牌不重建 */
    sync(lu) {
      if (!lu) { if (cur) { cur = null; sig = ''; el.hidden = true } return false }
      const s = lu.level + '|' + lu.kind + '|' + lu.rerolls + '|' + lu.cards.map(c => c.id + c.level).join()
      if (s !== sig) {
        const fresh = !cur
        sig = s; cur = lu; build(lu)
        el.hidden = false
        if (fresh) { shownAt = performance.now(); busyUntil = 0; downAt = -1 }
        // 重放进场动画：只强制算一次样式（getComputedStyle），不再用 offsetWidth 强制整页重排——第一次弹出时那一下要 10~30ms
        el.classList.remove('in'); void getComputedStyle(el).opacity; el.classList.add('in')
      }
      return true
    },
    relabel() { if (cur) { const c = cur; sig = ''; cur = null; this.sync(c) } },
    key(e) {
      if (!cur) return false
      const k = e.key
      // 弹出之前就按下的键（按住不放的 keydown 连发已经在 ui.js 里被 repeat 过滤）：吞掉，不当成选牌
      if (e.repeat || (e.timeStamp && e.timeStamp < shownAt)) return k >= '1' && k <= '4' || k === 'Enter' || k === ' '
      if (k >= '1' && k <= '4') { pick(+k - 1); return true }
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { setSel((sel + cardEls.length - 1) % cardEls.length); return true }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { setSel((sel + 1) % cardEls.length); return true }
      if (k === 'Enter' || k === ' ') { pick(sel); return true }
      if (k === 'r' || k === 'R') { reroll(); return true }
      return false
    },
    active: () => !!cur,
  }
}
