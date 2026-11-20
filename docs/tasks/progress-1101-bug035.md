# BUG-035 进度（程序，2026-11-01，UTC+7）

规则：开浏览器前等 qa-chrome / qa-tools / b2x-* 空闲；一次一个浏览器、命令加超时；制作人验收 batch24 期间不重建 dist（冒烟用 vite dev 或等 QA 空闲）；pw-* 保留；新 bug 从 BUG-036；中文 commit。

- 06:2x 开始。文案已由 4ae9fcf 进 master（`ui.notice.desktop_only`「目前只支持电脑浏览器。请在电脑上用 Chrome、Edge、Firefox 或 Safari 打开。」，text-ch1.md 触发条件「手机或平板打开时，替代主菜单显示」），不加占位
- 方案：纯函数判定（src/platform/desktopOnly.ts，有单测）→ device.desktopOnly → MainMenu 首页换成提示（隐藏按钮）；冒烟三种设备：桌面 / 触屏笔记本（有触点但主指针 fine + hover）/ 手机模拟
- eda3534 实现 + 单测；冒烟（smoke-browser 新项 + SMOKE_DEV=1 开发服务器模式；smoke:xb 手机断言 + XB_DEV=1）写好未提交，等 QA 空闲跑（06:4x 时有别人的 verify-budget Chrome 在跑）
- 主冒烟 SMOKE_DEV=1 SMOKE_ONLY='BUG-035' 通过（07:2x）：桌面 / 触屏笔记本无提示，手机模拟提示文字一致、按钮隐藏、框 [37,408,357,530] 在 393×852 内
- smoke:xb 手机：XB_DEV=1 chromium Pixel 7 ✓（2 步，提示框 [46,403,366,525] / 412×839）；webkit iPhone 15 ✓（2 步，[37,311,357,433] / 393×659，coarse true anyFine false）；截图核对风格正常。
- smoke:xb 桌面：XB_DEV=1 webkit ✓ 5 步（24s），无提示、S1→S3 正常。
- 冒烟提交 4008aed；BUG-035.md 状态已补哈希。未重建 dist（全程 vite dev）。无新 bug（BUG-036 未用）。
- 清理 /tmp/bug035 与 /tmp/m7-xb-*（自己的）；未动 /tmp/com.google.Chrome.*、qa-*、pw-*。完成。
- 06:55 制作人追加（只改文档）：compat-report §7 新增「手机 / 平板 / 触屏笔记本」真机确认项 M1–M4b（预期按 desktopOnly.ts 推导，写明依据和步骤）；§5 / §6 的 BUG-035 状态改为已修；BUG-035.md 状态行引用了 M1–M4b。没动代码、没建 dist、没开浏览器。
