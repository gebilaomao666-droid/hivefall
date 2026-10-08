// camera.js —— 三个机位（battle / menu / codex）+ 震屏 + 慢漂移。
// FOV：桌面 34°，窄屏（竖屏）44°。窄屏时沿视线把相机拉远，保证整条桥宽都在画面里。
import * as THREE from 'three'

const MODES = {
  // 规范战斗机位（第 3 轮试玩重调）：更陡的俯角（约 55°）+ 更长焦（FOV 26°），整体推近。
  //   画面比例（16:9）：z = -12 在画面顶沿，队伍前排（z = 8.1）落在 50%，电网（z = 16.5）在 77%——正好压在装置卡条的上沿，
  //   底部 HUD 只盖住电网之后那一截空桥。虫群出生点（z = -21）在画面上方之外，虫潮从上沿涌进来、占满上半屏；我方在下半屏。
  //   旧机位（p [0,35.1,41.9] → l [0,0,9.2]，FOV 34）的问题：队伍身后到电网一大段空桥，虫群挤在上三分之一。
  battle: { p: [0, 49.75, 42.25], l: [0, 0, 8.06], fov: 26, drift: 0.35, driftHz: 0.08, fit: 7.6 },
  // 窄屏（竖屏）：宽度才是瓶颈，仍用广角 + 沿视线后退装下整条桥宽
  battleNarrow: { p: [0, 35.1, 41.9], l: [0, 0, 9.2], fov: 44, drift: 0.2, driftHz: 0.08, fit: 7.6 },
  // 菜单预览：低机位斜看整条桥，缓慢环移
  // （机位比最初拉高拉远了一档：原来贴着第一排步兵的后背拍，低模小人占了半个画面；现在看到的是整片战场——虫潮、装置、炮火，队伍在前景）
  menu: { p: [14.5, 13.5, 27], l: [-1.2, 0.4, 0.5], fov: 34, drift: 1.6, driftHz: 0.05, fit: 0 },
  // 军械库 / 检视：贴近目标，绕着转（目标和距离由 focus() 设定）
  codex: { p: [3.2, 2.4, 5.2], l: [0, 0.8, 0], fov: 34, drift: 0, driftHz: 0, fit: 0, orbit: 0.25 },
}
const NARROW_FOV = 44

export function createCameraRig(camera) {
  let mode = 'battle'
  const pos = new THREE.Vector3().fromArray(MODES.battle.p), look = new THREE.Vector3().fromArray(MODES.battle.l)
  const tp = pos.clone(), tl = look.clone()
  const focusP = new THREE.Vector3(0, 0.8, 0); let focusDist = 5, focusPitch = 0.42, orbitA = 0.6, orbitSpeed = 0.25
  let shake = 0, t = 0, aspect = 16 / 9, narrow = false, custom = null, vw = 0, vh = 0
  const sv = new THREE.Vector3(), dir = new THREE.Vector3()
  let tFov = camera.fov       // 目标 FOV：随机位一起缓动过去（菜单 34° → 战斗 26° 不跳变）
  const modeKey = () => (mode === 'battle' && narrow ? 'battleNarrow' : mode)

  // 竖屏首页：简报面板盖住下面四分之三，战场得挪到上面那一条里——整幅画面往上平移（视锥偏移，不改机位）
  const applyOffset = () => {
    if (narrow && mode === 'menu' && !custom && vw > 0 && vh > 0) camera.setViewOffset(vw, vh, 0, Math.round(vh * 0.38), vw, vh)
    // 竖屏战斗：顶部要放两张扁门卡，底部电网之后是一截空桥——整幅画面往下挪 7%，门和虫潮露在门卡下面，电网贴着装置卡条
    else if (narrow && mode === 'battle' && !custom && vw > 0 && vh > 0) camera.setViewOffset(vw, vh, 0, -Math.round(vh * 0.07), vw, vh)
    else if (camera.view && camera.view.enabled) camera.clearViewOffset()
  }
  const retarget = () => {
    applyOffset()
    if (custom) { tp.fromArray(custom.p); tl.fromArray(custom.l); return }
    const m = MODES[modeKey()]
    tFov = narrow ? NARROW_FOV : m.fov
    tp.fromArray(m.p); tl.fromArray(m.l)
    if (m.fit > 0) {   // 横向要装下 ±fit 米：不够就沿视线后退
      const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(tFov / 2)) * aspect)
      const need = m.fit / Math.tan(hf), have = tp.distanceTo(tl)
      if (need > have) { dir.copy(tp).sub(tl).normalize(); tp.copy(tl).addScaledVector(dir, need) }
    }
  }
  const api = {
    get mode() { return mode }, get narrow() { return narrow },
    setMode(m, instant = false) {
      if (!MODES[m]) return; mode = m; custom = null; retarget()
      if (instant) { pos.copy(tp); look.copy(tl); if (camera.fov !== tFov) { camera.fov = tFov; camera.updateProjectionMatrix() } }
    },
    /** 任意机位（调试 / 截图）：pos, look 为 [x,y,z]；fov 可选 */
    setCustom(p, l, fov) { custom = { p, l, fov }; if (fov) { camera.fov = fov; camera.updateProjectionMatrix() } retarget(); pos.copy(tp); look.copy(tl) },
    /** codex 机位的目标点 / 距离 / 俯仰 / 自转速度（弧度每秒，0 = 不转） */
    focus(x, y, z, dist, pitch = 0.42, speed = 0.25, angle = null) { focusP.set(x, y, z); focusDist = dist; focusPitch = pitch; orbitSpeed = speed; if (angle != null) orbitA = angle },
    resize(w, h) {
      aspect = w / h; narrow = aspect < 0.9; vw = w; vh = h
      camera.aspect = aspect; camera.updateProjectionMatrix(); retarget()
    },
    /** 加震屏（0.03~0.34，多次叠加取较大者再略加） */
    addShake(a) { shake = Math.min(0.6, Math.max(shake, a) + Math.min(shake, a) * 0.35) },
    update(dt, simDt) {
      t += dt
      shake *= Math.exp(-13 * Math.max(simDt, dt * 0.25))   // 指数衰减；子弹时间里衰减也变慢
      const m = MODES[modeKey()], k = 1 - Math.exp(-dt * 4.5)
      if (mode === 'codex' && !custom) {
        orbitA += dt * orbitSpeed
        const cp = Math.cos(focusPitch)
        tp.set(focusP.x + Math.sin(orbitA) * focusDist * cp, focusP.y + Math.sin(focusPitch) * focusDist, focusP.z + Math.cos(orbitA) * focusDist * cp); tl.copy(focusP)
        pos.lerp(tp, 1 - Math.exp(-dt * 8)); look.lerp(tl, 1 - Math.exp(-dt * 8))
      } else { pos.lerp(tp, k); look.lerp(tl, k) }
      if (!custom && Math.abs(camera.fov - tFov) > 0.01) { camera.fov += (tFov - camera.fov) * k; camera.updateProjectionMatrix() }
      const drift = custom ? 0 : Math.sin(t * m.driftHz * Math.PI * 2) * m.drift
      sv.set((Math.sin(t * 91.7) + Math.sin(t * 57.3)) * 0.5 * shake, (Math.sin(t * 83.1 + 1.0) + Math.sin(t * 47.9)) * 0.5 * shake, 0)
      camera.position.copy(pos).add(sv); camera.position.x += drift
      camera.lookAt(look.x + drift * 0.6 + sv.x * 0.6, look.y + sv.y * 0.6, look.z)
      camera.updateMatrixWorld()
    },
  }
  return api
}
