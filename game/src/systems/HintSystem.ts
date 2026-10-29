import { gameplay } from '@/config/gameplay';
import type { TextId } from '@/content/text';

/**
 * 三级提示（v0.1-007，GDD §7 / §9 / §10）。纯逻辑、不碰 DOM，Node 里可直接单测（npm run test:hint）。
 *
 * - 每道谜题一个区域（013–015 白盒里放）。玩家第一次进区域开始计时；离开区域暂停、不清零；解开后该谜题提示失效。
 * - 计时走游戏固定步长（暂停 / 阅读 / 日志冻结时不走）：进区域 180 s → 一级，再 180 s → 二级，再 240 s → 三级
 *   （gameplay.hint；`?hintScale=0.05` 开发 / 调试时整体缩短）。
 * - 「当前谜题」= 玩家所在区域里没解开的那道；不在任何区域时 = 最近进过、还没解开的那道。右下角风灯图标、H 弹窗都只看它。
 * - 谜题可以分步骤（谜题 5）：二、三级取第一个未完成的步骤。`stepTimed` 时二、三级按当前步骤计时（015）：
 *   一级仍按区域累计时间；一级解锁后每个步骤从 0 计（换步骤时回到一级），满 level2Delay → 二级，再满 level3Delay → 三级。
 * - H 弹窗打开（reveal）时：每个第一次看到的层级记一次 hintsUsed（006；同一谜题同一层级只记一次，换步骤不重复记），
 *   二级已解锁则调用 highlight() 高亮关键物体 3 s（每次打开都高亮）。
 */

export type HintLevel = 0 | 1 | 2 | 3;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 谜题区域：返回玩家是否在区域内 */
export type HintZone = (p: Vec3Like) => boolean;

/** 水平圆柱区域（y 不限） */
export function circleZone(center: { x: number; z: number }, radius: number): HintZone {
  const r2 = radius * radius;
  return (p) => (p.x - center.x) ** 2 + (p.z - center.z) ** 2 <= r2;
}

/** 轴对齐盒子区域（白盒触发体） */
export function boxZone(min: Vec3Like, max: Vec3Like): HintZone {
  return (p) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
}

type IdList = readonly string[] | (() => readonly string[]);

export interface HintStepDef {
  id: string;
  l2: TextId;
  l3: TextId;
  /** 二级高亮的物体（Interactable id 或场景节点名）；可以是函数（谜题 5：涨潮时多亮一个钟） */
  highlight?: IdList;
}

export interface PuzzleHintDef {
  /** 谜题 id（p1…p5，或测试用 id） */
  id: string;
  zone: HintZone;
  l1: TextId;
  /** 不分步骤时的二、三级 */
  l2?: TextId;
  l3?: TextId;
  highlight?: IdList;
  /** 分步骤：二、三级取第一个未完成的步骤 */
  steps?: readonly HintStepDef[];
  /**
   * 临时覆盖（015 谜题 5「点灯」）：返回文本 ID 时，只要提示已解锁（≥ 一级），H 弹窗只显示这一条（记作三级），
   * 不高亮、不走二三级计时；返回 null 回到原步骤提示。
   */
  override?: () => TextId | null;
  /** 二、三级按当前步骤计时（015 谜题 5）；默认 false = 按区域累计时间 */
  stepTimed?: boolean;
}

export interface HintLine {
  level: 1 | 2 | 3;
  /** null = 还没解锁（显示 ch1.hint.locked） */
  textId: TextId | null;
}

export interface HintView {
  puzzleId: string | null;
  level: HintLevel;
  /** 当前步骤 id（分步骤谜题），否则 null */
  step: string | null;
  lines: HintLine[];
}

export interface HintSystemOptions {
  /** 计时缩放（?hintScale=0.05 → 5%） */
  scale?: number;
  /** 每记一次提示使用（存档 hintsUsed++） */
  onUsed?: (puzzleId: string, level: 1 | 2 | 3) => void;
  /** 二级高亮（InteractionSystem.highlight） */
  highlight?: (ids: readonly string[], seconds: number) => void;
  /** 新层级解锁（图标淡入、调试） */
  onUnlock?: (puzzleId: string, level: 1 | 2 | 3) => void;
}

interface PuzzleState {
  def: PuzzleHintDef;
  time: number;
  entered: boolean;
  solved: boolean;
  doneSteps: Set<string>;
  /** 已经在弹窗里看过的最高层级 */
  seen: HintLevel;
  level: HintLevel;
  lastEnter: number;
  /** stepTimed：当前步骤 id / 一级解锁后在这一步上的区域内时间 / 这一步在弹窗里看过的最高层级 */
  stepId: string | null;
  stepTime: number;
  stepSeen: HintLevel;
}

const ids = (l: IdList | undefined): readonly string[] => (typeof l === 'function' ? l() : (l ?? []));

/** URL ?hintScale=（只在开发 / 调试 / 冒烟时生效）；非法值回 1 */
export function hintScaleFromUrl(search: string, allowed: boolean): number {
  if (!allowed) return 1;
  const v = Number(new URLSearchParams(search).get('hintScale'));
  return v > 0 && v <= 1 ? v : 1;
}

export class HintSystem {
  readonly scale: number;
  private puzzles = new Map<string, PuzzleState>();
  private opts: HintSystemOptions;
  private inZone: PuzzleState | null = null;
  /** 上一步所在的区域（判断「重新进入」，决定不在区域时的当前谜题） */
  private lastInside: PuzzleState | null = null;
  private enterSeq = 0;

  constructor(opts: HintSystemOptions = {}) {
    this.opts = opts;
    this.scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  }

  /** 解锁各层级需要的累计时间（s，已乘 scale） */
  get thresholds(): [number, number, number] {
    const h = gameplay.hint;
    const a = h.level1Delay * this.scale;
    const b = a + h.level2Delay * this.scale;
    return [a, b, b + h.level3Delay * this.scale];
  }

  add(def: PuzzleHintDef): void {
    if (this.puzzles.has(def.id)) throw new Error(`[hint] 重复的谜题 id ${def.id}`);
    if (!def.steps?.length && (!def.l2 || !def.l3)) throw new Error(`[hint] ${def.id} 没有步骤时必须有 l2 / l3`);
    this.puzzles.set(def.id, { def, time: 0, entered: false, solved: false, doneSteps: new Set(), seen: 0, level: 0, lastEnter: -1, stepId: def.steps?.[0]?.id ?? null, stepTime: 0, stepSeen: 0 });
  }

  /** 谜题解开：提示失效，图标消失，H 不再显示它 */
  solve(id: string): void {
    const s = this.puzzles.get(id);
    if (!s) return;
    s.solved = true;
    if (this.inZone === s) this.inZone = null;
  }

  /** 分步骤谜题完成一步（二、三级切到下一个未完成的步骤） */
  completeStep(id: string, stepId: string): void {
    const s = this.puzzles.get(id);
    if (!s || s.doneSteps.has(stepId)) return;
    s.doneSteps.add(stepId);
    this.syncStep(s);
  }

  /** stepTimed：当前步骤变了 → 步骤计时清零，层级回到一级（已解锁的话） */
  private syncStep(s: PuzzleState): void {
    if (!s.def.stepTimed) return;
    const id = this.stepOf(s)?.id ?? null;
    if (id === s.stepId) return;
    s.stepId = id;
    s.stepTime = 0;
    if (s.level > 1) s.level = 1;
    if (s.stepSeen > s.level) s.stepSeen = s.level;
  }

  /** stepTimed：当前步骤上的计时（s，一级解锁后才走） */
  stepTime(id: string): number {
    return this.puzzles.get(id)?.stepTime ?? 0;
  }

  isSolved(id: string): boolean {
    return this.puzzles.get(id)?.solved ?? false;
  }

  /** 每个物理步：dt = 游戏时间（暂停 / 冻结时不调） */
  fixedUpdate(dt: number, player: Vec3Like): void {
    this.inZone = null;
    for (const s of this.puzzles.values()) {
      if (s.solved || !s.def.zone(player)) continue;
      if (!this.inZone) this.inZone = s;
      if (!s.entered) s.entered = true;
      if (s.lastEnter < 0 || this.lastInside !== s) s.lastEnter = ++this.enterSeq;
      s.time += dt;
      if (s.def.stepTimed && s.time >= this.thresholds[0]) s.stepTime += Math.min(dt, s.time - this.thresholds[0]);
      this.recompute(s);
    }
    this.lastInside = this.inZone;
  }

  private recompute(s: PuzzleState): void {
    const th = this.thresholds;
    let lv: HintLevel;
    if (s.def.stepTimed) {
      const h = gameplay.hint;
      const a = h.level2Delay * this.scale;
      const b = a + h.level3Delay * this.scale;
      lv = s.time < th[0] ? 0 : s.stepTime >= b - 1e-9 ? 3 : s.stepTime >= a - 1e-9 ? 2 : 1;
    } else lv = s.time >= th[2] ? 3 : s.time >= th[1] ? 2 : s.time >= th[0] ? 1 : 0;
    while (s.level < lv) {
      s.level = (s.level + 1) as HintLevel;
      this.opts.onUnlock?.(s.def.id, s.level as 1 | 2 | 3);
    }
  }

  /** 当前谜题：所在区域里没解开的；不在区域时 = 最近进过、没解开的 */
  private get currentState(): PuzzleState | null {
    if (this.inZone && !this.inZone.solved) return this.inZone;
    let best: PuzzleState | null = null;
    for (const s of this.puzzles.values()) if (s.entered && !s.solved && (!best || s.lastEnter > best.lastEnter)) best = s;
    return best;
  }

  get currentId(): string | null {
    return this.currentState?.def.id ?? null;
  }

  /** 某谜题已解锁的层级 */
  level(id: string): HintLevel {
    return this.puzzles.get(id)?.level ?? 0;
  }

  /** 某谜题区域内累计时间（游戏时间 s） */
  time(id: string): number {
    return this.puzzles.get(id)?.time ?? 0;
  }

  /** 右下角风灯图标：当前谜题有已解锁的层级 */
  get iconVisible(): boolean {
    const s = this.currentState;
    return !!s && s.level >= 1;
  }

  /** 有还没在弹窗里看过的新层级（图标亮一点） */
  get iconFresh(): boolean {
    const s = this.currentState;
    return !!s && s.level > (s.def.stepTimed ? s.stepSeen : s.seen);
  }

  private stepOf(s: PuzzleState): HintStepDef | null {
    const steps = s.def.steps;
    if (!steps?.length) return null;
    return steps.find((st) => !s.doneSteps.has(st.id)) ?? steps[steps.length - 1]!;
  }

  /** 弹窗内容（不记次数、不高亮） */
  view(): HintView {
    const s = this.currentState;
    if (!s) return { puzzleId: null, level: 0, step: null, lines: [1, 2, 3].map((level) => ({ level: level as 1 | 2 | 3, textId: null })) };
    const ov = s.level >= 1 ? (s.def.override?.() ?? null) : null;
    if (ov) return { puzzleId: s.def.id, level: s.level, step: 'override', lines: [{ level: 3, textId: ov }] };
    const step = this.stepOf(s);
    const texts: [TextId, TextId, TextId] = [s.def.l1, step ? step.l2 : s.def.l2!, step ? step.l3 : s.def.l3!];
    return {
      puzzleId: s.def.id,
      level: s.level,
      step: step?.id ?? null,
      lines: texts.map((id, i) => ({ level: (i + 1) as 1 | 2 | 3, textId: s.level > i ? id : null })),
    };
  }

  /** 当前二级要高亮的物体 */
  highlightIds(): readonly string[] {
    const s = this.currentState;
    if (!s) return [];
    const step = this.stepOf(s);
    return ids(step ? step.highlight : s.def.highlight);
  }

  /** H 弹窗打开：新层级记 hintsUsed；二级已解锁时高亮 3 s。返回弹窗内容 */
  reveal(): HintView {
    const v = this.view();
    const s = this.currentState;
    if (!s) return v;
    while (s.seen < s.level) {
      s.seen = (s.seen + 1) as HintLevel;
      this.opts.onUsed?.(s.def.id, s.seen as 1 | 2 | 3);
    }
    if (s.stepSeen < s.level) s.stepSeen = s.level;
    if (s.level >= 2 && v.step !== 'override') {
      const list = this.highlightIds();
      if (list.length) this.opts.highlight?.(list, gameplay.hint.highlightSeconds);
    }
    return v;
  }

  /** 调试 / 测试：直接把某谜题计时设到某层级（不算进区域） */
  debugSetTime(id: string, seconds: number): void {
    const s = this.puzzles.get(id);
    if (!s) return;
    s.time = seconds;
    s.entered = true;
    // stepTimed：把超出一级的部分算到当前步骤上（测试直接跳层级用）
    if (s.def.stepTimed) s.stepTime = Math.max(0, seconds - this.thresholds[0]);
    if (s.lastEnter < 0) s.lastEnter = ++this.enterSeq;
    this.recompute(s);
  }

  debugLine(): string {
    const cur = this.currentState;
    if (!cur) return '无';
    const th = this.thresholds;
    return `${cur.def.id} ${cur.time.toFixed(1)}s / ${th.map((x) => x.toFixed(0)).join('·')} · L${cur.level} 看过 L${cur.seen}${this.stepOf(cur) ? ' · 步骤 ' + this.stepOf(cur)!.id + (cur.def.stepTimed ? ` ${cur.stepTime.toFixed(1)}s` : '') : ''}${this.inZone ? '' : '（区域外，暂停）'}`;
  }
}
