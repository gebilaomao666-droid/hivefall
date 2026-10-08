// 生成 index.html 里的 <link rel="modulepreload"> 清单。node tools/gen-modulepreload.mjs [--check]
// 为什么要：没有打包，src/main.js 的 import 链有 5 层、120 多个文件，浏览器要一层层发现、一层层请求（手机网络上光这一段 4~5 秒）。
// 把整张静态依赖图在 HTML 里一次列出来，所有模块和 HTML 一起并行下载。
// 加 / 删了 import 以后跑一次（test-core 会检查清单是不是最新的；清单漏了只是慢一点，多了会请求一个不存在的文件报 404）。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BEGIN = '<!-- modulepreload:begin（tools/gen-modulepreload.mjs 生成，别手改） -->', END = '<!-- modulepreload:end -->'

/** 从 index.html 的 importmap 和入口脚本出发，走一遍静态 import，返回按深度排好的文件列表（相对项目根） */
export function moduleGraph(html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')) {
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports
  const entry = /<script type="module" src="([^"]+)"/.exec(html)[1]
  const norm = (p) => path.posix.normalize(p.replace(/^\.\//, ''))
  const resolve = (from, spec) => {
    if (map[spec]) return norm(map[spec])
    for (const k of Object.keys(map)) if (k.endsWith('/') && spec.startsWith(k)) return norm(map[k] + spec.slice(k.length))
    return norm(path.posix.join(path.posix.dirname(from), spec))
  }
  const depth = new Map()
  const walk = (f, d) => {
    if (depth.has(f) && depth.get(f) <= d) return
    depth.set(f, d)
    const src = fs.readFileSync(path.join(root, f), 'utf8')
    for (const m of src.matchAll(/(?:^|\n)[ \t]*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g)) walk(resolve(f, m[1] || m[2]), d + 1)
  }
  walk(norm(entry), 0)
  return [...depth].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f).filter((f) => f !== norm(entry))
}

export function preloadBlock(html) {
  return BEGIN + '\n' + moduleGraph(html).map((f) => `<link rel="modulepreload" href="${f}">`).join('\n') + '\n' + END
}

/** index.html 里现有的清单是否和依赖图一致 */
export function preloadUpToDate() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const i = html.indexOf(BEGIN), j = html.indexOf(END)
  return i >= 0 && j > i && html.slice(i, j + END.length) === preloadBlock(html)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'index.html')
  const html = fs.readFileSync(file, 'utf8')
  if (process.argv.includes('--check')) { const ok = preloadUpToDate(); console.log(ok ? 'modulepreload 清单是最新的' : 'modulepreload 清单过期了：node tools/gen-modulepreload.mjs'); process.exitCode = ok ? 0 : 1 }
  else {
    const i = html.indexOf(BEGIN), j = html.indexOf(END)
    if (i < 0 || j < 0) throw new Error('index.html 里没有 modulepreload 标记')
    const out = html.slice(0, i) + preloadBlock(html) + html.slice(j + END.length)
    fs.writeFileSync(file, out)
    console.log(`index.html：${moduleGraph(out).length} 个模块`)
  }
}
