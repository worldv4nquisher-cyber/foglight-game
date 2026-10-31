import type * as THREE from 'three';

/**
 * v0.1-037 按画质档在加载后、上传 GPU 前跳过 KTX2 的高级 mip（不改美术资源、包体不变）：
 * - 上限口径与 verify-budget 一致：贴图的使用者里有 char- / prop- 节点（自身或祖先）→ preset.textureMaxSize，否则 → textureMaxSizeEnv；
 *   极致档 4096 / 2048 = 原始尺寸，不跳；高档 ≤ 2048；标准档角色 ≤ 2048、环境 ≤ 1024。
 * - 只动带完整 mip 链的压缩贴图（KTX2）：mipmaps 去掉前 k 级，image 尺寸跟着改；UV 是归一化的，采样 / 光照贴图（channel 1）不受影响。
 * - 原始 mip 链记在模块内 WeakMap（同一批 ArrayBuffer，不额外占内存；不放 userData，免得 clone / toJSON 序列化整条链），换档时从完整链重新截：
 *   画质切换即时生效 —— 改了上限的贴图释放旧 GL 纹理、needsUpdate，下一帧按新尺寸重新上传（不重新下载）。
 */
interface MipLevel {
  data: ArrayBufferView;
  width: number;
  height: number;
}

interface CappableTexture {
  isCompressedTexture?: boolean;
  mipmaps: MipLevel[];
  image: { width: number; height: number };
  userData: Record<string, unknown>;
  needsUpdate: boolean;
  dispose(): void;
}

/** 贴图 → 加载时的完整 mip 链 */
const fullMips = new WeakMap<object, MipLevel[]>();

export interface MipCapLimits {
  textureMaxSize: number;
  textureMaxSizeEnv: number;
}

/** 截掉超过 maxSize 的前几级 mip；返回是否改动（改动时已释放旧 GL 纹理并 needsUpdate） */
export function capTextureMips(tex: THREE.Texture, maxSize: number): boolean {
  const t = tex as unknown as CappableTexture;
  if (!t.isCompressedTexture || !Array.isArray(t.mipmaps) || t.mipmaps.length < 2) return false;
  const full: MipLevel[] = fullMips.get(t) ?? t.mipmaps;
  let k = 0;
  while (k < full.length - 1 && Math.max(full[k]!.width, full[k]!.height) > maxSize) k++;
  const top = full[k]!;
  if (t.mipmaps[0] === top) return false;
  fullMips.set(t, full);
  t.mipmaps = k ? full.slice(k) : full;
  t.image = { ...t.image, width: top.width, height: top.height };
  t.userData.mipSkip = k;
  // 已上传过的贴图（换档 / 跨场景共享）尺寸变了：three 按 texStorage 分配的存储不会重分配，先 dispose 释放旧 GL 纹理，下次使用时按新尺寸重新分配上传
  t.dispose();
  t.needsUpdate = true;
  return true;
}

/** 按场景里的使用者分类给每张贴图定上限并截 mip；返回改动的贴图数 */
export function applyTextureMipCaps(root: THREE.Object3D, limits: MipCapLimits): number {
  const cats = new Map<THREE.Texture, boolean>(); // 贴图 → 是否有 char/prop 使用者
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material;
    if (!mat) return;
    let charProp = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent)
      if (/^(char|prop)-/i.test(p.name)) {
        charProp = true;
        break;
      }
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!m) continue;
      for (const v of Object.values(m)) {
        const t = v as THREE.Texture | null;
        if (!t || !t.isTexture || (t as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) continue;
        if (!(t as unknown as CappableTexture).isCompressedTexture) continue;
        cats.set(t, (cats.get(t) ?? false) || charProp);
      }
    }
  });
  let n = 0;
  for (const [t, charProp] of cats) if (capTextureMips(t, charProp ? limits.textureMaxSize : limits.textureMaxSizeEnv)) n++;
  return n;
}
