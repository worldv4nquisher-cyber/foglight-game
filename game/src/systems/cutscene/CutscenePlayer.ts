import * as THREE from 'three';
import { lookRotation, smoothstep01, type CameraPose } from '@/systems/camera/CameraTrack';
import type { CutsceneClock } from './CutsceneClock';

/**
 * 演出播放器（035，无 DOM / 无场景依赖，Node 单测直接用）：
 * - 时间 t 只来自 CutsceneClock（音频时钟 / 后备时钟），不自己累加 dt；
 * - cue：时钟越过 at 的那一帧按顺序触发一次（一帧跨过多个也按顺序全触发），记下触发时的 t 和时钟来源（冒烟对表）；
 * - 镜头：shots 分段按 t 连续采样（段内 ease，段与段之间是硬切）；
 * - 结束：t ≥ duration → onFinish('end')；skip() → onFinish('skip')（跳过的终态由调用方套用）。只结束一次。
 */
export interface CutsceneCue {
  id: string;
  at: number;
  run?: (t: number) => void;
}

export interface CutsceneCueLog {
  id: string;
  at: number;
  /** 实际触发时的演出时间 */
  firedAt: number;
  source: string;
}

export type CutsceneEnd = 'end' | 'skip';

export interface CutscenePlayerOptions {
  id: string;
  duration: number;
  cues: readonly CutsceneCue[];
  clock: CutsceneClock;
  /** 每帧（cue 触发之后） */
  onUpdate?: (t: number) => void;
  onFinish?: (how: CutsceneEnd, t: number) => void;
}

export class CutscenePlayer {
  readonly id: string;
  readonly duration: number;
  readonly clock: CutsceneClock;
  readonly log: CutsceneCueLog[] = [];
  private readonly cues: CutsceneCue[];
  private next = 0;
  private _done: CutsceneEnd | null = null;
  private readonly onUpdate: ((t: number) => void) | null;
  private readonly onFinish: ((how: CutsceneEnd, t: number) => void) | null;

  constructor(opts: CutscenePlayerOptions) {
    this.id = opts.id;
    this.duration = opts.duration;
    this.clock = opts.clock;
    this.cues = [...opts.cues].sort((a, b) => a.at - b.at);
    this.onUpdate = opts.onUpdate ?? null;
    this.onFinish = opts.onFinish ?? null;
  }

  get t(): number {
    return this.clock.t;
  }

  get done(): CutsceneEnd | null {
    return this._done;
  }

  /** 已触发的 cue id */
  fired(id: string): CutsceneCueLog | null {
    return this.log.find((l) => l.id === id) ?? null;
  }

  /** 每帧调用：走时钟、触发 cue、回调，到点结束。返回当前 t */
  update(): number {
    if (this._done) return this.clock.t;
    const t = this.clock.tick();
    while (this.next < this.cues.length && (this.cues[this.next]?.at ?? Infinity) <= t) {
      const c = this.cues[this.next++]!;
      this.log.push({ id: c.id, at: c.at, firedAt: t, source: this.clock.source });
      c.run?.(t);
    }
    this.onUpdate?.(t);
    if (t >= this.duration) this.finish('end');
    return t;
  }

  /** 跳过（已结束返回 false） */
  skip(): boolean {
    if (this._done) return false;
    this.finish('skip');
    return true;
  }

  private finish(how: CutsceneEnd): void {
    this._done = how;
    this.onFinish?.(how, this.clock.t);
  }
}

// ---------------------------------------------------------------- 镜头分段

export interface ShotKey {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

export type ShotEase = 'linear' | 'smooth' | 'in' | 'out';

/** 一个镜头：start–end 之间 from → to；下一个镜头的 start 就是硬切点 */
export interface Shot {
  name: string;
  start: number;
  end: number;
  from: ShotKey;
  to: ShotKey;
  ease?: ShotEase;
}

function easeOf(e: ShotEase | undefined, u: number): number {
  const k = Math.min(1, Math.max(0, u));
  if (e === 'linear') return k;
  if (e === 'in') return k * k;
  if (e === 'out') return 1 - (1 - k) * (1 - k);
  return smoothstep01(k);
}

/** t 时刻所在的镜头（按 start 排序；t 早于第一个 = 第一个，落在两段之间 = 前一段停在 end） */
export function shotAt(shots: readonly Shot[], t: number): Shot | null {
  let cur: Shot | null = shots[0] ?? null;
  for (const s of shots) if (t >= s.start) cur = s;
  return cur;
}

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

/** 采样 t 时刻的镜头姿态 */
export function sampleShots(shots: readonly Shot[], t: number, out: CameraPose): CameraPose {
  const s = shotAt(shots, t);
  if (!s) return out;
  const k = easeOf(s.ease, s.end > s.start ? (t - s.start) / (s.end - s.start) : 1);
  tmpPos.lerpVectors(s.from.position, s.to.position, k);
  tmpLook.lerpVectors(s.from.lookAt, s.to.lookAt, k);
  out.position.copy(tmpPos);
  lookRotation(tmpPos, tmpLook, out.quaternion);
  out.fov = s.from.fov + (s.to.fov - s.from.fov) * k;
  return out;
}
