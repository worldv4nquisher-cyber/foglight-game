/** 页面可见性监听：切后台 / 锁屏 / 最小化时回调 visible=false。 */
export class VisibilityWatcher {
  private handler = (): void => this.cb(document.visibilityState === 'visible');
  private blur = (): void => this.cb(false);

  constructor(private cb: (visible: boolean) => void) {
    document.addEventListener('visibilitychange', this.handler);
    window.addEventListener('pagehide', this.blur);
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.handler);
    window.removeEventListener('pagehide', this.blur);
  }
}
