import type * as THREE from 'three';
import type { Game } from '@/core/Game';
import { debugEnabled } from '@/config/debug';
import { HintSystem, hintScaleFromUrl } from '@/systems/HintSystem';
import type { InteractionSystem } from '@/systems/interaction/InteractionSystem';

/**
 * 场景用的 HintSystem（007）：hintsUsed 写存档并立即落盘、二级高亮走 InteractionSystem.highlight()、
 * 解锁发 hint:unlocked；绑定到 UI 的风灯图标 / H 弹窗。返回 [系统, 解绑]。
 * `?hintScale=0.05` 只在开发服务器 / ?debug=1 / ?smoke=1 时生效。
 */
export function createSceneHints(game: Game, interaction: InteractionSystem, root: THREE.Object3D): [HintSystem, () => void] {
  const search = typeof location !== 'undefined' ? location.search : '';
  const allowed = debugEnabled || new URLSearchParams(search).has('smoke');
  const hints = new HintSystem({
    scale: hintScaleFromUrl(search, allowed),
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
