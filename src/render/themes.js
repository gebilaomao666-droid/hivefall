// themes.js —— 三套环境主题，运行时平滑切换（灯光 / 雾 / 天空 / 点缀色 / 调色），不重编译任何着色器。
//   ash   灰烬黄昏：低角度暖色主光 + 长影，地平线火光，飘落的灰烬与火星
//   night 深空寒夜：冷蓝高角度主光，星空清晰，青/琥珀灯带
//   hive  巢穴侵蚀：紫绿生物光，浓雾，孢子
// 加主题：往 THEMES 里加一项即可；所有字段都是数字或 0xRRGGBB 颜色，切换时逐项插值。
import * as THREE from 'three'

export const THEMES = {
  ash: {
    label: '灰烬黄昏',
    // 第 3 轮：战斗机位拉远到约 60 m（原 48 m），雾密度同比下调、雾色抬一点（远处是暖灰的霾而不是死黑）；暗角减轻；
    // 桥面和两侧建筑单独加环境反射（envWorld，只乘在场景材质上）——半球光 / 补光一加，我方钴蓝的头盔顶和肩甲就褪成淡蓝，所以那两项只小加
    fog: 0x1c130e, fogDensity: 0.0082, background: 0x040303,
    hemiSky: 0x8aa0d8, hemiGround: 0x1c110c, hemi: 1.55,
    key: 0xffc896, keyI: 4.0, keyDir: [-19, 17, 3],            // 仰角约 41°：塔架在桥面上拉出长影
    fill: 0x5f8fe8, fillI: 1.6, rim: 0xff5a2a, rimI: 0.9,
    env: 1.0, envWorld: 2.0, exposure: 1.12,
    accentA: [0.22, 0.66, 1.0], accentB: [1.0, 0.45, 0.1],
    skyZen: [0.010, 0.007, 0.010], skyNeb: [0.075, 0.026, 0.020], skyHor: [0.30, 0.085, 0.018], skyHaze: [0.030, 0.020, 0.030], stars: 0.55,
    mist: [0.050, 0.032, 0.026], abyssA: [0.30, 0.075, 0.012], abyssB: [0.030, 0.014, 0.010],
    ash: [0.55, 0.5, 0.48], ember: [3.2, 1.1, 0.25], ashAmt: 1.0,
    shaft: [1.0, 0.9, 0.75], wet: 0.35, pool: 0.34,
    rimArmor: [0.22, 0.49, 1.0], rimChitin: [1.0, 0.29, 0.16],
    planetA: [0.24, 0.11, 0.06], planetB: [1.0, 0.36, 0.08], silBase: [0.026, 0.018, 0.02], silRim: [0.46, 0.16, 0.05],
    bloom: 0.34, gradeShadow: [0.92, 0.97, 1.08], gradeHigh: [1.08, 1.0, 0.9], saturation: 1.08, vignette: 0.24,
  },
  night: {
    label: '深空寒夜',
    fog: 0x0a0f18, fogDensity: 0.0098, background: 0x020305,
    hemiSky: 0x86a8e6, hemiGround: 0x16100e, hemi: 1.4,
    key: 0xffe6c8, keyI: 3.8, keyDir: [-15, 30, 9],
    fill: 0x5f95ff, fillI: 1.5, rim: 0xff6a3c, rimI: 0.85,
    env: 1.0, envWorld: 2.0, exposure: 1.1,
    accentA: [0.2, 0.62, 1.0], accentB: [1.0, 0.45, 0.1],
    skyZen: [0.004, 0.006, 0.012], skyNeb: [0.05, 0.022, 0.06], skyHor: [0.010, 0.030, 0.070], skyHaze: [0.012, 0.03, 0.06], stars: 1.0,
    mist: [0.035, 0.07, 0.13], abyssA: [0.04, 0.12, 0.30], abyssB: [0.004, 0.008, 0.016],
    ash: [0.40, 0.48, 0.60], ember: [0.5, 0.9, 1.6], ashAmt: 0.45,
    shaft: [0.75, 0.88, 1.0], wet: 0.3, pool: 0.34,
    rimArmor: [0.22, 0.49, 1.0], rimChitin: [1.0, 0.29, 0.16],
    planetA: [0.06, 0.11, 0.22], planetB: [0.25, 0.6, 1.0], silBase: [0.012, 0.017, 0.032], silRim: [0.12, 0.26, 0.5],
    bloom: 0.3, gradeShadow: [0.90, 0.98, 1.10], gradeHigh: [1.07, 1.0, 0.92], saturation: 1.08, vignette: 0.26,
  },
  hive: {
    label: '巢穴侵蚀',
    fog: 0x140c20, fogDensity: 0.013, background: 0x050308,
    hemiSky: 0x8a6ad8, hemiGround: 0x0e1a0c, hemi: 1.3,
    key: 0xd8c8ff, keyI: 3.1, keyDir: [12, 24, -10],
    fill: 0x3fd08a, fillI: 1.2, rim: 0xb040ff, rimI: 1.3,
    env: 0.9, envWorld: 2.0, exposure: 1.1,
    accentA: [0.35, 1.0, 0.45], accentB: [0.75, 0.25, 1.0],
    skyZen: [0.010, 0.004, 0.016], skyNeb: [0.10, 0.02, 0.13], skyHor: [0.05, 0.17, 0.08], skyHaze: [0.035, 0.03, 0.05], stars: 0.4,
    mist: [0.07, 0.04, 0.12], abyssA: [0.08, 0.30, 0.07], abyssB: [0.020, 0.008, 0.030],
    ash: [0.35, 0.6, 0.35], ember: [0.9, 2.6, 0.5], ashAmt: 0.8,
    shaft: [0.75, 1.0, 0.8], wet: 0.55, pool: 0.4,
    rimArmor: [0.25, 0.75, 0.9], rimChitin: [0.8, 0.3, 1.0],
    planetA: [0.11, 0.05, 0.17], planetB: [0.5, 1.0, 0.3], silBase: [0.03, 0.012, 0.042], silRim: [0.42, 0.16, 0.62],
    bloom: 0.36, gradeShadow: [0.98, 0.94, 1.10], gradeHigh: [0.98, 1.04, 0.96], saturation: 1.1, vignette: 0.32,
  },
}
export const THEME_IDS = Object.keys(THEMES)
const COLOR_KEYS = ['fog', 'background', 'hemiSky', 'hemiGround', 'key', 'fill', 'rim']

function toState(def) {
  const s = {}
  for (const k in def) {
    const v = def[k]
    if (COLOR_KEYS.includes(k)) { const c = new THREE.Color(v); s[k] = [c.r, c.g, c.b] } else if (Array.isArray(v)) s[k] = v.slice(); else if (typeof v === 'number') s[k] = v
  }
  return s
}

/**
 * createThemes({ scene, env, post, renderer, rim, materials }) -> { set(id, seconds), update(dtReal), id, state }
 *   env: buildEnvironment 的返回值；post: { bloom, grade(uniforms) }；rim: { armor:{value:Color}, chitin:{value:Color} }；
 *   materials: 需要跟着主题缩放 envMapIntensity 的材质数组（材质上有 userData.envBase）
 */
export function createThemes(ctx) {
  let id = 'ash', cur = toState(THEMES.ash), from = cur, to = cur, t = 1, dur = 1
  const lerp = (a, b, k) => a + (b - a) * k
  const mix = (k) => {
    const out = {}
    for (const key in to) {
      const a = from[key], b = to[key]
      out[key] = Array.isArray(b) ? b.map((v, i) => lerp(a ? a[i] : v, v, k)) : lerp(a ?? b, b, k)
    }
    return out
  }
  const apply = (s) => {
    const { scene, env, post, renderer, rim, materials } = ctx
    scene.fog.color.setRGB(...s.fog); scene.fog.density = s.fogDensity
    scene.background.setRGB(...s.background)
    const L = env.lights
    L.hemi.color.setRGB(...s.hemiSky); L.hemi.groundColor.setRGB(...s.hemiGround); L.hemi.intensity = s.hemi
    L.key.color.setRGB(...s.key); L.key.intensity = s.keyI; env.setKeyDirection(...s.keyDir)
    L.fill.color.setRGB(...s.fill); L.fill.intensity = s.fillI
    L.rim.color.setRGB(...s.rim); L.rim.intensity = s.rimI
    renderer.toneMappingExposure = s.exposure
    const U = env.uniforms
    U.uAccentA.value.setRGB(...s.accentA); U.uAccentB.value.setRGB(...s.accentB)
    env.accentMats.a.color.setRGB(s.accentA[0] * 2.4, s.accentA[1] * 2.4, s.accentA[2] * 2.4)
    env.accentMats.b.color.setRGB(s.accentB[0] * 2.6, s.accentB[1] * 2.6, s.accentB[2] * 2.6)
    env.accentMats.white.color.setRGB(s.shaft[0] * 2.2, s.shaft[1] * 2.2, s.shaft[2] * 2.2)
    U.uSkyZen.value.setRGB(...s.skyZen); U.uSkyNeb.value.setRGB(...s.skyNeb); U.uSkyHor.value.setRGB(...s.skyHor); U.uSkyHaze.value.setRGB(...s.skyHaze); U.uStars.value = s.stars
    U.uMist.value.setRGB(...s.mist); U.uAbyssA.value.setRGB(...s.abyssA); U.uAbyssB.value.setRGB(...s.abyssB)
    U.uAshCol.value.setRGB(...s.ash); U.uEmberCol.value.setRGB(...s.ember); U.uAshAmt.value = s.ashAmt
    U.uShaftCol.value.setRGB(...s.shaft); U.uWet.value = s.wet; U.uPool.value = s.pool
    if (U.uPlanetA && s.planetA) { U.uPlanetA.value.setRGB(...s.planetA); U.uPlanetB.value.setRGB(...s.planetB); U.uSilBase.value.setRGB(...s.silBase); U.uSilRim.value.setRGB(...s.silRim) }
    rim.armor.value.setRGB(...s.rimArmor); rim.chitin.value.setRGB(...s.rimChitin)
    for (const m of env.stdMats) m.envMapIntensity = m.userData.envBase * s.env * (s.envWorld ?? 1)
    for (const m of materials) m.envMapIntensity = (m.userData.envBase ?? 0.6) * s.env
    if (post) {
      post.bloom.strength = s.bloom
      const g = post.grade.uniforms
      g.uShadow.value.set(...s.gradeShadow); g.uHigh.value.set(...s.gradeHigh); g.uSat.value = s.saturation; g.uVig.value = s.vignette
    }
    cur = s
  }
  return {
    get id() { return id }, get state() { return cur }, get transitioning() { return t < 1 },
    /** 切换主题。seconds = 0 立即生效 */
    set(next, seconds = 1.6) {
      if (!THEMES[next]) { console.info(`[themes] 未知主题 "${next}"，保持 ${id}`); return false }
      id = next; from = cur; to = toState(THEMES[next]); dur = Math.max(0, seconds); t = dur > 0 ? 0 : 1
      if (t >= 1) apply(to)
      return true
    },
    update(dt) {
      if (t >= 1) return
      t = Math.min(1, t + dt / dur)
      const k = t * t * (3 - 2 * t)
      apply(t >= 1 ? to : mix(k))
    },
    reapply() { apply(cur) },
  }
}
