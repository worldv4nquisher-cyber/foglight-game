// v0.1-029 光照贴图接入校验（Node，无 GPU）：
//   1. RGBM8 解码 / 编码往返（编码定案公式），着色器替换能对上 three 的 chunk 原文（RGBM 解码 + 去半球光）
//   2. 9 张 KTX2：UASTC、线性（DFD transfer = linear，不标 sRGB）、带 alpha、2048²、有 mip；manifest 登记 srgb:false、组 = 场景
//   3. 15 个 GLB：根 extras.lightmap（RGBM8 / TEXCOORD_1 / intensity 1 / rect = 需求单），各 LOD 网格都有 uv1 且落在 rect 内
//      （rect 已烤进 UV2 → 程序不设 offset / repeat），applySceneLightmaps 只挂可见网格（-collider / -wall 不挂），贴图 channel 1 / NoColorSpace / flipY false
//   4. 运行时倍率：雨夜 ×0.35、开门角 −100° = 1、关门 = closed 且单调；天空分界点 0.18 / 0.7 与 028 json 一致
// 运行：npm run test:lightmap
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  RGBM_RANGE,
  decodeRgbm,
  decodeRgbm8,
  encodeRgbm,
  patchLightmapChunks,
  patchLightmapShader,
  readLightmapExtras,
  applySceneLightmaps,
  lightmapKey,
  presetLightmapScale,
  doorLightmapScale,
  LIGHTMAP_SAMPLE_RGBM,
} from '@/render/lightmap';
import { manifest } from '@/assets/manifest';
import { ATMOSPHERE_PRESETS, RAIN_NIGHT_LIGHT_MUL } from '@/config/atmosphere';
import { ATMO028 } from '@/config/atmosphere028';
import { S3_TOWER_CLOSED_LM, S2_CELLAR_CLOSED_LM } from '@/levels/lightmaps';
import { S1 } from '@/levels/s1/layout';
import { makeTideVariantSwitch } from '@/levels/s1/art';
import { S2 } from '@/levels/s2/layout';
import { CellarKeyLight, CELLAR_KEY_LIGHT, inCellar } from '@/levels/s2/cellarKeyLight';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(ROOT, '../art');
const hasArt = existsSync(resolve(ART, 'textures/README-029.md'));
const results = [];
async function test(name, fn) {
  try {
    const out = await fn();
    results.push([name, null, out]);
  } catch (e) {
    results.push([name, e]);
  }
}

/** 需求单 / README-029 的对应表：GLB → [贴图, rect] */
const EXPECT = {
  'env-tidal-flat-s1': ['s1', 'tex-s1-tidal-flat-lightmap', [0, 0, 1, 1]],
  'env-cliff-s1': ['s1', 'tex-s1-cliff-lightmap', [0, 0, 1, 1]],
  'env-shore-ledge-s1': ['s1', 'tex-s1-shore-lightmap', [0, 0, 0.5, 0.5]],
  'env-pier-wood-ch1': ['s1', 'tex-s1-shore-lightmap', [0.5, 0, 0.5, 0.5]],
  'env-fish-shed-ruin': ['s1', 'tex-s1-shore-lightmap', [0, 0.5, 0.375, 0.375]],
  'env-net-rack-a': ['s1', 'tex-s1-shore-lightmap', [0.375, 0.5, 0.1875, 0.1875]],
  'env-net-rack-b': ['s1', 'tex-s1-shore-lightmap', [0.5625, 0.5, 0.1875, 0.1875]],
  'env-clifftop-s2': ['s2', 'tex-s2-clifftop-lightmap', [0, 0, 1, 1]],
  'env-keeper-house-ch1': ['s2', 'tex-s2-exterior-lightmap', [0, 0, 0.5625, 0.5625]],
  'env-courtyard-wall-s2': ['s2', 'tex-s2-exterior-lightmap', [0.5625, 0, 0.4375, 0.4375]],
  'env-laundry-rack': ['s2', 'tex-s2-exterior-lightmap', [0.5625, 0.4375, 0.0625, 0.0625]],
  'env-keeper-house-ch1-interior': ['s2', 'tex-s2-interior-lightmap', [0, 0, 0.6875, 0.6875]],
  'env-cellar-s2': ['s2', 'tex-s2-interior-lightmap', [0.6875, 0, 0.3125, 0.3125]],
  'env-lighthouse-ch1': ['s3', 'tex-s3-tower-lightmap', [0, 0, 1, 1]],
  'env-rock-islet-a': ['s3', 'tex-s3-islet-lightmap', [0, 0, 0.625, 0.625]],
  'env-stone-bridge-s3': ['s3', 'tex-s3-islet-lightmap', [0.625, 0, 0.375, 0.375]],
  'env-lighthouse-ch1-interior': ['s3', 'tex-s3-interior-lightmap', [0, 0, 0.75, 0.75]],
  'env-lamp-room-ch1': ['s3', 'tex-s3-interior-lightmap', [0.75, 0, 0.25, 0.25]],
};
/** 不挂光照贴图的（门 / 透镜 / 钥匙等）：GLB 根上不应该有 extras.lightmap.texture */
const NOT_BAKED = ['env/env-lighthouse-ch1-door', 'env/env-cellar-door-s2', 'props/prop-fresnel-lens-ch1', 'props/prop-key-cellar-s2', 'props/prop-key-lighthouse', 'props/prop-sketch-window', 'props/prop-journal-father', 'props/prop-cup-tin'];

// ---------------------------------------------------------------- 1. 解码
await test('RGBM8 解码 = rgb·a·8，编码往返误差 ≤ 1 个量化级', () => {
  assert.equal(RGBM_RANGE, 8);
  assert.deepEqual(decodeRgbm(1, 0.5, 0.25, 1), [8, 4, 2]);
  assert.deepEqual(decodeRgbm(0.5, 0.5, 0.5, 0.5), [2, 2, 2]);
  assert.deepEqual(decodeRgbm(1, 1, 1, 0), [0, 0, 0]);
  assert.deepEqual(decodeRgbm8([255, 255, 255, 255]), [8, 8, 8]);
  const [r] = decodeRgbm8([128, 0, 0, 16]);
  assert.ok(Math.abs(r - (128 / 255) * (16 / 255) * 8) < 1e-12);
  let worst = 0;
  for (const E of [0.001, 0.01, 0.03, 0.1, 0.16, 0.382, 0.654, 0.7, 1, 2.5, 7.9]) {
    for (const tint of [[1, 1, 1], [0.86, 0.94, 1], [0.6, 0.7, 1]]) {
      const L = tint.map((t) => t * E);
      const enc = encodeRgbm(L[0], L[1], L[2]);
      // 8 位量化（RGB 四舍五入；A 编码时已向上取到 1/255）
      const q = enc.map((v) => Math.round(v * 255) / 255);
      const dec = decodeRgbm(q[0], q[1], q[2], q[3]);
      for (let c = 0; c < 3; c++) {
        // RGB 量化误差 ≤ 0.5/255 × 8M
        const tol = (0.5 / 255) * 8 * q[3] + 1e-9;
        assert.ok(Math.abs(dec[c] - L[c]) <= tol, `E=${E} c=${c} ${dec[c]} vs ${L[c]}`);
        worst = Math.max(worst, Math.abs(dec[c] - L[c]) / Math.max(L[c], 1e-6));
      }
    }
  }
  // 截断：> 8 的截到 8
  const big = encodeRgbm(12, 1, 1);
  assert.equal(big[3], 1);
  assert.ok(decodeRgbm(...big)[0] <= 8 + 1e-9);
  return `往返最大相对误差 ${(worst * 100).toFixed(2)}%（暗部 E=0.001）`;
});

await test('着色器替换：lights_fragment_maps → RGBM 解码，lights_fragment_begin 去半球光（three 原文变了会抛错）', () => {
  const p = patchLightmapChunks(THREE.ShaderChunk.lights_fragment_maps, THREE.ShaderChunk.lights_fragment_begin);
  assert.ok(p.maps.includes(LIGHTMAP_SAMPLE_RGBM) && p.maps.includes('lightMapTexel.a * 8.0'));
  assert.ok(!p.maps.includes('lightMapTexel.rgb * lightMapIntensity;'));
  assert.ok(!p.begin.includes('getHemisphereLightIrradiance('), '去掉半球光');
  // 其余间接光（环境光 / 探针）原样保留
  assert.ok(p.begin.includes('getAmbientLightIrradiance') && p.begin.includes('getLightProbeIrradiance'));
  // 实际片元着色器：standard 的 include 都被展开成改过的版本
  const frag = patchLightmapShader(THREE.ShaderLib.standard.fragmentShader);
  assert.ok(!frag.includes('#include <lights_fragment_maps>') && !frag.includes('#include <lights_fragment_begin>'));
  assert.ok(frag.includes(LIGHTMAP_SAMPLE_RGBM));
  assert.throws(() => patchLightmapChunks('x', p.begin));
  assert.throws(() => patchLightmapChunks(THREE.ShaderChunk.lights_fragment_maps, 'x'));
  return 'standard 片元着色器两处都替换';
});

await test('运行时倍率：雨夜 ×0.35、开门角', () => {
  assert.equal(presetLightmapScale(ATMOSPHERE_PRESETS['overcast-dusk'].hemiIntensity), 1);
  assert.equal(presetLightmapScale(ATMOSPHERE_PRESETS['overcast-after-rain'].hemiIntensity), 1);
  assert.ok(Math.abs(presetLightmapScale(ATMOSPHERE_PRESETS['rain-night'].hemiIntensity) - RAIN_NIGHT_LIGHT_MUL) < 1e-12);
  for (const closed of [S3_TOWER_CLOSED_LM, S2_CELLAR_CLOSED_LM]) {
    assert.ok(closed > 0 && closed < 1);
    assert.equal(doorLightmapScale(1, closed), 1);
    assert.equal(doorLightmapScale(0, closed), closed);
    let prev = -1;
    for (let i = 0; i <= 50; i++) {
      const k = doorLightmapScale(i / 50, closed);
      assert.ok(k >= prev);
      prev = k;
    }
    // 两端导数 0（平滑）
    assert.ok(doorLightmapScale(0.02, closed) - closed < 0.002 && 1 - doorLightmapScale(0.98, closed) < 0.002);
  }
  return `塔门关 ×${S3_TOWER_CLOSED_LM}，地窖门关 ×${S2_CELLAR_CLOSED_LM}`;
});

await test('天空分界点 0.18 / 0.7（烘焙用的三个预设）与 028 json 一致', () => {
  for (const id of ['overcast-dusk', 'overcast-after-rain', 'after-lit']) {
    assert.equal(ATMO028.presets[id].sky.midElev, 0.18, id);
    assert.equal(ATMO028.presets[id].sky.topElev, 0.7, id);
  }
  const jf = resolve(ART, 'source/atmosphere/atmosphere-028.json');
  if (existsSync(jf)) {
    const j = JSON.parse(readFileSync(jf, 'utf8'));
    for (const [id, p] of Object.entries(ATMO028.presets)) {
      assert.equal(p.sky.midElev, j.presets[id].sky.midElev, id);
      assert.equal(p.sky.topElev, j.presets[id].sky.topElev, id);
    }
  }
  const rn = ATMO028.presets['rain-night'].sky;
  return `dusk / after-rain / after-lit = 0.18 / 0.7；rain-night ${rn.midElev} / ${rn.topElev}（028 原样，非烘焙预设）`;
});

// ---------------------------------------------------------------- 2. manifest + KTX2
await test('manifest：9 张光照贴图 srgb:false、组 = 场景；GLB 所在组有对应贴图', () => {
  const texKeys = [...new Set(Object.values(EXPECT).map((e) => e[1]))];
  assert.equal(texKeys.length, 9);
  for (const k of texKeys) {
    const e = manifest.find((m) => m.key === k);
    assert.ok(e, `manifest 缺 ${k}`);
    assert.equal(e.type, 'ktx2');
    assert.equal(e.srgb, false, `${k} 要 srgb:false`);
    assert.equal(e.url, `assets/art/textures/${k}.ktx2`);
    const scene = Object.values(EXPECT).find((x) => x[1] === k)[0];
    assert.equal(e.group, scene, `${k} 组`);
  }
  for (const [glb, [g]] of Object.entries(EXPECT)) {
    const e = manifest.find((m) => m.url.endsWith(`/${glb}.glb`) && m.group === g);
    assert.ok(e, `${glb} 不在 ${g} 组`);
  }
  return '9 张';
});

function ktx2Info(buf) {
  const id = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.ok(id.every((b, i) => buf[i] === b), '不是 KTX2');
  const vkFormat = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(20);
  const height = buf.readUInt32LE(24);
  const levels = buf.readUInt32LE(40);
  const scheme = buf.readUInt32LE(44);
  const dfd = buf.readUInt32LE(48);
  const blk = dfd + 4;
  const colorModel = buf[blk + 8];
  const transfer = buf[blk + 10];
  const blockSize = buf.readUInt16LE(blk + 6);
  const nSamples = (blockSize - 24) / 16;
  const channels = [];
  for (let i = 0; i < nSamples; i++) channels.push(buf[blk + 24 + i * 16 + 3] & 0x0f);
  return { vkFormat, width, height, levels, scheme, colorModel, transfer, channels };
}

await test('9 张 KTX2：UASTC、线性、RGBA、2048²、完整 mip', () => {
  if (!hasArt) return '跳过（没有 ../art）';
  const out = [];
  let total = 0;
  for (const k of new Set(Object.values(EXPECT).map((e) => e[1]))) {
    const f = resolve(ART, `textures/${k}.ktx2`);
    assert.ok(existsSync(f), `缺 ${k}.ktx2`);
    const b = readFileSync(f);
    total += b.length;
    const i = ktx2Info(b);
    assert.equal(i.vkFormat, 0, `${k} 应为 basis（vkFormat 0）`);
    assert.equal(i.colorModel, 166, `${k} 应为 UASTC（DFD colorModel 166），实际 ${i.colorModel}`);
    assert.equal(i.transfer, 1, `${k} 应为线性（DFD transfer 1），实际 ${i.transfer}`);
    assert.ok(i.channels.includes(3), `${k} 要 RGBA（RGBM 的 M 在 alpha）`);
    assert.equal(i.width, 2048);
    assert.equal(i.height, 2048);
    assert.equal(i.levels, 12, `${k} mip 层数 ${i.levels}`);
    out.push(`${k.replace(/^tex-|-lightmap$/g, '')} ${(b.length / 1e6).toFixed(2)}`);
  }
  return `${out.join('，')}；合计 ${(total / 1e6).toFixed(2)} MB`;
});

// ---------------------------------------------------------------- 3. GLB
globalThis.self ??= globalThis;
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
async function loadGlb(rel) {
  const f = rel.startsWith('/') ? rel : resolve(ART, `models/${rel}.glb`);
  if (!existsSync(f)) return null;
  const buf = readFileSync(f);
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return g.scene;
}

await test('18 个 GLB：根 extras.lightmap 与需求单一致，uv1 落在 rect 内，挂图只挂可见网格', async () => {
  const allUvTypes = new Set();
  if (!hasArt) return '跳过（没有 ../art）';
  const lines = [];
  const notes = [];
  for (const [name, [, texKey, rect]] of Object.entries(EXPECT)) {
    const scene = await loadGlb(`env/${name}`);
    assert.ok(scene, `缺 ${name}.glb`);
    // GLTFLoader 会把与场景同名的根节点改名成 name_1，按 extras 找（原名在 userData.name）
    const roots = [];
    scene.traverse((o) => {
      if (readLightmapExtras(o)) roots.push(o);
    });
    assert.equal(roots.length, 1, `${name} 应只有 1 个带 extras.lightmap.texture 的根，实际 ${roots.length}`);
    const root = roots[0];
    assert.equal(root.userData.name ?? root.name, name);
    const ex = readLightmapExtras(root);
    assert.equal(lightmapKey(ex.texture), texKey, name);
    assert.equal(ex.encoding, 'RGBM8');
    assert.equal(ex.uv, 'TEXCOORD_1');
    assert.equal(ex.lightMapIntensity, 1, `${name} intensity`);
    assert.deepEqual(ex.rect, rect, `${name} rect`);
    // _lodN 节点上的 extras（统计信息）不算挂图入口
    // uv1 范围
    const pad = 2 / 2048;
    let lodMeshes = 0;
    const noUv1 = [];
    const outside = [];
    const extra = [];
    const uvTypes = new Set();
    root.traverse((o) => {
      if (!o.isMesh || /-(collider|wall)$/.test(o.name) || /-(collider|wall)$/.test(o.parent?.name ?? '')) return;
      const a = o.geometry.getAttribute('uv1');
      if (!a) {
        // LOD 网格必须有；其它（挂件等）没有就不挂，列出来
        assert.ok(!/_lod\d/.test(o.name), `${name}/${o.name} 没有 uv1（TEXCOORD_1）`);
        noUv1.push(o.name);
        return;
      }
      // LOD 网格在 rect 内；非 LOD 的挂件（码头船绳 = uv2-report extra）由美术排在图集空位，只要求在 [0,1]
      const isLod = /_lod\d/.test(o.name) || /_lod\d/.test(o.parent?.name ?? '');
      const r = isLod ? rect : [0, 0, 1, 1];
      // 1030 clifftop 重交：uv1 可以是 KHR_mesh_quantization 的 16 / 8 位 normalized 整数；getX/getY 会反归一化、GPU 端 vertexAttribPointer 带 normalized，
      // 着色器里拿到的仍是 [0,1] 浮点。整数存储却没标 normalized 的 uv1 是坏数据（着色器里会是 0–65535）
      const arr = a.array.constructor.name;
      if (!(a.array instanceof Float32Array)) assert.ok(a.normalized, `${name}/${o.name} uv1 是 ${arr} 但没标 normalized`);
      uvTypes.add(a.array instanceof Float32Array ? 'float' : `${arr.replace('Array', '')}-norm`);
      let out = 0, worst = 0;
      for (let i = 0; i < a.count; i++) {
        const u = a.getX(i), v = a.getY(i);
        const d = Math.max(r[0] - u, u - r[0] - r[2], r[1] - v, v - r[1] - r[3]);
        if (d > pad) {
          out++;
          worst = Math.max(worst, d);
        }
      }
      // 1030 起收紧到 0：clifftop 材质 2 原先 LOD0/1/2 有约 4% 顶点出 [0,1]（≈65px），美术修 UV2 后各 GLB 出 rect（容差 2px）的顶点都是 0。
      // 贴图 ClampToEdge 兜底照留（下面断言 wrapS），防以后重交再出界时不至于平铺采样
      assert.equal(out, 0, `${name}/${o.name} uv1 有 ${out}/${a.count} 个顶点出 rect，最远 ${worst.toFixed(4)}（${(worst * 2048).toFixed(0)}px）`);
      if (out) outside.push(`${o.name.replace(name, '')} ${out}/${a.count}(${(worst * 2048).toFixed(0)}px)`);
      if (!isLod) extra.push(o.name.replace(name, ''));
      lodMeshes++;
    });
    if (noUv1.length) notes.push(`${name} 无 uv1 不挂：${noUv1.join(' ')}`);
    if (outside.length) notes.push(`${name} 少量顶点出 rect：${outside.join(' ')}`);
    if (uvTypes.has('float')) notes.push(`${name} uv1 有 float 存储：${[...uvTypes].join(' / ')}`);
    for (const t of uvTypes) allUvTypes.add(t);
    if (extra.length) notes.push(`${name} 挂件也挂（图集空位）：${extra.join(' ')}`);
    assert.ok(lodMeshes > 0, `${name} 没有 LOD 网格`);
    // 挂图
    const tex = new THREE.Texture();
    const hs = applySceneLightmaps(scene, (k) => (k === texKey ? tex : null));
    assert.equal(hs.length, 1, `${name} 应挂 1 个根`);
    const h = hs[0];
    assert.equal(h.meshes, lodMeshes, `${name} 挂了 ${h.meshes} 个网格，带 uv1 的可见网格 ${lodMeshes}`);
    assert.equal(tex.channel, 1);
    assert.equal(tex.flipY, false);
    assert.equal(tex.colorSpace, THREE.NoColorSpace);
    assert.equal(tex.wrapS, THREE.ClampToEdgeWrapping);
    assert.equal(tex.wrapT, THREE.ClampToEdgeWrapping);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const ms = [].concat(o.material);
      const hidden = /-(collider|wall)$/.test(o.name) || /-(collider|wall)$/.test(o.parent?.name ?? '');
      for (const m of ms) {
        if (!o.geometry.getAttribute('uv1')) assert.ok(!m.lightMap);
        else if (hidden) assert.ok(!m.lightMap, `${name}/${o.name} 碰撞 / 空气墙不该挂`);
        else if (m.isMeshStandardMaterial) {
          assert.equal(m.lightMap, tex, `${name}/${o.name}`);
          assert.equal(m.lightMapIntensity, 1);
          assert.ok(m.customProgramCacheKey().includes('rgbm8lm'));
          const sh = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: '', uniforms: {} };
          m.onBeforeCompile(sh, null);
          assert.ok(sh.fragmentShader.includes('lightMapTexel.a * 8.0') && !sh.fragmentShader.includes('getHemisphereLightIrradiance('));
        }
      }
    });
    h.setScale(0.5);
    assert.ok(h.materials.every((m) => m.lightMapIntensity === 0.5));
    lines.push(`${name}(${h.meshes} 网格 / ${h.materials.length} 材质)`);
  }
  for (const rel of NOT_BAKED) {
    const scene = await loadGlb(rel);
    if (!scene) continue;
    let bad = null;
    scene.traverse((o) => {
      if (readLightmapExtras(o)) bad = o.name;
    });
    assert.equal(bad, null, `${rel} 不该有 extras.lightmap.texture（${bad}）`);
    assert.equal(applySceneLightmaps(scene, () => new THREE.Texture()).length, 0, `${rel} 不该被挂`);
  }
  return `${lines.join('，')}\n   ${notes.join('\n   ')}\n   门 / 透镜 / 钥匙 / 草图 / 日记 / 锡杯 不挂；${Object.keys(EXPECT).length} 个 GLB 一致；uv1 存储 ${[...allUvTypes].join(' / ')}（getX 反归一化，出 rect 顶点全 0）`;

});


await test('码头船绳两版（-rope-high / -rope-low 全部子网格，含 rope-low 的木件与 mat-env-rope-wet-ch1）都挂 tex-s1-shore-lightmap、不设 offset，涨退潮切换前后不变', async () => {
  if (!hasArt) return '跳过（没有 ../art）';
  const scene = await loadGlb('env/env-pier-wood-ch1');
  assert.ok(scene, '缺 env-pier-wood-ch1.glb');
  const tex = new THREE.Texture();
  const hs = applySceneLightmaps(scene, (k) => (k === 'tex-s1-shore-lightmap' ? tex : null));
  assert.equal(hs.length, 1);
  const sw = makeTideVariantSwitch(scene, S1.boatRope);
  assert.ok(sw, '找不到船绳两版节点');
  const collect = () => {
    const rows = [];
    for (const [side, nodes] of [['high', sw.high], ['low', sw.low]]) for (const n of nodes) n.traverse((o) => {
      if (!o.isMesh) return;
      const a = o.geometry.getAttribute('uv1');
      for (const m of [].concat(o.material)) rows.push({ side, mesh: o.name, mat: m.name, m, lm: m.lightMap, uv1: !!a, lod: /_lod\d/.test(o.name) || /_lod\d/.test(o.parent?.name ?? '') });
    });
    return rows;
  };
  const before = collect();
  assert.ok(before.some((r) => r.side === 'high') && before.some((r) => r.side === 'low'), '两版都要有网格');
  const bad = before.filter((r) => !r.uv1 || r.lm !== tex || !r.m.isMeshStandardMaterial);
  assert.ok(!bad.length, `没挂上：${bad.map((r) => `${r.side}/${r.mesh}/${r.mat}`).join('，')}`);
  const mats = new Set(before.map((r) => r.mat));
  assert.ok(mats.has('mat-env-rope-wet-ch1'), `缺 mat-env-rope-wet-ch1：${[...mats].join(' ')}`);
  assert.ok(before.filter((r) => r.side === 'low').some((r) => r.mat !== 'mat-env-rope-wet-ch1'), 'rope-low 应有木件材质');
  // uv1 已是图集坐标、没有 extras.lightmap rect：程序不设 offset / repeat
  assert.ok(tex.offset.x === 0 && tex.offset.y === 0 && tex.repeat.x === 1 && tex.repeat.y === 1, '光照贴图被设了 offset / repeat');
  for (const [side, nodes] of [['high', sw.high], ['low', sw.low]]) for (const n of nodes) assert.equal(n.userData.lightmap, undefined, `${side} ${n.name} 不该有 extras.lightmap`);
  // 涨 / 退潮来回切：只改可见性，材质（与贴图）原样
  const seq = [];
  for (const lvl of [1.6, 0, 1.6, 0]) {
    sw.update(lvl);
    seq.push(sw.state);
    const now = collect();
    assert.equal(now.length, before.length);
    now.forEach((r, i) => assert.ok(r.m === before[i].m && r.lm === tex, `${lvl} 潮位后 ${r.side}/${r.mesh} 材质 / 贴图变了`));
  }
  assert.deepEqual(seq, ['high', 'low', 'high', 'low']);
  const lodN = before.filter((r) => r.lod).length;
  return `${before.length} 个子网格 × 材质（high ${before.filter((r) => r.side === 'high').length} / low ${before.filter((r) => r.side === 'low').length}，其中 _lodN ${lodN}）全挂 tex-s1-shore-lightmap；材质 ${[...mats].join(' / ')}；切潮 4 次不变`;
});

await test('院墙修复：5 个 socket 与修复前一致，灯台 socket 世界坐标 = layout 灯台', async () => {
  if (!hasArt) return '跳过（没有 ../art）';
  const names = ['lamp-east', 'lamp-west', 'gate', 'mirror-a', 'mirror-b'].map((k) => `env-courtyard-wall-s2-${k}-socket`);
  const read = (scene) => {
    scene.updateMatrixWorld(true);
    return names.map((n) => {
      const o = scene.getObjectByName(n);
      assert.ok(o, `缺 ${n}`);
      return { p: o.getWorldPosition(new THREE.Vector3()), q: o.getWorldQuaternion(new THREE.Quaternion()) };
    });
  };
  const now = read(await loadGlb('env/env-courtyard-wall-s2'));
  const old = process.env.BK029_BADPACK ?? ''; // 可选：修复前备份 GLB 路径（原 bk-029/env-courtyard-wall-s2.glb.badpack），不设就跳过对比
  let cmp = '（没有修复前备份，跳过对比）';
  if (existsSync(old)) {
    const was = read(await loadGlb(old));
    let dp = 0, dq = 0;
    now.forEach((a, i) => {
      dp = Math.max(dp, a.p.distanceTo(was[i].p));
      dq = Math.max(dq, (a.q.angleTo(was[i].q) * 180) / Math.PI);
    });
    assert.ok(dp < 1e-3 && dq < 0.05, `socket 变了：位置 ${dp} m，角度 ${dq}°`);
    cmp = `与修复前比：位置差 ≤ ${dp.toExponential(1)} m，角度差 ≤ ${dq.toFixed(3)}°`;
  }
  const t = S2.artNodes['env-courtyard-wall-s2'].translation;
  assert.equal(S2.artNodes['env-courtyard-wall-s2'].rotationY, 0);
  for (const [i, k] of [[0, 'east'], [1, 'west']]) {
    const w = now[i].p.clone().add(new THREE.Vector3(...t));
    assert.ok(w.distanceTo(new THREE.Vector3(...S2.lamps[k])) < 1e-3, `灯台 ${k} ${w.toArray()} vs ${S2.lamps[k]}`);
  }
  return `${cmp}；灯台 east/west 世界坐标 = layout`;
});

await test('地窖钥匙点光：#C4D2DE / 0.15 cd / 0.22 m / decay 2 / 不投影，env-cellar-s2 局部 (−0.35,−1.15,0.35) = socket 上方 0.15 m，挂在 socket 下', async () => {
  assert.equal(CELLAR_KEY_LIGHT.color, 0xc4d2de);
  assert.equal(CELLAR_KEY_LIGHT.intensity, 0.15);
  assert.equal(CELLAR_KEY_LIGHT.distance, 0.22);
  assert.equal(CELLAR_KEY_LIGHT.decay, 2);
  // 在地窖判定
  const C = S2.cellar;
  assert.ok(inCellar(new THREE.Vector3((C.x[0] + C.x[1]) / 2, C.floorY, (C.z[0] + C.z[1]) / 2)));
  assert.ok(!inCellar(new THREE.Vector3((C.x[0] + C.x[1]) / 2, 0, (C.z[0] + C.z[1]) / 2)), '一楼地面（地窖正上方）不算');
  if (!hasArt) return '跳过 GLB 部分（没有 ../art）';
  const scene = await loadGlb('env/env-cellar-s2');
  // 按 art.ts 摆放：外层名 = key，位置 / 朝向 = layout artNodes
  const n = S2.artNodes['env-cellar-s2'];
  scene.name = 'env-cellar-s2';
  scene.position.fromArray(n.translation);
  scene.rotation.y = n.rotationY;
  const world = new THREE.Group();
  world.add(scene);
  world.updateMatrixWorld(true);
  const socket = scene.getObjectByName('env-cellar-s2-key-socket');
  const sp = socket.getWorldPosition(new THREE.Vector3());
  const kl = new CellarKeyLight(scene, socket);
  assert.equal(kl.light.parent, socket);
  assert.equal(kl.light.castShadow, false);
  world.updateMatrixWorld(true);
  const lp = kl.light.getWorldPosition(new THREE.Vector3());
  const expect = scene.localToWorld(new THREE.Vector3(-0.35, -1.15, 0.35));
  assert.ok(lp.distanceTo(expect) < 1e-5, `点光 ${lp.toArray()} vs ${expect.toArray()}`);
  assert.ok(lp.clone().sub(sp).distanceTo(new THREE.Vector3(0, 0.15, 0)) < 1e-4, `点光不在 socket 正上方 0.15 m：${lp.clone().sub(sp).toArray()}`);
  // 开关：地窖里淡入到 0.15，出地窖淡出，拿钥匙立刻 0；一直 visible
  kl.update(1, true, false);
  assert.equal(kl.light.intensity, 0.15);
  kl.update(0.2, false, false);
  assert.ok(kl.light.intensity > 0 && kl.light.intensity < 0.15);
  kl.update(1, false, false);
  assert.equal(kl.light.intensity, 0);
  kl.update(1, true, false);
  kl.update(0.016, true, true);
  assert.equal(kl.light.intensity, 0);
  assert.ok(kl.light.visible);
  return `世界 (${lp.toArray().map((v) => v.toFixed(3)).join(', ')})，socket + (0, 0.15, 0)`;
});

// ---------------------------------------------------------------- 汇总
let failed = 0;
for (const [name, err, out] of results) {
  if (err) {
    failed++;
    console.log(`✗ ${name}\n   ${err.stack ?? err}`);
  } else console.log(`✓ ${name}${out ? `\n   ${out}` : ''}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
