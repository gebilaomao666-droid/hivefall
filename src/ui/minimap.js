// 战术小地图：一块小 canvas，10Hz 重画。x 横向铺满、z 纵向铺满（不等比，只求看得出「哪条道压力大」）。
import { h } from './dom.js'

const X0 = -6.4, X1 = 6.4, Z0 = -21, Z1 = 17.6
const LANES = [-3.84, -1.28, 1.28, 3.84]          // 车道分隔线
const ROW_Z = [4.5, 1.5, -1.5, -4.5]

export function createMinimap(w = 168, hgt = 104) {
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)
  const cv = h('canvas', 'mm-cv')
  cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr)
  cv.style.width = w + 'px'; cv.style.height = hgt + 'px'
  const g = cv.getContext('2d')
  const W = cv.width, H = cv.height
  const sx = x => (x - X0) / (X1 - X0) * W
  const sz = z => (z - Z0) / (Z1 - Z0) * H

  function draw(world) {
    if (!g) return
    g.clearRect(0, 0, W, H)
    // 网格
    g.lineWidth = dpr
    g.strokeStyle = 'rgba(95,224,255,0.13)'
    g.beginPath()
    for (const x of LANES) { g.moveTo(sx(x), 0); g.lineTo(sx(x), H) }
    for (let z = -18; z <= 15; z += 6) { g.moveTo(0, sz(z)); g.lineTo(W, sz(z)) }
    g.stroke()
    // 布防区
    g.fillStyle = 'rgba(255,176,46,0.05)'
    g.fillRect(0, sz(-6), W, sz(6) - sz(-6))
    // 防线
    g.strokeStyle = 'rgba(255,176,46,0.85)'
    g.setLineDash([4 * dpr, 3 * dpr])
    g.beginPath(); g.moveTo(0, sz(17.2)); g.lineTo(W, sz(17.2)); g.stroke()
    g.setLineDash([])
    // 电网：每道一小段
    const fences = world.fences
    if (fences) {
      const lw = W / fences.length
      for (let l = 0; l < fences.length; l++) {
        g.fillStyle = fences[l] ? 'rgba(95,224,255,0.9)' : 'rgba(120,140,160,0.25)'
        g.fillRect(l * lw + 2 * dpr, sz(16.5) - dpr, lw - 4 * dpr, 2 * dpr)
      }
    }
    // 门
    if (world.gates) {
      g.fillStyle = 'rgba(255,176,46,0.9)'
      g.fillRect(0, sz(world.gates.z) - dpr, W, 2 * dpr)
    }
    // 虫群
    const sw = world.swarm
    if (sw) {
      const n = sw.count, d = Math.max(1, Math.round(1.6 * dpr))
      g.fillStyle = 'rgba(255,77,61,0.85)'
      const step = n > 2400 ? 2 : 1
      for (let i = 0; i < n; i += step) {
        if (sw.alive[i] !== 1 || sw.state[i] === 2 || sw.state[i] === 3) continue
        g.fillRect(sx(sw.x[i]) | 0, sz(sw.z[i]) | 0, d, d)
      }
    }
    // 装置
    const dev = world.devices
    if (dev) {
      g.fillStyle = '#ffb02e'
      const d = 3 * dpr
      for (let k = 0; k < dev.length; k++) g.fillRect(sx(dev[k].x) - d / 2, sz(dev[k].z) - d / 2, d, d)
    }
    // Boss
    const b = world.boss
    if (b && b.state !== 'burrowed') {
      const x = sx(b.x), z = sz(b.z), r = 5 * dpr
      g.fillStyle = '#ff4d3d'; g.strokeStyle = '#fff'
      g.beginPath(); g.moveTo(x, z - r); g.lineTo(x + r, z); g.lineTo(x, z + r); g.lineTo(x - r, z); g.closePath(); g.fill(); g.stroke()
    }
    // 我方
    const us = world.squad && world.squad.units
    if (us) {
      g.fillStyle = '#5fe0ff'
      const d = Math.max(1, Math.round(1.8 * dpr))
      for (let k = 0; k < us.length; k++) { const u = us[k]; if (u.alive) g.fillRect(sx(u.x) | 0, sz(u.z) | 0, d, d) }
      // 队伍中心的刻度
      g.fillStyle = '#ffffff'
      g.fillRect(sx(world.squad.x) - dpr, H - 3 * dpr, 2 * dpr, 3 * dpr)
    }
  }
  return { el: cv, draw, ROW_Z }
}
