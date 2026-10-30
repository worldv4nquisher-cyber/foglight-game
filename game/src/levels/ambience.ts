import type { EventBus } from '@/core/EventBus';
import { toLocal } from '@/levels/s3/layout';
import { S2 } from '@/levels/s2/layout';

export interface AmbienceCtx {
  indoor: boolean;
  pos: { x: number; y: number; z: number };
}
export interface AmbienceOneShot {
  id: string;
  /** 间隔（s，均匀随机） */
  min: number;
  max: number;
  /** 不满足时不响（计时继续，满足后到点就响） */
  when?: (c: AmbienceCtx) => boolean;
}
export interface AmbienceSpec {
  /** 当前应在响的环境循环（按区域：室内 / 室外 / 塔底） */
  loops: (c: AmbienceCtx) => readonly string[];
  oneShots: readonly AmbienceOneShot[];
}

/** 区域切换交叉淡化（s） */
export const AMBIENCE_XFADE_SEC = 1;
const outdoor = (c: AmbienceCtx): boolean => !c.indoor;
const S1_LOOPS = ['amb-waves-near', 'amb-rain-light', 'amb-wind-soft'] as const;
const S2_OUT = ['amb-rain-light', 'amb-eaves-drip', 'amb-waves-far', 'amb-wind-soft'] as const;
const S2_IN = ['amb-rain-on-roof', 'amb-room-clock'] as const;
const S2_IN_WINDOW = ['amb-rain-on-roof', 'amb-room-clock', 'amb-rain-on-glass'] as const;
/** S2 二层、离西窗 < 2 m：雨打窗玻璃叠在屋顶雨上 */
export const S2_GLASS_M = 2;
const nearWestWindow = (p: AmbienceCtx['pos']): boolean => {
  const [wx, , wz] = S2.points.westWindowInteract;
  return p.y > S2.house.upperFloorY - 0.5 && Math.hypot(p.x - wx, p.z - wz) < S2_GLASS_M;
};
const S3_OUT = ['amb-waves-crash', 'amb-rain-heavy', 'amb-wind-soft'] as const;
const S3_IN = ['amb-wind-tower'] as const;
const S3_IN_BASE = ['amb-wind-tower', 'amb-water-in-tower'] as const;
/** S3 塔底（局部 y < 5 m，一层 / 楼梯下段）听得到塔内积水 */
export const S3_WATER_MAX_Y = 5;

/** 032 环境音按场景 / 区域（art/audio/README.md 触发建议） */
export const AMBIENCE: Readonly<Record<string, AmbienceSpec>> = {
  s1: {
    loops: () => S1_LOOPS,
    oneShots: [
      { id: 'amb-pier-creak', min: 8, max: 20 },
      { id: 'amb-foghorn-far', min: 40, max: 90, when: outdoor },
      { id: 'amb-seabird-far', min: 60, max: 150, when: outdoor },
    ],
  },
  s2: {
    loops: (c) => (!c.indoor ? S2_OUT : nearWestWindow(c.pos) ? S2_IN_WINDOW : S2_IN),
    oneShots: [
      { id: 'amb-foghorn-far', min: 40, max: 90, when: outdoor },
      { id: 'amb-seabird-far', min: 60, max: 150, when: outdoor },
    ],
  },
  s3: {
    loops: (c) => (!c.indoor ? S3_OUT : toLocal(c.pos).y < S3_WATER_MAX_Y ? S3_IN_BASE : S3_IN),
    oneShots: [{ id: 'amb-seabird-far', min: 60, max: 150, when: outdoor }],
  },
};

/**
 * 环境音：进入场景按区域起循环（默认淡入 0.5 s），进出室内 / 塔底按 AMBIENCE_XFADE_SEC 交叉淡化；
 * 单发按间隔随机（首次也随机，不一进场就响）。离开场景由 Game 的 stopAllLoops 收尾；stop() 给场景内提前停用。
 */
export class Ambience {
  readonly playing = new Set<string>();
  private readonly timers: number[];
  private started = false;
  private readonly events: EventBus;
  private readonly spec: AmbienceSpec;
  private readonly rng: () => number;

  constructor(events: EventBus, spec: AmbienceSpec, rng: () => number = Math.random) {
    this.events = events;
    this.spec = spec;
    this.rng = rng;
    this.timers = spec.oneShots.map((o) => this.interval(o));
  }

  private interval(o: AmbienceOneShot): number {
    return o.min + (o.max - o.min) * this.rng();
  }

  update(dt: number, c: AmbienceCtx): void {
    const want = new Set(this.spec.loops(c));
    for (const id of [...this.playing]) {
      if (want.has(id)) continue;
      this.playing.delete(id);
      this.events.emit('sfx:loopStop', { id, fadeOut: AMBIENCE_XFADE_SEC });
    }
    for (const id of want) {
      if (this.playing.has(id)) continue;
      this.playing.add(id);
      this.events.emit('sfx:loop', this.started ? { id, fadeIn: AMBIENCE_XFADE_SEC } : { id });
    }
    this.started = true;
    this.spec.oneShots.forEach((o, i) => {
      this.timers[i] = (this.timers[i] ?? 0) - dt;
      if ((this.timers[i] ?? 0) > 0 || (o.when && !o.when(c))) return;
      this.timers[i] = this.interval(o);
      this.events.emit('sfx:play', { id: o.id });
    });
  }

  stop(fadeOut = AMBIENCE_XFADE_SEC): void {
    for (const id of this.playing) this.events.emit('sfx:loopStop', { id, fadeOut });
    this.playing.clear();
  }
}
