# QA v0.1 batch12 — master a3a2a04（cd22761 之后 19 个提交）

- 快照：/workspace/qa-tools/snap-a3a2a04（git archive a3a2a04；package.json 只多 test:atmo / test:dressing，依赖不变，node_modules 硬链接 snap-cd22761；art / docs 软链到工作区）。
- 方法同 batch11：headless Chrome + SwiftShader 软件渲染，时长按固定步判，**不判帧率**。截图在 qa-v0.1-batch12/。每项做完就追加。

## ① 构建 / lint / 单测 —— build ✓ / test ✓ / **lint ✗（BUG-018）**
- `npm run build` exit 0（vite 0.75 s）。logs/b12-build.log。
- `npm test` exit 0，308 条 ✓ / 0 ✗（新增 test:atmo、test:dressing；verify-audio 21 项）。logs/b12-test.log。
- `npm run lint` **exit 1**：7 error（SkyDome / Water / s3 dressing / shots-028 的多余类型断言与无用表达式）+ 1 warning → **BUG-018**（低）。`npm run check` 因此会停在 lint。
- `npm run css` ✓。

## ④ 体积（`npm run size`）—— 通过，与程序报一致
| 包 | 实测 | 预算 / 程序报 |
|---|---|---|
| menu+boot | 2.90 MB | ≤ 15 ✓ |
| common+s1 | **120.89 MB** | ≤ 150；程序报 120.89 ✓ |
| 首次进 S1 | **123.79 MB** | 程序报 123.79 ✓ |
| common / s1 / s2 / s3 | 33.80 / 87.09 / 56.62 / 16.59 MB | |
- 预估：../art 已交付未登记 17 个文件全接入后首场景 ≈ 126.24、首次 ≈ 129.14 MB，仍在预算内。

## ③ 风吹钟 6–14 s（3df06f6 游戏时间断言）—— 通过（补 batch11 缺口）
- `npm test` 内 verify-audio（21 项 ✓）：BellWindTimer 固定种子模拟 1 h 游戏时间 → **358 次，间隔 6.02…14.00 s，均值 10.08 s**；dt 0.1 时 356 次（帧率无关）；走远回来 0.03 s 后先响 ✓；「间隔 6–14 s（按游戏时间模拟 fixedUpdate，与墙钟 / 帧率无关）」✓。
- 说明：这是 Node 里对 S1 同一计时器的模拟，不是浏览器实测；batch11 已确认浏览器里到钟旁立即响一次。

## ②-a 028 四个预设运行时读数（S1 art=1 ultra，t12-atmo.mjs，logs/t12-atmo.log）—— 通过（雾值口径见注）
| ?atmo= | 场景 FogExp2 | 主岛 / 灯塔按物体雾（mid） | 雾色 | 水面法线 nScale / 雨圈 K | 雨 | LUT | 天光 / 主光 |
|---|---|---|---|---|---|---|---|
| overcast-dusk | 0.009 | **0.0036** | #b9c2c8 | 0.35 / 0.35（两层） | quad 30k 开 | lut-overcast-dusk | 1.6 / 2.4 |
| overcast-after-rain | 0.007 | **0.0032** | #c3cbd0 | 0.25 / 0 | 关 | lut-overcast-after-rain | 1.6 / 2.4 |
| rain-night | 0.016 | **0.0042** | #3a444c | 0.45 / 0.35 | quad 30k 开 | lut-rain-night | **0.56 / 0.84（×0.35）** |
| after-lit | 0.008 | **0.0034** | #aeb7be | 0.30 / 0 | 关 | lut-after-lit | 1.6 / 2.4 |
- **雾值口径注**：brief 里的 0.0036 / 0.0032 / 0.0042 / 0.0034 在运行时是 028 `s1.fogDensityHint.mid`（主岛 / 灯塔的按物体雾），四个预设全部吻合；场景全局 FogExp2 用的是 028 各预设 `fog.density`（0.009 / 0.007 / 0.016 / 0.008，已替换 026 的 0.028）。两者都与 028 JSON 原样一致（verify-atmo028「atmosphere028.ts = 美术 JSON 原样副本」✓），符合裁定 18①「全局雾改用 028 预设值」。若制作人本意是全局雾也要 0.003x，需另行确认——不算 bug。
- 雾片：5 层雾墙 + 30 片地面 / 岛边 / 贴水雾片；雾墙相对相机 xz 偏移 0（相机挪 30 m / −20 m 后 3 帧仍 0）→ 跟随 ✓；雾墙 shader 两端淡出 edge 0.12、近相机 20–60 m 淡出、深度夹远平面；雾片 edge 0.22、近相机 8–25 m 淡出 ✓（读 customProgramCacheKey，淡出效果本身见截图）。
- 水面：两层细节法线已挂（tWN）、第二层 uRipL2 = 1；雨圈只在下雨预设 > 0 ✓。
- 镜头水滴：下雨预设 + ultra 在建立镜头（过场）里起淡入（读到 0.44–0.50），不下雨预设 0 ✓。

## ⑥-a 裁定 19：smoke v0.1-019（sample-317）—— 通过
- `SMOKE_ONLY='v0.1-019'` 单跑 EXIT 0（logs/q12-019.log）：「西窗外室外第三人称机位读不出 317（B 簇 = 0），二层 A 簇 3 个（接受）、B 簇 0 个 ✓」。与 a3a2a04 提交说明（改前 A=3 B=54）一致。

## ⑤-a S3 导光镜 a/b 重交（art=1，t12-mirror.mjs）—— 网格 ✓，截图进行中
- dist 里的 GLB 与 ../art 13:23 重交文件 md5 相同。
- 运行时（挂上后）：a / b 各渲染网格 3 个（镜框 1650 顶点、mirror-pivot-mesh 568、mirror-pitch-mesh 412）都有法线 + UV（0.012–0.988）、贴图 + 法线贴图；**顶点法线与面法线反向 0.00 %**（旧版 62.4 %）；-collider 隐藏 ✓。
- `npm test` verify-s3：光路正解 → 点火口离口心 0.0086 m、导光镜 a/b 美术法线跟白盒 24 档（镜心差 0.00 mm）、美术反射离下一目标 8.6 / 7.2 mm ✓。

### ⑤-b 导光镜 a/b 近景截图（t12-mirror2，logs/t12-mirror2.log）
- 截图：qa-v0.1-batch12/mirror-{a,b}-{stand,oblique}.png（-interact 站位眼高 + 45° 斜看）。
- 结论：**截图不足以目视判定**——S3 雨夜逆光，站位视线被栏杆立柱挡住，镜面只剩剪影；画面里没看到碎面 / 黑三角那类明显撕裂，但细节看不清，**目视项标"无法验证"**。
- 判定依据用 ⑤-a 的数据：法线翻转 0.00 %（旧版 62.4 %）、UV 0.012–0.988、光路离点火器中心 0.0086 m → **PASS（数据）**。建议美术 / 程序在 Blender 或 ?debug 补光下补一张近景确认。

### ⑦ text-ch1 阅读 / 查看点逐个触发（t12-read，art=1，logs/t12-read.log）
- S1 8 个 / S2 17 个 / S3 3 个 read·inspect 交互物：站位 + trigger 后全部出现对应 `reader:open` / `subtitle:show`（id 与 textId 一致）→ **PASS**。
- 覆盖 text-ch1 inspect/doc/journal 23 个里的 20 个；另外 3 个是状态型，不走这条路：`ch1.s2.journal.doc`（日志，smoke 014 已断言第 1 页 / 5 页）、`ch1.s2.key.tag_inspect`（拿钥匙后 0.5 s）、`ch1.s2.dial_gate.inspect`（首次进拨盘 puzzle:enter）→ 补测 t12-read2 进行中。
- 027 换上美术件后 letter-a / 日志 / 航海日志 / 告示板这几处仍能读（s1-notice、s1-neighbor-note、logbook-s3、ignition-note-s3 都 PASS）。
- 补测 t12-read2（logs/t12-read2.log）：journal-s2 → `reader:open ch1.s2.journal.doc` ✓；cellar-key-s2 → 0.5 s 后 `ch1.s2.key.tag_inspect` ✓；dial-gate-s2 首次 puzzle:enter → `ch1.s2.dial_gate.inspect` ✓。**text-ch1 23/23 全覆盖 → PASS**。

### ⑥-b 裁定 19 手动：西窗外相机限高 / 平滑（t12-cam19 + 60 Hz 复算 t12-cam19sim）
- 限高带（游戏里读出）：眼位 (0.95, 4.35, 1.0)，朝 +x 下倾，from 1.05 → to 10.07 m，半宽 3、margin 1.3、fade 1.5。
- **高度 PASS**：带内 s = 2.05 / 5.56 / 9.07 三处，俯仰 -35°、距离 6：相机 y 2.08 / 1.85 / 1.71，都 ≤ max(视线 − 1.3, 支点 + 0.5)（距离被压到 1.26 / 0.87 / 0.87）。始终在二层窗口高度（≥ 3 m）以下，升不到窗口。附注：带尾 s≈9 处下限 1.71 m 比视线（1.29 m）还高 0.4 m——这是"不压到支点 +0.5 m"的设计结果，sample-317 B=0 说明读不出（相机 0.87 m 贴在汐背后），只作记录。
- **平滑 FAIL → BUG-019**：沿视线走向房子，或从带侧面正对着走进带时，相机单帧从 6 m 收到 0.87 m（位移 ≈5.1 m）；浏览器帧记录 + 60 Hz 固定步复算一致。出带是 0.25 s 平滑恢复，正常。

### ⑧ 冒烟逐条（runq12，logs/q12-*.log）
| 项 | 结果 |
|---|---|
| 010 场景流程 | ✓ EXIT 0 |
| 013 S1 白盒 + 谜题 1、2（含 art=1） | ✓ EXIT 0 → **谜题 1 / 2 PASS** |
| 014 S2 白盒 + art=1 | ✓ EXIT 0 |
| 014 part2 S2 谜题（art=0） | ✓ EXIT 0 → **谜题 3 / 4 PASS**（风灯 / 转镜 / 光感锁 / 地窖 / 观察点 317 / 拨盘） |
| 015 S3 白盒 + art=1 | ✓ EXIT 0（光路正解到点火口） |
| 015 S3 谜题 5 | ✓ EXIT 0 → **谜题 5 PASS** |
| 019 裁定 19 sample-317 | ✓ EXIT 0（A=3 / B=0） |
| 021/022 替换入口 art=1 | ✓ EXIT 0 |
| art=1 014 part2 | ✓ EXIT 0 |
| 017 交互动作 art=1 S2 | ✓ EXIT 0 |
| 017 交互动作 art=1 S1 / S3 | ✓ EXIT 0 |
| art=1 014 S2 白盒 | ✓ EXIT 0 |

- **拨盘铁门 PASS**：smoke 014 art=1「拨盘铁门挂 gate-socket、站位读 -interact（差 0.0 mm）、317 拨盘 rotation.z = −36k°、门扇开 78.0° ✓」；美术 prop-dial-gate-s2.glb 的 gate-door extras `openDeg: 78`，代码 `setDialGateArt` 读 extras。注：extras 值和 layout 缺省都是 78，数值上分不出来源，来源只能从代码确认。

### ②-b 大气截图（qa-shots-028，1600×900 ultra，开场机位；qa-v0.1-batch12/shots-028/）
| 预设 | 截图 | 远景灯塔剪影 | 画面均值 RGB |
|---|---|---|---|
| overcast-dusk | s1-opening-c-028-ultra.png | 清楚（主岛灯塔 + 两侧远塔都在雾里分层可见） | 88 / 94 / 99 |
| rain-night | s1-opening-d-rain-night.png | 清楚（暗场里剪影可辨） | 17 / 21 / 26 |
| after-lit | s1-opening-d-after-lit.png | 清楚 | 85 / 92 / 97 |
| overcast-after-rain | s1-opening-d-overcast-after-rain.png（第一次卡死超时，单独重跑出图，logs/b12-shots-c.log） | 清楚 | — |
- 剪影：四个预设全部 **PASS**。
- 雾墙：画面里海平线一带雾带连续，近处没有硬边卡片；数据见 ②-a（雾墙跟相机偏移 0、近处 20–60 m 淡出、边缘 0.12 软边）→ **PASS**。
- **LUT ?lut=0 回退 PASS**：qa-opening-lut0.png（activeLut = null）对比默认：整体略暗（均值 82/87/91 vs 88/94/99），冷暖比例基本不变（B−R 9.0 vs 10.9），没有偏色。
- 水面比预览暗：已知，等 025 平面反射，**按要求不报**。

### ②-c 雨分档 + 溅水（t12-splash，用雨自己的时间基，logs/t12-splash.log）
| rain-night 档位 | 模式 | 雨滴 | 溅水存活（4 s 后连续 4 次采样） |
|---|---|---|---|
| ultra | quad | 30000 | 180 / 180 / 180 / 180 |
| high | quad | 15000 | 90 ×4 |
| standard | line（1 px 线） | 6000 | 30–35 |
- 分档和 be9851c 一致（ultra/high 细长 quad、standard 1 px 线），溅水按档位递减且稳定 → **PASS**（上次读到 0 是时间基传错，不是 bug）。镜头水滴见 ②-a（雨天预设过场 0.44–0.5）。
- qa-opening-lut0-rain-night：activeLut = null 正常出图。
- 溅水补记：overcast-after-rain / after-lit 溅水 0，因为 028 JSON 这两个预设 `rain.enabled: false`（截图里也没有雨），符合预期。shots json 里的 "rain: quad 30000" 只是档位模式，不代表在下雨。

### ⑨ 027 剧情道具（qa-check-027，logs/b12-027.log；近景 qa-v0.1-batch12/shots-027/）
- **S1**：告示板挂 s1-notice、焦点读美术 -interact（fromArt ✓）；纸条 a 挂 s1-neighbor-note；白盒载体材质隐藏；脚印贴花 map ✓、贴物理路面 +0.015、倾角 −0.016；海鸟可见、有动作、3 个 morph → **PASS**。注：纸条 a（沙洲 y 0.12）和脚印（礁石小径 y 0.46）都只在退潮后露出来，脚本在开场涨潮 1.6 时拍，近景只拍到水面——位置和白盒一样，是设计，不是 bug；**这两张近景目视算"无法验证"**。
- **S3**：航海日志 snapped 到 logbook-s3-read（surfaceOffset −6.3 mm），近景就在塔门内侧木架上 ✓；letter-b snapped 到 ignition-note-read（−7.9 mm），近景平躺在点火器旁的铁托盘上 ✓，离拉杆 1.98 m（交互点 2.41 m，≥ 1.5 m）✓；父亲日志 S3 份放在灯室 socket（+0.1 mm）✓；载体隐藏 ✓ → **PASS**。没有浮空或下沉（偏差都 < 1 cm）。
- **S2**（第一次在高负载下 240 s 没进场景，单跑重测，logs/b12-027s2.log）：书桌组 / 厨房组 / 父亲日志（journal-socket，焦点 fromArt ✓）/ 纸条 c / 两只铁杯（cups-socket）/ 草图（地窖 sketch-socket）全部 snapped，偏差 ≤ 0.9 mm；载体都隐藏。近景：厨房桌上的壶、盘、杯放在桌面上，书桌组在桌上 → **PASS**。注：厨房近景里能看到雨丝，是因为脚本接管相机时玩家还在门外（室外判定跟玩家走），不是游戏里会出现的情况，不报。
- 日志合上 / 打开两种状态：smoke 014 已断言日志第 1 页 / 5 页翻页和读完后的状态，t12-read2 也打开过（reader:open）；**打开状态的近景没有单独拍，标"无法验证（目视）"**。

### ⑩ Chrome 兼容 3 分辨率（t12-compat，logs/t12-compat.log）
| 分辨率 | WebGL2 | 画布（渲染 / CSS） | KTX2 | 进入可玩 | 页面错误 |
|---|---|---|---|---|---|
| 1280×720 | ✓ | 1024×576 / 1280×720 | ✓ | 49 s | 0 |
| 1920×1080 | ✓ | 1536×864 / 1920×1080 | ✓ | 50 s | 0 |
| 2560×1440 | ✓ | 2048×1152 / 2560×1440 | ✓ | 64 s | 0 |
- Chrome/156 headless SwiftShader，画布铺满（渲染缩放 0.8）→ **PASS**。截图 qa-v0.1-batch12/compat-*.png。

## 汇总（batch12，a3a2a04）
| 区域 | 结果 | 备注 |
|---|---|---|
| build / npm test / css | PASS | test 308 ✓ |
| lint | **FAIL → BUG-018**（低） | 7 error + 1 warning，`npm run check` 红 |
| 028 四个预设 + 雾值 | PASS | 局部雾 mid 0.0036/0.0032/0.0042/0.0034 = 简报值；全局 FogExp2 是 028 fog.density（0.009/0.007/0.016/0.008），字段不同，请制作人确认，不报 |
| 远景灯塔剪影 ×4 | PASS | 四张截图都清楚 |
| 雾墙 / 雾片跟随、淡出 | PASS | 数据 + 目视 |
| 水面双层法线 + 雨圈 | PASS | 水比预览暗 = 025 已知，不报 |
| LUT ?lut=0 | PASS | 不偏色 |
| 雨分档 / 溅水 / 镜头水滴 | PASS | 30k/15k/6k，溅水 180/90/30 |
| 027 道具 S1/S2/S3 | PASS | 偏差都 < 1 cm；letter-b 平躺在铁托盘上、离拉杆 1.98 m；航海日志在门内木架上；纸条 a / 脚印 / 日志打开状态的目视标"无法验证" |
| text-ch1 阅读 / 查看点 | PASS | 23/23 |
| 导光镜 a/b | PASS（数据） | 法线翻转 0 %，光路离点火口中心 8.6 mm；近景逆光，目视无法验证 |
| 拨盘铁门 78° | PASS | extras openDeg 78 |
| 风铃 6–14 s | PASS | 6.02–14.00 s（Node 模拟） |
| 裁定 19 sample-317 | PASS | A=3 / B=0 |
| 裁定 19 手动：高度 | PASS | 带内相机 ≤ max(视线 − 1.3, 支点 + 0.5)，到不了窗口高度 |
| 裁定 19 手动：平滑 | **FAIL → BUG-019**（中低） | 走进带内时单帧 6 → 0.87 m |
| 冒烟 010/013/014(+p2, art0/1)/015/017/019/021 | PASS | 全部 EXIT 0 |
| 谜题 1–5 | PASS | |
| 包体 | PASS | common+s1 120.89 MB（≤ 150），首次进 S1 123.79 MB，menu 2.90 MB（≤ 15） |
| Chrome 3 分辨率 | PASS | |
