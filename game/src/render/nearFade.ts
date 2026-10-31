import type * as THREE from 'three';

/**
 * BUG-028：相机贴近角色头部时角色抖动淡出（alphaHash 屏幕门，不排序、深度照写，不会透出自身内层）。
 * - 只动蒙皮网格（汐身体 / 头发 / 衣服 + 它们的外扩描边壳，壳本身也是同骨架的 SkinnedMesh）：
 *   钢笔等挂在 socket 上的道具是普通网格、材质和场景道具共用图集材质，不碰；
 *   幽灵深度预写（userData.ghostPrepass）不碰。
 * - 淡出时给材质开 alphaHash（程序键变化，第一次会编译一次）、opacity = 原值 × a；a 回到 1 时恢复原 alphaHash / opacity。
 * - 只在探索相机里用（演出 / 机关里调用方传 1）。
 */
export function nearFadeAlpha(d: number, range: readonly [number, number]): number {
  const k = Math.min(1, Math.max(0, (d - range[0]) / (range[1] - range[0])));
  return k * k * (3 - 2 * k);
}

interface Saved {
  alphaHash: boolean;
  opacity: number;
}

export class CharacterNearFade {
  /** 当前不透明度（1 = 原样） */
  alpha = 1;
  private readonly saved = new Map<THREE.Material, Saved>();

  private readonly root: THREE.Object3D;

  constructor(root: THREE.Object3D) {
    this.root = root;
  }

  /** 本帧应用 a（0–1）；a ≥ 0.999 恢复原材质 */
  set(a: number): void {
    a = Math.min(1, Math.max(0, a));
    if (a >= 0.999) {
      if (this.saved.size) this.restore();
      this.alpha = 1;
      return;
    }
    this.alpha = a;
    // 每帧重新遍历：美术 GLB / LOD 异步替换子网格时也能覆盖到
    this.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || m.userData.ghostPrepass) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        let s = this.saved.get(mat);
        if (!s) {
          s = { alphaHash: mat.alphaHash, opacity: mat.opacity };
          this.saved.set(mat, s);
        }
        if (!mat.alphaHash) {
          mat.alphaHash = true;
          mat.needsUpdate = true;
        }
        mat.opacity = s.opacity * a;
      }
    });
  }

  private restore(): void {
    for (const [mat, s] of this.saved) {
      if (mat.alphaHash !== s.alphaHash) {
        mat.alphaHash = s.alphaHash;
        mat.needsUpdate = true;
      }
      mat.opacity = s.opacity;
    }
    this.saved.clear();
  }

  /** 受影响的材质数（测试 / 调试） */
  get touched(): number {
    return this.saved.size;
  }
}
