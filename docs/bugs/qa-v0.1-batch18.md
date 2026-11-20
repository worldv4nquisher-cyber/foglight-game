# QA v0.1 batch18 — 1d5405b..fe19ab7

- 构建：snap-fe19ab7（`git archive fe19ab7` + art/ 硬链接冻结自主仓库 art/（汐 r4 正式，char-xi.glb md5 f72c9f49…），audio/docs 链接），`npm run build` EXIT 0；headless Chrome + SwiftShader，负载高，不做 fps 判断。
- 产物：docs/bugs/qa-v0.1-batch18/

<!-- SUMMARY -->
## 汇总

| 项 | 结果 | 要点 |
|---|---|---|
| ① BUG-025 回归 | PASS | 结束页 / 跳过 → 主菜单 mus-menu 用 fade 2 淡入；BUG-025 已关闭 |
| ② menu 可选资源间歇缺失 | PASS | 冷启 S3 0/10、菜单 0/5 缺失；强制首次请求失败后重试 attempts=2 成功 |
| ③ 父亲幽灵深度预写 | PASS | 预写 6/6 随镜头开关，透明度曲线正常 |
| ④ de5b4d1 关玻璃反射 | PASS | 42–58 s glass=0，跳过后恢复 1，远处灯塔没有反光 |
| ⑤ 3c4a635 灯室美术 | PASS | 06 墙不再发黑，07 塔石不再像迷彩，椅 0.40 / 桌 0.68；05 按要求未提 |
| ⑥ 汐 r4 游戏内 | PASS | 头发加载、描边壳可见（对比 hull=0）、手搭头无缝、近头顶光脸 SDF 不闪 |
| ⑦ 校验与体积 | PASS | 晚到冒烟 1e-6 判定通过；check-size 140 警告 / 150 报错；check 全绿；首次进 S1 **132.30 MB**，菜单 **5.44 MB** |
| ⑧ 回归冒烟 | 部分 PASS | 010 ✓、033 ×2 ✓、035 4/5 ✓；015 art1 和 035 跳过因 OOM / 低帧率未验证（环境问题） |

新问题：**BUG-026**（P3，open）结尾父亲镜头 t≈38.5 s，画面上半部分偶尔整片叠上硬边橙光，疑似灯塔旋转光束 lamp-beam-s3 造成（原因未复核）。


## ① BUG-025 回归 — PASS
脚本 t18-end.mjs，结果 qa-v0.1-batch18/bug025/。
- 冷启动主菜单（boot 第一首）：musicLog `play mus-menu from null fade 0`（context suspended），解锁后 gain 一直是 1.035，不淡入 ✓（t18-boot.json）
- 结尾放完（VAR=full）→ 结束页（endedBy=end，log `end mus-ending-ch1`）→ 回主菜单：`play mus-menu from null fade 2`，gain 按音频时钟 116.77→118.80 s 从 0.066 线性升到 1.035（每 0.2 s +0.105）✓
- 跳过（VAR=skip，按住 Space）→ `stop mus-ending-ch1 0.75` → 结束页 → 主菜单：同样 `fade 2`，0.039→1.035 用时约 2.0 s ✓
- 附：seek 到 100 s 的路径（结尾曲还在播）是 `from mus-ending-ch1 fade 2` 交叉淡化，0.05→1.035 约 2 s，同样正常。
- 三条路径 missing 为空、无页面错误。BUG-025 关闭。

## ② menu 组可选资源间歇缺失（6d908bf 重试）— PASS
脚本 t18-cold.mjs（每次新 Chrome、新 profile），结果 qa-v0.1-batch18/cold/。
- 冷启动直进 ?scene=s3 共 10 次：每次 S3 全部加载完后 `missing` 为空、`loadFailures` 为空、`has('mus-menu')` 为 true，console 里没有「可选资源缺失」；随后 `flow.toMenu()` 播 mus-menu（从 s3 曲交叉淡化 fade 2）。**0/10 缺失**。
- 冷启动进主菜单共 5 次：missing 为空，mus-menu 播放（boot 第一首 fade 0）。**0/5 缺失**。
- 说明：这 15 次（load 约 3–8）都没自然触发请求取消（loadStats.attempts 全为 1），所以另外强制验证了重试路径（t18-retry.mjs）：用 CDP Fetch 让 mus-menu.ogg、sfx-ui-confirm/back.ogg、ui-icon-journal.svg、ui-panel-frame.webp 的第一次请求都 `failRequest Aborted`。结果 5 项都是 attempts=2 且 ok，missing / loadFailures 为空 ✓（音频 AudioLoader 和图片 decode 两条路径都会重试）。

## ③ 父亲幽灵深度预写（b0fa2cd）— PASS
脚本 t18-ghost.mjs（演出时钟换成可停、可变速的后备时钟，逐点停住截图），结果和截图在 qa-v0.1-batch18/ghost/；同帧改前/改后对比用 shots-035 `SHOTS_COMPARE=1`，输出 qa-v0.1-batch18/shots-035/。
- 不透明度曲线：36.13 时 0.037 → 36.42 时 0.299 → 36.72 时 0.535 → 37.17–41.41 稳定 0.55 → 42.12 时 0.286 → 42.35 时 0.096 → 42.61 时 0.001（root 隐藏）。0.55 时预写 6/6 可见；0.001 时预写 0/6（≤0.004 关预写，符合预期）。
- 截图 ghost-t36.1 / 36.4 / 36.7 / 37 / 38.5 / 40 / 41.4 / 42.05 / 42.3：淡入和淡出过程中都只看到最外层轮廓，斗篷内层、手臂、头部都没有透出来；淡出时也没有残影或闪块。
- shots-035 第 03 张对比（t=40.24，父亲 frame 127）：before（关预写）能透出光头和斗篷内层叠影，after 只剩一层干净的半透明外壳，和 docs/tasks/shots-035 里的 03 before/after 一致 ✓。

## ④ de5b4d1「那边没有亮。」镜头关玻璃反射 — PASS
- 逐点读 `endingCutscene.glass.value`：41.41 时 1 → 42.12 / 42.35 / 42.61 / 42.91 / 43.31 / 50.01 都是 0 → 58.5（over-shoulder）时 1，62.7 时 1。第 1 轮 run1 的逐帧日志里 54.11 时 0、59.95 以后 1、自然结束后也是 1。
- 在 t=50.0（值为 0）时按住 Space 跳过：endedBy=skip，之后 glass=1 ✓（恢复）。
- shots-035 第 04 张对比（t=52.8，镜头 regaze）：before 三扇窗上有太阳镜面亮斑，中间那块正压在远处灯塔上；after 没有亮斑，远处灯塔看得清 ✓。
- 备注：`CutsceneClock.seek` 只能往前跳（t ≤ 当前值时直接 return），QA 往回 seek 不生效，这是设计如此，不算 bug。

## ⑤ 3c4a635 灯室美术修复 — PASS（桌椅高度见 ⑥ 的游戏内实测）
- shots-035 第 06 张（t=79.6，pull-room）对比 docs/tasks/shots-035 的 06-preC：下半圈墙从接近全黑的深蓝变成暖色灰泥，平均亮度左墙 51→97、右墙 57→95 ✓。
- 第 07 张（pull-sea）塔身石材：preC 是高对比的深色斑块，看起来像迷彩；现在是浅灰砖缝加竖向水渍和淡色风化斑，不再像迷彩 ✓。
- 第 05 张构图已知要重做，按要求不拍不报。

## ⑥ 汐 r4 游戏内 — PASS（另有疑似新问题 → BUG-026，见文末）

- 头发加载：S3 art=1 冷启动，`char-xi.glb / char-xi-anims.glb / tex-xi-{ramp,sdf-face,albedo,orm,normal}.ktx2` 全部 ok，无失败/后备；头发网格 `char-xi_lod{0,1,2}_3` 可见，`mat-char-xi-hair` 4096 贴图 + alphaTest 0.5 + 双面。前/侧/后/顶特写正常（xi/xi-*-hull1.png，xi/xi-hull1-front-side-back.jpg）。
- 描边壳：`userData.outlineHull = {meshes 9, alphaTested 3, skipped []}`，身体/脸/头发三档 LOD 都挂了 `-hull`（头发壳带 aT0.5、背面）。同一会话内隐藏 9 个 `-hull` 网格（与 `?hull=0` 不挂壳等价，见 config/debug.ts outlineHullEnabled）对比：差分图在头发外轮廓和刘海齿边上是一圈连续亮线，前 43k / 后 33k 像素变化、平均变暗 5–7 级 → 头发上描边可见（xi/xi2-{front,back}-hull{1,0}.png，xi/hull-compare-zoom-diff.jpg）。
- 父亲手放头上：取 ③ 的结尾实测（ghost/t18-ghost.json），手搭头阶段 38.51 s 最小间隙 +5.8 mm、40.01 s +4.1 mm（<5 mm 接触点 2 个），全程穿入 >10 mm 的顶点为 0；ghost-t38.5/t40.png 放大看手指贴在头发上，无可见缝隙。
- 脸 SDF 近顶光（0852f7f）：三个汐材质着色器源码里都有 `theta *= smoothstep( 0.100, 0.350, hl )`（body/face/hair）。冻结动画，在头顶 0.45 m 放一盏点光（0.3）：正前方仰角 80/88/89.7°、侧方 88/89.7°，再在 87° 附近横向 −2…+2 cm 跨过正上方（原始 θ 0.448→0.255→0→0.255→0.448，修复后 θ 全为 0）。脸左右半边亮度差：仰角扫描 18→25→33、侧方 39→34；横移 10→15→22→29→35，单调平滑，跨过正上方时没有半脸翻转或跳变 → 不闪（xi/sdf/*.png，montage.jpg；冷色阴影基调按用户决定保留，不算问题）。
- 桌椅高度（补 ⑤）：灯室地面 y=22.00，`s3-lamp-chair-collider` 顶 22.40（椅 0.40）、`s3-lamp-desk-collider` 顶 22.68（桌 0.68），日记/灯笼插槽 y=22.68，与桌面齐平。
- 已知未报：马尾穿帽（划船/抬头/推/拾取）、发片内细暗线、帽领锯齿、父亲衣摆穿矮墙、160 帧手臂穿窗框。
- 说明：第一次 SDF 扫描点光 6 过曝、动画没冻结，作废重做；途中有一次 Chrome 渲染进程被系统内存挤掉，重跑。

## ⑦ 校验与体积 — PASS

- 结尾曲晚到冒烟（3a37550，容差 1e-6）：`v0.1-035 结尾曲晚到 art=1` ✓。曲子请求扣住 34 s，点燃时 buffer 未到 → 后备时钟 → 放行后 result=late，play offset 13.099 = 起播 13.109 − 点燃 0.011（差值 0.0），曲子 0 s 时刻 = 点燃（差 6.0e-16），两处 1e-6 判定都过；切换帧 t 4.000→15.104 对齐、之后 0.0000 s 漂移、不倒退（q18-late.log）。第一次跑时渲染进程被 OOM 杀掉（Inspector.targetCrashed，环境问题），内存回到 3.9 GB 可用后重跑通过。
- check-size 阈值：单测里有「check-size 判定：…140–150 只警告、>150 失败」并通过；直接调 sizeVerdict：132.3 / 139.99 无警告，140.01 / 149.99 仅警告，150.01 失败；check-size.mjs 只有失败才 `process.exit(1)`。
- `npm run check`（= typecheck && lint && test && build && size && css）：typecheck / lint / test / size / css 逐项 EXIT 0，build 在建快照时 EXIT 0 → 全绿（b18-check.log）。
- 体积：主菜单包 menu+boot **5.44 MB** / 15；首场景包 common+s1 126.86 / 150；**首次进入 S1 总下载 132.30 MB** / 150（警戒线 140，不警告）。分组 menu 5.44、common 35.39、s1 91.47、s2 59.72、s3 25.84 MB；进场后懒加载 S1 2.41 / S2 2.46 / S3 6.43 MB；配乐 6 首 12.99 MB。

## ⑧ 回归冒烟 — 部分 PASS（2 项因 box 内存 / 负载未能验证，不是产品失败）
box 严重过载：其他团队的进程占满内存，多次触发全局 OOM，dmesg 里有 `Out of memory: Killed process … (chrome) anon-rss≈1.5 GB`。每次只开一个 Chrome，启动前确认可用内存 ≥1.5 GB，ESTAB/LOAD 超时都设为 600 s。日志在 /workspace/qa-tools/logs/，包括另一个 QA 实例的 q18-s0xx-try*.log 和本实例的 *-mine*.log。
- **010 场景流程：PASS**（q18-s010.log，EXIT 0）。
- **033（2 个用例）：PASS**。配乐 ✓，懒加载失败 ✓（q18-s033.log 和 try2 都是 EXIT 0；try1 的懒加载用例死于 OOM 崩溃）。
- **015 S3 白盒 art=1：未验证（环境）**。12 次运行全部在「主场景就绪」之后被 OOM 杀掉渲染进程（Inspector.targetCrashed），可用内存 3–7 GB 时也一样，被杀的 renderer anon-rss 约 1.5 GB。没有一次跑到断言。batch14–16 的同一用例都通过过。下一个空闲时段需要重跑。
- **035（5 个用例）：4 PASS，1 未验证（环境）**：
  - 结尾演出 art=1 ✓（q18-s035end.log）。逐个 cue 按音频时钟触发，106 s 后进入结束页。另一实例的 4 次尝试失败，原因是墙钟 200 s 内只出了 18–42 帧，淡出 cue 晚了约 1.7 s，都是负载造成。
  - 后备时钟 art=0 ✓，5 次都过。
  - 结尾曲晚到 art=1 ✓：s035 try2/3/4 都通过，包括 1e-6 容差判定，即 ⑦ 的复验。
  - 结尾曲下载失败 art=1 ✓（q18-s035dl.log）。
  - 跳过 art=1：未验证（环境）。7 次都卡在同一条断言「按住期间右下角圆环没显示过」：按住的 1 s 里 UI 只更新了 1–2 帧，最长帧间隔 1.4–2.2 s。圆环每帧更新一次，按这个帧率显示不出来，是测试条件不满足，不代表功能坏了。跳过后续路径（淡出 → 结束页 → 菜单曲淡入、玻璃恢复）已经在 ①④ 的页面实测里通过。
- 结论：没有新的产品失败。015 art1 和 035 跳过要等 box 空闲时重跑。
