# QA v0.1 第 5 批（master 4f672e9）

> 状态：**已完成**（2026-10-29 20:50 UTC+7）
> 开始：2026-10-29 19:06（UTC+7）
> 截图：`docs/bugs/qa-v0.1-batch5/`；脚本：`/workspace/qa-tools/t5-*.mjs`；日志：`/tmp/t5-*.log`、`/tmp/b5-cli.log`、`/tmp/b5-s-*.log`

## 方法与环境
- 快照：在 master 上用 `git archive 4f672e9` 导出到 `/workspace/qa-tools/snap-4f672e9/game`，`npm ci` + `npm run build`（含 typecheck），构建成功，exit 0。`art`、`docs` 都是软链，指向实时目录。
- 浏览器：无头 Chrome，SwiftShader 软件渲染，跑 `vite preview` 出的构建产物。**不做 fps 判断**。凡是「x 秒」类验收，都按游戏时间（固定步长 / 系统内部计时）判，不按墙钟。
- 19:06 机器负载约 1。
- 按程序的更正：构建版要加 `&debug=1` 才认 `?scene=` 和 F4，所以本批的 URL 都带 `?smoke=1&debug=1`（光路再加 `&beamDebug=1`）。
- 没改 game/ 源码，没提交。

## 0. 命令行：package.json 里的脚本逐个跑（快照）

结果：19 个脚本全部 exit 0，日志里搜 `@/` 别名报错（`Cannot find package/module '@/…'`、`@/content`），**0 处**。
- 跑过的：typecheck、lint、test:lod、test:assets、test:input、test:save、test:physics、test:camera、test:quality（verify-quality）、test:text、test:interaction、test:narrative、test:hint、test:tide（8/8）、test:beam（12/12）、test:flow、test:fonts、size、css。
- `build` 在建快照时已经跑过（里面带 typecheck），exit 0。
- verify:glb 见 §3。
- `smoke` 在 §4 单独跑。

**没跑的脚本，及原因：**
- dev、dev:host、preview、preview:host：起服务用的，测试时已经通过 preview 间接用到。
- lint:fix、fonts、text:import、assets:test-lod：会改写文件（源码 / 字体 / 文本表 / 测试资产），不属于只读检查。
- check：上面各项的组合。

**分包体积**（`npm run size`）：

| 包 | 体积 | 说明 |
|---|---|---|
| boot | 0 | |
| menu | 2.61 MB | 11 个文件 |
| common | 0 | 主角用占位 |
| s1 | 0.13 MB | |
| s2 | 0 | |
| s3 | 0 | |
| 主菜单包 menu+boot | 2.61 / 15 MB | |
| 首场景包 common+s1 | 0.13 / 150 MB | |
| 首次进入 S1 总下载 | 2.73 MB | |

按 art/ 已交付但还没登记的 75 个文件估算，全部接入后首场景包约 **133.48 MB**（预算 150 MB，余量只剩约 16 MB），首次总下载约 136.09 MB；上一批的估算是 85 MB。这是按文件名猜的分组，以 034 接入后为准，**建议制作人留意**。

dist 主要文件：index js 247,691 B；css 15,476；vendor 368,984；three 714,000；foglight-sans.woff2 227,788；foglight-serif.woff2 319,464。

## 1. v0.1-011 潮汐（`?smoke=1&debug=1&scene=testbed`）

测法：用真实按键（E / Y / W，按住 E 推）。时长都按固定步长计数（fixedTick/60）。测试脚本：qa-tools/t5-011*.mjs。

| 项 | 结果 | 依据 |
|---|---|---|
| 初始状态 + F4「潮汐」行 | PASS | 初始 high、level 1.60；F4 显示「潮汐 test-tide high level 1.60 m · 可走 high · 浮台 floating」 |
| 涨潮时礁石路入口被挡 | PASS | 从岸台 (0,2,23) 朝南走 3 s，停在 z=23.7；入口空气墙 enabled=true（截图 011-high-reef-blocked.png） |
| 敲钟（真实 E）：6 s 内 1.6↔0.0 平滑涨落 | PASS | 提示文字「E 敲钟」。tide:changing → changed 用时 6.00 s；过渡中采样 45 点，水位单调，与 smoothstep 曲线最大偏差 0.0067 m。结束时 low、level 0；入口墙和 3 段深水墙都关闭。事件依次为 changing / sfx:play / tide:bell / changed |
| 过渡中钟提示变灰、按 E 无效 | PASS | 过渡中 45/45 帧提示带 `.is-disabled`（截图 011-bell-prompt-disabled.png）；过渡中按 E，rings 1→1，水位方向不变 |
| 退潮后走礁石路 | **部分 FAIL → BUG-007** | 从 (0,2,23.3) 或 (0,2,22.5) 起步能一路走下坡，到达 z≈31；从 z=23.0 起步，5 次试验每次都卡在 z=23.94（坡顶接缝），x=0 / 0.5 / -0.6 都一样，跳起来才能过去 |
| 站在礁石路上涨潮 → 黑场送回 + 字幕 | PASS | 站在 (0,0.1,32)，按 Y 涨潮；tide:recall 时水位约 0.40 m（阈值 0.1+0.3）。送回到 (0,2,22) = 安全点；字幕「水太冷了。」。截图 011-recall-fade.png 是全黑屏加字幕。脚本自动采样到的黑场最大不透明度只有 0.42：采样窗口 20 s（真实时间）在黑场达到峰值前就结束了，所以黑场以截图为准 |
| 浮物：搁浅时可推；不在锚位时涨潮 → 2 s 漂回 | PASS | 退潮后 grounded，候选 tide-raft，提示「按住 E 推」；推 2.2 s 到 z=26.74；涨潮时 drifting 持续 2.03 s，回到原位 (5,1.76,28.5)，状态 floating，push.enabled=false（截图 011-raft-drift-home.png） |
| 浮物：推进锚位后涨潮浮起，与岸台齐平，可站上去随之升降 | PASS | 推到 (5,0.35,24.65)，inAnchor=true；涨潮后浮台顶 2.00 m，与岸台齐平（截图 011-raft-afloat-anchor.png）；从岸台走上去，人在 y 1.98。之后落潮，36 个采样点里人和浮台的相对高度跨度 0.000 m，没有离地帧，落潮后人在 y 0.6（截图 011-raft-ride-down.png） |
| 浮起时不能推；uTideLevel | PASS | 浮起时 push.enabled=false；刻度柱着色器里 uTideLevel=1.6，与 tide.level 一致。湿痕线是白盒材质，按约定不判断效果 |
| Y 调试切换 | PASS | 上面各项的涨落都由 Y 触发，过渡同样走 6 s |

**结论：011 基本通过，有 1 个一般问题（BUG-007）。**

## 2. v0.1-012 光路（`?smoke=1&debug=1&beamDebug=1&scene=testbed`）

镜子都用真实按键转：E 进机关台，A/D 转，E 切镜，Tab 退出；U、O 也是真实按键。时长按 fixedTick 计。测试脚本 qa-tools/t5-012.mjs 和 t5-012b.mjs（加 `&hintScale=0.02`，用来缩短提示计时）。

| 项 | 结果 | 依据 |
|---|---|---|
| F4「光路」行、初始光路 | PASS | 初始镜 A 在 30°，光经镜 A 反射 1 次后被挡住（blocker）。F4 显示「beam-lamp 亮暖 100% → 1 反射 · 挡住 ｜ beam-sky 亮冷白 0/40s … 命中 beam-igniter ｜ beam-lock 待命 0% …」。截图 012-initial-beam.png |
| 机关台用 E 进入，转镜时光路实时更新 | PASS | 候选是 beam-console，按 E 后上下文变成 puzzle。每转一档都会重算光路：镜 A 30→45 时终点 none，45→30 / 30→15 时 blocker，15→0 时经 A→B 打到 receiver。镜 B 转开一档后终点变 blocker，转回后命中 beam-lock。截图 012-mirror-a-aligned.png |
| 光感锁命中满 1.5 s 触发；中途移开进度归零 | PASS | 对准时进度上升（charging 0.61）。转开后变 idle，进度 0，并发出 receiver:reset。按 puzzle:partRotated 事件计时，最后一次转动到 receiver:activated 正好 **1.500 s**。触发后锁存为 activated，后面转开也保持。截图 012-lock-charging.png、012-lock-activated.png。第一轮脚本量到 1.40 s，那是计时起点取晚了，以第二轮按事件计时的结果为准 |
| 光打到镜子背面被挡 | PASS | 镜 B 用 D 一路转，转到 60° 时终点为 mirrorBack，F4 显示「镜背挡光」。截图 012-mirror-back-blocked.png |
| 接收器 0.3 m 半径 | 只看了单元测试 | test:beam 通过：偏 0.29 m 算命中，0.31 m 不算。测试场里没有能精确摆位的手段，浏览器里没单独测 |
| 最多反射 4 次 | 只看了单元测试 | test:beam 通过。测试场只有 2 面镜子，浏览器里没法测 |
| 天光 40 s 一周期、亮 25 s | PASS | beam:emitter 事件实测：灭 15.02 s，亮 24.97 s，以强度 0.5 为界，淡入淡出各 1 s，合起来正好是 40 s 一周期 |
| 没开油阀时点火口只发红光 | PASS | 天光命中点火口时，状态 blocked，receiver:blocked 只发一次，透镜是红色（裁剪图 012-igniter-red-lens-crop.png，原图 012-igniter-blocked-red.png） |
| 按 U 开油阀：天光常亮，命中满 2 s 点燃，天光转暖 | PASS | 干净时序：天光灭的时候按 U → beam:skyAlwaysOn → 天光淡入 → 第一次看到 charging 后 1.92 s 点燃（采样间隔约 1 帧）。从按 U 到点燃共 2.50 s，等于淡入到强度 0.5 的时间加 2 s。之后天光 color=warm、always=true |
| 按 O 切暖光 / 冷白 | PASS | warm → coldWhite → warm。冷白时光感锁已经锁存，不受影响。截图 012-lamp-cold.png |
| 提示区（H）在锁触发后失效 | PASS | 区内到一级时，currentId=test-beam，风灯图标可见，H 面板一级是「爸爸说过，光是会转弯的，只要给它一面镜子。」（截图 012-hint-before-lock.png）。真实解谜触发锁后：isSolved=true，currentId=null，图标消失，H 面板三级都变成「再等等，四处看看」（截图 012-hint-after-lock.png）。地面圈是 TestbedScene 的固定标记，不会消失，测试场标记不做判断 |
| `npm run test:beam` | PASS | 12/12（见 §0），里面包括「3 面镜子 + 4 次反射重算 ≤ 1 ms」 |
| 重算耗时 | 不评判 | SwiftShader 下 F4 显示 lastMs 0.000 ms（计时精度不够），按要求不判断性能 |

**观察（不算 BUG，请制作人或策划确认）**：
- 没开油阀时，天光命中点火口的持续时间也在累计（blocked 状态的进度条在涨）。如果天光已经照了超过 2 s 才开油阀，**开阀后约 0.08 s 就点燃了**，不会再等 2 s（第一轮实测，见 /tmp/t5-012.log）。代码里写的是「不满足时命中只发红光，满 holdSec 发一次 receiver:blocked」，实际表现符合这句话。问题是谜题 5 的设计是否要求开阀后重新计 2 s，需要确认。

**结论：012 通过，没有新 BUG。** 有 1 条设计确认项，就是上面这条。

## 3. 回归

### 3.1 BUG-006 S3 灯塔进场就亮 → **已修复，关闭**
- 打开 `?smoke=1&debug=1&scene=s3`。进场时：on=false，光束、暖光、自发光都没有（emissiveIntensity 0，light 强度 0）。截图 006-s3-entry-dark.png。
- 走到灯塔前出现 s3-lamp 候选，按 E 后：亮起，光束可见，暖光强度 60，自发光 8，接着出结束页。截图 006-s3-lit.png。
- BUG-006.md 已追加回归结论。控制台无报错。

### 3.2 batch4 附带项：字体（1f7d469）

**测法**：
- 每次都新开一个 Chrome，用全新的临时 profile，所以都是冷缓存。
- 打开 `?smoke=1` 进主菜单。
- 用 CDP Network 记录所有 woff2 请求，同时读 `__game.assets.fontStats` 和 performance 资源条目。
- 环境：HeadlessChrome/156.0.0.0，Linux x86_64，vite preview（http://127.0.0.1），SwiftShader；20:03 时负载 load avg 约 14.7。
- 测试脚本 qa-tools/t5-font.mjs，原始数据在 /tmp/t5-font.log。

| 项 | 结果 | 依据 |
|---|---|---|
| 冷启动时每个 woff2 只有 1 次成功请求 | PASS | 3 次冷启动，sans 和 serif 每次都只有 1 个 200 响应（传输 228,088 B / 319,764 B），没有重复下载 |
| 有没有取消请求（attempts=2） | **3 次里 2 次出现 → BUG-008（轻微）** | 端口 5266、5267 两次：两个字体的第一个请求都 `net::ERR_ABORTED`、canceled=true、传输 0 B；约 0.33 s 后重试拿到 200，fontStats 里 attempts=2、ok=true。端口 5268 那次 attempts=1，没有取消。程序说他那边复现不了，这里把环境记了下来 |
| 两个 woff2 都失败时回退到系统字体 | PASS | 用 `Network.setBlockedURLs ['*.woff2']` 拦截：每个字体请求 3 次（attempts=3），error「Failed to fetch」。`<html>` 加上了 fonts-fallback 类，document.fonts 为空，主菜单「新游戏 / 设置 / 制作名单」正常显示，控制台无报错。截图 font-blocked-fallback.png |
| 截图 | | font-cold-5266.png、font-cold-5267.png、font-cold-5268.png |

### 3.3 batch4 附带项：extras.forceLod0（verify:glb）→ PASS
- 任务里写的路径 `art/models/env/prop-fresnel-lens-ch1.glb` 不存在，实际文件在 **`art/models/props/prop-fresnel-lens-ch1.glb`**。用后者跑的 `npm run verify:glb -- ../art/models/props/prop-fresnel-lens-ch1.glb`，exit 0，结果是「✓ 通过（错误 0，警告 0）」。
- 输出里关键的几行：
  - 「forceLod0：prop-fresnel-lens-ch1（加载后固定 LOD0，低级 LOD 会被丢弃）」
  - 「加载器：buildLods → THREE.LOD 0 个，固定 LOD0 0 个（解谜）+ 1 个（forceLod0），丢弃低级 LOD 2 个；… 加载后渲染三角面 14,048」，这正好等于 lod0 的面数。
- 结论：forceLod0 生效，加载后保留 LOD0。没有 `@/` 别名错误。
- 这里只跑了 verify:glb 的加载器模拟，没在游戏场景里实际摆放这个模型看效果，因为它还没接入任何场景。

### 3.4 快速回归 + smoke 4 项失败复核（20:23～20:50，load avg 0.3～14）

脚本：r5-reg / r5-reg2 / r5-010 / r5-045 / r5-007（batch4 脚本换成 b5lib + `&debug=1`），p5-misc / p5-lh / p5-fix（本批新写的探针）。日志：/tmp/b5-reg.log、/tmp/b5-low.log、/tmp/p5-*.log。

**先说明一个测量问题**：在 SwiftShader 下，`__game.time.elapsed`（帧时间）和固定步长时间（fixedTick/60）对不上，比例大约 3:1。例子：push 用 fixedTick 算是 0.80 m/s，用 elapsed 算是 0.27 m/s；highlight 用 fixedTick 算 1.03 s，用 elapsed 算 3.03 s。所以 batch2/3 的旧脚本凡是按 elapsed 判「x 秒」的项，这批都会误报 FAIL。下表按固定步长判，判不了的就写明。另外，物理是固定步长、计时器是帧时间，在很慢的机器上两者的相对速度会变；真 GPU 60 fps 下两者一致，所以这里只记作观察，不报 BUG。

**smoke 4 项失败的复核**

| smoke 失败项 | 复核 | 结论 |
|---|---|---|
| 009 切档卡死 6383 ms | 没有单独重跑。目标档参数都生效了，卡的是一帧渲染 | 环境问题（负载 + 软件渲染），不报 BUG |
| 003「测试镜头没结束」 | 没有单独重跑。本批没有改相机相关代码 | **未复核**，见 §5 |
| 004「push 没推到头」 | p5-misc：push 固定步长速度 0.800 m/s，到 z=9.5，pushEnd 发 1 次 → PASS。之后的 demo 灯塔项（batch4 改成等 15 s）用 p5-lh 单独测：S1 (11,2.45,-8.3) 出现「E 操作」，按 E 后切换（墙钟 3.7 s，固定步长 0.17 s），在 15 s 内 → PASS（截图 s1-demo-lighthouse-toggle.png） | 环境问题；灯塔 15 s 项 PASS |
| 005 toast 与提示重叠 | p5-misc / p5-lh：testbed 提示折成两行后重叠；S1 单行不重叠 | **BUG-009（轻微）** |

**快速回归**

| 项 | 结果 | 依据 |
|---|---|---|
| 主菜单、设置保存、恢复默认（ultra / 1.0）、BUG-003 模糊 ×3、暂停→主菜单→继续 | PASS | r5-reg |
| BUG-005 S1 操作提示走文本表 | PASS | 页面「W A S D 移动　Shift 小跑　点击画面 锁定视角　E 互动　右键 观察　滚轮 远近　Esc 暂停」和快照 zh-CN.ts:117 一致，kbd 框正常。r5-reg 判 FAIL 是因为脚本里写死的是 batch4 的旧文案（「锁定鼠标转视角」），05bfc57 导入定稿文本后改了，是脚本问题 |
| BUG-004 阅读后再读不重复、被遮挡时挂起 | PASS | r5-reg、r5-045 |
| 010 启动只加载 boot+menu、新游戏 common+s1、S1 预加载 s2、释放上一场景、存档 s1/s2/s3、刷新「继续」回 S3 入口、S3 点灯→结束页 | PASS | r5-010 低负载重跑（20:44）。结束页「本章用时 0:03｜使用提示 0 次」 |
| 010 黑场 ≤ 1.0 s | **判不了** | 墙钟 S1→S2 3712 ms（swap 2007）、S2→S3 5146 ms；smoke 里是 7012 / 11556 ms。都是软件渲染下的墙钟，不判 |
| 交互 inspect / use / hold / pickup / place（真实按 E） | PASS | r5-reg2，6 项都 true；r5-045 里 pickup/place 事件正确（from sample-pedestal-socket → sample-stand-a-socket） |
| use 自动走位 ≤ 0.4 s | 边界值，不报 BUG | p5-fix：固定步长 0.433 s（batch3 是 0.333 s）。软件渲染下一帧会补跑好几个固定步，按 E 到达的那一帧本身就占了步数，误差在一帧以内。真 GPU 上需要再确认 |
| hold 2 s | PASS（含走位） | 固定步长 2.467 s，里面包括走到交互点的时间；松开后进度归 0（r5-045） |
| push 0.8 m/s | PASS | 固定步长 0.800 m/s |
| 机关模式（吸附、Q/E、R、右键 / Tab 退出、Esc 暂停后继续） | PASS | r5-045 |
| highlight 3 s | PASS（按帧时间） | elapsed 3.03 s（固定步长 1.03 s，原因见上面的测量说明） |
| 提示条件 1.8 m / ±60° | PASS | 偏 52° 有「E 查看」，偏 69° 没有，后退 1 m（2.6 m）没有提示但图标还在。r5-045 判 FAIL 是因为背对木箱时提示变成了旁边钟的「E 敲钟」，那是另一个交互物，行为正确 |
| 阅读：翻页、右键 / Tab 关闭、阅读中冻结 | PASS | r5-045 低负载：D 翻到 2～5 / 5，W 按 2.5 s 位置不变 |
| 日志 J：分组、点条目阅读、目标更新 | PASS | r5-045 |
| 日志第 6 页（结尾演出后） | PASS | p5-fix：6 页，第 6 页「我会去找你。也会把它们一盏一盏点亮。」（截图 005-journal-page6.png）。r5-045 的 FAIL 是翻页按键被吞了一次 |
| 007 提示（9/18/30 s、弹窗不暂停、离开区域暂停、F4、解开后消失、分步骤） | PASS | r5-007（hintScale 0.05）；smoke 007 也是 ✓，hintsUsed +3。r5-007 里 hintsUsed=undefined 是因为测试场地没有存档，SaveSystem.flush() 注明「还没有存档时不写」，属于预期行为。二级高亮「1.02 s」是固定步长时间，按帧时间约 3 s |
| 字幕 2.0 / 3.6 s、Space 推进 | 未复核 | r5-045 高负载那轮：10 字 2.017 s；30 字 playText 3.8 s；29 字 3.483 s（期望 3.48）。Space 那次没推进，左键推进了，两次 hide 原因都是 advance。低负载那轮没跑到这一项。smoke 005 失败在 toast 那一步，也没跑到字幕。Space 现在也是跳跃键，**建议下批确认**，本批不报 BUG |
| 控制台错误 | 0 | 所有回归脚本和探针的 page.errors 都是 []；smoke 只有 2 条 SwiftShader 扩展警告 |

## 4. smoke（`npm run smoke`，快照，跑一次，如实记录）

- 时间：20:04:46 开始，20:22:31 结束，**EXIT 1，「冒烟测试失败：4 项」**。日志 /tmp/b5-smoke.log。
- **负载说明（要一起看）**：这次 smoke 跑的时候机器很忙，load avg 在 25～55 之间。原因之一是我自己的测试框架留下了孤儿 Chrome（qa-tools/cdp.mjs 杀的是 google-chrome 包装脚本，真正的 Chrome 没被杀掉）。我已经杀掉自己的这些进程，并修好了 cdp.mjs（改成按进程组杀）。别的 agent 的进程没有动。所以下面 4 项失败**不能直接当成游戏缺陷**，逐项复核见 §3.4。

| smoke 项 | 结果 | 说明 |
|---|---|---|
| dist 解码器、主场景、DRACO、KTX2 | ✓ | |
| 003 建立镜头 / 001 输入、指针锁定 / 006 存档设置 / 002 角色控制器 | ✓ | |
| 009 画质 | ✗ | 「切档卡死 ≥ 5 s」，worst 6383 ms。目标档的阴影 / 雨 / 像素比都已经生效（same=true），只是一次切档的帧花了 6.4 s，符合高负载 + 软件渲染下的表现，**判为环境问题，不报 BUG** |
| 003 相机 | ✗ | 「测试镜头没结束」。脚本按墙钟等，高负载下没等到。本批没有改相机相关代码，**不报 BUG**；没能在低负载下重跑，记入 §5 |
| 004 主场景 Esc 暂停 / testbed 6 s | ✓ | |
| 004 交互 | ✗ | 「push 没推到头」（墙钟 60 s 内没收到 pushEnd）。**demo 灯塔「E 切换灯塔」15 s 等待（batch4 项）排在 push 之后，这次没执行到**，所以在 smoke 里没验到，单独测见 §3.4 |
| 005 字幕 / 阅读 / 日志 | ✗ | 「日志已更新」和左下操作提示重叠：toast [16,566,81,585]，hint [16,576,1280,619]。这一项是真问题，见 §3.4 和 BUG-009 |
| 008 菜单 / 010 流程 / 007 提示 / 011 潮汐 / 012 光路 | ✓ | 008 里字体 fetch 次数 sans 1、serif 1。010 里 S1→S2 7012 ms、S2→S3 11556 ms，都是墙钟，smoke 只看黑场有没有、存档对不对，不做时长判断 |

- 警告 2 条，第一条是 `KHR_parallel_shader_compile extension not supported`（SwiftShader 没有这个扩展，不是游戏问题）。

## 5. 没测 / 没测全的项，及原因
- **fps / 性能**：按要求不做 fps 判断。SwiftShader 下的墙钟时长（切档、黑场切换、加载）都不判。
- **真 GPU、其他浏览器（Firefox / Safari）、移动端**：环境里只有无头 Chrome + 软件渲染。
- **010 黑场 ≤ 1.0 s**：只有墙钟数据（3.7～11.6 s），软件渲染下判不了。
- **smoke 003 相机「测试镜头没结束」、009 切档**：按要求 smoke 只跑一次。这两项没能在低负载下单独重跑，判断是环境问题，但**没有实证**。
- **字幕时长 / Space 推进**：低负载下没复核，见 §3.4。
- **012 光路**：0.3 m 命中半径、最多 4 次反射只由单元测试 test:beam（12/12）覆盖，游戏内没有构造对应场景。
- **forceLod0**：只跑了 verify:glb 的加载器模拟，菲涅尔透镜模型还没接入任何场景。
- **BUG-008 根因**：只记录了环境和现象，没有定位到是谁取消了首个请求。
- **BUG-009 窄窗口下 S1 提示折行**：是从 CSS 推断的，没有实测窄于约 630 px 的窗口。
- 会改写文件的脚本（lint:fix、fonts、text:import、assets:test-lod）没跑，原因见 §0。

## 6. 结论

| 单 / 项 | 结论 |
|---|---|
| v0.1-011 潮汐 | **有条件通过**：功能全部 PASS（smoke 011 也是 ✓），礁石路坡道接缝卡住见 BUG-007（一般） |
| v0.1-012 光路 | **通过**：锁 1.500 s、点火口 2 s、天光 15/25 s、红光、O/U、提示都 PASS（smoke 012 也是 ✓）。有一个设计问题待裁定：油阀没开时，天光照射的时间也在累计，开阀后约 0.08 s 就点燃（§2） |
| BUG-006 | **已修复，关闭** |
| batch4 字体 | **通过**：每个 woff2 只成功下载 1 次，被拦截时回退到系统字体。首个请求仍会被取消，见 BUG-008（轻微） |
| batch4 smoke 灯塔 15 s | **通过**（单独测，3.7 s 内切换）；smoke 里这一项排在 push 后面，没执行到 |
| batch4 forceLod0 | **通过**（verify:glb） |
| batch4 脚本 / @/ 别名 | **通过**：19 个脚本都 exit 0，没有别名错误 |
| 快速回归（菜单、S1→S2→S3、交互、提示、阅读、日志） | **通过**，新增 BUG-009（轻微，toast 与两行提示重叠）。use 走位 0.433 s 是边界值，没报 BUG |
| smoke | EXIT 1，4 项失败：push 是环境问题，复核 PASS；005 → BUG-009；009 和 003 判断为环境问题，没有复核 |
| 体积 | 主菜单包 2.61 / 15 MB；首场景包 0.13 / 150 MB；首次进 S1 总下载 2.73 MB。按 art/ 已交付文件估算，全部接入后首场景包约 133.48 MB，余量约 16 MB，需要留意 |

新 BUG：BUG-007（一般）、BUG-008（轻微）、BUG-009（轻微）。控制台错误 0。
