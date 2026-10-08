# AI 生成模型来源说明

本目录下的 `*.glb` 怪物模型与我方单位模型（`unit_* / hero_* / device_*`，2026-10-01 生成）均由 **腾讯混元 3D（Tencent Hunyuan3D）「文生3D」V3.1** 生成
（https://3d.hunyuan.tencent.com/ ，模型面数 50k、纹理风格「通用」），
再经 `tools/ai-models/process.py` 做网格简化、贴图压缩、归一化后得到。

- 设计为本项目原创：提示词只描述造型与美术方向（写实科幻恐怖、暗红褐/紫黑几丁质甲壳、橙色发光腺体），
  未引用任何现有游戏或作品的名称。每个模型所用提示词记录在 `manifest.json` 的 `prompt` 字段。
- `raw/` 为网站下载的原始 GLB（约 40MB/个，未改动）；根目录下的同名 GLB 是处理后的游戏用版本。
- 自发光贴图（emissive）不是混元输出的，是处理脚本从基础色里按阈值抠出来的：虫族按「高饱和橙色」，我方按「青色灯条 / 目镜」（焚化兵另加「很亮的橙色」喷口），见 models.json 的 `emissive`。
- 我方模型的美术方向（提示词里统一写的）：写实硬核军事科幻、枪灰色磨损金属 + 钴蓝色涂装 + 少量青色发光条，人形 / 机甲要求 A 字站姿、四肢与躯干分开、武器握在手中。
- 使用与再分发请遵守腾讯混元 3D 的用户协议 / 生成内容使用条款（发布前请自行核对当时的条款）。

| 文件 | 逻辑名建议 | 说明 |
| --- | --- | --- |
| boss_ravager.glb | boss.ravager | 镰刀前肢四足巨兽 |
| boss_matriarch.glb | boss.matriarch | 巢母：半透明卵囊产卵母体 |
| boss_leviathan.glb | boss.leviathan | 渊噬蠕虫：破土而出的巨口蠕虫（带地面碎片底座） |
| enemy_hulk.glb | enemy.hulk | 巨畸体：骨拳肉盾 |
| enemy_crusher.glb | enemy.crusher | 甲壳兽：分片重甲甲虫 |
| enemy_warden.glb | enemy.warden | 护巢虫：背负发光晶簇 |
| enemy_spitter.glb | enemy.spitter | 刺脊虫：盘身昂首、颈盾、喷吐 |
| enemy_shieldbug.glb | enemy.shieldbug | 举盾虫：骨质盾板（盾像兜帽罩在头顶上方） |
| enemy_shieldbug_alt.glb | enemy.shieldbug（备选） | 举盾虫备选：正面竖着一整块白色盾牌（盾面带铆钉/把手，偏人造感） |
| enemy_digger.glb | enemy.digger | 掘地虫：铲状前爪 |
| enemy_egg.glb | enemy.egg | 虫卵 |
| enemy_wing.glb | enemy.wing | 翼螫：膜翅飞行虫 |
| unit_rifle.glb | unit.rifle | 突击兵：重型动力装甲、青色目镜、背包、双手平端步枪（1500 面，贴图 512） |
| unit_rifle_b.glb | unit.rifle（备选） | 突击兵备选：同一次生成的另一候选，钴蓝更多、步枪收在胸前（1500 面） |
| unit_flamer.glb | unit.flamer | 焚化兵：双燃料罐，双臂前臂一体式喷火器、A 字张开（1500 面，贴图 512） |
| unit_titan.glb | unit.titan | 泰坦机甲：两肩双联炮 + 两臂双管炮，玻璃驾驶舱（4000 面） |
| unit_mortar.glb | unit.mortar | 雷锤自行炮：履带车体、长炮管上仰（3000 面） |
| unit_lancer.glb | unit.lancer | 破城轨道炮：四足低趴、双导轨电磁炮（3000 面） |
| unit_reaper.glb | unit.reaper | 裁决光束步行机：四条细长高脚、机腹吊透镜炮（3000 面） |
| unit_skyhook.glb | unit.skyhook | 天钩无人机母机：四个涵道风扇（涵道轴线偏水平，像倾转旋翼的前飞姿态）、机腹挂舱（2000 面） |
| unit_psion.glb | unit.psion | 灵能者：长袍装甲、高立领、周身浮晶片（2000 面） |
| hero_hawk.glb | unit.hero_hawk | 「铁砧」霍克上尉：鬃冠头盔、披风、长管重步枪（3000 面） |
| hero_ysera.glb | unit.hero_ysera | 「棱镜」伊瑟拉：白色流线装甲、六片刃翼、能量长矛（3000 面，双面） |
| hero_joe.glb | unit.hero_joe | 「扳手」老猫：工程黄双足步行机、钻头臂 + 三指爪（3000 面） |
| device_sentry.glb | device.sentry | 哨戒机枪塔：三脚架、双管机枪（1500 面） |

我方模型和怪物一样在本地坐标里**正面朝 +z**；场上朝 -z（虫群方向）由 squadview 按 `unit.facing`（默认 π）转出来，接入时不需要再转。
