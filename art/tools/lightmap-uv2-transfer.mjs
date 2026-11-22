// 把 029 烘焙的光照贴图 UV2（旧 GLB，场景图集坐标）按最近面 + 同一分块转移到重新生成的 GLB 上，保留根 / 各 LOD 的 extras.lightmap。
// 用法：node art/tools/lightmap-uv2-transfer.mjs <旧的已烘焙 GLB> <新生成未打包 GLB>（原地改写），再跑 glb-pack-ktx2 --uv-bits 14
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [oldPath, newPath] = process.argv.slice(2);
const oldDoc = await io.read(oldPath);
await oldDoc.transform(dequantize());
const lodName = (n) => /_lod(\d)$/.exec(n)?.[1];
const xf = (m, a, i, o) => { const x = a[i], y = a[i + 1], z = a[i + 2]; o[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; o[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; o[2] = m[2] * x + m[6] * y + m[10] * z + m[14]; };
// ---- old LOD0 triangles
const T = []; // {p:[9], uv:[6], mat, chart, n:[3]}
let chartBase = 0;
for (const node of oldDoc.getRoot().listNodes()) {
  if (lodName(node.getName()) !== '0' || !node.getMesh()) continue;
  const m = node.getWorldMatrix();
  for (const pr of node.getMesh().listPrimitives()) {
    const P = pr.getAttribute('POSITION').getArray(), U = pr.getAttribute('TEXCOORD_1').getArray(), I = pr.getIndices().getArray();
    const nv = P.length / 3, parent = new Int32Array(nv).map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
    for (let t = 0; t < I.length; t += 3) { const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]); parent[b] = a; parent[find(c)] = a; }
    const W = new Float32Array(P.length), o = [0, 0, 0];
    for (let i = 0; i < nv; i++) { xf(m, P, i * 3, o); W.set(o, i * 3); }
    for (let t = 0; t < I.length; t += 3) {
      const p = [], uv = [];
      for (let q = 0; q < 3; q++) { const v = I[t + q]; p.push(W[v * 3], W[v * 3 + 1], W[v * 3 + 2]); uv.push(U[v * 2], U[v * 2 + 1]); }
      T.push({ p, uv, mat: pr.getMaterial()?.getName(), chart: chartBase + find(I[t]) });
    }
    chartBase += nv;
  }
}
console.log('old tris', T.length);
const C = 0.5, grid = new Map(), gk = (i, j, k) => `${i},${j},${k}`;
T.forEach((t, idx) => {
  const p = t.p;
  const lo = [0, 1, 2].map((a) => Math.floor(Math.min(p[a], p[a + 3], p[a + 6]) / C)), hi = [0, 1, 2].map((a) => Math.floor(Math.max(p[a], p[a + 3], p[a + 6]) / C));
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const key = gk(i, j, k); let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(idx); }
});
// closest point on triangle → barycentric (Ericson)
function closest(px, py, pz, p, out) {
  const ax = p[0], ay = p[1], az = p[2], abx = p[3] - ax, aby = p[4] - ay, abz = p[5] - az, acx = p[6] - ax, acy = p[7] - ay, acz = p[8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let v, w;
  if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
  else {
    const bpx = px - p[3], bpy = py - p[4], bpz = pz - p[5];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - p[6], cpy = py - p[7], cpz = pz - p[8];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
    else if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / (d4 - d3 + (d5 - d6)); v = 1 - w; }
    else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; }
  }
  const qx = ax + abx * v + acx * w, qy = ay + aby * v + acy * w, qz = az + abz * v + acz * w;
  out[0] = 1 - v - w; out[1] = v; out[2] = w;
  return (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
}
const bc = [0, 0, 0];
function nearest(x, y, z, mat, chart) {
  for (const r of [0, 1, 2, 4, 8]) {
    let best = -1, bd = Infinity, bb = [0, 0, 0];
    const ci = Math.floor(x / C), cj = Math.floor(y / C), ck = Math.floor(z / C), seen = new Set();
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
      const a = grid.get(gk(i, j, k)); if (!a) continue;
      for (const idx of a) {
        if (seen.has(idx)) continue; seen.add(idx);
        const t = T[idx];
        if (chart !== undefined && t.chart !== chart) continue;
        let d = closest(x, y, z, t.p, bc);
        if (mat && t.mat !== mat) d += 0.09;
        if (d < bd) { bd = d; best = idx; bb = bc.slice(); }
      }
    }
    if (best >= 0 && Math.sqrt(bd) <= (r + 0.5) * C) return { idx: best, b: bb, d: Math.sqrt(bd) };
  }
  return null;
}
const uvAt = (t, b) => [t.uv[0] * b[0] + t.uv[2] * b[1] + t.uv[4] * b[2], t.uv[1] * b[0] + t.uv[3] * b[1] + t.uv[5] * b[2]];
// ---- new
const doc = await io.read(newPath);
const oldNodes = new Map(oldDoc.getRoot().listNodes().map((n) => [n.getName(), n]));
let stats = { tris: 0, far: 0, split: 0 };
for (const node of doc.getRoot().listNodes()) {
  const old = oldNodes.get(node.getName());
  if (old && old.getExtras()?.lightmap) node.setExtras({ ...node.getExtras(), lightmap: old.getExtras().lightmap });
  if (lodName(node.getName()) === undefined || !node.getMesh()) continue;
  const m = node.getWorldMatrix();
  for (const pr of node.getMesh().listPrimitives()) {
    const mat = pr.getMaterial()?.getName();
    const P = pr.getAttribute('POSITION').getArray(), I = pr.getIndices().getArray();
    const nv = P.length / 3, W = new Float64Array(P.length), o = [0, 0, 0];
    for (let i = 0; i < nv; i++) { xf(m, P, i * 3, o); W.set(o, i * 3); }
    const corner = new Float32Array(I.length * 2), cache = new Map();
    for (let t = 0; t < I.length; t += 3) {
      stats.tris++;
      const v = [I[t], I[t + 1], I[t + 2]];
      const cx = (W[v[0] * 3] + W[v[1] * 3] + W[v[2] * 3]) / 3, cy = (W[v[0] * 3 + 1] + W[v[1] * 3 + 1] + W[v[2] * 3 + 1]) / 3, cz = (W[v[0] * 3 + 2] + W[v[1] * 3 + 2] + W[v[2] * 3 + 2]) / 3;
      const c = nearest(cx, cy, cz, mat);
      if (!c) throw new Error('no old tri near ' + [cx, cy, cz]);
      if (c.d > 0.05) stats.far++;
      const chart = T[c.idx].chart;
      for (let q = 0; q < 3; q++) {
        const ck = v[q] * 1e7 + chart;
        let uv = cache.get(ck);
        if (!uv) {
          const n = nearest(W[v[q] * 3], W[v[q] * 3 + 1], W[v[q] * 3 + 2], undefined, chart) ?? c;
          uv = uvAt(T[n.idx], n.b).map((x) => Math.min(1, Math.max(0, x)));
          cache.set(ck, uv);
        }
        corner[(t + q) * 2] = uv[0]; corner[(t + q) * 2 + 1] = uv[1];
      }
    }
    // 每个顶点按不同 UV2 拆分
    const sem = pr.listSemantics(), src = sem.map((s) => pr.getAttribute(s)), keyMap = new Map(), remap = [], newIdx = new Uint32Array(I.length);
    for (let k = 0; k < I.length; k++) {
      const key = I[k] + ':' + Math.round(corner[k * 2] * 1e6) + ':' + Math.round(corner[k * 2 + 1] * 1e6);
      let ni = keyMap.get(key);
      if (ni === undefined) { ni = remap.length; keyMap.set(key, ni); remap.push([I[k], corner[k * 2], corner[k * 2 + 1]]); }
      newIdx[k] = ni;
    }
    stats.split += remap.length - nv;
    sem.forEach((s, si) => {
      const a = src[si], size = a.getElementSize(), arr = a.getArray(), out = new arr.constructor(remap.length * size);
      remap.forEach(([ov, u, w], i) => { if (s === 'TEXCOORD_1') { out[i * 2] = u; out[i * 2 + 1] = w; } else for (let e = 0; e < size; e++) out[i * size + e] = arr[ov * size + e]; });
      const na = doc.createAccessor().setType(a.getType()).setArray(s === 'TEXCOORD_1' ? new Float32Array(out) : out).setNormalized(s === 'TEXCOORD_1' ? false : a.getNormalized()).setBuffer(a.getBuffer());
      pr.setAttribute(s, na);
    });
    pr.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx).setBuffer(pr.getIndices().getBuffer()));
  }
  const ol = old?.getExtras()?.lightmap;
  if (ol) node.setExtras({ ...node.getExtras(), lightmap: { ...ol, note: ol.note + '；S1 重建后按最近面从 029 烘焙网格转移' } });
}
console.log(stats);
await io.write(newPath, doc);
