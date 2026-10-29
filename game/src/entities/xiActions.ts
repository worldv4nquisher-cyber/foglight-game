import type { PlayerController } from '@/entities/components/PlayerController';

/**
 * 汐的短动作接口（v0.1-014）：动画系统还没做，先留接口 + 占位实现。
 * 动画到了以后换成真正播 clip 的实现：时长取 clip 长度，`marker` 在 clip 事件帧（如 xi-place-table 的「放下」帧）回调。
 */
export type XiActionName = 'xi-place-table';

export interface XiActionOptions {
  /** 动作中的关键帧（放下物体那一刻）回调 */
  onMarker?: () => void;
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
};

/** 占位：不播动画，只锁角色、按时长计时、在关键帧回调 */
export class PlaceholderXiActions implements XiActionPlayer {
  private cur: { name: XiActionName; t: number; markerDone: boolean; opts: XiActionOptions; resolve: () => void } | null = null;

  constructor(private readonly controller: PlayerController) {}

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
    c.t += dt;
    if (!c.markerDone && c.t >= spec.duration * spec.marker) {
      c.markerDone = true;
      c.opts.onMarker?.();
    }
    if (c.t >= spec.duration) {
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
