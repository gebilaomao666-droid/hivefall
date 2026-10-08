// base.js —— 资源根目录。按本文件的位置推出来（src/render/ → ../../assets/），不写死站点根的 "/assets/"：
// 挂在子路径下（GitHub Pages 的 /仓库名/）或从 dev/ 开发页打开都能找到。
export const ASSET_ROOT = new URL('../../assets/', import.meta.url).href

/** 'assets/x/y.png' 或 '/assets/x/y.png'（旧写法）→ 绝对 URL；其它（http:、data:、blob:、已是完整 URL 的）原样返回 */
export function assetUrl(p) {
  if (typeof p !== 'string') return p
  const m = /^\/?assets\/(.*)$/.exec(p)
  return m ? ASSET_ROOT + m[1] : p
}
