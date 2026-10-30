/**
 * UI 图片缓存（030）：key → 已下载并解码的 URL。AssetLoader 用它做组加载（set）和懒加载（load）。
 * 独立出来是为了在 node 里单测（AssetLoader 构造要 WebGLRenderer）。
 */
export interface ImageCacheDeps {
  /** 清单查 key → 绝对 / 相对 URL 与是否美术资源；没登记返回 null */
  lookup: (key: string) => { url: string; art?: boolean } | null;
  /** ?art=0 时 false */
  artEnabled: () => boolean;
  /** 下载 + 解码，成功返回可直接用的 URL；失败抛错 */
  fetchImage: (url: string) => Promise<string>;
  onLoaded?: (key: string) => void;
  onFailed?: (key: string, url: string, err: unknown) => void;
}

export class ImageCache {
  private done = new Map<string, string>();
  private inflight = new Map<string, Promise<string | null>>();
  private deps: ImageCacheDeps;

  constructor(deps: ImageCacheDeps) {
    this.deps = deps;
  }

  get(key: string): string | null {
    return this.done.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.done.has(key);
  }

  set(key: string, url: string): void {
    this.done.set(key, url);
  }

  delete(key: string): void {
    this.done.delete(key);
  }

  /** 同 key 只下载一次（并发共享）；没登记 / ?art=0 / 失败 → null，失败的下次再请求会重试 */
  load(key: string): Promise<string | null> {
    const hit = this.done.get(key);
    if (hit) return Promise.resolve(hit);
    const entry = this.deps.lookup(key);
    if (!entry || (entry.art && !this.deps.artEnabled())) return Promise.resolve(null);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.deps
      .fetchImage(entry.url)
      .then((u) => {
        this.done.set(key, u);
        this.deps.onLoaded?.(key);
        return u;
      })
      .catch((err: unknown) => {
        this.deps.onFailed?.(key, entry.url, err);
        return null;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
