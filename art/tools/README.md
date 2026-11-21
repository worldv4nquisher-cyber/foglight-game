# art/tools — 美术导出工具

对应 `docs/tasks/v0.1-index.md` §5（美术交付规范）。所有命令都在仓库根目录 `game-studio/` 下运行。


## 0. 现状（2026-10-29）：离线 Node 管线

Blender / gltf-transform CLI / KTX-Software 暂时装不上（外网下载被安全检查拦下），021 的两件道具先用 **Node 程序化建模**，只依赖 `game/node_modules` 里已有的 `three` 和 `meshoptimizer`，以及 Python 的 PIL（转 WebP）：

```bash
python3 art/source/props/gen_tex_props_puzzle_ch1.py      # 程序生成 2048 图集 PNG（固定种子）
node art/tools/build-props-ch1.mjs                        # → art/models/props/prop-lantern-brass.glb、prop-lantern-stand-s2.glb、prop-key-cellar-s2.glb（--only=名字 只重建这几件）
node art/tools/inspect-glb.mjs art/models/props/*.glb     # 读回自检：三角面、材质、节点、extras、COLOR_0
node art/tools/render-preview-web.mjs                     # 无头 Chrome 三渲二预览 → art/models/props/preview/*.png
```

- `build-props-ch1.mjs`：几何用 three（Lathe/Tube/Torus/Box + 抛物面罩），手写 GLB。+Y 向上、正面 +Z、1 单位 = 1 m；根节点 `extras.puzzleCritical=true`；`COLOR_0` = 平滑法线（网格本地 glTF 空间，`n*0.5+0.5`，RGBA8 归一化）；
  meshopt `reorderMesh` 顶点缓存优化 + **EXT_meshopt_compression**（用 meshoptimizer 编码器直接写，不需要 `@gltf-transform/extensions`；未做量化）。`--no-meshopt` 关闭压缩，`--png` 内嵌 PNG 而不是 WebP。输出逐字节可复现。
- 贴图目前是 **WebP 内嵌（EXT_texture_webp，必需扩展）**，两只 GLB 各带一份图集。**还没转 KTX2**：工具装好后跑 `tex-to-ktx2.sh` 出 `art/textures/tex-props-puzzle-ch1-*.ktx2`，再把 GLB 的贴图换成 KTX2（共用图集外置或 `gltf-transform etc1s/uastc`）。
- **地窖钥匙 `prop-key-cellar-s2`（2026-10-30）**：旧黄铜钥匙，长 9.5 cm、厚 6 mm（环 / 颈箍 / 杆 / 双齿），共用 `tex-props-puzzle-ch1` 图集的黄铜区；材质 `mat-prop-key-brass`（v0.1-029，10-30）：仍用 tex-props-puzzle-ch1 图集黄铜区，metallicFactor 0.6、roughnessFactor 0.45（略反光的旧黄铜，不自发光）。节点：根 `prop-key-cellar-s2` → `_lod0` 292 / `_lod1` 140 / `_lod2` 76 三角面 + `-collider`（盒）。按需求带 LOD0/1/2，所以根**不标 puzzleCritical**（标了游戏载入会丢 LOD1/2）。原点 = 握点（钥匙底面、食指 / 中指指腹之间，杆身上）：根节点直接对齐 `env-cellar-s2-key-socket` 就平放在架面上（长边沿本地 X，环在 -X = 汐右手边，齿朝 -Z = 朝她）。挂手：`xi-pickup-shelf` grab 第 22 帧挂到 `middle_03_r`，`key.matrix = middle_03_r.matrixWorld × 根 extras.attach`（translation [-0.00843, 0.02492, 0.00414]，rotation [0.04513, -0.26586, 0.96208, 0.04104]，缩放 1；由 `node art/tools/key-attach-offset.mjs` 从 char-xi-anims 算出，第 21→22 帧不跳）。重建：`node art/tools/build-props-ch1.mjs --only=prop-key-cellar-s2 && node art/tools/glb-pack-ktx2.mjs art/models/props/prop-key-cellar-s2.glb`。预览：`art/models/props/preview/prop-key-cellar-s2-grab.png`（anims.html 读真模型）。
- **潮汐钟 `prop-tide-bell`（2026-10-30）**：S1 / S3 共用，puzzleCritical、只有 LOD0（13,820 三角面）。可动节点是 `bell-swing`（吊点 y 1.80，绕本地 +X）和 `bell-clapper`。节点、摆动参数、场景换算和重建命令见 `art/models/props/README.md`。
- **木筏 `prop-raft-s1`（2026-10-30）**：S1 搁浅木筏，puzzleCritical、只有 LOD0（12,504 三角面）。根 = 甲板顶中心（白盒 `raft-s1` 根），节点有 `-interact` / `-palm-l/r` / `-stand-s/n` / `-waterline` / `-ring`。世界坐标核对和重建命令见 `art/models/props/README.md`。
- 注意：GLTFLoader 看到 `COLOR_0` 会给材质开 `vertexColors`；COLOR_0 是描边数据，游戏侧替换/设置材质时要关掉 `vertexColors`。
- `render-preview-web.mjs` + `preview/index.html`：本地 127.0.0.1 静态服务 + 临时配置目录的无头 Chrome（SwiftShader），阴天冷色天光 #8FA0AE、MeshToonMaterial 3 阶色阶、COLOR_0 外扩描边（屏幕空间 1.6 px）。

下面第 1–3 节是 Blender 管线，工具装上后再用。

## 1. 需要的工具

| 工具 | 版本 | 位置 | 用途 |
|---|---|---|---|
| Blender | 4.2 LTS（4.2.23）或更新 | `/opt/blender/blender` | 建模、导出 GLB、预览渲染 |
| @gltf-transform/cli | ^4.2 | `art/tools/node_modules/.bin/gltf-transform` | Meshopt 压缩、KTX2 打包、`inspect` 核对 |
| KTX-Software | 4.3+（提供 `ktx`，旧版只有 `toktx`） | `/opt/ktx`，`bin` 加进 PATH | PNG → KTX2 |

安装（需要能访问外网）：

```bash
# Blender 4.2 LTS
curl -LO https://download.blender.org/release/Blender4.2/blender-4.2.23-linux-x64.tar.xz
curl -LO https://download.blender.org/release/Blender4.2/blender-4.2.23-linux-x64.tar.xz.sha256
sha256sum -c blender-4.2.23-linux-x64.tar.xz.sha256
sudo tar -xf blender-4.2.23-linux-x64.tar.xz -C /opt && sudo mv /opt/blender-4.2.23-linux-x64 /opt/blender
/opt/blender/blender --version

# gltf-transform
(cd art/tools && npm install)

# KTX-Software（GitHub Releases 的 Linux 包，解到 /opt/ktx）
#   https://github.com/KhronosGroup/KTX-Software/releases  → KTX-Software-<ver>-Linux-x86_64.tar.bz2
sudo mkdir -p /opt/ktx && sudo tar -xjf KTX-Software-*-Linux-x86_64.tar.bz2 -C /opt/ktx --strip-components=1
export PATH=/opt/ktx/bin:$PATH LD_LIBRARY_PATH=/opt/ktx/lib:$LD_LIBRARY_PATH
ktx --version
```

## 2. 脚本

### `export-glb.py` — Blender 导出 GLB

```bash
/opt/blender/blender -b art/source/props/props-puzzle-ch1.blend --python art/tools/export-glb.py -- \
  --root prop-lantern-brass --out art/models/props/prop-lantern-brass.glb
```

- 只导出 `--root` 及其子树；根节点导出时临时归零（.blend 里可以并排摆放多个道具）。
- **Y 轴向上**（`export_yup`）。模型正面朝 Blender −Y，导出后就是 glTF +Z。
- **Custom Properties → extras**（`export_extras`）：`puzzleCritical`、`collider`、`glowDefault` 等都会进 GLB。
- **平滑法线 → 顶点色 `COLOR_0`**：按位置焊接后取面积加权平均法线，换算到 glTF 坐标 `(x, z, −y)`、网格本地空间，编码为 `n*0.5+0.5`。描边 shader 解码 `n = color*2−1`。
- 应用修改器（`export_apply`），不导出相机/灯光/动画，不用 Draco。
- 导出后用 gltf-transform 做 **Meshopt**（`meshopt --level medium`）。装了 KTX-Software 时先把内嵌贴图转 KTX2：颜色贴图 ETC1S，法线/ORM UASTC。`--no-ktx2` 可跳过。

### `tex-to-ktx2.sh` — 贴图转 KTX2

```bash
art/tools/tex-to-ktx2.sh art/source/textures/tex-props-puzzle-ch1-*.png        # 输出到 art/textures/
art/tools/tex-to-ktx2.sh --hq art/source/textures/xxx-albedo.png -o some/dir     # 颜色也用 UASTC
```

按文件名后缀决定编码：`-albedo`/`-emissive`/`ui-*` → sRGB ETC1S（`--hq` 为 UASTC）；`-normal` → 线性 UASTC + normal 模式；其余（`-orm`、`-ramp`、`-lightmap`…）→ 线性 UASTC。全部带 mipmap，UASTC 加 zstd 18。

### `render-preview.py` — 冷色阴天预览

```bash
/opt/blender/blender -b art/source/props/props-puzzle-ch1.blend --python art/tools/render-preview.py -- \
  --root prop-lantern-brass --out art/models/props/preview/prop-lantern-brass.png
```

世界色 #8FA0AE + 弱冷色太阳，Cycles CPU，AgX。`-collider` / `-interact` / `-socket` / `-emitter*` 节点不入画。

## 3. 第一章解谜道具完整流程（需求单 021）

```bash
python3 art/source/props/gen_tex_props_puzzle_ch1.py                       # 程序生成 2048 图集 PNG
/opt/blender/blender -b --factory-startup --python art/source/props/build_props_puzzle_ch1.py   # 生成 props-puzzle-ch1.blend
B="/opt/blender/blender -b art/source/props/props-puzzle-ch1.blend --python"
$B art/tools/export-glb.py -- --root prop-lantern-brass    --out art/models/props/prop-lantern-brass.glb
$B art/tools/export-glb.py -- --root prop-lantern-stand-s2 --out art/models/props/prop-lantern-stand-s2.glb
art/tools/tex-to-ktx2.sh art/source/textures/tex-props-puzzle-ch1-*.png
$B art/tools/render-preview.py -- --root prop-lantern-brass --out art/models/props/preview/prop-lantern-brass.png
$B art/tools/render-preview.py -- --root prop-lantern-stand-s2 --out art/models/props/preview/prop-lantern-stand-s2.png
```

地窖钥匙 `prop-key-cellar-s2`（2026-10-30）只走 Node 管线，见第 0 节。

## 4. 自检

```bash
art/tools/node_modules/.bin/gltf-transform inspect art/models/props/prop-lantern-brass.glb   # 面数、材质、节点、extras
(cd game && npm run check && node scripts/verify-lod.mjs)
```

注意：`game/scripts/verify-lod.mjs` 目前**不读命令行参数**，只检查 `game/public/assets/models/test-lod-puzzle-critical.glb`。所以 `node scripts/verify-lod.mjs <文件>` 并不会真的校验我们的道具；道具的 puzzleCritical / LOD 要靠 `inspect` 和人工核对。

## 5. 主角汐 016 最终版流程

```bash
B=${BLENDER:-blender}   # Blender 可执行文件，用环境变量 BLENDER 指定
$B -b --factory-startup --python art/source/characters/build_char_xi.py -- build   # 建模+骨骼+权重+LOD+图集 UV → char-xi.blend、art/source/characters/bake/char-xi-raw.glb（r2：头/脸几何在 xi_head.py）
$B -b art/source/characters/char-xi.blend --python art/source/characters/build_char_xi.py -- bake   # Cycles 烘焙 位置/法线/属性/AO → art/source/characters/bake/bake-*.exr；同时输出 uvtris（每个三角形的 UV + pid）→ art/source/characters/bake/char-xi-bake-uvtris.npz（入库，gen_tex 补袖口等 UV 退化部件要用，缺了直接报错）
$B -b --python art/source/characters/exr2npy-char-xi.py                              # exr → npy（行 0 = 图像顶部），读写 art/source/characters/bake/
python3 art/source/characters/gen_tex_char_xi.py [--preview]                         # → art/source/textures/tex-xi-{albedo,normal,orm,sdf-face,ramp}.png（约 4 分钟，建议 nohup 后台跑；r2 脸块 + SDF 在 xi_face_tex.py，可单独跑预览）
export PATH=$KTX_HOME/bin:$PATH LD_LIBRARY_PATH=$KTX_HOME/lib   # KTX-Software 4.4.2（KTX_HOME 指向解压目录）不在默认 PATH 时
art/tools/tex-to-ktx2.sh --hq art/source/textures/tex-xi-albedo.png -o art/textures   # albedo 用 --hq（UASTC）
art/tools/tex-to-ktx2.sh art/source/textures/tex-xi-{normal,orm,ramp,sdf-face}.png -o art/textures
node art/tools/finish-char-xi.mjs                                                    # 材质/外置贴图/COLOR_0/extras/UV 夹紧 → art/models/characters/char-xi.glb
node art/tools/glb-pack-ktx2.mjs art/models/characters/char-xi.glb                   # Meshopt + 量化
node art/tools/verify-glb-ktx2.mjs art/models/characters/char-xi.glb
node art/tools/render-preview-web.mjs --char && python3 art/tools/compose-vs-concept.py
node art/tools/verify-xi-head-symmetry.mjs                                           # r2：各 LOD 脸的顶点 / 三角重心镜像误差（应为 0）
node art/tools/measure-father-hoh.mjs 56 136                                         # 父亲摸头接触（0 悬空帧 / 0 穿头皮帧）
# r2 头部对比：PREVIEW_MOUNT="/before/=<旧资产目录>/" node art/tools/render-preview-web.mjs --page char-head.html --jobs jobs.json
#   （jobs = [[query, 绝对 png 路径, w, h], …]；query 见 preview/char-head.html 顶部注释），再 python3 art/tools/compose-xi-head-r2.py <渲染目录> [notes.json]
```

中间文件（xi-base.json 骨架、bake-*.exr / *.npy、char-xi-raw.glb、uvtris）全部在 `art/source/characters/bake/`，不再依赖 /tmp。

约定：一张 4096 图集给 3 个材质（身体 v∈[0.25,1]，头发 u∈[0,0.5]×v∈[0,0.25]，脸 u∈[0.5,0.75]×v∈[0,0.25]）；脸另有 TEXCOORD_1 = 平面脸 UV 供 SDF。
SDF：值 = 该像素变暗时的光照水平角/90°，亮 = θ <= sdf；光从角色右侧(−X)直接采样，从左侧时 u 取 1−u。
湿痕 = ORM.a：`color *= 1 - 0.22*wet*uWetness; roughness = mix(rough, 0.28, wet*uWetness)`。
注：量化会给每个 LOD 节点复制一份 skin（3 份，关节完全相同、同一套骨骼节点），three.js 中共用同一骨架。
