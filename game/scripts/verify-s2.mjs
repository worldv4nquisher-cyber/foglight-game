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
console.log('verify-s2 ✓ ' + out.join('；'));
