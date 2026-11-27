import { t } from '@/content/text';
import { credits } from '@/config/gameConfig';

/** 制作名单（v0.1-008）：ui.credits.body 慢速向上滚动，{producer} 等署名占位由 gameConfig.credits 填（制作人提供） */
export class Credits {
  readonly el: HTMLDivElement;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'credits';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ui-panel credits-panel" data-ui>
        <h2 class="ui-heading"></h2>
        <div class="credits-window"><div class="credits-roll"></div></div>
        <button type="button" class="menu-btn" data-act="back"></button>
      </div>
    `;
    parent.appendChild(this.el);
    this.el.querySelector('h2')!.textContent = t('ui.menu.credits');
    const back = this.el.querySelector<HTMLButtonElement>('[data-act="back"]')!;
    back.textContent = t('ui.common.back');
    back.addEventListener('click', () => this.onBack?.());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(chapter: 'ch1' | 'ch2' = 'ch1'): void {
    const roll = this.el.querySelector<HTMLDivElement>('.credits-roll')!;
    roll.textContent = t(chapter === 'ch2' ? 'ui.credits.body.ch2' : 'ui.credits.body', { ...credits });
    // 重新开始滚动动画
    roll.classList.remove('rolling');
    void roll.offsetWidth;
    roll.classList.add('rolling');
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
