# QA v0.1 batch28 — 验收 18cc26f..fcd796a（M8 前最终包）

**HEAD**：fcd796a，已包含 18cc26f / 4da7788 / fcd796a（`git merge-base --is-ancestor` 确认）。18cc26f..HEAD 只改了 scripts/check-prod-hooks.mjs 和 scripts/smoke-browser.mjs，src 没有改动。

**快照**：/workspace/qa-tools/snap-fcd796a，16:28 UTC+7 创建。
- game 来自 `git archive fcd796a`。
- node_modules 从 snap-18cc26f `cp -a`（package.json / lock 相同）。
- art 是真拷贝；audio、docs 为软链。
- 0 硬链接，共 2.3 G（art 比 batch27 时大）。

**证据**：docs/bugs/qa-v0.1-batch28/{perf,smoke,xb,hooks,review}。

## 汇总

| # | 项 | 结果 | 说明 |
|---|---|---|---|
| 1 | BUG-038 冒烟 ×3（4da7788） | ✓ | BUG-038 冒烟 3/3（S1 两段、S3 两段都跑到，S3 精确 [15,0]、仍在机关）；BUG-038 已关闭 |
| 2 | verify:prod-hooks 规则（fcd796a） | ✓ | 重建 dist 后 rc 0；上次 4 种 + 12 种变体全部拦下，6 种合法写法不误报；自检 4 种改坏里 3 种发现（删 location[ 规则那种因规则重复覆盖没发现）；仍有 6 种间接写法拦不住（记录） |
| 3 | compat-report 核对 | ✓ | §6 BUG-037 已关、BUG-038 行在；§7 S3 修复后预期与代码和实测一致；F5 开发菜单步骤已补；§2 新增句符合，保留 |
| 4 | check:release + 全量冒烟 + smoke:xb（与 batch27 对比）+ 017/035 单跑 | ✓ | check:release ✓（44 ✓，包体 5.48/126.72/132.20 MB 相同，S1 首帧 4488 ms，显存 S1 427.2 MB）；全量 48/51，013/021/035 演出空闲单跑全过；xb ff 445 s ✓、wk 24 s ✓；017/035 单跑 ✓；无新 bug |


## 2 verify:prod-hooks（fcd796a）—— ✓（16:28–16:29 UTC+7）

**快照重建 dist 后跑**（review/build-hooks.log）：`npm run build && npm run verify:prod-hooks` **rc 0**。
- 生产包：index-Cmk9AiBO.js 578.01 kB（gzip 189.12），three 765.64 kB，vendor 368.99 kB。
- 输出里多了一句：「也没有 location[…] / 切 href / URL.search / document.URL 之类的绕过读法」。

**规则自检**：自检内置，每次运行都会跑；不改代码时 rc 0。
- 变异验证（review/prod-hooks-selftest.txt）：临时复制成 scripts/qa-b28-selftest.mjs，故意改坏一条规则后运行。文件已删，游戏仓库 git status 干净。

  | 改坏的规则 | 自检结果 |
  |---|---|
  | 删「切 href」规则 | rc 1，报 `location.href.split` 期望 1 得 0 ✓ |
  | 去掉 `.search` 后的「不是调用」判断 | rc 1，报 `n.search(/…/)` 期望 0 得 1 ✓ |
  | 删 document.URL 规则 | rc 1 ✓ |
  | 删 `location[` 规则 | **rc 0，自检没发现** |

- 第 4 条的原因：自检里的 `location[\`search\`]` / `location['search']` 样例同时会被「方括号读 search / URL 属性」那条规则命中，两条规则重复覆盖。所以单独删掉 `location[` 规则后，自检照样通过。
- 实际影响：删掉后，`location["href"]` 这类写法就拦不住了。自检里没有只靠 `location[` 规则才能拦住的样例。属于自检覆盖的小缺口，记在「给程序」。

**注入样例**（review/prod-hooks-counter.txt；dist 副本 scratch-b28-hooks 已删；快照 dist 未改）：
- 干净副本 rc 0。
- **上次拦不住的 4 种现在全部拦下**（rc 1）：``location[`search`]``、``location.href.split(`?`)``、`new URL(location.href).search`、`document.URL`。
- **变体 12 种也全部拦下**：
  - `window.location['search']`、`globalThis.location["href"].split`；
  - `href.slice(href.indexOf('?'))`、`href.match`、`href.replace`；
  - 先存 URL 再 `.search`、先存 location 再 `.search`；
  - `document.documentURI`、`document.baseURI`、`document['URL']`；
  - `location.toString()`；
  - 带空格写法 `location . href . split (`。
- **不误报**（6 种都是 rc 0）：
  - `new URL("a.glb", location.href)`；
  - `"image/jpeg".search(/…/)`、`n.search (/x/)`（带空格）；
  - `var a = location.href`；
  - `x.research` / `x.searchable`；
  - `location.pathname`。
- **仍拦不住**（rc 0，只记录，现在的 dist 里没有这些写法）：
  - `var {search: s} = location`（解构）；
  - 先存 href 再切：`var h = location.href; h.split("?")`；
  - `String(location).split("?")`；
  - `` `${location}`.split("?") ``；
  - `location.hash`（片段里也能带参数）；
  - `performance.getEntriesByType("navigation")[0].name`。

  这几种都是静态正则很难穷尽的间接写法。生产包现在 0 处，不算 bug，记在「给程序」供参考。

## 3 compat-report 核对 —— ✓（16:30 UTC+7，docs/releases/v0.1-compat-report.md，16:23 修改）

- **§6 BUG-037**：已写「**已关闭（batch27 QA 回归通过）**」，并补了高刷新率的备注 ✓。
- **§6 BUG-038 行**：在，严重度中。写的是「已修 18cc26f；三种被拒都回退拖拽，1.5 s 后点击重试；test:pointerlock 9 项；QA 回归修复通过；冒烟等待修正 4da7788，待 QA 复跑通过后关闭」，与实际一致 ✓。本批第 1 项通过后，这行要改成「已关闭」（见「给程序」）。
- **§7 S3 修复后预期**：拆成 ① 不支持锁定 / 触屏、② 桌面拒绝锁定（iframe 无 allow-pointer-lock，或 Esc 后 1 s 内点击）两种情况。逐条对代码和 batch27 实测：
  - 被拒那一下按着就能拖 ✓（onLockDenied + lockClickHeld）；
  - 之后点击照常 ✓（lockDenied 分支不 return）；
  - 隔 1.5 s 以上再点会重试，锁上后回锁定模式 ✓（LOCK_RETRY_MS；batch27 t27-b038n 的 C 场景实测）；
  - 不会因为被拒而暂停 ✓（冒烟断言 paused=false）；
  - 探索、机关都能拖 ✓。
  - 小提示（不改也行）：触发方式「Esc 后 1 秒内马上点画面」在真机上不好做。按 Esc 会先弹暂停菜单，得先点「继续」再点画面，1 秒内比较难完成。建议真机优先用 iframe 方法。
- **§7 F5**：已补「先打开 Safari 的开发菜单（设置 → 高级 → 在菜单栏中显示『开发』菜单；Safari 17 起叫『显示网页开发者功能』）」✓。
- **§2 新增句**（「指针锁定」行）：「BUG-038（18cc26f）起，点击发起的锁定被拒（同步抛错 / Promise reject / pointerlockerror）也回退左键拖拽」。与 KeyboardMouseInput.ts 一致：
  - Safari 不返回 Promise，走 pointerlockerror 分支；
  - 自动重锁被拒不算（这句没写，但不矛盾）。
  - **符合，保留** ✓。

## 1 BUG-038 冒烟（4da7788）×3

- 方法：`SMOKE_ONLY='BUG-038'` 单跑，每次自建测试构建，同一时间只开一个 Chrome。日志 smoke/q28-b038r{1,2,3}.log。
- **r1**（16:28–16:29 UTC+7，可用内存 11.7 GB）：✓，一次就过。四段都跑到了：
  - S1 同步抛错：请求 2 次，被拒后按住拖拽 −0.300 rad，反向拖 +0.300 rad；
  - S1 pointerlockerror：结果同上；
  - S3 Promise reject：结果同上；
  - **S3 窗口镜：锁定被拒时按住右拖 32 px，精确转出 1 档 [15,0]，仍在机关** ✓。
  - 「请求 2 次」= 被拒那一下请求 1 次，再加第二次按住拖时已经过了 1.5 s，顺带重试 1 次，与设计一致。
- **r2**（16:29–16:30 UTC+7，11.8 GB）：✓，一次就过。四段数字与 r1 完全相同，S3 也是 [15,0]、仍在机关。
- **r3**（16:30–16:32 UTC+7，11.3 GB）：✓，同上。
- 读脚本确认（4da7788）：
  - S1 每段先清掉 foglight.save.v1，再 `ready('__s1')`（等 explore 上下文、相机跟随 explore 且不在过渡、没暂停、没在切场、rig 不忙），然后才模拟被拒、按住拖拽；
  - S3 段 `ready('__s3')` 之后按 E 进窗口镜，模拟被拒，右拖，断言档位精确等于 [15,0] 且仍在机关。
  - 上面四段的输出行都出现了，说明确实跑到。
- **结论：3/3 通过。BUG-038.md 已写 batch28 回归，状态改为「已关闭」。** compat-report §6 的 BUG-038 行还写着「待 QA 复跑通过后关闭」，需要程序改成已关闭（docs 不在 git，QA 不改报告正文，见「给程序」）。

## 4 M8 前最终包：全量冒烟 + xb + check:release（snap-fcd796a）

- 全量冒烟 16:32:39 UTC+7 开始，一次跑完 51 项。机器同时有其他 agent 的 ffmpeg / python 在跑，load ≈ 10–14，所以比 batch27 慢。17:11 时完成 31 项，017 ✗（负载下抖动，排在队尾空闲时单跑复核）。
- **更正（17:18 UTC+7）**：上面写的「17:11 完成 31 项、017 ✗」是 try1 日志，try1 后来被 OOM 杀了。17:01:48 dmesg 显示：先 OOM 杀掉冒烟 chrome（anon-rss 1.8 GB），17:02:04 又杀掉其他 agent 的 python3（12.1 GB）。记为环境问题。按规则重试一次：**try2 17:02:03 开始**（可用 3.3 GB）。证据：smoke/q28-full-try1.log、q28-full.tries。
- try2 进行中：17:17 时完成 26 项。目前 005 ✗（「当前目标：字号切换不对 22px/m ×3」），待全量跑完后空闲单跑复核。

### 4.0 第一轮作废（环境问题，11-01 16:32 → 11-02 14:36 UTC+7）
- 全量冒烟 try1：11-01 17:01 Chrome 和其他 agent 的 python3 一起被 OOM 杀掉。try2 从 17:02（可用内存 3.3 GB）一直跑到 11-02 14:28，用了约 21 小时，原因无法核实。结果 48/51，挂的是 005、1031、batch27-S3。
- xb：ff 145 s ✓，wk 24 s ✓（11-02 14:31）。
- check:release：build、prod-hooks、size 都过了，verify:budget 时 Chrome 连接断了（s1/s2/s3 都是这样），EXIT 1。runrel28 的重试判断没覆盖这种报错，所以没有重试。
- r017 / r035 单跑：「浏览器或显卡不支持 WebGL 2」→ 环境 GPU / Chrome 异常，不是游戏问题。
- 这一轮结论不可信，按「OOM / 环境」处理，重跑一轮（11-08）。原日志放在 env-invalid/。
- 复核 11-08 08:09 UTC+7：游戏仓库 HEAD **仍是 fcd796a**，没有新提交；snap-fcd796a 还在。

### 4.1 check:release（11-08 08:10–08:17 UTC+7，可用 4.5 GB）—— ✓ EXIT 0，一次就过
| 项 | batch28 | batch27（18cc26f） |
|---|---|---|
| ✓ 行数 | 44 | 44 |
| 包体 menu / common+s1 / 首次进 S1 | 5.48 / 126.72 / 132.20 MB | 相同 |
| 主 js / three / vendor | 578.01 / 765.64 / 368.99 kB | 相同 |
| 主菜单出现 | 1177 ms（3.69 MB / 40 请求） | 890 ms |
| S1 首帧 / 资源全部完成 | 4488 / 4990 ms（129.3 MB / 148 请求） | 3991 / 4566 ms（149 请求） |
| 显存 S1 / S2 / S3 / 菜单 / 再进 S1 | 427.2 / 400.8 / 397.5 / 91.9 / 426.6 MB | 426.6 / 400.8 / 397.5 / 91.9 / 426.6 |
| 对象堆 首进 → 再进 S1 | 10.3 → 10.4 MB | 相同 |
- 加载慢约 0.3–0.5 s。当时机器有其他 agent 的 video-studio python 和 Chrome GPU 进程在跑，load 6–8；本机回环、不限速，不算回归。src 自 18cc26f 起没有改动。
- 预算：已知警告 4 项（S1 standard 主 pass 2.20–2.56 M 面），与之前一样。
- 日志：perf/r28b-release.log、verify-*.json。

### 4.2 全量冒烟（08:17:45 起，可用 10.8 GB，同机 load 6–9）—— 进行中
- 08:45 时完成 31 项。暂时挂了 2 项，都等空闲时单跑复核：
  - 013：落水送回岸台时 busy=true，还没送到；
  - 021/022：换地址后 120 s 内 S3 没有就绪，是加载超时。

### 4.2 全量冒烟 —— 跑完（08:17:45–09:44:57 UTC+7，一次跑完，没有 OOM）：**48/51**
- batch27：48/51，挂 017 / 035 / BUG-038。本批 017 ×3 和 BUG-038 全部 ✓，挂的是：
  - **013**：落水后送回岸台时 busy=true，还没送到；
  - **021/022**：art=1 换地址后 120 s 内 S3 没有就绪，是加载超时；
  - **035 结尾演出 art=1**：200 s 墙钟内只跑了 89 个游戏帧，cue 已经到 journal，所以没进结束页。机器同时有其他 agent 的 video-studio、ffmpeg、Chrome 在跑，load 6–9。
- 三项都像负载下的抖动，排到空闲时单跑复核（4.4）。
- 日志：smoke/q28-full2.log。

### 4.3 smoke:xb —— ✓
- Firefox（art=1）：5 步通过，**445 s**（09:45–09:52 UTC+7）。batch27 是 177 s，慢的原因是同机负载重、可用内存只有 ~2.3 GB，**不算回归**。
- WebKit：5 步通过，24 s（batch27 是 25 s）。
- 截图在 xb/ff2、xb/wk2，日志是 xb/x28-{ff2,wk2}.log。

### 4.4 空闲单跑复核
- **017 交互动作 art=1**（10:00–10:06 UTC+7，可用 9.5 GB）：S2、S1/S3 两项 ✓，一次就过。全量里 017 也全部 ✓。
- **035 结尾曲晚到 art=1**（10:06–10:11 UTC+7，11.9 GB）：✓，一次就过。全量里这项也 ✓。
- 日志：smoke/q28-r017b.log、q28-r035b.log。
- 接下来单跑全量里挂的 013、021/022、035 结尾演出。
- **013**（10:11–10:12 UTC+7）✓、**021/022**（10:12–10:13）✓、**035 结尾演出 art=1**（10:13–10:16）✓，都是一次就过。全量里这三项挂掉是负载下的抖动，**不是 bug**。
- 日志：smoke/q28-r{013b,021b,035e}.log。

### 4 结论 —— ✓
- check:release EXIT 0，44 ✓。包体与 batch27 相同；加载慢约 0.4 s，是负载造成的；显存不变。
- 全量 48/51，挂的 3 项空闲单跑全部通过，等效 51/51。
- xb：ff ✓、wk ✓。
- 017 / 035 单跑 ✓。
- **没有新 bug**。fcd796a 可以作为 M8 前的最终包。
- 结束时已清理 /tmp/qa-chrome-* 和 /tmp/foglight-smoke-dist-*。

## 给程序
1. compat-report §6 的 BUG-038 行：把「待 QA 复跑通过后关闭」改成「**已关闭（batch28 QA 冒烟 3/3）**」。
2. check-prod-hooks 规则自检：缺一个只有 `location\s*\[` 规则能拦住的样例（例如 `location["href"]`），现在删掉这条规则自检也不会报错。建议补一个。
3. （可选）prod-hooks 还有 6 种间接写法拦不住：
   - `{search:s}=location`；
   - 先存 href 再 `.split`；
   - `String(location).split`；
   - `` `${location}` ``；
   - `location.hash`；
   - performance navigation `.name`。
   当前 dist 里这些写法 0 处，可以记作已知局限。
4. （可选）compat-report §7 S3 情况 ②：「Esc 后 1 秒内点画面」在真机上很难做到，因为 Esc 会先弹暂停菜单。建议改成优先用 iframe 方法。
