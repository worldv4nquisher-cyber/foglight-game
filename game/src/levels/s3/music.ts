import { S3 } from './layout';

/**
 * 1031 S3 两层场景曲：上层（紧张层 mus-s3-lighthouse-upper）增益 = 玩家高度的函数。
 * README 只写「036 按玩家高度把增益 0 → 1 线性淡入」，没给高度范围 → 取楼梯底到灯室：
 *   塔内底层地面 / 楼梯起点 y = S3.groundFloorY（0.2）→ 0，灯室地板 y = S3.lampRoom.floorY（22）→ 1，中间线性，两端夹住。
 * 只在塔身范围内（离塔心水平距离 ≤ S3_UPPER_RADIUS）算：塔外的桥 / 礁石高到 3 m，不该让紧张层冒头。
 * 输入是 S3 局部坐标（layout.toLocal）。
 */
export const S3_MUSIC_BASE = 'mus-s3-lighthouse';
export const S3_MUSIC_UPPER = 'mus-s3-lighthouse-upper';
export const S3_UPPER_Y0 = S3.groundFloorY;
export const S3_UPPER_Y1 = S3.lampRoom.floorY;
/** 塔基半径 4 m + 0.5 m 余量（灯室回廊在 rTop 3.5 以内） */
export const S3_UPPER_RADIUS = S3.tower.rBase + 0.5;

export function s3UpperLayerGain(local: { x: number; y: number; z: number }): number {
  if (Math.hypot(local.x, local.z) > S3_UPPER_RADIUS) return 0;
  const t = (local.y - S3_UPPER_Y0) / (S3_UPPER_Y1 - S3_UPPER_Y0);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}
