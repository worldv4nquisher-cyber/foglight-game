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
