// swarmview.js —— 虫海：读 world.swarm 的 SoA 数组，每帧写实例缓冲。每个虫种一个实例池 = 一个 draw call。
// 契约要点（ARCHITECTURE §2 变更记录）：
//   alive[i] === 1 包含 state === 2 的尸体；遍历 0..count-1；kind[i] 的枚举顺序 = ENEMY_KINDS
//   state: 0 走 / 1 攻击 / 2 死亡中（保留 2.1 秒）/ 3 潜地（不画）/ 4 眩晕
// 布防系统（ARCHITECTURE「第 6 步」）：
//   被装置挡住的虫：够得着的 state = 1（啃），排队的仍是 state = 0 但 vz = 0（原地踏步，朝前）
//   跳跃虫跃过装置的 0.5 秒：state = 0、y > 0（抛物线，最高 LEAP.y）、atkT = 还剩多久 —— 这里换成扑跃的姿势 + 起跳 / 落地的尘土
//   举盾虫：身前 120° 的直射只吃一成 —— 把位置交给 groundview 画盾弧（shields），盾本身在模型上
import { ENEMY_KINDS } from '../data/enemies.js'
import { LEAP } from '../data/devices.js'
import { createPool } from './assets.js'

const DEATH_DELAY = 0.08        // 表现延迟：子弹飞到了才倒（和 fx 的步枪延迟一致）
const TWO_PI = Math.PI * 2
// Boss 的「身位」椭圆（x 半宽、z 半深，米，已含模型缩放）。测试：
// 模拟里虫群直接穿过 Boss 往前走，护卫虫又从它身后刷出来——一大团小虫叠在 Boss 身上，只见血条不见本体。
// 只在表现层处理：落在身位里的活虫画到椭圆外沿（像是绕着它走），尸体不画（被它压在身下）。模拟、判定一概不动
const BOSS_FOOT = { ravager: [3.1, 4.2], matriarch: [2.6, 3.4], leviathan: [2.2, 2.2] }   // 碾压者渲染放大 1.4 倍（models/ai/register.js），身位跟着 ×1.35
// 出场头 3 秒（INTRO）：身位椭圆再外扩 INTRO_PUSH 倍，椭圆 INTRO_DIM 倍以内的虫压暗、去掉受击闪光——Boss 的剪影先立起来；
// 之后 0.8 秒渐回平时。平时 Boss 身边一圈的虫也轻压一档（NEAR_DIM），别让巨畸体的白骨板和 Boss 抢眼
const INTRO = 3, INTRO_FADE = 0.8, INTRO_PUSH = 0.3, INTRO_DIM = 2.0, NEAR_DIM = 0.86
// 镜头在队伍身后往前俯看：站在 Boss 前面（+z，离镜头更近）的虫会挡住它的下半身，椭圆往前多让 BOSS_FRONT 米；
// 大个头（甲壳兽 / 巨畸体这种护卫）再按自己的半宽外扩，免得一只大虫贴在 Boss 脸上
const BOSS_FRONT = 1.6

export function createSwarmView(ctx) {
  const pools = []               // kind 下标 -> pool（下标的含义跟着 swarm.kindNames 走，表换了就按名字重新对一遍）
  const byName = new Map()       // 'enemy.xxx' 的 xxx -> pool
  let names = ENEMY_KINDS
  const auras = []               // 护巢虫的光环：[x, z, r, ...]，交给 groundview 画
  const shields = []             // 举盾虫的盾弧：[x, z, r, ...]
  let air = new Uint8Array(0)    // 每个槽位上一帧是不是在半空（跳跃虫）：用来抓起跳 / 落地的那一帧
  const make = (name) => {
    let P = byName.get(name)
    if (P) return P
    P = createPool('enemy.' + name, ctx)
    if (P) {
      byName.set(name, P)
      const A = P.asset.clips, d = P.anim
      P.n = 0
      P.walkC = A[P.clipOr('walk', 'idle')]; P.atkC = A[P.clipOr('attack', 'walk')]; P.dieC = P.clip('die') ? A[P.clip('die')] : null
      P.stride = d.stride || 2.5; P.dieDur = d.dieDur || (P.dieC ? P.dieC.duration : 0.4); P.atkDur = d.attackDur || P.atkC.duration
      P.fly = !!d.fly; P.sink = d.sink !== false; P.aura = d.aura || 0
      P.shield = name === 'shieldbug' ? 1.25 : 0                      // 盾弧半径（再乘虫的体型）
      P.bulk = P.def.shadow && P.def.shadow.blob ? Math.max(0.2, P.def.shadow.blob[0] * 0.38 * P.scale) : 0.3   // 让开 Boss 时按自己的半宽外扩
      P.leap = name === 'leaper' && P.clip('attack') ? A[P.clip('attack')] : null // 腾空时用的姿势（跳跃虫的 attack clip 是「高跳扑下」，自带 1.2 的抬升）
      P.vary = P.inst.capacity > 500 ? 1 : 0.45   // 海量小虫的个体亮度 / 大小差异拉大
      P.flashK = P.def.material && P.def.material.type === 'textured' ? 0.22 :(P.vary === 1 || /^(leaper|burster)$/.test(name) ? 0.16 : 0.1)   // 小虫的底色很暗，闪光稍微给一点就是整只发橙：海量的那几种压到最低。大个头 0.3 → 0.1：Boss 身边的巨畸体 / 甲壳兽在集火下常亮受击色，一片肉粉色把 Boss 围住（实机 g2，关掉闪光对比明显）
      const L = P.def.lod
      if (L) { P.lodName = L.name.replace(/^enemy\./, ''); P.lodZ = L.z ?? 0; P.far = null }
    }
    return P
  }
  const poolOf = (k) => {
    let P = pools[k]
    if (P) return P
    if (P === null && (ctx.frame & 31) !== 0) return null   // glb 还没到：隔一阵再问
    P = make(names[k] || 'unknown' + k)
    pools[k] = P
    return P
  }
  let drawn = 0, bossRef = null, bossT0 = 0
  return {
    pools, auras, shields,
    /** 预建实例池：每个虫种的着色器随启动一起编译，它第一次出现的那一帧不卡。ok(逻辑名) 返回 false 的跳过 */
    prewarm(ok, regNames) { for (const n of regNames) if (n.startsWith('enemy.') && ok(n)) make(n.slice(6)) },
    reset() { for (const p of byName.values()) p.inst.commit(0) },
    update(world, time) {
      const s = world.swarm
      auras.length = 0; shields.length = 0
      for (const p of byName.values()) p.n = 0
      if (!s) { for (const p of byName.values()) p.inst.commit(0); return }
      const nm = s.kindNames || ENEMY_KINDS
      if (nm !== names) { names = nm; pools.length = 0 }          // 换了一张 kind 表（sim ↔ mock）：下标重新按名字对
      const podKind = names.indexOf('pod')
      const { alive, kind, x, z, y, vx, vz, state, stateT, elite, shield, scale, seed, hitT } = s
      const count = s.count, atkT = s.atkT, fx = ctx.fx
      if (air.length < count) { const a = new Uint8Array(Math.max(count, s.cap || 0, 1024)); a.set(air); air = a }
      const back = ctx.back || 0          // 位置插值：沿速度往回退这么多秒（renderer 按 render(alpha) 算好）
      const B = world.boss, bf = B && B.hp > 0 && B.state !== 'burrowed' && B.state !== 'dying' ? BOSS_FOOT[B.kind] : null
      const bX = bf ? B.x : 0, bZ = bf ? B.z : 0
      if (B !== bossRef) { bossRef = B; bossT0 = time }
      const since = time - bossT0
      const intro = bf === null || since < 0 ? 0 : since < INTRO ? 1 : Math.max(0, 1 - (since - INTRO) / INTRO_FADE)
      const push = 1 + INTRO_PUSH * intro
      for (let i = 0; i < count; i++) {
        if (alive[i] === 0) continue
        let st = state[i]
        if (st === 3) continue
        const kk = kind[i]
        if (kk === podKind) continue                              // 空投舱借用虫群槽位，但它不是虫：按 world.pods 画
        let P = poolOf(kk)
        if (!P) continue
        // LOD（注册项的 lod: { name, z }）：离防线远的（z < lod.z）、或者近景池已经满了的，改画低面数的那一份
        if (P.lodName && (z[i] < P.lodZ || P.n >= P.inst.capacity)) { const F = P.far || (P.far = make(P.lodName)); if (F) P = F }
        const n = P.n
        if (n >= P.inst.capacity) continue
        const sd = seed[i]
        let sc = scale[i] * P.scale * (1 - 0.1 * P.vary + sd * 0.2 * P.vary)
        let bright = 0.92 - 0.14 * P.vary + sd * 0.72 * P.vary + 0.08
        let yy = y ? y[i] : 0, roll = 0, glow = 1, flash = 0, fr
        const vxi = vx[i], vzi = vz[i], sp = Math.sqrt(vxi * vxi + vzi * vzi)
        const yaw = sp > 0.3 ? Math.atan2(vxi, vzi) : 0
        let td = 0
        if (st === 2) { td = time - stateT[i] - DEATH_DELAY; if (td < 0) st = 0 }
        if (st === 2) {
          air[i] = 0
          const dur = P.dieDur, c = P.dieC
          if (c) fr = c.start + Math.min(0.9999, td / dur) * (c.count - 1)
          else { const c0 = P.walkC; fr = c0.start; roll = Math.min(1, td / dur) * 2.6 * (sd > 0.5 ? 1 : -1) }
          if (td < 0.12) flash = (1 - td / 0.12) * P.flashK
          const late = td - dur
          if (late > 0) {
            if (!P.sink) continue                                   // 自爆 / 虫卵：炸完就没了
            const k = late > 0.5 ? (late - 0.5) * 0.9 : 0           // 躺半秒再下沉变暗
            yy -= k * 0.5; bright *= Math.max(0.12, 1 - late * 0.7); glow = Math.max(0, 1 - late * 1.6)
          } else glow = 1 - 0.5 * (td / dur)
          if (P.fly) yy = Math.max(0.05, yy - td * td * 9)          // 飞行虫掉下来
        } else {
          const h = time - hitT[i]
          if (h >= 0 && h < 0.14) flash = (1 - h / 0.14) * P.flashK      // 挨打泛红：大个头在集火下 hitT 每步都在刷新，不压一下整只会一直是橙色的
          if (yy > 0.02 && !P.fly && st !== 4) {
            // 跳跃虫在半空：按抛物线的进度摆扑跃姿势（u 从模拟的剩余时间来；拿不到就按高度反推前半程）。
            // 姿势自己带抬升，模拟给的高度只用一部分，合起来峰值和 LEAP.y 差不多
            const c = P.leap || P.walkC
            let u = atkT ? 1 - atkT[i] / LEAP.dur : 0.5 - 0.5 * Math.sqrt(Math.max(0, 1 - yy / LEAP.y))
            u = u < 0 ? 0 : u > 0.9999 ? 0.9999 : u
            fr = c.start + u * (c.count - 1)
            if (P.leap) yy *= 0.45
            sc *= 1 + 0.18 * Math.sin(u * Math.PI)                 // 俯视机位下高度不好读：腾空时略放大 + 提亮，配合脚下的影子变淡
            bright *= 1.25
            if (air[i] === 0) { air[i] = 1; if (fx && fx.take('spark')) { fx.burst(x[i], 0.15, z[i], 5, 2.6, 0.35, 0.3, 0.1, 0.085, 0.075, { alpha: true, a: 0.5, cell: fx.CELL.SMOKE_A, up: 1.2, grav: 0, drag: 2, stretch: 0, grow: 2.2 }); fx.ring(x[i], z[i], 0.25, 0.3, 1.6, 0.9, 0.5, 0.25) } }
          } else if (st === 1) {
            const c = P.atkC; let u = (time - stateT[i]) / P.atkDur
            if (c.loop) { u -= Math.floor(u); fr = c.start + u * c.count } else fr = c.start + (u > 0.9999 ? 0.9999 : u) * (c.count - 1)
          } else {
            const c = P.walkC
            let u = st === 4 ? sd * 3.7 : (P.fly ? time / c.duration : time * Math.min(5, Math.max(0.7, sp / P.stride))) + sd * 9.3
            u -= Math.floor(u); fr = c.start + u * c.count
            if (st === 4) { roll = Math.sin(time * 9 + sd * 40) * 0.12; bright *= 0.85 }
          }
          if (P.aura > 0) auras.push(x[i], z[i], P.aura)
          if (P.shield > 0 && shields.length < 96) shields.push(x[i], z[i] + 0.15, P.shield * scale[i])
          if (air[i] === 1 && !(y && y[i] > 0.02)) {                // 落地：一圈尘土
            air[i] = 0
            if (fx && !P.fly && fx.take('spark')) { fx.burst(x[i], 0.12, z[i], 6, 3.2, 0.4, 0.34, 0.1, 0.085, 0.075, { alpha: true, a: 0.55, cell: fx.CELL.SMOKE_A, up: 0.8, grav: 0, drag: 2.4, stretch: 0, grow: 2.4 }); fx.ring(x[i], z[i], 0.3, 0.4, 2.2, 0.9, 0.5, 0.25) }
          }
        }
        // 只有在走 / 在飞的才回退；攻击、眩晕、死亡中的位置不动（它们的 vx / vz 可能是停下前的残值）
        // 甲壳兽 / 刺脊虫边走边打：攻击态也在前进（模拟里站定开火时 vz 一定清 0），只按 vz 回退，否则在走 / 打两态之间每次都会往前跳一截
        let px = x[i], pz = z[i]
        if (st === 0 && back > 0) { px -= vxi * back; pz -= vzi * back } else if (st === 1 && back > 0 && vzi !== 0) pz -= vzi * back
        if (bf !== null && !(P.fly && yy > 0.6)) {
          const ax = bf[0] * push + P.bulk, az = (pz > bZ ? bf[1] + BOSS_FRONT : bf[1]) * push + P.bulk
          const ux = (px - bX) / ax, uz = (pz - bZ) / az, e2 = ux * ux + uz * uz
          if (st !== 2 && e2 < INTRO_DIM * INTRO_DIM) {
            const near = 1 - Math.sqrt(e2) / INTRO_DIM                // 1 = 贴着 Boss，0 = 压暗圈的外沿
            const k = Math.min(1, near * 2.2)
            bright *= 1 - k * ((1 - NEAR_DIM) + (0.45 - (1 - NEAR_DIM)) * intro)
            glow *= 1 - k * 0.6 * intro
            flash *= 1 - intro
          }
          if (e2 < 1) {
            if (st === 2) continue                                   // 尸体：压在 Boss 身下，不画
            const e = Math.sqrt(e2)
            let dx = ux, dz = uz
            if (e < 0.05) { const a = sd * TWO_PI; dx = Math.cos(a); dz = Math.sin(a) } else { dx /= e; dz /= e }
            const k = 1 + 0.22 * e                                   // 挤到外沿，原来越靠外的还在越外面，不叠成一条线
            px = bX + dx * k * ax; pz = bZ + dz * k * az
          }
        }
        P.inst.put(n, px, yy, pz, yaw, sc, fr, bright, flash, sd, roll, 0, glow)
        if (elite[i]) P.inst.tint(n, 1.0, 0.72, 0.15, 0.8)
        else if (shield[i] > 0) P.inst.tint(n, 0.3, 0.8, 1.0, 0.55)
        else if (P.tinted) P.inst.tint(n, 0, 0, 0, 0)
        if (elite[i] || shield[i] > 0) P.tinted = true
        P.n = n + 1
      }
      drawn = 0
      for (const p of byName.values()) { p.inst.commit(p.n); drawn += p.n }
    },
    count() { return drawn },
  }
}
