import { MUSIC_XFADE_SEC, type AudioSystem } from '@/systems/AudioSystem';
import type { EventBus } from '@/core/EventBus';
import { musicTrackGain } from './music';

/**
 * 1031 第一章结尾曲 mus-ending-ch1（art/audio/music/README.md「结尾曲卡点」）。
 * - 不循环（loop = false），文件 0 s = lighthouse:ignited 那一帧（xi-ignite-lever 第 34 帧）：在 ignited 回调里同一帧 start(0)
 * - 资源要提前到：进 S3（首帧后）就 prefetch，和 S3 场景曲一起懒加载，不进首场景包
 * - 点燃时场景曲（S3 两层）淡出 ENDING_SCENE_FADE_SEC；README 没写时长 → 用场景间交叉淡化的 2 s；结尾曲自己不淡入（开头本来就从静音起）
 * - 跳过演出：0.75 s 淡出（README「0.5–1 s」取中）。035 的跳过入口还没做，先挂 'cutscene:skip' { id: 'ch1-ending' } 事件，035 接上即可
 * - 点燃时还没下载 / 解码完：场景曲照样淡出；到了以后按「点燃后过去的音频时钟秒数」作 offset 补位起播（0.5 s 淡入，和画面卡点对齐），
 *   已经过了淡出点（95 s）就不放；下载失败 → 不放、不报错
 */
export const ENDING_MUSIC = 'mus-ending-ch1';
/** 点燃时场景曲淡出（s）：README 没给 → 2 s（= MUSIC_XFADE_SEC） */
export const ENDING_SCENE_FADE_SEC = MUSIC_XFADE_SEC;
/** 跳过演出时结尾曲淡出（s）：README 0.5–1 s */
export const ENDING_SKIP_FADE_SEC = 0.75;
/** 资源晚到、补位起播时的淡入（s） */
export const ENDING_LATE_FADE_IN_SEC = 0.5;
/** 跳过事件的演出 id */
export const ENDING_CUTSCENE_ID = 'ch1-ending';

/** README CUES（s，文件 0 s = 点燃）+ 派生时间。演出时间轴对照表见 docs/tasks/progress-1031-music2.md */
export const ENDING_CUES = Object.freeze({
  ignite: 0,
  lens: 4,
  fog_open: 14,
  motif_resolve: 21.78,
  silhouette: 24,
  gaze: 30,
  no_answer: 50,
  sit_write: 58,
  journal: 66,
  pull_back: 74,
  close_chord: 88,
  last_note: 89.11,
  fade_out: 95,
  silence: 106,
  length: 107,
});

export type EndingResult = 'play' | 'late' | 'missing' | 'too-late' | 'skipped' | 'stale';

export class EndingMusic {
  buffer: AudioBuffer | null = null;
  /** 点燃那一帧的 AudioContext 时刻 */
  ignitedAt: number | null = null;
  result: EndingResult | null = null;
  skipped = false;
  private fetch: Promise<AudioBuffer | null> | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly audio: AudioSystem;
  private readonly load: (key: string) => Promise<AudioBuffer | null | undefined>;
  private readonly alive: () => boolean;

  constructor(audio: AudioSystem, events: EventBus, load: (key: string) => Promise<AudioBuffer | null | undefined>, alive: () => boolean = () => true) {
    this.audio = audio;
    this.load = load;
    this.alive = alive;
    this.offs.push(
      events.on('lighthouse:ignited', () => this.onIgnited()),
      events.on('cutscene:skip', ({ id }) => {
        if (id === ENDING_CUTSCENE_ID) this.skip();
      }),
    );
  }

  /** 进 S3 首帧后调：下载 + 解码，存着等点燃 */
  prefetch(): Promise<AudioBuffer | null> {
    this.fetch ??= Promise.resolve()
      .then(() => this.load(ENDING_MUSIC))
      .catch(() => null)
      .then((b) => (this.buffer = b ?? null));
    return this.fetch;
  }

  /** lighthouse:ignited 同一帧 */
  onIgnited(): void {
    if (this.ignitedAt !== null) return;
    this.ignitedAt = this.audio.audioTime;
    if (this.buffer) {
      this.start(0);
      return;
    }
    // 还没到：场景曲照样淡出，结尾曲到了再补位
    this.audio.stopMusic(ENDING_SCENE_FADE_SEC);
    void this.prefetch().then((b) => {
      if (this.result !== null) return;
      if (!this.alive()) return void (this.result = 'stale');
      if (this.skipped) return void (this.result = 'skipped');
      if (!b) return void (this.result = 'missing');
      const offset = this.audio.audioTime - (this.ignitedAt ?? 0);
      if (offset >= ENDING_CUES.fade_out) return void (this.result = 'too-late');
      this.start(offset);
    });
  }

  private start(offset: number): void {
    const b = this.buffer;
    if (!b) return;
    const late = offset > 0;
    this.audio.playMusic(b, {
      key: ENDING_MUSIC,
      loop: false,
      fadeOutPrev: ENDING_SCENE_FADE_SEC,
      fadeIn: late ? ENDING_LATE_FADE_IN_SEC : 0,
      offset,
      gain: musicTrackGain(ENDING_MUSIC),
    });
    this.result = late ? 'late' : 'play';
  }

  /** 跳过结尾演出：结尾曲 0.75 s 淡出（只在结尾曲正在放时） */
  skip(): boolean {
    this.skipped = true;
    if (this.audio.musicKey !== ENDING_MUSIC) return false;
    this.audio.stopMusic(ENDING_SKIP_FADE_SEC);
    return true;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }
}
