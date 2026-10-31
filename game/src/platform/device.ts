/** 设备与能力检测（只在启动时计算一次）。 */
import { isDesktopOnlyBlocked } from './desktopOnly';

const ua = navigator.userAgent;
const nav = navigator as Navigator & { deviceMemory?: number };

const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const mq = (q: string): boolean => window.matchMedia?.(q).matches ?? false;
const coarsePointer = mq('(pointer: coarse)');
const isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
/** BUG-035: phone / tablet without a precise pointer -> main menu shows ui.notice.desktop_only instead of buttons */
const desktopOnlyBlocked = isDesktopOnlyBlocked({
  primaryCoarse: coarsePointer,
  primaryHover: mq('(hover: hover)'),
  anyFine: mq('(any-pointer: fine)'),
  anyHover: mq('(any-hover: hover)'),
  // a browser that understands pointer media queries matches exactly one of these
  mediaKnown: mq('(pointer: coarse), (pointer: fine), (pointer: none)'),
  hasTouch,
  mobileOs: isMobile,
});

export const device = {
  isIOS,
  isAndroid,
  isMobile,
  /** 是否显示触屏控件：有触摸能力且主指针为粗指针（排除触屏笔记本） */
  isTouch: hasTouch && (coarsePointer || isIOS || isAndroid),
  hasTouch,
  /** BUG-035：手机 / 无精确指针的平板，主菜单换成「仅支持电脑」提示（触屏笔记本有鼠标 / 触控板，不算） */
  desktopOnlyBlocked,
  hardwareConcurrency: navigator.hardwareConcurrency || 4,
  deviceMemory: nav.deviceMemory,
  supportsPointerLock: 'pointerLockElement' in document,
  prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} as const;

export type DeviceInfo = typeof device;
