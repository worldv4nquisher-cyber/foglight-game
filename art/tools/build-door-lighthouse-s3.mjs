#!/usr/bin/env node
// 022 塔门 prop-lighthouse-door-s3.glb：用 020 门扇 env-lighthouse-ch1-door.glb 的 LOD0 网格原样（外观 / 贴图 mat-env-wood-ch1 不变），
// 重组节点：根（原点 = 铰链线底端 = door-s3-hinge-socket）→ door-leaf（原点在铰链，绕 +Y 转 0 → −100° 向内开）→ 门扇网格 / -collider / door-handle / door-keyhole（锁孔，新加）；
// 根下 -interact（门外站位 = 白盒 alongDoor(4.7, 0, 2.4)）。puzzleCritical，只 LOD0。
// 用法：node art/tools/build-door-lighthouse-s3.mjs && node art/tools/glb-pack-ktx2.mjs art/models/props/prop-lighthouse-door-s3.glb
import path from 'node:path';
import * as THREE from '../../game/node_modules/three/build/three.module.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ART = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ART, 'models/env/env-lighthouse-ch1-door.glb');
const DST = path.join(ART, 'models/props/prop-lighthouse-door-s3.glb');
const NAME = 'prop-lighthouse-door-s3';
const HINGE = { t: [-2.6304, 2.4, -1.8668], rotY: -5.497787 };            // = env-lighthouse-ch1 door-s3-hinge-socket
const W = 1.08, KEY = { x: W - 0.16, y: 0.86, zOut: -0.0455, zIn: 0.0375 };   // 锁孔：门环正下方（门环中心 x 0.92 / y 1.02）；门板 ±0.0375（020 板厚 0.075），外锁板贴外面

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(SRC);
const R = doc.getRoot(), scene = R.listScenes()[0];
const root = scene.listChildren()[0];
const byName = (n) => R.listNodes().find((x) => x.getName() === n);
const woodMat = R.listMaterials()[0];

// 门环附近的铁件 UV（锁孔铁板用同一块 ironDark 区，贴图不变）
const lod0 = byName('env-lighthouse-ch1-door_lod0');
const M = new THREE.Matrix4().fromArray(lod0.getMatrix());
let uvSum = [0, 0], uvN = 0;
for (const p of lod0.getMesh().listPrimitives()) {
  const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0'), e = [], u = [];
  for (let i = 0; i < pos.getCount(); i++) {
    const v = new THREE.Vector3(...pos.getElement(i, e)).applyMatrix4(M);
    if (Math.hypot(v.x - KEY.x, v.y - 1.1) < 0.05 && v.z < -0.04) { uv.getElement(i, u); uvSum[0] += u[0]; uvSum[1] += u[1]; uvN++; }
  }
}
if (!uvN) throw new Error('找不到门环底座的铁件 UV');
const IRON_UV = [uvSum[0] / uvN, uvSum[1] / uvN];

// 节点重组
for (const n of ['env-lighthouse-ch1-door_lod1', 'env-lighthouse-ch1-door_lod2']) byName(n).dispose();
const leaf = doc.createNode('door-leaf').setExtras({ rotates: 'y', originAt: '铰链线底端（= 根原点）', openDeg: -100, closedDeg: 0, inward: true, drive: '程序转 door-leaf：绕本地 +Y 0 → −100°（向内开，1.4 s，白盒同）', note: '门扇网格 / -collider / door-handle / door-keyhole 都在下面，跟门转' });
root.addChild(leaf);
lod0.setName('door-leaf-mesh'); root.removeChild(lod0); leaf.addChild(lod0);
const col = byName('env-lighthouse-ch1-door-collider'); col.setName(`${NAME}-collider`); root.removeChild(col); leaf.addChild(col);
const handle = byName('door-handle'); root.removeChild(handle); leaf.addChild(handle);
handle.setExtras({ note: '门环中心（外面）' });

// 锁孔：外面一块铁板（锁孔形开口 = 深色件），里面一块小铁板
const buf = R.listBuffers()[0];
const prim = (g, mat, uvFix) => {
  g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals();
  const n = g.attributes.position.count, nrm = g.attributes.normal.array, col = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) col[i * 4 + k] = Math.round((nrm[i * 3 + k] * 0.5 + 0.5) * 255); col[i * 4 + 3] = 255; }
  const uv = new Float32Array(n * 2); for (let i = 0; i < n; i++) uv.set(uvFix, i * 2);
  const a = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buf);
  return doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', a(new Float32Array(g.attributes.position.array), 'VEC3')).setAttribute('NORMAL', a(new Float32Array(nrm), 'VEC3'))
    .setAttribute('TEXCOORD_0', a(uv, 'VEC2')).setAttribute('COLOR_0', a(col, 'VEC4').setNormalized(true))
    .setIndices(a(new Uint16Array([...Array(n).keys()]), 'SCALAR'));
};
const merge = (gs) => { const P = []; for (const g of gs) { const q = g.index ? g.toNonIndexed() : g; P.push(...q.attributes.position.array); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); return g; };
const keyholeShape = () => { const s = new THREE.Shape(); s.absarc(0, 0.008, 0.0075, -Math.PI * 0.3, Math.PI * 1.3, false); s.lineTo(-0.006, -0.018); s.lineTo(0.006, -0.018); s.closePath(); return s; };
// 门环 / 锁孔都在门扇本地：外面 = −Z
const iron = [], dark = [];
{ const g = new THREE.BoxGeometry(0.06, 0.12, 0.008, 1, 1, 1); g.translate(0, 0, KEY.zOut + 0.004); iron.push(g); }                   // 外锁板 z −0.0455 → −0.0375（贴门板外面）
for (const [x, y] of [[0, 0.048], [0, -0.048]]) { const g = new THREE.SphereGeometry(0.006, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2); g.rotateX(-Math.PI / 2); g.translate(x, y, KEY.zOut); iron.push(g); }
{ const g = new THREE.ShapeGeometry(keyholeShape(), 8); g.rotateY(Math.PI); g.translate(0, 0, KEY.zOut - 0.0006); dark.push(g); }        // 锁孔（朝 −Z）
{ const g = new THREE.BoxGeometry(0.045, 0.08, 0.006); g.translate(0, 0, KEY.zIn + 0.003); iron.push(g); }                             // 里锁板
{ const g = new THREE.ShapeGeometry(keyholeShape(), 8); g.translate(0, 0, KEY.zIn + 0.0066); dark.push(g); }
const darkMat = doc.createMaterial('mat-prop-keyhole-dark').setBaseColorFactor([0.012, 0.01, 0.009, 1]).setMetallicFactor(0).setRoughnessFactor(0.95)
  .setExtras({ note: '锁孔开口（不用贴图的近黑色）' });
const kMesh = doc.createMesh('door-keyhole').addPrimitive(prim(merge(iron), woodMat, IRON_UV)).addPrimitive(prim(merge(dark), darkMat, [0, 0]));
const keyNode = doc.createNode('door-keyhole').setTranslation([KEY.x, KEY.y, 0])
  .setExtras({ keyhole: true, outsideFaceZ: KEY.zOut, note: '锁孔中心（门扇本地 [0.92, 0.86]，门环正下方）；外面在 −Z（门外），钥匙从外面插。节点原点在门板中面' });
leaf.addChild(keyNode);
keyNode.addChild(doc.createNode('door-keyhole-mesh').setMesh(kMesh));   // 网格放子节点（打包量化会改网格节点的 TRS，锁孔中心节点保持空节点）
lod0.setExtras({});

// 门外交互点（根下，不跟门转）：白盒 alongDoor(4.7, 0, 2.4) → 铰链本地，+Z 朝门（塔心）
const U = [Math.cos((225 * Math.PI) / 180), Math.sin((225 * Math.PI) / 180)];
const toLocal = (p) => { const d = new THREE.Vector3(p[0] - HINGE.t[0], p[1] - HINGE.t[1], p[2] - HINGE.t[2]); return d.applyAxisAngle(new THREE.Vector3(0, 1, 0), -HINGE.rotY); };
const stand = toLocal([U[0] * 4.7, 2.4, U[1] * 4.7]), toward = toLocal([U[0] * 3.5, 2.4, U[1] * 3.5]).sub(stand);
const yaw = Math.atan2(toward.x, toward.z);
root.addChild(doc.createNode(`${NAME}-interact`).setTranslation(stand.toArray().map((v) => +v.toFixed(4))).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).toArray().map((v) => +v.toFixed(6)))
  .setExtras({ interact: true, kind: 'unlock-door', requires: 'prop-key-lighthouse（缺失回退 prop-key-cellar-s2）', note: '汐站位 = 白盒 door-s3 stand alongDoor(4.7, 0, 2.4)（门外平台，地面），+Z 朝门' }));

root.setName(NAME).setExtras({
  puzzleCritical: true, puzzle: 'door-s3', ticket: 'v0.1-022', scale: 1, lods: 1,
  originAt: '铰链线底端 = env-lighthouse-ch1 door-s3-hinge-socket（S3 (−2.6304, 2.4, −1.8668)，rotY −5.497787）；局部 +X 沿门宽、+Z 朝塔内（外面 = −Z）',
  sizeM: [W, 2.18], openDeg: -100, leafNode: 'door-leaf', keyholeNode: 'door-keyhole',
  appearance: '= 020 env-lighthouse-ch1-door 的 LOD0（圆拱顶 6 竖板厚木门、两道长铰链、拱顶铁箍、门环；材质 mat-env-wood-ch1 不变），只加锁孔（外 / 里两块锁板）',
  placement: { translation: HINGE.t, rotationY: HINGE.rotY },
  note: '替换 020 门扇：挂 door-s3-hinge-socket，程序转 door-leaf（不要转根）',
});
scene.setName(NAME);
await doc.transform(prune({ keepLeaves: true }));
await io.write(DST, doc);
console.log(`✓ ${DST}  interact ${JSON.stringify(stand.toArray().map((v) => +v.toFixed(3)))} yaw ${(yaw * 180 / Math.PI).toFixed(1)}°  ironUV ${IRON_UV.map((v) => v.toFixed(3))} (${uvN})`);
