// P3 钢笔接入：程序侧独立复测（node，无浏览器，只读 ../art；不用美术的 art/tools/measure-pen-sit-write.mjs）。
//  场景按游戏摆：env-lamp-room-ch1 的 lamp-room-sit-write = 汐根（朝向 = 站位 → lamp-room-journal-socket，同 ending.ts sitLocal），
//  日志 prop-journal-father（摊开 -open_lod0）挂 lamp-room-journal-socket（同 s3/dressing.ts），笔按 GLB 根 extras.attach 挂（src/entities/xi/clipProp.ts 同一套读法）。
//  逐帧（xi-sit-write 全部帧，30 fps）：
//   1) 笔尖（-tip 节点）到纸面：笔尖正上方 5 cm 竖直向下打日志（DoubleSide），纸面 y = 第一次命中；d = 笔尖 y − 纸面 y（< 0 = 扎进纸）；
//      落笔段 = clip extras.eventFrames 的 [penDown, penUp)；同时报桌面高度（同一点向下打灯室 GLB 的桌子，排除日志）。
//   2) 笔穿手：手皮肤 = char-xi_lod0 里 hand_r 子树骨权重和 ≥ 0.5 的顶点（三角形三点都在）；笔 lod0 顶点到手皮肤的带符号距离
//      （最近三角形面法线，< 0 = 在里侧），负值再用射线奇偶核对（3 个方向多数票），报最深。
//  另外：其余 clip 与备份逐通道比对（PEN_OLD 指定旧 char-xi-anims.glb），extras 差异也列出。
//  PEN_XI_LOD=1：手皮肤取 char-xi 的 LOD1 网格（结果写 measure-pen-sit-write-lod1.json）。
//  用法：node --import ./scripts/register-ts-paths.mjs scripts/measure-pen-sit-write.mjs   环境变量 PEN_OUT（默认 ../docs/tasks/shots-035/pen）、PEN_OLD
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(root, '../art/models');
const OUT = process.env.PEN_OUT ? resolve(process.env.PEN_OUT) : resolve(root, '../docs/tasks/shots-035/pen');
const OLD = process.env.PEN_OLD ? resolve(process.env.PEN_OLD) : null;
mkdirSync(OUT, { recursive: true });

globalThis.self ??= globalThis;
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
const { readClipPropAttach } = await import('../src/entities/xi/clipProp.ts');
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)), detectSupport() {} };
const parse = async (f) => { const b = readFileSync(f); return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); };
const [xg, ag, pg, jg, rg] = await Promise.all([
  parse(resolve(ART, 'characters/char-xi.glb')),
  parse(resolve(ART, 'characters/char-xi-anims.glb')),
  parse(resolve(ART, 'props/prop-fountain-pen.glb')),
  parse(resolve(ART, 'props/prop-journal-father.glb')),
  parse(resolve(ART, 'env/env-lamp-room-ch1.glb')),
]);
const cm = (v) => +(v * 100).toFixed(3);
const out = { files: {}, attach: null, frames: [], summary: {} };

// ---- 场景：灯室 GLB 原样（S3 局部），汐根 = lamp-room-sit-write，日志 = lamp-room-journal-socket
const scene = new THREE.Scene();
scene.add(rg.scene);
rg.scene.updateMatrixWorld(true);
const sitN = rg.scene.getObjectByName('lamp-room-sit-write');
const jsN = rg.scene.getObjectByName('lamp-room-journal-socket');
const sit = sitN.getWorldPosition(new THREE.Vector3());
const js = jsN.getWorldPosition(new THREE.Vector3());
const dir = js.clone().sub(sit).setY(0).normalize();
const xi = xg.scene;
xi.position.copy(sit);
xi.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
scene.add(xi);
const jq = new THREE.Quaternion();
jsN.getWorldQuaternion(jq);
jg.scene.position.copy(js);
jg.scene.quaternion.copy(jq);
for (const n of ['prop-journal-father-closed_lod0', 'prop-journal-father-closed_lod1', 'prop-journal-father-closed_lod2']) {
  const o = jg.scene.getObjectByName(n);
  if (o) o.visible = false;
}
scene.add(jg.scene);
scene.updateMatrixWorld(true);
out.place = { sit: sit.toArray().map((x) => +x.toFixed(4)), journal: js.toArray().map((x) => +x.toFixed(4)), aheadM: +js.clone().sub(sit).setY(0).length().toFixed(4), sitExtras: sitN.userData };

// ---- 笔：按 extras.attach 挂（与游戏同一读法）
const { attach, error } = readClipPropAttach(pg.scene);
if (!attach) throw new Error('extras.attach 读不到：' + error);
out.attach = { socket: attach.socket, clip: attach.clip, localMatrix: attach.localMatrix, identity: attach.matrix.equals(new THREE.Matrix4()) };
const sock = xi.getObjectByName(attach.socket);
if (!sock) throw new Error('char-xi 没有 ' + attach.socket);
attach.matrix.decompose(pg.scene.position, pg.scene.quaternion, pg.scene.scale);
sock.add(pg.scene);
const tipN = pg.scene.getObjectByName('prop-fountain-pen-tip');
const penLod0 = pg.scene.getObjectByName('prop-fountain-pen_lod0');
const penMeshes = [];
penLod0.traverse((o) => o.isMesh && penMeshes.push(o));
let ext = {};
pg.scene.traverse((o) => { if (o.userData?.tipLocal && !ext.tipLocal) ext = o.userData; });
out.penExtras = { tipLocal: ext.tipLocal, tailLocal: ext.tailLocal, gripLocal: ext.gripLocal, tipNode: tipN.position.toArray() };

// ---- 动画
const clipJ = ag.parser.json.animations.find((a) => a.name === attach.clip);
const ex = clipJ?.extras ?? {};
const clip = ag.animations.find((a) => a.name === attach.clip);
if (!clip) throw new Error('anims 里没有 ' + attach.clip);
const mixer = new THREE.AnimationMixer(xi);
mixer.clipAction(clip).play();
const FPS = ex.fps ?? 30;
const FR = ex.frames ?? Math.round(clip.duration * FPS) + 1;
const ev = ex.eventFrames ?? {};
const downs = [[ev.penDown1, ev.penUp1], [ev.penDown2, ev.penUp2]].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
const isDown = (f) => downs.some(([a, b]) => f >= a && f <= b);

// ---- 射线目标：日志纸面（open_lod0 子树）、桌子（灯室里排除日志的网格）
const ray = new THREE.Raycaster();
const journalOpen = jg.scene.getObjectByName('prop-journal-father-open_lod0');
const jMeshes = [];
journalOpen.traverse((o) => o.isMesh && (o.material.side = THREE.DoubleSide, jMeshes.push(o)));
const roomMeshes = [];
rg.scene.traverse((o) => { if (o.isMesh && o.visible && !/_lod[12]$/.test(o.name)) { o.material.side = THREE.DoubleSide; roomMeshes.push(o); } });
const downHit = (p, meshes) => {
  ray.set(new THREE.Vector3(p.x, p.y + 0.05, p.z), new THREE.Vector3(0, -1, 0));
  ray.far = 0.3;
  return ray.intersectObjects(meshes, false)[0] ?? null;
};

// ---- 手皮肤
const XI_LOD = +(process.env.PEN_XI_LOD ?? 0); // 9ab5cff 起高 / 标准档汐近处是 LOD1：PEN_XI_LOD=1 量 LOD1 的手
// 多材质网格拆成 char-xi_lodN / _lodN_1 / _lodN_2 几个子网格：取该级里手骨权重 ≥ 0.5 顶点最多的那个（= 皮肤）
const handR = xi.getObjectByName('hand_r');
const handBoneObjs = [];
handR.traverse((o) => { if (o.isBone && o !== sock) handBoneObjs.push(o); });
const handVertCount = (m) => {
  const ids = new Set(handBoneObjs.map((o) => m.skeleton.bones.indexOf(o)).filter((i) => i >= 0));
  const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
  let c = 0;
  for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (ids.has(si.getComponent(i, k))) w += sw.getComponent(i, k); if (w >= 0.5) c++; }
  return c;
};
const body = (() => {
  const re = new RegExp(`_lod${XI_LOD}(_\\d+)?$`);
  let m = null, best = -1;
  xi.traverse((o) => { if (o.isSkinnedMesh && re.test(o.name)) { const c = handVertCount(o); if (c > best) { best = c; m = o; } } });
  if (!m) throw new Error(`char-xi 没有 _lod${XI_LOD} 蒙皮网格`);
  return m;
})();
const handBones = new Set(handBoneObjs.map((o) => body.skeleton.bones.indexOf(o)));
handBones.delete(-1);
const sI = body.geometry.attributes.skinIndex, sW = body.geometry.attributes.skinWeight;
const handW = (i) => { let w = 0; for (let k = 0; k < 4; k++) if (handBones.has(sI.getComponent(i, k))) w += sW.getComponent(i, k); return w; };
const handTris = [];
{
  const ix = body.geometry.index;
  const ok = new Uint8Array(body.geometry.attributes.position.count);
  for (let i = 0; i < ok.length; i++) ok[i] = handW(i) >= 0.5 ? 1 : 0;
  for (let t = 0; t < ix.count; t += 3) { const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2); if (ok[a] && ok[b] && ok[c]) handTris.push(a, b, c); }
}
const boneName = (i) => body.skeleton.bones[i]?.name;
const mainBone = (vi) => { let bi = -1, bw = 0; for (let k = 0; k < 4; k++) { const w = sW.getComponent(vi, k); if (w > bw) { bw = w; bi = sI.getComponent(vi, k); } } return boneName(bi); };
out.hand = { mesh: body.name, bones: [...handBones].map(boneName), tris: handTris.length / 3 };

// 笔 lod0 顶点（笔局部 → 世界每帧算）
const penVerts = [];
for (const m of penMeshes) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) penVerts.push({ m, i }); }

const PARITY_DIRS = [new THREE.Vector3(0.31, 0.82, 0.48).normalize(), new THREE.Vector3(-0.77, 0.13, 0.62).normalize(), new THREE.Vector3(0.21, -0.55, -0.81).normalize()];
const v = new THREE.Vector3(), tip = new THREE.Vector3(), n = new THREE.Vector3(), tri = new THREE.Triangle(), hit = {};
let worstPen = { depth: 0, frame: -1, bone: null }, minDown = Infinity, maxDown = -Infinity, minUp = Infinity, maxUp = -Infinity;
let deskMin = Infinity, deskMax = -Infinity, paperMin = Infinity, paperMax = -Infinity, missPaper = 0;
for (let f = 0; f < FR; f++) {
  mixer.setTime(Math.min(f / FPS, clip.duration - 1e-5));
  scene.updateMatrixWorld(true);
  body.skeleton.update();
  tipN.getWorldPosition(tip);
  const ph = downHit(tip, jMeshes);
  // 桌面：同一 xz，排除日志（打灯室 GLB）
  const dh = downHit(new THREE.Vector3(tip.x, tip.y + 0.05, tip.z), roomMeshes);
  const row = { f, down: isDown(f), tipY: +tip.y.toFixed(5) };
  if (ph) {
    const d = tip.y - ph.point.y;
    row.paperY = +(ph.point.y - sit.y).toFixed(5);
    row.dCm = cm(d);
    paperMin = Math.min(paperMin, ph.point.y - sit.y); paperMax = Math.max(paperMax, ph.point.y - sit.y);
    if (row.down) { minDown = Math.min(minDown, d); maxDown = Math.max(maxDown, d); } else { minUp = Math.min(minUp, d); maxUp = Math.max(maxUp, d); }
  } else missPaper++;
  if (dh) { row.deskY = +(dh.point.y - sit.y).toFixed(5); deskMin = Math.min(deskMin, dh.point.y - sit.y); deskMax = Math.max(deskMax, dh.point.y - sit.y); }
  // 手皮肤 BVH
  const arr = new Float32Array(handTris.length * 3);
  handTris.forEach((i, k) => body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld).toArray(arr, k * 3));
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const bvh = new MeshBVH(g);
  const hmesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  let fw = 0, fwBone = null, gap = Infinity;
  for (const { m, i } of penVerts) {
    v.fromBufferAttribute(m.geometry.attributes.position, i).applyMatrix4(m.matrixWorld);
    const c = bvh.closestPointToPoint(v, hit, 0, 0.05);
    if (!c) continue;
    gap = Math.min(gap, c.distance); // 笔到手皮肤最近距离（不分里外）：握住时应 ≈ 0，LOD 减面后手指变形可能离开笔
    if (c.distance > 0.01) continue;
    const fi = c.faceIndex;
    tri.set(new THREE.Vector3().fromArray(arr, fi * 9), new THREE.Vector3().fromArray(arr, fi * 9 + 3), new THREE.Vector3().fromArray(arr, fi * 9 + 6));
    tri.getNormal(n);
    const s = v.clone().sub(c.point).dot(n);
    if (s >= -1e-5) continue;
    // 核对（射线奇偶，3 个固定方向多数票；手皮肤在手腕处是开口，单方向可能从开口漏出去）：奇数次穿面 = 在里面
    let odd = 0;
    for (const d of PARITY_DIRS) {
      const r = new THREE.Raycaster(v.clone(), d, 0, 0.3);
      const hs = r.intersectObject(hmesh, false);
      let k = 0, last = -1;
      for (const h of hs) { if (h.distance - last > 1e-6) k++; last = h.distance; }
      if (k % 2 === 1) odd++;
    }
    if (odd < 2) continue;
    if (-s > fw) { fw = -s; fwBone = mainBone(handTris[fi * 3]); }
  }
  row.penInHandCm = cm(fw);
  row.penHandGapCm = Number.isFinite(gap) ? cm(gap) : null;
  if (fw > worstPen.depth) worstPen = { depth: fw, frame: f, bone: fwBone };
  g.dispose();
  out.frames.push(row);
}
const downFrames = out.frames.filter((r) => r.down).length;
out.summary = {
  frames: FR, fps: FPS, downFrames, downRanges: downs,
  tipToPaperDownCm: [cm(minDown), cm(maxDown)], tipToPaperUpCm: [cm(minUp), cm(maxUp)], missPaper,
  paperYAboveFloor: [+paperMin.toFixed(4), +paperMax.toFixed(4)], deskYAboveFloor: Number.isFinite(deskMin) ? [+deskMin.toFixed(4), +deskMax.toFixed(4)] : null,
  penInHandMaxCm: cm(worstPen.depth), penInHandFrame: worstPen.frame, penInHandBone: worstPen.bone,
  alignExtras: ex.align?.sitWrite ? { deskTop: ex.align.sitWrite.deskTop, bookCenter: ex.align.sitWrite.bookCenter, penTip0: ex.align.sitWrite.penTip0, penTail0: ex.align.sitWrite.penTail0 } : null,
};
// 第 0 帧笔尖 / 笔尾（汐根坐标）对 extras penTip0 / penTail0
{
  mixer.setTime(0); scene.updateMatrixWorld(true);
  const inv = xi.matrixWorld.clone().invert();
  const L = (a) => new THREE.Vector3(...a).applyMatrix4(pg.scene.matrixWorld).applyMatrix4(inv);
  const t0 = L(ext.tipLocal), e0 = L(ext.tailLocal);
  const al = ex.align?.sitWrite;
  out.summary.frame0 = { tip: t0.toArray().map((x) => +x.toFixed(4)), tail: e0.toArray().map((x) => +x.toFixed(4)), tipErrCm: al ? cm(t0.distanceTo(new THREE.Vector3(...al.penTip0))) : null, tailErrCm: al ? cm(e0.distanceTo(new THREE.Vector3(...al.penTail0))) : null };
}

// ---- 其余 clip 对比旧文件
if (OLD) {
  const og = await parse(OLD);
  const cmp = [];
  for (const c of ag.animations) {
    const o = og.animations.find((x) => x.name === c.name);
    if (!o) { cmp.push({ clip: c.name, status: '旧文件没有' }); continue; }
    let changed = 0, maxDiff = 0;
    const names = new Set([...c.tracks.map((t) => t.name), ...o.tracks.map((t) => t.name)]);
    for (const tn of names) {
      const a = c.tracks.find((t) => t.name === tn), b = o.tracks.find((t) => t.name === tn);
      if (!a || !b || a.times.length !== b.times.length || a.values.length !== b.values.length) { changed++; continue; }
      let md = 0;
      for (let i = 0; i < a.values.length; i++) md = Math.max(md, Math.abs(a.values[i] - b.values[i]));
      for (let i = 0; i < a.times.length; i++) md = Math.max(md, Math.abs(a.times[i] - b.times[i]));
      if (md > 0) { changed++; maxDiff = Math.max(maxDiff, md); }
    }
    const ej = JSON.stringify(ag.parser.json.animations.find((x) => x.name === c.name)?.extras ?? null);
    const eo = JSON.stringify(og.parser.json.animations.find((x) => x.name === c.name)?.extras ?? null);
    cmp.push({ clip: c.name, tracks: c.tracks.length, changed, maxDiff: +maxDiff.toExponential(2), extrasSame: ej === eo });
  }
  out.compare = { old: OLD, clips: cmp };
  out.summary.otherClipsChanged = cmp.filter((r) => r.clip !== attach.clip && (r.changed || !r.extrasSame)).map((r) => r.clip);
  out.summary.sitWriteChangedTracks = cmp.find((r) => r.clip === attach.clip)?.changed;
}
out.xiLod = XI_LOD;
writeFileSync(resolve(OUT, `measure-pen-sit-write${XI_LOD ? `-lod${XI_LOD}` : ''}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ place: out.place.aheadM, attach: out.attach, hand: { bones: out.hand.bones.length, tris: out.hand.tris }, ...out.summary }, null, 1));
if (out.compare) console.table(out.compare.clips);
