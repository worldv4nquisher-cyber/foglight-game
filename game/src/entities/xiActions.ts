import type { PlayerController } from '@/entities/components/PlayerController';

/**
 * 汐的短动作接口（v0.1-014）：动画系统还没做，先留接口 + 占位实现。
 * 动画到了以后换成真正播 clip 的实现：时长取 clip 长度，`marker` 在 clip 事件帧（如 xi-place-table 的「放下」帧）回调。
 */
export type XiActionName = 'xi-place-table' | 'xi-ignite-lever';

export interface XiActionOptions {
  /** 动作中的关键帧（放下物体那一刻）回调 */
  onMarker?: () => void;
  /** 每个物理步回调动作已播放的秒数（拉杆按逐帧角度转动等；最后一步 t = duration） */
  onTick?: (t: number) => void;
}

export interface XiActionPlayer {
  /** 播放一个短动作：期间角色锁定不可操作，结束后解锁；返回动作结束 */
  play(name: XiActionName, opts?: XiActionOptions): Promise<void>;
  /** 每个物理步推进（占位实现用游戏时间计时，暂停时不走） */
  fixedUpdate(dt: number): void;
  readonly playing: XiActionName | null;
  /** 场景退出：放弃进行中的动作（不回调） */
  cancel(): void;
}

/** 占位时长（s）与关键帧位置（0–1）：按 017 动作清单的估计值，动画交付后以 clip 为准 */
const PLACEHOLDER: Record<XiActionName, { duration: number; marker: number }> = {
  'xi-place-table': { duration: 1.0, marker: 0.6 },
  // 017 已交付：46 帧 / 1.5 s（30 fps），ignite 事件帧 = 第 34 帧（1.133 s）；verify-s3 比对 GLB extras
  'xi-ignite-lever': { duration: 1.5, marker: 34 / 30 / 1.5 },
};

/**
 * xi-ignite-lever 的拉杆对位（017 第 2 批 char-xi-anims.glb → animations[xi-ignite-lever].extras.align.igniteLever，
 * scripts/verify-s3.mjs 逐项比对 GLB）。拉杆节点绕自己局部 +X（= 汐面朝拉杆时她的 +X）转 pullSign × angleDegPerFrame[帧]。
 * 动画系统接入（017）前没有在运行时读 GLB，先用这份拷贝。
 */
export const XI_IGNITE_LEVER_ALIGN = {
  fps: 30,
  frames: 46,
  eventFrames: { grip: 15, pullStart: 22, ignite: 34 },
  pivot: [0.15, 0.74, 0.55] as const,
  lengthM: 0.3,
  pullDeg: 60,
  pullSign: -1,
  angleDegPerFrame: [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.181, 4.444, 9.375, 15.556, 22.569, 30, 37.431, 44.444, 50.625, 55.556, 58.819, 60, 60,
    60, 60, 60, 60, 60, 60, 60, 60, 60, 60,
  ] as readonly number[],
} as const;

/** 拉杆角度（°，未乘 pullSign）：t = 动作开始后的秒数，帧间线性插值，超出末帧保持 */
export function igniteLeverAngleAt(t: number): number {
  const A = XI_IGNITE_LEVER_ALIGN.angleDegPerFrame;
  const f = Math.max(0, t * XI_IGNITE_LEVER_ALIGN.fps);
  const i = Math.floor(f);
  if (i >= A.length - 1) return A[A.length - 1]!;
  const u = f - i;
  return A[i]! + (A[i + 1]! - A[i]!) * u;
}

/** 动作时长 / 关键帧时间（s），给脚本对位用（拉杆逐帧转动等） */
export function xiActionTiming(name: XiActionName): { duration: number; markerSec: number } {
  const p = PLACEHOLDER[name];
  return { duration: p.duration, markerSec: p.duration * p.marker };
}

/** 占位：不播动画，只锁角色、按时长计时、在关键帧回调 */
export class PlaceholderXiActions implements XiActionPlayer {
  private cur: { name: XiActionName; t: number; markerDone: boolean; opts: XiActionOptions; resolve: () => void } | null = null;

  private readonly controller: PlayerController;

  constructor(controller: PlayerController) {
    this.controller = controller;
  }

  get playing(): XiActionName | null {
    return this.cur?.name ?? null;
  }

  play(name: XiActionName, opts: XiActionOptions = {}): Promise<void> {
    this.cancel();
    this.controller.halt();
    this.controller.locked = true;
    return new Promise((resolve) => {
      this.cur = { name, t: 0, markerDone: false, opts, resolve };
    });
  }

  fixedUpdate(dt: number): void {
    const c = this.cur;
    if (!c) return;
    const spec = PLACEHOLDER[c.name];
    c.t = Math.min(spec.duration, c.t + dt);
    c.opts.onTick?.(c.t);
    if (!c.markerDone && c.t >= spec.duration * spec.marker - 1e-6) {
      c.markerDone = true;
      c.opts.onMarker?.();
    }
    if (c.t >= spec.duration - 1e-6) {
      this.cur = null;
      this.controller.locked = false;
      c.resolve();
    }
  }

  cancel(): void {
    if (!this.cur) return;
    this.cur = null;
    this.controller.locked = false;
  }
}
