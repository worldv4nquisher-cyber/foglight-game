# QA v0.1 batch27 — 验收 a9865b0..7097d7f（含 a76631c BUG-037 修复）

**HEAD**：7097d7f。a76631c 是 7097d7f 的父提交，HEAD 已包含它（`git merge-base --is-ancestor` 确认），所以以 7097d7f 为准。

**快照**：/workspace/qa-tools/snap-7097d7f，14:27 UTC+7 创建。
- game 来自 `git archive 7097d7f`。
- node_modules 从 snap-a9865b0 `cp -a`（package.json / lock 与 a9865b0 相同）。
- art 是真拷贝；audio、docs 为软链。
- 0 硬链接，共 2.1 G。

**追加（14:39 UTC+7 收到）**：BUG-038 已修，commit 18cc26f（父提交 7097d7f，当前 HEAD）。
- 新建快照 /workspace/qa-tools/snap-18cc26f，做法同上。node_modules 从 snap-7097d7f `cp -a`，lock 相同；0 硬链接，2.1 G。
- 第 9 项（BUG-038 回归），以及第 7 项的 check:release / 全量冒烟 / smoke:xb，都在这个快照上跑。dist 在快照里重建，主仓库 dist 没动。
- 第 1–6 项仍以 7097d7f 为准（18cc26f 只改了 KeyboardMouseInput.ts、冒烟、test:pointerlock 和 verify-interaction 里 1 条正则）。

**证据**：docs/bugs/qa-v0.1-batch27/{perf,smoke,xb,hooks,review,shots}。新 bug 从 BUG-038 起。

## 汇总

| # | 项 | 结果 | 说明 |
|---|---|---|---|
| 1 | ① 41de7eb 生产包不读 URL 调参 | ✓ | dist 0 处 URL 读取；带参数 ×2 / 不带参数 ×2 行为一致（不自动进场、ultra 默认、美术照常加载、无钩子）；9 种违规都拦下；检查器有 4 种写法拦不住（给程序） |
| 2 | ② 1c3abf0 structuredClone 唯一实现 | ✓ | 唯一实现在 structuredClonePolyfill.js；dist 内联正文与源文件逐字节一致，且在入口模块前；test:save 23 ✓ |
| 3 | ③ 7097d7f S3 导光镜冒烟 ×3 | ✓ 3/3 | 单跑 3 次都第一次就过；脚本无重试、角度 eps 1e-9 精确断言、keydown / 转动次数恰好 1、没转就抛错 |
| 4 | BUG-037 回归（a76631c） | ✓ 已关闭 | 机关同帧轻点 6/6、真实轻点 12/12 每下精确 1 档；走路一帧 0.08519；对照组被吞；按住 D 不变；test:input 16/16 |
| 5 | ④ 全屏 DPR 结论 | ✓ | 日志 A/B/C 与说法一致（0.8 = standard 档 renderScale）；抽查 93 次采样里「非 standard 档但像素比≠1」0 次，固定 ultra 时进 / 退全屏 ×3 像素比恒为 1 |
| 6 | ⑤ compat-report §7 F1–F5 / S1–S5 | ✓ | F1–F5、S1–S5 都在，与代码一致；§4 / §4.1 / §6 已更新；F5 缺「先打开开发菜单」这步（小问题） |
| 7 | 全量：check:release / 全量冒烟 / smoke:xb | ✓（冒烟 1 项待程序修） | check:release EXIT 0、44 ✓；包体 5.48 / 126.72 / 132.20 MB 不变；加载 890 / 3991 / 4566 ms；显存 426.6 / 400.8 / 397.5 / 91.9 / 426.6 MB 与 batch26 相同；全量冒烟 48 / 51，017、035 单跑都过；BUG-038 冒烟 ✗（冒烟本身的问题）；xb ff 177 s ✓、wk 25 s ✓ |
| 8 | 新建 BUG-038 | ✓ 已建 BUG-038（中） | iframe 无 allow-pointer-lock、模拟 pointerlockerror 两种方法都复现：拖动 look 0 次、镜子不转，只有 D 能转 |
| 9 | BUG-038 回归（18cc26f） | 修复 ✓ / 冒烟 ✗ 0/3 | pointerlock 9/9、input 16、interaction 32；iframe 和模拟被拒都能拖（look 20 次，镜子 [90,30]）；1.5 s 后重试能锁回；代码四条都确认；冒烟 BUG-038 在 S1 没等建立镜头结束 → 0/3，BUG-038 暂不关闭 |

---

## 注意事项（本批起）

- **生产 dist 不读任何 URL 参数**（41de7eb 起，含 ?autostart / art / quality / debug / scene 等），也没有 `__qa` / `__game` 钩子。
- **qa-tools 已改**（14:28 UTC+7）：`server.mjs` 的 `startPreview` 默认改为起测试构建。
  - 实现：调用快照里的 `scripts/lib/test-server.mjs` 的 `startGameServer`，即 `vite build --mode smoke` 到 /tmp/foglight-smoke-dist-*，关闭时删除。
  - 所有经 b3lib–b8lib / bNNlib 的 `open()` 的旧脚本因此自动走测试构建，`?autostart` / `__qa` 照常可用。
  - 要测生产包时设 `QA_PROD=1`，或直接调用新导出的 `startProdPreview`。
  - 旧快照里没有 test-server.mjs 时，退回生产 preview 并打印提示。
  - 原文件备份为 `server.mjs.pre-b27.bak`。

## 2 ② 1c3abf0 structuredClone 唯一实现 —— ✓（14:29 UTC+7）

证据：review/polyfill-static.txt、review/test-save.log。

- **唯一实现**：全仓只有 `src/platform/structuredClonePolyfill.js` 里有 `cloneFallback` / `installStructuredClonePolyfill` 的函数体。
  - `clone.ts` 和 `polyfills.ts` 都是 `import … from './structuredClonePolyfill.js'`。
  - polyfills.ts 的同名导出只是转调，不是实现。
  - 生产入口包里只有一份降级函数（tt），没有第二份。
- **dist 内联内容 = 源文件**：我独立复算（不调游戏的 inline-polyfill.mjs）。dist/index.html 的 `<script id="polyfill-structured-clone">` 正文与「源文件去掉 `export ` + IIFE 包装 + `installStructuredClonePolyfill(window)`」逐字节相等 ✓（内联 2105 字符 / 源文件 2058 字符）。
- **位置**：内联脚本在第 22 行（偏移 1057），入口 `<script type="module">` 在第 85 行（偏移 3215），three / vendor 的 modulepreload 在第 86–87 行 ✓。three / vendor 分包里没有 structuredClone 调用。
- **vm 实跑内联脚本**：
  - 没有原生时会装上，深拷贝结果正确（对象 / 数组 / Date / Map / Set / 环引用）；
  - 有原生时不覆盖 ✓。
  - 第一次 vm 测试在 Date 那步报 TypeError，原因是我在外层 realm 构造对象，导致跨 realm 的 instanceof 判断不成立，是测法问题。改成在 vm 内构造后通过。
- verify:prod-hooks 里新增的「内联正文与源文件一致、在入口模块前」断言通过。
- **test:save：23 项 ✓ / 0 ✗**（batch26 是 22 项，本批新增「同源」断言）。

## 6 ⑤ compat-report §7 F1–F5 / S1–S5、§4 / §4.1 / §6 —— ✓（14:35 UTC+7，读文档 + 对代码）

文件：docs/releases/v0.1-compat-report.md。

- **§7 F1–F5 都在**：小节标题为「全屏 + 指针锁定下按 Esc、Safari 的 webkitfullscreenchange（batch27 ⑤）」。每条都有操作和预期。
  - 预期依据（补发 Esc、250 ms 去重、菜单里退全屏不改状态、下一帧重设画布、按钮按下态同步）与 KeyboardMouseInput.ts 的 onLockChange、onFullscreenChange、ESC_DEDUPE_MS 一致 ✓。
- **§7 S1–S5 都在**：小节标题为「S3 导光镜：冒烟不覆盖、需真机手测的部分（batch27 ③）」。对过代码：
  - S1：A / B 镜单轴、无上下限，正解 60° / 300°（D 4 下 / A 4 下）；beam.ts 的 `S3_BEAM.solution = { windowYaw 45, windowPitch −30, a 60, b 300 }`，A / B 只有 y 轴、没有 min / max ✓。
  - S2：窗口镜 D 3 下 + S 2 下 = [45, −30] ✓；俯仰范围 [−60, 30] ✓。
  - S3：拖拽回退只在 `lockWanted` 为假时启用，与代码一致 ✓。文中已写明「桌面拒绝指针锁定时不回退拖拽」，本批据此建 BUG-038。
  - S4 手柄、S5 低帧率轻点（BUG-037）✓。
- **可执行性**：步骤都能照做。两处小问题：
  - F5 写的是「开发 → 显示 JavaScript 控制台」，没写要先在 Safari 设置 → 高级里打开「显示开发菜单」。新测试员可能找不到这个菜单。
  - F4 要走到 S3 窗口镜。生产包已不能用 `?scene=s3` 直进，得一路玩到 S3。文中「或任一机关」可以作替代，建议写明用 S1 的机关就行。
- **§4**：已有 batch27 段（S3 冒烟重写、BUG-037、单跑 4 次 3 ✓）✓。
- **§4.1**：已有 batch27 收尾 check:release（13:08–13:18，7097d7f）数字段 ✓。
- **§6**：已有 BUG-037 行，处理写的是「待 QA 回归」。本批回归通过后要程序改成「已关闭」，并补 BUG-038 行（见「给程序」）。

## 1 ① 41de7eb 生产 dist 不读 URL 参数 —— ✓（14:20–14:36 UTC+7）

**静态**（review/dist-grep.txt、review/build-hooks.log）：从 snap-7097d7f 做生产构建，`verify:prod-hooks` rc 0。
- dist 里 0 处：URLSearchParams、location.search、searchParams、testParam、testSearch、autostartQuery、smokeQuery、sceneParam、`__qa`、`__game`。
- 剩下的同名字符串都是内部字段，不读 URL：
  - `simulateFps:null`、`beamDebug:!1`、`reflectKOverride`、`lutKeepSat`、`this.quality=`；
  - `location.href` 只用来解析资源地址（`new URL(e, location.href)`）；
  - `.search(` 只出现在 three.js 的 mime 正则里。

**动态**（hooks/t27-prodq.json，截图 b27-prodq-{menu,s1}-0…3.png）：
- 方法：生产 preview（QA_PROD=1，端口 5781），不带参数 / 带参数各跑 2 次，交替进行。参数为 `?quality=low&art=0&simulateFps=10&autostart=1&debug=1`。
- 每次都先清存储，12 s 后看主菜单，再真实点击「新游戏」，等 HUD 出现后 45 s 采样。

| 项 | 不带参数 ×2 | 带参数 ×2 |
|---|---|---|
| autostart | 停在主菜单（menu ✓、HUD ✗） | 同左，**没有自动进场** |
| 钩子 | `__game` / `__s1` / `__perfSpot` 都是 undefined | 同左（`__qa` 是 QA 脚本自己注入的，不是游戏挂的） |
| quality=low | 控制台「档位 ultra（default）」，然后自动检测 ultra 0.5 fps → high 0.4 / 0.5 fps | 同左，ultra 0.5 → high 0.6 / 0.2 fps。**没有 low 档，也没有被强制改档** |
| simulateFps=10 | — | 实测 fps 是真实的 SwiftShader 值，不是 10 |
| art=0 | 美术请求：菜单 33 / 29 个，S1 236 / 231 个 | 菜单 29 / 29 个，S1 231 / 232 个。**美术照常加载** |
| debug=1 | 无调试面板，HUD 文案相同 | 同左 |
| 存档 | 进 S1 后写 foglight.save.v1，内容相同（只有 savedAt 不同） | 同左 |
| 页面错误 | 0 | 0 |

S1 画布：不带参数的第 1 次是 1280×720、第 2 次是 1024×576；带参数的第 1 次是 1024×576、第 2 次是 1280×720。1024 是自动检测降到 standard 档（renderScale 0.8）的结果，看采样时检测有没有跑完，两组里都各出现一次，跟参数无关。

**白名单自检**（review/prod-hooks-counter.txt）：
- 方法：在 dist 副本里注入违规代码，用 `DIST=` 跑检查器。副本 /workspace/qa-tools/scratch-b27-hooks 已删，游戏仓库没有任何改动。
- 结果：
  - 干净副本 rc 0。
  - 9 种违规都被拦下（rc 1）：变量传参 `get(k)`、先存 params 再读、先存 `location.search` 再读、存 search 后用正则读、非白名单字面量、`url.searchParams`、getAll、forEach、带空格写法。
  - 检查器自带的自检：临时复制到 scripts/qa-b27-selftest.mjs（已删），故意改坏 3 条规则（只认 USP、只拦字面量、去掉 location.search），自检都报 rc 1 ✓。
- **检查器还有 4 种写法拦不住**（rc 0）：``location[`search`]``、``location.href.split(`?`)``、`new URL(location.href).search`、`document.URL`。现在的 dist 里没有这些写法，所以不算 bug，记在「给程序」里。

## 4 BUG-037 回归（a76631c）—— ✓，已关闭（14:35–14:38 UTC+7）

- 环境：测试构建 /tmp/foglight-smoke-dist-b27qa（snap-7097d7f），S3，`?smoke=1&art=0&debug=1&scene=s3`。无头 SwiftShader 约 **0.3 fps**，所以轻点必然落在同一帧间隔里。
- 证据：hooks/t27-b037.json、logs/t27-b037.log（qa-tools）、review/test-input.log。

| 步骤 | 结果 |
|---|---|
| B 探索：同帧合成 W 轻点 ×2 | 每次都走了 0.08519，等于这一帧按住 W 走的距离（同环境下按住 W 约 1 s 墙钟只跨 1 帧，走 0.0852）✓。对照组（把 tappedThisFrame 换成空操作 = 修复前）走 0 |
| A1 机关：同帧合成轻点 D A A D W S | 每下精确 1 档：[15,0] → [0,0] → [345,0]（负向回绕）→ [0,0] → [0,15] → [0,0]，每下转动事件 1 次 ✓ |
| A2 机关：CDP 真实 rawKeyDown + keyUp 轻点 ×12 | 12/12 每下精确 1 档；12 次都是同帧（按下期间 0 帧）✓ |
| A3 对照：模拟修复前 | 同帧轻点被吞，角度 [0,0]，转动 0 次（复现了原 bug，说明测试有效）✓ |
| A4 按住 D 约 2.5 s | 先转 1 档，再连发，共 3 档 → [45,0]；松开后不再转 ✓。按住行为不变。低帧率下 dt 被 maxFrameDelta 截断，连发次数少于墙钟估算的约 16 次，属正常 |
| A5 同帧轻点 Shift | `isDown(fineAdjust)` 仍为 false ✓，修复没有影响 isDown |
| test:input | 16 ✓ / 0 ✗（含新增 2 条）|

- 备注：代码审查发现，高刷新率（> 60 Hz）显示器上，某一帧可能 0 个 fixedUpdate；这时走路轻点会被吞。机关转镜在每帧的 update 里读，不受影响。人手轻点一般超过 50 ms，实际上几乎遇不到，只作记录，不建 bug。
- BUG-037.md 已写回归结果，状态改为「已关闭」。

## 8 新建 BUG-038（中）—— 已建（14:38–14:42 UTC+7 复现）

docs/bugs/BUG-038.md。两种方法都复现了（hooks/t27-b038.json，`repro: true` ×2）：
- iframe `sandbox="allow-scripts allow-same-origin"`（没有 allow-pointer-lock）；
- 顶层页面模拟 `pointerlockerror` 加 Promise 被拒。

实际表现：点画面收到 pointerlockerror，没有锁定；探索拖 200 px，look 0 次；机关里拖动角度一直是 [0,0]；只有键盘 D 能转到 [15,0]。原因是拖拽模式只看 `lockWanted`（支不支持），不看锁定被拒；也没有监听 pointerlockerror，Promise 被拒的结果被吞掉了。截图 hooks/b27-bug038-*.png。

## 3 ③ 7097d7f S3 导光镜冒烟 —— ✓ 3/3（14:42–14:52 UTC+7）

- 方法：`SMOKE_ONLY='v0.1-batch27-S3'`，单独连跑 3 次，都复用测试构建 /tmp/foglight-smoke-dist-b27qa（snap-7097d7f）。同一时间只开一个 Chrome，每次跑前可用内存 10.5–11.4 GB。
- 结果：**3/3 第一次就通过**，没有重试、没有 OOM。

  | 次 | 时间（UTC+7） | 结果 |
  |---|---|---|
  | s3r1 | 14:42–14:45 | ✓ |
  | s3r2 | 14:45–14:48 | ✓ |
  | s3r3 | 14:48–14:52 | ✓ |

  每次都跑完全部步骤：
  - D/A ±15° 含过 0 回绕 345°；W/S 上限 30° / 下限 −60°，轻点和按住都不动；Shift ±7.5°（352.5° / −52.5°）；
  - R 复位；鼠标四向各精确 1 档（32 px）；Esc 暂停 1 次后再 Esc 继续，仍在机关；
  - Tab、右键退出；真实轻点 D×3 + S×2 到 [45,−30]，光路到点火口（reached 3）。
- 日志：smoke/q27-s3r{1,2,3}.log。
- 程序那边单跑 4 次是 3 ✓、1 ✗（无头 Chrome 中途自己解除了锁定），本批 3 次没有复现。
- 读脚本（smoke-browser.mjs 约 4461 行起）：
  - **无重试**：每下都只发一次 rawKeyDown + keyUp，不补按。`until` 只用来等待，不会重新发键；E / R / Tab / 右键各只按一次。
  - **角度精确**：用 eps 1e-9 比较具体角度，不接受整倍数。同时断言页面 keydown 计数恰好 1、转动事件恰好 1 次（在上下限时恰好 0 次）。
  - **未生效即失败**：没转就直接抛错，并附上页面 keydown 计数、上下文、input.recent、指针锁定和焦点日志。
  - 鼠标每次右移 4 px，直到转出第一档为止，然后断言恰好 1 档。
  - 覆盖缺口（不算 bug）：
    - 上下限的「按住」只按了约 4 帧；
    - 不在上下限时，没有测按住连发（BUG-037 回归 A4 补测了，✓）；
    - A / B 镜是用代码直接设到正解的（compat §7 S1 / S2 已列为真机手测）。

## 5 ④ 全屏 DPR 结论 —— ✓ 与程序说法一致（读日志 + 14:52–14:54 UTC+7 抽查一次）

**读 docs/releases/perf/batch27-fullscreen-dpr-probe.log（程序的，测试构建）**：
- A（清存档，不全屏）：自动检测 ultra 2.0 fps → high 2.7 fps → standard。像素比 1 → 0.8（画布 1280 → 1024）正好发生在切到 standard 档时，全程 fs=false。
- B（清存档，检测进行中进 / 退全屏 6 次）：切换期间像素比一直是 1；退全屏会暂停，暂停会重置检测窗口。最后跑满一个不间断的 3 s 窗口、切到 standard 档时才降到 0.8，当时 fs=false。
- C（检测完成后固定极致，用户来源；全屏 ×4 + resize）：像素比始终 1。页面错误 0。
- 代码核对：
  - quality.ts 里 standard 档 renderScale 0.8，ultra / high 都是 1。
  - Game.ts 调用 `benchmark.update(now, paused || hidden)`；QualityBenchmark 暂停时调 `resetWindow()`。
  - 说法成立：降档来自自动画质检测，与全屏无关。

**抽查**（hooks/t27-fsdpr.json；脚本 qa-tools/t27-fsdpr.mjs；测试构建 snap-7097d7f；清存档 + autostart 进 S1；只开一个 Chrome）：
- B'：检测进行中每 4 s 进 / 退一次全屏（CDP userGesture），每 0.5 s 采样一次，共 93 次。
  - 全屏样本 48 次。
  - **「档位不是 standard 但像素比不是 1」0 次**。
  - 第一次 tier=standard 出现在 13.6 s（像素比 1，fs=false）。第一次像素比 0.8 出现在 14.1 s（画布 1024，fs=false，下一帧重设）。
  - 之后进 / 退全屏多次，像素比一直是 0.8，没有再变。
- C'：之后固定 ultra（设置），进 / 退全屏 3 次，6 次采样像素比都是 1、档位都是 ultra。
- 页面错误 0。
- 结论：像素比变化只跟档位走，全屏切换不会改像素比 ✓。

## 9 BUG-038 回归（18cc26f，snap-18cc26f）

**① 静态 / 单测**（14:40 UTC+7，日志 review/b038-*.log）：typecheck rc 0；lint rc 0；**test:pointerlock 9/9 ✓**；test:input 16/16 ✓；test:interaction 32 ✓ / 0 ✗。

**② 冒烟 `SMOKE_ONLY='BUG-038'`**：
- 14:54 第一次单跑 ✗（smoke/q27n-b038.log）。卡在第一步「S1 同步抛错」：`ctx: "cutscene"`，视角没转。req 1、err 0、未锁定、未暂停。
- 原因是检查本身的就绪等待不够：`cdp.goto('')` 只等场景名是 s1-ebb-shore，不等建立镜头结束（回到 explore）。拖拽落在建立镜头的过场里，而过场里本来就不接视角输入，这是设计行为。S3 那段有 `until(explore)`，S1 那段没有。
- 这是冒烟时序问题，不是修复问题。下面 ③ 的 t27-b038n 进 explore 后再测，三种情形都 ✓。
- 全量冒烟里这项和单跑重跑的结果写在下方。

**③ 浏览器回归（QA 脚本 t27-b038n.mjs，14:54–14:58 UTC+7，hooks/t27-b038n.json，截图 b27-bug038n-*.png）**：用原复现的两种方法，加一个重试场景。

| 场景 | 修前（7097d7f） | 修后（18cc26f） |
|---|---|---|
| A iframe 没给 allow-pointer-lock | 探索 look 0 次；镜子 [0,0] 不动 | 收到 pointerlockerror、未锁定；**探索拖 200 px，look 20 次（Σx 0.5）**；窗口镜右拖 + 上拖 → **[90,30]**（俯仰到上限 30°）、look 35 次、仍在 puzzle；D 再转到 [105,30] ✓ |
| B 顶层模拟 pointerlockerror + reject | 同上 | 同 A ✓ |
| C 重试 | — | 先被拒（req 1）→ 恢复原生锁定后 1.5 s 内再点：**不重试**（req 仍为 1、未锁定）→ 隔 1.7 s 再点：重试（req 2）→ **锁上**（pointerlockchange:true）；锁定后不按键移动鼠标，look 12 次，回到锁定模式 ✓ |

页面错误 0。

**④ 读 KeyboardMouseInput.ts 改动**（`git diff 7097d7f 18cc26f`）：
- **能锁定时行为不变** ✓：`lockDenied` 初始为 false，走原分支（请求锁定后，除非是透传键，否则 return）。只多了 `lockClickHeld` 记录，锁上后清掉；`dragFallback = !lockWanted || lockDenied`，在锁定模式下不会开始拖拽。
- **被拒的那一下，左键还按着就立即开始拖** ✓：同步抛错、Promise reject、pointerlockerror 三种都进 `onLockDenied(true)`。如果 `lockClickHeld`、输入启用、cursorMode 是 locked，就设 `dragging = true`。同步抛错时同一次 pointerdown 里就已经 `lockDenied`，按拖拽处理、不 return。
- **拖拽模式下点击超过 1.5 s 才重试，锁上后回锁定模式** ✓：`performance.now() - lastDeniedAt > LOCK_RETRY_MS(1500)` 才会 `requestPointerLock(true)`，这次点击仍照常当游戏输入。锁上后，`onLockChange` 清掉 lockDenied / pendingClickLock / lockClickHeld / dragging。
- **没有手势的自动重锁被拒，不进拖拽** ✓：切回 locked 上下文时调的是 `requestPointerLock()`，即 fromClick=false。这时 `pendingClickLock` 被覆盖为 false，`onLockDenied(false)` 直接 return；`pointerlockerror` 也因为 pendingClickLock=false 被忽略。test:pointerlock 第 8 条覆盖了这一点。
- 备注（不算 bug）：
  - Esc 解锁后约 1 s 冷却期内点画面，Chrome 会拒绝，这时也会进拖拽回退。要等下一次隔 1.5 s 以上的点击才重新锁上。注释里写明了这是预期。
  - compat-report §7 S3 的「桌面拒绝时不回退」和 §6 需要程序按修复后更新。

## 7 全量（snap-18cc26f，HEAD 18cc26f）

check:release 只在 18cc26f 上跑了这一次；7097d7f 上 QA 没有跑过 check:release，不需要再补跑。

**check:release**（15:56–16:04 UTC+7）：**EXIT 0，44 ✓ / 0 ✗**（batch26 是 43 ✓，本批多一条「内联 polyfill 与源文件一致、在入口模块前」）。dist 在快照里重建，主仓库 dist 没动。
- 日志：perf-18cc26f/r27n-release.log；JSON：perf-18cc26f/verify-{budget,load,memory}.json。

| 指标 | batch26（QA，32455f3） | 程序 7097d7f（compat §4.1） | **本批 18cc26f** |
|---|---|---|---|
| 主菜单包 / 首场景包 / 首次进 S1 | 5.48 / 126.72 / 132.20 MB | 5.48 / 126.72 / 132.20 MB | **5.48 / 126.72 / 132.20 MB**（不变） |
| 主菜单出现 | 905 ms | 928 ms | **890 ms**（3.62 MB / 39 请求） |
| S1 首帧 / 全部完成 | 3628 / 4120 ms | 3602 / 4113 ms | **3991 / 4566 ms**（129.3 MB / 149 请求，失败 0） |
| 显存 S1 / S2 / S3 / 菜单 / 再进 S1 | 426.6 / 400.8 / 397.5 / 91.9 / 426.6 MB | 426.6 / 400.8 / 397.5 / 91.9 / 427.3 MB | **426.6 / 400.8 / 397.5 / 91.9 / 426.6 MB** |
| 菜单比例 / 再进比例 | ×0.215 / ×1.000 | — | **×0.215 / ×1.000** |
| 对象堆 | 10.3 → 10.4 MB | 10.3 → 10.4 MB | **10.3 → 10.4 MB** |

包体和显存与 batch26 完全一致。S1 加载慢了约 0.4 s，都在上限内。本机是回环、不限速，同机还有其他负载，这个差异只作记录，不判性能。预算已知警告 4 项，同前。

**smoke:xb**：
- Firefox（art=1）：✓ 5 步 177 s（15:53–15:56）。
- WebKit：✓ 5 步 25 s（15:56）。
- 截图在 xb/n-ff、xb/n-wk；日志 xb/x27n-{ff,wk}.log。
- 对比 batch26：ff 5 步 76 s、wk 5 步 57 s。都是第一次就过，没有 OOM。

**全量冒烟**（14:58–15:53 UTC+7，timeout 7200）：**51 项，48 ✓ / 3 ✗**（日志 smoke/q27n-full.log）。
- ✗ `v0.1-017 交互动作 art=1（S2）`：「地窖钥匙 clip 播完钥匙应收起」。之前批次也出现过同类时序项挂掉，单独重跑结果见下。
- ✗ `v0.1-035 结尾曲晚到 art=1`：对齐后演出 t 和曲子位置差 0.0106 s，超出容差。音频时钟时序项，单独重跑结果见下。
- ✗ `BUG-038 指针锁定被拒回退拖拽`：S1 同步抛错那一步 `ctx: "cutscene"`。与第 9 项单跑相同，是冒烟没等建立镜头结束（见 §9）。

**单独重跑**（16:05–16:12 UTC+7，机器空闲时，同一时间只开一个 Chrome，日志 smoke/q27n-r017.log、q27n-r035.log）：
- `v0.1-017 交互动作 art=1`：✓（S2 和 S1 / S3 两条都过）。
- `v0.1-035 结尾曲晚到 art=1`：✓。
- 两项都是第一次就过，没有 OOM。全量冒烟里挂掉是负载下的时序问题，不是回退。
- 汇总：51 项里 50 项有通过记录。剩下的 `BUG-038` 检查在全量里挂、单跑 2 次也挂（3/3），原因是冒烟本身的等待写法，见 §9。

**② 补充**：`SMOKE_ONLY='BUG-038'` 单跑第 2 次（16:05 UTC+7，smoke/q27n-b038r2.log）仍 ✗，现象相同（S1 同步抛错，`ctx: "cutscene"`）。加上全量里那次，**冒烟 BUG-038 共 0/3**，三次都卡在 S1 第一步、`ctx: cutscene`。这是冒烟检查确定性的问题，不是偶发。
- 修法建议（给程序）：两次 `cdp.goto('')` 后、`deny(mode)` 之前，加上 `until("__game.input.context === 'explore' && !__s1?.rig?.controller?.busy", ESTAB_MS)`，与 S3 那段一致。或者先写存档，跳过建立镜头。
- S1 后半段的「pointerlockerror」，以及 S3 的「reject 探索拖拽 + 镜子右拖精确 1 档到 [15,0]」，因为前面一步就抛错，冒烟里没跑到。

**第 9 项结论**：**修复本身回归通过**。
- 单测：test:pointerlock 9/9、input、interaction 全过；typecheck / lint 通过。
- 浏览器：iframe 和模拟被拒两种情形都能拖拽，探索 look 20 次，镜子 → [90,30]；1.5 s 重试后能锁回。
- 代码：四条要求都确认。

**但程序指定的冒烟 `BUG-038` 0/3 未通过**（冒烟自身的就绪等待问题）。所以 BUG-038 暂不关闭，状态写为「修复已验证，待冒烟修正复跑后关闭」。

## 给程序
1. **冒烟 `BUG-038`**：S1 两段在 `cdp.goto('')` 之后要等 explore（建立镜头结束）再测；改完复跑通过后 QA 关闭 BUG-038。
2. **verify:prod-hooks** 还有 4 种写法拦不住：``location[`search`]``、``location.href.split(`?`)``、`new URL(location.href).search`、`document.URL`。现在的 dist 里没有，建议补进规则和自检。
3. **compat-report**：§6 的 BUG-037 改为「已关闭（batch27 QA 回归）」，并补 BUG-038 行；§7 S3 里「桌面拒绝锁定时不会回退拖拽」改成修复后的预期；F5 补一句「先在 Safari 设置 → 高级里打开显示开发菜单」。
4. 记录（不算 bug）：显示器高于 60 Hz 时，某一帧可能 0 个 fixedUpdate，这时走路轻点仍可能被吞（BUG-037 只修了机关）。

## 清理（16:20 UTC+7）
- 已删除 /tmp/qa-chrome-* 5 个、/tmp/foglight-smoke-dist-b27qa；冒烟自建的 foglight-smoke-dist-* 已由冒烟脚本自己删除。没有删其他任何东西。
- 保留：所有快照（snap-4008aed / 81cfd8f / 32455f3 / a9865b0 / 7097d7f / 18cc26f）；qa-tools 里 server.mjs 的改动（备份 server.mjs.pre-b27.bak）。
- 残留未删：/tmp/smoke-chrome-fUdmSE（按规则只记录，不删除）。
