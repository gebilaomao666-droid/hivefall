// 事件驱动的那些「一闪而过」的东西：左下事件卡片、中央横幅、通讯台词、大波预告、侧翼警告、飘字、晶能光点。
// 全部池化：节点建一次，之后只换内容和 class。
import { h, icon, setIcon, portrait, setPortrait, setText, setCls, setVar, show, fmtInt, splitTitle, clamp01, mutEffect } from './dom.js'
import { unitIcon, moduleIcon, gateIcon, enemyIcon, DEVICE_ICON, SPEAKER_ICON, MUTATOR_ICON, BOSS_ICON, CONTRACT_ICON } from './icons.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
export const roman = n => ROMAN[n] || String(n)

export function createBanners(ctx) {
  const { t } = ctx
  const now = () => performance.now()

  // ------------------------------------------------------------ 事件卡片（左下）
  const CARD_N = 4, CARD_LIFE = 3800
  const cardsEl = h('div', 'ev-stack')
  const cards = []
  for (let i = 0; i < CARD_N; i++) {
    const c = { el: h('div', 'ev pn'), until: 0, born: 0 }
    c.pt = portrait(ctx.portraits, '', 'info', 'ev-pt')
    c.eyebrow = h('div', 'ev-eb')
    c.title = h('div', 'ev-title')
    c.sub = h('div', 'ev-sub')
    c.el.append(c.pt, h('div', 'ev-body', c.eyebrow, c.title, c.sub))
    c.el.hidden = true
    cards.push(c); cardsEl.appendChild(c.el)
  }
  const throttle = {}
  function pushCard({ eyebrow, title, sub = '', ic = 'info', pt = '', tone = '', key = null, gap = 0 }) {
    const n = now()
    if (key) { if (throttle[key] && n - throttle[key] < gap) return; throttle[key] = n }
    // 找一张空的，没有就顶掉最老的
    let c = null
    for (const k of cards) if (k.until <= n) { c = k; break }
    if (!c) { c = cards[0]; for (const k of cards) if (k.born < c.born) c = k }
    c.born = n; c.until = n + CARD_LIFE
    setPortrait(ctx.portraits, c.pt, pt, ic)
    setText(c.eyebrow, eyebrow); setText(c.title, title); setText(c.sub, sub)
    for (const k of cards) if (k !== c) k.el.classList.remove('newest')   // 竖屏只露最新一张（DOM 顺序 ≠ 新旧顺序，靠这个标记）
    c.el.className = 'ev pn newest' + (tone ? ' ' + tone : '')
    c.el.hidden = false
    c.el.style.order = String(Math.round(n))        // 新的在下面
    // 重放进场动画：只强制算一次样式（getComputedStyle），不再用 offsetWidth 强制整页重排——第一次弹出时那一下要 10~30ms
    c.el.classList.remove('in'); void getComputedStyle(c.el).opacity; c.el.classList.add('in')
  }

  // ------------------------------------------------------------ 中央横幅（排队，一次一条）
  const bn = { el: h('div', 'bn'), queue: [], until: 0, showing: false }
  bn.ic = icon('laurel', 'bn-ic')
  bn.eb = h('div', 'bn-eb'); bn.title = h('div', 'bn-title'); bn.sub = h('div', 'bn-sub')
  bn.el.append(h('div', 'bn-line'), bn.ic, bn.eb, bn.title, bn.sub, h('div', 'bn-line'))
  bn.el.hidden = true
  function pushBanner(b) { if (bn.queue.length < 4) bn.queue.push(b) }
  function tickBanner(n, world) {
    if (bn.showing && (n >= bn.until || (bn.boss && !(world && world.boss)))) { bn.showing = false; bn.el.hidden = true }   // Boss 的阶段横幅：Boss 一没（打死 / 换层）就收，不然血条一收它会变回大横幅压在桥上
    // 排队排到时 Boss 已经不在了（打死 / 换层）的阶段横幅直接丢掉：Boss 血条一收，它会变回大横幅压在桥上
    while (!bn.showing && bn.queue.length && bn.queue[0].boss && !(world && world.boss)) bn.queue.shift()
    if (!bn.showing && bn.queue.length) {
      const b = bn.queue.shift()
      setIcon(bn.ic, b.ic || 'laurel'); setText(bn.eb, b.eyebrow || ''); setText(bn.title, b.title || ''); setText(bn.sub, b.sub || '')
      bn.el.className = 'bn ' + (b.tone || '')
      bn.el.hidden = false; bn.showing = true; bn.until = n + (b.ms || 2400); bn.boss = !!b.boss
      bn.el.classList.remove('in'); void getComputedStyle(bn.el).opacity; bn.el.classList.add('in')
    }
  }

  // ------------------------------------------------------------ 通讯台词条
  const cm = { el: h('div', 'comms pn'), queue: [], until: 0, showing: false }
  cm.pt = portrait(ctx.portraits, 'speaker.ops', 'radio', 'comms-pt')
  cm.who = h('div', 'comms-who'); cm.text = h('div', 'comms-text')
  cm.el.append(cm.pt, h('div', 'comms-body', h('div', 'comms-head', cm.who, h('span', 'comms-sig', h('i'), h('i'), h('i'), h('i'))), cm.text))
  cm.el.hidden = true
  function pushComms(speaker, textKey) { if (cm.queue.length < 3) cm.queue.push({ speaker: speaker || 'ops', textKey }) }
  function tickComms(n) {
    if (cm.showing && n >= cm.until) { cm.showing = false; cm.el.hidden = true }
    if (!cm.showing && cm.queue.length) {
      const c = cm.queue.shift()
      setPortrait(ctx.portraits, cm.pt, 'speaker.' + c.speaker, SPEAKER_ICON[c.speaker] || 'radio')
      setText(cm.who, t('comms.speaker.' + c.speaker)); setText(cm.text, t(c.textKey))
      cm.el.hidden = false; cm.showing = true; cm.until = n + 4600
      cm.el.classList.remove('in'); void getComputedStyle(cm.el).opacity; cm.el.classList.add('in')
    }
  }

  // ------------------------------------------------------------ 大波预告
  const hd = { el: h('div', 'herald pn'), key: null }
  hd.arrow = h('div', 'herald-dir', icon('arrow', 'a l'), icon('arrow', 'a c'), icon('arrow', 'a r'))
  hd.name = h('div', 'herald-name'); hd.comp = h('div', 'herald-comp'); hd.bar = h('i', 'herald-bar')
  hd.el.append(h('div', 'herald-tag', icon('hazard'), h('span', '', '')), h('div', 'herald-mid', hd.name, hd.comp), hd.arrow, hd.bar)
  hd.tag = hd.el.firstChild.lastChild
  hd.el.hidden = true
  function updateHerald(world) {
    const he = world.wave && world.wave.herald
    if (!he || world.time >= he.t1) { if (hd.key !== null) { hd.key = null; hd.el.hidden = true } return }
    if (hd.key !== he.t0) {
      hd.key = he.t0
      setText(hd.tag, t('herald.incoming'))
      setText(hd.name, t(he.nameKey))
      while (hd.comp.firstChild) hd.comp.removeChild(hd.comp.firstChild)
      // 只列数量最多的 4 种，排成一行：九种全列要占三行，正好盖在虫群涌出来的那一段桥面上；
      // 新虫种首秀（he.feature）排在第一个——它往往只有十几只，按数量排会被裂爪虫 / 脓爆虫挤到后面
      const top = he.comp.slice().sort((a, b) => (b.kind === he.feature) - (a.kind === he.feature) || b.count - a.count).slice(0, 4)
      for (const c of top) hd.comp.appendChild(h('span', 'herald-c', icon(enemyIcon(c.kind)), t(c.nameKey || `enemy.${c.kind}.name`), h('b', '', ' x' + fmtInt(c.count))))
      const lane = he.lane || 0
      hd.arrow.className = 'herald-dir ' + (he.side ? (he.side < 0 ? 'l' : 'r') : lane < -0.5 ? 'l' : lane > 0.5 ? 'r' : 'c')
      hd.el.hidden = false
      hd.el.classList.remove('in'); void getComputedStyle(hd.el).opacity; hd.el.classList.add('in')
    }
    setVar(hd.bar, '--p', clamp01((world.time - he.t0) / Math.max(0.01, he.t1 - he.t0)).toFixed(3))
  }

  // ------------------------------------------------------------ 侧翼警告
  const fl = { l: h('div', 'flank l'), r: h('div', 'flank r'), until: 0 }
  for (const side of [fl.l, fl.r]) { side.append(icon('hazard'), h('span', 'flank-t'), h('i', 'flank-ch')); side.hidden = true }
  function flank(side, ms) {
    const el = side < 0 ? fl.l : fl.r
    setText(el.children[1], t('flank.warn', { side: t(side < 0 ? 'flank.left' : 'flank.right') }))
    el.hidden = false; el._until = now() + ms
    el.classList.remove('in'); void getComputedStyle(el).opacity; el.classList.add('in')
  }

  // ------------------------------------------------------------ 飘字（只给 bigHit）
  const FL_N = 14
  const floatsEl = h('div', 'floats')
  const floats = []
  for (let i = 0; i < FL_N; i++) { const el = h('span', 'fl'); el.hidden = true; floats.push({ el, until: 0, x: 0, z: 0, dmg: 0, t0: 0 }); floatsEl.appendChild(el) }
  function pushFloat(x, z, dmg, noMerge = false, y = 1.2) {
    if (!ctx.project) return
    const n = now()
    // 合并：0.35 秒内、1.6 米内的算同一下（Boss 的左右轮流飘字不合并，否则会粘回同一侧）
    if (!noMerge) for (const f of floats) {
      if (f.until > n && n - f.t0 < 350 && Math.abs(f.x - x) < 1.6 && Math.abs(f.z - z) < 1.6) {
        f.dmg += dmg; setText(f.el, fmtInt(f.dmg)); setCls(f.el, 'crit', f.dmg >= 400); return
      }
    }
    let f = null
    for (const k of floats) if (k.until <= n) { f = k; break }
    if (!f) return                                   // 池满就不飘：宁可少也不糊屏
    const p = ctx.project(x, y, z)
    if (!p || p.visible === false) return
    const s = ctx.scale()
    if (p.y / s < 104) return                        // 桥的最远端投影在顶部 HUD（任务行 / 大波预告 / Boss 血条）那一条里：数字飘进去会和界面的字叠在一起
    f.x = x; f.z = z; f.dmg = dmg; f.t0 = n; f.until = n + 800
    f.el.style.left = (p.x / s).toFixed(1) + 'px'; f.el.style.top = (p.y / s).toFixed(1) + 'px'
    f.el._t = null; setText(f.el, fmtInt(dmg)); setCls(f.el, 'crit', dmg >= 400)
    f.el.hidden = false
    return f
    f.el.classList.remove('in'); void getComputedStyle(f.el).opacity; f.el.classList.add('in')
  }

  // ------------------------------------------------------------ 晶能光点（飞向计数器）
  const ORB_N = 10
  const orbs = []
  for (let i = 0; i < ORB_N; i++) { const el = h('i', 'orb'); el.hidden = true; orbs.push({ el, until: 0 }); floatsEl.appendChild(el) }
  function pushOrb(x, z, target) {
    if (!ctx.project || !ctx.energyOrbs || !target) return false
    const n = now()
    let o = null
    for (const k of orbs) if (k.until <= n) { o = k; break }
    if (!o) return false
    const p = ctx.project(x, 0.4, z)
    if (!p || p.visible === false) return false
    const s = ctx.scale(), r = target.getBoundingClientRect(), base = floatsEl.getBoundingClientRect()
    const x0 = p.x / s, y0 = p.y / s
    const x1 = (r.left + r.width / 2 - base.left) / s, y1 = (r.top + r.height / 2 - base.top) / s
    o.until = n + 620
    o.el.hidden = false
    o.el.style.left = x0.toFixed(1) + 'px'; o.el.style.top = y0.toFixed(1) + 'px'
    o.el.style.setProperty('--dx', (x1 - x0).toFixed(1) + 'px'); o.el.style.setProperty('--dy', (y1 - y0).toFixed(1) + 'px')
    o.el.classList.remove('in'); void getComputedStyle(o.el).opacity; o.el.classList.add('in')
    return true
  }

  // ------------------------------------------------------------ 事件 → 表现
  let floatBudget = 0
  let bossSide = 1, bossFl = null
  // Boss 模型的半宽 / 飘字高度（米，和渲染层的实际尺寸对上：碾压者已放大 1.4 倍）
  const BOSS_HALF = { ravager: 3.6, matriarch: 3.2, leviathan: 2.4 }, BOSS_TALL = { ravager: 5.5, matriarch: 5.0, leviathan: 5.0 }
  function consume(events, world, hud) {
    floatBudget = 3                                  // 每批最多新开 3 个飘字
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      switch (e.type) {
        case 'comms': pushComms(e.speaker, e.textKey); break
        case 'flankWarn': flank(e.side, (e.t || 1.6) * 1000 + 600); break
        case 'bigHit':
          if (e.boss) {
            // 打 Boss 的大数字：模拟层已按 0.7 秒节流并钉在它身前（e.boss），这里再左右轮流摊到侧前方，不压在 Boss 背上 / 正脸上
            // 测试：伤害飘字压在巢母本体上。改成：飘在 Boss 模型外沿再往外 1 米、身高以上（侧上方），
            // 而且限流——0.9 秒内的下一下并进上一个数字（不再新开），Boss 身边同时最多一个大数字
            const b = world && world.boss, half = b ? (BOSS_HALF[b.kind] || (b.radius || 2.4) + 1) : 3.4
            const n = now()
            if (bossFl && bossFl.until > n && n - bossFl.t0 < 900) { bossFl.dmg += e.dmg; setText(bossFl.el, fmtInt(bossFl.dmg)); setCls(bossFl.el, 'crit', bossFl.dmg >= 400); break }
            bossSide = -bossSide
            bossFl = pushFloat((b ? b.x : e.x) + bossSide * (half + 1.0), b ? b.z - 0.5 : e.z, e.dmg, true, BOSS_TALL[b ? b.kind : ''] || 4) || null
          } else if (floatBudget > 0) {
            // Boss 身上 / 紧挨着它的护卫挨的大数字不飘：Boss 身边只留它自己那一个（上面的限流），不然一圈数字照样糊在本体上
            const b = world && world.boss, half = b ? (BOSS_HALF[b.kind] || 3) : 0
            if (b && b.state !== 'burrowed' && Math.abs(e.x - b.x) < half + 1.5 && Math.abs(e.z - b.z) < half + 2.5) break
            floatBudget--; pushFloat(e.x, e.z, e.dmg)
          }
          break
        // bossHit 是每个模拟步的合并伤害（集火时几乎每帧一条）：不再出飘字——第 2 轮测试「Boss 背上常年压着 85 / 153」就是它；大数字只认上面的 bigHit{boss}
        case 'gateResolve': {
          const opt = e.fallback || e.option
          const [main, sub] = splitTitle(t(opt.titleKey, opt.params))
          const tags = (opt.tags || []).map(k => t('tag.' + k)).join(' · ')
          const desc = opt.params && opt.params.descKey ? t(opt.params.descKey) : ''
          pushCard({ eyebrow: t('ui.ev.gate'), title: main, sub: desc || [sub, tags].filter(Boolean).join(' · '), ic: gateIcon(opt), pt: opt.type === 'unit' ? 'unit.' + opt.unit : '', tone: opt.type === 'contract' ? 'gold' : '' })
          break
        }
        case 'cardPicked': {
          const c = e.card
          const lv = c.maxLevel > 1 && c.maxLevel < 90 ? ' ' + roman(c.level) : ''
          const val = c.from === 'off' || c.from === 'on' ? t('value.' + c.to) : `${c.from} -> ${c.to}`
          pushCard({ eyebrow: t(c.kind === 'ally' ? 'ally.vanguard.title' : 'ui.ev.card'), title: t(c.nameKey) + lv, sub: c.kind === 'ally' ? t(c.descKey) : val, ic: c.kind === 'ally' ? unitIcon(c.unit) : moduleIcon(c.moduleId, c.unit), tone: c.rarity === 'legendary' ? 'gold' : c.rarity === 'elite' ? 'elite' : '' })
          break
        }
        case 'deviceUnlock': pushCard({ eyebrow: t('ui.ev.unlock'), title: t(e.nameKey), sub: t(`device.${e.kind}.desc`), ic: DEVICE_ICON[e.kind] || 'unlock', tone: 'cyan' }); break
        case 'fence': pushCard({ eyebrow: t('ui.ev.fence'), title: t('device.fence.name'), sub: t('ui.ev.fence.sub', { lane: e.lane + 1, n: fmtInt(e.kills || 0) }), ic: 'electric', tone: 'cyan', key: 'fence', gap: 2500 }); break   // 几道电网同时触发时只报第一条：四张一模一样的卡会把左下角刷满
        case 'fenceRefill': pushCard({ eyebrow: t('ui.ev.refill'), title: t('device.fence.name'), ic: 'electric', tone: 'cyan' }); break
        case 'deviceDie': pushCard({ eyebrow: t('ui.ev.device_lost'), title: t(`device.${e.kind}.name`), sub: t('ui.ev.lane', { lane: e.lane + 1 }), ic: DEVICE_ICON[e.kind] || 'hazard', tone: 'red', key: 'deviceDie', gap: 3500 }); break
        case 'rankUp': if (e.rank >= 5) pushCard({ eyebrow: t('ui.ev.rank'), title: t(e.nameKey), sub: t(`unit.${e.unit}.name`), ic: e.rank >= 9 ? 'rank_3' : e.rank >= 7 ? 'rank_2' : 'rank_1', pt: 'unit.' + e.unit, key: 'rankUp', gap: 2500 }); break
        case 'boon': pushCard({ eyebrow: t('ui.ev.boon'), title: t(e.nameKey), sub: t(`boon.${e.id}.desc`), ic: e.cost ? 'hazard' : 'upgrade', tone: e.cost ? 'red' : '' }); break
        case 'mutator': pushCard({ eyebrow: t('ui.mut.on'), title: t(`mutator.${e.id}.name`), sub: mutEffect(t, e.id), ic: MUTATOR_ICON[e.id] || 'mutation', tone: 'red' }); break
        case 'podLand': pushCard({ eyebrow: t('ui.ev.contract'), title: t(`contract.${e.contract}.name`), sub: t('pod.land'), ic: CONTRACT_ICON[e.contract] || 'supply_crate', tone: 'gold' }); break
        case 'podOpen': pushCard({ eyebrow: t('ui.ev.contract'), title: t('pod.open', { name: t(`contract.${e.contract}.name`) }), ic: CONTRACT_ICON[e.contract] || 'supply_crate', tone: 'gold' }); break
        case 'podLost': pushCard({ eyebrow: t('ui.ev.contract'), title: t('pod.lost'), ic: 'supply_crate', tone: 'red' }); break
        case 'unitJoin':
          if (e.source === 'drop') pushCard({ eyebrow: t('ui.ev.drop'), title: t('gate.unit', { count: e.count, unitKey: `unit.${e.kind}.name` }), ic: unitIcon(e.kind), pt: 'unit.' + e.kind })
          else if (e.source === 'relief') pushCard({ eyebrow: t('ui.ev.relief'), title: t('gate.unit', { count: e.count, unitKey: `unit.${e.kind}.name` }), ic: unitIcon(e.kind), pt: 'unit.' + e.kind, tone: 'cyan' })   // 无尽每层开头补的人
          else if (e.source === 'rebuild') pushCard({ eyebrow: t('passive.rebuild.name'), title: t('gate.unit', { count: e.count, unitKey: `unit.${e.kind}.name` }), ic: 'cycle', key: 'rebuild', gap: 1500 })
          break
        case 'powerCast': if (e.mode === 'heal') pushCard({ eyebrow: t('ui.ev.drop'), title: t('tag.heal'), ic: 'medkit' }); break
        case 'companion':
          if (e.kind === 'evolve') pushBanner({ eyebrow: t('companion.title'), title: t(`companion.form.${e.form}`), sub: t(`companion.form.${e.form}.desc`), ic: 'drone', tone: 'cyan' })
          else if (e.kind === 'found') pushCard({ eyebrow: t('ui.ev.companion'), title: t('companion.title'), sub: t(`companion.form.${e.form}`), ic: 'drone', tone: 'cyan' })
          break
        case 'combo': pushBanner({ eyebrow: t('ui.bn.combo'), title: t(`combo.${e.id}.name`), sub: t(`combo.${e.id}.desc`), ic: 'chain_lightning', tone: 'elite' }); break
        case 'heroic': pushBanner({ eyebrow: t('ui.bn.heroic'), title: t(`heroic.${e.id}.name`), sub: t('heroic.banner', { squad: t(e.squadName) }), ic: 'laurel', tone: 'gold', ms: 3000 }); break
        case 'overdrive': pushBanner({ eyebrow: t('ui.bn.overdrive'), title: t('overdrive'), ic: 'fire_rate', tone: 'amber', ms: 1500 }); break
        case 'bossSpawn': pushBanner({ eyebrow: t('ui.bn.boss'), title: t(`boss.${e.kind}.name`), sub: t('ui.bn.boss.sub'), ic: BOSS_ICON[e.kind] || 'boss_skull', tone: 'red', ms: 2600 }); break
        case 'bossPhase': pushBanner({ eyebrow: t(`boss.${e.kind}.name`), title: t(e.textKey), sub: t(e.textKey + '.sub'), ic: e.harden ? 'shield_heavy' : 'damage_up', tone: 'red', ms: 2600, boss: true }); break   // 70% / 35% 血量换阶段
        case 'bossDie': pushBanner({ eyebrow: t('ui.bn.boss_down'), title: t(`boss.${e.kind}.name`), ic: 'skull_broken', tone: 'gold', ms: 2200 }); break
        case 'layer': if (e.n > 1) pushBanner({ eyebrow: t('phase.endless'), title: t('endless.layer', { n: e.n }), sub: t(`herald.deep.${e.mix}`) + ' · ' + t(`theme.${e.theme}.name`), ic: 'wave', tone: 'cyan', ms: 2000 }); break
        case 'ally': if (e.kind === 'vanguard') pushBanner({ eyebrow: t('ally.vanguard.title'), title: t('comms.vanguard'), ic: 'satellite', tone: 'cyan' }); break
        case 'energy': if (hud) hud.onEnergy(e, pushOrb); break
        case 'placeFail': if (hud) hud.onPlaceFail(e); break
        case 'devicePlace': if (hud) hud.onDevicePlace(e); break
        case 'gateSpawn': if (hud) hud.onGateSpawn(e); break
        default: break
      }
      if (e.type === 'gateResolve' && hud) hud.onGateResolve(e)
    }
  }

  function update(world, n) {
    tickBanner(n, world); tickComms(n)
    for (const c of cards) if (!c.el.hidden && c.until <= n) c.el.hidden = true
    for (const f of floats) if (!f.el.hidden && f.until <= n) f.el.hidden = true
    for (const o of orbs) if (!o.el.hidden && o.until <= n) o.el.hidden = true
    for (const s of [fl.l, fl.r]) if (!s.hidden && s._until <= n) s.hidden = true
    if (world) updateHerald(world)
  }

  function reset() {
    for (const c of cards) { c.el.hidden = true; c.until = 0 }
    for (const f of floats) { f.el.hidden = true; f.until = 0 }
    for (const o of orbs) { o.el.hidden = true; o.until = 0 }
    bn.queue.length = 0; bn.showing = false; bn.el.hidden = true
    cm.queue.length = 0; cm.showing = false; cm.el.hidden = true
    hd.key = null; hd.el.hidden = true; fl.l.hidden = true; fl.r.hidden = true
  }

  return { cardsEl, bannerEl: bn.el, commsEl: cm.el, heraldEl: hd.el, flankL: fl.l, flankR: fl.r, floatsEl, consume, update, reset, pushCard, pushBanner, pushComms }
}
