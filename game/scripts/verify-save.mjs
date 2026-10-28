// v0.1-006 存档与设置校验（纯逻辑，无 DOM）：正常读写、版本不匹配、非法 JSON、写入失败、游玩时间、设置迁移。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-save.mjs
import assert from 'node:assert/strict';
import { SAVE_KEY, SAVE_TEXT, SaveSystem, parseSave } from '@/systems/save/SaveSystem';
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
