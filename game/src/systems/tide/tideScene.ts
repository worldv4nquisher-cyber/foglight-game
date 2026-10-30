import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';
import type { Game } from '@/core/Game';
import type { PlayerRig } from '@/entities/createPlayer';
import type { AudioSystem } from '@/systems/AudioSystem';
import { SfxBank } from '@/systems/audio/sfxBank';
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
  // S3（015 占位）：塔门、油阀、油流、光斑落到下一面镜子的玻璃共鸣、没有油
  'sfx-door-lighthouse-unlock': { freq: 180, duration: 0.9, type: 'triangle' },
  'sfx-valve-turn': { freq: 120, duration: 0.6, type: 'triangle' },
  'sfx-oil-flow': { freq: 90, duration: 1.2, type: 'sine' },
  'sfx-glass-resonance': { freq: 1760, duration: 0.9, type: 'sine' },
  'sfx-ignite-fail': { freq: 160, duration: 0.3, type: 'square' },
  // 015 C：可点灯嗡鸣（032 sfx-ignite-ready-loop 到之前每次进入可点灯响一次）、20 s 提醒脉冲、点燃
  'sfx-ignite-ready-loop': { freq: 110, duration: 1.6, type: 'sine' },
  'sfx-ignite-ready-pulse': { freq: 165, duration: 2.0, type: 'sine' },
  'sfx-ignite': { freq: 262, duration: 1.8, type: 'triangle' },
};

/**
 * `sfx:play` → 有资源播资源，否则合成占位音；`sfx:loop` / `sfx:loopStop` → AudioSystem 循环音（缺资源用 FALLBACK 的频率持续振荡）。返回取消订阅。
 * 032：id 先过 SfxBank（旧 id 别名 → 032 文件、a–d 变体随机不连续重复、manifest gainDb 增益）。
 * 没文件、FALLBACK 里也没有的 id（脚步 / 环境音 / UI 等 032 新增）静默：art=0 不用合成音顶替。
 */
export function bindSfxFallback(events: EventBus, audio: AudioSystem, getBuffer?: (id: string) => AudioBuffer | undefined): () => void {
  const bank = new SfxBank(getBuffer ?? (() => undefined));
  const offs = [
    events.on('sfx:play', ({ id, optional }) => {
      const r = bank.resolve(id);
      if (r) {
        audio.playBuffer(r.buffer, r.volume);
        return;
      }
      const fb = FALLBACK[id];
      if (!fb || optional) return;
      audio.playSfx(undefined, fb);
    }),
    events.on('sfx:loop', ({ id, fadeIn, volume }) => {
      const r = bank.resolve(id);
      const fb = FALLBACK[id];
      if (!r && !fb) return;
      audio.startLoop(id, {
        buffer: r?.buffer,
        ...(fb ? { fallback: { freq: fb.freq, type: fb.type } } : {}),
        ...(fadeIn !== undefined ? { fadeIn } : {}),
        volume: (volume ?? 1) * (r?.volume ?? 1),
      });
    }),
    events.on('sfx:loopStop', ({ id, fadeOut }) => {
      audio.stopLoop(id, fadeOut !== undefined ? { fadeOut } : {});
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
