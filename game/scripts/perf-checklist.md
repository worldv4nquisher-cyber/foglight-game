> box 上是无头 Chrome + swiftshader 软件渲染，帧率 / 帧时间 / GPU 开销 / 着色器编译卡顿 / 真实显存都量不准。下面是**制作人桌面真 GPU 实测清单**：**RTX 3060 · 2560×1440 · 极致档 · 目标 60 fps**（GDD §14）。结果填到下面「记录表」，帧率栏最终由用户 M8 实机复填到第 1 节；发现问题记 `docs/bugs/`。

### 0 准备（一次）
- 本地自检包（**不是发布版**，发布须用户确认）：`cd /workspace/game-studio/game && npm run build && npx vite preview`，打开 `http://localhost:4173/`（或测试包地址）。
- 浏览器全屏（F11）到 2560×1440，Windows 缩放 100%（不是 100% 时实际渲染分辨率会变，记下来）；关掉其它标签页 / 录屏软件；笔记本插电、独显。
- `chrome://gpu` 确认「WebGL2: Hardware accelerated」，记下 GPU 型号、驱动版本、Chrome 版本。

**URL 参数**（可组合，`&` 连接）：

| 参数 | 作用 |
|---|---|
| `quality=ultra` / `high` / `standard` | 锁定画质档（URL 优先，跳过 S1 自动检测降档） |
| `smoke=1&art=1` | 控制台挂出 `__game` / `__s3` / `__perfSpot`。**`smoke=1` 必须配 `art=1`**，否则是白盒（数字无效） |
| `debug=1` | 打开 F3 详细面板（FPS · 帧时间 · draw call / 三角面对照 §8 预算 · 显存估算），并允许 `scene=` 直接进场景 |
| `scene=s1` / `s2` / `s3` | 跳过主菜单直接进场景（要 `debug=1`） |
| `reflect=off` / `0.5` / `1` | S1 水面平面反射：关 / 反射 RT 分辨率倍率（不加 = 按档：极致 1、高 0.5、标准 0.25）。**注意：这是分辨率，不是反射强度**，强度（水面混合系数）不受影响 |
| `postfx=0` | 关后处理（只用于排查是否后处理吃帧，不进结论） |

- 标准测试地址（下面简称 **U**）：`http://localhost:4173/?smoke=1&art=1&debug=1&quality=ultra&scene=s1`（换档改 `quality=`，换场景改 `scene=`）。进场后按 **F3** 开面板。

**控制台命令**：

| 命令 | 作用 |
|---|---|
| `__perfSpot('?')` | 列出当前场景的预算机位（来自 `game/src/config/perf-spots.ts`，和 box 上 verify-budget 同一套 eye / at / fov） |
| `__perfSpot('s1-raft-back')` | 把相机钉到该机位：时间照走（水 / 雾 / 灯束在动），只停跟随相机 |
| `__perfSpot()` | 松开，回到玩家相机 |
| `__game.quality.set('high')` | 运行中切档（正式记录仍以 URL `quality=` 重开为准） |
| `__game.flow.goToLevel('s2')` | 跳场景（内存来回切测试用） |
| `__game.scenes.current.reflection.debugLine()` | S1 反射 pass 当前读数：RT 尺寸 × 倍率 · draw call · 三角面 · CPU 提交 ms · 强度 k |
| `__s3.lightTheLamp()` | S3 直接开结尾演出 |

### 1 机位（每个场景 3 个面数最差 + 补充位；box 上的面数 / draw call 见本报告第 2 节）
- **S1**：`s1-raft-back`（draw call 最多）、`s1-neighbor-note`、`s1-spawn-north`、`s1-opening`（025 开场大景，反射最重）
- **S2**：S2_SPOTS
- **S3**：S3_SPOTS

### 2 每格记哪些指标
钉好机位后等 5 s（着色器 / 贴图上传完），DevTools → Performance 录 10 s（不勾 Screenshots），从 Frames / Summary 读：
1. **平均 FPS**；2. **1% low**（最慢 1% 帧的 FPS；或记最长 3 帧的 ms）；3. **平均帧时间 ms**；4. **> 16.7 ms 和 > 33 ms 的长帧个数**；5. **GPU 时间**（Performance 面板 GPU 轨道，看得到就记）；
6. F3 面板上的 **draw call / 三角面 / 显存≈**（截图留证，文件名 `<机位>-<档>[-reflect<值>].png`）。

### 3 测试项
- [ ] **A1 极致档（`quality=ultra`）· 全部机位**：S1 / S2 / S3 用 `__perfSpot` 走完第 1 节全部机位，按第 2 节记。另外每个场景不钉机位正常走一遍，记整段平均 FPS 和最低值（F3 目测）。**目标：每个机位平均 ≥ 60 fps，1% low ≥ 50 fps**
- [ ] **A2 高档（`quality=high`）**：每场景面数最高的 1 个机位（S1 `s1-raft-back`、S2 S2_TOP、S3 S3_TOP）
- [ ] **A3 水面反射开销对比（S1，极致档）**：`s1-opening` 和 `s1-raft-back` 两个机位，各用 `reflect=off`、`reflect=0.5`、`reflect=1` 三个地址重开（例：`U&reflect=off`），每次都按第 2 节记，并在控制台记一行 `__game.scenes.current.reflection.debugLine()`。填「反射对比表」。用途：反射默认强度用户还没定（制作人拿 off / 0.5 / 1 对比图问用户），这组数字给出每一档的真实 GPU 代价。box 参考：反射 pass +45～72 draw call、+2.8 M 三角面（off → 开）；0.5 / 1 的差别只在 RT 像素数（1440p 下 1280×720 vs 2560×1440，4 倍像素）
- [ ] **A4 S3 结尾演出**：`U` 改 `scene=s3`，控制台 `__s3.lightTheLamp()`；Performance 录全程，记 05 过肩写日志、06 / 07 拉远出海各段 FPS，以及**第一次**播放有没有 > 100 ms 的长帧（着色器编译）
- [ ] **A5 卡顿**：正常流程切场景（S1→S2→S3）、开机关、第一次进 S3 演出时有没有 > 100 ms 长帧，记位置和时长
- [ ] **A6（有 GTX 1650 级机器时）1920×1080 · 标准档**：S1 / S2 / S3 面数最高机位各一个，是否 ≥ 30 fps 稳定可玩（GDD §14 最低配置）
- [ ] **B 浏览器兼容**（WebGL2，本项目不走 WebGPU；每款最新版用 `http://localhost:4173/` 不加参数完整通关一次）：Chrome、Edge（Windows）；Firefox（Windows，KTX2 走 BC，注意贴图发黑 / 发紫、Pointer Lock 退出）；Safari（macOS Apple Silicon，KTX2 走 ASTC / ETC2，首次点击前无声、全屏 / 指针锁定、半精度 RT 色带）。每款记：能否通关、画面差异截图、控制台报错前 20 行、字体、自动检测给的档位
- [ ] **C 显存 / 内存**：Chrome 任务管理器（Shift+Esc，右键勾「GPU 内存」）：进 S1 稳定后记标签页内存 + GPU 内存 → 通关（S1→S2→S3→结尾→主菜单）→ 再进 S1 稳定后再记，应在 ±10% 内（box 估算见第 5 节）。另在 `U` 下 `__game.flow.goToLevel('s2')` / `('s1')` 来回 5 次，看 GPU 内存是否持续上涨
- [ ] **D 加载**：DevTools → Network 勾 Disable cache，打开测试包地址：主菜单出现时间（目标 ≤ 3 s）、点「新游戏」到 S1 可操作的时间、Network 底部总传输量；记网络条件（本机 / 局域网 / CDN、带宽）
- [ ] **E 视觉复核**：`quality=high` 下 S3 结尾 05 过肩写日志，汐（LOD1）的脸、手、钢笔握持能否接受（box 对比图 `docs/tasks/shots-035/pen-lod1/*-lod0-vs-lod1.png`，测量 LOD1 不穿插）；S1 沙斑压平后原浪块位置的软边亮斑动起来是否闪烁

### 4 记录表（复制到 v0.1-perf-report-m8.md 填写）
机器：GPU ＿＿ / 驱动 ＿＿ / CPU ＿＿ / Chrome ＿＿ / 分辨率 2560×1440 / 缩放 ＿＿

| 场景 | 机位 | 档 | 平均 FPS | 1% low | 平均帧时间 ms | >16.7 / >33 ms 帧数 | GPU ms | F3 draw call / 三角面 / 显存≈ | 备注 |
|---|---|---|---|---|---|---|---|---|---|
PERF_ROWS

**反射对比表（A3，S1，极致档）**

| 机位 | reflect | 平均 FPS | 1% low | 平均帧时间 ms | GPU ms | debugLine（RT 尺寸 · dc · 三角面 · ms · k） | 相对 off 的帧时间增量 ms |
|---|---|---|---|---|---|---|---|
| s1-opening | off |  |  |  |  |  | 0 |
| s1-opening | 0.5 |  |  |  |  |  |  |
| s1-opening | 1 |  |  |  |  |  |  |
| s1-raft-back | off |  |  |  |  |  | 0 |
| s1-raft-back | 0.5 |  |  |  |  |  |  |
| s1-raft-back | 1 |  |  |  |  |  |  |
