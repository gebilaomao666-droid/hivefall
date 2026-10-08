// 英雄级触发时给现役单位起的名字，和小队绰号。80 个士兵名 + 40 个绰号（每兵种一组）。
// 模拟层只产出 key（name.p.<n> / squadname.<kind>.<n>）；strings.*.js 用 nameStrings(lang) 把它们并进文案表。
export const NAMES = {
  zh: [
    '老周', '阿勒', '柯七', '石榴', '北川', '铁生', '小满', '林哨', '白鹭', '老秦', '陆九', '冬青',
    '赵砚', '阿岩', '苏禾', '许渡', '雷子', '顾南', '半夏', '沈舟', '孟河', '老汤', '阿拓', '季风',
    '程野', '岳十三', '乔木', '唐止', '夏至', '罗盘', '江停', '阿衡', '闻笛', '高粱', '谷雨', '纪元',
    '宋迟', '灰雁', '严冬', '卫青禾', '聂远', '老莫', '鱼肠', '杜仲', '方舟', '贺兰', '小寒', '钟离',
    '老谢', '阿满', '祁连', '白术', '穆青', '简七', '柏舟', '南星', '阿砺', '陶然', '池鱼', '老窦',
    '温良', '秦川', '麦冬', '余粮', '阿准', '段落', '常在', '万一', '毕竟', '何必', '阿灯', '向晚',
    '姜末', '左转', '老规矩', '顺路', '镇纸', '门挡', '薛定', '备份',
  ],
  en: [
    'Zhou', 'Arlo', 'Kess', 'Pom', 'Kita', 'Ferro', 'Mae', 'Lindqvist', 'Egret', 'Quinn', 'Nines', 'Holly',
    'Zane', 'Brick', 'Sato', 'Wade', 'Rai', 'Gunnar', 'Sorrel', 'Shen', 'Marlow', 'Tang', 'Otto', 'Monsoon',
    'Wilder', 'Thirteen', 'Ash', 'Tully', 'Solstice', 'Compass', 'Jiang', 'Ames', 'Fife', 'Rye', 'Mizzle', 'Epoch',
    'Song', 'Greylag', 'Frost', 'Wei', 'Nye', 'Moe', 'Dirk', 'Doyle', 'Ark', 'Helan', 'Rime', 'Bell',
    'Hask', 'Pell', 'Vance', 'Juno', 'Okoye', 'Brandt', 'Sable', 'Tamsin', 'Halloran', 'Pike', 'Ibarra', 'Cobb',
    'Lark', 'Dunmore', 'Ren', 'Surplus', 'Vasquez', 'Footnote', 'Hollis', 'Mayday', 'Anyway', 'Kowalski', 'Wick', 'Dusk',
    'Moss', 'Detour', 'Deadpan', 'Yara', 'Paperweight', 'Doorstop', 'Schrody', 'Backup',
  ],
}

export const SQUAD_NAMES = {
  rifle: {
    zh: ['迟到的早饭', '晴天备用队', '第七排的第八个人', '弹壳回收队', '不签收小队', '最后一页'],
    en: ['Late Breakfast', 'Fair-Weather Reserve', 'Eighth Man of Seventh Platoon', 'Brass Recovery', 'Return To Sender', 'Last Page'],
  },
  flamer: {
    zh: ['余烬科', '防火演习', '禁烟区', '暖场组', '灰名单', '点火许可'],
    en: ['Dept. of Embers', 'Fire Drill', 'No Smoking Section', 'Warm-Up Act', 'Ash List', 'Burn Permit'],
  },
  mortar: {
    zh: ['远程问候', '坐标已读', '抛物线爱好者', '地形修改处', '午睡终结者'],
    en: ['Long-Distance Regards', 'Coordinates Seen', 'Parabola Club', 'Office of Terrain Revision', 'Nap Enders'],
  },
  titan: {
    zh: ['超重行李', '桥梁限重', '双份意见', '不可回避', '大件运输'],
    en: ['Excess Baggage', 'Bridge Weight Limit', 'Second Opinion', 'Unavoidable', 'Oversize Load'],
  },
  lancer: {
    zh: ['精确投诉', '单点故障', '只说一次', '预约拆迁', '最后通牒'],
    en: ['Precision Complaint', 'Single Point of Failure', 'Said Once', 'Scheduled Demolition', 'Final Notice'],
  },
  reaper: {
    zh: ['横向思维', '一笔勾销', '擦黑板的', '红线审计', '统一口径'],
    en: ['Lateral Thinking', 'Struck Through', 'Board Erasers', 'Red Line Audit', 'Clean Sweep Committee'],
  },
  psion: {
    zh: ['预报不准', '局部有雨', '头疼来源', '请保持安静'],
    en: ['Forecast Was Wrong', 'Scattered Showers', 'Source of the Headache', 'Quiet Please'],
  },
  skyhook: {
    zh: ['失物招领', '高空抛物', '不落地航班', '苍蝇拍'],
    en: ['Lost and Found', 'Falling Objects', 'No Landing Slot', 'Fly Swatter'],
  },
}

export const NAME_POOL_SIZE = NAMES.zh.length
export const SQUAD_NAME_COUNT = Object.fromEntries(Object.entries(SQUAD_NAMES).map(([k, v]) => [k, v.zh.length]))

export const nameKey = n => `name.p.${n}`
export const squadNameKey = (kind, n) => `squadname.${kind}.${n}`

// lang: 'zh' | 'en' → { key: 文案 }
export function nameStrings(lang) {
  const out = {}
  NAMES[lang].forEach((n, i) => { out[nameKey(i)] = n })
  for (const kind in SQUAD_NAMES) SQUAD_NAMES[kind][lang].forEach((n, i) => { out[squadNameKey(kind, i)] = n })
  return out
}
