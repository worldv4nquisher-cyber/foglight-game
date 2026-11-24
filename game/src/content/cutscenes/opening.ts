import { XI_CLIP_SPECS, XI_FPS } from '@/entities/xi/clips';

// Shot timings from text-ch1 §1. Start the final glide early enough to ship the oars clear of the pier.
export const OPENING_T = {
  reveal: 3, close: 15, stow: 19, glide: 21, berth: 23, docking: 26, tie: 28,
  pickup: 38, walk: 40.15, gaze: 42,
  subtitle: 46, benchmark: 51, title: 52, establishing: 57, end: 60,
} as const;

export function openingBoatDistance(t: number): number {
  const { reveal, glide, tie } = OPENING_T;
  const speed = 0.9;
  const glideTime = tie - glide;
  if (t >= glide) {
    const remaining = Math.max(0, tie - t);
    return speed * remaining * remaining / (2 * glideTime);
  }
  const elapsed = Math.max(0, t - reveal);
  const rowTime = glide - reveal;
  // An integrated stroke pulse: the boat surges on the pull but never reverses on recovery.
  const omega = 2 * Math.PI / ((XI_CLIP_SPECS['xi-row-boat'].frames - 1) / XI_FPS);
  const surge = (x: number): number => 0.08 * (1 - Math.cos(omega * x));
  return speed * (glideTime / 2 + rowTime - elapsed) + surge(rowTime) - surge(elapsed);
}
