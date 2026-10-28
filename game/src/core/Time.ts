/**
 * 时间状态：固定步长累加器 + 帧时间统计。
 * - fixedDelta：逻辑/物理更新步长（默认 1/60 s）
 * - maxFrameDelta：单帧最大时长，防止切后台回来后“死亡螺旋”
 * - timeScale：慢动作/子弹时间
 */
export class Time {
  readonly fixedDelta: number;
  readonly maxFrameDelta: number;
  readonly maxStepsPerFrame: number;

  timeScale = 1;
  /** 本帧真实时间间隔（秒，已乘 timeScale、已截断） */
  delta = 0;
  /** 未缩放的真实帧间隔 */
  unscaledDelta = 0;
  /** 游戏运行总时长（秒，暂停时不增长） */
  elapsed = 0;
  /** 固定步长更新次数 */
  fixedTick = 0;
  /** 渲染插值系数 [0,1) */
  alpha = 0;
  frame = 0;

  private accumulator = 0;
  private last = -1;

  constructor(fixedDelta = 1 / 60, maxFrameDelta = 0.25, maxStepsPerFrame = 5) {
    this.fixedDelta = fixedDelta;
    this.maxFrameDelta = maxFrameDelta;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  /** 开始一帧，返回本帧应执行的固定步数 */
  beginFrame(nowMs: number, paused: boolean): number {
    const now = nowMs / 1000;
    if (this.last < 0) this.last = now;
    const raw = Math.min(now - this.last, this.maxFrameDelta);
    this.last = now;
    this.unscaledDelta = raw;
    this.frame++;

    if (paused) {
      this.delta = 0;
      return 0;
    }

    this.delta = raw * this.timeScale;
    this.elapsed += this.delta;
    this.accumulator += this.delta;

    let steps = Math.floor(this.accumulator / this.fixedDelta);
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.fixedDelta;
    }
    this.fixedTick += steps;
    this.alpha = this.accumulator / this.fixedDelta;
    return steps;
  }

  /** 恢复时调用，避免把暂停期间的时间算进去 */
  resetClock(): void {
    this.last = -1;
    this.accumulator = 0;
  }
}
