import type { Game } from '@/core/Game';
import { gameConfig } from '@/config/gameConfig';
import { debugEnabled } from '@/config/debug';
import { DebugPanel } from './DebugPanel';
import { estimateVram } from '@/render/vram';
import { SAVE_TEXT } from '@/systems/save/SaveSystem';
import { FpsCounter, type PerfStats } from './FpsCounter';
import { Hud } from './Hud';
import { LoadingScreen } from './LoadingScreen';
import { PauseMenu } from './PauseMenu';
import { ScreenFade } from './ScreenFade';
import { Journal } from './Journal';
import { Reader } from './Reader';
import { Subtitles } from './Subtitles';
import { Toast } from './Toast';
import { gameplay } from '@/config/gameplay';
import { t } from '@/content/text';

/**
 * DOM UI 层（叠在 canvas 上）。UI 用原生 DOM + CSS，便于做清晰的文字和响应式布局；
 * 以后 UI 复杂了可以换成 Preact/Vue 等，只要保持 UIManager 对外接口不变。
 */
export class UIManager {
  readonly loading: LoadingScreen;
  readonly hud: Hud;
  readonly pause: PauseMenu;
  readonly fps: FpsCounter;
  /** 开发调试面板（F4）；非调试模式下也存在但不会显示 */
  readonly debug: DebugPanel;
  /** 全屏黑场（teleportTo / 场景切换） */
  readonly fade: ScreenFade;
  /** 字幕（005）：底部居中；play(ids) / playAt(time) */
  readonly subtitles: Subtitles;
  /** 阅读界面（005）：reader.open(docId) */
  readonly reader: Reader;
  /** 日志（J，005） */
  readonly journal: Journal;
  /** 左下角短提示（「日志已更新」） */
  readonly toastLeft: Toast;
  private offs: Array<() => void> = [];

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    // 正式版按设置「显示帧率」（默认关）；开发模式默认显示
    // 开发模式 / ?debug=1 / ?smoke=1 显示完整性能面板（009：draw call、三角面、显存估算，对照 §8 预算）
    const detailed = debugEnabled || new URLSearchParams(location.search).has('smoke');
    this.fps = new FpsCounter(root, gameConfig.showFpsByDefault || game.settings.get('showFps'), {
      detailed,
      label: () => this.game.quality.preset.label,
      stats: () => this.perfStats(),
      vram: () => estimateVram(this.game.renderer, this.game.scenes.current?.scene ?? null),
    });
    this.debug = new DebugPanel(root, game);
    this.loading = new LoadingScreen(root);
    this.fade = new ScreenFade(root);
    this.hud = new Hud(root);
    this.subtitles = new Subtitles(root, game.narrative, game.events);
    this.toastLeft = new Toast(root);
    const freeze = (): (() => void) => game.freeze();
    this.reader = new Reader(root, { input: game.input, narrative: game.narrative, events: game.events, freeze });
    this.journal = new Journal(root, { input: game.input, narrative: game.narrative, events: game.events, reader: this.reader, freeze });
    this.subtitles.setSize(game.settings.get('subtitleSize'));
    this.pause = new PauseMenu(root, game, () => this.toggleFps());

    this.offs.push(
      game.events.on('game:pause', () => this.pause.show()),
      game.events.on('game:resume', () => this.pause.hide()),
      // 首次阅读 → 左下角「日志已更新」2 s；再次阅读不会发这个事件
      game.events.on('journal:updated', () => this.toastLeft.show(t('ch1.common.journal_updated'), gameplay.narrative.journalToastSeconds)),
      // 字号三档：设置变化即时生效
      game.settings.onChange(() => this.subtitles.setSize(game.settings.get('subtitleSize'))),
      // 换场景：字幕清掉，阅读界面 / 日志关掉（解冻）
      game.events.on('scene:change', () => {
        this.subtitles.track.clear();
        this.journal.close();
        this.reader.close(false);
      }),
    );

    // 自动存档完成：右下角「已保存」2.5s（写不进去时不显示）。
    // 主菜单（008）做好之前，启动时的存档提示（存档无法读取 / 无法保存进度）在第一次进场时显示 8s
    let notice = game.save.startupNotice;
    game.save.onSaved = (_data, ok) => {
      if (notice) {
        this.hud.toast(notice, 8);
        notice = null;
      } else if (ok) {
        this.hud.toast(SAVE_TEXT.saved);
      }
    };
  }

  toggleFps(): boolean {
    const v = !this.fps.visible;
    this.fps.setVisible(v);
    this.game.settings.set('showFps', v);
    this.game.events.emit('ui:toggle-fps', { visible: v });
    return v;
  }

  private perfStats(): PerfStats {
    const { renderer, quality, benchmark, settings } = this.game;
    const info = renderer.info;
    const p = quality.preset;
    const src = quality.urlOverride ? 'URL' : { default: '默认', auto: '自动', user: '手动' }[settings.get('qualitySource')];
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      maxDrawCalls: p.maxDrawCalls,
      sceneVisibleTris: p.sceneVisibleTris,
      label: `${p.label}（${src}）`,
      benchmark: benchmark.running
        ? `自动检测中：${p.label} ${benchmark.elapsed.toFixed(1)} s` +
          (benchmark.rounds.length ? ` · 已测 ${benchmark.rounds.map((r) => `${r.tier} ${r.fps.toFixed(0)}`).join(' / ')}` : '')
        : null,
    };
  }

  /** 每帧调用（未缩放时间，暂停时也更新） */
  update(dt: number): void {
    // F3 / F4 仅开发模式或 ?debug=1（正式版帧率显示走设置里的开关）
    if (this.game.input.consumePressed('toggleFps') && debugEnabled) this.toggleFps();
    if (this.game.input.consumePressed('toggleDebug') && debugEnabled) this.debug.toggle();
    this.fps.update(dt);
    this.debug.update(dt);
    // 阅读界面在日志之上：先让阅读界面读输入
    this.reader.update();
    this.journal.update();
    // 字幕：左键 / Space 手动推进（explore / puzzle / cutscene 上下文有 advance 绑定）；时间走游戏时间（暂停、阅读时停）
    const ctx = this.game.input.context;
    if (this.subtitles.current && ctx !== 'reading' && this.game.input.consumePressed('advance')) this.subtitles.advance();
    this.subtitles.update(this.game.isPaused || this.game.isFrozen ? 0 : dt);
    this.toastLeft.update(dt);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.fps.dispose();
    this.debug.dispose();
    this.loading.dispose();
    this.fade.dispose();
    this.hud.dispose();
    this.pause.dispose();
    this.journal.dispose();
    this.reader.dispose();
    this.subtitles.dispose();
    this.toastLeft.dispose();
    this.root.replaceChildren();
  }
}
