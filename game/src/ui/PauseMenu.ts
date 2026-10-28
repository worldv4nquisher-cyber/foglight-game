import type { Game } from '@/core/Game';
import { QUALITY_PRESETS, QualityManager, type QualityTier } from '@/config/quality';
import { isFullscreenSupported, toggleFullscreen } from '@/platform/fullscreen';

/**
 * Esc 暂停菜单：继续、画质档位、鼠标灵敏度、Y 轴反转、FPS 显示、全屏、静音。
 * 设置项写进 game.settings（立即生效、刷新后保留）；完整设置界面见 v0.1-008。
 */
export class PauseMenu {
  readonly el: HTMLDivElement;
  private qualityButtons = new Map<QualityTier, HTMLButtonElement>();
  private fpsBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private sensInput: HTMLInputElement;
  private sensValue: HTMLSpanElement;
  private invertBtn: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private game: Game,
    private onToggleFps: () => boolean,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pause-menu';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="pause-panel" role="dialog" aria-label="暂停菜单">
        <h2>暂停</h2>
        <button type="button" class="menu-btn primary" data-act="resume">继续</button>
        <div class="menu-row">
          <span>画质</span>
          <div class="seg" data-role="quality"></div>
        </div>
        <div class="menu-row"><span>鼠标灵敏度</span><span class="menu-range"><input type="range" min="0.1" max="3" step="0.1" data-act="sens" aria-label="鼠标灵敏度"><span data-role="sens-value"></span></span></div>
        <div class="menu-row"><span>Y 轴反转</span><button type="button" class="menu-btn small" data-act="invert"></button></div>
        <div class="menu-row"><span>帧率显示</span><button type="button" class="menu-btn small" data-act="fps"></button></div>
        <div class="menu-row"><span>声音</span><button type="button" class="menu-btn small" data-act="mute"></button></div>
        <button type="button" class="menu-btn" data-act="fullscreen">全屏切换</button>
        <p class="menu-foot"></p>
      </div>
    `;
    parent.appendChild(this.el);

    const seg = this.el.querySelector<HTMLDivElement>('[data-role="quality"]')!;
    for (const tier of QualityManager.tiers) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.textContent = QUALITY_PRESETS[tier].label;
      b.addEventListener('click', () => {
        this.game.quality.set(tier);
        this.refresh();
      });
      seg.appendChild(b);
      this.qualityButtons.set(tier, b);
    }
    this.fpsBtn = this.el.querySelector<HTMLButtonElement>('[data-act="fps"]')!;
    this.muteBtn = this.el.querySelector<HTMLButtonElement>('[data-act="mute"]')!;
    const fsBtn = this.el.querySelector<HTMLButtonElement>('[data-act="fullscreen"]')!;
    this.sensInput = this.el.querySelector<HTMLInputElement>('[data-act="sens"]')!;
    this.sensValue = this.el.querySelector<HTMLSpanElement>('[data-role="sens-value"]')!;
    this.invertBtn = this.el.querySelector<HTMLButtonElement>('[data-act="invert"]')!;
    this.sensInput.addEventListener('input', () => {
      this.game.settings.set('mouseSensitivity', Number(this.sensInput.value));
      this.refresh();
    });
    this.invertBtn.addEventListener('click', () => {
      this.game.settings.set('invertY', !this.game.settings.get('invertY'));
      this.refresh();
    });
    fsBtn.hidden = !isFullscreenSupported();

    this.el.querySelector('[data-act="resume"]')!.addEventListener('click', () => this.game.resume());
    this.fpsBtn.addEventListener('click', () => {
      this.onToggleFps();
      this.refresh();
    });
    this.muteBtn.addEventListener('click', () => {
      this.game.audio.setMuted(!this.game.audio.muted);
      this.refresh();
    });
    fsBtn.addEventListener('click', () => void toggleFullscreen());
  }

  show(): void {
    this.refresh();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private refresh(): void {
    const q = this.game.quality;
    for (const [tier, b] of this.qualityButtons) b.classList.toggle('active', tier === q.tier);
    this.fpsBtn.textContent = this.game.ui.fps.visible ? '开' : '关';
    this.muteBtn.textContent = this.game.audio.muted ? '静音' : '开';
    const sens = this.game.settings.get('mouseSensitivity');
    this.sensInput.value = String(sens);
    this.sensValue.textContent = sens.toFixed(1);
    this.invertBtn.textContent = this.game.settings.get('invertY') ? '开' : '关';
    const notice = this.game.save.writable ? '' : ' · 进度不会保存';
    this.el.querySelector('.menu-foot')!.textContent =
      `自动推荐：${QUALITY_PRESETS[q.auto].label} · GPU：${q.gpu} · Esc 继续${notice}`;
  }

  dispose(): void {
    this.el.remove();
  }
}
