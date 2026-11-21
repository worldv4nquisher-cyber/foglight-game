#!/usr/bin/env node
// r5 第 1 项：汐马尾 × 兜帽 穿插纠正（求解器）。
//  口径 = 程序 game@d628d5f scripts/measure-ponytail-hood.mjs：马尾 = hair LOD0 里 hair_ponytail_01–03 权重 ≥ 0.5 的顶点；
//  兜帽 = body LOD0 里 hood_01/02 权重 ≥ 0.3 的三角形；30 fps 逐帧；最近三角形面法线定符号 + 颈轴射线核对假负；只看离兜帽 ≤ 4 cm 的点。
//  纠正量（每 clip 每帧 4 个角度，弧度）：
//    t1 / t2 = 马尾链绕「头骨局部 +X」往后甩（t1 加在 hair_ponytail_01，t2 加在 _02 和 _03），
//    h1 / h2 = 兜帽绕「chest 局部 +X」转（h1 加在 hood_01，h2 加在 hood_02）；仰头时后脑压兜帽，兜帽往后让。
//  轴在链根父骨空间里给定，逐级换到各骨父空间：q_k' = R(conj(q_0'…q_{k-1}')·axis, a_k) · q_k —— finish-xi-anims.mjs 用同一公式写回关键帧。
//  只对有穿插的 clip 求；walk / idle / stand-gaze 等干净的 clip 不写（关键帧逐位不变）。
//  用法：node art/tools/solve-xi-ponytail-hood.mjs [--anims 未纠正的 anims.glb] [--out json] [--only clip,…] [--prog]
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const NM = path.resolve(HERE, '../../game/node_modules');
globalThis.self ??= globalThis;
const THREE = await import(path.join(NM, 'three/build/three.module.js'));
const { GLTFLoader } = await import(path.join(NM, 'three/examples/jsm/loaders/GLTFLoader.js'));
const { MeshoptDecoder } = await import(path.join(NM, 'three/examples/jsm/libs/meshopt_decoder.module.js'));
const { MeshBVH } = await import(path.join(NM, 'three-mesh-bvh/src/index.js'));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const CH = path.resolve(HERE, '../models/characters');
const XI = opt('--xi', path.join(CH, 'char-xi.glb'));
const ANIMS = opt('--anims', path.join(CH, 'char-xi-anims.glb'));
const OUT = opt('--out', path.resolve(HERE, '../source/characters/xi-ponytail-hood-fix.json'));
const ONLY = opt('--only', null)?.split(',');
const PROG = args.includes('--prog');   // 同时满足程序脚本原样口径（见 measure）
const FPS = 30, NEAR = 0.04, PEN = 0.002;
const TGT = 0.0012;          // 求解目标：每帧最深 ≤ 1.2 mm（验收线 2 mm / 0.2 cm，留余量）
const SOFT = -0.0008;        // 能量从「离兜帽面不到 +0.8 mm」开始计（逐帧解留余量，平滑后不掉线）
const LIM = { t1: [-0.05, 0.9], t2: [-0.05, 0.9], h1: [-0.3, 0.3], h2: [-0.3, 0.3], ...JSON.parse(process.env.PT_LIM ?? '{}') };   // PT_LIM='{"h1":[-0.5,0.5]}' 临时放宽
const KEYS = Object.keys(LIM);
const REG = { t1: 0.6, t2: 0.6, h1: 4, h2: 4 };   // 兜帽动得越少越好

const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)), detectSupport() {} };
const parse = async (f) => { const b = fs.readFileSync(f); return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); };
const [model, anims] = await Promise.all([parse(XI), parse(ANIMS)]);
const scene = model.scene, meshes = [];
scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
const pick = (re) => meshes.filter((m) => re.test(m.material.name)).sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
const hair = pick(/xi-hair/), body = pick(/xi-body/);
const boneIdx = (m, names) => names.map((n) => m.skeleton.bones.findIndex((b) => b.name === n)).filter((i) => i >= 0);
const PT = boneIdx(hair, ['hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03']), HOOD = boneIdx(body, ['hood_01', 'hood_02']);
const weightOn = (m, i, set) => { const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; let w = 0; for (let k = 0; k < 4; k++) if (set.includes(si.getComponent(i, k))) w += sw.getComponent(i, k); return w; };
const ptVerts = []; for (let i = 0; i < hair.geometry.attributes.position.count; i++) if (weightOn(hair, i, PT) >= 0.5) ptVerts.push(i);
const hoodTris = []; { const ix = body.geometry.index; for (let t = 0; t < ix.count; t += 3) { const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2); if ([a, b, c].every((v) => weightOn(body, v, HOOD) >= 0.3)) hoodTris.push(a, b, c); } }
const mixer = new THREE.AnimationMixer(scene);
const bone = (n) => scene.getObjectByName(n);
const PTB = ['hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03'].map(bone), HB = ['hood_01', 'hood_02'].map(bone);
const AX = new THREE.Vector3(1, 0, 0);
export function applyChain(bones, axis, angles) {
  const q = new THREE.Quaternion(), acc = new THREE.Quaternion(), ax = new THREE.Vector3();
  bones.forEach((b, k) => { ax.copy(axis).applyQuaternion(acc.clone().invert()); q.setFromAxisAngle(ax, angles[k]); b.quaternion.premultiply(q); acc.multiply(b.quaternion); });
}
const v = new THREE.Vector3(), hit = {}, tri = new THREE.Triangle(), n = new THREE.Vector3(), ray = new THREE.Ray(), d3 = new THREE.Vector3();
const nA = new THREE.Vector3(), hA = new THREE.Vector3(), cen = new THREE.Vector3(), line = new THREE.Line3();
const arr = new Float32Array(hoodTris.length * 3);
const hoodGeo = new THREE.BufferGeometry(); hoodGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
function measure() {
  scene.updateMatrixWorld(true); hair.skeleton.update(); body.skeleton.update();
  for (let k = 0; k < hoodTris.length; k++) body.getVertexPosition(hoodTris[k], v).applyMatrix4(body.matrixWorld).toArray(arr, k * 3);
  const bvh = new MeshBVH(hoodGeo);
  let gP = null, bvhP = null;
  if (PROG) { gP = new THREE.BufferGeometry(); gP.setAttribute('position', new THREE.BufferAttribute(arr.slice(), 3)); bvhP = new MeshBVH(gP); }
  bone('neck').getWorldPosition(nA); bone('head').getWorldPosition(hA); line.set(nA, hA);
  let worst = 0, E = 0, cnt = 0;
  for (const i of ptVerts) {
    hair.getVertexPosition(i, v).applyMatrix4(hair.matrixWorld);
    bvh.closestPointToPoint(v, hit);
    if (hit.distance > NEAR) continue;
    const fi = hit.faceIndex * 3;
    const ix = hoodGeo.index; tri.setFromAttributeAndIndices(hoodGeo.attributes.position, ix.getX(fi), ix.getX(fi + 1), ix.getX(fi + 2)); tri.getNormal(n);   // MeshBVH 会重排索引：按 index 取面（程序脚本按 arr[fi*9] 取，取到的不是最近面）
    let d = n.dot(d3.copy(v).sub(hit.point)) >= 0 ? hit.distance : -hit.distance;
    if (d < 0) { line.closestPointToPoint(v, false, cen); ray.origin.copy(v); ray.direction.copy(v).sub(cen).normalize(); if (bvh.raycast(ray, THREE.DoubleSide).length === 0) d = -d; }
    if (PROG) {   // --prog：同时按程序脚本原样（新建非索引几何 + arr[fi*9] 取三角形）再量一遍，取两者更深的
      const hp = {}; bvhP.closestPointToPoint(v, hp); const fp = hp.faceIndex * 3, aP = gP.attributes.position.array;
      tri.a.fromArray(aP, fp * 3); tri.b.fromArray(aP, fp * 3 + 3); tri.c.fromArray(aP, fp * 3 + 6); tri.getNormal(n);
      let dp = n.dot(d3.copy(v).sub(hp.point)) >= 0 ? hp.distance : -hp.distance;
      if (dp < 0) { line.closestPointToPoint(v, false, cen); ray.origin.copy(v); ray.direction.copy(v).sub(cen).normalize(); if (bvhP.raycast(ray, THREE.DoubleSide).length === 0) dp = -dp; }
      d = Math.min(d, dp);
    }
    worst = Math.min(worst, d);
    if (d < -SOFT) { E += ((d + SOFT) * 1000) ** 2; cnt++; }
  }
  if (gP) gP.dispose();
  return { worst, E, cnt };
}
let cur = null;
const FIXB = [...PTB, ...HB], saved = FIXB.map(() => new THREE.Quaternion()); let savedKey = null;
function pose(clip, f, p) {
  if (cur !== clip) { mixer.stopAllAction(); mixer.uncacheRoot(scene); mixer.clipAction(clip).play(); cur = clip; savedKey = null; }
  mixer.setTime(Math.min(f / FPS, clip.duration - 1e-4));
  // three 的 PropertyMixer 只在混合结果变了才写回骨骼：同一帧重复 setTime 不会覆盖上次手动改的旋转 → 自己存 / 还原动画值
  const key = clip.name + '#' + f;
  if (savedKey === key) FIXB.forEach((b, k) => b.quaternion.copy(saved[k])); else { FIXB.forEach((b, k) => saved[k].copy(b.quaternion)); savedKey = key; }
  if (p) { applyChain(PTB, AX, [p.t1, p.t2, p.t2]); applyChain(HB, AX, [p.h1, p.h2]); }
}
const evalP = (clip, f, p, ref, lam) => { pose(clip, f, p); const m = measure(); let R = 0; for (const k of KEYS) R += REG[k] * p[k] ** 2 + (ref ? lam * (p[k] - ref[k]) ** 2 : 0); return { ...m, J: m.E + 30 * R }; };
function solveFrame(clip, f, start, ref, lam) {
  let p = { ...start }, best = evalP(clip, f, p, ref, lam);
  for (let step = 0.16; step >= 0.005; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const k of KEYS) for (const s of [1, -1]) {
        const q = { ...p, [k]: Math.min(LIM[k][1], Math.max(LIM[k][0], p[k] + s * step)) };
        if (q[k] === p[k]) continue;
        const r = evalP(clip, f, q, ref, lam);
        if (r.J < best.J - 1e-9) { p = q; best = r; improved = true; }
      }
    }
  }
  return { p, ...best };
}
const smooth = (S, loop, sig = 1.5) => {
  const N = S.length, R = Math.ceil(sig * 3), out = [];
  for (let i = 0; i < N; i++) { let a = 0, w = 0; for (let j = -R; j <= R; j++) { let k = i + j; if (loop) k = ((k % (N - 1)) + (N - 1)) % (N - 1); else k = Math.min(N - 1, Math.max(0, k)); const g = Math.exp(-(j * j) / (2 * sig * sig)); a += g * S[k]; w += g; } out.push(a / w); }
  if (loop) out[N - 1] = out[0];
  return out;
};
const meta = JSON.parse(fs.readFileSync(path.resolve(HERE, '../source/characters/char-xi-anims.meta.json'), 'utf8'));
const result = { note: '马尾×兜帽纠正角（弧度）。t1→hair_ponytail_01、t2→_02/_03 绕头骨局部 +X；h1→hood_01、h2→hood_02 绕 chest 局部 +X。帧 = 30 fps 关键帧序号。由 art/tools/solve-xi-ponytail-hood.mjs 生成，finish-xi-anims.mjs 写回。', axis: [1, 0, 0], clips: {}, report: {} };
const t0 = Date.now();

for (const clip of anims.animations) {
  if (ONLY && !ONLY.includes(clip.name)) continue;
  const N = Math.max(1, Math.round(clip.duration * FPS)) + 1, loop = !!meta.clips[clip.name]?.loop;
  const base = []; for (let f = 0; f < N; f++) { pose(clip, f, null); base.push(measure().worst); }
  const before = Math.min(...base), bf = base.filter((d) => d < -PEN).length;
  if (before >= -TGT) { result.report[clip.name] = { frames: N, beforeCm: +(-before * 100).toFixed(2), penFramesBefore: bf, fixed: false }; console.log(clip.name.padEnd(18), '干净，不改', (-before * 100).toFixed(2)); continue; }
  const Z = Object.fromEntries(KEYS.map((k) => [k, 0]));
  // 第 1 轮：逐帧独立求（上一帧热启动）
  let P = [], prev = Z;
  for (let f = 0; f < N; f++) { const r = base[f] < -SOFT ? solveFrame(clip, f, prev, null, 0) : { p: Z }; P.push(r.p); prev = r.p; if (process.env.PT_V && base[f] < -SOFT) console.log("    f", f, base[f].toFixed(4), JSON.stringify(r.p), r.worst?.toFixed(4)); }
  // 之后：包络（±3 帧取绝对值最大）→ 高斯平滑 → 逐帧验收；不过的帧（及前后 2 帧）以平滑值为起点、加大余量重求，再来
  const env = (S) => S.map((_, f) => { let m = 0; for (let j = -3; j <= 3; j++) { let k = f + j; k = loop ? ((k % (N - 1)) + (N - 1)) % (N - 1) : Math.min(N - 1, Math.max(0, k)); if (Math.abs(S[k]) > Math.abs(m)) m = S[k]; } return m; });
  let worst = 0, pf = 0, fin = [];
  for (let it = 0; it < 6; it++) {
    const Sm = Object.fromEntries(KEYS.map((k) => [k, smooth(env(P.map((p) => p[k])), loop, 1.5)]));
    const ref = (f) => Object.fromEntries(KEYS.map((k) => [k, Sm[k][f]]));
    fin = []; worst = 0; pf = 0;
    for (let f = 0; f < N; f++) { pose(clip, f, ref(f)); const m = measure(); fin.push(m.worst); worst = Math.min(worst, m.worst); if (m.worst < -PEN) pf++; }
    const bad = fin.map((d) => d < -TGT).map((b, f, a) => a.slice(Math.max(0, f - 2), f + 3).some(Boolean));
    console.log(`  ${clip.name} 轮 ${it}: 最深 ${(-worst * 100).toFixed(2)} cm，穿>2mm ${pf}/${N}，需重求 ${bad.filter(Boolean).length}`);
    const Pn = Array.from({ length: N }, (_, f) => ref(f));
    if (worst >= -TGT || it === 5) { P = Pn; break; }
    for (let f = 0; f < N; f++) if (bad[f]) Pn[f] = solveFrame(clip, f, Pn[f], P[f], 0.3).p;
    P = Pn;
  }
  const r4 = (x) => +x.toFixed(4);
  result.clips[clip.name] = { loop, frames: N, t1: P.map((p) => r4(p.t1)), t2: P.map((p) => r4(p.t2)), h1: P.map((p) => r4(p.h1)), h2: P.map((p) => r4(p.h2)) };
  const mx = (k) => +Math.max(...P.map((p) => Math.abs(p[k]))).toFixed(3);
  result.report[clip.name] = { frames: N, beforeCm: +(-before * 100).toFixed(2), penFramesBefore: bf, afterCm: +(-worst * 100).toFixed(2), penFramesAfter: pf, fixed: true, maxRad: { t1: mx('t1'), t2: mx('t2'), h1: mx('h1'), h2: mx('h2') } };
  console.log(clip.name.padEnd(18), JSON.stringify(result.report[clip.name]), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
fs.writeFileSync(OUT, JSON.stringify(result));
console.log('→', OUT);
