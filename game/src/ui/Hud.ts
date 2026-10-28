/** 简单 HUD：地点标题、操作提示、交互提示。由场景控制显隐。 */
export class Hud {
  readonly el: HTMLDivElement;
  private hint: HTMLDivElement;
  private prompt: HTMLDivElement;
  private location: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hud-location"></div>
      <div class="hud-prompt" hidden></div>
      <div class="hud-hint"></div>
      <div class="hud-toast" hidden></div>
    `;
    parent.appendChild(this.el);
    this.location = this.el.querySelector<HTMLDivElement>('.hud-location')!;
    this.prompt = this.el.querySelector<HTMLDivElement>('.hud-prompt')!;
    this.hint = this.el.querySelector<HTMLDivElement>('.hud-hint')!;
    this.toastEl = this.el.querySelector<HTMLDivElement>('.hud-toast')!;
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  setLocation(text: string): void {
    this.location.textContent = text;
    this.location.classList.remove('hud-location-in');
    // 触发重排以重播淡入动画
    void this.location.offsetWidth;
    this.location.classList.add('hud-location-in');
  }

  setHint(html: string): void {
    this.hint.innerHTML = html;
  }

  /** 交互提示（如「E 点亮灯塔」），传 null 隐藏 */
  setPrompt(text: string | null): void {
    this.prompt.hidden = text === null;
    if (text !== null) this.prompt.textContent = text;
  }

  /** 右下角小字（「已保存」2.5s 等，text-ch1.md ui.save.*） */
  toast(text: string, seconds = 2.5): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), seconds * 1000);
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
    this.el.remove();
  }
}
