import type { Game } from '@/core/Game';
import { t } from '@/content/text';
import type { ConfirmDialog } from './ConfirmDialog';
import type { Credits } from './Credits';
import type { SettingsPanel } from './SettingsPanel';
import { cssUrl } from './uiArt';

/**
 * 主菜单（v0.1-008，GDD §10）：标题字（开发期文字占位，正式标题图 030）、继续（无存档时隐藏）、新游戏
 * （有存档时覆盖确认，取消回主菜单）、设置、制作名单、版本号；存档异常 / 无法保存的提示（006）显示在按钮下方。
 * 背景是 MenuScene 的实时场景；这里只是叠在上面的 DOM 层。按钮动作交给 game.flow。
 */
export class MainMenu {
  readonly el: HTMLDivElement;
  private home: HTMLDivElement;
  private continueBtn: HTMLButtonElement;
  private notice: HTMLParagraphElement;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private game: Game,
    private settings: SettingsPanel,
    private credits: Credits,
    private confirm: ConfirmDialog,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'main-menu';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="main-menu-home" data-ui>
        <h1 class="main-title"></h1>
        <nav class="main-buttons">
          <button type="button" class="menu-btn main-btn primary" data-act="continue"></button>
          <button type="button" class="menu-btn main-btn" data-act="new"></button>
          <button type="button" class="menu-btn main-btn" data-act="settings"></button>
          <button type="button" class="menu-btn main-btn" data-act="credits"></button>
        </nav>
        <p class="main-notice" role="status" hidden></p>
      </div>
      <div class="main-version"></div>
    `;
    parent.appendChild(this.el);
    this.home = this.el.querySelector('.main-menu-home')!;
    this.el.querySelector('.main-title')!.textContent = t('ui.title');
    this.el.querySelector('.main-version')!.textContent = t('ui.menu.version');
    this.notice = this.el.querySelector('.main-notice')!;
    const btn = (act: string, text: Parameters<typeof t>[0], fn: () => void): HTMLButtonElement => {
      const b = this.el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
      b.textContent = t(text);
      b.addEventListener('click', fn);
      return b;
    };
    this.continueBtn = btn('continue', 'ui.menu.continue', () => this.run(() => this.game.flow.continueGame()));
    btn('new', 'ui.menu.new_game', () => void this.onNewGame());
    btn('settings', 'ui.menu.settings', () => this.openSettings());
    btn('credits', 'ui.menu.credits', () => this.openCredits());
    // 030 R4：主菜单背景是 008 的实时场景（程序生成、不加载文件）；静态插画只是兜底——
    // ?menuBg=illust 强制用，或 WebGL 上下文丢了（实时背景画不出来）时自动换上
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('menuBg') === 'illust') this.illustWanted = true;
    this.game.renderer.domElement.addEventListener('webglcontextlost', () => {
      this.illustWanted = true;
      if (this.isOpen) this.applyIllust();
    });
  }

  private illustWanted = false;

  /** 静态兜底插画 ui-illust-menu.webp（menu 包登记、lazy）：懒加载后铺满 .main-menu；失败维持纯色 + 渐变 */
  private applyIllust(): void {
    if (this.el.dataset.bg) return;
    this.el.dataset.bg = 'loading';
    void this.game.assets.loadImage('ui-illust-menu').then((url) => {
      if (url) this.el.style.setProperty('--menu-illust', cssUrl(url));
      this.el.dataset.bg = url ? 'illust' : 'fallback';
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** 当前显示的子界面：home / settings / credits / confirm */
  get view(): 'home' | 'settings' | 'credits' | 'confirm' {
    if (this.confirm.isOpen) return 'confirm';
    if (this.settings.isOpen && this.el.contains(this.settings.el)) return 'settings';
    if (this.credits.isOpen) return 'credits';
    return 'home';
  }

  show(): void {
    this.applyLogo();
    if (this.illustWanted) this.applyIllust();
    this.busy = false;
    this.refresh();
    this.backToHome();
    this.el.hidden = false;
  }

  /**
   * 030 R2：标题字换成 ui-title-logo.webp（menu 包已预加载）。文字留在 .ui-sr-only 里，textContent 仍是「雾灯」；
   * 图没到（?art=0 / 缺失）就维持文字标题。
   */
  private applyLogo(): void {
    const title = this.el.querySelector<HTMLHeadingElement>('.main-title')!;
    const url = this.game.assets.imageUrl('ui-title-logo');
    if (!url || title.classList.contains('has-logo')) return;
    const img = document.createElement('img');
    img.className = 'ui-logo';
    img.src = url;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.draggable = false;
    const text = document.createElement('span');
    text.className = 'ui-sr-only';
    text.textContent = t('ui.title');
    title.replaceChildren(img, text);
    title.classList.add('has-logo');
  }

  hide(): void {
    this.confirm.close();
    if (this.el.contains(this.settings.el)) this.settings.hide();
    this.credits.hide();
    this.el.hidden = true;
  }

  /** Esc / 返回：子界面回到主菜单首页 */
  back(): void {
    if (this.view === 'home') return;
    this.backToHome();
  }

  refresh(): void {
    // 无存档（或存档坏了）不显示「继续」
    this.continueBtn.hidden = !this.game.save.canContinue;
    // 主按钮只用一个（style-guide §6）：有存档时是「继续」，否则是「新游戏」
    this.el.querySelector('[data-act="new"]')!.classList.toggle('primary', !this.game.save.canContinue);
    const msg = this.game.save.menuNotice;
    this.notice.hidden = !msg;
    this.notice.textContent = msg ?? '';
  }

  private backToHome(): void {
    this.confirm.close();
    if (this.el.contains(this.settings.el)) this.settings.hide();
    this.credits.hide();
    this.home.hidden = false;
  }

  private openSettings(): void {
    this.home.hidden = true;
    this.settings.onBack = () => this.backToHome();
    this.settings.mount(this.el);
  }

  private openCredits(): void {
    this.home.hidden = true;
    this.credits.onBack = () => this.backToHome();
    this.credits.show();
  }

  private async onNewGame(): Promise<void> {
    if (this.busy) return;
    if (this.game.save.canContinue) {
      this.home.hidden = true;
      // 弹窗和暂停菜单共用一个实例：挂到主菜单层里
      this.el.appendChild(this.confirm.el);
      const ok = await this.confirm.open({ title: 'ui.menu.overwrite_title', body: 'ui.menu.overwrite_body' });
      if (!ok) {
        // 取消 → 回主菜单
        if (this.isOpen) this.backToHome();
        return;
      }
    }
    this.run(() => this.game.flow.newGame());
  }

  /** 防连点：开始加载后按钮不再响应（show() 时复位） */
  private run(fn: () => void): void {
    if (this.busy) return;
    this.busy = true;
    fn();
  }

  dispose(): void {
    this.el.remove();
  }
}
