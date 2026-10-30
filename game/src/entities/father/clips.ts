/**
 * 父亲（v0.1-031，art/models/characters/README-031.md）的动画 clip 表：char-father-anims.glb，3 个 clip，30 fps，原地，朝向 +Z。
 * 数值抄自 README-031 §3–4 与 GLB 的 animations[].extras；scripts/verify-father.mjs 逐项比对 GLB，不一致以 GLB 为准（改这里）。
 * 本文件不依赖 three / DOM，Node 单测直接导入。
 */
import { xiClipDuration } from "@/entities/xi/clips";

export const FATHER_FPS = 30;

export const FATHER_CLIP_SPECS = {
  /** 灯室窗前眺望：双手背后，LoopRepeat（首帧 = 末帧） */
  "father-stand-gaze": { frames: 241, loop: true },
  /** 原地走，不提灯：游戏按 strideSpeed 沿路径移动根节点；左脚第 0 帧、右脚第 17 帧落地 */
  "father-walk-away": {
    frames: 35,
    loop: true,
    strideSpeed: 1.3,
    strideM: 1.4733,
    cycleFrames: 34,
    footsteps: { l: [0], r: [17] },
  },
  /** 抬右手放到汐头顶、摸两下、收手：LoopOnce + clampWhenFinished */
  "father-hand-on-head": {
    frames: 181,
    loop: false,
    events: {
      reachStart: 20,
      handOn: 56,
      strokeA: 66,
      strokeB: 98,
      handOff: 136,
      armDown: 170,
    },
  },
} as const;

export type FatherClipName = keyof typeof FATHER_CLIP_SPECS;
export const FATHER_CLIP_NAMES = Object.keys(
  FATHER_CLIP_SPECS,
) as FatherClipName[];

/** 对外的三种演出（035 回忆演出 / dev 预览 ?father=…） */
export const FATHER_MODES = {
  gaze: "father-stand-gaze",
  walk: "father-walk-away",
  hand: "father-hand-on-head",
} as const satisfies Record<string, FatherClipName>;
export type FatherMode = keyof typeof FATHER_MODES;

export function parseFatherMode(
  v: string | null | undefined,
): FatherMode | null {
  return v && Object.prototype.hasOwnProperty.call(FATHER_MODES, v)
    ? (v as FatherMode)
    : null;
}

export type FatherEvent =
  keyof (typeof FATHER_CLIP_SPECS)["father-hand-on-head"]["events"];

/** clip 时长（s）：帧数含收尾帧，(frames − 1) / fps */
export const fatherClipDuration = (name: FatherClipName): number =>
  (FATHER_CLIP_SPECS[name].frames - 1) / FATHER_FPS;

/**
 * hand-on-head 与汐的配合（README-031 §4，clip extras align.handOnHead）：
 * 父亲根 = 汐局部 (0, 0, 0.48)、绕 Y 180°（面朝汐）；两人同一帧开始，汐 xi-stand-gaze 从第 0 帧 LoopRepeat，父亲 LoopOnce 停在末帧。
 */
export const FATHER_HAND_ON_HEAD = {
  xiClip: "xi-stand-gaze",
  xiStartFrame: 0,
  fatherRootInXi: [0, 0, 0.48] as const,
  fatherYawDegInXi: 180,
} as const;

/** 从同一起点算起 elapsed 秒（游戏时间）时两人的 clip 时间与父亲当前帧 */
export function handOnHeadTimes(elapsed: number): {
  father: number;
  xi: number;
  frame: number;
} {
  const e = Math.max(0, elapsed);
  const fd = fatherClipDuration("father-hand-on-head");
  const xd = xiClipDuration(FATHER_HAND_ON_HEAD.xiClip);
  const father = Math.min(e, fd);
  const xi = (e + FATHER_HAND_ON_HEAD.xiStartFrame / FATHER_FPS) % xd;
  return { father, xi, frame: Math.round(father * FATHER_FPS) };
}

/** (prev, now] 之间跨过的 hand-on-head 事件（按帧号，帧 f 在 f / 30 s） */
export function handOnHeadEventsBetween(
  prev: number,
  now: number,
): FatherEvent[] {
  const ev = FATHER_CLIP_SPECS["father-hand-on-head"].events;
  return (Object.keys(ev) as FatherEvent[]).filter((k) => {
    const t = ev[k] / FATHER_FPS;
    return t > prev + 1e-9 && t <= now + 1e-9;
  });
}

/** 走路：根沿路径的位置（m），到头从起点重来（dev 预览）；脚下速度 = strideSpeed，播放率 1 */
export function walkDistance(elapsed: number, length: number): number {
  const v = FATHER_CLIP_SPECS["father-walk-away"].strideSpeed;
  return length > 0 ? (Math.max(0, elapsed) * v) % length : 0;
}
