import { gameplay } from '@/config/gameplay';
import { t, textMeta, type TextId, type TextSpeaker } from '@/content/text';
import type { EventBus } from '@/core/EventBus';
import type { SubtitleSize } from '@/systems/save/Settings';

const cfg = gameplay.narrative;

/** 显示时长 = max(2.0 s, 字数 × 0.12 s)（GDD §9）；字数 = 去掉空白后的字符数，标点计入 */
export function subtitleDuration(text: string): number {
  const n = [...text.replace(/\s+/g, '')].length;
  return Math.max(cfg.subtitleMinSeconds, Math.round(n * cfg.subtitlePerChar * 1000) / 1000);
}

/** 说话人字色（style-guide §2）：汐 = 正文 #E4E8EA，父亲的文字 = 次要 #8B959D；不显示名字（text-ch1 §0.5） */
export const SPEAKER_COLORS: Record<TextSpeaker, string> = {
  xi: '#E4E8EA',
  father: '#8B959D',
  none: '#E4E8EA',
  system: '#E4E8EA',
};

/** 演出时间轴上的一条字幕（035 调用 playAt(time) 驱动）；duration 缺省按字数算 */
export interface SubtitleCue {
  at: number;
  id: TextId;
  duration?: number;
}

export interface SubtitleLine {
  /** 文本表 ID；playText 播的测试 / 调试行为 null */
  id: TextId | null;
  text: string;
  speaker: TextSpeaker;
  duration: number;
  /** 演出字幕：锁定，不可手动推进 */
  locked: boolean;
}

/** 「只一次」记录（NarrativeState 实现） */
export interface SeenStore {
  hasSeen(id: string): boolean;
  markSeen(id: string): void;
}

function lineOf(id: TextId, duration?: number, locked = false): SubtitleLine {
  const text = t(id);
  return { id, text, speaker: textMeta(id).speaker, duration: duration ?? subtitleDuration(text), locked };
}

/**
 * 字幕播放逻辑（无 DOM，Node 测试直接用）：
 * - play(ids)：替换当前队列（text-ch1 §0.6：同一时刻只显示一条，新来的顶掉旧的）依次播放，到时自动下一行；
 *   标「只一次」且已触发过的行跳过，显示时记录。
 * - advance()：手动推进（左键 / Space），演出锁定的行不响应。
 * - 时间轴模式（setTimeline + playAt）：演出字幕优先级最高，期间 play() 的独白 / 查看被屏蔽（丢弃）。
 */
export class SubtitleTrack {
  private queue: SubtitleLine[] = [];
  private _current: SubtitleLine | null = null;
  private elapsed = 0;
  private timeline: SubtitleCue[] | null = null;
  /** 显示 / 隐藏回调（DOM 层接） */
  onShow: ((line: SubtitleLine) => void) | null = null;
  onHide: ((line: SubtitleLine, reason: 'timeout' | 'advance' | 'replaced' | 'clear') => void) | null = null;

  private readonly seen: SeenStore | null;
  private readonly events: EventBus | null;

  constructor(seen: SeenStore | null = null, events: EventBus | null = null) {
    this.seen = seen;
    this.events = events;
  }

  get current(): SubtitleLine | null {
    return this._current;
  }

  /** 当前行已显示的时间（s） */
  get time(): number {
    return this.elapsed;
  }

  get pending(): number {
    return this.queue.length;
  }

  get inTimeline(): boolean {
    return this.timeline !== null;
  }

  /** 依次播放；返回实际排进队列的行数（被「只一次」跳过的不算；演出期间返回 0） */
  play(ids: readonly TextId[]): number {
    if (this.timeline) return 0;
    const lines = ids.filter((id) => !(textMeta(id).once && this.seen?.hasSeen(id))).map((id) => lineOf(id));
    if (!lines.length) return 0;
    const count = lines.length;
    this.hide('replaced');
    this.queue = lines;
    this.next();
    return count;
  }

  /**
   * 直接播一段文字（不走文本表）：只给自动化测试 / 调试面板用（如 30 字行 3.6 s 的验收，表里没有正好 30 字的行）。
   * 游戏内容一律用 play(ids)。
   */
  playText(text: string, speaker: TextSpeaker = 'xi'): void {
    if (this.timeline) return;
    this.hide('replaced');
    this.queue = [];
    this.show({ id: null, text, speaker, duration: subtitleDuration(text), locked: false });
  }

  /** 手动推进到下一行；当前行锁定或没有字幕时返回 false */
  advance(): boolean {
    if (!this._current || this._current.locked) return false;
    this.hide('advance');
    this.next();
    return true;
  }

  /** 每帧调用（游戏时间：暂停、阅读界面打开时传 0） */
  update(dt: number): void {
    if (this.timeline || !this._current) return;
    this.elapsed += dt;
    if (this.elapsed + 1e-9 >= this._current.duration) {
      this.hide('timeout');
      this.next();
    }
  }

  clear(): void {
    this.queue = [];
    this.hide('clear');
  }

  // ---------------------------------------------------------------- 演出时间轴（035）

  setTimeline(cues: readonly SubtitleCue[]): void {
    this.clear();
    this.timeline = [...cues].sort((a, b) => a.at - b.at);
  }

  endTimeline(): void {
    this.timeline = null;
    this.clear();
  }

  /** 演出时间 time（s）处应显示哪条：at ≤ time < at + duration；与镜头时间轴同步，跳转 / 倒退都按时间重新计算 */
  playAt(time: number): SubtitleLine | null {
    if (!this.timeline) return null;
    let want: SubtitleCue | null = null;
    for (const c of this.timeline) {
      const d = c.duration ?? subtitleDuration(t(c.id));
      if (time >= c.at && time < c.at + d) want = c;
    }
    if ((want?.id ?? null) !== (this._current?.id ?? null)) {
      this.hide(want ? 'replaced' : 'timeout');
      if (want) this.show(lineOf(want.id, want.duration, true));
    }
    if (want && this._current) this.elapsed = time - want.at;
    return this._current;
  }

  // ----------------------------------------------------------------

  private next(): void {
    const line = this.queue.shift();
    if (line) this.show(line);
  }

  private show(line: SubtitleLine): void {
    this._current = line;
    this.elapsed = 0;
    if (line.id && textMeta(line.id).once) this.seen?.markSeen(line.id);
    this.onShow?.(line);
    this.events?.emit('subtitle:show', { id: line.id ?? '', duration: line.duration, locked: line.locked });
  }

  private hide(reason: 'timeout' | 'advance' | 'replaced' | 'clear'): void {
    const cur = this._current;
    if (!cur) return;
    const shown = this.elapsed;
    this._current = null;
    this.onHide?.(cur, reason);
    this.events?.emit('subtitle:hide', { id: cur.id ?? '', reason, shown });
  }
}

/** 字号三档（读设置 subtitleSize，006） */
export const SUBTITLE_SIZES: Record<SubtitleSize, number> = { s: 18, m: 22, l: 28 };

/**
 * 字幕 DOM（底部居中、无底框、浅阴影，style-guide §6）。逻辑在 SubtitleTrack。
 */
export class Subtitles {
  readonly el: HTMLDivElement;
  readonly track: SubtitleTrack;
  private lineEl: HTMLDivElement;
  private _size: SubtitleSize = 'm';

  constructor(parent: HTMLElement, seen: SeenStore | null, events: EventBus | null) {
    this.el = document.createElement('div');
    this.el.className = 'subtitles';
    this.el.setAttribute('aria-live', 'polite');
    this.lineEl = document.createElement('div');
    this.lineEl.className = 'subtitle-line';
    this.lineEl.hidden = true;
    this.el.appendChild(this.lineEl);
    parent.appendChild(this.el);
    this.track = new SubtitleTrack(seen, events);
    this.track.onShow = (line) => {
      this.lineEl.textContent = line.text;
      this.lineEl.dataset.id = line.id ?? '';
      this.lineEl.dataset.speaker = line.speaker;
      this.lineEl.style.color = SPEAKER_COLORS[line.speaker];
      this.lineEl.hidden = false;
    };
    this.track.onHide = () => {
      this.lineEl.hidden = true;
      this.lineEl.textContent = '';
      delete this.lineEl.dataset.id;
    };
    this.setSize('m');
  }

  play(ids: readonly TextId[]): number {
    return this.track.play(ids);
  }

  playAt(time: number): SubtitleLine | null {
    return this.track.playAt(time);
  }

  advance(): boolean {
    return this.track.advance();
  }

  get current(): SubtitleLine | null {
    return this.track.current;
  }

  get size(): SubtitleSize {
    return this._size;
  }

  /** 即时生效（设置变化时 UIManager 调用） */
  setSize(size: SubtitleSize): void {
    this._size = size;
    this.el.dataset.size = size;
    this.el.style.setProperty('--subtitle-size', `${SUBTITLE_SIZES[size]}px`);
  }

  update(dt: number): void {
    this.track.update(dt);
  }

  dispose(): void {
    this.el.remove();
  }
}
