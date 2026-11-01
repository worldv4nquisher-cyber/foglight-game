/** 全屏封装（含 webkit 前缀，iOS Safari 对非视频元素不支持全屏，调用会静默失败）。 */
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function isFullscreenSupported(): boolean {
  const el = document.documentElement as FsEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export async function toggleFullscreen(el: HTMLElement = document.documentElement): Promise<void> {
  const d = document as FsDoc;
  const target = el as FsEl;
  try {
    if (isFullscreen()) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    } else {
      await (target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.());
    }
  } catch (err) {
    console.warn('[fullscreen] 切换失败', err);
  }
}

/**
 * batch26 ④：监听全屏状态变化（标准 fullscreenchange + Safari 的 webkitfullscreenchange；两个都到时回调只按状态变化算一次）。
 * 玩家按 Esc / F11 菜单 / 浏览器自己退出全屏都会走到这里，界面和画布据此同步。返回解绑函数。
 */
export function onFullscreenChange(cb: (active: boolean) => void): () => void {
  let last = isFullscreen();
  const h = (): void => {
    const now = isFullscreen();
    if (now === last) return;
    last = now;
    cb(now);
  };
  document.addEventListener('fullscreenchange', h);
  document.addEventListener('webkitfullscreenchange', h);
  return () => {
    document.removeEventListener('fullscreenchange', h);
    document.removeEventListener('webkitfullscreenchange', h);
  };
}
