import { PERF_SPOTS, type PerfSceneId, type PerfSpot } from '@/config/perf-spots';
import type { Game } from '@/core/Game';
import type { PerspectiveCamera } from 'three';

/**
 * 037 真 GPU 实测用：控制台 `__perfSpot('s1-raft-back')` 把相机钉到 perf-spots.ts 的预算机位（和 verify-budget 同一套 eye / at / fov），
 * 时间照走（水面 / 雾 / 灯束都在动，量出来的才是真实帧时间），只停掉跟随相机；`__perfSpot()` 松开，`__perfSpot('?')` 列出当前场景的机位。
 * 只在 dev 或 ?smoke=1 下挂（和 __game 一样），不进正式玩家路径。
 */
export function installPerfSpot(game: Game): void {
  let restore: (() => void) | null = null;
  const release = (): void => {
    restore?.();
    restore = null;
  };
  const sceneId = (): PerfSceneId | null => {
    const n = game.scenes.current?.name ?? '';
    return n.startsWith('s1') ? 's1' : n.startsWith('s2') ? 's2' : n.startsWith('s3') ? 's3' : null;
  };
  const fn = (id?: string): string | readonly PerfSpot[] => {
    if (id === undefined) {
      release();
      return 'released';
    }
    const sid = sceneId();
    const list = sid ? PERF_SPOTS[sid] : [];
    if (id === '?') return list;
    const all = Object.values(PERF_SPOTS).flat();
    const sp = all.find((s) => s.id === id);
    if (!sp) return `没有机位 ${id}；当前场景可用：${list.map((s) => s.id).join(', ')}`; // text-ok: 控制台调试返回值，不上屏
    if (!list.includes(sp)) return `${id} 不在当前场景（${sid ?? '无'}），先 __game.flow.goToLevel('${id.slice(0, 2)}')`; // text-ok: 控制台调试返回值，不上屏
    release();
    const s = game.scenes.current as unknown as { camera: PerspectiveCamera; cameraFollow?: { update: (...a: unknown[]) => void } };
    const cam = s.camera;
    const follow = s.cameraFollow;
    const pin = (): void => {
      cam.position.set(...sp.eye);
      cam.fov = sp.fov;
      cam.lookAt(...sp.at);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    };
    if (follow) {
      const orig = follow.update;
      follow.update = () => pin();
      restore = () => {
        follow.update = orig;
      };
    }
    pin();
    return `${sp.id}：${sp.label}`;
  };
  Object.assign(window, { __perfSpot: fn });
}
