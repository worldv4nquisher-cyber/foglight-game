import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';

export type BeamColor = 'warm' | 'coldWhite';
/**
 * - socket：风灯放到带聚光罩的灯台 socket 上时亮（谜题 3）；从 socket 拿起就灭
 * - sky：云缝天光，按周期开关（默认 40 s 一周期、亮 25 s），收到 beam:skyAlwaysOn 后常亮（谜题 5 开油阀后）
 * - manual：脚本 / 测试直接 setOn
 */
export type BeamEmitterKind = 'socket' | 'sky' | 'manual';

export interface BeamEmitterOptions {
  id: string;
  /** 发射点：GLB 中 `<名>-emitter` 空节点，光沿它的 +Z 射出 */
  node: THREE.Object3D;
  kind: BeamEmitterKind;
  color?: BeamColor;
  /** manual / socket 的初始开关；sky 忽略（按周期） */
  on?: boolean;
  /** socket 类型：灯台 socket 节点名；item 不给 = 放什么都亮 */
  socket?: string;
  item?: string;
  /** sky：周期 / 亮的时长 / 起始相位（s） */
  periodSec?: number;
  onSec?: number;
  phaseSec?: number;
  alwaysOn?: boolean;
  /** 淡入淡出时长（s）：sky 默认 1 s，其余 0.3 s */
  fadeSec?: number;
}

const FWD = new THREE.Vector3(0, 0, 1);

/** 光源（v0.1-012）：位置 + 方向取节点世界变换；intensity 0–1 用于画面淡入淡出，lit（intensity ≥ 0.5）用于接收器判定 */
export class BeamEmitter {
  readonly id: string;
  readonly node: THREE.Object3D;
  readonly kind: BeamEmitterKind;
  color: BeamColor;
  /** 0–1（画面用） */
  intensity: number;
  readonly periodSec: number;
  readonly onSec: number;
  readonly fadeSec: number;
  alwaysOn: boolean;
  /** sky 周期内的时间（s） */
  skyTime: number;
  readonly socket: string | null;
  readonly item: string | null;
  private on: boolean;
  private wasLit: boolean;

  constructor(opts: BeamEmitterOptions) {
    const cfg = gameplay.beam;
    this.id = opts.id;
    this.node = opts.node;
    this.kind = opts.kind;
    this.color = opts.color ?? (opts.kind === 'sky' ? 'coldWhite' : 'warm');
    this.periodSec = opts.periodSec ?? cfg.skyPeriodSec;
    this.onSec = opts.onSec ?? cfg.skyOnSec;
    this.fadeSec = opts.fadeSec ?? (opts.kind === 'sky' ? cfg.skyFadeSec : cfg.switchFadeSec);
    this.alwaysOn = opts.alwaysOn ?? false;
    this.skyTime = opts.phaseSec ?? 0;
    this.socket = opts.socket ?? null;
    this.item = opts.item ?? null;
    this.on = opts.kind === 'sky' ? this.skyTarget() : (opts.on ?? false);
    this.intensity = this.on ? 1 : 0;
    this.wasLit = this.lit;
  }

  /** 逻辑上亮着（淡入过半）：接收器只认亮着的光 */
  get lit(): boolean {
    return this.intensity >= 0.5;
  }

  /** 目标开关（淡入淡出前） */
  get targetOn(): boolean {
    return this.on;
  }

  setOn(on: boolean, instant = false): void {
    this.on = on;
    if (instant) this.intensity = on ? 1 : 0;
  }

  setColor(c: BeamColor): void {
    this.color = c;
  }

  setAlwaysOn(v: boolean): void {
    this.alwaysOn = v;
  }

  /** 世界坐标发射点与方向（单位向量，节点 +Z） */
  origin(out: THREE.Vector3): THREE.Vector3 {
    this.node.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.node.matrixWorld);
  }

  direction(out: THREE.Vector3): THREE.Vector3 {
    this.node.updateWorldMatrix(true, false);
    return out.copy(FWD).transformDirection(this.node.matrixWorld);
  }

  private skyTarget(): boolean {
    if (this.alwaysOn) return true;
    const t = ((this.skyTime % this.periodSec) + this.periodSec) % this.periodSec;
    return t < this.onSec;
  }

  /** 每个物理步：推进周期与淡入淡出；返回 lit 是否翻转 */
  update(dt: number): boolean {
    if (this.kind === 'sky') {
      if (!this.alwaysOn) this.skyTime = (this.skyTime + dt) % this.periodSec;
      this.on = this.skyTarget();
    }
    const target = this.on ? 1 : 0;
    if (this.intensity !== target) {
      const step = this.fadeSec > 0 ? dt / this.fadeSec : 1;
      this.intensity = target > this.intensity ? Math.min(1, this.intensity + step) : Math.max(0, this.intensity - step);
    }
    const lit = this.lit;
    const flipped = lit !== this.wasLit;
    this.wasLit = lit;
    return flipped;
  }

  /** 订阅事件：socket 放 / 拿、颜色切换、天光常亮。返回取消订阅 */
  bind(events: EventBus): () => void {
    const offs = [
      events.on('beam:setColor', ({ id, color }) => {
        if (id === this.id) this.setColor(color);
      }),
      events.on('beam:skyAlwaysOn', ({ id, alwaysOn }) => {
        if (id === this.id) this.setAlwaysOn(alwaysOn);
      }),
    ];
    if (this.kind === 'socket' && this.socket) {
      offs.push(
        events.on('item:place', ({ item, socket }) => {
          if (socket === this.socket && (!this.item || item === this.item)) this.setOn(true);
        }),
        events.on('item:pickup', ({ item, from }) => {
          if (from === this.socket && (!this.item || item === this.item)) this.setOn(false);
        }),
      );
    }
    return () => offs.forEach((f) => f());
  }

  debugLine(): string {
    const name = this.color === 'warm' ? '暖' : '冷白';
    const sky = this.kind === 'sky' ? (this.alwaysOn ? ' 常亮' : ` ${this.skyTime.toFixed(0)}/${this.periodSec}s`) : '';
    return `${this.id} ${this.lit ? '亮' : '灭'}${name}${sky} ${(this.intensity * 100).toFixed(0)}%`;
  }
}
