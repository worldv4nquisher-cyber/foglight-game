# QA v0.1 batch11 — master cd22761（e9a58b2 之后 24 个提交）

- 快照：/workspace/qa-tools/snap-cd22761（git archive cd22761；package-lock 与 92c7c96 相同，node_modules 硬链接；art / docs 软链到工作区）。
- 方法同 batch10：headless Chrome 156 + SwiftShader 软件渲染，时长按固定步（fixedTick）判，**不判帧率**；墙钟读数只作参考。截图在 qa-v0.1-batch11/。
- 每项检查做完就追加到本文件。

## ① 构建 / lint / 单测 —— 通过
- `npm run build`：exit 0（typecheck + vite build 0.73 s）。日志 logs/b11-build.log。
- `npm run lint`：exit 0。
- `npm test`：**300 ✓ / 0 ✗**，exit 0（batch10 是 266）。新增覆盖 verify-audio 20 项，含 79 个 ogg 登记、optional 缺文件静默、换场景 stopAllLoops、暂停 suspend；钟锤补音缺省 0.055、美术根 clapperHitRad 优先、敲一次碰壁 1–2 次；verify-s2 白石 / 光路唯一解 A 30° B 315°。

## ④ 体积（`npm run size`，dist，cd22761 构建）—— 通过
| 包 | 实测 | 预算 / 程序报 |
|---|---|---|
| 主菜单 menu+boot | 2.85 MB | ≤ 15 MB |
| 首场景 common+s1 | **110.12 MB** | ≤ 150 MB；程序报 110.12 ✓ |
| 首次进 S1 总下载 | **112.97 MB** | 程序报 112.97 ✓ |
| common | 25.94 MB | |
| s1 | 84.18 MB | |
| s2 | 56.89 MB | |
| s3 | 16.12 MB | |
- 预估：../art 已交付但未登记的 39 个文件（s1 11.51 MB、s3 0.02 MB）全部接入后，首场景包 ≈ 121.63 MB、首次下载 ≈ 124.49 MB，仍在预算内。

## ③-a S3 可点灯嗡鸣 / 拉杆第 34 帧 / 透镜循环（art=1，t11-hum.mjs，固定步插桩）—— 通过（淡入曲线运行时不可测）
- receiver:ready 那一步（tick 150）起播 `sfx-ignite-ready-loop`，用 032 文件 buffer、fadeIn 0.6 s，只一次 ✓。
- 断光 15 / 18 步（0.25 / 0.30 s）：嗡鸣不断 ✓；断 19 步：断光后第 19 步 stopLoop（fadeOut 0.3）✓，复光 1.0 s 再 ready 时重新起播 ✓。
- Esc 暂停：AudioContext `suspended`、嗡鸣仍在循环表里（不重起）；再按 Esc → `running` 接着播 ✓。（第一次跑用 CDP 瞬时 tap，高负载下第二次 Esc 没被消费——改按住 250 ms 后正常，属测试手法，不是 bug。）
- 按 E 后断光：嗡鸣不停，`lighthouse:ignited` 那一步（tick 467）stopLoop fadeOut 0.3 ✓。点燃后正好 90 步（1.5 s）起 `sfx-lens-rotate-loop`（文件 buffer）✓。
- 拉杆：xi-ignite-lever 开始后 67 步（33.5 帧，batch10 同口径 ±1 帧）点燃，白盒拉杆当步 60°（到底），之后不超 ✓；美术 `ignite-lever` 在 fixedUpdate 里采样晚一步（59.41° = 上一步白盒值），因为 artSlots.update() 在渲染帧 update 里、固定步之后同步，渲染出来的那一帧就是 60°；全程最大 60.0° ✓。
- **淡入增益曲线：未能运行时验证**。音频时钟走实时，机器负载 35–98，两个固定步之间就超过 0.6 s，采不到中间值（读到的 gain.value 只有起点 1 个样本，Chrome 在音频线程处理排程之前返回缺省值）。排程本身由 verify-audio「淡入 / 淡出时长可配」mock 单测覆盖（linearRamp 0 → vol）。
- 页面错误 0。截图 s3-ignite-art.png。

## ③-b 钟锤碰壁音 sfx-tide-bell-clapper（t11-clapper.mjs，真按 E 敲钟）—— S3 art=1 / S1 art=0 通过，S1 art=1 见下文
- S3 art=1：美术根 `prop-tide-bell_1` extras.clapperHitRad = 0.0537 生效（bell.clapperHitRad 0.0537）✓；第 88 步钟声，第 100 步钟锤碰壁发 `sfx-tide-bell-clapper`（optional）1 次，`playBuffer` 实际播了 032 文件（1.90 s 那条，带 gainDb）、没有合成占位 beep ✓；钟锤最大 |相对角| 正好到 0.0537。
  - 控制台 1 条 `[FrameManager] Failed to notify focus taken.`——Chrome 自己的消息（headless 焦点切换），非游戏代码，不算。
- S1 art=0：阈值缺省 0.055 ✓，钟锤碰壁 2 次（第 32、42 步）发事件；文件按 art=0 当未交付 → 静默，没有合成音 ✓（符合「optional 缺文件静默」）。

## ②-a 白石 / 观察模式（裁定 15 / 16，S2 art=1，t11-stones.mjs，真鼠标：左键点画布拿 pointer lock + 按住右键 + 真 mouseMoved）—— 第一轮结果（脚本被 1800 s 超时截断在「风铃 / 松开」之前，已重跑，结果见 ②-b）
- 进场：白石美术 `prop-white-stones-s2` 挂上、`whiteStonesArtActive` = true、七段贴片不可见（opacity 0）、眼位读 GLB（whiteStonesAim eye = (0.95, 4.35, 1.0)、fov 30）✓。
- 站到观察点地面（0.95, 3.05, 1.0），提示「按住右键 观察」；按住右键 → 相机世界坐标正好 (0.95, 4.35, 1.0)、FOV 30.00、eyeActive / observing true、汐隐藏（rig.visual.visible false）✓；pointer lock 在 headless 里拿到了（document.pointerLockElement = canvas）。
- 进入时视线离字组中心 14.91°（> 6°，裁定「进入偏 15°」）、对准度 0 ✓。
- 换到观察点区域内另一站位（+0.3, −0.2）再按右键：眼位仍是 (0.95, 4.35, 1.0) ✓。
- 观察中鼠标仍能转：真 mouseMoved 右移 40 px，yaw −1.309 → −1.359（−0.00125 rad/px）✓。
- 对准度 vs 偏差角（量到字组中心）：14.91° → 0；11.38° → 0.104；9.40° → 0.434；7.47° → 0.755；5.63° / 4.03° / 3.05° / 2.98° → 1。与「≥12° 为 0、12°→6° 线性、≤6° 为 1」逐点相符（线性公式误差 < 0.002）✓。（脚本自动判 FAIL 是因为我把「有 >12° 的采样」限定在逐步转动的数组里、漏掉了进入时的 14.91° 那个点，属脚本条件问题，不是游戏问题。）
- 加亮只发生在材质 `mat-prop-white-stones-digit-s2` 的 10 块数字石（d3-a/b/c/d/g、d1-b/c、d7-a/b/c，正好组成 3 / 1 / 7），emissiveIntensity = 0.35 × 对准度逐点相符；装饰石 / 干扰石不亮 ✓。（第一版探针把 emissive 为黑、intensity 缺省 1 的材质也算进去了，已改成按 emissive 颜色非零判。）
- 对准时七段贴片仍关（segVis false、opacity 0）→ 画面只有白石这一组 317 ✓。截图 stones-observe-aligned.png。

## ③-b 补：钟锤 S1 art=1 —— 通过
- 美术根 `prop-tide-bell_1` clapperHitRad 0.0537 生效；真按 E：第 89 步钟声，第 104 步钟锤碰壁发 `sfx-tide-bell-clapper` 1 次，playBuffer 播 032 文件（1.90 s），合成占位 beep 0；钟锤最大 |相对角| 0.0537；missing 空；页面错误 0 ✓。
- 钟锤三档合计：S1 art=0（0.055，静默）✓ / S1 art=1 ✓ / S3 art=1 ✓。

## ⑤-a S2 拨盘铁门 78° vs 西门柱（art=1，t11-gate3.mjs，三角面距离 + 3 方向射线奇偶判内）—— 通过
- 门扇节点 `gate-door`（gate-door-mesh + dial-0/1/2-mesh），合页 `s2-dial-gate-hinge`；西门柱 / 院墙美术在 `env-clifftop-s2_lod0`（只量可见 lod0）。
- 判内顶点分三类：y<0.15（门扇底边插进地面 3.5 cm，0° 关门时也一样，不算穿模）、合页轴半径 r<0.08（挂在门柱上，按设计）、其余 = 「门柱穿模」。
- 0°：门柱穿模 0；**78°：0** ✓；90°：20 个顶点（y≈1.11–1.18，r≈0.23）进门柱；95°：170 个。即 78° 正好在穿模前，改 78° 有效。
- 第一版探针（t11-gate / t11-gate2）把 lod1/lod2 和地面、合页轴都算进去，判 FAIL 不作数。
- 截图 s2-gate-78-art.png（第三人称，门在角色背后，目测看不出穿模；判定以几何量为准）。
- 「真拨 317 开门」见 ⑥（S2 后半段 art=1 全流程）。

## ②-b 白石 第二轮（t11-stones.mjs 重跑完整，timeout 6000）—— 通过
- 第一轮各项复现一致（眼位 (0.95, 4.35, 1.0) / FOV 30 / 汐隐藏 / 进入偏 14.91° / 鼠标转 −0.00125 rad/px / 对准度 11.38→0.104、9.40→0.434、7.47→0.755、≤6°→1 / 只 10 块数字石加亮 / 贴片关）✓。脚本对「对准度」那条的自动 FAIL 同 ②-a，是脚本条件问题（bad 列表为空）。
- 对准完成：`sfx-wind-chime` 1 次（第 784 步）+ 字幕 `ch1.s2.white_stones.mono_digits`「三，一，七。」1 次（835 显示 / 870 隐藏）✓。
- 松开右键：退出固定眼位，FOV 回 55、汐重新显示、相机回第三人称跟随（离眼位 2.2 m）✓。截图 stones-after-release.png。
- 第二次按右键再对准：风铃 / 独白不再触发（事件数 5 → 5）✓。页面错误 0。

## ②-c 裁定 17：观察模式外第三人称看不出 317（S2 art=1，t11-r17.mjs + t11-r17b.mjs，人工看图）—— 通过
- 15 个可到达站位截图（r17-*.png）：平台东沿、山坡 x11 / x14 南 / x14 中 / x15 北 / x22 坡下、二层观察窗 / 二层东侧、屋前地面、院子、北小路；平台东沿和 x11 另加相机左右偏 0.45 rad 各一张（避免汐挡住字组中心）。
- 逐张人工判读：白石只看成散落的石块 / 立石，**没有一张能读出 3、1、7**；从坡下（x22）和 x14 中段近看也是乱石；二层窗口站位第三人称相机在墙内侧，窗外只见天空。全部 observing / eyeActive false、数字石加亮 0、七段贴片 opacity 0；页面错误 0 ✓。
- 说明：二层观察窗站位第三人称时 `viewpoint.alignment` 原始值算到 0.40（相机方向离字组 9.6°），但 puzzles.ts 里加亮 / 风铃用的是 `on && cameraFollow.observing ? alignment : 0`（读码确认），实测加亮 0、风铃没响——不是问题。r17 脚本因为这一条自动判 FAIL，属脚本条件，r17b 已去掉。
- 附带看到（不在本批范围，未判）：院子地面有大片浅色不规则斑块（r17-yard.png），像积水 / 石板贴花，建议美术自己看一眼。

## ⑤-b S3 导光镜 a / b ψ（art=1，t11-guide.mjs）—— 通过
- `prop-guide-mirror-wall-s3-a/b` 挂 `guide-mirror-s3-mid-a/b`，missingNodes 空。美术 mirror-plane 法线与白盒镜面法线夹角用 atan2(|n1×n2|, n1·n2) 算（float32 矩阵下 acos 只能到约 0.03°，不够）。
- reset / solve / 转角 0–345° 每 15° 共 26 个样本：**a 最大 0.000004°、b 最大 0.000001°**（≤ 0.005° ✓），镜面中心位置差 0 m。页面错误 0。

## ③-c 光感锁接通音 + 光束嗡鸣（S2 art=1，t11-connect.mjs，真按 E 放风灯到东灯台 + 镜正解）—— 通过
- 第 337 步 `sfx-lantern-place`，第 342 步光路「亮 → light-lock-s2」：`sfx-beam-connect` 1 声（playBuffer 播 032 文件）+ `sfx-beam-hum-loop` 起播（文件 buffer）✓；光感锁进 charging。截图 s2-lightlock-connect.png。
- 镜 A 转走断光 40 步（0.67 s > 0.3 s 宽限）：第 457 步 stopLoop ✓；转回正解：第 483 步再起播、connect 再响 1 声（starts = 2）✓。页面错误 0。
- t11-audio2 里那条 FAIL 作废：脚本给 `emitter.lit` 赋值，但 lit 是 getter（intensity ≥ 0.5），赋值没用，灯根本没亮。

## ③-d 032 音效：UI / 环境循环 / 脚步 / 日志 / 阅读 / 室内交叉淡化（t11-audio2.mjs，addInit 轮询挂钩，art=1）—— 通过（翻页音不可测，见下）
- 主菜单：设置 / 制作名单 → `sfx-ui-confirm`，返回按钮 / Esc(ui:back) → `sfx-ui-back`，都是文件 buffer、音量 1.1482（+1.2 dB）✓，没有合成占位。
- 进场循环用 032 文件 buffer：S1 waves-near / rain-light / wind-soft ✓；S2 室外 rain-light / eaves-drip / waves-far / wind-soft ✓（S3 见 ③-e）。
- S1 真按住 W 走 4.12 m：6 声 `sfx-step-wood-*`（按距离，第 20/40/65/90/115/140 步），变体 a/c/a/c/d/c，没有连续重复，beep 0 ✓。（按设计按距离触发，不跟动画脚帧。）
- J 打开日志 → `sfx-ui-journal` 1 声 ✓；J 关闭没声音（journal:close 没配音，按设计）。
- 阅读：E 读汐的笔记 → `sfx-paper-open` ✓。汐的笔记只有 1 页翻不了（脚本那条 FAIL 不作数），翻页音另用 t11-flip.mjs 测：S2 日志 `ch1.s2.journal.doc`（5 页）真鼠标点 › 4 次 → flip-b / a / c / b 各一声、不连续重复，箭头本身不出 confirm ✓，页面错误 0。
- S2 进屋：室外 4 个循环 fadeOut 1 s 停，室内 rain-on-roof / room-clock fadeIn 1 s 起 ✓。页面错误 0。
- t11-audio（第一版）里菜单 / S1 循环 / 脚步 / 日志几条 FAIL 是测试手法问题（URL 没带 art=1、钩子装晚了、墙钟按 W 3 s、tap 被吞），由本节取代；它的 Esc 暂停那条有效：ctx suspended、循环保留，再 Esc → running ✓。

## ⑦ Chrome 兼容冒烟（t11-compat.mjs，HeadlessChrome 156 + SwiftShader，S1 art=1）—— 通过
| 视口 | WebGL2 | 画布（内部 / CSS） | 压缩纹理扩展 | 进可玩墙钟 | 页面错误 |
|---|---|---|---|---|---|
| 1280×720 | ✓ | 1024×576 / 1280×720 | ✓ | 152 s | 0 |
| 1920×1080 | ✓ | 1536×864 / 1920×1080 | ✓ | 176 s | 0 |
| 2560×1440 | ✓ | 2048×1152 / 2560×1440 | ✓ | 201 s | 0 |
- 内部分辨率是 CSS 尺寸的 0.8 倍（渲染缩放），画布铺满；HUD 在。墙钟受机器负载（25–35）影响，只作参考。截图 compat-*.png。只测了这一个 Chrome 版本，其他浏览器 / 真 GPU 未测。

## ⑤-c 冒烟 art=1：014 S2 白盒 + 美术件（`SMOKE_QUERY=art=1`）—— 通过
- 一次通过：019 七件 + 地窖门扇挂合页、远景岛塔熄灭、白盒隐藏 ✓；**立镜 a / b** 挂院墙 socket、初始 / 正解镜面与 pivot = 白盒 ✓；**拨盘铁门**挂 gate-socket、站位差 0.0 mm、317 拨盘 rotation.z = −36k°、门扇开 78.0° ✓；白石组 / 眼位 / FOV 30 / 加亮 ✓；**光感锁**挂 light-lock-socket、透镜 #F4C978 0 → 1.6、指针 60° → −60°、门闩滑开 ✓。
- 同一轮 013 S1 art=1 ✗「S1 没就绪」（负载 30+ 下墙钟等待超时，和全量冒烟里 011 / 014 的「60 秒内没就绪」同类），单独重跑见 ⑧。
- 全量冒烟（art=0）跑到 015 后卡了 1 h 以上，已停掉，剩下的项拆成单项逐个跑（logs/q-*.log），结果见 ⑧。

## ⑧ 冒烟单项重跑（snap-cd22761，art=0，逐项 `SMOKE_ONLY`，logs/q-*.log）
- **010 场景流程 ✓**（BUG-016 回归）：S3 点灯 → 章节结束页、慢加载 S2→S3 进度线 7 帧（0.95→1.00）、释放场景组都过。全量里那次 ✗「慢加载没显示进度线」：负载 30+ 时淡出用了 2.43 s，4 s 慢加载在黑场前就加载完（load 段 0 ms），属负载，不是 bug。→ **BUG-016 已关闭**（f19a3c7，2026-10-30）。
- **005 字幕 / 阅读 / 日志 ✓**：全量里 ✗「J 没打开日志」是负载下按键被吞，单跑通过。
- **007 三级提示 ✓ / 011 潮汐 ✓ / 012 光路 ✓**：全量里分别 ✗「弹窗没换成 window_mirror」「60 秒内 s1-ebb-shore 没就绪」——都是负载下墙钟等待超时，单跑全过。
- **013 S1 白盒 + 谜题 1、2 ✓**：涨潮 1.6 / 敲钟退潮解谜题 1、浮台推进石槽涨潮浮到 1.85 两次跨越解谜题 2、2 s 漂回、R 重置、落水回岸台、交互物齐；同 run 里 ?art=1 部分（岩石 instancing、开场建立镜头、敲钟退潮）也过。→ 谜题 1、2 回归 PASS。
- **014 S2 白盒 + art=1 019 七件 ✓**：入口 / 海面 −16 / 室内触发体 ×2 / 出口 → s3 / 远景岛塔（熄灭）/ 地窖门扇挂合页都过。（014 part2 art=0 已在全量 logs/b11-smoke.log 里 ✓。）
- **017 S2 交互动作 art=1 ✓（道具：灯塔钥匙）**：风灯 xi-place-table 上桌、开日志；钥匙 xi-pickup-shelf grab 帧挂 middle_03_r（prop-key-lighthouse，跳动 1.0 cm，LOD0），播完收起、解锁；地窖 wetTarget 0 / 小院 1。→ 灯塔钥匙 PASS。
- **017 S1 / S3 交互动作 art=1 ✓（道具：油阀 / 窗口镜 / 塔门 / 点火口 / 拉杆）**：油阀 / 窗口镜 / 点火口挂到 oil-valve-s3-socket / guide-mirror-s3-window / ignition-port-s3-socket，站位 = 美术 -interact；塔门 doorStand = 关门时美术 -interact；白盒透镜球隐藏；开阀 xi-valve-hold 手轮转 90.0°；拉杆 xi-ignite-lever 点燃、拉杆 60.0°；点火口冷白 0.24 → 点燃暖 #FFB25E ×2.0；S1 推浮台缓入、S1/S3 敲钟也过。→ 剩余道具（灯塔钥匙见上、塔门、油阀、窗口镜）PASS；S2 落地镜已在 ⑤-c PASS。
- **015 S3 白盒 ✓**：桥尾入口、塔心 (39.73, −122.75) 转 135°、海面 y 1.6、室内触发体、无暖光、光路正解 窗口镜 → 导光镜 1 → 2 → 点火口；art=1 020 六件 + 门扇挂合页、导光镜 a/b 镜面 = 白盒（最大 0.000°）。
- **015 S3 谜题 5 ✓**：涨潮底层送回、敲钟退潮、开门撤碰撞（塔门）、先调镜后开阀（红光 +「没有油。」→ 开阀 1.0 s 进可点灯、不自动点燃）、光斑上升沿亮 + 共鸣、提示四步、21 个视角都选中拉杆、点灯独白 0.5–3.5 s 锁定只一次 → 章节结束。→ 谜题 5 回归 PASS。
- **021/022 替换入口 art=1 ✓**：S1/S2/S3 白盒节点名都在，未交付道具 0 请求（无 404），已交付件挂上（s1：钟 / 木筏；s2：落地镜 a/b、光感锁、白石、拨盘铁门；s3 同），钟锤阈值 0.0537。
- **014 part2 S2 谜题 art=1 ✓**（BUG-017 回归，logs/q-a1-014p2-now.log，负载 25–30 下约 40 min）。→ **BUG-017 已关闭**（9bbd158 + cd22761 的 S2 art=1 兼容）。art=0 的 014 part2 在全量 logs/b11-smoke.log 已 ✓。
- art=1 的 013 / 015 / 017 / 021 已在上面各单跑里一起跑过（这几项本身带 ?art=1 段），queue2 的重复项就没再跑。

## ⑥ S2 后半段 art=1 端到端 ✓（= 014 part2 art=1 单跑）
风灯放书桌（BUG-014 站位：读完日志默认视角选风灯 NDC 0.31，抬头仍选海图）→ 窗口暖光 → 西灯台被挡（光停在晾衣架 z −2.95，5 s 后独白）→ 东灯台 + 转镜 D/E/A 到 30° / 315°、R 重置 → 受光 1.5 s 光感锁开 → 地窖门转开 → 钥匙（目标换成 gate）/ 草图可读 → 观察点（眼位 (0.95, 4.35, 1.0) / FOV 30 / 角色隐藏；art=1 数字石块加亮，偏 34° 看不到、对准显影 + 风铃、离开看不到）→ 拨盘 316 不开、317 自动开门 + 退出机关、门扇碰撞关掉。全程 PASS。

## ③-e 风吹钟 6–14 s
- 静态：`verify-audio.mjs` 20 项全 ✓（含 sfx-bell-wind 三变体、`BELL_WIND_INTERVAL = [6, 14]`、`windTimer = nextBellWind()`）；代码：钟 12 m 内每次 fixedUpdate 减 dt，到 0 时发 sfx-bell-wind 并重抽 6 + rand×8 s；出 12 m 外计时器压到 ≤1 s。PASS（代码层）。
- 运行时实测：t11-wind（站钟旁按 fixedTick 计）在负载 27–31 下只有约 1 tick/s，40 s 游戏时间要约 40 min 墙钟，已中止；到钟旁立即响 1 次（sfx-bell-wind）已确认。**间隔 6–14 s 的运行时分布未实测（负载所限，标记不可验证）**，代码 / 静态校验 PASS。

## 汇总（batch11，master cd22761）
| 区域 | 结果 | 依据 |
|---|---|---|
| ① build / lint / test 300 | PASS | ① |
| ④ 体积 | PASS | menu 2.85 MB；首次 S1 下载 112.97（common 25.94 + s1 84.18）；s2 56.89；s3 16.12；接入 39 个未登记 art 后预计 121.63 / 124.49 |
| 道具（钟锤、拉杆、透镜、镜子 ψ、拨盘铁门 78°、光感锁、灯塔钥匙、塔门、油阀、窗口镜、点火口、S2 落地镜） | PASS | ③-a/b、⑤-a/b/c、⑧ 017 S1/S2/S3、015、021 |
| 白石 / 裁定 15–17 | PASS | ②-a/b/c（裁定 17 屋顶窗原始对准 0.40 但发光被 observing 门控为 0） |
| 032 音频（嗡鸣 / 连通 / UI / 循环 / 脚步 / 翻页 / 室内交叉淡化） | PASS | ③-a~d、verify-audio 20 ✓ |
| 风吹钟 6–14 s | PASS（代码 / 静态）；运行时间隔**未验证**（负载） | ③-e |
| 脚步按距离触发 | 按设计 | ③-d |
| BUG-016 回归（010） | PASS → 已关闭 | ⑧ |
| BUG-017 回归（014 part2 art=0 / art=1） | PASS → 已关闭 | ⑧ |
| S2 后半段 art=1 端到端 | PASS | ⑥ |
| 冒烟单项 005 / 007 / 010 / 011 / 012 / 013 / 014 / 014 part2 / 015 ×2 / 017 ×2 / 021 | 全 ✓ | ⑧（全量跑里的 ✗ 都是负载下墙钟超时，单跑全过） |
| 谜题 1–5 回归 | PASS | 013（P1/P2）、014 part2（P3/P4）、015 谜题 5 |
| Chrome 兼容 1280 / 1920 / 2560 | PASS | ⑦ |
| 新 BUG | 无（未开 BUG-018） | — |

未验证：风吹钟运行时间隔分布；③-a 淡入淡出曲线形状；全量冒烟一次跑完全绿（负载下只能逐项单跑）。
