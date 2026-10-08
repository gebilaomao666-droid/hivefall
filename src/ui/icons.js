// 逻辑名 → assets/ui/icons 里的图标名。头像没到位时，头像框里也用这些图标占位。
export const UNIT_ICON = {
  rifle: 'weapon_assault_rifle', flamer: 'soldier_flamethrower', mortar: 'artillery_shell', titan: 'mech_battle',
  lancer: 'laser_gun', reaper: 'robot_leg', psion: 'lightning_storm', skyhook: 'drone',
  hero_hawk: 'commander', hero_ysera: 'polar_star', hero_joe: 'auto_repair',
}
export const COMMANDER_ICON = { none: 'squad', hawk: 'commander', ysera: 'polar_star', joe: 'auto_repair' }
export const SPEAKER_ICON = { ops: 'radio', hawk: 'commander', ysera: 'polar_star', joe: 'auto_repair', seven: 'drone' }
export const DEVICE_ICON = {
  collector: 'crystal', sentry: 'sentry_gun', barricade: 'barrier', mine: 'land_mine',
  cryo: 'ice_snowflake', scorcher: 'fire_zone', mortarpit: 'mortar', nova: 'nuclear', fence: 'electric', remove: 'cancel',
}
export const ENEMY_ICON = {
  ling: 'claws', burster: 'acid_blob', spitter: 'scorpion_tail', crusher: 'spiked_shell', hulk: 'blob_monster',
  wing: 'wasp_sting', digger: 'worm_mouth', warden: 'hive_mind', egg: 'alien_egg', pod: 'supply_crate',
  shieldbug: 'shield_heavy', leaper: 'bounce',
}
export const BOSS_ICON = { ravager: 'boss_skull', matriarch: 'egg_clutch', leviathan: 'worm_mouth' }
export const POWER_ICON = {
  hawk_rally: 'rally_troops', hawk_strike: 'bombing_run', hawk_drop: 'parachute', hawk_flagship: 'battleship',
  ysera_orbital: 'orbital_strike', ysera_lance: 'laser_burst', ysera_eclipse: 'black_hole',
  joe_drop: 'helmet_robot', joe_mines: 'mine_teller', joe_ray: 'ray_gun',
  companion: 'drone', ally_orbital: 'satellite',
}
export const PASSIVE_ICON = { aegis: 'shield_energy', drill: 'laser_sparks', rebuild: 'cycle', overclock: 'speedometer' }
export const MUTATOR_ICON = { swift: 'sprint', resonance: 'shield_pulse', undying: 'skull_broken', acidrain: 'acid' }
export const MODULE_ICON = {
  rifle_rate: 'fire_rate', rifle_pierce: 'pierce', rifle_double: 'double_shot', rifle_frag: 'grenade', rifle_stim: 'syringe',
  flamer_nozzle: 'fire_flame', flamer_heat: 'burn_skull', flamer_armor: 'armor_vest', flamer_napalm: 'fire_zone',
  mortar_loader: 'ammo_shells', mortar_blast: 'explosion', mortar_ap: 'armor_break', mortar_saturate: 'carpet_bombing', mortar_cluster: 'cluster_bomb',
  titan_servo: 'gears', titan_warhead: 'sonic_boom', titan_salvo: 'missile_swarm',
  lancer_amp: 'battery', lancer_reach: 'pierce_arrow', lancer_echo: 'ricochet', lancer_barrage: 'incoming_rocket',
  reaper_lens: 'eye_target', reaper_overheat: 'speedometer', reaper_scorch: 'fire_small', reaper_return: 'cycle',
  psion_focus: 'vortex', psion_veil: 'shield_energy', psion_twin: 'lightning_tree',
  skyhook_wing: 'interceptor', skyhook_servo: 'fast_forward', skyhook_flak: 'explosion_bright', skyhook_tether: 'magnet',
  gen_calibrate: 'target_lock', gen_durability: 'health_up', gen_repair: 'auto_repair', gen_doctrine: 'xp_progress',
  gen_logistics: 'time_sands', gen_overload: 'damage_up', gen_tuning: 'fire_rate', gen_treat: 'drone',
  dev_sentry_rate: 'turret', dev_sentry_pierce: 'pierce_body', dev_collector_yield: 'gems', dev_barricade_thorns: 'barbed_wire',
  dev_mine_chain: 'dynamite', dev_cryo_freeze: 'ice_cube', dev_engineer: 'upgrade',
  dev_unlock_cryo: 'ice_snowflake', dev_unlock_mortarpit: 'mortar', dev_unlock_scorcher: 'fire_zone', dev_unlock_nova: 'nuclear',
}
export const CONTRACT_ICON = { bloodhound: 'squad_dark', hammer: 'tank', goliath: 'megabot' }
export const ACH_ICON = 'medal'

export const unitIcon = k => UNIT_ICON[k] || 'person'
export const moduleIcon = (id, unit) => MODULE_ICON[id]
  || (id && id.indexOf('heroic') === 0 ? 'laurel' : id && id.indexOf('combo') === 0 ? 'chain_lightning' : unit ? unitIcon(unit) : 'upgrade')
export const enemyIcon = k => ENEMY_ICON[k] || BOSS_ICON[k] || 'alien_bug'

/** 门选项用什么图标 */
export function gateIcon(opt) {
  if (!opt) return 'supply_crate'
  const p = opt.params || {}
  switch (opt.type) {
    case 'unit': return unitIcon(opt.unit)
    case 'heal': return 'medkit'
    case 'contract': return CONTRACT_ICON[p.contract] || 'cash'
    case 'device': return DEVICE_ICON[p.device] || 'unlock'
    case 'module': return moduleIcon(p.moduleId)
    case 'stat': return p.boon ? (p.cost ? 'hazard' : 'upgrade') : 'health_up'
    default: return opt.unit ? unitIcon(opt.unit) : 'supply_crate'
  }
}
