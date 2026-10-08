// models/aliens —— 噬渊虫群的全部正式造型（程序化建模 + 逐帧姿态函数，全部走 gpuanim.bakeRig）。
// 注册在 src/render/assets.js 的 enemy.* / boss.* 条目里。
export { buildLing, buildBurster, buildLeaper, buildWing, buildEgg } from './swarm.js'
export { buildSpitter, buildCrusher, buildHulk, buildDigger, buildWarden, buildShieldbug } from './brutes.js'
export { buildRavager, buildMatriarch, buildLeviathan } from './bosses.js'
export { refineRig } from './kit.js'   // 细分 + 平滑 + 不规则化：中大型虫 / Boss 在 assets.js 注册时套一层
