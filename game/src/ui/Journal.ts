import { t, type TextId } from '@/content/text';
import type { EventBus } from '@/core/EventBus';
import type { InputManager } from '@/systems/input/InputManager';
import type { JournalGroup, NarrativeState } from '@/systems/NarrativeState';
import type { Reader } from './Reader';

export interface JournalDeps {
  input: InputManager;
  narrative: NarrativeState;
  events: EventBus;
  reader: Reader;
  freeze: () => () => void;
}

const GROUP_TITLE: Record<JournalGroup, TextId> = {
  father: 'ui.journal.group_father',
  letters: 'ui.journal.group_letters',
};

/**
 * 日志界面（J，GDD §10）：顶部「当前目标」一句话，下面是已读的信件 / 日志条目，按章节分组（v0.1 只有第一章），
 * 章节内再分「父亲的日志」「信与纸条」。点条目在阅读界面打开，关掉阅读界面回到日志。
 * 打开时和阅读界面一样压 reading 上下文、冻结游戏逻辑；J / 右键 / Tab 关闭。
 */
export class Journal {
  readonly el: HTMLDivElement;
  private goalEl: HTMLParagraphElement;
  private listEl: HTMLDivElement;
  private popContext: (() => void) | null = null;
  private unfreeze: (() => void) | null = null;
  private offs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private deps: JournalDeps,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'journal';
    this.el.hidden = true;
    this.el.dataset.ui = '';
    this.el.innerHTML = `
      <div class="journal-panel" role="dialog">
        <h2 class="journal-title"></h2>
        <div class="journal-goal">
          <span class="journal-goal-label"></span>
          <p class="journal-goal-text"></p>
        </div>
        <div class="journal-list"></div>
      </div>
    `;
    parent.appendChild(this.el);
    this.el.querySelector('.journal-title')!.textContent = t('ui.journal.title');
    this.el.querySelector('.journal-goal-label')!.textContent = t('ui.journal.goal');
    this.goalEl = this.el.querySelector<HTMLParagraphElement>('.journal-goal-text')!;
    this.listEl = this.el.querySelector<HTMLDivElement>('.journal-list')!;
    this.offs.push(
      deps.events.on('goal:changed', () => this.render()),
      deps.events.on('journal:updated', () => this.render()),
    );
  }

  get isOpen(): boolean {
    return this.popContext !== null;
  }

  open(): void {
    if (this.isOpen) return;
    this.popContext = this.deps.input.pushContext('reading');
    this.unfreeze = this.deps.freeze();
    this.render();
    this.el.hidden = false;
    this.deps.events.emit('journal:open');
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.deps.reader.isOpen) this.deps.reader.close(false);
    this.el.hidden = true;
    this.popContext?.();
    this.popContext = null;
    this.unfreeze?.();
    this.unfreeze = null;
    this.deps.events.emit('journal:close');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** 每帧：explore 里 J 打开；日志在最上层（阅读界面没开）时 J / 右键 / Tab 关闭 */
  update(): void {
    const input = this.deps.input;
    if (!this.isOpen) {
      if (input.context === 'explore' && input.consumePressed('journal')) this.open();
      return;
    }
    if (this.deps.reader.isOpen || input.context !== 'reading') return;
    if (input.consumePressed('journal') || input.consumePressed('exitPuzzle')) this.close();
  }

  /** 当前目标文字（测试 / 调试用） */
  get goalText(): string {
    return this.goalEl.textContent ?? '';
  }

  private render(): void {
    const n = this.deps.narrative;
    this.goalEl.textContent = n.goal ? t(n.goal) : '';
    this.goalEl.parentElement!.hidden = !n.goal;
    const entries = n.journal;
    this.listEl.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'journal-empty';
      empty.textContent = t('ui.journal.empty');
      this.listEl.appendChild(empty);
      return;
    }
    const chapter = document.createElement('section');
    chapter.className = 'journal-chapter';
    const h = document.createElement('h3');
    h.textContent = t('ui.journal.chapter1');
    chapter.appendChild(h);
    for (const group of ['father', 'letters'] as const) {
      const items = entries.filter((e) => e.group === group);
      if (!items.length) continue;
      const g = document.createElement('div');
      g.className = 'journal-group';
      g.dataset.group = group;
      const gh = document.createElement('h4');
      gh.textContent = t(GROUP_TITLE[group]);
      g.appendChild(gh);
      for (const e of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'journal-entry';
        b.dataset.doc = e.docId;
        b.textContent = e.title ? t(e.title) : e.docId;
        b.addEventListener('click', () => this.deps.reader.open(e.docId));
        g.appendChild(b);
      }
      chapter.appendChild(g);
    }
    this.listEl.appendChild(chapter);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.close();
    this.el.remove();
  }
}
