// v0.1-015 S3 白盒自检（node，无浏览器）：布局 ↔ 美术 020（s3-layout.json + GLB 空节点，≤ 5 cm）、世界朝向、
// 踏步几何、谜题 5 光路（正解 / 唯一解 / 不被楼梯和 5 m 平台挡）、机位框得住目标、碰撞白盒动线
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { S3, S3_FRAME, toWorld, toLocal, treadSpan, treadTop, cameraYawFacing, alongDoor } from '@/levels/s3/layout';
import { bearingFrom } from '@/levels/s1/layout';
import { buildS3Greybox, defaultS3GreyboxMaterials } from '@/levels/s3/greybox';
import { buildS3Beam, S3_BEAM, rayPointDist } from '@/levels/s3/beam';
import { PhysicsSystem, CharacterBody } from '@/systems/PhysicsSystem';

const out = [];
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
  out.push(`光路：正解 窗口镜 ${sol.windowYaw}/${sol.windowPitch}、导光镜 1 ${sol.a}、导光镜 2 ${sol.b} → 点火口（光线离口心 ${miss.toFixed(3)} m）；法线 窗 ${nw.yaw.toFixed(1)}/${nw.pitch.toFixed(1)}、A ${na.yaw.toFixed(2)}、B ${nb.yaw.toFixed(2)}（美术 −19.777 / 160.755）；7.5° 穷举唯一解 ✓；离楼梯内沿余量 ${minR.toFixed(2)} m；机位 ${camLines.join(' / ')} 框得住目标 ✓`);
  // 塔外冷光预告：停在礁石挡光块上
  const pv = tr.paths.find((q) => q.emitter.id === 'sky-preview-s3');
  const pt = toLocal(pv.endPoint);
  assert.ok(pv.end === 'blocker' && pt.distanceTo(new THREE.Vector3(...S3.points.skyPreviewTarget)) < 0.5, `天光预告应落在礁石 ${S3.points.skyPreviewTarget}，实际 ${pv.end} ${pt.toArray().map((v) => v.toFixed(2))}`);
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

for (const l of out) console.log(`✓ ${l}`);
console.log('verify-s3 通过');
