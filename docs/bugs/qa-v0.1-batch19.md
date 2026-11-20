# QA v0.1 batch19 — fe19ab7..8453b99（master，art/ 汐 r5）

- 构建：snap-8453b99（`git archive 8453b99` + art/ 硬链接冻结自主仓库 art/（汐 r5，char-xi.glb md5 7d3342f5…，dist 同 md5），audio/docs 链接，node_modules 沿用，package.json 未变）；`npm run build` EXIT 0，dist 223 MB。snap-fe19ab7 已删，snap-0598043 保留。
- 环境：headless Chrome + SwiftShader；box 过载，一次只开一个 Chrome，启动前 `free -m` 可用 ≥ 1.5 GB；不做 fps 判断。
- 产物：docs/bugs/qa-v0.1-batch19/

<!-- SUMMARY -->
## 汇总

| 项 | 结果 | 要点 |
|---|---|---|
| ① 体积灯束 3d9988c | PASS | 结尾 01/02/05/06/07 与游戏内（桥尾 / 仰视 / 灯室）软边、末端渐隐、无硬带无圆盘；legacy 同帧对比硬边仍在；点火流程见 ⑥ |
| ② BUG-026 回归 | PASS → **BUG-026 已关闭** | 37–40 s 七帧上半无橙色光片；legacy 同帧可复现 |
| ③ 镜头 05 | PASS | 坐在椅上、手在日记页、日记 8/8 角入画、头不裁 |
| ④ 汐 r5 游戏内 | PASS | 加载无失败 / 后备、描边壳可见、手搭头无缝（−4.5…+1.9 mm）；马尾 vs 兜帽离线 0 帧穿插 |
| ⑤ 跳过 8453b99 | PASS | 冒烟通过；手动短按 150/600 ms 不跳、按住跳过；按住 1.2 s 偶尔不跳 = 掉帧（1.2 s 里只 1 帧），环境，不开单 |
| ⑥ 冒烟 015 白盒 art=1 + 谜题 5 | PASS | 17:04 整条通过；新超时复跑 2 次 OOM = 环境阻塞 |
| ⑦ check / 体积 / 回归 | PASS | check 全绿；首次进 S1 132.30 MB、主菜单 5.45 MB；010、033×2、035×5 全过（035 拆成单用例跑，整条跑被 OOM） |
| 快照完整性 | 已处理 | game/ = git 8453b99；art/ = 14:42 dist 基准；硬链接已全部换成真拷贝；dist 没变，不需要重建；跨 15:00–15:04 的灯束截图已重拍 |

新 bug：无（BUG-027 未使用）。已知不报：镜头 02 光束偏淡、没有笔道具（新钢笔道具在 8453b99 之后，不在本批）。


## ③ 镜头 05（b4f0d39 OVER_SHOULDER + 7a65bac 坐姿钉位）— PASS

- shots-035（SHOTS_BEAM_COMPARE=1）05-journal-write 实际 t=69.605（目标 68，负载下超前约 1.6 s，仍在 05 段内）。产物：qa-v0.1-batch19/shots/s3-ending-05-journal-write.png（+ -beam-before.png）、shots-beam.json。
- frameReport：`journalCornersIn 8/8`（日记 NDC x[-0.279, 0.325] y[-0.744, -0.281]，整本在画内）、`occluded 0.333`、`crownPx 323`（头顶到画框上沿留白，头不被裁）、手 `{inFrame: true, hidden: false}`。
- 目视：汐坐在椅子上（臀部落在座面、没有悬空），右手在日记页上，日记完整入画；06-pull-back-room 同样坐姿贴合椅子与书桌。
- 已知不报：还没有笔道具。

## ② BUG-026 回归（父亲镜头上半硬边橙光）— PASS，BUG-026 已关闭

- t19-ghost.mjs（可暂停后备时钟）停在 37 / 37.5 / 38 / 38.5 / 39 / 39.5 / 40 s（实际 37.01–40.07），每点同帧另拍 legacy 圆锥对比。产物：qa-v0.1-batch19/ghost--b026/。
- volume（默认）7 帧都没有整片橙光、没有硬边：上半平均 RGB (138–149, 119–128, 104–109)，下半 ≈(121–126, 92–96, 60–62)；38.5 s 上半 (140,121,105)（batch18 出问题时 (182,153,119)）。
- 同帧 legacy：37 s (165,140,115)、39.5 s (153,132,112)，上方出现 batch18 那条硬边橙光片 —— 旧圆锥扫过灯室相机的推测成立，新灯束已消除。
- BUG-026.md 状态改 closed，追加关闭节。

## ⑤ 跳过（8453b99 skiphint:shown）— 手动 PASS（冒烟见 ⑦）

- t19-skip.mjs（CDP 真键盘 Space，art=1，点灯后）：短按 150 ms、600 ms → 演出继续（endedBy null，t 8.1→11.4→15.8），每次按下都派发一次 `skiphint:shown`（id ch1-ending，shownCount 1→2）。
- 按住 3 s → endedBy 'skip'，结尾曲 `stop … fade 0.75`，随后进 chapter-end。产物：qa-v0.1-batch19/skip/t19-skip.json。
- 第一次按住 1.2 s 没跳：复测 t19-skip2.mjs 记录按住期间帧数 —— 1.2 s 里只渲染 **1 帧**（最长帧间隔 690 ms），松开前控制器进度已 = 1 但没有帧在松开前跑 update；第二次按住 1.2 s（同样 1 帧，落在 1 s 之后）→ 跳过成功（skip.log 有 ch1-ending）。判定：box 过载造成的掉帧，不是逻辑问题，**不开单**；正常帧率下按住 1 s 即跳过。产物 skip/t19-skip2.json。

## ④ 汐 r5 游戏内 — PASS

- 加载：dist char-xi.glb md5 7d3342f5…（= art/ r5）；S3 art=1 冷启动 loadStats 全部 done，无失败 / 后备（beam/t19-beam.json 与 beam-run2-a/t19-beam.json `bad: []`）。
- 描边：t19-xi.mjs（t18-xi2 改指 snapshot）同会话隐藏 / 显示 9 个 `-hull` 网格对比，前 / 后特写头发外轮廓、肩线都有连续暗描边（xi/xi2-{front,back}-hull{1,0}.png）。
- 父亲手搭头（ghost--b026/t19-ghost.json，hand 模式）：t=38.0–40.1 s 手掌最近距离 −4.5…+1.9 mm、`contactLt5mm` 2–48 个顶点、`deepGt10mm 0` → 手贴在头发上，无缝、无深穿插（37.0 / 37.5 s 手还在落下途中，379 / 80 mm 正常）。
- 马尾 vs 兜帽（离线，measure-ponytail-hood，snapshot art r5，ee69493 修过脚本）：马尾 862 顶点 × 兜帽 2200 三角形；look-up / row-boat / pickup / pickup-shelf / pickup-table / push-start / push-loop / push-end 每个片段穿插 > 2 mm 的帧都是 0/N，最深 row-boat 第 0 帧 0.08 cm（0 个穿插顶点），其余 0 → 无穿模。产物 qa-v0.1-batch19/ponytail/、logs/b19-ponytail.log。游戏内这三个片段没逐帧拍（离线测量已覆盖同一 GLB 的同一组片段）。

## 快照完整性复核（美术 15:00–15:04 误写硬链接文件后）

- game/（不含 dist、node_modules）与 `git -C game archive 8453b99` 逐文件 `diff -r`：0 差异。art/ 不在 git 里，以 14:42 构建出的 dist/assets/art（262 个文件，构建是真拷贝、0 硬链接、无 14:43 之后修改）为基准：snapshot art/ 对应文件 `cmp` 0 差异；三件被误写的文件 char-xi-anims.glb md5 37e3b971…（= dist 副本，已复原），build_xi_anims.py / char-xi-anims.meta.json mtime 15:04（源文件，不进运行时）。
- 硬链接已断：snapshot art/（5267 个链接）和 game/node_modules（5517 个）都换成真拷贝，复查 `-links +1` = 0，art/ 再对 dist 0 差异；char-xi.glb 7d3342f5…、char-xi-anims.glb 37e3b971…。主仓库 art 的 char-xi-anims.glb 仍是美术当前版本（c21a2362…），没被动到。snap-0598043 的 node_modules 也换成真拷贝（它的 art/docs 是符号链接，没改）。
- 影响：所有 QA 脚本 / 冒烟 / shots-035 都用 vite preview 服务 dist/，不读 art/；dist 14:42 构建、未变 → 不需要重建。离线马尾测量 14:46 跑完，在误写前。唯一跨 15:00–15:04 运行的是游戏内灯束截图 t19-beam（14:55–15:08）：按要求重跑，① 用重跑结果。
- 美术新交付的钢笔道具（prop-fountain-pen.glb 等，8453b99 之后）不在本批范围，snapshot 里没有。

## ① 体积灯束（3d9988c）— 画面 PASS；点火流程见 ⑥（冒烟 015 谜题 5）

- 结尾镜头（shots-035，SHOTS_BEAM_COMPARE=1，每张同帧另出 legacy `*-beam-before.png`；qa-v0.1-batch19/shots/）：
  - 00 点燃 t=4.6：灯束软边、末端渐隐；legacy 末端硬边圆盘。
  - 01 雾口 t=21.6：灯束上沿亮度约 32 px 内 56→103 渐变、下沿渐降，无硬带。
  - 02 剪影 t=29.6：软、无硬边（偏淡 = 已知，不报）。
  - 05 t=69.6 / 06 t=78.6：室内无橙色光片（legacy 05 上半整片硬边橙光）。
  - 07 后拉 t=92.6：软边、末端消失在雾里；legacy 两条硬边平带 + 端部圆盘。与 docs/tasks/shots-035/beam-compare/ 07 的「新」一侧一致。
- 游戏内（探索态，非演出）：t19-beam.mjs 直接 `lamp.setOn(true)`、冻结旋转，按角度同帧拍 volume / legacy：
  - 桥尾出生点跟随相机 0/45/90/135°：volume 是软边光束、末端淡出；legacy 是硬边带 + 末端圆盘。
  - 塔下仰视 0/90°：volume 两束软边、向外渐隐；legacy 硬直边。
  - 灯室（跟随相机在灯室外廊）0°：volume 无光片；legacy 右侧一块硬边橙色矩形。
  - 跨 15:00–15:04 的第一轮（beam-run1-1455）按要求作废重拍：beam-run2-a（出生点 4 角度 + 仰视 0°）+ beam（仰视 0/90°、灯室 0°）；两轮重拍中途 Chrome 都被 OOM / 崩溃（环境），已拍到的覆盖全部三个机位；重拍与第一轮画面一致。

## ⑦a `npm run check` / 体积 — PASS

- snapshot（断硬链接后）重跑：typecheck / lint / size / css EXIT 0（logs/b19-check2.log）；test 第一次因为 QA 为腾磁盘删了 snapshot 的 art/source、verify-render 读不到 art/source/env/s1-layout.json 而失败 —— QA 自己造成，非游戏问题；从主仓库补回 art/source 的小文件（< 20 MB 497 个，均为 14:40 前未改过的版本，不含美术 15:04 改动的两件；大 .blend 未补，测试不用）后 `npm run test` EXIT 0，366 项 ✓（logs/b19-test3.log）。14:43 首次跑的 check 也全绿。
- 体积（与预期一致）：

| 项 | 实测 |
|---|---|
| 主菜单包 menu+boot | **5.45** / 15 MB |
| 首场景包 common+s1 | 126.84 / 150 MB |
| 首次进入 S1 总下载 | **132.30** / 150 MB（警戒线 140） |
| menu / common / s1 / s2 / s3 | 5.45 / 35.37 / 91.47 / 59.72 / 25.84 MB |
| 懒加载 S1 / S2 / S3 | 2.41 / 2.46 / 6.43 MB |
| 配乐 6 首 | 12.99 MB |

## ⑥ 冒烟 015 S3 白盒 art=1（含谜题 5 点火）— PASS（batch18 遗留关闭）

- 整条冒烟 `SMOKE_ONLY='v0.1-015' SMOKE_QUERY=art=1`（snapshot 真拷贝、0 硬链接），17:04 一次跑通两项（logs/q19-015-1704.log）：
  - 「S3 白盒」：桥尾入口 (39.73, 3, −90.75)、塔心 (39.73, −122.75) 转 135°、海面 y 1.6、室内触发体 ×1、点灯前无暖光；光路正解 窗口镜 → 导光镜 1 → 导光镜 2 → 点火口；art=1 六件 + 门扇挂合页、白盒隐藏；导光镜 a / b 初始 / 正解镜面 = 白盒 ✓。
  - 「谜题 5 流程」：涨潮送回 / 敲钟退潮 / 开门 / 先调镜红光 +「没有油。」/ 开阀 1.0 s 可点灯 / 20 s 提醒一次 / BUG-015 21 视角选中拉杆 / 按 E 拉杆第 34 帧点燃、lighthouse:ignited 一次 / 0:04 切塔外远景 / 106 s 进结束页 ✓。→ ① 的「点火谜题照常工作」同时 PASS。
- 之前 16:18–16:29 四次整条跑都在主场景就绪后被全局 OOM 杀渲染进程（环境）；当时改为分段单跑也都 PASS：t19-015a.mjs（白盒 art=1 段同样断言，s015/t19-015a.json，8/8 PASS）、t19-015b.mjs（原样取冒烟「谜题 5 流程」run() 体、页面 art=1，s015/t19-015b-art1.json PASS）。
- 17:12 按新超时（SMOKE_ESTAB_TIMEOUT_MS=180000 / SMOKE_LOAD_TIMEOUT_MS=120000）复跑两次：第 1 次开头、第 2 次白盒 ✓ 后谜题 5 段渲染进程被 OOM 杀（dmesg 17:16–17:17 全局 OOM，同时还有别的进程被杀）→ **环境阻塞，不是 bug**；结论以 17:04 的整条通过为准。

## ⑦b 回归冒烟 010 / 033 / 035 全量 + 跳过 — PASS

- 整条 `SMOKE_ONLY='v0.1-035'` 在 15:27、16:29 两次因 OOM / 渲染进程死后挂住（环境）；改为每个用例单独一条冒烟（logs/q19-<tag>.log），16:49–16:58 盒子空闲时都是第一次就通过（每次 EXIT 0「冒烟测试通过」）：
  - 035 结尾演出 art=1：逐 cue 按音频时钟（lens 4.71 / fog_open 14.54 / silhouette 24.38 / gaze 30.52 / father_in 36.46 …），106 s 才进结束页 ✓（15:27 那次失败是 fade_out 前一帧间隔 2.3 s，掉帧造成）。
  - 035 跳过 art=1：24.63 s 按下、0.5 s 圆环进度 0.51、`skiphint:shown` 事件 1 次（UI 只 3 帧 / 最长 1238 ms 也能判对）、1.25 s 跳过 → 结尾曲 0.75 s 淡出 → 2.05 s 切结束页、日志第 6 页 ✓。
  - 035 后备时钟 art=0 ✓；035 结尾曲晚到 art=1 ✓（offset 9.024 s 补位、0.5 s 淡入、时钟切到 audio）；035 结尾曲下载失败 art=1 ✓（404 → missing、后备时钟放完、106.00 s 结束页、无报错）。
  - 010 场景流程 ✓（boot+menu、common+s1、预加载 s2、S1→S2→S3、点灯 → 结束页）。
  - 033 配乐主菜单 → S1 交叉淡化 ✓；033 懒加载失败 404 ✓。
- `npm run size` 17:13 复跑 EXIT 0：menu+boot 5.45 / 首场景包 126.84 / 首次进 S1 总下载 132.30 MB，与 ⑦a 一致。
