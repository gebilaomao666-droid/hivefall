// 实机自测用的「试玩手」：在浏览器里把一局游戏从头打到尾，但**只通过真实的输入链路**——
// 往 window 派发 KeyboardEvent（A / D 走位、1~8 选装置卡、Q/W/E/R 技能、1/2/3 选升级牌），
// 往画布派发 PointerEvent（点格子放装置、划线瞄准）。它不碰 world，不调 main.js 的任何内部函数；
// 读 world 只是为了「看画面做决定」（人是用眼睛看的）。
//
// 用法（游戏页的控制台 / 自动化工具里）：
//   const { createPilot } = await import('/tools/playtest-pilot.js')
//   const pilot = createPilot(); pilot.start()      // 开始接管键鼠
//   pilot.stop(); pilot.log                         // 停下 / 看它做过什么
// 前提：index.html 已经在战斗里（__hf.mode === 'play'）。结算、继续深入、回首页这些界面操作不归它管。
export function createPilot(opts = {}) {
  const hf = window.__hf
  const canvas = document.getElementById('c')
  const log = { keys: {}, places: [], removes: 0, powers: {}, aims: 0, picks: [], rerolls: 0, moves: 0, dodges: 0, errors: [] }
  const held = { a: false, d: false }
  let luSeen = 0, timer = 0, tick = 0, gateIdx = -1, gateSide = 1, placing = null, lastPickT = 0, aimT = 0, rerolled = false
  const count = (o, k) => { o[k] = (o[k] || 0) + 1 }

  const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: /^[0-9]$/.test(k) ? 'Digit' + k : 'Key' + k.toUpperCase(), bubbles: true, cancelable: true }))
  const tap = k => { key('keydown', k); key('keyup', k); count(log.keys, k) }
  function hold(dir) {
    const want = { a: dir < 0, d: dir > 0 }
    for (const k of ['a', 'd']) {
      if (want[k] && !held[k]) { key('keydown', k); held[k] = true; log.moves++ }
      else if (!want[k] && held[k]) { key('keyup', k); held[k] = false }
    }
  }
  function pointer(type, x, y, extra) {
    canvas.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true }, extra || {})))
  }
  /** 世界坐标 → 屏幕坐标（人是直接看着点的） */
  function screenOf(x, z) {
    const r = canvas.getBoundingClientRect(), p = hf.view.project(x, 0, z)
    return { x: r.left + p.x, y: r.top + p.y }
  }
  const click = (x, z) => { const s = screenOf(x, z); pointer('pointermove', s.x, s.y, { buttons: 0 }); pointer('pointerdown', s.x, s.y); pointer('pointerup', s.x, s.y) }

  // ---- 升级选牌：偏好图纸 > 主力兵种的牌 > 稀有度高的
  function scoreCard(c, world) {
    let s = c.rarity === 'legendary' ? 3 : c.rarity === 'elite' ? 2 : 1
    if (c.unlock) s += 5
    if (c.unit === 'rifle') s += 3
    if (c.unit && world.squad.counts[c.unit] > 0) s += 1.5
    if (c.unit && !world.squad.counts[c.unit]) s -= 4
    if (c.completes) s += 3
    if (c.heroic) s += 4
    return s
  }

  // ---- 布防计划：和人会做的一样——先两个采集器，再哨戒塔，塔前顶路障，有钱了上大件
  const PLAN = [
    ['collector', 0, 0], ['collector', 4, 0], ['sentry', 2, 1], ['barricade', 2, 2], ['sentry', 1, 1], ['sentry', 3, 1],
    ['barricade', 1, 2], ['barricade', 3, 2], ['mine', 2, 3], ['cryo', 2, 0], ['mortarpit', 1, 0], ['mortarpit', 3, 0],
    ['scorcher', 2, 3], ['sentry', 0, 1], ['sentry', 4, 1], ['mine', 1, 3], ['mine', 3, 3], ['barricade', 0, 2], ['barricade', 4, 2],
  ]
  function nextBuild(world) {
    for (const [kind, lane, row] of PLAN) {
      if (world.grid.cells[lane][row]) continue
      const card = world.cards.find(c => c.kind === kind)
      if (!card || !card.unlocked) continue
      if (world.boss && world.grid.rowZ[row] < world.boss.z + 4) continue
      if (card.cdLeft > 0) continue                                               // 冷却中的先跳过，看下一项
      return card.ready ? { kind, lane, row, key: String(card.key) } : null      // 最优先的那个还买不起：攒着
    }
    // 聚变炸弹：中路虫堆大了就扔
    const nova = world.cards.find(c => c.kind === 'nova')
    if (nova && nova.ready && world.swarm.living > 900) for (const row of [2, 3, 1]) for (const lane of [2, 1, 3]) if (!world.grid.cells[lane][row]) return { kind: 'nova', lane, row, key: String(nova.key) }
    return null
  }

  function dangerAt(world, x) {
    for (const tg of world.telegraphs) {
      if (tg.team !== 'enemy') continue
      if (tg.shape === 'lane') { if (Math.abs(x - tg.x) < tg.w / 2 + 0.35) return tg }
      else if (tg.shape === 'circle') { if (Math.abs(x - tg.x) < tg.r + 0.35 && tg.z > world.squad.frontZ - tg.r - 6) return tg }
    }
    for (const z of world.zones) if (z.team === 'enemy' && Math.abs(x - z.x) < (z.r || 1) + 0.3 && z.z > world.squad.frontZ - 5) return z
    return null
  }

  function step() {
    try {
      const world = hf.world
      if (!world || hf.mode !== 'play') { hold(0); return }
      tick++
      const now = performance.now()
      const st = world.status
      if (st === 'won' || st === 'lost' || st === 'retreated') { hold(0); return }
      if (hf.paused) { hold(0); return }

      // ---- 升级三选一：键盘 1 / 2 / 3（偶尔用 ← → + Enter，试一次 R 重掷）
      if (st === 'levelup' && world.levelup) {
        hold(0)
        if (now - lastPickT < 900) return
        if (!luSeen) { luSeen = now; return }
        if (now - luSeen < 450) return                       // 面板刚弹出的 0.35 秒不收输入（防误选）：人也得先看一眼牌
        lastPickT = now
        const cards = world.levelup.cards
        if (!rerolled && world.levelup.rerolls > 0 && world.levelup.kind !== 'vanguard' && world.progress.level >= 3) { rerolled = true; tap('r'); log.rerolls++; return }
        let best = 0, bs = -99
        cards.forEach((c, i) => { const s = scoreCard(c, world); if (s > bs) { bs = s; best = i } })
        if (log.picks.length % 4 === 3) {
          // 方向键 + 回车这条路也走一走：默认选中第 2 张（下标 1）
          let cur = Math.min(1, cards.length - 1)
          while (cur !== best) { const k = best > cur ? 'ArrowRight' : 'ArrowLeft'; key('keydown', k); key('keyup', k); cur += best > cur ? 1 : -1 }
          key('keydown', 'Enter'); key('keyup', 'Enter')
          log.picks.push({ lv: world.levelup.level, i: best, id: cards[best].id, via: 'arrows+enter' })
          luSeen = 0
        } else {
          tap(String(best + 1))
          log.picks.push({ lv: world.levelup.level, i: best, id: cards[best].id, via: 'digit' })
        }
        luSeen = 0
        return
      }

      // ---- 划线瞄准：在画布上拖一条线
      if (st === 'aiming' && world.aiming) {
        if (now - aimT > 500) {
          aimT = now
          const a = world.aiming.auto, p0 = screenOf(a.x0, a.z0), p1 = screenOf(a.x1, a.z1)
          pointer('pointerdown', p0.x, p0.y)
          pointer('pointermove', (p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
          pointer('pointermove', p1.x, p1.y)
          pointer('pointerup', p1.x, p1.y)
          log.aims++
        }
      }

      // ---- 走位：门 → 选边；红圈红带 → 躲；平时跟着虫群重心
      const sq = world.squad
      let want = 0
      const g = world.gates
      if (g) {
        if (g.index !== gateIdx) {
          gateIdx = g.index
          const val = o => (o.type === 'contract' ? 30 : o.type === 'device' ? 26 : o.type === 'unit' ? (o.count || 1) * (o.unit === 'rifle' ? 1 : 2.5) + (o.extra ? o.extra.count : 0) : o.type === 'module' ? 9 : 4)
          gateSide = val(g.left) > val(g.right) ? -1 : 1
        }
        want = gateSide * 1.4
      } else {
        const s = world.swarm
        let sx = 0, sw = 0
        for (let i = 0; i < s.count; i += 3) { if (!s.alive[i] || s.state[i] === 2 || s.z[i] < -10) continue; const w = s.z[i] + 12; sx += s.x[i] * w; sw += w }
        want = Math.max(-0.9, Math.min(0.9, sw > 0 ? (sx / sw) * 0.6 : 0))
      }
      if (dangerAt(world, want) || dangerAt(world, sq.x)) {
        // 找最近的安全位置
        let best = null
        for (let d = 0; d <= 8.6; d += 0.3) for (const sgn of [1, -1]) { const x = Math.max(-4.3, Math.min(4.3, sq.x + sgn * d)); if (!dangerAt(world, x)) { if (best === null) best = x } }
        if (best !== null) { want = best; log.dodges++ }
      }
      const dx = want - sq.targetX
      hold(Math.abs(dx) < 0.5 ? 0 : dx)

      // ---- 技能：好了就放
      if (tick % 5 === 0 && st === 'running') for (const p of world.powers) if (p.ready && world.swarm.living > 25) { tap(p.key); count(log.powers, p.id); break }

      // ---- 布防：数字键选卡 → 下一拍点格子
      if (st === 'running') {
        if (placing) {
          const sel = hf.ui.selectedDevice()
          if (sel === placing.kind) { click(world.grid ? world.lanes[placing.lane].x : 0, world.grid.rowZ[placing.row]); log.places.push({ t: +world.time.toFixed(1), kind: placing.kind, lane: placing.lane, row: placing.row }) }
          placing = null
        } else if (tick % 4 === 0) {
          const sel = hf.ui.selectedDevice()
          const b = nextBuild(world)
          if (sel) {
            // 卡已经选着（被升级面板打断，或人手动选过）：是要放的那张就直接去点，不是就右键取消
            if (b && b.kind === sel) placing = b
            else canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
          } else if (b) { tap(b.key); placing = b }
        }
      }
    } catch (e) { log.errors.push(String(e && e.stack || e)) }
  }

  return {
    log,
    start(ms = opts.interval || 50) { if (!timer) timer = setInterval(step, ms); return 'pilot on' },
    stop() { clearInterval(timer); timer = 0; hold(0); return log },
    get running() { return !!timer },
    step, tap, key, click, pointer, screenOf,
  }
}
