import * as THREE from 'three';
import { Component } from '../Component';

/**
 * 运动学刚体（由 PhysicsSystem 驱动）。
 * position 为模拟位置（脚底中心），object3D 在 update 中按 alpha 插值显示，
 * 这样高刷屏（120/144Hz）下移动也平滑。
 * 碰撞体为 AABB：半宽 radius，高 height。
 */
export class KinematicBody extends Component {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  onGround = false;
  useGravity = true;
  /** 上一个物理步是否刚落地，以及落地时的下落速度 */
  justLanded = false;
  impactSpeed = 0;

  constructor(
    public radius: number,
    public height: number,
  ) {
    super();
  }

  override onAttach(): void {
    this.position.copy(this.entity.object3D.position);
    this.prevPosition.copy(this.position);
  }

  teleport(p: THREE.Vector3): void {
    this.position.copy(p);
    this.prevPosition.copy(p);
    this.velocity.set(0, 0, 0);
    this.entity.object3D.position.copy(p);
  }

  override update(_dt: number, alpha: number): void {
    this.entity.object3D.position.lerpVectors(this.prevPosition, this.position, alpha);
  }
}
