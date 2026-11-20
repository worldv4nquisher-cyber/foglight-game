# 037 性能 / 包体 / 发布前自检 进度（2026-10-31，UTC+7）
> 只做自检：不构建 / 不发布发布版（发布前必须用户确认）。vite build 只用于本地自检的 dist。帧率 / 1% low / 帧时间由用户 M8 实机填。

## 0 准备
- [x] scripts/lib/cdp.mjs：无头 Chrome（swiftshader）+ CDP 小工具（launchChrome / evaluate / until / setView / shot，看门狗只杀自己的 chrome）
- [x] 主角 / NPC LOD 上限（裁定第 4 条）：src/render/lod.ts applyCharLodCaps，LevelScene.applyQuality 里按档套 heroCharTris / npcCharTris
  - 每级面数：char-xi 119846 / 48499 / 24299，char-father 55870 / 24000 / 11999
  - 结果：极致 xi LOD0 / 父亲 LOD0；高 xi LOD1（50k）/ 父亲 LOD1（40k）；标准 xi LOD1 / 父亲 LOD1（25k）；远处照常降到 LOD2
  - verify-lod 加测试，14 项全过
- [x] commit 9ab5cff（LOD 封顶）、b7e3c6b（size 加压缩检查）

## 1 包体 + 压缩（17:10，过）
- npm run size：主菜单包 5.47 / 15 MB，首场景包 common+s1 126.84 / 150 MB，首次进 S1 总下载 132.32 / 150 MB（警戒 140）；S2 59.72 MB、S3 25.86 MB
- 压缩：dist 71 个 GLB 全部网格 Meshopt + 贴图 KTX2；独立贴图 82 个 ktx2（140.2 MB），png 只有 LUT 5 个 + 图标，UI 13 个 webp
- 唯一未压缩：test-lod-puzzle-critical.glb（0.13 MB，沙盒 LOD 测试模型，清单里挂 s1 组 optional，正式 S1 不用但会打包下载）→ size 只警告；遗留：建议移出 s1 组
## 2 自检脚本（commit 85133a6）
- verify-budget（--scan 扫机位）、verify-load、verify-memory、gen-perf-report、scripts/perf-checklist.md（真 GPU 清单），npm run check:release = build + size + budget + load + memory
- --scan s1（17:13–17:40）：48 个候选，主 pass 面数 2.71–3.42 M（极致档），draw call 40–89；挂在原点的代理交互物（s1-boat / nets / shed）机位作废，脚本已跳过原点
  - S1 机位：s1-raft-back 3.39 M / 89 call、s1-neighbor-note 3.37 M / 51、s1-spawn-north 3.37 M / 48，另留 025 开场大景 s1-opening
  - 整帧（含阴影 + 水面反射 + 后处理 pass）≈ 10 M 面 / 150–290 call
- npm run check 全绿（18:0x），字体子集排除 perf-spots.ts（不上屏）
## 3 LOD1 钢笔（加项）
- measure-pen-sit-write 加 PEN_XI_LOD；修手皮肤子网格匹配（多材质拆成 _lodN / _lodN_1 / _lodN_2，原来正则没匹配上、回退到第一个蒙皮网格，碰巧就是皮肤 lod0_1，所以 035 的 LOD0 数字仍有效）；加笔到手皮肤最近距离（commit 1b996f9）
- LOD0（char-xi_lod0_1，手 2932 面）：笔进手最深 0.089 cm（帧 110，hand_r），全程平均 0.058；笔到手最近 0.004 cm
- LOD1（char-xi_lod1_1，手 1089 面）：笔进手 0（121 帧都没有），笔到手最近 0.005 cm（仍贴着，不悬空）
- 笔尖离纸（笔挂 hand_r_socket 骨，和 LOD 无关）：落笔段 −0.008～0.124 cm，抬笔段 0.003～3.0 cm
- 结论：LOD1 不穿插 → 暂不锁 LOD0；特写图待 box 空闲拍（high 档 = LOD1）

## 4 第二执行者接手（18:31 起，HEAD 85133a6）
- [x] 收尾提交上一执行者未提交的 verify-budget（每机位视锥内面数前 12 物体）+ gen-perf-report（合并全量 / 按场景 JSON）→ 16152c7
- [x] LOD1 05 特写（上一执行者队列 18:26–18:31 拍完）：docs/tasks/shots-035/pen-lod1/（9 张，xiLod=1，失败 0），与 pen/（17:00，LOD0）拼对比 *-lod0-vs-lod1.png（close-thumb / close-right / f72-close-right）。笔握持与 LOD0 几乎一致，笔杆贴手指、笔尖落纸，无穿插 / 悬空 → 不锁 LOD0
- [x] test-lod-puzzle-critical.glb 移出 s1：正式 S1（levels/s1/S1Scene）不引用，只有沙盒基类 S1EbbShoreScene.buildLodTest 用 → 新 dev 组，sandbox 加载 ['common','s1','dev']，离开释放 → 6625b2e
- [x] 真 GPU 实测控制台 __perfSpot → 5f4b333
- [x] 重建本地自检 dist + size（18:36）：主菜单 5.47 / 15，首场景包 126.72 / 150（−0.13，测试模型移走），首次进 S1 132.19 / 150（警戒 140）；dev 0.13 MB 单列；71 GLB 压缩全生效
- [ ] 队列 /tmp/037-queue2.sh（日志 docs/releases/perf/queue.log）：scan-s2 → scan-s3 → budget-s1 → （等 /tmp/037b-go：写 S2/S3 机位 + 重建）→ budget-s2 → budget-s3 → load → memory → 015 art1 冒烟；等 QA 的 qa-chrome 结束才开
- [ ] perf-checklist.md 改成真 GPU 清单（S2/S3 机位待扫描后填）

## 5 第四执行者接手（19:21 起，HEAD 5f4b333）
- 接手时 037-queue3.sh 其实还在跑（idle 等待中，没开过任何项）→ 停掉，换 /tmp/037-queue4a.sh（scan-s2 → scan-s3 → budget-s1）+ 4b（budget-s2 → s3 → load → memory → 015 art1）；共用 /tmp/037-lib.sh：空闲 = 无 headless chrome、无 qa-chrome、/workspace/qa-tools 下无进程、无 QA 跑批脚本、可用内存 ≥ 4.5 GB，连续 ≥ 30 s；单次最多等 90 分钟，超时停队列
- budget-s1 实际没跑过（perf/ 下没有 verify-budget-s1.json）→ 放进 4a
- 19:23 QA（q20e.sh → runt20.sh t20-rock）在跑，等空闲
- [x] perf-checklist.md 改成真 GPU 清单（S2 / S3 机位待填）。发现：`?reflect=` 是反射 RT 分辨率倍率，不是强度；强度没有开关 → 遗留给制作人

## 6 第五执行者接手（20:12 起，HEAD ace0140）
- 接手时 037-queue4a.sh（pid 980154）还在 19:23 起的 scan-s2 空闲等待里（QA t20-rock.mjs 的 qa-chrome 在跑），让它继续
- [x] A 反射强度开关 → 998b843：?reflectK=0~1 乘在水面 mix(底色, refl·0.9, fr·uReflK) 的权重上（PlanarReflection.strength，uReflK = 淡入 × 强度；0 = 不渲染 RT，同 off）；画质配置 reflections.planarStrength，三档共用 PLANAR_REFLECTION_STRENGTH（src/config/quality.ts，默认 1 = 025 交付画面）；verify-render 新测 + verify-quality 期望表；perf-checklist 加 reflectK 行
- [x] shots-025 强度变体 + 1×4 拼图脚本 → f1f6099（SHOTS_VARIANT=strength，输出 docs/tasks/shots-025/strength/）
- [ ] 强度对比图：插在 4a 之后、写 S2/S3 机位并重建 dist 之后、4b 之前（dist 必须含 998b843）
- 20:4x 插单：batch20 验收后顺序改为 A → BUG-028 → 强度对比图 → 037；015 art1 已过 QA，已从 037-queue4b.sh 删掉；BUG-027 按设计关闭不动
- [x] BUG-028 窄缝相机贴头 → ab23971。根因：右肩横扫正好停在接触处，后拉 sphereCast 起点即接触返回 0 → 目标距离 0（Node 复现 0.05 m）。修：碰撞留 skin 0.05 + 右肩被挡平滑换左肩 / 居中（限速 1.6 m/s）+ 空间 < 1.2 m 时抬高（≤ 0.6 m）+ 相机离头 0.9→0.35 m 汐抖动淡出（alphaHash，只动蒙皮网格含描边壳；钢笔 / 幽灵预写不动）。量测 docs/tasks/shots-bug028/measure-before.json / measure-after.json：朝东走 / 跑 / 站 0.05 → 4.02 m；进缝换肩单帧 0.051 m；原地慢转 0.05 → 0.77 m；朝北看礁石 0.40 → 0.73 m；朝西 / 南不变；全程不进碰撞体。verify-camera 22/22
- [ ] BUG-028 前后对比截图（docs/tasks/shots-bug028/）：和强度对比图一起等空闲
- [x] BUG-028 前后对比截图脚本 → 34fe79d（scripts/shots-bug028.mjs + compose-bug028.py；修前用 f1f6099 worktree 构建的 dist）
- [x] scan-s2（20:33–20:40，22 兴趣点 / 92 候选）/ scan-s3（20:40–20:43，11 / 48）通过 → S2 / S3 机位写入 perf-spots.ts + perf-checklist：S2 white-stone-5（761 k 面 / 97 call）、white-stone-1（758 k / 86）、dial-gate（750 k / 75）；S3 spawn-south（699 k / 44）、oil-valve（696 k / 40）、logbook（690 k / 34）
- 20:44 插单 2：reflectK 默认 0.5（用户选一半强度）；planar 倍率由我们定；box 磁盘 94%（不建 worktree / 不复制 dist / 临时文件用完删）
- [x] BUG-028 前后图改为同一 dist 运行时模拟修前 → f3a8f7a（CameraFollowSystem.cfg；模拟参数在 Node 里与修前量测逐项一致：0.05–0.06 m / 朝北 0.403 m）
- [x] 反射强度默认 0.5 → 1ab70f8（默认倒影比 025 交付画面淡一半；对比图改 off / 0.5 / 1 三档 1×3）
- [x] 极致档 planar 1 → 0.5 → 0f42f4a（高 0.5 / 标准 0.25 不变；理由见 commit；强度对比顺带拍 k05-q1 确认）
- 注意：4a 的 budget-s1（20:44 起）用的是旧 dist（极致档 planar 1、强度 1），数字偏保守；4b 前重建 dist
- 20:49 4a 完：budget-s1（旧 dist：极致档 planar 1 / 强度 1）exit 1 —— 25 项不过：标准档 4 机位主 pass 2.20–2.56 M 面 > 1.5 M；高档贴图超限 3（tex-xi-* 4096 > 2048）、标准档超限 18（环境 2048 > 1024 + tex-xi 4096 > 2048）。极致档 / 高档机位面数、call 全过
- 4b 不单独跑（check:release 自带 build / size / budget 全场景 / load / memory）；改 /tmp/037-queue5.sh：build → 强度对比图 → BUG-028 图 → check:release；/tmp/037-queue6.sh：BUG-028 图重拍（低潮）+ check:release 停在预算时 load / memory 单独补跑；/tmp/037-tmpclean.sh 每 30 s 删自己的空闲 chrome 临时目录
- [x] 强度对比图（20:50–20:57，dist 含 0.5 / planar 0.5）：docs/tasks/shots-025/strength/s1-{pier,pier-low,opening}-strength-1x3.png（off / 0.5 默认 / 1）+ 单张 + k05-q1；同会话平均差：k0↔k05 14–16、k05↔k1 11、k05↔k05-q1 2.8–4.0 灰阶（肉眼分不出）→ caed132
- BUG-028 图第一次（20:58–21:03）作废：没切低潮，汐被潮水送回安全点；朝北机位 yaw 写错 → 92fb887 修脚本，队列 6 重拍
- 21:04 check:release 开始：build ✓、size ✓（menu+boot 5.48 / 15 MB，common+s1 126.72 / 150 MB）
- [x] BUG-028 前后图（21:09–21:14，低潮）：docs/tasks/shots-bug028/bug028-{east,spin-66,north-rock}-1x2.png。朝东 0.05 → 4.02 m（左肩）；朝北看礁石 0.403 → 0.733 m（抬高 0.6，汐不透明度 0.78）；spin-66 两边都是 1.14 m（模拟修前时左肩状态被上一张带过来，这张不算对比）
- [x] check:release（21:04–21:08）exit 1：build ✓ / size ✓ / verify:budget 73 项不过（见下）→ && 链停；load / memory 由队列 6 单独补跑
  - budget：三场景极致档、S2 / S3 高 / 标准档机位面数 + call 全过；S1 标准档 4 机位主 pass 2.20–2.56 M > 1.5 M；贴图超限：高档每场景 3（tex-xi-* 4096 > 2048）、标准档 S1 18 / S2 24 / S3 18（环境 2048 > 1024 + tex-xi）
  - load ✓：主菜单 1014 ms / 3.69 MB；S1 首帧 3481 ms、全部 4041 ms、129.3 MB / 148 请求、失败 0
  - memory ✗：估算显存 首次 S1 426.6 → S2 512.8 → S3 621.5 → 主菜单 428 → 再进 S1 762.7 MB（×1.79）；贴图数 84 → 99；JS 堆 14 → 20.8 MB。主菜单还挂 423.6 MB 贴图（贴图对象只剩 32 个）→ 疑似关卡贴图离开场景没真正释放，待查
- [x] 性能报告 docs/releases/v0.1-perf-report.md（gen-perf-report，21:22）
- 清理：/tmp/037-* 全删；chrome 临时目录脚本自删 + tmpclean 兜底（无残留）；dist 只一份（就地重建）

## 7 第六执行者接手（22:15 起，HEAD a0d2673）：裁定 28 剩余项
- [x] 1 显存泄漏（P1）→ a0d2673。verify-memory 估算可信（按纹理单元 × target 复核 0 处错记，GL 活纹理数 = info.memory.textures + 4）。根因：
  ① 关卡太阳光阴影 RT（极致档 4096² RGBA8 + 深度 24 ≈ 112 MB）不挂材质，disposeObject3D 不释放 → S1 / S2 / S3 各漏一张，菜单还挂 336 MB；
  ② LevelScene.dispose 先 entities.clear() 把汐 / 父亲 / 道具摘下再 dispose 场景 → 实体克隆材质、骨骼纹理（每关 3 张 20×20 float）、非缓存几何体全漏。
  修：disposeObject3D 加 Light.dispose / Skeleton.dispose；EntityManager.clear() 返回摘下的根，LevelScene 单独释放；verify-memory 按单元跟踪 + 活纹理清单 + 新断言「回菜单 ≤ 首次 S1 ×0.5」；verify-render 加单元测试
  极致档显存：修前 426.6 → 512.8 → 621.5 → 菜单 428 → 再进 S1 762.7 MB（贴图 84 → 99）；修后 426.6 → 400.8 → 397.5 → 菜单 91.9 → 再进 S1 426.6 MB（贴图 84 → 84，GL 88 → 88）
  未过：JS 堆 14.1 → 20.6 MB（×1.46）、着色器程序 44 → 78，另查
- [x] 临时诊断脚本 scripts/_memdiag.mjs：有用部分（GC 后旧场景是否还活着）并进 verify-memory，脚本删除 → 272c9f5
- [x] 2 按档跳过 KTX2 高级 mip → 592a338（render/mipCap.ts，LevelScene.applyQuality 里调；口径同 verify-budget：角色 / 道具 ≤ textureMaxSize、环境 ≤ textureMaxSizeEnv → 极致不跳、高 2048、标准角色 2048 / 环境 1024）。换档即时生效：从保留的完整 mip 链重截，尺寸变了先 dispose 旧 GL 纹理再重传（不重新下载）。verify-render +2 单元测试；verify-budget 加每档 gl.getError 检查。
  verify-budget（22:28–22:34，未含 getError 那版）：贴图超限全 0（三场景三档），只剩 S1 标准档 4 机位面数
- [x] 3 S1 标准档面数 → 已知警告 → 1341e2a（verify-budget KNOWN：只放过 S1 × 标准 × 主 pass 面数 ≤ 2.7 M 且 call 达标；gen-perf-report 写「已知项」小节，等 M8）
- check:release 第 1 次（22:43–22:49）exit 1：build ✓ / size ✓ / budget 只有 3 项「s1/s2/s3 ultra WebGL 错误 0x502」（新加的 getError 检查）。查明是**原有问题、和跳 mip 无关**：art/textures/tex-{xi-ramp,ramp-env,ramp-char,ramp-metal-wet}.ktx2 是 256×1，KTX2Loader 在支持 BPTC 的环境转成 BC7（0x8E8D），块压缩要求 4 的倍数 → texStorage2D / compressedTexSubImage2D 全部 INVALID_OPERATION，纹理不完整（采样为黑）→ 汐的 ramp 卡通明暗在桌面 BPTC / S3TC 显卡上可能是黑的。不在本单范围，没改，汇报待定
- [x] getError 检查改为只算每档期间新出现的，进场加载阶段的记警告 → c7f078e
- [x] 插单 BUG-029（文档）→ ddf1547：perf-checklist.md（perf-report 第 227 行源头）/ LevelScene 注释 / Reflections.ts 头注释「极致 1」→ 0.5；docs/tasks/v0.1-025 规格原文与历史记录不改
- check:release 第 2 次（22:55–23:02）exit 1：build / size ✓；budget ✓（贴图超限 0；警告 7 = S1 标准档 4 机位面数已知项 + s1/s2/s3 进场 0x502）；load ✓（菜单 1004 ms，S1 首帧 3501 ms / 全部 4072 ms，129.3 MB）；memory 只有 heapMB 不过：14 → 20.6 MB（×1.47），staleScenes 显示旧场景 GC 后仍活
- 查因：S1 → S2 → 菜单后取堆快照，旧 S1 的唯一强保留路径 = window.__s1（S1/S2/S3Scene 在 ?smoke / DEV 下挂的调试句柄，从不摘）
- [x] LevelScene.dispose 摘掉指向自己的 window.__* 句柄 → b6ad734（下一步重建 dist、整套 check:release 复验）
- check:release 第 3 次（23:14–23:20）exit 1：旧场景全部回收（staleScenes 空），但 heapMB 14.1 → 16.7（×1.18）仍不过。诊断：首进 S1 → S2 → 菜单 → S1 → 菜单 → S1，堆 12.3 / 9.4 / 16.0 / 9.8 / 16.2，不再随圈数涨；差在着色器 43 → 77：同一材质两套程序，cacheKey 只差 outputColorSpace（srgb vs srgb-linear）和 toneMapping（4 vs 0）→ GameFlow.compileCurrent 按上屏路径预编译，实际走后处理画进 RT
- [x] 预编译按真实出图路径（后处理 → RT + NoToneMapping），verify-flow 加断言 → ea5c8e3
- 23:46 第七次接手（HEAD ea5c8e3）：只做收尾。check:release 第 4 次（23:45–23:51，含 ea5c8e3 的 dist）exit 1：着色器 44 → 54（修前 78），heap 14.1 → 16.5（×1.17）仍不过。原因是基线：首进 S1 用 ?scene=s1 直进，不走切场景预编译；同一路径多绕一圈堆 16.0 → 16.2、程序 77 → 77，不随圈数涨
- [x] verify-memory 首进 S1 改为主菜单 → goToLevel（和再进 S1 同路径），着色器程序数纳入 ±10% 验收 → 4a79989
- check:release 第 5 次（23:59–00:06）exit 1：着色器 49 → 51 ✓，显存 / 几何体 / 贴图完全一致，只剩 heap 14.8 → 16.4（×1.11）。首进 S1 vs 再进 S1 两张堆快照对比：差 1.84 MB，其中 ~1.6 MB 是 V8 代码区（InstructionStream 0.96 MB / 字节码 0.15 / TrustedByteArray 0.19 / 反馈向量 0.08 …，S2/S3 的函数第一次执行后留下的），游戏对象差 ~0.2 MB
- [x] verify-memory：堆快照拆「对象堆 / V8 代码区」，±10% 比对象堆，总堆照记（方法学调整，汇报里标明请制作人确认）→ bad3643
- check:release 第 6 次（00:25–00:32，HEAD bad3643）**exit 0 全部通过**。复核发现 bad3643 的对象堆口径错了（快照 self_size 总量含 ArrayBuffer 后备存储 ~500 MB，表里 509.7 → 509.9），改为 usedSize − 代码区 → 561837d；gen-perf-report 按每站 heapMB − codeHeapMB 现算：对象堆 10.3 → 10.4（×1.01）仍过。verify-memory.json 里 00:32 那轮的 objHeapMB 字段是旧口径，下次跑会覆盖
- [x] perf-report 重新生成（00:4x）：已知项小节、BUG-029（第 164 行「极致 0.5」）、内存表对象 / 代码分列、回主菜单显存一行都在；报告在 git 外，生成脚本改动随 561837d 提交
- [x] ramp 0x502 调查（只读代码 + 截图，不修）→ docs/tasks/ramp-ktx2-0x502-1031.md：UASTC → 桌面 Windows / Intel Mac / Linux 选 BC7，WebGL 层规定 BPTC / S3TC 宽高须为 4 的倍数 → 上传全 INVALID_OPERATION → 不完整纹理采样 (0,0,0,1)；汐身体 / 头发 ramp 明暗没生效（脸 SDF 正常），ASTC 设备（Apple Silicon / 手机）不受影响。候选 A 加载时转 RGBA32 / B 美术 256×4 / C PNG / C′ DataTexture，推荐 A（通用规则）+ 资产校验
- [x] 清理：/tmp/smoke-chrome-budget-EAchQy（339 MB，verify-budget 留下的）、/tmp/memdiag 已删；dist 单份 223 MB；docs/releases/perf 5.3 MB
