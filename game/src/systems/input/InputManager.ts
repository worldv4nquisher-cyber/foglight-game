import type { EventBus } from '@/core/EventBus';
import { device } from '@/platform/device';
import type { AxisAction, ButtonAction } from './actions';
import { KeyboardMouseInput } from './KeyboardMouseInput';
import { TouchInput } from './TouchInput';

/** 输入源写入统一状态的接口 */
export interface InputSink {
  /** 设置某个源的轴值（多个源相加后截断到 [-1,1]） */
  setAxis(source: string, axis: AxisAction, value: number): void;
  setButton(source: string, action: ButtonAction, down: boolean): void;
  /** 视角增量（弧度），本帧累加 */
  addLook(dx: number, dy: number): void;
  readonly enabled: boolean;
}

export interface InputSource {
  dispose(): void;
}

/** 按下事件的缓冲时长：固定步长某帧可能执行 0 次，避免“按了跳没反应” */
const PRESS_BUFFER_S = 0.15;

export class InputManager implements InputSink {
  private axes = new Map<string, number>();
  private held = new Map<ButtonAction, Set<string>>();
  private pressed = new Map<ButtonAction, number>();
  private look = { x: 0, y: 0 };
  private sources: InputSource[] = [];
  private _enabled = true;
  private now = 0;
  private offs: Array<() => void> = [];

  readonly keyboardMouse: KeyboardMouseInput;
  readonly touch: TouchInput | null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, events: EventBus) {
    this.keyboardMouse = new KeyboardMouseInput(canvas, this);
    this.sources.push(this.keyboardMouse);
    this.touch = device.isTouch ? new TouchInput(uiRoot, this) : null;
    if (this.touch) this.sources.push(this.touch);

    // 暂停时禁用玩法输入（pause 键仍可用）
    this.offs.push(
      events.on('game:pause', () => {
        this.enabled = false;
        this.keyboardMouse.exitPointerLock();
      }),
      events.on('game:resume', () => {
        this.enabled = true;
      }),
    );
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) {
      this.axes.clear();
      for (const [action, set] of this.held) if (action !== 'pause') set.clear();
      this.look.x = this.look.y = 0;
      this.touch?.reset();
    }
  }

  // ---- InputSink ----
  setAxis(source: string, axis: AxisAction, value: number): void {
    this.axes.set(`${source}:${axis}`, value);
  }

  setButton(source: string, action: ButtonAction, down: boolean): void {
    let set = this.held.get(action);
    if (!set) {
      set = new Set();
      this.held.set(action, set);
    }
    const wasDown = set.size > 0;
    if (down) set.add(source);
    else set.delete(source);
    if (down && !wasDown) this.pressed.set(action, this.now);
  }

  addLook(dx: number, dy: number): void {
    if (!this._enabled) return;
    this.look.x += dx;
    this.look.y += dy;
  }

  // ---- 查询 API（玩法代码使用） ----
  getAxis(axis: AxisAction): number {
    if (!this._enabled) return 0;
    let v = 0;
    for (const [key, val] of this.axes) if (key.endsWith(`:${axis}`)) v += val;
    return Math.max(-1, Math.min(1, v));
  }

  /** 移动向量，长度 ≤ 1（斜向不加速） */
  getMove(): { x: number; y: number } {
    const x = this.getAxis('moveX');
    const y = this.getAxis('moveY');
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  isDown(action: ButtonAction): boolean {
    if (!this._enabled && action !== 'pause') return false;
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  /** 读取并消费一次“按下”事件（带短暂缓冲） */
  consumePressed(action: ButtonAction): boolean {
    if (!this._enabled && action !== 'pause' && action !== 'toggleFps') return false;
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  /** 本帧视角增量（弧度）。update 中读取，endFrame 清零 */
  getLookDelta(): { x: number; y: number } {
    return this.look;
  }

  // ---- 主循环钩子 ----
  beginFrame(): void {
    this.now = performance.now() / 1000;
  }

  endFrame(): void {
    this.look.x = this.look.y = 0;
    for (const [action, t] of this.pressed) {
      if (this.now - t > PRESS_BUFFER_S) this.pressed.delete(action);
    }
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
    for (const off of this.offs) off();
    this.sources = [];
  }
}
