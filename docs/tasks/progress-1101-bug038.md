# 进度：BUG-038 指针锁定被拒 → 拖拽回退（11-01）

- 14:30 开工。docs/bugs/BUG-038.md 尚不存在（制作人建，不自建）；基线 7097d7f。
- ✅ KeyboardMouseInput：被拒（同步抛错 / Promise reject / pointerlockerror）且由点击发起 → lockDenied，进入拖拽回退；被拒那下左键还按着直接开始拖；回退中点击照常当输入，每 1.5 s 顺带重试锁定；锁上后清回退。非点击自动重锁失败不算被拒。错误注释（文件头、catch）已改。
- ✅ 新单测 scripts/verify-pointer-lock.mjs（桩 DOM，9 项，旧代码 0/9、新代码 9/9），接入 npm test（test:pointerlock）；verify-interaction 源码断言同步。
- ✅ typecheck EXIT 0、lint EXIT 0（修掉冒烟脚本里一处 no-useless-assignment 后）、npm test 全量 EXIT 0（/tmp/b38/test.log；test:input 16、test:pointerlock 9/9、test:interaction 32/32）
- ✅ 冒烟检查已写入 smoke-browser.mjs：「BUG-038 指针锁定被拒回退拖拽」（S1 抛错 / pointerlockerror 拖拽转视角，S3 Promise reject 探索拖拽 + 窗口镜拖拽精确 1 档）
- ✅ commit 18cc26f
- ⏸ 冒烟未跑：检查时制作人的 qa-chrome（/tmp/qa-chrome-YGabKo）在跑，按规定不开浏览器。回归命令：
  `SMOKE_ONLY='BUG-038' node --import ./scripts/register-ts-paths.mjs scripts/smoke-browser.mjs`（测试构建进 /tmp 自动删，不动 dist）
- 14:37 再等 4 分钟制作人 QA 仍在跑（BUSY），冒烟交给制作人回归；/tmp/b38 只剩日志，无测试构建。BUG-038.md 仍不存在，未自建。

## 第二轮（16:21 起，制作人验收后）
- ✅ ① 冒烟 BUG-038 就绪等待：4da7788（S1 两段 + S3 段等 explore / 镜头不混合 / 不暂停 / 不切场景 / 不忙；未开浏览器，制作人复跑）
- ✅ ② verify:prod-hooks 补 4 种绕过写法 + 自检：fcd796a（现有 dist 只读复跑 rc 0）
- ✅ ③ compat-report：§6 BUG-037 改已关闭（附 >60 Hz 走路轻点记录）、补 BUG-038 行；§2 指针锁定行补被拒回退；§7 S3 改成修复后预期（含 iframe / Esc 冷却期两种拒绝场景）；F5 补先打开开发菜单。docs 非 git，无 hash
- ✅ ④ BUG-038.md 末尾追加「程序修复说明」（18cc26f 改法、单测、冒烟修正 4da7788），未改制作人原文
- ✅ 第二轮 typecheck EXIT 0 / lint EXIT 0 / npm test EXIT 0（/tmp/b38/r2-*.log；input 16、pointerlock 9/9、interaction 32/32）；verify:prod-hooks 现有 dist 只读 rc 0。全程未开浏览器、未重建 dist、/tmp 无测试构建
- ✅ 补：compat-report §4.1 末尾新增小节「verify:prod-hooks 已知局限」列 QA 的 6 种间接写法（10:41 核对要求）
