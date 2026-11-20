# 1031 裁定 25 程序 P2：灯束 + 035-05 机位（起点 fe19ab7）

- [x] 0 调查：现行灯束实现、02 圆盘成因
- [x] 1 体积灯束（S3 灯室 + 结尾演出共用），028 噪声 / 辉光贴图
- [x] 2 性能（1440p 开灯束前后）
- [ ] 3 05 over-shoulder 机位（相对 GLB 日志 / 坐写节点），构图自检
- [ ] 4 shots-035 重拍 01 02 05 06 07 + 对比图
- [ ] 5 冒烟 035 full / 015 art1 / 012 光路，check，size

## 记录

### 0 — 调查（接手 11:32；上一个执行者的工作区改动已读，可用）
- 现行灯束（015，puzzles.ts buildS3Lamp）：两个开口 ConeGeometry(3.2, 60) + MeshBasicMaterial opacity 0.16 加法、DoubleSide，沿长度和横截面都是常数 → 侧面看是两条硬边平带（07）。
- 02 圆盘成因：视线接近顺着光束轴（02 从灯室顶往外看），远端开口（半径 3.2 m 的圆）投影成椭圆；椭圆内的视线只穿过一层锥壁（从开口出去），椭圆外穿过两层（进、出），加法混合下就是「外亮内暗、硬边」的圆盘。不是贴图 / 辉光 / 雾造成的。
- S3 点灯谜题和结尾演出用的是同一个 S3Lamp（__s3.puzzles.lamp，结尾演出不另建灯束），改 buildS3Lamp 两边就都换了。S1 远景 world/Lighthouse.ts 第一章全程熄灭，不在范围内。
- 上一个执行者留下：render/lampBeam.ts（体积灯束 + 028 辉光，单测已加进 verify-beam，20/20 过）、puzzles.ts 接入 + legacy 对比开关、atmosphere028 生成 beam / glow 段（--check 一致）、05 OVER_SHOULDER 相对日志 socket + 坐写站位的局部基、frameReport 构图自检、shots-035 SHOTS_BEAM_COMPARE。typecheck 过。scratch/beam05/probe.mjs 调参记录 plan1–7（最后一轮 fin：from back .65 side 1.85 up 1.3 fov 38 → to back .45 side 1.55 up 1.1 fov 38，look up .38），fin-68 起 probe 卡在 seek 上 10 min 无进展，已结束该进程并删掉它的 Chrome 临时目录。
- 裁定 26（制作人）：肤色保持冷色暗部；?xiShadow=warm / ?lutKeepSat 留作调试开关，默认关，不改代码。

### 接手 3（12:25）
- 上一个执行者留下的 retry.sh（shots-035 → scratch/beam05/v1，两次「S3 没就绪」，Chrome SIGABRT / SIGKILL）已结束；失败原因是同时段美术的 shots-031（scratch/xi-r5）也在开浏览器。
- art/ 里 char-xi.glb / char-xi-anims.glb 正在被美术改（r5 马尾，12:15–12:22 还在写），主仓库不构建不验证。
  建了自己的工作区 scratch/beam05/wt：game = git worktree（detached，跟主仓库提交同步 cherry-pick / reset），art = 主仓库 art 的 models/textures/audio/ui 拷贝，
  char-xi.glb / char-xi-anims.glb 换成已交付的 r4final（bk-xi-head/r4final：2,094,040 / 1,512,312 B，后者即 035 交付的 xi-sit-write 座高 0.40 版）。

### 1 — 体积灯束（3d9988c，确认完成）
- render/lampBeam.ts LampBeam：每束仍是 1 个开口 CylinderGeometry（根半径 0.45 → 末端 3.4 m、长 60 m、32×24 段）+ ShaderMaterial，加法、DoubleSide、不写深度、renderOrder 2；两束 = 2 draw call，外加 1 个辉光 billboard（renderOrder 3）。
- 亮度全在 shader：横向软边（N 与去轴向视线的夹角，pow 1.6）；侧面按 |V·axis| 淡化到 sideMin 0.28，迎光前向散射 +0.6；沿长度 startFade 0.8–3.6 m 淡入、1/(1+2.2·s) 发散、末 30%–100% smoothstep 到 0（末端无边界 → 不再有圆盘）；
  雾密度散射 sqrt(ρ/0.008) 夹 [0.55,1.35]、雾透射 exp(−(ρd)²·0.6)；028 tex-beam-noise 沿束滚动；片元抖动去色带；近相机 0.5–3 m 淡出。
- 辉光：tex-glow-lighthouse billboard（028 glow.lighthouse 9 m / 强度 1.6 / 2.5 s 淡入 / 雾衰减 0.4），往相机拉 1.4 m，6–14 m 近处淡出。art=0 时噪声取常数、不建辉光。
- 接入：levels/s3/puzzles.ts buildS3Lamp（点灯谜题与结尾演出共用 __s3.puzzles.lamp）；legacy 015 圆锥保留，lamp.setStyle('legacy'|'volume') 同帧对比。
- 单测：verify-beam 里 lampBeamAlong / Phase / Facing 与 shader 同式的用例（20/20）。

### 2 — 性能（接手 4，13:20 整理 scratch/beam05/perf2–4 的数据；2560×1440、art=1、high，swiftshader 软件渲染，只看相对值）
- 几何：volume 3 mesh / 3,074 tris（2 束 + 辉光）；legacy 2 mesh / 48 tris。
- 整帧 renderer.info（含阴影 / 反射等多 pass）：02 关束 67 calls / 871,681 tris → volume 73 / 877,829（+6 / +6,148），legacy 75 / 871,873（+8 / +192）；07 关束 107 / 1,067,267 → volume 113 / 1,073,415，legacy 115 / 1,067,459。volume 比 legacy 少 2 call。
- 整帧帧时间（perf2，各 19 帧中位，两轮交替）：负载 20–40 下波动 ±40%（同一配置两轮 2.2 s↔2.5 s、3.5 s↔4.1 s），新旧差异淹没在噪声里，不可用。
- 隔离计时（perf4 bench2：只渲染灯束 root，readPixels 同步，10 轮交替取中位）：
  - 07 侧面：volume 111.4 ms、legacy 15.9 ms、空 0.2 ms；同帧整场景 1,838 ms → 灯束占场景渲染 6.1%（legacy 0.9%）。
  - 02 顺轴：volume 29.4、legacy 6.2、整场景 760 → 3.9%（legacy 0.8%）。
  - 结论：新灯束片元开销约旧的 5–7 倍（全屏大面积加法 + 噪声采样），但只占场景 4–6%；GPU 上按比例约 0.3–0.6 ms@60fps 量级的估计，未在真 GPU 实测。可选优化：降 radial 段数 / 半分辨率，暂不需要。

### 追加：汐 r5 返修（13:15 父代理加派）
- [x] r5a 文件核对：char-xi.glb 2,077,172 B / md5 7d3342f5…；char-xi-anims.glb 1,513,928 B / md5 37e3b971…，与美术说明一致。wt/art 已换成 r5（art/ 其余与 wt 无差异）。
- [x] r5b test:xi / test:father（wt，r5）全过；hand-on-head 核对后 palm −0.27 cm @112、有缝 0/81、半帧 0/161，与 r4 一致
- [x] r5c 测量 bug：复现确认（随机 2000 三角形：MeshBVH 后 g.index 三元组仅 8/2000 保持原序；hit.point 落在 arr[fi*9] 三角形上 4/500，经 index 取 500/500）→ ee69493 修成默认行为（无开关）；verify-father 本来就按 index 取，不受影响；verify-hoh-035 的内壁材质标签有同样问题（只影响诊断文字，距离不受影响），一并修。e9c0ebf = shots-035 超时可配。
- [x] r5d 全 clip 重量（31 clip，最深 cm / 穿>2mm 帧；表 scratch/r5pt/table.md）：
  - r4 旧口径 vs r4 新口径几乎一样（look-up 2.16/2.16、row-boat 2.23/2.23、pickup 2.07、push-start 2.13、valve-hold 1.78、tie-boat 1.57，帧数差 ≤4，ring-bell 0.88→0.94、shiver 0.18→0.25）→ 上次报给美术的 r4 数字不受这个 bug 实质影响，r4 的穿插是真的。
  - r5 旧口径：只剩 look-up 1.82（26/151）、row-boat 0.08；r5 新口径：31 个 clip 全部 0.00 cm / 0 帧。look-up 的 1.82 是 bug 造成的假阳性，美术结论成立。
- [ ] r5e 重拍 s1-xi-*-hull（对比 r4）
- [ ] r5f 05 用 r5 xi-sit-write 复核 + 重拍

### 追加：BUG-026（P3，13:20 加派）
- [x] 复现（scratch/bug026/a，wt r5，960×540，停在 t=38.5、冻结 lamp.update、光束角 0–π 每 π/16 扫一遍）：父亲镜头相机离灯心 1.97 m（cam (41.61,23.50,−123.34)，灯 (39.73,23.55,−122.75)）。
  - 隐藏灯束：上 1/3 平均 RGB (129,111,96)，下 1/3 (118,88,52)。
  - legacy：a=1.37 rad 上 1/3 (177,149,116)（QA 报 (182,153,119)），a=1.18 时上下都亮；画面与 QA ghost-t38.5 一致（上半整片橙、下沿水平硬边、右侧竖直硬边）。注：sweep 里 legacy-01…15 误把体积灯束也开着（plan 的 sed 只替换了第一处），legacy-00 与 b 阶段为纯 legacy。
  - volume：全角度上 1/3 最多 +10（a=1.77–1.96，窗外远处光束正常可见、软边），a=1.37 处 +3，无硬边。
- [x] 根因：旧 015 圆锥（开口 ConeGeometry，DoubleSide 加色 0.16，无近处淡出）绕灯心旋转，锥轴略高于相机（灯 y 23.55 vs 相机 23.50），转到 a≈1.2–1.4 时锥壁从相机身边几厘米处扫过 → 贴脸的锥壁占满上半屏，下沿 / 右侧是锥壁的面片边 = 硬边。不是辉光 / 后处理。
- [x] 新体积灯束已解决（近相机 0.5–3 m nearFade、离灯 0.8–3.6 m startFade、侧面淡化、软边）；不改运行时代码，ea1f5df 加回归单测 lampBeamNear。
- [x] 同帧 1600×900 前后图 → docs/tasks/shots-035/bug026/（t=38.5，上 300 行平均 RGB）：hidden (129,110,95)；a=1.37 legacy (176,148,115) / volume (132,112,96)；a=1.18 legacy (159,132,105)+下半也亮 / volume (130,111,95)；a=1.96 legacy (133,114,97) / volume (139,117,98)（窗外远处软光束，无硬边）。并排图 bug026-t38.5-compare.png。

### 3 — 05 复核（r5，接手 4）
- a 阶段（7a65bac 之前，r5 xi-sit-write）：frameReport 日志 8/8 角入画、日志顶面被汐挡 48–52%、手在画内不被挡；发顶留白 29–78 px（t 73.6 报 3 px，但画面量约 55 px，frameReport 的头发顶点含别的东西，以画面为准）。r4 与 r5 构图几乎一样。
- 发现：右手悬在日志上方——实测 hand_r_socket y 23.169、日志顶 22.703（高 0.47 m），汐根 y 22.389（应为地面 22.0），hips 离地 0.92 m。原因：placeXi 用 teleportTo 放到地面点，物理把胶囊顶到椅子碰撞体座面（0.40），而 xi-sit-write 自带座高 → 座高算两次。r4 时就有（b4f0d39 的图同样），不是 r5 引入。
- 7a65bac：坐写改为 PlayerController.pin（钉在地面点、停物理），看海站位照常 teleportTo 并 unpin。

### 3b — 05 复核（7a65bac 后，probe c，r5）
- [x] root y=22.000（修前 22.389），hips 22.534，socket y 22.780 vs 日志顶 22.703（+7.7cm，画面上手掌落在页面上，不再悬空）
- [x] frameReport t=61.6–73.6：journal 8/8 角入画，occluded 0.333，hand 入画未遮挡，crownPx 315–337（头顶余量充足）
- [x] 机位不调：构图OK（图 scratch/bug026/c/c-05-*.png）
- [x] 注：probe 各时刻骨骼位置完全相同、clip=null —— 已查清（接手 5，probe d）：sit-write 在播，是采样巧合，不用改代码

### 接手 5（14:10）
- wt = /workspace/scratch/beam05/wt（不是 scratch/r3）：game 是主仓库的 git worktree（detached，跟 master 同提交），art 是主仓库 art 拷贝 + r5 交付的汐两件；docs / audio 是指向 game-studio 的软链。dist 14:03 在 7a65bac 构建。
- 接手时上一个执行者的 shots-035（SHOTS_ONLY=01,02,05,06,07 SHOTS_BEAM_COMPARE=1 SHOTS_TOTAL_MS=2400000，日志 scratch/beam05/shots035.log，14:09 起）还在跑，没动它。
- [x] 第 4 项（制作人建议）8453b99：SkipHint 按下当刻显示圆环 + window 事件 skiphint:shown / shownCount，冒烟 035 skip 改查事件（tsc / eslint 过，冒烟待跑）
- 3b 疑点初查：xi-sit-write 时长 4.0 s（121 帧 0–120），probe c 的 64/68/72 取模都是 2.0 → 同姿势是采样巧合；但 60.5（2.5）/ 73.5（3.5）与 2.0 本地差 3 cm，probe 里却一样 → 还是可疑。probe 的 clip 字段读的是不存在的 animator.current（所以 null）。plan-d 用 animator.posing / slots 复查。
- [x] 3b 疑点结论（probe d，scratch/bug026/d.log）：xi-sit-write 在播。animator.posing = xi-sit-write、state pose:xi-sit-write、slot 权重 1、action.time 跟演出时钟走（t 62.1 → 0.1、t 63.1 → 1.1，右手 z 移 6.4 cm）。
  「完全一样」的原因：软件渲染一帧 > 1 s，后备时钟每帧走满 1.0 s 上限，probe c 实际停在 62.1 / 64.1 / 68.1 / 72.1 / 74.1，(t − 58) mod 4.0 全是 0.1 → 同一帧姿势。clip=null 是 probe 读了不存在的 animator.current。action.isRunning()=false 是因为 timeScale 0（setPose 手动定帧），不影响取样。
  frameReport 另有 shots-035 05 在 t 69.617（clip 3.617，第二笔抬笔段）：8/8 角、occluded 0.333、crownPx 323、手入画未遮挡 —— 与 0.1 相位一致，构图结论不变。
- [x] 第 4 步 shots（上一手留下的进程跑完，14:09–14:23，10 张 0 失败）：docs/tasks/shots-035/s3-ending-0{1,2,5,6,7}*.png + -beam-before；并排对比 shots-035/beam-compare/*-beam-compare.png
- [x] r5e（14:21–14:28，wt dist 7a65bac + r5 art，shots-031 s1-xi-face,s1-xi-ear，机位与 shots-r4 json 一致）→ docs/tasks/shots-r5/：4 张 *-hull.png、并排 *-r4-vs-r5.png、放大 crop-front-hair.png / crop-front-collar.png / crop-*-collar-x2.2.png（提亮 2.2 倍）
  - 正面：与 r4 几乎一样（头发区平均差 1/255、领口 0）→ 正面本来就没问题。
  - 左耳特写：变化最大——耳后 / 颈侧那块硬边黑块明显缩小，颈部皮肤露出更多；马尾上的发丝内暗线变淡、出现正常的发束明暗。
  - 侧面：领口一圈基本一样，r4 / r5 都还有发际线下颈后一条细暗线（很轻，镜头距离下看不出）。
  - 结论：领口暗块、发丝内线有改善，与美术说明一致；无新问题。
- 美术问「游戏里目前不渲染笔」：确认——src 里没有任何笔道具 / 挂点代码，char-xi-anims 不带道具网格（README：笔挂 hand_r，程序挂）。要不要加笔需要美术出道具 + 制作人定。
- [x] 冒烟 035 skip ✓（14:33，8453b99 dist）：圆环显示事件 1 次；UI 5 帧、最长帧间隔 1086 ms（帧采样最大进度 0.62）
- [x] 冒烟 035 full ✓（14:31–14:34）：11 个 cue 全按音频时钟（各 cue 触发 = 越过 cue 的第一帧，最晚 father_out 目标 42.6 / 触发 44.02，上一帧 40.70），演出结束 106.74 s → 0.91 s 后切结束页、73 帧、淡入后 fade 0

- 冒烟 015 art1：首跑白盒/美术项 ✓，谜题 5 渲染进程崩溃（dmesg 确认 OOM：chrome anon-rss ≈4.0G 被杀）+ 随之两条空日志 Shader Error（崩溃连带）。单独重跑谜题 5（SMOKE_ONLY='v0.1-015 S3 谜题 5'，art=1）✓ 通过。结论：环境 OOM，非代码问题。日志 scratch/beam05/smoke-015art1{,-b}.log
- npm run check（wt @8453b99）全绿 exit 0：typecheck / lint / test / 字体 / build / size / css。size：首次进入 S1 132.30 MB / 150（内部警戒线 140，余 7.7 MB），首场景包 126.84 MB，主菜单 5.45 MB。日志 scratch/beam05/check.log
- 清理：本次接手的运行都没留下临时目录；/tmp 里还有 4 个 shots031-chrome-*（12:12–12:45 建，早于接手 5，无进程占用），可能是前几次中断留下的，也可能是别人的，没删，交给负责人决定。
- [x] 步骤 3（3b 疑点）[x] r5e [x] 步骤 4 [x] 跳过冒烟改事件 [x] 步骤 5 —— 全部完成，待出报告。
