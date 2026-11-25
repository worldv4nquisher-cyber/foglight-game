import * as THREE from 'three';
import { v } from './geometry';
import type { Point } from './layout';

export const LANTERN: Point = [-4, 33.5, 32.55];
export const RECEIVER: Point = [12.3, 27.4, -83.25];
export const RELAY = [
  { center: [11.15, 17.35, -54.15], control: [13.6, 15, -54.2], notch: 2, initial: 0 },
  { center: [-11.35, 13.9, -44.05], control: [-12.55, 11.16, -43.35], notch: 1, initial: 3 },
  { center: [11.9, 22.15, -65.6], control: null, notch: 0, initial: 0 },
  { center: [-9.7, 20.65, -60.5], control: [-11.55, 18, -59.95], notch: 3, initial: 0 },
] as const satisfies readonly { center: Point; control: Point | null; notch: number; initial: number }[];

const DETENTS = 5;
const DETENT_ANGLE = Math.PI / 14;
const UP = new THREE.Vector3(0, 1, 0);
const APERTURE = 0.65;

export interface LightPath {
  points: THREE.Vector3[];
  /** Number of mirrors receiving the beam, including the last one if it is misaligned. */
  lit: number;
  received: boolean;
}

export class MirrorRelay {
  private readonly settings: number[];

  constructor(solved = false) {
    this.settings = RELAY.map((mirror) => solved ? mirror.notch : mirror.initial);
  }

  detent(index: number): number {
    return this.settings[index]!;
  }

  turn(index: number, direction: -1 | 1): void {
    if (!RELAY[index]?.control) return;
    this.settings[index] = (this.detent(index) + direction + DETENTS) % DETENTS;
  }

  reset(): void {
    RELAY.forEach((mirror, i) => { this.settings[i] = mirror.initial; });
  }

  normal(index: number): THREE.Vector3 {
    const mirror = RELAY[index]!;
    const center = v(mirror.center);
    const before = v(RELAY[index - 1]?.center ?? LANTERN).sub(center).normalize();
    const after = v(RELAY[index + 1]?.center ?? RECEIVER).sub(center).normalize();
    return before.add(after).normalize().applyAxisAngle(UP, (this.detent(index) - mirror.notch) * DETENT_ANGLE);
  }

  trace(): LightPath {
    const points = [v(LANTERN), v(RELAY[0].center)];
    let incoming = points[1]!.clone().sub(points[0]!).normalize();
    for (let index = 0; index < RELAY.length; index++) {
      const center = points.at(-1)!;
      const outgoing = incoming.reflect(this.normal(index));
      const target = v(RELAY[index + 1]?.center ?? RECEIVER);
      const toTarget = target.clone().sub(center);
      const projection = outgoing.dot(toTarget);
      if (projection <= 0 || outgoing.clone().multiplyScalar(projection).distanceTo(toTarget) > APERTURE) {
        points.push(center.clone().addScaledVector(outgoing, 4.2));
        return { points, lit: index + 1, received: false };
      }
      points.push(target);
      incoming = toTarget.normalize();
    }
    return { points, lit: RELAY.length, received: true };
  }
}
