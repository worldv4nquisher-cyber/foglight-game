// v0.1-028 大气接入校验（纯逻辑，无 GPU）：
//   1. src/config/atmosphere028.ts 与美术 atmosphere-028.json 一致（有 ../art 时）
//   2. 裁定 18 ①：全局雾 = 028 预设（不再是 0x4a555e / 0.028），主岛 fogDensityHint 按预设；雨夜天光 / 主光 ×0.35
//   3. 旧预设名别名；剪影颜色 = #56616B → farWallTint（0.38 / 0.5）
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-atmo028.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ATMOSPHERE_PRESETS, RAIN_NIGHT_LIGHT_MUL, resolveAtmosphereName } from '@/config/atmosphere';
import { ATMO028 } from '@/config/atmosphere028';
import { silhouetteColor } from '@/render/skyLayer';
import { FogCards028 } from '@/world/FogCards028';
import { Water } from '@/world/Water';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(ROOT, '../art');
const JSON028 = resolve(ART, 'source/atmosphere/atmosphere-028.json');
const hasArt = existsSync(JSON028);
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
const hex = (s) => parseInt(s.replace('#', ''), 16);

await test('atmosphere028.ts = 美术 JSON 原样副本', () => {
  if (!hasArt) return '（无 ../art，跳过）';
  execFileSync(process.execPath, [resolve(ROOT, 'scripts/gen-atmo028.mjs'), '--check'], { stdio: 'pipe' });
  return ATMO028.version;
});

await test('裁定 18 ①：全局雾 / 主岛 hint 按 028 预设', () => {
  const want = { 'overcast-dusk': [0xb9c2c8, 0.009, 0.0036], 'overcast-after-rain': [0xc3cbd0, 0.007, 0.0032], 'rain-night': [0x3a444c, 0.016, 0.0042], 'after-lit': [0xaeb7be, 0.008, 0.0034] };
  for (const [id, [c, d, h]] of Object.entries(want)) {
    const p = ATMOSPHERE_PRESETS[id];
    assert.ok(p, `预设 ${id}`);
    assert.equal(p.fogColor, c, `${id} 雾色`);
    assert.equal(p.fogDensity, d, `${id} 雾密度`);
    assert.equal(p.midFogDensity, h, `${id} 主岛 fogDensityHint`);
    assert.notEqual(p.fogColor, 0x4a555e);
    assert.equal(p.farWallTint, hex(ATMO028.presets[id].fog.farWallTint));
    assert.equal(p.lut, ATMO028.presets[id].lut);
  }
  // 灯塔剪影要能读：138 m 处主岛雾占比远低于全局雾（README §10：hint=0.009 时剪影消失）
  const k = (dens) => 1 - Math.exp(-((dens * 138) ** 2));
  for (const p of Object.values(ATMOSPHERE_PRESETS)) assert.ok(k(p.midFogDensity) < 0.3 && k(p.fogDensity) > 0.6, `${p.id} 主岛雾占比 ${k(p.midFogDensity).toFixed(2)} / 全局 ${k(p.fogDensity).toFixed(2)}`);
  return Object.keys(want).join(' / ');
});

await test('雨夜：天光 / 主光 ×0.35；暖光只有灯塔', () => {
  const d = ATMOSPHERE_PRESETS['overcast-dusk'];
  const n = ATMOSPHERE_PRESETS['rain-night'];
  near(n.hemiIntensity, d.hemiIntensity * RAIN_NIGHT_LIGHT_MUL, 1e-9, '半球光');
  near(n.sunIntensity, d.sunIntensity * RAIN_NIGHT_LIGHT_MUL, 1e-9, '主光');
  assert.equal(RAIN_NIGHT_LIGHT_MUL, ATMO028.presets['rain-night'].previewLightMul);
  // 环境光源不偏暖：R ≤ B（只有 lighthouseColor 是暖色）
  for (const p of Object.values(ATMOSPHERE_PRESETS))
    for (const c of [p.hemiSky, p.sunColor, p.fogColor, p.farWallTint]) assert.ok(((c >> 16) & 255) <= (c & 255), `${p.id} #${c.toString(16)} 不能偏暖`);
  return `hemi ${n.hemiIntensity.toFixed(2)} / sun ${n.sunIntensity.toFixed(2)}`;
});

await test('旧预设名别名 + 未知名回落', () => {
  assert.equal(resolveAtmosphereName('melancholy-dusk'), 'overcast-dusk');
  assert.equal(resolveAtmosphereName('lonely-night'), 'rain-night');
  assert.equal(resolveAtmosphereName('rain-night'), 'rain-night');
  assert.equal(resolveAtmosphereName('nope'), null);
});

await test('远景剪影色 = #56616B → farWallTint（黄昏 0.38 / 雨夜 0.5）', () => {
  const c = silhouetteColor(ATMOSPHERE_PRESETS['overcast-dusk']);
  const want = new THREE.Color(0x56616b).lerp(new THREE.Color(0xc9d0d4), 0.38);
  near(c.r, want.r, 1e-6);
  near(c.b, want.b, 1e-6);
  assert.equal(ATMOSPHERE_PRESETS['rain-night'].silhouetteMix, 0.5);
  return '#' + c.getHexString();
});

// ---- 雾片
/** 模拟 three 编译：返回 onBeforeCompile 之后的着色器 */
function compiled(mat, lib = 'basic') {
  const sh = { vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader, uniforms: {} };
  mat.onBeforeCompile(sh, {});
  return sh;
}
await test('028 雾片：5 层雾墙跟随相机 xz、两端 + 近相机淡出、深度夹在远平面内侧', () => {
  const t = () => new THREE.Texture();
  const f = new FogCards028({ wall: t(), puff: t(), ground: t() });
  const walls = f.children.filter((o) => o.name.startsWith('fog028-wall'));
  const cards = f.children.filter((o) => !o.name.startsWith('fog028-wall'));
  assert.equal(walls.length, ATMO028.s1.farWalls.length);
  const gf = ATMO028.s1.groundFog;
  assert.equal(cards.length, gf.island.rings.reduce((n, r) => n + r.count, 0) + gf.island.puffs.length + gf.nearWater.count);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(30, 4, -50);
  f.update(0.016, cam, 1.2);
  for (const w of walls) assert.ok(w.position.x === 30 && w.position.z === -50 && w.position.y < 15, '雾墙跟随相机 xz，不跟 y');
  for (const w of walls) {
    assert.equal(w.material.fog, false);
    assert.equal(w.material.depthWrite, false);
    assert.equal(w.renderOrder, 2);
    assert.equal(w.frustumCulled, false);
    const sh = compiled(w.material);
    assert.match(sh.fragmentShader, /smoothstep\(0\.0, 0\.120, vEdgeU\) \* smoothstep\(1\.0, 0\.880, vEdgeU\) \* smoothstep\(20\.0, 60\.0, vViewD\)/);
    assert.match(sh.vertexShader, /gl_Position\.z = min\(gl_Position\.z, gl_Position\.w \* 0\.999990\)/);
  }
  for (const c of cards) {
    const sh = compiled(c.material);
    assert.match(sh.fragmentShader, /smoothstep\(0\.0, 0\.220, vEdgeU\) \* smoothstep\(1\.0, 0\.780, vEdgeU\) \* smoothstep\(8\.0, 25\.0, vViewD\)/, c.name);
    assert.equal(c.material.fog, true);
  }
  // 潮位抬雾片（只抬不降）
  const ring = cards[0];
  const r0 = gf.island.rings[0];
  near(ring.position.y, r0.y + r0.height * 0.5 + 1.2, 1e-6, '岛边雾片 y 跟潮位');
  f.update(0.016, cam, -0.5);
  near(ring.position.y, r0.y + r0.height * 0.5, 1e-6, '退潮回到基准');
  // 档位 / 预设
  f.applyQuality('standard');
  assert.equal(walls.filter((w) => w.visible).length, 4);
  near(cards[0].material.opacity, r0.opacity * 1.15, 1e-9, 'standard 地面雾 ×1.15');
  f.applyQuality('ultra');
  assert.equal(walls.filter((w) => w.visible).length, 5);
  f.applyAtmosphere(ATMOSPHERE_PRESETS['rain-night']);
  const night = walls[2].material.color.clone();
  f.applyAtmosphere(ATMOSPHERE_PRESETS['overcast-dusk']);
  assert.ok(night.r < walls[2].material.color.r * 0.5, '雨夜雾墙随预设变暗');
  near(walls[2].material.color.r, new THREE.Color(0xc9d0d4).r, 1e-6, '黄昏第 3 层 = farWallTint');
  return `${walls.length} 层雾墙 + ${cards.length} 片地面雾`;
});

// ---- 水面
await test('028 水面：两层法线 + textureGrad 雨圈（mip ≤ 3）、只在下雨且档位开时叠', () => {
  const w = new Water(10, 4);
  const plain = compiled(w.material, 'physical');
  assert.doesNotMatch(plain.fragmentShader, /tWN/, '没贴图时不改片元');
  const n = new THREE.Texture();
  const r = new THREE.Texture();
  r.image = { width: 1024, height: 1024 };
  w.setDetail(n, r);
  const sh = compiled(w.material, 'physical');
  assert.match(sh.fragmentShader, /textureGrad\(tWR/);
  assert.match(sh.fragmentShader, /uRipMaxGrad/);
  assert.equal(sh.uniforms.uRipMaxGrad.value, 8 / 1024, 'mip ≤ 3：梯度上限 2^3 / 1024');
  assert.match(sh.fragmentShader, /uL0\.xy \+ uL0\.zw/);
  assert.match(sh.fragmentShader, /uL1\.xy \+ uL1\.zw/);
  w.setRipples(ATMO028.rainTiers.ultra.ripples);
  w.applyAtmosphere(ATMOSPHERE_PRESETS['overcast-dusk']);
  near(w.rippleStrength, 0.35, 1e-9, '下雨 ultra 雨圈强度');
  assert.equal(sh.uniforms.uRipL2.value, 1, 'ultra 两层');
  w.applyAtmosphere(ATMOSPHERE_PRESETS['overcast-after-rain']);
  assert.equal(w.rippleStrength, 0, '雨停没有雨圈');
  w.applyAtmosphere(ATMOSPHERE_PRESETS['rain-night']);
  w.setRipples(ATMO028.rainTiers.standard.ripples);
  near(w.rippleStrength, 0.3, 1e-9, 'standard 0.30');
  assert.equal(sh.uniforms.uRipL2.value, 0);
  w.update(1 / 24 * 9.5);
  assert.deepEqual(sh.uniforms.uRipFrame.value.toArray(), [1, 1], '24 fps 第 9 帧 = (1, 1)');
  near(sh.uniforms.uL0.value.x, 1 / 14, 1e-9);
  near(sh.uniforms.uL1.value.x, 1 / 5.3, 1e-9);
  near(sh.uniforms.uNScale.value, ATMO028.presets['rain-night'].water.normalScale, 1e-9);
});

// ---- 雨 / LUT（后续条目）


let failed = 0;
for (const [name, err, out] of results) {
  if (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  } else console.log(`  ✓ ${name}${out ? `  ${out}` : ''}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
