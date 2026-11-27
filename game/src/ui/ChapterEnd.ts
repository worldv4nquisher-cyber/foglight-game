import type { Game } from '@/core/Game';
import { t } from '@/content/text';

import { formatPlayTime } from './format';
import { cssUrl } from './uiArt';

export type EndChapter = 'ch1' | 'ch2';

/**
 * 章节结束页（第一章结束后可进入第二章；第二章结束后可查看制作人员或返回主菜单）。
 */
export class ChapterEnd {
  readonly el: HTMLDivElement;
  private inner: HTMLDivElement;
  private art: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private tbcEl: HTMLParagraphElement;
  private primaryBtn: HTMLButtonElement;
  private toMenuBtn: HTMLButtonElement;
  private chapter: EndChapter = 'ch1';

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
        <div class="chapter-end-actions">
          <button type="button" class="menu-btn primary" data-act="primary"></button>
          <button type="button" class="menu-btn" data-act="to-menu"></button>
        </div>
      </div>
    `;
    parent.appendChild(this.el);
    this.inner = this.el.querySelector<HTMLDivElement>('.chapter-end-inner')!;
    this.titleEl = this.el.querySelector<HTMLHeadingElement>('.chapter-end-title')!;
    this.tbcEl = this.el.querySelector<HTMLParagraphElement>('.chapter-end-tbc')!;
    const art = (this.art = this.el.querySelector<HTMLDivElement>('.chapter-end-art')!);
    art.setAttribute('aria-label', t('ui.end.illustration'));
    this.el.querySelector('.chapter-end-art-label')!.textContent = t('ui.end.illustration');
    this.primaryBtn = this.el.querySelector<HTMLButtonElement>('[data-act="primary"]')!;
    this.toMenuBtn = this.el.querySelector<HTMLButtonElement>('[data-act="to-menu"]')!;
    this.toMenuBtn.textContent = t('ui.end.to_menu');
    this.primaryBtn.addEventListener('click', () => this.onPrimary());
    this.toMenuBtn.addEventListener('click', () => void this.game.flow.toMenu());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(stats: { playTimeSec: number; hintsUsed: number; chapter?: EndChapter }): void {
    this.chapter = stats.chapter ?? 'ch1';
    this.titleEl.textContent = t(this.chapter === 'ch2' ? 'ui.end.ch2_chapter' : 'ui.end.chapter');
    this.tbcEl.textContent = t(this.chapter === 'ch2' ? 'ui.end.tbc' : 'ui.end.next_chapter');
    this.primaryBtn.textContent = t(this.chapter === 'ch2' ? 'ui.end.credits' : 'ui.end.ch1_next');
    this.primaryBtn.dataset.act = this.chapter === 'ch2' ? 'credits' : 'next-chapter';
    this.el.querySelector('[data-role="playtime"]')!.textContent = t('ui.end.playtime', { time: formatPlayTime(stats.playTimeSec) });
    this.el.querySelector('[data-role="hints"]')!.textContent = t('ui.end.hints', { count: stats.hintsUsed });
    this.inner.hidden = false;
    this.el.hidden = false;
    this.loadArt();
  }

  closeCredits(): void {
    if (!this.game.ui.credits.isOpen) return;
    this.game.ui.credits.hide();
    this.inner.hidden = false;
  }

  private onPrimary(): void {
    if (this.chapter === 'ch1') {
      this.game.flow.startChapter2();
      return;
    }
    this.inner.hidden = true;
    this.game.ui.credits.onBack = () => this.closeCredits();
    this.game.ui.credits.show();
  }

  /** 030 R4：结尾插画懒加载（common 包里登记、lazy，进结尾才下）；同 key 只下一次 */
  private loadArt(): void {
    if (this.art.dataset.art === 'ready') return;
    this.art.dataset.art = 'loading';
    void this.game.assets.loadImage('ui-illust-chapter1-end').then((url) => {
      if (url) this.art.style.setProperty('--end-art', cssUrl(url));
      this.art.dataset.art = url ? 'ready' : 'fallback';
    });
  }

  hide(): void {
    this.game.ui.credits.hide();
    this.inner.hidden = false;
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
