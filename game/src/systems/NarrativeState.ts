import type { EventBus } from '@/core/EventBus';
import { isTextId, textMeta, textPages, type TextId } from '@/content/text';

/**
 * 叙事状态（v0.1-005）：已读文档（= 日志条目，按首次阅读顺序）、「只一次」字幕记录、当前目标、结尾日志第 6 页。
 *
 * 持久化交给存档（006）：存档有进行中的进度（主场景 newGame / continueGame 之后）时读写 SaveSystem 的
 * readDocs / seenLines；没有进度（测试场地不存档）时只记在内存里。当前目标不进存档——
 * 它由谜题进度决定，场景入口按进度重新设置（决定记录在 README「字幕、阅读界面与日志」）。
 */
export interface NarrativeStore {
  readonly active: boolean;
  readDocIds(): readonly string[];
  markDocRead(id: string): void;
  hasReadDoc(id: string): boolean;
  markLineSeen(id: string): void;
  hasSeenLine(id: string): boolean;
}

/** 日志分组（text-ch1 §0 / ui.journal.*）：父亲的日志 / 信与纸条 */
export type JournalGroup = 'father' | 'letters';

export interface JournalEntry {
  docId: TextId;
  title: TextId | null;
  group: JournalGroup;
}

/** 结尾演出后加在父亲日志末尾的第 6 页 */
export const FATHER_JOURNAL_ID = 'ch1.s2.journal.doc' satisfies TextId;
export const OUTRO_JOURNAL_ENTRY_ID = 'ch1.outro.journal_entry' satisfies TextId;

/** 能进日志的文本：类型 doc（信、纸条）/ journal（父亲日志） */
export function isJournalDoc(id: string): id is TextId {
  if (!isTextId(id)) return false;
  const type = textMeta(id).type;
  return type === 'doc' || type === 'journal';
}

/** 文档标题 ID：ch1.<场景>.<对象>.doc → ui.doc_title.<对象>（表里没有就 null） */
export function docTitleId(docId: string): TextId | null {
  const parts = docId.split('.');
  const obj = parts.length >= 4 ? parts[parts.length - 2] : undefined;
  const id = obj ? `ui.doc_title.${obj}` : '';
  return isTextId(id) ? id : null;
}

export function journalGroup(docId: TextId): JournalGroup {
  return textMeta(docId).type === 'journal' ? 'father' : 'letters';
}

export class NarrativeState {
  private memRead: string[] = [];
  private memSeen = new Set<string>();
  private _goal: TextId | null = null;
  private readonly events: EventBus | null;
  private readonly store: NarrativeStore | null;

  constructor(events: EventBus | null, store: NarrativeStore | null = null) {
    this.events = events;
    this.store = store;
  }

  private get persisted(): NarrativeStore | null {
    return this.store?.active ? this.store : null;
  }

  // ---------------------------------------------------------------- 文档 / 日志

  /** 已读文档（首次阅读顺序） */
  get readDocs(): readonly string[] {
    return this.persisted?.readDocIds() ?? this.memRead;
  }

  hasRead(docId: string): boolean {
    return this.persisted ? this.persisted.hasReadDoc(docId) : this.memRead.includes(docId);
  }

  /**
   * 标记文档已读。首次阅读返回 true，并发 journal:updated（「日志已更新」提示由 UI 订阅）；
   * 再次阅读返回 false，不重复添加。不是文档类文本（doc / journal）的 ID 忽略。
   */
  markRead(docId: string): boolean {
    if (!isJournalDoc(docId) || this.hasRead(docId)) return false;
    const p = this.persisted;
    if (p) p.markDocRead(docId);
    else this.memRead.push(docId);
    this.events?.emit('journal:updated', { docId, entries: [...this.readDocs] });
    return true;
  }

  /** 日志条目（按首次阅读顺序；只含文档类） */
  get journal(): JournalEntry[] {
    return this.readDocs.filter(isJournalDoc).map((docId) => ({ docId, title: docTitleId(docId), group: journalGroup(docId) }));
  }

  /** 文档的页（父亲日志在结尾演出后多出第 6 页） */
  docPages(docId: TextId): string[] {
    const pages = textPages(docId);
    if (docId === FATHER_JOURNAL_ID && this.outroEntryUnlocked) pages.push(...textPages(OUTRO_JOURNAL_ENTRY_ID));
    return pages;
  }

  /** 结尾演出（035）写下日志末页时调用 */
  unlockOutroEntry(): void {
    if (this.outroEntryUnlocked) return;
    this.markSeen(OUTRO_JOURNAL_ENTRY_ID);
    this.events?.emit('journal:updated', { docId: FATHER_JOURNAL_ID, entries: [...this.readDocs] });
  }

  get outroEntryUnlocked(): boolean {
    return this.hasSeen(OUTRO_JOURNAL_ENTRY_ID);
  }

  // ---------------------------------------------------------------- 只一次

  hasSeen(lineId: string): boolean {
    return this.persisted ? this.persisted.hasSeenLine(lineId) : this.memSeen.has(lineId);
  }

  markSeen(lineId: string): void {
    const p = this.persisted;
    if (p) p.markLineSeen(lineId);
    else this.memSeen.add(lineId);
  }

  // ---------------------------------------------------------------- 当前目标

  get goal(): TextId | null {
    return this._goal;
  }

  /** 由谜题进度设置（文案来自文本表 ch1.*.goal.*）；null = 清空 */
  setGoal(goal: TextId | null): void {
    if (goal !== null && textMeta(goal).type !== 'goal') throw new Error(`setGoal: ${goal} 不是 goal 类文本`);
    if (goal === this._goal) return;
    this._goal = goal;
    this.events?.emit('goal:changed', { goal });
  }

  /** 新游戏：清空内存记录（存档里的由 SaveSystem.newGame 清） */
  resetMemory(): void {
    this.memRead = [];
    this.memSeen.clear();
    this._goal = null;
  }
}
