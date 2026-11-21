// v0.1-015 S3 白盒自检（node，无浏览器）：布局 ↔ 美术 020（s3-layout.json + GLB 空节点，≤ 5 cm）、世界朝向、
// 踏步几何、谜题 5 光路（正解 / 唯一解 / 不被楼梯和 5 m 平台挡）、机位框得住目标、碰撞白盒动线
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { S3, S3_FRAME, toWorld, toLocal, treadSpan, treadTop, cameraYawFacing, alongDoor } from '@/levels/s3/layout';
import { bearingFrom } from '@/levels/s1/layout';
import { buildS3Greybox, defaultS3GreyboxMaterials } from '@/levels/s3/greybox';
import { collectIndoorVolumes } from '@/systems/CameraFollowSystem';
import { xiWetTarget } from '@/entities/xi/XiLook';
import { buildS3Beam, S3_BEAM, rayPointDist } from '@/levels/s3/beam';
import { PhysicsSystem, CharacterBody } from '@/systems/PhysicsSystem';
import { IGNITE_MONO_DELAY, IGNITE_MONO_SEC, OUTRO_CUT_SEC } from '@/levels/s3/puzzles';
import { SubtitleTrack } from '@/ui/Subtitles';
import { t as text, textMeta } from '@/content/text';

const out = [];
const near = (a, b, tol, tag) => assert.ok(Math.abs(a - b) <= tol, `${tag}：${a} vs ${b}`);
const near3 = (a, b, tol, tag) => {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(d <= tol, `${tag}：白盒 ${a.map((v) => v.toFixed(3))} / 美术 ${b.map((v) => (+v).toFixed(3))} 差 ${d.toFixed(3)} m > ${tol}`);
};

// ---- 1. 布局 ↔ s3-layout.json
const jsonUrl = new URL('../../art/source/env/s3-layout.json', import.meta.url);
let glbChecked = 0;
if (existsSync(jsonUrl)) {
  const art = JSON.parse(readFileSync(jsonUrl, 'utf8'));
  const P = art.points;
  S3.lightPath.forEach((p, i) => near3(p, P.lightPath[i], 0.001, `lightpath-${i}`));
  near3(S3.mirrors.window.center, P.mirrors.window.center, 0.001, '窗口镜');
  near3(S3.mirrors.a.center, P.mirrors.a.center, 0.001, '导光镜 1');
  near3(S3.mirrors.b.center, P.mirrors.b.center, 0.001, '导光镜 2');
  near3(S3.points.ignitionPort, P.ignitionPort, 0.001, '点火口');
  near3(S3.igniteLever.interact, P.igniteLever.interact, 0.001, '拉杆交互点');
  near3(S3.igniteLever.pivot, P.igniteLever.pivot, 0.001, '拉杆枢轴');
  near3(S3.points.journal, P.lampRoomFurniture.journal, 0.05, '日志');
  near3(S3.points.standGaze, P.lampRoomFurniture.standGaze.at, 0.001, '眺望站位');
  const K = art.keyHeights;
  assert.equal(S3.tide.low, K.lowTide);
  assert.equal(S3.tide.high, K.highTide);
  assert.equal(S3.groundFloorY, K.groundFloor);
  assert.equal(S3.lampRoom.floorY, K.lampRoomFloor);
  assert.equal(S3.doorPlatform.top, K.doorPlatform);
  assert.equal(S3.bridge.deck, K.bridgeDeck);
  assert.ok(Math.abs(art.worldFrame.rotYDeg - 135) < 1e-9 && near3(S3_FRAME.position, art.worldFrame.pos, 1e-6, 'worldFrame.pos') === undefined);
  assert.deepEqual(S3.bridge.piers, P.bridge.piers);
  // json 与 GLB 不一致（报给美术）：石桥终点 json s 30.5 vs GLB axis 33.0；白盒用 GLB
  out.push(`json：光路 5 点 / 3 面镜子 / 点火口 / 拉杆 / 关键高度 / 世界坐标 一致；石桥 s 终点 json ${P.bridge.s1 ?? '?'} vs GLB 33.0（白盒用 GLB）`);
}

// ---- 2. 布局 ↔ GLB 空节点（美术 020 rework-1029）
{
  globalThis.self ??= globalThis;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
  const load = async (rel) => {
    const f = new URL(`../../art/models/${rel}`, import.meta.url);
    if (!existsSync(f)) return null;
    const buf = readFileSync(f);
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    g.scene.updateMatrixWorld(true);
    return g.scene;
  };
  const pos = (scene, name) => {
    const o = scene.getObjectByName(name);
    assert.ok(o, `GLB 缺节点 ${name}`);
    return o.getWorldPosition(new THREE.Vector3()).toArray();
  };
  const checks = {
    'env/env-lighthouse-ch1.glb': { 'door-s3-hinge-socket': S3.door.hinge, 'stair-platform-5m-view': S3.points.view5m, 'lamp-light-origin': S3.points.lampLightOrigin },
    'env/env-lighthouse-ch1-interior.glb': {
      'oil-valve-s3-socket': S3.points.oilValve,
      'guide-mirror-s3-window-socket': S3.mirrors.window.socket,
      'guide-mirror-s3-mid-a-socket': S3.mirrors.a.socket,
      'guide-mirror-s3-mid-b-socket': S3.mirrors.b.socket,
      'guide-mirror-s3-window-cam': S3.mirrors.window.artCam,
      'guide-mirror-s3-mid-a-cam': S3.mirrors.a.artCam,
      'guide-mirror-s3-mid-b-cam': S3.mirrors.b.artCam,
      'logbook-s3-read': S3.points.logbookRead,
      'look-up-point': S3.points.lookUp,
      'stair-bottom': S3.points.stairBottom,
      'stair-door-landing': S3.points.doorLanding,
      'platform-a': S3.points.platformA,
      'platform-b': S3.points.platformB,
      'stair-top': S3.points.stairTop,
      ...Object.fromEntries(S3.lightPath.map((p, i) => [`lightpath-${i}`, p])),
    },
    'env/env-lamp-room-ch1.glb': {
      'ignition-port-s3-socket': S3.points.ignitionPort,
      'fresnel-lens-socket': S3.points.lensSocket,
      'ignite-lever-socket': S3.igniteLever.pivot,
      'ignite-lever-interact': S3.igniteLever.interact,
      'ignition-note-read': S3.points.noteRead,
      'lamp-room-arrive': S3.points.lampRoomArrive,
      'lamp-room-sit-write': S3.points.sitWrite,
      'lamp-room-journal-socket': S3.points.journal,
      'lamp-room-lantern-socket': S3.points.lantern,
      'lamp-room-stand-gaze': S3.points.standGaze,
    },
    'env/env-stone-bridge-s3.glb': { 'spawn-from-s2': S3.points.spawnFromS2, 'bridge-to-s2-exit': S3.points.bridgeExit, 'bridge-head': S3.points.bridgeHead },
  };
  for (const [file, nodes] of Object.entries(checks)) {
    const scene = await load(file);
    if (!scene) continue;
    for (const [name, p] of Object.entries(nodes)) {
      near3(p, pos(scene, name), 0.05, name);
      glbChecked++;
    }
    if (file.includes('interior')) {
      const a = scene.getObjectByName('guide-mirror-s3-mid-a-socket').userData;
      const b = scene.getObjectByName('guide-mirror-s3-mid-b-socket').userData;
      assert.ok(Math.abs(a.fixedPitchDeg - S3.mirrors.a.fixedPitchDeg) < 1e-6 && Math.abs(b.fixedPitchDeg - S3.mirrors.b.fixedPitchDeg) < 1e-6, '导光镜固定俯仰与 GLB 不一致');
      assert.equal(scene.getObjectByName('oil-valve-s3-socket').userData.holdSec, 2, '油阀长按 2 s（GLB userData）');
    }
    if (file.includes('lamp-room')) {
      // 035 美术降低座 / 桌：layout.lampRoom.seatTop / deskTop = GLB lamp-room-sit-write extras；日志 / 风灯 socket y = 地面 + 桌面
      const sw = scene.getObjectByName('lamp-room-sit-write').userData;
      near(S3.lampRoom.seatTop, sw.seatTop, 1e-6, '椅子座高 = GLB seatTop');
      near(S3.lampRoom.deskTop, sw.deskTop, 1e-6, '桌高 = GLB deskTop');
      for (const k of ['journal', 'lantern']) near(S3.points[k][1], S3.lampRoom.floorY + S3.lampRoom.deskTop, 0.005, `${k} socket 在桌面上`);
      out.push(`灯室家具：座 ${sw.seatTop} / 桌 ${sw.deskTop}（GLB）= layout；日志 / 风灯 socket y ${S3.points.journal[1]} ✓`);
      const lv = scene.getObjectByName('ignite-lever-interact').userData;
      // 美术写 xi-pull-lever，工单写 xi-ignite-lever：程序用工单名，报告里列不一致
      out.push(`GLB 拉杆动画名 ${lv.anim}（工单 xi-ignite-lever）`);
    }
    if (file.includes('stone-bridge')) {
      const ax = scene.getObjectByName('env-stone-bridge-s3_1')?.userData?.axis;
      if (ax) {
        const len = Math.hypot(ax.to[0], ax.to[2]);
        assert.ok(Math.abs(len - S3.bridge.s[1]) < 0.05, `石桥终点 s ${len.toFixed(2)} ≠ ${S3.bridge.s[1]}`);
      }
    }
  }
  if (glbChecked) out.push(`GLB 空节点 ${glbChecked} 个 ≤ 5 cm ✓`);
}

// ---- 3. 世界朝向 / 踏步
{
  const c = toWorld([0, 0, 0]);
  assert.ok(c.distanceTo(new THREE.Vector3(...S3_FRAME.position)) < 1e-9);
  assert.ok(toLocal(toWorld([1.2, 3.4, -5.6])).distanceTo(new THREE.Vector3(1.2, 3.4, -5.6)) < 1e-9, 'toLocal ∘ toWorld 应为恒等');
  const win = toWorld(S3.points.view5m.map((v, i) => (i === 1 ? 0 : v)));
  const winDir = toWorld([Math.cos((320 * Math.PI) / 180) * 4, 0, Math.sin((320 * Math.PI) / 180) * 4]);
  const az = bearingFrom(c.toArray(), winDir.toArray()).azimuthDeg;
  assert.ok(Math.abs(az - 95) < 8, `5 m 大窗世界方位 ${az.toFixed(1)}°，工单要约正东 95°`);
  void win;
  const door = bearingFrom(c.toArray(), toWorld(alongDoor(10, 0, 0)).toArray()).azimuthDeg;
  assert.ok(door < 20 || door > 340, `塔门 / 石桥应朝世界北（S1 岸），实际 ${door.toFixed(1)}°`);
  // 踏步：平台起始角、最后一级 = 楼梯口
  const L = S3.stair.landings;
  for (const l of Object.values(L)) assert.equal(treadSpan(l.tread)[0], l.span[0], `平台踏步 ${l.tread} 起始角`);
  assert.ok(Math.abs(treadTop(108) - S3.points.stairTop[1]) < 1e-9, '第 108 级 = stair-top 21.8');
  assert.ok(Math.abs(treadTop(L.A.tread) - S3.points.platformA[1]) < 1e-9 && Math.abs(treadTop(L.B.tread) - S3.points.platformB[1]) < 1e-9 && Math.abs(treadTop(L.window5m.tread) - S3.points.view5m[1]) < 1e-9, '平台高度');
  const end = treadSpan(108)[1] % 360;
  assert.ok(end >= S3.stair.hatchDeg[0] && end <= S3.stair.hatchDeg[1] + 1e-9, `楼梯顶 ${end}° 应在楼梯口 θ110–182 内`);
  const f = cameraYawFacing([0, 0, 1]);
  assert.ok(Number.isFinite(f));
  out.push(`世界：塔心 ${S3_FRAME.position}，5 m 大窗方位 ${az.toFixed(1)}°，塔门 / 石桥方位 ${door.toFixed(1)}°；踏步 108 级顶 ${treadTop(108)} / 楼梯口 ${end}° ✓`);
}

// ---- 4. 光路
const frameRoot = new THREE.Group();
frameRoot.position.set(...S3_FRAME.position);
frameRoot.rotation.y = S3_FRAME.rotationY;
const gb = buildS3Greybox(defaultS3GreyboxMaterials());
frameRoot.add(gb.root);
frameRoot.updateMatrixWorld(true);
const ph = new PhysicsSystem();
const cols = new Map();
for (const m of gb.colliders) cols.set(m, ph.addMesh(m));
for (const m of gb.walls) ph.addMesh(m, { kind: 'wall' });
const beam = buildS3Beam(ph, frameRoot);
{
  const tr = beam.tracer;
  const main = () => tr.paths.find((p) => p.emitter.id === 'sky-s3');
  const sol = S3_BEAM.solution;
  beam.solve();
  tr.trace();
  const p = main();
  assert.deepEqual(p.mirrors, ['guide-mirror-s3-window', 'guide-mirror-s3-mid-a', 'guide-mirror-s3-mid-b'], `正解光路应依次经过三面镜子，实际 ${JSON.stringify(p.mirrors)} / ${p.end}`);
  assert.equal(p.receiver?.id, 'ignition-port-s3', `正解光路应停在点火口，实际 ${p.end}`);
  const port = beam.igniter.center(new THREE.Vector3());
  const last = p.segments[p.segments.length - 1];
  const miss = rayPointDist(last.from, last.to.clone().sub(last.from).normalize(), port);
  // 美术 lightPathCheck：法线角（竖轴角从 +X 往 +Z 量）
  const alpha = (rig) => {
    const n = new THREE.Vector3(0, 0, 1).transformDirection(rig.plane.matrixWorld);
    const l = n.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -S3_FRAME.rotationY);
    return { yaw: (Math.atan2(l.z, l.x) * 180) / Math.PI, pitch: (Math.asin(l.y) * 180) / Math.PI };
  };
  const na = alpha(beam.mirrors.a);
  const nb = alpha(beam.mirrors.b);
  const nw = alpha(beam.mirrors.window);
  const angd = (x, y) => Math.abs(((x - y + 540) % 360) - 180);
  assert.ok(angd(na.yaw, S3.mirrors.a.artYawDeg) < 0.2, `导光镜 1 竖轴角 ${na.yaw.toFixed(3)} vs 美术 ${S3.mirrors.a.artYawDeg}`);
  assert.ok(angd(nb.yaw, S3.mirrors.b.artYawDeg) < 0.2, `导光镜 2 竖轴角 ${nb.yaw.toFixed(3)} vs 美术 ${S3.mirrors.b.artYawDeg}`);
  assert.ok(angd(nw.yaw, S3.plannedNormals.window.yaw) < 0.3 && Math.abs(nw.pitch - S3.plannedNormals.window.pitch) < 0.3, `窗口镜法线 ${nw.yaw.toFixed(2)} / ${nw.pitch.toFixed(2)} vs 策划 15.8 / 66.3`);
  // 光段不被楼梯 / 5 m 平台 / 塔壁挡：正解就是 receiver（BeamTracer 碰到碰撞体会停），这里再看每段离踏步的余量
  const segs = p.segments.map((s) => [toLocal(s.from), toLocal(s.to)]);
  // 楼梯内沿 r 2：塔内光段只有窗口镜附近（y < 4，那一侧最低的踏步在 7 m 以上）允许在 r 2 以外
  let minR = Infinity;
  for (const [a, b] of segs.slice(1))
    for (let t = 0; t <= 1; t += 0.01) {
      const y = a.y + (b.y - a.y) * t;
      if (y < 4) continue;
      minR = Math.min(minR, 2 - Math.hypot(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
    }
  assert.ok(minR > 0.3, `塔内光段离楼梯内沿（r 2）只剩 ${minR.toFixed(2)} m`);
  // 唯一解：其它镜子在正解，逐面按 7.5° 精调档穷举
  const hitsPort = () => {
    tr.trace();
    return main().receiver?.id === 'ignition-port-s3';
  };
  const W = beam.mirrors.window.part;
  const winHits = [];
  for (let y = 0; y < 360; y += 7.5)
    for (let e = S3_BEAM.windowPitchRange[0]; e <= S3_BEAM.windowPitchRange[1]; e += 7.5) {
      W.setAngle(0, y);
      W.setAngle(1, e);
      if (hitsPort()) winHits.push([y, e]);
    }
  beam.solve();
  assert.deepEqual(winHits, [[sol.windowYaw, sol.windowPitch]], `窗口镜 48 × 13 档里应只有正解，实际 ${JSON.stringify(winHits)}`);
  for (const k of ['a', 'b']) {
    const hits = [];
    for (let y = 0; y < 360; y += 7.5) {
      beam.mirrors[k].part.setAngle(0, y);
      if (hitsPort()) hits.push(y);
    }
    beam.solve();
    assert.deepEqual(hits, [sol[k]], `导光镜 ${k} 48 档里应只有正解，实际 ${JSON.stringify(hits)}`);
  }
  // 初始 0：不命中；R 只重置当前镜子（每面镜子单独一个 PuzzleGroup）
  beam.reset();
  assert.ok(!hitsPort(), '初始角度不应命中点火口');
  beam.solve();
  beam.mirrors.a.puzzle.reset();
  assert.equal(beam.mirrors.window.part.angles[0], sol.windowYaw, 'R 重置导光镜 1 不应动窗口镜');
  assert.equal(beam.mirrors.a.part.angles[0], 0);
  // 机位：目标都在 16:9 视锥内
  const windowCam = new THREE.Vector3(...S3_BEAM.cams.window.position);
  assert.ok(Math.hypot(windowCam.x, windowCam.z) < S3.stair.r[0], '窗口机位应在楼梯 / 栏杆内沿以内');
  assert.ok(windowCam.y > S3.mirrors.window.center[1], '窗口机位从上方框住镜面而非贴墙仰拍');
  const camLines = [];
  for (const rig of Object.values(beam.mirrors)) {
    const cs = S3_BEAM.cams[rig.key];
    const cam = new THREE.PerspectiveCamera(rig.cam.userData.fov, 16 / 9, 0.05, 100);
    rig.cam.updateMatrixWorld(true);
    cam.matrixWorld.copy(rig.cam.matrixWorld);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const pts = { window: S3.lightPath[1], a: S3.lightPath[2], b: S3.lightPath[3], port: S3.lightPath[4], windowOuter: S3_BEAM.windowOuter };
    for (const t of cs.targets) {
      const ndc = toWorld(pts[t]).project(cam);
      assert.ok(Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && ndc.z < 1 && ndc.z > -1, `${rig.cam.name} 看不到 ${t}：ndc ${ndc.toArray().map((v) => v.toFixed(2))}`);
    }
    camLines.push(`${rig.key} fov ${cs.fov}`);
  }
  beam.solve();
  out.push(`光路：正解 窗口镜 ${sol.windowYaw}/${sol.windowPitch}、导光镜 1 ${sol.a}、导光镜 2 ${sol.b} → 点火口（光线离口心 ${miss.toFixed(4)} m）；法线 窗 ${nw.yaw.toFixed(1)}/${nw.pitch.toFixed(1)}、A ${na.yaw.toFixed(2)}、B ${nb.yaw.toFixed(2)}（美术 −19.777 / 160.755）；7.5° 穷举唯一解 ✓；离楼梯内沿余量 ${minR.toFixed(2)} m；机位 ${camLines.join(' / ')} 框得住目标 ✓`);
  // 塔外冷光预告：停在礁石挡光块上
  const pv = tr.paths.find((q) => q.emitter.id === 'sky-preview-s3');
  const pt = toLocal(pv.endPoint);
  assert.ok(pv.end === 'blocker' && pt.distanceTo(new THREE.Vector3(...S3.points.skyPreviewTarget)) < 0.5, `天光预告应落在礁石 ${S3.points.skyPreviewTarget}，实际 ${pv.end} ${pt.toArray().map((v) => v.toFixed(2))}`);
}

// ---- 4b. 导光镜 a / b 美术文件（1030b 第 1 条）：挂白盒组、镜面对齐、mirror-pivot 拷白盒 yaw；正解角 / 固定俯仰 / 15° 档位与 015 白盒一致
{
  const { mountArtSlots, findNode } = await import('@/levels/artSlots');
  const { S3_ART_SLOTS } = await import('@/levels/s3/artSlots');
  const { manifest } = await import('@/assets/manifest');
  const { gameplay } = await import('@/config/gameplay');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
  assert.ok(!manifest.some((e) => e.key === 'prop-guide-mirror-wall-s3'), '旧 key prop-guide-mirror-wall-s3 已拆掉');
  const lines = [];
  for (const k of ['a', 'b']) {
    const key = `prop-guide-mirror-wall-s3-${k}`;
    const e = manifest.find((x) => x.key === key);
    assert.ok(e && e.group === 's3' && e.url === `assets/art/models/props/${key}.glb`, `manifest 登记 ${key}`);
    const spec = S3_ART_SLOTS.find((x) => x.key === key);
    assert.ok(spec && spec.id === key, `artSlots ${key}`);
    const f = new URL(`../../art/models/props/${key}.glb`, import.meta.url);
    if (!existsSync(f)) {
      lines.push(`${k} 未交付`);
      continue;
    }
    const buf = readFileSync(f);
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    const rootX = g.scene.children.find((o) => o.userData.name === key).userData;
    // 1030 重交：打包工具曾把名字带 -wall 的渲染网格当碰撞网格（LOD0 法线 / UV 错位）→ 碰撞只许 -collider 一个，渲染网格都要有法线 + UV、不带 collider 标记
    {
      const render = [], cols = [];
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.collider || /-collider$/.test(o.name)) cols.push(o.name);
        else render.push(o);
      });
      assert.deepEqual(cols, [`${key}-collider`], `${k} 碰撞网格只有 ${key}-collider（实际 ${cols.join('、')}）`);
      assert.ok(render.some((o) => /_lod0$/.test(o.name)), `${k} 有渲染 ${key}_lod0`);
      for (const o of render) {
        const geo = o.geometry, P = geo.attributes.position, N = geo.attributes.normal, idx = geo.index;
        assert.ok(N && geo.attributes.uv, `${k} 渲染网格 ${o.name} 有法线 + UV`);
        // 顶点法线（三点平均）与面法线夹角 > 60° 的三角形比例：旧版错位 LOD0 = 62.4%，重交版 0%
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3(), tn = new THREE.Vector3();
        let tri = 0, bad = 0;
        for (let t = 0, n = idx ? idx.count : P.count; t < n; t += 3) {
          const ii = [0, 1, 2].map((q) => (idx ? idx.getX(t + q) : t + q));
          a.fromBufferAttribute(P, ii[0]); b.fromBufferAttribute(P, ii[1]); c.fromBufferAttribute(P, ii[2]);
          fn.subVectors(c, b).cross(tn.subVectors(a, b));
          if (fn.lengthSq() < 1e-14) continue;
          fn.normalize();
          vn.set(0, 0, 0);
          for (const q of ii) vn.add(tn.fromBufferAttribute(N, q));
          tri++;
          if (fn.dot(vn.normalize()) < 0.5) bad++;
        }
        assert.ok(bad / tri < 0.02, `${k} ${o.name} 法线与面不一致 ${((bad / tri) * 100).toFixed(1)}%（旧版打包错位）`);
      }
    }
    const rig = beam.mirrors[k];
    const L = S3.mirrors[k];
    // 015 白盒：正解 sol[k]（15° 档的整数倍，初始 0 = 正解往回 sol 度）、固定俯仰、ψ = 白盒 yaw.rotation.y（正解时）
    const sol = S3_BEAM.solution[k];
    assert.equal(rig.part.stepDeg, gameplay.puzzle.stepDeg);
    assert.equal(rig.part.stepDeg, 15, '导光镜 15° 档');
    assert.equal(sol % 15, 0, `正解 ${sol}° 在 15° 档上`);
    beam.solve();
    frameRoot.updateMatrixWorld(true);
    const yawNode = findNode(rig.root, `${L.id}-yaw`);
    const pitchNode = findNode(rig.root, `${L.id}-pitch`);
    const yawPsi = (o) => {
      const v = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
      return (Math.atan2(v.x, v.z) * 180) / Math.PI;
    };
    const psiGb = yawPsi(yawNode);
    const angd = (x, y) => Math.abs(((x - y + 540) % 360) - 180);
    assert.ok(angd(psiGb, rootX.solvedPsiDeg) < 0.01, `${k} 正解 ψ：白盒 ${psiGb.toFixed(3)} vs 美术 ${rootX.solvedPsiDeg}`);
    assert.ok(angd(90 - rootX.artYawDeg, rootX.solvedPsiDeg) < 1e-6 && Math.abs(rootX.artYawDeg - L.artYawDeg) < 1e-6, `${k} ψ = 90 − artYawDeg、artYawDeg = layout`);
    assert.ok(Math.abs(rootX.fixedPitchDeg - L.fixedPitchDeg) < 1e-6, `${k} 固定俯仰 = layout`);
    const artPitch = findNode(g.scene, 'mirror-pitch');
    near3([artPitch.rotation.x, 0, 0], [pitchNode.rotation.x, 0, 0], 1e-4, `${k} mirror-pitch 旋转 = 白盒 pitch`);
    near3(rootX.mirrorCenterS3, L.center, 1e-6, `${k} 镜心`);
    // 挂上：白盒组 guide-mirror-s3-mid-k（S3 局部、不旋转）
    const slots = mountArtSlots({ has: (x) => x === key, getModel: () => g.scene }, frameRoot, [spec]);
    assert.equal(slots.mounted.length, 1);
    assert.deepEqual(slots.mounted[0].missingNodes, [], `${k} 约定节点齐`);
    assert.equal(g.scene.parent, rig.root, `${k} 挂白盒组`);
    const plane = findNode(g.scene, 'mirror-plane');
    const nrm = (o) => new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    const check = (tag) => {
      slots.update();
      frameRoot.updateMatrixWorld(true);
      const d = plane.getWorldPosition(new THREE.Vector3()).distanceTo(rig.plane.getWorldPosition(new THREE.Vector3()));
      assert.ok(d < 1e-3, `${k} ${tag} 镜心对齐 ${d}`);
      const a = (nrm(plane).angleTo(nrm(rig.plane)) * 180) / Math.PI;
      assert.ok(a < 0.01, `${k} ${tag} 镜面法线 = 白盒（差 ${a.toFixed(4)}°）`);
      return d;
    };
    const dSol = check('正解');
    // 美术镜面正解光路：上一镜心 → 美术镜面反射 → 下一目标的偏差
    const from = k === 'a' ? S3.lightPath[1] : S3.lightPath[2];
    const to = k === 'a' ? S3.lightPath[3] : S3.lightPath[4];
    const at = plane.getWorldPosition(new THREE.Vector3());
    const inDir = at.clone().sub(toWorld(from)).normalize();
    const n = nrm(plane);
    const out1 = inDir.clone().sub(n.clone().multiplyScalar(2 * inDir.dot(n)));
    const miss = rayPointDist(at, out1, toWorld(to));
    // 逐档：初始 0（= 正解 − sol）及每个 15° 档美术都跟白盒
    for (let y = 0; y < 360; y += 15) {
      rig.part.setAngle(0, y);
      check(`${y}°`);
    }
    beam.reset();
    check('初始');
    const psi0 = yawPsi(findNode(g.scene, 'mirror-pivot'));
    // 美术 -interact 与白盒站位（S3.points.platformA / B）
    const ix = findNode(g.scene, 'interact').getWorldPosition(new THREE.Vector3());
    const gbStand = toWorld(k === 'a' ? S3.points.platformA : S3.points.platformB);
    const ixL = toLocal(ix);
    beam.solve();
    slots.update();
    // 只验外观：拆掉挂上去的美术，不影响后面的白盒检查
    g.scene.removeFromParent();
    for (const m of rig.root.children) m.traverse((o) => o.isMesh && (o.visible = true));
    lines.push(`导光镜 ${k}：正解 ψ 白盒 ${psiGb.toFixed(3)}° = 美术 ${rootX.solvedPsiDeg}°、固定俯仰 ${rootX.fixedPitchDeg}°、正解 ${sol}° / 15° 档 24 档美术法线都跟白盒（镜心差 ${(dSol * 1000).toFixed(2)} mm）、美术镜面反射离下一目标 ${(miss * 1000).toFixed(1)} mm、初始 ψ ${psi0.toFixed(3)}°；美术 -interact S3 局部 (${ixL.x.toFixed(3)}, ${ixL.y.toFixed(2)}, ${ixL.z.toFixed(3)}) 离白盒站位 ${ix.distanceTo(gbStand).toFixed(2)} m`);
  }
  out.push(lines.join('；'));
}

// ---- 5. 动线（世界坐标走路）
function walk(ptsLocal, y0) {
  const b = new CharacterBody();
  ph.addBody(b);
  const s = toWorld(ptsLocal[0]);
  b.teleport(new THREE.Vector3(s.x, (y0 ?? ptsLocal[0][1]) + 0.05, s.z));
  for (let i = 0; i < 30; i++) ph.step(1 / 60);
  for (const p of ptsLocal.slice(1)) {
    const w = toWorld(p);
    let t = 0;
    while (Math.hypot(b.position.x - w.x, b.position.z - w.z) > 0.3 && t < 20) {
      const v = new THREE.Vector3(w.x - b.position.x, 0, w.z - b.position.z).normalize().multiplyScalar(2.5);
      b.velocity.x = v.x;
      b.velocity.z = v.z;
      ph.step(1 / 60);
      t += 1 / 60;
    }
    if (t >= 20) {
      ph.removeBody(b);
      return { ok: false, at: toLocal(b.position), to: p };
    }
  }
  ph.removeBody(b);
  return { ok: true, at: toLocal(b.position) };
}
const must = (name, r, y) => {
  assert.ok(r.ok, `${name}：走不到 ${JSON.stringify(r.to)}，停在 ${r.at?.toArray().map((v) => v.toFixed(2))}`);
  if (y !== undefined) assert.ok(Math.abs(r.at.y - y) < 0.06, `${name}：终点高度 ${r.at.y.toFixed(2)} ≠ ${y}`);
};
const doorCol = cols.get(gb.doorLeaf);
const P = S3.points;
const toDoor = [P.spawnFromS2, P.bridgeHead, alongDoor(5, 0, 2.4), alongDoor(3.4, 0, 2.4)];
const shut = walk([...toDoor, P.doorLanding]);
assert.ok(!shut.ok, `塔门关着时不应进得去（停在 ${shut.at.toArray().map((v) => v.toFixed(2))}）`);
must('桥尾 → 石桥 → 台阶 → 门外平台', walk(toDoor), S3.doorPlatform.top);
const back = walk([P.spawnFromS2, alongDoor(36, 0, 3)]);
assert.ok(!back.ok && Math.hypot(back.at.x, back.at.z) < 33.5, `桥尾空气墙（s 33.4）应挡住，停在 s ${Math.hypot(back.at.x, back.at.z).toFixed(2)}`);
doorCol.enabled = false;
must('门外平台 → 塔门 → 门内平台', walk([alongDoor(4.5, 0, 2.4), alongDoor(2.4, 0, 2.4), P.doorLanding]), 2.4);
// 门内平台 → 往下走到底层（踏步 10 … 1 反方向）→ 油阀前
const spiral = (k0, k1) => {
  const pts = [];
  const step = k1 > k0 ? 1 : -1;
  for (let k = k0; k !== k1 + step; k += step) {
    const [a, b] = treadSpan(k);
    pts.push([2.5 * Math.cos((((a + b) / 2) * Math.PI) / 180), treadTop(k), 2.5 * Math.sin((((a + b) / 2) * Math.PI) / 180)]);
  }
  return pts;
};
must('门内平台 → 下楼 → 底层 → 油阀前', walk([P.doorLanding, ...spiral(10, 1), P.stairBottom, [0.855, 0.2, 2.349]], 2.4), S3.groundFloorY);
must('底层 → 窗口镜前', walk([P.stairBottom, [1.6, 0.2, -0.3]], 0.2), S3.groundFloorY);
must('门内平台 → 上楼 → 5 m 平台 → A → B → 灯室', walk([P.doorLanding, ...spiral(12, 108), P.lampRoomArrive, S3.igniteLever.interact], 2.4), S3.lampRoom.floorY);
must('门内平台 → 上楼 → y 5 窗台平台 → 窗前观景点', walk([P.doorLanding, ...spiral(12, 24), P.view5m], 2.4), 5);
must('灯室 → 眺望站位 / 书桌', walk([S3.igniteLever.interact, P.standGaze, [0.9, 22, -1.2]], 22), S3.lampRoom.floorY);
doorCol.enabled = true;
out.push('动线：桥尾 → 门外平台（门关进不去）→ 门内 → 底层油阀 / 窗口镜 → 108 级 → 灯室拉杆 / 眺望 ✓');

// ---- y 5 窗台平台：窗（θ320 朝外）里看不到远处灯塔 F1 / F2、石桥、S2 一侧；光路在 y 5 离平台很远
{
  const v = S3.points.view5m;
  const w = [Math.cos((320 * Math.PI) / 180), Math.sin((320 * Math.PI) / 180)];
  const offAxis = (q) => {
    const dx = q[0] - v[0];
    const dz = q[2] - v[2];
    return (Math.acos((dx * w[0] + dz * w[1]) / Math.hypot(dx, dz)) * 180) / Math.PI;
  };
  // 窗宽 0.8、观景点离窗约 0.5 m → 水平半视角约 39°；留余量按 60° 判
  const targets = { 远塔F1: S3.silhouettes.F1, 远塔F2: S3.silhouettes.F2, 石桥头: S3.points.bridgeHead, 桥尾_S2侧: S3.points.spawnFromS2 };
  const offs = Object.entries(targets).map(([n, q]) => [n, offAxis(q)]);
  for (const [n, a] of offs) assert.ok(a > 60, `y 5 窗里能看到 ${n}（离窗轴 ${a.toFixed(1)}°）`);
  const span = S3.stair.landings.window5m.span;
  const lp = S3.lightPath;
  let cross = null;
  for (let i = 0; i < lp.length - 1; i++) {
    const [a, b] = [lp[i], lp[i + 1]];
    if ((a[1] - 5) * (b[1] - 5) <= 0) {
      const u = (5 - a[1]) / (b[1] - a[1]);
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[2] + (b[2] - a[2]) * u;
      cross = { r: Math.hypot(x, z), th: (((Math.atan2(z, x) * 180) / Math.PI) % 360 + 360) % 360 };
    }
  }
  assert.ok(cross, '光路应穿过 y 5');
  const inSpan = cross.th >= span[0] - 10 && cross.th <= span[1] + 10;
  assert.ok(!inSpan || cross.r < S3.stair.r - 1.0, `y 5 处光路 r ${cross.r.toFixed(2)} θ ${cross.th.toFixed(1)} 离平台太近`);
  out.push(`y 5 窗台平台：走得到窗前；窗轴离 ${offs.map(([n, a]) => `${n} ${a.toFixed(0)}°`).join(' / ')}（> 60°）；光路在 y 5 处 r ${cross.r.toFixed(2)} θ ${cross.th.toFixed(1)}，平台 θ${span[0]}–${span[1]} ✓`);
}

// ---- 015 C 点火拉杆：017 对位数据 ↔ char-xi-anims.glb extras；S3 局部几何；与纸条间距
{
  const { XI_IGNITE_LEVER_ALIGN: AL, igniteLeverAngleAt, xiActionTiming } = await import('@/entities/xiActions');
  const L = S3.igniteLever;
  const glbUrl = new URL('../../art/models/characters/char-xi-anims.glb', import.meta.url);
  if (existsSync(glbUrl)) {
    const buf = readFileSync(glbUrl);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
    const clip = json.animations.find((x) => x.name === 'xi-ignite-lever');
    assert.ok(clip, 'char-xi-anims.glb 缺 xi-ignite-lever');
    const ex = clip.extras;
    const g = ex.align.igniteLever;
    assert.equal(ex.frames, AL.frames);
    assert.equal(ex.fps, AL.fps);
    assert.ok(Math.abs(ex.durationS - xiActionTiming('xi-ignite-lever').duration) < 1e-6, '时长 1.5 s');
    assert.deepEqual(ex.eventFrames, AL.eventFrames);
    assert.deepEqual(g.pivot, [...AL.pivot]);
    assert.equal(g.lengthM, AL.lengthM);
    assert.equal(g.pullDeg, AL.pullDeg);
    assert.equal(g.pullSign, AL.pullSign);
    assert.deepEqual(g.angleDegPerFrame, [...AL.angleDegPerFrame]);
    // 汐局部（以 -interact 为原点、面朝 +Z）→ S3 局部：面朝 facing = −X ⇒ yaw −90°
    const yaw = Math.atan2(L.facing[0], L.facing[2]);
    const xi2s3 = (v) => new THREE.Vector3(...v).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(...L.interact)).toArray();
    near3(xi2s3(g.pivot), L.pivot, 0.002, '拉杆枢轴（017 对位 → S3）');
    near3(xi2s3(g.gripAtRest), L.gripRest, 0.002, '静止握点（017 对位 → S3）');
    near3(xi2s3(g.gripPulled), L.gripPulled, 0.002, '拉到底握点（017 对位 → S3）');
    out.push(`拉杆对位：char-xi-anims.glb extras（46 帧 / 30 fps / ignite 第 ${ex.eventFrames.ignite} 帧 / angleDegPerFrame）与代码一致，枢轴 / 握点换到 S3 ≤ 2 mm ✓`);
  }
  // 握点绕枢轴（汐 +X 轴）按逐帧角度转：第 34 帧到底 = gripPulled
  const axis = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(L.facing[0], L.facing[2]));
  const gripAt = (t) =>
    new THREE.Vector3(...L.gripRest)
      .sub(new THREE.Vector3(...L.pivot))
      .applyAxisAngle(axis, AL.pullSign * THREE.MathUtils.degToRad(igniteLeverAngleAt(t)))
      .add(new THREE.Vector3(...L.pivot))
      .toArray();
  near3(gripAt(0), L.gripRest, 1e-6, '第 0 帧握点');
  assert.ok(Math.abs(igniteLeverAngleAt(22 / 30)) < 1e-9 && igniteLeverAngleAt(23 / 30) > 0, 'pullStart 第 22 帧后才动');
  assert.ok(Math.abs(igniteLeverAngleAt(34 / 30) - 60) < 1e-9, '第 34 帧到底 60°');
  near3(gripAt(34 / 30), L.gripPulled, 0.002, '第 34 帧握点 = 拉到底');
  assert.ok(Math.abs(xiActionTiming('xi-ignite-lever').markerSec - 34 / 30) < 1e-9, 'lighthouse:ignited 在 1.133 s');
  // 与纸条：枢轴到纸条、-interact 到 ignition-note-read 都 ≥ 1.5 m（制作人 2026-10-29）
  const dPivot = new THREE.Vector3(...L.pivot).distanceTo(new THREE.Vector3(...S3.points.noteRead));
  const dIx = new THREE.Vector3(...L.interact).distanceTo(new THREE.Vector3(...S3.points.noteRead));
  assert.ok(dPivot >= 1.5 && dIx >= 1.5, `拉杆离纸条太近：枢轴 ${dPivot.toFixed(2)} m / 交互点 ${dIx.toFixed(2)} m`);
  out.push(`拉杆 −60° 逐帧转动：第 34 帧握点到底 ✓；拉杆 ↔ 纸条 枢轴 ${dPivot.toFixed(2)} m / 交互点 ${dIx.toFixed(2)} m（≥ 1.5）✓`);
}

// ---- 点灯独白 ch1.s3.ignite.mono（text-ch1 §5 0:00：ignited 后 0.5 s、3.0 s、只一次、锁定；0:04 切远景前消失）
{
  const ID = 'ch1.s3.ignite.mono';
  assert.equal(text(ID), '亮了。……爸爸，回家吧。');
  assert.equal(textMeta(ID).once, true, `${ID} 应只一次`);
  assert.equal(IGNITE_MONO_DELAY, 0.5);
  assert.equal(IGNITE_MONO_SEC, 3.0);
  assert.equal(OUTRO_CUT_SEC, 4.0);
  assert.ok(IGNITE_MONO_DELAY + IGNITE_MONO_SEC < OUTRO_CUT_SEC, `独白 ${IGNITE_MONO_DELAY}+${IGNITE_MONO_SEC} s 必须在 0:04 切远景前结束`);
  // 与 puzzles.startOutro / stepOutro 同一套调用：时间轴字幕按 1/60 s 步进
  const seen = new Set();
  const track = new SubtitleTrack({ hasSeen: (id) => seen.has(id), markSeen: (id) => seen.add(id) });
  const shownAt = [];
  track.setTimeline([{ at: IGNITE_MONO_DELAY, id: ID, duration: IGNITE_MONO_SEC }]);
  let first = -1;
  let last = -1;
  for (let i = 0; i <= OUTRO_CUT_SEC * 60; i++) {
    const tt = i / 60;
    const line = track.playAt(tt);
    if (line) {
      if (first < 0) first = tt;
      last = tt;
      assert.equal(line.locked, true, '点灯独白应锁定');
      assert.equal(track.advance(), false, '点灯独白不可点掉');
      shownAt.push(tt);
    }
  }
  track.endTimeline();
  assert.ok(Math.abs(first - 0.5) < 1 / 60 + 1e-9, `独白应在 0.5 s 出现（实际 ${first}）`);
  assert.ok(last < OUTRO_CUT_SEC && last >= 3.5 - 1 / 30, `独白应在 3.5 s 消失（最后显示 ${last}）`);
  assert.ok(seen.has(ID), '显示后记为已看过（只一次）');
  out.push(`点灯独白 ${ID}：ignited 后 ${first.toFixed(2)}–${(last + 1 / 60).toFixed(2)} s 锁定显示、不可点掉、只一次；0:04 切远景前已消失 ✓`);
}

// ---- 4c. 第 3 批道具美术（1030c）：真实 GLB 挂到 S3 局部的 interior 环境 socket 上，对白盒
const art3 = await (async () => {
  globalThis.self ??= globalThis;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
  const load = async (rel) => {
    const f = new URL(`../../art/models/${rel}`, import.meta.url);
    if (!existsSync(f)) return null;
    const buf = readFileSync(f);
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    return g.scene;
  };
  const { mountArtSlots, findNode, snapToArt, snapObjectTo } = await import('@/levels/artSlots');
  const { S3_ART_SLOTS } = await import('@/levels/s3/artSlots');
  return { load, mountArtSlots, findNode, snapToArt, snapObjectTo, S3_ART_SLOTS, interior: await load('env/env-lighthouse-ch1-interior.glb') };
})();
const art3Mount = (key, model, extra) => {
  const loc = new THREE.Group();
  loc.add(art3.interior.clone(true));
  for (const o of extra ?? []) loc.add(o);
  loc.updateMatrixWorld(true);
  const spec = art3.S3_ART_SLOTS.find((x) => x.key === key);
  const slots = art3.mountArtSlots({ has: (x) => x === key, getModel: () => model }, loc, [spec]);
  loc.updateMatrixWorld(true);
  return { loc, slots };
};
const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const wz = (o) => new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);

// 4c-1 油阀 prop-oil-valve-s3：根 = 手轮中心 = socket；手轮轴 +Z 朝塔心 = 白盒；开阀 +90° 绕 +Z；-interact = 白盒站位（正前 0.40 m 地面）
{
  const model = await art3.load('props/prop-oil-valve-s3.glb');
  if (!model || !art3.interior) out.push('油阀美术未交付');
  else {
    // 白盒油阀（同 puzzles.ts：组朝塔心、手轮 oil-valve-s3-wheel 绕本地 Z 转 wheelSpin·90°）
    const [vx, vy, vz] = S3.points.oilValve;
    const valve = new THREE.Group();
    valve.name = 'oil-valve-s3';
    valve.position.set(vx, vy, vz);
    valve.rotation.y = Math.atan2(-vx, -vz);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24));
    wheel.name = 'oil-valve-s3-wheel';
    valve.add(wheel);
    const { loc, slots } = art3Mount('prop-oil-valve-s3', model, [valve]);
    assert.equal(slots.mounted.length, 1, '油阀挂上');
    assert.deepEqual(slots.mounted[0].missingNodes, []);
    assert.equal(model.parent.name, 'oil-valve-s3-socket', '油阀挂 interior oil-valve-s3-socket');
    const aw = art3.findNode(model, 'valve-wheel');
    near3(wp(aw).toArray(), S3.points.oilValve, 1e-3, '美术手轮中心 = S3.points.oilValve');
    const toC = new THREE.Vector3(-vx, 0, -vz).normalize();
    const axDeg = (wz(aw).angleTo(toC) * 180) / Math.PI;
    assert.ok(axDeg < 0.5, `美术手轮轴朝塔心（差 ${axDeg.toFixed(3)}°）`);
    assert.ok((wz(wheel).angleTo(wz(aw)) * 180) / Math.PI < 0.5, '白盒手轮轴 = 美术手轮轴');
    // 开阀：白盒 wheelSpin 0 → 1 = rotation.z 0 → +π/2；美术 valve-wheel 跟着绕自身 +Z 转 +90°
    const spoke0 = new THREE.Vector3(1, 0, 0).transformDirection(aw.matrixWorld);
    wheel.rotation.z = Math.PI / 2;
    loc.updateMatrixWorld(true);
    slots.update();
    loc.updateMatrixWorld(true);
    const spoke1 = new THREE.Vector3(1, 0, 0).transformDirection(aw.matrixWorld);
    const ax = wz(aw);
    const turn = (Math.atan2(new THREE.Vector3().crossVectors(spoke0, spoke1).dot(ax), spoke0.dot(spoke1)) * 180) / Math.PI;
    assert.ok(Math.abs(turn - 90) < 0.1, `开阀美术手轮绕 +Z 转 ${turn.toFixed(2)}°（应 +90°）`);
    const rootX = model.children.find((o) => o.userData.puzzle || o.userData.originAt)?.userData ?? model.userData;
    const openDeg = art3.findNode(model, 'valve-wheel').userData.openDeg ?? rootX.openDeg;
    assert.equal(Number(openDeg), 90, '美术 openDeg 90');
    // 站位：美术 -interact = 白盒 vStand（S3 局部；正前 0.40 m、地面）
    const ix = wp(art3.findNode(model, 'prop-oil-valve-s3-interact'));
    const r0 = Math.hypot(vx, vz);
    const vStand = new THREE.Vector3(vx * (1 - 0.4 / r0), S3.groundFloorY, vz * (1 - 0.4 / r0));
    const dStand = ix.distanceTo(vStand);
    assert.ok(dStand < 0.02, `油阀美术 -interact 离白盒站位 ${dStand.toFixed(3)} m`);
    const stand = new THREE.Object3D();
    loc.add(stand);
    assert.ok(art3.snapToArt(slots, 'prop-oil-valve-s3', 'prop-oil-valve-s3-interact', stand), 'valveStand 对到美术 -interact');
    near3(wp(stand).toArray(), ix.toArray(), 1e-6, 'valveStand = 美术 -interact');
    out.push(`油阀：挂 oil-valve-s3-socket、手轮轴朝塔心（差 ${axDeg.toFixed(2)}°）、开阀美术手轮 +${turn.toFixed(1)}° 绕 +Z（白盒改为同向 +90°）、-interact 离白盒站位 ${(dStand * 100).toFixed(1)} cm（站位读美术） ✓`);
  }
}

// 4c-2 窗口镜 prop-guide-mirror-window-s3：挂白盒组 guide-mirror-s3-window，-mirror-plane 对齐、mirror-yaw / mirror-pitch 拷白盒；正解 / 逐档法线 = 白盒；-interact = 白盒站位 (1.45, 0.2, 0)
{
  const key = 'prop-guide-mirror-window-s3';
  const model = await art3.load(`props/${key}.glb`);
  if (!model) out.push('窗口镜美术未交付');
  else {
    const spec = art3.S3_ART_SLOTS.find((x) => x.key === key);
    const rig = beam.mirrors.window;
    const rootX = model.children.find((o) => o.userData.puzzle)?.userData ?? {};
    beam.solve();
    frameRoot.updateMatrixWorld(true);
    const slots = art3.mountArtSlots({ has: (x) => x === key, getModel: () => model }, frameRoot, [spec]);
    assert.equal(slots.mounted.length, 1, '窗口镜挂上');
    assert.deepEqual(slots.mounted[0].missingNodes, [], '窗口镜约定节点齐');
    assert.equal(model.parent, rig.root, '窗口镜挂白盒组');
    const plane = art3.findNode(model, 'mirror-plane');
    const yawGb = art3.findNode(rig.root, 'guide-mirror-s3-window-yaw');
    const pitchGb = art3.findNode(rig.root, 'guide-mirror-s3-window-pitch');
    const check = (tag) => {
      slots.update();
      frameRoot.updateMatrixWorld(true);
      const d = wp(plane).distanceTo(wp(rig.plane));
      assert.ok(d < 1e-3, `窗口镜 ${tag} 镜心对齐 ${d}`);
      const a = (wz(plane).angleTo(wz(rig.plane)) * 180) / Math.PI;
      assert.ok(a < 0.01, `窗口镜 ${tag} 镜面法线 = 白盒（差 ${a.toFixed(4)}°）`);
      return { d, a };
    };
    const sol = check('正解');
    const yawDeg = (yawGb.rotation.y * 180) / Math.PI;
    const pitchDeg = (pitchGb.rotation.x * 180) / Math.PI;
    const ay = art3.findNode(model, 'mirror-yaw');
    const ap = art3.findNode(model, 'mirror-pitch');
    assert.ok(ay.quaternion.angleTo(yawGb.quaternion) < 1e-6 && ap.quaternion.angleTo(pitchGb.quaternion) < 1e-6, '窗口镜 yaw / pitch 直接拷白盒');
    near3(toLocal(wp(plane)).toArray(), rootX.mirrorCenterS3, 1e-3, '窗口镜镜心 = 美术 mirrorCenterS3');
    // 正解光路：L0 → 美术镜面反射 → A
    const at = wp(plane);
    const inDir = at.clone().sub(toWorld(S3.lightPath[0])).normalize();
    const n = wz(plane);
    const outDir = inDir.clone().sub(n.clone().multiplyScalar(2 * inDir.dot(n)));
    const miss = rayPointDist(at, outDir, toWorld(S3.lightPath[2]));
    let steps = 0;
    for (let y = 0; y < 360; y += 15) {
      for (const pd of [S3_BEAM.windowPitchRange[0], 0, S3_BEAM.windowPitchRange[1]]) {
        rig.part.setAngle(0, y);
        rig.part.setAngle(1, pd);
        check(`${y}° / ${pd}°`);
        steps++;
      }
    }
    beam.reset();
    check('初始');
    const ix = wp(art3.findNode(model, 'interact'));
    const dStand = ix.distanceTo(toWorld([1.45, S3.groundFloorY, 0]));
    assert.ok(dStand < 0.02, `窗口镜 -interact 离白盒站位 ${dStand.toFixed(3)} m`);
    const ixF = new THREE.Vector3(0, 0, 1).applyQuaternion(art3.findNode(model, 'interact').getWorldQuaternion(new THREE.Quaternion()));
    const toMirror = toWorld(rig.center.toArray()).sub(ix).setY(0).normalize();
    assert.ok(ixF.angleTo(toMirror) < 0.05, '窗口镜 -interact +Z 朝镜子');
    beam.solve();
    slots.update();
    model.removeFromParent();
    for (const m of rig.root.children) m.traverse((o) => o.isMesh && (o.visible = true));
    out.push(`窗口镜：挂白盒组、yaw / pitch 直接拷白盒（美术计划法线 ${ay.userData.plannedYawDeg}° / ${ap.userData.plannedPitchDeg}° = 白盒正解法线；节点角 yaw ${yawDeg.toFixed(2)}° / pitch ${pitchDeg.toFixed(2)}°）、正解 + ${steps} 个档位组合美术法线 = 白盒（镜心差 ${(sol.d * 1000).toFixed(2)} mm）、正解美术镜面反射离 A ${(miss * 1000).toFixed(1)} mm、-interact 离白盒站位 ${(dStand * 100).toFixed(1)} cm 且朝镜（站位读美术） ✓`);
  }
}

// 4c-3 点火口 + 拉杆 prop-ignition-port-s3：挂 lamp-room ignition-port-s3-socket（翻转）、-receiver 对齐白盒受光点；拉杆 delta 跟白盒 swing，第 34 帧 = −60° 握点到底；
//      glowNodes（透镜 + 观察窗）共用一份克隆材质，四态跟白盒透镜；白盒透镜 / 拉杆隐藏；-interact = 白盒拉杆站位
{
  const key = 'prop-ignition-port-s3';
  const model = await art3.load(`props/${key}.glb`);
  const room = await art3.load('env/env-lamp-room-ch1.glb');
  if (!model || !room) out.push('点火口美术未交付');
  else {
    const { XI_IGNITE_LEVER_ALIGN: AL, igniteLeverAngleAt } = await import('@/entities/xiActions');
    const { gameplay } = await import('@/config/gameplay');
    const L = S3.igniteLever;
    // 白盒（同 puzzles.ts / beam.ts）：受光点 + 透镜球（四态材质）+ 拉杆组 / swing
    const loc = new THREE.Group();
    loc.add(room);
    const receiver = new THREE.Object3D();
    receiver.name = 'ignition-port-s3-receiver';
    receiver.position.set(...S3.points.ignitionPort);
    const lensMat = new THREE.MeshStandardMaterial();
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12), lensMat);
    lens.name = 'ignition-port-s3-lens';
    lens.position.set(...S3.points.ignitionPort);
    const standYaw = Math.atan2(L.facing[0], L.facing[2]);
    const lever = new THREE.Group();
    lever.name = 'ignite-lever-s3';
    lever.position.set(...L.pivot);
    lever.rotation.y = standYaw;
    const swing = new THREE.Group();
    swing.name = 'ignite-lever-s3-swing';
    lever.add(swing);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045));
    knob.position.copy(new THREE.Vector3(...L.gripRest).sub(new THREE.Vector3(...L.pivot)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -standYaw));
    swing.add(knob);
    loc.add(receiver, lens, lever);
    loc.updateMatrixWorld(true);
    const spec = art3.S3_ART_SLOTS.find((x) => x.key === key);
    const slots = art3.mountArtSlots({ has: (x) => x === key, getModel: () => model }, loc, [spec]);
    loc.updateMatrixWorld(true);
    assert.equal(slots.mounted.length, 1, '点火口挂上');
    assert.deepEqual(slots.mounted[0].missingNodes, [], '点火口约定节点 / 发光材质齐');
    assert.equal(model.parent.name, 'ignition-port-s3-socket', '点火口挂 lamp-room ignition-port-s3-socket');
    const dRecv = wp(art3.findNode(model, 'receiver')).distanceTo(wp(receiver));
    assert.ok(dRecv < 1e-4, `点火口 -receiver 对齐白盒受光点 ${dRecv}`);
    near3(wp(art3.findNode(model, 'ignition-glow-lens')).toArray(), [0, 21.83, 0], 0.03, '透镜在受光点下方（朝下）');
    assert.ok(!lens.visible && !knob.visible, '白盒透镜球 / 拉杆隐藏');
    // 拉杆：美术枢轴 = 白盒枢轴；握点（美术 gripRestS3 换到 ignite-lever 局部）跟 swing 走，第 34 帧到 gripPulled
    const al = art3.findNode(model, 'ignite-lever');
    near3(wp(al).toArray(), L.pivot, 1e-3, '美术拉杆枢轴 = S3 (0.9, 22.74, 0)');
    near3(al.userData.gripRestS3, L.gripRest, 0.002, '美术静止握点 = 白盒');
    near3(al.userData.gripPulledS3, L.gripPulled, 0.002, '美术拉到底握点 = 白盒');
    const gripLocal = al.worldToLocal(new THREE.Vector3(...L.gripRest));
    const gripAt = (t) => {
      swing.rotation.x = AL.pullSign * THREE.MathUtils.degToRad(igniteLeverAngleAt(t));
      loc.updateMatrixWorld(true);
      slots.update();
      loc.updateMatrixWorld(true);
      return al.localToWorld(gripLocal.clone());
    };
    let dMax = 0;
    for (let f = 0; f <= 46; f++) dMax = Math.max(dMax, gripAt(f / 30).distanceTo(knob.getWorldPosition(new THREE.Vector3())));
    const g34 = gripAt(34 / 30);
    assert.ok(g34.distanceTo(new THREE.Vector3(...L.gripPulled)) < 0.002, `第 34 帧美术握点到底 ${g34.toArray().map((x) => x.toFixed(3))}`);
    assert.ok(dMax < 0.002, `逐帧美术握点 = 白盒握点（最大差 ${dMax}）`);
    gripAt(34 / 30);
    const q34 = al.quaternion.clone();
    gripAt(0);
    const turnDeg = (q34.angleTo(al.quaternion) * 180) / Math.PI;
    assert.ok(Math.abs(turnDeg - 60) < 0.05, `第 34 帧美术拉杆转 ${turnDeg.toFixed(2)}°`);
    // 四态：白盒透镜材质 → 美术 glowNodes（共用一份克隆，原材质不改）
    const glowMeshes = [];
    model.traverse((o) => o.isMesh && o.material?.name === 'mat-prop-ignition-glow' && glowMeshes.push(o));
    assert.deepEqual(glowMeshes.map((m) => m.name).sort(), ['ignition-glow-lens', 'ignition-glow-sight']);
    assert.ok(glowMeshes[0].material === glowMeshes[1].material, '透镜 / 观察窗同一材质');
    const P = gameplay.beam.igniterPort;
    const states = { off: [0x000000, 0], noOil: [P.noOil, P.noOilIntensity], coldLo: [P.cold, P.coldBreath[0]], coldHi: [P.cold, P.coldBreath[1]], pulse: [P.cold, P.pulsePeak], lit: [P.lit, P.litIntensity] };
    const artHex = { noOil: 0xc8382a, cold: 0xdce6ee, lit: 0xffb25e };
    assert.ok(P.noOil === artHex.noOil && P.cold === artHex.cold && P.lit === artHex.lit && P.noOilIntensity === 0.6 && P.litIntensity === 2 && P.coldBreath[0] === 0.15 && P.coldBreath[1] === 0.35 && P.coldPeriodSec === 4, '白盒四态 = 美术材质 extras');
    for (const [st, [hex, k]] of Object.entries(states)) {
      lensMat.emissive.setHex(hex);
      lensMat.emissiveIntensity = k;
      slots.update();
      for (const m of glowMeshes) assert.ok(m.material.emissive.getHex() === hex && m.material.emissiveIntensity === k, `四态 ${st}：${m.name}`);
    }
    // 站位
    const ixN = art3.findNode(model, 'prop-ignition-port-s3-interact');
    const dStand = wp(ixN).distanceTo(new THREE.Vector3(...L.interact));
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(ixN.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(dStand < 0.01 && fwd.angleTo(new THREE.Vector3(...L.facing)) < 0.01, `点火口 -interact 离白盒站位 ${dStand.toFixed(3)} m、朝 −X`);
    out.push(`点火口 + 拉杆：挂 ignition-port-s3-socket、-receiver 对齐白盒受光点（差 ${(dRecv * 1000).toFixed(2)} mm）；拉杆枢轴 / 握点 = 白盒，逐帧握点差 ≤ ${(dMax * 1000).toFixed(2)} mm，第 34 帧转 ${turnDeg.toFixed(1)}° 到底；透镜 + 观察窗共用克隆材质，四态（关 / 红 0.6 / 冷白 0.15–0.35 + 脉冲 / 暖 2.0）跟白盒透镜；白盒透镜球 / 拉杆隐藏；-interact = 白盒站位（站位读美术） ✓`);
  }
}

// 4c-4 塔门 prop-lighthouse-door-s3：buildS3Art 优先它、挂白盒合页；door-leaf 原点 = 合页；-interact 跟门转 → 关门时缓存给 doorStand = 白盒站位；开 −100° 后缓存不动
{
  const key = 'prop-lighthouse-door-s3';
  const model = await art3.load(`props/${key}.glb`);
  if (!model) out.push('塔门美术未交付');
  else {
    const { buildS3Art, S3_DOOR_KEYS } = await import('@/levels/s3/art');
    assert.equal(S3_DOOR_KEYS[0], key, '塔门美术 key 优先');
    const art = buildS3Art({ has: (k) => k === key, getModel: () => model });
    assert.ok(art.door && art.door.name === key, 'buildS3Art 用 prop-lighthouse-door-s3');
    gb.door.add(art.door);
    frameRoot.updateMatrixWorld(true);
    const leaf = art3.findNode(art.door, 'door-leaf');
    const dHinge = wp(leaf).distanceTo(toWorld(S3.door.hinge));
    assert.ok(dHinge < 1e-3, `door-leaf 原点 = 合页 ${dHinge}`);
    const ixN = art3.findNode(art.door, 'prop-lighthouse-door-s3-interact');
    const stand = new THREE.Object3D();
    gb.root.add(stand);
    assert.ok(art3.snapObjectTo(ixN, stand), '关门时缓存 -interact');
    const dStand = wp(stand).distanceTo(toWorld(alongDoor(4.7, 0, S3.door.y0)));
    assert.ok(dStand < 0.02, `塔门 -interact 离白盒站位 ${dStand.toFixed(3)} m`);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(stand.getWorldQuaternion(new THREE.Quaternion()));
    const toDoor = toWorld(alongDoor(3.5, 0, S3.door.y0)).sub(wp(stand)).setY(0).normalize();
    assert.ok(fwd.angleTo(toDoor) < 0.02, '塔门站位 +Z 朝门');
    const cached = wp(stand);
    const kh0 = wp(art3.findNode(art.door, 'door-keyhole'));
    // 开门 −100°（白盒 puzzles 同式）
    gb.door.rotation.y = S3.door.hingeRotY + S3.door.openDeg * (Math.PI / 180);
    frameRoot.updateMatrixWorld(true);
    const moved = wp(ixN).distanceTo(cached);
    assert.ok(moved > 1, `开门后美术 -interact 跟门转走 ${moved.toFixed(2)} m`);
    assert.ok(wp(stand).distanceTo(cached) < 1e-9, '缓存的站位不动');
    const yawOf = (o) => new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    gb.door.rotation.y = S3.door.hingeRotY;
    frameRoot.updateMatrixWorld(true);
    const y0 = yawOf(leaf);
    gb.door.rotation.y = S3.door.hingeRotY + S3.door.openDeg * (Math.PI / 180);
    frameRoot.updateMatrixWorld(true);
    const openDeg = THREE.MathUtils.radToDeg(Math.atan2(Math.sin(yawOf(leaf) - y0), Math.cos(yawOf(leaf) - y0)));
    assert.ok(Math.abs(openDeg - -100) < 0.01 && leaf.userData.openDeg === -100, `门扇开 ${openDeg.toFixed(2)}°（美术 openDeg ${leaf.userData.openDeg}）`);
    // 向内开：开门后门扇中心在塔内一侧（离塔心更近）
    const c0 = toLocal(kh0);
    const c1 = toLocal(wp(art3.findNode(art.door, 'door-keyhole')));
    assert.ok(Math.hypot(c1.x, c1.z) < Math.hypot(c0.x, c0.z), '门向内开');
    gb.door.rotation.y = S3.door.hingeRotY;
    art.door.removeFromParent();
    stand.removeFromParent();
    frameRoot.updateMatrixWorld(true);
    out.push(`塔门：buildS3Art 优先 prop-lighthouse-door-s3、door-leaf 原点 = 合页（差 ${(dHinge * 1000).toFixed(2)} mm）；关门时缓存 -interact → doorStand（离白盒站位 ${(dStand * 100).toFixed(1)} cm、朝门），开门后美术点跟门走 ${moved.toFixed(2)} m、缓存不动；门扇向内开 ${openDeg.toFixed(1)}° ✓`);
  }
}

// 017 收尾：塔内不淋湿（s3-tower-indoor，y 0–24.5）
{
  const vols = collectIndoorVolumes(gb.root);
  assert.ok(vols.length >= 1, 'S3 塔内体积');
  for (const y of [0.05, 8, 20]) assert.equal(xiWetTarget(true, toWorld([0.5, y, 0.5]), vols), 0, `塔内 y ${y} 不淋湿`);
  const [sx, sy, sz] = S3.points.spawnFromS2;
  assert.equal(xiWetTarget(true, { x: sx, y: sy, z: sz }, vols), 1, '塔外（从 S2 过来的出生点）淋湿');
  assert.equal(xiWetTarget(true, toWorld([0, 0.05, -S3.tower.rBase - 1.5]), vols), 1, '塔门外淋湿');
  out.push('室内判定：塔内一层 / 中段 / 顶层不淋湿、塔外淋湿 ✓');
}

for (const l of out) console.log(`✓ ${l}`);
console.log('verify-s3 通过');
