import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AssetLoader } from '@/assets/AssetLoader';
import { manifest, type AssetEntry } from '@/assets/manifest';
import { withTideLevel, WET_LINE_GLSL } from '@/render/tideUniforms';
import { SKY_CLOUDS_KEY } from '@/world/SkyDome';
import { Water, WATER_NORMAL_KEY, RAIN_RIPPLE_KEY } from '@/world/Water';
import {
  BOAT_FROM, BOAT_TO, CRANE_MAST, CRATE_HEIGHT, CRATE_PICKUP, HIGH_WATER, WATER_SEAM,
  type HarbourPuzzles,
} from './harbour';
import { v } from './geometry';
import type { Point } from './layout';
import { addHarbourRock, SHORE_ROCKS } from './harbourRock';
import { hullPoint } from './harbourVessel';
import { harbourAssetPaths } from './harbourAssetPaths';

const KIT = 'prop-harbour-kit-ch2-s1';
const WOOD = 'ch2-s1-quay-wood';
const ROCK = 'ch2-s1-cliff-rock';
const PROPS = ['prop-boat-rowboat', 'prop-crate-a', 'prop-barrel-a', 'prop-rope-coil-a', 'prop-net-pile-a', 'prop-buoy-a'];
const CUES = ['sfx-gate-open', 'sfx-valve-turn', 'sfx-raft-float', 'sfx-raft-lock', 'amb-waves-near', 'amb-rain-light', 'amb-wind-soft'];
export const HARBOUR_ASSETS: AssetEntry[] = [
  ...manifest.filter((e) => PROPS.includes(e.key) || CUES.includes(e.key) || SHORE_ROCKS.some((key) => key === e.key)
    || e.key.startsWith('char-xi') || e.key.startsWith('tex-xi')
    || [WATER_NORMAL_KEY, RAIN_RIPPLE_KEY, SKY_CLOUDS_KEY, 'lut-overcast-after-rain', 'tex-rain-streak-albedo', 'tex-rain-splash-albedo'].includes(e.key)),
  { key: KIT, type: 'gltf', url: harbourAssetPaths.kit, group: 'dev' },
  { key: WOOD, type: 'ktx2', url: harbourAssetPaths.wood, group: 'dev' },
  { key: ROCK, type: 'ktx2', url: harbourAssetPaths.rock, group: 'dev' },
];

const CHALK = '#dce0cb';
export const MARKET_LINES = [
  '裂湾村 · 北鲱号鱼市',
  '撤离去向　　齐家：南岛',
  '周家：投青屿姨母　苇婶：南岛',
  '借苇婶的备用棱镜，去外礁。',
] as const;
export const NOTICE_LINES = ['航运所 · 冬季通告', '灯标停用，即日起停止入港。', '顺序登船，带走随身行李。'] as const;

function lettering(lines: readonly string[], width: number, height: number, ink = CHALK, paper?: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(128, Math.round(1024 * height / width));
  const ctx = canvas.getContext('2d')!;
  if (paper) {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pitch = canvas.height / (lines.length + 0.42);
  for (const [i, line] of lines.entries()) {
    ctx.font = `${i === 0 ? 'bold ' : ''}${Math.round(pitch * 0.59)}px "Noto Sans CJK SC", sans-serif`;
    ctx.fillText(line, canvas.width / 2, pitch * (i + 0.72), canvas.width * 0.91);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
    map, transparent: !paper, alphaTest: 0.2, side: THREE.DoubleSide, toneMapped: false,
  }));
}

const timber = 0x716255, black = 0x364345, paint = 0x934f39, iron = 0x514d48, rope = 0x9b8765;
const unitBox = new THREE.BoxGeometry();

function box(parent: THREE.Object3D, p: Point, size: Point, color: number, material?: THREE.MeshStandardMaterial): THREE.Mesh {
  const result = new THREE.Mesh(unitBox, material ?? new THREE.MeshStandardMaterial({ color, roughness: 0.87 }));
  result.scale.copy(v(size));
  result.position.copy(v(p));
  parent.add(result);
  return result;
}

function batchBoxes(parent: THREE.Object3D, moving: readonly THREE.Object3D[] = []): void {
  const batches = new Map<string | number, Array<THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>>();
  for (const mesh of parent.children) {
    if (!(mesh instanceof THREE.Mesh) || mesh.geometry !== unitBox || moving.includes(mesh)) continue;
    const boxMesh = mesh as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    const mat = boxMesh.material;
    const key = mat.onBeforeCompile === THREE.Material.prototype.onBeforeCompile ? mat.color.getHex() : mat.uuid;
    const batch = batches.get(key) ?? [];
    batch.push(boxMesh);
    batches.set(key, batch);
  }
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const material = meshes[0]!.material;
    const group = new THREE.InstancedMesh(unitBox, material, meshes.length);
    meshes.forEach((mesh, i) => {
      mesh.updateMatrix();
      group.setMatrixAt(i, mesh.matrix);
      if (mesh.material !== material) mesh.material.dispose();
    });
    parent.remove(...meshes);
    parent.add(group);
  }
}

function beam(parent: THREE.Object3D, a: Point, b: Point, width: number, color: number): THREE.Mesh {
  const d = v(b).sub(v(a));
  const m = box(parent, v(a).addScaledVector(d, 0.5).toArray(), [width, d.length(), width], color);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function at(parent: THREE.Object3D, obj: THREE.Object3D, p: Point, yaw = 0): void {
  obj.position.copy(v(p));
  obj.rotation.y = yaw;
  parent.add(obj);
}

function cord(points: readonly Point[], width: number): THREE.TubeGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v)), (points.length - 1) * 3, width, 4);
}

function rigging(parent: THREE.Group): void {
  const lines: THREE.BufferGeometry[] = [];
  for (const [a, b] of [
    [[6.99, 2.81, -5.22], [5.12, 1.86, -5.77]], [[7.1, 2.8, -12.09], [6.1, 1.78, -10.39]],
    [[10.96, 2.78, -21.98], [10.82, 2.77, -28.59]], [[6.99, 2.75, -5.25], [6.69, 2.9, -9.15]],
  ] as const) {
    const middle = v(a).lerp(v(b), 0.5);
    middle.y -= 0.32;
    lines.push(cord([a, middle.toArray(), b], 0.033));
  }
  for (const [x, z, length] of [[6.65, -9.1, 2.1], [11.43, -6.35, 2.22], [11.46, -26.7, 2.55]] as const) {
    const across = (u: number, t: number): Point => [
      x + 0.24 * Math.sin(t * Math.PI) + 0.19 * t, 2.89 - t * (0.98 + u * 0.26) + Math.sin(u * Math.PI * 2) * 0.06, z + u * length,
    ];
    for (let i = 0; i <= 16; i++) lines.push(cord([across(i / 16, 0), across(i / 16, 0.53), across(i / 16, 1)], 0.011));
    for (let i = 0; i <= 7; i++) lines.push(cord([across(0, i / 7), across(0.5, i / 7), across(1, i / 7)], i ? 0.01 : 0.027));
  }
  const combined = mergeGeometries(lines);
  if (combined) parent.add(new THREE.Mesh(combined, new THREE.MeshStandardMaterial({ color: 0x8c7a57, roughness: 0.96 })));
  for (const line of lines) line.dispose();
}

export class HarbourArt {
  readonly root = new THREE.Group();
  readonly boat = new THREE.Group();
  private readonly gate = new THREE.Group();
  private readonly crate = new THREE.Group();
  private readonly boom = new THREE.Group();
  private readonly trolley = new THREE.Group();
  private readonly hoist: THREE.Mesh;
  private readonly counterweight: THREE.Mesh;
  private readonly counterChain: THREE.Mesh;
  private readonly water: Array<{ mesh: Water; inner: boolean }> = [];
  private readonly innerY = { value: HIGH_WATER };
  private readonly outerY = { value: HIGH_WATER };
  private readonly rocks: ReturnType<typeof addHarbourRock>;
  private gateTravel = 0;
  private weightTravel = 0;

  constructor(assets: AssetLoader, village: THREE.Group) {
    const tiled = (key: string): THREE.Texture | null => {
      if (!assets.has(key)) return null;
      const texture = assets.getTexture(key).clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      return texture;
    };
    const wood = tiled(WOOD), rock = tiled(ROCK);
    this.rocks = addHarbourRock(this.root, assets, rock, this.innerY, this.outerY);
    for (const object of village.children) {
      if (!(object instanceof THREE.InstancedMesh) || !(object.material instanceof THREE.MeshStandardMaterial)
        || !(object.geometry instanceof THREE.BufferGeometry)) continue;
      if (wood && object.geometry instanceof THREE.BoxGeometry && [0x786f60, 0x887967, 0x958371, 0x6b6157, 0xa99a84, 0x776758].includes(object.material.color.getHex())) {
        object.material.map = wood;
        object.material.color.lerp(new THREE.Color(0xe0d1bb), 0.72);
      }
    }
    const kit = assets.has(KIT) ? assets.getModel(KIT) : new THREE.Group();
    const kitAt = (key: string, p: Point, yaw = 0): void => {
      const part = kit.getObjectByName(key)?.clone(true);
      if (part) at(this.root, part, p, yaw);
    };
    const prop = (key: string, parent: THREE.Object3D, p: Point, yaw = 0, scale = 1): void => {
      if (!assets.has(key)) return;
      const model = assets.getModel(key);
      model.scale.multiplyScalar(scale);
      at(parent, model, p, yaw);
    };

    for (const p of [[7, 2, -5.2], [7.12, 2, -12.1], [10.9, 2, -12.65], [7, 2, -22.35], [10.9, 2, -21.95], [10.8, 2, -28.6]] as const) {
      kitAt('harbour-mooring', p, Math.PI / 3);
    }
    kitAt('harbour-net-rack', [10.65, 2, -6.35], -0.87);
    kitAt('harbour-net-rack', [11, 2, -26.8], -Math.PI / 2);
    for (const p of [[10.6, 2, -7.5], [10.9, 2, -24.3], [11.14, 2, -24.85], [2.6, 6.25, -34.8], [-1.7, 6.3, -40], [4.1, 11.2, -45.1]] as const) {
      kitAt('harbour-fish-basket', p);
    }
    prop('prop-rope-coil-a', this.root, [7.45, 2.025, -12.1], 1.2);
    prop('prop-net-pile-a', this.root, [10.3, 2.045, -6.8], -0.9);
    prop('prop-net-pile-a', this.root, [11, 2, -30.25], 1.2);
    prop('prop-barrel-a', this.root, [10.75, 2.025, -29.65], 0.6);
    prop('prop-crate-a', this.root, [11.1, 2.03, -28.5], -0.3);
    prop('prop-buoy-a', this.root, [7, 2.065, -9.15], 0.3);
    prop('prop-boat-rowboat', this.root, [4.98, 1.39, -7.6], -0.17, 0.88);
    prop('prop-buoy-a', this.root, [6.08, 1.46, -10.42], -0.5);
    prop('prop-barrel-a', this.root, [10.76, 2.03, -5.32], -0.48);
    prop('prop-barrel-a', this.root, [1.4, 6.24, -34.91], 0.3);
    prop('prop-crate-a', this.root, [10.84, 2.03, -4.61], 0.19);
    prop('prop-crate-a', this.root, [10.76, 2.65, -4.59], -0.1, 0.8);
    prop('prop-crate-a', this.root, [11.18, 2.62, -28.47], 0.05, 0.82);
    prop('prop-crate-a', this.root, [2.34, 6.24, -36.55], 0.36);
    prop('prop-net-pile-a', this.root, [1.7, 11.12, -44.55], -0.1);
    prop('prop-rope-coil-a', this.root, [11.04, 2.043, -8.95], -0.1);
    rigging(this.root);
    prop('prop-rope-coil-a', this.root, [2.95, 6.22, -34.95], 0.9, 1.22);
    beam(this.root, [2.95, 6.3, -34.95], [3.04, 7.13, -35.23], 0.041, rope);

    kitAt('harbour-checkboard', [3.02, 6.2, -35.03], 0.02);
    at(this.root, lettering(MARKET_LINES, 1.28, 0.64), [3.02, 7.46, -34.96], 0.02);
    at(this.root, lettering(NOTICE_LINES, 0.91, 0.60, '#333c3b', '#cdc0a1'), [4.27, 7.46, -35.10]);
    beam(this.root, [3.8, 6.21, -35.14], [3.8, 8.12, -35.14], 0.11, iron);
    beam(this.root, [4.78, 6.21, -35.14], [4.78, 8.12, -35.14], 0.11, iron);
    const hull = new THREE.Group();
    hull.position.set(-0.5, 10.95, -45);
    hull.rotation.set(0.018, -0.33, 0.036, 'YXZ');
    this.root.add(hull);
    const [hx, hy, hz] = hullPoint(1, 19.7, 0.128);
    at(hull, lettering(['北 鲱 号'], 3.45, 0.76, '#c8c7aa'), [hx + 0.11, hy, hz], 1.32);
    at(this.root, lettering(['内港鱼闸', '初退封闸　留水入港'], 1.35, 0.78, '#e0d6b3', '#384740'), [7.18, 3.1, -10.64], 0.37);
    at(this.root, lettering(['北鲱鱼市 →'], 1.28, 0.43, '#dfd4b5', '#6e5142'), [10.3, 2.88, -24], 0.28);

    const wetSlats = [0x7a6655, 0x95816b].map((color) => withTideLevel(
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }), WET_LINE_GLSL, this.outerY));
    for (let i = 0; i <= 29; i++) {
      const x = -13 + i * 0.71;
      if (x > 3.7 && x < 6.1) continue;
      const y = 0.64 + Math.sin(i * 0.99) * 0.075;
      beam(this.root, [x, -0.82, WATER_SEAM + 0.14], [x, 1.98 + (i % 3) * 0.10, WATER_SEAM + 0.02], 0.21, timber);
      box(this.root, [x - 0.25, y, WATER_SEAM + 0.02], [0.32, 2.5, 0.14], timber, i % 3 ? wetSlats[0] : wetSlats[1]);
    }
    for (const x of [-11.8, -7.9, -4, 0, 3.69, 6.06]) {
      beam(this.root, [x, 2.06, WATER_SEAM - 0.01], [x + 0.56, -0.48, WATER_SEAM - 1.0], 0.23, timber);
    }
    for (const y of [0.72, 1.82]) {
      beam(this.root, [-13.2, y, WATER_SEAM - 0.05], [3.75, y, WATER_SEAM - 0.05], 0.21, timber);
      beam(this.root, [6.0, y, WATER_SEAM], [7.65, y, WATER_SEAM], 0.21, timber);
    }
    for (const x of [3.79, 5.99]) {
      box(this.root, [x, 1.55, WATER_SEAM], [0.24, 4.9, 0.34], black);
    }
    box(this.root, [4.89, 3.9, WATER_SEAM], [2.45, 0.22, 0.35], iron);
    for (let i = 0; i < 7; i++) box(this.gate, [4.04 + i * 0.28, 1.02, WATER_SEAM], [0.269, 2.84, 0.17], i % 2 ? timber : 0x82705f);
    for (const y of [0.16, 1.58]) box(this.gate, [4.9, y, WATER_SEAM + 0.11], [1.99, 0.15, 0.07], iron);
    this.root.add(this.gate);
    this.gate.position.y = 1.92;
    for (const z of [WATER_SEAM + 0.66, WATER_SEAM - 0.67]) {
      const level = z < WATER_SEAM ? this.innerY : this.outerY;
      const wet = withTideLevel(new THREE.MeshStandardMaterial({ color: 0x8c8376, roughness: 0.84, map: wood }), WET_LINE_GLSL, level);
      const marks = withTideLevel(new THREE.MeshStandardMaterial({ color: 0xd7c8a2, roughness: 0.84 }), WET_LINE_GLSL, level);
      box(this.root, [6.49, 0.77, z], [0.32, 2.82, 0.32], timber, wet);
      for (let i = 0; i < 10; i++) {
        box(this.root, [6.319, 0.1 + i * 0.18, z], [0.014, 0.027, i % 3 ? 0.12 : 0.24], timber, marks);
      }
    }
    box(this.root, [8.02, 2.49, -11.17], [0.33, 0.94, 0.39], iron);
    beam(this.root, [8.04, 2.93, -11.19], [8.58, 3.17, -11.19], 0.068, paint);
    beam(this.root, [8.0, 2.67, -11.23], [6.03, 3.18, WATER_SEAM], 0.045, iron);

    this.root.add(this.boat);
    prop('prop-boat-rowboat', this.boat, [0, -0.13, 0], Math.PI, 0.83);
    if (!this.boat.children.length) {
      box(this.boat, [0, -0.10, 0], [1.27, 0.26, 2.75], timber);
      for (const sign of [-1, 1]) box(this.boat, [sign * 0.68, 0.1, 0], [0.12, 0.38, 2.7], black);
    }
    this.boat.position.set(9, HIGH_WATER, BOAT_FROM);

    this.root.add(this.crate);
    for (let i = 0; i < 5; i++) box(this.crate, [0, CRATE_HEIGHT / 2, -0.49 + i * 0.245], [1.37, CRATE_HEIGHT - 0.04, 0.23], i % 2 ? 0x8d7560 : 0xa1876c);
    for (const x of [-0.58, 0.58]) box(this.crate, [x, CRATE_HEIGHT - 0.024, 0], [0.13, 0.046, 1.26], 0x56524b);
    for (const z of [-0.61, 0.61]) box(this.crate, [0, CRATE_HEIGHT * 0.55, z], [1.42, 0.13, 0.06], paint);
    this.crate.position.copy(v(CRATE_PICKUP));
    at(this.root, this.boom, CRANE_MAST);
    beam(this.boom, [0, 0, -1.45], [0, 0, 20.9], 0.29, iron);
    beam(this.boom, [0, 0.9, 0], [0, 0.26, 20.9], 0.13, paint);
    beam(this.boom, [0, 7.35, 0], [0, 0.14, 20.5], 0.07, rope);
    for (let j = 1; j < 11; j++) {
      const z = j * 1.9;
      beam(this.boom, [0, 0, z - 1.7], [0, 0.9 - z * 0.029, z], 0.085, iron);
    }
    box(this.trolley, [0, -0.18, 0], [0.53, 0.39, 0.52], paint);
    this.boom.add(this.trolley);
    this.hoist = box(this.trolley, [0, -0.5, 0], [0.055, 1, 0.055], rope);
    box(this.root, [10.76, 2.57, -23.02], [0.35, 1.14, 0.44], black);
    beam(this.root, [10.68, 3.47, -23.07], [10.23, 3.65, -23.07], 0.087, iron);
    this.counterweight = box(this.root, [10.43, 3.03, -23.07], [0.43, 0.49, 0.41], paint);
    this.counterChain = box(this.root, [10.43, 3.43, -23.07], [0.036, 1, 0.036], iron);
    box(this.root, [7.18, 2.54, -25.25], [0.34, 1.0, 0.41], iron);
    beam(this.root, [7.19, 2.97, -25.23], [7.65, 3.22, -25.23], 0.085, paint);

    const addWater = (inner: boolean, x: number, z: number, width: number, depth: number): void => {
      const mesh = new Water(1, inner ? 38 : 55, inner ? 0x284e4c : 0x344d5b, inner ? 0.2 : 0.36);
      mesh.geometry.scale(width, 1, depth);
      mesh.position.set(x, HIGH_WATER, z);
      mesh.setDetail(assets.has(WATER_NORMAL_KEY) ? assets.getTexture(WATER_NORMAL_KEY) : null,
        assets.has(RAIN_RIPPLE_KEY) ? assets.getTexture(RAIN_RIPPLE_KEY) : null);
      this.root.add(mesh);
      this.water.push({ mesh, inner });
    };
    addWater(false, 0, WATER_SEAM + 162, 650, 324);
    addWater(false, -173, WATER_SEAM - 155, 302, 310);
    addWater(false, 173, WATER_SEAM - 155, 302, 310);
    addWater(true, 0, WATER_SEAM - 155, 44, 310);
    batchBoxes(this.root, [this.counterweight, this.counterChain]);
    batchBoxes(this.gate);
    batchBoxes(this.crate);
    batchBoxes(this.boom);
  }

  updateRockLod(camera: THREE.Camera): void {
    for (const set of this.rocks) set.update(camera);
  }

  sync(state: HarbourPuzzles, dt: number): void {
    this.innerY.value = state.inner.level;
    this.outerY.value = state.outer.level;
    for (const { mesh, inner } of this.water) {
      mesh.position.y = inner ? state.inner.level : state.outer.level;
      mesh.update(dt);
    }
    this.gateTravel = THREE.MathUtils.damp(this.gateTravel, Number(state.gateClosed), 6, dt);
    this.gate.position.y = 1.92 * (1 - this.gateTravel);
    this.boat.position.y = state.inner.level + 0.025 * Math.sin(state.boatProgress * Math.PI * 5);
    this.boat.position.z = THREE.MathUtils.lerp(BOAT_FROM, BOAT_TO, THREE.MathUtils.smoothstep(state.boatProgress, 0, 1));
    this.crate.position.copy(state.crate);
    const dx = state.crate.x - CRANE_MAST[0], dz = state.crate.z - CRANE_MAST[2];
    this.boom.rotation.y = Math.atan2(dx, dz);
    this.trolley.position.z = Math.hypot(dx, dz);
    const cableLength = CRANE_MAST[1] - state.crate.y - CRATE_HEIGHT;
    this.hoist.scale.y = cableLength;
    this.hoist.position.y = -cableLength / 2;
    this.weightTravel = THREE.MathUtils.damp(this.weightTravel, Number(state.crane !== 'unweighted'), 4, dt);
    this.counterweight.position.y = 3.03 - 0.66 * this.weightTravel;
    this.counterChain.scale.y = 0.3 + 0.66 * this.weightTravel;
    this.counterChain.position.y = 3.55 - this.counterChain.scale.y / 2;
  }
}
