// 音频系统循环音校验（纯逻辑，假 AudioContext）：按名字启停、淡入淡出时长可配、同名重复 start 不叠加、
// 淡出中重开不复用旧实例、stopAllLoops（切场景）、suspend 时照常排程、sfx:loop / sfx:loopStop 事件桥接、Game 切场景调 stopAllLoops。
// 运行：npm run test:audio
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioSystem } from '@/systems/AudioSystem';
import { EventBus } from '@/core/EventBus';
import { bindSfxFallback } from '@/systems/tide/tideScene';
import { gameplay } from '@/config/gameplay';
import { SfxBank, SFX_ALIASES, sfxGain, STEP_SURFACES } from '@/systems/audio/sfxBank';
import { manifest } from '@/assets/manifest';
import { existsSync } from 'node:fs';
import { IgniterHum } from '@/levels/s3/igniterHum';
import { Footsteps, surfaceOf, STEP_M, SCENE_SURFACES } from '@/systems/audio/footsteps';
import { AMBIENCE, Ambience, AMBIENCE_XFADE_SEC } from '@/levels/ambience';
import { bindPuzzleSfx, DIAL_GROUPS, MIRROR_FINE_MIN_SEC } from '@/systems/audio/puzzleSfx';
import { BeamHum, PushLoop, BEAM_HUM_ID, LENS_ROTATE_ID, LENS_ROTATE_DELAY_SEC } from '@/systems/audio/loops';

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

test('sfx:play optional（032 补音，如钟锤 sfx-tide-bell-clapper）：有文件照播、可叠；文件缺失静默（不播合成占位）；不带 optional 仍走合成占位', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const ev = new EventBus();
  const buf = { duration: 1 };
  const off = bindSfxFallback(ev, a, (id) => (id === 'has-file' ? buf : undefined));
  ev.emit('sfx:play', { id: 'sfx-tide-bell-clapper', optional: true });
  assert.equal(ctx.sources.length, 0, '缺文件 + optional = 静默');
  ev.emit('sfx:play', { id: 'has-file', optional: true });
  ev.emit('sfx:play', { id: 'has-file', optional: true });
  assert.equal(ctx.sources.length, 2, '有文件照播，单发可叠');
  assert.equal(ctx.sources[0].buffer, buf);
  ev.emit('sfx:play', { id: 'sfx-tide-bell' });
  assert.equal(ctx.sources.length, 3, '不带 optional 缺文件仍播合成占位');
  assert.equal(ctx.sources[2].kind, 'osc');
  off();
});

test('032 登记：79 个 ogg 全在清单（sfx 59 / ambience 20，url = assets/art/audio/<类>/<名>.ogg，art 可缺省）；../art 在时文件都存在；分组 menu 只放 UI、common 不放场景专属', () => {
  const au = manifest.filter((e) => e.type === 'audio');
  assert.equal(au.length, 79);
  assert.equal(au.filter((e) => e.url.includes('/audio/sfx/')).length, 59);
  assert.equal(au.filter((e) => e.url.includes('/audio/ambience/')).length, 20);
  for (const e of au) {
    assert.equal(e.url, `assets/art/audio/${e.key.startsWith('amb-') ? 'ambience' : 'sfx'}/${e.key}.ogg`);
    assert.ok(e.optional && e.art && !e.pending, e.key);
    const f = new URL(`../../art/audio/${e.url.slice('assets/art/audio/'.length)}`, import.meta.url);
    if (existsSync(new URL('../../art/audio/', import.meta.url))) assert.ok(existsSync(f), '缺文件 ' + e.key);
  }
  assert.deepEqual(au.filter((e) => e.group === 'menu').map((e) => e.key).sort(), ['sfx-ui-back', 'sfx-ui-confirm', 'sfx-ui-journal']);
  for (const k of ['sfx-ignite-ready-loop', 'amb-room-clock', 'amb-waves-near', 'sfx-raft-lock']) assert.notEqual(au.find((e) => e.key === k).group, 'common', k);
});

test('032 SfxBank：旧 id 别名（README 对照表）→ 032 文件；a–d 变体随机、同一 id 不连续重复、只挑已加载的；gainDb → 线性增益；全缺返回 null', () => {
  const keys = new Set(manifest.map((e) => e.key));
  for (const [id, files] of Object.entries(SFX_ALIASES)) for (const f of files) assert.ok(keys.has(f), `${id} → ${f} 不在清单`);
  assert.deepEqual(SFX_ALIASES['sfx-tide-bell'], ['sfx-tide-bell-ring']);
  assert.deepEqual(SFX_ALIASES['sfx-lock-open'], ['sfx-light-lock-open']);
  assert.deepEqual(SFX_ALIASES['sfx-glass-resonance'], ['sfx-beam-connect']);
  assert.equal(SFX_ALIASES['sfx-bell-wind'].length, 3);
  for (const s of STEP_SURFACES) assert.equal(SFX_ALIASES[`sfx-step-${s}`].length, 4);
  const bufs = new Map([...keys].map((k) => [k, { k }]));
  let i = 0;
  const seq = [0, 0, 0.99, 0.99, 0.5, 0.5, 0.1, 0.1];
  const bank = new SfxBank((k) => bufs.get(k), () => seq[i++ % seq.length]);
  const picks = Array.from({ length: 8 }, () => bank.resolve('sfx-step-wood').key);
  for (let j = 1; j < picks.length; j++) assert.notEqual(picks[j], picks[j - 1], '连续重复 ' + picks);
  assert.equal(bank.resolve('sfx-tide-bell').key, 'sfx-tide-bell-ring');
  // 只加载了 b → 只能挑 b（单个也不算重复）
  const only = new SfxBank((k) => (k === 'sfx-paper-flip-b' ? {} : undefined));
  assert.equal(only.resolve('sfx-paper-flip').key, 'sfx-paper-flip-b');
  assert.equal(only.resolve('sfx-paper-flip').key, 'sfx-paper-flip-b');
  assert.equal(only.resolve('sfx-step-sand'), null);
  // 增益表：石面脚步 a −25.9 → 目标 −21：+4.9 dB；UI 返回 +1.2；长环境音不补
  assert.ok(Math.abs(sfxGain('sfx-step-stone-a') - 10 ** (4.9 / 20)) < 1e-9);
  assert.ok(Math.abs(sfxGain('sfx-ui-back') - 10 ** (1.2 / 20)) < 1e-9);
  assert.equal(sfxGain('amb-room-clock'), 1);
  assert.equal(sfxGain('sfx-ignite-ready-loop'), 1);
  for (const e of manifest) if (e.gainDb !== undefined) assert.ok(e.gainDb > 0 && e.gainDb <= 8, e.key);
});

test('032 桥接：别名 / 增益走 SfxBank；没文件又没合成占位的新 id（脚步、环境音、UI）静默，不播 440 Hz 兜底', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const ev = new EventBus();
  const ring = { duration: 10 };
  const step = { duration: 0.45 };
  const off = bindSfxFallback(ev, a, (k) => (k === 'sfx-tide-bell-ring' ? ring : k === 'sfx-step-stone-a' ? step : undefined));
  ev.emit('sfx:play', { id: 'sfx-tide-bell' });
  assert.equal(ctx.sources[0].buffer, ring, '旧 id sfx-tide-bell → sfx-tide-bell-ring');
  ev.emit('sfx:play', { id: 'sfx-step-stone' });
  assert.equal(ctx.sources[1].buffer, step);
  assert.ok(Math.abs(ctx.sources[1].out[0].gain.value - 10 ** (4.9 / 20)) < 1e-9, '脚步补增益');
  ev.emit('sfx:play', { id: 'sfx-step-sand' });
  ev.emit('sfx:play', { id: 'sfx-ui-confirm' });
  ev.emit('sfx:loop', { id: 'amb-rain-light' });
  assert.equal(ctx.sources.length, 2, '新 id 缺文件静默');
  assert.equal(a.isLooping('amb-rain-light'), false);
  off();
});

test('032 循环：BeamHum 连通起播 sfx-beam-hum-loop、断开 0.3 s 宽限内不停、超过淡出、不重复起；PushLoop 推动中循环 sfx-raft-push-loop、停手 0.25 s / 推到底淡出、别的推动件不响', () => {
  const ev = new EventBus();
  const log = [];
  ev.on('sfx:loop', ({ id }) => log.push(['loop', id]));
  ev.on('sfx:loopStop', ({ id }) => log.push(['stop', id]));
  let c = false;
  const h = new BeamHum(ev, () => c);
  h.update(0.1);
  assert.equal(log.length, 0);
  c = true;
  h.update(0.1);
  h.update(0.1);
  assert.deepEqual(log, [['loop', BEAM_HUM_ID]]);
  c = false;
  for (let k = 0; k < 5; k++) h.update(0.05);
  assert.equal(log.length, 1, '0.25 s 断光在宽限内');
  c = true;
  h.update(0.05);
  c = false;
  for (let k = 0; k < 7; k++) h.update(0.05);
  assert.deepEqual(log.at(-1), ['stop', BEAM_HUM_ID]);
  assert.equal(h.starts, 1);
  log.length = 0;
  const p = new PushLoop(ev);
  ev.emit('interact:pushMoved', { id: 'raft-s1', t: 0.1 });
  ev.emit('interact:pushMoved', { id: 'raft-s1', t: 0.2 });
  ev.emit('interact:pushMoved', { id: 'crate', t: 0.2 });
  assert.deepEqual(log, [['loop', 'sfx-raft-push-loop']]);
  p.update(0.2);
  ev.emit('interact:pushMoved', { id: 'raft-s1', t: 0.3 });
  p.update(0.2);
  assert.equal(log.length, 1, '一直在推不停');
  p.update(0.1);
  assert.deepEqual(log.at(-1), ['stop', 'sfx-raft-push-loop']);
  ev.emit('interact:pushMoved', { id: 'raft-s1', t: 0.9 });
  ev.emit('interact:pushEnd', { id: 'raft-s1' });
  assert.deepEqual(log.slice(-2), [['loop', 'sfx-raft-push-loop'], ['stop', 'sfx-raft-push-loop']]);
  p.dispose();
  assert.equal(LENS_ROTATE_ID, 'sfx-lens-rotate-loop');
  assert.equal(LENS_ROTATE_DELAY_SEC, 1.5);
  // 场景接线（源码）：S2 光感锁 / S3 导光镜连通驱动 BeamHum；S3 点燃后 after(1.5 s) 起透镜循环；LevelScene 每步更新 PushLoop
  const s2 = readFileSync(new URL('../src/levels/s2/puzzles.ts', import.meta.url), 'utf8');
  const s3 = readFileSync(new URL('../src/levels/s3/puzzles.ts', import.meta.url), 'utf8');
  const lv = readFileSync(new URL('../src/scenes/LevelScene.ts', import.meta.url), 'utf8');
  assert.ok(/new BeamHum\(events, \(\) => tracer\.paths\.some\(\(q\) => q\.emitter\.lit && q\.receiver === beam\.lock\)\)/.test(s2));
  assert.ok(/new BeamHum\(events, \(\) => !state\.ignited && traceReached\(\) >= 1\)/.test(s3));
  assert.ok(/after\(LENS_ROTATE_DELAY_SEC, \(\) => events\.emit\('sfx:loop', \{ id: LENS_ROTATE_ID \}\)\)/.test(s3));
  assert.ok(lv.includes('this.pushLoop?.update(dt)'));
});

test('032 可点灯嗡鸣：有 sfx-ignite-ready-loop 文件 → 整文件 buffer loop=true（不再 110 Hz 占位），淡入 igniterHumFadeInSec、淡出 0.3 s', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const ev = new EventBus();
  const buf = { duration: 8 };
  const off = bindSfxFallback(ev, a, (k) => (k === 'sfx-ignite-ready-loop' ? buf : undefined));
  const rx = { id: 'igniter', state: 'ready' };
  const hum = new IgniterHum(ev, rx, () => false);
  const unb = hum.bind();
  ev.emit('receiver:ready', { id: 'igniter', emitter: 'sky' });
  const src = ctx.sources[0];
  assert.equal(src.kind, 'buffer');
  assert.equal(src.buffer, buf);
  assert.equal(src.loop, true);
  assert.deepEqual(lastRamp(src.out[0].gain), ['ramp', 1, gameplay.beam.igniterHumFadeInSec]);
  ev.emit('lighthouse:ignited');
  assert.equal(src.stopped, gameplay.beam.igniterHumFadeOutSec);
  unb();
  off();
});

test('032 谜题件：拨盘 / 镜子 / 微调限频 60 ms / 提灯拿放 / 木筏浮起（仅搁浅→浮起）与落位 / 涨退潮 / 落水；地窖门、拉杆 f0 在场景脚本；每个 id 都有登记的文件', () => {
  const ev = new EventBus();
  const got = [];
  ev.on('sfx:play', ({ id }) => got.push(id));
  let t = 0;
  const off = bindPuzzleSfx(ev, () => t);
  const rot = (group, fine = false) => ev.emit('puzzle:partRotated', { group, part: 'x', axis: 0, angle: 0, angles: [0], fine });
  rot('dial-gate-s2');
  rot('mirrors-s2');
  rot('mirrors-s2', true);
  t += 0.03;
  rot('mirrors-s2', true);
  t += MIRROR_FINE_MIN_SEC;
  rot('mirrors-s2', true);
  assert.deepEqual(got.splice(0), ['sfx-dial-click', 'sfx-mirror-click', 'sfx-mirror-click-fine', 'sfx-mirror-click-fine']);
  ev.emit('item:pickup', { item: 'lantern', from: null });
  ev.emit('item:place', { item: 'lantern', socket: 'desk' });
  ev.emit('item:pickup', { item: 'key', from: null });
  assert.deepEqual(got.splice(0), ['sfx-lantern-pickup', 'sfx-lantern-place']);
  ev.emit('float:state', { id: 'raft-s1', state: 'floating' });
  ev.emit('float:state', { id: 'raft-s1', state: 'drifting' });
  ev.emit('float:state', { id: 'raft-s1', state: 'floating' });
  ev.emit('interact:pushEnd', { id: 'raft-s1' });
  ev.emit('interact:pushEnd', { id: 'crate' });
  assert.deepEqual(got.splice(0), ['sfx-raft-float', 'sfx-raft-lock']);
  ev.emit('tide:changing', { zone: 'z', state: 'high', from: 'low' });
  ev.emit('tide:changing', { zone: 'z', state: 'low', from: 'high' });
  ev.emit('tide:recall', { zone: 'z' });
  assert.deepEqual(got.splice(0), ['sfx-tide-rise', 'sfx-tide-fall', 'sfx-splash-cold']);
  off();
  rot('dial-gate-s2');
  assert.equal(got.length, 0, '解绑后不再响');
  const keys = new Set(manifest.filter((e) => e.type === 'audio').map((e) => e.key));
  for (const id of ['sfx-dial-click', 'sfx-mirror-click', 'sfx-mirror-click-fine', 'sfx-lantern-pickup', 'sfx-lantern-place', 'sfx-raft-float', 'sfx-raft-lock', 'sfx-tide-rise', 'sfx-tide-fall', 'sfx-splash-cold', 'sfx-cellar-door-open', 'sfx-ignite-lever']) assert.ok(keys.has(id), id);
  const s2 = readFileSync(new URL('../src/levels/s2/puzzles.ts', import.meta.url), 'utf8');
  const s3 = readFileSync(new URL('../src/levels/s3/puzzles.ts', import.meta.url), 'utf8');
  assert.ok(s2.includes(`dialGate: '${[...DIAL_GROUPS][0]}'`), 'DIAL_GROUPS 与 S2_IDS.dialGate 一致');
  assert.ok(/doorT = 0;\n\s*events\.emit\('sfx:play', \{ id: 'sfx-cellar-door-open' \}\)/.test(s2), '地窖门开始转同帧');
  assert.ok(/sfx\('sfx-ignite-lever'\);[^\n]*\n\s*void actions\.play\(/.test(s3), '拉杆音与动画第 0 帧同播');
  assert.ok(readFileSync(new URL('../src/scenes/LevelScene.ts', import.meta.url), 'utf8').includes('bindPuzzleSfx(events)'));
});

test('032 脚步：着地按距离每半个动画周期一步（走 0.64 m / 小跑 0.96 m，起步半步就响）；离地 / busy / 停下不响；材质按碰撞体名 / 室内 / 场景默认', () => {
  assert.equal(STEP_M.walk, 0.64);
  assert.equal(STEP_M.jog, 0.96);
  const ev = new EventBus();
  const got = [];
  ev.on('sfx:play', ({ id }) => got.push(id));
  const f = new Footsteps(ev, 's1');
  const walk = (m, o = {}) => { for (let d = 0; d < m - 1e-9; d += 0.04) f.update({ dist: 0.04, onGround: true, running: false, busy: false, ground: 's1-pier-deck-collider', indoor: false, ...o }); };
  walk(0.32);
  assert.deepEqual(got, ['sfx-step-wood'], '起步半步就响');
  walk(0.64 * 3);
  assert.equal(got.length, 4);
  walk(1.0, { onGround: false });
  walk(1.0, { busy: true });
  assert.equal(got.length, 4, '空中 / 动作中不走脚步');
  got.length = 0;
  walk(0.96 * 2 + 0.48, { running: true, ground: 'ground-collider' });
  assert.deepEqual(got, ['sfx-step-sand', 'sfx-step-sand', 'sfx-step-sand'], 'S1 默认沙地，小跑 0.96 m 一步');
  const s2 = SCENE_SURFACES.s2;
  const s3 = SCENE_SURFACES.s3;
  assert.equal(surfaceOf('room-floor-collider', true, s2), 'indoor');
  assert.equal(surfaceOf('s2-bed-collider', true, s2), 'wood');
  assert.equal(surfaceOf('s2-west-slope-collider', false, s2), 'stone');
  assert.equal(surfaceOf('spiral-column-collider', true, s3), 'stone');
  assert.equal(surfaceOf('tide-sandbar-collider', false, SCENE_SURFACES.s1), 'wet');
  assert.equal(surfaceOf('tide-reef-collider', false, SCENE_SURFACES.s1), 'stone');
  assert.equal(surfaceOf('x-surface-wet-collider', true, s2), 'wet', '显式 -surface- 优先');
  assert.equal(surfaceOf(null, false, s3), 'stone');
});

test('032 环境音：进场按区域起循环（默认淡入），进出室内 1 s 交叉淡化；S2 西窗 < 2 m 叠雨打玻璃，S3 塔底叠积水；单发按间隔随机、室内不响雾号 / 海鸥；全部 id 已登记、细雨进 common', () => {
  const ev = new EventBus();
  const log = [];
  ev.on('sfx:loop', (e) => log.push(['loop', e.id, e.fadeIn]));
  ev.on('sfx:loopStop', (e) => log.push(['stop', e.id, e.fadeOut]));
  ev.on('sfx:play', (e) => log.push(['play', e.id]));
  const a = new Ambience(ev, AMBIENCE.s2, () => 0);
  const out = { indoor: false, pos: { x: 8, y: 0, z: 5 } };
  a.update(0.1, out);
  assert.deepEqual(log.splice(0), [['loop', 'amb-rain-light', undefined], ['loop', 'amb-eaves-drip', undefined], ['loop', 'amb-waves-far', undefined], ['loop', 'amb-wind-soft', undefined]]);
  a.update(0.1, { indoor: true, pos: { x: -3, y: 0, z: 1 } });
  const x = log.splice(0);
  assert.equal(x.filter((e) => e[0] === 'stop').length, 4);
  assert.ok(x.every((e) => e[2] === AMBIENCE_XFADE_SEC));
  assert.deepEqual(x.filter((e) => e[0] === 'loop').map((e) => e[1]), ['amb-rain-on-roof', 'amb-room-clock']);
  a.update(0.1, { indoor: true, pos: { x: 0.95, y: 3.05, z: 1.0 } });
  assert.deepEqual(log.splice(0), [['loop', 'amb-rain-on-glass', 1]]);
  // 单发：rng 0 → 间隔取 min（雾号 40 s、海鸥 60 s）；室内到点不响，出门才响
  for (let t = 0; t < 45; t += 0.5) a.update(0.5, { indoor: true, pos: { x: -3, y: 0, z: 1 } });
  assert.ok(!log.some((e) => e[0] === 'play'), '室内不响雾号');
  log.length = 0;
  a.update(0.5, out);
  assert.ok(log.some((e) => e[0] === 'play' && e[1] === 'amb-foghorn-far'));
  const b = new Ambience(ev, AMBIENCE.s3, () => 0.5);
  log.length = 0;
  b.update(0.1, { indoor: true, pos: { x: 0, y: -100, z: 0 } });
  assert.ok(log.some((e) => e[1] === 'amb-water-in-tower'), 'S3 塔底积水');
  b.stop(0);
  assert.equal(b.playing.size, 0);
  const keys = new Set(manifest.filter((e) => e.type === 'audio').map((e) => e.key));
  const ids = new Set();
  for (const spec of Object.values(AMBIENCE)) {
    for (const c of [{ indoor: false, pos: { x: 0, y: 0, z: 0 } }, { indoor: true, pos: { x: 0.95, y: 3.05, z: 1 } }, { indoor: true, pos: { x: 0, y: -100, z: 0 } }]) for (const id of spec.loops(c)) ids.add(id);
    for (const o of spec.oneShots) ids.add(o.id);
  }
  for (const id of ids) assert.ok(keys.has(id) || SFX_ALIASES[id]?.every((k) => keys.has(k)), id);
  assert.equal(manifest.find((e) => e.key === 'amb-rain-light').group, 'common', 'S1 / S2 都用细雨');
  const lv = readFileSync(new URL('../src/scenes/LevelScene.ts', import.meta.url), 'utf8');
  assert.ok(lv.includes('this.footsteps?.update(') && lv.includes('this.ambience?.update(dt'));
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
