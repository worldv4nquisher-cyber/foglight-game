# S3 初望灯塔 · 给程序的摆放说明（020）

- 数据：`art/source/env/s3-layout.json`（`nodes` = 每件 GLB 的文件 / 位置 / 转角；`points` = 关键点；`keyHeights`；`placeholders` = 还没对白盒的项）。全是 **S3 局部坐标**：塔中心 = 原点，y 0 = 低潮，+Z 北，东 = −X。013 定了 S3 世界坐标后整体平移即可。
- 文件：`env-lighthouse-ch1`（外壳，LOD2 = 远景）、`env-lighthouse-ch1-door`（挂 `door-s3-hinge-socket`，绕 Y 0 → −100°）、`env-lighthouse-ch1-interior`、`env-lamp-room-ch1`、`models/props/prop-fresnel-lens-ch1`（挂 `fresnel-lens-socket`，extras `forceLod0`：现在的加载器只对 puzzleCritical 固定 LOD0，需要程序也认这个键）、`env-rock-islet-a`、`env-stone-bridge-s3`。
- 谜题 5（022 道具）插槽：`mirror-window-s3-socket`（底层窗口镜，双轴）、`guide-mirror-s3-mid-a-socket`（**导光镜 1**，θ140 y 10.6，单轴）、`guide-mirror-s3-mid-b-socket`（**导光镜 2**，θ350 y 16.6，单轴）——都是**谜题 5** 的镜子（不是谜题 4；谜题 4 是 S2 西窗取景）、`oil-valve-s3-socket`、`ignition-port-s3-socket`（节点已翻成朝下）、`tide-bell-s3-socket`（返工 1029 起 scale 1，见下文）。extras `propPuzzleCritical: true` 表示装上去的道具是 puzzleCritical；环境件本身不是。
- 光：环境件没有自发光。点灯的暖光 / 旋转光束用动态光，原点 `lamp-light-origin`（透镜焦点 (0,23.55,0)，defaultOn false），天空光柱 `sky-beam-emitter`。
- 光路占位 `lightpath-0..4`：窗外 → 底层窗口镜 → 导光镜 1（A）→ 导光镜 2（B）→ 点火口。命中检查见下文「光路命中检查」（返工 1029 起以「打进点火口 0.3 m」为准；「三段都在井内」只是附加检查）。
- 石桥 `env-stone-bridge-s3`：沿东南轴 s 从 **8.5（桥头）到 33.0（桥尾，接 S2 崖径）**，全长 24.5 m，净宽 1.5，桥面 y 3.0。`s3-layout.json` → `bridge.s0 / s1` = 8.5 / 33（2026-10-30 由 30.5 改成 33.0 对齐 GLB / 白盒；GLB 本来就到 33.0，字节没变）。桥尾节点：`spawn-from-s2` 在 s 32.0，`bridge-to-s2-exit` 在 s 32.9。
- 水：`machine-room-water`（机房地面 0.2，涨潮 1.6）。门槛 / 门外平台 2.4，涨潮淹不到。
- S1 统一：`build-env-s1.mjs --s3tower` 出 `env-lighthouse-island-main-s3tower.glb` + 插槽 `lighthouse-ch1-socket`，挂 `env-lighthouse-ch1`（LOD2）。替换 `env-lighthouse-island-main` 用，尺寸差异见 PROGRESS-s3.md 阶段 4。
- 注意：`game/` 里占位的 `Lighthouse.ts`（9 m、暖色自发光、位置 (0,0,−5) / S1 (11,2.4,−11)）和本单不一致，接入时请替换（美术没改 game/）。
- **灯室书桌 + 椅子（017 第 3 批加的，结尾 sit-write / stand-gaze 用）**：在 `env-lamp-room-ch1` 里，和 S2 二层书桌椅同一套卡通木作（LOD0–2 都有、带碰撞盒）。θ315（西南：+Z 北、−X 东），朝外：汐坐下面朝玻璃。
  - 书桌：中心 (1.902, 22, −1.902)，0.90 × 0.50，**桌面 22.75（离地 0.75）**；抽屉在她左手边。碰撞盒 0.9 × 0.75 × 0.5。
  - 椅子：座面中心 (1.570, 22.45, −1.570)，**座面离地 0.45**，椅背朝塔中心。碰撞盒 0.45 × 0.9 × 0.45。
  - 节点（都已转好，节点 +Z = 汐面朝的方向 = 朝外 (0.707, 0, −0.707)）：`lamp-room-sit-write`（地面，椅子座面正下方 = `xi-sit-write` 的根）、`lamp-room-desk-interact`（椅子前 0.3 m，走过去坐下前站的位置）、`lamp-room-journal-socket`（桌面 (1.838, 22.75, −1.838)，摊开的父亲日志）、`lamp-room-lantern-socket`（桌面 (1.655, 22.75, −2.079)，她左手边，坐下前放灯用 `xi-place-table`）、`lamp-room-stand-gaze`（地面 (0.872, 22, −2.396)，r 2.55 θ290，矮墙内面前 0.45 m，`xi-stand-gaze` 的根，朝向 (0.342, 0, −0.940)）。
  - stand-gaze 的朝向现在是「径向朝外」。S3 世界朝向定了以后，请把它转到正对远处那座灯塔的方向（节点位置不用动）。
  - 数值也在 `s3-layout.json` → `points.lampRoomFurniture`、`keyHeights.lampRoomDeskTop / lampRoomChairSeat`。

## 返工 2026-10-29（v0.1-index §7.1 第 19 条；单据文字优先）

> **坐标说明**：本节和上文所有坐标都是 015 白盒到之前的估算值。015 白盒到了以后会再逐项核对一遍（误差 ≤ 5 cm），以白盒为准。

数据都在 `s3-layout.json`（`points.stair.landings.window5m`、`points.igniteLever`、`worldFrame`、`silhouettes`）。以下「旧 → 新」均为 S3 局部坐标。

### S3 世界摆放（= `game/src/levels/s1/layout.ts` S3_WORLD_FRAME）
- 塔中心 **(39.73, 0, −122.75)**，绕 Y **135°（2.35619 rad）**；`world = R_y(135°)·local + pos`（three.js R_y：x' = x·cos + z·sin，z' = −x·sin + z·cos）。门 θ225 → 朝世界北（朝 S1）。
- S1 远景插槽里的 `env-lighthouse-ch1` 实例世界朝向也是 135°（插槽局部 = 135° − 岛的 −0.19 rad = 2.54619 rad），两边看到的是同一个朝向。
- **给 015 的遗留项**：S3 场景塔基 y 0（低潮 0）；S1 远景插槽里同一座塔的塔基在 y 6.6（岛台面 7.4 − 0.8）。两套高度不一致，layout.ts 里也是这样；S3 场景进世界时 y 怎么接由 015 定。
- 远景剪影在 S3 局部：F1 (152.58, −0.5, 129.06)，θ40.2，199.8 m；F2 (30.11, −0.5, 176.01)，θ80.3，178.6 m。

### `lamp-room-stand-gaze`（朝向远处灯塔）
- 位置 (0.872, 22, −2.396) → **(0.43, 22, 2.514)**（r 2.55，θ80.3），节点 +Z 正对 F2。原来位置朝向是「径向朝外」，朝向定了后矮墙同半径挪到正对 F2 的方位。

### y 5.0 带窗小平台（021/020）
- 踏步 24 处做成平台：θ310–338，约 1.2 × 1.0 m，y 5.0。窗节点 `stair-window-5m`（GLB 节点已从 `stair-window-1` 改名；替换原来那扇小窗，其余楼梯窗 `stair-window-2…` 编号不变）：θ320，宽 0.8，**窗台 5.9（离平台 0.9）**，窗顶 7.4，比普通楼梯窗大。
- 凳子（可选装饰，有碰撞）：polar(2.68, θ331, 5.0)。没有文字，没有交互。辅助节点 `stair-platform-5m-view`（polar(2.45, 320, 5)，+Z 朝窗）。
- **方向冲突（请制作人裁定）**：单据要求「朝桥 / S2，背对远处剪影」。但 y 5 处楼梯在 θ310–338，按 135° 世界摆放这面朝**世界东（方位约 95°）**，朝不到桥 / S2。现在做的是朝东：看不到远处灯塔，也看不到 S2 的石头。备选两种：① 平台改到 y ≈ 14.6、θ240 附近（朝西北，能看到桥），② 改楼梯起点 / 转向。
- 光路不受影响：y 5 处光路在 r 1.07、θ18，离平台很远。
- 为了让 y 5 平台成立：灯室地面楼梯口 HATCH [88,160] → **[110,182]**；导光镜 1（A）θ118 → **140**，导光镜 2（B）θ328 → **350**（谜题 5）；三段离塔中心最远 2.283 / 1.252 / 1.274 m（都在井内，附加检查）。命中判定见下一节。

### 光路命中检查（返工 1029 策划复核；`s3-layout.json` → `points.lightPathCheck`）
- 判定：光是否打进点火口 `ignition-port-s3`（(0, 21.85, 0)，开口朝下）**判定半径 0.3 m**。底层窗口镜是双轴，光直达导光镜 1 镜心；导光镜 1 / 2 只绕竖轴转，**固定俯仰做进支架**；每面镜子的竖轴角取最优。法线 = (cos p·cos yaw, sin p, cos p·sin yaw)，yaw 从 +X 往 +Z 量，p 为上仰。
- 固定俯仰（写进布局 `guideMirrorTiltDeg` 和 socket extras `fixedPitchDeg`）：**导光镜 1 −1.1°，导光镜 2 +4.4°**。
- 结果：**命中**。落点 (0.009, 21.85, −0.002)，**偏差 0.009 m**（< 0.3）。竖轴解：导光镜 1 yaw −19.78°，导光镜 2 yaw 160.76°（与 015 策划解 −19.8° / 160.7° 一致）。光在导光镜 2 镜面上离镜心 0.028 m。三段长 9.87 / 6.53 / 5.38 m。理想俯仰 −1.14° / +4.35°。
- **导光镜 1 不能按竖直做**（导光镜 2 仍是 +4.4° 时）：光在导光镜 2 的镜面上偏离镜心 0.93 m（垂直于光线 0.26 m），打到点火口偏 **0.474 m，不命中**。原因：光线很陡（约 70°），垂直于光线的 0.26 m 落到竖直镜面上被放大成 0.93 m，这面镜子接不住。
- 俯仰容差（偏差 ≤ 0.3 m）：导光镜 2 = +4.4° 时，导光镜 1 要在 **−1.8° … −0.45°**；导光镜 1 = −1.1° 时，导光镜 2 要在 **+2.85° … +5.9°**。如果一定要导光镜 1 竖直，导光镜 2 得改成约 +1.9°（可接受 +0.45° … +3.45°），但光会落在离导光镜 2 镜心约 0.81 m 的地方，镜面得很大，不建议。
- **建议**：按 −1.1° / +4.4° 做支架（导光镜 1 也做出 −1.1° 的下俯，不要按竖直）。镜子模型留给明天的 021，这里只写数据。

### `ignite-lever`（017 参数，+X 侧，纸条对面）
- `ignite-lever-interact` (1.45, 22, −0.15)，朝 −X，extras `anim: xi-ignite-lever`（2026-10-30 改正：原来写的名字和 clip 名对不上）；提示半径 1.8 m、±60°。
- `ignite-lever-socket` = 枢轴 (0.9, 22.74, 0)（extras `originAt: 'lever-pivot'`；不能用 `pivot` 键）。握把静止 (1.05, 23.0, 0)，**绕节点局部 +X 拉 −60°** 到 (1.2, 22.74, 0)。汐局部：pivot [0.15, 0.74, 0.55]，握把 [0.15, 1.00, 0.40] → [0.15, 0.74, 0.25]。
- 到纸条阅读点：枢轴 1.977 m，交互点 2.408 m（要求 ≥ 1.5）。纸条里灯室地面楼梯口的文字跟着 HATCH 自动改了。

### 潮汐钟（021，S1 / S3 同尺寸）
- 删掉 S3 钟下的石块。`tide-bell-s3-socket` y 2.75、scale 0.7 → **(−2.758, 2.4, −5.162)，scale 1**，转 quatLookY(−π/4)。
- 接触点 (−2.913, 3.5, −4.95) = 站立面 + **1.10**（汐局部 [−0.04, 1.10, 0.72]，r ≈ 0.26）；钟心在交互点前 0.98 m；`bell-swing` 原点 = 挂点。
- 新 `tide-bell-s3-interact` (−3.451, 2.4, −4.469)。

### 022 点火口四态（给道具 / 程序）
节点 `ignition-port-s3-socket`（朝下）+ 子节点 `-receiver`；材质 `mat-prop-ignition-glow`（emissive 由程序驱动，环境件本身仍无自发光）。
| 状态 | emissive 颜色 | 强度 | 动态 |
|---|---|---|---|
| off | — | 0 | 无 |
| no-oil（红） | #C8382A | 低 ~0.6 | 常亮，提示「没油」 |
| cold（冷白微光） | #DCE6EE | 0.15–0.35 呼吸（周期约 4 s） | 程序驱动；**每次进入「可点亮」状态时最多脉冲一次**（0.2 s 升到 ~1.0，0.8 s 落回）；停留在该状态期间不重复，离开后再次进入才会再脉冲（2026-10-30 制作人定） |
| lit（暖） | #FFB25E | ~2.0 | 开 `lamp-light-origin` 动态光 |

### 三角面 / verify
LOD 合计 308 612 / 153 435 / 71 810。7 个 GLB 全部打包 + verify 通过；door、bridge、lens 和返工前字节一致。

### 导光镜道具（022，2026-10-30）
导光镜 1 / 2 做成两个变体：`prop-guide-mirror-wall-s3-a.glb` / `-b.glb`。根 = 镜心，可直接挂 `guide-mirror-s3-mid-a/b-socket`，俯仰固定 −1.1° / +4.4°。节点、接入和光路复核见 `art/models/props/README.md`：用实际模型算，出射光离点火口 0.0086 m，支架不挡光。

### 022 其余道具（2026-10-30 第 3 批，详见 `art/models/props/README.md`）
- `oil-valve-s3-socket` → `prop-oil-valve-s3`：根 = 阀心，地面 + 0.70；`valve-wheel` 绕本地 +Z 转 +90°。
- 窗口镜 → `prop-guide-mirror-window-s3`：根 (2.35, 1.0, 0)，镜心 1.35；`mirror-yaw` → `mirror-pitch` → `-mirror-plane`。正解 rotation.y 74.21° / rotation.x −66.35°。
- `ignition-port-s3-socket`（翻转）→ `prop-ignition-port-s3`：
  - 根原点 = `-receiver`。
  - 透镜 + 机匣观察窗共用 `mat-prop-ignition-glow`，有四态。
  - `ignite-lever` 枢轴 (0.9, 22.74, 0)，握点静止 (1.05, 23, 0) / 拉到底 (1.2, 22.74, 0)。
  - 油管从机匣下穿楼板，接进 env 铁圈。
- 光路复核：L0→W→A→B→点火口四段，拉杆静止 / 拉到底都没有遮挡，落点离点火口 0.009 m（`/workspace/rope-check/s3path-b3.mjs`）。
- `door-s3-hinge-socket` → `prop-lighthouse-door-s3`：`door-leaf` 原点 = 铰链，锁孔在门扇本地 (0.92, 0.86)。
- 020 门扇修正：`env-lighthouse-ch1-door` 竖板方向（原来露缝）、拱顶铁箍端点（原来交叉成 X）；已重建并打包。
