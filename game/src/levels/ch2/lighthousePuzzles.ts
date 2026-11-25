import * as THREE from 'three';
import { v } from './geometry';
import { CABLE_FROM, CABLE_TO, type Point } from './layout';

export const WINCH: Point = [-20, 39, -5.7];
export const PRISM_CONTROL: Point = [-2.25, 32.12, 35.55];
export const PRISM: Point = [-4, 33.47, 35];
export const PILOT: Point = [-4, 34.66, 35];
export const PORTS = [[-5.38, 33.08, 36.39], [-2.62, 33.08, 36.39]] as const satisfies readonly Point[];
export const WEIGHT_LIMIT = 4;
export const BALANCED_LOAD = 3;
export const PRISM_DETENTS = 7;

const FROM = v(CABLE_FROM), TO = v(CABLE_TO);
const ORIGIN = v(PRISM);
const PORT_POSITIONS = PORTS.map(v);
const DIRECTIONS = PORT_POSITIONS.map((port) => port.clone().sub(ORIGIN).normalize());
const UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1);
const APERTURE = 0.14, SWING = Math.PI / 13;

export type PrismAxis = 'yaw' | 'roll';

export class CableCar {
  load = 1;
  released = false;
  private from = 0;
  private to = 0;
  private elapsed = 0;

  get moving(): boolean { return this.from !== this.to; }
  get side(): 'cliff' | 'stack' { return this.to === 0 ? 'cliff' : 'stack'; }

  adjust(change: -1 | 1): void {
    if (this.released) return;
    this.load = THREE.MathUtils.clamp(this.load + change, 0, WEIGHT_LIMIT);
  }

  reset(): void {
    if (!this.released) this.load = 1;
  }

  release(): boolean {
    if (this.load !== BALANCED_LOAD) return false;
    this.released = true;
    return true;
  }

  board(side: CableCar['side']): boolean {
    if (!this.released || this.moving || side !== this.side) return false;
    this.elapsed = 0;
    this.to = 1 - this.from;
    return true;
  }

  step(dt: number): void {
    if (!this.moving) return;
    this.elapsed = Math.min(1, this.elapsed + dt / 7);
    if (this.elapsed === 1) this.from = this.to;
  }

  sample(out: THREE.Vector3): THREE.Vector3 {
    const t = THREE.MathUtils.smoothstep(this.elapsed, 0, 1);
    return out.lerpVectors(FROM, TO, THREE.MathUtils.lerp(this.from, this.to, t));
  }
}

export class PrismSplitter {
  yaw = 1;
  roll = 4;
  lit = false;
  private charge = 0;

  adjust(axis: PrismAxis, direction: -1 | 1): void {
    if (this.lit) return;
    this[axis] = THREE.MathUtils.clamp(this[axis] + direction, 0, PRISM_DETENTS - 1);
  }

  reset(): void {
    if (this.lit) return;
    this.yaw = 1;
    this.roll = 4;
    this.charge = 0;
  }

  trace(): { end: THREE.Vector3; aligned: boolean }[] {
    return DIRECTIONS.map((base, index) => {
      const target = PORT_POSITIONS[index]!;
      const dir = base.clone().applyAxisAngle(FORWARD, (this.roll - 2) * SWING)
        .applyAxisAngle(UP, (this.yaw - 4) * SWING);
      const delta = target.clone().sub(ORIGIN);
      const travel = delta.dot(dir);
      const aligned = travel > 0 && delta.addScaledVector(dir, -travel).length() < APERTURE;
      return { end: aligned ? target.clone() : ORIGIN.clone().addScaledVector(dir, 1.9), aligned };
    });
  }

  step(dt: number): void {
    if (this.lit) return;
    this.charge = this.trace().every(({ aligned }) => aligned) ? this.charge + dt : 0;
    if (this.charge >= 0.55) this.lit = true;
  }
}
