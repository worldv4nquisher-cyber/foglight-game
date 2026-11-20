# batch12 进度（续做执行者 3，2026-10-30）
HEAD 起点 1a7d604
- [x] 1 (8a7fd11) .gitignore + check-027.mjs 提交
- [ ] 2 sample-317 裁定17
- [x] 3 峡道矩形：shots-028/README.md 已结论=美术预览 env.html 的 Reflector 水面，游戏无需修（待复核）
- [x] 4 dial gate openDeg (2a93dd2)
- [ ] 5 回归
截图：shots-028/ 13 张 + json + README 已全
## 317 抽样（sample-317.mjs，未提交改动：站立面名 + SAMPLE_CAM_NO_INDOOR 假设）
第一次结果 ✗：57 机位几何可读（站立面 s2-floor2-mid 3 / s2-ground-w 31 / s2-west-slope 23）；最好误差 0.02 站位 (0.5,3,0.5) 相机 (-1.39,5.03,0.87)
- 簇 A：二层观察点附近第三人称相机就在眼位后同一视线上
- 簇 B：室外西侧地面/坡，max 距离俯仰 −35° 时相机从西窗钻进二层到眼位附近
程序加亮在非观察模式恒 0（不显影）。log /tmp/s317.log；NO_INDOOR 试验 /tmp/s317b.log
- npm test ✓、build ✓、size：common+s1 120.89 / 首次 S1 123.79 MB ✓（13:15 左右）
- NO_INDOOR 试验：仍 57 个（相机停在西窗口外侧 (1.56,4.26,0.88) 仍可读）→ 已证明问题是"视线延长线"而非穿墙
- 第三次 sample-317 加汐身体遮挡统计 → /tmp/s317c.log
- smoke 串行 /tmp/runsmoke.sh → /tmp/smoke-all.log、/tmp/smoke-<tag>.log
- 插项：导光镜 a/b 重交 → f3f57c6（verify-s3 守卫；0.0086 m、ψ 109.777 / −70.755(白盒 −70.760)）；dist 需重建才同步新 GLB（dist 13:05 是旧版）
- smoke 010 ✗ 慢加载进度线只采到 <3 帧（maxFrameMs 2071，高负载）→ 已改 smoke（未提交）minBar，待重跑
- smoke 013 ✓
- sample-317 提交 81c63f1（✗ 57 / 不被汐挡 45）
- 14:00 runsmoke2：等 014a1 → 重建 dist → 010/015/017/021
- 14:10 重建 dist（导光镜 sha 与 art 一致 b5e15af0…/bb9ed5f5…）；010 ✓（minBar 修后）015 ✓ 021 ✓；014a0 ✓
- 014a1 ✗ 西灯台放下后 idle 等待超时（socket 已有风灯，疑高负载 180 s 墙钟封顶）；017 ✗ 点火口发光读到 0（sleep 300 墙钟）→ 改按游戏时间等（未提交）；runsmoke3 重跑 017r、014a1r
- 钟风吹断言 3df06f6；smoke 修 6d63931
- (续做4) check-027 debug=1 提交 8cf8e22
- 017r ✓ 014a1r ✓（14:11–14:28，墙钟内过，原超时为负载）；13b ✓
- 15:05 build/test ✓ size 120.89/123.79；runsmoke5 在 HEAD dist 复跑 017h/014a1h
- 裁定19 待做：西窗相机碰撞/室外西侧限高，sample-317 B簇=0，退出码+进smoke
- 15:15 裁定19 相机限高改动中（CameraFollowSystem.heightCaps / layout s2CameraHeightCaps / sample-317 分簇），未提交；sample 复测 /tmp/s317d.log
- 裁定19 v2：沿眼位视线斜限高带（margin 0.6 → B 19；改 1.3 复测 /tmp/s317f.log）
- 017h ✓ 014a1h ✓（HEAD 3df06f6 dist，15:25）；sample-317 margin 1.3 → A=3 B=0；相机限高提交 7cbf018
- 15:50 sample-317 进 smoke（v0.1-019，未提交）；重建 dist（7cbf018+），runsmoke6：019/003c/014a0c/014a1c
- 019 ✓ A=3 B=0；003c ✓ 014a0c ✓；sample 进 smoke 提交 a3a2a04；等 014a1c

## 16:08 smoke 014 art=1（014a1c）+ build + size（HEAD a3a2a04）
- smoke 014a1c（SMOKE_ONLY='v0.1-014' SMOKE_QUERY='art=1'）：✓ 冒烟测试通过，exit 0（15:50:08–16:07:38），part1/part2 全 ✓，无需重跑。同轮 019 / 003c / 014a0c 均 exit 0。
- npm run build：✓（typecheck + vite build）
- npm run size：✓ common+s1 120.89/150 MB，首次进 S1 123.79/150 MB；预估 ../art 未登记 17 件全部接入后 ≈ 126.24 / 129.14 MB
- git status：干净
