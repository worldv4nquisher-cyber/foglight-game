/**
 * 懒加载音频缓存（033 改：S1 场景曲 mus-s1-ebb-shore 不随 s1 组预下载，S1 首帧渲染出来后才请求）。
 * 独立出来是为了在 node 里单测（AssetLoader 构造要 WebGLRenderer）。
 * - 同 key 并发共享一次下载；已加载直接返回
 * - 没登记 / ?art=0 → null，不发请求
 * - 失败（404 / 解码失败）或超时 → null（不抛错），失败不缓存，下次再请求会重试；超时之后才到的结果丢掉
 */
/** 懒加载音频超时（ms）：S1 场景曲 2.5 MB，本地 / 正常网络远低于此；超时按失败处理（菜单曲照常淡出，不放音乐） */
export const LAZY_AUDIO_TIMEOUT_MS = 20000;

export interface LazyAudioDeps<T> {
  /** 清单查 key → URL 与是否美术资源；没登记（或不是懒加载音频）返回 null */
  lookup: (key: string) => { url: string; art?: boolean } | null;
  artEnabled: () => boolean;
  /** 下载 + 解码；失败抛错 */
  load: (url: string) => Promise<T>;
  /** 超时（ms）；0 = 不限 */
  timeoutMs: number;
  onLoaded?: (key: string, value: T) => void;
  onFailed?: (key: string, url: string, err: unknown) => void;
  /** 测试注入计时器 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class LazyAudioTimeout extends Error {
  constructor(url: string, ms: number) {
    super(`lazy audio timeout ${ms} ms: ${url}`);
  }
}

export class LazyAudioCache<T> {
  private done = new Map<string, T>();
  private inflight = new Map<string, Promise<T | null>>();
  private readonly deps: LazyAudioDeps<T>;

  constructor(deps: LazyAudioDeps<T>) {
    this.deps = deps;
  }

  get(key: string): T | undefined {
    return this.done.get(key);
  }

  delete(key: string): void {
    this.done.delete(key);
  }

  load(key: string): Promise<T | null> {
    const hit = this.done.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const entry = this.deps.lookup(key);
    if (!entry || (entry.art && !this.deps.artEnabled())) return Promise.resolve(null);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const setT = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearT = this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const p = new Promise<T | null>((resolve) => {
      let settled = false;
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        this.deps.onFailed?.(key, entry.url, err);
        resolve(null);
      };
      const timer = this.deps.timeoutMs > 0 ? setT(() => fail(new LazyAudioTimeout(entry.url, this.deps.timeoutMs)), this.deps.timeoutMs) : null;
      this.deps.load(entry.url).then(
        (v) => {
          if (settled) return;
          settled = true;
          if (timer !== null) clearT(timer);
          this.done.set(key, v);
          this.deps.onLoaded?.(key, v);
          resolve(v);
        },
        (err: unknown) => {
          if (timer !== null) clearT(timer);
          fail(err);
        },
      );
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
