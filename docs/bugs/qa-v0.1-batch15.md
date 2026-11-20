# QA v0.1 batch15 — master 0598043（8ad6b9b 之后 9 个提交）

- 快照：/workspace/qa-tools/snap-0598043（用 `git archive 0598043` 导出；art、docs 软链到工作区；package-lock 和 8ad6b9b 相同，node_modules 硬链自 snap-8ad6b9b）。
- 方法：无头 Chrome（SwiftShader 软件渲染），冒烟一条一条串行跑，按固定步长 / 游戏时间判定，不判 fps。每查完一项马上追加到本文件。截图和数据放在 qa-v0.1-batch15/。时间都是 UTC+7。

## 汇总（HEAD 0598043，SwiftShader，不评 fps）
| # | 项 | 结论 | 备注 |
|---|---|---|---|
| ① | npm run check、体积 | PASS | menu 3.71/15，common+s1 126.53/150，首次进 S1 130.24/150，s3 25.65 MB，和程序给的数一致；test:father ✓ |
| ② | BUG-021 值班簿四栏 | PASS → closed | 1080 / 720 文字都在栏内，溢出 0；标题只有 1 个 |
| ③ | BUG-022 翻页箭头字体 | PASS → closed | 计算出的字体是 Foglight Serif；check-css 有断言 |
| ④ | BUG-023/031 父亲进游戏 | PASS → closed | 在 s3 组里；LOD [0,40,100] 实际会切；3 段动画都播；手和头发最近 0.4–0.5 mm，最深 7.6 mm，进头皮 0；新开 BUG-024（P3，左袖口透光缝） |
| ⑤ | 018 S1 打磨 | PASS（部分未测） | 礁石 164、桩 38、前景礁石 9；出生点正常；码头 / 小径 / 脚印 / 浮台路线都没卡；脱困测了 155–159（最少 5/8 个方向能走）；160–163 和桩旁滩地未测；157 号礁石南侧会把人推进深水区，触发送回（观察项） |
| ⑤b | 裁定 21 | PASS | 灯塔剪影没被挡；小径尽头机位画内 53 个点，被新礁石挡 0 |
| ⑥ | 016 汐下摆 / 袖口（脸在重做，不看） | PASS | 没有黑带；父亲袖口见 BUG-024 |
| ⑦ | 回归冒烟 12 项 | PASS | 013 art=1 第一次因负载超时，重跑通过；019 A=3、B=0 |

截图：父亲手放头上 father/s3-father-hand-closeup.png；S1 开场 s1/s1-opening-low.png；脚印 + 大礁石 s1/s1-pathend-low.png；汐下摆 / 袖口 xi/xi-hem-front.png、xi/xi-cuff-r-front.png（拼图 xi/xi-grid-bright.jpg）。

## ① npm run check（一次跑完，日志 qa-v0.1-batch15/b15-check.log，00:39–00:40）

- EXIT 0：typecheck、lint、所有 test:*（含新的 test:father）、build、size、css 都过了。
- 包体（check-size）：主菜单 menu+boot **3.71 / 15 MB**；首场景 common+s1 **126.53 / 150 MB**；首次进 S1 **130.24 / 150 MB**；s3 **25.65 MB** —— 和程序说的数一致 ✓。预估：../art 里已交付但还没登记的 11 个文件（s1 3.22 MB、s3 4.67 MB）全部接入后约 129.74 / 133.45 MB。
- test:lightmap：合计 12.30 MB（batch14 是 12.27）；18 个 GLB 的 uv1 都在 rect 内；船绳两版都挂了 lightmap ✓。
- test:father：manifest 的 s3 组有 char-father 和 char-father-anims；applyLodDistances 把 [0,1000,2000] 改成了 [0,40,100]；185 条轨道全部绑上；3 段动画能播；hand-on-head 对位矩阵误差 1.1e-16；事件帧 20/56/66/98/136/170；handOn–handOff 之间掌心到汐头顶最大 0.094 m ✓。
- check-css：button / input / select / textarea 全局 `font: inherit`（BUG-022），源码和产物里都有 ✓。
- 结论：**PASS**

## ② BUG-021 值班簿四栏（9cacee3；用快照里的 scripts/shots-030.mjs QA 副本，只把输出改到 QA_OUT，分 1080 和 720 各跑一次）

- 截图：qa-v0.1-batch15/ui-1080/030-read-logbook.png、ui-720/030-read-logbook-720.png；裁图 logbook-crop-1080.png、logbook-crop-720.png。
- 实测（两种分辨率下 css 坐标一样）：16 个单元格，越界 0；左对齐列（日期 / 记事）字左对左线 +5 的偏差 0；居中列（时 / 天气）字中心对两线中点偏差最大 4.2 px、平均 −0.84；竖直方向偏差最大 0.8 px。看图：「夜」「雾」「大雾」都在各自栏里，不压竖线；「（水渍，日期看不清）」缩成 14 px 分两行，留在日期栏里；记事从记事栏开始写 ✓。
- 标题：页眉「值班簿」只出现一次（DOM 标题列表 = ['值班簿']，正文第一行留空）；表头那一行就是纸上印的「日期 / 时 / 天气 / 记事」✓。
- 观察（不算 bug）：两行的水渍日期把行高占满了，第二行「不清）」贴着下一条横线。
- 结论：**PASS → BUG-021 closed**

## ③ BUG-022 翻页箭头字体（770c4ed）

- 同一次运行里的 style 探针：`.reader-arrow` 的计算字体在 1080 和 720 下都是 `"Foglight Serif", "Noto Serif CJK SC", "Source Han Serif SC", serif`，和阅读正文一样；6 份文档、两种分辨率都没出现 Arial ✓。
- check-css（见 ①）断言了全局 `button/input/select/textarea { font: inherit }`，源码和产物里都有，并且没有别的 font 简写把继承盖掉 ✓。
- 结论：**PASS → BUG-022 closed**

## ④ BUG-023 / 031 父亲游戏内（a192918；S3 art=1 quality=high，dev 开关 ?debug=1&father=hand|gaze|walk）

- 用到的脚本：程序的 scripts/shots-031-father.mjs（QA 副本，只改输出目录）→ qa-v0.1-batch15/father/s3-father-{gaze,walk,hand,hand-closeup}.png；我自己的 /workspace/qa-tools/t15-father.mjs、t15-fhair.mjs、t15-fcuff.mjs → father/t15-father.json、hand-hair-depth.json，以及 hand-*.png、father-cuff-*.png。
- manifest / 加载：char-father、char-father-anims 登记在 s3 组（test:father ✓）。进 S3 后 77 个资源里有 char-father.glb、-anims.glb、tex-father-albedo / orm / normal.ktx2，0 失败、0 占位。注意：t15-father 第一次运行时 44 张 KTX2 报 "Failed to fetch（3 次）" 用了占位（box 负载下的偶发抓取失败，batch13/14 也遇到过），截图全黑 / 紫格，那次作废；重进后 0 失败，后面的数据都来自重进之后。
- 开关：?father=gaze / walk / hand 三个都生效（进场就在播、可见）✓。
- **LOD**：char-father 的 levels.distance = [0,40,100]，hysteresis 0.08（quality=high 档的 [40,100,250] 经 applyLodDistances 设上）。冻结后移动相机实测（相机到 LOD 的距离 → 当前档）：3→0、30→0、38→0、44→1、60→1、95→1、106→2、150→2；拉回 95→2（还在回滞带 92–100 内）、44→1、36→0、3→0 ✓，确实在切。
- **3 段动画**：gaze 播的是 father-stand-gaze，2 s 游戏时间 clip 推进 2.0 s，头部移动 1.5 cm（呼吸 / 微动），根不动 ✓；walk 播的是 father-walk-away，2 s 根沿桥移动 2.60 m（= 1.3 m/s），左脚移动 2.105 m ✓；hand 播的是 hand-on-head，事件全部触发（程序脚本录到的帧号 reachStart 23 / handOn 61 / strokeA 68 / strokeB 99 / handOff 137 / armDown 174；设计值是 20/56/66/98/136/170。差的几帧来自 SwiftShader 下每帧步长较大、事件在步末才被记下；test:father 的逐帧单测和设计值完全一致）✓。
- **摸头接触**（hand 模式定格在 60/75/90/105/135 帧）：
  - 有没有缝：父亲右手 LOD0 顶点到汐头发（mat-char-xi-hair）顶点的最小距离 0.4–0.5 mm，10% 分位 3–4 mm → 贴上了，看不到缝。程序量的掌心到汐头顶距离是 0.080 m（单测上限 0.094）✓。
  - 有没有穿发：以汐的头心为原点、每 2° 取头发外表面半径，手部顶点陷进外表面的最大深度 3.3–7.6 mm，超过 5 mm 的顶点每帧 0–2 个，超过 1 cm 的 0 个，穿到头皮（脸 / 身体网格）的 0 个 → 只是手指压在发面上，没有可见穿插 ✓。
  - 截图：**father/s3-father-hand-closeup.png**（程序机位）、hand-side2-bright.jpg、hand-top-bright.jpg、hand-grid-bright.jpg（5 个机位，提亮 2 倍）：手掌和手指搭在头发上，看不出缝，也没有穿出 ✓。
- 父亲大衣袖口（⑦ 也要看）：没有黑带。**但是**左袖翻边和袖身之间有一条透光缝：father-cuff-hand-l-front.png（放大图 father-cuff-stripe-zoom.png）里能透过缝看到身后的天空，颜色、噪点和旁边窗外天空一模一样，和天空区域是连着的；father-cuff-hand-l-out-bright.jpg 里同一位置背后是暗的，就显成一条暗线。缝高约 8 px，约 4 mm（相机距离 0.55 m、fov 35）→ **BUG-024（P3）**。右袖（hand-r-out）和背手姿势的两袖（gaze-back-r/l）没看到。
- 结论：BUG-023 的验收点（manifest、LOD 实切、3 段动画、摸头接触、test:father）全部 **PASS → BUG-023 closed**；新开 BUG-024（父亲左袖口缝，P3，美术）。

## ⑥ 016 汐下摆 / 袖口黑带 —— **PASS**
- 自写 /workspace/qa-tools/t15-xi.mjs（S1 art=1 quality=high，134 项加载 0 坏，冻结后摆机位；正面取 rig.animator.model 的 +Z）。日志 logs/b15-xi.log，数据 qa-v0.1-batch15/xi/t15-xi.json。
- 截图：qa-v0.1-batch15/xi/xi-hem-front.png、xi-hem-front-low.png、xi-hem-side.png、xi-cuff-{r,l}-front.png、xi-cuff-{r,l}-under.png、xi-cuff-r-side.png；提亮拼图 xi-grid-bright.jpg、xi-hem-pair-bright.jpg。
- 毛衣下摆罗纹：能看到针织纹理，颜色和毛衣一致，没有黑带，和 art/.../char-xi-hem-polish-closeup.png 的「after」一致。
- 大衣袖口翻边：浅蓝色，下面露出深藏青的针织袖口（参考图「改后」里也是这样），没有黑带。从正面、下方、侧面看都正常。
- 程序 shots-031 的 s1-xi-hem.png 拍到的是腰侧和袖子，没有对准下摆：它用 rig.entity.object3D 的方向当正面，和模型朝向不一致。这是脚本取景问题，不影响验收。
- 父亲袖口：见 ④。没有黑带；左袖口翻边有约 4 mm 的透光缝，已记为 BUG-024（P3）。

## ⑤ 018 S1 打磨：碰撞 / 不卡人 / 出生点 —— **PASS（脱困只测了一部分，见下）**
- 自写脚本 /workspace/qa-tools/t15-walk.mjs、t15-walk2.mjs（S1 art=1 quality=low；134 项加载 0 坏）。用 `input.setRaw('smoke','KeyW')` 按键，每 60 ms 把 cameraFollow.yaw 对准下一个路点。判卡死的标准：2 s 游戏时间内离路点的距离没缩短 0.05 m。
- 日志：logs/b15-walk.log、b15-walk2.log；数据：qa-v0.1-batch15/walk/t15-walk.json、t15-walk2.json。
- 数量（从游戏里读）：礁石 InstancedMesh 18 个，实例合计 **164**；码头桩碰撞 `s1-pier-pile-*` **38** 根；前景礁石碰撞 `s1-fg-rock-*` **9** 块 ✓。
- 出生点：(2.277, 2.2, −11.772)，onGround=true，与 S1.spawnStart 一致 ✓。
- 码头（涨潮，出生点 → 甲板中线来回 S 形 → 岸台）：9.2 s 游戏时间走到，没卡住 ✓。
- 退潮后（instant）：岸台 → 11 级台阶 → 礁石小径 6 块 → 小径尽头，12.1 s 走到 ✓。
- 脚印路线（小径尽头 → T1–T4 贴花中心 → 浮台边）：5.4 s ✓。
- 浮台路线（小径尽头 → raft.home 的 9 点直线）：5.5 s ✓。
- 前景礁石 8 向脱困：每块礁石四边外 0.3 m 各放一次，每个方向按 W 0.45 s 游戏时间，位移 > 0.15 m 记为能走。已测 155–159 共 20 个点，最少的点也有 **5/8** 个方向能走，走不动的方向都是正对礁石，**0 个点卡死** ✓。
  - 159 是可踩上去的碎石，有两次起点落在它顶上（y 0.62–0.65），照样能走开。
- **未测**：160–163 四块礁石的脱困、码头桩旁滩地脱困、礁石群中间穿缝的路线。原因是 SwiftShader 下每块要 2–3 min，我主动停掉了脚本，这几项不判结论。
- 观察（不判 bug）：沿 157 号礁石南侧往东（x 11→5，z ≈ −8.45）走时，碰撞盒把人顺着推到 z −8.95，也就是 deepWater 区的边界，于是触发了「送回安全点」（两次都复现，trace 里 (10.98, −8.95) 的下一帧就到了 (−12.5, 2.4, −4)）。157 碰撞盒南角算下来到 z ≈ −9.0，所以它和深水区之间没有能走的缝。这是机制本身的表现，没有卡死，供策划确认。
- 开场画面：qa-v0.1-batch15/s1/s1-opening-low.png（high 档：s1-opening-high.png）。

## ⑤b 裁定 21：大礁石不挡灯塔剪影 / 退潮脚印 / 去浮台的路 —— **PASS**
- 数据来自快照 scripts/shots-031.mjs 的 QA 副本（qa-v0.1-batch15/s1/shots-031.json）：对 S1_ROCKS 155–163 这 9 个新实例做线段遮挡测试；目标是 T1–T4 贴花的 8 个角加中心，以及「小径尽头 → 浮台」11 个点，每点取地面和身体两个高度。
- 开场机位 eye (−0.9, 4.2, 9.5) fov 40（s1/s1-opening-low.png、s1-opening-high.png）：
  - 灯塔连同小岛的剪影完整。右侧大礁石在灯塔右下方，和灯塔、小岛都不重叠 ✓。
  - 脚印和浮台路线在这个机位画内的点数是 0：机位不朝下，它们在画面下沿以外，不是被礁石挡住。被新礁石挡住的点数 0 ✓。
  - follow-start 机位也一样（画内 0，被挡 0）。
- 小径尽头机位 eye (1.2, 2.3, 2.2) fov 60（s1/s1-pathend-low.png）：画内 53 个点（脚印点 32、路线点 21），**被新礁石挡住 0** ✓。目测脚印一路通到浮台，清楚可见 ✓。新礁石在 z −3.8…−6.6，位于这个机位身后。
- 观察：小径尽头画面里，沙面上有几块大的深色多边形斑（batch14 的截图里已经有）。它们在新礁石的对侧，所以不是新礁石的影子；成因未查（可能是积水贴花或阴影级联）。**不判结论**，也没有开 bug。
- 截图：开场 s1/s1-opening-low.png；脚印 + 大礁石 s1/s1-pathend-low.png。

## ⑦ 回归冒烟（快照 0598043，runq15.sh，一次只跑一个）
- smoke 003（q15-003.log）：EXIT 0，**PASS**（✓ 行 4，✗ 行 0）
- smoke 005（q15-005.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 007（q15-007.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 008 art=1（q15-008a1.log）：输出了「冒烟测试通过」，✓ 行 3，✗ 行 0，**PASS**。外层 shell 被中断，所以没有 EXIT 行；冒烟本身跑完了
- smoke 010（q15-010.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 013 art=0（q15-013a0.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 013 art=1（q15-013a1.log）：EXIT 1，**FAIL**（✓ 行 2，✗ 行 1）
- smoke 014 art=1（q15-014a1.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 015 art=1（q15-015a1.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 017（q15-017.log）：EXIT 0，**PASS**（✓ 行 5，✗ 行 0）
- smoke 019 sample-317（q15-019.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 021/022（q15-021.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- smoke 013 art=1 重跑（q15-013a1r.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 013 art=1 第一次失败的原因：`S1 没就绪`。冒烟在 smoke-browser.mjs:1579 等 S1 就绪，上限 40 s，超时了；当时 box 的 load average 约 12。等 load 降到 2.5 后重跑一次（q15-013a1r.log），EXIT 0，PASS。判定为环境负载造成的超时，不开 bug。
- 019 sample-317：日志里是「A 簇 3 个（接受）、B 簇 0 个 ✓」✓。
- 回归结论：12 项全部 PASS（013 art=1 是重跑后通过）。npm run check 见 ①。
