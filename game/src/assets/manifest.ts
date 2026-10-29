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
 */
export type AssetType = 'gltf' | 'texture' | 'ktx2' | 'audio' | 'font';

/** 加载分组（顺序 = 一般加载顺序） */
export const ASSET_GROUPS = ['boot', 'menu', 'common', 's1', 's2', 's3'] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];
/** 场景组：离开场景后可以释放 */
export const LEVEL_GROUPS: readonly AssetGroup[] = ['s1', 's2', 's3'];

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
   * 仅 gltf：COLOR_0 的含义。默认跟随 gameConfig.assets.vertexColorsAreOutlineNormals（美术约定 = 描边平滑法线，
   * 加载后关掉材质 vertexColors）；'color' = 这个资源的 COLOR_0 是真顶点色，保留 vertexColors。
   */
  vertexColors?: 'outline' | 'color';
  /** 仅 font：CSS font-family 名（styles.css 的 --ui-font / --ui-serif 排在最前） */
  family?: string;
}

export const manifest: AssetEntry[] = [
  // ---- menu：字体子集（思源黑体 / 思源宋体 = Noto Sans / Serif CJK SC，SIL OFL 1.1；npm run fonts 生成）
  { key: 'font-sans', type: 'font', url: 'assets/fonts/foglight-sans.woff2', group: 'menu', family: 'Foglight Sans' },
  { key: 'font-serif', type: 'font', url: 'assets/fonts/foglight-serif.woff2', group: 'menu', family: 'Foglight Serif' },
  // ---- common：主角模型（美术 016 交付前文件不存在，自动回退为胶囊占位，演示缺失回退流程）
  { key: 'hero', type: 'gltf', url: 'assets/models/hero.glb', group: 'common', optional: true },
  // ---- s1：LOD / 解谜关键物体测试用例（scripts/gen-lod-test-asset.mjs 生成）：白石（puzzleCritical，固定 LOD0）+ 普通对照石
  { key: 'test-lod-puzzle', type: 'gltf', url: 'assets/models/test-lod-puzzle-critical.glb', group: 's1', optional: true },
  // ---- s2 / s3：白盒阶段（014 / 015）没有专属资源，美术 019 / 020 交付后登记在这里
  // ---- 更多示例（取消注释即可登记）----
  // { key: 'ground-diffuse', type: 'ktx2', url: 'assets/textures/ground-diffuse.ktx2', group: 's1', optional: true },
  // { key: 'sfx-footstep', type: 'audio', url: 'assets/audio/sfx-footstep.ogg', group: 'common', optional: true },
];

export function entriesForGroup(group: string): AssetEntry[] {
  return manifest.filter((e) => e.group === group);
}
