/**
 * 演出跳过（035；v0.1-035 需求单：按住 Space 1 s，右下角圆环；GDD §1「开场 / 结尾都可按住空格跳过」）。
 * 不绑在某个场景、也不走输入上下文：键盘监听由 UI 层装在 window 上，任何上下文（演出、结束页 menu）都能用——
 * 结尾曲在结束页上还在放时，同一个按住 Space 也能把它 0.75 s 淡掉。
 * - register(target)：同一时刻只有一个目标（后注册的顶掉前一个）；返回注销函数；
 *   - onSkip：按住满 1 s 调一次，随后目标自动注销；
 *   - progress：外部已有的跳过（CameraFollowSystem 的建立镜头 skipHold）只借提示 / 圆环显示，不由这里触发；
 *   - active()：false 时不显示、不计（如建立镜头接上不可跳过的 3 s 镜头）。
 * - 提示「按住 空格 跳过」：演出开始 HINT_DELAY 后按任意键出现 HINT_SHOW 秒；按住期间一直显示（圆环 = 进度）。
 * - 暂停 / 被挡（blocked）时按住清零。
 */
export const SKIP_HOLD_SEC = 1.0;
export const SKIP_HINT_DELAY = 1.0;
export const SKIP_HINT_SHOW = 3.0;

export interface SkipTarget {
  id: string;
  onSkip?: () => void;
  progress?: () => number;
  active?: () => boolean;
}

interface Registered extends SkipTarget {
  since: number;
}

export class SkipController {
  private target: Registered | null = null;
  private holdStart: number | null = null;
  private hintUntil = -Infinity;
  /** 触发过的跳过（id + performance.now ms；冒烟 / 单测读） */
  readonly log: Array<{ id: string; at: number }> = [];

  register(target: SkipTarget, now: number): () => void {
    const r: Registered = { ...target, since: now };
    this.target = r;
    this.holdStart = null;
    this.hintUntil = -Infinity;
    return () => {
      if (this.target === r) this.clearTarget();
    };
  }

  get id(): string | null {
    return this.target?.id ?? null;
  }

  private get live(): Registered | null {
    const t = this.target;
    return t && (t.active?.() ?? true) ? t : null;
  }

  /** Space 按下（键盘重复不重新计时） */
  press(now: number): void {
    if (this.holdStart === null) this.holdStart = now;
    this.anyKey(now);
  }

  release(): void {
    this.holdStart = null;
  }

  /** 任意键按下：演出开始 1 s 后显示提示 3 s */
  anyKey(now: number): void {
    const t = this.live;
    if (t && now - t.since >= SKIP_HINT_DELAY * 1000) this.hintUntil = now + SKIP_HINT_SHOW * 1000;
  }

  /** 每帧；blocked（暂停 / 设置面板开着）时按住清零。触发跳过返回目标 id */
  update(now: number, blocked = false): string | null {
    if (blocked) this.holdStart = null;
    const t = this.live;
    if (!t || t.progress || !t.onSkip || this.holdStart === null) return null;
    if (now - this.holdStart < SKIP_HOLD_SEC * 1000) return null;
    this.clearTarget();
    this.log.push({ id: t.id, at: now });
    t.onSkip();
    return t.id;
  }

  /** 圆环进度 0–1 */
  progress(now: number): number {
    const t = this.live;
    if (!t) return 0;
    if (t.progress) return Math.min(1, Math.max(0, t.progress()));
    return this.holdStart === null ? 0 : Math.min(1, (now - this.holdStart) / (SKIP_HOLD_SEC * 1000));
  }

  hintVisible(now: number): boolean {
    if (!this.live) return false;
    return now < this.hintUntil || this.progress(now) > 0;
  }

  private clearTarget(): void {
    this.target = null;
    this.holdStart = null;
    this.hintUntil = -Infinity;
  }
}
