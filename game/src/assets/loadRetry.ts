// GLB / 外部 KTX2 的网络重试（BUG-012）：和字体（fontLoader.ts，BUG-008）同一套规则。
// 冷启动时浏览器（托管扩展安装 / 激活重建子资源加载器）会取消正在飞的请求（net::ERR_ABORTED → fetch 抛 TypeError / AbortError），
// 原来 GLB 和贴图都不重试，被取消的贴图整局没有。现在：
// - 网络层错误 / 取消 / 5xx 才重试，最多 ASSET_RETRIES 次（间隔 150、300 ms）；4xx 和解析 / 转码错误不重试。
// - 同一 URL 只有一条在飞的下载（调用方共享同一个 Promise，重试也在这个 Promise 里），不会因为多个 GLB 引用同一张贴图而重复发起。
// - 最终失败：控制台 error（带次数）+ assetStats 记录；贴图换成洋红棋盘格占位（只放在颜色贴图槽，一眼能看出缺贴图），
//   <html> 加 assets-fallback 类、发 assets:fallback 事件；GLB 失败沿用原来的占位模型。
// 纯函数 + 可注入依赖，Node 单测（scripts/verify-assets.mjs）直接跑。
import type * as THREE from 'three';

export const ASSET_RETRIES = 2;
export const ASSET_RETRY_DELAY_MS = 150;

export interface AssetLoadStat {
  url: string;
  kind: 'glb' | 'ktx2' | 'img' | 'audio';
  /** 实际发起的请求次数（含重试） */
  attempts: number;
  ok: boolean;
  /** 已结束（成功或重试用完）；false = 还在下载 / 等重试 */
  done: boolean;
  /** 最终用了占位 */
  fallback?: boolean;
  error?: string;
}

/** 每个 URL 的加载记录（smoke / QA：__game.assets.loadStats） */
export const assetStats = new Map<string, AssetLoadStat>();

/** 网络层失败（fetch 抛 TypeError、请求被取消 AbortError）或 5xx 才重试；4xx、解析 / 转码错误不重试 */
export function isRetryableLoadError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const e = err as { name?: string; response?: { status?: number } } | null;
  if (e?.name === 'AbortError') return true;
  // batch17 D2：HTTP 已 200 但随后那一步被取消（<img> 的第二次请求被掐 → decode() EncodingError）由调用方标 retryable
  if ((e as { retryable?: boolean } | null)?.retryable === true) return true;
  const status = e?.response?.status;
  if (typeof status === 'number') return status === 0 || status >= 500;
  return false;
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
}

/** 带重试地执行一次加载；每次真正发起请求前 attempts++ */
export async function loadWithRetry<T>(url: string, kind: AssetLoadStat['kind'], attempt: () => Promise<T>, deps: RetryDeps = {}): Promise<T> {
  const stat: AssetLoadStat = { url, kind, attempts: 0, ok: false, done: false };
  assetStats.set(url, stat);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = deps.retries ?? ASSET_RETRIES;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await sleep(ASSET_RETRY_DELAY_MS * i);
    stat.attempts++;
    try {
      const v = await attempt();
      stat.ok = stat.done = true;
      delete stat.error;
      return v;
    } catch (err) {
      lastErr = err;
      stat.error = String(err instanceof Error ? err.message : err);
      if (!isRetryableLoadError(err)) break;
    }
  }
  stat.done = true;
  throw lastErr;
}

/** 同一 key 只有一条在飞的加载：成功的留在 cache（调用方自己管理释放），失败的立即移除（下次再请求会重新下载） */
export function shareInflight<T>(cache: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = start();
    cache.set(key, p);
    const mine = p;
    mine.catch(() => {
      if (cache.get(key) === mine) cache.delete(key);
    });
  }
  return p;
}

export interface SharedKtx2Deps extends RetryDeps {
  /** 真正下载 + 转码一张 KTX2（KTX2Loader.loadAsync） */
  load: (url: string, onProgress?: (e: ProgressEvent) => void) => Promise<THREE.Texture>;
  /** 相对 URL → 绝对 URL（缓存键） */
  resolve: (url: string) => string;
  /** 重试全部失败：返回占位纹理（会标 userData.assetFallback），返回 null 则把错误交给 GLTFLoader */
  fallback: (url: string, err: unknown) => THREE.Texture | null;
}

/**
 * 给 GLTFLoader.setKTX2Loader 用的共享加载器：同一张贴图（解析后的绝对 URL）只下载 / 转码 / 上传一次，网络失败重试，
 * 最终失败给占位纹理（占位不进缓存，之后再加载引用它的 GLB 会重新尝试）。
 */
export function createSharedKtx2(cache: Map<string, Promise<THREE.Texture>>, deps: SharedKtx2Deps): { load: (url: string, onLoad: (t: THREE.Texture) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void) => void } {
  return {
    load(url, onLoad, onProgress, onError) {
      const key = deps.resolve(url);
      const p = shareInflight(cache, key, () => loadWithRetry(key, 'ktx2', () => deps.load(url, onProgress), deps));
      void p.then(onLoad, (err: unknown) => {
        const stat = assetStats.get(key);
        const fb = deps.fallback(key, err);
        if (!fb) {
          onError?.(err);
          return;
        }
        fb.userData.assetFallback = key;
        if (stat) stat.fallback = true;
        onLoad(fb);
      });
    },
  };
}

/** 颜色以外的贴图槽（法线 / 粗糙度 / AO…）放棋盘格会把光照弄花：只保留 map 槽的占位，其余槽清空 */
export function stripFallbackTextures(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const rec = m as unknown as Record<string, unknown>;
      for (const [slot, v] of Object.entries(rec)) {
        if (slot === 'map' || !v || typeof v !== 'object' || !(v as THREE.Texture).isTexture) continue;
        if ((v as THREE.Texture).userData?.assetFallback) {
          rec[slot] = null;
          m.needsUpdate = true;
          n++;
        }
      }
    }
  });
  return n;
}

/**
 * batch17 D2：UI 图片 = fetch（确认 200 + 读完字节）→ <img>.decode()（预热解码缓存，CSS / <img> 之后同 URL 命中）。
 * 冷启动那一批请求取消（BUG-008 / 012 同源：托管扩展装进新 profile 时掐掉在飞的子资源请求）会落在两步中的任何一步：
 * - fetch 被掐：TypeError → 照常重试
 * - fetch 已 200、decode() 那次请求被掐：Chrome 报 EncodingError「The source image cannot be decoded」——字节其实是好的，也按可重试处理
 * 真坏图（每次都 decode 失败）重试用完照样失败；4xx 不重试。
 */
export function loadImageWithRetry(
  url: string,
  deps: { fetch: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>; decode?: (url: string) => Promise<void> } & RetryDeps,
): Promise<string> {
  return loadWithRetry(
    url,
    'img',
    async () => {
      const r = await deps.fetch(url);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { response: { status: r.status } });
      await r.arrayBuffer();
      if (deps.decode) {
        try {
          await deps.decode(url);
        } catch (err) {
          const e = err as { name?: string; message?: string };
          throw Object.assign(new Error(`decode: ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`), { name: e?.name ?? 'Error', retryable: true, cause: err });
        }
      }
      return url;
    },
    deps,
  );
}

/** batch17 D2：音频（THREE.AudioLoader 内部 fetch，原来不重试 → 被取消就整局 missing）按同一规则重试 */
export function loadAudioWithRetry<T>(url: string, load: () => Promise<T>, deps: RetryDeps = {}): Promise<T> {
  return loadWithRetry(url, 'audio', load, deps);
}
