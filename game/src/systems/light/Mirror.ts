import * as THREE from 'three';
import type { RotatablePart } from '@/systems/interaction/RotatablePart';

export interface MirrorOptions {
  id: string;
  /**
   * 镜面：GLB 中 `<名>-mirror-plane` 节点（局部 z = 0 平面，+Z 为镜面法线，只有正面反射，背面挡光）。
   * 镜面大小默认取节点几何体包围盒的 x / y 半宽（PlaneGeometry 即宽高）；空节点必须给 halfWidth / halfHeight。
   */
  node: THREE.Object3D;
  halfWidth?: number;
  halfHeight?: number;
  /** 挂在哪个 004 可旋转部件上（只用于调试显示；转动由 RotatablePart 写节点旋转，光路按矩阵变化重算） */
  part?: RotatablePart;
}

export interface MirrorHit {
  t: number;
  point: THREE.Vector3;
  /** 世界坐标镜面法线（单位向量，正面朝向） */
  normal: THREE.Vector3;
  /** 光从正面射入 = 反射；背面 = 挡光 */
  front: boolean;
}

const invM = new THREE.Matrix4();
const lo = new THREE.Vector3();
const lp = new THREE.Vector3();
const ld = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);

/** 反射定律：d' = d - 2 (d·n) n（n 为单位法线） */
export function reflect(d: THREE.Vector3, n: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(d).addScaledVector(n, -2 * d.dot(n));
}

/** 镜子（v0.1-012）：解析平面求交，不进物理系统 */
export class Mirror {
  readonly id: string;
  readonly node: THREE.Object3D;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly part: RotatablePart | null;

  constructor(opts: MirrorOptions) {
    this.id = opts.id;
    this.node = opts.node;
    this.part = opts.part ?? null;
    let hw = opts.halfWidth;
    let hh = opts.halfHeight;
    const geo = (opts.node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if ((hw === undefined || hh === undefined) && geo) {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (b) {
        hw ??= Math.max(Math.abs(b.min.x), Math.abs(b.max.x));
        hh ??= Math.max(Math.abs(b.min.y), Math.abs(b.max.y));
      }
    }
    if (hw === undefined || hh === undefined) throw new Error(`Mirror ${opts.id}: 镜面节点没有几何体，需要给 halfWidth / halfHeight`);
    this.halfWidth = hw;
    this.halfHeight = hh;
  }

  /** 世界法线（正面） */
  normal(out = new THREE.Vector3()): THREE.Vector3 {
    this.node.updateWorldMatrix(true, false);
    return out.copy(FWD).transformDirection(this.node.matrixWorld);
  }

  center(out = new THREE.Vector3()): THREE.Vector3 {
    this.node.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.node.matrixWorld);
  }

  /** 射线（origin + dir·t，dir 单位向量）与镜面求交；t ∈ (minT, maxT) */
  intersect(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, minT = 1e-4): MirrorHit | null {
    // 调用方（BeamTracer）每次重算前已 updateMatrixWorld，这里直接读矩阵
    const m = this.node.matrixWorld;
    invM.copy(m).invert();
    lo.copy(origin).applyMatrix4(invM);
    // 局部方向不归一化：t 与世界一致（支持缩放）
    ld.copy(origin).add(dir).applyMatrix4(invM).sub(lo);
    if (Math.abs(ld.z) < 1e-9) return null;
    const t = -lo.z / ld.z;
    if (!(t > minT && t < maxT)) return null;
    lp.copy(lo).addScaledVector(ld, t);
    if (Math.abs(lp.x) > this.halfWidth || Math.abs(lp.y) > this.halfHeight) return null;
    return {
      t,
      point: origin.clone().addScaledVector(dir, t),
      normal: FWD.clone().transformDirection(m),
      front: ld.z < 0,
    };
  }
}
