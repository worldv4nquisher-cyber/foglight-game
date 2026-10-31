import { ENDING_CUES, ENDING_CUTSCENE_ID } from '@/systems/audio/endingMusic';
import type { SubtitleCue } from '@/ui/Subtitles';
import type { TextId } from '@/content/text';

/**
 * 第一章结尾演出（035）时间轴数据：t = 0 = lighthouse:ignited 那一帧（结尾曲在 AudioContext 里起播的时刻）。
 * 卡点 = art/audio/music/README.md CUES = text-ch1 §5（ENDING_CUES）；父亲回忆段 / 淡出 / 结束是程序按 §5 + README-031 排的。
 * 纯数据 + 纯函数（Node 单测用）；场景里的执行见 levels/s3/ending.ts。
 */
export const ENDING_ID = ENDING_CUTSCENE_ID;

/** xi-stand-gaze / father-hand-on-head 时长（180 帧 / 30 fps）：父亲在汐眺望第 2 个循环的第 0 帧入场，两人同帧（README-031 §4） */
export const GAZE_LOOP_SEC = 6.0;

export const ENDING_T = Object.freeze({
  ignite: ENDING_CUES.ignite,
  /** 0:04 透镜转、切塔外远景 */
  lens: ENDING_CUES.lens,
  /** 0:14 雾被推开（14 → 22 s 雾密度降到 FOG_OPEN_K） */
  fogOpen: ENDING_CUES.fog_open,
  fogOpenFull: ENDING_CUES.fog_open + 8,
  /** 0:24 远处第二座灯塔剪影从雾口浮出（24 → 29 s） */
  silhouette: ENDING_CUES.silhouette,
  silhouetteFull: ENDING_CUES.silhouette + 5,
  /** 0:30 汐在灯室玻璃前眺望（xi-stand-gaze 第 0 帧） */
  gaze: ENDING_CUES.gaze,
  /** 父亲回忆：汐眺望第 2 循环第 0 帧（36 s）起，hand-on-head 6 s；armDown 5.667 s 后淡出 */
  fatherIn: ENDING_CUES.gaze + GAZE_LOOP_SEC,
  fatherFadeOut: ENDING_CUES.gaze + GAZE_LOOP_SEC + 5.667,
  fatherOut: ENDING_CUES.gaze + GAZE_LOOP_SEC + 6.6,
  /** 回到眺望长镜头 */
  regaze: ENDING_CUES.gaze + GAZE_LOOP_SEC + 6.0,
  /** 0:50 「那边没有亮。」 */
  noAnswer: ENDING_CUES.no_answer,
  /** 0:58 坐下写日志 */
  sitWrite: ENDING_CUES.sit_write,
  /** 1:06 journal_entry */
  journal: ENDING_CUES.journal,
  /** 1:14 镜头后拉 */
  pullBack: ENDING_CUES.pull_back,
  /** 1:35 淡出 */
  fadeOut: ENDING_CUES.fade_out,
  /** 画面全黑（曲子 106 s 静音前 1 s） */
  black: ENDING_CUES.silence - 1,
  /** 演出结束 → 章节结束页（曲子 106 s 静音） */
  end: ENDING_CUES.silence,
});

/** 父亲回忆段幽灵材质的最大不透明度 */
export const FATHER_GHOST_OPACITY = 0.55;
/** 雾口：雾密度最终倍率 */
export const FOG_OPEN_K = 0.4;

export const NO_ANSWER_SEC = 3.0;
export const JOURNAL_ENTRY_SEC = 6.0;

/**
 * 裁定 25 ②：镜头 04（regaze，「那边没有亮。」所在的眺望长镜头）期间关掉灯室玻璃反射 ——
 * 玻璃上的灯光亮斑正好压在远处第二座灯塔上，和台词「那边没有亮」矛盾。
 * 开关落在镜头切点上（42 s 进 regaze、58 s 切过肩），段内不跳变；别的镜头不受影响。
 */
/** 眺望站位往塔心退多少（m）：父亲根在汐前 0.48 m，美术站位离矮墙内面只有 0.45 m，不退父亲背会插进矮墙（test:father 的 verify-hoh-035 量） */
export const GAZE_BACKOFF = 0.2;

/**
 * 制作人裁定（1031，035 镜头 02）：点灯后第一个镜头（塔外远景 far-exterior，lens 4 s → fog_open 14 s）灯束太淡，
 * 要让人感觉到「光出去了」。只在这个镜头里把体积灯束强度乘 BEAM_BOOST_02.k（只乘峰值亮度：软边 / 沿长度淡出 / 侧面淡化都不变），
 * 倍率开关落在两个剪辑点上（lens 从玩家镜头切进远景、fog_open 切雾口），段内恒定 → 画面上没有跳变；
 * 灯室辉光（LAMP_GLOW，07 后拉里看得到的那团）不受影响；别的镜头 = 1。
 */
export const BEAM_BOOST_02 = Object.freeze({ k: 2.4, range: Object.freeze([ENDING_T.lens, ENDING_T.fogOpen] as const) });
/** 演出时刻 t 的灯束强度倍率 */
export function beamBoostAt(t: number): number {
  return t >= BEAM_BOOST_02.range[0] && t < BEAM_BOOST_02.range[1] ? BEAM_BOOST_02.k : 1;
}

export const GLASS_REFLECTION_OFF: readonly [number, number] = Object.freeze([ENDING_T.regaze, ENDING_T.sitWrite] as const);
/** 灯室玻璃镜面倍率：1 = 原样，0 = 关 */
export function glassReflectionAt(t: number): number {
  return t >= GLASS_REFLECTION_OFF[0] && t < GLASS_REFLECTION_OFF[1] ? 0 : 1;
}

/**
 * 镜头 05 over-shoulder（sit_write 58 s → pull_back 74 s，坐下写日志）机位参数：全部相对「日志节点 + 坐写站位」算，不写世界坐标。
 * 基：f = 坐写站位 → 日志（水平，= 汐面朝方向），r = f × 上（汐右手），u = 世界上；原点 = 日志 socket（GLB lamp-room-journal-socket）。
 * - back：机位在日志后方（−f）多少米；side：往汐右手（+r，负 = 左肩）；up：比日志高多少。
 * - look：注视点相对日志的偏移（同一个基）。
 * 桌椅 / 日志节点 / xi-sit-write 换了，机位跟着节点走；构图是否合格由 shots-035 的 05 构图自检量（日志 8 角在画内、被汐遮挡比例、发顶离画面上沿）。
 */
export interface OverShoulderKey {
  back: number;
  side: number;
  up: number;
  fov: number;
}
export const OVER_SHOULDER = {
  // 汐右后上方 3/4 过肩（左肩一侧被兜帽 / 马尾挡死日志，见 progress-1031-beam05 §3）：58 s → 74 s 缓推近
  from: { back: 0.65, side: 1.85, up: 1.3, fov: 38 },
  to: { back: 0.45, side: 1.55, up: 1.1, fov: 38 },
  // 注视点：日志上方 0.38 m（日志和汐的头都在画内）
  look: { back: 0.0, side: 0.0, up: 0.38 },
};
export type OverShoulderParams = typeof OVER_SHOULDER;

type V3 = readonly [number, number, number];
/** 过肩镜头的 from / to（S3 局部坐标）：journal / sit = GLB 日志 socket / 坐写站位 */
export function overShoulderKeys(
  journal: V3,
  sit: V3,
  p: OverShoulderParams = OVER_SHOULDER,
): { from: { position: V3; lookAt: V3; fov: number }; to: { position: V3; lookAt: V3; fov: number }; basis: { f: V3; r: V3 } } {
  let fx = journal[0] - sit[0];
  let fz = journal[2] - sit[2];
  const l = Math.hypot(fx, fz) || 1;
  fx /= l;
  fz /= l;
  // r = f × (0,1,0) = (−fz, 0, fx)
  const rx = -fz;
  const rz = fx;
  const at = (k: { back: number; side: number; up: number }): V3 => [
    journal[0] - fx * k.back + rx * k.side,
    journal[1] + k.up,
    journal[2] - fz * k.back + rz * k.side,
  ];
  const look = at(p.look);
  return {
    from: { position: at(p.from), lookAt: look, fov: p.from.fov },
    to: { position: at(p.to), lookAt: look, fov: p.to.fov },
    basis: { f: [fx, 0, fz], r: [rx, 0, rz] },
  };
}

export const ENDING_SUBTITLES: readonly SubtitleCue[] = Object.freeze([
  { at: ENDING_T.noAnswer, id: 'ch1.outro.no_answer' as TextId, duration: NO_ANSWER_SEC },
  { at: ENDING_T.journal, id: 'ch1.outro.journal_entry' as TextId, duration: JOURNAL_ENTRY_SEC },
]);

/** 时间轴上的 cue（冒烟逐条对表；顺序即触发顺序） */
export const ENDING_CUE_LIST = Object.freeze([
  ['lens', ENDING_T.lens],
  ['fog_open', ENDING_T.fogOpen],
  ['silhouette', ENDING_T.silhouette],
  ['gaze', ENDING_T.gaze],
  ['father_in', ENDING_T.fatherIn],
  ['father_out', ENDING_T.fatherOut],
  ['no_answer', ENDING_T.noAnswer],
  ['sit_write', ENDING_T.sitWrite],
  ['journal', ENDING_T.journal],
  ['pull_back', ENDING_T.pullBack],
  ['fade_out', ENDING_T.fadeOut],
] as const);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, t: number): number => {
  const k = clamp01((t - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** 雾口进度 0–1（14 → 22 s） */
export const fogOpenAt = (t: number): number => smooth(ENDING_T.fogOpen, ENDING_T.fogOpenFull, t);
/** 剪影显出 0–1（24 → 29 s） */
export const silhouetteAt = (t: number): number => smooth(ENDING_T.silhouette, ENDING_T.silhouetteFull, t);
/** 黑场 0–1（95 → 105 s） */
export const fadeAt = (t: number): number => smooth(ENDING_T.fadeOut, ENDING_T.black, t);
/** 父亲幽灵不透明度（36 s 0.8 s 淡入，armDown 后淡出） */
export function fatherOpacityAt(t: number): number {
  if (t < ENDING_T.fatherIn || t >= ENDING_T.fatherOut) return 0;
  const k = Math.min(smooth(ENDING_T.fatherIn, ENDING_T.fatherIn + 0.8, t), 1 - smooth(ENDING_T.fatherFadeOut, ENDING_T.fatherOut, t));
  return k * FATHER_GHOST_OPACITY;
}
/** 汐在演出里的 clip（null = 不管）：30–58 s xi-stand-gaze（t − 30 取模），58 s 起 xi-sit-write */
export function xiPoseAt(t: number): { clip: 'xi-stand-gaze' | 'xi-sit-write'; time: number } | null {
  if (t >= ENDING_T.sitWrite) return { clip: 'xi-sit-write', time: t - ENDING_T.sitWrite };
  if (t >= ENDING_T.gaze) return { clip: 'xi-stand-gaze', time: (t - ENDING_T.gaze) % GAZE_LOOP_SEC };
  return null;
}
