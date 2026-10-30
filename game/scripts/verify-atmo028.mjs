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

// ---- 雨 / 雾片 / 水面 / LUT（后续条目）


let failed = 0;
for (const [name, err, out] of results) {
  if (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  } else console.log(`  ✓ ${name}${out ? `  ${out}` : ''}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
