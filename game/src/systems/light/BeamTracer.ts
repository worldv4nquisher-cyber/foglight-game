import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { BeamEmitter } from './BeamEmitter';
import { reflect, type Mirror, type MirrorHit } from './Mirror';
import type { BeamReceiver } from './BeamReceiver';

/** 挡光的世界：PhysicsSystem 满足这个接口（raycast 只查 kind = 'collider'，空气墙不挡光） */
export interface BeamWorld {
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number | null;
  readonly colliders: readonly { readonly dynamic: boolean; readonly moved: boolean; readonly enabled: boolean }[];
}

export type BeamEndKind = 'blocker' | 'mirrorBack' | 'receiver' | 'limit' | 'none';

export interface BeamSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
}

export interface BeamPath {
  emitter: BeamEmitter;
  segments: BeamSegment[];
  /** 末端：blocker 碰撞体 / mirrorBack 镜子背面 / receiver 接收器 / limit 第 5 面镜子（超出反射上限）/ none 射到最远距离 */
  end: BeamEndKind;
  endPoint: THREE.Vector3;
  /** 末端表面法线（光斑朝向；none 时为 null） */
  endNormal: THREE.Vector3 | null;
  reflections: number;
  /** 依次命中的镜子 id（含末端的背面 / 超限镜子） */
  mirrors: string[];
  receiver: BeamReceiver | null;
}

const tmpO = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const skinO = new THREE.Vector3();

/**
 * 光路计算（v0.1-012）：光源 → 镜子（反射定律，正面反射、背面挡光）→ … → 碰撞体 / 接收器；最多 4 次反射。
 * 只在变化时重算：puzzle:partRotated / puzzle:reset / tide:changed / beam:invalidate 事件，另外每步比对光源、镜子、接收器的世界矩阵
 * 和挡光碰撞体的 enabled / 移动（门开关、浮台），变了才重算。接收器每步按缓存的光路判定（光源淡入淡出不触发重算）。
 */
export class BeamTracer {
  readonly emitters: BeamEmitter[] = [];
  readonly mirrors: Mirror[] = [];
  readonly receivers: BeamReceiver[] = [];
  maxReflections: number = gameplay.beam.maxReflections;
  maxDistance: number = gameplay.beam.maxDistance;
  world: BeamWorld | null;
  paths: BeamPath[] = [];
  /** 上次重算耗时（ms）与累计次数 */
  lastMs = 0;
  traceCount = 0;
  private dirty = true;
  private events: EventBus | null = null;
  private readonly signature: number[] = [];
  private offs: Array<() => void> = [];

  constructor(world: BeamWorld | null = null) {
    this.world = world;
  }

  addEmitter(e: BeamEmitter): BeamEmitter {
    this.emitters.push(e);
    if (this.events) this.offs.push(e.bind(this.events));
    this.dirty = true;
    return e;
  }

  addMirror(m: Mirror): Mirror {
    this.mirrors.push(m);
    this.dirty = true;
    return m;
  }

  addReceiver(r: BeamReceiver): BeamReceiver {
    this.receivers.push(r);
    if (this.events) r.setEvents(this.events);
    this.dirty = true;
    return r;
  }

  get emitterCount(): number {
    return this.emitters.length;
  }

  invalidate(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** 订阅事件（重算触发 + 光源事件）；返回取消订阅 */
  bind(events: EventBus): () => void {
    this.events = events;
    const inv = (): void => this.invalidate();
    this.offs.push(
      events.on('puzzle:partRotated', inv),
      events.on('puzzle:reset', inv),
      events.on('tide:changed', inv),
      events.on('beam:invalidate', inv),
      ...this.emitters.map((e) => e.bind(events)),
    );
    for (const r of this.receivers) r.setEvents(events);
    return () => this.dispose();
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.offs = [];
    this.events = null;
  }

  /** 物体变换 / 碰撞体状态有没有变（每步，只读矩阵，不重算） */
  private detectChanges(): void {
    const sig = this.signature;
    let i = 0;
    const push = (v: number): void => {
      if (sig[i] !== v) {
        sig[i] = v;
        this.dirty = true;
      }
      i++;
    };
    const objs: THREE.Object3D[] = [];
    for (const e of this.emitters) objs.push(e.node);
    for (const m of this.mirrors) objs.push(m.node);
    for (const r of this.receivers) objs.push(r.node);
    for (const o of objs) {
      o.updateWorldMatrix(true, false);
      const el = o.matrixWorld.elements;
      for (let k = 0; k < 16; k++) push(el[k] ?? 0);
    }
    if (this.world) {
      for (const c of this.world.colliders) {
        push(c.enabled ? 1 : 0);
        if (c.dynamic && c.moved) this.dirty = true;
      }
    }
    if (sig.length !== i) {
      sig.length = i;
      this.dirty = true;
    }
  }

  /** 全量重算（所有光源，不管亮灭：画面淡出也要用光路）；返回耗时 ms */
  trace(): number {
    const t0 = performance.now();
    for (const m of this.mirrors) m.node.updateWorldMatrix(true, false);
    const centers = this.receivers.map((r) => r.center(new THREE.Vector3()));
    this.paths = this.emitters.map((e) => this.traceOne(e, centers));
    this.dirty = false;
    this.lastMs = performance.now() - t0;
    this.traceCount++;
    this.events?.emit('beam:traced', { ms: this.lastMs, paths: this.paths.length });
    return this.lastMs;
  }

  private traceOne(emitter: BeamEmitter, centers: THREE.Vector3[]): BeamPath {
    const o = emitter.origin(tmpO).clone();
    const d = emitter.direction(tmpD).clone().normalize();
    const path: BeamPath = { emitter, segments: [], end: 'none', endPoint: o.clone(), endNormal: null, reflections: 0, mirrors: [], receiver: null };
    const skin = gameplay.beam.mirrorSkin;
    let lastMirror: Mirror | null = null;
    // 上限 maxReflections + 1 段（第 5 次命中镜子即停）
    for (let guard = 0; guard <= this.maxReflections + 1; guard++) {
      const far = this.maxDistance;
      // 挡光碰撞体：反射后的第一段跳过 skin 以内（镜子自带碰撞外框）
      let blockT: number | null = null;
      if (this.world) {
        const off = lastMirror ? skin : 0;
        skinO.copy(o).addScaledVector(d, off);
        const h = this.world.raycast(skinO, d, far - off);
        blockT = h === null ? null : h + off;
      }
      let best = blockT ?? far;
      let kind: BeamEndKind = blockT === null ? 'none' : 'blocker';
      let mirrorHit: MirrorHit | null = null;
      let hitMirror: Mirror | null = null;
      for (const m of this.mirrors) {
        if (m === lastMirror) continue;
        // 镜面与碰撞体近乎重合（镜子的碰撞框）：镜面优先
        const h: MirrorHit | null = m.intersect(o, d, Math.min(far, best + skin));
        if (h && (!mirrorHit || h.t < mirrorHit.t)) {
          mirrorHit = h;
          hitMirror = m;
        }
      }
      if (mirrorHit) {
        best = mirrorHit.t;
        kind = mirrorHit.front ? 'limit' : 'mirrorBack';
      }
      let recv: BeamReceiver | null = null;
      for (let i = 0; i < this.receivers.length; i++) {
        const r = this.receivers[i];
        const c = centers[i];
        if (!r || !r.absorb || !c) continue;
        const t = r.intersect(o, d, best, c);
        if (t !== null && t < best) {
          best = t;
          recv = r;
        }
      }
      if (recv) kind = 'receiver';
      const end = o.clone().addScaledVector(d, best);
      path.segments.push({ from: o.clone(), to: end });
      path.endPoint.copy(end);
      if (recv) {
        path.end = 'receiver';
        path.receiver = recv;
        path.endNormal = d.clone().negate();
        return path;
      }
      if ((kind === 'limit' || kind === 'mirrorBack') && mirrorHit && hitMirror) {
        const m: Mirror = hitMirror;
        const h: MirrorHit = mirrorHit;
        path.mirrors.push(m.id);
        if (kind === 'limit' && path.reflections < this.maxReflections) {
          reflect(d, h.normal, d).normalize();
          o.copy(h.point);
          path.reflections++;
          lastMirror = m;
          continue;
        }
        path.end = kind;
        path.endNormal = kind === 'mirrorBack' ? h.normal.clone().negate() : h.normal.clone();
        return path;
      }
      path.end = kind;
      if (kind === 'blocker') path.endNormal = d.clone().negate();
      return path;
    }
    return path;
  }

  /**
   * 每个物理步：光源周期 / 淡入淡出 → 变化检测 → 需要时重算 → 接收器判定。
   * 放在 physics.step 之后（门、浮台等动态碰撞体已同步）。
   */
  fixedUpdate(dt: number): void {
    for (const e of this.emitters) {
      if (e.update(dt)) this.events?.emit('beam:emitter', { id: e.id, lit: e.lit });
    }
    this.detectChanges();
    if (this.dirty) this.trace();
    for (const r of this.receivers) {
      let hitBy: BeamPath | null = null;
      for (const p of this.paths) {
        if (p.emitter.lit && (p.receiver === r || (!r.absorb && this.segmentHits(r, p)))) {
          hitBy = p;
          break;
        }
      }
      r.fixedUpdate(dt, hitBy !== null, hitBy?.emitter.color ?? null, hitBy?.emitter.id ?? null);
    }
  }

  /** 非吸收接收器（absorb = false）：光路任一段穿过判定球就算命中，光继续往后走 */
  segmentHits(r: BeamReceiver, p: BeamPath): boolean {
    const c = r.center(tmpC);
    return p.segments.some((s) => {
      const len = s.from.distanceTo(s.to);
      const dir = s.to.clone().sub(s.from).normalize();
      return r.intersect(s.from, dir, len + 1e-6, c) !== null;
    });
  }

  debugLine(): string {
    const p = this.paths.map((x) => `${x.emitter.debugLine()} → ${x.reflections} 反射 · ${endName[x.end]}${x.receiver ? ` ${x.receiver.id}` : ''}`);
    const r = this.receivers.map((x) => x.debugLine());
    return `${p.join(' ｜ ')} ｜ ${r.join(' ')} ｜ 重算 ${this.traceCount} 次 ${this.lastMs.toFixed(3)} ms`;
  }
}

// text-ok: F4 调试读数（DEV 面板，不对玩家显示）
const endName: Record<BeamEndKind, string> = { blocker: '挡住', mirrorBack: '镜背挡光', receiver: '命中', limit: '超出反射上限', none: '射空' };
