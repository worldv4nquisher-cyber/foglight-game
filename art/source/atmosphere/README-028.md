# v0.1-028 天空 / 雾 / 雨 / 水面 / 特效贴图、LUT、ramp：交付说明

日期：2026-10-30（UTC+7）· 美术 Bot · 未改 `game/`，未 commit。
数据文件：**`art/source/atmosphere/atmosphere-028.json`**（全部参数都在这里，程序直接读或照抄到 `quality.ts` / 预设里）。
本文件只讲用法和取舍；数值以 JSON 为准。

## 1. 文件与包体

上限：**028 合计 ≤ 9.0 MB**（原自定 6.0 MB；制作人 v0.1 裁定 18 把水面法线升 2048 后调整）。实际 **8.84 MB**；common+s1 由约 110.6 → **约 119.4 / 150 MB**。每个文件的像素 / 字节也写在 JSON `textureSizes`。

| 文件（art/textures/） | 尺寸 | 编码 | 字节 |
|---|---|---|---|
| tex-sky-clouds-overcast-albedo.ktx2 | 2048×1024 | ETC1S sRGB + mip | 1,395,441 |
| tex-fog-card-a-albedo.ktx2（远景雾墙，横向可平铺） | 1024 | ETC1S sRGB + mip | 262,179 |
| tex-fog-card-b-albedo.ktx2（雾团） | 1024 | ETC1S sRGB + mip | 191,675 |
| tex-fog-card-c-albedo.ktx2（贴地 / 贴水雾） | 1024 | ETC1S sRGB + mip | 83,988 |
| tex-rain-ripple-normal.ktx2（8×8 flipbook，64 帧循环） | 1024 | UASTC+zstd + mip | 1,147,846 |
| tex-rain-streak-albedo.ktx2（4 列变体） | 512 | ETC1S | 11,219 |
| tex-rain-splash-albedo.ktx2（溅射序列） | 512 | ETC1S | 8,806 |
| tex-lens-droplets-normal.ktx2 | 1024 | UASTC+zstd | 322,404 |
| tex-water-normal.ktx2（可平铺） | 2048（裁定 18） | UASTC+zstd + mip | 4,774,226 |
| tex-water-foam-albedo.ktx2 | 1024 | ETC1S | 395,248 |
| tex-beam-noise-albedo.ktx2 | 512 | ETC1S | 90,755 |
| tex-beam-spot-albedo.ktx2 | 512 | ETC1S | 87,449 |
| tex-glow-lighthouse-albedo.ktx2 | 256 | ETC1S | 24,720 |
| tex-ramp-char / env / metal-wet.ktx2 | 256×1 | UASTC | 1,048 / 1,135 / 1,145 |
| lut/lut-overcast-dusk.png | 1024×32 | PNG | 7,746 |
| lut/lut-overcast-after-rain.png | 1024×32 | PNG | 11,780 |
| lut/lut-rain-night.png | 1024×32 | PNG | 11,719 |
| lut/lut-after-lit.png | 1024×32 | PNG | 11,132 |
| lut/lut-identity.png（程序校验方向用） | 1024×32 | PNG | 307 |
| **合计** | | | **8,841,968 B ≈ 8.84 MB** |

全部 `.ktx2` 已过 `ktx validate`。源 PNG：`art/source/textures/atmosphere/`，生成脚本 `art/source/textures/gen_tex_atmosphere.py`（固定 seed，可重跑；`gen-report.json` 记录 ripple 首尾差等自检）。
水面法线 2048（制作人 v0.1 裁定 18，2026-10-30）：`python3 gen_tex_atmosphere.py water` 默认就出 2048；1024 旧版 1,229,729 B 备份在 /workspace/bk-b6/。

## 2. 雨（ultra 30k）各档参数

原则：数量翻 5 倍，每滴必须更淡更细，否则整屏抬亮发灰。ultra / high 改用**带贴图的细长 quad（InstancedBufferGeometry）**，standard 保留现有 1 px `LineSegments`。混合用普通 alpha（不要 additive）；颜色取中灰（不是白）；像素宽度钳制 + 透明度守恒（细于 1 px 时按比例降 alpha，不靠放大变白线）。

| 参数 | ultra | high | standard（现行线） | 现行 Rain.ts |
|---|---|---|---|---|
| count | 30,000 | 15,000 | 6,000 | 6,000 |
| 形式 | quad + streak 贴图 | quad + streak 贴图 | 1 px line | 1 px line |
| 宽度 widthM / 屏宽钳制 | 0.009 m / 1.0–2.5 px | 0.010 m / 1.0–2.5 px | 1 px | 1 px |
| 长度 m | 0.40–0.85 | 0.40–0.85 | 0.35–0.75 | — |
| opacity | **0.24** | **0.28** | 0.20 | 0.22 |
| fadeNear（smoothstep m） | 1.0 → 2.6 | 1.0 → 2.6 | 0.8 → 2.2 | 0.6 → 2 |
| fadeFar | 3 → 16 | 3 → 18 | 3 → 21 | 3 → 23 |
| depthBoost（距离 m: 倍率） | 0:1.0, 3–7:1.25, 12:0.8, 30:0.6 | 0:1.0, 3–7:1.2, 12:0.85, 30:0.7 | — | — |
| 颜色（预设） | 黄昏 #A3B0BA / 雨夜 #6F7E8B | 同 | 同 | #9FB0C0 |
| splash /s、半径 | 900, 12 m | 450, 10 m | 150, 8 m | — |
| 涟漪（flipbook） | 2 层（旋转+错帧），强度 0.35 | 1 层 0.35 | 1 层 0.30 | — |
| 镜头水滴 | 仅过场 | 关 | 关 | — |

实测（S1 channel 机位 1600×900，与 rain=off 逐像素比，ΔL 单位 /255）：

| 方案 | 整体抬亮 meanΔL | 可见雨线像素 | 最亮雨线 p99.9 |
|---|---|---|---|
| 现行 6k 线 0.22 | +0.07 | 0.36% | +28.9 |
| 直接 30k 线 0.22（naive） | **+0.45** | **1.85%** | **+47.9**（白线、发灰） |
| ultra 30k quad 0.24 | +0.09 | 0.79% | +18.6 |
| high 15k quad 0.28 | +0.05 | 0.46% | +17.1 |
| standard 6k 线 0.20 | +0.06 | 0.42% | +25.9 |

模型估算（`rain_coverage.py`，读 JSON 的 rainTiers，跑完把 check 写回 JSON）：结果在 `rain-coverage.json`。

## 3. 雾

- **远景雾墙**（`s1.farWalls`，5 层圆柱段，半径 175 / 225 / 290 / 370 / 470 m，高 22→11 m，opacity 0.26→0.66，tex-fog-card-a）。
  - **跟随相机 xz**（同天空盒，不随 y 和旋转），否则相机走进峡道时会穿到雾墙端口，露出硬边。
  - 弧段两端 uv.x 12% 淡出；近相机 20→60 m 淡出。
  - 颜色 = 预设 `fog.farWallTint` × (层 tint / #C9D0D4)：夜里随预设变暗，不出亮带。
  - 不吃场景雾（fog:false），depthWrite false，renderOrder 2。
  - 档位层数见 `fogTiers.farLayers`（standard 4 层）。
- **018 遗留：岛边地面雾**（`s1.groundFog.island`）。在主灯塔岛周围放面向相机的雾片（不用圆柱环：圆柱侧面掠射时会叠成白色"台座"）。
  - 内圈 r 26 m × 9 片，高 2.4 m，op 0.34；外圈 r 40 m × 11 片，高 1.8 m，op 0.26。
  - 只压在礁丘底部（台面 7.4 m、塔基 6.6 m 以下），y 跟潮位。
  - 另外还有 2 个雾团和 8 片贴水薄雾（nearWater，距离 45–120 m）。
  - 所有雾片：uv.x 两端 22% 淡出，近相机 8→25 m 淡出。
  - standard 的 groundFogOpacityMul 为 1.15（用雾片补体积雾）。
- **fogDensityHint**（`s1.fogDensityHint`）：glTF extras 已有 0.0036（objectFog.ts 已读）。建议程序按预设覆盖：

| 预设 | 全局雾（已裁定） | 主岛 / 灯塔 fogDensityHint |
|---|---|---|
| overcast-dusk | #B9C2C8 / 0.009 | 0.0036 |
| overcast-after-rain | #C3CBD0 / 0.007 | 0.0032 |
| rain-night | #3A444C / 0.016 | 0.0042 |
| after-lit | #AEB7BE / 0.008 | 0.0034 |

  - 远景两座小灯塔剪影在天空层，不吃场景雾：用固定色 #56616B 向 farWallTint 混 0.38（黄昏）/ 0.5（雨夜）。
  - 全局雾色和密度：制作人裁定按本表（028 预设），026 现值（如 0x4a555e / 0.028）需替换。

## 4. 天空

- 半球 + 云层贴图：`sky.top / mid / horizon` 三段渐变 + 云层 tex-sky-clouds（球面投影 scale 0.55，uv 滚动 `scroll`/s）。
- 云层透明度在 `fadeElev` 范围内向地平线淡出；`horizonLift` 把地平线附近的云提亮，让它融进雾。
- 黄昏 `duskBand` 是一条只在低仰角出现的暖灰带（#C9A88A，强度 0.45）。它不是光源，不违反 §0 "唯一暖光"。
- 云 tint：黄昏 #9EA6AD / 0.96，雨后 #B3BAC0 / 0.78，雨夜 #5A646C / 0.95，点亮后 #A2A9AF / 0.82。
- 预览实现见 `art/tools/preview/atmo028.js` 的 `makeSky()`，可以直接照搬到 SkyDome.ts。

## 5. 水面

- 法线两层：14 m（scroll 0.012, 0.006）与 5.3 m（−0.008, 0.011）。
- 雨天叠 ripple flipbook：tile 1.5 m，24 fps，64 帧，8×8。
  - 采样必须用 `textureGrad`，并把 mip 限制在 ≤ 3（maxMipLevel），否则格子边会渗色。
  - ultra 叠第二层（旋转 37°、×1.37、错 4 帧）来打散平铺感。
- 每个预设的 water 颜色、fresnel、normalScale、reflectDistort 见 JSON `presets.*.water`。
- 泡沫 tex-water-foam：用在礁石、岛边的接水线带，宽度按 `s1.waterFoam`。
- 参考实现：atmo028.js `waterShader()` / `foamMaterial()`。

## 6. LUT（与 026 约定，待程序确认）

- 32³，展开成 1024×32 PNG：第 b 片 = B，片内 x = R，PNG 自上而下 G 0→1。
- 加载：flipY=false，NoColorSpace，LinearFilter，无 mip。
- 用在 tone mapping + sRGB 编码之后（display space），采样代码见 atmo028.js `LUT_GLSL / applyLut`（两片之间按 B 线性插值）。
- 先套 `lut-identity.png` 验证方向，画面应该完全不变。
- 校验：S1 环境像素 HSV S ≤ 25%（实测 opening 机位 p95 见第 8 节）；琥珀暖光保持 S 62–68%。

## 7. ramp / 光束 / 辉光

- ramp：u = N·L×0.5+0.5，读 R（与 tex-xi-ramp 一样）；char / env / metal-wet 三条。
- beam-noise：光束体积内沿光束方向滚动的噪声。beam-spot：投在雾墙、海面上的光斑。glow-lighthouse：灯室辉光 billboard。参数见 JSON `beam` / `glow`。

## 8. 预览图（art/source/atmosphere/preview/）

`render-preview-web.mjs --page env.html --jobs <json>` 出图，1600×900。
- `s1-<view>-a-before.png`：现行。
- `-b-naive30k.png`：直接 30k 线，不调参。
- `-c-028-ultra.png`：本单。
- `s1-channel-c-028-{high,standard}.png`：档位对比。
- `s1-opening-d-{rain-night,overcast-after-rain,after-lit}.png`：其他预设。
- view：opening（涨潮）、channel（退潮峡道）、opening-low（退潮开场）。
- 预览开关：`env.html?atmo=028&preset=…&tier=…&rain=028|naive|current|off&lut=0&fogHint=<数值>`。默认 URL 渲染结果不变。
- rain-night 预览把天光 / 主方向光 ×0.35（JSON `previewLightMul`，仅预览用；正式夜间灯光归 026）。

## 9. 偏差 / 待定

1. 源文件：需求单写的是 `atmosphere-ch1.psd/.kra`，实际交付 Python 程序生成脚本（可重跑，固定 seed），没有 PSD。
2. ~~水面法线 1024~~ → 已按裁定 18 升 2048。
3. LUT 格式仍需要 026 程序先试一张确认（需求单要求的流程）。
4. 全局雾：制作人已裁定**按本单各预设**（fog.color / density），026 照接；雨颜色同样按预设。
5. 夜间剪影依赖 026 的夜间灯光确实比黄昏暗（预览按 ×0.35 近似）：如果夜里灯塔亮度不降，剪影会反转（实测 −0.03）。
6. 预览发现 S1 channel 机位有一块半透明竖向矩形，在"现行"图里就有，不是 028 引入的，可能是 018 的水体或旧雾片，建议 018 打磨时查。

## 10. 校验（预览实测，1600×900，原始数据 preview-measure.json）

灯塔剪影：塔身 vs 两侧背景亮度（Weber = (背景−塔)/背景，> 0.15 视为可读）

| 图 | 塔 L | 背景 L | Weber |
|---|---|---|---|
| opening 现行 | 0.497 | 0.649 | 0.234 |
| opening 028 ultra（dusk，hint 0.0036） | 0.482 | 0.640 | 0.246 |
| 同上，但 hint = 全局 0.009（消融） | 0.669 | 0.651 | **−0.027（剪影消失）** |
| opening-low 028 ultra | 0.482 | 0.640 | 0.246 |
| after-rain（hint 0.0032） | 0.497 | 0.680 | 0.269 |
| after-lit（hint 0.0034） | 0.460 | 0.634 | 0.275 |
| rain-night（hint 0.0042，预览灯光 ×0.35） | 0.173 | 0.251 | 0.309 |

饱和度（HSV S，风灯琥珀像素不计）：
- opening 028：S 中位 6.9%，p95 21.1%。
- opening-low 028：p95 23.8%。
- channel 028：全图 S 中位 23.0%；V ≥ 0.3 的像素 p95 23.1%（现行 24.1%）。
- 全部 ≤ 25%。channel 全图 p95 偏高（45%），是因为 V < 0.3 的暗部 HSV S 被放大，不代表颜色更鲜艳。
- flipbook 循环：相邻帧平均差 0.084，首尾差 0.062（≤ 相邻帧，无跳帧）。
- KTX2：全部 `ktx validate` 通过；尺寸都 ≤ 需求表。
