// 战斗 HUD。节点只建一次；update(world) 每帧调：条形每帧刷，文本 10Hz 刷，值没变不碰 DOM。
import { h, icon, setIcon, portrait, setPortrait, setText, setCls, setVar, show, button, fmtInt, fmtTime, pad2, clamp01, splitTitle, clear, mutEffect } from './dom.js'
import { unitIcon, gateIcon, moduleIcon, DEVICE_ICON, POWER_ICON, MUTATOR_ICON, COMMANDER_ICON, BOSS_ICON } from './icons.js'
import { createMinimap } from './minimap.js'
import { roman } from './banners.js'
import { UNITS, UNIT_KINDS } from '../data/units.js'
import { GATE } from '../data/gates.js'
import { MODULES } from '../data/modules.js'

const QUALITIES = ['high', 'mid', 'low']
const CLS_OF = k => (UNITS[k] ? UNITS[k].cls : '')

export function createHud(ctx, banners) {
  const { t, callbacks } = ctx
  const el = h('div', 'hud')
  const L = []                                   // 需要在切语言时重写的静态文案：[el, fn]
  const lab = (node, fn) => { L.push([node, fn]); setText(node, fn()); return node }
  const span = (cls, fn) => lab(h('span', cls), fn)

  // ================================================================ 左上：Logo / 补给铭牌 / 技能 / 伙伴
  const supply = { el: h('div', 'chip pn'), k: h('span', 'chip-k'), v: h('b', 'chip-v'), bar: h('i', 'chip-bar') }
  supply.el.append(icon('supply_crate'), supply.k, supply.v, supply.bar)
  const powersEl = h('div', 'powers')
  const powers = []                              // 按 world.powers 的顺序建
  let powersSig = null                          // null = 必须重建（空串是合法签名：标准小队没有技能）
  const comp = { el: h('div', 'comp pn'), name: h('span', 'comp-name'), form: h('span', 'comp-form'), bar: h('i', 'bar-f') }
  comp.el.append(portrait(ctx.portraits, 'companion.seven', 'drone', 'comp-pt'), h('div', 'comp-body', h('div', 'comp-head', comp.name, comp.form), h('div', 'bar cy', comp.bar)))
  comp.el.hidden = true
  const logo = h('div', 'logo', h('b', '', 'HIVEFALL'), span('logo-sub', () => t('ui.brand.sub')))
  const tl = h('div', 'hud-tl', logo, supply.el, powersEl, comp.el)

  function buildPowers(world) {
    clear(powersEl); powers.length = 0
    for (const p of world.powers) {
      const o = { id: p.id, key: p.key }
      o.ic = icon(POWER_ICON[p.id] || 'power', 'pw-ic')
      o.cd = h('span', 'pw-cd')
      o.pips = h('span', 'pw-pips')
      o.name = h('span', 'pw-name', t(p.nameKey))
      o.el = button('pw pn', () => callbacks.power && callbacks.power(p.key), h('span', 'pw-face', o.ic, o.cd), h('span', 'pw-key', p.key.toUpperCase()), h('span', 'pw-txt', o.name, o.pips))
      for (let i = 0; i < p.maxCharges && p.maxCharges > 1; i++) o.pips.appendChild(h('i'))
      ctx.tip(o.el, () => ({ title: t(p.nameKey), body: t(p.descKey), meta: p.key.toUpperCase() }), { side: 'right' })
      powers.push(o); powersEl.appendChild(o.el)
    }
  }

  // ================================================================ 顶中：任务行 / Boss 血条 / 大波预告
  const mission = { el: h('div', 'mission'), label: h('b', 'mission-phase') }
  mission.el.append(h('i', 'dot'), span('', () => t('ui.hud.force')), h('i', 'sep'), span('', () => t('ui.hud.bridge')), h('i', 'sep'), mission.label)
  const boss = { el: h('div', 'bossbar'), name: h('span', 'boss-name'), tag: h('span', 'boss-tag'), hp: h('span', 'boss-hp'), f: h('i', 'boss-f'), lag: h('i', 'boss-lag'), ic: icon('boss_skull', 'boss-ic'), lagV: 1, kind: null }
  boss.marks = [h('i', 'boss-mark'), h('i', 'boss-mark')]     // 换阶段的血量刻度（phases[k].at），过了就熄
  boss.el.append(h('div', 'boss-head', boss.ic, boss.name, boss.tag, boss.hp), h('div', 'boss-track', boss.lag, boss.f, h('i', 'boss-ticks'), ...boss.marks))
  boss.el.hidden = true
  // 中央横幅收进顶中这一列（任务行 / Boss 血条 / 大波预告的下面），不再压在方阵和 Boss 之间
  const tc = h('div', 'hud-tc', mission.el, boss.el, banners.heraldEl, banners.bannerEl)

  // ================================================================ 右上：画质 / 声音 / 部队 / 暂停 + 歼敌速度 + 通讯
  const qBtn = button('sq pn', () => {
    const cur = QUALITIES.indexOf(ctx.settings().quality)
    const next = QUALITIES[(cur + 1) % QUALITIES.length]
    ctx.settings().quality = next; callbacks.setQuality && callbacks.setQuality(next); relabel()
  }, span('sq-k', () => t('ui.hud.quality')), lab(h('b', 'sq-v'), () => t('ui.q.' + ctx.settings().quality)))
  const sBtnIc = icon('sound_on')
  const sBtn = button('sq pn only-ic', () => {
    const s = ctx.settings(); s.muted = !s.muted
    callbacks.setMuted && callbacks.setMuted(s.muted); relabel()
  }, sBtnIc)
  const squadBtn = button('sq pn', () => ctx.open('squad'), icon('squad'), span('sq-k m-show', () => t('ui.hud.squad')), h('kbd', 'm-hide', 'Tab'))
  const pauseBtn = button('sq pn only-ic', () => ctx.open('paused'), icon('pause'))
  const rate = { v: h('b', 'rate-v'), bar: h('i', 'bar-f'), combo: h('span', 'rate-combo'), cbar: h('i', 'bar-f') }
  const rateEl = h('div', 'rate pn',
    h('div', 'rate-row', h('div', 'rate-l', span('rate-k', () => t('ui.hud.killrate')), span('rate-s', () => t('ui.hud.recent'))), rate.v, span('rate-u', () => t('ui.hud.per_sec'))),
    h('div', 'bar am', rate.bar),
    h('div', 'rate-row2', span('rate-k', () => t('ui.hud.combo')), rate.combo, h('div', 'bar cy thin', rate.cbar)))
  const tr = h('div', 'hud-tr', h('div', 'sq-row', qBtn, sBtn, squadBtn, pauseBtn), rateEl, banners.commsEl)

  // ================================================================ 门卡（桌面两侧竖卡 / 手机顶部扁卡）
  const gates = { el: h('div', 'gates'), key: -1, until: 0, sides: {} }
  for (const side of ['left', 'right']) {
    const g = { el: h('div', 'gate pn ' + side) }
    g.ic = icon('supply_crate', 'gate-ic')
    // 标题 / 说明 / 标签分三行（中间一条细分隔线）；读屏和复制出来的纯文本也要分得开：每段之间塞一个视觉上隐藏的分隔符
    g.title = h('div', 'gate-title'); g.sub = h('div', 'gate-sub'); g.tags = h('div', 'gate-tags')
    g.hint = h('div', 'gate-hint', icon('arrow'), lab(h('span'), () => t('ui.gate.' + side)), h('span', 'sr', ': '))
    g.bar = h('i', 'gate-bar')
    g.sep1 = h('span', 'sr', ' — '); g.sep2 = h('span', 'sr', ' · ')
    g.el.append(g.hint, h('div', 'gate-face', g.ic), h('div', 'gate-body', g.title, g.sep1, g.sub, g.sep2, g.tags), g.bar)
    gates.sides[side] = g; gates.el.appendChild(g.el)
  }
  gates.head = h('div', 'gates-head')
  gates.el.appendChild(gates.head)
  gates.el.hidden = true
  function fillGate(g, opt) {
    let [main, sub] = splitTitle(t(opt.titleKey, opt.params))
    // 满编时的「补员 +0 / 全队回血」：+0 没有意义，标题只写回血，副行说明为什么没有补员（模拟层换掉这个选项之前的界面兜底）
    if (opt.titleKey === 'gate.reinforce' && opt.params && !(opt.params.count > 0)) { main = t('ui.gate.heal_only'); sub = t('ui.gate.full_note') }
    setIcon(g.ic, gateIcon(opt)); setText(g.title, main)
    const desc = opt.params && opt.params.descKey ? t(opt.params.descKey) : sub
    setText(g.sub, desc); setCls(g.sub, 'empty', !desc)
    setText(g.sep1, desc ? ' — ' : ''); setText(g.sep2, opt.tags && opt.tags.length ? ' · ' : '')
    clear(g.tags)
    const tagTxt = []
    for (const tag of opt.tags || []) { if (g.tags.firstChild) g.tags.appendChild(h('span', 'sr', ' · ')); g.tags.appendChild(h('span', 'tag ' + tag, t('tag.' + tag))); tagTxt.push(t('tag.' + tag)) }
    g.el.setAttribute('aria-label', [t('ui.gate.' + (g === gates.sides.left ? 'left' : 'right')) + ': ' + main, desc, tagTxt.join(' · ')].filter(Boolean).join(' — '))
    const tone = opt.type === 'contract' ? 'gold' : opt.type === 'stat' && opt.params && opt.params.cost ? 'red' : opt.type === 'device' ? 'cyan' : ''
    g.el.className = 'gate pn ' + (g === gates.sides.left ? 'left' : 'right') + (tone ? ' ' + tone : '')
  }
  function showGates(gs) {
    gates.key = gs.index; gates.until = 0
    fillGate(gates.sides.left, gs.left); fillGate(gates.sides.right, gs.right)
    setText(gates.head, gs.kind === 'bounty' ? t('gate.bounty') : gs.total > gs.index + 1 || gs.index < 10 ? t('ui.hud.supply', { n: gs.index + 1, total: gs.total }) : t('ui.hud.supply_n', { n: gs.index + 1 }))
    gates.el.hidden = false
    // 重放进场动画：只强制算一次样式（getComputedStyle），不再用 offsetWidth 强制整页重排——第一次弹出时那一下要 10~30ms
    gates.el.classList.remove('in', 'done-left', 'done-right'); void getComputedStyle(gates.el).opacity; gates.el.classList.add('in')
  }

  // ================================================================ 底部：装置卡槽 + 晶能 / 模块药丸 / 经验条 / 控制台
  const energy = { el: h('div', 'energy pn'), v: h('b', 'energy-v'), pop: h('span', 'energy-pop'), shown: -1, popUntil: 0, popSum: 0, ic: icon('crystal', 'energy-ic') }
  energy.el.append(energy.ic, h('div', 'energy-body', span('energy-k', () => t('hud.energy')), energy.v), energy.pop)
  const cardsEl = h('div', 'dcards')
  const cards = []
  let selected = null
  const KINDS = ['collector', 'sentry', 'barricade', 'mine', 'cryo', 'scorcher', 'mortarpit', 'nova']
  function select(kind, silent) {
    if (selected === kind) return
    selected = kind
    for (const c of cards) { setCls(c.el, 'sel', c.kind === kind); if (c.kind === kind && ctx.mobile()) revealCard(c) }
    setCls(el, 'placing', !!kind)
    setText(devHint, kind === 'remove' ? t('ui.dev.remove.hint') : kind ? t('ui.dev.hint') : '')
    if (!silent && callbacks.selectDeviceCard) callbacks.selectDeviceCard(kind)
  }
  function toggle(c, world) {
    if (c.kind === selected) return select(null)
    if (c.kind !== 'remove' && world) {
      const wc = world.cards && world.cards[c.i]
      if (wc && !wc.ready) { flashCard(c, !wc.unlocked ? 'locked' : wc.cdLeft > 0 ? 'cooldown' : 'energy'); return }
    }
    select(c.kind)
  }
  let lastWorld = null
  KINDS.concat('remove').forEach((kind, i) => {
    const c = { kind, i, key: kind === 'remove' ? 'X' : String(i + 1) }
    c.ic = icon(DEVICE_ICON[kind], 'dc-ic')
    c.cost = h('span', 'dc-cost')
    c.mask = h('i', 'dc-mask'); c.cdT = h('span', 'dc-cdt'); c.lock = icon('lock', 'dc-lock'); c.msg = h('span', 'dc-msg')
    c.el = button('dc' + (kind === 'remove' ? ' rm' : ''), () => toggle(c, lastWorld), h('span', 'dc-key', c.key), c.ic, kind === 'remove' ? lab(h('span', 'dc-cost'), () => t('ui.dev.remove.name')) : h('span', 'dc-costrow', icon('crystal'), c.cost), c.mask, c.cdT, c.lock, c.msg)
    ctx.tip(c.el, () => {
      if (kind === 'remove') return { title: t('ui.dev.remove.name'), body: t('ui.dev.remove.desc'), meta: 'X' }
      const wc = lastWorld && lastWorld.cards && lastWorld.cards[i]
      return { title: t(`device.${kind}.name`), body: t(`device.${kind}.desc`), meta: wc ? (wc.unlocked ? t('ui.dev.meta', { cost: wc.cost, cd: wc.cd }) : t('ui.dev.locked')) : '' }
    })
    cards.push(c); cardsEl.appendChild(c.el)
  })
  function flashCard(c, reason) {
    setText(c.msg, t('ui.fail.' + reason))
    c.el.classList.remove('deny'); void getComputedStyle(c.el).opacity; c.el.classList.add('deny')
  }
  const devHint = h('div', 'dev-hint')
  const cardsWrap = h('div', 'dcards-wrap pn', cardsEl)
  // 手机上卡条横向滑动：滑到头就去掉右沿的渐隐
  const syncEnd = () => setCls(cardsWrap, 'at-end', cardsWrap.scrollLeft + cardsWrap.clientWidth >= cardsWrap.scrollWidth - 2)
  cardsWrap.addEventListener('scroll', syncEnd, { passive: true })
  /** 把一张卡滚进卡条的可见区（右端被钉住的「铲除」键挡住的那一截也算看不见） */
  function revealCard(c) {
    if (c.kind === 'remove') return
    const s = ctx.scale() || 1
    const w = cardsWrap.getBoundingClientRect(), r = c.el.getBoundingClientRect(), rm = cards[cards.length - 1].el.getBoundingClientRect()
    const lo = w.left + 4, hi = rm.left - 16                      // 铲除键左沿还有一圈阴影和「‹」提示：留 16px
    let d = 0
    if (r.left < lo) d = (r.left - lo) / s
    else if (r.right > hi) d = (r.right - hi) / s
    if (!d) return
    const to = Math.max(0, cardsWrap.scrollLeft + d)
    if (cardsWrap.scrollTo) cardsWrap.scrollTo({ left: to, behavior: 'smooth' }); else cardsWrap.scrollLeft = to
  }
  const devRow = h('div', 'devrow', energy.el, cardsWrap, devHint)

  const pillsEl = h('div', 'pills')
  let pillsSig = null
  const xp = { lv: h('b', 'xp-lv'), f: h('i', 'xp-f'), txt: h('span', 'xp-txt'), rate: h('b', 'xp-rate-v'), }
  // 手机上右上角放不下歼敌速度表（那里是门卡），就挤在经验条右端：一个数字 + /秒，顶掉「经验 x / y」那串字
  const xpEl = h('div', 'xpbar', xp.lv, h('div', 'xp-track', xp.f, h('i', 'xp-ticks')), xp.txt, h('span', 'xp-rate m-show', xp.rate, span('xp-rate-u', () => t('ui.hud.per_sec'))))

  // ---- 控制台左：歼敌 / 计时 / 防线 / 电网 + 小地图
  const st = { kills: h('b', 'st-kills'), time: h('b', 'st-v'), timeK: h('span', 'st-k'), line: h('b', 'st-v'), lineF: h('i', 'bar-f'), fences: h('span', 'st-fences') }
  const fencePips = []
  for (let i = 0; i < 5; i++) { const p = h('i'); fencePips.push(p); st.fences.appendChild(p) }
  const mm = createMinimap(168, 84)
  const cLeft = h('div', 'c-seg c-left pn',
    h('div', 'c-stats',
      h('div', 'st st-main', span('st-k', () => t('ui.hud.kills')), st.kills),
      h('div', 'st st-time', st.timeK, st.time),
      h('div', 'st st-line', span('st-k', () => t('ui.hud.line')), st.line, h('div', 'bar am thin', st.lineF)),
      h('div', 'st st-fence', span('st-k', () => t('ui.hud.fence')), st.fences)),
    h('div', 'mm', mm.el, h('i', 'mm-scan'), span('mm-k', () => t('ui.hud.map'))))

  // ---- 控制台中：头像 / 编制 / 总血条
  const mid = { pt: portrait(ctx.portraits, 'commander.none', 'squad', 'c-pt'), name: h('div', 'c-name'), hpF: h('i', 'bar-f'), hpT: h('span', 'c-hpt'), dmg: h('b', 'c-dmg'), od: h('span', 'c-od') }
  const cnt = {}
  const cntEl = h('div', 'c-counts')
  for (const k of ['infantry', 'artillery', 'heavy', 'losses']) {
    cnt[k] = { v: h('b', 'cn-v'), cap: h('span', 'cn-cap') }
    cntEl.appendChild(h('div', 'cn ' + k, span('cn-k', () => t('ui.hud.' + k)), cnt[k].v, cnt[k].cap))
  }
  const mutEl = h('div', 'c-muts')
  let mutSig = null                              // null = 必须重建（空串是合法签名：本局没有突变）
  const cMid = h('div', 'c-seg c-mid pn',
    mid.pt,
    h('div', 'c-midbody',
      h('div', 'c-midhead', mid.name, mutEl, h('span', 'c-fire', span('cn-k', () => t('ui.hud.firepower')), mid.dmg, lab(mid.od, () => t('ui.hud.overdrive')))),
      cntEl,
      h('div', 'c-hp', h('div', 'bar gr', mid.hpF), mid.hpT)))

  // ---- 控制台右：兵种编成格
  const cells = {}
  const cellsEl = h('div', 'c-cells')
  for (const k of UNIT_KINDS) {
    const c = { n: h('b', 'uc-n'), name: lab(h('span', 'uc-name'), () => t(`unit.${k}.name`).replace(/[「」"]/g, '')) }
    c.el = h('div', 'uc', portrait(ctx.portraits, 'unit.' + k, unitIcon(k), 'uc-pt'), c.n, c.name)
    c.el.hidden = true
    ctx.tip(c.el, () => ({ title: t(`unit.${k}.name`), body: t(`unit.${k}.desc`), meta: (UNITS[k].tags || []).map(x => t('tag.' + x)).join(' · ') }))
    cells[k] = c; cellsEl.appendChild(c.el)
  }
  const cRight = h('div', 'c-seg c-right pn', cellsEl)
  const consoleEl = h('div', 'console', h('i', 'console-rail'), cLeft, cMid, cRight)
  const bottom = h('div', 'hud-bottom', devRow, pillsEl, xpEl, consoleEl)

  // ---- 划线瞄准提示
  const aim = { el: h('div', 'aim pn'), t: h('span', 'aim-t'), bar: h('i', 'aim-bar') }
  aim.el.append(icon('target_lock'), span('aim-h', () => t('aim.hint')), aim.t, aim.bar)
  aim.el.hidden = true

  el.append(tl, tc, tr, gates.el, banners.flankL, banners.flankR, banners.floatsEl, banners.cardsEl, aim.el, bottom, h('i', 'hud-vignette'))

  // ================================================================ 刷新
  let lastSlow = 0, gateIdx = 0, wasOvertime = false
  function relabel() {
    for (const [node, fn] of L) { node._t = null; setText(node, fn()) }
    setIcon(sBtnIc, ctx.settings().muted ? 'sound_off' : 'sound_on')
    setCls(sBtn, 'off', ctx.settings().muted)
    // 只有图标的按钮：给读屏和悬停提示一个名字
    for (const [b, key] of [[sBtn, 'ui.settings.mute'], [pauseBtn, 'ui.hud.pause'], [squadBtn, 'ui.hud.squad']]) { const s = t(key); b.setAttribute('aria-label', s); b.title = s }
    sBtn.setAttribute('aria-pressed', String(!!ctx.settings().muted))
    powersSig = null; pillsSig = null; mutSig = null; gates.key = -1; lastSlow = 0
  }

  // 门卡 / 侧翼警告要贴在桥外侧。桥在屏幕上有多宽取决于窗口宽高比（窗口越窄，桥占得越宽），
  // 所以按渲染层的投影现算：界面坐标 y 这一行上，桥面外沿离屏幕中线多远（界面单位）。结果写成 CSS 变量
  let edgeSig = ''
  function bridgeHalfAt(yUi) {
    const s = ctx.scale(), target = yUi * s
    let lo = -30, hi = 20                     // 屏幕 y 随 z 单调增：二分出这一行对应的 z
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2, p = ctx.project(0, 0, mid); if (!p) return 0; if (p.y < target) lo = mid; else hi = mid }
    const a = ctx.project(-7.4, 0, hi), b = ctx.project(7.4, 0, hi)      // 7.4 = 桥面半宽 6.4 + 护栏
    return a && b ? Math.abs(b.x - a.x) / 2 / s : 0
  }
  function syncBridgeEdge() {
    if (!ctx.project || ctx.mobile()) return
    const g = Math.round(bridgeHalfAt(330)), f = Math.round(bridgeHalfAt(396))
    const sig = g + ',' + f
    if (sig === edgeSig || !(g > 0)) return
    edgeSig = sig
    el.style.setProperty('--edge-gate', Math.max(252, g + 14) + 'px')
    el.style.setProperty('--edge-flank', Math.max(232, f + 10) + 'px')
  }

  function slow(world) {
    syncBridgeEdge()
    const stats = world.stats, sq = world.squad, pr = world.progress
    // 左上：补给 / 层数
    const endless = world.endless
    if (endless) {
      setText(supply.k, t('endless.layer', { n: endless.layer }))
      // 测试：Boss 还剩三成血、左上角却写着「下一层 5s」，像是马上要换场。Boss 在场时这里改写「首领交战」
      if (world.boss && world.boss.hp > 0) setText(supply.v, t('endless.boss_on'))
      else setText(supply.v, t('endless.next', { s: Math.max(0, Math.ceil(endless.layerLen - endless.layerT)) }))
      show(supply.el, true)
    } else if (world.gates) {
      setText(supply.k, t('ui.hud.supply', { n: world.gates.index + 1, total: world.gates.total }))
      setText(supply.v, Math.max(0, world.gates.resolveT - world.time).toFixed(1) + 's')
      show(supply.el, true)
    } else {
      let next = -1
      for (let i = 0; i < GATE.times.length; i++) if (GATE.times[i] > world.time) { next = i; break }
      if (next >= 0) { setText(supply.k, t('ui.hud.supply_next')); setText(supply.v, Math.ceil(GATE.times[next] - world.time) + 's') }
      show(supply.el, next >= 0)
    }
    // 技能
    const sig = world.powers.map(p => p.id).join()
    if (sig !== powersSig) { powersSig = sig; buildPowers(world) }
    for (let i = 0; i < powers.length; i++) {
      const o = powers[i], p = world.powers[i]
      if (!p) continue
      const active = p.activeUntil > world.time
      setCls(o.el, 'ready', p.ready); setCls(o.el, 'active', active); setCls(o.el, 'aiming', p.aiming)
      setText(o.cd, p.charges > 0 ? '' : Math.ceil(p.cd))
      const pips = o.pips.children
      for (let k = 0; k < pips.length; k++) setCls(pips[k], 'on', k < p.charges)
    }
    // 伙伴
    const c = world.companion
    show(comp.el, !!c)
    if (c) {
      setText(comp.name, c.name || t(c.nameKey || 'companion.name')); setText(comp.form, t(c.formKey))
      setVar(comp.bar, '--p', c.xpNext ? clamp01((c.xp - c.xpPrev) / Math.max(1, c.xpNext - c.xpPrev)).toFixed(3) : '1')
    }
    // 任务行
    setText(mission.label, t(world.mission.label))
    // 歼敌速度
    setText(rate.v, Math.round(stats.killRate))
    setText(xp.rate, Math.round(stats.killRate))
    setVar(rate.bar, '--p', clamp01(stats.killRate / Math.max(300, stats.peakKillRate)).toFixed(3))
    setText(rate.combo, 'x' + (stats.comboMult || 1).toFixed(2))
    setVar(rate.cbar, '--p', clamp01(((stats.comboMult || 1) - 1) / 0.2).toFixed(3))
    // 晶能 / 卡
    const e = Math.floor(world.energy)
    if (e !== energy.shown) { energy.shown = e; setText(energy.v, fmtInt(e)) }
    const wc = world.cards
    if (wc) for (let i = 0; i < wc.length; i++) {
      const c2 = cards[i], w = wc[i]
      setText(c2.cost, w.cost)
      // 竖屏卡条一排横滑：后面几张解锁时多半在屏外，自动滑过去让玩家看见「新卡到了」
      if (c2._unl === false && w.unlocked && ctx.mobile()) revealCard(c2)
      c2._unl = !!w.unlocked
      setCls(c2.el, 'locked', !w.unlocked); setCls(c2.el, 'poor', w.unlocked && !w.affordable); setCls(c2.el, 'cool', w.unlocked && w.cdLeft > 0)
      setCls(c2.el, 'rdy', w.ready)
      setText(c2.cdT, w.unlocked && w.cdLeft > 0 ? Math.ceil(w.cdLeft) : '')
      if (selected === c2.kind && !w.unlocked) select(null)
    }
    // 药丸
    const mods = pr.modules
    let psig = ''
    for (const id in mods) psig += id + mods[id] + ','
    psig += pr.combos.join() + '|' + pr.heroics.join() + '|' + (ctx.mobile() ? 'm' : 'd')
    if (psig !== pillsSig) { pillsSig = psig; buildPills(pr) }
    // 突变
    const msig = world.mutators.map(m => m.id + (m.active ? 1 : 0)).join()
    if (msig !== mutSig) {
      // 指挥官名字旁边那排小红图标 = 本局开的突变因子：前面挂一个「突变」字样，悬停 / 长按看具体效果
      mutSig = msig; clear(mutEl)
      if (world.mutators.length) {
        const k = h('span', 'mut-k', t('ui.mut.label'))
        k.title = t('ui.mut.icons_tip')
        ctx.tip(k, () => ({ title: t('ui.menu.mutators'), body: world.mutators.map(m => t(m.nameKey) + ': ' + mutEffect(t, m.id)).join('\n'), meta: t('ui.mut.label') }))
        mutEl.appendChild(k)
      }
      for (const m of world.mutators) {
        const chip = h('span', 'mut' + (m.active ? ' on' : ''), icon(MUTATOR_ICON[m.id] || 'mutation'))
        const st = t(m.active ? 'ui.mut.on' : 'ui.mut.pending')
        chip.title = t(m.nameKey) + ' · ' + st + ' — ' + mutEffect(t, m.id)
        chip.setAttribute('aria-label', chip.title)
        ctx.tip(chip, () => ({ title: t(m.nameKey), body: mutEffect(t, m.id), meta: st }))
        mutEl.appendChild(chip)
      }
      mutEl.hidden = !world.mutators.length
    }
    // 经验
    setText(xp.lv, t('ui.hud.level', { n: pr.level }))
    setText(xp.txt, t('ui.hud.xp', { xp: fmtInt(pr.xp), next: fmtInt(pr.xpNext) }))
    // 控制台
    setText(st.kills, fmtInt(stats.kills))
    const overtime = !endless && !!world.mission.overtime
    if (overtime && !wasOvertime) banners.pushBanner({ eyebrow: t('ui.hud.overtime'), title: t('ui.bn.overtime'), ic: 'stopwatch', tone: 'red', ms: 2200 })
    wasOvertime = overtime
    setText(st.timeK, t(endless ? 'ui.hud.layer_time' : overtime ? 'ui.hud.overtime' : 'ui.hud.mission_time'))
    setText(st.time, fmtTime(world.mission.timeLeft))
    setCls(st.time, 'warn', !endless && (overtime || world.mission.timeLeft < 20))
    setCls(st.timeK, 'warn', overtime)
    const lp = world.line.hp / world.line.hpMax
    setText(st.line, Math.round(lp * 100) + '%'); setCls(st.line, 'warn', lp < 0.35)
    const fences = world.fences
    if (fences) for (let i = 0; i < fencePips.length; i++) setCls(fencePips[i], 'on', !!fences[i])
    mm.draw(world)
    // 中
    const cmd = world.opts ? world.opts.commander : 'none'
    const lead = cmd !== 'none' ? 'commander.' + cmd : 'unit.' + (pr.focus || 'rifle')
    setPortrait(ctx.portraits, mid.pt, lead, cmd !== 'none' ? COMMANDER_ICON[cmd] : unitIcon(pr.focus || 'rifle'))
    setText(mid.name, t(`commander.${cmd}.name`))
    const counts = sq.counts, free = sq.freeCounts || {}, caps = sq.caps
    let inf = 0, art = 0, hv = 0
    for (const k of UNIT_KINDS) {
      const n = counts[k] || 0, cls = CLS_OF(k)
      if (cls === 'infantry') inf += n; else if (cls === 'artillery') art += n; else if (cls === 'heavy') hv += n
      const cell = cells[k], dep = (stats.deployed && stats.deployed[k]) || 0
      show(cell.el, dep > 0 || n > 0)
      setText(cell.n, n); setCls(cell.el, 'none', n === 0)
    }
    setText(cnt.infantry.v, pad2(inf)); setText(cnt.infantry.cap, '/' + caps.infantry)
    setText(cnt.artillery.v, pad2(art)); setText(cnt.artillery.cap, '/' + caps.artillery)
    setText(cnt.heavy.v, pad2(hv)); setText(cnt.heavy.cap, '/' + caps.heavy)
    setText(cnt.losses.v, stats.losses); setCls(cnt.losses.v, 'warn', stats.losses > 0)
    setText(mid.hpT, Math.round(clamp01(sq.hp / Math.max(1, sq.hpMax)) * 100) + '%')
    setText(mid.dmg, 'x' + (world.dmgMul || 1).toFixed(2))
    setCls(mid.od, 'on', pr.overdriveUntil > world.time)
    // Boss 名字
    const b = world.boss
    if (b && b.kind !== boss.kind) {
      boss.kind = b.kind; setText(boss.name, t(`boss.${b.kind}.name`)); setIcon(boss.ic, BOSS_ICON[b.kind] || 'boss_skull'); boss.lagV = b.hp / b.hpMax
      const ph = (b._def && b._def.phases) || []
      boss.marks.forEach((m, i) => { show(m, !!ph[i]); if (ph[i]) setVar(m, '--at', String(ph[i].at)) })
    }
    if (b) {
      setText(boss.hp, fmtInt(Math.max(0, b.hp)) + ' / ' + fmtInt(b.hpMax))
      const tag = b.state === 'stunned' ? 'ui.boss.stunned' : b.state === 'burrowed' ? 'ui.boss.burrowed' : b.kind === 'leviathan' && b.state === 'attack' ? 'ui.boss.exposed' : b.state === 'charge_windup' || b.state === 'charge' ? 'ui.boss.charge' : b.hardened ? 'ui.boss.hardened' : b.enraged ? 'ui.boss.enraged' : null
      boss.marks.forEach((m, i) => setCls(m, 'done', (b.phase || 0) > i))
      setText(boss.tag, tag ? t(tag) : ''); setCls(boss.tag, 'good', tag === 'ui.boss.stunned' || tag === 'ui.boss.exposed')
    } else boss.kind = null
    // 瞄准
    if (world.aiming) setText(aim.t, t('aim.timeout', { t: Math.max(0, world.aiming.timeLeft).toFixed(1) }))
  }

  // 右下角的改装条：一行小图标（等级 / ◆ 角标），悬停看名字和效果；放不下的收成「+N」，悬停列出剩下的名字。
  // 原来是带文字的药丸，后期 15~20 个会堆成四排压在桥面上
  function buildPills(pr) {
    clear(pillsEl)
    const items = []
    for (const id of pr.heroics) items.push({ cls: 'gold', ic: 'laurel', name: t(`heroic.${id}.name`), tip: { title: t(`heroic.${id}.name`), body: t(`heroic.${id}.desc`), meta: t('ui.bn.heroic') } })
    for (const id of pr.combos) items.push({ cls: 'elite', ic: 'chain_lightning', name: t(`combo.${id}.name`), tip: { title: t(`combo.${id}.name`), body: t(`combo.${id}.desc`), meta: t('ui.bn.combo') } })
    for (const id in pr.modules) {
      const m = MODULES[id], lv = pr.modules[id]
      if (!m || lv <= 0 || m.unlock) continue
      items.push({ cls: m.equip ? 'equip' : '', ic: moduleIcon(id, m.unit), name: t(m.nameKey), lv: m.equip ? '◆' : m.max > 1 ? roman(Math.min(lv, 10)) : '', tip: { title: t(m.nameKey) + (m.max > 1 && !m.equip ? ' ' + roman(Math.min(lv, 10)) : ''), body: t(m.descKey), meta: m.unit ? t(`unit.${m.unit}.name`) : t('tag.versatile') } })
    }
    if (ctx.mobile() || !items.length) return
    const max = 9                                  // 11 个时左端顶到「铲除」键：留出间隙
    pillsEl.appendChild(h('span', 'pill-k', t('ui.hud.mods', { n: items.length })))
    items.slice(0, max).forEach(it => {
      const p = h('span', 'mchip ' + it.cls, icon(it.ic), it.lv ? h('b', '', it.lv) : null)
      p.setAttribute('aria-label', it.name)
      ctx.tip(p, () => it.tip)
      pillsEl.appendChild(p)
    })
    if (items.length > max) {
      const rest = items.slice(max)
      const more = h('span', 'mchip more', '+' + rest.length)
      ctx.tip(more, () => ({ title: t('ui.hud.mods_more', { n: rest.length }), body: rest.map(x => x.name + (x.lv ? ' ' + x.lv : '')).join(' · '), meta: 'Tab' }))
      pillsEl.appendChild(more)
    }
  }

  function update(world, now) {
    lastWorld = world
    // ---- 每帧：条形
    const pr = world.progress
    setVar(xp.f, '--p', clamp01((pr.xp - pr.xpPrev) / Math.max(1, pr.xpNext - pr.xpPrev)).toFixed(4))
    setVar(mid.hpF, '--p', clamp01(world.squad.hp / Math.max(1, world.squad.hpMax)).toFixed(4))
    setVar(st.lineF, '--p', clamp01(world.line.hp / world.line.hpMax).toFixed(4))
    for (let i = 0; i < powers.length && i < world.powers.length; i++) {
      const p = world.powers[i]
      setVar(powers[i].el, '--cd', p.charges >= p.maxCharges ? '0' : clamp01(p.cd / Math.max(0.01, p.cdMax)).toFixed(3))
    }
    const wc = world.cards
    if (wc) for (let i = 0; i < wc.length; i++) setVar(cards[i].el, '--cd', wc[i].cdLeft > 0 ? clamp01(wc[i].cdLeft / Math.max(0.01, wc[i].cd)).toFixed(3) : '0')
    // Boss 血条：实条立刻到位，拖影慢慢追
    const b = world.boss
    show(boss.el, !!b)
    if (b) {
      const p = clamp01(b.hp / b.hpMax)
      if (boss.lagV < p) boss.lagV = p
      boss.lagV += (p - boss.lagV) * 0.06
      setVar(boss.f, '--p', p.toFixed(4)); setVar(boss.lag, '--p', boss.lagV.toFixed(4))
      setCls(boss.el, 'stun', b.state === 'stunned' || (b.kind === 'leviathan' && b.state === 'attack'))
      setCls(boss.el, 'hard', !!b.hardened); setCls(boss.el, 'rage', !!b.enraged)
    }
    // 门
    const gs = world.gates
    if (gs) {
      if (gates.key !== gs.index) showGates(gs)
      const p = clamp01((gs.z - GATE.spawnZ) / (GATE.resolveZ - GATE.spawnZ))
      setVar(gates.el, '--p', p.toFixed(3))
      const left = world.squad.x < 0
      setCls(gates.sides.left.el, 'pick', left); setCls(gates.sides.right.el, 'pick', !left)
    } else if (!gates.el.hidden && (gates.until === 0 || now > gates.until)) { gates.el.hidden = true; gates.key = -1 }
    // 瞄准
    show(aim.el, !!world.aiming)
    if (world.aiming) setVar(aim.bar, '--p', clamp01(world.aiming.timeLeft / Math.max(0.01, world.aiming.timeout)).toFixed(3))
    // 晶能跳字
    if (energy.popUntil && now > energy.popUntil) { energy.popUntil = 0; energy.popSum = 0; energy.pop.classList.remove('in') }
    // ---- 10Hz：文本
    if (now - lastSlow >= 100) { lastSlow = now; slow(world) }
  }

  // ---- 事件回调（banners.consume 转过来的）
  function onEnergy(e, pushOrb) {
    const now = performance.now()
    if (e.amount >= 1) {
      if (e.source !== 'refund') pushOrb(e.x, e.z, energy.ic)
      energy.popSum += e.amount
      setText(energy.pop, '+' + Math.round(energy.popSum))
      energy.popUntil = now + 900
      energy.pop.classList.remove('in'); void getComputedStyle(energy.pop).opacity; energy.pop.classList.add('in')
      energy.el.classList.remove('bump'); void getComputedStyle(energy.el).opacity; energy.el.classList.add('bump')
    }
  }
  function onPlaceFail(e) {
    const c = cards.find(k => k.kind === e.kind)
    if (c && e.reason !== 'kind') flashCard(c, e.reason)
  }
  function onDevicePlace() { if (selected && selected !== 'remove') select(null) }
  function onGateSpawn() {}
  function onGateResolve(e) {
    gates.el.classList.add(e.side === 'left' ? 'done-left' : 'done-right')
    gates.until = performance.now() + 900
  }

  function reset() {
    select(null, true); powersSig = null; pillsSig = null; mutSig = null; gates.key = -1; gates.el.hidden = true
    cardsWrap.scrollLeft = 0; for (const c of cards) c._unl = undefined; requestAnimationFrame(syncEnd)
    boss.kind = null; boss.el.hidden = true; energy.shown = -1; lastSlow = 0; lastWorld = null
  }

  /** 键盘 1~8 / X：选卡 */
  function keySelect(key) {
    const c = cards.find(k => k.key === key)
    if (c) toggle(c, lastWorld)
    return !!c
  }

  return { el, update, relabel, reset, onEnergy, onPlaceFail, onDevicePlace, onGateSpawn, onGateResolve, keySelect, select, selected: () => selected }
}
