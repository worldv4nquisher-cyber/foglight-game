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
  /** 仅 font：CSS font-family 名（styles.css 的 --ui-font / --ui-serif 排在最前） */
  family?: string;
}

export const manifest: AssetEntry[] = [
  // ---- menu：字体子集（思源黑体 / 思源宋体 = Noto Sans / Serif CJK SC，SIL OFL 1.1；npm run fonts 生成）
  { key: 'font-sans', type: 'font', url: 'assets/fonts/foglight-sans.woff2', group: 'menu', family: 'Foglight Sans' },
  { key: 'font-serif', type: 'font', url: 'assets/fonts/foglight-serif.woff2', group: 'menu', family: 'Foglight Serif' },
  // ---- common：主角模型（美术 016 交付前文件不存在，自动回退为胶囊占位，演示缺失回退流程）
  // v0.1-017 汐定稿：模型（73 骨，LOD 118k / 48.5k / 24.3k，外部贴图 tex-xi-*.ktx2）+ 31 个动画 clip（只有骨骼，1.44 MB，各场景都用 → common）
  { key: 'char-xi', type: 'gltf', url: 'assets/art/models/characters/char-xi.glb', group: 'common', optional: true, art: true },
  { key: 'char-xi-anims', type: 'gltf', url: 'assets/art/models/characters/char-xi-anims.glb', group: 'common', optional: true, art: true },
  // GLB 没引用、材质 extras 点名的两张：色阶 ramp、SDF 脸部阴影（art/tools/README §5）
  { key: 'tex-xi-ramp', type: 'ktx2', url: 'assets/art/textures/tex-xi-ramp.ktx2', group: 'common', optional: true, art: true },
  { key: 'tex-xi-sdf-face', type: 'ktx2', url: 'assets/art/textures/tex-xi-sdf-face.ktx2', group: 'common', optional: true, art: true },
  // ---- s1：LOD / 解谜关键物体测试用例（scripts/gen-lod-test-asset.mjs 生成）：白石（puzzleCritical，固定 LOD0）+ 普通对照石
  { key: 'test-lod-puzzle', type: 'gltf', url: 'assets/models/test-lod-puzzle-critical.glb', group: 's1', optional: true },
  // ---- s1：美术 018 / 020 交付（../art，外部 KTX2 在 ../art/textures；v0.1-013 接入，摆放以 src/levels/s1/layout.ts 为准）
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
  { key: 'env-fish-shed-ruin', type: 'gltf', url: 'assets/art/models/env/env-fish-shed-ruin.glb', group: 's1', optional: true, art: true },
  { key: 'env-net-rack-a', type: 'gltf', url: 'assets/art/models/env/env-net-rack-a.glb', group: 's1', optional: true, art: true },
  { key: 'env-net-rack-b', type: 'gltf', url: 'assets/art/models/env/env-net-rack-b.glb', group: 's1', optional: true, art: true },
  // 021 潮汐钟（10-30 交付；S1 / S3 同一文件，S3 另登记 prop-tide-bell-s3）：挂 bell-anchor，bell-swing 跟白盒钟摆（src/levels/s1/artSlots.ts）
  { key: 'prop-tide-bell', type: 'gltf', url: 'assets/art/models/props/prop-tide-bell.glb', group: 's1', optional: true, art: true },
  // 021 解谜道具（未交付，pending：文件到了自动加载，挂点 / 节点见 src/levels/s1/artSlots.ts）
  { key: 'prop-raft-s1', type: 'gltf', url: 'assets/art/models/props/prop-raft-s1.glb', group: 's1', optional: true, art: true, pending: true },
  { key: 'env-lighthouse-silhouette-far', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-silhouette-far.glb', group: 's1', optional: true, art: true },
  { key: 'env-lighthouse-island-main-s3tower', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-island-main-s3tower.glb', group: 's1', optional: true, art: true },
  { key: 'env-lighthouse-ch1', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1.glb', group: 's1', optional: true, art: true },
  { key: 'prop-boat-rowboat', type: 'gltf', url: 'assets/art/models/props/prop-boat-rowboat.glb', group: 's1', optional: true, art: true },
  { key: 'prop-boat-rowboat-sunken', type: 'gltf', url: 'assets/art/models/props/prop-boat-rowboat-sunken.glb', group: 's1', optional: true, art: true },
  // ---- s2：美术 019 交付（v0.1-014 接入，摆放以 src/levels/s2/layout.ts 为准）
  { key: 'env-clifftop-s2', type: 'gltf', url: 'assets/art/models/env/env-clifftop-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-keeper-house-ch1', type: 'gltf', url: 'assets/art/models/env/env-keeper-house-ch1.glb', group: 's2', optional: true, art: true },
  { key: 'env-keeper-house-ch1-interior', type: 'gltf', url: 'assets/art/models/env/env-keeper-house-ch1-interior.glb', group: 's2', optional: true, art: true },
  { key: 'env-cellar-s2', type: 'gltf', url: 'assets/art/models/env/env-cellar-s2.glb', group: 's2', optional: true, art: true },
  // 021 黄铜风灯（S2 进场就在汐手上；以后 S3 灯室书桌 / S1 开场要用时在该组另登记一个 key，同 s2far 的做法）
  { key: 'prop-lantern-brass', type: 'gltf', url: 'assets/art/models/props/prop-lantern-brass.glb', group: 's2', optional: true, art: true },
  // 021 院子灯台（东 / 西两份同一 GLB，摆在院墙 lamp-east/west-socket）
  { key: 'prop-lantern-stand-s2', type: 'gltf', url: 'assets/art/models/props/prop-lantern-stand-s2.glb', group: 's2', optional: true, art: true },
  // 021 解谜道具（未交付，pending；挂点 / 节点见 src/levels/s2/artSlots.ts）
  { key: 'prop-mirror-stand-s2', type: 'gltf', url: 'assets/art/models/props/prop-mirror-stand-s2.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-light-lock-s2', type: 'gltf', url: 'assets/art/models/props/prop-light-lock-s2.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-white-stones-s2', type: 'gltf', url: 'assets/art/models/props/prop-white-stones-s2.glb', group: 's2', optional: true, art: true, pending: true },
  { key: 'prop-dial-gate-s2', type: 'gltf', url: 'assets/art/models/props/prop-dial-gate-s2.glb', group: 's2', optional: true, art: true, pending: true },
  // 017 收尾：地窖钥匙（架上放 env-cellar-s2-key-socket；xi-pickup-shelf grab 帧挂 middle_03_r，extras.attach）
  { key: 'prop-key-cellar-s2', type: 'gltf', url: 'assets/art/models/props/prop-key-cellar-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-cellar-door-s2', type: 'gltf', url: 'assets/art/models/env/env-cellar-door-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-courtyard-wall-s2', type: 'gltf', url: 'assets/art/models/env/env-courtyard-wall-s2.glb', group: 's2', optional: true, art: true },
  { key: 'env-laundry-rack', type: 'gltf', url: 'assets/art/models/env/env-laundry-rack.glb', group: 's2', optional: true, art: true },
  // S2 远景 S3 岛 + 灯塔（与 s1 同一文件，s2 组另登记一份：S1→S2 释放 s1 组后仍可用）
  { key: 'env-lighthouse-island-main-s3tower-s2far', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-island-main-s3tower.glb', group: 's2', optional: true, art: true },
  { key: 'env-lighthouse-ch1-s2far', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1.glb', group: 's2', optional: true, art: true },
  // ---- s3（015）：美术 020 rework-1029，摆位见 levels/s3/art.ts（塔本体另登记 -s3 key，与 s1 组的远景分开释放）
  { key: 'env-lighthouse-ch1-s3', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1.glb', group: 's3', optional: true, art: true },
  { key: 'env-lighthouse-ch1-interior', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1-interior.glb', group: 's3', optional: true, art: true },
  { key: 'env-lighthouse-ch1-door', type: 'gltf', url: 'assets/art/models/env/env-lighthouse-ch1-door.glb', group: 's3', optional: true, art: true },
  { key: 'env-lamp-room-ch1', type: 'gltf', url: 'assets/art/models/env/env-lamp-room-ch1.glb', group: 's3', optional: true, art: true },
  { key: 'prop-fresnel-lens-ch1', type: 'gltf', url: 'assets/art/models/props/prop-fresnel-lens-ch1.glb', group: 's3', optional: true, art: true },
  { key: 'env-rock-islet-a', type: 'gltf', url: 'assets/art/models/env/env-rock-islet-a.glb', group: 's3', optional: true, art: true },
  { key: 'env-stone-bridge-s3', type: 'gltf', url: 'assets/art/models/env/env-stone-bridge-s3.glb', group: 's3', optional: true, art: true },
  // 022 解谜道具（未交付的标 pending；挂点 / 节点见 src/levels/s3/artSlots.ts）。潮汐钟（已交付）与 S1 同一文件，s3 组另登记一个 key（同 s2far 做法）
  { key: 'prop-tide-bell-s3', type: 'gltf', url: 'assets/art/models/props/prop-tide-bell.glb', group: 's3', optional: true, art: true },
  { key: 'prop-oil-valve-s3', type: 'gltf', url: 'assets/art/models/props/prop-oil-valve-s3.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'prop-guide-mirror-window-s3', type: 'gltf', url: 'assets/art/models/props/prop-guide-mirror-window-s3.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'prop-guide-mirror-wall-s3', type: 'gltf', url: 'assets/art/models/props/prop-guide-mirror-wall-s3.glb', group: 's3', optional: true, art: true, pending: true },
  { key: 'prop-ignition-port-s3', type: 'gltf', url: 'assets/art/models/props/prop-ignition-port-s3.glb', group: 's3', optional: true, art: true, pending: true },
  // ---- 更多示例（取消注释即可登记）----
  // { key: 'ground-diffuse', type: 'ktx2', url: 'assets/textures/ground-diffuse.ktx2', group: 's1', optional: true },
  // { key: 'sfx-footstep', type: 'audio', url: 'assets/audio/sfx-footstep.ogg', group: 'common', optional: true },
];

export function entriesForGroup(group: string): AssetEntry[] {
  return manifest.filter((e) => e.group === group);
}
