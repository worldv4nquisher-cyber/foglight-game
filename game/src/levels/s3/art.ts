import * as THREE from 'three';
import type { AssetLoader } from '@/assets/AssetLoader';
import { applyMaterialHints } from '@/render/materialHints';
import { findNode } from '../artSlots';

const COLLIDER_NAME = /-(collider|wall)(\.\d+)?$/i;

/**
 * 美术 020 rework-1029 的 7 个 GLB（s3 资源组，按 art/source/env/s3-layout.json `nodes` 摆放；S3 局部坐标）。
 * 塔本体在 s1 组也登记过一份（远景），这里另登记 `-s3` key：离开 S1 释放 s1 组时不受影响。
 */
export const S3_ART_NODES = {
  'env-lighthouse-ch1-s3': { translation: [0, 0, 0], rotationY: 0 },
  'env-lighthouse-ch1-interior': { translation: [0, 0, 0], rotationY: 0 },
  'env-lamp-room-ch1': { translation: [0, 0, 0], rotationY: 0 },
  'prop-fresnel-lens-ch1': { translation: [0, 22.85, 0], rotationY: 0 },
  'env-rock-islet-a': { translation: [0, 0, 0], rotationY: 0 },
  'env-stone-bridge-s3': { translation: [0, 0, 0], rotationY: 0 },
} as const satisfies Record<string, { translation: readonly [number, number, number]; rotationY: number }>;
/** 门扇 GLB：合页在原点，场景挂到白盒合页节点下（json 摆位 (−2.6304, 2.4, −1.8668) rotY −5.497787 = 白盒合页） */
export const S3_DOOR_KEY = 'env-lighthouse-ch1-door';
/**
 * 022 塔门单独文件（美术回复 1030）：prop-lighthouse-door-s3.glb，`door-leaf` 原点在铰链、`-interact`、`-collider`、锁孔；puzzleCritical 无 LOD。
 * 到了优先用它（挂白盒合页、`door-leaf` 原点对到合页原点），缺失回退 020 门扇 S3_DOOR_KEY。
 */
export const S3_DOOR_PROP_KEY = 'prop-lighthouse-door-s3';
export const S3_DOOR_KEYS = [S3_DOOR_PROP_KEY, S3_DOOR_KEY] as const;

export interface S3Art {
  root: THREE.Group;
  readonly loaded: boolean;
  /** 塔门（S3_DOOR_KEYS 里第一个已加载的；name = 用的那个 key）：挂白盒合页 greybox.door 下 */
  door: THREE.Object3D | null;
  lens: THREE.Object3D | null;
}

/**
 * S3 美术接入：
 * - GLB 里的 -collider / -wall 只隐藏、不注册（碰撞以白盒为准）；GLB 里的灯（lamp-light-origin 等）全部隐藏。
 * - 环境不发暖光：所有 emissive 清零（灯室点灯前全暗；暖光只在点灯后由 puzzles.ts 打开）。
 * - 镜子 / 油阀 / 点火拉杆 / 潮钟美术没有单独的可动网格（合并在 interior / lamp-room 里），可动件用白盒，始终显示。
 */
export function buildS3Art(assets: AssetLoader): S3Art {
  const root = new THREE.Group();
  root.name = 's3-art';
  const darkClones = new Map<THREE.Material, THREE.Material>();
  const noGlow = (m: THREE.Material): THREE.Material => {
    const s = m as THREE.MeshStandardMaterial;
    if (!s.emissive || (!(s.emissiveIntensity > 0 && s.emissive.getHex() !== 0) && !s.emissiveMap)) return m;
    let c = darkClones.get(m);
    if (!c) {
      const d = s.clone();
      d.emissive.setRGB(0, 0, 0);
      d.emissiveIntensity = 0;
      d.emissiveMap = null;
      darkClones.set(m, (c = d));
    }
    return c;
  };
  const prepare = (o: THREE.Object3D): THREE.Object3D => {
    o.traverse((c) => {
      if (COLLIDER_NAME.test(c.name) || c.userData.collider === true || c.userData.wall === true || (c as THREE.Light).isLight) {
        c.visible = false;
        return;
      }
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(noGlow) : noGlow(mesh.material);
    });
    applyMaterialHints(o);
    return o;
  };
  let loaded = false;
  let lens: THREE.Object3D | null = null;
  for (const [key, n] of Object.entries(S3_ART_NODES)) {
    if (!assets.has(key)) continue;
    const o = prepare(assets.getModel(key));
    o.position.set(n.translation[0], n.translation[1], n.translation[2]);
    o.rotation.y = n.rotationY;
    o.name = key;
    root.add(o);
    if (key === 'prop-fresnel-lens-ch1') lens = o;
    loaded = true;
  }
  let door: THREE.Object3D | null = null;
  const doorKey = S3_DOOR_KEYS.find((k) => assets.has(k));
  if (doorKey) {
    door = prepare(assets.getModel(doorKey));
    door.name = doorKey;
    if (doorKey === S3_DOOR_PROP_KEY) {
      // 整个文件（门框 / 锁孔跟着）平移到 door-leaf 原点 = 白盒合页原点；没有 door-leaf 就按根原点 = 合页
      door.position.set(0, 0, 0);
      door.quaternion.identity();
      door.updateMatrixWorld(true);
      const leaf = findNode(door, 'door-leaf');
      if (leaf && leaf !== door) door.position.copy(leaf.getWorldPosition(new THREE.Vector3()).negate());
      else if (!leaf) console.warn(`[art] ${doorKey} 缺 door-leaf 节点：按根原点挂`);
    }
    loaded = true;
  }
  return { root, loaded, door, lens };
}
