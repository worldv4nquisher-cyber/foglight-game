import type * as THREE from 'three';
import type { Game } from '@/core/Game';
import { debugEnabled, smokeQuery, TEST_BUILD, testSearch } from '@/config/debug';
import { HintSystem, hintScaleFromUrl } from '@/systems/HintSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';

/**
 * 场景用的 HintSystem（007）：hintsUsed 写存档并立即落盘、二级高亮走 InteractionSystem.highlight()、
 * 解锁发 hint:unlocked；绑定到 UI 的风灯图标 / H 弹窗。返回 [系统, 解绑]。
 * `?hintScale=0.05` 只在开发服务器 / 测试构建的 ?debug=1 / ?smoke=1 时生效；生产构建里提示倍率恒为 1、不读这个参数（batch26）。
 */
export function createSceneHints(game: Game, interaction: InteractionSystem, root: THREE.Object3D): [HintSystem, () => void] {
  const hints = new HintSystem({
    scale: TEST_BUILD ? hintScaleFromUrl(testSearch(), debugEnabled || smokeQuery) : 1,
    onUsed: () => {
      game.save.addHintUsed();
      game.save.flush();
    },
    highlight: (ids, seconds) => void interaction.highlight(ids, seconds, root),
    onUnlock: (puzzleId, level) => game.events.emit('hint:unlocked', { puzzleId, level }),
  });
  game.ui.hints.bind(hints);
  return [hints, () => game.ui.hints.bind(null)];
}
