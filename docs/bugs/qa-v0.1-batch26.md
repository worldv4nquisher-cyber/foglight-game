# QA v0.1 batch26 — 验收 81cfd8f..32455f3（HEAD 32455f3，15 commit）

**快照**：/workspace/qa-tools/snap-32455f3，11:30 UTC+7 创建。
- game 来自 `git archive 32455f3`。
- node_modules 从 snap-81cfd8f `cp -a`（package-lock 没变）。
- art 是 /workspace/game-studio/art 的真拷贝；audio、docs 为软链。
- 0 硬链接，共 2.1 G。

**证据**：docs/bugs/qa-v0.1-batch26/{perf,smoke,xb,hooks,review,shots}。
- 新 bug 从 BUG-037 起。
- snap-4008aed 暂不删，等清理确认。

## 汇总

| # | 项 | 结果 | 说明 |
|---|---|---|---|
| 1 | structuredClone 全局 polyfill | ✓ | 内联脚本先于全部 module（含 three / vendor）；有原生不覆盖；除 clone.ts 外没有直接调用；冒烟 ② ✓；test:save 22 项 ✓ |
| 2 | fullscreenchange | ✓ | 真实 Esc（CDP）退出全屏后：按钮状态同步、画布重设、游玩中补暂停 1 次；冒烟 ④ ✓（含 webkit 前缀）。Safari 真机没验证 |
| 3 | DPR 监听 | ✓（代码 + 冒烟） | 每次都重新注册 ✓；冒烟 ⑥ 靠补派发 change 通过；真实通知要真机测（§7 Safari 14、Edge 9） |
| 4 | 软件渲染提示 + BUG-036 字体 | ✓ | 提示在主菜单左下角，文案与文本表一致，点击能穿透，进 S1 后隐藏，有截图；所有字形都由子集渲染；zh-CN.ts 全部字符都在子集里；BUG-036 已关单 |
| 5 | 生产包剔除 debug / scene / smoke / autostart 参数 | ✓ | 32455f3：各参数在生产包里都无效，dist grep 干净，反例 11/11 能报错；a9865b0：`?autostart` 已剔除，回归 ✓（§5b） |
| 6 | S3 镜子真实键鼠冒烟 | ✓ | 冒烟通过；覆盖缺口见 §6 和「给程序」 |
| 7 | 追加 3a7ae0d / bf90eb8 / e13e787 | ✓ | fade 轮询用时 3369 ms；seek 19.5 / 45 / 80 改成相对 cue；同名 ramp 报错时全部列出 |
| 8 | 受影响冒烟 + M7 / smoke:xb / check:release | ✓ | 冒烟组前两轮都被别的项目挤爆内存（OOM，环境原因），空闲时重跑 9/9 ✓（§8c）；M7 两项都 ✓；xb ff / wk ✓；check:release 43 ✓ 0 ✗ |
| 9 | v0.1.md 裁定 31 补充 | ✓ | 已补 ?autostart 剔除和 BUG-036 结果 |

---

## 注意事项（本批起）

- **从 a9865b0 起，生产 dist 不认 `?autostart`**，打开后会停在主菜单（11:32 程序通知）。
  - qa-tools 里直接开生产 dist、带 `autostart` 的脚本以后都会停在主菜单。
  - 这类脚本改用 `npm run preview:smoke`（测试构建）或 `vite build --mode smoke`。
  - 本批其他项仍用 snap-32455f3（不含 a9865b0）。a9865b0 最后单独建 snap-a9865b0 回归（见 §5b）。
- qa-tools/common.mjs 自己会注入 `window.__qa`（sleep / until…）。查钩子要看 `__qa.puzzles`，不能只看 `typeof __qa`。

## 1 structuredClone 全局 polyfill（10549e8 / d45f82b / 32455f3）

静态部分 11:31–11:33 UTC+7 完成，冒烟见 §8。

**执行顺序**：看的是 check:release 构建出来的 dist/index.html。
- 第 21 行是普通内联脚本 `<script id="polyfill-structured-clone">`。
- 第 61 行才是入口 `type="module"`（static/index-*.js）。
- 第 62–63 行是 three / vendor 的 `modulepreload`。
- 普通脚本在解析时同步执行；module 和 modulepreload 拉到的分包要到解析完才求值。所以 polyfill 先于所有模块，含 three / vendor 分包 ✓。
- three-*.js / vendor-*.js 里本来就没有 `structuredClone` 字样（只有入口 index-*.js 有 3 处，都是 deepClone / 模块兜底）。

**有原生不覆盖**：
- 内联脚本第一句是 `if (typeof g.structuredClone === 'function') return;`。
- 模块兜底版 `installStructuredClonePolyfill` 同样先判断。
- 生产 preview 里 `structuredClone` 仍是 `[native code]`，实测见 §4 / hooks。

**全仓 grep**（src + scripts）：
- 只有以下文件出现 `structuredClone`：clone.ts、polyfills.ts、main.ts（注释）、scripts/verify-save.mjs、scripts/smoke-browser.mjs（测试本身）。
- 业务代码里，除 clone.ts（`deepClone`）和 polyfill 外没有直接调用 ✓。

**test:save**：22 项全 ✓，rc 0，日志 review/test-save.log。其中 batch26 ② 4 项：
- 无原生时存读档正常；
- 降级拷贝结果与原生一致；
- 全局 polyfill 不覆盖原生；
- 内联脚本在 vm 里装上。

**审查备注**：
- 冒烟 batch26-② 用 CDP `addScriptToEvaluateOnNewDocument` 删掉全局。它早于页面任何脚本执行，等同 Safari 15.0–15.3 的环境 ✓。
- 内联版和 cloneFallback 是两份手抄实现，test:save 比对两者一致。以后改其中一份要两边同步（给程序：建议注释里互相指一下；当前 32455f3 的 index.html 注释已写「同口径」）。

## 3 DPR 监听（58f3c25 / 6b4a92e）—— 读代码

**每次重新注册 ✓**：
- `onChange` 先 `arm()`，再回调。
- `arm()` 先 `off()` 摘掉旧查询的监听，再按当前 `devicePixelRatio` 新建 `(resolution: Ndppx)` 并挂监听。
- 老 Safari 用 `addListener` / `removeListener`。dispose 后 `disposed` 挡掉迟到的事件。
- Game.ts:130 的回调只做 `dprChanges++`、`pendingResize = true`，下一帧渲染前重设，和 ResizeObserver 同一条路径。

**冒烟 batch26-⑥ 是补派发 change**：
- 无头 Chrome 的 `Emulation.setDeviceMetricsOverride` 会改 DPR 和 resolution 查询结果，但不通知 MQL 的 change 监听。
- 所以冒烟先用只记录的 matchMedia 包装，等 2 s，没收到原生通知就在游戏注册的那个查询上 `dispatchEvent(change)`。
- 后面的重新注册（断言 ≥ 3 次）、重设画布、重建后处理 RT 都走真实代码。
- **真实的浏览器通知没有在本机验证**：需真机，compat-report §7 Safari 14、Edge 9（§7 汇总表 ⑥ 行已写）。
- 冒烟结果见 §8。

## 7 追加项

**e13e787 同名 ramp 全列 ✓**：
- test:assets 34 项 ✓（rc 0，review/test-assets.log），含「同名 ramp 多张时全部列出」用例。
- 自己另写了一个修前修后对比（review/twin-check.txt）：清单里有两张同名 `tex-ramp-env.ktx2`（textures/env/ 和 textures/），检查 `models/s1/tex-ramp-env.ktx2` 250×1。
  - 修前（e13e787^）只报「textures/tex-ramp-env.ktx2」一张；
  - 修后报「textures/env/…」「textures/…」（共 2 张）；
  - 只有一张时不加张数 ✓。

**bf90eb8 seek 相对 cue ✓（代码）**：
- `ENDING_CUES` 当前值：silhouette 24、no_answer 50、pull_back 74。
- 所以 SEEK_SKIP = 19.5、SEEK_MID = [45, 80]，和原来写死的值一致。
- until 门槛相应变为 20 / 47 / 81 s，和原来相同。
- 实跑见 §8 的 035 组。

**3a7ae0d 轮询 fade**：
- 代码：固定 `sleep(1000)` 改成轮询 `fade.opacity ≤ 0.05`，上限 15 s，报告里记轮询用时 ✓。
- 实跑见 §8（「035 结尾曲下载失败」）。

## 8a check:release（snap-32455f3，11:30:28–11:38:32 UTC+7）

- 一次通过，EXIT 0：43 项 ✓，0 项 ✗。
- 期间没开 QA Chrome（队列等 GATEDONE 后才起）。`foglight-dirs-after` 为空。
- 日志：qa-tools/logs/r26-release.log；产物：batch26/perf/verify-*.json。
- **verify:prod-hooks** ✓：7 个文件（index.html + static 6 个 + assets/**/*.js 0 个）。断言新增「读 ?smoke / ?hintScale / ?father= 参数」。
- **体积**：
  - 主菜单包 5.48 MB；
  - 首场景包 126.72 MB；
  - 首次进入 S1 总下载 132.20 MB（警戒线 140 / 上限 150）；
  - 与 batch25 相同。
- **加载**：
  - 主菜单 905 ms；
  - S1 首帧 3628 ms；
  - 资源全部完成 4120 ms；
  - batch25 为 953 / 3920 / 4453 ms，本机回环，波动范围内。
- **显存**：
  - 进 S1 426.6 MB；
  - 切 S2 400.8 MB；
  - 切 S3 397.5 MB；
  - 回主菜单 91.9 MB；
  - 再进 S1 426.6 MB。
  - 回菜单 / 进 S1 = ×0.215，再进 / 首进 = ×1.000（batch25 为 ×0.999，首进 427.2）。
- **对象堆**：10.3 → 10.4 MB（与 batch25 相同）。
- 不判 fps。

## 2 fullscreenchange（36c0090）

**代码审查**：
- `onFullscreenChange` 同时挂 `fullscreenchange` 和 `webkitfullscreenchange`。`isFullscreen()` 认 `fullscreenElement ?? webkitFullscreenElement`。按状态去重，两个事件都到也只回调一次。
- Game 收到后记 `fullscreen`，`pendingResize = true`（下一帧渲染前重设），发 `viewport:fullscreen`。
- 设置面板开着时立刻 `refresh()`，同步按钮的 `.on` 和 `aria-pressed`；打开设置时 refresh 也会同步。
- 输入：只在退出全屏、未锁指针、`cursorMode === 'locked'`（游玩中）时补一次 Esc。250 ms 内有真 Esc 或已补过就跳过。锁指针的情况交给 pointerlockchange 补。✓

**真实键 + CDP 实测**（t26-hooks.mjs B 段，preview:smoke 5772，S1 explore，11:41–11:42 UTC+7，hooks/t26-hooks.json）：

| 步骤 | 结果 |
|---|---|
| CDP userGesture `requestFullscreen()` | fullscreen = true，n 0→1，未暂停 ✓ |
| **真实 Esc**（CDP Input.dispatchKeyEvent） | 无头 Chrome 自己退出了全屏，页面捕获阶段 keydown Escape 计数为 **0**，即浏览器吞掉了 Esc，和真机一致。fullscreen = false，n = 2；补发 Esc，暂停 ×1，ctx = menu ✓；画布等于容器 × 像素比（1024×576 = want）✓；渲染后重设 0 ✓ |
| 恢复 → 再进全屏 → `document.exitFullscreen()`（浏览器侧退出） | 暂停 ×1 ✓，n = 4 |
| 暂停菜单 → 设置：**真实鼠标点「全屏」** | fullscreen = true，按钮 `.on` 为 true，aria-pressed = "true" ✓ |
| 设置开着时**真实 Esc** | 退全屏，按钮复原（on = false，aria = "false"）✓；暂停计数仍是 1，菜单里退全屏不改状态 ✓ |

- 全程 fullscreenChanges 0→6，`resizeAfterRender` 0，页面错误 0。
- 画布像素：s0 是 1280×720，第一次退全屏后变成 1024×576。期间渲染像素比变成 0.8，看起来是自动画质降到标准档（renderScale 0.8）；每次都和 want 一致，不算问题。降档原因没查（不判 fps）。
- 冒烟 batch26-④（含 webkit 前缀路径和重复事件只算一次）见 §8。
- **未验**：指针锁定状态下 Esc 退全屏（无头 pointer lock + 全屏同时进行没测）；真 Safari 的 webkitfullscreenchange（compat §7）。

## 4 软件渲染提示（e40d415 / cd5e7d5）+ BUG-036

生产 preview 实测，11:38–11:39 UTC+7。
- GPU：`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)…), SwiftShader driver)`。
- 截图：shots/b26-software-notice-menu.png、b26-software-notice-settings.png、b26-software-notice-s1-hidden.png。

**出现位置与文案**：
- 主菜单左下角出现 `.main-render-notice`，rect (128, 664, 468×42)，视口 1280×720。
- 文案和 zh-CN.ts `ui.notice.software_render` 逐字相等 ✓：「浏览器的硬件加速没有打开，画面可能会卡顿。可以在浏览器设置里开启硬件加速，再重新打开游戏。」
- 按钮列在上方（截图），不重叠。
  - 我脚本里的按钮选择器 `.main-btn` 取到 0 个，自动重叠判定无效，以截图和冒烟 ⑤ 为准。

**点击穿透**：
- computed `pointer-events: none`。
- 提示中心的 `elementFromPoint` 是 `.main-menu` 容器，不是提示本身 ✓。
- 真实点击提示中心不打开任何面板，焦点留在 BODY ✓。
- 随后真实点击「设置」打开 ✓，Esc 返回主菜单 ✓。设置面板开着时提示仍在左下 ✓。

**进 S1 隐藏 ✓**：生产 `?art=0`，真实点击「新游戏」，HUD 出现，提示随主菜单隐藏（rect 0）。

**字形全部来自字体子集 ✓**：
- CDP `CSS.getPlatformFontsForNode` 结果：45 个字形全部来自 `NotoSansCJKsc-Regular`，`isCustomFont: true`。
- 这个名字就是 foglight-sans.woff2 内部 name 表的名字（用 fontTools 读出）；提示文案正好 45 个字。
- 没有退到系统字体，「顿」也在内。
- `document.fonts`：Foglight Sans 和 Foglight Serif 都是 loaded。
- 截图里「卡顿」字形正常（只看渲染，不判美术）。

**全量字符比对**（review/font-coverage.txt）：
- zh-CN.ts 179 条，537 个不同字符。
- foglight-sans 和 foglight-serif 都是 711 码位。缺的只有 `\n`（换行，不是字形）✓。
- test:fonts ✓：711 字，子集 711 字；sans 223 KB / serif 312 KB（review/test-fonts.log）。

**BUG-036 回归通过 → 关闭**（BUG-036.md 已更新）。
冒烟 batch26-⑤ 见 §8。

## 5 生产包剔除（134fa9d / 94840ea）— snap-32455f3

**dist grep**（review/dist-grep.txt、dist-params.txt）：
- 生产 JS 里 `.get(` / `.has(` 读参数，没有 debug / scene / smoke / hintScale / father。
- `__qa / __game / __perfSpot / __testbed / __s1–3` 都是 0。
- 剩下的 `` `debug` `` ×3、`` `scene` `` ×5、`` `father` `` ×19 都是类字段名、分包名或说话人键，不是读参数。
- 32455f3 里还剩 `.has(`autostart`)` ×1，预期内，由 a9865b0 去掉，见 §5b。

**生产 preview 实测**（hooks/prod-*.png，t26-hooks.json `prod`）：

| 查询 | 结果 |
|---|---|
| `?debug=1` | 主菜单；无 `__game` 等钩子；DebugPanel 不显示；F3 后 `.fps-counter.detailed` 不存在 ✓ |
| `?debug=1&scene=s2&art=0` | 停在主菜单 ✓ |
| `?scene=s3`、`?debug=1&scene=s3&art=0` | 停在主菜单 ✓ |
| `?scene=sandbox&debug=1`、`?scene=testbed` | 停在主菜单 ✓ |
| `?hintScale=0.05&debug=1` | 主菜单、无钩子；倍率无法从页面观察，靠 dist grep 和 prod-hooks 断言 ✓ |
| `?father=gaze&debug=1` | 同上。生产进不了 S3 直进，只能靠 dist grep 确认 `father` 读参数已摇树掉 ✓ |
| `?smoke=1` 默认关美术 | 生产里**不**关：主菜单请求 art 31 个，点新游戏后到 164 个 ✓ |
| 帧率面板详细 | 以上各查询按 F3 后都没有 `.detailed` ✓ |
| `?smoke=1&autostart=1` | 直接进 S1（HUD）。这是 32455f3 的预期（autostart 还没剔除），a9865b0 回归见 §5b |

- 各查询下 `structuredClone` 都是原生（`[native code]`），内联脚本存在，没有覆盖原生 ✓。
- 页面错误 0。
- **preview:smoke**（5772）：有钩子；Ctrl+C（SIGINT 进程组）后临时目录 foglight-smoke-dist-j5AP7I 已删除 ✓。
- prod-hooks 反例见 §5c（队列跑完后做）。

## 5c verify:prod-hooks 反例（snap-32455f3 的脚本，11:44 UTC+7）

做法：把 dist 拷到临时目录（已删），注入一处，然后 `DIST=… check-prod-hooks`。记录在 review/prod-hooks-counter.txt。

- 干净拷贝 rc 0 ✓。
- 以下 11 个反例都是 rc 1，并且准确报出文件和片段 ✓：
  - static JS 追加 `window.__qa={}`；
  - index.html 注入 `<script>window.__perfSpot=1</script>`；
  - static JS 追加 `window.__game=1`；
  - `.has("debug")`；
  - `.get('scene')`；
  - `` .has(`smoke`) ``；
  - `.get("hintScale")`；
  - `.get('father')`；
  - `startLoading("testbed")`；
  - `assets/x/y.js` 里写 `__s3`；
  - `assets/x/y.mjs` 里写 `` .has(`smoke`) ``。
- 单引号、双引号、反引号三种写法都能拦。
- 局限（记录，不算 bug）：断言是字面量正则。若以后写成 `q.get(name)` 这类变量参数名就拦不到，要靠代码审查。
- autostart 反例见 §5b。

## 6 S3 导光镜真实键鼠冒烟（6b5a72b，6b4a92e 修鼠标步）—— 覆盖审查

实跑结果见 §8。

**覆盖到的**：
- 真实 CDP 键鼠：E 进窗口镜；
- D / A 偏航、W / S 俯仰各一档 15°（只动对应轴、方向相反）；
- Shift+D 精调 7.5°（且不是 15° 的整倍数）；
- R 复位（`atInitial`）；
- 指针锁定下鼠标右移 / 上移 100 px：偏航、俯仰正向整档；
- 鼠标转后 R 复位；Tab 退出；再 E 进，右键退出；
- 指针锁定靠真实点击画面取得。

**没覆盖 / 偏松**（给程序参考，非 bug）：
1. E / R / Tab / 右键各自最多补按 3 次（防无头吞键）。真有「偶发吞键」的 bug，冒烟也会通过。建议报告里记补按次数，大于 1 时标黄。
2. `isMult` 接受整档的倍数。按一下转两档（连发阈值错）这类问题测不出。
3. 只测窗口镜，没测其他镜子；没用真实输入把镜子转到解的角度、验证灯束命中或解谜完成。
4. 没测鼠标左移 / 下移（负方向）、俯仰上限 30° 的截断、未锁指针时的拖拽回退、机关里按 Esc、手柄。
5. 「站到镜前」用传送（注释已说明），走路靠别的冒烟覆盖。

## 8b 冒烟组（snap-32455f3）

**第 1 轮**（`v0.1-batch26|v0.1-M7|v0.1-035|v0.1-BUG-035|v0.1-033 配乐`，11:42:17–12:01:46 UTC+7）：
- 7 项 ✓：
  - 033 配乐；
  - 035 结尾演出 art=1；
  - 035 跳过 art=1（SEEK_SKIP = 19.5，bf90eb8）；
  - 035 后备时钟 art=0（SEEK_MID 45 / 80 + silence−2 的 seek 后 11 个 cue 按序）；
  - 035 结尾曲晚到；
  - **035 结尾曲下载失败**：淡入后 fade 0.00，**轮询用时 3369 ms**。原来固定 sleep 1000 ms 在这种负载下会误报，3a7ae0d 生效 ✓；
  - M7 完整通关 + 存档读档。
- 12:01:37 渲染进程被 OOM 杀掉（dmesg：Killed process chrome），后面的 M7 切画质、BUG-035、batch26 ④②⑥⑤ S3 镜全部连带报崩溃。
- **环境原因**：同机其他项目的 TTS（kokoro / asr，约 3 GB）、video-studio vkit（2.1 GB）、render.py ×3、ffmpeg 同时在跑，可用内存从 9.2 GB 掉到约 1.7 GB。

**第 2 轮**（自动重试一次，12:01:46 起，起跑时可用 3285 MB）：
- 「主场景就绪」后 12:02:38 再次被 OOM 杀掉，记为环境问题。
- 剩下的项等机器空闲时单独重跑，见 8c。

## 8d smoke:xb（snap-32455f3）

- firefox ✓：5 步通过（76 s），12:02:50–12:04:12 UTC+7。起跑时可用内存约 2.4 GB，偏低，但没有崩溃。
- webkit ✓：5 步通过（57 s），12:04:16–12:05:17 UTC+7。
- 截图：xb/ff、xb/wk（menu / s1 / s2 / s3）。
- 日志：logs/x26-ff.log、x26-wk.log。
- 不判 fps。

**重叠检查**：
- 11:43–12:05 我写了一个监视脚本（qa-tools/b26-overlap.sh），每 30 s 扫一遍工作目录不在本快照下的 smoke / verify / headless Chrome 进程。
- 结果：**0 条**，没有和程序的 DPR 探针或其他冒烟重叠。
- 我在 11:2x 没跑任何冒烟：batch25 最后一次是 10:41；batch26 从 11:30 起。所以不存在需要因重叠而重跑的项。

## 8c 冒烟组单独重跑（snap-32455f3，12:05:46–12:28:24 UTC+7）

- 起跑时可用 6956 MB（门槛 6000 MB），只跑了 1 次。
- 过滤：`v0.1-M7 切画质|v0.1-BUG-035|v0.1-batch26`。
- 结果：**EXIT 0，9 项 ✓，0 ✗**：
  - 构建解码器 ✓；主场景就绪 2.2 s ✓；
  - M7 切画质 ✓；BUG-035 ✓；
  - batch26 ④ 全屏同步 ✓；② 无原生 structuredClone ✓；⑥ DPR ✓；⑤ 软件渲染提示 ✓；S3 导光镜真实键鼠 ✓。
- 第 1 轮已通过的 7 项（含 M7 完整通关）没有重跑。
- 合起来，`v0.1-M7` 两项（切画质、完整通关）都 ✓。
- 日志：logs/q26-rr.log。
- 重叠监视脚本 b26-overlap2.sh 跑到 12:28:24：0 条。

## 5b a9865b0 `?autostart` 剔除回归（snap-a9865b0）

快照 12:23 UTC+7 建，做法同 snap-32455f3，0 硬链接，package.json / lock 没变。

- **build + verify:prod-hooks**：rc 0。检查项里新增了「读 ?autostart 参数」。dist 里 grep `autostart`：0 处。日志：review/a98-build-hooks.log。
- **反例**（review/a98-hooks-counter.txt）：
  - 用 a9865b0 的检查脚本扫 32455f3 的 dist → rc 1，抓到 ``.has(`autostart`)``；
  - 往 dist 里注入 `.get("autostart")` → rc 1。
- **生产 preview**（12:28:16–12:29:24 UTC+7，hooks/t26-auto.json，截图 hooks/a98-prod-*.png），下面 4 种参数都停在主菜单，`__game` 为 undefined，没有 HUD：
  - `?autostart=1`
  - `?autostart`
  - `?autostart=1&smoke=1`
  - `?autostart=1&debug=1&scene=s1`
- **preview:smoke**（测试构建）：
  - `?smoke=1&art=0&autostart=1` → 直接进 S1 落潮滩，ctx = explore，有 HUD ✓；
  - `?smoke=1&art=0` → 停在主菜单 ✓。
  - 结束后临时目录 foglight-smoke-dist-r1lCvm 已删除 ✓。
- 浏览器报错 0。

## 新 bug

无。BUG-037 未使用。

## 给程序

- polyfill：index.html 内联版和 clone.ts 的 cloneFallback 是两份手抄实现，改的时候要同步。
- verify:prod-hooks 用字面量正则，参数名放在变量里就抓不到。
- 生产包仍会读其他调参参数（quality / atmo / lut / reflect / simulateFps / slowLoad / greybox / beamDebug / lens / xiShadow 等）。这些不在裁定 31 范围内，要不要剔除请定。
- S3 镜冒烟的缺口：
  - 重试循环会掩盖吞输入；
  - `isMult` 接受倍数；
  - 只覆盖窗口镜；
  - 没测负方向、限位、拖拽、Esc、手柄；
  - 没验证光束解开。
- 全屏测试中，自动画质把像素比从 1 降到 0.8，原因没查。
- 没验证的项：
  - 指针锁定状态下 Esc 退全屏；
  - Safari 真机的 webkitfullscreenchange；
  - DPR 真实通知（Safari 14、Edge 9）。
- 从 a9865b0 起，带 `autostart` 开生产 dist 的 qa-tools 脚本会停在主菜单（见「注意事项」）。

## 清理

- 已删：我的补丁脚本副本、/tmp 临时文件、残留的 qa-chrome-* 目录。
- 保留快照，等清理确认：snap-4008aed、snap-81cfd8f、snap-32455f3、snap-a9865b0。

