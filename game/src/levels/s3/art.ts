import * as THREE from 'three';
import type { AssetLoader } from '@/assets/AssetLoader';
import { applyMaterialHints } from '@/render/materialHints';

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

export interface S3Art {
  root: THREE.Group;
  readonly loaded: boolean;
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
  if (assets.has(S3_DOOR_KEY)) {
    door = prepare(assets.getModel(S3_DOOR_KEY));
    door.name = S3_DOOR_KEY;
    loaded = true;
  }
  return { root, loaded, door, lens };
}
