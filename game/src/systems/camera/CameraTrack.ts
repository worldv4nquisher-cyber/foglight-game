import * as THREE from 'three';

/** 相机姿态：位置 + 朝向 + FOV */
export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
}

export function makePose(): CameraPose {
  return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 55 };
}

export function copyPose(out: CameraPose, src: CameraPose): CameraPose {
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.fov = src.fov;
  return out;
}

/** a → b 按 k（0–1）混合（位置线性、朝向球面插值、FOV 线性） */
export function mixPose(out: CameraPose, a: CameraPose, b: CameraPose, k: number): CameraPose {
  out.position.lerpVectors(a.position, b.position, k);
  out.quaternion.copy(a.quaternion).slerp(b.quaternion, k);
  out.fov = a.fov + (b.fov - a.fov) * k;
  return out;
}

export function smoothstep01(x: number): number {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
}

const m4 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** 相机从 position 看向 target 的朝向（three 相机看 -Z） */
export function lookRotation(position: THREE.Vector3, target: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  m4.lookAt(position, target, UP);
  return out.setFromRotationMatrix(m4);
}

export interface CameraKey {
  /** 时间（s，从 0 开始） */
  time: number;
  position: THREE.Vector3;
  /** 看向的点（与 quaternion 二选一） */
  lookAt?: THREE.Vector3;
  quaternion?: THREE.Quaternion;
  fov?: number;
}

export interface CameraTrackOptions {
  /** 关键帧（按时间排序；至少一个） */
  keys?: CameraKey[];
  /**
   * 或者：跟随一个被动画驱动的节点（GLB 里的相机动画，由调用方的 AnimationMixer 推进）。
   * 节点是 PerspectiveCamera 时也读取它的 fov。
   */
  node?: THREE.Object3D;
  /** 总时长（s）；不传 = 最后一个关键帧的时间 */
  duration?: number;
  /** 整体缓入缓出（默认 true） */
  ease?: boolean;
  /** 允许按住空格跳过（默认 true；建立镜头也可跳过） */
  skippable?: boolean;
  name?: string;
}

/**
 * 镜头轨道（v0.1-003 演出 / 建立镜头接口）。演出本身（035）只需要构造轨道交给 camera.playCutscene()。
 */
export class CameraTrack {
  readonly duration: number;
  readonly ease: boolean;
  readonly skippable: boolean;
  readonly name: string;
  private readonly keys: Array<{ time: number; pose: CameraPose }>;
  private readonly node: THREE.Object3D | null;

  constructor(opts: CameraTrackOptions) {
    this.node = opts.node ?? null;
    this.ease = opts.ease ?? true;
    this.skippable = opts.skippable ?? true;
    this.name = opts.name ?? 'track';
    const keys = [...(opts.keys ?? [])].sort((a, b) => a.time - b.time);
    let lastFov = 55;
    this.keys = keys.map((k) => {
      const q = k.quaternion?.clone() ?? lookRotation(k.position, k.lookAt ?? k.position.clone().add(new THREE.Vector3(0, 0, -1)));
      lastFov = k.fov ?? lastFov;
      return { time: k.time, pose: { position: k.position.clone(), quaternion: q, fov: lastFov } };
    });
    if (!this.node && this.keys.length === 0) throw new Error('CameraTrack 需要 keys 或 node');
    this.duration = Math.max(1e-3, opts.duration ?? this.keys[this.keys.length - 1]?.time ?? 1);
  }

  /** t（s）时刻的姿态 */
  sample(t: number, out: CameraPose): CameraPose {
    if (this.node) {
      this.node.updateWorldMatrix(true, false);
      this.node.matrixWorld.decompose(out.position, out.quaternion, tmpScale);
      if ((this.node as THREE.PerspectiveCamera).isPerspectiveCamera) out.fov = (this.node as THREE.PerspectiveCamera).fov;
      return out;
    }
    const u = Math.min(1, Math.max(0, t / this.duration));
    const time = (this.ease ? smoothstep01(u) : u) * this.duration;
    const first = this.keys[0];
    if (!first) return out;
    if (time <= first.time || this.keys.length === 1) return copyPose(out, first.pose);
    for (let i = 1; i < this.keys.length; i++) {
      const a = this.keys[i - 1];
      const b = this.keys[i];
      if (!a || !b) continue;
      if (time <= b.time) return mixPose(out, a.pose, b.pose, b.time > a.time ? (time - a.time) / (b.time - a.time) : 1);
    }
    const last = this.keys[this.keys.length - 1];
    return last ? copyPose(out, last.pose) : out;
  }
}

const tmpScale = new THREE.Vector3();
