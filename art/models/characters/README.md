# art/models/characters

| 文件 | 内容 |
|---|---|
| `char-xi.glb` | 主角汐，模型 + 73 骨蒙皮 + LOD0–2（需求单 016，无围巾） |
| `char-xi-anims.glb` | 汐的动画库（需求单 017）：**只有骨架、没有网格**，骨架和 `char-xi.glb` 一样，30 fps，原地（in place），朝向 +Z，EXT_meshopt_compression |
| `preview/` | 内部预览图；`preview/anims/` 是 017 动画的联系表（第 1 批 5 张、第 2 批 9 张、第 3 批 8 张）和走/跑循环视频 |

## char-xi-anims.glb 的用法

加载 `char-xi.glb` 和 `char-xi-anims.glb`，把后者的 `animations` 交给前者场景的 `AnimationMixer`。轨道按节点名绑定（`hips`、`spine_01`……），73 个关节的静止 TRS 两边一致，自检脚本 `art/tools/verify-xi-anims.mjs` 会验证这一点。

- 跟静止姿势一样的通道已经删掉。three 的 mixer 对没有轨道的属性会回到静止值，所以结果一样。
- 所有 clip 都是原地动画：hips 不往前走，角色移动由游戏逻辑负责，速度按下面的 `strideSpeed` 来，这样就不会滑步。
- 循环 clip 的最后一帧和第一帧完全相同，可以直接用 `LoopRepeat`。

## 全部 31 个 clip（需求单 28 个 + 额外 3 个）

| # | clip | 批 | 帧 | 时长 | 循环 | 速度 / 根运动 | 关键事件（帧） |
|---|---|---|---|---|---|---|---|
| 1 | `xi-idle` | 1 | 211 | 7 s | 是 | 原地 | 见上 |
| 2 | `xi-idle-lantern` | 1 | 151 | 5 s | 是 | 原地 | — |
| 3 | `xi-walk` | 1 | 25 | 0.8 s | 是 | 1.6 m/s | 左脚 0、右脚 12 落地 |
| 4 | `xi-walk-lantern` | 1 | 25 | 0.8 s | 是 | 1.6 m/s | 左脚 0、右脚 12 落地 |
| 5 | `xi-jog` | 1 | 19 | 0.6 s | 是 | 3.2 m/s | 左脚 0、右脚 9 落地 |
| 6 | `xi-jog-lantern` | 1 | 19 | 0.6 s | 是 | 3.2 m/s | 左脚 0、右脚 9 落地 |
| 7 | `xi-turn-l90` | 1 | 41 | 1.3333 s | 否 | 原地 | 第 34 帧转完 |
| 8 | `xi-turn-r90` | 1 | 41 | 1.3333 s | 否 | 原地 | 第 34 帧转完 |
| 9 | `xi-stairs-up` | 1 | 23 | 0.733 s | 是 | 水平 0.709 / 竖直 +0.545 m/s（返工 2026-10-29） | — |
| 10 | `xi-stairs-down` | 1 | 23 | 0.733 s | 是 | 水平 0.709 / 竖直 −0.545 m/s（返工 2026-10-29） | — |
| 11 | `xi-step-across` | 2 | 49 | 1.6 s | 否 | 原地，游戏沿跨越路径前移 0.85 m | leftOff 8，leftLand 22，rightOff 25，rightLand 42 |
| 12 | `xi-push-start` | 2 | 37 | 1.2 s | 否 | 原地 | handsOn 26 |
| 13 | `xi-push-loop` | 2 | 37 | 1.2 s | 是 | 0.8 m/s | — |
| 14 | `xi-push-end` | 2 | 37 | 1.2 s | 否 | 原地 | handsOff 6 |
| 15 | `xi-ring-bell` | 2 | 61 | 2 s | 否 | 原地 | touch 22，ring 30 |
| 16 | `xi-place` | 2 | 71 | 2.3333 s | 否 | 原地 | set 44，release 48 |
| 17 | `xi-pickup` | 2 | 78 | 2.5667 s | 否 | 原地 | grab 22，lift 24 |
| 18 | `xi-place-table`（额外） | 2 | 55 | 1.8 s | 否 | 原地 | set 30，release 34 |
| 19 | `xi-pickup-table`（额外） | 2 | 65 | 2.1333 s | 否 | 原地 | grab 20，lift 22 |
| 19b | `xi-pickup-shelf`（额外，2026-10-29） | 2 | 81 | 2.6667 s | 否 | 原地 | grab 22，lift 25 |
| 20 | `xi-operate-loop` | 2 | 73 | 2.4 s | 是 | 原地 | — |
| 21 | `xi-valve-hold` | 2 | 91 | 3 s | 否 | 原地 | grip 14，turnStart 16，turnEnd 76，release 80 |
| 22 | `xi-ignite-lever` | 2 | 46 | 1.5 s | 否 | 原地 | grip 15，pullStart 22，ignite 34 |
| 23 | `xi-read-loop` | 3 | 121 | 4 s | 是 | 原地 | — |
| 24 | `xi-look-up` | 3 | 151 | 5 s | 否 | 原地 | upReached 44，lookDown 108 |
| 25 | `xi-observe` | 3 | 121 | 4 s | 是 | 原地 | — |
| 26 | `xi-shiver` | 3 | 91 | 3 s | 否 | 原地 | shiverStart 10，shiverEnd 66 |
| 27 | `xi-row-boat` | 3 | 91 | 3 s | 是 | 原地 | catch 0，finish 33，bladeOut 38，bladeIn 86 |
| 28 | `xi-tie-boat` | 3 | 166 | 5.5 s | 否 | 原地 | ropeAround1 44，ropeAround2 92，hitch 118，tug 130，tied 134 |
| 29 | `xi-sit-write` | 3 | 121 | 4 s | 是 | 原地 | penDown1 0，penUp1 42，penDown2 54，penUp2 96 |
| 30 | `xi-stand-gaze` | 3 | 181 | 6 s | 是 | 原地 | — |

- 帧数含收尾帧（循环 clip 的最后一帧 = 第一帧）。30 fps。事件在每个 clip 的 `extras.events`（秒）和 `extras.eventFrames`（帧）。
- 文件 1.44 MB（1 511 196 字节，上限 15 MB）。联系表：`preview/anims/xi-anims-*.png`（23 张）。

## Clip 一览（第 1 批：移动类）

| clip | 帧数（含收尾帧） | 时长 | 循环 | 步幅速度 / 说明 |
|---|---|---|---|---|
| `xi-idle` | 211 | 7.0 s | 是 | 站立待机：两次呼吸，1.35–4.5 s 搓手，4.55–6.45 s 缩脖（`extras.events`） |
| `xi-idle-lantern` | 151 | 5.0 s | 是 | 右手提灯待机，3 s 前后缩肩一次，灯轻微晃动 |
| `xi-walk` | 25 | 0.8 s | 是 | **1.6 m/s**，两步周期 1.28 m（单步 0.64 m），左脚第 0 帧落地，右脚第 12 帧落地 |
| `xi-walk-lantern` | 25 | 0.8 s | 是 | 1.6 m/s，同上，右臂提灯、手臂摆幅更小 |
| `xi-jog` | 19 | 0.6 s | 是 | **3.2 m/s**，两步周期 1.92 m，左脚第 0 帧落地，右脚第 9 帧落地 |
| `xi-jog-lantern` | 19 | 0.6 s | 是 | 3.2 m/s，同上 + 提灯 |
| `xi-turn-l90` | 41 | 1.33 s | 否 | 原地左转 90°，头先转；root 骨偏航 +90°，第 34 帧转完 |
| `xi-turn-r90` | 41 | 1.33 s | 否 | 原地右转 90°（root 偏航 −90°） |
| `xi-stairs-up` | 23 | 0.733 s | 是 | 每级高 0.2 m、深 0.26 m，一个周期两级；水平 **0.7091 m/s**，竖直 **+0.5455 m/s**（返工 2026-10-29，原 0.433 / 0.333） |
| `xi-stairs-down` | 23 | 0.733 s | 是 | 同上，下楼，竖直 −0.5455 m/s |

步幅速度是从脚的触地点算出来的：支撑相里触地点每帧往后移动的速度，就是游戏里角色该用的移动速度。`verify-xi-anims.mjs` 在 three 里实测，walk 1.600、jog 3.200，滑移 P95 为 0.03–0.04 m/s。

每个 animation 的 `extras` 包含：

- `loop`、`frames`、`durationS`、`fps`、`bakedSecondary`
- 移动类：`strideSpeed`（m/s）、`strideM`、`cycleFrames`、`footsteps`（脚落地的帧号，可以用来播脚步声）
- 楼梯：`vertSpeed`、`stairs: {rise, tread, up}`
- 转身：`rootMotion: {bone:'root', yawDeg, endFrame}`
- 待机：`events`（秒）
- 提灯：`prop: {name:'prop-lantern-brass', socket:'hand_r_socket'}`

### 转身

`root` 骨在动画里转 ±90°，脚在世界里不动，不会滑。播完以后有两种做法：

1. 游戏把角色朝向加上 `yawDeg`，同时切回 idle（root 回到 0°）。
2. 或者用 `AnimationUtils` 把 root 的旋转轨道抽出来，当根运动处理。

第 34–40 帧是静止收尾，可以在这段里交叉淡出。

### 楼梯

原地动画的参考线是坡线，不是地面：动画原点沿着楼梯的平均坡度走（每 0.733 s = 22 帧水平前进 0.52 m、上升或下降 0.4 m）。游戏要把角色沿坡线移动，**水平速度 0.7091 m/s，竖直速度 ±0.5455 m/s**（返工 2026-10-29，制作人裁定竖直约 0.55 m/s；整数帧下最接近的是 22 帧 / 周期。原第 1 批为 36 帧、0.433 / 0.333 m/s，已作废）。S3 底层 0.2 → 灯室 22.0 共 21.8 m，单程约 40 s。脚在局部坐标里会低于 0，范围大约 −8 cm 到 −13 cm，这是正常的。踏面和网格怎么对齐，见 `art/source/characters/char-xi-anims.meta.json` 里的 `stairs.yTreadFront` 和 `zTread`（在局部坐标里，周期第 0 帧时最近一级踏面的前沿位置）。预览页 `art/tools/preview/anims.html` 就是用这两个值摆放台阶的。

### 提灯

- 灯挂在 `hand_r_socket`（`char-xi.glb` 里的同名骨），挂上 `prop-lantern-brass.glb` 的提手即可，不需要额外偏移。
- 挂点相对臀部基本不动：走/跑时横向漂移 1–1.6 cm。灯的摆动已经烘进手腕，倾角 walk 约 5°、jog 约 12°、idle 约 1.6°，所以不需要再给灯加物理。
- 在 Blender 里用蒙皮后的 LOD0 检查过，灯和腿、雨衣之间最近距离 walk 2.0 cm、jog 2.7 cm、idle 5.3 cm，没有穿插。

## Clip 一览（第 2 批：交互类）

所有坐标都在汐的局部空间里（glTF：+X = 她的左边，+Y 向上，+Z = 她面朝的方向），原点就是**交互点**：游戏先把汐放到交互点、朝向机关，再播动画。事件在 `extras.events` 里用秒，`extras.eventFrames` 里是帧号（30 fps）。对齐参数写在 `extras.align`，每个 clip 的完整数据（逐帧角度曲线等）在 `art/source/characters/char-xi-anims.meta.json`。

| clip | 帧数 | 时长 | 循环 | 关键帧（帧 / 秒） | 说明 |
|---|---|---|---|---|---|
| `xi-step-across` | 49 | 1.6 s | 否 | leftOff 8 / 0.267，leftLand 22 / 0.733，rightOff 25 / 0.833，rightLand 42 / 1.4 | 跨过 0.5 m 宽的缝（交互点前 0.20–0.70 m）。**原地，游戏沿跨越路径前移 0.85 m**：GLB 里 hips 不前移（首尾帧都在原点），前移由游戏沿 TraversalLink 路径做，按 smoothstep 覆盖整个 clip（第 0–48 帧）脚才不滑；参数在 `extras.rootMotion`（`inPlace: true`，`translateM` / `profile` 只是给游戏的前移量和曲线） |
| `xi-push-start` | 37 | 1.2 s | 否 | handsOn 26 / 0.867 | 从 idle 弯腰、上手。最后一帧和 `xi-push-loop` 第 0 帧完全一样 |
| `xi-push-loop` | 37 | 1.2 s | 是 | 左脚 0、右脚 18 落地 | **0.8 m/s**（触地实测 0.800，滑移 P95 0.023 m/s）。两手相对汐不动，浮台与汐同速 |
| `xi-push-end` | 37 | 1.2 s | 否 | handsOff 6 / 0.2 | 第一帧 = `xi-push-loop` 第 0 帧，收手、站直回到 idle |
| `xi-ring-bell` | 61 | 2.0 s | 否 | touch 22 / 0.733，ring 30 / 1.0 | 右脚上前半步，右手掌心推钟腰 7 cm。ring 帧离手：从这一帧起让 `bell-swing` 摆起来并放钟声 |
| `xi-place` | 71 | 2.33 s | 否 | set 44 / 1.467，release 48 / 1.6 | 灯台（1.0 m），右脚上前半步 |
| `xi-pickup` | 78 | 2.57 s | 否 | grab 22 / 0.733，lift 24 / 0.8 | 灯台（1.0 m） |
| `xi-place-table` | 55 | 1.8 s | 否 | set 30 / 1.0，release 34 / 1.133 | 桌面（0.75 m），不迈步 |
| `xi-pickup-table` | 65 | 2.13 s | 否 | grab 20 / 0.667，lift 22 / 0.733 | 桌面（0.75 m） |
| `xi-pickup-shelf` | 81 | 2.67 s | 否 | grab 22 / 0.733，lift 25 / 0.833 | S2 地窖木架取钥匙（架面 1.10 m，钥匙正前 0.45 m），不迈步 |
| `xi-operate-loop` | 73 | 2.4 s | 是 | — | 双手扶机关两侧把手，前后推拉 ±1.2 cm、轻微摇摆，用于转立镜、拨拨盘的持续操作 |
| `xi-valve-hold` | 91 | 3.0 s | 否 | grip 14 / 0.467，turnStart 16 / 0.533，**turnEnd 76 / 2.533**，release 80 / 2.667 | 双手转阀轮 90°，**转动正好 2.0 s**，分两次用力 |
| `xi-ignite-lever` | 46 | 1.5 s | 否 | grip 15 / 0.5，pullStart 22 / 0.733，**ignite 34 / 1.133** | 右手一直提灯，左手拉杆。ignite 是拉杆到底的那一帧 |

`xi-place-table` / `xi-pickup-table` / `xi-pickup-shelf` 是需求单之外多出来的三个 clip（见下面的决定），verify 脚本已把它们列为允许的额外 clip。

### 放灯 / 取灯：两个高度各做一套（决定）

**决定：做两套 clip，不用一套凑合两个高度。**

- 灯台（1.0 m）：`xi-place`、`xi-pickup`。挂点 = 021 `prop-lantern-stand-s2` 的 `-socket`（托盘 0.72 m + 灯 0.28 m，风灯提手 1.008 m），在交互点前 **0.65 m**（返工 2026-10-29：制作人批准灯台模型向汐挪 5 cm，原 0.70；第 2 批 0.70 时手臂最远处被夹 6–8 mm，现在为 0）。灯台有聚光罩，罩沿高 1.0 m，所以灯要先抬到 1.31 m，越过罩沿再放进去，汐还得右脚上前半步、身体前倾、右肩前伸。
- 桌面（0.75 m）：`xi-place-table`、`xi-pickup-table`。提手高 1.03 m，在交互点前 0.45 m、偏右 5 cm（S2 书桌 `lantern-socket` 和 `desk-interact` 的相对位置），桌沿在交互点前 0.20 m。不迈步，抬手的路径低。

两种高度的提手高度只差 2 cm，真正不同的是**距离**（0.65 m 和 0.45 m）以及**灯台的罩子**。一套 clip 用在另一处，手要么够不着，要么灯会穿过罩子或桌沿，所以分开做。

灯的挂接：

- `place`：release 帧以前，灯挂在 `hand_r_socket`。从 release 帧起，灯放到 `extras.lanternWorld.socket`（局部坐标），从那一帧起不再跟手。
- `pickup`：grab 帧以前，灯在 socket 上；从 grab 帧起挂回 `hand_r_socket`（`attachedFrom`）。
- 这两个 clip 在 grab/release 帧，手掌和 socket 完全对齐，切换时灯不会跳。

已检查：灯和汐的身体最近 8.6 mm（灯台）和 2.0 cm（桌面），没有穿插；灯和罩沿、桌沿都不相碰，放下时离罩沿最近 6 mm。

**已知问题（灯台）：** 最远的那几帧手臂伸到了极限，IK 少够了 6–8 mm，所以灯在罩沿上方 2.4 cm 而不是 3 cm 经过。看不出来，也不会穿插。如果 022 以后把灯台挪近 5 cm 或更多，这个问题就没有了。

### `ignite-lever`：给 022 的确切参数

022 的拉杆节点叫 **`ignite-lever`**，请照这组数据建模（汐局部 glTF 坐标，原点 = 交互点，汐面朝 +Z）：

| 参数 | 值 |
|---|---|
| 枢轴（节点原点） | **[0.15, 0.74, 0.55]**（她左边 15 cm、高 0.74 m、前方 0.55 m） |
| 杆长（枢轴到握点中心） | **0.30 m** |
| 静止姿势 | 杆从竖直往**汐这边**倾 **30°**；握点 [0.15, 1.00, 0.40]，高 **1.0 m** |
| 拉到底 | 绕节点 **+X** 轴旋转 **−60°**（往下、往她这边），杆变成水平指向汐；握点 [0.15, 0.74, 0.25] |
| 时间 | grip 第 15 帧上手，第 22 帧开始拉，**第 34 帧（1.133 s）到底 = `ignite` 事件**，然后保持到第 45 帧 |
| 拉杆角度曲线 | `extras.align.igniteLever.angleDegPerFrame`（46 个值，度）；第 22→34 帧 smoothstep。游戏直接按帧号查表转节点，手和杆就对得上 |

策划给的初始值（握点约 1.0 m、下拉约 60°、约 1.5 s）**都没改**。

右手一直提灯（`hand_r_socket`，灯离身体最近 5.7 cm）；左手掌心中心在每一帧都落在握点上（误差 0）。

### 其他对齐

| 机关 | 节点 / 位置 | 说明 |
|---|---|---|
| 阀轮 | `valve-wheel`，中心 **[0, 0.70, 0.40]**（返工 2026-10-29，原 0.90），半径 0.15 m，轴指向汐（[0, 0, −1]） | 两手在 165°（左）和 15°（右），从汐看逆时针（开）转 90°。角度曲线在 `angleDegPerFrame`。0.70 m 偏低：汐前倾、屈膝（臀部最多下沉 17 cm），左手转到最低处 0.555 m 仍够得着（arm clamp 0） |
| 潮钟 | `bell-swing`，接触点 [−0.04, 1.10, 0.72] | 假设钟在接触高度的半径约 0.26 m（钟心在交互点前约 0.98 m）。钟模型还没做，做的时候请对齐 |
| 浮台 | 推面在交互点前 **0.48 m**，掌心高 **0.62 m**、左右 ±0.17 m | 推面可以是浮台近侧的上沿或一根推杆。push-loop 时浮台和汐一起以 0.8 m/s 前进 |
| 机关把手 | 两侧竖向把手 [±0.27, 1.05, 0.40] | `xi-operate-loop` 用。立镜框、拨盘门的把手请放在这里 |
| 缝 | 交互点前 0.20–0.70 m（`extras.gap`） | `xi-step-across` |

钟、浮台、机关把手这几样道具都还没做，上面是动画这边的假设。真做的时候如果尺寸不一样，告诉我，我改动画参数重新生成即可（都是脚本参数）。

### 脚步

非循环 clip 的 `extras.footsteps` 是「从离地到触地」的帧号，可以直接用来播脚步声，比如 push-start 是左 22、右 15，step-across 是左 22、右 41。

### 第 2 批自检（Blender 内，`build_xi_anims.py -- check --batch=2`）

- 支撑脚滑移：0（≤ 0.0001 m/s）；push-loop 按步态算，触地速度 0.800，滑移 P95 0.023 m/s
- 穿地：无
- 手和目标的误差：0；手臂 IK 截断只有灯台两段 6.4 / 7.7 mm，push-start 0.9 mm，其他为 0
- 循环首尾差：push-loop、operate-loop 都是 0
- 风灯和身体：全部 0 穿插

## Clip 一览（第 3 批：演出类）

坐标约定同第 2 批（glTF 局部：+X = 她的左边，+Y 上，+Z = 她面朝的方向；原点 = 放置点的**地面**）。坐姿 clip 的原点是座位中心正下方的地面 / 船底板。

| clip | 帧 | 时长 | 循环 | 关键帧 | 说明 / 对位 |
|---|---|---|---|---|---|
| `xi-read-loop` | 121 | 4.0 s | 是 | — | 站着，双手捧一张纸（16 × 22 cm）低头读，头从左往右扫两行。纸：`extras.align.paper`（第 0 帧位置 / 朝向），挂 `hand_l`，第 0 帧算偏移后固定 |
| `xi-look-up` | 151 | 5.0 s | 否 | upReached 44，lookDown 108 | 原地仰望（头后仰约 40°，胸再仰约 11°），停约 2 s 收回待机。要停更久：在 44–108 之间循环或在 lookDown 前暂停 |
| `xi-observe` | 121 | 4.0 s | 是 | — | 双手平放窗台望外（谜题 4）。窗台面高 **0.90**（S2 二层西窗），内沿在前方 0.25 m，掌心 [0.185, 0.90, 0.33] / [−0.175, 0.90, 0.32] |
| `xi-shiver` | 91 | 3.0 s | 否 | shiverStart 10，shiverEnd 66 | 被冷水送回后：缩肩、双拳抵在下巴下，6 Hz 细抖 + 三下大哆嗦，慢慢平复回待机 |
| `xi-row-boat` | 91 | 3.0 s | 是 | catch 0，finish 33，bladeOut 38，bladeIn 86 | 坐在横座上划双桨，**座面 0.35**。每桨 20 次/分（拉 1.1 s、回 1.9 s）。桨参数见下 |
| `xi-tie-boat` | 166 | 5.5 s | 否 | ropeAround1 44，ropeAround2 92，hitch 118，tug 130，tied 134 | 码头上把船绳绕系船桩两圈、打结、拽紧，然后站直。桩中心在前方 0.37 m |
| `xi-sit-write` | 121 | 4.0 s | 是 | penDown1 0，penUp1 42，penDown2 54，penUp2 96 | 灯室：**座面 0.45、桌面 0.75**，桌前沿在前方 0.22 m，日志中心在前方 0.38 m。右手写两行，左手按着本子 |
| `xi-stand-gaze` | 181 | 6.0 s | 是 | — | 结尾在灯室玻璃前久久眺望：头比待机抬约 13°，左手轻握右手腕放在身前，慢呼吸、重心极慢地换 |

风灯：第 3 批都**不拿灯**（开场划船时灯挂在船头，见 `text-ch1` 0:15）。要拿灯的段落用第 1/2 批的 lantern clip 衔接。

### `xi-row-boat`：桨架和桨的参数（自己定的，船模型里还没有）

`prop-boat-rowboat.glb` 里没有桨架节点，所以按下面这组参数做动画。坐标是**汐的局部坐标**，原点 = 横座中心正下方的船底板 / 脚蹬平面，汐面朝 +Z（= 船尾，船往她背后走）。

| 参数 | 值 |
|---|---|
| 座面高（原点之上） | **0.35**（制作人给） |
| 桨架（转轴 / 桨栓） | 左 **[0.56, 0.525, 0.22]**，右 **[−0.56, 0.525, 0.22]**（座位中心后方 0.22 m = 往船尾方向 0.22 m，桨栓顶 = 舷边上 0.06） |
| 舷边高 | 0.465（原点之上） |
| 桨 | 全长 **2.50 m**，内舷（桨架 → 手柄端）**0.50**，外舷 **2.00**，桨叶 0.55 × 0.14；握点在离桨架 **0.46 m** 处 |
| 水面 | 原点之上 **0.105** |
| 角度 | 每帧 `extras.align.rowing.yawDegPerFrame` / `pitchDegPerFrame`（91 个值，度）。yaw = 桨偏离「垂直船身」的角度，正 = 手柄往她前方；pitch = 桨杆对水平面，正 = 手柄高、桨叶低。左右镜像同值 |
| 一桨 | catch 0 帧 yaw +40°、pitch 17°（入水，桨叶中心 0.021 = 水下 8 cm）→ finish 33 帧 yaw −19° → bladeOut 38 帧 pitch 9°（出水，桨叶中心 0.255 = 水面上 15 cm）→ 回桨 → bladeIn 86 帧 → 第 90 帧 = 第 0 帧 |
| 脚 | 脚跟踩船底板，前掌抵斜脚蹬，踝 [±0.11, 0.095, 0.50]，脚背上翘 20° |
| 船速建议 | drive（0–33 帧）里加速、回桨时缓慢减速，平均约 0.9 m/s |

手柄方向（glTF，左桨，从桨架指向手柄）= (−cos y·cos p, sin p, sin y·cos p)，右桨 x 取反。游戏按帧号查表转桨，手就一直在握点上（误差 0）。

**和现有船模型对不上的地方（没改船，请看要不要改）：**
- 船的横座顶在船底以上 0.485，制作人给的座高 0.35 → 动画以「座面 0.35」为准。把汐放进船时：根 = 座面中心 − 0.35，所以她的脚会在船底板以上 0.135 处，需要一块**脚踏板 / 船底格栅（船底上 0.135）**，或者把横座降到 0.35。
- 船上的座位节点 (0, 0.42, −0.25) 不在两条横座的任何一条上。
- 建议给船加 `oarlock-l` / `oarlock-r` 节点（按上表位置）和 `rower-seat` 节点（= 本 clip 的原点）。
- **返工 1029 已落实到船模型**：`prop-boat-rowboat` 加了船底板（顶 0.135）和桨架；节点 `prop-boat-rowboat-seat` = 本 clip 原点（船局部 (0, 0.135, 0.36)，座面 = 原点 + 0.35，与 `extras.align.rowing` 一致），`-oarlock-l` (−0.56, 0.66, 0.14)、`-oarlock-r` (0.56, 0.66, 0.14)（船朝 −Z，汐朝船尾，所以她的左 = 船 −X）。横座本身没降（顶仍是原点 + 0.35 = 船底以上 0.485）。

### 其他第 3 批对位

| 场景 | 节点 / 位置 | 说明 |
|---|---|---|
| 系船桩（S1 码头） | 桩中心在前方 0.37 m，r 0.16，高出桥面 0.85；两手绕绳高度 0.52–0.62 | `env-pier-wood-ch1` 尽头那根系船桩（S1 x +1.05, z −6.8）。**注意：** S1 的 `env-pier-wood-ch1-boat-mooring` 节点在 x −1.0，和这根桩（x +1.05）不在一边，汐的站位请按「桩中心朝她 0.37 m」放，不要直接用这个节点。桩上现成的绳圈在桥面上 0.42–0.57，绕绳在它上面<br>**返工 1029：已改**——`env-pier-wood-ch1-boat-mooring` 移到 +X 侧（码头局部 (0.68, 2.2, −6.8)，桩中心前 0.37 m，朝桩），旧位置改名 `-bollard`。 |
| 灯室书桌椅（S3） | `lamp-room-sit-write`（= sit-write 的根）、`lamp-room-journal-socket`、`lamp-room-lantern-socket`、`lamp-room-desk-interact`、`lamp-room-stand-gaze` | 这次加进 `env-lamp-room-ch1` 的，数值见 `art/source/env/README-s3-layout.md` |
| 窗台（S2 二层西窗） | 观察点地面 = 根，窗台内沿在前方 0.25 m、台面 0.90 | 台高 ±5 cm 以内直接用 |
| 纸 / 笔 / 绳 | 纸挂 `hand_l`、笔挂 `hand_r`（`extras.align` 给第 0 帧位置），绳子建议程序画线段 bow-ring → `hand_r`，tied 后 bow-ring → 桩 | 动画文件里没有道具网格 |

坐姿：大腿根在座面上 8.5 cm；雨衣后摆和侧片在坐姿下压在座面上往后 / 往外摊开（烘焙进次级运动），前片贴着大腿。sit-write 时她脚够不着平放（小腿短），前掌点地。

### 第 3 批自检（Blender 内，`-- check --batch=3`）

- 手和目标的误差：0；手臂 / 腿 IK 截断：0
- 穿地：无（坐姿两条 clip 脚底最低点 +2 / +3 mm）；站姿 clip 支撑脚滑移 0
- 循环首尾差：read-loop、observe、row-boat、sit-write、stand-gaze 都是 0
- 看图检查（联系表）：拉桨末段手柄端停在身前、雨衣前襟外（finish 从 −25° 收到 −19°、内舷从 0.55 缩到 0.50 后）；写字时右手在本子上、左手按页；系绳时两手绕到桩后面换手，不穿桩。桨和身体的穿插只看了图，没有做数值检测（动画文件里没有桨的网格）

## 次级运动：烘焙，以后可以改成物理

**决定：** 头发、兜帽、雨衣下摆的轻量摆动直接烘焙到每个 clip 里。依据加速度、重力、空气阻力，用二阶低通算出来；循环 clip 取周期稳态，所以首尾也是连续的。雨衣前后片会被大腿推开。

这样做的好处是第一版不需要物理也能看，在不同设备上的效果一致，也不会穿插。

**标记：** 根节点 `char-xi` 的 `extras` 里有：

- `bakedSecondary: true`
- `swingBones`：20 根骨。`hair_bangs`、`hair_side_*`、`hair_ponytail_01..03`、`hood_01..02`、`coat_front_*`、`coat_side_*`、`coat_back_*`

每个 clip 的 `extras.bakedSecondary` 也是 `true`。

**以后要换成物理（弹簧骨、Verlet 等）：**

1. 加载以后，把每个 clip 里绑定到 `swingBones` 的轨道删掉，可以用 `clip.tracks = clip.tracks.filter(...)`。
2. 在这些骨上挂物理，以它们的静止姿势为平衡位置。

主体动画不依赖这些骨，删掉轨道不会影响别的部分。

第 3 批的两个坐姿 clip（`xi-row-boat`、`xi-sit-write`）里，雨衣后片 / 侧片压在座面上往后、往外摊，前片两段都贴着大腿，这是烘焙时按「坐姿」单独处理的。换成物理时，坐姿下要给座面加一块碰撞体（或者坐姿时继续用烘焙轨道），不然下摆会穿过椅面。

### 地窖钥匙：`xi-pickup-shelf`（2026-10-29，程序选了方案 A）

**用 `xi-pickup-shelf`。** 专门为 S2 地窖木架做的一条，节奏和 `xi-pickup-table` 一样慢、收着，不迈步。

- 对齐：根 = `env-cellar-s2-shelf-interact`（地窖地面），汐面朝木架。钥匙 `env-cellar-s2-key-socket` 平放在 **1.10 m** 架面上，**正前 0.45 m**、偏右 5 cm（局部 [−0.05, 1.10, 0.45]）。0.45 m 就是现在的交互距离，代码不用改。（试过 0.40 m：手臂折得更紧，上臂 / 前臂会碰到架沿和右前柱，所以不用。）
- 节奏：第 0–8 帧右手抬到架沿后上方 → 第 14 帧悬在钥匙上方 → **grab 22** 中指 / 食指指腹落在钥匙上表面 → **lift 25** 手抬起、手指收拢 → 手先往后上方收出架沿（约第 32–40 帧）→ 落到胸前低头看一眼（第 49–57 帧）→ 握着钥匙垂手回到待机（第 80 帧）。
- 钥匙挂接：grab 帧把钥匙挂到 **`middle_03_r`**（中指末节，按这一帧算相对偏移，之后固定），收拢手指时钥匙跟着卷进掌心。只挂 `hand_r` 也行（偏移同样在 grab 帧算），只是不会跟着卷。全部写在 `extras.align.keyShelf`。
- 自检（`build_xi_anims.py` 的 `shelfCheck`，逐帧测全部蒙皮顶点）：手、臂、身体**不进架板也不进立柱**（0 帧穿插），手越过架面时最低 1.114 m；grab–lift（第 22–25 帧）指尖最低点 1.1059，钥匙上表面 1.106（0.1 mm 压入），22 个指尖顶点在 3 mm 以内 = 手指确实压在钥匙上。
- 钥匙模型（021，2026-10-30）：`art/models/props/prop-key-cellar-s2.glb`，9.5 × 3.1 × 0.6 cm，原点 = 握点（实测 grab 帧食指 / 中指指腹在原点左右各约 1 cm）。根节点对齐 `key-socket` 即平放；挂 `middle_03_r` 的固定偏移已算好写在钥匙根节点 `extras.attach`（`key.matrix = middle_03_r.matrixWorld × attach`），不用再在 grab 帧现算。特写预览 `art/models/props/preview/prop-key-cellar-s2-grab.png`。
- 假设：右手空着（不提灯）；动画按 9 × 2.4 × 0.6 cm、长边左右放的钥匙做，和成品（9.5 cm、厚 6 mm）一致，不用重做。木架尺寸取 `build-env-s2.mjs`（架板深 0.42、钥匙在架板中间，架沿在交互点前 0.24 m；立柱 5 cm）。
- 联系表：`preview/anims/xi-anims-pickup-shelf.png`。
- 019 地窖木架：`key-socket` / `shelf-interact` 位置见 `art/source/env/README-s2-layout.md`。

## 道具和场景的假设（汇总，全部是脚本参数，改了告诉我就重新生成）

| clip | 假设 | 来源 |
|---|---|---|
| 提灯类 | 灯挂 `hand_r_socket`，`prop-lantern-brass.glb` 提手原点直接挂，不加偏移 | 016 |
| `xi-stairs-*` | 每级高 0.20、深 0.26 | S2/S3 楼梯 |
| `xi-step-across` | 缝在前方 0.20–0.70 m（宽 0.5） | 自定 |
| `xi-push-*` | 推面在前方 0.48 m，掌心高 0.62、左右 ±0.17；浮台和汐同速 0.8 m/s | 自定（浮台未做） |
| `xi-ring-bell` | 接触点 [−0.04, 1.10, 0.72]，钟在接触高度半径约 0.26 | 自定（钟未做） |
| `xi-place` / `xi-pickup` | 灯台 021 `prop-lantern-stand-s2`，提手 1.008 m，前方 **0.65 m**（返工 2026-10-29：灯台模型向汐挪 5 cm，原 0.70） | 021 |
| `xi-place-table` / `xi-pickup-table` | 桌面 0.75，提手 1.03 m，前方 0.45 m、偏右 5 cm | S2 书桌 |
| `xi-pickup-shelf` | 架面 1.10，钥匙 9 × 2.4 × 0.6 cm 平放，前方 0.45 m、偏右 5 cm；架板深 0.42，立柱 5 cm | S2 地窖木架；钥匙 021 `prop-key-cellar-s2`（9.5 cm，厚 6 mm） |
| `xi-operate-loop` | 两侧竖把手 [±0.27, 1.05, 0.40] | 自定（立镜 / 拨盘未做） |
| `xi-valve-hold` | `valve-wheel` 中心 [0, 0.70, 0.40]，半径 0.15，逆时针 90°，2.0 s | 015/020/022（底层地面 0.2、阀心 0.9 → 离站立面 0.70；返工 2026-10-29） |
| `xi-ignite-lever` | `ignite-lever` 枢轴 [0.15, 0.74, 0.55]，杆长 0.30，静止倾 30°，绕 +X −60° | 策划初始值，给 022 |
| `xi-read-loop` | 纸 16 × 22 cm，中心 [0, 0.985, 0.27] | 自定 |
| `xi-observe` | 窗台面 0.90，内沿前方 0.25 m | S2 二层西窗 |
| `xi-row-boat` | 座面 0.35；桨架 [±0.56, 0.525, 0.22]；桨 2.5 m（内 0.50 / 外 2.00 / 握点 0.46）；水面 0.105；脚蹬在前方 0.5 m | 座高：制作人；其他自定（船上没有桨架） |
| `xi-tie-boat` | 系船桩 r 0.16、高出桥面 0.85，中心前方 0.37 m；绕绳高 0.52–0.62 | S1 码头系船桩 |
| `xi-sit-write` | 座面 0.45，桌面 0.75，桌前沿前方 0.22 m，日志中心前方 0.38 m | 制作人；灯室桌椅按此新做 |
| `xi-stand-gaze` | 矮墙内面在前方 0.45 m，墙顶 0.7 m | S3 灯室 |

## 重新生成

```
/home/box/tools/blender/blender --background --python art/source/characters/build_xi_anims.py -- build check --batch=3
node art/tools/finish-xi-anims.mjs              # → char-xi-anims.glb（删冗余通道、加 extras、Meshopt）
node art/tools/verify-xi-anims.mjs --batch=3    # 绑定和数值自检
# 注意：build 默认只生成第 1 批；--batch=N 生成第 1…N 批，完整 31 个 clip 要 --batch=3
node art/tools/render-preview-web.mjs --anims jobs.json   # 联系表，页面是 art/tools/preview/anims.html（第 3 批的纸 / 笔 / 桨 / 系船桩也在里面画）
```

- 源文件 `art/source/characters/char-xi-anims.blend`（31 个 action，每个是一条静音 NLA 轨，可在 Blender 里逐条预览）由脚本生成，不要手动编辑。改动画就改 `build_xi_anims.py` 里的参数（`GAIT_WALK`、`GAIT_JOG`、`idle_spec` 等）。
- 进度见 `art/source/characters/PROGRESS-017.md`。
