import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import { t, type TextId } from '@/content/text';
import type { InputManager } from '@/systems/input/InputManager';
import type { CharacterBody, PhysicsSystem } from '@/systems/PhysicsSystem';
import { HeldItem } from './HeldItem';
import { Highlighter } from './Highlight';
import type { Interactable } from './Interactable';
import { pushRate, xiClipDuration, xiEventSec, xiInteractEventSec, type XiClipName } from '@/entities/xi/clips';
import { PuzzleMode, type PuzzleBarHud, type PuzzleCamera } from './PuzzleMode';

/** 被交互系统驱动的角色（PlayerRig 经 actorFromRig 适配；Node 测试可以给假的） */
export interface InteractionActor {
  readonly body: CharacterBody;
  facing: number;
  locked: boolean;
  /** 是否在自动跨越 / 黑场送回中（这时不判定交互）；交互动作锁定看 locked，不是 busy */
  readonly busy: boolean;
  /** 清掉移动惯性 */
  halt(): void;
  /** 手部挂点（手持物挂在这里） */
  readonly hand: THREE.Object3D;
  /** 汐的动画（v0.1-017；白盒胶囊没有 → 交互保持即时生效） */
  readonly anim?: InteractionAnim;
}

/** 交互系统驱动的动画接口（XiAnimator 实现） */
export interface InteractionAnim {
  has(clip: XiClipName): boolean;
  /** 一次性动作停在第 t 秒（每个固定步调用） */
  setPose(clip: XiClipName, t: number): void;
  clearPose(): void;
  setLoop(clip: XiClipName | null, rate?: number): void;
}

/** 交互动作生效时做什么 */
type AnimEffect = 'pickup' | 'place' | 'use' | 'none';

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
  puzzleActor?: THREE.Object3D;
  camera: THREE.Camera;
  cameraFollow: PuzzleCamera;
  hud: InteractionHud;
  presenters?: InteractionPresenters;
  /** 没有交互候选时的提示（场景里跨越点等），每步调用 */
  fallbackPrompt?: () => string | null;
  /** 附近跨越点的优先级（没有 = null）：优先级低于它的交互物不当候选，E 留给跨越（PlayerController 在交互之后读 E） */
  linkPriority?: () => number | null;
  /** 屏幕尺寸（图标投影用），默认取 window */
  viewport?: () => { width: number; height: number };
}

type Then = 'use' | 'hold' | 'push' | 'pickup' | 'place';

type Action =
  | { kind: 'none' }
  /** 自动走到交互点：结束后 then */
  | { kind: 'approach'; target: Interactable; from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; t: number; dur: number; then: Then }
  /** hold：clip 有值时（阀门 xi-valve-hold）先播 grip 段（0 → pre 秒，圆环不动），圆环只在 turnStart–turnEnd 计 */
  | { kind: 'hold'; target: Interactable; t: number; clip: XiClipName | null; pre: number }
  /** v0.1-017 交互动作：按游戏时间播 clip，在事件帧 at 生效（effect），播完解锁 */
  | { kind: 'anim'; target: Interactable; clip: XiClipName; t: number; dur: number; at: number; fired: boolean; effect: AnimEffect }
  /**
   * push：有 xi-push-start 时先播它（start 秒）；前 moveAt 秒物体不动，之后与 push-start 后半段重叠、速度 smoothstep 加到满速，
   * 播完进 push-loop；停下（松手 / 到端点）播 xi-push-end
   */
  | { kind: 'push'; target: Interactable; t: number; start: number; moveAt: number }
  | { kind: 'puzzle'; target: Interactable };

const cfg = gameplay.interaction;

/** push-start 与移动重叠段的速度系数：t ≤ moveAt 为 0，t ≥ start 为 1，中间 smoothstep（起步、接 push-loop 都不跳速） */
export function pushStartRamp(t: number, moveAt: number, start: number): number {
  if (t <= moveAt) return 0;
  if (t >= start || start <= moveAt) return 1;
  const u = (t - moveAt) / (start - moveAt);
  return u * u * (3 - 2 * u);
}
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
  /** pickCandidate 复用的临时数组 */
  private readonly pickScratch: { it: Interactable; d2: number; score: number }[] = [];
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
      actor: opts.puzzleActor,
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
    else if (a.kind === 'anim') this.stepAnim(a, dt);

    const free = this.action.kind === 'none' && input.context === 'explore' && !this.o.actor.busy;
    this.current = free ? this.pickCandidate() : this.action.kind === 'none' ? null : this.current;
    if (free && this.current && input.consumePressed('interact')) {
      this.trigger(this.current);
      // 按下 E 的这一步就开始走位（以前要等下一步才走，白白多一个固定步）
      const b = this.action;
      if (b.kind === 'approach' && b.t === 0 && b.dur > 0) this.stepApproach(b, dt);
    }
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
      case 'place':
        // 有动画：走到站位 → 播 clip → grab / release 帧才真正拿起 / 放下
        if (this.animFor(it)) this.startApproach(it, it.kind);
        else this.applyEffect(it, it.kind);
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
        if (it.approach || this.animFor(it)) this.startApproach(it, it.kind);
        else this.afterApproach(it, it.kind);
        break;
    }
  }

  /** 中止当前动作（场景切换 / 演出接管） */
  cancel(): void {
    this.puzzle.exit();
    this.endAction();
  }

  /** 这个交互物这次要播的 clip（角色没有动画 / 缺 clip = null，交互即时生效） */
  animFor(it: Interactable): XiClipName | null {
    const anim = this.o.actor.anim;
    if (!anim || !it.autoAnim) return null;
    const c = it.resolveAnim();
    return c && anim.has(c) ? c : null;
  }

  /** 正在播的交互动作（测试 / dev 读） */
  get animState(): { id: string; clip: XiClipName; t: number; fired: boolean } | null {
    const a = this.action;
    if (a.kind === 'anim') return { id: a.target.id, clip: a.clip, t: a.t, fired: a.fired };
    if (a.kind === 'hold' && a.clip) return { id: a.target.id, clip: a.clip, t: a.t, fired: false };
    return null;
  }

  private applyEffect(it: Interactable, effect: AnimEffect): void {
    const ev = this.o.events;
    if (effect === 'pickup') {
      if (this.held.pickUp(it.item ?? it.id, it.object)) ev.emit('interact:used', { id: it.id, kind: it.kind });
    } else if (effect === 'place') {
      if (it.socket && this.held.place(it.socket)) ev.emit('interact:used', { id: it.id, kind: it.kind });
    } else if (effect === 'use') ev.emit('interact:used', { id: it.id, kind: 'use' });
  }

  private startAnim(it: Interactable, clip: XiClipName, effect: AnimEffect, t0 = 0): void {
    this.o.actor.halt();
    this.o.actor.locked = true;
    const a: Extract<Action, { kind: 'anim' }> = { kind: 'anim', target: it, clip, t: t0, dur: xiClipDuration(clip), at: xiInteractEventSec(clip), fired: effect === 'none', effect };
    this.action = a;
    this.o.actor.anim?.setPose(clip, t0);
  }

  private stepAnim(a: Extract<Action, { kind: 'anim' }>, dt: number): void {
    a.t = Math.min(a.dur, a.t + dt);
    this.o.actor.anim?.setPose(a.clip, a.t);
    const body = this.o.actor.body;
    body.velocity.x = body.velocity.z = 0;
    if (!a.fired && a.t >= a.at - 1e-6) {
      a.fired = true;
      this.applyEffect(a.target, a.effect);
    }
    if (a.t >= a.dur - 1e-6) this.endAction();
  }

  /** 有动画、没有交互点的 socket 类（灯台 / 桌面）：按 socket 到角色的方向在 animStand 米外站好、面向 socket */
  private animStandPoint(it: Interactable): { position: THREE.Vector3; facing: number } | null {
    const dist = it.animStandDist();
    if (dist === null || it.interactPoint) return null;
    const target = (it.kind === 'place' ? it.socket : null) ?? it.object;
    const p = target.getWorldPosition(new THREE.Vector3());
    const b = this.o.actor.body.position;
    let dx = b.x - p.x;
    let dz = b.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      dx = -Math.sin(this.o.actor.facing);
      dz = -Math.cos(this.o.actor.facing);
    } else {
      dx /= len;
      dz /= len;
    }
    return { position: new THREE.Vector3(p.x + dx * dist, b.y, p.z + dz * dist), facing: Math.atan2(-dx, -dz) };
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
    const lp = this.o.linkPriority?.() ?? null;
    // 1. 可选候选 + 焦点在屏幕上的位置；相机背后的点投影会翻转：排到最后
    const cands = this.pickScratch;
    cands.length = 0;
    let topInView = -Infinity;
    for (const it of this.items) {
      if (lp !== null && it.priority < lp) continue;
      if (!this.canInteract(it)) continue;
      it.focus(tmpA);
      ndc.copy(tmpA).project(this.o.camera);
      const behind = ndc.z > 1;
      const d2 = ndc.x * ndc.x + ndc.y * ndc.y;
      cands.push({ it, d2, score: behind ? 1e6 + d2 : d2 });
      if (!behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) topInView = Math.max(topInView, it.priority);
    }
    // 2. 离屏幕中心最近的；BUG-014：设了 aimCone 的没对准时，让给画面里优先级更高的候选
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const c of cands) {
      if (c.it.aimCone !== null && c.it.priority < topInView && c.d2 > c.it.aimCone * c.it.aimCone) continue;
      if (c.score < bestScore) {
        bestScore = c.score;
        best = c.it;
      }
    }
    cands.length = 0;
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

  private startApproach(it: Interactable, then: Then): void {
    const actor = this.o.actor;
    const body = actor.body;
    const stand = (this.animFor(it) ? this.animStandPoint(it) : null) ?? it.standPoint(new THREE.Vector3());
    const from = body.position.clone();
    const to = new THREE.Vector3(stand.position.x, from.y, stand.position.z);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    // 不穿模：路径上有碰撞体挡着就不走，原地转身（物理每步也会把角色推出碰撞体）
    if (dist > 1e-3 && !this.pathClear(from, to, body)) to.copy(from);
    const moveDist = from.distanceTo(to);
    const turn = Math.abs(angleDiff(actor.facing, stand.facing));
    // 时长：平移按 2.5 m/s、转身按 180°/approachMaxTime 取较长者，限制在 [approachMinTime, approachMaxTime]；已经站好且朝向对了就不走
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

  private afterApproach(it: Interactable, then: Then): void {
    const ev = this.o.events;
    const clip = this.animFor(it);
    if (then === 'use' || then === 'pickup' || then === 'place') {
      if (clip) {
        this.startAnim(it, clip, then);
        return;
      }
      this.endAction();
      if (then === 'use') ev.emit('interact:used', { id: it.id, kind: 'use' });
      else this.applyEffect(it, then);
      return;
    }
    this.o.actor.locked = true;
    if (then === 'hold') {
      const pre = clip ? (xiEventSec(clip, 'turnStart') ?? 0) : 0;
      this.action = { kind: 'hold', target: it, t: 0, clip, pre };
      if (clip) this.o.actor.anim?.setPose(clip, 0);
    } else {
      const anim = this.o.actor.anim;
      const start = anim?.has('xi-push-start') ? xiClipDuration('xi-push-start') : 0;
      this.action = { kind: 'push', target: it, t: 0, start, moveAt: Math.min(start, cfg.pushStartMoveAt) };
      if (start > 0) anim?.setPose('xi-push-start', 0);
      else this.startPushLoop(it);
    }
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
    // 有 clip：前 pre 秒是握住阀门（圆环不动），之后圆环按 holdSeconds 计、clip 在 turnStart–turnEnd 之间同步转
    const p = Math.min(1, Math.max(0, a.t - a.pre) / a.target.holdSeconds);
    if (a.clip) {
      const ts = a.pre;
      const te = xiEventSec(a.clip, 'turnEnd') ?? xiClipDuration(a.clip);
      this.o.actor.anim?.setPose(a.clip, a.t < ts ? a.t : ts + p * (te - ts));
    }
    ev.emit('interact:holdProgress', { id: a.target.id, progress: p });
    if (p >= 1) {
      const clip = a.clip;
      this.endAction();
      ev.emit('interact:used', { id: a.target.id, kind: 'hold' });
      // 松手段（turnEnd → 末帧）照常播完，期间仍锁定
      if (clip) this.startAnim(a.target, clip, 'none', xiEventSec(clip, 'turnEnd') ?? xiClipDuration(clip));
    }
  }

  private startPushLoop(it: Interactable): void {
    const anim = this.o.actor.anim;
    if (anim?.has('xi-push-loop')) anim.setLoop('xi-push-loop', pushRate(it.track?.speed ?? cfg.pushSpeed));
  }

  /** 停止推：物体已经开始动（过了 moveAt）且有 xi-push-end → 原地播完收手（期间仍锁定）；还没动就松手直接淡回 */
  private stopPush(a: Extract<Action, { kind: 'push' }>): void {
    const pushing = a.t > a.moveAt;
    this.endAction();
    if (pushing && this.o.actor.anim?.has('xi-push-end')) this.startAnim(a.target, 'xi-push-end', 'none');
  }

  /** 推的阶段（测试 / smoke 读）：start = 播 xi-push-start，loop = 推着走；不在推 = null */
  get pushPhase(): 'start' | 'loop' | null {
    const a = this.action;
    if (a.kind !== 'push') return null;
    return a.t < a.start ? 'start' : 'loop';
  }

  private stepPush(a: Extract<Action, { kind: 'push' }>, dt: number): void {
    const it = a.target;
    const track = it.track;
    if (!track || !it.enabled || !this.o.input.isDown('interact')) {
      this.stopPush(a);
      return;
    }
    let k = 1;
    if (a.t < a.start) {
      // 弯腰上手；最后一帧 = push-loop 第 0 帧
      const t0 = a.t;
      a.t = Math.min(a.start, a.t + dt);
      this.o.actor.anim?.setPose('xi-push-start', a.t);
      if (a.t >= a.start) {
        this.o.actor.anim?.clearPose();
        this.startPushLoop(it);
      }
      // 后半段与移动重叠：本步速度系数 = 步中点的 pushStartRamp（moveAt 前为 0，start 时为 1）
      k = pushStartRamp((t0 + a.t) / 2, a.moveAt, a.start);
      if (k <= 0) {
        const b = this.o.actor.body;
        b.velocity.x = b.velocity.z = 0;
        return;
      }
    } else if (a.start <= 0 && a.t < cfg.pushEaseIn) {
      // 没有 push-start（白盒）：按住即推，前 pushEaseIn 秒 smoothstep 缓入（a.t 只在这段累加）
      const t0 = a.t;
      a.t = Math.min(cfg.pushEaseIn, a.t + dt);
      k = pushStartRamp((t0 + a.t) / 2, 0, cfg.pushEaseIn);
    }
    const len = track.from.distanceTo(track.to);
    const speed = track.speed ?? cfg.pushSpeed;
    const prevT = it.pushT;
    it.pushT = len <= 0 ? 1 : Math.min(1, it.pushT + (speed * k * dt) / len);
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
      this.stopPush(a);
      this.o.events.emit('interact:pushEnd', { id: it.id });
      this.o.events.emit('interact:used', { id: it.id, kind: 'push' });
    }
  }

  private endAction(): void {
    const prev = this.action;
    const had = prev.kind !== 'none';
    this.action = { kind: 'none' };
    if (had) this.o.actor.locked = false;
    const anim = this.o.actor.anim;
    if (anim && (prev.kind === 'anim' || (prev.kind === 'hold' && prev.clip))) anim.clearPose();
    if (anim && prev.kind === 'push') {
      anim.setLoop(null);
      if (prev.t < prev.start) anim.clearPose();
    }
  }
}

/** PlayerRig → InteractionActor（hand：角色可见模型上的手部挂点，没有骨骼时挂在身前） */
export function actorFromRig(rig: {
  body: { body: CharacterBody };
  controller: { facing: number; locked: boolean; busy: boolean; halt(): void };
  visual: THREE.Object3D;
  animator?: InteractionAnim;
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
    ...(rig.animator ? { anim: rig.animator } : {}),
  };
}
