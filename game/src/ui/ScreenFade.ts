/**
 * 全屏黑场（强制送回 / 场景切换用）。opacity 由调用方逐帧设置。
 * 场景切换时下一个场景还没加载完：黑场中间显示一条细线进度（v0.1-010，GDD §10「黑场中显示细线进度」）。
 */
export class ScreenFade {
  private el: HTMLDivElement;
  private line: HTMLDivElement;
  private bar: HTMLDivElement;
  private value = 0;
  private progressValue: number | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen-fade';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="screen-fade-progress" hidden><div class="screen-fade-bar"></div></div>';
    this.line = this.el.querySelector<HTMLDivElement>('.screen-fade-progress')!;
    this.bar = this.el.querySelector<HTMLDivElement>('.screen-fade-bar')!;
    root.appendChild(this.el);
  }

  get opacity(): number {
    return this.value;
  }

  set(opacity: number): void {
    const v = Math.min(1, Math.max(0, opacity));
    if (v === this.value) return;
    this.value = v;
    this.el.hidden = v <= 0;
    this.el.style.opacity = String(v);
  }

  /** 细线进度（0–1）；null = 隐藏 */
  setProgress(ratio: number | null): void {
    this.progressValue = ratio === null ? null : Math.min(1, Math.max(0, ratio));
    this.line.hidden = this.progressValue === null;
    if (this.progressValue !== null) this.bar.style.width = `${(this.progressValue * 100).toFixed(1)}%`;
  }

  /** 当前显示的进度（隐藏为 null；测试用） */
  get progress(): number | null {
    return this.progressValue;
  }

  dispose(): void {
    this.el.remove();
  }
}
