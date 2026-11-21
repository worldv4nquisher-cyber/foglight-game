// v0.1-009 画质参数表 + 3 秒自动检测的离线校验。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-quality.mjs（npm run test:quality，已并入 npm run test）
// 1) quality.ts 三档逐键对照 art/style/style-guide.md §8（期望值内嵌在本脚本里，§8 改了这里也要改）
// 2) 默认极致、不按 GPU 判档
// 3) QualityBenchmark：simulateFps 降档 / 重测 / 最多连降两档、只跑一次、手动改后不再自动改、恢复默认回到检测结果
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUALITY_PRESETS, QualityManager, atmoTier, isSoftwareRenderer, qualityFromSearch } from '@/config/quality';
import { EventBus } from '@/core/EventBus';
import { watchDevicePixelRatio } from '@/platform/dprWatch';
import { QualityBenchmark, parseSimulateFps } from '@/systems/QualityBenchmark';
import { DEFAULT_SETTINGS, SETTINGS_KEY, Settings } from '@/systems/save/Settings';

/** style-guide §8 表（2026-10-29 版；heroCharTris 高档按拆单裁定第 4 条为 50k） */
const SPEC = {
  renderScale: [1.0, 1.0, 0.8, 0.5],
  maxPixelRatio: [2.0, 1.5, 1.0, 1.0],
  heroCharTris: [120_000, 50_000, 50_000, 25_000],
  npcCharTris: [60_000, 40_000, 25_000, 12_000],
  sceneVisibleTris: [6_000_000, 3_500_000, 1_500_000, 1_000_000],
  maxDrawCalls: [2000, 1200, 600, 400],
  textureMaxSize: [4096, 2048, 2048, 1024],
  textureMaxSizeEnv: [2048, 2048, 1024, 512],
  anisotropy: [16, 8, 4, 1],
  outlineHull: [['character', 'prop', 'near'], ['character', 'prop'], ['character', 'interactive'], ['character', 'interactive']],
  outlinePost: [
    { enabled: true, resolution: 'full', inputs: ['normal', 'depth', 'id'], maxDistance: 300 },
    { enabled: true, resolution: 'full', inputs: ['normal', 'depth'], maxDistance: 150 },
    { enabled: false, resolution: 'full', inputs: [], maxDistance: 0 },
    { enabled: false, resolution: 'full', inputs: [], maxDistance: 0 },
  ],
  fogMode: ['volumetric', 'volumetric', 'cards', 'cards'],
  fogFroxels: [[160, 90, 128], [80, 45, 64], null, null],
  fogCards: [
    { farLayers: 5, extraMax: 20 },
    { farLayers: 5, extraMax: 30 },
    { farLayers: 4, extraMax: 40 },
    { farLayers: 4, extraMax: 40 },
  ],
  lightShafts: [
    { mode: 'raymarch', steps: 64, halfRes: false },
    { mode: 'raymarch', steps: 32, halfRes: true },
    { mode: 'mesh', steps: 0, halfRes: false },
    { mode: 'mesh', steps: 0, halfRes: false },
  ],
  softParticles: [true, true, true, false],
  rainParticles: [
    { count: 30_000, ripples: true, lensDroplets: true },
    { count: 15_000, ripples: true, lensDroplets: false },
    { count: 6000, ripples: true, lensDroplets: false },
    { count: 1500, ripples: true, lensDroplets: false },
  ],
  shadowType: [
    { cascades: 4, mapSize: 4096, filter: 'PCSS', contactShadows: true },
    { cascades: 3, mapSize: 2048, filter: 'PCF_SOFT', contactShadows: false },
    { cascades: 2, mapSize: 2048, filter: 'PCF', contactShadows: false },
    { cascades: 0, mapSize: 512, filter: 'PCF', contactShadows: false }, // 最低档：不投阴影
  ],
  pointLightShadows: [
    { count: 2, mapSize: 1024 },
    { count: 1, mapSize: 1024 },
    { count: 1, mapSize: 512 },
    { count: 0, mapSize: 512 },
  ],
  ao: [
    { gtao: 'full', baked: true },
    { gtao: 'half', baked: true },
    { gtao: 'off', baked: true },
    { gtao: 'off', baked: true },
  ],
  reflections: [
    // planarStrength 不是 §8 的键：025 平面反射混合强度，三档共用 PLANAR_REFLECTION_STRENGTH（10-31 用户选一半强度 = 0.5）
    { ssr: 'full', ssrWetOnly: false, planar: 0.5, probes: false, planarStrength: 0.5 }, // 037：planar 1 → 0.5（强度 0.5 后看不出差别，省 3/4 RT 像素）
    { ssr: 'half', ssrWetOnly: true, planar: 0.5, probes: false, planarStrength: 0.5 },
    { ssr: 'off', ssrWetOnly: false, planar: 0.25, probes: true, planarStrength: 0.5 },
    { ssr: 'off', ssrWetOnly: false, planar: 0, probes: true, planarStrength: 0.5 }, // 最低档：不画平面反射
  ],
  dof: ['bokeh', 'gaussian-cutscene', 'off', 'off'],
  bloom: [
    { enabled: true, mipLevels: 6 },
    { enabled: true, mipLevels: 5 },
    { enabled: true, mipLevels: 4 },
    { enabled: false, mipLevels: 4 },
  ],
  lut: [true, true, true, true],
  toneMapping: ['AgX', 'AgX', 'AgX', 'AgX'],
  filmGrain: [true, true, false, false],
  vignette: [true, true, true, false],
  antialias: ['TAA', 'SMAA', 'SMAA', 'SMAA'],
  lodDistances: [[60, 150, 400], [40, 100, 250], [25, 60, 150], [15, 35, 90]],
  impostorDistance: [600, 400, 250, 250],
  grassDensity: [1.0, 0.7, 0.4, 0.2],
};
const TIERS = ['ultra', 'high', 'standard', 'low'];
/** 旧字段：与 §8 冲突 / 重复，已并入 §8 键（rainCount → rainParticles.count，shadowMapSize → shadowType.mapSize …） */
const REMOVED = ['rainCount', 'shadowMapSize', 'shadows', 'smaa', 'aoHalfRes', 'bloomMipmapBlur'];

class MemStorage {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

// 测试里不要刷 console.info
const realInfo = console.info;
console.info = () => {};

/** 一次「启动」：同一个 storage 上新建 Settings / QualityManager / Benchmark */
function boot(storage, { search = '', simulate = null, warmupFrames = 0 } = {}) {
  const events = new EventBus();
  const changes = [];
  events.on('quality:changed', (e) => changes.push(e));
  const detected = [];
  events.on('quality:detected', (e) => detected.push(e));
  const settings = new Settings(storage);
  const quality = new QualityManager(events, null, settings, qualityFromSearch(search));
  const bench = new QualityBenchmark(quality, settings, events, { simulateFps: simulate ?? parseSimulateFps(search), warmupFrames });
  return { events, settings, quality, bench, changes, detected };
}

/** 以 fps 帧率推进 sec 秒（rAF 时间戳毫秒） */
function run(b, { fps = 60, sec = 3.2, paused = false, t0 = { v: 0 } } = {}) {
  const step = 1000 / fps;
  const end = t0.v + sec * 1000;
  for (; t0.v <= end; t0.v += step) b.bench.update(t0.v, paused);
  return t0;
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push([name]);
  } catch (e) {
    results.push([name, e]);
  }
}

// ---------------------------------------------------------------- 1) 参数表
test('quality.ts 含 style-guide §8 全部键，四档数值与表一致', () => {
  const bad = [];
  for (const [key, vals] of Object.entries(SPEC)) {
    TIERS.forEach((t, i) => {
      const p = QUALITY_PRESETS[t];
      if (!(key in p)) bad.push(`${t}.${key} 缺失`);
      else {
        try {
          assert.deepEqual(p[key], vals[i]);
        } catch {
          bad.push(`${t}.${key} = ${JSON.stringify(p[key])}，§8 = ${JSON.stringify(vals[i])}`);
        }
      }
    });
  }
  assert.equal(bad.length, 0, bad.join('；'));
  // §8 表 28 行（lut/toneMapping、filmGrain/vignette 各占一行）= 30 个键，fogMode 的 froxel 网格单列 fogFroxels
  assert.equal(Object.keys(SPEC).length, 31);
});

test('与 §8 冲突的旧字段已去掉（雨 30k/15k/6k、阴影 4096/2048/2048 只认 §8 键）', () => {
  for (const t of TIERS) for (const k of REMOVED) assert.ok(!(k in QUALITY_PRESETS[t]), `${t} 仍有旧字段 ${k}`);
  assert.deepEqual(TIERS.map((t) => QUALITY_PRESETS[t].rainParticles.count), [30000, 15000, 6000, 1500]);
  assert.deepEqual(TIERS.map((t) => QUALITY_PRESETS[t].shadowType.mapSize), [4096, 2048, 2048, 512]);
});

test('四档 label / tier 对应，视距覆盖 impostor 距离', () => {
  assert.deepEqual(TIERS.map((t) => QUALITY_PRESETS[t].labelId), ['ui.settings.quality_ultra', 'ui.settings.quality_high', 'ui.settings.quality_standard', 'ui.settings.quality_low']);
  for (const t of TIERS) {
    assert.equal(QUALITY_PRESETS[t].tier, t);
    assert.ok(QUALITY_PRESETS[t].viewDistance >= QUALITY_PRESETS[t].impostorDistance);
  }
});

// ---------------------------------------------------------------- 2) 默认极致、不按 GPU 判档
test('默认（无设置、无检测结果）档位为极致；不再按 GPU 名称判档', () => {
  assert.equal(DEFAULT_SETTINGS.quality, 'ultra');
  const b = boot(new MemStorage());
  assert.equal(b.quality.tier, 'ultra');
  assert.equal(b.settings.get('qualityDetected'), false, '启动时不能直接写检测结果');
  assert.equal(b.quality.detected, null);
  const src = readFileSync(new URL('../src/config/quality.ts', import.meta.url), 'utf8');
  assert.ok(!/detectQualityTier|\/[^/\n]*(rtx|swiftshader|intel)[^/\n]*\/[a-z]*\.test\(/i.test(src), 'quality.ts 里还有按 GPU 名称判档的逻辑');
});

// ---------------------------------------------------------------- 3) 自动检测
test('?simulateFps=40：极致 → 高 → 重测 → 标准，不会再往下降', () => {
  const st = new MemStorage();
  const b = boot(st, { search: '?simulateFps=40' });
  b.quality.apply('high', 'user'); // 检测开始时应先切回极致
  assert.equal(b.bench.start(), true);
  assert.equal(b.quality.tier, 'ultra');
  const t = run(b, { sec: 2.9 });
  assert.equal(b.quality.tier, 'ultra', '3 秒没到就降档了');
  run(b, { sec: 0.3, t0: t });
  assert.equal(b.quality.tier, 'high', '第一轮 40 fps 应降到高');
  assert.equal(b.bench.state, 'running', '降档后应重测');
  run(b, { sec: 3.2, t0: t });
  assert.equal(b.quality.tier, 'standard');
  run(b, { sec: 10, t0: t });
  assert.equal(b.quality.tier, 'standard');
  assert.equal(b.bench.state, 'done');
  assert.deepEqual(b.bench.rounds.map((r) => [r.tier, r.fps, r.simulated]), [
    ['ultra', 40, true],
    ['high', 40, true],
    ['standard', 40, true],
  ]);
  const s = b.settings.all;
  assert.deepEqual([s.qualityDetected, s.quality, s.qualityDetectedTier, s.qualitySource], [true, 'standard', 'standard', 'auto']);
  assert.equal(JSON.parse(st.getItem(SETTINGS_KEY)).quality, 'standard', '没写盘');
  assert.equal(b.quality.showAutoNote, true, '降过档应显示 quality_auto_note');
  assert.deepEqual(b.detected.map((d) => [d.tier, d.drops]), [['standard', 2]]);
  const autos = b.changes.filter((c) => c.source === 'auto').map((c) => `${c.previous}>${c.tier}`);
  assert.deepEqual(autos, ['high>ultra', 'ultra>high', 'high>standard']);
});

test('实测帧率 ≥ 50：保持极致，不显示提示；40,60 → 只降一档', () => {
  let b = boot(new MemStorage());
  b.bench.start();
  run(b, { fps: 60, sec: 3.5 });
  assert.equal(b.bench.state, 'done');
  assert.equal(b.quality.tier, 'ultra');
  assert.ok(Math.abs(b.bench.rounds[0].fps - 60) < 1.5, '实测 fps 不对：' + b.bench.rounds[0].fps);
  assert.equal(b.quality.showAutoNote, false);

  b = boot(new MemStorage(), { search: '?simulateFps=40,60' });
  b.bench.start();
  run(b, { sec: 7 });
  assert.equal(b.bench.state, 'done');
  assert.equal(b.quality.tier, 'high');
  assert.equal(b.settings.get('qualityDetectedTier'), 'high');

  b = boot(new MemStorage());
  b.bench.start();
  run(b, { fps: 30, sec: 12 });
  assert.equal(b.quality.tier, 'standard', '实测 30 fps 应连降两档');
  assert.equal(b.bench.rounds.length, 3);
});

test('检测后重启不再检测；手动改回极致生效并保存，之后不被自动改动', () => {
  const st = new MemStorage();
  let b = boot(st, { search: '?simulateFps=40' });
  b.bench.start();
  run(b, { sec: 12 });
  assert.equal(b.quality.tier, 'standard');
  // 重启
  b = boot(st, { search: '?simulateFps=40' });
  assert.equal(b.quality.tier, 'standard');
  assert.equal(b.bench.needed, false);
  assert.equal(b.bench.start(), false);
  run(b, { sec: 12 });
  assert.equal(b.quality.tier, 'standard');
  // 手动改回极致
  b.quality.set('ultra');
  assert.equal(b.quality.tier, 'ultra');
  assert.deepEqual(b.changes.at(-1), { tier: 'ultra', previous: 'standard', source: 'user' });
  assert.equal(b.settings.get('qualitySource'), 'user');
  assert.equal(b.quality.showAutoNote, false, '手动改过后不再显示提示');
  b = boot(st, { search: '?simulateFps=40' });
  assert.equal(b.quality.tier, 'ultra', '手动选择没保存');
  assert.equal(b.bench.start(), false);
  run(b, { sec: 12 });
  assert.equal(b.quality.tier, 'ultra');
});

test('「恢复默认」不重新检测，画质回到检测结果；没检测过回到极致', () => {
  const st = new MemStorage();
  let b = boot(st, { search: '?simulateFps=40,60' });
  b.bench.start();
  run(b, { sec: 8 });
  b.quality.set('standard');
  b.settings.resetToDefaults();
  assert.equal(b.quality.tier, 'high', '运行时档位没回到检测结果');
  const s = b.settings.all;
  assert.deepEqual([s.quality, s.qualitySource, s.qualityDetected], ['high', 'auto', true]);
  assert.equal(b.changes.at(-1).source, 'settings');
  assert.equal(b.quality.showAutoNote, true);
  b = boot(st);
  assert.equal(b.bench.start(), false, '恢复默认后不应重新检测');

  const fresh = boot(new MemStorage());
  fresh.quality.set('standard');
  fresh.settings.update({ qualitySource: 'default' }); // 模拟未检测 + 非手动
  fresh.settings.resetToDefaults();
  assert.equal(fresh.quality.tier, 'ultra');
  assert.equal(fresh.settings.get('qualityDetected'), false);
});

test('检测中玩家手动改画质：立即停止、以玩家为准；检测前已手动选过则跳过', () => {
  let b = boot(new MemStorage(), { search: '?simulateFps=40' });
  b.bench.start();
  run(b, { sec: 3.3 });
  assert.equal(b.quality.tier, 'high');
  b.quality.set('ultra');
  run(b, { sec: 10 });
  assert.equal(b.bench.state, 'aborted');
  assert.equal(b.quality.tier, 'ultra');
  assert.deepEqual([b.settings.get('qualityDetected'), b.settings.get('qualitySource')], [true, 'user']);

  b = boot(new MemStorage(), { search: '?simulateFps=40' });
  b.quality.set('high');
  assert.equal(b.bench.start(), false);
  assert.equal(b.bench.state, 'skipped');
  assert.equal(b.quality.tier, 'high');
  assert.equal(b.settings.get('qualityDetected'), true);
});

test('BUG-002：检测被手动改档打断 / 被跳过 → 没有检测结果（不写 qualityDetectedTier）、显示「尚未自动检测」、恢复默认回默认档', () => {
  // aborted：极致测完降到高后，玩家手动改到标准
  const st = new MemStorage();
  let b = boot(st, { search: '?simulateFps=40' });
  b.bench.start();
  run(b, { sec: 3.3 });
  assert.equal(b.quality.tier, 'high');
  b.quality.set('standard');
  assert.equal(b.bench.state, 'aborted');
  assert.equal(b.settings.get('qualityDetectedTier'), null, '检测没完成不应写 qualityDetectedTier');
  assert.equal(b.quality.detected, null, '暂停菜单读 detected → 「尚未自动检测」');
  assert.equal(b.quality.showAutoNote, false);
  b.settings.resetToDefaults();
  assert.deepEqual([b.quality.tier, b.settings.get('quality'), b.settings.get('qualitySource')], ['ultra', 'ultra', 'default'], '恢复默认回默认档（极致），来源 default');
  assert.equal(b.changes.at(-1).source, 'settings');
  // 重启：仍然没有结果，也不再检测
  b = boot(st, { search: '?simulateFps=40' });
  assert.equal(b.quality.detected, null);
  assert.equal(b.bench.start(), false, '打断过就不再自动检测');

  // skipped：检测前已手动选档
  const st2 = new MemStorage();
  b = boot(st2, { search: '?simulateFps=40' });
  b.quality.set('high');
  assert.equal(b.bench.start(), false);
  assert.equal(b.bench.state, 'skipped');
  assert.deepEqual([b.settings.get('qualityDetected'), b.settings.get('qualityDetectedTier'), b.quality.detected], [true, null, null]);
  b.settings.resetToDefaults();
  assert.equal(b.quality.tier, 'ultra');
  assert.equal(b.settings.get('qualitySource'), 'default');

  // 设置界面（008 起 SettingsPanel，主菜单 / 暂停菜单共用）画质状态行：detected 为 null 时显示「尚未自动检测」
  const src = readFileSync(new URL('../src/ui/SettingsPanel.ts', import.meta.url), 'utf8');
  assert.ok(/detected\s*\?[^:]+:\s*[^;]*(尚未自动检测|quality_undetected)/.test(src), '设置界面没按 detected 为 null 显示「尚未自动检测」');
});

test('BUG-002：检测没完成就离开 S1（cancel）→ 不写任何结果、运行时档位退回设置、下次进 S1 重测', () => {
  const st = new MemStorage();
  let b = boot(st, { search: '?simulateFps=40' });
  b.bench.start();
  run(b, { sec: 3.3 });
  assert.equal(b.quality.tier, 'high');
  b.bench.cancel();
  assert.equal(b.bench.state, 'idle');
  assert.equal(b.quality.tier, 'ultra', '运行时档位退回设置里的极致');
  assert.deepEqual([b.settings.get('qualityDetected'), b.settings.get('qualityDetectedTier'), b.settings.get('quality')], [false, null, 'ultra']);
  b = boot(st, { search: '?simulateFps=40' });
  assert.equal(b.bench.start(), true, '下次进 S1 重新检测');
});

test('firstRoundDone：第一轮测完前为 false（建立镜头等它），之后 / 不在跑时为 true', () => {
  const b = boot(new MemStorage(), { search: '?simulateFps=40', warmupFrames: 5 });
  assert.equal(b.bench.firstRoundDone, true, '没在跑');
  b.bench.start();
  const t = run(b, { sec: 3.0 });
  assert.equal(b.bench.firstRoundDone, false, '热身帧 + 3 s 还没到');
  run(b, { sec: 0.2, t0: t });
  assert.equal(b.bench.firstRoundDone, true);
  assert.equal(b.bench.state, 'running', '后续轮次继续（玩家已可操作）');
});

test('暂停 / 切后台时这一轮作废、恢复后重测；切档后丢弃热身帧', () => {
  const b = boot(new MemStorage(), { search: '?simulateFps=40', warmupFrames: 5 });
  b.bench.start();
  const t = run(b, { sec: 2.5 });
  run(b, { sec: 5, paused: true, t0: t });
  assert.equal(b.quality.tier, 'ultra', '暂停期间不应计时');
  run(b, { sec: 2.5, t0: t });
  assert.equal(b.quality.tier, 'ultra', '恢复后应从头计 3 秒');
  run(b, { sec: 0.8, t0: t });
  assert.equal(b.quality.tier, 'high');
});

test('URL ?quality= 临时覆盖：不跑检测、不写盘；parseSimulateFps', () => {
  const st = new MemStorage();
  const b = boot(st, { search: '?quality=standard&simulateFps=40' });
  assert.equal(b.quality.tier, 'standard');
  assert.equal(b.bench.start(), false);
  b.quality.set('high');
  assert.equal(b.quality.tier, 'high');
  assert.equal(b.settings.get('quality'), 'ultra');
  assert.equal(b.settings.get('qualityDetected'), false);
  assert.deepEqual(parseSimulateFps('?simulateFps=40'), [40]);
  assert.deepEqual(parseSimulateFps('?simulateFps=40,55'), [40, 55]);
  assert.equal(parseSimulateFps('?simulateFps=abc'), null);
  assert.equal(parseSimulateFps(''), null);
});

test('最低档：设置里可选并写盘；自动检测最低只降到标准；雨 / 雾墙沿用标准档的 028 参数', () => {
  assert.deepEqual(QualityManager.tiers, TIERS);
  const st = new MemStorage();
  const b = boot(st);
  b.quality.set('low');
  assert.equal(b.quality.tier, 'low');
  assert.equal(JSON.parse(st.getItem(SETTINGS_KEY)).quality, 'low');
  assert.equal(boot(st).quality.tier, 'low', '重启后没保留最低档');
  assert.equal(boot(new MemStorage(), { search: '?quality=low' }).quality.tier, 'low');
  const slow = boot(new MemStorage(), { simulate: [5] });
  assert.equal(slow.bench.start(), true);
  for (let i = 0; i < 5; i++) run(slow, { fps: 5, t0: { v: i * 10_000 } });
  assert.equal(slow.quality.tier, 'standard', '自动检测不该降到最低档');
  assert.deepEqual(TIERS.map(atmoTier), ['ultra', 'high', 'standard', 'standard']);
  const low = QUALITY_PRESETS.low;
  assert.equal(low.postprocessing, false);
  assert.equal(low.shadowType.cascades, 0);
  assert.equal(low.reflections.planar, 0);
});

console.info = realInfo;
// batch26 ⑥：像素比监听——每次变化后按新值重新注册 (resolution: Ndppx)，旧查询解绑；老 Safari 只有 addListener 也能用
function fakeWin(dpr, legacy = false) {
  const w = { devicePixelRatio: dpr, queries: [] };
  w.matchMedia = (q) => {
    const m = { media: q, hs: new Set(), removed: 0 };
    if (legacy) {
      m.addListener = (h) => m.hs.add(h);
      m.removeListener = (h) => { m.removed++; m.hs.delete(h); };
    } else {
      m.addEventListener = (t, h) => t === 'change' && m.hs.add(h);
      m.removeEventListener = (t, h) => { m.removed++; m.hs.delete(h); };
    }
    m.fire = () => [...m.hs].forEach((h) => h());
    w.queries.push(m);
    return m;
  };
  return w;
}
for (const legacy of [false, true]) {
  test(`batch26 ⑥：DPR 变化 1 → 1.5 → 2 → 1 每次都回调新值、按新值重新注册查询、旧查询解绑；dispose 后不再回调（${legacy ? 'addListener' : 'addEventListener'}）`, () => {
    const w = fakeWin(1, legacy);
    const seen = [];
    const off = watchDevicePixelRatio((d) => seen.push(d), w);
    assert.equal(w.queries.length, 1);
    assert.equal(w.queries[0].media, '(resolution: 1dppx)');
    for (const d of [1.5, 2, 1]) {
      const cur = w.queries.at(-1);
      w.devicePixelRatio = d;
      cur.fire();
      assert.equal(cur.hs.size, 0, '旧查询应解绑');
      assert.equal(w.queries.at(-1).media, `(resolution: ${d}dppx)`);
      assert.equal(w.queries.at(-1).hs.size, 1);
    }
    assert.deepEqual(seen, [1.5, 2, 1]);
    const last = w.queries.at(-1);
    off();
    assert.equal(last.hs.size, 0, 'dispose 后应解绑');
    last.fire();
    assert.deepEqual(seen, [1.5, 2, 1]);
  });
}
test('batch26 ⑥：没有 matchMedia 的环境不报错，返回空解绑', () => {
  const off = watchDevicePixelRatio(() => assert.fail('不该回调'), { devicePixelRatio: 2 });
  off();
});

test('batch26 ⑤：软件渲染判定——SwiftShader / WARP / llvmpipe / softpipe / lavapipe / Software 命中，真显卡和读不到名字不命中', () => {
  for (const n of [
    'Google SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'softpipe',
    'llvmpipe',
    'Apple Software Renderer',
    'Software WebRender',
  ]) assert.ok(isSoftwareRenderer(n), n);
  for (const n of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple GPU',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    'Mesa Intel(R) Xe Graphics (TGL GT2)',
    'AMD Radeon RX 6600',
    'unknown',
    '',
  ]) assert.ok(!isSoftwareRenderer(n), n);
  assert.equal(boot(new MemStorage()).quality.softwareRender, false, '没有渲染器（unknown）不提示');
});

let failed = 0;
for (const [name, e] of results) {
  console.log(`${e ? '✗' : '✓'} ${name}`);
  if (e) {
    failed++;
    console.log(`   ${e.message}`);
  }
}
console.log(failed ? `\n画质校验失败：${failed} 项` : `\n画质参数表 / 自动检测校验通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
