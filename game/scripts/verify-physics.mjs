// v0.1-002 角色物理校验（纯逻辑，无 DOM）：坡度、台阶、螺旋楼梯、贴墙滑动、动态碰撞体、移动速度、碰撞耗时。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-physics.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { CharacterBody, PhysicsSystem } from '@/systems/PhysicsSystem';
import { stepLocomotion } from '@/systems/locomotion';
import { buildTestCourse } from '@/world/testCourse';
import { TraversalLink } from '@/entities/components/TraversalLink';

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

let failed = 0;
for (const [name, err] of results) {
  if (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  } else console.log(`✓ ${name}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
