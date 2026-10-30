import type { EventBus } from '@/core/EventBus';
import type { StepSurface } from '@/systems/audio/sfxBank';
import { STEP_SURFACES } from '@/systems/audio/sfxBank';
import { xiSpec } from '@/entities/xi/clips';

/** 一步的水平距离（m）= 动画两步周期 strideM / 2：走 0.64 m、小跑 0.96 m（clips.ts 的 xi-walk / xi-jog） */
export const STEP_M = { walk: (xiSpec('xi-walk').strideM ?? 1.28) / 2, jog: (xiSpec('xi-jog').strideM ?? 1.92) / 2 } as const;

/**
 * 地面材质（032 脚步 5 组）：碰撞体名 `-surface-<材质>` 显式标注优先；否则按名字关键词；
 * 室内（-indoor 触发体里）用场景的室内材质（S2 小屋木地板 = indoor，S3 塔内石阶 = stone）；都不中用场景默认。
 */
export function surfaceOf(name: string | null | undefined, indoor: boolean, scene: { outdoor: StepSurface; indoor: StepSurface }): StepSurface {
  const n = (name ?? '').toLowerCase();
  const tag = /-surface-([a-z]+)/.exec(n)?.[1];
  if (tag && (STEP_SURFACES as readonly string[]).includes(tag)) return tag as StepSurface;
  if (/pier|deck|raft|plank|boat|wood|bed|crate|shed/.test(n)) return 'wood';
  if (indoor) return scene.indoor;
  if (/sandbar|seafloor|puddle|wet|tide-ramp/.test(n)) return 'wet';
  if (/sand|beach|shore|dune/.test(n)) return 'sand';
  if (/rock|reef|ridge|stone|step|stair|spiral|tower|platform|slope|pad|quay|cliff/.test(n)) return 'stone';
  return scene.outdoor;
}

/** 各场景地面默认：S1 退潮沙滩、S2 院子石板 / 小屋木地板、S3 礁石平台 / 塔内石阶 */
export const SCENE_SURFACES: Readonly<Record<string, { outdoor: StepSurface; indoor: StepSurface }>> = {
  s1: { outdoor: 'sand', indoor: 'wood' },
  s2: { outdoor: 'stone', indoor: 'indoor' },
  s3: { outdoor: 'stone', indoor: 'stone' },
};

export interface StepInput {
  /** 本固定步水平位移（m） */
  dist: number;
  onGround: boolean;
  running: boolean;
  /** 动作中（推 / 拿放 / 攀爬等由动作自己出声）不走脚步 */
  busy: boolean;
  ground: string | null | undefined;
  indoor: boolean;
}

/**
 * 脚步（sfx-step-<材质>，a–d 随机不重复由 SfxBank 挑）：着地且在走时按距离累计，每走一步（半个动画周期）发一下；
 * 第一步走出 1/2 步就响（起步不哑）；离地 / 停下 / busy 清零。
 */
export class Footsteps {
  steps = 0;
  last: StepSurface | null = null;
  private acc = 0;
  private walking = false;
  private readonly events: EventBus;
  private readonly scene: { outdoor: StepSurface; indoor: StepSurface };

  constructor(events: EventBus, levelId: string) {
    this.events = events;
    this.scene = SCENE_SURFACES[levelId] ?? { outdoor: 'stone', indoor: 'indoor' };
  }

  update(s: StepInput): void {
    if (!s.onGround || s.busy || s.dist < 1e-4) {
      this.walking = false;
      return;
    }
    const len = s.running ? STEP_M.jog : STEP_M.walk;
    if (!this.walking) {
      this.walking = true;
      this.acc = len / 2;
    }
    this.acc += s.dist;
    if (this.acc < len) return;
    this.acc -= len;
    const surface = surfaceOf(s.ground, s.indoor, this.scene);
    this.last = surface;
    this.steps++;
    this.events.emit('sfx:play', { id: `sfx-step-${surface}` });
  }
}
