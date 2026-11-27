import * as THREE from 'three';
import { t } from '@/content/text';
import type { PhysicsSystem } from '@/systems/PhysicsSystem';
import { v, Whitebox } from './geometry';
import { CABLE_FROM, CABLE_TO, type Point } from './layout';
import { BALANCED_LOAD, PILOT, PORTS, PRISM, PRISM_CONTROL, WEIGHT_LIMIT, WINCH, type CableCar, type PrismSplitter } from './lighthousePuzzles';
import { harbourWater } from './mirrorAlleyArt';

const IRON = 0x364749, COPPER = 0x416764, BRASS = 0xc99256, RED = 0x994738, WOOD = 0x927352;
const STONE = [0x586970, 0x6e7c80, 0x7e8683, 0x5e7175] as const;
const UP = new THREE.Vector3(0, 1, 0), SOURCE = v(PRISM);
const DORMANT = 0x503323, WARM = 0xffb357, COOL = 0x79e9ff;

function station(w: Whitebox): void {
  const g = w.root;
  for (const z of [-7.85, -3.85]) for (const x of [-23.5, -18.7]) {
    w.box(g, [x, 40.54, z], [0.23, 3.08, 0.25], IRON, true);
    w.beam(g, [x, 40.9, z], [x + (x < -20 ? 0.8 : -0.8), 41.95, z], 0.15, WOOD);
  }
  w.box(g, [-21.1, 42.45, -5.85], [5.45, 0.22, 4.8], COPPER, true);
  for (let i = 0; i < 9; i++) w.beam(g, [-23.67 + i * 0.64, 42.58, -8.21], [-23.67 + i * 0.64, 42.58, -3.49], 0.07, IRON);
  for (let i = 0; i < 13; i++) {
    const z = -9.65 + i * 0.5;
    w.box(g, [-20.9, 39.005, z], [7.2, 0.024, 0.48], i % 3 === 0 ? 0x7a6050 : WOOD);
  }
  w.rail(g, [-24.5, 39, -3.05], [-18.25, 39, -3.05], IRON);
  w.rail(g, [-15.75, 39, -3.05], [-14.4, 39, -3.05], IRON);
  w.rail(g, [-14.4, 39, -3.05], [-14.4, 39, -8.45], IRON);
  for (const x of [-18.4, -15.6]) {
    w.box(g, [x, 41.35, -5], [0.63, 4.7, 0.62], COPPER);
    w.beam(g, [x, 40.12, -7.2], [x, 43.36, -5], 0.23, IRON);
    w.beam(g, [x, 41.1, -5], [-25.4, 40.05, -10.5], 0.049, IRON);
  }
  w.box(g, [-17, 43.2, -5], [3.7, 0.4, 0.59], COPPER);
  for (const [x, y, z] of [[-22, 41.02, -9], [CABLE_TO[0] - 1.4, 18.4, CABLE_TO[2]], [CABLE_TO[0] + 1.4, 18.4, CABLE_TO[2]]] as const) {
    w.shape(g, new THREE.CylinderGeometry(0.34, 0.34, 0.14, 16).rotateX(Math.PI / 2), BRASS, [x, y, z]);
  }
  for (const x of [-7.15, -0.85]) {
    w.rail(g, [x, 14, 29.1], [x, 14, 33.1], IRON);
    w.box(g, [x, 14.51, 30.3], [0.25, 1.02, 0.25], COPPER);
  }
  for (let i = 0; i < 9; i++) {
    w.box(g, [-4, 14.01, 29.05 + i * 0.37], [3.7, 0.03, 0.35], i % 2 === 0 ? WOOD : 0x745b4a);
  }
}

function coast(w: Whitebox): void {
  const rock = new THREE.IcosahedronGeometry(1, 1);
  const g = w.root;
  for (const side of [-1, 1]) for (let i = 0; i < 19; i++) {
    const z = 5 - i * 3.57;
    const x = side * (20.5 + 5 / (i + 1) + Math.sin(i * 3.04) * 1.7);
    w.shape(g, rock, STONE[i % 4]!, [x, 15 + Math.sin(i * 0.8) * 4, z], [4.1 + i % 3, 17.4, 4.4], false,
      new THREE.Quaternion().setFromAxisAngle(UP, i * 1.7));
  }
  for (let i = 0; i < 11; i++) {
    const a = i * 2 * Math.PI / 11;
    const dx = Math.cos(a), dz = Math.sin(a);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dz, 0, -dx), 0.23);
    w.shape(g, rock, STONE[i % 4]!, [-4 + dx * 5.1, 4.2 + Math.sin(i * 9.3) * 2, 35 + dz * 4.8], [3.12, 5.9 + i % 3, 3.01], false, tilt);
    w.shape(g, rock, 0x485960, [-4 + dx * 9.2, 0.15, 35 + dz * 9.5], [2.6, 1.1 + (i % 3) * 0.8, 2.2]);
  }
  const foam = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (let i = 0; i < 36; i++) {
    const a = i * Math.PI / 18;
    const r = 8.5 + 0.55 * Math.sin(9 * a) + (i % 3) * 0.7;
    w.shape(g, foam, [0x5c8081, 0x729698, 0x9bb5ac][i % 3]!, [-4 + r * Math.cos(a), 0.006 + i * 0.001, 35 + r * Math.sin(a)],
      [0.12 + 0.12 * (i % 3), 1, 0.8 + 0.34 * (i % 5)], false, new THREE.Quaternion().setFromAxisAngle(UP, -a));
  }
}

function tower(w: Whitebox): void {
  const g = w.root;
  const tx = -4, tz = 35;
  const point = (r: number, a: number, y: number): Point => [tx + r * Math.cos(a), y, tz + r * Math.sin(a)];
  for (const [y, radius] of [[14.13, 3.3], [17, 3.09], [22.9, 2.94], [28.7, 2.81], [31.92, 3.25], [34.97, 2.94]] as const) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      w.beam(g, point(radius, a, y), point(radius, a + Math.PI / 12, y), y > 31 ? 0.17 : 0.13, y > 31 ? COPPER : STONE[2]);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, b = a + Math.PI / 6;
    w.rail(g, point(3.15, a, 32.12), point(3.15, b, 32.12), IRON);
    for (const y of [32.46, 34.53]) w.beam(g, point(2.52, a, y), point(2.52, b, y), 0.065, BRASS);
  }
  w.shape(g, new THREE.CylinderGeometry(0.08, 0.14, 1.6, 8), IRON, [tx, 36.75, tz]);
  w.shape(g, new THREE.SphereGeometry(0.17, 10, 7), BRASS, [tx, 36.78, tz]);
  for (const x of [-5.42, -2.58]) {
    w.box(g, [x, 15.34, 32.2], [0.26, 2.68, 0.29], RED);
    w.box(g, [x, 16.52, 32.2], [0.37, 0.22, 0.43], BRASS);
  }
  w.box(g, [-4, 16.63, 32.2], [3.1, 0.24, 0.34], RED);
  w.shape(g, new THREE.CylinderGeometry(0.55, 0.73, 0.83, 12), IRON, [-4, 32.42, 35]);
  w.shape(g, new THREE.CylinderGeometry(0.65, 0.65, 0.12, 18), BRASS, [-4, 32.88, 35]);
  for (const [x, y, z] of PORTS) {
    w.shape(g, new THREE.CylinderGeometry(0.12, 0.27, 0.91, 10), IRON, [x, y - 0.47, z]);
    w.shape(g, new THREE.SphereGeometry(0.23, 14, 8), BRASS, [x, y, z]);
    w.beam(g, [x, y - 0.26, z], [-4, 32.72, 35], 0.055, BRASS);
  }
  w.box(g, [PRISM_CONTROL[0] - 0.28, 32.54, PRISM_CONTROL[2] - 0.42], [0.27, 0.84, 0.3], IRON);
  w.shape(g, new THREE.TorusGeometry(0.2, 0.034, 6, 16), BRASS, [PRISM_CONTROL[0] - 0.28, 32.97, PRISM_CONTROL[2] - 0.42]);
  for (let i = 0; i < 13; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 2;
    const y = 14.85 + i * 18 / 13;
    w.shape(g, new THREE.SphereGeometry(0.15, 8, 6), i % 2 === 0 ? BRASS : WOOD, point(2.43, a, y));
  }
}

function plaque(title: string, at: Point, width: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#313e3f';
  ctx.fillRect(0, 0, 512, 100);
  ctx.strokeStyle = '#b5956d';
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 500, 88);
  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = '#fff0cb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 256, 51, 480);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map, toneMapped: false }));
  label.position.copy(v(at));
  label.scale.set(width, width * 0.195, 1);
  return label;
}

function beam(color: number, radius: number, opacity = 0.78): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.62, 1, 10, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
}

function aim(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  const delta = end.clone().sub(start);
  mesh.position.copy(start).addScaledVector(delta, 0.5);
  mesh.scale.y = delta.length();
  mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
}

function lamp(color: number, radius: number): THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 9),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.13 }));
}

class TowerCutaway {
  private readonly focus = new THREE.Vector3();
  private readonly window = new THREE.Vector2();

  attach(root: THREE.Object3D, doubleSided = false): void {
    const materials = new Set<THREE.MeshStandardMaterial>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) materials.add(object.material);
    });
    for (const material of materials) {
      if (doubleSided) material.side = THREE.DoubleSide;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.towerFocus = { value: this.focus };
        shader.uniforms.towerWindow = { value: this.window };
        shader.fragmentShader = 'uniform vec3 towerFocus;\nuniform vec2 towerWindow;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
          #include <clipping_planes_fragment>
          if (towerFocus.z > 0.15 && vViewPosition.z < towerFocus.z + 0.04) {
            float t = max(vViewPosition.z / towerFocus.z, 0.01);
            vec2 offset = (-vViewPosition.xy / t - towerFocus.xy) / towerWindow;
            float rim = smoothstep(0.8, 1.08, length(offset));
            float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (rim < grain) discard;
          }
        `);
      };
    }
  }

  update(camera: THREE.Camera, player: THREE.Vector3, exploring: boolean): void {
    if (!exploring || !LighthouseArt.inTower(player)) {
      this.focus.z = 0;
      return;
    }
    if (player.y < 31.7) this.window.set(1.2, 1.25);
    else this.window.set(0.53, 1.02);
    this.focus.copy(player).y += 0.84;
    this.focus.applyMatrix4(camera.matrixWorldInverse).z *= -1;
  }
}

export class LighthouseArt {
  readonly root = new THREE.Group();
  readonly cutaway = new TowerCutaway();
  private readonly car: THREE.Group;
  private readonly weights: THREE.Group[] = [];
  private readonly needle = new THREE.Group();
  private readonly prism = new THREE.Group();
  private readonly colors = [WARM, COOL];
  private readonly beams = this.colors.map((color) => beam(color, 0.051));
  private readonly cups = this.colors.map((color) => lamp(color, 0.17));
  private readonly lens = lamp(DORMANT, 0.46);
  private readonly lensLight = new THREE.PointLight(WARM, 0, 10);
  private readonly outbound = new THREE.Group();

  static inTower(point: THREE.Vector3): boolean {
    return point.y >= 13.85 && point.y <= 33 && Math.hypot(point.x + 4, point.z - 35) < 3.4;
  }

  constructor(physics: PhysicsSystem) {
    const w = new Whitebox(physics);
    station(w);
    coast(w);
    const towerDetails = new Whitebox(physics);
    tower(towerDetails);
    towerDetails.finish();
    this.cutaway.attach(towerDetails.root);
    this.root.add(towerDetails.root);
    const cabin = new Whitebox(physics);
    const car = this.car = cabin.root;
    const panels: THREE.Mesh[] = [];
    const panel = (position: Point, size: Point) => {
      cabin.box(car, position, size, RED);
      const bounds = new THREE.Mesh(new THREE.BoxGeometry(...size));
      bounds.visible = false;
      bounds.position.copy(v(position));
      car.add(bounds);
      panels.push(bounds);
    };
    for (const side of [-1, 1]) {
      panel([side * 0.87, 0.36, 0], [0.11, 0.72, 1.92]);
      for (const z of [-0.9, 0.9]) cabin.box(car, [side * 0.86, 1.12, z], [0.11, 2.24, 0.11], IRON);
      cabin.beam(car, [side * 0.86, 2.2, 0], [0, 4.36, 0], 0.14, IRON);
      cabin.box(car, [side * 0.42, 4.45, 0], [0.16, 0.23, 0.63], BRASS);
    }
    cabin.box(car, [0, -0.09, 0], [1.84, 0.18, 1.98], WOOD);
    cabin.box(car, [0, 2.24, 0], [2.03, 0.19, 2.06], RED);
    panel([0, 0.37, 0.94], [1.65, 0.74, 0.11]);
    cabin.finish();
    car.position.copy(v(CABLE_FROM));
    car.rotation.y = Math.atan2(CABLE_TO[0] - CABLE_FROM[0], CABLE_TO[2] - CABLE_FROM[2]);
    for (const panel of panels) physics.addMesh(panel, { dynamic: true, blocksCamera: false, name: 'cable-car-panel' });

    const x = WINCH[0] - 1.1, z = WINCH[2];
    w.box(w.root, [x, 39.48, z], [1.12, 0.96, 2], IRON, true);
    w.box(w.root, [x + 0.08, 39.99, z], [1.28, 0.12, 2.11], WOOD);
    w.shape(w.root, new THREE.CylinderGeometry(0.55, 0.55, 0.12, 24).rotateX(Math.PI / 2), IRON, [x, 40.71, z + 0.17]);
    w.shape(w.root, new THREE.CylinderGeometry(0.49, 0.49, 0.12, 24).rotateX(Math.PI / 2), 0xd3bc97, [x, 40.71, z + 0.24]);
    w.beam(w.root, [x - 0.06, 40.92, z + 0.31], [x + 0.06, 40.92, z + 0.31], 0.053, 0x2e7466);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.028), new THREE.MeshStandardMaterial({ color: RED }));
    hand.position.y = 0.17;
    this.needle.add(hand);
    this.needle.position.set(x, 40.71, z + 0.325);
    for (let i = 0; i < WEIGHT_LIMIT; i++) {
      const weight = w.group();
      const mass = new THREE.Group();
      this.weights.push(mass);
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.38), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x73594b : 0x514a43 }));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.023, 6, 12), new THREE.MeshStandardMaterial({ color: BRASS }));
      handle.position.y = 0.13;
      mass.add(block, handle);
      mass.position.set(x, 40.2, z + 0.52);
      w.box(weight, [x - 0.33, 39.13, z + i * 0.47], [0.47, 0.26, 0.43], WOOD);
      this.root.add(mass);
    }
    w.finish();
    this.root.add(w.root, car, harbourWater(), this.needle, plaque(t('ch2.s3.plaque.aunt'), [-20.55, 41.65, -13.85], 1.7),
      plaque(t('ch2.s3.plaque.winch'), [-21.15, 42.03, -8.3], 3.05), plaque(t('ch2.s3.plaque.tower'), [-4, 17.27, 31.94], 2.1));

    const glass = new THREE.MeshStandardMaterial({ color: 0xc1faff, emissive: 0x5b9db5, emissiveIntensity: 0.34, metalness: 0.38, roughness: 0.14 });
    const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.78, 3).rotateZ(Math.PI / 2), glass);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.038, 7, 24), new THREE.MeshStandardMaterial({ color: BRASS, metalness: 0.45 }));
    this.prism.add(crystal, hoop);
    this.prism.position.copy(SOURCE);
    this.cups.forEach((cup, index) => cup.position.copy(v(PORTS[index]!)));
    this.lens.position.copy(v(PILOT)).y -= 0.06;
    this.lensLight.position.copy(this.lens.position);
    const feed = beam(0xfff2da, 0.039);
    aim(feed, v(PILOT), SOURCE);
    for (const to of [[7, 34, 78], [-4, 32.9, -14]] as const) {
      const ray = beam(0xffcb84, 0.81, 0.20);
      aim(ray, this.lens.position, v(to));
      this.outbound.add(ray);
    }
    this.root.add(this.prism, ...this.cups, ...this.beams, feed, this.lens, this.lensLight, this.outbound);
    for (const optic of [this.prism, ...this.cups, this.lens]) this.cutaway.attach(optic);
  }

  setCarPosition(position: THREE.Vector3): void {
    this.car.position.copy(position);
  }

  sync(cable: CableCar, splitter: PrismSplitter, position: THREE.Vector3): void {
    this.setCarPosition(position);
    this.needle.rotation.z = (BALANCED_LOAD - cable.load) * 0.33;
    const x = WINCH[0] - 1.1, z = WINCH[2];
    this.weights.forEach((weight, index) => {
      if (index < cable.load) weight.position.set(x, 40.16 + index * 0.194, z - 0.47);
      else weight.position.set(x - 0.33, 39.37, z + index * 0.47);
    });
    this.prism.rotation.set(0, (splitter.yaw - 4) * Math.PI / 13, (splitter.roll - 2) * Math.PI / 13, 'YXZ');
    splitter.trace().forEach(({ end, aligned }, index) => {
      aim(this.beams[index]!, SOURCE, end);
      this.cups[index]!.material.emissiveIntensity = aligned ? 2.3 : 0.13;
    });
    this.lens.material.emissive.setHex(splitter.lit ? 0xffca7b : DORMANT);
    this.lens.material.emissiveIntensity = splitter.lit ? 3.2 : 0.23;
    this.lensLight.intensity = splitter.lit ? 18 : 0;
    this.outbound.visible = splitter.lit;
  }
}
