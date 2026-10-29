import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { Interactable } from '@/systems/interaction/Interactable';
import type { TideRegion } from './TideController';

export type FloatState = 'grounded' | 'floating' | 'drifting';

export interface FloatableOptions {
  id: string;
  /** 浮物根节点（父节点不旋转不缩放，一般直接挂在场景 / 关卡根上）；它的网格注册成 dynamic 碰撞体，角色可站上去 */
  object: THREE.Object3D;
  /** 搁浅高度（根节点 y），默认当前 y */
  restY?: number;
  /** 浮起时根节点比水面高多少：y = max(restY, level + floatOffset) */
  floatOffset: number;
  /** 漂浮时的起伏（±2 cm，3 s 一个周期）；站立要求绝对稳定时关掉。默认开 */
  bob?: boolean;
  /** 锚位（石槽）：根节点在这些区域里涨潮 = 原地浮起；不在 = 2 s 漂回 homePosition */
  anchors?: TideRegion[];
  /** 原位（漂回的目标），默认当前位置 */
  homePosition?: THREE.Vector3;
  /** 搁浅时可推的 push 交互（004）：浮起时禁用（按 E 没有推动提示），漂回原位后轨道进度归零、重新可推 */
  push?: Interactable;
  events?: EventBus;
}

const cfg = gameplay.tide;
const tmp = new THREE.Vector3();

/**
 * 浮物（v0.1-011，GDD §8「浮物」、谜题 2 浮台）：
 * - 搁浅：y = restY；可以沿轨道推（push 交互）。
 * - 水面升到 level + floatOffset > restY 时浮起：在锚位里 → 原地随水位升到 1.6 + offset；不在锚位里 → 2 s 演出漂回原位。
 * - 漂浮时轻微起伏（可关）。根节点每步写位置并 updateMatrixWorld，dynamic 碰撞体随之移动，站在上面的角色被带着升降。
 * 由 TideController.fixedUpdate 驱动（角色物理之前）。
 */
export class Floatable {
  readonly id: string;
  readonly object: THREE.Object3D;
  readonly restY: number;
  readonly floatOffset: number;
  bob: boolean;
  readonly anchors: readonly TideRegion[];
  readonly home: THREE.Vector3;
  readonly push: Interactable | null;
  state: FloatState = 'grounded';
  private time = 0;
  private drift: { from: THREE.Vector3; t: number } | null = null;
  private readonly events: EventBus | null;

  constructor(opts: FloatableOptions) {
    this.id = opts.id;
    this.object = opts.object;
    this.restY = opts.restY ?? opts.object.position.y;
    this.floatOffset = opts.floatOffset;
    this.bob = opts.bob ?? true;
    this.anchors = opts.anchors ?? [];
    this.home = (opts.homePosition ?? opts.object.position).clone();
    this.push = opts.push ?? null;
    this.events = opts.events ?? null;
  }

  /** 根节点现在是否在任一锚位里 */
  get inAnchor(): boolean {
    const p = this.object.getWorldPosition(tmp);
    return this.anchors.some((a) => a(p));
  }

  /** 是否浮着（含漂回途中） */
  get afloat(): boolean {
    return this.state !== 'grounded';
  }

  /** 直接按水位放好（场景初始化 / 瞬间切潮）：不演出 */
  snap(level: number): void {
    this.drift = null;
    const floating = level + this.floatOffset > this.restY + 1e-4;
    if (floating && !this.inAnchor && this.state === 'grounded') this.object.position.set(this.home.x, this.object.position.y, this.home.z);
    if (floating && this.push && !this.inAnchor) this.resetPush();
    this.setState(floating ? 'floating' : 'grounded');
    this.object.position.y = Math.max(this.restY, level + this.floatOffset);
    this.object.updateMatrixWorld(true);
  }

  fixedUpdate(dt: number, level: number): void {
    this.time += dt;
    const floatY = level + this.floatOffset;
    const floating = floatY > this.restY + 1e-4;
    const pos = this.object.position;

    if (floating && this.state === 'grounded') {
      // 刚离开地面：在锚位里原地浮起，否则漂回原位
      if (this.inAnchor) this.setState('floating');
      else {
        this.drift = { from: pos.clone(), t: 0 };
        this.resetPush();
        this.setState('drifting');
      }
    }
    if (this.drift) {
      this.drift.t += dt;
      const u = Math.min(1, this.drift.t / cfg.floatDriftSec);
      const k = u * u * (3 - 2 * u);
      pos.x = this.drift.from.x + (this.home.x - this.drift.from.x) * k;
      pos.z = this.drift.from.z + (this.home.z - this.drift.from.z) * k;
      if (u >= 1) {
        this.drift = null;
        this.setState(floating ? 'floating' : 'grounded');
      }
    } else if (!floating && this.state !== 'grounded') this.setState('grounded');

    let y = Math.max(this.restY, floatY);
    if (this.bob && y > this.restY + 1e-4) {
      // 起伏幅度随离地高度渐入（刚浮起 / 快搁浅时不跳）
      const fade = Math.min(1, (y - this.restY) / 0.1);
      y += Math.sin((this.time / cfg.floatBobPeriod) * Math.PI * 2) * cfg.floatBobAmplitude * fade;
    }
    pos.y = y;
    this.object.updateMatrixWorld(true);
    if (this.push) this.push.enabled = this.state === 'grounded';
  }

  private resetPush(): void {
    if (!this.push) return;
    this.push.pushT = 0;
    this.push.locked = false;
  }

  private setState(s: FloatState): void {
    if (s === this.state) return;
    this.state = s;
    if (this.push) this.push.enabled = s === 'grounded';
    this.events?.emit('float:state', { id: this.id, state: s });
  }
}
