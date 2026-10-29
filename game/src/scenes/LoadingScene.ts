import * as THREE from 'three';
import { gameConfig } from '@/config/gameConfig';
import { groupsForScene } from '@/core/GameFlow';
import { BaseScene } from './BaseScene';

/**
 * 加载场景（新游戏 / 继续）：显示进度条，加载 common + 目标场景的资源组（v0.1-010 分包），完成后切换到目标场景。
 * 新游戏 = common + s1（「首场景包」）；继续 = common + 存档场景的组。
 */
export class LoadingScene extends BaseScene {
  readonly name = 'loading';
  override pausable = false;

  override async enter(): Promise<void> {
    this.scene.background = new THREE.Color(0x0e1116);
    const ui = this.game.ui.loading;
    ui.show();
    const start = performance.now();
    const next = this.game.flow.next;
    await this.game.assets.loadGroups(groupsForScene(next), (r) => ui.setProgress(r));
    ui.setProgress(1);
    const elapsed = performance.now() - start;
    if (elapsed < gameConfig.minLoadingMs) {
      await new Promise((r) => setTimeout(r, gameConfig.minLoadingMs - elapsed));
    }
    // 注意：enter 内切换场景不要 await（当前切换尚未结束），SceneManager 会排队执行
    // 去哪由界面流程决定（新游戏 / 继续 / ?scene=… 见 GameFlow）
    void this.game.scenes.change(next);
  }

  override exit(): void {
    this.game.ui.loading.hide();
  }
}
