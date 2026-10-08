// 伙伴无人机「小七」。设计见 docs/GDD.md §11；行为在 src/sim/companion.js。
// 四个形态、三次进化：休眠 → 侦察（跟着队伍，不战斗）→ 武装（能量弹 + 战术扫描）→ 歼灭（再加冰冻脉冲）。
// 局内靠击杀经验成长（和升级用的是同一份经验，另乘成长倍率）；局外用培养点买成长速度。
export const COMPANION = {
  id: 'seven',
  forms: ['dormant', 'scout', 'armed', 'annihilator'],
  // 进化所需的累计经验（参考量级 8000 / 53000 / 74000，压到「战役中段醒来、无尽 5~6 层武装、10 层上下歼灭」）
  xp: [6000, 30000, 85000],
  // 无尽第 5 层才捡到它的那一局：直接以侦察形态入列，经验从第一道阈值起算
  foundStage: 1,
  hover: { dx: 2.4, dz: 1.2, y: 2.4, follow: 0.08 },
  // 能量弹：打最密处的小范围爆炸
  bolt: { every: 0.45, dmg: 24, bossDmg: 30, r: 1.7, maxTargets: 8, delay: 0.1 },
  // 战术扫描：圈内的虫被标定（护甲失效、受伤 +25%，同「天钩」联动的标定），到死为止
  scan: { every: 10, first: 3, r: 6.5 },
  // 冰冻脉冲：阵前一大圈，伤害 + 减速；轻型虫先冻住
  pulse: { every: 9, first: 4, ahead: 6, r: 9.5, dmg: 45, bossDmg: 150, slow: 0.55, slowDur: 4, freeze: 1.2 },
  // 局外培养：每级成长速度 +10%，最多 10 级；第 n 级（0 起）的价格
  growthPer: 0.1, growthMax: 10,
  // 培养点结算规则（world.result().companion.points）
  points: { deployAfter: 20, deploy: 1, evolve: 1, treatMax: 3, win: 2 },
}
for (const f of COMPANION.forms) COMPANION[`${f}Key`] = `companion.form.${f}`

export const growthCost = level => 2 + level
export const formKey = stage => `companion.form.${COMPANION.forms[stage]}`
