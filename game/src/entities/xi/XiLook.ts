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
