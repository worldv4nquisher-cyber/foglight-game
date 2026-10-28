// v0.1-001 输入层校验（纯逻辑，无 DOM）：上下文映射、按住跳过、暂停压 menu、灵敏度 / Y 反转、jump 已删除。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-input.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '@/core/EventBus';
import { InputManager } from '@/systems/input/InputManager';
import { CONTEXTS, GLOBAL_BINDINGS, actionsForCode } from '@/systems/input/actions';

let t = 0;
const clock = () => t;
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}
const fresh = () => {
  t = 0;
  const events = new EventBus();
  const input = new InputManager(events, clock);
  return { events, input };
};
const tap = (input, code) => {
  input.beginFrame();
  input.setRaw('kbm', code, true);
  input.setRaw('kbm', code, false);
};

test('源码里没有 jump action / player:jump 事件', () => {
  const hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|css|html)$/.test(f) && /['"]jump['"]|player:jump|jumpSpeed|touch-btn-jump/.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  assert.deepEqual(hits, []);
  assert.equal(actionsForCode('explore', 'Space').includes('jump'), false);
});

test('GDD §3 键位表：explore', () => {
  const m = (code) => actionsForCode('explore', code);
  assert.deepEqual(m('KeyE'), ['interact']);
  assert.deepEqual(m('ShiftLeft'), ['sprint']);
  assert.deepEqual(m('Mouse2'), ['observe']);
  assert.deepEqual(m('KeyH'), ['hint']);
  assert.deepEqual(m('KeyJ'), ['journal']);
  assert.deepEqual(m('Escape'), ['pause']);
  assert.deepEqual(m('Mouse0'), ['advance']);
  assert.deepEqual(m('Space'), ['advance']);
  assert.deepEqual(m('Tab'), []);
  assert.deepEqual(m('KeyQ'), []);
});

test('GDD §3 键位表：puzzle / reading / cutscene / menu', () => {
  assert.deepEqual(actionsForCode('puzzle', 'KeyE'), ['partNext']);
  assert.deepEqual(actionsForCode('puzzle', 'KeyQ'), ['partPrev']);
  assert.deepEqual(actionsForCode('puzzle', 'WheelDown'), ['partNext']);
  assert.deepEqual(actionsForCode('puzzle', 'WheelUp'), ['partPrev']);
  assert.deepEqual(actionsForCode('puzzle', 'Mouse2'), ['exitPuzzle']);
  assert.deepEqual(actionsForCode('puzzle', 'Tab'), ['exitPuzzle']);
  assert.deepEqual(actionsForCode('puzzle', 'ShiftLeft'), ['fineAdjust']);
  assert.deepEqual(actionsForCode('puzzle', 'KeyR'), ['resetPuzzle']);
  assert.deepEqual(actionsForCode('puzzle', 'KeyH'), ['hint']);
  assert.deepEqual(actionsForCode('reading', 'Mouse2'), ['exitPuzzle']);
  assert.deepEqual(actionsForCode('reading', 'Tab'), ['exitPuzzle']);
  assert.deepEqual(actionsForCode('reading', 'KeyE'), []);
  assert.deepEqual(actionsForCode('cutscene', 'Space').sort(), ['advance', 'skipHold']);
  assert.deepEqual(actionsForCode('menu', 'KeyE'), []);
  for (const ctx of Object.keys(CONTEXTS)) assert.deepEqual(actionsForCode(ctx, 'Escape'), ['pause'], ctx);
  assert.deepEqual(GLOBAL_BINDINGS.pause, ['Escape'], 'Esc 只做暂停');
  assert.equal(CONTEXTS.explore.cursor, 'locked');
  assert.equal(CONTEXTS.reading.cursor, 'free');
  assert.equal(CONTEXTS.menu.cursor, 'free');
});

test('机关上下文按 E 切部件不触发交互；右键 / Tab 退出回 explore', () => {
  const { input } = fresh();
  const pop = input.pushContext('puzzle');
  assert.equal(input.context, 'puzzle');
  tap(input, 'KeyE');
  assert.equal(input.consumePressed('interact'), false);
  assert.equal(input.consumePressed('partNext'), true);
  for (const code of ['Mouse2', 'Tab']) {
    tap(input, code);
    assert.equal(input.consumePressed('exitPuzzle'), true, code);
    assert.equal(input.consumePressed('observe'), false);
  }
  pop();
  assert.equal(input.context, 'explore');
  tap(input, 'KeyE');
  assert.equal(input.consumePressed('interact'), true);
  assert.equal(input.consumePressed('partNext'), false);
});

test('上下文切换清掉未消费的按下；pop 函数只弹自己那层', () => {
  const { input } = fresh();
  tap(input, 'KeyE');
  const popPuzzle = input.pushContext('puzzle');
  assert.equal(input.consumePressed('partNext'), false);
  const popReading = input.pushContext('reading');
  popPuzzle();
  assert.deepEqual(input.contextStack, ['explore', 'reading']);
  popReading();
  assert.deepEqual(input.contextStack, ['explore']);
  assert.equal(input.popContext(), false);
});

test('Shift：explore = sprint，puzzle = fineAdjust（同键按上下文区分）', () => {
  const { input } = fresh();
  input.setRaw('kbm', 'ShiftLeft', true);
  assert.equal(input.isDown('sprint'), true);
  assert.equal(input.isDown('fineAdjust'), false);
  input.pushContext('puzzle');
  assert.equal(input.isDown('sprint'), false);
  assert.equal(input.isDown('fineAdjust'), true);
});

test('Esc 暂停：game:pause 压入 menu（只剩全局键），resume 弹出', () => {
  const { input, events } = fresh();
  tap(input, 'Escape');
  assert.equal(input.consumePressed('pause'), true);
  events.emit('game:pause', { reason: 'user' });
  assert.equal(input.context, 'menu');
  assert.equal(input.cursorMode, 'free');
  input.setRaw('kbm', 'KeyW', true);
  assert.equal(input.getMove().y, 0, '暂停时不能移动');
  tap(input, 'KeyE');
  assert.equal(input.consumePressed('interact'), false);
  tap(input, 'Escape');
  assert.equal(input.consumePressed('pause'), true, '暂停中 Esc 仍可继续');
  events.emit('game:resume');
  assert.equal(input.context, 'explore');
  assert.equal(input.getMove().y, 1, '继续后按住的 W 生效');
});

test('机关里暂停再继续，回到 puzzle 而不是 explore', () => {
  const { input, events } = fresh();
  input.pushContext('puzzle');
  events.emit('game:pause', { reason: 'pointerlock' });
  events.emit('game:resume');
  assert.equal(input.context, 'puzzle');
});

test('按住 Space 1 秒跳过演出；短按只推进字幕', () => {
  const { input } = fresh();
  input.pushContext('cutscene');
  input.beginFrame();
  input.setRaw('kbm', 'Space', true);
  assert.equal(input.consumePressed('advance'), true);
  t = 0.5;
  input.beginFrame();
  assert.equal(input.consumePressed('skipHold'), false);
  assert.ok(Math.abs(input.getHoldProgress('skipHold') - 0.5) < 1e-9);
  t = 1.01;
  input.beginFrame();
  assert.equal(input.consumePressed('skipHold'), true);
  t = 2;
  input.beginFrame();
  assert.equal(input.consumePressed('skipHold'), false, '按住不放只触发一次');
  input.setRaw('kbm', 'Space', false);
  assert.equal(input.getHoldProgress('skipHold'), 0);
  input.setRaw('kbm', 'Space', true);
  t = 2.3;
  input.setRaw('kbm', 'Space', false);
  t = 3.5;
  input.beginFrame();
  assert.equal(input.consumePressed('skipHold'), false, '中途松开不跳过');
});

test('灵敏度 / Y 反转立即生效，观察模式 lookScale', () => {
  const { input } = fresh();
  input.addLook(0.01, 0.02);
  assert.deepEqual(input.getLookDelta(), { x: 0.01, y: 0.02 });
  input.endFrame();
  input.setLookSensitivity(2);
  input.setInvertY(true);
  input.addLook(0.01, 0.02);
  assert.deepEqual(input.getLookDelta(), { x: 0.02, y: -0.04 });
  input.endFrame();
  input.lookScale = 0.5;
  input.addLook(0.01, 0.02);
  assert.deepEqual(input.getLookDelta(), { x: 0.01, y: -0.02 });
  input.setLookSensitivity(99);
  assert.equal(input.lookSensitivity, 3);
  input.setLookSensitivity(0);
  assert.equal(input.lookSensitivity, 0.1);
});

test('滚轮：explore 调距离，puzzle 走 partPrev/partNext 不调距离', () => {
  const { input } = fresh();
  input.addWheel(200);
  assert.equal(input.getZoomDelta(), 2);
  input.endFrame();
  input.pushContext('puzzle');
  input.addWheel(200);
  assert.equal(input.getZoomDelta(), 0);
  tap(input, 'WheelUp');
  assert.equal(input.consumePressed('partPrev'), true);
});

test('斜向移动不加速；按下缓冲 0.15s 后过期', () => {
  const { input } = fresh();
  input.setRaw('kbm', 'KeyW', true);
  input.setRaw('kbm', 'KeyD', true);
  const m = input.getMove();
  assert.ok(Math.abs(Math.hypot(m.x, m.y) - 1) < 1e-9);
  tap(input, 'KeyE');
  t = 0.3;
  input.beginFrame();
  input.endFrame();
  assert.equal(input.consumePressed('interact'), false);
});

let failed = 0;
for (const [s, name, e] of results) {
  console.log(`${s === 'ok' ? '✓' : '✗'} ${name}`);
  if (e) {
    failed++;
    console.log(`   ${e.message}`);
  }
}
console.log(failed ? `\n输入层校验失败：${failed} 项` : `\n输入层校验通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
