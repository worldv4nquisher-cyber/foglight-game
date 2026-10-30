// v0.1-013 渲染层能力校验（纯逻辑，无 GPU）：
//   1. 岩石实例化：实例矩阵 = 摆放 × 各级 _lodN 节点自己的矩阵（KHR_mesh_quantization 的平移 / 缩放），石头不缩小不下沉
//   2. 天空层：LOD 折叠到最后一级（三档一致）、frustumCulled 关、深度钉在远平面内侧（313 / 332 m 不被 250 m 视距裁掉）
//   3. 按物体雾：fog_fragment 换成 uObjFogDensity，138 m 处 0.0036 雾占比 ≈ 22 %（场景雾 0.028 会全白）
//   4. 材质提示：渔网 alphaHint = alphaHash → alphaHash 开、alphaTest 0
//   5. 外部 KTX2：S1 GLB 引用的 ../../textures/*.ktx2 相对 GLB 都能找到（和运行时 URL 解析一致）
// 有 ../art 时用真实美术 GLB；没有时只跑合成用例。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-render.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildLods } from '@/render/lod';
import { InstancedLodSet, lodLevelsOf } from '@/render/instancedLod';
import { makeSkyLayer, SKY_DEPTH } from '@/render/skyLayer';
import { applyObjectFog, fogExp2Factor, OBJECT_FOG_GLSL, readFogHint } from '@/render/objectFog';
import { applyMaterialHints } from '@/render/materialHints';
import { QUALITY_PRESETS } from '@/config/quality';
import { gameplay } from '@/config/gameplay';
import { artLanternFrame } from '@/levels/s2/lantern';
import { mountArtSlots } from '@/levels/artSlots';
import { S1_ART_SLOTS } from '@/levels/s1/artSlots';
import { S2_ART_SLOTS } from '@/levels/s2/artSlots';
import { S3_ART_SLOTS } from '@/levels/s3/artSlots';
import { manifest } from '@/assets/manifest';
import { S2 } from '@/levels/s2/layout';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(ROOT, '../art');
const hasArt = existsSync(resolve(ART, 'models/env/env-rock-shore-a.glb'));
const results = [];
async function test(name, fn) {
  try {
    const out = await fn();
    results.push([name, null, out]);
  } catch (e) {
    results.push([name, e]);
  }
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}±${eps}，实际 ${a}`);

async function loadGlb(rel) {
  globalThis.self ??= globalThis;
  const buf = readFileSync(resolve(ART, rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const ktx2Stub = { load: (_url, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(ab, '');
  buildLods(gltf.scene, () => {});
  applyMaterialHints(gltf.scene);
  return gltf.scene;
}

/** 合成的「量化」岩石：几何在 [-1,1] 归一化空间，_lodN 节点 scale 0.7 / translation.y 0.31 还原到米 */
function syntheticRock() {
  const root = new THREE.Group();
  root.name = 'rock';
  for (let i = 0; i < 3; i++) {
    const g = new THREE.BoxGeometry(2, 2 * 0.443, 2); // 归一化：高 0.886 → ×0.7 = 0.62 m
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    m.name = `rock_lod${i}`;
    m.position.set(0, 0.31, 0);
    m.scale.setScalar(0.7);
    root.add(m);
  }
  buildLods(root, () => {});
  return root;
}

function instanceBox(set, k, level = 0) {
  const l = set.levels[level];
  const geo = l.mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  return geo.boundingBox.clone().applyMatrix4(set.instanceMatrix(k, level));
}

await test('021 / 022 替换入口（合成）：没交付不挂；交付后挂到 socket、对齐白盒节点、drive 跟白盒转、白盒网格隐藏（物理不动）、自发光清零', () => {
  for (const spec of [...S1_ART_SLOTS, ...S2_ART_SLOTS, ...S3_ART_SLOTS]) {
    const e = manifest.find((x) => x.key === spec.key);
    assert.ok(e && e.optional && e.art, `${spec.key} 要在 manifest 里登记（optional 美术；未交付的标 pending）`);
  }
  const scene = new THREE.Group();
  const socket = new THREE.Object3D();
  socket.name = 'gate-socket';
  socket.position.set(5, 0, 2);
  socket.rotation.y = Math.PI / 2; // 挂点转 90°：世界增量照样对
  scene.add(socket);
  const hinge = new THREE.Group();
  hinge.name = 'gb-hinge';
  hinge.position.set(5.5, 0, 2);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1));
  leaf.name = 'gb-leaf';
  hinge.add(leaf);
  scene.add(hinge);
  const mkArt = () => {
    const r = new THREE.Group();
    const door = new THREE.Group();
    door.name = 'prop-x-gate-door';
    door.position.set(0.4, 0, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshStandardMaterial({ emissive: 0xffaa00 }));
    door.add(m);
    const col = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    col.name = 'prop-x-collider';
    r.add(door, col);
    return r;
  };
  const spec = [{ key: 'prop-x', at: ['missing-socket', 'gate-socket'], align: { art: 'gate-door', logic: 'gb-hinge' }, drive: [{ art: 'gate-door', logic: 'gb-hinge' }], hide: ['gb-hinge'] }];
  const none = mountArtSlots({ has: () => false, getModel: mkArt }, scene, spec);
  assert.equal(none.mounted.length, 0, '没交付不挂');
  assert.ok(leaf.visible, '没交付白盒照常显示');
  const s = mountArtSlots({ has: () => true, getModel: mkArt }, scene, spec);
  assert.equal(s.mounted.length, 1);
  const art = s.mounted[0].model;
  assert.equal(art.parent, socket, '挂到第一个存在的挂点');
  scene.updateMatrixWorld(true);
  const door = art.getObjectByName('prop-x-gate-door');
  const dw = door.getWorldPosition(new THREE.Vector3());
  near(dw.distanceTo(hinge.position), 0, 1e-6, '门扇节点对齐白盒合页');
  assert.equal(leaf.visible, false, '白盒网格隐藏');
  assert.equal(art.getObjectByName('prop-x-collider').visible, false, '美术 -collider 隐藏');
  let glow = 0;
  art.traverse((o) => o.isMesh && o.material.emissive?.getHex() && glow++);
  assert.equal(glow, 0, '自发光清零');
  hinge.rotation.y = 1.2;
  s.update();
  near(door.getWorldQuaternion(new THREE.Quaternion()).angleTo(hinge.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))), 0, 1e-6, 'drive 跟白盒转（世界增量）');
  hinge.rotation.set(0, 0, 0.3); // 绕白盒局部 Z 摆
  s.update();
  const tip = new THREE.Vector3(0, -1, 0).applyQuaternion(door.getWorldQuaternion(new THREE.Quaternion()));
  near(tip.x, Math.sin(0.3), 1e-6, '摆动平面一致（世界 x）');
  near(tip.z, 0, 1e-6, '摆动平面一致（世界 z）');
  const keys = [...S1_ART_SLOTS, ...S2_ART_SLOTS, ...S3_ART_SLOTS].length;
  return `合成门：挂点回退 / 对齐 / 世界增量跟转 / 隐藏 ✓；表里 ${keys} 处摆放全部登记进清单`;
});

await test('岩石实例化（合成）：实例矩阵乘上 _lodN 节点矩阵，顶面 = 摆放 y + 节点平移 + 半高', () => {
  const model = syntheticRock();
  const lv = lodLevelsOf(model);
  assert.equal(lv.length, 3, '三级');
  near(lv[0].local.elements[0], 0.7, 1e-6, '节点 scale');
  near(lv[0].local.elements[13], 0.31, 1e-6, '节点 translation.y');
  const set = new InstancedLodSet(model, [{ translation: [2, -0.1, 3], rotationY: 0.5, scale: 1 }]);
  set.updateMatrixWorld(true);
  const b = instanceBox(set, 0);
  near(b.max.y, -0.1 + 0.31 + 0.31, 0.01, '顶面');
  near(b.min.y, -0.1, 0.01, '底面不下沉');
  // 不乘节点矩阵的错误做法：顶面只有 0.343，底面 -0.543
  const naive = set.levels[0].mesh.geometry.boundingBox.clone().translate(new THREE.Vector3(2, -0.1, 3));
  assert.ok(naive.max.y < b.max.y - 0.15, '对照：只用 geometry 会矮一截');
  return `顶 ${b.max.y.toFixed(3)} / 底 ${b.min.y.toFixed(3)}`;
});

await test('实例 LOD 分级：按相机距离和画质 lodDistances 分到各级，回滞 10 %，三档距离各验一遍', () => {
  const model = syntheticRock();
  const pl = [0, 30, 70, 200].map((z) => ({ translation: [0, 0, -z], rotationY: 0, scale: 1 }));
  const set = new InstancedLodSet(model, pl);
  const cam = new THREE.PerspectiveCamera();
  for (const [tier, q] of Object.entries(QUALITY_PRESETS)) {
    set.setDistances(q.lodDistances);
    set.update(cam);
    const want = [0, 0, 0];
    for (const p of pl) {
      const d = -p.translation[2];
      want[d >= q.lodDistances[1] ? 2 : d >= q.lodDistances[0] ? 1 : 0]++;
    }
    assert.deepEqual(set.counts, want, tier);
  }
  // 回滞：standard 25 m 边界，实例在 24 m 时从 LOD1 不回 LOD0（要 < 22.5）
  set.setDistances([25, 60, 150]);
  const s2 = new InstancedLodSet(syntheticRock(), [{ translation: [0, 0, -26], rotationY: 0, scale: 1 }]);
  s2.setDistances([25, 60, 150]);
  s2.update(cam);
  assert.deepEqual(s2.counts, [0, 1, 0]);
  cam.position.z = -2; // 24 m
  s2.update(cam);
  assert.deepEqual(s2.counts, [0, 1, 0], '回滞内不切回');
  cam.position.z = -4; // 22 m
  s2.update(cam);
  assert.deepEqual(s2.counts, [1, 0, 0]);
  return 'ultra / high / standard ✓，回滞 ✓';
});

if (hasArt) {
  const layout = JSON.parse(readFileSync(resolve(ART, 'source/env/s1-layout.json'), 'utf8'));
  await test('岩石实例化（美术 env-rock-shore-a..f，KHR_mesh_quantization）：小径石顶面 = s1-layout topY，各级矩阵一致', async () => {
    const out = [];
    for (const r of 'abcdef') {
      const model = await loadGlb(`models/env/env-rock-shore-${r}.glb`);
      const inst = layout.instances.filter((i) => i.rock === r);
      const set = new InstancedLodSet(model, inst);
      set.updateMatrixWorld(true);
      const lv = lodLevelsOf(model);
      assert.ok(lv.length >= 2, `${r} 有 LOD`);
      assert.ok(Math.abs(lv[0].local.elements[0] - 1) > 0.05, `${r} 的 _lod0 节点带缩放（量化）`);
      inst.forEach((p, k) => {
        if (p.topY === undefined) return;
        const b = instanceBox(set, k);
        near(b.max.y, p.topY, 0.06, `rock-${r} #${k} 顶面`);
        for (let l = 1; l < set.levels.length; l++) near(instanceBox(set, k, l).max.y, b.max.y, 0.08, `rock-${r} #${k} LOD${l} 顶面`);
      });
      out.push(`${r}×${inst.length}`);
    }
    return out.join(' ');
  });

  await test('天空层（env-lighthouse-silhouette-far）：LOD 折叠到最后一级、不剔除、不投影，313 / 332 m 在三档视距外仍在深度范围内', async () => {
    const model = await loadGlb('models/env/env-lighthouse-silhouette-far.glb');
    const lastTris = (() => {
      let lod = null;
      model.traverse((o) => (lod ??= o.isLOD ? o : null));
      const obj = lod.levels[lod.levels.length - 1].object;
      return obj.geometry.index.count / 3;
    })();
    makeSkyLayer(model, { color: 0x10151a, fogDensity: 0.003 });
    let lods = 0;
    const meshes = [];
    model.traverse((o) => {
      if (o.isLOD) lods++;
      if (o.isMesh && !o.userData.collider) meshes.push(o);
    });
    assert.equal(lods, 0, '不再有 THREE.LOD');
    assert.equal(meshes.length, 1);
    assert.equal(meshes[0].geometry.index.count / 3, lastTris, '保留最后一级');
    assert.equal(meshes[0].frustumCulled, false);
    assert.equal(meshes[0].castShadow, false);
    // 顶点着色器注入：深度钉在远平面内侧
    const mat = meshes[0].material;
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    mat.onBeforeCompile(shader, null);
    assert.match(shader.vertexShader, /gl_Position\.z = gl_Position\.w \* 0\.99999/);
    assert.ok(shader.fragmentShader.includes('uObjFogDensity'));
    // 远景塔在 313 / 332 m：标准档 far = 250 时原始 z/w > 1（会被裁），钉住后 = SKY_DEPTH < 1
    for (const inst of layout.nodes['env-lighthouse-silhouette-far'].instances) {
      const d = Math.hypot(inst.translation[0] - -0.9, inst.translation[2] - 9.5);
      for (const q of Object.values(QUALITY_PRESETS)) {
        const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, q.viewDistance);
        const p = new THREE.Vector4(0, 0, -d, 1).applyMatrix4(cam.projectionMatrix);
        if (q.viewDistance < d) assert.ok(p.z / p.w > 1, '不钉深度会被裁');
        assert.ok(SKY_DEPTH < 1);
      }
    }
    return `保留 LOD2 ${lastTris} 面，距开场相机 ${layout.nodes['env-lighthouse-silhouette-far'].instances.map((i) => Math.hypot(i.translation[0] + 0.9, i.translation[2] - 9.5).toFixed(0)).join(' / ')} m`;
  });

  await test('按物体雾（env-lighthouse-island-main-s3tower extras fogLayer=mid, fogDensityHint=0.0036）', async () => {
    const model = await loadGlb('models/env/env-lighthouse-island-main-s3tower.glb');
    const hint = readFogHint(model);
    assert.equal(hint.layer, 'mid');
    assert.equal(hint.density, 0.0036);
    const before = new Set();
    model.traverse((o) => o.isMesh && before.add(o.material));
    const h = applyObjectFog(model, hint.density);
    model.traverse((o) => o.isMesh && assert.ok(!before.has(o.material), '材质克隆了（不改缓存里的）'));
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    h.materials[0].onBeforeCompile(shader, null);
    assert.ok(shader.fragmentShader.includes(OBJECT_FOG_GLSL.trim().split('\n')[1].trim()), '替换了 fog_fragment');
    assert.ok(!shader.fragmentShader.includes('#include <fog_fragment>'));
    assert.equal(shader.uniforms.uObjFogDensity, h.uniform);
    h.density = 0.004;
    assert.equal(shader.uniforms.uObjFogDensity.value, 0.004, '运行时改密度');
    const f = fogExp2Factor(0.0036, 138.4);
    near(f, 0.22, 0.02, '138.4 m 雾占比');
    assert.ok(fogExp2Factor(0.028, 138.4) > 0.999, '对照：场景雾会全白');
    return `138.4 m 雾 ${(f * 100).toFixed(1)} %（场景雾 0.028 → ${(fogExp2Factor(0.028, 138.4) * 100).toFixed(1)} %）`;
  });

  await test('渔网材质 alphaHint=alphaHash → alphaHash 开、alphaTest 0、不透明排序', async () => {
    for (const f of ['env-net-rack-a', 'env-net-rack-b']) {
      const model = await loadGlb(`models/env/${f}.glb`);
      let net = null;
      model.traverse((o) => {
        if (o.isMesh) for (const m of [o.material].flat()) if (m.name === 'mat-env-net') net = m;
      });
      assert.ok(net, `${f} 有 mat-env-net`);
      assert.equal(net.alphaHash, true);
      assert.equal(net.alphaTest, 0);
      assert.equal(net.transparent, false);
    }
    return 'net-rack-a / b ✓';
  });

  await test('S1 布局 = s1-layout.json（1029 起冲突以 json 为准）：美术节点、关键点、小船 / 系船节点（GLB）一致', async () => {
    const { S1 } = await import('@/levels/s1/layout');
    const eq = (a, b, msg, eps = 1e-3) => {
      assert.equal(a.length, b.length, msg);
      a.forEach((v, i) => near(v, b[i], eps, `${msg}[${i}]`));
    };
    for (const [k, n] of Object.entries(S1.artNodes)) {
      const j = layout.nodes[k];
      assert.ok(j, `json 没有 ${k}`);
      eq(n.translation, j.translation, k);
      near(n.rotationY, j.rotationY ?? 0, 1e-5, k + ' rotY');
    }
    const boat = layout.nodes['prop-boat-rowboat'];
    eq(S1.boat.position, boat.translation, '小船');
    near(S1.boat.rotationY, boat.rotationY, 1e-5, '小船 rotY');
    near(S1.boat.seabedY, boat.seabedY, 1e-6, '海床');
    eq(S1.boat.bowRing, boat.bowRingWorld, '船头环');
    const sb = layout.nodes['prop-boat-rowboat-sunken'];
    eq(S1.sunkenBoat.position, sb.translation, '沉船');
    const P = layout.points;
    for (const k of ['spawnStart', 'bellAnchor', 'safePoint', 'reefPathEnd', 'linkNear', 'linkFar', 'exitToS2', 'fishShed']) eq(S1[k], P[k], k);
    eq(S1.raft.home, P.raftHome, 'raftHome');
    eq(S1.raft.slot, P.stoneSlot, 'stoneSlot');
    eq(S1.stoneSlot.min, P.stoneSlotBox.min, 'stoneSlotBox.min');
    eq(S1.stoneSlot.max, P.stoneSlotBox.max, 'stoneSlotBox.max');
    near(S1.channel.trackMinX, P.stoneSlotBox.min[0], 1e-6, '石槽轨道 x');
    S1.reefPath.forEach((r, i) => eq(r, P.reefPath[i], `reefPath ${i}`));
    S1.ridge.forEach((r, i) => eq(r, P.ridge[i], `ridge ${i}`));
    S1.netRacks.forEach((r, i) => eq(r, P.netRacks[i], `netRacks ${i}`));
    for (const k of ['x0', 'run', 'rise', 'count']) near(S1.reefStairs[k], P.reefStairs[k], 1e-6, 'reefStairs.' + k);
    eq(S1.reefStairs.z, P.reefStairs.z, 'reefStairs.z');
    for (const k of ['z0', 'landing', 'count', 'rise', 'baseY']) near(S1.farSteps[k], P.farSteps[k], 1e-6, 'farSteps.' + k);
    near(S1.farSteps.run, P.farSteps.run, 1e-4, 'farSteps.run');
    eq(S1.farSteps.x, P.farSteps.x, 'farSteps.x');
    near(S1.farSteps.z0 + S1.farSteps.landing + S1.farSteps.count * S1.farSteps.run, P.farSteps.topZ, 1e-3, '台阶顶 z');
    near(S1.farSteps.baseY + S1.farSteps.count * S1.farSteps.rise, P.farSteps.topY, 1e-3, '台阶顶 y');
    eq(S1.plateau.min, P.plateau.min, 'plateau.min');
    eq(S1.plateau.max, P.plateau.max, 'plateau.max');
    near(S1.plateau.topY, P.plateau.topY, 1e-6, 'plateau.topY');
    // GLB：码头里的系船点 / 船绳端点、小船船头环，按 layout 摆放后的世界坐标
    const pier = await loadGlb('models/env/env-pier-wood-ch1.glb');
    const pn = S1.artNodes['env-pier-wood-ch1'];
    pier.position.set(...pn.translation);
    pier.rotation.y = pn.rotationY;
    pier.updateMatrixWorld(true);
    const w = (root, name) => {
      const o = root.getObjectByName(name);
      assert.ok(o, `GLB 缺节点 ${name}`);
      const v = o.getWorldPosition(new THREE.Vector3());
      return [v.x, v.y, v.z];
    };
    eq(w(pier, 'env-pier-wood-ch1-boat-mooring'), S1.boat.mooring, '系船点 boat-mooring', 0.01);
    assert.ok(pier.getObjectByName('env-pier-wood-ch1-bollard'), '旧系船点改名 -bollard');
    const ropeEnd = w(pier, 'env-pier-wood-ch1-rope-bow-end');
    const rb = await loadGlb('models/props/prop-boat-rowboat.glb');
    rb.position.set(...S1.boat.position);
    rb.rotation.y = S1.boat.rotationY;
    rb.updateMatrixWorld(true);
    const ring = w(rb, 'prop-boat-rowboat-bow-ring');
    eq(ring, S1.boat.bowRing, '船头环（涨潮）', 0.01);
    eq(ropeEnd, ring, '船绳端点 = 船头环（涨潮 1.6）', 0.01);
    // 船体尺寸（白盒退潮挡板用）= GLB
    let ex = null;
    rb.traverse((o) => {
      if (!ex && o.userData?.beamM) ex = o.userData;
    });
    assert.ok(ex, '小船 GLB extras');
    near(S1.boat.hull.beam, ex.beamM, 0.01, '船宽');
    near(S1.boat.belowWater, ex.waterlineY, 1e-6, '吃水');
    rb.position.set(0, 0, 0);
    rb.rotation.y = 0;
    rb.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    rb.traverse((o) => {
      if (o.isMesh && o.visible && !/collider/i.test(o.name)) bb.expandByObject(o);
    });
    near(S1.boat.hull.topY, bb.max.y, 0.01, '船舷顶');
    near(S1.boat.hull.length, bb.max.z - bb.min.z, 0.02, '船长');
    near(S1.boat.hull.centerZ, (bb.max.z + bb.min.z) / 2, 0.01, '船长中心');
    return `美术节点 ${Object.keys(S1.artNodes).length} 个、关键点、台阶 / 平台、小船 (${S1.boat.position.join(', ')}) 与系船点 (${S1.boat.mooring.join(', ')}) ✓`;
  });

  await test('S1 深水区 = 美术海床（env-tidal-flat-s1 LOD0）：区内海床 < −0.3（送回水深），区外滩地北段 / 合法路线不在区内', async () => {
    const { S1 } = await import('@/levels/s1/layout');
    const { polygonRegion } = await import('@/systems/tide/TideController');
    const { computeBoundsTree, acceleratedRaycast } = await import('three-mesh-bvh');
    const flat = await loadGlb('models/env/env-tidal-flat-s1.glb');
    const n = S1.artNodes['env-tidal-flat-s1'];
    flat.position.set(...n.translation);
    flat.rotation.y = n.rotationY;
    flat.updateMatrixWorld(true);
    const meshes = [];
    flat.traverse((o) => {
      if (o.isMesh && /_lod0_/.test(o.name)) {
        o.geometry.computeBoundsTree = computeBoundsTree;
        o.geometry.computeBoundsTree();
        o.raycast = acceleratedRaycast;
        o.material.side = THREE.DoubleSide;
        meshes.push(o);
      }
    });
    assert.ok(meshes.length, '地形 LOD0');
    const rc = new THREE.Raycaster();
    rc.firstHitOnly = true;
    const down = new THREE.Vector3(0, -1, 0);
    const H = (x, z) => {
      rc.set(new THREE.Vector3(x, 20, z), down);
      const h = rc.intersectObjects(meshes, false);
      return h.length ? Math.min(...h.map((q) => q.point.y)) : NaN;
    };
    near(H(S1.boat.position[0], S1.boat.position[2]), S1.boat.seabedY, 0.02, '小船处海床');
    const D = S1.deepWater;
    const inside = polygonRegion(D.polygon);
    let nIn = 0, deepIn = 0, worst = -Infinity, nOut = 0, deepOut = 0;
    for (let x = -19.5; x <= 15.5; x += 0.5) {
      for (let z = -17.5; z <= -4; z += 0.5) {
        const h = H(x, z);
        if (Number.isNaN(h)) continue;
        if (inside({ x, y: 0, z })) {
          nIn++;
          if (h < -gameplay.tide.recallDepth) deepIn++;
          worst = Math.max(worst, h);
        } else if (x > -10 && x < 12.5) {
          nOut++;
          if (h < -gameplay.tide.recallDepth) deepOut++;
        }
      }
    }
    assert.ok(deepIn / nIn >= 0.97, `区内海床 < −0.3 占 ${((deepIn / nIn) * 100).toFixed(1)}%（≥ 97%）`);
    assert.ok(worst < -0.15, `区内最高海床 ${worst.toFixed(3)} 仍明显在水下（< −0.15）`);
    assert.ok(deepOut / nOut <= 0.05, `区外（滩地北段）深水只占 ${((deepOut / nOut) * 100).toFixed(1)}%（≤ 5%）`);
    assert.ok(D.floorY <= -gameplay.tide.recallDepth - 0.1, 'floorY 退潮也超过送回水深');
    return `区内 ${nIn} 点 ${((deepIn / nIn) * 100).toFixed(1)}% < −0.3、最高 ${worst.toFixed(2)}；区外北段 ${nOut} 点深水 ${((deepOut / nOut) * 100).toFixed(1)}%`;
  });

  await test('船绳涨 / 退潮两版切换（等美术节点）：两版都找到才切换、按 switchLevel 切可见性；找不到 = null 保持现状；当前配置为空', async () => {
    const { makeTideVariantSwitch } = await import('@/levels/s1/art');
    const { S1 } = await import('@/levels/s1/layout');
    const root = new THREE.Group();
    const hi = new THREE.Object3D();
    hi.name = 'rope-high';
    const lo = new THREE.Object3D();
    lo.name = 'rope-low';
    root.add(hi, lo);
    const sw = makeTideVariantSwitch(root, { high: ['rope-high'], low: ['rope-low'], switchLevel: 0.8 });
    assert.ok(sw);
    sw.update(1.6);
    assert.ok(hi.visible && !lo.visible, '涨潮显示涨潮版');
    sw.update(0);
    assert.ok(!hi.visible && lo.visible, '退潮显示退潮版');
    sw.update(0.79);
    assert.equal(sw.state, 'low');
    sw.update(0.8);
    assert.equal(sw.state, 'high');
    assert.equal(makeTideVariantSwitch(root, { high: ['rope-high'], low: ['nope'], switchLevel: 0.8 }), null, '缺一版 = 不切换');
    assert.equal(makeTideVariantSwitch(root, S1.boatRope), null, '当前未配节点名 = 保持现状');
    return `节点名待美术（S1.boatRope high ${S1.boatRope.high.length} / low ${S1.boatRope.low.length}）`;
  });

  await test('021 风灯 prop-lantern-brass：原点 = 提手，hang（提手到灯底）/ -emitter 与 017 对齐值一致', async () => {
    const lantern = await loadGlb('models/props/prop-lantern-brass.glb');
    let critical = false;
    lantern.traverse((o) => (critical ||= o.userData?.puzzleCritical === true));
    assert.ok(critical, 'puzzleCritical（加载器强制 LOD0）');
    const f = artLanternFrame(lantern);
    near(f.hang, 0.28, 0.005, '提手到灯底');
    near(f.light.y, -0.162, 0.002, '-emitter 高度（提手下）');
    // 书桌：桌面 3.75 + hang = 二层地板 3.0 上 1.03 m（017 xi-place-table 提手高）
    near(S2.points.lanternSocket[1] + f.hang - S2.house.upperFloorY, 1.03, 0.005, '书桌 socket 提手高');
    let glow = 0;
    lantern.traverse((o) => {
      if (o.isMesh) for (const m of [o.material].flat()) if (m.emissive && m.emissive.getHex() !== 0) glow++;
    });
    assert.ok(glow >= 1, '灯罩发光材质要保留（程序不清零）');
    return `hang ${f.hang.toFixed(3)}、emitter y ${f.light.y.toFixed(3)}、书桌提手离地 ${(S2.points.lanternSocket[1] + f.hang - S2.house.upperFloorY).toFixed(3)} m`;
  });

  await test('021 灯台 prop-lantern-stand-s2：院墙 lamp socket = 白盒灯台位置；-socket 挂风灯后光源中心 = 白盒出光高度', async () => {
    const wall = await loadGlb('models/env/env-courtyard-wall-s2.glb');
    const n = S2.artNodes['env-courtyard-wall-s2'];
    wall.position.set(...n.translation);
    wall.rotation.y = n.rotationY;
    wall.updateMatrixWorld(true);
    const stand = await loadGlb('models/props/prop-lantern-stand-s2.glb');
    const lantern = await loadGlb('models/props/prop-lantern-brass.glb');
    const f = artLanternFrame(lantern);
    const out = [];
    for (const k of ['east', 'west']) {
      const s = wall.getObjectByName(`env-courtyard-wall-s2-lamp-${k}-socket`);
      assert.ok(s, `院墙缺 lamp-${k}-socket`);
      const w = s.getWorldPosition(new THREE.Vector3());
      near(w.x, S2.lamps[k][0], 0.01, `${k} x`);
      near(w.z, S2.lamps[k][2], 0.01, `${k} z`);
      const st = stand.clone();
      s.add(st);
      wall.updateMatrixWorld(true);
      const sock = st.getObjectByName('prop-lantern-stand-s2-socket');
      const dir = st.getObjectByName('prop-lantern-stand-s2-emitter-dir');
      assert.ok(sock && dir, '灯台缺 -socket / -emitter-dir');
      const sw = sock.getWorldPosition(new THREE.Vector3());
      near(dir.getWorldPosition(new THREE.Vector3()).y, S2.lampEmitY, 0.01, `${k} -emitter-dir 高`);
      near(sw.y + f.light.y, S2.lampEmitY, 0.01, `${k} 风灯光源中心`);
      out.push(`${k} socket (${sw.x.toFixed(2)}, ${sw.y.toFixed(3)}, ${sw.z.toFixed(2)})`);
    }
    return out.join('；');
  });

  await test('021 潮汐钟 prop-tide-bell：S1 bell-anchor / S3 tide-bell-s3-socket = 白盒钟位、正面朝白盒站位、触点高 1.10、bell-swing / bell-clapper 跟白盒（世界增量）、站位读 prop-tide-bell-interact、README 摆动公式（ring 帧 0.100 rad）', async () => {
    const { S1 } = await import('@/levels/s1/layout');
    const { S3 } = await import('@/levels/s3/layout');
    const out = [];
    const cases = [
      ['S1', 'models/env/env-shore-ledge-s1.glb', S1.artNodes['env-shore-ledge-s1'], 'env-shore-ledge-s1-bell-anchor', S1.bellAnchor, [S1.bellAnchor[0] + 1.05, S1.bellAnchor[1], S1.bellAnchor[2]], 'prop-tide-bell'],
      ['S3', 'models/env/env-rock-islet-a.glb', { translation: [0, 0, 0], rotationY: 0 }, 'tide-bell-s3-socket', S3.points.bellSocket, S3.points.bellInteract, 'prop-tide-bell-s3'],
    ];
    for (const [sc, file, place, anchorName, sock, stand, key] of cases) {
      const scene = new THREE.Group();
      const env = await loadGlb(file);
      env.position.set(...place.translation);
      env.rotation.y = place.rotationY;
      scene.add(env);
      // 白盒钟（同 puzzles.ts：钟架局部 +X = 站位方向，swing 绕局部 Z）
      const [bx, by, bz] = sock;
      const gb = new THREE.Group();
      gb.name = sc === 'S1' ? 'tide-bell-s1' : 'tide-bell-s3';
      gb.position.set(bx, by, bz);
      gb.rotation.y = Math.atan2(-(stand[2] - bz), stand[0] - bx);
      const sw = new THREE.Group();
      sw.name = `${gb.name}-swing`;
      sw.position.set(0, 2.05, 0);
      sw.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3)));
      const cl = new THREE.Object3D();
      cl.name = `${gb.name}-clapper`;
      cl.position.y = -0.28;
      sw.add(cl);
      gb.add(sw);
      const gbStand = new THREE.Object3D();
      gbStand.position.set(bx + 1.05 * Math.cos(gb.rotation.y), by, bz - 1.05 * Math.sin(gb.rotation.y));
      gbStand.lookAt(bx, by, bz);
      scene.add(gbStand);
      scene.add(gb);
      scene.updateMatrixWorld(true);
      const bellGlb = await loadGlb('models/props/prop-tide-bell.glb');
      const spec = (sc === 'S1' ? S1_ART_SLOTS : S3_ART_SLOTS).find((x) => x.key === key);
      const slots = mountArtSlots({ has: () => true, getModel: () => bellGlb.clone() }, scene, [spec]);
      assert.equal(slots.mounted.length, 1);
      const art = slots.mounted[0].model;
      assert.equal(art.parent.name, anchorName, `${sc} 挂在 ${anchorName}`);
      assert.deepEqual(slots.mounted[0].missingNodes, []);
      scene.updateMatrixWorld(true);
      const p = art.getWorldPosition(new THREE.Vector3());
      near(p.distanceTo(new THREE.Vector3(...sock)), 0, 0.01, `${sc} 钟位`);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(art.getWorldQuaternion(new THREE.Quaternion()));
      const toStand = new THREE.Vector3(stand[0] - bx, 0, stand[2] - bz).normalize();
      near(fwd.dot(toStand), 1, 0.01, `${sc} 正面朝白盒站位`);
      const contact = art.getObjectByName('prop-tide-bell-contact').getWorldPosition(new THREE.Vector3());
      near(contact.y - by, 1.1, 0.01, `${sc} 触点高`);
      const dist = Math.hypot(stand[0] - bx, stand[2] - bz);
      // 白盒钟摆往站位反方向摆 0.3 rad → 美术钟口也往远离站位的方向走
      const lip = art.getObjectByName('bell-swing');
      const lip0 = new THREE.Vector3(0, -1, 0).applyQuaternion(lip.getWorldQuaternion(new THREE.Quaternion()));
      sw.rotation.z = 0.3;
      slots.update();
      scene.updateMatrixWorld(true);
      const lip1 = new THREE.Vector3(0, -1, 0).applyQuaternion(lip.getWorldQuaternion(new THREE.Quaternion()));
      const gbLip = new THREE.Vector3(0, -1, 0).applyQuaternion(sw.getWorldQuaternion(new THREE.Quaternion()));
      near(lip1.angleTo(gbLip), 0, 1e-4, `${sc} 摆动方向与白盒一致`);
      near(lip0.angleTo(lip1), 0.3, 1e-4, `${sc} 摆幅`);
      sw.rotation.z = 0;
      // 站位：snapToArt 读 prop-tide-bell-interact（S1 世界 ≈ (−14.52, 2.4, −6.2)），+Z 朝钟
      const { snapToArt } = await import('@/levels/artSlots');
      assert.ok(snapToArt(slots, key, 'prop-tide-bell-interact', gbStand));
      const sp = gbStand.getWorldPosition(new THREE.Vector3());
      near(Math.hypot(sp.x - bx, sp.z - bz), 0.98, 0.005, `${sc} 站位离钟轴`);
      if (sc === 'S1') near(sp.distanceTo(new THREE.Vector3(-14.52, 2.4, -6.2)), 0, 0.01, 'S1 站位世界坐标');
      else near(sp.distanceTo(new THREE.Vector3(...stand)), 0, 0.01, 'S3 站位 = tide-bell-s3-interact');
      const sf = new THREE.Vector3(0, 0, 1).transformDirection(gbStand.matrixWorld);
      near(sf.dot(new THREE.Vector3(bx - sp.x, 0, bz - sp.z).normalize()), 1, 0.01, `${sc} 站位朝钟`);
      // TideBell 按 README 公式驱动：ring 帧（30）θ ≈ +0.100（钟口远离站位）、自由摆、钟锤滞后
      const { TideBell } = await import('@/systems/tide/TideBell');
      const { xiEventSec } = await import('@/entities/xi/clips');
      const anim = { animState: null };
      const tide = { id: 'z', state: 'low', transitioning: false, toggle: () => true };
      const bell = new TideBell({ id: 'b', tide, object: gb, swing: sw, clapper: cl, animSource: anim, events: { on: () => () => {}, emit: () => {} } });
      const ring = xiEventSec('xi-ring-bell', 'ring');
      const dt = 1 / 60;
      const lipAway = () => {
        slots.update();
        scene.updateMatrixWorld(true);
        const l = new THREE.Vector3(0, -1, 0).applyQuaternion(lip.getWorldQuaternion(new THREE.Quaternion()));
        const away = new THREE.Vector3(bx - sp.x, 0, bz - sp.z).normalize();
        return Math.asin(l.dot(away));
      };
      for (let t = 0; t <= ring + 1e-9; t += dt) { anim.animState = { id: 'b', clip: 'xi-ring-bell', t, fired: false }; bell.update(dt); }
      near(lipAway(), Math.asin(0.07 / 0.7), 0.011, `${sc} ring 帧钟口推开 0.100 rad（± 闲置风摆 0.01）`);
      anim.animState = null;
      assert.ok(bell.ring());
      let maxA = 0, minA = 0, maxC = 0;
      for (let t = 0; t < 3; t += dt) { bell.update(dt); const a = lipAway(); maxA = Math.max(maxA, a); minA = Math.min(minA, a); maxC = Math.max(maxC, Math.abs(bell.clapperAngle)); }
      assert.ok(maxA < 0.35 && minA > -0.35, `${sc} 摆幅在 ±0.35 余量内：${minA} .. ${maxA}`);
      assert.ok(maxC > 0.01 && maxC <= 0.41 + 1e-9, `${sc} 钟锤滞后：${maxC}`);
      const artClap = art.getObjectByName('bell-clapper');
      const rel = new THREE.Quaternion().copy(lip.getWorldQuaternion(new THREE.Quaternion())).invert().multiply(artClap.getWorldQuaternion(new THREE.Quaternion()));
      near(2 * Math.acos(Math.min(1, Math.abs(rel.w))), Math.abs(bell.clapperAngle), 1e-3, `${sc} 美术钟锤相对钟体角 = 白盒`);
      out.push(`${sc} 钟位 (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})、站位 (${sp.x.toFixed(2)}, ${sp.y.toFixed(2)}, ${sp.z.toFixed(2)}) 离钟轴 0.98（白盒原 ${dist.toFixed(2)}）、自由摆 ${minA.toFixed(3)}..${maxA.toFixed(3)} rad、钟锤最大相对 ${maxC.toFixed(3)}`);
    }
    return out.join('；');
  });

  await test('021 木筏 prop-raft-s1：根零变换挂白盒 raft-s1、collider 2.0×0.3×3.0 = 白盒、interact / waterline / stand / takeoff / 甲板高与白盒逻辑一致（跨越落点离沿 ≥ 0.30）', async () => {
    const { S1, s1StepLinks } = await import('@/levels/s1/layout');
    const { XI_STEP_ACROSS, xiEventSec } = await import('@/entities/xi/clips');
    const { gameplay } = await import('@/config/gameplay');
    const glb = await loadGlb('models/props/prop-raft-s1.glb');
    const rf = S1.raft;
    let rootEx = null;
    glb.traverse((o) => { if (!rootEx && o.userData?.deckGroundedY !== undefined) rootEx = o.userData; });
    assert.ok(rootEx, '根 extras 缺 deckGroundedY');
    near(rootEx.deckGroundedY, rf.home[1], 1e-6, 'deckGroundedY = home y');
    near(rootEx.deckFloatY, S1.nearPlatform.topY, 1e-6, 'deckFloatY = 岸台顶面（跨越条件 ±5 cm）');
    near(rootEx.floatOffset, rf.floatOffset, 1e-6, 'floatOffset');
    // 白盒浮台根（同 puzzles.ts）+ 美术零变换挂上
    const scene = new THREE.Group();
    const raftRoot = new THREE.Group();
    raftRoot.name = 'raft-s1';
    raftRoot.position.set(...rf.home);
    const gbBox = new THREE.Mesh(new THREE.BoxGeometry(...rf.size));
    gbBox.position.y = -rf.size[1] / 2;
    raftRoot.add(gbBox);
    const gbPoint = new THREE.Object3D();
    gbPoint.position.set(rf.size[0] / 2 + 0.45, -(rf.home[1] - S1.sandY), 0);
    gbPoint.rotation.y = -Math.PI / 2;
    raftRoot.add(gbPoint);
    scene.add(raftRoot);
    scene.updateMatrixWorld(true);
    const spec = S1_ART_SLOTS.find((x) => x.key === 'prop-raft-s1');
    const slots = mountArtSlots({ has: () => true, getModel: () => glb.clone() }, scene, [spec]);
    const art = slots.mounted[0].model;
    assert.equal(art.parent, raftRoot);
    assert.ok(art.position.lengthSq() === 0 && art.quaternion.equals(new THREE.Quaternion()), '零变换');
    scene.updateMatrixWorld(true);
    const local = (n) => { const o = art.getObjectByName(n); assert.ok(o, '缺节点 ' + n); return raftRoot.worldToLocal(o.getWorldPosition(new THREE.Vector3())); };
    // collider：2.0 × 0.30 × 3.0，顶面 y 0 = 白盒
    const col = art.getObjectByName('prop-raft-s1-collider');
    const cb = new THREE.Box3().setFromObject(col, true);
    const gb = new THREE.Box3().setFromObject(gbBox, true);
    for (const k of ['min', 'max']) for (const ax of ['x', 'y', 'z']) near(cb[k][ax], gb[k][ax], 0.01, `collider ${k}.${ax}`);
    // 推站位：同位同向；snap 后也不动
    const ip = local('prop-raft-s1-interact');
    near(ip.distanceTo(gbPoint.position), 0, 0.01, 'interact 位置 = 白盒');
    const { snapToArt } = await import('@/levels/artSlots');
    const before = gbPoint.getWorldPosition(new THREE.Vector3());
    assert.ok(snapToArt(slots, 'prop-raft-s1', 'prop-raft-s1-interact', gbPoint));
    near(gbPoint.getWorldPosition(new THREE.Vector3()).distanceTo(before), 0, 0.01, 'snap 后推站位不变');
    const f = new THREE.Vector3(0, 0, 1).transformDirection(gbPoint.matrixWorld);
    near(f.x, -1, 1e-3, '推站位 +Z 朝 −X（推向石槽）');
    const ie = art.getObjectByName('prop-raft-s1-interact').userData;
    if (ie.speedMps !== undefined) near(ie.speedMps, gameplay.interaction?.pushSpeed ?? 0.8, 1e-6, 'speedMps = pushSpeed');
    if (ie.events?.handsOn !== undefined) near(ie.events.handsOn / 30, xiEventSec('xi-push-start', 'handsOn'), 1e-6, 'handsOn 帧');
    // 漂浮：waterline = −floatOffset
    near(local('prop-raft-s1-waterline').y, -rf.floatOffset, 0.005, 'waterline');
    // 跨越：stand-s / -n 离沿 = landMargin（≥ 0.30）、takeoff 离沿 = 起跳内缩；与 s1StepLinks 一致
    const half = rf.size[2] / 2;
    const links = s1StepLinks();
    const sS = local('prop-raft-s1-stand-s'), sN = local('prop-raft-s1-stand-n');
    near(half + sS.z, XI_STEP_ACROSS.landMarginM, 0.005, 'stand-s 离南沿');
    near(half - sN.z, XI_STEP_ACROSS.landMarginM, 0.005, 'stand-n 离北沿');
    assert.ok(half + sS.z >= 0.3 && half - sN.z >= 0.3, '落点离沿 ≥ 0.30');
    near(rf.slot[2] + sS.z, links[0].end, 0.005, '岸台 → 浮台落点 = stand-s');
    near(rf.slot[2] + sN.z, links[3].end, 0.005, '台阶 → 浮台落点 = stand-n');
    for (const [n, li] of [['prop-raft-s1-stand-s', 1], ['prop-raft-s1-stand-n', 2]]) {
      const t = art.getObjectByName(n).userData.takeoff;
      assert.ok(Array.isArray(t), n + ' extras.takeoff');
      near(rf.slot[2] + t[2], links[li].start, 0.005, `${n} takeoff = 浮台起跳点`);
    }
    // 外形：除 +X 推把外在 2.0 × 3.0 内
    const lod = new THREE.Box3();
    art.traverse((o) => { if (o.isMesh && o.visible && !/collider/.test(o.name)) lod.expandByObject(o, true); });
    assert.ok(!lod.isEmpty(), '没有渲染网格');
    const lx = raftRoot.worldToLocal(lod.min.clone()), hx = raftRoot.worldToLocal(lod.max.clone());
    assert.ok(lx.x >= -1.01 && Math.abs(lx.z) <= 1.51 && Math.abs(hx.z) <= 1.51, '外形越界 ' + JSON.stringify([lx, hx]));
    return `collider = 白盒、interact (${ip.x.toFixed(2)}, ${ip.y.toFixed(2)}, ${ip.z.toFixed(2)})、stand 离沿 ${(half + sS.z).toFixed(2)} / ${(half - sN.z).toFixed(2)}、takeoff = s1StepLinks 起跳点、deck ${rootEx.deckGroundedY} → ${rootEx.deckFloatY}`;
  });

  await test('外部 KTX2：S1 全部 GLB 的 images.uri 相对 GLB 解析后存在（运行时 assets/art/models/env/../../textures/ 同理）', () => {
    const files = [...new Set(Object.values(layout.nodes).flatMap((n) => [n.file, ...(n.socketInstances ?? []).map((s) => s.file)]).filter(Boolean))];
    let n = 0;
    for (const f of files) {
      const abs = resolve(ART, f);
      const b = readFileSync(abs);
      const j = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
      for (const img of j.images ?? []) {
        assert.ok(img.uri && !img.uri.startsWith('data:'), `${f} 贴图应为外部文件`);
        assert.ok(img.uri.endsWith('.ktx2'), `${f} ${img.uri} 应为 KTX2`);
        const t = resolve(dirname(abs), img.uri);
        assert.ok(existsSync(t), `${f} → ${img.uri} 不存在`);
        assert.equal(readFileSync(t).subarray(1, 4).toString('ascii'), 'KTX');
        n++;
      }
    }
    return `${files.length} 个 GLB / ${n} 处外部 KTX2 引用`;
  });
}

let failed = 0;
for (const [name, err, out] of results) {
  if (err) {
    failed++;
    console.log(`✗ ${name}\n   ${err.message.split('\n')[0]}`);
  } else console.log(`✓ ${name}${out ? '：' + out : ''}`);
}
if (!hasArt) console.log('（没有 ../art：只跑了合成用例）');
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
