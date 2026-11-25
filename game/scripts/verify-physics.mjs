// v0.1-002 角色物理校验（纯逻辑，无 DOM）：坡度、台阶、螺旋楼梯、贴墙滑动、动态碰撞体、移动速度、碰撞耗时。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-physics.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { CharacterBody, PhysicsSystem } from '@/systems/PhysicsSystem';
import { StairGait, stepLocomotion } from '@/systems/locomotion';
import { buildTestCourse } from '@/world/testCourse';
import { TraversalLink, pickTraversalLink } from '@/entities/components/TraversalLink';
import { buildS1Greybox } from '@/levels/s1/greybox';
import { S1, pierPoint, s1StepLinks } from '@/levels/s1/layout';
import { S1_ROCKS } from '@/levels/s1/rocks';
import { polygonRegion } from '@/systems/tide/TideController';
import { readFileSync } from 'node:fs';
import { buildS2Greybox } from '@/levels/s2/greybox';
import { S2 } from '@/levels/s2/layout';
import { buildVillage } from '@/levels/ch2/village';
import { CABLE_FROM, CABLE_TO, STAGES, TERRACES } from '@/levels/ch2/layout';
import { addHarbourColliders, HarbourPuzzles, QUAY_START, QUAY_END, HIGH_WATER, LOW_WATER, WATER_SEAM } from '@/levels/ch2/harbour';
import { LANTERN, MirrorRelay, RECEIVER, RELAY } from '@/levels/ch2/mirrorRelay';
import { MirrorAlleyArt } from '@/levels/ch2/mirrorAlleyArt';
import { LighthouseArt } from '@/levels/ch2/lighthouseArt';
import { CableCar, PRISM_CONTROL, PRISM_DETENTS, PrismSplitter, WINCH } from '@/levels/ch2/lighthousePuzzles';

const DT = 1 / 60;
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push([name]);
  } catch (e) {
    results.push([name, e]);
  }
}

function setup() {
  const course = buildTestCourse(new THREE.MeshBasicMaterial());
  const physics = new PhysicsSystem();
  const colliders = physics.addFromModel(course.root);
  const gate = colliders.find((c) => c.name === 'gate-collider');
  const lift = colliders.find((c) => c.name === 'lift-collider');
  const body = new CharacterBody();
  physics.addBody(body);
  return { course, physics, body, colliders, gate, lift };
}

/** 放到 p 并让它落地站稳 */
function place(env, p) {
  env.body.teleport(p);
  for (let i = 0; i < 30; i++) env.physics.step(DT);
}

/** 朝固定方向以 speed 走 seconds 秒；返回每步记录 */
function walk(env, dir, speed, seconds, onStep) {
  const d = dir.clone().setY(0).normalize();
  const log = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    env.body.velocity.x = d.x * speed;
    env.body.velocity.z = d.z * speed;
    env.physics.step(DT);
    log.push(env.body.position.clone());
    onStep?.(i);
  }
  env.body.velocity.set(0, 0, 0);
  return log;
}

const RUN = gameplay.player.runSpeed;
const WALK = gameplay.player.walkSpeed;

test('掉出世界：每个角色只通知一次，回到边界内后可再次触发', () => {
  const physics = new PhysicsSystem();
  const a = new CharacterBody();
  const b = new CharacterBody();
  physics.addBody(a);
  physics.addBody(b);
  const falls = [];
  physics.onFallOut = (body) => falls.push(body);
  const below = new THREE.Vector3(0, physics.killY - 1, 0);
  a.teleport(below);
  for (let i = 0; i < 30; i++) physics.step(DT);
  assert.deepEqual(falls, [a]);

  a.teleport(new THREE.Vector3());
  b.teleport(below);
  physics.step(DT);
  a.teleport(below);
  for (let i = 0; i < 30; i++) physics.step(DT);
  assert.deepEqual(falls, [a, b, a]);
});

test('站在地面上：落地、onGround、不下沉', () => {
  const env = setup();
  place(env, new THREE.Vector3(0, 0.5, 4));
  assert.ok(env.body.onGround, 'onGround');
  assert.ok(Math.abs(env.body.position.y) < 1e-3, `y=${env.body.position.y}`);
});

test('30° 坡可以走上去（到顶 ≈ 2.31 m）', () => {
  const env = setup();
  const a = env.course.anchors.ramp30;
  place(env, a.foot);
  walk(env, a.dir, WALK, 4);
  assert.ok(env.body.position.y > a.top - 0.05, `y=${env.body.position.y.toFixed(3)}`);
  assert.ok(env.body.onGround);
});

test('45° 坡走不上去（小跑也不行）', () => {
  const env = setup();
  const a = env.course.anchors.ramp45;
  place(env, a.foot);
  walk(env, a.dir, RUN, 3);
  assert.ok(env.body.position.y < 0.25, `y=${env.body.position.y.toFixed(3)}`);
  assert.ok(env.body.position.z < -3.6, `z=${env.body.position.z.toFixed(3)} 应停在坡脚附近`);
});

test('0.25 m 台阶自动迈上', () => {
  const env = setup();
  const a = env.course.anchors.step25;
  place(env, a.before);
  walk(env, a.dir, WALK, 1.5);
  assert.ok(Math.abs(env.body.position.y - 0.25) < 0.01, `y=${env.body.position.y.toFixed(3)}`);
  assert.ok(env.body.position.z > -2.6, `z=${env.body.position.z.toFixed(3)}`);
});

test('0.4 m 台阶挡住（不穿模）', () => {
  const env = setup();
  const a = env.course.anchors.step40;
  place(env, a.before);
  walk(env, a.dir, RUN, 1.5);
  assert.ok(env.body.position.y < 0.01, `y=${env.body.position.y.toFixed(3)}`);
  // 台阶前沿 z = -3；悬浮胶囊底部在 0.3 m，碰到 0.4 m 的棱时离台阶约 0.2 m
  assert.ok(env.body.position.z <= -3 - 0.18, `z=${env.body.position.z.toFixed(3)}`);
});

test('螺旋楼梯（半径 2.5、每级 0.2 m）连续爬升，无卡顿、无大跳变', () => {
  const env = setup();
  const s = env.course.anchors.spiral;
  const angleOf = (p) => Math.atan2(p.z - s.center.z, p.x - s.center.x);
  const startA = -s.stepAngle;
  place(env, new THREE.Vector3(s.center.x + Math.cos(startA) * s.walkRadius, 0, s.center.z + Math.sin(startA) * s.walkRadius));
  let unwrapped = 0;
  let prevA = angleOf(env.body.position);
  let maxDy = 0;
  let stuckFrames = 0;
  const tangent = new THREE.Vector3();
  for (let i = 0; i < 60 * 14 && unwrapped < Math.PI * 2 * 0.9; i++) {
    const p = env.body.position;
    const a = angleOf(p);
    const rr = Math.hypot(p.x - s.center.x, p.z - s.center.z);
    // 切向（角度增大方向）+ 径向修正，保持在 walkRadius 上
    tangent.set(-Math.sin(a), 0, Math.cos(a)).addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), (s.walkRadius - rr) * 2).normalize();
    env.body.velocity.x = tangent.x * WALK;
    env.body.velocity.z = tangent.z * WALK;
    const y0 = p.y;
    env.physics.step(DT);
    maxDy = Math.max(maxDy, Math.abs(env.body.position.y - y0));
    let da = angleOf(env.body.position) - prevA;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (da < 1e-4) stuckFrames++;
    unwrapped += da;
    prevA = angleOf(env.body.position);
  }
  const expect = Math.floor((unwrapped - s.stepAngle / 2) / s.stepAngle) * s.riser;
  assert.ok(unwrapped >= Math.PI * 2 * 0.9 - 1e-6, `只转了 ${(unwrapped * 180 / Math.PI).toFixed(0)}°（卡住）`);
  assert.ok(env.body.position.y > 3.2, `y=${env.body.position.y.toFixed(2)}，期望约 ${expect.toFixed(2)}`);
  assert.ok(maxDy <= s.riser + 0.01, `单步最大竖直跳变 ${maxDy.toFixed(3)}`);
  assert.ok(stuckFrames < 5, `卡住 ${stuckFrames} 帧`);
});

/** 按控制器的方式走螺旋楼梯：StairGait → stepLocomotion → 物理；dir = +1 上楼 / −1 下楼；返回中段竖直 / 水平平均速度 */
function stairRun(sprint, dir, seconds = 8) {
  const env = setup();
  const s = env.course.anchors.spiral;
  const angleOf = (p) => Math.atan2(p.z - s.center.z, p.x - s.center.x);
  const gait = new StairGait();
  const loco = { vx: 0, vz: 0, facing: 0 };
  // 下楼：先走到上面一圈再往回走
  const a0 = dir > 0 ? -s.stepAngle : Math.PI * 1.6;
  place(env, new THREE.Vector3(s.center.x + Math.cos(a0) * s.walkRadius, dir > 0 ? 0 : 8, s.center.z + Math.sin(a0) * s.walkRadius));
  const tangent = new THREE.Vector3();
  const rec = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const b = env.body;
    const sp = gait.update(DT, b.position.y - b.prevPosition.y, Math.hypot(b.position.x - b.prevPosition.x, b.position.z - b.prevPosition.z), b.onGround);
    const a = angleOf(b.position);
    const rr = Math.hypot(b.position.x - s.center.x, b.position.z - s.center.z);
    tangent.set(-Math.sin(a) * dir, 0, Math.cos(a) * dir).addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), (s.walkRadius - rr) * 2).normalize();
    stepLocomotion(loco, { moveX: 0, moveY: 1, sprint, cameraYaw: Math.atan2(-tangent.x, -tangent.z), fixedSpeed: sp }, DT);
    b.velocity.x = loco.vx;
    b.velocity.z = loco.vz;
    env.physics.step(DT);
    rec.push({ y: b.position.y, x: b.position.x, z: b.position.z, on: sp != null });
  }
  // 1.5 s 之后（已进入稳定步态）：竖直速度按「第一次到最后一次迈台阶」算，避免台阶离散造成的 ±1 级误差
  const i0 = Math.round(1.5 / DT);
  const steps = [];
  for (let i = i0 + 1; i < rec.length; i++) {
    if (Math.abs(rec[i].y - rec[i - 1].y) <= 0.08) continue;
    // 走到楼梯尽头（之后在顶层平台上乱撞的不算）：两级间隔超过 0.6 s 就截止
    if (steps.length && (i - steps.at(-1)) * DT > 0.6) break;
    steps.push(i);
  }
  const i1 = steps.at(-1);
  const ia = steps[0];
  let h = 0;
  for (let i = ia + 1; i <= i1; i++) h += Math.hypot(rec[i].x - rec[i - 1].x, rec[i].z - rec[i - 1].z);
  const T = (i1 - ia) * DT;
  return { vy: (rec[i1].y - rec[ia].y) / T, vh: h / T, onFrac: rec.slice(ia, i1).filter((r) => r.on).length / (i1 - ia), n: steps.length };
}

/**
 * BUG-013 测量口径：楼梯是离散台阶，y 是阶梯函数。取「第一次迈级 → 最后一次迈级」两个跳变时刻算竖直速度（整数个周期，没有量化误差）。
 * 「窗口内第一个 / 最后一个采样点」的端点法会多算一整段平台（首点刚上某级、末点在最后一级平台末尾），按 n 级要低约 1/(n+1)，
 * 采样稀疏时还会 ±1 级抖动——QA batch7 的 0.505–0.518 就是这个口径（同一条轨迹逐 tick 采样用端点法得 0.498）。
 */
function riserToRiser(rec, lo, hi) {
  const steps = [];
  for (let i = 1; i < rec.length; i++) if (Math.abs(rec[i].y - rec[i - 1].y) > 0.08 && rec[i].y > lo && rec[i].y < hi) steps.push(i);
  const a = steps[0];
  const b = steps.at(-1);
  return { vy: (rec[b].y - rec[a].y) / ((b - a) * DT), n: steps.length };
}

test('BUG-013 S2 室内直梯（16 × 0.1875、踏步 0.244）：按控制器走法上 / 下楼，纯楼梯段竖直速度 0.5455 ±1%（迈级到迈级口径）', () => {
  const gb = buildS2Greybox();
  const ph = new PhysicsSystem();
  for (const m of gb.colliders) ph.addMesh(m);
  for (const m of gb.walls) ph.addMesh(m, { kind: 'wall' });
  const S = S2.stair;
  const zc = (S.z[0] + S.z[1]) / 2;
  const top = S.count * S.rise;
  const V = gameplay.player.stairs.verticalSpeed;
  const out = [];
  for (const [dir, sprint] of [
    [1, false],
    [1, true],
    [-1, false],
    [-1, true],
  ]) {
    const b = new CharacterBody();
    ph.addBody(b);
    b.teleport(dir > 0 ? new THREE.Vector3(S.x0 - 0.8, 0.02, zc) : new THREE.Vector3(S.x0 + S.count * S.run + 0.3, top + 0.02, zc));
    for (let i = 0; i < 20; i++) ph.step(DT);
    const gait = new StairGait();
    const loco = { vx: 0, vz: 0, facing: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
    const rec = [];
    for (let i = 0; i < 600; i++) {
      const sp = gait.update(DT, b.position.y - b.prevPosition.y, Math.hypot(b.position.x - b.prevPosition.x, b.position.z - b.prevPosition.z), b.onGround);
      // 上楼朝 +X（相机 yaw −π/2），下楼朝 −X
      stepLocomotion(loco, { moveX: 0, moveY: 1, sprint, cameraYaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2, fixedSpeed: sp }, DT);
      b.velocity.x = loco.vx;
      b.velocity.z = loco.vz;
      ph.step(DT);
      rec.push({ y: b.position.y });
    }
    ph.removeBody(b);
    // 纯楼梯段：去掉首尾各 3 级——平台 → 楼梯的过渡（StairGait 前两级还在估坡度、Shift 从小跑减速）不算
    const r = riserToRiser(rec, 3 * S.rise + 0.05, top - 3 * S.rise - 0.05);
    assert.ok(r.n >= 8, `${dir > 0 ? '上' : '下'}楼只迈了 ${r.n} 级`);
    assert.ok(Math.abs(Math.abs(r.vy) - V) <= V * 0.01, `S2 直梯${dir > 0 ? '上' : '下'}楼${sprint ? '（Shift）' : ''}：竖直 ${r.vy.toFixed(4)} m/s，期望 ${V} ±1%`);
    out.push(`${dir > 0 ? '上' : '下'}${sprint ? 'Shift' : ''} ${Math.abs(r.vy).toFixed(4)}`);
  }
  console.log(`  （S2 直梯竖直速度：${out.join(' / ')} m/s）`);
});

test('楼梯步态：竖直速度固定 0.5455 m/s（017 xi-stairs 22 帧周期），上下楼一样，Shift 不加速', () => {
  const V = gameplay.player.stairs.verticalSpeed;
  assert.equal(V, 0.5455);
  const up = stairRun(false, 1);
  const upRun = stairRun(true, 1);
  const down = stairRun(true, -1);
  for (const [tag, r, sign] of [['上楼慢走', up, 1], ['上楼按 Shift', upRun, 1], ['下楼按 Shift', down, -1]]) {
    assert.ok(r.onFrac > 0.95, `${tag}：楼梯步态只占 ${(r.onFrac * 100).toFixed(0)}%`);
    assert.ok(Math.abs(r.vy * sign - V) <= V * 0.01, `${tag}：竖直 ${r.vy.toFixed(4)} m/s，期望 ±${V} ±1%（迈级到迈级口径）`);
  }
  assert.ok(Math.abs(up.vh - upRun.vh) < 0.03, `Shift 不应影响楼梯速度：${up.vh.toFixed(3)} / ${upRun.vh.toFixed(3)}`);
  // 30° 坡不是楼梯：按 Shift 照常小跑
  const env = setup();
  const a = env.course.anchors.ramp30;
  place(env, a.foot);
  const gait = new StairGait();
  let any = false;
  for (let i = 0; i < 60; i++) {
    const b = env.body;
    if (gait.update(DT, b.position.y - b.prevPosition.y, Math.hypot(b.position.x - b.prevPosition.x, b.position.z - b.prevPosition.z), b.onGround) != null) any = true;
    b.velocity.x = a.dir.x * RUN;
    b.velocity.z = a.dir.z * RUN;
    env.physics.step(DT);
  }
  assert.ok(!any, '30° 坡不应当成楼梯');
  results.push([`  楼梯：上楼 ${up.vy.toFixed(4)} / Shift ${upRun.vy.toFixed(4)} / 下楼 ${down.vy.toFixed(4)} m/s，水平 ${up.vh.toFixed(3)} m/s`]);
});

test('BUG-007 矮沿：陡端面凸出地面 3.6 cm（旧礁石坡接缝）任何起步相位都能走过去', () => {
  // 旧 tideTestArea.slab 的做法：两端各伸 0.1 m，高端端面凸出岸台 3.6 cm
  const physics = new PhysicsSystem();
  const add = (geo, pos, rotX = 0) => {
    const m = new THREE.Mesh(geo);
    m.name = 'x-collider';
    m.position.copy(pos);
    m.rotation.x = rotX;
    m.updateMatrixWorld(true);
    physics.addMesh(m);
  };
  add(new THREE.BoxGeometry(4, 3.6, 4), new THREE.Vector3(0, 0.2, 22)); // 岸台 z 20…24，顶 2.0
  add(new THREE.BoxGeometry(4, 1, 20), new THREE.Vector3(0, -0.5, 34)); // 坡下地面
  const theta = Math.atan2(1.9, 5);
  add(new THREE.BoxGeometry(2, 0.3, Math.hypot(5, 1.9) + 0.2), new THREE.Vector3(0, 1.05 - 0.15 * Math.cos(theta), 26.5 - 0.15 * Math.sin(theta)), theta);
  const body = new CharacterBody();
  physics.addBody(body);
  const stuck = [];
  for (let k = 0; k < 120; k++) {
    const z0 = 23 + k * 0.0083;
    body.teleport(new THREE.Vector3(0, 2.02, z0));
    for (let i = 0; i < k % 7; i++) physics.step(DT);
    for (let i = 0; i < 240; i++) {
      body.velocity.set(0, 0, Math.min(WALK, ((i + 1) * DT * WALK) / 0.12));
      physics.step(DT);
    }
    if (body.position.z < 26) stuck.push(`${z0.toFixed(3)}→${body.position.z.toFixed(3)}`);
  }
  assert.deepEqual(stuck, [], `卡在接缝：${stuck.slice(0, 5).join(' ')}`);
  // 45° 陡坡仍挡住由上面的「45° 坡走不上去」覆盖（矮沿判定只放过 ≤ lipHeight 且前方可走的沿）
});

test('斜着撞墙：沿墙滑动，不穿、不黏', () => {
  const env = setup();
  const w = env.course.anchors.wall;
  place(env, w.start);
  const dir = new THREE.Vector3(1, 0, -1); // 45° 斜撞向 z = -14 的墙
  let minZ = Infinity;
  const log = walk(env, dir, RUN, 3, () => (minZ = Math.min(minZ, env.body.position.z)));
  const wallFace = w.z + 0.2; // 墙厚 0.4
  assert.ok(minZ >= wallFace + gameplay.player.radius - 0.01, `穿进墙：z=${minZ.toFixed(3)}`);
  // 贴墙后的 1 s 内，x 方向速度应接近 RUN·cos45（不黏墙）
  const a = log[log.length - 61];
  const b = log[log.length - 1];
  const vx = b.x - a.x;
  assert.ok(vx > RUN * Math.SQRT1_2 * 0.9, `贴墙滑动速度 ${vx.toFixed(2)} m/s`);
});

test('动态碰撞体开关立即生效（闸门）', () => {
  const env = setup();
  const g = env.course.anchors.gate;
  place(env, g.before);
  walk(env, new THREE.Vector3(0, 0, -1), RUN, 2);
  assert.ok(env.body.position.z > 8.15 + gameplay.player.radius - 0.02, `门关着却穿过去了：z=${env.body.position.z.toFixed(2)}`);
  env.gate.enabled = false;
  walk(env, new THREE.Vector3(0, 0, -1), RUN, 1.5);
  assert.ok(env.body.position.z < g.after.z + 1, `门开了却过不去：z=${env.body.position.z.toFixed(2)}`);
  // 再关上：从另一侧往回走同样被挡
  env.gate.enabled = true;
  walk(env, new THREE.Vector3(0, 0, 1), RUN, 2);
  assert.ok(env.body.position.z < 8 - 0.15 - gameplay.player.radius + 0.02, `z=${env.body.position.z.toFixed(2)}`);
});

test('站在升降台上会被带着走', () => {
  const env = setup();
  const c = env.course.anchors.lift;
  place(env, c.center.clone().setY(0.5));
  assert.ok(Math.abs(env.body.position.y - 0.3) < 0.01, `y=${env.body.position.y}`);
  const liftMesh = env.course.lift;
  for (let i = 0; i < 60; i++) {
    liftMesh.position.y += 1 / 60;
    liftMesh.position.x += 0.5 / 60;
    env.physics.step(DT);
  }
  assert.ok(Math.abs(env.body.position.y - 1.3) < 0.03, `y=${env.body.position.y.toFixed(3)}`);
  assert.ok(Math.abs(env.body.position.x - (c.center.x + 0.5)) < 0.03, `x=${env.body.position.x.toFixed(3)}`);
});

test('移动速度：慢走 1.6 / 小跑 3.2 m/s（±5%），0.15 s 内到速，转身 540°/s', () => {
  const s = { vx: 0, vz: 0, facing: 0 };
  const input = { moveX: 0, moveY: 1, sprint: false, cameraYaw: 0 };
  let t = 0;
  while (Math.hypot(s.vx, s.vz) < WALK - 1e-6 && t < 1) {
    stepLocomotion(s, input, DT);
    t += DT;
  }
  assert.ok(t <= 0.15 + 1e-9, `加速用了 ${t.toFixed(3)} s`);
  const env = setup();
  place(env, new THREE.Vector3(-14, 0, 14));
  for (const [sprint, target] of [[false, WALK], [true, RUN]]) {
    input.sprint = sprint;
    for (let i = 0; i < 30; i++) stepLocomotion(s, input, DT);
    const p0 = env.body.position.clone();
    for (let i = 0; i < 60; i++) {
      stepLocomotion(s, input, DT);
      env.body.velocity.x = s.vx;
      env.body.velocity.z = s.vz;
      env.physics.step(DT);
    }
    const v = env.body.position.distanceTo(p0);
    assert.ok(Math.abs(v - target) / target <= 0.05, `${sprint ? '小跑' : '慢走'} ${v.toFixed(3)} m/s`);
    assert.ok(Math.abs(env.body.actualVelocity.length() - target) / target <= 0.05);
  }
  // 相机朝向 yaw = 0 时「前」是 -z；转身 180° 需要 1/3 s
  const f = { vx: 0, vz: 0, facing: 0 };
  let n = 0;
  while (Math.abs(Math.abs(f.facing) - Math.PI) > 1e-3 && n < 120) {
    stepLocomotion(f, { moveX: 0, moveY: 1, sprint: false, cameraYaw: 0 }, DT);
    n++;
  }
  assert.ok(Math.abs(n * DT - 1 / 3) < 2 * DT, `转身 180° 用了 ${(n * DT).toFixed(3)} s`);
});

test('碰撞耗时：测试场地里小跑，平均 < 0.5 ms / 步（CPU 参考值）', () => {
  const env = setup();
  place(env, new THREE.Vector3(0, 0, 4));
  let total = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    const a = i * 0.02;
    env.body.velocity.set(Math.cos(a) * RUN, 0, Math.sin(a) * RUN);
    env.physics.step(DT);
    total += env.physics.lastStepMs;
  }
  const avg = total / N;
  console.log(`  · 平均碰撞耗时 ${avg.toFixed(3)} ms / 步（${env.colliders.length} 个碰撞体）`);
  assert.ok(avg < 0.5, `${avg.toFixed(3)} ms`);
});

test('碰撞体命名约定：-collider / -wall（含 .001 后缀）注册并隐藏，其它网格忽略', () => {
  const root = new THREE.Group();
  const mk = (name) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    m.name = name;
    root.add(m);
    return m;
  };
  const a = mk('floor-collider');
  const b = mk('rail-wall.001');
  const c = mk('rock');
  const d = mk('my-collider-visual');
  const physics = new PhysicsSystem();
  const list = physics.addFromModel(root);
  assert.deepEqual(list.map((x) => [x.name, x.kind]), [['floor-collider', 'collider'], ['rail-wall.001', 'wall']]);
  assert.equal(a.visible, false);
  assert.equal(b.visible, false);
  assert.equal(c.visible, true);
  assert.equal(d.visible, true);
});

test('空气墙（-wall）挡水平移动，但不能站在上面', () => {
  const env = setup();
  // 沟里的空气墙顶面 y = 1.1；从上方落下应穿过墙顶落回地面（墙只推水平）
  const l = env.course.anchors.link;
  place(env, new THREE.Vector3(l.mid.x - 1.5, 0, l.mid.z));
  walk(env, new THREE.Vector3(1, 0, 0), RUN, 1);
  // 被沟两侧平台 / 空气墙挡在 x < 9 - r
  assert.ok(env.body.position.x < 8.8 - gameplay.player.radius + 0.02, `x=${env.body.position.x.toFixed(2)}`);
});

test('TraversalLink：时长 1–2 s，路径按弧长取样，首尾准确', () => {
  const l = new TraversalLink({ start: new THREE.Vector3(0, 0.8, 0), end: new THREE.Vector3(0, 0.8, 2.8), path: [new THREE.Vector3(0, 1.3, 1.4)] });
  assert.ok(l.duration >= 1 && l.duration <= 2, `duration=${l.duration}`);
  const out = new THREE.Vector3();
  assert.ok(l.sample(0, out).distanceTo(l.start) < 1e-6);
  assert.ok(l.sample(1, out).distanceTo(l.end) < 1e-6);
  assert.ok(Math.abs(l.sample(0.5, out).y - 1.3) < 1e-6, '中点经过路径点');
  const short = new TraversalLink({ start: new THREE.Vector3(), end: new THREE.Vector3(0.3, 0, 0) });
  const long = new TraversalLink({ start: new THREE.Vector3(), end: new THREE.Vector3(30, 0, 0) });
  assert.equal(short.duration, 1);
  assert.equal(long.duration, 2);
  assert.ok(l.inRange(new THREE.Vector3(0.3, 0.8, 0.3)));
  assert.ok(!l.inRange(new THREE.Vector3(0.3, 0, 0.3)), '高度差太大不算');
  assert.ok(l.pushingToward(0, 1));
  assert.ok(!l.pushingToward(1, 0));
});

test('瞬移后落地站稳，不穿地、不下落（平台上 / 楼梯上）', () => {
  const env = setup();
  for (const p of [new THREE.Vector3(10, 0.82, 4.4), new THREE.Vector3(-10, 2.33, 1), new THREE.Vector3(0, 0.02, 4)]) {
    env.body.teleport(p);
    for (let i = 0; i < 60; i++) env.physics.step(DT);
    assert.ok(env.body.onGround, `${p.toArray()} onGround`);
    assert.ok(Math.abs(env.body.position.y - (p.y - 0.02)) < 0.03, `${p.toArray()} → y=${env.body.position.y.toFixed(3)}`);
  }
});

test('013 S1 退潮后走下礁石台阶（smoke 同一起点 x −9.7 → −8.4）：按控制器走法（楼梯步态 + 加速 + 转身）不卡、游戏时间 < 2.5 s', () => {
  const gb = buildS1Greybox();
  const ph = new PhysicsSystem();
  for (const m of gb.colliders) ph.addMesh(m);
  for (const m of gb.walls) {
    const c = ph.addMesh(m, { kind: 'wall' });
    if (m.userData.walkableWhen === 'low') c.enabled = false; // 退潮：入口空气墙关
  }
  const worst = { t: 0, stall: 0 };
  for (const [x0, z, sprint] of [
    [-9.7, -3.0, false],
    [-9.62, -3.0, false],
    [-9.78, -2.6, false],
    [-9.7, -3.4, false],
    [-9.7, -3.0, true],
  ]) {
    const b = new CharacterBody();
    ph.addBody(b);
    b.teleport(new THREE.Vector3(x0, 2.42, z));
    for (let i = 0; i < 10; i++) ph.step(DT);
    const gait = new StairGait();
    const loco = { vx: 0, vz: 0, facing: Math.PI / 2 };
    let t = 0;
    let best = b.position.x;
    let since = 0;
    while (b.position.x <= -8.4 && t < 8) {
      const sp = gait.update(DT, b.position.y - b.prevPosition.y, Math.hypot(b.position.x - b.prevPosition.x, b.position.z - b.prevPosition.z), b.onGround);
      // 相机朝 +X（yaw −π/2），按住 W
      stepLocomotion(loco, { moveX: 0, moveY: 1, sprint, cameraYaw: -Math.PI / 2, fixedSpeed: sp }, DT);
      b.velocity.x = loco.vx;
      b.velocity.z = loco.vz;
      ph.step(DT);
      t += DT;
      if (b.position.x > best + 1e-4) {
        best = b.position.x;
        since = 0;
      } else since += DT;
      worst.stall = Math.max(worst.stall, since);
    }
    ph.removeBody(b);
    assert.ok(b.position.x > -8.4, `起点 ${x0},${z}${sprint ? ' 跑' : ''}：8 s 游戏时间停在 ${b.position.toArray().map((v) => v.toFixed(2))}`);
    worst.t = Math.max(worst.t, t);
  }
  assert.ok(worst.t < 2.5, `走下 1.3 m 台阶用了 ${worst.t.toFixed(2)} s 游戏时间`);
  assert.ok(worst.stall < 0.25, `中途停住 ${worst.stall.toFixed(2)} s（卡点）`);
  console.log(`  （S1 礁石台阶：最慢 ${worst.t.toFixed(2)} s 游戏时间、最长停顿 ${worst.stall.toFixed(2)} s）`);
});

let failed = 0;
test('S1 跨越选择：站在每条起点 / 落点上，按 E 选中的是起点最近的那条（去程落点 → 回程起点，不会被上一条的半径抢走）', () => {
  const deckY = S1.nearPlatform.topY;
  const x = S1.linkNear[0];
  const P = (z) => new THREE.Vector3(x, deckY, z);
  const sp = s1StepLinks();
  const links = sp.map((s, i) => new TraversalLink({ start: P(s.start), end: P(s.end), path: [P((s.start + s.end) / 2).setY(deckY + 0.25)], radius: i % 3 === 0 ? 0.7 : 0.6 }));
  links.forEach((l, i) => assert.equal(pickTraversalLink(links, P(sp[i].start)), l, `站在跨越 ${i} 起点选错`));
  // 落点 → 能接着往回 / 往前跨：0 落浮台 → 1（回岸）；1 落岸 → 0；2 落台阶 → 3；3 落浮台 → 2
  for (const [i, j] of [[0, 1], [1, 0], [2, 3], [3, 2]]) assert.equal(pickTraversalLink(links, P(sp[i].end)), links[j], `跨越 ${i} 落点应选 ${j}`);
  // 浮台南沿 9.0–9.05（两条范围重叠处）→ 回程起点更近
  assert.equal(pickTraversalLink(links, P(9.02)), links[1]);
});

test('013 S1 四条跨越（制作人拍板）：落点离所在台面最近边沿 ≥ 0.30 m、起点在起跳台面上，两端都站得稳（岸台 / 浮台锚位 / 台阶平台）', () => {
  const gb = buildS1Greybox();
  const ph = new PhysicsSystem();
  for (const m of gb.colliders) ph.addMesh(m);
  // 浮台在锚位、涨潮浮到甲板顶 = 岸台面（puzzles ready 条件）：用同尺寸盒子
  const deckY = S1.nearPlatform.topY;
  const [rw, rh, rd] = S1.raft.size;
  const raft = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rd));
  raft.position.set(S1.raft.slot[0], deckY - rh / 2, S1.raft.slot[2]);
  raft.updateMatrixWorld(true);
  ph.addMesh(raft);
  const rect = (name, x0, x1, z0, z1) => ({ name, x0, x1, z0, z1 });
  const shore = rect('近岸平台', S1.nearPlatform.min[0], S1.nearPlatform.max[0], S1.nearPlatform.min[1], S1.nearPlatform.max[1]);
  const raftR = rect('浮台', S1.raft.slot[0] - rw / 2, S1.raft.slot[0] + rw / 2, S1.raft.slot[2] - rd / 2, S1.raft.slot[2] + rd / 2);
  const F = S1.farSteps;
  const steps = rect('台阶平台', F.x[0], F.x[1], F.z0, F.z0 + F.landing);
  const edgeDist = (r, x, z) => Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
  const surfaces = [
    [shore, raftR],
    [raftR, shore],
    [raftR, steps],
    [steps, raftR],
  ];
  const links = s1StepLinks();
  const x = S1.linkNear[0];
  const notes = [];
  links.forEach((l, i) => {
    const [from, to] = surfaces[i];
    const dEnd = edgeDist(to, x, l.end);
    const dStart = edgeDist(from, x, l.start);
    assert.ok(dEnd >= 0.3, `跨越 ${i}（${from.name} → ${to.name}）落点 z ${l.end.toFixed(2)} 离${to.name}最近边沿 ${dEnd.toFixed(3)} m < 0.30`);
    assert.ok(dStart > 0, `跨越 ${i} 起点 z ${l.start.toFixed(2)} 不在${from.name}上`);
    for (const [z, what] of [
      [l.start, '起点'],
      [l.end, '落点'],
    ]) {
      const b = new CharacterBody();
      ph.addBody(b);
      b.teleport(new THREE.Vector3(x, deckY + 0.02, z));
      for (let k = 0; k < 60; k++) ph.step(DT);
      ph.removeBody(b);
      assert.ok(b.onGround, `跨越 ${i} ${what} z ${z.toFixed(2)} 没站在可走面上`);
      assert.ok(Math.abs(b.position.y - deckY) < 0.03 && Math.hypot(b.position.x - x, b.position.z - z) < 0.01, `跨越 ${i} ${what} 站不稳：${b.position.toArray().map((v) => v.toFixed(3))}`);
    }
    notes.push(`${from.name}→${to.name} ${l.start.toFixed(2)}→${l.end.toFixed(2)}（落点离沿 ${dEnd.toFixed(2)}）`);
  });
  console.log(`  （S1 跨越：${notes.join('；')}）`);
});

test('018 打磨 S1 新碰撞（码头桩 38 根 + 前景礁石 9 块）：不压谜题 1 踏石 / 小径 / 脚印线 / 浮台线 / 码头主动线，出生点不卡；桩和礁石真的挡人', () => {
  const gb = buildS1Greybox();
  const newCols = gb.colliders.filter((m) => /^s1-(pier-pile|fg-rock)-/.test(m.name));
  assert.equal(newCols.length, S1.pierPiles.length + S1.foregroundRocks.length, `新碰撞 ${newCols.length}`);
  for (const m of newCols) m.updateMatrixWorld(true);
  // 1) 几何：新碰撞（世界 AABB 外扩玩家半径 + 0.15）不碰各路线折线
  const R = gameplay.player.radius + 0.15;
  const fp = JSON.parse(readFileSync(new URL('../src/levels/s1/footprints-path.json', import.meta.url), 'utf8'));
  const st = S1.reefStairs;
  const routes = {
    '谜题 1 踏石': [[st.x0 + st.run * st.count, (st.z[0] + st.z[1]) / 2], ...S1.reefPath.map((r) => [r[0], r[2]]), [S1.reefPathEnd[0], S1.reefPathEnd[2]]],
    '小径尽头 → 脚印 → 浮台': [[S1.reefPathEnd[0], S1.reefPathEnd[2]], ...fp.control, [S1.raft.home[0], S1.raft.home[2]]],
    '浮台推动线': [[S1.raft.home[0], S1.raft.home[2]], [S1.raft.slot[0], S1.raft.slot[2]]],
    '码头主动线（甲板）': [[S1.spawnStart[0], S1.spawnStart[2]], [S1.pier.landEnd[0], S1.pier.landEnd[1]], [S1.safePoint[0], S1.safePoint[2]]],
  };
  const segDist = (px, pz, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
  };
  const notes = [];
  for (const [name, line] of Object.entries(routes)) {
    let min = Infinity, who = '';
    for (const m of newCols) {
      const b = new THREE.Box3().setFromObject(m);
      // 码头主动线在甲板上：桩顶截到甲板底，甲板面以上没东西
      if (name.startsWith('码头') && b.max.y <= S1.pier.deckY - 0.3 + 1e-6) continue;
      for (let i = 0; i + 1 < line.length; i++) {
        // 折线采样到盒子的水平距离
        for (let k = 0; k <= 20; k++) {
          const t = k / 20;
          const x = line[i][0] + (line[i + 1][0] - line[i][0]) * t, z = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
          const d = Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));
          if (d < min) [min, who] = [d, m.name];
        }
      }
    }
    void segDist;
    assert.ok(min >= R, `${name} 离新碰撞 ${who} 只有 ${min.toFixed(2)} m（< 玩家半径 + 0.15 = ${R.toFixed(2)}）`);
    notes.push(`${name} ≥ ${min === Infinity ? '—' : min.toFixed(2)} m`);
  }
  // 2) 实走：真胶囊按路线走，不卡
  const mk = (low) => {
    const ph = new PhysicsSystem();
    for (const m of gb.colliders) ph.addMesh(m);
    for (const m of gb.walls) {
      const c = ph.addMesh(m, { kind: 'wall' });
      if (low && m.userData.walkableWhen === 'low') c.enabled = false;
    }
    return ph;
  };
  const go = (ph, start, pts, label, speed = WALK) => {
    const b = new CharacterBody();
    ph.addBody(b);
    b.teleport(new THREE.Vector3(...start));
    for (let i = 0; i < 20; i++) ph.step(DT);
    let t = 0;
    for (const [x, z] of pts) {
      let best = Infinity, stall = 0;
      for (;;) {
        const v = new THREE.Vector3(x - b.position.x, 0, z - b.position.z);
        const d = v.length();
        if (d < 0.2) break;
        v.normalize().multiplyScalar(speed);
        b.velocity.x = v.x;
        b.velocity.z = v.z;
        ph.step(DT);
        t += DT;
        if (d < best - 1e-3) [best, stall] = [d, 0];
        else stall += DT;
        assert.ok(stall < 0.5 && t < 120, `${label}：往 (${x}, ${z}) 走卡在 ${b.position.toArray().map((q) => q.toFixed(2))}`);
      }
    }
    b.velocity.set(0, 0, 0);
    ph.removeBody(b);
    return { b, t };
  };
  const hi = mk(false);
  // 出生点：落地站稳、不被挤开
  {
    const b = new CharacterBody();
    hi.addBody(b);
    b.teleport(new THREE.Vector3(...S1.spawnStart));
    for (let i = 0; i < 60; i++) hi.step(DT);
    hi.removeBody(b);
    assert.ok(b.onGround && Math.hypot(b.position.x - S1.spawnStart[0], b.position.z - S1.spawnStart[2]) < 0.01 && Math.abs(b.position.y - S1.pier.deckY) < 0.03, `出生点站不稳 ${b.position.toArray()}`);
  }
  const a = go(hi, S1.spawnStart, [[S1.pier.landEnd[0], S1.pier.landEnd[1]], [S1.safePoint[0], S1.safePoint[2]]], '涨潮：出生点沿码头到岸台');
  notes.push(`码头 ${a.t.toFixed(1)} s`);
  const lo = mk(true);
  const bottom = [st.x0 + st.run * st.count + 0.3, 0.3, (st.z[0] + st.z[1]) / 2];
  const r1 = go(lo, bottom, [...S1.reefPath.map((r) => [r[0], r[2]]), [S1.reefPathEnd[0], S1.reefPathEnd[2]]], '退潮：礁石台阶底 → 6 块踏石 → 小径尽头');
  const r2 = go(lo, [S1.reefPathEnd[0], 0.2, S1.reefPathEnd[2]], [...fp.control, [S1.raft.home[0] - 1.5, S1.raft.home[2]]], '退潮：小径尽头 → 脚印线 → 浮台旁');
  notes.push(`踏石 ${r1.t.toFixed(1)} s、脚印线 ${r2.t.toFixed(1)} s`);
  // 3) 真的挡：码头下（退潮可达段）撞桩、滩上撞大礁石
  // 朝中心直走 4 s：全程离中心的最近水平距离（胶囊会贴着滑开，看最近值）
  const block = (start, target, label, minReach) => {
    const b = new CharacterBody();
    lo.addBody(b);
    b.teleport(new THREE.Vector3(...start));
    for (let i = 0; i < 20; i++) lo.step(DT);
    const dir = new THREE.Vector3(target[0] - start[0], 0, target[2] - start[2]).normalize();
    let min = Infinity;
    for (let i = 0; i < 240; i++) {
      b.velocity.x = dir.x * WALK;
      b.velocity.z = dir.z * WALK;
      lo.step(DT);
      min = Math.min(min, Math.hypot(b.position.x - target[0], b.position.z - target[2]));
    }
    lo.removeBody(b);
    assert.ok(min >= minReach, `${label}：穿进去了，最近离中心 ${min.toFixed(2)} m（< ${minReach.toFixed(2)}）`);
    return min;
  };
  const pile = S1.pierPiles.findIndex(([x, z]) => x === 0 && z === 4.771);
  const pc = gb.colliders.find((m) => m.name === `s1-pier-pile-${pile}-collider`).position;
  // 沿码头中线（局部 x = 0，两侧跨中桩在 ±1.05）从陆侧 0.9 m 处走向中桩（这一段在 deepWater 区外，退潮走得到）
  const sp = pierPoint(4.771 + 0.9, 0, 0.2);
  const dp = block([sp.x, sp.y, sp.z], [pc.x, 0, pc.z], '码头下中桩', 0.12 + gameplay.player.radius - 0.03);
  const rk = S1_ROCKS[155];
  const fr = S1.foregroundRocks.find((r) => r[0] === 155);
  const dr = block([rk.translation[0], 0.2, rk.translation[2] + 4.5], rk.translation, '前景大礁盘 #155', fr[2] * S1.rockColliderShrink + gameplay.player.radius - 0.1);
  notes.push(`桩挡在 ${dp.toFixed(2)} m、礁盘挡在 ${dr.toFixed(2)} m`);
  console.log(`  （018 新碰撞：${notes.join('；')}）`);
});

test('batch15 #157 礁石：9 块前景礁石挡人体与深水区边界之间要么留 ≥ 胶囊直径 + 余量的缝、要么和深水墙连上；带碰撞胶囊沿 #157 南侧多方向走不进深水区（不触发送回）', () => {
  const gb = buildS1Greybox();
  const poly = S1.deepWater.polygon;
  const deep = polygonRegion(poly);
  const D = gameplay.player.radius * 2 + S1.rockDeepGapMargin;
  const segD = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  /** 点到深水边界的有符号距离（区内为负） */
  const sd = (x, z) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, segD([x, z], poly[i], poly[(i + 1) % poly.length]));
    return deep(new THREE.Vector3(x, 0, z)) ? -d : d;
  };
  const notes = [];
  for (const [idx] of S1.foregroundRocks) {
    const m = gb.colliders.find((c) => c.name === `s1-fg-rock-${idx}-collider`);
    assert.ok(m, `缺 #${idx} 挡人体`);
    m.updateMatrixWorld(true);
    // 挡人体水平轮廓：顶点（世界 XZ）+ 相邻顶点连线细分采样
    const pos = m.geometry.getAttribute('position');
    const pts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push([v.x, v.z]);
    }
    const idxA = m.geometry.index;
    let gap = Infinity;
    const tri = idxA ? idxA.count : pos.count;
    for (let t = 0; t < tri; t++) {
      const a = pts[idxA ? idxA.getX(t) : t], b = pts[idxA ? idxA.getX(t - (t % 3) + ((t + 1) % 3)) : t - (t % 3) + ((t + 1) % 3)];
      for (let k = 0; k <= 8; k++) gap = Math.min(gap, sd(a[0] + ((b[0] - a[0]) * k) / 8, a[1] + ((b[1] - a[1]) * k) / 8));
    }
    // 连上 = 挡人体伸进深水区至少一个「直径 + 余量」（中间没有能挤进去的楔形缝）
    assert.ok(gap >= D || gap <= -D, `#${idx} 挡人体离深水边界 ${gap.toFixed(2)} m：既不够 ${D.toFixed(2)} m 宽的缝，也没和深水墙连上`);
    notes.push(`#${idx} ${gap.toFixed(2)}`);
  }
  // 真路径：退潮（台阶等 walkableWhen low 的墙关掉）带碰撞胶囊，沿 #157 南侧（离深水边界 0.3–0.6 m）多个方向走
  const ph = new PhysicsSystem();
  for (const m of gb.colliders) ph.addMesh(m);
  for (const m of gb.walls) {
    const c = ph.addMesh(m, { kind: 'wall' });
    if (m.userData.walkableWhen === 'low') c.enabled = false;
  }
  const r = S1_ROCKS[157];
  const z0 = S1.deepWater.polygon.find(([x]) => x === 12.5)[1]; // −8.95：#157 一带深水边界
  const runs = [
    // [起点 x, z, 方向 x, z, 秒]
    [8.6, z0 + 0.35, 1, 0, 3.5], // 西 → 东，贴着边界
    [8.6, z0 + 0.6, 1, 0, 3.5],
    [8.6, z0 + 0.35, 1, 0.25, 3.5], // 东偏北：往礁石上压着走
    [8.6, z0 + 0.5, 1, 0.5, 3.5],
    [14.2, z0 + 0.35, -1, 0, 3.5], // 东 → 西
    [14.2, z0 + 0.6, -1, 0.25, 3.5], // 西偏北
    [13.6, z0 + 0.4, -1, 0.5, 3.5],
    [r.translation[0], z0 + 0.4, 0, 1, 2], // 正南侧往北顶礁石
    [r.translation[0] - 1, z0 + 0.4, 0.7, 0.7, 2.5],
    [r.translation[0] + 1, z0 + 0.4, -0.7, 0.7, 2.5],
  ];
  let minSd = Infinity;
  for (const [x, z, dx, dz, sec] of runs) {
    const b = new CharacterBody();
    ph.addBody(b);
    b.teleport(new THREE.Vector3(x, 0.2, z));
    for (let i = 0; i < 20; i++) ph.step(DT);
    assert.ok(!deep(b.position), `起点 (${x}, ${z}) 已在深水区`);
    const len = Math.hypot(dx, dz);
    for (let i = 0; i < sec / DT; i++) {
      b.velocity.x = (dx / len) * WALK;
      b.velocity.z = (dz / len) * WALK;
      ph.step(DT);
      const inDeep = deep(b.position) && b.position.y <= S1.deepWater.maxFootY;
      assert.ok(!inDeep, `从 (${x}, ${z.toFixed(2)}) 朝 (${dx}, ${dz}) 走 ${(i * DT).toFixed(2)} s 进了深水区（会送回）：${b.position.toArray().map((q) => q.toFixed(2))}`);
      minSd = Math.min(minSd, sd(b.position.x, b.position.z));
    }
    ph.removeBody(b);
  }
  console.log(`  （前景礁石挡人体离深水边界：${notes.join('、')} m（要求 ≥ ${D.toFixed(2)}）；#157 南侧 ${runs.length} 条路径最近离边界 ${minSd.toFixed(2)} m）`);
});

test('台面正好高出 stepHeight（S1 搁浅浮台 0.1 → 0.4）：两侧走过去都迈上台面，不从台面里穿过', () => {
  const ph = new PhysicsSystem();
  const sand = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40));
  sand.updateMatrixWorld(true);
  ph.addMesh(sand);
  const rf = S1.raft;
  const root = new THREE.Group();
  root.position.set(...rf.home);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(...rf.size));
  deck.position.y = -rf.size[1] / 2;
  root.add(deck);
  root.updateMatrixWorld(true);
  ph.addMesh(deck, { dynamic: true });
  assert.ok(Math.abs(rf.home[1] - S1.sandY - gameplay.player.stepHeight) < 1e-6, '浮台搁浅台面比滩地正好高 stepHeight');
  const b = new CharacterBody();
  ph.addBody(b);
  const half = rf.size[0] / 2 - b.radius;
  for (const [sx, dx] of [[rf.home[0] - 2.6, 1], [rf.home[0] + 2.6, -1]]) {
    b.teleport(new THREE.Vector3(sx, S1.sandY, rf.home[2]));
    for (let i = 0; i < 30; i++) ph.step(DT);
    let maxY = -Infinity;
    for (let i = 0; i < 120; i++) {
      b.velocity.set(dx * 2.5, 0, 0);
      ph.step(DT);
      if (Math.abs(b.position.x - rf.home[0]) < half) {
        assert.ok(b.position.y > rf.home[1] - 0.02, `从 x ${sx} 走到 x ${b.position.x.toFixed(2)}：脚 ${b.position.y.toFixed(3)} 在台面 ${rf.home[1]} 里`);
      }
      maxY = Math.max(maxY, b.position.y);
    }
    assert.ok(maxY > rf.home[1] - 0.02, `从 x ${sx} 走过去没迈上台面（最高 ${maxY.toFixed(3)}）`);
  }
  ph.removeBody(b);
});

test('裂湾村白盒：码头、鱼市、两侧崖壁、缆车站和灯室可步行抵达', () => {
  const physics = new PhysicsSystem();
  const world = buildVillage(physics);
  const body = new CharacterBody();
  physics.addBody(body);
  const west = TERRACES.flatMap(([a, b], i) => {
    const turnZ = b[2] + (i % 2 ? 0.7 : -0.7);
    return [a, b, [b[0], b[1], turnZ], [TERRACES[i + 1]?.[0][0] ?? b[0], b[1], turnZ]];
  });
  const tower = Array.from({ length: 97 }, (_, i) => {
    const a = -Math.PI / 2 + i * 6.5 * Math.PI / 96;
    return [-4 + 2 * Math.cos(a), 14 + 18 * i / 96, 35 + 2 * Math.sin(a)];
  });
  const routes = {
    dock: [STAGES.s1.spawn, [9, 2, -25], [5.5, 6.2, -32.5], [5.5, 6.2, -34], [6.7, 10.9, -43.8], STAGES.s1.exit],
    market: [[4.2, 6.2, -34], [2, 6.2, -34], [-0.2, 6.3, -34], [-2, 6.3, -42]],
    west: [STAGES.s2.spawn, [4.5, 11.1, -42.8], [-12.8, 11, -42.8], ...west, [-17.7, 39, -41.1], STAGES.s2.exit],
    east: [
      [4.8, 11.2, -43], [11.7, 11, -43], [12.65, 15, -56],
      [13.6, 15, -56], [13.6, 15, -54.2], [13.6, 15, -56], [12.65, 15, -56],
      [12.35, 19, -62.6], [12.2, 19, -66],
    ],
    cable: [STAGES.s3.spawn, CABLE_FROM],
    tower: [CABLE_TO, [-4, 14, 33], ...tower, [-2, 32, 35]],
  };
  try {
    for (const [name, [start, ...targets]] of Object.entries(routes)) {
      place({ physics, body }, new THREE.Vector3(...start).add(new THREE.Vector3(0, 0.1, 0)));
      for (const [x, y, z] of targets) {
        let distance = Infinity;
        for (let i = 0; i < 1500 && body.position.y >= 0; i++) {
          const dx = x - body.position.x, dz = z - body.position.z;
          distance = Math.hypot(dx, dz);
          if (distance < 0.11) break;
          body.velocity.x = 1.6 * dx / distance;
          body.velocity.z = 1.6 * dz / distance;
          physics.step(DT);
        }
        assert.ok(distance < 0.2 && Math.abs(y - body.position.y) < 0.38 && body.onGround,
          `${name}: (${x}, ${y}, ${z}) ← ${body.position.toArray().map((n) => n.toFixed(2))}`);
      }
    }
  } finally {
    physics.clear();
    world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('镜巷：三个可调檐镜和崖顶出口从甲板连续可达', () => {
  const physics = new PhysicsSystem();
  const world = buildVillage(physics, false, true);
  const body = new CharacterBody();
  physics.addBody(body);
  const west = TERRACES.flatMap(([a, b], i) => {
    const turnZ = b[2] + (i % 2 ? 0.7 : -0.7);
    return [a, b, [b[0], b[1], turnZ], [TERRACES[i + 1]?.[0][0] ?? b[0], b[1], turnZ]];
  });
  const route = [
    [11.7, 11, -43.5], [12.65, 15, -56], [13.55, 15, -56], [13.55, 15, -54.2], RELAY[0].control,
    [13.55, 15, -54.2], [13.55, 15, -56], [12.65, 15, -56], [11.7, 11, -43.5],
    [4.5, 11.1, -42.8], [-12.8, 11, -42.8], RELAY[1].control, ...west.slice(0, 3),
    RELAY[3].control, ...west.slice(3), [-17.7, 39, -41.1], STAGES.s2.exit,
  ];
  try {
    place({ physics, body }, new THREE.Vector3(...STAGES.s2.spawn));
    for (const [x, y, z] of route) {
      let distance = Infinity;
      for (let i = 0; i < 1500 && body.position.y > 0; i++) {
        const dx = x - body.position.x, dz = z - body.position.z;
        distance = Math.hypot(dx, dz);
        if (distance < 0.11) break;
        body.velocity.x = 1.6 * dx / distance;
        body.velocity.z = 1.6 * dz / distance;
        physics.step(DT);
      }
      assert.ok(distance < 0.2 && Math.abs(body.position.y - y) < 0.38 && body.onGround,
        `(${x}, ${y}, ${z}) ← ${body.position.toArray().map((n) => n.toFixed(2))}`);
    }
  } finally {
    physics.clear();
    world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('镜巷：沿东岸檐镜平台走到栏杆尽头不会踩空', () => {
  const physics = new PhysicsSystem();
  const world = buildVillage(physics, false, true);
  const body = new CharacterBody();
  physics.addBody(body);
  globalThis.document = { createElement: () => ({ getContext: () => ({
    fillRect() {}, strokeRect() {}, fillText() {},
  }) }) };
  try {
    world.add(new MirrorAlleyArt(physics).root);
    const [x, y, z] = RELAY[0].control;
    place({ physics, body }, new THREE.Vector3(x, y + 0.05, z));
    walk({ physics, body }, new THREE.Vector3(0, 0, 1), 1.6, 3.5);
    assert.ok(body.position.z > -49 && body.position.y > 14.9 && body.onGround,
      `东岸檐镜平台尽头: ${body.position.toArray().map((n) => n.toFixed(2))}`);
  } finally {
    delete globalThis.document;
    physics.clear();
    world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('镜巷传光：只有完整镜链能点亮峡尾，固定镜不可转，重置回到初始状态', () => {
  const relay = new MirrorRelay();
  const returned = new MirrorRelay(true);
  assert.equal(returned.trace().received, true);
  returned.reset();
  assert.equal(returned.trace().received, false);
  const initial = relay.trace();
  assert.equal(initial.lit, 1);
  assert.equal(initial.received, false);
  assert.deepEqual(initial.points[0].toArray(), LANTERN);
  relay.turn(2, 1);
  assert.equal(relay.detent(2), 0);
  let solved = 0;
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < 5; b++) {
      for (let d = 0; d < 5; d++) {
        const path = relay.trace();
        if (path.received) {
          solved++;
          assert.deepEqual(path.points.map((p) => p.toArray()), [LANTERN, ...RELAY.map((m) => m.center), RECEIVER]);
          relay.turn(1, 1);
          assert.equal(relay.trace().lit, 2);
          relay.turn(1, -1);
        }
        relay.turn(3, 1);
      }
      relay.turn(1, 1);
    }
    relay.turn(0, 1);
  }
  assert.equal(solved, 1);
  relay.turn(0, 1);
  relay.turn(3, -1);
  relay.reset();
  assert.deepEqual(RELAY.map((_mirror, i) => relay.detent(i)), RELAY.map((m) => m.initial));
  assert.deepEqual(relay.trace(), initial);
});

test('裂湾村鱼闸：错过退潮可重试，封闸只留内湾，深水送回', () => {
  const p = new HarbourPuzzles();
  assert.equal(p.closeGate(), false);
  assert.equal(p.board(), false);
  assert.ok(p.waitForTide());
  p.fixedUpdate(7);
  assert.equal(p.closeGate(), false);
  p.fixedUpdate(13);
  assert.equal(p.inner.level, LOW_WATER);
  assert.ok(p.waitForTide());
  p.fixedUpdate(12);
  assert.ok(p.waitForTide());
  assert.ok(p.closeGate());
  assert.equal(p.board(), false);
  p.fixedUpdate(12);
  assert.equal(p.outer.level, LOW_WATER);
  assert.equal(p.inner.level, HIGH_WATER);
  let recalled;
  p.tides.onRecall = (zone) => { recalled = zone; };
  assert.equal(p.tides.checkRecall({ position: new THREE.Vector3(9, -1.75, WATER_SEAM - 1), onGround: true, busy: false }), p.inner);
  assert.equal(recalled, p.inner);
  assert.ok(p.board());
  p.fixedUpdate(4);
  assert.ok(p.crossed);
  p.reset();
  assert.equal(p.crossed, false);
  assert.equal(p.gateClosed, false);
  assert.equal(p.outer.level, HIGH_WATER);
});

test('裂湾村吊鱼箱：不能绕过鱼闸或断梯，重置后仍可吊箱并登甲板', () => {
  const physics = new PhysicsSystem();
  const crate = addHarbourColliders(physics);
  const world = buildVillage(physics, true);
  const body = new CharacterBody();
  physics.addBody(body);
  const env = { physics, body };
  const p = new HarbourPuzzles();
  function walkTo([x, y, z]) {
    for (let i = 0; i < 720 && body.position.y > -1; i++) {
      const dx = x - body.position.x, dz = z - body.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) break;
      body.velocity.x = 1.6 * dx / d;
      body.velocity.z = 1.6 * dz / d;
      physics.step(DT);
    }
    return Math.hypot(x - body.position.x, z - body.position.z) < 0.15 && Math.abs(y - body.position.y) < 0.35 && body.onGround;
  }
  const mustWalk = (target) => assert.ok(walkTo(target), `${target} ← ${body.position.toArray().map((n) => n.toFixed(2))}`);
  try {
    place(env, new THREE.Vector3(...QUAY_START));
    for (const z of [-9.5, -11.15, -12.25]) mustWalk([9, 2, z]);
    assert.equal(walkTo(QUAY_END), false);
    assert.equal(p.setCounterweight(), false);
    assert.ok(p.waitForTide());
    assert.ok(p.closeGate());
    p.fixedUpdate(12);
    assert.ok(p.board());
    p.fixedUpdate(4);
    place(env, new THREE.Vector3(...QUAY_END));
    mustWalk([10.3, 2, -22.9]);
    assert.ok(p.setCounterweight());
    mustWalk([8.2, 2, -25.2]);
    assert.ok(p.operateCrane());
    assert.equal(p.operateCrane(), false);
    p.resetCrane();
    p.fixedUpdate(4);
    assert.equal(p.crane, 'unweighted');
    assert.equal(p.crossed, true);
    assert.equal(p.operateCrane(), false);
    assert.ok(p.setCounterweight());
    for (const state of ['lifted', 'swung', 'landed']) {
      assert.ok(p.operateCrane());
      p.fixedUpdate(4);
      assert.equal(p.crane, state);
    }
    mustWalk([9, 2, -25]);
    mustWalk([5.5, 6.2, -32.5]);
    mustWalk([5.5, 6.2, -34]);
    const top = [6.56, 10.35, -40.95];
    mustWalk(top);
    assert.equal(walkTo([6.6, 11, -42.4]), false);
    crate.enabled = true;
    place(env, new THREE.Vector3(...top));
    mustWalk([6.6, 11, -42.4]);
    mustWalk(STAGES.s1.exit);
  } finally {
    physics.clear();
    world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('礁柱缆车：配平前试闸失败，只有停靠一侧可登车', () => {
  const cable = new CableCar(), sample = new THREE.Vector3();
  assert.deepEqual(cable.sample(sample).toArray(), CABLE_FROM);
  assert.equal(cable.release(), false);
  assert.equal(cable.board('cliff'), false);
  for (let i = 0; i < 3; i++) cable.adjust(1);
  assert.equal(cable.release(), false);
  cable.reset();
  assert.equal(cable.load, 1);
  cable.adjust(1);
  cable.adjust(1);
  assert.equal(cable.release(), true);
  assert.equal(cable.board('stack'), false);
  assert.equal(cable.board('cliff'), true);
  cable.step(3.5);
  assert.equal(cable.moving, true);
  assert.deepEqual(cable.sample(sample).toArray(), [-10.5, 26.5, 12.5]);
  assert.equal(cable.board('stack'), false);
  cable.step(3.5);
  assert.equal(cable.moving, false);
  assert.deepEqual(cable.sample(sample).toArray(), CABLE_TO);
  assert.equal(cable.board('stack'), true);
  cable.step(7);
  assert.deepEqual(cable.sample(sample).toArray(), CABLE_FROM);
});

test('半盏灯：棱镜须同时对准冷暖灯杯，断光时需重新蓄光', () => {
  const prism = new PrismSplitter();
  assert.ok(prism.trace().every(({ aligned }) => !aligned));
  const solutions = [];
  for (let yaw = 0; yaw < PRISM_DETENTS; yaw++) for (let roll = 0; roll < PRISM_DETENTS; roll++) {
    prism.yaw = yaw;
    prism.roll = roll;
    if (prism.trace().every(({ aligned }) => aligned)) solutions.push([yaw, roll]);
  }
  assert.deepEqual(solutions, [[4, 2]]);
  prism.reset();
  for (let i = 0; i < 3; i++) prism.adjust('yaw', 1);
  prism.step(1);
  assert.equal(prism.lit, false);
  prism.adjust('roll', -1);
  prism.adjust('roll', -1);
  prism.step(0.4);
  assert.equal(prism.lit, false);
  prism.adjust('yaw', 1);
  prism.step(DT);
  prism.adjust('yaw', -1);
  prism.step(0.4);
  assert.equal(prism.lit, false);
  prism.step(0.2);
  assert.equal(prism.lit, true);
});

test('礁柱灯塔：崖顶能步行到站，缆车落点可走进塔门直达灯室', () => {
  const physics = new PhysicsSystem();
  const world = buildVillage(physics, false, false, true);
  globalThis.document = { createElement: () => ({ getContext: () => ({
    fillRect() {}, strokeRect() {}, fillText() {},
  }) }) };
  const body = new CharacterBody();
  physics.addBody(body);
  const env = { physics, body };
  function mustWalk([x, y, z]) {
    let distance = Infinity;
    for (let i = 0; i < 600; i++) {
      const dx = x - body.position.x, dz = z - body.position.z;
      distance = Math.hypot(dx, dz);
      if (distance < 0.075) break;
      body.velocity.x = 1.45 * dx / distance;
      body.velocity.z = 1.45 * dz / distance;
      physics.step(DT);
    }
    assert.ok(distance < 0.15 && Math.abs(y - body.position.y) < 0.4 && body.onGround,
      `(${x}, ${y}, ${z}) ← ${body.position.toArray().map((n) => n.toFixed(2))}`);
  }
  try {
    const art = new LighthouseArt(physics);
    const cable = new CableCar();
    world.add(art.root);
    place(env, new THREE.Vector3(...STAGES.s3.spawn));
    mustWalk(WINCH);
    mustWalk(cable.landing);
    mustWalk(CABLE_FROM);
    cable.adjust(1);
    cable.adjust(1);
    assert.ok(cable.release() && cable.board('cliff'));
    cable.step(7);
    art.setCarPosition(cable.sample(new THREE.Vector3()));
    const landing = new THREE.Vector3(...cable.landing);
    place(env, landing);
    const towardCar = new THREE.Vector3(...CABLE_TO).sub(landing).normalize();
    walk(env, towardCar, WALK, 1);
    const panelDistance = body.position.clone().sub(new THREE.Vector3(...CABLE_TO)).dot(towardCar.negate());
    assert.ok(body.onGround && panelDistance >= 0.94 + body.radius, '停靠的红色围板应挡住角色');
    mustWalk([-4, 14, 33.1]);
    for (let i = 1; i <= 96; i++) {
      const theta = -Math.PI / 2 + i * Math.PI * 6.5 / 96;
      mustWalk([-4 + 1.93 * Math.cos(theta), 14 + 18 * i / 96, 35 + 1.93 * Math.sin(theta)]);
    }
    mustWalk(PRISM_CONTROL);
    place(env, new THREE.Vector3(-5.93, 18.27, 35));
    walk(env, new THREE.Vector3(1, 0, 0), 1.6, 1.4);
    assert.ok(body.onGround && body.position.x < -5.45 && body.position.y > 17.8,
      `螺旋坡道内侧护栏没有拦住角色：${body.position.toArray().map((n) => n.toFixed(2))}`);
    for (const i of [2, 94]) {
      const theta = -Math.PI / 2 + i * Math.PI * 6.5 / 96;
      const y = 14 + 18 * i / 96;
      const radial = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
      place(env, new THREE.Vector3(-4, y + 0.1, 35).addScaledVector(radial, 1.8));
      walk(env, radial.clone().negate(), WALK, 1);
      const distance = body.position.clone().sub(new THREE.Vector3(-4, body.position.y, 35)).length();
      assert.ok(body.onGround && body.position.y >= y - 0.1 && distance >= 1.4,
        `内侧护栏缺口 ${i}：${body.position.toArray().map((n) => n.toFixed(2))}`);
    }
  } finally {
    delete globalThis.document;
    physics.clear();
    world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

test('裂湾村白盒：从旋梯顶部可走上灯塔外廊', () => {
  const physics = new PhysicsSystem();
  const world = buildVillage(physics);
  const body = new CharacterBody();
  physics.addBody(body);
  const env = { physics, body };
  try {
    place(env, new THREE.Vector3(-2, 32.1, 35));
    assert.ok(body.onGround, '应站在旋梯顶部');
    walk(env, new THREE.Vector3(1, 0, 0), 1.6, 0.6);
    walk(env, new THREE.Vector3(0, 0, 1), 1.6, 0.45);
    assert.ok(body.onGround && body.position.x > -1.2 && body.position.z > 35.6 && body.position.y >= 32.1,
      `外廊没有承托角色：${body.position.toArray().map((n) => n.toFixed(2))}`);
  } finally {
    physics.clear();
    world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
});

for (const [name, start, edgeX] of [
  ['码头', [9, 2.1, -12], 11.4],
  ['崖顶', [-17.7, 39.1, -24], -14.8],
]) {
  test(`裂湾村白盒：${name}护栏阻止角色坠落`, () => {
    const physics = new PhysicsSystem();
    const world = buildVillage(physics);
    const body = new CharacterBody();
    physics.addBody(body);
    const env = { physics, body };
    try {
      place(env, new THREE.Vector3(...start));
      assert.ok(body.onGround, '应站在护栏内侧');
      walk(env, new THREE.Vector3(1, 0, 0), 1.6, 3);
      assert.ok(body.onGround && Math.abs(body.position.x - (edgeX - body.radius)) < 0.06,
        `穿过护栏：${body.position.toArray().map((n) => n.toFixed(2))}`);
    } finally {
      physics.clear();
      world.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
  });
}

for (const [name, err] of results) {
  if (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  } else console.log(`✓ ${name}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
