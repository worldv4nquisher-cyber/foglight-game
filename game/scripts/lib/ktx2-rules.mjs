// BUG-030 资源校验规则（check-size 查 dist、verify-assets 查 ../art 共用；放 scripts 里：报错文字不进游戏、不进字体子集）
import { isBlockAligned, KTX2_UNALIGNED_MAX_TEXELS } from '../../src/assets/ktx2Route.ts';
export { readKtx2Size, KTX2_UNALIGNED_MAX_TEXELS } from '../../src/assets/ktx2Route.ts';

/**
 * 资源校验规则（verify-assets 用，BUG-030）：
 * - 宽高都是 4 的倍数 → 通过（走设备压缩格式）；
 * - 否则必须是清单里 `ramp: true` 的 1D 查找表，且 宽 × 高 ≤ KTX2_UNALIGNED_MAX_TEXELS（运行时转未压缩 RGBA）；
 * - 其他一律失败：要么美术按 4 的倍数重出，要么确认是查找表后在清单标 ramp。
 * 返回 null = 通过，字符串 = 失败原因。
 */
/**
 * batch25-5：name 传完整路径（含目录），同名文件好找；twin = 清单里同文件名的 ramp 路径（这个文件在别的目录、所以不豁免时给出，见 rampMatcher().twin）
 * @param {{ name: string, width: number, height: number, ramp: boolean, twin?: string | null }} f @returns {string | null}
 */
export function ktx2AlignmentVerdict(f) {
  if (isBlockAligned(f.width, f.height)) return null;
  const dims = `${f.width}×${f.height}`;
  if (!f.ramp && f.twin)
    return `${f.name} ${dims}：与清单 ramp「${f.twin}」同名但不在同一目录，不豁免（豁免按完整路径匹配）；KTX2 宽高须为 4 的倍数——放错目录就挪回去，真是另一张查找表就在 manifest 按这个路径登记 ramp: true`;
  if (!f.ramp) return `${f.name} ${dims}：KTX2 宽高须为 4 的倍数（桌面 BC7 / BC3 上传会 0x502、采样为黑）；查找表请在 manifest 标 ramp: true`;
  if (f.width * f.height > KTX2_UNALIGNED_MAX_TEXELS)
    return `${f.name} ${dims}：非 4 倍数的 ramp 运行时转未压缩 RGBA，限 ≤ ${KTX2_UNALIGNED_MAX_TEXELS} texel`;
  return null;
}

const ART_URL_PREFIX = 'assets/art/';
/** 资源路径统一成「相对 art 根」的 posix 路径：清单 url `assets/art/textures/x.ktx2`、dist 相对路径同形、../art 相对路径 `textures/x.ktx2` 都 → `textures/x.ktx2` */
export function artRelPath(p) {
  const s = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  return s.startsWith(ART_URL_PREFIX) ? s.slice(ART_URL_PREFIX.length) : s;
}

/**
 * 豁免（ramp: true）按清单的完整路径匹配（M7：原来按文件名，别的目录里同名文件也会被放过）。
 * @param {Array<{ url: string, ramp?: boolean }>} manifest
 * @returns {((path: string) => boolean) & { twin: (path: string) => string | null }} path = dist 相对路径（assets/art/…）或 ../art 相对路径；
 *   `.twin(path)`：path 不是清单 ramp、但文件名和某个清单 ramp 相同时返回那个 ramp 的路径（相对 art 根），否则 null（batch25-5 报错用）
 */
export function rampMatcher(manifest) {
  const set = new Set(manifest.filter((e) => e.ramp).map((e) => artRelPath(e.url)));
  const byName = new Map([...set].map((p) => [p.split('/').pop(), p]));
  const m = (path) => set.has(artRelPath(path));
  m.twin = (path) => {
    const rel = artRelPath(path);
    if (set.has(rel)) return null;
    return byName.get(rel.split('/').pop()) ?? null;
  };
  return m;
}
