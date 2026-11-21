#!/usr/bin/env node
// 031 父亲动画自检：three.js GLTFLoader + AnimationMixer（与游戏同一套）加载 char-father.glb + char-father-anims.glb，逐 clip 检查：
//   1. clip 名与 031 需求单一致、循环标记；2. 每条轨道都绑定到 char-father.glb 的同名节点、无 NaN；3. 同名关节静止 TRS 一致、hand_r_socket 一致；
//   4. 循环 clip 首尾相同；5. walk-away：触地点实测速度 = extras.strideSpeed、滑移；6. 无网格、≤ 15 MB；7. 网格最低点；
//   8. hand-on-head：按 extras.align.handOnHead 摆放 char-xi.glb + char-xi-anims.glb（xi-stand-gaze），两个 mixer 同步逐帧，
//      实测父亲右手（蒙皮顶点）到汐头部/头发（蒙皮顶点）的最近距离：贴住段应 ≈ 0（不穿、不悬空），其他段不碰到她。
// 用法：node art/tools/verify-father-anims.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const THREE_DIR = path.resolve(HERE, '../../game/node_modules/three');
const THREE = await import(path.join(THREE_DIR, 'build/three.module.js'));
const { GLTFLoader } = await import(path.join(THREE_DIR, 'examples/jsm/loaders/GLTFLoader.js'));
const M = (f) => path.resolve(HERE, '../models/characters/' + f);
const CHAR = M('char-father.glb'), ANIMS = M('char-father-anims.glb');
const TICKET = { 'father-stand-gaze': true, 'father-walk-away': true, 'father-hand-on-head': false };   // 名字 → 循环
let errors = 0, warns = 0;
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { errors++; console.log('  ✗ ' + m); }, warn = (m) => { warns++; console.log('  ! ' + m); };

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
async function loadGltf(file, stripTextures) {
  const doc = await io.read(file);
  if (stripTextures) { for (const t of doc.getRoot().listTextures()) t.dispose(); for (const e of doc.getRoot().listExtensionsUsed()) if (/texture_basisu/i.test(e.extensionName)) e.dispose(); }
  for (const e of doc.getRoot().listExtensionsUsed()) if (/meshopt/i.test(e.extensionName)) e.dispose();
  const glb = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}
const cg = await loadGltf(CHAR, true), ag = await loadGltf(ANIMS, false);
const c = cg.scene, a = ag.scene;
console.log(`■ ${path.relative(process.cwd(), ANIMS)}（${(fs.statSync(ANIMS).size / 1024).toFixed(0)} KB）+ char-father.glb`);
const exOf = (n) => ag.parser.json.animations.find((x) => x.name === n)?.extras ?? {};

// 1. 名字、循环
const names = ag.animations.map((x) => x.name);
const missing = Object.keys(TICKET).filter((n) => !names.includes(n)), extra = names.filter((n) => !(n in TICKET));
missing.length ? bad('缺 clip：' + missing.join(', ')) : ok('3 个 clip 名与 031 需求单一致：' + Object.keys(TICKET).join(', '));
if (extra.length) bad('需求单里没有的 clip：' + extra.join(', '));
const wrongLoop = Object.entries(TICKET).filter(([n, l]) => !!exOf(n).loop !== l).map(([n]) => n);
wrongLoop.length ? bad('循环标记不对：' + wrongLoop.join(', ')) : ok('循环：stand-gaze / walk-away 循环，hand-on-head 播一次');
const rx = ag.parser.json.nodes.find((n) => n.extras?.skeleton)?.extras ?? {};
rx.inPlace === true && rx.forward === '+Z' && rx.bakedSecondary === true && rx.rig === 'char-father' ? ok(`根 extras：rig ${rx.rig}、inPlace、forward +Z、bakedSecondary、swingBones ${rx.swingBones.length} 根`) : bad('根 extras 不全');
const hx = exOf('father-hand-on-head');
for (const e of ['reachStart', 'handOn', 'strokeA', 'strokeB', 'handOff', 'armDown']) if (!(hx.events?.[e] >= 0 && hx.eventFrames?.[e] != null)) bad('hand-on-head 缺事件 ' + e);
hx.align?.handOnHead?.xiClip === 'xi-stand-gaze' ? ok('hand-on-head：events / eventFrames / align.handOnHead 都在') : bad('hand-on-head 缺 align.handOnHead');
for (const n of Object.keys(TICKET)) if (exOf(n).prop) bad(n + '：带了道具（R1：不提灯）');
let meshCount = 0; a.traverse((o) => { if (o.isMesh) meshCount++; });
meshCount ? bad(`动画文件里有 ${meshCount} 个网格`) : ok('动画文件无网格');
fs.statSync(ANIMS).size <= 15 * 1024 * 1024 ? ok('≤ 15 MB') : bad('超过 15 MB');

// 3. 静止 TRS
const byName = (root) => { const m = new Map(); root.traverse((o) => { if (o.name) m.set(o.name, o); }); return m; };
const cn = byName(c), an = byName(a);
const skinned = []; c.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
const lod0 = skinned.find((m) => /lod0/.test(m.name) || /lod0/.test(m.parent?.name ?? '')) ?? skinned[0];
const boneNames = new Set(lod0.skeleton.bones.map((b) => b.name));
let joints = 0; const trsBad = [];
for (const n of boneNames) {
  const x = cn.get(n), y = an.get(n);
  if (!y) { trsBad.push(n + '（动画文件里没有）'); continue; }
  joints++;
  const d = Math.max(x.position.distanceTo(y.position), 1 - Math.abs(x.quaternion.dot(y.quaternion)), x.scale.distanceTo(y.scale));
  if (d > 1e-4) trsBad.push(`${n} Δ${d.toExponential(1)}`);
}
trsBad.length ? bad('静止 TRS 不一致：' + trsBad.slice(0, 6).join(', ')) : ok(`${joints} 个关节静止 TRS 与 char-father.glb 一致`);
const sk = an.get('hand_r_socket'), skc = cn.get('hand_r_socket');
sk && skc && sk.parent.name === skc.parent.name && sk.position.distanceTo(skc.position) < 1e-4 ? ok('hand_r_socket 两边一致（父骨 hand_r）') : bad('hand_r_socket 不一致');

// 2. 绑定、NaN
let e0 = errors;
for (const clip of ag.animations) {
  let unbound = [], nan = 0;
  for (const t of clip.tracks) {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(t.name);
    if (!THREE.PropertyBinding.findNode(c, nodeName)) unbound.push(nodeName);
    for (const v of t.values) if (!Number.isFinite(v)) nan++;
    for (const v of t.times) if (!Number.isFinite(v)) nan++;
  }
  if (unbound.length) bad(`${clip.name}: ${unbound.length} 条轨道绑不上 (${unbound.slice(0, 3)})`);
  if (nan) bad(`${clip.name}: ${nan} 个 NaN`);
}
if (errors === e0) ok(`${ag.animations.reduce((s, x) => s + x.tracks.length, 0)} 条轨道全部绑定到 char-father.glb，无 NaN`);

// 逐 clip 采样
const mixer = new THREE.AnimationMixer(c);
c.updateMatrixWorld(true);
const contactLocal = {};
for (const s of ['l', 'r']) {   // 父亲鞋底参考点：踝高 0.092，鞋跟 −0.080、前掌 +0.153（glTF，前 = +Z）
  const fb = cn.get('foot_' + s), inv = fb.matrixWorld.clone().invert(), ank = new THREE.Vector3().setFromMatrixPosition(fb.matrixWorld);
  contactLocal[s] = { heel: ank.clone().add(new THREE.Vector3(0, -0.092, -0.080)).applyMatrix4(inv), ball: ank.clone().add(new THREE.Vector3(0, -0.092, 0.153)).applyMatrix4(inv) };
}
const rows = [];
for (const clip of ag.animations) {
  const ex = exOf(clip.name);
  mixer.stopAllAction(); const act = mixer.clipAction(clip); act.setLoop(ex.loop ? THREE.LoopRepeat : THREE.LoopOnce); act.clampWhenFinished = true; act.play();
  const nf = ex.frames, fps = ex.fps ?? 30, n = ex.loop ? nf - 1 : nf;
  const S = [];
  for (let f = 0; f < nf; f++) {
    act.time = f / fps; if (ex.loop && f === nf - 1) act.time = clip.duration - 1e-9;
    mixer.update(0); c.updateMatrixWorld(true);
    const s = { q: new Map() };
    for (const b of boneNames) s.q.set(b, cn.get(b).quaternion.clone());
    for (const side of ['l', 'r']) for (const k of ['heel', 'ball']) s[side + k] = contactLocal[side][k].clone().applyMatrix4(cn.get('foot_' + side).matrixWorld);
    if (f % 6 === 0 || f === nf - 1) { lod0.computeBoundingBox(); s.box = lod0.boundingBox.clone(); }
    S.push(s);
  }
  const r = { name: clip.name, frames: nf, loop: !!ex.loop };
  if (ex.loop) {
    let d = 0; for (const b of boneNames) d = Math.max(d, 1 - Math.abs(S[0].q.get(b).dot(S[nf - 1].q.get(b))));
    r.loopDiff = d; d < 1e-6 ? null : bad(`${clip.name}: 循环首尾不一致 ${d}`);
  }
  if (ex.strideSpeed) {
    const v = [], slide = [];
    for (const side of ['l', 'r']) for (let f = 0; f < n; f++) for (const k of ['heel', 'ball']) {
      const a0 = S[f][side + k], a1 = S[f + 1][side + k];
      if (a0.y < 0.004 && a1.y < 0.004) { const vel = a1.clone().sub(a0).multiplyScalar(fps); v.push(-vel.z); slide.push(Math.hypot(vel.x, vel.z + ex.strideSpeed)); }
    }
    v.sort((x, y) => x - y); r.contactSpeed = v[v.length >> 1]; r.slideP95 = slide.sort((x, y) => x - y)[Math.floor(slide.length * 0.95)];
    Math.abs(r.contactSpeed - ex.strideSpeed) < 0.02 ? null : bad(`${clip.name}: 触地速度 ${r.contactSpeed.toFixed(3)} ≠ ${ex.strideSpeed}`);
  }
  const boxes = S.filter((s) => s.box).map((s) => s.box);
  r.minY = Math.min(...boxes.map((b) => b.min.y)); r.maxY = Math.max(...boxes.map((b) => b.max.y));
  if (r.minY < -0.02 || r.minY > 0.03) warn(`${clip.name}: 网格最低点 ${r.minY.toFixed(3)} m`);
  rows.push(r);
}
mixer.stopAllAction();

// 8. hand-on-head 与汐配合
const al = hx.align.handOnHead;
const xg = await loadGltf(M('char-xi.glb'), true), xag = await loadGltf(M('char-xi-anims.glb'), false);
const xs = xg.scene; const xclip = xag.animations.find((k) => k.name === al.xiClip);
const xsk = []; xs.traverse((o) => { if (o.isSkinnedMesh) xsk.push(o); });
const xlod0s = xsk.filter((m) => /lod0/.test(m.name));   // 汐 lod0 按材质拆成 3 个 primitive（头发在别的 primitive 里），全取
const world = new THREE.Group(); world.add(xs); world.add(c);     // 汐在原点；父亲按 align 摆
c.position.fromArray(al.fatherRootInXiSpace); c.rotation.set(0, THREE.MathUtils.degToRad(al.fatherYawDegInXiSpace), 0);
const xm = new THREE.AnimationMixer(xs), xa = xm.clipAction(xclip); xa.setLoop(THREE.LoopRepeat); xa.play();
const fm = new THREE.AnimationMixer(c), fa = fm.clipAction(ag.animations.find((k) => k.name === 'father-hand-on-head')); fa.setLoop(THREE.LoopOnce); fa.clampWhenFinished = true; fa.play();
const wIdx = (mesh, pred) => {   // 主要受 pred 骨骼影响的顶点
  const sw = mesh.geometry.attributes.skinWeight, si = mesh.geometry.attributes.skinIndex, bones = mesh.skeleton.bones, out = [];
  for (let i = 0; i < sw.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (pred(bones[si.getComponent(i, k)].name)) w += sw.getComponent(i, k); if (w > 0.5) out.push(i); }
  return out;
};
const flod0s = []; c.traverse((o) => { if (o.isSkinnedMesh && (/lod0/.test(o.name) || /lod0/.test(o.parent?.name ?? ''))) flod0s.push(o); });
const handV = flod0s.map((m) => wIdx(m, (n) => n === 'hand_r' || /^(index|middle|ring|pinky|thumb)_0\d_r$/.test(n)));
const xiV = xlod0s.map((m) => wIdx(m, (n) => /^(head|hair)/.test(n) || n === 'neck'));
const P = (mesh, idx) => { mesh.updateMatrixWorld(true); const v = new THREE.Vector3(); return idx.map((i) => mesh.getVertexPosition(i, v.set(0, 0, 0)).clone().applyMatrix4(mesh.matrixWorld)); };
const E = hx.eventFrames, fps = hx.fps;
const samples = [];
for (let f = 0; f < hx.frames; f += 4) {
  fa.time = f / fps; xa.time = (f / fps) % xclip.duration; fm.update(0); xm.update(0); world.updateMatrixWorld(true);
  const H = flod0s.flatMap((m, k) => P(m, handV[k])), Xv = xlod0s.flatMap((m, k) => P(m, xiV[k]));
  let dmin = 1e9; for (const h of H) for (const x of Xv) { const d = h.distanceToSquared(x); if (d < dmin) dmin = d; }
  samples.push([f, Math.sqrt(dmin)]);
}
const on = samples.filter(([f]) => f >= E.handOn + 2 && f <= E.handOff - 2), off = samples.filter(([f]) => f < E.handOn - 10 || f > E.handOff + 10);
const onMax = Math.max(...on.map((s) => s[1])), offMin = Math.min(...off.map((s) => s[1]));
onMax < 0.02 ? ok(`hand-on-head：贴住段（第 ${E.handOn}–${E.handOff} 帧）手到汐头发最近距离 ≤ ${(onMax * 100).toFixed(1)} cm（顶点间距，非悬空）`) : bad(`hand-on-head：贴住段手离汐头最远 ${(onMax * 100).toFixed(1)} cm（悬空）`);
offMin > 0.03 ? ok(`hand-on-head：抬手 / 收手途中手离汐头 ≥ ${(offMin * 100).toFixed(1)} cm（不扫过她）`) : bad(`hand-on-head：抬手 / 收手途中离汐头只有 ${(offMin * 100).toFixed(1)} cm`);
console.log('    手—汐头最近距离（cm，每 4 帧）：' + samples.map(([f, d]) => `${f}:${(d * 100).toFixed(1)}`).join(' '));

console.log('\n  clip                    帧   循环  触地速度(实测/标称)  滑移P95  首尾差    网格 y 范围');
for (const r of rows) {
  const ex = exOf(r.name);
  console.log('  ' + r.name.padEnd(22) + String(r.frames).padStart(4) + (r.loop ? '   是  ' : '   否  ') +
    (r.contactSpeed != null ? `${r.contactSpeed.toFixed(3)}/${ex.strideSpeed}`.padEnd(20) : ''.padEnd(20)) +
    (r.slideP95 != null ? r.slideP95.toFixed(3).padEnd(9) : ''.padEnd(9)) + (r.loopDiff != null ? r.loopDiff.toExponential(0).padEnd(9) : ''.padEnd(9)) + `${r.minY.toFixed(3)}…${r.maxY.toFixed(3)}`);
}
console.log(`\n${errors ? '✗ 有错误 ' + errors : '✓ 全部通过'}${warns ? `（警告 ${warns}）` : ''}`);
process.exit(errors ? 1 : 0);
