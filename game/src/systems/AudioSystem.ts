import { gameplay } from '@/config/gameplay';

/** 循环音：按名字启停。source 是 buffer 循环或合成占位振荡器；gain 做淡入淡出 */
interface LoopVoice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  volume: number;
}

export interface LoopStartOptions {
  /** 有就循环 buffer，没有就用合成占位（fallback 的 freq / type 持续振荡） */
  buffer?: AudioBuffer | undefined;
  fallback?: { freq: number; type?: OscillatorType };
  /** 淡入时长（s），默认 gameplay.audio.loopFadeInSec；0 = 立即满音量 */
  fadeIn?: number;
  volume?: number;
}

/**
 * 音频系统（Web Audio）：
 * - 首次用户交互时解锁 AudioContext（移动端浏览器策略）
 * - SFX 播放（AudioBuffer），缺资源时用合成音占位
 * - 背景音乐、主音量、静音、暂停时挂起
 * - 循环音（startLoop / stopLoop，按名字）：同名重复 start 不叠加；淡入淡出用 AudioParam 排程（跟 context 时钟走，
 *   暂停菜单 suspend 整个 context 时循环音与淡变一起停住，恢复后接着走）；切场景由 Game 调 stopAllLoops
 * 以后需要 3D 空间音效时可改用 THREE.AudioListener + PositionalAudio，共用同一个 context。
 */
export class AudioSystem {
  readonly context: AudioContext | null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private _muted = false;
  /** 0–1，来自玩家设置（主音量 / 音乐 / 音效） */
  private levels = { master: 1, music: 1, sfx: 1 };
  private unlockEvents = ['pointerdown', 'keydown', 'touchend'] as const;
  private loops = new Map<string, LoopVoice>();

  /** context：测试时注入假的 AudioContext；不传 = 按浏览器创建 */
  constructor(context?: AudioContext | null) {
    if (context !== undefined) this.context = context;
    else {
      const Ctor =
        typeof window === 'undefined'
          ? undefined
          : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      this.context = Ctor ? new Ctor() : null;
    }
    if (this.context) {
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.sfxGain = this.context.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0.5;
      this.musicGain.connect(this.master);
      if (typeof window !== 'undefined') for (const ev of this.unlockEvents) window.addEventListener(ev, this.unlock, { once: false });
    }
  }

  private unlock = (): void => {
    if (!this.context) return;
    if (this.context.state === 'suspended') void this.context.resume();
    if (typeof window !== 'undefined') for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock);
  };

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.applyLevels();
  }

  setVolume(v: number): void {
    this.levels.master = v;
    this.applyLevels();
  }

  /** 设置里的三个音量（0–1） */
  setVolumes(v: { master: number; music: number; sfx: number }): void {
    this.levels = { ...v };
    this.applyLevels();
  }

  private applyLevels(): void {
    if (this.master) this.master.gain.value = this._muted ? 0 : this.levels.master;
    if (this.musicGain) this.musicGain.gain.value = 0.5 * this.levels.music;
    if (this.sfxGain) this.sfxGain.gain.value = this.levels.sfx;
  }

  playBuffer(buffer: AudioBuffer, volume = 1, rate = 1): void {
    if (!this.context || !this.sfxGain || this.context.state !== 'running') return;
    const src = this.context.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.context.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  /** 有 buffer 就播 buffer，否则播合成占位音 */
  playSfx(buffer: AudioBuffer | undefined, fallback: { freq: number; duration?: number; type?: OscillatorType }): void {
    if (buffer) this.playBuffer(buffer);
    else this.beep(fallback.freq, fallback.duration ?? 0.1, fallback.type ?? 'square');
  }

  beep(freq: number, duration = 0.1, type: OscillatorType = 'square', volume = 0.08): void {
    const ctx = this.context;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.8, ctx.currentTime + duration);
    g.gain.setValueAtTime(volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(this.sfxGain);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  playMusic(buffer: AudioBuffer): void {
    if (!this.context || !this.musicGain) return;
    this.stopMusic();
    const src = this.context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.music = src;
  }

  stopMusic(): void {
    this.music?.stop();
    this.music?.disconnect();
    this.music = null;
  }

  /** 当前在播（不含正在淡出）的循环音名字 */
  get loopNames(): string[] {
    return [...this.loops.keys()];
  }

  isLooping(name: string): boolean {
    return this.loops.has(name);
  }

  /**
   * 按名字开始循环音（淡入）。同名已在播 → 不叠加，返回 false。
   * 不要求 context 已 running：挂起（未解锁 / 暂停菜单）时照常排程，恢复后从当前进度接着播。
   * 正在淡出的同名旧实例不复用（Web Audio 的 stop 排程撤不回），新实例从 0 淡入，与旧的淡出交叉。
   */
  startLoop(name: string, opts: LoopStartOptions = {}): boolean {
    const ctx = this.context;
    if (!ctx || !this.sfxGain || ctx.state === 'closed' || this.loops.has(name)) return false;
    const cfg = gameplay.audio;
    const fade = Math.max(0, opts.fadeIn ?? cfg.loopFadeInSec);
    let source: AudioScheduledSourceNode;
    let volume = opts.volume ?? 1;
    if (opts.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = opts.buffer;
      src.loop = true;
      source = src;
    } else {
      const osc = ctx.createOscillator();
      osc.type = opts.fallback?.type ?? 'sine';
      osc.frequency.value = opts.fallback?.freq ?? 220;
      source = osc;
      volume *= cfg.loopFallbackVolume;
    }
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    if (fade > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + fade);
    } else gain.gain.setValueAtTime(volume, now);
    source.connect(gain).connect(this.sfxGain);
    source.start(now);
    this.loops.set(name, { source, gain, volume });
    return true;
  }

  /** 按名字停循环音（淡出后停止并断开）。没在播返回 false */
  stopLoop(name: string, opts: { fadeOut?: number } = {}): boolean {
    const v = this.loops.get(name);
    if (!v) return false;
    this.loops.delete(name);
    this.releaseVoice(v, Math.max(0, opts.fadeOut ?? gameplay.audio.loopFadeOutSec));
    return true;
  }

  /** 停掉全部循环音（切场景时 Game 调；默认立即停） */
  stopAllLoops(fadeOut = 0): void {
    for (const name of [...this.loops.keys()]) this.stopLoop(name, { fadeOut });
  }

  private releaseVoice(v: LoopVoice, fade: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    const p = v.gain.gain;
    // 从当前实际音量开始淡出（淡入中途停也不跳）
    const cur = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
    if (fade > 0) p.linearRampToValueAtTime(0, now + fade);
    else p.setValueAtTime(0, now);
    v.source.onended = () => {
      v.source.disconnect();
      v.gain.disconnect();
    };
    try {
      v.source.stop(now + fade);
    } catch {
      // 已经停过
    }
  }

  suspend(): void {
    if (this.context?.state === 'running') void this.context.suspend();
  }

  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume();
  }

  dispose(): void {
    this.stopMusic();
    this.stopAllLoops(0);
    if (typeof window !== 'undefined') for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock);
    void this.context?.close();
  }
}
