import { gameplay } from '@/config/gameplay';
import type { EventBus } from '@/core/EventBus';

/** 015 点火口可点灯嗡鸣（032 sfx-ignite-ready-loop；文件没到时 AudioSystem 用 110 Hz 正弦合成占位持续振荡） */
export const IGNITER_HUM_ID = 'sfx-ignite-ready-loop';

/**
 * 点火口可点灯嗡鸣循环（036：receiver:ready 起播、receiver:lost 或 lighthouse:ignited 淡出）：
 * - 进入可点灯（receiver:ready）→ 淡入 igniterHumFadeInSec 开始循环；同名循环不叠加
 * - 退出可点灯 → 淡出 igniterHumFadeOutSec。BeamReceiver 只在断光超过 0.3 s 宽限后才发 receiver:lost，宽限内嗡鸣不断
 * - 按 E 之后（igniting，光路不再影响结果）断光不停，等到 lighthouse:ignited（第 34 帧点燃）再淡出
 * - update() 兜底：没在点灯、接收器又不在 ready（谜题重置 resetState 不发 lost）→ 停
 */
export class IgniterHum {
  on = false;
  starts = 0;
  stops = 0;

  private readonly events: EventBus;
  private readonly receiver: { readonly id: string; readonly state: string };
  private readonly igniting: () => boolean;

  constructor(events: EventBus, receiver: { readonly id: string; readonly state: string }, igniting: () => boolean) {
    this.events = events;
    this.receiver = receiver;
    this.igniting = igniting;
  }

  bind(): () => void {
    const offs = [
      this.events.on('receiver:ready', ({ id }) => {
        if (id === this.receiver.id && !this.igniting()) this.start();
      }),
      this.events.on('receiver:lost', ({ id }) => {
        if (id === this.receiver.id && !this.igniting()) this.stop();
      }),
      this.events.on('lighthouse:ignited', () => this.stop()),
    ];
    return () => {
      for (const off of offs) off();
    };
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.starts++;
    this.events.emit('sfx:loop', { id: IGNITER_HUM_ID, fadeIn: gameplay.beam.igniterHumFadeInSec });
  }

  stop(fadeOut: number = gameplay.beam.igniterHumFadeOutSec): void {
    if (!this.on) return;
    this.on = false;
    this.stops++;
    this.events.emit('sfx:loopStop', { id: IGNITER_HUM_ID, fadeOut });
  }

  update(): void {
    if (this.on && !this.igniting() && this.receiver.state !== 'ready') this.stop();
  }
}
