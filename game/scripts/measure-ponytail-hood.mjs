// r4 第 5 项：马尾穿兜帽逐 clip 实测（node，无浏览器，只读 ../art）。
//  马尾 = hair 网格里主权重在 hair_ponytail_01–03 的顶点；兜帽 = body 网格里 hood_01 / hood_02 权重合计 ≥ 0.3 的顶点组成的三角形（LOD0）。
//  每个 clip 30 fps 逐帧 CPU 蒙皮：马尾顶点到兜帽面的带符号最近距离（按最近三角形面法线，< 0 = 在兜帽面里侧），
//  负值再按 verify-father 的假负核对：从颈轴（neck 骨 → head 骨连线上最近点）沿「轴 → 点」打 DoubleSide 射线，打不到兜帽 = 其实在外面。
//  只统计离兜帽面 ≤ 4 cm 的点（更深的是马尾根在帽口里侧，不算穿）。输出 docs/tasks/shots-r4/ponytail-hood.json + 表。
// 环境变量：PT_ART 角色 glb 目录、PT_OUT 输出目录（默认 ../art/models/characters、../docs/tasks/shots-r4）。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/measure-ponytail-hood.mjs [clip前缀,…]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = process.env.PT_ART ? resolve(process.env.PT_ART) : resolve(root, '../art/models/characters');
const OUT = process.env.PT_OUT ? resolve(process.env.PT_OUT) : resolve(root, '../docs/tasks/shots-r4');
mkdirSync(OUT, { recursive: true });
const only = process.argv[2]?.split(',').filter(Boolean) ?? null;
const FPS = 30, NEAR = 0.04, PEN = 0.002;

globalThis.self ??= globalThis;
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)), detectSupport() {} };
const parse = async (f) => { const b = readFileSync(f); return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); };
const [model, anims] = await Promise.all([parse(resolve(ART, 'char-xi.glb')), parse(resolve(ART, 'char-xi-anims.glb'))]);
const scene = model.scene;
const meshes = [];
scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
const pick = (re) => meshes.filter((m) => re.test(m.material.name)).sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
const hair = pick(/xi-hair/), body = pick(/xi-body/);
const boneIdx = (m, names) => names.map((n) => m.skeleton.bones.findIndex((b) => b.name === n)).filter((i) => i >= 0);
const PT = boneIdx(hair, ['hair_ponytail_01', 'hair_ponytail_02', 'hair_ponytail_03']);
const HOOD = boneIdx(body, ['hood_01', 'hood_02']);
const weightOn = (m, i, set) => { const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; let w = 0; for (let k = 0; k < 4; k++) if (set.includes(si.getComponent(i, k))) w += sw.getComponent(i, k); return w; };
const ptVerts = [];
for (let i = 0; i < hair.geometry.attributes.position.count; i++) if (weightOn(hair, i, PT) >= 0.5) ptVerts.push(i);
const hoodTris = [];
{ const ix = body.geometry.index; for (let t = 0; t < ix.count; t += 3) { const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2); if ([a, b, c].every((v) => weightOn(body, v, HOOD) >= 0.3)) hoodTris.push(a, b, c); } }
console.log(`马尾顶点 ${ptVerts.length}（hair LOD0 ${hair.geometry.attributes.position.count}）；兜帽三角形 ${hoodTris.length / 3}`);

const mixer = new THREE.AnimationMixer(scene);
const neck = scene.getObjectByName('neck'), head = scene.getObjectByName('head');
const v = new THREE.Vector3(), hit = {}, tri = new THREE.Triangle(), n = new THREE.Vector3(), ray = new THREE.Ray();
const nA = new THREE.Vector3(), hA = new THREE.Vector3(), cen = new THREE.Vector3(), line = new THREE.Line3();
const rows = [];
for (const clip of anims.animations) {
  if (only && !only.some((p) => clip.name.replace(/^xi-/, '').startsWith(p))) continue;
  mixer.stopAllAction(); mixer.uncacheRoot(scene);
  const act = mixer.clipAction(clip); act.play();
  const frames = Math.max(1, Math.round(clip.duration * FPS));
  let worst = { raw: 0, chk: 0, frame: -1, verts: 0 }, penFrames = 0, minDist = Infinity, nearMax = 0, rawMin = 0;
  for (let f = 0; f <= frames; f++) {
    mixer.setTime(Math.min(f / FPS, clip.duration - 1e-4));
    scene.updateMatrixWorld(true);
    hair.skeleton.update(); body.skeleton.update();
    const arr = new Float32Array(hoodTris.length * 3);
    hoodTris.forEach((i, k) => body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld).toArray(arr, k * 3));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const bvh = new MeshBVH(g);
    neck.getWorldPosition(nA); head.getWorldPosition(hA); line.set(nA, hA);
    let fRaw = 0, fChk = 0, fVerts = 0, fMin = Infinity, fNear = 0;
    for (const i of ptVerts) {
      hair.getVertexPosition(i, v).applyMatrix4(hair.matrixWorld);
      bvh.closestPointToPoint(v, hit);
      fMin = Math.min(fMin, hit.distance);
      if (hit.distance > NEAR) continue;
      fNear++;
      // MeshBVH 给非索引几何生成 g.index 并在建树时重排三元组，hit.faceIndex 指重排后 g.index 的第几个三元组；
      // 必须经 g.index 取顶点（r5 前按 arr[faceIndex*9] 取 → 拿到别的三角形，法线定符号近似随机，美术 r5 指出）。
      const fi = hit.faceIndex * 3, ix = g.index;
      tri.setFromAttributeAndIndices(g.attributes.position, ix.getX(fi), ix.getX(fi + 1), ix.getX(fi + 2)); tri.getNormal(n);
      const raw = n.dot(v.clone().sub(hit.point)) >= 0 ? hit.distance : -hit.distance;
      let chk = raw;
      if (raw < 0) { line.closestPointToPoint(v, false, cen); ray.origin.copy(v); ray.direction.copy(v).sub(cen).normalize(); if (bvh.raycast(ray, THREE.DoubleSide).length === 0) chk = -raw; }
      fRaw = Math.min(fRaw, raw); fChk = Math.min(fChk, chk);
      if (chk < -PEN) fVerts++;
    }
    g.dispose();
    if (fChk < -PEN) penFrames++;
    minDist = Math.min(minDist, fMin); nearMax = Math.max(nearMax, fNear);
    if (fChk < worst.chk) worst = { raw: fRaw, chk: fChk, frame: f, verts: fVerts };
    rawMin = Math.min(rawMin, fRaw);
  }
  const r = { clip: clip.name, frames: frames + 1, maxPenCm: +(-worst.chk * 100).toFixed(2), atFrame: worst.frame, vertsAtWorst: worst.verts, penFrames, rawMinCm: +(rawMin * 100).toFixed(2), minDistCm: +(minDist * 100).toFixed(2), nearVertsMax: nearMax };
  rows.push(r);
  console.log(`${r.clip.padEnd(18)} 帧 ${String(r.frames).padStart(4)}  最深 ${r.maxPenCm.toFixed(2)} cm @${r.atFrame}  当帧穿入顶点 ${r.vertsAtWorst}  穿>2mm 帧 ${r.penFrames}/${r.frames}  最近距 ${r.minDistCm} cm  近点 ${r.nearVertsMax}  raw ${r.rawMinCm}`);
}
writeFileSync(resolve(OUT, `ponytail-hood${only ? '-' + only.join('+') : ''}.json`), JSON.stringify({ ptVerts: ptVerts.length, hoodTris: hoodTris.length / 3, nearM: NEAR, penM: PEN, rows }, null, 2));
