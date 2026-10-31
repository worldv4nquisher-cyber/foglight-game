// 镜头 05 过肩机位离线搜参（node，无浏览器，只读 ../art）：按游戏摆位（同 measure-pen-sit-write.mjs）摆灯室 / 汐 / 日志 / 钢笔，
// 逐候选参数（在当前 OVER_SHOULDER 上加 dBack / dUp / dSide，from / to 同加、look 不动；"0,0,0" = 现行参数，batch20 起即新机位）在 58–74 s 每 0.5 s 采样（坐写 clip 4 s 循环 → 8 个姿势帧），量：
//   - 日志 8 角在画内数、日志上表面 8×6 点被汐挡的比例（同 S3Ending.frameReport）；
//   - 发顶离画面上沿像素（900 高，头部头发顶点，排除马尾骨）；
//   - 笔：笔尖 → 笔尾 PEN_N（默认 21）点、往相机方向偏 PEN_R（默认 4 mm）（extras tipLocal / tailLocal），在画内且相机射线没先打到汐 / 灯室（非玻璃）的点算可见；笔尖可见 + 可见笔杆长度（cm）。
// 汐 = char-xi LOD0 蒙皮网格每帧 CPU 烘成静态 + BVH（游戏里的描边壳没算，偏宽松 ≈ 1–2 mm）。画面比例 16:9。
// 网格：GB / GU / GS 环境变量（逗号分隔的 dBack / dUp / dSide 取值）。
// 用法：node --import ./scripts/register-ts-paths.mjs scripts/search-cam05.mjs [dBack,dUp,dSide;...]  输出 ../docs/tasks/shots-035/pen/cam05-search.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(root, '../art/models');
const OUT = resolve(root, '../docs/tasks/shots-035/pen');
mkdirSync(OUT, { recursive: true });
globalThis.self ??= globalThis;
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
const { readClipPropAttach } = await import('../src/entities/xi/clipProp.ts');
const { OVER_SHOULDER, overShoulderKeys, ENDING_T } = await import('../src/content/cutscenes/ending.ts');
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)), detectSupport() {} };
const parse = async (f) => { const b = readFileSync(f); return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ''); };
const [xg, ag, pg, jg, rg] = await Promise.all([
  parse(resolve(ART, 'characters/char-xi.glb')), parse(resolve(ART, 'characters/char-xi-anims.glb')),
  parse(resolve(ART, 'props/prop-fountain-pen.glb')), parse(resolve(ART, 'props/prop-journal-father.glb')), parse(resolve(ART, 'env/env-lamp-room-ch1.glb')),
]);
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
jsN.getWorldQuaternion(jg.scene.quaternion);
jg.scene.position.copy(js);
for (const n of ['prop-journal-father-closed', 'prop-journal-father-closed_lod0', 'prop-journal-father-closed_lod1', 'prop-journal-father-closed_lod2']) { const o = jg.scene.getObjectByName(n); if (o) o.visible = false; }
scene.add(jg.scene);
const { attach } = readClipPropAttach(pg.scene);
attach.matrix.decompose(pg.scene.position, pg.scene.quaternion, pg.scene.scale);
xi.getObjectByName(attach.socket).add(pg.scene);
let ext = {};
pg.scene.traverse((o) => { if (o.userData?.tipLocal && !ext.tipLocal) ext = o.userData; });
scene.updateMatrixWorld(true);
const jOpen = jg.scene.getObjectByName('prop-journal-father-open') ?? jg.scene.getObjectByName('prop-journal-father-open_lod0');
const jBox = new THREE.Box3().setFromObject(jOpen, true);

// 灯室遮挡（非玻璃、非 lod1/2）
const roomOcc = [];
rg.scene.traverse((o) => {
  if (!o.isMesh || !o.visible || /_lod[12]$/.test(o.name)) return;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (/glass|glaz/i.test(`${o.name} ${m?.name ?? ''}`) || m?.transparent) return;
  o.geometry.boundsTree ??= new MeshBVH(o.geometry);
  m.side = THREE.DoubleSide;
  roomOcc.push(o);
});

const clip = ag.animations.find((a) => a.name === attach.clip);
const mixer = new THREE.AnimationMixer(xi);
mixer.clipAction(clip).play();
const xiSkinned = [];
xi.traverse((o) => { if (o.isSkinnedMesh && /_lod0/.test(o.name)) xiSkinned.push(o); });
const poseCache = new Map();
const v = new THREE.Vector3();
function pose(frame) {
  if (poseCache.has(frame)) return poseCache.get(frame);
  mixer.setTime(Math.min(frame / 30, clip.duration - 1e-5));
  scene.updateMatrixWorld(true);
  const meshes = [];
  const hairTop = [];
  for (const m of xiSkinned) {
    m.skeleton.update();
    const pos = m.geometry.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    const sk = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, bones = m.skeleton.bones;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const isHair = /hair/i.test(`${m.name} ${mat?.name ?? ''}`);
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v); // SkinnedMesh.getVertexPosition 已含蒙皮（r186），不要再 applyBoneTransform
      v.applyMatrix4(m.matrixWorld);
      v.toArray(arr, i * 3);
      if (isHair) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
        if (!/ponytail/i.test(bones[sk.getComponent(i, best)]?.name ?? '')) hairTop.push(v.clone());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (m.geometry.index) g.setIndex(m.geometry.index.clone()); // MeshBVH 会就地重排索引，不能共用
    g.boundsTree = new MeshBVH(g);
    meshes.push(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  }
  const tip = pg.scene.localToWorld(new THREE.Vector3(...ext.tipLocal));
  const tail = pg.scene.localToWorld(new THREE.Vector3(...ext.tailLocal));
  const r = { meshes, hairTop, tip, tail };
  poseCache.set(frame, r);
  return r;
}

const PEN_R = Number(process.env.PEN_R ?? 0.004);
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 200);
const blocked = (target, objs) => {
  const d = target.clone().sub(cam.position);
  const len = d.length();
  ray.set(cam.position, d.divideScalar(len));
  ray.far = len - 0.004;
  return ray.intersectObjects(objs, false).length > 0;
};
const inFrame = (p) => { v.copy(p).project(cam); return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1; };
const lerp = (a, b, u) => a.map((x, i) => x + (b[i] - x) * u);

function params(dBack, dUp, dSide) {
  const add = (k) => ({ ...k, back: k.back + dBack, up: k.up + dUp, side: k.side + dSide });
  return { from: add(OVER_SHOULDER.from), to: add(OVER_SHOULDER.to), look: { ...OVER_SHOULDER.look } };
}
function evalAt(p, t, frameOverride) {
  const k = overShoulderKeys(js.toArray(), sit.toArray(), p);
  const u = (t - ENDING_T.sitWrite) / (ENDING_T.pullBack - ENDING_T.sitWrite);
  cam.position.set(...lerp(k.from.position, k.to.position, u));
  cam.fov = k.from.fov + (k.to.fov - k.from.fov) * u;
  cam.updateProjectionMatrix();
  cam.lookAt(...lerp(k.from.lookAt, k.to.lookAt, u));
  cam.updateMatrixWorld(true);
  const frame = frameOverride ?? Math.round((((t - ENDING_T.sitWrite) % 4) * 30)) % 120;
  const P = pose(frame);
  let inside = 0;
  const ny = [Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? jBox.max.x : jBox.min.x, i & 2 ? jBox.max.y : jBox.min.y, i & 4 ? jBox.max.z : jBox.min.z);
    if (inFrame(c)) inside++;
    ny[0] = Math.min(ny[0], v.y); ny[1] = Math.max(ny[1], v.y);
  }
  let occ = 0;
  for (let a = 0; a < 8; a++) for (let b = 0; b < 6; b++) {
    const q = new THREE.Vector3(jBox.min.x + ((a + 0.5) / 8) * (jBox.max.x - jBox.min.x), jBox.max.y + 0.002, jBox.min.z + ((b + 0.5) / 6) * (jBox.max.z - jBox.min.z));
    if (blocked(q, P.meshes)) occ++;
  }
  let crown = -Infinity;
  for (const h of P.hairTop) { v.copy(h).project(cam); if (Math.abs(v.x) <= 1.2 && v.z < 1) crown = Math.max(crown, v.y); }
  const N = Number(process.env.PEN_N ?? 21);
  let vis = 0, tipVis = false, pattern = '';
  for (let i = 0; i < N; i++) {
    const q = P.tip.clone().lerp(P.tail, i / (N - 1));
    if (i > 0) q.add(cam.position.clone().sub(q).normalize().multiplyScalar(PEN_R)); // 取朝向镜头一侧的笔杆表面，笔尖本身取轴上点
    const ok = inFrame(q) && !blocked(q, P.meshes) && !blocked(q, roomOcc);
    if (ok) vis++;
    pattern += ok ? '#' : '.';
    if (i === 0) tipVis = ok;
  }
  const penLen = P.tip.distanceTo(P.tail);
  const tipRunCm = +(((pattern.indexOf('.') < 0 ? N : pattern.indexOf('.')) / (N - 1)) * penLen * 100).toFixed(1);
  const camRoomClear = !blocked(js.clone().add(new THREE.Vector3(0, 0.38, 0)), roomOcc);
  const px = (p) => { v.copy(p).project(cam); return [Math.round((v.x + 1) / 2 * 1600), Math.round((1 - v.y) / 2 * 900)]; };
  return { tipRunCm, pattern, tipPx: px(P.tip), tailPx: px(P.tail), t, frame, corners: inside, occluded: +(occ / 48).toFixed(3), crownPx: Math.round(((1 - crown) / 2) * 900), tipVisible: tipVis, penVisibleCm: +((vis / N) * penLen * 100).toFixed(1), penVisFrac: +(vis / N).toFixed(2), camClear: camRoomClear };
}
const TS = [];
for (let t = ENDING_T.sitWrite; t <= ENDING_T.pullBack + 1e-6; t += 0.5) TS.push(+t.toFixed(2));
function score(p) {
  const rows = TS.map((t) => evalAt(p, t));
  const worst = {
    corners: Math.min(...rows.map((r) => r.corners)),
    occludedMax: Math.max(...rows.map((r) => r.occluded)),
    crownMin: Math.min(...rows.map((r) => r.crownPx)),
    tipVisibleFrac: +(rows.filter((r) => r.tipVisible).length / rows.length).toFixed(2),
    penCmMin: Math.min(...rows.map((r) => r.penVisibleCm)),
    penCmMean: +(rows.reduce((s, r) => s + r.penVisibleCm, 0) / rows.length).toFixed(1),
    camClear: rows.every((r) => r.camClear),
    tipRunMin: Math.min(...rows.map((r) => r.tipRunCm)),
    tipRunMean: +(rows.reduce((s, r) => s + r.tipRunCm, 0) / rows.length).toFixed(2),
  };
  const pinned = [[68, 60], [68.4, 72], [70.6, 18]].map(([t, f]) => evalAt(p, t, f));
  return { worst, pinned, rows };
}
const out = { place: { sit: sit.toArray(), journal: js.toArray() }, base: OVER_SHOULDER, results: [] };
const arg = process.argv[2];
const cands = arg ? arg.split(';').map((s) => s.split(',').map(Number)) : (() => {
  const c = [];
  for (const dBack of (process.env.GB ?? "-0.3,-0.15,0,0.2,0.4,0.6,0.9").split(",").map(Number)) for (const dUp of (process.env.GU ?? "-0.3,-0.15,0,0.2,0.4,0.7,1.0").split(",").map(Number)) for (const dSide of (process.env.GS ?? "-0.9,-0.6,-0.3,0,0.3,0.6,0.9").split(",").map(Number)) c.push([dBack, dUp, dSide]);
  return c;
})();
for (const [dBack, dUp, dSide] of cands) {
  const s = score(params(dBack, dUp, dSide));
  out.results.push({ dBack, dUp, dSide, ...s.worst, pinned: s.pinned, ...(cands.length <= 3 ? { rows: s.rows } : {}) });
  console.log(JSON.stringify({ dBack, dUp, dSide, ...s.worst, pinned: s.pinned.map((r) => [r.frame, r.tipVisible, r.penVisibleCm, r.occluded, r.crownPx]) }));
}
writeFileSync(resolve(OUT, arg ? 'cam05-search-picked.json' : 'cam05-search.json'), JSON.stringify(out, null, 1));
