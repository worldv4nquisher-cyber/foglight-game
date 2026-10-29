import * as THREE from 'three';
import type { AssetLoader } from '@/assets/AssetLoader';
import { applyMaterialHints } from '@/render/materialHints';
import { makeSkyLayer, type SkyLayerHandle } from '@/render/skyLayer';
import { S2, S2_FAR } from './layout';

const COLLIDER_NAME = /-(collider|wall)(\.\d+)?$/i;
/** S2 远景用的 S3 岛 / 塔（与 s1 组同一文件，另登记一份 key 在 s2 组：离开 S1 释放 s1 组时不受影响） */
export const S2_FAR_KEYS = { island: 'env-lighthouse-island-main-s3tower-s2far', tower: 'env-lighthouse-ch1-s2far' } as const;

/** 地窖钥匙模型 key / 架上 socket 节点（env-cellar-s2.glb） */
export const S2_KEY_KEY = 'prop-key-cellar-s2';
export const S2_KEY_SOCKET = 'env-cellar-s2-key-socket';
/** 021 黄铜风灯（原点 = 提手；`-emitter` = 光源中心；发光材质 mat-prop-lantern-glow 由程序控制，是全章唯一常驻暖光） */
export const S2_LANTERN_KEY = 'prop-lantern-brass';
/** 021 院子灯台（原点在台底、朝 +Z；`-socket` 放风灯提手，`-emitter-dir` 出光高度）；摆在院墙 env-courtyard-wall-s2-lamp-{east,west}-socket */
export const S2_LAMP_STAND_KEY = 'prop-lantern-stand-s2';
export const S2_LAMP_STAND_SOCKET = (k: 'east' | 'west'): string => `env-courtyard-wall-s2-lamp-${k}-socket`;

export interface S2Art {
  root: THREE.Group;
  readonly loaded: boolean;
  /** 地窖门扇（019 env-cellar-door-s2，合页在原点）：场景挂到白盒合页节点下，跟着转 */
  cellarDoor: THREE.Object3D | null;
  far: THREE.Group | null;
  farLayer: SkyLayerHandle | null;
  /** 地窖钥匙（prop-key-cellar-s2）：根节点精确放在 env-cellar-s2-key-socket（无偏移）；没交付 / 没 socket = null，用白盒钥匙 */
  cellarKey: THREE.Object3D | null;
  /**
   * 021 黄铜风灯（prop-lantern-brass）：不放进场景，交给 puzzles 挂进风灯手持物（替换白盒灯）。
   * 不走环境的「暖色自发光清零」——风灯是暖光例外（GDD §12）。没交付 = null，用白盒风灯
   */
  lantern: THREE.Object3D | null;
  /** 021 院子灯台（prop-lantern-stand-s2，东 / 西各一份，根节点放在院墙 lamp socket）；没交付 / 没 socket = null，用白盒灯台外观 */
  lampStands: { east: THREE.Object3D | null; west: THREE.Object3D | null };
}

/**
 * S2 美术接入（v0.1-014）：按 layout.ts 摆放 019 的 7 个 GLB + 020 灯塔远景。
 * - GLB 里的 -collider / -wall 只隐藏、不注册（碰撞以白盒为准；晾衣架的 blocksLight 由白盒同名碰撞体承担）。
 * - 环境里不加任何暖色光、不留暖色自发光：小屋窗玻璃等材质的 emissive 清零（暖光只属于风灯）。
 * - 远景 S3 岛 + 灯塔：世界坐标 S3_WORLD_FRAME 换算到 S2 局部（S2_WORLD_FRAME），天空层材质（unlit 单色 + 按物体雾、
 *   LOD 折叠到最后一级 = 塔 LOD2），不钉远平面（143 m 在视距内，塔基要被海面遮住）。第一章点灯前全暗（单色剪影，无光源）。
 */
export function buildS2Art(assets: AssetLoader): S2Art {
  const root = new THREE.Group();
  root.name = 's2-art';
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
      if (COLLIDER_NAME.test(c.name) || c.userData.collider === true || c.userData.wall === true) {
        c.visible = false;
        return;
      }
      if ((c as THREE.Light).isLight) {
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
  const place = (key: string, t: readonly [number, number, number], rotY: number): THREE.Object3D | null => {
    if (!assets.has(key)) return null;
    const o = prepare(assets.getModel(key));
    o.position.set(t[0], t[1], t[2]);
    o.rotation.y = rotY;
    o.name = key;
    root.add(o);
    return o;
  };

  let loaded = false;
  for (const [key, n] of Object.entries(S2.artNodes)) if (place(key, n.translation, n.rotationY)) loaded = true;
  let cellarDoor: THREE.Object3D | null = null;
  if (assets.has('env-cellar-door-s2')) {
    cellarDoor = prepare(assets.getModel('env-cellar-door-s2'));
    cellarDoor.name = 'env-cellar-door-s2';
    loaded = true;
  }

  let cellarKey: THREE.Object3D | null = null;
  const keySocket = root.getObjectByName(S2_KEY_SOCKET);
  if (assets.has(S2_KEY_KEY) && keySocket) {
    cellarKey = prepare(assets.getModel(S2_KEY_KEY));
    cellarKey.name = S2_KEY_KEY;
    cellarKey.position.set(0, 0, 0);
    cellarKey.quaternion.identity();
    cellarKey.scale.setScalar(1);
    keySocket.add(cellarKey);
  }

  // 021 风灯：只隐藏碰撞体 / 灯，保留暖色发光材质（风灯是唯一暖光，亮度由 puzzles 控制）
  let lantern: THREE.Object3D | null = null;
  if (assets.has(S2_LANTERN_KEY)) {
    lantern = assets.getModel(S2_LANTERN_KEY);
    lantern.name = S2_LANTERN_KEY;
    lantern.traverse((c) => {
      if (COLLIDER_NAME.test(c.name) || c.userData.collider === true || (c as THREE.Light).isLight) c.visible = false;
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh && c.visible) mesh.castShadow = mesh.receiveShadow = true;
    });
    applyMaterialHints(lantern);
  }

  // 021 灯台：院墙 GLB 的 lamp socket 定位（不写死坐标），只做外观；碰撞 / 光路仍由白盒灯台承担
  const lampStands: S2Art['lampStands'] = { east: null, west: null };
  for (const k of ['east', 'west'] as const) {
    const socket = root.getObjectByName(S2_LAMP_STAND_SOCKET(k));
    if (!assets.has(S2_LAMP_STAND_KEY) || !socket) continue;
    const stand = prepare(assets.getModel(S2_LAMP_STAND_KEY));
    stand.name = `${S2_LAMP_STAND_KEY}-${k}`;
    stand.position.set(0, 0, 0);
    stand.quaternion.identity();
    stand.scale.setScalar(1);
    socket.add(stand);
    lampStands[k] = stand;
  }

  // 远景 S3 岛 + 灯塔（天空层材质，不钉深度）
  let far: THREE.Group | null = null;
  let farLayer: SkyLayerHandle | null = null;
  if (assets.has(S2_FAR_KEYS.island) || assets.has(S2_FAR_KEYS.tower)) {
    far = new THREE.Group();
    far.name = 's2-far-s3';
    if (assets.has(S2_FAR_KEYS.island)) {
      const island = assets.getModel(S2_FAR_KEYS.island);
      island.name = 'env-lighthouse-island-main-s3tower-far';
      island.position.copy(S2_FAR.island.position);
      island.rotation.y = S2_FAR.island.rotationY;
      far.add(island);
    }
    if (assets.has(S2_FAR_KEYS.tower)) {
      const tower = assets.getModel(S2_FAR_KEYS.tower);
      tower.name = 'env-lighthouse-ch1-far';
      tower.position.copy(S2_FAR.tower.position);
      tower.rotation.y = S2_FAR.tower.rotationY;
      far.add(tower);
    }
    far.traverse((o) => {
      if (COLLIDER_NAME.test(o.name) || (o as THREE.Light).isLight) o.visible = false;
    });
    farLayer = makeSkyLayer(far, { ...S2.farLayer, pinDepth: false });
    root.add(far);
    loaded = true;
  }

  return { root, loaded, cellarDoor, far, farLayer, cellarKey, lantern, lampStands };
}
