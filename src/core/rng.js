// mulberry32。模拟层唯一的随机源。
import { hashStr } from './util.js'

function mix(a, b) {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export function createRng(seed) {
  const seed0 = seed >>> 0
  let s = seed0
  const next = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.range = (a, b) => a + (b - a) * next()
  next.int = n => (next() * n) | 0
  next.pick = arr => arr[(next() * arr.length) | 0]
  next.chance = p => next() < p
  // 三角分布 -1..1，刷怪用：中间密两边疏
  next.tri = () => next() + next() - 1
  // 分流只依赖初始种子和标签，不依赖当前消耗进度：
  // 这样某个系统多抽一次随机数，不会把别的系统的序列带偏。
  next.fork = label => createRng(mix(seed0, typeof label === 'string' ? hashStr(label) : label >>> 0))
  next.seed = seed0
  return next
}
