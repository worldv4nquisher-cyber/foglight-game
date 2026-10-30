// 音频系统循环音校验（纯逻辑，假 AudioContext）：按名字启停、淡入淡出时长可配、同名重复 start 不叠加、
// 淡出中重开不复用旧实例、stopAllLoops（切场景）、suspend 时照常排程、sfx:loop / sfx:loopStop 事件桥接、Game 切场景调 stopAllLoops。
// 运行：npm run test:audio
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioSystem } from '@/systems/AudioSystem';
import { EventBus } from '@/core/EventBus';
import { bindSfxFallback } from '@/systems/tide/tideScene';
import { gameplay } from '@/config/gameplay';

class FakeParam {
  constructor(v = 1) {
    this.value = v;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v, t) {
    this.events.push(['ramp', v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push(['exp', v, t]);
  }
  cancelScheduledValues(t) {
    this.events.push(['cancel', t]);
  }
}
class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.out = [];
    this.disconnected = false;
  }
  connect(n) {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.started = null;
    this.stopped = null;
    this.loop = false;
    this.frequency = new FakeParam(440);
    this.playbackRate = new FakeParam(1);
    this.onended = null;
    ctx.sources.push(this);
  }
  start(t = 0) {
    this.started = t;
  }
  stop(t = 0) {
    if (this.stopped !== null) throw new Error('InvalidStateError');
    this.stopped = t;
  }
}
class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sources = [];
    this.destination = new FakeNode(this, 'dest');
  }
  createGain() {
    const g = new FakeNode(this, 'gain');
    g.gain = new FakeParam(1);
    return g;
  }
  createBufferSource() {
    return new FakeSource(this, 'buffer');
  }
  createOscillator() {
    return new FakeSource(this, 'osc');
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  /** 模拟时间流逝：到点的 stop 触发 onended */
  advance(dt) {
    this.currentTime += dt;
    for (const s of this.sources) if (s.stopped !== null && s.stopped <= this.currentTime + 1e-9 && s.onended && !s.ended) {
      s.ended = true;
      s.onended();
    }
  }
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}
const lastRamp = (p) => p.events.filter((e) => e[0] === 'ramp').at(-1);
const cfg = gameplay.audio;

test('startLoop：buffer 循环、默认淡入 loopFadeInSec、按名字可查', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  ctx.currentTime = 2;
  assert.equal(a.startLoop('hum', { buffer: { duration: 4 } }), true);
  const src = ctx.sources.at(-1);
  assert.equal(src.kind, 'buffer');
  assert.equal(src.loop, true);
  assert.equal(src.started, 2);
  const g = src.out[0];
  assert.deepEqual(g.gain.events[0], ['set', 0, 2]);
  assert.deepEqual(lastRamp(g.gain), ['ramp', 1, 2 + cfg.loopFadeInSec]);
  assert.ok(a.isLooping('hum'));
  assert.deepEqual(a.loopNames, ['hum']);
});

test('淡入 / 淡出时长可配；fadeIn 0 立即满音量', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.startLoop('x', { buffer: {}, fadeIn: 1.25, volume: 0.5 });
  const g = ctx.sources.at(-1).out[0];
  assert.deepEqual(lastRamp(g.gain), ['ramp', 0.5, 1.25]);
  ctx.advance(3);
  g.gain.value = 0.5;
  assert.equal(a.stopLoop('x', { fadeOut: 0.8 }), true);
  assert.deepEqual(lastRamp(g.gain), ['ramp', 0, 3.8]);
  assert.equal(ctx.sources.at(-1).stopped, 3.8);
  a.startLoop('y', { buffer: {}, fadeIn: 0 });
  const g2 = ctx.sources.at(-1).out[0];
  assert.equal(lastRamp(g2.gain), undefined);
  assert.deepEqual(g2.gain.events.at(-1), ['set', 1, 3]);
});

test('同名重复 start 不叠加（只建一个 source），不同名可并存', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  assert.equal(a.startLoop('hum', { buffer: {} }), true);
  assert.equal(a.startLoop('hum', { buffer: {} }), false);
  assert.equal(a.startLoop('hum', { buffer: {} }), false);
  assert.equal(ctx.sources.length, 1);
  assert.equal(a.startLoop('wind', { buffer: {} }), true);
  assert.equal(ctx.sources.length, 2);
});

test('stopLoop：默认淡出 loopFadeOutSec，从当前音量开始（淡入中途停不跳），到点 stop + 断开；没在播返回 false', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.startLoop('hum', { buffer: {} });
  const src = ctx.sources[0];
  const g = src.out[0];
  ctx.advance(0.2);
  g.gain.value = 0.4; // 淡入到一半
  assert.equal(a.stopLoop('hum'), true);
  assert.equal(a.isLooping('hum'), false);
  const ev = g.gain.events;
  assert.deepEqual(ev.at(-3), ['cancel', 0.2]);
  assert.deepEqual(ev.at(-2), ['set', 0.4, 0.2]);
  assert.ok(Math.abs(ev.at(-1)[2] - (0.2 + cfg.loopFadeOutSec)) < 1e-9 && ev.at(-1)[1] === 0);
  assert.ok(Math.abs(src.stopped - (0.2 + cfg.loopFadeOutSec)) < 1e-9);
  assert.equal(src.disconnected, false);
  ctx.advance(cfg.loopFadeOutSec);
  assert.equal(src.disconnected, true);
  assert.equal(a.stopLoop('hum'), false);
});

test('淡出中同名重开：新实例从 0 淡入（与旧实例交叉），不会叠成两个在播', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.startLoop('hum', { buffer: {} });
  a.stopLoop('hum');
  assert.equal(a.startLoop('hum', { buffer: {} }), true);
  assert.equal(a.startLoop('hum', { buffer: {} }), false);
  assert.equal(ctx.sources.length, 2);
  assert.notEqual(ctx.sources[0].stopped, null);
  assert.equal(ctx.sources[1].stopped, null);
  assert.deepEqual(a.loopNames, ['hum']);
});

test('缺 buffer：合成占位振荡器（fallback 频率 / 波形，音量 × loopFallbackVolume）', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.startLoop('hum', { fallback: { freq: 110, type: 'triangle' }, fadeIn: 0 });
  const src = ctx.sources[0];
  assert.equal(src.kind, 'osc');
  assert.equal(src.type, 'triangle');
  assert.equal(src.frequency.value, 110);
  assert.deepEqual(src.out[0].gain.events.at(-1), ['set', cfg.loopFallbackVolume, 0]);
});

test('暂停（suspend）时照常排程，不丢请求；context 关闭 / 不存在时不播', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.suspend();
  assert.equal(ctx.state, 'suspended');
  assert.equal(a.startLoop('hum', { buffer: {} }), true);
  assert.equal(a.stopLoop('hum'), true);
  ctx.state = 'closed';
  assert.equal(a.startLoop('hum', { buffer: {} }), false);
  const none = new AudioSystem(null);
  assert.equal(none.startLoop('hum', { buffer: {} }), false);
  assert.equal(none.stopLoop('hum'), false);
});

test('stopAllLoops（切场景）：全部停、默认立即；dispose 也停', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.startLoop('a', { buffer: {} });
  a.startLoop('b', { buffer: {} });
  ctx.advance(1);
  a.stopAllLoops();
  assert.deepEqual(a.loopNames, []);
  for (const s of ctx.sources) assert.equal(s.stopped, 1);
  a.startLoop('c', { buffer: {} });
  a.dispose();
  assert.equal(ctx.sources.at(-1).stopped, 1);
});

test('sfx:loop / sfx:loopStop 事件桥接（有资源用 buffer，没有用 FALLBACK 频率），取消订阅后不再响应', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const ev = new EventBus();
  const buf = { duration: 4 };
  const off = bindSfxFallback(ev, a, (id) => (id === 'has-file' ? buf : undefined));
  ev.emit('sfx:loop', { id: 'has-file', fadeIn: 0.7 });
  ev.emit('sfx:loop', { id: 'has-file' });
  assert.equal(ctx.sources.length, 1);
  assert.equal(ctx.sources[0].buffer, buf);
  assert.deepEqual(lastRamp(ctx.sources[0].out[0].gain), ['ramp', 1, 0.7]);
  ev.emit('sfx:loop', { id: 'sfx-ignite-ready-loop' });
  assert.equal(ctx.sources[1].kind, 'osc');
  assert.equal(ctx.sources[1].frequency.value, 110);
  ev.emit('sfx:loopStop', { id: 'sfx-ignite-ready-loop', fadeOut: 0.3 });
  assert.equal(a.isLooping('sfx-ignite-ready-loop'), false);
  assert.equal(ctx.sources[1].stopped, 0.3);
  off();
  ev.emit('sfx:loopStop', { id: 'has-file' });
  assert.equal(a.isLooping('has-file'), true);
});

test('Game：scene:change 时调 audio.stopAllLoops；暂停菜单走 audio.suspend（循环音同一 context，一起挂起）', () => {
  const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
  const i = src.indexOf("this.events.on('scene:change'");
  assert.ok(i > 0 && src.slice(i, i + 200).includes('this.audio.stopAllLoops()'), 'Game scene:change 里应 stopAllLoops');
  assert.ok(/pause\([^)]*\)[^{]*\{[\s\S]*?this\.audio\.suspend\(\)/.test(src), 'Game.pause 应 audio.suspend');
});

let failed = 0;
for (const [s, name, e] of results) {
  if (s === 'ok') console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}\n    ${e?.stack ?? e}`);
  }
}
if (failed) {
  console.log(`verify-audio：${failed} 项失败`);
  process.exit(1);
}
console.log(`verify-audio ✓ ${results.length} 项`);
