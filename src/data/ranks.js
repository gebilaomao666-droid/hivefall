// 军衔：按「这个兵种全队累计击杀」升。13 级，阈值是一条约 ×2.3 的指数曲线：
// 战役里突击兵大约走到第 8~9 级，重型走到 4~6 级，最后几级留给无尽。纯展示，不加数值。
// 第 3 轮：战役虫潮加密后突击兵一局 2.2~2.5 万杀，原来 2.1 万的第 9 级战役里就到了、无尽 9 层后不再升——第 9 级起整体后移
export const RANKS = [
  { id: 'r0', kills: 0 },          // 补充兵
  { id: 'r1', kills: 25 },         // 列兵
  { id: 'r2', kills: 60 },         // 守桥人
  { id: 'r3', kills: 140 },        // 老桥兵
  { id: 'r4', kills: 320 },        // 清道班长
  { id: 'r5', kills: 750 },        // 铆钉军士
  { id: 'r6', kills: 1700 },       // 断后军士长
  { id: 'r7', kills: 4000 },       // 桥头尉官
  { id: 'r8', kills: 9000 },       // 防线校尉
  { id: 'r9', kills: 25000 },      // 深层先锋官
  { id: 'r10', kills: 55000 },     // 渊面督战
  { id: 'r11', kills: 120000 },    // 远征典范
  { id: 'r12', kills: 260000 },    // 第七传奇
]
for (const r of RANKS) r.nameKey = `rank.${r.id}`

export function rankIndex(kills) {
  let i = 0
  while (i + 1 < RANKS.length && kills >= RANKS[i + 1].kills) i++
  return i
}

// 给部队面板：{ index, nameKey, kills, prev, next(下一级阈值，满级为 null), progress 0..1 }
export function rankFor(kills) {
  const i = rankIndex(kills), cur = RANKS[i], nx = RANKS[i + 1] || null
  return {
    index: i, nameKey: cur.nameKey, kills, prev: cur.kills, next: nx ? nx.kills : null,
    progress: nx ? (kills - cur.kills) / (nx.kills - cur.kills) : 1,
  }
}
