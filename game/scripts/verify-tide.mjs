// v0.1-011 潮汐系统校验（纯逻辑，无 DOM）：6 s 平滑涨落、过渡中钟无效（提示变灰）、walkableWhen 碰撞切换、深水墙、
// 水深 > 0.3 m 送回、浮物在锚位原地浮起并稳定载人、不在锚位 2 s 漂回、搁浅才可推、uTideLevel 注入材质。
// 运行：npm run test:tide
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import { EventBus } from '@/core/EventBus';
import { InputManager } from '@/systems/input/InputManager';
import { CharacterBody, PhysicsSystem } from '@/systems/PhysicsSystem';
import { InteractionSystem } from '@/systems/interaction/InteractionSystem';
import { TideController, TideSet } from '@/systems/tide/TideController';
import { Floatable } from '@/systems/tide/Floatable';
import { buildTideTestArea } from '@/world/tideTestArea';
import { tideUniforms, withTideLevel, WET_LINE_GLSL } from '@/render/tideUniforms';
import { Water } from '@/world/Water';
import { t as text } from '@/content/text';

const DT = 1 / 60;
const cfg = gameplay.tide;
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}

/** 测试场地潮汐区 + 角色 + 交互系统（和 TestbedScene 同样的 fixedUpdate 顺序） */
function setup({ initial = 'high' } = {}) {
  let now = 0;
  const events = new EventBus();
  const input = new InputManager(events, () => now);
  const physics = new PhysicsSystem();
  const scene = new THREE.Scene();
  const body = new CharacterBody();
  physics.addBody(body);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const log = { prompt: [] };
  const hud = { setPrompt: (s, d) => log.prompt.push([s, !!d]), setMarkers() {}, setHoldProgress() {}, setPuzzleBar() {} };
  const actor = { body, facing: Math.PI, locked: false, busy: false, halt() {}, hand: new THREE.Object3D() };
  const ix = new InteractionSystem({
    events,
    input,
    physics,
    actor,
    camera,
    cameraFollow: { enterPuzzleView() {}, exitPuzzleView() {} },
    hud,
    presenters: { say() {}, read() {} },
    viewport: () => ({ width: 1600, height: 900 }),
  });
  const area = buildTideTestArea({ scene, physics, interaction: ix, events, waterColor: 0x1b252c, initial });
  const tides = new TideSet();
  tides.add(area.tide);
  const fired = [];
  for (const ev of ['tide:changing', 'tide:changed', 'tide:bell', 'float:state', 'sfx:play', 'interact:used']) events.on(ev, (p) => fired.push([ev, p]));
  const recalls = [];
  // 和场景一样把角色送回安全点（场景里是黑场 teleportTo）
  tides.onRecall = (z) => {
    recalls.push(z.id);
    body.teleport(z.safePoint.position.clone());
  };
  const env = { events, input, physics, scene, body, actor, ix, area, tides, fired, recalls, log };
  env.look = () => {
    const f = new THREE.Vector3(Math.sin(actor.facing), 0, Math.cos(actor.facing));
    camera.position.copy(body.position).addScaledVector(f, -3).setY(body.position.y + 1.8);
    camera.lookAt(body.position.clone().addScaledVector(f, 2).setY(body.position.y + 0.8));
    camera.updateMatrixWorld(true);
  };
  /** n 个物理步；move = 每步写入的水平速度；onStep 每步回调 */
  env.step = (n = 1, { move, press = [], release = [], onStep } = {}) => {
    for (let i = 0; i < n; i++) {
      input.beginFrame();
      if (i === 0) {
        for (const c of press) input.setRaw('kbm', c, true);
        for (const c of release) input.setRaw('kbm', c, false);
      }
      env.look();
      ix.fixedUpdate(DT);
      if (move) {
        body.velocity.x = move[0];
        body.velocity.z = move[1];
      }
      tides.fixedUpdate(DT);
      physics.step(DT);
      tides.checkRecall({ position: body.position, onGround: body.onGround, busy: false });
      ix.update(DT);
      area.update(DT);
      onStep?.(i);
      input.endFrame();
      now += DT;
    }
  };
  env.seconds = (s, o) => env.step(Math.round(s / DT), o);
  env.place = (v, facing = Math.PI) => {
    body.teleport(v.clone());
    actor.facing = facing;
    env.step(10);
  };
  return env;
}

const count = (env, ev) => env.fired.filter(([e]) => e === ev).length;

// ---------------------------------------------------------------- 涨落

test('涨落：退潮 1.6 → 0.0 用 6 s，smoothstep 平滑、单调；changing / changed 事件；过渡中 toggle 无效', () => {
  const tide = new TideController({ id: 't', initial: 'high' });
  const events = [];
  const bus = new EventBus();
  const t2 = new TideController({ id: 't2', initial: 'high', events: bus });
  bus.on('tide:changing', (p) => events.push(['changing', p]));
  bus.on('tide:changed', (p) => events.push(['changed', p]));
  assert.equal(tide.level, cfg.highLevel);
  assert.ok(tide.toggle(), '敲钟有效');
  assert.ok(t2.toggle());
  assert.equal(tide.state, 'low');
  assert.ok(tide.transitioning);
  let prev = tide.level;
  let maxStep = 0;
  let steps = 0;
  const samples = {};
  while (tide.transitioning && steps < 1000) {
    tide.fixedUpdate(DT);
    t2.fixedUpdate(DT);
    steps++;
    assert.ok(tide.level <= prev + 1e-9, '单调下降');
    maxStep = Math.max(maxStep, prev - tide.level);
    prev = tide.level;
    if (steps === 1) samples.first = 1.6 - tide.level;
    if (steps === 180) samples.mid = tide.level;
    if (steps === 200) assert.equal(tide.toggle(), false, '过渡中敲钟无效');
  }
  assert.ok(Math.abs(steps * DT - cfg.transitionSec) <= DT * 1.01, `过渡 ${(steps * DT).toFixed(3)} s`);
  assert.equal(tide.level, cfg.lowLevel);
  assert.ok(Math.abs(samples.mid - 0.8) < 0.01, `3 s 时在中点 ${samples.mid}`);
  assert.ok(samples.first < 0.0005, `起步平滑（第一步只降 ${samples.first.toFixed(5)} m）`);
  assert.ok(maxStep < (1.6 / 6) * 1.5 * DT + 1e-6, `最大速度 ≤ 1.5 × 平均（smoothstep），实际每步 ${maxStep.toFixed(4)}`);
  assert.deepEqual(events, [
    ['changing', { zone: 't2', state: 'low', from: 'high' }],
    ['changed', { zone: 't2', state: 'low' }],
  ]);
  assert.ok(tide.toggle(), '到位后可以再敲');
  assert.equal(tide.state, 'high');
  tide.set('low', { instant: true });
  assert.equal(tide.level, 0);
  assert.ok(!tide.transitioning);
});

test('测试场地：敲钟（interact:used）涨落、过渡中再敲无效 + 提示变灰 + E 不触发；sfx:play / tide:bell', () => {
  const env = setup();
  const { area } = env;
  // 站在钟前（交互点），面朝钟
  env.place(area.anchors.bellStand, Math.PI);
  env.step(3);
  assert.equal(env.ix.current?.id, 'tide-bell', '钟是当前候选 ' + env.ix.current?.id);
  assert.deepEqual(env.log.prompt.at(-1), [text('ui.prompt.ring'), false], '静止时提示「E 敲钟」正常颜色');
  env.step(1, { press: ['KeyE'] });
  env.step(1, { release: ['KeyE'] });
  env.seconds(1.0);
  assert.equal(area.bell.rings, 1, 'E 敲响一次');
  assert.ok(area.tide.transitioning && area.tide.state === 'low');
  assert.equal(count(env, 'sfx:play'), 1);
  assert.equal(count(env, 'tide:bell'), 1);
  assert.equal(env.ix.current?.id, 'tide-bell', '过渡中钟仍是候选');
  assert.deepEqual(env.log.prompt.at(-1), [text('ui.prompt.ring'), true], '过渡中提示变灰');
  const usedBefore = count(env, 'interact:used');
  env.step(1, { press: ['KeyE'] });
  env.step(1, { release: ['KeyE'] });
  env.seconds(0.5);
  assert.equal(count(env, 'interact:used'), usedBefore, '过渡中 E 不触发交互');
  assert.equal(area.bell.rings, 1);
  // 直接发 interact:used 也无效（双保险）
  env.events.emit('interact:used', { id: 'tide-bell', kind: 'use' });
  assert.equal(area.bell.rings, 1);
  env.seconds(cfg.transitionSec);
  assert.ok(!area.tide.transitioning);
  assert.equal(area.tide.level, 0);
  assert.equal(area.water.position.y, 0, '水面跟随潮位');
  assert.deepEqual(env.log.prompt.at(-1), [text('ui.prompt.ring'), false], '到位后提示恢复');
  assert.equal(count(env, 'tide:changed'), 1);
});

test('walkableWhen：礁石路入口空气墙涨潮挡住、退潮放行（中点切换）；岸台深水墙水深 > 0.5 m 时启用', () => {
  const env = setup();
  const { area } = env;
  assert.equal(area.reefGate.enabled, true, '涨潮：礁石路入口有墙');
  for (const w of area.deepWalls) assert.equal(w.enabled, true, '涨潮：沙洲水深 1.5 m，岸台边有深水墙');
  // 涨潮：从岸台往礁石路走，被挡在 z < 24
  env.place(new THREE.Vector3(0, 2.02, 22.5), 0);
  env.seconds(2.5, { move: [0, 1.6] });
  assert.ok(env.body.position.z < 24, `涨潮时过不去 z=${env.body.position.z.toFixed(2)}`);
  area.tide.toggle();
  let switchedAt = null;
  env.step(Math.round(cfg.transitionSec / DT) + 2, {
    onStep: (i) => {
      if (switchedAt === null && !area.reefGate.enabled) switchedAt = i * DT;
    },
  });
  assert.ok(switchedAt !== null && Math.abs(switchedAt - cfg.transitionSec / 2) < 0.1, `墙在 level 过中点时撤掉（${switchedAt}）`);
  // 深水墙：floorY 0.1，水深 > 0.5 → level > 0.6
  for (const w of area.deepWalls) assert.equal(w.enabled, false, '退潮：深水墙撤掉');
  area.tide.toggle();
  env.step(1);
  let deepOnAt = null;
  env.step(Math.round(cfg.transitionSec / DT) + 2, {
    onStep: () => {
      if (deepOnAt === null && area.deepWalls[0].enabled) deepOnAt = area.tide.level;
    },
  });
  assert.ok(deepOnAt !== null && deepOnAt > 0.6 && deepOnAt < 0.65, `深水墙在 level > 0.6 时启用（${deepOnAt}）`);
  // 退潮：走得下去
  area.tide.set('low', { instant: true });
  env.place(new THREE.Vector3(0, 2.02, 22.5), 0);
  env.seconds(4, { move: [0, 1.6] });
  assert.ok(env.body.position.z > 25, `退潮时能走上礁石路 z=${env.body.position.z.toFixed(2)}`);
  // 从 GLB extras 绑定
  const t = new TideController({ id: 'x', initial: 'high' });
  const c1 = env.physics.addBox(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)));
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  m.userData.walkableWhen = 'low';
  m.name = 'reef-collider';
  const c2 = env.physics.addMesh(m);
  assert.equal(t.bindFromColliders([c1, c2]), 1, '只绑定带 walkableWhen 的');
  assert.equal(c2.enabled, false, '普通碰撞体 walkableWhen=low：涨潮时不存在');
  t.set('low', { instant: true });
  assert.equal(c2.enabled, true);
});

test('送回：站在被淹没 > 0.3 m 的地面 → 送回安全点 + 「水太冷了。」；0.3 m 以内、空中、接管中不送', () => {
  const env = setup({ initial: 'low' });
  const { area, tides } = env;
  env.place(area.anchors.reef);
  area.tide.toggle(); // 涨潮
  let recallLevel = null;
  env.step(Math.round(cfg.transitionSec / DT), {
    onStep: () => {
      if (recallLevel === null && env.recalls.length) recallLevel = area.tide.level;
    },
  });
  assert.ok(recallLevel !== null, '涨潮淹没礁石路时送回');
  const depth = recallLevel - 0.1;
  assert.ok(depth > cfg.recallDepth && depth < cfg.recallDepth + 0.01, `水深刚过 0.3 m 时送回（${depth.toFixed(3)}）`);
  assert.equal(env.recalls.length, 1, '只触发一次');
  assert.ok(env.body.position.distanceTo(area.anchors.safe) < 0.05, '送回到岸台安全点');
  // 不同条件
  const t = area.tide;
  t.set('low', { instant: true });
  t.level = 0.38; // 水深 0.28
  const actor = (over) => ({ position: { x: 0, y: 0.1, z: 32 }, onGround: true, busy: false, ...over });
  env.recalls.length = 0;
  assert.equal(tides.checkRecall(actor()), null, '0.28 m 不送回');
  t.level = 0.45;
  assert.equal(tides.checkRecall(actor({ onGround: false })), null, '空中（跳下去还没落地）不判定');
  assert.equal(tides.checkRecall(actor({ busy: true })), null, '黑场送回 / 跨越中不判定');
  assert.equal(tides.checkRecall(actor({ position: { x: 0, y: 0.1, z: 10 } })), null, '分区外不判定');
  assert.equal(tides.checkRecall(actor())?.id, 'test-tide', '0.35 m 送回');
  // Promise 回调：送回进行中不重复触发
  let resolve;
  tides.onRecall = () => new Promise((r) => (resolve = r));
  const a = tides.checkRecall(actor());
  const b = tides.checkRecall(actor());
  assert.ok(a && b === null, '送回进行中不重复');
  resolve();
  assert.deepEqual(area.tide.safePoint.position.toArray(), [0, 2, 22]);
  assert.equal(text('ch1.common.tide_return'), '水太冷了。');
});

test('浮物：锚位里随潮浮起到 1.6 + offset，与岸台齐平；站在上面稳定被带着升降；浮起时不能推', () => {
  const env = setup({ initial: 'low' });
  const { area } = env;
  const raft = area.raft;
  // 推到锚位（直接设轨道终点，和 push 到终点一样）
  raft.object.position.copy(area.anchors.raftAnchor);
  area.raftPush.pushT = 1;
  area.raftPush.locked = true;
  env.step(2);
  assert.equal(raft.state, 'grounded');
  assert.ok(raft.inAnchor, '在锚位');
  // 人站上去（浮台顶面 0.6）
  env.place(new THREE.Vector3(5, 0.62, 24.65));
  assert.ok(env.body.onGround && Math.abs(env.body.position.y - 0.6) < 0.03, `站在浮台上 y=${env.body.position.y}`);
  area.tide.toggle();
  let maxGap = 0;
  let airborne = 0;
  let prevY = env.body.position.y;
  let maxDy = 0;
  env.step(Math.round((cfg.transitionSec + 1) / DT), {
    onStep: () => {
      const top = raft.object.position.y + 0.25;
      maxGap = Math.max(maxGap, Math.abs(env.body.position.y - top));
      if (!env.body.onGround) airborne++;
      maxDy = Math.max(maxDy, Math.abs(env.body.position.y - prevY));
      prevY = env.body.position.y;
    },
  });
  assert.equal(raft.state, 'floating');
  const y = raft.object.position.y;
  assert.ok(Math.abs(y - (1.6 + 0.15)) <= cfg.floatBobAmplitude + 1e-6, `浮到 1.6 + 0.15 ±2 cm（${y.toFixed(3)}）`);
  assert.ok(Math.abs(y + 0.25 - 2.0) <= 0.021, '顶面与岸台 2.0 m 齐平');
  assert.ok(raft.object.position.distanceTo(new THREE.Vector3(5, y, 24.65)) < 1e-6, '锚位里原地浮起，不漂');
  assert.ok(maxGap < 0.03, `角色始终贴着浮台顶面（最大偏差 ${maxGap.toFixed(4)} m）`);
  assert.equal(airborne, 0, '整个上升过程角色一直着地（不抖、不弹）');
  assert.ok(maxDy < 0.01, `每步竖直位移平滑（最大 ${maxDy.toFixed(4)} m）`);
  assert.equal(area.raftPush.enabled, false, '浮起时 push 交互禁用');
  assert.equal(env.ix.canInteract(area.raftPush), false, '浮起时没有推动提示');
  // 起伏关掉 → 完全静止
  raft.bob = false;
  env.step(5);
  const y0 = raft.object.position.y;
  env.seconds(1);
  assert.equal(raft.object.position.y, y0, 'bob=false 时完全静止');
  assert.equal(y0, 1.75);
});

test('浮物：不在锚位涨潮 → 2 s 漂回原位、推动进度归零；退潮搁浅后可再推', () => {
  const env = setup({ initial: 'low' });
  const { area } = env;
  const raft = area.raft;
  // 推了一半（不在锚位）
  area.raftPush.pushT = 0.5;
  raft.object.position.lerpVectors(area.anchors.raftHome, area.anchors.raftAnchor, 0.5);
  raft.object.updateMatrixWorld(true);
  env.step(2);
  assert.ok(!raft.inAnchor);
  assert.ok(area.tide.toggle());
  let leftAt = null;
  let backAt = null;
  env.step(Math.round(cfg.transitionSec / DT) + 2, {
    onStep: (i) => {
      if (leftAt === null && raft.state === 'drifting') leftAt = i;
      if (leftAt !== null && backAt === null && raft.state === 'floating') backAt = i;
    },
  });
  assert.ok(leftAt !== null, '离地后进入漂回');
  assert.ok(backAt !== null, '漂回结束');
  const sec = (backAt - leftAt) * DT;
  assert.ok(Math.abs(sec - cfg.floatDriftSec) < 0.05, `漂回 ${sec.toFixed(2)} s`);
  const p = raft.object.position;
  assert.ok(Math.hypot(p.x - 5, p.z - 28.5) < 1e-6, '回到原位');
  assert.equal(area.raftPush.pushT, 0, '推动进度归零');
  assert.ok(env.fired.some(([e, q]) => e === 'float:state' && q.state === 'drifting'));
  assert.ok(area.tide.toggle(), '涨潮到位后可以退潮');
  env.seconds(cfg.transitionSec + 0.2);
  assert.equal(raft.state, 'grounded');
  assert.ok(Math.abs(p.y - 0.35) < 1e-6, '搁浅回到 restY');
  assert.equal(area.raftPush.enabled, true, '搁浅后可推');
  // 推动（真实交互）：站在浮台南侧，按住 E
  env.place(area.anchors.raftStand, Math.PI);
  env.step(2);
  assert.equal(env.ix.current?.id, 'tide-raft', '浮台是候选 ' + env.ix.current?.id);
  assert.deepEqual(env.log.prompt.at(-1), [text('ui.prompt.push'), false]);
  env.step(1, { press: ['KeyE'] });
  env.seconds(8);
  env.step(1, { release: ['KeyE'] });
  assert.equal(area.raftPush.pushT, 1, '推到石槽');
  assert.ok(raft.inAnchor, '在锚位');
});

test('浮物单元：起伏 ±2 cm / 3 s，刚浮起时渐入；snap', () => {
  const obj = new THREE.Object3D();
  obj.position.set(0, 0.35, 0);
  const f = new Floatable({ id: 'f', object: obj, floatOffset: 0.15, anchors: [() => true] });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 400; i++) {
    f.fixedUpdate(DT, 1.6);
    lo = Math.min(lo, obj.position.y);
    hi = Math.max(hi, obj.position.y);
  }
  assert.ok(hi - lo <= 2 * cfg.floatBobAmplitude + 1e-6 && hi - lo > 0.03, `起伏幅度 ${(hi - lo).toFixed(3)}`);
  f.fixedUpdate(DT, 0.21); // 刚离地 1 cm
  assert.ok(Math.abs(obj.position.y - 0.36) < 0.003, '刚浮起时起伏很小');
  f.snap(0);
  assert.equal(obj.position.y, 0.35);
  assert.equal(f.state, 'grounded');
});

test('uTideLevel：TideSet 写全局 uniform；withTideLevel 注入材质着色器；Water.setLevel', () => {
  const set = new TideSet();
  const z = set.add(new TideController({ id: 'z', initial: 'high' }));
  assert.equal(tideUniforms.uTideLevel.value, 1.6);
  z.toggle();
  for (let i = 0; i < 400; i++) set.fixedUpdate(DT);
  assert.equal(tideUniforms.uTideLevel.value, 0);
  const mat = withTideLevel(new THREE.MeshStandardMaterial(), WET_LINE_GLSL);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  mat.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uTideLevel, tideUniforms.uTideLevel, '材质与全局共用同一个 uniform 对象');
  assert.match(shader.fragmentShader, /uniform float uTideLevel;/);
  assert.match(shader.fragmentShader, /#include <color_fragment>\s+float tideDepth/);
  assert.match(shader.vertexShader, /vTideWorldY = \(modelMatrix/);
  assert.ok(mat.customProgramCacheKey().startsWith('tide:'));
  const w = new Water(10, 4);
  w.setLevel(1.2);
  assert.equal(w.level, 1.2);
  assert.equal(w.position.y, 1.2);
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
