// v0.1-012 光线反射系统校验（纯逻辑，无 DOM）：反射角、4 次反射上限、镜背挡光、碰撞体挡光、接收器半径与 1.5 s 计时、015 C 点火口 manual（1.0 s 可点灯 / 0.3 s 容差 / 20 s 提醒 / 四态颜色 / 测试场按 E）、
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
import { buildBeamTestArea, BEAM_Y } from '@/world/beamTestArea';
import { S2 } from '@/levels/s2/layout';
import { IgniterHum, IGNITER_HUM_ID } from '@/levels/s3/igniterHum';
import { AudioSystem } from '@/systems/AudioSystem';
import { bindSfxFallback } from '@/systems/tide/tideScene';
import { LAMP_BEAM, LAMP_GLOW, LampBeam, lampBeamAlong, lampBeamEdge, lampBeamPhase } from '@/render/lampBeam';

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

test('持续命中 1.5 s 触发 receiver:activated（光感锁）；中途移开进度归零', () => {
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
  assert.equal(cfg.lockHoldSec, 1.5);
  // 015 C：点火口 1.0 s 进入可点灯，断光容差 0.3 s，20 s 提醒
  assert.equal(cfg.igniterHoldSec, 1.0);
  assert.equal(cfg.igniterGraceSec, 0.3);
  assert.equal(cfg.igniterReminderSec, 20);
});

// ---- 015 C 点火口 manual 模式（只发 ready / lost，按 E 由脚本 activate）
const manualRig = (oil = { v: true }) => {
  const events = new EventBus();
  const ev = [];
  for (const n of ['receiver:ready', 'receiver:lost', 'receiver:activated', 'receiver:blocked', 'ignition:reminder']) events.on(n, () => ev.push(n));
  const tr = new BeamTracer();
  const e = tr.addEmitter(emitter([0, 0, 0], [0, 0, -1], { color: 'coldWhite' }));
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial());
  const r = tr.addReceiver(
    new BeamReceiver({
      id: 'ig',
      node: node([0, 0, -5], [0, 0, 1]),
      holdSec: cfg.igniterHoldSec,
      requires: () => oil.v,
      lens,
      mode: 'manual',
      graceSec: cfg.igniterGraceSec,
      reminderSec: cfg.igniterReminderSec,
    }),
  );
  tr.bind(events);
  const aim = (on) => {
    e.node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), on ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(1, 0, -1).normalize());
    e.node.updateMatrixWorld(true);
    tr.invalidate();
  };
  return { events, ev, tr, e, r, lens, aim, oil };
};

test('点火口 manual：连续受光 1.0 s 进入可点灯（receiver:ready），不自动点燃；activate() 只在可点灯时生效', () => {
  const { ev, tr, r, aim } = manualRig();
  assert.equal(r.mode, 'manual');
  assert.equal(r.activate(), false, '待命时 activate 无效');
  run(tr, 0.95);
  assert.equal(r.state, 'charging');
  run(tr, 0.1);
  assert.equal(r.state, 'ready');
  assert.ok(r.ready && !r.activated);
  assert.deepEqual(ev, ['receiver:ready']);
  run(tr, 5);
  assert.equal(r.state, 'ready', '一直受光也不会自己点燃');
  assert.ok(!ev.includes('receiver:activated'));
  assert.equal(r.activate(), true);
  assert.ok(r.activated);
  assert.equal(r.activate(), false, '只生效一次');
  // 点燃后光路不再影响它
  aim(false);
  run(tr, 2);
  assert.ok(r.activated);
  assert.equal(ev.filter((n) => n === 'receiver:activated').length, 1);
});

test('点火口断光容差：≤ 0.3 s 不算断（可点灯保持、累计阶段不清零），> 0.3 s 发 receiver:lost 并重新计 1.0 s', () => {
  const { ev, tr, r, aim } = manualRig();
  // 累计阶段：0.6 s 受光 + 0.25 s 断光 + 0.45 s 受光 = 可点灯（总受光 1.05 s）
  run(tr, 0.6);
  aim(false);
  run(tr, 0.25);
  assert.equal(r.state, 'charging', '容差内不清零');
  aim(true);
  run(tr, 0.45);
  assert.equal(r.state, 'ready');
  // 可点灯阶段：断 0.3 s 保持（且容差内 activate 仍生效的前提 = ready）
  aim(false);
  run(tr, 0.3);
  assert.equal(r.state, 'ready', '断光 0.3 s 不退出');
  assert.ok(!ev.includes('receiver:lost'));
  aim(true);
  run(tr, DT);
  // 断 0.35 s → 退出
  aim(false);
  run(tr, 0.35);
  assert.equal(r.state, 'idle');
  assert.equal(r.progress, 0);
  assert.equal(ev.filter((n) => n === 'receiver:lost').length, 1);
  assert.equal(r.activate(), false, '退出后按 E 无效');
  // 重新受光要再连续 1.0 s
  aim(true);
  run(tr, 0.95);
  assert.equal(r.state, 'charging');
  run(tr, 0.1);
  assert.equal(r.state, 'ready');
  assert.equal(ev.filter((n) => n === 'receiver:ready').length, 2);
});

test('015 可点灯嗡鸣循环：进入可点灯淡入 1 次（不叠加），0.3 s 宽限内不断，超过淡出 0.3 s；重新可点灯再起；点灯演出中断光不停、点燃后停；重置兜底停', () => {
  const { events, tr, r, aim } = manualRig();
  const loops = [];
  events.on('sfx:loop', (p) => loops.push(['loop', p.id, p.fadeIn]));
  events.on('sfx:loopStop', (p) => loops.push(['stop', p.id, p.fadeOut]));
  // 接到 AudioSystem（假 context 只记节点数）：同名不叠加
  const ctx = { currentTime: 0, state: 'running', destination: {}, n: 0,
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect: (x) => x, disconnect() {} }; },
    createOscillator() { ctx.n++; return { frequency: { value: 0 }, connect: (x) => x, disconnect() {}, start() {}, stop() {} }; },
    createBufferSource() { ctx.n++; return { connect: (x) => x, disconnect() {}, start() {}, stop() {} }; } };
  const audio = new AudioSystem(ctx);
  bindSfxFallback(events, audio);
  const flags = { igniting: false };
  const hum = new IgniterHum(events, r, () => flags.igniting);
  hum.bind();
  const step = (sec) => {
    for (let i = 0; i < Math.round(sec / DT); i++) {
      tr.fixedUpdate(DT);
      hum.update();
    }
  };
  step(1.05);
  assert.equal(r.state, 'ready');
  assert.deepEqual(loops, [['loop', IGNITER_HUM_ID, cfg.igniterHumFadeInSec]]);
  assert.ok(hum.on && audio.isLooping(IGNITER_HUM_ID));
  hum.start();
  events.emit('sfx:loop', { id: IGNITER_HUM_ID });
  assert.equal(ctx.n, 1, '同名循环不叠加');
  // 宽限内断光 0.3 s：不断
  aim(false);
  step(0.3);
  assert.equal(r.state, 'ready');
  assert.ok(hum.on && !loops.some((x) => x[0] === 'stop') && audio.isLooping(IGNITER_HUM_ID), '0.3 s 宽限内嗡鸣不该停');
  aim(true);
  step(DT);
  // 断光 > 0.3 s：退出可点灯 → 淡出
  aim(false);
  step(0.35);
  assert.equal(r.state, 'idle');
  assert.deepEqual(loops.at(-1), ['stop', IGNITER_HUM_ID, cfg.igniterHumFadeOutSec]);
  assert.ok(!hum.on && !audio.isLooping(IGNITER_HUM_ID));
  // 重新连续受光 1.0 s → 再起
  aim(true);
  step(1.05);
  assert.equal(hum.starts, 2);
  assert.ok(audio.isLooping(IGNITER_HUM_ID));
  // 按 E（igniting）后断光超过宽限也不停，点燃（lighthouse:ignited）才淡出
  flags.igniting = true;
  aim(false);
  step(0.5);
  assert.ok(hum.on, '点灯演出中断光不应停嗡鸣');
  events.emit('lighthouse:ignited');
  assert.ok(!hum.on && !audio.isLooping(IGNITER_HUM_ID));
  assert.equal(hum.stops, 2);
  // 重置兜底：ready 时 resetState（不发 lost）→ update 停
  flags.igniting = false;
  aim(true);
  step(1.05);
  assert.ok(hum.on);
  r.resetState();
  hum.update();
  assert.ok(!hum.on);
  assert.equal(cfg.igniterHumFadeOutSec, 0.3);
});

test('点火口未开阀：只红光（blocked）+ receiver:blocked，不进可点灯；开阀后从开阀那一刻起 1.0 s', () => {
  const oil = { v: false };
  const { ev, tr, r, lens } = manualRig(oil);
  run(tr, 3);
  assert.equal(r.state, 'blocked');
  assert.ok(ev.includes('receiver:blocked'));
  assert.ok(!ev.includes('receiver:ready'));
  const rend = new WhiteboxBeamRenderer();
  rend.update(DT, tr);
  assert.equal(lens.material.emissive.getHex(), cfg.igniterPort.noOil, '没油 = #C8382A');
  assert.ok(Math.abs(lens.material.emissiveIntensity - cfg.igniterPort.noOilIntensity) < 1e-9);
  oil.v = true; // 不调 resetState：受阻 → 满足时 receiver 自己从这一刻重新计时
  run(tr, 0.95);
  assert.equal(r.state, 'charging', '开阀后 0.95 s 还不该可点灯（不吃开阀前的受光时间）');
  run(tr, 0.1);
  assert.equal(r.state, 'ready');
  // 冷白呼吸 0.15–0.35
  for (let i = 0; i < 60; i++) {
    run(tr, 0.05);
    rend.update(0.05, tr);
    assert.equal(lens.material.emissive.getHex(), cfg.igniterPort.cold, '可点灯 = #DCE6EE');
    assert.ok(lens.material.emissiveIntensity >= 0.15 - 1e-6 && lens.material.emissiveIntensity <= 0.35 + 1e-6);
  }
  r.activate();
  rend.update(DT, tr);
  assert.equal(lens.material.emissive.getHex(), cfg.igniterPort.lit, '点燃 = #FFB25E');
  rend.dispose();
});

test('点火口 20 s 提醒：可点灯 20 s 没点 → ignition:reminder 一次 + 脉冲（0.8 s 升到峰——对齐 sfx-ignite-ready-pulse 峰 0.8 s / 0.8 s 落）；退出再进入重新计时', () => {
  const { ev, tr, r, aim } = manualRig();
  run(tr, 1.0 + DT);
  assert.equal(r.state, 'ready');
  run(tr, 19.8);
  assert.ok(!ev.includes('ignition:reminder'));
  run(tr, 0.3);
  assert.equal(ev.filter((n) => n === 'ignition:reminder').length, 1);
  const t0 = r.readySec - r.reminderSec;
  assert.ok(t0 >= 0 && t0 < 0.3, `提醒后 ${t0}`);
  assert.ok(r.reminderPulse < 0.4, `0.3 s 内还在升 ${r.reminderPulse}`);
  run(tr, 0.8 - t0);
  assert.ok(r.reminderPulse > 0.95, `0.8 s 到峰 ${r.reminderPulse}`);
  run(tr, 0.4);
  assert.ok(r.reminderPulse > 0.4 && r.reminderPulse < 0.6, `1.2 s 落一半 ${r.reminderPulse}`);
  run(tr, 0.5);
  assert.equal(r.reminderPulse, 0, '脉冲 1.6 s 后落回');
  run(tr, 30);
  assert.equal(ev.filter((n) => n === 'ignition:reminder').length, 1, '每次进入可点灯最多一次');
  assert.equal(r.state, 'ready', '提醒后不自动点燃');
  aim(false);
  run(tr, 0.4);
  aim(true);
  run(tr, 1.0 + DT + 20.1);
  assert.equal(ev.filter((n) => n === 'ignition:reminder').length, 2, '重新进入后重新计时');
});

test('点火口可点灯时前置条件失效（测试场地关阀）：退出可点灯', () => {
  const oil = { v: true };
  const { ev, tr, r } = manualRig(oil);
  run(tr, 1.1);
  assert.equal(r.state, 'ready');
  oil.v = false;
  run(tr, DT);
  assert.ok(ev.includes('receiver:lost'));
  run(tr, 0.5);
  assert.equal(r.state, 'blocked');
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
  // v0.1-014 / QA batch5：光路高度与谜题 3 一致（约 0.85 m，提灯灯座出光 0.846 m），整条光路水平
  assert.ok(Math.abs(BEAM_Y - 0.85) < 1e-9 && Math.abs(BEAM_Y - S2.beamY) < 1e-9, `测试场 BEAM_Y ${BEAM_Y} 应与谜题 3 的 ${S2.beamY} 一致`);
  assert.ok(Math.abs(BEAM_Y - S2.lampEmitY) <= 0.01, '测试场光高与提灯出光高度差 ≤ 1 cm');
  for (const sgm of p.segments) assert.ok(Math.abs(sgm.from.y - BEAM_Y) < 1e-6 && Math.abs(sgm.to.y - BEAM_Y) < 1e-6, `光段应在 y=${BEAM_Y}：${sgm.from.y}→${sgm.to.y}`);
  run(area.tracer, 1.6);
  assert.ok(ev.includes(area.lock.id));
  area.mirrorA.part.step(0, 1);
  run(area.tracer, DT);
  const p2 = area.tracer.paths.find((x) => x.emitter.id === area.lamp.id);
  assert.notEqual(p2.end, 'receiver');
  area.dispose();
});

test('测试场地点火口（015 C 同一套按 E）：开阀 + 天光 1.0 s → 可点灯不自动点燃，tryIgnite 点燃转暖；I 调试开关 autoIgnite', () => {
  const events = new EventBus();
  const physics = new PhysicsSystem();
  const scene = new THREE.Scene();
  const area = buildBeamTestArea({ scene, physics, events });
  const step = (sec) => {
    for (let i = 0; i < Math.round(sec / DT); i++) area.fixedUpdate(DT);
  };
  assert.equal(area.autoIgnite, false, '默认按 E');
  assert.equal(area.tryIgnite(), false, '没开阀按 E 无效');
  step(1.5);
  assert.equal(area.igniter.state, 'blocked', '未开阀：红光');
  area.setOil(true);
  step(1.1);
  assert.equal(area.igniter.state, 'ready');
  step(3);
  assert.equal(area.igniter.state, 'ready', '不自动点燃');
  assert.equal(area.sky.color, 'coldWhite', '可点灯仍是冷白');
  assert.equal(area.tryIgnite(), true);
  assert.ok(area.igniter.activated);
  assert.equal(area.sky.color, 'warm', '点燃后天光转暖');
  area.dispose();
  // 调试开关：可点灯即自动点燃
  const events2 = new EventBus();
  const area2 = buildBeamTestArea({ scene: new THREE.Scene(), physics: new PhysicsSystem(), events: events2 });
  area2.autoIgnite = true;
  area2.setOil(true);
  for (let i = 0; i < 70; i++) area2.fixedUpdate(DT);
  assert.ok(area2.igniter.activated);
  area2.dispose();
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

// 裁定 25 程序 P2：S3 体积灯束（render/lampBeam.ts）—— 末端淡到 0（没有圆盘）、侧面淡化、横向软边、开口圆锥无端盖、贴图缺失可建
test('裁定 25 灯束：沿长度起点淡入 / 末端 0、侧面 fresnel 淡化、软边、无端盖、?art=0 无辉光', () => {
  const B = LAMP_BEAM;
  assert.ok(lampBeamAlong(0) === 0 && lampBeamAlong(B.startFade[0]) === 0, '灯处（灯室里）不画实心带');
  assert.equal(lampBeamAlong(B.length), 0, '末端亮度 0（旧实现末端是硬边开口 → 圆盘）');
  assert.ok(lampBeamAlong(B.length * 0.97) < 0.01, '末端前 3% 已近 0：' + lampBeamAlong(B.length * 0.97));
  let prev = Infinity;
  for (let m = B.startFade[1]; m <= B.length; m += 0.5) {
    const v = lampBeamAlong(m);
    assert.ok(v <= prev + 1e-12, `淡入之后单调衰减 @${m}`);
    prev = v;
  }
  assert.ok(Math.abs(lampBeamPhase(0) - B.sideMin) < 1e-9, '侧面只剩 sideMin');
  assert.ok(lampBeamPhase(1) > lampBeamPhase(-1) && lampBeamPhase(-1) === 1, '迎光看最亮、背光顺轴看 1');
  assert.ok(lampBeamPhase(0.5) < lampBeamPhase(0.9), '越顺轴越亮');
  assert.equal(lampBeamEdge(0), 0, '剪影边缘 0（软边，不是硬边）');
  assert.equal(lampBeamEdge(1), 1);
  const noTex = new LampBeam(0xffb25e);
  assert.equal(noTex.glow, null, '没贴图不建辉光');
  assert.equal(noTex.beams.children.length, 2, '两束背对背');
  const cone = noTex.beams.children[0];
  const pos = cone.geometry.attributes.position;
  let minR = Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), r = Math.hypot(pos.getY(i), pos.getZ(i));
    minR = Math.min(minR, r); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  assert.ok(minR > 0.3, '开口圆锥没有端盖（没有半径 0 的盖心顶点）：' + minR);
  assert.ok(Math.abs(minX) < 1e-6 && Math.abs(maxX - B.length) < 1e-6, '灯处在原点、沿 +X 延伸 ' + [minX, maxX]);
  const fake = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const lit = new LampBeam(0xffb25e, { noise: fake, glow: fake });
  assert.ok(lit.glow && !lit.visible, '有贴图 → 辉光；默认熄灭');
  lit.setOn(true);
  lit.update(1);
  assert.ok(lit.glow.material.uniforms.uIntensity.value > 0 && lit.glow.material.uniforms.uIntensity.value < LAMP_GLOW.intensity, '辉光 2.5 s 淡入中');
  lit.update(5);
  assert.ok(Math.abs(lit.glow.material.uniforms.uIntensity.value - LAMP_GLOW.intensity) < 1e-9, '淡入完 = 028 glow.intensity');
  assert.ok(Math.abs(lit.beams.rotation.y - 6 * B.spin) < 1e-9, '旋转速度不变');
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
