import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { InputManager } from '@/systems/input/InputManager';
import { StairGait, stepLocomotion, type LocomotionState } from '@/systems/locomotion';
import { Component } from '../Component';
import { KinematicBody } from './KinematicBody';
import { pickTraversalLink, type TraversalLink } from './TraversalLink';

export interface PlayerControllerOptions {
  input: InputManager;
  /** 相机水平朝向（弧度）；移动方向相对相机 */
  cameraYaw: () => number;
  events: EventBus;
  /** 需要转向的可视节点（通常是模型子节点） */
  visual: THREE.Object3D;
  /** 黑场（0–1），teleportTo 用；不传则没有画面过渡 */
  setFade?: (opacity: number) => void;
}

export interface TeleportOptions {
  /** 黑场保持时长（s），默认 gameplay.teleport.fadeSec（0.5）；0 = 直接瞬移 */
  fade?: number;
  /** 到达后的朝向（弧度）；不传保持原朝向 */
  facing?: number;
}

/** 黑场淡入 / 淡出各占的时间（s） */
const FADE_EDGE = 0.2;
const tmp = new THREE.Vector3();

type Mode =
  | { kind: 'free' }
  | { kind: 'traverse'; link: TraversalLink; t: number }
  | {
      kind: 'teleport';
      t: number;
      hold: number;
      point: THREE.Vector3;
      facing: number | undefined;
      done: boolean;
      resolve: () => void;
    };

/**
 * 玩家控制（v0.1-002）：读抽象 action，相机相对移动；慢走 1.6 / 小跑 3.2 m/s，0.12 s 到速，540°/s 转身；本作不做跳跃。
 * 另外负责两种「接管」：自动跨越（TraversalLink）和强制送回（teleportTo，带黑场）。接管期间忽略移动输入。
 * 数值全部在 config/gameplay.ts，移动数学在 systems/locomotion.ts（Node 单测覆盖）。
 */
export class PlayerController extends Component {
  /** 场景里可用的自动跨越点 */
  links: TraversalLink[] = [];
  /** 外部锁定（过场、读文档时由对应系统置位） */
  locked = false;
  private body!: KinematicBody;
  private readonly opts: PlayerControllerOptions;
  private readonly loco: LocomotionState = { vx: 0, vz: 0, facing: 0 };
  /** 楼梯步态：在楼梯上时水平速度固定（竖直 0.5455 m/s），跑步键不加速 */
  readonly stairs = new StairGait();
  private mode: Mode = { kind: 'free' };
  private _nearLink: TraversalLink | null = null;

  constructor(opts: PlayerControllerOptions) {
    super();
    this.opts = opts;
  }

  /** 当前站在哪个可用跨越点的起点上（HUD 提示用） */
  get nearLink(): TraversalLink | null {
    return this._nearLink;
  }

  /** 自动跨越进度（动画用）：已过时间 / 总时长；不在跨越中为 null */
  get traversal(): { t: number; duration: number } | null {
    const m = this.mode;
    return m.kind === 'traverse' ? { t: Math.min(m.t, m.link.duration), duration: m.link.duration } : null;
  }

  /** 是否在跨越 / 送回中（输入被忽略） */
  get busy(): boolean {
    return this.mode.kind !== 'free';
  }

  /** 是否在小跑（水平速度超过慢走；相机 FOV +3° 用） */
  get running(): boolean {
    return Math.hypot(this.loco.vx, this.loco.vz) > gameplay.player.walkSpeed + 0.2;
  }

  get facing(): number {
    return this.loco.facing;
  }

  set facing(v: number) {
    this.loco.facing = v;
    this.opts.visual.rotation.y = v;
  }

  override onAttach(): void {
    this.body = this.entity.require(KinematicBody);
    this.loco.facing = this.opts.visual.rotation.y;
  }

  /**
   * 强制送回（掉出边界、卡死兜底等）：黑场 0.2 s 淡入 → 保持 fade 秒（期间瞬移并落地）→ 0.2 s 淡出。
   * 返回在画面完全恢复时 resolve 的 Promise。
   */
  teleportTo(point: THREE.Vector3, opts: TeleportOptions = {}): Promise<void> {
    const hold = opts.fade ?? gameplay.teleport.fadeSec;
    if (this.mode.kind === 'teleport') this.mode.resolve();
    if (hold <= 0 || !this.opts.setFade) {
      this.place(point, opts.facing);
      this.mode = { kind: 'free' };
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.mode = { kind: 'teleport', t: 0, hold, point: point.clone(), facing: opts.facing, done: false, resolve };
    });
  }

  /** 立即停下（清掉移动惯性；交互系统接管走位前调用） */
  halt(): void {
    this.loco.vx = this.loco.vz = 0;
    this.body.body.velocity.x = this.body.body.velocity.z = 0;
  }

  /** 直接开始一次自动跨越（测试 / 脚本用；正常由 E 或往前走触发） */
  startTraversal(link: TraversalLink): void {
    this.mode = { kind: 'traverse', link, t: 0 };
    this.body.body.enabled = false;
    this.body.body.velocity.set(0, 0, 0);
    this.loco.vx = this.loco.vz = 0;
    this.opts.events.emit('player:traverse', { phase: 'start' });
  }

  override fixedUpdate(dt: number): void {
    const body = this.body.body;
    const mode = this.mode;
    if (mode.kind === 'traverse') {
      this.stairs.reset();
      this.stepTraversal(mode, dt);
      return;
    }
    if (mode.kind === 'teleport') {
      this.stairs.reset();
      this.stepTeleport(mode, dt);
      return;
    }
    // 上一个物理步的实际位移 → 楼梯检测
    const stairSpeed = this.stairs.update(
      dt,
      body.position.y - body.prevPosition.y,
      Math.hypot(body.position.x - body.prevPosition.x, body.position.z - body.prevPosition.z),
      body.onGround,
    );

    const input = this.opts.input;
    const move = this.locked ? { x: 0, y: 0 } : input.getMove();
    const sprint = !this.locked && input.isDown('sprint');
    stepLocomotion(this.loco, { moveX: move.x, moveY: move.y, sprint, cameraYaw: this.opts.cameraYaw(), fixedSpeed: stairSpeed }, dt);
    body.velocity.x = this.loco.vx;
    body.velocity.z = this.loco.vz;

    if (body.justLanded) this.opts.events.emit('player:land', { impactSpeed: body.impactSpeed });

    // 自动跨越：站在起点附近，按 E 或朝终点方向走
    this._nearLink = null;
    if (!this.locked && body.onGround) {
      // 多个起点都在范围内（S1 浮台南沿两侧的去 / 回起点相距 0.8 m、半径 0.6–0.7）：取起点最近的那条
      const best = pickTraversalLink(this.links, body.position);
      if (best) {
        this._nearLink = best;
        const pushing = best.walkInto && best.pushingToward(this.loco.vx, this.loco.vz) && Math.hypot(move.x, move.y) > 0.5;
        if (input.consumePressed('interact') || pushing) {
          this.startTraversal(best);
          this._nearLink = null;
        }
      }
    }
  }

  private stepTraversal(mode: Extract<Mode, { kind: 'traverse' }>, dt: number): void {
    const body = this.body.body;
    const link = mode.link;
    mode.t += dt;
    const u = Math.min(1, mode.t / link.duration);
    body.prevPosition.copy(body.position);
    link.sample(u, body.position);
    tmp.subVectors(body.position, body.prevPosition);
    if (tmp.x * tmp.x + tmp.z * tmp.z > 1e-8) this.turnToward(Math.atan2(tmp.x, tmp.z), dt);
    if (u >= 1) {
      body.enabled = true;
      body.onGround = true;
      body.velocity.set(0, 0, 0);
      body.actualVelocity.set(0, 0, 0);
      this.mode = { kind: 'free' };
      this.opts.events.emit('player:traverse', { phase: 'end' });
    }
  }

  private stepTeleport(mode: Extract<Mode, { kind: 'teleport' }>, dt: number): void {
    const setFade = this.opts.setFade;
    mode.t += dt;
    this.body.body.velocity.x = this.body.body.velocity.z = 0;
    this.loco.vx = this.loco.vz = 0;
    const t = mode.t;
    if (t < FADE_EDGE) {
      setFade?.(t / FADE_EDGE);
      return;
    }
    if (!mode.done) {
      setFade?.(1);
      this.place(mode.point, mode.facing);
      mode.done = true;
    }
    if (t < FADE_EDGE + mode.hold) return;
    const k = (t - FADE_EDGE - mode.hold) / FADE_EDGE;
    setFade?.(1 - Math.min(1, k));
    if (k >= 1) {
      this.mode = { kind: 'free' };
      mode.resolve();
    }
  }

  /** 瞬移并站稳：抬高 2 cm 让物理在下一步落地（不会卡进地面，也不会穿下去） */
  private place(point: THREE.Vector3, facing: number | undefined): void {
    tmp.copy(point);
    tmp.y += 0.02;
    this.body.teleport(tmp);
    this.loco.vx = this.loco.vz = 0;
    if (facing !== undefined) this.facing = facing;
    this.opts.events.emit('player:teleport', { x: point.x, y: point.y, z: point.z });
  }

  private turnToward(want: number, dt: number): void {
    let diff = want - this.loco.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = ((gameplay.player.turnSpeedDeg * Math.PI) / 180) * dt;
    this.loco.facing += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  override update(dt: number): void {
    // 朝向已按 540°/s 在固定步里转好；这里只做帧间平滑（避免 60Hz 步进在高刷屏上的台阶感）
    const cur = this.opts.visual.rotation.y;
    let diff = this.loco.facing - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.opts.visual.rotation.y = cur + diff * Math.min(1, dt * 30);
  }
}
