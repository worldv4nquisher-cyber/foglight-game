# QA v0.1 第 4 批（master f51491a）

> 状态：**已完成**（2026-10-29 13:15 UTC+7）
> 测试时间：2026-10-29 12:03 起（UTC+7）
> 截图目录：`docs/bugs/qa-v0.1-batch4/`；原始日志：`/tmp/t010*.log`、`/tmp/t007*.log`、`/tmp/treg.log`、`/tmp/b4-smoke.log`、`/tmp/b4-cli.log`；脚本 `/workspace/qa-tools/t-010*.mjs`、`t-007*.mjs`、`t-reg.mjs`

## 方法与环境

- 快照：`git archive f51491a` → `/workspace/qa-tools/snap-f51491a/game`，`npm ci` + `npm run build`（vite 8.3.5，exit 0），`vite preview` 起服务。未改 game/ 源码，未提交。
- 浏览器：无头 Chrome + SwiftShader 软件渲染。一帧常在 0.3–2 s，**不做任何 fps / 帧时间判断**。凡是「≤ x 秒」的验收，计时器类用游戏时间（`hints.time`、`time.elapsed`）判断；墙钟类（黑场 ≤ 1.0 s、主菜单 ≤ 3 s）记为未能判定，要在真机上测。
- 机器负载：12:04 约 3，12:40 以后约 18–23（有其他 agent 在跑），所以后段的墙钟数值偏大。
- 注意：快照里的 `docs` 是指向实时 docs 的软链。`docs/gdd/text-ch1.json` 在 12:09 被策划更新过（`ui.hud.controls`「锁定鼠标转视角」→「锁定视角」），master 已在 05bfc57（12:37）导入。所以用快照跑的程序 smoke 里「操作提示不是文本表」那一项是**新文本 vs 旧快照**，不是 f51491a 的缺陷（见 §3）。

## 0. 命令行检查（快照）

| 命令 | 结果 |
|---|---|
| `npm run build` | ✓ exit 0 |
| `npm run size` | ✓ boot 0 / menu 2.56 MB（11 个文件）/ common 0（主角占位）/ s1 0.13 MB / s2 0 / s3 0；menu+boot 2.56 / 15 MB；common+s1 0.13 / 150 MB；首个 S1 合计 2.69 MB；按美术接入估算首场景 ≈ 85.17 MB |
| `npm run css` | ✓ 保留 4 处无前缀属性，没有手写前缀 |
| `npm run test:text` | ✓ 173 条一致，代码引用 101 个 ID、缺 0，硬编码玩家可见中文 0（12:0x 跑的，当时 docs 还是旧版） |
| `npm run test:fonts` | ✓ sans 217 KB / serif 305 KB（≤ 2 MB），子集 691 字全部覆盖 |
| `npm run test:flow` | ✓ 9 项 |
| `npm run test:hint` | ✓ 12 项 |

dist 各文件（字节）：index.html 1,194；index js 212,974；css 15,403；vendor 368,980；three 713,991；basis wasm 527,333 / js 57,529；draco wasm 192,420 / wrapper 58,456；foglight-sans.woff2 222,480；foglight-serif.woff2 312,564；OFL.txt 4,521；test-lod-puzzle-critical.glb 132,264；合计 2,820,109 B。

## 1. v0.1-010 场景流程与分包加载

| 验收项 | 结论 | 证据 |
|---|---|---|
| 启动只加载 boot+menu | PASS | `loadedGroups=boot,menu`。冷启动（无缓存）：index.html 956 B + 8 个资源，压缩前合计 945.7 kB：index js 65.8 kB、vendor 168.7 kB、three 184.8 kB、css 3.8 kB、sans 217.3 kB、serif 305.2 kB。没有请求 glb / wasm / ktx2。DCL 2829 ms，menuReadyMs 3506 ms（软件渲染，热缓存时 1858 ms）。两套 Foglight 字体都已加载 |
| 新游戏加载 common+s1，显示加载页 | PASS | 加载页出现；groups → boot,menu,common,s1；新请求 2 个、130.4 kB：hero.glb 0.9 kB（可选文件缺失 → 占位）、test-lod-puzzle-critical.glb 129.5 kB；存档 sceneId=s1；地名「落潮滩」。截图 010-s1-enter.png |
| S1 建立镜头后预加载 s2 | PASS | `isGroupLoaded(s2)=true`；s2 组在 manifest 里没有文件，0 个请求 |
| S1→S2 淡出 / 黑场 / 淡入、存档、释放上一场景 | 功能 PASS，**≤ 1.0 s 未能判定** | 存档 sceneId=s2；groups → boot,menu,common,s2,s3（释放 s1，预加载 s3）；renderer.info.memory 几何 70→16，贴图 33→33（S1 白盒很可能没有分组贴图，贴图释放只有部分证据）；入口 0,0,10；地名「守灯人小屋」。lastTransition：ms 7304，phases 淡出 916 / 加载 0 / 切换 4104 / 淡入 2284，maxFrame 2284 ms，受帧时间限制。截图 010-s2-enter.png |
| S2→S3 同上 | 功能 PASS，≤ 1.0 s 未能判定 | 存档 s3；groups → boot,menu,common,s3；几何 16→20，贴图 33→35；入口 0,0,9；地名「初望灯塔」；ms 13582（切换 9303）。截图 010-s3-enter.png |
| 刷新后「继续」回到当前场景入口 | PASS | 刷新前移到 (3,0,3)；主菜单 [继续, 新游戏, 设置, 制作名单]；继续后进 s3-lighthouse，位于 0,0,9（from-s2 入口） |
| `?slowLoad` 加载页进度条 | PASS | slowLoad=1500：可见 3.1 s，6%→90%；slowLoad=12000：1%→…。截图 010-slowload-loading.png |
| 慢加载黑场细线进度 | PASS（slowLoad=12000） | waitedForLoad=true，progressShown=true，细线只在全黑（opacity 1）时出现，67%→100%；细线显示期间新场景一帧都没露出来；加载 9632 ms。slowLoad=1500 下看不到细线：软件渲染淡出就花了 2.6 s，加载已经结束（环境限制，不算缺陷）。截图 010-slowload-black-progress.png |
| S3 点灯 → 结束页 | PASS（但见 BUG-006） | 提示「E 操作」，按 E 后出结束页（墙钟 2.7 s，代码延时 1.5 s）：第一章 · 归岸 / 点亮的灯塔 / 本章用时 0:05 / 使用提示 0 次 / 未完待续 / 回到主菜单；chapterComplete=true；groups → boot,menu,common（释放 s3）。截图 010-s3-lamp-prompt.png、010-s3-lamp-lit.png、010-chapter-end.png |
| 字体子集 WOFF2 | PASS | 217 / 305 KB |
| 包体：首场景 ≤ 150 MB、主菜单 ≤ 15 MB | PASS（当前白盒） | menu+boot 2.56 MB；common+s1 0.13 MB |
| 控制台错误 | 无 | t-010 / t-010b / t-010c 都是 0 |

**INFO（未定为缺陷）**：冷启动（全新 Chrome 配置）时，两套字体的第一次 fetch 都被取消（net::ERR_ABORTED，canceled=true，请求没到服务器），代码里的单次重试 60–120 ms 后成功。用简单测试页复现不出来，热刷新也没有。可能是无头环境的怪癖。建议在真机 Chrome DevTools 里第一次访问时看一眼 Network；如果重试也失败，字体会加载不上。

## 2. v0.1-007 三级提示（`?smoke=1&debug=1&scene=testbed&hintScale=0.05`，阈值 = 游戏时间 9 / 18 / 30 s）

| 验收项 | 结论 | 证据 |
|---|---|---|
| 不在任何区域时，H 显示三行「再等等，四处看看」 | PASS | 三行都是 locked；currentId=null，没有图标。截图 007-locked-outside.png |
| 钟区域约 9 s 出风灯，H 显示一级 | PASS | 7.5 s 时还没有图标；图标出现时区域计时 9.13 s（含轮询误差），class `hint-lantern visible fresh`；H：一「钟上刻着两道线，一高一低。」，二、三 locked。截图 007-icon-l1.png、007-panel-l1.png |
| 弹窗不暂停（裁定，确认行为） | 符合裁定 | 弹窗开着 2.5 s，计时 9.72→10.42，context=explore |
| 18 s 二级 + 钟描边 3 s | PASS | 到 18 s 时 level=2，二「那口钟，爸爸修过很多次。」；打开瞬间高亮 `hint:sample-bell`。描边时长用 time.elapsed 计约 3.12 s（S1 真流程那次测的，含轮询误差）。测试场那次我用 fixedTick/60 计出 1.12 s，是测量方法错了：固定步长每帧最多 5 步，软件渲染下会少算；描边实际按帧时间计（Highlighter.update(dt)），所以不算缺陷。截图 007-panel-l2-highlight.png |
| 二级再次打开重新高亮（裁定） | 符合裁定 | 再开 H 又出现 `hint:sample-bell` |
| 离开区域计时暂停、回来接着计 | PASS | 离开前 19.5 s；离开后 3 s（游戏时间也在走）仍是 19.5 s；回来 2 s 后 20.0 s。F4：「test-bell 19.5s / 9·18·30 · L2 看过 L2（区域外，暂停）」。截图 007-outside-paused.png |
| 30 s 三级全显 | PASS | 三「敲响它，看看海水会怎样。」。截图 007-panel-l3.png |
| F4 面板「提示」行 | PASS | 「提示  test-bell 30.9s / 9·18·30 · L3 看过 L3」。截图 007-f4-panel.png |
| 敲钟（解开）后图标消失、H 不再显示该谜题 | PASS | 解开后图标=false；H 当前谜题=null，三行 locked。截图 007-solved.png |
| 分步骤：先油阀，再窗边镜子 | PASS | 拧阀前二级「灯要先有油。阀门在最下面。」，高亮 `hint:sample-valve`；按住 E 拧开后二级换成「窗边那面镜子，能接住外面的光。」，高亮 `hint:sample-stand-b`；30 s 三级「转动底层窗边的镜子，把窗外的光往上送进楼梯井。」。截图 007-steps-valve.png、007-steps-window-mirror.png |
| hintsUsed 立即写存档 | PASS（真流程） | 测试场是 `?scene=testbed` 直接进的，没有新游戏 / 继续，SaveSystem.progress=null，所以 localStorage 里本来就没有 hintsUsed（调试场景，符合代码设计）。改在真流程测：新游戏进 S1，用 smoke 句柄在出生点临时登记一个测试谜题（S1 正式谜题 013–015 才放）。开始 0 → 9 s 开 H 立即为 1 → 18 s 开 H 为 2 → 再开 H 仍为 2。截图 007-s1-panel-l1.png |
| 换步骤不重复计数 | 只有单测证据 | 测试场没有存档，没法在运行时看；`npm run test:hint` 覆盖了这一项（✓）。真流程里还没有分步骤谜题 |
| 计时不存档，刷新后从 0 重计（裁定） | 运行时未测（脚本问题），代码确认 | 脚本最后一步刷新之前要先读存档里的 hintsUsed，测试场没有存档，读的时候报错，所以刷新那一步没跑。代码：HintSystem 的计时只在内存里，SaveData 里没有计时字段（只有 hintsUsed），和裁定一致 |
| 控制台错误 | 无 | |

**INFO**：离开区域后，右下角风灯图标还在，H 仍显示刚才那道谜题（currentId 保留，计时暂停）。任务单没有规定这种情况；如果希望离开就隐藏，请制作人裁定。

另外，程序 smoke（快照）007 项 ✓：?hintScale=0.02 下一二三级、分步骤、解开后风灯消失、hintsUsed +3。

## 3. 回归：BUG-003 / BUG-004 / BUG-005 / verify:glb

### BUG-005（玩家可见中文进文本表）
| 项 | 结论 | 证据 |
|---|---|---|
| 地名标题 落潮滩 / 守灯人小屋 / 初望灯塔 | PASS | t-010 进场读 `.hud-location`，三处都对 |
| S1 左下操作提示来自 `ui.hud.controls` | PASS | 页面「WASD 移动 Shift 小跑 点击画面 锁定鼠标转视角 E 互动 右键 观察 滚轮 远近 Esc 暂停」，10 个 kbd，去掉空白后和快照 zh-CN.ts 一致 |
| 「E 跨过去」 | PASS（代码 + 文本表，运行时看不到） | `TraversalLink` 默认 `text('ui.prompt.traverse')` =「E 跨过去」。目前只有测试场用了跨越点，而且传的是自定义的「E　跨过沟」（TestbedScene 在 DEV_ONLY 白名单里，正式版要 debug 才能进）。S1–S3 没有跨越点，所以正式流程里暂时看不到这条提示 |
| 8 个新 ID 在 text-ch1 里 | PASS | ch1.s1/s2/s3.location.title、ui.prompt.traverse、ui.hud.controls、ui.touch.interact、ui.fatal.title、ui.fatal.webgl2 都在（173 条） |
| 硬编码检查（我自己 grep） | PASS | 排除 `src/content/text/**` 后，剩下带汉字的字面量都属于：控制台日志（AssetLoader）、F3 / F4 调试读数（行首或上一行注了 text-ok，或者在 debug* 函数里）、DEV_ONLY 文件（TestbedScene、DebugPanel、atmosphere、vertexColors）、index.html 的 `<title>雾灯` 和 `<noscript>`。没发现正式流程里玩家能看到、却写死在代码里的中文 |
| 程序 smoke 的 010 项「S1 地名 / 操作提示不是文本表里的」✗ | **不算缺陷（环境原因）** | smoke 读的是 `../docs/gdd/text-ch1.json`，快照里这是指向实时 docs 的软链。策划 12:09 把文案改成了「点击画面 锁定视角」，快照代码（f51491a）里还是旧文案「锁定鼠标转视角」。master 05bfc57（12:37）已经导入新文本。用 05bfc57 以后的版本重跑 smoke 应该就能通过，本批没有在 05bfc57 上复测 |

### verify:glb（美术反馈的 @/content 别名报错）
| 调用方式 | 结果 |
|---|---|
| 在快照 game/ 下 `npm run verify:glb -- public/assets/models/test-lod-puzzle-critical.glb` | 正常运行，没有别名报错。退出码 1 是因为这个测试资产本身故意不合规（缺 -collider / -interact、COLOR_0 等，错误 5、警告 4），和别名无关 |
| 在 art/ 下 `npm --prefix /workspace/qa-tools/snap-f51491a/game run verify:glb -- models/props/prop-boat-rowboat.glb` | ✓ 通过（错误 0、警告 0），路径按调用目录（art/）解析，没有 `@/content` 报错 |

结论：PASS。说明：我用的是快照的绝对路径 `--prefix`。美术实际用的 `npm --prefix ../game` 在 art/ 下会指向实时 game/，不是快照，所以没用那种写法。

### BUG-003（背景模糊）— 已修复
`npm run css` ✓。构建出的 CSS 里同时有无前缀和 `-webkit-` 两种写法。运行时计算样式：`.pause-menu` 为 blur(6px)（打开设置时外层也是），`.reader` / `.journal` 为 blur(6px) brightness(0.6)。截图 reg-bug003-pause-blur / settings-blur / reader-blur / journal-blur.png，背景能看出是模糊的。已在 BUG-003.md 写回归结论。

### BUG-004（「日志已更新」被遮挡）— 已修复
- 阅读时挂起（hidden + pending）。关掉后显示 2.00 s（游戏时间；软件渲染下墙钟约 8.2 s）。
- 位置：提示框 top 653 / bottom 672，操作提示 top 684，不重叠。
- 再读不再弹。
- 日志开着时挂起；提示显示途中开暂停会冻结剩余时间，关掉暂停后接着显示。
- 黑场、主菜单、结束页只做了代码确认。
- 截图 reg-bug004-toast-after-reader.png。已在 BUG-004.md 写回归结论。

### BUG-005 — 已修复（见上表），已在 BUG-005.md 写回归结论。

## 4. 前几批关键流程快速复跑

| 项 | 结论 | 证据 |
|---|---|---|
| 主菜单（无存档时没有「继续」） | PASS | reg-menu.png |
| 设置用界面改（灵敏度 1.7、音量 40、Y 反转、字幕大），刷新后保留 | PASS | 刷新后设置值和输入层的灵敏度都是 1.7。reg-settings-changed.png |
| 恢复默认（裁定：没检测过 → 极致，灵敏度 1.0） | PASS | 恢复前 detected=null → 恢复后 ultra、灵敏度 1、不反转、音量 100、字幕中、来源 default。reg-settings-reset.png。「已检测 → 检测档」由程序 smoke 009 覆盖（✓） |
| 暂停 → 回到主菜单（确认框）→ 出现「继续」 | PASS | |
| 交互：inspect（带字幕）/ use / hold / pickup / place | PASS | 测试场里用真实按 E 触发。read 和日志见 BUG-004 一节。reg-interactions.png |
| 程序 `npm run smoke`（快照，/tmp/b4-smoke.log） | 共 19 项，17 ✓，2 ✗；两个 ✗ 都不是 f51491a 的缺陷 | ① 010「操作提示不是文本表」：快照代码对上了更新后的实时 docs 文本，见 §3。② 004「E 没切换灯塔」：smoke 按 E 后只等 2 s，而当时机器负载约 20。我单独复核：S1 demo 灯塔「E 操作」→ 按 E 后 1651 ms 完成切换，PASS。其余 ✓ 包括 001 输入 / 指针锁定、002 角色控制器、003 相机与建立镜头、005 字幕 / 阅读 / 日志、006 存档 / 设置、007、008 菜单 / 设置 / 暂停 / 结束页、009 画质 |
| 控制台错误 | 无 | t-007 / t-007b / t-reg / t-reg2 都是 0 |

## 5. 本批新缺陷

| 编号 | 标题 | 严重度 |
|---|---|---|
| BUG-006 | S3 灯塔在玩家点灯之前就已经亮着（带光束），「点灯」没有可见变化 | 一般 |

INFO（没有立缺陷单，需要的话请制作人裁定）：
- 冷启动时字体第一次 fetch 被取消，靠重试成功（§1）；
- 离开提示区域后风灯图标和 H 内容还在（§2）；
- smoke 004 的 2 s 等待在机器高负载时不稳定，建议程序放宽。

## 6. 未能测试 / 未能判定

| 项 | 原因 |
|---|---|
| S1→S2、S2→S3 黑场 ≤ 1.0 s | 软件渲染一帧最多约 2.3 s，切换总时长 7.3 s / 13.6 s 完全是帧时间决定的。各段逻辑和预算（淡出 0.33 + 至少全黑 0.3 + 淡入 0.33 s）只能在真机上确认 |
| 主菜单在 50 Mbps 下 ≤ 3 s 可操作 | 没有限速真机环境。本机冷启动 menuReadyMs 3506 ms（软件渲染 + 本地服务），只能参考 |
| `?slowLoad=1500` 黑场细线 | 软件渲染下淡出就要 2.6 s，加载早结束了，看不到细线；改用 12000 验证通过 |
| 上一场景贴图释放 | 几何数有明显下降（70→16）；贴图 33→33，S1 白盒可能没有分组贴图，只有部分证据 |
| 提示：换步骤不重复计 hintsUsed 的运行时验证 | 测试场没有存档，正式场景还没有分步骤谜题；只有 test:hint 单测证据 |
| 提示：刷新后计时从 0 开始（裁定行为） | 脚本问题，刷新那一步没跑；只做了代码确认（存档里没有计时字段） |
| BUG-004 黑场 / 主菜单 / 结束页挂起 | 运行时没测，只做了代码确认 |
| 「E 跨过去」实际显示 | 正式场景里没有跨越点 |
| 05bfc57 上的 smoke / 文本复测 | 不在本批快照范围内 |
| fps / 帧时间、Firefox / Safari、真机 GPU | 环境限制，按要求不判断 fps |
| 字体首次 fetch 被取消的根因 | 无头环境复现不稳定，需要真机 DevTools |

## 7. 结论

- **v0.1-010**：功能验收全部通过（分包加载、预加载 / 释放、存档、继续、加载页、慢加载细线、结束页、字体、包体）。黑场 ≤ 1.0 s、主菜单 ≤ 3 s 需要真机判定。新缺陷 BUG-006（一般）。
- **v0.1-007**：通过（图标 / 三级 / 高亮 3 s / 离开暂停 / 解开后消失 / 分步骤 / F4 / locked 文案 / hintsUsed 立即落盘 / hintScale）。制作人裁定的几项行为均已确认。
- **BUG-003 / BUG-004 / BUG-005**：已修复，可以关闭。verify:glb 别名问题已修复。
- **M4 核心系统**（相机、WASD 移动、交互、字幕、存档）：综合第 1–4 批证据和本批复跑（相机 / 移动 / 输入由程序 smoke 001–003 ✓ 和前几批覆盖；交互由本批 t-reg2 和 smoke 004 ✓ 覆盖，灯塔那项已复核；字幕 / 阅读由 smoke 005 ✓、本批 inspect 字幕和 BUG-004 覆盖；存档由 010 场景进入存档 / 继续、smoke 006 / 008 ✓ 覆盖），**按我的证据都可以验收**。前提：fps / 手感、真机耗时、其他浏览器还没测。
