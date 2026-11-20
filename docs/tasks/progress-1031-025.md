# 1031 025 平面反射 / S1 沙斑 / #157 进度

起点：主仓库 master 8453b99（art/ = 汐 r5 正式版）。执行者每完成一小步就写进来；中断后看本文件 + git log 接着做。

## 0 插队：035 镜头 02 灯束加强（制作人裁定，先于 025）
- [x] 02 = 点灯后第一个镜头 far-exterior（lens 4 s → fog_open 14 s，塔外远景）；注意 shots-035 原来的「02-silhouette」(28 s) 是剪影镜头，不是这个
- [x] BEAM_BOOST_02 k=2.4（content/cutscenes/ending.ts，beamBoostAt），LampBeam.setBoost 只乘 uStrength；开关在 lens / fog_open 两个剪辑点，段内恒定；辉光不动；S3Ending.dispose 复位
- [x] 拍图（同一构建同一帧，timeScale=0 冻住旋转）：shots-035/s3-ending-02-far-exterior-t08{,-boost-before}.png、-t12{,-boost-before}.png；02-silhouette 重拍（不受影响，倍率 1）。报告 shots-035-boost02.json、日志 boost02-shots.log
  - 看图：t12 侧向时原来是一条淡橙带、云上几乎糊掉；×2.4 后暖色光带清楚、边仍软；t08 光束朝远离相机方向时根部接近饱和偏白（可接受）；剪影镜头不变
- [x] commit 3f1e2eb
- 注意：box 上制作人 QA 同时在跑 shots-035（qa-tools/snap-8453b99），内存一度只剩 190 MB；我的 shots 拍完 02 就停了自己的进程、删了自己的 chrome 临时目录

## 0b 插队：P3 钢笔接入（顺序 02 灯束 → 钢笔 → 025；美术 15:04–15:11 交付，没碰 game/）
- [x] 资源核对：art/models/props/prop-fountain-pen.glb 25,188 B（LOD 556/272/154，mat-prop-dressing-ch1，外链 tex-props-dressing-ch1-* 三张 KTX2）；
      char-xi-anims.glb 1,514,792 B sha256 9c397a0f…62a2c3（美术已直接换在 art/ 里）。旧版 1,513,928 B sha256 809a05be…cb8b6 = HEAD 8453b99 / qa snap-8453b99 用的那份，
      备份到 /workspace/bk-1031-pen/（char-xi-anims.8453b99.glb + .p3.glb + SHA256SUMS；/workspace/bk-pen 是美术自己的备份，没动）
- [x] 接入：src/entities/xi/clipProp.ts（ClipProp：挂点 / clip / 局部矩阵全读根 extras.attach，显隐 = 汐当前覆盖 clip 是 attach.clip 且权重 ≥ 0.5；suppress 强制藏）；
      XiAnimator.weightOf；S3Scene.stepPen（rig 模型到了就挂，换 rig 重挂；实体更新后每帧定显隐）；ending.finish / dispose → pen.suppress（跳过时坐写姿势不收，笔立即藏）；
      manifest s3 组登记 prop-fountain-pen（进 S3 才加载，不进首包；图集 KTX2 按 URL 共用缓存，和日志 prop-journal-father-s3 同一份）
- [x] 复测（程序自己的脚本 scripts/measure-pen-sit-write.mjs，按游戏摆位：灯室 GLB lamp-room-sit-write / lamp-room-journal-socket、日志摊开）→ shots-035/pen/measure-pen-sit-write.json
- [x] 马尾：scripts/measure-ponytail-hood.mjs 全 31 clip → shots-035/pen/ponytail-hood.json
- [x] verify-xi 加钢笔段（extras 读法、显隐规则、真 GLB 挂 char-xi）
- [x] 05 截图（15:58–16:01，dist 15:37 = 当前源码）：shots-035/pen/s3-ending-05-journal-write{,-f72,-f18}.png + 各自 -close-thumb / -close-right，04 对照（笔藏）；报告 shots-035-pen.json / .log。第 60/72/18 帧 visible、w=1；04 镜头 visible=false；跳过后 visible=false suppressed=true
  - 看图：特写里笔握在拇指 / 食指间、笔尖落在纸面，和美术 in-hand 预览一致；05 正常机位（过肩）笔大部分被右手挡住，只露一小段深色，没有美术 cam05-proxy 那么显眼（代理图机位更高更靠后）
- [x] 数字：落笔 86 帧（0–42、54–96）笔尖离纸 −0.008~+0.124 cm，抬笔 0.003~3.0 cm，missPaper 0；笔进手最深 0.089 cm（hand_r，第 110 帧）；只改 xi-sit-write 17 轨，其余 30 clip 0 变化 → 和美术自报一致
- [x] 马尾 ponytail-hood.json：31 clip 穿>2mm 帧全 0；最深只有 xi-row-boat 0.08 cm @0（<2 mm 阈值，与 batch19 r5 基线完全相同）
- [x] npm run check 全绿（/tmp/pen-check.log）；size 首次 S1 132.31 / 150（警戒 140），首场景包 126.84，menu 5.47，s3 25.86
- [x] commit 5d596e4（shots-025.mjs 未带，归 025）

## 1 025 平面反射
- [x] 实现：src/render/Reflections.ts（PlanarReflection）+ Water.ts 着色器注入 + BaseScene.beforeRender / Game 渲染前调用 + LevelScene 户外挂接
  - 镜像相机（Reflector 同式）关于平均水位 y=level；Lengyel 斜裁剪（近平面 = 水面，clipBias 0.003）；HalfFloat 线性 RT，分辨率 = 画布 × reflections.planar（1 / 0.5 / 0.25）；?reflect=off|0|数字 覆盖
  - 倒影 pass 隐藏水面 / 雨；不重画阴影（shadowMap.autoUpdate=false）；RT 里已经带雾（物体雾 / 场景雾按镜像光路算）→ 在 fog_fragment 之后混合（美术 atmo028 同式：fr = mix(fres.x,fres.y,(1-N·V)^4)，refl*0.9，扰动 reflectDistort·w/(1+d·0.05)）
  - 无跳变：强度 k = smoothstep(0.05, 0.6, 相机离水高度)，水下 0；不画时保留 k
  - 只在可见时更新：关闭 / 相机在水下 / 水面盒（±0.4 m 浪带）出视锥 → 跳过；另挂 WebGL2 遮挡查询（水面主画面 draw 夹 ANY_SAMPLES_PASSED_CONSERVATIVE），挡住（塔内等）时每 8 帧补画一次
  - 统计：renderer.info 差值（Game 关了 autoReset）→ stats.calls / triangles / ms，debug 行「倒影」
- [x] verify-render 单测（假 renderer）：淡入连续、?reflect 解析、uv（左右镜像）、斜裁剪、跳过 below / frustum / off
- [x] commit 6544b00
- [x] 构建（npm run check 16:0x 重建的 dist，含 5d596e4）+ 拍图 shots-025（art=1 high，涨潮 y=1.6，timeScale=0）：一次只跑一个机位（pier / pier-low / opening / heights，日志 shots-025-<机位>.log、报告 shots-025-<机位>.json），这次 q1 没崩
  - s1-{pier,pier-low,opening}-reflect-{off,q05,q1}.png；water-height-{0p02,0p1,0p3,0p6,1p2}m.png（k = 0 below / 0.023 / 0.432 / 1 / 1，连续无跳变）
  - 开销（三个机位 q0.25 / 0.5 / 1 一样，因为反射 pass 画的东西不随分辨率变）：draw call +45 / +70 / +72（131→176、184→254、190→262），三角形 +2.82–2.86 M（≈ +47%，6.0 M→8.9 M）；反射 pass CPU 提交 0.8–6.6 ms（噪声大，和倍率无单调关系）；整帧墙钟 swiftshader + box 满载 2.6–8.0 s/帧，前后互相颠倒，不能当 GPU 开销看
- [x] 码头长方形：9 张码头 / 开场图（off / q05 / q1）都没有矩形；反射相机斜裁剪到水面，水下的码头部分进不了 RT；主画面水面不透明（batch15 结论不变）。hide=^env-pier 探针仍没单独做
## 2 S1 沙斑（裁定 23 a 方案）
- [x] src/world/seabed.ts：bakeSeabed（逐三角形 xz 光栅化取最高面，0.25 m 格）/ sampleSeabed / shoalFactor / seabedTexture（R16F 线性）
- [x] Water.setSeabed：顶点 shoal() = smoothstep(0, 0.8, 水位 − 海床)，振幅与梯度同乘；S1Scene.bakeSeabed（美术 env-tidal-flat-s1 _lod0，?seabed=0 关）
- [x] verify-render：合成斜面误差 0、真 GLB 224×136 / 243712 三角形 / ≈60 ms，新礁石南侧 72 点误差 ≤ 0.2 cm，露沙 72 点全压平（其中 45 点原来会被浪峰盖）
- [x] commit eecc033
- [x] 前后对比图（shots-031-sand.mjs 机位 opening / rocks-top，退潮 0，timeScale=0，SHOTS_WATER_T=12.5 钉海面相位）→ shots-025/sand/sand-{opening,rocks-top}-lm1-base-seabed{0,1}.png（seabed0 = ?seabed=0 关）
  - 看图：rocks-top 新礁石南侧那条深色折线浪块（seabed0）没了；opening 右前景深色浪条也没了。新现象：原浪块位置变成沙面上一片片软边亮斑（压平后海面贴着沙面，和左侧原本就有的湿沙亮斑同一种，seabed0 左侧也有）——静帧看像积水，动起来是否闪（共面）没验，报给制作人
- [x] 收尾 npm run check 全绿（/tmp/025-check.log），size 同上：首次 S1 132.31 / 150
## 3 #157 礁石贴合
- [x] 量：原椭圆柱比网格小一圈——东侧（世界 −15°…15°）y 0.9 处网格出挡人体 0.85 m，南侧 0.2 m；
- [x] 改：LOD0 切片（y 0–1.8）凸包棱柱 19 点（S1.foregroundRockHull，gen-s1-rock-hull.mjs），南沿截平 z −8.34（离深水边界 0.61 m）
- [x] 截平以外 ≤ 2.2 cm；南沿仍差 0.20 m（网格离边界只有 0.41 m < 胶囊直径 0.5，物理上留缝就必然贴进）
- [x] 邻块缝（新 / 旧椭圆）：#155 0.04/0.18（网格相接）、#158 0.15/0.06、#160 0.16/0.42、#162 0.04/0.01，其余 ≥ 1.35——原来能过的仍能过，没有新堵路
- [x] verify-physics 24 项全过、verify-render 新测 → commit 8853026
## 4 潮间带压浪：v0.1.md 第 20 条「v0.1 视为正常，不单独压浪；潮间带是否压浪归到 025 一起定」——没有最终裁定 → 只报告
## 验证

## 收尾（16:0x–17:xx 接手执行者）
- 5d596e4 钢笔接入；f84ee88 shots-025 脚本。工作区干净
- 4 潮间带压浪：只报现状，没改
- 遗留：①05 过肩机位笔大多被右手挡住，只露一小段（看是否要调机位 / 姿势，制作人定）②沙斑压平后原浪块位置变成软边亮斑，动态是否共面闪烁没验 ③反射开销 +45~72 draw call、+2.8 M 三角形（+47%），倍率只影响 RT 分辨率，swiftshader 墙钟不可信，需真 GPU 测 ④hide=^env-pier 探针仍没单独做 ⑤015 art1 待 box 空闲重跑

## batch20 制作人裁定记录（16:50 UTC+7 收到；只记录，不改代码，v0.1.md 由制作人维护）
- 潮间带压浪结案：露出的沙面不冒浪（沙斑方案 eecc033 已做到），其余按深水处理 —— 维持现状，第 4 节结案
- 反射默认强度先不改，等用户定（当前：高档 0.5×、混合 refl×0.9 / atmo028 菲涅尔）

## batch20 A 05 机位（17:05 UTC+7 commit 569439d）
- 参数（相对日志 socket 不变）：from {back 0.65→0.8, side 1.85→2.25, up 1.3→1.45}、to {back 0.45→0.6, side 1.55→1.95, up 1.1→1.25}，fov 38、look {0,0,0.38} 不变
- 离线搜参 scripts/search-cam05.mjs（node 无浏览器，char-xi LOD0 每帧 CPU 蒙皮 + BVH，58–74 s 每 0.5 s）→ shots-035/pen/cam05-search{,-picked}.json
  - 先修了脚本两个 bug（getVertexPosition 已含蒙皮又 applyBoneTransform 一遍；MeshBVH 就地重排共享 index 把缓存姿势搞坏）后，基线和截图对上：笔尖被挡、只露笔尾 ≈3.3 cm
  - 几何结论：右拳握住笔身 0.5–10.5 cm；抬高只会让笔尾那段更露，笔尖端最多露 ≈0.5 cm（只到笔尖本身）；想多看笔尖（到 1.5 cm）要把机位压低，和「抬高」相反 —— 所以取适度抬高后拉 + 往汐右手挪 0.4 m
  - 选定参数离线：笔尖可见 100% 采样、可见笔杆 ≈3.4 cm、遮挡 ≤ 0.375、发顶 ≥ 385 px
- frameReport 新增 pen 项（笔尖→笔尾 41 点、往镜头侧偏 4 mm、射线判汐遮挡；ok = 显示 && 笔尖可见 && 可见 ≥ 2 cm）；顺手修发顶重复蒙皮 bug（旧 crown 少算 ≈60 px，之前「马尾算到头顶上方 0.3 m」的说法就是这个 bug）
- 重拍（dist 为 LOD 上限改动之前构建，汐 LOD0；SHOTS_PEN=1 SHOTS_ONLY=05，9 张、失败 0、页面错误 0）→ shots-035/pen/
  - 新：s3-ending-05-journal-write{,-f72,-f18}.png（+ -close-thumb / -close-right）；旧：同名 -before.png，报告 shots-035-pen{,-before}.json/.log
  - f60：日志 8 角在画内，ndc x[-0.234,0.265] y[-0.595,-0.241]，遮挡 0.313，发顶 391 px，笔尖可见、笔尖段 0.7 cm、可见 3.4 cm，ok
  - f72：8 角，遮挡 0.333，发顶 389，笔尖可见 0.3 cm、可见 3.1 cm，ok
  - f18：8 角，遮挡 0.375，发顶 387，笔尖可见 0.3 cm、可见 3.1 cm，ok
  - 旧图（bug 版 crown）：遮挡 0.29–0.35、crown 313–319（真值 ≈375）、日志 ndc y 下沿 −0.74～−0.76（新的更居中）
  - 看图：新机位汐和日志更居中、窗框占比更大；1600×900 下笔就是两拳之间一小段深色 + 黄铜笔尾，笔尖只是几个像素 —— 「露出来」成立但不显眼；特写（close-thumb / close-right 是固定特写机位）前后一样
- 自检：typecheck、eslint、verify-cutscene、verify-xi、verify-lod 全过
- 遗留：①笔尖想更显眼只能压低机位或改握笔姿势（制作人定）②LOD 上限（037 / 裁定第 4 条）上线后，高 / 标准档 05 特写里汐是 LOD1（笔贴合是按 LOD0 验的），需要看是否给过场锁 LOD0
