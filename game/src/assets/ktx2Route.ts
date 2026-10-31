import * as THREE from 'three';

/**
 * BUG-030：KTX2 宽 / 高不是 4 的倍数时不能用块压缩格式上传。
 *
 * KTX2Loader 在桌面（Windows / Intel Mac / Linux）把 UASTC / ETC1S 转成 BC7（或 BC3 / BC1），而 WebGL 的
 * EXT_texture_compression_bptc / WEBGL_compressed_texture_s3tc 规定「width << level、height << level 必须是 4 的倍数」，
 * 否则 texStorage2D / compressedTexSubImage2D 全部 INVALID_OPERATION（0x502）→ 纹理不完整 → 采样恒为 (0,0,0,1)。
 * 256×1 的 ramp 就是这样：汐身体 / 头发的 ramp 明暗一直是 0（整个人在暗部色里）。ASTC / ETC2 设备不受影响。
 *
 * 规则（通用，不只 ramp）：读 KTX2 文件头，宽或高不是 4 的倍数 → 交给「只转未压缩 RGBA32」的第二个 KTX2Loader；
 * 其余照旧走设备最优的压缩格式。未压缩的显存 = 宽 × 高 × 4 B（每级），所以资源校验（verify-assets）只放过
 * 清单里标了 `ramp: true` 且 ≤ KTX2_UNALIGNED_MAX_TEXELS 的文件，其他 KTX2 必须 4 的倍数。
 */

export const KTX2_BLOCK = 4;
/** 允许走运行时未压缩的上限（texel）：256×16 = 16 KB RGBA；ramp 256×1 远低于此 */
export const KTX2_UNALIGNED_MAX_TEXELS = 4096;

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** KTX2 文件头里的 pixelWidth / pixelHeight（偏移 20 / 24，小端）；不是 KTX2 返回 null */
export function readKtx2Size(buf: ArrayBuffer | Uint8Array): { width: number; height: number } | null {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 28) return null;
  for (let i = 0; i < KTX2_ID.length; i++) if (u8[i] !== KTX2_ID[i]) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { width: dv.getUint32(20, true), height: Math.max(1, dv.getUint32(24, true)) };
}

/** 块压缩（BC / ETC / ASTC 4×4）要求的对齐：宽高都是 4 的倍数才可以压缩上传 */
export function isBlockAligned(width: number, height: number): boolean {
  return width % KTX2_BLOCK === 0 && height % KTX2_BLOCK === 0;
}

/** KTX2Loader 里我们用到的部分（单元测试可以塞假的） */
export interface Ktx2Parser {
  parse(buffer: ArrayBuffer, onLoad: (t: THREE.Texture) => void, onError?: (e: unknown) => void): unknown;
}

export interface Ktx2RouterDeps {
  /** 设备最优（压缩）路径 */
  compressed: Ktx2Parser;
  /** 只解未压缩 RGBA32 的路径（第一次用到才建） */
  uncompressed: () => Ktx2Parser;
  /** 取文件（ArrayBuffer） */
  fetch: (url: string, onProgress?: (e: ProgressEvent) => void) => Promise<ArrayBuffer>;
  /** false = 全走压缩路径（?rampfix=0，模拟修前） */
  enabled: boolean;
}

export interface Ktx2Router {
  loadAsync(url: string, onProgress?: (e: ProgressEvent) => void): Promise<THREE.Texture>;
  /** 走了未压缩路径的 URL（冒烟 / 报告读） */
  readonly uncompressedUrls: ReadonlySet<string>;
}

export function createKtx2Router(deps: Ktx2RouterDeps): Ktx2Router {
  const uncompressedUrls = new Set<string>();
  let raw: Ktx2Parser | null = null;
  const parse = (p: Ktx2Parser, buf: ArrayBuffer): Promise<THREE.Texture> =>
    new Promise((resolve, reject) => {
      p.parse(buf, resolve, reject);
    });
  return {
    uncompressedUrls,
    async loadAsync(url, onProgress) {
      const buf = await deps.fetch(url, onProgress);
      const size = readKtx2Size(buf);
      if (deps.enabled && size && !isBlockAligned(size.width, size.height)) {
        raw ??= deps.uncompressed();
        const tex = await parse(raw, buf);
        tex.userData.ktx2Uncompressed = true;
        uncompressedUrls.add(url);
        return tex;
      }
      return parse(deps.compressed, buf);
    },
  };
}

/** KTX2Loader 的 workerConfig：全部压缩格式关掉 → Basis 转码回落到 RGBA32（UASTC / ETC1S 都是） */
export interface Ktx2WorkerConfig {
  [k: string]: boolean | undefined;
}
export function disableCompressedTargets(cfg: Ktx2WorkerConfig): Ktx2WorkerConfig {
  for (const k of Object.keys(cfg)) if (k.endsWith('Supported')) cfg[k] = false;
  return cfg;
}

/**
 * 1D 查找表（ramp）：只留第 0 级、线性过滤、不生成 mip。
 * 有 mip 时 LinearMipmapLinear 在轮廓处（N·L 导数大）会取到 128 / 64 … 宽的小级，明暗分界被抹软。
 */
export function stripToBaseLevel(tex: THREE.Texture): THREE.Texture {
  const t = tex as unknown as { mipmaps?: unknown[] };
  if (Array.isArray(t.mipmaps) && t.mipmaps.length > 1) t.mipmaps = t.mipmaps.slice(0, 1);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
