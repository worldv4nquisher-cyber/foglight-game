import { xiClipDuration, xiEventSec } from '@/entities/xi/clips';

// Shot timings from text-ch1 §1. Start the final glide early enough to ship the oars clear of the pier.
export const OPENING_T = {
  reveal: 3, close: 15, stow: 19, glide: 21, berth: 23, docking: 26, tie: 28,
  pickup: 38, walk: 40.15, gaze: 42,
  subtitle: 46, benchmark: 51, title: 52, establishing: 57, end: 60,
} as const;

const ROW_CLIP = 'xi-row-boat';
const ROW_CYCLE = xiClipDuration(ROW_CLIP);

export function openingOarSplashTimes(): number[] {
  const { reveal, stow } = OPENING_T;
  const times: number[] = [reveal];
  const bladeIn = xiEventSec(ROW_CLIP, 'bladeIn') ?? ROW_CYCLE;
  for (let time = reveal + bladeIn; time < stow; time += ROW_CYCLE) times.push(time);
  return times;
}

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
  const omega = 2 * Math.PI / ROW_CYCLE;
  const surge = (x: number): number => 0.08 * (1 - Math.cos(omega * x));
  return speed * (glideTime / 2 + rowTime - elapsed) + surge(rowTime) - surge(elapsed);
}
