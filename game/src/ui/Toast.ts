/**
 * 左下角短提示（GDD §10：拾取日志时「日志已更新」2 秒）。时间走 UI 帧（未缩放），暂停菜单打开时也照常消失。
 * 右下角的「已保存」仍是 Hud.toast（v0.1-006），两处位置不同、互不顶掉。
 */
export class Toast {
  readonly el: HTMLDivElement;
  private remaining = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toast-left';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  show(text: string, seconds: number): void {
    this.el.textContent = text;
    this.el.hidden = false;
    this.remaining = seconds;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  update(dt: number): void {
    if (this.el.hidden) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.el.hidden = true;
      this.el.textContent = '';
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
