import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { BeamColor } from './BeamEmitter';

export type ReceiverState = 'idle' | 'charging' | 'blocked' | 'activated';

export interface BeamReceiverOptions {
  id: string;
  /** GLB 中 `<名>-receiver` 节点：球心 */
  node: THREE.Object3D;
  /** 判定半径（m），默认 0.3 */
  radius?: number;
  /** 持续命中多久触发（s）：光感锁 1.5、点火口 2（gameplay.beam.lockHoldSec / igniterHoldSec） */
  holdSec?: number;
  /** 前置条件（点火口：油阀已开）。不满足时命中只发红光，满 holdSec 发一次 receiver:blocked */
  requires?: () => boolean;
  /** 接收器是否吸收光（默认 true：光停在接收器上，不再往后走） */
  absorb?: boolean;
  /** 透镜网格（白盒版 BeamRenderer 按进度写自发光；024 / 034 换成正式材质） */
  lens?: THREE.Mesh;
}

/**
 * 接收器（v0.1-012：光感锁 / 点火口）。光路命中半径内持续 holdSec 触发 receiver:activated（锁存，之后不再变化，除非 resetState）；
 * 中途光离开 → 进度归零并发 receiver:reset。progress 0–1 给材质（透镜逐渐变亮）。
 */
export class BeamReceiver {
  readonly id: string;
  readonly node: THREE.Object3D;
  readonly radius: number;
  holdSec: number;
  requires: (() => boolean) | null;
  readonly absorb: boolean;
  readonly lens: THREE.Mesh | null;
  state: ReceiverState = 'idle';
  /** 0–1 */
  progress = 0;
  /** 这一步是否被亮着的光命中 */
  hit = false;
  /** 命中它的光的颜色 / 光源 */
  hitColor: BeamColor | null = null;
  hitEmitter: string | null = null;
  private held = 0;
  private blockedSent = false;
  private events: EventBus | null;

  constructor(opts: BeamReceiverOptions, events: EventBus | null = null) {
    this.id = opts.id;
    this.node = opts.node;
    this.radius = opts.radius ?? gameplay.beam.receiverRadius;
    this.holdSec = opts.holdSec ?? gameplay.beam.lockHoldSec;
    this.requires = opts.requires ?? null;
    this.absorb = opts.absorb ?? true;
    this.lens = opts.lens ?? null;
    this.events = events;
  }

  setEvents(events: EventBus | null): void {
    this.events = events;
  }

  get activated(): boolean {
    return this.state === 'activated';
  }

  center(out = new THREE.Vector3()): THREE.Vector3 {
    this.node.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.node.matrixWorld);
  }

  /** 射线与判定球求交（入射点 t）；dir 单位向量 */
  intersect(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, center: THREE.Vector3): number | null {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - this.radius * this.radius;
    if (c > 0 && b > 0) return null;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = Math.max(0, -b - Math.sqrt(disc));
    return t < maxT ? t : null;
  }

  /** 每个物理步（BeamTracer 调）：hit = 被亮着的光命中 */
  fixedUpdate(dt: number, hit: boolean, color: BeamColor | null, emitter: string | null): void {
    this.hit = hit;
    this.hitColor = hit ? color : null;
    this.hitEmitter = hit ? emitter : null;
    if (this.state === 'activated') return;
    if (!hit) {
      if (this.state !== 'idle' || this.held > 0) {
        this.state = 'idle';
        this.held = 0;
        this.progress = 0;
        this.blockedSent = false;
        this.events?.emit('receiver:reset', { id: this.id });
      }
      return;
    }
    const ok = this.requires ? this.requires() : true;
    this.held += dt;
    this.progress = Math.min(1, this.held / this.holdSec);
    // 浮点累加：差 1e-6 s 也算满
    const full = this.held >= this.holdSec - 1e-6;
    if (ok) {
      this.state = 'charging';
      this.blockedSent = false;
      if (full) {
        this.state = 'activated';
        this.progress = 1;
        this.events?.emit('receiver:activated', { id: this.id, emitter: emitter ?? '' });
      }
    } else {
      this.state = 'blocked';
      if (full && !this.blockedSent) {
        this.blockedSent = true;
        this.events?.emit('receiver:blocked', { id: this.id, emitter: emitter ?? '' });
      }
    }
  }

  /** 谜题重置 / 测试：回到未触发 */
  resetState(): void {
    this.state = 'idle';
    this.held = 0;
    this.progress = 0;
    this.blockedSent = false;
  }

  debugLine(): string {
    const name = { idle: '待命', charging: '充能', blocked: '受阻', activated: '已触发' }[this.state];
    return `${this.id} ${name} ${(this.progress * 100).toFixed(0)}%`;
  }
}
