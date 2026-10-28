/**
 * 帧率显示 / 开发性能面板（左上角，F3 切换；v0.1-009 扩展）。
 * - 正式版（设置「显示帧率」）：一行 FPS · 帧时间。
 * - 开发模式 / ?debug=1 / ?smoke=1（detailed）：再加 draw call、三角面、显存估算（renderer.info），
 *   并对照当前画质档的 §8 预算（maxDrawCalls / sceneVisibleTris），超预算标 ⚠。
 * 每 0.5 秒刷新一次文字（显存估算每 2 秒），避免频繁改 DOM。
 */
export interface PerfStats {
  /** 本帧 draw call（含后处理各 pass） */
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  maxDrawCalls: number;
  sceneVisibleTris: number;
  /** 档位文字，如「极致（自动）」 */
  label: string;
  /** 自动检测状态（检测中才有） */
  benchmark: string | null;
}

export interface VramStats {
  geometryMB: number;
  textureMB: number;
  targetMB: number;
  totalMB: number;
}

export interface FpsCounterOptions {
  detailed: boolean;
  label: () => string;
  stats?: () => PerfStats | null;
  vram?: () => VramStats | null;
}

/** 最近一次刷新的读数（冒烟测试 / 控制台读取） */
export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  worstMs: number;
  stats: PerfStats | null;
  vram: VramStats | null;
}

const fmt = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export class FpsCounter {
  readonly el: HTMLDivElement;
  snapshot: PerfSnapshot | null = null;
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private vramAcc = Infinity;
  private vram: VramStats | null = null;
  private _visible: boolean;
  private opts: FpsCounterOptions;

  constructor(parent: HTMLElement, visible: boolean, opts: FpsCounterOptions) {
    this.opts = opts;
    this.el = document.createElement('div');
    this.el.className = 'fps-counter' + (opts.detailed ? ' detailed' : '');
    parent.appendChild(this.el);
    this._visible = visible;
    this.el.hidden = !visible;
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(v: boolean): void {
    this._visible = v;
    this.el.hidden = !v;
    this.vramAcc = Infinity;
  }

  update(dt: number): void {
    if (!this._visible) return;
    this.frames++;
    this.acc += dt;
    this.vramAcc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.5) return;

    const fps = this.frames / this.acc;
    const ms = (this.acc / this.frames) * 1000;
    const worstMs = this.worst * 1000;
    const lines = [`${fps.toFixed(0)} FPS · ${ms.toFixed(1)} ms (max ${worstMs.toFixed(1)})`];
    let stats: PerfStats | null = null;
    if (this.opts.detailed) {
      stats = this.opts.stats?.() ?? null;
      if (this.vramAcc >= 2) {
        this.vram = this.opts.vram?.() ?? null;
        this.vramAcc = 0;
      }
      if (stats) {
        const dcWarn = stats.calls > stats.maxDrawCalls ? ' ⚠' : '';
        const triWarn = stats.triangles > stats.sceneVisibleTris ? ' ⚠' : '';
        lines.push(`draw call ${stats.calls} / ${stats.maxDrawCalls}${dcWarn}`);
        lines.push(`三角面 ${fmt(stats.triangles)} / ${fmt(stats.sceneVisibleTris)}${triWarn}`);
      }
      if (this.vram) {
        const v = this.vram;
        lines.push(`显存≈ ${v.totalMB.toFixed(0)} MB（几何 ${v.geometryMB.toFixed(0)} · 贴图 ${v.textureMB.toFixed(0)} · RT ${v.targetMB.toFixed(0)}）`);
      }
      if (stats) {
        lines.push(`画质 ${stats.label} · 几何 ${stats.geometries} · 贴图 ${stats.textures}`);
        if (stats.benchmark) lines.push(stats.benchmark);
      }
      this.el.textContent = lines.join('\n');
    } else {
      const extra = this.opts.label();
      this.el.textContent = `${lines[0]}${extra ? ` · ${extra}` : ''}`;
    }
    this.snapshot = { fps, frameMs: ms, worstMs, stats, vram: this.vram };
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
  }

  dispose(): void {
    this.el.remove();
  }
}
