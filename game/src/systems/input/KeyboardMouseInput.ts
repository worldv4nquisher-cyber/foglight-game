import { gameConfig } from '@/config/gameConfig';
import { device } from '@/platform/device';
import { allBoundCodes, lockClickPassesThrough, WHEEL_NOTCH_PX, type InputContextName } from './actions';
import type { InputSink, InputSource } from './InputManager';

const SRC = 'kbm';
/** 浏览器 Esc 退出指针锁定时，keydown 与 pointerlockchange 的先后不定，这个窗口内只算一次暂停 */
const ESC_DEDUPE_MS = 250;

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
 * - 不支持指针锁定（或被拒绝）时回退：按住鼠标左键拖拽转视角。
 */
export class KeyboardMouseInput implements InputSource {
  private keys = new Set<string>();
  private dragging = false;
  private lastLockChange = 0;
  private lastEscDown = 0;
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
    window.addEventListener('contextmenu', this.onContextMenu);
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private get lockWanted(): boolean {
    return gameConfig.input.pointerLock && device.supportsPointerLock && !device.isTouch;
  }

  requestPointerLock(): void {
    if (!this.lockWanted || this.isLocked) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => undefined);
    } catch {
      /* 某些环境（iframe 无权限）会抛错，回退拖拽模式 */
    }
  }

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
      // 不允许（Esc 解锁后 1 秒内等）时静默失败，玩家再点一下画面即可
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
      this.requestPointerLock();
      if (!lockClickPassesThrough(this.sink.context, code)) return;
    }
    // 不支持指针锁定时：左键拖拽转视角
    if (e.button === 0 && this.isGameSurface(e.target) && !this.lockWanted) this.dragging = true;
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
    if (e.button === 0) this.dragging = false;
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
    if (this.isLocked) return;
    if (this.intentionalUnlock) {
      this.intentionalUnlock = false;
      return;
    }
    // 玩家按 Esc 让浏览器解除了锁定 → 暂停（如果 Esc keydown 也到了页面，已经暂停过，不重复）
    if (this.sink.enabled && performance.now() - this.lastEscDown > ESC_DEDUPE_MS) {
      this.sink.setRaw(SRC, 'Escape', true);
      this.sink.setRaw(SRC, 'Escape', false);
    }
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
    window.removeEventListener('contextmenu', this.onContextMenu);
    this.exitPointerLock();
  }
}
