import * as THREE from 'three';
import { gameConfig } from '@/config/gameConfig';
import type { KinematicBody } from '@/entities/components/KinematicBody';

const EPS = 1e-4;
const bodyBox = new THREE.Box3();

/**
 * 简易物理：重力 + AABB 分轴碰撞（静态碰撞体）。
 * 足够做平台跳跃/第三人称原型；以后需要斜坡、刚体、角色胶囊精确碰撞时，
 * 可在不改玩法代码的前提下替换为 Rapier（@dimforge/rapier3d-compat）。
 */
export class PhysicsSystem {
  readonly colliders: THREE.Box3[] = [];
  private bodies: KinematicBody[] = [];
  gravity = gameConfig.player.gravity;
  /** 低于此高度视为掉出世界 */
  killY = -30;
  onFallOut?: (body: KinematicBody) => void;

  addBody(body: KinematicBody): void {
    this.bodies.push(body);
  }

  removeBody(body: KinematicBody): void {
    this.bodies = this.bodies.filter((b) => b !== body);
  }

  /** 以物体当前世界包围盒注册静态碰撞体 */
  addStaticFromObject(obj: THREE.Object3D): THREE.Box3 {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    this.colliders.push(box);
    return box;
  }

  addStaticBox(box: THREE.Box3): void {
    this.colliders.push(box);
  }

  step(dt: number): void {
    for (const b of this.bodies) {
      if (!b.enabled) continue;
      b.prevPosition.copy(b.position);
      const wasOnGround = b.onGround;
      const fallSpeed = Math.max(0, -b.velocity.y);
      b.justLanded = false;

      if (b.useGravity) {
        b.velocity.y = Math.max(b.velocity.y - this.gravity * dt, -gameConfig.player.maxFallSpeed);
      }
      b.onGround = false;
      this.moveAxis(b, 'x', b.velocity.x * dt);
      this.moveAxis(b, 'z', b.velocity.z * dt);
      this.moveAxis(b, 'y', b.velocity.y * dt);

      if (b.onGround && !wasOnGround) {
        b.justLanded = true;
        b.impactSpeed = fallSpeed;
      }
      if (b.position.y < this.killY) this.onFallOut?.(b);
    }
  }

  private setBodyBox(b: KinematicBody): THREE.Box3 {
    const p = b.position;
    bodyBox.min.set(p.x - b.radius, p.y, p.z - b.radius);
    bodyBox.max.set(p.x + b.radius, p.y + b.height, p.z + b.radius);
    return bodyBox;
  }

  private moveAxis(b: KinematicBody, axis: 'x' | 'y' | 'z', delta: number): void {
    if (delta === 0 && axis !== 'y') return;
    b.position[axis] += delta;
    const box = this.setBodyBox(b);
    for (const c of this.colliders) {
      if (!overlaps(box, c)) continue;
      if (axis === 'y') {
        if (delta <= 0) {
          b.position.y = c.max.y;
          b.onGround = true;
        } else {
          b.position.y = c.min.y - b.height - EPS;
        }
        b.velocity.y = 0;
      } else {
        const half = b.radius;
        b.position[axis] = delta > 0 ? c.min[axis] - half - EPS : c.max[axis] + half + EPS;
        b.velocity[axis] = 0;
      }
      this.setBodyBox(b);
    }
    // 站在平台上时做一次接地探测（delta 可能为 0）
    if (axis === 'y' && !b.onGround) {
      box.min.y -= 0.02;
      for (const c of this.colliders) {
        if (overlaps(box, c) && b.velocity.y <= 0) {
          b.onGround = true;
          break;
        }
      }
    }
  }

  clear(): void {
    this.colliders.length = 0;
    this.bodies = [];
  }
}

function overlaps(a: THREE.Box3, b: THREE.Box3): boolean {
  return (
    a.min.x < b.max.x - EPS &&
    a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS &&
    a.max.z > b.min.z + EPS
  );
}
