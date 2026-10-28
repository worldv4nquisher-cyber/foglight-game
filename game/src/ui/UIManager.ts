import type { Game } from '@/core/Game';
import { gameConfig } from '@/config/gameConfig';
import { debugEnabled } from '@/config/debug';
import { DebugPanel } from './DebugPanel';
import { SAVE_TEXT } from '@/systems/save/SaveSystem';
import { FpsCounter } from './FpsCounter';
import { Hud } from './Hud';
import { LoadingScreen } from './LoadingScreen';
import { PauseMenu } from './PauseMenu';
import { ScreenFade } from './ScreenFade';

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
  private offs: Array<() => void> = [];

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    // 正式版按设置「显示帧率」（默认关）；开发模式默认显示
    this.fps = new FpsCounter(root, gameConfig.showFpsByDefault || game.settings.get('showFps'), () => this.game.quality.preset.label);
    this.debug = new DebugPanel(root, game);
    this.loading = new LoadingScreen(root);
    this.fade = new ScreenFade(root);
    this.hud = new Hud(root);
    this.pause = new PauseMenu(root, game, () => this.toggleFps());

    this.offs.push(
      game.events.on('game:pause', () => this.pause.show()),
      game.events.on('game:resume', () => this.pause.hide()),
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

  /** 每帧调用（未缩放时间，暂停时也更新） */
  update(dt: number): void {
    // F3 / F4 仅开发模式或 ?debug=1（正式版帧率显示走设置里的开关）
    if (this.game.input.consumePressed('toggleFps') && debugEnabled) this.toggleFps();
    if (this.game.input.consumePressed('toggleDebug') && debugEnabled) this.debug.toggle();
    this.fps.update(dt);
    this.debug.update(dt);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.fps.dispose();
    this.debug.dispose();
    this.loading.dispose();
    this.fade.dispose();
    this.hud.dispose();
    this.pause.dispose();
    this.root.replaceChildren();
  }
}
