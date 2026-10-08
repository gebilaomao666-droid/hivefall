// 小界面：暂停 / 设置 / 加载 / 本机榜 / 勋章 / 每日挑战 / 横屏提示。
import { h, icon, clear, button, portrait, fmtInt } from './dom.js'
import { COMMANDER_ICON, MUTATOR_ICON, ACH_ICON } from './icons.js'
import { boardTable } from './result.js'
import { ACHIEVEMENTS } from '../data/achievements.js'
import { CREDIT_FILES, parseCcBy, mergeCcBy, parseIconAuthors } from './credits.js'

const VOLUMES = ['master', 'music', 'weapons', 'swarm', 'voice', 'ui']
const DEFAULT_VOL = { master: 0.8, music: 0.6, weapons: 0.8, swarm: 0.8, voice: 0.9, ui: 0.7 }

function shell(cls, eyebrow) {
  const el = h('div', 'ov ' + cls)
  const panel = h('div', 'dlg pn')
  el.appendChild(panel); el.hidden = true
  return { el, panel, eyebrow }
}
const replay = el => { el.classList.remove('in'); void el.offsetWidth; el.classList.add('in') }

// ------------------------------------------------------------------ 暂停
export function createPause(ctx) {
  const { t, callbacks } = ctx
  const s = shell('pause')
  let world = null
  function build() {
    clear(s.panel)
    const endless = world && world.phase === 'endless'
    s.panel.append(
      h('div', 'eb', h('i', 'dot'), 'OPERATION PAUSED'),
      h('h1', 'ov-title', t('ui.pause.title')),
      h('p', 'dlg-text', t('ui.pause.text')),
      world ? h('div', 'dlg-stats',
        h('div', '', h('span', 'big-k', t('ui.hud.kills')), h('b', '', fmtInt(world.stats.kills))),
        h('div', '', h('span', 'big-k', t('ui.hud.level', { n: '' }).trim()), h('b', '', String(world.progress.level))),
        h('div', '', h('span', 'big-k', t('ui.hud.line')), h('b', '', Math.round(world.line.hp / world.line.hpMax * 100) + '%')),
        endless ? h('div', '', h('span', 'big-k', t('big.layer')), h('b', '', String(world.endless.layer))) : null) : null,
      h('div', 'dlg-btns',
        button('cta', () => ctx.close(), h('span', 'cta-t', t('ui.pause.resume')), h('kbd', '', 'Space')),
        button('b2', () => ctx.open('squad'), icon('squad'), t('ui.pause.squad'), h('kbd', '', 'Tab')),
        button('b2', () => ctx.open('settings'), icon('settings'), t('ui.settings.title')),
        // 战役里也能撤：放弃本局、按失败结算（成绩照记）。点一下先变成「再点一次确认」，免得手滑把一局扔了
        world ? retreatBtn(endless) : null,
        button('b2', () => callbacks.home && callbacks.home(), icon('home'), t('ui.res.home'))))
  }
  function retreatBtn(endless) {
    let armed = false, timer = 0
    const label = h('span', '', t(endless ? 'ui.pause.retreat' : 'ui.pause.abandon'))
    const note = h('span', 'b2-note', t(endless ? 'ui.pause.retreat_note' : 'ui.pause.abandon_note'))
    const b = button('b2 warn', () => {
      if (!armed) {
        armed = true; label.textContent = t('ui.pause.confirm'); b.classList.add('armed')
        clearTimeout(timer); timer = setTimeout(() => { armed = false; label.textContent = t(endless ? 'ui.pause.retreat' : 'ui.pause.abandon'); b.classList.remove('armed') }, 3000)
        return
      }
      clearTimeout(timer)
      if (callbacks.retreat) callbacks.retreat()
    }, icon('exit'), label, note)
    return b
  }
  return { el: s.el, show(w) { world = w; build(); s.el.hidden = false; replay(s.el) }, hide() { s.el.hidden = true }, relabel() { if (!s.el.hidden) build() } }
}

// ------------------------------------------------------------------ 设置
export function createSettings(ctx) {
  const { t, callbacks } = ctx
  const s = shell('settings')
  function build() {
    clear(s.panel)
    const st = ctx.settings()
    if (!st.volume) st.volume = Object.assign({}, DEFAULT_VOL)
    const seg = (cur, opts, on) => h('div', 'seg pn', ...opts.map(([v, label]) => button('seg-b' + (cur === v ? ' on' : ''), () => { on(v); build() }, label)))
    const vols = h('div', 'vols')
    for (const ch of VOLUMES) {
      const val = h('b', 'vol-v', Math.round(st.volume[ch] * 100))
      const inp = h('input', 'rng')
      inp.type = 'range'; inp.min = '0'; inp.max = '100'; inp.step = '1'; inp.value = String(Math.round(st.volume[ch] * 100))
      inp.style.setProperty('--p', st.volume[ch])
      inp.addEventListener('input', () => {
        const v = +inp.value / 100
        st.volume[ch] = v; val.textContent = String(Math.round(v * 100)); inp.style.setProperty('--p', v)
        callbacks.setVolume && callbacks.setVolume(ch, v)
      })
      vols.appendChild(h('label', 'vol' + (ch === 'master' ? ' master' : ''), h('span', 'vol-k', t('ui.vol.' + ch)), inp, val))
    }
    s.panel.append(
      h('div', 'dlg-head', h('div', '', h('div', 'eb', h('i', 'dot'), 'SYSTEM CONFIG'), h('h1', 'ov-title', t('ui.settings.title'))), button('sq pn', () => ctx.close(), icon('cancel'), h('kbd', '', 'Esc'))),
      h('div', 'set-row', h('span', 'opt-k', t('ui.hud.quality')), seg(st.quality, [['high', t('ui.q.high')], ['mid', t('ui.q.mid')], ['low', t('ui.q.low')]], v => { st.quality = v; callbacks.setQuality && callbacks.setQuality(v) }), h('span', 'opt-note', t('ui.settings.quality.note'))),
      h('div', 'set-row', h('span', 'opt-k', t('ui.settings.lang')), seg(ctx.lang(), [['zh', '中文'], ['en', 'English']], v => ctx.changeLang(v))),
      h('div', 'sec-h', t('ui.settings.audio'),
        h('span', 'sec-note',
          button('chk pn' + (st.muted ? ' on' : ''), () => { st.muted = !st.muted; callbacks.setMuted && callbacks.setMuted(st.muted); build() }, h('i', 'chk-box', icon('check')), t('ui.settings.mute')))),
      vols,
      h('div', 'dlg-btns row',
        button('b2', () => {
          Object.assign(st.volume, DEFAULT_VOL); st.muted = false
          for (const ch of VOLUMES) callbacks.setVolume && callbacks.setVolume(ch, st.volume[ch])
          callbacks.setMuted && callbacks.setMuted(false); build()
        }, icon('restart'), t('ui.settings.reset')),
        button('b2', () => callbacks.fullscreen && callbacks.fullscreen(), icon('fullscreen'), t('ui.settings.fullscreen')),
        button('cta sm', () => ctx.close(), h('span', 'cta-t', t('ui.ok')))),
      h('div', 'dlg-credit-row', h('p', 'dlg-credit', t('ui.settings.credits')), button('b2 sm', () => ctx.open('credits'), icon('info'), t('credits.title'))))
  }
  return { el: s.el, show() { build(); s.el.hidden = false; replay(s.el) }, hide() { s.el.hidden = true }, relabel() { if (!s.el.hidden) build() } }
}

// ------------------------------------------------------------------ 制作名单
// 固定部分（原创声明 / 引擎 / 字体 / AI 模型说明 / CC0 致谢）写在文案里；CC BY 3.0 的模型作者逐条从各 CREDITS.md 现读现抽，
// 图标作者也从 assets/ui/CREDITS.md 读——素材目录里加一条署名，这里跟着多一条
const CREDITS_BASE = new URL('../../assets/', import.meta.url).href
const FONTS = [['Orbitron', 'Matt McInerney'], ['Oxanium', 'Severin Meyer'], ['Rajdhani', 'Indian Type Foundry'], ['Chakra Petch', 'Cadson Demak'], ['Share Tech Mono', 'Carrois Apostrophe'], ['站酷庆科黄油体 ZCOOL QingKe HuangYou', 'ZCOOL / 郑庆科'], ['Noto Sans SC', 'Google / Adobe']]
let creditCache = null
function loadCredits() {
  if (!creditCache) {
    creditCache = Promise.all(CREDIT_FILES.map(k => fetch(CREDITS_BASE + k + '/CREDITS.md').then(r => (r.ok ? r.text() : '')).catch(() => '')))
      .then(texts => {
        const by = {}; CREDIT_FILES.forEach((k, i) => { by[k] = texts[i] })
        const audio = new Set()
        for (const l of (by.audio || '').split(/\r?\n/)) {
          if (!/^\|/.test(l) || /^\|[\s:|-]+\|$/.test(l.trim())) continue
          const c = l.replace(/^\||\|$/g, '').split('|').map(x => x.trim())
          if (c[1] && c[1] !== 'Author' && !/HIVEFALL/.test(c[1])) audio.add(c[1])
        }
        return { ccby: mergeCcBy(CREDIT_FILES.map(k => parseCcBy(by[k]))), icons: parseIconAuthors(by.ui), audio: [...audio], ok: texts.some(Boolean) }
      })
  }
  return creditCache
}
const link = (href, text) => { const a = h('a', 'cr-a', text || href); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a }

export function createCredits(ctx) {
  const { t } = ctx
  const s = shell('creditsov')
  let data = null, loading = false
  function build() {
    clear(s.panel)
    const sec = (title, ...kids) => h('section', 'cr-sec', h('div', 'sec-h', title), ...kids)
    const p = (...kids) => h('p', 'cr-p', ...kids)
    const body = h('div', 'cr-body',
      h('div', 'cr-lead pn', h('b', '', t('credits.original.title')), h('span', '', t('credits.original.body'))),
      sec(t('credits.team.title'), p(t('credits.team.body'))),
      sec(t('credits.engine.title'), p(t('credits.engine.body'), ' ', link('https://github.com/mrdoob/three.js', 'github.com/mrdoob/three.js'))),
      sec(t('credits.ai.title'), p(t('credits.ai.body'), ' ', link('https://3d.hunyuan.tencent.com/', '3d.hunyuan.tencent.com'))),
      sec(t('credits.icons.title'), p(t('credits.icons.body'), ' ', link('https://game-icons.net', 'game-icons.net'), ' · ', link('https://creativecommons.org/licenses/by/3.0/', 'CC BY 3.0')),
        data && data.icons.length ? h('div', 'cr-names', ...data.icons.map(n => h('span', '', n))) : null),
      sec(t('credits.ccby.title'), p(t('credits.ccby.body'), ' ', link('https://creativecommons.org/licenses/by/3.0/', 'CC BY 3.0')),
        data ? (data.ccby.length ? h('div', 'cr-by', ...data.ccby.map(g => h('div', 'cr-by-r', h('b', '', g.author), h('span', '', ...g.items.flatMap((it, i) => [i ? ' · ' : '', it.url ? link(it.url, it.name) : it.name])))))
          : p(t('credits.load_fail'))) : p(t('credits.loading'))),
      sec(t('credits.fonts.title'), p(t('credits.fonts.body')), h('div', 'cr-by', ...FONTS.map(([f, a]) => h('div', 'cr-by-r', h('b', '', f), h('span', '', a))))),
      sec(t('credits.cc0.title'), p(t('credits.cc0.body')),
        data && data.audio.length ? h('div', 'cr-by', h('div', 'cr-by-r', h('b', '', t('credits.cc0.audio')), h('span', '', data.audio.join(' · ')))) : null),
      h('p', 'cr-foot', t('credits.foot')))
    s.panel.append(
      h('div', 'dlg-head', h('div', '', h('div', 'eb', h('i', 'dot'), 'CREDITS'), h('h1', 'ov-title', t('credits.title'))), button('sq pn', () => ctx.close(), icon('cancel'), h('kbd', '', 'Esc'))),
      body)
    if (!data && !loading) { loading = true; loadCredits().then(d => { data = d.ok ? d : { ccby: [], icons: [], audio: [] }; loading = false; if (!s.el.hidden) build() }) }
  }
  return { el: s.el, show() { build(); s.el.hidden = false; replay(s.el) }, hide() { s.el.hidden = true }, relabel() { if (!s.el.hidden) build() } }
}

// ------------------------------------------------------------------ 本机榜
export function createBoard(ctx) {
  const { t } = ctx
  const s = shell('boardov')
  function build() {
    clear(s.panel)
    const save = ctx.save() || {}, best = save.best || {}, st = save.stats || {}
    s.panel.append(
      h('div', 'dlg-head', h('div', '', h('div', 'eb', h('i', 'dot'), 'LOCAL RECORDS'), h('h1', 'ov-title', t('board.title'))), button('sq pn', () => ctx.close(), icon('cancel'), h('kbd', '', 'Esc'))),
      h('div', 'dlg-stats',
        h('div', '', h('span', 'big-k', t('ui.menu.best')), h('b', '', fmtInt(best.score || 0))),
        h('div', '', h('span', 'big-k', t('big.layer')), h('b', '', String(best.layer || 0))),
        h('div', '', h('span', 'big-k', t('ui.board.runs')), h('b', '', fmtInt(st.runs || 0))),
        h('div', '', h('span', 'big-k', t('ui.board.total')), h('b', '', fmtInt(st.kills || 0)))),
      boardTable(t, save.board, 0))
  }
  return { el: s.el, show() { build(); s.el.hidden = false; replay(s.el) }, hide() { s.el.hidden = true }, relabel() { if (!s.el.hidden) build() } }
}

// ------------------------------------------------------------------ 勋章
export function createAchievements(ctx) {
  const { t } = ctx
  const s = shell('achov')
  function build() {
    clear(s.panel)
    const got = (ctx.save() || {}).achievements || {}
    const n = ACHIEVEMENTS.filter(a => got[a.id]).length
    s.panel.append(
      h('div', 'dlg-head', h('div', '', h('div', 'eb', h('i', 'dot'), 'SERVICE RECORD'), h('h1', 'ov-title', t('ach.title'), h('span', 'ov-count', n + ' / ' + ACHIEVEMENTS.length))), button('sq pn', () => ctx.close(), icon('cancel'), h('kbd', '', 'Esc'))),
      h('p', 'dlg-text', t('ui.ach.note')),
      h('div', 'ach-grid', ...ACHIEVEMENTS.map(a => h('div', 'ach pn' + (got[a.id] ? ' on' : ''), icon(got[a.id] ? ACH_ICON : 'lock'), h('div', '', h('b', '', t(a.nameKey)), h('span', '', t(a.descKey)))))))
  }
  return { el: s.el, show() { build(); s.el.hidden = false; replay(s.el) }, hide() { s.el.hidden = true }, relabel() { if (!s.el.hidden) build() } }
}

// ------------------------------------------------------------------ 每日挑战
export function createDaily(ctx) {
  const { t, callbacks } = ctx
  const s = shell('dailyov')
  let data = null
  function build() {
    clear(s.panel)
    const d = data || {}, save = ctx.save() || {}
    const best = d.dateKey && save.daily && save.daily.best ? save.daily.best[d.dateKey] : null
    s.panel.append(
      h('div', 'dlg-head', h('div', '', h('div', 'eb', h('i', 'dot'), 'DAILY ORDER // ' + (d.dateKey || '----')), h('h1', 'ov-title', t('daily.title'))), button('sq pn', () => ctx.close(), icon('cancel'), h('kbd', '', 'Esc'))),
      h('p', 'dlg-text', t('daily.desc')),
      d.commander ? h('div', 'daily-cfg',
        h('div', 'cmd-info pn', portrait(ctx.portraits, 'commander.' + d.commander, COMMANDER_ICON[d.commander], 'cmd-info-pt'),
          h('div', 'cmd-info-body', h('div', 'cmd-title', h('b', '', t(`commander.${d.commander}.name`)), h('span', '', t(`commander.${d.commander}.title`))), h('div', 'cmd-desc', t(`commander.${d.commander}.desc`)))),
        ...(d.mutators || []).map(id => h('div', 'news red', icon(MUTATOR_ICON[id] || 'mutation'), h('div', '', h('b', '', t(`mutator.${id}.name`)), h('span', '', t(`mutator.${id}.desc`)))))) : null,
      h('div', 'dlg-stats', h('div', '', h('span', 'big-k', t('ui.daily.best')), h('b', '', best ? fmtInt(best.score) : '-')), h('div', '', h('span', 'big-k', t('ui.daily.days')), h('b', '', String((save.stats && save.stats.dailyDays) || 0)))),
      h('div', 'dlg-btns', button('cta', () => callbacks.start && callbacks.start({ daily: true, dateKey: d.dateKey }), h('span', 'cta-t', t('ui.daily.start')))))
  }
  return { el: s.el, show(d) { if (d) data = d; build(); s.el.hidden = false; replay(s.el) }, hide() { s.el.hidden = true }, relabel() { if (!s.el.hidden) build() } }
}

// ------------------------------------------------------------------ 加载页
export function createLoading(ctx) {
  const { t } = ctx
  const bar = h('i', 'bar-f'), txt = h('span', 'load-txt'), pct = h('b', 'load-pct', '0%'), tip = h('p', 'load-tip')
  const el = h('div', 'loading',
    h('div', 'load-box',
      h('div', 'brand-mark big', h('i'), h('i'), h('i')),
      h('b', 'brand-name', 'HIVEFALL'), h('span', 'brand-sub', ''),
      h('div', 'load-row', txt, pct), h('div', 'bar am', bar), tip))
  const sub = el.querySelector('.brand-sub')
  el.hidden = true
  let d = {}
  function apply() {
    const p = Math.max(0, Math.min(1, d.progress || 0))
    bar.style.setProperty('--p', p.toFixed(3)); pct.textContent = Math.round(p * 100) + '%'
    txt.textContent = d.text || t(d.textKey || 'ui.load.text')
    sub.textContent = t('ui.brand.full')
    tip.textContent = t('ui.load.tip.' + ((d.tip | 0) % 4))
  }
  return { el, show(data) { d = Object.assign(d, data || {}); apply(); el.hidden = false }, hide() { el.hidden = true }, relabel: apply }
}

// ------------------------------------------------------------------ 横屏提示
export function createRotate(ctx) {
  const { t } = ctx
  const a = h('b', ''), b = h('span', '')
  const el = h('div', 'rotate', icon('cycle'), a, b)
  el.hidden = true
  const relabel = () => { a.textContent = t('ui.rotate.title'); b.textContent = t('ui.rotate.text') }
  relabel()
  return { el, relabel }
}
