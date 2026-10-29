import type * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { TextId } from '@/content/text';
import { Interactable, type InteractableOptions } from '@/systems/interaction/Interactable';
import type { TideController } from './TideController';

export interface TideBellOptions {
  /** Interactable id（提示系统高亮、谜题脚本都用它） */
  id: string;
  tide: TideController;
  /** 钟的根节点（焦点 = 包围盒中心，除非给 focus） */
  object: THREE.Object3D;
  /** 摆动的节点（白盒：绕局部 z 轴摆一下）；不给就不摆 */
  swing?: THREE.Object3D;
  interactPoint?: THREE.Object3D;
  focus?: THREE.Object3D | THREE.Vector3;
  reach?: number;
  prompt?: TextId;
  events: EventBus;
  /** v0.1-017 汐的敲钟动作（xi-ring-bell：钟声 / 切潮在第 30 帧 ring） */
  anim?: InteractableOptions['anim'];
}

/**
 * 潮汐钟（v0.1-011）：004 的 `use` 交互，敲一次切换所属分区的涨 / 退潮。
 * 过渡中（6 s）不可再敲：交互提示变灰（Interactable.blocked），按 E 无效。
 * 敲响时：钟摆动（白盒旋转）、发 `sfx:play { id: 'sfx-tide-bell' }`、发 `tide:bell { id, zone, state }`。
 */
export class TideBell {
  readonly id: string;
  readonly tide: TideController;
  readonly interactable: Interactable;
  /** 敲响次数（测试用） */
  rings = 0;
  private swingT = 0;
  private readonly swing: THREE.Object3D | null;
  private readonly baseZ: number;
  private readonly off: () => void;
  private readonly events: EventBus;

  constructor(opts: TideBellOptions) {
    this.id = opts.id;
    this.tide = opts.tide;
    this.events = opts.events;
    this.swing = opts.swing ?? null;
    this.baseZ = this.swing?.rotation.z ?? 0;
    this.interactable = new Interactable({
      id: opts.id,
      kind: 'use',
      prompt: opts.prompt ?? 'ui.prompt.ring',
      object: opts.object,
      ...(opts.interactPoint ? { interactPoint: opts.interactPoint } : {}),
      ...(opts.focus ? { focus: opts.focus } : {}),
      reach: opts.reach ?? 0.3,
      ...(opts.anim ? { anim: opts.anim } : {}),
    });
    this.interactable.blocked = () => this.tide.transitioning;
    this.off = opts.events.on('interact:used', ({ id }) => {
      if (id === this.id) this.ring();
    });
  }

  /** 敲钟（E 交互走到位后由 interact:used 触发；测试可直接调）。过渡中返回 false */
  ring(): boolean {
    if (!this.tide.toggle()) return false;
    this.rings++;
    this.swingT = gameplay.tide.bellSwingSec;
    this.events.emit('sfx:play', { id: 'sfx-tide-bell' });
    this.events.emit('tide:bell', { id: this.id, zone: this.tide.id, state: this.tide.state });
    return true;
  }

  /** 每帧：摆动动画 */
  update(dt: number): void {
    if (!this.swing || this.swingT <= 0) return;
    this.swingT = Math.max(0, this.swingT - dt);
    const k = this.swingT / gameplay.tide.bellSwingSec;
    this.swing.rotation.z = this.baseZ + Math.sin(this.swingT * 9) * 0.35 * k;
  }

  dispose(): void {
    this.off();
  }
}
