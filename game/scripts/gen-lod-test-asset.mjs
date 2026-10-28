// 生成 LOD / 解谜关键物体测试模型：public/assets/models/test-lod-puzzle-critical.glb
// 用法：npm run assets:test-lod
//
// 节点结构（模拟美术从 Blender 导出的结果）：
//   white-stone            空物体，extras { puzzleCritical: true }（标在父级 → 子树全部固定 LOD0）
//     white-stone_lod0/1/2 白漆石块，面数逐级约减半
//   rock-control_lod0/1/2  普通对照石，无标记 → 按画质档位距离切换（LOD1 偏绿、LOD2 偏红，便于肉眼看出切换）
//   tide-gauge_lod0/1/2    刻度柱，只在 lod0 节点上标 puzzleCritical（Blender 里逐个物体设属性的情况）
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/assets/models/test-lod-puzzle-critical.glb');

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('test-lod-puzzle-critical');

/** 位置决定的确定性起伏，让石头不那么圆 */
function bumpy(geo, amount, seed) {
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 1 + amount * (Math.sin(n.x * 5.1 + seed) * Math.cos(n.y * 4.3 - seed) + 0.5 * Math.sin(n.z * 7.7 + seed * 2));
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

function toMesh(name, geometry, color) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  geo.computeVertexNormals();
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.getAttribute('position').array)).setBuffer(buffer);
  const nor = doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.getAttribute('normal').array)).setBuffer(buffer);
  const mat = doc.createMaterial(`${name}-mat`).setBaseColorFactor([...color, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setMaterial(mat);
  return { mesh: doc.createMesh(name).addPrimitive(prim), tris: geo.getAttribute('position').count / 3 };
}

function stone(detail, seed) {
  const g = bumpy(new THREE.IcosahedronGeometry(0.75, detail), 0.12, seed);
  g.scale(1.25, 0.75, 1.0);
  g.translate(0, 0.45, 0);
  return g;
}

function gauge(segments) {
  const g = new THREE.CylinderGeometry(0.22, 0.28, 1.8, segments, Math.max(1, segments / 3));
  g.translate(0, 0.9, 0);
  return g;
}

const report = [];
function lodNode(name, geometry, color, extras) {
  const { mesh, tris } = toMesh(name, geometry, color);
  const node = doc.createNode(name).setMesh(mesh);
  if (extras) node.setExtras(extras);
  report.push(`${name}: ${tris} tris${extras ? ' ' + JSON.stringify(extras) : ''}`);
  return node;
}

// 1) 白石：标记在父级空物体上
const WHITE = [0.82, 0.8, 0.76];
const whiteStone = doc.createNode('white-stone').setTranslation([-1.8, 0, 0]).setExtras({ puzzleCritical: true });
[3, 2, 1].forEach((detail, lv) => whiteStone.addChild(lodNode(`white-stone_lod${lv}`, stone(detail, 1.7), WHITE)));
scene.addChild(whiteStone);

// 2) 普通对照石：无标记，三级颜色略有差别，方便肉眼确认切换
const CONTROL = [
  [0.22, 0.23, 0.23],
  [0.2, 0.3, 0.2],
  [0.34, 0.2, 0.18],
];
[3, 2, 1].forEach((detail, lv) =>
  scene.addChild(lodNode(`rock-control_lod${lv}`, stone(detail, 1.7), CONTROL[lv]).setTranslation([1.8, 0, 0])),
);

// 3) 刻度柱：只在 lod0 上标记
const BRONZE = [0.36, 0.24, 0.13];
[24, 12, 6].forEach((seg, lv) =>
  scene.addChild(
    lodNode(`tide-gauge_lod${lv}`, gauge(seg), BRONZE, lv === 0 ? { puzzleCritical: true } : undefined).setTranslation([0, 0, -1.6]),
  ),
);

mkdirSync(dirname(out), { recursive: true });
await new NodeIO().write(out, doc);
console.log(`已生成 ${out}\n  ${report.join('\n  ')}`);
