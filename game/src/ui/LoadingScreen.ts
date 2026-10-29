import { t } from '@/content/text';

/** 加载界面：标题 + 进度条 + 百分比（文字取自文本表 ui.title / ui.boot.*，v0.1-008） */
export class LoadingScreen {
  readonly el: HTMLDivElement;
  private bar: HTMLDivElement;
  private label: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading-screen';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="loading-title"></div>
      <div class="loading-sub"></div>
      <div class="loading-track"><div class="loading-bar"></div></div>
      <div class="loading-label">0%</div>
    `;
    parent.appendChild(this.el);
    this.el.querySelector('.loading-title')!.textContent = t('ui.title');
    this.el.querySelector('.loading-sub')!.textContent = t('ui.boot.headphones');
    this.bar = this.el.querySelector<HTMLDivElement>('.loading-bar')!;
    this.label = this.el.querySelector<HTMLDivElement>('.loading-label')!;
  }

  show(): void {
    this.setProgress(0);
    this.el.hidden = false;
    this.el.classList.remove('fade-out');
  }

  hide(): void {
    this.el.classList.add('fade-out');
    window.setTimeout(() => {
      this.el.hidden = true;
    }, 400);
  }

  setProgress(ratio: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    this.bar.style.width = `${pct}%`;
    this.label.textContent = `${pct}%`;
  }

  dispose(): void {
    this.el.remove();
  }
}
