import { MUSIC_XFADE_SEC, type AudioSystem } from '@/systems/AudioSystem';
import { sfxGain } from '@/systems/audio/sfxBank';

/** 曲目增益（线性）= manifest gainDb（033 改：主菜单曲 +0.3 dB，见 musicLevels.ts） */
export const musicTrackGain = (key: string): number => sfxGain(key);

export type MusicSwitch = 'play' | 'same' | 'stop' | 'missing';

/**
 * 场景曲切换（033 / 036）：主菜单进 mus-menu、S1 进 mus-s1-ebb-shore（LevelDef.music）。
 * - 有 buffer：playMusic（整文件 loop），和正在播的上一首 MUSIC_XFADE_SEC（2 s）交叉淡化；第一首直接满音量（不加淡入）
 * - 同一首已在播：不重开（返回 'same'）
 * - key = null（这个场景没有场景曲，如 S2 / 章节结束页的结尾曲 035 未交付）：上一首 2 s 淡出
 * - 资源缺失（?art=0 / 加载失败）：上一首也 2 s 淡出，不留错场景的曲子
 * 浏览器自动播放限制由 AudioSystem 处理：context 未解锁时排程不报错，第一次用户交互后才真正出声。
 */
export function switchMusic(
  audio: AudioSystem,
  getBuffer: (key: string) => AudioBuffer | undefined,
  key: string | null,
  crossfade: number = MUSIC_XFADE_SEC,
): MusicSwitch {
  if (key !== null && audio.musicKey === key) return 'same';
  const buf = key !== null ? getBuffer(key) : undefined;
  if (key !== null && buf) {
    audio.playMusic(buf, { key, loop: true, crossfade, gain: musicTrackGain(key) });
    return 'play';
  }
  audio.stopMusic(crossfade);
  return key === null ? 'stop' : 'missing';
}

export type LazyMusicResult = MusicSwitch | 'stale';

/**
 * 懒加载场景曲（033 改，制作人 c0d81c9 反馈）：S1 曲不随 s1 组预下载，场景首帧渲染后才调这里。
 * - load(key) 下载 + 解码（AssetLoader.loadAudio：404 / 超时 → null，不抛错）
 * - 成功：和正在播的上一首（主菜单曲）交叉淡化 crossfade s；上一首已经停了 → 从 0 淡入 crossfade s
 * - 失败 / 超时：上一首照常 crossfade s 淡出，不放音乐（'missing'），不报错
 * - 等下载期间离开了场景（alive() = false）：什么都不做（'stale'），交给新场景处理
 */
export async function switchMusicLazy(
  audio: AudioSystem,
  load: (key: string) => Promise<AudioBuffer | null | undefined>,
  key: string | null,
  alive: () => boolean = () => true,
  crossfade: number = MUSIC_XFADE_SEC,
): Promise<LazyMusicResult> {
  if (key === null) {
    audio.stopMusic(crossfade);
    return 'stop';
  }
  if (audio.musicKey === key) return 'same';
  let buf: AudioBuffer | null | undefined;
  try {
    buf = await load(key);
  } catch {
    buf = null; // load 本应不抛；保险起见按缺失处理
  }
  if (!alive()) return 'stale';
  if (audio.musicKey === key) return 'same';
  if (!buf) {
    audio.stopMusic(crossfade);
    return 'missing';
  }
  audio.playMusic(buf, { key, loop: true, crossfade, fadeIn: crossfade, gain: musicTrackGain(key) });
  return 'play';
}

export type LayerResult = 'with-base' | 'aligned' | 'missing' | 'no-base' | 'stale' | 'mismatch';

/**
 * 1031 S3 两层场景曲（mus-s3-lighthouse 底层 + mus-s3-lighthouse-upper 紧张层，README：同时起播、样本对齐、同为 loop，
 * 上层初始增益 0、按玩家高度 0 → 1 线性淡入，不要单独起播或中途 seek）。两层都按 S1 的懒加载办法：首帧后并行下载解码。
 * - 两层都解码完才「一起起播」：底层解码完时上层也已经到了 → 同一个 playMusic、同一 AudioContext 时刻 start
 * - 只到了底层：先只放底层（和上一首 2 s 交叉淡化）；上层到了以后 addMusicLayer 按底层当前播放位置对齐起播（不 seek 底层）
 * - 底层失败：上一首照常淡出、不放音乐（上层到了也不单放）；上层失败：只放底层
 * - upperGain()：起播 / 对齐那一刻的上层增益（按玩家高度，之后每帧由场景 setMusicLayerGain）
 * 返回 { base: 底层结果, upper: 上层结果 }
 */
export async function switchLayeredMusicLazy(
  audio: AudioSystem,
  load: (key: string) => Promise<AudioBuffer | null | undefined>,
  base: string,
  upper: string,
  alive: () => boolean = () => true,
  upperGain: () => number = () => 0,
  crossfade: number = MUSIC_XFADE_SEC,
): Promise<{ base: LazyMusicResult; upper: LayerResult }> {
  if (audio.musicKey === base) return { base: 'same', upper: audio.musicLayers.some((l) => l.name === upper) ? 'with-base' : 'missing' };
  const safe = (k: string): Promise<AudioBuffer | null> =>
    Promise.resolve()
      .then(() => load(k))
      .then((b) => b ?? null)
      .catch(() => null);
  let upperBuf: AudioBuffer | null | undefined; // undefined = 还没到
  const upperP = safe(upper).then((b) => (upperBuf = b));
  const baseBuf = await safe(base);
  if (!alive()) return { base: 'stale', upper: 'stale' };
  if (audio.musicKey === base) return { base: 'same', upper: 'stale' };
  if (!baseBuf) {
    audio.stopMusic(crossfade);
    return { base: 'missing', upper: 'no-base' };
  }
  const layer = (b: AudioBuffer) => ({ name: upper, buffer: b, gain: upperGain() });
  if (upperBuf) {
    audio.playMusic(baseBuf, { key: base, loop: true, crossfade, fadeIn: crossfade, gain: musicTrackGain(base), layers: [layer(upperBuf)] });
    return { base: 'play', upper: audio.musicLayers.some((l) => l.name === upper) ? 'with-base' : 'mismatch' };
  }
  audio.playMusic(baseBuf, { key: base, loop: true, crossfade, fadeIn: crossfade, gain: musicTrackGain(base) });
  if (upperBuf === null) return { base: 'play', upper: 'missing' };
  const ub = await upperP;
  if (!alive() || audio.musicKey !== base) return { base: 'play', upper: 'stale' };
  if (!ub) return { base: 'play', upper: 'missing' };
  return { base: 'play', upper: audio.addMusicLayer(layer(ub), base) ? 'aligned' : 'mismatch' };
}
