/**
 * 演出时钟（035）：演出时间 t（s）以「结尾曲在 AudioContext 里起播的时刻」为 0，跟音频时钟走，不跟游戏时间——
 * 软渲染 / 掉帧时游戏时间（dt 截断）会比真实时间慢，画面卡点就和音乐错开。
 * - audio()：音频时钟上的演出时间；结尾曲没在放 / context 没在跑（?art=0、下载失败、挂起）返回 null；
 * - 没有音频时用后备时钟：performance.now 的增量累加（暂停时不走；单次增量最多 MAX_STEP，切后台回来不跳一大段）；
 * - 单调：t = max(上一帧, 本帧候选)。后备 → 音频（结尾曲晚到补位）时音频落后就停着等，不倒退；音频超前就跟上去。
 * - seek(t)：调试 / 冒烟把时钟推到某一点（两种来源都生效：音频源加偏移）。
 */
export interface CutsceneClockSource {
  audio(): number | null;
  /** performance.now()（ms） */
  now(): number;
  paused(): boolean;
}

export type CutsceneClockKind = 'audio' | 'fallback';

/** 后备时钟单次最多走多少（s） */
export const CLOCK_MAX_STEP = 0.25;

export class CutsceneClock {
  private _t = 0;
  private last: number;
  private offset = 0;
  source: CutsceneClockKind = 'fallback';
  /** 用过音频时钟的帧数 / 后备时钟的帧数（冒烟读） */
  readonly frames = { audio: 0, fallback: 0 };

  private readonly src: CutsceneClockSource;

  constructor(src: CutsceneClockSource) {
    this.src = src;
    this.last = src.now();
  }

  get t(): number {
    return this._t;
  }

  tick(): number {
    const now = this.src.now();
    const dt = this.src.paused() ? 0 : Math.min(CLOCK_MAX_STEP, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const a = this.src.audio();
    let cand: number;
    if (a !== null && Number.isFinite(a)) {
      this.source = 'audio';
      cand = a + this.offset;
      this.frames.audio++;
    } else {
      this.source = 'fallback';
      cand = this._t + dt;
      this.frames.fallback++;
    }
    this._t = Math.max(this._t, cand);
    return this._t;
  }

  /** 推到 t（只能往前） */
  seek(t: number): void {
    if (t <= this._t) return;
    this.offset += t - this._t;
    this._t = t;
  }
}
