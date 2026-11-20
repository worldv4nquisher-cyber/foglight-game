# 汐 r5 美术返修 · 给程序的说明（2026-10-31）

Asia/Bangkok 时间；未改 game/，未提交。

## 装入 art/ 的文件

| 文件 | 改前字节 | 改后字节 | md5（改后） |
|---|---|---|---|
| art/models/characters/char-xi.glb | 2,094,040 | 2,077,172 | 7d3342f53fae9d3338f0e12825ba78c2 |
| art/models/characters/char-xi-anims.glb | 1,512,312 | 1,513,928 | 37e3b971957a93cf746f85e4a04945fb |
| art/source/characters/xi-ponytail-hood-fix.json（新） | — | 20,157 | — |

- char-xi.glb 与旧版相比只有 COLOR_0 不同。位置、法线、骨骼、权重、UV、索引、IBM、节点 TRS 都逐字节一致，所以 father hand-on-head 没有受影响（已复测）。
- char-xi-anims.glb：有 11 个 clip 加了马尾/兜帽纠正，这些 clip 的 extras 带 `ponytailHoodFix` 标记。其余 20 个 clip 与 r4 完全一致（含 walk/idle/stand-gaze），sit-write 只改了右臂和上身。
- 修正量由 `art/tools/finish-xi-anims.mjs raw out [--fix=path|--no-fix]` 读 `xi-ponytail-hood-fix.json` 叠加，作用于 ponytail_01..03、hood_01/02。公式 q' = R(conj(acc)·axis, a)·q。改动画后重新导出时会自动套用。

## 1. look-up 剩余穿插是测量脚本的假阳性（d628d5f scripts/measure-ponytail-hood.mjs）

**原因**
- 脚本给非索引的 BufferGeometry 建 `new MeshBVH(g)`。MeshBVH 会给它生成 index 并重排三角形。
- 之后 `hit.faceIndex` 指的是重排后 `g.index` 里的第几个三元组。
- 脚本却按原始数组取三角形：`tri.a.fromArray(arr, hit.faceIndex*9)`。拿到的是另一个三角形，用它的法线判断里外，正负号近似随机。
- 后面的 DoubleSide 射线补救只能把一部分假负翻回来，所以会残留假阳性。

**修法**（补丁见 `char-xi-r5-measure-fixidx.diff`）：
```js
const ix = g.index;
tri.setFromAttributeAndIndices(g.attributes.position, ix.getX(fi), ix.getX(fi+1), ix.getX(fi+2));
```
其中 `fi = hit.faceIndex*3`。

**复现**：把补丁打到脚本副本上（加了 env PT_ART / PT_OUT / PT_FIXIDX），在 game 目录运行：
```
PT_ART=../art/models/characters PT_OUT=/tmp/pt           node --import ./scripts/register-ts-paths.mjs scripts/measure-ponytail-hood.mjs xi-look-up
PT_ART=../art/models/characters PT_OUT=/tmp/pt PT_FIXIDX=1 node --import ./scripts/register-ts-paths.mjs scripts/measure-ponytail-hood.mjs xi-look-up
```

| 口径 | look-up 最深 | 穿 >2 mm 帧 |
|---|---|---|
| 原口径 | 1.82 cm @86 | 26/151 |
| PT_FIXIDX=1 | 0 | 0/151 |

- PT_FIXIDX=1 时 31 个 clip 全部为 0。
- 原口径下，除 look-up 外全部 0 帧超 2 mm。row-boat 最深 0.08 cm，walk/idle/stand-gaze/sit-write 均为 0。
- look-up 在原口径下凑不到 ≤0.2 cm：按原口径反解得 1.50 cm，放宽限位后 1.63 cm，形状反而变差，所以保留按正确三角形求出的解。
- 建议程序合入这一行修正再复测。

## 2. 描边壳（OutlineHull）

- COLOR_0 的改法：
  - 身体和脸：0.5 mm 容差焊接后平均法线。旧版用 2e4 取整做键，把领口接缝上几乎重合的点拆开了，这就是锯齿暗线的来源。
  - 头发：一律朝外。马尾从 ponytail 骨链往外取方向，其余头发从头发中心往外取方向。再加半球约束 dot(n, 顶点法线) ≥ 0.05，这样 checkOutlineNormals 的 5% 翻面检查能通过。
  - alpha 宽度系数没有改。
- 结果：同一位置法线夹角 >10° 的顶点对，身体 1,275 → 1，头发 1,756 → 0。
- 注意事项：
  - OutlineHull 不读 COLOR_0 的 alpha。
  - 投影后方向长度 ≤1e-5 时整点不外扩。
  - 头发发梢是压扁的管，正反两面的顶点重合，这是正常的。
- 请程序在游戏里用 shots-r4 的机位重拍 s1-xi-*-hull。我的对比图来自轻量预览页：壳 shader 逐行照搬 OutlineHull.ts，toon 底色，不是游戏截图。游戏内截图（shots-031）在本机内存不足（chrome 被 OOM）时无法完成。

## 3. xi-sit-write（05 镜头）

- 只改这个 clip：右臂和上身往右下让开，手仍在日志上，笔仍对准插槽。
- 用 Blender 按游戏机位做代理统计可见度：

| | 日志可见 | 笔可见 |
|---|---|---|
| 改前 | 32–38% | 0% |
| 改后 | 46–52% | 8–10% |

- 发现：机位在她右肩后方，身体往右倾反而挡得更多，所以只让了手臂和前倾。
- 游戏里目前不渲染笔，请确认。
- 请程序在游戏里重拍 05 镜头确认构图。

## verify（最终装入版本，r5/log-verify-final.txt，13:08）

- 全部通过：verify-glb-ktx2、verify-xi-anims --batch=3（73 骨、hand_r_socket 一致）、verify-father-anims、verify-lod（13 项）、verify-xi（含描边壳 9 网格）、verify-father（hand-on-head：核对后 palm -0.27 cm @112，有缝帧 0/81，与 r4 一致）。
- 头部对称 0.000 mm。
- father glb/blend 的 md5 不变。
