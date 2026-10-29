/**
 * 左下角短提示（GDD §10：拾取日志时「日志已更新」2 秒）。时间走 UI 帧（未缩放）。
 * 右下角的「已保存」仍是 Hud.toast（v0.1-006），两处位置不同、互不顶掉。
 *
 * BUG-004：首次阅读时提示会在阅读界面打开的同一刻触发，而阅读界面 / 日志 / 暂停菜单都盖在它上面。
 * 所以有「遮挡」时提示先挂起（不显示、不计时），遮挡消失后才显示并开始倒计时——玩家关掉阅读界面
 * 之后完整看到 2 s。显示途中又被遮挡（比如又打开日志）也一样暂停计时，重新露出来后接着走完。
 */
export class Toast {
  readonly el: HTMLDivElement;
  private remaining = 0;
  private text = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toast-left';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /** 排队显示；真正露出来要等下一次 update 且没有遮挡 */
  show(text: string, seconds: number): void {
    this.text = text;
    this.remaining = seconds;
  }

  /** 正在屏幕上显示（没被挂起） */
  get visible(): boolean {
    return !this.el.hidden;
  }

  /** 有待显示或正在显示的提示（含被遮挡挂起的） */
  get pending(): boolean {
    return this.remaining > 0;
  }

  /** @param blocked 当前有盖在提示上面的界面（阅读 / 日志 / 暂停）：挂起，不显示、不计时 */
  update(dt: number, blocked = false): void {
    if (this.remaining <= 0) return;
    if (blocked) {
      this.el.hidden = true;
      return;
    }
    if (this.el.hidden) {
      this.el.textContent = this.text;
      this.el.hidden = false;
      return; // 露出来的这一帧不扣时间
    }
    this.remaining -= dt;
    if (this.remaining <= 0) this.clear();
  }

  clear(): void {
    this.remaining = 0;
    this.text = '';
    this.el.hidden = true;
    this.el.textContent = '';
  }

  dispose(): void {
    this.el.remove();
  }
}
