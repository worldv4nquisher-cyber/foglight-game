import { gameConfig } from '@/config/gameConfig';
import { device } from '@/platform/device';
import { onFullscreenChange } from '@/platform/fullscreen';
import { allBoundCodes, lockClickPassesThrough, WHEEL_NOTCH_PX, type InputContextName } from './actions';
import type { InputSink, InputSource } from './InputManager';

const SRC = 'kbm';
/** 浏览器 Esc 退出指针锁定时，keydown 与 pointerlockchange 的先后不定，这个窗口内只算一次暂停 */
const ESC_DEDUPE_MS = 250;
/** BUG-038：锁定被拒后，回退拖拽期间每次点画面最多隔这么久再试一次锁定（环境恢复 / Esc 后冷却期过了就能重新锁上） */
const LOCK_RETRY_MS = 1500;

/**
 * 键鼠输入源：只把原始按键（KeyboardEvent.code / Mouse0-2 / WheelUp/Down）、鼠标移动、滚轮写进 InputManager，
 * 按键 → action 的映射由 InputManager 按当前输入上下文决定。
 *
 * 指针锁定（gameConfig.input.pointerLock，默认开）：
 * - 点击画面进入锁定，锁定后鼠标移动直接转视角；第一下用于锁定的点击不会触发 advance 等 action，
 *   但绑定了 exitPuzzle 的键（机关里的右键）会同时执行退出（v0.1-004 制作人裁定）。
 * - 锁定被浏览器解除（玩家按 Esc）→ 发出一次 pause（只算一次，见 ESC_DEDUPE_MS）。
 * - 上下文切到 cursor:'free'（阅读、菜单）时主动解锁，不算暂停；切回 locked 上下文后再点一下画面重新锁定
 *   （浏览器要求重新锁定必须由用户点击触发，Esc 解锁后约 1 秒内也不能重新锁定）。
 * - 拖拽回退：按住鼠标左键拖拽转视角（探索视角和机关转镜同一路 look 增量）。两种情况进入：
 *   ① 不支持指针锁定（没有 Pointer Lock API / 触屏设备 / 配置关闭），始终拖拽；
 *   ② BUG-038：由点击发起的锁定请求被拒——requestPointerLock 同步抛错、返回的 Promise reject、或收到 pointerlockerror
 *     （iframe 没给 allow-pointer-lock、浏览器策略、Esc 解锁后冷却期内再点等）。被拒那一下左键若还按着，立即开始拖拽；
 *     之后点击照常当游戏输入（不再被「锁定点击」吞掉），并每隔 LOCK_RETRY_MS 顺带再试一次锁定，锁上后回到锁定模式。
 *   非点击发起的请求（切回 locked 上下文时的自动重锁，没有用户手势，被拒是正常的）不算被拒。
 */
export class KeyboardMouseInput implements InputSource {
  private keys = new Set<string>();
  private dragging = false;
  /** BUG-038：最近一次点击发起的锁定请求被拒，处于拖拽回退（锁定成功后清掉） */
  private lockDenied = false;
  private lastDeniedAt = Number.NEGATIVE_INFINITY;
  /** 有一个点击发起的锁定请求在等结果（pointerlockerror 没带是哪次请求，用它归属） */
  private pendingClickLock = false;
  /** 发起锁定的那下左键还按着（被拒时据此立即开始拖拽） */
  private lockClickHeld = false;
  private lastLockChange = 0;
  /** 上一次 pointerlockchange 时是否处于锁定（没锁过的「解锁」事件不当作 Esc） */
  private wasLocked = false;
  private lastEscDown = 0;
  /** 上一次替玩家补发 Esc 的时间（指针锁定被解除 / 全屏被 Esc 退出，两者先后不定，只补一次） */
  private lastSynthEsc = 0;
  private offFullscreen: () => void;
  private intentionalUnlock = false;
  private wheelAccum = 0;
  private bound = allBoundCodes();
  private canvas: HTMLCanvasElement;
  private sink: InputSink;

  constructor(canvas: HTMLCanvasElement, sink: InputSink) {
    this.canvas = canvas;
    this.sink = sink;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    window.addEventListener('contextmenu', this.onContextMenu);
    this.offFullscreen = onFullscreenChange(this.onFullscreenChange);
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** 环境支持并且配置要指针锁定（不看是否被拒过） */
  private get lockWanted(): boolean {
    return gameConfig.input.pointerLock && device.supportsPointerLock && !device.isTouch;
  }

  /** 当前用左键拖拽转视角：不支持锁定，或点击发起的锁定被拒（BUG-038） */
  get dragFallback(): boolean {
    return !this.lockWanted || this.lockDenied;
  }

  /**
   * 请求指针锁定。fromClick = 由玩家点击画面发起（有用户手势）：只有这种请求被拒才回退拖拽；
   * 被拒的三种形式都要接住：同步抛错（老浏览器 / iframe 无权限）、Promise reject（Chrome 等新实现）、pointerlockerror 事件（不返回 Promise 的实现）。
   */
  requestPointerLock(fromClick = false): void {
    if (!this.lockWanted || this.isLocked) return;
    // pointerlockerror 归属给最近一次请求：非点击请求覆盖掉，避免把自动重锁的失败算成被拒
    this.pendingClickLock = fromClick;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => this.onLockDenied(fromClick));
    } catch {
      this.onLockDenied(fromClick);
    }
  }

  private onLockDenied(fromClick: boolean): void {
    if (!fromClick || this.isLocked) return;
    this.pendingClickLock = false;
    this.lockDenied = true;
    this.lastDeniedAt = performance.now();
    // 发起锁定的那下左键还按着：直接开始拖拽，不用松开再按
    if (this.lockClickHeld && this.sink.enabled && this.sink.cursorMode === 'locked') this.dragging = true;
  }

  private onLockError = (): void => {
    if (this.pendingClickLock) this.onLockDenied(true);
  };

  exitPointerLock(): void {
    if (this.isLocked) document.exitPointerLock();
  }

  /** InputManager 上下文切换时调用：free 上下文主动解锁（不触发暂停） */
  onContextChange(_cur: InputContextName): void {
    if (this.sink.cursorMode === 'free' && this.isLocked) {
      this.intentionalUnlock = true;
      document.exitPointerLock();
    } else if (this.sink.cursorMode === 'locked' && this.sink.enabled) {
      // 回到需要锁定的上下文（如关闭阅读）：若本次切换由用户按键/点击触发，浏览器允许直接重新锁定；
      // 不允许（Esc 解锁后 1 秒内、没有用户手势等）时静默失败——非点击发起，不算被拒、不进拖拽回退（BUG-038），玩家再点一下画面即可
      this.requestPointerLock();
    }
    this.dragging = false;
  }

  reset(): void {
    this.dragging = false;
  }

  // ---------------------------------------------------------------- 键盘

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.bound.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.lastEscDown = performance.now();
      // 浏览器刚因为 Esc 解除了指针锁定（已经发过暂停），这次 keydown 不再重复切换
      if (performance.now() - this.lastLockChange < ESC_DEDUPE_MS) return;
    }
    this.keys.add(e.code);
    this.sink.setRaw(SRC, e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (!this.keys.delete(e.code)) return;
    this.sink.setRaw(SRC, e.code, false);
  };

  private onBlur = (): void => {
    for (const code of this.keys) this.sink.setRaw(SRC, code, false);
    this.keys.clear();
    this.dragging = false;
    this.lockClickHeld = false;
  };

  // ---------------------------------------------------------------- 鼠标

  /** 点在 UI 控件上（按钮、输入框、标了 data-ui 的面板）的左键交给 DOM，不当成游戏输入 */
  private isUiTarget(t: EventTarget | null): boolean {
    return t instanceof Element && t !== this.canvas && Boolean(t.closest('button, a, input, select, textarea, [data-ui]'));
  }

  /** 点在游戏画面上：画布本身，或叠在画布上的非控件层（HUD 文字、淡出中的加载层等） */
  private isGameSurface(t: EventTarget | null): boolean {
    if (t === this.canvas) return true;
    const host = this.canvas.parentElement;
    return t instanceof Node && host !== null && host.contains(t) && !this.isUiTarget(t);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    const code = `Mouse${e.button}`;
    if (e.button === 0 && this.isUiTarget(e.target)) return;
    // 点击画面进入指针锁定：这一下一般只用来锁定，不触发 action；
    // 例外：绑定了「退出」的键（机关里的右键）同时执行退出（制作人裁定，见 lockClickPassesThrough）
    if (
      this.isGameSurface(e.target) &&
      this.sink.enabled &&
      this.sink.cursorMode === 'locked' &&
      this.lockWanted &&
      !this.isLocked
    ) {
      if (!this.lockDenied) {
        if (e.button === 0) this.lockClickHeld = true;
        this.requestPointerLock(true);
        // 同步抛错时 lockDenied 已经置上：这一下直接按拖拽回退处理
        if (!this.lockDenied && !lockClickPassesThrough(this.sink.context, code)) return;
      } else if (performance.now() - this.lastDeniedAt > LOCK_RETRY_MS) {
        // 拖拽回退中：顺带再试一次锁定（这一下仍照常当游戏输入 / 开始拖拽）
        this.requestPointerLock(true);
      }
    }
    // 拖拽回退（不支持锁定 / 锁定被拒）：左键拖拽转视角
    if (e.button === 0 && this.isGameSurface(e.target) && this.dragFallback) this.dragging = true;
    this.keys.add(code);
    this.sink.setRaw(SRC, code, true);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    if (!this.isLocked && !this.dragging) return;
    const s = gameConfig.camera.mouseSensitivity;
    this.sink.addLook(e.movementX * s, e.movementY * s);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    if (e.button === 0) {
      this.dragging = false;
      this.lockClickHeld = false;
    }
    const code = `Mouse${e.button}`;
    if (this.keys.delete(code)) this.sink.setRaw(SRC, code, false);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    this.sink.addWheel(px);
    // 机关模式：每滚一格 = 一次 WheelUp / WheelDown（切换部件）
    this.wheelAccum += px;
    while (Math.abs(this.wheelAccum) >= WHEEL_NOTCH_PX) {
      const code = this.wheelAccum > 0 ? 'WheelDown' : 'WheelUp';
      this.wheelAccum -= Math.sign(this.wheelAccum) * WHEEL_NOTCH_PX;
      this.sink.setRaw(SRC, code, true);
      this.sink.setRaw(SRC, code, false);
    }
  };

  private onLockChange = (): void => {
    this.lastLockChange = performance.now();
    const wasLocked = this.wasLocked;
    this.wasLocked = this.isLocked;
    if (this.isLocked) {
      // 锁上了：退出拖拽回退（BUG-038）
      this.lockDenied = false;
      this.pendingClickLock = false;
      this.lockClickHeld = false;
      this.dragging = false;
      // 锁定请求还没批下来时已经切到了要光标的界面（如右键关阅读后立刻按 J 开日志）：批下来后马上主动解锁，
      // 否则光标被锁在日志 / 菜单里，之后的解锁还会被当成玩家按 Esc 而误暂停
      if (this.sink.cursorMode === 'free') {
        this.intentionalUnlock = true;
        document.exitPointerLock();
      }
      return;
    }
    if (this.intentionalUnlock) {
      this.intentionalUnlock = false;
      return;
    }
    // 之前根本没锁上（进场时流程放开菜单上下文自动请求锁定、浏览器没批 / 立刻撤回）：不是玩家按 Esc，不暂停（v0.1-008）
    if (!wasLocked) return;
    // 玩家按 Esc 让浏览器解除了锁定 → 暂停（如果 Esc keydown 也到了页面，已经暂停过，不重复）
    if (this.sink.enabled && performance.now() - this.lastEscDown > ESC_DEDUPE_MS && performance.now() - this.lastSynthEsc > ESC_DEDUPE_MS) {
      this.synthEsc();
    }
  };

  private synthEsc(): void {
    this.lastSynthEsc = performance.now();
    this.sink.setRaw(SRC, 'Escape', true);
    this.sink.setRaw(SRC, 'Escape', false);
  }

  /**
   * batch26 ④：全屏被退出。浏览器把用来退全屏的 Esc 吞掉、页面收不到 keydown：
   * 游玩中（光标锁定类上下文）且当时没有指针锁定（拖拽回退 / 还没点画面锁定）时补发一次 Esc → 暂停，和锁定时按 Esc 一致；
   * 锁着的情况交给 pointerlockchange 补发；250 ms 内已有真 Esc 或已补发过就不重复。菜单 / 暂停 / 设置里退全屏不动游戏状态。
   */
  private onFullscreenChange = (active: boolean): void => {
    if (active || this.isLocked) return;
    const now = performance.now();
    if (now - this.lastEscDown <= ESC_DEDUPE_MS || now - this.lastSynthEsc <= ESC_DEDUPE_MS) return;
    if (this.sink.enabled && this.sink.cursorMode === 'locked') this.synthEsc();
  };

  private onContextMenu = (e: Event): void => {
    // 右键是游戏操作（观察 / 退出），屏蔽浏览器菜单；输入框里保留
    if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    window.removeEventListener('contextmenu', this.onContextMenu);
    this.offFullscreen();
    this.exitPointerLock();
  }
}
