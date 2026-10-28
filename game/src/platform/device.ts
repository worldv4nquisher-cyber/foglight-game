/** 设备与能力检测（只在启动时计算一次）。 */
const ua = navigator.userAgent;
const nav = navigator as Navigator & { deviceMemory?: number };

const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

export const device = {
  isIOS,
  isAndroid,
  isMobile: isIOS || isAndroid || /Mobi/i.test(ua),
  /** 是否显示触屏控件：有触摸能力且主指针为粗指针（排除触屏笔记本） */
  isTouch: hasTouch && (coarsePointer || isIOS || isAndroid),
  hasTouch,
  hardwareConcurrency: navigator.hardwareConcurrency || 4,
  deviceMemory: nav.deviceMemory,
  supportsPointerLock: 'pointerLockElement' in document,
  prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} as const;

export type DeviceInfo = typeof device;
