import * as THREE from 'three';
import type { AssetLoader } from '@/assets/AssetLoader';
import { mountDressing, type DressingSpec, type MountedDressing } from '../dressing';
import { Seabird, SEABIRD_KEY } from '@/world/Seabird';
import { S1, pierPoint } from './layout';
import { FOOTPRINT_TILES } from './footprints';

/** 027 / 033 脚印贴花（512 × 1024 RGBA，覆盖 1 × 2 m，沿 V 平铺；4 步，步距 0.5 m，脚尖朝 −V） */
export const FOOTPRINT_DECAL_KEY = 'tex-decal-footprints-albedo';
export const FOOTPRINT_DECAL_SIZE: readonly [number, number] = [1, 2];
export const FOOTPRINT_DECAL_ROUGHNESS = 0.65;

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
  /** 033 贴花组（s1-footprints-decal，子网格 T1–T4，共用几何 / 材质）；没有贴图时 null */
  decal: THREE.Group | null;
  decals: THREE.Mesh[];
  seabird: Seabird | null;
  update(dt: number): void;
  dispose(): void;
}

/**
 * S1 027 接入：告示牌 / 纸条（挂白盒交互物下）、脚印贴花（033：小径尽头 → 浮台的湿沙上 4 块，读 footprints-path.json）、远景海鸟。
 * 白盒脚印暗斑不在这里管：美术模式下由 S1Scene.setGreyboxVisible 整组隐藏。
 */
export function buildS1Dressing(assets: AssetLoader, scene: THREE.Object3D, opts: { showGreybox?: boolean } = {}): S1Dressing {
  const mounted = mountDressing(assets, scene, s1DressingSpecs(), opts);

  // 033：4 块 1 × 2 m 贴花 T1–T4，沿湿沙从小径尽头走向浮台（坐标 / yaw / 高度全读 footprints-path.json）
  let decal: THREE.Group | null = null;
  const decals: THREE.Mesh[] = [];
  if (assets.has(FOOTPRINT_DECAL_KEY)) {
    const tex = assets.getTexture(FOOTPRINT_DECAL_KEY);
    const mat = new THREE.MeshStandardMaterial({
      name: 'decal-footprints',
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      // 033：0.95 → 0.65，脚跟积水有一点湿反光
      roughness: FOOTPRINT_DECAL_ROUGHNESS,
      metalness: 0,
    });
    const g = new THREE.PlaneGeometry(FOOTPRINT_DECAL_SIZE[0], FOOTPRINT_DECAL_SIZE[1]);
    // 平面局部 +Y = 纹理 +V；放倒后 −V（脚尖）→ 世界 +Z，再转到走向
    g.rotateX(-Math.PI / 2);
    decal = new THREE.Group();
    decal.name = 's1-footprints-decal';
    for (const t of FOOTPRINT_TILES) {
      const m = new THREE.Mesh(g, mat);
      m.name = `s1-footprints-decal-${t.id}`;
      m.renderOrder = 1;
      m.receiveShadow = true;
      // 高度直接用 json 的 y（美术地面 + 0.015），不打物理射线
      m.position.set(...t.center);
      m.rotation.set(0, t.yaw, 0, 'YXZ');
      decal.add(m);
      decals.push(m);
    }
    scene.add(decal);
  }

  let seabird: Seabird | null = null;
  if (assets.has(SEABIRD_KEY)) {
    seabird = new Seabird(assets.getModel(SEABIRD_KEY), assets.getAnimations(SEABIRD_KEY), S1.seabird);
    scene.add(seabird.object);
  }
  return {
    mounted,
    decal,
    decals,
    seabird,
    update(dt) {
      seabird?.update(dt);
    },
    dispose() {
      seabird?.dispose();
      if (decal && decals[0]) {
        decals[0].geometry.dispose();
        (decals[0].material as THREE.Material).dispose();
        decal.removeFromParent();
      }
    },
  };
}
