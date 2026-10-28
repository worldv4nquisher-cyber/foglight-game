import type { EventBus } from '@/core/EventBus';
import type { QualityTier, QualityChangeSource } from '@/config/quality';
import type { Settings } from '@/systems/save/Settings';

/**
 * 首次启动的 3 秒画质自动检测（v0.1-009；style-guide §8；制作人拆单裁定第 5 条）。
 *
 * - 只在设置里 `qualityDetected=false`（新安装 / 清空设置）时跑；跑完写 `qualityDetected=true`，之后重启、再进 S1 都不再跑。
 * - 第一次进入 S1 时，在 3 秒建立镜头里测（开场演出做好后挪到演出最后 3 s，035）。
 * - 从极致开始测 3 秒平均帧率，< 50 fps 降一档，降档后重测 3 秒，仍 < 50 再降；最多连降两档（极致 → 高 → 标准）。
 * - 结果写进设置：`quality`、`qualityDetectedTier`、`qualitySource='auto'`。
 * - 玩家在检测过程中手动改了画质：立即停止，以玩家选择为准（也记为已检测，不再自动改）。
 * - 暂停 / 切后台时丢弃当前这一轮，恢复后重新计时。
 * - `?simulateFps=40` 用固定帧率代替实测（等待时间照旧 3 s / 轮）；`?simulateFps=40,60` 按轮次依次取值，不够的沿用最后一个。
 * - URL `?quality=xx` 临时覆盖时不跑（避免把调试档位写进设置）。
 *
 * 本文件被 Node 直接导入做校验（scripts/verify-quality.mjs）：只能 `import type`，不能用参数属性 / enum。
 */

export interface BenchmarkQuality {
  readonly tier: QualityTier;
  readonly urlOverride: boolean;
  apply(tier: QualityTier, source: QualityChangeSource): void;
}

export interface BenchmarkRound {
  tier: QualityTier;
  fps: number;
  simulated: boolean;
}

export type BenchmarkState = 'idle' | 'running' | 'done' | 'skipped' | 'aborted';

export const BENCHMARK_DEFAULTS = {
  /** 每轮测量时长（秒）= 建立镜头时长 */
  windowSeconds: 3,
  /** 平均帧率低于此值降一档 */
  minFps: 50,
  /** 最多连降两档 */
  maxDrops: 2,
  /** 每轮开头丢弃的帧数（切档后的着色器编译 / 阴影贴图重建会卡一下，不计入） */
  warmupFrames: 5,
} as const;

const ORDER: readonly QualityTier[] = ['ultra', 'high', 'standard'];

/** 解析 ?simulateFps=40 或 40,60；非法返回 null */
export function parseSimulateFps(search: string): number[] | null {
  const raw = new URLSearchParams(search).get('simulateFps');
  if (!raw) return null;
  const list = raw.split(',').map((s) => Number(s.trim()));
  return list.length && list.every((n) => Number.isFinite(n) && n > 0) ? list : null;
}

export interface BenchmarkOptions {
  windowSeconds?: number;
  minFps?: number;
  maxDrops?: number;
  warmupFrames?: number;
  simulateFps?: number[] | null;
}

export class QualityBenchmark {
  state: BenchmarkState = 'idle';
  readonly rounds: BenchmarkRound[] = [];

  private quality: BenchmarkQuality;
  private settings: Settings;
  private events: EventBus | null;
  private opts: Required<Omit<BenchmarkOptions, 'simulateFps'>>;
  private simulate: number[] | null;

  private drops = 0;
  private frames = 0;
  private skipLeft = 0;
  private startMs = -1;
  private lastMs = -1;
  private offSettings: (() => void) | null = null;

  constructor(quality: BenchmarkQuality, settings: Settings, events: EventBus | null = null, options: BenchmarkOptions = {}) {
    this.quality = quality;
    this.settings = settings;
    this.events = events;
    this.opts = {
      windowSeconds: options.windowSeconds ?? BENCHMARK_DEFAULTS.windowSeconds,
      minFps: options.minFps ?? BENCHMARK_DEFAULTS.minFps,
      maxDrops: options.maxDrops ?? BENCHMARK_DEFAULTS.maxDrops,
      warmupFrames: options.warmupFrames ?? BENCHMARK_DEFAULTS.warmupFrames,
    };
    this.simulate = options.simulateFps ?? null;
  }

  /** 这次启动是否需要检测（还没检测过、没有 URL 临时覆盖） */
  get needed(): boolean {
    return !this.settings.get('qualityDetected') && !this.quality.urlOverride;
  }

  get running(): boolean {
    return this.state === 'running';
  }

  /** 当前这一轮已测秒数（调试显示用） */
  get elapsed(): number {
    return this.startMs < 0 ? 0 : (this.lastMs - this.startMs) / 1000;
  }

  /**
   * 第一次进入 S1、建立镜头开始时调用。不需要检测时什么也不做，返回 false。
   */
  start(): boolean {
    if (this.state !== 'idle' || !this.needed) return false;
    if (this.settings.get('qualitySource') === 'user') {
      // 检测前玩家已经手动选过：以玩家为准，记为已检测
      this.state = 'skipped';
      this.settings.update({ qualityDetected: true });
      return false;
    }
    this.state = 'running';
    this.offSettings = this.settings.onChange((key, value) => {
      if (key === 'qualitySource' && value === 'user' && this.state === 'running') this.abort();
    });
    this.quality.apply('ultra', 'auto');
    this.resetWindow();
    console.info('[quality] 自动检测开始：极致档测 3 秒');
    return true;
  }

  /**
   * 每帧调用（渲染之后）。nowMs = requestAnimationFrame 时间戳（真实时间，不受 Time 的 dt 截断影响）。
   */
  update(nowMs: number, paused: boolean): void {
    if (this.state !== 'running') return;
    if (paused) {
      this.resetWindow(); // 暂停 / 切后台：这一轮作废，恢复后重测
      return;
    }
    if (this.skipLeft > 0 || this.startMs < 0) {
      // 热身帧不计；最后一帧热身（或无热身时的第一帧）作为计时起点
      if (this.skipLeft > 0) this.skipLeft--;
      this.startMs = this.lastMs = nowMs;
      return;
    }
    this.frames++;
    this.lastMs = nowMs;
    const sec = (nowMs - this.startMs) / 1000;
    if (sec < this.opts.windowSeconds) return;

    const sim = this.simulate ? this.simulate[Math.min(this.rounds.length, this.simulate.length - 1)]! : null;
    const fps = sim ?? this.frames / sec;
    const tier = this.quality.tier;
    this.rounds.push({ tier, fps, simulated: sim !== null });
    console.info(`[quality] ${tier} 平均 ${fps.toFixed(1)} fps${sim !== null ? '（simulateFps）' : ''}`);

    const lower = ORDER[ORDER.indexOf(tier) + 1];
    if (fps < this.opts.minFps && this.drops < this.opts.maxDrops && lower) {
      this.drops++;
      this.quality.apply(lower, 'auto');
      this.resetWindow();
      return;
    }
    this.finish(tier);
  }

  private resetWindow(): void {
    this.frames = 0;
    this.skipLeft = this.opts.warmupFrames;
    this.startMs = this.lastMs = -1;
  }

  private finish(tier: QualityTier): void {
    this.state = 'done';
    this.offSettings?.();
    this.offSettings = null;
    // 先写来源再写档位；运行时档位已经是 tier，设置监听不会再切一次
    this.settings.update({ qualityDetected: true, qualityDetectedTier: tier, qualitySource: 'auto', quality: tier });
    console.info(`[quality] 自动检测完成：${tier}（降 ${this.drops} 档）`);
    this.events?.emit('quality:detected', { tier, drops: this.drops, rounds: [...this.rounds] });
  }

  /** 玩家在检测中手动改了画质：停止，以玩家选择为准 */
  private abort(): void {
    this.state = 'aborted';
    this.offSettings?.();
    this.offSettings = null;
    this.settings.update({ qualityDetected: true });
    console.info('[quality] 检测中玩家手动改了画质，停止检测');
  }

  dispose(): void {
    this.offSettings?.();
    this.offSettings = null;
  }
}
