/**
 * 构建 / dev 启动时 ../art 里实际存在的 pending 美术资源（vite.config.ts 的 define 注入，见 manifest `pending`）。
 * Node 测试里没有注入 = 一律当作没交付。
 */
declare const __FOGLIGHT_PENDING_ART__: readonly string[] | undefined;

const present: ReadonlySet<string> = new Set(typeof __FOGLIGHT_PENDING_ART__ === 'undefined' ? [] : __FOGLIGHT_PENDING_ART__);

export function pendingArtPresent(url: string): boolean {
  return present.has(url);
}
