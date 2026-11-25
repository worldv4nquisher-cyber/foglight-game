import * as THREE from 'three';
import { v, type Whitebox } from './geometry';
import type { Point } from './layout';

export const SHIP_STATIONS = [[-29, 3.1, -0.1], [-23, 6.2, 0], [-15, 7.0, 0], [0, 7.2, 0], [14, 6.55, 0.15], [24, 3.8, 0.9], [31, 0.35, 2.5]] as const;
export type Station = readonly [number, number, number];

export function shipOpening(side: number, span: number, band: number): boolean {
  return (span === 3 && (band === 0 || (side === 1 && band === 1))) || (span === 2 && side === 1 && band === 0);
}

function profile(z: number, index: 1 | 2): number {
  const steps = SHIP_STATIONS;
  const i = Math.max(0, steps.findIndex(([s]) => s >= z) - 1);
  const a = steps[i]!, b = steps[i + 1]!;
  const prev = steps[i - 1] ?? a, next = steps[i + 2] ?? b;
  const t = (z - a[0]) / (b[0] - a[0]);
  const m0 = (b[index] - prev[index]) / (b[0] - prev[0]) * (b[0] - a[0]);
  const m1 = (next[index] - a[index]) / (next[0] - a[0]) * (b[0] - a[0]);
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a[index] + (t ** 3 - 2 * t ** 2 + t) * m0
    + (-2 * t ** 3 + 3 * t ** 2) * b[index] + (t ** 3 - t ** 2) * m1;
}

export function hullPoint(side: number, z: number, h: number): Point {
  const breadth = profile(z, 1) * (1 - 0.98 * h ** 2.4);
  const rise = profile(z, 2);
  const forefoot = THREE.MathUtils.smoothstep(z, 19, 31) * 4.2 * h ** 2;
  return [side * breadth, rise * (1 - h) + 0.68 - 10.75 * h + forefoot - 0.55 * h * z / 31, z];
}

function hullMesh(): THREE.Mesh {
  const pos: number[] = [], paint: number[] = [], faces: number[] = [];
  const primer = new THREE.Color(0x8d5144), topsides = new THREE.Color(0x59666a);
  const oxide = new THREE.Color(0x925236), pale = new THREE.Color(0xb9b5a3), keel = new THREE.Color(0x393537);
  const color = new THREE.Color();
  const bands = [0, 0.177, 0.779, 1] as const;
  for (const side of [-1, 1]) for (let span = 0; span < SHIP_STATIONS.length - 1; span++) {
    const start = SHIP_STATIONS[span]![0], end = SHIP_STATIONS[span + 1]![0];
    const nx = Math.ceil((end - start) * 4.5);
    for (let band = 0; band < 3; band++) {
      if (shipOpening(side, span, band)) continue;
      const a = bands[band]!, b = bands[band + 1]!, ny = Math.ceil((b - a) * 49);
      const base = pos.length / 3;
      for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
        const z = THREE.MathUtils.lerp(start, end, x / nx), h = THREE.MathUtils.lerp(a, b, y / ny);
        pos.push(...hullPoint(side, z, h));
        const plate = Math.floor((z + 30) / 3.1);
        const streak = Math.pow(Math.max(0, Math.sin(z * 6.3 + side + 2 * Math.sin(z * 1.1))), 7);
        const length = 0.24 + (Math.sin(plate * 19.1) + 1) * 0.23;
        color.copy(h < 0.64 ? topsides : primer).multiplyScalar(0.91 + 0.08 * Math.sin(plate * 2.36) + 0.045 * Math.cos(h * 37));
        color.lerp(oxide, Math.min(0.8, (streak * 0.84 + 0.12) * (1 - THREE.MathUtils.smoothstep(h, 0.1, length))));
        color.lerp(keel, THREE.MathUtils.smoothstep(h, 0.76, 0.96));
        if (h > 0.067 && h < 0.122) color.lerp(pale, 0.77 - streak * 0.42);
        paint.push(color.r, color.g, color.b);
        if (x && y) {
          const d = base + y * (nx + 1) + x, c = d - 1, b0 = d - nx - 1, a0 = b0 - 1;
          if (side < 0) faces.push(a0, c, d, a0, d, b0);
          else faces.push(a0, d, c, a0, b0, d);
        }
      }
    }
  }
  const cap = pos.length / 3;
  for (let i = 0; i <= 24; i++) {
    const h = i / 24;
    for (const side of [-1, 1]) {
      pos.push(...hullPoint(side, 31, h));
      color.copy(h < 0.64 ? topsides : primer).lerp(keel, THREE.MathUtils.smoothstep(h, 0.76, 0.96));
      paint.push(color.r, color.g, color.b);
    }
    const n = cap + i * 2;
    if (i) faces.push(n - 2, n, n + 1, n - 2, n + 1, n - 1);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(paint, 3));
  geom.setIndex(faces);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0.15 }));
  mesh.name = 'north-herring-riveted-shell';
  return mesh;
}

export function dressVessel(w: Whitebox, ship: THREE.Group): void {
  ship.add(hullMesh());
  const steel = 0x514f49, stripe = 0xb3ad92, wood = 0x776758, oxide = 0x825143, window = 0x394f59;
  const rivet = new THREE.OctahedronGeometry(1), rim = new THREE.TorusGeometry(1, 0.14, 5, 13);
  const cylinder = new THREE.CylinderGeometry(1, 1.1, 1, 18);
  for (const side of [-1, 1]) {
    for (let z = -27; z < 30; z += 1.45) {
      const span = SHIP_STATIONS.findIndex(([s]) => s > z) - 1;
      const end = Math.min(z + 1.43, SHIP_STATIONS[span + 1]![0]);
      const a = hullPoint(side, z, 0), b = hullPoint(side, end, 0);
      if (!shipOpening(side, span, 0)) {
        w.beam(ship, a, b, 0.15, stripe);
        w.beam(ship, [a[0], a[1], a[2]], [a[0], a[1] + 0.89, a[2]], 0.075, steel);
        for (const dy of [0.44, 0.9]) w.beam(ship, [a[0], a[1] + dy, a[2]], [b[0], b[1] + dy, b[2]], 0.057, steel);
      }
      for (const h of [0.15, 0.31, 0.47, 0.64, 0.77]) {
        if (shipOpening(side, span, h < 0.177 ? 0 : 1)) continue;
        const p = hullPoint(side, z, h);
        w.shape(ship, rivet, 0x7a7564, [p[0] + side * 0.025, p[1], p[2]], [0.08, 0.052, 0.062]);
      }
    }
    for (const z of [-22, -18.6, 15.5, 18.3, 21.2, 24]) {
      const p = hullPoint(side, z, 0.193);
      const tangent = v(hullPoint(side, z + 0.1, 0.193)).sub(v(p));
      const normal = new THREE.Vector3(tangent.z * side, 0, -tangent.x * side).normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const center = v(p).addScaledVector(normal, 0.065).toArray();
      w.shape(ship, rim, stripe, center, [0.3, 0.3, 0.31], false, rotation);
      w.shape(ship, rivet, window, center, [0.24, 0.24, 0.12], false, rotation);
    }
  }
  for (const z of [0.05, 13.95]) {
    const a = hullPoint(1, z, 0.02), b = hullPoint(1, z, 0.77);
    w.beam(ship, a, b, 0.23, oxide, 0.25);
    w.beam(ship, [a[0] + 0.09, a[1], z], [b[0] + 0.09, b[1], z], 0.067, stripe);
  }
  for (let z = 0; z < 14; z += 0.7) {
    const a = hullPoint(1, z, 0.78), b = hullPoint(1, z + 0.7, 0.78);
    w.beam(ship, a, b, 0.17, oxide, 0.23);
  }
  for (const z of [16.8, 20.2]) {
    const p = hullPoint(1, z, 0.11), q = hullPoint(1, z, 0.29);
    w.beam(ship, p, [q[0] + 0.15, q[1], q[2]], 0.062, wood);
    w.shape(ship, rim, 0x343839, [q[0] + 0.15, q[1], q[2]], [0.54, 0.54, 0.55], false,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.18));
  }
  const foredeck: number[] = [];
  for (let z = 19; z < 31; z += 0.4) {
    const t = Math.min(z + 0.4, 31);
    const corner = (s: number, at: number): Point => {
      const p = hullPoint(s, at, 0);
      return [p[0], p[1] - 0.32, p[2]];
    };
    const a = corner(-1, z), b = corner(1, z), c = corner(1, t), d = corner(-1, t);
    foredeck.push(...a, ...d, ...c, ...a, ...c, ...b);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(foredeck, 3));
  deck.computeVertexNormals();
  w.shape(ship, deck, wood, [0, 0, 0]);
  for (const z of [-21, 15]) {
    const aft = z < 0, x = aft ? -1.8 : -0.45, y = aft ? 0 : 0.34;
    w.box(ship, [x, y + 0.75, z], [4.3, 1.5, 3.48], 0x827b6c);
    w.box(ship, [x, y + 2.17, z], [4.18, 1.35, 3.47], steel);
    w.shape(ship, cylinder, 0x625e57, [x, y + 3.03, z], [2.72, 0.29, 2.14],
      false, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 18));
    for (const d of [-1, 1]) {
      for (const dx of [-1.38, 0, 1.38]) w.box(ship, [x + dx, y + 2.24, z + d * 1.75], [1.15, 0.85, 0.09], window);
      for (const dz of [-0.84, 0.84]) w.box(ship, [x + d * 2.1, y + 2.24, z + dz], [0.09, 0.85, 1.37], window);
    }
    w.beam(ship, [x, y + 3.2, z], [x, y + 5.6, z - 0.17], 0.09, steel);
  }
  w.shape(ship, cylinder, oxide, [-2.65, 3.82, 9.2], [0.89, 5.6, 0.9]);
  w.shape(ship, cylinder, steel, [-2.65, 6.63, 9.2], [0.97, 0.82, 0.98]);
  w.shape(ship, cylinder, 0x333a3c, [-2.65, 7.06, 9.2], [0.71, 0.12, 0.73]);
  w.beam(ship, [0, 3.5, 23.1], [0, 7.1, 23.1], 0.16, steel);
  w.beam(ship, [-1.26, 6.18, 23.1], [1.26, 6.18, 23.1], 0.12, steel);
}
