/**
 * batch26 ⑥：监听 devicePixelRatio 变化（浏览器缩放、窗口拖到缩放比例不同的显示器）。
 * 容器 CSS 尺寸可能不变（拖到另一块屏），ResizeObserver 不会触发，画布会一直按旧像素比渲染（糊或浪费）。
 * 用 matchMedia(`(resolution: Ndppx)`) 监听「当前值不再成立」；每次变化后按新值重新注册查询（一个查询只能感知离开当前值）。
 * 老 Safari（< 14）的 MediaQueryList 没有 addEventListener，用 addListener。返回解绑函数。
 */
type Mql = MediaQueryList & { addListener?: (h: () => void) => void; removeListener?: (h: () => void) => void };

export function watchDevicePixelRatio(cb: (dpr: number) => void, win: Window = window): () => void {
  if (typeof win.matchMedia !== 'function') return () => undefined;
  let mql: Mql | null = null;
  let disposed = false;
  const off = (): void => {
    if (!mql) return;
    if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
    else mql.removeListener?.(onChange);
    mql = null;
  };
  const arm = (): void => {
    off();
    mql = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else mql.addListener?.(onChange);
  };
  function onChange(): void {
    if (disposed) return;
    arm(); // 先按新值重新注册，再通知（回调里再读 devicePixelRatio 也是新值）
    cb(win.devicePixelRatio || 1);
  }
  arm();
  return () => {
    disposed = true;
    off();
  };
}
