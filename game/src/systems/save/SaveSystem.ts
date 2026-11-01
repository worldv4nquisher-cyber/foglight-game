import { t } from '@/content/text';
import { deepClone } from '@/platform/clone';
import { defaultStorage, probeWritable, safeGet, safeRemove, safeSet, type StorageLike } from './storage';

/**
 * 存档（GDD §11、v0.1-006）：localStorage 键 `foglight.save.v1`，单存档位，只有自动存档。
 * - 存档时机由场景流程调用 `save()`：进入 S1（开场演出结束）、每次进入新场景（黑场中）、点灯进入章节结束页。
 * - 读档只回到场景入口，谜题全部初始状态（不做谜题级存档）。
 * - 游玩时间：`tick(dt)` 每满 10 秒累加一次到内存，下次存档时写入。
 * - 异常：版本不对 / JSON 坏 → load() 返回 null、status = 'corrupt'（主菜单提示 ui.save.corrupt，只给新游戏）；
 *   localStorage 不可写 → writable = false（主菜单提示 ui.save.unavailable），游戏照常运行，进度只在内存里。
 */
export const SAVE_KEY = 'foglight.save.v1';
export const SAVE_VERSION = 1;
/** 游玩时间累加粒度（秒） */
export const PLAYTIME_STEP_SEC = 10;

/** 文案（文本表 ui.save.*，v0.1-008 起按 ID 取） */
export const SAVE_TEXT = {
  saved: t('ui.save.saved'),
  corrupt: t('ui.save.corrupt'),
  unavailable: t('ui.save.unavailable'),
} as const;

export interface SaveData {
  version: 1;
  chapterId: string;
  /** 场景 ID（如 's1' / 's2' / 's3'；章节完成时为结束页场景） */
  sceneId: string;
  /** 已读日志 / 信件 ID */
  readDocs: string[];
  /** 已触发过的「只一次」独白 ID（text-ch1.md 规则 7：由 005/006 决定，这里新增字段；旧存档缺失视为空） */
  seenLines: string[];
  playTimeSec: number;
  hintsUsed: number;
  chapterComplete: boolean;
  /** 毫秒时间戳 */
  savedAt: number;
}

export type SaveStatus = 'empty' | 'ok' | 'corrupt';

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 解析存档文本：任何不合规（版本号、必填字段类型）都返回 null */
export function parseSave(text: string): SaveData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== SAVE_VERSION) return null;
  if (typeof r.chapterId !== 'string' || !r.chapterId) return null;
  if (typeof r.sceneId !== 'string' || !r.sceneId) return null;
  if (!isStrArr(r.readDocs)) return null;
  if (typeof r.playTimeSec !== 'number' || !Number.isFinite(r.playTimeSec) || r.playTimeSec < 0) return null;
  if (typeof r.hintsUsed !== 'number' || !Number.isInteger(r.hintsUsed) || r.hintsUsed < 0) return null;
  if (typeof r.chapterComplete !== 'boolean') return null;
  return {
    version: SAVE_VERSION,
    chapterId: r.chapterId,
    sceneId: r.sceneId,
    readDocs: [...r.readDocs],
    seenLines: isStrArr(r.seenLines) ? [...r.seenLines] : [],
    playTimeSec: r.playTimeSec,
    hintsUsed: r.hintsUsed,
    chapterComplete: r.chapterComplete,
    savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
  };
}

/** 本次游玩的进度（内存），存档时整体写盘 */
interface Progress {
  chapterId: string;
  sceneId: string;
  readDocs: Set<string>;
  seenLines: Set<string>;
  playTimeSec: number;
  hintsUsed: number;
  chapterComplete: boolean;
}

export class SaveSystem {
  private storage: StorageLike | null;
  private now: () => number;
  private progress: Progress | null = null;
  private pendingTime = 0;
  private _status: SaveStatus = 'empty';
  private _lastSave: SaveData | null = null;
  /** localStorage 是否可写（启动时探测一次） */
  readonly writable: boolean;
  /** 每次写存档后回调（右下角「已保存」小字等）；ok=false 表示写入失败（进度只在内存里） */
  onSaved: ((data: SaveData, ok: boolean) => void) | null = null;

  constructor(storage: StorageLike | null = defaultStorage(), now: () => number = () => Date.now()) {
    this.storage = storage;
    this.now = now;
    this.writable = probeWritable(storage);
    this.load();
    this.startupNotice = this.menuNotice;
  }

  /** 启动时读档得到的提示（新游戏会清掉坏存档，主菜单 / HUD 仍可显示这条） */
  readonly startupNotice: string | null;

  /** 读档结果：empty = 没有存档；ok = 有可继续的存档；corrupt = 有但读不了 */
  get status(): SaveStatus {
    return this._status;
  }

  /** 主菜单要显示的提示（null = 无） */
  get menuNotice(): string | null {
    if (this._status === 'corrupt') return SAVE_TEXT.corrupt;
    if (!this.writable) return SAVE_TEXT.unavailable;
    return null;
  }

  /** 「继续」是否显示 */
  get canContinue(): boolean {
    return this._status === 'ok' && this._lastSave !== null;
  }

  /** 最近一次读到 / 写入的存档（只读副本） */
  get lastSave(): SaveData | null {
    return this._lastSave ? deepClone(this._lastSave) : null;
  }

  /** 从 localStorage 重新读取。失败返回 null 并把 status 设为 corrupt */
  load(): SaveData | null {
    const text = safeGet(this.storage, SAVE_KEY);
    if (text === null) {
      // 不可写时，本次会话里的存档仍在内存，「继续」可用
      this._status = this._lastSave ? 'ok' : 'empty';
      return this.lastSave;
    }
    const data = parseSave(text);
    this._status = data ? 'ok' : 'corrupt';
    this._lastSave = data;
    return data ? deepClone(data) : null;
  }

  /** 新游戏：清空存档（设置不动），从给定场景开始计进度 */
  newGame(chapterId: string, sceneId: string): void {
    safeRemove(this.storage, SAVE_KEY);
    this._lastSave = null;
    this._status = 'empty';
    this.pendingTime = 0;
    this.progress = {
      chapterId,
      sceneId,
      readDocs: new Set(),
      seenLines: new Set(),
      playTimeSec: 0,
      hintsUsed: 0,
      chapterComplete: false,
    };
  }

  /**
   * 继续：把存档读进内存进度，返回要进入的场景（章节完成时由调用方进入章节结束页）。
   * 没有可用存档返回 null。
   */
  continueGame(): SaveData | null {
    if (!this.canContinue || !this._lastSave) return null;
    const s = this._lastSave;
    this.pendingTime = 0;
    this.progress = {
      chapterId: s.chapterId,
      sceneId: s.sceneId,
      readDocs: new Set(s.readDocs),
      seenLines: new Set(s.seenLines),
      playTimeSec: s.playTimeSec,
      hintsUsed: s.hintsUsed,
      chapterComplete: s.chapterComplete,
    };
    return this.lastSave;
  }

  /** 是否已有进行中的进度（newGame / continueGame 之后） */
  get active(): boolean {
    return this.progress !== null;
  }

  /** 每帧调用（游戏未暂停、在玩法场景中）：每满 10 秒往内存里加 10 秒 */
  tick(dt: number): void {
    if (!this.progress || !(dt > 0)) return;
    this.pendingTime += dt;
    while (this.pendingTime >= PLAYTIME_STEP_SEC) {
      this.pendingTime -= PLAYTIME_STEP_SEC;
      this.progress.playTimeSec += PLAYTIME_STEP_SEC;
    }
  }

  get playTimeSec(): number {
    return this.progress?.playTimeSec ?? 0;
  }

  /** 已读文档 ID（首次阅读顺序，Set 保持插入顺序；日志 005 按此排列） */
  readDocIds(): readonly string[] {
    return this.progress ? [...this.progress.readDocs] : [];
  }

  markDocRead(id: string): void {
    this.progress?.readDocs.add(id);
  }

  hasReadDoc(id: string): boolean {
    return this.progress?.readDocs.has(id) ?? false;
  }

  markLineSeen(id: string): void {
    this.progress?.seenLines.add(id);
  }

  hasSeenLine(id: string): boolean {
    return this.progress?.seenLines.has(id) ?? false;
  }

  addHintUsed(): void {
    if (this.progress) this.progress.hintsUsed++;
  }

  /** 提示使用次数（007） */
  get hintsUsed(): number {
    return this.progress?.hintsUsed ?? 0;
  }

  /**
   * 只把内存里的进度（已读、提示次数、用时）写进已有存档，不改存档点（场景 / 入口仍是上次自动存档的）、不弹「已保存」。
   * 007：看了新层级的提示立刻写盘，刷新 / 关页面也不会丢。还没有存档时不写（等进场自动存档）。
   */
  flush(): boolean {
    const p = this.progress;
    const last = this._lastSave;
    if (!p || !last) return false;
    const data: SaveData = {
      ...last,
      readDocs: [...p.readDocs],
      seenLines: [...p.seenLines],
      playTimeSec: p.playTimeSec,
      hintsUsed: p.hintsUsed,
      chapterComplete: p.chapterComplete,
      savedAt: this.now(),
    };
    const ok = this.writable && safeSet(this.storage, SAVE_KEY, JSON.stringify(data));
    this._lastSave = data;
    return ok;
  }

  /**
   * 自动存档：记录当前场景（入口）并写盘。没有进行中的进度时（比如开发时直接进场景）自动按新游戏开始。
   * 返回是否真正写进了 localStorage（不可写时为 false，但内存里的「继续」本次会话仍可用）。
   */
  save(at: { chapterId: string; sceneId: string; chapterComplete?: boolean }): boolean {
    if (!this.progress) this.newGame(at.chapterId, at.sceneId);
    const p = this.progress!;
    p.chapterId = at.chapterId;
    p.sceneId = at.sceneId;
    if (at.chapterComplete && !p.chapterComplete) {
      // 章节结束页显示的用时要准（v0.1-008）：把不满 10 秒的零头也记上
      p.playTimeSec += this.pendingTime;
      this.pendingTime = 0;
      p.chapterComplete = true;
    }
    const data: SaveData = {
      version: SAVE_VERSION,
      chapterId: p.chapterId,
      sceneId: p.sceneId,
      readDocs: [...p.readDocs],
      seenLines: [...p.seenLines],
      playTimeSec: p.playTimeSec,
      hintsUsed: p.hintsUsed,
      chapterComplete: p.chapterComplete,
      savedAt: this.now(),
    };
    const ok = this.writable && safeSet(this.storage, SAVE_KEY, JSON.stringify(data));
    this._lastSave = data;
    this._status = 'ok';
    this.onSaved?.(deepClone(data), ok);
    return ok;
  }
}
