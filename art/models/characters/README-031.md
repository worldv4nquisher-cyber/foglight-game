# README-031 · 父亲（回忆剪影 NPC）`char-father`

需求单：`docs/tasks/v0.1-031-npc-father-silhouette.md`。剪影 / 半透明渲染由程序在 035 用材质做；这里按普通角色交付。骨架、命名、坐标约定都和汐（016 / 017，见同目录 `README.md`）一样。

## 1. 文件

| 文件 | 内容 | 字节 |
|---|---|---|
| `art/models/characters/char-father.glb` | 模型 + 73 骨蒙皮 + LOD0–2，贴图外链 KTX2 | 1,006,852 |
| `art/models/characters/char-father-anims.glb` | 动画库：**只有骨架、没有网格**，3 个 clip，30 fps，原地，朝向 +Z，EXT_meshopt_compression | 176,144 |
| `art/textures/tex-father-albedo.ktx2` | 2048² UASTC，颜色 | 1,403,733 |
| `art/textures/tex-father-normal.ktx2` | 2048² 法线 | 1,134,628 |
| `art/textures/tex-father-orm.ktx2` | 2048² AO / 粗糙 / 金属 / A = 湿润遮罩 | 1,662,378 |
| **运行时合计** | 5 个文件 | **5,383,735（≈ 5.13 MB）** |
| `art/source/characters/char-father.blend` | 模型源文件 | 4,181,767 |
| `art/source/characters/char-father-anims.blend` | 动画源文件（由脚本生成） | 1,832,037 |
| `art/source/characters/char-father-anims.meta.json` | 动画元数据 + 自检原始数据 | 58,114 |

脚本：`build_char_father.py`（模型）、`gen_tex_char_father.py`（贴图）、`build_father_anims.py`（动画 + 自检）、`preview_father_anims.py` / `compose_char_father_r4.py`（预览）、`art/tools/finish-char-father.mjs`、`finish-father-anims.mjs`、`verify-father-anims.mjs`、`measure-father-hoh.mjs`（R4b：手贴汐头发的逐帧测量）。

## 2. 模型

| 项 | 值 |
|---|---|
| 身高 | 1.79 m（根 extras `heightM`），朝向 +Z，单位 m |
| 骨架 | 73 骨，和汐同名同层级（根 extras `skeleton: char-xi`、`rig: char-father`）；比例不同，所以**不能直接共用汐的动画**，要用 `char-father-anims.glb` |
| 三角面 | lod0 **55,870**（≤ 60k）/ lod1 **24,000**（≤ 25k）/ lod2 **11,999** |
| COLOR_0 | 外扩描边平滑法线（同汐的约定，加载后关 vertexColors） |

R5 修复（2026-10-30）：
| 问题 | 原因 | 修法 |
|---|---|---|
| 帽子、翻边面朝里（LOD0/LOD2 体积为负，沿法线射线 100% 打到头） | 网格行序是帽口 → 帽顶，和头部 ph 方向相反，`grid()` 出来的绕序反了 | `build_hat` 里两块都翻转绕序 `(a,d,c,b)`；保留起点，三角化对角线不变（帽顶一行收成一点，用 `[::-1]` 会把退化三角换到另一半，烘焙留下 30 个黑洞） |
| 领子两块 9 面小件 UV 面积 0（烘焙变黑） | 端盖 UV 写成常数 0.01 | 端盖按自身平面投影（SVD 前两轴）出 UV |
| 耳朵 UV 面积 0 | 耳朵和头共用 `mat-char-father-skin`，只有 UVMap 一层，但所有 UV 都写到同一点（`pcol` 只是预览色，不导出） | 耳朵拆成 `build_ears()`，按弧长出网格 UV，放进皮肤“其余”区（u 0.25–1，v 0–0.25）打包；权重跟头一样 |
| BUG-024 袖口翻边上沿透光缝（约 4 mm，左右袖都有） | 袖筒止于腕前约 4.2–4.5 cm（半径 5.3–5.8 cm），翻边上沿从 4.0 cm 开始（半径 5.2 cm），中间一圈 2–5 mm 环缝、没重叠；袖筒单面，看进去是背面 → 透光 | `build_sleeve` 给翻边加一圈内衬（单独一块，腕前 7.2 → 3.4 cm，半径约 5.0 cm）：上端藏在袖筒里，下端夹在翻边两层之间；原袖子 / 翻边顶点不动。射线复查：静止、walk、hand-on-head 左右袖缝带 0 条透光 |
骨骼名/头尾/父子、LOD0 权重与改前逐顶点一致（BUG-024 只多了内衬 200 个顶点，权重按同一规则），`char-father-anims.glb` 照常可用（verify-father-anims 全部通过）。改前 / 改后：`preview/char-father-r5-model-fix.png`、`preview/char-father-bug024-cuff.png`。

### 材质（2 个）
| 材质 | 用在 | 贴图 / 参数 |
|---|---|---|
| `mat-char-father-body` | 雨衣、帽、裤、靴、头发 | albedo / normal / ORM；`toonRamp: tex-ramp-char`；`wetMask: ORM.a` |
| `mat-char-father-skin` | 脸、手 | 同一套图集，`faceUV`；**没有 SDF 脸部阴影图**（031 没要求，R3 已确认） |

### 挂点
| 挂点 | 父骨 | 局部平移 | 局部旋转 |
|---|---|---|---|
| `hand_r_socket` | `hand_r` | (-0.0298, 0.0893, 0) | 同汐 `hand_r_socket`（glTF xyzw [-0.7071, 0, -0.7071, 0]） |

> **R4 修正**：R3 交付的 `char-father.glb` 里 `hand_r_socket` 离手约 1 m（脚本读 matrix_world 之前没刷新场景）。R4 已修了脚本、blend 和 GLB（只改了这个节点的 TRS）。用过 R3 版的请换新文件。031 的三个动作都**不拿东西**，挂点只是留给后续用的。

## 3. 动画 `char-father-anims.glb`

用法同汐：加载 `char-father.glb` 和 `char-father-anims.glb`，把后者的 `animations` 交给前者场景的 `AnimationMixer`，轨道按节点名绑定。73 个关节的静止 TRS 两边一致（已验证）；值等于静止值的轨道都去掉了（保留 185 条）。

| clip | 帧 | 时长 | 循环 | 说明 |
|---|---|---|---|---|
| `father-stand-gaze` | 241 | 8.0 s | LoopRepeat（首帧 = 末帧） | 灯室窗前眺望：双手背在身后，重心慢慢换，左右看 |
| `father-walk-away` | 35 | 1.133 s（周期 34 帧） | LoopRepeat（首帧 = 末帧） | 原地走，**不提灯**。`strideSpeed` 1.3 m/s，步长 1.4733 m；`footsteps` 左脚第 0 帧、右脚第 17 帧落地 |
| `father-hand-on-head` | 181 | 6.0 s | LoopOnce + clampWhenFinished | 抬右手放到汐头顶，摸两下，收手 |

clip extras：`loop`、`frames`、`durationS`、`fps`、`bakedSecondary`；走路另有 `strideSpeed` / `strideM` / `cycleFrames` / `footsteps`；hand-on-head 另有 `events`（秒）/ `eventFrames` / `align`。

hand-on-head 事件：

| 事件 | 帧 | 秒 |
|---|---|---|
| reachStart | 20 | 0.667 |
| handOn | 56 | 1.867 |
| strokeA | 66 | 2.200 |
| strokeB | 98 | 3.267 |
| handOff | 136 | 4.533 |
| armDown | 170 | 5.667 |

### 雨衣跟腿 / 次级运动
- 次级运动（雨衣、兜帽、披肩等 12 根骨，根 extras `swingBones`）已经烘进 clip，**运行时不用再做布料**。
- `coat_*` 骨按腿的位置逐帧转动：前片挡在前摆腿的大腿 / 膝盖前面，后片挡在后摆腿后面，侧片跟着同侧的前后片转，并且在腿外展时往外摆。walk 最大转角：前片 39°，后片 27°，侧片 25°。
- 和汐不同的一处：父亲雨衣的重力目标按「静止垂坠」计算，所以站着时下摆保持布料模拟时的外扩形状，不往腿上收。

## 4. hand-on-head 与汐配合（摆放 + 时间轴）

**摆放**（也写在 clip extras `align.handOnHead` 里）：
| | 位置 | 朝向 |
|---|---|---|
| 汐根 | 原点 (0, 0, 0) | 面朝 +Z |
| 父亲根 | 汐局部 (0, 0, **0.48**) | 绕 Y 转 **180°**（面朝汐） |
| 反过来 | 汐根 = 父亲局部 (0, 0, 0.48)，绕 Y 180° | |

**时间轴**：两人**同一帧开始**播放，帧号一一对应。
- 父亲：`father-hand-on-head`，LoopOnce，clampWhenFinished（停在末帧）。
- 汐：`xi-stand-gaze`，从第 0 帧开始，LoopRepeat。
- 两段都是 181 帧，换成别的汐 clip、换起始帧或换距离，手都会对不上。

模型用当前的 `char-xi.glb` 和 `char-xi-anims.glb`：手掌按汐 `xi-stand-gaze` 的头部轨迹逐帧跟随（R4b）：
- 掌面贴着汐头发的真实外表面（逐帧沿射线取发面点，掌面法线 = 发面在掌根 → 指根方向上的弦，再加逐帧俯仰 4–13°），掌心目标压进 0.2 cm；
- 手指在 0–1.4 rad 内逐节弯曲顺着头型，目标压进 0.3 cm（拇指 0.4 cm），不反折；
- strokeA/B 的前后抚摸量、事件帧、片段时长、站位都没有改。

实测（`node art/tools/measure-father-hoh.mjs`，three.js 加载游戏里的 GLB：汐全部网格 × 父亲手掌 + 五指蒙皮顶点；按汐头心径向量，负数 = 压进发面）：
| 第 56–136 帧（81 帧） | 最小 | 中位 | 最大 |
|---|---|---|---|
| 掌心（掌面法线方向最低点） | −0.29 cm | −0.10 cm | +0.34 cm |
| 食指 / 中指 / 无名指 / 小指（各指最低点） | −0.73 cm | −0.30 cm | +0.10 cm |
| 拇指 | −0.53 cm | −0.40 cm | −0.18 cm |
| 整只手最深点 | −0.78 cm | −0.51 cm | −0.22 cm |
| 离汐头皮（> 0 = 没穿到头皮） | 0.10 cm | 0.24 cm | 0.45 cm |
- 有缝的帧（掌心 > 0.5 cm，或 4 指里 ≥ 3 指贴住的指节不到一半）：**0 / 81**；穿到头皮：**0 帧**。
- 最深点超过 0.5 cm 的只是掌缘或中指尖的几个顶点（汐头发顶部厚约 1.0 cm），最多 0.78 cm。
- R4 原来写的“≤ 0.3 cm”是顶点到顶点的最近距离，只量到了拇指；按上面的方法重量，R4 版掌心悬空 2.8–5.2 cm，81 帧全部有缝。
- 改前 / 改后对比：`preview/char-father-r4b-hand-contact.png`（侧面正交 #60/#80/#120 + 游戏镜头 #80/#110：汐身后 2 m、俯 15°、FOV 55°）。
- 抬手和收手途中：离汐头 ≥ 11.1 cm。
- 2026-10-31 复测（char-xi.glb 02:59 版，汐发面变厚约 2 mm）：有缝 0/81、离头皮 ≥ 0.10 cm 不变；掌心 −0.64 / −0.34 / +0.50 cm，四指中位 −0.34…−0.47 cm，最深 −0.97 cm（动画按 char-xi-anims.blend 解，它没跟着改）。
- 父亲身体离汐 ≥ 9.7 cm。

## 5. 分包
归 **s3**（父亲只在 S3 灯室出现）。`game/scripts/lib/size-groups.mjs` 的 `CHAR_SCENE {'char-father': 's3'}` 按前缀匹配，`char-father.glb` 和 `char-father-anims.glb` 都会被分到 s3。
**注意**：`tex-father-*.ktx2` 用 `guessGroup` 判出来是 **s1**（不匹配 `char-father` 前缀）。需要程序在 `CHAR_SCENE` 里加 `'tex-father': 's3'`，或者按 GLB 的引用关系归组。美术这边没有改 game/。

## 6. 重跑
```
B=/home/box/tools/blender/blender; cd /workspace/game-studio
$B -b --factory-startup --python art/source/characters/build_father_anims.py -- build check     # 约 5 min；自检结果写进 meta.json，同时打 CHECK 行
node art/tools/finish-father-anims.mjs        # /tmp/father/anim/char-father-anims-raw.glb → char-father-anims.glb
node art/tools/verify-father-anims.mjs        # 名字、循环、绑定、静止 TRS、挂点、走路触地速度、和汐配合
node art/tools/measure-father-hoh.mjs [--json out.json]   # 第 56–136 帧手掌/五指到汐发面、头皮的距离
python3 art/source/characters/compose_char_father_r4.py   # 预览 preview/char-father-r4-*.png（约 4 min）
```
模型、贴图的重跑步骤见 `/workspace/b031/PROGRESS.md` R3 一节。

## 7. 自检（对照 031 验收标准）
| 验收项 | 结果 | 依据 |
|---|---|---|
| lod0 ≤ 60k、lod1 ≤ 25k；贴图 ≤ 2048 | ✅ 55,870 / 24,000（lod2 11,999）；3 张都是 2048² | verify-lod、verify-glb-ktx2：0 错 0 警 |
| 3 个动画 clip 存在、命名一致 | ✅ father-stand-gaze / father-walk-away / father-hand-on-head | verify-father-anims 全部通过 |
| 与汐放在一起比例协调、风格统一 | ⏳ 等制作人截图验收 | preview/char-father-r3-*.png、r4-hand-on-head.png（两人同框） |

额外自检（R4 要求）：
| 项 | 结果 |
|---|---|
| 原地、+Z、30 fps、meshopt、循环首尾一致 | ✅ 根位移 0；循环 clip 首尾四元数差 ≤ 8e-8 |
| 走路触地速度 | ✅ 1.300 m/s（标称 1.3），Blender 实测脚底滑移 ≤ 0.029 m/s |
| 脚不入地 | ✅ 鞋底最低 z = 0 |
| 腿不穿出下摆 | ✅ stand-gaze 0 处，hand-on-head 0 处；walk 的射线检测有 65 个顶点采样 ≤ 1.9 cm，都在下摆边缘（小腿后侧、大腿根前外侧），预览图里看不到 |
| 手不插进雨衣（背手） | ✅ 0 |
| hand-on-head 对汐 | ✅ 见第 4 节 |
| 走路不提灯 | ✅ 动画文件里没有道具和网格 |
