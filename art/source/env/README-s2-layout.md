# S2 守灯人小屋 · 布局说明（需求单 019）

坐标：1 单位 = 1 m，+Y 上，+Z 北，东 = −X，西 = +X。权威数值以 `art/tools/build-env-s2.mjs` 顶部常量与 `s2-layout.json` 为准。

## 资产
| 文件 | 用途 |
|---|---|
| env-keeper-house-ch1.glb | 外观：8×6 m 两层石屋，地面 y 0 / 二层 3.0，石板瓦屋顶、烟囱、门窗；北墙光感锁座 (-4.8, 0.85, 4.0)（返工 2026-10-29，原 1.2）、地窖门洞 |
| env-keeper-house-ch1-interior.glb | 室内：一层桌（面 0.75，杯子挂点 ×2，其一倒扣）、楼梯 16 级 × 0.1875；二层床、书桌（面 3.75，提灯挂点；`desk-interact` 在二层地板 (-4.6, 3.0, -0.25)，原 3.95）、东窗、西窗台 y 3.9（谜题 4 画框） |
| env-cellar-door-s2.glb | 地窖门扇（额外件，可独立开合） |
| env-cellar-s2.glb | 地窖：12 级 × 0.2 台阶，东墙木架（4 层，钥匙层架面离地 1.10 m；钥匙 / 草图挂点在这一层） |
| env-courtyard-wall-s2.glb | 小院围墙、两座灯台底座（挂点朝 +Z，光平面 y 0.85，灯座上提灯出光 0.846）、院门挂点 |
| env-laundry-rack.glb | 晾衣架；`-collider` extras `{collider:true, blocksLight:true}` |
| env-clifftop-s2.glb | 崖顶平台约 30×25 m（西坡延伸到 x≈25 以容纳白石区）、南台阶顶、北路通 S3 |
| env-repair-yard-s2.glb | 父亲的航标修理院与住家陈设：工棚 + 工作台 / 工具板 / 透镜箱、斜靠东墙的杆标、顶标、横躺的罐形浮标、沉块 + 锚链、灯油桶；门前石板路、长凳、雨水桶、菜畦；屋后搬运道、柴垛、手推车；北门警示牌、崖径绳栏。碰撞盒 = `layout.ts` `S2.props` / `S2.rail` |

## puzzleCritical
019 资产本身都不是 puzzleCritical（正常切 LOD）。灯头、镜子、光感锁、白石、铁门都是 021 道具；019 只提供 `-socket` 空节点，extras 里写 `forPuzzleCritical`。

## 占位与缺口
- viewpoint-s2 用占位坐标 (0.95, 4.35, 1.0)、FOV 30，等 014 白盒确认。
- 白石 8 块的坐标在 `placeholders.whiteStones`（离西窗 12–20 m）。
- 010 占位场景与本布局冲突，且有暖色自发光窗：需程序同学改 `game/`（美术没动）。
- 环境里没有暖色自发光；唯一暖光是程序做的动态提灯光。

## 返工 2026-10-29（制作人裁定，index §7.1 第 19 条；对齐 014 白盒 `game/src/levels/s2/layout.ts`）
所有坐标是 S2 场景坐标（世界 = 下面 worldFrames 变换）；GLB 里的节点是相对各自 placement（小屋 / 地窖 translation (-2, 0, 1)，小院 (-10.625, 0, 0.75)）的局部坐标。

> **坐标说明**：下表坐标是 014 白盒到之前的估算值，白盒到了以后会再逐项核对（误差 ≤ 5 cm），以白盒为准。

| 项 | 旧 | 新 |
|---|---|---|
| 光束平面（灯台出光 / 镜心 / 光感锁受光面中心） | y 1.2 | **y 0.85**（灯座上提灯出光 0.846） |
| `env-keeper-house-ch1-light-lock-socket` | (-4.8, 1.2, 4.0)，局部 [-2.8, 1.2, 3] | **(-4.8, 0.85, 4.0)**，局部 [-2.8, 0.85, 3]；北墙安装石板跟着下移（0.55–1.15） |
| 灯台 socket extras `beamPlaneY` | 1.2 | 0.85（加 `lampEmitY 0.846`） |
| 镜子占位 `points.mirrors` a / b | y 1.2 | y 0.85（x / z 不变） |
| `env-keeper-house-ch1-interior-desk-interact` | (-4.6, 3.95, -0.25)，局部 [-2.6, 3.95, -1.25] | **(-4.6, 3.0, -0.25)**，局部 [-2.6, 3.0, -1.25]（二层地板） |
| 地窖木架层板（离地窖地面） | 0.35 / 0.95 / 1.5（架面 0.365 / 0.965 / 1.515） | 0.35 / 0.72 / 1.085 / 1.5（架面 0.365 / 0.735 / **1.100** / 1.515）；钥匙层 = 1.10 |
| `env-cellar-s2-key-socket` | (-2.35, -1.435, 1.35)，局部 [-0.35, -1.435, 0.35] | **(-2.35, -1.30, 1.35)**，局部 [-0.35, -1.30, 0.35]（架面上；离地 1.10） |
| `env-cellar-s2-sketch-socket` | (-2.35, -1.435, 1.8) | **(-2.35, -1.30, 1.8)**（同一层） |
| `env-cellar-s2-shelf-interact` | (-1.74, -1.3, 1.6)（悬空，离地 1.1） | **(-1.90, -2.40, 1.40)**，局部 [0.10, -2.40, 0.40]，面朝 -X（木架）：在地窖地面上，钥匙在她正前 0.45 m、偏右 5 cm |

- **架面高**：地窖地面 y -2.4，钥匙层架面 y -1.30（离地 1.10 m，误差 0）。`keyHeights.cellarShelfTop / cellarShelfTopAboveFloor / cellarKeyY` 与 `points.cellarShelf / cellarKey / cellarSketch / cellarShelfInteract` 已写进 `s2-layout.json`。
- **拾取 clip**：用 `xi-pickup-shelf`（017，2026-10-29 新增，专为这个木架做：架面 1.10 m，钥匙正前 0.45 m、偏右 5 cm，交互距离不变）。grab 第 22 帧指腹压在钥匙上，这一帧把钥匙挂到 `middle_03_r`；lift 第 25 帧起手抬起。`shelf-interact` 的 extras 已加 `anim: xi-pickup-shelf`。细节见 `art/models/characters/README.md`「地窖钥匙」一节。
- **钥匙模型（021，2026-10-30）**：`art/models/props/prop-key-cellar-s2.glb`。原点 = 握点、底面贴架面：根节点直接放在 `env-cellar-s2-key-socket`（位置 + 旋转，不加偏移）就是平放姿态，环在汐右手边、齿朝她。grab 第 22 帧挂 `middle_03_r` 的固定偏移写在钥匙根节点 `extras.attach`。LOD0/1/2 = 292 / 140 / 76 三角面。
- **与 014 白盒的差异（请程序核对）**：白盒 `cellarShelfInteract` = [-1.74, -1.3, 1.6]（照抄了旧美术节点，y 离地 1.1、离钥匙 0.61 m）。019 验收要求站位节点在地面上，所以美术改到 [-1.90, -2.40, 1.40]；白盒那一行需要程序同步（美术不改 `game/`）。
- 书桌：`lanternSocket` (-5.05, 3.75, -0.35) 相对 `desk-interact` 是正前 0.45 m、偏右 **10 cm**（017 clip 按 5 cm 调；两者都与白盒一致，这次没动，5 cm 差手上看不出，如要精确可把 lanternSocket z 改 -0.30）。

## 世界坐标（返工 2026-10-29 写入 `worldFrames`）
- S2：世界 = origin (1.225, 16, 14.75) + R_y(120°)·局部（014 `S2_WORLD_FRAME`）。
- S3：塔心世界 (39.73, 0, -122.75)，S3 场景绕 Y 转 135°（013 `S3_WORLD_FRAME`）。换到 S2 局部：塔心 (99.8, -16, 102.1)，方位 315.6°（西北），水平 142.8 m。
- `silhouettes` 里那座远景占位还在 019 的 (260, -30, 520)（方位约 333°）；放真塔时以 `worldFrames` 为准。

## 立镜安装位（2026-10-30，021）
- courtyard GLB 新增两个 socket（根的直接子节点，单位旋转，+Z 北）：

| 节点 | S2 局部 | courtyard 本地 | 来源 |
|---|---|---|---|
| `env-courtyard-wall-s2-mirror-a-socket` | (−13.2, 0, 3.0) | (−2.575, 0, 2.25) | `mirrorsPlaceholder.a` 的 x、z |
| `env-courtyard-wall-s2-mirror-b-socket` | (−7.2, 0, 8.6) | (3.425, 0, 7.85) | `mirrorsPlaceholder.b` 的 x、z |

- socket 在铺地面 y 0。立镜 `prop-mirror-stand-s2` 的根是石座底面，镜心高 0.85（extras `mirrorCenterY`）。
- 重建后核对：网格 / 碰撞 / 其余节点 / extras 都没变，二进制块逐字节相同，只多了这 2 个节点。`s2-layout.json` 不变。
- 重建：`node art/tools/build-env-s2.mjs --only=env-courtyard-wall-s2`，再 `glb-pack-ktx2.mjs`。

## 光感锁道具（2026-10-30，021）
`env-keeper-house-ch1-light-lock-socket` (−4.8, 0.85, 4.0) → `prop-light-lock-s2`：
- 根 = 透镜光轴与墙外表面的交点 = `-receiver`（与白盒 `light-lock-s2-receiver` 重合，align 零位移）。透镜朝 +Z（北）鼓出 0.105。
- 只有 `light-lock-lens` 用 `mat-prop-light-lock-lens`，程序按受光进度提亮。
- 表针 `light-lock-needle`、插销 `light-lock-bolt` 可选驱动。

### 白石组真文件（2026-10-30，裁定 16）
`placeholders.whiteStones` 8 块占位已由 `art/models/props/prop-white-stones-s2.glb` 取代（挂 env-clifftop-s2 根零变换，石块按崖顶坐标摆在 stonesArea 里，贴 LOD0 地形）。观察眼位 = `points.viewpointS2`（0.95, 4.35, 1.0 → 18, 0.2, 1，FOV 30）。详见 `art/models/props/README.md` 白石组一节。

## 住家 + 修理院重建（2026-11，TASK-11）
- 场景逻辑：南石阶上来是**住家**（石板路通前门，门边长凳、雨水桶接屋檐落水、西侧菜畦）；东边围墙小院是**父亲修航标的院子**（南墙下单坡工棚和工作台，拆下的灯头透镜在台上；东墙靠着待漆的杆标，北角木枕上躺着罐形浮标和沉块，院口灯油桶）；院子北口沿屋后**搬运道**通地窖门（柴垛贴北墙、手推车停道边），再一条石板路通**北门**，门外崖径有绳栏和警示牌，读作「管着的危险路」。
- 光路两侧 ≥ 0.5 m 不放陈设（`test:s2` 的光路 / 西窗视线检查把 env-repair-yard-s2 也算进去）。
- 地面：`terrainAt()` 在可走范围（`WALK` = 白盒 platform / slope / northPath）把草皮压到白盒地面 −4…+1.5 cm（原来 ±0.35 m，脚会陷进草里或悬空）；白石区只往上起伏，石底不悬空。`test:render` 两项「S2 草皮贴地」「S2 修理院」核对。
- 重建（在 game/ 下；art/tools 先 `npm ci`）：
  ```sh
  node ../art/tools/build-env-s2.mjs --only=env-repair-yard-s2,env-clifftop-s2
  node ../art/tools/glb-pack-ktx2.mjs --uv-bits 14 ../art/models/env/{env-repair-yard-s2,env-clifftop-s2}.glb
  ```
- 同机位前后对比截图：`node --import ./scripts/register-ts-paths.mjs scripts/shots-s2-layout.mjs`（`SHOTS_OUT`、`CHROME` 环境变量）。
