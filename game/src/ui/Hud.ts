/** 简单 HUD：地点标题、操作提示、交互提示。由场景控制显隐。 */
export class Hud {
  readonly el: HTMLDivElement;
  private hint: HTMLDivElement;
  private prompt: HTMLDivElement;
  private location: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hud-location"></div>
      <div class="hud-prompt" hidden></div>
      <div class="hud-hint"></div>
    `;
    parent.appendChild(this.el);
    this.location = this.el.querySelector<HTMLDivElement>('.hud-location')!;
    this.prompt = this.el.querySelector<HTMLDivElement>('.hud-prompt')!;
    this.hint = this.el.querySelector<HTMLDivElement>('.hud-hint')!;
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

  dispose(): void {
    this.el.remove();
  }
}
