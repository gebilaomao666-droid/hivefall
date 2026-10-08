# HIVEFALL 蜂巢陨落

原创 IP 的网页 3D 守桥游戏：一座桥、一条防线，从一名突击兵起步——走位选增援门、升级三选一、在桥面上布防、放指挥官技能，顶住虫潮并击倒 Boss；通关后可以原地继续打无尽模式。

纯静态站点：ES module + three.js r160（已放在 `vendor/`），**不需要构建，不需要 `npm install`**。

## 怎么启动

需要本机装有 [Node.js](https://nodejs.org/)（16 或更新）和一个较新的 Chrome / Edge。

- **Windows**：双击 `start.bat`。它会在本机 5173 端口起一个静态服务并自动打开浏览器；玩的时候别关那个黑窗口，关掉它就是停服务。
- **手动**：

  ```
  node tools/serve.js 5173
  ```

  然后用浏览器打开 <http://127.0.0.1:5173/>。

所有资源都按相对路径加载（渲染层经 `src/render/base.js` 从模块位置推算 `assets/`），可以原样挂到子路径下，例如 GitHub Pages 的 `https://<用户>.github.io/<仓库>/`。

不能直接双击 `index.html`（`file://` 下浏览器不让加载 ES module），页面上会提示改用上面的办法。

## 怎么玩

| 操作 | 键鼠 | 触屏 |
|---|---|---|
| 平移队伍 | `A` / `D` 或 `←` / `→`；也可以按住鼠标左键左右拖（拖多少走多少） | 按住屏幕左右拖 |
| 选增援门 | 门到面前时站在哪一边就拿哪一边 | 同左 |
| 布防 | 数字键 `1`~`8` 选装置卡（或点卡），再点桥面上的格子放下；右键 / `Esc` / 再点一次卡 = 取消 | 点卡，再点格子 |
| 铲除装置 | `X` 选「铲除」，再点那个装置所在的格子（返还 25%） | 点「铲除」，再点格子 |
| 指挥官技能 | `Q` `W` `E` `R`。需要瞄准的技能：按键后在桥面上拖一条线松开，或点一下（从队伍指向那一点）；再按一次同一个键 / 等 2 秒 = 按自动线释放 | 点技能按钮，再拖线 / 点一下 |
| 升级三选一 | `1` `2` `3` 直接选；`←` `→` 切换、`Enter` 确认；`R` 重掷 | 点卡 |
| 暂停 / 部队面板 | `Esc` 或 `P` / `Tab` | 右上角按钮 |
| 首页开始 | `Space` / `Enter` | 点「部署小队」 |
| 结算页 | `Enter` = 继续深入（战役胜利后进无尽）/ 再来一局 | 点按钮 |

其它：

- 窗口失去焦点会自动暂停。
- 第一次通关战役后解锁：无尽模式、三位指挥官、突变因子、老兵难度、随机草稿、每日挑战；打到无尽第 5 层解锁伙伴无人机。
- 设置（右上角）里可以调画质（高 / 中 / 低，帧率不够会自动降一档）、六路音量、语言（中文 / English）、全屏。
- 存档在浏览器的 localStorage（键 `hivefall.save`）：设置、最高分、本机榜、解锁、成就。换浏览器 / 换端口 / 清站点数据就是一份新存档。
- 有手柄的话：左摇杆 / 十字键平移，`A` `B` `X` `Y` = `Q` `W` `E` `R`，`Start` = 暂停（这一项没有实机测过）。

## 目录

```
index.html          游戏入口
codex.html          军械库：单位 / 指挥官 / 虫族 / Boss / 装置的 3D 检视、数值与素材署名（首页右上角「军械库」）
start.bat           Windows 一键启动
src/main.js         启动流程、状态机、主循环、存档读写（唯一碰 localStorage / Date / Math.random 的地方）
src/input.js        键盘 / 鼠标 / 触屏 / 手柄 → 模拟层的 input
src/core|data|sim   模拟层：确定性，不碰 DOM，Node 里能无头跑
src/render          渲染层（three.js）      src/ui   界面层（DOM + CSS）      src/audio   音频层（Web Audio）
assets/             模型 / 贴图 / 图标 / 字体 / 音频（各目录的 CREDITS.md 是素材署名）
dev/                开发页：render.html（渲染）、ui.html（界面）、audio.html（试听台）
tools/              serve.js（静态服务）、sim-run.mjs / sweep.mjs（无头跑局）、test-*.mjs（六套测试）、playtest-pilot.js（实机自测用的试玩脚本）
docs/               GDD.md（设计）、ARCHITECTURE.md（模块契约）、RENDER.md、AUDIO.md
```

## 开发与自测

```
node tools/test-core.mjs        # 另有 test-units / test-powers / test-endless / test-defense / test-audio
node tools/sim-run.mjs --seed 1 --bot good      # 无头跑一局并打印统计
```

`index.html` 的调试参数（正常游玩都不需要）：

| 参数 | 作用 |
|---|---|
| `?fps=1` | 顶部显示帧率 / draw calls / 三角形数 / 画质档 |
| `?seed=123` | 固定每一局的种子 |
| `?lang=zh\|en` `?quality=high\|mid\|low` | 语言 / 画质（会写进存档） |
| `?unlock=1` | 解锁全部内容（会写进存档） |
| `?mute=1` | 这一次启动静音（不写存档） |
| `?nopause=1` | 窗口失焦时不自动暂停（自动化测试用） |
| `?bg=0` | 首页不跑背景战场 |

浏览器控制台里有 `__hf`：`__hf.world` / `__hf.view` / `__hf.ui` / `__hf.audio` / `__hf.save`，`__hf.perf()` 返回最近 300 帧的帧率统计，`__hf.errors` 是启动以来捕获到的报错。

实机自测脚本（只通过真实的键盘 / 指针事件操作游戏，不调内部函数）：进入战斗后在控制台执行

```js
const { createPilot } = await import('/tools/playtest-pilot.js'); const pilot = createPilot(); pilot.start()
```

## 素材与署名

原创作品，不含任何第三方游戏的名称或素材。图标、字体、部分模型与音频来自 CC0 / CC-BY / OFL 授权的素材库，署名见 `assets/**/CREDITS.md`（游戏内「设置」页底部也有一行说明）。
