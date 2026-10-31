// 1031 #157：前景礁石挡人体贴合美术网格 —— 从 GLB LOD0 算水平轮廓（胶囊高度带 y 0–1.8 的切片点凸包，礁石局部、已缩放未旋转），
// 简化到 ≤ 20 个顶点（只删对面积影响 < 1 % 的点），再按世界 z ≥ 深水边界 + 胶囊直径 + 余量 截掉南沿（留可走缝）。
// 输出贴进 src/levels/s1/layout.ts 的 S1.foregroundRockHull。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/gen-s1-rock-hull.mjs [157]
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildLods } from '@/render/lod';
import { S1_ROCKS } from '@/levels/s1/rocks';
import { S1 } from '@/levels/s1/layout';
import { gameplay } from '@/config/gameplay';

globalThis.self ??= globalThis;
const ids = (process.argv[2] ?? '157').split(',').map(Number);
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };

export async function rockWorldTris(idx) {
  const r = S1_ROCKS[idx];
  const buf = readFileSync(new URL(`../../art/models/env/env-rock-shore-${r.rock}.glb`, import.meta.url));
  const gl = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  buildLods(gl.scene, () => {});
  gl.scene.updateMatrixWorld(true);
  let lod0 = null;
  gl.scene.traverse((o) => { if (!lod0 && o.isMesh && /_lod0/.test(`${o.name}|${o.parent?.name ?? ''}`)) lod0 = o; });
  const sc = Array.isArray(r.scale) ? r.scale : [r.scale, r.scale, r.scale];
  const inst = new THREE.Matrix4().compose(new THREE.Vector3(...r.translation), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rotationY), new THREE.Vector3(...sc));
  const a = lod0.geometry.getAttribute('position');
  const P = [];
  for (let k = 0; k < a.count; k++) P.push(new THREE.Vector3().fromBufferAttribute(a, k).applyMatrix4(lod0.matrixWorld).applyMatrix4(inst));
  return { P, index: lod0.geometry.index, r };
}

export function sliceXZ(P, index, y) {
  const out = [];
  for (let t = 0; t < index.count; t += 3) {
    const v = [P[index.getX(t)], P[index.getX(t + 1)], P[index.getX(t + 2)]];
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3];
      if ((p.y - y) * (q.y - y) < 0) { const s = (y - p.y) / (q.y - p.y); out.push([p.x + (q.x - p.x) * s, p.z + (q.z - p.z) * s]); }
    }
  }
  return out;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); // 逆时针（x 右、z 上）
}
const area = (h) => h.reduce((s, p, i) => s + cross([0, 0], p, h[(i + 1) % h.length]), 0) / 2;
function simplify(h, maxN) {
  h = [...h];
  while (h.length > maxN) {
    let best = -1, bestA = Infinity;
    for (let i = 0; i < h.length; i++) { const a = Math.abs(cross(h[(i - 1 + h.length) % h.length], h[i], h[(i + 1) % h.length])) / 2; if (a < bestA) { bestA = a; best = i; } }
    h.splice(best, 1);
  }
  return h;
}
/** 半平面裁剪：保留 f(p) ≥ 0 */
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa * fb < 0) { const s = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]); }
  }
  return out;
}

export const HULL_BAND = [0.0, 1.8];
export async function rockHull(idx) {
  const { P, index, r } = await rockWorldTris(idx);
  const pts = [];
  for (let y = HULL_BAND[0]; y <= HULL_BAND[1] + 1e-6; y += 0.05) pts.push(...sliceXZ(P, index, y));
  let h = simplify(hull(pts), 20);
  // 世界南沿：深水边界 z −8.95（x −10…12.5 段）+ 胶囊直径 + 余量
  const zMin = -8.95 + gameplay.player.radius * 2 + S1.rockDeepGapMargin + 0.01; // +1 cm：浮点 / 3 位小数取整后仍 ≥ 0.60
  h = clip(h, (p) => p[1] - zMin);
  // 世界 → 礁石局部（已缩放、未旋转：greybox 里 mesh.rotation.y = r.rotationY）
  const m = new THREE.Matrix4().makeRotationY(-r.rotationY);
  const local = h.map(([x, z]) => { const v = new THREE.Vector3(x - r.translation[0], 0, z - r.translation[2]).applyMatrix4(m); return [+v.x.toFixed(3), +v.z.toFixed(3)]; });
  return { world: h, local, area: area(h) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const idx of ids) {
    const { local, area: a, world } = await rockHull(idx);
    console.log(`#${idx} ${local.length} 点，面积 ${a.toFixed(2)} m²，世界 z ${Math.min(...world.map((p) => p[1])).toFixed(2)}…${Math.max(...world.map((p) => p[1])).toFixed(2)}`);
    console.log(`    ${idx}: [${local.map((p) => `[${p[0]}, ${p[1]}]`).join(', ')}],`);
  }
}
