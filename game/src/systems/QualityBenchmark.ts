import type { EventBus } from '@/core/EventBus';
import type { QualityTier, QualityChangeSource } from '@/config/quality';
import type { Settings } from '@/systems/save/Settings';

/**
 * 首次启动的 3 秒画质自动检测（v0.1-009；style-guide §8；制作人拆单裁定第 5 条）。
 *
 * - 只在设置里 `qualityDetected=false`（新安装 / 清空设置）时跑；跑完写 `qualityDetected=true`，之后重启、再进 S1 都不再跑。
 * - 第一次进入 S1 时开始。**第一轮必须落在建立镜头内**（制作人裁定，2026-10-29）：S1EbbShoreScene 让建立镜头停在最后一帧，
 *   直到 `firstRoundDone`（热身帧 + 3 s 比 3 s 镜头略长）；后续轮次（降档后重测）可以在玩家能操作后继续，
 *   切档由 Game 推迟到下一帧渲染之前执行，不出现可见黑帧。035 开场演出接入时把演出尾段留够 9 s（3 轮 × 3 s）。
 * - 从极致开始测 3 秒平均帧率，< 50 fps 降一档，降档后重测 3 秒，仍 < 50 再降；最多连降两档（极致 → 高 → 标准）。
 * - 结果写进设置：`quality`、`qualityDetectedTier`、`qualitySource='auto'`。**只有检测完成才写 qualityDetectedTier**（BUG-002）。
 * - 玩家在检测过程中手动改了画质：立即停止（aborted），以玩家选择为准；只写 `qualityDetected=true`（不再自动检测），
 *   `qualityDetectedTier` 保持 null，设置界面显示「尚未自动检测」，「恢复默认」回到默认极致。检测前已手动选过档同理（skipped）。
 * - 暂停 / 切后台时丢弃当前这一轮，恢复后重新计时。检测没完成就离开 S1（`cancel()`）：整次作废、不写设置，下次进 S1 重测。
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

  /** 第一轮已经测完（或根本没在跑）：建立镜头可以结束了 */
  get firstRoundDone(): boolean {
    return this.state !== 'running' || this.rounds.length > 0;
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
      this.settings.update({ qualityDetected: true, qualityDetectedTier: null });
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
    // 不写检测结果（BUG-002）：这次没测完，qualityDetectedTier 保持 null
    this.settings.update({ qualityDetected: true, qualityDetectedTier: null });
    console.info('[quality] 检测中玩家手动改了画质，停止检测');
  }

  /**
   * 检测还没完成就离开了 S1（暂停菜单「回到主菜单」、换场景）：这次作废，什么都不写，
   * 运行时档位退回设置里的档位；`qualityDetected` 仍是 false，下次进入 S1 从头再测（BUG-002：检测完成前不写结果）。
   */
  cancel(): void {
    if (this.state !== 'running') return;
    this.offSettings?.();
    this.offSettings = null;
    this.state = 'idle';
    this.rounds.length = 0;
    this.drops = 0;
    this.resetWindow();
    this.quality.apply(this.settings.get('quality'), 'settings');
    console.info('[quality] 检测未完成就离开了场景：作废，下次进入 S1 重测');
  }

  dispose(): void {
    this.offSettings?.();
    this.offSettings = null;
  }
}
