/**
 * BUG-035: decide whether to show the "desktop browsers only" notice instead of the main menu.
 * v0.1 is keyboard + mouse only (GDD, 2026-10-29 decision), so phones / tablets without a precise pointer get a notice.
 *
 * Pure function (no DOM) so verify-input can unit-test it. Rules, in order:
 *   1. Any fine pointer that can hover (mouse / trackpad) -> playable. Covers touch-screen laptops and tablets with a
 *      keyboard + trackpad attached: they must never be blocked.
 *   2. Primary pointer is coarse and cannot hover (finger-only phone / tablet) -> notice.
 *   3. Media queries unavailable or inconclusive: mobile OS / UA with touch and no fine pointer -> notice.
 *   Everything else (desktop without touch, unknown) -> playable.
 */
export interface PointerTraits {
  /** matchMedia('(pointer: coarse)') — primary pointer */
  primaryCoarse: boolean;
  /** matchMedia('(hover: hover)') — primary pointer can hover */
  primaryHover: boolean;
  /** matchMedia('(any-pointer: fine)') */
  anyFine: boolean;
  /** matchMedia('(any-hover: hover)') */
  anyHover: boolean;
  /** whether the media queries above were actually evaluated (old browsers / no matchMedia: false) */
  mediaKnown: boolean;
  hasTouch: boolean;
  /** iOS / iPadOS / Android, or a "Mobi" UA */
  mobileOs: boolean;
}

export function isDesktopOnlyBlocked(p: PointerTraits): boolean {
  if (p.mediaKnown && p.anyFine && p.anyHover) return false;
  if (p.mediaKnown && p.primaryCoarse && !p.primaryHover) return true;
  return p.mobileOs && p.hasTouch && !(p.mediaKnown && p.anyFine);
}
