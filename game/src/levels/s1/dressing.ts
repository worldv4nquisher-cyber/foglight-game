import * as THREE from 'three';
import type { AssetLoader } from '@/assets/AssetLoader';
import { mountDressing, type DressingSpec, type MountedDressing } from '../dressing';
import { Seabird, SEABIRD_KEY } from '@/world/Seabird';
import { S1, pierPoint } from './layout';

/** 027 脚印贴花（512 × 1024 RGBA，覆盖 1 × 2 m，沿 V 平铺；4 步，步距 0.5 m，脚尖朝 −V） */
export const FOOTPRINT_DECAL_KEY = 'tex-decal-footprints-albedo';
export const FOOTPRINT_DECAL_SIZE: readonly [number, number] = [1, 2];

/** S1 剧情物件（README-027 建议摆放；坐标全部取自 layout / 白盒交互物） */
export function s1DressingSpecs(): DressingSpec[] {
  const notice = pierPoint(5.2, S1.pier.width / 2 - 0.08, S1.pier.deckY);
  return [
    // 告示牌：原点 = 码头板面（立柱底），牌面中心 y 1.2 = 白盒告示中心 deckY + 1.2；正面 +Z，朝向 = 码头 rotationY（同白盒）
    { key: 'prop-notice-board-s1', at: [[notice.x, notice.y, notice.z]], yaw: S1.pier.rotationY, greybox: 's1-notice' },
    // 邻居纸条（压石纸条）：平放在沙面上
    { key: 'prop-letter-a', id: 'prop-letter-a-s1', at: [[15.05, S1.sandY + 0.02, -1.7]], greybox: 's1-neighbor-note' },
  ];
}

export interface S1Dressing {
  mounted: MountedDressing[];
  decal: THREE.Mesh | null;
  seabird: Seabird | null;
  update(dt: number): void;
  dispose(): void;
}

/**
 * S1 027 接入：告示牌 / 纸条（挂白盒交互物下）、礁石小径脚印贴花（reefPath[2] 处，沿小径方向，贴物理路面）、远景海鸟。
 * groundY(x, z) = 物理路面高度（没打中 null）。
 */
export function buildS1Dressing(assets: AssetLoader, scene: THREE.Object3D, groundY: (x: number, z: number) => number | null, opts: { showGreybox?: boolean; greyboxFootprints?: readonly THREE.Object3D[] } = {}): S1Dressing {
  const mounted = mountDressing(assets, scene, s1DressingSpecs(), opts);

  let decal: THREE.Mesh | null = null;
  if (assets.has(FOOTPRINT_DECAL_KEY)) {
    const p = S1.reefPath;
    const c = new THREE.Vector3(...p[2]!);
    // 走向：小径上一块 → 下一块（父亲往尽头走），脚尖朝 −V
    const dir = new THREE.Vector3(...p[3]!).sub(new THREE.Vector3(...p[1]!)).setY(0).normalize();
    const half = FOOTPRINT_DECAL_SIZE[1] / 2;
    const yAt = (s: number): number => groundY(c.x + dir.x * s, c.z + dir.z * s) ?? c.y;
    const y0 = yAt(-half * 0.8), y1 = yAt(half * 0.8), yc = yAt(0);
    const tex = assets.getTexture(FOOTPRINT_DECAL_KEY);
    const mat = new THREE.MeshStandardMaterial({
      name: 'decal-footprints',
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      roughness: 0.95,
      metalness: 0,
    });
    const g = new THREE.PlaneGeometry(FOOTPRINT_DECAL_SIZE[0], FOOTPRINT_DECAL_SIZE[1]);
    // 平面局部 +Y = 纹理 +V；放倒后 −V（脚尖）→ 世界 +Z，再转到走向
    g.rotateX(-Math.PI / 2);
    decal = new THREE.Mesh(g, mat);
    decal.name = 's1-footprints-decal';
    decal.renderOrder = 1;
    decal.receiveShadow = true;
    decal.position.set(c.x, Math.max(yc, (y0 + y1) / 2) + 0.015, c.z);
    decal.rotation.set(-Math.atan2(y1 - y0, half * 1.6), Math.atan2(dir.x, dir.z), 0, 'YXZ');
    scene.add(decal);
    // 白盒脚印暗斑：贴花覆盖范围内的隐藏（其余小径段保留）
    for (const f of opts.greyboxFootprints ?? []) {
      const d = Math.hypot(f.position.x - c.x, f.position.z - c.z);
      if (d < half + 0.2) f.userData.replacedByDecal = true;
    }
  }

  let seabird: Seabird | null = null;
  if (assets.has(SEABIRD_KEY)) {
    seabird = new Seabird(assets.getModel(SEABIRD_KEY), assets.getAnimations(SEABIRD_KEY), S1.seabird);
    scene.add(seabird.object);
  }
  return {
    mounted,
    decal,
    seabird,
    update(dt) {
      seabird?.update(dt);
    },
    dispose() {
      seabird?.dispose();
      if (decal) {
        decal.geometry.dispose();
        (decal.material as THREE.Material).dispose();
        decal.removeFromParent();
      }
    },
  };
}
