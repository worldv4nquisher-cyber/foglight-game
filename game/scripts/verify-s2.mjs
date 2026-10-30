// v0.1-014 S2 白盒自检（node，无浏览器）：布局数值（观察点距离 / 远景方位）+ 碰撞白盒动线（纯 PhysicsSystem 走路）
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { S2, S2_FAR, s2ToWorld, worldToS2, farthestStoneDistance } from '@/levels/s2/layout';
import { bearingFrom, S1 } from '@/levels/s1/layout';
import { buildS2Greybox } from '@/levels/s2/greybox';
import { collectIndoorVolumes } from '@/systems/CameraFollowSystem';
import { xiWetTarget } from '@/entities/xi/XiLook';
import { PhysicsSystem, CharacterBody } from '@/systems/PhysicsSystem';
import { buildS2Beam, S2_BEAM } from '@/levels/s2/beam';

const out = [];
// ---- 布局
const d = farthestStoneDistance();
assert.ok(d <= 25, `观察点到最远白石 ${d.toFixed(2)} m > 25 m`);
const spawnW = s2ToWorld(S2.spawn);
assert.ok(Math.hypot(spawnW.x - S1.exitToS2[0], spawnW.z - S1.exitToS2[2]) < 1e-6, 'S2 入口应落在 S1 出口的世界平面位置');
assert.ok(worldToS2(spawnW.toArray()).distanceTo(new THREE.Vector3(...S2.spawn)) < 1e-9, 'worldToS2 ∘ s2ToWorld 应为恒等');
const far = bearingFrom(S2.house.center, S2_FAR.tower.position.toArray());
assert.ok(far.azimuthDeg > 300 && far.azimuthDeg < 330, `S3 灯塔应在小屋西北，方位 ${far.azimuthDeg.toFixed(1)}°`);
out.push(`最远白石 ${d.toFixed(2)} m、S3 灯塔方位 ${far.azimuthDeg.toFixed(1)}° / ${far.distance.toFixed(1)} m`);

// ---- 动线
const gb = buildS2Greybox();
const ph = new PhysicsSystem();
const cols = new Map();
for (const m of gb.colliders) cols.set(m, ph.addMesh(m));
for (const m of gb.walls) ph.addMesh(m, { kind: 'wall' });
const names = new Set();
gb.root.traverse((o) => {
  if (!o.name) return;
  assert.ok(!names.has(o.name) || o.name === '', `白盒节点重名 ${o.name}`);
  names.add(o.name);
});
assert.ok(names.has('viewpoint-s2') && names.has('white-stones-s2') && names.has('s2-house-indoor'), '缺 viewpoint-s2 / white-stones-s2 / -indoor');

function walk(pts, y0 = 0) {
  const b = new CharacterBody();
  ph.addBody(b);
  b.teleport(new THREE.Vector3(pts[0][0], y0 + 0.05, pts[0][1]));
  for (let i = 0; i < 30; i++) ph.step(1 / 60);
  for (const [x, z] of pts.slice(1)) {
    let t = 0;
    while (Math.hypot(b.position.x - x, b.position.z - z) > 0.3 && t < 20) {
      const v = new THREE.Vector3(x - b.position.x, 0, z - b.position.z).normalize().multiplyScalar(2.5);
      b.velocity.x = v.x;
      b.velocity.z = v.z;
      ph.step(1 / 60);
      t += 1 / 60;
    }
    if (t >= 20) {
      ph.removeBody(b);
      return { ok: false, at: b.position.clone(), to: [x, z] };
    }
  }
  ph.removeBody(b);
  return { ok: true, at: b.position.clone() };
}
const must = (name, r, y) => {
  assert.ok(r.ok, `${name}：走不到 ${JSON.stringify(r.to)}，停在 ${r.at?.toArray().map((v) => v.toFixed(2))}`);
  if (y !== undefined) assert.ok(Math.abs(r.at.y - y) < 0.05, `${name}：终点高度 ${r.at.y.toFixed(2)} ≠ ${y}`);
};
// ---- 谜题 3 光路（白盒碰撞 + 灯台 / 镜座 / 锁框）：光高 0.85 ± 3 cm、唯一解、西灯台被晾衣架挡
const beam = buildS2Beam(ph);
{
  const near = (v, what) => assert.ok(Math.abs(v - S2.beamY) <= 0.03, `${what} 高度 ${v.toFixed(3)} 与光路平面 ${S2.beamY} 差 > 3 cm`);
  near(S2.lampEmitY, '灯台出光');
  near(beam.lamps.east.emitter.origin(new THREE.Vector3()).y, '东灯台 -emitter');
  near(beam.mirrorA.center.y, '镜 A 镜心');
  near(beam.mirrorB.center.y, '镜 B 镜心');
  near(beam.lock.center(new THREE.Vector3()).y, '光感锁 -receiver');
  near(beam.lockLens.position.y, '光感锁透镜');
  const tr = beam.tracer;
  const east = () => tr.paths.find((p) => p.emitter.id === 'lamp-east-s2');
  const hits = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      beam.mirrorA.part.setAngle(0, i * S2_BEAM.stepDeg);
      beam.mirrorB.part.setAngle(0, j * S2_BEAM.stepDeg);
      tr.trace();
      if (east().receiver?.id === 'light-lock-s2') hits.push([i * 15, j * 15]);
    }
  }
  assert.deepEqual(hits, [[S2_BEAM.solution.a, S2_BEAM.solution.b]], `24 × 24 档里应只有正解命中光感锁，实际 ${JSON.stringify(hits)}`);
  beam.solve();
  tr.trace();
  const p = east();
  assert.deepEqual(p.mirrors, ['mirror-stand-s2-a', 'mirror-stand-s2-b'], '正解光路应依次经过镜 A、镜 B');
  for (const sg of p.segments) for (const v of [sg.from, sg.to]) assert.ok(Math.abs(v.y - S2.beamY) <= 0.03, `光路离开 0.85 平面：${v.y.toFixed(3)}`);
  const lens = beam.lock.center(new THREE.Vector3());
  const miss = p.endPoint.distanceTo(lens);
  // 初始 0° / 0°：不命中
  beam.mirrorA.part.reset();
  beam.mirrorB.part.reset();
  tr.trace();
  assert.ok(east().receiver === null, '初始角度不应命中光感锁');
  // 西灯台：任意镜子角度都在晾衣架上停住
  for (const [i, j] of [[0, 0], [30, 315], [90, 90]]) {
    beam.mirrorA.part.setAngle(0, i);
    beam.mirrorB.part.setAngle(0, j);
    tr.trace();
    const w = tr.paths.find((q) => q.emitter.id === 'lamp-west-s2');
    assert.ok(w.end === 'blocker' && w.mirrors.length === 0 && Math.abs(w.endPoint.z - (S2.rack.at[2] - S2.rack.halfZ)) < 0.05, `西灯台应被晾衣架挡在 z ${S2.rack.at[2] - S2.rack.halfZ}，实际 ${w.end} z ${w.endPoint.z.toFixed(2)}`);
  }
  beam.mirrorA.part.reset();
  beam.mirrorB.part.reset();
  out.push(`光路：灯 ${S2.lampEmitY} / 镜 ${beam.mirrorA.center.y} / 锁 ${lens.y}，24×24 档唯一解 A ${S2_BEAM.solution.a}° B ${S2_BEAM.solution.b}°（落点离锁心 ${miss.toFixed(2)} m），西灯台被晾衣架挡 ✓`);
}

const vp = S2.viewpoint.eye;
must('入口 → 正门 → 楼梯 → 二层观察点', walk([[0, -12.5], [-4.1, -4], [-4.1, -2.5], [-4.1, -1.0], [-3.3, -0.97], [1.0, -0.97], [1.0, 0.3], [vp[0], vp[2]]]), S2.house.upperFloorY);
must('二层 → 书桌站位', walk([[1.0, 0.0], [S2.points.deskInteract[0], S2.points.deskInteract[2]]], 3), S2.house.upperFloorY);
// 拨盘铁门关着：门洞走不过去
const gateShut = walk([[4.2, 10.6], [4.2, 14]]);
assert.ok(!gateShut.ok && gateShut.at.z < 11.7, '拨盘铁门关着时不应过得去');
cols.get(gb.dialGateLeaf).enabled = false;
const shut = walk([[0, -12.5], [3.5, -5], [3.5, 5], [0.62, 5], [0.62, 3.2]]);
assert.ok(!shut.ok && shut.at.z > 3.9, '地窖门关着时不应进得去');
cols.get(gb.cellarDoorLeaf).enabled = false;
must('地窖门开 → 石阶 → 地窖木架前', walk([[0.62, 5], [0.62, 3.2], [0.8, 0.3], [-1.5, 1.5]]), S2.cellar.floorY);
cols.get(gb.cellarDoorLeaf).enabled = true;
must('入口 → 院门 → 院子 → 北口 → 铁门洞 → 崖径出口', walk([[0, -12.5], [-9, -10], [-9, -7], [-11, -4], [-11, 0], [-8, 6], [-7.8, 10.2], [4.2, 10.8], [4.2, 14], [S2.exitToS3[0], S2.exitToS3[2]]]), 0);
cols.get(gb.dialGateLeaf).enabled = true;
must('西侧坡地（白石区）', walk([[0, -12.5], [5, -6], [15, 0], [21, -0.8]]));
const back = walk([[0, -12.5], [0, -16]]);
assert.ok(!back.ok && back.at.z > -14, '南石阶应挡住回头路');
out.push('动线：二层观察点 / 书桌 / 地窖（门开才进得去）/ 院子 → 拨盘铁门（开了才过得去）→ 出口 / 坡地 ✓，南石阶挡回头路 ✓');
// 和美术布局表核对（art/source/env/s2-layout.json，2026-10-29 返工版）：白盒这些点照美术节点，差 > 1 cm 就报
{
  const { readFileSync, existsSync } = await import('node:fs');
  const f = new URL('../../art/source/env/s2-layout.json', import.meta.url);
  if (existsSync(f)) {
    const art = JSON.parse(readFileSync(f, 'utf8'));
    const P = art.points;
    const near = (a, b, tag) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= 0.01), `${tag} 与美术布局不一致：白盒 ${a} / 美术 ${b}`);
    near([...S2.points.deskInteract], P.deskInteract, 'deskInteract');
    near([...S2.points.cellarKey], P.cellarKey, 'cellarKey');
    near([...S2.points.cellarSketch], P.cellarSketch, 'cellarSketch');
    near([...S2.points.cellarShelfInteract], P.cellarShelfInteract, 'cellarShelfInteract');
    near([...S2.mirrors.a], P.mirrors.a, 'mirror a');
    near([...S2.mirrors.b], P.mirrors.b, 'mirror b');
    near([S2.lightLock[0], S2.beamY, S2.lightLock[2]], P.lightLock, 'lightLock');
    assert.ok(Math.abs(S2.beamY - art.keyHeights.beamPlane) <= 0.01, 'beamPlane');
    out.push('与美术 s2-layout.json 核对 deskInteract / 钥匙 / 草图 / 木架站位 / 镜子 / 光感锁 ✓');
  }
}
// 017 收尾：室内不淋湿（-indoor 触发体：小屋一 / 二层 + 地窖）
{
  const vols = collectIndoorVolumes(gb.root);
  assert.ok(vols.length >= 2, 'S2 室内体积（小屋 + 地窖）');
  const at = (p) => ({ x: p[0], y: p[1], z: p[2] });
  for (const [tag, p] of [
    ['灶台前（一层）', S2.points.stove],
    ['书桌（二层）', S2.points.deskInteract],
    ['地窖木架', S2.points.cellarShelfInteract],
  ])
    assert.equal(xiWetTarget(true, at(p), vols), 0, `${tag} 下雨也不淋湿`);
  const yard = [(S2.yard.x[0] + S2.yard.x[1]) / 2, 0, (S2.yard.z[0] + S2.yard.z[1]) / 2];
  assert.equal(xiWetTarget(true, at(yard), vols), 1, '小院淋湿');
  const door = S2.openings.frontDoor;
  assert.equal(xiWetTarget(true, { x: (door.a + door.b) / 2, y: 0, z: S2.house.z0 - 0.8 }, vols), 1, '门外淋湿');
  out.push(`室内判定：${vols.length} 个 -indoor 体积，一层 / 二层 / 地窖不淋湿、小院 / 门外淋湿 ✓`);
}
// ---- 1030b 第 2 条 立镜 prop-mirror-stand-s2 ×2（真文件）：挂院墙 socket、镜面对齐白盒、mirror-pivot 世界旋转 = 白盒 yaw（逐 15° 档）
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { mountArtSlots, findNode } = await import('@/levels/artSlots');
  const { S2_ART_SLOTS } = await import('@/levels/s2/artSlots');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  globalThis.self ??= globalThis;
  const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
  const load = async (rel) => {
    const f = new URL(`../../art/models/${rel}.glb`, import.meta.url);
    if (!existsSync(f)) return null;
    const buf = readFileSync(f);
    return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
  };
  const stand = await load('props/prop-mirror-stand-s2');
  const yard = await load('env/env-courtyard-wall-s2');
  if (!stand || !yard) out.push('立镜 / 院墙美术未交付（跳过真文件检查）');
  else {
    const world = new THREE.Scene();
    world.add(beam.root);
    const pl = S2.artNodes['env-courtyard-wall-s2'];
    yard.name = 'env-courtyard-wall-s2';
    yard.position.set(...pl.translation);
    yard.rotation.y = pl.rotationY;
    world.add(yard);
    world.updateMatrixWorld(true);
    const models = { a: stand, b: stand.clone(true) };
    const specs = S2_ART_SLOTS.filter((x) => x.key === 'prop-mirror-stand-s2');
    assert.equal(specs.length, 2);
    let n = 0;
    const slots = mountArtSlots({ has: (x) => x === 'prop-mirror-stand-s2', getModel: () => models[n++ ? 'b' : 'a'] }, world, specs);
    assert.equal(slots.mounted.length, 2, '立镜 a / b 都挂上');
    const nrm = (o) => new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
    let worst = 0;
    const ixs = [];
    for (const k of ['a', 'b']) {
      const m = slots.mounted.find((x) => x.id === `prop-mirror-stand-s2-${k}`);
      assert.deepEqual(m.missingNodes, [], `立镜 ${k} 约定节点齐`);
      assert.equal(m.model.parent?.name, `env-courtyard-wall-s2-mirror-${k}-socket`, `立镜 ${k} 挂院墙 socket`);
      const rig = k === 'a' ? beam.mirrorA : beam.mirrorB;
      const sock = m.model.parent.getWorldPosition(new THREE.Vector3());
      assert.ok(Math.hypot(sock.x - rig.center.x, sock.z - rig.center.z) < 1e-3 && Math.abs(sock.y) < 1e-3, `立镜 ${k} socket ${sock.toArray()} = 白盒镜心地面 ${rig.center.toArray()}`);
      const plane = findNode(m.model, 'mirror-plane');
      const pivot = findNode(m.model, 'mirror-pivot');
      const gbPlane = findNode(rig.root, `mirror-stand-s2-${k}-mirror-plane`);
      const gbYaw = findNode(rig.root, `mirror-stand-s2-${k}-yaw`);
      for (let y = 0; y < 360; y += 15) {
        rig.part.setAngle(0, y);
        slots.update();
        world.updateMatrixWorld(true);
        const d = plane.getWorldPosition(new THREE.Vector3()).distanceTo(gbPlane.getWorldPosition(new THREE.Vector3()));
        const a = (nrm(plane).angleTo(nrm(gbPlane)) * 180) / Math.PI;
        const q = (wq(pivot).angleTo(wq(gbYaw)) * 180) / Math.PI;
        worst = Math.max(worst, a, q);
        assert.ok(d < 1e-3 && a < 0.01 && q < 0.01, `立镜 ${k} ${y}°：镜心差 ${d}、法线差 ${a}°、pivot 世界旋转差 ${q}°`);
      }
      beam.solve();
      slots.update();
      world.updateMatrixWorld(true);
      const ix = findNode(m.model, 'interact').getWorldPosition(new THREE.Vector3());
      ixs.push(`${k} (${ix.x.toFixed(2)}, ${ix.z.toFixed(2)})`);
      rig.part.setAngle(0, 0);
    }
    slots.update();
    world.remove(beam.root);
    out.push(`立镜真文件 ×2：挂院墙 socket（= 白盒镜心地面）、24 档镜面 / pivot 世界旋转 = 白盒（最大差 ${worst.toFixed(4)}°）、正解时 -interact ${ixs.join(' / ')} ✓`);
  }
}
// ---- 1030b 第 3 条 拨盘铁门 prop-dial-gate-s2（真文件）：挂崖顶 gate-socket、门扇对齐白盒合页；开角 S2.dialGate.openAngle 门扇不穿西门柱；-interact 站位
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { mountArtSlots, findNode } = await import('@/levels/artSlots');
  const { S2_ART_SLOTS } = await import('@/levels/s2/artSlots');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  globalThis.self ??= globalThis;
  const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
  const load = async (rel) => {
    const f = new URL(`../../art/models/${rel}.glb`, import.meta.url);
    if (!existsSync(f)) return null;
    const buf = readFileSync(f);
    return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
  };
  const gate = await load('props/prop-dial-gate-s2');
  const cliff = await load('env/env-clifftop-s2');
  if (!gate || !cliff) out.push('铁门 / 崖顶美术未交付（跳过真文件检查）');
  else {
    const dg = S2.dialGate;
    const world = new THREE.Scene();
    cliff.name = 'env-clifftop-s2';
    world.add(cliff);
    const hingeParent = gb.dialGate.parent;
    world.add(gb.dialGate);
    // 白盒拨盘在 puzzles.ts 里建（门扇局部、绕 Y 转 180° 朝南）；这里只验门扇 / 站位 / 开角，拨盘给同名占位让驱动表齐
    const fakeDials = [1, 2, 3].map((i) => {
      const d = new THREE.Group();
      d.name = `dial-gate-s2-dial-${i}`;
      d.rotation.y = Math.PI;
      gb.dialGate.add(d);
      return d;
    });
    world.updateMatrixWorld(true);
    const spec = S2_ART_SLOTS.find((x) => x.key === 'prop-dial-gate-s2');
    const slots = mountArtSlots({ has: (x) => x === spec.key, getModel: () => gate }, world, [spec]);
    assert.equal(slots.mounted.length, 1);
    assert.deepEqual(slots.mounted[0].missingNodes, [], '铁门约定节点齐');
    assert.equal(gate.parent?.name, 'env-clifftop-s2-gate-socket', '铁门挂崖顶 gate-socket');
    const door = findNode(gate, 'gate-door');
    const hw = door.getWorldPosition(new THREE.Vector3());
    assert.ok(hw.distanceTo(new THREE.Vector3(...dg.hinge)) < 1e-3, `美术合页 ${hw.toArray()} = 白盒 ${dg.hinge}`);
    // 西门柱：崖顶 lod0 在合页附近按高度切片，得柱面 x 与南北范围（柱帽一带往东出挑）
    const lod = cliff.getObjectByName('env-clifftop-s2_lod0');
    const tris = [];
    lod.traverse((m) => {
      if (!m.isMesh) return;
      const p = m.geometry.attributes.position;
      const idx = m.geometry.index;
      const n = idx ? idx.count : p.count;
      const g = (i) => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      for (let t = 0; t < n; t += 3) {
        const tri = [g(t), g(t + 1), g(t + 2)];
        if (tri.every((v) => v.x < dg.hinge[0] - 0.3 || v.x > dg.hinge[0] + 0.8 || v.z < dg.hinge[2] - 0.6 || v.z > dg.hinge[2] + 0.6)) continue;
        tris.push(tri);
      }
    });
    const bands = [];
    for (let y = 0.05; y < 1.75; y += 0.05) {
      const pts = [];
      for (const [a, b, c] of tris)
        for (const [u, w] of [[a, b], [b, c], [c, a]])
          if ((u.y - y) * (w.y - y) < 0) {
            const t = (y - u.y) / (w.y - u.y);
            pts.push([u.x + t * (w.x - u.x), u.z + t * (w.z - u.z)]);
          }
      const face = pts.filter(([, z]) => Math.abs(z - dg.hinge[2]) < 0.25);
      if (!face.length) continue;
      const fx = Math.min(...face.map(([x]) => x));
      const side = pts.filter(([x]) => x > fx + 0.1);
      bands.push({ y0: y - 0.025, y1: y + 0.025, fx, z0: Math.min(...side.map(([, z]) => z)), z1: Math.max(...side.map(([, z]) => z)) });
    }
    assert.ok(bands.length > 20, '切出西门柱');
    const fxMid = bands.find((b) => b.y0 > 0.9).fx;
    assert.ok(Math.abs(fxMid - dg.hinge[0]) < 0.03, `西门柱面 x ${fxMid.toFixed(3)} ≈ 合页 x ${dg.hinge[0]}`);
    // 门扇顶点（门扇局部；合页筒 x > −0.06 本来就嵌在柱里，转起来不变，不算）
    const verts = [];
    door.updateMatrixWorld(true);
    door.traverse((o) => {
      if (!o.isMesh || /collider/.test(o.name)) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = door.worldToLocal(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
        if (v.x <= -0.06) verts.push(v);
      }
    });
    const pen = (deg) => {
      gb.dialGate.rotation.y = THREE.MathUtils.degToRad(deg);
      slots.update();
      world.updateMatrixWorld(true);
      let worst = -1;
      const w = new THREE.Vector3();
      for (const v of verts) {
        w.copy(v).applyMatrix4(door.matrixWorld);
        const b = bands.find((x) => w.y >= x.y0 && w.y < x.y1);
        if (!b || w.z < b.z0 || w.z > b.z1) continue;
        // 正 = 进柱深度（柱面往西），负 = 离柱面的空隙
        worst = Math.max(worst, w.x - b.fx);
      }
      return worst;
    };
    const openDeg = THREE.MathUtils.radToDeg(dg.openAngle);
    const p95 = pen(95);
    const p90 = pen(90);
    const pOpen = pen(openDeg);
    // 美术门扇跟白盒转到开角
    const yawW = new THREE.Euler().setFromQuaternion(door.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    assert.ok(Math.abs(THREE.MathUtils.radToDeg(yawW) - openDeg) < 0.01, `美术门扇开到 ${THREE.MathUtils.radToDeg(yawW).toFixed(2)}° = 白盒 ${openDeg}°`);
    assert.ok(p95 > 0.01, `美术原开角 95° 应擦进西门柱（${(p95 * 100).toFixed(1)} cm）`);
    assert.ok(pOpen <= 0, `开角 ${openDeg}° 门扇不穿西门柱（穿 ${(pOpen * 1000).toFixed(1)} mm）`);
    assert.ok(openDeg >= 75, '开角不能太小（门洞留够宽）');
    pen(0);
    // 站位：美术 -interact（门南 0.485 m、+Z 朝门）
    const ix = findNode(gate, 'interact');
    const ip = ix.getWorldPosition(new THREE.Vector3());
    const fz = new THREE.Vector3(0, 0, 1).transformDirection(ix.matrixWorld);
    assert.ok(Math.abs(dg.hinge[2] - ip.z - 0.485) < 0.005 && Math.abs(ip.x - (dg.hinge[0] - dg.width / 2)) < 0.005 && fz.z > 0.999, `-interact ${ip.toArray()} 门南 0.485 m 朝北`);
    slots.dispose?.();
    gate.removeFromParent();
    for (const d of fakeDials) d.removeFromParent();
    hingeParent.add(gb.dialGate);
    gb.dialGate.traverse((o) => {
      if (o.isMesh) o.visible = true;
    });
    out.push(`拨盘铁门真文件：挂 gate-socket、合页对齐；西门柱面 x ${fxMid.toFixed(3)}，门扇穿柱 95° ${(p95 * 100).toFixed(1)} cm / 90° ${(p90 * 100).toFixed(1)} cm / 开角 ${openDeg}° 离柱面 ${(-pOpen * 1000).toFixed(1)} mm（不穿）；-interact (${ip.x.toFixed(2)}, ${ip.z.toFixed(3)}) 门南 0.485 m ✓`);
  }
}
console.log('verify-s2 ✓ ' + out.join('；'));
