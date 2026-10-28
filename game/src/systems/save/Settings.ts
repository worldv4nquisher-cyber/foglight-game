import type { QualityTier } from '@/config/quality';
import { defaultStorage, probeWritable, safeGet, safeRemove, safeSet, type StorageLike } from './storage';

/**
 * 玩家设置（GDD §10 设置界面、v0.1-006）。localStorage 键 `foglight.settings.v1`，与存档分开，新游戏不清除。
 * 每次 set 立即写盘并通知订阅者（输入灵敏度、音量、帧率显示等立即生效）。
 */
export const SETTINGS_KEY = 'foglight.settings.v1';
/** 旧版 QualityManager 用的键：读一次迁移进设置后删除 */
export const LEGACY_QUALITY_KEY = 'game.quality';

export type SubtitleSize = 's' | 'm' | 'l';
/** 当前画质从哪来：default = 默认极致未检测；auto = 首次启动自动检测（可能降过档）；user = 玩家手动选的 */
export type QualitySource = 'default' | 'auto' | 'user';

export interface SettingsData {
  quality: QualityTier;
  /** 首次启动的画质自动检测是否已经跑过（只跑一次，见 009） */
  qualityDetected: boolean;
  qualitySource: QualitySource;
  /** 鼠标灵敏度倍数 0.1–3.0 */
  mouseSensitivity: number;
  invertY: boolean;
  /** 0–100 */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  subtitleSize: SubtitleSize;
  /** 镜头自动回正（GDD §4，默认关） */
  autoRecenter: boolean;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Readonly<SettingsData> = Object.freeze({
  quality: 'ultra',
  qualityDetected: false,
  qualitySource: 'default',
  mouseSensitivity: 1,
  invertY: false,
  masterVolume: 100,
  musicVolume: 80,
  sfxVolume: 100,
  subtitleSize: 'm',
  autoRecenter: false,
  showFps: false,
});

const TIERS: readonly string[] = ['ultra', 'high', 'standard'];

function pickEnum<T extends string>(v: unknown, allowed: readonly string[], fallback: T): T {
  return typeof v === 'string' && allowed.includes(v) ? (v as T) : fallback;
}
function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function pickNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** 把任意输入清洗成合法设置：缺字段 / 类型不对 / 越界的项回到默认值（或截断），其余保留 */
export function sanitizeSettings(raw: unknown): SettingsData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    quality: pickEnum<QualityTier>(r.quality, TIERS, d.quality),
    qualityDetected: pickBool(r.qualityDetected, d.qualityDetected),
    qualitySource: pickEnum<QualitySource>(r.qualitySource, ['default', 'auto', 'user'], d.qualitySource),
    mouseSensitivity: pickNum(r.mouseSensitivity, 0.1, 3, d.mouseSensitivity),
    invertY: pickBool(r.invertY, d.invertY),
    masterVolume: Math.round(pickNum(r.masterVolume, 0, 100, d.masterVolume)),
    musicVolume: Math.round(pickNum(r.musicVolume, 0, 100, d.musicVolume)),
    sfxVolume: Math.round(pickNum(r.sfxVolume, 0, 100, d.sfxVolume)),
    subtitleSize: pickEnum<SubtitleSize>(r.subtitleSize, ['s', 'm', 'l'], d.subtitleSize),
    autoRecenter: pickBool(r.autoRecenter, d.autoRecenter),
    showFps: pickBool(r.showFps, d.showFps),
  };
}

type Listener = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => void;

export class Settings {
  private data: SettingsData;
  private storage: StorageLike | null;
  private listeners = new Set<Listener>();
  /** localStorage 是否可写；不可写时设置只在本次会话内生效 */
  readonly writable: boolean;
  /** 本次启动是否从旧键 game.quality 迁移过画质 */
  readonly migratedLegacyQuality: boolean;

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.writable = probeWritable(storage);
    let parsed: unknown = null;
    const text = safeGet(storage, SETTINGS_KEY);
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null; // 设置坏了不提示，回默认即可（存档才需要提示）
      }
    }
    this.data = sanitizeSettings(parsed);

    // 兼容旧键：读一次后删除。旧键只在玩家手动切画质时写入，所以视为玩家选择，不再自动检测
    const legacy = safeGet(storage, LEGACY_QUALITY_KEY);
    this.migratedLegacyQuality = false;
    if (legacy !== null) {
      if (!text && TIERS.includes(legacy)) {
        this.data.quality = legacy as QualityTier;
        this.data.qualitySource = 'user';
        this.data.qualityDetected = true;
        this.migratedLegacyQuality = true;
      }
      safeRemove(storage, LEGACY_QUALITY_KEY);
      this.persist();
    }
  }

  get<K extends keyof SettingsData>(key: K): SettingsData[K] {
    return this.data[key];
  }

  /** 只读快照 */
  get all(): Readonly<SettingsData> {
    return { ...this.data };
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    const next = sanitizeSettings({ ...this.data, [key]: value });
    const v = next[key];
    if (Object.is(this.data[key], v)) return;
    this.data = next;
    this.persist();
    for (const l of this.listeners) l(key, v);
  }

  update(patch: Partial<SettingsData>): void {
    for (const [k, v] of Object.entries(patch) as Array<[keyof SettingsData, SettingsData[keyof SettingsData]]>) {
      this.set(k, v);
    }
  }

  /** 恢复默认（设置界面底部按钮）。画质检测标记保留，不会因此重新跑检测 */
  resetToDefaults(): void {
    const keep = { qualityDetected: this.data.qualityDetected };
    const d = { ...DEFAULT_SETTINGS, ...keep };
    for (const k of Object.keys(d) as Array<keyof SettingsData>) this.set(k, d[k]);
  }

  /** 订阅变化，返回取消函数 */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist(): void {
    if (!this.writable) return;
    safeSet(this.storage, SETTINGS_KEY, JSON.stringify({ version: 1, ...this.data }));
  }
}
