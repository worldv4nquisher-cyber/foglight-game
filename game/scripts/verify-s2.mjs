// v0.1-014 S2 白盒自检（node，无浏览器）：布局数值（观察点距离 / 远景方位）+ 碰撞白盒动线（纯 PhysicsSystem 走路）
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { S2, S2_FAR, s2ToWorld, worldToS2, farthestStoneDistance } from '@/levels/s2/layout';
import { bearingFrom, S1 } from '@/levels/s1/layout';
import { buildS2Greybox } from '@/levels/s2/greybox';
import { PhysicsSystem, CharacterBody } from '@/systems/PhysicsSystem';

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
const vp = S2.viewpoint.eye;
must('入口 → 正门 → 楼梯 → 二层观察点', walk([[0, -12.5], [-4.1, -4], [-4.1, -2.5], [-4.1, -1.0], [-3.3, -0.97], [1.0, -0.97], [1.0, 0.3], [vp[0], vp[2]]]), S2.house.upperFloorY);
must('二层 → 书桌站位', walk([[1.0, 0.0], [S2.points.deskInteract[0], S2.points.deskInteract[2]]], 3), S2.house.upperFloorY);
const shut = walk([[0, -12.5], [3.5, -5], [3.5, 5], [0.62, 5], [0.62, 3.2]]);
assert.ok(!shut.ok && shut.at.z > 3.9, '地窖门关着时不应进得去');
cols.get(gb.cellarDoorLeaf).enabled = false;
must('地窖门开 → 石阶 → 地窖木架前', walk([[0.62, 5], [0.62, 3.2], [0.8, 0.3], [-1.5, 1.5]]), S2.cellar.floorY);
cols.get(gb.cellarDoorLeaf).enabled = true;
must('入口 → 院门 → 院子 → 北口 → 铁门洞 → 崖径出口', walk([[0, -12.5], [-9, -10], [-9, -7], [-11, -4], [-11, 0], [-8, 6], [-7.8, 10.2], [4.2, 10.8], [4.2, 14], [S2.exitToS3[0], S2.exitToS3[2]]]), 0);
must('西侧坡地（白石区）', walk([[0, -12.5], [5, -6], [15, 0], [21, -0.8]]));
const back = walk([[0, -12.5], [0, -16]]);
assert.ok(!back.ok && back.at.z > -14, '南石阶应挡住回头路');
out.push('动线：二层观察点 / 书桌 / 地窖（门开才进得去）/ 院子 → 出口 / 坡地 ✓，南石阶挡回头路 ✓');
console.log('verify-s2 ✓ ' + out.join('；'));
