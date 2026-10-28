import type * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { CharacterBody } from '@/systems/PhysicsSystem';
import { Component } from '../Component';

/**
 * 角色刚体组件：持有一个 CharacterBody（由 PhysicsSystem 驱动，胶囊 vs BVH）。
 * body.position 是模拟位置（脚底中心）；object3D 在 update 里按 alpha 插值显示（高刷屏也平滑），
 * 迈台阶的竖直跳变用一个衰减偏移抹平（GDD：走楼梯不能一级一级抖）。
 */
export class KinematicBody extends Component {
  readonly body: CharacterBody;
  /** 视觉上的竖直平滑偏移（迈台阶时为负值，逐渐回到 0） */
  private stepOffset = 0;

  constructor(radius: number = gameplay.player.radius, height: number = gameplay.player.height) {
    super();
    this.body = new CharacterBody(radius, height);
  }

  get position(): THREE.Vector3 {
    return this.body.position;
  }
  get velocity(): THREE.Vector3 {
    return this.body.velocity;
  }
  get onGround(): boolean {
    return this.body.onGround;
  }

  override onAttach(): void {
    this.body.teleport(this.entity.object3D.position);
  }

  teleport(p: THREE.Vector3): void {
    this.body.teleport(p);
    this.stepOffset = 0;
    this.entity.object3D.position.copy(p);
  }

  /** 由场景在 physics.step 之后调用，收集本步的台阶跳变 */
  afterPhysics(): void {
    if (this.body.stepUp > 0) this.stepOffset = Math.max(-0.45, this.stepOffset - this.body.stepUp);
  }

  override update(dt: number, alpha: number): void {
    const o = this.entity.object3D.position;
    o.lerpVectors(this.body.prevPosition, this.body.position, alpha);
    if (this.stepOffset < 0) {
      const k = 1 - Math.exp(-dt / Math.max(1e-3, gameplay.player.stepSmoothTime));
      this.stepOffset += (0 - this.stepOffset) * k;
      if (this.stepOffset > -1e-3) this.stepOffset = 0;
      o.y += this.stepOffset;
    }
  }
}
