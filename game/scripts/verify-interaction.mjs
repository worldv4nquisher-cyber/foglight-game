// v0.1-004 交互系统与机关框架校验（纯逻辑，无 DOM）：判定、八种交互、走位、hold、push、机关吸附 / 切换 / 复位 / 暂停、
// 高亮 3 s、锁定点击透传（制作人裁定）、demo 灯塔已改走交互系统、文本表最新。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-interaction.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { EventBus } from '@/core/EventBus';
import { InputManager } from '@/systems/input/InputManager';
import { lockClickPassesThrough } from '@/systems/input/actions';
import { CharacterBody, PhysicsSystem } from '@/systems/PhysicsSystem';
import { Interactable } from '@/systems/interaction/Interactable';
import { InteractionSystem, pushStartRamp } from '@/systems/interaction/InteractionSystem';
import { RotatablePart, nextDetent } from '@/systems/interaction/RotatablePart';
import { PuzzleGroup, puzzleBarText } from '@/systems/interaction/PuzzleMode';
import { t as text } from '@/content/text';
import { asXiClip, pushRate } from '@/entities/xi/clips';

const DT = 1 / 60;
let now = 0;
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}

/** 一个最小场景：地面 + 角色 + 相机（站在角色身后 3 m 看向 -z） */
function setup({ floor = true, linkPriority } = {}) {
  now = 0;
  const events = new EventBus();
  const input = new InputManager(events, () => now);
  const physics = new PhysicsSystem();
  const scene = new THREE.Scene();
  if (floor) {
    const ground = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40));
    ground.position.y = -0.5;
    scene.add(ground);
    ground.updateMatrixWorld(true);
    physics.addMesh(ground);
  }
  const body = new CharacterBody();
  physics.addBody(body);
  body.teleport(new THREE.Vector3(0, 0, 0));
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const log = { prompt: [], markers: [], hold: [], bar: [], camera: [], said: [], read: [] };
  const hud = {
    setPrompt: (s) => log.prompt.push(s),
    setMarkers: (m) => log.markers.push(m),
    setHoldProgress: (p) => log.hold.push(p),
    setPuzzleBar: (s) => log.bar.push(s),
  };
  const actor = { body, facing: Math.PI, locked: false, busy: false, halt() {}, hand: new THREE.Object3D() };
  scene.add(actor.hand);
  const cameraFollow = {
    enterPuzzleView: (node, opts) => log.camera.push(['enter', node.name, opts]),
    exitPuzzleView: () => log.camera.push(['exit']),
  };
  const ix = new InteractionSystem({
    events,
    input,
    physics,
    actor,
    camera,
    cameraFollow,
    hud,
    presenters: { say: (id) => log.said.push(id), read: (id) => log.read.push(id) },
    viewport: () => ({ width: 1600, height: 900 }),
    ...(linkPriority ? { linkPriority } : {}),
  });
  const fired = [];
  for (const ev of ['interact:used', 'interact:pushEnd', 'item:pickup', 'item:place', 'puzzle:enter', 'puzzle:exit', 'puzzle:partSelected', 'puzzle:partRotated', 'puzzle:reset', 'highlight:start', 'highlight:end'])
    events.on(ev, (p) => fired.push([ev, p]));
  const env = { events, input, physics, scene, body, camera, actor, ix, log, fired };
  env.look = () => {
    // 相机在角色身后，看向角色朝向前方 2 m 处
    const f = new THREE.Vector3(Math.sin(actor.facing), 0, Math.cos(actor.facing));
    camera.position.copy(body.position).addScaledVector(f, -3).setY(1.8);
    camera.lookAt(body.position.clone().addScaledVector(f, 2).setY(0.8));
    camera.updateMatrixWorld(true);
  };
  /** 一个物理步 + 一帧（press / release：本步前按下 / 松开的键码） */
  env.step = (n = 1, { press = [], release = [], look } = {}) => {
    for (let i = 0; i < n; i++) {
      input.beginFrame();
      if (i === 0) {
        for (const c of press) input.setRaw('kbm', c, true);
        for (const c of release) input.setRaw('kbm', c, false);
        if (look) input.addLook(look[0], look[1]);
      }
      env.look();
      ix.fixedUpdate(DT);
      physics.step(DT);
      ix.update(DT);
      input.endFrame();
      now += DT;
    }
  };
  env.tap = (code) => {
    env.step(1, { press: [code] });
    env.step(1, { release: [code] });
  };
  env.box = (name, pos, size = [0.6, 0.6, 0.6]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size));
    m.name = name;
    m.position.set(...pos);
    scene.add(m);
    m.updateMatrixWorld(true);
    return m;
  };
  env.look();
  return env;
}

const used = (env, id) => env.fired.filter(([e, p]) => e === 'interact:used' && p.id === id).length;

// ---------------------------------------------------------------- 判定

test('优先级：附近有跨越点（默认 10）时 inspect / read（0）让位，E 留给跨越；操作类（20）不让；离开跨越点恢复', () => {
  let link = null;
  const env = setup({ linkPriority: () => link });
  const crate = env.box('crate', [0, 0.3, -2]);
  const look = env.ix.add(new Interactable({ id: 'slot', kind: 'inspect', object: crate, textId: 'ch1.s1.nets.inspect', reach: 0.3 }));
  assert.equal(look.priority, 0);
  env.step(2);
  assert.equal(env.ix.current?.id, 'slot');
  link = 10; // 站到跨越点起点（TraversalLink 默认优先级）
  env.step(1, { press: ['KeyE'] });
  assert.equal(env.ix.current, null, 'inspect 不当候选');
  assert.equal(env.log.said.length, 0, 'E 没被 inspect 吃掉');
  assert.ok(env.input.consumePressed('interact'), 'E 还在，留给 PlayerController 的跨越');
  env.step(1, { release: ['KeyE'] });
  const lever = env.box('lever', [0.2, 0.3, -1.6]);
  env.ix.add(new Interactable({ id: 'lever', kind: 'use', object: lever, approach: false }));
  env.step(1);
  assert.equal(env.ix.current?.id, 'lever', '操作类（20）压过跨越点');
  env.ix.items.splice(env.ix.items.findIndex((i) => i.id === 'lever'), 1);
  link = null;
  env.step(1);
  assert.equal(env.ix.current?.id, 'slot', '离开跨越点：inspect 恢复候选');
});


test('BUG-014 aimCone：没对准的「看看而已」（0）让给画面里的操作类（20）；对准了照样选；画面里没有更高优先级时照常参与；不设 aimCone 的行为不变', () => {
  const env = setup();
  const ndcOf = (it) => {
    const v = it.focus(new THREE.Vector3()).project(env.camera);
    return Math.hypot(v.x, v.y);
  };
  // 书桌缩影：墙上海图在屏幕中心偏上（离中心最近），日志在桌面偏下
  const chartM = env.box('chart', [0.15, 1.35, -1.9], [0.5, 0.4, 0.02]);
  const journalM = env.box('journal', [-0.35, 0.35, -1.5], [0.3, 0.05, 0.2]);
  const chart = env.ix.add(new Interactable({ id: 'chart', kind: 'inspect', object: chartM, textId: 'ch1.s1.nets.inspect', reach: 0.3, aimCone: 0.13 }));
  const journal = env.ix.add(new Interactable({ id: 'journal', kind: 'use', object: journalM, approach: false }));
  env.step(1);
  const [dc, dj] = [ndcOf(chart), ndcOf(journal)];
  assert.ok(dc > 0.13 && dc < dj, `前提：海图在 aimCone 外、但比日志离中心近（${dc.toFixed(2)} / ${dj.toFixed(2)}）`);
  assert.equal(env.ix.current?.id, 'journal', '默认视角选日志，不选海图');
  // 「朝海图看」：把海图挪到准星上
  chartM.position.set(0, 0.85, -1.9);
  chartM.updateMatrixWorld(true);
  env.step(1);
  assert.ok(ndcOf(chart) <= 0.13);
  assert.equal(env.ix.current?.id, 'chart', '对准海图时选海图');
  // 日志不可用（例如在画面外）→ 海图没对准也照常参与
  chartM.position.set(0.15, 1.35, -1.9);
  chartM.updateMatrixWorld(true);
  journal.enabled = false;
  env.step(1);
  assert.equal(env.ix.current?.id, 'chart', '画面里没有更高优先级的候选时 aimCone 不起作用');
  journal.enabled = true;
  // 不设 aimCone：还是离屏幕中心最近的赢（旧行为）
  const plain = env.ix.add(new Interactable({ id: 'plain', kind: 'inspect', object: env.box('plain', [0.15, 1.3, -1.85], [0.1, 0.1, 0.1]), textId: 'ch1.s1.nets.inspect', reach: 0.3 }));
  env.step(1);
  assert.ok(ndcOf(plain) < dj);
  assert.equal(env.ix.current?.id, 'plain', '没设 aimCone 的按离屏幕中心最近选（行为不变）');
});


test('判定：距离 ≤ 1.8 m 且朝向夹角 ≤ 60° 才显示提示；E 触发', () => {
  const env = setup();
  const crate = env.box('crate', [0, 0.3, -2]); // 焦点（包围盒中心）距角色 2 m，reach 0.3 → 1.7 m
  const it = env.ix.add(new Interactable({ id: 'crate', kind: 'inspect', object: crate, textId: 'ch1.s1.nets.inspect', reach: 0.3 }));
  assert.ok(env.ix.canInteract(it), '1.7 m 正对：可交互');
  env.step(2);
  assert.equal(env.log.prompt.at(-1), text('ui.prompt.inspect'));
  env.actor.facing = Math.PI + THREE.MathUtils.degToRad(59);
  assert.ok(env.ix.canInteract(it), '偏 59°：可交互');
  env.actor.facing = Math.PI + THREE.MathUtils.degToRad(61);
  assert.ok(!env.ix.canInteract(it), '偏 61°：不可交互');
  env.step(2);
  assert.equal(env.log.prompt.at(-1), null, '不可交互时提示隐藏');
  env.actor.facing = Math.PI;
  env.body.position.z = 0.2; // 1.9 m
  assert.ok(!env.ix.canInteract(it), '1.9 m：不可交互');
  env.body.position.z = 0;
  env.tap('KeyE');
  assert.deepEqual(env.log.said, ['ch1.s1.nets.inspect']);
  assert.equal(used(env, 'crate'), 1);
  assert.equal(env.input.context, 'explore', 'inspect 不暂停、不换上下文');
});

test('图标：3.5 m 内且在屏幕内才显示；可交互的那个 active', () => {
  const env = setup();
  const near = env.box('near', [0, 0.3, -1.5]);
  const far = env.box('far', [0.5, 0.3, -3.6]); // 3.6 - 0 = 3.63 m（reach 0）
  const mid = env.box('mid', [-0.6, 0.3, -3.3]);
  env.ix.add(new Interactable({ id: 'near', kind: 'inspect', object: near, textId: 'ch1.s1.nets.inspect' }));
  env.ix.add(new Interactable({ id: 'far', kind: 'inspect', object: far, textId: 'ch1.s1.nets.inspect' }));
  env.ix.add(new Interactable({ id: 'mid', kind: 'inspect', object: mid, textId: 'ch1.s1.nets.inspect' }));
  env.step(2);
  const m = env.ix.markers();
  assert.deepEqual(m.map((x) => x.id).sort(), ['mid', 'near']);
  assert.ok(m.find((x) => x.id === 'near').active && !m.find((x) => x.id === 'mid').active);
  assert.ok(m.every((x) => x.x >= 0 && x.x <= 1600 && x.y >= 0 && x.y <= 900));
});

test('多个候选：取最靠近屏幕中心的那个', () => {
  const env = setup();
  const a = env.box('a', [0.9, 0.3, -1.4]);
  const b = env.box('b', [-0.1, 0.3, -1.6]);
  env.ix.add(new Interactable({ id: 'a', kind: 'inspect', object: a, textId: 'ch1.s1.nets.inspect' }));
  env.ix.add(new Interactable({ id: 'b', kind: 'read', object: b, textId: 'ch1.s1.notice.doc' }));
  env.step(1);
  assert.equal(env.log.prompt.at(-1), text('ui.prompt.read'));
  env.tap('KeyE');
  assert.deepEqual(env.log.read, ['ch1.s1.notice.doc']);
  assert.equal(used(env, 'a'), 0);
});

test('禁用 / 无效配置', () => {
  const env = setup();
  const a = env.box('a', [0, 0.3, -1.4]);
  const it = env.ix.add(new Interactable({ id: 'a', kind: 'inspect', object: a, textId: 'ch1.s1.nets.inspect', enabled: false }));
  assert.ok(!env.ix.canInteract(it));
  assert.throws(() => new Interactable({ id: 'x', kind: 'inspect', object: a }), /textId/);
  assert.throws(() => new Interactable({ id: 'x', kind: 'push', object: a }), /track/);
  assert.throws(() => new Interactable({ id: 'x', kind: 'place', object: a }), /socket/);
});

// ---------------------------------------------------------------- pickup / place

test('pickup / place：空手才能拿，只能放到 -socket 上（物品对得上、插槽空着）', () => {
  const env = setup();
  const pedestal = env.box('pedestal', [0.8, 0.45, -1.3], [0.4, 0.9, 0.4]);
  const sockA = new THREE.Object3D();
  sockA.name = 'pedestal-socket';
  sockA.position.set(0, 0.45, 0);
  pedestal.add(sockA);
  const stand = env.box('stand', [-0.8, 0.45, -1.3], [0.4, 0.9, 0.4]);
  const sockB = new THREE.Object3D();
  sockB.name = 'stand-socket';
  sockB.position.set(0, 0.45, 0);
  stand.add(sockB);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2));
  lantern.name = 'lantern';
  sockA.add(lantern);
  env.scene.updateMatrixWorld(true);
  const pick = env.ix.add(new Interactable({ id: 'lantern', kind: 'pickup', object: lantern, item: 'lantern' }));
  const placeA = env.ix.add(new Interactable({ id: 'pedestal', kind: 'place', object: pedestal, socket: sockA, item: 'lantern' }));
  const placeB = env.ix.add(new Interactable({ id: 'stand', kind: 'place', object: stand, socket: sockB, item: 'lantern' }));
  env.ix.held.setPlaced('lantern', lantern, sockA);
  assert.ok(env.ix.canInteract(pick));
  assert.ok(!env.ix.canInteract(placeA) && !env.ix.canInteract(placeB), '空手：不能放');
  env.ix.trigger(pick);
  assert.equal(lantern.parent, env.actor.hand, '提灯挂到手上');
  assert.ok(!env.ix.canInteract(pick), '拿着东西：不能再拿');
  assert.ok(env.ix.canInteract(placeA) && env.ix.canInteract(placeB), '原插槽和另一个插槽都可以放');
  env.ix.trigger(placeB);
  assert.equal(lantern.parent, sockB, '放到 stand-socket');
  assert.ok(!env.ix.held.holding);
  assert.ok(!env.ix.canInteract(placeB), '插槽已占：不能再放');
  assert.deepEqual(env.fired.filter(([e]) => e.startsWith('item:')).map(([e, p]) => [e, p.item, p.socket ?? p.from]), [
    ['item:pickup', 'lantern', 'pedestal-socket'],
    ['item:place', 'lantern', 'stand-socket'],
  ]);
});

// ---------------------------------------------------------------- use：自动走位

function useEnv({ wall = false, approach } = {}) {
  const env = setup();
  const bell = env.box('bell', [0, 1.2, -2.2], [0.6, 0.6, 0.6]);
  const point = new THREE.Object3D();
  point.name = 'bell-interact';
  point.position.set(0.6, 0, -1.6); // 交互点在角色右前方 ~0.85 m，+Z 朝物体
  point.lookAt(new THREE.Vector3(0.6, 0, -10)); // lookAt 让 +Z 指向目标（Object3D 非相机时）
  env.scene.add(point);
  point.updateMatrixWorld(true);
  if (wall) {
    const w = env.box('wall', [0.3, 1, -0.8], [0.1, 2, 0.1]);
    env.physics.addMesh(w);
  }
  const it = env.ix.add(new Interactable({ id: 'bell', kind: 'use', object: bell, interactPoint: point, reach: 0.5, approach }));
  return { env, it, point };
}

test('use：按 E 那一步就开始走位，按 E → interact:used ≤ 0.4 − 2 个固定步（给输入帧延迟留余量；QA batch5 实测 0.433 s）', () => {
  const { env } = useEnv();
  env.actor.facing = Math.PI + 0.9; // 斜着，需要转身
  env.look?.();
  env.step(1, { press: ['KeyE'] });
  let steps = 1;
  assert.equal(env.ix.actionKind, 'approach');
  while (used(env, 'bell') === 0 && steps < 200) {
    env.step(1, steps === 1 ? { release: ['KeyE'] } : {});
    steps++;
  }
  const secs = steps * DT;
  assert.ok(secs <= 0.4 - 2 * DT + 1e-9, `按 E → used ${secs.toFixed(3)} s`);
});

test('use：自动走到交互点并转向，用时 ≤ 0.4 s，结束后发 interact:used', () => {
  const { env, it, point } = useEnv();
  assert.ok(env.ix.canInteract(it));
  env.actor.facing = Math.PI + 0.9; // 斜着，需要转身
  env.ix.trigger(it);
  assert.equal(env.ix.actionKind, 'approach');
  assert.ok(env.actor.locked, '走位期间锁定玩家');
  let steps = 0;
  while (env.ix.actionKind !== 'none' && steps < 200) {
    env.step(1);
    steps++;
  }
  const secs = steps * DT;
  assert.ok(secs <= gameplay.interaction.approachMaxTime + DT + 1e-9, `走位 ${secs.toFixed(3)} s`);
  assert.ok(Math.hypot(env.body.position.x - point.position.x, env.body.position.z - point.position.z) < 0.03, '站到交互点');
  const stand = it.standPoint(new THREE.Vector3());
  assert.ok(Math.abs(env.actor.facing - stand.facing) < 1e-6, '朝向交互点 +Z');
  assert.equal(used(env, 'bell'), 1);
  assert.ok(!env.actor.locked);
});

test('use：路径被挡时不穿模（原地转身后照常触发）', () => {
  const { env, it } = useEnv({ wall: true });
  const start = env.body.position.clone();
  env.ix.trigger(it);
  let maxDev = 0;
  for (let i = 0; i < 40 && env.ix.actionKind !== 'none'; i++) {
    env.step(1);
    maxDev = Math.max(maxDev, Math.hypot(env.body.position.x - start.x, env.body.position.z - start.z));
  }
  assert.ok(maxDev < 0.05, `没有穿过柱子（偏移 ${maxDev.toFixed(3)} m）`);
  assert.equal(used(env, 'bell'), 1);
});

test('use(approach:false)：不走位，按下即触发（demo 灯塔）', () => {
  const { env, it } = useEnv({ approach: false });
  const start = env.body.position.clone();
  env.ix.trigger(it);
  assert.equal(used(env, 'bell'), 1);
  assert.ok(env.body.position.distanceTo(start) < 1e-9);
});

// ---------------------------------------------------------------- hold

function holdEnv(extra = {}) {
  const env = setup();
  const valve = env.box('valve', [0, 0.9, -1.4], [0.5, 0.5, 0.2]);
  const p = new THREE.Object3D();
  p.name = 'valve-interact';
  p.position.set(0, 0, -0.9);
  p.lookAt(0, 0, -10);
  env.scene.add(p);
  p.updateMatrixWorld(true);
  const it = env.ix.add(new Interactable({ id: 'valve', kind: 'hold', object: valve, interactPoint: p, ...extra }));
  return { env, it };
}

test('hold：按住 2 s 完成，圆环走满', () => {
  const { env } = holdEnv();
  env.step(1, { press: ['KeyE'] });
  // 走位（≤ 0.4 s）+ 2 s
  let steps = 0;
  while (used(env, 'valve') === 0 && steps < 300) {
    env.step(1);
    steps++;
  }
  assert.equal(used(env, 'valve'), 1);
  const holdSecs = steps * DT;
  assert.ok(holdSecs >= 2 - 1e-6 && holdSecs <= 2 + gameplay.interaction.approachMaxTime + 2 * DT, `按住 ${holdSecs.toFixed(2)} s`);
  const shown = env.log.hold.filter((x) => x !== null);
  assert.ok(shown.includes(1) || Math.max(...shown) > 0.97, '圆环显示到满');
  env.step(1, { release: ['KeyE'] });
  assert.equal(env.log.hold.at(-1), null, '完成后圆环隐藏');
});

test('hold：中途松开进度归零，不触发', () => {
  const { env } = holdEnv();
  const progress = [];
  env.events.on('interact:holdProgress', ({ progress: p }) => progress.push(p));
  env.step(1, { press: ['KeyE'] });
  env.step(90);
  env.step(1, { release: ['KeyE'] });
  env.step(5);
  assert.equal(used(env, 'valve'), 0);
  assert.equal(progress.at(-1), 0);
  assert.equal(env.ix.holdProgress, 0);
  assert.equal(env.log.hold.at(-1), null);
  assert.equal(env.ix.actionKind, 'none');
});

// ---------------------------------------------------------------- push

test('push：按住沿轨道 0.8 m/s 移动、角色跟随，到端点发 pushEnd 并不可再推', () => {
  const env = setup();
  const raft = env.box('raft', [0, 0.25, -1.5], [1, 0.5, 1]);
  const p = new THREE.Object3D();
  p.name = 'raft-interact';
  p.position.set(0, -0.25, 0.75);
  p.rotation.y = Math.PI; // +Z 朝向木筏
  raft.add(p);
  raft.updateMatrixWorld(true);
  const it = env.ix.add(
    new Interactable({
      id: 'raft',
      kind: 'push',
      object: raft,
      track: { from: new THREE.Vector3(0, 0.25, -1.5), to: new THREE.Vector3(0, 0.25, -3.5) },
    }),
  );
  env.step(1, { press: ['KeyE'] });
  while (env.ix.actionKind === 'approach') env.step(1);
  assert.equal(env.ix.actionKind, 'push');
  const z0 = raft.position.z;
  const b0 = env.body.position.z;
  env.step(60);
  const moved = z0 - raft.position.z;
  assert.ok(Math.abs(moved - 0.8) < 0.03, `1 s 推了 ${moved.toFixed(3)} m`);
  assert.ok(Math.abs(b0 - env.body.position.z - moved) < 0.03, '角色跟着走');
  env.step(1, { release: ['KeyE'] });
  const zr = raft.position.z;
  env.step(10);
  assert.equal(raft.position.z, zr, '松开即停');
  env.step(1, { press: ['KeyE'] });
  for (let i = 0; i < 240 && !env.fired.some(([e]) => e === 'interact:pushEnd'); i++) env.step(1);
  assert.ok(env.fired.some(([e, q]) => e === 'interact:pushEnd' && q.id === 'raft'));
  assert.ok(Math.abs(raft.position.z + 3.5) < 1e-6, '停在终点');
  assert.ok(it.locked && !env.ix.canInteract(it), '到终点后锁定');
});

// ---------------------------------------------------------------- 机关

function puzzleEnv() {
  const env = setup();
  const root = env.box('mech', [0, 0.6, -1.2], [0.6, 0.6, 0.6]);
  const dialNode = new THREE.Object3D();
  dialNode.name = 'dial';
  dialNode.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3)));
  root.add(dialNode);
  const yaw = new THREE.Object3D();
  yaw.name = 'mirror-yaw';
  const pitch = new THREE.Object3D();
  pitch.name = 'mirror-pitch';
  pitch.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.02)));
  yaw.add(pitch);
  root.add(yaw);
  const cam = new THREE.Object3D();
  cam.name = 'mech-cam';
  root.add(cam);
  root.updateMatrixWorld(true);
  const dial = new RotatablePart({ id: 'dial', node: dialNode, axes: [{ axis: 'y' }] });
  const mirror = new RotatablePart({
    id: 'mirror',
    node: yaw,
    axes: [
      { axis: 'y', min: -90, max: 90 },
      { axis: 'x', node: pitch, min: -30, max: 30 },
    ],
  });
  const group = new PuzzleGroup({ id: 'mech', parts: [dial, mirror], camNode: cam });
  const it = env.ix.add(new Interactable({ id: 'mech', kind: 'puzzle', object: root, puzzle: group }));
  return { env, it, dial, mirror, group };
}

test('吸附档位：15° 一档、Shift 7.5°（绝对网格）', () => {
  assert.equal(nextDetent(0, 1, 15), 15);
  assert.equal(nextDetent(15, -1, 15), 0);
  assert.equal(nextDetent(7.5, 1, 15), 15);
  assert.equal(nextDetent(7.5, -1, 15), 0);
  assert.equal(nextDetent(0, 1, 7.5), 7.5);
});

test('机关：E 进入（相机机位、puzzle 上下文、操作条），鼠标 / 键盘转一档 15°，Shift 7.5°', () => {
  const { env, dial } = puzzleEnv();
  env.tap('KeyE');
  assert.equal(env.input.context, 'puzzle');
  assert.ok(env.actor.locked);
  assert.deepEqual(env.log.camera.at(-1), ['enter', 'mech-cam', { freeLook: false }]);
  assert.match(env.log.bar.at(-1), /Q·E/);
  const step = gameplay.puzzle.mouseStepRad;
  // 鼠标向右：攒够一档转 15°
  env.step(1, { look: [step * 1.05 / lookScale(env), 0] });
  assert.equal(dial.angles[0], 15);
  // 键盘 D：按下转一档
  env.step(1, { press: ['KeyD'] });
  assert.equal(dial.angles[0], 30);
  env.step(1, { release: ['KeyD'] });
  // Shift + A：7.5°
  env.step(1, { press: ['ShiftLeft', 'KeyA'] });
  assert.equal(dial.angles[0], 22.5);
  env.step(1, { release: ['ShiftLeft', 'KeyA'] });
  const rot = env.fired.filter(([e]) => e === 'puzzle:partRotated').map(([, p]) => [p.part, p.angle, p.fine]);
  assert.deepEqual(rot, [
    ['dial', 15, false],
    ['dial', 30, false],
    ['dial', 22.5, true],
  ]);
  // 按住连发
  env.step(1, { press: ['KeyD'] });
  env.step(Math.round((gameplay.puzzle.keyRepeatDelay + gameplay.puzzle.keyRepeatInterval * 2) / DT) + 1);
  env.step(1, { release: ['KeyD'] });
  assert.ok(dial.angles[0] >= 22.5 + 15 * 3, `连发后 ${dial.angles[0]}°`);
});

/** addLook 的输入到 getLookDelta 的倍率（灵敏度） */
function lookScale(env) {
  env.input.beginFrame();
  env.input.addLook(1, 0);
  const k = env.input.getLookDelta().x;
  env.input.endFrame();
  return k;
}

test('机关：Q / E 切换部件，高亮跟着走；双轴部件鼠标上下转第二轴、到限位停', () => {
  const { env, mirror } = puzzleEnv();
  env.tap('KeyE');
  const hl = () => env.ix.highlighter.keys().filter((k) => k.startsWith('puzzle:'));
  assert.deepEqual(hl(), ['puzzle:mech:dial']);
  env.tap('KeyE');
  assert.deepEqual(hl(), ['puzzle:mech:mirror']);
  env.tap('KeyQ');
  assert.deepEqual(hl(), ['puzzle:mech:dial']);
  env.tap('KeyQ'); // 循环
  assert.deepEqual(hl(), ['puzzle:mech:mirror']);
  const k = lookScale(env);
  const s = gameplay.puzzle.mouseStepRad / k;
  env.step(1, { look: [0, -s * 1.05] }); // 鼠标向上 → 第二轴 +
  assert.equal(mirror.angles[1], 15);
  for (let i = 0; i < 5; i++) env.step(1, { look: [0, -s * 1.05] });
  assert.equal(mirror.angles[1], 30, '俯仰限位 30°');
  env.step(1, { press: ['KeyS'] });
  assert.equal(mirror.angles[1], 15, '键盘 S 第二轴 -');
  env.step(1, { release: ['KeyS'] });
  const sel = env.fired.filter(([e]) => e === 'puzzle:partSelected').map(([, p]) => p.part);
  assert.deepEqual(sel, ['mirror', 'dial', 'mirror']);
});

test('机关：R 复位、右键 / Tab 退出（相机还原、回 explore、解锁）', () => {
  const { env, dial, mirror } = puzzleEnv();
  env.tap('KeyE');
  dial.setAngle(0, 45);
  mirror.setAngle(0, 30);
  env.tap('KeyR');
  assert.ok(dial.atInitial && mirror.atInitial);
  assert.ok(env.fired.some(([e]) => e === 'puzzle:reset'));
  env.tap('Mouse2');
  assert.equal(env.input.context, 'explore');
  assert.deepEqual(env.log.camera.at(-1), ['exit']);
  assert.equal(env.log.bar.at(-1), null);
  assert.ok(!env.actor.locked);
  assert.deepEqual(env.ix.highlighter.keys(), []);
  // Tab 同样退出
  env.step(3);
  env.tap('KeyE');
  assert.equal(env.input.context, 'puzzle');
  env.tap('Tab');
  assert.equal(env.input.context, 'explore');
});

test('机关：Esc 暂停 → 继续后仍在机关里；第一下右键直接退出（制作人裁定）', () => {
  const { env, dial } = puzzleEnv();
  env.tap('KeyE');
  env.events.emit('game:pause', { reason: 'user' });
  assert.equal(env.input.context, 'menu');
  env.step(1, { look: [10, 0] });
  env.tap('KeyD');
  assert.equal(dial.angles[0], 0, '暂停中不转');
  env.events.emit('game:resume');
  assert.equal(env.input.context, 'puzzle', '继续后回到机关');
  assert.equal(env.ix.actionKind, 'puzzle');
  // 继续后指针已解锁：这一下右键会重新锁定指针，同时也要当成 exitPuzzle（KeyboardMouseInput 依据 lockClickPassesThrough 放行）
  assert.ok(lockClickPassesThrough('puzzle', 'Mouse2'));
  env.tap('Mouse2');
  assert.equal(env.input.context, 'explore');
});

test('锁定点击透传：只放行绑定了 exitPuzzle 的键（机关 / 阅读的右键），其余这一下只锁定', () => {
  assert.equal(lockClickPassesThrough('puzzle', 'Mouse2'), true);
  assert.equal(lockClickPassesThrough('reading', 'Mouse2'), true);
  assert.equal(lockClickPassesThrough('puzzle', 'Mouse0'), false);
  assert.equal(lockClickPassesThrough('explore', 'Mouse0'), false);
  assert.equal(lockClickPassesThrough('explore', 'Mouse2'), false, '探索里右键是观察，锁定那下不触发');
  const src = readFileSync('src/systems/input/KeyboardMouseInput.ts', 'utf8');
  assert.match(src, /requestPointerLock\(\);\s*if \(!lockClickPassesThrough\(this\.sink\.context, code\)\) return;/);
});

test('单部件机关：操作条不显示 Q·E', () => {
  assert.doesNotMatch(puzzleBarText(1), /Q·E/);
  assert.match(puzzleBarText(2), /Q·E/);
  assert.match(puzzleBarText(1), /R/);
});

// ---------------------------------------------------------------- 高亮

test('提示高亮：描边 3 s 后消失并发 highlight:end', () => {
  const env = setup();
  const a = env.box('a', [0, 0.3, -1.4]);
  env.ix.add(new Interactable({ id: 'a', kind: 'inspect', object: a, textId: 'ch1.s1.nets.inspect' }));
  env.ix.highlight(['a']);
  const shells = () => a.children.filter((c) => c.userData.__outline).length;
  assert.equal(shells(), 1);
  env.step(Math.round(2.9 / DT));
  assert.equal(shells(), 1, '2.9 s 还在');
  env.step(Math.round(0.2 / DT));
  assert.equal(shells(), 0, '3 s 后消失');
  assert.ok(env.fired.some(([e, p]) => e === 'highlight:end' && p.ids.includes('a')));
});

// ---------------------------------------------------------------- 接入

test('demo 灯塔改走交互系统，场景里不再直接读 E', () => {
  for (const f of ['src/scenes/S1EbbShoreScene.ts', 'src/levels/s3/S3Scene.ts', 'src/levels/s3/puzzles.ts', 'src/scenes/LevelScene.ts', 'src/scenes/TestbedScene.ts', 'src/world/Lighthouse.ts', 'src/levels/s1/S1Scene.ts', 'src/levels/s1/puzzles.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /consumePressed\('interact'\)/, f);
  }
  const main = readFileSync('src/scenes/S1EbbShoreScene.ts', 'utf8');
  assert.match(main, /id: 'lighthouse',\s*kind: 'use'/);
  assert.match(readFileSync('src/levels/s3/puzzles.ts', 'utf8'), /id: S3_IDS.lever,\s*kind: 'use'/);
});

test('交互提示文字全部来自文本表', () => {
  for (const f of ['src/systems/interaction/InteractionSystem.ts', 'src/systems/interaction/Interactable.ts']) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')
      .split('\n')
      .filter((l) => !/new Error\(/.test(l)) // 开发期报错信息不算界面文字
      .join('\n');
    assert.doesNotMatch(src, /'[^']*[\u4e00-\u9fff][^']*'/, `${f} 有硬编码中文`);
  }
});


// ---------------------------------------------------------------- v0.1-017 交互动作（有汐动画时）

/** 假动画：记录 setPose / clearPose / setLoop；has 按给的 clip 表 */
function fakeAnim(env, clips) {
  const log = { poses: [], cleared: 0, loops: [] };
  env.actor.anim = {
    has: (c) => clips.includes(c),
    setPose: (c, t) => log.poses.push([c, t]),
    clearPose: () => log.cleared++,
    setLoop: (c, r) => log.loops.push([c, r]),
  };
  return log;
}
const stepUntil = (env, pred, max = 600) => {
  let n = 0;
  while (!pred() && n < max) {
    env.step(1);
    n++;
  }
  return n;
};

test('017 放风灯到灯台：先走到 socket 前 0.65 m 面向 socket，xi-place 第 48 帧（1.6 s）才放下，播完 2.33 s 解锁', () => {
  const env = setup();
  const anim = fakeAnim(env, ['xi-place', 'xi-pickup']);
  const lantern = env.box('lantern', [0, 0.3, 1], [0.2, 0.3, 0.2]);
  const pick = env.ix.add(new Interactable({ id: 'lantern', kind: 'pickup', object: lantern, anim: 'xi-pickup', animStand: 0.65 }));
  env.ix.trigger(pick);
  const nGrab = stepUntil(env, () => env.fired.some(([e]) => e === 'item:pickup'));
  // 走位 ≤ 0.36 s + grab 第 22 帧
  assert.ok(nGrab * DT >= 22 / 30 - 1e-6 && nGrab * DT <= 22 / 30 + gameplay.interaction.approachMaxTime + 2 * DT, `拿起在 ${(nGrab * DT).toFixed(2)} s`);
  stepUntil(env, () => !env.actor.locked);
  const stand = env.scene.add(new THREE.Object3D());
  const socket = new THREE.Object3D();
  socket.name = 'stand-socket';
  socket.position.set(2, 1.008, -1);
  stand.add(socket);
  stand.updateMatrixWorld(true);
  const place = env.ix.add(new Interactable({ id: 'stand', kind: 'place', object: stand, socket, item: 'lantern', anim: 'xi-place', animStand: 0.65 }));
  env.ix.trigger(place);
  env.step(1);
  assert.equal(env.actor.locked, true, '播动作期间锁定');
  const n = stepUntil(env, () => used(env, 'stand') > 0);
  const d = Math.hypot(env.body.position.x - 2, env.body.position.z + 1);
  assert.ok(Math.abs(d - 0.65) < 0.01, `站位离 socket ${d.toFixed(3)} m`);
  const toSocket = Math.atan2(2 - env.body.position.x, -1 - env.body.position.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(env.actor.facing - toSocket), Math.cos(env.actor.facing - toSocket))) < 0.01, '面向 socket');
  assert.ok(n * DT >= 1.6 - DT && n * DT <= 1.6 + gameplay.interaction.approachMaxTime + 2 * DT, `release 在 ${(n * DT).toFixed(2)} s`);
  const m = stepUntil(env, () => !env.actor.locked);
  assert.ok(Math.abs((n + m + 1) * DT - (2.3333 + 0.36)) < 0.4, '播完解锁');
  assert.ok(anim.poses.some(([c, t]) => c === 'xi-place' && Math.abs(t - 70 / 30) < 1e-6), '播到末帧');
  assert.ok(anim.cleared >= 2, '结束 clearPose');
});

test('017 交互点节点 extras.anim 优先（地窖木架 xi-pickup-shelf）；approach:false 的 use 有动画时也先走位，grab 第 22 帧生效', () => {
  const env = setup();
  fakeAnim(env, ['xi-pickup-shelf', 'xi-pickup-table']);
  const key = env.box('key', [0, 1.1, -1.5], [0.1, 0.02, 0.05]);
  const p = new THREE.Object3D();
  p.name = 'shelf-interact';
  p.position.set(0, 0, -1.05);
  p.lookAt(0, 0, -10);
  p.userData.anim = 'xi-pickup-shelf';
  env.scene.add(p);
  p.updateMatrixWorld(true);
  const it = env.ix.add(new Interactable({ id: 'key', kind: 'use', object: key, approach: false, interactPoint: p, anim: 'xi-pickup-table' }));
  assert.equal(it.resolveAnim(), 'xi-pickup-shelf', '节点 anim 优先');
  p.userData.anim = 'xi-pull-lever';
  assert.equal(it.resolveAnim(), 'xi-ignite-lever', '旧名别名');
  p.userData.anim = 'xi-pickup-shelf';
  env.ix.trigger(it);
  const n = stepUntil(env, () => used(env, 'key') > 0);
  assert.ok(Math.abs(env.body.position.z + 1.05) < 0.01, '走到木架站位');
  assert.ok(n * DT >= 22 / 30 - DT && n * DT <= 22 / 30 + gameplay.interaction.approachMaxTime + 2 * DT, `grab 在 ${(n * DT).toFixed(2)} s`);
  assert.equal(asXiClip('xi-nope'), null);
});

test('017 阀门 xi-valve-hold：握住 16 帧圆环不动，圆环 2 s 对应转动 16–76 帧，满后播完松手段（到 3.0 s）再解锁', () => {
  const { env } = holdEnv({ anim: 'xi-valve-hold' });
  const anim = fakeAnim(env, ['xi-valve-hold']);
  const progress = [];
  env.events.on('interact:holdProgress', ({ progress: p }) => progress.push(p));
  env.step(1, { press: ['KeyE'] });
  stepUntil(env, () => env.ix.animState?.clip === 'xi-valve-hold');
  const start = anim.poses.length;
  env.step(Math.floor(16 / 30 / DT) - 2);
  assert.ok(progress.every((x) => x === 0), `握住段圆环为 0：${progress.map((x) => x.toFixed(3)).join(',')}`);
  const n = stepUntil(env, () => used(env, 'valve') > 0);
  const total = (Math.floor(16 / 30 / DT) - 1 + n) * DT; // 进入 hold 那一步已计 1 步
  assert.ok(Math.abs(total - (16 / 30 + 2)) < 3 * DT, `完成用时 ${total.toFixed(2)} s`);
  const turnPoses = anim.poses.slice(start).map(([, t]) => t);
  assert.ok(Math.abs(Math.max(...turnPoses) - 76 / 30) < 1e-6, '转到 76 帧');
  assert.equal(env.actor.locked, true, '松手段仍锁定');
  env.step(1, { release: ['KeyE'] });
  const m = stepUntil(env, () => !env.actor.locked);
  assert.ok(Math.abs((m + 1) * DT - (90 - 76) / 30) < 3 * DT, `松手段 ${((m + 1) * DT).toFixed(2)} s`);
});

test('017 敲钟 xi-ring-bell：interact:used（钟声 / 退潮）在第 30 帧', () => {
  const { env, it } = useEnv();
  fakeAnim(env, ['xi-ring-bell']);
  const bell = env.ix.add(new Interactable({ id: 'bell2', kind: 'use', object: it.object, interactPoint: it.interactPoint, anim: 'xi-ring-bell' }));
  env.ix.trigger(bell);
  const n = stepUntil(env, () => used(env, 'bell2') > 0);
  assert.ok(n * DT >= 1 - DT && n * DT <= 1 + gameplay.interaction.approachMaxTime + 2 * DT, `ring 在 ${(n * DT).toFixed(2)} s`);
});

test('017 推：push-loop 播放率 = 推速 / 0.8，结束停循环；没有动画时交互即时生效（白盒不变）', () => {
  const env = setup();
  const anim = fakeAnim(env, ['xi-push-loop']);
  const crate = env.box('crate2', [0, 0.3, -1.2]);
  const it = env.ix.add(new Interactable({ id: 'crate2', kind: 'push', object: crate, track: { from: new THREE.Vector3(0, 0.3, -1.2), to: new THREE.Vector3(0, 0.3, -1.4), speed: 0.812 } }));
  env.step(1, { press: ['KeyE'] });
  stepUntil(env, () => anim.loops.length > 0);
  assert.deepEqual(anim.loops[0], ['xi-push-loop', pushRate(0.812)]);
  stepUntil(env, () => env.fired.some(([e, q]) => e === 'interact:pushEnd' && q.id === 'crate2'));
  assert.ok(it.locked);
  assert.deepEqual(anim.loops.at(-1), [null, undefined], '推完停循环');
  const env2 = setup();
  const l2 = env2.box('l2', [0, 0.3, -1], [0.2, 0.3, 0.2]);
  const p2 = env2.ix.add(new Interactable({ id: 'l2', kind: 'pickup', object: l2, anim: 'xi-pickup', animStand: 0.65 }));
  env2.ix.trigger(p2);
  assert.equal(used(env2, 'l2'), 1, '无动画：拿起即时');
});

test('017 推：按住 E 起 ≤ 0.6 s 物体开始动（push-start 后半段与移动重叠、smoothstep 加速、接 push-loop 不跳速）→ 松手播 xi-push-end（1.2 s 锁定）；再推到端点也播 end', () => {
  const env = setup();
  const anim = fakeAnim(env, ['xi-push-start', 'xi-push-loop', 'xi-push-end']);
  const crate = env.box('crate3', [0, 0.3, -1.2]);
  const it = env.ix.add(new Interactable({ id: 'crate3', kind: 'push', object: crate, track: { from: new THREE.Vector3(0, 0.3, -1.2), to: new THREE.Vector3(0, 0.3, -2.4), speed: 0.8 } }));
  env.step(1, { press: ['KeyE'] });
  stepUntil(env, () => env.ix.actionKind === 'push');
  assert.equal(env.ix.pushPhase, 'start');
  const z0 = crate.position.z;
  // 逐步记录 push-start 期间物体位置（从进入 push 动作 = 按住 E 起算）
  const zs = [z0];
  let tMove = null;
  while (env.ix.pushPhase === 'start') {
    env.step(1);
    zs.push(crate.position.z);
    if (tMove === null && Math.abs(crate.position.z - z0) > 1e-9) tMove = (zs.length - 1) * DT;
    assert.ok(zs.length < 200, 'push-start 没结束');
  }
  const nStart = zs.length - 1;
  assert.ok(Math.abs(nStart * DT - 1.2) <= 2 * DT, `push-start ${(nStart * DT).toFixed(3)} s`);
  // 制作人拍板：从按住 E 到物体开始动 ≤ 0.6 s（且不是一按就动：前 0.4 s 原地弯腰）
  assert.ok(tMove !== null && tMove <= 0.6 + 1e-9, `物体 ${tMove?.toFixed(3)} s 才开始动（应 ≤ 0.6 s）`);
  assert.ok(tMove >= 0.4, `物体 ${tMove.toFixed(3)} s 就开始动（push-start 前段应原地）`);
  const at06 = Math.round(0.6 / DT);
  assert.ok(z0 - zs[at06] > 1e-3, `0.6 s 时物体只动了 ${((z0 - zs[at06]) * 1000).toFixed(2)} mm（应可见 > 1 mm）`);
  // 速度：重叠段单调加速、不倒退，末步接近满速 0.8；进 loop 第一步不跳速
  const v = zs.slice(1).map((z, i) => (zs[i] - z) / DT);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1] - 1e-9, `push-start 段速度第 ${i} 步变慢`);
  const vLastStart = v.at(-1);
  const zl = crate.position.z;
  env.step(1);
  const vLoop = (zl - crate.position.z) / DT;
  assert.ok(Math.abs(vLoop - 0.8) < 1e-6, `push-loop 速度 ${vLoop}`);
  assert.ok(vLoop - vLastStart <= 0.8 * 0.05, `push-start → loop 跳速 ${vLastStart.toFixed(3)} → ${vLoop.toFixed(3)} m/s`);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] - v[i - 1] <= 0.8 * 0.05, `第 ${i} 步加速度过大 ${v[i - 1].toFixed(3)} → ${v[i].toFixed(3)}`);
  assert.ok(anim.poses.some(([c]) => c === 'xi-push-start') && anim.poses.filter(([c]) => c === 'xi-push-start').at(-1)[1] >= 1.2 - 1e-9, 'push-start 播到末帧');
  assert.ok(anim.cleared >= 1, 'start 播完淡出姿势');
  assert.deepEqual(anim.loops.at(-1), ['xi-push-loop', pushRate(0.8)], '进循环');
  env.step(30);
  assert.ok(z0 - crate.position.z > 0.35, '循环中推着走');
  env.step(1, { release: ['KeyE'] });
  assert.equal(env.ix.pushPhase, null);
  assert.deepEqual(anim.loops.at(-1), [null, undefined], '停循环');
  assert.equal(env.ix.animState?.clip, 'xi-push-end', '松手播 push-end');
  assert.ok(env.actor.locked, 'push-end 期间锁定');
  const zr = crate.position.z;
  const nEnd = stepUntil(env, () => !env.actor.locked);
  assert.ok(Math.abs(nEnd * DT - 1.2) <= 2 * DT, `push-end ${(nEnd * DT).toFixed(3)} s`);
  assert.equal(crate.position.z, zr, 'push-end 期间物体不动');
  // 再推：start → loop → 到端点 pushEnd + push-end
  env.step(1, { press: ['KeyE'] });
  stepUntil(env, () => env.fired.some(([e, q]) => e === 'interact:pushEnd' && q.id === 'crate3'));
  assert.ok(it.locked);
  assert.equal(env.ix.animState?.clip, 'xi-push-end', '到端点也播 push-end');
  // push-start 前段（物体还没动）松手：不播 end，直接淡回
  const env2 = setup();
  const a2 = fakeAnim(env2, ['xi-push-start', 'xi-push-loop', 'xi-push-end']);
  const c2 = env2.box('crate4', [0, 0.3, -1.2]);
  env2.ix.add(new Interactable({ id: 'crate4', kind: 'push', object: c2, track: { from: new THREE.Vector3(0, 0.3, -1.2), to: new THREE.Vector3(0, 0.3, -2.4) } }));
  env2.step(1, { press: ['KeyE'] });
  stepUntil(env2, () => env2.ix.pushPhase === 'start');
  env2.step(10);
  env2.step(1, { release: ['KeyE'] });
  assert.equal(env2.ix.animState, null, '还没动就松手不播 end');
  assert.ok(!env2.actor.locked && a2.cleared >= 1 && a2.loops.length === 1 && a2.loops[0][0] === null, '解锁、淡回、没进循环');
  // 重叠段（已经在动、还没进 loop）松手：物体停、播 push-end 收手
  const env3 = setup();
  fakeAnim(env3, ['xi-push-start', 'xi-push-loop', 'xi-push-end']);
  const c3 = env3.box('crate5', [0, 0.3, -1.2]);
  env3.ix.add(new Interactable({ id: 'crate5', kind: 'push', object: c3, track: { from: new THREE.Vector3(0, 0.3, -1.2), to: new THREE.Vector3(0, 0.3, -2.4) } }));
  env3.step(1, { press: ['KeyE'] });
  stepUntil(env3, () => env3.ix.pushPhase === 'start');
  stepUntil(env3, () => c3.position.z < -1.2 - 1e-4);
  assert.equal(env3.ix.pushPhase, 'start');
  env3.step(1, { release: ['KeyE'] });
  const zr3 = c3.position.z;
  assert.equal(env3.ix.animState?.clip, 'xi-push-end', '重叠段松手播 push-end');
  env3.step(30);
  assert.equal(c3.position.z, zr3, '松手后物体不动');
});

test('017 推：pushStartRamp 起止 0 / 1、单调、moveAt = 0.5 ≤ 0.6（gameplay.interaction.pushStartMoveAt）', () => {
  assert.ok(gameplay.interaction.pushStartMoveAt <= 0.6);
  assert.equal(pushStartRamp(0, 0.5, 1.2), 0);
  assert.equal(pushStartRamp(0.5, 0.5, 1.2), 0);
  assert.equal(pushStartRamp(1.2, 0.5, 1.2), 1);
  assert.equal(pushStartRamp(2, 0.5, 1.2), 1);
  let prev = 0;
  for (let t = 0.5; t <= 1.2; t += 0.01) {
    const k = pushStartRamp(t, 0.5, 1.2);
    assert.ok(k >= prev - 1e-12 && k <= 1);
    prev = k;
  }
  assert.equal(pushStartRamp(0.3, 1.2, 1.2), 0, 'start ≤ moveAt：不加速段');
  assert.equal(pushStartRamp(1.3, 1.2, 1.2), 1);
});

// ---------------------------------------------------------------- 汇总

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
