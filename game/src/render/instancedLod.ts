import * as THREE from 'three';
import type { LodDistances } from '@/render/lod';

/**
 * 实例化 + LOD（v0.1-013，S1 礁石 164 个实例）。
 *
 * 美术的岩石 GLB：根节点下 `_lod0/1/2` 三个网格节点，**每个节点自带 translation / scale**（KHR_mesh_quantization：
 * 顶点是归一化整数，节点 scale ≈ 0.7、translation.y ≈ 0.31 负责还原到米）。只拿 geometry 做 InstancedMesh、忽略节点矩阵，
 * 石头就会缩小并陷进地里。这里每个实例矩阵 = 摆放矩阵（T·R·S）× 该级网格相对模型根的矩阵。
 *
 * 每级一个 InstancedMesh；update(camera) 按相机距离把实例分到各级（距离同 lodDistances，带 10 % 回滞），只改 count 和矩阵。
 */
export interface InstancePlacement {
  translation: readonly [number, number, number];
  rotationY: number;
  scale: readonly [number, number, number] | number;
}

interface Level {
  mesh: THREE.InstancedMesh;
  /** 网格相对模型根的矩阵（_lodN 节点自己的平移 / 缩放） */
  local: THREE.Matrix4;
}

const HYSTERESIS = 0.1;
const tmp = new THREE.Matrix4();
const v = new THREE.Vector3();
const frustum = new THREE.Frustum();
const sphere = new THREE.Sphere();

/** 摆放矩阵（T·R_y·S） */
export function placementMatrix(p: InstancePlacement, out = new THREE.Matrix4()): THREE.Matrix4 {
  const s = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
  return out.compose(
    new THREE.Vector3(...p.translation),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotationY),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
}

/**
 * 从加载好的模型根取各级 LOD 网格（THREE.LOD 的 levels，或没有 LOD 时的唯一网格）及其相对根的矩阵。
 * 跳过 collider / wall（extras.collider / wall → userData）。
 */
export function lodLevelsOf(root: THREE.Object3D): Array<{ mesh: THREE.Mesh; local: THREE.Matrix4 }> {
  const saved = root.matrix.clone();
  const savedParent = root.parent;
  root.removeFromParent();
  root.matrix.identity();
  root.matrix.decompose(root.position, root.quaternion, root.scale);
  root.updateMatrixWorld(true);
  const rel = (o: THREE.Object3D): THREE.Matrix4 => o.matrixWorld.clone();
  let out: Array<{ mesh: THREE.Mesh; local: THREE.Matrix4 }> = [];
  let lod: THREE.LOD | null = null;
  root.traverse((o) => {
    if (!lod && (o as THREE.LOD).isLOD) lod = o as THREE.LOD;
  });
  if (lod) {
    out = (lod as THREE.LOD).levels
      .map((l) => {
        let m: THREE.Mesh | null = null;
        l.object.traverse((c) => {
          if (!m && (c as THREE.Mesh).isMesh) m = c as THREE.Mesh;
        });
        return m ? { mesh: m as THREE.Mesh, local: rel(m) } : null;
      })
      .filter((x): x is { mesh: THREE.Mesh; local: THREE.Matrix4 } => x !== null);
  } else {
    root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && !c.userData.collider && !c.userData.wall && out.length === 0) out.push({ mesh: m, local: rel(m) });
    });
  }
  saved.decompose(root.position, root.quaternion, root.scale);
  root.updateMatrix();
  savedParent?.add(root);
  return out;
}

export class InstancedLodSet extends THREE.Group {
  readonly levels: Level[];
  readonly placements: THREE.Matrix4[];
  /** 每个实例当前所在的级 */
  private assigned: Int8Array;
  private distances: LodDistances = [Infinity, Infinity, Infinity];
  private readonly centers: THREE.Vector3[];
  /** 每个实例 LOD0 的包围球（本组坐标系），视锥剔除用 */
  private readonly spheres: THREE.Sphere[];
  private cull = false;
  private cullDistance = Infinity;

  constructor(model: THREE.Object3D, placements: readonly InstancePlacement[], opts: { name?: string; material?: (m: THREE.Material) => THREE.Material } = {}) {
    super();
    this.name = opts.name ?? 'instanced-lod';
    const src = lodLevelsOf(model);
    if (src.length === 0) throw new Error(`[instancedLod] ${model.name} 没有网格`);
    this.placements = placements.map((p) => placementMatrix(p));
    this.centers = this.placements.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    const n = placements.length;
    this.levels = src.map(({ mesh, local }, i) => {
      const mat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      const im = new THREE.InstancedMesh(mesh.geometry, opts.material ? opts.material(mat) : mat, n);
      im.name = `${this.name}-lod${i}`;
      im.castShadow = true;
      im.receiveShadow = true;
      im.count = 0;
      // 各级都可能放下全部实例：包围球按全部实例算一次（视锥剔除用），之后只改 count
      for (let k = 0; k < n; k++) im.setMatrixAt(k, tmp.multiplyMatrices(this.placements[k]!, local));
      im.count = n;
      im.computeBoundingSphere();
      im.count = 0;
      this.add(im);
      return { mesh: im, local };
    });
    const l0 = this.levels[0]!;
    if (!l0.mesh.geometry.boundingSphere) l0.mesh.geometry.computeBoundingSphere();
    const base = l0.mesh.geometry.boundingSphere!;
    this.spheres = this.placements.map((m) => base.clone().applyMatrix4(tmp.multiplyMatrices(m, l0.local)));
    this.assigned = new Int8Array(n).fill(-1);
    // 默认全部 LOD0（没有相机时）
    this.assignAll(() => 0);
  }

  /** 第 k 个实例 LOD0 的世界矩阵（测试读：摆放 × 节点矩阵） */
  instanceMatrix(k: number, level = 0, out = new THREE.Matrix4()): THREE.Matrix4 {
    const l = this.levels[Math.min(level, this.levels.length - 1)]!;
    return out.multiplyMatrices(this.placements[k]!, l.local).premultiply(this.matrixWorld);
  }

  setDistances(d: LodDistances): void {
    this.distances = d;
  }

  /**
   * 逐实例视锥剔除（不在画面里的实例不画），并且超过 maxDistance 的实例也不画。
   * 只在不投阴影时开：画面外的石头也会把影子投进画面里。
   */
  setCulling(on: boolean, maxDistance = Infinity): void {
    this.cull = on;
    this.cullDistance = maxDistance;
  }

  /** 各级当前实例数 */
  get counts(): number[] {
    return this.levels.map((l) => l.mesh.count);
  }

  private levelFor(dist: number, current: number): number {
    const max = this.levels.length - 1;
    let lvl = 0;
    for (let i = 0; i < max; i++) {
      const d = this.distances[i] ?? Infinity;
      // 回滞：已经在更粗级别时，要近 10 % 才切回来
      const th = current > i ? d * (1 - HYSTERESIS) : d;
      if (dist >= th) lvl = i + 1;
    }
    return lvl;
  }

  private assignAll(pick: (k: number, current: number) => number): void {
    let changed = false;
    const next = new Int8Array(this.assigned.length);
    for (let k = 0; k < next.length; k++) {
      next[k] = pick(k, this.assigned[k]!);
      if (next[k] !== this.assigned[k]) changed = true;
    }
    if (!changed) return;
    this.assigned = next;
    const counts = this.levels.map(() => 0);
    for (let k = 0; k < next.length; k++) {
      const li = next[k]!;
      if (li < 0) continue;
      const l = this.levels[li]!;
      l.mesh.setMatrixAt(counts[li]!++, tmp.multiplyMatrices(this.placements[k]!, l.local));
    }
    this.levels.forEach((l, i) => {
      l.mesh.count = counts[i]!;
      l.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** 按相机距离分级（每帧调用；没变化时不上传） */
  update(camera: THREE.Camera): void {
    this.updateWorldMatrix(true, false);
    camera.getWorldPosition(v);
    const inv = tmp.copy(this.matrixWorld).invert();
    const local = v.applyMatrix4(inv);
    const scale = this.matrixWorld.getMaxScaleOnAxis() || 1;
    if (this.cull) frustum.setFromProjectionMatrix(tmp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.assignAll((k, cur) => {
      if (this.cull && !frustum.intersectsSphere(sphere.copy(this.spheres[k]!).applyMatrix4(this.matrixWorld))) return -1;
      const dist = this.centers[k]!.distanceTo(local) * scale;
      if (this.cull && dist > this.cullDistance) return -1;
      return this.levelFor(dist, cur);
    });
  }
}
