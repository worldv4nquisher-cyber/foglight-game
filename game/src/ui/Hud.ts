import type { InteractionHud } from '@/systems/interaction/InteractionSystem';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;
const MARKER_POOL = 8;

/**
 * HUD：地点标题、操作提示、交互提示、右下角小字。由场景控制显隐。
 * v0.1-004：交互小图标（3.5 m 内冷色 #A9BCC4，可交互的那个变亮）、hold 圆环进度、机关模式底部按键提示条。
 */
export class Hud implements InteractionHud {
  readonly el: HTMLDivElement;
  private hint: HTMLDivElement;
  private prompt: HTMLDivElement;
  private location: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private markerEls: HTMLDivElement[] = [];
  private ring: HTMLDivElement;
  private ringArc: SVGCircleElement;
  private puzzleBar: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hud-location"></div>
      <div class="hud-prompt" hidden></div>
      <div class="hud-hint"></div>
      <div class="hud-toast" hidden></div>
      <div class="hud-markers"></div>
      <div class="hud-hold" hidden>
        <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
          <circle class="hud-hold-track" cx="18" cy="18" r="${RING_R}" />
          <circle class="hud-hold-arc" cx="18" cy="18" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}" />
        </svg>
      </div>
      <div class="hud-puzzle-bar" hidden></div>
    `;
    parent.appendChild(this.el);
    this.location = this.el.querySelector<HTMLDivElement>('.hud-location')!;
    this.prompt = this.el.querySelector<HTMLDivElement>('.hud-prompt')!;
    this.hint = this.el.querySelector<HTMLDivElement>('.hud-hint')!;
    this.toastEl = this.el.querySelector<HTMLDivElement>('.hud-toast')!;
    this.ring = this.el.querySelector<HTMLDivElement>('.hud-hold')!;
    this.ringArc = this.el.querySelector<SVGCircleElement>('.hud-hold-arc')!;
    this.puzzleBar = this.el.querySelector<HTMLDivElement>('.hud-puzzle-bar')!;
    const markers = this.el.querySelector<HTMLDivElement>('.hud-markers')!;
    for (let i = 0; i < MARKER_POOL; i++) {
      const m = document.createElement('div');
      m.className = 'hud-marker';
      m.hidden = true;
      markers.appendChild(m);
      this.markerEls.push(m);
    }
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  setLocation(text: string): void {
    this.location.textContent = text;
    this.location.classList.remove('hud-location-in');
    // 触发重排以重播淡入动画
    void this.location.offsetWidth;
    this.location.classList.add('hud-location-in');
  }

  setHint(html: string): void {
    this.hint.innerHTML = html;
  }

  /** 交互提示（如「E 点亮灯塔」），传 null 隐藏 */
  setPrompt(text: string | null): void {
    this.prompt.hidden = text === null;
    if (text !== null) this.prompt.textContent = text;
  }

  /** 交互小图标（屏幕像素坐标）；active = 可交互的那个（文字提示同时出现） */
  setMarkers(markers: ReadonlyArray<{ x: number; y: number; active: boolean }>): void {
    this.markerEls.forEach((el, i) => {
      const m = markers[i];
      if (!m) {
        if (!el.hidden) el.hidden = true;
        return;
      }
      el.hidden = false;
      el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      el.classList.toggle('active', m.active);
    });
  }

  /** 当前显示的图标数（测试用） */
  get markerCount(): number {
    return this.markerEls.filter((e) => !e.hidden).length;
  }

  /** hold 圆环（0–1），null 隐藏 */
  setHoldProgress(progress: number | null): void {
    this.ring.hidden = progress === null;
    const p = Math.max(0, Math.min(1, progress ?? 0));
    this.ringArc.setAttribute('stroke-dashoffset', (RING_C * (1 - p)).toFixed(2));
    this.ring.dataset.progress = p.toFixed(3);
    this.ring.classList.toggle('full', p >= 1);
  }

  /** 机关模式底部按键提示条，null 隐藏 */
  setPuzzleBar(text: string | null): void {
    this.puzzleBar.hidden = text === null;
    if (text !== null) this.puzzleBar.textContent = text;
  }

  /** 右下角小字（「已保存」2.5s 等，text-ch1.md ui.save.*） */
  toast(text: string, seconds = 2.5): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), seconds * 1000);
  }

  dispose(): void {
    window.clearTimeout(this.toastTimer);
    this.el.remove();
  }
}
