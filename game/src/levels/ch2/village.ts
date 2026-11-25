import * as THREE from 'three';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { Whitebox } from './geometry';
import { CABLE_FROM, CABLE_TO, TERRACES, type Point } from './layout';
import { dressVessel, SHIP_STATIONS, shipOpening } from './harbourVessel';

const TIMBER = 0x776758, BEAM = 0x514841, WALK = 0xa99a84, STEEL = 0x6a5150;
const STONE = 0x68757c, ROCK = 0x56636d, WATER = 0x456d78, WHITE = 0xd9e0de, MARK = 0xe5c083;
export const TOWER_SHELL = 'ch2-tower-shell';

function surface(vertices: number[]): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.computeVertexNormals();
  return geom;
}

const quad = (a: Point, b: Point, c: Point, d: Point): number[] => [...a, ...b, ...c, ...a, ...c, ...d];

function coast(w: Whitebox, playable: boolean, mirrorAlley: boolean): void {
  if (!playable && !mirrorAlley) {
    const water = new THREE.PlaneGeometry(650, 650);
    water.rotateX(-Math.PI / 2);
    w.shape(w.root, water, WATER, [0, 0, -20]);
  }
  const c1 = new THREE.Color(ROCK), c2 = new THREE.Color(0x919a9c);
  for (const side of [-1, 1]) {
    const vertices = Array.from({ length: 13 }, (_, i) => {
      const z = 6 - i * 10;
      const inset = (i === 0 ? 8 : i === 1 ? 2 : 0) + 1.6 * Math.sin(i * 1.55 + side);
      const crest = side < 0 && i <= 5 ? 38.3 : 40 + 4 * Math.sin(i * 1.7 + side);
      return [
        [side * (13.6 + inset), -2, z],
        [side * (14.8 + inset), 11 + Math.sin(i * 2) * 3, z + 1.4 * Math.sin(i)],
        [side * (16 + inset), 26 + Math.cos(i) * 5, z - 1.5 * Math.sin(i)],
        [side * (17 + inset), crest, z],
        [side * (32 + inset), crest, z],
      ] as Point[];
    });
    for (let j = 0; j < vertices.length - 1; j++) {
      for (let band = 0; band < 4; band++) {
        const a = vertices[j]![band]!, b = vertices[j]![band + 1]!;
        const c = vertices[j + 1]![band + 1]!, d = vertices[j + 1]![band]!;
        const color = c1.clone().lerp(c2, (band * 0.12 + (Math.sin(j * 12.2 + side) + 1) * 0.15)).getHex();
        const face = surface(side < 0 ? quad(d, c, b, a) : quad(a, b, c, d));
        w.shape(w.root, face, color, [0, 0, 0], [1, 1, 1], true, undefined, !playable);
      }
    }
    if (!playable) {
      const end = vertices[0]!;
      w.shape(w.root, surface(quad(end[0]!, [side * 32, -2, 7], end[4]!, end[3]!)
        .concat(quad(end[3]!, end[4]!, [side * 32, -2, 7], end[0]!))), ROCK, [0, 0, 0]);
    }
  }
  w.shape(w.root, new THREE.BoxGeometry(), STONE, [0, 16, -116], [35, 36, 10], true, undefined, !playable);
  if (!playable) w.box(w.root, [-8, 35, -113], [18, 11, 12], ROCK);
  for (let i = 0; i < 5; i++) {
    w.box(w.root, [-3 + 0.4 * Math.sin(i), 4 + i * 8, -110.8 + i * 0.25], [1.4 - i * 0.13, 8.4, 0.75], 0x9dbfc4);
  }
  const rock = new THREE.IcosahedronGeometry(1, 0);
  for (const [x, y, z, sx, sy, sz] of [
    [-17, 0, 5, 6, 5, 7], [-21, 2, 8, 7, 8, 10], [20, 0, 9, 8, 7, 12],
    [17, 0, 14, 4, 4, 4], [-13, 2, -20, 6, 5, 5], [13, 2, -70, 6, 6, 8],
  ] as const) if (!playable) w.shape(w.root, rock, ROCK, [x, y, z], [sx, sy, sz]);
}

function landing(w: Whitebox, playable: boolean): void {
  const g = w.root;
  const spans = playable ? [[-12.9, -4], [-31, -21.6]] as const : [[-30, -4]] as const;
  for (const [from, to] of spans) {
    w.floor(g, [9, 2, (from + to) / 2], 5, to - from, WALK);
    if (playable) w.rail(g, [11.4, 2, from + 0.2], [11.4, 2, to - 0.2], BEAM);
    if (playable) for (let z = from + 0.12; z < to; z += 0.37) {
      w.box(g, [9, 2.012, z], [5.02, 0.046, 0.355], [0x786f60, 0x887967, 0x958371, 0x6b6157][Math.round(z * -17) % 4]!);
    }
  }
  w.floor(g, [9, 2, -29], 6, 6, TIMBER);
  if (!playable) w.rail(g, [11.4, 2, -5], [11.4, 2, -31], BEAM);
  w.rail(g, [6.6, 2, -9], [6.6, 2, playable ? -12.4 : -20], BEAM);
  for (let i = 0; i < 13; i++) {
    const z = -5 - i * 2;
    if (playable && z < -12.9 && z > -21.6) continue;
    w.box(g, [11.1, 0.5, z], [0.23, 3.1, 0.23], BEAM);
    w.box(g, [6.8, 0.5, z], [0.23, 3.1, 0.23], BEAM);
    if (!playable) w.box(g, [9, 2.015, z], [4.85, 0.035, 0.035], BEAM);
  }
  if (!playable) {
    const boat = w.group();
    boat.position.set(4.6, 0.15, -6);
    boat.rotation.y = -0.2;
    w.box(boat, [0, 0.15, 0], [1.45, 0.38, 4.1], TIMBER);
    for (const side of [-1, 1]) {
      w.box(boat, [side * 0.72, 0.38, 0], [0.14, 0.45, 3.8], BEAM);
      w.beam(boat, [side * 0.72, 0.44, -1.8], [0, 0.64, -2.75], 0.16, BEAM);
      w.beam(boat, [side * 0.72, 0.44, 1.8], [0, 0.53, 2.23], 0.16, BEAM);
    }
    for (const z of [-1.2, 0.75]) w.box(boat, [0, 0.49, z], [1.35, 0.1, 0.32], WALK);
    for (const x of [-0.5, 5]) w.box(g, [x, 0.85, -10], [0.39, 3, 0.42], BEAM);
    for (let i = 0; i < 13; i++) w.box(g, [-0.3 + i * 0.43, 0.22, -10], [0.22, 2.1, 0.16], TIMBER);
    w.box(g, [2.25, 1.32, -10], [5.7, 0.18, 0.21], BEAM);
    for (let i = 0; i < 6; i++) w.box(g, [5.1, 0.15 + i * 0.32, -9.77], [0.3 - (i % 2) * 0.13, 0.055, 0.035], WHITE);
  }
  w.stairs(g, [9, 2, -25], [5.2, 6.2, -33], 2.1, WALK);
  w.floor(g, [4.2, 6.2, -34], 4, 3, WALK);
  w.stairs(g, [5.5, 6.2, -34], playable ? [6.6, 10.45, -41.12] : [6.6, 11, -41.95], 1.8, WALK);
  w.floor(g, [5.8, 11, -43.08], 3.2, 2.28, WALK);
}

function vessel(w: Whitebox, playable: boolean, mirrorAlley: boolean): void {
  const ship = w.group();
  ship.position.set(-0.5, 10.95, -45);
  ship.rotation.set(0.018, -0.33, 0.036, 'YXZ');
  const stations = SHIP_STATIONS;
  const shell = (side: number, edge: number, [z, width, sheer]: readonly [number, number, number]): Point => [
    side * width * [1, 0.98, 0.81, 0.44][edge]!, [sheer + 0.65, sheer - 1.25, -7.7, -10.0][edge]!, z,
  ];
  const plate = [0x725859, STEEL, 0x594243] as const;
  for (const side of [1, -1]) {
    for (let i = 0; i < stations.length - 1; i++) {
      for (let band = 0; band < 3; band++) {
        if (shipOpening(side, i, band)) continue;
        const a = shell(side, band, stations[i]!), b = shell(side, band + 1, stations[i]!);
        const c = shell(side, band + 1, stations[i + 1]!), d = shell(side, band, stations[i + 1]!);
        const panel = surface(side > 0 ? quad(d, c, b, a) : quad(a, b, c, d));
        panel.userData.twoSided = true;
        w.shape(ship, panel, plate[band]!, [0, 0, 0], [1, 1, 1], true, undefined, !playable && !mirrorAlley);
        if (!playable && !mirrorAlley && band === 1) w.beam(ship, a, d, 0.13, 0x967374);
      }
    }
  }
  const stern = stations[0];
  const transom = surface(quad(shell(1, 0, stern), shell(1, 3, stern), shell(-1, 3, stern), shell(-1, 0, stern)));
  transom.userData.twoSided = true;
  w.shape(ship, transom, STEEL, [0, 0, 0], [1, 1, 1], true);
  w.floor(ship, [0, 0, -25.5], 5.95, 7.2, TIMBER);
  w.floor(ship, [0, 0, -21.5], 8.5, 2.7, TIMBER);
  w.floor(ship, [0, 0, -8], 12.9, 27, TIMBER);
  w.floor(ship, [0, 0, 17], 7.1, 17, TIMBER);
  w.floor(ship, [4.55, 0, 6], 3.8, 20, WALK);
  w.floor(ship, [-4.55, 0, 6], 3.8, 20, WALK);
  w.floor(ship, [0, -4.7, 0], 11.7, 31, WALK);
  w.floor(ship, [4.6, -4.7, 9], 3.8, 13, WALK);
  w.rail(ship, [2.65, 0, 6], [2.65, 0, 15.5], BEAM);
  w.rail(ship, [-2.65, 0, 6], [-2.65, 0, 15.5], BEAM);
  for (const z of [-14, -9, -4, 1, 6, 11]) {
    for (const x of [-3.9, 1.25]) {
      w.box(ship, [x, -3.86, z], [2.2, 0.15, 1.35], TIMBER, true);
      for (const sign of [-1, 1]) w.box(ship, [x + sign * 0.84, -4.27, z], [0.17, 0.87, 1.2], BEAM);
      for (let i = 0; i < 3; i++) w.box(ship, [x + (i - 1) * 0.62, -3.64, z], [0.52, 0.26, 0.86], 0x758a87);
    }
  }
  for (let i = 0; i < 6; i++) {
    const z = -19 + i * 3.2;
    w.box(ship, [-3.9, 0.42, z], [1.4, 0.84, 1.05], i % 2 ? TIMBER : 0x8d927f, true);
    w.box(ship, [0.8, 2.4, z], [5.9, 0.12, 2.65], i % 2 ? 0x8b8173 : 0x737b77);
    for (const x of [-2, 3.6]) w.box(ship, [x, 1.2, z], [0.12, 2.4, 0.12], BEAM);
  }
  const mast: Point = [0, 16.5, -0.5], boom: Point = [11.8, 10.2, 7.5];
  w.box(ship, [0, 0.35, -0.5], [2.8, 0.7, 2.8], STEEL, true);
  w.beam(ship, [0, 0.6, -0.5], mast, 0.54, BEAM);
  if (!playable) {
    w.beam(ship, [0, 8.2, -0.5], boom, 0.42, STEEL);
    w.beam(ship, mast, boom, 0.075, BEAM);
    w.beam(ship, boom, [11.8, -0.8, 7.5], 0.065, BEAM);
    w.box(ship, [11.8, -1.6, 7.5], [2.0, 1.3, 1.45], TIMBER);
  }
  if (playable || mirrorAlley) dressVessel(w, ship);
  w.shape(ship, new THREE.BoxGeometry(), 0x594f48, [-1.8, 1.5, -21], [4.2, 3, 5], true, undefined, !playable && !mirrorAlley);
  if (!playable && !mirrorAlley) {
    w.box(ship, [-1.8, 3.13, -21], [4.7, 0.3, 5.45], 0x826f65);
    w.box(ship, [-2.9, 4, -22.1], [0.68, 2.2, 0.68], STEEL);
    w.box(ship, [-2.9, 5.1, -22.1], [0.93, 0.2, 0.93], BEAM);
    w.box(ship, [0, 2.8, 24], [4.1, 0.3, 3], STEEL);
    w.beam(ship, [0, 1, 26], [0, 5.3, 26], 0.26, BEAM);
    w.beam(ship, [-1.7, 4.7, 26], [1.7, 4.7, 26], 0.16, BEAM);
  }
  w.floor(w.root, [-7.4, 11, -43], 10.8, 2.1, WALK);
  w.rail(w.root, [-12.8, 11, -42], [-3.8, 11, -42], BEAM);
  w.floor(w.root, [9.1, 11, -43], 7.4, 2.1, WALK);
  w.rail(w.root, [7.65, 11, -42], [12.4, 11, -42], BEAM);
  for (const x of [-11, 10.8]) w.beam(w.root, [x, 10.7, -43], [x * 1.45, 6.7, -43], 0.27, BEAM);
}

function house(w: Whitebox, x: number, y: number, z: number, side: number, variant: number, stilts = true, playable = false,
  cliffFootings = false): void {
  const h = w.group();
  h.position.set(x, y, z);
  h.rotation.y = side > 0 ? Math.PI : 0;
  const depth = 3.8 + (variant % 3) * 0.45, width = 3.2 + (variant % 2) * 0.8;
  const wall = [0x89735f, 0x9b8375, 0x937975, 0x7d8177][variant % 4]!;
  w.box(h, [0, -0.16, 0], [depth + 1.5, 0.31, width + 0.7], WALK, true);
  const height = 2.65 + (variant % 3) * 0.16;
  const face = depth / 2;
  w.box(h, [-0.3, height / 2, 0], [depth - 0.57, height, width], wall, true);
  w.box(h, [face - 0.11, height / 2, 0], [0.21, height, width], wall, true);
  const half = width / 2 + 0.22;
  const ridge = height + 1.05;
  const r1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.atan2(1.05, half));
  const r2 = r1.clone().invert();
  const roofDepth = Math.hypot(half, 1.05);
  w.orientedBox(h, [0, height + 0.5, -half / 2], [depth + 0.55, 0.16, roofDepth], variant % 2 ? 0x545a5a : 0x5a5050, r1);
  w.orientedBox(h, [0, height + 0.5, half / 2], [depth + 0.55, 0.16, roofDepth], variant % 2 ? 0x545a5a : 0x5a5050, r2);
  w.shape(h, surface([face, height, -half, face, ridge, 0, face, height, half]), wall, [0, 0, 0]);
  w.box(h, [face + 0.012, 1.06, -0.62], [0.045, 2.12, 0.87], BEAM);
  w.box(h, [face + 0.021, 1.69, 0.61], [0.055, 0.75, 0.83], 0x444e54);
  w.box(h, [face + 0.135, 2.62, 0.68], [0.20, 0.55, 1.12], BEAM);
  if (variant % 4 !== 1) w.box(h, [face + 0.25, 2.63, 0.68], [0.1, 0.37, 0.86], 0xbccfd3);
  if (playable) {
    const planks = [0x78665a, 0x8d7865, 0x8a7770, 0x696e65];
    for (let j = 0; j < Math.ceil(height / 0.19); j++) {
      const cy = j * 0.19 + 0.08;
      const color = planks[(j + variant * 3) % planks.length]!;
      for (const dir of [-1, 1]) {
        w.box(h, [0, cy, dir * (width / 2 + 0.02)], [depth + 0.05, 0.171, 0.079], color);
        if (cy > 2.18) w.box(h, [face + 0.006, cy, dir * 0.42 * width], [0.066, 0.173, width * 0.16], color);
        else {
          const start = dir === -1 ? -width / 2 : 1.05, end = dir === -1 ? -1.06 : width / 2;
          w.box(h, [face + 0.024, cy, (start + end) / 2], [0.072, 0.173, end - start], color);
        }
      }
    }
    for (const dir of [-1, 1]) {
      w.box(h, [face + 0.05, height / 2, dir * width / 2], [0.14, height, 0.15], BEAM);
      const rot = dir < 0 ? r1 : r2;
      for (let i = 0; i <= 8; i++) w.orientedBox(h,
        [(i - 4) * depth / 8, height + 0.59, dir * half / 2], [0.066, 0.058, roofDepth], BEAM, rot);
      w.beam(h, [face + 0.28, height - 0.015, dir * half], [face + 0.28, ridge + 0.04, 0], 0.16, BEAM);
    }
    w.beam(h, [-face - 0.28, ridge + 0.09, 0], [face + 0.3, ridge + 0.09, 0], 0.13, BEAM);
    w.box(h, [face + 0.07, 1.28, 0.61], [0.2, 0.085, 1.02], TIMBER);
    w.box(h, [face + 0.055, 1.7, 0.61], [0.11, 0.74, 0.073], TIMBER);
    if (variant % 4 !== 1) {
      const angle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.39);
      w.orientedBox(h, [face + 0.3, 2.66, 0.68], [0.085, 0.46, 0.94], 0x758e97, angle);
      w.orientedBox(h, [face + 0.352, 2.7, 0.68], [0.025, 0.227, 0.78], 0xd0e3e6, angle);
      w.beam(h, [face + 0.19, 2.38, 1.22], [face + 0.43, 2.7, 1.22], 0.084, BEAM);
    }
    if (stilts) {
      w.beam(h, [face + 0.33, -0.28, -width * 0.44], [face + 0.33, -3.65, width * 0.44], 0.19, TIMBER);
      w.beam(h, [face + 0.33, -0.28, width * 0.44], [face + 0.33, -3.65, -width * 0.44], 0.19, BEAM);
    }
  }
  if (!stilts) return;
  for (const a of [-1, 1]) {
    const zEdge = width * a * 0.44;
    w.box(h, [face + 0.35, -2.05, zEdge], [0.26, 4.1, 0.26], BEAM);
    w.beam(h, [face + 0.35, -0.2, zEdge], [-1.35, -3.15, zEdge], 0.21, TIMBER);
    if (cliffFootings) {
      const edge = face + 0.67;
      w.box(h, [(edge - 3) / 2, -4.39, zEdge], [edge + 3, 0.62, 0.88], 0x78858a);
      w.beam(h, [face + 0.36, -4.64, zEdge], [-3, -6.65, zEdge], 0.73, STONE);
    }
  }
}

function heights(w: Whitebox, playable: boolean, mirrorAlley: boolean): void {
  const g = w.root;
  const west = [[-16, 7, -27], [-16, 11, -47], [-16, 14, -67], [-17, 18, -57], [-16, 21, -81], [-17, 25, -47], [-18, 28, -68], [-17, 32, -57], [-17, 34, -32], [-19, 37, -78]] as const;
  const east = [[15, 5, -29], [15, 11, -42], [16, 15, -57], [15, 19, -66], [16, 19, -34], [16, 22, -49], [16, 27, -61], [17, 30, -77], [17, 34, -47], [18, 36, -65]] as const;
  west.forEach(([x, y, z], i) => house(w, x, y, z, -1, i, true, playable));
  east.forEach(([x, y, z], i) => house(w, x, y, z, 1, i + 2, true, playable, mirrorAlley && z === -34));
  const eastLanding: Point = [12.65, 15, -56];
  const openingHalfWidth = 1.2;
  for (const [x, y, z] of east) {
    const p = x - 2.4;
    w.floor(g, [p, y, z], 2, 7.1, TIMBER);
    const railX = p - 0.9;
    const entrance = y === 11 ? [-44.15, -41.85] : y === eastLanding[1]
      ? [eastLanding[2] - openingHalfWidth, eastLanding[2] + openingHalfWidth] : null;
    if (entrance) {
      w.rail(g, [railX, y, z - 3.5], [railX, y, entrance[0]!], BEAM);
      w.rail(g, [railX, y, entrance[1]!], [railX, y, z + 3.5], BEAM);
    } else {
      w.rail(g, [railX, y, z - 3.5], [railX, y, z + 3.5], BEAM);
    }
  }
  w.stairs(g, [11.7, 11, -43.5], eastLanding, 1.85, WALK, { endInset: openingHalfWidth });
  w.stairs(g, eastLanding, [12.35, 19, -62.45], 1.85, WALK, { startInset: openingHalfWidth });
  for (const [a, b] of TERRACES) {
    w.stairs(g, a, b, 1.9, WALK);
    w.floor(g, [-11.6, a[1], a[2] + (a[2] === -43 ? 1.05 : -1.05)], 4.45, 2.2, TIMBER);
    w.floor(g, [-11.6, b[1], b[2] + (b[2] === -43 ? 1.05 : -1.05)], 4.45, 2.2, TIMBER);
    for (const p of [a, b]) {
      w.beam(g, [p[0], p[1] - 0.2, p[2]], [-16, p[1] - 4, p[2]], 0.27, BEAM);
    }
  }
  for (const [x, y, z] of [[-14, 15, -65], [13, 16, -64], [13.5, 25, -55], [-15, 25, -71]] as const) {
    for (const side of [-1, 1]) w.box(g, [x, y, z + side * 0.21], [0.12, 4.6, 0.09], BEAM);
    for (let i = 0; i < 13; i++) w.box(g, [x - 0.04, y + i * 0.34 - 2.15, z], [0.12, 0.07, 0.45], WALK);
  }
  w.floor(g, [-15.7, 39, -41.1], 12.9, 3.0, WALK);
  w.floor(g, [-17.7, 39, -24.5], 6, 33.4, STONE);
  w.floor(g, [-20, 39, -9], 11.8, 13.0, STONE);
  w.rail(g, [-14.8, 39, -37], [-14.8, 39, -13], BEAM);
  house(w, -22, 39, -16, -1, 0, false, playable);
  w.box(g, [-18.35, 40.5, -17.15], [0.18, 1.7, 2.1], BEAM);
  w.box(g, [-18.22, 40.5, -17.15], [0.15, 1.48, 1.89], 0xbccfd3);
  const tank = new THREE.CylinderGeometry(1.45, 1.35, 2.0, 12);
  w.shape(g, tank, STEEL, [-22, 40, -9]);
  w.shape(g, new THREE.CylinderGeometry(1.37, 1.37, 0.09, 12), WATER, [-22, 41.02, -9]);
  w.beam(g, [-22, 41.05, -10.2], [-26, 42.1, -39], 0.22, WATER, 0.47);
  w.beam(g, [-26, 42.1, -39], [-27, 44, -106], 0.22, WATER, 0.47);
  for (const [x, z] of [[-22, -12], [-24, -30], [-27, -61], [-27, -94]] as const) {
    w.box(g, [x, 39.1, z], [0.35, 4, 0.35], BEAM);
  }
  const wheel = w.group();
  wheel.position.set(-1.7, 4.1, -109.7);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, b = a + Math.PI / 6;
    w.beam(wheel, [0, 0, 0], [2.25 * Math.cos(a), 2.25 * Math.sin(a), 0], 0.16, TIMBER);
    w.beam(wheel, [2.25 * Math.cos(a), 2.25 * Math.sin(a), 0], [2.25 * Math.cos(b), 2.25 * Math.sin(b), 0], 0.29, BEAM);
  }
}

function lighthouse(w: Whitebox, playable: boolean, station: boolean): void {
  const g = w.root, tx = -4, tz = 35, baseY = 14;
  const stack = new THREE.CylinderGeometry(4.8, 7.8, 15.7, 8);
  if (!playable) {
    w.shape(g, stack, ROCK, [tx, 6.1, tz], [1.1, 1, 1]);
    w.shape(g, new THREE.CylinderGeometry(4.25, 5.2, 4.6, 7), STONE, [tx, 11.5, tz]);
  }
  w.floor(g, [tx, baseY, 34.4], 7.1, 11.2, STONE);
  const point = (r: number, theta: number, y: number): Point => [tx + r * Math.cos(theta), y, tz + r * Math.sin(theta)];
  const shellBase = station ? 3.35 : 3.05;
  const shellCollider = station ? 'wall' : true;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, b = (i + 1) * Math.PI / 6;
    const a0 = point(shellBase, a, 14), b0 = point(shellBase, b, 14);
    const a1 = point(2.6, a, 32), b1 = point(2.6, b, 32);
    if (i === 8 || i === 9) {
      const radius = station ? THREE.MathUtils.lerp(shellBase, 2.6, 2.6 / 18) : 2.98;
      const a2 = point(radius, a, 16.6), b2 = point(radius, b, 16.6);
      w.shape(g, surface(quad(a2, a1, b1, b2)), WHITE, [0, 0, 0], [1, 1, 1], shellCollider, undefined, !playable);
    } else {
      w.shape(g, surface(quad(a0, a1, b1, b0)), i % 3 === 0 ? 0xb7c5c4 : WHITE, [0, 0, 0], [1, 1, 1], shellCollider, undefined, !playable);
    }
    w.beam(g, point(2.54, a, 32.1), point(2.54, a, 34.85), 0.16, BEAM);
    if (!station) w.shape(g, surface(quad(point(2.53, a, 32.4), point(2.53, a, 34.6), point(2.53, b, 34.6), point(2.53, b, 32.4))), 0x303d44, [0, 0, 0]);
  }
  if (playable) {
    const stone = [0x92958a, 0x828b86, 0x9ca29b, 0x767d75, 0x9b9181];
    const chunks = stone.map((): number[] => []);
    const n = 28;
    for (let row = 0; row < 36; row++) for (let i = 0; i < n; i++) {
      const theta = ((i + (row % 2) * 0.5) / n) * 2 * Math.PI;
      const a = theta + 0.011, b = theta + 2 * Math.PI / n - 0.011;
      if (row < 5 && theta > Math.PI * 1.34 && theta < Math.PI * 1.66) continue;
      const y = 14 + row * 0.5;
      const r = 3.07 - row * 0.0125 + 0.036 * Math.sin(row * 7.4 + i * 9.59);
      chunks[(row * 11 + i * 7) % stone.length]!.push(...quad(point(r, a, y), point(r - 0.012, a, y + 0.47),
        point(r - 0.012, b, y + 0.47), point(r, b, y)));
    }
    w.shape(g, new THREE.CylinderGeometry(2.58, 3.01, 18, 36), 0x535f61, [tx, 23, tz]);
    chunks.forEach((vertices, i) => w.shape(g, surface(vertices), stone[i]!, [0, 0, 0]));
    for (const [y, r] of [[14.13, 3.3], [16.13, 3.16], [31.73, 2.84], [32.1, 3.27], [34.93, 2.84]] as const) {
      w.shape(g, new THREE.CylinderGeometry(r, r + 0.06, 0.24, 24), y > 32 ? BEAM : stone[2]!, [tx, y, tz]);
    }
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, b = a + Math.PI / 12;
      w.beam(g, point(3.19, a, 32.14), point(3.19, a, 33.05), 0.057, BEAM);
      for (const y of [32.57, 33.05]) w.beam(g, point(3.19, a, y), point(3.19, b, y), 0.069, BEAM);
    }
    w.beam(g, point(0, 0, 35.4), point(0, 0, 37), 0.078, BEAM);
  }
  const fullSteps = 96, rise = 18 / fullSteps;
  const inner = 1.27, outer = 2.52, segments: number[] = [], guard: number[] = [], skirt: number[] = [];
  for (let i = 0; i < fullSteps; i++) {
    const turn = 6.5 * Math.PI / fullSteps;
    const a = -Math.PI / 2 + i * turn, b = a + turn, y = baseY + i * rise;
    segments.push(...quad(point(inner, a, y), point(inner, b, y + rise), point(outer, b, y + rise), point(outer, a, y)));
    if (station) {
      for (const radius of i === 0 ? [inner] : [inner, outer]) {
        const edgeA = point(radius, a, y), edgeB = point(radius, b, y + rise);
        const railA = point(radius, a, y + 0.88), railB = point(radius, b, y + rise + 0.88);
        if (radius === inner) {
          if (i === 0) skirt.push(...edgeA, ...edgeB, ...point(inner, b, baseY));
          else if (i < 10) skirt.push(...quad(point(inner, a, baseY), edgeA, edgeB, point(inner, b, baseY)));
        }
        w.beam(g, railA, railB, 0.076, BEAM);
        if ((radius === outer && i === 1) || i % 6 === 0) w.beam(g, edgeA, railA, 0.095, BEAM);
        if (i === fullSteps - 1) w.beam(g, edgeB, railB, 0.095, BEAM);
        guard.push(...quad(edgeA, railA, railB, edgeB));
      }
    }
  }
  const spiral = surface(segments);
  w.shape(g, spiral, WALK, [0, 0, 0], [1, 1, 1], true);
  if (station) {
    const plinth = surface(skirt);
    plinth.userData.twoSided = true;
    w.shape(g, plinth, WALK, [0, 0, 0], [1, 1, 1], 'wall');
    const lip = surface(guard);
    w.shape(g, lip, BEAM, [0, 0, 0], [1, 1, 1], 'wall', undefined, false);
    lip.dispose();
  }
  const gallery = new THREE.RingGeometry(2.54, 3.22, 12);
  gallery.rotateX(-Math.PI / 2);
  w.shape(g, gallery, BEAM, [tx, 32.12, tz], [1, 1, 1], true);
  w.floor(g, [tx + 1.15, 32, tz + 0.68], 2.35, 1.72, BEAM);
  w.shape(g, new THREE.ConeGeometry(3.22, 1.7, 12), station ? 0x365f5d : BEAM, [tx, 35.39, tz]);
  if (!station) {
    w.shape(g, new THREE.CylinderGeometry(0.59, 0.77, 1.55, 8), STEEL, [tx, 32.85, tz]);
    w.shape(g, new THREE.OctahedronGeometry(0.7), 0xa5bfc9, [tx, 33.8, tz], [1, 0.64, 1]);
  }

  for (const end of [CABLE_FROM, CABLE_TO]) {
    for (const offset of [-1.4, 1.4]) w.box(g, [end[0] + offset, end[1] + 2.25, end[2]], [0.36, 4.5, 0.36], BEAM);
    w.box(g, [end[0], end[1] + 4.3, end[2]], [3.4, 0.31, 0.35], BEAM);
  }
  for (const offset of [-0.45, 0.45]) {
    w.beam(g, [CABLE_FROM[0] + offset, CABLE_FROM[1] + 4.5, CABLE_FROM[2]],
      [CABLE_TO[0] + offset, CABLE_TO[1] + 4.5, CABLE_TO[2]], 0.085, BEAM);
  }
  if (station) return;
  for (const dx of [-0.82, 0.82]) for (const dz of [-0.78, 0.78]) {
    w.beam(g, [CABLE_FROM[0] + dx, CABLE_FROM[1], CABLE_FROM[2] + dz],
      [CABLE_FROM[0] + dx, CABLE_FROM[1] + 2, CABLE_FROM[2] + dz], 0.12, STEEL);
  }
  w.box(g, CABLE_FROM, [1.85, 0.26, 1.8], STEEL);
  w.box(g, [CABLE_FROM[0], CABLE_FROM[1] + 2, CABLE_FROM[2]], [1.92, 0.16, 1.9], STEEL);
  w.beam(g, [CABLE_FROM[0], CABLE_FROM[1] + 2.08, CABLE_FROM[2]], [-17, 43.35, -5], 0.12, BEAM);
}

export function buildVillage(physics: PhysicsSystem, playable = false, mirrorAlley = false, lighthouseStation = false): THREE.Group {
  const w = new Whitebox(physics);
  coast(w, playable, mirrorAlley || lighthouseStation);
  landing(w, playable);
  vessel(w, playable, mirrorAlley || lighthouseStation);
  heights(w, playable || mirrorAlley || lighthouseStation, mirrorAlley);
  if (lighthouseStation) {
    const tower = new Whitebox(physics, false);
    lighthouse(tower, playable, true);
    tower.finish();
    tower.root.name = TOWER_SHELL;
    w.root.add(tower.root);
  } else lighthouse(w, playable, false);
  for (const [x, y, z] of playable || mirrorAlley || lighthouseStation ? [] : [[5, 1.1, -10], [9, 2.5, -24], [-14, 15.2, -55], [-21, 40.5, -9], [-4, 33.8, 35]] as const) {
    w.shape(w.root, new THREE.OctahedronGeometry(0.25), MARK, [x, y, z]);
  }
  w.finish();
  return w.root;
}
