# QA v0.1 batch17 — 035 结尾演出（含父亲回忆段），8ccd2b0..1d5405b

- 构建：r3 worktree /workspace/scratch/r3/game（git 1d5405b，dist 09:02 构建，晚于 HEAD 提交 08:57，art = r3 冻结，不含 Xi 头发 r4）。快照 qa-tools/snap-1d5405b：game/ 来自 `git archive 1d5405b`，dist 用 `cp -al` 从 r3 拷来，src/ 和 scripts/ 与 r3 完全一致。
- 方法：headless Chrome（SwiftShader），一次只跑一项；冒烟用 SMOKE_ESTAB_TIMEOUT_MS / SMOKE_LOAD_TIMEOUT_MS=600000；不做 fps 判断。
- 已知且已分配、不另报：「那边没有亮」镜头里灯塔上的玻璃反光；父亲幽灵材质能看到内层；镜头 02 结尾光束和圆盘边缘生硬；灯室下半墙偏暗；镜头 05 手臂挡住日志 / 头被裁；凳子太高；塔身石材像迷彩。

## 汇总（batch17，1d5405b r3 dist，2026-10-31）

| 项 | 结果 | 要点 |
|---|---|---|
| ① 完整结尾演出 | PASS | 全程音频时钟（与曲位差 ≤ 0.011 s，无倒退）；结束页在曲子结束后（墙钟 107.2 / 109.8 s），不是点灯 4 s 后；cue 顺序全对，晚到量 = 跨目标那一帧的帧长；冒烟 father_out +2.34 s 来自一次 2.9 s 单帧，复测没复现 |
| ② 跳过 | PASS | 短按（0.15 / 0.2 / 0.45 s，含 1.2 s 卡顿）都不跳过；按住 1 s 跳过，stop fade 0.75，1.56–1.84 s 后进结束页；开场建立镜头同样可以跳过；冒烟首跑 FAIL（负载时序），重跑 PASS；演出中的圆环画面截图因负载没拍到（菜单上已截图确认） |
| ③ 父亲回忆 | PASS | 约 36 s 出现（hand）、opacity 0.55、42.6 s 后隐藏；手和头发最小间隙 −2.9 mm（贴住），没有可见缝隙；只测了 38.4 s 一个时刻 |
| ④ 后备路径 | PASS | art=0 后备 PASS；404 PASS；晚到冒烟 FAIL（10.7 ms 时钟抖动，断言 1e-6），自测 PASS（offset 正确、无倒退） |
| ⑤ 结束页 → 主菜单 | FAIL（P3） | 无报错，但 mus-menu fade:0 直接满音量起播 → BUG-025；另有 3/9 次 boot 时 menu 组可选资源间歇缺失（未定因，记在 BUG-025 附注） |
| ⑥ 9669ec9 / 7c1b8a2 | PASS | 迟到场景曲 stale、不顶掉结尾曲；S1 曲下载期间 0 个同期请求，S2 预加载照常，010 PASS |
| ⑦ check + 体积 | PASS | 首次 S1 132.41 MB（内部警告 140 / 硬上限 150） |

新 bug：BUG-025（P3）结束页 → 主菜单菜单曲没淡入。


## ⑦ npm run check + 包体 — PASS
- check17.sh（09:04–09:05，快照里跑）：typecheck / lint / test（含 test:cutscene verify-cutscene）/ size / css 全部 EXIT 0。build 这一步用 r3 已构建好的 dist 代替：dist 09:02 构建，晚于 HEAD 1d5405b 的提交时间 08:57，静态 JS 里能找到 ch1-ending。日志：qa-v0.1-batch17/b17-check.log。
- 包体：**首次进入 S1 总下载 132.41 MB**（≤ 内部警戒线 140，≤ 硬上限 150）。menu 5.43/15；common+s1 126.98；s3 25.81（比 8ccd2b0 多 0.09，多了 1 个文件）；懒加载 S1 2.41 / S2 2.46 / S3 6.43 MB。
- 注：140 MB 警戒线只写在 docs/releases/v0.1.md 第 61 条（制作人 10-31 裁定），check-size.mjs 里没有 140 的检查，只检查 150。

## ① 完整结尾演出（?art=1&scene=s3，点灯）— PASS

- 冒烟 `v0.1-035 结尾演出 art=1`（logs/q17-e1.log）EXIT 0 PASS；自测 t17-end.mjs（qa-v0.1-batch17/ending/t17-end.json，逐帧记录 42 帧）同样完整走完。
- 时钟跟曲：两轮所有 cue `source=audio`；自测每帧 |演出 t − 结尾曲播放位置| ≤ 0.011 s；全程 t 单调不减（无倒退）。曲子在点灯后 25.39 s（ctx 时间）开播，`end` 于 132.39 s（时长 107.0 s）。
- 结束页：冒烟点灯后墙钟 107.2 s 进 chapter-end（曲尾后 0.53 s）；自测 109.8 s（最后一帧 t=105.66→106.66 时换 chapter-end，endedBy=end）。不是点灯 4 s 后。
- cue 表（目标 → 实际触发 t，括号内为前一帧 t；软渲染下只会晚、不会早，顺序全对）：

| cue | 设计 | 冒烟 e1（帧均 0.72 s） | 自测（帧均 2.5 s） |
|---|---|---|---|
| lens | 4 | 4.44 (3.35) | 12.23 (3.94；点灯后首两帧 4 s + 8.3 s 着色器编译) |
| fog_open | 14 | 14.11 (13.69) | 15.09 |
| silhouette | 24 | 24.32 (23.82) | 24.33 (23.01) |
| gaze | 30 | 30.45 (29.95) | 30.20 |
| father_in | 36 | 36.48 (35.76) | 36.69 (32.73) |
| father_out | 42.6 | **44.94 (42.03)** | 45.11 (42.36) |
| no_answer | 50 | 50.77 (49.95) | 53.25 (49.39) |
| sit_write | 58 | 58.08 (57.41) | 60.64 (57.97) |
| journal | 66 | 66.71 (65.74) | 67.30 (64.09) |
| pull_back | 74 | 74.43 (73.61) | 75.89 (72.07) |
| fade_out | 95 | 95.47 (94.83) | 98.82 (94.98) |
| end 页 | 106 | 106.53 (105.98) | 106.66 (105.66) |

- 所有偏差都 = 跨过目标时刻那一帧的帧长，不是逻辑错。唯一需留意：冒烟里 father_out 晚 2.34 s，来自 42.03→44.94 一帧 2.9 s（该轮平均 0.72 s）——疑似父亲退场 / regaze 处有一次卡顿；自测轮全程帧长 2–4 s，无法区分。见 ③ 中的定点复测。

## ② 跳过 — PASS（自测）；冒烟 `v0.1-035 跳过 art=1` FAIL（负载下的断言时序问题，非游戏 bug，见下）

自测 t17-skip.mjs / t17-tap.mjs（真实 CDP 键盘事件，qa-v0.1-batch17/skip/）：
- 结尾演出 t≈12–16 s 短按 Space 0.15 s ×3：未跳过（endedBy=null，skip.log 空），提示出现在右下（960×540 下 812,492 120×22 → 右 28 px、下 26 px）。另一轮：按住 0.45 s、短按 0.15 s、短按 0.2 s 且按下后主线程插 1.2 s 卡顿——三次都没跳过 ✓。
- 按住约 1 s：圆环进度 0.15→0.31→0.47 随按住时间增长（stroke-dashoffset 56.55→35.17）→ endedBy=skip，skip.log `ch1-ending`。
- 跳过后：musicLog `stop mus-ending-ch1 fade 0.75` ✓；跳过后 1.84 s（墙钟）进 chapter-end（设计 0.75 淡出 + 0.75 黑场 = 1.5 s，差值 = 帧长）✓；结束页从黑场淡入，无报错。逐帧 fade 曲线因跳过后演出不再 update、这轮帧长 ~1–2 s，没采到，0.75/0.75 两段长度只按总时长核对。
- 开场（新游戏 ?autostart=1 → S1 建立镜头 `establishing`）：短按 0.15 s ×2 不跳过；按住 → 跳到 `s1-establishing-hold`（013 裁定：画质检测第 1 轮没测完时跳过后接 3 s 不可跳过的建立镜头）✓。按住期间圆环进度读数一直 0（建立镜头圆环借 input.getHoldProgress，这轮一帧 ~10 s，未等到下一帧）——无法验证，非结论。
- 圆环画面：主菜单上强制显示同一组件，截图确认圆环 + 「按住 空格 跳过」画在右下（skip/hint-menu.png）。演出中截图没拍到：DOM 显示可见，但这轮一帧 2–16 s，captureScreenshot 等到下一帧时提示的 3 s 已过期自动隐藏。演出画面里的圆环**未能截图验证**（负载所致）。
- 冒烟 FAIL 原因：断言「按住期间圆环显示过」靠钩 skipHint.update 记录；UIManager 每帧先 `skip.update`（满 1 s 即触发并清目标）再 `skipHint.update`。负载下帧长 >1 s 时，按下后第一帧就已满 1 s → 跳过先发生，提示那一帧已不可见，钩子从没记到。属于冒烟在慢帧下的时序问题。其他断言没跑到（它在这一步就抛了）。正在重跑一次，结果见末尾。

## ③ 父亲回忆 — PASS

- 出现：自测 t17-end 父亲 root 在 t=36.69（前一帧 32.73）首次可见；t17-father 首帧 38.40（前一帧 34.82），mode=hand。消失：father_out 后首帧 45.11 不可见（前一帧 42.36 仍可见）；冒烟 father_in 36.48 可见、fT 0.48。
- 半透明：克隆材质全部 transparent、opacity=0.55（FATHER_GHOST_OPACITY）。内层透出属于已知问题，不报。
- 手–头发间隙（t=38.40，父亲时间 2.40 s，t15 顶点法：以汐头心为原点按 2° 分桶取头发外表面）：手部 1116 顶点里 812 个在头发上方；最小间隙 −2.9 mm（贴住，最深压进 2.9 mm），73 个顶点离头发表面 <5 mm，>10 mm 压入 0 个。**没有可见缝隙**。截图 qa-v0.1-batch17/father/father-t38.4.png 也是手指贴在头顶发面上，看不到空隙。
- 只采到 1 个时刻：用 `__game.freeze()` 冻结测量时结尾曲照样走，解冻后演出时钟直接跳到 74.7 s（按设计跟曲），后面 3 个点落在父亲段之外。38.4 s 处于摸头保持段，判定有效；入手 / 抬手过程**没测**。
- father_out 卡顿复测：这轮帧长普遍 2–4 s，跨 42.6 那帧 2.75 s，不比别处长，没复现冒烟 e1 里那次 2.9 s 单帧。不报 bug。

## ⑤ 结束页 → 主菜单 — FAIL（无报错，但菜单曲没有淡入）→ BUG-025

- t17-skip（跳过进结束页）：点 `.chapter-end [data-act="to-menu"]` → menu，musicKey=mus-menu；musicLog `play mus-menu from:null fade:0`，回菜单后约 0.2 s 曲目 gain 已经是满值 1.035，3 s 内不变。直接满音量起播，没淡入。page.errors 空。
- t17-end（完整放完进结束页）：结尾曲在结束页出现约 1 s 后 `end`；点「回到主菜单」后 musicKey=null，那一局 mus-menu 从 boot 起就是 missing（见 BUG-025 附注里的间歇现象），没有菜单曲；无报错。
- 对照：从 S3 场景（场景曲在放）toMenu → mus-menu 正常 2 s 交叉淡化（t17-menu3）。

## ④ 后备路径 — PASS（冒烟「晚到」一次 FAIL 为 10.7 ms 时钟抖动 + 断言容差 1e-6，自测复核通过）

- `v0.1-035 后备时钟 art=0` PASS：20 帧全部 fallback，实时段 lens 4→4.45、fog_open 14→14.48；seek 后 11 个 cue 按顺序（都是 fallback）；结束页在演出 106.00 s（logs/q17-fb.log）。
- `v0.1-035 结尾曲下载失败 art=1` PASS：404 ×1 → result=missing、musicKey=null、无报错；27 帧 fallback / 0 帧 audio；11 个 cue 都是 fallback；结束页在 106.50 s（endedBy end），日志第 6 页 true（logs/q17-404.log）。
- `v0.1-035 结尾曲晚到 art=1` FAIL：`offset 14.35733 ≠ 起播 14.45333 − 点燃 0.08533`（差 0.01067 s = 48 kHz 下 512 采样）。代码里 offset 先用 `audio.audioTime − ignitedAt` 算，playMusic 里再读一次 `ctx.currentTime` 作 now；负载下两次读数之间 AudioContext 时钟走了 512 采样。实际影响：曲子 0 s 比点燃时刻晚 10.7 ms，听不出来。断言容差 1e-6 太严，也可以让 start() 用同一次读数。不开 bug，交程序看要不要收紧代码或放宽断言。
- 自测 t17-lateend.mjs（CDP Fetch 扣住 mus-ending-ch1，点燃后 t≈6 放行）PASS：扣住期间 10 帧 fallback（单帧步长封顶 1.0）→ 放行后 result=late，`offset 6.4853 = 起播 19.0293 − 点燃 12.5440`（这次分毫不差），startAt = ignitedAt，fade 0.5；切换那帧 6.447(f)→6.741(a)，之后每帧 t = 曲子位置；21 帧 t 没有一次倒退；无报错。

## ⑥ 两个提交 — PASS

- 9669ec9（点燃后迟到的场景曲不能顶掉结尾曲）自测 t17-latescene.mjs：CDP 扣住 mus-s3-lighthouse + upper（2 个请求），点燃，结尾曲放到 t=6.6（source=audio）后放行 → musicLazyResult=stale / upper=stale，musicLog 只有 `play mus-ending-ch1`，场景曲没起播；musicKey 一直是 mus-ending-ch1，15 帧都走 audio 时钟，没有倒退，无报错。
- 7c1b8a2（下一场景后台预加载排到懒加载场景曲有结果之后）：
  - `v0.1-033 配乐` PASS：S1 首帧后立即请求 S1 曲（+0 ms），下载期间同期其他请求 0 个 / 0.00 MB，下载完 → mus-menu → mus-s1-ebb-shore 2 s 交叉淡化，S1 曲照常加载。
  - `v0.1-033 懒加载失败` PASS（S1 曲 404 → 菜单曲 2 s 淡出、不放音乐、不报错）。
  - `v0.1-010 场景流程` PASS：「预加载 s2 ✓」，S1→S2 2708 ms（全黑 1714 ms），S2→S3 慢加载显示进度线，S1→S2 切换没有回归。
- 补充：`v0.1-035 跳过 art=1` 重跑 PASS：22.73 s 按下 → 2.20 s 后跳过 → stop fade 0.75 → 1.56 s 后进结束页，fade 0.00，第 6 页 true。说明 ② 的首次 FAIL 是负载下的时序问题。
