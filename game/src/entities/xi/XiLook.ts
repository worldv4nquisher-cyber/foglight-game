import { Component } from '@/entities/Component';
import type { XiLook } from '@/render/xiMaterials';

/** 淋湿 / 晾干速度（每秒 wetness 变化量）：雨里约 40 s 湿透，避雨约 150 s 干透 */
export const XI_WET_RATE = 1 / 40;
export const XI_DRY_RATE = 1 / 150;

/** wetness 朝目标走一步（纯函数，verify-xi 测） */
export function stepWetness(w: number, target: number, dt: number): number {
  if (w < target) return Math.min(target, w + XI_WET_RATE * dt);
  return Math.max(target, w - XI_DRY_RATE * dt);
}

/** 室内判定点：脚底上 0.5 m（与相机室内触发体同一个点，站在地窖 / 塔底地面上不会落在盒子下沿外） */
export const XI_INDOOR_PROBE_Y = 0.5;

/** 点在任一室内体积（-indoor 触发体的世界 AABB）里 */
export function isIndoor(pos: { x: number; y: number; z: number }, volumes: readonly { containsPoint(p: { x: number; y: number; z: number }): boolean }[]): boolean {
  const p = { x: pos.x, y: pos.y + XI_INDOOR_PROBE_Y, z: pos.z };
  return volumes.some((v) => v.containsPoint(p));
}

/** 淋湿目标：有雨且不在室内 = 1；室内（S2 小屋 / 地窖、S3 塔内）或无雨 = 0（照常慢慢变干） */
export function xiWetTarget(raining: boolean, pos: { x: number; y: number; z: number }, volumes: readonly { containsPoint(p: { x: number; y: number; z: number }): boolean }[]): number {
  return raining && !isIndoor(pos, volumes) ? 1 : 0;
}

/** 每帧更新汐的材质（脸 SDF 朝向、湿痕）；wetTarget 由场景设（室外有雨 = 1，室内 / 无雨 = 0） */
export class XiLookComponent extends Component {
  wetTarget = 0;
  readonly look: XiLook;

  constructor(look: XiLook, wetness = 0) {
    super();
    this.look = look;
    look.wetness = wetness;
  }

  override update(dt: number): void {
    this.look.wetness = stepWetness(this.look.wetness, this.wetTarget, dt);
    this.look.update();
  }
}
