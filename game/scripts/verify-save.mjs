// v0.1-006 存档与设置校验（纯逻辑，无 DOM）：正常读写、版本不匹配、非法 JSON、写入失败、游玩时间、设置迁移。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-save.mjs
import assert from 'node:assert/strict';
import { SAVE_KEY, SAVE_TEXT, SaveSystem, parseSave } from '@/systems/save/SaveSystem';
import { formatPlayTime } from '@/ui/format';
import { cloneFallback, deepClone } from '@/platform/clone';
import { OVER_SHOULDER } from '@/content/cutscenes/ending';
import { DEFAULT_SETTINGS, LEGACY_QUALITY_KEY, SETTINGS_KEY, Settings } from '@/systems/save/Settings';

/** 内存版 localStorage；mode: ok / readonly（setItem 抛 QuotaExceededError，模拟 Safari 隐私模式）/ broken（全部抛错） */
class MemStorage {
  constructor(mode = 'ok', init = {}) {
    this.mode = mode;
    this.map = new Map(Object.entries(init));
  }
  getItem(k) {
    if (this.mode === 'broken') throw new Error('SecurityError');
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.mode !== 'ok') throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k) {
    if (this.mode === 'broken') throw new Error('SecurityError');
    this.map.delete(k);
  }
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
const validSave = (patch = {}) =>
  JSON.stringify({
    version: 1,
    chapterId: 'ch1',
    sceneId: 's2',
    readDocs: ['doc.letter1'],
    playTimeSec: 120,
    hintsUsed: 1,
    chapterComplete: false,
    savedAt: 1,
    ...patch,
  });

// ---------------------------------------------------------------- 存档

test('没有存档：status=empty，「继续」隐藏，无提示', () => {
  const s = new SaveSystem(new MemStorage());
  assert.equal(s.status, 'empty');
  assert.equal(s.canContinue, false);
  assert.equal(s.menuNotice, null);
  assert.equal(s.load(), null);
});

test('正常读写：进入 S1/S2/S3 各写一次，刷新后「继续」回到最后的场景入口', () => {
  const st = new MemStorage();
  let t = 1000;
  const a = new SaveSystem(st, () => t);
  a.newGame('ch1', 's1');
  for (const scene of ['s1', 's2', 's3']) {
    t += 1;
    assert.equal(a.save({ chapterId: 'ch1', sceneId: scene }), true);
    assert.equal(JSON.parse(st.getItem(SAVE_KEY)).sceneId, scene);
  }
  a.markDocRead('doc.journal1');
  a.markDocRead('doc.journal1');
  a.addHintUsed();
  a.markLineSeen('line.s3.enter');
  a.save({ chapterId: 'ch1', sceneId: 's3' });
  // 「刷新页面」= 新实例读同一个 storage
  const b = new SaveSystem(st, () => t);
  assert.equal(b.status, 'ok');
  assert.equal(b.canContinue, true);
  const d = b.continueGame();
  assert.equal(d.sceneId, 's3');
  assert.deepEqual(d.readDocs, ['doc.journal1']);
  assert.deepEqual(d.seenLines, ['line.s3.enter']);
  assert.equal(d.hintsUsed, 1);
  assert.equal(d.chapterComplete, false);
  assert.equal(d.savedAt, t);
  assert.ok(b.hasReadDoc('doc.journal1'));
});

test('存档只记场景入口：结构里没有任何谜题状态字段', () => {
  const st = new MemStorage();
  const a = new SaveSystem(st);
  a.newGame('ch1', 's2');
  a.save({ chapterId: 'ch1', sceneId: 's2' });
  const keys = Object.keys(JSON.parse(st.getItem(SAVE_KEY))).sort();
  assert.deepEqual(keys, ['chapterComplete', 'chapterId', 'hintsUsed', 'playTimeSec', 'readDocs', 'savedAt', 'sceneId', 'seenLines', 'version']);
});

test('章节完成：chapterComplete 写入且之后保持', () => {
  const st = new MemStorage();
  const a = new SaveSystem(st);
  a.newGame('ch1', 's3');
  a.save({ chapterId: 'ch1', sceneId: 'chapter_end', chapterComplete: true });
  a.save({ chapterId: 'ch1', sceneId: 'chapter_end' });
  const d = new SaveSystem(st).continueGame();
  assert.equal(d.chapterComplete, true);
  assert.equal(d.sceneId, 'chapter_end');
});

test('版本不匹配（0 / 2 / 缺失）：load 返回 null，提示「存档无法读取」，「继续」隐藏', () => {
  for (const v of [0, 2, undefined, '1']) {
    const s = new SaveSystem(new MemStorage('ok', { [SAVE_KEY]: validSave({ version: v }) }));
    assert.equal(s.load(), null, String(v));
    assert.equal(s.status, 'corrupt');
    assert.equal(s.canContinue, false);
    assert.equal(s.menuNotice, SAVE_TEXT.corrupt);
    assert.match(s.menuNotice, /存档无法读取/);
    assert.equal(s.continueGame(), null);
  }
});

test('非法 JSON / 字段类型不对：返回 null 不抛错', () => {
  for (const bad of ['{', 'null', '[]', '"x"', '', validSave({ readDocs: 'a' }), validSave({ sceneId: 3 }), validSave({ playTimeSec: -1 }), validSave({ hintsUsed: 1.5 }), validSave({ chapterComplete: 'no' })]) {
    assert.equal(parseSave(bad), null, bad);
    const s = new SaveSystem(new MemStorage('ok', { [SAVE_KEY]: bad }));
    assert.equal(s.status, 'corrupt', bad);
    assert.equal(s.canContinue, false);
  }
});

test('坏存档后新游戏：清掉坏存档，启动提示仍保留给主菜单', () => {
  const st = new MemStorage('ok', { [SAVE_KEY]: '{' });
  const s = new SaveSystem(st);
  s.newGame('ch1', 's1');
  assert.equal(st.getItem(SAVE_KEY), null);
  assert.equal(s.startupNotice, SAVE_TEXT.corrupt);
  assert.equal(s.save({ chapterId: 'ch1', sceneId: 's1' }), true);
  assert.equal(new SaveSystem(st).status, 'ok');
});

test('写入失败（隐私模式 setItem 抛错）：不崩溃，提示「进度不会保存」，本次会话内仍可继续', () => {
  for (const mode of ['readonly', 'broken']) {
    const s = new SaveSystem(new MemStorage(mode));
    assert.equal(s.writable, false, mode);
    assert.equal(s.menuNotice, SAVE_TEXT.unavailable);
    assert.match(s.menuNotice, /无法保存进度/);
    let saved = null;
    s.onSaved = (d, ok) => (saved = ok);
    s.newGame('ch1', 's1');
    assert.equal(s.save({ chapterId: 'ch1', sceneId: 's2' }), false);
    assert.equal(saved, false);
    assert.equal(s.canContinue, true);
    assert.equal(s.load().sceneId, 's2');
  }
  assert.equal(new SaveSystem(null).writable, false);
});

test('游玩时间：每满 10 秒加 10 秒，存档时写入，继续后接着累计', () => {
  const st = new MemStorage();
  const s = new SaveSystem(st);
  s.newGame('ch1', 's1');
  for (let i = 0; i < 59; i++) s.tick(0.16); // 9.44s
  assert.equal(s.playTimeSec, 0);
  s.tick(0.6);
  assert.equal(s.playTimeSec, 10);
  s.tick(25);
  assert.equal(s.playTimeSec, 30);
  s.tick(-1);
  s.tick(NaN);
  assert.equal(s.playTimeSec, 30);
  s.save({ chapterId: 'ch1', sceneId: 's1' });
  assert.equal(JSON.parse(st.getItem(SAVE_KEY)).playTimeSec, 30);
  const b = new SaveSystem(st);
  b.continueGame();
  b.tick(10);
  assert.equal(b.playTimeSec, 40);
});

test('没有进度时直接存档（开发时直接进场景）：自动按新游戏开始', () => {
  const s = new SaveSystem(new MemStorage());
  assert.equal(s.save({ chapterId: 'ch1', sceneId: 's1' }), true);
  assert.equal(s.lastSave.playTimeSec, 0);
});

// ---------------------------------------------------------------- 设置

test('设置默认值（GDD §10 / 006）', () => {
  const s = new Settings(new MemStorage());
  assert.deepEqual(s.all, { ...DEFAULT_SETTINGS });
  assert.equal(s.get('quality'), 'ultra');
  assert.equal(s.get('mouseSensitivity'), 1);
  assert.equal(s.get('subtitleSize'), 'm');
  assert.equal(s.get('autoRecenter'), false);
  assert.equal(s.get('showFps'), false);
});

test('设置修改后「刷新」仍保留；新游戏不清除设置', () => {
  const st = new MemStorage();
  const a = new Settings(st);
  let changed = [];
  a.onChange((k, v) => changed.push([k, v]));
  a.update({ mouseSensitivity: 2.2, invertY: true, masterVolume: 40, subtitleSize: 'l', quality: 'high', showFps: true });
  assert.equal(changed.length, 6);
  const save = new SaveSystem(st);
  save.newGame('ch1', 's1');
  save.save({ chapterId: 'ch1', sceneId: 's1' });
  const b = new Settings(st);
  assert.equal(b.get('mouseSensitivity'), 2.2);
  assert.equal(b.get('invertY'), true);
  assert.equal(b.get('masterVolume'), 40);
  assert.equal(b.get('subtitleSize'), 'l');
  assert.equal(b.get('quality'), 'high');
  assert.equal(b.get('showFps'), true);
  assert.equal(JSON.parse(st.getItem(SETTINGS_KEY)).version, 1);
});

test('设置越界 / 类型错误：截断或回默认', () => {
  const st = new MemStorage('ok', {
    [SETTINGS_KEY]: JSON.stringify({ mouseSensitivity: 9, masterVolume: -5, musicVolume: '50', quality: 'epic', subtitleSize: 'xl', invertY: 1 }),
  });
  const s = new Settings(st);
  assert.equal(s.get('mouseSensitivity'), 3);
  assert.equal(s.get('masterVolume'), 0);
  assert.equal(s.get('musicVolume'), DEFAULT_SETTINGS.musicVolume);
  assert.equal(s.get('quality'), 'ultra');
  assert.equal(s.get('subtitleSize'), 'm');
  assert.equal(s.get('invertY'), false);
  s.set('mouseSensitivity', 0);
  assert.equal(s.get('mouseSensitivity'), 0.1);
  assert.deepEqual(new Settings(new MemStorage('ok', { [SETTINGS_KEY]: '{oops' })).all, { ...DEFAULT_SETTINGS });
});

test('旧键 game.quality 迁移一次后删除，视为玩家选择（不再自动检测）', () => {
  const st = new MemStorage('ok', { [LEGACY_QUALITY_KEY]: 'standard' });
  const s = new Settings(st);
  assert.equal(s.migratedLegacyQuality, true);
  assert.equal(s.get('quality'), 'standard');
  assert.equal(s.get('qualityDetected'), true);
  assert.equal(s.get('qualitySource'), 'user');
  assert.equal(st.getItem(LEGACY_QUALITY_KEY), null);
  assert.equal(JSON.parse(st.getItem(SETTINGS_KEY)).quality, 'standard');
  const again = new Settings(st);
  assert.equal(again.migratedLegacyQuality, false);
  assert.equal(again.get('quality'), 'standard');
  // 已有新设置时旧键只删除不覆盖
  const st2 = new MemStorage('ok', { [SETTINGS_KEY]: JSON.stringify({ quality: 'high' }), [LEGACY_QUALITY_KEY]: 'standard' });
  assert.equal(new Settings(st2).get('quality'), 'high');
  assert.equal(st2.getItem(LEGACY_QUALITY_KEY), null);
});

test('设置存储不可写：内存里照常修改，不抛错', () => {
  for (const mode of ['readonly', 'broken']) {
    const s = new Settings(new MemStorage(mode, {}));
    assert.equal(s.writable, false);
    s.set('invertY', true);
    assert.equal(s.get('invertY'), true);
  }
});

test('恢复默认：保留画质检测标记', () => {
  const s = new Settings(new MemStorage());
  s.update({ qualityDetected: true, quality: 'standard', invertY: true });
  s.resetToDefaults();
  assert.equal(s.get('invertY'), false);
  assert.equal(s.get('quality'), 'ultra');
  assert.equal(s.get('qualityDetected'), true);
});

test('009：qualityDetectedTier 清洗 / 持久化；恢复默认回到检测结果（来源 auto），未检测回到极致', () => {
  const st = new MemStorage('ok', { [SETTINGS_KEY]: JSON.stringify({ qualityDetectedTier: 'epic' }) });
  const s = new Settings(st);
  assert.equal(s.get('qualityDetectedTier'), null, '非法值 → 没有检测结果（BUG-002）');
  assert.equal(new Settings(new MemStorage('ok', { [SETTINGS_KEY]: JSON.stringify({ qualityDetected: false, qualityDetectedTier: 'high' }) })).get('qualityDetectedTier'), null, '没检测过时不认 qualityDetectedTier');
  s.update({ qualityDetected: true, qualityDetectedTier: 'high', qualitySource: 'auto', quality: 'high' });
  s.update({ qualitySource: 'user', quality: 'standard' });
  const order = [];
  s.onChange((k) => order.push(k));
  s.resetToDefaults();
  assert.deepEqual([s.get('quality'), s.get('qualitySource'), s.get('qualityDetected')], ['high', 'auto', true]);
  assert.ok(order.indexOf('qualitySource') < order.indexOf('quality'), '应先写来源再写档位');
  assert.equal(new Settings(st).get('qualityDetectedTier'), 'high');
});

test('008：章节完成时把不满 10 秒的零头记进用时；之后不再累计；结束页用时 m:ss', () => {
  const st = new MemStorage();
  const s = new SaveSystem(st);
  s.newGame('ch1', 's1');
  s.save({ chapterId: 'ch1', sceneId: 's1' });
  s.tick(25.5); // 20 秒记入内存，5.5 秒零头
  s.addHintUsed();
  s.save({ chapterId: 'ch1', sceneId: 'end', chapterComplete: true });
  const d = JSON.parse(st.getItem(SAVE_KEY));
  assert.equal(d.chapterComplete, true);
  assert.ok(Math.abs(d.playTimeSec - 25.5) < 1e-6, '用时应含零头：' + d.playTimeSec);
  assert.equal(d.hintsUsed, 1);
  s.save({ chapterId: 'ch1', sceneId: 'end', chapterComplete: true });
  assert.ok(Math.abs(JSON.parse(st.getItem(SAVE_KEY)).playTimeSec - 25.5) < 1e-6, '再次保存不应重复累计');
  assert.deepEqual([0, 9.9, 59, 60, 61, 754, 3600, -3, NaN].map(formatPlayTime), ['0:00', '0:09', '0:59', '1:00', '1:01', '12:34', '60:00', '0:00', '0:00']);
});

// batch26 ②：Safari 15.0–15.3 没有 structuredClone（15.4 才有）——删掉全局后存读档整套流程照常、不抛 ReferenceError
function withoutStructuredClone(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  delete globalThis.structuredClone;
  try {
    assert.equal(typeof globalThis.structuredClone, 'undefined', '模拟环境没删掉 structuredClone');
    fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'structuredClone', had);
  }
}

test('batch26 ②：无 structuredClone 时 构造（读档）→ 新游戏 → 存档 → 继续 → lastSave / onSaved 都不报错，拿到的是副本', () => {
  withoutStructuredClone(() => {
    const st = new MemStorage('ok', { [SAVE_KEY]: validSave({ seenLines: ['line.a'] }) });
    const saved = [];
    const s = new SaveSystem(st); // 构造里就 load()：修前这里抛 ReferenceError
    assert.equal(s.status, 'ok');
    const d = s.load();
    assert.equal(d.sceneId, 's2');
    d.readDocs.push('mutated');
    assert.deepEqual(s.lastSave.readDocs, ['doc.letter1'], 'load() 返回的必须是副本');
    s.onSaved = (data, ok) => saved.push([data, ok]);
    s.newGame('ch1', 's1');
    assert.equal(s.save({ chapterId: 'ch1', sceneId: 's3' }), true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0].sceneId, 's3');
    saved[0][0].sceneId = 'mutated';
    assert.equal(s.lastSave.sceneId, 's3', 'onSaved 拿到的必须是副本');
    const c = s.continueGame();
    assert.equal(c.sceneId, 's3');
    const again = new SaveSystem(st);
    assert.equal(again.status, 'ok');
    assert.equal(again.load().sceneId, 's3');
  });
});

test('batch26 ②：降级拷贝和原生 structuredClone 结果一致（存档 / 过肩机位参数 / 嵌套 / Date / Map / Set / 环引用），且是深拷贝', () => {
  const save = JSON.parse(validSave({ seenLines: ['x'], extra: { a: [1, { b: 2 }] } }));
  for (const v of [save, OVER_SHOULDER, [1, 'a', null, true, [2, [3]]], 0, 'str', null, undefined]) {
    assert.deepEqual(cloneFallback(v), structuredClone(v));
  }
  const fc = cloneFallback(OVER_SHOULDER);
  assert.notEqual(fc.from, OVER_SHOULDER.from);
  fc.from.back = 99;
  assert.notEqual(OVER_SHOULDER.from.back, 99, '降级拷贝改副本不能影响原表');
  const d = new Date(5);
  const m = new Map([['k', { v: 1 }]]);
  const set = new Set([1, 2]);
  const r = cloneFallback({ d, m, set });
  assert.ok(r.d instanceof Date && r.d.getTime() === 5 && r.d !== d);
  assert.ok(r.m instanceof Map && r.m.get('k').v === 1 && r.m.get('k') !== m.get('k'));
  assert.ok(r.set instanceof Set && r.set.has(2) && r.set !== set);
  const cyc = { n: 1 };
  cyc.self = cyc;
  const cc = cloneFallback(cyc);
  assert.equal(cc.self, cc);
  withoutStructuredClone(() => assert.deepEqual(deepClone(save), save));
});

let failed = 0;
for (const [name, e] of results) {
  console.log(`${e ? '✗' : '✓'} ${name}`);
  if (e) {
    failed++;
    console.log(`   ${e.message}`);
  }
}
console.log(failed ? `\n存档 / 设置校验失败：${failed} 项` : `\n存档 / 设置校验通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
