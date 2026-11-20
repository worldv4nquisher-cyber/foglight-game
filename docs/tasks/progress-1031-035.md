# progress-1031-035：第一章结尾演出 + 父亲回忆段（程序执行者）

起点 HEAD 8ccd2b0（10-31 06:50 UTC+7 接手）。构建 / 截图 / 冒烟在 worktree /workspace/scratch/r3/game（art = r3 原件镜像），主仓库 art/ 下汐 / 父亲动画是 r4 在制品，不用。

## 步骤
- [x] 0 读材料：035 需求单、text-ch1 §1/§5、v0.1.md 裁定、music README CUES、README-031、progress-1031-music / music2
- [x] 1 CutscenePlayer + 时钟（音频时钟 / performance.now 后备）+ 单测
- [x] 2 ending.ts 时间轴 + S3 接入（替换 0:04 切结束页）
- [x] 3 父亲回忆段（hand-on-head 对位、同帧起播、幽灵材质）
- [x] 4 跳过（按住 Space 1 s，右下圆环；结束页上也能用）
- [x] 5 check / size —— worktree @bd0ee91 npm run check EXIT 0（r3-check-035.log）；首次进入 S1 总下载 132.41 MB（≤ 132.5）、首场景包 126.98、s3 25.81（+0.09 剪影 glb）
- [x] 6 （07:42 第二执行者接手 @0409fd0；08:28 第三执行者接手 @a51415e，09:05 完成 @1d5405b）worktree 更新到 HEAD、重新 vite build（含 9669ec9）；冒烟逐项后台跑（/workspace/scratch/r3/run-smoke-035.sh，失败自动单独重跑一次，日志 docs/tasks/smoke-035f-*.log）：035 整段 / 跳过 / art=0 后备 / 010 / 015 art=1 / 033 ×2 / 1031 ×3 / 035 晚到 / 035 404
- [x] 6b batch16 制作人三件事（commit 808dde1）：a 建立镜头等待 → SMOKE_ESTAB_TIMEOUT_MS（默认 180 s，原 40 / 60 / 90 s 六处）；b 新增冒烟「v0.1-035 结尾曲晚到」（CDP Fetch 扣住 mus-ending-ch1.ogg → 点燃后放行 → result=late、offset = 起播 − 点燃、曲子 0 s = 点燃、演出时钟切换帧逐帧取证）；c 新增冒烟「v0.1-035 结尾曲下载失败」（CDP 404 → missing、不放音乐、无报错、后备时钟放完进结束页）。route404 预期 404 日志按 pattern 文件名生成
- 07:53 第一轮 035 整段挂住：box 上别的进程（pytorch）把内存吃满，OOM killer 杀了我们的 Chrome 渲染进程（dmesg 108209），CDP evaluate 永远不回。a20ce06：冒烟监听 Inspector.targetCrashed / Target.targetCrashed → 立刻失败退出、清临时目录。07:54 重新开跑全部冒烟
- [x] 6c 08:28–09:00 收尾冒烟：
  - 015 art=1（a51415e）：r2 第 1 次渲染进程被 OOM 杀（box 上同时有美术的 preview-chrome + blender + 别的 ASR 进程，free 177 MB）→ 第 2 次通过（smoke-035f-015art1-r2-retry.log）
  - 033menu 查因：冒烟加诊断（1d5405b：长任务 / rAF 断档 / 计时器迟到 + 同期请求）。低负载通过的那次也看到 S1 曲下载窗口里同时在下 S2 组 39 个文件 24.31 MB、主线程长任务 4 个共 15.3 s —— S1 建立镜头只有 3 s，preloadNext(S2) 几乎和首帧后的场景曲请求同时发出，抢连接 + GLB / KTX2 解析占主线程。真问题，7c1b8a2 修：下一场景预加载排到懒加载场景曲有结果（到了 / 404 / 45 s 超时）之后；010 等 s2 预加载上限相应改 LOAD_MS + 45 s
  - 修后 033menu 第 1 次（load 14）仍超时：同期其他请求 0 个（S2 组 95.2 s 才开始，确认排在后面了），但主线程单个长任务 28.2 s + 36.4 s（与 rAF 断档完全重合 = SwiftShader 软件渲染单帧），计时器本身迟到 64 s；下载 21.5→86.1 s 正好卡在长任务结束时（three FileLoader 在主线程按块读 body）。这是无头软件渲染 + box 负载的环境问题，真 GPU 上一帧是毫秒级；45 s 游戏超时不放宽。第 2 次（同一构建）通过：同期请求 0、下载 8.8 s、淡入 @28.1 s（smoke-035f-033menu-fix-retry.log）
  - 修后回归全过：033-404、010、1031 S2 / S3 两层 / 点燃（smoke-035f-*-fix.log）
- [x] 7 截图 docs/tasks/shots-035/（7 张，1600×900，art=1 high，r3 原件，@1d5405b）—— 画面问题见下
- [x] 8 worktree npm run check EXIT 0（r3-check-035f.log）；首次进入 S1 132.41 MB（≤ 132.5）、首场景包 126.98、menu 5.43、s3 25.81；懒加载 S1 2.41 / S2 2.46 / S3 6.43；配乐合计 12.99

## 截图画面问题（shots-035）
1. 01 雾口 / 02 剪影 / 07 后拉：灯束是硬边平面条带（无体积 / 末端衰减），07 从侧面看成两条横贯天空的平带；02 灯束末端有一个半透明圆盘（光束端帽 / 光晕片）很突兀
2. 04「那边没有亮。」：灯室玻璃上每块各有一个灯光反射亮斑（3 个，同一高度），中间那块正好压在远处第二座灯塔剪影上 —— 台词说「那边没有亮」，画面上那边却有一团亮光，会误读。需要关这个镜头的玻璃反射 / 挪开亮斑或改镜头角度
3. 03 父亲摸头：幽灵材质半透明没有深度预写，斗篷内层 / 手臂 / 背面互相透出来（自身叠加层次乱）；手按在汐头顶偏后，r3 头基本贴合，等 r4 复核
4. 04 / 06：灯室下半圈墙是一圈平的深蓝黑（几乎没受光），近景像空洞；04 画面底部一条纯黑
5. 05 写日志：汐右臂挡住日志本和笔，「写」的动作看不见；桌面木纹条纹很重像木箱；头顶被裁
6. 06：高脚凳像梯子，比例偏高
7. 07：塔身石材斑块对比太强，像迷彩
8. 汐头发外描边未加（按裁定 23 等 r4 后加 023 外壳描边）


commit 92a219a（1–4 步）、bd0ee91（冒烟改动 / 新增 035 三项）、190a2b8（截图脚本 shots-035）。

## 设计记录
- 演出时钟 src/systems/cutscene/CutsceneClock.ts：t = 结尾曲音频位置（AudioContext.currentTime − ignitedAt）；没有结尾曲 / context 没跑 → performance.now 增量（暂停不走、单步 ≤ 0.25 s）；单调不倒退；后备 → 音频切换时音频落后就停住等。
- 播放器 CutscenePlayer：cue 越过即按序触发、记 firedAt + 来源；106 s → 'end'；skip → 'skip'。镜头 = 分段 Shot（段间硬切），CameraFollowSystem 的 CameraTrack 加 clock 选项（时间取演出时钟）。
- 时间轴数据 src/content/cutscenes/ending.ts（= ENDING_CUES）；执行 src/levels/s3/ending.ts（S3Ending）。点燃那一帧 start（after-lit 预设在点燃闪光里切），0–4 s 仍是探索镜头 + 点灯独白，4 s 起演出镜头接管。
- 父亲：36 s（汐 gaze 第 2 循环第 0 帧）playHandOnHead，同帧；父亲时间 = 演出 t − 36（不按 dt）；幽灵材质克隆半透明 0.55，armDown 5.667 s 后淡出，42.6 s 隐藏。汐眺望站位比美术 lamp-room-stand-gaze 后退 0.2 m（父亲根在汐前 0.48 m，原位会穿矮墙）。
- 跳过：SkipController（UI 层，window 键盘监听，按住 Space 1 s，右下圆环 SkipHint）；演出注册 'ch1-ending'，结束页结尾曲在放时注册 'ch1-ending-page'（只淡掉结尾曲，留在结束页）；开场建立镜头借用已有 skipHold 只显示圆环。跳过 → cutscene:skip → 结尾曲 0.75 s 淡出 + 0.75 s 黑场 → completeChapter；终态（独白已看过、日志第 6 页）照样写。
- completeChapter 进结束页后若画面是黑场（演出淡出 / 跳过黑场）→ 淡入 TRANSITION.fadeIn；结束页 → 主菜单的菜单曲淡入不动。
- 冒烟发现并修：① 后备时钟单步上限 0.25 s 太紧（swiftshader 一帧 0.3–0.7 s → 演出比真实慢），改 1.0 s（c1fcbf4）；② 场景曲还在懒加载时点燃，场景曲到了会顶掉结尾曲 → LevelScene.sceneMusicAllowed()，S3 点燃后返回 false（随后提交）。
- 主仓库 npm test 里 test:father 现在失败：art/models/characters/char-xi.glb 07:02 被美术在制品（r4 头）覆盖，xiCrownRest 对不上 —— 与 035 无关，worktree（r3 原件）里跑。

