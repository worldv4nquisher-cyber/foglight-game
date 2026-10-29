import type { PlayerController } from '@/entities/components/PlayerController';
import { xiClipDuration, xiInteractEventSec, type XiClipName } from '@/entities/xi/clips';
import type { InteractionAnim } from '@/systems/interaction/InteractionSystem';

/**
 * 汐的短动作（v0.1-014 接口，v0.1-017 换成按 clip 驱动）：时长 = clip 长度，`marker` 在 clip 的交互事件帧
 * （xi-place-table release 第 34 帧、xi-ignite-lever ignite 第 34 帧…，见 XI_INTERACT_EVENT）回调。
 * 有汐的动画（art=1）时每个物理步按游戏时间 setPose；白盒胶囊只计时，节奏一致。
 */
export type XiActionName = XiClipName;

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

/** 动作时长 / 关键帧时间（s）：来自 clip 表（verify-xi 比对 GLB extras） */
export function xiActionTiming(name: XiActionName): { duration: number; markerSec: number } {
  return { duration: xiClipDuration(name), markerSec: xiInteractEventSec(name) };
}

/** 按 clip 播短动作：锁角色、按游戏时间计时（暂停不走）、在事件帧回调；有动画时驱动姿势 */
export class XiActions implements XiActionPlayer {
  private cur: { name: XiActionName; t: number; duration: number; markerSec: number; markerDone: boolean; opts: XiActionOptions; resolve: () => void } | null = null;

  private readonly controller: PlayerController;
  private readonly anim: InteractionAnim | null;

  constructor(controller: PlayerController, anim?: InteractionAnim | null) {
    this.controller = controller;
    this.anim = anim ?? null;
  }

  get playing(): XiActionName | null {
    return this.cur?.name ?? null;
  }

  play(name: XiActionName, opts: XiActionOptions = {}): Promise<void> {
    this.cancel();
    this.controller.halt();
    this.controller.locked = true;
    const { duration, markerSec } = xiActionTiming(name);
    if (this.anim?.has(name)) this.anim.setPose(name, 0);
    return new Promise((resolve) => {
      this.cur = { name, t: 0, duration, markerSec, markerDone: false, opts, resolve };
    });
  }

  fixedUpdate(dt: number): void {
    const c = this.cur;
    if (!c) return;
    c.t = Math.min(c.duration, c.t + dt);
    if (this.anim?.has(c.name)) this.anim.setPose(c.name, c.t);
    c.opts.onTick?.(c.t);
    if (!c.markerDone && c.t >= c.markerSec - 1e-6) {
      c.markerDone = true;
      c.opts.onMarker?.();
    }
    if (c.t >= c.duration - 1e-6) {
      this.cur = null;
      this.controller.locked = false;
      this.anim?.clearPose();
      c.resolve();
    }
  }

  cancel(): void {
    if (!this.cur) return;
    this.cur = null;
    this.controller.locked = false;
    this.anim?.clearPose();
  }
}
