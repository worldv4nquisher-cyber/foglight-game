#!/usr/bin/env node
// 031 / r4 hand-on-head 接触量测 —— 和游戏 test:father（game/scripts/verify-father.mjs）同一量法：
//   - 摆位：父亲根 = 汐根 · T(0, 0, 0.48) · R_y(180°)（game/src/entities/father/clips.ts FATHER_HAND_ON_HEAD），两人同帧起播，汐 xi-stand-gaze 时间 = 父亲时间
//   - 被量面：汐 LOD0 头发蒙皮网格（mat-char-xi-hair，head 骨 0.35 m 内全部三角形，含内层壳 / 发簇内侧 / 马尾），逐帧蒙皮
//   - 量的点：父亲 LOD0 皮肤网格（mat-char-father-skin）里 hand_r + 五指骨权重和 > 0.5 的全部顶点、且离掌心点 ≤ 0.10 m
//     （掌心点 = hand_r 与 middle_01_r 的中点）
//   - 距离：到最近头发三角形的距离，按该三角形面法线定符号（< 0 = 压进头发）—— 即 verify-father 的 skin / skinBone
//   - 「有缝」：该帧手皮肤离头发最近 > 5 mm（verify-father 的 gapFrames）
//   「假负」：按面法线定符号在发簇边缘 / 开口发片的边上会翻号 —— 点其实悬在头发外面几厘米，也被算成负的几厘米。
//     另外给一列「核对后」：负值的点再从头心沿径向往外打一条射线，外面一层头发都没有（0 次穿越）= 点在全部头发外面 → 取 +|d|。
//     游戏 verify-father 目前没有这一步（给程序的待办）。交付线按游戏原口径报，同时给核对后的值和假负帧数。
//   另附：到汐皮肤（face primitive）的同样量法（< 0 = 穿进头皮 / 脸），以及 r3 以前的「径向外包络」量法（radial，仅作对照）
// r3 报的 0.60 cm 用的是径向量法（头心 → 顶点方向从外往里第一个交点，头发 / 兜帽 / 皮肤取最外层，只统计掌心下表面和每指最低点），
//   和游戏「每个手顶点到最近发片、按面法线定符号」不是一回事：
//   径向法在头顶两侧 / 拇指这种斜贴的地方量的是沿径向的高度差，而且发片内侧面（法线朝里）对它不可见；游戏量法会把伸进发片之间、
//   离某片内侧面最近的点算成负的。r4 起以游戏量法为准。
// 用法：node art/tools/measure-father-hoh.mjs [from] [to] [--json out.json] [--xi 目录] [--step 0.5]（--xi 可指向备份，例如 /workspace/bk-xi-head/r3/models/characters）
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const NM = path.resolve(HERE, '../../game/node_modules');
const THREE = await import(path.join(NM, 'three/build/three.module.js'));
const { GLTFLoader } = await import(path.join(NM, 'three/examples/jsm/loaders/GLTFLoader.js'));
const { MeshBVH } = await import(path.join(NM, 'three-mesh-bvh/src/index.js'));
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const jsonOut = opt('--json'); const XD = opt('--xi'); const STEP = Number(opt('--step') ?? 1);   // --step 0.5 = 和 verify-father 一样 60 Hz 取样（含半帧）
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const M = (f) => path.resolve(HERE, '../models/characters/' + f);
const MX = (f) => (XD ? path.join(XD, f) : M(f));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
async function load(file) {
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (/texture_basisu|meshopt/i.test(e.extensionName)) e.dispose();
  const glb = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}
const [cg, ag, xg, xag] = await Promise.all([load(M('char-father.glb')), load(M('char-father-anims.glb')), load(MX('char-xi.glb')), load(MX('char-xi-anims.glb'))]);
const hx = ag.parser.json.animations.find((x) => x.name === 'father-hand-on-head').extras, al = hx.align.handOnHead, E = hx.eventFrames;
const F0 = nums[0] ?? E.handOn, F1 = nums[1] ?? E.handOff;
const c = cg.scene, xs = xg.scene, world = new THREE.Group(); world.add(xs); world.add(c);
c.position.set(0, 0, 0.48); c.rotation.set(0, Math.PI, 0);            // 游戏：父亲根 = 汐根 · T(0,0,0.48) · R_y(180°)
world.updateMatrixWorld(true);
const xm = new THREE.AnimationMixer(xs), xa = xm.clipAction(xag.animations.find((k) => k.name === 'xi-stand-gaze')); xa.play();
const fm = new THREE.AnimationMixer(c), fa = fm.clipAction(ag.animations.find((k) => k.name === 'father-hand-on-head')); fa.setLoop(THREE.LoopOnce); fa.clampWhenFinished = true; fa.play();
const isLod0 = (m) => !/_lod[12]/.test(m.name + (m.parent?.name ?? ''));
const sk = (root, re) => { const o = []; root.traverse((m) => m.isSkinnedMesh && isLod0(m) && re.test(m.material?.name ?? '') && o.push(m)); return o; };
const hair = sk(xs, /^mat-char-xi-hair$/)[0], face = sk(xs, /face/)[0], hand = sk(c, /^mat-char-father-skin$/)[0];
if (!hair || !hand) throw new Error('找不到 汐 LOD0 头发 / 父亲 LOD0 皮肤 网格');
const headB = xs.getObjectByName('head'), handR = c.getObjectByName('hand_r'), mid1 = c.getObjectByName('middle_01_r');
const HAND = /^(hand_r|(thumb|index|middle|ring|pinky)_\d+_r)$/;
const handVerts = (() => { const bi = hand.geometry.attributes.skinIndex, bw = hand.geometry.attributes.skinWeight, k0 = [];
  for (let i = 0; i < bi.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (HAND.test(hand.skeleton.bones[bi.getComponent(i, k)]?.name ?? '')) w += bw.getComponent(i, k); if (w > 0.5) k0.push(i); } return k0; })();
const boneOf = (i) => hand.skeleton.bones[hand.geometry.attributes.skinIndex.getComponent(i, 0)]?.name ?? '';
const wp = (m, i, v = new THREE.Vector3()) => m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
const restHead = headB.getWorldPosition(new THREE.Vector3());
const triList = (m, keepFn) => { const ix = m.geometry.index, v = new THREE.Vector3(), out = []; for (let t = 0; t < ix.count; t += 3) if (keepFn(wp(m, ix.getX(t), v))) out.push(ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)); return out; };
const hairTris = triList(hair, (p) => p.distanceTo(restHead) < 0.35);
const faceTris = face ? triList(face, (p) => p.distanceTo(restHead) < 0.35) : [];
function surfaceOf(m, tris, P, R) {     // 和 verify-father 一样：P 附近 R 内的三角形建 BVH，带符号最近距离
  const cache = new Map(), vp = (i) => { let w = cache.get(i); if (!w) { w = wp(m, i); cache.set(i, w); } return w; };
  const near = []; for (let t = 0; t < tris.length; t += 3) if (vp(tris[t]).distanceTo(P) < R) near.push(tris[t], tris[t + 1], tris[t + 2]);
  if (!near.length) return null;
  const arr = new Float32Array(near.length * 3); near.forEach((i, k) => vp(i).toArray(arr, k * 3));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const bvh = new MeshBVH(g), tri = new THREE.Triangle(), n = new THREE.Vector3(), hit = {}, ray = new THREE.Ray();
  const fn = (x) => { bvh.closestPointToPoint(x, hit); const ix = g.index, f = hit.faceIndex * 3;
    tri.a.fromArray(arr, ix ? ix.getX(f) * 3 : f * 3); tri.b.fromArray(arr, ix ? ix.getX(f + 1) * 3 : f * 3 + 3); tri.c.fromArray(arr, ix ? ix.getX(f + 2) * 3 : f * 3 + 6);
    tri.getNormal(n); return hit.distance * (n.dot(x.clone().sub(hit.point)) >= 0 ? 1 : -1); };
  fn.checked = (x, d) => { if (d >= 0 || !CEN) return d;            // 核对假负：从点沿「头心 → 点」往外，0 次穿越 = 在全部头发外面
    ray.origin.copy(x); ray.direction.copy(x).sub(CEN).normalize(); return bvh.raycast(ray, THREE.DoubleSide).length === 0 ? -d : d; };
  return fn;
}
const FING = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const grp = (b) => (b === 'hand_r' ? 'palm' : FING.find((f) => b.startsWith(f + '_')) ?? 'palm');
const crownL = new THREE.Vector3().fromArray(al.xiCrownRest).sub(new THREE.Vector3(0, 0.09, 0)).applyMatrix4(headB.matrixWorld.clone().invert());   // 头心（发顶下 9 cm，跟 head 骨走）
let CEN = null;
const rows = [];
for (let f = F0; f <= F1 + 1e-9; f += STEP) {
  fa.time = f / hx.fps; xa.time = f / hx.fps; fm.update(0); xm.update(0); world.updateMatrixWorld(true);
  CEN = crownL.clone().applyMatrix4(headB.matrixWorld);
  const P = handR.getWorldPosition(new THREE.Vector3()); if (mid1) P.add(mid1.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  const sH = surfaceOf(hair, hairTris, P, 0.15), sF = faceTris.length ? surfaceOf(face, faceTris, P, 0.15) : null;
  const g = { palm: Infinity, thumb: Infinity, index: Infinity, middle: Infinity, ring: Infinity, pinky: Infinity };
  const gc = { ...g }; let skinC = Infinity, nFalse = 0;
  let skin = Infinity, skinBone = '', scalp = Infinity; const v = new THREE.Vector3();
  for (const i of handVerts) { wp(hand, i, v); if (v.distanceTo(P) > 0.1) continue; const d = sH(v), b = boneOf(i); const k = grp(b); if (d < g[k]) g[k] = d;
    const dc = sH.checked(v, d); if (dc !== d) nFalse++; if (dc < gc[k]) gc[k] = dc; if (dc < skinC) skinC = dc;
    if (d < skin) { skin = d; skinBone = b; } if (sF) scalp = Math.min(scalp, sF(v)); }
  rows.push({ f, palmPt: sH(P), skin, skinBone, ...g, scalp, checked: { skin: skinC, ...gc }, falseNeg: nFalse });
}
const cm = (x) => (Number.isFinite(x) ? (x * 100).toFixed(2) : '  —  ').padStart(6);
console.log(`hand-on-head 接触量测（游戏量法：手皮肤顶点 → 最近头发三角形，按面法线定符号；cm，负 = 压进）帧 ${F0}–${F1}；汐 ${XD ?? 'art/models/characters'}`);
console.log(`  头发 LOD0 ${hairTris.length / 3} 面，手皮肤顶点 ${handVerts.length}`);
console.log('  帧  掌心点  手最深   palm  thumb  index middle   ring  pinky  到皮肤  最深骨');
for (const r of rows) if ((Number.isInteger(r.f) && r.f % 4 === 0) || r.f === F0 || r.f === F1) console.log(`  ${String(r.f).padStart(3)} ${cm(r.palmPt)} ${cm(r.skin)} ${['palm', ...FING].map((k) => cm(r[k])).join(' ')} ${cm(r.scalp)}  ${r.skinBone}`);
const gmin = (k, c) => rows.reduce((m, r) => ((c ? r.checked[k] : r[k]) < (c ? m.checked[k] : m[k]) ? r : m), rows[0]);
console.log('\n  每组整段最深（cm @帧）    游戏原口径        核对假负后');
for (const k of ['palm', ...FING]) { const a = gmin(k, false), b = gmin(k, true); console.log(`  ${k.padEnd(7)}            ${cm(a[k])} @${String(a.f).padEnd(4)}      ${cm(b.checked[k])} @${b.f}`); }
const fneg = rows.filter((r) => r.falseNeg > 0);
console.log(`  有假负顶点的帧：${fneg.length} / ${rows.length}（法线定符号算成负、但点在全部头发外面）`);
const worst = rows.reduce((m, r) => (r.skin < m.skin ? r : m), rows[0]);
const gap = rows.filter((r) => r.skin > 0.005), gapC = rows.filter((r) => r.checked.skin > 0.005);
console.log(`\n  最深压入（手皮肤 → 外层发片）：${cm(worst.skin)} cm @${worst.f} ${worst.skinBone}；每帧最深的范围 ${cm(Math.max(...rows.map((r) => r.skin)))} … ${cm(worst.skin)}`);
console.log(`  有缝的帧（手皮肤离头发 > 5 mm）：${gap.length} / ${rows.length}${gap.length ? '（' + gap.map((r) => r.f).join(',') + '）' : ''}`);
console.log(`  有缝的帧（核对假负后）：${gapC.length} / ${rows.length}${gapC.length ? '（' + gapC.map((r) => r.f).join(',') + '）' : ''}`);
console.log(`  穿到头皮 / 脸皮肤的帧（到皮肤 < 0）：${rows.filter((r) => r.scalp < 0).length} / ${rows.length}`);
console.log(`  掌心点在头发里的帧：${rows.filter((r) => r.palmPt < 0).length} / ${rows.length}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows));
