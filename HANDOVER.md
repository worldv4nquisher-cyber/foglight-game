# 《雾灯》项目交接文档

> 写于 2026-11-21（UTC+7），写给从仓库接手**整个项目**（制作、测试、程序、美术、策划）的新负责人。
> 内容来自仓库里的实际文件（`docs/`、`game/docs/engineering.md`、`game/package.json`），以及原团队工作目录里的记录。没有写进文件的进度，这里一律不写。
> 注意：`docs/gdd/` 有完整剧情和全部结局，会剧透。

## 0. 先读这几条（硬规矩）

1. **v0.1 还没有获准发布。** 是否发布由仓库所有者（用户）在真机试玩后决定。拿到明确同意之前，不发 GitHub Release、不部署任何公开地址、不往任何平台上传。
2. **不编造进度和测试结果。** 没有亲自跑过的东西，就写"未测"。
3. **帧率只认用户在真机上测的结果。** 用户的机器是 RTX 3060，基准是 1440p 极致档 60 fps。无头 Chrome + SwiftShader 量出来的帧率不算数。
4. **美术方向要改，先问用户。**
5. **不要擅自删东西。** 仓库历史、远端分支、用户的文件都一样，删除前要用户明确同意。不要改写已经推送的历史，也不要 force push。

## 1. 项目概况

- 《雾灯》（Foglight）是一款 3D 第三人称探索解谜游戏，三渲二半写实，主打忧郁氛围，**只面向桌面浏览器**。用户在 2026-10-29 决定不考虑手机，见 `docs/studio-framework.md`、`docs/gdd/gdd.md` §14/§15。
- v0.1 的范围是第一章「归岸」，包括 3 个小场景（S1 落潮滩、S2 守灯人小屋、S3 初望灯塔）和 5 道谜题，再加主菜单、暂停、章节结束页、本地存档，以及开头和结尾两段演出。
- 技术栈：Three.js r186、TypeScript、Vite；后处理用 `postprocessing` 和 `n8ao`，碰撞用 `three-mesh-bvh`。模型是 GLB（Meshopt 压缩），贴图是 KTX2，字体是 WOFF2 子集。
- 运行环境需要 Node.js ≥ 22.18（校验脚本直接跑 .ts 源码），原团队在 Node 24 上验证过。

### 仓库结构

| 目录 | 内容 |
|---|---|
| `game/` | 游戏工程，带完整的 git 开发历史。工程说明见 `game/docs/engineering.md`（命令、URL 调试参数、架构、资源规范、已知限制） |
| `art/` | 运行时美术，约 493 MB：`models/` 301 MB、`textures/` 169 MB、`audio/` 23 MB、`ui/` 1.6 MB，以及 `CREDITS.md`。Vite 从 `game/` 的上一级读取它们 |
| `audio/` | 只有 `CREDITS.md` |
| `docs/gdd/` | GDD（已定稿）和文本表 `text-ch1.json` / `.md` |
| `docs/releases/` | `v0.1.md`（版本计划和 31 条裁定）、`v0.1-compat-report.md`、`v0.1-perf-report.md`、`v0.1-qa-hooks.md`、`perf/`（量测原始数据） |
| `docs/bugs/` | `BUG-NNN.md` 和 `qa-v0.1-batch1…28.md`（QA 报告正文；截图目录没有进仓库，见第 7 节） |
| `docs/tasks/` | 37 张 v0.1 需求单（索引见 `v0.1-index.md`）、进度记录 `progress-*.md` 和冒烟日志 |
| `docs/studio-framework.md` | 原团队的分工和流水线 |

## 2. 安装、构建、运行

以下命令都在 `game/` 目录下执行，依据是 `game/package.json`：

```bash
cd game
npm ci                 # 按锁文件安装
npm run dev            # 开发服务器 http://localhost:5173，热更新，URL 参数生效
npm run build          # typecheck + 生产构建，输出 game/dist/
npm run preview        # 预览生产构建 http://localhost:4173
npm run preview:smoke  # 临时生成一份带测试钩子的测试构建（--mode smoke），在 4173 起服务
```

- **生产构建不读任何 URL 参数**，`?quality=`、`?scene=`、`?debug=1`、`?autostart=1`、`?reflect=` 全部无效，画质只能在游戏内设置里改（裁定 31，batch26/27）。要用 URL 参数，就用 `npm run dev` 或 `npm run preview:smoke`。参数表见 `game/docs/engineering.md`「调试参数（URL）」，以及 `docs/releases/v0.1-perf-report.md` §6。
- 生产包里也没有 `__game` / `__qa` / `__perfSpot` / `__s1`–`__s3` 这些控制台钩子，它们只在 dev 和测试构建里存在。
- `dist/` 用的是相对路径，可以放到任意静态服务器上。直接双击 `index.html`（file://）打不开。

### 测试和检查脚本

| 命令 | 内容 | 依赖 |
|---|---|---|
| `npm run typecheck` / `lint` | TS 严格检查和 ESLint | — |
| `npm run test` | 26 组 Node 校验（LOD、资源、输入、指针锁定、存档、物理、相机、画质、文本、交互、叙事、提示、潮汐、音频、光束、渲染、大气、光照贴图、陈设、流程、S2、S3、汐、父亲、演出、字体） | **见下方注意** |
| `npm run size` | 包体预算：主菜单 ≤ 15 MB，首场景（common + s1）≤ 150 MB（警戒线 140 MB），字体子集 ≤ 2 MB | 需要先 build |
| `npm run css` | 检查 CSS 前缀（BUG-003） | — |
| `npm run verify:prod-hooks` | 断言生产包里没有测试钩子，也不读 URL 参数（URL 参数白名单为空） | 需要先 build |
| `npm run check` | typecheck + lint + test + build + prod-hooks + size + css | 同 test |
| `npm run check:release` | build + prod-hooks + size，再基于测试构建跑 `verify:budget`（面数 / draw call / 贴图预算）、`verify:load`（加载时间）、`verify:memory`（内存 / 显存） | 需要本机 Chrome |
| `npm run smoke` | 无头 Chrome 冒烟，51 项，覆盖完整通关，`SMOKE_ONLY='名称'` 可单跑 | 需要 Chrome，可用 `CHROME=路径` 指定 |
| `npm run smoke:xb` | Firefox / WebKit 兼容冒烟 | Playwright 不在项目依赖里，需另装并设置 `PW_MODULE` / `PLAYWRIGHT_BROWSERS_PATH`，见 `docs/releases/v0.1-qa-hooks.md` |
| `npm run verify:glb -- <文件>` | GLB 交付自检 | — |
| `npm run fonts` / `test:fonts` | 重新生成或检查字体子集 | 重新生成要用 `art/source/fonts/`（不在仓库里），检查不需要 |

> **注意（2026-11-21 在全新克隆上实测）：** `npm ci`、`npm run build`、`npm run lint` 都能通过。但 `npm run test` 会在 `test:render` 失败，因为 `scripts/verify-render.mjs:452` 要读 `art/source/env/s1-layout.json`，而 `art/source/` 不在仓库里。`test:render` 后面那几组单独跑都能通过：atmo、lightmap、dressing、flow、s2、s3、xi、father、cutscene、fonts。所以在拿到 `art/source` 之前，`npm run test` 和 `npm run check` 在全新克隆上都是红的，**这不是游戏本身的问题**。另外，`gen-s1-rocks.mjs`、`gen-atmo028.mjs`、`export-blockout-s2/s3.mjs`、`verify-s2/s3` 的布局核对也会读 `art/source`，没有这些文件时，部分脚本会跳过对应步骤。`verify-assets.mjs:751`、`inspect-s3-islet-floor.mjs` 里还写死了原机器的路径 `/workspace/game-studio/...`。

## 3. 当前状态

- **v0.1 已完成，是 M8 候选包。** QA batch28（`docs/bugs/qa-v0.1-batch28.md`）在原团队的 `game` 仓库提交 `fcd796a` 上做了最终验收：check:release EXIT 0；全量冒烟 48/51，挂掉的 3 项在机器空闲时单跑全部通过（负载造成的抖动）；Firefox / WebKit 兼容冒烟通过；结论是"没有新 bug，fcd796a 可以作为 M8 前的最终包"。
- **代码冻结在原仓库的 `fcd796a`。在本仓库里对应 `a314f00`**（`game/` 目录的树哈希和 fcd796a 完全一致，都是 `e0739b3d…`）。本仓库在它后面只多一个整理提交 `fe6dcc1`，把仓库整理成 monorepo，没有改 `game/src`；`game/README.md` 内容移到了 `game/docs/engineering.md`。所以本仓库里所有提交哈希都和原仓库不同，文档里提到的哈希（如 `18cc26f`、`4da7788`）要按提交说明去对应。
- 用户手上已经有一份 v0.1 打包副本，**正在 RTX 3060 真机上实测**。帧率要填进 `docs/releases/v0.1-perf-report.md` §1（目前还是空的）；兼容性真机手测项见 `docs/releases/v0.1-compat-report.md` §7，用户自己挑着做。
- **v0.1 是否发布，还在等用户拍板（确认点 2 / M8）。** 拿到用户明确同意之前不能对外发布。
- 版本计划里 M5–M8 写的"目标日期"（2026-12 至 2027-02）是 10-29 排的，实际已经提前做完，进度以里程碑表里的 ✅ 和 QA 报告为准。

## 4. 已定的用户决策

| 时间 | 决策 | 出处 |
|---|---|---|
| 2026-10-29 | 只做桌面浏览器，不考虑手机；画风三渲二半写实；画质往极致做，核心是忧郁氛围 | v0.1.md、studio-framework.md |
| 2026-10-29 | GDD 定稿（确认点 1）：主角是 13 岁女孩汐；结局是父亲已不在、汐成为新守灯人；砍掉点击寻路；最低配置 GTX 1650、推荐 RTX 3060；保留三级提示 | v0.1.md |
| 2026-10-29 | 性能基准是 RTX 3060 级、1440p、60 fps；首场景包上限 150 MB，主菜单 15 MB | v0.1.md |
| 2026-10-29 | 谜题 5 改成由汐按 E「点灯」亲手点燃 | 裁定 11 |
| 2026-10-31 | 主菜单主题样张 v1 通过；汐的头部重做 | 裁定 22 |
| v0.1 期间 | 汐的发型用概念 A（马尾，模型为低马尾），概念图 `concept-xi-hair-a-ponytail.jpg` 在 `art/style/`（不在仓库里） | 原团队记录 |
| 2026-10-31 | S2 小屋曲和第一章结局曲先按现版本用，首版完成后再统一精修 | 裁定 24 |
| 2026-10-31 | 汐脸部暗面保持冷色，不用 warm | 裁定 26，裁定 30 再次确认 |
| 2026-10-31 | 水面反射强度默认 0.5（`PLANAR_REFLECTION_STRENGTH`），极致档反射 RT 倍率 0.5 | 裁定 28 |
| 2026-11-01 | BUG-030 修完后保持修后画面（方案 A），参数不调 | BUG-030、裁定 30 |
| 2026-11-01 | 结尾 05 镜头用 A，保持修后现状，不采用美术的 B 方案 | 裁定 30 |
| 2026-11-21 | 仓库 `foglight-game` 公开，默认分支 `main`；运行时美术一起推上来；代码、美术、文档统一用 MIT（字体按 OFL、VSCO2 采样按 CC0 例外）；策划文档公开，GDD 全公开并在 README 标注剧透；README 制作名单写用户的 GitHub 名和 Grok Bot | README、LICENSE |
| 2026-11-21 | 项目整体交给外部 agent 接手（也就是本文档） | — |

**31 条裁定**全部在 `docs/releases/v0.1.md`，动相关系统之前要先读：
- 1–21：拆单和玩法细节，包括提示规则、点灯判定、白石透视拼合、观察模式眼位、西窗限高等。
- 22–26：美术和音乐意见。
- 27：BUG-027 按设计关闭，潮间带压浪结案。
- 28：反射默认值、跨场景显存 P1、贴图按档跳过高级 mip、标准档 S1 面数超预算记为已知项（等 M8 真机定）。
- 29：内存验收只比对象堆；BUG-030 用方案 A。
- 30：结尾 05 用 A。
- 31：兼容 / 发布裁定，包括生产包去掉测试钩子和 URL 参数、structuredClone polyfill、全屏和 DPR 监听、软件渲染提示，以及"不做"清单。

## 5. Bug 状态

以各个 `docs/bugs/BUG-NNN.md` 的最后一条状态为准：

- **已关闭：BUG-001 ~ BUG-038 全部关闭，目前没有未关闭的 Bug。**
  - BUG-016、BUG-017、BUG-031、BUG-032 是测试脚本问题；BUG-027 按设计关闭；BUG-030 由用户选 A 后关闭；BUG-038 在 batch28 回归后关闭。
  - **BUG-031 没有单独的文件**，它记在 `docs/bugs/qa-v0.1-batch22.md`（开单）和 `qa-v0.1-batch23.md`（关单）里。
  - 早期几张单（如 BUG-001、003、004、005）结尾写的是"已修复"加回归记录，没有统一的"状态：关闭"字样。
- **下一个可用编号：BUG-039。** 命名是 `docs/bugs/BUG-编号.md`，要写复现步骤、期望、实际和严重度。

## 6. 已知遗留和待办

1. **游戏内制作名单还显示「—」。** `game/src/config/gameConfig.ts` 的 `credits` 五项都是 `'—'` 占位。代码冻结期间没改，解冻后按 README 的署名（用户 GitHub 名 worldv4nquisher-cyber、Grok Bot）填写，填之前先和用户确认写法。
2. **`npm ci` 后 `npm audit` 报 9 个中等漏洞**，都在 lint 工具链里（minimatch → eslint / typescript-eslint），不进游戏运行时，还没处理。`npm audit fix` 要等解冻后再做，并回归 lint 和 build。
3. **`npm run test` 在没有 `art/source` 的环境里会失败**（见第 2 节），可以考虑让 `verify-render` 在缺布局文件时跳过，或者把布局 JSON 放进仓库。
4. **`docs/releases/v0.1-compat-report.md` §6 里 BUG-038 那一行还写着"待 QA 复跑通过后关闭"**，但 `BUG-038.md` 已经关闭（batch28）。这是 batch28「给程序」第 1 条，还没改。
5. batch28「给程序」的其余几条：
   - 第 2 条：check-prod-hooks 的规则自检缺一个只能靠 `location\s*\[` 规则拦住的样例。
   - 第 3 条（可选）：还有 6 种间接读 URL 的写法拦不住，已记为已知局限。
   - 第 4 条（可选）：compat-report §7 S3 情况 ② 的手测步骤建议改成 iframe 方法。
6. **等 M8 真机结果再定的事：** 标准档 S1 主 pass 面数超预算（裁定 28 第 3 条，perf-report §2「已知项」）；perf-report §6 A3 反射 0.5 和 1 的真实 GPU 代价对比；§6 A1–A6、B–E 的真 GPU 清单。
7. 用户说过音乐在首版之后再统一精修（裁定 24）。
8. compat-report §7「已知问题与无提示汇总」：私密模式存档丢失、ITP / 清站点数据导致丢档、首次手势前无声、手柄无反应也没有提示等，按裁定 31 都是"不做"。
9. 后续版本（多章节、收集品、配音等）在 `docs/gdd/gdd.md` §15 和 v0.1.md「不在 v0.1」里有列，还没有立项。

## 7. 工作规矩和质量目标

**必须由用户确认的节点：**
- GDD 定稿（v0.1 已经确认过）；
- 每个版本能不能发布；
- 美术方向的任何变更。

**汇报节奏：** 只在里程碑或者真正卡住的时候找用户，用中文，简明扼要。

**流水线（`docs/studio-framework.md`）：** GDD → 用户确认 → 版本计划和需求单 → 美术、程序并行 → 制作人测试（功能 / 兼容 / 加载 / 包体，Bug 写进 `docs/bugs/`，修完回归）→ 用户试玩确认 → 构建发布。

**质量目标（以 GDD §14 和 v0.1.md 验收标准为准）：**
- 性能：RTX 3060 级、2560×1440、极致档 60 fps（1% low ≥ 50）；最低配置 GTX 1650 级、1920×1080、标准档 ≥ 30 fps 稳定可玩。**帧率只由用户真机测试。**
- 兼容：桌面 Chrome、Edge、Safari、Firefox（WebGL2）。手机不是目标平台，手机打开时显示「仅支持电脑」提示（BUG-035）。
- 包体：主菜单 ≤ 15 MB，首场景 ≤ 150 MB（内部警戒线 140 MB）；主菜单出现 ≤ 3 s。现状是 5.48 MB / 126.72 MB / 首次进 S1 共 132.20 MB。

**测试环境经验：**
- 一次只开一个无头 Chrome，可用内存至少 1.5 GB，否则容易被 OOM 杀掉（batch28 就出过这种事）。
- 机器负载高的时候冒烟会抖，挂掉的项要在空闲时单跑复核，再下结论。

**素材：** 只用自己生成的，或者可商用、免版权的素材。来源记在 `art/CREDITS.md`、`audio/CREDITS.md`、`docs/audio-credits.md`。

## 8. 不在仓库里的东西

下面这些留在原团队的工作机器上，**需要另外向仓库所有者索取**。大小是 2026-11-21 实测的。

| 内容 | 大小 | 主要内容 | 影响 |
|---|---|---|---|
| `art/source/` | 约 1.4 GiB（1442 MiB，498 个文件） | `characters/` 823 MB（汐和父亲的 `.blend`、动画 `.blend`、构建脚本）、`textures/` 219 MB、`bake/` 185 MB（S1–S3 光照烘焙 `.blend` 和 `.exr`）、`ui/` 78 MB、`env/` 73 MB（场景装配 `.blend`、`s1/s2/s3-layout.json`）、`fonts/` 40 MB（Noto Sans / Serif SC 的 OTF 源字体）、`atmosphere/` 28 MB、`blockout/`、`audio/`、`props/`。文件类型以 png（314）、py（56）、json（53）、html、exr、ktx2、blend（8 个）为主 | 改模型、重新烘焙、重做贴图、重新生成字体子集都要用；`npm run test` 的 `test:render` 也要用 |
| `art/style/` | 4.4 MiB | `style-guide.md`（画质分档表 §8 是 test:quality 的依据）、`palette.png`、4 张第一章概念图、3 张汐发型概念图（A 马尾、B 短发、C 辫子） | 美术方向的基准 |
| `art/tools/` | 1.1 MiB | 美术构建和检查脚本：26 个 mjs（build-env-s1/s2/s3、build-char-xi、finish-*-anims 等）、7 个 py、10 个预览 html、`README.md`（材质公式 §5） | 重新生成美术资源时要用 |
| `audio/source/` | 0.2 MiB | `music/`：配乐生成和混音的 Python 脚本（score_*.py、gen_music.py、master.py 等）和 json | 精修音乐时要用 |
| QA 截图和证据目录 | 约 1.3 GiB（1342 MiB） | `docs/bugs/qa-v0.1-batch*/`、`BUG-008-probe/`、`docs/tasks/shots-*`、`docs/tasks/d2` 等，主要是 png 截图、日志和 json | QA 报告正文里引用了这些路径，在仓库里点不开 |
| QA 工具和快照 `qa-tools/` | 约 1.9 GiB | `snap-fcd796a/`（M8 最终包快照，主要是 1.9 GB 美术副本加 4.6 MB 游戏代码）；其余约 11 MB 是 275 个 mjs 和 111 个 sh 的测试脚本、`cases/`、`logs/` | 复现历次 QA 用；最终包的代码就是本仓库的 `a314f00` |

> 交接方式还在和仓库所有者商量。拿到之前，写代码、构建、运行、跑大部分测试和冒烟都不受影响。

## 9. 建议的接手第一步

1. 通读本文档、`README.md`、`docs/releases/v0.1.md`（31 条裁定）、`docs/bugs/qa-v0.1-batch28.md`、`game/docs/engineering.md`。GDD 按需读，有剧透。
2. 在 `game/` 里跑 `npm ci && npm run build && npm run preview`，确认能进主菜单并完整通关一次。再跑 `npm run lint` 和 `npm run test`（`test:render` 失败是已知问题，见第 2 节）。
3. 准备本机 Chrome，跑一次 `npm run check:release`，以及 `npm run smoke` 的一两项，搭好自己的测试环境。
4. **先不改代码。** 先问用户 v0.1 真机实测的结果，帧率按 perf-report §1 填表，再等用户决定发不发布。发布前所有修改都要回归一遍。
5. 向用户索取第 8 节的源文件。
6. 拿到用户同意、确定解冻以后，再按第 6 节处理遗留：制作名单、npm audit、compat-report 的 BUG-038 行、test:render 的依赖等。新 Bug 从 BUG-039 开始编号。
