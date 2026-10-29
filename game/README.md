# 失落灯塔群岛 · 游戏工程（game/）

3D 网页游戏，Three.js + TypeScript + Vite。第三人称探索解谜，三渲二半写实，**桌面浏览器优先、极致画质、忧郁氛围**。
手机不是目标平台，但保留了基础触屏输入抽象（虚拟摇杆 + 滑动转视角 + 交互键），默认不注册，以后需要时可以启用。

> 当前是 v0.1 框架 + 占位 demo：阴暗海岛、起伏水面、岩石、自动旋转的占位立方体、胶囊占位角色、灯塔暖光、细雨、后处理氛围。

## 环境与命令

需要 Node.js ≥ 22.18（校验脚本直接运行 .ts 源码；已在 Node 24 验证）。

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发服务器 http://localhost:5173（热更新，左上角显示 FPS） |
| `npm run dev:host` | 同上，并在局域网开放（别的电脑访问本机 IP:5173） |
| `npm run build` | 类型检查 + 生产构建，输出 `dist/`（可静态部署） |
| `npm run preview` | 本地预览 `dist/`（http://localhost:4173） |
| `npm run typecheck` | TypeScript 严格模式检查（src + vite.config） |
| `npm run lint` / `lint:fix` | ESLint（flat config + typescript-eslint 类型感知规则） |
| `npm run test` | 全部 Node 校验：LOD / puzzleCritical、资源后处理与 GLB 自检（`test:assets`）、输入（`test:input`）、存档（`test:save`）、角色物理（`test:physics`）、相机（`test:camera`）、画质参数表与自动检测（`test:quality`，逐键对照 style-guide §8）、文本表是否最新 / 代码引用的文本 ID 是否都在（`test:text`）、交互与机关（`test:interaction`）、字幕 / 阅读 / 日志（`test:narrative`；`test:text` 同时检查代码里没有硬编码的剧情中文） |
| `npm run text:import` | 从 `docs/gdd/text-ch1.json` 重新生成 `src/content/text/zh-CN.ts`（文案改了跑一次；`test:text` 会检查生成结果是否已提交） |
| `node scripts/verify-lod.mjs <a.glb> [b.glb…]` | **GLB 交付自检**（美术交付前跑，也可 `npm run verify:glb -- <文件>`）：LOD 层级与各级三角面、puzzleCritical、`-collider` / `-interact` 等特殊节点、COLOR_0 平滑法线、面数预算、材质与贴图。不带参数 = 原来的 LOD 自测。见下文「GLB 交付自检」 |
| `npm run assets:test-lod` | 重新生成 LOD 测试模型 `public/assets/models/test-lod-puzzle-critical.glb` |
| `npm run check` | typecheck + lint + test + build 一次跑完（提交前跑） |
| `npm run smoke` | 无头 Chrome 冒烟测试：对 `dist/` 起 preview 服务，打开 `?smoke=1`，跑页面内检查并汇总控制台错误（先 `npm run build`；需本机 Chrome，可用 `CHROME=路径` 指定） |

`dist/` 使用相对路径（`vite base: './'`），可以放到任意静态服务器的任意子目录，也可以被 Capacitor / Electron 以本地文件加载。
注意：直接双击 `dist/index.html`（file://）浏览器会拦截 ES 模块和 wasm，请用 `npm run preview` 或任意静态服务器打开。

### 调试参数（URL）

| 参数 | 说明 |
|---|---|
| `?quality=ultra\|high\|standard` | 临时强制画质档位（不写设置，也不跑自动检测） |
| `?simulateFps=40` | 画质自动检测用固定帧率代替实测（`40,60` = 第 1 轮 40、第 2 轮起 60）；需先清空设置（`localStorage.clear()`）才会检测 |
| `?postfx=0` | 关闭后处理，直接渲染（排查渲染问题） |
| `?atmo=lonely-night` | 切换气氛预设（默认 `melancholy-dusk`） |
| `?scene=testbed` | 角色控制器 / 相机测试场地（坡、台阶、螺旋楼梯、墙、闸门 G、升降台、跨越点、T 黑场送回；带窄门的小屋、测试机关、观察点、C 测试镜头），不存档 |
| `?debug=1` | 正式构建里也打开 F3 性能面板 / F4 调试面板（输入、速度、碰撞耗时、相机、观察点对准度） |

开发模式下控制台可用 `__game`，如 `__game.quality.set('ultra')`；`__lods()` 列出 LOD 测试物体的当前层级。

## 操作

键位按「输入上下文」区分（`src/systems/input/actions.ts`，GDD §3）。本作不做跳跃（GDD §15）。

| 操作 | 探索 explore | 机关 puzzle | 阅读 reading | 演出 cutscene |
|---|---|---|---|---|
| 移动 / 旋转部件 | WASD / 方向键 | 鼠标左右 / A·D 转一档 15°；双轴部件鼠标上下 / W·S 转第二轴 | — | — |
| 小跑 / 精调 | 按住 Shift 小跑 | 按住 Shift 精调 | — | — |
| 转视角 | 点击画面锁定鼠标后直接移动（不支持指针锁定时按住左键拖拽） | 固定机位（鼠标用来转部件） | 显示光标 | — |
| 交互 | E | — | — | — |
| 翻页 | — | — | A·D / ← → / 点箭头 | — |
| 切换部件 | — | Q / E，滚轮上 / 下 | — | — |
| 相机远近 | 滚轮 | — | — | — |
| 观察 | 按住右键 | — | — | — |
| 退出机关 / 关闭阅读 | — | 右键 / Tab | 右键 / Tab | — |
| 重置机关 | — | R | — | — |
| 提示 / 日志 | H / J | H | J（关日志） | — |
| 推进字幕 | 左键 / 空格 | 空格 | —（左键留给翻页箭头 / 日志条目） | 左键 / 空格；按住空格 1 秒跳过 |
| 暂停 | Esc（任何时候） | Esc | Esc | Esc |

- Esc 永远是暂停（制作人裁定：指针锁定时 Esc 先被浏览器用来解锁，页面不一定收到按键）。暂停后点「继续」或再按 Esc，再点一下画面重新锁定鼠标。
- 重新锁定的那一下点击一般不触发操作；**例外**（v0.1-004 制作人裁定）：在机关 / 阅读里暂停→继续后，第一下右键既重新锁定、也直接退出（和 Tab 一致），由 `actions.ts` 的 `lockClickPassesThrough()` 决定。
- 开发模式或 URL 加 `?debug=1`：F3 性能面板，F4 调试面板（输入上下文栈、指针状态、最近触发的 action）。控制台 `__game.input.pushContext('puzzle')` 可手动切上下文试键位，`__game.input.debug = true` 在控制台打印每个 action。
- 触屏输入（`TouchInput`，摇杆 + 滑动转视角 + 交互键）保留代码但默认不注册（桌面专做）。

## 目录约定

```
game/
├─ index.html               入口 HTML（#app 画布容器 + #ui-root UI 层）
├─ public/                  原样拷贝到 dist 的静态文件
│  └─ assets/
│     ├─ models/            GLB 模型
│     ├─ textures/          KTX2 / WebP 贴图
│     └─ audio/             音效、音乐（ogg/mp3）
├─ src/
│  ├─ main.ts               启动：WebGL2 检测 → Game → 注册场景 → Boot
│  ├─ core/                 Game（渲染器 + 主循环）、Time（固定步长）、EventBus、dispose 工具
│  ├─ scenes/               SceneManager、BaseScene、BootScene → LoadingScene → MainScene
│  ├─ entities/             轻量 ECS：Entity + Component（KinematicBody、PlayerController、TraversalLink、ViewpointTarget、Spinner…）、createPlayer
│  ├─ systems/              PhysicsSystem（胶囊 vs BVH）、locomotion、CameraFollowSystem（第三人称 / 机关 / 演出）、QualityBenchmark（画质 3 秒检测）、AudioSystem、camera/、input/、save/、interaction/（交互与机关，004）
│  │  ├─ camera/            CameraTrack（镜头轨道：关键帧或 GLB 相机动画节点）
│  │  └─ input/             actions（抽象动作 + 键位）、InputManager、KeyboardMouseInput、TouchInput
│  ├─ render/               PostFX 后处理管线（postprocessing + N8AO）、lod（LOD 组装 + puzzleCritical）
│  ├─ world/                场景构件：SkyDome、Water、Rain、Lighthouse（占位）、testCourse（角色测试场地）、interactionSamples（交互样例）
│  ├─ content/text/         文本表（zh-CN.ts 由 scripts/import-text.mjs 生成，勿手改）与 t()
│  │                        （systems/NarrativeState.ts：已读文档、只一次、当前目标；ui/Subtitles、Reader、Journal、Toast：005）
│  ├─ assets/               AssetLoader（GLB+DRACO+Meshopt+KTX2、纹理、音频）、manifest、placeholders
│  ├─ config/               gameConfig（技术参数）、gameplay（玩法数值）、quality（画质三档）、atmosphere（气氛预设）
│  ├─ ui/                   UIManager、LoadingScreen、Hud、PauseMenu、FpsCounter、styles.css
│  ├─ platform/             device 检测、可见性、全屏、native（Capacitor/Electron 适配点）
│  └─ types/                第三方库类型声明（n8ao）
├─ scripts/                Node 脚本：gen-lod-test-asset（生成测试 GLB）、verify-lod（LOD 自测 / GLB 交付自检）、verify-*（各系统校验）、lib/glb-audit（自检规则）
├─ eslint.config.js / tsconfig.json / tsconfig.node.json / vite.config.ts
└─ dist/                    构建产物（不提交）
```

代码规范：TypeScript `strict` + `noUncheckedIndexedAccess`；`@/` 指向 `src/`；类型导入用 `import type`；不允许悬空 Promise。

## 核心架构

- **主循环（core/Game.ts）**：每帧 `input.beginFrame → N 次 fixedUpdate(1/60s，逻辑/物理) → update(可变步长：相机/动画) → render → ui.update → input.endFrame`。单帧时长截断 0.25s，切后台自动暂停。KinematicBody 按 alpha 插值显示，高刷屏也平滑。
- **场景（scenes/）**：`SceneManager.change(name)` 依次 `exit → dispose → new → enter(可异步)`。流程 Boot（启动资源）→ Loading（进度条，加载 `main` 资源组）→ Main。`usePostFX=true` 的场景走后处理。
- **输入（systems/input/）**：玩法代码只认抽象 action（`interact/sprint/partNext/exitPuzzle/advance/skipHold/pause…` 和轴 `moveX/moveY` + 视角 / 滚轮增量），输入源只写原始按键，由 InputManager 按上下文栈（`InputContext.ts`，`input.pushContext('puzzle')` 返回弹出函数）映射。新增操作：在 `actions.ts` 加 action 并在对应上下文配键位。灵敏度 / Y 反转：`input.setLookSensitivity()` / `setInvertY()`。指针锁定默认开启（`gameConfig.input.pointerLock`）。校验：`npm run test:input`。
- **资源（assets/）**：见下节。缺失或加载失败一律回退占位几何体/棋盘格纹理，游戏照常运行。
- **画质（config/quality.ts，v0.1-009）**：纯桌面三档「极致 / 高 / 标准」，参数表键名与数值逐项照抄 `art/style/style-guide.md` §8（`npm run test:quality` 校验，期望值内嵌在 `scripts/verify-quality.mjs`，§8 改了两边一起改）。表里体积雾、CSM、描边、反射、TAA、AgX 等特性在 023–026 实现时直接读这里；现在已生效的是 `renderScale`、`maxPixelRatio`、`shadowType.mapSize`（单张平行光阴影）、`rainParticles.count`、`ao.gtao`（N8AO）、`bloom.mipLevels`、`filmGrain`、`vignette`、`lodDistances`。
  - **默认极致**，不按 GPU 名称判档（GPU 名只打日志、显示在暂停菜单底部）。
  - **3 秒自动检测（systems/QualityBenchmark.ts）**：设置里 `qualityDetected=false`（新安装 / 清空设置）时，第一次进入 S1 的 3 秒建立镜头里从极致开始测平均帧率，< 50 fps 降一档后重测 3 秒，最多连降两档；暂停 / 切后台这一轮作废重测，切档后前 5 帧不计。结果写设置（`quality`、`qualityDetectedTier`、`qualitySource='auto'`），之后刷新 / 重启都不再测。降过档且玩家没手动改过时，暂停菜单画质项下显示 `ui.settings.quality_auto_note`。
  - 玩家手动切换（`game.quality.set(tier)`）随时生效并保存，`qualitySource='user'` 后不会再被自动改；检测中途手动改 = 停止检测、以玩家为准。「恢复默认」不重新检测，画质回到检测结果（没检测过回到极致）。
  - **运行时切档**不重载场景：发布 `quality:changed { tier, previous, source }`，Game 改像素比并 resize（重建后处理渲染目标），PostFX 改 AO / bloom / 颗粒，场景丢掉旧阴影贴图按新尺寸重建、改雨量和 LOD 距离。检测完成另发 `quality:detected`。
  - **F3 性能面板**（开发模式 / `?debug=1`）：FPS、帧时间（含最长帧）、draw call、三角面（整帧含后处理，`renderer.info`）、显存估算（几何 + 贴图 + 渲染目标，`render/vram.ts`），draw call 和三角面对照当前档 §8 预算（`maxDrawCalls` / `sceneVisibleTris`），超了标 ⚠。正式版「显示帧率」只显示一行 FPS。

  | 档位 | renderScale × 像素比上限 | AO | 阴影贴图 | 雨 | bloom mip | 胶片颗粒 | LOD 距离 | 视距 |
  |---|---|---|---|---|---|---|---|---|
  | ultra 极致（默认） | 1.0 × 2 | GTAO 全分辨率 | 4096 | 30k | 6 | 开 | 60 / 150 / 400 | 600 |
  | high 高 | 1.0 × 1.5 | GTAO 半分辨率 | 2048 | 15k | 5 | 开 | 40 / 100 / 250 | 400 |
  | standard 标准 | 0.8 × 1 | 只用烘焙 | 2048 | 6k | 4 | 关 | 25 / 60 / 150 | 250 |

- **后处理（render/PostFX.ts）**：`RenderPass(HalfFloat HDR) → N8AO → [Bloom → ACES 色调映射 → 色相/饱和度 → 亮度/对比度 → 暗角 → 胶片颗粒] → SMAA`。配合场景 `FogExp2` 和与雾色衔接的渐变天空穹顶。
- **气氛预设（config/atmosphere.ts）**：雾色/浓度、天空、半球光、主光、灯塔暖光、水色、曝光、Bloom、调色、暗角、颗粒、AO、雨——**调氛围只改这个文件**。目前有 `melancholy-dusk`（默认，忧郁阴天黄昏细雨）和 `lonely-night`（孤夜浓雾）。

## 角色控制器与碰撞（v0.1-002）

- **选型：three-mesh-bvh + 自写 move-and-slide**，没用 Rapier。只有一个角色、没有刚体玩法，Rapier 的 wasm（约 2MB）和异步初始化不划算；BVH 只做空间查询，规则全在 `systems/PhysicsSystem.ts`，Node 里能直接单测（`npm run test:physics`）。
- **数值**全部在 `config/gameplay.ts`：胶囊高 1.50 m、半径 0.25 m；慢走 1.6 / 小跑 3.2 m/s（Shift），0.12 s 到速，转身 540°/s；最大坡度 40°，台阶 0.3 m；没有跳跃。
- **悬浮胶囊**：碰撞胶囊底部抬高 0.3 m（台阶高度），脚底高度由 5 根向下的探测射线决定（只认坡度 ≤ 40° 的面）。所以 ≤ 0.3 m 的台阶直接迈上、≥ 0.4 m 挡住；墙和陡坡只做水平推出（贴墙滑动不黏）；中心踩到比脚高的陡坡会撤回并沿坡脚滑开。迈台阶的竖直跳变在显示上用 0.08 s 抹平。
- **自动跨越**：`TraversalLink`（起点、终点、可选中间点、触发半径、条件）。站在起点按 E 或朝终点方向走 → 沿路径平滑移动 1–2 s（路径长 / 1.8 m/s），期间忽略输入。场景里 `player.controller.links.push(link)`，HUD 提示读 `controller.nearLink`。
- **强制送回**：`controller.teleportTo(point, { fade: 0.5 })`：黑场 0.2 s 淡入 → 保持 0.5 s（期间瞬移并落地）→ 0.2 s 淡出，返回 Promise。掉出世界（`physics.killY`）走这个。
- **dev 面板（F4）**：实际水平速度、着地状态、每步碰撞耗时（ms）、碰撞体数量。

### 碰撞体命名（美术 / 关卡）

- 模型里名字以 **`-collider`** 结尾的网格是碰撞体（可以站、会挡）；以 **`-wall`** 结尾的是空气墙（只挡水平移动，站不上去）。Blender 的 `.001` 后缀可以保留。例：`dock-floor-collider`、`stair-collider.003`、`cliff-edge-wall`。
- 这些网格加载后自动隐藏、不参与渲染；用简化的低面数几何（盒子、斜面、楼梯块），**不要**直接拿渲染网格当碰撞体。
- 会动 / 会开关的碰撞体（门、升降台）加自定义属性 `dynamic = true`（glTF extras → `userData.dynamic`）；代码里 `collider.enabled = false` 立即可通过。
- 场景代码：`physics.addFromModel(gltfRoot)` 注册约定命名的网格；灰盒占位用 `physics.addMesh(mesh)` / `addObject(group)` / `addBox(box3)`。

## 第三人称相机（v0.1-003）

`systems/CameraFollowSystem.ts`（在原有类上扩展），数值在 `config/gameplay.ts` 的 `camera` 段（GDD §4）。四种状态：

- **探索**：跟随角色头部 1.35 m、肩后偏右 0.4 m；距离默认 4.0 m，滚轮 2.5–6.0 m；俯仰 -35°（俯视）到 +55°（仰视）。代码里 `cameraFollow.pitch` 现在就是这个俯仰角（负 = 往下看，弧度）。
  - 遮挡：半径 0.2 m 的球形扫掠（`physics.sphereCast`，和角色共用 `-collider` 碰撞体；`-wall` 空气墙不挡相机）。被挡住立即前拉，解除后 0.25 s 缓入缓出恢复。
  - 室内：网格名以 **`-indoor`** 结尾的盒子是室内触发体（`collectIndoorVolumes(root)` 收集并隐藏），角色在里面时最大距离 2.0 m。
  - FOV 55°，小跑 58°（0.3 s 过渡）；按住右键观察 30°，鼠标灵敏度 ×0.5，发 `camera:observe { active, focusDistance }`（焦点 = 屏幕中心射线命中，给 026 景深用）。
  - 自动回正（设置 `autoRecenter`，默认关）：静止 8 s 后以 4°/s 漂向场景的 `cameraFollow.recommended`。
- **机关**：`cameraFollow.enterPuzzleView(node, { freeLook })`，0.6 s 过渡到 **`-cam`** 空节点的位置和朝向（节点 -Z 是视线，Blender 里放一个相机或空物体即可；`userData.fov` 可指定 FOV），默认可 ±20° 小范围转动，机关自己要用鼠标时传 `freeLook: false`。`exitPuzzleView()` 0.6 s 回到进入前的 yaw / pitch。输入上下文（`pushContext('puzzle')`）和锁角色（`controller.locked`）由机关代码负责，参考 `TestbedScene.enterMechanism()`。
- **演出**：`cameraFollow.playCutscene(new CameraTrack({ keys: [{ time, position, lookAt | quaternion, fov }], duration }))`，或 `new CameraTrack({ node })` 跟随 GLB 里由 AnimationMixer 驱动的相机节点。期间输入切到 cutscene（不能移动 / 转视角，按住空格 1 s 跳过），结束后 0.8 s 平滑交还，朝向保持演出前；交还完成时 Promise resolve。换场景时自动中断并交还输入。
- **建立镜头**：`playEstablishing(track)`，主场景进入时 3 s（`MainScene.playEstablishing()` 里配轨道）。
- **观察点**：`ViewpointTarget`（区域中心 + 半径 + 目标点或方向），每帧算 `alignment`：偏差 ≤ 6° 为 1，≥ 12° 为 0，中间线性；不在区域内为 0。谜题和材质直接读它。
- **dev 面板（F4）**：相机模式、当前 / 设定距离、室内、FOV、俯仰；测试场地另有观察点对准度。
- **测试场地**（`?scene=testbed`）：东南角带 1.0 m 窄门的小屋（室内 ≤ 2 m）、西侧底座是测试机关（面向它按 E，右键 / Tab 退出；004 起是 puzzle 交互，见下节）、西南侧地面黄圈是观察点（看向立柱顶的光球，对准时变亮）、C 播放 5 s 测试镜头。校验：`npm run test:camera`。

## 交互系统与机关框架（v0.1-004）

代码在 `src/systems/interaction/`，场景里只做「注册 Interactable + 监听事件」：

```ts
scene.interaction.add(new Interactable({ id: 'bell', kind: 'use', object: bellNode, prompt: 'ui.prompt.ring' }));
game.events.on('interact:used', ({ id }) => { if (id === 'bell') ring(); });
```

- **八种类型**：`inspect`（不暂停，台词走字幕）、`read`（打开阅读界面，005）、`pickup` / `place`（同时只拿一件，只能放到 `-socket` 节点）、`use`（自动走到交互点 ≤ 0.4 s 后发事件）、`hold`（按住 E 2 s，HUD 圆环，中途松开归零）、`push`（按住 E 沿轨道 0.8 m/s，到端点发 `interact:pushEnd` 并锁定）、`puzzle`（进入机关模式）。
- **判定**：水平距离（到物体焦点、减去 `reach`）≤ 1.8 m 且角色朝向夹角 ≤ 60°；多个候选取最靠近屏幕中心的；3.5 m 内画冷色小图标。参数在 `config/gameplay.ts` 的 `interaction` / `puzzle`。
- **交互点**：模型里的 `-interact` 节点（+Z 朝向物体）是 use / hold / push 的站位；没有时取物体 +Z 方向 reach+1 m。走位路径被碰撞体挡住时原地转身，不穿模。
- **机关**：`RotatablePart`（单轴 / 双轴，15° 一档、Shift 7.5°，绝对网格吸附，可设范围）+ `PuzzleGroup`（部件列表 + `-cam` 机位节点）。Q / E 切换（当前部件冷灰描边），R 复位，右键 / Tab 退出；只有一个部件时操作条不显示「Q·E 切换」。暂停时机关不响应，继续后仍在机关里。
- **提示高亮**：`interaction.highlight(['id'], 3)`，暖色描边 3 s 后消失（后续提示系统 H 键调用）。
- **文字**：提示全部来自文本表 `t('ui.prompt.*')`（`src/content/text/`，由 `npm run text:import` 从 `docs/gdd/text-ch1.json` 生成）。
- **事件**：`interact:used / inspect / read / holdProgress / pushMoved / pushEnd`、`item:pickup / place`、`puzzle:enter / exit / partSelected / partRotated / reset`、`highlight:start / end`（`core/EventBus.ts`）。
- **测试场地交互走廊**：`?scene=testbed` 出生点东侧 x = 16 一条南北向通道，东侧依次是 inspect（木箱）、read（告示板）、pickup（底座上的提灯）、place（灯台 A），西侧是 use（钟）、hold（油阀）、place（灯台 B）、push（浮台，向北推 3 m）。demo 主场景的灯塔改为 `use` 交互（站在台座上面向塔按 E）。
- 校验：`npm run test:interaction`；smoke 里有八种交互、hold 圆环、push、机关 Esc→继续→右键退出、灯塔的浏览器端检查。

## 字幕、阅读界面与日志（v0.1-005）

- **文本表**：`docs/gdd/text-ch1.json` → `npm run text:import` → `src/content/text/zh-CN.ts`（ID 原样，`TextId` 联合类型，写错 ID typecheck 报错）。`npm run test:text`：生成结果已提交、代码里引用的 ID 全部存在（缺失 0）、`src/` 与 `index.html` 里没有任何剧情文本（字幕 / 独白 / 查看 / 目标 / 文档 / 提示）≥ 4 个汉字的原句片段。暂停菜单等 UI 杂项里还有少量硬编码 UI 文案，完整设置界面（008）接入时换成 `t('ui.*')`。
- **字幕** `game.ui.subtitles`（`ui/Subtitles.ts`，逻辑在无 DOM 的 `SubtitleTrack`）：`play(['ch1.…'])` 依次播放，每行 max(2.0 s, 字数 × 0.12 s)（字数 = 去掉空白的字符数，标点计入；参数在 `gameplay.narrative`），到时自动下一行，左键 / 空格立即推进；新的 `play` 顶掉旧的（同一时刻只一条）。「只一次」的行显示时写入存档 `seenLines`，以后 `play` 自动跳过。汐 `#E4E8EA`、父亲 `#8B959D`，不显示名字；底部居中、无底框、浅阴影；字号小 / 中 / 大（18 / 22 / 28 px，设置 `subtitleSize`，暂停菜单「字幕大小」，即时生效）。时间走游戏时间：暂停、阅读 / 日志打开时停。
  - 演出（035）：`subtitles.track.setTimeline([{ at: 46, id: 'ch1.intro.line_home', duration: 4 }])`，每帧 `subtitles.playAt(cutsceneTime)`，按时间计算该显示哪条（跳转 / 倒退也对），演出行锁定不可手动推进，期间独白 / 查看被屏蔽；结束 `track.endTimeline()`。
  - `track.playText(text)` 只给自动化测试用（表里没有正好 30 字的行）。
- **阅读界面** `game.ui.reader.open(docId)`（`read` 交互自动调用）：纸张（030 的 `ui-paper-*` 到位前是纯色占位）+ 文字、标题 `ui.doc_title.<对象>`、多页「n / N」和箭头；A·D / ← → 翻页；右键 / Tab 关闭。打开时压 `reading` 上下文（显示光标、无移动轴）并 `game.freeze()`（fixedUpdate / scene.update 不跑，渲染和 UI 照常），背景 `backdrop-filter` 模糊。阅读里 Esc 暂停→继续后仍在阅读界面，第一下右键直接关闭（reading 是自由光标，不需要重新锁定）。
- **已读与日志**（`systems/NarrativeState.ts`，`game.narrative`）：首次打开的文档（类型 doc / journal）按首次阅读顺序写进日志并交给存档 `readDocs`，左下角「日志已更新」2 s（`ui/Toast.ts`）；再读不重复、不提示。没有进行中的存档进度时只记在内存。
- **日志（J）** `game.ui.journal`：顶部「当前目标」（`game.narrative.setGoal('ch1.s1.goal.find_bell')`，只接受 goal 类文本，变化即时刷新），下面「第一章 · 归岸」分组「父亲的日志」「信与纸条」，点条目打开阅读界面（关掉回到日志）；J / 右键 / Tab 关闭。主场景进场时设目标 `ch1.s1.goal.find_bell`，之后由谜题进度（013–015）更新。**当前目标不进存档**（由进度决定，场景入口按进度重设）。
- **结尾第 6 页**：结尾演出（035）调用 `game.narrative.unlockOutroEntry()`，父亲日志（`ch1.s2.journal.doc`，5 页）末尾多出第 6 页 `ch1.outro.journal_entry`；记录在 `seenLines`，读档后仍在。
- **测试场地**：交互走廊东侧 z = 10 的书桌上是父亲日志（5 页）；z = 1 的告示板是单页文档。
- 校验：`npm run test:narrative`（时长 2.0 / 3.6 s、推进、只一次与存档、时间轴、已读 / 不重复 / 存档顺序、目标、第 6 页、全部 ID 可加载、阅读键位、硬编码检查反例）；smoke 里有真实按键 / 点击的整套流程（见 `scripts/smoke-browser.mjs`「v0.1-005」）。

## 资源规范与添加方法

**命名**：小写英文 + 短横线，如 `hero-idle.glb`、`rock-cliff-01.glb`、`ground-diffuse.ktx2`、`sfx-footstep.ogg`、`ui-button-start.webp`。
**位置**：`public/assets/models|textures|audio/`。
**格式**：模型用 GLB（推荐 Draco 或 Meshopt 压缩，贴图内嵌 KTX2）；独立贴图优先 KTX2，其次 WebP；音频 ogg（Safari 兼容可另备 mp3）。
**来源**：外部素材必须记录到 `art/CREDITS.md`、`audio/CREDITS.md`。

添加一个资源：

1. 把文件放进 `public/assets/<类型>/`。
2. 在 `src/assets/manifest.ts` 登记（url 不要以 `/` 开头）：
   ```ts
   { key: 'rock-cliff-01', type: 'gltf', url: 'assets/models/rock-cliff-01.glb', group: 'main', optional: true },
   { key: 'ground-diffuse', type: 'ktx2', url: 'assets/textures/ground-diffuse.ktx2', group: 'main' },
   { key: 'sfx-footstep', type: 'audio', url: 'assets/audio/sfx-footstep.ogg', group: 'main', optional: true },
   ```
   `group` 决定在哪个加载阶段加载（`boot` 启动时、`main` 主场景加载界面）；`optional: true` 表示缺失不报错。法线/粗糙度等非颜色贴图加 `srgb: false`。
3. 在场景里使用：
   ```ts
   const rock = this.game.assets.getModel('rock-cliff-01', 'box');   // 缺失时回退方块占位
   const tex = this.game.assets.getTexture('ground-diffuse');        // 缺失时回退棋盘格
   this.game.audio.playSfx(this.game.assets.getAudio('sfx-footstep'), { freq: 220 }); // 缺失时合成音
   ```

### 顶点色 COLOR_0 = 描边平滑法线

美术 GLB 的 `COLOR_0` **不是颜色**，是给外扩描边（v0.1-023）用的平滑法线：网格本地空间，`n * 0.5 + 0.5` 编码（RGBA8 归一化，A = 1），见 v0.1-index §5.4。
GLTFLoader 看到 COLOR_0 会自动给材质开 `vertexColors`，固有色会被染花，所以 `AssetLoader` 加载后统一处理（`src/assets/vertexColors.ts` 的 `prepareOutlineNormals`）：

- 关掉用到它的材质的 `vertexColors`；几何体的 `color` 属性**保留**，并标 `geometry.userData.outlineNormals = 'color'`，023 的描边着色器读它（`n = color.rgb * 2.0 - 1.0`）。
- 抽样校验：解码后应是单位向量、且与顶点法线同向；不像平滑法线时控制台 `console.warn`（数据不改）。
- 开关：全局 `gameConfig.assets.vertexColorsAreOutlineNormals`（默认 true）；某个资源的 COLOR_0 真的是颜色时，manifest 条目写 `vertexColors: 'color'`。
- 校验：`npm run test:assets`。

### GLB 交付自检

```bash
cd game
node scripts/verify-lod.mjs ../art/models/props/prop-lantern-brass.glb                 # 一个文件
node scripts/verify-lod.mjs ../art/models/props/*.glb ../art/models/characters/*.glb   # 多个
node scripts/verify-lod.mjs ../art/models/props/prop-x.glb --budget=12000              # 手动指定 LOD0 面数上限
node scripts/verify-lod.mjs ../art/models/props/prop-x.glb --json                      # 机器可读输出
```

先直接读 GLB 的 JSON（Meshopt 压缩也能数面），再用游戏同一套 GLTFLoader + `buildLods` + `prepareOutlineNormals` 真正加载一遍。KTX2（`KHR_texture_basisu`）贴图在 Node 里不转码（尺寸从文件头读），加载时给一个空纹理占位。输出 `·` 信息、`!` 警告、`✗` 错误；**有错误退出码 1**，只有警告算通过。

| 检查 | 规则（v0.1-index §5、style-guide §8） | 级别 |
|---|---|---|
| LOD | `<名>_lodN` 分组、各级三角面、缺 `_lod0` / 层级不连续 / 下一级 > 上一级 65%（约定每级减半） | 缺 lod0 错误，其余警告 |
| puzzleCritical | 列出带标记的节点；应在根节点；只交 LOD0（带了低级会被加载器丢弃） | 警告 |
| 特殊节点 | 列出 `-collider` `-wall` `-interact` `-cam` `-indoor` `-emitter` `-socket` `-receiver` `-mirror-plane` `-waterline`；**一律按场景树判断**（从默认场景 `scene.nodes` 往下遍历，和游戏加载后的 `gltf.scene` 一致，BUG-001）：只在 JSON `nodes` 数组里、没挂在场景树上的特殊节点报错且不算数；每个 puzzleCritical 根节点的**子树里**必须有 `-collider` 和 `-interact`（挂在子树外的不算，报错；白石组的 `-interact` 只警告）；`-collider` 要有网格；`-interact` 应为空节点；树外的普通网格节点警告（白占包体） | 错误 / 警告 |
| extras `pivot` | 任何节点的 extras（Blender 自定义属性）里出现键名 `pivot` 一律报错：three 的 GLTFLoader 会把带 `userData.pivot` 的节点当成 GLTFExporter 的枢轴容器重建（位置减 pivot、第一个子节点归零），值不是数组时位置直接变 NaN。美术约定改用 `originAt`。加载后任何节点位置 / 旋转 / 缩放含 NaN 也报错 | 错误 |
| COLOR_0 | 每个渲染网格是否带；puzzleCritical 缺了是错误、角色 / 道具缺了警告；加载后抽样校验是平滑法线，且没有材质还开着 vertexColors | 错误 / 警告 |
| 面数预算 | puzzleCritical：风灯 8k、潮汐钟 20k、白石组 20k、钥匙 3k、其余 15k（LOD0）；角色：`char-xi` 120k / 50k / 25k，`char-father` 60k / 25k，其余 NPC 60k / 40k / 25k（逐级）；环境物体只显示占场景静态份额（LOD0 4M / LOD1 2.3M / LOD2 1M）的百分比。`--budget=N` 覆盖 | 错误 |
| 其他 | 没用 Meshopt；材质 > 3 个或不按 `mat-char/env/prop-*` 命名；贴图尺寸（角色 ≤ 4096，其余 ≤ 2048）和非 KTX2 格式 | 尺寸超限错误，其余警告 |

压缩工具（美术侧）：`npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress ktx2`；单张贴图可用 KTX-Software 的 `toktx --t2 --encode uastc`（法线）/ `--encode etc1s`（颜色）。
DRACO / Basis 解码器由 three 随包打包（带哈希文件名、可离线），无需额外配置。
- DRACO 只用 **glTF 专用 wasm 解码器**（`draco_wasm_wrapper.js` 58KB + `draco_decoder.wasm` 192KB）。three 的 DRACOLoader 还静态引用了通用版 wasm（286KB）和纯 JS 回退（719KB），运行时只会用其中一套；`vite.config.ts` 的 `threeDecodersWasmOnly` 插件在构建时去掉另外两套（WebGL2 浏览器都支持 WebAssembly，不需要 JS 回退）。
- KTX2 的 `basis_transcoder.js` + `basis_transcoder.wasm` 是同一套转码器的胶水代码和二进制，两个都要。
- `npm run smoke` 会检查 dist 里两种解码器各只有一套，并在浏览器里实际跑一次。

目前 manifest 里登记了 `hero`（`assets/models/hero.glb`，尚不存在），用来演示缺失回退：控制台会出现一条 info 日志，主角显示为胶囊。美术交付 `hero.glb`（脚底为原点、朝向 +Z、单位米、身高约 1.5m，与碰撞胶囊一致）后会自动替换。

## LOD 与解谜关键物体（puzzleCritical）

约定来自 `art/style/style-guide.md` §8。实现在 `src/render/lod.ts`，GLB 加载时自动处理（`AssetLoader` → `buildLods`），场景在切换画质时调用 `applyLodDistances`。

### LOD 命名

- 同一个模型的各级 LOD 放在**同一个 GLB 里、同一个父级下**，物体名以 `_lod0`、`_lod1`、`_lod2` 结尾（`-lod1` 也认；Blender 自动加的 `.001` 后缀会被忽略）。名字其余部分仍按资源命名规范：小写英文 + 短横线，例如 `rock-cliff-a_lod0`。
- 每级面数约减半；各级的原点和朝向要一致（加载后会组装成一个 `THREE.LOD`，名字为 `rock-cliff-a`，放在 `_lod0` 的位置）。
- 只有 `_lod0` 没有其他级别也可以（就当普通模型）。
- 切换距离按画质档位，配置在 `src/config/quality.ts` 的 `lodDistances`：

| 档位 | `lodDistances` [LOD0, LOD1, LOD2]（米） | 含义 |
|---|---|---|
| ultra | [60, 150, 400] | 60 m 内 LOD0，60–150 m LOD1，150 m 以外 LOD2 |
| high | [40, 100, 250] | 同上 |
| standard | [25, 60, 150] | 标准档 LOD0 只到 25 m，最容易把关键物体降级 |

  第 3 个值（LOD2 的最远距离）预留给以后的 impostor，目前超过后继续显示 LOD2。

### 解谜关键物体：固定 LOD0

解谜时必须看清形状、图案或刻度的物体（白漆石块、潮汐钟刻度、光感锁透镜、点火口、反射镜……）要标 `puzzleCritical`。带标记的物体**及其整个子树**在三档都固定 LOD0：加载时直接丢弃并释放低级 LOD，切换画质也不会变。

**Blender 里怎么设置**（Blender 3.6 / 4.x）：

1. 选中物体 → 右侧「物体属性」（橙色方块图标）→ 展开「自定义属性 Custom Properties」→ 点「新建 New」。
2. 点新属性右边的齿轮编辑：名称 `puzzleCritical`（大小写一致），类型选「布尔 Boolean」，勾选为真。（老版本只有数字类型时填 `1` 也可以。）
3. 设在哪里都行：
   - 设在各级 LOD 的**父级空物体**上（推荐：一次覆盖整个子树）；或者
   - 只设在 `_lod0` 物体上（同组的其他级别会一起被视为关键物体）。
   - 注意要设在「物体」上，不要设在「网格数据」（绿色三角图标）上，网格数据的属性不会进节点 extras。
4. 导出：文件 → 导出 → glTF 2.0，格式选 glTF Binary（.glb），在「包含 Include → 数据 Data」里**勾选「自定义属性 Custom Properties」**。不勾的话标记不会被导出。
5. 导出的 GLB 里该节点会有 `"extras": { "puzzleCritical": true }`，three 加载后在 `object.userData.puzzleCritical`。可以把 GLB 拖进 https://gltf.report 查看节点 extras 确认。

代码里运行时才决定的关键物体，用 `markPuzzleCritical(obj)` 把它的 LOD 折叠成 LOD0；仅设置 `userData.puzzleCritical = true` 时，`applyLodDistances` 也会兜底强制 LOD0。

### 用例与校验

- 测试模型 `public/assets/models/test-lod-puzzle-critical.glb`（`npm run assets:test-lod` 用 @gltf-transform 生成）：
  - `white-stone`：白石，标记在父级空物体上 → 固定 LOD0；
  - `tide-gauge_lod0..2`：刻度柱，只在 lod0 上标记 → 固定 LOD0；
  - `rock-control_lod0..2`：普通对照石 → 按档位切换（LOD1 偏绿、LOD2 偏红，方便肉眼看出切换）。
- demo 场景出生点左前方摆了这组物体（`MainScene.buildLodTest`）。开发模式控制台运行 `__lods()` 查看层级；把物体推远后切换画质可以看到对照石切换、白石不变：
  ```js
  __game.scenes.current.scene.getObjectByName('lod-test').position.z -= 40; __lods()
  __game.quality.set('standard'); __lods()   // rock-control:1，white-stone / tide-gauge:0
  ```
- 美术交付的 GLB 用 `node scripts/verify-lod.mjs <文件>` 自检（见「GLB 交付自检」）。
- `npm run test`：用真实 GLTFLoader 解析测试 GLB，校验 extras → userData、低级 LOD 被丢弃并释放、三档距离下对照石的层级，以及运行时标记的兜底。

## 以后打包成 App / PC

工程已为原生壳做好准备：相对路径构建、解码器随包、无外部 CDN 依赖、`src/platform/native.ts` 为唯一原生适配点（返回键、退出、震动等，游戏代码不直接引用原生 SDK）。

**Electron（Windows / macOS / Linux 桌面）**
1. `npm i -D electron electron-builder`，新建 `electron/main.cjs`：创建 `BrowserWindow`，`loadFile('dist/index.html')`，或用 `protocol.handle` 注册自定义 `app://` 协议加载 dist（推荐，避免 file:// 下 wasm/模块限制）。
2. 在 preload 中用 `contextBridge.exposeInMainWorld('electronAPI', { quit, setFullscreen })`，`native.ts` 已按 `window.electronAPI` 对接。
3. `npm run build && electron-builder` 打包。也可考虑 Tauri（体积更小）。

**Capacitor（iOS / Android，如以后需要）**
1. `npm i @capacitor/core @capacitor/cli @capacitor/app && npx cap init`，`webDir` 设为 `dist`。
2. `npx cap add android` / `ios`，之后每次 `npm run build && npx cap sync`。
3. 在 `native.ts` 的 TODO 处接入 `App.addListener('backButton')`、`App.exitApp()`、Haptics 等。
4. 当前画质预设只为桌面调校，上移动端前需要新增移动档位并重新做性能测试。

## 已知限制

- 角色物理只处理一个胶囊角色和静态 / 运动学碰撞体，没有刚体（推箱子之类需要时再加）。碰撞耗时目标 ≤ 0.5 ms / 帧：Node 里测试场地约 0.03–0.05 ms / 步，1440p 有 GPU 的机器上还没实测。
- 相机遮挡只对 `-collider` 碰撞体做球形扫掠（渲染网格不参与），美术模型的遮挡体要靠碰撞网格覆盖；建立镜头轨道是占位构图，等关卡定稿后由策划 / 美术调。
- 水面/天空/灯塔/雨均为程序化占位，等美术正式资源。
- LOD 目前只认「同一个 GLB 内 `_lodN` 节点」；style-guide §9 里的分文件写法（`char-xi-lod1.glb`）和远景 impostor 还没实现，超过 LOD2 距离后继续显示 LOD2。
- `PCFSoftShadowMap` 在 three r18x 已移除，软阴影使用 `PCFShadowMap` + `shadow.radius`。
