# batch13 进度（029 光照贴图接入）

起点 HEAD a3a2a04。规则见任务：每小步 commit，进度写这里。

## 调研结论（已确认）
- art/ 已是新文件（vite 直接映射 ../art，无需拷贝）。
- UV2(uv1) 已经烤成图集坐标（cellar uv1 ∈ [.689,.999]×[.001,.311] 等），README：rect 只是说明，**不再设 offset/repeat**。
- 根节点 userData.lightmap = {texture, encoding RGBM8, lightMapIntensity, rect}；_lodN 上的 extras 无 texture。
- 材质 MeshStandardMaterial；无 AmbientLight/env/probe，只有 LevelScene.hemi（rain-night ×0.35）。
- 没有旧的地窖补光（grep 无）。
- SkyDome elev 读 ATMO028 preset（dusk/after-rain/after-lit 0.18/0.7，rain-night 0.15/0.6 = 美术 json）。

## 计划
1. src/render/lightmap.ts + scripts/verify-lightmap.mjs（test:lightmap）
2. manifest 9 张 tex-s*-lightmap（srgb:false，按场景组）+ LevelScene 挂图 + 预设天光倍率
3. S3 塔门 / S2 地窖门开角调塔内/地窖 intensity
4. 钥匙高亮 + 地窖钥匙点光
5. 院墙 socket 核对脚本
6. build / test / size / 截图 / smoke

## 已完成
- [x] c158fb0 步骤 1：src/render/lightmap.ts + manifest 9 张 + scripts/verify-lightmap.mjs（npm run test:lightmap，已进 npm test）
  - 发现：GLTFLoader 把与场景同名的根改名 name_1 → 按 extras.texture 找根；码头船绳（rope-high/low）也有 uv1、排在 shore 图集空位 [.75–.87]×[.50–.56]，照挂；
    clifftop 材质 2 有约 4% 顶点 UV2 出 [0,1]（≤0.032 = 65px），贴图 ClampToEdge 兜底 → 报美术
- [x] 53ac5f1 步骤 2/3：LevelScene.attachLightmaps（本组贴图）+ setLightmapScale；S3 塔门 0.6 / S2 地窖门 0.55（src/levels/lightmaps.ts）
- [x] 526b249 步骤 5：src/levels/s2/cellarKeyLight.ts、Highlight 'key' 样式、puzzles 接入；院墙 5 个 socket 与 badpack 完全一致、灯台 = layout
- [x] build ok；size：common+s1 125.43 MB / 150，首次进 S1 128.33 MB（/tmp/b13-size.log）
- [x] scripts/shots-029.mjs 已提交；截图跑中（/tmp/b13-shots-*.log → docs/tasks/shots-029/）；npm test 跑中（/tmp/b13-test.log）
- [x] c40a486 test:fonts 修复（lightmap.ts 开发报错改英文）；npm test 其余全过
- 美术 16:47 补充并入：
  - [x] 新 tex-s3-interior-lightmap.ktx2（1,040,718 B）：vite 直接读 art/textures，无需改代码；test:lightmap 9/9
  - [x] 钥匙点光核对 README-029 §2：#C4D2DE / 0.15 cd / 0.22 / decay 2 / 不投影 / 本地 (−0.35,−1.15,0.35) 全一致
  - [—] SH 探针：游戏里没有探针系统（道具仍吃半球光），不重采样；参考值记入汇报
  - [x] f3d604e S3 导光镜交互高亮（同钥匙）
  - [x] 礁岛塔内石面：scripts/inspect-s3-islet-floor.mjs 查过——LOD0 塔内 75.7% 面积礁岛顶 y=0.50 高过地板 0.2（LOD2 94.8%，最高 +0.78）；stair-bottom 在石下；碰撞走白盒 0.2 → 脚埋 0.3 m、踏步 0/1 埋。建议美术改模型
- 跑中：/tmp/run-b13-all.sh（build → size → shots s2 lm1 / s3 / s1 → 冒烟 8 项），日志 /tmp/smoke-b13.log
- 制作人 17:12 补充 BUG-018 / BUG-019（全局雾不改）：
  - [x] bed81de BUG-018 lint（原 7 error + 1 warning）；520afda 本批新增的 lint 3 处
  - [x] 080b18e BUG-019 限高带进入平滑 + verify-camera 逐帧连续断言（改前复现 5.149 m/帧，改后进带 ≤0.179）
  - [ ] npm run check 全绿（等截图跑完再跑，避免 build 换掉 dist）
- 17:00 截图 Chrome 被 OOM 杀掉（dmesg），17:12 重跑 /tmp/run-b13-shots.sh
- 美术 17:29 补充并入：
  - [x] 新 tex-s3-islet-lightmap 1,325,747 B / tex-s3-interior-lightmap 1,043,860 B（Z5）字节核对一致；17:32 从 HEAD 重建 dist（dist 内同字节）；size 首场景包 125.43 / 150 MB
  - [x] 礁岛结论（bf99136 脚本补 LOD/z-fight 统计）：
    - 塔内（距岸 <25 m，三档画质）显示的都是 LOD0；lod0/lod1 节点平移 (0,0.365,0.384)×11.584，lod2 多 +0.081（只在远处出现，不影响塔内）
    - 门外石台/潮钟处礁岛顶 2.26/2.40 与布局一致 → 没有整体摆放偏移
    - 塔内 LOD0 有一块朝上、单面、≈13.2 m² 的 y=0.50 平台（collider 同样 0.50）；来源 build-env-s3.mjs isletH 的“塔脚”压低：h ≤ 0.5 − 0.4·cos(θ)，只有西侧（+x）压到 0.10，东侧仍 0.50 → 美术量到的 0.10–0.19 是西半边
    - z-fight：LOD0 贴近地板 ±（0.168–0.208）约 139 格 ≈1.4 m²（过渡带）
    - 碰撞走白盒地板 0.2（GLB collider 没注册）→ 东半边脚埋 ≤0.30 m；stair-bottom 处礁岛 0.50，踏步 0/1（顶 0.2/0.4）埋在石里
    - 建议：美术改模型（塔内 r<3 m 压到 ≤0.10，或直接挖掉塔下地形）后重烘 islet 图；代码不兜底

## 收尾（18:20 新执行者接手，HEAD 03130cc）
- [x] npm run check 全绿（/tmp/b13-check.log，17:57 结束，CHECK_EXIT 0；typecheck / lint 0 / npm test 全过 / build / size / css）——BUG-018 达标；dist 17:57 由 HEAD 构建
  - size：common+s1 125.43 MB / 150，首次进 S1 128.34 MB
  - BUG-019 verify-camera：进带单帧最大 0.179 m（3.2 m/s），退出 0.554 m，全程 ≤0.6
- 冒烟 /tmp/runsmoke-b13-only.sh（17:57 起）：010 ✓ / 013 ✓ / 014a0 ✓；014a1 ✓（18:29，part2 art=1 全过）；015 ✓；017 ✓；019 ✓ sample-317 A=3 B=0；021/022 ✓ —— 冒烟 8 项全过（18:43）
- [x] 18:45 冒烟后重跑 npm run check（含 typecheck / lint 0 / npm test 全部 / build / size / css）CHECK_EXIT 0（/tmp/b13-check2.log）；dist 已由 HEAD 03130cc 重建
- [x] 体积：common+s1 125.43 MB / 150，首次进 S1 128.34 MB；未登记 art 8 个文件预估接入后 126.24 / 129.14
- batch13 全部完成，待主执行者汇报
