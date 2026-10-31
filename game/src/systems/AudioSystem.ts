import { gameplay } from '@/config/gameplay';

/**
 * 036 音乐混音（art/audio/README.md、art/audio/music/README.md 实测响度）：
 * 配乐文件统一 −20 LUFS，环境音 ≈ −24 LUFS（走 sfx 总线、增益 1）。要求音乐比环境音低 12 dB →
 * 音乐总线基准增益 = (−24 − 12) − (−20) = −16 dB（≈ 0.158），再乘设置里的音乐音量。
 */
export const MUSIC_FILE_LUFS = -20;
export const AMBIENCE_FILE_LUFS = -24;
export const MUSIC_BELOW_AMBIENCE_DB = 12;
export const MUSIC_BUS_DB = AMBIENCE_FILE_LUFS - MUSIC_BELOW_AMBIENCE_DB - MUSIC_FILE_LUFS;
export const MUSIC_BUS_GAIN = Math.pow(10, MUSIC_BUS_DB / 20);
/** 036：场景之间（含主菜单 → S1）音乐交叉淡化时长（s） */
export const MUSIC_XFADE_SEC = 2;
/** 1031：同步层增益变化的平滑时长（s）：按玩家高度逐帧改目标值，线性斜坡跟过去，不出拉链噪声 */
export const MUSIC_LAYER_RAMP_SEC = 0.25;
/** 1031：同步层晚到时的起播提前量（s）：start(when, offset) 的 when 留在未来，保证 offset 和底层样本对齐 */
export const MUSIC_LAYER_LEAD_SEC = 0.1;

/** 1031：和底层同步循环的附加层（S3 紧张层 mus-s3-lighthouse-upper） */
export interface MusicLayerOptions {
  name: string;
  buffer: AudioBuffer;
  /** 初始增益（线性，默认 0） */
  gain?: number;
}

export interface MusicOptions {
  /** 曲目 key（manifest）：同一首已在播 → 不重开（返回 false） */
  key?: string;
  /** 默认 true：整文件循环（033：循环点 = 整个文件，不设 loopStart / loopEnd） */
  loop?: boolean;
  /**
   * 交叉淡化时长（s）：有旧曲时旧曲线性淡出、新曲从 0 淡入，时长相同；没有旧曲时新曲直接满音量起播（033：不加淡入）。
   * 默认 0 = 硬切。
   */
  crossfade?: number;
  /**
   * 没有旧曲时的淡入时长（s，默认 0 = 直接满音量）。033 改：S1 场景曲懒加载，解码完时主菜单曲可能已经停了，
   * 这时从 0 淡入（MUSIC_XFADE_SEC），不硬切进来。有旧曲时不看这个，按 crossfade。
   */
  fadeIn?: number;
  /** 曲目增益（线性，默认 1；033 改：manifest gainDb → 主菜单曲 +0.3 dB 对齐 S1 场景曲），淡入到这个值 */
  gain?: number;
  /**
   * 1031 结尾曲：旧曲单独的淡出时长（s）。给了这个就不按 crossfade 对称淡化——旧曲按它淡出、新曲按 fadeIn（默认 0 = 满音量）起播。
   * 结尾曲文件 0 s = 点燃那一帧，开头本身是静音 / 起音，不能被淡入吃掉；场景曲同时 2 s 淡出。
   */
  fadeOutPrev?: number;
  /**
   * 1031：从文件的第几秒开始放（默认 0）。结尾曲资源晚到时按「点燃后已经过去的音频时钟秒数」补位，和画面时间轴对齐；
   * loop 曲按时长取模。不是 seek：起播一次定下，之后不改。
   */
  offset?: number;
  /**
   * batch17 D3：起播用的 AudioContext 时刻（默认这里再读一次 ctx.currentTime）。调用方已经用某次读数算了 offset 时传同一个值，
   * 负载下两次读数之间 AudioContext 会走一个渲染块（512 采样 ≈ 10.7 ms），offset 和起播时刻就对不上。
   * 只能是「刚读到的当前时刻」，不能用来排程未来起播。
   */
  at?: number;
  /**
   * 1031：同步层——和底层**同一 AudioContext 时刻、同一 offset** start，同为 loop（S3 两层）。
   * 时长必须和底层一样（样本对齐循环），不一样的层丢掉不放。层增益用 setMusicLayerGain 改；层永远不单独 seek / 重启。
   */
  layers?: MusicLayerOptions[];
}

/** 音乐调试记录（冒烟读取）：每次 playMusic / stopMusic 一条，时间是 AudioContext 时钟（挂起时不走） */
export interface MusicLogEntry {
  /** play / stop；1031：end = 不循环的曲子（结尾曲）自然放完；layer = 同步层起播（和底层同刻或晚到对齐） */
  op: 'play' | 'stop' | 'end' | 'layer';
  key: string | null;
  /** 被替换 / 停掉的曲目 */
  from: string | null;
  at: number;
  fade: number;
  loop: boolean;
  ctxState: string;
  /** performance.now()（ms）：和 Game.lastFirstFrame.at 对照（033 改：S1 曲在首帧之后才淡入） */
  wall: number;
  /** 1031：play 时从文件第几秒起播（MusicOptions.offset，默认 0） */
  offset?: number;
  /** 1031：fadeOutPrev 时旧曲的淡出时长（fade 是新曲淡入） */
  fadeOut?: number;
  /** 1031：同步层名（play 时一起起播的层 / op layer 的层） */
  layers?: string[];
}

interface MusicLayer {
  name: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** 最近一次设的目标增益 */
  target: number;
  /** start(when, offset) 的 when / offset：when − offset ≡ 底层 startAt（mod duration） */
  when: number;
  offset: number;
}

interface MusicVoice {
  key: string | null;
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** 曲目增益（线性，满音量时 gain.gain 的目标值） */
  level: number;
  /** 1031：文件 0 s 对应的 AudioContext 时刻（= 起播时刻 − offset）；播放位置 = (now − startAt) [mod duration] */
  startAt: number;
  duration: number;
  /** 1031：同步层 */
  layers: Map<string, MusicLayer>;
}

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
  private music: MusicVoice | null = null;
  /** 音乐调试记录（最多 32 条） */
  readonly musicLog: MusicLogEntry[] = [];
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
      this.musicGain.gain.value = MUSIC_BUS_GAIN;
      this.musicGain.connect(this.master);
      if (typeof window !== 'undefined') for (const ev of this.unlockEvents) window.addEventListener(ev, this.unlock, { once: false });
    }
  }

  /**
   * 首次手势解锁。BUG-033：resume() 会被拒（Firefox 离开 / 刷新页面时 InvalidStateError、Safari 非手势时 NotAllowedError）或一直挂起，
   * 原来 `void` 不接 → 未处理的 rejection 进控制台；而且不管成没成功都撤监听 → 一次失败后整局没声音。
   * 现在：接住 rejection；真的变成 running 才撤监听，没成功下次手势再试。
   */
  private unlock = (): void => {
    const ctx = this.context;
    if (!ctx) return;
    if (ctx.state !== 'suspended') {
      this.removeUnlockListeners();
      return;
    }
    ctx.resume().then(
      () => {
        if (ctx.state === 'running') this.removeUnlockListeners();
      },
      () => {
        /* 下次手势再试 */
      },
    );
  };

  private removeUnlockListeners(): void {
    if (typeof window !== 'undefined') for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock);
  }

  /** BUG-033：suspend / resume 的 Promise 可能被拒（页面离开、上下文已关），接住不进控制台 */
  private static quiet(p: Promise<void> | undefined): void {
    p?.catch(() => {
      /* 页面离开 / 上下文关闭：无需处理 */
    });
  }

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
    if (this.musicGain) this.musicGain.gain.value = MUSIC_BUS_GAIN * this.levels.music;
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

  /** 当前在播的曲目 key（没有 / 未命名为 null） */
  get musicKey(): string | null {
    return this.music?.key ?? null;
  }

  /** 当前曲目增益（线性，manifest gainDb；没在播 = 0） */
  get musicLevel(): number {
    return this.music?.level ?? 0;
  }

  /** 当前曲目的 loop 标志（冒烟 / 单测） */
  get musicLoop(): boolean | null {
    return this.music ? this.music.source.loop : null;
  }

  /** AudioContext 在跑（没解锁 / 暂停挂起 / 没有 Web Audio 为 false）；035 演出时钟据此决定用不用音频时钟 */
  get running(): boolean {
    return this.context?.state === 'running';
  }

  /** AudioContext 时钟（s；没有 context = 0）。结尾曲按它记点燃时刻（挂起时不走，和声音一致） */
  get audioTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /** 1031：当前曲目文件 0 s 对应的 AudioContext 时刻（没在播 = null） */
  get musicStartAt(): number | null {
    return this.music?.startAt ?? null;
  }

  /** 1031：当前曲目播放位置（文件内秒数；loop 曲取模；没在播 = null） */
  get musicPosition(): number | null {
    const v = this.music;
    if (!v || !this.context) return null;
    const t = this.context.currentTime - v.startAt;
    return v.source.loop && v.duration > 0 ? ((t % v.duration) + v.duration) % v.duration : t;
  }

  /**
   * 播放背景音乐（走 music 总线，−16 dB 基准，见 MUSIC_BUS_DB）。默认整文件循环。
   * 自动播放限制：context 还没被用户手势解锁（suspended）时照常排程、不报错，第一次交互 resume 后从头开始响。
   * crossfade > 0 且有旧曲：旧曲从当前音量线性淡到 0 后停止，新曲同时从 0 淡到 1。
   * 返回 false = 没有 context 或同一首已在播。
   */
  playMusic(buffer: AudioBuffer, opts: MusicOptions = {}): boolean {
    const ctx = this.context;
    if (!ctx || !this.musicGain || ctx.state === 'closed') return false;
    const key = opts.key ?? null;
    if (key !== null && this.music?.key === key) return false;
    const loop = opts.loop ?? true;
    const prev = this.music;
    const split = opts.fadeOutPrev !== undefined;
    const fade = Math.max(0, (split ? opts.fadeIn : prev ? opts.crossfade : opts.fadeIn) ?? 0);
    const prevFade = split ? Math.max(0, opts.fadeOutPrev ?? 0) : fade;
    const now = opts.at ?? ctx.currentTime;
    const duration = buffer.duration;
    let offset = Math.max(0, opts.offset ?? 0);
    if (loop && duration > 0) offset %= duration;
    else if (offset >= duration) return false; // 不循环的曲子已经放过头了：不起播
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    const gain = ctx.createGain();
    const level = Math.max(0, opts.gain ?? 1);
    if (fade > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + fade);
    } else gain.gain.setValueAtTime(level, now);
    src.connect(gain).connect(this.musicGain);
    if (offset > 0) src.start(now, offset);
    else src.start(now);
    const voice: MusicVoice = { key, source: src, gain, level, startAt: now - offset, duration, layers: new Map() };
    // 1031 同步层：同一时刻 now、同一 offset 起播（和底层同一个 start 参数 → 样本对齐），接在曲目 gain 前面（一起交叉淡化）
    for (const l of opts.layers ?? []) {
      if (!this.sameLength(l.buffer, duration) || voice.layers.has(l.name)) continue;
      this.startLayer(voice, l, now, offset);
    }
    this.music = voice;
    if (!loop) {
      // 1031 结尾曲：一次性，放完自己清掉（被替换 / 停掉时 releaseMusic 会换掉 onended）
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        if (this.music !== voice) return;
        this.music = null;
        this.logMusic({ op: 'end', key: null, from: key, at: ctx.currentTime, fade: 0, loop: false, ctxState: ctx.state });
      };
    }
    if (prev) this.releaseMusic(prev, prevFade);
    this.logMusic({
      op: 'play',
      key,
      from: prev?.key ?? null,
      at: now,
      fade,
      loop,
      ctxState: ctx.state,
      ...(offset > 0 ? { offset } : {}),
      ...(split && prev ? { fadeOut: prevFade } : {}),
      ...(voice.layers.size ? { layers: [...voice.layers.keys()] } : {}),
    });
    return true;
  }

  private sameLength(b: AudioBuffer, duration: number): boolean {
    return Math.abs(b.duration - duration) < 1e-3;
  }

  private startLayer(v: MusicVoice, l: MusicLayerOptions, when: number, offset: number): MusicLayer {
    const ctx = this.context!;
    const src = ctx.createBufferSource();
    src.buffer = l.buffer;
    src.loop = v.source.loop;
    const g = ctx.createGain();
    const target = Math.max(0, l.gain ?? 0);
    g.gain.setValueAtTime(target, ctx.currentTime);
    src.connect(g).connect(v.gain);
    if (offset > 0) src.start(when, offset);
    else src.start(when);
    const layer: MusicLayer = { name: l.name, source: src, gain: g, target, when, offset };
    v.layers.set(l.name, layer);
    return layer;
  }

  /**
   * 1031：底层先到、上层晚到——按底层**当前播放位置**对齐起播：when = now + MUSIC_LAYER_LEAD_SEC，
   * offset = (when − 底层 startAt) mod duration，两层此后按同一时钟循环。只给正在放的 loop 曲加；时长不同 / 同名已有 → false。
   * 上层只这样起播一次，之后不 seek、不重启（底层换曲时跟着一起淡出停掉）。
   */
  addMusicLayer(l: MusicLayerOptions, key?: string): boolean {
    const ctx = this.context;
    const v = this.music;
    if (!ctx || !v || ctx.state === 'closed') return false;
    if (key !== undefined && v.key !== key) return false;
    if (!v.source.loop || v.duration <= 0 || !this.sameLength(l.buffer, v.duration) || v.layers.has(l.name)) return false;
    const when = ctx.currentTime + MUSIC_LAYER_LEAD_SEC;
    const offset = (((when - v.startAt) % v.duration) + v.duration) % v.duration;
    this.startLayer(v, l, when, offset);
    this.logMusic({ op: 'layer', key: v.key, from: null, at: when, fade: 0, loop: true, ctxState: ctx.state, offset, layers: [l.name] });
    return true;
  }

  /** 1031：设同步层增益（线性，MUSIC_LAYER_RAMP_SEC 斜坡跟过去）；没有这个层 → false（例如结尾曲已经接管） */
  setMusicLayerGain(name: string, gain: number): boolean {
    const ctx = this.context;
    const l = this.music?.layers.get(name);
    if (!ctx || !l) return false;
    const g = Math.max(0, gain);
    if (Math.abs(g - l.target) < 1e-4) return true;
    const now = ctx.currentTime;
    const p = l.gain.gain;
    const cur = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
    p.linearRampToValueAtTime(g, now + MUSIC_LAYER_RAMP_SEC);
    l.target = g;
    return true;
  }

  /** 1031：同步层读数（冒烟 / 单测）：名字、目标增益、当前增益、起播 when / offset、换算出的「文件 0 s」时刻（应和底层 startAt 同余） */
  get musicLayers(): Array<{ name: string; target: number; gain: number; when: number; offset: number; startAt: number }> {
    const v = this.music;
    if (!v) return [];
    return [...v.layers.values()].map((l) => ({ name: l.name, target: l.target, gain: l.gain.gain.value, when: l.when, offset: l.offset, startAt: l.when - l.offset }));
  }

  /** 停止背景音乐（fadeOut s 线性淡出，默认立即） */
  stopMusic(fadeOut = 0): void {
    const prev = this.music;
    if (!prev || !this.context) return;
    this.music = null;
    const fade = Math.max(0, fadeOut);
    this.releaseMusic(prev, fade);
    this.logMusic({ op: 'stop', key: null, from: prev.key, at: this.context.currentTime, fade, loop: false, ctxState: this.context.state });
  }

  private releaseMusic(v: MusicVoice, fade: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    const p = v.gain.gain;
    const cur = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
    if (fade > 0) p.linearRampToValueAtTime(0, now + fade);
    else p.setValueAtTime(0, now);
    v.source.onended = () => {
      v.source.disconnect();
      v.gain.disconnect();
      for (const l of v.layers.values()) {
        l.source.disconnect();
        l.gain.disconnect();
      }
    };
    // 同步层接在曲目 gain 前面，跟底层一起淡出、同一时刻停
    for (const l of [v.source, ...[...v.layers.values()].map((x) => x.source)]) {
      try {
        l.stop(now + fade);
      } catch {
        // 已经停过
      }
    }
  }

  private logMusic(e: Omit<MusicLogEntry, 'wall'>): void {
    this.musicLog.push({ ...e, wall: typeof performance === 'undefined' ? 0 : performance.now() });
    if (this.musicLog.length > 32) this.musicLog.shift();
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
    if (this.context?.state === 'running') AudioSystem.quiet(this.context.suspend());
  }

  resume(): void {
    if (this.context?.state === 'suspended') AudioSystem.quiet(this.context.resume());
  }

  dispose(): void {
    this.stopMusic();
    this.stopAllLoops(0);
    if (typeof window !== 'undefined') for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock);
    void this.context?.close();
  }
}
