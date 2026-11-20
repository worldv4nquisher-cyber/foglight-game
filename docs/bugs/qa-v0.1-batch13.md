# QA v0.1 batch13 — master 03130cc（a3a2a04 之后 14 个提交）

- 快照：/workspace/qa-tools/snap-03130cc（`git archive 03130cc`；art / docs 软链到工作区；node_modules 硬链 snap-a3a2a04，package-lock 和 a3a2a04 一致）。
- 方法：无头 Chrome（SwiftShader 软件渲染），冒烟一条一条跑，按固定步 / 游戏时间判定，不判 fps。每查完一项就追加到这里。
- 已知问题（只记录，不报新 bug）：S3 塔东侧礁石高出地板 0.3 m 埋住脚和前两级台阶（美术在重做）；S2 崖顶光照贴图约 4 % UV 越界，靠边缘钳制处理；水面偏暗等 025 反射。

## 批次小结（20:40 UTC+7）
| 项 | 结果 |
|---|---|
| ① check（typecheck/lint 0/0/test 333✓/build/size/css） | PASS |
| ① 包体 125.43 / 128.34 MB（上限 150）、menu 2.91 MB、lightmap 12.40 MB（预算 40） | PASS |
| 029 lightmap S1 / S2 / S3 lm on-off 对照程序 38 张 | PASS / PASS / PASS |
| 雨夜 ×0.35（S2 地窖 0.1925、S3 门关塔内 0.21） | PASS |
| S2 地窖门、S3 塔门压暗渐变无 pop | PASS / PASS |
| ② S2 院墙法线 / UV / 5 socket | PASS |
| ③ 地窖钥匙点光（0.15、#C4D2DE、0.22 m、只在地窖亮、拿走就关）+ 入口闪光截图 | PASS |
| ③ 两把铜钥匙描边 + E 拿钥匙 | PASS |
| ④ f3d604e 三面导光镜高亮（a / b / 窗口） | PASS |
| ⑤ BUG-018 | PASS → 已关 |
| ⑥ BUG-019：进带 ≤0.25 ✓，整段 ≤0.6 ✗（2.63 m 一帧，0.60–0.90 恢复） | FAIL → 不关（部分修复） |
| ⑦ 冒烟 010 / 013 / 014a0 / 014a1 / 014p2 / 015a / 015b / 017s13 / 017s2 / 019（A=3 B=0）/ 021/022 | 全部 PASS（014a1、017s2 首轮是负载超时，单独重跑通过） |
| ⑧ 补拍：打开的日志 / 纸条 a / 墙镜 a、b 近景 | PASS |
| ⑧ 补拍：低潮脚印贴花 | PASS（很淡，部分被礁石遮住，交真机看） |
| ⑧ 补拍：窗口镜近景 | 未验证（取景问题） |
| 新 bug | BUG-020（低）：室内（S2 地窖、S3 塔内）有雨丝 |
| 截图 | cmp/s2-cellar.jpg（lm 开/关）、cmp/s2-cellarentry-lm1-boost.jpg（钥匙闪光）、key-hl-fb.png、mirror-hl-window-lowtide.png |


## ① typecheck / lint / test / build / size / css（`npm run check` 一次跑完，日志 qa-v0.1-batch13/b13-check.log）
- `npm run check` **EXIT 0**：typecheck ✓ → lint ✓（eslint 没有任何输出：0 error、0 warning）→ npm test ✓（333 个 ✓、0 个 ✗；含新的 test:lightmap）→ build ✓ → size ✓ → css ✓。
- **BUG-018 回归 PASS** → 关闭（见 BUG-018.md）。
- 包体（check-size）：
  | 包 | 实测 | 上限 | 程序报 |
  |---|---|---|---|
  | menu+boot | 2.91 MB | 15 | — |
  | common+s1 | **125.43 MB** | 150 | 125.43 ✓ |
  | 首次进 S1 总下载 | **128.34 MB** | 150 | 128.34 ✓ |
  | common / s1 / s2 / s3 | 33.80 / 91.63 / 59.98 / 20.52 MB | — | — |
  另有 8 个已交付未登记文件（s1 0.81 MB），全接入后预计 126.24 / 129.14 MB。
- **光照贴图总量**：9 张 KTX2（UASTC、线性、2048²、完整 mip），art/textures 和 dist 里都是 12,403,001 B = **12.40 MB**（预算 40 MB）✓。
- verify-camera 新断言「BUG-019 走入 / 侧入 / 退出逐帧连续」✓：进带单帧最大 0.155 / 0.178 m（走 / 跑沿视线），侧入 0.156 / 0.179 m，退出 0.533 / 0.554 m——和程序报的 0.179 / 0.554 一致（这是 Node 单测，浏览器复测见 ⑥）。

## ② S2 新院墙 env-courtyard-wall-s2.glb（Node + three GLTFLoader + meshopt 解码；脚本 snap/game/scripts/qa-wall13.mjs，原始数据 qa-v0.1-batch13/wall13.json）
新文件 md5 545aa547（13:00，a3a2a04 起就是这一份）。对照：029 前版本 e6551268（snap-cd22761 dist，有 5 个 socket）、更早 357f3f26（snap-92c7c96，只有 3 个 socket）。
| 网格 | 三角形 | 法线反向 %（面法线 · 三顶点法线和 < 0） | 退化三角形 | 法线 NaN / 非单位 | uv1（光照贴图）范围 |
|---|---|---|---|---|---|
| lod0 新 | 58356 | **0.00%** | 8 | 0 / 0 | u 0.563–0.999，v 0.001–0.435 |
| lod1 新 | 29178 | **0.02%** | 0 | 0 / 0 | 同上 |
| lod2 新 | 14588 | **0.05%** | 0 | 0 / 0 | 同上 |
| lod0 / 1 / 2 旧（e6551268） | 同 | 32.66% / 17.44% / 4.96% | 0 | 0 / 0 | 0.002–0.998（整张，029 前） |
- 新版法线反向从 32.7% 降到 0.00–0.05%（LOD 简化后少量细长三角，可忽略）✓；uv1 全部在 verify-lightmap 需求单的 rect [0.5625, 0, 0.4375, 0.4375] 里，无 NaN ✓；uv0 和旧版完全一样（−7.67…8.74，平铺贴图，正常）。包围盒与旧版一致（差 ≤ 1 mm）。碰撞网格 -collider 96 三角、无法线（碰撞用，正常）。
- **5 个 socket**（lamp-east / lamp-west / gate / mirror-a / mirror-b）与 e6551268 比：位置差 0 m、角度差 0°；前 3 个与更早的 357f3f26 也是 0 差。verify-lightmap「院墙修复：5 个 socket 与修复前一致」也 ✓。
- **结论：PASS。**（只做数据检查；院墙的实际画面见 ③ 的 S2 court 截图）

## ③-a 029 光照贴图：S1 对比（qa-shots-029.mjs = 程序 shots-029 的副本、输出改到 qa-v0.1-batch13/shots-029/；dist preview，`?smoke=1&art=1&quality=high`，1600×900）
- 5 个机位 × lm0/lm1 全部拍完（EXIT 0）。lm1 挂上 7 个 S1 GLB（tidal-flat / pier / shore-ledge / cliff / fish-shed / net-rack-a/b，倍率 ×1.00）；lm0（`?lightmap=0`）不挂。hemi 1.6。
- 和程序 38 张里的 S1 10 张逐像素比（cmp029.py，0–255 平均绝对差）：
  | 机位 | 本次 lm1 vs lm0 | 程序 lm1 vs lm0 | 本次 vs 程序（lm1 / lm0） | 纯黑像素 lm1 |
  |---|---|---|---|---|
  | opening | 4.16 | 4.17 | 3.98 / 3.98 | 0.3% |
  | cliff | 3.84 | 4.24 | 1.25 / 1.70 | 3.5% |
  | ledge | 3.63 | 3.77 | 2.22 / 2.44 | 0.4% |
  | pier | 4.05 | 4.69 | 3.16 / 4.01 | 8.2%（码头下暗水，已知） |
  | shed | 3.89 | 3.89 | 2.39 / 2.45 | 3.5% |
  本次与程序的差 ≈ lm0 自身的差（雨丝 / 颗粒噪声），说明画面一致；没有全白 / 爆亮像素。目视（5 张 4 宫格都看过：上 = 本次 lm0 | lm1，下 = 程序 lm0 | lm1；qa-v0.1-batch13/cmp/s1-*.jpg）：S1 室外开灯后岩石、棚屋背光面暗部加深、接触阴影更实，无接缝、无黑块、无 UV 错位；与程序截图看不出差别。→ **S1 PASS**

## ③-b 地窖门角 → 地窖光照贴图倍率 / ③-c 地窖钥匙点光、高亮（t13-cellar.mjs，S2 art=1 standard，原始数据 qa-v0.1-batch13/cellar-lh.json）
- **门角压暗**：进场门关，env-cellar-s2 倍率 0.55（两个材质 lightMapIntensity 0.55），屋内 / 院墙 / 崖顶 ×1.00 不受影响 ✓。触发开锁（`receiver:activated` 锁 id）后按 fixed tick 采样 110 tick：0.55 → 1.00 单调上升，每 tick 最大变化 **0.012**（60 Hz）；实际渲染帧上倍率与 `doorLightmapScale(doorOpen, 0.55)` 偏差 ≤ 1e-5。无台阶跳变 → **无 pop，PASS**（无头浏览器一帧跑 5 tick，单帧变化 0.06 只是采样粗；按 tick 看是连续的）。
  - 说明：游戏里两扇门都只会"开"、不会再关，所以只能测"关 → 开"这一个方向。
- **点光参数**：名字 s2-cellar-key-light，颜色 **#c4d2de**，distance **0.22**，decay 2，不投影，visible 一直为 true（用 intensity 0 来关）。挂在 env-cellar-s2-key-socket 下，在 socket 正上方 0.150 m。地窖里满亮时 intensity = **0.15** ✓。
- **只在地窖里亮**：地窖外（出生点、楼梯顶 y 0）时为 0；下到地窖底 4 个位置（离钥匙 1.0–3.2 m）都是 0.15。进出有淡入 / 淡出（中间值 0.094 / 0.106 / 0.056，约 10 tick，不是瞬开瞬关）✓。
- **拿走就关**：hasKey 置位的那个 tick 还是 0.15（点光在 update 里刷），下一帧变 0，之后一直是 0；钥匙挂到 middle_03_r（手上）✓。
- **走近描边**（prop-key-lighthouse，优先用的那把）：地窖外为 false；进地窖后为 true（地窖最远点到钥匙也只有 3.0–3.2 m，小于图标距离 3.5 m，所以在地窖里基本一直亮）；出地窖后为 false；拿走后为 false ✓。
- 观察（不是 bug）：传送到钥匙站位后，相机还是原来的朝向，屏幕中心离草图更近，按 E 读到的是草图（ch1.s2.sketch.doc）。交互对象是按"离屏幕中心最近"来选的，属于设计，不是 bug；相机对准钥匙后的复测见 ③-d。

## ③-e S3 塔门 lightmap 随门角 — PASS
- 数据：qa-v0.1-batch13/s3-door-mirror.json（emit interact:used doorIx，逐 tick 采样）
- env-lighthouse-ch1-interior 0.6 → 1.0，共 111 tick（开门中 83 tick），每 tick 最大增量 0.0107；与 `closed+(1-closed)·smoothstep(open)` 最大偏差 1e-5；单调不减 ✓
- env-lamp-room-ch1 全程与 interior 相同 ✓；外景 lightmap 恒为 1 ✓
- 渲染帧最大步长 0.053（这一帧里跑了 5 个 tick，是负载下的掉帧，按固定步长算不跳变）→ 无 pop

## ④ f3d604e S3 三面导光镜高亮 — A/B PASS，窗口镜待复测
- 镜 A：传送到站位 → mirrorHighlighted.a=true，highlighter keys=[key:guide-mirror-s3-mid-a]，3 个 shell，current=guide-mirror-s3-mid-a ✓（截图 mirror-hl-a.png）
- 镜 B：同上，key:guide-mirror-s3-mid-b，3 个 shell ✓（mirror-hl-b.png）
- 窗口镜：传送到 standPoint 后落在世界 (40.33, 2.4, -116.95)，mirrorIx.window.enabled=false → 不亮。代码规则是 |局部 y − groundFloorY(0.2)| < 0.6 才开放，2.4 m 不在塔底层。这是测试站位的问题还是 standPoint 本身不对，正在诊断（见 ④-b）。

## ⑦ 回归冒烟（逐项串行，日志在 /workspace/qa-tools/logs/q13-*.log）
- 019 sample-317：EXIT 0，「A 簇 3 个（接受）、B 簇 0 个 ✓」— PASS
- 010 场景流程（boot+menu → S1 → S2 → S3 → 结束页、黑场、存档、释放）：EXIT 0 — PASS（2 条警告，首条是 SwiftShader 不支持 KHR_parallel_shader_compile，环境问题）
- 013 S1 白盒 + 谜题 1/2（art=1）：EXIT 0 — PASS（跨越落点离沿 0.32 m ×4，GLB/KTX2 103 个无失败无占位）

### ④-b 窗口镜复测 — PASS（之前不亮是测试站位问题，不是 bug）
- 诊断：qa-v0.1-batch13/s3-mirror-window-diag.json（logs/b13-s3mir*.log）
- 窗口镜 standPoint 本身是对的：guide-mirror-s3-window-stand-interact，世界 (38.70, 0.20, -123.78) = 局部 (1.45, 0.20, 0)，就在塔底层。
- 第一次不亮的原因：S3 开场涨潮（initial 'high'），潮汐区域是塔内 r < rIn+0.1 且局部 y < 2.2。传送进去马上被送回门外平台 respawn (-4.53, 2.4, -3.68)，所以读到的位置是 (40.33, 2.4, -116.95)，那里本来就不该亮。
- 先 `tide.set('low', {instant:true})` 再传送：站在窗口镜站位上 → enabled=true，mirrorHighlighted.window=true，keys=[key:guide-mirror-s3-window]，current=guide-mirror-s3-window，出现「E 操作」提示 ✓
- 截图 mirror-hl-window-lowtide.png：镜框白色描边清楚 ✓
- 离镜 3.1 m（< 图标距离 3.5）：current 换成 lens-s3，窗口镜仍亮，符合「是候选或在 3.5 m 内」的规则 ✓
- **④ 结论：三面导光镜（窗口 / A / B）高亮都 PASS。**
- 附带观察：这张塔内截图里也有雨丝，和 S2 地窖一样，见 ⑨ 室内雨。

## ③-f S2 lightmap 截图对照 shots-029（7 个视角 × lm0/lm1）— PASS
- 截图：qa-v0.1-batch13/shots-029/s2-*.png；四宫格 cmp/s2-*.jpg（上排 QA lm0|lm1，下排程序 lm0|lm1）；数值用 /workspace/qa-tools/cmp029.py s2

| 视角 | 亮度 lm0→lm1 | QA lm1−lm0 | 程序 lm1−lm0 | QA vs 程序 lm1 / lm0 |
|---|---|---|---|---|
| entry | 62.8→72.5 | 10.59 | 10.59 | 2.81 / 0.00 |
| court | 72.2→80.2 | 9.16 | 9.15 | 2.95 / 2.68 |
| clifftop | 92.6→100.3 | 9.25 | 9.26 | 3.56 / 3.35 |
| room | 3.7→2.5 | 1.64 | 1.64 | 0.16 / 0.23 |
| upper | 9.4→5.1 | 5.12 | 5.12 | 0.39 / 0.57 |
| cellar（门开） | 0.8→1.7 | 1.22 | 1.22 | 0.15 / 0.07 |
| cellarentry（门开） | 0.2→1.5 | 1.36 | 1.35 | 0.13 / 0.02 |

- lm1−lm0 的差和程序几乎一样；QA 和程序的差 ≤ 3.6，跟 lm0 本身的噪声（雨丝、溅水）同一个量级 → 一致。
- room / upper 开 lm 后变暗，程序截图也一样（差值相同），算烘焙的设计效果，不报。
- 关门的镜头里 env-cellar-s2 ×0.55，开门的 cellar / cellarentry 是 ×1.00 ✓
- 钥匙闪光（cellarentry-lm1，从地窖入口看）：keyLight 0.15、keyHL=true。全图最亮的像素 160 就在架子上的钥匙那里（790, 447）。截图很暗，提亮版本 cmp/s2-cellarentry-lm1-boost.jpg 能看到架子上钥匙的反光和旁边的速写纸 ✓
- 提亮图里地窖中也有雨丝（见 ⑨）。
- 014a0 S2 白盒（这一项本身也带 art=1 子项：019 七件、地窖门扇合页、立镜 a/b 挂院墙 socket、拨盘铁门 -interact 差 0.0 mm、门扇开 78.0°）：EXIT 0 — PASS
- 014a1 S2 白盒，art=1 档：EXIT 1，「换地址后 60 秒内 s2-keeper-house 场景没有就绪」。当时开着 3 个 Chrome，负载 ≈ 30，看起来像加载超时，不像功能失败。等队列跑完单独重跑，结果见 ⑦-b。
- 014 part2 S2 谜题全链路（书桌 BUG-014 选择、风灯、光感锁、地窖门、钥匙 / 草图、317、拨盘铁门）：EXIT 0 — PASS
- 015a S3 白盒 + art=1 020 件、导光镜初始 / 正解 = 白盒（0.000°）：EXIT 0 — PASS
- 015b S3 谜题 5 全流程（涨潮送回、敲钟退潮、开门、调镜、开阀、点灯提示）：EXIT 0 — PASS

### ③-d 地窖钥匙：回退模型 prop-key-cellar-s2（屏蔽 *prop-key-lighthouse* 下载；cellar-fb.json，logs/b13-cellar-fb.log）— 点光 / 高亮 PASS
- 屏蔽之后钥匙模型确实换成 prop-key-cellar-s2，挂在 env-cellar-s2-key-socket ✓。点光参数和 lighthouse 版一样：#c4d2de、distance 0.22、decay 2、不投影、在 socket 上方 0.15 ✓
- 序列：楼梯顶 I=0 / HL=false → 进地窖 I=0.15 / HL=true（离钥匙 3.0 m、3.2 m、2 m、1 m、站位都一样）→ 出地窖 I=0 / HL=false → 拾取后 I=0 / HL=false，钥匙挂到手骨 middle_03_r ✓
- 淡入 / 淡出各 10 tick；hasKey 置位的同一 tick 灯还是 0.15，下一 tick 开始淡出（灯在 update 里刷新，晚一帧，可以接受）✓
- 门角：0.55 → 1.0，111 tick，每 tick 最大增量 0.012，和公式差 1e-5，单调 ✓（和 lh 那次一致）
- 截图 key-hl-fb.png：架子上钥匙有冷色反光点和描边 ✓
- 「两把黄铜钥匙都有描边」：lighthouse 版（key-hl-lh.png）和回退版（key-hl-fb.png）都有 keyHL=true，画面上都能看到 ✓
- E 键测试：之前 yaw=facing 的写法有问题，相机反向了（key-stand-fb.png 拍到的是墙，选中的是 sketch-s2）。CameraFollow 的约定是 forward = (−sin, −cos)，正对要用 yaw = facing + π，改好后重测，结果见 ③-g。

## ⑨ 室内雨丝 → 新报 BUG-020（低）
- 地窖：key-hl-fb.png 和 key-hl-fb-norain.png 是同一机位；只隐藏雨之后雨丝就没了。此时 camIndoor=true、rain.visible=true。
- 灯塔塔底 mirror-hl-window-lowtide.png 也一样有雨丝。
- 原因：Rain.ts 没有做室内剔除，只有镜头水滴看 cameraFollow.indoor。详情见 BUG-020.md。

### ③-g 钥匙站位：按 E 拿到的是钥匙 — PASS（cellar-keypick.json，logs/b13-keypick.log）
- 传送到 cellar-key-s2 的 standPoint (-1.89, -2.4, 1.4)，facing −1.571。传送后相机还停在原来的 yaw 3.142（侧对架子），这时 current=sketch-s2，所以之前「E 读了草图」是因为相机没转过来，不是选择逻辑的 bug。
- 相机正对（yaw = facing + π）后扫了 15 组：俯仰 −0.6 / −0.45 / −0.3 / −0.16 / 0 × 偏航 0 / ±0.25，**15/15 current 都是 cellar-key-s2**。钥匙焦点 NDC |x| 0.10–0.30，草图 0.28–0.62，钥匙一直比草图更靠近屏幕中心。
- 默认俯仰 −0.16 正对时按 E：事件 interact:used:cellar-key-s2，hasKey=true ✓（截图 key-stand-aligned.png）
- 钥匙和草图焦点只差 0.45 m（z 1.35 / 1.80），侧着看的时候会选到草图，这是「离屏幕中心最近」的设计行为，不报。

- （⑦ 续）017 交互动作 art=1（S2）：EXIT 1，「xi-pickup-shelf 播完没解锁」。断言用的是墙钟 4 s（`until(..., 4000)`），当时开着 3 个 Chrome、负载 ≈ 30，前面几步（grab 帧挂 middle_03_r、钥匙跳动 ≤ 8 cm）都过了。batch12 这一项 EXIT 0。先当作可能是负载超时，队列结束后单独重跑再下结论（⑦-b）。

## ③-h S3 lightmap 截图对照 shots-029（7 个视角 × lm0/lm1）— PASS
- 截图 shots-029/s3-*.png，四宫格 cmp/s3-*.jpg，数值 cmp029.py s3

| 视角 | 亮度 lm0→lm1 | QA lm1−lm0 | 程序 lm1−lm0 | QA vs 程序 lm1 / lm0 |
|---|---|---|---|---|
| bridge | 97.3→98.7 | 5.15 | 5.01 | 3.63 / 3.54 |
| islet | 62.4→66.3 | 9.16 | 8.06 | 6.14 / 5.19 |
| floor | 7.4→4.3 | 3.53 | 3.36 | 1.93 / 2.20 |
| room（门开） | 7.6→3.3 | 4.96 | 4.95 | 0.39 / 0.76 |
| room-doorclosed | 15.6→9.8 | 6.60 | 6.43 | 0.98 / 1.23 |
| mid | 8.1→1.4 | 6.75 | 6.75 | 0.16 / 0.62 |
| lamp | 42.7→39.1 | 4.48 | 4.47 | 1.55 / 1.71 |

- islet 和程序差得最多（p99 84），看了四宫格：几何、烘焙明暗都一样，差别在海面的高光闪点和雨丝（跟时间有关），lm0 本身也差 5.19 → 不算 lightmap 的差异。
- room-doorclosed 镜头：interior / lamp-room 都是 ×0.60，door=0；开门的 room 镜头是 ×1.00 ✓
- 塔内开 lm 之后变暗（mid 8.1→1.4），程序截图一样 → 设计效果，不报。

- （⑦ 续）017 交互动作 art=1（S1 / S3：推浮台、敲钟、开阀、拉杆、021 美术潮汐钟）：EXIT 0 — PASS
- （⑦ 续）021/022 替换入口 art=1（S1/S2/S3 白盒节点名齐、未交付道具 0 请求、已交付件挂上）：EXIT 0 — PASS

## ⑥ BUG-019 回归 — 进带 PASS / 整段 FAIL → 不关（部分修复，详见 BUG-019.md 的 batch13 一节）
- verify-camera：进带 0.155/0.178，侧入 0.156/0.179，出带 0.533/0.554，和程序给的 0.179/0.554 一致 ✓；smoke 019 A=3 B=0 ✓
- 真实场景 60 Hz（384 组，cam19-scene.json / cam19-series.json）：限高前拉每帧 ≤ 0.14 m，原来的一帧跳修好了 ✓
- 但是和限高带有关的单帧位移有超过 0.6 的：
  - 往外走、yaw 270、俯仰 −15：硬限高立即生效 4.54→1.94，一帧 2.63 m
  - yaw 315：相机来回弹 1.89 / 1.48 m
  - 出带恢复 0.60–0.90 m/帧
- Node 版 qa-cam19-13（cam19-13.json）那些 ≈4.1 m 的值，来自站在房内 / 相机在墙里的不现实路径；这次在真实场景里用物理复算，结论以这次为准。

### ⑧-a batch12 补拍：S3 导光镜近景 / 打开的日志近景（20:00 复跑）
- 首轮（t13-retry，负载≈30、3 个 Chrome 并行）截图出现洋红/黑棋盘占位。单独探针 t13-s3tex high（s3tex-high.json/png）：loadStats 60 项，pending 0，fallback 0；9 项（tex-wood-ch1 / tex-stone-masonry / tex-lighthouse-ch1-weather 各 albedo/orm/normal）attempts=2 后成功 → BUG-012 重试机制生效。单独复跑 t13-retry2 s3：loadStats fb=0，日志正常显示。结论：首轮棋盘格为高负载下的加载占位，**非新 bug**（未在复跑中复现）；但首轮是否真走了 fallback 未当场记录 → 标注「原因推断，未直接验证」。
- 打开的父亲日志：**PASS**。open 可见 / closed 隐藏；retry-journal-open-oblique.png、retry-journal-open-top.png（复跑版）纸面、字迹、书脊正常。
- 导光镜近景：**未达成（拍摄问题，不判 bug）**。机位按 interact 点方向自动推算，6 张均被镜架立柱/镜背与近处室内雨丝（BUG-020）遮挡，镜 a 三张几乎全黑（均值亮度 1.6–5.7/255），镜 b 只见镜背边缘（retry-mirror-b-front.png）。三面镜的高亮/启用已由 ④ 验证（mirror-hl-*.png）；近景美术细节需手动机位，**本批未验证**。

### ⑧-b batch12 补拍：S1 退潮后纸条 a / 脚印贴花（20:12 复跑）
- 首轮及第二轮「等待超时：s1」原因：补拍脚本 S1 URL 漏了 `debug=1`，`window.__s1` 不暴露 → 测试脚本问题，非游戏问题。补上后单独复跑通过。
- tide.set('low') 后 state=low、level 0、水面 y=0。
- 纸条 a（prop-letter-a-s1，y=0.12）：**PASS**。退潮后露出、纸面与字迹清晰，未被水面遮挡（retry-lowtide-prop-letter-a-s1.png）。周围有雨滴涟漪/湿面反光，属湿沙效果。
- 脚印贴花（s1-footprints-decal，y=0.462）：**未能确认**。机位中心对准贴花原点，但画面（retry-lowtide-s1-footprints-decal.png）里是礁石和积水，看不到可辨认的脚印；可能是贴花被积水/湿面反光盖住，也可能只是机位/尺度不对。**本批未验证，不立 bug**；建议下批在真机上手动看，或拿到贴花尺寸后重新取景。

### ③-i 雨夜 ×0.35（logs/b13-rain.log 含 S1/S2；S3 在首轮里卡住超过 25 分钟，疑为负载，已 kill，20:16 用 t13-rain3 单独复跑 → rain-night-s3.json）
| 场景 | rain-night hemi | lm 倍率（雨夜） | overcast-dusk 对照 |
|---|---|---|---|
| S1 | 0.56 | 全部 0.35 | 1.6 / 全部 1 |
| S2 | 0.56 | 室外/室内 0.35，地窖 0.1925（=0.35×0.55） | 1.6 / 1，地窖 0.55 |
| S3 | 0.56 | 塔外/礁岛/石桥 0.35，塔内+灯室 0.21（=0.35×0.60，门关） | 1.6 / 1，塔内+灯室 0.6 |
- material.lightMapIntensity 与 scale 一致（lmI0 == scale），base=1。**PASS**。

### ⑦-b 014a1 单独复跑（20:16，负载≈5，logs/q13-014a1r.log）
- `SMOKE_ONLY='v0.1-014 S2 白盒' SMOKE_QUERY=art=1`：EXIT 0，「冒烟测试通过」。白盒、019 七件、地窖门合页、立镜 a/b socket、拨盘铁门 78.0°、白石组、光感锁全部 ✓。→ 首轮「60 秒内 s2-keeper-house 未就绪」确认为负载超时。**PASS**。

### ⑦-b 017s2 单独复跑（20:21，logs/q13-017s2r.log）
- EXIT 0，「冒烟测试通过」。xi-place-table 2.10 s 后开日志，风灯上桌 ✓；钥匙 xi-pickup-shelf grab 帧挂 middle_03_r（跳动 1.0 cm）、**播完收起解锁 ✓**；地窖 wetTarget 0 / 小院 1 ✓。→ 首轮「播完没解锁」是负载下 4 s 墙钟等待超时。**PASS**。

### ⑧-c 脚印贴花补拍：按包围盒俯拍（20:28，t13-foot.mjs，logs/b13-foot.log）
- 贴花 s1-footprints-decal：visible、MeshStandardMaterial、有 map、transparent、opacity 1、polygonOffset 开、renderOrder 1；包围盒中心 (−3.20, 0.462, −0.70)，尺寸 2.14 × 0.03 × 2.11 m。退潮（state=low）。
- 俯拍 retry-lowtide-footprints-top.png：**能看到几处很淡的椭圆脚印**（画面左上中部、中下右侧），但对比度很低，而且贴花中部被一块礁石盖住（礁石落在贴花范围里）。
- 结论：**PASS（勉强可见）**。贴花确实渲染，没有被水遮住。「太淡 / 被礁石挡住」是观感问题，SwiftShader 下的亮度不能代表真机，**不立 bug**，记为美术观察项，交真机确认。

### ⑧-d 导光镜近景补拍：沿 mirror-plane 法线两侧各 1 m，雨隐藏（20:36，t13-mirclose.mjs，logs/b13-mirclose.log）
- 门开、门内 lightmap 已生效；隐藏 3 个雨节点（排除 BUG-020 雨丝遮挡）。原图 mirclose-*.png（SwiftShader 下偏暗，均值亮度 2–21/255）；提亮拼图 cmp/mirclose-grid-boost.jpg（左上 a、右上 b、下排窗口镜两侧）。
- 墙镜 a（mirclose-wall-s3-a-p.png）、墙镜 b（mirclose-wall-s3-b-n.png）：**PASS**。镜框、铰轴、锈铜边完整，镜面有锤纹法线和反光，背景楼梯/栏杆正常，没有棋盘格或缺贴图。另一侧（a-n / b-p）是镜背，几乎全黑，符合预期。
- 窗口镜（mirclose-window-s3-n/p.png）：法线 (±0.22, ±0.59, ∓0.78)，镜面朝斜上方。−侧看到窗洞、光束和亮的眼形开口；+侧机位落在窗外水面上方，只拍到水面。**镜面细节未拍清，近景未验证**，高亮/启用已在 ④-b 通过。不立 bug。
