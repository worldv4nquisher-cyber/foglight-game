// 用法：node art/tools/check-s3-guide-mirrors.mjs（先打包 prop-guide-mirror-wall-s3-a/b）
// 022 复核：用实际 GLB（打包后）的 mirror-plane / 网格，按 artSlots（根挂白盒组 = S3 原点、对齐 mirror-plane、copy 偏航）走光路，并测支架遮挡
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from '../../game/node_modules/three/build/three.module.js';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const D = Math.PI / 180, V = (...a) => new THREE.Vector3(...a);
const L0 = V(9.5, 4.6, 0.6), W = V(2.35, 1.35, 0), PORT = V(0, 21.85, 0);
const C = { a: V(-0.9958577760546713, 10.6, 0.8356238925925014), b: V(1.2802500789158704, 16.6, -0.2257426309670095) };
const YAW = { a: 90 - -19.777, b: 90 - 160.755 };
const P = new URL('../models/props/', import.meta.url).pathname;
async function load(k) {
  const doc = await io.read(`${P}prop-guide-mirror-wall-s3-${k}.glb`);
  const nodes = doc.getRoot().listNodes(), by = Object.fromEntries(nodes.map((n) => [n.getName(), n]));
  by['mirror-pivot'].setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, YAW[k] * D, 0)).toArray()); // copy 驱动到解
  const W_ = (n) => new THREE.Matrix4().fromArray(n.getWorldMatrix());
  // align：平移根使 mirror-plane 世界位置 = 白盒镜心
  const pm = W_(by[`prop-guide-mirror-wall-s3-${k}-mirror-plane`]), pp = V().setFromMatrixPosition(pm);
  const shift = C[k].clone().sub(pp);
  const normal = V(0, 0, 1).transformDirection(pm), center = C[k].clone();
  const tris = [];
  for (const n of nodes) { const m = n.getMesh(); if (!m || n.getName().endsWith('-collider')) continue;
    const M = W_(n).premultiply(new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z));
    for (const pr of m.listPrimitives()) { const A = pr.getAttribute('POSITION'), I = pr.getIndices().getArray();
      for (let t = 0; t < I.length; t += 3) { const v = [0, 1, 2].map((j) => V(...A.getElement(I[t + j], [])).applyMatrix4(M));
        const isRefl = n.getName() === 'mirror-pitch-mesh' && v.every((p) => Math.abs(p.clone().sub(center).dot(normal)) < 1e-3);
        tris.push({ v, isRefl, node: n.getName() }); } } }
  return { k, normal, center, shift, tris, pivotYawDeg: YAW[k] };
}
const A = await load('a'), B = await load('b');
const hitPlane = (o, d, m) => { const t = m.center.clone().sub(o).dot(m.normal) / d.dot(m.normal); return o.clone().addScaledVector(d, t); };
const refl = (d, n) => d.clone().sub(n.clone().multiplyScalar(2 * d.dot(n)));
const ray = new THREE.Ray(), tmp = V();
function blockers(o, e, skipRefl) { const d = e.clone().sub(o), L = d.length(); d.normalize(); ray.set(o.clone().addScaledVector(d, 1e-3), d); const out = [];
  for (const m of [A, B]) for (const t of m.tris) { if (t.isRefl && skipRefl) continue; const h = ray.intersectTriangle(t.v[0], t.v[1], t.v[2], false, tmp); if (h && h.distanceTo(o) < L - 2e-3) out.push(`${m.k}:${t.node}@${h.distanceTo(o).toFixed(3)}`); }
  return out; }
const d0 = A.center.clone().sub(W).normalize();
const hA = hitPlane(W, d0, A), d1 = refl(d0, A.normal), hB = hitPlane(hA, d1, B), d2 = refl(d1, B.normal);
const miss = PORT.clone().sub(hB).cross(d2).length();
const locA = hA.clone().sub(A.center), locB = hB.clone().sub(B.center);
const r = (v) => v.toArray().map((x) => +x.toFixed(4));
console.log('对齐平移（量化残差）a', r(A.shift), ' b', r(B.shift));
console.log('镜面法线 a', r(A.normal), ' 俯仰', (Math.asin(A.normal.y) / D).toFixed(3), '偏航', (Math.atan2(A.normal.x, A.normal.z) / D).toFixed(3));
console.log('镜面法线 b', r(B.normal), ' 俯仰', (Math.asin(B.normal.y) / D).toFixed(3), '偏航', (Math.atan2(B.normal.x, B.normal.z) / D).toFixed(3));
console.log('反射面三角形数 a/b', A.tris.filter((t) => t.isRefl).length, B.tris.filter((t) => t.isRefl).length);
console.log('A 命中点', r(hA), ' 离镜心', locA.length().toFixed(4), '（镜面半宽 0.35）');
console.log('B 命中点', r(hB), ' 离镜心', locB.length().toFixed(4));
console.log('出射光离点火口', miss.toFixed(4), 'm（≤ 0.3）');
// 命中点确实落在反射三角形里
const inRefl = (m, h) => m.tris.some((t) => t.isRefl && new THREE.Triangle(...t.v).containsPoint(h));
console.log('命中在反射面网格内 a/b', inRefl(A, hA), inRefl(B, hB));
console.log('遮挡 W→A', blockers(W, hA, true).length, ' L0→W', blockers(L0, W, true).length, ' A→B', blockers(hA, hB, true).length, ' B→PORT', blockers(hB, PORT, true).length);
for (const [n, o, e] of [['W→A', W, hA], ['A→B', hA, hB], ['B→PORT', hB, PORT]]) { const b = blockers(o, e, true); if (b.length) console.log(n, b.slice(0, 6)); }
// 余量：光线到支架 / 转动件最近距离
function clearance(o, e) { const s = new THREE.Line3(o, e); let best = 1e9, who = ''; for (const m of [A, B]) for (const t of m.tris) { if (t.isRefl || t.node === 'mirror-pitch-mesh') continue; for (const v of t.v) { const c = s.closestPointToPoint(v, true, V()); const dd = c.distanceTo(v); if (dd < best) { best = dd; who = `${m.k}:${t.node}`; } } } return `${best.toFixed(3)} m（${who}）`; }
console.log('光线离支架/叉架最近（不含镜框）W→A', clearance(W, hA), ' A→B', clearance(hA, hB), ' B→PORT', clearance(hB, PORT));
