// 武器行为按 unit.weapon.type 分发。签名统一：(world, unit, def, weapon, mods, extra) => 是否开火。
import { fireHitscan } from './hitscan.js'
import { fireCone } from './cone.js'
import { fireShell, fireDualShell } from './shell.js'
import { fireLock } from './lock.js'
import { fireBeam } from './beam.js'
import { fireStorm } from './storm.js'
import { fireDrones } from './drones.js'
import { fireMelee } from './melee.js'
import { fireDrill } from './drill.js'

export const WEAPONS = {
  hitscan: fireHitscan,
  cone: fireCone,
  shell: fireShell,
  dual_shell: fireDualShell,
  lock: fireLock,
  beam_sweep: fireBeam,
  storm: fireStorm,
  drones: fireDrones,
  melee: fireMelee,
  drill: fireDrill,
}
