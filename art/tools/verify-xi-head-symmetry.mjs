#!/usr/bin/env node
// r2：汐头部左右镜像误差（游戏实际加载的 GLB，three.js 蒙皮到静止姿势后的世界坐标）
//   对每级 LOD 的脸 primitive（mat-char-xi-face：头 + 耳）：顶点 x → −x 后找最近顶点的距离（max / mean），三角形重心同样算一遍（检查三角化对角线也镜像）。
// 用法：node art/tools/verify-xi-head-symmetry.mjs [glb]   （默认 art/models/characters/char-xi.glb）
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const THREE = await import(path.resolve(HERE, '../../game/node_modules/three/build/three.module.js'));
const { GLTFLoader } = await import(path.resolve(HERE, '../../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const file = process.argv[2] ?? path.resolve(HERE, '../models/characters/char-xi.glb');
const doc = await io.read(file);
for (const t of doc.getRoot().listTextures()) t.dispose();
for (const e of doc.getRoot().listExtensionsUsed()) if (/texture_basisu|meshopt/i.test(e.extensionName)) e.dispose();
const glb = await io.writeBinary(doc);
const g = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
g.scene.updateMatrixWorld(true);
function nn(A, B) {     // A, B: Float64Array xyz；返回每个 A 点到 B 的最近距离
  const cell = 0.004, map = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < B.length / 3; i++) { const k = key(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]); (map.get(k) ?? map.set(k, []).get(k)).push(i); }
  const out = new Float64Array(A.length / 3);
  for (let i = 0; i < A.length / 3; i++) {
    const x = A[i * 3], y = A[i * 3 + 1], z = A[i * 3 + 2]; let best = Infinity;
    for (let r = 1; r <= 8 && best === Infinity; r *= 2) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const j of map.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
        const d = Math.hypot(B[j * 3] - x, B[j * 3 + 1] - y, B[j * 3 + 2] - z); if (d < best) best = d; }
    }
    out[i] = best;
  }
  return out;
}
const v = new THREE.Vector3(); let worst = 0;
const rows = [];
g.scene.traverse((m) => {
  if (!m.isSkinnedMesh || m.material?.name !== 'mat-char-xi-face') return;
  const lod = /_lod(\d)/.exec(m.name + ' ' + (m.parent?.name ?? ''))?.[1] ?? '?';
  const n = m.geometry.attributes.position.count, P = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); P.set([v.x, v.y, v.z], i * 3); }
  const M = P.slice(); for (let i = 0; i < n; i++) M[i * 3] = -M[i * 3];
  const dv = nn(M, P);
  const ix = m.geometry.index.array, nt = ix.length / 3, C = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) C[t * 3 + c] = (P[ix[t * 3] * 3 + c] + P[ix[t * 3 + 1] * 3 + c] + P[ix[t * 3 + 2] * 3 + c]) / 3;
  const CM = C.slice(); for (let t = 0; t < nt; t++) CM[t * 3] = -CM[t * 3];
  const dc = nn(CM, C);
  const st = (a) => ({ max: Math.max(...a) * 1000, mean: a.reduce((s, x) => s + x, 0) / a.length * 1000 });
  const sv = st(dv), sc = st(dc); worst = Math.max(worst, sv.max, sc.max);
  rows.push({ lod, verts: n, tris: nt, vmax: sv.max, vmean: sv.mean, cmax: sc.max, cmean: sc.mean });
});
rows.sort((a, b) => a.lod.localeCompare(b.lod));
console.log(`头部镜像误差（mm）  ${path.relative(process.cwd(), file)}`);
for (const r of rows) console.log(`  LOD${r.lod}  顶点 ${String(r.verts).padStart(6)}  三角 ${String(r.tris).padStart(6)}   顶点 max ${r.vmax.toFixed(3)} mean ${r.vmean.toFixed(4)}   三角重心 max ${r.cmax.toFixed(3)} mean ${r.cmean.toFixed(4)}`);
console.log(`  最大 ${worst.toFixed(3)} mm`);
