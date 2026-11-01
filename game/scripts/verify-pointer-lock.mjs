// BUG-038 指针锁定被拒 → 拖拽回退（KeyboardMouseInput，桩 DOM，无浏览器）。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-pointer-lock.mjs
import assert from 'node:assert/strict';

// ---- 最小 DOM 桩（device.ts / fullscreen.ts 在 import 时就读 window / document / navigator，必须先装好再动态 import）
class FakeNode extends EventTarget {
  constructor(parent = null) {
    super();
    this.parentElement = parent;
  }
  contains(n) {
    for (let c = n; c; c = c.parentElement) if (c === this) return true;
    return false;
  }
  closest() {
    return null;
  }
}
globalThis.Node = FakeNode;
globalThis.Element = FakeNode;
globalThis.HTMLInputElement = class extends FakeNode {};
globalThis.HTMLTextAreaElement = class extends FakeNode {};
globalThis.window = new EventTarget();
const doc = new EventTarget();
doc.pointerLockElement = null;
doc.fullscreenElement = null;
doc.documentElement = new FakeNode();
doc.exitPointerLock = () => {
  doc.pointerLockElement = null;
  doc.dispatchEvent(new Event('pointerlockchange'));
};
globalThis.document = doc;

let now = 10_000;
Object.defineProperty(performance, 'now', { value: () => now, configurable: true, writable: true });

const { KeyboardMouseInput } = await import('@/systems/input/KeyboardMouseInput');
const { device } = await import('@/platform/device');
const { gameConfig } = await import('@/config/gameConfig');
assert.ok(device.supportsPointerLock && !device.isTouch, '桩环境应判为支持指针锁定的桌面');

const flush = () => new Promise((r) => setTimeout(r, 0));
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}

/** mode: 'reject' | 'throw' | 'error-event' | 'grant' | 'pending' */
function setup(mode, context = 'explore') {
  now += 10_000;
  doc.pointerLockElement = null;
  const host = new FakeNode();
  const canvas = new FakeNode(host);
  const calls = { lock: 0, mode };
  canvas.requestPointerLock = () => {
    calls.lock++;
    switch (calls.mode) {
      case 'reject':
        return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      case 'throw':
        throw new DOMException('no permission', 'SecurityError');
      case 'error-event':
        queueMicrotask(() => doc.dispatchEvent(new Event('pointerlockerror')));
        return undefined;
      case 'grant':
        return Promise.resolve().then(() => {
          doc.pointerLockElement = canvas;
          doc.dispatchEvent(new Event('pointerlockchange'));
        });
      default:
        return new Promise(() => undefined);
    }
  };
  canvas.addEventListener = () => undefined;
  const look = [];
  const raw = [];
  const sink = {
    enabled: true,
    cursorMode: 'locked',
    context,
    setRaw: (_s, code, down) => raw.push([code, down]),
    setAxis() {},
    setButton() {},
    addLook: (dx, dy) => look.push([dx, dy]),
    addWheel() {},
  };
  const km = new KeyboardMouseInput(canvas, sink);
  const ev = (button, extra = {}) => ({ button, pointerType: 'mouse', target: canvas, movementX: 0, movementY: 0, ...extra });
  const down = (b = 0) => km.onPointerDown(ev(b));
  const up = (b = 0) => km.onPointerUp(ev(b));
  const move = (dx, dy = 0) => km.onPointerMove(ev(0, { movementX: dx, movementY: dy }));
  return { km, canvas, sink, calls, look, raw, down, up, move };
}
const s = gameConfig.camera.mouseSensitivity;

for (const mode of ['reject', 'throw', 'error-event']) {
  await test(`锁定被拒（${mode}）→ 拖拽回退：被拒那下按住就能拖，之后左键拖拽转视角`, async () => {
    const e = setup(mode);
    e.down(0);
    await flush();
    assert.equal(e.calls.lock, 1);
    assert.equal(e.km.dragFallback, true, '被拒后进入拖拽回退');
    e.move(40, -10);
    assert.deepEqual(e.look, [[40 * s, -10 * s]], '发起锁定的那下左键还按着，直接开始拖拽');
    e.up(0);
    e.move(30);
    assert.equal(e.look.length, 1, '松开后移动不转视角');
    e.down(0);
    e.move(-25, 5);
    assert.deepEqual(e.look[1], [-25 * s, 5 * s], '再次按住拖拽转视角');
    assert.equal(e.calls.lock, 1, 'LOCK_RETRY_MS 内不重复请求锁定');
    assert.ok(
      e.raw.some(([c, d]) => c === 'Mouse0' && d),
      '拖拽回退里点击照常当游戏输入（不再被锁定点击吞掉）',
    );
    e.km.dispose();
  });
}

await test('机关上下文（转镜）：被拒后同样能拖拽，look 增量照常送达', async () => {
  const e = setup('reject', 'puzzle');
  e.down(0);
  await flush();
  e.move(32);
  e.move(32);
  assert.equal(e.look.length, 2);
  assert.ok(Math.abs(e.look.reduce((a, [dx]) => a + dx, 0) - 64 * s) < 1e-12);
  e.km.dispose();
});

await test('拖拽回退中隔 LOCK_RETRY_MS 再试锁定；锁上后退出回退、恢复锁定点击', async () => {
  const e = setup('reject');
  e.down(0);
  await flush();
  e.up(0);
  assert.equal(e.km.dragFallback, true);
  e.calls.mode = 'grant';
  now += 2000;
  e.down(0);
  assert.equal(e.calls.lock, 2, '超过重试间隔，点击时顺带再试一次');
  await flush();
  assert.equal(e.km.isLocked, true);
  assert.equal(e.km.dragFallback, false, '锁上后退出拖拽回退');
  e.up(0);
  e.move(10);
  assert.equal(e.look.length, 1, '锁定状态下移动转视角（走 isLocked，不是拖拽）');
  e.km.dispose();
});

await test('点击锁定成功：这一下只锁定（不当游戏输入），不进拖拽', async () => {
  const e = setup('grant');
  e.down(0);
  await flush();
  assert.equal(e.km.isLocked, true);
  assert.equal(e.km.dragFallback, false);
  assert.ok(!e.raw.some(([c]) => c === 'Mouse0'), '锁定点击被吞掉（原行为）');
  e.km.dispose();
});

await test('锁定请求还在等结果时不进拖拽，点击仍只用于锁定', async () => {
  const e = setup('pending');
  e.down(0);
  await flush();
  assert.equal(e.km.dragFallback, false);
  e.move(20);
  assert.equal(e.look.length, 0);
  e.km.dispose();
});

await test('非点击发起的请求（切回 locked 上下文自动重锁）被拒不算被拒，不进拖拽回退', async () => {
  for (const mode of ['reject', 'throw', 'error-event']) {
    const e = setup(mode);
    e.km.onContextChange('explore');
    await flush();
    assert.equal(e.calls.lock, 1, mode);
    assert.equal(e.km.dragFallback, false, mode);
    e.km.dispose();
  }
});

await test('dispose 解绑 pointerlockerror', async () => {
  const e = setup('pending');
  e.down(0);
  e.km.dispose();
  doc.dispatchEvent(new Event('pointerlockerror'));
  assert.equal(e.km.dragFallback, false);
});

let failed = 0;
for (const [st, name, err] of results) {
  console.log(`${st === 'ok' ? '✓' : '✗'} ${name}`);
  if (err) {
    failed++;
    console.log('   ', err.message);
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed) process.exit(1);
