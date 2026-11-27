import type { SubtitleCue } from '@/ui/Subtitles';
import type { TextId } from '@/content/text';

/**
 * 第二章结尾演出时间轴数据：t = 0 = 礁柱灯塔棱镜点亮那一帧。
 * 承接第一章结尾「那边没有亮。」「我会去找你。也会把它们一盏一盏点亮。」：
 * 0:00–0:03.5  灯室点亮，暖光注满透镜
 * 0:03.5–0:11.5 礁柱灯塔外景，两道光束切开海雾（雾密度缓降）
 * 0:11.5–0:20.5 镜巷群镜接力：光沿四面檐镜一路折进裂湾村深处、点亮峡尾雾号
 * 0:20.5–0:29.5 回望海那头，雾中亮着第一章归岸岛灯塔的回灯
 * 0:29.5–0:37.5 拉远俯瞰整座亮起的裂湾村与礁柱灯塔
 * 0:37.5–0:42.0 缓淡出至黑场 → 第二章结束页
 */
export const CH2_ENDING_ID = 'ch2-ending';

export const CH2_ENDING_T = Object.freeze({
  ignite: 0,
  towerOut: 3.5,
  fogOpen: 4.0,
  fogOpenFull: 12.0,
  towerLitLine: 5.5,
  gorgeRelay: 11.5,
  gorgeRelayFull: 17.5,
  gorgeRelayLine: 13.0,
  distantAnswer: 20.5,
  distantAnswerLine: 22.0,
  pullBack: 29.5,
  oneByOneLine: 31.0,
  fadeOut: 37.5,
  black: 41.0,
  end: 42.0,
});

/** 雾散后密度倍率 */
export const CH2_FOG_OPEN_K = 0.52;

export const CH2_ENDING_SUBTITLES: readonly SubtitleCue[] = Object.freeze([
  { at: CH2_ENDING_T.towerLitLine, id: 'ch2.outro.tower_lit' as TextId, duration: 4.2 },
  { at: CH2_ENDING_T.gorgeRelayLine, id: 'ch2.outro.gorge_relay' as TextId, duration: 5.0 },
  { at: CH2_ENDING_T.distantAnswerLine, id: 'ch2.outro.distant_answer' as TextId, duration: 5.2 },
  { at: CH2_ENDING_T.oneByOneLine, id: 'ch2.outro.one_by_one' as TextId, duration: 5.5 },
]);

export const CH2_ENDING_CUE_LIST = Object.freeze([
  ['tower_out', CH2_ENDING_T.towerOut],
  ['gorge_relay', CH2_ENDING_T.gorgeRelay],
  ['distant_answer', CH2_ENDING_T.distantAnswer],
  ['pull_back', CH2_ENDING_T.pullBack],
  ['fade_out', CH2_ENDING_T.fadeOut],
] as const);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, t: number): number => {
  const k = clamp01((t - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** 雾口进度 0–1（4 → 12 s） */
export const ch2FogOpenAt = (t: number): number => smooth(CH2_ENDING_T.fogOpen, CH2_ENDING_T.fogOpenFull, t);

/** 镜巷檐镜逐段接力进度 0–1（11.5 → 17.5 s） */
export const ch2RelayProgressAt = (t: number): number => smooth(CH2_ENDING_T.gorgeRelay, CH2_ENDING_T.gorgeRelayFull, t);

/** 远处归岸岛灯塔灯光显出进度 0–1（20.5 → 23.5 s） */
export const ch2DistantGlowAt = (t: number): number => smooth(CH2_ENDING_T.distantAnswer, CH2_ENDING_T.distantAnswer + 3.0, t);

/** 黑场 0–1（37.5 → 41.0 s） */
export const ch2FadeAt = (t: number): number => smooth(CH2_ENDING_T.fadeOut, CH2_ENDING_T.black, t);
