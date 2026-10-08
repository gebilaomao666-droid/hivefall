// inspect.js —— 检视台：给军械库页和美术迭代用。
//   show(name)      一个逻辑名的模型，按「每个 clip 一个实例」排成一排，循环播放
//   lineup(names)   多个逻辑名并排（各播一个 clip），对比体型和配色
import { createPool, loadAsset, resolveName } from './assets.js'

export function createInspector(ctx, rig) {
  let cur = null   // { entries: [{ pool, items: [{ clip, x, z, dur, loop }] }], info, yaw }
  // 只从场景里摘掉，不 dispose：几何属性和别的实例池共用同一份 VAT 资源，dispose 会把共用的缓冲一起删掉
  const hide = () => { if (cur) for (const e of cur.entries) for (const o of e.pool.objs) ctx.scene.remove(o); cur = null }
  const dims = (pool) => { const b = pool.asset.bounds, sc = pool.scale; return { w: (b.max.x - b.min.x) * sc, l: (b.max.z - b.min.z) * sc, h: b.max.y * sc } }
  const aim = (o, at, span, h) => {
    if (o.camera === false) return
    rig.setMode('codex', true)
    rig.focus(at[0], h * 0.45, at[1], o.dist || Math.max(span * 1.05, h * 2.6, 2.5) + 1.2, o.pitch ?? 0.38, o.spin ?? 0.2, o.angle ?? 0.5)
  }
  return {
    get current() { return cur },
    /**
     * show(name, { at: [x, z] = [0, 8], yaw = 0, camera = true, pitch, dist, spin, angle, clips }) -> Promise<info>
     * info: { name, resolved, label, tris, verts, frames, height, width, length, bakeMs, clips: [{ name, x, y, z, duration, frames, loop }] }
     */
    async show(name, o = {}) {
      hide()
      if (!name) return null
      const rec = await loadAsset(name)
      const pool = createPool(name, ctx, 16)
      if (!pool) return null
      const { w, l, h } = dims(pool)
      const all = Object.keys(pool.asset.clips)
      let names = o.clips ? o.clips.filter((c) => all.includes(c)) : all   // o.clips：只摆这几个动作（军械库只放一个）
      if (!names.length) names = all.slice(0, 1)
      const gap = Math.max(w, l * 0.6) * 1.15 + 0.5
      const at = o.at || [0, 8]
      const items = names.map((clip, i) => ({ clip, x: at[0] + (i - (names.length - 1) / 2) * gap, z: at[1], dur: pool.asset.clips[clip].duration, loop: pool.asset.clips[clip].loop, frames: pool.asset.clips[clip].count }))
      cur = { entries: [{ pool, items }], yaw: o.yaw ?? 0 }
      aim(o, at, gap * (names.length - 1) + w, h)
      cur.info = {
        name, resolved: resolveName(name), label: pool.def.label || '', tris: pool.asset.triCount, verts: pool.asset.vertexCount, frames: pool.asset.frameCount,
        height: +h.toFixed(2), width: +w.toFixed(2), length: +l.toFixed(2), bakeMs: +(rec.ms || 0).toFixed(1),
        clips: items.map((it) => ({ name: it.clip, x: it.x, y: h + 0.3, z: it.z, duration: it.dur, frames: it.frames, loop: it.loop })),
      }
      return cur.info
    },
    /** lineup(['unit.rifle', 'unit.flamer', ...], { clip: 'idle', at, yaw, gap, pitch, dist, spin, angle }) -> Promise<info>（info.clips 里每项是一个模型） */
    async lineup(names, o = {}) {
      hide()
      await Promise.all(names.map((n) => loadAsset(n)))
      const at = o.at || [0, 8]
      const entries = [], labels = []
      let x = 0, hMax = 0
      for (const n of names) {
        const pool = createPool(n, ctx, 4); if (!pool) continue
        const { w, l, h } = dims(pool), clip = pool.clipOr(o.clip || 'idle', 'walk'), C = pool.asset.clips[clip]
        const half = Math.max(w, l * 0.5) / 2 + (o.gap ?? 0.35)
        x += half
        entries.push({ pool, items: [{ clip, x, z: at[1], dur: C.duration, loop: C.loop, frames: C.count }] })
        labels.push({ name: n.replace(/^\w+\./, '') + ' · ' + pool.asset.triCount + '△', x, y: h + 0.3, z: at[1], duration: C.duration, frames: C.count, loop: C.loop })
        x += half; hMax = Math.max(hMax, h)
      }
      for (const e of entries) e.items[0].x += at[0] - x / 2
      for (const c of labels) c.x += at[0] - x / 2
      cur = { entries, yaw: o.yaw ?? 0 }
      aim(o, at, x, hMax)
      cur.info = { name: names.join(','), resolved: names.join(','), label: '并排对比', tris: 0, verts: 0, frames: 0, height: +hMax.toFixed(2), width: +x.toFixed(2), length: 0, bakeMs: 0, clips: labels }
      return cur.info
    },
    update(t) {
      if (!cur) return
      for (const { pool, items } of cur.entries) {
        const inst = pool.inst
        items.forEach((it, i) => {
          const frame = it.loop ? inst.frameAt(it.clip, t) : inst.frame(it.clip, Math.min(1, (t % (it.dur + 1.0)) / it.dur))   // 非循环 clip：播完停 1 秒再重播
          inst.put(i, it.x, 0, it.z, cur.yaw, pool.scale, frame, 1, 0, 0.37, 0, 0, 1)
          inst.tint(i, 0, 0, 0, 0)
        })
        inst.commit(items.length)
      }
    },
  }
}
