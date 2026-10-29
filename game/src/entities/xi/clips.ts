/**
 * 汐的动画 clip 表（v0.1-017，char-xi-anims.glb：31 个 clip（需求单 30 + 2026-10-29 加的 xi-pickup-shelf），30 fps，原地动画，朝向 +Z）。
 * 数值抄自 art/models/characters/README.md 与 GLB 的 animations[].extras；scripts/verify-xi.mjs 逐项比对 GLB，
 * 不一致时以 GLB 为准（改这里）。运行时 clip 名以 anims.glb 实际名字为准：美术统一命名前的旧名放在 XI_CLIP_ALIASES。
 * 本文件不依赖 three / DOM，Node 单测直接导入。
 */
export const XI_FPS = 30;

export interface XiClipSpec {
  /** 帧数（含收尾帧；循环 clip 的最后一帧 = 第一帧） */
  frames: number;
  loop: boolean;
  /** 事件帧（extras.eventFrames） */
  events?: Readonly<Record<string, number>>;
  /** 移动类：步幅速度（m/s，extras.strideSpeed）与两步周期长度（m） */
  strideSpeed?: number;
  strideM?: number;
  /** 楼梯：竖直速度（m/s，extras.vertSpeed） */
  vertSpeed?: number;
  /** 转身：root 骨偏航（°）与转完帧 */
  rootYawDeg?: number;
  rootYawEndFrame?: number;
  /** 根运动平移（m，汐局部 +Z） */
  rootTranslateZ?: number;
  /** 提灯类 */
  lantern?: boolean;
}

export const XI_CLIP_SPECS = {
  'xi-idle': { frames: 211, loop: true },
  'xi-idle-lantern': { frames: 151, loop: true, lantern: true },
  'xi-walk': { frames: 25, loop: true, strideSpeed: 1.6, strideM: 1.28 },
  'xi-walk-lantern': { frames: 25, loop: true, strideSpeed: 1.6, strideM: 1.28, lantern: true },
  'xi-jog': { frames: 19, loop: true, strideSpeed: 3.2, strideM: 1.92 },
  'xi-jog-lantern': { frames: 19, loop: true, strideSpeed: 3.2, strideM: 1.92, lantern: true },
  'xi-turn-l90': { frames: 41, loop: false, rootYawDeg: 90, rootYawEndFrame: 34 },
  'xi-turn-r90': { frames: 41, loop: false, rootYawDeg: -90, rootYawEndFrame: 34 },
  'xi-stairs-up': { frames: 23, loop: true, strideSpeed: 0.7091, vertSpeed: 0.5455 },
  'xi-stairs-down': { frames: 23, loop: true, strideSpeed: 0.7091, vertSpeed: -0.5455 },
  'xi-step-across': { frames: 49, loop: false, events: { leftOff: 8, leftLand: 22, rightOff: 25, rightLand: 42 }, rootTranslateZ: 0.85 },
  'xi-push-start': { frames: 37, loop: false, events: { handsOn: 26 } },
  'xi-push-loop': { frames: 37, loop: true, strideSpeed: 0.8, strideM: 0.96 },
  'xi-push-end': { frames: 37, loop: false, events: { handsOff: 6 } },
  'xi-ring-bell': { frames: 61, loop: false, events: { touch: 22, ring: 30 } },
  'xi-place': { frames: 71, loop: false, events: { set: 44, release: 48 }, lantern: true },
  'xi-pickup': { frames: 78, loop: false, events: { grab: 22, lift: 24 }, lantern: true },
  'xi-place-table': { frames: 55, loop: false, events: { set: 30, release: 34 }, lantern: true },
  'xi-pickup-table': { frames: 65, loop: false, events: { grab: 20, lift: 22 }, lantern: true },
  // S2 地窖木架取钥匙（架面 1.10 m，钥匙正前 0.45 m、偏右 5 cm）；grab 帧把钥匙挂 middle_03_r
  'xi-pickup-shelf': { frames: 81, loop: false, events: { grab: 22, lift: 25 } },
  'xi-operate-loop': { frames: 73, loop: true },
  'xi-valve-hold': { frames: 91, loop: false, events: { grip: 14, turnStart: 16, turnEnd: 76, release: 80 } },
  'xi-ignite-lever': { frames: 46, loop: false, events: { grip: 15, pullStart: 22, ignite: 34 }, lantern: true },
  'xi-read-loop': { frames: 121, loop: true },
  'xi-look-up': { frames: 151, loop: false, events: { upReached: 44, lookDown: 108 } },
  'xi-observe': { frames: 121, loop: true },
  'xi-shiver': { frames: 91, loop: false, events: { shiverStart: 10, shiverEnd: 66 } },
  'xi-row-boat': { frames: 91, loop: true, events: { catch: 0, finish: 33, bladeOut: 38, bladeIn: 86 } },
  'xi-tie-boat': { frames: 166, loop: false, events: { ropeAround1: 44, ropeAround2: 92, hitch: 118, tug: 130, tied: 134 } },
  'xi-sit-write': { frames: 121, loop: true, events: { penDown1: 0, penUp1: 42, penDown2: 54, penUp2: 96 } },
  'xi-stand-gaze': { frames: 181, loop: true },
} as const satisfies Record<string, XiClipSpec>;

export type XiClipName = keyof typeof XI_CLIP_SPECS;
export const XI_CLIP_NAMES = Object.keys(XI_CLIP_SPECS) as XiClipName[];

/**
 * 运行时 clip 缺失时的代替（旧版 anims.glb 没有 xi-pickup-shelf → 用 pickup-table，grab 帧 20 vs 22）。
 */
export const XI_CLIP_FALLBACK: Partial<Record<XiClipName, XiClipName>> = { 'xi-pickup-shelf': 'xi-pickup-table' };
/** 交互代码里统一用的 clip 名 */
export type XiAnyClip = XiClipName;

/** 美术统一命名前的旧名（anims.glb 里如果还是旧名，按旧名取） */
export const XI_CLIP_ALIASES: Partial<Record<XiAnyClip, readonly string[]>> = {
  'xi-ignite-lever': ['xi-pull-lever'],
};

export const xiSpec = (name: XiClipName): XiClipSpec => XI_CLIP_SPECS[name];

/** clip 时长（s）= (帧数 − 1) / 30 */
export const xiClipDuration = (name: XiAnyClip): number => (xiSpec(name).frames - 1) / XI_FPS;

/** 事件帧 → 秒；没有这个事件返回 null */
export function xiEventSec(name: XiAnyClip, event: string): number | null {
  const f = xiSpec(name).events?.[event];
  return f === undefined ? null : f / XI_FPS;
}

// ---------------------------------------------------------------- 播放率（防滑步）

export interface LocoBlend {
  idle: number;
  walk: number;
  jog: number;
  /** 各 clip 的 timeScale */
  walkRate: number;
  jogRate: number;
}

const WALK = XI_CLIP_SPECS['xi-walk'];
const JOG = XI_CLIP_SPECS['xi-jog'];
/** 起步 / 停步：0 → FULL_WALK_AT m/s 之间 idle 与 walk 交叉；walk 播放率最低 MIN_RATE（更慢时脚会略滑，只在起停的一瞬） */
const FULL_WALK_AT = 0.5;
const IDLE_BELOW = 0.05;

/**
 * 按水平速度 s（m/s）算 idle / walk / jog 权重与播放率（017：1.6 / 3.2 m/s 无滑步）：
 * - s ≥ 0.5 时「脚下速度」Σ w·rate·stride/周期 = s（verify-xi 断言）；
 * - 1.6–3.2 之间走 / 跑按同一步频播放（两步周期从 1.28 m 线性过渡到 1.92 m），左右脚落地相位一致（walk 0 / 12 of 24，jog 0 / 9 of 18）。
 */
export function locoBlend(s: number, out: LocoBlend = { idle: 1, walk: 0, jog: 0, walkRate: 1, jogRate: 1 }): LocoBlend {
  const ws = WALK.strideSpeed;
  const js = JOG.strideSpeed;
  const walkDur = (WALK.frames - 1) / XI_FPS;
  const jogDur = (JOG.frames - 1) / XI_FPS;
  if (s < IDLE_BELOW) {
    out.idle = 1;
    out.walk = out.jog = 0;
    out.walkRate = FULL_WALK_AT / ws;
    out.jogRate = 1;
    return out;
  }
  if (s <= ws) {
    const k = Math.min(1, s / FULL_WALK_AT);
    out.idle = 1 - k;
    out.walk = k;
    out.jog = 0;
    out.walkRate = Math.max(s, FULL_WALK_AT) / ws;
    out.jogRate = (out.walkRate * jogDur) / walkDur;
    return out;
  }
  out.idle = 0;
  if (s >= js) {
    out.walk = 0;
    out.jog = 1;
    out.jogRate = s / js;
    out.walkRate = (out.jogRate * walkDur) / jogDur;
    return out;
  }
  const k = (s - ws) / (js - ws);
  const stride = WALK.strideM + (JOG.strideM - WALK.strideM) * k;
  const freq = s / stride; // 两步周期 / s
  out.walk = 1 - k;
  out.jog = k;
  out.walkRate = freq * walkDur;
  out.jogRate = freq * jogDur;
  return out;
}

/** 混合后脚下的地面速度（m/s）：Σ w · rate · strideSpeed（单测用） */
export function locoGroundSpeed(b: LocoBlend): number {
  const w = b.walk + b.jog + b.idle;
  if (w <= 0) return 0;
  return (b.walk * b.walkRate * WALK.strideSpeed + b.jog * b.jogRate * JOG.strideSpeed) / w;
}

/** 楼梯：按实际水平速度（m/s）同步 stairs-up/down 播放率（clip 水平 0.7091 / 竖直 0.5455 m/s） */
export const stairsRate = (horizontalSpeed: number): number => horizontalSpeed / XI_CLIP_SPECS['xi-stairs-up'].strideSpeed;

/** 推浮台：按实际推动速度同步 push-loop 播放率（clip 0.8 m/s；004 实测 0.812） */
export const pushRate = (speed: number): number => speed / XI_CLIP_SPECS['xi-push-loop'].strideSpeed;

/**
 * step-across 的根运动（hips 沿 +Z，smoothstep 覆盖整个 clip）：t 秒时已前进的距离（m）。
 * total 默认取 README / extras 的 0.85 m；运行时用 clip 里 hips 轨道实测的值（measureRootZ）——
 * 2026-10-29 交付的 anims.glb 实际是原地的（hips 首尾差 0，脚第 48 帧回到原位），按实测值 0 不做抵消。
 */
export function stepAcrossRootZ(t: number, total: number = XI_CLIP_SPECS['xi-step-across'].rootTranslateZ): number {
  const s = XI_CLIP_SPECS['xi-step-across'];
  const u = Math.min(1, Math.max(0, (t * XI_FPS) / (s.frames - 1)));
  return total * u * u * (3 - 2 * u);
}

/** 从 hips.position 轨道（扁平 xyz 数组）实测首尾 z 差；< 2 cm 视为原地（0） */
export function measureRootZ(values: ArrayLike<number> | null): number {
  if (!values || values.length < 6) return 0;
  const dz = (values[values.length - 1] ?? 0) - (values[2] ?? 0);
  return Math.abs(dz) < 0.02 ? 0 : dz;
}
