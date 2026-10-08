export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t

// table: [[t, v], ...] 按 t 升序。分段线性插值，两端夹住。
export function piecewise(table, t) {
  if (t <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (t <= table[i][0]) {
      const a = table[i - 1], b = table[i]
      return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0])
    }
  }
  return table[table.length - 1][1]
}

// table: [[from, v], ...]。取最后一个 from <= t 的值。
export function stepLookup(table, t) {
  let v = table[0][1]
  for (let i = 0; i < table.length; i++) if (t >= table[i][0]) v = table[i][1]
  return v
}

export function hashStr(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193)
  return h >>> 0
}

export const round = (v, d = 2) => { const p = 10 ** d; return Math.round(v * p) / p }

export function roundObj(obj, d = 1) {
  const out = {}
  for (const k of Object.keys(obj)) out[k] = round(obj[k], d)
  return out
}
