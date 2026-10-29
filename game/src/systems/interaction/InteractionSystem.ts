import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import { t, type TextId } from '@/content/text';
import type { InputManager } from '@/systems/input/InputManager';
import type { CharacterBody, PhysicsSystem } from '@/systems/PhysicsSystem';
import { HeldItem } from './HeldItem';
import { Highlighter } from './Highlight';
import type { Interactable } from './Interactable';
import { PuzzleMode, type PuzzleBarHud, type PuzzleCamera } from './PuzzleMode';

/** 被交互系统驱动的角色（PlayerRig 经 actorFromRig 适配；Node 测试可以给假的） */
export interface InteractionActor {
  readonly body: CharacterBody;
  facing: number;
  locked: boolean;
  /** 是否在自动跨越 / 黑场送回中（这时不判定交互） */
  readonly busy: boolean;
  /** 清掉移动惯性 */
  halt(): void;
  /** 手部挂点（手持物挂在这里） */
  readonly hand: THREE.Object3D;
}

/** 交互 HUD（ui/Hud.ts 实现） */
export interface InteractionHud extends PuzzleBarHud {
  /** disabled = 灰色提示（Interactable.blocked：潮汐钟过渡中等），按 E 无效 */
  setPrompt(text: string | null, disabled?: boolean): void;
  /** 3.5 m 内的冷色小图标（屏幕像素坐标）；active = 当前可交互的那个 */
  setMarkers(markers: ReadonlyArray<{ x: number; y: number; active: boolean }>): void;
  /** hold 圆环进度，null 隐藏 */
  setHoldProgress(progress: number | null): void;
}

/** inspect / read 的去处：005 接字幕和阅读界面；没接时只发事件 */
export interface InteractionPresenters {
  say?(textId: TextId): void;
  read?(textId: TextId, source: Interactable): void;
}

export interface InteractionSystemOptions {
  events: EventBus;
  input: InputManager;
  physics: PhysicsSystem;
  actor: InteractionActor;
  camera: THREE.Camera;
  cameraFollow: PuzzleCamera;
  hud: InteractionHud;
  presenters?: InteractionPresenters;
  /** 没有交互候选时的提示（场景里跨越点等），每步调用 */
  fallbackPrompt?: () => string | null;
  /** 屏幕尺寸（图标投影用），默认取 window */
  viewport?: () => { width: number; height: number };
}

type Action =
  | { kind: 'none' }
  /** 自动走到交互点：结束后 then */
  | { kind: 'approach'; target: Interactable; from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; t: number; dur: number; then: 'use' | 'hold' | 'push' }
  | { kind: 'hold'; target: Interactable; t: number }
  | { kind: 'push'; target: Interactable }
  | { kind: 'puzzle'; target: Interactable };

const cfg = gameplay.interaction;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const ndc = new THREE.Vector3();

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * 交互系统（v0.1-004）：管理场景里所有 Interactable，按 GDD §9 判定候选、显示提示、执行八种交互。
 * 场景每个物理步在 entities.fixedUpdate 之前调 fixedUpdate（先于角色控制器消费 E，跨越点只在没有交互候选时生效），
 * 每帧在相机更新之后调 update（图标投影、机关模式鼠标输入、高亮计时）。
 *
 * 判定：角色到物体焦点的水平距离 − reach ≤ 1.8 m，且角色朝向与物体方向夹角 ≤ 60°；多个候选取投影离屏幕中心最近的。
 * 3.5 m 内显示冷色小图标，可交互时显示文字提示。
 */
export class InteractionSystem {
  readonly items: Interactable[] = [];
  readonly held: HeldItem;
  readonly highlighter = new Highlighter();
  readonly puzzle: PuzzleMode;
  /** 当前候选（可交互） */
  current: Interactable | null = null;
  private action: Action = { kind: 'none' };
  private prompt: string | null = null;
  private promptDisabled = false;
  private holdShown: number | null = null;
  private readonly o: InteractionSystemOptions;

  constructor(opts: InteractionSystemOptions) {
    this.o = opts;
    this.held = new HeldItem(opts.actor.hand, opts.events);
    this.puzzle = new PuzzleMode({
      input: opts.input,
      events: opts.events,
      camera: opts.cameraFollow,
      highlighter: this.highlighter,
      hud: opts.hud,
    });
    this.puzzle.onExit = () => {
      if (this.action.kind === 'puzzle') this.endAction();
    };
  }

  add<T extends Interactable>(it: T): T {
    this.items.push(it);
    return it;
  }

  get(id: string): Interactable | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** 正在执行的动作（approach / hold / push / puzzle / none） */
  get actionKind(): Action['kind'] {
    return this.action.kind;
  }

  /** hold 进度 0–1（没在 hold 时 0） */
  get holdProgress(): number {
    const a = this.action;
    return a.kind === 'hold' ? Math.min(1, a.t / a.target.holdSeconds) : 0;
  }

  /**
   * 高亮（提示系统二级提示，007）：objectIds = Interactable id 或场景节点名；默认 3 秒后消失。
   * 返回实际找到并高亮的 id。
   */
  highlight(objectIds: readonly string[], seconds: number = cfg.highlightSeconds, root?: THREE.Object3D): string[] {
    const done: string[] = [];
    for (const id of objectIds) {
      const obj = this.get(id)?.object ?? root?.getObjectByName(id) ?? null;
      if (!obj) continue;
      this.highlighter.add(`hint:${id}`, obj, 'hint', seconds);
      done.push(id);
    }
    if (done.length) this.o.events.emit('highlight:start', { ids: done, seconds });
    return done;
  }

  /** 判定：it 当前是否可交互（距离 + 朝向 + 类型条件） */
  canInteract(it: Interactable): boolean {
    if (!it.available || !this.kindReady(it)) return false;
    const body = this.o.actor.body;
    it.focus(tmpA);
    const dx = tmpA.x - body.position.x;
    const dz = tmpA.z - body.position.z;
    const dist = Math.hypot(dx, dz) - it.reach;
    if (dist > cfg.distance) return false;
    if (Math.hypot(dx, dz) < 1e-3) return true;
    const dirYaw = Math.atan2(dx, dz);
    return Math.abs(angleDiff(this.o.actor.facing, dirYaw)) <= THREE.MathUtils.degToRad(cfg.angleDeg) + 1e-6;
  }

  /** 每个物理步（entities.fixedUpdate 之前） */
  fixedUpdate(dt: number): void {
    const input = this.o.input;
    const a = this.action;
    if (a.kind === 'approach') this.stepApproach(a, dt);
    else if (a.kind === 'hold') this.stepHold(a, dt);
    else if (a.kind === 'push') this.stepPush(a, dt);

    const free = this.action.kind === 'none' && input.context === 'explore' && !this.o.actor.busy;
    this.current = free ? this.pickCandidate() : this.action.kind === 'none' ? null : this.current;
    if (free && this.current && input.consumePressed('interact')) this.trigger(this.current);
    this.refreshPrompt();
  }

  /** 每帧（相机更新之后） */
  update(dt: number): void {
    this.puzzle.update(dt);
    const ended = this.highlighter.update(dt);
    const hintEnded = ended.filter((k) => k.startsWith('hint:')).map((k) => k.slice(5));
    if (hintEnded.length) this.o.events.emit('highlight:end', { ids: hintEnded });
    this.updateMarkers();
  }

  /** 3.5 m 内的图标（屏幕坐标），也给测试用 */
  markers(): Array<{ id: string; x: number; y: number; active: boolean }> {
    const out: Array<{ id: string; x: number; y: number; active: boolean }> = [];
    if (this.o.input.context !== 'explore' || this.action.kind !== 'none') return out;
    const body = this.o.actor.body;
    const vp = this.o.viewport?.() ?? { width: window.innerWidth, height: window.innerHeight };
    for (const it of this.items) {
      if (!it.available || !this.kindReady(it)) continue;
      it.focus(tmpA);
      const d = Math.hypot(tmpA.x - body.position.x, tmpA.z - body.position.z) - it.reach;
      if (d > cfg.iconDistance) continue;
      ndc.copy(tmpA).project(this.o.camera);
      if (ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) continue;
      out.push({ id: it.id, x: ((ndc.x + 1) / 2) * vp.width, y: ((1 - ndc.y) / 2) * vp.height, active: it === this.current });
    }
    return out;
  }

  /** 直接触发（测试 / 脚本用；正常由 E 触发） */
  trigger(it: Interactable): void {
    const ev = this.o.events;
    // 暂时不可用（提示已变灰）：按 E 无效
    if (it.isBlocked) return;
    switch (it.kind) {
      case 'inspect': {
        const id = it.textId as TextId;
        this.o.presenters?.say?.(id);
        ev.emit('interact:inspect', { id: it.id, textId: id });
        ev.emit('interact:used', { id: it.id, kind: it.kind });
        break;
      }
      case 'read': {
        const id = it.textId as TextId;
        this.o.presenters?.read?.(id, it);
        ev.emit('interact:read', { id: it.id, textId: id });
        ev.emit('interact:used', { id: it.id, kind: it.kind });
        break;
      }
      case 'pickup':
        if (this.held.pickUp(it.item ?? it.id, it.object)) ev.emit('interact:used', { id: it.id, kind: it.kind });
        break;
      case 'place':
        if (it.socket && this.held.place(it.socket)) ev.emit('interact:used', { id: it.id, kind: it.kind });
        break;
      case 'puzzle':
        if (!it.puzzle) return;
        this.o.actor.halt();
        this.o.actor.locked = true;
        this.action = { kind: 'puzzle', target: it };
        this.puzzle.enter(it.puzzle);
        ev.emit('interact:used', { id: it.id, kind: it.kind });
        break;
      case 'use':
      case 'hold':
      case 'push':
        if (it.approach) this.startApproach(it, it.kind);
        else this.afterApproach(it, it.kind);
        break;
    }
  }

  /** 中止当前动作（场景切换 / 演出接管） */
  cancel(): void {
    if (this.action.kind === 'puzzle') this.puzzle.exit();
    this.endAction();
  }

  dispose(): void {
    this.cancel();
    this.highlighter.dispose();
    this.o.hud.setPrompt(null);
    this.o.hud.setMarkers([]);
    this.o.hud.setHoldProgress(null);
    this.o.hud.setPuzzleBar(null);
  }

  // ---------------------------------------------------------------- 内部

  /** 类型条件：pickup 要空手，place 要拿着它接受的东西且 socket 空着 */
  private kindReady(it: Interactable): boolean {
    if (it.kind === 'pickup') return !this.held.holding;
    if (it.kind === 'place') {
      const cur = this.held.current;
      if (!cur || !it.socket || !this.held.socketFree(it.socket)) return false;
      return it.item === null || it.item === cur.id;
    }
    return true;
  }

  private pickCandidate(): Interactable | null {
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const it of this.items) {
      if (!this.canInteract(it)) continue;
      it.focus(tmpA);
      ndc.copy(tmpA).project(this.o.camera);
      // 相机背后的点投影会翻转：排到最后
      const score = ndc.z > 1 ? 1e6 + ndc.x * ndc.x + ndc.y * ndc.y : ndc.x * ndc.x + ndc.y * ndc.y;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  private refreshPrompt(): void {
    const a = this.action;
    let text: string | null = null;
    if (a.kind === 'hold' || a.kind === 'push' || (a.kind === 'approach' && a.then !== 'use')) text = t(a.target.prompt);
    else if (a.kind === 'none') text = this.current ? t(this.current.prompt) : (this.o.fallbackPrompt?.() ?? null);
    const disabled = a.kind === 'none' && this.current !== null && this.current.isBlocked;
    if (text !== this.prompt || disabled !== this.promptDisabled) {
      this.prompt = text;
      this.promptDisabled = disabled;
      this.o.hud.setPrompt(text, disabled);
    }
    const hp = a.kind === 'hold' || (a.kind === 'approach' && a.then === 'hold') ? this.holdProgress : null;
    if (hp !== this.holdShown) {
      this.holdShown = hp;
      this.o.hud.setHoldProgress(hp);
    }
  }

  private updateMarkers(): void {
    this.o.hud.setMarkers(this.markers());
  }

  private startApproach(it: Interactable, then: 'use' | 'hold' | 'push'): void {
    const actor = this.o.actor;
    const body = actor.body;
    const stand = it.standPoint(new THREE.Vector3());
    const from = body.position.clone();
    const to = new THREE.Vector3(stand.position.x, from.y, stand.position.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    // 不穿模：路径上有碰撞体挡着就不走，原地转身（物理每步也会把角色推出碰撞体）
    if (dist > 1e-3 && !this.pathClear(from, to, body)) to.copy(from);
    const moveDist = from.distanceTo(to);
    const turn = Math.abs(angleDiff(actor.facing, stand.facing));
    // 时长：平移按 2.5 m/s、转身按 180°/0.4 s 取较长者，限制在 [0.15, 0.4] s；已经站好且朝向对了就不走
    const dur =
      moveDist < 0.02 && turn < 0.05
        ? 0
        : Math.min(cfg.approachMaxTime, Math.max(cfg.approachMinTime, moveDist / 2.5, (turn / Math.PI) * cfg.approachMaxTime));
    actor.halt();
    actor.locked = true;
    const approach: Extract<Action, { kind: 'approach' }> = { kind: 'approach', target: it, from, to, fromYaw: actor.facing, toYaw: stand.facing, t: 0, dur, then };
    this.action = approach;
    if (dur <= 0) this.stepApproach(approach, 0);
  }

  /** 胶囊在两个高度上做球形扫掠，确认站位路径没被挡 */
  pathClear(from: THREE.Vector3, to: THREE.Vector3, body: CharacterBody): boolean {
    tmpB.subVectors(to, from).setY(0);
    const len = tmpB.length();
    if (len < 1e-4) return true;
    tmpB.divideScalar(len);
    const r = body.radius * 0.9;
    for (const h of [body.radius + 0.12, body.height - body.radius]) {
      tmpC.copy(from).setY(from.y + h);
      if (this.o.physics.sphereCast(tmpC, tmpB, r, len) < len - 1e-3) return false;
    }
    return true;
  }

  private stepApproach(a: Extract<Action, { kind: 'approach' }>, dt: number): void {
    const actor = this.o.actor;
    const body = actor.body;
    a.t += dt;
    const u = a.dur <= 0 ? 1 : Math.min(1, a.t / a.dur);
    const k = u * u * (3 - 2 * u);
    body.velocity.x = body.velocity.z = 0;
    body.position.x = a.from.x + (a.to.x - a.from.x) * k;
    body.position.z = a.from.z + (a.to.z - a.from.z) * k;
    actor.facing = a.fromYaw + angleDiff(a.fromYaw, a.toYaw) * k;
    if (u < 1) return;
    actor.facing = a.toYaw;
    this.afterApproach(a.target, a.then);
  }

  private afterApproach(it: Interactable, then: 'use' | 'hold' | 'push'): void {
    const ev = this.o.events;
    if (then === 'use') {
      this.endAction();
      ev.emit('interact:used', { id: it.id, kind: 'use' });
      return;
    }
    this.o.actor.locked = true;
    this.action = then === 'hold' ? { kind: 'hold', target: it, t: 0 } : { kind: 'push', target: it };
  }

  private stepHold(a: Extract<Action, { kind: 'hold' }>, dt: number): void {
    const ev = this.o.events;
    if (!this.o.input.isDown('interact')) {
      // 中途松开：进度归零
      ev.emit('interact:holdProgress', { id: a.target.id, progress: 0 });
      this.endAction();
      return;
    }
    a.t += dt;
    const p = Math.min(1, a.t / a.target.holdSeconds);
    ev.emit('interact:holdProgress', { id: a.target.id, progress: p });
    if (p >= 1) {
      this.endAction();
      ev.emit('interact:used', { id: a.target.id, kind: 'hold' });
    }
  }

  private stepPush(a: Extract<Action, { kind: 'push' }>, dt: number): void {
    const it = a.target;
    const track = it.track;
    if (!track || !it.enabled || !this.o.input.isDown('interact')) {
      this.endAction();
      return;
    }
    const len = track.from.distanceTo(track.to);
    const speed = track.speed ?? cfg.pushSpeed;
    const prevT = it.pushT;
    it.pushT = len <= 0 ? 1 : Math.min(1, it.pushT + (speed * dt) / len);
    tmpA.lerpVectors(track.from, track.to, prevT);
    tmpB.lerpVectors(track.from, track.to, it.pushT);
    tmpC.subVectors(tmpB, tmpA);
    // 物体（世界坐标轨道 → 父节点局部）与角色一起移动
    const obj = it.object;
    if (obj.parent) {
      obj.parent.updateWorldMatrix(true, false);
      obj.position.copy(obj.parent.worldToLocal(tmpB.clone()));
    } else obj.position.copy(tmpB);
    obj.updateMatrixWorld(true);
    const body = this.o.actor.body;
    body.position.x += tmpC.x;
    body.position.z += tmpC.z;
    body.velocity.x = body.velocity.z = 0;
    this.o.events.emit('interact:pushMoved', { id: it.id, t: it.pushT });
    if (it.pushT >= 1) {
      it.locked = true;
      this.endAction();
      this.o.events.emit('interact:pushEnd', { id: it.id });
      this.o.events.emit('interact:used', { id: it.id, kind: 'push' });
    }
  }

  private endAction(): void {
    const had = this.action.kind !== 'none';
    this.action = { kind: 'none' };
    if (had) this.o.actor.locked = false;
  }
}

/** PlayerRig → InteractionActor（hand：角色可见模型上的手部挂点，没有骨骼时挂在身前） */
export function actorFromRig(rig: {
  body: { body: CharacterBody };
  controller: { facing: number; locked: boolean; busy: boolean; halt(): void };
  visual: THREE.Object3D;
}): InteractionActor {
  let hand = rig.visual.getObjectByName('hand-item');
  if (!hand) {
    hand = new THREE.Object3D();
    hand.name = 'hand-item';
    hand.position.set(0.22, 0.85, 0.28);
    rig.visual.add(hand);
  }
  const h = hand;
  return {
    get body() {
      return rig.body.body;
    },
    get facing() {
      return rig.controller.facing;
    },
    set facing(v: number) {
      rig.controller.facing = v;
    },
    get locked() {
      return rig.controller.locked;
    },
    set locked(v: boolean) {
      rig.controller.locked = v;
    },
    get busy() {
      return rig.controller.busy;
    },
    halt: () => rig.controller.halt(),
    hand: h,
  };
}
