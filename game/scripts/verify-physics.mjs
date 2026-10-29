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
import { S1, s1StepLinks } from '@/levels/s1/layout';

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

test('楼梯步态：竖直速度固定 0.5455 m/s（017 xi-stairs 22 帧周期），上下楼一样，Shift 不加速', () => {
  const V = gameplay.player.stairs.verticalSpeed;
  assert.equal(V, 0.5455);
  const up = stairRun(false, 1);
  const upRun = stairRun(true, 1);
  const down = stairRun(true, -1);
  for (const [tag, r, sign] of [['上楼慢走', up, 1], ['上楼按 Shift', upRun, 1], ['下楼按 Shift', down, -1]]) {
    assert.ok(r.onFrac > 0.95, `${tag}：楼梯步态只占 ${(r.onFrac * 100).toFixed(0)}%`);
    assert.ok(Math.abs(r.vy * sign - V) < 0.03, `${tag}：竖直 ${r.vy.toFixed(3)} m/s，期望 ±${V}`);
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
  results.push([`  楼梯：上楼 ${up.vy.toFixed(3)} / Shift ${upRun.vy.toFixed(3)} / 下楼 ${down.vy.toFixed(3)} m/s，水平 ${up.vh.toFixed(3)} m/s`]);
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

for (const [name, err] of results) {
  if (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  } else console.log(`✓ ${name}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
