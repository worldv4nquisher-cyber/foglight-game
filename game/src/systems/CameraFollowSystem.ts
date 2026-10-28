import * as THREE from 'three';
import { gameConfig } from '@/config/gameConfig';
import type { InputManager } from './input/InputManager';

const cfg = gameConfig.camera;
const desired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const dir = new THREE.Vector3();

/**
 * 第三人称跟随相机：鼠标/触屏控制 yaw/pitch，绕目标旋转；
 * 平滑跟随；可选的遮挡检测（射线检测障碍物，拉近相机）。
 */
export class CameraFollowSystem {
  yaw = 0;
  pitch = 0.35;
  distance: number = cfg.distance;
  target: THREE.Object3D | null = null;
  /** 参与遮挡检测的物体 */
  occluders: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private currentDistance: number = cfg.distance;
  private initialized = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private input: InputManager,
  ) {}

  update(dt: number): void {
    const look = this.input.getLookDelta();
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, cfg.minPitch, cfg.maxPitch);
    // 滚轮调相机距离（explore 上下文才有值）
    const zoom = this.input.getZoomDelta();
    if (zoom !== 0) this.distance = THREE.MathUtils.clamp(this.distance + zoom * 0.5, cfg.minDistance, cfg.distance * 1.5);
    if (!this.target) return;

    lookTarget.copy(this.target.position);
    lookTarget.y += cfg.height;

    dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();

    // 遮挡：从目标向相机方向发射射线
    let dist = this.distance;
    if (this.occluders.length > 0) {
      this.raycaster.set(lookTarget, dir);
      this.raycaster.far = this.distance;
      const hit = this.raycaster.intersectObjects(this.occluders, false)[0];
      if (hit) dist = Math.max(cfg.minDistance, hit.distance - 0.3);
    }
    // 拉近立即生效，拉远平滑
    this.currentDistance =
      dist < this.currentDistance ? dist : THREE.MathUtils.damp(this.currentDistance, dist, 4, dt);

    desired.copy(lookTarget).addScaledVector(dir, this.currentDistance);
    desired.y = Math.max(desired.y, 0.3);

    if (!this.initialized) {
      this.camera.position.copy(desired);
      this.initialized = true;
    } else {
      const t = 1 - Math.exp(-cfg.followLerp * dt);
      this.camera.position.lerp(desired, t);
    }
    this.camera.lookAt(lookTarget);
  }
}
