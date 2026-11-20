# v0.1-027 剧情物件 / 场景小物（2026-10-30，美术 Bot）

全部自制（程序建模 + 程序贴图），未用外部素材。非 puzzleCritical，普通 LOD；≤ 1k 面的纸类只做 LOD0 + LOD1。
材质：`mat-prop-dressing-ch1`（单材质，共用 2048 图集 `tex-props-dressing-ch1-{albedo,normal,orm}.ktx2`，无 emissive / 无暖光），植被 `mat-env-vegetation-ch1`（同图集，MASK 0.5，双面）。
KTX2 外置在 `../../textures/`，几何 Meshopt。prop-* 带 COLOR_0 平滑法线（描边用）；env 植被不带。
重建：`python3 art/source/props/gen_tex_props_dressing_ch1.py` → `bash art/tools/tex-to-ktx2.sh` → `node art/tools/build-props-dressing-ch1.mjs` → `(cd game && node ../art/tools/glb-pack-ktx2.mjs ../art/models/...)`。
校验：`verify-lod.mjs` 与 `verify-glb-ktx2.mjs`，18 个文件全部通过（0 错误 / 0 警告）。

## 文件 / 面数（LOD0 / 1 / 2）/ 字节

| 文件 | 用途 | 三角面 | 字节 | 节点 |
|---|---|---|---|---|
| props/prop-journal-father.glb | 父亲日志（S2 书桌 → S3 灯室） | 合 652/288/88；开 736/272/78 | 44,532 | `-closed_lodN`、`-open_lodN`（程序切显示）、`-interact` (0, 0.035, 0) |
| props/prop-letter-a.glb | 平放信纸（S2 抽屉、S1 压石纸条） | 320/80 | 9,544 | 0.18 × 0.24 m |
| props/prop-letter-b.glb | 钉着的纸（S3 点火口旁） | 304/128 | 12,204 | 0.15 × 0.21 m，2 枚图钉；默认平放，上墙用 rotX +90° |
| props/prop-letter-c.glb | 对折小纸条（S2 书桌，汐） | 204/56 | 8,052 | 0.15 × 0.10 m，折痕在 −Z |
| props/prop-notice-board-s1.glb | S1 码头告示牌 | 1112/480/176 | 35,456 | 原点 = 甲板面；板中心 y 1.2；`-interact` (−0.06, 1.2, 0.12) |
| props/prop-logbook-s3.glb | S3 值班簿 | 560/268/116 | 23,640 | 带挂绳；`-interact` (0, 0.045, 0) |
| props/prop-sketch-window.glb | 父亲草图（S2 地窖木架） | 560/140 | 12,276 | 0.21 × 0.30 m |
| props/prop-cup-tin.glb | 杯子 ×2（一只倒扣） | 464/208/120 | 17,428 | 倒扣姿态：t (0, 0.085, 0)，r 四元数 [1, 0, 0, 0] |
| props/prop-kitchen-set-a.glb | S2 餐桌小物（水壶 / 面包板 / 盘 / 罐） | 2356/1084/648 | 58,956 | 原点 = 桌面中心；局部 (+0.05, 0) 附近留给杯子 |
| props/prop-desk-set-a.glb | S2 书桌小物（航海图 / 罗盘 / 油灯不亮 / 墨水 / 笔） | 1756/840/486 | 48,136 | 原点 = 书桌面中心；航海图在汐纸条下，风灯位留空 |
| props/prop-rope-coil-a.glb | 通用装饰 | 1584/880/352 | 45,132 | |
| props/prop-net-pile-a.glb | 通用装饰 | 1092/498/256 | 29,016 | |
| props/prop-buoy-a.glb | 通用装饰 | 644/232/96 | 19,888 | |
| props/prop-barrel-a.glb | 通用装饰 | 416/200/96 | 17,984 | |
| props/prop-crate-a.glb | 通用装饰 | 720/180/12 | 25,724 | 可叠放（高 0.42） |
| props/prop-seabird-far.glb | 远处单只海鸟 | 126/68/44 | 15,784 | 原点 = 身体中心，朝 +Z；morph flap-up / flap-down，动画 `seabird-flap` 0.6 s 循环 |
| env/env-grass-coastal-a.glb | 低矮杂草 + 枯苔（第二组 `env-moss-dead-a_lodN`） | 草 40/20/10，苔 32/8/2 | 13,492 | extras windSway |
| env/env-seaweed-a.glb | 海草 | 32/16/8 | 8,152 | extras windSway |

| 贴图 | 字节 |
|---|---|
| tex-props-dressing-ch1-albedo.ktx2（2048，ETC1S） | 553,333 |
| tex-props-dressing-ch1-normal.ktx2（2048，UASTC+zstd） | 1,521,109 |
| tex-props-dressing-ch1-orm.ktx2（2048，UASTC+zstd） | 502,778 |
| tex-decal-footprints-albedo.ktx2（512 × 1024 RGBA，覆盖 1 × 2 m，沿 V 平铺；4 步，步距 0.5 m，脚尖朝 −V；033 重做：深压痕 + 硬边，见文末） | 20,140（原 27,810） |

合计：GLB 445,396 B + 贴图 2,597,360 B = **3,042,756 B**（033 脚印贴花重做后；原 3,050,426 B）。
common+s1 增量（图集 + 脚印 + S1 / 通用 GLB）：**2,817,532 B（约 2.82 MB）** → common+s1 约 119.4 → **约 122.2 / 150 MB**。

## 建议摆放（世界坐标，取自 game/ 现有 socket / 读点，只读）

| 物件 | 位置 | 备注 |
|---|---|---|
| journal（合） | S2 journalSocket (−5.0, 3.75, 0.02) | |
| letter-c | S2 xi-note (−5.15, 3.755, −0.68) | |
| desk-set-a | S2 书桌 (−5.1, 3.75, −0.3)（我推算，无 socket） | 风灯 socket (−5.05, 3.75, −0.35) 已留空 |
| kitchen-set-a | S2 餐桌 (−2.6, 0.75, 1.6)（我推算，无 socket） | |
| cup-tin ×2 | S2 cups (−2.55, 0.75, 1.6) 附近，一正一倒扣 | |
| sketch-window | S2 cellarSketch (−2.35, −1.3, 1.8) | |
| logbook-s3 | S3 logbook-s3-read (−2.517, 3.38, −1.227) | 在 env 木架板上 |
| letter-b | S3 ignition-note-read (−0.941, 22.03, 0.132) | 在 env 铁托盘上；距拉杆轴 1.977 m、距拉杆交互点 2.408 m（≥ 1.5 ✓），在拉杆对侧 ✓ |
| journal（开） | S3 lamp-room-journal-socket (1.839, 22.75, −1.839) | |
| notice-board-s1 | S1 pierPoint(5.2, pier.width/2 − 0.08, deckY)，rotY = pier.rotationY | 告示中心 = deckY + 1.2 |
| letter-a | S1 邻居纸条 (15.05, sandY + 0.03, −1.7) | |
| 脚印贴花 | ~~S1 reefPath[2] 半径 1.6 内~~ → 033 改为潮间带湿沙 4 块 T1–T4（见文末） | 原位置压在踏石 P2 上、悬空 ≈ 0.4 m |

预览：`art/models/props/preview/027-{lineup,reading,notice,kitchen,desk,dressing,seabird,lods}.png`（页面 `art/tools/preview/dressing027.html`）。

## 033 脚印贴花重做（2026-10-30）

制作人验收：S1 低潮脚印很淡、中间被礁石压住。

- **贴图**：`art/source/props/gen_tex_decal_footprints.py` 单独生成（原 `gen_tex_props_dressing_ch1.py` 里的 `footprints()` 已移除）。规格不变（512 × 1024，1 × 2 m，4 步，步距 0.5 m，脚尖朝 −V，V 向可平铺），改为父亲的靴印 0.30 m：压痕底 #3F3C37（alpha 0.92）、趾端与外侧内壁阴影 #2C2B29、鞋底横纹、后两步脚跟积水 #5F6A70、外沿一圈挤起的亮沙棱 #A39C90（alpha 0.5）。硬边（4× 超采样 + 0.6 px 模糊），色阶分块，符合 style-guide 三渲二。压痕 alpha 均值 0.906（原 ≈ 0.55），RGB 均值 ≈ (61, 58, 54)（原 ≈ #55514A 且软边）。
- **位置（需程序改代码，game/ 未动）**：原中心 = reefPath[2]，正好压在谜题踏石 P2（s1-rocks-b #0）上；高度取物理射线（灰盒小径板 ≈ 0.38–0.48），比美术礁岩面高 0.38–0.54 m，两端悬空。踏石属谜题 1 路线（s1-layout.json ↔ layout.ts S1.reefPath，verify-render 校验），**不挪不删**。
- 建议改成从 reefPathEnd 沿湿沙走向浮台的 4 块（全在 m = 0 的沙面，离任何礁石外壳 ≥ 0.9 m，末端离浮台南沿 0.69 m）；坐标与标注图见 `art/models/props/preview/033-footprints-path.json`、`033-footprints-path-map.png`；引擎内前后对比 `033-footprints-before-after-old-spot.jpg`、`033-footprints-proposed-path.jpg`，贴图平铺对比 `033-footprints-texture-compare.png`。

## P3 钢笔 prop-fountain-pen（2026-10-31）

结尾灯室坐写（xi-sit-write）时汐右手里的老式钢笔：深色胶木杆 + 旧黄铜笔尖 / 箍 / 笔夹 / 尾钮，笔帽套在尾端。自制（`build-props-dressing-ch1.mjs --only=prop-fountain-pen` → `glb-pack-ktx2.mjs`），材质 `mat-prop-dressing-ch1`，共用 `tex-props-dressing-ch1` 图集（笔杆 = leather 分区的深色子块，金属件 = brass 分区），**图集未改**（三张 KTX2 md5 不变，其他道具 GLB md5 不变）。

| 文件 | 三角面 LOD0 / 1 / 2 | 字节 | 节点 |
|---|---|---|---|
| props/prop-fountain-pen.glb | 556 / 272 / 154（上限 1k） | 25,188 | `_lod0..2`、`-tip`（笔尖）、`-grip`（拇指 / 食指夹笔处）；带 COLOR_0 |

**挂点**：程序把整个 GLB 根挂到 char-xi 的 `hand_r_socket` 下，**局部变换单位矩阵**，不加偏移。笔的顶点已经在 socket 坐标系里摆好：
- socket 本身在掌心（不是指尖），所以「原点」= socket = 握笔手的挂点；真正夹笔的位置是 `-grip` 节点 (0.00845, −0.0168, −0.03605)，距笔尖 4.15 cm；笔尖 `-tip` (−0.00668, −0.05389, −0.04696)；笔轴方向 (0.3645, 0.8933, 0.2629)，长 14 cm，书写时立起约 47°，笔夹 / 笔尖正面朝上。
- 根节点 extras：`attach {socket: hand_r_socket, clip: xi-sit-write, localMatrix: identity}`、`tipLocal / tailLocal / gripLocal`。
- 动画 extras 里原来的 penTip0 / penTail0 那条线贴着掌心走（穿无名指约 5 mm、拇指食指离笔 2 cm），已改成这支笔的真实笔尖 / 笔尾（同时加了 `penProp`、`penAttachSocket`）。

**xi-sit-write 小改**（只这一个 clip；其余 30 个 clip 轨道逐值相同，其他 extras 不变）：socket 整段只平移、姿态不变，原设计把笔尖路径按平面 0.70 m 走，但摊开的日志纸面从书脊 0.693 升到外侧 0.7025（只随 x 变），新笔会扎进纸面最深 0.83 cm。`build_xi_anims.py` 里笔尖路径高度改成跟纸面（实测纸面表 `PAGE`），只动右臂 / 右手 17 个通道。

**验证**（`node art/tools/measure-pen-sit-write.mjs`，121 帧逐帧，日志放 lamp-room-journal-socket = 汐根前 0.38 m、桌面 0.68）：
- 笔尖到纸面：落笔段（86 帧）−0.01 … +0.12 cm（+0.12 = 设计里的字间轻抬）；抬笔段 0 … 3.0 cm；笔尖始终在右页内。
- 笔杆穿手：笔顶点进手皮肤最深 0.09 cm（thumb_02_r，笔夹棱）、手顶点进笔体 0；各指离笔：拇指 0.01 / 中指 0.15 / 食指 0.33 cm（贴住、不穿）。
- `verify-glb-ktx2` 错误 0 / 警告 0；全量 verify（glb-ktx2 / xi-anims / father-anims / lod / xi / father / 对称）全过。

预览：`art/models/props/preview/prop-fountain-pen-three-view.png`（左上侧视、右上俯视、左下端视、右下 3/4）、`-in-hand.png`（第 18 帧，拇指侧特写）、`-in-hand-top.png`（第 72 帧，右侧）、`-cam05-proxy.png`（05 机位代理：r5 同款 OVER_SHOULDER from/to 插值 0.625，第 18 帧）。
