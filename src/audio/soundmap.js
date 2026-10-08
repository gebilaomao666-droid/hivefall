// HIVEFALL 声音映射表 —— 想换声音、调音量、改节流，只改这一个文件。
//
// 这里是纯数据（不碰 DOM / Web Audio），Node 里也能 import：tools/test-audio.mjs 会校验
//   · 表里写到的每个文件都真的在 assets/audio/ 里
//   · 模拟层登记的每种事件（src/core/events.js）要么在 EVENT_MAP 里有声音，要么写进 SILENT_EVENTS
//
// 素材说明见 assets/audio/manifest.json（每个文件的用途 / 时长）。没人听过这些素材，
// 选用依据只有文件名和清单里的用途说明 —— 用 dev/audio.html 逐个试听后在这里改。

const seq = (stem, n, from = 1) => Array.from({ length: n }, (_, i) => `${stem}_${String(i + from).padStart(2, '0')}`)

// ---------------------------------------------------------------- 通道
// 与存档 settings.volume 的键一致（src/core/save.js）。master 是总音量，其余五路各自一个推子。
export const CHANNELS = ['master', 'music', 'weapons', 'swarm', 'voice', 'ui']
export const DEFAULT_VOLUME = { master: 0.8, music: 0.6, weapons: 0.8, swarm: 0.8, voice: 0.9, ui: 0.7 }

// ---------------------------------------------------------------- 全局限制
export const LIMITS = {
  maxVoices: 56,        // 同时发声上限（含循环声）
  preemptPrio: 6,       // 满了以后，prio ≥ 这个值的声音可以顶掉一个优先级更低的；低于它的直接丢弃
  crowd: 0.25,          // 同一类声音叠得越多，单个越小声：vol / sqrt(1 + 同类在响数 × crowd)
  panWidth: 0.6,        // 桥面最左 / 最右（x = ∓6.4）对应的声像
  bridgeHalf: 6.4,
  farZ: -21, nearZ: 17, farGain: 0.6,   // 远处（虫出生点）的声音衰减到 60%
  stealFade: 0.03,      // 被顶掉的声音用多长时间淡出（秒）
  rateWindow: 0.5,      // 统计「这类事件每秒来多少个」的窗口（dense 切换用）
}

// ---------------------------------------------------------------- 音效分组（变体轮播）
// 组名 → 文件名列表（不带目录和扩展名，实际文件是 assets/audio/sfx/<名字>.ogg）
export const SFX = {
  // 我方枪炮
  rifle_shot: seq('rifle_shot', 5),
  rifle_burst: seq('rifle_burst', 4),
  hmg_shot: seq('hmg_shot', 2),
  hmg_burst: seq('hmg_burst', 3),
  shotgun: ['shotgun_01'],
  sniper: ['sniper_shot_01'],
  cannon: seq('cannon', 3),
  cannon_heavy: seq('cannon_heavy', 2),
  missile: seq('missile_launch', 3),
  laser_small: seq('laser_small', 3),
  laser_large: seq('laser_large', 3),
  laser_retro: seq('laser_retro', 2),
  laser_burst: ['laser_burst_01'],
  plasma_short: ['plasma_03'],
  plasma_long: ['plasma_01', 'plasma_02', 'plasma_05', 'plasma_06'],
  plasma_heavy: ['plasma_04'],
  flame_loop: ['flamethrower_loop_01', 'flamethrower_loop_03'],
  scorcher_loop: ['flamethrower_loop_02'],
  fire_bed: ['flamethrower_loop_04'],
  // 爆炸
  explosion_small: seq('explosion_small', 3),
  explosion_medium: seq('explosion_medium', 4),
  explosion_large: seq('explosion_large', 5),
  explosion_huge: ['explosion_huge_01'],
  // 虫
  bug_screech: seq('bug_screech', 8),
  bug_chitter: seq('bug_chitter', 7),
  bug_attack: seq('bug_attack', 3),
  bug_spit: seq('bug_spit', 2),
  bug_death: seq('bug_death', 4),
  bug_splat: seq('bug_splat', 8),
  gore_long: ['gore_splatter_long_01'],
  roar: seq('beast_roar', 6),
  roar_long: seq('beast_roar_long', 5),
  // 脚步 / 受击
  footstep: seq('footstep', 5),
  stomp: seq('mech_stomp', 5),
  stomp_short: ['mech_stomp_03', 'mech_stomp_04'],
  impact_metal: seq('bullet_impact_metal', 3),
  impact_flesh: seq('bullet_impact_flesh', 2),
  // 界面
  ui_click: seq('ui_click', 3),
  ui_hover: seq('ui_hover', 3),
  ui_confirm: ['ui_confirm_01', 'ui_confirm_02'],
  ui_confirm_long: ['ui_confirm_03'],
  ui_error: ['ui_error_01', 'ui_error_02'],
  ui_error_long: ['ui_error_03'],
  ui_back: ['ui_back_01'],
  ui_open: ['ui_open_01'],
  ui_close: ['ui_close_01'],
  ui_toggle: ['ui_toggle_01'],
  gate_pass: ['gate_pass_01'],
  gate_pass_bad: ['gate_pass_bad_01'],
  levelup: seq('levelup', 4),
  jingle: seq('levelup', 3, 5),
  pickup: seq('pickup_xp', 4),
  skill_ready: seq('skill_ready', 4),
  // 警报 / 通讯 / 增援
  alarm: ['alarm_01'],
  siren: ['alarm_siren_01'],
  klaxon: ['alarm_klaxon_01'],
  beep: seq('warning_beep', 3),
  radio_blip: seq('radio_blip', 2),
  radio_static: seq('radio_static', 3),
  computer: ['computer_noise_01'],
  reinforce_short: ['reinforce_arrive_02', 'reinforce_arrive_03', 'reinforce_arrive_06'],
  reinforce_long: ['reinforce_arrive_01', 'reinforce_arrive_04', 'reinforce_arrive_05'],
  whistle: seq('airstrike_whistle', 2),
  flyby: seq('airstrike_flyby', 2),
  shield_up: seq('shield_up', 2),
  shield_hit: seq('shield_hit', 2),
  shield_down: ['shield_down_01'],
  // 胜负
  victory: ['victory_stinger_01'],
  victory_short: ['victory_stinger_02', 'victory_stinger_03'],
  defeat: ['defeat_stinger_05'],
  defeat_short: seq('defeat_stinger', 4),
  // 循环底噪
  heartbeat_slow: ['heartbeat_slow_loop'],
  heartbeat_fast: ['heartbeat_fast_loop'],
  ambient_machine: ['ambient_machine_loop_01'],
  ambient_scifi: ['ambient_scifi_loop_01'],
}

// ---------------------------------------------------------------- 事件 → 声音
// 一条规则（rule）的字段，除 sfx 外都可省略：
//   sfx    SFX 里的组名（每次触发按顺序轮播组里的变体，不会连着放同一个）
//   ch     通道：weapons / swarm / voice / ui（默认 weapons）
//   gap    最小间隔，毫秒。间隔内再来的同类事件直接丢掉（默认 60）
//   vol    音量 0..1（默认 0.5）
//   pitch  随机音高幅度，0.05 = ±5%（默认 0.05）
//   rate   基础播放速度，<1 更低沉（默认 1）
//   prio   优先级 0..9。≥ LIMITS.preemptPrio 的在满员时可以抢占别人（默认 2）
//   max    这类声音最多同时响几个（默认 6）
//   delay  延后多少秒再响；dur 只放前多少秒然后淡出
//   pan    false = 不按事件的 x 做左右声像（界面类声音默认就不做）
//   duck   响的时候把音乐压低多少秒
//   dense  { over, sfx, gap, vol, max }：这类事件每秒超过 over 个时，改用另一组素材（例：零星步枪点射 → 连发长音）
//   loop   true = 持续声：事件不断来就一直响，hold 秒没再来就淡出；hold: 'dur' 表示按事件自带的 dur 字段
//   key    节流分组名。不写则每条规则各算各的；写成一样的就共用一个间隔 / 同时数
// 一种事件可以挂多条规则（写成数组，叠着响）。
// 按字段分流：{ by: 'kind', cases: { 值: 规则 | [规则] | null(不出声) , _: 兜底 } }；by 也可以是数组，依次尝试。
export const EVENT_MAP = {
  // ---- 我方开火 ----
  shot: {
    by: 'kind',
    cases: {
      rifle: { sfx: 'rifle_shot', gap: 45, vol: 0.3, prio: 1, max: 8, dense: { over: 45, sfx: 'rifle_burst', gap: 95, vol: 0.27, max: 7 } },
      hero_hawk: { sfx: 'laser_small', gap: 70, vol: 0.32, prio: 2, max: 3 },
      mortar: { sfx: 'cannon', gap: 110, vol: 0.5, prio: 3, max: 4, pitch: 0.08 },
      titan: { sfx: 'cannon_heavy', gap: 140, vol: 0.62, prio: 3, max: 3 },
      lancer: { sfx: 'sniper', gap: 90, vol: 0.5, prio: 3, max: 3, rate: 0.85 },
      skyhook: { sfx: 'laser_retro', gap: 90, vol: 0.22, prio: 1, max: 3 },
      companion: { sfx: 'laser_retro', gap: 120, vol: 0.22, prio: 1, max: 2, rate: 1.25 },
      _: { sfx: 'rifle_shot', gap: 60, vol: 0.28, prio: 1, max: 4, key: 'shot:other' },
    },
  },
  volley: {
    by: 'kind',
    cases: {
      rifle: { sfx: 'hmg_burst', gap: 300, vol: 0.55, prio: 5, max: 2, pan: false },
      lancer: { sfx: 'laser_burst', gap: 300, vol: 0.55, prio: 5, max: 2, pan: false },
      titan: { sfx: 'cannon_heavy', gap: 300, vol: 0.7, prio: 5, max: 2, rate: 0.85, pan: false },
      skyhook: { sfx: 'missile', gap: 300, vol: 0.5, prio: 5, max: 2, pan: false },
      _: { sfx: 'hmg_burst', gap: 300, vol: 0.5, prio: 5, max: 2, pan: false, key: 'volley:other' },
    },
  },
  beam: {
    by: 'kind',
    cases: {
      hero_joe: { sfx: 'laser_retro', gap: 180, vol: 0.14, prio: 1, max: 2, rate: 0.7 },
      reaper: { sfx: 'laser_large', gap: 130, vol: 0.4, prio: 3, max: 3 },
      reaper_return: { sfx: 'laser_large', gap: 130, vol: 0.32, prio: 2, max: 3, rate: 1.2, key: 'beam:reaper' },
      hawk_flagship: { sfx: 'laser_large', gap: 160, vol: 0.45, prio: 4, max: 3, rate: 0.85 },
      hawk_flagship_gun: [{ sfx: 'plasma_heavy', gap: 400, vol: 0.85, prio: 8, max: 1, rate: 0.8, duck: 1.2 }],
      ysera_lance: [{ sfx: 'plasma_heavy', gap: 300, vol: 0.8, prio: 8, max: 2, duck: 1 }, { sfx: 'laser_burst', gap: 300, vol: 0.5, prio: 7, max: 1, rate: 0.7 }],
      joe_ray: { sfx: 'laser_large', gap: 220, vol: 0.55, prio: 6, max: 2, rate: 0.6 },
      _: { sfx: 'laser_small', gap: 120, vol: 0.3, prio: 2, max: 3, key: 'beam:other' },
    },
  },
  flame: { sfx: 'flame_loop', loop: true, hold: 0.35, vol: 0.42, prio: 3, max: 1 },
  storm: { sfx: 'plasma_long', gap: 350, vol: 0.45, prio: 3, max: 2 },
  chain: { sfx: 'plasma_short', gap: 90, vol: 0.3, prio: 2, max: 3, pitch: 0.1 },
  melee: { sfx: 'plasma_short', gap: 120, vol: 0.42, prio: 3, max: 2, rate: 0.75, pitch: 0.08 },
  explosion: {
    by: ['kind', 'size'],
    cases: {
      acid: { sfx: 'bug_splat', gap: 120, vol: 0.5, prio: 3, max: 3, rate: 0.7, ch: 'swarm', key: 'acid_splash' },
      s: { sfx: 'explosion_small', gap: 80, vol: 0.34, prio: 2, max: 5, pitch: 0.1 },
      m: { sfx: 'explosion_medium', gap: 90, vol: 0.48, prio: 3, max: 5, pitch: 0.08 },
      l: { sfx: 'explosion_large', gap: 120, vol: 0.62, prio: 4, max: 4, pitch: 0.06 },
      xl: { sfx: 'explosion_huge', gap: 500, vol: 1, prio: 9, max: 2, duck: 1.5 },
      _: { sfx: 'explosion_small', gap: 80, vol: 0.34, prio: 2, max: 5, key: 'explosion:s' },
    },
  },
  zone: {
    by: 'style',
    cases: {
      fire: { sfx: 'fire_bed', loop: true, hold: 'dur', vol: 0.22, prio: 1, max: 1 },
      _: null,     // 风暴 / 酸液 / 长矛 / 地雷的区域，各自另有事件出声
    },
  },

  // ---- 虫 ----
  enemyHit: { sfx: 'impact_flesh', gap: 70, vol: 0.13, prio: 0, max: 4, pitch: 0.15, ch: 'swarm' },
  enemyDie: {
    by: 'kind',
    cases: {
      ling: [
        { sfx: 'bug_splat', gap: 30, vol: 0.22, prio: 1, max: 9, pitch: 0.15, ch: 'swarm', key: 'die:splat' },
        { sfx: 'bug_death', gap: 240, vol: 0.2, prio: 1, max: 3, pitch: 0.2, ch: 'swarm', key: 'die:squeal' },
      ],
      crusher: [{ sfx: 'roar', gap: 250, vol: 0.5, prio: 5, max: 2, rate: 1.15, ch: 'swarm', key: 'die:big' }, { sfx: 'bug_splat', gap: 30, vol: 0.4, prio: 2, max: 9, rate: 0.7, ch: 'swarm', key: 'die:splat' }],
      hulk: [{ sfx: 'roar', gap: 250, vol: 0.6, prio: 5, max: 2, rate: 0.85, ch: 'swarm', key: 'die:big' }, { sfx: 'explosion_medium', gap: 200, vol: 0.4, prio: 3, max: 2, rate: 0.8, ch: 'swarm', key: 'die:thud' }],
      warden: [{ sfx: 'roar', gap: 250, vol: 0.55, prio: 5, max: 2, rate: 1.3, ch: 'swarm', key: 'die:big' }, { sfx: 'shield_down', gap: 200, vol: 0.4, prio: 3, max: 1, ch: 'swarm' }],
      egg: { sfx: 'bug_splat', gap: 30, vol: 0.3, prio: 1, max: 9, rate: 1.3, ch: 'swarm', key: 'die:splat' },
      pod: null,   // 空投舱被打开走 podOpen
      _: [
        { sfx: 'bug_splat', gap: 30, vol: 0.26, prio: 1, max: 9, pitch: 0.12, ch: 'swarm', key: 'die:splat' },
        { sfx: 'bug_death', gap: 240, vol: 0.24, prio: 1, max: 3, pitch: 0.15, ch: 'swarm', key: 'die:squeal' },
      ],
    },
  },
  enemyAttack: {
    by: 'kind',
    cases: {
      crusher: { sfx: 'stomp', gap: 200, vol: 0.45, prio: 3, max: 2, ch: 'swarm', key: 'atk:heavy' },
      hulk: { sfx: 'stomp', gap: 200, vol: 0.55, prio: 3, max: 2, rate: 0.8, ch: 'swarm', key: 'atk:heavy' },
      _: { sfx: 'bug_attack', gap: 160, vol: 0.26, prio: 1, max: 3, pitch: 0.12, ch: 'swarm' },
    },
  },
  spit: { sfx: 'bug_spit', gap: 120, vol: 0.4, prio: 2, max: 3, ch: 'swarm' },
  burst: [
    { sfx: 'bug_splat', gap: 80, vol: 0.45, prio: 2, max: 3, rate: 0.8, ch: 'swarm', key: 'burst:splat' },
    { sfx: 'explosion_small', gap: 80, vol: 0.3, prio: 2, max: 5, rate: 1.2, ch: 'swarm', key: 'explosion:s' },
  ],
  emerge: [
    { sfx: 'stomp', gap: 160, vol: 0.4, prio: 3, max: 2, ch: 'swarm', key: 'emerge:thud' },
    { sfx: 'bug_screech', gap: 300, vol: 0.32, prio: 2, max: 2, ch: 'swarm', key: 'emerge:screech' },
  ],
  hatch: { sfx: 'bug_chitter', gap: 200, vol: 0.4, prio: 2, max: 2, rate: 1.3, ch: 'swarm' },
  revive: { sfx: 'bug_chitter', gap: 220, vol: 0.18, prio: 0, max: 2, rate: 0.8, ch: 'swarm' },
  leak: { sfx: 'beep', gap: 350, vol: 0.45, prio: 6, max: 2, ch: 'voice', pan: false },
  waveStart: { sfx: 'bug_screech', gap: 2500, vol: 0.28, prio: 2, max: 1, rate: 0.8, ch: 'swarm', pan: false },
  acidRain: [{ sfx: 'beep', gap: 800, vol: 0.4, prio: 6, max: 1, ch: 'voice', pan: false, key: 'acidrain:beep' }, { sfx: 'bug_spit', gap: 800, vol: 0.5, prio: 4, max: 1, rate: 0.6, ch: 'swarm', pan: false, key: 'acidrain:spit' }],
  acidHit: { sfx: 'bug_splat', gap: 120, vol: 0.45, prio: 3, max: 3, rate: 0.7, ch: 'swarm', key: 'acid_splash' },

  // ---- Boss ----
  bossSpawn: [
    { sfx: 'roar_long', gap: 1000, vol: 1, prio: 9, max: 2, ch: 'swarm', pan: false, duck: 2.5 },
    { sfx: 'klaxon', gap: 1000, vol: 0.4, prio: 8, max: 1, ch: 'voice', pan: false, delay: 0.25 },
  ],
  bossHit: { sfx: 'impact_metal', gap: 90, vol: 0.18, prio: 1, max: 3, pitch: 0.12, ch: 'swarm' },
  bossStun: [{ sfx: 'shield_down', gap: 500, vol: 0.6, prio: 8, max: 1, rate: 0.7, ch: 'swarm' }, { sfx: 'roar', gap: 500, vol: 0.6, prio: 8, max: 2, rate: 1.25, ch: 'swarm', key: 'boss:roar' }],
  bossDie: [
    { sfx: 'explosion_huge', gap: 1000, vol: 1, prio: 9, max: 2, ch: 'swarm', duck: 4, key: 'bossdie:boom' },
    { sfx: 'gore_long', gap: 1000, vol: 0.8, prio: 9, max: 1, ch: 'swarm' },
    { sfx: 'roar_long', gap: 1000, vol: 0.9, prio: 9, max: 2, rate: 0.75, ch: 'swarm', key: 'bossdie:roar' },
  ],
  bossAttack: {
    by: 'kind',
    cases: {
      charge_windup: { sfx: 'roar', gap: 400, vol: 0.75, prio: 8, max: 2, ch: 'swarm', key: 'boss:roar' },
      charge: { sfx: 'stomp', gap: 300, vol: 0.8, prio: 7, max: 2, rate: 0.7, ch: 'swarm', key: 'boss:stomp' },
      charge_hit: [{ sfx: 'explosion_large', gap: 300, vol: 0.7, prio: 7, max: 4, ch: 'swarm', key: 'boss:slam' }, { sfx: 'impact_metal', gap: 300, vol: 0.5, prio: 6, max: 2, rate: 0.6, ch: 'swarm', key: 'boss:clang' }],
      sweep: [{ sfx: 'bug_attack', gap: 300, vol: 0.7, prio: 7, max: 2, rate: 0.6, ch: 'swarm', key: 'boss:swipe' }, { sfx: 'stomp', gap: 300, vol: 0.5, prio: 6, max: 2, ch: 'swarm', key: 'boss:stomp' }],
      // 第 1 轮测试新增的 kind（harden / harden_end / summon / crash）走下面的默认吼声
      enrage: { sfx: 'roar_long', gap: 1000, vol: 0.95, prio: 9, max: 2, rate: 1.1, ch: 'swarm', duck: 1.5, key: 'boss:enrage' },
      acid: { sfx: 'bug_spit', gap: 300, vol: 0.75, prio: 7, max: 2, rate: 0.6, ch: 'swarm', key: 'boss:spit' },
      acid_hit: { sfx: 'bug_splat', gap: 120, vol: 0.45, prio: 3, max: 3, rate: 0.7, ch: 'swarm', key: 'acid_splash' },
      lay: { sfx: 'bug_chitter', gap: 300, vol: 0.6, prio: 6, max: 2, rate: 0.6, ch: 'swarm', key: 'boss:lay' },
      burrow: [{ sfx: 'stomp', gap: 300, vol: 0.7, prio: 7, max: 2, rate: 0.7, ch: 'swarm', key: 'boss:stomp' }, { sfx: 'explosion_small', gap: 300, vol: 0.4, prio: 5, max: 5, rate: 0.7, ch: 'swarm', key: 'boss:dirt' }],
      emerge_windup: { sfx: 'beep', gap: 400, vol: 0.5, prio: 7, max: 1, ch: 'voice', pan: false, key: 'boss:warn' },
      emerge: [{ sfx: 'explosion_large', gap: 300, vol: 0.75, prio: 8, max: 4, ch: 'swarm', key: 'boss:slam' }, { sfx: 'roar', gap: 400, vol: 0.7, prio: 8, max: 2, rate: 0.9, ch: 'swarm', key: 'boss:roar' }],
      spines_windup: { sfx: 'bug_screech', gap: 400, vol: 0.6, prio: 7, max: 2, rate: 0.6, ch: 'swarm', key: 'boss:screech' },
      spines: [{ sfx: 'explosion_medium', gap: 200, vol: 0.55, prio: 6, max: 3, ch: 'swarm', key: 'boss:spines' }, { sfx: 'impact_metal', gap: 200, vol: 0.45, prio: 5, max: 2, ch: 'swarm', key: 'boss:clang' }],
      _: { sfx: 'roar', gap: 400, vol: 0.6, prio: 7, max: 2, ch: 'swarm', key: 'boss:roar' },
    },
  },

  // ---- 我方受击 / 增减员 ----
  unitHit: { sfx: 'impact_metal', gap: 140, vol: 0.28, prio: 2, max: 2, key: 'metal_hit' },
  unitDie: { sfx: 'defeat_short', gap: 350, vol: 0.32, prio: 5, max: 1, ch: 'voice', rate: 1.2 },
  shieldBreak: { sfx: 'shield_down', gap: 150, vol: 0.5, prio: 4, max: 2 },
  aegis: { sfx: 'shield_up', gap: 300, vol: 0.55, prio: 6, max: 2 },
  heal: { sfx: 'shield_up', gap: 500, vol: 0.35, prio: 4, max: 1, rate: 1.3, ch: 'ui', key: 'heal' },
  unitJoin: {
    by: 'source',
    cases: {
      start: null,     // 开局列队不出声
      _: { sfx: 'reinforce_short', gap: 400, vol: 0.5, prio: 6, max: 2, ch: 'voice', pan: false, delay: 0.12 },
    },
  },
  ally: { sfx: 'reinforce_long', gap: 1000, vol: 0.6, prio: 7, max: 1, ch: 'voice', pan: false, key: 'reinforce_long' },

  // ---- 增援门 / 空投舱 ----
  gateSpawn: { sfx: 'ui_open', gap: 500, vol: 0.4, prio: 5, max: 1, ch: 'ui' },
  gateResolve: { sfx: 'gate_pass', gap: 300, vol: 0.7, prio: 7, max: 1, ch: 'ui' },
  podLand: [{ sfx: 'explosion_medium', gap: 300, vol: 0.5, prio: 5, max: 5, key: 'explosion:m' }, { sfx: 'stomp', gap: 300, vol: 0.5, prio: 5, max: 2, rate: 0.7, key: 'pod:thud' }],
  podOpen: { sfx: 'reinforce_long', gap: 1000, vol: 0.6, prio: 7, max: 1, ch: 'voice', key: 'reinforce_long' },
  podLost: [{ sfx: 'ui_error_long', gap: 500, vol: 0.5, prio: 6, max: 1, ch: 'voice', pan: false }, { sfx: 'explosion_medium', gap: 300, vol: 0.45, prio: 4, max: 5, key: 'explosion:m' }],

  // ---- 成长 ----
  xp: { sfx: 'pickup', gap: 150, vol: 0.12, prio: 0, max: 2, pitch: 0.12, ch: 'ui', pan: true },
  energy: {
    by: 'source',
    cases: {
      kill: { sfx: 'pickup', gap: 180, vol: 0.1, prio: 0, max: 2, rate: 1.35, pitch: 0.1, ch: 'ui', pan: true, key: 'energy:tick' },
      collector: { sfx: 'pickup', gap: 300, vol: 0.2, prio: 1, max: 2, rate: 0.8, ch: 'ui', pan: true },
      gate: { sfx: 'gate_pass', gap: 300, vol: 0.5, prio: 5, max: 1, rate: 1.2, ch: 'ui', key: 'energy:gate' },
      _: null,     // 铲除返还：deviceRemove 已经出声
    },
  },
  levelUp: { sfx: 'levelup', gap: 300, vol: 0.7, prio: 8, max: 1, ch: 'ui', duck: 0.8 },
  cardPicked: { sfx: 'ui_confirm', gap: 120, vol: 0.6, prio: 7, max: 1, ch: 'ui' },
  combo: { sfx: 'jingle', gap: 400, vol: 0.65, prio: 8, max: 1, ch: 'ui', duck: 1 },
  heroic: { sfx: 'victory_short', gap: 400, vol: 0.75, prio: 9, max: 1, ch: 'ui', duck: 1.2 },
  overdrive: { sfx: 'plasma_long', gap: 1000, vol: 0.4, prio: 5, max: 2, rate: 1.4, pan: false },
  rankUp: { sfx: 'ui_toggle', gap: 600, vol: 0.35, prio: 4, max: 1, rate: 1.3, ch: 'ui' },
  boon: { sfx: 'ui_confirm_long', gap: 500, vol: 0.55, prio: 7, max: 1, ch: 'ui' },
  companion: {
    by: 'kind',
    cases: {
      join: { sfx: 'radio_blip', gap: 300, vol: 0.5, prio: 5, max: 1, ch: 'ui' },
      found: { sfx: 'jingle', gap: 400, vol: 0.5, prio: 7, max: 1, ch: 'ui', key: 'companion:jingle' },
      evolve: { sfx: 'jingle', gap: 400, vol: 0.6, prio: 8, max: 1, ch: 'ui', key: 'companion:jingle' },
      scan: { sfx: 'computer', gap: 600, vol: 0.25, prio: 3, max: 1, dur: 0.6, ch: 'ui', pan: true },
      pulse: [{ sfx: 'plasma_long', gap: 400, vol: 0.45, prio: 5, max: 2, rate: 1.2 }, { sfx: 'explosion_small', gap: 80, vol: 0.34, prio: 2, max: 5, key: 'explosion:s' }],
      _: null,
    },
  },

  // ---- 指挥官技能 ----
  powerReady: { sfx: 'skill_ready', gap: 250, vol: 0.45, prio: 6, max: 2, ch: 'ui' },
  powerCast: {
    by: 'id',
    cases: {
      hawk_rally: { sfx: 'reinforce_long', gap: 400, vol: 0.6, prio: 7, max: 1, ch: 'voice', pan: false, key: 'reinforce_long' },
      hawk_strike: { sfx: 'flyby', gap: 400, vol: 0.7, prio: 7, max: 2, pan: false, key: 'cast:flyby' },
      hawk_drop: { sfx: 'flyby', gap: 400, vol: 0.6, prio: 7, max: 2, rate: 0.85, pan: false, key: 'cast:flyby' },
      hawk_flagship: [{ sfx: 'flyby', gap: 400, vol: 0.85, prio: 8, max: 2, rate: 0.6, pan: false, duck: 2, key: 'cast:flyby' }, { sfx: 'siren', gap: 3000, vol: 0.3, prio: 6, max: 1, dur: 3, ch: 'voice', pan: false }],
      ysera_orbital: { sfx: 'laser_burst', gap: 400, vol: 0.6, prio: 7, max: 2, rate: 0.6, pan: false },
      ysera_lance: { sfx: 'plasma_long', gap: 400, vol: 0.55, prio: 7, max: 2, rate: 0.8, pan: false },
      ysera_eclipse: [{ sfx: 'plasma_heavy', gap: 400, vol: 0.8, prio: 8, max: 2, rate: 0.6, pan: false, duck: 1.5 }],
      joe_drop: { sfx: 'flyby', gap: 400, vol: 0.6, prio: 7, max: 2, rate: 1.1, pan: false, key: 'cast:flyby' },
      joe_mines: { sfx: 'missile', gap: 400, vol: 0.5, prio: 7, max: 2, pan: false },
      joe_ray: { sfx: 'plasma_heavy', gap: 400, vol: 0.7, prio: 8, max: 2, rate: 0.9, pan: false, duck: 1 },
      _: { sfx: 'ui_confirm', gap: 300, vol: 0.5, prio: 7, max: 1, ch: 'ui' },
    },
  },
  strike: {
    by: 'kind',
    cases: {
      bomb: { sfx: 'whistle', gap: 260, vol: 0.35, prio: 4, max: 3, rate: 1.8, dur: 1 },
      pod: { sfx: 'whistle', gap: 260, vol: 0.4, prio: 5, max: 3, rate: 1.5, dur: 1.2, key: 'strike:drop' },
      robot: { sfx: 'whistle', gap: 260, vol: 0.4, prio: 5, max: 3, rate: 1.3, dur: 1.2, key: 'strike:drop' },
      orbital: { sfx: 'laser_large', gap: 140, vol: 0.4, prio: 4, max: 3, rate: 0.6 },
      main_gun: { sfx: 'klaxon', gap: 800, vol: 0.45, prio: 7, max: 1, ch: 'voice', pan: false, key: 'strike:warn' },
      mine: { sfx: 'stomp_short', gap: 70, vol: 0.3, prio: 2, max: 3, rate: 1.3 },
      _: { sfx: 'whistle', gap: 300, vol: 0.35, prio: 4, max: 3, rate: 1.6, dur: 1, key: 'strike:other' },
    },
  },
  aimStart: { sfx: 'ui_toggle', gap: 200, vol: 0.5, prio: 6, max: 1, rate: 0.8, ch: 'ui' },
  aimEnd: { sfx: 'ui_click', gap: 120, vol: 0.5, prio: 6, max: 1, ch: 'ui' },
  summon: {
    by: 'kind',
    cases: {
      flagship: { sfx: 'ambient_scifi', gap: 1000, vol: 0.5, prio: 6, max: 1, dur: 6, rate: 0.7, pan: false },
      robot: { sfx: 'stomp', gap: 200, vol: 0.55, prio: 5, max: 2, rate: 0.75, key: 'summon:thud' },
      ray: { sfx: 'plasma_long', gap: 500, vol: 0.5, prio: 6, max: 2, rate: 0.7 },
      _: null,
    },
  },
  summonEnd: { by: 'kind', cases: { robot: { sfx: 'shield_down', gap: 250, vol: 0.3, prio: 2, max: 1, rate: 0.8 }, _: null } },

  // ---- 布防 ----
  devicePlace: [{ sfx: 'stomp_short', gap: 100, vol: 0.5, prio: 6, max: 2, key: 'place:thud' }, { sfx: 'ui_confirm', gap: 100, vol: 0.4, prio: 6, max: 1, ch: 'ui', pan: false, key: 'place:ok' }],
  deviceFire: {
    by: 'kind',
    cases: {
      sentry: { sfx: 'hmg_shot', gap: 60, vol: 0.24, prio: 1, max: 5, pitch: 0.08, dense: { over: 30, sfx: 'hmg_burst', gap: 380, vol: 0.26, max: 3 } },
      mortarpit: { sfx: 'cannon', gap: 140, vol: 0.4, prio: 3, max: 3, rate: 1.2, key: 'dev:mortar' },
      cryo: { sfx: 'laser_retro', gap: 110, vol: 0.24, prio: 1, max: 3, rate: 0.8 },
      scorcher: { sfx: 'scorcher_loop', loop: true, hold: 0.5, vol: 0.3, prio: 2, max: 1 },
      _: { sfx: 'hmg_shot', gap: 80, vol: 0.22, prio: 1, max: 3, key: 'dev:other' },
    },
  },
  deviceHit: { sfx: 'impact_metal', gap: 140, vol: 0.28, prio: 2, max: 2, key: 'metal_hit' },
  deviceDie: [{ sfx: 'explosion_medium', gap: 150, vol: 0.5, prio: 6, max: 5, key: 'explosion:m' }, { sfx: 'shield_down', gap: 300, vol: 0.4, prio: 5, max: 1, rate: 0.7, key: 'dev:down' }],
  deviceRemove: { sfx: 'ui_close', gap: 100, vol: 0.5, prio: 5, max: 1, ch: 'ui' },
  deviceUnlock: { sfx: 'skill_ready', gap: 400, vol: 0.5, prio: 6, max: 2, rate: 1.2, ch: 'ui', key: 'unlock' },
  placeFail: { sfx: 'ui_error', gap: 200, vol: 0.5, prio: 6, max: 1, ch: 'ui' },
  mineArm: { sfx: 'beep', gap: 200, vol: 0.25, prio: 2, max: 1, rate: 1.5, key: 'mine:arm' },
  mineBlast: { sfx: 'explosion_large', gap: 120, vol: 0.62, prio: 5, max: 4, key: 'explosion:l' },
  novaBlast: [{ sfx: 'explosion_huge', gap: 500, vol: 0.9, prio: 8, max: 2, rate: 1.2, duck: 1.2, key: 'nova:boom' }, { sfx: 'plasma_heavy', gap: 500, vol: 0.6, prio: 7, max: 2, key: 'nova:zap' }],
  fence: [
    { sfx: 'plasma_heavy', gap: 300, vol: 0.85, prio: 9, max: 2, rate: 1.2, duck: 1.2, key: 'fence:zap' },
    { sfx: 'explosion_large', gap: 300, vol: 0.6, prio: 8, max: 4, key: 'fence:boom' },
    { sfx: 'alarm', gap: 1500, vol: 0.4, prio: 8, max: 1, ch: 'voice', pan: false, key: 'alarm' },
  ],
  fenceRefill: { sfx: 'shield_up', gap: 500, vol: 0.55, prio: 6, max: 2, ch: 'ui', pan: false },

  // ---- 播报 / 流程 ----
  herald: { sfx: 'klaxon', gap: 2000, vol: 0.5, prio: 8, max: 1, ch: 'voice', pan: false },
  flankWarn: { sfx: 'alarm', gap: 1500, vol: 0.45, prio: 8, max: 1, ch: 'voice', pan: false, key: 'alarm' },
  comms: [{ sfx: 'radio_blip', gap: 400, vol: 0.6, prio: 7, max: 1, ch: 'voice', pan: false }, { sfx: 'radio_static', gap: 400, vol: 0.16, prio: 5, max: 1, dur: 0.45, delay: 0.03, ch: 'voice', pan: false }],
  phase: { by: 'name', cases: { 'phase.boss': null, _: { sfx: 'ui_toggle', gap: 500, vol: 0.35, prio: 5, max: 1, ch: 'voice', pan: false } } },
  layer: { sfx: 'ui_confirm_long', gap: 1000, vol: 0.5, prio: 7, max: 1, ch: 'voice', pan: false },
  mutator: { sfx: 'computer', gap: 400, vol: 0.35, prio: 6, max: 1, dur: 0.8, ch: 'voice', pan: false },
  win: { sfx: 'victory', gap: 3000, vol: 0.9, prio: 9, max: 1, ch: 'voice', pan: false, duck: 5 },
  lose: [{ sfx: 'defeat', gap: 3000, vol: 0.9, prio: 9, max: 1, ch: 'voice', pan: false, duck: 3 }, { sfx: 'defeat_short', gap: 3000, vol: 0.5, prio: 9, max: 1, ch: 'voice', pan: false, delay: 0.4, key: 'lose:tail' }],
  retreat: { sfx: 'flyby', gap: 3000, vol: 0.7, prio: 9, max: 2, rate: 0.8, ch: 'voice', pan: false, duck: 2 },
}

// 明确不出声的事件（不是漏了，是故意的）。新增事件类型时必须二选一：进 EVENT_MAP 或写到这里。
export const SILENT_EVENTS = {
  bigHit: '只给飘字用；命中声由 enemyHit / bossHit 负责',
  hitstop: '顿帧，纯画面',
  shake: '震屏，纯画面',
  bossPhase: 'Boss 换阶段的横幅；声音由同一步的 bossAttack（harden / summon / enrage，走默认吼声）和通讯负责',
}

// ---------------------------------------------------------------- 界面音（UI 层直接调 audio.ui('click')）
export const UI_MAP = {
  click: { sfx: 'ui_click', gap: 30, vol: 0.5, prio: 7, max: 2, ch: 'ui' },
  hover: { sfx: 'ui_hover', gap: 40, vol: 0.25, prio: 3, max: 2, ch: 'ui' },
  confirm: { sfx: 'ui_confirm', gap: 80, vol: 0.6, prio: 7, max: 1, ch: 'ui' },
  deploy: { sfx: 'ui_confirm_long', gap: 300, vol: 0.7, prio: 8, max: 1, ch: 'ui' },
  error: { sfx: 'ui_error', gap: 120, vol: 0.5, prio: 7, max: 1, ch: 'ui' },
  back: { sfx: 'ui_back', gap: 60, vol: 0.5, prio: 7, max: 1, ch: 'ui' },
  open: { sfx: 'ui_open', gap: 80, vol: 0.5, prio: 7, max: 1, ch: 'ui' },
  close: { sfx: 'ui_close', gap: 80, vol: 0.5, prio: 7, max: 1, ch: 'ui' },
  toggle: { sfx: 'ui_toggle', gap: 60, vol: 0.5, prio: 7, max: 1, ch: 'ui' },
  select: { sfx: 'ui_toggle', gap: 60, vol: 0.45, prio: 7, max: 1, rate: 1.2, ch: 'ui', key: 'ui:select' },   // 选中装置卡
  reroll: { sfx: 'radio_blip', gap: 100, vol: 0.6, prio: 7, max: 1, ch: 'ui', key: 'ui:reroll' },
  pause: { sfx: 'ui_open', gap: 150, vol: 0.5, prio: 8, max: 1, rate: 0.8, ch: 'ui', key: 'ui:pause' },
  resume: { sfx: 'ui_close', gap: 150, vol: 0.5, prio: 8, max: 1, rate: 1.2, ch: 'ui', key: 'ui:resume' },
  bad: { sfx: 'gate_pass_bad', gap: 200, vol: 0.6, prio: 7, max: 1, ch: 'ui' },                              // 负面选择（突变因子打开等）
}

// ---------------------------------------------------------------- 跟着世界状态走的声音（audio.update 里驱动，不靠事件）
export const STATE = {
  // 战斗中的舰桥机械底噪
  ambient: { sfx: 'ambient_machine', vol: 0.1, ch: 'swarm', prio: 6 },
  // 防线血量低于 low 起慢心跳，低于 critical 换快心跳
  heartbeat: { low: 0.4, critical: 0.18, slow: { sfx: 'heartbeat_slow', vol: 0.5, ch: 'voice', prio: 8 }, fast: { sfx: 'heartbeat_fast', vol: 0.65, ch: 'voice', prio: 8 } },
  // 虫潮的远处嘶叫：在场虫越多叫得越密。every = [最稀, 最密] 秒；at = 在场多少只算「最密」
  swarmBed: { sfx: 'bug_chitter', alt: 'bug_screech', altChance: 0.3, every: [2.4, 0.45], at: 900, min: 12, vol: 0.2, pitch: 0.2, prio: 0, max: 3, ch: 'swarm' },
  // 队伍横移时的脚步；有机甲时夹重踏
  footsteps: { sfx: 'footstep', gap: 150, vol: 0.1, pitch: 0.15, prio: 0, max: 2, ch: 'weapons', minSpeed: 0.6, heavy: { sfx: 'stomp_short', gap: 520, vol: 0.16, prio: 0, max: 1, ch: 'weapons', units: ['titan', 'reaper', 'hero_joe'] } },
}

// ---------------------------------------------------------------- 音乐
// 状态 → 曲目列表（每次进入这个状态换下一首）。文件在 assets/audio/music/<id>.ogg，另有同名 .mp3 兜底。
export const MUSIC = {
  fade: 1.2,                       // 交叉淡化秒数
  volume: 0.85,                    // 每首曲子的基础音量（再乘 music 通道推子）
  duckTo: 0.45,                    // 被压低时的音量比例
  muffleHz: 700,                   // 升级选卡 / 暂停时低通到这个频率
  hi: { killRate: 150, layer: 4, enter: 2, leaveBelow: 100, leave: 8 },   // battle ⇄ battle_hi：歼敌速度 >150/s 持续 2 秒切入，<100/s 持续 8 秒切回；无尽第 4 层起常驻
  states: {
    menu: ['menu_space_graveyard'],
    battle: ['battle_brute_force_loop', 'battle_net_infiltration_loop'],
    battle_hi: ['battle_determined_pursuit_loop', 'battle_hunter_class_lifeform'],
    boss: ['boss_epic_boss_battle_loop', 'boss_unsolicited_trailer_loop'],
    result: ['result_transmission'],
  },
}

// ---------------------------------------------------------------- 给校验 / 预加载用的小工具
export function allRules() {
  const out = []
  const push = (where, r) => {
    if (!r) return
    if (Array.isArray(r)) { r.forEach((x, i) => push(`${where}[${i}]`, x)); return }
    out.push({ where, rule: r })
    if (r.dense) out.push({ where: where + '.dense', rule: { ...r, ...r.dense, dense: undefined } })
  }
  for (const [type, m] of Object.entries(EVENT_MAP)) {
    if (m && m.cases) for (const [c, r] of Object.entries(m.cases)) push(`${type}.${c}`, r)
    else push(type, m)
  }
  for (const [name, r] of Object.entries(UI_MAP)) push(`ui.${name}`, r)
  push('state.ambient', STATE.ambient)
  push('state.heartbeat.slow', STATE.heartbeat.slow)
  push('state.heartbeat.fast', STATE.heartbeat.fast)
  push('state.swarmBed', STATE.swarmBed)
  push('state.swarmBed.alt', { ...STATE.swarmBed, sfx: STATE.swarmBed.alt })
  push('state.footsteps', STATE.footsteps)
  push('state.footsteps.heavy', STATE.footsteps.heavy)
  return out
}
export function usedSfxGroups() { return [...new Set(allRules().map(r => r.rule.sfx))] }
export function usedSfxFiles() { return [...new Set(usedSfxGroups().flatMap(g => SFX[g] || []))] }
export function usedMusicTracks() { return [...new Set(Object.values(MUSIC.states).flat())] }
