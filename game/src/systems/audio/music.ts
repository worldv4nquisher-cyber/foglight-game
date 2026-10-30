import { MUSIC_XFADE_SEC, type AudioSystem } from '@/systems/AudioSystem';

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
    audio.playMusic(buf, { key, loop: true, crossfade });
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
  audio.playMusic(buf, { key, loop: true, crossfade, fadeIn: crossfade });
  return 'play';
}
