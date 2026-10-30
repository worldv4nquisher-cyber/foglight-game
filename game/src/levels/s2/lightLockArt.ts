import * as THREE from 'three';
import { findNode } from '../artSlots';

/**
 * 光感锁美术 prop-light-lock-s2（1030c）的程序状态件：
 * - 透镜 `light-lock-lens`（材质 mat-prop-light-lock-lens，克隆一份）：emissive = #F4C978，intensity = 受光进度 × 1.6（解锁后 = 1.6）。
 * - 指针 `light-lock-needle`：rotation.z = (60 − 120 × progress)°。
 * - 门闩 `light-lock-bolt`：解锁后 position.x 0 → +0.08（0.3 s，线性）。
 * 只做外观；受光 / 解锁逻辑仍是白盒 BeamReceiver。
 */
export const LIGHT_LOCK_ART = { material: 'mat-prop-light-lock-lens', color: 0xf4c978, intensityAtFull: 1.6, needleDeg: [60, -60] as const, boltOpenM: 0.08, boltSec: 0.3 };

export interface LightLockSource {
  readonly progress: number;
  readonly state: string;
}

export class LightLockArt {
  readonly material: THREE.MeshStandardMaterial | null = null;
  readonly needle: THREE.Object3D | null;
  readonly bolt: THREE.Object3D | null;
  private boltX0 = 0;
  private boltT = 0;
  private readonly source: LightLockSource;
  private readonly isOpen: () => boolean;

  constructor(model: THREE.Object3D, source: LightLockSource, isOpen: () => boolean) {
    this.source = source;
    this.isOpen = isOpen;
    let mat: THREE.MeshStandardMaterial | null = null;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.material.name !== LIGHT_LOCK_ART.material || !(m.material instanceof THREE.MeshStandardMaterial)) return;
      mat ??= m.material.clone();
      m.material = mat;
    });
    this.material = mat;
    if (mat) (mat as THREE.MeshStandardMaterial).emissive.setHex(LIGHT_LOCK_ART.color);
    this.needle = findNode(model, 'light-lock-needle');
    this.bolt = findNode(model, 'light-lock-bolt');
    if (this.bolt) this.boltX0 = this.bolt.position.x;
    this.update(0);
  }

  /** 当前显示的进度（解锁后恒 1） */
  get progress(): number {
    return this.isOpen() || this.source.state === 'activated' ? 1 : THREE.MathUtils.clamp(this.source.progress, 0, 1);
  }

  /** 门闩已滑开的比例 0–1 */
  get boltOpen(): number {
    return this.boltT;
  }

  update(dt: number): void {
    const p = this.progress;
    if (this.material) {
      this.material.emissive.setHex(LIGHT_LOCK_ART.color);
      this.material.emissiveIntensity = p * LIGHT_LOCK_ART.intensityAtFull;
    }
    if (this.needle) {
      const [a, b] = LIGHT_LOCK_ART.needleDeg;
      this.needle.rotation.z = THREE.MathUtils.degToRad(a + (b - a) * p);
    }
    this.boltT = this.isOpen() ? Math.min(1, this.boltT + dt / LIGHT_LOCK_ART.boltSec) : 0;
    if (this.bolt) this.bolt.position.x = this.boltX0 + LIGHT_LOCK_ART.boltOpenM * this.boltT;
  }
}
