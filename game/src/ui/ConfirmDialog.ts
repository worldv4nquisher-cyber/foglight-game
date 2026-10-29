import { t, type TextId } from '@/content/text';

export interface ConfirmOptions {
  title: TextId;
  body?: TextId;
  confirm?: TextId;
  cancel?: TextId;
}

/**
 * 确认弹窗（v0.1-008）：有存档时「新游戏」的覆盖确认、暂停菜单「回到主菜单」的提示。
 * open() 返回 Promise<boolean>：确定 = true，取消 / 被 close() 关掉 = false。文字全部来自文本表 ui.*。
 */
export class ConfirmDialog {
  readonly el: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private bodyEl: HTMLParagraphElement;
  private okBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private resolve: ((ok: boolean) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'confirm-dialog';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ui-panel confirm-panel" role="alertdialog" aria-modal="true" data-ui>
        <h3 class="confirm-title"></h3>
        <p class="confirm-body"></p>
        <div class="confirm-actions">
          <button type="button" class="menu-btn" data-act="cancel"></button>
          <button type="button" class="menu-btn primary" data-act="confirm"></button>
        </div>
      </div>
    `;
    parent.appendChild(this.el);
    this.titleEl = this.el.querySelector('.confirm-title')!;
    this.bodyEl = this.el.querySelector('.confirm-body')!;
    this.okBtn = this.el.querySelector('[data-act="confirm"]')!;
    this.cancelBtn = this.el.querySelector('[data-act="cancel"]')!;
    this.okBtn.addEventListener('click', () => this.finish(true));
    this.cancelBtn.addEventListener('click', () => this.finish(false));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(o: ConfirmOptions): Promise<boolean> {
    this.finish(false);
    this.titleEl.textContent = t(o.title);
    this.bodyEl.textContent = o.body ? t(o.body) : '';
    this.bodyEl.hidden = !o.body;
    this.okBtn.textContent = t(o.confirm ?? 'ui.common.confirm');
    this.cancelBtn.textContent = t(o.cancel ?? 'ui.common.cancel');
    this.el.hidden = false;
    return new Promise((res) => (this.resolve = res));
  }

  /** 取消（Esc 返回、菜单被整体关掉时） */
  close(): void {
    this.finish(false);
  }

  private finish(ok: boolean): void {
    this.el.hidden = true;
    const r = this.resolve;
    this.resolve = null;
    r?.(ok);
  }

  dispose(): void {
    this.close();
    this.el.remove();
  }
}
