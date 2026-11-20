# QA v0.1 batch20（程序 8453b99..f84ee88）

- 被测：f84ee88（主仓库 HEAD 已到 b7e3c6b：569439d 05 机位、9ab5cff 角色 LOD 封顶、b7e3c6b size 压缩检查 —— 不在本批范围，05 机位按 f84ee88 的旧机位验）
- 快照：/workspace/qa-tools/snap-f84ee88，真拷贝（git archive f84ee88 + art 实拷，只略过 art/source 下 >20 MB 的 .blend；node_modules 实拷，package.json 未变），`find -links +1` = 0；dist 17:23 构建，dist 内 0 个硬链接
- art 状态：17:23 拷贝（art 最后变动 15:10，钢笔 prop-fountain-pen.glb 25,188 B 15:10:32）；char-xi-anims.glb md5 c21a2362…（= 程序记录的 P3 版 1,514,792 B），char-xi.glb md5 7d3342f5…
- 环境：swiftshader 无头 Chrome，一次只一个；每次启动前 free ≥ 1.5 GB；冒烟 SMOKE_ESTAB_TIMEOUT_MS=180000 / SMOKE_LOAD_TIMEOUT_MS=120000；不评帧率
- 附件：docs/bugs/qa-v0.1-batch20/

<!-- SUMMARY -->
| 项 | 结果 | 说明 |
|---|---|---|
| ① 02 灯束加强 | ✅ 通过 | 对照 t08/t12 及 -boost-before 前后关系一致、光束明显、软边无硬边；倍率只在 far-exterior 段 2.4，其余 / seek / 跳过都 1 |
| ② 钢笔 | ✅ 通过（BUG-027 按设计关闭） | 挂 hand_r_socket ✓；05 起显示 ✓；04 及之前 / S1 不出现 ✓；跳过立即藏 ✓；对照 -before 一致；06/07 坐写期间仍握笔 = 按设计（制作人裁定，见 BUG-027） |
| ③ 025 反射 | ✅ 通过 | off/0.25/0.5/1 全生效；默认高 0.5 / 标准 0.25 = 文档；淡入连续；0 错误；无接缝 / 闪 / 错位 |
| ④ 沙斑 | ✅ 通过 | seabed=1 去掉 seabed=0 的深色浪块 / 闪烁；固定机位连拍 + 沿南沿缝走一来回都没闪、没亮点；0 错误。走查顺带发现缝里朝东走相机进头 → **BUG-028（中）** |
| ⑤ #157 碰撞 | ✅ 通过 | 17 向迎面最小距离都 = 胶囊半径 0.250 m 不穿；8 个贴边起点都能走出；绕行只在与 #160/#162 相接处（缝 0.03/0.16，按设计过不去）停；南沿缝走通 |
| ⑥ 015 art1 冒烟 | ✅ 通过（第 2 次） | 第 1 次 OOM 页面崩溃 = 环境阻塞，非 bug；重跑全绿 |
| ⑦ check / size / 回归 | ✅ 通过 | check 全 EXIT 0；size menu 5.47/15、首场景包 126.84/150、首次 S1 132.31/150（警戒 140 未到）；010 / 033×2 / 035×5 回归冒烟全部一次过 |
<!-- /SUMMARY -->

新 bug：BUG-027 钢笔 06/07 仍显示（低，已按设计关闭）；**BUG-028 #157 南沿缝朝东走相机进头（中，待修）**

## ⑦a npm run check / size（17:23–17:26，快照内）
- typecheck / lint / test / size / css 全部 EXIT 0；新单测都在跑且通过：verify-render「025 平面反射」「1031 S1 沙斑」×2「#157 挡人体贴合网格」、verify-xi「P3 钢笔」、verify-physics #157 南侧 10 条路径
- size（预算）：主菜单包 menu+boot **5.47 / 15 MB**；首场景包 common+s1 **126.84 / 150 MB**；首次进 S1 总下载 **132.31 / 150 MB（警戒 140，未到）**；s3 组 25.86 MB；配乐 6 首 12.99 MB（懒加载 11.29 MB，不计首包）
- 对比 batch19：menu 5.45→5.47（+0.02，字体子集「反射」）、首次 S1 132.30→132.31；钢笔在 s3 组，不进首包 ✓
- 日志：qa-tools/logs/b20-check.log

## ① 镜头 02 灯束加强（17:24–17:28，shots-035 SHOTS_FAR=1 SHOTS_BOOST_COMPARE=1 SHOTS_ONLY=far-exterior）
- 4 张，失败 0，页面错误 0 → batch20/beam02/（t08 实拍在 t=9.6、t12 在 t=13.62，box 负载 seek 冲过 1.6 s，都仍在 far-exterior 段 4–14 s 内）；报告 beam02 记 boost 前 1 / 后 2.4，同帧同 rotY 1.155
- 对照 docs/tasks/shots-035/s3-ending-02-far-exterior-t08/t12{,-boost-before}：前后关系一致——×2.4 后 t12 侧向光带从淡橙变成清楚的暖色带，t08 朝上光束根部接近饱和偏白；和程序图同观感。光束角度因实拍时刻不同略有差异；海面比程序图亮、有纹理（f84ee88 带 025 反射，程序 02 图是 3f1e2eb 时拍的，预期差异，不是灯束问题）
- 软边：t08 横截面（y=60/150）峰值 75→109 / 89→118，90% 核心宽 57→81 / 58→65 px，边缘过渡几十像素渐变，无硬边；t12 光带边缘看图同样柔和 ✓
- 补记 t20-boost（18:53–18:54，S3 art=1 点灯起每 150 ms 采 `beam.boost` / `uStrength`，beam02/t20-boost.json；swiftshader 每帧慢，实采点 t 0.01 / 2.44 / 8.98 / 14.59 / 17.21 / 19.48）：
  - t<4（lens 段，shot=null）boost 1、uS 0.42；far-exterior（8.98）boost **2.4**、uS 1.008（= 0.42×2.4）；fog-gap（14.59 起）回 1、uS 0.42 ✓
  - seek(30)（gaze）boost 1；skip() 返回 true 后仍 1 ✓；页面错误 0
  - 采样粒度所限，4.0 / 14.0 精确切换时刻没采到（只证明段内 2.4、段外 1）

## ② P3 钢笔（17:27–17:40）
- 挂点：ClipProp 挂在 `hand_r_socket`（父链 hand_r_socket → hand_r → lower_arm_r → upper_arm_r），clip = xi-sit-write；prop-fountain-pen.glb 加载 ok、无回退；进 S3 才加载（s3 组）
- 全程时间线（t20-pen full，每 250 ms 采 visible / 权重 / posing，pen/t20-pen-full.json）：
  - 探索中、fog-gap / silhouette / gaze / father / regaze（04 镜头，xi-stand-gaze）全部 visible=false ✓
  - 坐写开始（over-shoulder = 05）第一笔采样 t=59.93 起 visible=true、w=1 ✓
  - **之后 pull-tower / pull-sea / pull-end（06 / 07 后拉）仍 visible=true**（汐一直保持 xi-sit-write，按代码规则「sit-write 权重 ≥ 0.5 就显示」是对的）；t=107 演出结束 endedBy=end 时 suppressed=true、立即藏 ✓
- 跳过（SKIP 版，seek 60 → 05 中笔可见时 endingCutscene.skip()）：skip 返回 true，同一次求值里 visible=false、suppressed=true，300 ms 后仍藏 ✓
- shots-035 SHOTS_PEN=1（10 张，失败 0，页面错误 0 → batch20/pen/）：04 笔藏（w=0）；05 f60/f72/f18 + 两个特写 visible、w=1、笔尖离日志挂点 1.55–1.86 cm。对照 docs/tasks/shots-035/pen/ 的 **-before** 版（f84ee88 还是旧 05 机位，新机位在 569439d）：平均像素差 3.3–4.1（噪点 / 雨级别），特写里笔握在拇指 / 食指间、笔尖落纸，和程序图一致 ✓
- S1 里钢笔不加载、不在场景（见 ④ 记录 penInS1）
- 05 结束时的隐藏时机（pen/t20-pen-full.json 逐 shot 统计）：05 结束（t≈80 切 pull-tower）时笔**不藏**；pull-tower 41/41、pull-sea 14/14、pull-end 46/47 采样 visible=true、w=1；只在 t=107 演出结束（endedBy=end，切 chapter-end）时 suppress → visible=false
  - 这和程序文档一致（progress-1031-025 §0b：显隐 = 当前覆盖 clip 是 xi-sit-write 且权重 ≥ 0.5；ending.finish / dispose → suppress），汐在 06/07 一直保持坐写，所以按设计就显示
  - 但和本批 brief「其他镜头不出现」字面不符 → 记 **BUG-027（低 / 待裁定）**：要么 06/07 里藏（例如 pull-tower 起 suppress），要么改口径为「坐写期间都在手里」
  - 其他镜头（探索、fog-gap / silhouette / gaze / father / regaze）全部不出现 ✓；S1 不加载 ✓
- 补记 06 / 07 画面（19:14–19:21，shots-035 SHOTS_ONLY=06,07，2 张、失败 0、页面错误 0 → batch20/pull/）：
  - 06 pull-back-room（t 79.45，xi-sit-write）：俯拍背后，右手和笔被身体 / 马尾挡住，放大看只在右肩前有一小点深色（是否笔尾无法确认）→ 实际画面上基本看不到
  - 07 pull-back-sea（t 92.6）：塔外远景，人不在画面内，笔看不到
  - 结论：BUG-027 维持「低 / 待裁定」——状态上在显示，画面上几乎不可见

## ③ 025 平面反射（17:40–18:20，t20-reflect.mjs，S1 art=1 涨潮 y=1.6，1280×720，每档单独一次页面加载）
- 参数生效（`__s1.reflection` 实测，pier 机位）：

  | URL | 档位 | 预设 planar | override | scale | RT | 渲染 |
  |---|---|---|---|---|---|---|
  | 无（默认） | high | 0.5 | null | 0.5 | 640×360 | ✓ k=1 |
  | ?reflect=off | high | 0.5 | 0 | 0 | — | skip='off'，k=0，renders 0 |
  | ?reflect=0.25 | high | 0.5 | 0.25 | 0.25 | 320×180 | ✓ |
  | ?reflect=0.5 | high | 0.5 | 0.5 | 0.5 | 640×360 | ✓ |
  | ?reflect=1 | high | 0.5 | 1 | 1 | 1280×720 | ✓ |
  | 无（默认） | standard | 0.25 | null | 0.25 | 256×144（画布 ×0.8 renderScale） | ✓ |
- 默认 = 程序文档（progress-1031-025 / Reflections.ts / quality.ts）：高档 0.5×、标准 0.25×、极致 1×；batch20 裁定「默认强度先不改」→ 现状仍是高 0.5 ✓
- 贴水高度淡入（pier-low，相机离平均水面 dh，每步等 3 帧，?reflect=1 和 standard 默认两次一致）：−0.3 / 0.02 → 0（skip below）、0.05 → 0、0.1 → 0.023、0.2 → 0.183、0.3 → 0.432、0.45 → 0.817、0.6 → 1、1.2 → 1；单调连续，和程序 heights 记录（0.1→0.023、0.3→0.432）同值 ✓
- 开场 / 码头：draw call 42–75、三角形 2.4–3.1 M（反射 pass），全部 rendered、0 跳过；遮挡查询 occluded=false
- 错误：6 次加载页面错误全 0，加载 210 项 0 失败 / 0 回退
- 伪影（只看正确性）：pier / opening 每档 3 帧（间隔 ≈1.2 s，时间在走），倒影与码头桩 / 栏绳 / 塔 / 礁石位置对齐，左右不镜反，没有接缝、矩形块、错位倒影；帧间差图只在雨圈 / 波纹 / 云的倒影上，0.25 / 0.5 / 1 三档帧间差几乎相同（pier 13.5–13.9、opening 10.5–11.4 灰度均差），off 只有雨圈（pier 7.9–8.6），没有某一档单独闪 ✓
- 注：首轮 default / off / 0.25 / 0.5 在 opening 的统计因 swiftshader 每帧数秒、定时采样拿到上一机位的旧值（脚本问题，已改为按帧等待，1 / standard 用新脚本）；参数、RT 尺寸和截图不受影响，不重跑
- 附件：batch20/reflect/（{pier,opening}-{off,0.25,0.5,1,default}-{high,standard}-{0,1,2}.png、t20-reflect-*.json）

## ④ 沙斑 ?seabed=0 / 1（18:00–18:48，t20-sand.mjs，S1 art=1 高档 1280×720，tide.set('low', instant)，各一次页面加载）
- 参数：seabed=1 `__s1.seabed` 存在（建图 49.8 ms，map 键 data/res/minX/minZ/sizeX/sizeZ/empty/triangles）；seabed=0 为 null ✓；两次加载 210 项 0 失败 / 0 回退、页面错误 0
- 固定机位时间流动连拍（每机位 6 帧、间隔 ≈1.5 s 游戏时，水在动）：
  - rocks-top（俯看 #155–#163 滩地）：seabed=0 #157 西侧沙面上有深色折线浪块、左下沙面有跳动的亮碎斑；seabed=1 浪块消失，沙面变成连续的软边湿沙，亮碎斑稳定
  - 量化（左下 40%×下 40% 沙面区域，相邻帧灰度差）：seabed=0 平均 17.6、>40 的像素 12.6%、>180 亮点占比 0.07%–3.0% 帧间跳动；seabed=1 平均 3.9、>40 1.1%、亮点 0.04%–0.06% 恒定 → 没有闪烁 / 新增亮点 ✓
  - opening（开场机位，远看滩地）：两档整体一致，seabed=1 帧间差 4.0 vs 5.7，无亮点（>180 占比两档同为 ≈3%，是天空 / 塔）✓
  - sand-low 机位（9.0,1.6,−2.2）被 #157 礁石挡住整屏，无效（脚本机位问题，不计）
- 走查（第一轮）：路线从 (4.6,−7.4) 往 (8,−7.7) 时两档都在 (6.09, 0.1, −8.0) 停住（离路点 1.94 m）。更正：⑤ 实测 #157 西沿在 x ≈ 8.6–9，这点不在 #157 里，是西边别的礁石挡体（多半 #155，按 layout 在 #157 西侧且两者相接）挡住；两档同一位置、和沙斑无关。跟拍 8 张两档画面一致，脚边沙 / 浅水无闪
- 补测走查（19:52–20:01，seabed=1，S1 art=1 高档 1280×720 退潮，沿 #157 南沿可走缝 z −8.62：(5,−8.62) → (12.5,−8.62) → (13.6,−7.6) → 回 (12.5,−8.62) → (5,−8.62)，跟拍 22 张 walk2-seabed1-00..21.png，t20-sand2-seabed1.json）：
  - 全程走通（ok=true，11.0 s 游戏时，y 恒 0.1，没卡、没被送回），210 项加载 0 失败、页面错误 0 ✓
  - 沙斑：边走边看沙面 / 浅水，跟拍 22 张里没有闪块、没有新亮点；下半屏 >230 的像素占比每张 0–0.005%（基本没有）✓
  - **另发现**：往东走 x 8.9–13.0 那一段（第 05–10 张），跟随相机被拉进汐的头里（画面是脸部内侧 + 头发洞、眼睛朝相机），第 04 张（x 8.14）和回程往西全段相机正常 → 见下面相机探针 / BUG-028
- 相机探针（20:21–20:32，t20-cam.mjs，sand/t20-cam-strip.json + cam-strip-*.png）：缝里朝东（礁石在右）时肩后右偏一扫就撞 #157（side 0.08–0.19），后拉 targetDistance = 0，相机离头 0.08–0.19 m → 进头；朝北看礁石 0.41 m；朝西 / 朝南 4.0 m 正常；出缝（x 14.3）恢复 1.44 m → **BUG-028（中）**：相机没有最小距离兜底 / 近距离不隐藏角色。和沙斑无关，⑤ 的碰撞本身没问题
- 附件：batch20/sand/（fix-{rocks-top,opening,sand-low}-seabed{0,1}-*.png、walk-seabed{0,1}-*.png、t20-sand-seabed{0,1}.json）

## ⑥ 015 art=1 全量冒烟（18:54–19:02，runc20 015 'v0.1-015 S3' art=1）
- 第 1 次（18:54，启动前可用 5751 MB）：主场景就绪后 Inspector/Target.targetCrashed；dmesg 18:56:08 OOM 杀 chrome（rss 3.2 GB），同时段别的进程 pt_main_thread 也在吃内存 → **环境阻塞（OOM），不算 bug**
- 第 2 次（18:56，可用 10969 MB）：v0.1-015 S3 白盒 / 世界摆位 / art=1 020 件 + 门扇合页 / 谜题 5 全流程（涨潮送回、敲钟退潮、开门、先调镜后开阀、点灯独白）全部 ✓，「冒烟测试通过」EXIT 0
- 日志：qa-tools/logs/q20-015-try{1,2}.log

## ⑦b 回归冒烟 010 / 033 / 035（19:01–19:12，runc20，ESTAB 180000 / LOAD 120000，每项启动前 free ≥ 8 GB）
| 冒烟 | 结果 | 次数 |
|---|---|---|
| v0.1-035 结尾演出 art=1 | ✅ 通过 | 1 |
| v0.1-035 跳过 art=1 | ✅ 通过 | 1 |
| v0.1-035 后备时钟 art=0 | ✅ 通过 | 1 |
| v0.1-035 结尾曲晚到 art=1 | ✅ 通过 | 1 |
| v0.1-035 结尾曲下载失败 art=1 | ✅ 通过 | 1 |
| v0.1-010 场景流程 | ✅ 通过 | 1 |
| v0.1-033 配乐：主菜单 | ✅ 通过 | 1 |
| v0.1-033 懒加载失败 | ✅ 通过 | 1 |
- 全部「冒烟测试通过」EXIT 0，没有 OOM / 重跑；日志 qa-tools/logs/q20-{035a..e,010,033a,033b}.log

## ⑤ #157 礁石挡人体（19:12–19:52，t20-rock.mjs，S1 art=1 低档，退潮 instant）
- 挡人体：`s1-fg-rock-157-collider` 轮廓棱柱 19 点（38 顶点），enabled，世界中心 (11.84, −6.43)，南沿 z −8.34（= 文档 −8.95+0.61）✓；胶囊半径 0.25（gameplay.player.radius）
- 迎面走（24 个方向，从轮廓外 1.4 m 朝中心按 W 2.2 s，记胶囊中心到轮廓的最小有符号距离）→ rock157/t20-rock157-approach.json：
  - 贴到礁石的 17 向（东北 30–75°、西 135–210°、东南 285–345°）最小距离**全部 0.250 m** = 胶囊半径，没穿进，贴边时顺着轮廓滑（如 150/165/180° 都滑到同一凸角 (9.62,−5.41)）✓
  - 0/15°（东）停在 x 15.65、离轮廓 1.16 m；90–120°（北）停在 z ≈ −3.4、离轮廓 1.37 m —— 被别的挡体挡住（不是 #157），不计
  - 225–270°（南）起点落在深水区（z < −8.95），游戏送回安全点 (−10.19, 2.4, −4.23)，是测试起点问题，不计；南沿缝另由绕行 / ④ 走查覆盖
- 第一次运行（18:48）脚本把 Collider 当 Object3D 用（c.updateMatrixWorld 不存在）两次都 FAIL，属脚本错误，已改；第二次在脱困阶段碰到 2400 s 超时（swiftshader 太慢，EXIT 124），迎面数据已存
- 脱困 + 贴边绕行（20:01–20:21，SKIP_APPROACH 单独重跑，rock157/t20-rock157-escloop.json，页面错误 0）：
  - 脱困：轮廓外 0.25–0.34 m 的 8 个起点（四周 + 南沿缝），每点 8 个方向各按 W 0.45 s：能走出（位移 > 0.15 m）的方向 8/7/5/8/8/5/5/8，**每个点都能离开**；走不动的方向都是朝礁石或南沿缝里朝深水墙 / 礁石（缝里只能东西走）✓ 没有卡死点
  - 贴边绕行：从东侧出发顺时针，走到北侧 (12.67, −4.26) 停住，不能继续往西——这里 #157 和 #162（缝 0.03 m）/ #160（0.16 m）相接（npm run check verify-render 打印的邻块缝，按设计 < 0.5 m 明确过不去），是死路不是卡住；全程离轮廓最小 0.250 m，没穿进
  - 南沿缝东西整段由 ④ 补测走通（z −8.62，x 5→13.6→5，没卡、没被送回）✓
  - 离线核对挡体（快照里 buildS1Greybox 包围盒）：④ 第一轮停住点 (6.09, −8.0) 贴的是 #155（与 #157 缝 0.04 m，相接）；迎面 90–120° 停在 #160 / #155 一带，0–15° 停在 x 15.65 平地边
- 结论：#157 新轮廓棱柱不穿模、不卡人 ✅
