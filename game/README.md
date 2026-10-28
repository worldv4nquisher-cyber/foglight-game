# 失落灯塔群岛 · 游戏工程（game/）

3D 网页游戏，Three.js + TypeScript + Vite。第三人称探索解谜，三渲二半写实，**桌面浏览器优先、极致画质、忧郁氛围**。
手机不是目标平台，但保留了基础触屏输入抽象（虚拟摇杆 + 滑动转视角 + 跳跃键），以后需要时可以直接启用。

> 当前是 v0.1 框架 + 占位 demo：阴暗海岛、起伏水面、岩石、自动旋转的占位立方体、胶囊占位角色、灯塔暖光、细雨、后处理氛围。

## 环境与命令

需要 Node.js ≥ 20（已在 Node 24 验证）。

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发服务器 http://localhost:5173（热更新，左上角显示 FPS） |
| `npm run dev:host` | 同上，并在局域网开放（别的电脑访问本机 IP:5173） |
| `npm run build` | 类型检查 + 生产构建，输出 `dist/`（可静态部署） |
| `npm run preview` | 本地预览 `dist/`（http://localhost:4173） |
| `npm run typecheck` | TypeScript 严格模式检查（src + vite.config） |
| `npm run lint` / `lint:fix` | ESLint（flat config + typescript-eslint 类型感知规则） |
| `npm run check` | typecheck + lint + build 一次跑完（提交前跑） |

`dist/` 使用相对路径（`vite base: './'`），可以放到任意静态服务器的任意子目录，也可以被 Capacitor / Electron 以本地文件加载。
注意：直接双击 `dist/index.html`（file://）浏览器会拦截 ES 模块和 wasm，请用 `npm run preview` 或任意静态服务器打开。

### 调试参数（URL）

| 参数 | 说明 |
|---|---|
| `?quality=ultra\|high\|standard` | 强制画质档位（优先于玩家设置和自动检测） |
| `?postfx=0` | 关闭后处理，直接渲染（排查渲染问题） |
| `?atmo=lonely-night` | 切换气氛预设（默认 `melancholy-dusk`） |

开发模式下控制台可用 `__game`，如 `__game.quality.set('ultra')`。

## 操作

| 操作 | 键鼠 | 触屏（保留） |
|---|---|---|
| 移动 | WASD / 方向键，Shift 快走 | 左半屏浮动摇杆 |
| 跳跃 | 空格 | 右下角「跳」 |
| 转视角 | 按住鼠标拖拽 | 右半屏滑动 |
| 互动 | E（灯塔附近：熄灭/点亮） | — |
| 暂停菜单 | Esc / P | — |
| 显示/隐藏 FPS | F3 | — |

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
│  ├─ render/               PostFX 后处理管线（postprocessing + N8AO）
│  ├─ world/                场景构件：SkyDome、Water、Rain、Lighthouse（占位）
│  ├─ assets/               AssetLoader（GLB+DRACO+Meshopt+KTX2、纹理、音频）、manifest、placeholders
│  ├─ config/               gameConfig（数值）、quality（画质三档）、atmosphere（气氛预设）
│  ├─ ui/                   UIManager、LoadingScreen、Hud、PauseMenu、FpsCounter、styles.css
│  ├─ platform/             device 检测、可见性、全屏、native（Capacitor/Electron 适配点）
│  └─ types/                第三方库类型声明（n8ao）
├─ eslint.config.js / tsconfig.json / tsconfig.node.json / vite.config.ts
└─ dist/                    构建产物（不提交）
```

代码规范：TypeScript `strict` + `noUncheckedIndexedAccess`；`@/` 指向 `src/`；类型导入用 `import type`；不允许悬空 Promise。

## 核心架构

- **主循环（core/Game.ts）**：每帧 `input.beginFrame → N 次 fixedUpdate(1/60s，逻辑/物理) → update(可变步长：相机/动画) → render → ui.update → input.endFrame`。单帧时长截断 0.25s，切后台自动暂停。KinematicBody 按 alpha 插值显示，高刷屏也平滑。
- **场景（scenes/）**：`SceneManager.change(name)` 依次 `exit → dispose → new → enter(可异步)`。流程 Boot（启动资源）→ Loading（进度条，加载 `main` 资源组）→ Main。`usePostFX=true` 的场景走后处理。
- **输入（systems/input/）**：玩法代码只认抽象 action（`jump/pause/interact/sprint/toggleFps` 和轴 `moveX/moveY` + 视角增量），键鼠与触屏都写入同一个 InputManager。新增操作：在 `actions.ts` 加 action 和键位即可。指针锁定（FPS 式视角）可在 `gameConfig.input.pointerLock` 开启，默认拖拽。
- **资源（assets/）**：见下节。缺失或加载失败一律回退占位几何体/棋盘格纹理，游戏照常运行。
- **画质（config/quality.ts）**：纯桌面三档，对应美术风格指南的「极致/高/标准」。按 GPU 名称粗判（独显 RTX 3060 级以上 → 极致；核显/软件渲染 → 标准；其余 → 高），玩家在暂停菜单切换后会记住。

  | 档位 | 像素比上限 | AO（N8AO） | 阴影贴图 | 软阴影半径 | 雨滴 | 视距 |
  |---|---|---|---|---|---|---|
  | ultra 极致 | 2 | High，全分辨率 | 4096 | 3 | 6000 | 400 |
  | high 高（默认） | 1.5 | Medium，半分辨率 | 2048 | 2.5 | 3500 | 300 |
  | standard 标准 | 1 | 关 | 1024 | 2 | 1500 | 200 |

- **后处理（render/PostFX.ts）**：`RenderPass(HalfFloat HDR) → N8AO → [Bloom → ACES 色调映射 → 色相/饱和度 → 亮度/对比度 → 暗角 → 胶片颗粒] → SMAA`。配合场景 `FogExp2` 和与雾色衔接的渐变天空穹顶。
- **气氛预设（config/atmosphere.ts）**：雾色/浓度、天空、半球光、主光、灯塔暖光、水色、曝光、Bloom、调色、暗角、颗粒、AO、雨——**调氛围只改这个文件**。目前有 `melancholy-dusk`（默认，忧郁阴天黄昏细雨）和 `lonely-night`（孤夜浓雾）。

## 资源规范与添加方法

**命名**：小写英文 + 短横线，如 `hero-idle.glb`、`rock-cliff-01.glb`、`ground-diffuse.ktx2`、`sfx-jump.ogg`、`ui-button-start.webp`。
**位置**：`public/assets/models|textures|audio/`。
**格式**：模型用 GLB（推荐 Draco 或 Meshopt 压缩，贴图内嵌 KTX2）；独立贴图优先 KTX2，其次 WebP；音频 ogg（Safari 兼容可另备 mp3）。
**来源**：外部素材必须记录到 `art/CREDITS.md`、`audio/CREDITS.md`。

添加一个资源：

1. 把文件放进 `public/assets/<类型>/`。
2. 在 `src/assets/manifest.ts` 登记（url 不要以 `/` 开头）：
   ```ts
   { key: 'rock-cliff-01', type: 'gltf', url: 'assets/models/rock-cliff-01.glb', group: 'main', optional: true },
   { key: 'ground-diffuse', type: 'ktx2', url: 'assets/textures/ground-diffuse.ktx2', group: 'main' },
   { key: 'sfx-jump', type: 'audio', url: 'assets/audio/sfx-jump.ogg', group: 'main', optional: true },
   ```
   `group` 决定在哪个加载阶段加载（`boot` 启动时、`main` 主场景加载界面）；`optional: true` 表示缺失不报错。法线/粗糙度等非颜色贴图加 `srgb: false`。
3. 在场景里使用：
   ```ts
   const rock = this.game.assets.getModel('rock-cliff-01', 'box');   // 缺失时回退方块占位
   const tex = this.game.assets.getTexture('ground-diffuse');        // 缺失时回退棋盘格
   this.game.audio.playSfx(this.game.assets.getAudio('sfx-jump'), { freq: 220 }); // 缺失时合成音
   ```

压缩工具（美术侧）：`npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress ktx2`；单张贴图可用 KTX-Software 的 `toktx --t2 --encode uastc`（法线）/ `--encode etc1s`（颜色）。
DRACO / Basis 解码器由 three 随包打包（带哈希文件名、可离线），无需额外配置。

目前 manifest 里登记了 `hero`（`assets/models/hero.glb`，尚不存在），用来演示缺失回退：控制台会出现一条 info 日志，主角显示为胶囊。美术交付 `hero.glb`（脚底为原点、朝向 +Z、单位米、身高约 1.8m）后会自动替换。

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
- `PCFSoftShadowMap` 在 three r18x 已移除，软阴影使用 `PCFShadowMap` + `shadow.radius`。
