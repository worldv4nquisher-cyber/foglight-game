import * as THREE from 'three';
import { excludeFromOutline } from '@/systems/interaction/Highlight';
import { findNode, prepareArt, type ArtSlotModelSource } from './artSlots';

/**
 * v0.1-027 剧情物件 / 场景小物接入（README-027「建议摆放」）。
 *
 * 和 021 / 022 的 artSlots 一样：GLB 只做外观，交互 / 阅读逻辑留在白盒物体上；区别是这里的白盒多是**网格本身**
 * （日志 / 纸条 / 告示是一个 box），隐藏它会连带隐藏挂在下面的美术，所以白盒网格改成「不渲染 + 不描边」的载体，
 * 美术挂在它下面 —— 提示描边（Highlighter 遍历 object 子树）自然落在美术网格上（prop 带 COLOR_0 平滑法线）。
 *
 * - `at`：挂点，按顺序取第一个可用：场景节点名（019 / 020 GLB 的 socket、读点，**连朝向**），或世界坐标（layout 里的点）。
 * - `yaw`：挂点是坐标时的世界朝向（弧度）；`pose`：挂点坐标系里的局部变换（如倒扣杯子 extras.poses.upturned）。
 * - `greybox`：白盒交互物体名：美术挂到它下面（世界变换不变），白盒网格不再渲染（`?greybox=1` 时保留）。
 * - `variant`：只显示名字以 `show` 结尾的 LOD 组，`hide` 里的组隐藏（日志 closed / open）。
 * - `surface`：从挂点上方 0.3 m 向下打射线到 `roots` 下的美术网格（桌面 / 架板），记录与挂点高度的差（offset）；
 *   |offset| ≤ maxSnap 时贴上去，超出只记录（摆放点和美术模型对不上，列入向美术确认）。
 */
export type V3 = readonly [number, number, number];
export interface DressingSpec {
  key: string;
  id?: string;
  at: readonly (string | V3)[];
  yaw?: number;
  /** 挂点坐标系里的平移（同一 socket 摆两件时错开），在 surface 实测之前 */
  offset?: V3;
  /** 实测落点之后再叠的局部姿态：对象 = 直接给；字符串 = 读 GLB extras.poses[名]（如杯子 'upturned'） */
  pose?: string | { t?: V3; r?: readonly [number, number, number, number] };
  greybox?: string;
  variant?: { show: string; hide: readonly string[] };
  surface?: { roots: readonly string[]; maxSnap: number };
}
export interface MountedDressing {
  id: string;
  model: THREE.Object3D;
  /** 实际用的挂点（节点名，或 'layout'） */
  at: string;
  /** surface 实测：射线命中高度 − 挂点高度（m）；没打中 = null；没要求 = undefined */
  surfaceOffset?: number | null;
  snapped?: boolean;
}

type Pose = { t?: V3; r?: readonly [number, number, number, number] };
/** GLB 节点 extras.poses[name]（GLTFLoader 放在 userData） */
export function glbPose(model: THREE.Object3D, name: string): Pose | null {
  let found: Pose | null = null;
  model.traverse((o) => {
    const p = (o.userData.poses as Record<string, Pose> | undefined)?.[name];
    if (!found && p) found = p;
  });
  return found;
}

const HIDDEN = new THREE.MeshBasicMaterial({ name: 'greybox-carrier', visible: false });

/** 白盒网格换成不渲染、不描边的载体（只改材质，物体 visible 不动，子节点照常渲染） */
export function carrierOnly(root: THREE.Object3D, except?: THREE.Object3D): void {
  root.traverse((o) => {
    if (except && (o === except || isUnder(o, except))) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.dressingCarrier) return;
    m.userData.dressingCarrier = { material: m.material };
    m.material = HIDDEN;
    m.castShadow = false;
    excludeFromOutline(m);
  });
}

function isUnder(o: THREE.Object3D, p: THREE.Object3D): boolean {
  for (let c = o.parent; c; c = c.parent) if (c === p) return true;
  return false;
}

const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

/** 挂点上方 0.3 m 向下打到 roots 下的网格（不含 ignore 子树）：返回命中高度 */
export function surfaceY(scene: THREE.Object3D, roots: readonly string[], p: THREE.Vector3, ignore?: THREE.Object3D): number | null {
  const targets: THREE.Object3D[] = [];
  for (const r of roots) {
    const n = scene.getObjectByName(r);
    if (n) targets.push(n);
  }
  if (!targets.length) return null;
  scene.updateMatrixWorld(true);
  ray.set(new THREE.Vector3(p.x, p.y + 0.3, p.z), DOWN);
  ray.far = 0.8;
  const hits = ray.intersectObjects(targets, true).filter((h) => {
    const m = h.object as THREE.Mesh;
    if (!m.isMesh || !h.object.visible || m.userData.dressingCarrier) return false;
    if (ignore && (h.object === ignore || isUnder(h.object, ignore))) return false;
    // LOD：只认当前级（getObjectsForRaycast 未必按距离更新，取 LOD0 = 名字 _lod0 或非 LOD）
    return !/_lod[1-9]$/.test(h.object.name);
  });
  return hits.length ? hits[0]!.point.y : null;
}

export function mountDressing(assets: ArtSlotModelSource, scene: THREE.Object3D, specs: readonly DressingSpec[], opts: { showGreybox?: boolean } = {}): MountedDressing[] {
  const out: MountedDressing[] = [];
  scene.updateMatrixWorld(true);
  for (const spec of specs) {
    if (!assets.has(spec.key)) continue;
    // 挂点 → 世界矩阵
    const world = new THREE.Matrix4();
    let atName = '';
    for (const a of spec.at) {
      if (typeof a === 'string') {
        const n = scene.getObjectByName(a);
        if (!n) continue;
        n.updateWorldMatrix(true, false);
        world.copy(n.matrixWorld);
        atName = a;
      } else {
        world.compose(new THREE.Vector3(...a), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw ?? 0), new THREE.Vector3(1, 1, 1));
        atName = 'layout';
      }
      break;
    }
    if (!atName) {
      console.warn(`[dressing] ${spec.id ?? spec.key}：挂点 ${spec.at.join(' / ')} 都没有`);
      continue;
    }
    // 只取平移 + 旋转（socket 不带缩放）
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    world.decompose(pos, q, new THREE.Vector3());
    if (spec.offset) pos.add(new THREE.Vector3(...spec.offset).applyQuaternion(q));

    const model = assets.getModel(spec.key);
    model.name = spec.id ?? spec.key;
    model.userData.dressing = true;
    prepareArt(model);
    if (spec.variant) {
      const { show, hide } = spec.variant;
      model.traverse((o) => {
        if (o === model) return;
        const n = o.name.replace(/_lod\d+$/, '');
        if (hide.some((h) => n.endsWith(h))) o.visible = false;
        else if (n.endsWith(show)) o.visible = true;
      });
    }
    const rec: MountedDressing = { id: model.name, model, at: atName };
    if (spec.surface) {
      const y = surfaceY(scene, spec.surface.roots, pos);
      rec.surfaceOffset = y === null ? null : y - pos.y;
      rec.snapped = y !== null && Math.abs(y - pos.y) <= spec.surface.maxSnap;
      if (rec.snapped) pos.y = y!;
    }
    const pose = typeof spec.pose === 'string' ? glbPose(model, spec.pose) : spec.pose;
    if (typeof spec.pose === 'string' && !pose) console.warn(`[dressing] ${rec.id}：GLB 没有 extras.poses.${spec.pose}`);
    if (pose?.t) pos.add(new THREE.Vector3(...pose.t).applyQuaternion(q));
    if (pose?.r) q.multiply(new THREE.Quaternion(...pose.r));
    const parent = (spec.greybox && scene.getObjectByName(spec.greybox)) || scene;
    parent.updateWorldMatrix(true, false);
    const local = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)).premultiply(parent.matrixWorld.clone().invert());
    local.decompose(model.position, model.quaternion, model.scale);
    parent.add(model);
    if (spec.greybox && parent !== scene && !opts.showGreybox) carrierOnly(parent, model);
    out.push(rec);
  }
  scene.updateMatrixWorld(true);
  return out;
}

/** 美术件里的 `-interact` 节点（README-027：日志 / 告示 / 值班簿；交互焦点改读它） */
export function interactNode(m: MountedDressing | undefined): THREE.Object3D | null {
  return m ? findNode(m.model, 'interact') : null;
}
