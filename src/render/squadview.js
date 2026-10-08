// squadview.js —— 我方部队：按 kind 分实例池，读 world.squad.units 每帧写实例缓冲。
// 朝向用 unit.facing（= atan2(dx, dz)，默认 π 朝 -z）；开火 / 受击闪烁读 fireT / hitT；
// 雇佣兵（unit.elite = 'bloodhound' | 'hammer' | 'goliath'）换成红黑涂装的变体模型 unit.merc_<elite> 并略放大
// （变体没注册时退回本兵种模型 + 染金橙）；英雄级起了名字的（unit.name）队色提亮；阵亡的播 die clip 后下沉。
// 位置插值：每个单位按模拟时间的增量估速度，画的时候往回退 ctx.back 秒（renderer 按 alpha 算好）。
import * as THREE from 'three'
import { createPool, has as hasAsset } from './assets.js'

// 和 data/contracts.js 的 elite.scale 一致；hammer 1.2 → 1.08：「重锤」自行炮本来就是全队最长的车（近 4 米），再放大两成车头直接插进步兵方阵（测试 rv-12）
const ELITE_SCALE = { bloodhound: 1.15, hammer: 1.08, goliath: 1.6 }
const TINT_ELITE = [1.0, 0.5, 0.08], TINT_NAMED = [0.10, 0.45, 1.0]
const _mz = [0, 0, 0]
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d }

export function createSquadView(ctx) {
  const pools = new Map()          // kind -> pool | null(glb 还没到)
  const state = new Map()          // unit.id -> 渲染侧状态
  const corpses = []               // { pool, x, z, yaw, scale, t0, seed, elite }
  const anchors = []
  let lastWorld = null
  const poolOf = (kind) => {
    let p = pools.get(kind)
    if (p === undefined || p === null) { p = createPool('unit.' + kind, ctx); pools.set(kind, p); if (p) { p.n = 0; p.merc = kind.startsWith('merc_') } }
    return p
  }
  /** 这个单位用哪个池：雇佣兵走 unit.merc_<elite>（models/humans/register.js 注册了三个），没有就用本兵种的 */
  const poolKey = (u) => (u.elite && hasAsset('unit.merc_' + u.elite) ? 'merc_' + u.elite : u.kind)
  // 英雄脚下的识别环
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.1, 1.5), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  const rings = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48), ringMat); m.rotation.x = -Math.PI / 2; m.renderOrder = 3; m.visible = false; ctx.scene.add(m); return m })

  const api = {
    pools,
    /** 预建实例池（含雇佣兵变体）：着色器随启动一起编译，增援 / 合同到手的那一帧不卡 */
    prewarm(ok, names) { for (const n of names) if (n.startsWith('unit.') && ok(n)) poolOf(n.slice(5)) },
    reset() { state.clear(); corpses.length = 0; for (const p of pools.values()) if (p) p.inst.commit(0) },
    /** 每帧：time = world.time，dt = 本帧模拟时间增量 */
    update(world, time, dt) {
      if (world !== lastWorld) { api.reset(); lastWorld = world }
      for (const p of pools.values()) if (p) p.n = 0
      anchors.length = 0
      const back = ctx.back || 0
      let ringN = 0
      const units = world.squad ? world.squad.units : []
      // 步兵方阵最后一排的 z（主机位里是最靠下那排）：炮车 / 机甲的车头、炮管不许伸进去。
      // 模拟层给的间距是按车身中心算的，炮管长短是模型的事，所以在渲染层把它们的画面位置往后让一点（最多 1.1 米，平滑过渡不跳；让得太多会被底部装置卡栏挡住，所以封顶 1.1 米）
      let infRear = -Infinity
      for (let i = 0; i < units.length; i++) { const u = units[i]; if (!u.alive || !u._def) continue; const c = u._def.cls; if ((c === 'infantry' || c === 'hero') && u.z > infRear) infRear = u.z }
      for (let i = 0; i < units.length; i++) {
        const u = units[i]
        if (!u.alive) continue
        const P = poolOf(poolKey(u))
        if (!P || P.n >= P.inst.capacity) continue
        let st = state.get(u.id)
        if (!st) { st = { yaw: u.facing ?? Math.PI, x: u.x, z: u.z, vx: 0, sx: u.x, sz: u.z, st: time, wx: 0, wz: 0, rx: u.x, rz: u.z, seed: (u.id * 0.6180339887) % 1, pool: P, kind: u.kind, scale: 1, t: time }; state.set(u.id, st) }
        // 速度（插值用）：按模拟时间的增量估，一帧里模拟走了几步都对；瞬移（补位 / 重生）不算
        if (time > st.st) { const k = 1 / (time - st.st), dx = u.x - st.sx, dz = u.z - st.sz; if (dx * dx + dz * dz < 1.0) { st.wx = dx * k; st.wz = dz * k } else st.wx = st.wz = 0; st.sx = u.x; st.sz = u.z; st.st = time }
        else if (time < st.st) { st.sx = u.x; st.sz = u.z; st.st = time; st.wx = st.wz = 0 }
        const A = P.anim, inst = P.inst
        // 朝向：步兵直接跟，载具 / 机甲按转速跟；turn = 0 的不转
        const want = u.facing ?? Math.PI
        if (A.turn === 0) st.yaw = Math.PI
        else st.yaw += angDiff(st.yaw, want) * Math.min(1, dt * (A.turn || 14))
        const vx = dt > 0 ? Math.hypot(u.x - st.x, u.z - st.z) / dt : 0
        st.vx += (vx - st.vx) * Math.min(1, dt * 10); st.x = u.x
        const moving = st.vx > 1.2
        const sinceFire = time - (u.fireT ?? -9), sinceHit = time - (u.hitT ?? -9)
        let frame
        const shoot = P.clip('shoot')
        if (shoot && sinceFire >= 0 && sinceFire < (A.shootLoop ? (A.shootHold || 0.3) : (A.shootDur || 0.5))) {
          frame = A.shootLoop ? inst.frameAt(shoot, time + st.seed) : inst.frame(shoot, sinceFire / (A.shootDur || 0.5))
        } else if (moving && P.clip('walk')) frame = inst.frameAt(P.clip('walk'), time + st.seed)
        else frame = inst.frameAt(P.clipOr('idle', 'walk'), time + st.seed * 3)
        let flash = sinceFire >= 0 && sinceFire < 0.07 ? (1 - sinceFire / 0.07) * 0.6 : 0
        if (sinceHit >= 0 && sinceHit < 0.2) flash = -(1 - sinceHit / 0.2)
        const scale = P.scale * (u.elite ? ELITE_SCALE[u.elite] || 1.12 : 1)
        // 模型包围盒前后不对称的（自行炮：炮管往前伸 3 米、车尾只有 1.8 米）按包围盒中心摆，而不是按建模原点摆：
        // 否则模拟给它留的「车身一半」的空隙不够，车头会插进前面的步兵里。只在偏差 > 0.25 米时生效（步兵 / 机甲都是居中的）
        const bz = P.asset.bounds, cz = (bz.min.z + bz.max.z) * 0.5 * scale, rc = Math.abs(cz) > 0.25 ? cz : 0
        const ux = u.x - st.wx * back - rc * Math.sin(st.yaw)
        let uz = u.z - st.wz * back - rc * Math.cos(st.yaw)
        const cls = u._def ? u._def.cls : 'infantry'
        if (cls !== 'infantry' && cls !== 'hero' && infRear > -Infinity && Math.abs(st.yaw - Math.PI) < 0.9) {
          // 朝 -z 时模型的 +z（车头 / 炮管）在世界里往 -z 伸：车头的世界 z = uz - bounds.max.z × scale（uz 已含按包围盒中心的挪动）
          const reach = bz.max.z * scale, need = infRear + 0.35 + reach - uz
          st.push = (st.push || 0) + (Math.min(1.1, Math.max(0, need)) - (st.push || 0)) * Math.min(1, dt * 6)
          uz += st.push
        } else st.push = 0
        const n = P.n++
        inst.put(n, ux, 0, uz, st.yaw, scale, frame, 0.94 + st.seed * 0.16, flash, st.seed, 0, 0, 1 + (u.shield > 0 ? 0.5 : 0) + (u.name ? 0.08 : 0))
        if (u.elite && !P.merc) inst.tint(n, TINT_ELITE[0], TINT_ELITE[1], TINT_ELITE[2], 1)   // 没有红黑变体时才染色
        else if (u.elite) inst.tint(n, 0, 0, 0, 0)
        else if (u.name) inst.tint(n, TINT_NAMED[0], TINT_NAMED[1], TINT_NAMED[2], 0.16)   // 英雄级起了名字的：队色更亮一档（不改目镜）。0.4 → 0.16、发光 +0.35 → +0.08：英雄级小队动辄四五十人带名字，原来整片罩一层蓝色轮廓光 + 自发光 = 测试说的「淡紫白的幽灵方阵」
        else inst.tint(n, 0, 0, 0, 0)
        st.pool = P; st.kind = u.kind; st.z = u.z; st.scale = scale; st.rx = ux; st.rz = uz; st.t = time
        if (u.name || u.elite || P.def.hero) anchors.push({ id: u.id, kind: u.kind, name: u.name || null, elite: u.elite || false, hero: !!P.def.hero, x: ux, y: P.asset.bounds.max.y * scale + 0.25, z: uz })
        if (P.def.hero && ringN < rings.length) { const r = rings[ringN++]; r.visible = true; r.position.set(ux, 0.03, uz); r.scale.setScalar(scale * 0.9) }
      }
      for (let k = ringN; k < rings.length; k++) rings[k].visible = false
      // 阵亡的：播 die，然后下沉淡出
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i], P = c.pool, td = time - c.t0
        if (td > 2.2 || td < 0 || P.n >= P.inst.capacity) { corpses[i] = corpses[corpses.length - 1]; corpses.pop(); continue }
        const die = P.clip('die'), dur = die ? P.asset.clips[die].duration : 0.5
        const frame = die ? P.inst.frame(die, td / dur) : P.inst.frameAt(P.clipOr('idle', 'walk'), 0)
        const late = Math.max(0, td - dur - 0.5)
        const n = P.n++
        P.inst.put(n, c.x, -late * 0.6, c.z, c.yaw, c.scale, frame, Math.max(0.15, 0.8 - late * 0.5), td < 0.2 ? -(1 - td / 0.2) : 0, c.seed, die ? 0 : Math.min(1.5, td * 3), 0, Math.max(0, 1 - td * 1.5))
        P.inst.tint(n, 0, 0, 0, 0)
      }
      for (const p of pools.values()) if (p) p.inst.commit(p.n)
    },
    consume(events, time) {
      for (const e of events) {
        if (e.type !== 'unitDie') continue
        const st = state.get(e.id); state.delete(e.id)
        const P = st ? st.pool : poolOf(e.elite && hasAsset('unit.merc_' + e.elite) ? 'merc_' + e.elite : e.kind)
        if (P && corpses.length < 48) corpses.push({ pool: P, x: e.x, z: e.z, yaw: st ? st.yaw : Math.PI, scale: st ? st.scale : P.scale, t0: time, seed: st ? st.seed : 0 })
      }
    },
    /** 枪口的世界坐标（特效用）。k：双联武器的第几个炮口 */
    muzzle(id, out, k = 0) {
      if (id === 'companion') return api.companion ? api.companion.muzzle(out, k) : false
      const st = state.get(id); if (!st) return false
      const P = st.pool, sc = st.scale
      let mz = (P.meta.muzzles && P.meta.muzzles[k % P.meta.muzzles.length]) || P.meta.muzzle   // 取模：「天钩」这类轮流开火的武器 k 会一直往上数
      const ob = P.meta.orbit
      if (ob) {
        // 子机绕母机转的单位（「天钩」）：弹道从第 k 架子机当前的位置出，而不是从母机中心。
        // 和建模里 shoot clip 的姿态函数对齐：orbit 骨绕 Y 转一圈 / clip 时长，半径 × shootR，子机上下浮动
        const clip = P.clip('shoot'), dur = clip ? P.asset.clips[clip].duration : 2
        const u = ((st.t + st.seed) / dur) % 1, a0 = (k % ob.n) * Math.PI * 2 / ob.n, a = u * Math.PI * 2
        const px = Math.cos(a0) * ob.r * (ob.shootR || 1), pz = Math.sin(a0) * ob.r * (ob.shootR || 1)
        mz = _mz; mz[0] = px * Math.cos(a) + pz * Math.sin(a); mz[1] = ob.y + (ob.bob || 0) * Math.sin(u * Math.PI * 4 + (k % ob.n) * 2.1) - 0.12; mz[2] = -px * Math.sin(a) + pz * Math.cos(a)
      }
      if (!mz) { out.set(st.rx, 0.8 * sc, st.rz); return true }
      const s = Math.sin(st.yaw), c = Math.cos(st.yaw)
      out.set(st.rx + (mz[0] * c + mz[2] * s) * sc, mz[1] * sc, st.rz + (-mz[0] * s + mz[2] * c) * sc)
      return true
    },
    /** 找一个指定 kind 的单位的枪口（横扫光束这类事件不带 unit id），离 nearX 最近的 */
    find(kind, nearX, out) {
      let best = null, bd = 1e9
      for (const [id, st] of state) { if (st.kind !== kind) continue; const d = Math.abs(st.x - nearX); if (d < bd) { bd = d; best = id } }
      return best != null && api.muzzle(best, out)
    },
    /** 称号 / 头顶标记的世界坐标锚点：[{ id, kind, name, elite, hero, x, y, z }] */
    anchors() { return anchors },
    count() { let n = 0; for (const p of pools.values()) if (p) n += p.n; return n },
  }
  return api
}
