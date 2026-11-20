# batch26 进度（制作人裁决 31，2026-11-01）

规则：制作人验 batch25 期间不重建 dist（冒烟走 /tmp 测试构建或 SMOKE_DEV）；最后重建 dist、check:release 前确认 qa-chrome / qa-tools / b2x-* 空闲。每项单独 commit；新 bug 从 BUG-036。
文案：ui.notice.software_render 已由 cd5e7d5 进 master（策划定稿，不用占位）。

## 进度
- 09:35 开工
- ② 10549e8：deepClone 降级 + 2 项单测（模拟无 structuredClone；修前 SaveSystem 构造即 ReferenceError），test:save 20 项 ✓。另：vendor 里 three-mesh-bvh 的 Object.hasOwn（15.4+）只在 estimateMemoryInBytes 调试函数里，游戏不调用
- ④ 36c0090：fullscreenchange/webkit 监听、画布立即重设、设置按钮按下态、游玩中被退全屏补一次暂停；冒烟项待跑（09:33 制作人 QA 的 smoke-chrome 在跑，排队）
- ⑥ 58f3c25：dprWatch（matchMedia resolution，每次重新注册）→ 下一帧 resize；test:quality 17 项 ✓（新 3 项）；冒烟项待跑
- ⑤ e40d415：isSoftwareRenderer + 主菜单左下角常驻提示（pointer-events none）；文案用 cd5e7d5 的 ui.notice.software_render，import-text 重新生成与仓库 zh-CN.ts 一致（--check ✓），没加占位；test:quality 18 项 ✓；冒烟项待跑
- 生产包去 debug/scene 134fa9d：TEST_BUILD 常量 + sceneParam；check-prod-hooks 正则断言；试建 /tmp 生产包 ✓、smoke 构建被拦 ✓、现 dist（batch25 构建）会被拦 2 处 → 收尾重建后应过；全部用 debug/scene 的脚本已走 startGameServer
- S3 导光镜真实键鼠冒烟 6b5a72b（待跑；09:40 制作人 qa-tools 冒烟在跑，等空闲）
- 文档：compat-report §2 加 ②④⑤⑥ 行、§7 Safari 5/8/11/12/13/14/15、Edge 8/9/10/11 改修后预期或标已知问题，汇总表拆成「已知问题（不做）」+「batch26 已修」；v0.1.md 裁决 31 下加执行记录；perf-checklist 参数表注明 debug/scene 只在测试构建
- 10:05 空闲确认（wait-idle 3×30 s）→ 跑受影响冒烟（后台，timeout 3600，日志 /tmp/b26/smoke1.log）
- 10:40 受影响冒烟（smoke1）结果：19 项里 15 ✓ / 4 ✗。
  - ✗ 001 ×2：SMOKE_ONLY 没带 003（建立镜头），开局还在 cutscene——选项顺序依赖，不是回归，带 003 单跑确认。
  - ✗ ⑥：无头 Chrome 的 CDP setDeviceMetricsOverride 改了 DPR，却不通知 MediaQueryList change（单独探针确认：新查询 matches=false，旧监听 0 次）→ 冒烟改为：记录式 matchMedia 包装 + 2 s 内没原生通知就在游戏注册的查询上派发 change；固定极致档让像素比真的变；断言重新注册次数。
  - ✗ S3 镜子：E/A/D/W/S/Shift 都过；鼠标那步从精调后的 7.5° 起转，127.5° 不是整档 → 测试写法问题；改成鼠标前先 R 复位、各移 100 px，最后再 R。
  - 探针时制作人 qa-tools 冒烟正好开始（重叠约 3 s，探针已退出）；之后等空闲再单跑。
- BUG-036 7000ad7：test:fonts 抓到新文案的「顿」不在字体子集 → npm run fonts 重新生成；其余单测全过（typecheck / eslint / test:* 25 组 / import-text --check）
- 单跑 smoke2（003+001+⑥+S3 镜子）：6/6 ✓（6b4a92e）
- 10:50 smoke:xb firefox art=1 ✓ 5 步 212 s；webkit ✓ 5 步 25 s（日志 /tmp/b26/xb-*.log）
- 10:51 空闲确认 → check:release（含 build 原地重建 dist + verify:prod-hooks 新断言），后台，日志 /tmp/b26/check-release.log
- 10:53 制作人追加 4 项（batch25 验收结束、可重建 dist）。正在跑的 check:release 留作参考跑完。
  - 94840ea 生产包去掉 4 处 ?smoke（debug.ts smokeQuery = TEST_BUILD && has('smoke')）：artEnabled / UIManager 详细帧率 / sceneHints ?hintScale / S3 ?father=；check-prod-hooks 追加 smoke / hintScale / father 三条正则 + 扫 dist/assets/**/*.js
  - d45f82b structuredClone 全局 polyfill（platform/polyfills.ts，main.ts 第一个 import）；grep 全仓只剩 clone.ts（ending.ts:108 已是 deepClone）；verify-save 21 项；冒烟 'v0.1-batch26-② 无原生 structuredClone'
  - 3a7ae0d 035 下载失败 sleep(1000) → 轮询 fade ≤ 0.05（15 s 上限）
  - bf90eb8 seek 19.5/45/80 → 相对 cue（SEEK_SKIP / SEEK_MID）
  - e13e787 同名 ramp 多张时报错列全（twins()），test:assets ✓
  - 待：参考 check:release 跑完 → 单测全套 → 受影响冒烟 → xb ff/wk → check:release 正式
- 11:04 单测全套 ✓（typecheck / lint / import-text --check / npm test 25 套，save 22 项）；dist 已用新代码重建，verify:prod-hooks ✓（6+0 个文件）；空闲 → 受影响冒烟 smoke3
- 11:07 smoke3 受影响冒烟 5/5 ✓（batch26-② 无原生 structuredClone、007 hintScale、035 跳过 / 后备时钟 / 下载失败（fade 轮询 2569 ms））→ smoke:xb ff / wk
- 11:14 smoke:xb firefox art=1 ✓ 5 步 201 s（llvmpipe）、webkit ✓ 5 步 29 s（Apple GPU）；截图目录已删 → check:release 正式（dist 原地重建）
- 11:27 check:release 正式 EXIT 0（11:15–11:27，32455f3）；日志拷到 docs/releases/perf/check-release.log；perf-report §2/§4/§5、compat §4 / §4.1、v0.1.md 已更新 → 清理临时目录
- 11:28 已清 /tmp/b26（含探针、日志、compat 备份）；无残留 foglight-smoke-dist-* / smoke-chrome-* / m7-xb-*；未动 com.google.Chrome.* / qa-tools / pw-*。batch26 完成。
- 11:30 制作人追加：?autostart 剔除生产包（不跑浏览器、不重建 dist）。改 debug.ts autostartQuery / GameFlow / check-prod-hooks 断言；验证：typecheck / lint / 单测 / /tmp 试建生产 + 测试构建
- 11:31 a9865b0 提交。typecheck / lint ✓，test:flow 9 / save 22 / hint 14 / fonts ✓；/tmp 试建生产包 verify:prod-hooks ✓（含新断言，产物里无 autostart 字样）；/tmp 试建测试构建（--mode smoke）里 has(`autostart`) 仍在，且 verify:prod-hooks 对它如期报错（含 autostart 1 处）；两个试建目录（各 223 MB）已删。用 autostart 的 10 个仓库脚本（smoke-browser、check-027、shots-025/028/029/030/031/031-sand/bug028/footprints）全部经 startGameServer（测试构建或 dev）。未跑浏览器、未重建 dist。
