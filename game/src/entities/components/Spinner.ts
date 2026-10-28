import * as THREE from 'three';
import { Component } from '../Component';

/** 自动旋转（占位立方体等展示物），可选上下浮动 */
export class Spinner extends Component {
  private t = 0;
  private baseY = 0;

  constructor(
    public speed = new THREE.Vector3(0.4, 0.9, 0),
    public bobAmplitude = 0.15,
    public bobSpeed = 1.5,
  ) {
    super();
  }

  override onAttach(): void {
    this.baseY = this.entity.object3D.position.y;
  }

  override update(dt: number): void {
    const o = this.entity.object3D;
    this.t += dt;
    o.rotation.x += this.speed.x * dt;
    o.rotation.y += this.speed.y * dt;
    o.rotation.z += this.speed.z * dt;
    o.position.y = this.baseY + Math.sin(this.t * this.bobSpeed) * this.bobAmplitude;
  }
}
