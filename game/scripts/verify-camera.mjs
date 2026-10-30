// v0.1-003 第三人称相机校验（纯逻辑，无 DOM）：距离 / 滚轮 / 俯仰范围、遮挡前拉与 0.25 s 恢复、室内 ≤ 2 m、
// FOV（观察 30° / 小跑 58°）、机关机位 0.6 s 进出、观察点对准度、演出 5 s + 0.8 s 交还、建立镜头 3 s。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-camera.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { EventBus } from '@/core/EventBus';
import { InputManager } from '@/systems/input/InputManager';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { CameraFollowSystem, CameraTrack, collectIndoorVolumes, cameraHeightCeiling, expandHeightCaps } from '@/systems/CameraFollowSystem';
import { s2CameraHeightCaps, slopeY } from '@/levels/s2/layout';
import { ViewpointTarget, viewAlignment } from '@/entities/components/ViewpointTarget';
import { buildTestCourse } from '@/world/testCourse';

const cfg = gameplay.camera;
const DEG = Math.PI / 180;
const DT = 1 / 60;
const results = [];
async function test(name, fn) {
  try {
    const note = await fn();
    results.push([name, null, note]);
  } catch (e) {
    results.push([name, e]);
  }
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} 期望 ${b}±${eps}，实际 ${a}`);

function setup(opts = {}) {
  let t = 0;
  const events = new EventBus();
  const input = new InputManager(events, () => t);
  const course = buildTestCourse(new THREE.MeshBasicMaterial());
  const physics = new PhysicsSystem();
  physics.addFromModel(course.root);
  const camera = new THREE.PerspectiveCamera(cfg.fov, 16 / 9, 0.1, 500);
  const state = { running: false };
  const cam = new CameraFollowSystem(camera, input, { physics, events, isRunning: () => state.running, ...opts });
  cam.indoorVolumes = collectIndoorVolumes(course.root);
  const target = new THREE.Object3D();
  cam.target = target;
  cam.yaw = 0;
  cam.pitch = -0.3;
  const frame = (dt = DT) => {
    t += dt;
    input.beginFrame();
    cam.update(dt);
    input.endFrame();
  };
  const run = (seconds, each) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      frame();
      each?.(i + 1);
    }
  };
  /** 相机球（略小于碰撞半径）是否和场景重叠 */
  const inside = () => physics.sphereCast(camera.position, new THREE.Vector3(0, 1, 0), cfg.collisionRadius * 0.75, 0.01) === 0;
  return { events, input, course, physics, camera, cam, target, frame, run, state, inside };
}
const OPEN = new THREE.Vector3(15, 0, 0);

await test('默认距离 4.0 m、跟随点头部 1.35 m + 肩后偏右 0.4 m、FOV 55°', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  e.run(0.5);
  near(e.cam.currentDistance, 4, 1e-3, '距离');
  const pivot = new THREE.Vector3(OPEN.x + 0.4, cfg.pivotHeight, OPEN.z);
  near(e.camera.position.distanceTo(pivot), 4, 1e-3, '相机到跟随点');
  near(e.camera.fov, 55, 1e-6, 'FOV');
  // 镜头朝前方向 = 跟随点方向
  const dir = pivot.clone().sub(e.camera.position).normalize();
  assert.ok(dir.dot(e.camera.getWorldDirection(new THREE.Vector3())) > 0.9999);
});

await test('滚轮 2.5–6.0，俯仰 -35° 到 +55°', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  e.frame();
  for (let i = 0; i < 20; i++) {
    e.input.addWheel(100);
    e.frame();
  }
  assert.equal(e.cam.distance, 6);
  for (let i = 0; i < 20; i++) {
    e.input.addWheel(-100);
    e.frame();
  }
  assert.equal(e.cam.distance, 2.5);
  e.input.addWheel(300);
  e.frame();
  assert.equal(e.cam.distance, 4);
  e.input.addLook(0, 100000);
  e.frame();
  near(e.cam.pitch, -35 * DEG, 1e-9, '俯视极限');
  e.input.addLook(0, -100000);
  e.frame();
  near(e.cam.pitch, 55 * DEG, 1e-9, '仰视极限');
});

await test('贴墙：立即前拉、相机不进墙；离开后 0.25 s 平滑恢复', () => {
  const e = setup();
  e.cam.yaw = Math.PI; // 面朝 +Z，相机在 -Z 一侧（长墙后面）
  e.cam.pitch = -0.1;
  e.target.position.set(-4, 0, -9);
  e.run(0.5);
  near(e.cam.currentDistance, 4, 1e-3, '空旷处');
  e.target.position.set(-4, 0, -13.2);
  e.frame();
  assert.ok(e.cam.currentDistance < 1, `同一帧前拉，实际 ${e.cam.currentDistance}`);
  assert.ok(e.camera.position.z > -13.8 + cfg.collisionRadius - 0.02, `相机在墙前，z=${e.camera.position.z}`);
  assert.ok(!e.inside(), '相机不与墙重叠');
  e.run(0.3);
  const pulled = e.cam.currentDistance;
  e.target.position.set(-4, 0, -9);
  const samples = [];
  e.run(0.4, () => samples.push(e.cam.currentDistance));
  const k = samples.findIndex((d) => d >= 4 - 1e-6);
  const tDone = (k + 1) * DT;
  assert.ok(tDone > 0.2 && tDone <= 0.25 + DT + 1e-9, `恢复用时 ${tDone.toFixed(3)} s`);
  const mid = samples[Math.round(0.125 / DT) - 1];
  assert.ok(mid > pulled + 0.3 && mid < 3.7, `中途是平滑过渡，0.125 s 时 ${mid}`);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1] - 1e-9, '恢复单调');
});

await test('室内（-indoor 触发体）最大距离 2.0 m；穿窄门时相机不进墙', () => {
  const e = setup();
  const room = e.course.anchors.room;
  e.cam.yaw = Math.PI; // 从门外朝屋里走（+Z）
  e.cam.pitch = -0.25;
  e.target.position.copy(room.outside);
  e.run(0.5);
  assert.equal(e.cam.indoor, false);
  near(e.cam.currentDistance, 4, 1e-3, '门外');
  let worst = 0;
  for (let z = room.outside.z; z <= room.inside.z; z += 1.6 * DT) {
    e.target.position.set(room.inside.x, 0, z);
    e.frame();
    assert.ok(!e.inside(), `z=${z.toFixed(2)} 相机进墙 ${e.camera.position.toArray().map((v) => v.toFixed(2))}`);
    if (e.cam.indoor) worst = Math.max(worst, e.cam.currentDistance);
  }
  e.run(0.5);
  assert.equal(e.cam.indoor, true);
  assert.ok(e.cam.currentDistance <= cfg.indoorMaxDistance + 1e-9, `室内距离 ${e.cam.currentDistance}`);
  assert.ok(worst <= cfg.indoorMaxDistance + 1e-9, `室内最大 ${worst}`);
  // 室内滚轮拉远也不超过 2
  e.input.addWheel(300);
  e.run(0.5);
  assert.ok(e.cam.currentDistance <= cfg.indoorMaxDistance + 1e-9);
});

await test('观察模式：按住右键 FOV 0.3 s 到 30°、灵敏度 ×0.5、发 camera:observe；松开回 55°；小跑 58°', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  const got = [];
  e.events.on('camera:observe', (p) => got.push(p));
  e.run(0.2);
  e.input.setRaw('kbm', 'Mouse2', true);
  e.run(0.15);
  assert.ok(e.camera.fov < 55 && e.camera.fov > 30, `过渡中 ${e.camera.fov}`);
  e.run(0.16);
  near(e.camera.fov, 30, 1e-6, '观察 FOV');
  assert.equal(e.input.lookScale, 0.5);
  assert.equal(got[0]?.active, true);
  assert.ok(got[0].focusDistance > 0);
  e.input.setRaw('kbm', 'Mouse2', false);
  e.run(0.31);
  near(e.camera.fov, 55, 1e-6, '松开');
  assert.equal(e.input.lookScale, 1);
  assert.equal(got.at(-1)?.active, false);
  e.state.running = true;
  e.run(0.31);
  near(e.camera.fov, 58, 1e-6, '小跑');
});

await test('固定观察眼位（裁定 16）：按住右键 → 过渡到眼位、FOV 固定、朝 enterYaw，眼位不随角色动；鼠标照转；松开平滑回第三人称、朝向恢复', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  const eyePos = new THREE.Vector3(15.5, 4.35, 1);
  let allow = true;
  e.cam.observeEye = () => (allow ? { position: eyePos, fov: 30, enterYaw: -1.2, enterPitch: -0.24 } : null);
  e.cam.yaw = 0.4;
  e.cam.pitch = -0.3;
  e.run(0.2);
  const third = e.camera.position.clone();
  e.input.setRaw('kbm', 'Mouse2', true);
  let maxStep = 0;
  let prev = e.camera.position.clone();
  e.run(cfg.observeEyeBlendTime * 0.5, () => {
    maxStep = Math.max(maxStep, e.camera.position.distanceTo(prev));
    prev.copy(e.camera.position);
  });
  assert.ok(e.cam.eyeActive && e.cam.observing, '过渡中仍算观察');
  assert.ok(e.camera.position.distanceTo(eyePos) > 0.05 && e.camera.position.distanceTo(third) > 0.05, '过渡中在两者之间');
  e.run(cfg.observeEyeBlendTime * 0.6, () => {
    maxStep = Math.max(maxStep, e.camera.position.distanceTo(prev));
    prev.copy(e.camera.position);
  });
  assert.ok(maxStep < third.distanceTo(eyePos) * 0.2, `过渡每帧位移 ${maxStep.toFixed(3)} 应平滑`);
  near(e.camera.position.distanceTo(eyePos), 0, 1e-6, '到眼位');
  near(e.camera.fov, 30, 1e-6, '眼位 FOV');
  near(e.cam.yaw, -1.2, 1e-9, '进入朝向 yaw');
  near(e.cam.pitch, -0.24, 1e-9, '进入朝向 pitch');
  e.target.position.x += 0.3;
  e.run(0.1);
  near(e.camera.position.distanceTo(eyePos), 0, 1e-6, '角色动了眼位不变');
  e.cam.yaw = -1.0;
  e.run(DT);
  const f = e.camera.getWorldDirection(new THREE.Vector3());
  near(Math.atan2(-f.x, -f.z), -1.0, 1e-6, '眼位里照常转视线');
  e.input.setRaw('kbm', 'Mouse2', false);
  e.run(DT);
  assert.ok(!e.cam.eyeActive && !e.cam.observing);
  near(e.cam.yaw, 0.4, 1e-9, '松开 yaw 恢复');
  near(e.cam.pitch, -0.3, 1e-9, '松开 pitch 恢复');
  assert.ok(e.camera.position.distanceTo(eyePos) < 0.2, '松开第一帧不跳');
  e.run(cfg.observeEyeBlendTime + 0.35);
  assert.ok(e.camera.position.distanceTo(eyePos) > 2, '回到第三人称');
  near(e.camera.fov, 55, 1e-6, '回 55°');
  // 不在观察点（返回 null）= 普通第三人称观察
  allow = false;
  e.input.setRaw('kbm', 'Mouse2', true);
  e.run(0.4);
  assert.ok(e.cam.observing && !e.cam.eyeActive && e.camera.position.distanceTo(eyePos) > 2);
  near(e.camera.fov, 30, 1e-6);
  // 眼位中进机关：眼位直接退出
  allow = true;
  e.input.setRaw('kbm', 'Mouse2', false);
  e.run(0.5);
  e.input.setRaw('kbm', 'Mouse2', true);
  e.run(0.6);
  assert.ok(e.cam.eyeActive);
  const node = new THREE.Object3D();
  node.position.set(14, 1.5, 3);
  e.cam.enterPuzzleView(node);
  assert.ok(!e.cam.eyeActive && !e.cam.observing);
  e.input.setRaw('kbm', 'Mouse2', false);
});

await test('自动回正：设置开启时静止 8 s 后以 4°/s 漂向推荐构图；关闭时不动', () => {
  for (const on of [false, true]) {
    const e = setup({ autoRecenter: () => on });
    e.target.position.copy(OPEN);
    e.cam.recommended = { yaw: 1, pitch: -0.3 };
    e.run(7.9);
    assert.equal(e.cam.yaw, 0);
    e.run(1.1);
    if (on) near(e.cam.yaw, (cfg.autoRecenterSpeedDeg * DEG) * 1.0, 0.01, '1 s 漂移');
    else assert.equal(e.cam.yaw, 0);
  }
});

await test('机关机位：0.6 s 过渡到 -cam 节点、±20° 小范围转动；退出 0.6 s 回到进入前朝向', () => {
  const e = setup();
  const mech = e.course.anchors.mechanism;
  e.target.position.copy(mech.stand);
  e.cam.yaw = 0.4;
  e.cam.pitch = -0.2;
  e.run(0.5);
  const before = { pos: e.camera.position.clone(), quat: e.camera.quaternion.clone() };
  const pop = e.input.pushContext('puzzle');
  e.cam.enterPuzzleView(mech.cam);
  e.run(0.3);
  assert.ok(e.cam.blending, '0.3 s 时还在过渡');
  e.run(0.3);
  const nodePos = mech.cam.getWorldPosition(new THREE.Vector3());
  near(e.camera.position.distanceTo(nodePos), 0, 1e-4, '到达机位');
  const fwd = e.camera.getWorldDirection(new THREE.Vector3());
  const want = mech.center.clone().sub(nodePos).normalize();
  assert.ok(fwd.dot(want) > 0.9999, '看向机关');
  e.input.addLook(100000, 0);
  e.frame();
  near(e.cam.puzzleOffsetDeg.yaw, -20, 1e-6, '小范围转动上限');
  assert.equal(e.cam.yaw, 0.4, '机关里不改探索朝向');
  pop();
  e.cam.exitPuzzleView();
  e.run(0.3);
  assert.ok(e.cam.blending);
  e.run(0.31);
  assert.equal(e.cam.modeName, 'explore');
  assert.ok(!e.cam.blending);
  near(e.camera.position.distanceTo(before.pos), 0, 1e-3, '回到进入前位置');
  assert.ok(e.camera.quaternion.angleTo(before.quat) < 1e-3, '回到进入前朝向');
});

await test('观察点对准度：≤6° 为 1、12° 内逐渐清晰、区域外 0', () => {
  assert.equal(viewAlignment(0), 1);
  assert.equal(viewAlignment(6), 1);
  near(viewAlignment(9), 0.5, 1e-9);
  assert.equal(viewAlignment(12), 0);
  assert.equal(viewAlignment(30), 0);
  const pos = new THREE.Vector3(0, 1.5, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const player = new THREE.Vector3(0, 0, 0);
  const vp = new ViewpointTarget({ center: new THREE.Vector3(), radius: 0.8, target: new THREE.Vector3(0, 1.5, -10), view: () => ({ position: pos, forward }), player: () => player });
  assert.equal(vp.evaluate(), 1);
  forward.set(Math.sin(9 * DEG), 0, -Math.cos(9 * DEG));
  near(vp.evaluate(), 0.5, 1e-6);
  forward.set(0, 0, -1);
  player.set(2, 0, 0);
  assert.equal(vp.evaluate(), 0);
  assert.equal(vp.inRegion, false);
});

function testTrack(seconds) {
  const keys = [0, 1, 2, 3, 4, 5].map((i) => ({
    time: (i / 5) * seconds,
    position: new THREE.Vector3(Math.sin(i) * 6, 3, Math.cos(i) * 6),
    lookAt: new THREE.Vector3(0, 1, 0),
  }));
  return new CameraTrack({ keys, duration: seconds, ease: false });
}

await test('演出 5 s：角色不能动、按轨道走；结束 0.8 s 交还，朝向保持演出前', async () => {
  const e = setup();
  e.target.position.copy(OPEN);
  e.cam.yaw = 0.7;
  e.run(0.5);
  const before = e.camera.quaternion.clone();
  let done = false;
  const track = testTrack(5);
  const p = e.cam.playCutscene(track).then(() => (done = true));
  e.input.setRaw('kbm', 'KeyW', true);
  e.run(2.5);
  assert.equal(e.input.context, 'cutscene');
  assert.deepEqual(e.input.getMove(), { x: 0, y: 0 }, '演出中不能移动');
  e.input.addLook(500, 300);
  const s = track.sample(2.5, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 0 });
  near(e.camera.position.distanceTo(s.position), 0, 1e-3, '按轨道');
  e.input.setRaw('kbm', 'KeyW', false);
  e.run(2.5);
  assert.equal(e.input.context, 'explore', '5 s 后交还输入');
  assert.ok(e.cam.blending, '交还过渡中');
  e.run(0.4);
  assert.ok(e.cam.blending);
  e.run(0.41);
  await p;
  assert.ok(done, '交还完成时 resolve');
  assert.equal(e.cam.yaw, 0.7, 'yaw 保持');
  assert.ok(e.camera.quaternion.angleTo(before) < 1e-6, '朝向与演出前一致');
});

await test('演出可按住空格 1 s 跳过', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  e.frame();
  void e.cam.playCutscene(testTrack(5));
  e.input.setRaw('kbm', 'Space', true);
  e.run(1.1);
  e.input.setRaw('kbm', 'Space', false);
  assert.equal(e.input.context, 'explore');
  assert.equal(e.cam.modeName, 'explore');
});

await test('v0.1-013 裁定：画质检测第 1 轮没测完就跳过开场演出 → 接 3 s 不可跳过的 S1 建立镜头，最后一帧最多再等 5 s 不变', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  e.frame();
  let ready = false;
  const hold = () => ready;
  const shot = (name, skippable, x) =>
    new CameraTrack({ name, skippable, duration: cfg.establishingTime, ease: false, holdUntil: hold, keys: [0, 1].map((i) => ({ time: i * cfg.establishingTime, position: new THREE.Vector3(x + i, 3, 6), lookAt: new THREE.Vector3(0, 1, 0) })) });
  const KEYS5 = [0, 1].map((i) => ({ time: i * 5, position: new THREE.Vector3(i, 3, 6), lookAt: new THREE.Vector3(0, 1, 0) }));
  const opening = new CameraTrack({ name: 'opening', duration: 5, holdUntil: hold, keys: KEYS5, onSkip: () => (ready ? null : shot('s1-establishing-hold', false, 20)) });
  assert.equal(shot('x', false, 0).skippable, false);
  assert.equal(testTrack(1).skippable, true, 'skippable 默认开');
  void e.cam.playEstablishing(opening);
  // 按住空格 1 s 跳过开场
  e.input.setRaw('kbm', 'Space', true);
  e.run(1.1);
  assert.equal(e.cam.cutsceneName, 's1-establishing-hold', '跳过后应接 3 s 建立镜头');
  // 继续按住空格（再触发一次跳过）也不能跳
  e.input.setRaw('kbm', 'Space', false);
  e.frame();
  e.input.setRaw('kbm', 'Space', true);
  e.run(1.2);
  e.input.setRaw('kbm', 'Space', false);
  assert.equal(e.cam.cutsceneName, 's1-establishing-hold', '3 s 镜头不可跳过');
  assert.equal(e.input.context, 'cutscene');
  e.run(cfg.establishingTime - 1.2 - DT * 2 + 0.3);
  near(e.camera.position.x, 21, 1e-3, '3 s 播完停在最后一帧');
  // 最后一帧最多再等 5 s（maxHold 默认 5）
  e.run(4.5);
  assert.equal(e.input.context, 'cutscene', '检测没完成时在最后一帧等');
  e.run(0.6);
  assert.equal(e.cam.modeName === 'cutscene', false, '超过 5 s 交还');
  // 第 1 轮已测完时跳过 = 照常跳到最后一帧并交还
  const e2 = setup();
  e2.target.position.copy(OPEN);
  e2.frame();
  ready = true;
  void e2.cam.playEstablishing(new CameraTrack({ name: 'opening', duration: 5, holdUntil: hold, keys: KEYS5, onSkip: () => (ready ? null : shot('s1-establishing-hold', false, 20)) }));
  e2.input.setRaw('kbm', 'Space', true);
  e2.run(1.1);
  e2.input.setRaw('kbm', 'Space', false);
  assert.equal(e2.input.context, 'explore', '检测已完成：跳过直接交还');
});

await test('建立镜头 3 s：期间不能移动，结束交还控制', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  void e.cam.playEstablishing(testTrack(cfg.establishingTime));
  e.run(1.5);
  assert.equal(e.input.context, 'cutscene');
  e.run(1.5 + DT);
  assert.equal(e.input.context, 'explore');
});

await test('建立镜头 holdUntil：轨道播完停在最后一帧等条件（画质检测第一轮），条件满足 / 超时才交还', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  let ready = false;
  const keys = testTrack(cfg.establishingTime);
  const track = new CameraTrack({ keys: [0, 1].map((i) => ({ time: i * cfg.establishingTime, position: new THREE.Vector3(i * 4, 3, 6), lookAt: new THREE.Vector3(0, 1, 0) })), duration: cfg.establishingTime, ease: false, holdUntil: () => ready, maxHold: 2 });
  void keys;
  void e.cam.playEstablishing(track);
  e.run(cfg.establishingTime + 0.5);
  assert.equal(e.input.context, 'cutscene', '条件没满足时应停在镜头里');
  near(e.camera.position.x, 4, 1e-3, '停在最后一帧');
  ready = true;
  e.run(DT * 2);
  assert.equal(e.input.context, 'explore', '条件满足后交还');
  // 超时
  const e2 = setup();
  e2.target.position.copy(OPEN);
  void e2.cam.playEstablishing(new CameraTrack({ keys: [{ time: 0, position: new THREE.Vector3(0, 3, 6), lookAt: new THREE.Vector3() }, { time: 1, position: new THREE.Vector3(1, 3, 6), lookAt: new THREE.Vector3() }], holdUntil: () => false, maxHold: 1 }));
  e2.run(1.9);
  assert.equal(e2.input.context, 'cutscene');
  e2.run(0.2);
  assert.equal(e2.input.context, 'explore', '超过 maxHold 也交还');
});

await test('换场景（dispose）时中断演出并交还输入上下文', async () => {
  const e = setup();
  e.target.position.copy(OPEN);
  let done = false;
  const p = e.cam.playCutscene(testTrack(5)).then(() => (done = true));
  e.run(1);
  assert.equal(e.input.context, 'cutscene');
  e.cam.dispose();
  await p;
  assert.ok(done);
  assert.equal(e.input.context, 'explore');
});

await test('演出轨道也可跟随 GLB 相机动画节点（AnimationMixer 驱动，读节点 fov）', () => {
  const e = setup();
  e.target.position.copy(OPEN);
  const node = new THREE.PerspectiveCamera(40);
  const clip = new THREE.AnimationClip('cam', 2, [new THREE.VectorKeyframeTrack('.position', [0, 2], [0, 2, 0, 10, 2, 0])]);
  const mixer = new THREE.AnimationMixer(node);
  mixer.clipAction(clip).play();
  void e.cam.playCutscene(new CameraTrack({ node, duration: 2 }));
  for (let i = 0; i < 60; i++) {
    mixer.update(DT);
    e.frame();
  }
  near(e.camera.position.x, 5, 0.1, '1 s 时在中点');
  near(e.camera.fov, 40, 1e-6, '节点 fov');
});

await test('裁定 19 室外限高带：带内相机 ≤ 视线 − margin、出带平滑放开（逐帧位移无跳变）', () => {
  // 视线从 (0, 4, 0) 朝 +X、每米降 0.3
  const L = Math.hypot(1, 0.3);
  const cap = (o) => ({ origin: o, dir: { x: 1 / L, y: -0.3 / L, z: 0 }, from: 1, to: 10, halfWidth: 2, margin: 0.5, fade: 1.5 });
  const caps = [cap({ x: 0, y: 4, z: 0 })];
  near(cameraHeightCeiling(caps, 5, 0), 4 - 1.5 - 0.5, 1e-9, '带内限高');
  assert.equal(cameraHeightCeiling(caps, 5, 5), Infinity);
  const cc = (x, z) => Math.min(cameraHeightCeiling(caps, x, z), 100);
  let prev = cc(5, 4);
  for (let z = 3.99; z >= 0; z -= 0.01) {
    const c = cc(5, z);
    assert.ok(prev >= 99 || c >= 99 || Math.abs(c - prev) < 0.5, `z ${z.toFixed(2)} 限高跳变 ${prev} → ${c}`);
    prev = c;
  }
  const e = setup();
  e.target.position.copy(OPEN);
  e.cam.yaw = -Math.PI / 2; // 看 +X，相机在 −X 侧
  e.cam.pitch = -0.6;
  for (let i = 0; i < 30; i++) e.frame();
  const free = e.camera.position.clone();
  // 带放在相机所在处、视线高度让限高低于当前相机
  e.cam.heightCaps = [cap({ x: free.x - 3, y: free.y - 0.2, z: free.z })];
  const ceil = cameraHeightCeiling(e.cam.heightCaps, free.x, free.z);
  assert.ok(ceil < free.y, '测试前提：限高低于自由相机');
  let last = e.camera.position.clone(), maxStep = 0;
  for (let i = 0; i < 30; i++) {
    e.frame();
    maxStep = Math.max(maxStep, e.camera.position.distanceTo(last));
    last = e.camera.position.clone();
  }
  assert.ok(e.cam.heightCapped, '距离被限高压短');
  assert.ok(e.camera.position.y <= Math.max(OPEN.y + gameplay.camera.pivotHeight + 0.5, cameraHeightCeiling(e.cam.heightCaps, e.camera.position.x, e.camera.position.z)) + 0.02, `相机 y ${e.camera.position.y} 超限高`);
  e.cam.heightCaps = [];
  maxStep = 0;
  for (let i = 0; i < 60; i++) {
    e.frame();
    maxStep = Math.max(maxStep, e.camera.position.distanceTo(last));
    last = e.camera.position.clone();
  }
  assert.ok(maxStep < 0.5, `放开时单帧位移 ${maxStep}`);
  near(e.camera.position.distanceTo(free), 0, 0.05, '放开后回到原机位');
});

await test('BUG-019 西窗外限高带：走入 / 侧入 / 退出相机位置逐帧连续（60 Hz：进带单帧 ≤ 0.25 m、全程 ≤ 0.6 m），任何一帧不高过真实限高', () => {
  // 与 S2 同一函数、同一视线（QA batch12 cam19 复算用的白石视线：眼 (0.95, 4.35, 1) → 字组中心）；不挂物理（只看限高），玩家贴坡面
  const eye = { x: 0.95, y: 4.35, z: 1 };
  const tgt = { x: eye.x + 0.9543876579245467 * 20, y: eye.y - 0.2985702570605802 * 20, z: 1 };
  const caps = s2CameraHeightCaps(eye, tgt);
  const c = caps[0];
  const hl = Math.hypot(c.dir.x, c.dir.z);
  const P = (s, lat) => ({ x: c.origin.x + (c.dir.x / hl) * s - (c.dir.z / hl) * lat, z: c.origin.z + (c.dir.z / hl) * s + (c.dir.x / hl) * lat });
  // 单帧上限：进带 0.25 m（过渡区限速 8 m/s = 0.134 m/帧 + 跑步 0.053 m/帧 + 余量）；退出走 0.25 s smoothstep 恢复（峰值 ≈ 1.5 × 5.1 m / 0.25 s / 60 ≈ 0.51 m/帧），全程上限 0.6 m
  const ENTER_MAX = 0.25, ANY_MAX = 0.6;
  const yawPlusX = Math.PI / 2; // 相机在玩家 +x 侧（朝房子看）
  const paths = [
    ['沿视线走向房子 s 13→2', [13, 0], [2, 0], yawPlusX, true],
    ['沿视线离开 s 2→13', [2, 0], [13, 0], yawPlusX, false],
    ['横穿入带 lat 6→0（s 5.5，相机在 +x 侧）', [5.5, 6], [5.5, 0], yawPlusX, true],
    ['横穿入带 lat 6→0（s 5.5，相机在身后 +z 侧）', [5.5, 6], [5.5, 0], 0, true],
    ['横穿入带 lat −6→0（s 8，相机在身后 −z 侧）', [8, -6], [8, 0], Math.PI, true],
    ['横穿出带 lat 0→6（s 5.5）', [5.5, 0], [5.5, 6], yawPlusX, false],
    ['斜入 s 12 lat 5 → s 4 lat 0', [12, 5], [4, 0], yawPlusX, true],
  ];
  const lines = [];
  for (const speed of [gameplay.player?.walkSpeed ?? 1.6, 3.2]) {
    for (const [name, a, b, yaw, entering] of paths) {
      const e = setup({ physics: undefined });
      e.cam.heightCaps = caps;
      e.cam.yaw = yaw;
      e.cam.pitch = gameplay.camera.minPitchDeg * (Math.PI / 180); // 俯仰压到最低（相机最高）
      e.cam.distance = gameplay.camera.maxDistance;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.ceil(len / (speed * DT));
      const put = (k) => {
        const t = Math.min(k / n, 1);
        const p = P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        e.target.position.set(p.x, slopeY(p.x), p.z);
      };
      put(0);
      for (let i = 0; i < 30; i++) e.frame();
      let last = e.camera.position.clone(), maxStep = 0, maxAt = 0, capped = 0, over = 0;
      for (let k = 1; k <= n + 30; k++) {
        put(k);
        e.frame();
        const st = e.camera.position.distanceTo(last);
        if (st > maxStep) [maxStep, maxAt] = [st, k];
        last = e.camera.position.clone();
        if (e.cam.heightCapped) capped++;
        const floorY = e.target.position.y + gameplay.camera.pivotHeight + 0.5;
        const ceil = Math.max(floorY, cameraHeightCeiling(caps, e.camera.position.x, e.camera.position.z));
        over = Math.max(over, e.camera.position.y - ceil);
      }
      lines.push(`${name} @${speed} m/s：单帧最大 ${maxStep.toFixed(3)} m（第 ${maxAt} 帧），限高帧 ${capped}`);
      assert.ok(capped > 0 || !entering, `${name}：测试前提——路径要进带（限高帧 0）`);
      assert.ok(over <= 0.02, `${name} @${speed}：相机高过真实限高 ${over.toFixed(3)} m`);
      assert.ok(maxStep <= (entering ? ENTER_MAX : ANY_MAX), `${name} @${speed}：单帧位移 ${maxStep.toFixed(3)} m 超上限`);
    }
  }
  // 外扩带限高处处 ≤ 原带（过渡区只会更早收，不会放高）
  const lead = expandHeightCaps(caps, gameplay.camera.heightCapLeadPad);
  for (let x = -2; x <= 26; x += 0.25) for (let z = -8; z <= 10; z += 0.25) assert.ok(cameraHeightCeiling(lead, x, z) <= cameraHeightCeiling(caps, x, z) + 1e-9, `外扩带在 (${x}, ${z}) 比原带高`);
  return lines.join('\n   ');
});

let failed = 0;
for (const [name, err, note] of results) {
  if (err) {
    failed++;
    console.log(`✗ ${name}\n   ${err.message}`);
  } else console.log(`✓ ${name}${note ? `\n   ${note}` : ''}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n相机校验全部通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
