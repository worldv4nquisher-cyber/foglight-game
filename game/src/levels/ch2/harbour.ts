import * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { TideController, TideSet } from '@/systems/tide/TideController';
import type { Point } from './layout';
import { v } from './geometry';

export const QUAY_START: Point = [9, 2, -7];
export const QUAY_END: Point = [9, 2, -22.65];
export const WATCH_POST: Point = [9, 2, -9.5];
export const GATE_CONTROL: Point = [9, 2, -11.15];
export const BOARDING: Point = [9, 2, -12.25];
export const COUNTERWEIGHT: Point = [10.3, 2, -22.9];
export const CRANE_CONTROL: Point = [8.2, 2, -25.2];
export const MARKET_DOOR: Point = [3.6, 6.2, -34.4];
export const CRATE_PICKUP: Point = [8, 2.04, -27.5];
export const CRATE_LANDING: Point = [6.65, 9.96, -41.7];
export const CRATE_HEIGHT = 0.78;
export const WATER_SEAM = -12.95;
export const HIGH_WATER = 1.54;
export const LOW_WATER = 0.12;
export const BOAT_FROM = -14.9;
export const BOAT_TO = -20.5;
export const CRANE_MAST: Point = [0, 19.2, -44.5];
export const CRANE_STATES = ['unweighted', 'ready', 'lifted', 'swung', 'landed'] as const;
export type CraneState = (typeof CRANE_STATES)[number];

const MOVES: Record<Exclude<CraneState, 'unweighted' | 'ready'>, { target: Point; seconds: number }> = {
  lifted: { target: [CRATE_PICKUP[0], 12.05, CRATE_PICKUP[2]], seconds: 2.7 },
  swung: { target: [CRATE_LANDING[0], 12.05, CRATE_LANDING[2]], seconds: 2.4 },
  landed: { target: CRATE_LANDING, seconds: 1.8 },
};

export class HarbourPuzzles {
  readonly tides = new TideSet();
  readonly outer: TideController;
  readonly inner: TideController;
  gateClosed = false;
  crane: CraneState = 'unweighted';
  readonly crate = v(CRATE_PICKUP);
  crossed = false;
  sailing = false;
  boatProgress = 0;
  private motion: { next: keyof typeof MOVES; from: THREE.Vector3; time: number } | null = null;

  constructor(events?: EventBus) {
    const opts = { initial: 'high', lowLevel: LOW_WATER, highLevel: HIGH_WATER, transitionSec: 12, ...(events && { events }) } as const;
    this.outer = this.tides.add(new TideController({
      ...opts, id: 'outer-channel', region: (p) => p.z >= WATER_SEAM,
      safePoint: { position: v(QUAY_START) },
    }));
    this.inner = this.tides.add(new TideController({
      ...opts, id: 'inner-basin', region: (p) => p.z < WATER_SEAM,
      safePoint: { position: v(QUAY_END) },
    }));
  }

  get canClose(): boolean {
    return !this.gateClosed && this.outer.state === 'low' && this.outer.progress < 0.48;
  }

  get canBoard(): boolean {
    return this.gateClosed && !this.outer.transitioning && !this.sailing && !this.crossed;
  }

  get craneMoving(): boolean {
    return this.motion !== null;
  }

  finish(): void {
    this.outer.set('low', { instant: true });
    this.gateClosed = this.crossed = true;
    this.boatProgress = 1;
    this.crane = 'landed';
    this.crate.copy(v(CRATE_LANDING));
  }

  waitForTide(): boolean {
    if (this.gateClosed || this.outer.transitioning || this.inner.transitioning) return false;
    const rising = this.outer.state === 'low';
    this.outer.toggle();
    if (rising) this.inner.set('high');
    return true;
  }

  closeGate(): boolean {
    if (!this.canClose) return false;
    this.gateClosed = true;
    return true;
  }

  board(): boolean {
    if (!this.canBoard) return false;
    this.sailing = true;
    return true;
  }

  setCounterweight(): boolean {
    if (!this.crossed || this.crane !== 'unweighted') return false;
    this.crane = 'ready';
    return true;
  }

  operateCrane(): boolean {
    const next = CRANE_STATES[CRANE_STATES.indexOf(this.crane) + 1];
    if (!next || next === 'unweighted' || next === 'ready' || this.motion) return false;
    this.motion = { next, from: this.crate.clone(), time: 0 };
    return true;
  }

  fixedUpdate(dt: number): void {
    this.tides.fixedUpdate(dt);
    if (!this.gateClosed && this.outer.state === 'low' && !this.canClose) this.inner.set('low');
    if (this.sailing) {
      this.boatProgress = Math.min(1, this.boatProgress + dt / 3.8);
      if (this.boatProgress === 1) {
        this.sailing = false;
        this.crossed = true;
      }
    }
    if (!this.motion) return;
    const { next, from } = this.motion;
    const { target, seconds } = MOVES[next];
    this.motion.time += dt;
    const f = THREE.MathUtils.smoothstep(this.motion.time, 0, seconds);
    if (next === 'swung') {
      const origin = CRANE_MAST;
      const fromX = from.x - origin[0], fromZ = from.z - origin[2];
      const toX = target[0] - origin[0], toZ = target[2] - origin[2];
      const angle = THREE.MathUtils.lerp(Math.atan2(fromX, fromZ), Math.atan2(toX, toZ), f);
      const radius = THREE.MathUtils.lerp(Math.hypot(fromX, fromZ), Math.hypot(toX, toZ), f);
      this.crate.set(origin[0] + Math.sin(angle) * radius, target[1], origin[2] + Math.cos(angle) * radius);
    } else {
      this.crate.copy(from).lerp(v(target), f);
    }
    if (this.motion.time >= seconds) {
      this.crate.copy(v(target));
      this.crane = next;
      this.motion = null;
    }
  }

  reset(): void {
    this.gateClosed = this.crossed = this.sailing = false;
    this.boatProgress = 0;
    this.resetCrane();
    this.outer.set('high', { instant: true });
    this.inner.set('high', { instant: true });
  }

  resetCrane(): void {
    this.crane = 'unweighted';
    this.crate.copy(v(CRATE_PICKUP));
    this.motion = null;
  }
}

export function addHarbourColliders(physics: PhysicsSystem) {
  const p = v(CRATE_LANDING);
  const crate = physics.addBox(new THREE.Box3(
    p.clone().add(new THREE.Vector3(-0.685, 0, -0.62)),
    p.clone().add(new THREE.Vector3(0.685, CRATE_HEIGHT, 0.62)),
  ));
  crate.enabled = false;
  physics.addBox(new THREE.Box3(new THREE.Vector3(-21, -2, -100), new THREE.Vector3(21, -1.75, 8)));
  return crate;
}
