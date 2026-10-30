import type * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import { xiEventSec } from '@/entities/xi/clips';
import type { TextId } from '@/content/text';
import { Interactable, type InteractableOptions } from '@/systems/interaction/Interactable';
import type { TideController } from './TideController';

/** 钟锤碰壁补音（032 批次；manifest pending，缺失静默） */
export const CLAPPER_SFX = 'sfx-tide-bell-clapper';

export interface TideBellOptions {
  /** Interactable id（提示系统高亮、谜题脚本都用它） */
  id: string;
  tide: TideController;
  /** 钟的根节点（焦点 = 包围盒中心，除非给 focus） */
  object: THREE.Object3D;
  /** 摆动的节点（白盒：绕局部 z 轴摆，局部 +X = 站位方向）；不给就不摆 */
  swing?: THREE.Object3D;
  /** 钟锤（白盒空节点，swing 的子节点，绕局部 z 轴相对钟体摆；美术 bell-clapper 跟它转）；不给就不算 */
  clapper?: THREE.Object3D;
  /** 正在播的交互动作（InteractionSystem.animState）：xi-ring-bell 的 touch → ring 段钟跟着手掌推 */
  animSource?: { readonly animState: { id?: string; clip: string; t: number; fired: boolean } | null };
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
  /** 敲响后经过的时间（s）；null = 没在自由摆 */
  private freeT: number | null = null;
  private idleT = 0;
  private clock = 0;
  /** 钟体角度历史（钟锤滞后用）：[时间, θ] */
  private readonly hist: [number, number][] = [];
  /** 当前钟体角度（rad，美术约定：正 = 钟口被推开、远离站位）（测试读） */
  angle = 0;
  /** 钟锤相对钟体的角度（rad，同号约定）（测试读） */
  clapperAngle = 0;
  /** 钟锤碰壁次数（测试读）；|相对角| 上升沿到 clapperHitRad 记一次并补 sfx-tide-bell-clapper（文件缺失静默，可叠主钟声） */
  clapperHits = 0;
  private clapperTouching = false;
  private readonly swing: THREE.Object3D | null;
  private readonly clapper: THREE.Object3D | null;
  private readonly animSource: TideBellOptions['animSource'] | null;
  private readonly baseZ: number;
  private readonly clapperBaseZ: number;
  private readonly off: () => void;
  private readonly events: EventBus;

  constructor(opts: TideBellOptions) {
    this.id = opts.id;
    this.tide = opts.tide;
    this.events = opts.events;
    this.swing = opts.swing ?? null;
    this.clapper = opts.clapper ?? null;
    this.animSource = opts.animSource ?? null;
    this.baseZ = this.swing?.rotation.z ?? 0;
    this.clapperBaseZ = this.clapper?.rotation.z ?? 0;
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
    this.freeT = 0;
    this.events.emit('sfx:play', { id: 'sfx-tide-bell' });
    this.events.emit('tide:bell', { id: this.id, zone: this.tide.id, state: this.tide.state });
    return true;
  }

  /**
   * 钟体角度（art/models/props/README.md「潮汐钟 · 动画参数」）：
   * - 闲置：风中轻摆 0.01 rad，周期 2.4 s；
   * - xi-ring-bell 第 22 帧（touch）→ 第 30 帧（ring）：钟跟着手掌推，θ = asin(推量 / 0.70)，ring 帧推 7 cm（≈ 0.100 rad）；
   * - ring 起自由摆：θ(t) = 0.2 · e^(−t/1.2) · sin(2πt/1.5 + asin 0.5)（t = 0 时正好 0.100，接上推的那一下）。
   */
  private bodyAngle(): number {
    const b = gameplay.tide.bell;
    let a = b.idleAmp * Math.sin((2 * Math.PI * this.idleT) / b.idlePeriodSec);
    if (this.freeT !== null) {
      const t = this.freeT;
      a += b.freeAmp * Math.exp(-t / b.freeDecaySec) * Math.sin((2 * Math.PI * t) / b.freePeriodSec + Math.asin(b.freePhaseSin));
    } else {
      const s = this.animSource?.animState;
      if (s && s.clip === 'xi-ring-bell' && !s.fired && (s.id === undefined || s.id === this.id)) {
        const touch = xiEventSec('xi-ring-bell', 'touch') ?? 0;
        const ring = xiEventSec('xi-ring-bell', 'ring') ?? touch;
        const k = ring > touch ? Math.min(1, Math.max(0, (s.t - touch) / (ring - touch))) : 0;
        a += Math.asin((b.pushM * k) / b.armM);
      }
    }
    return a;
  }

  /** 每帧：摆动动画（只动外观节点，不影响交互 / 潮汐逻辑） */
  update(dt: number): void {
    if (!this.swing) return;
    const b = gameplay.tide.bell;
    this.clock += dt;
    this.idleT += dt;
    if (this.freeT !== null) {
      this.freeT += dt;
      if (this.freeT >= gameplay.tide.bellSwingSec) this.freeT = null;
    }
    this.angle = this.bodyAngle();
    // 白盒钟架局部 +X = 站位：绕局部 z 正转时钟口朝站位，所以取反（与美术「正 = 推开」一致）
    this.swing.rotation.z = this.baseZ - this.angle;
    this.hist.push([this.clock, this.angle]);
    while (this.hist.length > 2 && this.hist[1]![0] <= this.clock - b.clapperLagSec) this.hist.shift();
    if (this.clapper) {
      const tl = this.clock - b.clapperLagSec;
      const [h0, h1] = [this.hist[0]!, this.hist[1] ?? this.hist[0]!];
      const lag = h1[0] > h0[0] ? h0[1] + ((h1[1] - h0[1]) * Math.min(1, Math.max(0, (tl - h0[0]) / (h1[0] - h0[0])))) : h0[1];
      // 钟锤吊在钟体里：世界上滞后于钟体，相对钟体 = θ(t − lag) − θ(t)，到 ±0.41 碰内壁
      const rel = lag - this.angle;
      this.clapperAngle = Math.max(-b.clapperHitRad, Math.min(b.clapperHitRad, rel));
      // 美术回复 1030：碰内壁（|相对角| ≥ 0.41）那一刻补一声钟锤；离开碰壁角（回滞 10 %）才能再响
      const touching = Math.abs(rel) >= b.clapperHitRad || (this.clapperTouching && Math.abs(rel) >= b.clapperHitRad * 0.9);
      if (touching && !this.clapperTouching) {
        this.clapperHits++;
        this.events.emit('sfx:play', { id: CLAPPER_SFX, optional: true });
      }
      this.clapperTouching = touching;
      this.clapper.rotation.z = this.clapperBaseZ - this.clapperAngle;
    }
  }

  dispose(): void {
    this.off();
  }
}
