// 资源加载后处理校验（npm run test:assets）：
//  1. COLOR_0 = 描边平滑法线：GLTFLoader 解析带 COLOR_0 的 GLB → prepareOutlineNormals 关掉 vertexColors、保留 color 属性、校验数据；
//  2. GLB 交付自检（scripts/lib/glb-audit.mjs，node scripts/verify-lod.mjs <文件> 用的同一套）在内存生成的 GLB 上的判定。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { checkOutlineNormals, prepareOutlineNormals } from '../src/assets/vertexColors.ts';
import { auditGlb } from './lib/glb-audit.mjs';

let passed = 0;
const ok = (msg) => {
  passed++;
  console.log(`  ✓ ${msg}`);
};

/** 用 gltf-transform 拼一个小 GLB。colorMode：'outline' 正确编码的平滑法线 / 'random' 普通顶点色 / null 不带 COLOR_0 */
async function makeGlb({ name = 'prop-test-crate', colorMode = 'outline', critical = true, collider = true, interact = true, lods = 1, tris = 12 } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const root = doc.createNode(name);
  if (critical) root.setExtras({ puzzleCritical: true });
  scene.addChild(root);
  const mat = doc.createMaterial('mat-prop-test').setBaseColorFactor([0.6, 0.5, 0.4, 1]);
  const addMesh = (nodeName, geo, withColor) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const pos = g.getAttribute('position').array;
    const nor = g.getAttribute('normal').array;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
      .setMaterial(mat);
    if (withColor) {
      const n = pos.length / 3;
      const col = new Uint8Array(n * 4);
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        // 球心出发的方向 = 盒子的「平滑法线」
        v.fromArray(pos, i * 3).normalize();
        const c = colorMode === 'random' ? [Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.4] : [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, v.z * 0.5 + 0.5];
        col.set([...c.map((x) => Math.round(x * 255)), 255], i * 4);
      }
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(col).setNormalized(true).setBuffer(buffer));
    }
    const node = doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim));
    root.addChild(node);
  };
  const seg = Math.max(1, Math.round(Math.sqrt(tris / 12)));
  for (let l = 0; l < lods; l++) {
    const s = Math.max(1, seg >> l);
    addMesh(`${name}_lod${l}`, new THREE.BoxGeometry(1, 1, 1, s, s, s), colorMode !== null);
  }
  if (collider) addMesh(`${name}-collider`, new THREE.BoxGeometry(1, 1, 1), false);
  if (interact) root.addChild(doc.createNode(`${name}-interact`).setTranslation([0, 0, 1]));
  return new NodeIO().writeBinary(doc);
}

// ---- 1. COLOR_0 → 关 vertexColors、保留属性、校验
globalThis.self ??= globalThis;
const parse = async (bytes) => (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;

{
  const scene = await parse(await makeGlb());
  const box = scene.getObjectByName('prop-test-crate_lod0');
  assert.equal(box.material.vertexColors, true, 'GLTFLoader 遇到 COLOR_0 会自动开 vertexColors（前提）');
  const stats = prepareOutlineNormals(scene);
  assert.deepEqual(stats, { meshes: 1, materialsFixed: 1, invalid: [] });
  assert.equal(box.material.vertexColors, false);
  assert.ok(box.material.version > 0, 'needsUpdate 已触发（重新编译着色器）');
  const color = box.geometry.getAttribute('color');
  assert.ok(color && color.itemSize === 4 && color.normalized, 'color 属性保留（RGBA8 归一化）');
  assert.equal(box.geometry.userData.outlineNormals, 'color');
  const collider = scene.getObjectByName('prop-test-crate-collider');
  assert.equal(collider.material.vertexColors, false);
  ok('COLOR_0 平滑法线：材质 vertexColors 关掉、几何 color 属性保留并标 userData.outlineNormals，校验通过');
  // 再跑一次是幂等的
  assert.deepEqual(prepareOutlineNormals(scene), { meshes: 1, materialsFixed: 0, invalid: [] });
  ok('prepareOutlineNormals 幂等（第二次没有材质要改）');
}
{
  const scene = await parse(await makeGlb());
  const box = scene.getObjectByName('prop-test-crate_lod0');
  assert.deepEqual(prepareOutlineNormals(scene, false), { meshes: 0, materialsFixed: 0, invalid: [] });
  assert.equal(box.material.vertexColors, true);
  ok("开关关闭（gameConfig.assets.vertexColorsAreOutlineNormals=false 或 manifest vertexColors:'color'）：vertexColors 保持开");
}
{
  const scene = await parse(await makeGlb({ colorMode: 'random' }));
  const stats = prepareOutlineNormals(scene);
  assert.equal(stats.invalid.length, 1);
  assert.match(stats.invalid[0][1], /不是单位向量/);
  assert.equal(scene.getObjectByName('prop-test-crate_lod0').material.vertexColors, false);
  ok(`普通顶点色被识别为「不像平滑法线」并告警（${stats.invalid[0][1]}），材质仍按约定关掉 vertexColors`);
}
{
  // 平滑法线编码对了但方向全反（例如坐标系没转）
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).toNonIndexed();
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize().negate();
    col.set([v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, v.z * 0.5 + 0.5], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const r = checkOutlineNormals(g);
  assert.equal(r.ok, false);
  assert.match(r.reason, /反向/);
  assert.equal(checkOutlineNormals(new THREE.BoxGeometry()).ok, false);
  ok('方向反了的平滑法线、没有 COLOR_0 的几何体都判为不通过');
}

// ---- 2. 交付自检判定
const dir = mkdtempSync(join(tmpdir(), 'glb-audit-'));
try {
  const write = async (file, opts) => {
    const p = join(dir, file);
    writeFileSync(p, await makeGlb(opts));
    return p;
  };
  let r = await auditGlb(await write('prop-test-crate.glb', {}));
  assert.deepEqual(r.errors, []);
  assert.equal(r.summary.puzzleCritical, true);
  assert.equal(r.summary.colliders, 1);
  assert.equal(r.summary.interacts, 1);
  assert.deepEqual(r.summary.levels, [12]);
  ok('合格的 puzzleCritical 道具：无错误，层级 [12] 三角面、-collider / -interact 各 1');

  r = await auditGlb(await write('prop-test-crate.glb', { colorMode: null, collider: false, interact: false }));
  assert.ok(r.errors.some((e) => /缺 -collider/.test(e)));
  assert.ok(r.errors.some((e) => /缺 -interact/.test(e)));
  assert.ok(r.errors.some((e) => /缺 COLOR_0/.test(e)));
  ok('puzzleCritical 缺 -collider / -interact / COLOR_0 → 错误');

  r = await auditGlb(await write('prop-test-crate.glb', { colorMode: 'random' }));
  assert.ok(r.errors.some((e) => /COLOR_0 数据不像平滑法线/.test(e)));
  ok('COLOR_0 是普通颜色 → 错误（加载器同款抽样校验）');

  r = await auditGlb(await write('prop-key-test.glb', { tris: 4000 }));
  assert.ok(r.errors.some((e) => /超出预算（钥匙 ≤ 3k）/.test(e)), r.errors.join('\n'));
  r = await auditGlb(await write('prop-test-crate.glb', { tris: 4000 }), { budget: 100_000 });
  assert.deepEqual(r.errors, []);
  ok('按名字取预算（prop-key-* ≤ 3k 超出报错），--budget 可覆盖');

  r = await auditGlb(await write('prop-test-crate.glb', { lods: 3, tris: 800 }));
  assert.ok(r.warnings.some((w) => /只交 LOD0/.test(w)));
  assert.ok(r.info.some((l) => /固定 LOD0 1 个，丢弃低级 LOD 2 个/.test(l)), r.info.join('\n'));
  r = await auditGlb(await write('env-rock-test.glb', { critical: false, collider: false, interact: false, lods: 3, tris: 800 }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.summary.levels.length, 3);
  assert.ok(r.info.some((l) => /THREE\.LOD 1 个/.test(l)));
  ok('LOD：关键物体带低级 LOD 警告并在加载器里丢弃；普通物体 3 级组装成 THREE.LOD、各级面数统计');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n资源加载后处理 / 交付自检校验通过（${passed} 项）`);
