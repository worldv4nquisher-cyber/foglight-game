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
import { existsSync, statSync } from 'node:fs';
import { IgniterHum } from '@/levels/s3/igniterHum';
import { Footsteps, surfaceOf, STEP_M, SCENE_SURFACES } from '@/systems/audio/footsteps';
import { AMBIENCE, Ambience, AMBIENCE_XFADE_SEC } from '@/levels/ambience';
import { bindUiSfx, uiClickSfx } from '@/ui/uiSfx';
import { bindPuzzleSfx, DIAL_GROUPS, MIRROR_FINE_MIN_SEC } from '@/systems/audio/puzzleSfx';
import { BeamHum, PushLoop, BEAM_HUM_ID, LENS_ROTATE_ID, LENS_ROTATE_DELAY_SEC } from '@/systems/audio/loops';
import { BellWindTimer, BELL_WIND_INTERVAL } from '@/systems/audio/bellWind';
import { MUSIC_XFADE_SEC, MUSIC_BUS_DB, MUSIC_BUS_GAIN, MUSIC_FILE_LUFS, AMBIENCE_FILE_LUFS } from '@/systems/AudioSystem';
import { switchMusic, switchMusicLazy, switchLayeredMusicLazy, musicTrackGain } from '@/systems/audio/music';
import { s3UpperLayerGain, S3_MUSIC_BASE, S3_MUSIC_UPPER, S3_UPPER_Y0, S3_UPPER_Y1 } from '@/levels/s3/music';
import { S3, toWorld, toLocal } from '@/levels/s3/layout';
import { MUSIC_LAYER_LEAD_SEC, MUSIC_LAYER_RAMP_SEC } from '@/systems/AudioSystem';
import { MUSIC_FILE_LEVELS, MUSIC_MATCH_TOL_DB } from '@/systems/audio/musicLevels';
import { spawnSync } from 'node:child_process';
import { LazyAudioCache, LazyAudioTimeout, LAZY_AUDIO_TIMEOUT_MS } from '@/assets/lazyAudio';
import { sizeBucket } from './lib/size-groups.mjs';
import { LEVELS, MENU_MUSIC } from '@/scenes/levels';
import { EndingMusic, ENDING_MUSIC, ENDING_CUES, ENDING_SCENE_FADE_SEC, ENDING_SKIP_FADE_SEC, ENDING_CUTSCENE_ID } from '@/systems/audio/endingMusic';

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
  start(t = 0, offset = 0) {
    this.started = t;
    this.offset = offset;
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
    for (const s of this.sources) {
      // 1031：不循环的 buffer 自然放完也触发 onended（结尾曲）
      const natural = s.started !== null && !s.loop && s.buffer?.duration !== undefined && s.started + s.buffer.duration - (s.offset ?? 0) <= this.currentTime + 1e-9;
      if ((natural || (s.stopped !== null && s.stopped <= this.currentTime + 1e-9)) && s.onended && !s.ended) {
        s.ended = true;
        s.onended();
      }
    }
  }
}

const results = [];
const pending = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => results.push(['ok', name]), (e) => results.push(['FAIL', name, e])));
    else results.push(['ok', name]);
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
  // 033 配乐（/audio/music/）另有测试，这里只数 032 的音效 / 环境音
  const au = manifest.filter((e) => e.type === 'audio' && !e.url.includes('/audio/music/'));
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

test('制作人要求：钟风吹轻响间隔 6–14 s（按游戏时间模拟 fixedUpdate，与墙钟 / 帧率无关）', () => {
  assert.deepEqual([...BELL_WIND_INTERVAL], [6, 14]);
  const sim = (rng, dt, sec, inRange = () => true) => {
    const t = new BellWindTimer(rng);
    const at = [];
    const n = Math.round(sec / dt);
    for (let i = 1; i <= n; i++) if (t.update(dt, inRange(i * dt))) at.push(i * dt);
    return at;
  };
  const gaps = (at) => at.slice(1).map((x, i) => x - at[i]);
  // 端点：rng 0 → 6 s、rng → 1 → 14 s（量化到一个固定步长内）
  for (const [r, want] of [[0, 6], [0.999999, 14]]) {
    for (const dt of [1 / 60, 1 / 30, 0.1]) {
      const g = gaps(sim(() => r, dt, 120));
      assert.ok(g.length >= 7 && g.every((x) => Math.abs(x - want) <= dt + 1e-9), `rng ${r} dt ${dt.toFixed(3)} 间隔 ≈ ${want} s：${g.map((x) => x.toFixed(2))}`);
    }
  }
  // 随机：固定种子 LCG，1 h 游戏时间；全部落在 [6, 14]（+ 一步量化），两端都摸得到、均值 ≈ 10
  let seed = 12345;
  const lcg = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const dt = 1 / 60;
  const at = sim(lcg, dt, 3600);
  const g = gaps(at);
  assert.equal(at[0], dt, '一进听得到的距离先响一次');
  const min = Math.min(...g), max = Math.max(...g), mean = g.reduce((a, b) => a + b, 0) / g.length;
  assert.ok(g.every((x) => x >= 6 - 1e-9 && x <= 14 + dt + 1e-9), `间隔越界 ${min.toFixed(3)}…${max.toFixed(3)}`);
  assert.ok(min < 6.5 && max > 13.5 && Math.abs(mean - 10) < 0.6 && g.length > 300, `分布 ${g.length} 次 ${min.toFixed(2)}…${max.toFixed(2)} 均值 ${mean.toFixed(2)}`);
  // 帧率无关：同种子下 dt 1/60 与 0.1（高负载一帧只走几个固定步长也一样按游戏时间）次数相近
  seed = 12345;
  const atSlow = sim(lcg, 0.1, 3600);
  assert.ok(Math.abs(atSlow.length - at.length) <= 3, `dt 0.1 响 ${atSlow.length} 次 vs dt 1/60 ${at.length} 次`);
  // 走远：倒计时压到 ≤ 1 s，回来 1 s 内响
  const inR = (t) => t < 20 || t > 40;
  const ats = sim(() => 0.5, dt, 60, inR);
  assert.ok(ats.every((x) => x < 20 || x > 40), '走远时不响');
  const back = ats.find((x) => x > 40);
  assert.ok(back !== undefined && back - 40 <= 1 + dt, `回到 12 m 内 ${(back - 40).toFixed(2)} s 后响`);
  console.log(`  钟风吹轻响：1 h 游戏时间 ${at.length} 次，间隔 ${min.toFixed(2)}…${max.toFixed(2)} s、均值 ${mean.toFixed(2)} s；dt 0.1 时 ${atSlow.length} 次；走远回来 ${(back - 40).toFixed(2)} s 后响 ✓`);
});

test('032 SfxBank：旧 id 别名（README 对照表）→ 032 文件；a–d 变体随机、同一 id 不连续重复、只挑已加载的；gainDb → 线性增益；全缺返回 null', () => {
  const keys = new Set(manifest.map((e) => e.key));
  for (const [id, files] of Object.entries(SFX_ALIASES)) for (const f of files) assert.ok(keys.has(f), `${id} → ${f} 不在清单`);
  assert.deepEqual(SFX_ALIASES['sfx-tide-bell'], ['sfx-tide-bell-ring']);
  assert.deepEqual(SFX_ALIASES['sfx-lock-open'], ['sfx-light-lock-open']);
  assert.deepEqual(SFX_ALIASES['sfx-glass-resonance'], ['sfx-beam-connect']);
  assert.equal(SFX_ALIASES['sfx-bell-wind'].length, 3);
  // S1 钟风吹轻响：README 建议 6–14 s 一次（随机间隔）
  const s1src = readFileSync(new URL('../src/levels/s1/puzzles.ts', import.meta.url), 'utf8');
  assert.ok(s1src.includes('new BellWindTimer()') && s1src.includes('bellWind.update(dt, d < BELL_HEAR_DISTANCE)'), 'S1 钟风吹轻响用 BellWindTimer（fixedUpdate 游戏时间 dt）');
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
  // connectSfx：每次接通补一声单发（S2 光感锁 sfx-beam-connect），宽限内重连不重复
  const plays = [];
  const offPlay = ev.on('sfx:play', ({ id }) => plays.push(id));
  let c2 = false;
  const h2 = new BeamHum(ev, () => c2, 0.3, 'sfx-beam-connect');
  c2 = true;
  h2.update(0.1);
  c2 = false;
  h2.update(0.1);
  c2 = true;
  h2.update(0.1);
  assert.deepEqual(plays, ['sfx-beam-connect'], '宽限内重连不重复单发');
  c2 = false;
  for (let k = 0; k < 8; k++) h2.update(0.05);
  c2 = true;
  h2.update(0.1);
  assert.deepEqual(plays, ['sfx-beam-connect', 'sfx-beam-connect'], '断开超过宽限后再接通再响一声');
  assert.equal(plays.length, 2);
  h2.stop();
  offPlay();
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
  assert.ok(/new BeamHum\(events, \(\) => tracer\.paths\.some\(\(q\) => q\.emitter\.lit && q\.receiver === beam\.lock\), 0\.3, 'sfx-beam-connect'\)/.test(s2));
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

test('032 UI 音：按钮点击委托（确认 / 返回·取消 / 翻页箭头与日志条目不响）、Esc 返回、日志打开、阅读器展纸、翻页 a–c；直接 playBuffer 带增益、没文件不响、解绑移除监听；Reader.flip 发 reader:page', () => {
  const btn = (act, cls = '') => ({ dataset: act ? { act } : {}, classList: { contains: (c) => cls === c }, disabled: false, closest() { return this; } });
  assert.equal(uiClickSfx(btn('new')), 'sfx-ui-confirm');
  assert.equal(uiClickSfx(btn('back')), 'sfx-ui-back');
  assert.equal(uiClickSfx(btn('cancel')), 'sfx-ui-back');
  assert.equal(uiClickSfx(btn('next')), null);
  assert.equal(uiClickSfx(btn(undefined, 'journal-entry')), null);
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const ev = new EventBus();
  const listeners = [];
  const root = { addEventListener: (n, f, c) => listeners.push([n, f, c]), removeEventListener: (n, f) => listeners.splice(listeners.findIndex((l) => l[1] === f), 1) };
  const bufs = Object.fromEntries(['sfx-ui-confirm', 'sfx-ui-back', 'sfx-ui-journal', 'sfx-paper-open', 'sfx-paper-flip-a', 'sfx-paper-flip-b'].map((k) => [k, { duration: 0.3, k }]));
  const off = bindUiSfx(root, ev, a, (k) => bufs[k]);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][2], true, '捕获阶段');
  const click = (b) => listeners[0][1]({ target: { closest: () => b } });
  click(btn('settings'));
  click(btn('back'));
  click(btn('prev'));
  click({ ...btn('new'), disabled: true });
  ev.emit('ui:back');
  ev.emit('journal:open');
  ev.emit('reader:open', { docId: 'd', pages: 2 });
  ev.emit('reader:page', { docId: 'd', page: 1 });
  ev.emit('reader:page', { docId: 'd', page: 0 });
  const played = ctx.sources.map((x) => x.buffer?.k);
  assert.deepEqual(played.slice(0, 5), ['sfx-ui-confirm', 'sfx-ui-back', 'sfx-ui-back', 'sfx-ui-journal', 'sfx-paper-open']);
  assert.ok(played.slice(5).every((k) => /^sfx-paper-flip-[ab]$/.test(k)) && played[5] !== played[6], '翻页随机不连续重复');
  const g = ctx.sources[0].out[0].gain;
  assert.ok(Math.abs(g.value - sfxGain('sfx-ui-confirm')) < 1e-6, `带 manifest 增益 ${g.value}`);
  off();
  assert.equal(listeners.length, 0);
  ev.emit('ui:back');
  assert.equal(ctx.sources.length, 7, '解绑后不响');
  const rd = readFileSync(new URL('../src/ui/Reader.ts', import.meta.url), 'utf8');
  assert.ok(rd.includes("emit('reader:page', { docId: this._docId, page: p })"));
  assert.ok(readFileSync(new URL('../src/ui/UIManager.ts', import.meta.url), 'utf8').includes('bindUiSfx(root, game.events, game.audio'));
  for (const k of ['sfx-ui-confirm', 'sfx-ui-back', 'sfx-ui-journal']) assert.equal(manifest.find((e) => e.key === k).group, 'menu', k);
});

test('Game：scene:change 时调 audio.stopAllLoops；暂停菜单走 audio.suspend（循环音同一 context，一起挂起）', () => {
  const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
  const i = src.indexOf("this.events.on('scene:change'");
  assert.ok(i > 0 && src.slice(i, i + 200).includes('this.audio.stopAllLoops()'), 'Game scene:change 里应 stopAllLoops');
  assert.ok(/pause\([^)]*\)[^{]*\{[\s\S]*?this\.audio\.suspend\(\)/.test(src), 'Game.pause 应 audio.suspend');
});

// ---- 033 / 036 配乐
test('033 manifest：mus-menu 在 menu 组、mus-s1-ebb-shore 在 s1 组；没有任何 preview 路径；menu 组音频只有 mus-menu + UI 音效', () => {
  const m = manifest.find((e) => e.key === 'mus-menu');
  assert.ok(m, 'manifest 应有 mus-menu');
  assert.equal(m.url, 'assets/art/audio/music/mus-menu.ogg');
  assert.equal(m.group, 'menu');
  assert.equal(m.type, 'audio');
  assert.equal(MENU_MUSIC, 'mus-menu');
  const s1 = manifest.find((e) => e.key === 'mus-s1-ebb-shore');
  assert.equal(s1?.group, 's1');
  assert.equal(s1?.lazy, true, '033 改：S1 曲懒加载');
  assert.equal(LEVELS.s1.music, 'mus-s1-ebb-shore');
  for (const e of manifest) assert.ok(!/preview/i.test(e.url) && !/preview/i.test(e.key), `不能登记样张：${e.key} ${e.url}`);
  const menuAudio = manifest.filter((e) => e.group === 'menu' && e.type === 'audio').map((e) => e.key);
  assert.ok(menuAudio.every((k) => k === 'mus-menu' || k.startsWith('sfx-ui-')), `menu 组音频：${menuAudio}`);
  assert.equal(manifest.filter((e) => e.url.includes('/music/') && (e.group === 'common')).length, 0, '配乐不进 common');
  const f = new URL('../../art/audio/music/mus-menu.ogg', import.meta.url);
  if (existsSync(f)) assert.equal(readFileSync(f).length, 1779931, 'mus-menu.ogg 应为美术交付的 1,779,931 B');
});

test('036 音乐总线：比环境音低 12 dB（文件 −20 LUFS、环境音 −24 LUFS → 总线 −16 dB），乘设置音乐音量', () => {
  assert.equal(MUSIC_FILE_LUFS - (AMBIENCE_FILE_LUFS) + MUSIC_BUS_DB, -12);
  assert.ok(Math.abs(MUSIC_BUS_DB + 16) < 1e-9);
  assert.ok(Math.abs(20 * Math.log10(MUSIC_BUS_GAIN) - MUSIC_BUS_DB) < 1e-9);
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.playMusic({ duration: 106.67 }, { key: 'mus-menu' });
  const bus = ctx.sources[0].out[0].out[0]; // source → 曲目 gain → music 总线
  assert.ok(Math.abs(bus.gain.value - MUSIC_BUS_GAIN) < 1e-9, `总线 ${bus.gain.value}`);
  a.setVolumes({ master: 1, music: 0.5, sfx: 1 });
  assert.ok(Math.abs(bus.gain.value - MUSIC_BUS_GAIN * 0.5) < 1e-9);
});

test('033 playMusic：整文件 loop = true、不设循环点、第一首不淡入；同一首不重开', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  ctx.currentTime = 1;
  assert.equal(a.playMusic({ duration: 106.67 }, { key: 'mus-menu' }), true);
  const src = ctx.sources[0];
  assert.equal(src.loop, true);
  assert.equal(src.loopStart, undefined, '不设 loopStart');
  assert.equal(src.loopEnd, undefined, '不设 loopEnd');
  assert.equal(src.started, 1);
  const g = src.out[0].gain;
  assert.equal(g.value, 1);
  assert.equal(g.events.filter((e) => e[0] === 'ramp').length, 0, '不加淡入');
  assert.equal(a.musicKey, 'mus-menu');
  assert.equal(a.musicLoop, true);
  assert.equal(a.playMusic({ duration: 106.67 }, { key: 'mus-menu' }), false, '同一首不重开');
  assert.equal(ctx.sources.length, 1);
});

test('036 交叉淡化：菜单 → S1 时长 2 s，旧曲淡出到 0 后 stop、新曲 0 → 1；log 记录', () => {
  assert.equal(MUSIC_XFADE_SEC, 2);
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const bufs = { 'mus-menu': { duration: 106.67 }, 'mus-s1-ebb-shore': { duration: 150 } };
  assert.equal(switchMusic(a, (k) => bufs[k], MENU_MUSIC), 'play');
  ctx.currentTime = 30;
  assert.equal(switchMusic(a, (k) => bufs[k], LEVELS.s1.music), 'play');
  const [menu, s1] = ctx.sources;
  assert.equal(menu.stopped, 32, '菜单曲在 2 s 后停');
  assert.deepEqual(lastRamp(menu.out[0].gain), ['ramp', 0, 32]);
  assert.deepEqual(lastRamp(s1.out[0].gain), ['ramp', 1, 32]);
  assert.deepEqual(s1.out[0].gain.events[0], ['set', 0, 30]);
  assert.equal(s1.loop, true);
  assert.equal(a.musicKey, 'mus-s1-ebb-shore');
  const last = a.musicLog.at(-1);
  assert.deepEqual([last.op, last.key, last.from, last.fade], ['play', 'mus-s1-ebb-shore', 'mus-menu', 2]);
  ctx.advance(3);
  assert.equal(menu.disconnected, true, '淡出完断开');
  assert.equal(switchMusic(a, (k) => bufs[k], LEVELS.s1.music), 'same');
  // 没有场景曲（key = null，如章节结束页以外的无曲场景）：上一首 2 s 淡出
  assert.equal(switchMusic(a, (k) => bufs[k], null), 'stop');
  assert.equal(s1.stopped, 35);
  assert.equal(a.musicKey, null);
  // 资源缺失（?art=0）：不报错，返回 missing
  assert.equal(switchMusic(a, () => undefined, MENU_MUSIC), 'missing');
});

test('BUG-025 没有上一首时（结尾曲放完 / 跳过停掉 → 结束页 → 主菜单）菜单曲从 0 淡入 2 s，不满音量硬切入；boot 第一首照旧不淡入', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const bufs = { 'mus-menu': { duration: 106.67 }, 'mus-ending-ch1': { duration: 107 } };
  // 结尾曲（不循环）放完 → musicKey = null
  a.playMusic(bufs['mus-ending-ch1'], { key: 'mus-ending-ch1', loop: false });
  ctx.currentTime = 107;
  ctx.sources[0].onended?.();
  assert.equal(a.musicKey, null, '结尾曲放完没有当前曲');
  ctx.currentTime = 110;
  assert.equal(switchMusic(a, (k) => bufs[k], MENU_MUSIC), 'play');
  const g = ctx.sources[1].out[0].gain;
  assert.deepEqual(g.events[0], ['set', 0, 110], '从 0 起');
  assert.deepEqual(lastRamp(g), ['ramp', musicTrackGain('mus-menu'), 112], '2 s 淡到曲目增益');
  const last = a.musicLog.at(-1);
  assert.deepEqual([last.op, last.key, last.from, last.fade], ['play', 'mus-menu', null, 2], 'musicLog fade 2（原来 0）');
  // 跳过：结尾曲 stop 0.75 后同样淡入
  const b = new AudioSystem(new FakeContext());
  b.playMusic(bufs['mus-ending-ch1'], { key: 'mus-ending-ch1', loop: false });
  b.stopMusic(0.75);
  switchMusic(b, (k) => bufs[k], MENU_MUSIC);
  assert.equal(b.musicLog.at(-1).fade, 2);
});

test('033 自动播放限制：context 未解锁（suspended）时 playMusic 照常排程不抛错，第一次交互 resume', () => {
  const ctx = new FakeContext();
  ctx.state = 'suspended';
  const a = new AudioSystem(ctx);
  assert.doesNotThrow(() => a.playMusic({ duration: 106.67 }, { key: 'mus-menu' }));
  assert.equal(ctx.sources[0].started, 0);
  assert.equal(a.musicLog.at(-1).ctxState, 'suspended');
});

test('033 接入点：MenuScene 进 mus-menu、ChapterEndScene 淡出、LevelScene 按 LevelDef.music 切换', () => {
  const menu = readFileSync(new URL('../src/scenes/MenuScene.ts', import.meta.url), 'utf8');
  assert.ok(menu.includes('switchMusic(this.game.audio, (k) => this.game.assets.getAudio(k), MENU_MUSIC)'));
  assert.ok(menu.includes('switchMusic(this.game.audio, (k) => this.game.assets.getAudio(k), null)'));
  const lvl = readFileSync(new URL('../src/scenes/LevelScene.ts', import.meta.url), 'utf8');
  assert.ok(lvl.includes('switchMusic(audio, (k) => this.game.assets.getAudio(k), music)'), '非懒加载场景曲（及 null）照旧进场切换');
});

// ---- 033 改（制作人 c0d81c9 反馈 1）：S1 场景曲懒加载
test('033 改 manifest / 体积：mus-s1-ebb-shore lazy、不随 s1 组预下载；size 记「s1 进场后懒加载」；懒加载图片仍算进所在组', () => {
  const s1 = manifest.find((e) => e.key === 'mus-s1-ebb-shore');
  assert.deepEqual([s1.type, s1.group, s1.lazy, s1.optional], ['audio', 's1', true, true]);
  assert.deepEqual(sizeBucket(s1), { group: 's1', lazyAfterEntry: true });
  const menu = manifest.find((e) => e.key === 'mus-menu');
  assert.ok(!menu.lazy, '主菜单曲随 menu 组预加载');
  assert.equal(sizeBucket(menu).lazyAfterEntry, false);
  const lazyImg = manifest.find((e) => e.type === 'image' && e.lazy);
  assert.ok(lazyImg && !sizeBucket(lazyImg).lazyAfterEntry, '030 懒加载图片体积仍按组计');
  const loader = readFileSync(new URL('../src/assets/AssetLoader.ts', import.meta.url), 'utf8');
  assert.ok(/if \(e\.lazy\) return false;/.test(loader), '组加载跳过 lazy');
  assert.ok(/x\.type === 'audio' && x\.lazy/.test(loader), 'loadAudio 只认 lazy audio');
  const size = readFileSync(new URL('./check-size.mjs', import.meta.url), 'utf8');
  assert.ok(/sizeBucket\(e\)\.lazyAfterEntry/.test(size) && size.includes('进场后懒加载'));
});

// ---- 1031 配乐 2：S2 场景曲
test('1031 S2 场景曲：mus-s2-keeper-house 登记 s2 组 lazy、gainDb 0（−20 LUFS = 和 S1 一样走 −16 dB 音乐总线，比环境音低 12 dB）；LevelDef.s2.music 指向它；懒加载后和 S1 曲 2 s 交叉淡化、整文件 loop、不设循环点；失败不放不抛', async () => {
  const e = manifest.find((x) => x.key === 'mus-s2-keeper-house');
  assert.deepEqual([e.type, e.group, e.lazy, e.optional, e.art, e.url], ['audio', 's2', true, true, true, 'assets/art/audio/music/mus-s2-keeper-house.ogg']);
  assert.equal(e.gainDb ?? 0, 0);
  assert.equal(musicTrackGain('mus-s2-keeper-house'), 1);
  assert.equal(MUSIC_FILE_LUFS + MUSIC_BUS_DB, AMBIENCE_FILE_LUFS - 12, '−20 LUFS 曲过 −16 dB 音乐总线 = 环境音 −12 dB');
  assert.deepEqual(sizeBucket(e), { group: 's2', lazyAfterEntry: true });
  assert.equal(LEVELS.s2.music, 'mus-s2-keeper-house');
  const bufs = { 'mus-s1-ebb-shore': { duration: 150 }, 'mus-s2-keeper-house': { duration: 6664000 / 44100 } };
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  switchMusic(a, (k) => bufs[k], LEVELS.s1.music);
  ctx.currentTime = 40;
  let release;
  const r = switchMusicLazy(a, () => new Promise((res) => (release = res)), LEVELS.s2.music);
  assert.equal(a.musicKey, 'mus-s1-ebb-shore', '下载 / 解码期间 S1 曲继续');
  ctx.currentTime = 43;
  release(bufs['mus-s2-keeper-house']);
  assert.equal(await r, 'play');
  const [s1, s2] = ctx.sources;
  assert.equal(s2.loop, true);
  assert.equal(s2.loopStart, undefined);
  assert.equal(s2.loopEnd, undefined);
  assert.equal(s1.stopped, 45, 'S1 曲 2 s 后停');
  assert.deepEqual(lastRamp(s1.out[0].gain), ['ramp', 0, 45]);
  assert.deepEqual(s2.out[0].gain.events[0], ['set', 0, 43]);
  assert.deepEqual(lastRamp(s2.out[0].gain), ['ramp', 1, 45]);
  assert.deepEqual(((x) => [x.op, x.key, x.from, x.fade, x.loop])(a.musicLog.at(-1)), ['play', 'mus-s2-keeper-house', 'mus-s1-ebb-shore', 2, true]);
  // 失败：S1 曲 2 s 淡出，不放、不抛
  const ctx2 = new FakeContext();
  const b = new AudioSystem(ctx2);
  switchMusic(b, (k) => bufs[k], LEVELS.s1.music);
  assert.equal(await switchMusicLazy(b, async () => null, LEVELS.s2.music), 'missing');
  assert.equal(b.musicKey, null);
  assert.equal(ctx2.sources.length, 1);
});

// ---- 1031 配乐 2：结尾曲
test('1031 结尾曲 AudioSystem：loop = false 单次、offset 起播、fadeOutPrev 旧曲单独淡出新曲不淡入；放完自己清掉（log end）；过头的 offset 不起播', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.playMusic({ duration: 150 }, { key: 'mus-s3-lighthouse' });
  ctx.currentTime = 100;
  const end = { duration: 107 };
  assert.equal(a.playMusic(end, { key: ENDING_MUSIC, loop: false, fadeOutPrev: 2, fadeIn: 0 }), true);
  const [base, e] = ctx.sources;
  assert.equal(e.loop, false);
  assert.deepEqual([e.started, e.offset], [100, 0]);
  assert.deepEqual(e.out[0].gain.events, [['set', 1, 100]], '结尾曲不淡入');
  assert.deepEqual(lastRamp(base.out[0].gain), ['ramp', 0, 102]);
  assert.equal(base.stopped, 102);
  assert.deepEqual(((x) => [x.op, x.key, x.from, x.fade, x.fadeOut, x.loop])(a.musicLog.at(-1)), ['play', ENDING_MUSIC, 'mus-s3-lighthouse', 0, 2, false]);
  assert.equal(a.musicLoop, false);
  assert.equal(a.musicStartAt, 100);
  ctx.currentTime = 150;
  assert.ok(Math.abs(a.musicPosition - 50) < 1e-9);
  ctx.advance(57);
  assert.equal(a.musicKey, null, '放完清掉');
  assert.deepEqual(((x) => [x.op, x.from])(a.musicLog.at(-1)), ['end', ENDING_MUSIC]);
  // offset：从第 3 s 起播
  ctx.currentTime = 300;
  a.playMusic(end, { key: ENDING_MUSIC, loop: false, offset: 3, fadeIn: 0.5, fadeOutPrev: 2 });
  assert.deepEqual([ctx.sources.at(-1).started, ctx.sources.at(-1).offset, a.musicStartAt, a.musicLog.at(-1).offset], [300, 3, 297, 3]);
  a.stopMusic();
  assert.equal(a.playMusic(end, { key: ENDING_MUSIC, loop: false, offset: 107 }), false, '过头不起播');
  // loop 曲 offset 取模
  a.playMusic({ duration: 150 }, { key: 'x', offset: 160 });
  assert.equal(ctx.sources.at(-1).offset, 10);
});

test('1031 结尾曲 EndingMusic：manifest s3 lazy；预取后 lighthouse:ignited 同一音频时刻 start(0)、场景曲 2 s 淡出；跳过 0.75 s 淡出；晚到按点燃后秒数补位；缺失 / 过淡出点不放；结束页不掐结尾曲', async () => {
  const m = manifest.find((x) => x.key === ENDING_MUSIC);
  assert.deepEqual([m.type, m.group, m.lazy, m.optional, m.art, m.gainDb ?? 0], ['audio', 's3', true, true, true, 0]);
  assert.deepEqual(sizeBucket(m), { group: 's3', lazyAfterEntry: true });
  assert.equal(ENDING_SCENE_FADE_SEC, 2, 'README 没写场景曲淡出时长 → 2 s');
  assert.ok(ENDING_SKIP_FADE_SEC >= 0.5 && ENDING_SKIP_FADE_SEC <= 1);
  assert.deepEqual([ENDING_CUES.fog_open, ENDING_CUES.motif_resolve, ENDING_CUES.no_answer, ENDING_CUES.journal, ENDING_CUES.close_chord, ENDING_CUES.fade_out, ENDING_CUES.silence, ENDING_CUES.length], [14, 21.78, 50, 66, 88, 95, 106, 107]);
  const buf = { duration: 107 };
  const mk = () => {
    const ctx = new FakeContext();
    const a = new AudioSystem(ctx);
    const ev = new EventBus();
    a.playMusic({ duration: 150 }, { key: 'mus-s3-lighthouse' });
    return { ctx, a, ev };
  };
  // 1) 正常：预取 → 点燃同一帧起播
  {
    const { ctx, a, ev } = mk();
    const loads = [];
    const em = new EndingMusic(a, ev, async (k) => (loads.push(k), buf));
    await em.prefetch();
    assert.deepEqual(loads, [ENDING_MUSIC]);
    ctx.currentTime = 812.345;
    let atEmit = null;
    ev.on('lighthouse:ignited', () => (atEmit = ctx.currentTime));
    ev.emit('lighthouse:ignited', undefined);
    assert.equal(em.result, 'play');
    const e = ctx.sources.at(-1);
    assert.deepEqual([e.started, e.offset, e.loop], [atEmit, 0, false], '结尾曲起播时刻 = 点燃那一帧的音频时钟，文件 0 s');
    assert.equal(em.ignitedAt, 812.345);
    assert.deepEqual(e.out[0].gain.events, [['set', 1, 812.345]]);
    assert.equal(ctx.sources[0].stopped, 814.345, '场景曲 2 s 淡出');
    ev.emit('lighthouse:ignited', undefined);
    assert.equal(ctx.sources.length, 2, '只起一次');
    // 跳过：0.75 s 淡出
    ctx.currentTime = 830;
    ev.emit('cutscene:skip', { id: 'other' });
    assert.equal(a.musicKey, ENDING_MUSIC, '别的演出跳过不管');
    ev.emit('cutscene:skip', { id: ENDING_CUTSCENE_ID });
    assert.equal(a.musicKey, null);
    assert.deepEqual(lastRamp(e.out[0].gain), ['ramp', 0, 830.75]);
    assert.equal(e.stopped, 830.75);
    assert.deepEqual(((x) => [x.op, x.from, x.fade])(a.musicLog.at(-1)), ['stop', ENDING_MUSIC, 0.75]);
    em.dispose();
  }
  // 2) 晚到：点燃时还没解码完 → 场景曲照样 2 s 淡出；到了以后 offset = 点燃后经过的音频时钟秒数
  {
    const { ctx, a, ev } = mk();
    let release;
    const em = new EndingMusic(a, ev, () => new Promise((r) => (release = r)));
    void em.prefetch();
    await Promise.resolve();
    ctx.currentTime = 50;
    ev.emit('lighthouse:ignited', undefined);
    assert.equal(a.musicKey, null);
    assert.equal(ctx.sources[0].stopped, 52);
    ctx.currentTime = 53.5;
    release(buf);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(em.result, 'late');
    const e = ctx.sources.at(-1);
    assert.deepEqual([e.started, e.offset], [53.5, 3.5]);
    assert.equal(a.musicStartAt, 50, '补位后文件 0 s 仍对齐点燃时刻');
  }
  // 2b) batch17 D3：负载下 AudioContext 每读一次走一个渲染块（512 采样 @48k）→ offset 和起播时刻仍出自同一次读数
  {
    const { ctx, a, ev } = mk();
    let release;
    const em = new EndingMusic(a, ev, () => new Promise((r) => (release = r)));
    void em.prefetch();
    await Promise.resolve();
    ctx.currentTime = 0.08533;
    ev.emit('lighthouse:ignited', undefined);
    let t = 14.45333 - 512 / 48000;
    Object.defineProperty(ctx, 'currentTime', { get: () => (t += 512 / 48000), set: (v) => (t = v), configurable: true });
    release(buf);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(em.result, 'late');
    const l = a.musicLog.filter((x) => x.key === ENDING_MUSIC && x.op === 'play').at(-1);
    assert.ok(Math.abs(l.offset - (l.at - em.ignitedAt)) < 1e-9, `offset ${l.offset} = 起播 ${l.at} − 点燃 ${em.ignitedAt}（batch17 冒烟差 512 采样）`);
    assert.ok(Math.abs(a.musicStartAt - em.ignitedAt) < 1e-9, '文件 0 s 对齐点燃时刻');
    const e = ctx.sources.at(-1);
    assert.equal(e.started, l.at, 'source.start 用同一时刻');
  }
  // 3) 缺失 / 过了淡出点 / 已跳过
  for (const [load, at, skip, want] of [[async () => null, 0, false, 'missing'], [null, 96, false, 'too-late'], [null, 1, true, 'skipped']]) {
    const { ctx, a, ev } = mk();
    let release;
    const em = new EndingMusic(a, ev, load ?? (() => new Promise((r) => (release = r))));
    void em.prefetch();
    await Promise.resolve();
    ev.emit('lighthouse:ignited', undefined);
    if (skip) ev.emit('cutscene:skip', { id: ENDING_CUTSCENE_ID });
    ctx.currentTime = at;
    release?.(buf);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(em.result, want);
    assert.equal(ctx.sources.length, 1, want + '：不放');
  }
  // 4) 接线：S3Scene 首帧后 prefetch；ChapterEndScene 结尾曲在放就不淡出
  const s3 = readFileSync(new URL('../src/levels/s3/S3Scene.ts', import.meta.url), 'utf8');
  assert.ok(/events\.on\('scene:firstFrame', \(\) => \{\s*offFirst\(\);\s*void ending\.prefetch\(\);/.test(s3), 'S3 首帧后预取结尾曲');
  const menu = readFileSync(new URL('../src/scenes/MenuScene.ts', import.meta.url), 'utf8');
  assert.ok(menu.includes('if (this.game.audio.musicKey === ENDING_MUSIC) return;'), '章节结束页不掐结尾曲');
});

// ---- 1031 配乐 2：S3 两层
test('1031 S3 两层 AudioSystem：layers 和底层同一时刻同一 offset start、同为 loop、初始增益 0、接在曲目 gain 前；时长不同的层不放；交叉淡化时两层一起停；setMusicLayerGain 斜坡', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  a.playMusic({ duration: 151.1 }, { key: 'mus-s2-keeper-house' });
  ctx.currentTime = 77.7;
  const dur = 6615000 / 44100;
  a.playMusic({ duration: dur }, { key: S3_MUSIC_BASE, crossfade: 2, layers: [{ name: S3_MUSIC_UPPER, buffer: { duration: dur } }, { name: 'bad', buffer: { duration: 149 } }] });
  const [, base, up] = ctx.sources;
  assert.equal(ctx.sources.length, 3, '时长不同的层丢掉');
  assert.deepEqual([base.started, base.offset, base.loop], [77.7, 0, true]);
  assert.deepEqual([up.started, up.offset, up.loop], [base.started, base.offset, true], '同一 AudioContext 时刻、同一 offset、同为 loop');
  assert.equal(up.loopStart, undefined);
  const layerGain = up.out[0];
  assert.equal(layerGain.gain.value, 0, '上层初始增益 0');
  assert.equal(layerGain.out[0], base.out[0], '上层接在曲目 gain 前（一起交叉淡化）');
  assert.deepEqual(a.musicLog.at(-1).layers, [S3_MUSIC_UPPER]);
  assert.deepEqual(a.musicLayers.map((l) => [l.name, l.when, l.offset, l.startAt]), [[S3_MUSIC_UPPER, 77.7, 0, a.musicStartAt]]);
  // 增益：斜坡到目标
  ctx.currentTime = 80;
  assert.equal(a.setMusicLayerGain(S3_MUSIC_UPPER, 0.5), true);
  assert.deepEqual(layerGain.gain.events.slice(-3), [['cancel', 80], ['set', 0, 80], ['ramp', 0.5, 80 + MUSIC_LAYER_RAMP_SEC]]);
  const n = layerGain.gain.events.length;
  a.setMusicLayerGain(S3_MUSIC_UPPER, 0.5);
  assert.equal(layerGain.gain.events.length, n, '目标没变不重排');
  assert.equal(a.setMusicLayerGain('nope', 1), false);
  assert.equal(up.started, 77.7, '改增益不重启、不 seek');
  // 换曲（结尾曲）：两层一起淡出、同一时刻停
  ctx.currentTime = 90;
  a.playMusic({ duration: 107 }, { key: ENDING_MUSIC, loop: false, fadeOutPrev: 2 });
  assert.deepEqual([base.stopped, up.stopped], [92, 92]);
  assert.equal(a.setMusicLayerGain(S3_MUSIC_UPPER, 1), false, '结尾曲接管后不再有上层');
  assert.equal(a.addMusicLayer({ name: S3_MUSIC_UPPER, buffer: { duration: 107 } }), false, '不循环的曲子不加层');
});

test('1031 S3 两层 addMusicLayer：上层晚到 → when = now + lead、offset = 底层当前播放位置（取模），换算的文件 0 s 和底层 startAt 同余；不同曲 / 已有 / 时长不同拒绝', () => {
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const dur = 150;
  ctx.currentTime = 10;
  a.playMusic({ duration: dur }, { key: S3_MUSIC_BASE });
  ctx.currentTime = 10 + dur * 2 + 37.25; // 底层已经循环了两圈多
  assert.equal(a.addMusicLayer({ name: S3_MUSIC_UPPER, buffer: { duration: dur }, gain: 0.3 }, 'other'), false, '底层不是指定曲');
  assert.equal(a.addMusicLayer({ name: S3_MUSIC_UPPER, buffer: { duration: 149 } }), false, '时长不同');
  assert.equal(a.addMusicLayer({ name: S3_MUSIC_UPPER, buffer: { duration: dur }, gain: 0.3 }, S3_MUSIC_BASE), true);
  const up = ctx.sources.at(-1);
  assert.ok(Math.abs(up.started - (ctx.currentTime + MUSIC_LAYER_LEAD_SEC)) < 1e-9);
  assert.ok(Math.abs(up.offset - (37.25 + MUSIC_LAYER_LEAD_SEC)) < 1e-9, '对齐到底层播放位置');
  const l = a.musicLayers[0];
  assert.ok(Math.abs((((l.startAt - a.musicStartAt) % dur) + dur) % dur) < 1e-9, '两层文件 0 s 同余');
  assert.equal(up.out[0].gain.value, 0.3, '对齐起播时用当时高度的增益');
  assert.equal(a.musicLog.at(-1).op, 'layer');
  assert.equal(a.addMusicLayer({ name: S3_MUSIC_UPPER, buffer: { duration: dur } }), false, '只起播一次');
  assert.equal(ctx.sources.filter((x) => x.started !== null).length, 2, '底层没被重启 / seek');
});

test('1031 S3 两层 switchLayeredMusicLazy：两层都到 → 一个 playMusic 同时起播；只到底层 → 先放底层、上层到了按位置对齐；底层失败不放、上层失败只放底层；离场丢弃', async () => {
  assert.equal(LEVELS.s3.music, S3_MUSIC_BASE);
  assert.equal(LEVELS.s3.musicUpper, S3_MUSIC_UPPER);
  for (const k of [S3_MUSIC_BASE, S3_MUSIC_UPPER]) {
    const e = manifest.find((x) => x.key === k);
    assert.deepEqual([e.type, e.group, e.lazy, e.optional, e.art, e.gainDb ?? 0], ['audio', 's3', true, true, true, 0], k);
    assert.deepEqual(sizeBucket(e), { group: 's3', lazyAfterEntry: true });
  }
  const buf = { duration: 150 };
  const setup = () => {
    const ctx = new FakeContext();
    const a = new AudioSystem(ctx);
    a.playMusic({ duration: 151.1 }, { key: 'mus-s2-keeper-house' });
    const gates = {};
    const load = (k) => new Promise((r) => (gates[k] = r));
    return { ctx, a, gates, load };
  };
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  // 1) 上层先到、底层后到 → 同时起播
  {
    const { ctx, a, gates, load } = setup();
    const p = switchLayeredMusicLazy(a, load, S3_MUSIC_BASE, S3_MUSIC_UPPER, () => true, () => 0.25);
    await flush();
    gates[S3_MUSIC_UPPER](buf);
    await flush();
    assert.equal(a.musicKey, 'mus-s2-keeper-house', '只到上层不起播');
    ctx.currentTime = 4;
    gates[S3_MUSIC_BASE](buf);
    assert.deepEqual(await p, { base: 'play', upper: 'with-base' });
    const [, base, up] = ctx.sources;
    assert.deepEqual([base.started, up.started, base.offset, up.offset], [4, 4, 0, 0]);
    assert.equal(up.out[0].gain.value, 0.25);
    assert.deepEqual(lastRamp(base.out[0].gain), ['ramp', 1, 6], '和 S2 曲 2 s 交叉淡化');
  }
  // 2) 底层先到 → 先放底层；上层到了对齐
  {
    const { ctx, a, gates, load } = setup();
    const p = switchLayeredMusicLazy(a, load, S3_MUSIC_BASE, S3_MUSIC_UPPER, () => true, () => 0);
    await flush();
    ctx.currentTime = 3;
    gates[S3_MUSIC_BASE](buf);
    await flush();
    assert.equal(a.musicKey, S3_MUSIC_BASE);
    assert.equal(ctx.sources.length, 2, '只放底层');
    ctx.currentTime = 11.5;
    gates[S3_MUSIC_UPPER](buf);
    assert.deepEqual(await p, { base: 'play', upper: 'aligned' });
    const up = ctx.sources[2];
    assert.ok(Math.abs(up.started - 11.6) < 1e-9 && Math.abs(up.offset - 8.6) < 1e-9, JSON.stringify([up.started, up.offset]));
    assert.equal(ctx.sources[1].started, 3, '底层不动');
  }
  // 3) 底层失败（上层到了也不单放）/ 上层失败 / 离场
  {
    const { ctx, a, gates, load } = setup();
    const p = switchLayeredMusicLazy(a, load, S3_MUSIC_BASE, S3_MUSIC_UPPER);
    await flush();
    gates[S3_MUSIC_UPPER](buf);
    gates[S3_MUSIC_BASE](null);
    assert.deepEqual(await p, { base: 'missing', upper: 'no-base' });
    assert.equal(a.musicKey, null);
    assert.equal(ctx.sources.length, 1);
  }
  {
    const { ctx, a, gates, load } = setup();
    const p = switchLayeredMusicLazy(a, load, S3_MUSIC_BASE, S3_MUSIC_UPPER);
    await flush();
    gates[S3_MUSIC_BASE](buf);
    await flush();
    gates[S3_MUSIC_UPPER](null);
    assert.deepEqual(await p, { base: 'play', upper: 'missing' });
    assert.equal(ctx.sources.length, 2);
  }
  {
    const { ctx, a, gates, load } = setup();
    let alive = true;
    const p = switchLayeredMusicLazy(a, load, S3_MUSIC_BASE, S3_MUSIC_UPPER, () => alive);
    await flush();
    gates[S3_MUSIC_BASE](buf);
    await flush();
    alive = false;
    gates[S3_MUSIC_UPPER](buf);
    assert.deepEqual(await p, { base: 'play', upper: 'stale' });
    assert.equal(ctx.sources.length, 2, '离场后不再加层');
  }
  // 接线：LevelScene 首帧后走两层懒加载、每帧 setMusicLayerGain；S3Scene 按高度
  const lvl = readFileSync(new URL('../src/scenes/LevelScene.ts', import.meta.url), 'utf8');
  assert.ok(lvl.indexOf('switchLayeredMusicLazy(audio, (k) => this.game.assets.loadAudio(k), music, upper') > lvl.indexOf("events.on('scene:firstFrame'"));
  assert.ok(lvl.includes('this.game.audio.setMusicLayerGain(this.level.musicUpper, this.upperLayerLevel())'));
  const s3 = readFileSync(new URL('../src/levels/s3/S3Scene.ts', import.meta.url), 'utf8');
  assert.ok(s3.includes('s3UpperLayerGain(toLocal(this.rig.body.position, this.upperTmp))'));
});

test('1031 S3 上层增益 = f(玩家高度)：塔内楼梯底 y 0.2 → 0、灯室地板 y 22 → 1、中间线性、两端夹住；塔外（桥 / 礁石）恒 0；世界 ↔ 局部换算一致', () => {
  assert.deepEqual([S3_UPPER_Y0, S3_UPPER_Y1], [S3.groundFloorY, S3.lampRoom.floorY]);
  const [sx, , sz] = S3.points.stairBottom;
  const at = (y) => s3UpperLayerGain({ x: sx, y, z: sz });
  assert.equal(at(0.2), 0);
  assert.equal(at(-1), 0);
  assert.equal(at(22), 1);
  assert.equal(at(25), 1);
  assert.ok(Math.abs(at(11.1) - 0.5) < 1e-9);
  for (let y = 0.2; y <= 22; y += 0.7) assert.ok(Math.abs(at(y) - (y - 0.2) / 21.8) < 1e-9, '线性');
  assert.ok(Math.abs(s3UpperLayerGain({ x: S3.points.stairTop[0], y: S3.points.stairTop[1], z: S3.points.stairTop[2] }) - 21.6 / 21.8) < 1e-9, '楼梯顶');
  assert.equal(s3UpperLayerGain({ x: S3.points.lampRoomArrive[0], y: 22, z: S3.points.lampRoomArrive[2] }), 1, '灯室');
  assert.equal(s3UpperLayerGain({ x: S3.points.spawnFromS2[0], y: S3.points.spawnFromS2[1], z: S3.points.spawnFromS2[2] }), 0, '桥尾出生点 y 3 在塔外');
  // 世界坐标进出（S3Scene 用 toLocal(rig.body.position)）
  const w = toWorld([sx, 11.1, sz]);
  assert.ok(Math.abs(s3UpperLayerGain(toLocal(w)) - 0.5) < 1e-9);
});

test('1031 体积：6 首配乐全部登记；只有 mus-menu 随 menu 组预加载，其余 5 首都是进场后懒加载（不进首场景包 / 首次进 S1 总下载）；size 单列配乐合计', () => {
  const mus = manifest.filter((e) => e.type === 'audio' && e.key.startsWith('mus-'));
  assert.deepEqual(mus.map((e) => e.key).sort(), ['mus-ending-ch1', 'mus-menu', 'mus-s1-ebb-shore', 'mus-s2-keeper-house', 'mus-s3-lighthouse', 'mus-s3-lighthouse-upper']);
  assert.deepEqual(mus.filter((e) => !sizeBucket(e).lazyAfterEntry).map((e) => e.key), ['mus-menu']);
  assert.ok(!mus.some((e) => e.group === 'common'), '配乐不进 common');
  assert.deepEqual(Object.fromEntries(mus.map((e) => [e.key, e.group])), { 'mus-menu': 'menu', 'mus-s1-ebb-shore': 's1', 'mus-s2-keeper-house': 's2', 'mus-ending-ch1': 's3', 'mus-s3-lighthouse': 's3', 'mus-s3-lighthouse-upper': 's3' });
  const size = readFileSync(new URL('./check-size.mjs', import.meta.url), 'utf8');
  assert.ok(size.includes('配乐 mus-* 合计'));
  if (existsSync(new URL('../../art/audio/music/mus-ending-ch1.ogg', import.meta.url))) {
    const bytes = { 'mus-menu': 1779931, 'mus-s1-ebb-shore': 2526324, 'mus-s2-keeper-house': 2577617, 'mus-s3-lighthouse': 2416936, 'mus-s3-lighthouse-upper': 2482648, 'mus-ending-ch1': 1839809 };
    for (const [k, b] of Object.entries(bytes)) assert.equal(statSync(new URL(`../../art/audio/music/${k}.ogg`, import.meta.url)).size, b, k + ' 交付字节数');
  }
});

test('033 改 LazyAudioCache：并发共享一次下载；404 → null 不抛、记缺失、下次重试；超时 → null、迟到的结果丢掉；?art=0 / 没登记不发请求', async () => {
  assert.ok(LAZY_AUDIO_TIMEOUT_MS >= 5000 && LAZY_AUDIO_TIMEOUT_MS <= 60000);
  const calls = [];
  let mode = 'ok';
  const timers = [];
  const failed = [];
  const loaded = [];
  let art = true;
  const late = [];
  const c = new LazyAudioCache({
    lookup: (k) => (k === 'mus-s1-ebb-shore' ? { url: '/assets/art/audio/music/mus-s1-ebb-shore.ogg', art: true } : null),
    artEnabled: () => art,
    load: (url) => {
      calls.push(url);
      if (mode === '404') return Promise.reject(new Error('HTTP 404'));
      if (mode === 'hang') return new Promise((res) => late.push(res));
      return Promise.resolve({ duration: 150 });
    },
    timeoutMs: 1000,
    onLoaded: (k) => loaded.push(k),
    onFailed: (k, url, err) => failed.push([k, err]),
    setTimer: (fn, ms) => (timers.push([fn, ms]), timers.length),
    clearTimer: () => {},
  });
  // 404
  mode = '404';
  assert.equal(await c.load('mus-s1-ebb-shore'), null);
  assert.equal(failed.length, 1);
  // 超时
  mode = 'hang';
  const p = c.load('mus-s1-ebb-shore');
  assert.equal(c.load('mus-s1-ebb-shore'), p, '并发共享');
  assert.equal(timers.at(-1)[1], 1000);
  timers.at(-1)[0]();
  assert.equal(await p, null);
  assert.ok(failed.at(-1)[1] instanceof LazyAudioTimeout);
  late[0]({ duration: 150 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.get('mus-s1-ebb-shore'), undefined, '超时后迟到的结果不入缓存');
  // 成功（失败不缓存 → 重试）
  mode = 'ok';
  const b = await c.load('mus-s1-ebb-shore');
  assert.equal(b.duration, 150);
  assert.deepEqual(loaded, ['mus-s1-ebb-shore']);
  assert.equal(calls.length, 3);
  assert.equal(await c.load('mus-s1-ebb-shore'), b);
  assert.equal(calls.length, 3, '已加载不再请求');
  // ?art=0 / 没登记：不发请求
  c.delete('mus-s1-ebb-shore');
  art = false;
  assert.equal(await c.load('mus-s1-ebb-shore'), null);
  assert.equal(await c.load('nope'), null);
  assert.equal(calls.length, 3);
});

test('033 改 switchMusicLazy：解码完和主菜单曲 2 s 交叉淡化；菜单曲已停 → 从 0 淡入 2 s；失败 / 超时 → 菜单曲 2 s 淡出、不放、不抛；离场后丢弃', async () => {
  const bufs = { 'mus-menu': { duration: 106.67 }, 'mus-s1-ebb-shore': { duration: 150 } };
  const key = LEVELS.s1.music;
  // 1) 菜单曲在播
  {
    const ctx = new FakeContext();
    const a = new AudioSystem(ctx);
    switchMusic(a, (k) => bufs[k], MENU_MUSIC);
    ctx.currentTime = 10;
    let release;
    const r = switchMusicLazy(a, () => new Promise((res) => (release = res)), key);
    assert.equal(a.musicKey, MENU_MUSIC, '下载期间菜单曲继续');
    ctx.currentTime = 12.5;
    release(bufs[key]);
    assert.equal(await r, 'play');
    const [menu, s1] = ctx.sources;
    assert.deepEqual(lastRamp(menu.out[0].gain), ['ramp', 0, 14.5]);
    assert.deepEqual(s1.out[0].gain.events[0], ['set', 0, 12.5]);
    assert.deepEqual(lastRamp(s1.out[0].gain), ['ramp', 1, 14.5]);
    assert.deepEqual(((e) => [e.from, e.fade])(a.musicLog.at(-1)), [MENU_MUSIC, 2]);
  }
  // 2) 菜单曲已经停了：从 0 淡入
  {
    const ctx = new FakeContext();
    const a = new AudioSystem(ctx);
    switchMusic(a, (k) => bufs[k], MENU_MUSIC);
    a.stopMusic(2);
    ctx.currentTime = 20;
    assert.equal(await switchMusicLazy(a, async (k) => bufs[k], key), 'play');
    const s1 = ctx.sources[1];
    assert.deepEqual(s1.out[0].gain.events[0], ['set', 0, 20]);
    assert.deepEqual(lastRamp(s1.out[0].gain), ['ramp', 1, 22]);
    assert.deepEqual(((e) => [e.from, e.fade])(a.musicLog.at(-1)), [null, 2]);
  }
  // 3) 404 / 超时（load → null）与 load 抛错
  for (const load of [async () => null, async () => { throw new Error('boom'); }]) {
    const ctx = new FakeContext();
    const a = new AudioSystem(ctx);
    switchMusic(a, (k) => bufs[k], MENU_MUSIC);
    ctx.currentTime = 5;
    assert.equal(await switchMusicLazy(a, load, key), 'missing');
    assert.equal(a.musicKey, null);
    assert.equal(ctx.sources.length, 1, '不放音乐');
    assert.equal(ctx.sources[0].stopped, 7, '菜单曲照常 2 s 淡出');
  }
  // 4) 离场
  {
    const ctx = new FakeContext();
    const a = new AudioSystem(ctx);
    switchMusic(a, (k) => bufs[k], MENU_MUSIC);
    assert.equal(await switchMusicLazy(a, async (k) => bufs[k], key, () => false), 'stale');
    assert.equal(a.musicKey, MENU_MUSIC);
    assert.equal(ctx.sources.length, 1);
  }
});

test('033 改 接入点：Game 在新场景第一次 render 之后发 scene:firstFrame；LevelScene 对懒加载场景曲等 scene:firstFrame 才 loadAudio', () => {
  const game = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
  const iRender = game.indexOf('this.renderer.render(scene.scene, scene.camera)');
  const iEmit = game.indexOf("this.events.emit('scene:firstFrame'");
  assert.ok(iRender > 0 && iEmit > iRender, 'scene:firstFrame 在 render 之后');
  const lvl = readFileSync(new URL('../src/scenes/LevelScene.ts', import.meta.url), 'utf8');
  const iOn = lvl.indexOf("events.on('scene:firstFrame'");
  const iLoad = lvl.indexOf('switchMusicLazy(audio, (k) => this.game.assets.loadAudio(k), music');
  assert.ok(iOn > 0 && iLoad > iOn, 'loadAudio 在 scene:firstFrame 回调里');
});

// ---- 033 改（制作人 c0d81c9 反馈 2）：主菜单曲单独增益，和 S1 场景曲在音乐总线上一样响
test('033 改 主菜单曲电平：manifest gainDb 后 mus-menu 与 mus-s1-ebb-shore 整条 RMS / 积分响度差 ≤ 1 dB，不削波；两首同走音乐总线', () => {
  const db = (g) => 20 * Math.log10(g);
  const menu = MUSIC_FILE_LEVELS['mus-menu'];
  const s1 = MUSIC_FILE_LEVELS['mus-s1-ebb-shore'];
  const gMenu = db(musicTrackGain('mus-menu'));
  const gS1 = db(musicTrackGain('mus-s1-ebb-shore'));
  assert.ok(Math.abs(gMenu - 0.3) < 1e-9, `主菜单曲增益 ${gMenu}`);
  assert.ok(Math.abs(gS1) < 1e-9, 'S1 曲不加增益（基准）');
  // 关系断言：总线后电平 = 文件电平 + 曲目增益 + 总线增益（两首同一总线，总线项相消）
  const rmsDiff = menu.rmsDb + gMenu + MUSIC_BUS_DB - (s1.rmsDb + gS1 + MUSIC_BUS_DB);
  const lufsDiff = menu.lufs + gMenu - (s1.lufs + gS1);
  assert.ok(Math.abs(rmsDiff) <= MUSIC_MATCH_TOL_DB, `RMS 差 ${rmsDiff.toFixed(2)} dB`);
  assert.ok(Math.abs(lufsDiff) <= MUSIC_MATCH_TOL_DB, `LUFS 差 ${lufsDiff.toFixed(2)}`);
  assert.ok(Math.abs(rmsDiff) <= 0.1, `增益应按 RMS 对齐到 0.1 dB 内：${rmsDiff.toFixed(2)}`);
  // 不削波：曲目增益后（进总线前）采样峰值 / 真峰值 < 0 dBFS
  assert.ok(menu.peakDb + gMenu < 0 && menu.truePeakDb + gMenu < 0, `主菜单曲峰值 ${menu.peakDb + gMenu}`);
  // 实际播放路径带上增益
  const ctx = new FakeContext();
  const a = new AudioSystem(ctx);
  const bufs = { 'mus-menu': { duration: 106.67 }, 'mus-s1-ebb-shore': { duration: 150 } };
  switchMusic(a, (k) => bufs[k], MENU_MUSIC);
  // boot 第一首不淡入（BUG-025 只改「这局放过曲子之后没有上一首」）：直接是曲目增益
  assert.ok(Math.abs(ctx.sources[0].out[0].gain.value - musicTrackGain('mus-menu')) < 1e-9);
  assert.equal(a.musicLog.at(-1).fade, 0, 'boot 第一首 fade 0');
  assert.ok(Math.abs(a.musicLevel - 10 ** (0.3 / 20)) < 1e-9);
  ctx.currentTime = 3;
  switchMusic(a, (k) => bufs[k], LEVELS.s1.music);
  assert.deepEqual(lastRamp(ctx.sources[1].out[0].gain), ['ramp', 1, 5]);
  assert.equal(ctx.sources[1].out[0].out[0], ctx.sources[0].out[0].out[0], '同一条音乐总线');
  // 有 ffmpeg 和美术文件时重新量整条 RMS：文件换了就要重定增益
  const remeasured = [];
  for (const key of ['mus-menu', 'mus-s1-ebb-shore']) {
    const f = new URL(`../../art/audio/music/${key}.ogg`, import.meta.url);
    if (!existsSync(f)) continue;
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f.pathname, '-af', 'astats=measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8' });
    if (r.error) continue; // 没装 ffmpeg：跳过重测
    const txt = r.stderr;
    remeasured.push(key);
    const m = /Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+)/.exec(txt);
    if (!m) continue;
    assert.ok(Math.abs(Number(m[1]) - MUSIC_FILE_LEVELS[key].rmsDb) <= 0.05, `${key} 重测 RMS ${m[1]} ≠ 记录 ${MUSIC_FILE_LEVELS[key].rmsDb}`);
  }
  if (remeasured.length) console.log(`    （ffmpeg 重测整条 RMS：${remeasured.join(', ')}）`);
});

await Promise.all(pending);
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
