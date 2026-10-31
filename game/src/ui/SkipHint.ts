import { t } from '@/content/text';
import type { SkipController } from '@/systems/cutscene/SkipController';

/**
 * 跳过提示（035）：右下角「按住 空格 跳过」+ 圆环进度（SVG）。键盘监听装在 window 上（capture），任何输入上下文都收得到，
 * 只记 Space 的按下 / 抬起 + 任意键；不 preventDefault（游戏输入照常）。可见性 / 进度每帧由 SkipController 算。
 */
const R = 9;
const C = 2 * Math.PI * R;

export class SkipHint {
  readonly el: HTMLDivElement;
  private ring: SVGCircleElement;
  private shown = false;
  private readonly offs: Array<() => void> = [];

  constructor(
    root: HTMLElement,
    private readonly skip: SkipController,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'skip-hint';
    this.el.hidden = true;
    this.el.innerHTML =
      `<svg class="skip-hint-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="skip-hint-track" cx="12" cy="12" r="${R}"/>` +
      `<circle class="skip-hint-fill" cx="12" cy="12" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/></svg>` +
      `<span class="skip-hint-text"></span>`;
    this.el.querySelector('.skip-hint-text')!.textContent = t('ch1.intro.skip_hint');
    this.ring = this.el.querySelector<SVGCircleElement>('.skip-hint-fill')!;
    root.appendChild(this.el);
    const down = (e: KeyboardEvent): void => {
      const now = performance.now();
      if (e.code === 'Space') {
        if (!e.repeat) skip.press(now);
      } else skip.anyKey(now);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') skip.release();
    };
    const blur = (): void => skip.release();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    this.offs.push(
      () => window.removeEventListener('keydown', down, true),
      () => window.removeEventListener('keyup', up, true),
      () => window.removeEventListener('blur', blur),
    );
  }

  get visible(): boolean {
    return this.shown;
  }

  update(now: number): void {
    const show = this.skip.hintVisible(now);
    if (show !== this.shown) {
      this.shown = show;
      this.el.hidden = !show;
    }
    if (show) this.ring.setAttribute('stroke-dashoffset', (C * (1 - this.skip.progress(now))).toFixed(2));
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.el.remove();
  }
}
