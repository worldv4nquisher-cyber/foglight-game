/**
 * FPS / 帧时间显示（左上角）。开发模式默认显示（import.meta.env.DEV），生产环境默认隐藏，F3 切换。
 * 每 0.5 秒刷新一次文字，避免频繁改 DOM。
 */
export class FpsCounter {
  readonly el: HTMLDivElement;
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private _visible: boolean;

  constructor(parent: HTMLElement, visible: boolean, private extraInfo: () => string = () => '') {
    this.el = document.createElement('div');
    this.el.className = 'fps-counter';
    parent.appendChild(this.el);
    this._visible = visible;
    this.el.hidden = !visible;
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(v: boolean): void {
    this._visible = v;
    this.el.hidden = !v;
  }

  update(dt: number): void {
    if (!this._visible) return;
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc >= 0.5) {
      const fps = this.frames / this.acc;
      const ms = (this.acc / this.frames) * 1000;
      const extra = this.extraInfo();
      this.el.textContent = `${fps.toFixed(0)} FPS · ${ms.toFixed(1)}ms (max ${(this.worst * 1000).toFixed(1)})${extra ? ` · ${extra}` : ''}`;
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
