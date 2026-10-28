import * as THREE from 'three';

/**
 * 显存粗估（F3 性能面板用，对照 style-guide §8 预算；不是精确值）：
 * - 几何：场景里所有 BufferGeometry 的顶点属性 + 索引字节数（去重）
 * - 贴图：材质上引用的贴图，未压缩按 RGBA8，压缩贴图按 mip 数据实际字节；带 mipmap 的 ×4/3（去重）
 * - 渲染目标：画布 + 后处理缓冲（半浮点 RGBA × 2 + 深度）+ 阴影贴图
 */
export interface VramEstimate {
  geometryMB: number;
  textureMB: number;
  targetMB: number;
  totalMB: number;
}

const MB = 1024 * 1024;

function textureBytes(t: THREE.Texture): number {
  const ct = t as THREE.CompressedTexture;
  if (ct.isCompressedTexture && Array.isArray(ct.mipmaps) && ct.mipmaps.length) {
    let sum = 0;
    for (const m of ct.mipmaps as Array<{ data?: ArrayBufferView }>) sum += m.data?.byteLength ?? 0;
    return sum;
  }
  const img = t.image as { width?: number; height?: number; depth?: number } | null | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  const d = img?.depth ?? 1;
  const bpp = t.type === THREE.FloatType ? 16 : t.type === THREE.HalfFloatType ? 8 : 4;
  const base = w * h * d * bpp;
  return t.generateMipmaps || t.mipmaps?.length ? (base * 4) / 3 : base;
}

export function estimateVram(renderer: THREE.WebGLRenderer, scene: THREE.Object3D | null): VramEstimate {
  const geos = new Set<THREE.BufferGeometry>();
  const texs = new Set<THREE.Texture>();
  let shadowBytes = 0;
  scene?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry?.isBufferGeometry) geos.add(m.geometry);
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        if (v && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture);
      }
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) if ((u?.value as THREE.Texture)?.isTexture) texs.add(u.value as THREE.Texture);
    }
    const light = o as THREE.DirectionalLight;
    if (light.isLight && light.castShadow && light.shadow) shadowBytes += light.shadow.mapSize.x * light.shadow.mapSize.y * 4;
  });
  if (scene instanceof THREE.Scene) {
    for (const t of [scene.background, scene.environment]) if ((t as THREE.Texture | null)?.isTexture) texs.add(t as THREE.Texture);
  }

  let geometryBytes = 0;
  for (const g of geos) {
    for (const a of Object.values(g.attributes)) {
      const arr = (a as THREE.BufferAttribute).array as ArrayBufferView | undefined;
      geometryBytes += arr?.byteLength ?? 0;
    }
    geometryBytes += (g.index?.array as ArrayBufferView | undefined)?.byteLength ?? 0;
  }
  let textureBytesSum = 0;
  for (const t of texs) textureBytesSum += textureBytes(t);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const px = size.x * size.y;
  // 画布（颜色 + 深度）+ 后处理（半浮点 RGBA 读写两张 + 深度）
  const targetBytes = px * (4 + 4) + px * (8 * 2 + 4) + shadowBytes;

  const r = (b: number): number => Math.round((b / MB) * 10) / 10;
  return {
    geometryMB: r(geometryBytes),
    textureMB: r(textureBytesSum),
    targetMB: r(targetBytes),
    totalMB: r(geometryBytes + textureBytesSum + targetBytes),
  };
}
