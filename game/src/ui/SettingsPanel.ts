import type { Game } from '@/core/Game';
import { QualityManager, type QualityTier } from '@/config/quality';
import { isFullscreenSupported, toggleFullscreen } from '@/platform/fullscreen';
import { t, type TextId } from '@/content/text';
import type { SubtitleSize } from '@/systems/save/Settings';

export const QUALITY_LABELS: Record<QualityTier, TextId> = {
  ultra: 'ui.settings.quality_ultra',
  high: 'ui.settings.quality_high',
  standard: 'ui.settings.quality_standard',
  low: 'ui.settings.quality_low',
};

const SUBTITLE_SIZE_LABELS: Record<SubtitleSize, TextId> = {
  s: 'ui.settings.subtitle_small',
  m: 'ui.settings.subtitle_medium',
  l: 'ui.settings.subtitle_large',
};

type VolumeKey = 'masterVolume' | 'musicVolume' | 'sfxVolume';
type ToggleKey = 'invertY' | 'autoRecenter';

/**
 * 设置界面（v0.1-008，主菜单和暂停菜单共用一个实例）：画质三档、鼠标灵敏度、Y 轴反转、主音量 / 音乐 / 音效、
 * 字幕大小、镜头自动回正、显示帧率、全屏、恢复默认、返回。
 * 每一项直接写 game.settings（006：立即写盘、订阅者立即生效，刷新后保留）；设置从别处改变（恢复默认、F3）时界面跟着刷新。
 * 按 GDD §10 / §15 不做：点击寻路开关、分辨率缩放滑条、自定义按键。
 * mount(host) 把面板挂到调用方的容器里（主菜单 / 暂停菜单各自的遮罩层），返回时 onBack。
 */
export class SettingsPanel {
  readonly el: HTMLDivElement;
  onBack: (() => void) | null = null;
  private qualityButtons = new Map<QualityTier, HTMLButtonElement>();
  private subtitleButtons = new Map<SubtitleSize, HTMLButtonElement>();
  private ranges = new Map<'mouseSensitivity' | VolumeKey, { input: HTMLInputElement; value: HTMLSpanElement }>();
  private toggles = new Map<ToggleKey | 'showFps', HTMLButtonElement>();
  private offs: Array<() => void> = [];
  private fsBtn: HTMLButtonElement | null = null;

  constructor(private game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'ui-panel settings-panel';
    this.el.dataset.ui = '';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', t('ui.settings.title'));

    const h = document.createElement('h2');
    h.className = 'ui-heading';
    h.textContent = t('ui.settings.title');
    this.el.appendChild(h);

    // 画质
    const qSeg = this.row('ui.settings.quality', this.seg('quality'));
    for (const tier of QualityManager.tiers) {
      const b = this.segBtn(qSeg, t(QUALITY_LABELS[tier]), () => this.game.quality.set(tier));
      b.dataset.tier = tier;
      this.qualityButtons.set(tier, b);
    }
    const note = document.createElement('p');
    note.className = 'menu-note';
    note.dataset.role = 'quality-note';
    note.hidden = true;
    this.el.appendChild(note);
    const status = document.createElement('p');
    status.className = 'menu-note settings-status';
    status.dataset.role = 'quality-status';
    this.el.appendChild(status);

    this.range('mouseSensitivity', 'ui.settings.mouse_sensitivity', 0.1, 3, 0.1, 'sens');
    this.toggle('invertY', 'ui.settings.invert_y', 'invert');
    this.range('masterVolume', 'ui.settings.volume_master', 0, 100, 1, 'vol-master');
    this.range('musicVolume', 'ui.settings.volume_music', 0, 100, 1, 'vol-music');
    this.range('sfxVolume', 'ui.settings.volume_sfx', 0, 100, 1, 'vol-sfx');

    const sSeg = this.row('ui.settings.subtitle_size', this.seg('subtitle-size'));
    for (const size of ['s', 'm', 'l'] as const) {
      const b = this.segBtn(sSeg, t(SUBTITLE_SIZE_LABELS[size]), () => this.game.settings.set('subtitleSize', size));
      b.dataset.size = size;
      this.subtitleButtons.set(size, b);
    }
    this.toggle('autoRecenter', 'ui.settings.auto_recenter', 'recenter');
    // 显示帧率：走 UIManager.toggleFps（开发模式默认显示时，开关以实际显示状态为准）
    const fpsBtn = this.button('ui.common.off', 'fps', 'small');
    fpsBtn.addEventListener('click', () => {
      this.game.ui.toggleFps();
      this.refresh();
    });
    this.row('ui.settings.show_fps', fpsBtn);
    this.toggles.set('showFps', fpsBtn);

    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    const fs = this.button('ui.settings.fullscreen', 'fullscreen');
    fs.hidden = !isFullscreenSupported();
    fs.addEventListener('click', () => void toggleFullscreen());
    this.fsBtn = fs;
    const reset = this.button('ui.settings.reset', 'reset');
    reset.addEventListener('click', () => {
      this.game.settings.resetToDefaults();
      this.refresh();
    });
    const back = this.button('ui.common.back', 'back', 'primary');
    back.addEventListener('click', () => this.onBack?.());
    actions.append(fs, reset, back);
    this.el.appendChild(actions);

    this.offs.push(
      this.game.settings.onChange(() => this.isOpen && this.refresh()),
      this.game.events.on('quality:changed', () => this.isOpen && this.refresh()),
      this.game.events.on('ui:toggle-fps', () => this.isOpen && this.refresh()),
      // batch26 ④：Esc / 浏览器退出全屏后按钮状态跟着变（设置开着时立刻刷新）
      this.game.events.on('viewport:fullscreen', () => this.isOpen && this.refresh()),
    );
  }

  get isOpen(): boolean {
    return !this.el.hidden && this.el.isConnected;
  }

  /** 挂到 host 里显示 */
  mount(host: HTMLElement): void {
    if (this.el.parentElement !== host) host.appendChild(this.el);
    this.refresh();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  refresh(): void {
    const { quality: q, settings: s } = this.game;
    for (const [tier, b] of this.qualityButtons) b.classList.toggle('active', tier === q.tier);
    for (const [size, b] of this.subtitleButtons) b.classList.toggle('active', size === s.get('subtitleSize'));
    for (const [key, r] of this.ranges) {
      const v = s.get(key);
      r.input.value = String(v);
      r.value.textContent = key === 'mouseSensitivity' ? v.toFixed(1) : String(v);
    }
    for (const [key, b] of this.toggles) {
      const on = key === 'showFps' ? this.game.ui.fps.visible : s.get(key);
      b.textContent = t(on ? 'ui.common.on' : 'ui.common.off');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    // batch26 ④：全屏按钮按下态跟实际全屏状态（文字不变，没有「退出全屏」文案）
    if (this.fsBtn) {
      this.fsBtn.classList.toggle('on', this.game.fullscreen);
      this.fsBtn.setAttribute('aria-pressed', String(this.game.fullscreen));
    }
    // 自动检测降过档、且玩家没手动改过时，画质项下显示提示（009）
    const note = this.el.querySelector<HTMLParagraphElement>('[data-role="quality-note"]')!;
    note.hidden = !q.showAutoNote;
    note.textContent = q.showAutoNote ? t('ui.settings.quality_auto_note') : '';
    // 检测状态（策划定稿）：全部检测**完成**后才显示 quality_detected；没跑过 / 被打断 / 被跳过 / 重测进行中
    // 都显示 quality_undetected（BUG-002）；网址参数临时档位显示 quality_url
    const detected = this.game.benchmark.running ? null : q.detected;
    const status = this.el.querySelector<HTMLParagraphElement>('[data-role="quality-status"]')!;
    status.textContent = q.urlOverride
      ? t('ui.settings.quality_url')
      : detected
        ? t('ui.settings.quality_detected', { tier: t(QUALITY_LABELS[detected]) })
        : t('ui.settings.quality_undetected');
    status.title = `GPU: ${q.gpu}`;
  }

  // ---------------------------------------------------------------- 构建

  private row(label: TextId, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'menu-row';
    const span = document.createElement('span');
    span.textContent = t(label);
    row.append(span, control);
    this.el.appendChild(row);
    return control;
  }

  private seg(role: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = 'seg';
    d.dataset.role = role;
    return d;
  }

  private segBtn(seg: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.textContent = text;
    b.addEventListener('click', () => {
      onClick();
      this.refresh();
    });
    seg.appendChild(b);
    return b;
  }

  private button(text: TextId, act: string, extra = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `menu-btn ${extra}`.trim();
    b.dataset.act = act;
    b.textContent = t(text);
    return b;
  }

  private range(key: 'mouseSensitivity' | VolumeKey, label: TextId, min: number, max: number, step: number, act: string): void {
    const wrap = document.createElement('span');
    wrap.className = 'menu-range';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.dataset.act = act;
    input.setAttribute('aria-label', t(label));
    const value = document.createElement('span');
    value.className = 'menu-range-value';
    wrap.append(input, value);
    input.addEventListener('input', () => {
      this.game.settings.set(key, Number(input.value));
      this.refresh();
    });
    this.row(label, wrap);
    this.ranges.set(key, { input, value });
  }

  private toggle(key: ToggleKey, label: TextId, act: string): void {
    const b = this.button('ui.common.off', act, 'small');
    b.addEventListener('click', () => {
      this.game.settings.set(key, !this.game.settings.get(key));
      this.refresh();
    });
    this.row(label, b);
    this.toggles.set(key, b);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.el.remove();
  }
}
