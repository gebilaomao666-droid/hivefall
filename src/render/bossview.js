// bossview.js —— Boss：world.boss 的状态机 → clip。
//   walk → walk（步频跟移速）   attack → attack   charge_windup → windup   charge → charge
//   stunned → stun   burrowed → burrow 播完后藏到地下   emerging → emerge   dying → die
// 死亡演出发生在子弹时间里（world.timeScale = 0.1），所以 die clip 按真实时间播。
import { createPool } from './assets.js'

const STATE_CLIP = { walk: 'walk', idle: 'idle', attack: 'attack', charge_windup: 'windup', charge: 'charge', stunned: 'stun', burrowed: 'burrow', emerging: 'emerge', dying: 'die' }

export function createBossView(ctx) {
  const pools = new Map()
  let cur = null, lastState = null, dieReal = 0, flash = 0, lastX = 0, lastZ = 0, walkPhase = 0, corpse = null, hidden = false
  let introT = 0, rimU = null, rimBase = 0, powBase = 0         // 出场时刻（模拟时间）、这只 Boss 材质的边缘光 uniform 与原值
  let sx = 0, sz = 0, sT = 0, wx = 0, wz = 0, rx = 0, rz = 0   // 位置插值：上一次采样的位置 / 时刻、估出来的速度、这一帧实际画在哪
  const poolOf = (kind) => { let p = pools.get(kind); if (!p) { p = createPool('boss.' + kind, ctx); pools.set(kind, p) } return p }
  return {
    pools,
    /** 预建实例池：Boss 的 detail 着色器编译要一两百毫秒，放到启动时做，别等它登场那一帧 */
    prewarm(ok, names) { for (const n of names) if (n.startsWith('boss.') && ok(n)) poolOf(n.slice(5)) },
    reset() { cur = null; corpse = null; for (const p of pools.values()) if (p) p.inst.commit(0) },
    consume(events) { for (const e of events) if (e.type === 'bossHit') flash = Math.min(0.1, flash + 0.04) }   /* 0.22 → 0.1：受击染色只是一下暗红的跳动，任何时候都不许把整只染成橙粉 */,   // 集火时每步都在挨打：封顶压低，别让它一直是整只橙红（0.45 → 0.22：测试「蠕虫像橙粉的肉柱」一半是这层常亮的受击染色）
    update(world, time, dt, dtReal) {
      const b = world.boss
      for (const p of pools.values()) if (p) p.n = 0
      flash = Math.max(0, flash - dtReal * 5)
      if (b) {
        const P = poolOf(b.kind)
        if (P) {
          if (cur !== b) { cur = b; lastState = null; dieReal = 0; lastX = b.x; lastZ = b.z; walkPhase = 0; sx = b.x; sz = b.z; sT = time; wx = wz = 0; introT = time }
          // 登场的轮廓光强调：头 1 秒边缘光 ×3、变宽，之后 0.8 秒退回原值（只此一项，不再叠光圈）。
          // 改的是这只 Boss 自己材质的 uniform（每种 Boss 一个材质、场上最多一只），不碰实例染色——染色会连反照率一起提亮、整只泛橙
          const U = P.inst.material && P.inst.material.userData.extraUniforms
          if (U && U.uRimGain) {
            if (rimU !== U) { if (rimU) { rimU.uRimGain.value = rimBase; rimU.uRimPow.value = powBase } rimU = U; rimBase = U.uRimGain.value; powBase = U.uRimPow.value }
            const k = b.state === 'dying' ? 0 : Math.max(0, Math.min(1, 1.8 - (time - introT) / 1.0))
            U.uRimGain.value = rimBase * (1 + 2.0 * k); U.uRimPow.value = powBase - 0.7 * k
          }
          if (time > sT) { const k = 1 / (time - sT), dx = b.x - sx, dz = b.z - sz; if (dx * dx + dz * dz < 4) { wx = dx * k; wz = dz * k } else wx = wz = 0; sx = b.x; sz = b.z; sT = time }   // 瞬移（蠕虫换位置）不插值
          else if (time < sT) { sx = b.x; sz = b.z; sT = time; wx = wz = 0 }
          const back = ctx.back || 0
          rx = b.x - wx * back; rz = b.z - wz * back
          if (b.state !== lastState) { lastState = b.state; if (b.state === 'dying') dieReal = 0 }
          const inst = P.inst, A = P.anim
          const logical = STATE_CLIP[b.state] || 'walk'
          const clip = P.clip(logical) || P.clipOr('walk', 'idle'), C = P.asset.clips[clip]
          const since = time - (b.stateT ?? time)
          let frame, y = 0, bright = 1, glow = 1 + (1 - b.hp / (b.hpMax || 1)) * 0.2   // 越残越亮；原来 ×0.9，残血时整只泛橙、像半透明
          hidden = false
          if (b.state === 'dying') {
            dieReal += dtReal
            frame = inst.frame(clip, dieReal / (A.dieDur || C.duration))
            const late = dieReal - (A.dieDur || C.duration)
            if (late > 0) { y = -late * 0.5; bright = Math.max(0.2, 1 - late * 0.4); glow = Math.max(0, 1 - late) }
          } else if (b.state === 'burrowed') {
            if (P.clip('burrow') && since < (A.burrowDur || C.duration)) frame = inst.frame(clip, since / (A.burrowDur || C.duration))
            else hidden = true
          } else if (b.state === 'walk' || b.state === 'charge') {
            const sp = dt > 0 ? Math.hypot(b.x - lastX, b.z - lastZ) / dt : 0
            walkPhase += b.state === 'charge' ? dt / C.duration : dt * Math.min(1.6, Math.max(0.35, sp / (A.stride || 5))) / C.duration * (A.stride ? 1 : 1)
            frame = inst.frame(clip, walkPhase)
          } else if (C.loop) frame = inst.frameAt(clip, since)
          else frame = inst.frame(clip, since / (logical === 'attack' ? (A.attackDur || C.duration) : logical === 'emerge' ? (A.emergeDur || C.duration) : C.duration))
          lastX = b.x; lastZ = b.z
          if (!hidden) {
            const stun = b.state === 'stunned' ? 0.08 : 0      // 眩晕闪烁（原 0.35：和残血发光叠在一起整只发白发橙）
            inst.put(P.n++, rx, y, rz, b.facing ?? 0, P.scale, frame, bright, Math.min(1, flash + stun * (0.5 + 0.5 * Math.sin(time * 14))), 0.3, 0, 0, glow)
            if (b.hardened) inst.tint(P.n - 1, 0.16, 0.24, 0.36, 0.22)   // 甲壳硬化：整只泛冷钢色，一眼看出「正面打不动」。0.62 → 0.42、0.42 → 0.34：原来整只泛白，在白黄火花里更难认
            else inst.tint(P.n - 1, 0, 0, 0, 0)
          }
          corpse = { P, x: b.x, z: b.z, yaw: b.facing ?? 0 }
        }
      } else if (cur) {   // Boss 对象没了（结算后 / 换局）：什么都不画
        cur = null
      }
      for (const p of pools.values()) if (p) p.inst.commit(p.n)
    },
    /** 头顶血条 / 名字的锚点；没有 Boss 返回 null */
    anchor() { return cur && !hidden && corpse ? { x: rx, y: corpse.P.asset.bounds.max.y * corpse.P.scale + 0.6, z: rz, kind: cur.kind } : null },
  }
}
