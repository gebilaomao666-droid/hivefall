// companionview.js —— 伙伴无人机「小七」：读 world.companion（没有就什么都不画）。
//   逻辑名 'companion.' + world.companion.form（dormant / scout / armed / annihilator，见 models/humans/register.js）
//   位置 (x, z) + 悬停高度 y（模型的核心在建模坐标 y = 1.0，所以实例放在 y - 1.0 × scale）
//   fireT → shoot clip；scanT / pulseT / 进化 → pulse clip（环放大一圈）；其余 idle / walk
//   事件 companion{kind: join | found | evolve | scan | pulse} 的表现也在这里（粒子原语走 ctx.fx）
import { createPool } from './assets.js'

const CORE_Y = 1.0
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d }

export function createCompanionView(ctx) {
  const pools = new Map()
  const poolOf = (form) => { let p = pools.get(form); if (!p) { p = createPool('companion.' + form, ctx); pools.set(form, p); if (p) p.n = 0 } return p }
  let cur = null, st = null, anchor = null
  const fresh = (c, t) => ({ form: c.form, x: c.x, z: c.z, vx: 0, vz: 0, t, yaw: c.facing ?? Math.PI, pulseT: -9, bornT: t, rx: c.x, ry: c.y ?? 2.4, rz: c.z, scale: 1, pool: null })
  const api = {
    pools,
    prewarm(ok, names) { for (const n of names) if (n.startsWith('companion.') && ok(n)) poolOf(n.slice(10)) },
    reset() { cur = null; st = null; anchor = null; for (const p of pools.values()) if (p) p.inst.commit(0) },
    update(world, time, dt, realT) {
      for (const p of pools.values()) if (p) p.n = 0
      const c = world.companion
      anchor = null
      if (!c) { cur = null; st = null; for (const p of pools.values()) if (p) p.inst.commit(0); return }
      if (c !== cur) { cur = c; st = fresh(c, time) }
      if (c.form !== st.form) { st.form = c.form; st.pulseT = time }               // 进化：换模型，播一遍 pulse
      const P = poolOf(c.form)
      if (P) {
        // 速度：按模拟时间的增量估（一帧里走了几步都对），画的时候往回退 ctx.back
        if (time > st.t) { const k = 1 / (time - st.t); st.vx = (c.x - st.x) * k; st.vz = (c.z - st.z) * k; st.x = c.x; st.z = c.z; st.t = time }
        else if (time < st.t) { st.x = c.x; st.z = c.z; st.t = time; st.vx = st.vz = 0 }
        const back = ctx.back || 0
        const x = c.x - st.vx * back, z = c.z - st.vz * back
        const inst = P.inst, sc = P.scale
        const sinceFire = time - (c.fireT ?? -9), sincePulse = Math.min(time - Math.max(c.scanT ?? -9, c.pulseT ?? -9), time - st.pulseT)
        // 朝向：开火后一小会儿对着目标，其余时间跟 facing（默认朝前）
        const want = sinceFire >= 0 && sinceFire < 0.6 && c.aimX != null ? Math.atan2(c.aimX - c.x, c.aimZ - c.z) : (c.facing ?? Math.PI)
        st.yaw += angDiff(st.yaw, want) * Math.min(1, dt * 10)
        const shoot = P.clip('shoot'), pulse = P.clip('pulse'), A = P.anim
        let frame
        if (pulse && sincePulse >= 0 && sincePulse < P.asset.clips[pulse].duration) frame = inst.frame(pulse, sincePulse / P.asset.clips[pulse].duration)
        else if (shoot && sinceFire >= 0 && sinceFire < (A.shootDur || 0.3)) frame = inst.frame(shoot, sinceFire / (A.shootDur || 0.3))
        else frame = inst.frameAt(Math.hypot(st.vx, st.vz) > 1.0 ? P.clipOr('walk', 'idle') : P.clipOr('idle', 'walk'), time)
        const born = Math.min(1, (time - st.bornT) / 0.6), eb = 1 - Math.pow(1 - born, 3)
        const hover = (c.y ?? 2.4) + (1 - eb) * 6                                   // 入列：从上方滑下来
        const bank = Math.max(-0.35, Math.min(0.35, -st.vx * 0.08))                  // 横移时侧倾
        const y = hover - CORE_Y * sc
        inst.put(P.n++, x, y, z, st.yaw, sc, frame, 1.05, sinceFire >= 0 && sinceFire < 0.07 ? 0.6 : 0, 0.37, bank, 0, 1.15 + (sincePulse >= 0 && sincePulse < 0.7 ? 1.2 * (1 - sincePulse / 0.7) : 0))
        inst.tint(0, 0, 0, 0, 0)
        st.rx = x; st.ry = hover; st.rz = z; st.scale = sc; st.pool = P
        anchor = { id: c.id || 'seven', kind: 'companion', form: c.form, stage: c.stage | 0, name: c.name || null, x, y: hover + 0.55 * sc, z }
      }
      for (const p of pools.values()) if (p) p.inst.commit(p.n)
    },
    consume(events, time) {
      const fx = ctx.fx
      if (!fx) return
      for (const e of events) {
        if (e.type !== 'companion') continue
        const x = e.x ?? (st ? st.rx : 0), z = e.z ?? (st ? st.rz : 10)
        if (e.kind === 'join' || e.kind === 'found') { fx.sparkleUp(x, z, 12, 0.5, 2.0, 3.0, 0.6); fx.ring(x, z, 0.6, 0.4, 3.2, 0.5, 1.8, 3.0) }
        else if (e.kind === 'evolve') {
          if (st) st.pulseT = time
          fx.ring(x, z, 0.7, 0.5, 6.5, 0.6, 2.0, 3.2); fx.ring(x, z, 0.45, 0.3, 3.5, 1.2, 2.4, 3.2, 1); fx.sparkleUp(x, z, 22, 0.6, 2.2, 3.2, 0.9)
          fx.flash(x, 2.4, z, 30, 0.4, 0x60d0ff)
        } else if (e.kind === 'scan') {                                                // 战术扫描：从小七打一道细束到圈心，圈由内向外扫开
          const r = e.r || 6.5
          if (st) fx.beam(st.rx, st.ry, st.rz, x, 0.2, z, 0.35, 0.16, 0.5, 2.0, 3.0)
          fx.ring(x, z, 0.7, 0.6, r * 2, 0.4, 1.7, 2.6); fx.ring(x, z, 1.0, r * 1.9, r * 2, 0.25, 1.1, 1.8)
        } else if (e.kind === 'pulse') {                                               // 冰冻脉冲：阵前一大圈
          const r = e.r || 9.5
          fx.ring(x, z, 0.55, 1.0, r * 2, 1.0, 2.2, 3.2); fx.ring(x, z, 0.8, 0.6, r * 1.6, 0.5, 1.4, 2.6, 1)
          fx.flash(x, 2, z, 50, 0.35, 0x80d8ff); fx.shock(x, 0.6, z, 0.7, r, 0.5)
          for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; fx.emitAdd(x + Math.cos(a) * 1.2, 0.3, z + Math.sin(a) * 1.2, Math.cos(a) * r * 1.6, 1.2, Math.sin(a) * r * 1.6, 0.55, 0.5, 0.12, 0.7, 1.9, 3.2, 0, fx.CELL.STAR, 0, 1.6, 0, a, 3) }
        }
      }
    },
    /** 枪口的世界坐标（shot 事件的 unit === 'companion' 时由 squadview.muzzle 转过来）。k：双联机炮的第几个 */
    muzzle(out, k = 0) {
      if (!st || !st.pool) return false
      const m = st.pool.meta, mz = (m.muzzles && m.muzzles[k % m.muzzles.length]) || m.muzzle || [0, CORE_Y, 0.3]
      const s = Math.sin(st.yaw), c = Math.cos(st.yaw), sc = st.scale
      out.set(st.rx + (mz[0] * c + mz[2] * s) * sc, st.ry + (mz[1] - CORE_Y) * sc, st.rz + (-mz[0] * s + mz[2] * c) * sc)
      return true
    },
    /** 头顶名牌的世界坐标锚点；没有伙伴返回 null */
    anchor() { return anchor },
    count() { return anchor ? 1 : 0 },
  }
  return api
}
