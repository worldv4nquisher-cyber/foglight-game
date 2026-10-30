import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { BeamColor } from './BeamEmitter';

/** ready = manual 模式的「可点灯」（等玩家按 E；不锁存，断光超过容差就退出） */
export type ReceiverState = 'idle' | 'charging' | 'blocked' | 'ready' | 'activated';
/** latch：满 holdSec 锁存 activated（光感锁）；manual：满 holdSec 进入 ready，由脚本 activate()（点火口，015） */
export type ReceiverMode = 'latch' | 'manual';

export interface BeamReceiverOptions {
  id: string;
  /** GLB 中 `<名>-receiver` 节点：球心 */
  node: THREE.Object3D;
  /** 判定半径（m），默认 0.3 */
  radius?: number;
  /** 持续命中多久触发（s）：光感锁 1.5、点火口 1.0（进入可点灯）（gameplay.beam.lockHoldSec / igniterHoldSec） */
  holdSec?: number;
  /** 前置条件（点火口：油阀已开）。不满足时命中只发红光，满 holdSec 发一次 receiver:blocked */
  requires?: () => boolean;
  /** 接收器是否吸收光（默认 true：光停在接收器上，不再往后走） */
  absorb?: boolean;
  /** 透镜网格（白盒版 BeamRenderer 按进度写自发光；024 / 034 换成正式材质） */
  lens?: THREE.Mesh;
  /** 默认 latch */
  mode?: ReceiverMode;
  /** 断光容差（s，默认 0）：断开 ≤ 此值不算断，受光进度不清零也不增加；ready 状态保持 */
  graceSec?: number;
  /** manual：ready 持续多久没被 activate() 发一次 ignition:reminder（s，0 = 不提醒；每次进入 ready 最多一次） */
  reminderSec?: number;
}

/** 提醒脉冲包络（s）：0.8 s 升到峰值、0.8 s 落回（美术 022 点火口四态表的落；升改 0.8 s 对齐 032 sfx-ignite-ready-pulse 膨胀峰 0.8 s，声画同峰） */
export const REMINDER_PULSE = { rise: 0.8, fall: 0.8 } as const;

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
  readonly mode: ReceiverMode;
  graceSec: number;
  reminderSec: number;
  state: ReceiverState = 'idle';
  /** manual：本次进入 ready 后经过的时间（s，含断光容差内） */
  readySec = 0;
  /** manual：本次 ready 是否已经提醒过 */
  reminded = false;
  /** 0–1 */
  progress = 0;
  /** 这一步是否被亮着的光命中 */
  hit = false;
  /** 命中它的光的颜色 / 光源 */
  hitColor: BeamColor | null = null;
  hitEmitter: string | null = null;
  private held = 0;
  private blockedSent = false;
  /** 连续断光时长（s） */
  private missSec = 0;
  private lastEmitter = '';
  private events: EventBus | null;

  constructor(opts: BeamReceiverOptions, events: EventBus | null = null) {
    this.id = opts.id;
    this.node = opts.node;
    this.radius = opts.radius ?? gameplay.beam.receiverRadius;
    this.holdSec = opts.holdSec ?? gameplay.beam.lockHoldSec;
    this.requires = opts.requires ?? null;
    this.absorb = opts.absorb ?? true;
    this.lens = opts.lens ?? null;
    this.mode = opts.mode ?? 'latch';
    this.graceSec = opts.graceSec ?? 0;
    this.reminderSec = opts.reminderSec ?? 0;
    this.events = events;
  }

  setEvents(events: EventBus | null): void {
    this.events = events;
  }

  get activated(): boolean {
    return this.state === 'activated';
  }

  /** manual：是否处于可点灯状态（含断光容差内） */
  get ready(): boolean {
    return this.state === 'ready';
  }

  /** manual：提醒脉冲强度 0–1（ignition:reminder 之后 1.6 s 内：0.8 s 升、0.8 s 落；其余时间 0），给渲染器加强微光 */
  get reminderPulse(): number {
    if (this.state !== 'ready' || !this.reminded) return 0;
    const t = this.readySec - this.reminderSec;
    if (t < 0) return 0;
    if (t < REMINDER_PULSE.rise) return t / REMINDER_PULSE.rise;
    const f = (t - REMINDER_PULSE.rise) / REMINDER_PULSE.fall;
    return f < 1 ? 1 - f : 0;
  }

  /** manual：脚本确认（按 E 点灯）→ 锁存 activated，之后光路不再影响它。只在 ready 时生效 */
  activate(): boolean {
    if (this.state !== 'ready') return false;
    this.state = 'activated';
    this.progress = 1;
    this.events?.emit('receiver:activated', { id: this.id, emitter: this.lastEmitter });
    return true;
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
    if (this.state === 'ready') {
      this.readySec += dt;
      if (this.reminderSec > 0 && !this.reminded && this.readySec >= this.reminderSec - 1e-6) {
        this.reminded = true;
        this.events?.emit('ignition:reminder', { id: this.id });
      }
    }
    if (!hit) {
      // 断光容差：≤ graceSec 什么都不变（进度不清零、ready 保持）
      this.missSec += dt;
      if (this.missSec <= this.graceSec + 1e-6) return;
      if (this.state === 'ready') this.exitReady();
      else if (this.state !== 'idle' || this.held > 0) {
        this.state = 'idle';
        this.held = 0;
        this.progress = 0;
        this.blockedSent = false;
        this.events?.emit('receiver:reset', { id: this.id });
      }
      return;
    }
    this.missSec = 0;
    this.lastEmitter = emitter ?? '';
    const ok = this.requires ? this.requires() : true;
    if (this.state === 'ready') {
      // 前置条件中途失效（测试场地 U 键关阀）：退出可点灯，下一步按未满足（红光）重新走
      if (!ok) this.exitReady();
      return;
    }
    // manual：前置条件刚满足（开阀时光仍在）→ 从这一刻重新计时
    if (ok && this.state === 'blocked' && this.mode === 'manual') {
      this.held = 0;
      this.blockedSent = false;
    }
    this.held += dt;
    this.progress = Math.min(1, this.held / this.holdSec);
    // 浮点累加：差 1e-6 s 也算满
    const full = this.held >= this.holdSec - 1e-6;
    if (ok) {
      this.state = 'charging';
      this.blockedSent = false;
      if (full) {
        this.progress = 1;
        if (this.mode === 'manual') {
          this.state = 'ready';
          this.readySec = 0;
          this.reminded = false;
          this.events?.emit('receiver:ready', { id: this.id, emitter: emitter ?? '' });
        } else {
          this.state = 'activated';
          this.events?.emit('receiver:activated', { id: this.id, emitter: emitter ?? '' });
        }
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
    this.missSec = 0;
    this.readySec = 0;
    this.reminded = false;
  }

  private exitReady(): void {
    this.state = 'idle';
    this.held = 0;
    this.progress = 0;
    this.blockedSent = false;
    this.readySec = 0;
    this.reminded = false;
    this.events?.emit('receiver:lost', { id: this.id });
    this.events?.emit('receiver:reset', { id: this.id });
  }

  debugLine(): string {
    const name = { idle: '待命', charging: '充能', blocked: '受阻', ready: '可点灯', activated: '已触发' }[this.state];
    return `${this.id} ${name} ${(this.progress * 100).toFixed(0)}%`;
  }
}
