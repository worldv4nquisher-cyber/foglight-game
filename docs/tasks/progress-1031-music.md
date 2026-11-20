# progress-1031-music：033 主菜单配乐接入（程序执行者）

起点 HEAD 0598043。

- [x] 1 核对文件：mus-menu.ogg 1,779,931 B，vorbis 2ch 44.1k，106.667 s（=1:46.7）✓；preview/mus-menu-preview-v1.ogg 不进 manifest
- [x] 2 manifest menu 组登记 mus-menu；size-groups
- [x] 3/4 AudioSystem 音乐总线 / 交叉淡化；MenuScene / S1 接入
- [x] 6 单测（verify-audio +6、verify-assets guessGroup）
- [x] 7 check 全绿（EXIT 0）；size：menu 3.71→5.41 MB（MiB），common+s1 126.53→128.94，首次总下载 130.24→134.35（mus-s1 +2.41 MiB 进 s1）
- [x] 8 冒烟：SMOKE_ONLY=v0.1-033 ✓（01:36）；008|010 回归 ✓（01:39）
- [x] 9 commit c0d81c9

## 现状记录
- AudioSystem 原有：musicGain 总线（固定 0.5 = −6 dB）、playMusic(buffer) 硬切 loop；**没有**交叉淡化、没有 −12 dB 关系；项目里没有任何地方调 playMusic（033 曲目全都没接）。
- 改：MUSIC_BUS_DB = −24 −12 − (−20) = −16 dB；playMusic(buf, {key, loop, crossfade}) + stopMusic(fade) + musicLog；systems/audio/music.ts switchMusic；MenuScene 进 mus-menu、ChapterEndScene 淡出、LevelScene 按 LevelDef.music（s1 = mus-s1-ebb-shore，s2/s3 = null）
- mus-s1-ebb-shore 登记进 s1 组（交叉淡化需要）→ common+s1 +2.53 MB（和"不变"的预期不同，汇报里说明）
- S3 两层不登记（同步层逻辑未做）
- 完成。遗留：S3 两层未接（无同步层代码）；S2 / 结尾曲未交付；交叉淡化发生在 S1 enter 时，主线程建场景卡顿期间音频线程照常淡化（冒烟读数时已淡完）

## 第二轮：制作人对 c0d81c9 的反馈（起点 HEAD c0d81c9）
### 1 S1 曲懒加载
- [x] 量文件（ffmpeg 全文件）：mus-menu RMS −22.09 dB / −19.9 LUFS / 峰值 −1.46 dBFS；mus-s1-ebb-shore RMS −21.83 dB / −20.0 LUFS / 峰值 −1.42
- [x] manifest mus-s1-ebb-shore lazy: true；AssetLoader.loadAudio（src/assets/lazyAudio.ts LazyAudioCache：并发共享、404/超时 20 s → null 不抛、失败不缓存）
- [x] Game 新场景首次 render 后发 scene:firstFrame（记 lastFirstFrame）；LevelScene 懒加载场景曲等它再 switchMusicLazy；playMusic 新增 fadeIn（菜单曲已停 → 0 淡入 2 s）；musicLog 加 wall
- [x] size：sizeBucket（size-groups）→ lazy audio 单列「s1 进场后懒加载」，不计首场景包
- [x] verify-audio +4（支持 async）；冒烟 033 主流程加首帧证据，新增 404 路由检查（CDP Fetch）
- [x] check 通过；size：s1 91.89 MB（回到 c0d81c9 前水平）、「s1 进场后懒加载」2.41 MB 单列、common+s1 127.03 MB（目标 126.53，多出的 0.5 MB 是美术 02:14–02:19 重交的 char-xi.glb / tex-xi-*.ktx2，不是代码）、首进 S1 合计 132.44 MB
- [x] 冒烟 033 ✓（首帧 → 请求 → 下载 → 淡入时序）、033 404 ✓、008 ✓、010 ✓ → commit f897c83
### 2 主菜单曲电平
- [x] 方法：两首都按「整条文件 RMS（ffmpeg astats）+ 曲目增益（manifest gainDb）+ 音乐总线（−16 dB × 音量 0.8 = −17.94 dB）」算总线上的电平；冒烟另用 ScriptProcessor 在总线后实采 8 s（按音频时钟），菜单曲在解锁后量、S1 曲在交叉淡化完 + 3 s 游戏时间后量（S1 稳定）
- [x] 原 −51 vs −42 dBFS 是 AnalyserNode 46 ms 快照的偶然值；整条只差 0.26 dB
- [x] mus-menu gainDb +0.3（MusicVoice.level 独立增益）：总线上整条 menu −39.73 / S1 −39.77 dBFS，差 0.04 dB（LUFS 差 0.4 LU）；菜单曲峰值过增益后 −1.16 dBFS，不削波
- [x] 冒烟实采 8 s：menu −36.4、S1 −40.1 dBFS（8 s 窗口取的是各曲不同段落，内容差异大，只作旁证；断言用整条）
- [x] 第一次冒烟 033 失败：S1 懒加载撞 20 s 超时（负载下首帧后下载 13.1 s + 解码 3.9 s ≈ 17 s，失败那次更慢）→ LAZY_AUDIO_TIMEOUT_MS 改 45 s，AssetLoader.lazyAudioFailures 记原因，冒烟失败信息带时序；重跑 ✓
- [x] check ✓ → commit 1b93352；008 / 010 在 1b93352 产物上重跑见下
## 第三轮：batch15 追加
### A #157 礁石挡人体
- [x] 原因：#157 挡人盒（实例包围盒 ×0.8）西南角 z −9.00，越过深水边界 z −8.95（x −10…12.5 段）；深水墙只在深度 > 0.5 处有，这里没静态墙 → 沿南侧走被盒子推进深水区 → 送回
- [x] 9 块核对（要求缝 ≥ 胶囊直径 0.5 + 0.1）：#155 0.90、#156 2.84、#157 −0.05→0.65、#158 3.53、#159 1.71、#160 4.21、#161 4.50、#162 4.03、#163 4.33 m；只改 #157：同尺寸内切椭圆柱
- [x] verify-physics 新断言 + 10 条南侧真实路径（最近离边界 0.35 m，不送回）；换回旧盒子两条都失败（缝 −0.05；(8.6,−8.60) 朝 +x 1.3 s 进深水区）
- [x] check ✓ → commit 5771f34
- 遗留：椭圆在南侧最深处比网格内缩约 0.2 m，贴着走时胶囊会略穿进礁石模型（视觉）

### B S1 沙地深色多边形斑
- [x] shots-031-sand.mjs：开场 / 礁石南侧俯视两机位，timeScale=0 同一时刻拍 基准 / 关贴花 / 关阴影 / 关水面，再 ?lightmap=0 拍 基准 / 关水面 → shots-031/sand/（12 张）+ sand-compare.png
- [x] 结论：只有关水面时斑消失；光照贴图 / 贴花 / 阴影无关。主海面 Water(600,200) y −0.6、4 波振幅和 0.375 → 浪峰 −0.225，漫过新礁石南侧缓降海床（−0.15…−0.65），3 m 网格插值成折线块 → 代码侧（占位海面），和 batch14 备注一致
- [x] 未修，修法三选一写在 shots-031/sand-dark-patches.md（025 浅水衰减 + 海床高度图 / S1 退潮 waveScale≈0.7 / 近岸加密网格），待制作人或 025 定 → commit 6155c75（脚本）
### C 下摆特写正面方向
- [x] 原因：PlayerController 转的是子节点 visual，根节点 +Z 不转；改为按两脚 foot→toe 求正面（退回 coat_front−coat_back，再退回根）→ s1-xi-hem 重拍为正面 → commit a4a0387
## 第四轮：D 汐头部 r2（用户直接提，高优先级）
- [x] char-xi.glb 2,052,568 B、LOD 116,974 / 48,499 / 24,299、73 骨、材质 body/hair/face；ktx2 五张；char-xi-anims.glb 未变；dist 已重建，副本逐字节一致
- [x] test:xi ✓、test:father ✓；掌心→头顶（摸头第 83 帧）：骨骼估算 0.080 m、蒙皮网格最高点 0.018 m、到头发表面 0.009 m（网格头顶比骨骼估算高 0.067 m）
- [x] size：common 35.13、s1 91.89、common+s1 127.01（r2 前 127.03，−0.02）、首进 S1 合计 132.43（r2 前 132.44），< 150
- [x] 截图：s1-xi-face-front / s1-xi-face-side（art=1 high，朝向按 head 骨当前旋转，head 与身体夹角 ≤ 6.3°）、s3-father-hand-closeup 重拍 → xi-head-r2-compare.png（scripts/compose-xi-head.mjs，r3 到了：build → shots-031.mjs s1-xi-face → shots-031-father.mjs hand → compose-xi-head.mjs）
- [x] 需求单外 3 个 clip：xi-pickup-table / xi-place-table / xi-pickup-shelf 都在 s2/puzzles.ts 使用 → clips.ts XI_CLIP_OFF_TICKET 登记 used，verify-xi 断言；美术工具报错是 verify-xi-anims.mjs 默认 --batch=1（EXTRA_OK 登记在 batch 2），--batch=3 通过，工具未改
- [x] 描边不做（制作人定）→ commit 5e88b86
## 第五轮：E BUG-024 父亲袖口透光缝
- [x] char-father.glb 1,006,852 B、LOD 55,870 / 24,000 / 11,999、73 骨、材质 body/skin；贴图 albedo 1,403,733 + normal 1,134,628 + orm 1,662,378 = 4,200,739 B ≈ 4.20 MB（交付说明「约 5.13 MB」对不上）
- [x] test:father ✓（新父亲 + 汐 r2）；s3 25.65 → 25.72 MB，common / s1 不变 → 只进 s3 包
- [x] 袖口近景 s3-father-cuff-{l,r}-{gaze,hand80} → father-bug024-cuff-compare.png；gaze 两袖口未见透光缝；cuff-l-hand80 机位被身体挡（只看到手），cuff-r-hand80 袖口在手后侧 → commit 362731a
## 第六轮：F 汐头部 r3 收尾 + 最终回归（起点 HEAD 04e8ecf，05:12 接手）
- [x] 接手时 art/ 下的汐文件已经不是 r3：char-xi.glb 05:06 改成 2,037,252 B（05:15 再变 2,048,776 B、LOD0 118,364），tex-xi-albedo / normal / orm 05:05–05:06 也换了，美术 gen_tex_char_xi.py 正在跑（未通知的新一轮）→ 不拿 art/ 现货验
- [x] r3 原件取自 04:21 的 dist 副本（构建按字节拷）：存 /workspace/scratch/xi-r3-snapshot/；镜像 /workspace/scratch/r3/{art（art/ 全拷 + r3 原件覆盖）, docs→真 docs, game = HEAD worktree}，以下 r3 与回归都在这套里跑
- [x] 上一执行者遗留的 /workspace/finalq/q2.sh（013 / 015 art1 冒烟）卡在 015：04:44 后 30 min 无输出 → 已结束进程、删它的 /tmp/smoke-chrome-yc3ZAD
- [x] 1 核对（r3 原件）：char-xi.glb 2,002,496 B、LOD 114,508 / 48,499 / 24,300、73 骨、材质 body/hair/face ✓；sdf-face 136,844 ✓；char-father-anims.glb 177,288 ✓；meta.json / anims extras xiCrownRest = [-0.0002, 1.4891, 0.0052] ✓；GLB 里没有 hair_fly 材质 / 节点（已并进 mat-char-xi-hair），无法按 GLB 数卡片
- [x] 2 rg：src / scripts 没有 xiCrownRest、旧值、hair_fly 卡片数或节点名；写死的是 verify-father / shots-031-father 的「head 骨 +0.13 m」头顶估算 → 改成读 anims extras xiCrownRest
- [x] 3 test:xi ✓；test:father ✓（新增蒙皮网格量法）：绑定姿势 LOD0 头发最高点 (-0.0083, 1.4919, -0.0101) ↔ xiCrownRest (-0.0002, 1.4891, 0.0052)（高差 2.8 mm）；handOn–handOff 81 帧掌心点（hand_r / middle_01_r 中点）→ 头发表面 0.008（@120）…0.017 m（@79），第 80 帧 0.016 m，掌心点在头发里 0/81；右手皮肤 1517 顶点 → 头发表面最小 −0.027 m（@112，thumb_02_r），手掌 hand_r 顶点最深 −0.015 m（@57），每帧都 < 0（手皮肤压进外层发片 0.9–2.7 cm；美术报的「最深压入 0.60 cm」量法不同，带符号按最近三角形法线、发片交界处可能不准）；掌心→xiCrownRest 头顶点 handOn–handOff 最大 0.053 m
- [x] 4 截图：build → shots-031.mjs s1-xi-face（05:22 ✓）→ shots-031-father.mjs hand（05:25 ✓，第 80 帧 palm→crown 0.017、palm→头发表面 0.016、网格头顶−xiCrownRest 0.004 m，和 node 一致）→ compose（XI_HEAD_REV=r3）→ docs/tasks/shots-031/xi-head-r3-compare.png
  - 正脸：刘海已分缕、末梢是细尖；脸部 SDF 明暗线从右眼角斜穿鼻梁到嘴角，鼻子在亮面一侧留一块灰三角；游戏内肤色很白、偏冷（场景调色），和美术预览的暖肤色差距大
  - 侧脸：耳朵是一块没有明暗的白色椭圆；后脑发壳下沿是一条水平直切边，下面露一截浅灰脖子；侧发不挡眼（这张是 90° 侧，yaw 330 没拍）
  - 摸头近景：手掌贴在头顶、看不到缝；手指下沿陷进顶部发片（与上面 −1～−2.7 cm 一致）；S3 灯室画面很暗，细节难判断；游戏内 S3 的事件帧记到 24/61/69/99/137/173（截图脚本按收到事件那一帧记，swiftshader 帧率低，不是动画错）
- [x] 5 commit 6ebd047（worktree 提交，master fast-forward）

### F-2 最终回归（10-31 05:28–05:58 UTC+7，worktree /workspace/scratch/r3/game 用 r3 原件镜像 art 构建；art/ 现有美术未告知的新一版在制品，没用它）
- [x] 从 HEAD（6ebd047）重建 dist；npm run check 全绿（exit 0，r3-check.log）；改冒烟后在 5f8c1f5 再跑一次 check 仍 exit 0（r3-check2.log）
- [x] size：common 35.09 MB、s1 91.89 MB、common+s1 126.98 / 150 MB、s1 进场后懒加载 2.41 MB（mus-s1-ebb-shore.ogg）、首次进入 S1 总下载 132.39 / 150 MB、s3 25.72 MB
- [x] 冒烟（SMOKE_ONLY 逐项、后台、一次一个浏览器）：033 ✓、008 ✓、010 ✓、013 art=1 ✓；015 art=1 两次同样挂在「谜题 5 流程」：`进入可点灯应开始嗡鸣循环（一个实例）`，hum on / starts 1 / stops 0 正常，但 loopNames = amb-wind-tower, amb-water-in-tower, sfx-beam-hum-loop, sfx-ignite-ready-loop
  - 原因：断言要求 loopNames 只能有嗡鸣一条；?art=1 下塔内环境声和导光镜连通的光束嗡鸣（032 起）也在循环里，属正常。之前 015「谜题 5」只在 art=0 下跑过（q12/q13-015b），batch15 的 015 art=1 只跑了「白盒」一项，所以一直没暴露。不是游戏回归，是用例过期
  - 修：humSt 的 loops 只取 sfx-ignite-ready-loop，其他循环记 others（commit 5f8c1f5）；015 art=1 单独重跑 ✓（05:53–05:56），015 谜题 5 art=0 ✓（05:56–05:57）
- [x] 新建的 smoke-chrome-* 配置目录已清；前任遗留卡在 015 art1 的 finalq/q2.sh（04:44 起）已杀并清其配置目录
- 备注：game/dist 没覆盖（主仓库构建会带进 art/ 里的在制品）；r3 + HEAD 的 dist 在 /workspace/scratch/r3/game/dist
