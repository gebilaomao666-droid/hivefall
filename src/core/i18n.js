// 文案查表。纯函数，不碰 DOM / 存档：语言由调用方 setLang（设置里存的是 save.settings.lang）。
//   import { t, setLang } from '../core/i18n.js'
//   t('gate.unit', { count: 8, unitKey: 'unit.rifle.name' })  →  '+8 突击兵'
// 约定：
//   {name} 占位符用 params.name 替换；
//   params 里以 Key 结尾的字段（unitKey / extraKey / nameKey / descKey …）本身是文案 key，
//   会先查一次表，再填进去掉 Key 后缀的占位符（unitKey → {unit}，nameKey → {name}）。显式给了同名参数时以显式的为准；
//   查不到的 key 先回退到中文表，再回退成 key 本身；没给值的占位符原样保留（方便一眼看出漏传）。
import zh from '../data/strings.zh.js'
import en from '../data/strings.en.js'

export const TABLES = { zh, en }
export const LANGS = Object.keys(TABLES)
export const DEFAULT_LANG = 'zh'

const HOLE = /\{(\w+)\}/g

export function createI18n(lang = DEFAULT_LANG, tables = TABLES) {
  let cur = tables[lang] ? lang : DEFAULT_LANG

  const raw = key => {
    const v = tables[cur][key]
    if (v !== undefined) return v
    const d = tables[DEFAULT_LANG] && tables[DEFAULT_LANG][key]
    return d !== undefined ? d : null
  }

  function t(key, params) {
    if (key == null) return ''
    const str = raw(key)
    if (str === null) return String(key)
    if (!params || str.indexOf('{') < 0) return str
    return str.replace(HOLE, (hole, name) => {
      const v = params[name]
      if (v != null) return String(v)
      const ref = params[name + 'Key']
      return typeof ref === 'string' ? t(ref) : hole       // 二次查表不再带参数：不会互相套娃
    })
  }

  return {
    t,
    has: key => raw(key) !== null,
    getLang: () => cur,
    // 不认识的语言不切，返回当前语言
    setLang(next) { if (tables[next]) cur = next; return cur },
  }
}

// 全局默认实例：UI 直接 import { t, setLang } 用
const shared = createI18n()
export const t = shared.t
export const has = shared.has
export const getLang = shared.getLang
export const setLang = shared.setLang
