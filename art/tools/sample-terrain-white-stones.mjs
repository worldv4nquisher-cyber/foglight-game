#!/usr/bin/env node
// 白石组（014 / 裁定 15·16）：从 env-clifftop-s2.glb 的 LOD0 地形取高度网格 → art/source/props/white-stones-s2-terrain.json
// 网格 x 13.5…22.5、z −3…5、步长 0.25（崖顶局部 = S2 局部）；build-props-ch1.mjs whiteStones() 双线性取样让石块贴实际地形。
// 用法：node art/tools/sample-terrain-white-stones.mjs
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from '../../game/node_modules/three/build/three.module.js';
const ART = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const d = await io.read(path.join(ART, 'models/env/env-clifftop-s2.glb'));
const G = { x0: 13.5, z0: -3, step: 0.25, nx: 37, nz: 33 };
const tris = [];
for (const n of d.getRoot().listNodes()) { if (n.getName() !== 'env-clifftop-s2_lod0') continue; const M = new THREE.Matrix4().fromArray(n.getWorldMatrix());
  for (const p of n.getMesh().listPrimitives()) { const A = p.getAttribute('POSITION'), I = p.getIndices().getArray();
    for (let t = 0; t < I.length; t += 3) { const v = [0, 1, 2].map((k) => new THREE.Vector3(...A.getElement(I[t + k], [])).applyMatrix4(M)); if (Math.max(...v.map((q) => q.x)) > 13 && Math.min(...v.map((q) => q.x)) < 23 && Math.max(...v.map((q) => q.z)) > -3.5 && Math.min(...v.map((q) => q.z)) < 5.5) tris.push(v); } } }
const ray = new THREE.Ray(), h = new THREE.Vector3(), y = [];
for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) { ray.set(new THREE.Vector3(G.x0 + i * G.step, 5, G.z0 + j * G.step), new THREE.Vector3(0, -1, 0)); let top = null;
  for (const t of tris) { const p = ray.intersectTriangle(t[0], t[1], t[2], false, h); if (p && (top === null || p.y > top)) top = p.y; }
  if (top === null) throw new Error(`地形缺口 ${i},${j}`); y.push(+top.toFixed(4)); }
fs.writeFileSync(path.join(ART, 'source/props/white-stones-s2-terrain.json'), JSON.stringify({ source: 'env-clifftop-s2.glb env-clifftop-s2_lod0', ...G, layout: 'y[j*nx+i]，x = x0 + i·step，z = z0 + j·step', y }));
console.log('ok', y.length, 'min', Math.min(...y), 'max', Math.max(...y));
