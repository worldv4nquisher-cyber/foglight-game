# qa/：v0.1 制作人 QA 工具（历史脚本）

`qa/tools/` 是原团队制作人兼测试在 v0.1 QA batch1–28 里用的脚本，原来放在仓库外的 `/workspace/qa-tools`。这里保留原样，方便复现历次 QA 报告（`docs/bugs/qa-v0.1-batch*.md`）里的步骤。它们**不是** `game/` 的正式测试，正式测试以 `game/package.json` 的 `npm run test` / `check` / `check:release` / `smoke` / `smoke:xb` 为准。

## 内容

| 文件 | 用途 |
|---|---|
| `paths.mjs` | 共用路径（见下） |
| `common.mjs`、`util.mjs`、`cdp.mjs`、`server.mjs`、`side*.mjs`、`ctrl-helper.js` | 无头 Chrome（CDP）驱动、静态服务、页内键鼠辅助 |
| `bNNlib.mjs` / `bNNenv.mjs` | 第 NN 批 QA 的公共函数和环境（指向当批快照 `snap-<提交>`） |
| `t*.mjs`、`r5-*.mjs`、`probe*.mjs`、`dbg*.mjs`、`p5-*.mjs` | 各批的单项测试 / 探针 |
| `run*.sh`、`queue*.sh`、`q20*.sh`、`chain*.sh`、`check*.sh`、`gate*.sh`、`memgate.sh` 等 | 排队跑冒烟 / check:release / smoke:xb 的批处理（含「可用内存 ≥ 1.5 GB 才开 Chrome」的门槛） |
| `mk-*.mjs`、`cases/*.glb` | 生成和保存 verify:glb 的反例 GLB（BUG-001） |
| `*.py` | 截图拼版、QA 报告表格行更新 |

## 路径

原来写死的 `/workspace/qa-tools`、`/workspace/game-studio`、`/workspace/pw-tools`、`/workspace/pw-browsers` 已改成下面的变量。JS 从 `paths.mjs` 导入，sh 在第 2 行计算，py 读 `REPO_ROOT`：

| 变量 | 默认 | 含义 |
|---|---|---|
| `QA_DIR` | `qa/tools` | 工具目录；快照 `snap-*`、`logs/`、`out/` 也写在这里（已在 .gitignore 里） |
| `REPO_ROOT` | 仓库根 | 原 `/workspace/game-studio`（下有 `game/`、`art/`、`docs/`） |
| `PW_TOOLS` / `PW_BROWSERS` | 仓库根旁边的 `pw-tools` / `pw-browsers` | 仓库外安装的 Playwright 和浏览器（smoke:xb） |

## 注意

- 大多数脚本假设存在当批快照 `$QA_DIR/snap-<提交>/game`（原做法：`git archive <提交>` 到快照目录，`npm ci`，必要时 `npm run build`），以及 `/opt/google/chrome/chrome` 或 `CHROME` 指定的 Chrome。快照、日志和截图都没有入库。
- 不少脚本会往 `docs/bugs/qa-v0.1-batchNN/` 写截图。这些截图目录没有入库，需要时自行创建。
- 规矩：一次只开一个 Chrome，可用内存 ≥ 1.5 GB 再开。负载高时冒烟会抖，失败项要空闲时单跑复核。
