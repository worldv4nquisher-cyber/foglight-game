# progress-1031-r4：裁定 25（A 父亲幽灵深度预写 / B 04 镜头关玻璃反射 / 体积警戒线 + 8 个未登记文件）+ 汐 r4 接入（第 1–8 项）

起点 HEAD 1d5405b（10-31 09:03 UTC+7 接手）。美术 r4 已正式交付到 art/，构建 / 验证在主仓库（/workspace/scratch/r3/game 留给制作人验 035，不动）。
09:04 收到裁定 25：先 A、B，再体积 / 登记，再 r4 1–8。（r4 第 1 项只做了只读核对，没有改动，无需暂存。）

## 裁定 25
- [x] A 父亲幽灵材质深度预写（colorWrite=false 先写深度，再画半透明；淡出正常）
- [x] B 04「那边没有亮。」镜头期间关灯室玻璃反射（按 cue，不影响别的镜头）
- [x] B' 重拍 shots-035 03 / 04 前后对比
- [x] B'' 035 full 冒烟（5 项第一轮 4 过；「结尾曲晚到」对齐后漂移 10.6 ms > 2 ms，box 负载下帧断档（同轮 father_out 上一帧 41.38 → 45.13 s），单跑重跑通过）
- [x] 体积：size 内部警戒线 140 MB（硬上限 150 不变）；8 个未登记文件登记接入

## 汐 r4
- [x] 1 核对文件 / LOD / 骨骼 / 材质；manifest / 代码适配
- [x] 2 verify-father 假负核对
- [x] 3 035 摸头对位复核
- [x] 4 头发 023 外扩描边（873713f + 0dc409c）
- [x] 5 马尾穿兜帽逐 clip 实测（d628d5f）
- [x] 6 肤色对比图（c5d2b9d）+ SDF θ 竖直光（0852f7f）
- [x] 7 截图 shots-r4
- [x] 8 冒烟 + check + size（fe19ab7；补丁 a8cdf05 / 4a8629b）

## 记录
- r4 只读核对（09:04）：char-xi.glb 2,094,040 B、LOD0/1/2 = 119,846 / 48,499 / 24,299、3 个 skin 各 73 骨；材质 body / face / hair 三个都在（r3 也是这三个名字，顺序 r3 body/hair/face → r4 body/face/hair）；hair 蒙皮骨 9 → 12（更正：马尾 hair_ponytail_01–03 r3 就有；r4 新增的是 chest / hood_01 / hood_02 权重——马尾尾段跟兜帽走）。耳朵从 face 挪到 body：face 头部半宽 0.081 → 0.071 m、body 0.036 → 0.080 m。

### A — b0fa2cd
- render/ghost.ts：每个网格加一个同几何 / 同骨骼的子网格做深度预写（材质克隆、colorWrite=false、depthWrite=true、transparent 排进透明队列、renderOrder 10），颜色 pass renderOrder 11、depthWrite=false、LessEqual；同一个 shader program（onBeforeCompile / cacheKey 一并带过去），深度逐位一致。opacity ≤ 0.004 关掉预写（淡入前 / 淡出后不挡后面）。
- 对比：docs/tasks/shots-035/s3-ending-03-father-hand-before.png（改前：帽子里的光头、斗篷内层、手臂都透出）→ s3-ending-03-father-hand.png（改后：帽子 / 斗篷是一层，透出的是背景）。

### B — de5b4d1（+ 393f6f9 截图工具）
- render/specularGate.ts：材质在 aomap_fragment 后把 directSpecular / indirectSpecular 乘 uSpecGate（uniform，切换不重编译）；灯室玻璃 = env-lighthouse-ch1-s3 的 mat-env-lighthouse-weather（12 面灯笼玻璃，和风化贴花共用材质）。
- 时间窗：GLASS_REFLECTION_OFF = [regaze 42 s, sitWrite 58 s)，两头都是剪辑点，镜头内不跳；no_answer 50 s 在里面；跳过 / 结束恢复 1。
- 对比：s3-ending-04-no-answer-before.png（玻璃上三个太阳亮斑）→ s3-ending-04-no-answer.png（亮斑没了，远处的塔「没有亮」读得出来）。r3 原图另存 *-r3orig.png。
- 副作用：同材质的塔身风化贴花在 04 镜头里也没高光（镜头里看不到塔身外墙）。

### 体积 — e171162
- check-size 加 WARN.firstTotalMB = 140（只警告）；8 个文件登记：tex-beam-noise / tex-beam-spot / tex-glow-lighthouse / tex-water-foam / tex-ramp-char / tex-ramp-env / tex-ramp-metal-wet（common）、tex-lighthouse-whitewash（s1）。都还没有代码消费（灯束 / 025 / 023 / 父亲 ramp 接的时候用）。
- size：首场景包 127.51 / 150 MB，首次进入 S1 总下载 132.94 MB（超旧线 132.5，低于新警戒线 140）。

### 1 — f568927
- test:xi 加 r4 结构断言（三个 primitive、头发 12 骨含 hood_01/02、脸只绑 head/neck、耳朵在 body）。代码按材质名匹配，primitive 顺序变化无影响，manifest 不用改。

### 2 — 5d76ec0
- 整帧 81：核对前 palm −1.42 cm @112 / thumb −5.03 @130 → 核对后 palm −0.27 @112 / thumb −0.06 @83；有缝 0/81；假负帧 36/81；穿头皮 0/81。
- 半帧 161：核对前 palm −1.54 @71.5 / thumb −5.14 @131.5 → 核对后 palm −0.30 @78.5 / thumb −0.06 @83；有缝 0/161；假负帧 80/161；穿头皮 0/161。
- 美术工具同口径：核对后 palm −0.27 @112、thumb −0.06 @83、半帧 palm −0.30 @78.5，一致；核对前数（游戏 −1.42 / −5.03，美术 −0.27 / −4.93）不完全一样，按面法线定符号本来就不稳。

### 3 — bb0c66f
- 新 scripts/verify-hoh-035.mjs（并进 test:father）：掌心到发顶 handOn–handOff 最大 5.2 cm（和独立摆位一致，后退不影响相对对位）。
- 新发现：父亲根 r 2.83、灯室内壁 r ≈ 3.00；大衣下摆（coat_back_01，离地 0.75–0.78 m）整段压进矮墙压顶 3.4–3.9 cm；帧 ~160 放手时右上臂压进窗框横档 5.9 cm。都在父亲身后，035 机位看不到。要完全不碰得 GAZE_BACKOFF ≈ 0.28 m（会动 03/04 构图，交制作人）。

### C — 3c4a635（035 美术修复接入，制作人已确认）
- ① 日志 / 风灯 socket y 22.75 → 22.68（GLB lamp-room-journal-socket = [1.8385, 22.68, −1.8385]）；结尾镜头目标运行时读 GLB 节点（S3Scene.artPoint，世界 → 场景局部），layout 只做后备，verify-s3 校验 layout 与 GLB extras 一致。
- ② 白盒椅面 0.40、桌面 0.68（layout.lampRoom.seatTop / deskTop，与 lamp-room-sit-write extras、xi-sit-write align 同值）。
- ③ S3_TOWER_CLOSED_LM ×0.6 不再作用于灯室（灯室在 22 m 高、2.3 m 通高玻璃，塔门关不关和它的采光无关；只留塔身内部 env-lighthouse-ch1-interior）。06 镜头里灯室下半墙不再发黑（batch17 已知项「灯室下半墙偏暗」随之改善）。
- ④ 外圈栏杆反法线：只报告未改（见汇报）。04 镜头里玻璃外的扶手读作一条偏暗的木条，不刺眼。
- ⑤ 重拍 04–07（10:52 前后，r4 WIP 已 stash，干净构建）：对比图 shots-035/s3-ending-0{4,5,6,7}-*-C-compare.png（左 preC / 右 C）。05 over-shoulder：机位不变、日志下移 7 cm、汐坐低 5 cm，镜头被汐背部占满大半，日志只露右侧一角 → 交美术 / 制作人（05 重做不在本轮）。
- ⑥ size：首次进入 S1 总下载 132.30 MB（< 140 警戒线，< 150）。

### D1 — 366fbd4（BUG-025）
- switchMusic 有 buffer 时传 fadeIn = crossfade：没有上一首（结尾曲放完 / 跳过停掉后回主菜单、boot 第一首）从 0 淡入 2 s；有上一首照旧 2 s 交叉淡化。test:audio 加断言（set 0 → ramp 到曲目增益 @+2 s，musicLog fade 2）。
- 注：boot 后第一首菜单曲也从「直接满音量」变成 2 s 淡入——违反冒烟 033 约定，已由 a8cdf05 收回（见第 8 项）。

### D3 — 3a37550
- 「结尾曲晚到」：offset 和起播时刻改成同一次 ctx.currentTime 读数（playMusic 新增 opts.at，endingMusic 传入）。容差 1e-6 不放宽；单测模拟每次读数走 512 采样，改前报 offset 14.368 ≠ 14.464 − 0.085，改后通过。

### D4 — a91ff8d
- e171162 已有 140 警告；本项把判定抽成 lib/size-groups.mjs sizeVerdict（≤140 通过、140–150 只警告、>150 报错退出 1），verify-assets 加边界单测（132.41 / 140 / 140.01 / 150 / 150.01 / 菜单 15.5）。

### D2 — 6d908bf（P2：直进 S3 时 menu 组可选资源间歇 missing）
- 复现（scripts/probe-d2.mjs，每轮新 profile 冷启动 `?smoke=1&debug=1&art=1&scene=s3`，不加 --disable-extensions，同 QA）：改前 3/10 次 menu 组缺失——#7 sfx-ui-back/confirm/journal + mus-menu（TypeError: Failed to fetch），#9 8 张 UI 图、#10 ui-icon-app-512 + ui-illust-loading（EncodingError: The source image cannot be decoded）。三次都对应导航后 0.58–0.85 s 一批 net::ERR_ABORTED（canceled），与 BUG-008 / BUG-012 同源（托管策略往新 profile 强装扩展时掐掉在飞的子资源请求）。数据：docs/tasks/d2/before.json。
- 根因：字体 / GLB / KTX2 / 图片 fetch 都已经有重试，漏了两步——① 组加载音频走 THREE.AudioLoader，没有重试；② UI 图片 fetch（有重试，所以 QA 看到 200）之后的 `<img>.decode()` 会再发一次请求，这次被掐就报 EncodingError，而它在重试外面。失败记 missing 后整局不再请求，回主菜单就没有菜单曲。不是竞态 / 超时 / 缓存键 / 懒加载提前写 missing / 组被取消。
- 修：loadAudioWithRetry（组加载 + 懒加载音频）、loadImageWithRetry（fetch + decode 一起重试，decode 失败标 retryable；真坏图 1+2 次后照样失败，404 不重试）。AssetLoader 加 loadFailures（key / url / 错误）诊断。
- 验证：确定性注入（CDP Fetch.failRequest Aborted：4 个音频第 1 次请求、7 张图第 2 次请求）改前 3/3 次 11 项全 missing（inject-before.json），改后 10/10 次 0 missing（inject-after.json）；自然冷启动改后 12/12 次 0 missing（其中 1 次自然取消 4 张图，重试后都在）（after.json）。
- 是否只在负载下：不是。触发源是冷启动取消（和负载无关）；负载只是让 menu 组下载拖得更长、更容易和那批取消重叠（改前 load ≈ 9 时 3/10；改后 load ≈ 3 时自然取消只碰到 1/12 次）。玩家机器上没有那条托管策略，但任何网络层取消都会走同一条路径，修了是对的。

### 5 — d628d5f 马尾穿插表（scripts/measure-ponytail-hood.mjs）
- 口径：马尾 = hair 顶点 hair_ponytail_01–03 权重 ≥ 0.5（862 个）；兜帽 = body 三角形三顶点 hood 权重都 ≥ 0.3（2200 面）；30 fps；从颈–头轴打 DoubleSide 射线，压进 > 2 mm 计穿插帧。
- 最深（cm @帧，穿插帧/总帧）：look-up 2.16 @46 88/151；pickup 2.07 @20 13/78；place 0.95 @22 7/71；push-end 1.67 @7 13/37；push-loop 1.63 @25 37/37；push-start 2.13 @28 17/37；row-boat 2.23 @88 33/91；tie-boat 1.57 @22 116/166；valve-hold 1.78 @14 75/91；ring-bell 0.88 @22 6/61（美术清单外）；shiver 0.18（低于 2 mm）；其余 0。美术点名的 walk / idle / stand-gaze 无穿插（最小余量 2.5 / 1.86 / 1.41 cm）。
- 与美术 1.5–1.9 cm 对比：look-up / pickup / push-start / row-boat 偏深（2.1–2.2），place 偏浅（0.95）。

### 035 全套冒烟（D1–D4 后的 dist，10:05–10:12，load ≈ 9–10）
- 结尾演出 ✓（11 cue 全按音频时钟，106.72 s 收、0.80 s 后切结束页）；结尾曲晚到 ✓（D3：曲子 0 s 时刻 = 点燃，差 −8.9e−16；切换帧对齐、之后 5 帧 |t − 曲子位置| = 0）；后备时钟 ✓；结尾曲下载失败 ✓；sit_write cue 58.91 s 镜头 over-shoulder、汐 xi-sit-write ✓。
- 跳过：前两次 ✗「按住期间右下角圆环没显示过」，第三次 ✓。给钩子加了帧数 / 最长帧间隔诊断：通过那次从按下到跳过墙钟 3.64 s（按住 1 s 的跳过要等下一帧才落地）——软件渲染 + load 10 下一帧 > 1 s 时，按下到跳过之间没有一帧「圆环可见」的 UI 更新（跳过那帧 skip.update 先结束、hint 已不可见）。mid 检查（0.5 s 时控制器 hintVisible = true、进度 0.5）三次都过，说明逻辑没坏，是负载下的帧采样问题，与 D1–D4 改动无关（未碰 SkipController / SkipHint）。

### 4 — 873713f（汐外扩描边 OutlineHull）
- 壳走 MeshLambert（BackSide）受场景同一套光：首拍（09:25，无光照「固有色 × 0.4」）在阴天 S1 下比表面还亮、成浅色光晕，改 Lambert 后重拍（10:12–10:18，干净构建，hull / ?hull=0 各 4 张，0 失败、0 页面报错）：shots-r4/s1-xi-{face-front,face-side,face-back,ear-l}-{hull,nohull}.png，拼图 shots-r4/xi-hull-lambert-compare.png（左 nohull / 右 hull）。
- 观感：头发外轮廓对着亮天多一圈偏暗边、无浅色光晕；脸部边缘 1.5 px 几乎看不出；背面马尾 / 兜帽轮廓更清楚；左耳无破面。
- 035 跳过冒烟的帧数诊断（smoke-browser 钩子）留到第 8 项冒烟 commit 一起提交。

### 6 — c5d2b9d（肤色对比开关，默认不变）
- `?xiShadow=warm`：汐暗部 XI_SHADOW_TINT [0.30, 0.34, 0.42] → XI_SHADOW_TINT_WARM [0.42, 0.33, 0.29]（Rec.709 亮度 0.337 / 0.346）。`?lutKeepSat=0.5`：LUT 输出保留亮度，色度往 LUT 前拉回 50%（整帧生效，不只是皮肤）。
- 四张（10:19–10:24，S1 涨潮正脸，hull 开，0 失败）：shots-r4/skin/s1-xi-face-front-{cur,warm,lut,both}.png，拼图 shots-r4/skin/xi-skin-4way.png（左上 cur / 右上 warm / 左下 lut / 右下 both）。
- 观感：warm 暗半边从灰紫变成暖褐，像皮肤；lut 0.5 对脸几乎看不出（脸区平均饱和度 49.5 → 53.8），反而整帧天 / 海略偏色；both ≈ warm。
- 建议：只考虑 warm，lutKeepSat 不建议（收益小、动全帧）；但 warm 和 style-guide「暗部冷色，不偏暖」冲突（verify-xi 现有断言），要制作人 + 美术定，定了再改默认和断言。

### 7（SDF）— 0852f7f
- 原因：θ 只看光的水平方位、不管仰角；光接近竖直（灯室顶灯 / 风灯在头顶）时脸挪几厘米方位就转半圈，θ 在 0 / 2 之间跳、u 也翻，逐片元方向不一致时成块花脸。
- 修：θ' = θ·smoothstep(0.1, 0.35, h)，h = 光的水平分量 = cos 仰角；仰角 ≤ 69.5° 完全不变，≥ 84.3° 按正上方（全亮）。JS（xiFaceSdfParams）和 GLSL 同式；verify-xi 加 89.9° / 87° / 65° / 60→90° 连续性断言（每 0.25° 最大跳 < 0.06）。

### 7 — 头部截图（10:12–10:27）
- 正 / 侧 / 背 / 左耳：shots-r4/s1-xi-{face-front,face-side,face-back,ear-l}-hull.png；035 摸头帧：shots-r4/s3-ending-03-father-hand.png（t 39.74，父亲 hand 第 112 帧——负载下比目标 38.67 / 第 80 帧晚约 1 s）。
- 对照：shots-r4/xi-head-r4-vs-r3-compare.png（上 = shots-031/xi-head-r3-compare.png 原图，下 = r4 五张 + 旧 035-03）；shots-r4/s3-ending-03-father-hand-r4-compare.png（左旧 / 右 r4）、s3-ending-03-head-zoom-r3-vs-r4.png（头部放大）。
- 观感：S1 阴天正脸 SDF 明暗交界干净、无花脸；035-03 暖光下脸颊亮面完整。问题：① 描边在头发卡片内部也画出几条细暗线（卡片边缘的背面壳透出来），035-03 暖光下比 S1 明显；② 兜帽领口一圈描边有锯齿状暗线；③ 灯室下半墙比旧图亮（C③ 的效果）。①② 交美术判断是否接受 / 头发卡片是否要单独关描边。

### 8 — fe19ab7（回归）+ 两个补丁 a8cdf05 / 4a8629b / 0dc409c
- 冒烟（SMOKE_ONLY 逐项、后台、一次一个浏览器，10:26–10:39）：010 ✓；015 白盒 + 谜题 5（art=1）✓；017 汐模型（材质 / shader 链接，含描边）✓；035 五项全 ✓（跳过这次 ✓，圆环最大 0.68）；033 第一次 ✗「主菜单第一首不应淡入」——D1 把 boot 第一首也改成淡入了，违反 033 约定 → a8cdf05 只对「这局放过曲子后没有上一首」淡入（结束页回主菜单），boot 第一首照旧 fade 0；重建后 033 ✓、035 跳过 ✓、010 ✓。
- test:father ✓（父亲压进灯室内壁 5.9 cm，容忍 6.5 cm；要完全不碰需 GAZE_BACKOFF ≈ 0.28 m → 制作人定）。
- npm run check：第一次 lint ✗（D3 单测 setter 返回值 → 4a8629b）、test:text ✗（OutlineHull 诊断名写了中文 → 0dc409c）；修后 EXIT 0。
- 体积：menu 5.44 / 15，首场景包 126.86 / 150，首次进入 S1 132.30 MB（< 140 警戒线）。
- Chrome 临时目录（smoke-chrome-* / shots031-chrome-* / probe-d2-chrome-*）都已清掉；/workspace/scratch/r3/game 没动。
