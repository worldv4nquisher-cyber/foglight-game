import { t, type TextId } from '@/content/text';
import type { EventBus } from '@/core/EventBus';
import type { InputManager } from '@/systems/input/InputManager';
import { docTitleId, type NarrativeState } from '@/systems/NarrativeState';
import { cssUrl, paperForDoc } from './uiArt';

export interface ReaderDeps {
  input: InputManager;
  narrative: NarrativeState;
  events: EventBus;
  /** 冻结游戏逻辑（fixedUpdate / scene.update 不跑），返回解冻函数 */
  freeze: () => () => void;
  /** 030：懒加载纸张图（AssetLoader.loadImage）；不给 / 返回 null → 纯色纸底 */
  loadImage?: (key: string) => Promise<string | null>;
}

/**
 * 阅读界面（v0.1-005，GDD §10）：纸张特写 + 文字版叠加；多页左右翻页（A/D、←/→ 或点箭头）；右键 / Tab 关闭。
 * 打开时压 reading 上下文（显示光标、没有移动轴）并冻结游戏逻辑，背景模糊。首次阅读的文档写入日志。
 *
 * 纸张贴图（030 R3 ui-paper-*，README-030 §2.2）：打开文档时才懒加载对应纸张（PAPER_FOR_DOC），到了写进 `--paper`；
 * 加载中 / 失败 / 没有对应纸张时是 `.reader-paper` 的纯色纸底（#ddd5c3）。状态在 `data-paper`：none / loading / ready / fallback。
 */
export class Reader {
  readonly el: HTMLDivElement;
  private paper: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private bodyEl: HTMLDivElement;
  private pageEl: HTMLSpanElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private _docId: TextId | null = null;
  private pages: string[] = [];
  private _page = 0;
  private popContext: (() => void) | null = null;
  private paperReq = 0;
  private unfreeze: (() => void) | null = null;
  /** 关闭时回调（日志里打开的文档关掉后回到日志） */
  onClose: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private deps: ReaderDeps,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'reader';
    this.el.hidden = true;
    this.el.dataset.ui = '';
    this.el.innerHTML = `
      <div class="reader-paper" role="dialog">
        <h3 class="reader-title"></h3>
        <div class="reader-body"></div>
        <div class="reader-nav">
          <button type="button" class="reader-arrow" data-act="prev" aria-label="prev">‹</button>
          <span class="reader-page"></span>
          <button type="button" class="reader-arrow" data-act="next" aria-label="next">›</button>
        </div>
      </div>
      <div class="reader-bar"></div>
    `;
    parent.appendChild(this.el);
    this.paper = this.el.querySelector<HTMLDivElement>('.reader-paper')!;
    this.titleEl = this.el.querySelector<HTMLHeadingElement>('.reader-title')!;
    this.bodyEl = this.el.querySelector<HTMLDivElement>('.reader-body')!;
    this.pageEl = this.el.querySelector<HTMLSpanElement>('.reader-page')!;
    this.prevBtn = this.el.querySelector<HTMLButtonElement>('[data-act="prev"]')!;
    this.nextBtn = this.el.querySelector<HTMLButtonElement>('[data-act="next"]')!;
    this.el.querySelector('.reader-bar')!.textContent = t('ui.prompt.reader_bar');
    this.prevBtn.addEventListener('click', () => this.flip(-1));
    this.nextBtn.addEventListener('click', () => this.flip(1));
  }

  get isOpen(): boolean {
    return this._docId !== null;
  }

  get docId(): TextId | null {
    return this._docId;
  }

  get page(): number {
    return this._page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** 打开文档；返回是否首次阅读（首次会写进日志并弹「日志已更新」） */
  open(docId: TextId): boolean {
    if (this.isOpen) this.close(false);
    this._docId = docId;
    this.pages = this.deps.narrative.docPages(docId);
    this._page = 0;
    const title = docTitleId(docId);
    this.titleEl.textContent = title ? t(title) : '';
    this.titleEl.hidden = !title;
    this.paper.dataset.doc = docId;
    this.applyPaper(docId);
    this.popContext = this.deps.input.pushContext('reading');
    this.unfreeze = this.deps.freeze();
    this.render();
    this.el.hidden = false;
    this.deps.events.emit('reader:open', { docId, pages: this.pages.length });
    return this.deps.narrative.markRead(docId);
  }

  /** 030：换纸。旧请求晚到（期间换了文档 / 关了）就丢掉 */
  private applyPaper(docId: TextId): void {
    const key = paperForDoc(docId);
    const req = ++this.paperReq;
    this.paper.style.removeProperty('--paper');
    this.paper.dataset.paperKey = key ?? '';
    if (!key) {
      this.paper.dataset.paper = 'none';
      return;
    }
    const load = this.deps.loadImage;
    if (!load) {
      this.paper.dataset.paper = 'fallback';
      return;
    }
    this.paper.dataset.paper = 'loading';
    void load(key).then((url) => {
      if (req !== this.paperReq || this._docId !== docId) return;
      if (url) this.paper.style.setProperty('--paper', cssUrl(url));
      this.paper.dataset.paper = url ? 'ready' : 'fallback';
    });
  }

  close(notify = true): void {
    const id = this._docId;
    if (!id) return;
    this._docId = null;
    this.el.hidden = true;
    this.popContext?.();
    this.popContext = null;
    this.unfreeze?.();
    this.unfreeze = null;
    this.deps.events.emit('reader:close', { docId: id });
    if (notify) this.onClose?.();
  }

  /** 翻页；到头 / 到尾不动，返回是否翻了 */
  flip(dir: -1 | 1): boolean {
    if (!this.isOpen) return false;
    const p = Math.min(this.pages.length - 1, Math.max(0, this._page + dir));
    if (p === this._page) return false;
    this._page = p;
    this.render();
    if (this._docId) this.deps.events.emit('reader:page', { docId: this._docId, page: p });
    return true;
  }

  /** 每帧（UIManager.update）：只在 reading 上下文且自己在最上层时读输入 */
  update(): void {
    if (!this.isOpen) return;
    const input = this.deps.input;
    if (input.context !== 'reading') return;
    if (input.consumePressed('exitPuzzle')) {
      this.close();
      return;
    }
    // 同一帧里两个方向都按了（低帧率时可能）：互相抵消，不会「先退再进」看起来没反应
    const dir = (input.consumePressed('pageNext') ? 1 : 0) - (input.consumePressed('pagePrev') ? 1 : 0);
    if (dir) this.flip(dir === 1 ? 1 : -1);
    input.consumePressed('journal');
  }

  private render(): void {
    this.bodyEl.textContent = this.pages[this._page] ?? '';
    this.bodyEl.scrollTop = 0;
    const multi = this.pages.length > 1;
    this.pageEl.textContent = multi ? `${this._page + 1} / ${this.pages.length}` : '';
    this.prevBtn.hidden = !multi;
    this.nextBtn.hidden = !multi;
    this.prevBtn.disabled = this._page === 0;
    this.nextBtn.disabled = this._page >= this.pages.length - 1;
  }

  dispose(): void {
    this.close(false);
    this.el.remove();
  }
}
