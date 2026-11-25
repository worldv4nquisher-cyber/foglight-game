import * as THREE from 'three';
import { InstancedLodSet, type InstancePlacement } from '@/render/instancedLod';
import { WET_LINE_GLSL, withTideLevel } from '@/render/tideUniforms';
import type { AssetLoader } from '@/assets/AssetLoader';
import type { Point } from './layout';

export const SHORE_ROCKS = ['env-rock-shore-b', 'env-rock-shore-d'] as const;
const { lerp, smoothstep } = THREE.MathUtils;

function hash(x: number, y: number, z: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, z: number): number {
  const a = Math.floor(x), b = Math.floor(y), c = Math.floor(z);
  const u = smoothstep(x - a, 0, 1), v = smoothstep(y - b, 0, 1), w = smoothstep(z - c, 0, 1);
  const row = (j: number, k: number) => lerp(hash(a, j, k), hash(a + 1, j, k), u);
  return lerp(lerp(row(b, c), row(b + 1, c), v), lerp(row(b, c + 1), row(b + 1, c + 1), v), w);
}

function fbm(x: number, y: number, z: number): number {
  return noise(x, y, z) * 0.57 + noise(x * 2.03 + 13, y * 2.03, z * 2.03) * 0.29
    + noise(x * 4.12, y * 4.12 + 8, z * 4.12) * 0.14;
}

function cliffSurface(point: (u: number, v: number) => Point, columns: number, rows: number, rear = false): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [], colors: number[] = [], uv: number[] = [];
  const shale = new THREE.Color(0x9ba39d), seam = new THREE.Color(0x495660);
  const lichen = new THREE.Color(0x697159), dark = new THREE.Color(0x374950), color = new THREE.Color();
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const [x, y, z] = point(i / columns, j / rows);
    const bed = (y + z * 0.115 + x * 0.08) / 2.4;
    const vein = smoothstep(bed - Math.floor(bed), 0.72, 0.99);
    const grain = fbm(x * 0.15, y * 0.22, z * 0.17);
    color.copy(shale).lerp(seam, Math.min(0.86, vein * 0.49 + grain * 0.49));
    color.lerp(lichen, smoothstep(noise(x * 0.34, y * 0.65, z * 0.19), 0.62, 0.89) * smoothstep(y, 4, 16) * 0.75);
    color.lerp(dark, (1 - smoothstep(y + grain, 1.4, 4.6)) * 0.8);
    vertices.push(x, y, z);
    colors.push(color.r, color.g, color.b);
    uv.push((rear ? x : z) / 6, (y + x * 0.24) / 6);
    if (i && j) {
      const d = j * (columns + 1) + i, c = d - 1, b = d - columns - 1, a = b - 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function headland(side: number): THREE.BufferGeometry {
  return cliffSurface((u, v) => {
    const z = lerp(14, -118, u);
    const nose = Math.exp(-(((z - 13) / 16) ** 2));
    const taper = smoothstep(u, 0, 0.23);
    const crest = 38 + Math.sin(z * 0.17 + side) * 3.2 + Math.sin(z * 0.061) * 2.5
      + (fbm(side * 1.3, 4.2, z * 0.23) - 0.5) * 13;
    const cap = Math.sin(v * Math.PI);
    const y = -4 + (crest + 4) * Math.pow(Math.max(0, cap), 0.62) * (0.14 + taper * 0.86);
    const bed = (y + z * 0.115) / 2.4;
    const breakoff = smoothstep(bed - Math.floor(bed), 0.67, 0.98);
    const fold = fbm(side * 9, y * 0.14, z * 0.11) - 0.5;
    const rib = Math.sin(z * 0.36 + y * 0.11 + side) * 1.15 + Math.sin(z * 0.67 - y * 0.19) * 0.68;
    const ledge = Math.exp(-(((y - (11 + 2 * Math.sin(z * 0.16))) / 2.3) ** 2)) * noise(side, 2, z * 0.16) * 2.4;
    const face = 14.2 + nose * 13 + 0.092 * y + fold * 5.4 + rib + breakoff * 0.98 - ledge;
    const outside = 37 + Math.sin(z * 0.13 + side) * 4 + Math.sin(z * 0.036) * 5 + fold * 7 + rib;
    const shoulder = smoothstep(v, 0.24, 0.78);
    return [side * lerp(face, outside, shoulder), y, z + (noise(side * 2, y * 0.13, z * 0.09) - 0.5) * 3];
  }, 106, 65);
}

function stack(center: Point, height: number, rx: number, rz: number, seed: number, capStart = 0.91): THREE.BufferGeometry {
  return cliffSurface((u, v) => {
    const angle = u * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
    const y = center[1] + height * v;
    const bed = (y + 0.7 * z) / 1.9;
    const radius = ((1 - v * 0.27) * (0.83 + 0.25 * fbm(x * 2 + seed, y * 0.23, z * 2))
      + Math.sin(angle * 5 + seed) * 0.055 - smoothstep(bed - Math.floor(bed), 0.8, 1) * 0.055)
      * (1 - smoothstep(v, capStart, 1));
    return [center[0] + x * rx * radius + v * 1.2, y + fbm(x + seed, 2, z) * 1.1 * (1 - v), center[2] + z * rz * radius];
  }, 44, 34, true);
}

export function addHarbourRock(parent: THREE.Group, assets: AssetLoader, rock: THREE.Texture | null,
  inner: { value: number }, outer: { value: number }): InstancedLodSet[] {
  const material = withTideLevel(new THREE.MeshStandardMaterial({
    map: rock, color: 0xe0e5dc, roughness: 0.88, vertexColors: true, side: THREE.DoubleSide,
  }), WET_LINE_GLSL, outer);
  for (const geo of [headland(-1), headland(1), stack([-4, -2.4, 35], 17, 8.1, 8, 4, 0.98),
    stack([-11, -2, -119], 42, 16, 11, 8), stack([10, -2, -121], 40, 17, 12, 15),
    stack([-25, 6, -18], 34, 9, 11, 11), stack([28, -3, -10], 29, 13, 15, 10)]) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  const sets: InstancedLodSet[] = [];
  for (const [index, key] of SHORE_ROCKS.entries()) {
    if (!assets.has(key)) continue;
    for (const basin of [false, true]) {
      const placements: InstancePlacement[] = [];
      for (const side of [-1, 1]) for (let i = 0; i < (basin ? 19 : 8); i++) {
        const t = hash(i, side, index);
        const z = basin ? -16 - i * 4.8 - t * 2 : -11 + i * 3.25 + t;
        const x = 14.4 + Math.exp(-(((z - 13) / 16) ** 2)) * 11 + t * 2.6;
        placements.push({ translation: [side * x, -0.88 - t * 0.8, z],
          rotationY: t * 6.28, scale: [2.4 + t * 3.5, 1.6 + t * 2.9, 2.5 + t * 3.8] });
      }
      const set = new InstancedLodSet(assets.getModel(key), placements, {
        name: `harbour-rock-${index}-${basin ? 'basin' : 'sea'}`,
        material: (m) => withTideLevel(m.clone(), WET_LINE_GLSL, basin ? inner : outer),
      });
      set.setDistances([8, 20, 61]);
      parent.add(set);
      sets.push(set);
    }
  }
  return sets;
}
