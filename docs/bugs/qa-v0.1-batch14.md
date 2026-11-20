# QA v0.1 batch14 — master 8ad6b9b（03130cc 之后 21 个提交）

- 快照：/workspace/qa-tools/snap-8ad6b9b（`git archive 8ad6b9b`；art / docs 软链到工作区；package-lock 与 03130cc 相同，node_modules 硬链 snap-03130cc）。
- 方法：无头 Chrome（SwiftShader 软件渲染），冒烟逐条串行，按固定步 / 游戏时间判定，不判 fps。每查完一项立即追加。截图与数据：qa-v0.1-batch14/。

## 汇总（23:00 之后续跑完成；时间都是 UTC+7）

| # | 项目 | 结果 | 备注 |
|---|---|---|---|
| ① | npm run check（含 test:lightmap） | PASS | 包体：菜单 3.70/15、common+s1 126.10/150、首次进 S1 129.81/150 MB；lightmap 12.27 MB，uv1 越界 0，船绳正常 |
| ①-b | 030 manifest 与重建 | PASS | 21 条 art/ui |
| ② | 030 UI 验收第 4 项 | PASS（带 2 个 P3） | BUG-021、BUG-022 |
| ③ | BUG-019 返工（629ca5b） | PASS → closed | 60 Hz 每帧最大 0.402 m、无回弹；冒烟 019 sample-317 A=3 B=0 |
| ④ | BUG-020（b591c5b） | PASS → closed | 室内雨剔除正常 |
| ⑤ | 美术修复：S3 礁岛 / 楼梯、clifftop UV2、船绳 lightmap | PASS | |
| ⑥ | S1 脚印贴花 | PASS | 4 块在湿沙上、离地 1.2–1.9 cm、不在礁石上；T2 弹台词、小径尽头不弹；白盒暗斑 0/10 可见 |
| ⑦ | 父亲 031 S3 art=1 | QA 侧手动加载 PASS；游戏内未接入 → 无法验证 | BUG-023（P3）；LOD 切换、3 段动画、无明显穿模 |
| ⑧ | 回归冒烟 003/005/007/008a1/010/013a0/013a1/014a1/015a1/017/019/021-022 | 全部 PASS | 都是 EXIT 0，没有 ✗ |

Bug：019 closed、020 closed；新开 021 / 022 / 023（都是 P3）。


## ① npm run check（一次跑完，日志 qa-v0.1-batch14/b14-check.log，22:12–22:25 UTC+7）
- **EXIT 0**：typecheck ✓ → lint ✓（eslint 无输出 = 0 error / 0 warning）→ npm test ✓（343 个 ✓、0 个 ✗）→ build ✓ → size ✓ → css ✓。
- 包体（check-size）：
  | 包 | 实测 | 上限 | 程序报 |
  |---|---|---|---|
  | menu+boot | **3.70 MB**（28 个文件） | 15 | 3.70 ✓ |
  | common+s1 | **126.10 MB** | 150 | 126.10 ✓ |
  | 首次进 S1 总下载 | **129.81 MB** | 150 | 129.81 ✓ |
  - 另有 16 个已交付但未登记的文件（s1 3.22 MB，s3 9.79 MB）。全部接入后预计 129.32 / 133.02 MB，仍在预算内。
- test:lightmap ✓：9 张 KTX2 合计 12.27 MB（batch13 是 12.40 MB）；18 个 GLB 的 uv1 都在 rect 内，**出 rect 顶点 0**（48e320e 已收紧为必须 0）；码头船绳 -rope-high / -rope-low_1 / -rope-low_2 都挂 tex-s1-shore-lightmap，切潮 4 次不变。
- verify-camera ✓：BUG-019 新加的真实路径用例（S2 白盒碰撞 + 角色胶囊 + 相机碰撞，60 / 30 Hz 各 384 组）：
  - 60 Hz 单帧最大 0.402 m，上限 0.6；回弹 0。
  - yaw 270 −15 外走：0.027 m/帧（原 2.63）。
  - yaw 315 −15 外走：0.027 m/帧，回弹 0（原 1.89 / 1.48）。
  - 出带恢复：0.350–0.351 m/帧（原 0.70–0.90）。
  - 注意：断言文字写的是「不高过真实限高」，但输出里有「高过真实限高最多 0.019 m」（30 Hz 0.017 m），说明有容差。容差很小，记录在此，不报 bug。浏览器复测见 ②。
- verify-atmo028 ✓：BUG-020 室内雨剔除，S2 5 内 / 6 外，S3 5 内 / 5 外；塔内溅水 0，塔外存活 360。浏览器复测见 ③。

## ①-b 030 manifest 与源脚本重建（22:13–22:17）
- **manifest**：src/assets/manifest.ts 里 art/ui 共 21 条，和 art/ui 下 21 个运行时文件一一对应（diff 为空；README、tokens.css 不算）。dist/assets/art/ui 也是 21 个文件，和 art/ui 逐字节相同。分组：主菜单、加载页和通用件 14 个进 menu（panel-corner 和 illust-menu 懒加载）；6 张纸和结尾插画进 common，全部懒加载。**PASS**
- **重建**：把 art/source/ui 和 art/ui 复制到 /workspace/qa-tools/artcopy，在副本里跑，原目录没动。
  - `build-ui-r3.py` EXIT 0，用时约 45 s。6 张纸 journal / letter / sketch / notice / logbook / note 重新生成，**和交付件逐字节相同**。
  - `build-ui-r2.py` 第一次失败：副本里缺 art/tools（sharp 装在那里），属于副本环境问题。软链 art/tools 后 EXIT 0，用时约 10 s。ui-title-logo.svg/.webp、ui-panel-frame、ui-button-primary/secondary、ui-icon-app-512 共 6 个文件重新生成，**和交付件逐字节相同**。
  - 没有重建的：5 个 svg 图标和 ui-panel-corner.svg（README 没写由哪个脚本生成）；3 张 R4 插画（要用 Blender，每张约 1 min）。按「快的话试试」只做了 r2 / r3。
  - 结论：r2 + r3 共 12 个文件可以重建、结果一致 → **PASS（部分；图标和插画未试）**。


## ② 030 UI 验收第 4 项（截图 qa-v0.1-batch14/ui-720、ui-1080、ui-qa）

- 程序 4 张（030-menu / pause / read-journal / end，1920×1080）已看，与下列实测一致。自截 1280×720（ui-720/，15 张）+ 1920×1080（ui-1080/，15 张），脚本 snap 内 scripts/qa-shots-030.mjs（加了逐屏 style 探针）+ /workspace/qa-tools/t14-ui.mjs。
- 琥珀/高亮：主按钮框 1px rgba(217,162,87,.55)，悬停 → 框 #D9A257、字 rgb(255,211,138)=#FFD38A、`::before` 光效 opacity 0→1（ui-button-primary.webp 9-slice，过渡 0.22s），截图 ui-qa/hover-primary-cmp.png 可见辉光+四角角标 ✓；文字按钮悬停 #FFD38A + 琥珀 text-shadow + 小菱形 ✓。
  - 注：程序的 030-menu-hover-primary.png（和我第一次照抄的脚本）**没有**辉光——原因是脚本 `querySelector('.main-menu .menu-btn.primary')` 命中第一个隐藏的主按钮（“继续”，rect 0×0），鼠标移到 (0,0)，不是游戏问题。只是截图脚本问题，建议程序改选可见的那个再截一次。
- 直角：所有可见元素 border-radius 非零个数 0 ✓。只有主按钮带细框（新游戏 / 设置“返回” / 暂停“继续” / 结尾“回到主菜单”），其余均无框文字按钮 ✓。
- 字体：几乎所有可见文字都是 'Foglight Serif'/'Foglight Sans'（思源子集）→ Noto/Source Han 回退 ✓。**例外**：阅读器翻页箭头 `.reader-arrow`（‹ ›，仅多页文档如父亲日志出现）计算字体 = Arial —— button 没有 `font: inherit`，`.reader-nav` 的 font-family 没继承到 button → **BUG-022（P3）**。
- 素材挂载：logo（img ui-title-logo.webp 已加载，naturalWidth 856）、面板 9-slice（.settings-panel border-image ui-panel-frame.webp slice 96 / 48px）、主按钮光效、5 个图标（interact / hint-lantern / journal / read / settings，CSS 变量全部指到 assets/art/ui/；菜单设置页实际挂出 4 个 mask，read 在阅读提示时用）、loading 插画、favicon + apple-touch-icon = ui-icon-app-512.png ✓。
- 6 张阅读纸（720 与 1080 都测）：journal / letter / note / sketch / notice / logbook 全部 state=ready、key 正确；neighbor_note / xi_note / ignition_note 三张便条都用 ui-paper-note ✓；正文 bodyTop 71.2，字底到格线距离各行恒为 2.8 px（文字坐在线上、不压线）✓；notice 无格线、sketch 是画（格线检测不规则属正常）。拼图 ui720-grid-read.jpg。
  - **值班簿（logbook）**：横线对齐 ✓，但纸上印的 4 列表格（日期 / 时 / 天气 / 记事）与正文列不对齐：“夜”“雾”压在竖线上，“（水渍，日期看不清）”横跨时/天气两列，记事内容从天气列开始（裁图 logbook-crop-720.png；程序 1080 截图同样，logbook-crop-prog1080.png）。另外标题“值班簿”在页眉和正文首行重复出现 → **BUG-021（P3）**。
- 结尾“回到主菜单”：720p rect [557,652,167,45]，bottom 696/697 ≤ 720 ✓；1080p [877,858,167,45] ✓。结尾插画 1080 宽 840×472.5。
- 懒加载：进 S1 后（未开阅读器）ui-paper-* / chapter1-end / ui-illust-menu 请求 = 0；每张纸只在打开对应文档时请求 ✓。
- 失败兜底（CDP Network.setBlockedURLs 屏蔽 ui-paper-journal / ui-paper-letter / ui-illust-chapter1-end，720p）：journal、letter → data-paper=fallback、无背景图、纯色 rgb(221,213,195) ✓（ui-qa/fallback-read-journal.png）；未屏蔽的三张便条仍 ready ✓；结尾 data-art=fallback，换成琥珀径向渐变兜底、按钮仍在视口内 ✓（ui-qa/fallback-end-720.png）。
  - 本次运行另有 tex-rock-shore-albedo.ktx2 “Failed to fetch（3 次）用占位”——不在屏蔽名单里，属于 box 负载下的偶发抓取失败（batch13 同类），不记 bug。
- `?menuBg=illust` → data-bg=illust，菜单背景换成插画塔 ✓（ui-720/030-menu-illust.png）。
- 结论：**PASS**，带 2 个 P3（BUG-021 值班簿列不对齐 + 标题重复、BUG-022 翻页箭头 Arial）。

## ③ BUG-019 回归（629ca5b，真实角色胶囊）

- 脚本 /workspace/qa-tools/t14-cam19.mjs：S2 art=1，传送真实 CharacterBody，按目标方向给 body.velocity，逐帧 `physics.step(dt)` → 跟随目标 = body.position → `cameraFollow.update(dt)`（真实物理遮挡 + 限高带）。统计非物理拉近/推远的每帧位移，弹跳 = 1 s 内非物理外推 ≥0.3 后又内拉 ≥0.3。8 路径 × 8 yaw × 俯仰 −15/−30/−40 × 走 1.6/跑 3.2 = 384 组。数据 qa-v0.1-batch14/cam19-60.json、cam19-30.json，log logs/b14-cam60.log、b14-cam30.log。
- batch13 的三类用例（60 Hz）：沿视线出 yaw 270 −15 走/跑 0.027/0.053（batch13 是 2.63）✓；yaw 315 −15 0.027/0.053，弹跳 0（batch13 是来回 1.89/1.48）✓；出带恢复 yaw 180 −40 0.35、横出 yaw 90 −30/−40 0.027、横出 lat→−6 yaw 180 −15 跑 0.402（batch13 是 0.60–0.90）✓。
- 60 Hz 全 384 组：maxNP 0.402 m/帧、over(>0.6)=0、bounce=0、stuck=0 ✓（与 verify-camera 真实路径 0.402 一致）。
- 30 Hz 参考：maxNP 0.804 m/帧 = 同样 24 m/s（每秒速率不变，只是帧长加倍），bounce 0；要求只针对 60 Hz，不判。
- smoke 019 sample-317（runq14.sh，log logs/q14-019.log）：EXIT 0，A 簇 3、B 簇 0 ✓。
- verify-camera 在 ① npm run check 里已过 ✓。
- 结论：**PASS → BUG-019 关闭**。

## ④ BUG-020 回归（b591c5b，室内雨剔除）

- 脚本 /workspace/qa-tools/t14-rain.mjs（960×540，art=1，atmo=rain-night，standard）：传送角色 + 设相机 yaw，同一机位拍「有雨 / rain.visible=false」两张，差分 ×12。图与拼图在 qa-v0.1-batch14/rain/（g-s2a.jpg、g-s2b.jpg、g-s3.jpg、win-cmp.jpg），数据 rain/s2.json、s3.json。
- 场景里的室内体积：S2 = 2 个（石屋盒 c(−2,3.45,1) 半径(3.4,3.45,2.4)；地窖盒 c(−0.6,−1.2,1) 半径(2,1.2,2.4)）；S3 = 1 个圆柱（塔心 39.73,−122.75，r=3，高 24.5）——与 verify-atmo028 的设计一致。
- S2 石屋一层 4 个朝向 + 前门内 2 个、S2 地窖 2 个朝向：相机都在室内（indoor=true、culledAt(cam)=true），差分只剩汐的待机动作轮廓，**画面里没有雨丝、没有溅水** ✓。
- S3 塔内（先 tide.set('low')，不然高潮会触发“水太冷了”送回）：塔心 4 个朝向 + 贴内壁 1 个，相机都在塔内体积里，差分同样只有角色轮廓 ✓。（rain-night 下塔内很暗，看不清雨不代表剔除了，所以以差分为准。）
- 窗外 / 门外：S2 前门内朝外的机位（door-in-y180），雨丝只出现在窗玻璃区域（win-cmp.jpg）✓；S2 前门外 2 机位、S3 塔门外 2 机位差分都是满屏雨丝 + 地面溅水 ✓。
- 数值部分（verify-atmo028：S2 5 内 / 6 外、S3 5 内 / 5 外，塔内溅水 0，室外存活 360）已在 ① 记过 ✓。
- 局限：SwiftShader 的静帧；没看过雨丝在门槛上淡出的动态过渡，只确认了室内机位整帧没雨。
- 结论：**PASS → BUG-020 关闭**。

## ⑤ 美术修复（S3 塔内礁岛 / 楼梯、clifftop UV2、船绳光照贴图）

- S3 塔内截图（程序 shots-029.mjs 的 QA 副本 scripts/qa-shots-029.mjs，只改输出目录，s3 lm1 floor / room / room-doorclosed）：qa-v0.1-batch14/s29/s3-floor-lm1.png、s3-room-lm1.png（提亮版 *-bright.jpg）。塔内看到的是塔内地板的石板，没有礁岛岩面盖在上面；楼梯第一级从地板上起步，看得到踢面，没被埋 ✓。
- 顶点检查（/workspace/qa-tools/t14-reef.mjs，数据 qa-v0.1-batch14/s3-reef.json）：塔心 r<2.8 / r<3.0 范围内高于 0.3 m 的顶点全部来自 **不可见的** env-rock-islet-a-collider（136 个，y=0.5 的平板）和塔内自身网格；可见的礁岛网格在塔内没有高于地板的顶点 ✓。角色传送到塔心落在 y 0.20（地板高度），说明实际起作用的物理地面是 0.2 —— 礁岛碰撞体在塔内那块 y 0.5 的面没影响站立高度，只记录、不记 bug。
- clifftop UV2：test:lightmap 出 rect uv1 顶点 = 0（规则已收紧成必须为 0）✓（① 已记）。
- 船绳：rope-high / rope-low_1 / rope-low_2 都挂 tex-s1-shore-lightmap，4 次涨退潮切换后不变 ✓（① 已记）。
- test:lightmap 通过，9 张 KTX2 共 12.27 MB ✓。
- 结论：**PASS**。

## ⑥ S1 脚印贴花（033）

- 截图：程序 shots-footprints.mjs 的 QA 副本（只改输出目录），退潮 level 0，6 个机位 → qa-v0.1-batch14/foot/footprints-{opening,pier,pathend,pathend-off,close,top}.png，拼图 foot/grid.jpg。程序的 docs/tasks/shots-030/footprints-*.png 也看过，和这次一致。
- 4 块贴花 T1 (2.914,0.119,4.272)、T2 (4.608,0.116,5.331)、T3 (6.304,0.114,6.389)、T4 (7.882,0.112,7.615)，都是 1×2 m、roughness 0.65、可见；从小径尽头一路排到浮台方向，落在湿沙上（footprints-close.png 近景脚印清楚，退潮下看得清）✓。
- 有没有浮空（/workspace/qa-tools/t14-foot.mjs，数据 foot/foot-ground.json）：每块贴花取 5 个点往下打物理射线，地面都是 y 0.100，贴花比地面高 1.2–1.9 cm；可见沙面网格 env-tidal-flat-s1_lod0 在贴花 7 个采样点上的插值高度是 0.097–0.104，差 1.2–1.8 cm（正常的贴花防闪偏移）→ 没有浮空 ✓。贴花底下只有潮滩和水面（y 0），没有礁石网格 → 不在礁石上 ✓。
- 白盒脚印暗斑：art=1 下 s1-footprint-* 一共 10 个，可见 0 个 ✓。
- 「比我的脚印大。」在 T2 触发、小径尽头不触发：由冒烟 013 art=1 的 033 断言覆盖，结果见 ⑧。
- 说明：俯视图里那几块深色多边形是潮滩上的积水 / 阴影，两次截图形状不一样；跟贴花没关系，这里不判。
- 结论：**PASS**（台词一项看 ⑧ 的 013 art=1）。

## ⑦ 父亲（031）S3 art=1（脚本 /workspace/qa-tools/t14-father.mjs，数据 qa-v0.1-batch14/father/father.json）

- **接入情况**：8ad6b9b 的 manifest、src 里都找不到 char-father 的引用 → 游戏里还没接上（S3 art=1 本身不会加载父亲）。下面的测试是 QA 自己做的：把 art/models/characters/char-father{,-anims}.glb 和 tex-father-{albedo,normal,orm}.ktx2 拷进快照 dist/assets/art，再在 S3 里用 `__game.assets.loadEntries` 手动加载。
- 加载：341 ms，没有缺失资源，控制台 0 错误 ✓。73 根骨骼、6 个蒙皮网格；三角面 lod0 55,582 / lod1 24,000 / lod2 12,000。
- LOD：loader 默认给的是占位距离（0/1000/2000）。手动套上 standard 档的 [25,60] 后测距离 5→0、20→0、30→1、50→1、70→2、120→2，再拉回 30→1、5→0 ✓。**正式接入时必须走 applyLodDistances**，不然一直停在 lod0。
- 3 段动画：father-hand-on-head 6 s / 61 条轨道，father-stand-gaze 8 s，father-walk-away 1.133 s / 63 条轨道；用 AnimationMixer 逐段播放，骨骼最大位移 0.856 / 0.016 / 0.804 m，没有 NaN ✓。每段动画的截图在 father/father-clip-father-{hand-on-head,stand-gaze,walk-away}.png，拼图 father/clips-grid.jpg：没看到明显穿模（大衣下摆和手臂都正常）。
- 和夕站一起（塔门外平台，父亲摆 stand-gaze，相隔 0.9 m）：father/father-xi-front.png、father-xi-side.png。身高：夕 1.471 m，父亲 1.799 m；脚底都在 y 2.40，两人都不浮空、不陷地 ✓。
- 备注：art/models/characters/char-father-anims.glb 在测试期间（22:55 UTC+7）被更新过（175,556 B，README 里写的是 163,608 B）。这次测的是 22:55 之后的新版本。
- 结论：模型、LOD、动画在 QA 侧加载 **PASS**；"S3 art=1 游戏内加载" **未接入，无法验证** → 记为 BUG-023（P3，待接入）。

## ⑧ 回归冒烟（一项一项跑，命令 runq14.sh，日志 /workspace/qa-tools/logs/q14-*.log）

- 019 sample-317：PASS（见 ③）
- 013 S1 art=1（q14-013a1.log）：EXIT 0 **PASS**。包含 033 的两条断言：「小径尽头不弹脚印独白、T2 弹」✓（⑥ 的台词一项也算通过，两条不重叠）；4 块贴花 y 0.119/0.116/0.114/0.112、10 块白盒暗斑全隐藏 ✓；115 个 GLB/KTX2 没有失败。
- 013 S1 art=0（q14-013a0.log）：EXIT 0，**PASS**（没有 ✗）
- 003（q14-003.log）：EXIT 0，**PASS**（✓ 行 4，✗ 行 0）
- 005（q14-005.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 007（q14-007.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 008 art=1（q14-008a1.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 010（q14-010.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 014 S2 art=1（q14-014a1.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 015 S3 art=1（q14-015a1.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
- 017（q14-017.log）：EXIT 0，**PASS**（✓ 行 5，✗ 行 0）
- 021/022（q14-021.log）：EXIT 0，**PASS**（✓ 行 3，✗ 行 0）
