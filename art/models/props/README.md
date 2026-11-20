# art/models/props — 道具交付说明

其余道具（风灯、灯台、地窖钥匙、船）的说明见 `art/tools/README.md` §0；这里记 021 潮汐钟、木筏（2026-10-30）。

## prop-tide-bell.glb — 潮汐钟（021，S1 / S3 共用，同一尺寸、不缩放）

- 文件：`art/models/props/prop-tide-bell.glb`（153 KB，Meshopt + 量化）+ 外置 KTX2 `art/textures/tex-prop-tide-bell-{albedo,normal,orm}.ktx2`（2048，约 0.6 / 4.1 / 3.6 MB）。
- 一种材质 `mat-prop-tide-bell`（铜 / 石柱 / 熟铁共用一张图集）。材质 extras `wetMetal: true, specStepped: true, specColor #DCE1E4`：湿铜要一道冷色阶梯高光，023 toon 替换时按湿金属处理；石、铁的 ORM 金属度为 0。
- `COLOR_0` = 描边用的平滑法线：加载后要关 `vertexColors`。
- **puzzleCritical = true，只有 LOD0**（需求单 021 通用要求：钟是解谜关键件，只做 LOD0），共 13,820 三角面（静态 1,952 + 可动 11,868），预算 ≤ 15k。

### 坐标
+Y 向上，1 单位 = 1 m。
- **根原点 `originAt`** = 钟轴正下方的站台面点（y 0 = 台面）。对齐场景挂点时直接放根节点，不加偏移。
- +Z 是正面，朝汐。石柱在 −X，也就是汐的左手边。
- 总高 2.205 m，吊点（销轴）在 y 1.80，钟口在 y 0.892、半径 0.314。

### 节点

| 节点 | 局部位置 | 说明 |
|---|---|---|
| `prop-tide-bell`（根） | 0 | extras：puzzleCritical、originAt、front、contact、swingNode、clapperNode、focus [0, 1.35, 0]、heightM、hangPointY 1.80、**clapperHitRad 0.0537** |
| `prop-tide-bell_lod0` | — | 静态：底座、石柱（刻刻度 + 父亲手刻的「涨 / 落」）、铁箍、挑臂、叉板、销轴 |
| `prop-tide-bell-collider` | — | 两个盒子（柱 + 钟），`extras.collider` |
| `prop-tide-bell-interact` | [0, 0, 0.98]，转 180°（+Z 朝钟） | 汐的站位。extras：anim `xi-ring-bell`，events {touch 22, ring 30}，contact [−0.04, 1.10, 0.72]（汐局部坐标） |
| `prop-tide-bell-contact` | [0.04, 1.10, 0.26] | 钟静止时的掌心触点：离台面 1.10，此处钟外半径 0.2635 |
| `bell-swing` | [0, 1.80, 0] | **空节点，原点 = 吊点 = 转轴**。绕**本地 +X** 摆；正角时钟口往 −Z（被汐推开的方向）。子节点 `bell-swing-mesh` 是钟体 |
| `bell-clapper` | bell-swing 下 [0, −0.28, 0]（模型 y 1.52） | 空节点，钟锤吊点。相对 bell-swing 绕本地 +X 摆，长 0.53。相对角 \|0.0537\| rad 时锤头碰内壁（网格实测）。子节点 `bell-clapper-mesh`。锤头为扁球铁坨：半径 0.227、半高 0.06，中心在模型 y 0.99；静止时离内壁 3.0 cm |

可动节点都是空节点，网格挂在 `-mesh` 子节点上，量化不会挪动转轴。

### 动画参数
都写在 `bell-swing` / `bell-clapper` 的 extras 里。
- **xi-ring-bell**：第 22 帧（touch）起，钟跟着手掌转，θ = asin(掌心前推量 / 0.70)。到第 30 帧（ring）推 7 cm，约 +0.100 rad。
- **离手后自由摆**：θ(t) = 0.2 · e^(−t/1.2) · sin(2πt/1.5 + asin 0.5)，单位 rad，t 从 ring 帧算起。
- **钟锤**：建议滞后钟体约 0.12 s；碰壁的那一刻可以补一声。
- **碰壁角（2026-10-30 改）**：程序实测，滞后 0.12 s 跟摆时，钟锤相对钟体最大只有 0.061 rad（钟体最大 0.161）。所以锤头加大到碰壁角 0.0537 rad，在 0.055 以内，一次敲击只碰 1 次。这个角是拿打包后 GLB 的 `bell-clapper-mesh` 顶点绕吊点转、往 `bell-swing-mesh` 内壁射线测出来的（±θ 一样），写在根 extras.clapperHitRad 和 `bell-clapper` extras.strikeRad。旧的小球锤头（r 0.048）实际要 0.39 rad 才碰到（原先写的 0.41 是估的）。锤头底 y 0.93 在钟口 0.892 以上，正常视角只露出锤尖。
- **闲置**：风中轻摆 0.01 rad，周期 2.4 s（GDD：钟在风里微响）。
- **余量**：±0.35 rad 内不碰石柱和叉板。

### 场景摆放（核对 2026-10-30）
两处的点都已核对一致。

**S1**（`env-shore-ledge-s1-bell-anchor`）
- 世界位置 (−15.5, 2.4, −6.2)，yaw +π/2，四元数 [0, 0.7071, 0, 0.7071]。与 `s1-layout.json` points.bellAnchor 一致，`layout.ts` 也是这个点。
- 换算：交互点 (−14.52, 2.4, −6.2)，触点 (−15.24, 3.5, −6.24)，吊点 (−15.5, 4.2, −6.2)，摆轴 = 世界 −Z。
- 白盒交互点在钟前 1.05 m（x −14.45），比模型的 0.98 m 远 7 cm，需改用 0.98（或直接读 `-interact` 节点）。

**S3**（`env-rock-islet-a` 的 `tide-bell-s3-socket`）
- 世界位置 (−2.758, 2.4, −5.162)，yaw −π/4。
- 换算：交互点 (−3.451, 2.4, −4.469)，与 `tide-bell-s3-interact` 一致；触点 (−2.913, 3.5, −4.950)，与 socket extras 的 contactWorldLocal 一致；吊点 (−2.758, 4.2, −5.162)，摆轴 = 世界 (0.707, 0, 0.707)。

**接入**：游戏侧 `artSlots`（`at` 挂点、`drive bell-swing`）的约定和这个文件的名字一致，可直接用。

**originAt（2026-10-30 已补）**：`s1-layout.json` points 加了 `bellAnchorOriginAt`；S3 `tide-bell-s3-socket` extras 加了 `originAt`（`build-env-s3.mjs` 源数据 + 重建 `env-rock-islet-a.glb`，BIN 逐字节不变，JSON 只多这一个字段）。S1 环境 GLB 的 `env-shore-ledge-s1-bell-anchor` extras 没动。

### 重建
```bash
python3 art/source/props/gen_tex_tide_bell.py          # 2048 PNG（固定种子；形状读 prop-tide-bell.profile.json）
bash art/tools/tex-to-ktx2.sh art/source/textures/tex-prop-tide-bell-{albedo,normal,orm}.png   # 需 KTX-Software 在 PATH
node art/tools/build-props-ch1.mjs --only=prop-tide-bell
node art/tools/glb-pack-ktx2.mjs art/models/props/prop-tide-bell.glb
node art/tools/verify-glb-ktx2.mjs art/models/props/prop-tide-bell.glb && node game/scripts/verify-lod.mjs --budget=20000 art/models/props/prop-tide-bell.glb
node art/tools/render-preview-web.mjs --png --props bell,bell-side,bell-scale
```

### 预览图（`preview/`）
- `prop-tide-bell.png`：3/4 视角。
- `prop-tide-bell-swing-side.png`：侧视剖面（钟体只留 x≤0 半边，换成纯色材质），钟摆到真实幅度 0.2 rad，钟锤相对 −0.0537（刚碰内壁），叠一个静止虚影。
- `prop-tide-bell-scale.png`：石柱刻度特写。
- `prop-tide-bell-xi-ring.png`：xi-ring-bell 第 0 / 22 / 26 / 30 / 40 / 52 帧 × 3 个机位，用真模型（`anims.html` 有这个 GLB 时自动换上）。

## prop-raft-s1.glb — S1 搁浅木筏（021，推进石槽当桥）

- 文件：`art/models/props/prop-raft-s1.glb`（145 KB，Meshopt + 量化）+ 外置 KTX2 `art/textures/tex-prop-raft-s1-{albedo,normal,orm}.ktx2`（2048，约 0.6 / 3.8 / 1.8 MB）。
- 一种材质 `mat-prop-raft-s1`（旧木 / 原木 / 麻绳 / 熟铁共用一张图集，extras `wetWood: true`）。推把掌心处手磨发暗、粗糙度低；原木吃水线以下有藻和藤壶。`COLOR_0` = 描边平滑法线（加载后关 `vertexColors`）。
- **puzzleCritical = true，只有 LOD0**（需求单 021 规则），12,504 三角面，预算 ≤ 15k。

### 坐标
- **根原点 `originAt`** = 甲板顶面中心，等于白盒 `raft-s1` 根。`artSlots` 把美术根挂到 `raft-s1` 下，零变换、不缩放；轴向同世界，不旋转。
- 外形 2.0 (x) × 3.0 (z) × 0.30 (y 0 → −0.30)：9 块板顺 z 铺（跨越方向），3 道横梁 z −1.2 / 0 / 1.2，4 根原木 x ±0.24 / ±0.72。
- 除 +X 外，几何都在 |x| ≤ 1.0、|z| ≤ 1.5 内（实测 x −1.0..1.44、y −0.300..0.32、z ±1.499）。+X 是推的一侧，只有推把（到 x 0.97、高到 y 0.32）、系船环（x 1.09）和贴沙断缆（到 x 1.44）伸出去。石槽和挡坎都不碰：槽底到世界 x 0.62 = 本地 1.52。

### 节点

| 节点 | 局部位置 | 说明 |
|---|---|---|
| `prop-raft-s1`（根） | 0 | extras：puzzleCritical、originAt、sizeM [2, 0.3, 3]、deckGroundedY 0.4、deckFloatY 1.85、floatOffset 0.25、front、clearance |
| `prop-raft-s1_lod0` | — | 唯一渲染网格 |
| `prop-raft-s1-collider` | — | 盒 2.0 × 0.30 × 3.0，中心 y −0.15，顶面平 y 0。推把不进碰撞（同白盒） |
| `prop-raft-s1-waterline` | [0, −0.25, 0] | 漂浮时水面在此高度，甲板高出水面 0.25 |
| `prop-raft-s1-interact` | [1.45, −0.30, 0]，绕 Y −90°（四元数 [0, −0.7071, 0, 0.7071]，+Z 朝木筏 = 推向 −X） | 汐站位（沙面）。extras：anims start / loop / end = `xi-push-start` / `-loop` / `-end`，events {handsOn 26, handsOff 6}，speedMps 0.8，pushDir [−1, 0, 0]，pushFaceAheadM 0.48 |
| `prop-raft-s1-palm-l` / `-palm-r` | [0.97, 0.32, ±0.17] | 掌心触点：推把前面上缘，离沙 0.62。左手在 +Z |
| `prop-raft-s1-stand-s` / `-stand-n` | [0, 0, ∓1.18] | 跨越落脚点（中线）。extras.takeoff [0, 0, ∓1.35] = 离开时起跳点（XI_STEP_ACROSS） |
| `prop-raft-s1-ring` | [1.04, −0.135, −1.2] | 系船环中心，可接缆绳；现在只挂一截断缆，不参与逻辑 |

### S1 世界坐标（layout.ts：home [9.1, 0.4, 10.5] → slot [−0.9, 0.4, 10.5]，漂浮甲板 1.85）

| 节点 | 搁浅在 home | 进槽漂浮（tideHigh 1.6） |
|---|---|---|
| interact | (10.55, 0.10, 10.5)，与白盒 `raft-s1-interact` 一致 | — |
| palm-l / palm-r | (10.07, 0.72, 10.67) / (10.07, 0.72, 10.33) | — |
| stand-s / stand-n | (9.1, 0.4, 9.32) / (9.1, 0.4, 11.68) | (−0.9, 1.85, 9.32) / (−0.9, 1.85, 11.68) |
| waterline | (9.1, 0.15, 10.5) | (−0.9, 1.60, 10.5) = tideHigh |
| ring | (10.14, 0.265, 9.3) | (0.14, 1.715, 9.3) |

home → slot 共 10 m，按 0.8 m/s 推约 12.5 s。

**与白盒的差异**
- 白盒装饰板宽 2.1，美术板外缘 ±0.9955，横梁到 ±1.0，与 collider 2.0 一致。
- 白盒没有推把。美术推把只是视觉，不进碰撞，位置按动画对齐（离沙 0.62，在 interact 前 0.48）。
- 其余（根、collider、interact）同位同向。

### 重建
```bash
python3 art/source/props/gen_tex_raft.py                 # 2048 PNG（固定种子；复用 art/source/env/gen_tex_env_s1.py 的噪声 / 木纹）
bash art/tools/tex-to-ktx2.sh art/source/textures/tex-prop-raft-s1-{albedo,normal,orm}.png
node art/tools/build-props-ch1.mjs --only=prop-raft-s1
node art/tools/glb-pack-ktx2.mjs art/models/props/prop-raft-s1.glb
node art/tools/verify-glb-ktx2.mjs art/models/props/prop-raft-s1.glb && node game/scripts/verify-lod.mjs --budget=15000 art/models/props/prop-raft-s1.glb
node art/tools/render-preview-web.mjs --png --props raft,raft-float,raft-top
```

### 预览图（`preview/`）
- `prop-raft-s1.png`：搁浅在湿沙上，3/4 视角。
- `prop-raft-s1-float.png`：漂浮，水面 = `-waterline`。
- `prop-raft-s1-top.png`：正交俯视，+X 朝上。标记：交互点（红）、掌心（黄）、站立点（绿）、系船环（青）；白框 = collider，橙框 = 白盒 2.1 板宽，蓝框 = 石槽挡坎。
- `prop-raft-s1-xi-push.png`：start / loop / end，各取第 0 / 18 / 26 / 36 帧。
- `prop-raft-s1-xi-push-hands.png`：双手特写，start 第 26 / 0 / 12 / 24 帧、loop 第 26 / 0 / 12 / 24 帧。
- 两张 xi-push 图都用真模型（`anims.html` 有这个 GLB 就自动替掉占位方块），掌心对齐 palm 标记。

## prop-mirror-stand-s2.glb — S2 小院立镜 ×2（021，同一模型用两次）

石座 + 绕竖轴转的旧航标反射镜。三角面 2788（≤ 15k，只 LOD0），图集 tex-props-puzzle-ch1（stone / reflector / tin / tinCold / brass），平滑法线在 COLOR_0，根 extras `puzzleCritical: true`。

### 坐标 / 节点
- 根 = 石座底面中心，y 0 = 铺地顶面；+Z = 石座正面。镜面 0.70 × 0.80，镜心离地 **0.85**（= BEAM_Y）。
- `mirror-pivot`：(0, 0.85, 0)，原点在竖轴上、镜面过竖轴；单位旋转 = 法线 +Z（与白盒 yaw 0 同约定）。下挂转盘 + 铜指针、叉架、镜子、背后一对竖把手（全部随镜转）。
- `prop-mirror-stand-s2-mirror-plane`：pivot 原点，+Z = 镜面法线；镜背是深色铁背板，不反光。
- `prop-mirror-stand-s2-interact`：pivot 局部 (0, −0.85, −0.65)（地面、镜背后 0.65 m、+Z 朝镜），把手在 interact 局部 [±0.27, 1.05, 0.40]。**跟着镜子转**（推把手转镜）。
- `prop-mirror-stand-s2-collider`：根下，0.56 × 0.42 × 0.56 方盒（只给参考；碰撞仍用白盒）。
- 石座顶的铜刻度环每 15° 一刻（= 白盒档位）。可动节点不挂网格，网格挂在 `mirror-pivot-mesh` / `mirror-pivot-mirror-mesh`。

### 接入（对 `game/src/levels/s2/artSlots.ts` 现有槽位，不用改）
- `at`：`env-courtyard-wall-s2-mirror-a/b-socket`（本轮已加进 courtyard GLB，S2 局部 a (−13.2, 0, 3.0)、b (−7.2, 0, 8.6)，见 README-s2-layout）。
- `align`：`mirror-plane` ← `mirror-stand-s2-k-mirror-plane`；`drive`：`mirror-pivot` ← `mirror-stand-s2-k-yaw`（world）。

### 重建 / 预览
`node art/tools/build-props-ch1.mjs --only=prop-mirror-stand-s2` → `node art/tools/glb-pack-ktx2.mjs art/models/props/prop-mirror-stand-s2.glb`；预览 `render-preview-web.mjs --props mirror,mirror-back` → `preview/prop-mirror-stand-s2{,-back}.png`（转到 A 正解 30°；红 = interact、青 = mirror-plane、黄 = 光线）。

## prop-guide-mirror-wall-s3-a.glb / -b.glb — S3 导光镜 1 / 2（022，**两个变体**）

楼梯平台内沿的转柄柱 + 伸进楼梯井的铁臂 + 叉架上的 0.70 × 0.70 反射镜，俯仰固定做进支架。各 2894 面（≤ 15k），同一图集，根 extras `puzzleCritical: true`。

### 为什么做两个变体（不是一个模型用两处）
- 程序现行槽位把模型根挂在白盒组 `guide-mirror-s3-mid-k`（= S3 原点、单位旋转），偏航用 copy、只对齐镜面位置。两处支架朝向差 150°（θ140 / θ350），固定俯仰也不同（−1.1° / +4.4°）。
- 单一模型得让程序额外给根转朝向、再按处改俯仰。两个变体则不用改程序逻辑，只要 manifest 里登记两个 key。
- **程序要做**：manifest 的 `prop-guide-mirror-wall-s3` 拆成 `prop-guide-mirror-wall-s3-a` / `-b`。槽位 `key` 按 `${k}` 取对应文件，其余不变。

| 变体 | θ | 镜心（S3 局部） | 平台 y | 固定俯仰 | 正解 ψ（= 白盒 yaw.rotation.y） | layout artYawDeg |
|---|---|---|---|---|---|---|
| a | 140 | (−0.9959, 10.6, 0.8356) | 10 | −1.1° | 109.777° | −19.777 |
| b | 350 | (1.2803, 16.6, −0.2257) | 16 | +4.4° | −70.755° | 160.755 |

ψ 从 +Z 往 +X 量；artYawDeg 是同一法线从 +X 往 +Z 量（verify-s3 的口径），ψ = 90 − artYawDeg。

### 坐标 / 节点（根 = 镜心，轴向 = S3 局部，不旋转）
- `mirror-pivot`：根原点（竖轴上），单位旋转 = 法线 +Z。下挂转轴、叉架、俯仰扇形夹板。
- `mirror-pitch`：pivot 下，rotation.x = −pitch（a +1.1°、b −4.4°，即法线上仰 −1.1° / +4.4°），**固定，程序不要转**。下挂镜子。
- `prop-guide-mirror-wall-s3-k-mirror-plane`：mirror-pitch 原点，+Z = 法线。
- `prop-guide-mirror-wall-s3-k-interact`：平台面（局部 y −0.6）、径向 r 2.6，+Z 朝楼梯井。S3 局部 a (−1.992, 10.0, 1.671)、b (2.561, 16.0, −0.451)。把手在转柄柱上（interact 局部 [±0.27, 1.05, 0.40]）。
- `-collider`：根下，转柄柱 + 把手的方盒。静态支架（柱 r 2.08 → 臂在镜下 0.52 伸到竖轴）在 `_lod0`。
- **没有 `mirror-yaw`**：022 验收条里的 `mirror-yaw` / `mirror-pitch` 双轴是底层窗口镜的。导光镜是单轴，偏航节点就是 `mirror-pivot`，`mirror-pitch` 只是固定俯仰。

### 光路复核（实际 GLB，`node art/tools/check-s3-guide-mirrors.mjs`）
- 按槽位挂法（根挂白盒组、对齐 mirror-plane、copy 偏航到正解）走 W → A → B：命中 A 离镜心 0.000 m，命中 B 离镜心 0.028 m，两处都在反射面网格内。
- 出射光离点火口 **0.0086 m**（≤ 0.3，白盒 0.009）。
- 遮挡：L0→W / W→A / A→B / B→点火口 都没碰到两件支架。最近余量 W→A 0.12 m（A 的铁臂）、A→B 0.15 m（B 的支架）。

### 重建 / 预览
`--only=prop-guide-mirror-wall-s3-a,prop-guide-mirror-wall-s3-b`，打包同上；预览 `--props guide-a,guide-b` → `preview/prop-guide-mirror-wall-s3-{a,b}.png`（正解角；蓝圈 = 楼梯内沿 r 2 / 外沿 r 3）。

## prop-dial-gate-s2.glb — S2 三拨盘铁门（021，密码 317）

门扇 1.6 × 1.9（竖栏 + 矛尖，顶 1.885）、南面锁板上三个铜拨盘。9022 面（≤ 15k），同一图集，根 extras `puzzleCritical: true`、`code: '317'`。

### 坐标 / 节点
- 根 = 门洞中心地面 = `env-clifftop-s2-gate-socket`（S2 (4.2, 0, 11.75)，+Z 北 = 门外）。
- `gate-door`：根局部 (0.8, 0, 0) = 铰链轴 = 白盒 `s2-dial-gate-hinge` (5.0, 0, 11.75)。门扇沿本地 −X，绕 +Y 转 +78° 向北开（程序核对定稿；extras `openDeg: 78`）。
- `dial-0/1/2`：gate-door 局部 (−0.35 / −0.80 / −1.25, 1.15, −0.028)，S2 世界 x 4.65 / 4.20 / 3.75（= 白盒 `dial-gate-s2-dial-1/2/3`，从南面看左 → 右）。原点在转轴，绕本地 Z 转。
  - 每 36° 一个数字，0 朝上（铜指针）。从南面看数字顺时针排，拨盘逆时针转 36k° 后数字 k 到指针下（rotation.z = −36k°），与白盒同向。
  - 密码 3 / 1 / 7 对应 dial-0 / 1 / 2。
- `prop-dial-gate-s2-collider`：**在 gate-door 下**（跟门扇转），1.58 × 1.85 × 0.1。
- `prop-dial-gate-s2-interact`：根局部 (0, 0, −0.485)（门南面地面、+Z 朝门）。把手在中间拨盘两侧，interact 局部 [±0.27, 1.05, 0.40]。
- 可动节点不挂网格（`gate-door-mesh`、`dial-k-mesh`）。

### 和 S2 layout / 白盒核对
- 铰链、门宽 1.6、高 1.9、拨盘 y 1.15、x 4.65 / 4.2 / 3.75、密码 [3, 1, 7]：一致。开角按程序核对定为 **78°**（向北）。
- 拨盘盘面 z 比白盒浅 7 cm（白盒门厚 0.1，这里门扇 0.03 + 锁板）。程序用 delta 驱动，位置不受影响。
- 白盒站位 (4.2, 0, 10.85) 离门 0.9 m，这里 interact 离门 0.485 m（按把手 0.40 + 门面）。程序可以继续用白盒站位，或改用 interact 节点。
- 门柱内侧在 x 3.4 / 5.0，门扇 x 3.42 → 5.0 正好嵌进。原来的 95° 会擦到西门柱，程序核对后最终开角改为 78°（2026-10-30）。

### 接入（对 `game/src/levels/s2/artSlots.ts` 现有槽位，不用改）
`at` = `env-clifftop-s2-gate-socket`，`align` gate-door ← `s2-dial-gate-hinge`，`drive` gate-door / dial-0/1/2 ← 白盒（delta）。

### 重建 / 预览
`--only=prop-dial-gate-s2`，打包同上；预览 `--props gate,gate-open,gate-dials,gate-dial-close` → `preview/prop-dial-gate-s2{,-open,-dials-317,-dial-1-close}.png`（半透明方块 = 门柱示意，绿 = 铰链，红 = interact）。

## prop-light-lock-s2.glb — S2 地窖光感锁（021）

铜框铁板 + 圆透镜 + 上方小表盘 + 下方插销。1572 面，tex-props-puzzle-ch1 图集，根 extras `puzzleCritical: true`。

### 坐标 / 节点
- 根 = `env-keeper-house-ch1-light-lock-socket`（S2 (−4.8, 0.85, 4.0)，+Z 北 = 墙外）= 透镜光轴与墙外表面交点，高 0.85。
- `prop-light-lock-s2-receiver`：根原点 = 白盒 `light-lock-s2-receiver`（align 零位移）。透镜球冠从这里朝 +Z 鼓出 0.105，半径 0.10。
- `light-lock-lens`：只有它用 **`mat-prop-light-lock-lens`**（独立材质，无贴图，emissive 初值 0）。程序按受光进度 0–1 提亮：`emissive = #F4C978 × progress × 1.6`（建议值，材质 extras 里有）。
- 状态部件（可选驱动，不驱动也能用）：
  - `light-lock-needle`：表盘指针，rotation.z = (60 − 120 × progress)°。
  - `light-lock-bolt`：插销，解锁时 position.x 0 → 0.08。
- `-interact`：锁正前方 0.8 m 地面，只做查看提示（§5.4 要求 puzzleCritical 有这个节点），程序可忽略。
- `-collider`：贴墙的薄盒。

### 接入（`game/src/levels/s2/artSlots.ts` 现有槽位，不用改）
`at` socket，`align` receiver ← `light-lock-s2-receiver`。透镜提亮：找 `light-lock-lens` 的材质，或按材质名 `mat-prop-light-lock-lens` 找，设 `emissive` / `emissiveIntensity`。

### 预览
`--props lock,lock-lit` → `preview/prop-light-lock-s2{,-lit}.png`（进度 0 / 1）。

## prop-oil-valve-s3.glb — S3 机房油阀（022）

墙装手轮阀 + 竖油管。3230 面，复用潮汐钟湿铜贴图（tex-prop-tide-bell），local y < 0.7 有水淹湿痕和藤壶。

### 坐标 / 节点
- 根 = 手轮中心（阀心）= `oil-valve-s3-socket`（S3 (0.9919, 0.9, 2.7251)，rotY −160°），离机房地面 0.70。+Z 朝站位（塔中心），−Z 是墙（墙离阀心约 0.10）。
- `valve-wheel`：原点 = 根原点，绕本地 +Z 转；半径 0.15。开阀 = 从站位看逆时针 = +90°（2 s）。网格挂在子节点 `valve-wheel-mesh` 上。
- `-interact`：本地 [0, −0.7, 0.4]，即手轮正前方 0.40 m 的地面，+Z 朝手轮。anim `xi-valve-hold`。双手位于轮缘 165° / 15°（角色 README）。
- `-collider`：管 + 阀体。

### 接入（S3 `artSlots.ts` 现有槽位，不用改）
`at` `oil-valve-s3-socket`，`drive` valve-wheel ← `oil-valve-s3-wheel`（delta）。

### 预览
`--props valve,valve-open`。绿点 = 手位（165° / 15°），青线 = 涨潮水面。

## prop-guide-mirror-window-s3.glb — S3 底层窗口镜（双轴，022）

石座 + 转盘 + 叉架 + 0.6 × 0.6 镜（镜框 0.025），座两侧一对竖把手。2590 面，tex-props-puzzle-ch1 图集。

### 坐标 / 节点
- 根 = 窗口镜 socket (2.35, 1.0, 0)（不旋转），本地 −0.8 = 机房地面 0.2。
- `mirror-yaw`：(0, 0.35, 0) = 镜心 S3 (2.35, 1.35, 0)，绕 Y 转；单位旋转 = 法线 +Z。
- `mirror-pitch`（yaw 的子节点）：原点 = 镜心（耳轴），绕 X 转；单位旋转 = 镜面竖直，**rotation.x = −仰角**（和白盒 beam.ts 一致）。
- `prop-guide-mirror-window-s3-mirror-plane`：pitch 的子节点，在镜心，+Z 法线。
- 两轴独立，都不改动原点。转盘十字撑在镜面最低点下方 7 mm；把手在半径 0.57，镜子扫过的半径是 0.46，碰不到。
- 正解：`mirror-yaw.rotation.y = 74.21°`，`mirror-pitch.rotation.x = −66.35°`，即 plannedNormals yaw 15.8 / pitch 66.3。
- `-interact`：本地 (−0.9, −0.8, 0)，+Z 朝镜（RY 90°），站在西侧地面上。
- 把手中心在 interact 本地 [±0.27, 1.05, 0.40]，即根本地 (−0.5, 0.25, ±0.27)。

### 光路复核（实际 GLB，`/workspace/rope-check/s3path-b3.mjs`）
- 窗口镜按上面的解，导光镜 A / B 按最佳偏航，点火口装在翻转 socket 上，拉杆分别在静止和拉到底两种状态测。
- L0→W、W→A、A→B、B→点火口四段遮挡都是 0；落点离点火口 0.009 m。
- 最近余量：L0→W 0.33 m，W→A 0.12 m（导光镜 A 支架）。

### 接入（S3 `artSlots.ts` 现有槽位，不用改）
`at` `guide-mirror-s3-window`，`align` mirror-plane ← 白盒镜面，`drive` mirror-yaw / mirror-pitch ← 白盒 yaw / pitch（copy）。

注意：石座比白盒 0.36 方块碰撞大，美术 `-collider` 已经包住石座，建议用它。

### 预览
`--props window,window-side`：黄线 = L0 → 镜 → A，青线 = 法线，绿点 = 把手中心。

## prop-ignition-port-s3.glb — S3 灯室点火口 + 点火拉杆（022）

点火口透镜罩 + 拉杆机匣 + 油管，同一套铜铁锈蚀材质（tex-props-puzzle-ch1）。2656 面。

### 坐标 / 节点
- 根 = `ignition-port-s3-socket` (0, 21.85, 0)，socket 是**翻转的**（四元数 [1, 0, 0, 0]）。所以根本地 +Y = 世界向下；下面的世界坐标都已经换算好。
- `prop-ignition-port-s3-receiver`：根原点 = 透镜中心（align 零位移）。
- 发光：两个部件共用 **`mat-prop-ignition-glow`**（独立材质，无贴图）：
  - `ignition-glow-lens`：朝下的透镜，从楼梯井仰视可见。
  - `ignition-glow-sight`：拉杆机匣 +X 面的观察窗，离灯室地面 0.33。
  - 为什么加观察窗：透镜在主灯铸铁底座正下方，灯室里看不到；观察窗让站在拉杆旁的汐也能看到同一个状态。
  - 四态写在材质 extras.states，程序改 `emissive` / `emissiveIntensity`：

    | 状态 | emissive | 强度（建议） |
    |---|---|---|
    | 熄灭 | 黑 | 0 |
    | 没有油 | #C8382A | 0.6 |
    | 可点灯 | #DCE6EE | 0.15–0.35 呼吸（周期 4 s）+ 程序 20 s 一次的脉冲 |
    | 点燃 | #FFB25E | 2.0 |

- `ignite-lever`：原点 = 枢轴 S3 (0.9, 22.74, 0)，世界旋转 = RY(−90°)（和白盒 `ignite-lever-socket` 同向），本地旋转 = RX(180°)·RY(−90°)。
  - 杆长 0.30。拉动 = 绕节点本地 +X 转 −60°。
  - 握点实测：静止 (1.05, 23.0, 0)，拉到底 (1.2, 22.74, 0)，对上 `xi-ignite-lever` 第 34 帧。
  - 枢轴到纸条 1.977 m，interact 到 `ignition-note-read` 2.408 m（都 ≥ 1.5）。
- `-interact`：= env `ignite-lever-interact` (1.45, 22, −0.15)，朝 −X，anim `xi-ignite-lever`。
- `-collider`：机匣 + 透镜罩。

### 接入（S3 `artSlots.ts` 现有槽位，不用改）
`at` socket，`align` receiver，`drive` ignite-lever ← `ignite-lever-s3-swing`（delta），`hide` 白盒拉杆。四态：按材质名或 `glowNode: true` 的节点找到材质，改 emissive。

### 预览
`--props ignite,ignite-pulled,ignite-below`：静止 + 红，拉到底 + 暖，从楼梯井仰视 + 冷白。半透明 = 主灯底座示意，绿 = 握点（静止 / 拉到底），黄 = 纸条。

## prop-lighthouse-door-s3.glb — S3 塔门（022）

用 020 门扇 `env-lighthouse-ch1-door` 的 LOD0 网格（外观、材质 mat-env-wood-ch1 不变），加锁孔。2138 面，无 LOD。由 `art/tools/build-door-lighthouse-s3.mjs` 生成。

### 坐标 / 节点
- 根 = 铰链线底端 = `door-s3-hinge-socket`（(−2.6304, 2.4, −1.8668)，rotY −5.4978）。门宽沿本地 +X，外面是 −Z。
- `door-leaf`：原点在根原点（铰链）。向内开是绕 +Y 0 → −100°。子节点：
  - `door-leaf-mesh`
  - `prop-lighthouse-door-s3-collider`（1.08 × 2.18 × 0.08）
  - `door-handle`
  - `door-keyhole`：门扇本地 (0.92, 0.86)，门环正下方。外锁板贴外面（z −0.0455），里面有小锁板。网格在 `door-keyhole-mesh` 上，开口材质 `mat-prop-keyhole-dark`。
- `prop-lighthouse-door-s3-interact`：根本地 [0.54, 0, −1.52]，门外平台，+Z 朝门。

### 接入（`game/src/levels/s3/art.ts` 现有逻辑，不用改）
- 整个文件挂在白盒合页下；door-leaf 原点 = 根原点，所以平移量是 0。
- 注意：程序是转整个根（不是转 door-leaf），所以根下的 `-interact` 会跟着门转。开门前读它，或者继续用白盒站位。

### 020 门扇修正（顺带，10-30）
- 板子方向：build-env-s3 `buildDoor()` 的竖板原来只做了 RZ(90°)，结果板厚 0.075 和板宽 0.174 对调了，板子之间露缝（射线检测透光 57%）。改成 RY(90°)·RZ(90°) 后透光只剩拱角的 3%。
- 拱顶铁箍：两端顺序反了，交叉成 X；已改正。
- `env-lighthouse-ch1-door.glb` 已重建、重新打包（只有这一个文件变了，面数不变）；本门同步重建。

### 预览
`--props door,door-open,door-key`（关门、开 −100°、锁孔特写配灯塔钥匙）。

## prop-key-lighthouse.glb — 灯塔钥匙（022）

和地窖钥匙 `prop-key-cellar-s2` 是同一模型、同一 attach 数据。292 面，只有 LOD0，根 extras `puzzleCritical: true`、`sameModelAs: prop-key-cellar-s2`。
- 节点 / attach / rest 都不变。只多一个 `prop-key-lighthouse-interact`（钥匙中心上方 1 cm 的拾取点，§5.4 要求）。
- 接入：`S2_KEY_KEYS` 优先用它，根直接放在 `env-cellar-s2-key-socket`。
- 材质 `mat-prop-key-brass`（v0.1-029，10-30）：仍用 tex-props-puzzle-ch1 图集黄铜区，metallicFactor 0.6、roughnessFactor 0.45（略反光的旧黄铜，不自发光）；和地窖钥匙同步。
- 重建：`--only=prop-key-lighthouse`。

## prop-white-stones-s2.glb — S2 白石组「3 1 7」（014 / 021，裁定 15 / 16，2026-10-30）
地面透视拼合：只有从观察眼位 (0.95, 4.35, 1.0) 朝 (18, 0.2, 1)、FOV 30° 看过去，坡上的白石才拼成「3 1 7」（左→右 = 南→北）。
- 根 = 崖顶局部原点（= S2 局部）：挂 `env-clifftop-s2` 根零变换（现有槽位 `prop-white-stones-s2` 即可）。石块按崖顶坐标摆在 stonesArea（x 14–22、z −2.5…4.5）里，贴实际地形（`art/source/props/white-stones-s2-terrain.json`，由 `art/tools/sample-terrain-white-stones.mjs` 从 env-clifftop-s2 LOD0 取样，0.25 m 网格），下沉 3–6 cm。
- 屏幕版式：字高 4.5°、字宽 0.55 h、笔画 0.16 h、字距 = 字高 × 1.9 / 2.2，字组中心在视线下方 3.7°；数字组屏幕范围 X −5.12…+5.12°、Y −5.94…−1.45°（窗洞在眼位能看到的坡地范围 Y −6.5…−0.9°、X ±14.1°，上下各留 0.55°）。
- 横笔 a / g / d = 两块低卧石，竖笔 b / c = 一块往远处仰 ~24° 的立石板。每块石头的投影包围盒数值拟合到笔画矩形（误差 < 0.01°）。
- 12 160 三角面（≤ 20k），puzzleCritical，无 LOD。269 KB + 3 张外置 KTX2（tex-prop-white-stones-s2-*，1024²）。

### 节点 / 材质
| 节点 | 内容 |
|---|---|
| `white-stones-digit-3` / `-digit-1` / `-digit-7` | 数字石（3：7 块，1：2 块，7：4 块；共 14 块），子节点 `white-stone-d<数字>-<段><序号>`，材质 **`mat-prop-white-stones-digit-s2`** |
| `white-stones-decor` | 12 块散落装饰石（眼位看在数字组外 ≥ 1.6°），材质 `mat-prop-white-stones-decor-s2` |
| `white-stones-hidden` | 12 块暗石：藏在立石板身后的视线阴影里，眼位看不见（ID 图 0 像素），偏开后冒出；材质同装饰石 |
| `*-collider` | 盒碰撞体，和对应石块同组兄弟节点（零变换、世界坐标）：6 块立石板 + 大装饰石 |
| `prop-white-stones-s2-viewpoint` | 眼位 (0.95, 4.35, 1.0)，−Z 朝 lookAt，extras fovDeg 30 |
- **加亮**：只对 `mat-prop-white-stones-digit-s2` 做（extras.programDriven）：建议 emissive #F2EEE4 × 对准度 × 0.35，或只给这个材质的网格加描边。两种材质的贴图 / 外观完全一样，不加亮时看不出区别。
- 根 extras：viewpoint、screenLayout、digitGroups、digitMaterial、decorGroups、stonesArea。

### 验证（`render-preview-web.mjs --s2 ws-eye,ws-6deg,ws-off1m-s,ws-off1m-n`，加 `-id` = 平涂 ID 图）
| 视图 | 结果 |
|---|---|
| 眼位正视 `s2-white-stones-eye.png` | 读成「3 1 7」，和理想七段比 IoU 0.76；窗框 / 窗台不挡（数字组离窗洞上下边各 0.55°）；暗石 0 像素 |
| 视线右转 6° `-6deg` | 全在画面内，可读，IoU 0.75 |
| 眼位南 / 北平移 1 m `-off1m-s/-n`（隐藏小屋：西窗只有 0.9 m 宽，横移 1 m 实际被墙挡住） | IoU 0.48 / 0.47：「3」散开、横笔和竖笔错位，但「1」「7」还认得出（见下） |
| 坡上第三人称 `s2-white-stones-slope-3p.png` | 一片乱石，看不出数字 |
- 限制：石块必须落在 stonesArea 的地面上，笔画深度被屏幕高度锁死（13.6–19.7 m），眼位横移 1 m 时整组平移 2.9–4.2°，笔画之间的相对视差最多约 1.3°。所以「偏 1 m 完全读不出」在这块地上做不到；实际游戏里横移 1 m 会被墙挡住。
