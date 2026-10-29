import { BaseScene } from './BaseScene';

/** 启动场景：加载启动必需的极少量资源（logo、字体等），然后进入主菜单（或直接进场，见 GameFlow.afterBoot） */
export class BootScene extends BaseScene {
  readonly name = 'boot';
  override pausable = false;

  override async enter(): Promise<void> {
    this.scene.background = null;
    await this.game.assets.loadGroup('boot');
    // 默认进主菜单（v0.1-008）；?autostart=1 / ?scene=testbed 直接进场
    this.game.flow.afterBoot();
  }
}
