import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { Component } from '../Component';

/** 偏差角（°）→ 对准度：≤ tolerance 为 1，≥ fade 为 0，中间线性（GDD §9：容差 6°、12° 内逐渐清晰） */
export function viewAlignment(
  angleDeg: number,
  toleranceDeg: number = gameplay.camera.viewpointToleranceDeg,
  fadeDeg: number = gameplay.camera.viewpointFadeDeg,
): number {
  if (angleDeg <= toleranceDeg) return 1;
  if (angleDeg >= fadeDeg) return 0;
  return 1 - (angleDeg - toleranceDeg) / (fadeDeg - toleranceDeg);
}

export interface ViewpointTargetOptions {
  /** 观察点区域中心（地面标记，世界坐标）与水平半径（m） */
  center: THREE.Vector3;
  radius?: number;
  /** 正确的观察方向（世界坐标，会归一化）；与 target 二选一 */
  direction?: THREE.Vector3;
  /** 或者：要看向的点（方向 = 相机 → 该点） */
  target?: THREE.Vector3;
  toleranceDeg?: number;
  fadeDeg?: number;
  /** 当前视线：相机位置与朝前方向（单位向量） */
  view: () => { position: THREE.Vector3; forward: THREE.Vector3 };
  /** 角色脚底位置（判断是否站在观察点上） */
  player: () => THREE.Vector3;
}

const want = new THREE.Vector3();

/**
 * 观察点（v0.1-003，谜题 4 用）：角色站在区域里、视线对准目标方向时，alignment 从 0 升到 1。
 * 谜题逻辑读 alignment 判断是否「看到了」，材质读它控制线索的清晰度。每帧 update 刷新。
 */
export class ViewpointTarget extends Component {
  alignment = 0;
  /** 当前视线与目标方向的夹角（°；不在区域内为 180） */
  angleDeg = 180;
  inRegion = false;
  readonly opts: ViewpointTargetOptions;

  constructor(opts: ViewpointTargetOptions) {
    super();
    this.opts = opts;
  }

  override update(): void {
    this.evaluate();
  }

  evaluate(): number {
    const o = this.opts;
    const p = o.player();
    this.inRegion = Math.hypot(p.x - o.center.x, p.z - o.center.z) <= (o.radius ?? 0.8);
    if (!this.inRegion) {
      this.angleDeg = 180;
      this.alignment = 0;
      return 0;
    }
    const v = o.view();
    if (o.target) want.subVectors(o.target, v.position);
    else want.copy(o.direction ?? new THREE.Vector3(0, 0, -1));
    want.normalize();
    this.angleDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(want.dot(v.forward), -1, 1)));
    this.alignment = viewAlignment(this.angleDeg, o.toleranceDeg, o.fadeDeg);
    return this.alignment;
  }
}
