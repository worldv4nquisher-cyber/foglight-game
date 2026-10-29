import type { Game } from '@/core/Game';
import { t } from '@/content/text';

import { formatPlayTime } from './format';

/**
 * 章节结束页（v0.1-008，GDD §10）：章节名「第一章 · 归岸」、点亮的灯塔插画（030 交付前是占位）、本章用时、
 * 使用提示次数（只陈述不评分）、「未完待续」、回到主菜单。数值取自存档（结束页场景进入时已写入 chapterComplete）。
 */
export class ChapterEnd {
  readonly el: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private game: Game,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chapter-end';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="chapter-end-inner" data-ui>
        <h1 class="chapter-end-title"></h1>
        <div class="chapter-end-art" role="img"><span class="chapter-end-art-label"></span></div>
        <p class="chapter-end-stat" data-role="playtime"></p>
        <p class="chapter-end-stat" data-role="hints"></p>
        <p class="chapter-end-tbc"></p>
        <button type="button" class="menu-btn primary" data-act="to-menu"></button>
      </div>
    `;
    parent.appendChild(this.el);
    this.el.querySelector('.chapter-end-title')!.textContent = t('ui.end.chapter');
    const art = this.el.querySelector<HTMLDivElement>('.chapter-end-art')!;
    art.setAttribute('aria-label', t('ui.end.illustration'));
    this.el.querySelector('.chapter-end-art-label')!.textContent = t('ui.end.illustration');
    this.el.querySelector('.chapter-end-tbc')!.textContent = t('ui.end.tbc');
    const toMenu = this.el.querySelector<HTMLButtonElement>('[data-act="to-menu"]')!;
    toMenu.textContent = t('ui.end.to_menu');
    toMenu.addEventListener('click', () => void this.game.flow.toMenu());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(stats: { playTimeSec: number; hintsUsed: number }): void {
    this.el.querySelector('[data-role="playtime"]')!.textContent = t('ui.end.playtime', { time: formatPlayTime(stats.playTimeSec) });
    this.el.querySelector('[data-role="hints"]')!.textContent = t('ui.end.hints', { count: stats.hintsUsed });
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
