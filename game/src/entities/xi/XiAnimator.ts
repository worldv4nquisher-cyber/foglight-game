import * as THREE from 'three';
import { Component } from '../Component';
import { KinematicBody } from '../components/KinematicBody';
import { PlayerController } from '../components/PlayerController';
import {
  XI_CLIP_ALIASES,
  XI_CLIP_NAMES,
  XI_CLIP_SPECS,
  XI_FPS,
  XI_CLIP_FALLBACK,
  LOCO_FADE,
  locoBlend,
  locoRateComp,
  measureRootZ,
  stairsRate,
  stepAcrossRootZ,
  xiClipDuration,
  type LocoBlend,
  type XiAnyClip,
  type XiClipName,
} from './clips';

/** 动作之间的默认交叉淡化（s） */
const FADE = 0.2;
/** 转身尾段：34 → 40 帧淡出到待机 */
const TURN_TAIL_FADE = (40 - 34) / XI_FPS;
const DEG = Math.PI / 180;

/** 按实际 clip 名（含旧名别名）在 clip 列表里找 */
export function findXiClip(clips: readonly THREE.AnimationClip[], name: XiAnyClip): THREE.AnimationClip | null {
  const names = [name, ...(XI_CLIP_ALIASES[name] ?? [])];
  for (const n of names) {
    const c = clips.find((x) => x.name === n);
    if (c) return c;
  }
  return null;
}

/**
 * turn-l90/r90 的尾段（34 → 40 帧）：root 骨在 34 帧已经转完 ±90°，此时把实体朝向 += ±90°，
 * 尾段的 root 旋转左乘 −yaw 抵消，画面不跳。
 */
export function makeTurnTail(clip: THREE.AnimationClip, yawDeg: number, rootBone = 'root'): THREE.AnimationClip {
  const spec = XI_CLIP_SPECS['xi-turn-l90'];
  const start = spec.rootYawEndFrame;
  const n = spec.frames - start; // 34..40 共 7 个采样
  const inv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yawDeg * DEG);
  const q = new THREE.Quaternion();
  const times = Array.from({ length: n }, (_, i) => i / XI_FPS);
  // 关键帧是精简过的（不一定每帧都有），逐帧重采样，不用 AnimationUtils.subclip（它只截已有关键帧）
  const tracks = clip.tracks.map((track) => {
    // createInterpolant 是运行时方法（@types/three 没声明）
    const interp = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
    const size = track.getValueSize();
    const values = new Float32Array(n * size);
    for (let i = 0; i < n; i++) values.set(interp.evaluate((start + i) / XI_FPS), i * size);
    if (track.name === `${rootBone}.quaternion`) {
      for (let i = 0; i < values.length; i += 4) q.fromArray(values, i).premultiply(inv).toArray(values, i);
    }
    const Ctor = track.constructor as new (name: string, times: number[], values: Float32Array) => THREE.KeyframeTrack;
    return new Ctor(track.name, times, values);
  });
  return new THREE.AnimationClip(`${clip.name}-tail`, (n - 1) / XI_FPS, tracks);
}

interface Slot {
  action: THREE.AnimationAction;
  w: number;
  target: number;
  /** 每秒权重变化量（1 / 淡化时长） */
  fade: number;
}

export interface XiAnimatorOptions {
  /** 角色模型（getModel('char-xi') 的克隆；mixer 根） */
  model: THREE.Object3D;
  clips: readonly THREE.AnimationClip[];
  /** 手上是否提着风灯（用 *-lantern 变体） */
  lantern?: () => boolean;
}

export interface XiTurnOptions {
  /** 转身期间锁住玩家输入（默认 true） */
  lock?: boolean;
}

/**
 * 汐的动画状态机（v0.1-017）：AnimationMixer + 每个 action 一条权重通道（线性交叉淡化）。
 * - 移动层：idle / walk / jog（或 *-lantern）按实际水平速度混合，播放率与速度同步（locoBlend，无滑步）；
 *   楼梯上换 stairs-up/down，播放率 = 水平速度 / 0.7091；自动跨越时播 step-across（clip 带根运动时反向平移模型抵消，按 hips 轨道实测，现在交付的是原地 = 不抵消）。
 * - 覆盖层：pose（外部按游戏时间驱动的一次性动作，交互用）、loop（推、操作、读…按给定播放率循环）、turn（原地转身）。
 * 一次性动作的时间由固定步给（setPose），与帧率无关；mixer 只负责循环 clip 前进和混合。
 */
export class XiAnimator extends Component {
  readonly mixer: THREE.AnimationMixer;
  readonly model: THREE.Object3D;
  /** 实际拿到的 clip（名字 = XiClipName；别名已归一） */
  readonly clips = new Map<XiClipName, THREE.AnimationClip>();
  /** clip 表里有、anims.glb 里没有的 */
  readonly missing: XiClipName[] = [];
  /** 当前移动层混合（dev 面板 / smoke 读） */
  readonly blend: LocoBlend = locoBlend(0);
  /** 当前状态（dev / smoke 读） */
  state = 'idle';
  private readonly slots = new Map<string, Slot>();
  private readonly lantern: () => boolean;
  private body!: KinematicBody;
  private controller!: PlayerController;
  private pose: { name: XiAnyClip; t: number; fadeOut: number } | null = null;
  private loop: { name: XiAnyClip; rate: number } | null = null;
  private turn: {
    yawDeg: number;
    t: number;
    turned: boolean;
    lock: boolean;
    resolve: () => void;
    clip: 'xi-turn-l90' | 'xi-turn-r90';
  } | null = null;
  private vy = 0;
  private speed = 0;
  /** step-across 实测根运动（m，hips.position 轨道首尾差；原地 clip 为 0） */
  readonly stepRootZ: number;
  /** 跨越时模型的根运动抵消（局部 z） */
  private readonly rootOffset = new THREE.Object3D();

  constructor(opts: XiAnimatorOptions) {
    super();
    this.model = opts.model;
    this.lantern = opts.lantern ?? (() => false);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of XI_CLIP_NAMES) {
      const c = findXiClip(opts.clips, name);
      if (!c) {
        this.missing.push(name);
        continue;
      }
      this.clips.set(name, c);
      const spec: { loop: boolean } = XI_CLIP_SPECS[name];
      const a = this.mixer.clipAction(c);
      a.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.enabled = true;
      a.setEffectiveWeight(0);
      this.slots.set(name, { action: a, w: 0, target: 0, fade: 1 / FADE });
    }
    const sa = this.clips.get('xi-step-across');
    // extras.rootMotion.inPlace = true（2026-10-30 起 README / extras 一致）→ 不抵消；没写 inPlace 的旧文件按 hips 轨道实测
    const rm = (sa?.userData as { rootMotion?: { inPlace?: boolean } } | undefined)?.rootMotion;
    this.stepRootZ = rm?.inPlace === true ? 0 : measureRootZ(sa?.tracks.find((t) => t.name === 'hips.position')?.values ?? null);
    for (const [name, yaw] of [
      ['xi-turn-l90', 90],
      ['xi-turn-r90', -90],
    ] as const) {
      const c = this.clips.get(name);
      if (!c) continue;
      const a = this.mixer.clipAction(makeTurnTail(c, yaw));
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(0);
      this.slots.set(`${name}-tail`, { action: a, w: 0, target: 0, fade: 1 / TURN_TAIL_FADE });
    }
    // 待机起始权重 1，避免首帧 T-pose
    const idle = this.slots.get('xi-idle');
    if (idle) {
      idle.w = idle.target = 1;
      idle.action.setEffectiveWeight(1).play();
    }
  }

  /** 有没有这个 clip（缺了但有代替的也算） */
  has(name: XiAnyClip): boolean {
    return this.slotOf(name) !== undefined;
  }

  /** 实际用来播 name 的 clip 名（旧版 anims.glb 没有 xi-pickup-shelf → xi-pickup-table） */
  resolve(name: XiAnyClip): XiClipName | null {
    if (this.clips.has(name)) return name;
    const alt = XI_CLIP_FALLBACK[name];
    return alt && this.clips.has(alt) ? alt : null;
  }

  private slotOf(name: string): Slot | undefined {
    const n = this.resolve(name as XiAnyClip);
    return n ? this.slots.get(n) : this.slots.get(name);
  }

  override onAttach(): void {
    this.body = this.entity.require(KinematicBody);
    this.controller = this.entity.require(PlayerController);
    // 根运动抵消节点：model 原来的父 → rootOffset → model
    const parent = this.model.parent;
    if (parent) {
      parent.add(this.rootOffset);
      this.rootOffset.add(this.model);
    }
  }

  override onDetach(): void {
    this.mixer.stopAllAction();
  }

  // ------------------------------------------------------------------ 覆盖层 API

  /**
   * 一次性动作停在第 t 秒（外部按游戏时间推进；每个固定步调用）。第一次调用时从当前姿势交叉淡入（0.2 s）。
   * fadeOut：clearPose 时淡出到移动层的时长。
   */
  setPose(name: XiAnyClip, t: number, fadeOut = FADE): void {
    if (!this.slotOf(name)) return;
    this.pose = { name, t, fadeOut };
  }

  /** 结束一次性动作，淡回移动层 */
  clearPose(): void {
    const p = this.pose;
    if (!p) return;
    const s = this.slotOf(p.name);
    if (s) s.fade = 1 / Math.max(1e-3, p.fadeOut);
    this.pose = null;
  }

  get posing(): XiAnyClip | null {
    return this.pose?.name ?? null;
  }

  /** 覆盖循环（推 / 操作 / 读 / 划船…），rate = 播放率；null 结束 */
  setLoop(name: XiAnyClip | null, rate = 1): void {
    if (name === null || !this.slotOf(name)) {
      this.loop = null;
      return;
    }
    this.loop = { name, rate };
  }

  get looping(): XiAnyClip | null {
    return this.loop?.name ?? null;
  }

  /** clip 当前混合权重 0–1（手持道具按它定显隐；没有这个 clip = 0） */
  weightOf(name: string): number {
    return this.slotOf(name)?.w ?? 0;
  }

  /**
   * 原地转身 90°（turn-l90 / r90）：root 骨在 34 帧转完，此时实体朝向 += ±90°，尾段 34–40 帧淡回待机。
   * 返回在转身结束（40 帧）时 resolve。缺 clip 时直接改朝向。
   */
  turnInPlace(dir: 'l' | 'r', opts: XiTurnOptions = {}): Promise<void> {
    const clip = dir === 'l' ? 'xi-turn-l90' : 'xi-turn-r90';
    const yawDeg = XI_CLIP_SPECS[clip].rootYawDeg;
    this.turn?.resolve();
    if (!this.clips.has(clip)) {
      this.controller.facing += yawDeg * DEG;
      return Promise.resolve();
    }
    const lock = opts.lock ?? true;
    if (lock) this.controller.locked = true;
    this.controller.halt();
    return new Promise((resolve) => {
      this.turn = { yawDeg, t: 0, turned: false, lock, resolve, clip };
    });
  }

  get turning(): boolean {
    return this.turn !== null;
  }

  // ------------------------------------------------------------------ 每步

  override fixedUpdate(dt: number): void {
    const b = this.body.body;
    const v = Math.hypot(b.actualVelocity.x, b.actualVelocity.z);
    this.speed = v;
    // 竖直速度平滑（楼梯上下判断）
    const dy = dt > 0 ? (b.position.y - b.prevPosition.y) / dt : 0;
    this.vy += (dy - this.vy) * Math.min(1, dt * 8);

    const turn = this.turn;
    if (turn) {
      turn.t += dt;
      const endT = XI_CLIP_SPECS[turn.clip].rootYawEndFrame / XI_FPS;
      if (!turn.turned && turn.t >= endT) {
        turn.turned = true;
        this.controller.facing += turn.yawDeg * DEG;
        // 立刻从整段切到「已抵消朝向」的尾段（同一时刻姿势相同），尾段再淡回移动层
        const main = this.slots.get(turn.clip);
        const tail = this.slots.get(`${turn.clip}-tail`);
        if (main && tail) {
          tail.w = main.w;
          main.w = 0;
          main.action.setEffectiveWeight(0);
          tail.action.reset().play();
          tail.action.timeScale = 0;
          tail.action.setEffectiveWeight(tail.w);
        }
      }
      if (turn.t >= xiClipDuration(turn.clip)) {
        if (turn.lock) this.controller.locked = false;
        this.turn = null;
        turn.resolve();
      }
    }
  }

  override update(dt: number): void {
    const traversal = this.controller.traversal;
    const stairs = this.controller.stairs.speed !== null && this.speed > 0.1;
    const lantern = this.lantern();
    for (const s of this.slots.values()) s.target = 0;

    let state: string;
    let rootZ = 0;
    /** 本帧是纯移动层：根速度（m/s），用于权重淡化后的播放率补偿 */
    let locoSpeed: number | null = null;
    const turn = this.turn;
    if (turn) {
      state = turn.turned ? 'turn-tail' : 'turn';
      const name = turn.turned ? `${turn.clip}-tail` : turn.clip;
      const s = this.slots.get(name);
      if (s) {
        s.target = 1;
        if (!turn.turned) {
          s.fade = 1 / FADE;
          s.action.timeScale = 0;
          this.ensurePlaying(s);
          s.action.time = Math.min(turn.t, xiClipDuration(turn.clip));
        } else {
          s.action.time = Math.min(turn.t - XI_CLIP_SPECS[turn.clip].rootYawEndFrame / XI_FPS, TURN_TAIL_FADE);
          // 尾段：一开始就往待机淡（34 → 40 帧淡完）
          s.target = 0;
          s.fade = 1 / TURN_TAIL_FADE;
          this.setLoco(0, lantern, 1 / TURN_TAIL_FADE);
        }
      }
    } else if (this.pose) {
      const p = this.pose;
      state = `pose:${p.name}`;
      const s = this.slotOf(p.name);
      if (s) {
        s.target = 1;
        s.fade = 1 / FADE;
        s.action.timeScale = 0;
        this.ensurePlaying(s);
        s.action.time = Math.min(p.t, s.action.getClip().duration);
      }
    } else if (traversal && this.slots.has('xi-step-across')) {
      // 跨越：clip 时间按跨越进度映射（TraversalLink 与 hips 根运动都是 smoothstep），模型反向平移抵消根运动
      state = 'step-across';
      const s = this.slots.get('xi-step-across')!;
      const clipT = (traversal.t / traversal.duration) * xiClipDuration('xi-step-across');
      s.target = 1;
      s.fade = 1 / 0.1;
      s.action.timeScale = 0;
      this.ensurePlaying(s);
      s.action.time = Math.min(clipT, xiClipDuration('xi-step-across'));
      rootZ = -stepAcrossRootZ(clipT, this.stepRootZ);
    } else if (this.loop) {
      const l = this.loop;
      state = `loop:${l.name}`;
      const s = this.slotOf(l.name);
      if (s) {
        s.target = 1;
        s.fade = 1 / FADE;
        s.action.timeScale = l.rate;
        this.ensurePlaying(s);
      }
    } else if (stairs) {
      const up = this.vy >= 0;
      state = up ? 'stairs-up' : 'stairs-down';
      const s = this.slots.get(up ? 'xi-stairs-up' : 'xi-stairs-down');
      if (s) {
        s.target = 1;
        s.fade = 1 / FADE;
        s.action.timeScale = stairsRate(this.speed);
        this.ensurePlaying(s);
      } else this.setLoco(this.speed, lantern);
    } else {
      // 移动层内部按 LOCO_FADE 淡化 + 起停播放率补偿（batch8 起步滑步），见下面权重更新之后
      this.setLoco(this.speed, lantern, 1 / LOCO_FADE);
      state = this.blend.jog > 0.5 ? 'jog' : this.blend.walk > 0.5 ? 'walk' : 'idle';
      locoSpeed = this.speed;
    }
    this.state = state;
    this.rootOffset.position.z = rootZ;

    for (const s of this.slots.values()) {
      if (s.w !== s.target) {
        const step = s.fade * dt;
        s.w = s.w < s.target ? Math.min(s.target, s.w + step) : Math.max(s.target, s.w - step);
      }
      s.action.setEffectiveWeight(s.w);
      if (s.w <= 0 && s.target <= 0 && s.action.isRunning() && !XiAnimator.LOCO.has(s.action.getClip().name)) s.action.stop();
    }
    if (locoSpeed !== null) this.compensateLoco(locoSpeed, lantern);
    this.mixer.update(dt);
  }

  private static readonly LOCO = new Set([
    'xi-idle',
    'xi-walk',
    'xi-jog',
    'xi-idle-lantern',
    'xi-walk-lantern',
    'xi-jog-lantern',
  ]);

  private ensurePlaying(s: Slot): void {
    if (!s.action.isRunning() || s.w <= 0) {
      if (s.w <= 0) s.action.reset();
      s.action.play();
    }
  }

  /** 移动层目标权重（另一套变体置 0）；fade = 每秒权重变化量 */
  private setLoco(speed: number, lantern: boolean, fade = 1 / FADE): void {
    const b = locoBlend(speed, this.blend);
    const sfx = lantern ? '-lantern' : '';
    const idle = this.slots.get(`xi-idle${sfx}`) ?? this.slots.get('xi-idle');
    const walk = this.slots.get(`xi-walk${sfx}`) ?? this.slots.get('xi-walk');
    const jog = this.slots.get(`xi-jog${sfx}`) ?? this.slots.get('xi-jog');
    if (idle) this.drive(idle, b.idle, 1, fade);
    if (walk) this.drive(walk, b.walk, b.walkRate, fade);
    if (jog) this.drive(jog, b.jog, b.jogRate, fade);
    // 走 / 跑相位锁定：jog 的归一化相位跟 walk（两者左脚都在 0、右脚在半周期落地）
    if (walk && jog && b.walk > 0 && b.jog > 0) {
      const wd = walk.action.getClip().duration;
      const jd = jog.action.getClip().duration;
      jog.action.time = ((walk.action.time % wd) / wd) * jd;
    }
  }

  /** 起停瞬间权重还没到位：walk / jog 播放率同乘 locoRateComp（稳态 k = 1，不改变） */
  private compensateLoco(speed: number, lantern: boolean): void {
    const sfx = lantern ? '-lantern' : '';
    const idle = this.slots.get(`xi-idle${sfx}`) ?? this.slots.get('xi-idle');
    const walk = this.slots.get(`xi-walk${sfx}`) ?? this.slots.get('xi-walk');
    const jog = this.slots.get(`xi-jog${sfx}`) ?? this.slots.get('xi-jog');
    const k = locoRateComp(speed, { idle: idle?.w ?? 0, walk: walk?.w ?? 0, jog: jog?.w ?? 0 }, this.blend);
    if (k === 1) return;
    if (walk) walk.action.timeScale = this.blend.walkRate * k;
    if (jog) jog.action.timeScale = this.blend.jogRate * k;
  }

  private drive(s: Slot, target: number, rate: number, fade: number): void {
    s.target = Math.max(s.target, target);
    s.fade = fade;
    s.action.timeScale = rate;
    if (target > 0 && !s.action.isRunning()) s.action.play();
  }
}
