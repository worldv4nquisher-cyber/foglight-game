import * as THREE from 'three';
import { gameConfig } from '@/config/gameConfig';
import type { EventBus } from '@/core/EventBus';
import type { InputManager } from '@/systems/input/InputManager';
import { Component } from '../Component';
import { KinematicBody } from './KinematicBody';

const cfg = gameConfig.player;
const tmp = new THREE.Vector3();

/** 玩家控制：读取抽象 action，按相机朝向移动（本作不做跳跃，GDD §15）；模型朝向移动方向 */
export class PlayerController extends Component {
  private body!: KinematicBody;
  private facing = 0;

  constructor(
    private input: InputManager,
    private getCameraYaw: () => number,
    private events: EventBus,
    /** 需要转向的可视节点（通常是模型子节点） */
    private visual: THREE.Object3D,
  ) {
    super();
  }

  override onAttach(): void {
    this.body = this.entity.require(KinematicBody);
  }

  override fixedUpdate(dt: number): void {
    const move = this.input.getMove();
    const yaw = this.getCameraYaw();
    // 相机前方（XZ 平面）与右方
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const speed = cfg.moveSpeed * (this.input.isDown('sprint') ? 1.6 : 1);
    tmp.set(rx * move.x + fx * move.y, 0, rz * move.x + fz * move.y).multiplyScalar(speed);

    const v = this.body.velocity;
    const accel = cfg.acceleration * (this.body.onGround ? 1 : cfg.airControl);
    const maxDelta = accel * dt;
    v.x += THREE.MathUtils.clamp(tmp.x - v.x, -maxDelta, maxDelta);
    v.z += THREE.MathUtils.clamp(tmp.z - v.z, -maxDelta, maxDelta);

    if (this.body.justLanded) {
      this.events.emit('player:land', { impactSpeed: this.body.impactSpeed });
    }

    if (tmp.lengthSq() > 0.01) this.facing = Math.atan2(tmp.x, tmp.z);
  }

  override update(dt: number): void {
    // 平滑转向
    const cur = this.visual.rotation.y;
    let diff = this.facing - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.visual.rotation.y = cur + diff * Math.min(1, dt * 12);
  }
}
