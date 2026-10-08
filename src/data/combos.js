// 联动（凑齐模块永久生效）与英雄级（兵种专精的质变）。见 docs/GDD.md §5。
// effects 与模块同一套聚合规则，武器代码只看 mods。

export const COMBOS = {
  combo_rifle_chain: {
    id: 'combo_rifle_chain', units: ['rifle'], needs: { rifle_pierce: 2, rifle_double: 1 },
    effects: [{ unit: 'rifle', key: 'doubleDmgMul', add: 0.3 }, { unit: 'rifle', key: 'doublePierce', add: 2 }],
  },
  combo_rifle_frag: {
    id: 'combo_rifle_frag', units: ['rifle'], needs: { rifle_pierce: 1, rifle_double: 1, rifle_frag: 1 },
    effects: [{ unit: 'rifle', key: 'fragOnPierce', add: 1 }, { unit: 'rifle', key: 'fragRMul', add: 0.25 }],
  },
  combo_flamer_scorch: {
    id: 'combo_flamer_scorch', units: ['flamer'], needs: { flamer_nozzle: 2, flamer_napalm: 1 },
    effects: [{ unit: 'flamer', key: 'napalmDurMul', add: 0.5 }],
  },
  combo_mortar_cluster: {
    id: 'combo_mortar_cluster', units: ['mortar'], needs: { mortar_blast: 2, mortar_cluster: 1 },
    effects: [{ unit: 'mortar', key: 'clusterDmgMul', add: 0.3 }],
  },
  combo_titan_battery: {
    id: 'combo_titan_battery', units: ['titan'], needs: { titan_servo: 2, titan_salvo: 1 },
    effects: [{ unit: 'titan', key: 'salvoAdd', add: 2 }],
  },
  combo_lancer_resonance: {
    id: 'combo_lancer_resonance', units: ['lancer'], needs: { lancer_amp: 2, lancer_echo: 1 },
    effects: [{ unit: 'lancer', key: 'echoAdd', add: 1 }],
  },
  combo_reaper_weave: {
    id: 'combo_reaper_weave', units: ['reaper'], needs: { reaper_lens: 2, reaper_return: 1 },
    effects: [{ unit: 'reaper', key: 'backDmg', add: 0.25 }],
  },
  combo_psion_front: {
    id: 'combo_psion_front', units: ['psion'], needs: { psion_focus: 2, psion_twin: 1 },
    effects: [{ unit: 'psion', key: 'stormDmgMul', add: 0.2 }],
  },
  combo_skyhook_flock: {
    id: 'combo_skyhook_flock', units: ['skyhook'], needs: { skyhook_wing: 2, skyhook_flak: 1 },
    effects: [{ unit: 'skyhook', key: 'flakRMul', add: 0.3 }, { unit: 'skyhook', key: 'flakDmgMul', add: 0.3 }],
  },
  // ---- 跨兵种 ----
  // 炮弹落点起火
  combo_fire_shell: {
    id: 'combo_fire_shell', units: ['flamer', 'mortar'], needs: { flamer_napalm: 1, mortar_blast: 1 },
    effects: [{ unit: 'mortar', key: 'ignite', add: 1 }],
  },
  // 炮弹（自行炮 / 泰坦）落进风暴时，风暴立刻多放一次电
  combo_storm_grid: {
    id: 'combo_storm_grid', units: ['psion', 'mortar'], needs: { psion_focus: 1, mortar_loader: 1 },
    effects: [{ unit: 'psion', key: 'discharge', add: 1 }],
  },
  // 无人机打过的虫被标定：护甲失效、受伤 +25%；无人机改为优先找重甲
  combo_mark: {
    id: 'combo_mark', units: ['skyhook', 'lancer'], needs: { skyhook_servo: 1, lancer_amp: 1 },
    effects: [{ unit: 'skyhook', key: 'mark', add: 1 }],
  },
  // 光束灼痕更烫更久，焚化兵的火区更大
  combo_melt: {
    id: 'combo_melt', units: ['reaper', 'flamer'], needs: { reaper_scorch: 1, flamer_heat: 1 },
    effects: [{ unit: 'reaper', key: 'scorchDmgMul', add: 0.6 }, { unit: 'reaper', key: 'scorchDurAdd', add: 1 }, { unit: 'flamer', key: 'napalmR', add: 0.4 }],
  },
}
for (const c of Object.values(COMBOS)) { c.nameKey = `combo.${c.id}.name`; c.descKey = `combo.${c.id}.desc` }

// 触发条件统一：该兵种每个模块 ≥1 级，且至少一个多级模块升满。
export const HEROICS = {
  heroic_rifle: { id: 'heroic_rifle', unit: 'rifle', every: 5, shots: 10, dmgMul: 2, pierce: 3, surge: 2, surgeMul: 1.5 },
  heroic_flamer: { id: 'heroic_flamer', unit: 'flamer', perStep: 3, zoneCap: 40, dur: 1.8, r: 1.6, dmg: 1.5 },
  heroic_mortar: { id: 'heroic_mortar', unit: 'mortar', delay: 0.4, dmgMul: 0.3 },
  heroic_titan: { id: 'heroic_titan', unit: 'titan', every: 4, shells: 6, radius: 3.6, dmg: 14, knockback: 2.2 },
  // 弹幕落点留一片减速 40% 的伤害区（每轮弹幕最多 zones 片）
  heroic_lancer: { id: 'heroic_lancer', unit: 'lancer', zones: 4, r: 2.4, dur: 3, slow: 0.4, dmg: 4, tick: 0.5 },
  // 每次横扫再补一道纵向光束，和横扫的带十字交叉
  heroic_reaper: { id: 'heroic_reaper', unit: 'reaper', len: 14, half: 1.2, dmgMul: 1 },
  // 风暴每跳向圈外劈一道闪电，连 chain 只；风暴内的虫减速 45%
  heroic_psion: { id: 'heroic_psion', unit: 'psion', chain: 6, reach: 5, dmg: 7, slow: 0.45 },
  // 每 every 秒，每个无人机群沿最密的纵线扫射一趟，空中地面都打
  heroic_skyhook: { id: 'heroic_skyhook', unit: 'skyhook', every: 6, dmg: 10, half: 1.3, maxTargets: 60, zFar: -18 },
}
for (const h of Object.values(HEROICS)) { h.nameKey = `heroic.${h.id}.name`; h.descKey = `heroic.${h.id}.desc` }

export const HEROIC_BY_UNIT = Object.fromEntries(Object.values(HEROICS).map(h => [h.unit, h]))
