import { manifest } from '@/assets/manifest';

/** 脚步地面（032 交付 5 种，各 a–d） */
export const STEP_SURFACES = ['sand', 'wet', 'wood', 'stone', 'indoor'] as const;
export type StepSurface = (typeof STEP_SURFACES)[number];

const abc = (base: string, n: number): string[] => [...'abcd'].slice(0, n).map((c) => `${base}-${c}`);

/**
 * 程序 id → 032 文件（manifest key）。art/audio/README.md「程序 id ↔ 032 文件名」：程序侧保留旧 id，按 032 文件名放文件；
 * 多个文件 = 变体，随机挑、不连续重复。不在表里的 id 直接当文件名用。
 */
export const SFX_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'sfx-tide-bell': ['sfx-tide-bell-ring'],
  'sfx-bell-wind': abc('sfx-tide-bell-wind', 3),
  'sfx-lock-open': ['sfx-light-lock-open'],
  'sfx-glass-resonance': ['sfx-beam-connect'],
  'sfx-paper-flip': abc('sfx-paper-flip', 3),
  'amb-foghorn-far': abc('amb-foghorn-far', 3),
  'amb-pier-creak': abc('amb-pier-creak', 3),
  'amb-seabird-far': abc('amb-seabird-far', 2),
  ...Object.fromEntries(STEP_SURFACES.map((s) => [`sfx-step-${s}`, abc(`sfx-step-${s}`, 4)])),
};

/** manifest 里登记的增益（dB → 线性） */
const GAIN = new Map(manifest.filter((e) => e.type === 'audio').map((e) => [e.key, 10 ** ((e.gainDb ?? 0) / 20)]));

export function sfxGain(key: string): number {
  return GAIN.get(key) ?? 1;
}

export interface ResolvedSfx {
  key: string;
  buffer: AudioBuffer;
  /** 线性增益（manifest gainDb） */
  volume: number;
}

/**
 * 按程序 id 取 buffer：别名 → 变体（随机、同一 id 不连续两次同一个；只在已加载的变体里挑）→ 增益。
 * 一个文件都没加载（art=0 / 未交付）返回 null，调用方决定用合成占位还是静音。
 */
export class SfxBank {
  private readonly last = new Map<string, string>();
  private readonly getBuffer: (key: string) => AudioBuffer | undefined;
  private readonly rng: () => number;

  constructor(getBuffer: (key: string) => AudioBuffer | undefined, rng: () => number = Math.random) {
    this.getBuffer = getBuffer;
    this.rng = rng;
  }

  /** 这个 id 对应的全部文件 key */
  static files(id: string): readonly string[] {
    return SFX_ALIASES[id] ?? [id];
  }

  resolve(id: string): ResolvedSfx | null {
    const ready = SfxBank.files(id)
      .map((key) => ({ key, buffer: this.getBuffer(key) }))
      .filter((x): x is { key: string; buffer: AudioBuffer } => !!x.buffer);
    if (!ready.length) return null;
    const prev = this.last.get(id);
    const pool = ready.length > 1 ? ready.filter((x) => x.key !== prev) : ready;
    const pick = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))]!;
    this.last.set(id, pick.key);
    return { ...pick, volume: sfxGain(pick.key) };
  }
}
