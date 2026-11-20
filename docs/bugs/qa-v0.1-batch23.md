# QA v0.1 batch23：程序 561837d..69683cd（HEAD 69683cd）

- 快照：`/workspace/qa-tools/snap-69683cd`。game 是 `git archive 69683cd` 的真拷贝，node_modules 和 art 用 cp -a 真拷贝，硬链接数 0；audio 和 docs 是软链。快照建好后已删除 snap-561837d（02:08 UTC+7）。
- 范围：7 个提交（b979994、70886fe、29cbd26、b04ec53、ec15cb8、d770b1c、69683cd）。
- 环境：headless Chrome + SwiftShader（无 GPU）。同一时间只开一个 Chrome，启动前可用内存 ≥ 1.5 GB。SMOKE_ESTAB_TIMEOUT_MS=180000，SMOKE_LOAD_TIMEOUT_MS=120000。不判 fps，也不判美术观感。脚本输出都写到 `qa-v0.1-batch23/`。
- 新 bug 从 BUG-032 起编号。

<!-- SUMMARY -->
| 项 | 结果 | 说明 |
|---|---|---|
| ① BUG-030 功能复核 | ✅ | 4 张 ramp 都是 RGBA、1 层，采样覆盖 0 → 255，加载期 0 条 0x502；`?rampfix=0` 重现 BC7、全 0、10 条 0x502；其他 66 张 KTX2 逐张不变 |
| ② 资源校验（非 4 倍数 KTX2） | ✅ | verify-assets 和 check-size 都拒非 4 倍数又没标 ramp 的 KTX2；`ramp: true` 豁免有效，> 4096 texel 照样拒 |
| ③ BUG-031 回归（原脚本） | ✅ | 015 通过；035 b–e 第一次就过；035a 第一次因 BUG-032 假失败（结束帧 t=106.016 落在 [106, 106.02) 区间），复跑通过。没有再出现 S3 释放后读 `__s3` 的问题 |
| ④ P3 EventBus | ✅ | 注入抛错监听器后 S1→S2→菜单 都完整切过去，后面的监听器照常执行，listenerErrors 正确计数；冒烟遇到 listenerErrors > 0 会失败（console.error 被屏蔽时也会） |
| ⑤ check:release + 010 / 033 + 快查 | ✅ | release EXIT 0：size 132.20 MB 不变，budget 只剩 4 个 S1 标准档已知项，load 和 memory 都过；010 和 033a/b 通过；反射 0.5、BUG-028 相机、钢笔都和之前一致 |

**本批新 bug：** BUG-032（低，测试侧）。smoke 035a 的结束阈值写死成 106.02，游戏演出 106 s 就结束，跨过 106 的那一帧落在 [106, 106.02) 时会假失败。

**可以关闭：BUG-030、BUG-031**（①–③ 都通过）。

**观察（不算 bug）：**
- ramp 仍然按 sRGB 上传，和修前一样，请程序或美术确认这是有意的。
- 资源豁免按文件名匹配。
- 冒烟读 listenerErrors 失败时会按 0 算。
<!-- /SUMMARY -->

## ① BUG-030 功能复核（b979994 / b04ec53 / ec15cb8）（02:14:51–02:22:02 UTC+7，`ramp/t23-ramp.json`、`ramp/t23-ramp.log`）

**方法。** 真浏览器，S1，`?art=1&quality=ultra`。一次 Chrome 里按顺序进三次：修后 → `?rampfix=0` → 修后（第二次，看能否重现）。
- **GL 错误。** 页面加载前注入钩子，包住 `texStorage2D`、`compressedTexSubImage2D`、`compressedTexImage2D`、`texSubImage2D`、`texImage2D`：每次调用后立刻 `getError()`，把错误算到当时绑定的那张纹理上。加载完再清一次错误队列。
- **ramp 采样。** 用程序的 `scripts/lib/ramp-probe.mjs`：读格式和 mip 数，用原生 WebGL 在 u = 1/8、3/8、5/8、7/8 四个点采样。
- **其他 KTX2。** 场景里所有压缩纹理逐张记录三样：three 侧的格式、尺寸、mip 数；GL 实际分配的 internalformat、尺寸、层数；以及对应的网络请求。

| 项 | 修后（第 1、2 次结果相同） | `?rampfix=0` |
|---|---|---|
| 4 张 ramp 格式（xi-ramp / ramp-char / ramp-env / ramp-metal-wet） | **RGBA 未压缩**，GL 是 SRGB8_ALPHA8（0x8C43） | BC7（RGBA_BPTC，GL 0x8E8D） |
| mip 层数 | **1**（minFilter = Linear）；GL texStorage 1 层 | 9（LinearMipmapLinear） |
| 走未压缩路由的 URL | 正好这 4 张 ramp | 0 张 |
| 4 点采样（R=G=B） | xi-ramp / char：0, 0, 255, 255；env：0, 0, 37, 255；metal-wet：0, 25, 25, 255。都覆盖 0 → 255，不再是全黑 | **4 张全是 (0, 0, 0, 255)** |
| 加载期 GL 错误（逐调用） | **0 条**；加载后清队列为空；截图期间也是 0 | **10 条 0x502（1282）**：texStorage2D ×1 + compressedTexSubImage2D ×9，都落在一张 256×1 的 BC7 sRGB 9 层纹理上。修前的问题重现了 |
| 页面报错 | 0；控制台只有 `THREE.KTX2Loader: Multiple active KTX2 loaders…` 这一条警告（已知，不计） | 0 |

**其他 KTX2 没变。**
- S1 里另外 66 张 KTX2，修后和 `?rampfix=0` **逐张对比**，以下字段 0 处不同：格式、宽高、mip 数、minFilter、GL internalformat、GL 尺寸、GL 层数。
- 66 张全是 BC7（GL 0x8E8C / 0x8E8D）。尺寸分布：2048² ×31、1024² ×29、4096² ×3、512² ×2、512×1024 ×1。
- 本机 SwiftShader 支持 BPTC，所以 S1 里没有出现 BC3。BC3 那条路径这里**看不到**。
- **网络。** 两种模式下 KTX2 请求都是 76 个，76 个都是不同的 URL，没有一个下了两次。新的路由是先取文件读文件头再解析，确认没有多下载。包体见 ⑤a：132.20 MB，和上一批一样。

**`?rampfix=0` 真的重现了修前的样子（只比数值，不评美术）。**
- 用同一个机位截了三张图：S1 南缝 x 10.5 朝东站，时间冻结，和 batch22 `quick/stand-east-x10.5.png` 的机位一样。
- 量汐躯干区域（1280×720 图里 x 645–750、y 370–490）的平均灰度：

| 截图 | 汐躯干平均灰度 | p90 |
|---|---|---|
| batch22（561837d，修前代码） | 30.9 | 52 |
| 本批 `?rampfix=0` | 31.5 | 54 |
| 本批修后 | 50.3 | 77 |

- `?rampfix=0` 和修前代码只差 0.6 灰度级。修后明显变亮，是因为 ramp 不再是全 0。
- 三张并排裁图：`ramp/xi-crop-b22-off-fix.png`，从左到右依次是修前、rampfix=0、修后。原图是 `ramp/s1-east-{fix,off}.png`。
- 好不好看由美术和用户判断。

**附带观察（不算 bug）。** 4 张 ramp 修前修后都按 sRGB 上传（清单里没写 `srgb: false`）。查找表一般存的是线性值，ramp-env 中段的 37 和 metal-wet 的 25 会被当成 sRGB 解码。这一点修前修后一样，不是这批引入的。是否本来就是这样设计的，请程序或美术确认一下。

**结论：✅ 通过。** 4 张 ramp 都是 RGBA、1 层，采样覆盖 0 → 255，加载期 0 条 0x502 / 1282；`?rampfix=0` 能重现 BC7、全 0、0x502；其他 66 张 KTX2 格式和尺寸不变，没有重复下载。（256 点逐点采样见下。）

**256 点逐点采样补跑**（02:45:47–02:46:38 UTC+7，`ramp/t23-ramp256.json`、`ramp/t23-ramp256.log`）：把 256 个 texel 逐个画出来，再用 readPixels 读回。

| ramp | 修后：最小 → 最大 / 单调不降 / 不同灰度值个数 / R=G=B | `?rampfix=0` |
|---|---|---|
| tex-xi-ramp | 0 → 255 / ✅ / 16 / ✅ | BC7 9 层，256 点全是 0 |
| tex-ramp-char | 0 → 255 / ✅ / 16 / ✅ | 同上 |
| tex-ramp-env | 0 → 255 / ✅ / 26 / ✅ | 同上 |
| tex-ramp-metal-wet | 0 → 255 / ✅ / 23 / ✅ | 同上 |

- 修后 4 张 ramp 都覆盖 0 到 255，而且单调不降。
- 它们是分段的 toon ramp，不是平滑的线性渐变：每隔 16 个 texel 取一点，看到的是台阶，比如 xi 是 0…0, 146, 255…255。这是素材本身的设计，不判美术效果。
- 两次采样期间 glErr 都是 0。

## ② 资源校验：非 4 倍数 KTX2（70886fe / 29cbd26）（02:08–02:14 UTC+7，日志 `assets/a23-*.log`）

**方法。** 在 `/workspace/qa-tools/b23-assets` 做了一份拷贝：game 的 src / scripts / dist 和 art 都是 cp -a 真拷贝。所有假文件和清单改动只做在这份拷贝里，真资源和快照都没动。
- 假 KTX2 的做法：拿 `tex-xi-sdf-face.ktx2` 复制一份，只改文件头里的 pixelWidth / pixelHeight。规则只读文件头。
- 两个入口都测了：
  - `verify-assets`（`npm run test:assets`），查 `../art`；
  - `check-size`（`npm run size`，在 check:release 里），查 `dist`。

| # | 假文件 | 清单 | verify-assets（../art） | check-size（dist） | 期望 |
|---|---|---|---|---|---|
| 0 | 不放（基线） | 原样 | ✅ 33 项过；92 张，非 4 倍数 4 张都是 ramp | ✅ 82 张，非 4 倍数 4 张都是 ramp | 过 |
| 1 | 1022×1024 | 不标 | ❌「KTX2 宽高须为 4 的倍数…查找表请在 manifest 标 ramp: true」 | ❌ 同样的话，1 张不合规 | 拒 ✅ |
| 2 | 1024×1022，放在子目录 | 不标 | ❌ 同上 | — | 拒 ✅ |
| 3 | 256×1 | 不标 | ❌ 同上（没标 ramp 的 256×1 也拒） | ❌ 同上 | 拒 ✅ |
| 4 | 256×1 | `ramp: true` | ✅ 通过；非 4 倍数 5 张都是 ramp* | ✅ 通过；非 4 倍数 5 张都是 ramp | 豁免 ✅ |
| 5 | 254×2 | `ramp: true` | ✅ | — | 豁免 ✅ |
| 6 | 4096×1 | `ramp: true` | ✅（正好 4096 texel） | — | 豁免 ✅ |
| 7 | 4097×1 | `ramp: true` | ❌「非 4 倍数的 ramp…限 ≤ 4096 texel」 | ❌ 同上 | 拒 ✅ |
| 8 | 1022×1024 | `ramp: true` | ❌ 超过 4096 texel | — | 拒 ✅ |

\* verify-assets 里有一条单测，断言清单里标 ramp 的**正好是那 4 个 key**。所以第 4–8 行我在拷贝里把这条断言的列表也加上了 `tex-qa23-ramp`，否则这条单测会先失败。这条断言本身也是对的：清单多标一个 ramp 就会报出来。

**附带观察（不算 bug，低）。**
- 豁免是按文件名（basename）匹配清单的，不看路径。
- 实测：在 dist 子目录 `assets/qa23/` 放一张 250×1、文件名也叫 `tex-ramp-env.ktx2` 的图，check-size 照样当 ramp 放过，只另外报「没有登记在清单里」警告。
- 影响很小：运行时走的路由是按宽高分的，非 4 倍数的图本来就转成未压缩 RGBA，不会出 0x502；texel 上限也照样卡着。

**结论：✅ 通过。** 非 4 倍数又没标 ramp 的 KTX2 两个入口都会拒；`ramp: true` 的豁免有效，4096 texel 上限有效。

## ⑤a npm run check:release（02:07:36–02:14:41 UTC+7，一次跑完，EXIT 0；期间没开别的 Chrome。日志 `perf/r23-release.log`）

| 项 | 结果 | 和 batch22 比 |
|---|---|---|
| 包体 | 菜单包 5.48 MB / 15 MB；首场景包 126.72 MB / 150 MB；首次进 S1 总下载 132.20 MB / 150 MB | 一样 |
| 新增检查「KTX2 块对齐」 | ✅ dist 里 82 张，非 4 倍数的 4 张都是清单里的 ramp | 新增 |
| 预算 | ✅ 0 失败。已知警告 **只有 4 条**，都是 S1 standard 主 pass 面数：raft-back 2.20 M、neighbor-note 2.40 M、spawn-north 2.56 M、opening 2.33 M | batch22 还有 3 条 BUG-030 的 0x502，这次**没有了** |
| 加载 | ✅ 主菜单 1066 ms，3.69 MB / 40 个请求；S1 首帧 3883 ms，全部加载完 4413 ms，129.0 MB / 147 个请求，失败 0 | 22 批是 3268 / 3794 ms、149 个请求；本机回环时间只做记录，不判 |
| 内存 | ✅ 通过。再进 S1 显存 427.2 → 426.6 MB（×0.999），对象堆 10.3 → 10.4 MB | 和 22 批一致 |

预算里除了允许的 4 条 S1 standard 面数，**没有别的超预算项**。

## ③ BUG-031 回归：015 art=1 + 035 五项，用仓库原脚本（02:22:42–02:29:48 UTC+7，复跑 02:47:39；日志在 `smoke/q23-*.log`）

**方法。**
- 全部用 `npm run smoke`，也就是仓库原版 smoke-browser.mjs，**没有用任何补丁副本**。
- 每次只跑一项（SMOKE_ONLY），环境变量按惯例设置。

| 用例 | 第 1 次 | 复跑 |
|---|---|---|
| v0.1-015 S3（art=1，白盒 + 谜题 5 流程） | ✅ 通过 | — |
| 035a 结尾演出 art=1 | ❌ 1 项：`演出结束时刻 {"how":"end","t":106.016,"prevT":105.344,"src":"audio",…}`，其他 cue 和结束页判定都过了 | ✅ 通过（02:47:39；演出结束 @106.67 s，上一帧 105.97，0.71 s 后切到结束页） |
| 035b 跳过 art=1 | ✅ | — |
| 035c 后备时钟 art=0 | ✅ | — |
| 035d 结尾曲晚到 | ✅ | — |
| 035e 结尾曲下载失败 | ✅ | — |

**BUG-031 的症状没有再出现。**
- 6 项里都没有「S3 释放后读 `__s3`」这类 TypeError 或超时。
- 035a 第一次失败时也拿到了完整的 `r.end` 数据，失败点只是阈值判断。

**035a 第一次失败的原因：新 bug BUG-032（低，测试侧，偶发假失败）。**
- 游戏这边：演出时长是 `ENDING_CUES.silence = 106`（src/systems/audio/endingMusic.ts，经 content/cutscenes/ending.ts 的 `end`）。CutscenePlayer 在 `t ≥ 106` 的第一帧结束，`how=end`。
- 冒烟这边：smoke-browser.mjs 第 3528 行（5997f87 引入）要求 `fe.t >= 106.02 && fe.prevT < 106.02`。
- 所以跨过 106 的那一帧只要落在 [106, 106.02) 区间里，游戏行为是对的，冒烟却会判失败。这次 t=106.016 正好落在里面。
- 以前几批跑出来的结束帧是 106.14 / 106.55 / 106.60 / 106.61，都在 106.02 以上，所以一直没暴露。
- 软件渲染下一帧 0.3–2.7 s，撞上的概率大约 1–5%，只能估个量级。
- 建议：endAt 改成 106，即 `ENDING_CUES.silence`，直接从源里取，或者和曲子长度统一成一个常量。按约定不改源码，这里只记录。

**③ 结论：✅（附说明）**
- 015 通过；035 五项里 4 项第一次就过，035a 第一次因 BUG-032 失败，复跑通过。
- 从原脚本看 BUG-031 已经修好。
- 严格算的话，第一轮 035 是 4/5，复跑后 5/5。

## ④ P3 EventBus（69683cd）

### ④a 注入抛错监听器，看切场景是否完整（02:22:02–02:22:42 UTC+7，`bus/t23-bus.json`）

**方法。** 自己写的 CDP 脚本，跑的是快照 dist，游戏代码没改。
- 在 `scene:change` 的监听器集合里**最前面**插一个必定 `throw` 的监听器，最后面再插一个只做记录的 marker。
- 中间是游戏自己的 4 个监听器：Game 自动存档、GameFlow 等。
- 这正是 batch22 BUG-031 里切场景只做了一半的那种情形。

| 步骤 | 结果 |
|---|---|
| S1 → S2（`flow.goToLevel('s2')`） | ✅ 当前场景 `s2-keeper-house`；`transitioning=false`；输入上下文 explore；`__s2.rig` 在，`__s1` 已删。3 s 内固定步走了 37 个，场景在正常更新 |
| S2 → 菜单（`flow.toMenu()`） | ✅ 当前场景 menu；主菜单显示了；菜单场景的 `lamp.material` 在。batch22 在这里报 `reading 'material'`，这次没有。等 4 s 也没出页面异常 |
| 后面的监听器 | ✅ 两次都执行了，执行顺序是 thrower → 游戏的 4 个 → marker |
| 计数 | ✅ `listenerErrors` 0 → 1 → 2；`recentListenerErrors` 记成 `scene:change: QA23 injected …` |
| 报错没被吞 | ✅ console.error 打出 `[EventBus] listener for "scene:change" threw: Error: QA23 injected …`，带原始调用栈（emit ← SceneManager.change ← goToLevel / toMenu） |

### ④b listenerErrors > 0 会不会让冒烟失败（02:30:29–02:30:51 UTC+7，`smoke/q23-busthrow.log`、`smoke/q23-bussilent.log`）

**方法。**
- 在快照里复制一份 `scripts/qa23-busfail.mjs`：就是 smoke-browser.mjs 原样，只在 `const extra =` 前面加了两项 QA 检查。这个文件用完就删。
- 这两项检查会在 `qa23:test` 上注册「抛错监听器 + 后续监听器」，然后 emit 一次。
- 冒烟末尾的 `listenerErrors` 汇总判定（第 4020 行）没有改动。

| 用例 | 注入后 | 冒烟结果 |
|---|---|---|
| bus-throw（console.error 照常） | listenerErrors=1，后续监听器执行了 1 次 | ✅ **失败 2 项**：`✗ EventBus 监听器抛错 1 次（最近：["qa23:test: Error: QA23 injected throw"]）`，外加原本就有的 console.error 失败项 |
| bus-silent（临时屏蔽 console.error） | listenerErrors=1 | ✅ **失败 1 项**，只靠计数判的：`✗ EventBus 监听器抛错 1 次 …`，EXIT 1 |

**反向对照。** ③ 和 ⑤ 里的正式冒烟（015、035b–e、010、033a/b）都没有出现 EventBus 失败项，说明正常流程里 listenerErrors 是 0。

**观察（不算 bug）。**
- 第 4020 行写的是 `evaluate(...).catch(() => 0)` 加 `?? 0`。
- 页面已经崩掉，或者 `__game` 不存在时，计数会按 0 算，不会报错。
- 这种情况下其他检查一般已经失败了，所以影响很小。

**④ 结论：✅** 抛错的监听器不会打断切场景，后面的监听器照常执行；listenerErrors > 0 会让冒烟失败。

## ⑤b 回归冒烟 010 / 033 + 快查（02:30:51–02:45:47 UTC+7）

### 回归冒烟（用仓库原版 `npm run smoke` 和 smoke-browser.mjs，每项只跑 1 次；日志在 `smoke/`）

| 用例 | 结果 |
|---|---|
| v0.1-010 场景流程（02:30:51） | ✅ 冒烟测试通过，EXIT 0 |
| v0.1-033 配乐：主菜单（02:31:43） | ✅ 通过 |
| v0.1-033 懒加载失败（02:32:54） | ✅ 通过 |

三项都没有出现 EventBus 失败项。

### 反射默认 0.5（`quick/t23-quick.json`）

用 `?quality=ultra&autostart=1` 进 S1，不加反射参数，然后依次切到高、标准，再切回极致：

| 档位 | strength / k | scale | RT 尺寸 | 是否渲染 |
|---|---|---|---|---|
| 极致 | 0.5 / 0.5 | 0.5 | 640×360 | ✅ |
| 高 | 0.5 / 0.5 | 0.5 | 640×360 | ✅ |
| 标准 | 0.5 / 0.5 | 0.25 | 256×144 | ✅ |
| 切回极致 | 0.5 / 0.5 | 0.5 | 640×360 | ✅ |

结果和 batch22 完全一致，✅。

### BUG-028 相机（#157 南缝，低潮，z −8.6，极致档）

| 段 | 相机离头最近（离头骨） | 最小 alpha | 离头 < 0.35 m 的帧数 | batch22 |
|---|---|---|---|---|
| x 10.5 朝东站 | 4.02 m（4.071） | 1 | 0 | 4.02 / 1 |
| x 10.5 朝北 yaw 0 | 0.735 m（0.795），抬高 0.595 | 0.784 | 0 | 0.735 / 0.784 |
| x 10.5 原地转 | 0.617 m（0.686） | 0.478 | 0 | 0.617 / 0.478 |
| x 12 原地转 | 0.617 m（0.687） | 0.478 | 0 | 0.617 / 0.478 |

- 全程相机没有进头。
- 9 个身体网格和 9 个描边壳一起淡出。
- noFadeWhenNear / fadeWhenFar 各 3 帧，是钩子晚一帧看到 alpha，原因和 batch21/22 一样。
- 截图：`quick/north-rock-yaw0-x10.5.png`、`quick/stand-east-x10.5.png`。
- 没有回退，✅。

### 钢笔（`pen/t23-pen-full.json`，356 个采样，页面错误 0）

**挂载。**
- `hand_r_socket`，父链 hand_r → lower_arm_r → upper_arm_r。
- clip xi-sit-write；prop-fountain-pen.glb 加载成功，没有回退。
- 探索阶段不显示。

**按镜头看显示情况。**
- 01–04 段（far-exterior … regaze）：0 个采样可见。
- 从 t=59.01 切到 over-shoulder 开始可见，posing 是 xi-sit-write，w=1。
- over-shoulder 33/33、pull-room 30/30、pull-tower 26/26、pull-sea 26/26、pull-end 41/41 都可见。
- 演出结束后切到 chapter-end，S3 释放，`__s3` 和笔一起没了。
- 和 batch20 记录的显示时间线一致，✅。
- 截图：`pen/pen-full-05-t59.01.png`。这里不判美术效果。

**⑤ 结论（⑤a + ⑤b）：✅**
- size、budget、load、memory 全过；budget 只剩 4 个 S1 标准档已知项。
- 010 和 033 两项回归通过。
- 反射、BUG-028 相机、钢笔都和之前一致。

