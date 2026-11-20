# QA v0.1 batch24 — M7 验收（69683cd..7f73706，16 commits）

- 快照：`/workspace/qa-tools/snap-7f73706`（06:18 UTC+7 建，game=`git archive 7f73706`，art 真拷贝，0 硬链接，2.9 G）
- 环境：headless Chrome（swiftshader），同时只一个 Chrome，空闲内存 ≥1.5 GB 才启动；Firefox/WebKit 用 /workspace/pw-tools 的 playwright
- 不判 fps、不判美术；新 bug 编号从 BUG-036 起；BUG-035（手机无提示）已知不重开
- 证据目录：`docs/bugs/qa-v0.1-batch24/`（perf / smoke / xb / hooks / review）

## 汇总

| # | 项 | 结果 | 备注 |
|---|---|---|---|
| 1a | BUG-032 回归 | ✅ 关单 | 035 组 5 项全过（06:37–06:41），结束页 @106.31 s |
| 1b | BUG-033 回归 | ✅ 关单 | Firefox art=1 xb 5 步过，刷新步无 Navigated away / 未处理 rejection；interrupted 分支见 §1 建议 |
| 1c | BUG-034 回归 | ✅ 关单 | WebKit 占位 / art=1 xb 都 0 console.error、无 INVALID_OPERATION；Firefox 也没了 shadow sampler 警告；M7 takeExit GL 断言过 |
| 2 | M7 新 smoke | ✅ | 06:26–06:35 一次过 2/2；覆盖缺口见 §2 |
| 3 | __qa 钩子 | ✅ | 5 个函数可用；生产正常 URL 无；代码仍在包里（运行时开关） |
| 4 | 兼容（FF/WK 重跑 + §7 清单） | ✅ | FF art=1 159 s、WK 24 s、WK art=1+reject 121 s 都 5 步过；§7 建议补项见 §4 |
| 5a | df32f7f 完整路径豁免 | ✅ | 单测 + 假文件实测，见 §5 |
| 5b | a5154a1 读不到 listenerErrors → 失败 | ✅ | nogame / nan / hang 三种注入都判失败 |
| 5c | ramp sRGB 结论 | ✅ | compat-report §3 写清楚了 |
| 6 | 009 雨量单跑 | ✅ | 06:35–06:37 单跑一次过 |
| 7 | check:release | ✅ | 06:18–06:25 一次过，见 §7 |
| 8 | 全量 smoke | ✅（有环境中断） | 35 ✓ + 2 ✗（011、021 重跑都过 = 抖动）；035 项时 VM 暂停致 Chrome 崩，未跑的 7 项补跑全过 |
| 9 | BUG-035 回归（追加，snap-4008aed） | ✅ 关单 | 主冒烟 dev/dist、xb Pixel 7 / iPhone 15 / iPad（dev+dist）出提示，桌面不拦；见 §9 |

## §1 bug 回归（静态部分）

- **BUG-032（8ae282f）**：smoke-browser 引 `ENDING_CUES`；035a `endAt = ENDING_CUES.silence`；同类硬编码 104 / 104.5 秒的 seek 改成 `silence-2` / `silence-1.5`，共 4 处（015、2801 行、035 兜底、035 404 循环）；`sceneAt.t >= ENDING_CUES.silence` 2 处。剩余字面量只在提示文字 / 注释里，外加 3380 行 `Math.abs(e.dur - 107) > 0.01`（结尾音乐文件时长检查，可改用 `ENDING_CUES.length`，低）。
- **BUG-033（3a8b4a3）**：`unlock()` 里 resume 被拒会被 catch，状态变成 running 才摘监听器；suspend / resume 都包了 `AudioSystem.quiet`；verify-audio 加了单测。观察（低 / 建议）：状态是 `'interrupted'`（Safari / WebKit）时 `unlock()` 走 `state !== 'suspended'` 分支，直接摘监听器、不调 resume —— Safari 真机上中断后可能没声音，要靠 visibilitychange 等别的路径恢复，建议确认。`dispose()` 里的 `void context.close()` 只在 dev/HMR 走（低）。
- **BUG-034（91c4b55）**：Reflections 加 `shadowLights`，反射 pass 里 `shadowMap.autoUpdate = prev && shadowLights.some(castShadow && map===null)`；LevelScene 只推 `sun`（唯一投影光）。smoke 只在 takeExit（S1→S2、S2→S3）断言 GL error（进场前 clear、ready 后读）；继续游戏 / 刷新进场、S3→章末、新游戏进场后没查（覆盖缺口，见程序待办）。

## §2 M7 smoke 覆盖审读（smoke-browser 3770–4123 行）

**完整通关**真实覆盖：菜单点击新游戏 → S1（P1 钟：事件 emit + 传送；读纸条；刷新 → 继续 → `__qa.diff` 比快照 + 存档 sceneId/readDocs）→ P2 → 出口 → S2（日记、提灯、镜子用按键；锁、地窖门；刷新 → 继续 → diff；钥匙、视角 317、拨盘 317 按键；出口）→ S3（钟 emit + `tides.fixedUpdate(7)` 快进；门；阀门；刷新 → diff；`beam.solve()`；拉杆真按 E；点灯；Space 跳过过场）→ 结束页 chapterComplete → 结束页刷新 → 继续 → 结束页 → 菜单 → 新游戏 → 覆盖确认 → S1 存档清空。
5 谜题 = S1 P1/P2、S2 镜锁 / 拨盘、S3 光束 / 点灯 ✅；S2 存 → 刷新 → 读 + 谜题快照比对 ✅（S1、S3 也做了）；结局 / 继续游戏 / 跳过过场 ✅。

**切画质**：`?debug=1&scene=s1|s2|s3&art=1` 直接进场，ultra → high → standard → ultra；每次切后 0.6 s 游戏时间读 `gl.getError` + `isContextLost`；黑屏判据 shotStats（mean<6 / lit<0.05 / colors<24 判失败）；实体普查：启用的交互物父链可见、出口数、Xi `rig.visual` 链、同一 scene 对象。

**脚本没覆盖的**：
- 木筏真推（直接 `position.set`，pushT=1）；S3 镜子真转（`beam.solve()` 捷径）；部分交互靠 emit 不靠按键；手感
- 完整看完结局（035 组覆盖）；结局中途刷新
- GL error 只在 takeExit 查；刷新 / 继续进场、章末、新游戏后不查
- 切画质：不是自然流程进场；没有 standard → high 方向；不查菜单里切画质；不查父亲 / 笔 / NPC 道具、出口触发体几何、切后反射 / 阴影状态；mesh 数只记日志不断言
- 提示系统、设置持久化、音频

## §2b M7 实跑（06:25:54–06:35:46 UTC+7，`SMOKE_ONLY='v0.1-M7' timeout 2400 npm run smoke`）

- ✅ 完整通关 + 存档读档：S1 刷新回入口偏 0.00 m、谜题复位；S2 刷新后 `__qa.puzzles()` 与进场存档一致（中途改 7 项全部回到存档值）；S3 刷新复位；真按 E 点燃 → Space 跳过 → 结束页（本章用时 1:07，chapterComplete）；结束页刷新 → 继续回结束页 → 新游戏覆盖确认清档。takeExit 两次 GL 错误断言为空（日志不单独打印，断言失败才抛错）
- ✅ 切画质：s1 / s2 / s3 ultra→high→standard→ultra 亮度 73.6–78 / 74.3–76 / 100.4–101.5，网格 324 / 497 / 200 全程不变，可交互物 9 / 25 / 5、出口 1 / 1 / 0 不变，无 GL 错误
- 说明：GL 断言在 Chrome swiftshader 上能否抓到 BUG-034 那类错误没做反向验证（没回退修复跑），BUG-034 的主要证据是 WebKit xb 无 console.error
- 日志：`qa-v0.1-batch24/smoke/q24-m7.log`

## §4 兼容（§7 真机清单审读）

compat-report 已通读。§7 Safari 9 项、Edge 7 项基本到位，建议补：
- Safari：①切后台 / 锁屏 / 来电后回来音频是否恢复（AudioContext `interrupted`，正好对应 §1 BUG-033 观察）；②刷新后控制台干净（BUG-033 的 Safari 版）；③无痕模式存档（localStorage 配额 / 抛错）；④< 15.4（无 structuredClone）是否有提示 —— 报告说目前无提示；⑤ITP 7 天清存储后"继续游戏"表现；⑥Retina / 缩放 / 窗口改尺寸；⑦全屏下 Esc / 指针锁；⑧音量 / 静音设置持久化
- Edge：①关硬件加速 → WebGL2 致命提示是否出来；②缩放 125% / 150%、多显示器拖窗口 DPI 变化；③刷新时音频（Firefox 类 resume 被拒路径）控制台干净；④"关闭时清除浏览数据"设置下存档行为；⑤增强安全模式下 WASM（basis 转码）已有，建议写明期望结果

## §5 观察复核

- **5a df32f7f** ✅：`ktx2-rules` 加 `artRelPath` + `rampMatcher(manifest)`，check-size / verify-assets 都按完整相对路径比；单测覆盖异目录 / 子目录同名、只有文件名、未标 ramp。**假文件实测**（临时拷贝 b24-assets，已删）：把 250×1 的 `tex-ramp-env.ktx2` 放到 `dist/assets/qa24/`、`dist/assets/art/models/`、`dist/assets/art/textures/sub/` → check-size 全部 ✗ 拒收（rc 1）；把清单里真 ramp 改成 250×1 → 仍豁免（rc 0）；`../art/models/`、`../art/textures/sub/` 同名 → verify-assets ✗（rc 1）；还原后都通过。小建议：verify-assets 报错只写文件名 `tex-ramp-env.ktx2 250×1`，没写目录，同名时不好找（低）。日志：`qa-v0.1-batch24/review/a24-*.log`
- **5b a5154a1**：最后读计数用 Promise.race 10 s 超时，`{err}`（无 __game / 非数字 / evaluate 失败 / 超时）→ "✗ 读不到 EventBus 监听器抛错计数" 并 failed++。实跑见下（注入 nogame / nan / hang 三种）。
- **5c ramp sRGB** ✅：compat-report §3 写清楚了：不是故意的（美术本意线性，DFD transfer=1），只有 tex-xi-ramp 被采样，改 NoColorSpace 明暗分界移约 1.1°，决定"不改，画面不变（方案 A）"，以后修法是清单加 `srgb:false` + 美术复核。

## §7 check:release（06:18:29–06:25:49 UTC+7，一次通过，EXIT 0）

- 体积：主菜单包 5.48 / 15 MB；首场景包 common+s1 126.72 / 150 MB；首次进 S1 总下载 132.20 / 150 MB（警戒线 140）；进场后懒加载音乐 s1 2.41 / s2 2.46 / s3 6.43 MB
- 压缩：71 GLB Meshopt、KTX2 全部生效；KTX2 82 张，非 4 倍数 4 张都是清单 ramp
- 预算：通过；已知警告 4 项（S1 standard 主 pass 2.20–2.56 M 面 > 1.5 M，已知，等 M8）
- 加载（本机回环不限速）：主菜单 954 ms（≤3000）；S1 首帧 3673 ms、资源全完 4217 ms，129.3 MB / 149 请求，失败 0
- 显存：S1 426.6 → S2 400.8 → S3 397.5 → 菜单 91.9（×0.215）→ 再进 S1 427.3（×1.002）
- 对象堆：S1 10.3 → 再进 S1 10.5 MB（+1.9%，在 ±10% 内）
- 与程序 compat-report §4.1 数字一致（加载时间有本机抖动：954/3673/4217 vs 1045/4197/4736）
- 日志：`qa-v0.1-batch24/perf/r24-release.log`、verify-*.json

## §6 009 单跑（06:35–06:37 UTC+7）✅
`SMOKE_ONLY='v0.1-009'`：SwiftShader 实测 → standard；simulateFps=40 ultra→high→standard（两轮）；降档提示、刷新不再检测、手动改回保存、恢复默认、运行时切档、F3 面板全 ✓。日志 `smoke/q24-009.log`

## §1a BUG-032 实跑（035 组，06:37–06:41 UTC+7）✅
035 五项全过：art=1 逐 cue 演出结束 @106.31 s → 结束页；跳过；后备时钟结束页 @106.14 s；结尾曲晚到；404 结束页 @106.92 s。日志 `smoke/q24-035.log`

## §5b a5154a1 实跑 ✅
smoke-browser 拷贝 `scripts/qa24-busread.mjs`（跑完已删）在收尾读计数前注入：
| 注入 | 结果 |
|---|---|
| nogame：删 window.__game | ✗ 读不到 EventBus 监听器抛错计数（no __game）→ 冒烟失败 1 项，EXIT 1 |
| nan：listenerErrors='x' | ✗ 读不到…（listenerErrors = x）→ EXIT 1 |
| hang：__game getter 忙等 20 s | ✗ 读不到…（timeout 10 s）→ EXIT 1 |
日志 `smoke/q24-bus*.log`

## §3 __qa 钩子实测（06:42–06:56 UTC+7，vite preview 生产构建 + vite dev）
- 生产构建正常 URL：`''`、`?debug=1`、`?autostart=1`、`?debug=1&scene=s2&art=0&autostart=1` 四种 → `__game`、`__perfSpot` 都是 undefined，`__qa` 上没有 puzzles 等函数。注意：QA 自己的 harness（qa-tools/common.mjs 的 addInit）也叫 `window.__qa`（sleep/until/el/ft/last/sample），第一次 typeof 结果被它污染，补跑 probe 看 keys 才确认游戏没装钩子 —— 不是游戏问题
- `?smoke=1`：`Object.keys(__qa)` = puzzles / save / saveData / scene / diff；菜单 puzzles()=null、save()=null、scene()={scene:'menu'}；S1 / S2 / S3（`debug=1&scene=sX&art=0`）puzzles() 返回各场景状态，diff(同一份)=[]，save() 和 saveData() 一致（sceneId s1/s2/s3）；S3 敲钟 + 快进 → diff = tide.state high→low、tide.level 1.6→0、bellRings 0→1；合成 diff 正确；坏存档 save()='unparsable'、无存档 null
- dev（vite dev，无 ?smoke）：`__qa`、`__game`、`__perfSpot` 都在，scene() 正常
- 观察（低，按设计）：钩子代码打进了生产包（index-*.js 里能搜到 `window.__qa={puzzles:`），任何人在线上加 `?smoke=1` 都能用 `__game` 改状态；单机游戏影响不大，正式发布前可考虑用构建开关剔除
- 日志：`hooks/t24-hooks*.json|log`、`hooks/t24-qaprobe.*`

## §4b Firefox / WebKit 重跑（playwright，PW_MODULE / PLAYWRIGHT_BROWSERS_PATH）
| 浏览器 | 参数 | 结果 |
|---|---|---|
| Firefox | XB_QUERY=art=1 | ✓ 5 步（菜单→新游戏→S1→S2→S3→刷新→继续）159 s，06:43–06:46；无 console.error；只有 KTX2 / 自动播放等 warning |
| WebKit | 占位 | ✓ 5 步 24 s，06:46；AudioContext 一直 interrupted（WPE 已知） |
| WebKit | art=1 XB_AUDIO_DECODE=reject | ✓ 5 步 121 s，06:46–06:48；无 INVALID_OPERATION |
截图：`xb/ff-art1`、`xb/wk`、`xb/wk-art1`

## §8 全量 smoke（`timeout 5400 npm run smoke`，06:57:09 起）
- 跑到第 35 个 ✓（到 v0.1-1031 配乐 S3 点燃 → 结尾曲），在 v0.1-035 结尾演出那一项 Chrome 进程消失，watchdog 90 s 后杀掉（EXIT 143，07:45 UTC+7）。dmesg：07:30 / 07:37 两次「virtual machine fork」+ virtio_balloon "Out of puff"（宿主暂停 / 内存回收，对应本会话被中断），07:43:27 chrome SIGABRT；没有 OOM killer 记录 → 记为环境中断，不是游戏问题
- 全量里 2 项 ✗：
  - v0.1-011 潮汐「退潮没结束」（level 1.21 仍 moving）。07:45 单跑重跑：Chrome 起不来 WebGL2（"不支持 WebGL 2" 致命页，紧接 07:43 chrome 崩溃，环境问题）→ 再排一次重跑
  - v0.1-021/022 替换入口「120 秒内 s1 没就绪」→ 07:46 单跑重跑 ✓ 通过 → 加载抖动
- 未跑到的 7 项（035 ×5、M7 ×2）排了一次「崩溃重跑」（单独 `SMOKE_ONLY='v0.1-035|v0.1-M7'`）；这 7 项本批已单独跑过各一次全过（§1a / §2b）
- 补跑结果：
  - v0.1-011 第二次重跑（08:06–08:08 UTC+7）✓：6 s 退潮到 level 0、墙撤、F4 ✓、涨潮送回 ✓ → 全量里那次失败判为负载抖动（swiftshader 帧慢），不开单
  - 崩溃重跑 `SMOKE_ONLY='v0.1-035|v0.1-M7'`（07:48–08:06）：035 ×5、M7 ×2 全过，冒烟测试通过 EXIT 0
- 合计：全量清单 44 项（含 dist / 主场景 / DRACO / KTX2 等基础项）在本批全部至少过一次；没有可复现的失败
- 日志：`smoke/q24-full.log`、`q24-full-tail.log`、`q24-rerun-*.log`、`q24-rerun2-v0.1-011.log`

## §9 BUG-035 回归（追加项，快照 snap-4008aed，07:57 建，真拷贝 0 硬链接 3.1 G；npm run build 通过）
eda3534 + 4008aed + 4ae9fcf；package.json 与 7f73706 相同。7f73706 结果不受影响（不同快照）。
| 运行 | 结果 |
|---|---|
| `SMOKE_DEV=1 SMOKE_ONLY='BUG-035'`（08:08） | ✓ 桌面无提示、触屏笔记本（触点 10 + ontouchstart）无提示、手机 393×852 出提示，文案 = 文本表，按钮隐藏，标题在，框 [37,408,357,530] 在视口内，字体 Foglight Serif |
| 同上用 dist（不加 DEV，08:09） | ✓ 同上 |
| xb chromium Pixel 7（XB_DEV=1 / dist） | ✓ / ✓ 提示框 [46,403,366,525] 视口 412×839，coarse true hover false anyFine false |
| xb webkit iPhone 15（XB_DEV=1 / dist） | ✓ / ✓ 框 [37,311,357,433] 视口 393×659 |
| xb webkit 桌面（XB_DEV=1 / dist） | ✓ / ✓ 不出提示，5 步走完（24 s / 23 s） |
| 加测 dist：webkit / chromium「iPad Pro 11」 | ✓ 都出提示（框 [257,591,577,713] 视口 834×1194），即 M3a 纯触屏 iPad 拦 |
| 加测 dist：Pixel 7 landscape / iPhone 15 landscape | ✓ 都出提示且在视口内（734×343 框 [207,166,527,288]；863×360 框 [272,174,592,296]） |
所有运行 0 console.error / pageerror。verify-input 14 项（含 BUG-035 9 种设备）通过。

**判定逻辑审读（desktopOnly.ts）**：顺序 ① any-pointer fine 且 any-hover hover → 放行；② pointer coarse 且无 hover → 拦；③ 移动系统 / Mobi UA + 触摸 且非（媒体可用且 any fine）→ 拦；其余放行。9 种单测覆盖桌面、触屏笔记本、Windows 平板模式主指针 coarse 但有触控板、iPad + 妙控、手机、iPadOS 桌面 UA 纯触屏、老浏览器 ×2、手机接鼠标，合理。iPad：纯触屏 → ② 拦（模拟已证实）；接触控板 / 鼠标 → ① 放行（需真机）；只接 Apple Pencil → any-pointer fine 但 any-hover 通常 none → ② 拦，合理。
观察（都低，不阻塞关单）：
1. 带悬停手写笔的设备（三星 S Pen 手机 / 平板、部分 Windows 平板笔）可能报 any-pointer fine + any-hover hover → ① 放行，能进菜单但实际玩不了；可接受，建议在 compat §7 加一行记录
2. 主冒烟「触屏笔记本」模拟里 headless Chrome 报 hover false、anyFine 不是 fine+hover，所以这一例其实走的是「其余放行」，没走规则 ①；规则 ① 只由单测和真机 M4a 覆盖
3. 只在加载时判定一次（文档已写明）

**compat-report §7 M1–M4b 与代码一致性**：M1 / M2 / M3a / M3b / M4a / M4b 的「命中规则 + 预期」与 isDesktopOnlyBlocked 一致；M3a 说的「MacIntel + 多点触控认成 iOS 作为 ③ 兜底」与 device.ts 一致；M4b「桌面 UA，③ 不起作用」正确。小出入（低，文档）：§7 写 ③ 只在「浏览器不支持 pointer 媒体查询时」，代码其实还覆盖「媒体可用但没有 fine 指针、主指针又不是 coarse」的情况（注释原文 "unavailable or inconclusive"），建议改一句。建议补：M5 Android 平板（纯触屏 / 接鼠标或 DeX）、M6 带 S Pen 的三星设备（见观察 1）、Firefox Android 一项（老版本 pointer 媒体查询曾不准）、手机接蓝牙鼠标（单测有，真机未列）。

## 结论
- 关单：BUG-032、BUG-033、BUG-034、BUG-035（各自 md 已写 QA 回归 + 已关闭）
- 新 bug：无（BUG-036 未使用）
- 程序待办（都低）：
  1. BUG-033：`unlock()` 遇 `'interrupted'` 直接撤监听不 resume，Safari 真机确认中断后能否恢复，必要时把 interrupted 也当 suspended 处理
  2. GL 错误断言扩到继续 / 刷新进场、S3→章末、新游戏进场后；切画质加 standard→high 方向
  3. smoke-browser 3380 行 `e.dur - 107` 改引用 ENDING_CUES.length
  4. verify-assets ramp 报错带上目录（现在只写文件名）
  5. `__qa` / `__game` 生产包里靠 `?smoke=1` 运行时开关，正式发布前考虑构建期剔除
  6. compat §7：③ 描述改准；补 Safari 后台/锁屏回来音频、无痕存档、<15.4 提示、ITP 清存储、Retina/缩放、全屏 Esc；Edge 关硬件加速提示、缩放/多显示器、刷新音频、关闭时清数据；手机补 Android 平板、S Pen、Firefox Android、手机接鼠标
  7. compat-report §5 标题还写着 BUG-035「待 QA 回归」，可更新
- 清理：qa24-busread.mjs、b24-assets 临时拷贝已删；/tmp/qa-chrome-* 已清；快照 snap-7f73706、snap-4008aed 保留
