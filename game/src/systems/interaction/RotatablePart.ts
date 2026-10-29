import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';

/** 一根旋转轴：绕所在节点的局部 x / y / z 轴转；角度单位 ° */
export interface RotationAxisSpec {
  axis: 'x' | 'y' | 'z';
  /** 转的节点（双轴镜：第一轴 mirror-yaw，第二轴是它的子节点 mirror-pitch）；默认用部件的 node */
  node?: THREE.Object3D;
  /** 角度范围（°）；不给 = 不限（按 0–360 循环） */
  min?: number;
  max?: number;
  /** 初始角度（°，R 重置回到它），默认 0 */
  initial?: number;
}

export interface RotatablePartOptions {
  id: string;
  /** 部件节点（原点在旋转轴上，021 / 022 约定）；描边高亮画在它的网格上 */
  node: THREE.Object3D;
  /** 1 根（单轴）或 2 根（双轴：鼠标上下 / W·S 控制第二轴） */
  axes: [RotationAxisSpec] | [RotationAxisSpec, RotationAxisSpec];
  /** 档位角（°），默认 gameplay.puzzle.stepDeg = 15 */
  stepDeg?: number;
  /** 精调档位（°），默认 7.5 */
  fineStepDeg?: number;
}

const EPS = 1e-6;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) } as const;
const tmpQ = new THREE.Quaternion();

/** 从 a 往 dir 方向走到下一个 step 的整数倍（按档吸附：7.5° 按 15° 档往右 → 15°） */
export function nextDetent(a: number, dir: 1 | -1, step: number): number {
  const k = a / step;
  const n = dir > 0 ? Math.floor(k + EPS) + 1 : Math.ceil(k - EPS) - 1;
  return Math.round(n * step * 1e6) / 1e6;
}

/** 角度规整到 [0, 360) */
export function wrap360(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return Math.abs(r - 360) < EPS ? 0 : Math.round(r * 1e6) / 1e6;
}

/**
 * 机关中的可旋转部件（v0.1-004）：单轴或双轴，按档吸附（默认 15°，精调 7.5°），有角度范围和初始角度。
 * 纯逻辑 + 写节点旋转：节点的初始朝向记为基准，当前旋转 = 基准 × 各轴旋转（第一轴在外）。
 */
export class RotatablePart {
  readonly id: string;
  readonly node: THREE.Object3D;
  readonly axes: readonly RotationAxisSpec[];
  readonly stepDeg: number;
  readonly fineStepDeg: number;
  /** 各轴当前角度（°） */
  readonly angles: number[];
  private readonly base: THREE.Quaternion[];

  constructor(opts: RotatablePartOptions) {
    this.id = opts.id;
    this.node = opts.node;
    this.axes = opts.axes;
    this.stepDeg = opts.stepDeg ?? gameplay.puzzle.stepDeg;
    this.fineStepDeg = opts.fineStepDeg ?? gameplay.puzzle.fineStepDeg;
    this.base = this.axes.map((a) => (a.node ?? this.node).quaternion.clone());
    this.angles = this.axes.map((a) => a.initial ?? 0);
    this.apply();
  }

  get dualAxis(): boolean {
    return this.axes.length > 1;
  }

  /**
   * 转一档：axis = 0 / 1，dir = ±1，fine = Shift 精调。到范围边界转不动时返回 false（不发事件）。
   */
  step(axis: number, dir: 1 | -1, fine = false): boolean {
    const spec = this.axes[axis];
    const cur = this.angles[axis];
    if (!spec || cur === undefined) return false;
    let next = nextDetent(cur, dir, fine ? this.fineStepDeg : this.stepDeg);
    const limited = spec.min !== undefined || spec.max !== undefined;
    if (limited) {
      next = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, next));
    } else next = wrap360(next);
    if (Math.abs(next - cur) < EPS) return false;
    this.angles[axis] = next;
    this.apply();
    return true;
  }

  /** 直接设角度（谜题脚本 / 测试用；不吸附） */
  setAngle(axis: number, deg: number): void {
    if (axis >= this.angles.length) return;
    this.angles[axis] = deg;
    this.apply();
  }

  /** 回到初始角度；返回是否有变化 */
  reset(): boolean {
    let changed = false;
    this.axes.forEach((a, i) => {
      const v = a.initial ?? 0;
      if (Math.abs((this.angles[i] ?? 0) - v) > EPS) changed = true;
      this.angles[i] = v;
    });
    this.apply();
    return changed;
  }

  get atInitial(): boolean {
    return this.axes.every((a, i) => Math.abs((this.angles[i] ?? 0) - (a.initial ?? 0)) < EPS);
  }

  private apply(): void {
    this.axes.forEach((a, i) => {
      const node = a.node ?? this.node;
      const base = this.base[i];
      if (!base) return;
      // 两根轴在同一个节点上：第二轴叠在第一轴之后（局部坐标）
      const sameNodeAsFirst = i > 0 && (a.node ?? this.node) === (this.axes[0]?.node ?? this.node);
      if (sameNodeAsFirst) {
        tmpQ.setFromAxisAngle(AXES[a.axis], THREE.MathUtils.degToRad(this.angles[i] ?? 0));
        node.quaternion.multiply(tmpQ);
      } else {
        tmpQ.setFromAxisAngle(AXES[a.axis], THREE.MathUtils.degToRad(this.angles[i] ?? 0));
        node.quaternion.copy(base).multiply(tmpQ);
      }
    });
    this.node.updateMatrixWorld(true);
  }
}
