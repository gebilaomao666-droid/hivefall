// UI 层的小工具：建节点、图标、头像、带缓存的写入（值没变就不碰 DOM）。
const ASSET_BASE = new URL('../../assets/ui/', import.meta.url).href
let iconBase = ASSET_BASE + 'icons/'
export const setAssetBase = base => { iconBase = (base.endsWith('/') ? base : base + '/') + 'icons/' }
export const assetBase = () => ASSET_BASE

/** h('div', 'cls a b', child, [children], 'text') */
export function h(tag, cls, ...kids) {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  add(el, kids)
  return el
}
export function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue
    if (Array.isArray(k)) add(el, k)
    else el.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)))
  }
  return el
}
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el }

/** 单色图标：SVG 当 mask，颜色跟 currentColor */
export function icon(name, cls) {
  const el = document.createElement('i')
  el.className = cls ? 'ic ' + cls : 'ic'
  setIcon(el, name)
  return el
}
export function setIcon(el, name) {
  if (el._ic === name) return
  el._ic = name
  el.style.setProperty('--i', `url("${iconBase}${name}.svg")`)
}

// speaker.hawk 没单独给图时借 commander.hawk 的；小七借 companion.seven 的
function lookup(store, name) {
  if (!store || !name) return null
  if (store[name]) return store[name]
  if (name.indexOf('speaker.') === 0) { const id = name.slice(8); return store['commander.' + id] || (id === 'seven' ? store['companion.seven'] : null) || null }
  return null
}
function applyPortrait(el, src) {
  el._src = src
  if (src) { el.style.backgroundImage = `url("${src}")`; el.classList.add('has-img') }
  else { el.style.backgroundImage = ''; el.classList.remove('has-img') }
}
/** 头像框：有 portraits[name] 用图，没有就用图标占位。name 形如 unit.rifle / commander.hawk / speaker.ops */
export function portrait(store, name, iconName, cls) {
  const el = h('span', 'pt ' + (cls || ''))
  el.appendChild(icon(iconName || 'person', 'pt-ic'))
  setPortrait(store, el, name, iconName)
  return el
}
export function setPortrait(store, el, name, iconName) {
  if (iconName) setIcon(el.firstChild, iconName)
  const src = lookup(store, name)
  if (el.dataset.pt === name && el._src === src) return
  el.dataset.pt = name
  applyPortrait(el, src)
}
/** portraits 晚到（渲染层离屏出图是异步的）：把已经在页面上的头像框全部刷一遍 */
export function refreshPortraits(root, store) {
  for (const el of root.querySelectorAll('[data-pt]')) {
    const src = lookup(store, el.dataset.pt)
    if (el._src !== src) applyPortrait(el, src)
  }
}

export function setText(el, v) { v = v == null ? '' : String(v); if (el._t !== v) { el._t = v; el.textContent = v } }
export function setCls(el, name, on) { on = !!on; const k = '_c_' + name; if (el[k] !== on) { el[k] = on; el.classList.toggle(name, on) } }
export function setVar(el, name, v) { const k = '_v_' + name; if (el[k] !== v) { el[k] = v; el.style.setProperty(name, v) } }
export function setAttr(el, name, v) { const k = '_a_' + name; if (el[k] !== v) { el[k] = v; if (v == null) el.removeAttribute(name); else el.setAttribute(name, v) } }
export function show(el, on) { on = !!on; if (el._shown !== on) { el._shown = on; el.hidden = !on } }

export const fmtInt = n => {
  n = Math.round(n || 0)
  const s = String(Math.abs(n))
  let out = ''
  for (let i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += ','; out += s[i] }
  return n < 0 ? '-' + out : out
}
export const fmtTime = sec => {
  sec = Math.max(0, Math.ceil(sec || 0))
  const m = (sec / 60) | 0, s = sec % 60
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
}
export const pad2 = n => (n < 10 ? '0' + n : '' + n)
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)
export const pctStr = (v, d = 0) => (v * 100).toFixed(d) + '%'

export function button(cls, onClick, ...kids) {
  const el = h('button', 'btn ' + (cls || ''), kids)
  el.type = 'button'
  el.addEventListener('click', e => { e.stopPropagation(); el.blur(); onClick(e) })
  return el
}

/** 有 key 就用 key 的文案，没有（t 原样返回 key）就退到 fallbackKey */
export function tOr(t, key, fallbackKey, params) { const v = t(key, params); return v === key ? t(fallbackKey, params) : v }
/** 突变因子的「具体效果」一句话：优先 mutator.<id>.effect（玩法层补），没有就用 .desc */
export const mutEffect = (t, id) => tOr(t, `mutator.${id}.effect`, `mutator.${id}.desc`)

/** 把一段文案按 ' / ' 拆成主行与副行（门标题用） */
export function splitTitle(str) {
  const i = str.indexOf(' / ')
  return i < 0 ? [str, ''] : [str.slice(0, i), str.slice(i + 3)]
}
