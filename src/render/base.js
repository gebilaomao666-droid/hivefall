// base.js —— 资源根目录。按本文件的位置推出来（src/render/ → ../../assets/），不写死站点根的 "/assets/"：
// 挂在子路径下（GitHub Pages 的 /仓库名/）或从 dev/ 开发页打开都能找到。
// 另外管「手机 / 轻量模式」：手机上能换成小尺寸替换件的资源（assets/lite/，tools/make-lite-assets.py 生成）在这里改路径。
import { LITE_FILES } from './lite-manifest.js'

export const ASSET_ROOT = new URL('../../assets/', import.meta.url).href

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
/** 手机 / 平板（iPadOS 的 Safari 自称 Macintosh，靠触点数认）。?mobile=1 / ?mobile=0 强制（在电脑上走手机代码路径调试用） */
export const MOBILE = Q && Q.has('mobile') ? Q.get('mobile') === '1'
  : /Mobi|Android|iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
/** 轻量素材：默认手机开、电脑关。?lite=1 / ?lite=0 强制 */
export const LITE = Q && Q.has('lite') ? Q.get('lite') === '1' : MOBILE

/** 'assets/x/y.png' 或 '/assets/x/y.png'（旧写法）→ 绝对 URL；其它（http:、data:、blob:、已是完整 URL 的）原样返回 */
export function assetUrl(p) {
  if (typeof p !== 'string') return p
  const m = /^\/?assets\/(.*)$/.exec(p)
  return m ? ASSET_ROOT + m[1] : p
}

/** 轻量模式下有替换件的资源 → assets/lite/ 下的同名文件；其余原样。three 的加载器统一经 DefaultLoadingManager 的 URL 改写走这里 */
export function liteUrl(url) {
  if (!LITE || typeof url !== 'string' || !url.startsWith(ASSET_ROOT)) return url
  const rel = url.slice(ASSET_ROOT.length).split(/[?#]/)[0]
  return LITE_FILES.has(rel) ? ASSET_ROOT + 'lite/' + url.slice(ASSET_ROOT.length) : url
}

/**
 * 带超时和重试的加载：load(onProgress) → Promise。stall 毫秒内既没完成也没有任何进度回调就当这次卡死了，重新发一次（最多 tries 次）；
 * 全部失败才 reject。手机网络抖一下、某个请求挂住不回，不会让整个加载流程永远等下去
 */
export function loadWithRetry(load, { tries = 3, stall = 20000, name = '' } = {}) {
  let attempt = 0
  const once = () => new Promise((resolve, reject) => {
    let done = false, timer = 0
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout ' + name)) } }, stall) }
    arm()
    let p
    try { p = load(() => { if (!done) arm() }) } catch (e) { p = Promise.reject(e) }
    Promise.resolve(p).then((v) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }, (e) => { if (!done) { done = true; clearTimeout(timer); reject(e) } })
  })
  const go = () => once().catch((e) => {
    if (++attempt >= tries) throw e
    console.warn(`[load] ${name || '资源'} 第 ${attempt} 次失败（${e && e.message}），重试`)
    return new Promise((r) => setTimeout(r, 400 * attempt)).then(go)
  })
  return go()
}
