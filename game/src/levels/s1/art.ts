import * as THREE from 'three';
import type { AssetLoader } from '@/assets/AssetLoader';
import type { QualityPreset } from '@/config/quality';
import { InstancedLodSet } from '@/render/instancedLod';
import { applyObjectFog, readFogHint, type ObjectFogHandle } from '@/render/objectFog';
import { makeSkyLayer, type SkyLayerHandle } from '@/render/skyLayer';
import { applyMaterialHints } from '@/render/materialHints';
import { withTideLevel, WET_LINE_GLSL } from '@/render/tideUniforms';
import { S1, S3_WORLD_FRAME, v3 } from './layout';
import { S1_ROCKS, type RockId } from './rocks';

/** 远景塔（S3 塔座实例）每档固定的 LOD 级（s1-layout.json socketInstances.lodByTier） */
const TOWER_LOD_BY_TIER = { ultra: 1, high: 2, standard: 2, low: 2 } as const;
const COLLIDER_NAME = /-(collider|wall)(\.\d+)?$/i;

/** 按潮位切换可见性的一组节点（船绳涨 / 退潮两版）；找不到任一版 = null（保持现状） */
export interface TideVariantSwitch {
  high: THREE.Object3D[];
  low: THREE.Object3D[];
  /** 当前显示的一版 */
  state: 'high' | 'low' | null;
  update(tideLevel: number): void;
}

/** 按名字找节点：精确名优先；没有就找 `<名>_lodN` / `<名>.001` 这类变体（同名只取第一个） */
export function findVariantNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const exact = root.getObjectByName(name);
  if (exact) return exact;
  let hit: THREE.Object3D | null = null;
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_lod\\d+|\\.\\d+)$`);
  root.traverse((o) => {
    if (!hit && re.test(o.name)) hit = o;
  });
  return hit;
}

export function makeTideVariantSwitch(root: THREE.Object3D, cfg: { high: readonly string[]; low: readonly string[]; switchLevel: number }): TideVariantSwitch | null {
  const find = (names: readonly string[]): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    for (const n of names) {
      const o = findVariantNode(root, n);
      if (o && !out.includes(o)) out.push(o);
    }
    return out;
  };
  const high = find(cfg.high);
  const low = find(cfg.low);
  if (!high.length || !low.length) return null;
  const sw: TideVariantSwitch = {
    high,
    low,
    state: null,
    update(level) {
      const s = level >= cfg.switchLevel ? 'high' : 'low';
      if (s === sw.state) return;
      sw.state = s;
      for (const o of high) o.visible = s === 'high';
      for (const o of low) o.visible = s === 'low';
    },
  };
  return sw;
}

export interface S1Art {
  root: THREE.Group;
  /** 有没有加载到美术（没有 = 只有白盒） */
  readonly loaded: boolean;
  rocks: InstancedLodSet[];
  boat: THREE.Object3D | null;
  island: THREE.Object3D | null;
  tower: THREE.Object3D | null;
  farFog: ObjectFogHandle | null;
  sky: SkyLayerHandle | null;
  /** 船绳涨 / 退潮两版切换（美术节点未交付 = null） */
  rope: TideVariantSwitch | null;
  update(camera: THREE.Camera, tideLevel: number): void;
  applyQuality(q: QualityPreset): void;
}

/**
 * S1 美术接入（v0.1-013）：按 layout.ts 摆放 018 / 020 交付的 GLB。
 * - 美术 GLB 里的 -collider / -wall 只隐藏、不注册（碰撞以白盒为准）。
 * - 礁石 164 个实例（018 打磨 155→164）：InstancedLodSet（每个实例矩阵含 _lodN 节点矩阵），距离按画质档 lodDistances。
 * - 主岛 + S3 塔座实例：按物体雾 'mid'（0.0036）；塔按档固定 LOD；第一章点灯前不亮（灯罩自发光清零，不加光源）。
 * - 两座远景灯塔剪影：天空层（深度钉远平面、单色 + 自己的雾），三档构图一致（不受 viewDistance 裁掉）。
 * - 渔网材质 alphaHint → alphaHash；材质 extras tideMark = 'uTideLevel' → 挂湿痕线（克隆，不改缓存里的原材质）。
 * - 环境里不加任何暖色光（暖光只属于风灯）。
 */
export function buildS1Art(assets: AssetLoader): S1Art {
  const root = new THREE.Group();
  root.name = 's1-art';
  const wetClones = new Map<THREE.Material, THREE.Material>();
  const wet = (m: THREE.Material): THREE.Material => {
    if ((m.userData as { tideMark?: unknown }).tideMark !== 'uTideLevel') return m;
    let c = wetClones.get(m);
    if (!c) {
      c = withTideLevel(m.clone(), WET_LINE_GLSL);
      wetClones.set(m, c);
    }
    return c;
  };
  const prepare = (o: THREE.Object3D): THREE.Object3D => {
    o.traverse((c) => {
      if (COLLIDER_NAME.test(c.name) || c.userData.collider === true || c.userData.wall === true) {
        c.visible = false;
        return;
      }
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(wet) : wet(mesh.material);
    });
    applyMaterialHints(o);
    return o;
  };
  const has = (key: string): boolean => assets.has(key);
  const place = (key: string, t: readonly [number, number, number], rotY: number): THREE.Object3D | null => {
    if (!has(key)) return null;
    const o = prepare(assets.getModel(key));
    o.position.set(t[0], t[1], t[2]);
    o.rotation.y = rotY;
    o.name = key;
    root.add(o);
    return o;
  };

  let loaded = false;
  for (const [key, n] of Object.entries(S1.artNodes)) if (place(key, n.translation, n.rotationY)) loaded = true;

  // 小船（y 随水位）/ 沉船
  const boat = place('prop-boat-rowboat', S1.boat.position, S1.boat.rotationY);
  const sb = S1.sunkenBoat;
  const sunken = place('prop-boat-rowboat-sunken', sb.position, 0);
  sunken?.rotation.set((sb.rotationXDeg * Math.PI) / 180, sb.rotationY, (sb.rotationZDeg * Math.PI) / 180, 'YXZ');

  // 礁石实例
  const rocks: InstancedLodSet[] = [];
  const byRock = new Map<RockId, typeof S1_ROCKS[number][]>();
  for (const r of S1_ROCKS) {
    const list = byRock.get(r.rock) ?? [];
    list.push(r);
    byRock.set(r.rock, list);
  }
  for (const [id, list] of byRock) {
    const key = `env-rock-shore-${id}`;
    if (!has(key)) continue;
    const set = new InstancedLodSet(prepare(assets.getModel(key)), list, { name: `s1-rocks-${id}`, material: wet });
    root.add(set);
    rocks.push(set);
    loaded = true;
  }

  // 远景主岛 + S3 塔座实例（按物体雾）
  let island: THREE.Object3D | null = null;
  let tower: THREE.Object3D | null = null;
  let farFog: ObjectFogHandle | null = null;
  const far = new THREE.Group();
  far.name = 's1-far-island';
  if (has('env-lighthouse-island-main-s3tower')) {
    island = prepare(assets.getModel('env-lighthouse-island-main-s3tower'));
    island.name = 'env-lighthouse-island-main-s3tower';
    island.position.copy(v3(S3_WORLD_FRAME.towerCenter));
    island.rotation.y = S3_WORLD_FRAME.islandRotationY;
    far.add(island);
    island.updateMatrixWorld(true);
    if (has('env-lighthouse-ch1')) {
      let socket: THREE.Object3D | null = null;
      island.traverse((o) => {
        if (!socket && /lighthouse-ch1-socket/i.test(o.name)) socket = o;
      });
      tower = prepare(assets.getModel('env-lighthouse-ch1'));
      tower.name = 'env-lighthouse-ch1-far';
      const p = new THREE.Vector3(S3_WORLD_FRAME.towerCenter[0], S3_WORLD_FRAME.socketY, S3_WORLD_FRAME.towerCenter[2]);
      if (socket) (socket as THREE.Object3D).getWorldPosition(p);
      tower.position.copy(p);
      tower.rotation.y = S3_WORLD_FRAME.rotationY;
      // 第一章点灯前远景灯塔全部熄灭（v0.1-013 制作人裁定）：灯罩 / 灯室自发光清零
      tower.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.emissive && (s.emissiveIntensity > 0 || s.emissiveMap)) {
            const i = Array.isArray(m) ? m.indexOf(mat) : -1;
            const dark = s.clone();
            dark.emissive.setRGB(0, 0, 0);
            dark.emissiveIntensity = 0;
            dark.emissiveMap = null;
            if (i >= 0) (m as THREE.Material[])[i] = dark;
            else (o as THREE.Mesh).material = dark;
          }
        }
      });
      far.add(tower);
    }
    const hint = readFogHint(island);
    farFog = applyObjectFog(far, hint.layer === 'mid' && hint.density ? hint.density : S1.midFogDensity);
    root.add(far);
    loaded = true;
  }

  // 远景剪影（天空层）
  let sky: SkyLayerHandle | null = null;
  if (has('env-lighthouse-silhouette-far')) {
    const g = new THREE.Group();
    g.name = 's1-sky-silhouettes';
    for (const s of S1.silhouettes) {
      const o = assets.getModel('env-lighthouse-silhouette-far');
      o.position.copy(v3(s.translation));
      o.rotation.y = s.rotationY;
      o.scale.setScalar(s.scale);
      g.add(o);
    }
    sky = makeSkyLayer(g, S1.skyLayer);
    root.add(g);
    loaded = true;
  }

  // 船绳两版（美术 1030 已拆进 env-pier-wood-ch1.glb；-rope-low 的 extras.defaultVisible false 由 AssetLoader 通用处理；
  // 每帧按水位切，首帧就定版；layout.ts S1.boatRope 配节点名，找不到就保持现状）
  const rope = makeTideVariantSwitch(root, S1.boatRope);

  const towerLods: THREE.LOD[] = [];
  tower?.traverse((o) => {
    if ((o as THREE.LOD).isLOD) towerLods.push(o as THREE.LOD);
  });

  return {
    root,
    loaded,
    rocks,
    boat,
    island,
    tower,
    farFog,
    sky,
    rope,
    update(camera, tideLevel) {
      for (const r of rocks) r.update(camera);
      rope?.update(tideLevel);
      if (boat) boat.position.y = Math.max(S1.boat.groundY, tideLevel - S1.boat.belowWater);
    },
    applyQuality(q) {
      for (const r of rocks) r.setDistances(q.lodDistances);
      const k = TOWER_LOD_BY_TIER[q.tier];
      for (const lod of towerLods) lod.levels.forEach((l, i) => (l.distance = i <= k ? 0 : Infinity));
    },
  };
}
