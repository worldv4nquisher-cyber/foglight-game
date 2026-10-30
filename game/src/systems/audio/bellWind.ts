/** 潮汐钟「风吹轻响」间隔（s）：032 README 建议 6–14 s 一次，均匀随机 */
export const BELL_WIND_INTERVAL: readonly [number, number] = [6, 14];

/**
 * 钟风吹轻响计时（按 fixedUpdate 的游戏时间 dt 走，不看墙钟）：
 * 在听得到的距离内倒计时，到 0 响一次并重抽 6–14 s；走远时把剩余时间压到 ≤ 1 s（回来很快就响）。
 */
export class BellWindTimer {
  private left = 0;
  private readonly rng: () => number;
  readonly interval: readonly [number, number];

  constructor(rng: () => number = Math.random, interval: readonly [number, number] = BELL_WIND_INTERVAL) {
    this.rng = rng;
    this.interval = interval;
  }

  /** 下一次的间隔（s） */
  next(): number {
    const [a, b] = this.interval;
    return a + this.rng() * (b - a);
  }

  /** 推进 dt 游戏秒；这一步该响返回 true */
  update(dt: number, inRange: boolean): boolean {
    if (!inRange) {
      this.left = Math.min(this.left, 1);
      return false;
    }
    this.left -= dt;
    if (this.left > 0) return false;
    this.left = this.next();
    return true;
  }

  /** 剩余秒数（测试读） */
  get remaining(): number {
    return this.left;
  }
}
