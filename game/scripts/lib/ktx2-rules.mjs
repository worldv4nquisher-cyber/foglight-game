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
/** @param {{ name: string, width: number, height: number, ramp: boolean }} f @returns {string | null} */
export function ktx2AlignmentVerdict(f) {
  if (isBlockAligned(f.width, f.height)) return null;
  const dims = `${f.width}×${f.height}`;
  if (!f.ramp) return `${f.name} ${dims}：KTX2 宽高须为 4 的倍数（桌面 BC7 / BC3 上传会 0x502、采样为黑）；查找表请在 manifest 标 ramp: true`;
  if (f.width * f.height > KTX2_UNALIGNED_MAX_TEXELS)
    return `${f.name} ${dims}：非 4 倍数的 ramp 运行时转未压缩 RGBA，限 ≤ ${KTX2_UNALIGNED_MAX_TEXELS} texel`;
  return null;
}
