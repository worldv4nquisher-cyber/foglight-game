/**
 * 资源清单。所有运行时资源都在这里登记，场景按 group 批量加载。
 *
 * 约定：
 * - 文件放 public/assets/<类型>/，文件名小写英文 + 短横线，如 hero-idle.glb、ui-button-start.png
 * - url 写相对 public 的路径（不要以 / 开头，保证 base='./' 打包后可用）
 * - optional: true 表示缺失时不报错，使用占位几何体/纹理/静音兜底（美术资源未到位时先跑通）
 * - 模型优先 .glb（可 Draco / Meshopt 压缩，贴图可用 KTX2）；独立贴图优先 .ktx2，其次 .webp
 */
export type AssetType = 'gltf' | 'texture' | 'ktx2' | 'audio';

export interface AssetEntry {
  /** 代码里引用的唯一 key */
  key: string;
  type: AssetType;
  url: string;
  /** 加载分组：boot（启动必需）/ main（主场景）… */
  group: string;
  optional?: boolean;
  /** 纹理是否为颜色贴图（决定 sRGB 色彩空间），默认 true */
  srgb?: boolean;
}

export const manifest: AssetEntry[] = [
  // 主角模型：美术交付前文件不存在，自动回退为胶囊占位（演示缺失回退流程）
  { key: 'hero', type: 'gltf', url: 'assets/models/hero.glb', group: 'main', optional: true },
  // LOD / 解谜关键物体测试用例（scripts/gen-lod-test-asset.mjs 生成）：白石（puzzleCritical，固定 LOD0）+ 普通对照石
  { key: 'test-lod-puzzle', type: 'gltf', url: 'assets/models/test-lod-puzzle-critical.glb', group: 'main', optional: true },
  // ---- 更多示例（取消注释即可登记）----
  // { key: 'ground-diffuse', type: 'ktx2', url: 'assets/textures/ground-diffuse.ktx2', group: 'main', optional: true },
  // { key: 'sfx-jump', type: 'audio', url: 'assets/audio/sfx-jump.ogg', group: 'main', optional: true },
];

export function entriesForGroup(group: string): AssetEntry[] {
  return manifest.filter((e) => e.group === group);
}
