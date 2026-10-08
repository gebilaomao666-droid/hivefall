// 输入层：键盘 / 鼠标 / 触屏 / 手柄 → world.step(input) 吃的那个 input 对象。
// 只在浏览器里跑（main.js 用）。不改 world；布防预览、瞄准线通过 view 的接口画。
//
//   const input = createInput({ canvas, view, ui, getWorld, isLive })
//   每个模拟步：world.step(input.collect(world))      // 一次性的意图（技能 / 选卡 / 放置 / 铲除 / 瞄准线）取走即清
//   每帧：input.update(world)                           // 刷新布防预览、收尾瞄准线、轮询手柄
//   UI 回调里：input.power(key) / input.pick(i) / input.reroll() / input.retreat() / input.abandon() / input.continueEndless()
//
// 键位：A / D、← / → 平移队伍；鼠标左键按住拖动 / 触屏拖动 = 相对平移（拖多少走多少，不是「点哪去哪」）；
//   数字键 1~8 / X 选装置卡（UI 层处理）后点格子放置 / 铲除，右键取消；
//   Q / W / E / R 放技能（UI 层处理后调 input.power）；划线瞄准的技能：按住拖一条线松开，或单击一点（从队伍指向那一点）。
import { FORMATION } from './data/units.js'

const X_LIMIT = (FORMATION && FORMATION.xLimit) || 4.3
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export function createInput({ canvas, view, ui, getWorld, isLive, onGamepadPause = null }) {
  const out = { moveX: null, targetX: null, powers: [], aim: null, pick: null, reroll: false, continueEndless: false, retreat: false, abandon: false, place: null, remove: null }
  const q = { powers: [], aim: null, pick: null, reroll: false, cont: false, retreat: false, abandon: false, place: null, remove: null }
  const keys = { left: false, right: false, last: 0 }
  let drag = null            // 相对拖动：{ id, x0, base, k }
  let dragTarget = null      // 拖动算出来的队伍目标 x（还没交给模拟的）
  let aimDrag = null         // 划线瞄准：{ id, x0, z0, moved }
  const pointer = { x: 0, y: 0, has: false }
  let padAxis = 0
  const padPrev = []
  const stat = { keydown: 0, pointerdown: 0, drags: 0, places: 0, removes: 0, powers: 0, picks: 0, aims: 0 }   // 自测用：确认走的是真实输入链路

  const live = () => (isLive ? isLive() : true)
  const powersFx = () => (view && view.debug && view.debug.gate ? view.debug.gate.powers : null)
  const setAimLine = l => { const p = powersFx(); if (p && p.setAimLine) p.setAimLine(l) }

  // ------------------------------------------------------------ 键盘（1~8 / X / QWER / Esc / Tab / P 由 UI 层在捕获阶段处理）
  const dirOf = k => (k === 'a' || k === 'A' || k === 'ArrowLeft' ? -1 : k === 'd' || k === 'D' || k === 'ArrowRight' ? 1 : 0)
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const d = dirOf(e.key)
    if (!d) return
    if (!e.repeat) stat.keydown++
    if (d < 0) keys.left = true; else keys.right = true
    keys.last = d
    dragTarget = null
    if (live()) e.preventDefault()
  }
  function onKeyUp(e) {
    const d = dirOf(e.key)
    if (d < 0) keys.left = false; else if (d > 0) keys.right = false
  }
  function releaseAll() { keys.left = keys.right = false; drag = null; dragTarget = null; if (aimDrag) { aimDrag = null; setAimLine(null) } }

  // ------------------------------------------------------------ 布防预览
  function refreshPlacement() {
    const world = getWorld()
    const kind = ui.selectedDevice()
    if (!kind || !world || !live()) { view.setPlacement(null); return }
    const c = pointer.has ? view.pickCell(pointer.x, pointer.y) : null
    if (kind === 'remove') {
      // 铲除：全部格子亮出来，被占的是红的；指着的那格加亮。不画虚影和范围
      view.setPlacement({ kind: 'remove', lane: c ? c.lane : null, row: c ? c.row : null, valid: false })
      return
    }
    const card = world.cards ? world.cards.find(k => k.kind === kind) : null
    view.setPlacement({ kind, lane: c ? c.lane : null, row: c ? c.row : null, valid: !card || card.ready })
  }

  // ------------------------------------------------------------ 鼠标 / 触屏
  /** 队伍那一排上，屏幕横向 1 个 CSS 像素对应多少米 */
  function metersPerPixel(world) {
    const r = canvas.getBoundingClientRect()
    const p = view.project(0, 0, world.squad.frontZ)
    const y = r.top + p.y, x = r.left + r.width / 2
    const a = view.pickGround(x - 50, y), b = view.pickGround(x + 50, y)
    const k = a && b ? (b.x - a.x) / 100 : 0
    return k > 0.002 && k < 0.2 ? k : 12.8 / Math.max(320, r.width)
  }
  function onPointerDown(e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.has = true
    const world = getWorld()
    if (!world || !live()) return
    if (e.button !== 0 && e.pointerType === 'mouse') return
    stat.pointerdown++
    // 1. 划线瞄准
    if (world.status === 'aiming') {
      const p = view.pickGround(e.clientX, e.clientY)
      if (p) { aimDrag = { id: e.pointerId, x0: p.x, z0: p.z, moved: false }; try { canvas.setPointerCapture(e.pointerId) } catch (err) { /* 合成事件没有活动指针 */ } }
      e.preventDefault()
      return
    }
    // 2. 布防：选了卡就点格子
    const kind = ui.selectedDevice()
    if (kind) {
      const c = view.pickCell(e.clientX, e.clientY)
      if (c) {
        if (kind === 'remove') { q.remove = { lane: c.lane, row: c.row }; stat.removes++ }
        else { q.place = { kind, lane: c.lane, row: c.row }; stat.places++ }
      }
      refreshPlacement()
      e.preventDefault()
      return
    }
    // 3. 相对拖动
    drag = { id: e.pointerId, x0: e.clientX, base: world.squad.targetX, k: metersPerPixel(world) }
    stat.drags++
    try { canvas.setPointerCapture(e.pointerId) } catch (err) { /* 同上 */ }
    e.preventDefault()
  }
  function onPointerMove(e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.has = true
    if (aimDrag && e.pointerId === aimDrag.id) {
      const p = view.pickGround(e.clientX, e.clientY)
      if (p) {
        if (Math.hypot(p.x - aimDrag.x0, p.z - aimDrag.z0) > 0.6) aimDrag.moved = true
        if (aimDrag.moved) setAimLine({ x0: aimDrag.x0, z0: aimDrag.z0, x1: p.x, z1: p.z })
      }
      return
    }
    if (drag && e.pointerId === drag.id) { dragTarget = clamp(drag.base + (e.clientX - drag.x0) * drag.k, -X_LIMIT, X_LIMIT); return }
    if (ui.selectedDevice()) refreshPlacement()
  }
  function onPointerUp(e) {
    if (aimDrag && e.pointerId === aimDrag.id) {
      const world = getWorld()
      const p = view.pickGround(e.clientX, e.clientY)
      if (world && world.status === 'aiming' && p) {
        // 拖出了一条线就用它；只是点了一下 = 从队伍指向那一点
        q.aim = aimDrag.moved ? { x0: aimDrag.x0, z0: aimDrag.z0, x1: p.x, z1: p.z } : { x0: world.squad.x, z0: world.squad.frontZ - 1, x1: p.x, z1: p.z }
        stat.aims++
      }
      aimDrag = null; setAimLine(null)
      return
    }
    if (drag && e.pointerId === drag.id) drag = null
  }
  function onContextMenu(e) {
    e.preventDefault()
    if (ui.selectedDevice()) { ui.selectDevice(null); view.setPlacement(null) }
  }
  function onLeave() { pointer.has = false; if (ui.selectedDevice()) refreshPlacement() }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseAll)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('contextmenu', onContextMenu)

  // ------------------------------------------------------------ 手柄（有就用；左摇杆 / 十字键平移，A B X Y = Q W E R，Start = 暂停）
  const PAD_KEYS = ['q', 'w', 'e', 'r']
  function pollPad() {
    padAxis = 0
    const pads = navigator.getGamepads ? navigator.getGamepads() : null
    if (!pads) return
    for (const p of pads) {
      if (!p || !p.connected) continue
      let ax = Math.abs(p.axes[0] || 0) > 0.22 ? p.axes[0] : 0
      if (p.buttons[14] && p.buttons[14].pressed) ax = -1
      if (p.buttons[15] && p.buttons[15].pressed) ax = 1
      if (ax) padAxis = clamp(ax, -1, 1)
      for (let i = 0; i < 4; i++) {
        const on = !!(p.buttons[i] && p.buttons[i].pressed)
        if (on && !padPrev[i] && live()) api.power(PAD_KEYS[i])
        padPrev[i] = on
      }
      const st = !!(p.buttons[9] && p.buttons[9].pressed)
      if (st && !padPrev[9] && onGamepadPause) onGamepadPause()
      padPrev[9] = st
      return
    }
  }

  const api = {
    /** 取走这一步的输入。一次性的意图取走即清（模拟层不替你清 place / remove） */
    collect(world) {
      const dir = keys.left && keys.right ? keys.last : keys.left ? -1 : keys.right ? 1 : 0
      out.moveX = dir || padAxis || null
      out.targetX = null
      if (!out.moveX && dragTarget !== null) { out.targetX = dragTarget; if (!drag) dragTarget = null }
      out.powers.length = 0
      if (q.powers.length) { for (const k of q.powers) if (out.powers.indexOf(k) < 0) out.powers.push(k); q.powers.length = 0 }
      out.aim = q.aim; q.aim = null
      out.pick = q.pick; q.pick = null
      out.reroll = q.reroll; q.reroll = false
      out.place = q.place; q.place = null
      out.remove = q.remove; q.remove = null
      out.continueEndless = q.cont; q.cont = false
      out.retreat = q.retreat; q.retreat = false
      out.abandon = q.abandon; q.abandon = false
      return out
    },
    /** 每帧 */
    update(world) {
      pollPad()
      if (aimDrag && (!world || world.status !== 'aiming')) { aimDrag = null; setAimLine(null) }
      if (ui.selectedDevice()) refreshPlacement()
      else if (view.debug && view.debug.gate && view.debug.gate.devices && view.debug.gate.devices.placement) view.setPlacement(null)
    },
    power(key) { q.powers.push(key); stat.powers++ },
    pick(i) { q.pick = i; stat.picks++ },
    reroll() { q.reroll = true },
    retreat() { q.retreat = true },
    /** 战役放弃本局（暂停菜单「撤离并结算」），模拟层按失败 'abandon' 收尾 */
    abandon() { q.abandon = true },
    continueEndless() { q.cont = true },
    hasChoice: () => q.pick !== null || q.reroll,
    refreshPlacement,
    /** 换局 / 回菜单 / 暂停：丢掉没处理完的意图，松开所有按键 */
    reset() {
      q.powers.length = 0; q.aim = null; q.pick = null; q.reroll = false; q.cont = false; q.retreat = false; q.abandon = false; q.place = null; q.remove = null
      releaseAll(); view.setPlacement(null)
    },
    release: releaseAll,
    stat,
    dispose() {
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', releaseAll)
      canvas.removeEventListener('pointerdown', onPointerDown); canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp); canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('contextmenu', onContextMenu)
    },
  }
  return api
}
