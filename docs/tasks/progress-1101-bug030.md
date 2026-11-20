# BUG-030（中）KTX2 宽高非 4 倍数 → BC7 / BC3 上传失败（ramp 采样为 0）—— 进度

依据：v0.1 裁定 29（对象堆口径同意；BUG-030 按方案 A 修，先于 M7）。调查见 docs/tasks/ramp-ktx2-0x502-1031.md。
起点 HEAD 561837d（00:41 接单）。规矩：不建 worktree / 不复制 dist；一次一个浏览器，等 qa-chrome 空闲；命令加超时；临时目录用完删；一步一提交。

## 计划
1. 运行时：KTX2 读头，宽或高非 4 倍数 → 走「只解未压缩 RGBA32」的第二个 KTX2Loader（通用规则）
2. ramp（manifest `ramp: true`）只留第 0 级、Linear、generateMipmaps=false；不改美术文件
3. verify-assets：KTX2 宽高须为 4 的倍数；例外 = manifest `ramp: true` 且 ≤ 4096 texel（运行时转 RGBA）
4. 调试开关 ?rampfix=0：走原压缩路径 + 保留 mip（模拟修前）
5. 单元测试；verify-budget 进场 0x502 归零
6. 前后对比图 docs/tasks/shots-bug030/（先确认修前 = shots-031/s1-xi-cuff-side.png）
7. 就地重建 dist，check:release（含 561837d 后 verify-memory 首次实跑）

## 记录
- 00:4x 扫 art/**/*.ktx2 共 92 张，非 4 倍数只有 4 张 ramp（256×1）
- b979994 运行时分流 + ramp 只留第 0 级 + ?rampfix=0 + 单测
- 70886fe 资源校验（check-size 查 dist、verify-assets 查 ../art）
- 29cbd26 校验规则挪到 scripts/lib/ktx2-rules.mjs（报错文字在 src 会进字体子集，test:fonts 缺 8 字）
- 截图工具已提交（ramp-probe / shots-031 全身机位 / shots-035 / compose-bug030.py）
- 01:0x 制作人 QA（qa-tools/snap-561837d 的 runrel22.sh：build → size → budget → load → memory）在跑，等它结束再 build / 开浏览器
- npm test 全过（exit 0）
- 01:17 制作人 QA 队列（b22-queue / b22-queue2）结束，开始就地 build + 截图
- 01:18–01:21 第一次「修前」S1 截图：起跑时 QA 空闲，但 b22-queue3 01:18:40 起跑（t22-mip-std，功能检查非计时，EXIT 0），重叠约 2 min——之后等待条件加上「没有 b22-* 队列脚本」
- 修前确认：swiftshader 下 4 张 ramp 都是 RGBA_BPTC(BC7)、9 级 mip，原生 WebGL 采样 = (0,0,0,255)（探针第一张因 VAO 顺序没画上，已修）
- 动态袖口机位和旧图对不上（idle 相位不同，cuff 点差几厘米）→ 加 s1-xi-cuff-side-031cam（旧图 JSON 里的 eye/at 固定），重拍
- 01:31 /tmp/shots031-chrome-t4ioQi（pid 1371586）= 我的 run-shots.sh 链（s1-before，01:29 QA 空闲后起跑），父脚本在，继续等

## 01:44 BUG-031 / P3 已提交
- d770b1c BUG-031：按 QA 补丁改 015（允许 __s3 不存在、tick 用 __game.time）+ 035 钩子 const S3；顺手 grep 出的其他释放后读取：035 三处「跳过后读 __s3.endingCutscene」改读点燃时存的 window.__c035 / __em035，晚到钩子 const S3，超时诊断 window.__s3?.，S1 推筏监听 window.__s1?.
- 69683cd P3 EventBus.emit 逐个 try/catch + console.error（带事件名）+ listenerErrors 计数；冒烟收尾读计数；verify-input 单测；npm test 全过
- 截图链：s1-before / s1-after / s3-before 完成（rc 0），s3-after 在跑（01:39 起）
- 之后：重建 dist → SMOKE_ONLY=015 → SMOKE_ONLY=035（各等 QA 空闲）→ check:release 一次

## 01:50 BUG-030 对比图完成（docs/tasks/shots-bug030/，左修前 ?rampfix=0 / 右修后；整帧亮度 Δ，中心 Δ，平均绝对差）
- bug030-s1-xi-body-front-1x2.png：88.8 → 90.5（+1.6），中心 +4.9，MAD 6.4
- bug030-s1-xi-body-side-1x2.png：33.5 → 34.9（+1.4），中心 +4.0，MAD 3.6
- bug030-s1-xi-cuff-side-031cam-1x2.png：48.9 → 65.9（+17.0），中心 +24.9，MAD 19.7
- bug030-s3-ending-05-journal-write-1x2.png：92.2 → 95.8（+3.6），中心 +8.8，MAD 8.1
- 修前探针：4 张 ramp 全 BC7 9 级、采样全 (0,0,0,255)；修后：RGBA 未压缩 1 级、Linear、采样 0→255 渐变，glErr 0
- 旧图核对（修前 vs shots-031/s1-xi-cuff-side.png）：同构图、同样的平冷无明暗交界；MAD 14.1，亮度 48.9 vs 40.1，中心 22.2 vs 20.1；差异主要在背景（后加的水面反射）
- 01:18 那次修前与 b22-queue3 的 t22-mip-std 重叠约 2 分钟，已作废重拍
- 之后：重建 dist（01:50）→ run-final.sh：015 → 035 → check:release

## 02:03 收尾
- 冒烟（dist 01:4x 重建，含 P3）：SMOKE_ONLY=015 通过（01:45–01:46），SMOKE_ONLY=035 通过 5/5（01:47–01:51）；警告只有 three 的「Multiple active KTX2 loaders」（BUG-030 第二个转码器，非错误）
- check:release 一次（01:56–02:02，rc 0，日志 docs/releases/perf/check-release.log）：size 通过（首场景包 126.72/150 MB，首次进 S1 132.20/150，KTX2 块对齐 82 张、非 4 倍数 4 张均为 ramp）；budget 通过、0x502 警告 0、已知警告 4 项（S1 标准档面数）；load 菜单 868 ms、S1 首帧 3235 ms / 全部 3803 ms、失败 0；memory（561837d 后首次真浏览器）通过：菜单显存 91.9 MB（×0.215 ≤ 0.5），再进 S1 显存 ×0.999、几何 ×0.989、贴图 ×0.988、着色器 ×1.041、对象堆 10.3→10.4 MB ×1.01
- 已删 /tmp/bug030-wait、/tmp/bug030-npmtest.log；没有残留 chrome / 临时目录；留下 docs/tasks/shots-bug030/raw 15 MB（原始单张）
