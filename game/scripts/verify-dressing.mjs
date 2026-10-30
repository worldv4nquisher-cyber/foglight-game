// v0.1-027 剧情物件接入校验（纯逻辑，无 GPU）：
//   1. 027 交付的 GLB / 贴图都在 manifest 里（url 指向的文件存在，有 ../art 时）
//   2. 植被：无 COLOR_0 / TEXCOORD_1，extras outline:false；海鸟 seabird-flap 0.6 s + morph flap-up / flap-down
//   3. mountDressing：socket 优先 / layout 回退、白盒换载体材质（不隐藏子节点、不描边）、变体切显示、桌面实测吸附、GLB extras 倒扣姿态
//   4. 脚印贴花（033）：路径 json = 美术原件，4 块 T1–T4 按 json 摆、脚尖沿走向、roughness 0.65；字幕触发区两两不重叠
//   5. 海鸟：间歇出现、扇翅 / 滑翔交替，朝向 = 切向
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-dressing.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { manifest as MANIFEST } from '@/assets/manifest';
import { mountDressing } from '@/levels/dressing';
import { buildS1Dressing, FOOTPRINT_DECAL_KEY, FOOTPRINT_DECAL_ROUGHNESS, FOOTPRINT_DECAL_SIZE, s1DressingSpecs } from '@/levels/s1/dressing';
import { FOOTPRINT_TILES, footprintsMonoZone } from '@/levels/s1/footprints';
import { s1SubtitleZones } from '@/levels/s1/subtitleZones';
import { s2DressingSpecs } from '@/levels/s2/dressing';
import { s3DressingSpecs } from '@/levels/s3/dressing';
import { S1 } from '@/levels/s1/layout';
import { S2 } from '@/levels/s2/layout';
import { Seabird, SEABIRD_CLIP, SEABIRD_KEY } from '@/world/Seabird';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(ROOT, '../art');
const hasArt = existsSync(resolve(ART, 'models/props/README-027.md'));
const results = [];
async function test(name, fn) {
  try {
    results.push([name, null, await fn()]);
  } catch (e) {
    results.push([name, e]);
  }
}
const glbJson = (file) => {
  const b = readFileSync(file);
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
};
const artPath = (url) => resolve(ART, url.replace(/^assets\/art\//, ''));

const FILES_027 = [
  'models/props/prop-journal-father.glb', 'models/props/prop-letter-a.glb', 'models/props/prop-letter-b.glb', 'models/props/prop-letter-c.glb',
  'models/props/prop-notice-board-s1.glb', 'models/props/prop-logbook-s3.glb', 'models/props/prop-sketch-window.glb', 'models/props/prop-cup-tin.glb',
  'models/props/prop-kitchen-set-a.glb', 'models/props/prop-desk-set-a.glb', 'models/props/prop-rope-coil-a.glb', 'models/props/prop-net-pile-a.glb',
  'models/props/prop-buoy-a.glb', 'models/props/prop-barrel-a.glb', 'models/props/prop-crate-a.glb', 'models/props/prop-seabird-far.glb',
  'models/env/env-grass-coastal-a.glb', 'models/env/env-seaweed-a.glb', 'textures/tex-decal-footprints-albedo.ktx2',
];

await test('manifest：027 全部登记（optional + art），场景用到的 key 都在对应组', () => {
  const urls = new Set(MANIFEST.map((e) => e.url));
  for (const f of FILES_027) assert.ok(urls.has('assets/art/' + f), '没登记 ' + f);
  for (const e of MANIFEST.filter((x) => FILES_027.includes(x.url.replace('assets/art/', '')))) {
    assert.ok(e.optional && e.art, e.key + ' 要 optional + art');
    if (hasArt) assert.ok(existsSync(artPath(e.url)), e.url + ' 不存在');
  }
  const group = (k) => MANIFEST.find((e) => e.key === k)?.group;
  for (const s of s1DressingSpecs()) assert.equal(group(s.key), 's1', s.key);
  for (const s of s2DressingSpecs()) assert.equal(group(s.key), 's2', s.key);
  for (const s of s3DressingSpecs()) assert.equal(group(s.key), 's3', s.key);
  assert.equal(group(SEABIRD_KEY), 's1');
  assert.equal(group(FOOTPRINT_DECAL_KEY), 's1');
  return `${FILES_027.length} 个文件`;
});

await test('GLB：植被无 COLOR_0 / TEXCOORD_1、outline:false；海鸟 morph + seabird-flap 0.6 s；剧情件 -interact 节点', () => {
  if (!hasArt) return '（没有 ../art，跳过）';
  const out = [];
  for (const f of ['env-grass-coastal-a', 'env-seaweed-a']) {
    const j = glbJson(resolve(ART, 'models/env', f + '.glb'));
    for (const m of j.meshes) for (const p of m.primitives) {
      assert.ok(!('COLOR_0' in p.attributes), f + ' 有 COLOR_0');
      assert.ok(!('TEXCOORD_1' in p.attributes), f + ' 有 TEXCOORD_1');
    }
    const ex = j.nodes.map((n) => n.extras).filter(Boolean);
    assert.ok(ex.some((e) => e.outline === false), f + ' extras 没写 outline:false');
    out.push(f + ' ✓');
  }
  const bird = glbJson(resolve(ART, 'models/props/prop-seabird-far.glb'));
  const clip = bird.animations.find((a) => a.name === SEABIRD_CLIP);
  assert.ok(clip, '没有 ' + SEABIRD_CLIP);
  const dur = Math.max(...clip.samplers.map((s) => bird.accessors[s.input].max[0]));
  assert.ok(Math.abs(dur - 0.6) < 0.02, 'seabird-flap 时长 ' + dur);
  assert.ok(clip.channels.every((c) => c.target.path === 'weights'), '海鸟动画应是 morph 权重');
  out.push(`seabird-flap ${dur.toFixed(2)} s`);
  for (const [f, node] of [['prop-journal-father', 'prop-journal-father-interact'], ['prop-notice-board-s1', 'prop-notice-board-s1-interact'], ['prop-logbook-s3', 'prop-logbook-s3-interact']]) {
    const j = glbJson(resolve(ART, 'models/props', f + '.glb'));
    assert.ok(j.nodes.some((n) => n.name === node), f + ' 缺 ' + node);
  }
  return out.join('，');
});

/** 假 AssetLoader：getModel 给一个带 _lod0 子网格（+ 可选变体 / interact / extras.poses）的组 */
function fakeAssets(extra = {}) {
  const make = (key) => {
    const root = new THREE.Group();
    root.name = key;
    const add = (name, y = 0.01) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.1), new THREE.MeshStandardMaterial());
      m.name = name;
      m.position.y = y;
      root.add(m);
      return m;
    };
    if (key === 'prop-journal-father') {
      add('prop-journal-father-closed_lod0');
      add('prop-journal-father-open_lod0');
      const i = new THREE.Object3D();
      i.name = 'prop-journal-father-interact';
      i.position.set(0, 0.035, 0);
      root.add(i);
    } else add(key + '_lod0');
    if (key === 'prop-cup-tin') root.userData.poses = { upturned: { t: [0, 0.085, 0], r: [1, 0, 0, 0] } };
    return root;
  };
  return { has: (k) => k in extra || true, getModel: make, getTexture: () => new THREE.Texture(), getAnimations: () => [], ...extra };
}

await test('mountDressing：socket 优先 → layout 回退；白盒换载体材质，子节点照常可见、白盒不描边', () => {
  const scene = new THREE.Scene();
  const sock = new THREE.Object3D();
  sock.name = 'sock';
  sock.position.set(1, 2, 3);
  sock.rotation.y = -Math.PI / 2;
  scene.add(sock);
  const gb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.2), new THREE.MeshStandardMaterial({ name: 'gb' }));
  gb.name = 'journal-gb';
  gb.position.set(1, 2.015, 3);
  scene.add(gb);
  const [a, b] = mountDressing(fakeAssets(), scene, [
    { key: 'prop-journal-father', id: 'j', at: ['sock', [9, 9, 9]], greybox: 'journal-gb', variant: { show: 'prop-journal-father-closed', hide: ['prop-journal-father-open'] } },
    { key: 'prop-letter-c', id: 'c', at: ['missing-socket', [4, 5, 6]], yaw: 0.3 },
  ]);
  assert.equal(a.at, 'sock');
  assert.equal(b.at, 'layout');
  const wp = a.model.getWorldPosition(new THREE.Vector3());
  assert.ok(wp.distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-6, '日志没落在 socket：' + wp.toArray());
  const wq = a.model.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(wq.angleTo(sock.quaternion) < 1e-6, '日志没跟 socket 朝向');
  assert.equal(a.model.parent, gb, '要挂在白盒交互物下（跟着交互物显隐 / 描边）');
  assert.equal(gb.visible, true, '白盒本身不能 visible=false（会连带隐藏美术）');
  assert.equal(gb.material.visible, false, '白盒应换成不渲染的载体材质');
  assert.equal(gb.userData.__outline, true, '白盒载体不描边（Highlight 跳过带 __outline 标记的网格）');
  assert.equal(a.model.getObjectByName('prop-journal-father-open_lod0').visible, false);
  assert.equal(a.model.getObjectByName('prop-journal-father-closed_lod0').visible, true);
  assert.ok(Math.abs(b.model.rotation.y - 0.3) < 1e-6);
  return 'socket / 回退 / 载体 / 变体 ✓';
});

await test('mountDressing：桌面实测吸附（≤ maxSnap 吸附并记偏差，超出不动）；倒扣杯读 GLB extras.poses', () => {
  const scene = new THREE.Scene();
  const art = new THREE.Group();
  art.name = 'art';
  const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.04, 2), new THREE.MeshStandardMaterial());
  top.position.y = 0.75 + 0.03 - 0.02; // 桌面实际在 0.78（比 layout 高 3 cm）
  art.add(top);
  scene.add(art);
  const out = mountDressing(fakeAssets(), scene, [
    { key: 'prop-cup-tin', id: 'up', at: [[0, 0.75, 0]], offset: [-0.06, 0, 0], surface: { roots: ['art'], maxSnap: 0.1 } },
    { key: 'prop-cup-tin', id: 'down', at: [[0, 0.75, 0]], offset: [0.06, 0, 0], pose: 'upturned', surface: { roots: ['art'], maxSnap: 0.1 } },
    { key: 'prop-letter-a', id: 'far', at: [[0, 0.5, 0]], surface: { roots: ['art'], maxSnap: 0.1 } },
  ]);
  const [up, down, far] = out;
  assert.ok(Math.abs(up.surfaceOffset - 0.03) < 1e-4 && up.snapped, '偏差 ' + up.surfaceOffset);
  assert.ok(Math.abs(up.model.position.y - 0.78) < 1e-4);
  assert.ok(Math.abs(up.model.position.x + 0.06) < 1e-6);
  assert.ok(Math.abs(down.model.position.y - (0.78 + 0.085)) < 1e-4, '倒扣杯高度 ' + down.model.position.y);
  const flip = new THREE.Vector3(0, 1, 0).applyQuaternion(down.model.quaternion);
  assert.ok(flip.y < -0.999, '倒扣杯应绕 X 转 180°');
  assert.equal(far.snapped, false, '离桌面 0.28 m 不应吸附');
  assert.ok(Math.abs(far.model.position.y - 0.5) < 1e-6);
  return `偏差 +${(up.surfaceOffset * 100).toFixed(1)} cm 吸附，倒扣 ✓`;
});

await test('S2 / S3 摆位规格：日志合 / 开两版、纸 B 不加 rotX、书桌组在纸条之前（纸条落航海图）', () => {
  const s2 = s2DressingSpecs();
  const s3 = s3DressingSpecs();
  const j2 = s2.find((s) => s.id === 'prop-journal-father-s2');
  const j3 = s3.find((s) => s.id === 'prop-journal-father-s3');
  assert.equal(j2.variant.show, 'prop-journal-father-closed');
  assert.equal(j3.variant.show, 'prop-journal-father-open');
  assert.equal(j2.at[0], 'env-keeper-house-ch1-interior-journal-socket');
  assert.deepEqual(j2.at[1], S2.points.journalSocket);
  assert.equal(j3.at[0], 'lamp-room-journal-socket');
  const b = s3.find((s) => s.key === 'prop-letter-b');
  assert.equal(b.at[0], 'ignition-note-read');
  assert.ok(!b.pose && !b.offset, '纸 B 平放在铁托盘上：不加姿态');
  assert.equal(s3.find((s) => s.key === 'prop-logbook-s3').at[0], 'logbook-s3-read');
  assert.ok(s2.findIndex((s) => s.key === 'prop-desk-set-a') < s2.findIndex((s) => s.key === 'prop-letter-c'));
  const notice = s1DressingSpecs().find((s) => s.key === 'prop-notice-board-s1');
  assert.equal(notice.greybox, 's1-notice');
  assert.equal(notice.yaw, S1.pier.rotationY);
  assert.ok(Math.abs(notice.at[0][1] - S1.pier.deckY) < 1e-9, '告示牌原点 = 甲板面');
  return 'ok';
});

await test('033 脚印路径：footprints-path.json = 美术原件（逐字节），4 块 T1–T4 首尾相接、每块 2 m、yaw = 走向，和美术给的参考值一致', () => {
  const mine = readFileSync(resolve(ROOT, 'src/levels/s1/footprints-path.json'));
  if (hasArt) assert.ok(mine.equals(readFileSync(resolve(ART, 'models/props/preview/033-footprints-path.json'))), 'src/levels/s1/footprints-path.json 和 art/models/props/preview/033-footprints-path.json 不一致，重新拷一份');
  assert.equal(FOOTPRINT_TILES.length, 4);
  // 美术 033 交付消息里的参考值（只在这里核对，代码里不写）
  const REF = [[2.914, 0.119, 4.272, 0.9482], [4.608, 0.116, 5.331, 1.0499], [6.304, 0.114, 6.389, 0.9619], [7.882, 0.112, 7.615, 0.8414]];
  FOOTPRINT_TILES.forEach((t, i) => {
    assert.equal(t.id, 'T' + (i + 1));
    const [x, y, z, yaw] = REF[i];
    assert.ok(Math.abs(t.center[0] - x) < 1e-6 && Math.abs(t.center[1] - y) < 1e-6 && Math.abs(t.center[2] - z) < 1e-6 && Math.abs(t.yaw - yaw) < 1e-6, t.id + ' 和参考值不一致');
    const dx = t.to[0] - t.from[0], dz = t.to[1] - t.from[1];
    assert.ok(Math.abs(Math.hypot(dx, dz) - FOOTPRINT_DECAL_SIZE[1]) < 0.01, t.id + ' 长度不是 2 m');
    assert.ok(Math.abs(Math.atan2(dx, dz) - t.yaw) < 1e-3, t.id + ' yaw ≠ from→to 走向');
    assert.ok(Math.abs((t.from[0] + t.to[0]) / 2 - t.center[0]) < 0.03 && Math.abs((t.from[1] + t.to[1]) / 2 - t.center[2]) < 0.03, t.id + ' 中心离 from / to 中点超过 3 cm（路径是曲线，允许弦中点偏一点）');
    if (i) assert.deepEqual(t.from, FOOTPRINT_TILES[i - 1].to, t.id + ' 没和上一块首尾相接');
    // 高度 = 沙面（sandY 0.1）上方一点点，不是小径板高度（旧射线 0.38–0.54）
    assert.ok(t.center[1] > S1.sandY - 0.01 && t.center[1] < S1.sandY + 0.03, t.id + ' 高度 ' + t.center[1]);
  });
  // 不压礁石踏石：踏石中心到每块贴花矩形的距离 ≥ 1 m
  for (const t of FOOTPRINT_TILES) for (const [px, , pz] of S1.reefPath) {
    const s = Math.sin(t.yaw), c = Math.cos(t.yaw);
    const rx = px - t.center[0], rz = pz - t.center[2];
    const u = rx * s + rz * c, v = rx * c - rz * s; // u 沿走向，v 横向
    const d = Math.hypot(Math.max(0, Math.abs(u) - FOOTPRINT_DECAL_SIZE[1] / 2), Math.max(0, Math.abs(v) - FOOTPRINT_DECAL_SIZE[0] / 2));
    assert.ok(d >= 1, `${t.id} 离踏石 (${px}, ${pz}) 只有 ${d.toFixed(2)} m`);
  }
  return FOOTPRINT_TILES.map((t) => `${t.id} (${t.center.join(', ')}) yaw ${t.yaw}`).join('；');
});

await test('033 脚印贴花：4 块 1 × 2 m 挂在 json 坐标（y 直接用、不打射线），rotation (0, yaw, 0, YXZ)，脚尖（−V）沿走向，roughness 0.65，共用几何 / 材质', () => {
  const scene = new THREE.Scene();
  const d = buildS1Dressing(fakeAssets({ has: (k) => k === FOOTPRINT_DECAL_KEY }), scene);
  assert.ok(d.decal, '没有贴花');
  assert.equal(d.decal.name, 's1-footprints-decal');
  assert.equal(d.decal.parent, scene);
  assert.equal(d.decals.length, 4);
  assert.equal(d.seabird, null);
  scene.updateMatrixWorld(true);
  d.decals.forEach((m, i) => {
    const t = FOOTPRINT_TILES[i];
    assert.equal(m.name, 's1-footprints-decal-' + t.id);
    assert.deepEqual(m.position.toArray(), [...t.center], t.id + ' 位置');
    assert.equal(m.rotation.order, 'YXZ');
    assert.ok(m.rotation.x === 0 && m.rotation.z === 0 && m.rotation.y === t.yaw, t.id + ' 旋转');
    const toe = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld); // 局部 +Z = 纹理 −V = 脚尖
    assert.ok(Math.abs(toe.x - Math.sin(t.yaw)) < 1e-9 && Math.abs(toe.z - Math.cos(t.yaw)) < 1e-9 && Math.abs(toe.y) < 1e-9, t.id + ' 脚尖方向不对');
    assert.ok(new THREE.Vector3(0, 1, 0).transformDirection(m.matrixWorld).y > 0.9999, t.id + ' 法线应朝上');
    m.geometry.computeBoundingBox();
    const sz = m.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(sz.x - 1) < 1e-9 && Math.abs(sz.z - 2) < 1e-9, t.id + ' 尺寸 ' + sz.toArray());
    assert.equal(m.geometry, d.decals[0].geometry);
    assert.equal(m.material, d.decals[0].material);
  });
  const m = d.decals[0].material;
  assert.ok(m.transparent && !m.depthWrite && m.polygonOffset);
  assert.equal(m.roughness, FOOTPRINT_DECAL_ROUGHNESS);
  assert.equal(FOOTPRINT_DECAL_ROUGHNESS, 0.65);
  d.dispose();
  assert.equal(d.decal.parent, null);
  // 没贴图：不建
  const d0 = buildS1Dressing(fakeAssets({ has: () => false }), new THREE.Scene());
  assert.equal(d0.decal, null);
  assert.equal(d0.decals.length, 0);
  return '4 块 ✓';
});

await test('033 字幕触发区：「比我的脚印大」在 T2 中心 r 1.4，和 S1 其他独白 / 目标触发区两两不重叠（XZ）', () => {
  const fz = footprintsMonoZone();
  const t2 = FOOTPRINT_TILES[1];
  assert.ok(fz.x === t2.center[0] && fz.z === t2.center[2] && fz.r === 1.4);
  const zones = s1SubtitleZones();
  const fp = zones.find((z) => z.id === 'ch1.s1.footprints.mono');
  assert.ok(fp && fp.shape.kind === 'circle' && fp.shape.x === fz.x && fp.shape.z === fz.z && fp.shape.r === fz.r);
  assert.ok(zones.some((z) => z.id === 'ch1.s1.goal.cross_channel'), '缺小径尽头');
  const gap = (a, b) => {
    if (a.kind === 'box' && b.kind === 'circle') return gap(b, a);
    if (a.kind === 'circle' && b.kind === 'circle') return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
    if (a.kind === 'circle') {
      const dx = Math.max(b.min[0] - a.x, 0, a.x - b.max[0]), dz = Math.max(b.min[1] - a.z, 0, a.z - b.max[1]);
      return Math.hypot(dx, dz) - a.r;
    }
    const dx = Math.max(b.min[0] - a.max[0], a.min[0] - b.max[0]), dz = Math.max(b.min[1] - a.max[1], a.min[1] - b.max[1]);
    return Math.max(dx, dz);
  };
  const out = [];
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const g = gap(zones[i].shape, zones[j].shape);
    assert.ok(g > 0, `${zones[i].id} 和 ${zones[j].id} 重叠（间隙 ${g.toFixed(2)} m）`);
    if (zones[i].id === 'ch1.s1.footprints.mono' || zones[j].id === 'ch1.s1.footprints.mono') out.push(`${zones[i].id === 'ch1.s1.footprints.mono' ? zones[j].id : zones[i].id} ${g.toFixed(2)} m`);
  }
  // 旧放法（T1 中心）会和小径尽头重叠：断言能抓到
  const t1 = FOOTPRINT_TILES[0];
  assert.ok(gap({ kind: 'circle', x: t1.center[0], z: t1.center[2], r: 1.4 }, { kind: 'circle', x: S1.reefPathEnd[0], z: S1.reefPathEnd[2], r: S1.reefPathEndRadius }) < 0, '自检：T1 处应与小径尽头重叠');
  return '脚印独白间隙：' + out.join('，');
});

await test('海鸟：间歇出现（每 period 秒飞 arc 弧度），扇翅 / 滑翔交替，朝向切向', () => {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.2), new THREE.MeshStandardMaterial());
  mesh.morphTargetInfluences = [0, 0];
  mesh.morphTargetDictionary = { 'flap-up': 0, 'flap-down': 1 };
  mesh.name = 'bird_lod0';
  model.add(mesh);
  const clip = new THREE.AnimationClip(SEABIRD_CLIP, 0.6, [new THREE.NumberKeyframeTrack('bird_lod0.morphTargetInfluences[flap-up]', [0, 0.3, 0.6], [0, 1, 0])]);
  const r = S1.seabird;
  const b = new Seabird(model, [clip], r, 7);
  const dt = 1 / 30;
  let visible = 0, total = 0, flapFlips = 0, last = b.flappingNow, maxTanErr = 0;
  let prev = null;
  for (let t = 0; t < r.period * 2; t += dt) {
    b.update(dt);
    total++;
    if (b.object.visible) {
      visible++;
      const pos = b.object.position.clone();
      if (prev && pos.distanceTo(prev) < 1) {
        const v = pos.clone().sub(prev).setY(0).normalize();
        const f = new THREE.Vector3(0, 0, 1).applyQuaternion(b.object.quaternion).setY(0).normalize();
        maxTanErr = Math.max(maxTanErr, 1 - v.dot(f));
      }
      prev = pos;
    } else prev = null;
    if (b.flappingNow !== last) { flapFlips++; last = b.flappingNow; }
  }
  const frac = visible / total;
  const expect = (r.arc * r.radius) / r.speed / r.period;
  assert.ok(Math.abs(frac - expect) < 0.03, `出现比例 ${frac.toFixed(3)}，应 ≈ ${expect.toFixed(3)}`);
  assert.ok(flapFlips >= 4, '扇翅 / 滑翔没交替');
  assert.ok(maxTanErr < 0.01, '朝向没跟切向 ' + maxTanErr);
  b.dispose();
  return `出现 ${(frac * 100).toFixed(0)}% 时间，交替 ${flapFlips} 次`;
});

let fail = 0;
for (const [name, err, out] of results) {
  if (err) { fail++; console.log('  ✗', name, '\n     ', err.message); }
  else console.log('  ✓', name, out ? '— ' + out : '');
}
console.log(fail ? `${fail} 项失败` : `全部 ${results.length} 项通过`);
process.exit(fail ? 1 : 0);
