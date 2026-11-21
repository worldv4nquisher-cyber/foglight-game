#!/usr/bin/env node
// 031 父亲 正式版：Blender 导出的原始 GLB（/tmp/father/char-father-raw.glb）→ 交付结构（照 finish-char-xi.mjs）
//   - 2 个材质：mat-char-father-body（布料/靴/帽/发/扣）、mat-char-father-skin（脸/耳/颈/手），共用图集 tex-father-albedo/normal/orm（2048）
//   - 三渲二色阶复用公共 tex-ramp-char（extras.toonRamp）；body 的 ORM.a = 湿润遮罩（同汐的约定）
//   - COLOR_0 = 平滑法线（同位置顶点法线平均，n*0.5+0.5，RGBA8 归一化），给外扩描边
//   - 根节点 char-father + extras { heightM 1.79, forward +Z, skeleton char-xi（沿用汐的 73 骨命名）, rig char-father }
//   - 输出未压缩 GLB（贴图 1×1 占位 PNG，名字 = 贴图名），再由 glb-pack-ktx2.mjs 换成外置 KTX2 + Meshopt
// 用法：node art/tools/finish-char-father.mjs [raw.glb] [out.glb]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const RAW = process.argv[2] ?? '/tmp/father/char-father-raw.glb';
const OUT = process.argv[3] ?? path.resolve(HERE, '../models/characters/char-father.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(RAW);
const root = doc.getRoot();
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const tex = {};
for (const n of ['tex-father-albedo', 'tex-father-normal', 'tex-father-orm']) tex[n] = doc.createTexture(n).setImage(new Uint8Array(PNG1)).setMimeType('image/png').setURI(`${n}.png`);
const WET = { texture: 'tex-father-orm', channel: 'a', note: 'ORM.a = 湿润遮罩（1 = 最先湿：肩、披肩、兜帽、下摆、袖口、裤脚、雨靴）。shader 同汐：color *= 1 - 0.22*wet*uWetness；roughness = mix(rough, 0.28, wet*uWetness)。ORM.g 为干燥粗糙度。' };
const mats = {};
for (const m of root.listMaterials()) mats[m.getName()] = m;
if (Object.keys(mats).length > 2) throw new Error('材质超过 2 个: ' + Object.keys(mats));
for (const [name, m] of Object.entries(mats)) {
  m.setBaseColorTexture(tex['tex-father-albedo']).setBaseColorFactor([1, 1, 1, 1])
    .setNormalTexture(tex['tex-father-normal'])
    .setOcclusionTexture(tex['tex-father-orm']).setOcclusionStrength(1)
    .setMetallicRoughnessTexture(tex['tex-father-orm']).setMetallicFactor(1).setRoughnessFactor(1)
    .setEmissiveFactor([0, 0, 0]).setAlphaMode('OPAQUE').setDoubleSided(false);
  if (name.endsWith('skin')) m.setExtras({ toonRamp: 'tex-ramp-char', faceUV: 'TEXCOORD_0 的 u,v∈[0,0.25] 是脸的正面投影（五官画在贴图里）；没有 SDF 脸部阴影图' });
  else m.setExtras({ toonRamp: 'tex-ramp-char', wetMask: WET });
}
for (const t of root.listTextures()) if (!Object.values(tex).includes(t)) t.dispose();

const buf = root.listBuffers()[0];
for (const mesh of root.listMeshes()) {
  const acc = new Map();
  const key = (p, i) => `${Math.round(p[i * 3] * 2e4)},${Math.round(p[i * 3 + 1] * 2e4)},${Math.round(p[i * 3 + 2] * 2e4)}`;
  const prims = mesh.listPrimitives();
  for (const pr of prims) {
    const P = pr.getAttribute('POSITION').getArray(), N = pr.getAttribute('NORMAL').getArray();
    for (let i = 0; i < P.length / 3; i++) { const k = key(P, i); const a = acc.get(k) ?? [0, 0, 0]; a[0] += N[i * 3]; a[1] += N[i * 3 + 1]; a[2] += N[i * 3 + 2]; acc.set(k, a); }
  }
  for (const pr of prims) {
    const P = pr.getAttribute('POSITION').getArray(), n = P.length / 3, C = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = acc.get(key(P, i)); const l = Math.hypot(...a) || 1;
      for (let c = 0; c < 3; c++) C[i * 4 + c] = Math.round((a[c] / l * 0.5 + 0.5) * 255);
      C[i * 4 + 3] = 255;
    }
    const old = pr.getAttribute('COLOR_0'); if (old) old.dispose();
    pr.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(C).setNormalized(true).setBuffer(buf));
  }
}
// UV：只留 TEXCOORD_0，夹到 [0,1]（减面后有 1e-3 级越界），好让 12 bit 量化生效
for (const mesh of root.listMeshes()) for (const pr of mesh.listPrimitives()) {
  const t1 = pr.getAttribute('TEXCOORD_1'); if (t1) { pr.setAttribute('TEXCOORD_1', null); if (!t1.listParents().some((x) => x !== root)) t1.dispose(); }
  const a = pr.getAttribute('TEXCOORD_0'); if (!a) continue;
  const arr = a.getArray().slice(); for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, Math.max(0, arr[i]));
  pr.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(arr).setBuffer(buf)); if (!a.listParents().some((x) => x !== root)) a.dispose();
}
const scene = root.listScenes()[0];
const top = scene.listChildren();
let rootNode = top.find((n) => n.getName() === 'char-father');
if (!rootNode) {
  if (top.length === 1) rootNode = top[0].setName('char-father');
  else { rootNode = doc.createNode('char-father'); for (const n of top) { scene.removeChild(n); rootNode.addChild(n); } scene.addChild(rootNode); }
}
rootNode.setExtras({ heightM: 1.79, forward: '+Z', skeleton: 'char-xi', rig: 'char-father' });
for (const s of root.listSkins()) s.setName('char-father-skeleton');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const tris = (m) => m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
console.log('wrote', OUT);
for (const n of root.listNodes()) if (n.getMesh()) console.log(`  ${n.getName()}: ${tris(n.getMesh())} tris, prims ${n.getMesh().listPrimitives().map((p) => `${p.getMaterial()?.getName()}[${p.listSemantics().join(',')}]`).join(' ')}`);
console.log('  joints', root.listSkins()[0].listJoints().length, ' socket', !!root.listNodes().find((n) => n.getName() === 'hand_r_socket'));
