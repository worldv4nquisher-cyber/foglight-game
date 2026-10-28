/** 全屏黑场（强制送回 / 场景切换用）。opacity 由调用方逐帧设置。 */
export class ScreenFade {
  private el: HTMLDivElement;
  private value = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen-fade';
    this.el.hidden = true;
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

  dispose(): void {
    this.el.remove();
  }
}
