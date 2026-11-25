import * as THREE from 'three';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { v, Whitebox } from './geometry';
import type { Point } from './layout';
import { LANTERN, RECEIVER, RELAY, type MirrorRelay } from './mirrorRelay';

const BRASS = 0xb98349, IRON = 0x35474b, RED = 0x8f4a37, TEAL = 0x286764, CREAM = 0xddd0a9;
const WOOD = [0x6d4940, 0x98785b, 0xa18d70] as const;
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
export const RELAY_BOARD: Point = [4.75, 11, -43.65];
const SIGNAL: Point = [-15.5, 41.15, -14.6];
const MOORINGS: readonly Point[] = [
  [14.2, 18.8, -55.4], [-13.9, 15.05, -45.3], [14.1, 23.05, -65.6], [-14.2, 21.45, -60.15],
];

function ribbing(w: Whitebox): void {
  const rock = new THREE.IcosahedronGeometry(1, 1);
  const colors = [0x4d6264, 0x50676c, 0x647575, 0x667879, 0x3c5258];
  for (const side of [-1, 1]) for (let i = 0; i < 25; i++) {
    const z = -27 - i * 3.19;
    const x = side * (19.9 + Math.sin(i * 7.15) * 1.35);
    const quilt = 0.5 + 0.5 * Math.cos(i * 5.4);
    for (let band = 0; band < 3; band++) {
      const tilt = new THREE.Quaternion().setFromAxisAngle(FRONT, side * (band * 0.09 - 0.22));
      w.shape(w.root, rock, colors[(i * 7 + band) % colors.length]!,
        [x + side * band * (side === -1 ? 1.75 : 0.4), 5.7 + band * 12 + quilt * 3, z + 0.45 * band],
        [3.7 + 1.8 * quilt, 8.4 + quilt * 2.4, 3.8 + quilt * 2.7], false, tilt);
    }
  }
}

function settlement(w: Whitebox): void {
  const g = w.root;
  const pail = new THREE.CylinderGeometry(0.33, 0.26, 0.58, 9);
  const ring = new THREE.TorusGeometry(0.33, 0.023, 5, 10);
  ring.rotateX(Math.PI / 2);
  for (const [side, x, y, from, to] of [[1, 14.2, 15, -59, -48], [1, 14.1, 19, -72, -63],
    [1, 14.4, 27, -67, -55], [-1, -14.5, 18, -64, -55], [-1, -15.1, 25, -52, -45],
    [-1, -15.4, 32, -64, -55], [1, 14.4, 30, -84, -75]] as const) {
    const edge = x - side * 0.75;
    w.box(g, [x, y - 0.19, (from + to) / 2], [1.55, 0.35, to - from], WOOD[0]);
    w.beam(g, [edge, y + 0.91, from], [edge, y + 0.91, to], 0.09, IRON);
    for (let z = from; z <= to; z += 2) {
      w.box(g, [edge, y + 0.45, z], [0.075, 0.94, 0.075], IRON);
      w.beam(g, [edge, y - 0.23, z], [x + 2.4 * side, y - 2.9, z], 0.18, RED);
    }
  }
  for (let i = 0; i < 26; i++) {
    w.box(g, [-12.7 + 0.402 * i, 11.008, -43], [0.389, 0.033, 2.06], WOOD[i % 3]!);
    if (i % 4 === 0) {
      const x = -12.7 + 0.402 * i;
      w.beam(g, [x, 10.8, -44.01], [x, 10.8, -41.99], 0.19, IRON);
    }
  }
  for (const [x, y, z] of [[-11.6, 18, -60.1], [-11.6, 25, -41.95], [-11.6, 32, -60.1],
    [-11.6, 39, -41.95], [13.3, 15, -53.8], [12.3, 19, -65.3], [-17.9, 39, -18.5]] as const) {
    w.box(g, [x, y - 0.2, z], [1.5, 0.18, 1.15], RED);
    w.beam(g, [x - 1.65, y - 3.95, z + 0.74], [x + 0.69, y - 0.35, z - 0.52], 0.25, WOOD[0]);
    w.beam(g, [x - 1.65, y - 3.95, z - 0.74], [x + 0.69, y - 0.35, z + 0.52], 0.25, WOOD[0]);
  }
  for (const [x, y, z] of [[-13.5, 18, -59.6], [-13.4, 25, -41.85], [13.25, 15, -59.35], [12.9, 19, -65.1],
    [-18.75, 39, -29], [2.45, 10.95, -44.2], [-9.35, 39, -43.9]] as const) {
    w.shape(g, pail, WOOD[0], [x, y + 0.29, z]);
    w.shape(g, ring, IRON, [x, y + 0.45, z]);
    w.shape(g, ring, IRON, [x, y + 0.18, z], [0.88, 1, 0.88]);
    w.box(g, [x - 0.52, y + 0.14, z - 0.16], [0.47, 0.23, 0.52], WOOD[2]);
  }
  for (const [x, y, z, side] of [[-13.8, 18.25, -58.9, -1], [-13.6, 24.5, -46.2, -1],
    [-13.95, 30.5, -57.4, -1], [12.7, 18, -56.9, 1], [12.4, 22, -67.6, 1],
    [13.6, 29.9, -61.9, 1], [14.8, 32.95, -77.6, 1]] as const) {
    const rack = w.group();
    rack.position.set(x, y, z);
    const inner = side * 1.6;
    w.beam(rack, [inner, 0.5, -1.7], [0, 0, -1.7], 0.11, IRON);
    w.beam(rack, [inner, 0.5, 1.7], [0, 0, 1.7], 0.11, IRON);
    w.beam(rack, [0, 0, -1.7], [0, 0, 1.7], 0.047, BRASS);
    for (let j = 0; j < 8; j++) {
      const sway = Math.sin(j * 1.6 + z);
      const angle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sway * 0.25);
      w.orientedBox(rack, [0.01 + sway * 0.1, -0.18, -1.41 + j * 0.403],
        [0.048, 0.42 + sway * 0.13, 0.28], [CREAM, RED, TEAL][j % 3]!, angle);
    }
  }
  w.box(g, [4.6, 11.74, -44.5], [1.75, 1.25, 0.18], WOOD[0], true);
  for (const x of [3.88, 5.32]) w.box(g, [x, 11.65, -44.58], [0.12, 1.42, 0.13], IRON);
  w.box(g, [4.6, 12.41, -44.49], [1.96, 0.12, 0.38], RED);
  w.box(g, [-15.5, 40.15, -14.6], [0.17, 2.3, 0.17], IRON);
  for (const x of [-0.19, 0.19]) w.box(g, [SIGNAL[0] + x, SIGNAL[1], SIGNAL[2]], [0.045, 0.43, 0.44], IRON);
  w.shape(g, new THREE.ConeGeometry(0.36, 0.18, 8), TEAL, [-15.5, 41.48, -14.6]);
}

function fixtures(w: Whitebox): void {
  const g = w.root;
  const ends = new THREE.CylinderGeometry(0.22, 0.3, 0.24, 12);
  for (const [i, mirror] of RELAY.entries()) {
    const base = MOORINGS[i]!;
    const [x, y, z] = mirror.center;
    const hook: Point = [x, y + 0.92, z];
    w.beam(g, base, hook, 0.19, IRON);
    w.beam(g, [base[0], base[1] - 0.95, base[2]], hook, 0.09, IRON);
    w.beam(g, hook, [x, y - 0.95, z], 0.095, BRASS);
    w.shape(g, ends, IRON, [x, y + 0.78, z]);
    if (!mirror.control) continue;
    const [cx, cy, cz] = mirror.control;
    const handle: Point = [cx + (x > 0 ? -0.53 : 0.57), cy + 0.91, cz - 0.15];
    w.beam(g, [handle[0], cy - 0.15, handle[2]], handle, 0.16, IRON);
    w.beam(g, handle, [x, y - 0.72, z], 0.075, IRON);
    w.shape(g, ends, TEAL, [handle[0], cy + 0.15, handle[2]]);
    w.shape(g, ends, BRASS, handle);
  }
  for (const x of [12.2, 14.6]) {
    w.beam(g, [x, 22.2, -83.25], [x, 28, -83.25], 0.23, IRON);
    w.beam(g, [x, 22.3, -83.25], [x + 2.4, 24.7, -83.25], 0.2, WOOD[0]);
  }
  w.box(g, [13.85, 26, -83.25], [3.9, 0.33, 3.7], WOOD[0]);
  w.box(g, [13.6, 28.15, -83.25], [4.1, 0.24, 4], TEAL);
  w.box(g, [14.7, 27.08, -84.94], [1.7, 2, 0.2], RED);
}

function plaque(text: string, at: Point, width: number, face = 0): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#253839';
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#c79661';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 492, 172);
  ctx.fillStyle = '#f7e4b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    ctx.font = `bold ${i === 0 ? 70 : 31}px sans-serif`;
    ctx.fillText(line, 256, lines.length === 1 ? 97 : i === 0 ? 72 : 141, 466);
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.375), new THREE.MeshBasicMaterial({ map }));
  mesh.position.copy(v(at));
  mesh.rotation.y = face;
  return mesh;
}

function glass(dark: number, glow: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: dark, roughness: 0.18, metalness: 0.18, emissive: glow, emissiveIntensity: 0.11 });
}

function harbourWater(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 world;
      void main() {
        world = (modelMatrix * vec4(position, 1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }
    `,
    fragmentShader: `
      varying vec3 world;
      void main() {
        float y = world.z;
        float x = world.x;
        float ripples = sin(9.1*y + 1.6*sin(1.4*x + y*.25)) * sin(y*3.7 - x*.44);
        float swell = .5 + .5*sin(y*.34 + sin(x*.37 + y*.08));
        float glint = smoothstep(.66, .99, ripples) * swell;
        float openSky = exp(-x*x*.008);
        vec3 water = mix(vec3(.039,.098,.109), vec3(.12,.23,.24), openSky);
        water += vec3(.084,.125,.13) * glint;
        float fog = 1. - exp(-.000098 * pow(distance(world, cameraPosition), 2.));
        gl_FragColor = vec4(mix(water, vec3(.34,.43,.45), fog), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(650, 650).rotateX(-Math.PI / 2), material);
  mesh.position.set(0, 0, -20);
  return mesh;
}

export class MirrorAlleyArt {
  readonly root = new THREE.Group();
  private readonly mirrors: THREE.Group[] = [];
  private readonly lenses: THREE.MeshStandardMaterial[] = [];
  private readonly beacon = glass(0xa69168, 0xffc05b);
  private readonly beams: THREE.Group[] = [];
  private readonly warm = new THREE.MeshBasicMaterial({ color: 0xffe2a3, transparent: true, opacity: 0.89, depthWrite: false });

  constructor(physics: PhysicsSystem) {
    const w = new Whitebox(physics);
    ribbing(w);
    settlement(w);
    fixtures(w);
    w.finish();
    this.root.add(w.root, harbourWater());
    this.root.add(plaque('镜巷\n雾号不响 · 莫登崖', [4.6, 11.82, -44.4], 1.65));
    const frame = new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.53, metalness: 0.4 });
    const back = new THREE.MeshStandardMaterial({ color: TEAL, roughness: 0.71 });
    const rim = new THREE.TorusGeometry(0.74, 0.085, 8, 20);
    const disc = new THREE.CircleGeometry(0.713, 24);
    const casing = new THREE.CylinderGeometry(0.756, 0.81, 0.18, 20).rotateX(Math.PI / 2);
    const bolt = new THREE.SphereGeometry(0.044, 6, 4);
    for (const { center } of RELAY) {
      const group = new THREE.Group();
      group.position.copy(v(center));
      const housing = new THREE.Mesh(casing, back);
      const lens = glass(0x8ba3a4, 0xffd88b);
      const front = new THREE.Mesh(disc, lens);
      front.position.z = 0.10;
      const border = new THREE.Mesh(rim, frame);
      border.position.z = 0.12;
      group.add(housing, front, border);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const mesh = new THREE.Mesh(bolt, frame);
        mesh.position.set(Math.cos(a) * 0.752, Math.sin(a) * 0.752, 0.19);
        group.add(mesh);
      }
      this.mirrors.push(group);
      this.lenses.push(lens);
      this.root.add(group);
    }
    const target = new THREE.Mesh(new THREE.SphereGeometry(0.58, 16, 10), this.beacon);
    target.scale.set(0.47, 1, 1);
    target.position.copy(v(RECEIVER));
    const signal = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), this.beacon);
    signal.position.copy(v(SIGNAL));
    const source = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), this.warm);
    source.position.copy(v(LANTERN));
    this.root.add(source, target, signal);
    const core = new THREE.CylinderGeometry(0.04, 0.065, 1, 7, 1, true);
    const halo = new THREE.CylinderGeometry(0.22, 0.36, 1, 9, 1, true);
    const mist = new THREE.MeshBasicMaterial({
      color: 0xffdc92, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i <= RELAY.length; i++) {
      const beam = new THREE.Group();
      beam.add(new THREE.Mesh(core, this.warm), new THREE.Mesh(halo, mist));
      this.beams.push(beam);
      this.root.add(beam);
    }
  }

  sync(puzzle: MirrorRelay, dt: number): void {
    const path = puzzle.trace();
    this.beacon.emissiveIntensity = path.received ? 2.1 : 0.12;
    const target = new THREE.Quaternion();
    for (const [i, mirror] of this.mirrors.entries()) {
      target.setFromUnitVectors(FRONT, puzzle.normal(i));
      mirror.quaternion.slerp(target, dt > 0 ? 1 - Math.exp(-dt * 14) : 1);
      this.lenses[i]!.emissiveIntensity = i < path.lit ? 1.15 : 0.09;
    }
    for (const [i, beam] of this.beams.entries()) {
      const a = path.points[i], b = path.points[i + 1];
      beam.visible = Boolean(a && b);
      if (!a || !b) continue;
      const delta = b.clone().sub(a);
      beam.position.copy(a).addScaledVector(delta, 0.5);
      beam.scale.y = delta.length();
      beam.quaternion.setFromUnitVectors(UP, delta.normalize());
    }
  }
}
