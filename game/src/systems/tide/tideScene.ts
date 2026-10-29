import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { Game } from '@/core/Game';
import type { PlayerRig } from '@/entities/createPlayer';
import type { AudioSystem } from '@/systems/AudioSystem';
import type { TideController } from './TideController';

/**
 * 潮水送回（v0.1-011，GDD §8）：黑场 0.5 s 把角色送回分区安全点，字幕「水太冷了。」（ch1.common.tide_return）。
 * LevelScene / TestbedScene 共用。
 */
export async function recallToSafePoint(game: Game, rig: PlayerRig, zone: TideController): Promise<void> {
  const sp = zone.safePoint;
  if (!sp) return;
  game.events.emit('tide:recall', { zone: zone.id });
  game.ui.subtitles.play(['ch1.common.tide_return']);
  await rig.controller.teleportTo(sp.position, {
    fade: gameplay.tide.recallFadeSec,
    ...(sp.facing !== undefined ? { facing: sp.facing } : {}),
  });
}

/** 没有正式音效资源时的合成占位音（音频资源到了改走 assets.getAudio(id)） */
const FALLBACK: Record<string, { freq: number; duration: number; type: OscillatorType }> = {
  'sfx-tide-bell': { freq: 330, duration: 1.2, type: 'sine' },
  // S1 潮汐钟靠近时风吹轻响（013 占位）
  'sfx-bell-wind': { freq: 990, duration: 0.6, type: 'sine' },
  // S2（014 占位）：观察点对准 317 的风铃、光感锁开、拨盘铁门开、拾起钥匙
  'sfx-wind-chime': { freq: 1320, duration: 1.4, type: 'sine' },
  'sfx-lock-open': { freq: 220, duration: 0.5, type: 'triangle' },
  'sfx-gate-open': { freq: 140, duration: 0.8, type: 'triangle' },
  'sfx-key-pickup': { freq: 880, duration: 0.2, type: 'sine' },
};

/** `sfx:play` → 有资源播资源，否则合成占位音。返回取消订阅 */
export function bindSfxFallback(events: EventBus, audio: AudioSystem, getBuffer?: (id: string) => AudioBuffer | undefined): () => void {
  return events.on('sfx:play', ({ id }) => {
    const fb = FALLBACK[id] ?? { freq: 440, duration: 0.15, type: 'sine' as OscillatorType };
    audio.playSfx(getBuffer?.(id), fb);
  });
}
