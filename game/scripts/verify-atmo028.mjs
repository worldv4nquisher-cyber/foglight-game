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
import { Rain, collectIndoorShapes, insideIndoorShapes } from '@/world/Rain';
import { buildS2Greybox } from '@/levels/s2/greybox';
import { S2 } from '@/levels/s2/layout';
import { buildS3Greybox } from '@/levels/s3/greybox';
import { S3, S3_FRAME, polar } from '@/levels/s3/layout';
import { LensDropletsEffect } from '@/render/LensDropletsEffect';
import { applyLutCpu } from '@/render/LutEffect';
import { inflateSync } from 'node:zlib';

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

// ---- LUT
/** 最小 PNG 解码（8 位 RGB / RGBA、非隔行；LUT 用） */
function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      assert.equal(d[8], 8, '8 位');
      ct = d[9];
      assert.equal(d[12], 0, '非隔行');
    } else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : assert.fail(`色彩类型 ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * ch);
  const stride = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}
await test('LUT：lut-identity 查表后像素不变（≤ 1/255），四张预设 LUT 格式 1024×32', () => {
  if (!hasArt) return '（无 ../art，跳过）';
  const dir = resolve(ART, 'textures/lut');
  const id = decodePng(readFileSync(resolve(dir, 'lut-identity.png')));
  assert.equal(id.width, 1024);
  assert.equal(id.height, 32);
  let maxErr = 0;
  let s = 3;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const samples = [[0, 0, 0], [1, 1, 1], [0.5, 0.25, 0.75], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < 4000; i++) samples.push([R(), R(), R()]);
  for (const c of samples) {
    const o = applyLutCpu(id, c);
    for (let k = 0; k < 3; k++) maxErr = Math.max(maxErr, Math.abs(o[k] - c[k]));
  }
  assert.ok(maxErr <= 1 / 255, `identity 最大误差 ${(maxErr * 255).toFixed(3)}/255`);
  // 方向：G 自上而下 0→1（flipY=false），B 片横排，片内 x = R —— 单独验证一个非对称颜色
  const o = applyLutCpu(id, [0.2, 0.6, 0.9]);
  near(o[0], 0.2, 1 / 255, 'R');
  near(o[1], 0.6, 1 / 255, 'G');
  near(o[2], 0.9, 1 / 255, 'B');
  const sizes = [];
  for (const p of Object.values(ATMOSPHERE_PRESETS)) {
    const l = decodePng(readFileSync(resolve(dir, p.lut)));
    assert.equal(l.width, 1024);
    assert.equal(l.height, 32);
    // 环境色（中灰）过 LUT 后仍是低饱和（HSV S ≤ 25%）
    const g = applyLutCpu(l, [0.5, 0.52, 0.55]);
    const mx = Math.max(...g), mn = Math.min(...g);
    assert.ok((mx - mn) / mx <= 0.25, `${p.lut} 中灰饱和度 ${(((mx - mn) / mx) * 100).toFixed(1)}%`);
    sizes.push(p.lut);
  }
  return `identity 最大误差 ${(maxErr * 255).toFixed(3)}/255；${sizes.length} 张预设 LUT`;
});

// ---- 雨
await test('雨：ultra/high 细长 quad（贴图、1–2.5 px 钳制 + 透明度守恒、普通 alpha），standard 1 px 线', () => {
  const tex = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const r = new Rain(46, 26, tex(), tex());
  const want = { ultra: [30000, 0.24, 'quad'], high: [15000, 0.28, 'quad'], standard: [6000, 0.2, 'line'] };
  for (const [tier, [n, op, mode]] of Object.entries(want)) {
    assert.equal(ATMO028.rainTiers[tier].count, n, `${tier} 数量`);
    r.setTier(tier, n);
    assert.equal(r.mode, mode, `${tier} 形式`);
    assert.equal(r.dropCount, n);
    const m = mode === 'quad' ? r.quads.material : r.lines.material;
    near(m.uniforms.uOpacity.value, op, 1e-9, `${tier} opacity`);
    assert.equal(m.blending, THREE.NormalBlending, `${tier} 普通 alpha 混合`);
    assert.equal(m.transparent, true);
    assert.equal(m.depthWrite, false);
    if (mode === 'quad') {
      assert.equal(r.quads.visible, true);
      assert.equal(r.lines.visible, false);
      assert.equal(r.quads.geometry.instanceCount, n);
      const w = m.uniforms.uW.value;
      assert.deepEqual([w.y, w.z], [1, 2.5], `${tier} 像素钳制`);
      const vs = m.vertexShader;
      assert.match(vs, /clamp\(/, '宽度钳制');
      assert.match(vs, /uW\.y/, '细于 minPx 时按覆盖率降 alpha');
    } else {
      assert.equal(r.lines.visible, true);
      assert.equal(r.quads.visible, false);
      assert.equal(r.lines.geometry.drawRange.count, n * 2);
    }
  }
  // 贴图缺失（?art=0）：quad 档退回线段，透明度仍按档位
  const bare = new Rain(46, 26, null, null);
  bare.setTier('ultra', 30000);
  assert.equal(bare.mode, 'line');
  near(bare.lines.material.uniforms.uOpacity.value, 0.24, 1e-9);
  return 'ultra 30k/0.24 quad · high 15k/0.28 quad · standard 6k/0.20 线';
});

await test('雨：溅水按 setGround 落点生成（序列帧 16 帧 @40 fps = 0.4 s），无落点不溅；预设关雨时不更新', () => {
  const tex = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const r = new Rain(46, 26, tex(), tex());
  r.setTier('ultra', 30000);
  r.applyAtmosphere(ATMOSPHERE_PRESETS['rain-night']);
  assert.equal(r.visible, true);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, 3, 0);
  // 无 ground：不溅
  for (let i = 0; i < 10; i++) r.update(0.05, cam);
  assert.equal(r.splashes.aliveCount(0.5), 0);
  const ys = [];
  r.setGround((x, z, fromY) => { ys.push(fromY); return x > 0 ? 1.5 : null; });
  let t = 0.5;
  for (let i = 0; i < 20; i++) { r.update(0.05, cam); t += 0.05; }
  const alive = r.splashes.aliveCount(t);
  const per = ATMO028.rainTiers.ultra.splash.perSecond;
  // 约一半落点有地面；0.4 s 寿命 → 稳态 ≈ perSecond × 0.4 × 0.5
  assert.ok(alive > per * 0.4 * 0.5 * 0.5 && alive < per * 0.4 * 0.5 * 1.6, `存活 ${alive}`);
  assert.ok(ys.every((y) => near(y, 15, 1e-9) === undefined));
  const a = r.splashes.geometry.getAttribute('aSpawn').array;
  for (let i = 0; i < 1024; i++) if (a[i * 4 + 3] > 0.5) { near(a[i * 4 + 1], 1.505, 1e-6, '落点 y'); assert.ok(a[i * 4] > 0); }
  // 关雨：不再生成
  r.applyAtmosphere(ATMOSPHERE_PRESETS['overcast-dusk']);
  assert.equal(r.visible, ATMOSPHERE_PRESETS['overcast-dusk'].rain.enabled);
  return `稳态存活 ${alive} 个（perSecond ${per}）`;
});

await test('镜头水滴：仅 ultra 档配置、refraction 0.015、fadeIn 0.6 s；强度 0 = pass 关', () => {
  const ld = ATMO028.rainTiers.ultra.lensDroplets;
  assert.equal(ld.enabled, true);
  assert.equal(ld.cutsceneOnly, true);
  near(ld.refraction, 0.015, 1e-9);
  near(ld.fadeIn, 0.6, 1e-9);
  assert.equal(ATMO028.rainTiers.high.lensDroplets.enabled, false);
  assert.equal(ATMO028.rainTiers.standard.lensDroplets.enabled, false);
  const e = new LensDropletsEffect({ refraction: ld.refraction, tilesPerScreenH: ld.tilesPerScreenH });
  e.setSize(1920, 1080);
  near(e.uniforms.get('aspect').value, 16 / 9, 1e-9);
  e.strength = 0.5;
  assert.equal(e.strength, 0.5);
  return 'ok';
});


await test('BUG-020 室内雨剔除：体积读 S2 / S3 白盒 -indoor 节点（layout 生成），地窖 / 石屋 / 塔内雨丝与溅水剔除，窗外 / 门外 / 屋顶上照常', () => {
  const tex = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);
  // ---- S2（场景根不转）
  const g2 = buildS2Greybox();
  const s2 = collectIndoorShapes(g2.root);
  assert.equal(s2.length, 2, 'S2 应有石屋 + 地窖两个 -indoor');
  const H = S2.house, I = H.inner, O = S2.openings, C = S2.cellar;
  const mid = (o) => (o.a + o.b) / 2, midY = (o) => (o.y0 + o.y1) / 2;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const s2In = [
    ['地窖（QA 复现相机位）', v(-2.29, -0.73, -0.57)],
    ['地窖底层钥匙架前', v((C.x[0] + C.x[1]) / 2, C.floorY + 1, (C.z[0] + C.z[1]) / 2)],
    ['一层屋内', v(-2, 1.2, 1)],
    ['二层西窗内 0.3 m', v(I.x1 - 0.3, midY(O.winW2), mid(O.winW2))],
    ['前门内 0.3 m', v(mid(O.frontDoor), 1, I.z0 + 0.3)],
  ];
  const s2Out = [
    ['二层西窗外 0.5 m', v(H.x1 + 0.5, midY(O.winW2), mid(O.winW2))],
    ['前门外 0.5 m', v(mid(O.frontDoor), 1, H.z0 - 0.5)],
    ['地窖门外 0.5 m', v(mid(O.cellarDoor), 1, H.z1 + 0.5)],
    ['一层东窗外 0.5 m', v(H.x0 - 0.5, midY(O.winE1), mid(O.winE1))],
    ['屋顶上方', v(-2, H.ridge + 0.5, 1)],
    ['院子', v(-2, 1, H.z1 + 4)],
  ];
  // ---- S3（塔身在 frame 下绕 Y 转 135°，同 S3Scene）
  const frame = new THREE.Group();
  frame.position.set(...S3_FRAME.position);
  frame.rotation.y = S3_FRAME.rotationY;
  const g3 = buildS3Greybox();
  frame.add(g3.root);
  const s3 = collectIndoorShapes(frame);
  assert.equal(s3.length, 1, 'S3 应有塔内一个 -indoor');
  assert.ok(s3[0].cylinder && Math.abs(s3[0].half.x - S3.tower.rIn) < 1e-9, 'S3 塔内按 layout rIn 的圆柱');
  const T = S3.tower;
  const w3 = (r, th, y) => frame.localToWorld(new THREE.Vector3(...polar(r, th, y)));
  const D = S3.door, W = S3.westWindow, SW = S3.stairWindows[0];
  const s3In = [
    ['塔底中心', w3(0, 0, 1.2)],
    ['门内 0.3 m', w3(T.rIn - 0.3, D.th, (D.y0 + D.y1) / 2)],
    ['底层西窗内 0.3 m', w3(T.rIn - 0.3, W.th, (W.y0 + W.y1) / 2)],
    ['5 m 平台窗内', w3(T.rIn - 0.3, SW.th, (SW.y0 + SW.y1) / 2)],
    ['塔内贴内壁（方盒够不到的边）', w3(T.rIn - 0.1, 90, 10)],
  ];
  const outerR = (y) => T.rBase + ((T.rTop - T.rBase) * y) / T.height;
  const c3 = frame.localToWorld(new THREE.Vector3(0, 20, 0));
  const s3Out = [
    ['门外 0.4 m', w3(T.rBase + 0.4, D.th, (D.y0 + D.y1) / 2)],
    ['底层西窗外 0.4 m', w3(T.rBase + 0.4, W.th, (W.y0 + W.y1) / 2)],
    ['5 m 平台窗外 0.4 m', w3(T.rBase + 0.4, SW.th, (SW.y0 + SW.y1) / 2)],
    // 世界 45° 方向、y 20 外壁外 0.1 m：旧的轴对齐 5.6 m 方盒（半宽 2.8）会把它剔掉
    ['塔外斜角（方盒角伸出墙外处）', v(c3.x + (outerR(20) + 0.1) / Math.SQRT2, c3.y, c3.z + (outerR(20) + 0.1) / Math.SQRT2)],
    ['塔顶上方', frame.localToWorld(new THREE.Vector3(0, T.height + 3, 0))],
  ];
  const bad = [];
  for (const [shapes, ins, outs, tag] of [[s2, s2In, s2Out, 'S2'], [s3, s3In, s3Out, 'S3']]) {
    for (const [n, p] of ins) if (!insideIndoorShapes(shapes, p)) bad.push(`${tag} ${n} 应剔除`);
    for (const [n, p] of outs) if (insideIndoorShapes(shapes, p)) bad.push(`${tag} ${n} 不应剔除`);
  }
  assert.ok(!bad.length, bad.join('；'));
  // ---- Rain：uniform 与 JS 判定一致；两种形式的着色器都用 indoorAt 剔除上下端
  const r = new Rain(46, 26, tex(), tex());
  r.setTier('ultra', 30000);
  r.applyAtmosphere(ATMOSPHERE_PRESETS['rain-night']);
  r.setIndoor([...s2, ...s3]);
  const u = r.lines.material.uniforms;
  assert.equal(u.uIndoorN.value, 3);
  assert.equal(r.quads.material.uniforms, u, 'line / quad 共用 uniform');
  assert.equal(u.uIndoorHalf.value[2].w, 1, 'S3 圆柱标记');
  for (const m of [r.lines.material, r.quads.material]) assert.ok(/indoorAt\(dropPos\(seed, 0\.0\)\)/.test(m.vertexShader), '着色器剔除雨丝上端');
  for (const [, p] of [...s2In, ...s3In]) assert.ok(r.culledAt(p));
  for (const [, p] of [...s2Out, ...s3Out]) assert.ok(!r.culledAt(p));
  // ---- 溅水：相机在塔内、落点查询一律给塔内地面 → 不溅；同一相机放到塔外空地 → 照常溅
  const cam = new THREE.PerspectiveCamera();
  const floorW = frame.localToWorld(new THREE.Vector3(0, S3.groundFloorY, 0)).y;
  r.setGround(() => floorW);
  r.setIndoor(s3);
  cam.position.copy(frame.localToWorld(new THREE.Vector3(0, 1.8, 0)));
  let t = 0;
  for (let i = 0; i < 20; i++) { r.update(0.05, cam); t += 0.05; }
  const a = r.splashes.geometry.getAttribute('aSpawn').array;
  let indoorSplash = 0, aliveIn = 0;
  for (let i = 0; i < 1024; i++) if (a[i * 4 + 3] > -1) { aliveIn++; if (insideIndoorShapes(s3, v(a[i * 4], a[i * 4 + 1] + 0.05, a[i * 4 + 2]))) indoorSplash++; }
  assert.equal(indoorSplash, 0, `塔内溅水 ${indoorSplash}`);
  const sp = ATMO028.rainTiers.ultra.splash;
  cam.position.copy(frame.localToWorld(new THREE.Vector3(T.rBase + sp.radius + 2, 1.8, 0)));
  for (let i = 0; i < 20; i++) { r.update(0.05, cam); t += 0.05; }
  const aliveOut = r.splashes.aliveCount(t);
  assert.ok(aliveOut > sp.perSecond * 0.4 * 0.5, `塔外溅水 ${aliveOut}`);
  return `S2 ${s2In.length} 内 / ${s2Out.length} 外、S3 ${s3In.length} 内 / ${s3Out.length} 外 ✓；塔内溅水 0（塔内候选落点 ${aliveIn} 个全在体积外 = 门洞 / 墙外），塔外存活 ${aliveOut}`;
});

let failed = 0;
for (const [name, err, out] of results) {
  if (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  } else console.log(`  ✓ ${name}${out ? `  ${out}` : ''}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
