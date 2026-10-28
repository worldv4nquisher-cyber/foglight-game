/**
 * 音频系统（Web Audio）：
 * - 首次用户交互时解锁 AudioContext（移动端浏览器策略）
 * - SFX 播放（AudioBuffer），缺资源时用合成音占位
 * - 背景音乐、主音量、静音、暂停时挂起
 * 以后需要 3D 空间音效时可改用 THREE.AudioListener + PositionalAudio，共用同一个 context。
 */
export class AudioSystem {
  readonly context: AudioContext | null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private _muted = false;
  private unlockEvents = ['pointerdown', 'keydown', 'touchend'] as const;

  constructor() {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.context = Ctor ? new Ctor() : null;
    if (this.context) {
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.sfxGain = this.context.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0.5;
      this.musicGain.connect(this.master);
      for (const ev of this.unlockEvents) window.addEventListener(ev, this.unlock, { once: false });
    }
  }

  private unlock = (): void => {
    if (!this.context) return;
    if (this.context.state === 'suspended') void this.context.resume();
    for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock);
  };

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
  }

  setVolume(v: number): void {
    if (this.master && !this._muted) this.master.gain.value = v;
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

  suspend(): void {
    if (this.context?.state === 'running') void this.context.suspend();
  }

  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume();
  }

  dispose(): void {
    this.stopMusic();
    for (const ev of this.unlockEvents) window.removeEventListener(ev, this.unlock);
    void this.context?.close();
  }
}
