import { t, type TextId } from '@/content/text';
import type { EventBus } from '@/core/EventBus';
import type { InputManager } from '@/systems/input/InputManager';
import type { HintSystem, HintView } from '@/systems/HintSystem';

const LEVEL_LABEL: Record<1 | 2 | 3, TextId> = { 1: 'ch1.hint.level_1', 2: 'ch1.hint.level_2', 3: 'ch1.hint.level_3' };

/** 小风灯图标（矢量占位，030 的 UI 图标到位后换掉） */
const LANTERN_SVG = `
<svg viewBox="0 0 24 32" width="22" height="29" aria-hidden="true">
  <path d="M8 4h8M12 1v3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  <path d="M7 6h10l1.5 3v15L17 27H7l-1.5-3V9z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>
  <ellipse class="hint-flame" cx="12" cy="17" rx="2.4" ry="3.6"/>
  <path d="M6 29h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

/**
 * 提示弹窗 + 右下角小风灯图标（v0.1-007，GDD §10）。
 * - 图标：当前谜题解锁了一级后淡入（不弹文字、不打断）；有没看过的新层级时稍亮；谜题解开后淡出。
 * - H（explore / puzzle）开关弹窗。弹窗不冻结游戏、不抢输入上下文：玩家可以边看边走，二级高亮同时在场景里亮 3 s。
 * - 阅读界面 / 日志 / 暂停 / 黑场盖住时弹窗和图标先藏起来。
 */
export class HintPanel {
  readonly el: HTMLDivElement;
  private icon: HTMLDivElement;
  private panel: HTMLDivElement;
  private list: HTMLDivElement;
  private system: HintSystem | null = null;
  private open_ = false;
  private shown: HintView | null = null;
  private deps: { input: InputManager; events: EventBus };

  constructor(parent: HTMLElement, deps: { input: InputManager; events: EventBus }) {
    this.deps = deps;
    this.el = document.createElement('div');
    this.el.className = 'hint-root';
    this.el.innerHTML = `
      <div class="hint-lantern" aria-hidden="true">${LANTERN_SVG}</div>
      <div class="hint-panel" role="dialog" hidden>
        <h3 class="hint-title"></h3>
        <div class="hint-list"></div>
      </div>
    `;
    parent.appendChild(this.el);
    this.icon = this.el.querySelector<HTMLDivElement>('.hint-lantern')!;
    this.panel = this.el.querySelector<HTMLDivElement>('.hint-panel')!;
    this.list = this.el.querySelector<HTMLDivElement>('.hint-list')!;
    this.el.querySelector('.hint-title')!.textContent = t('ch1.hint.panel_title');
  }

  /** 场景进入时绑定本场景的 HintSystem，离开时 bind(null) */
  bind(system: HintSystem | null): void {
    this.close();
    this.system = system;
    this.icon.classList.remove('visible', 'fresh');
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** 图标是否显示（测试用） */
  get iconVisible(): boolean {
    return this.icon.classList.contains('visible');
  }

  /** 弹窗里当前显示的内容（测试用） */
  get view(): HintView | null {
    return this.open_ ? this.shown : null;
  }

  open(): void {
    if (this.open_ || !this.system) return;
    this.shown = this.system.reveal();
    this.render(this.shown);
    this.panel.hidden = false;
    this.open_ = true;
    this.deps.events.emit('hint:open', { puzzleId: this.shown.puzzleId, level: this.shown.level, step: this.shown.step });
  }

  close(): void {
    if (!this.open_) return;
    this.panel.hidden = true;
    this.open_ = false;
    this.shown = null;
    this.deps.events.emit('hint:close');
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /** 每帧（UI 帧）：H 开关；covered = 阅读 / 日志 / 暂停 / 菜单 / 黑场 */
  update(covered: boolean): void {
    const sys = this.system;
    const input = this.deps.input;
    const ctx = input.context;
    if (sys && !covered && (ctx === 'explore' || ctx === 'puzzle') && input.consumePressed('hint')) this.toggle();
    if (!sys) {
      this.icon.classList.remove('visible', 'fresh');
      return;
    }
    if (this.open_) {
      // 弹窗开着时内容跟着变（解锁新层级、完成一步、换到别的谜题）：重新 reveal（新层级照样记次数）
      const v = sys.view();
      const s = this.shown;
      if (!s || v.puzzleId !== s.puzzleId || v.level !== s.level || v.step !== s.step) {
        this.shown = v.level > (s?.level ?? 0) || v.puzzleId !== s?.puzzleId ? sys.reveal() : v;
        this.render(this.shown);
      }
    }
    this.el.classList.toggle('covered', covered);
    this.icon.classList.toggle('visible', sys.iconVisible);
    this.icon.classList.toggle('fresh', sys.iconFresh);
  }

  private render(v: HintView): void {
    this.list.replaceChildren();
    for (const line of v.lines) {
      const row = document.createElement('div');
      row.className = 'hint-row';
      row.dataset.level = String(line.level);
      row.classList.toggle('locked', line.textId === null);
      const label = document.createElement('span');
      label.className = 'hint-level';
      label.textContent = t(LEVEL_LABEL[line.level]);
      const text = document.createElement('p');
      text.className = 'hint-text';
      text.textContent = line.textId ? t(line.textId) : t('ch1.hint.locked');
      row.append(label, text);
      this.list.appendChild(row);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
