import type { EventBus } from '@/core/EventBus';
import {
  CONTEXTS,
  HOLD_SECONDS,
  actionsForCode,
  axisBindings,
  codesForAction,
  type AxisAction,
  type ButtonAction,
  type CursorMode,
  type InputContextName,
} from './actions';
import { InputContextStack } from './InputContext';

/** 输入源写入统一状态的接口（键鼠 / 以后的手柄 / 保留的触屏） */
export interface InputSink {
  /** 原始按键（KeyboardEvent.code、'Mouse0..2'、'WheelUp/Down'），由当前上下文映射成 action */
  setRaw(source: string, code: string, down: boolean): void;
  /** 模拟轴（触屏摇杆、以后的手柄摇杆），与按键轴相加后截断到 [-1,1] */
  setAxis(source: string, axis: AxisAction, value: number): void;
  /** 直接写 action（触屏按钮），不经过上下文映射 */
  setButton(source: string, action: ButtonAction, down: boolean): void;
  /** 视角增量（弧度，未乘玩家灵敏度）。由 InputManager 乘灵敏度、Y 反转、lookScale */
  addLook(dx: number, dy: number): void;
  /** 滚轮像素（正 = 向下滚 = 拉远） */
  addWheel(px: number): void;
  readonly enabled: boolean;
  readonly cursorMode: CursorMode;
  readonly context: InputContextName;
}

export interface InputSource {
  dispose(): void;
  reset?(): void;
}

/** 按下事件的缓冲时长：固定步长某帧可能执行 0 次，避免「按了没反应」 */
const PRESS_BUFFER_S = 0.15;
/** 调试面板保留最近多少条 action */
const RECENT_MAX = 8;

export interface InputDebugEntry {
  t: number;
  context: InputContextName;
  action: ButtonAction;
  code: string;
}

/**
 * 输入管理（纯逻辑，不直接碰 DOM，Node 校验脚本可直接导入）：
 * - 原始按键 → 按输入上下文栈顶映射成 action（见 actions.ts）
 * - 查询：getMove / isDown / consumePressed / getLookDelta / getZoomDelta / getHoldProgress
 * - 上下文：pushContext / popContext；暂停时自动压入 menu
 * - 玩家设置：setLookSensitivity（0.1–3.0）/ setInvertY，立即生效；lookScale 供观察模式等临时缩放
 */
export class InputManager implements InputSink {
  private rawHeld = new Map<string, Set<string>>();
  private directAxes = new Map<string, number>();
  private directHeld = new Map<ButtonAction, Set<string>>();
  private pressed = new Map<ButtonAction, number>();
  private holdStart = new Map<ButtonAction, { t: number; fired: boolean }>();
  private look = { x: 0, y: 0 };
  private zoom = 0;
  private sources: InputSource[] = [];
  private _enabled = true;
  private now = 0;
  private offs: Array<() => void> = [];
  private popMenu: (() => void) | null = null;
  private contexts: InputContextStack;
  private clock: () => number;

  /** 玩家设置：鼠标灵敏度倍数（0.1–3.0，默认 1） */
  lookSensitivity = 1;
  invertY = false;
  /** 临时视角缩放（观察模式 ×0.5 等），由相机设置 */
  lookScale = 1;
  /** 最近触发的 action（调试面板用） */
  readonly recent: InputDebugEntry[] = [];
  /** 控制台打印每个 action（开发调试：__game.input.debug = true） */
  debug = false;
  /** 上下文切换回调（KeyboardMouseInput 用来切换指针锁定） */
  onContextChange: ((cur: InputContextName, prev: InputContextName) => void) | null = null;

  constructor(events?: EventBus, clock: () => number = () => performance.now() / 1000) {
    this.clock = clock;
    this.now = clock();
    this.contexts = new InputContextStack((cur, prev) => {
      // 切换上下文：清掉未消费的按下和按住计时，避免 explore 里的 E 漏到 puzzle 变成 partNext
      this.pressed.clear();
      this.holdStart.clear();
      this.look.x = this.look.y = 0;
      this.zoom = 0;
      this.onContextChange?.(cur, prev);
    });
    if (events) {
      // 暂停：压入 menu 上下文（只剩全局键）；继续：弹出
      this.offs.push(
        events.on('game:pause', () => {
          this.popMenu?.();
          this.popMenu = this.pushContext('menu');
          this.enabled = false;
        }),
        events.on('game:resume', () => {
          this.popMenu?.();
          this.popMenu = null;
          this.enabled = true;
        }),
      );
    }
  }

  attach(source: InputSource): void {
    this.sources.push(source);
  }

  // ---------------------------------------------------------------- 上下文

  get context(): InputContextName {
    return this.contexts.current;
  }

  get contextStack(): InputContextName[] {
    return this.contexts.names;
  }

  get cursorMode(): CursorMode {
    return CONTEXTS[this.context].cursor;
  }

  /** 压入上下文，返回只弹出这一层的函数 */
  pushContext(name: InputContextName): () => void {
    return this.contexts.push(name);
  }

  /** 弹出栈顶（或指定名字的最上层） */
  popContext(name?: InputContextName): boolean {
    return this.contexts.pop(name);
  }

  // ---------------------------------------------------------------- 设置

  setLookSensitivity(v: number): void {
    this.lookSensitivity = Math.min(3, Math.max(0.1, Number.isFinite(v) ? v : 1));
  }

  setInvertY(v: boolean): void {
    this.invertY = v;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** 关闭时只保留全局键（暂停、F3、F4） */
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) {
      this.directAxes.clear();
      for (const set of this.directHeld.values()) set.clear();
      this.look.x = this.look.y = 0;
      this.zoom = 0;
      for (const s of this.sources) s.reset?.();
    }
  }

  // ---------------------------------------------------------------- InputSink

  setRaw(source: string, code: string, down: boolean): void {
    let set = this.rawHeld.get(code);
    if (!set) {
      set = new Set();
      this.rawHeld.set(code, set);
    }
    const wasDown = set.size > 0;
    if (down) set.add(source);
    else set.delete(source);
    if (!down || wasDown) {
      if (!down && set.size === 0) {
        for (const a of actionsForCode(this.context, code)) if (HOLD_SECONDS[a]) this.holdStart.delete(a);
      }
      return;
    }
    for (const action of actionsForCode(this.context, code)) {
      if (!this.actionAllowed(action)) continue;
      if (HOLD_SECONDS[action]) {
        this.holdStart.set(action, { t: this.clock(), fired: false });
      } else {
        this.markPressed(action, code);
      }
    }
  }

  setAxis(source: string, axis: AxisAction, value: number): void {
    this.directAxes.set(`${source}:${axis}`, value);
  }

  setButton(source: string, action: ButtonAction, down: boolean): void {
    let set = this.directHeld.get(action);
    if (!set) {
      set = new Set();
      this.directHeld.set(action, set);
    }
    const wasDown = set.size > 0;
    if (down) set.add(source);
    else set.delete(source);
    if (down && !wasDown && this.actionAllowed(action)) this.markPressed(action, source);
  }

  addLook(dx: number, dy: number): void {
    if (!this._enabled || !CONTEXTS[this.context].look) return;
    const s = this.lookSensitivity * this.lookScale;
    this.look.x += dx * s;
    this.look.y += dy * s * (this.invertY ? -1 : 1);
  }

  addWheel(px: number): void {
    if (!this._enabled || CONTEXTS[this.context].wheel !== 'zoom') return;
    this.zoom += px;
  }

  // ---------------------------------------------------------------- 查询（玩法代码用）

  getAxis(axis: AxisAction): number {
    if (!this._enabled || !CONTEXTS[this.context].axes) return 0;
    let v = 0;
    for (const [key, val] of this.directAxes) if (key.endsWith(`:${axis}`)) v += val;
    const b = axisBindings[axis];
    if (b.positive.some((c) => this.rawDown(c))) v += 1;
    if (b.negative.some((c) => this.rawDown(c))) v -= 1;
    return Math.max(-1, Math.min(1, v));
  }

  /** 移动向量，长度 ≤ 1（斜向不加速） */
  getMove(): { x: number; y: number } {
    const x = this.getAxis('moveX');
    const y = this.getAxis('moveY');
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** 当前上下文下该 action 是否按住（按住型 action 如 skipHold 返回原始按住状态，进度见 getHoldProgress） */
  isDown(action: ButtonAction): boolean {
    if (!this.actionAllowed(action)) return false;
    if ((this.directHeld.get(action)?.size ?? 0) > 0) return true;
    return codesForAction(this.context, action).some((c) => this.rawDown(c));
  }

  /** 读取并消费一次「按下」（带 0.15s 缓冲）。按住型 action 在按满时长时产生一次 */
  consumePressed(action: ButtonAction): boolean {
    if (!this.actionAllowed(action)) return false;
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  /** 只看不消费 */
  peekPressed(action: ButtonAction): boolean {
    return this.actionAllowed(action) && this.pressed.has(action);
  }

  /** 按住型 action 的进度 0–1（如跳过演出的进度圈） */
  getHoldProgress(action: ButtonAction): number {
    const h = this.holdStart.get(action);
    const need = HOLD_SECONDS[action];
    if (!h || !need) return 0;
    return Math.min(1, (this.now - h.t) / need);
  }

  /** 本帧视角增量（弧度，已乘灵敏度 / Y 反转 / lookScale）。update 中读取，endFrame 清零 */
  getLookDelta(): { x: number; y: number } {
    return this.look;
  }

  /** 本帧滚轮（格，正 = 拉远）。只在 explore（wheel: 'zoom'）里有值 */
  getZoomDelta(): number {
    return this.zoom / 100;
  }

  // ---------------------------------------------------------------- 主循环钩子

  beginFrame(): void {
    this.now = this.clock();
    for (const [action, h] of this.holdStart) {
      const need = HOLD_SECONDS[action] ?? 0;
      if (!h.fired && this.now - h.t >= need) {
        h.fired = true;
        this.markPressed(action, 'hold');
      }
    }
  }

  endFrame(): void {
    this.look.x = this.look.y = 0;
    this.zoom = 0;
    for (const [action, t] of this.pressed) {
      if (this.now - t > PRESS_BUFFER_S) this.pressed.delete(action);
    }
  }

  /** 失焦等情况：清掉所有按住状态 */
  releaseAll(source?: string): void {
    for (const set of this.rawHeld.values()) {
      if (source) set.delete(source);
      else set.clear();
    }
    this.holdStart.clear();
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    for (const off of this.offs) off();
    this.sources = [];
  }

  // ---------------------------------------------------------------- 内部

  private rawDown(code: string): boolean {
    return (this.rawHeld.get(code)?.size ?? 0) > 0;
  }

  /** 关闭（暂停）时只允许全局 action */
  private actionAllowed(action: ButtonAction): boolean {
    return this._enabled || action === 'pause' || action === 'toggleFps' || action === 'toggleDebug';
  }

  private markPressed(action: ButtonAction, code: string): void {
    this.now = Math.max(this.now, this.clock());
    this.pressed.set(action, this.now);
    const entry = { t: this.now, context: this.context, action, code };
    this.recent.unshift(entry);
    if (this.recent.length > RECENT_MAX) this.recent.length = RECENT_MAX;
    if (this.debug) console.info(`[input] ${entry.context}: ${action} (${code})`);
  }
}
