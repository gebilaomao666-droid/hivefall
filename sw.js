// HIVEFALL 离线缓存（Service Worker）。index.html 注册；作用域 = 本文件所在目录（GitHub Pages 的 /hivefall/ 子路径下也对）。
//
// 策略（目标：二次打开快，但永远不会把玩家卡在旧版本上）：
//   · 页面 / 代码（.html .js .mjs .css .json、目录）：网络优先，成功就顺手更新缓存；断网才用缓存。
//     ——代码每次都跟服务器核对（GitHub Pages 有 ETag / 10 分钟 HTTP 缓存，没改的文件只是一个 304），新版本一发布下次打开就是新版。
//   · 素材（模型 / 贴图 / 字体 / 音效 / HDRI）：缓存优先，立刻返回；再在后台带 ETag 跟服务器核对一次（没变 = 304，几乎不花流量），
//     变了就换掉缓存里那份，下次打开用新的。
//   · 音乐（<audio> 流式播放，带 Range 请求）不经过这里。
//   · 想一刀切清空所有旧缓存：把下面的 VERSION 改一下（激活时会删掉别的版本的缓存）。
const VERSION = 'hf-1'
const CODE = /\.(?:html?|m?js|css|json)$/i
const SKIP = /\/assets\/audio\/music\//

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

const sameOrigin = (url) => url.origin === self.location.origin
const scoped = (url) => url.href.startsWith(self.registration.scope)

// 后台核对排队：一次两个，并且等页面先把首屏要的东西下完（素材核对不跟加载抢带宽）
let running = 0
const waiting = []
function enqueue(job) { waiting.push(job); pump() }
function pump() {
  while (running < 2 && waiting.length) {
    const job = waiting.shift(); running++
    new Promise((r) => setTimeout(r, 4000)).then(job).catch(() => {}).then(() => { running--; pump() })
  }
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION)
  try {
    const res = await fetch(req)
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {})
    return res
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' })
    if (hit) return hit
    throw e
  }
}

async function revalidate(req, cached) {
  const cache = await caches.open(VERSION)
  const h = {}
  const etag = cached.headers.get('ETag'), lm = cached.headers.get('Last-Modified')
  if (etag) h['If-None-Match'] = etag
  else if (lm) h['If-Modified-Since'] = lm
  const res = await fetch(req.url, { headers: h, cache: 'no-cache' })
  if (res.status === 200 && res.type === 'basic') await cache.put(req, res)
}

async function cacheFirst(event) {
  const req = event.request
  const cache = await caches.open(VERSION)
  const hit = await cache.match(req)
  if (hit) {
    event.waitUntil(new Promise((done) => enqueue(() => revalidate(req, hit).finally(done))))
    return hit
  }
  const res = await fetch(req)
  if (res && res.ok && res.type === 'basic' && res.status === 200) cache.put(req, res.clone()).catch(() => {})
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  if (!sameOrigin(url) || !scoped(url) || SKIP.test(url.pathname)) return
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || CODE.test(url.pathname)) event.respondWith(networkFirst(req))
  else event.respondWith(cacheFirst(event))
})

// 页面进首页以后把这次已经下过的素材清单发过来（那时 Service Worker 还没接管页面，这些请求没经过它）：
// 从浏览器的 HTTP 缓存里取一份放进来（基本不走网络），下次打开就全是本地的了
self.addEventListener('message', (event) => {
  const d = event.data
  if (!d || d.type !== 'cache' || !Array.isArray(d.urls)) return
  event.waitUntil(caches.open(VERSION).then(async (cache) => {
    for (const u of d.urls) {
      try {
        const url = new URL(u, self.registration.scope)
        if (!sameOrigin(url) || !scoped(url) || SKIP.test(url.pathname) || CODE.test(url.pathname) || url.pathname.endsWith('/')) continue
        if (await cache.match(url.href)) continue
        const res = await fetch(url.href, { cache: 'force-cache' })
        if (res.ok && res.status === 200 && res.type === 'basic') await cache.put(url.href, res)
      } catch (e) { /* 一个不行就下一个 */ }
    }
  }))
})
