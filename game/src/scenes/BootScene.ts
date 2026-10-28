import { BaseScene } from './BaseScene';

/** 启动场景：加载启动必需的极少量资源（logo、字体等），然后进入加载场景 */
export class BootScene extends BaseScene {
  readonly name = 'boot';
  override pausable = false;

  override async enter(): Promise<void> {
    this.scene.background = null;
    await this.game.assets.loadGroup('boot');
    void this.game.scenes.change('loading');
  }
}
