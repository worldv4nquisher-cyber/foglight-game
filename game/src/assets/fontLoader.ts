// 字体子集（WOFF2）加载：fetch 字节 → FontFace → document.fonts。
// 只有这一条下载路径（index.html 没有 <link rel=preload>，CSS 里也没有 @font-face url()），同一 URL 并发请求共用一个 Promise，
// 保证每个字体只真正下载一次；网络层错误（TypeError，如 net::ERR_ABORTED 被取消）才重试，HTTP 4xx 不重试。
// BUG-008 根因（2026-10-29 查明）：冷启动偶发的第一次请求 net::ERR_ABORTED 不是游戏代码造成的——
// 测试机 Chrome 的托管策略（/etc/opt/chrome/policies/managed/sand-webauthn.json 的 ExtensionSettings）
// 往每个新 profile 强制安装两个扩展，扩展在冷启动时安装 / 激活会让页面的子资源加载器重建，正在飞的 fetch 被浏览器内部取消
// （net-log 里第一次请求根本没到网络服务；加 --disable-extensions 后 CPU 降速 8× 0/6 复现，不加 11/12）。
// 真实玩家环境也可能有扩展做同样的事，所以这里的重试保留。探针脚本见 docs/bugs/BUG-008-probe/。
// 重试全部失败时不抛给界面：返回 null，CSS 的 --ui-font / --ui-serif 回退到系统中文字体，<html> 加 fonts-fallback 类供排查。
// 纯函数 + 可注入依赖，Node 单测（scripts/verify-assets.mjs）直接跑。

export interface FontLoadDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** 由字节建 FontFace 并 load()；返回加到 document.fonts 的对象 */
  makeFace: (family: string, bytes: ArrayBuffer) => Promise<FontFace>;
  addFace: (face: FontFace) => void;
  onFallback?: (family: string, err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface FontLoadStat {
  url: string;
  family: string;
  /** fetch 调用次数（含重试） */
  attempts: number;
  ok: boolean;
  error?: string;
}

export const FONT_RETRIES = 2;
export const FONT_RETRY_DELAY_MS = 150;

const inflight = new Map<string, Promise<FontFace | null>>();
/** 每个 URL 的加载记录（smoke / F4 / QA 用：__game.assets.fontStats） */
export const fontStats = new Map<string, FontLoadStat>();

/** 可重试的错误：网络层失败（fetch 抛 TypeError / AbortError）或 5xx */
function retryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status >= 500;
  return true;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

export function loadFontOnce(url: string, family: string, deps: FontLoadDeps): Promise<FontFace | null> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = doLoad(url, family, deps);
  inflight.set(url, p);
  // 失败的不缓存，下次进菜单可再试
  void p.then((f) => {
    if (!f) inflight.delete(url);
  });
  return p;
}

/** 卸载时调用：之后再请求会重新加载 */
export function forgetFont(url: string): void {
  inflight.delete(url);
}

async function doLoad(url: string, family: string, deps: FontLoadDeps): Promise<FontFace | null> {
  const stat: FontLoadStat = { url, family, attempts: 0, ok: false };
  fontStats.set(url, stat);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FONT_RETRIES; attempt++) {
    if (attempt > 0) await sleep(FONT_RETRY_DELAY_MS * attempt);
    stat.attempts++;
    try {
      // 同源、默认凭据、可用 HTTP 缓存：重试时若上一次其实已经进缓存，不会再下一遍
      const res = await deps.fetch(url, { credentials: 'same-origin', cache: 'default' });
      if (!res.ok) throw new HttpError(res.status);
      const bytes = await res.arrayBuffer();
      const face = await deps.makeFace(family, bytes);
      deps.addFace(face);
      stat.ok = true;
      return face;
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) break;
    }
  }
  stat.error = String(lastErr instanceof Error ? lastErr.message : lastErr);
  deps.onFallback?.(family, lastErr);
  return null;
}
