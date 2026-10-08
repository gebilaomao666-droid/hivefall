// groundview.js —— 贴在桥面上的指示：预警（world.telegraphs）、持续区域（world.zones）、光环、应急电网、布防格高亮。
// 一个实例化四边形池（一次 draw call），每帧按 world 状态重写；形状和花纹都在片元着色器里算。
//   预警：circle / lane / line，敌方红橙、我方青色；内圈随 (now - t0) / (t1 - t0) 填满，快到点时闪
//   区域：fire 火 / acid 酸 / storm 风暴 / void 虚空 / mine 雷区 / cryo 冷凝，未知类型用白色虚线圈
//   布防（world.devices，数字取 data/devices.js）：聚变炸弹的 3×3 格倒计时框、地雷的武装进度圈 / 感应圈、喷火陷阱烧着的那一排、举盾虫身前的盾弧
import * as THREE from 'three'
import { LANES } from './env.js'
import { DEVICES } from '../data/devices.js'

const CAP = 160
const MODE = { telegraph: 0, fire: 1, acid: 2, storm: 3, void: 4, aura: 5, fence: 6, cell: 7, mine: 8, cryo: 9, unknown: 10, pod: 11, lance: 1, shield: 12, sense: 13, bossmark: 14 }
const VS = /* glsl */`
attribute vec4 aP; attribute vec4 aQ; attribute vec4 aC;   // (x, z, halfW, halfD) (shape 0 圆 1 矩形, progress, mode, angle) (rgb, alpha)
varying vec2 vQ; varying vec4 vInfo; varying vec4 vCol; varying vec2 vSize; varying vec2 vW;
void main() {
  vec2 c = position.xy * 2.0; vQ = c; vInfo = aQ; vCol = aC; vSize = aP.zw;
  float cs = cos(aQ.w), sn = sin(aQ.w);
  vec2 l = vec2(c.x * aP.z, c.y * aP.w);
  vec2 w = vec2(l.x * cs + l.y * sn, -l.x * sn + l.y * cs) + aP.xy; vW = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.035 + aQ.z * 0.0012, w.y, 1.0);
}`
const FS = /* glsl */`
uniform float uTime; uniform sampler2D uNoise;
varying vec2 vQ; varying vec4 vInfo; varying vec4 vCol; varying vec2 vSize; varying vec2 vW;
void main() {
  float shape = vInfo.x, prog = clamp(vInfo.y, 0.0, 1.0); int mode = int(vInfo.z + 0.5);
  // 到边缘的距离（米）：圆用半径，矩形用两轴里更近的那条边
  float r = length(vQ);
  vec2 dq = (1.0 - abs(vQ)) * vSize;
  float edge = shape < 0.5 ? (1.0 - r) * vSize.x : min(dq.x, dq.y);
  if (edge < 0.0) discard;
  float inside = shape < 0.5 ? r : max(abs(vQ.x), abs(vQ.y));
  float line = 1.0 - smoothstep(0.0, 0.09, edge);                      // 外轮廓线
  float n = texture2D(uNoise, vW * 0.11 + vec2(uTime * 0.03, -uTime * 0.05)).r;
  float n2 = texture2D(uNoise, vW * 0.27 - vec2(uTime * 0.07, uTime * 0.02)).r;
  vec3 col = vCol.rgb; float a = 0.0;
  if (mode == 0) {            // 预警
    float urgent = smoothstep(0.7, 1.0, prog);
    float pulse = 0.75 + 0.25 * sin(uTime * (8.0 + urgent * 14.0));
    float fill = shape < 0.5 ? step(inside, prog) : step((vQ.y * 0.5 + 0.5), prog);   // 圆从中心往外填，车道从远端往近端填
    float rad = shape < 0.5 ? smoothstep(0.05, 0.0, abs(fract(atan(vQ.y, vQ.x) * 1.9099 + uTime * 0.2) - 0.5) - 0.42) * 0.18 : 0.0;
    float fillEdge = shape < 0.5 ? (1.0 - smoothstep(0.0, 0.035, abs(inside - prog))) : (1.0 - smoothstep(0.0, 0.03, abs(((vQ.y * 0.5 + 0.5)) - prog)));
    // 测试：冲锋预警是一整条 HDR 亮橙的长条（填充 ≈ 1.8、轮廓 ≈ 7），Bloom 把站在里面的方阵整片照白。
    // 现在亮的只有细轮廓线和推进的那条填充前沿（读得出「要冲过来了」），大面积的填充 / 箭头纹压到 Bloom 阈值以下
    // 测试：冲锋预警还是「一大块橙红发光的长方形从方阵底下铺到后面」。改成地面标记：
    // 细边框（约 8 厘米）随节奏脉动、边框内侧一道很窄的渐隐、整块填充只有极淡的一层（加法 0.016 ≈ 桥面上一层薄红），推进前沿是一条细线。
    // 所有项加起来亮度都在 Bloom 阈值以下 —— 读得出「要冲过来了、往哪躲」，但不发光、不把方阵罩成一片橙
    // 测试：仍是一条明显的肉粉色长条从 Boss 铺过方阵到后排坦克。
    // 车道形（冲锋）再收：整块填充只剩约原来的 1/4、去掉箭头纹和内侧渐隐，边框是一条断续的细线（虚线沿着车道流向队伍）；
    // 长度在 CPU 侧截到队伍前沿（不再铺过方阵）。圆形预警（酸液落点等）保持原样
    float rimL = 1.0 - smoothstep(0.0, 0.08, edge);
    float hot, body;
    if (shape < 0.5) {
      float inner = (1.0 - smoothstep(0.0, 0.45, edge)) * (1.0 - rimL);
      hot = rimL * (0.3 + 0.2 * pulse + urgent * 0.15) + inner * (0.05 + 0.07 * pulse) + fillEdge * 0.16;
      body = fill * 0.016 + rad * 0.05;   // 放射条纹 0.12 → 0.05：掘地虫破土预警那张带条纹的「肉粉色圆盘」主要就是这层
    } else {
      float dash = 0.35 + 0.65 * step(0.4, fract(vQ.y * vSize.y * 0.55 - uTime * 2.2));
      hot = rimL * dash * (0.22 + 0.16 * pulse + urgent * 0.12) + fillEdge * 0.1;
      body = fill * 0.004;
    }
    a = hot + body;
    col *= 0.8 + urgent * 0.2;
  } else if (mode == 1) {     // 火
    float f = smoothstep(0.25, 0.85, n * 0.6 + n2 * 0.6) * smoothstep(0.0, 0.5, edge);
    col = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.62, 0.14), f) * (1.0 + f * 1.2);
    a = (0.11 + f * 0.36) * smoothstep(0.0, 0.35, edge) + line * 0.26;   // 约 ×0.75：粘稠燃剂的火区在方阵前铺成几张亮橙圆饼（fx-15b）
  } else if (mode == 2) {     // 酸
    float b = smoothstep(0.55, 0.62, n2) * 0.6 + smoothstep(0.4, 0.8, n) * 0.5;
    // 酸池原来是一张亮荧光绿的圆饼（0.6 / 1.4 / 0.15，不透明度 0.45 起），压在方阵脚下比巢母还抢眼。压成暗绿的腐蚀斑，边线仍清楚
    col = mix(vec3(0.05, 0.16, 0.02), vec3(0.28, 0.62, 0.07), b);
    a = (0.32 + b * 0.3) * smoothstep(0.0, 0.3, edge) + line * 0.55;
  } else if (mode == 3) {     // 风暴：旋转的电弧
    float ang = atan(vQ.y, vQ.x); float sw = sin(ang * 3.0 + r * 9.0 - uTime * 5.0) * 0.5 + 0.5;
    float arc = smoothstep(0.75, 1.0, sw) * (0.4 + n);
    col = mix(vec3(0.35, 0.3, 1.6), vec3(1.2, 1.0, 3.0), arc);
    a = (0.12 + arc * 0.55) * smoothstep(0.0, 0.4, edge) + line * 0.8;
  } else if (mode == 4) {     // 虚空：暗核 + 亮边
    float rim = smoothstep(0.55, 1.0, inside);
    col = mix(vec3(0.02, 0.0, 0.05), vec3(1.0, 0.35, 2.4), rim * (0.5 + n));
    a = 0.6 * (1.0 - rim * 0.3) + line;
  } else if (mode == 5) {     // 光环（护巢虫）
    float ring = smoothstep(0.78, 1.0, inside) * (0.5 + 0.5 * sin(inside * 30.0 - uTime * 4.0));
    a = ring * 0.09 + line * 0.15 + 0.003;   // 护卫虫的光环在 Boss 周围叠成几张淡紫圆饼（竖屏尤其显眼）：底色 0.03 → 0.003、环和边线约 ×0.4
  } else if (mode == 6) {     // 应急电网：横向的电弧线
    float y = abs(vQ.y); float arc = exp(-y * y * 9.0) * (0.6 + 0.4 * sin(vW.x * 14.0 + uTime * 30.0 + n * 12.0));
    a = arc * (0.55 + 0.45 * sin(uTime * 3.0 + vW.x)) + exp(-y * y * 2.0) * 0.12;
    col *= 1.5;
  } else if (mode == 7) {     // 布防格高亮
    a = line * 0.9 + 0.1 + 0.06 * sin(uTime * 6.0);
  } else if (mode == 8) {     // 雷区
    float core = 1.0 - smoothstep(0.0, 0.22, r); float blink = 0.5 + 0.5 * sin(uTime * 7.0 + vW.x * 3.0 + vW.y * 5.0);
    col = mix(col, vec3(2.6, 0.7, 0.15), core);
    a = core * (0.35 + 0.65 * blink) + line * 0.22 + 0.015;
  } else if (mode == 9) {     // 冷凝
    float f = smoothstep(0.35, 0.8, n * 0.7 + n2 * 0.5);
    col = mix(vec3(0.2, 0.6, 1.0), vec3(0.9, 1.3, 1.6), f);
    a = (0.15 + f * 0.35) * smoothstep(0.0, 0.3, edge) + line * 0.6;
  } else if (mode == 11) {    // 空投舱的「集火」标记：旋转的缺口环 + 血量弧
    float ang = atan(vQ.y, vQ.x);
    float ringA = smoothstep(0.84, 0.88, r) * (1.0 - smoothstep(0.96, 1.0, r)) * step(0.25, fract(ang * 0.6366 + uTime * 0.3));
    float hp = smoothstep(0.66, 0.69, r) * (1.0 - smoothstep(0.76, 0.79, r)) * step(fract(ang * 0.159155 + 0.5), prog);
    a = ringA * 0.9 + hp * 0.9;
  } else if (mode == 12) {    // 举盾虫的盾弧：身前（+z，朝着队伍）120° 的一段弧，子弹从这个方向来只吃一成
    float ang = atan(vQ.x, vQ.y);                                          // 0 = +z
    float arc = 1.0 - smoothstep(0.95, 1.1, abs(ang));
    float band = smoothstep(0.62, 0.74, r) * (1.0 - smoothstep(0.9, 1.0, r));
    a = arc * band * (0.55 + 0.25 * sin(uTime * 5.0 + vW.x * 2.0)) + arc * (1.0 - smoothstep(0.0, 0.9, r)) * 0.05;
  } else if (mode == 13) {    // 地雷的感应圈：一圈很淡的虚线，prog < 1 时是武装进度（顺时针填满）
    float ang = atan(vQ.x, vQ.y) * 0.159155 + 0.5;
    float ringA = smoothstep(0.86, 0.92, r) * (1.0 - smoothstep(0.96, 1.0, r));
    float dash = step(0.5, fract(ang * 14.0 + uTime * 0.15));
    a = prog < 0.999 ? ringA * (step(ang, prog) * 0.8 + 0.12) : ringA * dash * (0.35 + 0.2 * sin(uTime * 5.0));
  } else if (mode == 14) {    // Boss 定位：四段旋转的锁定括弧 + 一圈极细的环，不铺底色（原来那张暗红的圆饼把深棕的 Boss 衬得更糊）
    float ang = atan(vQ.y, vQ.x) * 0.159155 + 0.5;
    float band = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.96, 1.0, r));
    float br = step(0.62, fract(ang * 4.0 + uTime * 0.12));
    float thin = smoothstep(0.93, 0.945, r) * (1.0 - smoothstep(0.955, 0.97, r));
    a = band * br * (0.75 + 0.25 * sin(uTime * 4.0)) + thin * 0.25;
  } else {                    // 未知类型：白色虚线圈，提醒「这个 zone 还没做表现」
    float dash = step(0.5, fract(atan(vQ.y, vQ.x) * 3.0 + uTime));
    col = vec3(1.0); a = line * dash + 0.05;
  }
  gl_FragColor = vec4(col * a * vCol.a, 1.0);
}`

// EMERGE：掘地虫破土预警（style 'emerge'）改成暗褐橙、整体压暗——原来和 Boss 预警同一个高亮橙红，Boss 身边一张张「肉粉色圆盘」
const ENEMY = [2.6, 0.42, 0.10], ENEMY_FLANK = [2.6, 0.9, 0.12], EMERGE = [1.1, 0.36, 0.1], ALLY = [0.35, 1.5, 2.6], GOLD = [2.6, 1.6, 0.3]
const BONE = [1.5, 1.15, 0.7], MINE_IDLE = [1.6, 1.0, 0.25], MINE_ARMED = [2.4, 0.35, 0.15], FIRE = [1, 1, 1]
const NOVA_HW = LANES.width * (0.5 + DEVICES.nova.side), NOVA_HD = LANES.depth * (0.5 + DEVICES.nova.rows), SCORCH_HW = LANES.width * (0.5 + DEVICES.scorcher.side)

export function createGroundView(ctx) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3])
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
  const aP = new Float32Array(CAP * 4), aQ = new Float32Array(CAP * 4), aC = new Float32Array(CAP * 4)
  const attrs = [aP, aQ, aC].map((a) => new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage))
  g.setAttribute('aP', attrs[0]); g.setAttribute('aQ', attrs[1]); g.setAttribute('aC', attrs[2]); g.instanceCount = 0
  const uTime = { value: 0 }
  const mat = new THREE.ShaderMaterial({ uniforms: { uTime, uNoise: { value: ctx.noise } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor })
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.name = 'ground-marks'; ctx.scene.add(mesh)
  let n = 0
  const put = (x, z, hw, hd, shape, prog, mode, angle, col, alpha) => {
    if (n >= CAP) return
    const o = n++ * 4
    aP[o] = x; aP[o + 1] = z; aP[o + 2] = hw; aP[o + 3] = hd
    aQ[o] = shape; aQ[o + 1] = prog; aQ[o + 2] = mode; aQ[o + 3] = angle
    aC[o] = col[0]; aC[o + 1] = col[1]; aC[o + 2] = col[2]; aC[o + 3] = alpha
  }
  let highlight = null, bossRef = null, bossT0 = 0
  return {
    /** 布防时高亮一个格子：setCell(lane, row, ok) / setCell(null) 取消 */
    setCell(lane, row, ok = true) { highlight = lane == null ? null : { lane, row, ok } },
    update(world, time, realTime, auras, shields) {
      uTime.value = realTime; n = 0
      const tgs = world.telegraphs || []
      for (const t of tgs) {
        if (time < t.t0) continue
        const col = t.team === 'ally' ? ALLY : (t.style === 'flank' ? ENEMY_FLANK : t.style === 'emerge' ? EMERGE : ENEMY)
        const prog = (time - t.t0) / Math.max(1e-3, t.t1 - t.t0)
        const fadeIn = Math.min(1, (time - t.t0) * 8)
        if (t.shape === 'circle') put(t.x, t.z, t.r, t.r, 0, prog, MODE.telegraph, 0, col, fadeIn * (t.style === 'sweep' ? 0.4 : t.style === 'emerge' ? 0.6 : 1))   // 横扫 0.55 → 0.4   // 横扫预警 1.4 秒一次、就在 Boss 脚前：压暗一半
        else if (t.shape === 'lane') {
          let z0 = t.z0 ?? -21, z1 = t.z1 ?? 17
          // 冲锋预警只画到队伍前沿
          if (t.style === 'charge' && world.squad) { const fz = world.squad.frontZ - 0.6; if (z1 > fz && fz > z0 + 1) z1 = fz }
          put(t.x, (z0 + z1) / 2, (t.w || 2.56) / 2, Math.abs(z1 - z0) / 2, 1, prog, MODE.telegraph, 0, col, fadeIn) }
        else if (t.shape === 'line') { const dx = t.x1 - t.x, dz = t.z1 - t.z, len = Math.hypot(dx, dz) || 1; put((t.x + t.x1) / 2, (t.z + t.z1) / 2, (t.w || 0.8) / 2, len / 2, 1, prog, MODE.telegraph, Math.atan2(dx, dz), col, fadeIn) }
        else put(t.x, t.z, t.r || 1.5, t.r || 1.5, 0, prog, MODE.unknown, 0, col, 1)
      }
      const zones = world.zones || []
      // 火区是加法混合：八个喷火兵带「粘稠燃料」对着同一个目标喷，就有八块火区叠在同一处，亮成一张白饼把 Boss 盖住。
      // 同时存在的我方火区越多，每块越暗（总亮度按 n^0.25 涨，而不是 n 倍）
      let fires = 0
      for (const zn of zones) if (zn.type === 'fire' && zn.team !== 'enemy') fires++
      const fireK = fires > 1 ? Math.pow(1.4 / fires, 0.75) : 1
      const bs = world.boss && world.boss.state !== 'burrowed' ? world.boss : null
      for (const zn of zones) {
        const mode = MODE[zn.type] ?? MODE.unknown
        let fade = Math.min(1, (time - zn.t0) * 6) * Math.min(1, Math.max(0, (zn.t1 - time) * 3))
        if (zn.type === 'fire' && zn.team !== 'enemy') { fade *= fireK; if (bs && Math.hypot(zn.x - bs.x, zn.z - bs.z) < 6) fade *= 0.12 }   /* 0.4 → 0.12、半径 4.5 → 6：Boss 身边的火区只剩一层暗红焦痕 */   // Boss 脚下的火区再压暗：别把 Boss 盖住
        const col = zn.team === 'enemy' ? ENEMY : ALLY
        if (zn.shape === 'rect' && zn.w > 0) put(zn.x, zn.z, zn.w / 2, (zn.d || 1) / 2, 1, 0, mode, 0, col, fade)
        else put(zn.x, zn.z, zn.r, zn.r, 0, 0, mode, 0, col, fade)
      }
      // Boss 脚下一圈暗红的定位环：Boss 被虫群和火焰围住的时候也一眼能找到它在哪（测试「碾压者战斗中被埋住看不见」）
      // 出场头 3 秒不画（那段只留一圈地面冲击环 + 轮廓光），之后淡入；亮度 0.42 → 0.3、半径跟着碾压者放大
      if ((world.boss || null) !== bossRef) { bossRef = world.boss || null; bossT0 = time }   // 按 Boss 对象记出场时刻（蠕虫潜地时 bs 为空，不能拿它判断）
      const markK = bs ? Math.max(0, Math.min(1, (time - bossT0 - 3) / 1)) : 0
      if (bs && bs.state !== 'dying' && bs.hp > 0 && markK > 0) put(bs.x, bs.z, bs.kind === 'ravager' ? 5.0 : 4.0, bs.kind === 'ravager' ? 5.0 : 4.0, 0, 0, MODE.bossmark, 0, [1.6, 0.34, 0.1], 0.3 * markK)   /* 锁定括弧亮度 ×0.45：只做定位，不发光 */   // 实心光环 → 锁定括弧
      // 护巢虫光环在 Boss 身边（8 米内）只留四成：几只护卫的淡紫圆圈叠在 Boss 背后，也是「好几层半透明圈」之一
      if (auras) for (let i = 0; i < auras.length; i += 3) put(auras[i], auras[i + 1], auras[i + 2], auras[i + 2], 0, 0, MODE.aura, 0, [0.9, 0.6, 2.4], bs && Math.abs(auras[i] - bs.x) < 8 && Math.abs(auras[i + 1] - bs.z) < 8 ? 0.4 : 1)
      if (shields) for (let i = 0; i < shields.length; i += 3) put(shields[i], shields[i + 1], shields[i + 2], shields[i + 2], 0, 0, MODE.shield, 0, BONE, 0.6)
      // 布防装置贴在地上的提示
      const devs = world.devices
      if (devs) for (const d of devs) {
        if (d.alive === false) continue
        if (d.kind === 'nova') {
          // 倒计时：3 × 3 格的框从远端往近端填满，填满的那一刻爆炸（armedT = 爆炸时刻）
          const prog = d.armedT != null ? 1 - (d.armedT - time) / DEVICES.nova.fuse : 0
          const x0 = Math.max(-6.4, d.x - NOVA_HW), x1 = Math.min(6.4, d.x + NOVA_HW)
          put((x0 + x1) / 2, d.z, (x1 - x0) / 2, NOVA_HD, 1, prog, MODE.telegraph, 0, GOLD, 0.55 * Math.min(1, (time - (d.t0 ?? time)) * 8 + 0.2))
        } else if (d.kind === 'mine') {
          const armed = d.armed != null ? !!d.armed : (d.armedT == null || time >= d.armedT)
          const prog = armed || d.armedT == null ? 1 : Math.max(0, 1 - (d.armedT - time) / DEVICES.mine.arm)
          put(d.x, d.z, DEVICES.mine.trigger, DEVICES.mine.trigger, 0, prog, MODE.sense, 0, armed ? MINE_ARMED : MINE_IDLE, armed ? 0.8 : 0.6)
        } else if (d.kind === 'scorcher') {
          // 烧着的时候整排 3 × 1 格铺一层火；平时什么都不画（它是埋在桥面里的陷阱）
          const k = d.fireT != null ? 1 - (time - d.fireT) / 0.6 : 0
          if (k > 0) { const x0 = Math.max(-6.4, d.x - SCORCH_HW), x1 = Math.min(6.4, d.x + SCORCH_HW); put((x0 + x1) / 2, d.z, (x1 - x0) / 2, LANES.depth / 2, 1, 0, MODE.fire, 0, FIRE, Math.min(1, k * 2.5) * 0.75) }
        }
      }
      const pods = world.pods || []
      for (const p of pods) put(p.x, p.z, 2.4, 2.4, 0, p.hpMax ? p.hp / p.hpMax : 1, MODE.pod, 0, GOLD, 1)
      const fences = world.fences
      if (fences) for (let l = 0; l < LANES.centers.length; l++) { const f = fences[l]; if (f === true || (f && f.ready)) put(LANES.centers[l], 16.5, LANES.width / 2 - 0.06, 0.32, 1, 0, MODE.fence, 0, ALLY, 1) }
      if (highlight) put(LANES.centers[highlight.lane], LANES.rows[highlight.row], LANES.width / 2 - 0.05, LANES.depth / 2 - 0.05, 1, 0, MODE.cell, 0, highlight.ok ? ALLY : ENEMY, 1)
      g.instanceCount = n
      if (n) for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true }
    },
    count() { return n },
  }
}
