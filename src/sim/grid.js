// 3×3 空间哈希。每步在虫群移动之后重建一次，所有范围查询都走这里。
// 只收打得到的活虫：尸体（state 2）和潜地的（state 3）不进格子。
// 本步内被打死的虫仍留在格子里，所以查询时要再过滤一次 state。飞行虫（y > 0）照常在格子里，由伤害入口判对空。

const CELL = 3
const X0 = -9, Z0 = -30
const COLS = 6, ROWS = 17
const N = COLS * ROWS
const INV = 1 / CELL

export function createGrid(cap) {
  return {
    start: new Int32Array(N + 1),
    cursor: new Int32Array(N),
    items: new Int16Array(cap),
    cell: new Int16Array(cap),
    out: new Int16Array(cap),    // 主查询结果
    out2: new Int16Array(cap),   // 嵌套查询（破片等）用第二块，避免互相覆盖
    lastD: 0,
  }
}

const colOf = x => { const c = ((x - X0) * INV) | 0; return c < 0 ? 0 : c >= COLS ? COLS - 1 : c }
const rowOf = z => { const r = ((z - Z0) * INV) | 0; return r < 0 ? 0 : r >= ROWS ? ROWS - 1 : r }

export function rebuild(g, s) {
  const { start, cursor, items, cell } = g
  const { alive, state, x, z } = s
  const n = s.count
  start.fill(0)
  for (let i = 0; i < n; i++) {
    if (alive[i] === 0 || state[i] === 2 || state[i] === 3) { cell[i] = -1; continue }
    const xv = x[i] - X0, zv = z[i] - Z0
    // 负数取整会向 0 靠，先夹再取
    const c = xv <= 0 ? 0 : xv >= COLS * CELL ? COLS - 1 : (xv * INV) | 0
    const r = zv <= 0 ? 0 : zv >= ROWS * CELL ? ROWS - 1 : (zv * INV) | 0
    const ci = c + r * COLS
    cell[i] = ci
    start[ci + 1]++
  }
  for (let c = 0; c < N; c++) { start[c + 1] += start[c]; cursor[c] = start[c] }
  for (let i = 0; i < n; i++) {
    const ci = cell[i]
    if (ci >= 0) items[cursor[ci]++] = i
  }
}

// 圆内所有活虫下标写进 out，返回个数
export function queryCircle(g, s, cx, cz, r, out) {
  const { start, items } = g
  const { state, x, z } = s
  const c0 = colOf(cx - r), c1 = colOf(cx + r), r0 = rowOf(cz - r), r1 = rowOf(cz + r)
  const r2 = r * r
  let n = 0
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      const ci = cc + rr * COLS
      for (let k = start[ci], e = start[ci + 1]; k < e; k++) {
        const i = items[k]
        if (state[i] === 2) continue
        const dx = x[i] - cx, dz = z[i] - cz
        if (dx * dx + dz * dz <= r2) out[n++] = i
      }
    }
  }
  return n
}

// 轴对齐矩形内所有活虫下标写进 out，返回个数（光束横扫用）
export function queryRect(g, s, x0, x1, z0, z1, out) {
  const { start, items } = g
  const { state, x, z } = s
  const c0 = colOf(x0), c1 = colOf(x1), r0 = rowOf(z0), r1 = rowOf(z1)
  let n = 0
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      const ci = cc + rr * COLS
      for (let k = start[ci], e = start[ci + 1]; k < e; k++) {
        const i = items[k]
        if (state[i] === 2) continue
        const xv = x[i], zv = z[i]
        if (xv >= x0 && xv <= x1 && zv >= z0 && zv <= z1) out[n++] = i
      }
    }
  }
  return n
}

// 所在格 + 同排左右格的虫数，给「找最密处」打分用（不精确，够用）
export function density(g, x, z) {
  const c = colOf(x), r = rowOf(z), ci = c + r * COLS
  let n = g.start[ci + 1] - g.start[ci]
  if (c > 0) n += (g.start[ci] - g.start[ci - 1]) >> 1
  if (c < COLS - 1) n += (g.start[ci + 2] - g.start[ci + 1]) >> 1
  return n
}

// 正前方走廊（|dx| <= halfW）内最近的活虫；没有返回 -1。距离平方写在 g.lastD。
// 从近排往远排扫，一旦剩下的排不可能更近就停。
// groundOnly: 打不了飞行目标的武器传 true。
export function nearestInCorridor(g, s, ux, uz, halfW, range, groundOnly = false) {
  const { start, items } = g
  const { state, x, z, y } = s
  const c0 = colOf(ux - halfW), c1 = colOf(ux + halfW)
  const rTop = rowOf(uz + 2), rBot = rowOf(uz - range)
  let best = -1, bestD = range * range
  for (let rr = rTop; rr >= rBot; rr--) {
    const gap = uz - (Z0 + (rr + 1) * CELL)
    if (gap > 0 && gap * gap >= bestD) break
    for (let cc = c0; cc <= c1; cc++) {
      const ci = cc + rr * COLS
      for (let k = start[ci], e = start[ci + 1]; k < e; k++) {
        const i = items[k]
        if (state[i] === 2 || (groundOnly && y[i] > 0)) continue
        const dx = x[i] - ux
        if (dx > halfW || dx < -halfW) continue
        const dz = z[i] - uz
        if (dz > 2) continue
        const d = dx * dx + dz * dz
        if (d < bestD) { bestD = d; best = i }
      }
    }
  }
  g.lastD = bestD
  return best
}
