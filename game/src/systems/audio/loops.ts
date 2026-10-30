import type { EventBus } from '@/core/EventBus';

/** 032 光束持续嗡鸣（sfx-beam-hum-loop，4 s 整文件循环，−26 LUFS） */
export const BEAM_HUM_ID = 'sfx-beam-hum-loop';
/** 032 透镜转动（sfx-lens-rotate-loop，6 s 整文件循环）：点燃后约 1.5 s 开始 */
export const LENS_ROTATE_ID = 'sfx-lens-rotate-loop';
export const LENS_ROTATE_DELAY_SEC = 1.5;
/** 032 推木筏（sfx-raft-push-loop，4 s 整文件循环）：推动中循环，停手 → 淡出 0.3 s */
export const PUSH_LOOPS: Readonly<Record<string, string>> = { 'raft-s1': 'sfx-raft-push-loop' };

/**
 * 光束保持连通期间循环嗡鸣（README：beam:connected 起、beam:broken 停）。
 * connected() 由场景给（S2：灯台光打到光感锁；S3：天光经窗口镜打到第一面导光镜起、点燃前）。
 * 断开有 graceSec 宽限（同接收器 0.3 s，天光边缘 / 拖镜子时不抖），之后淡出。
 * connectSfx（可选）：每次从断开到连通（起播嗡鸣那一帧）补一声单发（README：beam:connected → sfx-beam-connect）。
 * S3 的导光镜连通单发由场景 flash() 发，不传；S2 灯台光打到光感锁传 sfx-beam-connect。
 */
export class BeamHum {
  on = false;
  starts = 0;
  private miss = 0;
  private readonly events: EventBus;
  private readonly connected: () => boolean;
  private readonly graceSec: number;
  private readonly connectSfx: string | null;

  constructor(events: EventBus, connected: () => boolean, graceSec = 0.3, connectSfx: string | null = null) {
    this.events = events;
    this.connected = connected;
    this.graceSec = graceSec;
    this.connectSfx = connectSfx;
  }

  update(dt: number): void {
    if (this.connected()) {
      this.miss = 0;
      if (!this.on) {
        this.on = true;
        this.starts++;
        this.events.emit('sfx:loop', { id: BEAM_HUM_ID });
        if (this.connectSfx) this.events.emit('sfx:play', { id: this.connectSfx });
      }
      return;
    }
    if (!this.on) return;
    this.miss += dt;
    if (this.miss > this.graceSec + 1e-6) this.stop();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.events.emit('sfx:loopStop', { id: BEAM_HUM_ID });
  }
}

/**
 * 推动循环音：interact:pushMoved（推着走的每一步）→ 起播；停手超过 idleSec 没有新的 pushMoved → 淡出；
 * 推到底（interact:pushEnd）立即淡出（落位另有 sfx-raft-lock）。只认 PUSH_LOOPS 里的交互 id。
 */
export class PushLoop {
  readonly active = new Map<string, number>();
  private readonly events: EventBus;
  private readonly idleSec: number;
  private readonly offs: Array<() => void>;

  constructor(events: EventBus, idleSec = 0.25) {
    this.events = events;
    this.idleSec = idleSec;
    this.offs = [
      events.on('interact:pushMoved', ({ id }) => {
        const loop = PUSH_LOOPS[id];
        if (!loop) return;
        if (!this.active.has(id)) this.events.emit('sfx:loop', { id: loop, fadeIn: 0.15 });
        this.active.set(id, 0);
      }),
      events.on('interact:pushEnd', ({ id }) => this.stop(id)),
    ];
  }

  update(dt: number): void {
    for (const [id, idle] of this.active) {
      const t = idle + dt;
      if (t > this.idleSec) this.stop(id);
      else this.active.set(id, t);
    }
  }

  stop(id: string): void {
    const loop = PUSH_LOOPS[id];
    if (!loop || !this.active.delete(id)) return;
    this.events.emit('sfx:loopStop', { id: loop });
  }

  dispose(): void {
    for (const off of this.offs) off();
    for (const id of [...this.active.keys()]) this.stop(id);
  }
}
