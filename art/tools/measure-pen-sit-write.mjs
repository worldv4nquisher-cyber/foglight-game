// P3 笔：xi-sit-write 整段采样，笔挂 hand_r_socket（局部单位矩阵）
//   node art/tools/measure-pen-sit-write.mjs [--xi dir] [--pen file] [--json out] [--design]
// 报：笔尖到日志纸面高度（竖直向下射线打 prop-journal-father-open_lod0，日志放 lamp-room-journal-socket = 汐根前 0.38 m、桌面 0.68）、
//     笔杆穿手指（a 笔顶点在手皮肤内的深度：最近三角形法线 + 射线奇偶；b 手顶点在笔体内的深度：按笔的半径剖面），以及各指尖到笔面的最近距离。
// 手皮肤 = char-xi lod0 蒙皮顶点里 hand_r / 右手指骨权重和 ≥ 0.5 的部分（三角形三点都在才算）。BVH faceIndex 按 g.index 取三角形。
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const HERE = path.dirname(new URL(import.meta.url).pathname), NM = path.resolve(HERE, '../../game/node_modules');
const THREE = await import(path.join(NM, 'three/build/three.module.js'));
const { GLTFLoader } = await import(path.join(NM, 'three/examples/jsm/loaders/GLTFLoader.js'));
const { MeshBVH } = await import(path.join(NM, 'three-mesh-bvh/src/index.js'));
const args = process.argv.slice(2), opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const XD = opt('--xi') ?? path.resolve(HERE, '../models/characters'), PEN = opt('--pen') ?? path.resolve(HERE, '../models/props/prop-fountain-pen.glb');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
async function load(file) {
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (/texture_basisu|meshopt|webp/i.test(e.extensionName)) e.dispose();
  const glb = await io.writeBinary(doc);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}
const [xg, ag, jg, pg] = await Promise.all([load(path.join(XD, 'char-xi.glb')), load(path.join(XD, 'char-xi-anims.glb')), load(path.resolve(HERE, '../models/props/prop-journal-father.glb')), load(PEN)]);
const CLIP = 'xi-sit-write', ex = ag.parser.json.animations.find((a) => a.name === CLIP).extras, al = ex.align.sitWrite, FR = ex.frames, FPS = ex.fps;
const scene = new THREE.Scene(); scene.add(xg.scene);
const mixer = new THREE.AnimationMixer(xg.scene); mixer.clipAction(ag.animations.find((a) => a.name === CLIP)).play();
const sock = xg.scene.getObjectByName('hand_r_socket');
const r4 = (v) => +v.toFixed(4), cm = (v) => +(v * 100).toFixed(2);
if (args.includes('--design')) {
  mixer.setTime(0); xg.scene.updateMatrixWorld(true); const iv = sock.matrixWorld.clone().invert();
  const L = (a) => new THREE.Vector3(...a).applyMatrix4(iv).toArray().map((x) => +x.toFixed(5));
  console.log(JSON.stringify({ tip: L(al.penTip0), tail: L(al.penTail0), side: new THREE.Vector3(-1, 0, 0).transformDirection(iv).toArray().map((x) => +x.toFixed(4)) })); process.exit(0);
}
// 日志（摊开）放到汐根坐标 (0, deskTop, 0.38)，与 lamp-room-journal-socket 同朝向
jg.scene.position.set(0, al.deskTop, 0.38); jg.scene.updateMatrixWorld(true);
const jm = jg.scene.getObjectByName('prop-journal-father-open_lod0'); const jgeo = [];
jm.traverse((o) => { if (o.isMesh) jgeo.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); });
const jG = mergeGeoms(jgeo); const jB = new MeshBVH(jG);
// 笔（lod0，socket 局部）
const pm = []; pg.scene.getObjectByName('prop-fountain-pen_lod0').traverse((o) => { if (o.isMesh) pm.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); });
const penG = mergeGeoms(pm), penP = penG.attributes.position;
const tipL = new THREE.Vector3(...pg.parser.json.nodes[0].extras.tipLocal), tailL = new THREE.Vector3(...pg.parser.json.nodes[0].extras.tailLocal);
const axis = tailL.clone().sub(tipL), LEN = axis.length(); axis.normalize();
const PROF = [[0, 0], [0.019, 0.0034], [0.0195, 0.0042], [0.042, 0.0047], [0.0425, 0.0057], [0.0855, 0.0057], [0.086, 0.0065], [0.133, 0.0062], [0.14, 0.003]];
const rAt = (s) => { if (s < 0 || s > LEN) return -1; for (let i = 1; i < PROF.length; i++) if (s <= PROF[i][0]) { const [s0, a] = PROF[i - 1], [s1, b] = PROF[i]; return a + (b - a) * (s - s0) / Math.max(s1 - s0, 1e-9); } return -1; };
// 右手皮肤
const HB = /^(hand_r|(thumb|index|middle|ring|pinky)_0[123]_r)$/;
const hands = [];
xg.scene.traverse((o) => {
  if (!o.isSkinnedMesh || !/lod0/.test(o.name + (o.parent?.name ?? ''))) return;
  const bi = o.geometry.attributes.skinIndex, bw = o.geometry.attributes.skinWeight, bones = o.skeleton.bones, sel = new Map(), dom = [];
  for (let i = 0; i < bi.count; i++) { let w = 0, best = -1, bwv = 0; for (let k = 0; k < 4; k++) { const b = bones[bi.getComponent(i, k)], ww = bw.getComponent(i, k); if (HB.test(b.name)) { w += ww; if (ww > bwv) { bwv = ww; best = b.name; } } } if (w >= 0.5) { sel.set(i, sel.size); dom.push(best); } }
  if (!sel.size) return;
  const ix = o.geometry.index, tri = [];
  for (let t = 0; t < ix.count; t += 3) { const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2); if (sel.has(a) && sel.has(b) && sel.has(c)) tri.push(sel.get(a), sel.get(b), sel.get(c)); }
  hands.push({ o, ids: [...sel.keys()], dom, tri });
});
const nHandV = hands.reduce((s, h) => s + h.ids.length, 0);
function mergeGeoms(gs) {
  const P = [], I = []; for (const g of gs) { const base = P.length / 3, p = g.attributes.position; for (let i = 0; i < p.count; i++) P.push(p.getX(i), p.getY(i), p.getZ(i)); if (g.index) for (let k = 0; k < g.index.count; k++) I.push(base + g.index.getX(k)); else for (let k = 0; k < p.count; k++) I.push(base + k); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); return g;
}
const v = new THREE.Vector3(), w = new THREE.Vector3(), tri = new THREE.Triangle(), n = new THREE.Vector3(), ray = new THREE.Ray(), down = new THREE.Vector3(0, -1, 0);
const DIRS = [new THREE.Vector3(1, 0.13, 0.07).normalize(), new THREE.Vector3(-0.1, 1, 0.21).normalize(), new THREE.Vector3(0.17, -0.08, 1).normalize()];
const rows = [];
for (let f = 0; f < FR; f++) {
  mixer.setTime(f / FPS); xg.scene.updateMatrixWorld(true);
  const SM = sock.matrixWorld, SI = SM.clone().invert();
  // 手皮肤（世界）
  const P = [], I = [], DOM = [], HL = [];
  for (const h of hands) { const base = P.length / 3; for (let k = 0; k < h.ids.length; k++) { h.o.getVertexPosition(h.ids[k], v); v.applyMatrix4(h.o.matrixWorld); P.push(v.x, v.y, v.z); DOM.push(h.dom[k]); HL.push(v.clone().applyMatrix4(SI)); } for (const t of h.tri) I.push(base + t); }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); hg.setIndex(I); const hb = new MeshBVH(hg); const hix = hg.index;
  // a：笔顶点在手内
  let aMax = 0, aBone = '', minGap = { thumb: 9, index: 9, middle: 9 };
  for (let i = 0; i < penP.count; i++) {
    v.fromBufferAttribute(penP, i).applyMatrix4(SM);
    const hit = hb.closestPointToPoint(v); if (!hit) continue;
    const fi = hit.faceIndex * 3; tri.setFromAttributeAndIndices(hg.attributes.position, hix.getX(fi), hix.getX(fi + 1), hix.getX(fi + 2)); tri.getNormal(n);
    const sgn = n.dot(w.copy(v).sub(hit.point));
    if (sgn < 0) { let odd = 0; for (const d of DIRS) { ray.set(v, d); if (hb.raycast(ray, THREE.DoubleSide).length % 2 === 1) odd++; } if (odd >= 2 && hit.distance > aMax) { aMax = hit.distance; aBone = DOM[hix.getX(fi)]; } }
  }
  // b：手顶点在笔体内；各指到笔面最近距离
  let bMax = 0, bBone = '';
  for (let k = 0; k < HL.length; k++) {
    const q = HL[k].clone().sub(tipL), s = q.dot(axis), d = q.addScaledVector(axis, -s).length(), r = rAt(s);
    const gap = r < 0 ? 9 : d - r; const fn = /^(thumb|index|middle)_03/.exec(DOM[k])?.[1]; if (fn) minGap[fn] = Math.min(minGap[fn], gap);
    if (r > 0 && r - d > bMax) { bMax = r - d; bBone = DOM[k]; }
  }
  // 笔尖到纸面
  const tipW = tipL.clone().applyMatrix4(SM); ray.set(tipW.clone().add(new THREE.Vector3(0, 0.3, 0)), down);
  const jh = jB.raycastFirst(ray, THREE.DoubleSide); const paperY = jh ? jh.point.y : null;
  // 笔最低点相对纸面（整支笔有没有压进纸）
  let low = Infinity; for (let i = 0; i < penP.count; i++) { v.fromBufferAttribute(penP, i).applyMatrix4(SM); ray.set(v.clone().add(new THREE.Vector3(0, 0.3, 0)), down); const hh = jB.raycastFirst(ray, THREE.DoubleSide); if (hh) low = Math.min(low, v.y - hh.point.y); }
  const E = ex.eventFrames, down_ = (f >= E.penDown1 && f <= E.penUp1) || (f >= E.penDown2 && f <= E.penUp2);
  rows.push({ f, penDown: down_, tip: tipW.toArray().map(r4), paperY: paperY == null ? null : r4(paperY), tipAbovePaperCm: paperY == null ? null : cm(tipW.y - paperY), penLowestAbovePaperCm: cm(low), penInHandCm: cm(aMax), penInHandBone: aBone, handInPenCm: cm(bMax), handInPenBone: bBone, gapCm: Object.fromEntries(Object.entries(minGap).map(([k, x]) => [k, cm(x)])) });
  if (process.env.DBG && f === 0) console.log("DBG", HL.length, HL.slice(0, 2).map((x) => x.toArray()), tipL.toArray(), axis.toArray()); hg.dispose();
}
const S = (k, sel = () => true) => { const xs = rows.filter(sel).map((r) => r[k]).filter((x) => x != null); return [Math.min(...xs), Math.max(...xs)]; };
const worst = (k) => rows.reduce((a, r) => (r[k] > a[k] ? r : a));
const sum = {
  clip: CLIP, frames: FR, handVerts: nHandV, penTris: penG.index.count / 3,
  tipAbovePaperCm: { penDown: S('tipAbovePaperCm', (r) => r.penDown), lift: S('tipAbovePaperCm', (r) => !r.penDown), all: S('tipAbovePaperCm') },
  penLowestAbovePaperCm: S('penLowestAbovePaperCm'),
  tipOffPage: rows.filter((r) => r.paperY == null).map((r) => r.f),
  penInHandMaxCm: worst('penInHandCm').penInHandCm, penInHandAt: [worst('penInHandCm').f, worst('penInHandCm').penInHandBone], framesPenInHandOver2mm: rows.filter((r) => r.penInHandCm > 0.2).length,
  handInPenMaxCm: worst('handInPenCm').handInPenCm, handInPenAt: [worst('handInPenCm').f, worst('handInPenCm').handInPenBone], framesHandInPenOver2mm: rows.filter((r) => r.handInPenCm > 0.2).length,
  fingerGapCm: Object.fromEntries(['thumb', 'index', 'middle'].map((k) => { const xs = rows.map((r) => r.gapCm[k]); return [k, [Math.min(...xs), Math.max(...xs)]]; })),
};
console.log(JSON.stringify(sum, null, 1));
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ summary: sum, rows }, null, 1));
