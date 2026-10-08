// 制作名单的数据：从各目录的 CREDITS.md 里把 CC BY 3.0 条目逐条抽出来（作品名 / 作者 / 来源链接），
// 这样素材目录里新增一条署名，游戏里的名单跟着变，不用两处手抄。纯函数，Node 里也能跑（tools 可以直接校验）。
export const CREDIT_FILES = ['models/humans', 'models/aliens', 'models/vehicles', 'models/env', 'models/ai', 'env', 'audio', 'ui']

const CCBY = /CC[- ]?BY/i
const URL_RE = /https?:\/\/[^\s)<|>\]]+/

/** 从一份 CREDITS.md 文本里抽出 CC BY 条目：[{ name, author, url, license }] */
export function parseCcBy(md) {
  const out = []
  let secBy = false, secAuthor = ''
  for (const raw of String(md || '').split(/\r?\n/)) {
    const l = raw.trim()
    if (/^#{1,6}\s/.test(l)) {
      const head = l.replace(/^#+\s*/, '')
      secBy = CCBY.test(head)
      // 「## Aaron Clifford (via poly.pizza) | CC-BY 3.0」：作者写在小节标题里
      const m = /^(.+?)\s*\(via [^)]*\)\s*\|/.exec(head)
      secAuthor = m ? m[1].trim() : ''
      continue
    }
    // 表格行：| 文件 | 名称 | 作者 | 授权 | 来源 |
    if (/^\|/.test(l)) {
      const cells = l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const li = cells.findIndex(c => /^CC[- ]?BY/i.test(c))
      if (li >= 2) {
        const url = (cells.join(' ').match(URL_RE) || [''])[0]
        out.push({ name: cells[1].replace(/\s*[\u{1F300}-\u{1FAFF}]\s*/gu, ' ').trim(), author: cells[li - 1], url, license: 'CC BY 3.0' })
      }
      continue
    }
    if (!/^[-*]\s/.test(l)) continue
    const item = l.replace(/^[-*]\s+/, '')
    const url = (item.match(URL_RE) || [''])[0]
    // "Name" by Author (url), licensed under CC-BY 3.0      /      `file` — "Name" by Author [CC-BY 3.0] via Poly Pizza — url
    let m = /"([^"]+)"\s+by\s+(.+?)\s*(?:\(https?:|\[CC|,\s*licensed|\s+—\s+https?:|$)/.exec(item)
    if (m && (CCBY.test(item) || secBy)) { out.push({ name: clean(m[1]), author: m[2].trim(), url, license: 'CC BY 3.0' }); continue }
    // `file` — "Name" — url（作者在小节标题里）
    m = /"([^"]+)"/.exec(item)
    if (m && secBy && secAuthor) out.push({ name: clean(m[1]), author: secAuthor, url, license: 'CC BY 3.0' })
  }
  return out
}
const clean = s => s.replace(/\s*[\u{1F300}-\u{1FAFF}]\s*/gu, ' ').trim()

/** 多份合并：按来源链接去重（同一条在表格和「署名文本」里各出现一次），再按作者归组排序 */
export function mergeCcBy(lists) {
  const seen = new Set(), all = []
  for (const list of lists) for (const e of list) {
    const k = e.url || (e.author + '|' + e.name)
    if (seen.has(k)) continue
    seen.add(k); all.push(e)
  }
  const by = new Map()
  for (const e of all) { if (!by.has(e.author)) by.set(e.author, []); by.get(e.author).push(e) }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([author, items]) => ({ author, items }))
}

/** 图标作者（game-icons.net，CC BY 3.0）：assets/ui/CREDITS.md 里「by: a, b, c.」那一行 */
export function parseIconAuthors(md) {
  const m = /game-icons\.net[^\n]*?by:\s*([^\n]+)/i.exec(String(md || ''))
  if (!m) return []
  return m[1].replace(/\.\s*$/, '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
}
