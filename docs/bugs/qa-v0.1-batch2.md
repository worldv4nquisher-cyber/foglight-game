# v0.1 第二批验收（6bb5d37 工具、c73645f v0.1-009 画质三档）

- 实际测试 commit：**c73645f**（game/ HEAD；6bb5d37 是它的父提交，已包含在内）
- 测试方式：`git archive c73645f` 导出到 /workspace/qa-tools/snap-c73645f/game（node_modules 软链到 game/），在快照上跑 dev server 和命令。game/ 里程序有未提交改动（MainScene / TestbedScene / gameplay.ts 等），没有受影响。没有改 game/ 源码。
- 环境：无头 Chrome + SwiftShader 软件渲染（约 4–6 fps），devicePixelRatio=1，1024×576。所有帧率相关结论都要实机复核。
- 日期：2026-10-29（UTC+7）
- 测试脚本 / 原始输出：/workspace/qa-tools/（t-q.mjs、t-q2.mjs、t-q3.mjs、t-p1.mjs、mk-nocollider*.mjs；out/quality1.log、quality2.json、quality3.json、part1-browser.log）
- 截图：docs/bugs/qa-v0.1-batch2/

## 快照基础检查
- `npm run check`：退出码 0。verify-quality 输出「画质参数表 / 自动检测校验通过（11 项）」。构建：index js 115.81 kB，css 6.00 kB。
- `npm run smoke`：退出码 0。009 行：SwiftShader 实测选中标准（ultra 2 / high 4 / standard 9 fps）；simulateFps=40 依次极致→高→标准 ✓。

## 1) 6bb5d37 tools：verify-lod / verify:glb —— 部分通过（1 个轻微缺陷 BUG-001）

| 项 | 结论 | 说明 |
|---|---|---|
| 接收文件参数 | 通过 | `node scripts/verify-lod.mjs <文件>` 和 `npm run verify:glb -- <文件>` 都只审计指定文件。不带参数时仍跑原来的 LOD 套件，退出码 0 |
| prop-lantern-brass.glb | 通过 | 0 错误，3 条警告（albedo / normal / orm 是 WebP，§5.7 要求 KTX2），退出码 0。puzzleCritical；-collider×1、-interact×1、-emitter×1；lod0 7,240 面（预算 ≤8k）；COLOR_0 1/1 |
| 缺 -collider 的 puzzleCritical 用例 → 退出码 1 | 通过 | 删除节点（重排索引）的用例：「✗ puzzleCritical 物体缺 -collider（§5.4 必须）」，node 和 npm 两种入口都退出 1。改名为 -collision 的用例报 2 个错（缺 -collider，-collision 网格缺 COLOR_0），也退出 1 |
| 孤立 collider（节点留在 JSON、不在场景图） | **不通过 → BUG-001** | 审计照样计「-collider×1」并通过（退出 0），但游戏加载后 scene 里没有这个碰撞体 |
| char-xi.glb 记录 | 已记录 | 0 错误，3 警告（3 张 WebP：tex-xi-albedo 2048²、hair 512×1024、face 1024²），退出码 0。节点 78 / 网格 3 / 材质 3 / skin 1；LOD 89,880 / 35,304 / 17,341（预算 120k / 50k / 25k）；非 puzzleCritical，无特殊节点；COLOR_0 3/3（9 个 primitive 全带） |
| 带 COLOR_0 的 GLB 加载后 material.vertexColors=false | 通过 | 浏览器里用 `__game.assets.loadEntries` 加载。灯笼：2 个带色网格，材质 mat-prop-puzzle-ch1 / mat-prop-lantern-glow 的 vertexColors 都是 false，geometry 保留 color 属性。char-xi：9/9 网格带 color，3 个材质都是 false。对照组直接用 GLTFLoader 加载同一灯笼，这两个材质是 true，说明是 AssetLoader 关掉的 |

## 2) c73645f v0.1-009 画质三档 —— 通过（1 个轻微缺陷 BUG-002，另有若干需实机）

| 验收项 | 结论 | 说明 |
|---|---|---|
| quality.ts 与 style-guide §8 一致 | 通过 | 导出 QUALITY_PRESETS 逐项对照，31 行 × 3 档完全一致（out/quality-presets.json）。另有 postprocessing / aoQuality / shadowRadius / viewDistance（600/400/250）/ fogFroxels / label 等附加字段，与 §8 不冲突。verify-quality 11 项通过 |
| 默认档位极致 | 通过 | localStorage.clear() 后第一次拿到 `__game` 时 tier=ultra，设置 quality=ultra、qualityDetected=false |
| clear + ?simulateFps=40 进 S1：极致→高→标准，只测一次 | 通过 | quality:changed 依次 ultra→high（auto，游戏时间 2.37 s，建立镜头中）→ standard（auto，5.13 s）→ quality:detected standard（8.77 s，真实时间约 17.7 s，进主场景后算起）。rounds = ultra 40 / high 40 / standard 40，降两档后停止，没有再往下降。设置：qualityDetected=true、qualityDetectedTier=standard、qualitySource=auto、quality=standard。三次独立运行结果一致 |
| 降过档时显示 quality_auto_note | 通过 | 暂停菜单画质项下显示「已根据这台电脑自动选择画质，可以随时改回。」，底栏「自动检测：标准 · GPU … · Esc 继续」（截图 009-auto-note-pause-menu.png） |
| 刷新 / 重启后不再检测 | 通过 | 刷新后 12 s 内 benchmark.state=idle，0 个 quality 事件，仍是标准 |
| 手动档位优先 | 通过 | ① 真实鼠标点暂停菜单「极致」：tier=ultra，设置 quality=ultra、source=user；刷新 12 s 后仍是极致，idle，无事件。② 检测中途手动改档：立即 aborted，以玩家为准，刷新后不再检测。③ 检测前已手动选档：state=skipped，档位不变。④ URL ?quality=high 临时覆盖：不检测，不写设置（localStorage 为空） |
| 「恢复默认」不重新检测，回到检测结果 | 通过 | 极致（手动）→ resetToDefaults → 标准（source=auto），benchmark 仍是 idle |
| 运行时切档不重载场景 | 通过 | 经暂停菜单真实点击切 高→标准→极致：window 标记保留，同一个 scene 对象，scene:change 0 次。高：阴影 2048、雨 15000、视距 400、像素比 1。标准：2048 / 6000 / 250 / 0.8（renderScale 0.8 生效）。极致：4096 / 30000 / 600 / 1 |
| 切档无崩溃 | 通过 | 整个过程 page.errors 为 0 |
| 切档黑帧 < 1 s | **需实机** | SwiftShader 下 smoke 记录的最长帧间隔：极致 500 ms / 高 1017 ms / 标准 533 ms / 极致 617 ms。软件渲染单帧本来就要 150–250 ms，不能据此下结论；高档 1017 ms 一项请实机重点看 |
| F3 面板（对照 §8 预算） | 通过 | 三档面板都有「N FPS · ms (max)」「draw call X / 预算」「三角面 X / 预算」和显存估算。预算与 §8 一致：极致 /2000、/6.00M；高 /1200、/3.50M；标准 /600、/1.50M。切档后最慢约 3.3 s 刷新到新预算（面板每 0.5 s 累计一次，SwiftShader 下帧很慢）。真实 F3 按键可开关（截图 009-f3-ultra/high/standard.png） |
| 50 fps 阈值的真实判定 | **需实机** | 只验证了 simulateFps 路径和 minFps=50 的逻辑。SwiftShader 实测为 2/4/9 fps，全部降档，符合预期 |

### 重点复查：上次见到的两个运行时异常
- **PauseMenu.refresh 读 QUALITY_PRESETS[q.auto] undefined**：c73645f 中已不存在。源码改为 q.detected / q.urlOverride。运行时以下情况都打开过暂停菜单，0 个异常：未检测（testbed 底栏「尚未自动检测」）、检测中、已检测、aborted、URL 覆盖；入口包括真实 Esc 键和 `__game.pause`。不开 BUG。
- **TestbedScene.fixedUpdate 读 undefined 的 body**：c73645f 中不存在。c73645f 没有改 TestbedScene.ts。在 ?scene=testbed 里做了 W/D 移动、空格、T、G、C、F3、F4、Esc 暂停/继续、暂停中三档切换，0 个异常。上次看到的是 game/ 里未提交的中间状态。不开 BUG。

### 观察（不算缺陷，请策划确认）
- 单子写「3 秒建立镜头结束时完成检测」，但每轮测 3 s 加 5 帧热身，连降两档要测 3 轮，所以 simulateFps=40 时检测在建立镜头之后才完成（游戏时间约 8.8 s）。只有不降档（1 轮）才能在建立镜头内完成。实现符合「降档后重测」的要求，两者本身有冲突，建议改单子文案。
- 检测进行中，档位切换发生在玩家已经可以操作的探索阶段（第二次降档在 5.13 s，建立镜头已结束），实机上可能看到一次切档。
- 测试时 game/ 工作区又有程序的未提交改动（README、package.json、MainScene、TestbedScene 等 10 个文件），本批全部在快照上测，不受影响。

## BUG 列表
| 编号 | 标题 | 严重度 | 关联 |
|---|---|---|---|
| BUG-001 | 孤立（不在场景图里）的 -collider 节点被审计算作存在，puzzleCritical 缺碰撞体照样通过 | 轻微 | 6bb5d37 |
| BUG-002 | 检测被中止或跳过后，暂停菜单底栏显示「自动检测：极致」（qualityDetectedTier 仍是默认值），「恢复默认」也会回到极致 | 轻微 | c73645f / v0.1-009 |

## 未能测试
- 真实 GPU 帧率、50 fps 阈值的实机判定、切档黑帧 < 1 s：环境只有 SwiftShader，需实机。
- 真正的 S1：v0.1 的 S1 还是占位主场景（MainScene），检测在 MainScene.enter 启动，正式 S1 场景接入后要再测一次。
- 跨浏览器（Firefox / Safari）和高 DPI（devicePixelRatio>1 时 maxPixelRatio 的上限）：只测了 Chrome，DPR=1。
- 本批没有命令被安全检查拦截。
