import type { Game } from '@/core/Game';
import { t } from '@/content/text';
import type { ConfirmDialog } from './ConfirmDialog';
import type { SettingsPanel } from './SettingsPanel';

/**
 * Esc 暂停菜单（v0.1-008 改造，GDD §10）：游戏画面模糊 + 暗化；继续 / 设置 / 回到主菜单。
 * 「设置」打开与主菜单共用的 SettingsPanel（挂在本遮罩层里）；「回到主菜单」先弹确认「将回到最近的场景开头。」。
 * Esc 一律切换暂停（v0.1 裁定 3）：设置 / 确认弹窗开着时按 Esc 也是直接继续游戏。
 * 菜单打开时 InputManager 压 menu 上下文（cursor free），指针锁定自动释放；继续后点击画面重新锁定。
 */
export class PauseMenu {
  readonly el: HTMLDivElement;
  private panel: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private game: Game,
    private settings: SettingsPanel,
    private confirm: ConfirmDialog,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pause-menu';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ui-panel pause-panel" role="dialog" data-ui>
        <h2 class="ui-heading"></h2>
        <button type="button" class="menu-btn primary" data-act="resume"></button>
        <button type="button" class="menu-btn" data-act="settings"></button>
        <button type="button" class="menu-btn" data-act="to-menu"></button>
        <p class="menu-foot"></p>
      </div>
    `;
    parent.appendChild(this.el);
    this.panel = this.el.querySelector('.pause-panel')!;
    this.panel.setAttribute('aria-label', t('ui.pause.title'));
    this.el.querySelector('h2')!.textContent = t('ui.pause.title');
    const btn = (act: string, text: Parameters<typeof t>[0], fn: () => void): void => {
      const b = this.el.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
      b.textContent = t(text);
      b.addEventListener('click', fn);
    };
    btn('resume', 'ui.pause.resume', () => this.game.resume());
    btn('settings', 'ui.pause.settings', () => this.openSettings());
    btn('to-menu', 'ui.pause.to_menu', () => void this.onToMenu());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** 当前显示：main（三个按钮）/ settings / confirm */
  get view(): 'main' | 'settings' | 'confirm' {
    if (this.confirm.isOpen && this.el.contains(this.confirm.el)) return 'confirm';
    if (this.settings.isOpen && this.el.contains(this.settings.el)) return 'settings';
    return 'main';
  }

  show(): void {
    this.showMain();
    this.el.querySelector('.menu-foot')!.textContent = t('ui.pause.esc_hint');
    this.el.hidden = false;
  }

  hide(): void {
    if (this.el.contains(this.confirm.el)) this.confirm.close();
    if (this.el.contains(this.settings.el)) this.settings.hide();
    this.el.hidden = true;
  }

  /** 打开设置子页（测试 / 按钮用） */
  openSettings(): void {
    this.panel.hidden = true;
    this.settings.onBack = () => this.showMain();
    this.settings.mount(this.el);
  }

  private showMain(): void {
    if (this.el.contains(this.confirm.el)) this.confirm.close();
    if (this.el.contains(this.settings.el)) this.settings.hide();
    this.panel.hidden = false;
  }

  private async onToMenu(): Promise<void> {
    this.panel.hidden = true;
    this.el.appendChild(this.confirm.el);
    const ok = await this.confirm.open({ title: 'ui.pause.to_menu', body: 'ui.pause.to_menu_confirm' });
    if (!ok) {
      if (this.isOpen) this.showMain();
      return;
    }
    void this.game.flow.toMenu();
  }

  dispose(): void {
    this.el.remove();
  }
}
