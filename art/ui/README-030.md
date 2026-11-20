# 030 UI 美术 · 交付说明（最终版，R1–R5，2026-10-30）

需求单：`docs/tasks/v0.1-030-ui-art.md`。风格依据：`art/style/style-guide.md` §2（UI 色）、§6（UI 风格 / 字体）、§9（命名）；GDD §10、§12.2。只做桌面端，1080p 基准。

## 0. 交付状态

| 项 | 结果 |
|---|---|
| 运行时文件 | `art/ui/` 下 **21 个**（需求单 20 个 + `ui-paper-note.webp`），另有参考 `ui-style-tokens.css` 和本说明 |
| UI 运行时合计 | **1,533,136 B ≈ 1.46 MiB / 5 MB**（加载插画 260,492 B / 300 KB） |
| 验收自查 | 第 1–3 条通过；第 4 条要等程序接入 008 后由制作人看截图验收（§5） |
| 首场景包 common + s1 | 030 按需求单全部计入主菜单包，**common + s1 增量 0**，见 §4 |
| 各轮 | R1 风格板、R2 基础件（17:40 裁定后）、R3 纸张、R4 插画（18:27 用户确认）、R5 自查收尾。时间均为 UTC+7 |
| game/ | 没改，没 commit。接入由程序做（§2 的「用法」列和 §6 对照表） |

## 1. 裁定（用户 2026-10-30 UTC+7 确认）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 需求单要求源文件 `art/source/ui/ui-ch1.fig/.psd` | 改为 **SVG + 生成脚本 + 分层 PNG**，放 `art/source/ui/`（见 §8）。需求单由制作人 / 策划修改。 |
| 2 | 按钮：需求单写「细描边矩形」，GDD 写「无边框文字为主」 | 以 **GDD §12.2「UI｜标题字、按钮（无边框文字为主）…｜矢量/2x 位图」** 为依据：**只有主按钮带细框**（每屏最多一个，如弹窗「确定」、结束页「回到主菜单」、设置「返回」），**其余按钮都是纯文字**。 |
| 3 | `game/src/ui/styles.css` 色值与风格指南不一致 | **以风格指南为准**，由程序对齐 styles.css；对照表见 §6。美术不改 `game/`。 |
| 4 | 是否用 Cormorant Garamond | **不进游戏包**，数字 / 版本号 / 用时统一用思源宋体（`--ui-font-num`）。样张已换掉；字体文件已移出项目（备份在 `/workspace/bk-030/r2-before/fonts/`）；CREDITS 对应行已删。 |
| 5 | 三张没划线的纸条该用哪张纸（18:01） | **方案 1**：另出 `ui-paper-note.webp`（由信纸无划线层生成），给阿岩、汐、灯室三张纸条用；划线信纸只给没寄出的信。比需求单多 1 个文件。 |
| 6 | R4 插画（18:27） | 用户看过，通过。 |

## 2. 文件清单（art/ui/）

| # | 文件 | 尺寸 | 体积 | 用途 |
|---:|---|---|---:|---|
| 1 | `ui-title-logo.svg` | 309.7×126.2 矢量 | 2,002 B | 标题字（矢量） |
| 2 | `ui-title-logo.webp` | 856×406 | 60,918 B | 主菜单 / 加载页标题 |
| 3 | `ui-panel-frame.webp` | 224×224 9-slice | 526 B | 面板框 |
| 4 | `ui-panel-corner.svg` | 48×48 矢量 | 606 B | 面板角饰（和框图二选一） |
| 5 | `ui-button-primary.webp` | 192×144 9-slice | 1,586 B | 主按钮悬停光效 |
| 6 | `ui-button-secondary.webp` | 240×24 | 446 B | 文字按钮悬停下划线 |
| 7 | `ui-icon-interact.svg` | 24×24 | 355 B | 交互提示 |
| 8 | `ui-icon-hint-lantern.svg` | 24×24 | 551 B | 提示风灯 |
| 9 | `ui-icon-journal.svg` | 24×24 | 349 B | 日志 |
| 10 | `ui-icon-read.svg` | 24×24 | 480 B | 阅读 |
| 11 | `ui-icon-settings.svg` | 24×24 | 358 B | 设置 |
| 12 | `ui-icon-app-512.png` | 512×512 | 71,651 B | favicon / 应用图标 |
| 13 | `ui-paper-journal.webp` | 1088×1344 | 43,632 B | 阅读：笔记本 |
| 14 | `ui-paper-letter.webp` | 1088×1344 | 77,224 B | 阅读：没寄出的信（划线） |
| 15 | `ui-paper-note.webp` | 1088×1344 | 46,734 B | 阅读：三张纸条（需求单外 +1） |
| 16 | `ui-paper-sketch.webp` | 1088×1344 | 66,524 B | 阅读：草图 |
| 17 | `ui-paper-notice.webp` | 1088×1344 | 46,994 B | 阅读：告示 |
| 18 | `ui-paper-logbook.webp` | 1088×1344 | 46,368 B | 阅读：值班簿 |
| 19 | `ui-illust-loading.webp` | 1920×1080 | 260,492 B | 加载页（≤ 300 KB） |
| 20 | `ui-illust-chapter1-end.webp` | 1920×1080 | 387,508 B | 章节结尾（≤ 600 KB） |
| 21 | `ui-illust-menu.webp` | 2560×1440 | 417,832 B | 主菜单静态背景（≤ 800 KB） |
| | **运行时合计 21 个** | | **1,533,136 B** | ≈ 1.46 MiB |
| | `ui-style-tokens.css` | | 10,046 B | 样式参考，不是运行时资源 |
| | `README-030.md` | | — | 本说明 |

小计：R2 基础件 12 个 139,828 B；R3 纸张 6 张 327,476 B；R4 插画 3 张 1,065,832 B。

### 2.1 R2 基础件（细节）

| 文件 | 体积 | 规格 | 用法 |
|---|---:|---|---|
| `ui-title-logo.svg` | 2,002 B | 思源宋体 Regular 的「雾」「灯」字形转路径，字距 .38em；`fill=currentColor`，根节点 `color="#DCE1E4"`（雾白） | 矢量版：可任意缩放、CSS 改色；需要纯净字形时用 |
| `ui-title-logo.webp` | 60,918 B | 856×406 px（2x = 428×203 css px），雾白，带下缘渐隐（到 52%）、横向雾丝、柔辉光；四周各留 24 css px 辉光边 | 主菜单 / 加载页标题，`<img class="ui-logo">`；对齐字形时减掉 24 px 边 |
| `ui-panel-frame.webp` | 526 B | 9-slice，224×224 px（2x），四边各切 96 px（= 48 css px）。外线 #8C8F8E 38%、内侧 7 px 淡线 16%、四角罗盘星角括（与 ui-panel-corner.svg 同几何）；中间透明 | `border:1px solid transparent; border-image:url(ui-panel-frame.webp) 96 / 48px / 0 stretch;` 底色仍用 CSS `--ui-panel`；直角，不要圆角；内边距 ≥ 40 px |
| `ui-panel-corner.svg` | 606 B | 48×48，左上方向；外角括 + 内线（对齐 7 px 淡线）+ 四芒罗盘星；`stroke=currentColor`，`non-scaling-stroke` | 不用框图时的备选：四个 span 内联，其余三角 `scaleX/scaleY(-1)` 镜像；**和框图二选一** |
| `ui-button-primary.webp` | 1,586 B | 主按钮**悬停光效层**：9-slice，192×144 px（2x），四边切 56 px（= 28 css px）；琥珀 1 px 线 + 外辉光 + 内微光 + 四角 #FFD38A 小角标 | 按钮本体（细框、底、文字）是 CSS；光效放 `::before`（`inset:-21px; border:28px solid transparent; border-image:url(...) 56 / 28px / 0 stretch`），悬停时 opacity 0→1，不动画 box-shadow |
| `ui-button-secondary.webp` | 446 B | 文字按钮**悬停下划线饰条**：240×24 px（2x = 120×12 css），两端渐隐琥珀线 + 中心小菱形 + 柔光 | `::after` 固定 120 px 宽居中在文字下，悬停 `scaleX(0→1)` + 淡入；左侧小菱形是 CSS |
| `ui-icon-interact.svg` | 355 B | 圆 + 中心点 + 四向刻度（罗盘意象） | 交互提示；场景内用 `--ui-interact #A9BCC4` |
| `ui-icon-hint-lantern.svg` | 551 B | 提环 + 锥形灯罩 + 玻璃罩 + 火苗 + 圆油箱（对照道具 prop-lantern-brass） | 提示风灯；可交互态琥珀 |
| `ui-icon-journal.svg` | 349 B | 硬皮本 + 书签带 | 日志 |
| `ui-icon-read.svg` | 480 B | 摊开的书 + 字行 | 阅读 |
| `ui-icon-settings.svg` | 358 B | 三条滑杆 | 设置 |
| `ui-icon-app-512.png` | 71,651 B | 512×512，雾中白塔，灯室是唯一暖色，一道淡光束；方形满版（圆角交给系统） | favicon / 应用图标；16 / 32 px 已检查可辨认 |
| `ui-style-tokens.css` | 10,046 B | 色、字体、字号、面板 / 按钮 / 控件 / 图标 / 字幕样式（参考实现） | 给程序对齐 styles.css 用，不是运行时资源 |

图标统一规格：24×24 网格，1.5 px 单色线，圆头圆角，`stroke=currentColor`（常态 `#E4E8EA`，可交互 `#D9A257` + 微光，场景提示 `#A9BCC4`），每个带 `<title>`。

### 2.2 R3 阅读界面纸张（细节）

| 文件 | 尺寸 | 体积 | 用于（text-ch1 文档） | 纸面内容 |
|---|---|---:|---|---|
| `ui-paper-journal.webp` | 1088×1344 | 43,632 B | `ch1.s2.journal.doc`（含第 6 页汐的字迹，文字仍由叠加层出） | 笔记本页：蓝灰横格、左页边线、左侧装订阴影 + 线装针眼；右上 / 左下水渍、右下灯油渍、霉点 |
| `ui-paper-letter.webp` | 1088×1344 | 77,224 B | 只给 `ch1.s2.reply_draft.doc`（没寄出的信） | 信笺：淡红横格、顶部双线、三折折痕；**第 8–12 行是父亲划掉的五行字**（自绘笔画，不用字体：两行单划、两行双划、一行连圈涂掉），右侧水渍把墨洇糊 |
| `ui-paper-sketch.webp` | 1088×1344 | 66,524 B | `ch1.s2.sketch.doc` | 铅笔速写：四格窗框（外框 + 内框 + 十字窗棂 + 窗台）、窗外海平线、崖边（崖面排线、崖顶草）、四艘小船；擦痕、手蹭。**不画数字、不画白石**；船数刻意取 4（避开 3/1/7） |
| `ui-paper-notice.webp` | 1088×1344 | 46,994 B | `ch1.s1.notice.doc` | 印刷告示：粗细双边框、右上航运所灯塔徽记、中央浅印灯塔底纹、红色圆印「群岛航运所」（思源宋体，OFL）压在落款旁；四角钉孔 + 锈迹下淌、雨水竖条、底部大水渍 |
| `ui-paper-note.webp` | 1088×1344 | 46,734 B | `ch1.s1.neighbor_note.doc`、`ch1.s2.xi_note.doc`、`ch1.s3.ignition_note.doc` | 无划线纸条：由 `layers/ui-paper-letter/03-clean.png`（信笺格线 + 折痕，无划线）再加水渍 / 霉点；用户 18:01 选方案 1 |
| `ui-paper-logbook.webp` | 1088×1344 | 46,368 B | `ch1.s3.logbook.doc` | 值班簿表格：蓝灰印刷表格线（日期 / 时 / 天气 / 记事 四栏，表头印在正文第 2 行空行处）、左上挂绳孔；**第 4、5 行日期处一大块水渍 + 洇开的墨**，对应「日期被水洇掉」；右侧灯烟熏、霉点 |
| **R3 合计（6 张）** | | **327,476 B** | | R3 交付时 UI 合计 467,304 B |

**文字区域（读 game/src/ui/Reader.ts 与 styles.css，只读；无头 Chrome 1920×1080 实测）**：`.reader-paper` 544×672 css；标题 y 35–56；正文 x 38.4–505.6、y 起点 71.2、行距 32.3（17 px × 1.9）；翻页栏 y 624 起。纸张按这个尺寸的 2x 出图，横格线画在每行下沿（y = 71.2 + 32.3·(k+1) − 1.5），所以叠加文字正好落在格子里。水渍、霉点在文字区自动减弱；文字区中位对比度（正文色 #2c2a26 对纸色）8.5:1–10.3:1。

**建议 CSS（给程序，不改 game/）**：

```css
.reader-paper { background: #ddd5c3 var(--paper, none) center top / 100% auto no-repeat; }
.reader-paper[data-doc="ch1.s2.journal.doc"]     { --paper: url(ui-paper-journal.webp); }
.reader-paper[data-doc="ch1.s2.reply_draft.doc"] { --paper: url(ui-paper-letter.webp); }
.reader-paper[data-doc="ch1.s1.neighbor_note.doc"],
.reader-paper[data-doc="ch1.s2.xi_note.doc"],
.reader-paper[data-doc="ch1.s3.ignition_note.doc"] { --paper: url(ui-paper-note.webp); }
.reader-paper[data-doc="ch1.s2.sketch.doc"]      { --paper: url(ui-paper-sketch.webp); }
.reader-paper[data-doc="ch1.s1.notice.doc"]      { --paper: url(ui-paper-notice.webp); }
.reader-paper[data-doc="ch1.s3.logbook.doc"]     { --paper: url(ui-paper-logbook.webp); }
```

用 `100% auto` + 顶对齐：窗口矮于 862 px 时纸框变矮，只裁掉底部，横格不会和文字错位（`cover` / `100% 100%` 会错位）。

**已定（用户 2026-10-30 18:01 UTC+7，方案 1）**：划线信纸 `ui-paper-letter.webp` 只给没寄出的信；阿岩、汐、灯室三张纸条用无划线的 `ui-paper-note.webp`。超出需求单原定 5 张，多 1 张。

### 2.3 R4 插画 ×3（细节）

| 文件 | 尺寸 | 体积 | 上限 | 内容 |
|---|---|---:|---:|---|
| `ui-illust-menu.webp` | 2560×1440 | 417,832 B | 800 KB | 主菜单静态兜底（008 实时背景超预算时用）：黄昏雨中灯塔远景，塔在右三分之一，左侧留给 logo 和按钮；无光束、无暖色（暖色占比 0%） |
| `ui-illust-loading.webp` | 1920×1080 | 260,492 B | 300 KB | 雾中灯塔剪影（塔压暗成一块剪影，偏右，画面中间留给标题和进度线）；计入主菜单包 |
| `ui-illust-chapter1-end.webp` | 1920×1080 | 387,508 B | 600 KB | 点亮的灯塔，暖光束在雨中扫过海面，雾被推开一道口子，远处浮出第二座灯塔（F2）的黑色轮廓（GDD §117 / §412）；暖色占比 2.8%（指南上限：点灯高潮 ≈30%） |

合计 1,065,832 B。UI 运行时总计（art/ui 下 webp + svg + png）1,533,136 B，未超 5 MB。三张都是 RGB WebP（method 6，在上限内取最高质量，实际都是 q95）。

**做法（全部用自有资源）**
- 模型：S3 自有 GLB（灯塔、礁岛、石桥、门、灯室、菲涅尔透镜、远处灯塔剪影），按 s3-layout.json 的 S3 局部坐标摆放；远处灯塔放在 F2（θ80.3°，178.6 m）。
- 光照：029 烘焙光照贴图（`art/source/bake/s3/*.exr`，UV2）× 反照率，做成自发光，和游戏一样不加实时灯；结尾那张只有透镜发光。
- 大气：028 的天空渐变、云层贴图（tex-sky-clouds-overcast）、雾色 / 密度（礁岛和灯塔用 fogDensityHint）、远景雾墙（tex-fog-card-a）、雨色 / windTilt、辉光（9 m / 1.6）、光束噪声（tex-beam-noise）、LUT（菜单和加载用 overcast-dusk，结尾用 rain-night）。
- 三渲二后期：tex-ramp-env 半 Lambert 3 阶色阶（太阳方向同 029 烘焙）× 烘焙遮蔽，暗部乘蓝灰；背光侧冷色边缘光（#DCE1E4）；法线 + 深度 + 物体 ID 描边（约 1 px @1080p，线色是本色压暗 60% 后偏冷，不用纯黑，远处随雾淡出）；颗粒 0.025–0.035，轻微暗角。
- 结尾：光束用体积 raymarch（琥珀 #E8A24A，最亮处暖芯 #FFD38A），海面反射成碎的暖色闪光，光束里的雨丝被照暖。

**给程序的建议（未改 game/）**
- 主菜单：`background: url(ui-illust-menu.webp) center/cover`。样张 `030-ui-style-menu.png` 已经把占位图换成这张。
- 加载页：`.loading-screen { background: #0b0e12 url(ui-illust-loading.webp) center/cover; }`，可以在中间加一层很淡的暗色径向渐变托住文字（见 `030-ui-r4-loading.png`）。
- 章节结尾：`.chapter-end-art { background: url(ui-illust-chapter1-end.webp) center/cover; }`，隐藏 `.chapter-end-art-label`（aria-label 保留）。现在 styles.css 的框宽是 `min(420px, 80vw)`，这张图在 420 px 下也看得清（`030-ui-r4-end.png`）；如果框放宽到 840 px，2x 也够用（`030-ui-r4-end-wide.png`）。框宽由程序定。
  - **已定（18:31 UTC+7）**：框宽 840 px，2x 图（1920×1080）够用，效果见 `030-ui-r4-end-wide.png`。

## 3. 设计要点

- 冷灰为主，暖色只出现在：主按钮、悬停、强调光点、应用图标的灯室。
- 面板直角、细线；角上罗盘星（风格指南「角上小灯塔 / 罗盘纹样」取罗盘：40–48 px 的角里小灯塔剪影看不清）。
- 标题字只用思源宋体原字形，不改笔画；气氛全靠渐隐、雾丝、辉光。
- 位图一律 2x（GDD §12.2「矢量/2x 位图」）。


## 4. 体积与预算（R5 校验，18:29 UTC+7）

**UI 份额（需求单：UI 合计 ≤ 5 MB，算在主菜单包 15 MB 里）**

| 项 | 实际 | 上限 | 结果 |
|---|---:|---:|---|
| UI 运行时合计（21 个） | 1,533,136 B（1.46 MiB） | 5 MB | ✅ 用了 29% |
| `ui-illust-loading.webp` | 260,492 B | 300 KB | ✅ |
| `ui-illust-chapter1-end.webp` | 387,508 B | 600 KB | ✅ |
| `ui-illust-menu.webp` | 417,832 B | 800 KB | ✅ |
| `ui-icon-app-512.png` | 512×512 | 512×512 | ✅ |

**分包预算**：用 `game/scripts/check-size.mjs` 读现有 `game/dist`（17:57 构建）测得，没有重新构建，也没改 game/。单位按脚本的 MiB 计。

| 包 | 现在（dist 实测） | 加上 030 后 | 预算 |
|---|---:|---:|---:|
| 主菜单包 menu + boot | 2.91 | **4.37** | 15 |
| 首场景包 common + s1 | 125.43 | **125.43（+0）** | 150 |
| 首次进入 S1 总下载 menu + common + s1 | 128.34 | **129.80** | 150 |
| 再加 art/ 里已交付、还没登记的 8 个文件（脚本按文件名估算，s1 +0.81） | — | 首场景包 ≈ 126.24 / 总下载 ≈ 130.61 | 150 |

- 需求单把 UI 算进主菜单包，所以 030 **不占 common + s1**。按美术各单 README 的累计口径，首场景包仍是 **127.1 / 150 MB**（029 之后的数，030 +0）。
- 如果程序把纸张和结尾插画放进 common 按场景懒加载，common + s1 最多 +0.68 MiB（全部 UI 都进 common 也只是 +1.46 MiB，即 126.89 MiB）。三项都在预算内。
- `check-size.mjs` 估算时会跳过 `art/ui/`，所以登记进清单前，`npm run size` 里看不到这批文件。分组和清单登记由程序定。

## 5. 验收自查（对照需求单验收标准）

| # | 标准 | 结果 | 依据 |
|---|---|---|---|
| 1a | 文件齐全 | ✅ | 需求单 20 个全部都有，没有缺的；另有 `ui-paper-note.webp`（裁定 5） |
| 1b | 命名统一 | ✅ | 全部小写加连字符，符合 `ui-<类别>-<名称>`（风格指南 §9）；`README-030.md` 沿用项目 README 惯例 |
| 1c | 配色按指南 §2 UI 色 | ✅ | tokens 里正好是 §2 的 8 个值（#1A2128 80% / #8C8F8E / #D9A257 / #FFD38A / #E4E8EA / #8B959D / #A9BCC4 / #B5584F）。位图抽色：主按钮光效 ≈ #D9A257，面板框 ≈ #8C8F8E，标题雾白 #DCE1E4。插画暖色只用在结尾灯光（2.8%） |
| 2 | 图标是单色细线 SVG，CSS 可改色 | ✅ | 5 个图标都是 24×24，`stroke="currentColor"` `stroke-width="1.5"` `fill="none"`（interact 的中心点 `fill="currentColor"`），没有写死颜色、文字或位图；面板角饰同样用 currentColor |
| 3 | UI 合计 ≤ 5 MB，加载插画 ≤ 300 KB | ✅ | 1,533,136 B；260,492 B（§4） |
| 4 | 接入 008 后，主菜单、暂停、阅读、结尾页风格统一（制作人看截图验收） | ⏳ 等接入 | 美术没法自己验，因为这条要接进 game/ 之后才能看。现有依据：用真实 DOM 结构和 styles.css 拼的样张 `030-ui-style-{menu,pause,hud}.png`、`030-ui-r3-*.png`、`030-ui-r4-{loading,end}.png`。程序接入后要重新截图给制作人 |
| — | 源文件 | ✅（按裁定 1 改了形式） | 需求单写 `.fig/.psd`，用户裁定改为脚本 + 分层 PNG（§8） |
| — | 授权 | ✅ | 全部自制，只用思源宋体 / 黑体（SIL OFL 1.1）；每个文件和源路径在 `art/CREDITS.md` 都有对应行 |

## 6. Token 差异对照表（styles.css 旧值 → ui-style-tokens.css 新值）

以风格指南 §2 为准。左列是 `game/src/ui/styles.css` 第 3–15 行现有 token。

| 用途 | 旧 token | 旧值 | 新 token | 新值 | 说明 |
|---|---|---|---|---|---|
| 面板底 | `--ui-bg` | `rgba(26,33,40,.8)` | `--ui-panel` | `rgba(26,33,40,.80)` | 值相同（#1A2128 80%），只是改名；可保留旧名 |
| 面板不透明底 | — | — | `--ui-panel-solid` | `#1A2128` | 新增：滑杆菱形钮等 |
| 面板描边 | `--ui-border` | `rgba(228,232,234,.22)`（偏白） | `--ui-stroke` | `#8C8F8E` | §2「面板描边」是暖一点的中灰，不是白；面板改用 ui-panel-frame.webp 后外线 = 38% |
| 弱描边 / 分隔线 | — | — | `--ui-stroke-soft` | `rgba(140,143,142,.38)` | 新增：分隔线、日志目标下划线等原来用 `--ui-border` 的地方 |
| 正文 | `--ui-text` | `#d5dde4` | `--ui-text` | `#E4E8EA` | 改值 |
| 线色 / 标题字 | `--ui-line` | `#e4e8ea` | `--ui-text` | `#E4E8EA` | 值相同，并入 `--ui-text`；主菜单标题改用 ui-title-logo |
| 次要文字 | `--ui-dim` | `#8b98a4` | `--ui-text-2` | `#8B959D` | 改值 |
| 主按钮 / 琥珀线 | `--ui-amber` | `#f2b072` | `--ui-primary` | `#D9A257` | 改值：边框、进度条、hold 圆环满格、提示火苗 |
| 琥珀（另一个名字） | `--ui-warm` | `#f2b072` | `--ui-primary` / `--ui-accent` | `#D9A257` / `#FFD38A` | 拆开：**线和填充**用 `--ui-primary`；**悬停 / 选中时的文字**用 `--ui-accent` |
| 强调 | — | — | `--ui-accent` | `#FFD38A` | 新增：悬停文字、光点 |
| 琥珀光晕 | `--ui-amber-glow` | `rgba(242,176,114,.35)` | `--ui-glow` | `rgba(217,162,87,.32)` | 改值 |
| 可交互提示 | —（写死） | `#a9bcc4` / `rgba(169,188,196,…)` | `--ui-interact` | `#A9BCC4` | 值相同，建议提成 token |
| 警告 | — | — | `--ui-warn` | `#B5584F` | 新增：存档失败等 |
| 文字阴影 | — | — | `--ui-shadow-text` | `0 1px 2px rgba(10,14,18,.85), 0 0 12px rgba(10,14,18,.55)` | 新增：字幕、HUD 文字 |
| 正文字体 | `--ui-font` | Foglight Sans → 思源黑体… | `--ui-font-body` | 同左 | 不变 |
| 标题字体 | `--ui-serif` | Foglight Serif → 思源宋体 → … **'Cormorant Garamond'** → … | `--ui-font-title` | Foglight Serif → 思源宋体 | **删掉回退列表里的 'Cormorant Garamond'**（裁定 4） |
| 数字字体 | — | — | `--ui-font-num` | `= --ui-font-title` | 新增：用时、音量值、版本号统一宋体 |
| 字号 / 字距 | — | — | `--fs-logo 132` `--fs-h1 30` `--fs-menu 21` `--fs-body 16` `--fs-small 13` `--fs-subtitle 26（22/32）` `--track-title .32em` `--track-menu .28em` | | 新增；现有 `.ui-heading`、`.pause-panel h2` 的 .5em 建议收到 .32em |
| 动效 | — | `transition: … .15s` | `--dur` / `--ease` | `220ms` / `cubic-bezier(.25,.1,.25,1)` | 新增 |

### 6.1 写死的值（建议一并换成 token；行号是 2026-10-30 的 styles.css）

| 行 | 选择器 | 现在 | 建议 |
|---:|---|---|---|
| 124 | `.loading-track` | `rgba(255,255,255,.08)` | `rgba(139,149,157,.35)`（见 tokens `.ui-progress`） |
| 131–132 | `.loading-bar` | `--ui-warm` 填充 + 光晕 | 进度线用 `--ui-text` + 雾白微光（tokens `.ui-progress`）；暖色留给主按钮 |
| 220 | `.hud-prompt` | 文字 `--ui-warm` | 文字 `--ui-text`，图标 `--ui-interact`；仅「可执行」状态用 `--ui-primary` |
| 228–229 | `.hud-prompt.is-disabled` | `#7d878d` / `rgba(125,135,141,.35)` | `--ui-text-2` + `opacity:.55` |
| 245、254、287、291 | `.hud-marker` / `.hud-hold-*` | `#a9bcc4`、`rgba(169,188,196,…)` | `--ui-interact`（值不变） |
| 342、382、419–427、715、1080 | `.pause-panel` / `.seg-btn` / `.journal-panel` / `.hint-panel` 等 | `border-radius: 4–6px` | `0`（直角细线） |
| 376–384 | `.menu-btn` / `.seg-btn` | 半透明底 + `--ui-border` 框 | **裁定 2**：普通按钮改纯文字（tokens `.ui-btn`）；分段选择用 tokens `.ui-seg`（选中 = 雾白下划线） |
| 404–405、838–839 | `.menu-btn.primary` / `.menu-btn.small.on` | 边框 `rgba(242,176,114,.5)`、文字 `--ui-warm` | 主按钮：边框 `rgba(217,162,87,.55)`、文字 `--ui-text`，悬停 `--ui-accent` + ui-button-primary.webp 光效；`.small.on` 改 `.ui-seg .on` |
| 589 | `.subtitle-line` | `#e4e8ea` | `--ui-text` + `--ui-shadow-text` |
| 741 | `.journal-goal-text` | `#8b959d` | `--ui-text-2`（值已对） |
| 773、1109 | `.journal-entry:hover` / `.hint-level` | `--ui-warm` | `--ui-accent` |
| 783–803 | `.ui-panel` / `.ui-panel::before` | `--ui-border` 框 + CSS 画的小灯塔占位 | `border-image: ui-panel-frame.webp`（见 §2.1），删掉 `::before` 占位纹样 |
| 879–886 | `.main-title` | 文字 64 px，`--ui-line` | 换 `<img src="ui-title-logo.webp">`（或 .svg） |
| 895–898 | `.main-btn` | 带底色框 | 纯文字按钮（tokens `.ui-btn`） |
| 904 | `.main-notice` | `--ui-warm` | `--ui-text-2`（提示文字不用暖色） |
| 1008 | `.chapter-end-art` | 径向渐变占位 `rgba(255,176,102,…)` | R4 换 `ui-illust-chapter1-end.webp` |
| 1063 | `.hint-flame` | `--ui-warm` | `--ui-primary`，或直接用 ui-icon-hint-lantern.svg |

`.joystick-*`、`.touch-btn`（第 494–532 行）是移动端控件，本单只做桌面端，不在对照范围。

## 7. 预览

`art/source/ui/preview/`：
- `030-ui-style-sheet.png`：风格总板（字体、配色、面板、按钮各状态、图标）
- `030-ui-style-menu.png`、`030-ui-style-pause.png`、`030-ui-style-hud.png`：主菜单、暂停 + 设置、游戏中 HUD 示意（主菜单背景已在 R4 换成 ui-illust-menu.webp）
- `030-ui-style-r2-assets.png`：R2 全部文件实物 + 体积
- `030-ui-r3-papers.png`：8 份文档 × 对应纸张总表（真实 Reader 结构 + game 的 styles.css + text-ch1.json 原文）
- `030-ui-r3-{journal,letter,sketch,notice,logbook}.png`：每张纸在 1920×1080 阅读界面里的实际效果（日志为第 2 页）
- `030-ui-r4-illust.png`：三张插画总表（含体积）；`030-ui-r4-loading.png`：真实 LoadingScreen 结构 + 加载插画；`030-ui-r4-end.png` / `030-ui-r4-end-wide.png`：真实 ChapterEnd 结构，框宽分别为 420 px（现值）和 840 px（已定，程序 18:31）
- `030-ui-style-*` 和 `030-ui-r4-*` 的背景都已经是正式插画；`style/backdrop-menu.png` 是 R1 的占位图，R4 之后没有页面再用它，只留作记录

## 8. 源文件与重建（代替 .fig / .psd，裁定 1）

| 路径 | 内容 |
|---|---|
| `art/source/ui/build-ui-r2.py` | 生成 ui-title-logo（svg + webp）、ui-panel-frame、ui-button-primary/secondary、ui-icon-app-512；固定种子 |
| `art/source/ui/src/ui-panel-frame.svg` | 框图的矢量源（脚本生成，复用 ui-panel-corner.svg 几何） |
| `art/source/ui/layers/<资源名>/NN-*.png` | 分层 PNG：每层单独存（alpha 层 / 遮罩 / 辉光 / 合成 `99-composite.png`），可在任何图像软件里叠回去修改 |
| `art/source/ui/tools/svg2png.mjs` | SVG → PNG（用 art/tools 里的 sharp / librsvg） |
| `art/source/ui/style/` | 样张页面生成（build-pages.py）、占位背景（gen-backdrop.py）、截图（render.mjs，自起独立 profile 的无头 Chrome） |
| `art/source/ui/build-ui-r3.py` | 生成 6 张纸（note 读 letter 的 03-clean.png，须在 letter 之后跑）（固定种子 3030+）；分层导出到 `layers/ui-paper-*/`（底纸 / 格线 / 笔画 alpha 层 / 成品，信纸另有 `03-clean.png` 无划线版）；运行时打印体积和文字区对比度 |
| `art/source/ui/style/build-pages-r3.py` | R3 预览页（读 game/ 的 styles.css 和 text-ch1.json，只读） |
| `art/source/ui/illust/prep-glb.mjs` | 把游戏 GLB（meshopt + 量化 + KTX2）还原成 Blender 能读的 GLB：只留 LOD0，贴图换回 `art/source/textures` 里的同名 PNG，保留 UV2；输出到 /workspace/b030/r4/glb（中间文件，不进仓库） |
| `art/source/ui/illust/render-illust.py` + `shots.json` | Blender 4.2 Cycles 渲染：镜头、028 天空和雾墙、029 光照贴图自发光；输出 Image / Depth / Normal / Position / IndexOB / lm 通道 |
| `art/source/ui/illust/post-illust.py` | 三渲二后期，参数在 `shots.json` 的 post 段；分层导出到 `layers/ui-illust-<shot>/00-render … 06-final.png` |
| `art/source/ui/illust/encode-illust.py` | PNG → WebP，在体积上限内取最高质量 |
| `art/source/ui/style/build-pages-r4.py` | R4 预览页（读 game/ 的 styles.css 和 text-ch1.json，只读） |
| `art/ui/ui-icon-*.svg`、`ui-panel-corner.svg` | 手写 SVG，本身就是源 |

重建：`python3 art/source/ui/build-ui-r2.py && python3 art/source/ui/style/build-pages.py && node art/source/ui/style/render.mjs`

R3 重建：`python3 art/source/ui/build-ui-r3.py && python3 art/source/ui/style/build-pages-r3.py && PREFIX=030-ui-r3- node art/source/ui/style/render.mjs r3-papers:papers,r3-reader-journal:journal,r3-reader-letter:letter,r3-reader-sketch:sketch,r3-reader-notice:notice,r3-reader-logbook:logbook`

R4 重建（Blender 在 /home/box/tools/blender/blender；每张渲染约 40 s，后期约 20–50 s，8 核）：
```
M=art/models; node art/source/ui/illust/prep-glb.mjs /workspace/b030/r4/glb $M/env/env-lighthouse-ch1.glb $M/env/env-rock-islet-a.glb $M/env/env-stone-bridge-s3.glb $M/env/env-lighthouse-ch1-door.glb $M/env/env-lighthouse-silhouette-far.glb $M/env/env-lamp-room-ch1.glb $M/props/prop-fresnel-lens-ch1.glb
for s in "menu 2560 1440" "loading 1920 1080" "end 1920 1080"; do set -- $s
  blender -b --python art/source/ui/illust/render-illust.py -- $1 $2 $3 32 /workspace/b030/r4/f-$1
  python3 art/source/ui/illust/post-illust.py $1 /workspace/b030/r4/f-$1 /workspace/b030/r4/f-$1.png art/source/ui/illust/layers/ui-illust-$1; done
python3 art/source/ui/illust/encode-illust.py /workspace/b030/r4/f-menu.png art/ui/ui-illust-menu.webp 800   # loading 300 / end → ui-illust-chapter1-end.webp 600
python3 art/source/ui/style/build-pages.py && python3 art/source/ui/style/build-pages-r4.py
node art/source/ui/style/render.mjs mock-menu:menu,r2-assets:r2-assets && PREFIX=030-ui-r4- node art/source/ui/style/render.mjs r4-loading:loading,r4-end:end,r4-end-wide:end-wide,r4-illust:illust
```

分层 PNG 体积：`layers/` 纸张 + 基础件约 20 MB，`illust/layers/` 约 34 MB。都是源文件，不进游戏包。

## 9. 遗留问题（交给程序 / 制作人）

| # | 事项 | 由谁 |
|---|---|---|
| 1 | 把 21 个文件登记进 `src/assets/manifest.ts`。需求单意思是放主菜单包；纸张和结尾插画如果改成懒加载也可以，预算见 §4 | 程序 |
| 2 | 按 §6 对齐 styles.css 的 token 和写死值，以及 §2 的 CSS 用法（美术没改 game/） | 程序 |
| 3 | ✅ **已定**（2026-10-30 18:31 UTC+7）：结尾页插画框宽 **840 px**（程序定）；对应样张 `030-ui-r4-end-wide.png` | 程序 |
| 4 | 接入后截主菜单、暂停、阅读、结尾页四张图给制作人，验收第 4 条 | 程序 → 制作人 |
| 5 | 需求单里的「源文件 .fig/.psd」改成「脚本 + 分层 PNG」（裁定 1）；文件数从 5 张纸改成 6 张（裁定 5） | 制作人 / 策划 |
| 6 | `npm run size` 要先构建 dist，美术没跑；§4 的数是读现有 dist 得到的。接入后以程序重新构建的结果为准 | 程序 |
| 7 | 菜单实时背景（008）如果在预算内，`ui-illust-menu.webp` 只当兜底；可不可以不进包由程序定 | 程序 |
