import * as THREE from 'three';
import { S2 } from './layout';

/**
 * v0.1-029 地窖钥匙点光（README-029 §2 钥匙节）：钥匙不烘、无自发光，地窖光照贴图里它那一格很暗，
 * 用一盏很弱的冷色点光把黄铜的高光勾出来（只照钥匙和架面一小圈，不当补光用）。
 * - #C4D2DE，0.15 cd，distance 0.22 m（不加大），decay 2，不投影
 * - 位置：env-cellar-s2 局部 (−0.35, −1.15, 0.35) = 钥匙 socket 上方 0.15 m；挂在 socket 下（钥匙不在了也不跟着走）
 * - 只在地窖里开（进出 0.4 s 淡入淡出）；拿走钥匙立刻关
 * - 灯一直 visible，关 = intensity 0：避免开关时 NUM_POINT_LIGHTS 变化导致全场景重编着色器
 */
export const CELLAR_KEY_LIGHT = {
  color: 0xc4d2de,
  intensity: 0.15,
  distance: 0.22,
  decay: 2,
  /** env-cellar-s2 局部坐标 */
  local: [-0.35, -1.15, 0.35] as const,
  fadeSec: 0.4,
} as const;

/** 角色在地窖里（xz 在地窖范围内、已经下到楼梯半截以下） */
export function inCellar(p: THREE.Vector3): boolean {
  const C = S2.cellar;
  return p.x > C.x[0] && p.x < C.x[1] && p.z > C.z[0] && p.z < C.z[1] && p.y < -0.6;
}

export class CellarKeyLight {
  readonly light: THREE.PointLight;
  private level = 0;

  /** cellar = 放好的 env-cellar-s2 根；socket = env-cellar-s2-key-socket */
  constructor(cellar: THREE.Object3D, socket: THREE.Object3D) {
    const L = CELLAR_KEY_LIGHT;
    this.light = new THREE.PointLight(L.color, 0, L.distance, L.decay);
    this.light.name = 's2-cellar-key-light';
    this.light.castShadow = false;
    cellar.updateWorldMatrix(true, true);
    const world = cellar.localToWorld(new THREE.Vector3(...L.local));
    this.light.position.copy(socket.worldToLocal(world));
    socket.add(this.light);
  }

  /** on = 在地窖里且钥匙还在架上 */
  update(dt: number, inside: boolean, keyTaken: boolean): void {
    if (keyTaken) this.level = 0;
    else {
      const step = dt / CELLAR_KEY_LIGHT.fadeSec;
      this.level = inside ? Math.min(1, this.level + step) : Math.max(0, this.level - step);
    }
    this.light.intensity = CELLAR_KEY_LIGHT.intensity * this.level;
  }

  dispose(): void {
    this.light.removeFromParent();
    this.light.dispose();
  }
}
