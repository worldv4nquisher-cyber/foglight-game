import type * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { Collider } from '@/systems/PhysicsSystem';
import { tideUniforms } from '@/render/tideUniforms';
import type { Floatable } from './Floatable';

export type TideState = 'high' | 'low';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** 区域判定（与 HintSystem 的 circleZone / boxZone 同形） */
export type TideRegion = (p: Vec3Like) => boolean;

export interface TideControllerOptions {
  /** 潮汐分区 id（场景里唯一；事件里带着它） */
  id: string;
  /** 初始状态（S1、S3 都是涨潮，GDD §7） */
  initial: TideState;
  events?: EventBus;
  /** 送回判定的范围（角色在这里面才会被潮水送回）；不给 = 整个场景 */
  region?: TideRegion;
  /** 送回的安全点（脚底位置 + 可选朝向）；不给则不送回 */
  safePoint?: { position: THREE.Vector3; facing?: number };
  /** 覆盖默认数值（测试用） */
  lowLevel?: number;
  highLevel?: number;
  transitionSec?: number;
}

interface BoundCollider {
  collider: Collider;
  /** walkableWhen：可走的潮位；deep：深水墙（水深 > deepWaterDepth 时启用），floorY = 该处地面高度 */
  rule: { kind: 'walkable'; when: TideState } | { kind: 'deep'; floorY: number };
}

const cfg = gameplay.tide;

const smoothstep = (u: number): number => u * u * (3 - 2 * u);

/**
 * 一个潮汐分区（v0.1-011）：状态 high / low，level 在 0.0 ↔ 1.6 m 之间用 smoothstep 过渡 6 s。
 * 纯逻辑（无 DOM），Node 里可直接单测（npm run test:tide）。
 *
 * - toggle()：敲钟。过渡中返回 false（钟不可再敲，TideBell 把交互提示变灰）。
 * - 事件：开始过渡发 `tide:changing { zone, state(目标), from }`，到位发 `tide:changed { zone, state }`。
 * - 碰撞：bindCollider(c, 'low' | 'high') —— 普通碰撞体（-collider）在可走潮位时启用；空气墙（-wall）反过来，
 *   在不可走时启用（礁石路入口的隐形墙）。可走状态在 level 越过中点（0.8 m）时切换。
 *   addDeepWater(c, floorY)：深水墙，水深（level − floorY）> 0.5 m 时启用。
 *   美术 GLB 里给碰撞网格加自定义属性 `walkableWhen = "low" | "high"` 或 `deepFloorY = <数>`，bindFromColliders() 自动绑定。
 * - 浮物（Floatable）挂在分区上，随 level 升降。
 * TideSet 管多个分区、写全局 uTideLevel、做角色送回判定。
 */
export class TideController {
  readonly id: string;
  readonly low: number;
  readonly high: number;
  readonly transitionSec: number;
  readonly region: TideRegion | null;
  readonly safePoint: { position: THREE.Vector3; facing?: number } | null;
  /** 当前（或过渡的目标）状态 */
  state: TideState;
  /** 当前水面高度（世界 y，m） */
  level: number;
  readonly floatables: Floatable[] = [];
  private from = 0;
  private to = 0;
  private t = 0;
  private moving = false;
  private walkable: TideState;
  private readonly bound: BoundCollider[] = [];
  private readonly events: EventBus | null;

  constructor(opts: TideControllerOptions) {
    this.id = opts.id;
    this.low = opts.lowLevel ?? cfg.lowLevel;
    this.high = opts.highLevel ?? cfg.highLevel;
    this.transitionSec = opts.transitionSec ?? cfg.transitionSec;
    this.region = opts.region ?? null;
    this.safePoint = opts.safePoint ?? null;
    this.events = opts.events ?? null;
    this.state = opts.initial;
    this.level = this.levelOf(opts.initial);
    this.walkable = this.walkableAt(this.level);
  }

  /** 正在涨落（钟不可敲） */
  get transitioning(): boolean {
    return this.moving;
  }

  /** 过渡进度 0–1（不在过渡 = 1） */
  get progress(): number {
    return this.moving ? Math.min(1, this.t / this.transitionSec) : 1;
  }

  /** 当前「可走」潮位：level 低于中点 = low */
  get walkableState(): TideState {
    return this.walkable;
  }

  levelOf(s: TideState): number {
    return s === 'high' ? this.high : this.low;
  }

  /** 敲钟：切换到另一个状态。过渡中返回 false（无效） */
  toggle(): boolean {
    return this.set(this.state === 'high' ? 'low' : 'high');
  }

  /** 切到 s（instant = 直接到位，场景初始化 / 读档用）；过渡中或已在 s 返回 false */
  set(s: TideState, opts: { instant?: boolean } = {}): boolean {
    if (opts.instant) {
      this.moving = false;
      this.state = s;
      this.level = this.levelOf(s);
      this.refreshColliders(true);
      for (const f of this.floatables) f.snap(this.level);
      return true;
    }
    if (this.moving || s === this.state) return false;
    const fromState = this.state;
    this.state = s;
    this.from = this.level;
    this.to = this.levelOf(s);
    this.t = 0;
    this.moving = true;
    this.events?.emit('tide:changing', { zone: this.id, state: s, from: fromState });
    return true;
  }

  /** 每个物理步（角色物理之前）：推进水位、切换碰撞、更新浮物 */
  fixedUpdate(dt: number): void {
    if (this.moving) {
      this.t += dt;
      const u = Math.min(1, this.t / this.transitionSec);
      this.level = this.from + (this.to - this.from) * smoothstep(u);
      if (u >= 1) {
        this.level = this.to;
        this.moving = false;
        this.refreshColliders(false);
        this.events?.emit('tide:changed', { zone: this.id, state: this.state });
      }
    }
    this.refreshColliders(false);
    for (const f of this.floatables) f.fixedUpdate(dt, this.level);
  }

  /** 绑定一个随潮位开关的碰撞体（walkableWhen） */
  bindCollider(collider: Collider, walkableWhen: TideState): void {
    this.bound.push({ collider, rule: { kind: 'walkable', when: walkableWhen } });
    this.refreshColliders(true);
  }

  /** 深水墙：该处地面高 floorY，水深 > deepWaterDepth 时启用（挡住角色） */
  addDeepWater(collider: Collider, floorY: number): void {
    this.bound.push({ collider, rule: { kind: 'deep', floorY } });
    this.refreshColliders(true);
  }

  /** 从碰撞体的来源网格 userData（GLB extras）读 walkableWhen / deepFloorY 自动绑定；返回绑定数量 */
  bindFromColliders(colliders: readonly Collider[]): number {
    let n = 0;
    for (const c of colliders) {
      const ud = c.source?.userData ?? {};
      const w: unknown = ud.walkableWhen;
      if (w === 'low' || w === 'high') {
        this.bindCollider(c, w);
        n++;
      } else if (typeof ud.deepFloorY === 'number') {
        this.addDeepWater(c, ud.deepFloorY);
        n++;
      }
    }
    return n;
  }

  addFloatable(f: Floatable): Floatable {
    this.floatables.push(f);
    f.snap(this.level);
    return f;
  }

  /** p 处地面被淹没的深度（m，负数 = 在水面以上） */
  depthAt(footY: number): number {
    return this.level - footY;
  }

  /** p 是否在本分区的送回范围内 */
  contains(p: Vec3Like): boolean {
    return this.region ? this.region(p) : true;
  }

  private walkableAt(level: number): TideState {
    return level < (this.low + this.high) / 2 ? 'low' : 'high';
  }

  private refreshColliders(force: boolean): void {
    const w = this.walkableAt(this.level);
    const changed = w !== this.walkable;
    this.walkable = w;
    for (const b of this.bound) {
      const r = b.rule;
      if (r.kind === 'walkable') {
        if (!changed && !force) continue;
        const walk = w === r.when;
        // 普通碰撞体：可走时存在；空气墙：不可走时挡住
        b.collider.enabled = b.collider.kind === 'wall' ? !walk : walk;
      } else {
        b.collider.enabled = this.level - r.floorY > cfg.deepWaterDepth;
      }
    }
  }

  debugLine(): string {
    const arrow = this.moving ? (this.state === 'high' ? '↑' : '↓') : '';
    return `${this.id} ${this.state}${arrow} level ${this.level.toFixed(2)} m · 可走 ${this.walkable}${this.moving ? ` · ${(this.progress * 100).toFixed(0)}%` : ''}`;
  }
}

/** 送回判定用的角色（PlayerRig 适配） */
export interface TideActor {
  /** 脚底位置 */
  readonly position: Vec3Like;
  readonly onGround: boolean;
  /** 正在跨越 / 黑场送回中 */
  readonly busy: boolean;
}

/**
 * 一个场景的全部潮汐分区（v0.1-011）。
 * - primary：驱动水面高度和全局 uTideLevel 的分区（默认第一个加进来的）。
 * - 送回：角色站在某分区 region 里、着地、脚下地面被淹没 > 0.3 m → onRecall(zone)（场景里黑场送回 + 字幕「水太冷了。」）。
 */
export class TideSet {
  readonly zones: TideController[] = [];
  primary: TideController | null = null;
  /** 送回回调（场景接 teleportTo + 字幕）；回调返回 Promise 时，结束前不再重复触发 */
  onRecall: ((zone: TideController) => Promise<void> | void) | null = null;
  private recalling = false;

  add(zone: TideController): TideController {
    this.zones.push(zone);
    this.primary ??= zone;
    this.syncUniform();
    return zone;
  }

  get(id: string): TideController | undefined {
    return this.zones.find((z) => z.id === id);
  }

  /** 物理步之前：水位、碰撞开关、浮物 */
  fixedUpdate(dt: number): void {
    for (const z of this.zones) z.fixedUpdate(dt);
    this.syncUniform();
  }

  /** 物理步之后：送回判定。返回触发送回的分区（没有 = null） */
  checkRecall(actor: TideActor): TideController | null {
    if (this.recalling || actor.busy || !actor.onGround) return null;
    for (const z of this.zones) {
      if (!z.safePoint || !z.contains(actor.position)) continue;
      if (z.depthAt(actor.position.y) > gameplay.tide.recallDepth) {
        const r = this.onRecall?.(z);
        if (r instanceof Promise) {
          this.recalling = true;
          void r.finally(() => {
            this.recalling = false;
          });
        }
        return z;
      }
    }
    return null;
  }

  syncUniform(): void {
    if (this.primary) tideUniforms.uTideLevel.value = this.primary.level;
  }

  debugLine(): string {
    return this.zones.map((z) => z.debugLine()).join('　');
  }
}
