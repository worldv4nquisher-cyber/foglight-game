import * as THREE from 'three';
import { gameConfig } from '@/config/gameConfig';
import { BaseScene } from './BaseScene';

/** 加载场景：显示进度条，加载主场景资源组，完成后切换到主场景 */
export class LoadingScene extends BaseScene {
  readonly name = 'loading';
  override pausable = false;

  override async enter(): Promise<void> {
    this.scene.background = new THREE.Color(0x0e1116);
    const ui = this.game.ui.loading;
    ui.show();
    const start = performance.now();
    await this.game.assets.loadGroup('main', (r) => ui.setProgress(r));
    ui.setProgress(1);
    const elapsed = performance.now() - start;
    if (elapsed < gameConfig.minLoadingMs) {
      await new Promise((r) => setTimeout(r, gameConfig.minLoadingMs - elapsed));
    }
    // 注意：enter 内切换场景不要 await（当前切换尚未结束），SceneManager 会排队执行
    void this.game.scenes.change('main');
  }

  override exit(): void {
    this.game.ui.loading.hide();
  }
}
