import { gameConfig } from '@/config/gameConfig';
import type { InputSink, InputSource } from './InputManager';

const SRC = 'touch';
const JOYSTICK_RADIUS = 56;
const DEAD_ZONE = 0.12;

/**
 * 触屏输入：左半屏浮动虚拟摇杆（在手指按下处出现），右半屏滑动转视角，右下角交互按钮。
 * v0.1 起桌面优先（制作人裁定），默认不注册触屏输入；保留实现供以后移动端使用。
 * 使用 Pointer Events + touch-action:none，兼容 iOS Safari 13+ / Android Chrome。
 */
export class TouchInput implements InputSource {
  private root: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private actBtn: HTMLButtonElement;
  private moveId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };

  constructor(
    uiRoot: HTMLElement,
    private sink: InputSink,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-zone touch-zone-left"></div>
      <div class="touch-zone touch-zone-right"></div>
      <div class="joystick-base"><div class="joystick-knob"></div></div>
      <button class="touch-btn touch-btn-interact" type="button" aria-label="交互">交互</button>
    `;
    uiRoot.appendChild(this.root);
    this.stickBase = this.root.querySelector<HTMLDivElement>('.joystick-base')!;
    this.stickKnob = this.root.querySelector<HTMLDivElement>('.joystick-knob')!;
    this.actBtn = this.root.querySelector<HTMLButtonElement>('.touch-btn-interact')!;

    const left = this.root.querySelector<HTMLDivElement>('.touch-zone-left')!;
    const right = this.root.querySelector<HTMLDivElement>('.touch-zone-right')!;
    left.addEventListener('pointerdown', this.onMoveStart);
    right.addEventListener('pointerdown', this.onLookStart);
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerEnd);
    window.addEventListener('pointercancel', this.onPointerEnd);
    this.actBtn.addEventListener('pointerdown', this.onActDown);
    this.actBtn.addEventListener('pointerup', this.onActUp);
    this.actBtn.addEventListener('pointercancel', this.onActUp);
    this.actBtn.addEventListener('pointerleave', this.onActUp);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  reset(): void {
    this.moveId = null;
    this.lookId = null;
    this.sink.setAxis(SRC, 'moveX', 0);
    this.sink.setAxis(SRC, 'moveY', 0);
    this.sink.setButton(SRC, 'interact', false);
    this.stickBase.classList.remove('active');
  }

  private onMoveStart = (e: PointerEvent): void => {
    if (this.moveId !== null || !this.sink.enabled) return;
    e.preventDefault();
    this.moveId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.stickBase.style.left = `${e.clientX}px`;
    this.stickBase.style.top = `${e.clientY}px`;
    this.stickKnob.style.transform = 'translate(-50%, -50%)';
    this.stickBase.classList.add('active');
  };

  private onLookStart = (e: PointerEvent): void => {
    if (this.lookId !== null || !this.sink.enabled) return;
    e.preventDefault();
    this.lookId = e.pointerId;
    this.lastLook = { x: e.clientX, y: e.clientY };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.moveId) {
      e.preventDefault();
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        dx = (dx / len) * JOYSTICK_RADIUS;
        dy = (dy / len) * JOYSTICK_RADIUS;
      }
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      let nx = dx / JOYSTICK_RADIUS;
      let ny = -dy / JOYSTICK_RADIUS;
      const mag = Math.hypot(nx, ny);
      if (mag < DEAD_ZONE) nx = ny = 0;
      this.sink.setAxis(SRC, 'moveX', nx);
      this.sink.setAxis(SRC, 'moveY', ny);
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      const s = gameConfig.camera.touchSensitivity;
      this.sink.addLook((e.clientX - this.lastLook.x) * s, (e.clientY - this.lastLook.y) * s);
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  };

  private onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.sink.setAxis(SRC, 'moveX', 0);
      this.sink.setAxis(SRC, 'moveY', 0);
      this.stickBase.classList.remove('active');
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  };

  private onActDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.actBtn.classList.add('pressed');
    this.sink.setButton(SRC, 'interact', true);
  };

  private onActUp = (): void => {
    this.actBtn.classList.remove('pressed');
    this.sink.setButton(SRC, 'interact', false);
  };

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerEnd);
    window.removeEventListener('pointercancel', this.onPointerEnd);
    this.root.remove();
  }
}
