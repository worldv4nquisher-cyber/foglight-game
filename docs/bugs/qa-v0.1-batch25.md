# QA v0.1 batch25 — 验收 4008aed..81cfd8f（HEAD 81cfd8f，6 commit）

快照：/workspace/qa-tools/snap-81cfd8f（09:29 UTC+7 创建；game = `git archive 81cfd8f`，node_modules 从 snap-4008aed `cp -a`，art 真拷贝 2.0 G，0 硬链接，共 2.1 G）。art 比 batch24 小，是上游删掉了源烘焙 .npy / s1.blend1，运行时资源未变。
证据目录：docs/bugs/qa-v0.1-batch25/{hooks,review,smoke,xb,perf}。新 bug 从 BUG-036 起。

## 汇总

| # | 项 | 结果 | 说明 |
|---|---|---|---|
| 1 | 生产包无钩子 / preview:smoke 有 / verify:prod-hooks 反例 / 临时目录清理 | ✅ | dist grep 0；prod `?smoke=1` 无钩子；preview:smoke 有；反例 rc=1；/tmp 无残留。`?debug=1&scene=` 仍可直进 S2 / S3（已知） |
| 2 | Safari interrupted（76ce5bd）+ verify-audio 43 项 | ✅ | 43/43；修前版本确实失败 |
| 3 | M7 / 035 / BUG-035 / 033 配乐 冒烟 | ✅（1 项抖动） | 9 项 8✓；「结尾曲下载失败」首跑 fade=1，空闲单独重跑 ✓ → 判抖动；GL ×4 + 新游戏 ×2 + 点灯→结束页 ✓；画质五步 ✓ |
| 4 | b4844d6 引用替换 | ✅ | |
| 5 | f8b96cc 同名 ramp 完整路径 | ✅ | 单测 + 假文件实测 |
| 6 | compat-report 审查 | ✅ | 1 条补充建议 |
| 7 | smoke:xb firefox / webkit | ✅ | firefox 5 步 32 s、webkit 5 步 45 s |
| 8 | check:release | ✅ | EXIT 0，09:29–09:37 UTC+7；verify:prod-hooks ✓ |
| 9 | v0.1.md 裁定 31 | ✅ | 已追加 |

---

## 1 钩子不进生产包（ff403ba + e3391f8）

### 1a 静态（09:31 UTC+7）
- 代码：main.ts / S1 / S2 / S3 / TestbedScene 的条件从 `DEV || ?smoke` 改成 `DEV || MODE === 'smoke'`，都是构建期常量。
- snap 里 `npm run build`（check:release 第一步）之后，dist 全部 .js / .html / .css grep：`__game` / `__qa` / `__perfSpot` / `__s1` / `__s2` / `__s3` / `__testbed` / `installQaHooks` / `perfSpot` **全为 0 个文件**。dist 里 .js 只在 static/（8 个文件）和 index.html。
- verify:prod-hooks 在 check:release 里：`✓ 生产构建不含调试 / QA 钩子：7 个文件…`。
- **记录（已知，下批删）**：生产包仍读 `?debug=1&scene=`（实测见 1c）。另外 `?smoke` 本身在生产包里仍有运行时作用（不是钩子，只记录）：
  - config/debug.ts 让 `?smoke` 默认关美术；
  - 帧率面板的详细模式（UIManager：draw call、面数、显存）；
  - `?hintScale=` 提示时间缩放（sceneHints）；
  - S3 `?father=` 预览（`debugEnabled || smoke`）。
  
  dist 里还剩 4 处 `has('smoke')`。建议和 `?debug` 一起删。

### 1b verify:prod-hooks 反例（scratch 拷贝，约 09:31 UTC+7；已删 scratch）
日志 hooks/prod-hooks-counter.log。
| 情况 | 结果 |
|---|---|
| A 干净 dist | ✓ rc=0 |
| B 往 static/index-*.js 末尾加 `;window.__qa={};` | ✗ rc=1，报出文件和上下文 |
| C 往 index.html 加 `<script>window.__perfSpot=1</script>` | ✗ rc=1 |
| D 还原 | ✓ rc=0 |
| E `vite build --mode smoke` 的测试构建，`DIST=dist-smoke` | ✗ rc=1，8 处（__qa / __game / __perfSpot / __testbed / __s1–3 / unparsable） |

检查确实会失败，check:release 里它排在 `&&` 链上，失败会中断。
注意：只扫 index.html 和 static/。目前 dist 里没有别处的 JS，所以没有遗漏；以后若在 assets/ 下放 JS（如解码器 worker），要一起扫。

### 1c 运行时（CDP，单 Chrome，09:37–09:40 UTC+7）
日志：hooks/t25-hooks.log、t25-hooks.json，截图 hooks/prod-*.png，页面报错 0。
判断依据是 `__qa.puzzles` 和键名，不是 `typeof __qa`：harness 会自己注入 `__qa`，键为 sleep / until / el / ft / last / sample。

**生产 dist（vite preview :5770）**

| URL | `__game` | `__qa.puzzles` | `__perfSpot` | `__s1–3` / `__testbed` | 画面 |
|---|---|---|---|---|---|
| （无参数） | 无 | 无 | 无 | 无 | 主菜单 |
| `?smoke=1` | 无 | 无 | 无 | 无 | 主菜单 |
| `?smoke=1&autostart=1` | 无 | 无 | 无 | 无 | 直接进 S1「落潮滩」HUD |
| `?smoke=1&debug=1&scene=s2&art=0&autostart=1` | 无 | 无 | 无 | 无 | 直接进 S2「守灯人小屋」 |
| `?debug=1&scene=s2&art=0&autostart=1` | 无 | 无 | 无 | 无 | **直接进 S2**（已知，下批删） |
| `?debug=1&scene=s3&art=0` | 无 | 无 | 无 | 无 | **直接进 S3「初望灯塔」**（已知，下批删） |

**`npm run preview:smoke`（PORT=5772）**
- 起服务时 1 s 建好 /tmp/foglight-smoke-dist-cYppZP。
  - `?smoke=1`：`__game` object，`__qa` 键为 puzzles / save / saveData / scene / diff，`__perfSpot` function，`__qa.scene()` 返回 menu。
  - `?smoke=1&debug=1&scene=s1&art=0&autostart=1`：另有 `__s1`，`__qa.scene()` 返回 s1-ebb-shore / explore。
- 对进程组发 SIGINT 后，该目录**已删除**。✓

**临时目录**：check:release 的 with-smoke-build 建的 /tmp/foglight-smoke-dist-0JCP8p 在结束后已删除（日志 `foglight-dirs-after:` 为空）。冒烟组和 xb 结束后的情况见第 3 / 7 项。

## 2 Safari interrupted（76ce5bd）— ✅

**审查 AudioSystem：**
- `tryResume()` 只在 running 或 closed 时撤监听；其余状态（suspended、interrupted）都去 resume。resume 被拒，或 resume 后仍不是 running，都会 `armUnlock()`。
- `statechange` 变成 interrupted，或变成「不是游戏自己 suspend 的」suspended 时重新挂监听；变成 running 或 closed 时撤掉。
- `pausedByGame`：暂停期间手势不擅自恢复，由 `resume()` 恢复，interrupted 状态也算。
- `unlockArmed` 防重复挂监听；dispose 撤 statechange。
- 逻辑和注释一致，未见问题。

**verify-audio：** `npm run test:audio` → `verify-audio ✓ 43 项`（review/verify-audio.log）。新增的那一项内部 7 步：
1. interrupted 时 resume 被拒，监听保留；
2. resolve 了但还是 interrupted，监听保留；
3. 成功后撤监听；
4. 运行中被系统打断，重新挂监听，手势恢复；
5. 游戏自己 suspend，不挂监听，由 resume() 恢复；
6. 暂停中被打断，手势不恢复，resume() 恢复；
7. resume() 被拒，挂监听等手势。

**修前确认（scratch，已删）：** 新 verify-audio 配 4008aed 的 AudioSystem.ts，结果 1 项失败（review/verify-audio-prefix.log）：
- 首个失败断言是「挂了 statechange」。
- 去掉这条结构性断言后，失败在第 ① 步「interrupted 时也调 resume」（0 !== 1）。
- 「修前失败」属实，并且是行为层面的失败。

真 Safari 切后台 / 锁屏：box 上无法验证，已在 compat-report §7 Safari 10。

## 3 GL 断言 / 切画质 / 捷径表（81cfd8f）

**代码审查**
- `glClear` / `glCheck` 提到函数开头共用。
- 刷新继续：`refreshContinue()` 内 `glCheck`，新页面新上下文，错误队列从加载开始累计。调用 S1 / S2 / S3 共 3 处，结束页另有 1 处行内检查，合计 **×4** ✓。
- 新游戏首次和覆盖确认：两处都是 click 前 `glClear`、进 S1 可操作后 `glCheck` ✓。
- S3 点灯：按 E 前 `glClear`，跳过 → 结束页可见后 `glCheck`，覆盖点灯 → 演出 → 跳过 → 结束页全程 ✓。
- 走出口 ×2 照旧。
- 切画质循环 `['ultra','high','standard','high','ultra']` ✓。

**冒烟**：`SMOKE_ONLY='v0.1-M7|v0.1-035|v0.1-BUG-035|v0.1-033 配乐'`，TMO 4200，09:40:20–10:02 UTC+7，单 Chrome，日志 smoke/q25-grp.log。共 9 项：8 ✓ 1 ✗。

| 项 | 结果 |
|---|---|
| v0.1-033 配乐 | ✓ |
| v0.1-035 结尾演出 art=1 | ✓ |
| v0.1-035 跳过 art=1 | ✓ |
| v0.1-035 后备时钟 art=0 | ✓ |
| v0.1-035 结尾曲晚到 art=1 | ✓ |
| v0.1-035 结尾曲下载失败 art=1 | ✗ `结束页 {"fade":1,"page6":true,"k":null}`，见下方重跑 |
| v0.1-M7 完整通关 + 存档读档 | ✓，输出含「GL 错误 0：新游戏进 S1 ×2、走出口 ×2、刷新继续 ×4（S1 / S2 / S3 / 结束页）、S3 点灯 → 结束页 ✓」 |
| v0.1-M7 切画质 | ✓ S1 / S2 / S3 各走极致 → 高 → 标准 → 高 → 极致，亮度不黑；网格 324 / 497 / 200 不变；可交互物 9 / 25 / 5、出口 1 / 1 / 0 不变 |
| v0.1-BUG-035 仅支持电脑提示 | ✓ |

- 冒烟结束后 /tmp/foglight-smoke-dist-mHfqXf 已删（`foglight-dirs-after:` 为空）。
- 失败项的判定是：进结束页后固定 `sleep(1000)` 墙钟，再读 `__game.ui.fade.opacity`，要求 ≤ 0.05。fade=1 表示 1 s 墙钟时结束页还没淡入。其余条件（page6、k=null、cue 全 fallback、只请求 1 次 404）都已通过。

**捷径覆盖表（qa-hooks.md）**：15 行，四层定义清楚。
- 和冒烟代码抽查一致：M7 用 `cdp.click` 点菜单；S3 跳过用合成 KeyboardEvent Space；拉杆用 setRaw E；光路用 beam.solve。
- 结论段如实写明「玩法主路径没有真实输入覆盖」，S3 转镜是缺口，与裁定 31 最后一条对应。✓

**重跑**：等别的 agent 在主仓库的全量 smoke 结束（机器空闲）后，单独跑「v0.1-035 结尾曲下载失败」，10:40:31–10:51 UTC+7，日志 smoke/q25-rerun404.log。
- 结果 ✓：结束页 @演出 106.93 s（endedBy end）、淡入后 fade 0.00、page6 true，除 404 网络日志外无报错。
- `foglight-dirs-after:` 为空。
- **判为抖动，不开 bug**。首跑时同组 8 项串行、box 负载高，固定 1 s 墙钟内淡入没走完。
- 给程序：建议把 `sleep(1000)` 改为 `untilW('__game.ui.fade.opacity <= 0.05', …)`。

## 4 b4844d6 引用替换 — ✅
smoke-browser 和 verify-audio 的替换逐处核对：

| 原值 | 现在 | 位置 |
|---|---|---|
| 107 | `ENDING_CUES.length` | 结尾曲时长、假 buffer、offset 过头 |
| 14 | `ENDING_CUES.fog_open` | 实时段过滤 |
| 15 | `fog_open + 1` | 等待 |
| 106 | `ENDING_CUES.silence` | 报错文字 |

- 含义正确：length = 文件时长，fog_open = 实时段终点，silence = 进结束页。smoke-browser 第 14 行 import 了 ENDING_CUES。
- verify-audio 里 `[14, 21.78, 50, 66, 88, 95, 106, 107]` 那条是有意钉死 cue 表，保留合理。

剩余写死的（不算 bug，只记录）：
- 后备时钟中段 `seek(19.5)`、`seek(45)` / `>= 47`、`seek(80)` / `>= 81`；
- 注释和 out 文字里的「106 s / 104 s」；
- mus-menu 的 106.667。

以后 cue 表若大改，seek 中点可能落到 cue 边界附近，建议也改成相对 cue 的值。

## 5 f8b96cc 同名 ramp 完整路径 — ✅

**审查：**
- check-size 和 verify-assets 的 `name` 改为绝对路径。
- `rampMatcher().twin()` 按文件名找清单里的 ramp。
- 判定顺序：不是 ramp 但有 twin → 专门的报错文字。
- 小注意：清单里若有两张同文件名的 ramp，twin 只报最后一张（Map 覆盖）。目前清单无此情况，不影响。

**单测：** `npm run test:assets` → 34 项通过（review/test-assets.log），含「…同名拒绝时报错带完整路径 + 清单 ramp 位置（batch25-5）」。

**假文件实测（scratch，已删）：** 把 tex-ramp-env.ktx2 的头改成 250×1（原 256×1），放到 art/models/ 和 dist/assets/art/models/：
- test:assets：`/workspace/qa-tools/scratch25-ramp/art/models/tex-ramp-env.ktx2 250×1：与清单 ramp「textures/tex-ramp-env.ktx2」同名但不在同一目录，不豁免…`
- size：`✗ /…/dist/assets/art/models/tex-ramp-env.ktx2 250×1：与清单 ramp「textures/tex-ramp-env.ktx2」同名…`，`KTX2 块对齐：83 张…1 张不合规`

两处都是完整绝对路径，且指出了清单 ramp 的位置。

## 6 compat-report 审查 — ✅（文档，不在 git）

**§5 / §6**
- §5 标题已改为「已关闭——batch24 QA 回归通过」。
- §6 表里 BUG-033 / 034 / 035 都写着「batch24 回归通过、已关闭」。✓

**规则 ③**
- 文字是：`p.mobileOs && p.hasTouch && !(p.mediaKnown && p.anyFine)`，进入条件为「媒体查询不可用 / 前两条都没命中」。
- 和 desktopOnly.ts 一致：① `mediaKnown && anyFine && anyHover` 放行；② `mediaKnown && primaryCoarse && !primaryHover` 拦；③ 同上。
- 小措辞：③ 也会在「有精确指针但不能悬停（anyFine 且 !anyHover）」时进入。这时因为 anyFine 为真照样放行，结论不变，不用改。

**§7 新条目**：逐条对照了代码依据，合理。
- Safari 11（私密）：`probeWritable` 在 SaveSystem 和 Settings 构造时真写一次。✓
- Safari 12（15.0–15.3）：`save()` 先 `safeSet` 写入，再在 `onSaved?.(structuredClone(data))` 抛错，所以「存档已写入、之后启动 `load()` 抛错」的推断和代码一致。✓
  - 补充：`structuredClone` 还出现在 `lastSave` getter 和 **levels/s3/ending.ts:107**（结尾演出类字段 `structuredClone(OVER_SHOULDER)`），S3 点灯也会炸。
  - 裁定 31 的 polyfill 需要全局、在模块求值前装上，才能覆盖这里。
- Safari 13（ITP）：存档和设置只在 localStorage。✓
- Safari 14（Retina）：像素比上限极致 2 / 高 1.5 / 标准 1、renderScale 标准 0.8、全局 2（`Game.ts:278`），和文字一致。✓
- Safari 15（Esc）：`ESC_DEDUPE_MS = 250`、`pointerlockchange` 补发 Esc。✓ 全仓库没有 `fullscreenchange`。✓
- Edge 8：`GPU: …` 在 SettingsPanel 悬停 title。✓「3 秒检测连降到标准」是推断，标了待真机。
- Edge 9：全仓库没有 `devicePixelRatio` 变化监听（只有 ResizeObserver）。✓
- Edge 10：解锁监听 `pointerdown / keydown / touchend`。✓
- Edge 11：同 Safari 13。✓
- 手机 M5a–M8b：判定和规则 ①② 一致；M6 / M8a「放行但无键盘提示」和代码一致（只看指针，不看键盘）。✓
- 「当前无提示」汇总表 9 行，和条目对应。✓

## 7 smoke:xb — ✅
- PW_MODULE=/workspace/pw-tools/…/playwright/index.mjs，PLAYWRIGHT_BROWSERS_PATH=/workspace/pw-browsers。
- 两个浏览器都通过 test-server 自建测试构建，结束后 `foglight-dirs-after:` 为空。

| 浏览器 | 时间（UTC+7） | 结果 | 渲染 |
|---|---|---|---|
| firefox 157 | 10:02:28–10:03:03 | `✓ firefox: 5 步通过（32s）` | llvmpipe |
| webkit | 10:03:07–10:03:53 | `✓ webkit: 5 步通过（45s）` | |

- firefox 只有已知警告：WEBGL_debug_renderer_info deprecated、AudioContext 自动播放、深度比较 filtering、KHR_parallel_shader_compile。
- 日志 xb/x25-ff.log、x25-wk.log，截图 xb/ff、xb/wk。

## 8 check:release — ✅（09:29:39–09:37:01 UTC+7，EXIT 0，没有和 QA Chrome 并跑）
日志 perf/check-release.log；json：perf/verify-{budget,load,memory}.json。

**步骤**
- build；
- verify:prod-hooks ✓（7 个文件）；
- size；
- with-smoke-build 建测试构建（1 s）后跑 budget / load / memory。

**关键数字**

| 项 | batch25 | batch24 |
|---|---|---|
| 主菜单包 | 5.48 / 15 MB | 5.48 |
| 首场景包 common+s1 | 126.72 / 150 MB | 126.72 |
| 首次进 S1 总下载 | 132.20 / 150 MB（警戒 140） | 132.20 |
| 懒加载配乐 S1 / S2 / S3 | 2.41 / 2.46 / 6.43 MB | |
| KTX2 | 82 张，非 4 倍数 4 张均为清单 ramp | |
| Meshopt + KTX2 | 71 个 GLB 生效 | |
| 主菜单出现 | 953 ms（≤ 3000），3.62 MB / 39 请求 | 954 |
| S1 首帧 | 3920 ms | 3673 |
| S1 资源全部完成 | 4453 ms，129.3 MB / 149 请求，失败 0 | 4217 |
| 显存 S1 / S2 / S3 / 菜单 / 再进 S1 | 427.2 / 400.8 / 397.5 / 91.9 / 426.6 MB | 426.6 / 400.8 / 397.5 / 91.9 / 427.3 |
| 菜单 / S1 | ×0.215（≤ 0.5） | |
| 再进 / S1 | ×0.999 | |
| 对象堆 S1 → 再进 S1 | 10.3 → 10.4 MB（±10% 内） | 10.3 → 10.5 |

- budget 只有已知警告：S1 标准档 4 个机位主 pass 2.20–2.56 M 面，超 1.5 M 目标但 ≤ 上限，日志里每个机位各列 2 行，共 8 行 ⚠。
- 加载时间是本机回环、box 有负载时测的，只做记录。不判 fps。

## 9 v0.1.md 裁定 31 — ✅
已追加到 docs/releases/v0.1.md 末尾（第 31 条，09:34 UTC+7）。内容：
- 已做 / 待做 / 要做 / 不做 / S3 转镜五项；
- 其余各条一字未动。

## 新 bug
无（BUG-036 未使用）。

## 给程序的事（都不是 bug）
1. 下批删 `?debug=1` / `scene=` 时，顺带处理生产包里剩下的 4 处 `has('smoke')`：
   - 默认关美术；
   - 帧率面板详细模式；
   - `?hintScale`；
   - S3 `?father=` 预览。
2. structuredClone polyfill 必须全局、在模块求值前装好。除了 SaveSystem，还有 `levels/s3/ending.ts:107` 的类字段要覆盖。
3. smoke「结尾曲下载失败」里的固定 `sleep(1000)` 改成轮询 fade。
4. 可选：
   - check-prod-hooks 以后若 assets/ 下出现 JS，要一起扫；
   - smoke 后备时钟中段的 `seek(19.5 / 45 / 80)` 改成相对 cue 的值；
   - rampMatcher.twin 遇到同名 ramp 只报最后一张。

## 清理（10:52 UTC+7）
- /tmp/qa-chrome-*、/tmp/foglight-smoke-dist-*（我建的）、/tmp/playwright*、/tmp/m7-xb-* 均无残留。
- 别的 agent 的 /tmp/foglight-smoke-dist-zSQJhl 是主仓库 smoke 建的，没有动，现在也已不在。
- scratch25-audio / scratch25-ramp 已删；补丁队列副本 runc25w.sh 已删。
- snap-81cfd8f 和 snap-4008aed 保留。
