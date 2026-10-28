import type { Game } from '@/core/Game';
import type { BaseScene } from './BaseScene';

export type SceneFactory = (game: Game) => BaseScene;

/** 场景注册与切换。切换时：旧场景 exit + dispose → 新场景 enter（可异步）→ 设为当前 */
export class SceneManager {
  private factories = new Map<string, SceneFactory>();
  private _current: BaseScene | null = null;
  private switching: Promise<void> | null = null;

  constructor(private game: Game) {}

  get current(): BaseScene | null {
    return this._current;
  }

  register(name: string, factory: SceneFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  /**
   * 切换场景。若正在切换（例如在某场景的 enter 中再次调用），会排队等上一个切换完成。
   * 在 enter() 内调用时请用 `void scenes.change(...)`，不要 await，否则会相互等待。
   */
  async change(name: string): Promise<void> {
    while (this.switching) await this.switching;
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`未注册的场景: ${name}`);

    this.switching = (async () => {
      const prev = this._current;
      if (prev) {
        prev.exit();
        this._current = null;
        prev.dispose();
      }
      const next = factory(this.game);
      const { clientWidth: w, clientHeight: h } = this.game.container;
      next.resize(w, h);
      // 先设为当前，让异步 enter 期间（如加载场景）也能渲染
      this._current = next;
      this.game.events.emit('scene:change', { from: prev?.name ?? null, to: name });
      await next.enter();
    })();

    try {
      await this.switching;
    } finally {
      this.switching = null;
    }
  }

  dispose(): void {
    if (this._current) {
      this._current.exit();
      this._current.dispose();
      this._current = null;
    }
  }
}
