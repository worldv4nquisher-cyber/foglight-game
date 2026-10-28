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
| `npm run test` | LOD / puzzleCritical 校验脚本（`scripts/verify-lod.mjs`） |
| `npm run assets:test-lod` | 重新生成 LOD 测试模型 `public/assets/models/test-lod-puzzle-critical.glb` |
| `npm run check` | typecheck + lint + test + build 一次跑完（提交前跑） |
| `npm run smoke` | 无头 Chrome 冒烟测试：对 `dist/` 起 preview 服务，打开 `?smoke=1`，跑页面内检查并汇总控制台错误（先 `npm run build`；需本机 Chrome，可用 `CHROME=路径` 指定） |

`dist/` 使用相对路径（`vite base: './'`），可以放到任意静态服务器的任意子目录，也可以被 Capacitor / Electron 以本地文件加载。
注意：直接双击 `dist/index.html`（file://）浏览器会拦截 ES 模块和 wasm，请用 `npm run preview` 或任意静态服务器打开。

### 调试参数（URL）

| 参数 | 说明 |
|---|---|
| `?quality=ultra\|high\|standard` | 强制画质档位（优先于玩家设置和自动检测） |
| `?postfx=0` | 关闭后处理，直接渲染（排查渲染问题） |
| `?atmo=lonely-night` | 切换气氛预设（默认 `melancholy-dusk`） |

开发模式下控制台可用 `__game`，如 `__game.quality.set('ultra')`；`__lods()` 列出 LOD 测试物体的当前层级。

## 操作

键位按「输入上下文」区分（`src/systems/input/actions.ts`，GDD §3）。本作不做跳跃（GDD §15）。

| 操作 | 探索 explore | 机关 puzzle | 阅读 reading | 演出 cutscene |
|---|---|---|---|---|
| 移动 / 旋转部件 | WASD / 方向键 | A/D 旋转（W/S 预留） | — | — |
| 小跑 / 精调 | 按住 Shift 小跑 | 按住 Shift 精调 | — | — |
| 转视角 | 点击画面锁定鼠标后直接移动（不支持指针锁定时按住左键拖拽） | 小范围转镜头 | 显示光标 | — |
| 交互 | E | — | — | — |
| 切换部件 | — | Q / E，滚轮上 / 下 | — | — |
| 相机远近 | 滚轮 | — | — | — |
| 观察 | 按住右键 | — | — | — |
| 退出机关 / 关闭阅读 | — | 右键 / Tab | 右键 / Tab | — |
| 重置机关 | — | R | — | — |
| 提示 / 日志 | H / J | H | — | — |
| 推进字幕 | 左键 / 空格 | 空格 | 左键 / 空格 | 左键 / 空格；按住空格 1 秒跳过 |
| 暂停 | Esc（任何时候） | Esc | Esc | Esc |

- Esc 永远是暂停（制作人裁定：指针锁定时 Esc 先被浏览器用来解锁，页面不一定收到按键）。暂停后点「继续」或再按 Esc，再点一下画面重新锁定鼠标。
- 开发模式或 URL 加 `?debug=1`：F3 帧率，F4 调试面板（输入上下文栈、指针状态、最近触发的 action）。控制台 `__game.input.pushContext('puzzle')` 可手动切上下文试键位，`__game.input.debug = true` 在控制台打印每个 action。
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
│  ├─ entities/             轻量 ECS：Entity + Component（KinematicBody、PlayerController、Spinner…）
│  ├─ systems/              PhysicsSystem（AABB）、CameraFollowSystem（第三人称）、AudioSystem、input/
│  │  └─ input/             actions（抽象动作 + 键位）、InputManager、KeyboardMouseInput、TouchInput
│  ├─ render/               PostFX 后处理管线（postprocessing + N8AO）、lod（LOD 组装 + puzzleCritical）
│  ├─ world/                场景构件：SkyDome、Water、Rain、Lighthouse（占位）
│  ├─ assets/               AssetLoader（GLB+DRACO+Meshopt+KTX2、纹理、音频）、manifest、placeholders
│  ├─ config/               gameConfig（数值）、quality（画质三档）、atmosphere（气氛预设）
│  ├─ ui/                   UIManager、LoadingScreen、Hud、PauseMenu、FpsCounter、styles.css
│  ├─ platform/             device 检测、可见性、全屏、native（Capacitor/Electron 适配点）
│  └─ types/                第三方库类型声明（n8ao）
├─ scripts/                Node 脚本：gen-lod-test-asset（生成测试 GLB）、verify-lod（校验）
├─ eslint.config.js / tsconfig.json / tsconfig.node.json / vite.config.ts
└─ dist/                    构建产物（不提交）
```

代码规范：TypeScript `strict` + `noUncheckedIndexedAccess`；`@/` 指向 `src/`；类型导入用 `import type`；不允许悬空 Promise。

## 核心架构

- **主循环（core/Game.ts）**：每帧 `input.beginFrame → N 次 fixedUpdate(1/60s，逻辑/物理) → update(可变步长：相机/动画) → render → ui.update → input.endFrame`。单帧时长截断 0.25s，切后台自动暂停。KinematicBody 按 alpha 插值显示，高刷屏也平滑。
- **场景（scenes/）**：`SceneManager.change(name)` 依次 `exit → dispose → new → enter(可异步)`。流程 Boot（启动资源）→ Loading（进度条，加载 `main` 资源组）→ Main。`usePostFX=true` 的场景走后处理。
- **输入（systems/input/）**：玩法代码只认抽象 action（`interact/sprint/partNext/exitPuzzle/advance/skipHold/pause…` 和轴 `moveX/moveY` + 视角 / 滚轮增量），输入源只写原始按键，由 InputManager 按上下文栈（`InputContext.ts`，`input.pushContext('puzzle')` 返回弹出函数）映射。新增操作：在 `actions.ts` 加 action 并在对应上下文配键位。灵敏度 / Y 反转：`input.setLookSensitivity()` / `setInvertY()`。指针锁定默认开启（`gameConfig.input.pointerLock`）。校验：`npm run test:input`。
- **资源（assets/）**：见下节。缺失或加载失败一律回退占位几何体/棋盘格纹理，游戏照常运行。
- **画质（config/quality.ts）**：纯桌面三档，对应美术风格指南的「极致/高/标准」。档位存在设置里；首次启动按 GPU 名称粗判一次（独显 RTX 3060 级以上 → 极致；核显/软件渲染 → 标准；其余 → 高）并记下，之后不再自动改（v0.1-009 换成实测基准）。玩家手动切换随时生效。URL `?quality=high` 临时覆盖。
- **存档 / 设置（systems/save/）**：`game.save`（`foglight.save.v1`，单存档位，进入带 `savePoint` 的场景时自动存档，只记场景入口；游玩时间每 10 秒累加）与 `game.settings`（`foglight.settings.v1`，新游戏不清除，`settings.set()` 立即生效并写盘；旧键 `game.quality` 首次启动迁移后删除）。坏存档（版本不符 / JSON 坏）→ `save.status === 'corrupt'`、提示「存档无法读取」；localStorage 不可写 → `save.writable === false`、提示「进度不会保存」，游戏照常。主菜单（008）做好前，启动时有存档就直接「继续」，提示用 HUD 右下角小字显示。清档：控制台 `localStorage.clear()`。校验：`npm run test:save`。

  | 档位 | 像素比上限 | AO（N8AO） | 阴影贴图 | 软阴影半径 | 雨滴 | 视距 |
  |---|---|---|---|---|---|---|
  | ultra 极致 | 2 | High，全分辨率 | 4096 | 3 | 6000 | 400 |
  | high 高（默认） | 1.5 | Medium，半分辨率 | 2048 | 2.5 | 3500 | 300 |
  | standard 标准 | 1 | 关 | 1024 | 2 | 1500 | 200 |

- **后处理（render/PostFX.ts）**：`RenderPass(HalfFloat HDR) → N8AO → [Bloom → ACES 色调映射 → 色相/饱和度 → 亮度/对比度 → 暗角 → 胶片颗粒] → SMAA`。配合场景 `FogExp2` 和与雾色衔接的渐变天空穹顶。
- **气氛预设（config/atmosphere.ts）**：雾色/浓度、天空、半球光、主光、灯塔暖光、水色、曝光、Bloom、调色、暗角、颗粒、AO、雨——**调氛围只改这个文件**。目前有 `melancholy-dusk`（默认，忧郁阴天黄昏细雨）和 `lonely-night`（孤夜浓雾）。

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

压缩工具（美术侧）：`npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress ktx2`；单张贴图可用 KTX-Software 的 `toktx --t2 --encode uastc`（法线）/ `--encode etc1s`（颜色）。
DRACO / Basis 解码器由 three 随包打包（带哈希文件名、可离线），无需额外配置。
- DRACO 只用 **glTF 专用 wasm 解码器**（`draco_wasm_wrapper.js` 58KB + `draco_decoder.wasm` 192KB）。three 的 DRACOLoader 还静态引用了通用版 wasm（286KB）和纯 JS 回退（719KB），运行时只会用其中一套；`vite.config.ts` 的 `threeDecodersWasmOnly` 插件在构建时去掉另外两套（WebGL2 浏览器都支持 WebAssembly，不需要 JS 回退）。
- KTX2 的 `basis_transcoder.js` + `basis_transcoder.wasm` 是同一套转码器的胶水代码和二进制，两个都要。
- `npm run smoke` 会检查 dist 里两种解码器各只有一套，并在浏览器里实际跑一次。

目前 manifest 里登记了 `hero`（`assets/models/hero.glb`，尚不存在），用来演示缺失回退：控制台会出现一条 info 日志，主角显示为胶囊。美术交付 `hero.glb`（脚底为原点、朝向 +Z、单位米、身高约 1.8m）后会自动替换。

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

- 物理为 AABB 简易碰撞（够做原型），旋转物体的碰撞盒会偏大；需要斜坡、精确胶囊碰撞时换 Rapier。
- 水面/天空/灯塔/雨均为程序化占位，等美术正式资源。
- LOD 目前只认「同一个 GLB 内 `_lodN` 节点」；style-guide §9 里的分文件写法（`char-xi-lod1.glb`）和远景 impostor 还没实现，超过 LOD2 距离后继续显示 LOD2。
- `PCFSoftShadowMap` 在 three r18x 已移除，软阴影使用 `PCFShadowMap` + `shadow.radius`。
