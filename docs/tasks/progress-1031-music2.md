# progress-1031-music2：S2 / 结尾曲 / S3 两层配乐接入（程序执行者）

起点 HEAD 5f8c1f5（10-31 06:00 UTC+7 接手）。工作目录：worktree /workspace/scratch/r3/game（art = r3 原件镜像 /workspace/scratch/r3/art，6 首 mus-*.ogg 与 art/ 逐字节一致）；主仓库 art/ 下汐 / 父亲动画是美术在制品 r4，不用。

- [x] 0 读 art/audio/music/README.md、progress-1031-music.md；worktree 已在 5f8c1f5
- [x] 1 S2 场景曲 —— commit 95dd426：manifest s2 lazy（gainDb 0，实测 −20.0 LUFS）、LevelDef.s2.music、verify-audio 新单测 + 改 036 旧断言（S2 不再是 null）；verify-audio 33 项绿。冒烟放到第 5 步
- [x] 2 结尾曲 —— EndingMusic（systems/audio/endingMusic.ts）：S3 首帧后预取、ignited 同帧 start(0)、场景曲 2 s 淡出、跳过 0.75 s、晚到补位 / 缺失不放；AudioSystem 加 offset / fadeOutPrev / one-shot 自清；结束页不掐结尾曲；verify-audio 35 项绿；卡点对照表见文末
- [x] 3 S3 两层 —— AudioSystem playMusic({layers}) 同刻同 offset 起播、addMusicLayer 晚到按底层位置对齐（when = now+0.1 s）、setMusicLayerGain 0.25 s 斜坡；switchLayeredMusicLazy 首帧后两层并行懒加载；上层增益 = levels/s3/music.ts s3UpperLayerGain（塔内 y 0.2→0、22→1 线性，塔身 r ≤ 4.5 m 外恒 0）；verify-audio 39 项绿
- [x] 4 size —— size-groups mus-ending → s3；check-size 单列配乐合计；verify-audio 体积单测 + verify-assets guessGroup；数字见文末（首次进 S1 +6,378 B 是代码，配乐 0 B）
- [x] 5 测试 / 冒烟 —— commit 8ccd2b0：smoke-browser.mjs 新增 3 项（S2 进场 / S3 两层 + 爬塔 / S3 点燃→结尾曲 + 跳过），在 /workspace/scratch/r3/game 构建后跑 SMOKE_ONLY='v0.1-033|v0.1-1031' 5 项全过（日志 docs/tasks/smoke-1031-music2.log），Chrome 临时目录已清；npm run check 全绿（verify-audio 40 项）；master 已快进到 8ccd2b0
  - 冒烟发现：软件渲染下 S3 帧率很低，点燃后 0:04（游戏时间）时音频时钟已过 100+ s，结尾曲已放完才进结束页。演出走游戏时间、结尾曲走音频时钟，低帧率下两者会脱节（035 做结尾演出时要考虑）。冒烟里进结束页直接调 flow.completeChapter()

## 结尾曲卡点对照（第 2 步）

基准：README「结尾曲卡点」CUES + 派生时间（文件 0 s = lighthouse:ignited）；对照 ① docs/gdd/text-ch1.md §5 结尾演出分镜（035 以它为准）② 当前游戏实现（035 CutscenePlayer 未做）。
文件本身用 ffmpeg 50 ms 峰值窗口复核了起音：14.00 / 21.75–21.80 / 66.00 / 88.00 s 跳升，50.0 s 只剩低声部（A3 长音，起音 ≈ 50.05），95 s 起逐秒下降，106.00 s 起数字静音。

| 卡点 | README（音乐） | text-ch1 §5 / 035 | 差 | 当前游戏实现 | 差 |
|---|---|---|---|---|---|
| 点燃、配乐进入 | 0.00 | 0:00 | 0 | lighthouse:ignited（xi-ignite-lever 第 34 帧）同一帧 start(0) | 0（单测 + 冒烟量） |
| 透镜转、切远景 | 4.00 | 0:04 | 0 | 0:04（OUTRO_CUT_SEC）切到**章节结束页**，不是塔外远景 | 时间 0；内容未实现 |
| 雾推开 | 14.00 | 0:14 | 0 | 无（035 未做） | — |
| 动机解决 D4（全章高点） | 21.78 | 无对应镜头（相邻 0:24 剪影，README 另有 silhouette 24.00） | 无对应项 | 无 | — |
| 远处灯塔剪影 / 眺望 | 24.00 / 30.00 | 0:24 / 0:30 | 0 / 0 | 无 | — |
| 「那边没有亮。」 | 50.00 | 0:50（3.0 s） | 0 | 无 | — |
| 坐下写日志 | 58.00 | 0:58 | 0 | 无 | — |
| journal_entry 字幕 | 66.00 | 1:06（6.0 s） | 0 | 无 | — |
| 镜头拉远 | 74.00 | 1:14 | 0 | 无 | — |
| D 小三和弦收尾 | 88.00（末旋律音 89.11） | 无对应项（1:14 拉远 → 1:35 淡出之间） | 无对应项 | 无 | — |
| 淡出 | 95.00 起 | 1:35 淡出到章节结束页 | 0 | 结束页 0:04 就出来了；结尾曲在结束页上继续放到完 | 结束页早 91 s（程序侧，035） |
| 静音 / 文件尾 | 106.00 / 107.0 | 「约 100 s」（035：约 90–120 s） | 在范围内 | one-shot 放完自动清掉（log op end） | — |

结论：README 卡点和 035 时间轴（text-ch1 §5）**没有差超过 0.3 s 的项**，不需要转告美术改 CUES；21.78 / 88.00 是音乐内部的派生点，分镜里没有对应镜头（035 想让某个镜头落在高点上时可以对 21.78）。
差距全在程序侧：035 结尾演出没做，现在 0:04 就切结束页；跳过入口也没有（先挂了 'cutscene:skip' { id: 'ch1-ending' } 事件）。

## 体积（第 4 步，worktree dist，npm run size）

- 首次进入 S1 总下载 132.40 MB（138,830,198 B）；起点 5f8c1f5 同法构建 138,823,820 B（显示 132.39）。差 +6,378 B **全是 JS 代码**（本轮新增的结尾曲 / 两层逻辑压缩后），配乐对首次下载贡献 0 B。
- 进场后懒加载（首帧后，不计入首场景包 / 首次总下载）：s1 2.41 MB（mus-s1-ebb-shore）；s2 2.46 MB（mus-s2-keeper-house 2,577,617 B）；s3 6.43 MB（mus-s3-lighthouse 2,416,936 + upper 2,482,648 + mus-ending-ch1 1,839,809 = 6,739,393 B）
- 6 首配乐合计 13,623,265 B = 12.99 MB（预加载只有 mus-menu 1.70 MB；懒加载 11.29 MB）
