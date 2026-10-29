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
