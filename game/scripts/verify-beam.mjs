// v0.1-012 光线反射系统校验（纯逻辑，无 DOM）：反射角、4 次反射上限、镜背挡光、碰撞体挡光、接收器半径与 1.5 / 2 s 计时、
// 中途移开进度归零、前置条件未满足 → receiver:blocked、天光 40 s / 25 s 周期与常亮、暖 / 冷白切换、事件驱动重算、3 镜 4 反射 ≤ 1 ms。
// 运行：npm run test:beam
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { EventBus } from '@/core/EventBus';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { RotatablePart } from '@/systems/interaction/RotatablePart';
import { BeamEmitter } from '@/systems/light/BeamEmitter';
import { Mirror, reflect } from '@/systems/light/Mirror';
import { BeamReceiver } from '@/systems/light/BeamReceiver';
import { BeamTracer } from '@/systems/light/BeamTracer';
import { WhiteboxBeamRenderer } from '@/systems/light/BeamRenderer';
import { buildBeamTestArea } from '@/world/beamTestArea';

const DT = 1 / 60;
const cfg = gameplay.beam;
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}
const deg = (r) => (r * 180) / Math.PI;

/** 节点：位置 + 让局部 +Z 指向 dir */
function node(pos, dir, parent = null) {
  const o = new THREE.Object3D();
  o.position.set(...pos);
  const d = new THREE.Vector3(...dir).normalize();
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  if (parent) parent.add(o);
  o.updateMatrixWorld(true);
  return o;
}
const mirror = (id, pos, n, hw = 0.5, hh = 0.5) => new Mirror({ id, node: node(pos, n), halfWidth: hw, halfHeight: hh });
const emitter = (pos, dir, extra = {}) => new BeamEmitter({ id: 'e', node: node(pos, dir), kind: 'manual', on: true, ...extra });
const run = (tr, sec) => {
  for (let i = 0; i < Math.round(sec / DT); i++) tr.fixedUpdate(DT);
};

test('反射定律：入射角 30° → 反射角 30°（误差 < 0.1°），出射在法线另一侧', () => {
  const tr = new BeamTracer();
  // 镜面法线 +Z，光从 (−x, +z) 方向以 30° 入射
  const inc = new THREE.Vector3(Math.sin(Math.PI / 6), 0, -Math.cos(Math.PI / 6));
  const start = new THREE.Vector3(0, 0, 0).addScaledVector(inc, -5);
  tr.addEmitter(emitter(start.toArray(), inc.toArray()));
  tr.addMirror(mirror('m', [0, 0, 0], [0, 0, 1], 2, 2));
  tr.trace();
  const p = tr.paths[0];
  assert.equal(p.reflections, 1);
  const out = p.segments[1].to.clone().sub(p.segments[1].from).normalize();
  const n = new THREE.Vector3(0, 0, 1);
  const ai = deg(Math.acos(-inc.dot(n)));
  const ar = deg(Math.acos(out.dot(n)));
  assert.ok(Math.abs(ai - 30) < 1e-6 && Math.abs(ar - 30) < 0.1, `入射 ${ai} 反射 ${ar}`);
  assert.ok(out.x > 0, '出射应继续往 +x');
  // 纯函数
  const r = reflect(new THREE.Vector3(1, -1, 0).normalize(), new THREE.Vector3(0, 1, 0));
  assert.ok(r.distanceTo(new THREE.Vector3(1, 1, 0).normalize()) < 1e-9);
});

/** 两面平行镜之间来回反射：第 5 次命中镜子即停（end = limit） */
test('最多 4 次反射：第 5 面（次）镜子不再折返，光停在上面', () => {
  const tr = new BeamTracer();
  // 两面相对的镜子 z = 0（法线 +z）、z = 4（法线 −z），光斜着在中间来回
  tr.addMirror(mirror('a', [0, 0, 0], [0, 0, 1], 20, 2));
  tr.addMirror(mirror('b', [0, 0, 4], [0, 0, -1], 20, 2));
  tr.addEmitter(emitter([-10, 0, 2], [1, 0, -1]));
  tr.trace();
  const p = tr.paths[0];
  assert.equal(p.reflections, 4);
  assert.equal(p.end, 'limit');
  assert.equal(p.segments.length, 5);
  assert.deepEqual(p.mirrors, ['a', 'b', 'a', 'b', 'a']);
  tr.maxReflections = 2;
  tr.trace();
  assert.equal(tr.paths[0].reflections, 2);
});

test('光打到镜子背面被挡住（不反射）；射出镜面范围外不算命中', () => {
  const tr = new BeamTracer();
  tr.addMirror(mirror('m', [0, 0, 0], [0, 0, -1], 0.5, 0.5));
  tr.addEmitter(emitter([0, 0, 5], [0, 0, -1]));
  tr.trace();
  assert.equal(tr.paths[0].end, 'mirrorBack');
  assert.equal(tr.paths[0].reflections, 0);
  assert.ok(Math.abs(tr.paths[0].endPoint.z) < 1e-6);
  const tr2 = new BeamTracer();
  tr2.addMirror(mirror('m', [0, 0, 0], [0, 0, 1], 0.5, 0.5));
  tr2.addEmitter(emitter([0.8, 0, 5], [0, 0, -1]));
  tr2.trace();
  assert.equal(tr2.paths[0].end, 'none');
});

test('碰撞体挡光（光斑在命中点）；空气墙不挡光；镜子自带碰撞框不会把反射光挡在原地', () => {
  const physics = new PhysicsSystem();
  physics.addBox(new THREE.Box3(new THREE.Vector3(-1, -1, -3.2), new THREE.Vector3(1, 1, -3)));
  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2));
  wallMesh.position.set(0, 0, -1);
  wallMesh.updateMatrixWorld(true);
  physics.addMesh(wallMesh, { kind: 'wall' });
  const tr = new BeamTracer(physics);
  tr.addEmitter(emitter([0, 0, 0], [0, 0, -1]));
  tr.trace();
  assert.equal(tr.paths[0].end, 'blocker');
  assert.ok(Math.abs(tr.paths[0].endPoint.z + 3) < 1e-4, '光斑应在 z = −3');
  // 镜子嵌在碰撞框里：框表面与镜面几乎重合
  const p2 = new PhysicsSystem();
  p2.addBox(new THREE.Box3(new THREE.Vector3(-0.6, -0.6, -0.04), new THREE.Vector3(0.6, 0.6, 0.0)));
  const tr2 = new BeamTracer(p2);
  tr2.addMirror(mirror('m', [0, 0, 0.0], [0, 0.0, 1], 0.5, 0.5));
  tr2.addEmitter(emitter([0, 0.0, 5], [0, 0, -1]));
  tr2.trace();
  assert.equal(tr2.paths[0].reflections, 1);
  assert.notEqual(tr2.paths[0].end, 'blocker');
});

test('接收器半径判定（默认 0.3 m）：0.29 m 偏移命中，0.31 m 不中', () => {
  for (const [off, hit] of [[0.29, true], [0.31, false]]) {
    const tr = new BeamTracer();
    tr.addReceiver(new BeamReceiver({ id: 'r', node: node([0, off, -5], [0, 0, 1]) }));
    tr.addEmitter(emitter([0, 0, 0], [0, 0, -1]));
    tr.trace();
    assert.equal(tr.paths[0].end === 'receiver', hit, `偏移 ${off}`);
  }
  assert.equal(new BeamReceiver({ id: 'x', node: new THREE.Object3D() }).radius, 0.3);
});

test('持续命中 1.5 s 触发 receiver:activated（点火口可配 2 s）；中途移开进度归零', () => {
  const events = new EventBus();
  const ev = [];
  for (const n of ['receiver:activated', 'receiver:reset', 'receiver:blocked']) events.on(n, (p) => ev.push([n, p.id]));
  const tr = new BeamTracer();
  const e = tr.addEmitter(emitter([0, 0, 0], [0, 0, -1]));
  const r = tr.addReceiver(new BeamReceiver({ id: 'lock', node: node([0, 0, -5], [0, 0, 1]) }));
  tr.bind(events);
  run(tr, 1.0);
  assert.equal(r.state, 'charging');
  assert.ok(Math.abs(r.progress - 1 / 1.5) < 0.02);
  // 移开：光源转向
  e.node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, -1).normalize());
  run(tr, DT * 2);
  assert.equal(r.progress, 0);
  assert.equal(r.state, 'idle');
  assert.ok(ev.some(([n]) => n === 'receiver:reset'));
  e.node.quaternion.identity();
  e.node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  run(tr, 1.45);
  assert.ok(!r.activated, '1.45 s 还不该触发');
  run(tr, 0.1);
  assert.ok(r.activated);
  assert.equal(ev.filter(([n]) => n === 'receiver:activated').length, 1);
  // 2 s 点火口
  const tr2 = new BeamTracer();
  tr2.addEmitter(emitter([0, 0, 0], [0, 0, -1]));
  const ig = tr2.addReceiver(new BeamReceiver({ id: 'ig', node: node([0, 0, -5], [0, 0, 1]), holdSec: cfg.igniterHoldSec }));
  run(tr2, 1.9);
  assert.ok(!ig.activated);
  run(tr2, 0.15);
  assert.ok(ig.activated);
  assert.equal(cfg.lockHoldSec, 1.5);
  assert.equal(cfg.igniterHoldSec, 2);
});

test('点火口前置条件未满足：命中只发红光（blocked）并发 receiver:blocked 一次；满足后正常触发', () => {
  const events = new EventBus();
  const ev = [];
  events.on('receiver:blocked', (p) => ev.push(['blocked', p.id]));
  events.on('receiver:activated', (p) => ev.push(['activated', p.id]));
  let oil = false;
  const tr = new BeamTracer();
  tr.addEmitter(emitter([0, 0, 0], [0, 0, -1], { color: 'coldWhite' }));
  const r = tr.addReceiver(new BeamReceiver({ id: 'ig', node: node([0, 0, -5], [0, 0, 1]), holdSec: 2, requires: () => oil }));
  tr.bind(events);
  run(tr, 0.5);
  assert.equal(r.state, 'blocked');
  run(tr, 2);
  assert.deepEqual(ev, [['blocked', 'ig']]);
  assert.ok(!r.activated);
  oil = true;
  r.resetState();
  run(tr, 2.05);
  assert.ok(r.activated);
  assert.deepEqual(ev.at(-1), ['activated', 'ig']);
  // 白盒透镜：受阻时红光
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial());
  const tr3 = new BeamTracer();
  tr3.addEmitter(emitter([0, 0, 0], [0, 0, -1]));
  tr3.addReceiver(new BeamReceiver({ id: 'x', node: node([0, 0, -5], [0, 0, 1]), requires: () => false, lens }));
  const rend = new WhiteboxBeamRenderer();
  run(tr3, 0.5);
  rend.update(DT, tr3);
  assert.equal(lens.material.emissive.getHex(), cfg.colors.blocked);
  rend.dispose();
});

test('天光：40 s 一周期、亮 25 s、1 s 淡入淡出；beam:skyAlwaysOn 后常亮', () => {
  const events = new EventBus();
  const tr = new BeamTracer();
  const sky = tr.addEmitter(new BeamEmitter({ id: 'sky', node: node([0, 0, 0], [0, -1, 0]), kind: 'sky' }));
  tr.bind(events);
  assert.equal(sky.color, 'coldWhite');
  assert.equal(sky.periodSec, 40);
  assert.equal(sky.onSec, 25);
  assert.ok(sky.lit);
  run(tr, 24.9);
  assert.ok(sky.lit && sky.intensity === 1);
  run(tr, 0.6);
  assert.ok(sky.intensity < 1 && sky.intensity > 0, '25 s 后开始淡出');
  run(tr, 1);
  assert.ok(!sky.lit && sky.intensity === 0);
  run(tr, 40 - 26.5 + 1.1);
  assert.ok(sky.lit, '下一周期 40 s 时重新亮');
  events.emit('beam:skyAlwaysOn', { id: 'sky', alwaysOn: true });
  run(tr, 60);
  assert.ok(sky.lit && sky.intensity === 1, '常亮');
});

test('光源颜色暖 / 冷白可切换（beam:setColor），渲染颜色跟随；socket 光源放风灯亮、拿走灭', () => {
  const events = new EventBus();
  const tr = new BeamTracer();
  const e = tr.addEmitter(new BeamEmitter({ id: 'p5', node: node([0, 0, 0], [0, 0, -1]), kind: 'manual', on: true, color: 'coldWhite' }));
  const s = tr.addEmitter(new BeamEmitter({ id: 'lamp', node: node([0, 0, 0], [1, 0, 0]), kind: 'socket', socket: 'stand-socket', item: 'lantern' }));
  tr.bind(events);
  const rend = new WhiteboxBeamRenderer();
  run(tr, DT);
  rend.update(DT, tr);
  const core = () => rend.root.getObjectByName('beam-seg-0-core').material.color.getHex();
  assert.equal(core(), cfg.colors.coldWhite);
  events.emit('beam:setColor', { id: 'p5', color: 'warm' });
  tr.invalidate();
  run(tr, DT);
  rend.update(DT, tr);
  assert.equal(e.color, 'warm');
  assert.equal(core(), cfg.colors.warmCore);
  assert.equal(s.color, 'warm');
  assert.ok(!s.lit);
  events.emit('item:place', { item: 'lantern', socket: 'stand-socket' });
  run(tr, 0.4);
  assert.ok(s.lit);
  events.emit('item:pickup', { item: 'lantern', from: 'stand-socket' });
  run(tr, 0.4);
  assert.ok(!s.lit);
  rend.dispose();
});

test('事件驱动：没变化不重算；镜子转动 / puzzle:partRotated / beam:invalidate / 碰撞体开关时才重算', () => {
  const events = new EventBus();
  const physics = new PhysicsSystem();
  const door = physics.addBox(new THREE.Box3(new THREE.Vector3(-1, -1, -8.2), new THREE.Vector3(1, 1, -8)));
  door.enabled = false;
  const tr = new BeamTracer(physics);
  tr.addEmitter(emitter([0, 0, 0], [0, 0, -1]));
  const mNode = node([0, 0, -4], [0, 0, 1]);
  const pivot = new THREE.Object3D();
  pivot.position.set(0, 0, -4);
  mNode.position.set(0, 0, 0);
  pivot.add(mNode);
  pivot.updateMatrixWorld(true);
  tr.addMirror(new Mirror({ id: 'm', node: mNode, halfWidth: 0.5, halfHeight: 0.5 }));
  tr.bind(events);
  run(tr, DT);
  const n0 = tr.traceCount;
  run(tr, 1);
  assert.equal(tr.traceCount, n0, '静止 1 s 不应重算');
  const part = new RotatablePart({ id: 'm', node: pivot, axes: [{ axis: 'y' }] });
  part.step(0, 1);
  run(tr, DT);
  assert.equal(tr.traceCount, n0 + 1, '转镜后重算一次');
  events.emit('beam:invalidate', undefined);
  run(tr, DT);
  assert.equal(tr.traceCount, n0 + 2);
  door.enabled = true;
  run(tr, DT);
  assert.equal(tr.traceCount, n0 + 3, '门的碰撞体开关后重算');
  run(tr, 0.5);
  assert.equal(tr.traceCount, n0 + 3);
});

test('测试场地光路：光源 → 镜 A → 镜 B → 接收器（转对后 1.5 s 触发）；转开光路即时更新', () => {
  const events = new EventBus();
  const physics = new PhysicsSystem();
  const scene = new THREE.Scene();
  const area = buildBeamTestArea({ scene, physics, events });
  const ev = [];
  events.on('receiver:activated', (p) => ev.push(p.id));
  area.solve();
  run(area.tracer, DT);
  const p = area.tracer.paths.find((x) => x.emitter.id === area.lamp.id);
  assert.ok(p, '有测试光源');
  assert.equal(p.end, 'receiver', `应命中接收器：${area.tracer.debugLine()}`);
  assert.deepEqual(p.mirrors, ['beam-mirror-a', 'beam-mirror-b']);
  run(area.tracer, 1.6);
  assert.ok(ev.includes(area.lock.id));
  area.mirrorA.part.step(0, 1);
  run(area.tracer, DT);
  const p2 = area.tracer.paths.find((x) => x.emitter.id === area.lamp.id);
  assert.notEqual(p2.end, 'receiver');
  area.dispose();
});

test('性能：3 面镜子 + 4 次反射的光路重算单次 ≤ 1 ms（取 200 次中位数）', () => {
  const physics = new PhysicsSystem();
  for (let i = 0; i < 30; i++) physics.addBox(new THREE.Box3(new THREE.Vector3(i * 3 - 45, -10, -40), new THREE.Vector3(i * 3 - 44, 10, -39)));
  const tr = new BeamTracer(physics);
  tr.addMirror(mirror('a', [0, 0, 0], [0, 0, 1], 30, 2));
  tr.addMirror(mirror('b', [0, 0, 4], [0, 0, -1], 30, 2));
  tr.addMirror(mirror('c', [50, 0, 2], [-1, 0, 0], 2, 2));
  tr.addEmitter(emitter([-10, 0, 2], [1, 0, -1]));
  tr.trace();
  assert.equal(tr.paths[0].reflections, 4);
  const ms = [];
  for (let i = 0; i < 200; i++) {
    tr.invalidate();
    ms.push(tr.trace());
  }
  ms.sort((a, b) => a - b);
  const med = ms[100];
  assert.ok(med <= 1, `中位数 ${med.toFixed(3)} ms`);
  console.log(`    （重算中位数 ${med.toFixed(3)} ms，最慢 ${ms.at(-1).toFixed(3)} ms）`);
});

let failed = 0;
for (const [status, name, err] of results) {
  console.log(`${status === 'ok' ? '✓' : '✗'} ${name}`);
  if (err) {
    failed++;
    console.log(`  ${err.stack ?? err}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed) process.exit(1);
