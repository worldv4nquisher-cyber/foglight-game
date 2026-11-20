# QA v0.1 batch16 —— HEAD 5f8c1f5（c0d81c9..5f8c1f5，11 commits）

方法：
- 快照 /workspace/qa-tools/snap-5f8c1f5/game 用 `git archive 5f8c1f5` 导出。
- art → /workspace/scratch/r3/art（汐头部 r3，避开正在进行的 hair r4），audio / docs 用符号链接。
- dist 直接用预构建的 /workspace/scratch/r3/game/dist（硬链接进来），不重新构建。快照的 src/、scripts/ 与 r3 工作区逐文件一致。
- 无头 Chrome + SwiftShader，一次只跑一项，每跑完一项就追加结果；每次跑完都杀掉自己开的 Chrome，并删掉 /tmp 下的 profile。
- 不评 fps。截图和数据放在 qa-v0.1-batch16/。

## 汇总（batch16，HEAD 5f8c1f5，2026-10-31）
| # | 项 | 结果 | 要点 |
|---|---|---|---|
| ① | 033 菜单音乐 / S1 懒加载 / 404 / 电平 | PASS | 首帧后才请求 S1 曲，2 s 交叉淡入；404 时无音乐、无报错，菜单曲 2 s 淡出；整曲电平差 0.04 dB |
| ② | 包体 | PASS | menu 5.41/15，common+s1 126.98，lazy 2.41，首进 S1 132.39/150（含 lazy 134.80），s3 25.72 MB |
| ③ | #157 南侧 + 018 脱困 | PASS | 南侧 5 条路径 0 recall；155–163 贴边、礁缝、栈桥旁沙滩共 200+ 点无卡点；召回只在越过深水线 z≈−8.95 时触发 |
| ④ | BUG-024 袖口透光 | PASS → 已关闭 | 同机位 b15/b16 对比，亮线消失，两袖都无缝 |
| ⑤ | s1-xi-hem 正面 | PASS | 前襟、两只袖口都入镜 |
| ⑥ | 汐头 r3 游戏内 | PASS | 脸 mesh 完全镜像对称，0 接缝；半脸暗影确认是 toon 光照；摸头无缝 |
| ⑦ | smoke 015 art1 hum + npm run check | PASS | 015 art=1 EXIT 0；check 全绿（build 换成 prebuilt dist） |
| ②' | 包体复核（8ccd2b0） | PASS | 首进 S1 132.40/150；懒加载 S1 2.41 / S2 2.46 / S3 6.43 MB；menu 5.42；common+s1 126.98 |
| ⑧ | S2 小屋曲 | PASS | 首帧后懒加载，2 s 从 S1 交叉淡化，整文件 loop，接缝无爆音 |
| ⑨ | S3 两层 + 爬塔 | PASS | 两层同刻起播或同余对齐；增益 0 / 0.45 / 0.725 / 1.0；逐级爬 108 级无跳变、无重启（跨过循环点）。首跑 ✗ 是 60 s 墙钟超时（环境），放宽后通过 |
| ⑩ | 结尾曲 | PASS | 点燃帧 start(0)，差 0 s，loop=false；场景曲 2 s 淡出；跳过 0.75 s；晚到 / 404 路径未自测 |

新 bug：无。（⑧–⑩、②' 为 06:48 追加项，dist 8ccd2b0）

## ⑦a npm run check —— **PASS（build 步骤用预构建 dist 代替）**
- 05:59–06:00 依次跑 typecheck → lint → test → size → css，**每步都是 EXIT 0**。日志：qa-v0.1-batch16/b16-check.log。
- `npm run build` 没跑，用 r3 的预构建 dist 代替，原因是 art/ 里有正在进行的 hair r4，按要求不重新构建。
- test 里：verify-audio 32 项 ✓（其中包括 ffmpeg 重测 mus-menu / mus-s1-ebb-shore 的整条 RMS）；test:father 的 hand-on-head 蒙皮网格量法 ✓。

## ② 包体（npm run size，dist = /workspace/scratch/r3/game/dist）—— **PASS**
| 项 | 实测 | 期望 |
|---|---|---|
| 主菜单 menu+boot | **5.41 MB** / 15 | ≤15 ✓。batch15 是 3.71，多出来的是菜单曲 |
| 首场景包 common+s1 | **126.98 MB** / 150 | ≈126.98 ✓ |
| S1 进场后懒加载 | **2.41 MB**（mus-s1-ebb-shore.ogg） | 2.41 ✓ |
| 首次进入 S1 总下载 | **132.39 MB** / 150 | ≤150 ✓。脚本里这一项不含懒加载曲；含上它是 134.80 |
| s3 | **25.72 MB** | ≈25.72 ✓ |
- 预估：../art 里已交付但还没登记的有 12 个文件，全部接入后首场景包约 129.54，首次总下载约 134.96。
- smoke 033（两项：交叉淡化 + 404）（q16-033.log）：EXIT 0，**PASS**（✓ 行 4，✗ 行 0）

## ① 033 菜单曲 / S1 曲懒加载 / 电平 —— **PASS**
- 冒烟 `SMOKE_ONLY=v0.1-033`（q16-033.log）：EXIT 0，2 项都 ✓。
  - **主菜单：**mus-menu 时长 106.67 s、2 声道，整文件循环（循环点 0/0），起播不淡入。点击前 context 是 suspended 且不报错，点击后变成 running，音乐总线上有电平。菜单阶段只下载 mus-menu.ogg。
  - **进 S1：**首帧 render 在 16826 ms，在同一时刻发起请求（+0 ms），下载 16827–26599 ms，淡入在 28588 ms 开始。顺序是「首帧 ≤ 请求 ≤ 下载开始 ≤ 淡入」✓。这首曲只请求了 1 次，S1 曲到之前菜单曲没有停。从 mus-menu 交叉淡化到 S1 曲用了 2 s，2.2 s 后 S1 曲增益是 1.00 ✓。
  - **404**（CDP 把 mus-s1-ebb-shore.ogg 路由成 404）：仍然只在首帧之后请求 1 次，musicLazyResult=missing，musicKey=null（不放音乐），菜单曲 stop 且 fade 2 s（淡出）。除 Chrome 自己那条 404 网络日志外，没有 console.error 或异常 ✓。
- **电平**（同一条音乐总线，总线 −17.94 dB）：
  - 冒烟按整条算：menu −39.73 dBFS（文件 −22.09 + 曲目 +0.30 + 总线），S1 −39.77 dBFS（文件 −21.83 + 0 + 总线），**差 0.04 dB**，在 ±1 dB 内 ✓。
  - 我自己对 dist 里的 ogg 用 ffmpeg 量了一遍（dist 和 r3 art 的 md5 一致）：
    - mus-menu：RMS −22.088 dBFS，峰值 −1.46，积分响度 −19.9 LUFS；
    - mus-s1-ebb-shore：RMS −21.833 dBFS，峰值 −1.42，积分响度 −20.0 LUFS。
    - 和 musicLevels.ts 里记的数一致。加上 menu 的 gainDb +0.3 之后 −21.79 对 −21.83，差 0.04 dB ✓；菜单曲峰值 −1.16 dBFS，不削波 ✓。
  - **观察：**冒烟里 8 s 实采的 RMS 是 menu −36.4 对 S1 −41.1，差 4.7 dB。这是 8 s 短窗口在稀疏曲子上的偶然值（程序在 musicLevels.ts 注释里已经说明），验收按整条算，不判 bug。如果制作人在意「刚进 S1 那几秒」听感上的落差，需要另外确认。
- **没能自己验证的：**404 时菜单曲增益随时间实际降到 0 的曲线，我没有单独录，只依据冒烟里 musicLog 的 stop / fade 2 s。

## ③ 礁石 #157 南侧 + 018 脱困（160–163 / 栈桥旁沙滩 / 礁缝）— PASS
- 实时路径（t16-walk，quality=low，潮位 low）：E→W z−8.60、W→E z−8.60、E→W 贴边 z−8.35、W→E 贴边、斜 NE→SE→SW，共 5 条全部走通，recall 0、jump 0、minZ −8.55…−8.63（深水线 −8.95 之内）。斜 NW→SE（从 9,−7.2 指向 11.8,−8.7）在 (9.27,−7.26) 被 #157 正面挡住。这是直线穿岩的预期阻挡，不是卡点，且 recall 0。
- 手动固定步（t16-esc，冻结主循环，页面内同步 fixedUpdate；方向自检 +x 1 s = 1.58 m）：
  - 重测斜 NW→SE：同样在 (9.27,−7.26) 被挡，recall 0。绕外侧 (9,−7.6)→(10,−8.6)→(14,−8.6) 能走通，recall 0；E→W z−8.75 能走通，recall 0。
  - 礁石 155–163 每块取 6 个贴边点，各向 8 方向各走 0.4 s：每个点至少 4 个方向可移动（>0.15 m），无卡死。
  - 礁缝：中心距 <3.5 m 的礁对，取 0.35/0.5/0.65 三处中点，全部可脱困，min moved=4。
  - 栈桥两侧 lx ±1.6/±2.0：落在深水区（z<−8.95）的点被正确召回。
  - 沙滩：x −10…3 × z −8.75/−8.3/−7.8，加上栈桥岸侧 lx ±1.6/±2.2、z>−8.9 的点，全部可移动，无卡点。所有 recall 触发前的位置 z 都在 −8.93…−8.95（即越过深水线时才召回），没有误召回。
- 证据：qa-v0.1-batch16/walk/t16-walk.json、t16-esc-all.json、t16-esc-beach.json；日志在 qa-tools/logs/b16-walk.log、b16-esc*.log。
- 局限：手动步进不经过 render/update，相机插值和动画不参与；实时路径已覆盖 #157 南侧。

## ④ BUG-024 回归（父亲两侧袖口透光）— PASS，BUG-024 已关闭
- t16-fcuff（S3 father=hand，第 90 帧冻结，quality=high）共 10 个机位：hand-l/r-out、front、up，gaze-back-l/r，gaze-side-l/r。两侧袖口在静态姿势下都没有透光缝。
- 和 batch15 同机位 hand-l-front 对比：左袖翻边上沿原来有条亮线（背景是天空），现在没有了，袖口开口内部是暗的。程序对比图 father-bug024-cuff-compare.png 的结论一致。
- 证据：qa-v0.1-batch16/father/bug024-b15-vs-b16-hand-l-front.jpg、father-cuff-*.png、father-cuff-bright-sheet.jpg。BUG-024.md 状态已改为 closed（batch16，2026-10-31）。

## ⑤ s1-xi-hem 镜头改为正面（a4a0387）— PASS
- 用快照里的 shots-031 副本（QA_OUT=qa-v0.1-batch16/xi）拍 s1-xi-hem、s1-xi-face，EXIT 0，134 个资源 0 bad。
- qa-v0.1-batch16/xi/s1-xi-hem.png 是正面：大衣前襟、扣子、毛衣、左右两只袖口和翻边、两只手都在画面里，不再是腰侧。和程序图 docs/tasks/shots-031/s1-xi-hem.png 一致。

## ⑥ 汐头部 r3 游戏内 sanity（prebuilt dist）— PASS（头发只做 sanity，不报发型问题）
- 几何（t16-xihead，bind 几何）：
  - 脸 mesh char-xi_lod0_3（11166 verts，mat-char-xi-face）按 x 镜像后，最近点偏差超过 8 mm 的比例 0%，最大偏差 0 mm，完全对称。同位置的重复顶点 0 对，硬边 0，也就是没有 UV/法线接缝。
  - 头发 mesh 镜像偏差超过 8 mm 的占 6.1%，这是发丝本身不对称；发片硬边是片状几何的正常现象。r4 会替换头发，不计入问题。
- 画面（xihead-*.png，xihead-sheet.jpg）：正脸、±35°、两个侧面、背面都没看到接缝或破面。正脸有一侧半脸的明暗分界：把主光按头的前向平面镜像后重拍（xihead-front-lightmirror），分界跟着换到了另一侧，说明这是方向光的 toon 明暗交界，不是接缝。
- 父亲摸头：father-cuff-hand-r-out / hand-r-up 两个机位里，掌心贴在头发上，看不到缝。test:father（⑦a）报告掌心到发面 0.008–0.017 m，0 帧穿进头发。

## ⑦b smoke 015 art1 hum 断言修复（5f8c1f5）
- smoke 015 art=1（q16-015a1.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 修过的断言（smoke-browser.mjs 第 2683–2700 行）现在只看点火口嗡鸣 sfx-ignite-ready-loop。art=1 下塔内的环境声和 sfx-beam-hum-loop 不再算成多出来的嗡鸣实例。015 这一项（含 hum 开始/停止）通过，无 ✗。
- 加上 ⑦a npm run check 全绿，⑦ 整项 PASS。

---
# 追加（06:48 brief）：dist 更新到 8ccd2b0（5f8c1f5 之后 5 个提交：S2/S3/结尾曲配乐 + size + smoke）
- 新快照 qa-tools/snap-8ccd2b0：game/ 来自 `git archive 8ccd2b0`；art → r3 art；dist 用 `cp -al` 从 /workspace/scratch/r3/game/dist 拷来；node_modules 是硬链接（package-lock 没变）；src/ 和 scripts/ 与 r3 worktree 完全一致。所有脚本已改指向这个快照。

## ②' 包体复核（8ccd2b0）— PASS
- `npm run size` EXIT 0：menu 5.42/15；common+s1 126.98/150；**首次进入 S1 总下载 132.40/150**（与预期 132.40 一致）。
- 进场后懒加载：S1 2.41（mus-s1-ebb-shore）；S2 2.46（mus-s2-keeper-house）；S3 6.43（mus-s3-lighthouse 2.30 + upper 2.37 + mus-ending-ch1 1.75）。都与预期一致。配乐 6 首合计 12.99 MB。s3 包 25.72。
- 自己核对 dist 文件（ffprobe）：全部 44.1 kHz 双声道。时长：menu 106.67 s、S1 150.00 s、S2 151.11 s、S3 两层各 150.000 s（等长，同步循环不会漂）、ending 107.00 s。
- [预估] art 已交付但未登记的 8 个文件全部接入后：首场景包约 127.79，首次总下载约 133.21。

## ⑧ S2 守灯人小屋配乐 mus-s2-keeper-house — PASS
- smoke `v0.1-1031 配乐 S2`（q16-m8.log）EXIT 0 ✓：
  - 时序：S2 首帧 @27896 ms，同一时刻发出请求（首帧后才请求，懒加载），下载 27897–27922 ms，起播 @28355 ms。
  - 交叉淡化：mus-s1-ebb-shore → mus-s2-keeper-house，2 s，2.2 s 后增益 1.00。
  - 循环：loop=true，循环点 0/0（整文件），151.111 s。
  - 电平：音乐总线 RMS −46.4 dBFS，峰值 −29.7，测了 6 s。
- 自己用 dist 的 ogg 查循环接缝：首尾样本跳变 0.0004（中位步长 0.00125），没有爆音。结尾 50 ms 是 −35 dB 对开头 −19 dB：查了尾部包络，是钢琴余音自然衰减，下一圈从段首和弦起，属于音乐性循环点，不是断层（README：整文件循环，接缝 −63.9 dBFS ✓）。
- 没有自己听感验证（headless 不出声）。

## ⑨ S3 两层配乐（底层 + 紧张层）同步起播 / 上层增益按高度 / 爬塔中不重启 — PASS
- smoke `v0.1-1031 配乐 S3 两层`：
  - 第一次跑（q16-m9.log）✗，报错「S3 建立镜头后没回到 explore」。原因是冒烟等待写死 60 s 墙钟，而 box 负载 13–18 时游戏时间走得很慢，属于环境超时。官方 smoke-1031-music2.log 在同一提交上是通过的。
  - 我只在快照副本里把这个等待改成可配（QA_EXPLORE_MS=400000）再跑（q16-m9b.log），EXIT 0 ✓：
    - 起播时序：S3 首帧后才请求底层、上层和结尾曲预取。
    - 同步：上层比底层晚到（底层 start @9.4507，上层 when 9.6147 / offset 0.1640），按同余对齐后相位差 0 s，样本对齐。两层都是 loop，各 7200000 样本。
    - 从 S2 曲 2 s 交叉淡化。
    - 上层增益：桥尾（塔外）0；楼梯底 0；门内平台 0.101；平台 A 0.450；平台 B 0.725；灯室 1.000，和 brief 的 0 / 0.45 / 0.73 / 1.0 一致（B 实际是 15.8/21.8 = 0.725）。上层增益为 0 时 AnalyserNode 无电平；灯室上层 RMS −22.8 dBFS；全程两层 start / offset 不变。
- 自测 t16-climb.mjs（S3 直进 art=1 low，点击解锁 AudioContext；沿螺旋楼梯 1…108 级逐级传送，每级 2 帧，最后到灯室）：
  - 同步：直接进 S3 时两层同一 when 2.656、offset 0，musicLog 只有一条 play，layers=[upper]。
  - 增益：楼梯底 0 / A 0.4495 / B 0.7248 / 灯室 1.000。每一级目标增益都等于 (y−0.2)/21.8，偏差 >0.01 的级数为 0。相邻两级增益最大变化 0.018（=2 级），实际增益跟目标的最大滞后 0.0088（有斜坡），没有跳变。
  - 不重启：全程 musicLog 的 play 次数、startAt、when、offset 都没变。音频时钟走了 251 s，超过一圈 150 s，跨过了循环点，也没有重启或 seek。
- 证据：qa-v0.1-batch16/music/t16-climb.json；日志 logs/q16-m9*.log、b16-climb.log。
- 局限：逐级传送不是真的走楼梯物理（增益只取决于 y，结果等价）；没有听感验证。

## ⑩ 第一章结尾曲 mus-ending-ch1：点燃帧起播、单次、场景曲 2 s 淡出、跳过 0.75 s — PASS
- smoke `v0.1-1031 配乐 S3 点燃`（q16-m10.log，QA_EXPLORE_MS=400000）EXIT 0 ✓：
  - 起播：点燃 @音频 2.5280 s，结尾曲 start @2.5280，差 0.0000 s；从文件 0 s 开始，loop=false，淡入 0 s。
  - 场景曲：两层 2 s 淡出。点燃后 3 s 音乐总线 RMS −39.3 dBFS。
  - 进结束页：completeChapter 后进入章节结束页，结尾曲继续放（位置 9.95 s = 点燃后 9.95 s，没有重启），结束页上 RMS −41.4。
  - 跳过：cutscene:skip ch1-ending @点燃后 1.5 s → stop fade 0.75 s，0.9 s 后总线 −999 dBFS（静音）。
- 自己查 dist 文件：107.0 s；首样本约 0、前 10 ms −86.5 dB（从静音起，和「淡入 0 s」配得上）；最后 1 s −240 dB（静音），没有循环接缝问题。峰值 −2.62 dBFS，不削波。
- 代码（endingMusic.ts）：点燃时还没下载完会按偏移补位起播并淡入 0.5 s，下载失败就不放、不报错。这两条路径冒烟没覆盖，我**没有自测**。「单次」由 loop=false 保证，没有等满 107 s 看 end 事件。
- 按 brief 已知并接受、不算 bug（035 处理）：点燃 4 s 后出现章节结束页、结尾曲在结束页上放完；还没有跳过入口（只验证了 cutscene:skip 事件）；离开结束页时菜单曲淡入。
