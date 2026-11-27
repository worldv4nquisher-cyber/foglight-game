/**
 * 资源清单。所有运行时资源都在这里登记，按 group 分包加载（v0.1-010，GDD §10 / §14）。
 *
 * 分组（加载时机）：
 * - boot   启动页最小资源（现在为空：启动页是 DOM + CSS）
 * - menu   主菜单 + UI + 字体（启动时和 boot 一起加载，「主菜单包」≤ 15 MB，3 秒内出现主菜单）
 * - common 主角、风灯、通用材质 / 音效（随首场景加载，之后常驻）
 * - s1 / s2 / s3 各场景专属资源（「首场景包」= common + s1 ≤ 150 MB；S2 / S3 在前一场景后台预加载，离开场景后释放）
 * `npm run size`（scripts/check-size.mjs）按这里的分组统计 dist 里的实际文件大小，超预算构建失败。
 *
 * 约定：
 * - 文件放 public/assets/<类型>/，文件名小写英文 + 短横线，如 hero-idle.glb、ui-button-start.png
 * - url 写相对 public 的路径（不要以 / 开头，保证 base='./' 打包后可用）
 * - optional: true 表示缺失时不报错，使用占位几何体/纹理/静音兜底（美术资源未到位时先跑通）
 * - 模型优先 .glb（可 Draco / Meshopt 压缩，贴图可用 KTX2）；独立贴图优先 .ktx2，其次 .webp
 * - 字体：scripts/subset-fonts.mjs 按文本表实际用字子集化成 WOFF2（npm run fonts），以 FontFace 注册，CSS 直接用 family 名
 * - image（030 UI）：DOM / CSS 用的位图和 SVG（不进 three）。非 lazy 的随组预下载并解码，src/ui/uiArt.ts 写成 CSS 变量；
 *   lazy 的不随组下载，用到时（打开阅读器 / 进结尾页 / 菜单退回静态背景）才 AssetLoader.loadImage(key)，失败退回纯色底
 */
export type AssetType = 'gltf' | 'texture' | 'ktx2' | 'audio' | 'font' | 'image';

/** 加载分组（顺序 = 一般加载顺序） */
/** dev：只给 ?scene=sandbox 用的测试资源（037：不进任何正式场景包，npm run size 单列，不计首场景包） */
export const ASSET_GROUPS = ['boot', 'menu', 'common', 's1', 's2', 's3', 'ch2-s1', 'ch2-s2', 'ch2-s3', 'dev'] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];
/** 场景组：离开场景后可以释放 */
export const LEVEL_GROUPS: readonly AssetGroup[] = ['s1', 's2', 's3', 'ch2-s1', 'ch2-s2', 'ch2-s3'];

export interface AssetEntry {
  /** 代码里引用的唯一 key */
  key: string;
  type: AssetType;
  url: string;
  group: AssetGroup;
  optional?: boolean;
  /** 纹理是否为颜色贴图（决定 sRGB 色彩空间），默认 true */
  srgb?: boolean;
  /**
   * BUG-030：仅 ktx2，1D 查找表（色阶 ramp）。运行时只留第 0 级、Linear、不生成 mip；
   * 也是 verify-assets「KTX2 宽高须为 4 的倍数」的白名单（≤ KTX2_UNALIGNED_MAX_TEXELS，运行时转未压缩 RGBA，见 ktx2Route.ts）。
   */
  ramp?: boolean;
  /**
   * 仅 gltf：COLOR_0 的含义。默认跟随 gameConfig.assets.vertexColorsAreOutlineNormals（美术约定 = 描边平滑法线，
   * 加载后关掉材质 vertexColors）；'color' = 这个资源的 COLOR_0 是真顶点色，保留 vertexColors。
   */
  vertexColors?: 'outline' | 'color';
  /**
   * ../art 交付的美术资源（url 以 assets/art/ 开头，vite.config.ts 的 artAssets 插件在 dev 映射、build 时拷进 dist）。
   * `?art=0`（以及冒烟测试默认）不加载，按缺失处理（场景退回白盒）。
   */
  art?: boolean;
  /**
   * 约定了文件名、美术还没交付（021 / 022 解谜道具）：只有构建 / dev 启动时 ../art 里真有这个文件才加载，
   * 否则直接按缺失处理（不发请求、不 404）。文件放进 art/ 后重新 `npm run build`（dev 重启）即生效，代码不用改。
   */
  pending?: boolean;
  /** 仅 audio：播放增益（dB，可正可负；缺省 0）。短促音按文件补响度用（032） */
  gainDb?: number;
  /** 仅 font：CSS font-family 名（styles.css 的 --ui-font / --ui-serif 排在最前） */
  family?: string;
  /**
   * 不随组预加载。
   * - image：用到时 AssetLoader.loadImage(key) 才下载（030：阅读纸张、章节结尾插画、主菜单静态兜底背景），体积仍按 group 计入分包（npm run size）。
   * - audio（033 改）：用到时 AssetLoader.loadAudio(key) 才下载（S1 场景曲：首帧渲染后），npm run size 单列「<group> 进场后懒加载」，不计入首场景包。
   */
  lazy?: boolean;
}

export const manifest: AssetEntry[] = [
  // ---- menu：字体子集（思源黑体 / 思源宋体 = Noto Sans / Serif CJK SC，SIL OFL 1.1；npm run fonts 生成）
  { key: 'font-sans', type: 'font', url: 'assets/fonts/foglight-sans.woff2', group: 'menu', family: 'Foglight Sans' },
  { key: 'font-serif', type: 'font', url: 'assets/fonts/foglight-serif.woff2', group: 'menu', family: 'Foglight Serif' },
  // ---- menu：030 UI 美术（art/ui/，README-030；21 个运行时文件，1,533,136 B）。主菜单 / 加载页 / 通用件随主菜单包预加载，
  //      主菜单静态背景只在 008 实时背景不可用时懒加载（兜底）
  { key: 'ui-title-logo', type: 'image', url: 'assets/art/ui/ui-title-logo.webp', group: 'menu', optional: true, art: true },
  { key: 'ui-title-logo-svg', type: 'image', url: 'assets/art/ui/ui-title-logo.svg', group: 'menu', optional: true, art: true },
  { key: 'ui-panel-frame', type: 'image', url: 'assets/art/ui/ui-panel-frame.webp', group: 'menu', optional: true, art: true },
  { key: 'ui-panel-corner', type: 'image', url: 'assets/art/ui/ui-panel-corner.svg', group: 'menu', optional: true, art: true, lazy: true },
  { key: 'ui-button-primary', type: 'image', url: 'assets/art/ui/ui-button-primary.webp', group: 'menu', optional: true, art: true },
  { key: 'ui-button-secondary', type: 'image', url: 'assets/art/ui/ui-button-secondary.webp', group: 'menu', optional: true, art: true },
  { key: 'ui-icon-interact', type: 'image', url: 'assets/art/ui/ui-icon-interact.svg', group: 'menu', optional: true, art: true },
  { key: 'ui-icon-hint-lantern', type: 'image', url: 'assets/art/ui/ui-icon-hint-lantern.svg', group: 'menu', optional: true, art: true },
  { key: 'ui-icon-journal', type: 'image', url: 'assets/art/ui/ui-icon-journal.svg', group: 'menu', optional: true, art: true },
  { key: 'ui-icon-read', type: 'image', url: 'assets/art/ui/ui-icon-read.svg', group: 'menu', optional: true, art: true },
  { key: 'ui-icon-settings', type: 'image', url: 'assets/art/ui/ui-icon-settings.svg', group: 'menu', optional: true, art: true },
  { key: 'ui-icon-app-512', type: 'image', url: 'assets/art/ui/ui-icon-app-512.png', group: 'menu', optional: true, art: true },
  { key: 'ui-illust-loading', type: 'image', url: 'assets/art/ui/ui-illust-loading.webp', group: 'menu', optional: true, art: true },
  { key: 'ui-illust-menu', type: 'image', url: 'assets/art/ui/ui-illust-menu.webp', group: 'menu', optional: true, art: true, lazy: true },
  // ---- common（懒加载）：阅读纸张 ×6（README-030 §2.2 data-doc 映射，见 src/ui/uiArt.ts PAPER_FOR_DOC）、第一章结尾插画
  { key: 'ui-paper-journal', type: 'image', url: 'assets/art/ui/ui-paper-journal.webp', group: 'common', optional: true, art: true, lazy: true },
  { key: 'ui-paper-letter', type: 'image', url: 'assets/art/ui/ui-paper-letter.webp', group: 'common', optional: true, art: true, lazy: true },
  { key: 'ui-paper-note', type: 'image', url: 'assets/art/ui/ui-paper-note.webp', group: 'common', optional: true, art: true, lazy: true },
  { key: 'ui-paper-sketch', type: 'image', url: 'assets/art/ui/ui-paper-sketch.webp', group: 'common', optional: true, art: true, lazy: true },
  { key: 'ui-paper-notice', type: 'image', url: 'assets/art/ui/ui-paper-notice.webp', group: 'common', optional: true, art: true, lazy: true },
  { key: 'ui-paper-logbook', type: 'image', url: 'assets/art/ui/ui-paper-logbook.webp', group: 'common', optional: true, art: true, lazy: true },
  { key: 'ui-illust-chapter1-end', type: 'image', url: 'assets/art/ui/ui-illust-chapter1-end.webp', group: 'common', optional: true, art: true, lazy: true },
  // ---- common：主角模型（美术 016 交付前文件不存在，自动回退为胶囊占位，演示缺失回退流程）
  // v0.1-017 汐定稿：模型（73 骨，LOD 118k / 48.5k / 24.3k，外部贴图 tex-xi-*.ktx2）+ 31 个动画 clip（只有骨骼，1.44 MB，各场景都用 → common）
  { key: 'char-xi', type: 'gltf', url: 'assets/art/models/characters/char-xi.glb', group: 'common', optional: true, art: true },
  { key: 'char-xi-anims', type: 'gltf', url: 'assets/art/models/characters/char-xi-anims.glb', group: 'common', optional: true, art: true },
  // GLB 没引用、材质 extras 点名的两张：色阶 ramp、SDF 脸部阴影（art/tools/README §5）
  { key: 'tex-xi-ramp', type: 'ktx2', url: 'assets/art/textures/tex-xi-ramp.ktx2', group: 'common', optional: true, art: true, ramp: true },
  { key: 'tex-xi-sdf-face', type: 'ktx2', url: 'assets/art/textures/tex-xi-sdf-face.ktx2', group: 'common', optional: true, art: true },
  // ---- common：v0.1-028 天空 / 雾 / 雨 / 水面贴图 + 调色 LUT（README-028；室外场景共用 → common，8.4 MB）
  { key: 'tex-sky-clouds-overcast-albedo', type: 'ktx2', url: 'assets/art/textures/tex-sky-clouds-overcast-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-fog-card-a-albedo', type: 'ktx2', url: 'assets/art/textures/tex-fog-card-a-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-fog-card-b-albedo', type: 'ktx2', url: 'assets/art/textures/tex-fog-card-b-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-fog-card-c-albedo', type: 'ktx2', url: 'assets/art/textures/tex-fog-card-c-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-rain-streak-albedo', type: 'ktx2', url: 'assets/art/textures/tex-rain-streak-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-rain-splash-albedo', type: 'ktx2', url: 'assets/art/textures/tex-rain-splash-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-rain-ripple-normal', type: 'ktx2', url: 'assets/art/textures/tex-rain-ripple-normal.ktx2', group: 'common', optional: true, art: true, srgb: false },
  { key: 'tex-lens-droplets-normal', type: 'ktx2', url: 'assets/art/textures/tex-lens-droplets-normal.ktx2', group: 'common', optional: true, art: true, srgb: false },
  { key: 'tex-water-normal', type: 'ktx2', url: 'assets/art/textures/tex-water-normal.ktx2', group: 'common', optional: true, art: true, srgb: false },
  // 裁定 25 ①（10-31）：028 剩下 7 张 + 018 刷白石砌照常登记（README-028 §1 / §5 / §7）。消费方：beam-noise / beam-spot / glow → 灯束与辉光（排在 r4 之后），
  // water-foam → 025 接水线泡沫，ramp-env / ramp-metal-wet → 023 环境三渲二，ramp-char → 父亲 toonRamp（README-031）；接上之前只下载不使用
  { key: 'tex-beam-noise-albedo', type: 'ktx2', url: 'assets/art/textures/tex-beam-noise-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-beam-spot-albedo', type: 'ktx2', url: 'assets/art/textures/tex-beam-spot-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-glow-lighthouse-albedo', type: 'ktx2', url: 'assets/art/textures/tex-glow-lighthouse-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-water-foam-albedo', type: 'ktx2', url: 'assets/art/textures/tex-water-foam-albedo.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-ramp-char', type: 'ktx2', url: 'assets/art/textures/tex-ramp-char.ktx2', group: 'common', optional: true, art: true, ramp: true },
  { key: 'tex-ramp-env', type: 'ktx2', url: 'assets/art/textures/tex-ramp-env.ktx2', group: 'common', optional: true, art: true, ramp: true },
  { key: 'tex-ramp-metal-wet', type: 'ktx2', url: 'assets/art/textures/tex-ramp-metal-wet.ktx2', group: 'common', optional: true, art: true, ramp: true },
  // LUT：1024×32 PNG（flipY=false、NoColorSpace、线性过滤、无 mip，由 LutEffect 设置）；identity 只给校验用（307 B）
  { key: 'lut-overcast-dusk', type: 'texture', url: 'assets/art/textures/lut/lut-overcast-dusk.png', group: 'common', optional: true, art: true, srgb: false },
  { key: 'lut-overcast-after-rain', type: 'texture', url: 'assets/art/textures/lut/lut-overcast-after-rain.png', group: 'common', optional: true, art: true, srgb: false },
  { key: 'lut-rain-night', type: 'texture', url: 'assets/art/textures/lut/lut-rain-night.png', group: 'common', optional: true, art: true, srgb: false },
  { key: 'lut-after-lit', type: 'texture', url: 'assets/art/textures/lut/lut-after-lit.png', group: 'common', optional: true, art: true, srgb: false },
  { key: 'lut-identity', type: 'texture', url: 'assets/art/textures/lut/lut-identity.png', group: 'common', optional: true, art: true, srgb: false },
  // ---- s1：LOD / 解谜关键物体测试用例（scripts/gen-lod-test-asset.mjs 生成）：白石（puzzleCritical，固定 LOD0）+ 普通对照石
  { key: 'test-lod-puzzle', type: 'gltf', url: 'assets/models/test-lod-puzzle-critical.glb', group: 'dev', optional: true },
  // ---- s1：美术 018 / 020 交付（../art，外部 KTX2 在 ../art/textures；v0.1-013 接入，摆放以 src/levels/s1/layout.ts 为准）
  // 018 主灯塔刷白石砌（mat-env-lighthouse-white，README-s1-layout）：裁定 25 ① 照常登记
  { key: 'tex-lighthouse-whitewash-albedo', type: 'ktx2', url: 'assets/art/textures/tex-lighthouse-whitewash-albedo.ktx2', group: 's1', optional: true, art: true },
  { key: 'env-rock-shore-a', type: 'gltf', url: 'assets/art/models/env/env-rock-shore-a.glb', group: 's1', optional: true, art: true },
  { key: 'env-rock-shore-b', type: 'gltf', url: 'assets/art/models/env/env-rock-shore-b.glb', group: 's1', optional: true, art: true },
  { key: 'env-rock-shore-c', type: 'gltf', url: 'assets/art/models/env/env-rock-shore-c.glb', group: 's1', optional: true, art: true },
  { key: 'env-rock-shore-d', type: 'gltf', url: 'assets/art/models/env/env-rock-shore-d.glb', group: 's1', optional: true, art: true },
  { key: 'env-rock-shore-e', type: 'gltf', url: 'assets/art/models/env/env-rock-shore-e.glb', group: 's1', optional: true, art: true },
  { key: 'env-rock-shore-f', type: 'gltf', url: 'assets/art/models/env/env-rock-shore-f.glb', group: 's1', optional: true, art: true },
  { key: 'env-tidal-flat-s1', type: 'gltf', url: 'assets/art/models/env/env-tidal-flat-s1.glb', group: 's1', optional: true, art: true },
  { key: 'env-pier-wood-ch1', type: 'gltf', url: 'assets/art/models/env/env-pier-wood-ch1.glb', group: 's1', optional: true, art: true },
  { key: 'env-shore-ledge-s1', type: 'gltf', url: 'assets/art/models/env/env-shore-ledge-s1.glb', group: 's1', optional: true, art: true },
  { key: 'env-cliff-s1', type: 'gltf', url: 'assets/art/models/env/env-cliff-s1.glb', group: 's1', optional: true, art: true },
  { key: 'env-unloading-shore-s1', type: 'gltf', url: 'assets/art/models/env/env-unloading-shore-s1.glb', group: 's1', optional: true, art: true },
  { key: 'env-fish-shed-ruin', type: 'gltf', url: 'assets/art/models/env/env-fish-shed-ruin.glb', group: 's1', optional: true, art: true },
  { key: 'env-net-rack-a', type: 'gltf', url: 'assets/art/models/env/env-net-rack-a.glb', group: 's1', optional: true, art: true },
  { key: 'env-net-rack-b', type: 'gltf', url: 'assets/art/models/env/env-net-rack-b.glb', group: 's1', optional: true, art: true },
  // 021 潮汐钟（10-30 交付；S1 / S3 同一文件，S3 另登记 prop-tide-bell-s3）：挂 bell-anchor，bell-swing 跟白盒钟摆（src/levels/s1/artSlots.ts）
  { key: 'prop-tide-bell', type: 'gltf', url: 'assets/art/models/props/prop-tide-bell.glb', group: 's1', optional: true, art: true },
  // 021 木筏（10-30 交付）：根 = 白盒 raft-s1 根（甲板顶面中心），零变换挂上（src/levels/s1/artSlots.ts）
  { key: 'prop-raft-s1', type: 'gltf', url: 'assets/art/models/props/prop-raft-s1.glb', group: 's1', optional: true, art: true },
  { key: 'env-lighthouse-silhouette-far', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-silhouette-far.glb', group: 's1', optional: true, art: true },
  { key: 'env-lighthouse-island-main-s3tower', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-island-main-s3tower.glb', group: 's1', optional: true, art: true },
  { key: 'env-lighthouse-ch1', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1.glb', group: 's1', optional: true, art: true },
  { key: 'prop-boat-rowboat', type: 'gltf', url: 'assets/art/models/props/prop-boat-rowboat.glb', group: 's1', optional: true, art: true },
  { key: 'prop-boat-rowboat-sunken', type: 'gltf', url: 'assets/art/models/props/prop-boat-rowboat-sunken.glb', group: 's1', optional: true, art: true },
  // 027 剧情物件 / 装饰 / 远景海鸟 / 植被（共用图集 tex-props-dressing-ch1-*，GLB 外链；摆位见 src/levels/s1/dressing.ts；装饰与植被留给 034 散布）
  { key: 'prop-notice-board-s1', type: 'gltf', url: 'assets/art/models/props/prop-notice-board-s1.glb', group: 's1', optional: true, art: true },
  { key: 'prop-letter-a', type: 'gltf', url: 'assets/art/models/props/prop-letter-a.glb', group: 's1', optional: true, art: true },
  { key: 'prop-seabird-far', type: 'gltf', url: 'assets/art/models/props/prop-seabird-far.glb', group: 's1', optional: true, art: true },
  { key: 'tex-decal-footprints-albedo', type: 'ktx2', url: 'assets/art/textures/tex-decal-footprints-albedo.ktx2', group: 's1', optional: true, art: true },
  { key: 'prop-rope-coil-a', type: 'gltf', url: 'assets/art/models/props/prop-rope-coil-a.glb', group: 's1', optional: true, art: true },
  { key: 'prop-net-pile-a', type: 'gltf', url: 'assets/art/models/props/prop-net-pile-a.glb', group: 's1', optional: true, art: true },
  { key: 'prop-buoy-a', type: 'gltf', url: 'assets/art/models/props/prop-buoy-a.glb', group: 's1', optional: true, art: true },
  { key: 'prop-barrel-a', type: 'gltf', url: 'assets/art/models/props/prop-barrel-a.glb', group: 's1', optional: true, art: true },
  { key: 'prop-crate-a', type: 'gltf', url: 'assets/art/models/props/prop-crate-a.glb', group: 's1', optional: true, art: true },
  { key: 'env-grass-coastal-a', type: 'gltf', url: 'assets/art/models/env/env-grass-coastal-a.glb', group: 's1', optional: true, art: true },
  { key: 'env-seaweed-a', type: 'gltf', url: 'assets/art/models/env/env-seaweed-a.glb', group: 's1', optional: true, art: true },
  // 029 光照贴图（RGBM8 线性 KTX2，按 GLB 根 extras.lightmap 挂；src/render/lightmap.ts，README-029 §1）
  { key: 'tex-s1-tidal-flat-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s1-tidal-flat-lightmap.ktx2', group: 's1', optional: true, art: true, srgb: false },
  { key: 'tex-s1-cliff-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s1-cliff-lightmap.ktx2', group: 's1', optional: true, art: true, srgb: false },
  { key: 'tex-s1-shore-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s1-shore-lightmap.ktx2', group: 's1', optional: true, art: true, srgb: false },
  // ---- s2：美术 019 交付（v0.1-014 接入，摆放以 src/levels/s2/layout.ts 为准）
  { key: 'env-clifftop-s2', type: 'gltf', url: 'assets/art/models/env/env-clifftop-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-keeper-house-ch1', type: 'gltf', url: 'assets/art/models/env/env-keeper-house-ch1.glb', group: 's2', optional: true, art: true },
  { key: 'env-keeper-house-ch1-interior', type: 'gltf', url: 'assets/art/models/env/env-keeper-house-ch1-interior.glb', group: 's2', optional: true, art: true },
  { key: 'env-cellar-s2', type: 'gltf', url: 'assets/art/models/env/env-cellar-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-repair-yard-s2', type: 'gltf', url: 'assets/art/models/env/env-repair-yard-s2.glb', group: 's2', optional: true, art: true },
  // 021 黄铜风灯（S2 进场就在汐手上；以后 S3 灯室书桌 / S1 开场要用时在该组另登记一个 key，同 s2far 的做法）
  { key: 'prop-lantern-brass', type: 'gltf', url: 'assets/art/models/props/prop-lantern-brass.glb', group: 'common', optional: true, art: true },
  // 021 院子灯台（东 / 西两份同一 GLB，摆在院墙 lamp-east/west-socket）
  { key: 'prop-lantern-stand-s2', type: 'gltf', url: 'assets/art/models/props/prop-lantern-stand-s2.glb', group: 's2', optional: true, art: true },
  // 021 解谜道具（未交付，pending；挂点 / 节点见 src/levels/s2/artSlots.ts）
  { key: 'prop-mirror-stand-s2', type: 'gltf', url: 'assets/art/models/props/prop-mirror-stand-s2.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-light-lock-s2', type: 'gltf', url: 'assets/art/models/props/prop-light-lock-s2.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-white-stones-s2', type: 'gltf', url: 'assets/art/models/props/prop-white-stones-s2.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-dial-gate-s2', type: 'gltf', url: 'assets/art/models/props/prop-dial-gate-s2.glb', group: 's2', optional: true, art: true, pending: true },
  // 017 收尾：地窖钥匙（架上放 env-cellar-s2-key-socket；xi-pickup-shelf grab 帧挂 middle_03_r，extras.attach）
  // 022 灯塔钥匙正式文件（美术回复 1030：节点 / extras.attach 同地窖钥匙）：到了优先用它，缺失回退 prop-key-cellar-s2（S2_KEY_KEYS）
  { key: 'prop-key-lighthouse', type: 'gltf', url: 'assets/art/models/props/prop-key-lighthouse.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-key-cellar-s2', type: 'gltf', url: 'assets/art/models/props/prop-key-cellar-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-cellar-door-s2', type: 'gltf', url: 'assets/art/models/env/env-cellar-door-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-courtyard-wall-s2', type: 'gltf', url: 'assets/art/models/env/env-courtyard-wall-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-laundry-rack', type: 'gltf', url: 'assets/art/models/env/env-laundry-rack.glb', group: 's2', optional: true, art: true },
  // S2 远景 S3 岛 + 灯塔（与 s1 同一文件，s2 组另登记一份：S1→S2 释放 s1 组后仍可用）
  { key: 'env-lighthouse-island-main-s3tower-s2far', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-island-main-s3tower.glb', group: 's2', optional: true, art: true },
  { key: 'env-lighthouse-ch1-s2far', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1.glb', group: 's2', optional: true, art: true },
  // 029 光照贴图（README-029 §2；室内单独一张，补光已烘进去，室内不加实时补光）
  { key: 'tex-s2-clifftop-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s2-clifftop-lightmap.ktx2', group: 's2', optional: true, art: true, srgb: false },
  { key: 'tex-s2-exterior-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s2-exterior-lightmap.ktx2', group: 's2', optional: true, art: true, srgb: false },
  { key: 'tex-s2-interior-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s2-interior-lightmap.ktx2', group: 's2', optional: true, art: true, srgb: false },
  // 027 剧情物件（摆位见 src/levels/s2/dressing.ts：env socket 优先，桌面实测落点）
  { key: 'prop-journal-father', type: 'gltf', url: 'assets/art/models/props/prop-journal-father.glb', group: 's2', optional: true, art: true },
  { key: 'prop-letter-c', type: 'gltf', url: 'assets/art/models/props/prop-letter-c.glb', group: 's2', optional: true, art: true },
  { key: 'prop-desk-set-a', type: 'gltf', url: 'assets/art/models/props/prop-desk-set-a.glb', group: 's2', optional: true, art: true },
  { key: 'prop-kitchen-set-a', type: 'gltf', url: 'assets/art/models/props/prop-kitchen-set-a.glb', group: 's2', optional: true, art: true },
  { key: 'prop-cup-tin', type: 'gltf', url: 'assets/art/models/props/prop-cup-tin.glb', group: 's2', optional: true, art: true },
  { key: 'prop-sketch-window', type: 'gltf', url: 'assets/art/models/props/prop-sketch-window.glb', group: 's2', optional: true, art: true },
  // ---- s3（015）：美术 020 rework-1029，摆位见 levels/s3/art.ts（塔本体另登记 -s3 key，与 s1 组的远景分开释放）
  { key: 'env-lighthouse-ch1-s3', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1.glb', group: 's3', optional: true, art: true },
  { key: 'env-lighthouse-ch1-interior', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1-interior.glb', group: 's3', optional: true, art: true },
  // 022 塔门单独文件（美术回复 1030：door-leaf 原点在铰链、-interact、-collider、锁孔，puzzleCritical 无 LOD）：到了优先用它，缺失用 020 门扇（S3_DOOR_KEYS）
  { key: 'prop-lighthouse-door-s3', type: 'gltf', url: 'assets/art/models/props/prop-lighthouse-door-s3.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'env-lighthouse-ch1-door', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1-door.glb', group: 's3', optional: true, art: true },
  { key: 'env-lamp-room-ch1', type: 'gltf', url: 'assets/art/models/env/env-lamp-room-ch1.glb', group: 's3', optional: true, art: true },
  { key: 'prop-fresnel-lens-ch1', type: 'gltf', url: 'assets/art/models/props/prop-fresnel-lens-ch1.glb', group: 's3', optional: true, art: true },
  { key: 'env-rock-islet-a', type: 'gltf', url: 'assets/art/models/env/env-rock-islet-a.glb', group: 's3', optional: true, art: true },
  { key: 'env-stone-bridge-s3', type: 'gltf', url: 'assets/art/models/env/env-stone-bridge-s3.glb', group: 's3', optional: true, art: true },
  // 031 父亲（BUG-023；README-031）：模型 73 骨 3 档 LOD（外链 tex-father-albedo / normal / orm.ktx2，随 GLB 拷进 dist、size 按引用归 s3）+ 3 个 clip（只有骨骼）。
  // 只在 S3 回忆演出出现（GDD §5.2 / §5.3），默认隐藏；接入见 src/entities/father/FatherActor.ts、S3Scene.father
  { key: 'char-father', type: 'gltf', url: 'assets/art/models/characters/char-father.glb', group: 's3', optional: true, art: true },
  { key: 'char-father-anims', type: 'gltf', url: 'assets/art/models/characters/char-father-anims.glb', group: 's3', optional: true, art: true },
  // 029 光照贴图（README-029 §3；塔本体只在 s3 挂，s1 / s2 远景不挂）
  { key: 'tex-s3-tower-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s3-tower-lightmap.ktx2', group: 's3', optional: true, art: true, srgb: false },
  { key: 'tex-s3-islet-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s3-islet-lightmap.ktx2', group: 's3', optional: true, art: true, srgb: false },
  { key: 'tex-s3-interior-lightmap', type: 'ktx2', url: 'assets/art/textures/tex-s3-interior-lightmap.ktx2', group: 's3', optional: true, art: true, srgb: false },
  // 022 解谜道具（未交付的标 pending；挂点 / 节点见 src/levels/s3/artSlots.ts）。潮汐钟（已交付）与 S1 同一文件，s3 组另登记一个 key（同 s2far 做法）
  // 027 剧情物件（摆位见 src/levels/s3/dressing.ts；日志与 S2 同一文件，s3 组另登记 key）
  { key: 'prop-logbook-s3', type: 'gltf', url: 'assets/art/models/props/prop-logbook-s3.glb', group: 's3', optional: true, art: true },
  { key: 'prop-letter-b', type: 'gltf', url: 'assets/art/models/props/prop-letter-b.glb', group: 's3', optional: true, art: true },
  { key: 'prop-journal-father-s3', type: 'gltf', url: 'assets/art/models/props/prop-journal-father.glb', group: 's3', optional: true, art: true },
  // P3 钢笔（25 KB；结尾坐写 xi-sit-write 时挂汐右手。挂点 / clip / 局部矩阵读 GLB 根 extras.attach → src/entities/xi/clipProp.ts）。
  // s3 组 = 进 S3 才加载（不进首包）；与日志同一图集 tex-props-dressing-ch1-*，KTX2 按 URL 共用缓存，不会重复加载
  { key: 'prop-fountain-pen', type: 'gltf', url: 'assets/art/models/props/prop-fountain-pen.glb', group: 's3', optional: true, art: true },
  // 035 结尾演出：远处第二座灯塔剪影（与 S1 天空层同一文件，s3 组另登记 key）
  { key: 'env-lighthouse-silhouette-far-s3', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-silhouette-far.glb', group: 's3', optional: true, art: true },
  { key: 'prop-tide-bell-s3', type: 'gltf', url: 'assets/art/models/props/prop-tide-bell.glb', group: 's3', optional: true, art: true },
  { key: 'prop-oil-valve-s3', type: 'gltf', url: 'assets/art/models/props/prop-oil-valve-s3.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'prop-guide-mirror-window-s3', type: 'gltf', url: 'assets/art/models/props/prop-guide-mirror-window-s3.glb', group: 's3', optional: true, art: true, pending: true },
  // 导光镜拆两个文件（美术 1030b 第 1 条）：a / b 各自镜心为原点、轴向 = S3 局部，mirror-pivot 单轴偏航
  { key: 'prop-guide-mirror-wall-s3-a', type: 'gltf', url: 'assets/art/models/props/prop-guide-mirror-wall-s3-a.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'prop-guide-mirror-wall-s3-b', type: 'gltf', url: 'assets/art/models/props/prop-guide-mirror-wall-s3-b.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'prop-ignition-port-s3', type: 'gltf', url: 'assets/art/models/props/prop-ignition-port-s3.glb', group: 's3', optional: true, art: true, pending: true },
  // ---- 032 音效 / 环境音（美术 10-30 交付，art/audio/README.md 为准；79 个 ogg 7.66 MB）。程序旧 id → 032 文件名的别名、变体随机见 src/audio/sfxBank.ts
  // gainDb：短促瞬态音（脚步 / 咔嗒 / UI 等）受 −1 dBTP 限幅、积分响度比目标低 2–8 LU，按 audio-report.json 的 target − lufs 补增益（最多 8 dB），听感一致
  // menu：UI 音效（主菜单就要用；036「主菜单包只有 UI 音效」）
  { key: 'sfx-ui-back', type: 'audio', url: 'assets/art/audio/sfx/sfx-ui-back.ogg', group: 'menu', optional: true, art: true, gainDb: 1.2 },
  { key: 'sfx-ui-confirm', type: 'audio', url: 'assets/art/audio/sfx/sfx-ui-confirm.ogg', group: 'menu', optional: true, art: true, gainDb: 1.2 },
  { key: 'sfx-ui-journal', type: 'audio', url: 'assets/art/audio/sfx/sfx-ui-journal.ogg', group: 'menu', optional: true, art: true },
  // ---- 033 配乐（art/audio/music/README.md；−20 LUFS、整文件循环 loop = true，不设循环点、不加淡入淡出；036 混音：音乐总线 −16 dB = 比环境音低 12 dB，场景间 2 s 交叉淡化）
  // 样张 art/audio/music/preview/ 不进 manifest（verify-assets / verify-audio 断言）
  // menu：主菜单曲（036「主菜单包只有 mus-menu 和 UI 音效」；1,779,931 B）。
  //   gainDb（033 改）：主菜单没有环境音，不按「比环境音低 12 dB」，而是和 S1 场景曲在音乐总线上一样响——
  //   整条 RMS −22.09 vs −21.83 dBFS → +0.3 dB（量法和数字见 src/systems/audio/musicLevels.ts）
  { key: 'mus-menu', type: 'audio', url: 'assets/art/audio/music/mus-menu.ogg', group: 'menu', optional: true, art: true, gainDb: 0.3 },
  // s1：退潮岸场景曲，懒加载（制作人 c0d81c9 反馈：不随 s1 组预下载、不算首场景包）——S1 首帧渲染出来后才 loadAudio，
  //     解码完再和主菜单曲 2 s 交叉淡化；404 / 超时 → 菜单曲淡出、不放音乐。npm run size 记在「S1 进场后懒加载」
  { key: 'mus-s1-ebb-shore', type: 'audio', url: 'assets/art/audio/music/mus-s1-ebb-shore.ogg', group: 's1', optional: true, art: true, lazy: true },
  // s2：守灯人小屋场景曲（2,577,617 B，151.1 s，−20 LUFS），和 S1 一样懒加载：S2 首帧渲染后才 loadAudio，解码完和上一首 2 s 交叉淡化；
  //     整文件循环（README：loop 0 – 6664000 样本 = 整个文件）；404 / 超时 → 上一首淡出、不放音乐。npm run size 记在「s2 进场后懒加载」
  { key: 'mus-s2-keeper-house', type: 'audio', url: 'assets/art/audio/music/mus-s2-keeper-house.ogg', group: 's2', optional: true, art: true, lazy: true },
  // s3：灯塔两层场景曲（各 150.0 s = 6615000 样本，loop 整文件）：底层 −20 LUFS、上层（紧张层）−21 LUFS，gainDb 都 0（上层的 −1 LU 是设计值，
  //     全开时两层合起来比底层单放响 +2.5 LU）。和 S1 一样首帧后懒加载、两层并行；同一 AudioContext 时刻起播、样本对齐（switchLayeredMusicLazy），
  //     上层增益 = 玩家高度函数（levels/s3/music.ts）。npm run size 记在「s3 进场后懒加载」
  { key: 'mus-s3-lighthouse', type: 'audio', url: 'assets/art/audio/music/mus-s3-lighthouse.ogg', group: 's3', optional: true, art: true, lazy: true },
  { key: 'mus-s3-lighthouse-upper', type: 'audio', url: 'assets/art/audio/music/mus-s3-lighthouse-upper.ogg', group: 's3', optional: true, art: true, lazy: true },
  // s3：第一章结尾曲（1,839,809 B，107.0 s，−20 LUFS，不循环）。lazy：进 S3 首帧后就预取（EndingMusic.prefetch），
  //     lighthouse:ignited 那一帧 start(0)（文件 0 s = 点燃）；不计入首场景包，npm run size 记在「s3 进场后懒加载」
  { key: 'mus-ending-ch1', type: 'audio', url: 'assets/art/audio/music/mus-ending-ch1.ogg', group: 's3', optional: true, art: true, lazy: true },
  // common：通用（日记纸声、脚步 5 地面 × a–d、落水、潮汐钟 S1/S3 共用、涨退潮、户外雾号 / 海鸟 / 轻风、光束接通 / 持续、镜架咔哒 S2/S3 共用）
  { key: 'amb-foghorn-far-a', type: 'audio', url: 'assets/art/audio/ambience/amb-foghorn-far-a.ogg', group: 'common', optional: true, art: true },
  { key: 'amb-foghorn-far-b', type: 'audio', url: 'assets/art/audio/ambience/amb-foghorn-far-b.ogg', group: 'common', optional: true, art: true },
  { key: 'amb-foghorn-far-c', type: 'audio', url: 'assets/art/audio/ambience/amb-foghorn-far-c.ogg', group: 'common', optional: true, art: true },
  { key: 'amb-seabird-far-a', type: 'audio', url: 'assets/art/audio/ambience/amb-seabird-far-a.ogg', group: 'common', optional: true, art: true },
  { key: 'amb-seabird-far-b', type: 'audio', url: 'assets/art/audio/ambience/amb-seabird-far-b.ogg', group: 'common', optional: true, art: true },
  { key: 'amb-wind-soft', type: 'audio', url: 'assets/art/audio/ambience/amb-wind-soft.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-beam-connect', type: 'audio', url: 'assets/art/audio/sfx/sfx-beam-connect.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-beam-hum-loop', type: 'audio', url: 'assets/art/audio/sfx/sfx-beam-hum-loop.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-mirror-click', type: 'audio', url: 'assets/art/audio/sfx/sfx-mirror-click.ogg', group: 'common', optional: true, art: true, gainDb: 1.5 },
  { key: 'sfx-mirror-click-fine', type: 'audio', url: 'assets/art/audio/sfx/sfx-mirror-click-fine.ogg', group: 'common', optional: true, art: true, gainDb: 0.8 },
  { key: 'sfx-paper-flip-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-paper-flip-a.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-paper-flip-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-paper-flip-b.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-paper-flip-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-paper-flip-c.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-paper-open', type: 'audio', url: 'assets/art/audio/sfx/sfx-paper-open.ogg', group: 'common', optional: true, art: true, gainDb: 3.7 },
  { key: 'sfx-splash-cold', type: 'audio', url: 'assets/art/audio/sfx/sfx-splash-cold.ogg', group: 'common', optional: true, art: true, gainDb: 0.6 },
  { key: 'sfx-step-indoor-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-indoor-a.ogg', group: 'common', optional: true, art: true, gainDb: 2.4 },
  { key: 'sfx-step-indoor-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-indoor-b.ogg', group: 'common', optional: true, art: true, gainDb: 2.1 },
  { key: 'sfx-step-indoor-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-indoor-c.ogg', group: 'common', optional: true, art: true, gainDb: 1.2 },
  { key: 'sfx-step-indoor-d', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-indoor-d.ogg', group: 'common', optional: true, art: true, gainDb: 0.6 },
  { key: 'sfx-step-sand-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-sand-a.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-step-sand-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-sand-b.ogg', group: 'common', optional: true, art: true, gainDb: 0.8 },
  { key: 'sfx-step-sand-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-sand-c.ogg', group: 'common', optional: true, art: true, gainDb: 0.5 },
  { key: 'sfx-step-sand-d', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-sand-d.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-step-stone-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-stone-a.ogg', group: 'common', optional: true, art: true, gainDb: 4.9 },
  { key: 'sfx-step-stone-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-stone-b.ogg', group: 'common', optional: true, art: true, gainDb: 3.7 },
  { key: 'sfx-step-stone-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-stone-c.ogg', group: 'common', optional: true, art: true, gainDb: 5.6 },
  { key: 'sfx-step-stone-d', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-stone-d.ogg', group: 'common', optional: true, art: true, gainDb: 3.7 },
  { key: 'sfx-step-wet-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wet-a.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-step-wet-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wet-b.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-step-wet-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wet-c.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-step-wet-d', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wet-d.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-step-wood-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wood-a.ogg', group: 'common', optional: true, art: true, gainDb: 5.3 },
  { key: 'sfx-step-wood-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wood-b.ogg', group: 'common', optional: true, art: true, gainDb: 4.1 },
  { key: 'sfx-step-wood-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wood-c.ogg', group: 'common', optional: true, art: true, gainDb: 5.1 },
  { key: 'sfx-step-wood-d', type: 'audio', url: 'assets/art/audio/sfx/sfx-step-wood-d.ogg', group: 'common', optional: true, art: true, gainDb: 2.0 },
  { key: 'sfx-tide-bell-clapper', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-bell-clapper.ogg', group: 'common', optional: true, art: true, gainDb: 1.7 },
  { key: 'sfx-tide-bell-ring', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-bell-ring.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-tide-fall', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-fall.ogg', group: 'common', optional: true, art: true },
  { key: 'sfx-tide-rise', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-rise.ogg', group: 'common', optional: true, art: true },
  // s1：近岸浪、细雨、码头吱呀、潮汐钟风吹轻响、木筏
  { key: 'amb-pier-creak-a', type: 'audio', url: 'assets/art/audio/ambience/amb-pier-creak-a.ogg', group: 's1', optional: true, art: true },
  { key: 'amb-pier-creak-b', type: 'audio', url: 'assets/art/audio/ambience/amb-pier-creak-b.ogg', group: 's1', optional: true, art: true },
  { key: 'amb-pier-creak-c', type: 'audio', url: 'assets/art/audio/ambience/amb-pier-creak-c.ogg', group: 's1', optional: true, art: true },
  { key: 'amb-rain-light', type: 'audio', url: 'assets/art/audio/ambience/amb-rain-light.ogg', group: 'common', optional: true, art: true },
  { key: 'amb-waves-near', type: 'audio', url: 'assets/art/audio/ambience/amb-waves-near.ogg', group: 's1', optional: true, art: true },
  { key: 'sfx-raft-float', type: 'audio', url: 'assets/art/audio/sfx/sfx-raft-float.ogg', group: 's1', optional: true, art: true },
  { key: 'sfx-raft-lock', type: 'audio', url: 'assets/art/audio/sfx/sfx-raft-lock.ogg', group: 's1', optional: true, art: true, gainDb: 2.4 },
  { key: 'sfx-raft-push-loop', type: 'audio', url: 'assets/art/audio/sfx/sfx-raft-push-loop.ogg', group: 's1', optional: true, art: true },
  { key: 'sfx-tide-bell-wind-a', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-bell-wind-a.ogg', group: 's1', optional: true, art: true },
  { key: 'sfx-tide-bell-wind-b', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-bell-wind-b.ogg', group: 's1', optional: true, art: true },
  { key: 'sfx-tide-bell-wind-c', type: 'audio', url: 'assets/art/audio/sfx/sfx-tide-bell-wind-c.ogg', group: 's1', optional: true, art: true },
  // s2：屋檐滴水 / 雨（室外）、屋顶雨 / 雨打窗 / 钟摆（室内）、远浪、光感锁、钥匙、铁门、风铃、地窖门、转盘、风灯
  { key: 'amb-eaves-drip', type: 'audio', url: 'assets/art/audio/ambience/amb-eaves-drip.ogg', group: 's2', optional: true, art: true },
  { key: 'amb-rain-on-glass', type: 'audio', url: 'assets/art/audio/ambience/amb-rain-on-glass.ogg', group: 's2', optional: true, art: true },
  { key: 'amb-rain-on-roof', type: 'audio', url: 'assets/art/audio/ambience/amb-rain-on-roof.ogg', group: 's2', optional: true, art: true },
  { key: 'amb-room-clock', type: 'audio', url: 'assets/art/audio/ambience/amb-room-clock.ogg', group: 's2', optional: true, art: true },
  { key: 'amb-waves-far', type: 'audio', url: 'assets/art/audio/ambience/amb-waves-far.ogg', group: 's2', optional: true, art: true },
  { key: 'sfx-cellar-door-open', type: 'audio', url: 'assets/art/audio/sfx/sfx-cellar-door-open.ogg', group: 's2', optional: true, art: true, gainDb: 1.9 },
  { key: 'sfx-dial-click', type: 'audio', url: 'assets/art/audio/sfx/sfx-dial-click.ogg', group: 's2', optional: true, art: true, gainDb: 5.7 },
  { key: 'sfx-gate-open', type: 'audio', url: 'assets/art/audio/sfx/sfx-gate-open.ogg', group: 's2', optional: true, art: true },
  { key: 'sfx-key-pickup', type: 'audio', url: 'assets/art/audio/sfx/sfx-key-pickup.ogg', group: 's2', optional: true, art: true, gainDb: 0.6 },
  { key: 'sfx-lantern-pickup', type: 'audio', url: 'assets/art/audio/sfx/sfx-lantern-pickup.ogg', group: 's2', optional: true, art: true },
  { key: 'sfx-lantern-place', type: 'audio', url: 'assets/art/audio/sfx/sfx-lantern-place.ogg', group: 's2', optional: true, art: true, gainDb: 3.8 },
  { key: 'sfx-light-lock-open', type: 'audio', url: 'assets/art/audio/sfx/sfx-light-lock-open.ogg', group: 's2', optional: true, art: true, gainDb: 2.3 },
  { key: 'sfx-wind-chime', type: 'audio', url: 'assets/art/audio/sfx/sfx-wind-chime.ogg', group: 's2', optional: true, art: true },
  // s3：拍岸浪、大雨、塔内风 / 塔底积水、塔门、油阀、油流、点火四件、透镜转动
  { key: 'amb-rain-heavy', type: 'audio', url: 'assets/art/audio/ambience/amb-rain-heavy.ogg', group: 's3', optional: true, art: true },
  { key: 'amb-water-in-tower', type: 'audio', url: 'assets/art/audio/ambience/amb-water-in-tower.ogg', group: 's3', optional: true, art: true },
  { key: 'amb-waves-crash', type: 'audio', url: 'assets/art/audio/ambience/amb-waves-crash.ogg', group: 's3', optional: true, art: true },
  { key: 'amb-wind-tower', type: 'audio', url: 'assets/art/audio/ambience/amb-wind-tower.ogg', group: 's3', optional: true, art: true },
  { key: 'sfx-door-lighthouse-unlock', type: 'audio', url: 'assets/art/audio/sfx/sfx-door-lighthouse-unlock.ogg', group: 's3', optional: true, art: true, gainDb: 3.0 },
  { key: 'sfx-ignite', type: 'audio', url: 'assets/art/audio/sfx/sfx-ignite.ogg', group: 's3', optional: true, art: true, gainDb: 2.8 },
  { key: 'sfx-ignite-fail', type: 'audio', url: 'assets/art/audio/sfx/sfx-ignite-fail.ogg', group: 's3', optional: true, art: true, gainDb: 3.4 },
  { key: 'sfx-ignite-lever', type: 'audio', url: 'assets/art/audio/sfx/sfx-ignite-lever.ogg', group: 's3', optional: true, art: true, gainDb: 2.4 },
  { key: 'sfx-ignite-ready-loop', type: 'audio', url: 'assets/art/audio/sfx/sfx-ignite-ready-loop.ogg', group: 's3', optional: true, art: true },
  { key: 'sfx-ignite-ready-pulse', type: 'audio', url: 'assets/art/audio/sfx/sfx-ignite-ready-pulse.ogg', group: 's3', optional: true, art: true },
  { key: 'sfx-lens-rotate-loop', type: 'audio', url: 'assets/art/audio/sfx/sfx-lens-rotate-loop.ogg', group: 's3', optional: true, art: true },
  { key: 'sfx-oil-flow', type: 'audio', url: 'assets/art/audio/sfx/sfx-oil-flow.ogg', group: 's3', optional: true, art: true },
  { key: 'sfx-valve-turn', type: 'audio', url: 'assets/art/audio/sfx/sfx-valve-turn.ogg', group: 's3', optional: true, art: true, gainDb: 0.9 },
  // ---- ch2-s1：第二章裂湾村鱼港组合道具（裂湾村正式场景组）
  { key: 'prop-harbour-kit-ch2-s1', type: 'gltf', url: 'assets/art/models/props/prop-harbour-kit-ch2-s1.glb', group: 'ch2-s1', optional: true, art: true },
  // ---- 更多示例（取消注释即可登记）----
  // { key: 'ground-diffuse', type: 'ktx2', url: 'assets/textures/ground-diffuse.ktx2', group: 's1', optional: true },
];

export function entriesForGroup(group: string): AssetEntry[] {
  return manifest.filter((e) => e.group === group);
}
