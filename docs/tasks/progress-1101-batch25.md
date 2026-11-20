# batch25 进度（程序，2026-11-01，UTC+7）
基线 HEAD 4008aed。规则：开浏览器前确认 qa-chrome / qa-tools / b2x-* 空闲，一次一个，命令都加超时；不动 ramp / 暗部参数；不做发布构建；pw-* 保留；新 bug 从 BUG-036 编号。
- 08:35 读完 qa-v0.1-batch24.md，开始。
- [x] 1 钩子不进生产包 ff403ba（生产构建 grep 0 处、测试构建 7 种钩子都在；SMOKE_ONLY=BUG-035 用临时测试构建过，/tmp 构建已自动删；preview:smoke 被 timeout 杀后也删干净）
- [x] 2 Safari interrupted 重试 resume 76ce5bd（verify-audio 43 项；新单测在修前代码上失败；compat §7 Safari 第 10 项「切后台回来有声」）
- [x] 4 写死 107 → ENDING_CUES.length b4844d6（顺带 c.at<=14 ×2、t>=15 ×2、报错文字 5 处、verify-audio 7 处；其余 seek 45/80/19.5 是任意中段点，不是 cue，保留）
- [x] 1 补 e3391f8：三条新 node 脚本补 --import register-ts-paths（verify-assets 规则抓到的）
- [x] 5 同名 ramp 报错完整路径 f8b96cc（verify-assets 34 项 ✓）
- [x] 3 GL 断言 + 画质 standard→high + 捷径覆盖表（qa-hooks.md）81cfd8f，冒烟待最后统一跑
- [x] 6 compat-report：§5 已关闭、§6 三个 bug 已关闭、规则③改正、§7 Safari 11–15 / Edge 8–11 / 手机 M5a–M8b、Safari 5 去掉 ?smoke=1、Safari 6 加 标准→高、「当前无提示」汇总表（docs 不在 git，无 commit）
- 08:49 收尾流水线 /tmp/b25/final.sh 后台跑：check ✓（dist 已原地重建、prod-hooks ✓）→ 冒烟 chrome → xb firefox → xb webkit → check:release

## 收尾（09:22–09:30 UTC+7）
- 收尾流水线 /tmp/b25/final.sh：Chrome 主冒烟（SMOKE_ONLY='v0.1-M7|v0.1-035|v0.1-BUG-035|v0.1-033 配乐'）只挂「v0.1-035 结尾曲下载失败 art=1」（结束页 fade 1，当时 load ≈16.5）；smoke:xb firefox ✓、webkit ✓；check:release exit 0。
- 确认空闲后 `SMOKE_ONLY='v0.1-035 结尾曲下载失败' timeout 1200 npm run smoke` 单跑 2 次（load ≈6.7）：两次都 ✓，「淡入后 fade 0.00」，结束页 @演出 106.51 s。M7 期间也因负载抖过，batch24 也过，**记为时序抖动**（淡入 1 s 等待在高负载下不够），不是 b4844d6 / 76ce5bd 回归；没改代码。
- check:release 日志 → docs/releases/perf/check-release.log；v0.1-perf-report §4 加载 / §5 内存数字更新为本次（81cfd8f）结果，包体数字没变。
- 清理 /tmp/b25、/tmp/m7-xb-*、残留 /tmp/foglight-smoke-dist-*。
