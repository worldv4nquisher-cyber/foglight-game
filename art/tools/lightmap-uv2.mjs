#!/usr/bin/env node
// v0.1-029：把场景 GLB 的 UV2（TEXCOORD_1）改成「整场景光照贴图图集」坐标，并导出烘焙用的世界空间网格。
//   node art/tools/lightmap-uv2.mjs art/source/bake/s1-lightmap.json --glb-out /tmp/lm-s1/glb --bake-out art/source/bake/s1
// 做的事：
//   1. LOD0 原 UV2（018 builder 的 addUV2 / planarUV2，0..1 不重叠）按配置 rect 线性放进图集；
//   2. LOD1 / LOD2 原 UV2 是各级单独分块的（与 LOD0 不一致，不能共用一张光照贴图）→ 丢掉，改由 LOD0 的分块转过来：
//      LOD0 每个分块 = 轴向投影 + 仿射（最小二乘拟合，残差应 ≈ 0）；LOD 三角形按顶点重合的分块选一个，用该分块的仿射算 UV2，
//      顶点按 (原顶点, 分块) 拆开。planar 对象（滩地）所有 LOD 都是同一俯视投影，直接线性换算；
//   3. 其余带 TEXCOORD_1 的网格节点（船绳）按 extraRects 放进图集；
//   4. 只改 TEXCOORD_1（和 LOD1/2 因拆点带来的顶点重排），节点名 / extras / 材质 / 其他属性不动；输出 float 未压缩 GLB，
//      之后用 glb-pack-ktx2.mjs 重新量化 + meshopt；
//   5. --bake-out：每个对象 LOD0（+ 额外网格）的世界空间数据（*.bin + *.json），以及遮挡物（礁石实例、沉船、潮汐钟）。
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const cfgPath = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const GLB_OUT = opt('--glb-out', null), BAKE_OUT = opt('--bake-out', null);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, `art/source/env/${cfg.scene}-layout.json`), 'utf8'));
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------- 小工具
const mulM = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const xfP = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const xfN = (m, x, y, z) => { // 法线：逆转置（这里只有平移 / 缩放 / 绕 Y 旋转，用逆缩放近似）
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const v = [(m[0] * x / sx + m[4] * y / sy + m[8] * z / sz) / sx, (m[1] * x / sx + m[5] * y / sy + m[9] * z / sz) / sy, (m[2] * x / sx + m[6] * y / sy + m[10] * z / sz) / sz];
  // 上式对非均匀缩放 + 旋转不完全精确，但这里非均匀缩放只出现在绕 Y 旋转前（实例 [sx,sy,sx]），足够用
  const l = Math.hypot(...v) || 1; return v.map((t) => t / l); };
const TRS = (t = [0, 0, 0], rotY = 0, s = [1, 1, 1]) => { const c = Math.cos(rotY), n = Math.sin(rotY); return [c * s[0], 0, -n * s[0], 0, 0, s[1], 0, 0, n * s[2], 0, c * s[2], 0, t[0], t[1], t[2], 1]; };
const eulerYXZ = (t, [ax, ay, az]) => { // three Euler 'YXZ'（度）
  const r = (d) => (d * Math.PI) / 180, [x, y, z] = [r(ax), r(ay), r(az)];
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  // three Matrix4.makeRotationFromEuler YXZ（行主序 te 按列存）
  const te = [ce + df * b, a * f, cf * b - de, 0, de * b - cf, a * e, df + ce * b, 0, a * d, -b, a * c, 0, t[0], t[1], t[2], 1];
  return te; };
const readAttr = (acc) => { const n = acc.getCount(), k = acc.getElementSize(), out = new Float32Array(n * k), tmp = []; for (let i = 0; i < n; i++) { acc.getElement(i, tmp); for (let j = 0; j < k; j++) out[i * k + j] = tmp[j]; } return out; };
const projPlanes = [(x, y, z) => [z, y], (x, y, z) => [x, z], (x, y, z) => [x, y]]; // X 轴 / Y 轴 / Z 轴投影面（符号由仿射吸收）
function fitAffine(P2, UV) { // 最小二乘 [pu pv 1] → u, v
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
  for (let i = 0; i < P2.length; i++) { const r = [P2[i][0], P2[i][1], 1]; for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) A[a][b] += r[a] * r[b]; bu[a] += r[a] * UV[i][0]; bv[a] += r[a] * UV[i][1]; } }
  const solve = (M, y) => { const m = M.map((r, i) => [...r, y[i]]); for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; [m[c], m[p]] = [m[p], m[c]]; if (Math.abs(m[c][c]) < 1e-12) return null; for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; } } return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]; };
  const cu = solve(A, bu), cv = solve(A, bv); if (!cu || !cv) return null;
  let err = 0; for (let i = 0; i < P2.length; i++) { const r = [P2[i][0], P2[i][1], 1]; err = Math.max(err, Math.abs(cu[0] * r[0] + cu[1] * r[1] + cu[2] - UV[i][0]), Math.abs(cv[0] * r[0] + cv[1] * r[1] + cv[2] - UV[i][1])); }
  return { cu, cv, err };
}
const lodRe = /_lod(\d+)$/;
// 点到三角形最近点（Ericson, Real-Time Collision Detection 5.1.5）→ 重心坐标插值 UV
function closestUV(tris, px, py, pz) {
  let bd = Infinity, bu = 0, bv = 0;
  for (const [A, B, C] of tris) {
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], ap = [px - A[0], py - A[1], pz - A[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const d1 = dot(ab, ap), d2 = dot(ac, ap); let w1, w2; // P = A + w1·AB + w2·AC
    if (d1 <= 0 && d2 <= 0) { w1 = 0; w2 = 0; }
    else {
      const bp = [px - B[0], py - B[1], pz - B[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
      const cp = [px - C[0], py - C[1], pz - C[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) { w1 = 1; w2 = 0; }
      else if (d6 >= 0 && d5 <= d6) { w1 = 0; w2 = 1; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { w1 = d1 / (d1 - d3); w2 = 0; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { w1 = 0; w2 = d2 / (d2 - d6); }
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w1 = 1 - w; w2 = w; }
      else { const den = 1 / (va + vb + vc); w1 = vb * den; w2 = vc * den; }
    }
    const q = [A[0] + w1 * ab[0] + w2 * ac[0], A[1] + w1 * ab[1] + w2 * ac[1], A[2] + w1 * ab[2] + w2 * ac[2]];
    const d = (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2;
    if (d < bd) { bd = d; const w0 = 1 - w1 - w2; bu = w0 * A[3] + w1 * B[3] + w2 * C[3]; bv = w0 * A[4] + w1 * B[4] + w2 * C[4]; }
  }
  return [bu, bv];
}
const report = { scene: cfg.scene, objects: [] };
const bakeIndex = { scene: cfg.scene, atlases: cfg.atlases, light: cfg.light, albedo: cfg.albedo, objects: [], occluders: [] };  // light / albedo：S2 起由配置给（S1 不写 = 烘焙脚本默认值）
if (BAKE_OUT) fs.mkdirSync(BAKE_OUT, { recursive: true });
if (GLB_OUT) fs.mkdirSync(GLB_OUT, { recursive: true });

// 写烘焙数据：prims = [{mat, pos(world), nrm(world), uv2, idx, chart(Int32 每顶点)}]
function writeBake(name, prims, extra) {
  const parts = [], meta = { name, ...extra, prims: [] }; let off = 0;
  const add = (arr) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); parts.push(b); const o = off; off += b.length; return o; };
  for (const p of prims) meta.prims.push({ mat: p.mat, nv: p.pos.length / 3, ni: p.idx.length, pos: add(p.pos), nrm: add(p.nrm), uv2: p.uv2 ? add(p.uv2) : -1, idx: add(p.idx), chart: p.chart ? add(p.chart) : -1 });
  fs.writeFileSync(path.join(BAKE_OUT, `${name}.bin`), Buffer.concat(parts));
  fs.writeFileSync(path.join(BAKE_OUT, `${name}.json`), JSON.stringify(meta));
}

let chartBase = 1; // 每张图集内分块编号（烘焙后处理按分块做滤波；0 = 空）
for (const ob of cfg.objects) {
  const file = path.join(ROOT, 'art/models/env', `${ob.name}.glb`);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const place = layout.nodes[ob.name] ?? {};
  const W = TRS(place.translation ?? [0, 0, 0], place.rotationY ?? 0);
  const [rx, ry, rw, rh] = ob.rect;
  const lods = new Map(); const extras = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = lodRe.exec(node.getName());
    if (m && node.getName().startsWith(ob.name)) lods.set(+m[1], node);
    else if (mesh.listPrimitives().some((p) => p.getAttribute('TEXCOORD_1'))) extras.push(node);
  }
  const rep = { name: ob.name, atlas: ob.atlas, rect: ob.rect, lods: [] };
  // ---- LOD0：读 + 分块 + 拟合
  const n0 = lods.get(0), M0 = n0.getWorldMatrix();
  const charts = []; // {plane, cu, cv, uvBox, id}
  const lod0Verts = []; // 网格哈希用：[x,y,z(root 空间), chartIdx]
  const prim0 = [];
  let maxErr = 0;
  for (const prim of n0.getMesh().listPrimitives()) {
    const pos = readAttr(prim.getAttribute('POSITION')), uv2 = readAttr(prim.getAttribute('TEXCOORD_1')), idx = prim.getIndices().getArray();
    const nv = pos.length / 3, P = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) P.set(xfP(M0, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i * 3);
    // 连通分量（共用顶点）= 分块
    const par = new Int32Array(nv).map((_, i) => i); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < idx.length; t += 3) { const a = f(idx[t]), b = f(idx[t + 1]), c = f(idx[t + 2]); par[b] = a; par[f(c)] = a; }
    const comp = new Map(); const vChart = new Int32Array(nv);
    for (let i = 0; i < nv; i++) { const r = f(i); let c = comp.get(r); if (c === undefined) { c = charts.length; comp.set(r, c); charts.push({ verts: [] }); } vChart[i] = c; charts[c].verts.push(i); }
    for (const [, c] of comp) {
      const ch = charts[c]; const pts = ch.verts.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); const uvs = ch.verts.map((i) => [uv2[i * 2], uv2[i * 2 + 1]]);
      let best = null;
      if (ob.planar) best = { plane: 1, ...fitAffine(pts.map((p) => projPlanes[1](...p)), uvs) };
      else for (let pl = 0; pl < 3; pl++) { const r = fitAffine(pts.map((p) => projPlanes[pl](...p)), uvs); if (r && (!best || r.err < best.err)) best = { plane: pl, ...r }; }
      ch.plane = best.plane; ch.cu = best.cu; ch.cv = best.cv; ch.err = best.err; maxErr = Math.max(maxErr, best.err);
      let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const [u, v] of uvs) { b = [Math.min(b[0], u), Math.min(b[1], v), Math.max(b[2], u), Math.max(b[3], v)]; } ch.uvBox = b;
      ch.id = chartBase++;
      delete ch.verts;
    }
    for (let i = 0; i < nv; i++) lod0Verts.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], vChart[i]);
    // 拟合误差大（UV2 绕着石块连续展开，没有单一投影面）的分块：存 LOD0 三角形，LOD 转换改用「分块内最近点 + 重心插值」
    for (let q = 0; q < idx.length; q += 3) { const ch = charts[vChart[idx[q]]]; if (!(ch.err > 1e-3) && !cfg.lodSnap) continue;
      (ch.tris ??= []).push([0, 1, 2].map((k) => { const i = idx[q + k]; return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2], uv2[i * 2], uv2[i * 2 + 1]]; })); }
    prim0.push({ prim, P, uv2, idx, vChart });
  }
  // 网格哈希（2 cm）
  const CELL = 0.02, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (let i = 0; i < lod0Verts.length; i += 4) { const k = key(lod0Verts[i], lod0Verts[i + 1], lod0Verts[i + 2]); const l = grid.get(k); if (l) l.push(i / 4); else grid.set(k, [i / 4]); }
  const near = (x, y, z, r) => { const out = new Set(); const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL), s = Math.ceil(r / CELL);
    for (let a = -s; a <= s; a++) for (let b = -s; b <= s; b++) for (let c = -s; c <= s; c++) { const l = grid.get(`${cx + a},${cy + b},${cz + c}`); if (!l) continue; for (const j of l) { const q = j * 4; if (Math.hypot(lod0Verts[q] - x, lod0Verts[q + 1] - y, lod0Verts[q + 2] - z) <= r) out.add(lod0Verts[q + 3]); } }
    return out; };
  const toAtlas = (u, v) => [rx + u * rw, ry + v * rh];
  const mapChart = (ch, x, y, z) => { if (ch.tris && ch.err > 1e-3) return closestUV(ch.tris, x, y, z); const [a, b] = projPlanes[ch.plane](x, y, z); return [ch.cu[0] * a + ch.cu[1] * b + ch.cu[2], ch.cv[0] * a + ch.cv[1] * b + ch.cv[2]]; };
  // ---- 写回 LOD0（只换 TEXCOORD_1）
  const setUV2 = (prim, arr) => { const acc = doc.createAccessor().setType('VEC2').setArray(arr).setBuffer(root.listBuffers()[0]); prim.setAttribute('TEXCOORD_1', acc); };
  const bakePrims = [];
  for (const { prim, P, uv2, idx, vChart } of prim0) {
    const out = new Float32Array(uv2.length); for (let i = 0; i < uv2.length / 2; i++) { const [u, v] = toAtlas(uv2[i * 2], uv2[i * 2 + 1]); out[i * 2] = u; out[i * 2 + 1] = v; }
    setUV2(prim, out);
    if (BAKE_OUT) {
      const nrm = readAttr(prim.getAttribute('NORMAL')); const nv = P.length / 3, wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
      const WM = mulM(W, M0);
      const pos = readAttr(prim.getAttribute('POSITION'));
      for (let i = 0; i < nv; i++) { wp.set(xfP(WM, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i * 3); wn.set(xfN(WM, nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]), i * 3); }
      bakePrims.push({ mat: prim.getMaterial()?.getName() ?? '', pos: wp, nrm: wn, uv2: out, idx: new Uint32Array(idx), chart: Int32Array.from(vChart, (c) => charts[c].id) });
    }
  }
  const bad = charts.filter((c) => c.err > 1e-3); rep.lods.push({ lod: 0, charts: charts.length, fitMaxErr: +maxErr.toExponential(2), chartsErrOver1e3: bad.length, badCharts: bad.slice(0, 8).map((c) => ({ id: c.id, err: +c.err.toExponential(2), nv: c.verts?.length ?? c.n })) });
  // ---- LOD1+：转 UV2（拆点重建所有属性）
  for (const [lv, node] of [...lods].filter(([l]) => l > 0).sort((a, b) => a[0] - b[0])) {
    const M = node.getWorldMatrix(); let tris = 0, full = 0, partial = 0, fallback = 0, outside = 0, snapped = 0; let newVerts = 0, oldVerts = 0;
    for (const prim of node.getMesh().listPrimitives()) {
      const names = prim.listSemantics(); const attrs = Object.fromEntries(names.map((s) => [s, readAttr(prim.getAttribute(s))]));
      const sizes = Object.fromEntries(names.map((s) => [s, prim.getAttribute(s).getElementSize()]));
      const idx = prim.getIndices().getArray(); const pos = attrs.POSITION; const nv = pos.length / 3; oldVerts += nv;
      const P = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) P.set(xfP(M, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i * 3);
      const cand = Array.from({ length: nv }, (_, i) => near(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.006));
      const newAttr = Object.fromEntries(names.map((s) => [s, []])); const newIdx = []; const remap = new Map();
      for (let t = 0; t < idx.length; t += 3) {
        tris++;
        const vs = [idx[t], idx[t + 1], idx[t + 2]];
        let ci;
        if (ob.planar) ci = 0; // 平面投影：直接线性换算原 UV2
        else {
          // 三角形法线 → 主投影面
          const p = vs.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
          const e1 = p[1].map((x, k) => x - p[0][k]), e2 = p[2].map((x, k) => x - p[0][k]);
          const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]].map(Math.abs);
          const plane = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
          const score = new Map(); for (const i of vs) for (const c of cand[i]) score.set(c, (score.get(c) ?? 0) + 1);
          let best = -1, bs = -Infinity;
          const over = (c) => { const ch = charts[c]; let o = 0; for (const i of vs) { const [u, v] = mapChart(ch, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); o = Math.max(o, ch.uvBox[0] - u, u - ch.uvBox[2], ch.uvBox[1] - v, v - ch.uvBox[3]); } return Math.max(0, o); };
          for (const [c, s] of score) { const v = s * 2 + (charts[c].plane === plane ? 1 : 0) - over(c) * 2048; if (v > bs) { bs = v; best = c; } }
          if (best < 0) { // 兜底：更大半径找最近的
            fallback++;
            for (const r of [0.03, 0.1, 0.3, 1]) { const s = near((p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3, r); for (const c of s) if (best < 0 || charts[c].plane === plane) best = c; if (best >= 0) break; }
          } else if ((score.get(best) ?? 0) === 3) full++; else partial++;
          ci = best;
        }
        const ch = charts[ci];
        for (const i of vs) {
          const k = ob.planar ? i : i * 1e6 + ci; let j = remap.get(k);
          if (j === undefined) {
            j = remap.size; remap.set(k, j);
            for (const s of names) { if (s === 'TEXCOORD_1') continue; const z = sizes[s]; for (let q = 0; q < z; q++) newAttr[s].push(attrs[s][i * z + q]); }
            let u, v;
            if (ob.planar) { u = attrs.TEXCOORD_1[i * 2]; v = attrs.TEXCOORD_1[i * 2 + 1]; }
            else {
              [u, v] = mapChart(ch, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
              const m = 2 / 2048; // 超出分块 2 px 以上的点收回到分块边（避免采到隔壁分块）
              if (u < ch.uvBox[0] - m || u > ch.uvBox[2] + m || v < ch.uvBox[1] - m || v > ch.uvBox[3] + m) { outside++; if (ch.tris) { [u, v] = closestUV(ch.tris, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); snapped++; } u = Math.min(Math.max(u, ch.uvBox[0] - m), ch.uvBox[2] + m); v = Math.min(Math.max(v, ch.uvBox[1] - m), ch.uvBox[3] + m); }
            }
            const [au, av] = toAtlas(u, v); newAttr.TEXCOORD_1.push(au, av);
          }
          newIdx.push(j);
        }
      }
      newVerts += remap.size;
      for (const s of names) { const old = prim.getAttribute(s); const acc = doc.createAccessor().setType(old.getType()).setArray(new Float32Array(newAttr[s])).setBuffer(root.listBuffers()[0]); prim.setAttribute(s, acc); }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(newIdx)).setBuffer(root.listBuffers()[0]));
    }
    rep.lods.push({ lod: lv, tris, trisAllVertsOnChart: full, trisPartial: partial, trisFallback: fallback, vertsOutsideChart: outside, vertsSnapped: snapped, verts: `${oldVerts}→${newVerts}` });
  }
  // ---- 额外网格节点（船绳）：原 UV2 0..1 → extraRects
  for (const node of extras) {
    const r = ob.extraRects?.[node.getName()]; if (!r) { rep.warn = (rep.warn ?? []).concat(`${node.getName()} 有 UV2 但没配 extraRects`); continue; }
    const M = node.getWorldMatrix(); const id = chartBase++;
    const prims = [];
    for (const prim of node.getMesh().listPrimitives()) {
      const uv2 = readAttr(prim.getAttribute('TEXCOORD_1')); const out = new Float32Array(uv2.length);
      for (let i = 0; i < uv2.length / 2; i++) { out[i * 2] = r[0] + uv2[i * 2] * r[2]; out[i * 2 + 1] = r[1] + uv2[i * 2 + 1] * r[3]; }
      setUV2(prim, out);
      if (BAKE_OUT) { const pos = readAttr(prim.getAttribute('POSITION')), nrm = readAttr(prim.getAttribute('NORMAL')); const nv = pos.length / 3, wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3); const WM = mulM(W, M);
        for (let i = 0; i < nv; i++) { wp.set(xfP(WM, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i * 3); wn.set(xfN(WM, nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]), i * 3); }
        prims.push({ mat: prim.getMaterial()?.getName() ?? '', pos: wp, nrm: wn, uv2: out, idx: new Uint32Array(prim.getIndices().getArray()), chart: new Int32Array(nv).fill(id) }); }
    }
    if (BAKE_OUT) { writeBake(node.getName(), prims, { atlas: ob.atlas, role: 'lightmapped', variant: node.getName() }); bakeIndex.objects.push(node.getName()); }
    rep.extra = (rep.extra ?? []).concat(node.getName());
  }
  // 根 extras 记光照贴图信息（程序读）
  const scene0 = root.listScenes()[0]; const top = scene0.listChildren().find((n) => n.getName() === ob.name);
  if (top) top.setExtras({ ...top.getExtras(), lightmap: { ticket: 'v0.1-029', texture: `${ob.atlas}.ktx2`, encoding: 'RGBM8', uv: 'TEXCOORD_1', lightMapIntensity: 1.0, rect: ob.rect } });
  for (const [, node] of lods) { const e = { ...node.getExtras() }; if (e.lightmap) e.lightmap = { ...e.lightmap, atlas: ob.atlas, rect: ob.rect, note: 'v0.1-029：UV2 已换成场景图集坐标；所有 LOD 共用 LOD0 分块' }; node.setExtras(e); }
  if (GLB_OUT) await io.write(path.join(GLB_OUT, `${ob.name}.glb`), doc);
  if (BAKE_OUT) { writeBake(ob.name, bakePrims, { atlas: ob.atlas, role: 'lightmapped' }); bakeIndex.objects.push(ob.name); }
  report.objects.push(rep); console.log(JSON.stringify(rep));
}

// ---------- 遮挡物
if (BAKE_OUT) {
  const lod0Of = async (file) => { const doc = await io.read(file); const prims = [];
    for (const node of doc.getRoot().listNodes()) { const mesh = node.getMesh(); if (!mesh) continue; const nm = node.getName();
      if (/-(collider|wall)/.test(nm) || /_lod[12]$/.test(nm)) continue;
      const M = node.getWorldMatrix(); for (const prim of mesh.listPrimitives()) { if (!prim.getMaterial()) continue; const pos = readAttr(prim.getAttribute('POSITION')); const nv = pos.length / 3, wp = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) wp.set(xfP(M, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), i * 3);
        prims.push({ mat: prim.getMaterial().getName(), pos: wp, nrm: new Float32Array(nv * 3), idx: new Uint32Array(prim.getIndices().getArray()) }); } }
    return { prims, doc }; };
  const rockInst = new Map();
  for (const r of layout.instances ?? []) { const l = rockInst.get(r.rock) ?? []; const s = Array.isArray(r.scale) ? r.scale : [r.scale ?? 1, r.scale ?? 1, r.scale ?? 1]; l.push(TRS(r.translation, r.rotationY, s)); rockInst.set(r.rock, l); }
  for (const [id, mats] of rockInst) { const { prims } = await lod0Of(path.join(ROOT, `art/models/env/env-rock-shore-${id}.glb`)); writeBake(`occ-rock-${id}`, prims, { role: 'occluder', instances: mats }); bakeIndex.occluders.push(`occ-rock-${id}`); }
  for (const p of cfg.occluders?.props ?? []) {
    const { prims } = await lod0Of(path.join(ROOT, p.file)); let m;
    if (p.anchor) { const [obj, nodeName] = p.anchor.split('#'); const d = await io.read(path.join(ROOT, `art/models/env/${obj}.glb`)); const n = d.getRoot().listNodes().find((x) => x.getName() === nodeName); const pl = layout.nodes[obj]; m = mulM(TRS(pl.translation, pl.rotationY), n.getWorldMatrix()); }
    else m = eulerYXZ(p.translation, p.rotationYXZDeg);
    const nm = 'occ-' + path.basename(p.file, '.glb'); writeBake(nm, prims, { role: 'occluder', instances: [m] }); bakeIndex.occluders.push(nm);
  }
  fs.writeFileSync(path.join(BAKE_OUT, 'index.json'), JSON.stringify(bakeIndex, null, 1));
  fs.writeFileSync(path.join(BAKE_OUT, 'uv2-report.json'), JSON.stringify(report, null, 1));
}
