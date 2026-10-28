/**
 * 原生壳适配点（Capacitor / Electron）。
 * 当前只做运行环境检测和空实现；以后打包时在这里接入：
 * - Capacitor：@capacitor/app 的 backButton / appStateChange、StatusBar、ScreenOrientation、Haptics
 * - Electron：通过 preload 暴露的 window.electronAPI（窗口全屏、退出、存档到本地文件）
 * 游戏代码只依赖 nativeBridge 接口，不直接引用原生 SDK。
 */
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
type ElectronAPI = { quit?: () => void; setFullscreen?: (v: boolean) => void };

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
    electronAPI?: ElectronAPI;
  }
}

export type Platform = 'web' | 'capacitor-ios' | 'capacitor-android' | 'electron';

function detectPlatform(): Platform {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) {
    return cap.getPlatform?.() === 'ios' ? 'capacitor-ios' : 'capacitor-android';
  }
  if (window.electronAPI || /Electron/i.test(navigator.userAgent)) return 'electron';
  return 'web';
}

export interface NativeBridge {
  readonly platform: Platform;
  readonly isNative: boolean;
  /** Android 返回键 / Electron 自定义快捷键 */
  onBackButton(cb: () => void): void;
  /** 退出应用（Web 下无效果） */
  quit(): void;
  /** 震动反馈（Web 用 navigator.vibrate 兜底） */
  vibrate(ms?: number): void;
}

const platform = detectPlatform();
const backHandlers: Array<() => void> = [];

export const nativeBridge: NativeBridge = {
  platform,
  isNative: platform !== 'web',
  onBackButton(cb) {
    backHandlers.push(cb);
    // TODO(Capacitor): App.addListener('backButton', () => backHandlers.forEach((h) => h()))
  },
  quit() {
    window.electronAPI?.quit?.();
    // TODO(Capacitor): App.exitApp()
  },
  vibrate(ms = 20) {
    // TODO(Capacitor): Haptics.impact()
    navigator.vibrate?.(ms);
  },
};
