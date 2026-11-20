# M7 测试与修复（程序侧主动部分）进度 — 2026-11-01

起点 HEAD 69683cd。规矩：等 qa-chrome / b2x-* 空闲才开浏览器、一次一个、命令带超时、临时目录用完删；一步一提交；不调 ramp / 暗部；不发布；不发消息。
注意：QA batch23 也写「新 bug 从 BUG-032 起编号」——程序侧取号前先查 docs/bugs/ 和 batch23，避免撞号。

## 02:10 开始
- [ ] 1 smoke 覆盖清单 + 缺口
- [ ] 1 新 SMOKE：中途存档→刷新→读档→谜题状态→继续通关
- [ ] 2 浏览器：box 上无 firefox / playwright（/opt 只有 google chrome、ungoogled-chromium）
- [ ] 2 代码兼容审查
- [ ] 3 dist 重建 + check:release

## 02:40 smoke 覆盖清单（M7 前 37 项）
- 引擎 / 加载：主场景、DRACO、KTX2 转码、外置 KTX2
- 系统：003 开场镜头、001 输入 / 指针锁、006 存档设置（进场自动存、设置持久、坏档、迁移）、009 画质（自动 / 手动 / 运行中切）、002 角色、003 相机、004 交互、005 字幕 / 阅读 / 日志、007 提示
- 流程：008 菜单 / 设置 / 暂停 / 结束页（无档无继续、覆盖确认、回菜单继续=S1 入口、结束页继续回结束页——用 completeChapter 直调）；010 场景流转（S1→S2→S3 走出口但不解谜；继续 / 直进 S2 不加载 s1）
- 谜题：013 S1 谜题 1/2、014 S2 谜题全套（不走出口）、015 S3 谜题 5 + 点灯 → 结尾 → 结束页（直进 ?scene=s3）
- 美术 / 音频 / 结尾 035：完整、跳过、兜底时钟、晚到音乐、404
缺口：①中途进度 → 刷新 → 继续后谜题复位（S1/S2/S3 都没有）②读档后接着解谜通关 ③一条连起来的真实通关链（S1 解完走出口 → S2 解完走出口 → S3 点灯 → 跳过 → 结束页 → 刷新继续 → 新游戏清档）④S2 解完从没走过出口 ⑤继续进 S2/S3。
- [x] 新 SMOKE「v0.1-M7 存档读档全流程…」覆盖 ①–⑤，commit f6e1f2b；待 QA 空闲后跑

## 02:55 兼容
- playwright 1.64.1 装在 /workspace/pw-tools（19 MB），浏览器 PLAYWRIGHT_BROWSERS_PATH=/workspace/pw-browsers（firefox-1555 310 MB + webkit-2370 271 MB + ffmpeg 5 MB = 585 MB，比预估 200–300 大：新版 playwright 包体就这么大）
- webkit 缺 6 个系统库：apt 源 security 500 无法 apt install；改为从 deb.debian.org 拉 22 个 .deb 解到 /workspace/pw-libs/root（19 MB + deb 4 MB + Packages 索引 54 MB），只用 LD_LIBRARY_PATH，不装进系统。删除：rm -rf /workspace/pw-tools /workspace/pw-browsers /workspace/pw-libs
- 跑过 sudo apt-get update（失败，未改系统包）
- [x] scripts/smoke-xbrowser.mjs + npm run smoke:xb（commit 见下）
- [ ] 等 QA 空闲 → firefox / webkit 各跑一次

## 02:36 制作人补充（并入）
- ramp：用户选方案 A，不动 ramp / 暗部，不做评估
- [x] __qa 钩子 573f551；文档 docs/releases/v0.1-qa-hooks.md
- [x] 完整通关项改用 __qa 快照断言（与进场存档一致）+ 切画质项 5fe1d5e
- [x] smoke:xb 手机模拟 bb81289
- 后台：/tmp/m7-wait/run1.sh（等空闲 → build → SMOKE_ONLY=v0.1-M7）→ run2.sh（firefox / webkit / webkit iPhone 15 / chromium Pixel 7）
- 发现（代码审查）：手机上没有任何提示，触屏输入默认不注册（GDD §15 桌面专做）→ 打开能进菜单 / 场景但无法操作；待模拟确认后立 bug

## 02:52 制作人补充（四个小项，各自 commit）
- [x] ① BUG-032 035a 结束帧阈值 → ENDING_CUES.silence；同类写死的演出尾时间（015/017 的 seek(104)、035 的 seek(104.5)、后备时钟 / 404 的 seek(104)、两处 sceneAt.t>=106）一并改引用：8ae282f（同一 commit 里顺带了 M7 完整通关项 S1 浮台初值比较的测试修正——首跑误判：涨潮时浮台本来就 floating）。docs/bugs/BUG-032.md 已写修法，状态「已修，待 QA 回归」
- [x] ② KTX2 ramp 豁免按清单完整路径匹配 + 单测（verify-assets 34 项过、size 82 张 / 4 张 ramp 过）：df32f7f
- [x] ③ listenerErrors 读不到（崩溃 / 无 __game / 非数 / 10 s 超时）直接判失败：a5154a1
- [x] ④ ramp sRGB 调查（只查不改）：
  - 现状：manifest 里 tex-xi-ramp 没写 srgb:false → AssetLoader 设 SRGBColorSpace → 采样时 sRGB 解码。
  - 美术原意是**线性数值**：gen_tex_char_xi.py 第 328–332 行 `v = smooth(0.46, 0.52, r)` 直接 ×255 写 PNG（数学值，不是按显示亮度画的）；四张 ramp 的 KTX2 DFD transfer = 1（linear）。README-028 也说 ramp「读 R = 受光比例」。所以 sRGB 解码**不是有意的**，是 manifest 默认值带上的（只有 tex-xi-ramp 在用；tex-ramp-char/env/metal-wet 目前代码里没采样）。
  - 改 NoColorSpace 的影响（按源 PNG 线性插值算）：lit=0.5 的明暗分界从 N·L −0.0007（90.04°）移到 −0.0200（91.15°），往暗面挪约 1.1°（u 偏 0.0097 ≈ 2.5 texel）；10%–90% 软边从 88.57°–91.86°（3.3°）变成 89.03°–93.24°（4.2°），软边略宽；软边内单点 lit 最多差 0.29（texel 125），只影响 13 个 texel。在汐头部（半径约 0.1 m）上分界移动约 2 mm，正常机位下 1 px 左右。
  - 结论：不是有意的，但用户选了方案 A（保留现在修后的样子），**不改**；画面不变。若以后要「按美术原意」，改 manifest 一行 srgb:false 即可，但会让暗部略多、软边略宽，需要美术重新看一眼。

## 03:00–03:50 兼容跑测 + 修复
- [x] 切画质项 S2 超时：goto 少 debug=1（?scene=s2 直进要 debug）→ b62e387
- [x] smoke:xb 报错带「在哪一步之后、几秒」→ fea0743；空 pageerror 打印 name / String(e) → ea8d2c8
- [x] BUG-033 Firefox 刷新时 AudioContext resume 被拒（InvalidStateError: Navigated away）成未捕获异常 → 3a8b4a3（unlock 吃掉拒绝、running 才撤监听；verify-audio 42 项过）
- [x] BUG-034 换场第一帧平面反射在阴影贴图建好前渲染，sampler2DShadow 绑空颜色纹理（WebKit console.error，Chromium / Firefox 只是 warning）→ 91c4b55；完整通关项「走出口」加 GL 错误断言；dist 已按修后重建
- WebKit 桌面起不来（libevent 找不到）：MiniBrowser 包装脚本会覆盖 LD_LIBRARY_PATH → 把 /workspace/pw-libs 里的库软链进 /workspace/pw-browsers/webkit-2370/minibrowser-wpe/sys/lib（79 个链接，仍在临时安装目录内）
- WebKit（WPE）没有 GStreamer 解码插件：decodeAudioData 连 WAV 都永不返回 → art=1 卡在启动（主菜单不出现）。环境问题，不是游戏 bug；smoke:xb 加 XB_AUDIO_DECODE=reject 绕过，同时模拟 Safari 18.4 以前解不了 Ogg（音频全缺也能玩）→ 412d54d
- smoke:xb 结果（dist 含 BUG-033/034 修复）：
  - firefox 157 桌面 art=1：5 步过（149s，llvmpipe 自动降到 standard）
  - webkit 27.2 桌面 占位：5 步过（22s）；art=1 + XB_AUDIO_DECODE=reject：5 步过（131s），截图主菜单 / S1 / S2 / S3 画面正常
  - webkit iPhone 15 模拟 占位：5 步过（24s），无报错；早先那条空 pageerror 未复现
  - chromium Pixel 7 模拟（系统 Chrome）：5 步过（95s，修前那轮）
  - 手机：能打开能进场，但只有桌面键位提示、无触屏控件、无任何说明 → BUG-035（中），需策划给文案 ID，未修
- [ ] SMOKE_ONLY='v0.1-M7' 重跑（进行中）→ 全量 smoke 一次 → compat-report → check:release → 清理

## 03:42 中断后续做
- 中断时自己的 SMOKE_ONLY='v0.1-M7' 还在跑，等它跑完（未杀）：完整通关项 ✓；切画质项 ✗「换地址后 120 秒内 s1-ebb-shore 没就绪」
- 定位（临时加日志，已还原）：S1/S2/S3 三档其实都切完了，失败在收尾 `cdp.goto('')`——存档停在 s3 入口，autostart 继续进 S3，等不到 s1。收尾前清档 → 62cec60
- 写 docs/releases/v0.1-compat-report.md 初稿（结果待全量 smoke / check:release 补）；qa-hooks.md 更新 WebKit 跑法
- [x] SMOKE_ONLY='v0.1-M7' 重跑：两项都过（04:5x，完整通关 + 切画质 S1/S2/S3 三档 GL 0 错误、亮度正常、实体不丢）
- [ ] 全量 smoke（进行中）→ check:release → 清理
- 全量 smoke（04:57 起，后台 /tmp/m7-wait/full.log）中途：v0.1-009 画质项 ✗ `TypeError: reading 'drawRange'`——冒烟脚本按 Points 读雨量，028（be9851c，10-30）起 Rain 是 Group，**旧问题，不是 M7 回归**。改读 Rain.dropCount → e8bc46d；全量跑完后单独重跑 009 确认
- 全量 smoke 结果（04:57–06:00，box 负载 18–20 / 8 核，其他项目的 python / ffmpeg 在跑）：38 过 6 挂——009 画质（脚本旧问题，已修 e8bc46d）、1031 配乐 S3 两层（`layers` null）、1031 点燃 → 结尾曲（跳过没淡掉）、035 结尾演出 art=1（音频时钟 0 → 21 s 跳变，cue 迟到）、035 跳过 art=1（演出没走到 20 s）、035 404（结束页 1 s 后 fade 仍 1）。后五项都是墙钟 / 音频时钟时序断言，疑负载；单独重跑确认
- 单独重跑（06:0x）：1031 S3 两层、1031 点燃 → 结尾曲、035 结尾演出 / 跳过 / 404 全过——确认是负载时序抖动。009 仍挂：e8bc46d 的行内 `//` 注释落进页面求值的模板字符串，把同一行的 wantRain 注释掉了 → 7f73706 改块注释，单独重跑 009
- 009 单独重跑通过（7f73706 后）。全量 39 项全部有通过记录
- compat-report 补完：§1 Chrome 行、§4 全量结果 / 时序抖动说明 / 009 脚本修复（docs 不在 git，无 commit）
- 下一步：npm run build 原地重建 dist（后台）→ check:release
- dist 原地重建完成（vite 1.66 s，index 580 kB / gzip 191 kB）；开始 check:release（后台，先等队列空闲）
- bug 文件：BUG-032/033/034 状态行补 commit 号；BUG-035 维持「待策划给文案」
- check:release 通过（06:08–06:15，EXIT 0）：首次进 S1 132.20/150 MB；budget 已知警告 4；主菜单 1045 ms、S1 首帧 4197 ms；显存 S1 427.2 → 再进 426.6 MB。日志拷到 docs/releases/perf/check-release.log；perf-report §2/§4/§5、compat-report §4.1 已更新
- BUG-032..035 文件确认（032/033/034 已修待 QA，035 待策划文案）
- 清理（06:2x）：删 /tmp/m7、/tmp/m7-wait、/tmp/m7-xb-chromium-Pixel7-8tnj4c；无残留 /tmp/smoke-chrome-*；/tmp/com.google.Chrome.* 未动；另删 03:26 WebKit 跑留下的两个空 playwright 临时目录；pw-* 保留（643 MB）。M7 完成
