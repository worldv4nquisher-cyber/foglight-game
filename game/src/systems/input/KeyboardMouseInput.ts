import { gameConfig } from '@/config/gameConfig';
import { device } from '@/platform/device';
import { axisBindings, keyBindings, type AxisAction, type ButtonAction } from './actions';
import type { InputSink, InputSource } from './InputManager';

const SRC = 'kbm';

/**
 * 键鼠输入：
 * - WASD / 方向键移动，空格跳跃，Esc/P 暂停，F3 FPS
 * - 点击画布进入指针锁定转视角；不支持/被拒绝时按住鼠标拖拽转视角
 */
export class KeyboardMouseInput implements InputSource {
  private keys = new Set<string>();
  private dragging = false;
  private lastLockChange = 0;
  private lastEscDown = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sink: InputSink,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    canvas.addEventListener('contextmenu', this.preventDefault);
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestPointerLock(): void {
    if (!gameConfig.input.pointerLock || !device.supportsPointerLock || device.isTouch || this.isLocked) return;
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

  private findButton(code: string): ButtonAction | undefined {
    for (const [action, codes] of Object.entries(keyBindings) as Array<[ButtonAction, readonly string[]]>) {
      if (codes.includes(code)) return action;
    }
    return undefined;
  }

  private updateAxes(): void {
    for (const [axis, b] of Object.entries(axisBindings) as Array<[AxisAction, (typeof axisBindings)[AxisAction]]>) {
      const pos = b.positive.some((c) => this.keys.has(c)) ? 1 : 0;
      const neg = b.negative.some((c) => this.keys.has(c)) ? 1 : 0;
      this.sink.setAxis(SRC, axis, pos - neg);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const action = this.findButton(e.code);
    if (action || this.isMoveKey(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.lastEscDown = performance.now();
      // 退出指针锁定时浏览器已经触发了暂停，避免重复切换
      if (performance.now() - this.lastLockChange < 250) return;
    }
    this.keys.add(e.code);
    this.updateAxes();
    if (action) this.sink.setButton(SRC, action, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    this.updateAxes();
    const action = this.findButton(e.code);
    if (action) this.sink.setButton(SRC, action, false);
  };

  private isMoveKey(code: string): boolean {
    return Object.values(axisBindings).some((b) => b.positive.includes(code) || b.negative.includes(code));
  }

  private onBlur = (): void => {
    for (const code of this.keys) {
      const action = this.findButton(code);
      if (action) this.sink.setButton(SRC, action, false);
    }
    this.keys.clear();
    this.updateAxes();
    this.dragging = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || !this.sink.enabled) return;
    this.requestPointerLock();
    this.dragging = true;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    if (!this.isLocked && !this.dragging) return;
    const s = gameConfig.camera.mouseSensitivity;
    this.sink.addLook(e.movementX * s, e.movementY * s);
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private onLockChange = (): void => {
    this.lastLockChange = performance.now();
    // 玩家按 Esc 退出指针锁定 → 视为暂停请求
    if (!this.isLocked && this.sink.enabled && performance.now() - this.lastEscDown > 250) {
      this.sink.setButton(SRC, 'pause', true);
      this.sink.setButton(SRC, 'pause', false);
    }
  };

  private preventDefault = (e: Event): void => e.preventDefault();

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.canvas.removeEventListener('contextmenu', this.preventDefault);
    this.exitPointerLock();
  }
}
