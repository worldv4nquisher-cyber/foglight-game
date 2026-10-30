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
