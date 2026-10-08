// materials.js —— 分区调色板材质（不是整体染色）。
// 每个顶点带一个 zone id（0..7），片元里按 zone 查 uniform 调色板：颜色 + 金属度 / 粗糙度 / 自发光。
// 调色板本身（PALETTES）写在 assets.js，这里只有两套着色模型：
//   armor  我方装甲：甲片分缝、污渍、队色能量线、冷色边缘光、开火照亮、受击闪红
//   chitin 虫族几丁质：体节条纹、个体色偏、湿润高光、裂隙熔光、暖色轮廓、受击泛红
//          + detail 档（中大型虫 / Boss）：三平面噪声的明暗与粗糙度、细胞噪声的甲片分节与接缝、凹凸法线、清漆层湿润高光、沿接缝渗出的腺体光
//   textured 带贴图的 glb（AI 生成的模型）：直接用它自己的 baseColor / normal / roughness 贴图，外加同一套受击 / 染色 / 轮廓光
import * as THREE from 'three'

// 我方 zone
export const AZ = { DARK: 0, GUN: 1, PLATE: 2, TEAM: 3, CYAN: 4, ORANGE: 5, PAINT: 6, GOLD: 7 }
// 敌方 zone
export const CZ = { SHELL: 0, LIMB: 1, GLOW: 2, BONE: 3, FLESH: 4, SHELL2: 5, GLOW2: 6, MEMBRANE: 7 }

function paletteUniforms(pal) {
  const col = [], mre = []
  for (let i = 0; i < 8; i++) {
    const p = pal[i] || [0, 0, 0, 0, 1, 0]
    col.push(new THREE.Vector3(p[0], p[1], p[2])); mre.push(new THREE.Vector3(p[3], p[4], p[5]))
  }
  return { uZoneCol: { value: col }, uZoneMRE: { value: mre } }
}

const FRAG_HEAD = /* glsl */`
uniform vec3 uZoneCol[8]; uniform vec3 uZoneMRE[8];
uniform vec3 uRimCol; uniform float uRimPow; uniform float uTime; uniform float uRimGain; uniform float uFill;
varying float vZone; varying float vTint; varying vec4 vFx; varying vec3 vObj; varying vec3 vObjN; varying float vGlow; varying vec4 vTintC;
vec3 gZoneMRE; vec3 gZoneCol;
float gHx = 0.0; float gHy = 0.0; float gSeam = 0.0; float gN1 = 0.5; float gCoat = 1.0;   // detail 档：高度场在屏幕 x / y 方向的差分、接缝遮罩、低频噪声、清漆层倍率（颜色阶段算好，后面的阶段接着用）
float h31(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
`

// detail 档用的细胞噪声：返回 (F1, F2, 这一格的随机数)。F2 - F1 小的地方就是两片甲之间的接缝
const WORLEY = /* glsl */`
vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
vec3 worley(vec3 p){
  vec3 ip = floor(p), fp = fract(p); float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)); vec3 o = h33(ip + g);
    vec3 d = g + o - fp; float dd = dot(d, d);
    if (dd < f1) { f2 = f1; f1 = dd; id = o.x; } else if (dd < f2) { f2 = dd; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`
// 按高度场 gH 扰动法线（高度的单位是米，和位置同一套单位，所以远近、分辨率变了凹凸的强度不变）
const BUMP = /* glsl */`
  #include <normal_fragment_maps>
  {
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    float hx = gHx, hy = gHy;   // 颜色阶段用「相邻像素的静止姿势坐标」各求了一次高度：逐像素精确。不能用 dFdx(高度)——那是 2×2 像素块共用一个值，高光会碎成马赛克
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (hx * r1 + hy * r2);
    normal = normalize(abs(det) * normal - uBump * grad + 1e-7);
  }
`

function commonFragment(shader, styleColor, styleAfterNormal, extraHead = '', bump = false) {
  let fs = shader.fragmentShader
  fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_HEAD + extraHead)
  if (bump) fs = fs.replace('#include <normal_fragment_maps>', BUMP).replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.clearcoat *= gCoat;')
  fs = fs.replace('#include <color_fragment>', /* glsl */`
    int zi = int(vZone + 0.5);
    gZoneCol = uZoneCol[zi]; gZoneMRE = uZoneMRE[zi];
    vec3 zc = gZoneCol;
    ${styleColor}
    diffuseColor.rgb = zc;
  `)
  fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gZoneMRE.y * gRoughMul, 0.08, 1.0);')
  fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gZoneMRE.x;')
  fs = fs.replace('#include <emissivemap_fragment>', /* glsl */`
    {
      vec3 vdir = normalize(vViewPosition);
      float fres = pow(max(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 0.0), uRimPow);
      // 可读性补光：不走灯光的一层「自带环境光」，朝上的面更亮（主机位看到的正是顶面）。
      // 金属度高的材质漫反射几乎为零，只靠灯光的话在暗场景里是一团黑；这一项保证单位的固有色在任何主题下都读得出来
      float topL = max(dot(normal, normalize(viewMatrix[1].xyz)), 0.0);
      totalEmissiveRadiance += diffuseColor.rgb * uFill * (0.3 + 0.7 * topL);
      ${styleAfterNormal}
    }
  `)
  shader.fragmentShader = fs
}

/**
 * 我方装甲。opts: { palette(8 行), rim, rimPow, rimGain, env, fill(可读性补光，默认 0.3), panel(甲片分缝密度，0 关), uTime, key }
 * 返回 { material(未注入 VAT), fragment(注入函数), key }
 */
export function makeArmorMaterial(envMap, opts = {}) {
  const pal = opts.palette.map((p) => p.slice())
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.5, envMap, envMapIntensity: opts.env ?? 0.75 })
  const u = {
    ...paletteUniforms(pal), uRimCol: opts.uRimCol || { value: new THREE.Color(opts.rim ?? 0x3a7dff) }, uRimPow: { value: opts.rimPow ?? 2.6 },
    uRimGain: { value: opts.rimGain ?? 0.24 }, uTime: opts.uTime || { value: 0 }, uFill: { value: opts.fill ?? 0.3 },
  }
  mat.userData.extraUniforms = u; mat.userData.palette = pal; mat.userData.envBase = opts.env ?? 0.75
  const panel = opts.panel ?? 5.0
  const fragment = (shader) => commonFragment(shader, /* glsl */`
      float grime = vnoise(vObj * 9.0 + vFx.z * 17.0);
      zc *= mix(0.86, 1.08, grime) * mix(0.85, 1.1, clamp(vTint, 0.0, 1.2));
      zc *= mix(0.66, 1.0, smoothstep(0.0, 0.4, vObj.y));              // 脚部压暗，增加体积
      float seam = 0.0;
      ${panel > 0 ? /* glsl */`
      { // 程序化甲片：分缝 + 每块甲片明暗差（远处按屏幕导数淡出，避免闪烁）
        vec3 pq = vObj * ${panel.toFixed(2)} + 0.37; vec3 pf = 0.5 - abs(fract(pq) - 0.5);
        float seamFade = clamp(1.0 - max(fwidth(pq.y), fwidth(pq.x)) * 3.0, 0.0, 1.0);
        vec3 pq2 = vObj * ${(panel * 0.5).toFixed(2)} + 0.21; vec3 pf2 = 0.5 - abs(fract(pq2) - 0.5);
        seam = max(1.0 - smoothstep(0.0, 0.05, pf.y), 1.0 - smoothstep(0.0, 0.025, pf2.x)) * seamFade * step(gZoneMRE.z, 0.5);
        zc *= mix(0.88, 1.12, h31(floor(pq) + 11.0)) * (1.0 - seam * 0.45);
      }` : ''}
      // 个体染色：雇佣兵 / 英雄级。队色与涂装区整块换色，其余甲片轻微偏色
      float tz = (zi == 3 || zi == 6) ? 1.0 : ((zi == 1 || zi == 2) ? 0.22 : 0.0);
      zc = mix(zc, vTintC.rgb * (zi == 3 || zi == 6 ? 1.0 : dot(zc, vec3(0.3, 0.6, 0.1)) * 3.0), vTintC.a * tz);
      zc *= vFx.x;
      float gRoughMul = mix(0.85, 1.25, grime) + seam * 0.6;
    `, /* glsl */`
      vec3 glowCol = gZoneCol;
      if (zi == 4 && vTintC.a > 0.9) glowCol = mix(glowCol, vTintC.rgb * 1.2, 0.8);  // 目镜跟着换色
      totalEmissiveRadiance += glowCol * gZoneMRE.z * vGlow;
      if (zi == 3) totalEmissiveRadiance += uZoneCol[4] * seam * 0.9 * vGlow;            // 队色甲片上的能量线
      totalEmissiveRadiance += uRimCol * fres * uRimGain;                                // 冷色边缘光
      totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * max(vFx.y, 0.0) * 0.12;            // 开火枪口照亮
      totalEmissiveRadiance += vec3(1.0, 0.16, 0.08) * max(-vFx.y, 0.0) * 0.9;           // 受击闪红
    `)
  return { material: mat, fragment, key: 'armor' + (opts.key || '') }
}

/**
 * 虫族几丁质。opts: { palette, rim, rimPow, rimGain, env, fill, noiseScale, bandFreq, veins, veinScale, uTime, key,
 *   detail: 甲片尺度（每米几片，> 0 就走 detail 档：中大型虫 / Boss 用，小虫别开——每个片元要算 27 次细胞噪声）
 *   bump:   凹凸高度（米，默认 0.02）   wet: 清漆层强度 0..1（默认 0.6）   seamGlow: 接缝渗光强度（默认 0.5，0 = 关）
 *   micro:  细麻点的三平面噪声尺度（每米重复几次，默认 detail × 0.9）   noiseTex: 三平面采样用的噪声贴图（createPool 会传 ctx.noise）
 * }
 */
export function makeChitinMaterial(envMap, opts = {}) {
  if (opts.detail > 0) return makeChitinDetail(envMap, opts)
  const pal = opts.palette.map((p) => p.slice())
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.3, envMap, envMapIntensity: opts.env ?? 0.6 })
  const u = {
    ...paletteUniforms(pal), uRimCol: opts.uRimCol || { value: new THREE.Color(opts.rim ?? 0xff4a2a) }, uRimPow: { value: opts.rimPow ?? 2.2 },
    uRimGain: { value: opts.rimGain ?? 0.22 }, uTime: opts.uTime || { value: 0 }, uFill: { value: opts.fill ?? 0.22 },
  }
  mat.userData.extraUniforms = u; mat.userData.palette = pal; mat.userData.envBase = opts.env ?? 0.6
  const fragment = (shader) => commonFragment(shader, /* glsl */`
      float seed = vFx.z;
      float n1 = vnoise(vObj * ${(opts.noiseScale ?? 7).toFixed(1)} + seed * 31.0);
      float gVein = (1.0 - smoothstep(0.0, 0.04, abs(vnoise(vObj * ${(opts.veinScale ?? 5).toFixed(1)} + seed * 7.0) - 0.5))) * ${(opts.veins ?? 0).toFixed(2)};
      float bands = 0.5 + 0.5 * sin(vObj.z * ${(opts.bandFreq ?? 26).toFixed(1)} + n1 * 3.0);   // 体节条纹
      if (zi == 0 || zi == 5) {
        vec3 deep = zc * 0.4, hot = zc * 1.55 + vec3(0.02, 0.004, 0.0);
        zc = mix(deep, hot, smoothstep(0.15, 0.95, n1 * 0.6 + bands * 0.4));
        zc = mix(zc, vec3(zc.r * ${(opts.purpleTone ?? [0.5, 0.8, 0.8])[0].toFixed(2)}, zc.g * ${(opts.purpleTone ?? [0.5, 0.8, 0.8])[1].toFixed(2)}, zc.r * ${(opts.purpleTone ?? [0.5, 0.8, 0.8])[2].toFixed(2)}), step(0.8, seed) * ${(opts.purple ?? 0.7).toFixed(2)});   // 少数个体偏紫（opts.purple：混合量，0 = 关；purpleTone：紫到什么程度）
      } else if (zi != 2 && zi != 6) {
        zc *= mix(0.6, 1.3, n1);
      }
      zc = mix(zc, vTintC.rgb * (0.25 + dot(zc, vec3(0.3, 0.6, 0.1)) * 5.0), vTintC.a * ((zi == 2 || zi == 6) ? 0.0 : 0.75));   // 精英 / 冰冻 / 护盾染色
      zc *= vFx.x;
      zc = mix(zc, vec3(0.9, 0.22, 0.05), clamp(vFx.y, 0.0, 1.0) * 0.4);  // 受击泛红
      float gRoughMul = mix(0.65, 1.5, n1);
    `, /* glsl */`
      float pulse = 0.7 + 0.3 * sin(uTime * 5.0 + vFx.z * 40.0);
      totalEmissiveRadiance += gZoneCol * gZoneMRE.z * pulse * vGlow;
      if (zi == 0 || zi == 5) totalEmissiveRadiance += uZoneCol[2] * uZoneMRE[2].z * gVein * (0.35 + 0.35 * pulse) * vGlow;   // 甲壳裂隙里的熔光
      totalEmissiveRadiance += uRimCol * fres * uRimGain * vFx.x;                  // 次表面感的暖色轮廓
      totalEmissiveRadiance += vTintC.rgb * fres * vTintC.a * 0.9;                 // 精英的彩色轮廓
      totalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * clamp(vFx.y, 0.0, 1.0) * 0.3;
    `)
  return { material: mat, fragment, key: 'chitin' + (opts.key || '') }
}

// detail 档：近看要经得住（Boss 会占半个屏幕）。和上面的基础档共用调色板和实例数据，多出来的东西：
//   1. 三平面噪声（静止姿势的坐标 + 法线 → 纹理钉在身上，不随动画滑动）：大斑驳调明暗，细麻点调粗糙度
//   2. 细胞噪声把甲壳分成一片片不规则的甲：每片明暗不同、微微鼓起，片与片之间的接缝发暗、下凹、粗糙
//   3. 上面两样合成一张高度场，用屏幕空间导数扰动法线 —— 同一块平滑的面上出现凹凸，不再是「塑料」
//   4. 清漆层（MeshPhysicalMaterial 的 clearcoat，用没扰动过的法线）：凹凸的甲上面罩一层光滑的黏液 = 湿润高光
//   5. 腺体的光沿着一部分接缝渗出来；腺体 / 卵囊本身中心亮边缘暗、里面有流动的明暗（不再是一块平涂的灯）
//   6. 骨刺：根部暗褐、尖端象牙白，沿长度有细纹
function makeChitinDetail(envMap, opts) {
  const pal = opts.palette.map((p) => p.slice())
  // 环境反射压得比基础档低：清漆层会把整片天空的亮度叠上来，暗红的甲被冲成粉色；湿润感主要靠主光在清漆层上的高光
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.3, envMap, envMapIntensity: opts.env ?? 0.4, clearcoat: opts.wet ?? 0.5, clearcoatRoughness: 0.2 })
  const u = {
    ...paletteUniforms(pal), uRimCol: opts.uRimCol || { value: new THREE.Color(opts.rim ?? 0xff4a2a) }, uRimPow: { value: opts.rimPow ?? 2.6 },
    uRimGain: { value: opts.rimGain ?? 0.16 }, uTime: opts.uTime || { value: 0 }, uFill: { value: opts.fill ?? 0.12 },
    uDetailTex: { value: opts.noiseTex || null }, uBump: { value: opts.bump ?? 0.02 },
  }
  mat.userData.extraUniforms = u; mat.userData.palette = pal; mat.userData.envBase = opts.env ?? 0.4
  const PS = opts.detail, MS = opts.micro ?? opts.detail * 0.9, f = (v) => Number(v).toFixed(3)
  const fragment = (shader) => commonFragment(shader, /* glsl */`
      float seed = vFx.z;
      // ---- 三平面噪声 ----
      vec3 tw = pow(abs(normalize(vObjN)) + 1e-3, vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
      float n1 = triN(vObj * ${f(MS * 0.31)} + seed * 0.13, tw);                           // 大斑驳
      float n2 = smoothstep(0.15, 0.85, triN(vObj * ${f(MS)} + 0.37, tw));                 // 细麻点
      n1 = smoothstep(0.2, 0.8, n1);
      gN1 = vnoise(vObj * ${f(PS * 0.22)} + seed * 5.0);                                   // 很低频：圈出「哪几片的接缝在渗光」
      float bands = 0.5 + 0.5 * sin(vObj.z * ${f(opts.bandFreq ?? 4)} + n1 * 3.0);
      // ---- 甲片（细胞噪声）----
      vec3 odx = dFdx(vObj), ody = dFdy(vObj);
      float pfw = max(length(odx), length(ody)) * ${f(PS)};
      float dFade = clamp(1.5 - pfw * 3.5, 0.0, 1.0);                                      // 一片甲不到三四个像素时淡出，远看不闪
      float plateW = zi == 3 ? 0.3 : (zi == 4 ? 0.5 : ((zi == 2 || zi == 6) ? 0.0 : 1.0)); // 腺体不分片；骨刺只有浅浅的裂纹；软组织分得浅（褶皱）
      float warp = (n1 - 0.5) * 0.4;
      vec3 wr; vec3 wrn;
      float h0 = chitinH(vObj, tw, warp, plateW, wr);
      gHx = (chitinH(vObj + odx, tw, warp, plateW, wrn) - h0) * dFade;
      gHy = (chitinH(vObj + ody, tw, warp, plateW, wrn) - h0) * dFade;
      gSeam = (1.0 - smoothstep(0.02, 0.13, wr.y - wr.x)) * dFade * plateW;
      gCoat = zi == 3 ? 0.55 : 1.0 - gSeam * 0.8;                                          // 骨刺是磨光的角质，不是湿的；接缝里没有黏液的反光
      if (zi == 3) {
        // 骨刺：vTint 沿长度从 0.55（根）到 1.25（尖）
        float along = smoothstep(0.55, 1.2, vTint);
        float stri = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(vTint * 60.0 + n1 * 7.0));       // 沿长度一圈圈的生长纹
        zc *= mix(0.22, 1.5, along * along) * mix(0.6, 1.1, stri) * mix(0.55, 1.2, n1) * mix(0.75, 1.1, n2);
        zc = mix(zc, zc * vec3(1.2, 0.7, 0.45), (1.0 - along) * 0.7);                      // 根部暗褐，尖端象牙白
        zc *= 1.0 - gSeam * 0.6;
      } else if (zi != 2 && zi != 6) {
        float cellTone = mix(0.55, 1.25, wr.z);                                            // 每片甲明暗不一
        zc *= mix(1.0, cellTone, plateW) * mix(0.45, 1.35, n1) * mix(0.82, 1.1, bands);
        zc *= 1.0 - gSeam * 0.85;                                                          // 接缝发暗
        zc *= mix(0.7, 1.0, smoothstep(0.0, 0.35, vObj.y));                                // 贴地的部分压暗
      } else {
        zc *= 0.22;                                                                        // 腺体 / 卵囊：漫反射压低，主要靠自发光
      }
      zc = mix(zc, vTintC.rgb * (0.25 + dot(zc, vec3(0.3, 0.6, 0.1)) * 5.0), vTintC.a * ((zi == 2 || zi == 6) ? 0.0 : 0.75));   // 精英 / 冰冻 / 护盾染色
      zc *= vFx.x;
      zc = mix(zc, vec3(0.9, 0.22, 0.05), clamp(vFx.y, 0.0, 1.0) * 0.4);                  // 受击泛红
      float gRoughMul = mix(0.8, 2.0, n2) + gSeam * 1.6 + (zi == 3 ? 0.5 : 0.0);           // 底层偏哑（湿润的高光交给清漆层）；接缝最哑
    `, /* glsl */`
      float pulse = 0.7 + 0.3 * sin(uTime * 5.0 + vFx.z * 40.0);
      float ndv = clamp(dot(normal, vdir), 0.0, 1.0);
      if (zi == 2 || zi == 6) {
        float flow = 0.72 + 0.28 * sin(uTime * 2.3 + gN1 * 11.0 + vObj.y * 3.0);
        float inner = 0.3 + 1.1 * smoothstep(0.25, 0.8, vnoise(vObj * ${f(PS * 3.4)} + uTime * 0.12));   // 里面一团团游动的暗影
        totalEmissiveRadiance += gZoneCol * gZoneMRE.z * pulse * vGlow * (0.15 + 0.85 * pow(ndv, 2.0)) * inner * flow;
      } else {
        totalEmissiveRadiance += gZoneCol * gZoneMRE.z * pulse * vGlow;
        float leak = gSeam * smoothstep(0.52, 0.72, gN1) * ${f(opts.seamGlow ?? 0.5)};
        totalEmissiveRadiance += uZoneCol[2] * uZoneMRE[2].z * leak * (0.3 + 0.45 * pulse) * vGlow;      // 腺体的光沿接缝渗出来
      }
      totalEmissiveRadiance += uRimCol * fres * uRimGain * vFx.x;
      totalEmissiveRadiance += vTintC.rgb * fres * vTintC.a * 0.9;
      totalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * clamp(vFx.y, 0.0, 1.0) * 0.3;
    `, /* glsl */`uniform sampler2D uDetailTex; uniform float uBump;
      ${WORLEY}
      float triN(vec3 q, vec3 tw){ return texture2D(uDetailTex, q.zy).r * tw.x + texture2D(uDetailTex, q.xz).r * tw.y + texture2D(uDetailTex, q.xy).r * tw.z; }
      // 高度场（单位：uBump 米）：甲片微微鼓起、接缝是一道 V 形沟、表面细麻点。wr 带出细胞噪声的 (F1, F2, 随机数)
      float chitinH(vec3 p, vec3 tw, float warp, float plateW, out vec3 wr){
        wr = worley(p * vec3(${f(PS)}, ${f(PS * 1.25)}, ${f(PS * 0.72)}) + warp);
        float groove = 1.0 - smoothstep(0.0, 0.28, wr.y - wr.x);
        float dome = 1.0 - smoothstep(0.0, 0.9, wr.x);
        return (dome * 0.4 - groove * 0.9) * plateW + (triN(p * ${f(MS)} + 0.37, tw) - 0.5) * 0.3;
      }
    `, true)
  return { material: mat, fragment, key: 'chitinD' + (opts.key || '') + [PS, MS, opts.bandFreq ?? 4, opts.seamGlow ?? 0.5].join('_') }
}

/**
 * 带贴图的模型（AI 生成的 glb）。opts: { map, normalMap, roughnessMap, metalnessMap, emissiveMap, emissive(自发光倍率，默认 1),
 *   metalness / roughness(常数，或者贴图的倍率；不给时：有贴图 = 1，没贴图 = 0.1 / 0.6), normalScale(法线贴图强度，默认 1),
 *   gain(贴图亮度倍率), colorFx(一段 GLSL：采样完 baseColor 之后、染色之前改 diffuseColor.rgb；能用 vObj / vMapUv / map),
 *   rim, rimPow, rimGain, fill, env, uTime, key,
 *   ally: 我方模型的按色分区（队色压成钴蓝 / 主甲拉向海军蓝 / 朝上朝后的面刷队色 / merc 红黑），字段见下面 A 的默认值和 docs/RENDER.md §8.6,
 *   emissiveFx: 一段 GLSL，自发光阶段改 totalEmissiveRadiance（能用 vObj） }
 * 调色板 / zone 不参与着色（颜色全在贴图里）；实例数据照旧：亮度、受击闪、精英 / 护盾染色、发光强度。
 */
export function makeTexturedMaterial(envMap, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1, 1, 1).multiplyScalar(opts.gain ?? 1), map: opts.map || null, normalMap: opts.normalMap || null,
    roughnessMap: opts.roughnessMap || null, metalnessMap: opts.metalnessMap || null, emissiveMap: opts.emissiveMap || null,
    emissive: new THREE.Color(opts.emissiveMap ? 0xffffff : 0x000000), emissiveIntensity: opts.emissive ?? 1,
    metalness: opts.metalness ?? (opts.metalnessMap ? 1 : 0.1), roughness: opts.roughness ?? (opts.roughnessMap ? 1 : 0.6), envMap, envMapIntensity: opts.env ?? 0.6,
  })
  if (opts.side === 'double') mat.side = THREE.DoubleSide   // 单层薄片（翼膜）：两面都画
  if (opts.normalMap && opts.normalScale != null) mat.normalScale.setScalar(typeof opts.normalScale === 'number' ? opts.normalScale : opts.normalScale.x)
  const colorFx = opts.colorFx || ''
  // 默认值大幅收回：测试「我方像一片高饱和纯蓝塑料小人」—— 原来主甲整体拉成海军蓝（navy 0.85 × 暗 0.45）、朝上 / 朝后的面整片刷队色，
  // 主机位从背后斜上方看过去就只剩一层纯蓝。现在：贴图自己的钢灰主甲基本保留（只偏一点冷色），钴蓝只在贴图本来就是蓝的肩甲 / 臂甲 / 条纹上，
  // 卡其布件（背包）压成枪灰钢（khakiSteel），朝上的面只在很平的顶面（topFrom 0.62 起）轻刷一层，贴图的青色灯（emissiveMap）照旧发光。
  const A = opts.ally ? { teamSat: 1.2, teamGain: 1.0, teamEmit: 0.1, cobalt: 0.3, navy: 0.22, navyDark: 1.0, khaki: 1, khakiTo: 0.74, khakiSteel: 0.85, topTeam: 0.3, topFrom: 0.62, topTo: 0.92, backTeam: 0, steel: 1.0, steelCon: 1.0, steelDesat: 0.0, steelAll: 0.0, teamPale: 0.0, teamPaleSat: 0.8, teamPaleL: 0.16, steelPivot: 0.3, emitGate: 0.0, merc: false, pointK: 0.3, lightCap: 0.3, fireGlow: 0.5, hitGlow: 0.35, ...opts.ally } : null
  const emissiveFx = opts.emissiveFx || ''
  const fxText = colorFx + '|' + emissiveFx + '|' + (A ? JSON.stringify(A) : '')
  let fxKey = 0; for (let i = 0; i < fxText.length; i++) fxKey = (fxKey * 31 + fxText.charCodeAt(i)) | 0   // 着色器文本不同 → 程序缓存键也要不同
  const u = {
    uRimCol: opts.uRimCol || { value: new THREE.Color(opts.rim ?? 0xff4a2a) }, uRimPow: { value: opts.rimPow ?? 2.4 }, uRimGain: { value: opts.rimGain ?? 0.18 },
    uTime: opts.uTime || { value: 0 }, uFill: { value: opts.fill ?? 0.18 },
  }
  mat.userData.extraUniforms = u; mat.userData.envBase = opts.env ?? 0.6
  const f = (v) => Number(v).toFixed(3)
  // ---- 我方（opts.ally）：贴图里的钴蓝漆 = 队色区，中性灰甲 = 主甲。按颜色现场分区（线性空间）：
  //   队色区：饱和度 × teamSat、亮度 × teamGain、再带一点不起光晕的自发光（teamEmit）——主机位下方阵要读成「一片蓝」
  //   主甲：往海军蓝的枪灰拉 navy（和程序化的 armor.7th 同一个调子），整体 × navyDark
  //   英雄级起名 / 精英（没有红黑变体时）的实例染色只改队色区（主甲只偏一点），目镜不动；受击闪红、开火照亮和程序化装甲同一套语义（vFx.y > 0 = 枪口照亮，< 0 = 受击）
  //   merc：红黑涂装——队色区换成暗红漆，主甲压成黑钢，青色灯换成猩红
  const allyColor = A ? /* glsl */`
        {
          vec3 c0 = diffuseColor.rgb;
          float l0 = dot(c0, vec3(0.3, 0.59, 0.11));
          float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b));
          float st = (mx - mn) / max(mx, 1e-4);
          gTeam = smoothstep(0.28, 0.52, (c0.b - max(c0.r, c0.g)) / max(c0.b, 1e-4)) * smoothstep(0.004, 0.02, c0.b);
          gTeam *= 1.0 - ${f(A.teamPale)} * smoothstep(${f(A.teamPaleL)}, ${f(A.teamPaleL + 0.14)}, l0) * (1.0 - smoothstep(${f(A.teamPaleSat - 0.25)}, ${f(A.teamPaleSat)}, st));   // teamPale：浅蓝灰的大块机甲板（亮、饱和度不高）不算队色，归主甲压成枪灰
          // 中性灰 + 卡其（背包 / 帆布 / 米黄的布件：偏暖、低到中饱和；橙漆和工程黄的饱和度 > 0.9，不算）
          float khaki = smoothstep(0.26, 0.36, st) * (1.0 - smoothstep(${f(A.khakiTo - 0.12)}, ${f(A.khakiTo)}, st)) * step(c0.b, c0.r) * ${f(A.khaki)};   // khakiTo：饱和度到多少还算（霍克的披风是偏红的褐色，要放宽到 0.95）
          float neutral = max(1.0 - smoothstep(0.10, 0.32, st), khaki) * (1.0 - gTeam);
          ${A.merc ? /* glsl */`
          // 测试：正红色的突击兵成片站在方阵中间，像整片在受击变红。原来偏蓝的一律刷暗红（门槛 0.12，连浅蓝灰的大甲板都算）——
          // 贴图里蓝色占了大半个身子，结果整只是红的。现在：深黑枪灰是主甲，只有饱和的钴蓝（肩甲 / 条纹，门槛 0.4 起）刷成更暗的酒红作点缀
          // mercT / mercRed：起刷红漆的门槛、红漆亮度倍率（歌利亚的贴图大半是亮钴蓝，单独收：只留条纹、亮度减半）
          float mT = smoothstep(${f(A.mercT ?? 0.3)}, ${f((A.mercT ?? 0.3) + 0.25)}, (c0.b - max(c0.r, c0.g)) / max(c0.b, 1e-4)) * smoothstep(0.02, 0.06, c0.b);
          vec3 red = vec3(0.16, 0.013, 0.009) * min(0.4 + 1.1 * l0, 1.0) * ${f(A.mercRed ?? 1)};
          vec3 blk = vec3(0.050, 0.053, 0.059) * (0.5 + 2.4 * l0);
          c0 = mix(blk, red, mT);
          gTeam = mT;
          ` : /* glsl */`
          // 队色区：贴图里的蓝有深有浅（浅蓝灰的机甲板、天蓝的漆），统一压成程序化那边的钴蓝（armor.7th 的 TEAM 行），只留贴图的明暗。
          // 亮度封顶 ≈ 0.7：再亮的纯蓝过 ACES 色调映射会褪成淡紫 / 发白（主机位下一片粉蓝，反而不像蓝军）
          vec3 cobalt = vec3(0.03, 0.12, 0.62) * min(0.35 + 1.0 * l0, 1.0) * ${f(A.teamGain)};   // 比原来的纯钴蓝略灰一点：贴图里浅蓝灰的甲板保留金属感
          vec3 tc = mix(max(vec3(l0) + (c0 - vec3(l0)) * ${f(A.teamSat)}, vec3(0.0)), cobalt, ${f(A.cobalt ?? 0.75)});
          c0 = mix(c0, tc, gTeam);
          c0 = mix(c0, vec3(0.50, 0.56, 0.66) * l0 * 0.95, khaki * (1.0 - gTeam) * ${f(A.khakiSteel ?? 0)});   // 卡其布件 → 枪灰钢（带一点冷色）
          vec3 navyC = vec3(0.45, 0.62, 1.3) * l0 * ${f(A.navyDark)};
          c0 = mix(c0, navyC, neutral * ${f(A.navy)});
          // 主甲压成枪灰：steel = 中性甲整体亮度，steelDesat = 去掉贴图里米黄 / 卡其的暖色（背包、布件）换成冷枪灰，steelCon = 围绕中灰拉开明暗（贴图的甲缝 / 凹槽更深，亮面保留）。
          // 测试「正常视距下一片淡蓝白、发虚」—— 参考 038 是深枪灰主甲 + 亮钴蓝点缀，靠「暗底 + 亮色块」的对比读成蓝军
          { float ln = dot(c0, vec3(0.3, 0.59, 0.11)); vec3 cs = mix(c0, vec3(ln) * vec3(0.9, 0.96, 1.07), ${f(A.steelDesat)}) * ${f(A.steel)} * min(pow(max(ln, 1e-4) / ${f(A.steelPivot)}, ${f(A.steelCon - 1.0)}), 1.25); c0 = mix(c0, cs, mix(neutral, 1.0 - gTeam, ${f(A.steelAll)})); }   // steelAll：浅蓝灰的大块机甲板（饱和度介于中性和队色之间）也算主甲
          // 朝上的中性甲面（头盔顶、肩甲、背包盖、机身顶板）刷成队色：主机位是从背后斜上方往下看，看到的几乎全是这些面
          vec3 on0 = normalize(vObjN);
          float topT = clamp(smoothstep(${f(A.topFrom)}, ${f(A.topTo)}, on0.y) + ${f(A.backTeam)} * smoothstep(0.3, 0.75, -on0.z), 0.0, 1.0) * neutral * ${f(A.topTeam)};   // backTeam：朝后的面（背包、后背甲）也算，主机位看到的是背影
          c0 = mix(c0, vec3(0.03, 0.12, 0.62) * min(0.35 + 1.0 * l0, 1.0) * ${f(A.teamGain)}, topT);
          gTeam = max(gTeam, topT);
          `}
          // 实例染色（英雄级起名 / 精英）：队色区整块换色，主甲只偏一点
          c0 = mix(c0, vTintC.rgb * (0.3 + dot(c0, vec3(0.3, 0.59, 0.11)) * 4.0), vTintC.a * (gTeam * 0.85 + neutral * 0.18));
          diffuseColor.rgb = c0;
        }` : ''
  const fragment = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimCol; uniform float uRimPow; uniform float uRimGain; uniform float uFill; uniform float uTime;\nvarying float vZone; varying float vTint; varying vec4 vFx; varying vec3 vObj; varying vec3 vObjN; varying float vGlow; varying vec4 vTintC;\nfloat gTeam = 0.0;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        ${colorFx}
        ${A ? allyColor : 'diffuseColor.rgb = mix(diffuseColor.rgb, vTintC.rgb * (0.25 + dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)) * 4.0), vTintC.a * 0.7);   // 精英 / 冰冻 / 护盾染色'}
        diffuseColor.rgb *= vFx.x * clamp(vTint, 0.0, 1.5);
        ${A ? '' : 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.22, 0.05), clamp(vFx.y, 0.0, 1.0) * 0.4);'}`)
      .replace('#include <lights_fragment_begin>', A ? THREE.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color *= ' + f(A.pointK) + ';') : '#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_end>', A ? /* glsl */`#include <lights_fragment_end>
        { // 强光软压：爆炸 / Boss 预警 / 闪光灯把直射光顶上去时，我方的亮度按软膝盖压住（knee = lightCap），暗枪灰不会被冲成白色剪影
          vec3 dl = reflectedLight.directDiffuse + reflectedLight.directSpecular; float L = dot(dl, vec3(0.3, 0.59, 0.11));
          float kn = ${f(A.lightCap)}; if (L > kn) { float e = L - kn; float k = (kn + e / (1.0 + e / kn)) / L; reflectedLight.directDiffuse *= k; reflectedLight.directSpecular *= k; } }` : '#include <lights_fragment_end>')
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          ${emissiveFx}
          ${A ? /* glsl */`
          { // emitGate：AI 贴图的自发光图里有大块不饱和的浅色（整片甲板被当成发光），俯视下一层淡蓝白。只留饱和的灯（青 / 橙）
            vec3 e0 = totalEmissiveRadiance; float eM = max(e0.r, max(e0.g, e0.b)), eS = (eM - min(e0.r, min(e0.g, e0.b))) / max(eM, 1e-4);
            totalEmissiveRadiance *= mix(1.0, smoothstep(0.35, 0.65, eS), ${f(A.emitGate)}); }
          totalEmissiveRadiance *= vGlow;
          ${A.merc ? 'totalEmissiveRadiance = vec3(dot(totalEmissiveRadiance, vec3(0.3, 0.59, 0.11))) * vec3(1.15, 0.42, 0.08);' : ''}   // 雇佣兵的灯：猩红 → 少量暗橙（亮度约 0.6 倍）
          totalEmissiveRadiance += diffuseColor.rgb * gTeam * ${f(A.teamEmit)} * vGlow;` : 'totalEmissiveRadiance *= vGlow * (0.75 + 0.25 * sin(uTime * 5.0 + vFx.z * 40.0));'}
          vec3 vdir = normalize(vViewPosition);
          float fres = pow(max(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 0.0), uRimPow);
          float topL = max(dot(normal, normalize(viewMatrix[1].xyz)), 0.0);
          totalEmissiveRadiance += diffuseColor.rgb * uFill * (0.3 + 0.7 * topL);
          totalEmissiveRadiance += uRimCol * fres * uRimGain * vFx.x;
          totalEmissiveRadiance += vTintC.rgb * fres * vTintC.a * ${A ? '0.3' : '0.9'};
          ${A ? /* glsl */`
          // 开火照亮 / 受击闪红按「本身颜色的倍数」加，不再加一层固定的暖白 / 红：原来整排开火时每个兵都罩 0.07 的暖光、挨打时罩 0.9 的红，
          // 暗枪灰的反照率只有 0.05 上下，被这层常数一盖就成了淡橙 / 淡紫的幽灵。受击只在轮廓上闪红
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.7, 0.42) * max(vFx.y, 0.0) * ${f(A.fireGlow)};
          totalEmissiveRadiance += (diffuseColor.rgb * vec3(2.4, 0.35, 0.2) + vec3(0.5, 0.06, 0.03) * fres) * max(-vFx.y, 0.0) * ${f(A.hitGlow)};` : /* glsl */`
          totalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * clamp(vFx.y, 0.0, 1.0) * 0.3;
          totalEmissiveRadiance += vec3(1.0, 0.16, 0.08) * max(-vFx.y, 0.0) * 0.9;`}
        }`)
  }
  return { material: mat, fragment, key: 'textured' + (opts.key || '') + (opts.normalMap ? 'N' : '') + (opts.roughnessMap ? 'R' : '') + (opts.emissiveMap ? 'E' : '') + (fxText.length > 2 ? 'F' + fxKey : '') }
}

/** 占位材质：黄黑警示格，一眼就知道「这个 kind 还没注册模型」 */
export function makePlaceholderMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.7 })
  const fragment = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec4 vFx; varying vec4 vTintC; varying float vZone; varying float vTint; varying float vGlow;')
      .replace('#include <color_fragment>', 'float ck = step(0.5, fract((vObj.x + vObj.y * 1.3 + vObj.z) * 2.2)); diffuseColor.rgb = mix(vec3(0.02), vec3(1.0, 0.72, 0.0), ck) * vFx.x;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vec3(1.0, 0.0, 0.8) * (0.25 + 0.25 * step(0.5, fract((vObj.x + vObj.y * 1.3 + vObj.z) * 2.2)));')
  }
  return { material: mat, fragment, key: 'placeholder' }
}
