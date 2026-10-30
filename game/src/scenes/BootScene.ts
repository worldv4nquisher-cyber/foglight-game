import { applyUiArt } from '@/ui/uiArt';
import { BaseScene } from './BaseScene';

/**
 * 启动场景：只加载 boot + menu 两组（主菜单、UI、字体子集；「主菜单包」≤ 15 MB，3 秒内出现主菜单，v0.1-010），
 * 然后进入主菜单（或直接进场，见 GameFlow.afterBoot）。场景资源在「新游戏 / 继续」后才加载。
 */
export class BootScene extends BaseScene {
  readonly name = 'boot';
  override pausable = false;

  override async enter(): Promise<void> {
    this.scene.background = null;
    this.game.flow.bootStartMs ??= performance.now();
    await this.game.assets.loadGroups(['boot', 'menu']);
    // 030：主菜单包里的 UI 图（标题字、面板框、按钮光效、图标、加载插画、应用图标）写成 CSS 变量
    if (typeof document !== 'undefined') applyUiArt(this.game.assets);
    // 默认进主菜单（v0.1-008）；?autostart=1 / ?scene=… 直接进场
    this.game.flow.afterBoot();
  }
}
