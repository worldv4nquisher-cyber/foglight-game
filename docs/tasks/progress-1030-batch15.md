# batch15 进度（018 前景礁石/码头木桩、016 汐下摆、涨潮倒影矩形、回归）
起点 HEAD 8ad6b9b，22:21 开始

- [x] 22:21 字节核对：pier 1,331,548 / shore-lm 1,430,381 / tidal-flat-lm 1,087,048 / char-xi 2,004,108 / anims 1,511,396（未动）全部吻合
- [x] rocks.ts 重新生成 155→164（11a18fe），新脚本 scripts/gen-s1-rocks.mjs
- [x] 018 S1 碰撞（e362c24）：桩 38 根对位美术 collider，前景礁石 9 块挡人盒；test:physics 23/23、test:camera 20/20、test:render 全过
- [x] S1 三角面自算（礁石 164 实例 + 大件 + 灯塔 socket；码头两版船绳都算）：3,119,356 / 1,561,910 / 765,657，预算 4M / 2.3M / 1M 内（美术报 3,119,116 / 1,561,094 / 764,473，差 ≤ 0.16 %，礁石实例 2,340,080 / 1,170,040 / 571,374 完全一致）
- [x] 016 test:xi：char-xi.glb 73 骨 / 9 蒙皮网格 / hand_r_socket ✓，anims.glb 2163 条轨道全部绑上，钥匙 socket 偏差 0.0 mm
- [x] test:lightmap 10/10（码头 uv1 落在 rect 内、出 rect 顶点 0、子网格全挂 tex-s1-shore-lightmap）
- [x] npm run check 全绿（dist 已从 HEAD 重建）；size：common+s1 126.52 MB、首次进 S1 130.23 MB / 150
- [ ] 浏览器队列 /workspace/b15probe/queue.sh（probe 倒影探针 → shots-031 → smoke 010 → 013 art0 → 013 art1 → 003 相机），日志 /tmp/b15-queue.log；等别人 Chrome 退出

## 续（23:11 新执行者接手）
- [x] 23:12 队列现状：probe ✓(22:52–22:55)、shots ✓ 但贴图 Failed to fetch 大面积紫格占位、s010 ✓、s013a0 ✗（SMOKE_QUERY=art=0 在前，段内 goto('art=1') 被全局 art=0 盖掉 → "美术件没加载全"，是排队参数问题不是回归）；s013a1 / s003 未起（在等制作人 QA 的 smoke，/workspace/qa-tools/snap-8ad6b9b）
- [x] dist 是 22:31 建的，早于美术 22:35 新袖口贴图 → 停掉旧队列（自己的 queue.sh，没有自己的 Chrome 在跑），23:14 从 HEAD e362c24 重建
- [x] 新袖口贴图字节核对：tex-xi-albedo 7,922,335 ✓、tex-xi-orm 7,901,524 ✓（char-xi.glb 2,004,108、normal 6,209,533 未变）；dist 内与 art/ 逐字节相同（cmp）
- [x] size（新 dist）：common+s1 126.53 MB、首次进 S1 130.23 MB / 150 ✓；test:xi 全过
- [x] shots-031.mjs 重写（未提交，lint ✓）：等 loadStats 全部完成且无占位再截；加 follow-start / pathend / 码头倒影近机位 / 汐下摆 + 袖口；9 块新礁石对 T1–T4、去浮台路线的遮挡射线检查
- [ ] 新队列 /workspace/b15probe/queue2.sh（23:20 起，日志 /tmp/b15-queue2.log、/tmp/b15q2-*.log）：shots → s010 → s013（默认）→ s013 art=1 → s003；在等制作人 QA 的 smoke 跑完
- [x] 倒影证据拼图 docs/tasks/shots-031/reflection-rect-preview-probe.png（env.html opening 涨潮：原样 / 水面不透明 / 关反射 / 隐藏潮滩）
- [ ] 补探针：hide=^env-pier（确认矩形是否是透明水面下码头水下部分），队列跑完再起

## 追加（23:32 父 agent 转制作人：batch14 验收过，BUG-019/020 关；以下排在当前队列之后，每项单独提交）
- [x] A 裁定 21：e362c24 符合（9 块网格最北 z −3.17、挡人盒最北 −3.15，都在 z −3 南沿外；视线 88 条无遮挡），只补断言（test:render）→ 提交见 git log
- [ ] B BUG-021 值班簿四列对齐 + 标题只留一个；重截 030-read-logbook，量对齐误差
- [ ] C BUG-022 button / input / select 全局 font: inherit + check-css 断言
- [ ] D BUG-023 / 031 父亲接入 S3（新版 5 文件字节核对、manifest s3、applyLodDistances、mixer 按骨骼名绑、接口 + ?father=gaze|walk|hand、hand-on-head 对位与事件帧单测、截图 4 张、size：common+s1 不变）

### C. BUG-022 ✅（770c4ed）
- styles.css 在 `*{box-sizing}` 后加全局 `button, input, select, textarea { font: inherit; }`（元素选择器特异度最低，各控件类自己的 font-family / font-size 仍生效；.reader-arrow 等没写字体的按钮改为继承）。
- check-css.mjs 第 3 项断言：源码 + 产物都要有这条（按选择器集合比），源码里控件元素选择器不得再写非 inherit 的 font 简写。源码侧已过；产物侧要等 queue2 跑完后重建 dist 再跑（旧 dist 正确报缺，证明断言有效）。
- 待：重建后 npm run css；030 阅读器截图里看箭头字体（随 B 一起拍）。

### queue2 shots-031 ✅（23:31–23:37，dist = 23:14 重建的 e362c24，exit 0，loads 134/134 无 bad / 无重试 / 无降级）
- 遮挡（shots-031.json occlusion）：opening-low / follow-start-low 画内目标 0（开场机位水平看塔、脚印 / 路线在画框下沿以外；跟随起点在码头朝外）→ 不可能被挡；pathend-low 画内 53（脚印点 32、路线点 21），被新礁石挡 0。verify-render 的裁定 21 射线（开场 46 + 小径尽头 42 条）同样 0 挡。
- 画面：opening-high/low 塔剪影完整，新礁石在画面右下（南沿外），不碰塔；pier-high / pier-reflection-high 水面不透明、无矩形；pier-low 看得到 38 根桩。
- 汐：s1-xi-cuff-r 下部可见毛衣下摆罗纹、右袖口罗纹，均为藏青针织，无黑带；cuff-side 袖口同；对照拼图 shots-031/xi-hem-cuff-compare.png。（s1-xi-hem 机位偏侧，下摆被大衣挡，以 cuff-r 为准。）
- 接着：s010 → s013 → s013a1 → s003（queue2 进行中）。

### B. BUG-021（代码完成，待重建后拍 030-read-logbook）
- 新 src/ui/paperTable.ts：纸图实测竖线 x(2x)=59/292/356/464/1030 → 列 29.5/146/178/232/515 css；横线 y=71.2+32.3(k+1)−1.5 → 正文第 0 行在表格上方、第 1 行是印好的表头、第 2 行起是表格行。
- Reader.render：有表格规格的纸（只 logbook）按行 div（32.3 px）+ 绝对定位单元格；字段按 U+3000 切，多余并入记事；第 0 行等于标题 → 留空（标题只剩 .reader-title）；表头行留空。放不下的格先缩字（≥13 px）再折两行（≤14 px）：「（水渍，日期看不清）」→ 14 px 两行落在日期栏。
- 文本表（自动生成）不改。verify-narrative 加用例（20/20）。

## D. BUG-023 / 031 父亲接入 S3 —— 代码 a192918（截图 / size 待 dist 重建）
- manifest s3 组登记 `char-father`（模型 1,001,968 B，外链 tex-father-albedo/normal/orm.ktx2 由 vite 拷 GLB 引用贴图进 dist）+ `char-father-anims`（176,144 B），optional + art。size-groups 已有 char-father / tex-father → s3，common+s1 不应变。
- `src/entities/father/clips.ts`（纯）：3 个 clip 表、事件帧、hand-on-head 对位常量、`handOnHeadTimes`（父亲 min(e,6)，汐 e mod 6）、事件区间、走路距离。
- `src/entities/father/FatherActor.ts`：mixer 绑在 SkeletonUtils 克隆的模型上、按骨骼名绑定；gaze（循环）/ walk（循环，根 1.3 m/s 从 from 走向 to，到头重来）/ hand（LoopOnce 停末帧）。hand 每帧：父亲根 = 汐 model.matrixWorld · T(0,0,0.48)·R_y(180°)（换到父节点局部），XiAnimator.setPose('xi-stand-gaze', t) 同帧，事件回调 onEvent。
- `S3Scene`：buildInteractables 末尾 buildFather（在 applyQuality 之前 → LOD 距离由 applyLodDistances 设，画质切换再设），挂 S3 frame 下默认隐藏；update 里父亲先于实体（同帧先写汐姿势）；`playFather(mode)` / `hideFather()` / `fatherGazePlace()`（美术 lamp-room-stand-gaze 节点，缺则 layout standGaze）；dev 开关 `?father=gaze|walk|hand`（debug / smoke 才认）。hand：汐瞬移到眺望站位（fade 0、朝外）、锁输入后起播。
- `scripts/verify-father.mjs`（npm test 里 test:father）：真 GLTFLoader 解析，73 骨、LOD0–2 蒙皮、applyLodDistances [0,1000,2000]→[0,40,100]、185 条轨道按名绑上；三段都动（gaze 骨骼最大转角 3.71°、walk 左脚相对根 0.806 m、根 1.3 m/s）；hand 对位误差 1.1e-16、汐时间 = 父亲时间、事件 reachStart@20 handOn@56 strokeA@66 strokeB@98 handOff@136 armDown@170 各一次、掌心到汐头顶 handOn–handOff 最大 0.094 m / 抬手前·放下后最小 0.766 m。
- 截图脚本 scripts/shots-031-father.mjs 已写，等 queue2 跑完重建 dist 后拍。

## queue2 收尾（23:46 结束）
- smoke 010 ✓（S1→S2 3330 ms 全黑 1855 ms；慢加载 S2→S3 9215 ms 进度线 15 帧；S3 点灯→结束页）；013 art0 ✓；013 art1 ✓（岩石 164 实例、四条跨越落点离边沿 0.32 m、GLB/KTX2 115 个无失败无占位）；003 ✓（室内 1.88 m、观察 30°）。日志 /tmp/b15q2-*.log。
- 注意：这四个 smoke 跑的是 B/C/D 改动之前的 dist；下面重建后补跑。

## 续（00:23 第三个执行者接手）
- [x] 现场核对：上一执行者 23:50 已从 a192918 建过 dist（/tmp/b15-build2.log），并跑了 queue3（/tmp/b15-queue3.log）：父亲 4 张图（00:07–00:08）、030-read-logbook 1080 / 720（00:21）、smoke 005 / 015 白盒 / 015 谜题 5 / 017 S1·S3 / 010 全过 —— 这些此前没记进本文件，补记。
- [x] Chrome 现场：PID 1386365（shots030-chrome，22:15 起）cwd = /workspace/qa-tools/snap-8ad6b9b/game → 制作人 QA 的 shots-030 留下的，不碰；PID 1405964（preview-chrome，22:31 起）cwd = /workspace/bpolish/sb → 美术预览工具的，不碰。两者驱动进程都已不在（父进程 53）、CPU ≈ 0，不会自己退出；按上一执行者的 ignore-pids 做法视为空闲，我们的浏览器仍一次一个。
- [x] 未提交脚本检查完整（eslint / node --check 过）并分别提交：60e5a34 shots-030（SHOTS_SIZE、四栏对齐量测、箭头字体）、0598043 shots-031-father。
- [x] 00:25 从 HEAD 0598043（代码同 a192918）重建 dist：产物哈希与 23:50 那次完全相同（index-cKDrs0mn.js / index-DhbFvLsu.css）→ queue3 的截图 / smoke 就是这份 dist。dist 内 tex-xi-albedo 7,922,335、tex-xi-orm 7,901,524、char-father 1,001,968、char-father-anims 176,144、tex-father-albedo 1,389,130 / normal 1,107,676 / orm 1,639,739，全部与 art/ cmp 相同。
- [x] npm run check 全绿（/tmp/b15-check3.log，含 check-css BUG-022 源码 + 产物断言、test:father、test:xi）。size：common+s1 126.53 MB、首次进 S1 130.24 MB / 150（与父亲接入前 23:14 的 126.53 / 130.23 一致，差 0.01 是取整），s3 25.65 MB（父亲在 s3）。
- [x] 截图不重拍（同一份 dist）：030-read-logbook（00:21，1080 + 720）四栏左对齐列误差 0 px、居中列最大 4.2 px（均值 −0.84）、竖直最大 0.8 px、越界 0 格，标题只出现 1 次（「值班簿」）；翻页箭头 font-family = Foglight Serif（思源宋体子集），不是 Arial。父亲 4 张（00:07–00:08）掌心到汐头顶 0.080 m。汐袖口 / 下摆 23:36 拍时 dist 已含新贴图（23:14 dist cmp 过），不重拍。
- [ ] 补跑 smoke（/workspace/b15probe/queue4.sh，日志 /tmp/b15-queue4.log、/tmp/b15q4-*.log）：010 → 013 art0 → 013 art1 → 003 → 015 art=1
- [x] 00:25–00:36 queue4 补跑 smoke（新 dist，全部 exit 0 / 冒烟测试通过）：010 ✓（S1→S2 2877 ms，慢加载 S2→S3 进度线 8 帧，S3 点灯→结束页）、013 art0 ✓（脚印独白小径尽头不弹、T2 弹）、013 art1 ✓（四条跨越落点离沿 0.32 m，T1–T4 y 0.119/0.116/0.114/0.112）、003 ✓（室内 1.88 m、观察 30°）、015 S3 白盒 art=1 ✓。另：queue3（同一 dist）005 / 015 谜题 5 / 017 S1·S3 也过。
- 倒影矩形：游戏内 s1-pier-high / s1-pier-reflection-high（涨潮、art=1、high）水面不透明、无矩形；矩形只在美术预览 env.html 透明水面下出现（reflection-rect-preview-probe.png）。hide=^env-pier 补探针未做（不影响结论：游戏里不复现）。
- 汐：tex-xi-albedo / orm 新版进 dist 后拍的 s1-xi-cuff-r / cuff-l / cuff-side，下摆与袖口罗纹为藏青针织，无黑带。
- 遗留：PID 1386365（QA 快照）/ 1405964（美术预览）两个空闲孤儿 Chrome 没碰，需要各自主人收掉。
**batch15 收尾完成，可交制作人验收（本执行者未发任何消息）。**
